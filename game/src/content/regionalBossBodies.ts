import type { CreatureSpeciesDef } from './creatureSpecies.js';
import { creatureRows } from './creatureData.js';
import { tierSilhouetteScale } from '../core/math.js';

/** Separate authored bodies preserve all seven saved encounter and orb identities. */
export const REGIONAL_BOSS_BODIES = {
  tempest_roc: { assetId: 'creature_boss_tempest_roc', scale: 1,
    description: 'A storm scarab with swept carapace shields, a crescent shovel cranium and inward-cutting stone mandibles.' },
  // Galeskin and Rootheart are the only two bodies built on briar_harrow, whose run cycle covers
  // 0.48 of its own height per stride where every other boss base covers 0.85 or more. A boss has
  // to hold the shared 4.68 m/s run speed, so that short stride cycles its legs at 3.62 Hz, past
  // the 3 Hz legibility ceiling in creatureMotionTiming. Drawing them larger lengthens the drawn
  // stride by the same factor and is the only fix that does not re-author the rig; it also settles
  // the oddity that both bosses rendered smaller than an ordinary 4.02 m mossback sentinel.
  // Retiering changes only the authored multiplier; these ratios preserve the accepted drawn size.
  galeskin: { assetId: 'creature_boss_galeskin', scale: 1.35 * tierSilhouetteScale(1) / tierSilhouetteScale(10),
    description: 'A wind-stripped elder with a split timber mantle, one heavy root forearm and a hollow wind-cut head.' },
  rootheart: { assetId: 'creature_boss_rootheart', scale: 1.35 * tierSilhouetteScale(5) / tierSilhouetteScale(10),
    description: 'A walking cathedral tree with a split hollow trunk, load-bearing bough arches and a recessed heart chamber.' },
  mossbound: { assetId: 'creature_boss_mossbound', scale: tierSilhouetteScale(5) / tierSilhouetteScale(10),
    description: 'A mature seed predator with interlocking woody pod valves, thick shoulder pods and an articulated root jaw.' },
  tideworn: { assetId: 'creature_boss_tideworn', scale: 1,
    description: 'A wave-eroded shore colossus with a low layered shell and an enormous split crushing claw.' },
  ordrun: { assetId: 'creature_boss_ordrun', scale: 1,
    description: 'A quarry fortress with twin open stone vaults, a slotted gate head, broken lintel shoulders and masonry crushing fists.' },
  cinderwake: { assetId: 'creature_boss_cinderwake', scale: 1,
    description: 'A furnace tyrant with a fused slag mantle, open barred chest, recessed iron face and asymmetric hammer arm.' },
} as const;

export const REGIONAL_BOSS_SPECIES: readonly CreatureSpeciesDef[] = creatureRows(["boss_tempest_roc", "boss_galeskin", "boss_rootheart", "boss_mossbound", "boss_tideworn", "boss_ordrun", "boss_cinderwake"]);
