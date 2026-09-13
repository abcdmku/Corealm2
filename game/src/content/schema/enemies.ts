import type { EnemyDef } from "../index.js";
import { DropSchema } from "./loot.js";
import { EnemyDerivationSchema, SourceEnemyDerivationSchema } from './enemyDerivation.js';
import { arr, enumOf, id, int, lit, num, obj, opt, ref, refine, str, tuple, union, type Infer, type Schema } from "./core.js";

const nonempty = () => str({ nonEmpty: true });
const IdentityMeta = { readOnly: true, identity: true } as const;
const OrderSchema = int({ min: 0 }, IdentityMeta);

// EnemyDef uses mutable pairs. The explicit tuple generic preserves assignability.
// Do not reuse core.intRange, whose inferred pair is readonly.
const MarksRangeSchema = refine(
  tuple<[Schema<number>, Schema<number>]>([int({ min: 0 }), int({ min: 0 })]),
  ([low, high]) => low <= high,
  "marks minimum must not exceed maximum",
);

export const EnemyFields = {
  id: id(),
  name: nonempty(),
  family: ref("enemyFamily"),
  tier: int({ min: 1 }),
  maxHealth: int({ min: 1 }),
  attackLevel: int({ min: 1 }),
  defenceLevel: int({ min: 1 }),
  accuracy: int({ min: 0 }),
  armour: int({ min: 0 }),
  magicArmour: int({ min: 0 }),
  maxHit: int({ min: 1 }),
  attackSpeedMs: int({ min: 1 }, { unit: "ms" }),
  aggroRadius: num({ min: 0 }, { unit: "m" }),
  behaviour: enumOf(["passive", "aggressive", "territorial"] as const),
  moveSpeedMps: opt(num({ exclusiveMin: 0 }, { unit: "m/s" })),
  walkSpeedMps: opt(num({ exclusiveMin: 0 }, { unit: "m/s" })),
  marks: opt(MarksRangeSchema),
  attackStyle: opt(enumOf(["melee", "ranged", "magic"] as const)),
  attackRangeM: opt(num({ exclusiveMin: 0 }, { unit: "m" })),
  respawnSeconds: opt(num({ min: 0 }, { unit: "s" })),
};

export const EnemySchema = obj({
  ...EnemyFields,
  drops: arr(DropSchema),
}) satisfies Schema<EnemyDef>;

export const REGISTERED_ENEMY_CATALOGS = [
  "LEGACY_BLOCKS", "CREATURE_SPECIES_BLOCKS", "RPG_BESTIARY_BLOCKS",
  "FANTASY_TIER_BLOCKS", "WILDERNESS_BLOCKS",
] as const;
export const LAB_ENEMY_CATALOGS = [
  "RPG_BESTIARY_STAGED_BLOCKS", "REGIONAL_BOSS_BLOCKS",
] as const;
export const ENEMY_CATALOGS = [
  ...REGISTERED_ENEMY_CATALOGS, ...LAB_ENEMY_CATALOGS,
] as const;
export type EnemyCatalog = typeof ENEMY_CATALOGS[number];

export const ALIAS_CATALOGS = [
  "GROUP_ALIASES", "FANTASY_ENCOUNTER_BLOCKS", "WILDERNESS_GROUP_ALIASES",
] as const;
export type AliasCatalog = typeof ALIAS_CATALOGS[number];

const EnemyRecordFields = {
  ...EnemyFields,
  lootTableId: ref("lootTable"),
};
const RegisteredEnemyRecordSchema = obj({
  ...EnemyRecordFields,
  catalog: enumOf(REGISTERED_ENEMY_CATALOGS, IdentityMeta),
  stage: lit("registered", IdentityMeta),
  registrationOrder: OrderSchema,
  fantasyTierOrder: opt(OrderSchema),
  derivation: opt(EnemyDerivationSchema),
});
const LabEnemyRecordSchema = obj({
  ...EnemyRecordFields,
  catalog: enumOf(LAB_ENEMY_CATALOGS, IdentityMeta),
  stage: lit("labOnly", IdentityMeta),
  labOrder: OrderSchema,
  derivation: opt(SourceEnemyDerivationSchema),
});
export const EnemyRecordSchema = union([
  RegisteredEnemyRecordSchema, LabEnemyRecordSchema,
] as const);
export type EnemyRecord = Infer<typeof EnemyRecordSchema>;

// Closed partial EnemyDef excluding id and drops. List the fields explicitly;
// do not widen them through Object.fromEntries or Record<string, Schema>.
export const EnemyOverridesSchema = obj({
  name: opt(EnemyFields.name), family: opt(EnemyFields.family),
  tier: opt(EnemyFields.tier), maxHealth: opt(EnemyFields.maxHealth),
  attackLevel: opt(EnemyFields.attackLevel), defenceLevel: opt(EnemyFields.defenceLevel),
  accuracy: opt(EnemyFields.accuracy), armour: opt(EnemyFields.armour),
  magicArmour: opt(EnemyFields.magicArmour), maxHit: opt(EnemyFields.maxHit),
  attackSpeedMs: opt(EnemyFields.attackSpeedMs), aggroRadius: opt(EnemyFields.aggroRadius),
  behaviour: opt(EnemyFields.behaviour),
  moveSpeedMps: EnemyFields.moveSpeedMps, walkSpeedMps: EnemyFields.walkSpeedMps,
  marks: EnemyFields.marks, attackStyle: EnemyFields.attackStyle,
  attackRangeM: EnemyFields.attackRangeM, respawnSeconds: EnemyFields.respawnSeconds,
});
const AliasFields = {
  id: id(),
  blockId: ref("enemy", IdentityMeta),
  registrationOrder: OrderSchema,
  overrides: EnemyOverridesSchema,
  lootTableId: opt(ref("lootTable")),
};
export const EnemyAliasSchema = union([
  obj({
    ...AliasFields,
    catalog: enumOf(["GROUP_ALIASES", "WILDERNESS_GROUP_ALIASES"] as const, IdentityMeta),
  }),
  obj({
    ...AliasFields,
    catalog: lit("FANTASY_ENCOUNTER_BLOCKS", IdentityMeta),
    speciesId: ref("species"),
    lineage: tuple([
      ref("enemy", IdentityMeta), ref("enemy", IdentityMeta),
    ] as const, IdentityMeta),
  }),
] as const);
export type EnemyAlias = Infer<typeof EnemyAliasSchema>;
