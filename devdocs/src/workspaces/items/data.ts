import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Schema } from "../../../../game/src/content/schema/core.js";
import type { EquipmentFamily, ProgressionTier, RecipeTemplate } from "../../../../game/src/content/schema/progression.js";
import { collectionQuery } from "../../api/client.js";
import type { ContentRow } from "../../model/contracts.js";
import { BONUS_KEYS, deriveEquipmentMember, equipmentSource, typedRows, type BonusKey, type EquipmentMember, type ProductionEntry } from "../../model/derive.js";
import { fieldPath } from "../../model/fields.js";
import type { Path } from "../../model/origin.js";
import { contentRows } from "../../model/rows.js";
import type { ChoiceOption } from "../../ui/field/index.js";

/*
  Everything the Items workspace reads: the tier rows and the curves behind them, the authored
  items, and the compiled catalogs the game sees. One hook, cached per collection, so the ladder,
  the item page and the drawers all agree on the same records. Labels, units and choices come from
  the schemas through `specAt`; nothing here declares them by hand.
*/

export interface ItemRecord extends ContentRow {
  id: string; name: string; tier?: number; description?: string; value?: number; category?: string; stackable?: boolean;
  equip?: { slot?: string; bonuses?: Partial<Record<BonusKey, number>>; requires?: Record<string, number>; attackSpeedMs?: number };
  tool?: { skill?: string; gatherBonus?: number };
  food?: { healAmount?: number };
  magicWeapon?: { kind?: string; hands?: number; charge?: Record<string, unknown> };
  orb?: { element?: string; released?: boolean };
}
export interface RecipeRecord extends ContentRow {
  id: string; name: string; kind?: string; skill?: string; reqLevel?: number; tier?: number; stations?: string[] | null;
  inputs?: { itemId: string; quantity: number }[]; output?: { itemId: string; quantity: number }; durationMs?: number; xp?: number; burntItemId?: string;
}
export interface SetThreshold { pieces: number; bonuses: Partial<Record<BonusKey, number>> }
export interface SetRecord extends ContentRow {
  id: string; name: string; tier?: number; style?: string; acquisition?: string;
  members?: Partial<Record<SetSlot, string>>;
  thresholds?: SetThreshold[];
}
export interface SetBalance { thresholds?: { defencePieces?: [number, number]; healthPieces?: number }; byTier?: { tier: number; defence: number; health: number }[] }

export type SetSlot = "head" | "body" | "legs" | "hands" | "feet";
export const SET_SLOTS: readonly SetSlot[] = ["head", "body", "legs", "hands", "feet"];

export const titleCase = (value: string): string => value.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());
export const stationText = (stations: readonly string[] | null | undefined): string => stations && stations.length ? stations.map(station => station.replace(/_/g, " ")).join(" or ") : "anywhere";
export const seconds = (ms: number | undefined): string => ms === undefined ? "—" : `${Number((ms / 1000).toFixed(2))} s`;

/** Short labels for the bonus keys, for ladder cells, threshold text and the drawer tables. */
export const BONUS_SHORT: Readonly<Record<BonusKey, string>> = { meleeAccuracy: "acc", magicAccuracy: "m.acc", defence: "def", health: "hp", meleePower: "pow", magicPower: "m.pow", vitality: "vit" };

export const emptyBonuses = (): Record<BonusKey, number> => Object.fromEntries(BONUS_KEYS.map(key => [key, 0])) as Record<BonusKey, number>;

/** What a page needs to declare a field at one path of a record schema, with the number bounds ready for `NumberField`. */
export interface PathSpec {
  label: string; hint?: string; unit?: string; step?: number; integer?: boolean; min?: number; max?: number;
  choices?: string[]; optional: boolean; multiline: boolean;
}

