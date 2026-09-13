/** M0 parameter snapshots. Production formulas do not read these files yet. See docs/balance.md. */
import { arr, enumOf, id, int, num, obj, rec, refine, tuple } from './core.js';
import type { Infer } from './core.js';

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

/** equipment.ts authored base rows and rare(); combat.ts roll/damage arithmetic. */
export const gearBalanceSchema = obj({
  gatheringTiers: tiers,
  craftingTiers: tiers,
  attackSpeedMs: obj({ melee: positiveInt(), staff: positiveInt(), wand: positiveInt() }, {}, { unit: 'ms' }),
  rare: obj({ bonusMultiplier: positive(), valueMultiplier: positive() }),
  combat: refine(obj({ meleeBase: nonnegative(), meleeDivisor: positive(), rollLevelOffset: nonnegative(),
    bonusDivisor: positive(), meleeStyleFactor: positive(), magicStyleFactor: positive(),
    minimumHitChance: probability(), maximumHitChance: probability() }),
  value => value.minimumHitChance <= value.maximumHitChance, 'hit chance bounds must be ordered'),
  baselines: refine(arr(obj({ id: id(), tier: int({ min: 0 }), value: int({ min: 0 }),
    slot: enumOf(['mainHand', 'offHand', 'head', 'body', 'legs', 'feet', 'hands']),
    requires: rec(positiveInt(), skill), bonuses,
  }), { minLength: 1 }), values => new Set(values.map(value => value.id)).size === values.length,
  'baseline item ids must be unique'),
});

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

/** creatureLoot.ts MATERIAL_VALUE and production drop roll inputs. Item selection stays in TS. */
export const lootBalanceSchema = obj({
  materialValues: arr(obj({ tier: positiveInt(), value: nonnegative() }), { minLength: 1 }),
  bossArmorExpectedPieces: nonnegative(),
  regionalFabric: obj({ ordinary: roll, boss: roll }),
  wilderness: obj({ deepTier: positiveInt(),
    keeper: obj({ material: roll, component: roll, rune: roll, cosmicRune: roll, ore: roll, gem: roll }),
    ordinary: obj({ material: roll, cosmicRune: roll, ore: roll, gem: roll, structureComponent: roll,
      runes: arr(roll.extend({ rank: positiveInt() }), { minLength: 1 }) }),
  }),
});

/** enemies.ts marksFor/purseMarksFor/FANTASY_TIER_BLOCKS and encounterBalance.ts tuning. */
export const enemiesBalanceSchema = obj({
  marksPerTier: obj({ ordinary: orderedRange, purse: orderedRange }),
  fantasy: obj({ tiers, minimums: obj({ maxHealth: positiveInt(), attackLevel: positiveInt(),
    defenceLevel: positiveInt(), accuracy: nonnegative(), armour: nonnegative(),
    magicArmour: nonnegative(), maxHit: positiveInt(), marks: nonnegative() }) }),
  combatLevel: refine(obj({ rollLevelOffset: nonnegative(), bonusDivisor: positive(), defenceStyleCount: positiveInt(),
    healthPerLevel: positive(), offenceWeight: probability(), defenceWeight: probability(),
    healthWeight: probability(), minimum: positiveInt() }),
  value => Math.abs(value.offenceWeight + value.defenceWeight + value.healthWeight - 1) < 1e-9,
  'combat level weights must sum to one'),
  tuning: obj({ minimumHealth: positiveInt(), minimumLevel: positiveInt(), minimumBonus: nonnegative(),
    maximumBonus: nonnegative(), maximumBonusScale: positive(), maxHitExponent: positive(),
    searchInitialLow: nonnegative(), searchInitialHigh: positive(), searchGrowth: num({ exclusiveMin: 1 }),
    searchIterations: positiveInt(), healthPerCombatLevel: positive() }),
  regionCombatTiers: rec(positiveInt()),
  regionalBossLevels: rec(obj({ tier: positiveInt(), multiplier: positive() })),
});

/** jewelry.ts and universalMinibossLoot.ts profiles. Legacy id rewrites stay in TS. */
export const jewelryBalanceSchema = obj({
  crafted: obj({ valuePerTier: nonnegative(), bonusTierDivisor: positive(), healthMultiplier: positive(),
    otherMultiplier: positive(), recipeDurationMs: positiveInt(), recipeWeight: positive(),
    ingredientQuantity: positiveInt(), outputQuantity: positiveInt(),
    profiles: arr(obj({ tier: positiveInt(), stat, requirementSkill: skill, bar: id(), gem: id() }), { minLength: 1 }),
  }),
  miniboss: obj({ valuePerTier: nonnegative(), bonusPerStat: nonnegative(),
    profiles: arr(obj({ tier: positiveInt(), stats: arr(stat, { minLength: 1 }), requirementSkill: skill }), { minLength: 1 }),
  }),
});

/** encounterPopulation.ts tunable limits. Hash algorithm and hex geometry remain code. */
export const formationBalanceSchema = refine(obj({ minimum: positiveInt(), maximum: positiveInt(),
  bodyGap: nonnegative(), bossCount: positiveInt(), fixedMinimum: positiveInt(), populationHashRange: positiveInt(),
  defaultRadiusSpacingMultiplier: positive(), maximumRings: positiveInt(), clearanceEpsilon: positive(),
}), value => value.fixedMinimum <= value.minimum && value.minimum <= value.maximum
  && value.populationHashRange === value.maximum - value.minimum + 1 && value.bossCount <= value.maximum,
'population bounds and hash range must agree');

/** Each file is a single object, so callers must use parseValue, not parseCollection. */
export const BALANCE_SCHEMAS = {
  gear: gearBalanceSchema, recipes: recipesBalanceSchema, sets: setsBalanceSchema, loot: lootBalanceSchema,
  enemies: enemiesBalanceSchema, jewelry: jewelryBalanceSchema, formation: formationBalanceSchema,
} as const;
export type GearBalance = Infer<typeof gearBalanceSchema>;
export type RecipesBalance = Infer<typeof recipesBalanceSchema>;
export type SetsBalance = Infer<typeof setsBalanceSchema>;
export type LootBalance = Infer<typeof lootBalanceSchema>;
export type EnemiesBalance = Infer<typeof enemiesBalanceSchema>;
export type JewelryBalance = Infer<typeof jewelryBalanceSchema>;
export type FormationBalance = Infer<typeof formationBalanceSchema>;
