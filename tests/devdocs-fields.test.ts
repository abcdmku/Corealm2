import { describe, expect, it } from "vitest";
import { arr, discriminated, id, int, lazy, lit, nullable, num, obj, opt, rec, ref, refine, str, tuple, union, type Schema } from "../game/src/content/schema/core.js";
import { containsIdentity, defaultFieldValue, fieldCore, fieldIssues, serialFieldSpec, unionVariant } from "../devdocs/src/model/fields.js";

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
    expect(serialFieldSpec(num(), "legacyCount").readOnly).toBe(true);
    expect(serialFieldSpec(num(), "count").readOnly).toBe(true);
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
});
