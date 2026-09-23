import { changedCollections } from "../../../game/src/content/compiler/changes.js";
import { CONTENT_COLLECTIONS } from "../../../game/src/content/compiler/collections.js";
import { ALL_PROCEDURAL_GEAR_ASSETS } from "../../../game/src/render/proceduralGear.js";
import { applyOperations } from "../../shared/applyOperations.js";
import type { ApiDiagnostic, CollectionResponse, CollectionSummary, ContentTransactionRequest } from "../../shared/contracts.js";
import { BackendUnavailable, type BackendTransaction, type DevdocsBackend, type PublishBlocker, type PublishSummary, type TransactionRefusal } from "./backend.js";
import { adminFailure, AdminFailure, type AdminSession, type ServerDescriptor } from "./session.js";

/**
 * A running game server, through its admin API.
 *
 * Reads are two requests: `GET /admin/content/sources` for the authored collections the active
 * revision was compiled from — with the per-collection revisions the publish endpoint checks a
 * draft against, so nothing here ever hashes a collection — and `GET /admin/content/catalog/<revision>` for that revision's
 * compiled server catalog, which is where the derived views (`compiled-items` and the rest) come
 * from. The alternative was compiling in the browser, which would have meant shipping the whole
 * content compiler — the world compiler, the creature compiler and the progression pass — into the
 * editor bundle to recover tables the server already has. The server is asked instead.
 *
 * Writes map the editor's one save onto the two endpoints a live server has: `validate` is the dry
 * run and `publish` is the save, both taking whole collections with the revision they were read at.
 * The result is translated back into the transaction shape the draft store already understands, so
 * conflicts and compile errors land in the same places they do in repo mode.
 */

/** Compiled tables the editor browses beside their sources, as `readRuntimeCatalogs` serves them in repo mode. */
const DERIVED_TABLES = ["items", "recipes", "resources", "enemies", "species"] as const;
/** The source collections are megabytes. One read per session, refreshed when a publish moves the revision. */
const REVISION_PATTERN = /^[a-f0-9]{64}$/;

export interface ServerBackendPorts {
  session: AdminSession;
  descriptor: ServerDescriptor;
  fetch?: typeof globalThis.fetch;
  /** The session expired or was revoked. The shell returns to sign-in and keeps every draft. */
  onUnauthorized?(): void;
}

interface Snapshot {
  revision: string;
  sources: Record<string, unknown>;
  /** What the publish endpoint compares against: SHA-256 of each collection's canonical text. */
  revisions: Record<string, string>;
  tables: Record<string, unknown>;
  assets: unknown[];
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown): number => Array.isArray(value) ? value.length : record(value) ? Object.keys(value).length : 0;

function summaryOf(name: string, value: unknown, editable: boolean, idKey = "id"): CollectionSummary {
  const spec = CONTENT_COLLECTIONS.find(candidate => candidate.name === name);
  return { name, count: count(value), editable, idKey: spec?.idKey ?? idKey, shape: spec?.shape ?? (Array.isArray(value) ? "array" : "object") };
}

function diagnostics(problems: unknown): ApiDiagnostic[] {
  if (!Array.isArray(problems)) return [];
  return problems.filter(record).map(problem => ({
    path: typeof problem.path === "string" ? problem.path : "",
    message: typeof problem.message === "string" ? problem.message : String(problem.message ?? ""),
    severity: problem.severity === "warning" || problem.severity === "info" ? problem.severity : "error",
  }));
}

