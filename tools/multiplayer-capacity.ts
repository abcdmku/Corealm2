import "./lib/repoContent.js";
import { fork } from "node:child_process";
import { cpus, totalmem, platform, release } from "node:os";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import {createHash} from "node:crypto";
import { WebSocket } from "ws";
import { Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { WORLD_PROTOCOL_VERSION, type GameCommand, type WorldDescriptor } from "../game/src/contracts.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { Navigation } from "../game/src/systems/navigation.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";

const args = process.argv.slice(2);
const value = (key: string, fallback: string) => args[args.indexOf(key) + 1] && args.includes(key) ? args[args.indexOf(key) + 1]! : fallback;
const count = Number(value("--clients", "1000")); const seconds = Number(value("--seconds", "600"));
const placement = value("--placement", "clustered");
const percentile = (values: number[], p: number) => values.length ? [...values].sort((a,b) => a-b)[Math.min(values.length-1, Math.floor(values.length*p))]! : null;
if (!Number.isInteger(count) || count < 1 || count > 1000 || !Number.isFinite(seconds) || seconds < 1 || !["clustered", "distributed"].includes(placement)) throw new Error("Invalid workload options");

if (args.includes("--worker")) {
  const endpoint = value("--endpoint", "");
  const clients: { socket: WebSocket; sessionId: string; sequence: number; operation: number; index: number; pending: Map<number,number> }[] = [];
  const latency: number[] = []; const slowLatency: number[] = []; const errors: string[] = []; let bytesIn = 0; let bytesOut = 0; let accepted = 0; let rejected = 0; let updates = 0;
  let churnComplete = false; let slowConsumersComplete = false;
  const connect = (index: number, overflow = false) => new Promise<typeof clients[number]>((resolve, reject) => {
    const socket = new WebSocket(endpoint); const pending = new Map<number,number>();
    const client = { socket, sessionId: "", sequence: 0, operation: 1, index, pending };
    const timeout = setTimeout(() => { socket.terminate(); reject(new Error("Join timeout")); }, 30_000);
    socket.on("error", (error) => { errors.push(error.message); });
    socket.on("open", () => socket.send(JSON.stringify({ type: "join", providerId: "capacity", worldId: "yard", token: `load-${index}`,
      protocolVersion: WORLD_PROTOCOL_VERSION })));
    socket.on("message", (raw) => {
      bytesIn += Buffer.byteLength(raw.toString()); const message = JSON.parse(raw.toString());
      if (message.type === "joined") { client.sessionId = message.sessionId; client.operation = message.nextOperation; }
      if (message.type === "update") { updates++; if (message.update.snapshot && client.sessionId) { clearTimeout(timeout); resolve(client); } }
      if (message.type === "error") { if (overflow) { clearTimeout(timeout); socket.terminate(); reject(new Error(message.error.code)); } else errors.push(message.error.code); }
      if (message.type === "ack") {
        const sent = pending.get(message.outcome.sequence);
        if (sent !== undefined) { (index<5?slowLatency:latency).push(performance.now()-sent); pending.delete(message.outcome.sequence); }
        if (message.outcome.status === "accepted") accepted++; else rejected++;
      }
    });
  });
  // Bound the admission burst; the measured interval starts only after every snapshot arrives.
  for (let offset = 0; offset < count; offset += 20) clients.push(...await Promise.all(Array.from({length: Math.min(20,count-offset)}, (_,n) => connect(offset+n))));
  let fullRejected = false;
  try { const overflow = await connect(count, true); overflow.socket.terminate(); } catch(error) { fullRejected = String(error).includes("FULL"); }
  process.send?.({ type: "ready" });
  const start = performance.now(); const cpu = process.cpuUsage(); let peakMemory = process.memoryUsage().rss; let steps = 0;
  let scenario:Promise<void>=Promise.resolve();
  const reconnect=async(index:number)=>{
    const old=clients[index]!;
    if(old.socket.readyState!==WebSocket.CLOSED){const closed=new Promise<void>(resolve=>old.socket.once("close",()=>resolve()));old.socket.terminate();await closed;}
    clients[index]=await connect(index);
  };
  const send = (client: typeof clients[number], command: GameCommand) => {
    if (client.socket.readyState !== WebSocket.OPEN || client.pending.size >= 8) return;
    const sequence = ++client.sequence; const payload = JSON.stringify({type:"command", envelope:{sessionId:client.sessionId,sequence,operation:client.operation++,command}});
    client.pending.set(sequence,performance.now()); bytesOut += Buffer.byteLength(payload); client.socket.send(payload);
  };
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const elapsed = performance.now()-start;
      if (elapsed >= seconds*1000) { clearInterval(timer); resolve(); return; }
      for (const client of clients) {
        const phase = (steps + client.index) % 20;
        if (phase < 4) send(client, {method:"steer",args:[phase < 2 ? 1 : -1,0]});
        if (phase === 4) send(client, {method:"interact",args:[`load-ore-${placement === "clustered" ? 0 : client.index}`,"mine"]});
      }
      if(steps===60&&count>=10){
        const slow=clients.slice(0,5);
        for(const client of slow)(client.socket as unknown as {_socket:import("node:net").Socket})._socket.pause();
        scenario=scenario.then(async()=>{
          await new Promise(resolve=>setTimeout(resolve,10_000));
          for(const client of slow)(client.socket as unknown as {_socket:import("node:net").Socket})._socket.resume();
          await new Promise(resolve=>setTimeout(resolve,1000));
          for(let index=0;index<slow.length;index++)if(clients[index]!.socket.readyState!==WebSocket.OPEN)await reconnect(index);
          slowConsumersComplete=true;
        });
      }
      if(steps===120&&count>=10)scenario=scenario.then(async()=>{
        for(let index=5;index<10;index++)await reconnect(index);
        churnComplete=true;
      });
      steps++; peakMemory = Math.max(peakMemory, process.memoryUsage().rss);
      if (steps % 20 === 0) process.send?.({type:"progress",seconds:Math.round(elapsed/1000),connected:clients.filter(c=>c.socket.readyState===WebSocket.OPEN).length});
    },500);
  });
  await scenario;
  const result = { durationSeconds: (performance.now()-start)/1000, clients:count, activeClients:clients.filter(c=>c.sequence>0).length,
    connectedAtEnd:clients.filter(c=>c.socket.readyState===WebSocket.OPEN).length, accepted,rejected,updates,fullRejected,errors,
    churnComplete,slowConsumersComplete,pending:clients.reduce((n,c)=>n+c.pending.size,0), acknowledgementMs:{p50:percentile(latency,.5),p95:percentile(latency,.95),p99:percentile(latency,.99)},
    slowConsumerAcknowledgementMs:{p95:percentile(slowLatency,.95)},
    bytesIn,bytesOut,cpu:process.cpuUsage(cpu),peakRssBytes:peakMemory };
  for (const client of clients) client.socket.terminate();
  await writeFile(value("--result-file", "test-results/capacity-client.json"), JSON.stringify(result));
  process.disconnect?.();
} else {
  const directory = value("--out", `test-results/multiplayer-capacity/${placement}-${Date.now()}`); await mkdir(directory,{recursive:true});
  const world:WorldDescriptor = {providerId:"capacity",worldId:"yard",name:"Capacity fixture",endpoint:"ws://127.0.0.1:0/",protocolVersion:WORLD_PROTOCOL_VERSION,
    fixture:"authored",seed:1337,population:0,capacity:count,availability:"available"};
  const ports = await createMultiplayerLabWorld();
  const ground = new Mesh(new PlaneGeometry(1200,1200),new MeshBasicMaterial()); ground.rotation.x=-Math.PI/2; ground.updateMatrixWorld(true);
  const nav = new Navigation(); if(!nav.build([ground])) throw new Error("Capacity navigation failed"); ports.nav=nav;
  ground.geometry.dispose(); ground.material.dispose();
  const ore = ports.entities.find(entity=>entity.id==="multiplayer:ore")!;
  const origin = (index:number): readonly[number,number,number] => placement === "clustered" ? [0,0,0] : [(index%32-16)*32,0,(Math.floor(index/32)-16)*32];
  for(let i=0;i<(placement === "clustered" ? 1 : count);i++){const position=origin(i);ports.entities.push({...structuredClone(ore),id:`load-ore-${i}`,position:[position[0]+3,0,position[2]],resource:{...ore.resource!,remaining:100,maxYields:100}});}
  const sourceHash=createHash("sha256");
  for(const file of (await readdir("game/src",{recursive:true})).filter(file=>file.endsWith(".ts")).sort())sourceHash.update(file).update(await readFile(`game/src/${file}`));
  sourceHash.update(await readFile("tools/multiplayer-capacity.ts"));const sourceFingerprint=sourceHash.digest("hex");
  const storage=new SqliteWorldStorage(`${directory}/world.sqlite`);
  const server = await startReferenceServer({worlds:[world],storage,build:async()=>ports,
    authentication:{authenticate:async(token)=>({playerId:token,name:token})}});
  const runtime = [...server.worlds.values()][0]!.runtime;
  for(let i=0;i<count;i++){const player=runtime.join(`load-${i}`);player.store.get().player.position=origin(i);player.store.get().skills.mining.level=99;runtime.leave(`load-${i}`);}
  const resultFile = `${directory}/client.json`;
  const worker = fork(new URL(import.meta.url),[...args,"--worker","--endpoint",`ws://127.0.0.1:${server.port}/`,"--result-file",resultFile],{execArgv:["--import","tsx"],stdio:["ignore","inherit","inherit","ipc"]});
  let cpu = process.cpuUsage(); let peakMemory=process.memoryUsage().rss; let started=false;
  const sample=setInterval(()=>{peakMemory=Math.max(peakMemory,process.memoryUsage().rss);},1000);
  try {
    const client = await new Promise<Record<string,unknown>>((resolve,reject)=>{
      worker.on("error",reject);worker.on("exit",code=>{
        if(code) reject(new Error(`Load worker exited before report: ${code}`));
        else void readFile(resultFile,"utf8").then(json=>resolve(JSON.parse(json)),reject);
      });
      worker.on("message",(message:any)=>{
        if(message.type==="ready"){started=true;cpu=process.cpuUsage();server.metrics.ticks.length=0;console.log(JSON.stringify({placement,clients:count,measuring:true}));}
        if(message.type==="progress")console.log(JSON.stringify(message));
        if(message.type==="result")resolve(message.result);
      });
    });
    const tick = {p50:percentile(server.metrics.ticks,.5),p95:percentile(server.metrics.ticks,.95),p99:percentile(server.metrics.ticks,.99)};
    const stored=await storage.load(world);
    const gameplayEvidence={minedOreInInventories:Object.values(stored?.players??{}).reduce((sum,state)=>sum+state.inventory.slots.reduce((total,slot)=>total+(slot?.itemId==="grithe_ore"?slot.quantity:0),0),0),
      resourceRecords:Object.keys(stored?.world.nodes??{}).length,durablePlayers:Object.keys(stored?.players??{}).length};
    const report = { fixture:"Production lab rules on a synthetic flat capacity pad; does not measure authored-scene rendering",placement,
      sourceFingerprint,gameplayEvidence,releaseCapacityEvidence:false, remainingScenarios:[...(!client.churnComplete?["churn"]:[]),...(!client.slowConsumersComplete?["slow consumers"]:[])],
      sustained1000:count===1000&&Number(client.durationSeconds)>=600&&client.connectedAtEnd===1000,
      hardware:{cpu:cpus()[0]?.model,logicalCpus:cpus().length,totalMemory:totalmem(),platform:platform(),release:release(),node:process.version},
      workload:"Each player steers in four 500 ms intervals and starts production mining once every 10 seconds, staggered by player index.",
      client,server:{tickMs:tick,cpu:process.cpuUsage(cpu),peakRssBytes:peakMemory,metrics:{...server.metrics,ticks:undefined}},started };
    await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2)); console.log(JSON.stringify({report:`${directory}/report.json`,tickMs:tick,client}));
  } finally {clearInterval(sample);worker.kill();await server.close();}
}
