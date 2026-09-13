import { BookOpen, Boxes, FlaskConical, Gem, Hammer, Leaf, MessageCircle, Music2, ScrollText, Shield, SlidersHorizontal, Sparkles, Store, Swords, Users, type LucideIcon } from "lucide-react";
import type { CollectionSummary } from "../../shared/contracts.js";
import { collectionName } from "../model/rows.js";

const labels: Record<string, string> = { npcs: "People", gatheringTiers: "Gathering tiers", craftingTiers: "Crafting tiers", spellRunes: "Runes", elementalSpells: "Elemental spells", sets: "Armor sets", equipmentSets: "Armor sets" };
const icons: Record<string, LucideIcon> = { items: Swords, sets: Shield, equipmentSets: Shield, recipes: Hammer, resources: Leaf, gatheringTiers: Boxes, craftingTiers: Boxes, npcs: Users, shops: Store, quests: ScrollText, dialogue: MessageCircle, spells: Sparkles, spellRunes: Gem, elementalSpells: FlaskConical, audio: Music2 };
export const labelFor = (name: string) => labels[name] ?? collectionName(name).replace(/^Balance · /, "");
export const iconFor = (name: string): LucideIcon => name.startsWith("balance/") ? SlidersHorizontal : icons[name] ?? BookOpen;
export const navigationGroups = (collections: CollectionSummary[]) => [
  { label: "World library", entries: collections.filter(c => !c.name.startsWith("balance/")) },
  { label: "Balance", entries: collections.filter(c => c.name.startsWith("balance/")) },
].filter(group => group.entries.length > 0);
export const descriptions: Record<string, string> = {
  items: "Weapons, armor, tools and everything carried through Corealm.",
  sets: "Armor pieces and the bonuses they grant together.",
  equipmentSets: "Armor pieces and the bonuses they grant together.",
  craftingTiers: "Material tiers and crafting progression.",
  recipes: "Ingredients, crafting requirements and what they produce.",
  resources: "Gathering yields, skill requirements and respawn times.",
  npcs: "The people of Corealm and their place in the world.",
  shops: "Merchants, their stock and trading requirements.",
  quests: "Objectives, requirements and rewards.",
  spells: "Spell costs, requirements and combat effects.",
  elementalSpells: "Elemental spell progression and effects.",
  spellRunes: "Rune types and their spell roles.",
  dialogue: "Conversations, choices and conditions.",
  audio: "Music, ambience and sound cues.",
  gatheringTiers: "The material progression for gathering skills.",
};
