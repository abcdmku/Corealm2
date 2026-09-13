import { tuneCombat, type CombatLevelParams, type TuningParams } from './enemies.js';
import type { EnemyFieldsWithoutDrops } from './enemySources.js';
import type { ActorEnemySourceInput, ActorSourceParams } from '../schema/enemyActorSources.js';
export type { ActorEnemySourceInput, ActorSourceParams, UniversalSourceInput, FairySourceInput,
  GardenSourceInput } from '../schema/enemyActorSources.js';

export interface ActorTuningDependencies { combatLevel: CombatLevelParams; tuning: TuningParams }

/** Original actor templates are tuned before the roster's explicit patches. */
export function deriveActorEnemy(params: ActorSourceParams, input: Readonly<ActorEnemySourceInput>,
  dependencies: ActorTuningDependencies): EnemyFieldsWithoutDrops {
  const p = params[input.kind], base = p.template;
  const target = input.kind === 'universal'
    ? Math.max(params.universal.minimumTargetLevel, Math.round(input.tier * params.universal.targetLevelMultiplier))
    : input.tier + input.levelOffset;
  const tuned = { ...base, ...tuneCombat(dependencies.tuning, dependencies.combatLevel, base, target, input.tier, base.id) };
  if (input.kind === 'universal') {
    const p = params.universal;
    return { ...tuned, id: `guardian_${input.number}_t${input.tier}`, family: `guardian_${input.number}`,
      name: input.name, attackStyle: input.style, respawnSeconds: p.respawnSeconds,
      marks: [Math.max(p.marksMinimum[0], input.tier * p.marksPerTier[0]),
        Math.max(p.marksMinimum[1], input.tier * p.marksPerTier[1])] };
  }
  const identity = { id: input.speciesId, family: input.family, name: input.name };
  if (input.kind === 'fairy') {
    const p = params.fairy, aggressive = input.levelOffset >= p.aggressiveLevelOffset;
    return { ...tuned, ...identity, behaviour: aggressive ? 'aggressive' : 'territorial',
      aggroRadius: aggressive ? p.aggroRadius.aggressive : p.aggroRadius.other,
      marks: [input.tier * p.marksPerTier[0], input.tier * p.marksPerTier[1]] };
  }
  const garden = params.garden;
  return { ...tuned, ...identity, behaviour: input.behaviour, moveSpeedMps: input.speed,
    walkSpeedMps: Math.min(garden.walkSpeedCap, input.speed * garden.walkSpeedMultiplier),
    aggroRadius: input.behaviour === 'aggressive' ? garden.aggroRadius.aggressive : garden.aggroRadius.other,
    marks: [input.tier * garden.marksPerTier[0], input.tier * garden.marksPerTier[1]] };
}
