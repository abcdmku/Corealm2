import type { EnemyDef } from '../index.js';
import type { ActorLootInput, ActorLootParams, RegionalFabricParams, RegionalFabricTiers } from '../schema/actorLoot.js';
import type { SourceLootRoll } from '../schema/sourceLoot.js';
export type { ActorLootInput, ActorLootParams, RegionalFabricParams, RegionalFabricTiers } from '../schema/actorLoot.js';

export interface ActorLootDependencies {
  regionalFabric: RegionalFabricParams;
  regionalCraftingTiers: Readonly<RegionalFabricTiers>;
}
const roll = (itemId: string, value: SourceLootRoll): EnemyDef['drops'][number] =>
  ({ itemId, quantity: [value.quantity[0], value.quantity[1]], chance: value.chance });

/** Original regional hide selection. Unsupported numeric tiers return no drops. */
export function regionalFabricDrops(params: RegionalFabricParams, tiers: Readonly<RegionalFabricTiers>,
  tier: number, boss = false): EnemyDef['drops'] {
  const row = tiers.find(row => row.tier === tier);
  return row ? [roll(row.hide, boss ? params.boss : params.ordinary)] : [];
}

/** Saved loot inputs require listed tiers; explicit legacy helper calls can construct custom-tier IDs. */
export function universalJewelryDrops(params: ActorLootParams['universalJewelry'], tier: number,
  allowUnlistedTier = false): EnemyDef['drops'] {
  if (tier < params.minimumTier) return [];
  const items = params.items.find(row => row.tier === tier);
  if (!items && !allowUnlistedTier) throw new Error(`Missing guardian jewelry tier ${tier}`);
  const slots = items ? [items.ringItemId, items.earringItemId]
    : [`guardian_ring_t${tier}`, `guardian_earring_t${tier}`];
  return slots.map(itemId => ({ itemId, quantity: [params.quantity[0], params.quantity[1]],
    chance: params.totalChance / slots.length, exclusiveGroup: params.exclusiveGroup }));
}

export function deriveActorLoot(params: ActorLootParams, input: Readonly<ActorLootInput>,
  dependencies: ActorLootDependencies): EnemyDef['drops'] {
  if (input.kind === 'fairy') {
    const p = params.fairy, rune = p.rune.items.find(row => row.tier === input.tier);
    if (!rune) throw new Error(`Missing fairy rune tier ${input.tier} for ${input.id}`);
    return [...regionalFabricDrops(dependencies.regionalFabric, dependencies.regionalCraftingTiers, input.tier),
      roll(p.earth.itemId, p.earth.roll), roll(rune.itemId, p.rune.roll), roll(p.cosmic.itemId, p.cosmic.roll)];
  }
  return universalJewelryDrops(params.universalJewelry, input.tier);
}
