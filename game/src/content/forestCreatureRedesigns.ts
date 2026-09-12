import type { CreatureSpeciesDef } from './creatureSpecies.js';
import { RPG_BESTIARY_BY_ID } from './rpgBestiary.js';

/** Body and motion revisions are staged in the feature lab before authored placement. */
export const FOREST_CREATURE_REDESIGNS: readonly CreatureSpeciesDef[] = [
  { id: 'briar_harrow', source: 'mossback_sentinel', name: 'Briar Harrow', regionId: 'vellenwood', scale: .85,
    activity: 'patrol', health: 64, behaviour: 'territorial',
    description: 'A bowed, hollow trunk carried by root hands. Its shoulder roots turn inward around a dark body cavity, and its heavy arms sweep low across the forest floor.' },
  { id: 'fen_crawler', source: 'webweaver_spider', name: 'Fen Crawler', regionId: 'vellenwood', scale: 1,
    activity: 'prowl', health: 26, behaviour: 'aggressive',
    description: 'An eight-legged fen scavenger under a broad, overlapping carapace. Curved feeding blades frame a recessed mouth beneath its low front shield.' },
  { id: 'reed_strider', source: 'webweaver_spider', name: 'Reed Strider', regionId: 'vellenwood', scale: 1,
    activity: 'forage', health: 22, behaviour: 'territorial',
    description: 'A six-legged wetland mimic with a raised reed-thin body, folded walking limbs, tapered abdomen and a long split feeding mask.' },
  { id: 'thorn_maw', source: 'beetle_golem', name: 'Thorn Maw', regionId: 'vellenwood', scale: .85,
    activity: 'prowl', health: 56, behaviour: 'aggressive',
    description: 'A rooted biped whose upper body is a split seedpod. Thick wooden jaw valves hinge around a hollow mouth while its heavy forearms drive a close crushing strike.' },
  { id: 'heath_jack', source: 'goblin_scout', name: 'Heath Jack', regionId: 'fallowmarch', scale: 1,
    activity: 'patrol', health: 23, behaviour: 'aggressive',
    description: 'A long-armed heath scavenger in worn cloth. Its hollow carved face has open eye slits and a downturned cambium nose; its hands and knife move with quick, narrow cuts.' },
].map(row => {
  const base = RPG_BESTIARY_BY_ID.get(row.source)!;
  return {
    id: row.id, assetId: `creature_${row.id}`, scale: row.scale,
    regionId: row.regionId as CreatureSpeciesDef['regionId'],
    activity: row.activity as CreatureSpeciesDef['activity'], description: row.description,
    stats: { ...base.stats, id: `${row.id}_t10`, family: row.id, name: row.name, tier: 10,
      maxHealth: row.health, behaviour: row.behaviour as CreatureSpeciesDef['stats']['behaviour'],
      drops: [{ itemId: 'earth_essence', quantity: [1, 2] as const, chance: .35 }] },
  };
});
