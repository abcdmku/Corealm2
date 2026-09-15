import { describe, expect, it } from "vitest";
import { discriminated, int, lit, obj, opt, ref, str } from "../game/src/content/schema/core.js";
import { questPredicateSchema } from "../game/src/content/schema/story.js";
import { carryOver, clampProbability, move, redistribute, shares, variantSchema, variantTag } from "../devdocs/src/ui/field/reorder.js";

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

describe("move", () => {
  it("moves an item down and up, returning a new array", () => {
    const items = ["a", "b", "c", "d"];
    expect(move(items, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(move(items, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(items).toEqual(["a", "b", "c", "d"]);
  });
  it("copies unchanged when the move is a no-op or out of range", () => {
    expect(move(["a", "b"], 1, 1)).toEqual(["a", "b"]);
    expect(move(["a", "b"], 0, 2)).toEqual(["a", "b"]);
    expect(move(["a", "b"], -1, 0)).toEqual(["a", "b"]);
    expect(move([], 0, 0)).toEqual([]);
  });
});

describe("shares", () => {
  it("normalises 3/1/1 to 60/20/20", () => {
    expect(shares([3, 1, 1])).toEqual([0.6, 0.2, 0.2]);
  });
  it("shares nothing when every weight is zero", () => {
    expect(shares([0, 0])).toEqual([0, 0]);
  });
});

describe("redistribute", () => {
  it("keeps the total by scaling the other unlocked weights in proportion", () => {
    const next = redistribute([3, 1, 1], 0, 1);
    expect(next[0]).toBe(1);
    expect(next[1]).toBeCloseTo(2);
    expect(next[2]).toBeCloseTo(2);
    expect(sum(next)).toBeCloseTo(5);
  });
  it("leaves locked rows untouched and pays from the unlocked ones only", () => {
    const next = redistribute([3, 1, 1], 0, 2, [false, true, false]);
    expect(next).toEqual([2, 1, 2]);
    expect(sum(next)).toBeCloseTo(5);
  });
  it("clamps the edit to what the unlocked rows can give up", () => {
    // Row 1 holds 1 and is locked, so row 0 can take at most 4 of the total 5.
    expect(redistribute([3, 1, 1], 0, 10, [false, true, false])).toEqual([4, 1, 0]);
    expect(redistribute([3, 1, 1], 0, -4)).toEqual([0, 2.5, 2.5]);
  });
  it("is a no-op on a locked row or when every other row is locked", () => {
    expect(redistribute([3, 1, 1], 0, 5, [true, false, false])).toEqual([3, 1, 1]);
    expect(redistribute([3, 1, 1], 0, 5, [false, true, true])).toEqual([3, 1, 1]);
    expect(redistribute([4], 0, 1)).toEqual([4]);
    expect(redistribute([3, 1], 5, 1)).toEqual([3, 1]);
  });
  it("splits the remainder evenly when the unlocked rows were all zero", () => {
    expect(redistribute([4, 0, 0], 0, 2)).toEqual([2, 1, 1]);
  });
  it("does not drift after rounding: the last unlocked row absorbs the remainder", () => {
    const next = redistribute([1, 1, 1], 0, 0.5);
    expect(sum(next)).toBeCloseTo(3, 10);
  });
});

describe("clampProbability", () => {
  it("holds 0..1 and reads non-finite input as 0", () => {
    expect(clampProbability(0.6)).toBe(0.6);
    expect(clampProbability(1.4)).toBe(1);
    expect(clampProbability(-0.2)).toBe(0);
    expect(clampProbability(Number.NaN)).toBe(0);
    expect(clampProbability(0.1 + 0.2)).toBe(0.3);
  });
});

describe("carryOver", () => {
  const have = variantSchema(questPredicateSchema, "have")!;
  const banked = variantSchema(questPredicateSchema, "banked")!;
  const kill = variantSchema(questPredicateSchema, "kill")!;
  const gather = variantSchema(questPredicateSchema, "gather")!;

  it("reads the tag and members off a lazy discriminated union", () => {
    expect(variantTag(questPredicateSchema)).toBe("kind");
    expect(have).toBeDefined();
    expect(variantSchema(questPredicateSchema, "nope")).toBeUndefined();
  });
  it("keeps same-named fields and retags the value", () => {
    const result = carryOver(have, banked, { kind: "have", itemId: "fox_fur", quantity: 3 });
    expect(result.value).toEqual({ kind: "banked", itemId: "fox_fur", quantity: 3 });
    expect(result.kept.sort()).toEqual(["itemId", "quantity"]);
    expect(result.dropped).toEqual([]);
  });
  it("reports a non-default value the new variant cannot hold", () => {
    const result = carryOver(have, kill, { kind: "have", itemId: "fox_fur", quantity: 3 });
    expect(result.value).toEqual({ kind: "kill", enemyFamily: "", count: 1 });
    expect(result.dropped).toEqual([{ key: "itemId", label: "Item", value: "fox_fur" }, { key: "quantity", label: "Quantity", value: 3 }]);
  });
  it("does not ask when the lost fields still hold their defaults", () => {
    const result = carryOver(gather, have, { kind: "gather", itemId: "fox_fur", count: 1 });
    expect(result.value).toEqual({ kind: "have", itemId: "fox_fur", quantity: 1 });
    expect(result.dropped).toEqual([]);
  });
  it("drops optional fields silently when unset and reports them when set", () => {
    expect(carryOver(have, kill, { kind: "have", itemId: "", quantity: 1 }).dropped).toEqual([]);
    expect(carryOver(have, kill, { kind: "have", itemId: "", quantity: 1, orAwakenedAltarId: "altar" }).dropped).toEqual([{ key: "orAwakenedAltarId", label: "Entity id", value: "altar" }]);
  });
  it("only carries a field across when both variants give it the same kind", () => {
    const union = discriminated("kind", {
      a: obj({ kind: lit("a"), amount: int({ min: 0 }), note: opt(str()) }),
      b: obj({ kind: lit("b"), amount: str(), target: ref("item") }),
    });
    const result = carryOver(variantSchema(union, "a")!, variantSchema(union, "b")!, { kind: "a", amount: 7, note: "x" });
    expect(result.value).toEqual({ kind: "b", amount: "", target: "" });
    expect(result.kept).toEqual([]);
    expect(result.dropped).toEqual([{ key: "amount", label: "Amount", value: 7 }, { key: "note", label: "Note", value: "x" }]);
  });
});
