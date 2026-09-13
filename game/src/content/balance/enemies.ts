import type { EnemyDef } from '../index.js';
import type { BossPhase } from '../enemies.js';

export type LevelInput = Pick<EnemyDef,
  'maxHealth' | 'attackLevel' | 'defenceLevel' | 'accuracy' | 'armour' | 'magicArmour'>;
export type CombatInput = LevelInput & { maxHit: number };
export type CombatResult = CombatInput & { tier: number };
export type MarksProfile = 'ordinary' | 'purse';
export interface MarksPerTierParams {
  readonly ordinary: readonly [number, number];
  readonly purse: readonly [number, number];
}
export interface CombatLevelParams {
  readonly rollLevelOffset: number;
  readonly bonusDivisor: number;
  readonly defenceStyleCount: number;
  readonly healthPerLevel: number;
  readonly offenceWeight: number;
  readonly defenceWeight: number;
  readonly healthWeight: number;
  readonly minimum: number;
}
export interface TuningParams {
  readonly minimumHealth: number;
  readonly minimumLevel: number;
  readonly minimumBonus: number;
  readonly maximumBonus: number;
  readonly maximumBonusScale: number;
  readonly maxHitExponent: number;
  readonly searchInitialLow: number;
  readonly searchInitialHigh: number;
  readonly searchGrowth: number;
  readonly searchIterations: number;
  readonly healthPerCombatLevel: number;
}
export type LegacyBossId = 'galeskin' | 'tempest_roc' | 'mossbound' | 'rootheart' | 'tideworn' | 'ordrun' | 'cinderwake';
export interface LegacyMarksInput {
  readonly id: string;
  readonly enemyId: string;
  readonly tier: number;
  readonly profile: MarksProfile;
}
export interface LegacyBossInput {
  readonly id: string;
  readonly enemyId: string;
  readonly bossId: LegacyBossId;
  readonly seed: Readonly<CombatInput>;
}
export interface BossLevelParams { readonly tier: number; readonly multiplier: number }
export type RegionalBossLevelParams = { readonly [K in LegacyBossId]: BossLevelParams };
export type OrdrunPhaseParams = readonly [
  { readonly atHealthFraction: number; readonly attackSpeedMs: number },
  {
    readonly atHealthFraction: number;
    readonly armourNumerator: number;
    readonly armourDenominator: number;
    readonly attackSpeedMs: number;
    readonly maxHitNumerator: number;
    readonly maxHitDenominator: number;
    readonly telegraphId: string;
    readonly telegraphWindupMs: number;
    readonly telegraphRadiusM: number;
  },
];
/** Structural input for Stage 1. Other balance sections are not read by these formulas. */
export interface EnemyBalanceStage1 {
  readonly marksPerTier: MarksPerTierParams;
  readonly combatLevel: CombatLevelParams;
  readonly tuning: TuningParams;
  readonly regionalBossLevels: RegionalBossLevelParams;
  readonly legacyMarksInputs: readonly LegacyMarksInput[];
  readonly legacyBossInputs: readonly LegacyBossInput[];
  readonly ordrunPhases: OrdrunPhaseParams;
}

/** Parameters must already have passed the balance schema's numeric invariants. */
export function combatLevel(p: CombatLevelParams, input: Readonly<LevelInput>): number {
  const offence = (input.attackLevel + p.rollLevelOffset) * (1 + input.accuracy / p.bonusDivisor) - p.rollLevelOffset;
  const defence = (input.defenceLevel + p.rollLevelOffset)
    * (1 + (input.armour + input.magicArmour) / p.defenceStyleCount / p.bonusDivisor) - p.rollLevelOffset;
  const health = input.maxHealth / p.healthPerLevel;
  return Math.max(p.minimum, Math.round(p.offenceWeight * offence + p.defenceWeight * defence + p.healthWeight * health));
}

export function tierMarks(p: MarksPerTierParams, tier: number, profile: MarksProfile): [number, number] {
  return [Math.round(tier * p[profile][0]), Math.round(tier * p[profile][1])];
}

