import { buildSkeletonSource } from './skeleton-source/index.mjs';
import { buildSourceZombie } from './zombie-source/zombie.mjs';
import { buildWraith } from './wraith-source/wraith.mjs';
import { buildGolem } from './golem-source/golem.mjs';

/** Source-based factories only. Rejected procedural bodies cannot be exported. */
export function buildUndead(id) {
  if (['skeleton_soldier','skeleton_archer','skeleton_mage'].includes(id)) return buildSkeletonSource(id);
  if (['zombie','plague_zombie','grave_ghoul'].includes(id)) return buildSourceZombie(id);
  if (['wraith','banshee','revenant'].includes(id)) return buildWraith(id);
  if (['stone_golem','iron_golem','fire_golem'].includes(id)) return buildGolem(id);
  throw new Error(`Unknown undead candidate: ${id}`);
}
