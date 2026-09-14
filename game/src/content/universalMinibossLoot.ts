import type { ItemDef, EquipmentBonuses } from '../contracts.js';
import { ITEM_DATA } from "./itemData.js";

export const MINIBOSS_JEWELRY_PROFILES: readonly (readonly (keyof EquipmentBonuses)[])[] = [
  ['meleeAccuracy', 'defence'], ['magicAccuracy', 'defence'], ['defence', 'health'],
  ['meleeAccuracy', 'meleePower'], ['magicAccuracy', 'magicPower'],
  ['meleeAccuracy', 'meleePower', 'defence'], ['magicAccuracy', 'magicPower', 'defence'],
];
export const MINIBOSS_JEWELLERY: readonly ItemDef[] = ITEM_DATA.filter(item => item.id.startsWith("guardian_"));