export function tuneCombat(p: TuningParams, level: CombatLevelParams,
  input: Readonly<CombatInput>, targetLevel: number, tier: number, sourceId: string): CombatResult {
  const target = Math.max(level.minimum, Math.round(targetLevel));
  if (!Number.isFinite(target)) throw new Error(`Cannot tune ${sourceId} to combat level ${target}`);
  const sample = (factor: number): CombatResult => ({
    tier,
    maxHealth: Math.max(p.minimumHealth, Math.round(input.maxHealth * factor)),
    attackLevel: Math.max(p.minimumLevel, Math.round(input.attackLevel * factor)),
    defenceLevel: Math.max(p.minimumLevel, Math.round(input.defenceLevel * factor)),
    accuracy: Math.max(p.minimumBonus, Math.round(Math.min(p.maximumBonus, input.accuracy) * Math.min(p.maximumBonusScale, factor))),
    armour: Math.max(p.minimumBonus, Math.round(Math.min(p.maximumBonus, input.armour) * Math.min(p.maximumBonusScale, factor))),
    magicArmour: Math.max(p.minimumBonus, Math.round(Math.min(p.maximumBonus, input.magicArmour) * Math.min(p.maximumBonusScale, factor))),
    maxHit: Math.max(p.minimumLevel, Math.round(input.maxHit * Math.pow(factor, p.maxHitExponent))),
  });
  let low = p.searchInitialLow, high = p.searchInitialHigh;
  while (combatLevel(level, sample(high)) < target) high *= p.searchGrowth;
  let best = sample(high);
  for (let i = 0; i < p.searchIterations; i++) {
    const mid = (low + high) / 2, candidate = sample(mid);
    const candidateLevel = combatLevel(level, candidate);
    // Equal errors retain the first candidate, including exact-level plateaus.
    if (Math.abs(candidateLevel - target) < Math.abs(combatLevel(level, best) - target)) best = candidate;
    if (candidateLevel < target) low = mid; else high = mid;
  }
  const offence = (best.attackLevel + level.rollLevelOffset) * (1 + best.accuracy / level.bonusDivisor) - level.rollLevelOffset;
  // The original correction combines the divisors; the level reader divides sequentially.
  const defence = (best.defenceLevel + level.rollLevelOffset)
    * (1 + (best.armour + best.magicArmour) / (level.defenceStyleCount * level.bonusDivisor)) - level.rollLevelOffset;
  best.maxHealth = Math.max(p.minimumHealth,
    Math.round((target - level.offenceWeight * offence - level.defenceWeight * defence) * p.healthPerCombatLevel));
  if (combatLevel(level, best) !== target) throw new Error(`Cannot tune ${sourceId} to combat level ${target}`);
  return best;
}

export function deriveLegacyBoss(p: EnemyBalanceStage1, input: Readonly<LegacyBossInput>): CombatResult {
  const target = p.regionalBossLevels[input.bossId];
  return tuneCombat(p.tuning, p.combatLevel, input.seed, target.tier * target.multiplier, target.tier, input.enemyId);
}

export function ordrunPhases(p: OrdrunPhaseParams,
  tuned: Readonly<Pick<CombatResult, 'armour' | 'maxHit'>>): BossPhase[] {
  const [first, second] = p;
  return [
    { atHealthFraction: first.atHealthFraction, armour: tuned.armour, attackSpeedMs: first.attackSpeedMs, maxHit: tuned.maxHit },
    {
      atHealthFraction: second.atHealthFraction,
      armour: Math.round(tuned.armour * second.armourNumerator / second.armourDenominator),
      attackSpeedMs: second.attackSpeedMs,
      maxHit: Math.round(tuned.maxHit * second.maxHitNumerator / second.maxHitDenominator),
      telegraphId: second.telegraphId, telegraphWindupMs: second.telegraphWindupMs, telegraphRadiusM: second.telegraphRadiusM,
    },
  ];
}
