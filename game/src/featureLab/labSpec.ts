import type { FeatureLabMode, FeatureLabStructureSelection } from "../contracts.js";

/**
 * What a lab session is, as plain data: the page derives it from the URL and hands it to the lab
 * worker when the worker starts. The worker reads this instead of the ~50 URL flags that `boot.ts`
 * reads, so everything the simulation does differently in a lab is decided by this one value.
 *
 * The spec says WHICH lab. WHERE things stand comes separately, as `LabWorldData` in
 * `worker/labProtocol.ts`: every lab position is grounded on the drawn terrain lattice, on asset
 * measurements or on renderer-solved contours, so the page assembles the world description and the
 * worker simulates it. The page never simulates.
 *
 * This module imports no content and no renderer, so the worker entry, the page and a unit test can
 * all load it first.
 */
export const LAB_SPEC_VERSION = 1;

export type LabTerrainVariant = "yard" | "slopes" | "cliff";
/** A lab fixture whose controls change the simulation, so the worker hosts its methods. */
export type LabRuntimeFixture = "agility" | "doors" | "progression" | "gameplay" | "regionalTier" | "creatureLoot" | "hunt";

export interface LabFixtureSpec {
  version: typeof LAB_SPEC_VERSION;
  mode: FeatureLabMode;
  /** The store seed. Only the armour loot lab changes it. */
  seed: number;
  terrain: {
    variant: LabTerrainVariant;
    /** The fairy palette of the cliff variant. */
    palette: "gloamgarden" | "faeholme" | null;
    /** `footing=slope`: the slopes variant starts the player on the incline. */
    slopeFooting: boolean;
    /** Flags that reshape the ground before it is tessellated. */
    agilityCourse: boolean;
    basin: "pond" | "crownward" | null;
    river: boolean;
    lava: "shallow" | "deep" | null;
    fairyRealm: boolean;
  };
  /** The authored spawn of the profile. A fixture that moves it says so in the world data. */
  spawn: { regionId: "fallowmarch"; x: number; z: number; facingRad: number };
  /** The structure the lab opens with, and the architecture its kit is dressed as. */
  structure: { selection: Partial<FeatureLabStructureSelection>; architecture: "gloamgarden" | "faeholme" | null };
  /** The creature the combat lab opens with. Null takes the first of the catalog, and the building lab spawns none. */
  creature: string | null;
  /** What the lab's one character starts with. */
  character: {
    /** Every skill at 99, so a session can exercise the whole content ladder. */
    maxSkills: true;
    /** The bank fixture: three stacks banked, two carried, essence and the Air Orb. */
    bankFixture: true;
    /** A pickaxe and hatchet for the presentation fixture's tree and ore. */
    presentationTools: boolean;
    /** The forest lab's hatchet. */
    forestHatchet: boolean;
  };
  /** World content the page assembles and ships as entities. Listed so a session can be read back from its spec. */
  content: {
    doors: boolean; denseCave: boolean; cave: boolean; portal: boolean; shop: boolean; hunt: boolean;
    spawnSpacing: { population: "legacy" | "worms" | "fairy" | "stone" } | null;
    groundMotion: "current" | "legacy" | null;
    pack: { id: string; rpg: boolean } | null;
    forest: boolean; presentation: boolean; environment: boolean; creatures: boolean; spells: boolean;
  };
  /** Fixtures whose window surface mutates the simulation. The worker hosts their methods behind `lab.call`. */
  runtime: LabRuntimeFixture[];
  /** `regionalTier=30|40|60`. */
  regionalTier: 30 | 40 | 60 | null;
  /**
   * How far from the player the worker replicates entities. The old lab page held its whole yard, and
   * tools read creatures a hundred metres off, so a lab replicates the yard rather than the 48 m of a
   * played world.
   */
  interestRadius: number;
}

export const LAB_INTEREST_RADIUS = 400;
const LAB_SPAWN = { regionId: "fallowmarch", x: 0, z: 0, facingRad: 0 } as const;
const DEFAULT_SEED = 1337;

