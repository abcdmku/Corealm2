import { fork } from "node:child_process";
import { cpus, platform, release, totalmem } from "node:os";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocket } from "ws";
import { WORLD_PROTOCOL_VERSION, type GameCommand, type WorldDescriptor } from "../../game/src/contracts.js";

/**
 * `multiplayer-capacity.ts --scaling`: N loaded authored worlds on one server, with the worlds in one
 * thread or each in its own, and the numbers that say whether a second world costs the first anything.
 *
 *   --worlds N        Authored worlds on the server. Default 2.
 *   --clients K       Simulated players in each world. Default 150.
 *   --threads on|off  A thread per world, or every world in the main thread. Default on.
 *   --seconds S       Measured interval, after every player has joined. Default 60.
 *   --runs R          Whole runs, each on a fresh server and database. The summary is the median run. Default 1.
 *   --encoding bytes|text   How frames cross from a world thread. Default bytes.
 *   --port P          Default 4450.
 *
 * Every player joins at the world's spawn, steers for two seconds in every ten, and once every ten
 * seconds asks for a path to a point up to forty metres away, so each tick replicates a crowd that
 * sees itself, runs pathfinding and movement for it, and commits all of it. Load comes from one child
 * process per world, so the load generator never shares a core with what it measures.
 */
const value = (args: readonly string[], key: string, fallback: string): string => args.includes(key) && args[args.indexOf(key) + 1] ? args[args.indexOf(key) + 1]! : fallback;
const percentile = (values: readonly number[], p: number): number | null => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))]! : null;
const median = (values: readonly (number | null)[]): number | null => { const known = values.filter((entry): entry is number => entry !== null).sort((a, b) => a - b); return known.length ? known[Math.floor((known.length - 1) / 2)]! : null; };
const round = (number: number | null, digits = 2): number | null => number === null ? null : Math.round(number * 10 ** digits) / 10 ** digits;
const spread = (values: readonly number[]) => ({ p50: round(percentile(values, .5)), p95: round(percentile(values, .95)), p99: round(percentile(values, .99)), samples: values.length });

interface ClientResult { world: string; clients: number; connectedAtEnd: number; accepted: number; rejected: number; updates: number; errors: string[]; acknowledgementMs: ReturnType<typeof spread>; bytesIn: number }

