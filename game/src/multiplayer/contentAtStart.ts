import type { InstalledCatalog } from "../content/catalogInstall.js";
import { compileCatalog } from "../content/compiler/catalog.js";
import type { AdminActor, ServerAdminStorage } from "./adminStorage.js";
import { createAssetHost } from "./assetManifest.js";
import { baseMarkerOf, createCatalogHost, type BaseCatalog } from "./catalogHost.js";
import type { BaseMarker, CatalogStorage } from "./catalogStorage.js";
import { baseRequest, createContentPublisher, PublishFailure, type BasePreviewRequest, type PublishHost, type PublishResult } from "./contentPublish.js";

/**
 * What a server does with its stored content after seeding and before it installs a catalog and
 * builds a world. Like `catalogHost.ts`, this module loads no content table.
 *
 * A new executable can carry a content format the stored content does not have: a field became a
 * list, or an id the renderer knew is gone. Such content cannot run, so no world can start and no
 * admin can reach the admin API to update it. Two things here cover that:
 *
 *  - `checkActiveContent` compiles the active sources with this build's compiler, as a publish
 *    would, and refuses to start with one message when they fail, naming the command that fixes it.
 *  - `applyBaseUpdateAtStart` is that command, `--apply-base-update`: the admin base update
 *    (`POST /admin/content/base/preview` then `apply`) run by the same publisher, against a server
 *    with no world yet. Same merge, same decisions, same compile, same stored history and base
 *    marker. The move is recorded as made by `offline-base-update`.
 */

/** The actor a base update at start records, in `catalog_history.activated_by` and the audit log. */
export const OFFLINE_BASE_UPDATE = "offline-base-update";
const MAX_SHOWN_PROBLEMS = 5;

/** A server with no world yet: nothing to hold, nobody in a world holds anything, nothing to move onto the new catalog. */
const NO_WORLDS: PublishHost = {
  betweenTicks: run => run(),
  broadcast: async () => 0,
  failClosed: () => {},
  configure: async () => {},
  publishStage: async () => {},
  publishCheck: async () => ({ worlds: [], unplaceable: null, planMs: 0 }),
  publishCommit: async () => [],
  publishAbort: async () => {},
};

const short = (marker: BaseMarker | null): string => marker ? `${marker.version} (${marker.revision.slice(0, 12)})` : "unknown";

/**
 * Refuses to start when the active sources do not compile under this build. The check is the
 * compile a publish runs, without the asset host: a missing model does not stop a world, and the
 * host may not have the new assets yet. A revision stored without its sources cannot be checked.
 */
export async function checkActiveContent(storage: CatalogStorage, bundled: BaseCatalog): Promise<void> {
  const active = await storage.sources();
  const sources = active ? JSON.parse(active.sources) as Record<string, unknown> : {};
  if (!active || !Object.keys(sources).length) return;
  const compiled = compileCatalog(sources, { formulaRevision: bundled.catalog.formulaRevision });
  if (compiled.ok) return;
  const errors = compiled.problems.filter(problem => problem.severity === "error");
  const current = await storage.activeBase(), shipped = baseMarkerOf(bundled);
  const sameBase = current !== null && current.revision === shipped.revision;
  throw new Error(`The stored content predates this build's content format, so no world can run on it. `
    + `The active revision ${active.revision.slice(0, 12)} derives from base ${short(current)}; this build ships base ${short(shipped)}. `
    + (sameBase
      ? "That is the base the content already derives from, so an update from base cannot fix it: restore the data directory from a backup, or run the build that published this content. "
      : "Nothing was changed. Update it from the bundled base before the worlds start: run the server once with --apply-base-update. ")
    + `${errors.length} problem${errors.length === 1 ? "" : "s"}, the first: ${errors.slice(0, MAX_SHOWN_PROBLEMS).map(problem => `${problem.path}: ${problem.message}`).join("; ")}`);
}

export interface BaseUpdateAtStart {
  storage: { catalog: CatalogStorage; admin: ServerAdminStorage };
  bundled: BaseCatalog;
  /** JSON text of the decisions, `[{collection, id, take}]`, or null for none. */
  decisions: string | null;
  /** The asset manifest this build ships. Asset ids are checked against it, never against an asset host that may not carry the new assets yet. Null checks none. */
  manifest: (() => Promise<unknown>) | null;
  now(): number;
  log(event: Record<string, unknown>): void;
}