/** The lab a URL asks for. Null when the URL asks for the game. */
export function labFixtureSpec(search: string | URLSearchParams): LabFixtureSpec | null {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const mode = params.get("mode");
  if (mode !== "combat" && mode !== "building") return null;
  const on = (flag: string): boolean => params.get(flag) === "1";
  const terrainFlag = params.get("terrain");
  const variant: LabTerrainVariant = terrainFlag === "cliff" ? "cliff" : terrainFlag === "slopes" ? "slopes" : "yard";
  const slopeFooting = variant === "slopes" && params.get("footing") === "slope";
  const crownward = params.get("fishing") === "crownward";
  const fishing = on("fishing") || crownward;
  const denseCave = on("denseCave");
  const portal = on("portal");
  const wilderness = params.get("wildernessEffects");
  const seedText = on("fabArmor") ? params.get("fabLootSeed") : null;
  const seed = seedText !== null && /^\d+$/.test(seedText) ? Number(seedText) : DEFAULT_SEED;

  const selection: Partial<FeatureLabStructureSelection> = {};
  const kind = params.get("kind");
  if (kind === "prefab" || kind === "composition" || kind === "wall-run") selection.kind = kind;
  const id = params.get("id");
  if (id) selection.id = id;
  const kit = params.get("kit");
  if (kit === "plaster" || kit === "timber" || kit === "stone") selection.kit = kit;
  for (const key of ["width", "depth", "seed"] as const) { const value = params.get(key); if (value !== null) selection[key] = Number(value); }
  const architecture = params.get("architecture");

  const population = params.get("population");
  const motion = params.get("motion");
  const pack = params.get("pack");
  const tier = params.get("regionalTier");
  const combat = mode === "combat";
  const runtime: LabRuntimeFixture[] = [];
  if (on("agility")) runtime.push("agility");
  if (on("doors") || denseCave) runtime.push("doors");
  if (on("progression")) runtime.push("progression");
  if (on("gameplay")) runtime.push("gameplay");
  if (combat && (tier === "30" || tier === "40" || tier === "60")) runtime.push("regionalTier");
  if (combat && on("creatureLoot")) runtime.push("creatureLoot");
  if (on("hunt")) runtime.push("hunt");

  return {
    version: LAB_SPEC_VERSION, mode, seed,
    terrain: {
      variant, palette: variant === "cliff" ? (params.get("palette") === "faeholme" ? "faeholme" : "gloamgarden") : null, slopeFooting,
      agilityCourse: on("agility"), basin: crownward ? "crownward" : fishing ? "pond" : null, river: on("river") || crownward,
      lava: wilderness === "deep" ? "deep" : wilderness === "1" ? "shallow" : null, fairyRealm: on("fairy"),
    },
    spawn: slopeFooting ? { ...LAB_SPAWN, x: 30, z: -99 } : { ...LAB_SPAWN },
    structure: { selection, architecture: architecture === "gloamgarden" || architecture === "faeholme" ? architecture : null },
    creature: combat ? params.get("creature") : null,
    character: { maxSkills: true, bankFixture: true, presentationTools: on("presentation"), forestHatchet: on("forest") },
    content: {
      doors: on("doors") || denseCave, denseCave, cave: on("cave") || portal, portal, shop: on("shop"), hunt: on("hunt"),
      spawnSpacing: on("spawnSpacing") ? { population: population === "worms" || population === "fairy" || population === "stone" ? population : "legacy" } : null,
      groundMotion: motion === "1" ? "current" : motion === "legacy" ? "legacy" : null,
      pack: pack ? { id: pack, rpg: on("rpg") } : null,
      forest: on("forest"), presentation: on("presentation"), environment: on("environment"), creatures: on("creatures"), spells: combat && on("spells"),
    },
    runtime,
    regionalTier: combat && (tier === "30" || tier === "40" || tier === "60") ? Number(tier) as 30 | 40 | 60 : null,
    interestRadius: LAB_INTEREST_RADIUS,
  };
}

/** Shape only, at the worker boundary. The worker trusts nothing the page posts. */
export function parseLabFixtureSpec(value: unknown): LabFixtureSpec {
  const bad = (message: string): never => { throw new Error(`Invalid lab fixture spec: ${message}`); };
  const record = (input: unknown): input is Record<string, unknown> => typeof input === "object" && input !== null && !Array.isArray(input);
  if (!record(value) || value.version !== LAB_SPEC_VERSION) return bad(`version must be ${LAB_SPEC_VERSION}`);
  if (value.mode !== "combat" && value.mode !== "building") bad("mode must be combat or building");
  if (!Number.isSafeInteger(value.seed) || (value.seed as number) < 0 || (value.seed as number) > 0xffffffff) bad("seed must be a 32-bit unsigned integer");
  for (const key of ["terrain", "spawn", "structure", "character", "content"]) if (!record(value[key])) bad(`${key} must be an object`);
  const spawn = value.spawn as Record<string, unknown>;
  if (spawn.regionId !== "fallowmarch" || ![spawn.x, spawn.z, spawn.facingRad].every(n => typeof n === "number" && Number.isFinite(n))) bad("spawn must be {regionId, x, z, facingRad}");
  const known: readonly string[] = ["agility", "doors", "progression", "gameplay", "regionalTier", "creatureLoot", "hunt"];
  if (!Array.isArray(value.runtime) || !value.runtime.every(name => typeof name === "string" && known.includes(name))) bad(`runtime must list fixtures among ${known.join(", ")}`);
  if (value.regionalTier !== null && ![30, 40, 60].includes(value.regionalTier as number)) bad("regionalTier must be 30, 40, 60 or null");
  if (typeof value.interestRadius !== "number" || !(value.interestRadius >= 16 && value.interestRadius <= 2048)) bad("interestRadius must be 16 to 2048 metres");
  if (value.creature !== null && (typeof value.creature !== "string" || value.creature.length > 128)) bad("creature must be a preset id or null");
  return value as unknown as LabFixtureSpec;
}
