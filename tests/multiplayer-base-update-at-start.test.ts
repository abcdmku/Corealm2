import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { clientCatalog, serializeClientCatalog } from "../game/src/content/clientCatalog.js";
import type { InstalledCatalog } from "../game/src/content/catalogInstall.js";
import { seedCatalog } from "../game/src/multiplayer/catalogHost.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { repoBaseCatalog } from "../tools/lib/repoCatalog.js";
import { startServerProcess } from "./helpers/serverProcess.js";

/**
 * A server whose stored content predates the content format of the build it now runs, which is how
 * the test server stopped twice on 2026-09-25: once on a composition id the renderer no longer had
 * ("parts is not iterable"), once on `worldRegions[].settlement` becoming `settlements[]`
 * ("region.settlements is not iterable"). Neither store could reach the admin API that updates it.
 *
 * Each store is written the way an older build left it: seeded from an older base at 0.0.9, then an
 * admin publish on top. The build under test ships the repo's content as its base. The server runs
 * the authored world in a process of its own, because only a fresh process proves nothing loaded the
 * old tables. Started without `checkActiveContent`, these two stores stop in world assembly with
 * exactly the two messages above.
 */
type Sources = Record<string, any>;
type Row = Record<string, any>;
const OLD_VERSION = "0.0.9", ADMIN = "acc_AAAAAAAAAAAAAAAAAAAAAA", FROGS = "shared_t0_frog", WORMS = "shared_t0_red_worm";
/** The landmark and composition `cead9ae` removed, as the older base still had them. */
const STUMP = { id: "rootfall_stump", name: "The Oakwood Stump", position: [60, 120], assetId: "corealm_stump_oak", scale: 4, solid: false,
  originOnGround: true, composition: "rootfall_stump", blurb: "The stump is the square. Stone steps climb its southeast face." };

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
let bundled: Awaited<ReturnType<typeof repoBaseCatalog>>;
const directories: string[] = [];
beforeAll(async () => { bundled = await repoBaseCatalog(); });
afterAll(async () => {
  for (const directory of directories) {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("corealm-base-at-start-")) throw new Error("Unsafe test cleanup path");
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

const clone = <T>(value: T): T => structuredClone(value);
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const loot = (sources: Sources, id: string): Row => sources.lootTables.find((row: Row) => row.id === id);
const drop = (table: Row, itemId: string): Row => table.rolls[0].drops.find((entry: Row) => entry.itemId === itemId);
/** The old shape: at most one town per region, under `settlement`. */
function oldRegions(sources: Sources): Sources {
  return { ...sources, worldRegions: sources.worldRegions.map(({ settlements, ...region }: Row) => settlements.length ? { ...region, settlement: settlements[0] } : region) };
}
function withStump(sources: Sources): Sources {
  return { ...sources, worldRegions: sources.worldRegions.map((region: Row) => region.id === "vellenwood" ? { ...region, landmarks: [...region.landmarks, STUMP] } : region) };
}
/**
 * The catalog an older build compiled. This build cannot compile those sources, so it is this
 * build's catalog under their revision, with their regions: what matters is that the tables are not
 * this build's, as they were not on the test server.
 */
function oldCatalog(sources: Sources): InstalledCatalog {
  return { ...clone(bundled.catalog), revision: sha(sources), formulaRevision: "f".repeat(64),
    tables: { ...clone(bundled.catalog.tables), worldRegions: sources.worldRegions, world: { ...clone(bundled.catalog.tables.world as Row), regions: sources.worldRegions } } };
}

/** Seeds `ancestor` as base 0.0.9, then stores and activates `mine` as an admin publish would have. */
async function oldStore(ancestor: Sources, mine: Sources): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "corealm-base-at-start-"));
  directories.push(directory);
  const storage = new SqliteWorldStorage(join(directory, "worlds.sqlite"), { log: () => {} });
  await seedCatalog(storage.catalog, { version: OLD_VERSION, catalog: oldCatalog(ancestor), sources: ancestor }, () => {}, { now: () => 1000 });
  const base = (await storage.catalog.activeBase())!, published = oldCatalog(mine);
  await storage.catalog.store({ revision: published.revision, formulaRevision: published.formulaRevision, server: JSON.stringify(published),
    client: serializeClientCatalog(clientCatalog(published)), sources: JSON.stringify(mine), by: ADMIN, at: 2000, note: "Server loot edits", base });
  await storage.catalog.activate(published.revision, ADMIN, 2000);
  await storage.close();
  return directory;
}

async function read(directory: string) {
  const storage = new SqliteWorldStorage(join(directory, "worlds.sqlite"), { log: () => {} });
  try {
    const active = (await storage.catalog.sources())!;
    return { revision: active.revision, sources: JSON.parse(active.sources) as Sources, base: await storage.catalog.activeBase(),
      history: await storage.catalog.history(10), audit: await storage.admin.audit(10, null, { action: "content." }),
      holdsBundledBase: (await storage.catalog.baseSources(bundled.catalog.revision)) !== null };
  } finally { await storage.close(); }
}

function start(directory: string, ...flags: string[]) {
  const server = startServerProcess(["--development-guests", "--authored", "--port", "0", "--data", directory, ...flags]);
  cleanups.push(server.stop);
  return server;
}
const failure = (server: ReturnType<typeof start>) => String(server.lines.find(line => line.event === "start.failed")?.message ?? "");

