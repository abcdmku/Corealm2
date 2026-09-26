import type { EquipmentBonuses, ItemDef } from '../contracts.js';

export const ENCHANTMENTS = ['strength', 'health', 'recoil', 'poison', 'flame', 'frost'] as const;
export type Enchantment = typeof ENCHANTMENTS[number];
export interface ItemUpgrade { baseId: string; rank: number; enchantment?: Enchantment }
/** Variant identity survives every existing item transfer and storage boundary. */
export function itemUpgrade(id: string): ItemUpgrade {
  const match = /^(.+)__r(10|[1-9])(?:__(strength|health|recoil|poison|flame|frost))?$/.exec(id);
  return match ? { baseId: match[1]!, rank: Number(match[2]), enchantment: match[3] as Enchantment | undefined }
    : { baseId: id, rank: 1 };
}
export function upgradedItemId(baseId: string, rank: number, enchantment?: Enchantment): string {
  if (!Number.isInteger(rank) || rank < 1 || rank > 10) throw new Error('Invalid equipment rank');
  const base = itemUpgrade(baseId).baseId;
  return rank === 1 && !enchantment ? base : `${base}__r${rank}${enchantment ? `__${enchantment}` : ''}`;
}
export const isJewelry = (def: ItemDef): boolean => !!def.equip && /^(accessory|ring|earring|neck)/.test(def.equip.slot);
export const isUpgradeable = (def: ItemDef): boolean => !!def.equip && !def.tool;
export const isWeapon = (def: ItemDef): boolean => def.equip?.slot === 'mainHand';
export function enchantmentFits(def: ItemDef, enchantment: Enchantment): boolean {
  return isUpgradeable(def) && !isJewelry(def) && (isWeapon(def)
    ? ['poison', 'flame', 'frost'].includes(enchantment) : ['strength', 'health', 'recoil'].includes(enchantment));
}
export const ENCHANT_BONUS = [0, 2, 2, 4, 6, 8, 10, 12, 15, 19, 25] as const;
export function resolveUpgradedItem(id: string, lookup: (id: string) => ItemDef | undefined): ItemDef | undefined {
  const identity = itemUpgrade(id);
  if (identity.baseId === id) return undefined;
  const base = lookup(identity.baseId);
  if (!base || !isUpgradeable(base) || identity.enchantment && !enchantmentFits(base, identity.enchantment)) return undefined;
  const bonuses = Object.fromEntries(Object.entries(base.equip!.bonuses).map(([key, value]) =>
    [key, Math.round(value * (1 + .1 * (identity.rank - 1)))])) as unknown as EquipmentBonuses;
  if (identity.enchantment === 'strength') bonuses.meleePower += ENCHANT_BONUS[identity.rank]!;
  if (identity.enchantment === 'health') bonuses.health += ENCHANT_BONUS[identity.rank]! * 5;
  const magic = identity.enchantment ? ` · ${identity.enchantment[0]!.toUpperCase()}${identity.enchantment.slice(1)}` : '';
  return { ...base, id, name: `${base.name} +${identity.rank}${magic}`,
    description: `${base.description} Rank +${identity.rank}.${identity.enchantment ? ` Magic: ${enchantmentDescription(identity.enchantment, identity.rank)}` : ''}`,
    equip: { ...base.equip!, bonuses } };
}
export function enchantmentDescription(kind: Enchantment, rank: number): string {
  const amount = ENCHANT_BONUS[rank]!;
  switch (kind) {
    case 'strength': return `+${amount} Melee Power.`;
    case 'health': return `+${amount * 5} maximum Health.`;
    case 'recoil': return 'Reflects 3% of damage taken per piece, capped at 15%.';
    case 'flame': return `Adds ${rank * 2} flame damage on a successful hit.`;
    case 'poison': return `Deals ${rank} poison damage per second for 4 seconds. Reapplying refreshes duration.`;
    case 'frost': return 'Slows movement by 25% for 4 seconds. Reapplying refreshes duration.';
  }
}
export const UPGRADE_SCROLLS = ['upgrade_scroll_low', 'upgrade_scroll_mid', 'upgrade_scroll_high'] as const;
export const UPGRADE_BOOSTER = 'fount_blessing';
export const BOOSTER_PRICE = 100_000_000;
export function upgradeClass(def: ItemDef): number { return def.tier < 30 ? 0 : def.tier < 50 ? 1 : 2; }
export function requiredUpgradeScroll(def: ItemDef): string {
  return UPGRADE_SCROLLS[Math.min(2, upgradeClass(def) + (itemUpgrade(def.id).rank >= 7 ? 1 : 0))]!;
}
const RANK_CHANCES = [
  [1, 1, .7, .7, .65, .35, .05, .01, .005],
  [1, 1, .7, .7, .60, .35, .05, .01, .005],
  [1, 1, .7, .7, .55, .25, .05, .01, .005],
] as const;
export function upgradeChance(def: ItemDef, boosters = 0): number {
  const rank = itemUpgrade(def.id).rank;
  if (rank >= 10) return 0;
  const chance = isJewelry(def) ? [1, 1, 1, 1, .55, .60, .75, .90, .95][rank - 1]!
    : RANK_CHANCES[upgradeClass(def)]![rank - 1]!;
  return Math.min(1, chance * (!isJewelry(def) ? 1.2 ** Math.max(0, Math.min(9, boosters)) : 1));
}

/** Percentages sum to 100; rank never exceeds seven on a drop. */
export const DROP_RANK_WEIGHTS = [
  [85, 12, 2.5, .45, .04, .009, .001],
  [55, 30, 11, 3.5, .4, .09, .01],
  [25, 30, 25, 15, 4, .9, .1],
  [10, 20, 30, 25, 12, 2.5, .5],
  [5, 10, 20, 30, 25, 8, 2],
  [2, 5, 13, 25, 30, 20, 5],
  [1, 3, 6, 15, 30, 30, 15],
] as const;
export function equipmentDropRank(monsterLevel: number, regionTier: number, itemTier: number, roll: number): number {
  const band = Math.max(0, Math.min(6, Math.floor((Math.min(monsterLevel, regionTier) + Math.max(0, regionTier - itemTier) * .25) / 10)));
  let cumulative = 0;
  for (let i = 0; i < 7; i++) { cumulative += DROP_RANK_WEIGHTS[band]![i]! / 100; if (roll < cumulative) return i + 1; }
  return 7;
}
