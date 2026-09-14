import {
  Anvil, Axe, Bird, Boxes, Bug, Cat, Crown, Droplets, Fish, Flame, FlaskConical, Ghost, Hammer, Leaf, MapPin, MessageCircle, Mountain,
  Music2, PawPrint, Pickaxe, Rabbit, Rat, Route, ScrollText, Shield, Shirt, Skull, SlidersHorizontal, Snail, Sparkles, Store, Swords,
  TreePine, Turtle, User, Users, Wand2, Wind, Workflow, Film, Box, Home, Sword, Waves, type LucideIcon,
} from "lucide-react";
import type { ContentRow } from "./contracts.js";
import { rowId, rowName } from "./rows.js";

/*
  Visual summaries for every collection: what to draw as the thumbnail, what to say in one line,
  which badges matter, and which facets a browser should filter on. This is the one place that
  knows the shape of each record type well enough to be visual about it.
*/

export type Tone = "accent" | "ok" | "warn" | "danger" | "info" | undefined;
export interface Badge { text: string; tone?: Tone; mono?: boolean; title?: string }
export type ThumbSpec =
  | { kind: "item"; id: string }
  | { kind: "items"; ids: readonly string[] }
  | { kind: "glyph"; icon: LucideIcon; hue?: number; letter?: string }
  | { kind: "map"; x: number; z: number; span: number; icon?: LucideIcon }
  | { kind: "asset"; assetId: string; icon: LucideIcon; hue?: number };

export interface Stat { label: string; value: string; title?: string }
export interface RecordSummary {
  title: string;
  subtitle?: string;
  badges: Badge[];
  thumb: ThumbSpec;
  /** Key numbers for hover cards and headers. */
  stats: Stat[];
  /** A sortable, groupable tier or level when the record has one. */
  tier?: number;
}

export interface FacetDefinition { key: string; label: string; value: (row: ContentRow, ctx: SummaryContext) => string | undefined }

export interface SummaryContext {
  /** Look a record up in another collection; the first served alias that has it wins. */
  lookup: (kind: string, id: string) => ContentRow | undefined;
}

export const noContext: SummaryContext = { lookup: () => undefined };

const asRecord = (value: unknown): ContentRow => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ContentRow : {};
const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value : undefined;
const num = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const titleCase = (value: string): string => value.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());

export function hueFor(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash % 360;
}

const ELEMENT_HUE: Record<string, number> = { wind: 165, water: 205, earth: 38, fire: 14 };
const ELEMENT_ICON: Record<string, LucideIcon> = { wind: Wind, water: Droplets, earth: Mountain, fire: Flame };
const SLOT_ICON: Record<string, LucideIcon> = { head: Shield, body: Shirt, legs: Shirt, feet: Shirt, hands: Shirt, mainHand: Sword, offHand: Shield };
const SKILL_ICON: Record<string, LucideIcon> = { mining: Pickaxe, woodcutting: Axe, fishing: Fish, smithing: Anvil, crafting: Hammer, cooking: Flame, fletching: Axe, melee: Swords, magic: Wand2, agility: Route };
const ASSET_ICON: Record<string, LucideIcon> = { character: User, outfit: Shirt, weapon: Sword, nature: TreePine, rock: Mountain, building: Home, prop: Box, farm: Leaf, dungeon: Skull, animation: Film, water: Waves };

export function creatureIcon(row: ContentRow): LucideIcon {
  const presentation = asRecord(row.presentation);
  const words = `${text(row.family) ?? ""} ${text(row.id) ?? ""} ${text(presentation.bodyFamily) ?? ""} ${text(presentation.movement) ?? ""}`.toLowerCase();
  if (row.rank === "boss" || row.profileId === "boss") return Crown;
  if (/spider|wasp|bee|roach|beetle|ant|arthropod|scorpion|moth/.test(words)) return Bug;
  if (/skeleton|zombie|bone|lich|revenant/.test(words)) return Skull;
  if (/wraith|ghost|spirit|shade|phantom|wisp/.test(words)) return Ghost;
  if (/bird|harpy|crow|owl|hawk|raven|flying|bat/.test(words)) return Bird;
  if (/fish|eel|pike|trout/.test(words)) return Fish;
  if (/rat|mouse|vole/.test(words)) return Rat;
  if (/frog|toad|turtle|newt|salamander/.test(words)) return Turtle;
  if (/snail|slug/.test(words)) return Snail;
  if (/rabbit|hare/.test(words)) return Rabbit;
  if (/cat|lynx|panther/.test(words)) return Cat;
  if (/goblin|orc|troll|gnoll|lizardman|minotaur|golem|biped|bandit|cultist/.test(words)) return User;
  return PawPrint;
}

