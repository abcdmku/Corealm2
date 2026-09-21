import { describe, expect, it } from "vitest";
import { applyBaseDecisions, BaseDecisionError, mergeBase, type BaseMergeInputs } from "../game/src/content/compiler/baseMerge.js";
import { readContentSources } from "../tools/content/compile.js";

/**
 * The three-way merge behind "update from base". Literal fixtures for every rule, then the
 * properties any merge has to keep, run over the shipped content as well as the small fixtures.
 */
type Sources = Record<string, unknown>;
const sword = { id: "sword", name: "Sword", tier: 1, value: 10 };
const bow = { id: "bow", name: "Bow", tier: 1, value: 12 };
const axe = { id: "axe", name: "Axe", tier: 2, value: 15 };
const ancestor: Sources = {
  items: [sword, bow, axe],
  campfireFuels: [{ logItemId: "oak_log", burnMs: 1000 }],
  "balance/formation": { minimum: 7, maximum: 15, bodyGap: 0.5 },
  audio: { cues: { "ui.click": { gain: 0.3 }, "ui.error": { gain: 0.5 } }, loops: { "music.a": { gain: 1 } }, regions: {} },
};
const merge = (mine: Sources, theirs: Sources, base: Sources = ancestor) => mergeBase({ ancestor: base, mine, theirs });
const edit = (sources: Sources, name: string, change: (value: any) => unknown): Sources => ({ ...sources, [name]: change(structuredClone(sources[name])) });

