import {
  Axe, BookOpen, Boxes, Bug, ClipboardList, Flame, FlaskConical, Gem, Hammer, Layers, Leaf, Map as MapIcon, MapPin, MessageCircle,
  Mountain, Music2, PawPrint, Route, ScrollText, Shield, Shirt, SlidersHorizontal, Sparkles, Store, Swords, TreePine, Users, Wand2,
  Workflow, type LucideIcon,
} from "lucide-react";
import type { CollectionSummary } from "../../shared/contracts.js";
import { collectionName } from "../model/rows.js";

/**
 * Navigation lists every served collection, grouped by the job it belongs to. Everything is one
 * click from the sidebar; there are no umbrella pages that hide the tables behind a second hop.
 */
export interface NavigationEntry {
  name: string;
  label: string;
  count: number;
  sources: readonly string[];
  generated?: boolean;
}

export interface NavigationGroup {
  label: string;
  entries: readonly NavigationEntry[];
  /** Collapsed by default in the sidebar. */
  quiet?: boolean;
}

interface GroupDefinition {
  label: string;
  /** Each entry is a list of alternatives; the first served name wins. */
  entries: readonly (readonly string[])[];
  quiet?: boolean;
}

const GROUPS: readonly GroupDefinition[] = [
  { label: "Items", entries: [["items"], ["equipmentSets", "sets"], ["compiled-recipes", "recipes"], ["resources", "compiled-resources"], ["campfireFuels"], ["kits"]] },
  { label: "Progression", entries: [["progression"], ["materials"], ["equipmentFamilies"], ["recipeTemplates"]] },
  { label: "Creatures", entries: [["creatureDefinitions"], ["creatureProfiles"], ["lootTables"], ["compiled-enemies"], ["compiled-species"]] },
  { label: "World", entries: [["world"], ["worldRegions"], ["encounters"], ["placements"], ["resourcePlacements"]] },
  { label: "People & Story", entries: [["npcs"], ["shops"], ["quests"], ["dialogue"]] },
  { label: "Abilities", entries: [["spells"], ["spellRunes"], ["elementalSpells"]] },
  { label: "Assets", entries: [["assets"], ["audio"]] },
  { label: "Balance", entries: [["formulas"], ["balance/recipes"], ["balance/sets"], ["balance/campfires"], ["balance/formation"]] },
];

/** Pages that exist without a server collection behind them. */
const VIRTUAL_PAGES = new Set(["kits", "world", "formulas", "work-queue", "requests", "review"]);
/** Sources that are folded into another page rather than listed on their own. */
const HIDDEN_SOURCES = new Set(["compiled-items"]);

const labels: Record<string, string> = {
  items: "Items",
  "compiled-items": "Items (generated)",
  "compiled-recipes": "Recipes",
  recipes: "Recipes",
  "compiled-resources": "Resources",
  resources: "Resources",
  "compiled-enemies": "Enemy stats",
  "compiled-species": "Species",
  equipmentSets: "Armour sets",
  sets: "Armour sets",
  campfireFuels: "Campfire fuels",
  kits: "Kit ladder",
  progression: "Tiers",
  materials: "Materials",
  equipmentFamilies: "Equipment families",
  recipeTemplates: "Recipe templates",
  creatureDefinitions: "Creatures",
  creatureProfiles: "Combat profiles",
  lootTables: "Loot tables",
  world: "World map",
  worldRegions: "Regions",
  encounters: "Encounters",
  placements: "Placements",
  resourcePlacements: "Resource nodes",
  npcs: "NPCs",
  shops: "Shops",
  quests: "Quests",
  dialogue: "Dialogue",
  spells: "Spells",
  spellRunes: "Runes",
  elementalSpells: "Elemental spells",
  assets: "Models",
  audio: "Audio",
  formulas: "Formulas",
  "balance/recipes": "Recipe balance",
  "balance/sets": "Set balance",
  "balance/campfires": "Campfire balance",
  "balance/formation": "Formation balance",
  "work-queue": "Work queue",
  requests: "Requests",
  review: "Review",
};

const icons: Record<string, LucideIcon> = {
  items: Swords,
  "compiled-items": Swords,
  "compiled-recipes": Hammer,
  recipes: Hammer,
  "compiled-resources": Leaf,
  resources: Leaf,
  "compiled-enemies": Bug,
  "compiled-species": PawPrint,
  equipmentSets: Shirt,
  sets: Shirt,
  campfireFuels: Flame,
  kits: Layers,
  progression: Workflow,
  materials: Gem,
  equipmentFamilies: Shield,
  recipeTemplates: Hammer,
  creatureDefinitions: PawPrint,
  creatureProfiles: Swords,
  lootTables: Boxes,
  world: MapIcon,
  worldRegions: Mountain,
  encounters: Route,
  placements: MapPin,
  resourcePlacements: TreePine,
  npcs: Users,
  shops: Store,
  quests: ScrollText,
  dialogue: MessageCircle,
  spells: Wand2,
  spellRunes: Gem,
  elementalSpells: FlaskConical,
  assets: Boxes,
  audio: Music2,
  formulas: SlidersHorizontal,
  "work-queue": ClipboardList,
  requests: ClipboardList,
  review: ClipboardList,
  home: BookOpen,
  tools: Axe,
};