const numberText = (value: number): string => Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
export const percent = (value: number): string => `${numberText(Number((value * 100).toFixed(1)))}%`;
export function rangeText(value: unknown): string {
  if (typeof value === "number") return numberText(value);
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number") return value[0] === value[1] ? numberText(value[0]) : `${numberText(value[0])}–${numberText(value[1])}`;
  return "";
}

function itemBadges(row: ContentRow): Badge[] {
  const badges: Badge[] = [];
  const category = text(row.category);
  const equip = asRecord(row.equip);
  const slot = text(equip.slot);
  if (slot) badges.push({ text: titleCase(slot) });
  else if (category) badges.push({ text: titleCase(category) });
  const tool = asRecord(row.tool);
  if (text(tool.skill)) badges.push({ text: titleCase(text(tool.skill)!), tone: "info" });
  const magic = asRecord(row.magicWeapon);
  if (text(magic.kind)) badges.push({ text: titleCase(text(magic.kind)!), tone: "info" });
  if (row.__compiled === true) badges.push({ text: "Generated", tone: "warn" });
  return badges;
}

function itemStats(row: ContentRow): Stat[] {
  const stats: Stat[] = [];
  const value = num(row.value);
  if (value !== undefined) stats.push({ label: "Value", value: value.toLocaleString() });
  const equip = asRecord(row.equip);
  const bonuses = asRecord(equip.bonuses);
  for (const [key, bonus] of Object.entries(bonuses)) if (typeof bonus === "number" && bonus !== 0) stats.push({ label: titleCase(key), value: numberText(bonus) });
  const requires = asRecord(equip.requires);
  for (const [skill, level] of Object.entries(requires)) if (typeof level === "number") stats.push({ label: `Req. ${titleCase(skill)}`, value: numberText(level) });
  if (num(equip.attackSpeedMs) !== undefined) stats.push({ label: "Speed", value: `${equip.attackSpeedMs} ms` });
  const food = asRecord(row.food);
  if (num(food.healAmount) !== undefined) stats.push({ label: "Heals", value: numberText(food.healAmount as number) });
  const tool = asRecord(row.tool);
  if (num(tool.gatherBonus) !== undefined) stats.push({ label: "Gather bonus", value: numberText(tool.gatherBonus as number) });
  return stats;
}

