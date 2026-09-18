import {createServer} from "vite";
import {WebSocket} from "ws";
import {mkdir,writeFile} from "node:fs/promises";
import {WORLD_CONTENT_VERSION,WORLD_PROTOCOL_VERSION,type WorldDescriptor} from "../game/src/contracts.js";
import {createAuthoredWorld} from "../game/src/multiplayer/authoredWorld.js";
import {startReferenceServer} from "../game/src/multiplayer/referenceServer.js";
import {SqliteWorldStorage} from "../game/src/multiplayer/sqliteStorage.js";
import {CROWD_EQUIPMENT} from "./lib/crowdEquipment.js";

// Disposable local play session. Bots use real connections; fixture gear/placement is server setup.
const ports=await createAuthoredWorld(1337);
const world:WorldDescriptor={providerId:"reference",worldId:"preview-64",name:"Corealm with 64 bots",endpoint:"ws://127.0.0.1:0/",
  protocolVersion:WORLD_PROTOCOL_VERSION,contentVersion:WORLD_CONTENT_VERSION,seed:1337,capacity:1000,population:0,availability:"available"};
const server=await startReferenceServer({worlds:[world],storage:new SqliteWorldStorage(":memory:"),build:async()=>ports,
  authentication:{authenticate:async token=>{
    if(!/^guest:[A-Za-z0-9_.-]{1,40}$/.test(token))throw new Error("Development guest required");
    return {playerId:token.slice(6),name:token.slice(6)};
  }}});
const endpoint=`ws://127.0.0.1:${server.port}/`,runtime=[...server.worlds.values()][0]!.runtime;
const bots: {socket:WebSocket;id:string;sessionId:string;sequence:number;operation:number;anchor:readonly number[]}[]=[];
for(let i=0;i<64;i++)await new Promise<void>((resolve,reject)=>{
  const id=`bot-${String(i+1).padStart(2,"0")}`,socket=new WebSocket(endpoint);
  socket.once("error",reject);
  socket.on("open",()=>socket.send(JSON.stringify({type:"join",providerId:world.providerId,worldId:world.worldId,
    token:`guest:${id}`,protocolVersion:world.protocolVersion,contentVersion:world.contentVersion})));
  socket.on("message",bytes=>{
    const message=JSON.parse(String(bytes));
    if(message.type==="joined"){
      const player=runtime.players.get(id)!;
      const anchor=ports.nav.nearestWalkable([ports.spawn[0]+(i%8-3.5)*1.8,ports.spawn[1],ports.spawn[2]+(Math.floor(i/8)-3.5)*1.8])??ports.spawn;
      player.store.get().player.position=anchor;
      for(const [slot,itemId]of Object.entries(CROWD_EQUIPMENT[i%CROWD_EQUIPMENT.length]!))Reflect.set(player.store.get().equipment,slot,{itemId,quantity:1});
      bots.push({socket,id,sessionId:message.sessionId,sequence:0,operation:message.nextOperation-1,anchor});resolve();
    }
    if(message.type==="error")reject(new Error(message.error.message));
  });
});
const motion=setInterval(()=>bots.forEach((bot,i)=>{
  if(bot.socket.readyState!==WebSocket.OPEN)return;
  const position=runtime.players.get(bot.id)!.store.get().player.position,t=Date.now()/3000+i;
  const x=bot.anchor[0]!+Math.cos(t)*1.2-position[0],z=bot.anchor[2]!+Math.sin(t)*1.2-position[2],scale=Math.max(1,Math.hypot(x,z)*4);
  bot.socket.send(JSON.stringify({type:"command",envelope:{sessionId:bot.sessionId,sequence:++bot.sequence,operation:++bot.operation,
    command:{method:"steer",args:[x/scale,z/scale]}}}));
}),300);
const vite=await createServer({root:"game",server:{host:"127.0.0.1",port:0},plugins:[{
  name:"local-multiplayer-preview",transformIndexHtml(){return [{tag:"script",injectTo:"head",children:
    `window.__COREALM_DEVELOPMENT_GUESTS__=true;window.__COREALM_MULTIPLAYER__=${JSON.stringify({...world,endpoint,population:64})};`}];}
}]});
await vite.listen();const address=vite.httpServer!.address();if(!address||typeof address==="string")throw new Error("No game port");
const ready={url:`http://127.0.0.1:${address.port}/`,port:address.port,serverPort:server.port,bots:bots.length,pid:process.pid};
await mkdir("test-results/multiplayer-preview",{recursive:true});
await writeFile("test-results/multiplayer-preview/ready.json",JSON.stringify(ready));console.log(JSON.stringify(ready));
for(const signal of ["SIGINT","SIGTERM"] as const)process.once(signal,()=>{
  clearInterval(motion);for(const bot of bots)bot.socket.close();void Promise.all([vite.close(),server.close()]).then(()=>process.exit(0));
});
