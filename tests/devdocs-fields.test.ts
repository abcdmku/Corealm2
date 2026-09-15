import { describe, expect, it } from "vitest";
import { arr, discriminated, id, int, lazy, lit, nullable, num, obj, opt, rec, ref, refine, str, tuple, union, type Schema } from "../game/src/content/schema/core.js";
import { containsIdentity, defaultFieldValue, fieldCore, fieldIssues, fieldPath, recordLabelKey, serialFieldSpec, unionVariant } from "../devdocs/src/model/fields.js";

describe("editor field metadata", () => {
  it("preserves wrapped numeric bounds and combines metadata with outer labels taking precedence", () => {
    const schema = opt(nullable(refine(int({ min: 2, max: 12 }, { label: "Inner", unit: "m", help: "Spacing" }), value => value % 2 === 0, "must be even")), { label: "Outer", step: 2 });
    const spec = serialFieldSpec(schema, "spacing");
    expect(spec).toMatchObject({ kind: "number", label: "Outer", unit: "m", help: "Spacing", optional: true, nullable: true, integer: true, min: 2, max: 12, step: 2, refinements: ["must be even"] });
    expect(JSON.parse(JSON.stringify(spec))).toMatchObject({ refinements: ["must be even"], min: 2 });
    expect(fieldIssues(schema, 3, "spacing")).toEqual([expect.objectContaining({ path: "spacing", message: "must be even" })]);
  });
  it("keeps identity, read-only, hidden and reference metadata across wrappers", () => {
    expect(serialFieldSpec(opt(id()), "id")).toMatchObject({ identity: true, readOnly: true, optional: true });
    expect(serialFieldSpec(ref("item", { label: "Output", hidden: true }))).toMatchObject({ ref: "item", label: "Output", hidden: true, minLength: 1 });
    expect(serialFieldSpec(id().describe({ identity: false, readOnly: false, ref: "item" }))).toMatchObject({ identity: false, readOnly: false, ref: "item" });
  });
  it("reports regex and exclusive bounds without non-serializable values", () => {
    const text = serialFieldSpec(str({ pattern: /^asset_[a-z]+$/, minLength: 7, maxLength: 40 }));
    expect(text).toMatchObject({ pattern: "^asset_[a-z]+$", minLength: 7, maxLength: 40 });
    expect(serialFieldSpec(num({ exclusiveMin: 0, exclusiveMax: 1 }))).toMatchObject({ exclusiveMin: 0, exclusiveMax: 1 });
    expect(defaultFieldValue(num({ exclusiveMin: 0 }))).toBeGreaterThan(0);
  });
  it("exposes discriminated choices and selects the current tagged branch", () => {
    const schema = discriminated("kind", { item: obj({ kind: lit("item"), itemId: ref("item") }), skill: obj({ kind: lit("skill"), level: int({ min: 1 }) }) });
    expect(serialFieldSpec(schema)).toMatchObject({ discriminator: "kind", variants: [{ key: "item", label: "Item" }, { key: "skill", label: "Skill" }] });
    expect(unionVariant(schema, { kind: "skill", level: 3 })).toBe("skill");
    expect(defaultFieldValue(schema)).toEqual({ kind: "item", itemId: "" });
  });
  it("supports literal unions without converting numbers to strings", () => {
    const schema = union([lit(1), lit(2)] as const);
    expect(serialFieldSpec(schema).choices).toEqual([1, 2]);
    expect(defaultFieldValue(schema)).toBe(1);
    const mixed = union([num(), tuple([num(), num()] as const)] as const);
    expect(unionVariant(mixed, [2, 4])).toBe("1");
    expect(unionVariant(mixed, 2)).toBe("0");
  });
  it("does not expand recursive lazy shapes into an infinite descriptor", () => {
    const recursive: Schema = lazy(() => discriminated("kind", { leaf: obj({ kind: lit("leaf"), text: str() }), all: obj({ kind: lit("all"), children: arr(recursive) }) }));
    expect(serialFieldSpec(recursive)).toMatchObject({ kind: "union", discriminator: "kind" });
    expect(fieldCore(recursive).kind).toBe("union");
    expect(containsIdentity(recursive)).toBe(false);
    expect(defaultFieldValue(recursive)).toEqual({ kind: "leaf", text: "" });
  });
  it("locks array structure around nested identity without locking ordinary ingredients", () => {
    expect(containsIdentity(arr(obj({ index: int({}, { identity: true }), text: str() })))).toBe(true);
    expect(containsIdentity(obj({ itemId: ref("item"), quantity: int() }))).toBe(false);
    expect(containsIdentity(obj({ count: int() }))).toBe(true);
  });
  it("makes structured defaults without adding optional keys or discarding provided unknown fields during validation", () => {
    const schema = obj({ name: str(), extras: opt(str()), points: arr(num({ min: 2 }), { minLength: 2 }), pair: tuple([lit("x"), int()] as const), lookup: rec(str()) }, { strict: false });
    expect(defaultFieldValue(schema)).toEqual({ name: "", points: [2, 2], pair: ["x", 0], lookup: {} });
    const value = { name: "Old record", points: [2, 2], pair: ["x", 0], lookup: {}, retained: { arbitrary: true } };
    expect(fieldIssues(schema, value)).toEqual([]);
    expect(value.retained).toEqual({ arbitrary: true });
  });
  it("carries list, grouping and relationship metadata through wrappers and keeps it serializable", () => {
    const members = opt(refine(
      arr(obj({ creatureId: ref("enemy", { role: "Spawns as" }), weight: num({ exclusiveMin: 0 }) }), {}, { label: "Members", role: "Spawns as", weight: "weight" }),
      rows => rows.length > 0, "encounter needs a member"), { ordered: true });
    const spec = serialFieldSpec(members, "members");
    expect(spec).toMatchObject({ kind: "array", label: "Members", role: "Spawns as", weight: "weight", ordered: true, optional: true, refinements: ["encounter needs a member"] });
    expect(JSON.parse(JSON.stringify(spec))).toMatchObject({ role: "Spawns as", weight: "weight", ordered: true });
    expect(serialFieldSpec(arr(obj({ itemId: ref("item"), chance: num({ min: 0, max: 1 }) }), {}, { probability: "chance" }))).toMatchObject({ probability: "chance" });
  });
  it("lets an outer layer override group, role and display like every other meta key", () => {
    const health = int({ min: 1 }, { label: "Health", group: "combat", role: "Inner", display: true });
    expect(serialFieldSpec(health, "maxHealth")).toMatchObject({ label: "Health", group: "combat", role: "Inner", display: true });
    expect(serialFieldSpec(opt(health, { group: "adjustments", role: "Outer", display: false }), "maxHealth")).toMatchObject({ label: "Health", group: "adjustments", role: "Outer", display: false });
  });
});