function creatureSummary(row: ContentRow, ctx: SummaryContext, resolved?: ContentRow): RecordSummary {
  const presentation = asRecord(row.presentation);
  const stats = resolved ?? ctx.lookup("enemy-stats", rowId(row)) ?? asRecord(row.stats);
  // Variants inherit their name, family and profile from the base creature they extend.
  const base = text(row.baseId) ? ctx.lookup("enemy", text(row.baseId)!) : undefined;
  const family = text(row.family) ?? text(stats.family) ?? text(base?.family);
  const profileId = text(row.profileId) ?? text(base?.profileId);
  const level = num(row.level) ?? num(stats.tier) ?? num(row.tier);
  const assetId = text(row.assetId) ?? text(presentation.assetId) ?? text(asRecord(base?.presentation).assetId);
  const icon = creatureIcon({ ...base, ...row, family });
  const hue = hueFor(family ?? rowId(row));
  const badges: Badge[] = [];
  if (family) badges.push({ text: titleCase(family) });
  if (profileId) badges.push({ text: titleCase(profileId), tone: "info" });
  if (row.rank === "boss" || profileId === "boss") badges.push({ text: "Boss", tone: "danger" });
  if (text(row.availability) && row.availability !== "world") badges.push({ text: titleCase(text(row.availability)!), tone: "warn" });
  if (text(presentation.acceptance) && presentation.acceptance !== "accepted") badges.push({ text: titleCase(text(presentation.acceptance)!), tone: "warn" });
  if (text(row.regionId) ?? text(presentation.regionId)) badges.push({ text: titleCase((text(row.regionId) ?? text(presentation.regionId))!), mono: false });
  const statList: Stat[] = [];
  for (const [key, label] of [["maxHealth", "Health"], ["maxHit", "Max hit"], ["accuracy", "Accuracy"], ["armour", "Armour"], ["attackSpeedMs", "Speed"], ["aggroRadius", "Aggro"]] as const) {
    const value = num(stats[key]);
    if (value !== undefined) statList.push({ label, value: key === "attackSpeedMs" ? `${value} ms` : numberText(value) });
  }
  const loot = asRecord(row.loot);
  const drops = list(loot.drops).length ? list(loot.drops) : list(row.drops).length ? list(row.drops) : list(stats.drops);
  const tableId = text(loot.tableId);
  const table = tableId ? ctx.lookup("lootTable", tableId) : undefined;
  const dropCount = drops.length || list(table?.drops).length;
  if (dropCount) statList.push({ label: "Drops", value: String(dropCount) });
  return {
    title: text(row.name) ?? text(stats.name) ?? (base ? rowName(base) : rowName(row)),
    subtitle: [level !== undefined ? `Level ${level}` : undefined, text(presentation.habitat) ?? text(row.description)?.slice(0, 80) ?? (base && !text(row.name) ? `Variant of ${rowName(base)} · ${rowId(row)}` : undefined)].filter(Boolean).join(" · "),
    badges,
    thumb: assetId ? { kind: "asset", assetId, icon, hue } : { kind: "glyph", icon, hue },
    stats: statList,
    tier: level,
  };
}

function mapThumb(centre: unknown, radius: unknown, icon?: LucideIcon): ThumbSpec | undefined {
  const point = Array.isArray(centre) && centre.length === 2 && typeof centre[0] === "number" && typeof centre[1] === "number" ? centre as [number, number] : undefined;
  if (!point) return undefined;
  return { kind: "map", x: point[0], z: point[1], span: Math.max(60, (num(radius) ?? 10) * 6), icon };
}

function regionThumb(row: ContentRow): ThumbSpec {
  const bounds = asRecord(row.bounds);
  const min = list(bounds.min), max = list(bounds.max);
  if (min.length === 2 && max.length === 2 && typeof min[0] === "number" && typeof max[0] === "number" && typeof min[1] === "number" && typeof max[1] === "number") {
    return { kind: "map", x: (min[0] + max[0]) / 2, z: (min[1] + max[1]) / 2, span: Math.max(max[0] - min[0], max[1] - min[1]) * 1.1 };
  }
  return { kind: "glyph", icon: Mountain, hue: hueFor(rowId(row)) };
}

