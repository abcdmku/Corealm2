import type { ItemDef, EquipmentBonuses } from '../contracts.js';
import { JEWELRY_TIERS, JEWELRY_SHAPES, jewelryBonuses } from './jewelry.js';

export const MINIBOSS_JEWELRY_PROFILES: readonly (readonly (keyof EquipmentBonuses)[])[] = [
  ['meleeAccuracy', 'defence'], ['magicAccuracy', 'defence'], ['defence', 'health'],
  ['meleeAccuracy', 'meleePower'], ['magicAccuracy', 'magicPower'],
  ['meleeAccuracy', 'meleePower', 'defence'], ['magicAccuracy', 'magicPower', 'defence'],
];
const NAMES = ['Brambleguard', 'Moonsigil', 'Hollow Crown', 'Thornstrike', 'Nightbloom', 'Stoneheart', 'Veilweaver'];
export const MINIBOSS_JEWELLERY: readonly ItemDef[] = JEWELRY_TIERS.flatMap((tier, index) =>
  JEWELRY_SHAPES.map(shape => ({
    id: `guardian_${shape}_t${tier}`,
    name: `${NAMES[index]} ${shape === 'ring' ? 'Ring' : 'Earring'}`, tier,
    category: 'equipment' as const, stackable: false, value: tier * 360,
    description: `A rare ${shape} shared by all minibosses of this tier. Its paired ring and earring carry the same bonuses.`,
    equip: { slot: shape === 'ring' ? 'accessory1' as const : 'accessory2' as const,
      requires: { [index === 1 || index === 4 || index === 6 ? 'magic' : 'melee']: tier },
      bonuses: jewelryBonuses(Object.fromEntries(MINIBOSS_JEWELRY_PROFILES[index]!.map(stat =>
        [stat, 2]))),
    },
  })));
