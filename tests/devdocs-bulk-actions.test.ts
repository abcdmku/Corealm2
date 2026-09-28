import { beforeEach, describe, expect, it } from "vitest";
import { setBackend, type BackendTransaction, type DevdocsBackend } from "../devdocs/src/api/backend.js";
import { AdminFailure } from "../devdocs/src/api/session.js";
import { applyBulk, previewBulk } from "../devdocs/src/dev/bulkActions.js";
import type { ContentTransactionRequest } from "../devdocs/shared/contracts.js";
import type { MetaPatch } from "../devdocs/shared/metaContracts.js";
import { META_CONFLICT_MESSAGE } from "../game/src/content/metaOps.js";

/**
 * Bulk actions are worked out in the browser and sent through whichever backend is installed:
 * metadata as one `patchMeta` per record, a retier as one transaction. The fake backend below keeps a
 * metadata store with a revision, as both real stores do, and records what it was sent.
 */
const rev = (n: number) => String(n).padStart(64, "0");
const rows = [{ id: "a", tier: 1 }, { id: "b", tier: 2 }, { id: "c", tier: 3 }];

let meta: { revision: number; records: Record<string, { status: string; notes: number }> };
let patches: { entityId: string; patch: MetaPatch }[];
let transactions: ContentTransactionRequest[];
let answer: (request: ContentTransactionRequest) => BackendTransaction;
/** Throws for this record, as a concurrent edit or a server refusal would. */
let failOn: { id: string; error: Error } | undefined;

beforeEach(() => {
  meta = { revision: 1, records: { a: { status: "candidate", notes: 2 } } };
  patches = []; transactions = []; failOn = undefined;
  answer = request => ({ ok: true, body: { revision: rev(9), collections: [], affected: [], diagnostics: request.operation === "preview" ? [{ path: "items.b", message: "Tier 7 has no recipes yet", severity: "warning" }] : [], compiled: null } });
  setBackend({
    kind: "server", label: "test", assetBaseUrl: "",
    capabilities: { write: true, meta: true, requests: true, git: false, bulk: true, assets: false, formulas: false, files: true, imagegen: false, publish: true },
    async get<T>(path: string): Promise<T> {
      expect(path).toBe("meta/items/%24all");
      return { collection: "items", revision: rev(meta.revision), records: Object.fromEntries(Object.entries(meta.records).map(([id, record]) => [id, { status: record.status, openRequests: 0, notes: record.notes, candidates: 0 }])) } as T;
    },
    async patchMeta(collection, entityId, patch) {
      expect(collection).toBe("items");
      if (failOn?.id === entityId) throw failOn.error;
      if (patch.revision !== rev(meta.revision)) throw new Error(META_CONFLICT_MESSAGE);
      patches.push({ entityId, patch });
      const record = meta.records[entityId] ??= { status: "draft", notes: 0 };
      if (patch.operation.kind === "status") record.status = patch.operation.status;
      if (patch.operation.kind === "note") record.notes++;
      meta.revision++;
      return { collection, entityId, revision: rev(meta.revision), data: {} as never };
    },
    async transact(request) { transactions.push(request); return answer(request); },
  } as Partial<DevdocsBackend> as DevdocsBackend);
});

const selection = (action: Parameters<typeof previewBulk>[0]["action"]) => ({ collection: "items", idKey: "id", revision: rev(5), rows, action });

