/**
 * Cross-table validation for the gathering and production authoring contract.
 *
 * This module is deliberately data-only. Boot supplies the tables and the loaded manifest, which
 * keeps validation independent of registry order and makes malformed fixtures straightforward to
 * test. Every returned string is fatal to the foundation.
 */
import type { ItemDef, ItemId, RecipeId, StationKind } from "../contracts.js";
import type { GatheringProductionTierDef, RecipeDef, ResourceDef } from "./index.js";
import { isUserSuppliedAssetPack, isSupportedCcAttributionLicense, validateCcAssetPack, isFabStandardAssetPack } from "./assetLicenses.js";

export const GATHERING_PRODUCTION_STATION_KINDS = [
  "furnace",
  "anvil",
  "range",
  "campfire",
  "crafting_table",
  "fletching_bench",
  "essence_altar",
] as const satisfies readonly StationKind[];

export interface GatheringProductionClusterRef {
  id: string;
  resourceId: string;
}

/** A station may leave recipeIds empty to expose every recipe compatible with its kind. */
export interface GatheringProductionStationRef {
  id: string;
  kind: string;
  recipeIds: readonly string[];
}

/** Structural subset of render/itemIconAppearances.ts, avoiding a render dependency at boot. */
export interface GatheringProductionItemAppearanceRef {
  itemId: string;
  parts: readonly (
    | { kind: "asset"; assetId: string }
    | { kind: string; assetId?: string }
  )[];
}

export interface GatheringProductionManifestPack {
  id: string;
  source: string;
  license: string;
  /** Lowercase SHA-256 of the source archive. */
  archiveSha256?: string;
  generatorSha256?: string;
  sourceReference?: { assetId: string; file: string; pack: string; sha256: string; license: string; upstreamSource: string; upstreamLicense: string };
}

export interface GatheringProductionManifestAsset {
  id: string;
  pack: string;
  file?: string;
}

export interface GatheringProductionAssetManifest {
  packs: readonly GatheringProductionManifestPack[];
  assets: readonly GatheringProductionManifestAsset[];
}

export interface GatheringProductionValidationInput {
  tiers: readonly GatheringProductionTierDef[];
  /** Combat-loot crafting can extend production beyond the complete gathering matrices. */
  additionalRecipeTiers?: readonly { tier: number; reqLevel: number }[];
  resources: readonly ResourceDef[];
  recipes: readonly RecipeDef[];
  items: readonly ItemDef[];
  knownManifestAssetIds: ReadonlySet<string>;
  assetManifest: GatheringProductionAssetManifest;
  /** Actual bytes hashed by the build tool, keyed by repository-relative source path. */
  verifiedSourceHashes: ReadonlyMap<string, string>;
  /** Region resource references, when the world tables are available. */
  clusters?: readonly GatheringProductionClusterRef[];
  /** Authored station recipe allow-lists, when the world tables are available. */
  stations?: readonly GatheringProductionStationRef[];
  /** One explicit icon appearance per item. */
  itemAppearances: readonly GatheringProductionItemAppearanceRef[];
}

const VALID_STATIONS = new Set<string>(GATHERING_PRODUCTION_STATION_KINDS);
const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;
const UNITY_ASSET_STORE_LICENSE = "Standard Unity Asset Store EULA";

