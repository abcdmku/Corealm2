import { CATALOG_REVISION, serializeClientCatalog } from "../content/clientCatalog.js";
import { compileCatalog, type ContentSources } from "../content/compiler/catalog.js";
import { affectedCompiled, affectedSources, changedCollections, changedTables, staleCollections, type AffectedRecord } from "../content/compiler/changes.js";
import { collectionRevision } from "../content/compiler/revision.js";
import { CONTENT_COLLECTIONS } from "../content/compiler/collections.js";
import type { ContentDiagnostic } from "../content/compiler/contracts.js";
import { RESOLVED_CATALOG } from "../content/resolvedCatalog.js";
import type { CompiledWorld } from "../content/worldData.js";
import type { AdminActor, ServerAdminStorage } from "./adminStorage.js";
import { AssetManifestFailure, type AssetHost } from "./assetManifest.js";
import type { CatalogHost } from "./catalogHost.js";
import { CATALOG_TABLE_APPLIES, swapCatalog } from "./contentSwap.js";
import type { HeadlessWorld } from "./headlessWorld.js";
import { changedSpawnGroups, type SpawnPlan } from "./spawnPlan.js";

/**
 * Publishing content into a running server, and rolling it back.
 *
 * The order is what makes it safe. Everything that can refuse a publish runs first and changes
 * nothing: the revision check, the asset manifest, the compile, the search for live instances of a
 * removed definition, and the spawn plan of every world. Then the tick loop is held, the new catalog
 * is stored and made active with its audit row in one transaction, and the process is moved onto it
 * by assignments that cannot throw. A rollback is the same path fed an earlier revision's sources.
 */
export const MAX_PUBLISH_NOTE_CHARS = 512;
const MAX_LISTED = 1000;
const MAX_BLOCKERS = 20;

export class PublishFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: Record<string, unknown> = {}) { super(message); this.name = "PublishFailure"; }
}
export interface PublishRequest { base: string; collections: Record<string, { revision: string; value: unknown }>; note: string | null }
export interface PublishTimings { manifestMs: number; compileMs: number; blockersMs: number; spawnPlanMs: number; storeMs: number; swapMs: number; tickStallMs: number; totalMs: number }
export interface PublishResult {
  revision: string; previous: string; unchanged: boolean; stored: boolean;
  changedCollections: string[]; changedTables: string[];
  /**
   * The revision each changed collection now has, which is what the next publish will check a draft
   * against. Empty unless something was stored, so a validate and an unchanged publish move nothing.
   */
  revisions: Record<string, string>;
  /** Changed tables the running server now reads, and those it reads again only at its next start. */
  live: string[]; onRestart: string[];
  affected: Record<string, string[]>;
  problems: ContentDiagnostic[];
  assetValidation: AssetHost["source"];
  spawns: { world: string; added: number; pending: number; retiring: number; removed: number }[];
  notified: number;
  timings: PublishTimings;
}
export interface PublishPorts {
  catalog: CatalogHost;
  admin: ServerAdminStorage;
  assets: AssetHost;
  worlds(): readonly HeadlessWorld[];
  /** Runs `run` once no tick is in flight, and starts no tick until it settles. */
  betweenTicks<T>(run: () => Promise<T>): Promise<T>;
  /** Tell every connected peer in every world. Returns how many were told. */
  broadcast(message: { type: "content-updated"; revision: string }): number;
  /** Stop serving, as a failed commit does. A half-applied catalog must never tick. */
  failClosed(): void;
  now(): number;
  log(event: Record<string, unknown>): void;
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** The boundary: a publish or validate body, or a 400 that says what is wrong with it. */
export function publishRequest(body: Record<string, unknown>): PublishRequest {
  const invalid = (message: string) => new PublishFailure(400, "invalid_request", message);
  for (const key of Object.keys(body)) if (!["base", "collections", "note"].includes(key)) throw invalid(`Unknown field ${JSON.stringify(key)}`);
  if (typeof body.base !== "string" || !CATALOG_REVISION.test(body.base)) throw invalid("base is the catalog revision the edit started from");
  if (!record(body.collections) || !Object.keys(body.collections).length) throw invalid("collections names at least one collection");
  const collections: PublishRequest["collections"] = Object.create(null);
  for (const [name, entry] of Object.entries(body.collections)) {
    const spec = CONTENT_COLLECTIONS.find(candidate => candidate.name === name);
    if (!spec) throw invalid(`Unknown collection ${JSON.stringify(name)}`);
    if (!record(entry) || typeof entry.revision !== "string" || !CATALOG_REVISION.test(entry.revision) || Object.keys(entry).some(key => key !== "revision" && key !== "value"))
      throw invalid(`collections.${name} is {revision, value}`);
    if (spec.shape === "array" ? !Array.isArray(entry.value) : !record(entry.value)) throw invalid(`collections.${name}.value must be ${spec.shape === "array" ? "an array of records" : "an object"}`);
    collections[name] = { revision: entry.revision, value: entry.value };
  }
  if (body.note !== undefined && body.note !== null && (typeof body.note !== "string" || body.note.length > MAX_PUBLISH_NOTE_CHARS)) throw invalid(`note is at most ${MAX_PUBLISH_NOTE_CHARS} characters`);
  return { base: body.base, collections, note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null };
}

type Row = Record<string, unknown>;
const ids = (table: unknown): Set<string> => new Set((Array.isArray(table) ? table as Row[] : []).map(row => String(row.id)));
const removed = (before: unknown, after: unknown): string[] => { const kept = ids(after); return [...ids(before)].filter(id => !kept.has(id)); };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

export function createContentPublisher(ports: PublishPorts) {
  let queue: Promise<unknown> = Promise.resolve();
  /** One publish at a time, server-wide. A waiting publish checks its revisions against what the one before it left. */
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const next = queue.then(run, run);
    queue = next.catch(() => {});
    return next;
  }

