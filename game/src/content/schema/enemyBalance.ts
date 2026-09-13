import { arr, int, num, obj, refine, tuple, type Infer } from './core.js';
import { LegacyBossInputsSchema, LegacyMarksInputsSchema, OrdrunPhaseParamsSchema } from './enemyDerivation.js';

const positive = () => num({ exclusiveMin: 0 });
const nonnegative = () => num({ min: 0 });
const positiveInt = () => int({ min: 1 });
const chance = () => num({ min: 0, max: 1 });
const marks = refine(tuple([int({ min: 0 }), int({ min: 0 })] as const),
  ([low, high]) => low <= high, 'marks minimum must not exceed maximum');
const boss = obj({ tier: positiveInt(), multiplier: positive() });
export const EnemyBalanceSchema = refine(obj({
  marksPerTier: obj({ ordinary: marks, purse: marks }),
  fantasy: obj({ tiers: refine(arr(positiveInt(), { minLength: 1 }),
    values => values.every((value, index) => index === 0 || value > values[index - 1]!),
    'tiers must be unique and ascending'), minimums: obj({
    maxHealth: positiveInt(), attackLevel: positiveInt(), defenceLevel: positiveInt(), accuracy: nonnegative(),
    armour: nonnegative(), magicArmour: nonnegative(), maxHit: positiveInt(), marks: nonnegative(),
  }) }),
  combatLevel: refine(obj({ rollLevelOffset: nonnegative(), bonusDivisor: positive(), defenceStyleCount: positiveInt(),
    healthPerLevel: positive(), offenceWeight: chance(), defenceWeight: chance(), healthWeight: chance(), minimum: positiveInt() }),
  value => value.healthWeight > 0 && Math.abs(value.offenceWeight + value.defenceWeight + value.healthWeight - 1) < 1e-9,
  'combat level weights must sum to one with positive health weight'),
  tuning: refine(obj({ minimumHealth: positiveInt(), minimumLevel: positiveInt(), minimumBonus: int({ min: 0 }),
    maximumBonus: nonnegative(), maximumBonusScale: positive(), maxHitExponent: positive(), searchInitialLow: nonnegative(),
    searchInitialHigh: positive(), searchGrowth: num({ exclusiveMin: 1 }), searchIterations: positiveInt(), healthPerCombatLevel: positive() }),
  value => value.minimumBonus <= value.maximumBonus && value.searchInitialLow < value.searchInitialHigh,
  'bonus and search bounds must be ordered'),
  regionCombatTiers: obj({ fallowmarch: positiveInt(), vellenwood: positiveInt(), karrowmoor: positiveInt(),
    gravelmaw: positiveInt(), kilnhalt: positiveInt(), wilderness: positiveInt(), crownward: positiveInt(),
    gloamgarden: positiveInt(), faeholme: positiveInt() }),
  regionalBossLevels: obj({ galeskin: boss, tempest_roc: boss, mossbound: boss, rootheart: boss,
    tideworn: boss, ordrun: boss, cinderwake: boss }),
  legacyMarksInputs: LegacyMarksInputsSchema,
  legacyBossInputs: LegacyBossInputsSchema,
  ordrunPhases: OrdrunPhaseParamsSchema,
}), value => Math.abs(value.tuning.healthPerCombatLevel - value.combatLevel.healthPerLevel / value.combatLevel.healthWeight) < 1e-9
  && new Set([...value.legacyMarksInputs, ...value.legacyBossInputs].map(row => row.id)).size
    === value.legacyMarksInputs.length + value.legacyBossInputs.length
  && new Set([...value.legacyMarksInputs, ...value.legacyBossInputs].map(row => row.enemyId)).size
    === value.legacyMarksInputs.length + value.legacyBossInputs.length,
'health correction must agree with the level formula and input ids and targets must be globally unique');
export type EnemyBalance = Infer<typeof EnemyBalanceSchema>;
