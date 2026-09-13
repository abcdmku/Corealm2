import type { ItemDef, EquipmentBonuses } from '../contracts.js';
import { itemRows } from "./itemData.js";

export const MINIBOSS_JEWELRY_PROFILES: readonly (readonly (keyof EquipmentBonuses)[])[] = [
  ['meleeAccuracy', 'defence'], ['magicAccuracy', 'defence'], ['defence', 'health'],
  ['meleeAccuracy', 'meleePower'], ['magicAccuracy', 'magicPower'],
  ['meleeAccuracy', 'meleePower', 'defence'], ['magicAccuracy', 'magicPower', 'defence'],
];
export const MINIBOSS_JEWELLERY: readonly ItemDef[] = itemRows("MINIBOSS_JEWELLERY");