  /** Definitions that would disappear while something still holds them. */
  async function blockers(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>[]> {
    const items = new Set(removed(before.items, after.items)), creatures = new Set(removed(before.compiledCreatures, after.compiledCreatures));
    const found: Record<string, unknown>[] = [];
    if (items.size) {
      for (const holder of await ports.admin.itemHolders([...items], MAX_BLOCKERS)) found.push({ kind: "item", id: holder.itemId, heldBy: "player", place: holder.place, accountId: holder.accountId, name: holder.name, ...(holder.world ? { world: holder.world.worldId } : {}) });
      // The stored row of an online player is one commit old. What they carry right now comes from their world.
      for (const world of ports.worlds()) for (const holder of world.itemHolders(items)) {
        if (holder.heldBy === "player" && found.some(entry => entry.accountId === holder.accountId && entry.id === holder.id && entry.place === holder.place)) continue;
        found.push({ kind: "item", ...holder, ...(holder.heldBy === "loot-pile" ? { world: world.descriptor.worldId } : {}) });
      }
    }
    if (creatures.size) for (const world of ports.worlds()) for (const [id, alive] of world.livingCreatures()) if (creatures.has(id))
      found.push({ kind: "creature", id, heldBy: "world", world: world.descriptor.worldId, alive });
    return found.slice(0, MAX_BLOCKERS);
  }

  async function apply({ sources, changed, affected }: Edit, actor: AdminActor | null, audit: { action: string; base: string | null; note: string | null }): Promise<PublishResult> {
    const started = performance.now(), previous = ports.catalog.revision, before = RESOLVED_CATALOG.tables as unknown as Record<string, unknown>;
    const timings: PublishTimings = { manifestMs: 0, compileMs: 0, blockersMs: 0, spawnPlanMs: 0, storeMs: 0, swapMs: 0, tickStallMs: 0, totalMs: 0 };
    let mark = performance.now();
    const pools = await ports.assets.pools(sources).catch(error => {
      if (error instanceof AssetManifestFailure) throw new PublishFailure(502, "asset_manifest_unavailable", error.message);
      throw error;
    });
    timings.manifestMs = performance.now() - mark;
    // The compile is about a tenth of a second on the full catalog. It runs between two ticks of the event loop, outside the tick hold.
    await tick(); mark = performance.now();
    const compiled = compileCatalog(sources, { formulaRevision: RESOLVED_CATALOG.formulaRevision, pools });
    timings.compileMs = performance.now() - mark;
    if (!compiled.ok) throw new PublishFailure(422, "content_invalid", "Content failed validation. Nothing was stored and the running catalog is unchanged.",
      { problems: compiled.problems.filter(problem => problem.severity === "error").slice(0, MAX_LISTED) });
    const { catalog, client } = compiled, after = catalog.tables, unchanged = catalog.revision === previous;
    const tables = changedTables(before, after);
    const result: PublishResult = { revision: catalog.revision, previous, unchanged, stored: false, changedCollections: changed, changedTables: tables, revisions: {},
      live: tables.filter(name => CATALOG_TABLE_APPLIES[name] === "live"), onRestart: tables.filter(name => CATALOG_TABLE_APPLIES[name] !== "live"),
      affected: {}, problems: compiled.problems.slice(0, MAX_LISTED), assetValidation: ports.assets.source, spawns: [], notified: 0, timings };
    for (const entry of [...affected, ...affectedCompiled(before, after, affected)]) { const list = result.affected[entry.collection] ??= []; if (list.length < MAX_LISTED) list.push(entry.id); }
    const spawnGroups = changedSpawnGroups(before.world as CompiledWorld, after.world as CompiledWorld);
    if (spawnGroups.regionIds.length) { result.affected.regions = spawnGroups.regionIds; result.affected.spawnGroups = [...spawnGroups.groupIds].sort().slice(0, MAX_LISTED); }
    await tick();
    const text = actor && !unchanged ? { server: JSON.stringify(catalog), client: serializeClientCatalog(client), sources: JSON.stringify(sources) } : null;

    const holdStarted = performance.now();
    await ports.betweenTicks(async () => {
      mark = performance.now();
      const held = await blockers(before, after);
      timings.blockersMs = performance.now() - mark;
      if (held.length) throw new PublishFailure(409, "definition_in_use",
        "This publish removes a definition that still has live instances. Mark it retired instead: a retired definition keeps resolving but no longer drops, spawns or sells.", { blockers: held });
      mark = performance.now();
      const plans: { world: HeadlessWorld; plan: SpawnPlan }[] = [];
      if (spawnGroups.groupIds.size) for (const world of ports.worlds()) {
        if (!world.ports.planSpawns) continue;
        try { plans.push({ world, plan: world.ports.planSpawns(after.world as CompiledWorld, spawnGroups.groupIds, world.entities.all()) }); }
        catch (error) { throw new PublishFailure(422, "spawn_unplaceable", error instanceof Error ? error.message : String(error), { world: world.descriptor.worldId }); }
      }
      timings.spawnPlanMs = performance.now() - mark;
      if (!text || !actor) return;

      mark = performance.now();
      const at = ports.now(), by = actor.accountId ?? actor.credential;
      result.stored = await ports.catalog.storage.store({ revision: catalog.revision, formulaRevision: catalog.formulaRevision, ...text, by, at, note: audit.note });
      // Only the collections that moved are hashed: together the sources run to megabytes.
      result.revisions = Object.fromEntries(changed.map(name => [name, collectionRevision((sources as Record<string, unknown>)[name])]));
      await ports.catalog.storage.activate(catalog.revision, by, at, { by: { ...actor, at }, entry: { action: audit.action, target: catalog.revision,
        before: { revision: previous }, after: { revision: catalog.revision, base: audit.base, note: audit.note, changedCollections: changed, changedTables: tables } } });
      timings.storeMs = performance.now() - mark;
      // The database has moved. From here to the end of the swap nothing may throw, and if it does the server stops rather than tick on half a catalog.
      mark = performance.now();
      try {
        swapCatalog(catalog, ports.worlds());
        ports.catalog.revision = catalog.revision;
        for (const { world, plan } of plans) result.spawns.push({ world: world.descriptor.worldId, ...world.applySpawns(plan) });
      } catch (error) {
        ports.failClosed();
        ports.log({ event: "content.swap_failed", revision: catalog.revision, message: error instanceof Error ? error.message : String(error) });
        throw new PublishFailure(500, "swap_failed", "The catalog was activated but the running server could not move onto it. The server has stopped; restart it to run the published catalog.");
      }
      timings.swapMs = performance.now() - mark;
      result.notified = ports.broadcast({ type: "content-updated", revision: catalog.revision });
    });
    timings.tickStallMs = performance.now() - holdStarted; timings.totalMs = performance.now() - started;
    if (text) {
      void ports.catalog.served(catalog.revision).catch(() => {});
      ports.log({ event: audit.action, revision: catalog.revision, previous, by: actor?.accountId ?? actor?.credential ?? null, changedTables: tables, notified: result.notified,
        timings: Object.fromEntries(Object.entries(timings).map(([name, ms]) => [name, Math.round(ms * 10) / 10])) });
    }
    return result;
  }

  /** Source collections to compile, and how they differ from the active ones. */
  interface Edit { sources: ContentSources; changed: string[]; affected: AffectedRecord[] }
  function edit(current: Record<string, unknown>, next: Record<string, unknown>): Edit {
    const before = new Map(Object.entries(current)), after = new Map(Object.entries(next)), changed = changedCollections(before, after);
    return { sources: next, changed: changed.map(spec => spec.name), affected: affectedSources(changed, before, after) };
  }
  async function merged(request: PublishRequest): Promise<Edit> {
    const active = await ports.catalog.storage.sources(ports.catalog.revision);
    const current = active ? JSON.parse(active.sources) as Record<string, unknown> : {};
    if (!Object.keys(current).length) throw new PublishFailure(409, "no_sources", "This server runs a catalog it holds no source collections for, so there is nothing to publish over.");
    // Only the collections that were sent are hashed. Together the sources run to megabytes.
    const revisions = Object.fromEntries(Object.keys(request.collections).map(name => [name, collectionRevision(current[name])]));
    const stale = staleCollections(Object.fromEntries(Object.entries(request.collections).map(([name, entry]) => [name, entry.revision])), revisions);
    if (stale.length) throw new PublishFailure(409, "stale_collections", "Content changed on the server since this edit began. Your draft has been preserved.",
      { stale, revisions: Object.fromEntries(stale.map(name => [name, revisions[name] ?? null])), revision: ports.catalog.revision });
    return edit(current, { ...current, ...Object.fromEntries(Object.entries(request.collections).map(([name, entry]) => [name, entry.value])) });
  }

  return {
    /** Everything a publish checks, and nothing it writes. */
    validate: (request: PublishRequest) => serial(async () => apply(await merged(request), null, { action: "content.validate", base: request.base, note: request.note })),
    publish: (request: PublishRequest, actor: AdminActor) => serial(async () => apply(await merged(request), actor, { action: "content.publish", base: request.base, note: request.note })),
    /** A publish of an earlier revision's sources, through every check a publish passes. */
    rollback: (revision: string, actor: AdminActor) => serial(async () => {
      const stored = await ports.catalog.storage.sources(revision);
      if (!stored) throw new PublishFailure(404, "not_found", "No catalog with that revision is stored");
      if (revision === ports.catalog.revision) throw new PublishFailure(409, "already_active", "That revision is already the active catalog");
      const sources = JSON.parse(stored.sources) as Record<string, unknown>;
      if (!Object.keys(sources).length) throw new PublishFailure(409, "no_sources", "That revision was stored without its source collections, so it cannot be compiled again.");
      const current = JSON.parse((await ports.catalog.storage.sources(ports.catalog.revision))?.sources ?? "{}") as Record<string, unknown>;
      return apply(edit(current, sources), actor, { action: "content.rollback", base: revision, note: `Rolled back to ${revision}` });
    }),
  };
}
export type ContentPublisher = ReturnType<typeof createContentPublisher>;
