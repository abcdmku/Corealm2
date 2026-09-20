import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionResponse, ContentTransactionRequest, ContentTransactionResponse } from "../devdocs/shared/contracts.js";
import { COALESCE_MS, HISTORY_LIMIT, changedPath, createDraftStore, draftKey, lineDiff, type Contributor, type DraftStore } from "../devdocs/src/model/store.js";
import { setBackend } from "../devdocs/src/api/backend.js";
import { createRepoBackend } from "../devdocs/src/api/repoBackend.js";

/*
  The draft store is plain TypeScript: no React, no DOM. These tests drive it the way the hook and
  the shell save bar do (adopt server data, commit edits, save) against a mocked fetch.
*/

type Row = Record<string, unknown>;
const tierA = { id: "tier_1", name: "Tier one", reqLevel: 1, equipment: [{ id: "sword", name: "Sword" }] };
const tierB = { id: "tier_2", name: "Tier two", reqLevel: 5, equipment: [] as Row[] };
const sword = { id: "worn_sword", name: "Worn Shortsword", description: "old" };

function collectionResponse(name: string, rows: Row[], revision: string): CollectionResponse {
  return { collection: { name, count: rows.length, editable: true, idKey: "id", shape: "array" }, revision, data: rows };
}
function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return { ok: status < 300, status, json: async () => body, text: async () => text } as unknown as Response;
}
function adoptTiers(store: DraftStore, revision = "p1"): void {
  store.adopt({ collection: "progression", id: "tier_1", objectShaped: false, record: tierA, revision });
  store.adopt({ collection: "progression", id: "tier_2", objectShaped: false, record: tierB, revision });
}
const requests: ContentTransactionRequest[] = [];
let responses: Response[] = [];
let store: DraftStore;
const toasts: string[] = [];

beforeEach(() => {
  setBackend(createRepoBackend());
  store = createDraftStore();
  store.configure({ notify: { success: message => { toasts.push(message); }, error: message => { toasts.push(`error: ${message}`); }, message: message => { toasts.push(`message: ${message}`); } } });
  requests.length = 0; toasts.length = 0; responses = [];
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-15T12:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.body) requests.push(JSON.parse(String(init.body)) as ContentTransactionRequest);
    const next = responses.shift();
    if (!next) throw new Error("No mocked response left");
    return next;
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe("commit, undo, redo", () => {
  it("keeps one step per commit and restores drafts in order", () => {
    adoptTiers(store);
    const key = draftKey("progression", "tier_1");
    store.commit(key, { ...tierA, reqLevel: 2 }, "reqLevel");
    vi.advanceTimersByTime(COALESCE_MS + 1);
    store.commit(key, { ...tierA, reqLevel: 2, name: "Renamed" }, "name");
    expect(store.entry(key)?.dirty).toBe(true);
    expect(store.undoLabel()).toBe("name");

    expect(store.undo()?.label).toBe("name");
    expect(store.entry(key)?.draft).toEqual({ ...tierA, reqLevel: 2 });
    expect(store.undo()?.label).toBe("reqLevel");
    expect(store.entry(key)?.draft).toEqual(tierA);
    expect(store.entry(key)?.dirty).toBe(false);
    expect(store.undo()).toBeUndefined();

    expect(store.redo()?.label).toBe("reqLevel");
    expect(store.redoLabel()).toBe("name");
    expect(store.redo()?.label).toBe("name");
    expect(store.entry(key)?.draft).toEqual({ ...tierA, reqLevel: 2, name: "Renamed" });
    expect(store.redo()).toBeUndefined();
  });

  it("drops the redo stack on a new commit and caps history", () => {
    adoptTiers(store);
    const key = draftKey("progression", "tier_1");
    store.commit(key, { ...tierA, reqLevel: 2 }, "reqLevel");
    store.undo();
    expect(store.redoLabel()).toBe("reqLevel");
    store.commit(key, { ...tierA, name: "Other" }, "name");
    expect(store.redoLabel()).toBeUndefined();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) { vi.advanceTimersByTime(COALESCE_MS + 1); store.commit(key, { ...tierA, reqLevel: i }, `step ${i}`); }
    expect(store.getSnapshot().undo).toHaveLength(HISTORY_LIMIT);
  });

  it("derives the label from the changed leaf when the caller passes none", () => {
    adoptTiers(store);
    const key = draftKey("progression", "tier_1");
    store.commit(key, { ...tierA, equipment: [{ id: "sword", name: "Long sword" }] });
    expect(store.undoLabel()).toBe("equipment.0.name");
    expect(changedPath({ a: 1, b: 2 }, { a: 2, b: 3 })).toBe("");
  });
});

