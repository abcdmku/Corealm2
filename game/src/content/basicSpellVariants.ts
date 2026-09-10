import type { SpellElement, SpellRung } from "../contracts.js";
import type { ElementalSpellId } from "./elementalSpells.js";

export const BASIC_ELEMENTAL_SPELL:Record<SpellElement,ElementalSpellId>={wind:"breeze-puff",water:"water-bead",earth:"pebble-toss",fire:"kindle"};
export const BASIC_SPELL_VARIANTS:Record<SpellRung,{size:number;particles:number}>={
  lash:{size:1,particles:1},bolt:{size:1.22,particles:1.6},
  burst:{size:1.48,particles:2.6},surge:{size:1.8,particles:4.2},
};