describe("bulk actions through the backend", () => {
  it("previews a status change from the digest and applies it one record at a time, each patch naming the revision the last one left", async () => {
    const planned = await previewBulk(selection({ kind: "status", status: "candidate" }));
    expect(planned).toEqual({ ok: true, value: { collection: "items", action: { kind: "status", status: "candidate" }, diagnostics: [], revisions: { content: rev(5), meta: rev(1) },
      diffs: [{ recordId: "b", before: { status: "draft" }, after: { status: "candidate" } }, { recordId: "c", before: { status: "draft" }, after: { status: "candidate" } }] } });
    expect(await applyBulk(planned.ok ? planned.value : never())).toEqual({ ok: true, value: 2 });
    expect(patches).toEqual([
      { entityId: "b", patch: { revision: rev(1), operation: { kind: "status", status: "candidate" } } },
      { entityId: "c", patch: { revision: rev(2), operation: { kind: "status", status: "candidate" } } },
    ]);
    expect(Object.values(meta.records).map(record => record.status)).toEqual(["candidate", "candidate", "candidate"]);
  });

  it("adds a note to every selected record", async () => {
    const planned = await previewBulk(selection({ kind: "note", text: "Check scale", label: "art" }));
    expect(planned.ok && planned.value.diffs[0]).toEqual({ recordId: "a", before: { notesCount: 2 }, after: { notesCount: 3, note: { text: "Check scale", label: "art" } } });
    expect(await applyBulk(planned.ok ? planned.value : never())).toEqual({ ok: true, value: 3 });
    expect(patches.map(entry => entry.patch.operation)).toEqual(Array(3).fill({ kind: "note", text: "Check scale", label: "art" }));
  });

  it("refuses an apply whose metadata moved since the preview, and says how far a run got when it stops part way", async () => {
    const planned = await previewBulk(selection({ kind: "note", text: "x" }));
    meta.revision = 7;
    expect(await applyBulk(planned.ok ? planned.value : never())).toEqual({ ok: false, refusal: { conflict: true, diagnostics: [], applied: 0,
      message: "The content or metadata changed after this preview. Preview again before applying." } });

    const again = await previewBulk(selection({ kind: "note", text: "x" }));
    failOn = { id: "b", error: new AdminFailure(409, "stale", "stale") };
    expect(await applyBulk(again.ok ? again.value : never())).toEqual({ ok: false, refusal: { conflict: true, diagnostics: [], applied: 1,
      message: "Updated 1 of 3 before stopping at b. The content or metadata changed after this preview. Preview again before applying." } });
  });

  it("retiers the changed rows in one checked transaction, saved against the revision they were read at", async () => {
    const planned = await previewBulk(selection({ kind: "retier", tier: 2 }));
    expect(planned.ok && planned.value.diffs).toEqual([{ recordId: "a", before: { tier: 1 }, after: { tier: 2 } }, { recordId: "c", before: { tier: 3 }, after: { tier: 2 } }]);
    expect(planned.ok && planned.value.diagnostics).toEqual([{ path: "items.b", message: "Tier 7 has no recipes yet", severity: "warning" }]);
    expect(await applyBulk(planned.ok ? planned.value : never())).toEqual({ ok: true, value: 2 });
    const changes = [{ kind: "put", collection: "items", id: "a", record: { id: "a", tier: 2 } }, { kind: "put", collection: "items", id: "c", record: { id: "c", tier: 2 } }];
    expect(transactions).toEqual([{ operation: "preview", revisions: { items: rev(5) }, changes }, { operation: "save", revisions: { items: rev(5) }, changes }]);
    expect(patches).toEqual([]);
  });

  it("marks a retier stale when the collection moved, and shows the refusal of an invalid one", async () => {
    answer = () => ({ ok: false, status: 409, body: { error: "stale" } });
    expect(await previewBulk(selection({ kind: "retier", tier: 4 }))).toEqual({ ok: false, refusal: { conflict: true, diagnostics: [], message: "The content or metadata changed after this preview. Preview again before applying." } });
    answer = () => ({ ok: false, status: 422, body: { error: "Content failed validation.", diagnostics: [{ path: "items.a.tier", message: "No tier 40", severity: "error" }] } });
    expect(await previewBulk(selection({ kind: "retier", tier: 40 }))).toEqual({ ok: false, refusal: { conflict: false, message: "Content failed validation.",
      diagnostics: [{ path: "items.a.tier", message: "No tier 40", severity: "error" }] } });
    // Nothing to change sends nothing.
    transactions = [];
    const planned = await previewBulk({ ...selection({ kind: "retier", tier: 2 }), rows: [{ id: "b", tier: 2 }] });
    expect(planned.ok && planned.value.diffs).toEqual([]);
    expect(transactions).toEqual([]);
  });
});

function never(): never { throw new Error("expected a plan"); }
