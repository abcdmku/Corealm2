import { installCatalog, type InstalledCatalog } from "../content/catalogInstall.js";
import { LOCAL_WORLD_MANIFEST, parseLocalWorldManifest, type LocalHostReply, type LocalHostRequest, type LocalHostStart, type LocalHostTimings } from "./localHostProtocol.js";
import type { LocalHost } from "./localHostRuntime.js";
import { parseLabFixtureSpec } from "../featureLab/labSpec.js";
import { labWorldData } from "./labProtocol.js";

/**
 * The local-play worker: the server, in the page.
 *
 * Install before import. This file's static imports evaluate no content: `catalogInstall.ts` imports
 * nothing and `localHostProtocol.ts` only the contracts. `start` fetches the server catalog the build
 * published, installs it, and only then `import()`s `localHostRuntime.ts`, whose graph (the host
 * core, the world pack, the systems) reads content tables as it loads. So this chunk holds no catalog
 * JSON, and a worker always runs on the catalog that was published with the pack it fetched.
 * `tests/local-worker-import-graph.test.ts` holds both halves to that.
 */
/** The two things this file asks of its global scope. The project compiles against the DOM library, which has no worker scope type. */
interface WorkerScope { postMessage(message: LocalHostReply): void; addEventListener(type: "message", listener: (event: MessageEvent<LocalHostRequest>) => void): void }
const scope = self as unknown as WorkerScope;
const reply = (message: LocalHostReply): void => scope.postMessage(message);

async function fetched(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, { credentials: "omit", ...init });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response;
}

function serverCatalog(value: unknown, revision: string): InstalledCatalog {
  const catalog = value as Partial<InstalledCatalog> | null;
  if (typeof catalog !== "object" || catalog === null || catalog.version !== 1 || catalog.revision !== revision || typeof catalog.formulaRevision !== "string"
    || typeof catalog.tables !== "object" || catalog.tables === null) throw new Error("The published server catalog is not the one the manifest names");
  return { version: 1, revision, formulaRevision: catalog.formulaRevision, tables: catalog.tables };
}

async function start(message: LocalHostStart): Promise<LocalHost> {
  const began = performance.now(); let mark = began;
  const lap = (): number => { const now = performance.now(), took = now - mark; mark = now; return took; };
  const generated = (file: string): string => new URL(`generated/${file}`, message.assetBase).href;
  // The manifest is the only file with a fixed name, so it is the only one that is revalidated.
  const manifest = parseLocalWorldManifest(await (await fetched(generated(LOCAL_WORLD_MANIFEST), { cache: "no-cache" })).json());
  const manifestMs = lap();
  const lab = message.fixture === "lab";
  // Refused before anything is fetched: a lab whose spec cannot be read must not fall back to some other world.
  const labSpec = message.lab === undefined ? null : parseLabFixtureSpec(message.lab);
  if (labSpec && !lab) throw new Error("A lab spec needs the lab fixture");
  const [catalogJson, pack] = await Promise.all([
    fetched(generated(manifest.catalog.file)).then(response => response.json()).then(value => { const took = performance.now() - mark; return { value: value as unknown, took }; }),
    lab ? Promise.resolve(null) : fetched(`${generated(manifest.pack.file)}?v=${encodeURIComponent(manifest.pack.revision)}`)
      .then(response => response.arrayBuffer()).then(buffer => ({ bytes: new Uint8Array(buffer), took: performance.now() - mark })),
  ]);
  lap();
  installCatalog(serverCatalog(catalogJson.value, manifest.catalog.revision));
  const installMs = lap();
  // Everything below reads content as it loads. Nothing above does.
  const [{ startLocalHost }, storage] = await Promise.all([
    import("./localHostRuntime.js"),
    message.memory || labSpec ? Promise.resolve(undefined) : import("../multiplayer/indexedDbStorage.js").then(({ openLocalWorldStorage }) => openLocalWorldStorage({
      onError: ({ error, attempt, pending, degraded }) => reply({ type: "storage-error", message: error instanceof Error ? error.message : String(error), attempt, pending, degraded }) })),
  ]);
  const storageMs = lap();
  // The page describes the lab world once its scene is drawn. Everything above ran beside that.
  const labWorld = labSpec ? { spec: labSpec, data: labWorldData(await labWorldArrived) } : null;
  const host = await startLocalHost({ fixture: message.fixture, seed: message.seed, ...(manifest.baseVersion ? { baseVersion: manifest.baseVersion } : {}), ...(labWorld ? { lab: labWorld } : {}), ...(pack ? { pack: pack.bytes } : {}), ...(message.legacy ? { legacy: message.legacy } : {}), ...(storage ? { storage } : {}) });
  const timings: LocalHostTimings = { manifestMs, catalogMs: catalogJson.took, packMs: pack?.took ?? 0, installMs, storageMs, importMs: host.timings.importMs, worldMs: host.timings.worldMs, totalMs: performance.now() - began };
  reply({ type: "ready", world: host.world, catalogRevision: manifest.catalog.revision, seed: host.seed, legacy: host.legacy, storage: storage ? "indexeddb" : "memory", timings });
  return host;
}

let labWorldArrives!: (data: unknown) => void;
const labWorldArrived = new Promise<unknown>(resolve => { labWorldArrives = resolve; });
let running: Promise<LocalHost | null> | null = null;
scope.addEventListener("message", (event: MessageEvent<LocalHostRequest>) => {
  const message = event.data;
  if (message.type === "start") {
    if (running) return;
    running = start(message).catch((error: unknown) => {
      const busy = (error as { code?: unknown } | null)?.code === "LOCAL_PLAY_BUSY";
      reply({ type: "failed", code: "UNAVAILABLE", message: busy ? "Local play is already open in another tab. Close that tab, then choose Play local again."
        : `Local play could not start: ${error instanceof Error ? error.message : String(error)}` });
      return null;
    });
    return;
  }
  if (message.type === "lab-world") { labWorldArrives(message.data); return; }
  void running?.then(async (host) => {
    if (!host) return;
    if (message.type === "connect") host.connect(message.port);
    else if (message.type === "catalog") reply({ type: "catalog", id: message.id, catalog: host.clientCatalog() });
    else if (message.type === "flush") { const ok = await host.flush().then(() => true, () => false); if (message.id !== undefined) reply({ type: "flushed", id: message.id, ok }); }
    else if (message.type === "close") { await host.close().catch(() => {}); reply({ type: "closed", id: message.id }); }
  });
});
