import { arr, enumOf, id, int, lit, num, obj, opt, refine, str, tuple, union, type Infer, type Schema } from './core.js';

const positive = () => num({ exclusiveMin: 0 });
const nonnegative = () => num({ min: 0 });
const positiveInt = () => int({ min: 1 });
const nonempty = () => str({ nonEmpty: true });
const gold = () => refine(tuple<[Schema<number>, Schema<number>]>([int({ min: 0 }), int({ min: 0 })]),
  ([low, high]) => low <= high, 'gold minimum must not exceed maximum');
const behaviour = () => enumOf(['passive', 'aggressive', 'territorial'] as const);
export const RPG_BODY_FAMILIES = ['goblin', 'orc', 'skeleton', 'zombie', 'wraith', 'golem', 'harpy',
  'gargoyle', 'gnoll', 'lizardman', 'minotaur', 'demon', 'spider', 'wasp', 'forest_creature',
  'elemental', 'roach', 'troll', 'rat'] as const;
export const RPG_ROLES = ['skirmisher', 'fighter', 'brute', 'caster', 'guard'] as const;
export const SOURCE_REGION_IDS = ['fallowmarch', 'vellenwood', 'karrowmoor', 'gravelmaw', 'kilnhalt',
  'wilderness', 'crownward', 'gloamgarden', 'faeholme'] as const;

// Explicit source fields prevent identity, rewards or arbitrary overrides entering authored stats.
// `enemyId`, `speciesId` and `family` below name the row this input defines, not a row it points
// at, so they stay `str()`: making them `ref()` would draw a picker for something being created.
export const ExpansionAuthoredSchema = obj({
  maxHealth: positiveInt(), attackLevel: positiveInt(), defenceLevel: positiveInt(),
  accuracy: int({ min: 0 }), armour: int({ min: 0 }), magicArmour: int({ min: 0 }),
  maxHit: positiveInt(), attackSpeedMs: positiveInt(), aggroRadius: nonnegative(), behaviour: behaviour(),
  moveSpeedMps: opt(positive()), walkSpeedMps: opt(positive()),
  attackStyle: opt(enumOf(['melee', 'ranged', 'magic'] as const)), attackRangeM: opt(positive()),
  respawnSeconds: opt(nonnegative()),
});
export const ExpansionSourceInputSchema = obj({
  id: id(), kind: lit('expansion'),
  identity: obj({ enemyId: nonempty(), family: nonempty(), name: nonempty(), tier: positiveInt() }),
  authored: ExpansionAuthoredSchema,
});
export const StarterSourceInputSchema = obj({
  id: id(), kind: lit('starter'), speciesId: nonempty(), name: nonempty(), health: positiveInt(),
  behaviour: behaviour(), armour: int({ min: 0 }), moveSpeedMps: positive(),
});
export const RpgSourceInputSchema = obj({
  id: id(), kind: lit('rpg'), speciesId: nonempty(), name: nonempty(),
  bodyFamily: enumOf(RPG_BODY_FAMILIES), regionId: enumOf(SOURCE_REGION_IDS), tier: positiveInt(),
  role: enumOf(RPG_ROLES), action: nonempty(),
});
export const SourceInputSchema = union([
  ExpansionSourceInputSchema, StarterSourceInputSchema, RpgSourceInputSchema,
] as const);
export const SourceInputsSchema = refine(arr(SourceInputSchema),
  rows => new Set(rows.map(row => row.id)).size === rows.length, 'source input ids must be unique');

export const RpgRoleParamsSchema = obj({
  healthMultiplier: positive(), attackLevelOffset: int({ min: 0 }), defenceLevelOffset: int({ min: 0 }),
  accuracy: int({ min: 0 }), armour: int({ min: 0 }), maxHitOffset: nonnegative(),
  attackSpeedMs: positiveInt(), aggroRadius: nonnegative(), moveSpeedMps: positive(),
});
const uniqueStrings = <T extends string>(schema: Schema<T>) => refine(arr(schema),
  values => new Set(values).size === values.length, 'values must be unique');
export const RpgParamsSchema = refine(obj({
  healthBase: positive(), healthPerTier: positive(), maxHitMinimum: positiveInt(), maxHitPerTier: positive(),
  roles: obj({ skirmisher: RpgRoleParamsSchema, fighter: RpgRoleParamsSchema, brute: RpgRoleParamsSchema,
    caster: RpgRoleParamsSchema, guard: RpgRoleParamsSchema }),
  magicArmour: obj({ caster: int({ min: 0 }), golem: int({ min: 0 }), other: int({ min: 0 }) }),
  attackRangeM: obj({ melee: positive(), ranged: positive(), magic: positive() }),
  rangedActions: uniqueStrings(nonempty()), magicActions: uniqueStrings(nonempty()),
  territorialFamilies: uniqueStrings(enumOf(RPG_BODY_FAMILIES)), walkSpeedMps: positive(),
  goldMinimum: gold(), goldPerTier: gold(),
}), p => Object.values(p.roles).every(role => (p.healthBase + p.healthPerTier) * role.healthMultiplier >= .5),
'every RPG role must round to positive health at tier 1');
export const StarterParamsSchema = obj({
  tier: positiveInt(), attackLevel: positiveInt(), defenceLevel: positiveInt(), accuracy: int({ min: 0 }),
  magicArmour: int({ min: 0 }), maxHit: positiveInt(), attackSpeedMs: positiveInt(),
  aggroRadius: obj({ aggressive: nonnegative(), other: nonnegative() }),
  walkSpeedCap: positive(), walkSpeedDivisor: positive(), gold: gold(),
});
export const SourceParamsSchema = obj({
  expansion: obj({ goldPerTier: gold() }), starter: StarterParamsSchema, rpg: RpgParamsSchema,
});

export type ExpansionSourceInput = Infer<typeof ExpansionSourceInputSchema>;
export type StarterSourceInput = Infer<typeof StarterSourceInputSchema>;
export type RpgSourceInput = Infer<typeof RpgSourceInputSchema>;
export type EnemySourceInput = Infer<typeof SourceInputSchema>;
export type EnemySourceParams = Infer<typeof SourceParamsSchema>;
export type RpgRoleParams = Infer<typeof RpgRoleParamsSchema>;
export type RpgParams = Infer<typeof RpgParamsSchema>;
export type RpgBodyFamily = typeof RPG_BODY_FAMILIES[number];
export type RpgRole = typeof RPG_ROLES[number];
