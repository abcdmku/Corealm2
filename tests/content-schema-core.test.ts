import { describe, expect, it } from "vitest";
import {
  arr, bool, discriminated, enumOf, formatIssues, id, int, intRange, lazy, lit, nullable, num, obj, opt,
  parseCollection, parseValue, rec, ref, refine, str, stripExtras, tuple, union, unwrap, validateCollection, vec3,
  type Infer, type ParseContext, type Schema,
} from "../game/src/content/schema/core.js";

const Bonuses = obj({ meleeAccuracy: int(), defence: int({ min: 0 }) });
const Row = obj({
  id: id(),
  name: str({ nonEmpty: true }, { label: "Name" }),
  tier: int({ min: 0, max: 99 }),
  stackable: bool(),
  category: enumOf(["resource", "equipment"] as const),
  equip: opt(obj({ slot: enumOf(["head", "body"] as const), bonuses: Bonuses })),
  quantity: intRange,
  position: opt(vec3),
  note: nullable(str()),
});
type RowType = Infer<typeof Row>;

function ctx(): ParseContext { return { issues: [] }; }

describe("schema combinators", () => {
  it("infers required and optional keys from the schema", () => {
    const row: RowType = {
      id: "a", name: "A", tier: 1, stackable: false, category: "resource", quantity: [1, 2], note: null,
    };
    // `equip` and `position` are optional; assigning them is allowed, omitting them is allowed.
    const withEquip: RowType = { ...row, equip: { slot: "head", bonuses: { meleeAccuracy: 1, defence: 2 } } };
    expect(withEquip.equip?.slot).toBe("head");
    // @ts-expect-error tier is required
    const missing: RowType = { id: "a", name: "A", stackable: false, category: "resource", quantity: [1, 2], note: null };
    void missing;
  });

  it("returns a canonical copy with keys in schema order and no undefined entries", () => {
    const c = ctx();
    const parsed = Row.parse({ note: null, quantity: [1, 3], category: "resource", stackable: true, tier: 5, name: "Ore", id: "ore" }, "items[0]", c);
    expect(c.issues).toEqual([]);
    expect(Object.keys(parsed)).toEqual(["id", "name", "tier", "stackable", "category", "quantity", "note"]);
    expect("equip" in parsed).toBe(false);
  });

  it("collects every issue with a precise path instead of stopping at the first", () => {
    const c = ctx();
    Row.parse({
      id: "", name: 4, tier: 1.5, stackable: "yes", category: "food", equip: { slot: "feet", bonuses: { meleeAccuracy: 1, defence: -1 } },
      quantity: [3, 1], note: 7, extra: true,
    }, "items[0]", c);
    const paths = c.issues.map((issue) => `${issue.path}: ${issue.message}`);
    expect(paths).toEqual([
      "items[0].id: must not be empty",
      "items[0].name: expected string, got number",
      "items[0].tier: expected integer, got 1.5",
      "items[0].stackable: expected boolean, got string",
      'items[0].category: expected one of "resource", "equipment", got "food"',
      'items[0].equip.slot: expected one of "head", "body", got "feet"',
      "items[0].equip.bonuses.defence: must be >= 0, got -1",
      "items[0].quantity: min must be <= max",
      "items[0].note: expected string, got number",
      "items[0].extra: unknown field",
    ]);
    expect(formatIssues(c.issues, 2)).toContain("... 8 more");
  });

  it("reports missing required fields and tolerates unknown fields when not strict", () => {
    const c = ctx();
    obj({ a: str(), b: opt(str()) }).parse({}, "x", c);
    expect(c.issues).toEqual([{ path: "x.a", message: "missing required field", severity: "error" }]);
    const loose = obj({ a: str() }, { strict: false }).parse({ a: "1", extra: 2 }, "y", ctx());
    expect(loose).toEqual({ a: "1", extra: 2 });
  });

  it("rejects non-finite numbers, wrong tuple arity and bad records", () => {
    const c = ctx();
    num().parse(Number.NaN, "n", c);
    num().parse(Number.POSITIVE_INFINITY, "i", c);
    tuple([num(), num()] as const).parse([1], "t", c);
    rec(int(), enumOf(["melee", "magic"] as const)).parse({ melee: 1, ranged: 2, magic: "x" }, "r", c);
    arr(str(), { minLength: 1 }).parse([], "a", c);
    lit("fixed").parse("other", "l", c);
    expect(c.issues.map((issue) => issue.path)).toEqual(["n", "i", "t", "r.ranged", "r.magic", "a", "l"]);
  });

  it("picks the closest union member for diagnostics and switches discriminated unions on the tag", () => {
    const Shape = union([obj({ kind: lit("circle"), radius: num() }), obj({ kind: lit("box"), width: num(), height: num() })] as const);
    expect(Shape.parse({ kind: "circle", radius: 2 }, "s", ctx())).toEqual({ kind: "circle", radius: 2 });
    const c = ctx();
    Shape.parse({ kind: "box", width: 1 }, "s", c);
    expect(c.issues).toEqual([{ path: "s.height", message: "missing required field", severity: "error" }]);

    const Tagged = discriminated("kind", {
      gear: obj({ kind: lit("gear"), tier: int() }),
      gold: obj({ kind: lit("gold"), purse: bool() }),
    });
    expect(Tagged.parse({ kind: "gold", purse: true }, "d", ctx())).toEqual({ kind: "gold", purse: true });
    const d = ctx();
    Tagged.parse({ kind: "other" }, "d", d);
    expect(d.issues[0]?.path).toBe("d.kind");
    expect(d.issues[0]?.message).toContain('"gear", "gold"');
  });

  it("supports recursive shapes through lazy and custom rules through refine", () => {
    interface Node { text: string; next?: Node[] }
    const NodeSchema: Schema<Node> = lazy(() => obj({ text: str(), next: opt(arr(NodeSchema)) }));
    expect(NodeSchema.parse({ text: "a", next: [{ text: "b" }] }, "n", ctx())).toEqual({ text: "a", next: [{ text: "b" }] });
    const even = refine(int(), (value) => value % 2 === 0, "must be even");
    const c = ctx();
    even.parse(3, "e", c);
    even.parse("x", "f", c);
    expect(c.issues.map((issue) => issue.message)).toEqual(["must be even", "expected finite number, got string"]);
    expect(unwrap(opt(nullable(even))).kind).toBe("number");
  });

  it("carries field metadata that form builders can read", () => {
    const field = ref("item", { label: "Yield" }).describe({ help: "Item this node yields." });
    expect(field.meta).toEqual({ ref: "item", label: "Yield", help: "Item this node yields." });
    expect(id().meta).toMatchObject({ readOnly: true, identity: true });
    expect(Row.fields.name.meta.label).toBe("Name");
    expect(Row.keys).toContain("equip");
    expect(Row.fields.equip.optional).toBe(true);
    expect(vec3.meta.unit).toBe("m");
  });

  it("parses collections, rejects duplicate ids and throws with every error listed", () => {
    const good = parseCollection(Row, [
      { id: "a", name: "A", tier: 1, stackable: false, category: "resource", quantity: [1, 1], note: null },
      { id: "b", name: "B", tier: 2, stackable: true, category: "equipment", quantity: [1, 2], note: "x" },
    ], { name: "items" });
    expect(good.map((row) => row.id)).toEqual(["a", "b"]);

    const result = validateCollection(Row, [
      { id: "a", name: "A", tier: 1, stackable: false, category: "resource", quantity: [1, 1], note: null },
      { id: "a", name: "", tier: 1, stackable: false, category: "resource", quantity: [1, 1], note: null },
    ], { name: "items" });
    expect(result.issues.map((issue) => issue.path)).toEqual(["items[1:a]", "items[1:a].name"]);
    expect(result.issues[0]?.message).toBe('duplicate id "a" (first at index 0)');

    expect(() => parseCollection(Row, "nope", { name: "items" })).toThrow(/expected an array of records, got string/);
    expect(() => parseCollection(Row, [{ id: "a" }], { name: "items" })).toThrow(/failed validation \(6 errors\)/);
    expect(() => parseValue(obj({ x: int() }), { x: "1" }, "settings")).toThrow(/settings.x: expected finite number/);
    expect(parseValue(obj({ x: int() }), { x: 1 }, "settings")).toEqual({ x: 1 });
  });

  it("strips record extras without touching the source object", () => {
    const record = { id: "a", tier: 1, catalog: "EQUIPMENT", derivation: { kind: "gear" } };
    const stripped = stripExtras(record, ["catalog", "derivation"]);
    expect(stripped).toEqual({ id: "a", tier: 1 });
    expect(record.catalog).toBe("EQUIPMENT");
  });
  it("rejects duplicate numeric identities in tier tables", () => {
    const schema = obj({ tier: int({ min: 1 }) });
    expect(() => parseCollection(schema, [{ tier: 10 }, { tier: 10 }], { name: "tiers", idKey: "tier" }))
      .toThrow('duplicate tier "10"');
  });

  it("extends and omits object fields for layered record schemas", () => {
    const Stored = Row.extend({ catalog: opt(str()) });
    expect(Stored.keys.at(-1)).toBe("catalog");
    const Runtime = Stored.omit("catalog", "note");
    expect(Runtime.keys).not.toContain("catalog");
    expect(Runtime.keys).not.toContain("note");
    const c = ctx();
    Runtime.parse({ id: "a", name: "A", tier: 1, stackable: false, category: "resource", quantity: [1, 1], note: null }, "r", c);
    expect(c.issues.map((issue) => issue.path)).toEqual(["r.note"]);
  });
});
