import { describe, expect, it } from "vitest";
import { emptyMetaRecord, MetaRevisionConflict, type MetaFile } from "../tools/content/meta.js";
import {
  claimRequest, executeRequests, formatRequests, listRequests, openRequest, parseRequestsArgs, replyToRequest,
  type RequestsStore,
} from "../tools/content/requests.js";

const at = "2026-09-13T12:00:00.000Z";
const later = "2026-09-13T12:30:00.000Z";
const action = { requestId: "fix-ring", actor: "agent-a", at: later };
function fixture(): MetaFile {
  const base = { ring: emptyMetaRecord("live"), sword: emptyMetaRecord() };
  base.ring.notes.push({ at, by: "Borg", text: "Keep this earlier note.", label: "reference" });
  base.ring.history.push({ at, by: "Borg", action: "import" });
  return openRequest(base, { entityId: "ring", requestId: action.requestId, kind: "art", text: "Repair the icon.", label: "icon", actor: "Borg", at });
}

describe("request operations", () => {
  it("opens an immutable request and keeps notes, status and history", () => {
    const before = { ring: emptyMetaRecord("live") };
    const next = openRequest(before, { entityId: "ring", requestId: "request-1", kind: "text", text: "Correct the name.", actor: "Borg", at });
    expect(before.ring.notes).toEqual([]);
    expect(next.ring!.status).toBe("live");
    expect(next.ring!.notes[0]).toMatchObject({ at, by: "Borg", text: "Correct the name.", request: { id: "request-1", state: "open" } });
    expect(next.ring!.history).toEqual([{ at, by: "Borg", action: "request.open", detail: "request-1" }]);
  });

  it("claims once, keeps the first claim time and rejects another actor", () => {
    const original = fixture();
    const claimed = claimRequest(original, action);
    expect(listRequests(original)[0]!.request.state).toBe("open");
    expect(listRequests(claimed)[0]!.request).toMatchObject({ state: "claimed", claimedBy: action.actor, claimedAt: later });
    expect(claimRequest(claimed, { ...action, at: "2026-09-13T13:00:00.000Z" })).toEqual(claimed);
    expect(() => claimRequest(claimed, { ...action, actor: "agent-b" })).toThrow(/claimed by agent-a/);
  });

  it("accepts only the current claimer's reply and preserves original note timestamps", () => {
    const opened = fixture();
    expect(() => replyToRequest(opened, { ...action, text: "Done" })).toThrow(/current claimer/);
    const claimed = claimRequest(opened, action);
    expect(() => replyToRequest(claimed, { ...action, actor: "agent-b", text: "Done" })).toThrow(/current claimer/);
    const replied = replyToRequest(claimed, { ...action, text: "Updated icon; ready for review." });
    expect(listRequests(replied)).toEqual([]);
    const row = listRequests(replied, { states: ["replied"] })[0]!;
    expect(row.note).toEqual({ at, by: "Borg", text: "Repair the icon.", label: "icon" });
    expect(row.request).toMatchObject({ state: "replied", reply: "Updated icon; ready for review.", repliedAt: later, claimedAt: later });
    expect(row.request).not.toHaveProperty("closedAt");
    expect(replied.ring!.status).toBe("live");
    expect(replied.ring!.notes[0]).toEqual(opened.ring!.notes[0]);
    expect(replied.ring!.history.slice(0, opened.ring!.history.length)).toEqual(opened.ring!.history);
    expect(replied.ring!.history.at(-1)).toMatchObject({ action: "request.reply", by: "agent-a", at: later });
    expect(() => claimRequest(replied, action)).toThrow(/replied/);
    expect(() => replyToRequest(replied, { ...action, text: "Overwrite" })).toThrow(/current claimer/);
  });

  it("rejects nonexistent entities and requests", () => {
    expect(() => openRequest(fixture(), { entityId: "missing", requestId: "new", kind: "art", text: "Fix", actor: "Borg", at })).toThrow(/Unknown entity/);
    expect(() => claimRequest(fixture(), { ...action, requestId: "missing" })).toThrow(/Unknown request/);
    expect(() => replyToRequest(fixture(), { ...action, requestId: "missing", text: "Done" })).toThrow(/Unknown request/);
  });

  it("rejects duplicate IDs across entities, including closed requests", () => {
    const records = fixture();
    expect(() => openRequest(records, { entityId: "sword", requestId: action.requestId, kind: "art", text: "Fix", actor: "Borg", at })).toThrow(/Duplicate request id/);
    records.sword!.notes.push(structuredClone(records.ring!.notes[1]!));
    records.sword!.notes[0]!.request!.state = "closed";
    expect(() => listRequests(records)).toThrow(/Duplicate request id/);
    expect(() => claimRequest(records, action)).toThrow(/Duplicate request id/);
    expect(() => replyToRequest(records, { ...action, text: "Done" })).toThrow(/Duplicate request id/);
  });

  it("rejects blank actors, blank replies and invalid timestamps", () => {
    expect(() => claimRequest(fixture(), { ...action, actor: " " })).toThrow(/actor/);
    expect(() => claimRequest(fixture(), { ...action, at: "yesterday" })).toThrow(/ISO/);
    expect(() => replyToRequest(claimRequest(fixture(), action), { ...action, text: " " })).toThrow(/text/);
  });
});

