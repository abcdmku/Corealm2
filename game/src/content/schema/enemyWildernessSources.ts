import { arr, enumOf, id, int, lit, num, obj, refine, str, tuple, union, type Infer, type Schema } from './core.js';
import { LEGACY_BOSS_IDS } from './enemyDerivation.js';

const positive = () => num({ exclusiveMin: 0 });
const nonnegative = () => num({ min: 0 });
const positiveInt = () => int({ min: 1 });
const nonnegativeInt = () => int({ min: 0 });
const nonempty = () => str({ nonEmpty: true });
const tier = () => union([lit(50), lit(70)] as const);
export const WILDERNESS_KEEPER_IDS = ['ashseal_warden', 'furnace_regent', 'chainbound_archon', 'nightforge_marshal', 'hollow_star'] as const;
export const WILDERNESS_BODY_ROLES = ['crawler', 'heavy', 'predator', 'ghost', 'keeper'] as const;
const unique = <T>(schema: Schema<T>) => refine(arr(schema), values => new Set(values).size === values.length, 'values must be unique');
export const WildernessKeeperRowSchema = obj({
  id: enumOf(WILDERNESS_KEEPER_IDS, { readOnly: true, identity: true }), name: nonempty(), tier: tier(), multiplier: positive(),
});
export const WildernessKeeperRowsSchema = refine(arr(WildernessKeeperRowSchema),
  rows => rows.length === WILDERNESS_KEEPER_IDS.length && new Set(rows.map(row => row.id)).size === WILDERNESS_KEEPER_IDS.length,
  'keeper rows must contain each of the five keeper ids exactly once');
export const WildernessBodySourceInputSchema = union([
  obj({ id: id(), kind: lit('wildernessBody'), role: enumOf(['crawler', 'heavy', 'predator', 'ghost'] as const),
    speciesId: nonempty(), name: nonempty(), tier: tier(), targetLevel: positiveInt() }),
  obj({ id: id(), kind: lit('wildernessBody'), role: lit('keeper'), keeperId: enumOf(WILDERNESS_KEEPER_IDS) }),
] as const);
export const WildernessDragonSourceInputSchema = obj({
  id: id(), kind: lit('wildernessDragon'), speciesId: nonempty(), name: nonempty(), tier: tier(), targetLevel: positiveInt(),
});
export const RegionalBossBodySourceInputSchema = refine(obj({
  id: id(), kind: lit('regionalBossBody'), speciesId: nonempty(), name: nonempty(),
  sourceInputId: nonempty(), bossId: enumOf(LEGACY_BOSS_IDS),
}), input => input.speciesId === `boss_${input.bossId}`, 'regional boss species id must match its boss id');
export const WildernessBaseSourceInputSchema = union([
  WildernessBodySourceInputSchema, WildernessDragonSourceInputSchema, RegionalBossBodySourceInputSchema,
] as const);
export const WildernessBaseSourceInputsSchema = refine(arr(WildernessBaseSourceInputSchema),
  rows => new Set(rows.map(row => row.id)).size === rows.length, 'source input ids must be unique');
const marks = () => refine(tuple<[Schema<number>, Schema<number>]>([nonnegativeInt(), nonnegativeInt()]),
  ([low, high]) => low <= high, 'marks minimum must not exceed maximum');
export const WildernessBodyParamsSchema = refine(obj({
  heavyRoles: unique(enumOf(WILDERNESS_BODY_ROLES)), magicRoles: unique(enumOf(WILDERNESS_BODY_ROLES)),
  magicSpeciesIds: unique(nonempty()), deepTier: positiveInt(),
  attackLevelMultiplier: obj({ magic: positive(), heavy: positive(), other: positive() }),
  defenceLevelMultiplier: obj({ heavy: positive(), other: positive() }),
  healthPerLevel: obj({ heavy: positive(), other: positive() }),
  accuracy: obj({ magic: nonnegative(), predator: nonnegative(), other: nonnegative() }),
  armour: obj({ magic: nonnegative(), heavy: nonnegative(), other: nonnegative() }),
  magicArmour: obj({ magic: nonnegative(), deep: nonnegative(), other: nonnegative() }),
  maxHitPerTier: obj({ keeper: positive(), heavy: positive(), other: positive() }),
  attackRangeM: obj({ magic: positive(), heavy: positive(), other: positive() }),
  attackSpeedMs: obj({ keeper: positiveInt(), heavy: positiveInt(), magic: positiveInt(), other: positiveInt() }),
  aggroRadius: obj({ keeper: nonnegative(), magic: nonnegative(), other: nonnegative() }),
  moveSpeedMps: obj({ magic: positive(), heavy: positive(), other: positive() }),
  walkSpeedMps: obj({ heavy: positive(), other: positive() }),
  marks: obj({ minimumPerTier: nonnegativeInt(), maximumPerTier: obj({ keeper: nonnegativeInt(), other: nonnegativeInt() }) }),
}), p => p.marks.minimumPerTier <= p.marks.maximumPerTier.keeper && p.marks.minimumPerTier <= p.marks.maximumPerTier.other,
'body marks minimum must not exceed either maximum');
const DragonProfileSchema = obj({ attackSpeedMs: positiveInt(), attackRangeM: positive(), aggroRadius: nonnegative(),
  moveSpeedMps: positive(), walkSpeedMps: positive() });
export const WildernessDragonParamsSchema = refine(obj({
  shallowTier: positiveInt(), healthPerTier: positive(), attackLevelOffset: int(), defenceLevelOffset: int(),
  accuracy: nonnegative(), armour: nonnegative(), magicArmour: nonnegative(), maxHitPerTier: positive(),
  marksPerTier: marks(), shallow: DragonProfileSchema, deep: DragonProfileSchema,
}), p => 50 + p.attackLevelOffset > 0 && 50 + p.defenceLevelOffset > 0,
'dragon level offsets must produce positive source levels at tier 50');
export const WildernessSourceParamsSchema = obj({
  wildernessBody: WildernessBodyParamsSchema, wildernessDragon: WildernessDragonParamsSchema,
  regionalBossBody: obj({ behaviour: lit('territorial') }),
});
export type WildernessKeeperRow = Infer<typeof WildernessKeeperRowSchema>;
export type WildernessKeeperId = typeof WILDERNESS_KEEPER_IDS[number];
export type WildernessBodySourceInput = Infer<typeof WildernessBodySourceInputSchema>;
export type WildernessDragonSourceInput = Infer<typeof WildernessDragonSourceInputSchema>;
export type RegionalBossBodySourceInput = Infer<typeof RegionalBossBodySourceInputSchema>;
export type WildernessBaseSourceInput = Infer<typeof WildernessBaseSourceInputSchema>;
export type WildernessSourceParams = Infer<typeof WildernessSourceParamsSchema>;
