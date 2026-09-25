import { CATALOG_REVISION, serializeClientCatalog } from "../content/clientCatalog.js";
import { compileCatalog, type ContentSources } from "../content/compiler/catalog.js";
import { affectedCompiled, affectedSources, changedCollections, changedSpawnGroups, changedTables, staleCollections, type AffectedRecord } from "../content/compiler/changes.js";
import { collectionRevision } from "../content/compiler/revision.js";
import { CONTENT_COLLECTIONS } from "../content/compiler/collections.js";
import type { ContentDiagnostic } from "../content/compiler/contracts.js";
import type { CompiledWorld } from "../content/worldData.js";
import type { AdminActor, ServerAdminStorage } from "./adminStorage.js";
import { AssetManifestFailure, type AssetHost } from "./assetManifest.js";
import { baseMarkerOf, CATALOG_TABLE_APPLIES, type BaseCatalog, type CatalogHost } from "./catalogHost.js";
import type { BaseMarker, BaseWrite } from "./catalogStorage.js";
import { mergeBase, BaseDecisionError, type BaseConflict, type BaseDecision, type BaseMergeCounts } from "../content/compiler/baseMerge.js";
import { sameContent } from "../content/compiler/canonical.js";
import { compareSemver } from "./semver.js";
import { HoldFailure, type HostControl, type PublishCheck } from "./hostControl.js";

/**
 * Publishing content into a running server, and rolling it back.
 *
 * The order is what makes it safe. Everything that can refuse a publish runs first and changes
 * nothing: the revision check, the asset manifest, the compile, the search for live instances of a
 * removed definition, and the spawn plan of every world. Then the tick loop is held, the new catalog
 * is stored and made active with its audit row in one transaction, and the process is moved onto it
 * by assignments that cannot throw. A rollback is the same path fed an earlier revision's sources.
 *
 * The worlds are reached through `HostControl`, because with a thread per world each world has its
 * own content registry: the compiled catalog is staged in every world before the hold, each world
 * plans its own spawns inside it, and after the database has moved each world swaps itself.
 *
 * This module loads no content table: what it compares against comes from `PublishPorts.running`.
 * So a base update can also run at start, before any catalog is installed or any world is built,
 * through exactly this path: see `contentAtStart.ts`.
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
  /** The base the result derives from: the active one for a publish, the new one for a base update, the target's for a rollback. */
  base: BaseMarker | null;
}
export interface PublishPorts {
  catalog: CatalogHost;
  admin: ServerAdminStorage;
  assets: AssetHost;
  /** The running worlds: the tick hold, who holds what, the swap and the broadcast. A failed swap fails it closed, because a half-applied catalog must never tick. */
  host: PublishHost;
  /**
   * The compiled catalog the worlds run now: what a publish is compared against, for the tables it
   * changes and the definitions it removes, and whose formulas an ordinary publish compiles with.
   */
  running(): { tables: Readonly<Record<string, unknown>>; formulaRevision: string };
  /** The base game this process ships with: what an update from base merges in. Null offers no update. */
  bundled?: BaseCatalog | null;
  now(): number;
  log(event: Record<string, unknown>): void;
}

