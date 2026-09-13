import type { EnemyDef } from '../index.js';
import type { SourceLootInput, SourceLootParams, SourceLootRoll } from '../schema/sourceLoot.js';
export type { SourceLootInput, SourceLootParams, SourceLootRoll } from '../schema/sourceLoot.js';

const clone = (drops: EnemyDef['drops']): EnemyDef['drops'] => drops.map(drop => ({ ...drop, quantity: [drop.quantity[0], drop.quantity[1]] }));
const roll = (itemId: string, value: SourceLootRoll): EnemyDef['drops'][number] =>
  ({ itemId, quantity: [value.quantity[0], value.quantity[1]], chance: value.chance });

/** Reproduce original ordered source rolls. Dependencies identify original spreads. */
export function deriveSourceLoot(params: SourceLootParams, input: Readonly<SourceLootInput>,
  dependencies: ReadonlyMap<string, EnemyDef['drops']>): EnemyDef['drops'] {
  const inherited = (id: string) => {
    const drops = dependencies.get(id);
    if (!drops) throw new Error(`Missing source loot dependency ${id} for ${input.id}`);
    return clone(drops);
  };
  switch (input.kind) {
    case 'authored': return clone(input.drops);
    case 'inherit': return inherited(input.sourceInputId);
    case 'starter': return [roll(input.itemId, params.starter)];
    case 'rpg': {
      const p = params.rpg;
      return [{ itemId: p.essenceByRegion[input.regionId],
        quantity: [p.quantityMinimum, Math.max(p.quantityMaximumMinimum, Math.ceil(input.tier / p.quantityTierDivisor))],
        chance: input.role === 'caster' ? p.chance.caster : p.chance.other }];
    }
    case 'variantAppend': return [...inherited(input.sourceInputId), roll(input.essenceItemId, params.variantAppend)];
    case 'redesignEssence': return [roll(input.essenceItemId, params.redesignEssence[input.profile])];
  }
}
