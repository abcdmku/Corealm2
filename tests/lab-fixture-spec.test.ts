import { describe, expect, it } from "vitest";
import { labFixtureSpec, parseLabFixtureSpec } from "../game/src/featureLab/labSpec.js";

const quietContent = {
  doors: false, denseCave: false, cave: false, portal: false, shop: false, hunt: false, spawnSpacing: null, groundMotion: null, pack: null,
  forest: false, presentation: false, environment: false, creatures: false, spells: false,
};
const yard = { variant: "yard", palette: null, slopeFooting: false, agilityCourse: false, basin: null, river: false, lava: null, fairyRealm: false };
const character = { maxSkills: true, bankFixture: true, presentationTools: false, forestHatchet: false };

describe("labFixtureSpec", () => {
  it("answers null for a URL that asks for the game", () => {
    expect(labFixtureSpec("")).toBeNull();
    expect(labFixtureSpec("?play=local")).toBeNull();
    expect(labFixtureSpec("?mode=world&creatures=1")).toBeNull();
  });

  it("describes the bare combat lab", () => {
    expect(labFixtureSpec("?mode=combat")).toEqual({
      version: 1, mode: "combat", seed: 1337, terrain: yard,
      spawn: { regionId: "fallowmarch", x: 0, z: 0, facingRad: 0 },
      structure: { selection: {}, architecture: null }, creature: null, character, content: quietContent,
      runtime: [], regionalTier: null, rhinoTiming: false, interestRadius: 400,
    });
  });

  it("describes the building lab with a structure from the URL, and gives it no creature", () => {
    expect(labFixtureSpec("?mode=building&kind=wall-run&id=palisade&kit=stone&width=9&depth=3&seed=7&architecture=faeholme&creature=wolf")).toEqual({
      version: 1, mode: "building", seed: 1337, terrain: yard,
      spawn: { regionId: "fallowmarch", x: 0, z: 0, facingRad: 0 },
      structure: { selection: { kind: "wall-run", id: "palisade", kit: "stone", width: 9, depth: 3, seed: 7 }, architecture: "faeholme" },
      creature: null, character, content: quietContent, runtime: [], regionalTier: null, rhinoTiming: false, interestRadius: 400,
    });
  });

  it("reads each terrain variant", () => {
    expect(labFixtureSpec("?mode=combat&terrain=slopes")!.terrain).toEqual({ ...yard, variant: "slopes" });
    expect(labFixtureSpec("?mode=combat&terrain=slopes")!.spawn).toEqual({ regionId: "fallowmarch", x: 0, z: 0, facingRad: 0 });
    expect(labFixtureSpec("?mode=combat&terrain=slopes&footing=slope")!.terrain).toEqual({ ...yard, variant: "slopes", slopeFooting: true });
    expect(labFixtureSpec("?mode=combat&terrain=slopes&footing=slope")!.spawn).toEqual({ regionId: "fallowmarch", x: 30, z: -99, facingRad: 0 });
    expect(labFixtureSpec("?mode=combat&terrain=cliff")!.terrain).toEqual({ ...yard, variant: "cliff", palette: "gloamgarden" });
    expect(labFixtureSpec("?mode=building&terrain=cliff&palette=faeholme")!.terrain).toEqual({ ...yard, variant: "cliff", palette: "faeholme" });
    // A footing without the slopes moves nothing.
    expect(labFixtureSpec("?mode=combat&footing=slope")!.spawn).toEqual({ regionId: "fallowmarch", x: 0, z: 0, facingRad: 0 });
  });

  it("reads the flags that reshape the ground", () => {
    expect(labFixtureSpec("?mode=combat&fishing=1")!.terrain).toEqual({ ...yard, basin: "pond" });
    expect(labFixtureSpec("?mode=combat&fishing=crownward")!.terrain).toEqual({ ...yard, basin: "crownward", river: true });
    expect(labFixtureSpec("?mode=building&river=1")!.terrain).toEqual({ ...yard, river: true });
    expect(labFixtureSpec("?mode=combat&wildernessEffects=1")!.terrain).toEqual({ ...yard, lava: "shallow" });
    expect(labFixtureSpec("?mode=combat&wildernessEffects=deep")!.terrain).toEqual({ ...yard, lava: "deep" });
    expect(labFixtureSpec("?mode=combat&fairy=1")!.terrain).toEqual({ ...yard, fairyRealm: true });
    expect(labFixtureSpec("?mode=combat&agility=1")!.terrain).toEqual({ ...yard, agilityCourse: true });
  });

  it("lists the content each mode asks the page to assemble", () => {
    expect(labFixtureSpec("?mode=combat&doors=1")!.content).toEqual({ ...quietContent, doors: true });
    expect(labFixtureSpec("?mode=combat&denseCave=1")!.content).toEqual({ ...quietContent, doors: true, denseCave: true });
    expect(labFixtureSpec("?mode=combat&cave=1")!.content).toEqual({ ...quietContent, cave: true });
    expect(labFixtureSpec("?mode=combat&portal=1")!.content).toEqual({ ...quietContent, cave: true, portal: true });
    expect(labFixtureSpec("?mode=combat&shop=1")!.content).toEqual({ ...quietContent, shop: true });
    expect(labFixtureSpec("?mode=combat&hunt=1")!.content).toEqual({ ...quietContent, hunt: true });
    expect(labFixtureSpec("?mode=combat&spawnSpacing=1")!.content).toEqual({ ...quietContent, spawnSpacing: { population: "legacy" } });
    expect(labFixtureSpec("?mode=combat&spawnSpacing=1&population=worms")!.content).toEqual({ ...quietContent, spawnSpacing: { population: "worms" } });
    expect(labFixtureSpec("?mode=combat&motion=1")!.content).toEqual({ ...quietContent, groundMotion: "current" });
    expect(labFixtureSpec("?mode=combat&motion=legacy")!.content).toEqual({ ...quietContent, groundMotion: "legacy" });
    expect(labFixtureSpec("?mode=combat&pack=ash_marsh&rpg=1")!.content).toEqual({ ...quietContent, pack: { id: "ash_marsh", rpg: true } });
    expect(labFixtureSpec("?mode=combat&environment=1")!.content).toEqual({ ...quietContent, environment: true });
    expect(labFixtureSpec("?mode=combat&creatures=1")!.content).toEqual({ ...quietContent, creatures: true });
    expect(labFixtureSpec("?mode=combat&spells=1")!.content).toEqual({ ...quietContent, spells: true });
    // The spell range is a combat fixture.
    expect(labFixtureSpec("?mode=building&spells=1")!.content).toEqual(quietContent);
  });

  it("gives the character what a fixture needs", () => {
    expect(labFixtureSpec("?mode=combat&forest=1")!.character).toEqual({ ...character, forestHatchet: true });
    expect(labFixtureSpec("?mode=combat&forest=1")!.content).toEqual({ ...quietContent, forest: true });
    expect(labFixtureSpec("?mode=combat&presentation=1")!.character).toEqual({ ...character, presentationTools: true });
  });

  it("names the fixtures the worker hosts", () => {
    expect(labFixtureSpec("?mode=combat&agility=1")!.runtime).toEqual(["agility"]);
    expect(labFixtureSpec("?mode=combat&doors=1")!.runtime).toEqual(["doors"]);
    expect(labFixtureSpec("?mode=combat&denseCave=1")!.runtime).toEqual(["doors"]);
    expect(labFixtureSpec("?mode=combat&progression=1")!.runtime).toEqual(["progression"]);
    expect(labFixtureSpec("?mode=combat&gameplay=1")!.runtime).toEqual(["gameplay"]);
    expect(labFixtureSpec("?mode=combat&creatureLoot=1")!.runtime).toEqual(["creatureLoot"]);
    expect(labFixtureSpec("?mode=combat&hunt=1")!.runtime).toEqual(["hunt"]);
    expect(labFixtureSpec("?mode=combat&regionalTier=40")!.runtime).toEqual(["regionalTier"]);
    expect(labFixtureSpec("?mode=combat&regionalTier=40")!.regionalTier).toBe(40);
    // Neither is a building fixture, and 50 is not a tier.
    expect(labFixtureSpec("?mode=building&regionalTier=40&creatureLoot=1")!.runtime).toEqual([]);
    expect(labFixtureSpec("?mode=combat&regionalTier=50")!.regionalTier).toBeNull();
    expect(labFixtureSpec("?mode=combat&agility=1&progression=1&gameplay=1&creatureLoot=1")!.runtime).toEqual(["agility", "progression", "gameplay", "creatureLoot"]);
  });

  it("reads the opening creature, the armour loot seed and the rhino timing review", () => {
    expect(labFixtureSpec("?mode=combat&creature=wolf")!.creature).toBe("wolf");
    expect(labFixtureSpec("?mode=combat&fabArmor=1&fabLootSeed=42")!.seed).toBe(42);
    // The seed belongs to the armour lab, and only digits are a seed.
    expect(labFixtureSpec("?mode=combat&fabLootSeed=42")!.seed).toBe(1337);
    expect(labFixtureSpec("?mode=combat&fabArmor=1&fabLootSeed=4x")!.seed).toBe(1337);
    expect(labFixtureSpec("?mode=combat&rhinoTiming=1")!.rhinoTiming).toBe(true);
  });
});