/** What a publish asks of the worlds. A running server's `HostControl` is one; `contentAtStart.ts` has one for a server with no world yet. */
export type PublishHost = Pick<HostControl, "betweenTicks" | "broadcast" | "failClosed" | "configure" | "publishStage" | "publishCheck" | "publishCommit" | "publishAbort">;

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
  async function blockers(items: readonly string[], creatures: ReadonlySet<string>, live: PublishCheck["worlds"]): Promise<Record<string, unknown>[]> {
    const found: Record<string, unknown>[] = [];
    if (items.length) {
      for (const holder of await ports.admin.itemHolders([...items], MAX_BLOCKERS)) found.push({ kind: "item", id: holder.itemId, heldBy: "player", place: holder.place, accountId: holder.accountId, name: holder.name, ...(holder.world ? { world: holder.world.worldId } : {}) });
      // The stored row of an online player is one commit old. What they carry right now comes from their world.
      for (const world of live) for (const holder of world.holders) {
        if (holder.heldBy === "player" && found.some(entry => entry.accountId === holder.accountId && entry.id === holder.id && entry.place === holder.place)) continue;
        found.push({ kind: "item", ...holder, ...(holder.heldBy === "loot-pile" ? { world: world.worldId } : {}) });
      }
    }
    if (creatures.size) for (const world of live) for (const [id, alive] of world.creatures) if (creatures.has(id))
      found.push({ kind: "creature", id, heldBy: "world", world: world.worldId, alive });
    return found.slice(0, MAX_BLOCKERS);
  }

  /**
   * Where a result comes from, besides its sources. `base` is the base it records: the active one for
   * an ordinary publish, the target's for a rollback, the new one for a base update, which also
   * stores that base's sources (`baseWrite`) and compiles with the bundled base's `formulaRevision`,
   * so a server with no edits of its own lands on the bundled revision exactly. A base update also
   * moves when only the base changes: the same content now derives from the new base.
   */
  interface Lineage { base: BaseMarker | null; formulaRevision?: string; baseWrite?: Omit<BaseWrite, "at">; audit?: { before?: Record<string, unknown>; after?: Record<string, unknown> } }
  const inherited = (): Lineage => ({ base: ports.catalog.base });

  async function apply({ sources, changed, affected }: Edit, actor: AdminActor | null, audit: { action: string; base: string | null; note: string | null }, lineage: Lineage = inherited()): Promise<PublishResult> {
    const started = performance.now(), previous = ports.catalog.revision, running = ports.running(), before = running.tables;
    const timings: PublishTimings = { manifestMs: 0, compileMs: 0, blockersMs: 0, spawnPlanMs: 0, storeMs: 0, swapMs: 0, tickStallMs: 0, totalMs: 0 };
    let mark = performance.now();
    const pools = await ports.assets.pools(sources).catch(error => {
      if (error instanceof AssetManifestFailure) throw new PublishFailure(502, "asset_manifest_unavailable", error.message);
      throw error;
    });
    timings.manifestMs = performance.now() - mark;
    // The compile is about a tenth of a second on the full catalog. It runs between two ticks of the event loop, outside the tick hold.
    await tick(); mark = performance.now();
    const compiled = compileCatalog(sources, { formulaRevision: lineage.formulaRevision ?? running.formulaRevision, pools });
    timings.compileMs = performance.now() - mark;
    if (!compiled.ok) throw new PublishFailure(422, "content_invalid", "Content failed validation. Nothing was stored and the running catalog is unchanged.",
      { problems: compiled.problems.filter(problem => problem.severity === "error").slice(0, MAX_LISTED) });
    const { catalog, client } = compiled, after = catalog.tables, unchanged = catalog.revision === previous;
    const current = ports.catalog.base, rebased = lineage.base !== null && (current === null || current.version !== lineage.base.version || current.revision !== lineage.base.revision);
    const tables = changedTables(before, after);
    const result: PublishResult = { revision: catalog.revision, previous, unchanged, stored: false, changedCollections: changed, changedTables: tables, revisions: {},
      live: tables.filter(name => CATALOG_TABLE_APPLIES[name] === "live"), onRestart: tables.filter(name => CATALOG_TABLE_APPLIES[name] !== "live"),
      affected: {}, problems: compiled.problems.slice(0, MAX_LISTED), assetValidation: ports.assets.source, spawns: [], notified: 0, timings, base: lineage.base };
    for (const entry of [...affected, ...affectedCompiled(before, after, affected)]) { const list = result.affected[entry.collection] ??= []; if (list.length < MAX_LISTED) list.push(entry.id); }
    const spawnGroups = changedSpawnGroups(before.world as CompiledWorld, after.world as CompiledWorld);
    if (spawnGroups.regionIds.length) { result.affected.regions = spawnGroups.regionIds; result.affected.spawnGroups = [...spawnGroups.groupIds].sort().slice(0, MAX_LISTED); }
    await tick();
    const text = actor && !unchanged ? { server: JSON.stringify(catalog), client: serializeClientCatalog(client), sources: JSON.stringify(sources) } : null;
    // Content that compiles to the active revision still moves when its base does: the same catalog now derives from the new base.
    const rebaseOnly = actor !== null && unchanged && rebased && lineage.baseWrite !== undefined;

    const removedItems = removed(before.items, after.items), removedCreatures = new Set(removed(before.compiledCreatures, after.compiledCreatures));
    // Each world is handed the compiled catalog now, so the hold moves no megabytes between threads.
    await ports.host.publishStage(catalog);
    const holdStarted = performance.now();
    let moved = false;
    await ports.host.betweenTicks(async () => {
      mark = performance.now();
      // One question to every world: who holds a removed definition, and can the changed spawn groups be placed. Each world keeps its plan.
      const check = await ports.host.publishCheck(removedItems, [...spawnGroups.groupIds]);
      const held = await blockers(removedItems, removedCreatures, check.worlds);
      timings.spawnPlanMs = check.planMs; timings.blockersMs = performance.now() - mark - check.planMs;
      if (held.length) throw new PublishFailure(409, "definition_in_use",
        "This publish removes a definition that still has live instances. Mark it retired instead: a retired definition keeps resolving but no longer drops, spawns or sells.", { blockers: held });
      if (check.unplaceable) throw new PublishFailure(422, "spawn_unplaceable", check.unplaceable.message, { world: check.unplaceable.worldId });
      if (!actor || (!text && !rebaseOnly)) return;

      mark = performance.now();
      const at = ports.now(), by = actor.accountId ?? actor.credential;
      const base = lineage.base ?? { version: "0.0.0", revision: catalog.revision };
      // A base's sources are kept once per base revision. Written before the move, so the move never names a base the server cannot merge against.
      if (lineage.baseWrite) await ports.catalog.storage.storeBase({ ...lineage.baseWrite, at });
      if (text) result.stored = await ports.catalog.storage.store({ revision: catalog.revision, formulaRevision: catalog.formulaRevision, ...text, by, at, note: audit.note, base });
      // Only the collections that moved are hashed: together the sources run to megabytes.
      if (text) result.revisions = Object.fromEntries(changed.map(name => [name, collectionRevision((sources as Record<string, unknown>)[name])]));
      await ports.catalog.storage.activate(catalog.revision, by, at, { by: { ...actor, at }, entry: { action: audit.action, target: catalog.revision,
        before: { revision: previous, ...lineage.audit?.before }, after: { revision: catalog.revision, base: audit.base, note: audit.note, changedCollections: changed, changedTables: tables, ...lineage.audit?.after } } }, base);
      ports.catalog.base = base;
      timings.storeMs = performance.now() - mark;
      if (!text) return;
      // The database has moved. From here to the end of the swap nothing may throw, and if it does the server stops rather than tick on half a catalog.
      mark = performance.now(); moved = true;
      try {
        result.spawns.push(...await ports.host.publishCommit());
        ports.catalog.revision = catalog.revision;
      } catch (error) {
        ports.host.failClosed();
        ports.log({ event: "content.swap_failed", revision: catalog.revision, message: error instanceof Error ? error.message : String(error) });
        throw new PublishFailure(500, "swap_failed", "The catalog was activated but the running server could not move onto it. The server has stopped; restart it to run the published catalog.");
      }
      timings.swapMs = performance.now() - mark;
      result.notified = await ports.host.broadcast({ type: "content-updated", revision: catalog.revision });
    }).catch(error => {
      if (error instanceof HoldFailure) throw new PublishFailure(503, "unavailable", `The running worlds could not be held, so nothing was published. ${error.message}`);
      throw error;
    }).finally(() => moved ? undefined : ports.host.publishAbort().catch(() => {}));
    timings.tickStallMs = performance.now() - holdStarted; timings.totalMs = performance.now() - started;
    if (text || rebaseOnly) {
      if (text) void ports.catalog.served(catalog.revision).catch(() => {});
      // What `/worlds` and the `joined` reply say this server's content comes from.
      if (rebased) await ports.host.configure({ baseVersion: lineage.base!.version });
      ports.log({ event: audit.action, revision: catalog.revision, previous, by: actor?.accountId ?? actor?.credential ?? null, changedTables: tables, notified: result.notified,
        ...(rebased ? { baseVersion: lineage.base!.version, baseRevision: lineage.base!.revision } : {}),
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

  /** Whether the active sources differ from their base, for the last pair asked about. Comparing parses megabytes. */
  let modified: { key: string; value: boolean | null } | null = null;

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
      // The target's own base comes back with it: a rollback past a base update is a rollback of the base too.
      const recorded = (await ports.catalog.storage.revisionInfo(revision))?.base ?? ports.catalog.base;
      return apply(edit(current, sources), actor, { action: "content.rollback", base: revision, note: `Rolled back to ${revision}` }, { base: recorded });
    }),
    /** Where this server's content comes from, and what the executable it runs on ships. Reads only. */
    baseStatus,
    /** The bundled base's source collections as JSON text, or null when the server has none. */
    bundledSources: async (): Promise<string | null> => ports.bundled ? JSON.stringify(ports.bundled.sources) : null,
    /** The merge a base update would make, and every check its publish would run. Stores nothing. */
    basePreview: (request: BasePreviewRequest) => serial(async () => {
      const plan = await basePlan(request.allowDowngrade);
      const result = decided(() => mergeBase(plan.inputs, request.decisions));
      const changes = edit(plan.mine, result.merged);
      let validation: BasePreview["validation"] = null;
      if (result.decisionsNeeded === 0) {
        try { validation = { ok: true, result: await apply(changes, null, { action: "content.validate", base: ports.catalog.revision, note: null }, plan.lineage) }; }
        catch (error) {
          // The answer `/admin/content/validate` would have given. Only a server that cannot hold its worlds fails the preview itself.
          if (!(error instanceof PublishFailure) || error.code === "unavailable" || error.status === 500) throw error;
          validation = { ok: false, status: error.status, error: { code: error.code, message: error.message, ...error.details } };
        }
      }
      const ok = validation?.ok ? validation.result : null;
      const affected: Record<string, string[]> = {};
      if (ok) Object.assign(affected, ok.affected);
      else for (const entry of changes.affected) { const list = affected[entry.collection] ??= []; if (list.length < MAX_LISTED) list.push(entry.id); }
      return { base: { from: plan.current, to: plan.bundled }, direction: plan.direction, expect: { activeRevision: ports.catalog.revision, bundledRevision: plan.bundled.revision },
        summary: result.summary, ...listedConflicts(result.conflicts), decisionsNeeded: result.decisionsNeeded, validation,
        changedCollections: changes.changed, affected, live: ok ? ok.live : null, onRestart: ok ? ok.onRestart : null } satisfies BasePreview;
    }),
    /**
     * The base update itself. The merge is computed here again from the three stored sources; a
     * client sends only its decisions, never merged content. Then it is a publish like any other.
     */
    baseApply: (request: BaseApplyRequest, actor: AdminActor) => serial(async () => {
      const plan = await basePlan(request.allowDowngrade);
      if (request.expect.activeRevision !== ports.catalog.revision || request.expect.bundledRevision !== plan.bundled.revision)
        throw new PublishFailure(409, "stale_base", "The server's content or its bundled base changed since this update was previewed. Preview it again.",
          { activeRevision: ports.catalog.revision, bundledRevision: plan.bundled.revision });
      const result = decided(() => mergeBase(plan.inputs, request.decisions));
      const open = result.conflicts.filter(conflict => conflict.decision === null);
      if (open.length) throw new PublishFailure(409, "decisions_needed", `${open.length} conflict${open.length === 1 ? " needs" : "s need"} a decision before this update can be applied.`,
        { missing: open.slice(0, MAX_LISTED).map(({ collection, id }) => ({ collection, id })), missingTotal: open.length });
      const taken = { mine: result.conflicts.filter(conflict => conflict.decision === "mine").length, theirs: result.conflicts.filter(conflict => conflict.decision === "theirs").length };
      const published = await apply(edit(plan.mine, result.merged), actor, { action: "content.base-update", base: ports.catalog.revision, note: request.note },
        { ...plan.lineage, audit: { before: { baseVersion: plan.current.version, baseRevision: plan.current.revision },
          after: { baseVersion: plan.bundled.version, baseRevision: plan.bundled.revision, decisions: taken } } });
      return { ...published, baseUpdate: { from: plan.current, to: plan.bundled, direction: plan.direction, summary: result.summary, decisions: taken } };
    }),
  };

  /** Where the content comes from against what this executable ships, or null parts when either is unknown. */
  async function baseStatus(): Promise<BaseStatus> {
    const current = ports.catalog.base, bundled = ports.bundled ? baseMarkerOf(ports.bundled) : null;
    const direction = baseDirection(current, bundled);
    let serverModified: boolean | null = null;
    if (current) {
      const key = `${ports.catalog.revision}\n${current.revision}`;
      if (modified?.key !== key) {
        const [active, base] = await Promise.all([ports.catalog.storage.sources(ports.catalog.revision), ports.catalog.storage.baseSources(current.revision)]);
        modified = { key, value: active && base !== null ? !sameContent(JSON.parse(active.sources), JSON.parse(base)) : null };
      }
      serverModified = modified.value;
    }
    return { current, bundled, updateAvailable: direction === "newer" || direction === "different-content-same-version", direction, serverModified };
  }

  /** The three sides of the merge and the lineage its publish records, or the reason there is nothing to merge. */
  async function basePlan(allowDowngrade: boolean) {
    const bundledBase = ports.bundled;
    if (!bundledBase) throw new PublishFailure(409, "no_bundled_base", "This server was started without a bundled base game, so there is nothing to update from.");
    const current = ports.catalog.base, bundled = baseMarkerOf(bundledBase), direction = baseDirection(current, bundled);
    if (!current || !direction) throw new PublishFailure(409, "no_base", "This server's content records no base game, so there is nothing to merge against.");
    if (direction === "same") throw new PublishFailure(409, "no_update", `This server's content already derives from base ${bundled.version}, the base it ships with.`);
    if (direction === "older" && !allowDowngrade) throw new PublishFailure(409, "downgrade_refused",
      `The bundled base ${bundled.version} is older than ${current.version}, the base this server's content derives from. Send allowDowngrade: true to take it anyway; that is a recovery tool.`);
    const [active, ancestorText] = await Promise.all([ports.catalog.storage.sources(ports.catalog.revision), ports.catalog.storage.baseSources(current.revision)]);
    const mine = active ? JSON.parse(active.sources) as Record<string, unknown> : {};
    if (!Object.keys(mine).length) throw new PublishFailure(409, "no_sources", "This server runs a catalog it holds no source collections for, so there is nothing to merge.");
    if (ancestorText === null) throw new PublishFailure(409, "no_base_sources", `This server does not hold the sources of base ${current.version}, so it cannot tell its own edits from the base's.`);
    const lineage: Lineage = { base: bundled, formulaRevision: bundledBase.catalog.formulaRevision,
      baseWrite: { revision: bundled.revision, version: bundled.version, sources: JSON.stringify(bundledBase.sources) } };
    return { current, bundled, direction, mine, lineage, inputs: { ancestor: JSON.parse(ancestorText) as Record<string, unknown>, theirs: bundledBase.sources, mine } };
  }
}