describe("coalescing", () => {
  it("merges consecutive commits with one label inside the window, and not across labels or after it", () => {
    adoptTiers(store);
    const key = draftKey("progression", "tier_1");
    store.commit(key, { ...tierA, name: "T" }, "name");
    vi.advanceTimersByTime(200);
    store.commit(key, { ...tierA, name: "Ti" }, "name");
    vi.advanceTimersByTime(200);
    store.commit(key, { ...tierA, name: "Tie" }, "name");
    expect(store.getSnapshot().undo).toHaveLength(1);
    // A different label starts a new step even inside the window.
    store.commit(key, { ...tierA, name: "Tie", reqLevel: 3 }, "reqLevel");
    expect(store.getSnapshot().undo).toHaveLength(2);
    // The same label after the window is a new step too.
    vi.advanceTimersByTime(COALESCE_MS + 1);
    store.commit(key, { ...tierA, name: "Tie", reqLevel: 4 }, "reqLevel");
    expect(store.getSnapshot().undo).toHaveLength(3);
    // Undoing the merged step goes back to the original name in one go.
    store.undo(); store.undo(); store.undo();
    expect(store.entry(key)?.draft).toEqual(tierA);
  });

  it("does not merge commits to different records", () => {
    adoptTiers(store);
    store.commit(draftKey("progression", "tier_1"), { ...tierA, name: "A" }, "name");
    store.commit(draftKey("progression", "tier_2"), { ...tierB, name: "B" }, "name");
    expect(store.getSnapshot().undo).toHaveLength(2);
  });
});