export function validateGatheringManifestProvenance(
  manifest: GatheringProductionAssetManifest,
  verifiedSourceHashes: ReadonlyMap<string, string>,
): string[] {
  const problems: string[] = [];
  for (const pack of manifest.packs) {
    if (isUserSuppliedAssetPack(pack)) continue;
    const hashMatches = LOWERCASE_SHA256.test(pack.generatorSha256 ?? "")
      && verifiedSourceHashes.get(pack.source) === pack.generatorSha256;
    const isOriginal = pack.license === "LicenseRef-Corealm-Original"
      && (/^tools\/build-(?:corealm-(?:nature|geology|farm|minerals|equipment)|creature-expansion|ground-ores)\.ts$/.test(pack.source)
        || pack.source === 'tools/wilderness-trees/build.ts'
        || pack.id === 'corealm-original-wilderness-resources' && pack.source === 'tools/wilderness-resources/build.ts'
        || pack.id === 'corealm-icon-item-models' && pack.source === 'tools/item-models/build.ts'
        || pack.id === 'corealm-original-wilderness-keepers' && pack.source === 'tools/wilderness-creatures/keepers/hollow-star.mjs')
      && hashMatches;
    const derivativeIdentity = pack.id === "corealm-original-ground-ores" && pack.source === "tools/build-ground-ores.ts"
      && pack.license.startsWith("Derivative geometry and material maps") && pack.license.includes(UNITY_ASSET_STORE_LICENSE);
    const reference = pack.sourceReference;
    const upstream = manifest.packs.find((candidate) => candidate.id === reference?.pack);
    const sourceAsset = manifest.assets.find((asset) => asset.id === reference?.assetId);
    const isDerivative = derivativeIdentity && hashMatches && reference !== undefined
      && reference.pack === "dexsoft-rocks-free" && reference.assetId === "rocks_free_essence_node"
      && sourceAsset?.pack === reference.pack && sourceAsset.file !== undefined
      && reference.file === `game/public/assets/${sourceAsset.file}`
      && LOWERCASE_SHA256.test(reference.sha256) && verifiedSourceHashes.get(reference.file) === reference.sha256
      && reference.license.includes(UNITY_ASSET_STORE_LICENSE)
      && upstream !== undefined && isHttpSource(upstream.source) && upstream.license.startsWith(UNITY_ASSET_STORE_LICENSE)
      && reference.upstreamSource === upstream.source && reference.upstreamLicense === upstream.license;
    if ((pack.license === "LicenseRef-Corealm-Original" || derivativeIdentity) && !hashMatches) {
      problems.push(`manifest pack ${pack.id} generator SHA-256 does not match verified source bytes`);
    }
    if (derivativeIdentity && !isDerivative) problems.push(`manifest pack ${pack.id} has no verified licensed upstream reference`);
    if (!isHttpSource(pack.source) && !isOriginal && !isDerivative) problems.push(`manifest pack ${pack.id} has no reproducible HTTP(S) source`);
    const isCc0 = pack.license === "CC0-1.0";
    const isCcAttribution = isSupportedCcAttributionLicense(pack.license);
    if (isCcAttribution) {
      try { validateCcAssetPack(pack); }
      catch (error) { problems.push(`manifest pack ${pack.id}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    const isUnityStoreAsset = pack.license.startsWith(UNITY_ASSET_STORE_LICENSE);
    if (!isCc0 && !isCcAttribution && !isUnityStoreAsset && !isFabStandardAssetPack(pack) && !isOriginal && !isDerivative) problems.push(`manifest pack ${pack.id} has unsupported license "${pack.license}"`);
    if (isCc0 && !LOWERCASE_SHA256.test(pack.archiveSha256 ?? "")) problems.push(`manifest pack ${pack.id} has no valid lowercase archive SHA-256`);
  }
  return problems;
}

interface CanonicalTierRecipeExpectation {
  family: string;
  id: RecipeId;
  kind: RecipeDef["kind"];
  outputItemId: ItemId;
  stations: readonly StationKind[];
  requiredInputItemIds?: readonly ItemId[];
  forbiddenInputItemIds?: readonly ItemId[];
  burntItemId?: ItemId;
}

const RECIPE_COMPATIBILITY = {
  smelt: { skill: "smithing", stations: ["furnace"] },
  smith: { skill: "smithing", stations: ["anvil"] },
  cook: { skill: "cooking", stations: ["range", "campfire"] },
  craft: { skill: "crafting", stations: ["crafting_table", "essence_altar"] },
  fletch: { skill: "fletching", stations: ["fletching_bench"] },
} as const satisfies Readonly<Record<
  RecipeDef["kind"],
  Readonly<{ skill: RecipeDef["skill"]; stations: readonly StationKind[] }>
>>;

function isHttpSource(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function recordDuplicates(
  problems: string[],
  table: string,
  ids: readonly (string | number)[],
): void {
  const seen = new Set<string | number>();
  for (const id of ids) {
    if (seen.has(id)) problems.push(`${table} has duplicate id "${String(id)}"`);
    seen.add(id);
  }
}

function tierResourceReferences(
  tier: GatheringProductionTierDef,
): readonly {
  id: string;
  role: "mining" | "fishing" | "woodcutting";
  itemRole: "ore" | "flux" | "rawFish" | "log";
  expectedItemId: ItemId;
  expectedBonusItemId?: ItemId;
}[] {
  return [
    ...tier.resources.mining.map((id, index) => ({
      id,
      role: "mining" as const,
      itemRole: index === 0 ? "ore" as const : "flux" as const,
      expectedItemId: index === 0 ? tier.items.ore : tier.items.flux,
      expectedBonusItemId: tier.items.gem,
    })),
    {
      id: tier.resources.fishing,
      role: "fishing" as const,
      itemRole: "rawFish" as const,
      expectedItemId: tier.items.rawFish,
    },
    {
      id: tier.resources.woodcutting,
      role: "woodcutting" as const,
      itemRole: "log" as const,
      expectedItemId: tier.items.log,
    },
  ];
}

/**
 * The complete production family derived from a tier's canonical item ids.
 *
 * Ingredient quantities remain owned by recipes.ts and its formula tests. Boot validation only
 * checks the material links that define a family: smelting inputs, handled metal equipment,
 * elemental weapon upgrades, and raw-to-cooked fish. This catches a missing or misclassified row without copying
 * the full recipe table into the validator.
 */
function canonicalTierRecipeExpectations(
  tier: GatheringProductionTierDef,
): readonly CanonicalTierRecipeExpectation[] {
  const m = tier.items;
  const smelt = (
    family: string,
    outputItemId: ItemId,
    requiredInputItemIds?: readonly ItemId[],
  ): CanonicalTierRecipeExpectation => ({
    family,
    id: `smelt_${outputItemId}`,
    kind: "smelt",
    outputItemId,
    stations: ["furnace"],
    requiredInputItemIds,
  });
  const smith = (
    family: string,
    outputItemId: ItemId,
    handled = false,
  ): CanonicalTierRecipeExpectation => ({
    family,
    id: `smith_${outputItemId}`,
    kind: "smith",
    outputItemId,
    stations: ["anvil"],
    ...(handled
      ? {
          requiredInputItemIds: [m.bar, m.handle],
          forbiddenInputItemIds: [m.shaft],
        }
      : {}),
  });
  const craft = (
    family: string,
    outputItemId: ItemId,
    id: RecipeId = `craft_${outputItemId}`,
  ): CanonicalTierRecipeExpectation => ({
    family,
    id,
    kind: "craft",
    outputItemId,
    stations: ["crafting_table"],
  });
  const fletch = (
    family: string,
    outputItemId: ItemId,
    requiredInputItemIds?: readonly ItemId[],
  ): CanonicalTierRecipeExpectation => ({
    family,
    id: `fletch_${outputItemId}`,
    kind: "fletch",
    outputItemId,
    stations: ["fletching_bench"],
    requiredInputItemIds,
  });

  const expectations: CanonicalTierRecipeExpectation[] = [
    smelt("bar", m.bar, [m.ore, m.flux]),
    smith("dagger", m.dagger, true),
    smith("sword", m.sword, true),
    smith("helm", m.helm),
    smith("body armour", m.body),
    smith("leg armour", m.legs),
    smith("boots", m.boots),
    smith("gloves", m.gloves),
    smith("pickaxe", m.pickaxe, true),
    smith("hatchet", m.hatchet, true),
    {
      family: "cooked fish",
      id: `cook_${m.cookedFish}`,
      kind: "cook",
      outputItemId: m.cookedFish,
      stations: ["range", "campfire"],
      requiredInputItemIds: [m.rawFish],
      burntItemId: m.burntFish,
    },
    {
      // The hunting half of Cooking, and the same row shape as the fish above it. Game meat comes
      // off this tier's animals rather than out of the gathering ladder, but it cooks at the same
      // fire and burns the same way, so the matrix owns it too.
      family: "cooked meat",
      id: `cook_${m.cookedMeat}`,
      kind: "cook",
      outputItemId: m.cookedMeat,
      stations: ["range", "campfire"],
      requiredInputItemIds: [m.rawMeat],
      burntItemId: m.burntMeat,
    },
    {
      ...craft("elemental wand", tier.magic.wand),
      stations: ["essence_altar"],
      requiredInputItemIds: [m.wand],
      forbiddenInputItemIds: [tier.magic.orb],
    },
    {
      ...craft("elemental staff", tier.magic.staff),
      stations: ["essence_altar"],
      requiredInputItemIds: [m.staff],
      forbiddenInputItemIds: [tier.magic.orb],
    },
    craft("melee ring", m.meleeRing),
    craft("melee pendant", m.meleePendant),
    craft("magic ring", m.magicRing),
    craft("magic charm", m.magicCharm),
    craft("robe", m.robe),
    craft("magic leg armour", m.magicLegs),
    craft("hood", m.hood),
    craft("magic boots", m.magicBoots),
    craft("wraps", m.wraps),
    fletch("shafts", m.shaft, [m.log]),
    fletch("handles", m.handle, [m.log]),
    { ...fletch("staff", m.staff, [m.shaft]), forbiddenInputItemIds: [m.gem] },
    { ...fletch("wand", m.wand, [m.shaft]), forbiddenInputItemIds: [m.gem] },
    fletch("wooden shield", m.shield, [m.log, m.bar]),
    fletch("fishing rod", m.rod, [m.shaft, m.hide]),
  ];
  if (tier.magic.basicWand) {
    expectations.push(fletch("basic wand", tier.magic.basicWand, [m.shaft]));
  }
  if (tier.magic.basicStaff) {
    expectations.push(fletch("basic staff", tier.magic.basicStaff, [m.shaft]));
  }
  return expectations;
}

function hasSameStationKinds(
  actual: readonly StationKind[] | null | undefined,
  expected: readonly StationKind[],
): boolean {
  return Array.isArray(actual)
    && actual.length === expected.length
    && expected.every((station) => actual.includes(station));
}

/**
 * Validates the complete gathering and production data graph.
 *
 * The return value is empty when valid. Boot should publish every returned string as a fatal
 * content error so one load reports all authoring mistakes rather than stopping at the first.
 */
export function validateGatheringProduction(
  input: GatheringProductionValidationInput,
): string[] {
  const problems: string[] = [];

  recordDuplicates(problems, "gathering tiers", input.tiers.map((row) => row.tier));
  recordDuplicates(problems, "items", input.items.map((row) => row.id));
  recordDuplicates(problems, "resources", input.resources.map((row) => row.id));
  recordDuplicates(problems, "recipes", input.recipes.map((row) => row.id));
  recordDuplicates(problems, "manifest packs", input.assetManifest.packs.map((row) => row.id));
  recordDuplicates(problems, "manifest assets", input.assetManifest.assets.map((row) => row.id));
  recordDuplicates(problems, "item appearances", input.itemAppearances.map((row) => row.itemId));
  if (input.clusters) recordDuplicates(problems, "resource clusters", input.clusters.map((row) => row.id));
  if (input.stations) recordDuplicates(problems, "stations", input.stations.map((row) => row.id));

  const tiersByLevel = new Map(input.tiers.map((row) => [row.tier, row] as const));
  const itemsById = new Map(input.items.map((row) => [row.id, row] as const));
  const resourcesById = new Map(input.resources.map((row) => [row.id, row] as const));
  const recipesById = new Map(input.recipes.map((row) => [row.id, row] as const));
  const packsById = new Map(input.assetManifest.packs.map((row) => [row.id, row] as const));
  const manifestAssetsById = new Map(input.assetManifest.assets.map((row) => [row.id, row] as const));
  const appearancesByItem = new Map(input.itemAppearances.map((row) => [row.itemId, row] as const));
  const foundationResourceIds = new Set<string>();
  const foundationAssetIds = new Set<string>();

  const requireItem = (itemId: string, where: string): ItemDef | undefined => {
    const item = itemsById.get(itemId as ItemId);
    if (!item) problems.push(`${where} references unknown item "${itemId}"`);
    return item;
  };

  const requireManifestAsset = (assetId: string, where: string): void => {
    if (assetId.trim().length === 0) {
      problems.push(`${where} has an empty asset id`);
      return;
    }
    if (!input.knownManifestAssetIds.has(assetId)) {
      problems.push(`${where} references unknown manifest asset "${assetId}"`);
    }
  };

  problems.push(...validateGatheringManifestProvenance(input.assetManifest, input.verifiedSourceHashes));
  for (const asset of input.assetManifest.assets) {
    if (!packsById.has(asset.pack)) {
      problems.push(`manifest asset ${asset.id} references unknown manifest pack "${asset.pack}"`);
    }
  }

  for (const tier of input.tiers) {
    const where = `gathering tier ${tier.tier}`;
    if (!Number.isInteger(tier.tier) || tier.tier < 1) {
      problems.push(`${where} must use a positive integer tier`);
    }
    if (tier.reqLevel !== tier.tier) {
      problems.push(`${where} has reqLevel ${tier.reqLevel}; expected ${tier.tier}`);
    }

    const tierItems = tier.items as unknown as Record<string, string | undefined>;
    for (const [role, itemId] of Object.entries(tierItems)) {
      if (typeof itemId !== "string" || itemId.length === 0) {
        problems.push(`${where} is missing item role "${role}"`);
        continue;
      }
      const item = requireItem(itemId, `${where} item ${role}`);
      if (!item) continue;
      if (role === "flux") {
        if (item.tier > tier.tier) {
          problems.push(`${where} item ${role} has future tier ${item.tier}`);
        }
      } else if (item.tier !== tier.tier) {
        problems.push(`${where} item ${role} has tier ${item.tier}; expected ${tier.tier}`);
      }
    }
    for (const [role, itemId] of Object.entries(tier.magic)) {
      if (role === "element") continue;
      if (typeof itemId !== "string" || itemId.length === 0) {
        problems.push(`${where} magic is missing item role "${role}"`);
        continue;
      }
      const item = requireItem(itemId, `${where} magic item ${role}`);
      if (!item) continue;
      const expectedTier = role === "basicStaff" || role === "basicWand" ? 0 : tier.tier;
      if (item.tier !== expectedTier) {
        problems.push(`${where} magic item ${role} has tier ${item.tier}; expected ${expectedTier}`);
      }
    }

    const resourceRefs = tierResourceReferences(tier);
    if (tier.resources.mining.length === 0) {
      problems.push(`${where} has no canonical ore resource`);
    }
    recordDuplicates(problems, `${where} resources`, resourceRefs.map((row) => row.id));
    recordDuplicates(problems, `${where} resourceDefs`, tier.resourceDefs.map((row) => row.id));
    const authoredResourceIds = new Set(tier.resourceDefs.map((row) => row.id));
    for (const reference of resourceRefs) {
      if (!authoredResourceIds.has(reference.id)) {
        problems.push(`${where} ${reference.role} resource "${reference.id}" is missing its canonical resourceDef`);
      }
    }
    for (const authored of tier.resourceDefs) {
      if (!resourceRefs.some((reference) => reference.id === authored.id)) {
        problems.push(`${where} resourceDef "${authored.id}" is not exposed by its derived resource references`);
      }
      if (resourcesById.get(authored.id) !== authored) {
        problems.push(`${where} resourceDef "${authored.id}" is not the canonical exported resource row`);
      }
    }
    for (const reference of resourceRefs) {
      foundationResourceIds.add(reference.id);
      const resource = resourcesById.get(reference.id);
      if (!resource) {
        problems.push(`${where} ${reference.role} references unknown resource "${reference.id}"`);
        continue;
      }
      if (resource.tier !== tier.tier) {
        problems.push(`resource ${resource.id} has tier ${resource.tier}; expected ${tier.tier}`);
      }
      if (resource.reqLevel !== tier.reqLevel) {
        problems.push(`resource ${resource.id} has reqLevel ${resource.reqLevel}; expected ${tier.reqLevel}`);
      }
      const expectedSkill = reference.role;
      if (resource.skill !== expectedSkill) {
        problems.push(`resource ${resource.id} has skill ${resource.skill}; expected ${expectedSkill}`);
      }
      const expectedArchetype = reference.role === "mining"
        ? "ore"
        : reference.role === "fishing"
          ? "fishing_spot"
          : "tree";
      if (resource.archetype !== expectedArchetype) {
        problems.push(`resource ${resource.id} has archetype ${resource.archetype}; expected ${expectedArchetype}`);
      }
      if (resource.itemId !== reference.expectedItemId) {
        problems.push(
          `${where} ${reference.role} resource ${resource.id} yields ${resource.itemId}; `
          + `expected canonical ${reference.itemRole} item ${reference.expectedItemId}`,
        );
      }
      if (reference.expectedBonusItemId) {
        if (resource.bonus?.length !== 1
          || resource.bonus[0]?.itemId !== reference.expectedBonusItemId) {
          problems.push(
            `${where} mining resource ${resource.id} must have exactly one canonical gem bonus `
            + `"${reference.expectedBonusItemId}"`,
          );
        }
      } else if ((resource.bonus?.length ?? 0) > 0) {
        problems.push(
          `${where} ${reference.role} resource ${resource.id} cannot have a non-canonical bonus item`,
        );
      }
    }

    const campfire = tier.campfire;
    if (campfire.tier !== tier.tier) {
      problems.push(`${where} campfire has tier ${campfire.tier}; expected ${tier.tier}`);
    }
    if (campfire.logItemId !== tier.items.log) {
      problems.push(`${where} campfire uses ${campfire.logItemId}; expected log ${tier.items.log}`);
    }
    requireItem(campfire.logItemId, `${where} campfire`);
    if (!Number.isFinite(campfire.buildTimeMs) || campfire.buildTimeMs <= 0) {
      problems.push(`${where} campfire buildTimeMs must be greater than zero`);
    }
    if (!Number.isFinite(campfire.lifetimeMs) || campfire.lifetimeMs <= 0) {
      problems.push(`${where} campfire lifetimeMs must be greater than zero`);
    }
    if (!Number.isFinite(campfire.buildXp.fletching) || campfire.buildXp.fletching < 0
      || !Number.isFinite(campfire.buildXp.crafting) || campfire.buildXp.crafting < 0) {
      problems.push(`${where} campfire build XP must be finite and non-negative`);
    }
    foundationAssetIds.add(campfire.visualLogAssetId);
    requireManifestAsset(campfire.visualLogAssetId, `${where} campfire visual`);

    const expectedRecipes = canonicalTierRecipeExpectations(tier);
    const expectedRecipeIds = new Set(expectedRecipes.map((expectation) => expectation.id));
    const tierRecipes = input.recipes.filter((recipe) => recipe.tier === tier.tier);
    if (tierRecipes.length !== expectedRecipes.length) {
      problems.push(
        `${where} has ${tierRecipes.length} recipes; expected the complete `
        + `${expectedRecipes.length}-recipe matrix`,
      );
    }
    for (const recipe of tierRecipes) {
      if (!expectedRecipeIds.has(recipe.id)) {
        problems.push(`${where} has unexpected recipe "${recipe.id}" outside its canonical matrix`);
      }
    }
    for (const expectation of expectedRecipes) {
      const recipe = recipesById.get(expectation.id);
      if (!recipe || recipe.tier !== tier.tier) {
        problems.push(
          `${where} is missing canonical recipe family "${expectation.family}" `
          + `(${expectation.id})`,
        );
        continue;
      }
      if (recipe.kind !== expectation.kind) {
        problems.push(
          `recipe ${recipe.id} is canonical ${expectation.family} but has kind ${recipe.kind}; `
          + `expected ${expectation.kind}`,
        );
      }
      if (recipe.output.itemId !== expectation.outputItemId) {
        problems.push(
          `recipe ${recipe.id} produces ${recipe.output.itemId}; `
          + `expected canonical ${expectation.family} item ${expectation.outputItemId}`,
        );
      }
      if (!hasSameStationKinds(recipe.stations, expectation.stations)) {
        problems.push(
          `recipe ${recipe.id} canonical ${expectation.family} stations must be `
          + expectation.stations.join(" and "),
        );
      }
      for (const itemId of expectation.requiredInputItemIds ?? []) {
        if (!recipe.inputs.some((recipeInput) => recipeInput.itemId === itemId)) {
          problems.push(
            `recipe ${recipe.id} canonical ${expectation.family} must use item ${itemId}`,
          );
        }
      }
      for (const itemId of expectation.forbiddenInputItemIds ?? []) {
        if (recipe.inputs.some((recipeInput) => recipeInput.itemId === itemId)) {
          problems.push(
            `recipe ${recipe.id} canonical ${expectation.family} cannot use legacy item ${itemId}`,
          );
        }
      }
      if (expectation.burntItemId !== undefined
        && recipe.burntItemId !== expectation.burntItemId) {
        problems.push(
          `recipe ${recipe.id} burnt output is ${String(recipe.burntItemId)}; `
          + `expected ${expectation.burntItemId}`,
        );
      }
    }
  }

  for (const resource of input.resources) {
    const item = requireItem(resource.itemId, `resource ${resource.id}`);
    for (const bonus of resource.bonus ?? []) {
      requireItem(bonus.itemId, `resource ${resource.id} bonus`);
      if (!Number.isFinite(bonus.chance) || bonus.chance <= 0 || bonus.chance > 1) {
        problems.push(`resource ${resource.id} bonus ${bonus.itemId} chance must be greater than zero and at most one`);
      }
    }
    if (item && item.tier > resource.tier) {
      problems.push(`resource ${resource.id} yields future-tier item ${item.id} at tier ${item.tier}`);
    }
    if (!foundationResourceIds.has(resource.id)) continue;

    const presentation = resource.presentation;
    if (!presentation || !Array.isArray(presentation.availableAssetIds)
      || presentation.availableAssetIds.length === 0) {
      problems.push(`resource ${resource.id} has no available assets`);
    } else {
      const assetIds = presentation.availableAssetIds;
      recordDuplicates(problems, `resource ${resource.id} available assets`, assetIds);
      for (const assetId of assetIds) {
        foundationAssetIds.add(assetId);
        requireManifestAsset(assetId, `resource ${resource.id} available state`);
      }
    }
    // Fishing and ore have explicit procedural depleted treatments: the school disappears into a
    // faint recovery ripple, while a seam keeps its rock and gains worked scars/dust. Trees require
    // authored stump meshes because clipping or desaturation alone is not readable at play distance.
    if ((!presentation || typeof presentation.depletedAssetId !== "string"
      || presentation.depletedAssetId.trim().length === 0) && resource.archetype === "tree") {
      problems.push(`resource ${resource.id} has no authored depleted asset`);
    } else if (presentation?.depletedAssetId) {
      foundationAssetIds.add(presentation.depletedAssetId);
      requireManifestAsset(presentation.depletedAssetId, `resource ${resource.id} depleted state`);
    }
    if (!presentation || !Number.isFinite(presentation.targetWorldSize)
      || presentation.targetWorldSize <= 0) {
      problems.push(`resource ${resource.id} targetWorldSize must be greater than zero`);
    }
    if (!presentation || presentation.materialTier !== resource.tier) {
      problems.push(`resource ${resource.id} material tier does not match resource tier ${resource.tier}`);
    }
  }

  for (const recipe of input.recipes) {
    const tier = tiersByLevel.get(recipe.tier)
      ?? input.additionalRecipeTiers?.find(candidate => candidate.tier === recipe.tier);
    if (!tier) {
      problems.push(`recipe ${recipe.id} references unknown gathering tier ${recipe.tier}`);
    } else if (recipe.reqLevel !== tier.reqLevel) {
      problems.push(`recipe ${recipe.id} has reqLevel ${recipe.reqLevel}; expected ${tier.reqLevel}`);
    }
    for (const recipeInput of recipe.inputs) {
      requireItem(recipeInput.itemId, `recipe ${recipe.id} input`);
      if (!Number.isInteger(recipeInput.quantity) || recipeInput.quantity <= 0) {
        problems.push(`recipe ${recipe.id} input ${recipeInput.itemId} quantity must be a positive integer`);
      }
    }
    const output = requireItem(recipe.output.itemId, `recipe ${recipe.id} output`);
    if (!Number.isInteger(recipe.output.quantity) || recipe.output.quantity <= 0) {
      problems.push(`recipe ${recipe.id} output ${recipe.output.itemId} quantity must be a positive integer`);
    }
    if (!Number.isFinite(recipe.durationMs) || recipe.durationMs <= 0) {
      problems.push(`recipe ${recipe.id} durationMs must be finite and greater than zero`);
    }
    if (!Number.isFinite(recipe.xp) || recipe.xp < 0) {
      problems.push(`recipe ${recipe.id} XP must be finite and non-negative`);
    }
    if (output && output.tier > recipe.tier) {
      problems.push(`recipe ${recipe.id} produces future-tier item ${output.id} at tier ${output.tier}`);
    }
    if (recipe.burntItemId) requireItem(recipe.burntItemId, `recipe ${recipe.id} burnt output`);

    const compatibility = Object.hasOwn(RECIPE_COMPATIBILITY, recipe.kind)
      ? RECIPE_COMPATIBILITY[recipe.kind]
      : undefined;
    if (!compatibility) {
      problems.push(`recipe ${recipe.id} has invalid kind "${String(recipe.kind)}"`);
    } else if (recipe.skill !== compatibility.skill) {
      problems.push(
        `recipe ${recipe.id} kind ${recipe.kind} uses skill ${recipe.skill}; `
        + `expected ${compatibility.skill}`,
      );
    }

    const stations = recipe.stations as readonly string[] | null | undefined;
    if (!stations || stations.length === 0) {
      problems.push(`recipe ${recipe.id} has no accepted station kind`);
      continue;
    }
    recordDuplicates(problems, `recipe ${recipe.id} station kinds`, stations);
    for (const station of stations) {
      if (!VALID_STATIONS.has(station)) {
        problems.push(`recipe ${recipe.id} references invalid station kind "${station}"`);
      }
    }
    if (compatibility && stations.some((station) => (
      !(compatibility.stations as readonly string[]).includes(station)
    ))) {
      const expectedStations = compatibility.stations.length === 1
        ? compatibility.stations[0]
        : `one of ${compatibility.stations.join(" or ")}`;
      problems.push(
        `recipe ${recipe.id} kind ${recipe.kind} must use ${expectedStations}`,
      );
    }
    if (recipe.kind === "cook") {
      if (!stations.includes("range") || !stations.includes("campfire")) {
        problems.push(`cooking recipe ${recipe.id} must accept range and campfire`);
      }
    } else {
      if (stations.length !== 1) {
        problems.push(`non-cooking recipe ${recipe.id} must accept exactly one station kind`);
      }
      if (stations.includes("campfire")) {
        problems.push(`non-cooking recipe ${recipe.id} cannot use campfire`);
      }
    }
  }

  for (const cluster of input.clusters ?? []) {
    if (!resourcesById.has(cluster.resourceId)) {
      problems.push(`resource cluster ${cluster.id} references unknown resource "${cluster.resourceId}"`);
    }
  }

  for (const station of input.stations ?? []) {
    if (!VALID_STATIONS.has(station.kind)) {
      problems.push(`station ${station.id} references invalid station kind "${station.kind}"`);
    }
    recordDuplicates(problems, `station ${station.id} recipe references`, station.recipeIds);
    for (const recipeId of station.recipeIds) {
      const recipe = recipesById.get(recipeId as RecipeId);
      if (!recipe) {
        problems.push(`station ${station.id} references unknown recipe "${recipeId}"`);
      } else if (!recipe.stations?.includes(station.kind as StationKind)) {
        problems.push(`station ${station.id} lists recipe ${recipeId}, which does not accept ${station.kind}`);
      }
    }
  }

  for (const item of input.items) {
    const appearance = appearancesByItem.get(item.id);
    if (!appearance) {
      problems.push(`item ${item.id} has no icon appearance`);
      continue;
    }
    if (!Array.isArray(appearance.parts) || appearance.parts.length === 0) {
      problems.push(`item ${item.id} has an empty icon appearance`);
      continue;
    }
    for (const part of appearance.parts) {
      if (part.kind !== "asset") continue;
      if (typeof part.assetId !== "string" || part.assetId.trim().length === 0) {
        problems.push(`item ${item.id} icon appearance has an empty asset reference`);
      } else {
        requireManifestAsset(part.assetId, `item ${item.id} icon appearance`);
      }
    }
  }
  for (const appearance of input.itemAppearances) {
    if (!itemsById.has(appearance.itemId as ItemId)) {
      problems.push(`item appearance references unknown item "${appearance.itemId}"`);
    }
  }

  for (const assetId of foundationAssetIds) {
    if (!manifestAssetsById.has(assetId)) {
      problems.push(`foundation asset ${assetId} has no manifest metadata entry`);
    }
  }

  return problems;
}