export type ContentPublisher = ReturnType<typeof createContentPublisher>;

/** Newer, older, the same base, or other content under the same version, which a release should never ship but a developer can. */
export type BaseDirection = "newer" | "older" | "same" | "different-content-same-version";
export interface BaseStatus {
  current: BaseMarker | null; bundled: BaseMarker | null;
  /** A newer bundled base, or other content under the same version. An older one is reported and needs `allowDowngrade`. */
  updateAvailable: boolean;
  direction: BaseDirection | null;
  /** The active sources differ from the sources of the base they derive from. Null when that base's sources are not held. */
  serverModified: boolean | null;
}
export function baseDirection(current: BaseMarker | null, bundled: BaseMarker | null): BaseDirection | null {
  if (!current || !bundled) return null;
  const order = compareSemver(bundled.version, current.version);
  return order > 0 ? "newer" : order < 0 ? "older" : bundled.revision === current.revision ? "same" : "different-content-same-version";
}

export const MAX_BASE_DECISIONS = 20_000;
/** Record bodies in a preview stop here, per record and together. Past either a conflict keeps its fields and loses its bodies. */
export const MAX_CONFLICT_RECORD_BYTES = 64 * 1024;
export const MAX_CONFLICT_BODY_BYTES = 4 * 1024 * 1024;
const MAX_CONFLICT_FIELDS = 64;
export interface BasePreviewRequest { decisions: BaseDecision[]; allowDowngrade: boolean }
export interface BaseApplyRequest extends BasePreviewRequest { expect: { activeRevision: string; bundledRevision: string }; note: string | null }
export type ListedConflict = BaseConflict & { truncated?: true };
export interface BasePreview {
  base: { from: BaseMarker; to: BaseMarker }; direction: BaseDirection;
  /** What `apply` must send back as `expect`. */
  expect: { activeRevision: string; bundledRevision: string };
  summary: Record<string, BaseMergeCounts>;
  conflicts: ListedConflict[]; conflictsTotal: number; bodiesTruncated: boolean;
  decisionsNeeded: number;
  /** Null while a conflict has no decision. Otherwise what `/admin/content/validate` answers for the merged content. */
  validation: null | { ok: true; result: PublishResult } | { ok: false; status: number; error: Record<string, unknown> };
  changedCollections: string[]; affected: Record<string, string[]>;
  /** From the compile, so null until validation ran and passed. */
  live: string[] | null; onRestart: string[] | null;
}

