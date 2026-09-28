import { changedCollections } from "../../../game/src/content/compiler/changes.js";
import { CONTENT_COLLECTIONS } from "../../../game/src/content/compiler/collections.js";
import { ALL_PROCEDURAL_GEAR_ASSETS } from "../../../game/src/render/proceduralGear.js";
import { applyOperations } from "../../shared/applyOperations.js";
import type { ApiDiagnostic, CollectionResponse, CollectionSummary, ContentTransactionRequest } from "../../shared/contracts.js";
import type { ContentAssetIndex } from "../../../game/src/multiplayer/contentAssetsContract.js";
import type { MetaPatch, MetaResponse } from "../../shared/metaContracts.js";
import type { ImagegenJob, ImagegenRequest } from "../../shared/skinContracts.js";
import { adoptGameCatalog, installedCatalogOf, refreshGameCatalog, setGameCatalogSource } from "../model/liveCatalog.js";
import { setContentFiles } from "../model/serverFiles.js";
import { BackendUnavailable, type BackendTransaction, type DevdocsBackend, type DevdocsCapabilities, type PublishBlocker, type PublishSummary, type TransactionRefusal } from "./backend.js";
import { publishNote, setPublishNote } from "./publishNote.js";
import { adminFailure, AdminFailure, type AdminSession, type ServerDescriptor } from "./session.js";
import { serverModels } from "../model/serverFiles.js";
import { parseBake } from "./worldBake.js";
import { resetPublicBaseUrl, setPublicBaseUrl } from "../../../game/src/app/config.js";

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
 *
 * The compiled catalog each snapshot reads is also adopted into the page (`liveCatalog.ts`), so the
 * stage, thumbnails and derived numbers run on the server's content rather than the bundled build's,
 * and a publish, base update or rollback shows at once.
 *
 * The feature routes a server may or may not have (`/admin/meta`, `/admin/files`, `/admin/imagegen`)
 * are probed alongside the first snapshot, and `capabilities` says what answered. An older server
 * simply lacks them, and the editor shows those controls disabled with a reason.
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

/** The feature routes a server may lack. Everything else server mode has is fixed. */
type Offered = Pick<DevdocsCapabilities, "meta" | "files" | "imagegen">;
const FIXED = { write: true, git: false, assets: false, formulas: false, publish: true } as const;

