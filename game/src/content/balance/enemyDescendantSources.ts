import { tuneCombat, type CombatLevelParams, type TuningParams } from './enemies.js';
import type { EnemyFieldsWithoutDrops } from './enemySources.js';
import type { DescendantSourceInput, DescendantSourceParams } from '../schema/enemyDescendantSources.js';
export type { DescendantSourceInput, DescendantSourceParams, FairyCrownSourceInput, CrownwardDragonSourceInput } from '../schema/enemyDescendantSources.js';

export interface DescendantSourceDependencies {
  combatLevel: CombatLevelParams;
  tuning: TuningParams;
  resolveSource: (inputId: string) => Readonly<EnemyFieldsWithoutDrops> | undefined;
}

/** These original factories patch source identity and motion before combat tuning. */
export function deriveDescendantEnemy(params: DescendantSourceParams, input: Readonly<DescendantSourceInput>,
  dependencies: DescendantSourceDependencies): EnemyFieldsWithoutDrops {
  const source = dependencies.resolveSource(input.sourceInputId);
  if (!source) throw new Error(`Missing source dependency ${input.sourceInputId} for ${input.id}`);
  let base: EnemyFieldsWithoutDrops;
  if (input.kind === 'fairyCrown') {
    const p = params.fairyCrown, multiplier = Math.min(p.movementScaleCap, input.nativeScale);
    const marks = input.boss ? p.marksPerTier.boss : p.marksPerTier.ordinary;
    base = { ...source, id: `${input.speciesId}_t${input.tier}`, family: input.speciesId, name: input.name,
      tier: input.tier, behaviour: input.behaviour,
      ...(source.moveSpeedMps === undefined ? {} : { moveSpeedMps: source.moveSpeedMps * multiplier }),
      ...(source.walkSpeedMps === undefined ? {} : { walkSpeedMps: source.walkSpeedMps * multiplier }),
      attackRangeM: input.boss ? Math.max(p.attackRangeM.boss.minimum, source.attackRangeM ?? p.attackRangeM.boss.fallback)
        : Math.min(p.attackRangeM.ordinary.maximum, source.attackRangeM ?? p.attackRangeM.ordinary.fallback),
      aggroRadius: input.boss ? p.aggroRadius.boss : p.aggroRadius[input.behaviour],
      marks: [input.tier * marks[0], input.tier * marks[1]] };
  } else {
    const p = params.crownwardDragon, marks = p.marks[input.rank];
    base = { ...source, id: `${input.speciesId}_t${p.tier}`, family: input.speciesId, name: input.name,
      tier: p.tier, behaviour: p.behaviour, aggroRadius: p.aggroRadius[input.rank], marks: [marks[0], marks[1]] };
  }
  return { ...base, ...tuneCombat(dependencies.tuning, dependencies.combatLevel, base, input.targetLevel, base.tier, base.id) };
}