describe("merging a new base into a server's own content", () => {
  it("takes the base where the server did not touch a record, and keeps the server's own edit where the base did not", () => {
    const mine = edit(ancestor, "items", items => items.map((row: any) => row.id === "bow" ? { ...row, value: 99 } : row));
    const theirs = edit(ancestor, "items", items => items.map((row: any) => row.id === "sword" ? { ...row, value: 11 } : row));
    const result = merge(mine, theirs);
    expect(result.merged.items).toEqual([{ ...sword, value: 11 }, { ...bow, value: 99 }, axe]);
    expect(result.summary.items).toEqual({ takenFromBase: 1, keptMine: 1, added: 0, deleted: 0, unchanged: 1, conflicts: 0 });
    expect([result.conflicts, result.decisionsNeeded]).toEqual([[], 0]);
  });

  it("takes a change both sides made the same way, without calling it a conflict", () => {
    const both = edit(ancestor, "items", items => items.map((row: any) => row.id === "axe" ? { ...row, tier: 3 } : row));
    const result = merge(both, edit(both, "campfireFuels", fuels => [...fuels, { logItemId: "ash_log", burnMs: 2000 }]));
    expect(result.merged.items).toEqual(both.items);
    expect(result.conflicts).toEqual([]);
  });

  it("calls a record both sides changed differently a conflict, with the fields each side changed", () => {
    const mine = edit(ancestor, "items", items => items.map((row: any) => row.id === "sword" ? { ...row, value: 50, name: "Old Sword" } : row));
    const theirs = edit(ancestor, "items", items => items.map((row: any) => row.id === "sword" ? { ...row, value: 20, tier: 2 } : row));
    const result = merge(mine, theirs);
    expect(result.conflicts).toEqual([{ collection: "items", id: "sword", kind: "both-changed", ancestor: sword,
      mine: { ...sword, value: 50, name: "Old Sword" }, theirs: { ...sword, value: 20, tier: 2 }, mineFields: ["name", "value"], theirsFields: ["tier", "value"], decision: null }]);
    expect(result.decisionsNeeded).toBe(1);
    // Undecided, the server's own record holds its place.
    expect((result.merged.items as any[])[0]).toEqual({ ...sword, value: 50, name: "Old Sword" });
    expect(result.summary.items!.conflicts).toBe(1);

    const takeTheirs = applyBaseDecisions({ ancestor, mine, theirs }, [{ collection: "items", id: "sword", take: "theirs" }]);
    expect([(takeTheirs.merged.items as any[])[0], takeTheirs.decisionsNeeded, takeTheirs.summary.items!.takenFromBase]).toEqual([{ ...sword, value: 20, tier: 2 }, 0, 1]);
    const takeMine = applyBaseDecisions({ ancestor, mine, theirs }, [{ collection: "items", id: "sword", take: "mine" }]);
    expect([(takeMine.merged.items as any[])[0], takeMine.summary.items!.keptMine]).toEqual([{ ...sword, value: 50, name: "Old Sword" }, 1]);
  });

  it("adds what the base added, keeps what the server added, and conflicts on one id added twice with different content", () => {
    const mine = edit(ancestor, "items", items => [...items, { id: "mace", name: "Mace", tier: 2, value: 1 }, { id: "club", name: "Club", tier: 1, value: 2 }]);
    const theirs = edit(ancestor, "items", items => [...items, { id: "spear", name: "Spear", tier: 2, value: 5 }, { id: "club", name: "Club", tier: 1, value: 3 }]);
    const result = merge(mine, theirs);
    expect(result.conflicts.map(({ collection, id, kind, mineFields, theirsFields }) => ({ collection, id, kind, mineFields, theirsFields })))
      .toEqual([{ collection: "items", id: "club", kind: "both-added", mineFields: ["value"], theirsFields: ["value"] }]);
    expect(result.conflicts[0]!.ancestor).toBeNull();
    const decided = applyBaseDecisions({ ancestor, mine, theirs }, [{ collection: "items", id: "club", take: "theirs" }]);
    expect((decided.merged.items as any[]).map(row => row.id)).toEqual(["sword", "bow", "axe", "spear", "mace", "club"]);
    expect(decided.summary.items).toEqual({ takenFromBase: 1, keptMine: 1, added: 1, deleted: 0, unchanged: 3, conflicts: 0 });
    const same = merge(edit(ancestor, "items", items => [...items, { id: "club", value: 3, tier: 1, name: "Club" }]), theirs);
    expect(same.conflicts).toEqual([]);
  });

  it("deletes what the base deleted when the server left it alone, and asks when the server changed it", () => {
    const theirs = edit(ancestor, "items", items => items.filter((row: any) => row.id !== "bow" && row.id !== "axe"));
    const mine = edit(ancestor, "items", items => items.map((row: any) => row.id === "axe" ? { ...row, value: 1 } : row));
    const result = merge(mine, theirs);
    expect(result.conflicts.map(({ id, kind, mine: own, theirs: base, mineFields, theirsFields }) => ({ id, kind, own, base, mineFields, theirsFields })))
      .toEqual([{ id: "axe", kind: "deleted-in-base", own: { ...axe, value: 1 }, base: null, mineFields: ["value"], theirsFields: [] }]);
    expect((result.merged.items as any[]).map(row => row.id)).toEqual(["sword", "axe"]);
    const deleted = applyBaseDecisions({ ancestor, mine, theirs }, [{ collection: "items", id: "axe", take: "theirs" }]);
    expect([(deleted.merged.items as any[]).map(row => row.id), deleted.summary.items!.deleted]).toEqual([["sword"], 2]);
    const kept = applyBaseDecisions({ ancestor, mine, theirs }, [{ collection: "items", id: "axe", take: "mine" }]);
    expect((kept.merged.items as any[]).map(row => row.id)).toEqual(["sword", "axe"]);
  });

  it("keeps a record the server deleted, unless the base changed it, and then asks", () => {
    const mine = edit(ancestor, "items", items => items.filter((row: any) => row.id !== "bow" && row.id !== "axe"));
    const theirs = edit(ancestor, "items", items => items.map((row: any) => row.id === "axe" ? { ...row, value: 30 } : row));
    const result = merge(mine, theirs);
    expect(result.conflicts.map(({ id, kind, mineFields, theirsFields }) => ({ id, kind, mineFields, theirsFields })))
      .toEqual([{ id: "axe", kind: "deleted-on-server", mineFields: [], theirsFields: ["value"] }]);
    expect((result.merged.items as any[]).map(row => row.id)).toEqual(["sword"]);
    expect(result.summary.items!.conflicts).toBe(1);
    const restored = applyBaseDecisions({ ancestor, mine, theirs }, [{ collection: "items", id: "axe", take: "theirs" }]);
    expect(restored.merged.items).toEqual([sword, { ...axe, value: 30 }]);
    expect(applyBaseDecisions({ ancestor, mine, theirs }, [{ collection: "items", id: "axe", take: "mine" }]).merged.items).toEqual([sword]);
  });

  it("puts a new base record after its nearest surviving neighbour in the base, and appends when it has none", () => {
    const mine = edit(ancestor, "items", () => [axe, { ...sword, value: 1 }, bow]);
    const theirs = edit(ancestor, "items", () => [{ id: "first", value: 0 }, sword, { id: "after_sword", value: 1 }, { id: "after_that", value: 2 }, bow, axe]);
    expect((merge(mine, theirs).merged.items as any[]).map(row => row.id)).toEqual(["axe", "sword", "after_sword", "after_that", "bow", "first"]);
    // The same inputs give the same order every time.
    expect(merge(mine, theirs)).toEqual(merge(mine, theirs));
  });

  it("does not count key order or formatting as a change", () => {
    const reordered = edit(ancestor, "items", items => items.map((row: any) => Object.fromEntries(Object.entries(row).reverse())));
    const theirs = edit(ancestor, "items", items => items.map((row: any) => row.id === "bow" ? { ...row, value: 13 } : row));
    const result = merge(reordered, theirs);
    expect(result.conflicts).toEqual([]);
    expect((result.merged.items as any[])[1]).toEqual({ ...bow, value: 13 });
    expect(result.summary.items).toEqual({ takenFromBase: 1, keptMine: 0, added: 0, deleted: 0, unchanged: 2, conflicts: 0 });
  });

  it("merges a balance object by top-level key and audio by entry", () => {
    const mine = edit(edit(ancestor, "balance/formation", value => ({ ...value, minimum: 5 })), "audio", audio => ({ ...audio, cues: { ...audio.cues, "ui.click": { gain: 0.1 } } }));
    const theirs = edit(edit(ancestor, "balance/formation", value => ({ ...value, maximum: 20 })), "audio",
      audio => ({ ...audio, cues: { ...audio.cues, "ui.error": { gain: 0.6 } }, regions: { fallowmarch: { loop: "music.a" } } }));
    const result = merge(mine, theirs);
    expect(result.conflicts).toEqual([]);
    expect(result.merged["balance/formation"]).toEqual({ minimum: 5, maximum: 20, bodyGap: 0.5 });
    expect(result.merged.audio).toEqual({ cues: { "ui.click": { gain: 0.1 }, "ui.error": { gain: 0.6 } }, loops: { "music.a": { gain: 1 } }, regions: { fallowmarch: { loop: "music.a" } } });
    const clash = merge(edit(ancestor, "balance/formation", value => ({ ...value, bodyGap: 1 })), edit(ancestor, "balance/formation", value => ({ ...value, bodyGap: 2 })));
    expect(clash.conflicts.map(({ collection, id, kind, mine: own, theirs: base, mineFields }) => ({ collection, id, kind, own, base, mineFields })))
      .toEqual([{ collection: "balance/formation", id: "bodyGap", kind: "both-changed", own: 1, base: 2, mineFields: [] }]);
  });

  it("merges a collection whole when its records have no usable id", () => {
    const broken = { ...ancestor, items: [sword, { name: "No id" }] };
    const result = merge(broken, edit(ancestor, "items", items => [...items, { id: "spear", value: 1 }]));
    expect(result.conflicts.map(({ collection, id, kind }) => ({ collection, id, kind }))).toEqual([{ collection: "items", id: "$collection", kind: "both-changed" }]);
  });

  it("refuses decisions that are missing, name no conflict, or repeat", () => {
    const mine = edit(ancestor, "items", items => items.map((row: any) => row.id === "sword" ? { ...row, value: 50 } : row));
    const theirs = edit(ancestor, "items", items => items.map((row: any) => row.id === "sword" ? { ...row, value: 20 } : row));
    const inputs: BaseMergeInputs = { ancestor, mine, theirs };
    const failure = (decisions: Parameters<typeof applyBaseDecisions>[1]) => { try { applyBaseDecisions(inputs, decisions); return null; } catch (error) { return error as BaseDecisionError; } };
    const missing = failure([]);
    expect([missing?.name, missing?.message, missing?.missing, missing?.unknown]).toEqual(["BaseDecisionError", "1 conflict needs a decision", [{ collection: "items", id: "sword" }], []]);
    const unknown = failure([{ collection: "items", id: "sword", take: "mine" }, { collection: "items", id: "bow", take: "mine" }]);
    expect([unknown?.message, unknown?.unknown]).toEqual(["1 decision names no conflict", [{ collection: "items", id: "bow", take: "mine" }]]);
    const twice = failure([{ collection: "items", id: "sword", take: "mine" }, { collection: "items", id: "sword", take: "theirs" }]);
    expect(twice?.unknown).toEqual([{ collection: "items", id: "sword", take: "theirs" }]);
  });
});

