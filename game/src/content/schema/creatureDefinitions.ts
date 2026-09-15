import { arr, enumOf, id, int, lit, num, obj, opt, ref, str, union, type Infer } from './core.js';
import { SpeciesFields, RpgFields } from './creatures.js';
import { EnemyOverridesSchema } from './enemies.js';
import { DropSchema } from './loot.js';

export const CreatureProfileSchema = obj({
  id: id(), name: str({ nonEmpty: true }, { label: 'Name', display: true }),
  role: enumOf(['grazer', 'skirmisher', 'brute', 'guardian', 'caster', 'boss'] as const, { label: 'Role' }),
  healthPerLevel: num({ exclusiveMin: 0 }, { label: 'Health per level', group: 'curve' }), healthBase: num({ min: 0 }, { label: 'Health base', group: 'curve' }),
  attackMultiplier: num({ exclusiveMin: 0 }, { label: 'Attack multiplier', group: 'curve' }), defenceMultiplier: num({ exclusiveMin: 0 }, { label: 'Defence multiplier', group: 'curve' }),
  accuracyPerLevel: num({ min: 0 }, { label: 'Accuracy per level', group: 'curve' }), armourPerLevel: num({ min: 0 }, { label: 'Armour per level', group: 'curve' }),
  magicArmourPerLevel: num({ min: 0 }, { label: 'Magic armour per level', group: 'curve' }), hitPerLevel: num({ exclusiveMin: 0 }, { label: 'Max hit per level', group: 'curve' }),
  attackSpeedMs: int({ min: 1 }, { label: 'Attack interval', unit: 'ms', group: 'curve' }), marksPerLevel: num({ min: 0 }, { label: 'Marks per level', group: 'curve' }),
});
export type CreatureProfile = Infer<typeof CreatureProfileSchema>;
export const CreaturePresentationSchema = union([
  obj({ ...SpeciesFields, kind: lit('basic') }),
  obj({ ...SpeciesFields, ...RpgFields, kind: lit('rpg') }),
] as const);
export const CreatureLootSchema = union([
  obj({ tableId: ref('lootTable', { label: 'Loot table', role: 'Rolled by' }) }),
  obj({ drops: arr(DropSchema, {}, { label: 'Drops', role: 'Dropped by', probability: 'chance' }) }),
] as const);
export const CreatureDefinitionSchema = obj({
  id: id(), baseId: opt(ref('enemy', { role: 'Base of' }), { label: 'Base creature', role: 'Base of', help: 'Every unset field is inherited from this creature.' }),
  name: opt(str({ nonEmpty: true }), { label: 'Name', display: true }), family: opt(ref('enemyFamily', { role: 'Family of' }), { label: 'Family', role: 'Family of' }),
  availability: enumOf(['world', 'lab'] as const, { label: 'Availability' }),
  level: opt(int({ min: 1 }), { label: 'Level' }), profileId: opt(ref('creatureProfile', { role: 'Uses role' }), { label: 'Role curve', role: 'Uses role' }),
  presentation: opt(CreaturePresentationSchema, { label: 'Presentation' }),
  adjustments: opt(EnemyOverridesSchema, { label: 'Adjustments' }), loot: opt(CreatureLootSchema, { label: 'Loot' }),
});
export type CreatureDefinition = Infer<typeof CreatureDefinitionSchema>;
