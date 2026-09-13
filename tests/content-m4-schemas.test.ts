import { beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { existsSync } from "node:fs";
import { repoRoot } from "../tools/lib/paths.js";
import { buildM4Baseline, type M4Baseline } from "../tools/content/m4-baseline.js";
import {
  ALIAS_CATALOGS,
  ENEMY_CATALOGS,
  EnemyAliasSchema,
  EnemyOverridesSchema,
  EnemyRecordSchema,
  EnemySchema,
  type EnemyCatalog,
} from "../game/src/content/schema/enemies.js";
import {
  BasicCreatureSchema,
  CreatureRecordSchema,
  CreatureRuntimeSchema,
  CREATURE_CATALOGS,
  RpgCreatureSchema,
  type CreatureCatalog,
} from "../game/src/content/schema/creatures.js";
import { DropSchema, LootTableSchema } from "../game/src/content/schema/loot.js";
import { validateCollection, type ParseContext, type Schema } from "../game/src/content/schema/core.js";

const baselinePath = path.join(repoRoot, ".baseline", "game", "src", "content", "enemies.ts");

const enemyFields = {
  id: "frog_t1",
  name: "Frog",
  family: "frog",
  tier: 1,
  maxHealth: 2,
  attackLevel: 1,
  defenceLevel: 1,
  accuracy: 0,
  armour: 0,
  magicArmour: 0,
  maxHit: 1,
  attackSpeedMs: 1000,
  aggroRadius: 0,
  behaviour: "passive",
  moveSpeedMps: 1.25,
  walkSpeedMps: 0.5,
  marks: [0, 2],
  attackStyle: "melee",
  attackRangeM: 1.5,
  respawnSeconds: 0,
} as const;

const enemy = {
  ...enemyFields,
  drops: [{ itemId: "air_essence", quantity: [1, 2], chance: 0.5, exclusiveGroup: "jewelry" }],
} as const;

const rpgFields = {
  bodyFamily: "rat",
  rigFamily: "corealm_rat",
  movement: "quadruped",
  habitat: "old granary",
  respawnMs: 0,
  nativeSize: [1, 1, 1],
  nativeBase: [-1, 0, 1],
  nativeVisualRadius: 1,
  nativeBodyRadius: 0.5,
  attack: { action: "biting lunge", proposedMechanic: "melee", recoveryMs: 450 },
  source: { author: "Corealm", license: "CC0-1.0", generator: "test" },
  acceptance: "candidate",
} as const;

function issues<T>(schema: Schema<T>, value: unknown): ParseContext["issues"] {
  const ctx: ParseContext = { issues: [] };
  schema.parse(value, "row", ctx);
  return ctx.issues;
}

function expectValid<T>(schema: Schema<T>, value: unknown): void {
  expect(issues(schema, value)).toEqual([]);
}

describe("M4 strict content schemas", () => {
  it("exposes the frozen catalog vocabularies", () => {
    const enemyCatalog: EnemyCatalog = "LEGACY_BLOCKS";
    const creatureCatalog: CreatureCatalog = "CREATURE_EXPANSION";
    expect(enemyCatalog).toBe("LEGACY_BLOCKS");
    expect(creatureCatalog).toBe("CREATURE_EXPANSION");
    expect(ENEMY_CATALOGS).toEqual([
      "LEGACY_BLOCKS", "CREATURE_SPECIES_BLOCKS", "RPG_BESTIARY_BLOCKS",
      "FANTASY_TIER_BLOCKS", "WILDERNESS_BLOCKS", "RPG_BESTIARY_STAGED_BLOCKS",
      "REGIONAL_BOSS_BLOCKS",
    ]);
    expect(ALIAS_CATALOGS).toEqual(["GROUP_ALIASES", "FANTASY_ENCOUNTER_BLOCKS", "WILDERNESS_GROUP_ALIASES"]);
    expect(CREATURE_CATALOGS).toHaveLength(18);
  });

  it("accepts a complete enemy and rejects unknown fields and invalid ranges", () => {
    expectValid(EnemySchema, enemy);
    expectValid(DropSchema, enemy.drops[0]);
    expectValid(EnemySchema, { ...enemy, marks: [0, 0], moveSpeedMps: 0.25, attackRangeM: 0.1 });

    expect(issues(EnemySchema, { ...enemy, typo: true }).some(issue => issue.path === "row.typo")).toBe(true);
    expect(issues(EnemySchema, { ...enemy, marks: [3, 2] }).some(issue => issue.path === "row.marks")).toBe(true);
    expect(issues(EnemySchema, { ...enemy, drops: [{ ...enemy.drops[0], quantity: [2, 1] }] })
      .some(issue => issue.path === "row.drops[0].quantity")).toBe(true);
    expect(issues(EnemySchema, { ...enemy, drops: [{ ...enemy.drops[0], chance: 1.1 }] })
      .some(issue => issue.path === "row.drops[0].chance")).toBe(true);
  });

  it("keeps the registered and lab enemy record branches closed", () => {
    const registered = {
      ...enemyFields,
      lootTableId: "loot_enemy_frog_t1",
      catalog: "LEGACY_BLOCKS",
      stage: "registered",
      registrationOrder: 0,
    } as const;
    const lab = {
      ...enemyFields,
      lootTableId: "loot_enemy_frog_t1",
      catalog: "RPG_BESTIARY_STAGED_BLOCKS",
      stage: "labOnly",
      labOrder: 0,
    } as const;
    expectValid(EnemyRecordSchema, registered);
    expectValid(EnemyRecordSchema, lab);
    expect(issues(EnemyRecordSchema, { ...registered, catalog: "RPG_BESTIARY_STAGED_BLOCKS", stage: "labOnly", labOrder: 0 })
      .some(issue => issue.path === "row.registrationOrder" || issue.path === "row.labOrder")).toBe(true);
    expect(issues(EnemyRecordSchema, { ...lab, registrationOrder: 0 }).some(issue => issue.path === "row.registrationOrder")).toBe(true);
  });

  it("accepts closed aliases and requires fantasy lineage fields", () => {
    const plain = {
      id: "frog_group",
      blockId: "frog_t1",
      registrationOrder: 1,
      overrides: {},
      catalog: "GROUP_ALIASES",
    } as const;
    const fantasy = {
      id: "frog_fantasy_group",
      blockId: "frog_t1",
      registrationOrder: 2,
      overrides: { moveSpeedMps: 0.75 },
      catalog: "FANTASY_ENCOUNTER_BLOCKS",
      speciesId: "frog",
      lineage: ["frog_t1", "frog_t1"],
    } as const;
    expectValid(EnemyAliasSchema, plain);
    expectValid(EnemyAliasSchema, fantasy);
    expectValid(EnemyOverridesSchema, {});
    expect(issues(EnemyAliasSchema, { ...plain, speciesId: "frog" }).some(issue => issue.path === "row.speciesId")).toBe(true);
    expect(issues(EnemyAliasSchema, { ...fantasy, lineage: undefined }).some(issue => issue.path === "row.lineage")).toBe(true);
    expect(issues(EnemyOverridesSchema, { unknown: 1 }).some(issue => issue.path === "row.unknown")).toBe(true);
  });

  it("ties loot IDs to their owner category", () => {
    expectValid(LootTableSchema, {
      id: "loot_enemy_frog_t1", catalog: "ENEMY_BLOCK_LOOT", ownerId: "frog_t1", drops: [],
    });
    expectValid(LootTableSchema, {
      id: "loot_species_frog", catalog: "CREATURE_SOURCE_LOOT", ownerId: "frog", drops: [],
    });
    expectValid(LootTableSchema, {
      id: "loot_alias_frog_group", catalog: "ENEMY_ALIAS_LOOT", ownerId: "frog_group", drops: [],
    });
    expect(issues(LootTableSchema, {
      id: "loot_enemy_frog", catalog: "CREATURE_SOURCE_LOOT", ownerId: "frog", drops: [],
    }).some(issue => issue.path === "row")).toBe(true);
  });

  it("preserves the complete basic and RPG creature branches", () => {
    const basic = {
      id: "frog",
      assetId: "creature_frog",
      scale: 1,
      regionId: "fallowmarch",
      activity: "graze",
      description: "A small marsh frog.",
      stats: enemy,
    } as const;
    const rpg = { ...basic, ...rpgFields } as const;
    expectValid(BasicCreatureSchema, basic);
    expectValid(RpgCreatureSchema, rpg);
    expectValid(CreatureRuntimeSchema, basic);
    expectValid(CreatureRuntimeSchema, rpg);
    expect(issues(CreatureRuntimeSchema, { ...rpg, extra: true }).some(issue => issue.path === "row.extra")).toBe(true);
    expectValid(CreatureRuntimeSchema, { ...rpg, nativeBase: [-1.5, 0, 1.5] });
    expect(issues(CreatureRuntimeSchema, { ...rpg, nativeSize: [0, 1, 1] }).some(issue => issue.path === "row.nativeSize[0]")).toBe(true);
  });

  it("enforces creature stage from the source catalog", () => {
    const basicRecord = {
      id: "frog",
      assetId: "creature_frog",
      scale: 1,
      regionId: "fallowmarch",
      activity: "graze",
      description: "A small marsh frog.",
      blockId: "frog_t1",
      lootTableId: "loot_enemy_frog_t1",
      catalog: "CREATURE_EXPANSION",
      stage: "registered",
      presentationKind: "basic",
    } as const;
    const rpgRecord = {
      id: "giant_rat",
      assetId: "creature_giant_rat",
      scale: 1,
      regionId: "fallowmarch",
      activity: "patrol",
      description: "A giant rat stalks old granaries.",
      blockId: "giant_rat_t3",
      lootTableId: "loot_enemy_giant_rat_t3",
      catalog: "RPG_BESTIARY_STAGED",
      stage: "labOnly",
      presentationKind: "rpg",
      ...rpgFields,
    } as const;
    expectValid(CreatureRecordSchema, basicRecord);
    expectValid(CreatureRecordSchema, rpgRecord);
    expect(issues(CreatureRecordSchema, { ...basicRecord, stage: "labOnly" }).some(issue => issue.path === "row")).toBe(true);
    expect(issues(CreatureRecordSchema, { ...rpgRecord, catalog: "REGIONAL_BOSS_SPECIES", stage: "registered" }).some(issue => issue.path === "row")).toBe(true);
    expect(issues(CreatureRecordSchema, { ...basicRecord, bodyFamily: "rat" }).some(issue => issue.path === "row.bodyFamily")).toBe(true);
  });
});

describe.skipIf(!existsSync(baselinePath))("M4 baseline normalized records", () => {
  let baseline: M4Baseline;

  beforeAll(async () => {
    baseline = await buildM4Baseline();
  });

  it("accepts every normalized baseline loot, enemy, alias and creature record", () => {
    expect(validateCollection(LootTableSchema, baseline.records.lootTables, { name: "lootTables", idKey: "id" }).issues).toEqual([]);
    expect(validateCollection(EnemyRecordSchema, baseline.records.enemies, { name: "enemies", idKey: "id" }).issues).toEqual([]);
    expect(validateCollection(EnemyAliasSchema, baseline.records.aliases, { name: "enemyAliases", idKey: "id" }).issues).toEqual([]);
    expect(validateCollection(CreatureRecordSchema, baseline.records.creatures, { name: "creatures", idKey: "id" }).issues).toEqual([]);
  });
});
