import type { CreatureSpeciesDef } from './creatureSpecies.js';
import { RPG_BESTIARY_BY_ID } from './rpgBestiary.js';

/** Staged production actors. World registration follows the root's lab acceptance. */
export const STONE_CREATURE_REDESIGNS: readonly CreatureSpeciesDef[] = [
  { id: 'cairn_treader', source: 'shale_elemental', name: 'Cairn Treader', regionId: 'karrowmoor', tier: 10, health: 52, scale: .9,
    description: 'A low, weathered slab creature with a recessed head and heavy hammer forearms. It transfers its weight before striking.' },
  { id: 'flint_mandible', source: 'beetle_golem', name: 'Flint Mandible', regionId: 'karrowmoor', tier: 10, health: 46, scale: .8,
    description: 'A stone burrower with a flattened shovel cranium and wide digging claws. Its upper body sweeps sideways while its feet brace.' },
  { id: 'vault_custodian', source: 'iron_golem', name: 'Vault Custodian', regionId: 'gravelmaw', tier: 10, health: 64, scale: 1,
    description: 'A walking remnant of a sealed vault. Its hollow masonry chest and massive lintel arms close around intruders.' },
  { id: 'blind_cave_weaver', source: 'webweaver_spider', name: 'Blind Cave Weaver', regionId: 'gravelmaw', tier: 10, health: 30, scale: 1,
    description: 'An eyeless cave hunter with a cleft abdomen, a low sensory hood and long searching forelegs. It feels for movement before lunging.' },
  { id: 'scree_watcher', source: 'stone_golem', name: 'Scree Watcher', regionId: 'karrowmoor', tier: 10, health: 40, scale: 1,
    description: 'An eroded stone effigy with tapered stilt legs, a closed split hood and flat forearms. It turns its torso to listen across the scree.' },
].map(row => {
  const source = RPG_BESTIARY_BY_ID.get(row.source)!;
  return { id: row.id, assetId: `creature_${row.id}`, regionId: row.regionId as CreatureSpeciesDef['regionId'],
    scale: row.scale, activity: 'patrol', description: row.description,
    stats: { ...source.stats, id: `${row.id}_t${row.tier}`, family: row.id, name: row.name, tier: row.tier,
      maxHealth: row.health, behaviour: row.regionId === 'gravelmaw' ? 'aggressive' : 'territorial' } };
});