export function createServerBackend(ports: ServerBackendPorts): DevdocsBackend {
  const call = ports.fetch ?? globalThis.fetch.bind(globalThis);
  const { session, descriptor } = ports;
  let assetBaseUrl = descriptor.assetBaseUrl;
  let pending: Promise<Snapshot> | undefined;
  let offered: Offered = { meta: false, files: false, imagegen: false };
  let probing: Promise<void> | undefined;
  const contentAssetBase = `${session.server}/content-assets/`;

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

  /**
   * The game's own URL helpers (textures, icons, audio loaded by game code) must use the same host
   * this editor settled on; left alone they resolve against `/admin/`, where no game file exists.
   */
  function adoptGameAssetBase(): void {
    resetPublicBaseUrl();
    setPublicBaseUrl(assetBaseUrl ?? undefined);
  }

  /** The asset manifest, preferring the same-origin development mount over the published host. */
  async function manifest(): Promise<unknown[]> {
    const development = await developmentManifest();
    if (development) { adoptGameAssetBase(); return development; }
    assetBaseUrl = descriptor.assetBaseUrl;
    adoptGameAssetBase();
    const url = descriptor.assetBaseUrl ? `${descriptor.assetBaseUrl.replace(/\/*$/, "/")}assets/manifest.json` : "assets/manifest.json";
    try {
      const response = await call(url, { credentials: "omit" });
      if (!response.ok) return [];
      return manifestAssets(await response.json()) ?? [];
    } catch { return []; }
  }

  /**
   * Whether the server answers a feature route with the shape it documents. Not through `admin()`:
   * a route an older server lacks falls through to the devdocs build (HTML) or a 404, and neither
   * may sign the author out.
   */
  async function answers(path: string, shape: (body: Record<string, unknown>) => boolean): Promise<Record<string, unknown> | undefined> {
    try {
      const response = await call(`${session.server}${path}`, { credentials: "omit", headers: { Authorization: `Bearer ${session.token}`, Accept: "application/json" } });
      if (!response.ok) return undefined;
      const body: unknown = await response.json();
      return record(body) && shape(body) ? body : undefined;
    } catch { return undefined; }
  }
  function adoptFiles(index: unknown): void {
    if (record(index) && record(index.files)) setContentFiles(contentAssetBase, index.files as ContentAssetIndex["files"]);
  }
  function probe(): Promise<void> {
    return probing ??= (async () => {
      const [meta, files, imagegen] = await Promise.all([
        answers("/admin/meta/items/$all", body => record(body.records)),
        answers("/admin/files", body => record(body.files) && typeof body.revision === "string"),
        answers("/admin/imagegen", body => Array.isArray(body.jobs)),
      ]);
      offered = { meta: Boolean(meta), files: Boolean(files), imagegen: Boolean(imagegen) };
      if (files) adoptFiles(files);
    })();
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
      probe(),
    ]);
    const inner = record(catalog.catalog) ? catalog.catalog : catalog;
    const tables = record(inner.tables) ? inner.tables : {};
    const installed = installedCatalogOf(inner, revision);
    // The page runs the game's content modules on this server's catalog from the first read on. A
    // catalog the page cannot take leaves it on the one it has; the content reads still work.
    if (installed) try { adoptGameCatalog(installed); } catch (error) { console.warn("Could not adopt the server's catalog", error); }
    return { revision, sources, revisions, tables, assets };
  }
  function snapshot(): Promise<Snapshot> { return pending ??= read().catch(error => { pending = undefined; throw error; }); }
  const invalidate = (): void => { pending = undefined; };
  // A refresh reads the server again; reading adopts the catalog it brings, so there is nothing to hand back.
  setGameCatalogSource(async () => { invalidate(); await snapshot(); return undefined; });
  /** The content moved on the server: read it again, adopting its catalog, before answering. */
  const reread = (): Promise<void> => refreshGameCatalog();

  const meta = (path: string): string => `/admin/meta/${path.split("/").map(encodeURIComponent).join("/")}`;
  const needs = (capability: keyof Offered, what: string): void => { if (!offered[capability]) throw new BackendUnavailable(what); };

  function derived(current: Snapshot, name: string): CollectionResponse | undefined {
    const table = current.tables[name.slice("compiled-".length)];
    if (!Array.isArray(table)) return undefined;
    return { collection: summaryOf(name, table, false), revision: current.revision, data: table };
  }
  function assetCollection(current: Snapshot): CollectionResponse {
    // Models this server added (its manifest overlay) replace a host entry by id and are marked as the server's.
    const added = serverModels().map(entry => ({ ...entry, origin: "server" }));
    const replaced = new Set(added.map(entry => entry.id));
    const data = [...current.assets.filter(row => !replaced.has(String((row as { id?: unknown }).id))), ...added,
      ...ALL_PROCEDURAL_GEAR_ASSETS.map(row => ({ id: row.assetId, itemId: row.itemId, procedural: true }))];
    return { collection: summaryOf("assets", data, false), revision: current.revision, data };
  }

  return {
    kind: "server",
    label: descriptor.name,
    get assetBaseUrl() { return assetBaseUrl; },
    // No checkout behind a live server: no git, no asset import, and formulas ship compiled into the
    // release rather than being edited. Metadata (and the request queue and bulk actions built on
    // it), stored files and image jobs are there when the server offers their routes.
    get capabilities(): DevdocsCapabilities { return { ...FIXED, ...offered, requests: offered.meta, bulk: offered.meta }; },

    async get<T>(path: string): Promise<T> {
      if (path === "collections") return await this.collections() as T;
      if (path.startsWith("collections/")) return await this.collection(decodeURIComponent(path.slice("collections/".length))) as T;
      if (path.startsWith("meta/") || path === "requests") {
        await probe();
        needs("meta", path === "requests" ? "The request queue" : "Authoring metadata");
        return admin<T>(path === "requests" ? "/admin/meta/requests" : meta(path.slice("meta/".length)));
      }
      if (path.startsWith("git/")) throw new BackendUnavailable("Working-tree status");
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
        const note = request.operation === "save" ? publishNote().trim() : "";
        result = await admin<Record<string, unknown>>(path, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ base: current.revision, collections, ...(note ? { note } : {}) }),
        });
      } catch (error) {
        if (!(error instanceof AdminFailure)) throw error;
        return { ok: false, status: error.status, body: refusal(error, request.revisions) };
      }

      // A publish reports the revision each stored collection now has. A validate stores nothing, so
      // the revisions stand still, exactly as the repo transaction's dry run leaves them.
      const moved = request.operation === "save" && record(result.revisions) ? result.revisions as Record<string, unknown> : {};
      const nextRevisions = { ...current.revisions, ...Object.fromEntries(Object.entries(moved).filter(([, value]) => typeof value === "string" && REVISION_PATTERN.test(value)) as [string, string][]) };
      if (request.operation === "save") { setPublishNote(""); await reread(); }
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
      if (init.method === "POST" && (path === "/admin/content/base/apply" || path === "/admin/content/rollback")) await reread();
      return result;
    },

    async patchMeta(collection: string, entityId: string, patch: MetaPatch): Promise<MetaResponse> {
      await probe();
      needs("meta", "Authoring metadata");
      return admin<MetaResponse>(meta(`${collection}/${entityId}`), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    },

    /** Stores the files in the server's asset store (`POST /admin/files`) and reports what it holds for each path sent. */
    async putFiles(files: Record<string, string>): Promise<{ files: Record<string, { sha256: string; bytes: number }> }> {
      await probe();
      needs("files", "Storing files");
      const index = await admin<ContentAssetIndex>("/admin/files", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ files }) });
      adoptFiles(index);
      const stored: Record<string, { sha256: string; bytes: number }> = {};
      for (const path of Object.keys(files)) {
        const entry = index.files?.[path];
        if (!entry) throw new AdminFailure(502, "invalid_response", `The server did not store ${path}.`);
        stored[path] = { sha256: entry.sha256, bytes: entry.bytes };
      }
      return { files: stored };
    },

    imagegen: {
      async start(request: ImagegenRequest): Promise<ImagegenJob> {
        await probe();
        needs("imagegen", "Image generation");
        return (await admin<{ job: ImagegenJob }>("/admin/imagegen", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) })).job;
      },
      async list(): Promise<ImagegenJob[]> {
        await probe();
        if (!offered.imagegen) return [];
        return (await admin<{ jobs: ImagegenJob[] }>("/admin/imagegen")).jobs;
      },
      async retry(jobId: string): Promise<ImagegenJob> {
        await probe();
        needs("imagegen", "Image generation");
        return (await admin<{ job: ImagegenJob }>(`/admin/imagegen/${encodeURIComponent(jobId)}`, { method: "POST" })).job;
      },
    },
  };
}

export function publishSummary(result: Record<string, unknown>, fallback: string): PublishSummary {
  const list = (value: unknown): string[] => Array.isArray(value) ? value.map(String) : [];
  const affected = record(result.affected) ? result.affected : {};
  const bake = parseBake(result.bake);
  return {
    revision: typeof result.revision === "string" ? result.revision : fallback,
    previous: typeof result.previous === "string" ? result.previous : fallback,
    unchanged: result.unchanged === true,
    live: list(result.live),
    // A server may list the tables waiting for its world bake apart from those waiting for a restart; both read as "not live yet".
    onRestart: [...new Set([...list(result.onRestart), ...list(result.rebake)])],
    affected: Object.fromEntries(Object.entries(affected).map(([name, ids]) => [name, list(ids)])),
    spawns: (Array.isArray(result.spawns) ? result.spawns : []).filter(record).map(row => ({
      world: String(row.world ?? ""), added: Number(row.added ?? 0), pending: Number(row.pending ?? 0),
      retiring: Number(row.retiring ?? 0), removed: Number(row.removed ?? 0),
    })),
    notified: Number(result.notified ?? 0),
    ...(bake ? { bake } : {}),
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
