import { arr, bool, enumOf, id, int, lit, num, obj, opt, refine, str, tuple, union, type Infer } from './core.js';
import { WILDERNESS_KEEPER_IDS } from './enemyWildernessSources.js';

const nonempty = () => str({ nonEmpty: true });
const positiveInt = () => int({ min: 1 });
const nonnegativeInt = () => int({ min: 0 });
const band = { legacyBase: positiveInt(), fallbackFloor: positiveInt(), fallbackCeiling: positiveInt() };
export const WildernessProgressionParamsSchema = refine(obj({
  depth: obj({ south: num(), divide: num(), north: num() }),
  bands: tuple([obj({ tier: lit(50), ...band }), obj({ tier: lit(70), ...band })] as const),
  legacyProgressLevels: nonnegativeInt(), nativeProgressLevels: nonnegativeInt(), legacySourceTierThreshold: positiveInt(),
  fallbackTiers: tuple([lit(50), lit(70), positiveInt(), positiveInt(), positiveInt(), positiveInt()] as const),
  marks: obj({ defaultMinimumPerSourceTier: nonnegativeInt(), defaultMaximumPerSourceTier: nonnegativeInt(),
    minimumPerTargetTier: nonnegativeInt(), maximumPerTargetTier: nonnegativeInt() }),
}), p => p.depth.south < p.depth.divide && p.depth.divide < p.depth.north
  && p.bands.every(row => row.fallbackFloor <= row.fallbackCeiling)
  && new Set(p.fallbackTiers).size === p.fallbackTiers.length,
'depth boundaries must ascend, fallback bounds must be ordered, and fallback tiers must be unique');
export const WildernessGroupInputSchema = obj({
  id: id(), family: nonempty(), name: nonempty(), tier: positiveInt(), centre: tuple([num(), num()] as const),
  count: positiveInt(), assetId: opt(nonempty()), boss: opt(bool()), miniBoss: opt(bool()),
});
export const WildernessGroupInputsSchema = refine(arr(WildernessGroupInputSchema),
  rows => new Set(rows.map(row => row.id)).size === rows.length, 'group ids must be unique');
export const WildernessSpeciesInputSchema = obj({ id: id(), assetId: nonempty(), sourceInputId: nonempty() });
export const WildernessSpeciesInputsSchema = refine(arr(WildernessSpeciesInputSchema),
  rows => new Set(rows.map(row => row.id)).size === rows.length, 'species ids must be unique');
export const WildernessLootRequestSchema = obj({
  speciesId: nonempty(), tier: union([lit(50), lit(70)] as const), keeperId: opt(enumOf(WILDERNESS_KEEPER_IDS)), groupId: opt(nonempty()),
});
export type WildernessProgressionParams = Infer<typeof WildernessProgressionParamsSchema>;
export type WildernessGroupInput = Infer<typeof WildernessGroupInputSchema>;
export type WildernessSpeciesInput = Infer<typeof WildernessSpeciesInputSchema>;
export type WildernessLootRequest = Infer<typeof WildernessLootRequestSchema>;
