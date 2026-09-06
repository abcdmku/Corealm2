import { buildSourceDemon } from './mythic-source/demon.mjs';
import { buildSourceGargoyle } from './mythic-source/gargoyle.mjs';
import { buildMinotaur } from './minotaur-source/minotaur.mjs';
import { buildHarpy } from './harpy-source/harpy.mjs';
import { buildMythicVariant } from './mythic-source/variants.mjs';

export const MYTHIC_IDS = ['harpy','cliff_harpy','storm_harpy','gargoyle','obsidian_gargoyle','ancient_gargoyle','minotaur','labyrinth_guardian','elder_minotaur','imp','horned_demon','abyssal_demon'];
/** Source-based factories only. Rejected procedural bodies cannot be exported. */
export function buildMythic(id) {
  if (['imp','abyssal_demon','obsidian_gargoyle','ancient_gargoyle'].includes(id)) return buildMythicVariant(id);
  if (['harpy','cliff_harpy','storm_harpy'].includes(id)) return buildHarpy(id);
  if (['minotaur','labyrinth_guardian','elder_minotaur'].includes(id)) return buildMinotaur(id);
  if (id === 'gargoyle') return buildSourceGargoyle();
  if (id === 'horned_demon') return buildSourceDemon();
  throw new Error(`Unknown mythic candidate: ${id}`);
}