describe("saveAll", () => {
  it("writes two records of one collection as one transaction with one revision", async () => {
    adoptTiers(store);
    store.adopt({ collection: "items", id: "worn_sword", objectShaped: false, record: sword, revision: "i1" });
    const nextA = { ...tierA, reqLevel: 2 }, nextB = { ...tierB, reqLevel: 6 }, nextSword = { ...sword, description: "new" };
    store.commit(draftKey("progression", "tier_1"), nextA, "reqLevel");
    store.commit(draftKey("progression", "tier_2"), nextB, "reqLevel");
    store.commit(draftKey("items", "worn_sword"), nextSword, "description");
    const body: ContentTransactionResponse = { revision: "c2", affected: [], diagnostics: [], compiled: {}, collections: [collectionResponse("progression", [nextA, nextB], "p2"), collectionResponse("items", [nextSword], "i2")] };
    responses = [jsonResponse(200, body)];

    expect(await store.saveAll()).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      operation: "save",
      revisions: { progression: "p1", items: "i1" },
      changes: [
        { kind: "put", collection: "progression", id: "tier_1", record: nextA },
        { kind: "put", collection: "progression", id: "tier_2", record: nextB },
        { kind: "put", collection: "items", id: "worn_sword", record: nextSword },
      ],
    });
    expect(store.dirtyEntries()).toEqual([]);
    expect(store.entry(draftKey("progression", "tier_1"))).toMatchObject({ revision: "p2", base: nextA, draft: nextA, saving: false });
    expect(store.entry(draftKey("items", "worn_sword"))).toMatchObject({ revision: "i2", base: nextSword });
    expect(toasts).toEqual(["Saved 3 records"]);
  });

  it("saves one record on its own and rebases the other dirty record of the same collection", async () => {
    adoptTiers(store);
    const nextA = { ...tierA, reqLevel: 2 }, nextB = { ...tierB, reqLevel: 6 };
    store.commit(draftKey("progression", "tier_1"), nextA, "reqLevel");
    store.commit(draftKey("progression", "tier_2"), nextB, "reqLevel");
    responses = [jsonResponse(200, { revision: "c2", affected: [], diagnostics: [], compiled: {}, collections: [collectionResponse("progression", [nextA, tierB], "p2")] })];
    expect(await store.save(draftKey("progression", "tier_1"))).toBe(true);
    expect(requests[0]?.changes).toHaveLength(1);
    const other = store.entry(draftKey("progression", "tier_2"));
    expect(other).toMatchObject({ dirty: true, revision: "p2", draft: nextB, base: tierB });
    expect(toasts).toEqual(["Saved 1 record"]);
  });

  it("returns false and sends nothing when nothing is dirty", async () => {
    adoptTiers(store);
    expect(await store.saveAll()).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("marks only the stale collection's records as conflicts on 409 and loads the disk copy", async () => {
    adoptTiers(store);
    store.adopt({ collection: "items", id: "worn_sword", objectShaped: false, record: sword, revision: "i1" });
    const nextA = { ...tierA, reqLevel: 2 }, nextSword = { ...sword, description: "mine" };
    store.commit(draftKey("progression", "tier_1"), nextA, "reqLevel");
    store.commit(draftKey("items", "worn_sword"), nextSword, "description");
    const onDisk = { ...sword, description: "theirs" };
    responses = [
      jsonResponse(409, { error: "Content changed. Your draft has been preserved.", revisions: { progression: "p1", items: "i9" } }),
      jsonResponse(200, collectionResponse("items", [onDisk], "i9")),
    ];
    expect(await store.saveAll()).toBe(false);
    await flush();
    const conflicted = store.entry(draftKey("items", "worn_sword"));
    expect(conflicted).toMatchObject({ conflict: true, dirty: true, draft: nextSword, saving: false, server: { revision: "i9", record: onDisk } });
    expect(conflicted?.saveError).toContain("Worn Shortsword changed on disk");
    expect(store.entry(draftKey("progression", "tier_1"))).toMatchObject({ conflict: false, dirty: true, saving: false });
    expect(store.entry(draftKey("progression", "tier_1"))?.saveError).toBe("Content changed. Your draft has been preserved.");

    // Overwrite re-sends with the disk revision; reload drops the draft for the disk record.
    responses = [jsonResponse(200, { revision: "c3", affected: [], diagnostics: [], compiled: {}, collections: [collectionResponse("items", [nextSword], "i10")] })];
    expect(await store.resolveConflict(draftKey("items", "worn_sword"), "overwrite")).toBe(true);
    expect(requests[1]?.revisions).toEqual({ items: "i9" });
    expect(store.entry(draftKey("items", "worn_sword"))).toMatchObject({ conflict: false, dirty: false, revision: "i10" });
  });

  it("reload takes the disk record and is undoable", async () => {
    store.adopt({ collection: "items", id: "worn_sword", objectShaped: false, record: sword, revision: "i1" });
    const key = draftKey("items", "worn_sword");
    const mine = { ...sword, description: "mine" }, theirs = { ...sword, description: "theirs" };
    store.commit(key, mine, "description");
    responses = [jsonResponse(409, { error: "changed", revisions: { items: "i2" } }), jsonResponse(200, collectionResponse("items", [theirs], "i2"))];
    await store.saveAll();
    await flush();
    expect(await store.resolveConflict(key, "reload")).toBe(true);
    expect(store.entry(key)).toMatchObject({ conflict: false, dirty: false, draft: theirs, base: theirs, revision: "i2" });
    expect(store.undoLabel()).toBe("Reload");
    store.undo();
    expect(store.entry(key)).toMatchObject({ dirty: true, draft: mine, base: theirs });
  });

  it("attaches 422 diagnostics to the record they name", async () => {
    adoptTiers(store);
    store.commit(draftKey("progression", "tier_1"), { ...tierA, reqLevel: -1 }, "reqLevel");
    store.commit(draftKey("progression", "tier_2"), { ...tierB, reqLevel: 7 }, "reqLevel");
    responses = [jsonResponse(422, { error: "Content failed validation.", diagnostics: [{ path: "progression[tier_1].reqLevel", message: "must be positive", severity: "error" }] })];
    expect(await store.saveAll()).toBe(false);
    expect(store.entry(draftKey("progression", "tier_1"))?.diagnostics).toEqual([{ path: "progression[tier_1].reqLevel", message: "must be positive", severity: "error" }]);
    expect(store.entry(draftKey("progression", "tier_2"))?.diagnostics).toEqual([]);
    expect(store.entry(draftKey("progression", "tier_2"))?.saveError).toBe("Content failed validation.");
  });

  it("includes dirty contributors in the same transaction and tells them about the result", async () => {
    adoptTiers(store);
    store.commit(draftKey("progression", "tier_1"), { ...tierA, reqLevel: 2 }, "reqLevel");
    const afterSave = vi.fn(), reset = vi.fn();
    let dirty = true;
    const contributor: Contributor = {
      key: "world/map", label: "World map",
      isDirty: () => dirty, count: () => 2,
      operations: () => [{ kind: "put", collection: "placements", id: "p1", record: { id: "p1" } }, { kind: "delete", collection: "encounters", id: "e1" }],
      revisions: () => ({ placements: "pl1", encounters: "en1" }),
      reset, afterSave,
    };
    const unregister = store.registerContributor(contributor);
    expect(store.isDirty()).toBe(true);
    const body: ContentTransactionResponse = { revision: "c2", affected: [], diagnostics: [], compiled: {}, collections: [collectionResponse("progression", [{ ...tierA, reqLevel: 2 }, tierB], "p2")] };
    responses = [jsonResponse(200, body)];
    expect(await store.saveAll()).toBe(true);
    expect(requests[0]?.revisions).toEqual({ progression: "p1", placements: "pl1", encounters: "en1" });
    expect(requests[0]?.changes.map(change => `${change.kind}:${change.collection}/${change.id}`)).toEqual(["put:progression/tier_1", "put:placements/p1", "delete:encounters/e1"]);
    expect(afterSave).toHaveBeenCalledWith(body);
    expect(toasts).toEqual(["Saved 3 records"]);

    dirty = false;
    store.touch();
    expect(store.dirtyContributors()).toEqual([]);
    store.resetAll();
    expect(reset).not.toHaveBeenCalled();
    unregister();
    expect(store.getSnapshot().contributors.size).toBe(0);
  });

  it("stops the whole save when a contributor cannot produce operations", async () => {
    adoptTiers(store);
    store.commit(draftKey("progression", "tier_1"), { ...tierA, reqLevel: 2 }, "reqLevel");
    store.registerContributor({ key: "editor", label: "Editor", isDirty: () => true, operations: () => { throw new Error("Check the highlighted fields."); }, revisions: () => ({}), reset() {}, afterSave() {} });
    expect(await store.saveAll()).toBe(false);
    expect(requests).toHaveLength(0);
    expect(store.getSnapshot().error).toBe("Check the highlighted fields.");
  });
});

