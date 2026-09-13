import type { SpellElement } from "../contracts.js";
import elementalSpellData from "../../content/data/elementalSpells.json";
import { parseCollection } from "./schema/core.js";
import { ElementalSpellSchema } from "./schema/spells.js";

export type ElementalSpellId =
  | "breeze-puff"
  | "water-bead"
  | "pebble-toss"
  | "kindle"
  | "air-needle"
  | "razor-crescent"
  | "vacuum-coil"
  | "thunder-lance"
  | "skybreaker"
  | "waterjet"
  | "tidal-fan"
  | "geyser-chain"
  | "undertow"
  | "deluge"
  | "flint-shot"
  | "faultline"
  | "basalt-jaw"
  | "siege-boulder"
  | "mountainfall"
  | "ember-dart"
  | "furnace-whip"
  | "cinder-mine"
  | "phoenix-pass"
  | "starfall";

export interface ElementalSpellDef {
  id: ElementalSpellId;
  name: string;
  element: SpellElement;
  rank: number;
  scale: string;
  description: string;
  watch: string;
}

export const ELEMENTAL_SPELLS: readonly ElementalSpellDef[] = parseCollection(
  ElementalSpellSchema, elementalSpellData, { name: "elementalSpells" },
);

export function elementalSpell(id: string): ElementalSpellDef {
  const spell = ELEMENTAL_SPELLS.find((entry) => entry.id === id);
  if (!spell) throw new Error(`Unknown elemental spell: ${id}`);
  return spell;
}