export function specAt(schema: Schema, path: Path): PathSpec {
  const spec = fieldPath(schema, path);
  if (!spec) throw new Error(`The schema has no field at ${path.join(".")}`);
  const nudge = spec.integer ? 1 : Number.EPSILON;
  return {
    label: spec.label, hint: spec.help, unit: spec.unit, step: spec.step, integer: spec.integer,
    min: spec.min ?? (spec.exclusiveMin !== undefined ? spec.exclusiveMin + nudge : undefined),
    max: spec.max ?? (spec.exclusiveMax !== undefined ? spec.exclusiveMax - nudge : undefined),
    choices: spec.choices?.map(String), optional: spec.optional, multiline: Boolean(spec.multiline),
  };
}

/** A schema enum as `ChoiceField` options, titled from the value. */
export const choicesOf = (spec: PathSpec): ChoiceOption[] => (spec.choices ?? []).map(value => ({ value, label: titleCase(value) }));

export function useItemsData() {
  const progression = useQuery(collectionQuery("progression"));
  const families = useQuery(collectionQuery("equipmentFamilies"));
  const templates = useQuery(collectionQuery("recipeTemplates"));
  const items = useQuery(collectionQuery("items"));
  const compiledItems = useQuery(collectionQuery("compiled-items"));
  const compiledRecipes = useQuery(collectionQuery("compiled-recipes"));
  const sets = useQuery(collectionQuery("equipmentSets"));

  const tiers = useMemo(() => progression.data ? [...typedRows<ProgressionTier>(contentRows(progression.data))].sort((a, b) => a.tier - b.tier) : [], [progression.data]);
  const familyRows = useMemo(() => families.data ? typedRows<EquipmentFamily>(contentRows(families.data)) : [], [families.data]);
  const templateRows = useMemo(() => templates.data ? typedRows<RecipeTemplate>(contentRows(templates.data)) : [], [templates.data]);
  const authored = useMemo(() => new Map((items.data ? typedRows<ItemRecord>(contentRows(items.data)) : []).map(row => [row.id, row])), [items.data]);
  const compiled = useMemo(() => new Map((compiledItems.data ? typedRows<ItemRecord>(contentRows(compiledItems.data)) : []).map(row => [row.id, row])), [compiledItems.data]);
  const recipes = useMemo(() => compiledRecipes.data ? typedRows<RecipeRecord>(contentRows(compiledRecipes.data)) : [], [compiledRecipes.data]);
  const setRows = useMemo(() => sets.data ? typedRows<SetRecord>(contentRows(sets.data)) : [], [sets.data]);

  /** The record the game sees when it exists, otherwise the authored row. */
  const item = useCallback((id: string): ItemRecord | undefined => compiled.get(id) ?? authored.get(id), [compiled, authored]);
  const familyById = useCallback((id: string) => familyRows.find(row => row.id === id), [familyRows]);
  const templateById = useCallback((id: string) => templateRows.find(row => row.id === id), [templateRows]);
  /** The production entry whose output is this item, with its tier. */
  const madeBy = useCallback((itemId: string): { tier: ProgressionTier; entry: ProductionEntry } | undefined => {
    for (const tier of tiers) { const entry = tier.production.find(row => row.output.itemId === itemId); if (entry) return { tier, entry }; }
    return undefined;
  }, [tiers]);
  /** Every compiled item that is not gear for `slot`, to exclude from a set piece picker. */
  const notInSlot = useCallback((slot: string): ReadonlySet<string> => {
    const out = new Set<string>();
    for (const row of compiled.values()) if (row.equip?.slot !== slot) out.add(row.id);
    return out;
  }, [compiled]);

  const loading = progression.isPending || families.isPending || templates.isPending || items.isPending || compiledItems.isPending || compiledRecipes.isPending || sets.isPending;
  const error = [progression, families, templates, items, compiledItems, compiledRecipes, sets].find(query => query.isError)?.error?.message;
  return { tiers, families: familyRows, templates: templateRows, authored, compiled, recipes, sets: setRows, item, familyById, templateById, madeBy, notInSlot, loading, error, itemsEditable: Boolean(items.data?.collection.editable) };
}
export type ItemsData = ReturnType<typeof useItemsData>;