/**
 * `--apply-base-update`. Previews the merge and logs it. With every conflict decided and the merged
 * content valid, applies it, and the server starts on the result. Otherwise it throws, having
 * changed nothing, with the conflicts logged one per line and a `--decisions` template that keeps
 * every server edit. Returns null when the content already derives from the bundled base.
 */
export async function applyBaseUpdateAtStart(options: BaseUpdateAtStart): Promise<PublishResult | null> {
  const { storage, bundled, log, now } = options;
  const revision = await storage.catalog.activeRevision();
  const text = revision === null ? null : await storage.catalog.catalog(revision, "server");
  if (revision === null || text === null) throw new Error("The database has no active catalog to update");
  // What a publish compares against: the catalog the worlds would have run, as stored. Only its tables are read, never run.
  const running = JSON.parse(text) as InstalledCatalog;
  const publisher = createContentPublisher({
    catalog: createCatalogHost(storage.catalog, revision, await storage.catalog.activeBase()), admin: storage.admin,
    assets: createAssetHost(options.manifest ? { bundledManifest: options.manifest } : {}),
    host: NO_WORLDS, running: () => running, bundled, now, log,
  });
  const status = await publisher.baseStatus();
  if (status.direction === "same") {
    log({ event: "base-update.none", base: status.current, message: `The content already derives from base ${short(status.current)}, the base this build ships. Nothing to update.` });
    return null;
  }
  try {
    const request = decisionsRequest(options.decisions);
    const preview = await publisher.basePreview(request);
    const verdict = preview.decisionsNeeded ? "decisions-needed" : preview.validation?.ok ? "valid" : "invalid";
    log({ event: "base-update.preview", from: preview.base.from, to: preview.base.to, direction: preview.direction, summary: preview.summary,
      conflicts: preview.conflictsTotal, decisionsNeeded: preview.decisionsNeeded, changedCollections: preview.changedCollections, verdict });
    if (preview.decisionsNeeded) {
      for (const conflict of preview.conflicts) log({ event: "base-update.conflict", collection: conflict.collection, id: conflict.id, kind: conflict.kind,
        mineFields: conflict.mineFields, theirsFields: conflict.theirsFields, decision: conflict.decision ?? null });
      const template = preview.conflicts.map(({ collection, id, decision }) => ({ collection, id, take: decision ?? "mine" }));
      log({ event: "base-update.decisions-needed", decisionsNeeded: preview.decisionsNeeded, decisions: template });
      throw new Error(`The base update needs ${preview.decisionsNeeded} decision${preview.decisionsNeeded === 1 ? "" : "s"}, so nothing was changed. `
        + `Each conflict is logged above as base-update.conflict: "mine" keeps the server's record, "theirs" takes the bundled base's. `
        + `Run again with every conflict decided: --apply-base-update --decisions '${JSON.stringify(template)}' `
        + `(this keeps every server edit), or put that list in a file and pass --decisions-file <path>.`);
    }
    if (!preview.validation?.ok) {
      const error = preview.validation?.error ?? {};
      throw new Error(`The merged content was refused (${String(error.code)}), so nothing was changed: ${String(error.message)} ${JSON.stringify(Object.fromEntries(Object.entries(error).filter(([key]) => key !== "code" && key !== "message")))}`);
    }
    const actor: AdminActor = { accountId: null, credential: OFFLINE_BASE_UPDATE, at: now() };
    const applied = await publisher.baseApply({ ...request, expect: preview.expect, note: `Applied at start by --apply-base-update: base ${preview.base.from.version} to ${preview.base.to.version}` }, actor);
    log({ event: "base-update.applied", revision: applied.revision, previous: applied.previous, base: applied.base, decisions: applied.baseUpdate.decisions,
      changedCollections: applied.changedCollections, assetValidation: applied.assetValidation });
    return applied;
  } catch (error) {
    if (error instanceof PublishFailure) throw new Error(`The base update was refused (${error.code}), so nothing was changed: ${error.message} ${JSON.stringify(error.details)}`);
    throw error;
  }
}

function decisionsRequest(text: string | null): BasePreviewRequest {
  let decisions: unknown = [];
  if (text !== null) {
    try { decisions = JSON.parse(text); }
    catch { throw new Error(`--decisions is not JSON. It is a list like [{"collection":"lootTables","id":"shared_t0_frog","take":"mine"}]`); }
  }
  return baseRequest({ decisions }, "preview");
}
