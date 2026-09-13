import { TREE_SPECIES, treeResource } from "./treeSpecies.js";
/**
 * Canonical gathering and production unlocks for the current regions.
 *
 * A later region adds one row here. The row owns its items, complete gatherable definitions,
 * resource presentation, asset references, smelting ratios, and portable-fire fuel. Systems and
 * generated docs consume the same shape, so extending the ladder does not add tier branches.
 */
import type { ItemId } from "../contracts.js";
import type {
  CampfireFuelDef, GatheringProductionTierDef, ResourceDef,
} from "./index.js";
import { gatherXp } from "./index.js";

const CAMPFIRE_BUILD_TIME_MS = 3_000;

type TierResourceInput = Omit<ResourceDef, "tier" | "reqLevel">;
type TierInput = Omit<GatheringProductionTierDef, "resources" | "resourceDefs"> & {
  resourceDefs: readonly TierResourceInput[];
};

function campfireFuel(
  logItemId: ItemId,
  tier: number,
  visualLogAssetId: string,
): CampfireFuelDef {
  const buildXp = Math.round(gatherXp(tier) * 0.2);
  return {
    logItemId,
    tier,
    buildTimeMs: CAMPFIRE_BUILD_TIME_MS,
    lifetimeMs: (60 + 12 * tier) * 1_000,
    buildXp: { fletching: buildXp, crafting: buildXp },
    visualLogAssetId,
  };
}

function defineTier(input: TierInput): GatheringProductionTierDef {
  const resourceDefs: ResourceDef[] = input.resourceDefs.map((resource) => ({
    ...resource,
    tier: input.tier,
    reqLevel: input.reqLevel,
    presentation: { ...resource.presentation, materialTier: input.tier },
  }));
  const mining = resourceDefs.filter((resource) => resource.skill === "mining").map(({ id }) => id);
  const fishing = resourceDefs.find((resource) => resource.skill === "fishing")?.id;
  const woodcutting = resourceDefs.find((resource) => resource.skill === "woodcutting")?.id;
  if (mining.length === 0 || !fishing || !woodcutting) {
    throw new Error(`Gathering tier ${input.tier} must define mining, fishing, and woodcutting resources.`);
  }
  return {
    ...input,
    resourceDefs,
    resources: { mining, fishing, woodcutting },
  };
}

