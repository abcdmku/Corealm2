/** Typed balance inputs for pure formulas and the remaining migration snapshots. See docs/balance.md. */
import { arr, enumOf, id, int, num, obj, rec, refine, tuple, ref, str } from './core.js';
import type { Infer } from './core.js';
import { EnemyBalanceSchema } from './enemyBalance.js';

const positive = () => num({ exclusiveMin: 0 });
const nonnegative = () => num({ min: 0 });
const positiveInt = () => int({ min: 1 });
const probability = () => num({ min: 0, max: 1 });
const tiers = refine(arr(positiveInt(), { minLength: 1 }),
  values => values.every((value, index) => index === 0 || value > values[index - 1]!),
  'tiers must be unique and ascending');
const stat = enumOf(['meleeAccuracy', 'meleePower', 'defence', 'magicAccuracy', 'magicPower', 'health', 'vitality']);
const skill = enumOf(['melee', 'magic']);
const bonuses = obj({ meleeAccuracy: nonnegative(), meleePower: nonnegative(), defence: nonnegative(),
  magicAccuracy: nonnegative(), magicPower: nonnegative(), health: nonnegative(), vitality: nonnegative() });
const orderedRange = refine(tuple([nonnegative(), nonnegative()] as const),
  ([minimum, maximum]) => minimum <= maximum, 'minimum must not exceed maximum');
const quantityRange = refine(tuple([positiveInt(), positiveInt()] as const),
  ([minimum, maximum]) => minimum <= maximum, 'minimum quantity must not exceed maximum quantity');
const roll = obj({ quantity: quantityRange, chance: probability() });

const weight = obj({ weight: positive(), ms: positiveInt() });
/** recipes.ts W; index.ts rounds gatherXp before multiplying by the recipe weight. */
export const recipesBalanceSchema = obj({
  gatherXp: obj({ multiplier: positive(), exponent: positive() }),
  healAmount: obj({ base: nonnegative(), multiplier: positive(), exponent: positive() }),
  toolBonus: obj({ maximum: positiveInt(), base: nonnegative(), perTier: nonnegative() }),
  weights: obj({ smeltBar: weight, dagger: weight, sword: weight, bodyOrLegs: weight,
    helmBootsGloves: weight, toolHead: weight, cookedFood: weight, amuletOrRing: weight,
    leatherBody: weight, staff: weight, wand: weight, toolHandle: weight,
    fishingRod: weight, woodenShield: weight }),
});

/** equipmentSets.ts defineSet() and bossArmor.ts BOSS_ARMOR_SETS. */
export const setsBalanceSchema = obj({
  thresholds: obj({ defencePieces: quantityRange, healthPieces: int({ min: 1, max: 5 }),
    bareheadedDefencePieces: quantityRange, bareheadedHealthPieces: int({ min: 1, max: 4 }) }),
  byTier: arr(obj({ tier: positiveInt(), defence: nonnegative(), health: nonnegative() }), { minLength: 1 }),
});

/** Region reward associations; creature definitions own all actual loot rolls. */
export const lootBalanceSchema = obj({
  wildernessParameters: obj({
    keeperRewards: refine(arr(obj({ keeperId: ref('enemy'), rune: ref('item'), component: ref('item') })),
      rows => new Set(rows.map(row => row.keeperId)).size === rows.length, 'duplicate keeper reward'),
    structureComponents: refine(arr(obj({ structureId: str({ nonEmpty: true }), itemId: ref('item') })),
      rows => new Set(rows.map(row => row.structureId)).size === rows.length, 'duplicate structure component'),
  }),
});

/** Original enemy arithmetic and independently authored Stage 1 inputs. */
export const enemiesBalanceSchema = EnemyBalanceSchema;

/** encounterPopulation.ts tunable limits. Hash algorithm and hex geometry remain code. */
export const formationBalanceSchema = refine(obj({ minimum: positiveInt(), maximum: positiveInt(),
  bodyGap: nonnegative(), bossCount: positiveInt(), fixedMinimum: positiveInt(), populationHashRange: positiveInt(),
  defaultRadiusSpacingMultiplier: positive(), maximumRings: positiveInt(), clearanceEpsilon: positive(),
}), value => value.fixedMinimum <= value.minimum && value.minimum <= value.maximum
  && value.populationHashRange === value.maximum - value.minimum + 1 && value.bossCount <= value.maximum,
'population bounds and hash range must agree');

/** Each file is a single object, so callers must use parseValue, not parseCollection. */
export const campfiresBalanceSchema = obj({ buildTimeMs: positiveInt(), lifetimeBaseMs: positiveInt(), lifetimePerTierMs: nonnegative(), buildXpGatherMultiplier: nonnegative() });

export const BALANCE_SCHEMAS = {
  recipes: recipesBalanceSchema, sets: setsBalanceSchema, loot: lootBalanceSchema,
  enemies: enemiesBalanceSchema, formation: formationBalanceSchema, campfires: campfiresBalanceSchema,
} as const;
export type RecipesBalance = Infer<typeof recipesBalanceSchema>;
export type SetsBalance = Infer<typeof setsBalanceSchema>;
export type LootBalance = Infer<typeof lootBalanceSchema>;
export type EnemiesBalance = Infer<typeof enemiesBalanceSchema>;
export type FormationBalance = Infer<typeof formationBalanceSchema>;
export type CampfiresBalance = Infer<typeof campfiresBalanceSchema>;
