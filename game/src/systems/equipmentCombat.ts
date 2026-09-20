import type { ItemStack } from '../contracts.js';
import type { EnemyDef } from '../content/index.js';
import type { Rng } from '../core/rng.js';

/** Zero Vitality consumes no random roll, preserving existing combat sequences. */
export function criticalDamage(damage: number, vitality: number, rng: Pick<Rng, 'chance'>): number {
  if (damage <= 0 || vitality <= 0) return damage;
  return rng.chance(Math.min(1, vitality / 100)) ? Math.floor(damage * 1.5) : damage;
}

/** One selection per authored roll, with replacement across repeats. */
export function rollItemDrops(rolls: EnemyDef['lootRolls'], rng: Pick<Rng, 'next' | 'int'>,
  allowed: (id: string, rolledQuantity: number) => boolean = () => true): ItemStack[] {
  const items = new Map<string, number>();
  for (const group of rolls) for (let index = 0; index < group.count; index++) {
    let sample = rng.next();
    for (const drop of group.drops) {
      if (sample < drop.chance) {
        // Suppressed quest items consume their chance; never reroll or redistribute it.
        if (allowed(drop.itemId, items.get(drop.itemId) ?? 0)) items.set(drop.itemId, (items.get(drop.itemId) ?? 0) + rng.int(...drop.quantity));
        break;
      }
      sample -= drop.chance;
    }
  }
  return [...items].map(([itemId, quantity]) => ({ itemId, quantity }));
}