describe("parseLabFixtureSpec", () => {
  it("accepts what labFixtureSpec writes, after a structured clone", () => {
    const spec = labFixtureSpec("?mode=combat&agility=1&regionalTier=60&creature=wolf")!;
    expect(parseLabFixtureSpec(structuredClone(spec))).toEqual(spec);
  });

  it("refuses a spec the worker could not run", () => {
    const spec = labFixtureSpec("?mode=combat")!;
    expect(() => parseLabFixtureSpec(null)).toThrow("Invalid lab fixture spec: version must be 1");
    expect(() => parseLabFixtureSpec({ ...spec, version: 2 })).toThrow("version must be 1");
    expect(() => parseLabFixtureSpec({ ...spec, mode: "world" })).toThrow("mode must be combat or building");
    expect(() => parseLabFixtureSpec({ ...spec, seed: -1 })).toThrow("seed must be a 32-bit unsigned integer");
    expect(() => parseLabFixtureSpec({ ...spec, spawn: { ...spec.spawn, x: Number.NaN } })).toThrow("spawn must be {regionId, x, z, facingRad}");
    expect(() => parseLabFixtureSpec({ ...spec, runtime: ["shell"] })).toThrow("runtime must list fixtures among");
    expect(() => parseLabFixtureSpec({ ...spec, regionalTier: 50 })).toThrow("regionalTier must be 30, 40, 60 or null");
    expect(() => parseLabFixtureSpec({ ...spec, interestRadius: 1e9 })).toThrow("interestRadius must be 16 to 2048 metres");
  });
});
