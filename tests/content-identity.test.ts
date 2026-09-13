import { describe, expect, it } from "vitest";
import { checkIdentity } from "../tools/content/identity.js";
import { arr, id, int, obj, str } from "../game/src/content/schema/core.js";

describe("content save identity", () => {
  it("allows authored stat edits and detects a rename", () => {
    expect(checkIdentity([{ id: "a", hp: 2 }], [{ id: "a", hp: 3 }], "enemies")).toEqual([]);
    expect(checkIdentity([{ id: "a" }], [{ id: "b" }], "enemies")).toHaveLength(2);
  });
  it("locks spawn order, resident count, and legacy count", () => {
    const rows = [{ id: "a", count: 7, legacyCount: 2 }, { id: "b", count: 8 }];
    expect(checkIdentity(rows, [...rows].reverse(), "spawns", "id", true)).toHaveLength(1);
    expect(checkIdentity(rows, [{ ...rows[0], count: 8, legacyCount: 3 }, rows[1]], "spawns")).toHaveLength(2);
  });
  it("supports collections keyed by itemId", () => {
    expect(checkIdentity([{ itemId: "rune" }], [{ itemId: "rune" }], "runes", "itemId")).toEqual([]);
    expect(checkIdentity([{ itemId: "rune" }], [], "runes", "itemId")).toHaveLength(1);
  });
  it("protects nested stage identities and their order while allowing prose edits", () => {
    const schema = obj({ id: id(), stages: arr(obj({ index: int({}, { identity: true }), text: str() })) });
    const rows = [{ id: "q", stages: [{ index: 0, text: "first" }, { index: 1, text: "second" }] }];
    const check = (stages: typeof rows[number]["stages"]) => checkIdentity(rows, [{ id: "q", stages }], "quests", "id", false, schema);
    expect(check([{ index: 0, text: "edited" }, { index: 1, text: "second" }])).toEqual([]);
    expect(check([...rows[0]!.stages].reverse())).toHaveLength(2);
    expect(check([{ index: 0, text: "first" }, { index: 2, text: "second" }])).toHaveLength(1);
  });
});
