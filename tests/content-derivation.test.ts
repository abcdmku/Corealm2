import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CONTENT_COLLECTIONS, parseContentCollection } from "../tools/content/collections.js";
import { contentPath } from "../tools/content/format.js";
import { derivationDiffs } from "../game/src/content/balance/derivations.js";

function tables() { return new Map(CONTENT_COLLECTIONS.map(spec => [spec.name, parseContentCollection(spec, JSON.parse(readFileSync(contentPath(spec.file), "utf8")))])); }
describe("shipped derivation locks", () => {
  it("locks absence of generated equipment fields while retaining authored fields", () => {
    const data = tables();
    const rows = structuredClone(data.get("items")) as Record<string, unknown>[];
    const sword = rows.find(row => row.id === "dewglass_sword")!;
    sword.description = "An authored description.";
    data.set("items", rows);
    expect(derivationDiffs(data)).toEqual([]);
    sword.tool = { skill: "mining", gatherBonus: 999 };
    const diffs = derivationDiffs(data);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.recordId).toBe("dewglass_sword");
    expect(diffs[0]!.before.tool).toEqual(sword.tool);
    expect(Object.hasOwn(diffs[0]!.after, "tool")).toBe(true);
    expect(diffs[0]!.after.tool).toBeUndefined();
    delete sword.derivation;
    expect(derivationDiffs(data)).toEqual([]);
  });
  it("recomputes every tagged record from the shipped parameters", () => {
    const data = tables();
    const tagged = [...data.values()].flatMap(value => Array.isArray(value) ? value.filter(row => row.derivation) : []);
    expect(tagged.length).toBeGreaterThanOrEqual(554);
    expect(derivationDiffs(data)).toEqual([]);
  });
  it("previews changed parameters without rewriting records and respects hand-tuned rows", () => {
    const data = tables();
    const original = JSON.stringify([...data]);
    const parameters = structuredClone(data.get("balance/gear")) as { rare: { bonusMultiplier: number } };
    parameters.rare.bonusMultiplier = 2;
    const changed = new Map(data).set("balance/gear", parameters);
    const diffs = derivationDiffs(changed, "gear");
    expect(diffs).toHaveLength(8);
    expect(diffs.every(diff => diff.collection === "items")).toBe(true);
    expect(JSON.stringify([...data])).toBe(original);
    const rows = structuredClone(changed.get("items")) as Record<string, unknown>[];
    delete rows.find(row => row.id === diffs[0]!.recordId)!.derivation;
    changed.set("items", rows);
    expect(derivationDiffs(changed, "gear")).toHaveLength(7);
  });
});
