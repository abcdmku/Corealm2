import { buildSourceGoblin } from './humanoid-source/goblin.mjs';

const ids = new Set([
  'goblin_scout', 'goblin_archer', 'goblin_shaman',
  'orc_warrior', 'orc_berserker', 'orc_warlord',
  'gnoll_hunter', 'gnoll_brute', 'gnoll_chieftain',
  'lizardman_scout', 'lizardman_guard', 'lizardman_shaman',
]);

/** Source-weighted candidates. Export success does not establish visual acceptance. */
export function buildHumanoid(id) {
  if (!ids.has(id)) throw new Error(`Unknown humanoid: ${id}`);
  return buildSourceGoblin(id);
}