export const GATHERING_PRODUCTION_TIERS: readonly GatheringProductionTierDef[] = [
  defineTier({
    tier: 1,
    reqLevel: 1,
    metalName: "Copper",
    woodName: "Pine",
    items: {
      ore: "grithe_ore", flux: "march_stone", gem: "pale_quartz", bar: "grithe_bar",
      log: "palewood_log", shaft: "palewood_shaft", handle: "palewood_handle", hide: "coarse_hide",
      rawFish: "silt_minnow", cookedFish: "seared_minnow", burntFish: "burnt_minnow",
      rawMeat: "raw_game_meat", cookedMeat: "roast_game", burntMeat: "burnt_game",
      dagger: "grithe_dagger", sword: "grithe_sword", helm: "grithe_helm", body: "grithe_cuirass",
      legs: "grithe_greaves", boots: "grithe_boots", gloves: "grithe_gloves",
      pickaxe: "grithe_pickaxe", hatchet: "grithe_hatchet",
      staff: "palewood_staff", wand: "palewood_wand",
      rod: "palewood_rod", shield: "palewood_shield",
      hood: "marchhide_hood", robe: "marchhide_robe", magicLegs: "marchhide_leggings",
      magicBoots: "marchhide_boots", wraps: "marchhide_wraps",
    },
    magic: {
      element: "wind", essence: "air_essence", orb: "air_orb",
      staff: "air_staff", wand: "air_wand",
      basicStaff: "basic_wooden_staff", basicWand: "basic_wooden_wand",
    },
    resourceDefs: [
      {
        id: "ore_grithe", name: "Copper Seam", archetype: "ore", skill: "mining",
        itemId: "grithe_ore", bonus: [{ itemId: "pale_quartz", chance: 0.06 }],
        presentation: {
          availableAssetIds: ["corealm_ore_grithe"], depletedAssetId: "corealm_ore_grithe_spent", targetWorldSize: 1.55,
          variantScale: [0.92, 1.08], materialTier: 1,
        },
      },
      {
        id: "ore_marchstone", name: "Limestone Face", archetype: "ore", skill: "mining",
        itemId: "march_stone", bonus: [{ itemId: "pale_quartz", chance: 0.03 }],
        presentation: {
          availableAssetIds: ["corealm_ore_stone"], depletedAssetId: "corealm_ore_stone_spent", targetWorldSize: 1.55,
          variantScale: [0.94, 1.06], materialTier: 1,
        },
      },
      treeResource(TREE_SPECIES.find(species => species.id === "pine")!),
      {
        id: "fish_silt_minnow", name: "River Shallow", archetype: "fishing_spot", skill: "fishing",
        itemId: "silt_minnow",
        presentation: {
          availableAssetIds: ["fish_minnow"], targetWorldSize: 0.42,
          waterOffset: -0.32, materialTier: 1,
        },
      },
    ],
    smelting: { orePerBar: 1, fluxPerBar: 1 },
    campfire: campfireFuel("palewood_log", 1, "nature_wood_log"),
  }),
  defineTier({
    tier: 5,
    reqLevel: 5,
    metalName: "Iron",
    woodName: "Ash",
    items: {
      ore: "corven_ore", flux: "march_stone", gem: "vell_amber", bar: "corven_bar",
      log: "duskoak_log", shaft: "duskoak_shaft", handle: "duskoak_handle", hide: "bramble_hide",
      rawFish: "bramble_trout", cookedFish: "seared_trout", burntFish: "burnt_trout",
      rawMeat: "raw_venison", cookedMeat: "roast_venison", burntMeat: "burnt_venison",
      dagger: "corven_dagger", sword: "corven_sword", helm: "corven_helm", body: "corven_plate",
      legs: "corven_greaves", boots: "corven_boots", gloves: "corven_gauntlets",
      pickaxe: "corven_pickaxe", hatchet: "corven_hatchet",
      staff: "duskoak_staff", wand: "duskoak_wand",
      rod: "duskoak_rod", shield: "duskoak_shield",
      hood: "bramblehide_hood", robe: "bramblehide_robe", magicLegs: "bramblehide_leggings",
      magicBoots: "bramblehide_boots", wraps: "bramblehide_wraps",
    },
    magic: {
      element: "earth", essence: "earth_essence", orb: "earth_orb",
      staff: "earth_staff", wand: "earth_wand",
    },
    resourceDefs: [
      {
        id: "ore_corven", name: "Iron Seam", archetype: "ore", skill: "mining",
        itemId: "corven_ore", bonus: [{ itemId: "vell_amber", chance: 0.06 }],
        presentation: {
          availableAssetIds: ["corealm_ore_corven"], depletedAssetId: "corealm_ore_corven_spent", targetWorldSize: 1.55,
          variantScale: [0.92, 1.08], materialTier: 5,
        },
      },
      treeResource(TREE_SPECIES.find(species => species.id === "ash")!),
      {
        id: "fish_bramble_trout", name: "Blackwater Pool", archetype: "fishing_spot", skill: "fishing",
        itemId: "bramble_trout",
        presentation: {
          availableAssetIds: ["fish_trout"], targetWorldSize: 0.72,
          // At the deterministic low bob this leaves 18.9 mm over the 0.495 m basin floor.
          waterOffset: -0.23, materialTier: 5,
        },
      },
    ],
    smelting: { orePerBar: 2, fluxPerBar: 1 },
    campfire: campfireFuel("duskoak_log", 5, "nature_wood_log_moss"),
  }),
  defineTier({
    tier: 10,
    reqLevel: 10,
    metalName: "Cobalt",
    woodName: "Oak",
    items: {
      ore: "kaldite_ore", flux: "march_stone", gem: "cairn_garnet", bar: "kaldite_bar",
      log: "cairnpine_log", shaft: "cairnpine_shaft", handle: "cairnpine_handle", hide: "cairn_pelt",
      rawFish: "cragfin", cookedFish: "seared_cragfin", burntFish: "burnt_cragfin",
      rawMeat: "raw_haunch", cookedMeat: "roast_haunch", burntMeat: "burnt_haunch",
      dagger: "kaldite_dagger", sword: "kaldite_sword", helm: "kaldite_helm", body: "kaldite_plate",
      legs: "kaldite_greaves", boots: "kaldite_boots", gloves: "kaldite_gauntlets",
      pickaxe: "kaldite_pickaxe", hatchet: "kaldite_hatchet",
      staff: "cairnpine_staff", wand: "cairnpine_wand",
      rod: "cairnpine_rod", shield: "cairnpine_shield",
      hood: "cairnpelt_hood", robe: "cairnpelt_robe", magicLegs: "cairnpelt_leggings",
      magicBoots: "cairnpelt_boots", wraps: "cairnpelt_wraps",
    },
    magic: {
      element: "water", essence: "water_essence", orb: "water_orb",
      staff: "water_staff", wand: "water_wand",
    },
    resourceDefs: [
      {
        id: "ore_kaldite", name: "Cobalt Face", archetype: "ore", skill: "mining",
        itemId: "kaldite_ore", bonus: [{ itemId: "cairn_garnet", chance: 0.07 }],
        presentation: {
          availableAssetIds: ["corealm_ore_kaldite"], depletedAssetId: "corealm_ore_kaldite_spent", targetWorldSize: 1.55,
          variantScale: [0.92, 1.08], materialTier: 10,
        },
      },
      treeResource(TREE_SPECIES.find(species => species.id === "oak")!),
      {
        id: "fish_cragfin", name: "Mountain Lake", archetype: "fishing_spot", skill: "fishing",
        itemId: "cragfin",
        presentation: {
          availableAssetIds: ["fish_cragfin"], targetWorldSize: 0.92,
          // The tallest fish stays 23.9 mm submerged and clears the basin floor by 18.9 mm.
          waterOffset: -0.22, materialTier: 10,
        },
      },
    ],
    smelting: { orePerBar: 2, fluxPerBar: 2 },
    campfire: campfireFuel("cairnpine_log", 10, "nature_wood_log_snow"),
  }),
  defineTier({
    tier: 20,
    reqLevel: 20,
    metalName: "Titanium",
    woodName: "Walnut",
    items: {
      ore: "emberite_ore", flux: "kilnstone", gem: "fire_opal", bar: "emberite_bar",
      log: "cinderpine_log", shaft: "cinderpine_shaft", handle: "cinderpine_handle", hide: "charhide",
      rawFish: "ashfin", cookedFish: "seared_ashfin", burntFish: "burnt_ashfin",
      rawMeat: "raw_ember_haunch", cookedMeat: "roast_ember_haunch", burntMeat: "burnt_ember_haunch",
      dagger: "emberite_dagger", sword: "emberite_sword", helm: "emberite_helm", body: "emberite_plate",
      legs: "emberite_greaves", boots: "emberite_boots", gloves: "emberite_gauntlets",
      pickaxe: "emberite_pickaxe", hatchet: "emberite_hatchet",
      staff: "cinderpine_staff", wand: "cinderpine_wand",
      rod: "cinderpine_rod", shield: "cinderpine_shield",
      hood: "charhide_hood", robe: "charhide_robe", magicLegs: "charhide_leggings",
      magicBoots: "charhide_boots", wraps: "charhide_wraps",
    },
    magic: {
      element: "fire", essence: "fire_essence", orb: "fire_orb",
      staff: "fire_staff", wand: "fire_wand",
    },
    resourceDefs: [
      {
        id: "ore_emberite", name: "Titanium Seam", archetype: "ore", skill: "mining",
        itemId: "emberite_ore", bonus: [{ itemId: "fire_opal", chance: 0.07 }],
        presentation: {
          availableAssetIds: ["corealm_ore_emberite"], depletedAssetId: "corealm_ore_emberite_spent", targetWorldSize: 1.55,
          variantScale: [0.92, 1.08], materialTier: 20,
        },
      },
      {
        // Kilnstone is tier 20's own flux the way March Stone is tiers 1-10's: mined beside the
        // ore it fluxes, so the Clinker Rows circuit feeds the furnace without a trip south.
        id: "ore_kilnstone", name: "Flux Stone Face", archetype: "ore", skill: "mining",
        itemId: "kilnstone", bonus: [{ itemId: "fire_opal", chance: 0.03 }],
        presentation: {
          availableAssetIds: ["corealm_ore_kilnstone"], depletedAssetId: "corealm_ore_kilnstone_spent", targetWorldSize: 1.55,
          variantScale: [0.94, 1.06], materialTier: 20,
        },
      },
      treeResource(TREE_SPECIES.find(species => species.id === "walnut")!),
      {
        id: "fish_ashfin", name: "Hot Spring", archetype: "fishing_spot", skill: "fishing",
        itemId: "ashfin",
        presentation: {
          // Reuses the cragfin mesh: the shipped fish pack has three bodies, and the tier-20
          // material treatment recolours it. The draw size and offset stay exactly the tarn row's
          // because the clearance arithmetic is millimetre-tight: at 0.98 the bob measured only
          // 2.1 mm over the spring's basin floor against the 18 mm minimum.
          availableAssetIds: ["fish_cragfin"], targetWorldSize: 0.92,
          waterOffset: -0.22, materialTier: 20,
        },
      },
    ],
    smelting: { orePerBar: 3, fluxPerBar: 2 },
    campfire: campfireFuel("cinderpine_log", 20, "nature_wood_log"),
  }),
];

export const CAMPFIRE_FUELS: readonly CampfireFuelDef[] =
  [...GATHERING_PRODUCTION_TIERS.map((definition) => definition.campfire),
    ...TREE_SPECIES.filter(species => species.level > 20).map(species => campfireFuel(species.logId, species.level, "nature_wood_log"))];

export function gatheringProductionTier(tier: number): GatheringProductionTierDef | undefined {
  return GATHERING_PRODUCTION_TIERS.find((definition) => definition.tier === tier);
}
