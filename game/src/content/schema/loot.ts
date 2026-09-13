import { arr, id, int, lit, num, obj, opt, ref, refine, str, tuple, union, type Infer, type Schema } from "./core.js";
import { SourceLootDerivationSchema } from './lootDerivation.js';

const nonempty = () => str({ nonEmpty: true });
const IdentityMeta = { readOnly: true, identity: true } as const;

// EnemyDef uses mutable pairs. The explicit tuple generic preserves assignability.
// Do not reuse core.intRange, whose inferred pair is readonly.
const QuantityRangeSchema = refine(
  tuple<[Schema<number>, Schema<number>]>([int({ min: 1 }), int({ min: 1 })]),
  ([low, high]) => low <= high,
  "quantity minimum must not exceed maximum",
);

export const DropSchema = obj({
  itemId: ref("item"),
  quantity: QuantityRangeSchema,
  chance: num({ min: 0, max: 1 }),
  exclusiveGroup: opt(nonempty()),
});

export const LOOT_CATALOGS = [
  "ENEMY_BLOCK_LOOT", "CREATURE_SOURCE_LOOT", "ENEMY_ALIAS_LOOT",
] as const;
export type LootCatalog = typeof LOOT_CATALOGS[number];

const LootFields = { id: id(), drops: arr(DropSchema), derivation: opt(SourceLootDerivationSchema) };
const LootTableObjectSchema = union([
  obj({ ...LootFields, catalog: lit("ENEMY_BLOCK_LOOT", IdentityMeta), ownerId: ref("enemy", IdentityMeta) }),
  obj({ ...LootFields, catalog: lit("CREATURE_SOURCE_LOOT", IdentityMeta), ownerId: ref("species", IdentityMeta) }),
  obj({ ...LootFields, catalog: lit("ENEMY_ALIAS_LOOT", IdentityMeta), ownerId: ref("enemy", IdentityMeta) }),
] as const);

export const LootTableSchema = refine(LootTableObjectSchema, row => {
  const prefix = row.catalog === "ENEMY_BLOCK_LOOT" ? "loot_enemy_"
    : row.catalog === "CREATURE_SOURCE_LOOT" ? "loot_species_" : "loot_alias_";
  return row.id === prefix + row.ownerId;
}, "loot table id must match its stable owner");
export type LootTableRecord = Infer<typeof LootTableSchema>;
