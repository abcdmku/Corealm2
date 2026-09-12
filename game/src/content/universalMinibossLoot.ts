import type { EquipmentBonuses, ItemDef } from '../contracts.js';
import { REGION_COMBAT_TIERS } from './encounterBalance.js';
import { UNIVERSAL_MINIBOSS_ROSTER } from './universalMinibosses.js';

const bonuses = (values: Partial<EquipmentBonuses>): EquipmentBonuses => ({
  accuracy: 0, power: 0, armour: 0, magicAccuracy: 0, magicPower: 0, magicArmour: 0, vitality: 0, ...values,
});

const JEWELLERY_GRADES: Readonly<Record<number, string>> = {
  1: 'Weathered', 5: 'Grovebound', 10: 'Stonebound', 20: 'Emberforged',
  30: 'Moonpetal', 40: 'Pearlbound', 50: 'Duskwrought', 60: 'Starwoven',
};

/** The same guardian in a starter region cannot drop endgame gear. */
export const MINIBOSS_JEWELLERY: readonly ItemDef[] = [...new Set(Object.values(REGION_COMBAT_TIERS))]
  .flatMap(tier => UNIVERSAL_MINIBOSS_ROSTER.flatMap(row => {
    const magic = row.style === 'magic';
    const slot = magic ? 'accessory2' : 'accessory1';
    const grade = JEWELLERY_GRADES[tier];
    if (!grade) throw new Error(`Missing jewellery grade for tier ${tier}`);
    const standard: ItemDef = {
      id: `warden_jewellery_${row.number}_t${tier}`, name: `${grade} Warden's ${magic ? 'Pendant' : 'Ring'}`,
      tier, category: 'equipment', stackable: false, value: Math.max(60, tier * 60),
      description: `Jewellery recovered from a roaming ${row.name}.`,
      equip: { slot, requires: { [row.style]: tier }, bonuses: bonuses({
        armour: Math.ceil(tier * .11), magicArmour: Math.ceil(tier * .11), vitality: Math.ceil(tier * .07),
        ...(magic ? { magicPower: Math.ceil(tier * .07) } : { power: Math.ceil(tier * .07) }),
      }) },
    };
    const unique: ItemDef = {
      id: `unique_jewellery_${row.number}_t${tier}`, name: `${grade} ${row.unique}`, tier,
      category: 'equipment', stackable: false, value: Math.max(360, tier * 360),
      description: `A rare reward from ${row.name}. Grants defence, maximum health and ${magic ? 'magic' : 'melee'} strength.`,
      equip: { slot, requires: { [row.style]: tier }, bonuses: bonuses({
        armour: Math.ceil(tier * .25) + 2, magicArmour: Math.ceil(tier * .25) + 2,
        vitality: Math.ceil(tier * .2) + 3,
        ...(magic ? { magicPower: Math.ceil(tier * .18) + 2, magicAccuracy: Math.ceil(tier * .12) }
          : { power: Math.ceil(tier * .18) + 2, accuracy: Math.ceil(tier * .12) }),
      }) },
    };
    return [standard, unique];
  }));
