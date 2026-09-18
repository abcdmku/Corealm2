import { spawn } from "node:child_process";
import { cpus, totalmem } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { WORLD_CONTENT_VERSION, WORLD_LAB_CONTENT_VERSION, WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { createAuthoredWorld } from "../game/src/multiplayer/authoredWorld.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { WebSocketProvider } from "../game/src/multiplayer/webSocketProvider.js";
import { installTestDeadline } from "./lib/deadline.js";

function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  return { count: sorted.length, p50: at(.5), p95: at(.95), max: at(1) };
}

const probe = process.argv.indexOf("--probe");
if (probe >= 0) {
  // The client runs in a different process. Server event-loop stalls must count as wire latency.
  const [world] = await (await fetch(process.argv[probe + 1]!)).json() as WorldDescriptor[];
  const provider = new WebSocketProvider(world!.providerId, [world!], async () => ({ token: "response-probe" }));
  const session = await provider.connect(world!, { token: "response-probe" });
  const latencies: number[] = [], failures: string[] = [];
  const start = performance.now();
  let updates = 0, travel = 0, last: number[] | undefined;
  const unsubscribe = session.subscribe(update => {
    updates++;
    const point = update.privateState?.player.position;
    if (point && last) travel += Math.hypot(point[0] - last[0]!, point[2] - last[2]!);
    if (point) last = [...point];
  });
  try {
    while (performance.now() - start < 20_000) {
      const sent = performance.now();
      const outcome = await session.command({ method: "steer", args: [Math.floor((sent - start) / 2000) % 2 ? -1 : 1, 0] });
      latencies.push(performance.now() - sent);
      if (outcome.status !== "accepted") failures.push(outcome.status);
      await new Promise(resolve => setTimeout(resolve, Math.max(0, 150 - (performance.now() - sent))));
    }
    await session.command({ method: "stop", args: [] });
    console.log(JSON.stringify({ acknowledgementsMs: percentiles(latencies), updates, travel, failures, durationMs: performance.now() - start }));
  } finally { unsubscribe(); await session.close(); }
} else {
  const authored = process.argv.includes("--authored"), out = `test-results/multiplayer-response-${authored ? "authored" : "lab"}`;
  const clearDeadline = installTestDeadline("multiplayer response", authored ? 120_000 : 60_000);
  await mkdir(out, { recursive: true });
  const world: WorldDescriptor = { providerId: "reference", worldId: "response", name: "Response check", endpoint: "ws://127.0.0.1:0/",
    protocolVersion: WORLD_PROTOCOL_VERSION, contentVersion: authored ? WORLD_CONTENT_VERSION : WORLD_LAB_CONTENT_VERSION,
    seed: 1337, capacity: 200, population: 0, availability: "available" };
  const server = await startReferenceServer({ worlds: [world], storage: new SqliteWorldStorage(`${out}/${Date.now()}.sqlite`),
    build: () => authored ? createAuthoredWorld(1337) : createMultiplayerLabWorld(),
    authentication: { authenticate: async () => ({ playerId: "probe", name: "Probe" }) } });
  const child = spawn(process.execPath, ["--import", "tsx", "tools/multiplayer-response-test.ts", "--probe", `http://127.0.0.1:${server.port}/worlds`],
    { stdio: ["ignore", "pipe", "inherit"], windowsHide: true });
  const stopChild = () => { if (child.exitCode === null) child.kill("SIGKILL"); };
  process.once("exit", stopChild);
  let output = ""; child.stdout.on("data", chunk => { output += String(chunk); });
  const cpuStart = process.cpuUsage(), start = performance.now();
  try {
    const exit = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    if (exit !== 0) throw new Error(`Network probe exited ${exit}`);
    const client = JSON.parse(output.trim());
    const stages = Object.fromEntries(Object.entries(server.metrics.stages).filter(([key]) => key !== "samples")
      .map(([key, total]) => [key, total / server.metrics.stages.samples]));
    const cpu = process.cpuUsage(cpuStart);
    const report = { scope: "One active network client; repeated production movement and durable acknowledgements. Not a capacity certification.",
      authored, hardware: { cpu: cpus()[0]?.model, memoryBytes: totalmem() }, durationMs: performance.now() - start,
      cpuMs: (cpu.user + cpu.system) / 1000, rssBytes: process.memoryUsage().rss,
      tickMs: percentiles(server.metrics.ticks), averageStagesMs: stages, client,
      passed: client.failures.length === 0 && client.updates > 100 && client.travel > 5
        && client.acknowledgementsMs.p95 < 250 && server.metrics.errors === 0 };
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
    if (!report.passed) process.exitCode = 1;
  } finally { stopChild(); process.removeListener("exit", stopChild); await server.close(); clearDeadline(); }
}