/** One world's players, in a process of their own. */
export async function runScalingClient(args: readonly string[]): Promise<void> {
  const endpoint = value(args, "--endpoint", ""), world = value(args, "--world", ""), count = Number(value(args, "--clients", "150")), seconds = Number(value(args, "--seconds", "60"));
  interface Client { socket: WebSocket; sessionId: string; sequence: number; operation: number; index: number; pending: Map<number, number>; origin: [number, number, number] | null }
  const latency: number[] = [], errors: string[] = []; let accepted = 0, rejected = 0, updates = 0, bytesIn = 0;
  const connect = (index: number) => new Promise<Client>((done, fail) => {
    const socket = new WebSocket(endpoint), client: Client = { socket, sessionId: "", sequence: 0, operation: 1, index, pending: new Map(), origin: null };
    const timeout = setTimeout(() => { socket.terminate(); fail(new Error(`Join timeout for ${world} ${index}`)); }, 60_000);
    socket.on("error", error => { errors.push(error.message); });
    socket.on("open", () => socket.send(JSON.stringify({ type: "join", providerId: "capacity", worldId: world, token: `load-${world}-${index}`, protocolVersion: WORLD_PROTOCOL_VERSION })));
    socket.on("message", raw => {
      const text = raw.toString(); bytesIn += text.length; const message = JSON.parse(text);
      if (message.type === "joined") { client.sessionId = message.sessionId; client.operation = message.nextOperation; }
      else if (message.type === "update") {
        updates++;
        if (message.update.snapshot && client.sessionId && !client.origin) { client.origin = message.update.privateState.player.position; clearTimeout(timeout); done(client); }
      } else if (message.type === "error") errors.push(message.error.code);
      else if (message.type === "ack") {
        const sent = client.pending.get(message.outcome.sequence);
        if (sent !== undefined) { latency.push(performance.now() - sent); client.pending.delete(message.outcome.sequence); }
        if (message.outcome.status === "accepted") accepted++; else rejected++;
      }
    });
  });
  const clients: Client[] = [];
  for (let offset = 0; offset < count; offset += 10) clients.push(...await Promise.all(Array.from({ length: Math.min(10, count - offset) }, (_, n) => connect(offset + n))));
  process.send?.({ type: "ready" });
  await new Promise<void>(go => process.once("message", () => go()));
  const send = (client: Client, command: GameCommand): void => {
    if (client.socket.readyState !== WebSocket.OPEN || client.pending.size >= 8) return;
    const sequence = ++client.sequence;
    client.pending.set(sequence, performance.now());
    client.socket.send(JSON.stringify({ type: "command", envelope: { sessionId: client.sessionId, sequence, operation: client.operation++, command } }));
  };
  const started = performance.now(); let steps = 0;
  await new Promise<void>(finished => {
    const timer = setInterval(() => {
      if (performance.now() - started >= seconds * 1000) { clearInterval(timer); finished(); return; }
      for (const client of clients) {
        const phase = (steps + client.index) % 20;
        if (phase < 4) send(client, { method: "steer", args: [phase < 2 ? 1 : -1, phase % 2 ? .5 : -.5] });
        if (phase === 4) { const angle = (steps * 7 + client.index * 13) % 360 * Math.PI / 180, reach = 10 + (client.index * 7) % 30; send(client, { method: "moveTo", args: [{ position: [client.origin![0] + Math.cos(angle) * reach, client.origin![1], client.origin![2] + Math.sin(angle) * reach] }] }); }
      }
      steps++;
    }, 500);
  });
  await new Promise(settle => setTimeout(settle, 500));
  const result: ClientResult = { world, clients: count, connectedAtEnd: clients.filter(client => client.socket.readyState === WebSocket.OPEN).length, accepted, rejected, updates, errors: [...new Set(errors)], acknowledgementMs: spread(latency), bytesIn };
  for (const client of clients) client.socket.terminate();
  await writeFile(value(args, "--result-file", ""), JSON.stringify(result));
  process.disconnect?.();
}

interface RunReport {
  ticks: Record<string, ReturnType<typeof spread>>; stagesMs: Record<string, Record<string, number | null>>;
  mainLoopLagMs: { p50: number | null; p99: number | null; max: number | null };
  database: Record<string, unknown> | null; threadCpuShare: Record<string, number | null> | null;
  processCpuShare: number; peakRssMiB: number; bootMs: number; clients: ClientResult[];
}

