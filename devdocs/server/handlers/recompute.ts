import path from "node:path";
import { deriveRecord, sameValue, type DerivationDiff } from "../../../game/src/content/balance/derivations.js";
import { discriminated, lit, obj, opt, rec, str, type Infer, type ParseContext } from "../../../game/src/content/schema/core.js";
import { CONTENT_COLLECTIONS } from "../../../tools/content/collections.js";
import { contentRevision, formatContentJson } from "../../../tools/content/format.js";
import { withFileLock } from "../../../tools/content/locks.js";
import type { ReferencePools } from "../../../tools/content/references.js";
import { atomicReplaceFile } from "../../../tools/lib/atomic-replace-file.js";
import { repoRoot } from "../../../tools/lib/paths.js";
import type { ApiDiagnostic } from "../../shared/contracts.js";
import { collectionFile, loadCollectionSnapshots, parseAuthoredCollection, validateCollectionOverlay,
  type CollectionSnapshots } from "../lib/validateCollections.js";
import { isLoopbackDevdocsRequest, type DevdocsJsonResponse, type DevdocsRequest } from "./collections.js";

export interface RecomputeHandlerOptions {
  contentRoot?: string;
  referencePools?: () => Promise<ReferencePools>;
}
export interface RecomputeResponse {
  diffs: DerivationDiff[];
  revisions: Record<string, string>;
}
export type RecomputeRequest = DevdocsRequest & { body?: unknown };
export type RecomputeHandler = (request: RecomputeRequest) => Promise<DevdocsJsonResponse | undefined>;

const filters = {
  kind: opt(str({ nonEmpty: true })), collection: opt(str({ nonEmpty: true })), recordId: opt(str({ nonEmpty: true })),
};
const bodySchema = discriminated("operation", {
  preview: obj({ operation: lit("preview"), ...filters }),
  apply: obj({ operation: lit("apply"), ...filters, revisions: rec(str({ pattern: /^[a-f0-9]{64}$/ })) }),
});
type RecomputeBody = Infer<typeof bodySchema>;

function json(status: number, data: unknown, headers: Readonly<Record<string, string>> = {}): DevdocsJsonResponse {
  return { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }, body: JSON.stringify(data) };
}
function failure(status: number, error: string, diagnostics?: ApiDiagnostic[]): DevdocsJsonResponse {
  return json(status, { error, ...(diagnostics ? { diagnostics } : {}) });
}

