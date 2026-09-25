import { afterEach, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
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
import { repoBaseVersion } from "../tools/lib/baseVersion.js";
import { startServerProcess } from "./helpers/serverProcess.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function startServer(data: string) {
  const server = startServerProcess(["--development-guests", "--port", "0", "--data", data]);
  cleanups.push(server.stop);
  return server;
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
  await seedCatalog(storage.catalog, { version: "0.0.9", catalog: published.catalog, sources: edited }, () => {});
  await storage.close();

  const server = startServer(directory), ready = await server.ready, revision = published.catalog.revision;
  expect(ready.catalogRevision).toBe(revision);
  // Every line the host writes is `{t, level, event, …}`. `t` is a clock, so the rest is what is asserted.
  // The shipped base is not the one this content derives from, so the host says an update is there to take, and changes nothing.
  expect(server.lines.filter(line => typeof line.event === "string" && (line.event.startsWith("catalog-") || line.event.startsWith("base-"))).map(({ t, ...rest }) => rest))
    .toEqual([{ level: "info", event: "base-update-available", current: { version: "0.0.9", revision }, bundled: { version: repoBaseVersion(), revision: shipped.revision },
      message: "This server ships a different base game than its content derives from. Nothing was changed. Open devdocs, Server, Base game to preview the update and apply it, or restart the server with --apply-base-update." }]);
  expect([ready.baseVersion, ready.bundledBaseVersion]).toEqual(["0.0.9", repoBaseVersion()]);

  const port = Number(ready.port);
  const listed = await (await fetch(`http://127.0.0.1:${port}/worlds`)).json() as WorldDescriptor[];
  expect(listed.map(world => [world.catalogRevision, world.baseVersion])).toEqual([[revision, "0.0.9"]]);
  // The simulation itself runs on the edited tables: the lab's ore node is named from the resource definition.
  const world: WorldDescriptor = { providerId: "reference", worldId: "yard", name: "yard", endpoint: `ws://127.0.0.1:${port}/`, protocolVersion: WORLD_PROTOCOL_VERSION,
    fixture: "lab", seed: 1337, population: 0, capacity: 64, availability: "available" };
  const provider = new WebSocketProvider("reference", [world], async () => ({ token: "guest:alice" }));
  const session = await provider.connect(world, { token: "guest:alice" }) as WebSocketSession; cleanups.push(() => session.close());
  expect(session.catalog.revision).toBe(revision);
  expect(session.state.entities.get("multiplayer:ore")!.name).toBe("Verdigris Seam");
  const client = await session.catalog.load() as unknown as { revision: string; tables: { resources: { id: string; name: string }[] } };
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
