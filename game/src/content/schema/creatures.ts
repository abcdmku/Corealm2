import type { CreatureSpeciesDef } from "../creatureSpecies.js";
import type { RpgBestiaryEntry } from "../rpgBestiary.js";
import { EnemySchema } from "./enemies.js";
import { enumOf, id, int, lit, num, obj, ref, refine, str, tuple, union, type Infer, type Schema } from "./core.js";

const nonempty = () => str({ nonEmpty: true });
const positive = () => num({ exclusiveMin: 0 });
const IdentityMeta = { readOnly: true, identity: true } as const;

const REGION_IDS = [
  "fallowmarch", "vellenwood", "karrowmoor", "kilnhalt", "wilderness",
  "gravelmaw", "crownward", "gloamgarden", "faeholme",
] as const;
const SpeciesFields = {
  id: id(),
  assetId: ref("asset"),
  scale: positive(),
  regionId: enumOf(REGION_IDS, { ref: "region" }),
  activity: enumOf(["graze", "forage", "prowl", "patrol"] as const),
  description: str({ nonEmpty: true }, { multiline: true }),
};
const RpgFields = {
  bodyFamily: enumOf([
    "goblin", "orc", "skeleton", "zombie", "wraith", "golem", "harpy",
    "gargoyle", "gnoll", "lizardman", "minotaur", "demon", "spider", "wasp",
    "forest_creature", "elemental", "roach", "troll", "rat",
  ] as const),
  rigFamily: nonempty(),
  movement: enumOf(["biped", "hover", "arthropod", "flying", "quadruped"] as const),
  habitat: nonempty(),
  respawnMs: int({ min: 0 }, { unit: "ms" }),
  nativeSize: tuple([positive(), positive(), positive()] as const),
  nativeBase: tuple([num(), num(), num()] as const),
  nativeVisualRadius: positive(),
  nativeBodyRadius: positive(),
  attack: obj({
    action: nonempty(),
    proposedMechanic: enumOf(["melee", "projectile", "spell"] as const),
    recoveryMs: int({ min: 0 }, { unit: "ms" }),
  }),
  source: obj({ author: nonempty(), license: nonempty(), generator: nonempty() }),
  acceptance: lit("candidate"),
};
export const BasicCreatureSchema = obj({ ...SpeciesFields, stats: EnemySchema }) satisfies Schema<CreatureSpeciesDef>;
export const RpgCreatureSchema = obj({ ...SpeciesFields, ...RpgFields, stats: EnemySchema }) satisfies Schema<RpgBestiaryEntry>;
export const CreatureRuntimeSchema = union([BasicCreatureSchema, RpgCreatureSchema] as const) satisfies Schema<CreatureSpeciesDef | RpgBestiaryEntry>;

export const CREATURE_CATALOGS = [
  "CREATURE_EXPANSION", "STARTER_CREATURES", "RED_WORM_SPECIES",
  "REGIONAL_CREATURE_VARIANTS", "CREATURE_REDESIGNS",
  "FOREST_CREATURE_REDESIGNS", "ASH_CREATURE_REDESIGNS", "STONE_CREATURE_REDESIGNS",
  "WILDERNESS_DRAGONS", "WILDERNESS_CREATURE_SPECIES", "FAIRY_CROWN_SPECIES",
  "CROWNWARD_DRAGON_SPECIES", "FAIRY_CREATURE_SPECIES", "FAIRY_GARDEN_SPECIES",
  "UNIVERSAL_MINIBOSS_SPECIES", "RPG_BESTIARY", "RPG_BESTIARY_STAGED",
  "REGIONAL_BOSS_SPECIES",
] as const;
export type CreatureCatalog = typeof CREATURE_CATALOGS[number];

const CreatureRecordFields = {
  ...SpeciesFields,
  blockId: ref("enemy", IdentityMeta),
  lootTableId: ref("lootTable"),
  catalog: enumOf(CREATURE_CATALOGS, IdentityMeta),
  stage: enumOf(["registered", "labOnly"] as const, IdentityMeta),
};
const CreatureRecordObjectSchema = union([
  obj({ ...CreatureRecordFields, presentationKind: lit("basic", IdentityMeta) }),
  obj({ ...CreatureRecordFields, ...RpgFields, presentationKind: lit("rpg", IdentityMeta) }),
] as const);
export const CreatureRecordSchema = refine(CreatureRecordObjectSchema, row => {
  const lab = row.catalog === "RPG_BESTIARY_STAGED" || row.catalog === "REGIONAL_BOSS_SPECIES";
  return row.stage === (lab ? "labOnly" : "registered");
}, "stage must match the source catalog");
export type CreatureRecord = Infer<typeof CreatureRecordSchema>;

// Keep the runtime interfaces as the public compatibility targets for callers that use the
// schema's inferred branches directly.
export type BasicCreature = Infer<typeof BasicCreatureSchema>;
export type RpgCreature = Infer<typeof RpgCreatureSchema>;
export type CreatureRuntime = Infer<typeof CreatureRuntimeSchema>;
