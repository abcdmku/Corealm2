import {
  Boxes,
  FlaskConical,
  Gem,
  Hammer,
  Leaf,
  Map as MapIcon,
  MessageCircle,
  Music2,
  ScrollText,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Store,
  Swords,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { CollectionSummary } from "../../shared/contracts.js";
import { collectionName } from "../model/rows.js";

/**
 * Navigation is organized around authoring jobs rather than the files in game/content/data.
 * `sources` keeps the grouping useful while a domain moves from its old tables to its unified
 * definition. The first available source is the route target, and the count sums the related
 * records so an author can see how much content belongs to that job.
 */
export interface NavigationEntry {
  name: string;
  label: string;
  count: number;
  sources: readonly string[];
}

export interface NavigationGroup {
  label: string;
  entries: readonly NavigationEntry[];
}

interface TaskDefinition {
  label: string;
  route: string;
  sources: readonly string[];
  description: string;
  icon: LucideIcon;
}

const taskDefinitions: readonly TaskDefinition[] = [
  {
    label: "Progression",
    route: "progression",
    sources: ["progression", "materials", "equipmentFamilies", "recipeTemplates", "compiled-resources", "resources"],
    description: "Tiers, materials, production families, and unlocks in one working view.",
    icon: Workflow,
  },
  {
    label: "Items",
    route: "items",
    sources: ["compiled-items", "compiled-recipes", "compiled-resources", "items", "equipmentSets", "sets", "recipes", "kits"],
    description: "Equipment, recipes, sets, and kits that share item identities.",
    icon: Swords,
  },
  {
    label: "Creatures",
    route: "creatureDefinitions",
    sources: ["creatureDefinitions", "creatureProfiles", "lootTables"],
    description: "Creature definitions, variants, combat profiles, drops, and availability.",
    icon: Sparkles,
  },
  {
    label: "World",
    route: "world",
    sources: ["encounters", "placements", "worldPlacements", "resourcePlacements", "resourceClusters", "resources"],
    description: "Encounters, placements, resource nodes, and their map relationships.",
    icon: MapIcon,
  },
  {
    label: "People & Story",
    route: "npcs",
    sources: ["npcs", "shops", "quests", "dialogue"],
    description: "NPCs, shops, quests, and dialogue that move the story forward.",
    icon: Users,
  },
  {
    label: "Abilities",
    route: "spells",
    sources: ["spells", "spellRunes", "elementalSpells"],
    description: "Spells, runes, costs, requirements, and combat effects.",
    icon: FlaskConical,
  },
  {
    label: "Assets",
    route: "assets",
    sources: ["assets", "audio"],
    description: "Models, icons, audio, and the records that use them.",
    icon: Gem,
  },
];

const labels: Record<string, string> = {
  progression: "Progression",
  materials: "Materials",
  "compiled-items": "Compiled items",
  "compiled-recipes": "Compiled recipes",
  "compiled-resources": "Compiled resources",
  equipmentFamilies: "Equipment families",
  recipeTemplates: "Recipe templates",
  creatureDefinitions: "Creature definitions",
  encounters: "Encounters",
  worldPlacements: "World placements",
  resourceClusters: "Resource clusters",
  world: "World",
  peopleStory: "People & Story",
  abilities: "Abilities",
  assets: "Assets",
  formulas: "Formulas",
  kits: "Kits",
  workQueue: "Work queue",
  "work-queue": "Work queue",
  npcs: "People",
  spellRunes: "Runes",
  elementalSpells: "Elemental spells",
  sets: "Armor sets",
  equipmentSets: "Armor sets",
};

const icons: Record<string, LucideIcon> = {
  items: Swords,
  "compiled-items": Swords,
  "compiled-recipes": Hammer,
  "compiled-resources": Leaf,
  sets: Shield,
  equipmentSets: Shield,
  recipes: Hammer,
  resources: Leaf,
  resourceClusters: Leaf,
  progression: Workflow,
  materials: Leaf,
  equipmentFamilies: Shield,
  recipeTemplates: Hammer,
  creatures: Sparkles,
  creatureDefinitions: Sparkles,
  creatureProfiles: Sparkles,
  encounters: MapIcon,
  placements: MapIcon,
  worldPlacements: MapIcon,
  resourcePlacements: Leaf,
  npcs: Users,
  shops: Store,
  quests: ScrollText,
  dialogue: MessageCircle,
  spells: Sparkles,
  spellRunes: Gem,
  elementalSpells: FlaskConical,
  audio: Music2,
  assets: Gem,
  formulas: SlidersHorizontal,
  kits: Shield,
};

export const labelFor = (name: string): string => labels[name] ?? collectionName(name).replace(/^Balance Â· /, "Balance / ");

export const iconFor = (name: string): LucideIcon => name.startsWith("balance/") ? SlidersHorizontal : icons[name] ?? Boxes;

/** Resolve a task route to the first collection that is available in this server snapshot. */
export function taskSource(task: string, collections: readonly CollectionSummary[]): string | undefined {
  const definition = taskDefinitions.find(candidate => candidate.route === task || candidate.label === task);
  if (!definition) return collections.some(collection => collection.name === task) ? task : undefined;
  return definition.sources.find(source => collections.some(collection => collection.name === source));
}

export function taskDefinition(task: string): TaskDefinition | undefined {
  return taskDefinitions.find(candidate => candidate.route === task || candidate.label === task);
}

/**
 * Return only the seven authoring areas. Legacy tables stay discoverable through the area route
 * and search, but they no longer take over the sidebar as if each file were a separate task.
 */
export function navigationGroups(collections: CollectionSummary[]): NavigationGroup[] {
  const byName = new Map(collections.map(collection => [collection.name, collection]));
  const groups: NavigationGroup[] = [];
  for (const definition of taskDefinitions) {
    const available = definition.sources.filter(source => byName.has(source));
    if (!available.length) continue;
    // Progression owns the combined page and keeps one stable URL while its related definitions
    // are still being authored in separate collections.
    const route = definition.route === "progression" || definition.route === "world" || byName.has(definition.route) ? definition.route : available[0]!;
    // Runtime compiled catalogs contain the authored rows as well as generated rows. Prefer
    // them when they exist so generated gear and recipes are included once rather than adding
    // a second copy of the authored count.
    const preferredSources = definition.route === "items"
      ? [["compiled-items", "items"], ["compiled-recipes", "recipes"], ["compiled-resources", "resources"], ["equipmentSets", "sets"]]
      : definition.route === "progression"
        ? [["compiled-resources", "resources"]]
        : [];
    const counted = new Set<string>();
    const count = preferredSources.reduce((sum, candidates) => {
      const source = candidates.find(candidate => available.includes(candidate));
      if (!source) return sum;
      counted.add(source);
      return sum + (byName.get(source)?.count ?? 0);
    }, 0) + available.reduce((sum, source) => counted.has(source) ? sum : sum + (byName.get(source)?.count ?? 0), 0);
    const entry: NavigationEntry = { name: route, label: definition.label, count, sources: available };
    groups.push({ label: definition.label, entries: [entry] });
  }
  return groups;
}

export const descriptions: Record<string, string> = {
  progression: "Tiers, materials, production families, and unlocks in one working view.",
  materials: "Materials and the item identities they produce.",
  equipmentFamilies: "Reusable equipment families selected by progression tiers.",
  recipeTemplates: "Recipe templates for repeated processing and production.",
  items: "Weapons, armor, tools and everything carried through Corealm.",
  sets: "Armor pieces and the bonuses they grant together.",
  equipmentSets: "Armor pieces and the bonuses they grant together.",
  recipes: "Ingredients, crafting requirements and what they produce.",
  kits: "Weapons, tools, and armor sets grouped by progression tier.",
  creatureDefinitions: "Creature identity, presentation, combat profile, drops, and availability.",
  creatures: "Creature identity, presentation, combat profile, drops, and availability.",
  enemies: "Combat profiles used by creature definitions and encounters.",
  lootTables: "Shared and creature-specific drop tables.",
  world: "Encounters, placements, resource nodes, and their map relationships.",
  encounters: "Reusable encounter compositions and population rules.",
  worldPlacements: "Authored locations and formations in the world.",
  resourceClusters: "Resource nodes and their placement on the map.",
  resources: "Gathering yields, skill requirements and respawn times.",
  npcs: "The people of Corealm and their place in the world.",
  shops: "Merchants, their stock and trading requirements.",
  quests: "Objectives, requirements and rewards.",
  dialogue: "Conversations, choices and conditions.",
  spells: "Spell costs, requirements and combat effects.",
  elementalSpells: "Elemental spell progression and effects.",
  spellRunes: "Rune types and their spell roles.",
  assets: "Models, icons, audio, and the records that use them.",
  audio: "Music, ambience and sound cues.",
  formulas: "Typed formulas, profiles, inputs, consumers, and impact previews.",
  formulasWorkspace: "Typed formulas, profiles, inputs, consumers, and impact previews.",
  "work-queue": "Requests, changed files, validation, and review in one place.",
  requests: "Requests, changed files, validation, and review in one place.",
  review: "Requests, changed files, validation, and review in one place.",
};

export function taskDescription(task: string): string {
  return taskDefinition(task)?.description ?? descriptions[task] ?? "Browse records and inspect their details.";
}
