import { arr, discriminated, enumOf, id, int, lit, num, obj, refine, str, tuple, type Infer, type Schema } from './core.js';

const positive = () => num({ exclusiveMin: 0 });
const nonnegative = () => num({ min: 0 });
const positiveInt = () => int({ min: 1 });
const chance = () => num({ min: 0, max: 1 });
const inputId = () => str({ nonEmpty: true });
export const LEGACY_BOSS_IDS = ['galeskin', 'tempest_roc', 'mossbound', 'rootheart', 'tideworn', 'ordrun', 'cinderwake'] as const;
export const SourceEnemyDerivationSchema = obj({ kind: lit('sourceEnemy.v1'), inputId: inputId() });
export const FantasyEnemyDerivationSchema = obj({ kind: lit('fantasyScale.v1'), sourceInputId: inputId(), tier: positiveInt() });
export const LegacyEnemyDerivationSchema = discriminated('kind', {
  'legacyMarks.v1': obj({ kind: lit('legacyMarks.v1'), inputId: inputId() }),
  'legacyBossCombat.v1': obj({ kind: lit('legacyBossCombat.v1'), inputId: inputId() }),
});
export const EnemyDerivationSchema = discriminated('kind', {
  ...LegacyEnemyDerivationSchema.members,
  'sourceEnemy.v1': SourceEnemyDerivationSchema,
  'fantasyScale.v1': FantasyEnemyDerivationSchema,
});
export const CombatInputSchema = obj({
  maxHealth: positive(), attackLevel: positive(), defenceLevel: positive(),
  accuracy: nonnegative(), armour: nonnegative(), magicArmour: nonnegative(), maxHit: positive(),
});
export const LegacyMarksInputSchema = obj({
  id: id(), enemyId: inputId(), tier: positiveInt(), profile: enumOf(['ordinary', 'purse'] as const),
});
export const LegacyBossInputSchema = obj({
  id: id(), enemyId: inputId(), bossId: enumOf(LEGACY_BOSS_IDS), seed: CombatInputSchema,
});
function uniqueInputs<T extends { id: string; enemyId: string }>(schema: Schema<T>) {
  return refine(arr(schema), rows => new Set(rows.map(row => row.id)).size === rows.length
    && new Set(rows.map(row => row.enemyId)).size === rows.length, 'input ids and target enemy ids must be unique');
}
export const LegacyMarksInputsSchema = uniqueInputs(LegacyMarksInputSchema);
export const LegacyBossInputsSchema = uniqueInputs(LegacyBossInputSchema);
export const OrdrunPhaseParamsSchema = refine(tuple([
  obj({ atHealthFraction: chance(), attackSpeedMs: positiveInt() }),
  obj({ atHealthFraction: chance(), armourNumerator: nonnegative(), armourDenominator: positive(),
    attackSpeedMs: positiveInt(), maxHitNumerator: nonnegative(), maxHitDenominator: positive(),
    telegraphId: inputId(), telegraphWindupMs: positiveInt(), telegraphRadiusM: positive() }),
] as const), phases => phases[1].atHealthFraction < phases[0].atHealthFraction,
'second phase health threshold must be lower than the first');
export type EnemyDerivation = Infer<typeof EnemyDerivationSchema>;