export function summarize(collection: string, row: ContentRow, ctx: SummaryContext = noContext): RecordSummary {
  const id = rowId(row);
  const name = rowName(row);
  const base = collection.replace(/^compiled-/, "");
  switch (base) {
    case "items": {
      const equip = asRecord(row.equip);
      const requirement = Object.entries(asRecord(equip.requires)).filter(([, level]) => typeof level === "number").map(([skill, level]) => `${titleCase(skill)} ${level}`).join(" · ");
      return { title: name, subtitle: requirement || text(row.description)?.slice(0, 90), badges: itemBadges(row), thumb: { kind: "item", id }, stats: itemStats(row), tier: num(row.tier) };
    }
    case "materials": {
      const itemId = text(row.itemId);
      return { title: name, subtitle: itemId ? rowName(ctx.lookup("item", itemId) ?? { id: itemId }) : undefined, badges: [], thumb: itemId ? { kind: "item", id: itemId } : { kind: "glyph", icon: Boxes }, stats: [] };
    }
    case "spellRunes": {
      const itemId = text(row.itemId) ?? id;
      return { title: name, subtitle: text(row.description)?.slice(0, 90), badges: [], thumb: { kind: "item", id: itemId }, stats: [], tier: num(row.tier) };
    }
    case "campfireFuels": {
      const itemId = text(row.logItemId) ?? id;
      const item = ctx.lookup("item", itemId);
      return { title: item ? rowName(item) : titleCase(itemId), subtitle: `Burns ${Math.round((num(row.lifetimeMs) ?? 0) / 1000)} s`, badges: [], thumb: { kind: "item", id: itemId }, stats: [{ label: "Build", value: `${num(row.buildTimeMs) ?? 0} ms` }, { label: "Lifetime", value: `${Math.round((num(row.lifetimeMs) ?? 0) / 1000)} s` }], tier: num(row.tier) };
    }
    case "recipes": {
      const output = asRecord(row.output);
      const outputId = text(output.itemId);
      const inputs = list(row.inputs).map(asRecord);
      const badges: Badge[] = [];
      if (text(row.kind)) badges.push({ text: titleCase(text(row.kind)!) });
      if (text(row.skill)) badges.push({ text: `${titleCase(text(row.skill)!)} ${num(row.reqLevel) ?? ""}`.trim(), tone: "info" });
      if (row.__compiled === true) badges.push({ text: "Generated", tone: "warn" });
      return {
        title: name,
        subtitle: inputs.map(input => `${rowName(ctx.lookup("item", text(input.itemId) ?? "") ?? { id: text(input.itemId) ?? "?" })} ×${num(input.quantity) ?? 1}`).join(" + "),
        badges,
        thumb: outputId ? { kind: "item", id: outputId } : { kind: "glyph", icon: Hammer },
        stats: [{ label: "XP", value: numberText(num(row.xp) ?? 0) }, { label: "Time", value: `${num(row.durationMs) ?? 0} ms` }, { label: "Stations", value: list(row.stations).map(String).map(titleCase).join(", ") || "Anywhere" }],
        tier: num(row.tier),
      };
    }
    case "resources": {
      const itemId = text(row.itemId);
      const badges: Badge[] = [];
      if (text(row.archetype)) badges.push({ text: titleCase(text(row.archetype)!) });
      if (text(row.skill)) badges.push({ text: `${titleCase(text(row.skill)!)} ${num(row.reqLevel) ?? ""}`.trim(), tone: "info" });
      return { title: name, subtitle: itemId ? `Yields ${rowName(ctx.lookup("item", itemId) ?? { id: itemId })} ×${rangeText(row.yieldRange)}` : undefined, badges, thumb: itemId ? { kind: "item", id: itemId } : { kind: "glyph", icon: Leaf }, stats: [{ label: "Respawn", value: `${num(row.respawnSeconds) ?? 0} s` }], tier: num(row.tier) };
    }
    case "equipmentSets": {
      const members = asRecord(row.members);
      const ids = ["head", "body", "legs", "feet"].map(slot => text(members[slot])).filter((value): value is string => Boolean(value));
      const badges: Badge[] = [];
      if (text(row.style)) badges.push({ text: titleCase(text(row.style)!), tone: "info" });
      if (text(row.acquisition)) badges.push({ text: titleCase(text(row.acquisition)!) });
      return { title: name, subtitle: `${Object.keys(members).length} pieces · ${list(row.thresholds).length} bonuses`, badges, thumb: ids.length ? { kind: "items", ids } : { kind: "glyph", icon: Shirt }, stats: [], tier: num(row.tier) };
    }
    case "lootTables": {
      const drops = list(row.drops).map(asRecord);
      const ids = drops.map(drop => text(drop.itemId)).filter((value): value is string => Boolean(value));
      const groups = new Set(drops.map(drop => text(drop.exclusiveGroup)).filter(Boolean));
      const badges: Badge[] = [{ text: `${drops.length} drops`, mono: true }];
      if (groups.size) badges.push({ text: `${groups.size} exclusive`, tone: "info" });
      const owner = text(row.ownerId);
      return { title: name, subtitle: owner ? `Owned by ${rowName(ctx.lookup("enemy", owner) ?? { id: owner })}` : ids.slice(0, 4).map(itemId => rowName(ctx.lookup("item", itemId) ?? { id: itemId })).join(", "), badges, thumb: ids.length ? { kind: "items", ids: ids.slice(0, 4) } : { kind: "glyph", icon: Boxes }, stats: [] };
    }
    case "creatureDefinitions": return creatureSummary(row, ctx);
    case "enemies": return creatureSummary(row, ctx, row);
    case "species": return creatureSummary({ ...row, presentation: { assetId: row.assetId, regionId: row.regionId, habitat: row.description } }, ctx, asRecord(row.stats));
    case "creatureProfiles":
      return { title: name, subtitle: `${num(row.healthBase) ?? 0} + ${num(row.healthPerLevel) ?? 0}/lvl health`, badges: [{ text: titleCase(text(row.role) ?? id), tone: "info" }], thumb: { kind: "glyph", icon: row.role === "boss" ? Crown : Swords, hue: hueFor(id) }, stats: [{ label: "Attack ×", value: numberText(num(row.attackMultiplier) ?? 1) }, { label: "Defence ×", value: numberText(num(row.defenceMultiplier) ?? 1) }, { label: "Speed", value: `${num(row.attackSpeedMs) ?? 0} ms` }] };
    case "worldRegions":
      return { title: name, subtitle: `${list(row.locations).length} locations · ${list(row.roads).length} roads`, badges: [{ text: `Tier ${num(row.tier) ?? "?"}`, mono: true }], thumb: regionThumb(row), stats: [], tier: num(row.tier) };
    case "encounters": {
      const members = list(row.members).map(asRecord);
      const first = text(members[0]?.creatureId);
      const creature = first ? ctx.lookup("enemy", first) : undefined;
      const names = members.map(member => rowName(ctx.lookup("enemy", text(member.creatureId) ?? "") ?? { id: text(member.creatureId) ?? "?" }));
      return { title: name, subtitle: names.join(", "), badges: [{ text: titleCase(text(row.activity) ?? "") }, { text: `${members.length} kinds`, mono: true }], thumb: creature ? creatureSummary(creature, ctx).thumb : { kind: "glyph", icon: Route, hue: hueFor(id) }, stats: [] };
    }
    case "placements": {
      const encounter = text(row.encounterId) ? ctx.lookup("encounter", text(row.encounterId)!) : undefined;
      const badges: Badge[] = [];
      if (text(row.regionId)) badges.push({ text: titleCase(text(row.regionId)!) });
      if (text(row.rank)) badges.push({ text: titleCase(text(row.rank)!), tone: "danger" });
      badges.push({ text: `×${num(row.count) ?? 1}`, mono: true });
      return { title: encounter ? rowName(encounter) : titleCase(id), subtitle: `${titleCase(text(asRecord(row.formation).kind) ?? "grid")} · r ${num(row.radius) ?? 0} m · ${id}`, badges, thumb: mapThumb(row.centre, row.radius, MapPin) ?? { kind: "glyph", icon: MapPin }, stats: [{ label: "Centre", value: list(row.centre).join(", ") }, { label: "Actors", value: String(num(row.count) ?? 1) }] , tier: num(row.level) };
    }
    case "resourcePlacements": {
      const resource = text(row.resourceId) ? ctx.lookup("resource", text(row.resourceId)!) : undefined;
      const itemId = text(resource?.itemId);
      const badges: Badge[] = [];
      if (text(row.regionId)) badges.push({ text: titleCase(text(row.regionId)!) });
      badges.push({ text: `×${num(row.count) ?? 1}`, mono: true });
      return { title: resource ? rowName(resource) : titleCase(id), subtitle: `${text(row.locationId) ?? ""} · ${id}`, badges, thumb: itemId ? { kind: "item", id: itemId } : mapThumb(row.centre, row.radius, TreePine) ?? { kind: "glyph", icon: TreePine }, stats: [{ label: "Centre", value: list(row.centre).join(", ") }] };
    }
    case "npcs": {
      const assetId = text(row.assetId);
      const badges: Badge[] = [];
      if (text(row.regionId)) badges.push({ text: titleCase(text(row.regionId)!) });
      if (list(row.questIds).length) badges.push({ text: `${list(row.questIds).length} quests`, tone: "info" });
      if (text(row.catalog) === "fairy") badges.push({ text: "Fairy", tone: "accent" });
      return { title: name, subtitle: text(row.role)?.slice(0, 90), badges, thumb: assetId ? { kind: "asset", assetId, icon: User, hue: hueFor(id) } : { kind: "glyph", icon: User, hue: hueFor(id) }, stats: [] };
    }
    case "shops": {
      const stock = list(row.stock).map(asRecord);
      const ids = stock.map(entry => text(entry.itemId)).filter((value): value is string => Boolean(value));
      return { title: name, subtitle: `${stock.length} lines · buys ×${num(row.buyMultiplier) ?? 1} · sells ×${num(row.sellMultiplier) ?? 1}`, badges: [], thumb: ids.length ? { kind: "items", ids: ids.slice(0, 4) } : { kind: "glyph", icon: Store }, stats: [] };
    }
    case "quests": {
      const rewards = asRecord(row.rewards);
      const ids = list(rewards.items).map(asRecord).map(entry => text(entry.itemId)).filter((value): value is string => Boolean(value));
      const badges: Badge[] = [];
      if (text(row.kind)) badges.push({ text: titleCase(text(row.kind)!), tone: "info" });
      if (text(row.regionId)) badges.push({ text: titleCase(text(row.regionId)!) });
      badges.push({ text: `${list(row.stages).length} stages`, mono: true });
      const giver = text(row.giverNpcId) ? ctx.lookup("npc", text(row.giverNpcId)!) : undefined;
      return { title: name, subtitle: giver ? `From ${rowName(giver)}` : text(row.summary)?.slice(0, 90), badges, thumb: ids.length ? { kind: "items", ids: ids.slice(0, 4) } : { kind: "glyph", icon: ScrollText, hue: hueFor(id) }, stats: [] };
    }
    case "dialogue":
      return { title: text(row.speaker) ? `${row.speaker}: ${(text(row.text) ?? "").length > 42 ? `${text(row.text)!.slice(0, 40).trimEnd()}…` : text(row.text) ?? ""}` : name, subtitle: id, badges: [{ text: `${list(row.options).length} options`, mono: true }], thumb: { kind: "glyph", icon: MessageCircle, hue: hueFor(text(row.speaker) ?? id) }, stats: [] };
    case "spells": {
      const element = text(row.element) ?? "";
      const cost = asRecord(row.cost);
      return { title: name, subtitle: `${titleCase(text(row.rung) ?? "")} · max ${num(row.baseMax) ?? 0} · ${num(row.castMs) ?? 0} ms`, badges: [{ text: titleCase(element), tone: "info" }, { text: `Lvl ${num(row.reqLevel) ?? 1}`, mono: true }], thumb: { kind: "glyph", icon: ELEMENT_ICON[element] ?? Sparkles, hue: ELEMENT_HUE[element] }, stats: [{ label: "Charges", value: String(num(cost.charges) ?? 0) }, { label: "XP", value: String(num(row.baseXp) ?? 0) }], tier: num(row.tier) };
    }
    case "elementalSpells": {
      const element = text(row.element) ?? "";
      return { title: name, subtitle: text(row.watch)?.slice(0, 90), badges: [{ text: titleCase(element), tone: "info" }, { text: text(row.scale) ?? "" }], thumb: { kind: "glyph", icon: ELEMENT_ICON[element] ?? FlaskConical, hue: ELEMENT_HUE[element] }, stats: [], tier: num(row.rank) };
    }
    case "assets": {
      const category = text(row.category) ?? (row.procedural ? "weapon" : "prop");
      const badges: Badge[] = [{ text: titleCase(category) }];
      if (row.procedural) badges.push({ text: "Procedural", tone: "warn" });
      if (list(row.animations).length) badges.push({ text: `${list(row.animations).length} clips`, mono: true });
      const itemId = text(row.itemId);
      return { title: titleCase(id), subtitle: text(row.pack) ?? text(row.file), badges, thumb: itemId ? { kind: "item", id: itemId } : { kind: "asset", assetId: id, icon: ASSET_ICON[category] ?? Box, hue: hueFor(category) }, stats: [{ label: "Size", value: `${(num(row.bytes) ?? 0) / 1024 | 0} KB` }] };
    }
    case "audio":
      return { title: name, subtitle: `${Object.keys(asRecord(row.value)).length} entries`, badges: [], thumb: { kind: "glyph", icon: Music2, hue: hueFor(id) }, stats: [] };
    case "progression": {
      const materials = asRecord(row.materials);
      const ids = ["ore", "bar", "sword", "helm"].map(key => text(materials[key])).filter((value): value is string => Boolean(value));
      return { title: name, subtitle: `${Object.keys(materials).length} materials · ${list(row.equipment).length} gear · ${list(row.production).length} recipes`, badges: [{ text: `Tier ${num(row.tier) ?? "?"}`, mono: true }], thumb: ids.length ? { kind: "items", ids } : { kind: "glyph", icon: Workflow }, stats: [], tier: num(row.tier) };
    }
    case "equipmentFamilies":
      return { title: name, subtitle: `${text(row.formula) ?? ""} · ${text(row.skill) ?? ""}`, badges: [{ text: titleCase(text(row.slot) ?? text(row.category) ?? "") }], thumb: { kind: "glyph", icon: SLOT_ICON[text(row.slot) ?? ""] ?? Shield, hue: hueFor(text(row.skill) ?? id) }, stats: [] };
    case "recipeTemplates":
      return { title: name, subtitle: `${text(row.formula) ?? ""} · ${list(row.stations).map(String).map(titleCase).join(", ")}`, badges: [{ text: titleCase(text(row.kind) ?? "") }, { text: titleCase(text(row.skill) ?? ""), tone: "info" }], thumb: { kind: "glyph", icon: SKILL_ICON[text(row.skill) ?? ""] ?? Hammer, hue: hueFor(text(row.skill) ?? id) }, stats: [] };
    default:
      if (collection.startsWith("balance/")) return { title: name, subtitle: typeof row.value === "object" && row.value ? `${Object.keys(row.value as object).length} parameters` : String(row.value ?? ""), badges: [], thumb: { kind: "glyph", icon: SlidersHorizontal }, stats: [] };
      return { title: name, subtitle: id !== name ? id : undefined, badges: [], thumb: { kind: "glyph", icon: Boxes, hue: hueFor(collection) }, stats: [], tier: num(row.tier) };
  }
}