export function createServerBackend(ports: ServerBackendPorts): DevdocsBackend {
  const call = ports.fetch ?? globalThis.fetch.bind(globalThis);
  const { session, descriptor } = ports;
  let assetBaseUrl = descriptor.assetBaseUrl;
  let pending: Promise<Snapshot> | undefined;

  async function admin<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await call(`${session.server}${path}`, {
      ...init, credentials: "omit",
      headers: { ...init.headers, Authorization: `Bearer ${session.token}`, Accept: "application/json" },
    });
    if (response.status === 401) { ports.onUnauthorized?.(); throw await adminFailure(response); }
    if (!response.ok) throw await adminFailure(response);
    return response.json() as Promise<T>;
  }

  function manifestAssets(value: unknown): unknown[] | undefined {
    if (!record(value) || !Array.isArray(value.assets) || value.assets.length === 0) return undefined;
    if (!value.assets.every(asset => record(asset) && typeof asset.id === "string" && typeof asset.file === "string")) return undefined;
    return value.assets;
  }

  /** Prefer the same-origin development asset mount when this deployment provides one. */
  async function developmentManifest(): Promise<unknown[] | undefined> {
    try {
      const base = new URL("/dev-assets/", session.server).href;
      const response = await call(new URL("assets/manifest.json", base).href, { credentials: "omit" });
      if (!response.ok) return undefined;
      const assets = manifestAssets(await response.json());
      if (!assets) return undefined;
      assetBaseUrl = base;
      return assets;
    } catch { return undefined; }
  }

  /** The asset manifest, preferring the same-origin development mount over the published host. */
  async function manifest(): Promise<unknown[]> {
    const development = await developmentManifest();
    if (development) return development;
    assetBaseUrl = descriptor.assetBaseUrl;
    const url = descriptor.assetBaseUrl ? `${descriptor.assetBaseUrl.replace(/\/*$/, "/")}assets/manifest.json` : "assets/manifest.json";
    try {
      const response = await call(url, { credentials: "omit" });
      if (!response.ok) return [];
      return manifestAssets(await response.json()) ?? [];
    } catch { return []; }
  }

  async function read(): Promise<Snapshot> {
    const sourcesBody = await admin<{ revision?: unknown; revisions?: unknown; sources?: unknown }>("/admin/content/sources");
    const revision = typeof sourcesBody.revision === "string" && REVISION_PATTERN.test(sourcesBody.revision) ? sourcesBody.revision : "";
    if (!revision || !record(sourcesBody.sources)) throw new AdminFailure(502, "invalid_response", "That server returned an unusable source catalog.");
    const sources = sourcesBody.sources;
    const reported = record(sourcesBody.revisions) ? sourcesBody.revisions : {};
    if (!Object.keys(sources).every(name => typeof reported[name] === "string" && REVISION_PATTERN.test(reported[name] as string)))
      throw new AdminFailure(502, "invalid_response", "That server returned source collections without their revisions, so an edit could not be sent back safely.");
    const revisions = reported as Record<string, string>;
    const [catalog, assets] = await Promise.all([
      admin<Record<string, unknown>>(`/admin/content/catalog/${revision}`).catch(() => ({} as Record<string, unknown>)),
      manifest(),
    ]);
    const inner = record(catalog.catalog) ? catalog.catalog : catalog;
    const tables = record(inner.tables) ? inner.tables : {};
    return { revision, sources, revisions, tables, assets };
  }
  function snapshot(): Promise<Snapshot> { return pending ??= read().catch(error => { pending = undefined; throw error; }); }
  const invalidate = (): void => { pending = undefined; };

  function derived(current: Snapshot, name: string): CollectionResponse | undefined {
    const table = current.tables[name.slice("compiled-".length)];
    if (!Array.isArray(table)) return undefined;
    return { collection: summaryOf(name, table, false), revision: current.revision, data: table };
  }
  function assetCollection(current: Snapshot): CollectionResponse {
    const data = [...current.assets, ...ALL_PROCEDURAL_GEAR_ASSETS.map(row => ({ id: row.assetId, itemId: row.itemId, procedural: true }))];
    return { collection: summaryOf("assets", data, false), revision: current.revision, data };
  }

  return {
    kind: "server",
    label: descriptor.name,
    get assetBaseUrl() { return assetBaseUrl; },
    // No checkout behind a live server: no git, no request queue, no authoring notes beside the
    // content, no asset import, and formulas ship compiled into the release rather than being edited.
    capabilities: { write: true, meta: false, requests: false, git: false, bulk: false, assets: false, formulas: false, publish: true },

    async get<T>(path: string): Promise<T> {
      if (path === "collections") return await this.collections() as T;
      if (path.startsWith("collections/")) return await this.collection(decodeURIComponent(path.slice("collections/".length))) as T;
      if (path.startsWith("meta/")) throw new BackendUnavailable("Authoring metadata");
      if (path.startsWith("git/")) throw new BackendUnavailable("Working-tree status");
      if (path === "requests") throw new BackendUnavailable("The request queue");
      throw new BackendUnavailable(`\`${path}\``);
    },

    async collections(): Promise<CollectionSummary[]> {
      const current = await snapshot();
      const authored = CONTENT_COLLECTIONS.filter(spec => current.sources[spec.name] !== undefined)
        .map(spec => summaryOf(spec.name, current.sources[spec.name], true));
      const compiled = DERIVED_TABLES.map(name => derived(current, `compiled-${name}`)?.collection).filter((row): row is CollectionSummary => Boolean(row));
      return [...authored, ...compiled, assetCollection(current).collection];
    },

    async collection(name: string): Promise<CollectionResponse> {
      const current = await snapshot();
      if (name === "assets") return assetCollection(current);
      if (name.startsWith("compiled-")) {
        const row = derived(current, name);
        if (!row) throw new Error(`Unknown collection ${name}`);
        return row;
      }
      const value = current.sources[name];
      if (value === undefined) throw new Error(`Unknown collection ${name}`);
      return { collection: summaryOf(name, value, true), revision: current.revisions[name]!, data: value };
    },

    async transact(request: ContentTransactionRequest): Promise<BackendTransaction> {
      const current = await snapshot();
      const values = new Map(Object.entries(structuredClone(current.sources)));
      try { applyOperations(values, request.changes); }
      catch (error) { return { ok: false, status: 422, body: { error: error instanceof Error ? error.message : String(error), revisions: request.revisions } }; }

      // The same diff the server runs, from the same module, so what is sent is what it calls changed.
      const changed = changedCollections(new Map(Object.entries(current.sources)), values).map(spec => [spec.name, values.get(spec.name)] as [string, unknown]);
      if (!changed.length) {
        return { ok: true, body: { revision: current.revision, collections: [], affected: [], diagnostics: [], compiled: undefined, revisions: current.revisions } };
      }
      const collections = Object.fromEntries(changed.map(([name, value]) => [name, { revision: request.revisions[name] ?? current.revisions[name]!, value }]));
      const path = request.operation === "save" ? "/admin/content/publish" : "/admin/content/validate";

      let result: Record<string, unknown>;
      try {
        result = await admin<Record<string, unknown>>(path, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ base: current.revision, collections }),
        });
      } catch (error) {
        if (!(error instanceof AdminFailure)) throw error;
        return { ok: false, status: error.status, body: refusal(error, request.revisions) };
      }

      // A publish reports the revision each stored collection now has. A validate stores nothing, so
      // the revisions stand still, exactly as the repo transaction's dry run leaves them.
      const moved = request.operation === "save" && record(result.revisions) ? result.revisions as Record<string, unknown> : {};
      const nextRevisions = { ...current.revisions, ...Object.fromEntries(Object.entries(moved).filter(([, value]) => typeof value === "string" && REVISION_PATTERN.test(value)) as [string, string][]) };
      if (request.operation === "save") invalidate();
      const affected = record(result.affected) ? result.affected : {};
      return {
        ok: true,
        body: {
          revision: typeof result.revision === "string" ? result.revision : current.revision,
          collections: changed.map(([name, value]) => ({ collection: summaryOf(name, value, true), revision: nextRevisions[name] ?? current.revisions[name]!, data: value })),
          affected: Object.entries(affected).flatMap(([collection, ids]) => (Array.isArray(ids) ? ids : []).map(id => ({ collection, id: String(id) }))),
          diagnostics: diagnostics(result.problems),
          compiled: undefined,
          revisions: nextRevisions,
          ...(request.operation === "save" ? { publish: publishSummary(result, current.revision) } : {}),
        },
      };
    },

    /** The authenticated fetch every non-content admin surface is built on. */
    async admin<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
      if (!path.startsWith("/admin/")) return Promise.reject(new BackendUnavailable(`\`${path}\``));
      const result = await admin<T>(path, {
        ...(init.method ? { method: init.method } : {}),
        ...(init.body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }),
        ...(init.signal ? { signal: init.signal } : {}),
      });
      if (init.method === "POST" && (path === "/admin/content/base/apply" || path === "/admin/content/rollback")) invalidate();
      return result;
    },
  };
}

