import { describe, expect, it } from "vitest";
import spellData from "../game/content/data/spells.json";
import runeData from "../game/content/data/spellRunes.json";
import elementalData from "../game/content/data/elementalSpells.json";
import {
  ADVANCED_SPELLS, ALL_SPELLS, SPELLS, SPELLS_BY_RUNG, SPELL_RUNES,
  isAdvancedSpell, rungForRank, spellRune, tierRune,
} from "../game/src/content/spells.js";
import { ELEMENTAL_SPELLS, elementalSpell } from "../game/src/content/elementalSpells.js";
import { parseCollection, type Schema } from "../game/src/content/schema/core.js";
import { ElementalSpellSchema, SpellRecordSchema, SpellRuneCostSchema, SpellRuneSchema, SpellSchema } from "../game/src/content/schema/spells.js";
import type { ElementalSpellDef } from "../game/src/content/elementalSpells.js";
import type { SpellDef } from "../game/src/content/index.js";
import type { SpellRuneDef } from "../game/src/content/spells.js";

// The schema outputs satisfy the frozen runtime types without loader casts.
const runtimeSchemas = [
  SpellSchema satisfies Schema<SpellDef>,
  SpellRuneSchema satisfies Schema<SpellRuneDef>,
  ElementalSpellSchema satisfies Schema<ElementalSpellDef>,
];

describe("spell content JSON", () => {
  it("loads the catalogs in authored order and strips catalog tags", () => {
    expect(runtimeSchemas).toHaveLength(3);
    expect(SPELLS).toHaveLength(16);
    expect(ADVANCED_SPELLS).toHaveLength(20);
    expect(ALL_SPELLS).toEqual([...SPELLS, ...ADVANCED_SPELLS]);
    expect(ALL_SPELLS.map((spell) => spell.id)).toEqual(spellData.map((spell) => spell.id));
    expect(ALL_SPELLS.every((spell) => !("catalog" in spell))).toBe(true);
    expect(SPELLS.every((spell) => !("rank" in spell) && !("aoe" in spell) && !("runes" in spell.cost))).toBe(true);
    expect(ADVANCED_SPELLS.every(isAdvancedSpell)).toBe(true);
    expect(ADVANCED_SPELLS.filter((spell) => spell.rank === 1).every((spell) => spell.aoe === false)).toBe(true);
    for (const [rung, spells] of Object.entries(SPELLS_BY_RUNG)) {
      expect(spells).toEqual(SPELLS.filter((spell) => spell.rung === rung).sort((a, b) => a.reqLevel - b.reqLevel));
      expect(spells.every((spell) => SPELLS.includes(spell))).toBe(true);
    }
  });

  it("keeps rune and elemental lookups and their failure behavior", () => {
    expect(SPELL_RUNES).toEqual(runeData);
    expect(ELEMENTAL_SPELLS).toEqual(elementalData);
    for (const rune of SPELL_RUNES) {
      expect(spellRune(rune.itemId)).toBe(rune);
      expect(tierRune(rune.tier)).toBe(rune);
    }
    expect(spellRune("missing")).toBeUndefined();
    expect(() => tierRune(6)).toThrow("No spell rune for rank 6");
    for (const spell of ELEMENTAL_SPELLS) expect(elementalSpell(spell.id)).toBe(spell);
    expect(() => elementalSpell("missing")).toThrow("Unknown elemental spell: missing");
    expect([0, 1, 2, 3, 4, 5].map(rungForRank)).toEqual(["bolt", "bolt", "burst", "burst", "surge", "surge"]);
    expect(isAdvancedSpell({})).toBe(false);
    expect(isAdvancedSpell({ rank: 0 })).toBe(false);
  });

  it("rejects invalid spell numbers, tags, nested costs, and unknown fields with paths", () => {
    const invalid = {
      ...spellData[0], divisor: 0, catalog: "typo", extra: true,
      cost: { element: "ice", charges: 1, runes: [{ itemId: "mind_rune", quantity: 0 }] },
    };
    let message = "";
    try { parseCollection(SpellRecordSchema, [invalid], { name: "spells" }); }
    catch (error) { message = String(error); }
    for (const field of ["divisor", "catalog", "extra", "cost.element", "cost.runes[0].quantity"]) {
      expect(message).toContain(`spells[0:voltrend].${field}`);
    }
  });

  it("rejects duplicate identities, including runes keyed by itemId", () => {
    expect(() => parseCollection(SpellRecordSchema, [spellData[0], spellData[0]], { name: "spells" }))
      .toThrow('duplicate id "voltrend"');
    expect(() => parseCollection(SpellRuneSchema, [runeData[0], runeData[0]], { name: "spellRunes", idKey: "itemId" }))
      .toThrow('duplicate itemId "mind_rune"');
    expect(() => parseCollection(ElementalSpellSchema, [{ ...elementalData[0], rank: 6 }], { name: "elementalSpells" }))
      .toThrow("elementalSpells[0:breeze-puff].rank");
  });

  it("exposes identity, units and references for editor fields", () => {
    expect(SpellRecordSchema.fields.id.meta).toMatchObject({ readOnly: true, identity: true });
    expect(SpellRecordSchema.fields.castMs.meta.unit).toBe("ms");
    expect(SpellRecordSchema.fields.cost.fields.runes.inner.kind).toBe("array");
    expect(SpellRuneCostSchema.fields.itemId.meta.ref).toBe("rune");
    expect(SpellRuneSchema.fields.itemId.meta).toMatchObject({ readOnly: true, identity: true, ref: "item" });
    expect(ElementalSpellSchema.fields.watch.meta.multiline).toBe(true);
  });
});
