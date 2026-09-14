import { tuneCombat, type CombatLevelParams, type RegionalBossLevelParams, type TuningParams } from './enemies.js';
import type { EnemyFieldsWithoutDrops } from './enemySources.js';
import type { WildernessBaseSourceInput, WildernessKeeperRow, WildernessSourceParams } from '../schema/enemyWildernessSources.js';
export type { WildernessBaseSourceInput, WildernessBodySourceInput, WildernessDragonSourceInput,
  RegionalBossBodySourceInput, WildernessSourceParams, WildernessKeeperRow, WildernessKeeperId } from '../schema/enemyWildernessSources.js';

export interface WildernessSourceDependencies {
  combatLevel: CombatLevelParams;
  tuning: TuningParams;
  regionalBossLevels: RegionalBossLevelParams;
  keepers: readonly Readonly<WildernessKeeperRow>[];
  resolveSource: (inputId: string) => Readonly<EnemyFieldsWithoutDrops> | undefined;
}

/** Original source generation, before Wilderness canonical and encounter retuning. */
export function deriveWildernessSourceEnemy(params: WildernessSourceParams, input: Readonly<WildernessBaseSourceInput>,
  dependencies: WildernessSourceDependencies): EnemyFieldsWithoutDrops {
  const tune = (base: Readonly<EnemyFieldsWithoutDrops>, target: number, tier: number): EnemyFieldsWithoutDrops =>
    ({ ...base, ...tuneCombat(dependencies.tuning, dependencies.combatLevel, base, target, tier, base.id) });
  if (input.kind === 'regionalBossBody') {
    const base = dependencies.resolveSource(input.sourceInputId);
    if (!base) throw new Error(`Missing source dependency ${input.sourceInputId} for ${input.id}`);
    const target = dependencies.regionalBossLevels[input.bossId];
    if (!target) throw new Error(`Missing regional boss parameters ${input.bossId} for ${input.id}`);
    return { ...tune(base, target.tier * target.multiplier, target.tier),
      id: `${input.speciesId}_t${target.tier}`, family: input.speciesId, name: input.name,
      behaviour: params.regionalBossBody.behaviour };
  }
  if (input.kind === 'wildernessDragon') {
    const p = params.wildernessDragon, tier = input.tier, profile = tier === p.shallowTier ? p.shallow : p.deep;
    return tune({ id: `${input.speciesId}_t${tier}`, family: input.speciesId, name: input.name, tier,
      maxHealth: tier * p.healthPerTier, attackLevel: tier + p.attackLevelOffset, defenceLevel: tier + p.defenceLevelOffset,
      accuracy: p.accuracy, armour: p.armour, magicArmour: p.magicArmour, maxHit: Math.round(tier * p.maxHitPerTier),
      ...profile, attackStyle: 'melee', behaviour: 'aggressive',
      marks: [tier * p.marksPerTier[0], tier * p.marksPerTier[1]] }, input.targetLevel, tier);
  }
  const p = params.wildernessBody;
  let speciesId: string, name: string, tier: number, level: number;
  if (input.role === 'keeper') {
    const matches = dependencies.keepers.filter(row => row.id === input.keeperId);
    if (matches.length !== 1) throw new Error(`Expected one keeper dependency ${input.keeperId} for ${input.id}`);
    const keeper = matches[0]!;
    speciesId = keeper.id; name = keeper.name; tier = keeper.tier; level = keeper.tier * keeper.multiplier;
  } else {
    speciesId = input.speciesId; name = input.name; tier = input.tier; level = input.targetLevel;
  }
  const heavy = p.heavyRoles.includes(input.role), magic = p.magicRoles.includes(input.role) || p.magicSpeciesIds.includes(speciesId);
  const keeper = input.role === 'keeper';
  return tune({ id: `${speciesId}_t${tier}`, family: speciesId, name, tier,
    attackStyle: magic ? 'magic' : 'melee', attackRangeM: magic ? p.attackRangeM.magic : heavy ? p.attackRangeM.heavy : p.attackRangeM.other,
    maxHealth: level * (heavy ? p.healthPerLevel.heavy : p.healthPerLevel.other),
    attackLevel: Math.round(level * (magic ? p.attackLevelMultiplier.magic : heavy ? p.attackLevelMultiplier.heavy : p.attackLevelMultiplier.other)),
    defenceLevel: Math.round(level * (heavy ? p.defenceLevelMultiplier.heavy : p.defenceLevelMultiplier.other)),
    accuracy: magic ? p.accuracy.magic : input.role === 'predator' ? p.accuracy.predator : p.accuracy.other,
    armour: magic ? p.armour.magic : heavy ? p.armour.heavy : p.armour.other,
    magicArmour: magic ? p.magicArmour.magic : tier === p.deepTier ? p.magicArmour.deep : p.magicArmour.other,
    maxHit: Math.round(tier * (keeper ? p.maxHitPerTier.keeper : heavy ? p.maxHitPerTier.heavy : p.maxHitPerTier.other)),
    attackSpeedMs: keeper ? p.attackSpeedMs.keeper : heavy ? p.attackSpeedMs.heavy : magic ? p.attackSpeedMs.magic : p.attackSpeedMs.other,
    aggroRadius: keeper ? p.aggroRadius.keeper : magic ? p.aggroRadius.magic : p.aggroRadius.other,
    moveSpeedMps: magic ? p.moveSpeedMps.magic : heavy ? p.moveSpeedMps.heavy : p.moveSpeedMps.other,
    walkSpeedMps: heavy ? p.walkSpeedMps.heavy : p.walkSpeedMps.other,
    behaviour: heavy ? 'territorial' : 'aggressive',
    marks: [tier * p.marks.minimumPerTier, tier * (keeper ? p.marks.maximumPerTier.keeper : p.marks.maximumPerTier.other)] }, level, tier);
}
