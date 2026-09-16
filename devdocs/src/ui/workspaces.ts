import { Boxes, Home, Map as MapIcon, PawPrint, ScrollText, SlidersHorizontal, Sparkles, Store, Swords, Users, type LucideIcon } from "lucide-react";

/*
  Navigation is nine workspaces, each with a few views. A view is either a purpose-built page
  (registered by the workspace folder) or a collection browsed with the generic list and record
  page. Routes are `#/<workspace>/<view>/<id?>`. Old `#/<collection>/<id>` links redirect.
*/

export interface WorkspaceView {
  key: string;
  label: string;
  /** The collection this view browses when no purpose-built page is registered. */
  collection?: string;
  /** Collections whose old links land on this view. */
  aliases?: readonly string[];
  /** Hidden from the tab strip; reachable by route or alias only. */
  hidden?: boolean;
}

export interface Workspace {
  key: string;
  label: string;
  icon: LucideIcon;
  views: readonly WorkspaceView[];
  /** The map takes the whole content area with its own rails. */
  fullBleed?: boolean;
  /** Only in the editor build. */
  devOnly?: boolean;
}

export const WORKSPACES: readonly Workspace[] = [
  { key: "home", label: "Home", icon: Home, views: [
    { key: "overview", label: "Overview" },
    { key: "requests", label: "Requests", aliases: ["work-queue", "requests"] },
    { key: "changes", label: "Local changes", aliases: ["review"] },
  ] },
  { key: "items", label: "Items", icon: Swords, views: [
    { key: "ladder", label: "Ladder", aliases: ["kits"] },
    { key: "catalog", label: "Catalog", collection: "items", aliases: ["compiled-items"] },
    { key: "sets", label: "Sets", collection: "equipmentSets", aliases: ["sets"] },
    { key: "recipes", label: "Recipes", collection: "compiled-recipes", aliases: ["recipes"] },
    { key: "resources", label: "Resources", collection: "resources", aliases: ["compiled-resources"] },
    { key: "fuels", label: "Fuels", collection: "campfireFuels" },
  ] },
  { key: "creatures", label: "Creatures", icon: PawPrint, views: [
    { key: "bestiary", label: "Bestiary", collection: "creatureDefinitions", aliases: ["compiled-enemies", "compiled-species", "creatures", "enemies"] },
    { key: "loot", label: "Loot tables", collection: "lootTables" },
  ] },
  { key: "world", label: "World", icon: MapIcon, fullBleed: true, views: [
    { key: "map", label: "Map", aliases: ["worldRegions", "placements", "encounters", "resourcePlacements"] },
  ] },
  { key: "quests", label: "Quests", icon: ScrollText, views: [
    { key: "quests", label: "Quests", collection: "quests" },
  ] },
  // A conversation belongs to the people who speak it, so dialogue nodes browse beside the NPCs.
  { key: "npcs", label: "NPCs", icon: Users, views: [
    { key: "npcs", label: "NPCs", collection: "npcs" },
    { key: "dialogue", label: "Dialogue", collection: "dialogue" },
  ] },
  { key: "shops", label: "Shops", icon: Store, views: [
    { key: "shops", label: "Shops", collection: "shops" },
  ] },
  { key: "spells", label: "Spells", icon: Sparkles, views: [
    { key: "spells", label: "Spells", collection: "spells" },
    { key: "runes", label: "Runes", collection: "spellRunes" },
    { key: "elemental", label: "Elemental", collection: "elementalSpells" },
  ] },
  { key: "assets", label: "Assets", icon: Boxes, views: [
    { key: "models", label: "Models", collection: "assets" },
    { key: "audio", label: "Audio", collection: "audio" },
  ] },
  { key: "tuning", label: "Tuning", icon: SlidersHorizontal, devOnly: true, views: [
    { key: "formulas", label: "Formulas", aliases: ["formulas"] },
    { key: "families", label: "Equipment families", collection: "equipmentFamilies" },
    { key: "templates", label: "Recipe templates", collection: "recipeTemplates" },
    { key: "roles", label: "Combat roles", collection: "creatureProfiles" },
    { key: "tiers", label: "Tiers", collection: "progression" },
    { key: "materials", label: "Materials", collection: "materials" },
    { key: "recipe-balance", label: "Recipe balance", collection: "balance/recipes" },
    { key: "set-balance", label: "Set balance", collection: "balance/sets" },
    { key: "campfire-balance", label: "Campfire balance", collection: "balance/campfires" },
    { key: "formation-balance", label: "Formation balance", collection: "balance/formation" },
    { key: "fields", label: "Fields", hidden: true },
  ] },
];

