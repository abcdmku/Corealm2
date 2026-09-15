import type { SpellElement, SpellId, SpellRung } from "../../contracts.js";
import type { ElementalSpellId } from "../elementalSpells.js";
import { arr, bool, enumOf, id, int, num, obj, opt, ref, str } from "./core.js";

const element = enumOf<SpellElement>(["wind", "water", "earth", "fire"], { label: "Element", ref: "element", role: "Uses element" });
const elementalIds = [
  "breeze-puff", "water-bead", "pebble-toss", "kindle",
  "air-needle", "razor-crescent", "vacuum-coil", "thunder-lance", "skybreaker",
  "waterjet", "tidal-fan", "geyser-chain", "undertow", "deluge",
  "flint-shot", "faultline", "basalt-jaw", "siege-boulder", "mountainfall",
  "ember-dart", "furnace-whip", "cinder-mine", "phoenix-pass", "starfall",
] as const satisfies readonly ElementalSpellId[];

export const SpellRuneCostSchema = obj({
  itemId: ref("rune", { label: "Rune", role: "Rune cost of" }),
  quantity: int({ min: 1 }, { label: "Quantity", unit: "runes" }),
});

export const SpellSchema = obj({
  id: enumOf<SpellId>([
    "voltrend", "stonebrand", "rimewash", "emberlash",
    "skirlbolt", "sleetbolt", "shalebolt", "cinderbolt",
    "galeburst", "spateburst", "cragburst", "pyreburst",
    "squallsurge", "tidesurge", "scarpsurge", "kilnsurge",
    "air-needle", "razor-crescent", "vacuum-coil", "thunder-lance", "skybreaker",
    "waterjet", "tidal-fan", "geyser-chain", "undertow", "deluge",
    "flint-shot", "faultline", "basalt-jaw", "siege-boulder", "mountainfall",
    "ember-dart", "furnace-whip", "cinder-mine", "phoenix-pass", "starfall",
  ], { label: "Id", readOnly: true, identity: true }),
  name: str({ nonEmpty: true }, { label: "Name", display: true }),
  element,
  rung: enumOf<SpellRung>(["lash", "bolt", "burst", "surge"], { label: "Rung", help: "Effect silhouette and flight profile." }),
  rank: opt(int({ min: 0, max: 5 }), { label: "Rank", help: "Absent or zero for basic spells; one to five for invocations." }),
  aoe: opt(bool(), { label: "Area spell" }),
  reqLevel: int({ min: 1 }, { label: "Required Magic", unit: "level" }),
  tier: int({ min: 1 }, { label: "Tier" }),
  baseMax: num({ min: 0 }, { label: "Base maximum hit" }),
  divisor: num({ exclusiveMin: 0 }, { label: "Damage divisor" }),
  baseXp: num({ min: 0 }, { label: "Base experience", unit: "xp" }),
  castMs: num({ exclusiveMin: 0 }, { label: "Fallback cast time", unit: "ms" }),
  cost: obj({
    element: element.describe({ group: "cost" }),
    charges: int({ min: 1 }, { label: "Elemental charges", group: "cost" }),
    runes: opt(arr(SpellRuneCostSchema, {}, { label: "Secondary runes", role: "Rune cost of" }), { label: "Secondary runes", group: "cost", role: "Rune cost of" }),
  }, {}, { label: "Cast cost" }),
  description: str({ nonEmpty: true }, { label: "Description", multiline: true }),
});

export const SpellRecordSchema = SpellSchema.extend({
  catalog: enumOf(["SPELLS", "ADVANCED_SPELLS"] as const, { label: "Catalog", readOnly: true, help: "The runtime table containing this spell." }),
});

export const SpellRuneSchema = obj({
  itemId: id({ label: "Item", ref: "item", role: "Rune record for" }),
  name: str({ nonEmpty: true }, { label: "Name", display: true }),
  tier: int({ min: 0, max: 5 }, { label: "Rank", help: "Zero for Cosmic Rune; one to five for tier runes." }),
  description: str({ nonEmpty: true }, { label: "Description", multiline: true }),
});

export const ElementalSpellSchema = obj({
  id: enumOf<ElementalSpellId>(elementalIds, { label: "Id", readOnly: true, identity: true }),
  name: str({ nonEmpty: true }, { label: "Name", display: true }),
  element,
  rank: int({ min: 0, max: 5 }, { label: "Rank" }),
  scale: str({ nonEmpty: true }, { label: "Scale" }),
  description: str({ nonEmpty: true }, { label: "Description", multiline: true }),
  watch: str({ nonEmpty: true }, { label: "Watch for", multiline: true }),
});
