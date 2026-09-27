import type { CreatureSpeciesDef } from "../creatureSpecies.js";
import type { RpgBestiaryEntry } from "../rpgBestiary.js";
import { EnemySchema } from "./enemies.js";
import { arr, enumOf, id, int, lit, num, obj, opt, ref, refine, str, tuple, union, type Schema } from "./core.js";

const nonempty = () => str({ nonEmpty: true });
const positive = () => num({ exclusiveMin: 0 });

const REGION_IDS = [
  "fallowmarch", "vellenwood", "karrowmoor", "kilnhalt", "wilderness",
  "gravelmaw", "crownward", "gloamgarden", "faeholme",
] as const;
const positiveRange = (label: string, help: string) => refine(tuple([positive(), positive()] as const), ([min, max]) => min <= max, "min must be <= max")
  .describe({ label, help, group: "variation" });

/**
 * How individuals of one definition differ from each other, so a herd is not twenty copies.
 * Each individual rolls once from its entity id (`content/creatureVariation.ts`); the world layer
 * writes the result into `entity.view` and the renderer only draws it.
 */
export const CreatureVariationSchema = obj({
  scale: opt(positiveRange("Size range", "Multiplier on the definition's scale, min to max.")),
  hue: opt(num({ min: 0, max: 180 }, { label: "Hue spread", unit: "deg", help: "Each individual shifts hue by up to this many degrees either way.", group: "variation" })),
  saturation: opt(positiveRange("Saturation range", "Multiplier on colour saturation, min to max.")),
  value: opt(positiveRange("Brightness range", "Multiplier on brightness, min to max.")),
  /** Other skins individuals may wear. The definition's own look keeps `baseWeight`. */
  skins: opt(arr(obj({ skinId: ref("creatureSkin", { label: "Skin", role: "Worn by" }), weight: num({ exclusiveMin: 0 }, { label: "Weight" }) })), { label: "Skins", role: "Mixed into", weight: "weight", group: "variation" }),
  baseWeight: opt(num({ min: 0 }, { label: "Own look weight", help: "Weight of the definition's own look among its skins. Default 1.", group: "variation" })),
});

export const SpeciesFields = {
  id: id(),
  assetId: ref("asset", { label: "Model", role: "Model for" }),
  scale: positive().describe({ label: "Scale", group: "presentation" }),
  regionId: enumOf(REGION_IDS, { ref: "region", label: "Region", role: "Found in" }),
  activity: enumOf(["graze", "forage", "prowl", "patrol"] as const, { label: "Activity" }),
  description: str({ nonEmpty: true }, { multiline: true, label: "Description" }),
  /** The look this definition wears instead of the model's own maps. */
  skinId: opt(ref("creatureSkin", { label: "Skin", role: "Look of" })),
  variation: opt(CreatureVariationSchema, { label: "Individual variation" }),
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

