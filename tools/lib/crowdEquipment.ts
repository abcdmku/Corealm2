import type {EquipSlot,ItemId} from "../../game/src/contracts.js";

/** Mixed production gear for renderer fixtures, assigned on the reference server only. */
export const CROWD_EQUIPMENT:Partial<Record<EquipSlot,ItemId>>[]=[
  {head:"grithe_helm",body:"grithe_cuirass",legs:"grithe_greaves",feet:"grithe_boots",hands:"grithe_gloves",mainHand:"grithe_sword"},
  {head:"corven_helm",body:"corven_plate",legs:"corven_greaves",feet:"corven_boots",hands:"corven_gauntlets",mainHand:"corven_sword"},
  {head:"marchhide_hood",body:"marchhide_robe",legs:"marchhide_leggings",feet:"marchhide_boots",hands:"marchhide_wraps",mainHand:"basic_wooden_staff"},
];
