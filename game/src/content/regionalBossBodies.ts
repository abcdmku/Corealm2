import type { CreatureSpeciesDef } from './creatureSpecies.js';
import { RPG_BESTIARY_BY_ID } from './rpgBestiary.js';
import { REGIONAL_BOSS_LEVELS, tuneEnemyCombatLevel } from './encounterBalance.js';
import { tierSilhouetteScale } from '../core/math.js';

/** Separate authored bodies preserve all seven saved encounter and orb identities. */
export const REGIONAL_BOSS_BODIES = {
  tempest_roc: { assetId: 'creature_boss_tempest_roc', scale: 1,
    description: 'A storm scarab with swept carapace shields, a crescent shovel cranium and inward-cutting stone mandibles.' },
  galeskin: { assetId: 'creature_boss_galeskin', scale: 1,
    description: 'A wind-stripped elder with a split timber mantle, one heavy root forearm and a hollow wind-cut head.' },
  rootheart: { assetId: 'creature_boss_rootheart', scale: 1,
    description: 'A walking cathedral tree with a split hollow trunk, load-bearing bough arches and a recessed heart chamber.' },
  mossbound: { assetId: 'creature_boss_mossbound', scale: 1,
    description: 'A mature seed predator with interlocking woody pod valves, thick shoulder pods and an articulated root jaw.' },
  tideworn: { assetId: 'creature_boss_tideworn', scale: 1,
    description: 'A wave-eroded shore colossus with a low layered shell and an enormous split crushing claw.' },
  ordrun: { assetId: 'creature_boss_ordrun', scale: 1,
    description: 'A quarry fortress with twin open stone vaults, a slotted gate head, broken lintel shoulders and masonry crushing fists.' },
  cinderwake: { assetId: 'creature_boss_cinderwake', scale: 1,
    description: 'A furnace tyrant with a fused slag mantle, open barred chest, recessed iron face and asymmetric hammer arm.' },
} as const;

const SOURCES = {
  tempest_roc: ['beetle_golem', 'Storm Scarab', 'fallowmarch'],
  galeskin: ['mossback_sentinel', 'Plains Ogre', 'fallowmarch'],
  rootheart: ['mossback_sentinel', 'Rootbound Colossus', 'vellenwood'],
  mossbound: ['beetle_golem', 'Forest Ogre', 'vellenwood'],
  tideworn: ['beetle_golem', 'Cave Ogre', 'karrowmoor'],
  ordrun: ['iron_golem', 'Quarry Warden', 'gravelmaw'],
  cinderwake: ['lava_golem', 'Fire Ogre', 'kilnhalt'],
} as const;

/** Root exposes these as candidate:boss_<id> in the production lab before world promotion. */
export const REGIONAL_BOSS_SPECIES: readonly CreatureSpeciesDef[] = Object.entries(REGIONAL_BOSS_BODIES).map(([key, body]) => {
  const id = key as keyof typeof REGIONAL_BOSS_BODIES;
  const [sourceId, name, regionId] = SOURCES[id];
  const source = RPG_BESTIARY_BY_ID.get(sourceId)!;
  const { tier, multiplier } = REGIONAL_BOSS_LEVELS[id];
  const stats = tuneEnemyCombatLevel(source.stats, tier * multiplier, tier);
  return { id: `boss_${id}`, ...body, scale: 1 / tierSilhouetteScale(tier), regionId, activity: 'patrol',
    stats: { ...stats, id: `boss_${id}_t${tier}`, family: `boss_${id}`, name, behaviour: 'territorial' } };
});
