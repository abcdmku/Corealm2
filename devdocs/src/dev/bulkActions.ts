import type { ApiDiagnostic, BulkAction, BulkResponse, ContentOperation } from "../../shared/contracts.js";
import type { MetaOperation } from "../../../game/src/content/metaOps.js";
import { backend } from "../api/backend.js";
import { isMetaConflict, readMetaDigest } from "../model/meta.js";
import type { ContentRow } from "../model/contracts.js";
import { rowId } from "../model/rows.js";

/**
 * Bulk status, note and retier, worked out in the browser and applied through the backend, so the
 * same panel works on the checkout and on a live server.
 *
 * Status and note are metadata: the preview reads the collection's digest, and apply sends one
 * `patchMeta` per changed record, each naming the revision the one before it left. Metadata is kept
 * per record, so a run that meets a concurrent edit stops there and says how far it got.
 *
 * Retier is content: every changed record goes in one transaction, previewed as a dry run and saved
 * as one save (on a server, one publish) against the collection revision the rows were read at.
 */
export type BulkDiff = BulkResponse["diffs"][number];
export interface BulkPlan {
  collection: string;
  action: BulkAction;
  diffs: BulkDiff[];
  diagnostics: ApiDiagnostic[];
  /** What the plan was read at: the collection's content revision, and for metadata its revision. */
  revisions: { content: string; meta?: string };
  /** Retier only: the transaction apply sends. */
  changes?: ContentOperation[];
}
export interface BulkRefusal { message: string; diagnostics: ApiDiagnostic[]; conflict: boolean; applied?: number }
export type BulkResult<T> = { ok: true; value: T } | { ok: false; refusal: BulkRefusal };

export interface BulkSelection {
  collection: string;
  idKey: string;
  /** The collection revision `rows` were read at. */
  revision: string;
  /** The selected rows. */
  rows: readonly ContentRow[];
  action: BulkAction;
}

const STALE = "The content or metadata changed after this preview. Preview again before applying.";
const message = (error: unknown, fallback: string): string => error instanceof Error && error.message ? error.message : fallback;

function metaOperation(action: Exclude<BulkAction, { kind: "retier" }>): MetaOperation {
  return action.kind === "status" ? { kind: "status", status: action.status }
    : { kind: "note", text: action.text, ...(action.label === undefined ? {} : { label: action.label }) };
}

export async function previewBulk(selection: BulkSelection): Promise<BulkResult<BulkPlan>> {
  const { collection, idKey, revision, rows, action } = selection;
  if (action.kind === "retier") {
    const changed = rows.filter(row => row.tier !== action.tier);
    const diffs = changed.map(row => ({ recordId: rowId(row, idKey), before: { tier: row.tier }, after: { tier: action.tier } }));
    const changes: ContentOperation[] = changed.map(row => ({ kind: "put", collection, id: rowId(row, idKey), record: { ...row, tier: action.tier } }));
    const plan: BulkPlan = { collection, action, diffs, diagnostics: [], revisions: { content: revision }, changes };
    if (!changes.length) return { ok: true, value: plan };
    const checked = await backend().transact({ operation: "preview", revisions: { [collection]: revision }, changes });
    if (!checked.ok) return { ok: false, refusal: { message: checked.status === 409 ? STALE : checked.body.error ?? `Retier preview failed (${checked.status}).`,
      diagnostics: checked.body.diagnostics ?? [], conflict: checked.status === 409 } };
    return { ok: true, value: { ...plan, diagnostics: checked.body.diagnostics ?? [] } };
  }
  let digest;
  try { digest = await readMetaDigest(collection); }
  catch (error) { return { ok: false, refusal: { message: message(error, "The metadata could not be read."), diagnostics: [], conflict: false } }; }
  const diffs = rows.flatMap((row): BulkDiff[] => {
    const recordId = rowId(row, idKey), entry = digest.records[recordId];
    if (action.kind === "status") {
      const status = entry?.status ?? "draft";
      return status === action.status ? [] : [{ recordId, before: { status }, after: { status: action.status } }];
    }
    const notes = entry?.notes ?? 0;
    return [{ recordId, before: { notesCount: notes }, after: { notesCount: notes + 1, note: { text: action.text, ...(action.label === undefined ? {} : { label: action.label }) } } }];
  });
  return { ok: true, value: { collection, action, diffs, diagnostics: [], revisions: { content: revision, meta: digest.revision } } };
}

/** Applies a preview. Answers how many records changed. */
export async function applyBulk(plan: BulkPlan): Promise<BulkResult<number>> {
  const { collection, action, diffs } = plan;
  if (action.kind === "retier") {
    if (!plan.changes?.length) return { ok: true, value: 0 };
    const saved = await backend().transact({ operation: "save", revisions: { [collection]: plan.revisions.content }, changes: plan.changes });
    if (!saved.ok) return { ok: false, refusal: { message: saved.status === 409 ? STALE : saved.body.error ?? `Retier failed (${saved.status}).`,
      diagnostics: saved.body.diagnostics ?? [], conflict: saved.status === 409 } };
    return { ok: true, value: plan.changes.length };
  }
  const operation = metaOperation(action);
  let revision = plan.revisions.meta!, applied = 0;
  for (const diff of diffs) {
    try {
      revision = (await backend().patchMeta(collection, diff.recordId, { revision, operation })).revision;
      applied++;
    } catch (error) {
      const conflict = isMetaConflict(error);
      const reason = conflict ? STALE : message(error, "The metadata could not be saved.");
      return { ok: false, refusal: { message: applied ? `Updated ${applied} of ${diffs.length} before stopping at ${diff.recordId}. ${reason}` : reason, diagnostics: [], conflict, applied } };
    }
  }
  return { ok: true, value: applied };
}
