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

  it("claims and replies to a request, claiming an open one on reply, and refuses another claimer", () => {
    const opened = applyMetaOperation({}, "npcs", "smith", {}, { kind: "request.open", requestId: "r1", requestKind: "text", text: "Shorter." }, "acc_a", at);
    const later = "2026-09-27T13:00:00.000Z";
    const claimed = applyMetaOperation(structuredClone(opened), "npcs", "smith", {}, { kind: "request.claim", requestId: "r1" }, "acc_b", later);
    expect(claimed.smith!.notes[0]!.request).toEqual({ id: "r1", kind: "text", state: "claimed", claimedBy: "acc_b", claimedAt: later });
    expect(() => applyMetaOperation(structuredClone(claimed), "npcs", "smith", {}, { kind: "request.claim", requestId: "r1" }, "acc_c", later))
      .toThrow(new MetaActionError(400, "Request r1 is claimed by acc_b"));
    expect(() => applyMetaOperation(structuredClone(claimed), "npcs", "smith", {}, { kind: "request.reply", requestId: "r1", text: "Done." }, "acc_c", later))
      .toThrow(new MetaActionError(400, "Only the current claimer may reply to claimed request r1"));

    const replied = applyMetaOperation(structuredClone(opened), "npcs", "smith", {}, { kind: "request.reply", requestId: "r1", text: "Trimmed it." }, "acc_b", later);
    expect(replied.smith!.notes[0]!.request).toEqual({ id: "r1", kind: "text", state: "replied", claimedBy: "acc_b", claimedAt: later, reply: "Trimmed it.", repliedAt: later });
    expect(replied.smith!.history.map(entry => entry.action)).toEqual(["request.open", "request.claim", "request.reply"]);
    // A replied request leaves the queue; the requester closes it.
    expect(requestsReport([{ collection: "npcs", records: replied, revision }]).requests).toEqual([]);
    expect(applyMetaOperation(replied, "npcs", "smith", {}, { kind: "request.close", requestId: "r1" }, "acc_a", later).smith!.notes[0]!.request!.state).toBe("closed");

    expect(() => applyMetaOperation(structuredClone(opened), "npcs", "other", {}, { kind: "request.claim", requestId: "r1" }, "acc_b", later))
      .toThrow(new MetaActionError(404, "Unknown request for this entity"));
    expect(parseMetaPatch({ revision, operation: { kind: "request.reply", requestId: "r1", text: "ok" } })).toEqual({ patch: { revision, operation: { kind: "request.reply", requestId: "r1", text: "ok" } } });
    expect("issues" in parseMetaPatch({ revision, operation: { kind: "request.reply", requestId: "r1", text: " " } })).toBe(true);
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
