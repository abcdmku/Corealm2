/**
 * Every production recipe: smelting, smithing, cooking, crafting and fletching at tiers 1, 5 and 10.
 *
 * Owned by W-CONTENT.
 *
 * XP is NEVER a literal in this file. Every row calls `recipeXp(tier, craftWeight)` from
 * `content/index.ts`, with the weight taken straight out of the PRD 2.7 table below. That table is
 * the only place a number is typed by hand, and the PRD's worked examples check it:
 *
 *   gatherXp(1) = 10, gatherXp(5) = 24, gatherXp(10) = 35
 *   Grithe bar   = recipeXp(1,  0.8) = round(10 * 0.8) =   8   (PRD 2.7)
 *   Grithe sword = recipeXp(1,  3.5) = round(10 * 3.5) =  35   (PRD 2.7)
 *   Kaldite bar  = recipeXp(10, 0.8) = round(35 * 0.8) =  28   (PRD 2.7)
 *   Kaldite body = recipeXp(10, 5.0) = round(35 * 5.0) = 175   (PRD 2.7)
 *
 * Three weights in the PRD's table do not name every piece we author, so they are reused with the
 * mapping written down here rather than invented per row:
 *   - magic hood / boots / wraps  -> 2.5, the "Helm, boots, gloves" weight
 *   - magic leggings              -> 4.0, the "Leather body" weight (same hide count class)
 *   - elemental weapon upgrade   -> the matching base weapon weight
 *
 * `reqLevel` equals the tier at every step. The PRD authors content at tiers 1, 5 and 10 and never
 * asks for an intra-tier stagger, so a flat mapping is the one that cannot surprise a test.
 *
 * Stations come from `content/regions.ts`. Elemental weapon upgrades use only the awakened altar
 * at their matching Essence Cache; the regional boss Orb is the one-time altar key, not a recipe
 * ingredient. Ordinary crafting remains tied to crafting tables.
 */
import type { ItemId } from "../contracts.js";
import type { GatheringProductionTierDef, RecipeDef } from "./index.js";
import { recipeXp } from "./index.js";
import { CREATURE_LOOT_RECIPES } from "./creatureLoot.js";
import { WILDERNESS_LOOT_RECIPES } from './wildernessLoot.js';
import { GATHERING_PRODUCTION_TIERS } from "./gatheringProductionTiers.js";
import { ALL_ITEMS } from "./items.js";

// ------------------------------------------------------------------- PRD 2.7 craft weights

/** craftWeight and duration, verbatim from the PRD 2.7 table. */
const W = {
  smeltBar: { weight: 0.8, ms: 2400 },
  dagger: { weight: 2.0, ms: 3000 },
  sword: { weight: 3.5, ms: 3000 },
  bodyOrLegs: { weight: 5.0, ms: 3000 },
  helmBootsGloves: { weight: 2.5, ms: 3000 },
  toolHead: { weight: 2.2, ms: 3000 },
  cookedFood: { weight: 1.5, ms: 2400 },
  amuletOrRing: { weight: 3.0, ms: 2400 },
  leatherBody: { weight: 4.0, ms: 2400 },
  staff: { weight: 3.2, ms: 1800 },
  wand: { weight: 2.4, ms: 1800 },
  toolHandle: { weight: 1.0, ms: 1800 },
  fishingRod: { weight: 1.8, ms: 1800 },
  woodenShield: { weight: 2.8, ms: 1800 },
} as const;

/** Reused weights, spelled out so the mapping is auditable. */
const W_HIDE_SMALL = W.helmBootsGloves;   // hood, magic boots, wraps: 2.5 at 2.4 s (crafting)
const W_HIDE_LEGS = W.leatherBody;        // magic leggings: 4.0

// ------------------------------------------------------------------------------- row builder

interface Weight { readonly weight: number; readonly ms: number }