describe("adopting server data", () => {
  it("keeps a dirty draft, adopts clean records, and announces a disk change once", () => {
    adoptTiers(store);
    const key = draftKey("progression", "tier_1");
    store.commit(key, { ...tierA, reqLevel: 2 }, "reqLevel");
    const onDisk = { ...tierA, name: "Edited by an agent" };
    store.adopt({ collection: "progression", id: "tier_1", objectShaped: false, record: onDisk, revision: "p2" });
    expect(store.entry(key)).toMatchObject({ dirty: true, draft: { ...tierA, reqLevel: 2 }, revision: "p1", server: { revision: "p2", record: onDisk } });
    expect(toasts).toEqual([]);

    store.adopt({ collection: "progression", id: "tier_2", objectShaped: false, record: { ...tierB, name: "Agent tier" }, revision: "p2" });
    store.adopt({ collection: "progression", id: "tier_2", objectShaped: false, record: { ...tierB, name: "Agent tier" }, revision: "p2" });
    expect(store.entry(draftKey("progression", "tier_2"))).toMatchObject({ dirty: false, draft: { ...tierB, name: "Agent tier" }, revision: "p2" });
    expect(toasts).toEqual(["message: Agent tier updated on disk"]);
  });

  it("reset drops the draft and records a Discard step", () => {
    adoptTiers(store);
    const key = draftKey("progression", "tier_1");
    store.commit(key, { ...tierA, reqLevel: 2 }, "reqLevel");
    store.reset(key);
    expect(store.entry(key)).toMatchObject({ dirty: false, draft: tierA });
    expect(store.undoLabel()).toBe("Discard");
  });
});

describe("lineDiff", () => {
  it("marks added, removed and unchanged lines", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { kind: "same", text: "a" }, { kind: "del", text: "b" }, { kind: "add", text: "B" }, { kind: "same", text: "c" }, { kind: "add", text: "d" },
    ]);
  });
});
