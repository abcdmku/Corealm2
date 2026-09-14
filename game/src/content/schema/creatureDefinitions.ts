import { arr, enumOf, id, int, lit, num, obj, opt, ref, str, union, type Infer } from './core.js';
import { SpeciesFields, RpgFields } from './creatures.js';
import { EnemyOverridesSchema } from './enemies.js';
import { DropSchema } from './loot.js';

export const CreatureProfileSchema = obj({
  id: id(), name: str({ nonEmpty: true }),
  role: enumOf(['grazer', 'skirmisher', 'brute', 'guardian', 'caster', 'boss'] as const),
  healthPerLevel: num({ exclusiveMin: 0 }), healthBase: num({ min: 0 }),
  attackMultiplier: num({ exclusiveMin: 0 }), defenceMultiplier: num({ exclusiveMin: 0 }),
  accuracyPerLevel: num({ min: 0 }), armourPerLevel: num({ min: 0 }),
  magicArmourPerLevel: num({ min: 0 }), hitPerLevel: num({ exclusiveMin: 0 }),
  attackSpeedMs: int({ min: 1 }), marksPerLevel: num({ min: 0 }),
});
export type CreatureProfile = Infer<typeof CreatureProfileSchema>;
export const CreaturePresentationSchema = union([
  obj({ ...SpeciesFields, kind: lit('basic') }),
  obj({ ...SpeciesFields, ...RpgFields, kind: lit('rpg') }),
] as const);
export const CreatureLootSchema = union([
  obj({ tableId: ref('lootTable') }), obj({ drops: arr(DropSchema) }),
] as const);
export const CreatureDefinitionSchema = obj({
  id: id(), baseId: opt(ref('enemy')),
  name: opt(str({ nonEmpty: true })), family: opt(str({ nonEmpty: true })),
  availability: enumOf(['world', 'lab'] as const),
  level: opt(int({ min: 1 })), profileId: opt(ref('creatureProfile')),
  presentation: opt(CreaturePresentationSchema),
  adjustments: opt(EnemyOverridesSchema), loot: opt(CreatureLootSchema),
});
export type CreatureDefinition = Infer<typeof CreatureDefinitionSchema>;
