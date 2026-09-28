import type { SpellElement } from "../contracts.js";
import { RESOLVED_TABLES } from "./resolvedCatalog.js";
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

const elementalRows = (): ElementalSpellDef[] => parseCollection(
  ElementalSpellSchema, RESOLVED_TABLES["elementalSpells"], { name: "elementalSpells" },
);
const elemental = elementalRows();
export const ELEMENTAL_SPELLS: readonly ElementalSpellDef[] = elemental;

/** After the catalog moved: the same array, refilled. */
export function reindexElementalSpells(): void {
  elemental.splice(0, elemental.length, ...elementalRows());
}

export function elementalSpell(id: string): ElementalSpellDef {
  const spell = ELEMENTAL_SPELLS.find((entry) => entry.id === id);
  if (!spell) throw new Error(`Unknown elemental spell: ${id}`);
  return spell;
}