export const descriptions: Record<string, string> = {
  items: "Every carried thing: equipment, materials, food, tools.",
  "compiled-recipes": "Generated from progression tiers and recipe templates.",
  resources: "Ore, trees and fishing spots and what they yield.",
  equipmentSets: "Five-piece armour sets and their threshold bonuses.",
  campfireFuels: "Logs that build campfires.",
  kits: "Weapons, tools and armour by tier.",
  progression: "One row per tier: materials, families and production.",
  materials: "Named material slots that map to items.",
  equipmentFamilies: "Formula-driven stat families for generated gear.",
  recipeTemplates: "Formula-driven production templates.",
  creatureDefinitions: "Creature identity, presentation, combat and drops.",
  creatureProfiles: "Stat curves shared by creature roles.",
  lootTables: "Shared drop tables.",
  "compiled-enemies": "Resolved combat stats for every creature.",
  "compiled-species": "Resolved species with models and regions.",
  world: "Place encounters and adjust formations on the map.",
  worldRegions: "Region bounds, locations, roads and settlements.",
  encounters: "Creature groups and their activity.",
  placements: "Where encounters spawn.",
  resourcePlacements: "Where resource nodes cluster.",
  npcs: "People, their dialogue and quests.",
  shops: "Stock and trade multipliers.",
  quests: "Stages, objectives and rewards.",
  dialogue: "Conversation nodes and options.",
  spells: "Element, rung, cost and damage.",
  spellRunes: "Rune items used by spells.",
  elementalSpells: "Elemental spell progression.",
  assets: "GLB models in the manifest.",
  audio: "Cues, loops and region music.",
  formulas: "Formula profiles, inputs and consumers.",
  "work-queue": "Requests, local changes and validation.",
};

export const labelFor = (name: string): string => labels[name] ?? collectionName(name).replace(/^Balance Â· /, "Balance / ");
export const iconFor = (name: string): LucideIcon => name.startsWith("balance/") ? SlidersHorizontal : icons[name] ?? Boxes;
export const isVirtualPage = (name: string): boolean => VIRTUAL_PAGES.has(name);
export const isGeneratedCollection = (name: string): boolean => name.startsWith("compiled-");

export function navigationGroups(collections: readonly CollectionSummary[]): NavigationGroup[] {
  const byName = new Map(collections.map(collection => [collection.name, collection]));
  const placed = new Set<string>();
  const groups: NavigationGroup[] = [];
  for (const definition of GROUPS) {
    const entries: NavigationEntry[] = [];
    for (const alternatives of definition.entries) {
      // Prefer an authored table when it has rows; fall back to the generated catalog otherwise.
      const served = alternatives.filter(name => byName.has(name) || VIRTUAL_PAGES.has(name));
      const name = served.find(candidate => !isGeneratedCollection(candidate) && (byName.get(candidate)?.count ?? 1) > 0) ?? served[0];
      if (!name) continue;
      alternatives.forEach(alternative => placed.add(alternative));
      const summary = byName.get(name);
      const count = name === "items" ? Math.max(summary?.count ?? 0, byName.get("compiled-items")?.count ?? 0) : summary?.count ?? 0;
      entries.push({ name, label: labelFor(name), count, sources: served, generated: isGeneratedCollection(name) });
    }
    if (entries.length) groups.push({ label: definition.label, entries, quiet: definition.quiet });
  }
  const rest = collections.filter(collection => !placed.has(collection.name) && !HIDDEN_SOURCES.has(collection.name));
  if (rest.length) groups.push({ label: "Other", entries: rest.map(collection => ({ name: collection.name, label: labelFor(collection.name), count: collection.count, sources: [collection.name], generated: isGeneratedCollection(collection.name) })), quiet: true });
  return groups;
}

/** The group a collection belongs to, for breadcrumbs and the home page. */
export function groupFor(name: string): string | undefined {
  return GROUPS.find(group => group.entries.some(alternatives => alternatives.includes(name)))?.label;
}

export function taskDescription(task: string): string {
  return descriptions[task] ?? "";
}

/** Resolve a page name to the first served collection behind it. */
export function taskSource(task: string, collections: readonly CollectionSummary[]): string | undefined {
  const group = GROUPS.flatMap(definition => definition.entries).find(alternatives => alternatives.includes(task));
  const candidates = group ?? [task];
  return candidates.find(candidate => collections.some(collection => collection.name === candidate));
}
