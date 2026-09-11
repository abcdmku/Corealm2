import type { CreatureSpeciesDef } from './creatureSpecies.js';
import { RPG_BESTIARY_BY_ID } from './rpgBestiary.js';

/** Complete-body derivatives. Register in the world only after their staged lab proof. */
export const CREATURE_REDESIGNS: readonly CreatureSpeciesDef[] = [
  { id: 'chalk_warden', source: 'shale_elemental', name: 'Chalk Warden', regionId: 'karrowmoor',
    description: 'A broad, low stone guardian with weathered chalk plates and a deliberate hammering gait.', health: 48 },
  { id: 'hollow_bough', source: 'mossback_sentinel', name: 'Hollow Bough', regionId: 'wilderness',
    description: 'A leafless, petrified forest guardian. Its split trunk bends forward before a sweeping root-arm strike.', health: 70 },
  { id: 'pallid_shade', source: 'wraith', name: 'Pallid Shade', regionId: 'wilderness',
    description: 'A hollow shroud drifting above the graves. Its hem and outstretched hands move without a walking step.', health: 32 },
].map(row => {
  const base = RPG_BESTIARY_BY_ID.get(row.source)!;
  return { id: row.id, assetId: `creature_${row.id}`, scale: 1, regionId: row.regionId as CreatureSpeciesDef['regionId'],
    activity: 'patrol', description: row.description,
    stats: { ...base.stats, id: `${row.id}_t10`, family: row.id, name: row.name, tier: 10,
      maxHealth: row.health, behaviour: row.id === 'chalk_warden' ? 'territorial' : 'aggressive',
      drops: [{ itemId: row.id === 'chalk_warden' ? 'water_essence' : 'earth_essence', quantity: [1, 2], chance: .4 }] } };
});