describe("properties of the merge, on the shipped content", async () => {
  const shipped = Object.fromEntries(await readContentSources()) as Sources;
  // The base changes every seventh item, drops the first, adds one and drops a loot table; the server renames other items and a shop.
  const theirs = edit(edit(shipped, "items", items => [...items.map((row: any, index: number) => index % 7 === 1 ? { ...row, value: (row.value ?? 0) + 1 } : row).slice(1),
    { ...items[0], id: "base_new_item" }]), "lootTables", tables => tables.slice(0, -1));
  const mine = edit(edit(shipped, "items", items => items.map((row: any, index: number) => index % 7 === 3 ? { ...row, name: `${row.name} (server)` } : row)),
    "shops", shops => shops.map((shop: any, index: number) => index === 0 ? { ...shop, name: "Renamed on the server" } : shop));

  it("merge(a, a, m) is m and merge(a, t, a) is t, exactly", () => {
    expect(mergeBase({ ancestor: shipped, theirs: shipped, mine }).merged).toEqual(mine);
    expect(JSON.stringify(mergeBase({ ancestor: shipped, theirs, mine: shipped }).merged)).toBe(JSON.stringify(theirs));
  });
  it("merge(a, t, t) is t", () => {
    expect(JSON.stringify(mergeBase({ ancestor: shipped, theirs, mine: theirs }).merged)).toBe(JSON.stringify(theirs));
  });
  it("is idempotent: merging the result again with the same base changes nothing", () => {
    const once = mergeBase({ ancestor: shipped, theirs, mine });
    expect(once.decisionsNeeded).toBe(0);
    const twice = mergeBase({ ancestor: shipped, theirs, mine: once.merged });
    expect([JSON.stringify(twice.merged) === JSON.stringify(once.merged), twice.decisionsNeeded]).toEqual([true, 0]);
    // And after the update the base the server took is the ancestor.
    expect(JSON.stringify(mergeBase({ ancestor: theirs, theirs, mine: once.merged }).merged)).toBe(JSON.stringify(once.merged));
  });
});