function decided<T>(run: () => T): T {
  try { return run(); }
  catch (error) {
    if (!(error instanceof BaseDecisionError)) throw error;
    throw new PublishFailure(400, "invalid_decisions", `${error.message}. Decide each conflict the preview lists, once.`, { unknown: error.unknown.slice(0, MAX_LISTED) });
  }
}

/** Every conflict, with its record bodies until they pass the caps. A client can always read whole records from the sources endpoints. */
function listedConflicts(conflicts: readonly BaseConflict[]): { conflicts: ListedConflict[]; conflictsTotal: number; bodiesTruncated: boolean } {
  let spent = 0, bodiesTruncated = false;
  const size = (value: unknown) => value === null ? 4 : JSON.stringify(value).length;
  const listed = conflicts.map((conflict): ListedConflict => {
    const fields = { mineFields: conflict.mineFields.slice(0, MAX_CONFLICT_FIELDS), theirsFields: conflict.theirsFields.slice(0, MAX_CONFLICT_FIELDS) };
    const sizes = [size(conflict.ancestor), size(conflict.mine), size(conflict.theirs)], total = sizes[0]! + sizes[1]! + sizes[2]!;
    if (sizes.some(bytes => bytes > MAX_CONFLICT_RECORD_BYTES) || spent + total > MAX_CONFLICT_BODY_BYTES) {
      bodiesTruncated = true;
      return { ...conflict, ...fields, ancestor: null, mine: null, theirs: null, truncated: true };
    }
    spent += total;
    return { ...conflict, ...fields };
  });
  return { conflicts: listed, conflictsTotal: conflicts.length, bodiesTruncated };
}

