import type { CreatureSpeciesDef } from "../creatureSpecies.js";
import type { RpgBestiaryEntry } from "../rpgBestiary.js";
import { EnemySchema } from "./enemies.js";
import { enumOf, id, int, lit, num, obj, ref, str, tuple, union, type Schema } from "./core.js";

const nonempty = () => str({ nonEmpty: true });
const positive = () => num({ exclusiveMin: 0 });

const REGION_IDS = [
  "fallowmarch", "vellenwood", "karrowmoor", "kilnhalt", "wilderness",
  "gravelmaw", "crownward", "gloamgarden", "faeholme",
] as const;
export const SpeciesFields = {
  id: id(),
  assetId: ref("asset"),
  scale: positive(),
  regionId: enumOf(REGION_IDS, { ref: "region" }),
  activity: enumOf(["graze", "forage", "prowl", "patrol"] as const),
  description: str({ nonEmpty: true }, { multiline: true }),
};
export const RpgFields = {
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

