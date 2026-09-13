import type { CreatureSpeciesDef } from './creatureSpecies.js';

/** Enlarged small model from Worms FREE, with its darker source red texture. */
export const RED_WORM_SPECIES: readonly CreatureSpeciesDef[] = [{
  id: 'red_worm', assetId: 'creature_red_worm', scale: 9.6, regionId: 'fallowmarch', activity: 'forage',
  description: 'A large dark red worm nosing through the grass outside Coldbrace.',
  stats: { id: 'red_worm_t1', family: 'red_worm', name: 'Red Worm', tier: 1,
    maxHealth: 8, attackLevel: 1, defenceLevel: 1, accuracy: 3, armour: 0, magicArmour: 0,
    maxHit: 1, attackSpeedMs: 2400, aggroRadius: 2, moveSpeedMps: .45, walkSpeedMps: .15,
    behaviour: 'passive', marks: [1, 2], drops: [] },
}];

