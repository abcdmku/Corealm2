import type { EnemyDef } from '../index.js';
import type { EnemySourceInput, EnemySourceParams } from '../schema/enemySources.js';

export type { EnemySourceInput, EnemySourceParams, ExpansionSourceInput, StarterSourceInput,
  RpgSourceInput, RpgParams, RpgRoleParams, RpgBodyFamily, RpgRole } from '../schema/enemySources.js';
export type EnemyFieldsWithoutDrops = Omit<EnemyDef, 'drops'>;

/** Original expansion, starter and RPG factories. Inputs are pre-generation source arguments. */
export function deriveCoreEnemy(params: EnemySourceParams, input: Readonly<EnemySourceInput>): EnemyFieldsWithoutDrops {
  switch (input.kind) {
    case 'expansion': {
      const { enemyId: id, family, name, tier } = input.identity;
      return { ...input.authored, id, family, name, tier,
        marks: [params.expansion.marksPerTier[0] * tier, params.expansion.marksPerTier[1] * tier] };
    }
    case 'starter': {
      const p = params.starter;
      return {
        id: `${input.speciesId}_t${p.tier}`, family: input.speciesId, name: input.name, tier: p.tier,
        maxHealth: input.health, attackLevel: p.attackLevel, defenceLevel: p.defenceLevel,
        accuracy: p.accuracy, armour: input.armour, magicArmour: p.magicArmour,
        maxHit: p.maxHit, attackSpeedMs: p.attackSpeedMs,
        aggroRadius: input.behaviour === 'aggressive' ? p.aggroRadius.aggressive : p.aggroRadius.other,
        moveSpeedMps: input.moveSpeedMps, walkSpeedMps: Math.min(p.walkSpeedCap, input.moveSpeedMps / p.walkSpeedDivisor),
        behaviour: input.behaviour, marks: [p.marks[0], p.marks[1]],
      };
    }
    case 'rpg': {
      const p = params.rpg, role = p.roles[input.role], tier = input.tier;
      const attackStyle = p.rangedActions.includes(input.action) ? 'ranged'
        : p.magicActions.includes(input.action) ? 'magic' : 'melee';
      return {
        id: `${input.speciesId}_t${tier}`, family: input.speciesId, name: input.name, tier,
        attackStyle, attackRangeM: p.attackRangeM[attackStyle],
        maxHealth: Math.round((p.healthBase + tier * p.healthPerTier) * role.healthMultiplier),
        attackLevel: tier + role.attackLevelOffset, defenceLevel: tier + role.defenceLevelOffset,
        accuracy: role.accuracy, armour: role.armour,
        magicArmour: input.role === 'caster' ? p.magicArmour.caster
          : input.bodyFamily === 'golem' ? p.magicArmour.golem : p.magicArmour.other,
        maxHit: Math.max(p.maxHitMinimum, Math.round(tier * p.maxHitPerTier + role.maxHitOffset)),
        attackSpeedMs: role.attackSpeedMs, aggroRadius: role.aggroRadius,
        moveSpeedMps: role.moveSpeedMps, walkSpeedMps: p.walkSpeedMps,
        behaviour: p.territorialFamilies.includes(input.bodyFamily) ? 'territorial' : 'aggressive',
        marks: [Math.max(p.marksMinimum[0], tier * p.marksPerTier[0]),
          Math.max(p.marksMinimum[1], tier * p.marksPerTier[1])],
      };
    }
  }
}