describe("addressing a field by path", () => {
  const shop = obj({
    id: id(),
    name: str({ nonEmpty: true }, { label: "Name", display: true }),
    buyMultiplier: num({ min: 0 }),
    stock: arr(obj({ itemId: ref("item", { label: "Item", role: "Sold at" }), quantity: int({ min: 0 }) }), {}, { label: "Stock", role: "Sold at" }),
    hours: tuple([int(), int()] as const, { label: "Hours" }),
    notes: rec(str()),
  });
  it("walks objects, arrays, tuples, records and wrappers", () => {
    expect(fieldPath(shop, ["stock", 0, "itemId"])).toMatchObject({ label: "Item", ref: "item", role: "Sold at" });
    expect(fieldPath(shop, ["stock"])).toMatchObject({ kind: "array", label: "Stock" });
    expect(fieldPath(shop, ["stock", 0])).toMatchObject({ kind: "object", label: "Stock" });
    expect(fieldPath(shop, ["hours", 1])).toMatchObject({ kind: "number", integer: true, label: "Hours" });
    expect(fieldPath(shop, ["notes", "opening"])).toMatchObject({ label: "Opening" });
    expect(fieldPath(shop, [])).toMatchObject({ kind: "object" });
  });
  it("picks the union member the value is using", () => {
    const schema = obj({ loot: opt(discriminated("kind", {
      table: obj({ kind: lit("table"), tableId: ref("lootTable", { label: "Table" }) }),
      own: obj({ kind: lit("own"), drops: arr(obj({ itemId: ref("item", { role: "Dropped by" }) })) }),
    })) });
    expect(fieldPath(schema, ["loot", "tableId"], { loot: { kind: "table", tableId: "t" } })).toMatchObject({ label: "Table", ref: "lootTable" });
    expect(fieldPath(schema, ["loot", "drops", 0, "itemId"], { loot: { kind: "own", drops: [{ itemId: "bone" }] } })).toMatchObject({ ref: "item", role: "Dropped by" });
    // With no value the walk falls back to the first member, so an unreachable key is undefined.
    expect(fieldPath(schema, ["loot", "drops"])).toBeUndefined();
  });
  it("returns undefined for a path the schema does not have", () => {
    expect(fieldPath(shop, ["stock", 0, "price"])).toBeUndefined();
    expect(fieldPath(shop, ["buyMultiplier", "min"])).toBeUndefined();
    expect(fieldPath(shop, ["stock", "0", "itemId"])).toBeUndefined();
  });
  it("names the display field, falling back to a literal name key", () => {
    expect(recordLabelKey(shop)).toBe("name");
    expect(recordLabelKey(obj({ logItemId: ref("item", { display: true }), name: str() }))).toBe("logItemId");
    expect(recordLabelKey(obj({ id: id(), tier: int() }))).toBeUndefined();
    expect(recordLabelKey(discriminated("catalog", { base: shop, fairy: shop }))).toBe("name");
    expect(recordLabelKey(arr(shop))).toBeUndefined();
  });
});
