import { CROWNWARD_FISH } from '../game/src/content/crownwardFishing.js';
/** Authoring checks run before packaging, so players do not download or repeat the build audit. */
import path from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { content, type ContentTables } from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { RESOURCES } from "../game/src/content/resources.js";
import { RECIPES } from "../game/src/content/recipes.js";
import { CREATURE_LOOT_RECIPES } from "../game/src/content/creatureLoot.js";
import { WILDERNESS_CRAFTING_TIERS } from '../game/src/content/wildernessLoot.js';
import { SPELLS } from "../game/src/content/spells.js";
import { ENEMIES } from "../game/src/content/enemies.js";
import { SHOPS } from "../game/src/content/shops.js";
import { QUESTS, type QuestPredicate } from "../game/src/content/quests.js";
import { REGIONS, validateRegions } from "../game/src/content/regions.js";
import { GATHERING_PRODUCTION_TIERS } from "../game/src/content/gatheringProductionTiers.js";
import { validateGatheringProduction } from "../game/src/content/validateGatheringProduction.js";
import { ITEM_ICON_APPEARANCE_IDS, itemIconAppearance } from "../game/src/render/itemIconAppearances.js";
import { ALL_PROCEDURAL_GEAR_ASSETS } from "../game/src/render/proceduralGear.js";
import { TRAVERSAL_CONTACTS } from "../game/src/systems/traversalContacts.js";
import type { AssetManifest } from "../game/src/render/assets.js";
import { createInitialState } from "../game/src/state/store.js";
import { buildWorld } from "../game/src/world/regionBuilder.js";
import { gameRoot } from "./lib/paths.js";

export interface GameContentValidation {
  seed: number;
  assets: number;
  items: number;
  recipes: number;
  entities: number;
  routeLocations: number;
}

function validateContentTables(tables: ContentTables): string[] {
  const problems: string[] = [];
  const itemIds = new Set(tables.items.map((item) => item.id));
  const requireItem = (itemId: string, where: string): void => {
    if (!itemIds.has(itemId)) problems.push(`${where} references unknown item "${itemId}"`);
  };
  for (const resource of tables.resources) {
    requireItem(resource.itemId, `resource ${resource.id}`);
    for (const bonus of resource.bonus ?? []) requireItem(bonus.itemId, `resource ${resource.id} bonus`);
  }
  for (const recipe of tables.recipes) {
    for (const input of recipe.inputs) requireItem(input.itemId, `recipe ${recipe.id} input`);
    requireItem(recipe.output.itemId, `recipe ${recipe.id} output`);
    if (recipe.burntItemId) requireItem(recipe.burntItemId, `recipe ${recipe.id} burnt`);
  }
  for (const item of tables.items) {
    const charge = item.magicWeapon?.charge;
    if (!charge) continue;
    requireItem(charge.rechargeItemId, `magic weapon ${item.id} recharge`);
    requireItem(charge.orbItemId, `magic weapon ${item.id} Orb recipe`);
  }
  for (const enemy of tables.enemies) {
    for (const drop of enemy.drops) requireItem(drop.itemId, `enemy ${enemy.id} drop`);
  }
  for (const shop of tables.shops) {
    for (const entry of shop.stock) requireItem(entry.itemId, `shop ${shop.id} stock`);
  }
  const seen = new Set<string>();
  for (const item of tables.items) {
    if (seen.has(item.id)) problems.push(`duplicate item id "${item.id}"`);
    seen.add(item.id);
  }

  const recipeIds = new Set(tables.recipes.map((recipe) => recipe.id));
  const spellIds = new Set(tables.spells.map((spell) => spell.id));
  const enemyFamilies = new Set(tables.enemies.map((enemy) => enemy.family));
  const walkPredicate = (predicate: QuestPredicate, where: string): void => {
    if (predicate.kind === "all") {
      for (const child of predicate.of) walkPredicate(child, where);
    } else if (predicate.kind === "kill" && !enemyFamilies.has(predicate.enemyFamily)) {
      problems.push(`${where} counts kills of unknown enemy family "${predicate.enemyFamily}"`);
    }
  };
  for (const quest of QUESTS) {
    for (const stage of quest.stages) {
      const where = `quest ${quest.id} stage ${stage.index}`;
      if (stage.objective.includes("`")) problems.push(`${where} objective still prints a developer id: ${stage.objective}`);
      for (const ref of stage.refs ?? []) {
        if (ref.kind === "item" && !itemIds.has(ref.id)) problems.push(`${where} ref names unknown item "${ref.id}"`);
        if (ref.kind === "recipe" && !recipeIds.has(ref.id)) problems.push(`${where} ref names unknown recipe "${ref.id}"`);
        if (ref.kind === "spell" && !spellIds.has(ref.id)) problems.push(`${where} ref names unknown spell "${ref.id}"`);
        if (ref.kind === "enemyFamily" && !enemyFamilies.has(ref.id)) problems.push(`${where} ref names unknown enemy family "${ref.id}"`);
      }
      walkPredicate(stage.completion, where);
    }
  }
  return problems;
}