/** The boundary for both base endpoints. `apply` also needs `expect` and takes a note. */
export function baseRequest(body: Record<string, unknown>, kind: "preview" | "apply"): BasePreviewRequest | BaseApplyRequest {
  const invalid = (message: string) => new PublishFailure(400, "invalid_request", message);
  const keys = kind === "preview" ? ["decisions", "allowDowngrade"] : ["expect", "decisions", "note", "allowDowngrade"];
  for (const key of Object.keys(body)) if (!keys.includes(key)) throw invalid(`Unknown field ${JSON.stringify(key)}`);
  if (body.allowDowngrade !== undefined && typeof body.allowDowngrade !== "boolean") throw invalid("allowDowngrade is true or false");
  const list = body.decisions ?? [];
  if (!Array.isArray(list) || list.length > MAX_BASE_DECISIONS) throw invalid(`decisions is a list of at most ${MAX_BASE_DECISIONS}`);
  const collections = new Set(CONTENT_COLLECTIONS.map(spec => spec.name));
  const decisions = list.map((entry, index): BaseDecision => {
    if (!record(entry) || Object.keys(entry).some(key => !["collection", "id", "take"].includes(key)) || typeof entry.collection !== "string" || !collections.has(entry.collection)
      || typeof entry.id !== "string" || !entry.id || entry.id.length > 256 || (entry.take !== "mine" && entry.take !== "theirs"))
      throw invalid(`decisions[${index}] is {collection, id, take}: a content collection, a record id, and "mine" or "theirs"`);
    return { collection: entry.collection, id: entry.id, take: entry.take };
  });
  const base = { decisions, allowDowngrade: body.allowDowngrade === true };
  if (kind === "preview") return base;
  const expect = body.expect;
  if (!record(expect) || Object.keys(expect).some(key => key !== "activeRevision" && key !== "bundledRevision")
    || typeof expect.activeRevision !== "string" || !CATALOG_REVISION.test(expect.activeRevision) || typeof expect.bundledRevision !== "string" || !CATALOG_REVISION.test(expect.bundledRevision))
    throw invalid("expect is {activeRevision, bundledRevision}, as the preview reported them");
  if (body.note !== undefined && body.note !== null && (typeof body.note !== "string" || body.note.length > MAX_PUBLISH_NOTE_CHARS)) throw invalid(`note is at most ${MAX_PUBLISH_NOTE_CHARS} characters`);
  return { ...base, expect: { activeRevision: expect.activeRevision, bundledRevision: expect.bundledRevision }, note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null };
}
