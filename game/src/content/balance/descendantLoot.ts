import type { EnemyDef } from '../index.js';
import type { DescendantLootInput, DescendantLootParams } from '../schema/descendantLoot.js';
import type { SourceLootRoll } from '../schema/sourceLoot.js';
import { regionalFabricDrops, type ActorLootDependencies } from './actorLoot.js';
export type { DescendantLootInput, DescendantLootParams } from '../schema/descendantLoot.js';
export type DescendantLootDependencies = ActorLootDependencies;

const roll = (itemId: string, value: SourceLootRoll): EnemyDef['drops'][number] =>
  ({ itemId, quantity: [value.quantity[0], value.quantity[1]], chance: value.chance });

/** Original source rewards. Wilderness progression supplies its own replacement drops later. */
export function deriveDescendantLoot(params: DescendantLootParams, input: Readonly<DescendantLootInput>,
  dependencies: DescendantLootDependencies): EnemyDef['drops'] {
  if (input.kind === 'wildernessDragonSource') {
    const p = params.wildernessDragonSource;
    return [roll(p.scales.itemId, { quantity: input.tier === p.shallowTier ? p.scales.quantity.shallow : p.scales.quantity.deep,
      chance: p.scales.chance }), roll(p.fireEssence.itemId, p.fireEssence.roll)];
  }
  const profile = input.boss ? 'boss' : 'ordinary';
  if (input.kind === 'crownwardDragon') {
    const p = params.crownwardDragon;
    return [...regionalFabricDrops(dependencies.regionalFabric, dependencies.regionalCraftingTiers, p.tier, input.boss),
      roll(p.scales.itemId, p.scales[profile]), roll(p.fireEssence.itemId, p.fireEssence[profile]), roll(p.rune.itemId, p.rune[profile])];
  }
  const p = params.fairyCrown, fairy = input.regionId !== 'crownward';
  const rune = p.rune.items.find(row => row.tier === input.tier);
  if (!rune) throw new Error(`Missing fairy crown rune tier ${input.tier} for ${input.id}`);
  return [...regionalFabricDrops(dependencies.regionalFabric, dependencies.regionalCraftingTiers, input.tier, input.boss),
    roll(fairy ? p.essence.fairyItemId : p.essence.crownwardItemId, p.essence[profile]), roll(rune.itemId, p.rune[profile]),
    ...(fairy ? [roll(p.cosmic.itemId, p.cosmic[profile])] : []),
    ...(input.speciesId === p.venison.speciesId ? [roll(p.venison.itemId, p.venison.roll)] : [])];
}