export interface Route { workspace: Workspace; view: WorkspaceView; id?: string }

const byKey = new Map(WORKSPACES.map(workspace => [workspace.key, workspace]));

export function workspaceFor(key: string | undefined): Workspace | undefined { return key ? byKey.get(key) : undefined; }

/** The view that owns a collection, either as its browser or through an alias. */
export function viewForCollection(collection: string): { workspace: Workspace; view: WorkspaceView } | undefined {
  for (const workspace of WORKSPACES) {
    const view = workspace.views.find(candidate => candidate.collection === collection) ?? workspace.views.find(candidate => candidate.aliases?.includes(collection));
    if (view) return { workspace, view };
  }
  return undefined;
}

/** Parse `#/a/b/c` segments. Accepts workspace routes and old collection routes. */
export function parseRoute(segments: readonly string[]): Route {
  const home = byKey.get("home")!;
  const [first, second, third] = segments;
  if (!first) return { workspace: home, view: home.views[0]! };
  // Quests, NPCs, dialogue and shops were one "Story" workspace; its links land on their own now.
  if (first === "story") return second ? parseRoute(segments.slice(1)) : parseRoute(["quests"]);
  const workspace = byKey.get(first);
  if (workspace) {
    const view = second ? workspace.views.find(candidate => candidate.key === second) : undefined;
    if (view) return { workspace, view, id: third };
    // `#/items/<id>` without a view: treat the second segment as a record in the default browsing view.
    const browsing = workspace.views.find(candidate => candidate.collection) ?? workspace.views[0]!;
    return { workspace, view: second ? browsing : workspace.views[0]!, id: second };
  }
  // Legacy collection route, including `balance/<kind>`.
  const collection = first === "balance" && second ? `balance/${second}` : first;
  const id = first === "balance" && second ? third : second;
  const owner = viewForCollection(collection);
  if (owner) return { workspace: owner.workspace, view: owner.view, id: aliasId(owner.view, collection, id) };
  return { workspace: home, view: home.views[0]! };
}

/** Ids under an alias keep their collection unless the alias is just another table of the same records. */
function aliasId(view: WorkspaceView, collection: string, id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  if (view.collection === collection || collection.startsWith("compiled-") || view.collection) return id;
  return `${collection}:${id}`;
}

/** Build a route path from a workspace/collection name and optional record id. */
export function routePath(target: string | undefined, id?: string): string {
  if (!target) return "/";
  // A record id means a collection, even when a workspace shares the name (items, spells, assets).
  const workspace = id === undefined || !viewForCollection(target) ? byKey.get(target) : undefined;
  if (workspace) {
    const view = workspace.views[0]!;
    return id ? `/${workspace.key}/${view.key}/${id}` : `/${workspace.key}`;
  }
  const dotted = target.split("/");
  if (dotted.length === 2 && byKey.has(dotted[0]!)) return id ? `/${target}/${id}` : `/${target}`;
  const owner = viewForCollection(target);
  if (!owner) return `/${target}${id ? `/${id}` : ""}`;
  if (owner.view.collection === target) return id ? `/${owner.workspace.key}/${owner.view.key}/${id}` : `/${owner.workspace.key}/${owner.view.key}`;
  const scoped = aliasId(owner.view, target, id);
  return scoped ? `/${owner.workspace.key}/${owner.view.key}/${scoped}` : `/${owner.workspace.key}/${owner.view.key}`;
}

export const workspaceLabel = (key: string): string => byKey.get(key)?.label ?? key;