interface RowSpec {
  id: string;
  name: string;
  kind: RecipeDef["kind"];
  stations: RecipeDef["stations"];
  weight: Weight;
  inputs: { itemId: ItemId; quantity: number }[];
  output: { itemId: ItemId; quantity: number };
  burntItemId?: ItemId;
}

const SKILL_FOR_KIND: Readonly<Record<RecipeDef["kind"], RecipeDef["skill"]>> = {
  smelt: "smithing",
  smith: "smithing",
  cook: "cooking",
  craft: "crafting",
  fletch: "fletching",
};

function row(tier: number, spec: RowSpec): RecipeDef {
  const base: RecipeDef = {
    id: spec.id,
    name: spec.name,
    kind: spec.kind,
    skill: SKILL_FOR_KIND[spec.kind],
    reqLevel: tier,
    tier,
    stations: spec.stations,
    inputs: spec.inputs,
    output: spec.output,
    durationMs: spec.weight.ms,
    xp: recipeXp(tier, spec.weight.weight),
  };
  return spec.burntItemId === undefined ? base : { ...base, burntItemId: spec.burntItemId };
}

function recipesForTier(definition: GatheringProductionTierDef): RecipeDef[] {
  const t = definition.tier;
  const m = definition.items;
  const q = (itemId: ItemId, quantity: number): { itemId: ItemId; quantity: number } =>
    ({ itemId, quantity });

  return [
    // ------------------------------------------------------------------ smelting (furnace)
    row(t, {
      id: `smelt_${m.bar}`, name: `${definition.metalName} Bar`, kind: "smelt", stations: ["furnace"],
      weight: W.smeltBar,
      inputs: [q(m.ore, definition.smelting.orePerBar), q(m.flux, definition.smelting.fluxPerBar)],
      output: q(m.bar, 1),
    }),

    // ------------------------------------------------------------------ smithing (anvil)
    row(t, {
      id: `smith_${m.dagger}`, name: `${definition.metalName} Dagger`, kind: "smith", stations: ["anvil"],
      weight: W.dagger, inputs: [q(m.bar, 1), q(m.handle, 1)], output: q(m.dagger, 1),
    }),
    row(t, {
      id: `smith_${m.sword}`, name: `${definition.metalName} Sword`, kind: "smith", stations: ["anvil"],
      weight: W.sword, inputs: [q(m.bar, 2), q(m.handle, 1)], output: q(m.sword, 1),
    }),
    row(t, {
      id: `smith_${m.helm}`, name: `${definition.metalName} Helm`, kind: "smith", stations: ["anvil"],
      weight: W.helmBootsGloves, inputs: [q(m.bar, 2)], output: q(m.helm, 1),
    }),
    row(t, {
      id: `smith_${m.body}`, name: `${definition.metalName} Body`, kind: "smith", stations: ["anvil"],
      weight: W.bodyOrLegs, inputs: [q(m.bar, 3)], output: q(m.body, 1),
    }),
    row(t, {
      id: `smith_${m.legs}`, name: `${definition.metalName} Legs`, kind: "smith", stations: ["anvil"],
      weight: W.bodyOrLegs, inputs: [q(m.bar, 3)], output: q(m.legs, 1),
    }),
    row(t, {
      id: `smith_${m.boots}`, name: `${definition.metalName} Boots`, kind: "smith", stations: ["anvil"],
      weight: W.helmBootsGloves, inputs: [q(m.bar, 1)], output: q(m.boots, 1),
    }),
    row(t, {
      id: `smith_${m.gloves}`, name: `${definition.metalName} Gloves`, kind: "smith", stations: ["anvil"],
      weight: W.helmBootsGloves, inputs: [q(m.bar, 1)], output: q(m.gloves, 1),
    }),
    row(t, {
      id: `smith_${m.pickaxe}`, name: `${definition.metalName} Pickaxe`, kind: "smith", stations: ["anvil"],
      weight: W.toolHead, inputs: [q(m.bar, 2), q(m.handle, 1)], output: q(m.pickaxe, 1),
    }),
    row(t, {
      id: `smith_${m.hatchet}`, name: `${definition.metalName} Hatchet`, kind: "smith", stations: ["anvil"],
      weight: W.toolHead, inputs: [q(m.bar, 2), q(m.handle, 1)], output: q(m.hatchet, 1),
    }),

    // ------------------------------------------------------------------ cooking (range)
    row(t, {
      id: `cook_${m.cookedFish}`, name: nameOf(m.cookedFish), kind: "cook", stations: ["range", "campfire"],
      weight: W.cookedFood, inputs: [q(m.rawFish, 1)], output: q(m.cookedFish, 1),
      burntItemId: m.burntFish,
    }),
    row(t, {
      // The hunting half of Cooking. Identical weight, duration and stations to the fish row on
      // purpose: both are one raw ingredient over a fire, and a kill should not be a faster way
      // to level the skill than a fishing spot.
      id: `cook_${m.cookedMeat}`, name: nameOf(m.cookedMeat), kind: "cook", stations: ["range", "campfire"],
      weight: W.cookedFood, inputs: [q(m.rawMeat, 1)], output: q(m.cookedMeat, 1),
      burntItemId: m.burntMeat,
    }),

    // --------------------------------------------------------- elemental crafting (awakened altar)
    row(t, {
      id: `craft_${definition.magic.wand}`, name: nameOf(definition.magic.wand),
      kind: "craft", stations: ["essence_altar"], weight: W.wand,
      inputs: [q(m.wand, 1)], output: q(definition.magic.wand, 1),
    }),
    row(t, {
      id: `craft_${definition.magic.staff}`, name: nameOf(definition.magic.staff),
      kind: "craft", stations: ["essence_altar"], weight: W.staff,
      inputs: [q(m.staff, 1)], output: q(definition.magic.staff, 1),
    }),

    // ------------------------------------------------------------------ crafting (table)
    row(t, {
      id: `craft_${m.meleeRing}`, name: nameOf(m.meleeRing), kind: "craft", stations: ["crafting_table"],
      weight: W.amuletOrRing, inputs: [q(m.bar, 1), q(m.gem, 1)], output: q(m.meleeRing, 1),
    }),
    row(t, {
      id: `craft_${m.meleePendant}`, name: nameOf(m.meleePendant), kind: "craft", stations: ["crafting_table"],
      weight: W.amuletOrRing, inputs: [q(m.bar, 1), q(m.gem, 1)], output: q(m.meleePendant, 1),
    }),
    row(t, {
      id: `craft_${m.magicRing}`, name: nameOf(m.magicRing), kind: "craft", stations: ["crafting_table"],
      weight: W.amuletOrRing, inputs: [q(m.bar, 1), q(m.gem, 2)], output: q(m.magicRing, 1),
    }),
    row(t, {
      id: `craft_${m.magicCharm}`, name: nameOf(m.magicCharm), kind: "craft", stations: ["crafting_table"],
      weight: W.amuletOrRing, inputs: [q(m.gem, 2)], output: q(m.magicCharm, 1),
    }),
    row(t, {
      id: `craft_${m.robe}`, name: nameOf(m.robe), kind: "craft", stations: ["crafting_table"],
      weight: W.leatherBody, inputs: [q(m.hide, 3)], output: q(m.robe, 1),
    }),
    row(t, {
      id: `craft_${m.magicLegs}`, name: nameOf(m.magicLegs), kind: "craft", stations: ["crafting_table"],
      weight: W_HIDE_LEGS, inputs: [q(m.hide, 2)], output: q(m.magicLegs, 1),
    }),
    row(t, {
      id: `craft_${m.hood}`, name: nameOf(m.hood), kind: "craft", stations: ["crafting_table"],
      weight: W_HIDE_SMALL, inputs: [q(m.hide, 1)], output: q(m.hood, 1),
    }),
    row(t, {
      id: `craft_${m.magicBoots}`, name: nameOf(m.magicBoots), kind: "craft", stations: ["crafting_table"],
      weight: W_HIDE_SMALL, inputs: [q(m.hide, 1)], output: q(m.magicBoots, 1),
    }),
    row(t, {
      id: `craft_${m.wraps}`, name: nameOf(m.wraps), kind: "craft", stations: ["crafting_table"],
      weight: W_HIDE_SMALL, inputs: [q(m.hide, 1)], output: q(m.wraps, 1),
    }),

    // ------------------------------------------------------------------ fletching (bench)
    row(t, {
      id: `fletch_${m.shaft}`, name: `${definition.woodName} Shafts`, kind: "fletch", stations: ["fletching_bench"],
      weight: W.toolHandle, inputs: [q(m.log, 1)], output: q(m.shaft, 4),
    }),
    row(t, {
      id: `fletch_${m.handle}`, name: `${definition.woodName} Handles`, kind: "fletch", stations: ["fletching_bench"],
      weight: W.toolHandle, inputs: [q(m.log, 1)], output: q(m.handle, 2),
    }),
    row(t, {
      id: `fletch_${m.staff}`, name: nameOf(m.staff), kind: "fletch", stations: ["fletching_bench"],
      weight: W.staff, inputs: [q(m.shaft, 3)], output: q(m.staff, 1),
    }),
    row(t, {
      id: `fletch_${m.wand}`, name: nameOf(m.wand), kind: "fletch", stations: ["fletching_bench"],
      weight: W.wand, inputs: [q(m.shaft, 2)], output: q(m.wand, 1),
    }),
    row(t, {
      id: `fletch_${m.shield}`, name: nameOf(m.shield), kind: "fletch", stations: ["fletching_bench"],
      weight: W.woodenShield, inputs: [q(m.log, 2), q(m.bar, 1)], output: q(m.shield, 1),
    }),
    row(t, {
      id: `fletch_${m.rod}`, name: nameOf(m.rod), kind: "fletch", stations: ["fletching_bench"],
      weight: W.fishingRod, inputs: [q(m.shaft, 2), q(m.hide, 1)], output: q(m.rod, 1),
    }),
  ];
}