describe("stored content from an older content format", () => {
  it.each([
    ["a list that replaced a field (settlement to settlements[])", (sources: Sources) => oldRegions(sources), /worldRegions\[0:fallowmarch\]\.settlements: missing required field/],
    ["a composition id this build removed (rootfall_stump)", (sources: Sources) => withStump(sources), /unknown composition reference "rootfall_stump"/],
  ])("refuses to start, before any world, on %s, and names the fix", async (_name, old, problem) => {
    const ancestor = old(clone(bundled.sources) as Sources);
    const directory = await oldStore(ancestor, ancestor), before = await read(directory);
    const server = start(directory);
    expect(await server.exited).toBe(1);
    expect(server.lines.some(line => line.ready === true || line.event === "world-pack")).toBe(false);
    const message = failure(server);
    expect(message).toMatch(/^The stored content predates this build's content format, so no world can run on it\./);
    expect(message).toContain(`derives from base ${OLD_VERSION}`);
    expect(message).toContain("run the server once with --apply-base-update");
    expect(message).toMatch(problem);
    // No crash from deep in world assembly, and nothing changed.
    expect(server.stderr()).not.toMatch(/is not iterable/);
    expect((await read(directory)).revision).toBe(before.revision);
  }, 120_000);

  it("updates from the bundled base with --apply-base-update, keeps the server's edits, and starts", async () => {
    const shipped = clone(bundled.sources) as Sources;
    // The older base: the old region shape, the stump, and a frog table the newer base changed since.
    const ancestor = withStump(oldRegions(clone(shipped)));
    drop(loot(ancestor, FROGS), "pale_quartz").chance = 0.05;
    // The server's own edits on top: a red worm table the base never touched, and the frog table the base changed too.
    const mine = clone(ancestor);
    drop(loot(mine, WORMS), "march_stone").chance = 0.25;
    drop(loot(mine, FROGS), "marsh_gland").quantity = [1, 3];
    const directory = await oldStore(ancestor, mine), before = await read(directory);

    // Without a decision for the frog table it lists the conflict, prints the flag that resolves it, and changes nothing.
    const undecided = start(directory, "--apply-base-update");
    expect(await undecided.exited).toBe(1);
    expect(undecided.lines.filter(line => line.event === "base-update.conflict").map(({ t, level, ...line }) => line))
      .toEqual([{ event: "base-update.conflict", collection: "lootTables", id: FROGS, kind: "both-changed", mineFields: ["rolls"], theirsFields: ["rolls"], decision: null }]);
    expect(undecided.lines.find(line => line.event === "base-update.decisions-needed")?.decisions).toEqual([{ collection: "lootTables", id: FROGS, take: "mine" }]);
    expect(failure(undecided)).toContain(`--apply-base-update --decisions '[{"collection":"lootTables","id":"${FROGS}","take":"mine"}]'`);
    expect(undecided.lines.some(line => line.ready === true)).toBe(false);
    expect(await read(directory)).toEqual(before);

    const server = start(directory, "--apply-base-update", "--decisions", JSON.stringify([{ collection: "lootTables", id: FROGS, take: "mine" }]));
    const ready = await server.ready;
    const applied = server.lines.find(line => line.event === "base-update.applied");
    // The database is the server's while it runs.
    await server.stop();
    const after = await read(directory);
    expect(ready.catalogRevision).toBe(after.revision);
    expect([ready.baseVersion, ready.bundledBaseVersion]).toEqual([bundled.version, bundled.version]);
    // Both server edits survived; the rest is the new base, in the new format, without the removed landmark.
    expect(loot(after.sources, WORMS)).toEqual(loot(mine, WORMS));
    expect(loot(after.sources, FROGS)).toEqual(loot(mine, FROGS));
    expect(after.sources.worldRegions).toEqual(shipped.worldRegions);
    expect(after.sources.worldRegions.every((region: Row) => Array.isArray(region.settlements) && !("settlement" in region))).toBe(true);
    // Recorded as an admin apply records it, by the offline update.
    expect(after.base).toEqual({ version: bundled.version, revision: bundled.catalog.revision });
    expect([before.holdsBundledBase, after.holdsBundledBase]).toEqual([false, true]);
    expect(after.history[0]).toMatchObject({ revision: after.revision, previous: before.revision, by: "offline-base-update", base: after.base });
    expect(after.audit[0]).toMatchObject({ accountId: null, credential: "offline-base-update", action: "content.base-update", target: after.revision,
      before: { revision: before.revision, baseVersion: OLD_VERSION }, after: { baseVersion: bundled.version, baseRevision: bundled.catalog.revision, decisions: { mine: 1, theirs: 0 } } });
    expect(applied).toMatchObject({ revision: after.revision, previous: before.revision, assetValidation: "bundled" });

    // From now on it is an ordinary start: nothing to update, nothing refused.
    const again = start(directory);
    expect((await again.ready).catalogRevision).toBe(after.revision);
    expect(again.lines.some(line => typeof line.event === "string" && line.event.startsWith("base-update"))).toBe(false);
  }, 240_000);
});
