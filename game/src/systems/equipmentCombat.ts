import type { ItemStack } from '../contracts.js';
import type { EnemyDef } from '../content/index.js';
import type { Rng } from '../core/rng.js';

/** Zero Vitality consumes no random roll, preserving existing combat sequences. */
export function criticalDamage(damage: number, vitality: number, rng: Pick<Rng, 'chance'>): number {
  if (damage <= 0 || vitality <= 0) return damage;
  return rng.chance(Math.min(1, vitality / 100)) ? Math.floor(damage * 1.5) : damage;
}

/** Exclusive groups use one [0,1) roll; the unallocated probability means no drop. */
export function rollItemDrops(drops: EnemyDef['drops'], rng: Pick<Rng, 'next' | 'chance' | 'int'>,
  allowed: (id: string) => boolean = () => true): ItemStack[] {
  const items: ItemStack[] = [];
  const visited = new Set<string>();
  for (const drop of drops) {
    if (drop.exclusiveGroup) {
      if (visited.has(drop.exclusiveGroup)) continue;
      visited.add(drop.exclusiveGroup);
      let roll = rng.next();
      for (const member of drops.filter(row => row.exclusiveGroup === drop.exclusiveGroup)) {
        if (roll < member.chance) {
          if (allowed(member.itemId)) items.push({ itemId: member.itemId, quantity: rng.int(...member.quantity) });
          break;
        }
        roll -= member.chance;
      }
    } else if (allowed(drop.itemId) && rng.chance(drop.chance)) {
      const quantity = rng.int(...drop.quantity);
      if (quantity > 0) items.push({ itemId: drop.itemId, quantity });
    }
  }
  return items;
}