function validateQuestRefTargets(entityIds: ReadonlySet<string>, locationIds: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  for (const quest of QUESTS) {
    for (const stage of quest.stages) {
      for (const ref of stage.refs ?? []) {
        if (ref.kind === "entity" && !entityIds.has(ref.id)) {
          problems.push(`quest ${quest.id} stage ${stage.index} ref names unknown entity "${ref.id}"`);
        }
        if (ref.kind === "location" && !locationIds.has(ref.id)) {
          problems.push(`quest ${quest.id} stage ${stage.index} ref names unknown location "${ref.id}"`);
        }
      }
    }
  }
  return problems;
}

/** Throws before Vite packages a release if its canonical content has unresolved references. */
export async function validateGameContent(): Promise<GameContentValidation> {
  const manifest = JSON.parse(await readFile(path.join(gameRoot, "public/assets/manifest.json"), "utf8")) as AssetManifest;
  const verifiedSourceHashes = new Map<string, string>();
  const sourcePaths = new Set(manifest.packs.flatMap((pack) => {
    const reference = (pack as typeof pack & { sourceReference?: { file: string } }).sourceReference;
    return [pack.generatorSha256 ? pack.source : undefined, reference?.file].filter((file): file is string => file !== undefined);
  }));
  const repositoryRoot = path.resolve(gameRoot, "..");
  for (const source of sourcePaths) {
    const absolute = path.resolve(repositoryRoot, source);
    const relative = path.relative(repositoryRoot, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    try { verifiedSourceHashes.set(source, createHash("sha256").update(await readFile(absolute)).digest("hex")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const assets = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  const knownAssetIds = new Set([
    ...assets.keys(), ...ALL_PROCEDURAL_GEAR_ASSETS.map((asset) => asset.assetId),
    ...Object.values(TRAVERSAL_CONTACTS).map((asset) => asset.assetId),
  ]);
  const tables: ContentTables = {
    items: ALL_ITEMS, resources: RESOURCES, recipes: RECIPES, spells: SPELLS, enemies: ENEMIES, shops: SHOPS,
  };
  content.register(tables);
  const problems = [
    ...validateRegions(knownAssetIds).map((problem) => `regions: ${problem}`),
    ...validateContentTables(tables).map((problem) => `tables: ${problem}`),
    ...validateGatheringProduction({
      tiers: GATHERING_PRODUCTION_TIERS, resources: RESOURCES,
      additionalRecipeTiers: [...WILDERNESS_CRAFTING_TIERS, ...CROWNWARD_FISH].map(({ tier }) => ({ tier, reqLevel: tier })),
      recipes: RECIPES.filter((recipe) => !CREATURE_LOOT_RECIPES.includes(recipe)), items: ALL_ITEMS,
      knownManifestAssetIds: knownAssetIds, assetManifest: manifest,
      verifiedSourceHashes,
      clusters: REGIONS.flatMap((region) => region.clusters),
      stations: REGIONS.flatMap((region) => [...(region.settlement?.stations ?? []), ...region.stations]),
      itemAppearances: ITEM_ICON_APPEARANCE_IDS.map((id) => itemIconAppearance(id)),
    }).map((problem) => `gathering-production: ${problem}`),
  ];
  if (problems.length > 0) throw new Error(`Game content validation failed:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);

  const seed = createInitialState().meta.seed;
  const heightAt = (): number => 0;
  // Reference resolution needs the production builder and real model dimensions, but no rendered
  // terrain or WASM. Flat ground changes elevations, not the authored entity and route IDs.
  const world = buildWorld(seed, heightAt, {
    heightAt,
    baseY: (id) => assets.get(id)?.groundY ?? assets.get(id)?.base?.y ?? 0,
    assetSize: (id) => assets.get(id)?.size ?? null,
    assetCenterXZ: (id) => {
      const asset = assets.get(id);
      return asset?.base ? { x: asset.base.x + asset.size.x / 2, z: asset.base.z + asset.size.z / 2 } : null;
    },
  });
  const questProblems = validateQuestRefTargets(
    new Set(world.entities.map((entity) => entity.id)), new Set(world.routeNodes.map((node) => node.id)),
  );
  if (questProblems.length > 0) throw new Error(`Game quest target validation failed:\n${questProblems.map((problem) => `- ${problem}`).join("\n")}`);
  return { seed, assets: assets.size, items: tables.items.length, recipes: tables.recipes.length,
    entities: world.entities.length, routeLocations: world.routeNodes.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await validateGameContent()));
}