/** Match before URL normalization so a dot-segment route cannot become this write endpoint. */
export function isRecomputePath(url: string | undefined): boolean {
  if (!url) return false;
  let raw = url.split(/[?#]/, 1)[0]!;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
    const start = raw.indexOf("/", raw.indexOf("://") + 3);
    raw = start < 0 ? "/" : raw.slice(start);
  }
  return raw === "/__devdocs/recompute";
}

function revisionsOf(snapshots: CollectionSnapshots): Record<string, string> {
  return Object.fromEntries(CONTENT_COLLECTIONS.map(spec => [spec.name, contentRevision(snapshots.get(spec.name)!.text)]));
}

/** Keep every table available to a formula, even when only one record was selected. */
function selectedDiffs(tables: ReadonlyMap<string, unknown>, selection: RecomputeBody): DerivationDiff[] {
  const diffs: DerivationDiff[] = [];
  for (const spec of CONTENT_COLLECTIONS) {
    if (spec.shape !== "array" || (selection.collection !== undefined && selection.collection !== spec.name)) continue;
    for (const row of tables.get(spec.name) as Record<string, unknown>[]) {
      const recordId = String(row[spec.idKey]);
      const tag = row.derivation as { kind?: unknown; inputId?: unknown; sourceInputId?: unknown } | undefined;
      if (!tag || (selection.recordId !== undefined && selection.recordId !== recordId)
        || (selection.kind !== undefined && selection.kind !== tag.kind)) continue;
      const after = deriveRecord(spec.name, row, tables);
      if (!after) continue;
      const before = Object.fromEntries(Object.keys(after).map(key => [key, row[key]]));
      if (!sameValue(before, after)) diffs.push({ collection: spec.name, recordId, kind: String(tag.kind),
        ...(typeof (tag.inputId ?? tag.sourceInputId) === 'string' ? { inputIds: [String(tag.inputId ?? tag.sourceInputId)] } : {}), before, after });
    }
  }
  return diffs;
}

/** Root first, then every input file in registry order, matching ordinary collection writes. */
function withSnapshotLocks<T>(root: string, action: () => Promise<T>): Promise<T> {
  const next = (index: number): Promise<T> => index === CONTENT_COLLECTIONS.length ? action()
    : withFileLock(collectionFile(root, CONTENT_COLLECTIONS[index]!), () => next(index + 1));
  return withFileLock(path.join(root, ".collection-write"), () => next(0));
}

/** Computes patches exclusively from current disk parameters. Client-supplied patches are invalid. */
export function createRecomputeHandler(options: RecomputeHandlerOptions = {}): RecomputeHandler {
  const root = path.resolve(options.contentRoot ?? path.join(repoRoot, "game", "content"));
  return async request => {
    if (!isRecomputePath(request.url)) return undefined;
    if (!isLoopbackDevdocsRequest(request)) return failure(403, "Dev docs API accepts loopback requests only");
    if ((request.method ?? "GET").toUpperCase() !== "POST") return json(405, { error: "Method not allowed" }, { Allow: "POST" });
    const context: ParseContext = { issues: [] };
    const body = bodySchema.parse(request.body, "body", context);
    if (context.issues.length) return failure(422, "Invalid recompute request", context.issues);
    if (body.collection !== undefined && !CONTENT_COLLECTIONS.some(spec => spec.name === body.collection)) return failure(422, "Unknown collection");
    if (body.operation === "apply" && (Object.keys(body.revisions).length !== CONTENT_COLLECTIONS.length
      || CONTENT_COLLECTIONS.some(spec => !Object.hasOwn(body.revisions, spec.name)))) {
      return failure(422, "Apply requires revisions for every registered collection and no extra revisions");
    }
    try {
      return await withSnapshotLocks(root, async () => {
        const snapshots = await loadCollectionSnapshots(root);
        const revisions = revisionsOf(snapshots);
        if (body.operation === "apply" && CONTENT_COLLECTIONS.some(spec => body.revisions[spec.name] !== revisions[spec.name])) {
          return json(409, { error: "Content changed since preview. Preview again before applying.", revisions });
        }
        const tables = new Map<string, unknown>();
        const diagnostics: ApiDiagnostic[] = [];
        for (const spec of CONTENT_COLLECTIONS) {
          const parsed = parseAuthoredCollection(spec, snapshots.get(spec.name)!.data);
          tables.set(spec.name, parsed.data);
          diagnostics.push(...parsed.diagnostics);
        }
        if (diagnostics.some(issue => issue.severity === "error")) return failure(422, "Content failed schema validation", diagnostics);
        let diffs: DerivationDiff[];
        try { diffs = selectedDiffs(tables, body); }
        catch (error) { return failure(422, "Unable to derive selected records", [{ path: "derivation", severity: "error", message: error instanceof Error ? error.message : "Invalid derivation" }]); }
        if (body.operation === "preview" || !diffs.length) return json(200, { diffs, revisions } satisfies RecomputeResponse);

        // Derive all selected fields before validation so locked target drift is repaired first.
        const staged = new Map(snapshots);
        const targets = CONTENT_COLLECTIONS.filter(spec => diffs.some(diff => diff.collection === spec.name));
        for (const spec of targets) {
          const patches = new Map(diffs.filter(diff => diff.collection === spec.name).map(diff => [diff.recordId, diff.after]));
          const rows = snapshots.get(spec.name)!.data as Record<string, unknown>[];
          staged.set(spec.name, { text: snapshots.get(spec.name)!.text, data: rows.map(row => {
            const patch = patches.get(String(row[spec.idKey]));
            return patch ? { ...row, ...patch } : row;
          }) });
        }
        const external = await options.referencePools?.() ?? {};
        for (const spec of targets) {
          // Other target collections use final staged values; this target keeps its original
          // snapshot solely for schema-driven identity comparisons inside the shared validator.
          const validationSnapshots = new Map(staged);
          validationSnapshots.set(spec.name, snapshots.get(spec.name)!);
          const result = validateCollectionOverlay(validationSnapshots, spec, staged.get(spec.name)!.data, "$recompute", external);
          diagnostics.push(...result.diagnostics);
          staged.set(spec.name, { text: formatContentJson(result.data), data: result.data });
        }
        if (diagnostics.some(issue => issue.severity === "error")) return failure(422, "Recomputed content failed validation", diagnostics);

        const attempted: typeof targets = [];
        try {
          for (const spec of targets) {
            attempted.push(spec);
            await atomicReplaceFile(collectionFile(root, spec), staged.get(spec.name)!.text);
          }
        } catch {
          const failed: string[] = [];
          for (const spec of attempted.reverse()) {
            try { await atomicReplaceFile(collectionFile(root, spec), snapshots.get(spec.name)!.text); }
            catch { failed.push(spec.name); }
          }
          if (failed.length) return failure(500, "Recompute write failed and rollback was incomplete", failed.map(name => ({
            path: name, severity: "error", message: "Could not restore the original collection; inspect it before further writes",
          })));
          return failure(500, "Recompute write failed; original collections restored");
        }
        return json(200, { diffs, revisions: revisionsOf(staged) } satisfies RecomputeResponse);
      });
    } catch (error) {
      return failure(error instanceof SyntaxError ? 422 : 500,
        error instanceof SyntaxError ? "Invalid collection JSON" : "Unable to recompute collections");
    }
  };
}
