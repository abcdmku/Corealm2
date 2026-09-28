import { describe, expect, it } from "vitest";
import {
  applyMetaOperation, emptyMetaRecord, MetaActionError, metaCollection, metaDigest, metaText, parseMetaPatch, requestsReport, type MetaFile,
} from "../game/src/content/metaOps.js";

const at = "2026-09-27T12:00:00.000Z";
const revision = "a".repeat(64);

describe("pure authoring metadata operations", () => {
  it("applies notes, statuses, requests and art verdicts with the actor and time given", () => {
    let records: MetaFile = {};
    records = applyMetaOperation(records, "npcs", "smith", {}, { kind: "note", text: "Too loud." }, "acc_x", at);
    records = applyMetaOperation(records, "npcs", "smith", {}, { kind: "status", status: "candidate" }, "acc_x", at);
    records = applyMetaOperation(records, "npcs", "smith", {}, { kind: "request.open", requestId: "r1", requestKind: "audio", text: "Re-record." }, "acc_x", at);
    records = applyMetaOperation(records, "npcs", "smith", {}, { kind: "art", key: "state:idle", verdict: "replace", note: "Stiff." }, "acc_x", at);
    expect(records.smith).toEqual({
      status: "candidate", candidates: [], sourceRefs: [],
      notes: [{ at, by: "acc_x", text: "Too loud." }, { at, by: "acc_x", text: "Re-record.", request: { id: "r1", kind: "audio", state: "open" } }],
      art: { at, by: "acc_x", checks: { "state:idle": { verdict: "replace", note: "Stiff." } } },
      history: [
        { at, by: "acc_x", action: "note.add" }, { at, by: "acc_x", action: "status.set", detail: "candidate" },
        { at, by: "acc_x", action: "request.open", detail: "r1" }, { at, by: "acc_x", action: "art.review", detail: "state:idle replace" },
      ],
    });
    expect(metaDigest(records)).toEqual({ smith: { status: "candidate", openRequests: 1, notes: 2, candidates: 0, artChecks: { "state:idle": "replace" } } });
    expect(requestsReport([{ collection: "npcs", records, revision }]).requests.map(entry => [entry.collection, entry.entityId, entry.request.id]))
      .toEqual([["npcs", "smith", "r1"]]);

    const cleared = applyMetaOperation(records, "npcs", "smith", {}, { kind: "art", key: "state:idle", verdict: "clear", note: "" }, "acc_x", at);
    expect(cleared.smith!.art).toBeUndefined();
  });

  it("refuses a request close for an unknown id and piece notes outside equipment sets", () => {
    expect(() => applyMetaOperation({ ring: emptyMetaRecord() }, "items", "ring", {}, { kind: "request.close", requestId: "nope" }, "a", at))
      .toThrow(new MetaActionError(404, "Unknown request for this entity"));
    expect(() => applyMetaOperation({}, "items", "ring", {}, { kind: "piece", slot: "head", note: "x" }, "a", at))
      .toThrow("Piece notes are available only for equipment sets");
  });

  it("parses patches, maps inspection collections, and writes ids in order", () => {
    expect(parseMetaPatch({ revision, operation: { kind: "note", text: "ok" } })).toEqual({ patch: { revision, operation: { kind: "note", text: "ok" } } });
    expect("issues" in parseMetaPatch({ revision: "stale", operation: { kind: "note", text: "ok" } })).toBe(true);
    expect("issues" in parseMetaPatch({ revision, operation: { kind: "status", status: "live" } })).toBe(true);
    expect(metaCollection("compiled-items")?.name).toBe("items");
    expect(metaCollection("assets")?.name).toBe("assets");
    expect(metaCollection("balance/sets")?.name).toBe("balance/sets");
    expect(metaCollection("nonsense")).toBeUndefined();
    expect(Object.keys(JSON.parse(metaText({ b: emptyMetaRecord(), a: emptyMetaRecord() }, "items")))).toEqual(["a", "b"]);
  });
});
