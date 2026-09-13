import type { EquipmentBonuses, EquipSlot, ItemDef, ItemStack } from '../contracts.js';
import type { RecipeDef } from './index.js';
import { recipeXp } from './index.js';

export const JEWELRY_TIERS = [10, 20, 30, 40, 50, 60, 70] as const;
export const JEWELRY_STATS = ['meleeAccuracy', 'magicAccuracy', 'defence', 'health', 'meleePower', 'magicPower', 'vitality'] as const;
export const JEWELRY_SHAPES = ['ring', 'earring'] as const;
export const JEWELRY_MATERIALS = [
  ['Cobalt Garnet', 'kaldite_bar', 'cairn_garnet'],
  ['Titanium Opal', 'emberite_bar', 'fire_opal'],
  ['Dewglass Quartz', 'kaldite_bar', 'pale_quartz'],
  ['Titanium Amber', 'emberite_bar', 'vell_amber'],
  ['Cindersteel Garnet', 'cindersteel_bar', 'cairn_garnet'],
  ['Cindersteel Opal', 'cindersteel_bar', 'fire_opal'],
  ['Nightglass Opal', 'nightglass_bar', 'fire_opal'],
] as const;

export function jewelryBonuses(values: Partial<EquipmentBonuses> = {}): EquipmentBonuses {
  return { meleeAccuracy: 0, magicAccuracy: 0, defence: 0, health: 0, meleePower: 0, magicPower: 0, vitality: 0, ...values };
}

export function jewelrySlots(slot: EquipSlot): readonly EquipSlot[] {
  if (slot === 'accessory1' || slot === 'ring2') return ['accessory1', 'ring2'];
  if (slot === 'accessory2' || slot === 'earring2') return ['accessory2', 'earring2'];
  return [slot];
}

export function selectEquipmentSlot(slot: EquipSlot, equipment: Partial<Record<EquipSlot, ItemStack | null>>): EquipSlot {
  return jewelrySlots(slot).find(candidate => !equipment[candidate]) ?? slot;
}

export const CRAFTED_JEWELRY: readonly ItemDef[] = JEWELRY_TIERS.flatMap((tier, index) =>
  JEWELRY_SHAPES.map(shape => ({
    id: `crafted_${shape}_t${tier}`, name: `${JEWELRY_MATERIALS[index]![0]} ${shape === 'ring' ? 'Ring' : 'Earring'}`,
    tier, category: 'equipment' as const, stackable: false, value: tier * 80,
    description: `A ${shape} set with ${JEWELRY_MATERIALS[index]![2].replaceAll('_', ' ')}. Grants only ${JEWELRY_STATS[index]!.replace(/([A-Z])/g, ' $1').toLowerCase()}${tier === 70 ? ', critical hit chance' : ''}.`,
    equip: { slot: shape === 'ring' ? 'accessory1' as const : 'accessory2' as const,
      requires: { [index === 1 || index === 5 ? 'magic' : 'melee']: tier },
      bonuses: jewelryBonuses({ [JEWELRY_STATS[index]!]: tier / 10 * (index === 3 ? 3 : 1) }),
    },
  })));

export const JEWELRY_RECIPES: readonly RecipeDef[] = CRAFTED_JEWELRY.map(item => {
  const material = JEWELRY_MATERIALS[JEWELRY_TIERS.indexOf(item.tier as typeof JEWELRY_TIERS[number])]!;
  return { id: `craft_${item.id}`, name: item.name, kind: 'craft', stations: ['crafting_table'],
    skill: 'crafting', reqLevel: item.tier, tier: item.tier, durationMs: 3000,
    xp: recipeXp(item.tier, 3), inputs: [{ itemId: material[1], quantity: 1 }, { itemId: material[2], quantity: 1 }],
    output: { itemId: item.id, quantity: 1 } };
});

// Saved IDs remain readable, but retired jewelry is not registered as obtainable content.
const legacyTiers: Record<string, number> = {
  grithe: 10, ember: 10, corven: 10, stone: 10, kaldite: 10, storm: 10,
  emberite: 20, cinder: 20, cindersteel: 50, emberweave: 50, nightglass: 70, starweave: 70,
  foxhair: 10, turkey_plume: 10, lynx_sinew: 10, heron_quill: 10,
  quillguard: 10, antler_palm: 10, chitin: 20, mantis_edge: 20,
};
export function canonicalJewelryId(id: string): string {
  const previous = /^guardian_\d{2}_(ring|earring)_t(\d+)$/.exec(id);
  if (previous) return `guardian_${previous[1]}_t${Math.max(10, Number(previous[2]))}`;
  const boss = /^(warden|unique)_jewellery_(\d{2})_t(\d+)$/.exec(id);
  if (boss) return `guardian_${boss[1] === 'warden' ? 'earring' : 'ring'}_t${Math.max(10, Number(boss[3]))}`;
  const match = /^(.*)_(ring|pendant|charm)$/.exec(id);
  if (match && legacyTiers[match[1]!] !== undefined) return `crafted_${match[2] === 'ring' ? 'ring' : 'earring'}_t${legacyTiers[match[1]!]}`;
  return id;
}
export function isRetiredJewelry(id: string): boolean { return canonicalJewelryId(id) !== id; }