async function once(index: number, options: { worlds: number; clients: number; threads: boolean; seconds: number; port: number; encoding: "bytes" | "text"; directory: string; entry: string }): Promise<RunReport> {
  const directory = `${options.directory}/run-${index}`; await rm(directory, { recursive: true, force: true }); await mkdir(directory, { recursive: true });
  const { RESOLVED_CATALOG } = await import("../../game/src/content/resolvedCatalog.js");
  const { seedCatalog } = await import("../../game/src/multiplayer/catalogHost.js");
  const { startReferenceServer } = await import("../../game/src/multiplayer/referenceServer.js");
  const pack = await readFile("game/public/generated/server-world.pack");
  const worlds: WorldDescriptor[] = Array.from({ length: options.worlds }, (_, n) => ({ providerId: "capacity", worldId: `world-${n + 1}`, name: `World ${n + 1}`, endpoint: `ws://127.0.0.1:${options.port}/`,
    protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored", seed: 1337, population: 0, capacity: Math.min(1000, options.clients + 8), availability: "available" }));
  const authentication = { authenticate: async (token: string) => ({ playerId: token, name: token }) };
  const bootStarted = performance.now();
  let server: Awaited<ReturnType<typeof startReferenceServer>>;
  if (options.threads) {
    const { startDatabaseThread } = await import("../../game/src/multiplayer/threads/databaseClient.js");
    const { moduleLauncher } = await import("../../game/src/multiplayer/threads/launch.js");
    const launch = moduleLauncher(pathToFileURL(resolve("game/src/multiplayer/threads/threadEntry.ts")));
    const database = await startDatabaseThread(launch, { kind: "sqlite", path: resolve(directory, "worlds.sqlite") });
    await seedCatalog(database.storage.catalog, { catalog: RESOLVED_CATALOG, sources: {} }, () => {});
    const shared = new Uint8Array(new SharedArrayBuffer(pack.byteLength)); shared.set(pack);
    server = await startReferenceServer({ worlds, port: options.port, storage: database.storage.world, catalog: database.storage.catalog, authentication, log: () => {},
      build: () => Promise.reject(new Error("built in its thread")),
      threads: { launch, database, build: { kind: "pack", bytes: shared }, catalog: { kind: "module", specifier: pathToFileURL(resolve("game/src/content/bundledCatalog.ts")).href }, peerEncoding: options.encoding, restart: false } });
  } else {
    const { SqliteWorldStorage } = await import("../../game/src/multiplayer/sqliteStorage.js");
    const { createPackedWorld, loadServerWorldPack } = await import("../../game/src/multiplayer/worldPack.js");
    const loaded = loadServerWorldPack(pack), storage = new SqliteWorldStorage(resolve(directory, "worlds.sqlite"), { log: () => {} });
    await seedCatalog(storage.catalog, { catalog: RESOLVED_CATALOG, sources: {} }, () => {});
    server = await startReferenceServer({ worlds, port: options.port, storage, catalog: storage.catalog, authentication, log: () => {}, build: world => createPackedWorld(loaded, world.seed) });
  }
  const bootMs = performance.now() - bootStarted;
  const children = worlds.map(world => fork(options.entry, ["--scaling-client", "--endpoint", `ws://127.0.0.1:${server.port}/`, "--world", world.worldId, "--clients", String(options.clients), "--seconds", String(options.seconds),
    "--result-file", `${directory}/${world.worldId}.json`], { execArgv: ["--import", "tsx"], stdio: ["ignore", "inherit", "inherit", "ipc"] }));
  let peakRss = 0; const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 500);
  try {
    await Promise.all(children.map(child => new Promise<void>((ready, failed) => { child.once("message", () => ready()); child.once("exit", code => failed(new Error(`A load process ended before it was ready (${code})`))); })));
    // Every player is in. Let the join burst drain, then measure from a clean slate.
    await new Promise(settle => setTimeout(settle, 3000));
    await server.refresh(); server.threads?.clearTicks(); server.metrics.ticks.length = 0;
    const stagesBefore = { ...server.metrics.stages };
    if (server.threads) await server.threads.diagnostics();
    const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
    const cpuBefore = process.cpuUsage(), wallBefore = performance.now();
    for (const child of children) child.send({ type: "go" });
    await Promise.all(children.map(child => new Promise<void>((ended, failed) => child.once("exit", code => code ? failed(new Error(`A load process failed (${code})`)) : ended()))));
    lag.disable();
    const cpu = process.cpuUsage(cpuBefore), wallMs = performance.now() - wallBefore;
    const diagnostics = server.threads ? await server.threads.diagnostics() : null;
    const stageMeans = (stages: { simulationMs: number; snapshotMs: number; commitMs: number; replicationMs: number; samples: number }, before = { simulationMs: 0, snapshotMs: 0, commitMs: 0, replicationMs: 0, samples: 0 }) => {
      const samples = Math.max(1, stages.samples - before.samples);
      return { simulation: round((stages.simulationMs - before.simulationMs) / samples), snapshot: round((stages.snapshotMs - before.snapshotMs) / samples), commit: round((stages.commitMs - before.commitMs) / samples), replication: round((stages.replicationMs - before.replicationMs) / samples) };
    };
    // With threads off one loop ticks every world in turn, so its tick time is all of them together and no world has one of its own.
    const ticks = diagnostics ? Object.fromEntries(diagnostics.worlds.map(world => [world.worldId, spread(world.ticks)])) : { "all worlds, one loop": spread(server.metrics.ticks) };
    const stagesMs = diagnostics ? Object.fromEntries(diagnostics.worlds.map(world => [world.worldId, stageMeans(world.stages)])) : { "all worlds, one loop (per world tick)": stageMeans(server.metrics.stages, stagesBefore) };
    const clients = await Promise.all(worlds.map(async world => JSON.parse(await readFile(`${directory}/${world.worldId}.json`, "utf8")) as ClientResult));
    return { ticks, stagesMs, bootMs: Math.round(bootMs), clients,
      mainLoopLagMs: { p50: round(lag.percentile(50) / 1e6), p99: round(lag.percentile(99) / 1e6), max: round(lag.max / 1e6) },
      database: diagnostics ? { commits: diagnostics.database.commits, commitMs: spread(diagnostics.database.commitMs), commitWaitMs: spread(diagnostics.database.commitWaitMs), utilization: round(diagnostics.database.utilization) } : null,
      threadCpuShare: diagnostics ? Object.fromEntries(diagnostics.worlds.map(world => [world.worldId, world.cpuMs === null ? null : round(world.cpuMs / wallMs)])) : null,
      processCpuShare: round((cpu.user + cpu.system) / 1000 / wallMs)!, peakRssMiB: Math.round(peakRss / 1048576) };
  } finally { clearInterval(sampler); for (const child of children) child.kill(); await server.close(); }
}

export async function runScaling(args: readonly string[], entry: string): Promise<void> {
  const worlds = Number(value(args, "--worlds", "2")), clients = Number(value(args, "--clients", "150")), seconds = Number(value(args, "--seconds", "60")), runs = Number(value(args, "--runs", "1"));
  const threads = value(args, "--threads", "on") === "on", port = Number(value(args, "--port", "4450")), encoding = value(args, "--encoding", "bytes") === "text" ? "text" : "bytes";
  if (![worlds, clients, seconds, runs].every(number => Number.isInteger(number) && number >= 1) || worlds > 8 || clients > 990) throw new Error("Invalid scaling options");
  const name = `${worlds}w-${clients}c-threads-${threads ? "on" : "off"}${threads && encoding === "text" ? "-text" : ""}`;
  const directory = value(args, "--out", `test-results/multiplayer-capacity/scaling/${name}`); await mkdir(directory, { recursive: true });
  const reports: RunReport[] = [];
  for (let run = 1; run <= runs; run++) {
    const report = await once(run, { worlds, clients, threads, seconds, port, encoding, directory, entry }); reports.push(report);
    console.log(JSON.stringify({ run, ticks: report.ticks, mainLoopLagMs: report.mainLoopLagMs, peakRssMiB: report.peakRssMiB, database: report.database, errors: report.clients.flatMap(client => client.errors) }));
  }
  // The median over runs of each world's percentile, then the worst world: the number a player in the slower world lives with.
  const worldNames = Object.keys(reports[0]!.ticks);
  const tick = Object.fromEntries((["p50", "p95", "p99"] as const).map(p => [p, Math.max(...worldNames.map(world => median(reports.map(report => report.ticks[world]![p])) ?? 0))]));
  const summary = { configuration: { worlds, clientsPerWorld: clients, threads, encoding: threads ? encoding : null, seconds, runs },
    hardware: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemory: totalmem(), platform: platform(), release: release(), node: process.version },
    tickMs: tick, mainLoopLagMs: { p50: median(reports.map(report => report.mainLoopLagMs.p50)), p99: median(reports.map(report => report.mainLoopLagMs.p99)) },
    acknowledgementMsP95: median(reports.map(report => Math.max(...report.clients.map(client => client.acknowledgementMs.p95 ?? 0)))),
    processCpuShare: median(reports.map(report => report.processCpuShare)), peakRssMiB: median(reports.map(report => report.peakRssMiB)), bootMs: median(reports.map(report => report.bootMs)),
    allConnectedAtEnd: reports.every(report => report.clients.every(client => client.connectedAtEnd === client.clients)), runs: reports };
  await writeFile(`${directory}/report.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ report: `${directory}/report.json`, ...summary, runs: undefined }));
}
