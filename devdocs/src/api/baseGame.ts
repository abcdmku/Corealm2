import { queryOptions } from "@tanstack/react-query";
import type { BaseConflict, BaseDecision, BaseMergeCounts } from "../../../game/src/content/compiler/baseMerge.js";
import { CONTENT_COLLECTIONS } from "../../../game/src/content/compiler/collections.js";
import { backend, describeBlocker, type PublishBlocker, type PublishSummary } from "./backend.js";
import { AdminFailure } from "./session.js";

export type { BaseDecision };
export interface BaseMarker { version: string; revision: string }
export type BaseDirection = "newer" | "older" | "same" | "different-content-same-version";
export interface BaseStatus {
  current: BaseMarker | null; bundled: BaseMarker | null; updateAvailable: boolean;
  direction: BaseDirection | null; serverModified: boolean | null;
}
export interface BaseError { code: string; message: string; [key: string]: unknown }
export interface BasePreview {
  base: { from: BaseMarker; to: BaseMarker }; direction: BaseDirection;
  expect: { activeRevision: string; bundledRevision: string };
  summary: Record<string, BaseMergeCounts>;
  conflicts: (BaseConflict & { truncated?: boolean })[]; conflictsTotal: number;
  bodiesTruncated: boolean; decisionsNeeded: number;
  validation: null | { ok: true; result: unknown } | { ok: false; status: number; error: BaseError };
  changedCollections: string[]; affected: Record<string, string[]>; live: string[] | null; onRestart: string[] | null;
}
export interface BaseApplyResult extends PublishSummary {
  baseUpdate: { from: BaseMarker; to: BaseMarker; direction: BaseDirection; summary: Record<string, BaseMergeCounts>; decisions: { mine: number; theirs: number } };
}
export const baseStatusQuery = () => queryOptions({
  queryKey: ["admin", "base"], queryFn: ({ signal }) => backend().admin<BaseStatus>("/admin/content/base", { signal }), retry: false,
});
export const previewBase = (decisions: readonly BaseDecision[], allowDowngrade: boolean) =>
  backend().admin<BasePreview>("/admin/content/base/preview", { method: "POST", body: { decisions, allowDowngrade } });
export const applyBase = (expect: BasePreview["expect"], decisions: readonly BaseDecision[], allowDowngrade: boolean, note: string) =>
  backend().admin<BaseApplyResult>("/admin/content/base/apply", { method: "POST", body: { expect, decisions, allowDowngrade, note } });
export const baseConflictKey = (row: Pick<BaseConflict, "collection" | "id">): string => JSON.stringify([row.collection, row.id]);

/** Recover capped bodies without mistaking a cap for a deletion. Check every revision first. */
export async function completeBaseBodies(preview: BasePreview): Promise<BasePreview> {
  if (!preview.bodiesTruncated) return preview;
  const [ancestor, mine, theirs] = await Promise.all([
    backend().admin<{ revision: string; sources: Record<string, unknown> }>("/admin/content/base/sources?side=current"),
    backend().admin<{ revision: string; sources: Record<string, unknown> }>("/admin/content/sources"),
    backend().admin<{ revision: string; sources: Record<string, unknown> }>("/admin/content/base/sources?side=bundled"),
  ]);
  if (ancestor.revision !== preview.base.from.revision || mine.revision !== preview.expect.activeRevision || theirs.revision !== preview.expect.bundledRevision)
    throw new AdminFailure(409, "stale_base", "The catalog changed while loading the comparison.");
  return { ...preview, bodiesTruncated: false, conflicts: preview.conflicts.map(row => row.truncated ? {
    ...row, truncated: false, ancestor: baseRecord(ancestor.sources, row.collection, row.id),
    mine: baseRecord(mine.sources, row.collection, row.id), theirs: baseRecord(theirs.sources, row.collection, row.id),
  } : row) };
}

export function baseRecord(sources: Record<string, unknown>, collection: string, id: string): unknown {
  const value = sources[collection];
  if (id === "$collection") return value ?? null;
  if (Array.isArray(value)) {
    const key = CONTENT_COLLECTIONS.find(row => row.name === collection)?.idKey ?? "id";
    return value.find(row => row && typeof row === "object" && String(row[key]) === id) ?? null;
  }
  if (!value || typeof value !== "object") return null;
  const map = value as Record<string, unknown>;
  if (collection !== "audio") return map[id] ?? null;
  const split = id.indexOf("/");
  const section = map[id.slice(0, split)];
  return section && typeof section === "object" ? (section as Record<string, unknown>)[id.slice(split + 1)] ?? null : null;
}

export function baseFailure(error: unknown): BaseError {
  if (error instanceof AdminFailure) return { ...error.details, code: error.code, message: error.message };
  return { code: "request_failed", message: error instanceof Error ? error.message : "The request failed." };
}
export function baseErrorLines(error: BaseError): string[] {
  const guidance: Record<string, string> = {
    stale_base: "The server or bundled base changed. Preview again and review the new comparison.",
    decisions_needed: "Some conflicts still need a choice. Preview again to review them.",
    invalid_decisions: "The conflict list changed. Start a new preview and choose again.",
    definition_in_use: "A removed definition is still in use. Keep the server's record or retire the definition before updating.",
    content_invalid: "The combined content failed validation. Review the errors and change your choices or the server content.",
  };
  const details = Array.isArray(error.blockers) ? (error.blockers as PublishBlocker[]).map(describeBlocker)
    : Array.isArray(error.problems) ? error.problems.map(problem => {
      const row = problem as { path?: string; message?: string }; return `${row.path ?? ""} ${row.message ?? ""}`.trim();
    }) : [];
  return [guidance[error.code] ?? error.message, ...details];
}