const itemNames = new Map(ALL_ITEMS.map((item) => [item.id, item.name]));

/** Recipes use the item's display name while their saved output IDs remain unchanged. */
function nameOf(itemId: ItemId): string {
  const name = itemNames.get(itemId);
  if (!name) throw new Error(`Recipe references an item without a display name: ${itemId}`);
  return name;
}

function basicMagicRecipes(definition: GatheringProductionTierDef): RecipeDef[] {
  const basicWand = definition.magic.basicWand;
  const basicStaff = definition.magic.basicStaff;
  if (!basicWand || !basicStaff) return [];
  const q = (itemId: ItemId, quantity: number): { itemId: ItemId; quantity: number } =>
    ({ itemId, quantity });
  return [
    row(definition.tier, {
      id: `fletch_${basicWand}`, name: nameOf(basicWand), kind: "fletch",
      stations: ["fletching_bench"], weight: W.wand,
      inputs: [q(definition.items.shaft, 1)], output: q(basicWand, 1),
    }),
    row(definition.tier, {
      id: `fletch_${basicStaff}`, name: nameOf(basicStaff), kind: "fletch",
      stations: ["fletching_bench"], weight: W.staff,
      inputs: [q(definition.items.shaft, 2)], output: q(basicStaff, 1),
    }),
  ];
}

/** Canonical production matrix plus the two replaceable starter-weapon recipes. */
export const RECIPES: readonly RecipeDef[] = [...GATHERING_PRODUCTION_TIERS.flatMap((definition) => [
  ...recipesForTier(definition),
  ...basicMagicRecipes(definition),
]), ...CREATURE_LOOT_RECIPES, ...WILDERNESS_LOOT_RECIPES];
