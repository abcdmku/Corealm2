import type { EnemyDef } from '../index.js';
import type { EnemyFieldsWithoutDrops } from './enemySources.js';
import type { FantasyParams, VariantEnemySourceInput, VariantParams } from '../schema/enemySourceVariants.js';
export type { FantasyParams, VariantEnemySourceInput, VariantSourceInput, RedesignSourceInput, VariantParams } from '../schema/enemySourceVariants.js';

export function deriveVariantEnemy(params: VariantParams, input: Readonly<VariantEnemySourceInput>,
  base: Readonly<EnemyFieldsWithoutDrops>): EnemyFieldsWithoutDrops {
  if (!base) throw new Error(`Missing source dependency ${input.sourceInputId} for ${input.id}`);
  if (input.kind === 'variant') {
    return { ...base, id: `${input.speciesId}_t${base.tier}`, family: input.speciesId, name: input.name,
      maxHealth: input.health, magicArmour: base.magicArmour + params.variant.magicArmourBonus };
  }
  const result = { ...base, id: `${input.speciesId}_t${input.tier}`, family: input.speciesId,
    name: input.name, tier: input.tier, maxHealth: input.health, behaviour: input.behaviour };
  return input.profile === 'ash'
    ? { ...result, attackStyle: params.redesign.ash.attackStyle, attackRangeM: input.attackRangeM }
    : result;
}

/** Original fantasy mapping, including its native object identity and own undefined marks. */
export function scaleFantasy(params: FantasyParams, source: Readonly<EnemyDef>, tier: number): EnemyDef {
  if (tier === source.tier) return source;
  const ratio = tier / source.tier, minimum = params.minimums;
  const scaled = (value: number, floor: number) => Math.max(floor, Math.round(value * ratio));
  return { ...source, id: `${source.family}_t${tier}`, tier,
    maxHealth: scaled(source.maxHealth, minimum.maxHealth), attackLevel: scaled(source.attackLevel, minimum.attackLevel),
    defenceLevel: scaled(source.defenceLevel, minimum.defenceLevel), accuracy: scaled(source.accuracy, minimum.accuracy),
    armour: scaled(source.armour, minimum.armour), magicArmour: scaled(source.magicArmour, minimum.magicArmour),
    maxHit: scaled(source.maxHit, minimum.maxHit),
    marks: source.marks ? [scaled(source.marks[0], minimum.marks), scaled(source.marks[1], minimum.marks)] : undefined };
}