const tierFacet: FacetDefinition = { key: "tier", label: "Tier", value: row => num(row.tier) !== undefined ? String(row.tier) : undefined };
const regionFacet: FacetDefinition = { key: "regionId", label: "Region", value: row => text(row.regionId) ?? text(asRecord(row.presentation).regionId) };

/** Facets a collection browser offers as filter chips. Values are computed per row. */
export function facetsFor(collection: string): FacetDefinition[] {
  const base = collection.replace(/^compiled-/, "");
  switch (base) {
    case "items": return [
      { key: "category", label: "Category", value: row => text(row.category) },
      { key: "slot", label: "Slot", value: row => text(asRecord(row.equip).slot) },
      tierFacet,
      { key: "skill", label: "Skill", value: row => Object.keys(asRecord(asRecord(row.equip).requires))[0] ?? text(asRecord(row.tool).skill) },
    ];
    case "recipes": return [{ key: "kind", label: "Kind", value: row => text(row.kind) }, { key: "skill", label: "Skill", value: row => text(row.skill) }, tierFacet];
    case "resources": return [{ key: "archetype", label: "Type", value: row => text(row.archetype) }, { key: "skill", label: "Skill", value: row => text(row.skill) }, tierFacet];
    case "equipmentSets": return [{ key: "style", label: "Style", value: row => text(row.style) }, { key: "acquisition", label: "Source", value: row => text(row.acquisition) }, tierFacet];
    case "creatureDefinitions": return [
      { key: "family", label: "Family", value: row => text(row.family) },
      { key: "profileId", label: "Profile", value: row => text(row.profileId) },
      regionFacet,
      { key: "availability", label: "Availability", value: row => text(row.availability) },
      { key: "kind", label: "Presentation", value: row => text(asRecord(row.presentation).kind) ?? (row.presentation ? "basic" : "none") },
    ];
    case "enemies": return [{ key: "family", label: "Family", value: row => text(row.family) }, { key: "attackStyle", label: "Style", value: row => text(row.attackStyle) }, { key: "behaviour", label: "Behaviour", value: row => text(row.behaviour) }];
    case "species": return [regionFacet, { key: "activity", label: "Activity", value: row => text(row.activity) }];
    case "lootTables": return [{ key: "catalog", label: "Catalog", value: row => text(row.catalog) }];
    case "encounters": return [{ key: "activity", label: "Activity", value: row => text(row.activity) }];
    case "placements": return [regionFacet, { key: "formation", label: "Formation", value: row => text(asRecord(row.formation).kind) }, { key: "rank", label: "Rank", value: row => text(row.rank) }];
    case "resourcePlacements": return [regionFacet, { key: "locationId", label: "Location", value: row => text(row.locationId) }];
    case "npcs": return [regionFacet, { key: "catalog", label: "Catalog", value: row => text(row.catalog) }];
    case "quests": return [{ key: "kind", label: "Kind", value: row => text(row.kind) }, regionFacet];
    case "dialogue": return [{ key: "speaker", label: "Speaker", value: row => text(row.speaker) }, { key: "catalog", label: "Catalog", value: row => text(row.catalog) }];
    case "spells": return [{ key: "element", label: "Element", value: row => text(row.element) }, { key: "rung", label: "Rung", value: row => text(row.rung) }];
    case "elementalSpells": return [{ key: "element", label: "Element", value: row => text(row.element) }, { key: "scale", label: "Scale", value: row => text(row.scale) }];
    case "assets": return [{ key: "category", label: "Category", value: row => text(row.category) ?? (row.procedural ? "procedural" : undefined) }, { key: "pack", label: "Pack", value: row => text(row.pack) }];
    case "equipmentFamilies": return [{ key: "slot", label: "Slot", value: row => text(row.slot) }, { key: "skill", label: "Skill", value: row => text(row.skill) }];
    case "recipeTemplates": return [{ key: "kind", label: "Kind", value: row => text(row.kind) }, { key: "skill", label: "Skill", value: row => text(row.skill) }];
    case "worldRegions": return [tierFacet];
    default: return [];
  }
}

/** Collections whose records are best browsed as tiles rather than rows. */
export function prefersGrid(collection: string): boolean {
  const base = collection.replace(/^compiled-/, "");
  return ["items", "equipmentSets", "recipes", "resources", "materials", "lootTables", "creatureDefinitions", "enemies", "species", "npcs", "shops", "quests", "spells", "spellRunes", "elementalSpells", "assets", "encounters", "placements", "resourcePlacements", "worldRegions", "progression", "campfireFuels"].includes(base);
}

export { titleCase };
export const facetLabel = titleCase;
export const iconForSkill = (skill: string): LucideIcon => SKILL_ICON[skill] ?? Hammer;
export const iconForElement = (element: string): LucideIcon => ELEMENT_ICON[element] ?? Sparkles;
export const glyphs = { Users, Boxes, Swords, Shield, Store, ScrollText, MessageCircle, MapPin, Music2, Wand2, PawPrint, Bug, Anvil };
