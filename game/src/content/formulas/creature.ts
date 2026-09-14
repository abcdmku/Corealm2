import type { CreatureProfile } from '../schema/creatureDefinitions.js';
import type { EnemyDef } from '../index.js';

export function calculateCreatureCombat(level: number, profile: CreatureProfile): Omit<EnemyDef, 'id' | 'name' | 'family' | 'drops'> {
  if (!Number.isInteger(level) || level < 1) throw new Error('Creature level must be a positive integer');
  return {
    tier: level, maxHealth: Math.max(1, Math.round(profile.healthBase + level * profile.healthPerLevel)),
    attackLevel: Math.max(1, Math.round(level * profile.attackMultiplier)),
    defenceLevel: Math.max(1, Math.round(level * profile.defenceMultiplier)),
    accuracy: Math.round(level * profile.accuracyPerLevel), armour: Math.round(level * profile.armourPerLevel),
    magicArmour: Math.round(level * profile.magicArmourPerLevel), maxHit: Math.max(1, Math.round(1 + level * profile.hitPerLevel)),
    attackSpeedMs: profile.attackSpeedMs, behaviour: profile.role === 'grazer' ? 'passive' : 'aggressive',
    aggroRadius: profile.role === 'grazer' ? 5 : 10,
    marks: [Math.round(level * profile.marksPerLevel), Math.round(level * profile.marksPerLevel * 2)],
    attackStyle: profile.role === 'caster' ? 'magic' : 'melee', attackRangeM: profile.role === 'caster' ? 9 : 2,
  };
}