function publishSummary(result: Record<string, unknown>, fallback: string): PublishSummary {
  const list = (value: unknown): string[] => Array.isArray(value) ? value.map(String) : [];
  const affected = record(result.affected) ? result.affected : {};
  return {
    revision: typeof result.revision === "string" ? result.revision : fallback,
    previous: typeof result.previous === "string" ? result.previous : fallback,
    unchanged: result.unchanged === true,
    live: list(result.live),
    onRestart: list(result.onRestart),
    affected: Object.fromEntries(Object.entries(affected).map(([name, ids]) => [name, list(ids)])),
    spawns: (Array.isArray(result.spawns) ? result.spawns : []).filter(record).map(row => ({
      world: String(row.world ?? ""), added: Number(row.added ?? 0), pending: Number(row.pending ?? 0),
      retiring: Number(row.retiring ?? 0), removed: Number(row.removed ?? 0),
    })),
    notified: Number(result.notified ?? 0),
  };
}

/**
 * The admin API's refusals, onto the states the editor already has.
 *
 * `revisions` decides whether the draft store marks a record as conflicted: it treats a collection
 * whose returned revision differs from the one it sent as stale. So a refusal that is not about
 * staleness returns the revisions unchanged, and only `stale_collections` moves them.
 */
export function refusal(error: AdminFailure, sent: Readonly<Record<string, string>>): TransactionRefusal {
  const details = error.details;
  if (error.status === 409 && error.code === "stale_collections") {
    const current = record(details.revisions) ? details.revisions : {};
    return { error: error.message, revisions: Object.fromEntries(Object.entries(sent).map(([name, revision]) => [name, typeof current[name] === "string" ? current[name] : revision])) };
  }
  if (error.code === "definition_in_use") {
    const blockers = (Array.isArray(details.blockers) ? details.blockers : []).filter(record) as unknown as PublishBlocker[];
    return { error: error.message, blockers, revisions: { ...sent } };
  }
  if (error.code === "content_invalid") return { error: error.message, diagnostics: diagnostics(details.problems), revisions: { ...sent } };
  if (error.code === "spawn_unplaceable") return { error: `${error.message}${details.world ? ` (${String(details.world)})` : ""}`, revisions: { ...sent } };
  if (error.code === "asset_manifest_unavailable") return { error: `${error.message} Publishing is paused until the asset host answers.`, revisions: { ...sent } };
  if (error.status === 403) return { error: `${error.message} Nothing was published.`, revisions: { ...sent } };
  return { error: error.message, revisions: { ...sent } };
}
