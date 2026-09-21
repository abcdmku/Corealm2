import { afterEach, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { compileCatalog } from "../game/src/content/compiler/catalog.js";
import { seedCatalog } from "../game/src/multiplayer/catalogHost.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { WebSocketProvider, type WebSocketSession } from "../game/src/multiplayer/webSocketProvider.js";
import { compileContent, formulaSourceRevision, readContentSources } from "../tools/content/compile.js";
import { repoRoot } from "../tools/lib/paths.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** The content modules read their tables as they load, so only a fresh process can prove which catalog a server runs on. */
function startServer(data: string) {
  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", "tools/multiplayer-server.ts", "--development-guests", "--port", "0", "--data", data],
    { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  const lines: Record<string, unknown>[] = []; let pending = "", errors = "";
  child.stderr!.on("data", chunk => { errors += String(chunk); });
  child.stdout!.on("data", chunk => {
    pending += String(chunk); const parts = pending.split("\n"); pending = parts.pop()!;
    for (const part of parts) try { lines.push(JSON.parse(part)); } catch { /* not a log line */ }
  });
  const exited = new Promise<number | null>(done => child.once("exit", done));
  cleanups.push(async () => { if (child.exitCode === null) { if (child.connected) child.send({ type: "shutdown" }); else child.kill(); await exited; } });
  const ready = new Promise<Record<string, unknown>>((done, fail) => {
    const poll = setInterval(() => { const line = lines.find(entry => entry.ready === true); if (line) { clearInterval(poll); done(line); } }, 20);
    void exited.then(code => { clearInterval(poll); fail(new Error(`The server exited with code ${code} before it was ready\n${errors}`)); });
  });
  return { lines, ready };
}

it("boots on the database's catalog, not the one the build ships, and tells clients its revision", async () => {
  const directory = await mkdtemp(join(tmpdir(), "corealm-catalog-boot-"));
  cleanups.push(async () => {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("corealm-catalog-boot-")) throw new Error("Unsafe test cleanup path");
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  // A server that has been live: its database holds a catalog an admin edited, which no repo has.
  const values = await readContentSources(), shipped = compileContent(values);
  const sources = Object.fromEntries(values) as Record<string, { id: string; name: string }[]>;
  expect(sources.resources!.find(row => row.id === "ore_grithe")!.name).toBe("Copper Seam");
  const edited = { ...sources, resources: sources.resources!.map(row => row.id === "ore_grithe" ? { ...row, name: "Verdigris Seam" } : row) };
  const published = compileCatalog(edited, { formulaRevision: formulaSourceRevision() });
  if (!published.ok) throw new Error(JSON.stringify(published.problems));
  expect(published.catalog.revision).not.toBe(shipped.revision);
  const storage = new SqliteWorldStorage(join(directory, "worlds.sqlite"), { log: () => {} });
  await seedCatalog(storage.catalog, { catalog: published.catalog, sources: edited }, () => {});
  await storage.close();

  const server = startServer(directory), ready = await server.ready, revision = published.catalog.revision;
  expect(ready.catalogRevision).toBe(revision);
  // Every line the host writes is `{t, level, event, …}`. `t` is a clock, so the rest is what is asserted.
  expect(server.lines.filter(line => typeof line.event === "string" && line.event.startsWith("catalog-")).map(({ t, ...rest }) => rest))
    .toEqual([{ level: "warn", event: "catalog-base-ignored",
      activeRevision: revision, bundledRevision: shipped.revision, message: "This database already has a catalog, so the catalog shipped with this server was not applied." }]);

  const port = Number(ready.port);
  const listed = await (await fetch(`http://127.0.0.1:${port}/worlds`)).json() as WorldDescriptor[];
  expect(listed.map(world => world.catalogRevision)).toEqual([revision]);
  // The simulation itself runs on the edited tables: the lab's ore node is named from the resource definition.
  const world: WorldDescriptor = { providerId: "reference", worldId: "yard", name: "yard", endpoint: `ws://127.0.0.1:${port}/`, protocolVersion: WORLD_PROTOCOL_VERSION,
    fixture: "lab", seed: 1337, population: 0, capacity: 64, availability: "available" };
  const provider = new WebSocketProvider("reference", [world], async () => ({ token: "guest:alice" }));
  const session = await provider.connect(world, { token: "guest:alice" }) as WebSocketSession; cleanups.push(() => session.close());
  expect(session.catalog.revision).toBe(revision);
  expect(session.state.entities.get("multiplayer:ore")!.name).toBe("Verdigris Seam");
  const client = await (await fetch(session.catalog.url)).json() as { revision: string; tables: { resources: { id: string; name: string }[] } };
  expect([client.revision, client.tables.resources.find(row => row.id === "ore_grithe")!.name]).toEqual([revision, "Verdigris Seam"]);
}, 120_000);

it("throws when a catalog is installed after the content modules have loaded", () => {
  const script = `
    const { installCatalog } = await import("./game/src/content/catalogInstall.ts");
    // The repo's catalog, the way every tool and harness gets one. Without it the import below
    // throws for the other reason, and this case would stop covering the late-install guard.
    await import("./game/src/content/bundledCatalog.ts");
    const { RESOLVED_CATALOG } = await import("./game/src/content/resolvedCatalog.ts");
    try { installCatalog({ ...RESOLVED_CATALOG, revision: "${"a".repeat(64)}" }); console.log("installed"); }
    catch (error) { console.log(error.message); }`;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: repoRoot, encoding: "utf8", windowsHide: true });
  expect(result.stdout.trim()).toBe("installCatalog ran after the content modules were evaluated. Install the catalog first, then import() the server.");
}, 60_000);