function memoryStore(initial: MetaFile = fixture()) {
  let records = structuredClone(initial);
  let revision = "revision-1";
  let writes = 0;
  const store: RequestsStore = {
    async collections() { return ["items"]; },
    async read() { return { records: structuredClone(records), revision }; },
    async hasEntity(_collection, entityId) { return ["ring", "sword", "new-ring"].includes(entityId); },
    async update(_collection, expected, change) {
      if (expected !== revision) throw new MetaRevisionConflict();
      const next = await change(structuredClone(records));
      records = next;
      revision = `revision-${++writes + 1}`;
      return { records: structuredClone(records), revision };
    },
  };
  return { store, writes: () => writes };
}

describe("requests CLI", () => {
  const claim = ["claim", "--collection", "items", "--id", "fix-ring", "--actor", "agent-a", "--revision", "revision-1"];

  it("defaults to open and claimed requests, reports revisions and supports both output formats", async () => {
    const { store } = memoryStore();
    const options = parseRequestsArgs([]);
    const report = await executeRequests(options, store, at);
    expect(report.revisions).toEqual({ items: "revision-1" });
    expect(report.requests[0]).toMatchObject({ collection: "items", entityId: "ring", request: { state: "open" } });
    expect(JSON.parse(formatRequests(report, "json"))).toEqual(report);
    expect(formatRequests(report, "markdown")).toContain("items revision: revision-1");
    expect(formatRequests(report, "markdown")).toContain("Repair the icon.");
    expect(parseRequestsArgs(["--json"]).format).toBe("json");
    expect(parseRequestsArgs(["list", "--all", "--markdown"]).all).toBe(true);
  });

  it("requires explicit actor and revision and exposes no close or approve command", () => {
    expect(() => parseRequestsArgs(claim.slice(0, -2))).toThrow(/revision/);
    expect(() => parseRequestsArgs(["claim", "--collection", "items", "--id", "x", "--revision", "r"])).toThrow(/actor/);
    expect(() => parseRequestsArgs(["close"])).toThrow(/Unknown request action/);
    expect(() => parseRequestsArgs(["approve"])).toThrow(/Unknown request action/);
    expect(() => parseRequestsArgs(["--json", "--markdown"])).toThrow(/either/);
    expect(() => parseRequestsArgs(["--collection", "items", "--collection", "npcs"])).toThrow(/Repeated/);
    expect(() => parseRequestsArgs(["list", "--actor", "agent-a"])).toThrow(/not valid/);
  });

  it("passes revisions to storage and refuses a stale second claim without writing", async () => {
    const { store, writes } = memoryStore();
    const result = await executeRequests(parseRequestsArgs(claim), store, later);
    expect(result.revisions.items).toBe("revision-2");
    expect(result.requests[0]!.request.claimedBy).toBe("agent-a");
    await expect(executeRequests(parseRequestsArgs(claim), store, later)).rejects.toThrow(/Metadata changed/);
    expect(writes()).toBe(1);
  });

  it("creates initial metadata only for verified content entities", async () => {
    const { store, writes } = memoryStore({});
    const args = ["open", "--collection", "items", "--entity", "new-ring", "--id", "new", "--kind", "art", "--text", "Fix art", "--actor", "Borg", "--revision", "revision-1"];
    const result = await executeRequests(parseRequestsArgs(args), store, at);
    expect(result.requests[0]!.entityId).toBe("new-ring");
    expect((await store.read("items")).records["new-ring"]!.status).toBe("draft");
    const bad = parseRequestsArgs(args);
    bad.entity = "missing";
    bad.revision = "revision-2";
    await expect(executeRequests(bad, store, at)).rejects.toThrow(/Unknown entity/);
    expect(writes()).toBe(1);
  });

  it("prints a reply awaiting human review even though default list excludes replied requests", async () => {
    const { store } = memoryStore(claimRequest(fixture(), action));
    const args = ["reply", "--collection", "items", "--id", "fix-ring", "--actor", "agent-a", "--revision", "revision-1", "--text", "Ready for review"];
    const result = await executeRequests(parseRequestsArgs(args), store, later);
    expect(result.requests[0]!.request.state).toBe("replied");
    expect(formatRequests(result, "markdown")).toContain("Reply: Ready for review");
    expect((await executeRequests(parseRequestsArgs([]), store)).requests).toEqual([]);
    expect((await executeRequests(parseRequestsArgs(["--all"]), store)).requests).toHaveLength(1);
  });
});