/** Members of one family across every tier, in tier order. */
export function familyMembers(tiers: readonly ProgressionTier[], familyId: string): { tier: ProgressionTier; member: EquipmentMember }[] {
  return tiers.flatMap(tier => tier.equipment.filter(member => member.familyId === familyId).map(member => ({ tier, member })));
}
/** Entries of one template across every tier, in tier order. */
export function templateEntries(tiers: readonly ProgressionTier[], templateId: string): { tier: ProgressionTier; entry: ProductionEntry }[] {
  return tiers.flatMap(tier => tier.production.filter(entry => entry.templateId === templateId).map(entry => ({ tier, entry })));
}

/** The one number a ladder cell shows in Numbers mode: value for materials, gather bonus for tools, the main bonus for gear. */
export function keyNumber(id: string, data: Pick<ItemsData, "tiers" | "families" | "item">, familyOverride?: EquipmentFamily): { label: string; value: number } | undefined {
  const source = equipmentSource(id, data.tiers, data.families);
  if (source) {
    const family = familyOverride?.id === source.family.id ? familyOverride : source.family;
    const derived = deriveEquipmentMember(source.tier, source.member, family);
    if (family.category === "tool") return { label: "gather", value: derived.gatherBonus.value };
    // The column's main stat is the bonus the curve grows fastest, so every tier in the column shows the same key.
    const mainKey = BONUS_KEYS.reduce<BonusKey | undefined>((best, key) => {
      const rate = family.parameters.bonusesPerLevel[key] + family.parameters.bonusesBase[key];
      return rate > 0 && (!best || rate > family.parameters.bonusesPerLevel[best] + family.parameters.bonusesBase[best]) ? key : best;
    }, undefined);
    if (mainKey) return { label: BONUS_SHORT[mainKey], value: derived.bonuses[mainKey].value };
    return { label: "value", value: derived.value.value };
  }
  const record = data.item(id);
  if (!record) return undefined;
  if (record.tool?.gatherBonus !== undefined) return { label: "gather", value: record.tool.gatherBonus };
  if (record.equip?.bonuses) { const main = mainBonus(record.equip.bonuses); if (main) return main; }
  return record.value === undefined ? undefined : { label: "value", value: record.value };
}
function mainBonus(bonuses: Partial<Record<BonusKey, number>>): { label: string; value: number } | undefined {
  let best: { label: string; value: number } | undefined;
  for (const key of BONUS_KEYS) { const value = bonuses[key] ?? 0; if (value !== 0 && (!best || Math.abs(value) > Math.abs(best.value))) best = { label: BONUS_SHORT[key], value }; }
  return best;
}

/** Threshold bonuses as `2: +7 def · 4: +5 hp`. */
export function thresholdText(thresholds: SetRecord["thresholds"]): string {
  return (thresholds ?? []).map(threshold => {
    const parts = BONUS_KEYS.filter(key => (threshold.bonuses[key] ?? 0) !== 0).map(key => `${threshold.bonuses[key]! > 0 ? "+" : ""}${threshold.bonuses[key]} ${BONUS_SHORT[key]}`);
    return `${threshold.pieces}: ${parts.join(", ") || "—"}`;
  }).join(" · ");
}

/** The thresholds balance/sets.json says a set of this tier should carry. */
export function targetThresholds(balance: SetBalance | undefined, tier: number | undefined): SetThreshold[] | undefined {
  if (!balance?.byTier || tier === undefined) return undefined;
  const row = balance.byTier.find(entry => entry.tier === tier);
  const defencePieces = balance.thresholds?.defencePieces ?? [2, 5];
  const healthPieces = balance.thresholds?.healthPieces ?? 4;
  if (!row) return undefined;
  return [{ pieces: defencePieces[0], bonuses: { defence: row.defence } }, { pieces: healthPieces, bonuses: { health: row.health } }, { pieces: defencePieces[1], bonuses: { defence: row.defence } }];
}

export const readOnlyMode = (): boolean => __DEVDOCS_PLAYER__;
