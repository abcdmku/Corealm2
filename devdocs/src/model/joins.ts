import { lootRollPreview } from './loot.js';
import type { CollectionResponse } from "../../shared/contracts.js";
import type { ContentRow } from "./contracts.js";

/** The two shapes the app can have after one or more collection queries resolve. */
export type LoadedCollections =
  | readonly CollectionResponse[]
  | Readonly<Record<string, unknown>>;

export type SourceUseKind =
  | "recipe-input"
  | "recipe-output"
  | "resource-yield"
  | "resource-bonus"
  | "shop-sell"
  | "quest-grant"
  | "set-member"
  | "enemy-drop";

export interface SourceUseLink {
  kind: SourceUseKind;
  collection: string;
  recordId: string;
  recordLabel: string;
  detail: string;
  quantity?: number | readonly [number, number];
  chance?: number;
  rollId?: string;
  rollCount?: number;
  /** Whether the source row has an id the UI can use as a navigation target. */
  targetKnown: boolean;
}

export interface SourceUsesResult {
  itemId: string;
  links: readonly SourceUseLink[];
  /** Whether an item row for `itemId` was loaded. */
  targetKnown: boolean;
}

interface CollectionEnvelope {
  name: string;
  data: unknown;
  idKey: string;
  shape: "array" | "object";
}

interface NormalizedTable {
  /** The name supplied by the caller, retained for navigation. */
  name: string;
  /** A response nested under a map entry can carry the canonical name as well. */
  declaredName?: string;
  idKey: string;
  rows: readonly ContentRow[];
}

// Compiled tables contain both authored and generated rows. Prefer them when available so
// source usage includes generated recipes and yields without duplicating authored links.
const ITEM_COLLECTIONS = ["compiled-items", "items"] as const;
const RECIPE_COLLECTIONS = ["compiled-recipes", "recipes"] as const;
const RESOURCE_COLLECTIONS = ["compiled-resources", "resources"] as const;
const SHOP_COLLECTIONS = ["shops"] as const;
const QUEST_COLLECTIONS = ["quests"] as const;
const SET_COLLECTIONS = ["equipmentSets", "sets"] as const;
const ID_KEYED_COLLECTIONS = new Set<string>(["creatureDefinitions", "lootTables"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  return value;
}

function idValue(value: unknown): string {
  if (typeof value === "string") return value.trim().length > 0 ? value : "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function collectionEnvelope(value: unknown): CollectionEnvelope | undefined {
  if (!isRecord(value) || !isRecord(value.collection) || !("data" in value)) return undefined;
  const name = nonEmptyString(value.collection.name);
  const shape = value.collection.shape;
  if (!name || (shape !== "array" && shape !== "object")) return undefined;
  const idKey = nonEmptyString(value.collection.idKey) ?? "id";
  return { name, data: value.data, idKey, shape };
}

/**
 * Object-shaped collections are keyed by record id (audio and balance use this form). Requiring
 * every value to be a record prevents a normal row such as `{ id, name, members }` from being
 * mistaken for a table merely because it happens to be passed through a map-shaped API.
 */
function keyedRows(data: unknown, idKey: string, synthesizeMissingIds: boolean): ContentRow[] {
  if (!isRecord(data)) return [];
  const entries = Object.entries(data);
  if (entries.length === 0) return [];

  const rows: ContentRow[] = [];
  for (const [key, value] of entries) {
    if (!isRecord(value)) return [];
    const row: ContentRow = { ...value };
    if (!idValue(row[idKey]) && !idValue(row.id)) {
      if (!synthesizeMissingIds) continue;
      row[idKey] = key;
    }
    rows.push(row);
  }
  return rows;
}

function rowsForData(data: unknown, shape: "array" | "object" | undefined, idKey: string, synthesizeMissingIds = false): ContentRow[] {
  if (shape === "array" || (shape === undefined && Array.isArray(data))) {
    return Array.isArray(data) ? data.filter(isRecord) : [];
  }
  if (shape === "object") return keyedRows(data, idKey, true);
  if (shape === undefined && isRecord(data)) return keyedRows(data, idKey, synthesizeMissingIds);
  return [];
}

function normalizeCollections(collections: LoadedCollections): NormalizedTable[] {
  if (Array.isArray(collections)) {
    return collections.flatMap((value) => {
      const envelope = collectionEnvelope(value);
      if (!envelope) return [];
      return [{
        name: envelope.name,
        idKey: envelope.idKey,
        rows: rowsForData(envelope.data, envelope.shape, envelope.idKey),
      }];
    });
  }
  if (!isRecord(collections)) return [];

  return Object.entries(collections).flatMap(([suppliedName, value]) => {
    const name = nonEmptyString(suppliedName);
    if (!name) return [];
    const envelope = collectionEnvelope(value);
    if (envelope) {
      return [{
        name,
        declaredName: envelope.name,
        idKey: envelope.idKey,
        rows: rowsForData(envelope.data, envelope.shape, envelope.idKey),
      }];
    }
    const idKey = "id";
    return [{ name, idKey, rows: rowsForData(value, undefined, idKey, ID_KEYED_COLLECTIONS.has(name)) }];
  });
}

function tableMatches(table: NormalizedTable, names: readonly string[]): boolean {
  return names.includes(table.name) || (table.declaredName !== undefined && names.includes(table.declaredName));
}

function firstTable(tables: readonly NormalizedTable[], names: readonly string[]): NormalizedTable | undefined {
  return tables.find((table) => tableMatches(table, names));
}

function rowId(row: ContentRow, idKey: string): string {
  const primary = idValue(row[idKey]);
  return primary || (idKey === "id" ? "" : idValue(row.id));
}

function rowLabel(row: ContentRow, recordId: string): string {
  for (const key of ["name", "title", "label"] as const) {
    const label = nonEmptyString(row[key]);
    if (label) return label;
  }
  return recordId || "Unknown source";
}

function itemReference(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function quantityValue(value: unknown): number | readonly [number, number] | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const low = value[0];
  const high = value[1];
  if (typeof low !== "number" || !Number.isFinite(low) || typeof high !== "number" || !Number.isFinite(high)) return undefined;
  if (low < 0 || high < 0 || low > high) return undefined;
  return [low, high] as const;
}

function chanceValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
}

function numberText(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function quantityText(quantity: number | readonly [number, number] | undefined): string {
  if (quantity === undefined) return "";
  if (typeof quantity !== "number") {
    const low = numberText(quantity[0]!);
    const high = numberText(quantity[1]!);
    return ` ×${low === high ? low : `${low}–${high}`}`;
  }
  return ` ×${numberText(quantity)}`;
}

function chanceText(chance: number | undefined): string {
  if (chance === undefined) return "";
  const percent = Number((chance * 100).toFixed(1));
  return ` (${numberText(percent)}% chance)`;
}

function detailText(
  action: string,
  quantity: number | readonly [number, number] | undefined,
  chance?: number,
  context?: string,
): string {
  return `${action}${quantityText(quantity)}${chanceText(chance)}${context ? ` · ${context}` : ""}`;
}

function stackItemId(value: unknown): string | undefined {
  return isRecord(value) ? itemReference(value.itemId) : undefined;
}

function addLink(
  links: SourceUseLink[],
  kind: SourceUseKind,
  table: NormalizedTable,
  row: ContentRow,
  detail: string,
  quantity?: number | readonly [number, number],
  chance?: number,
): void {
  const recordId = rowId(row, table.idKey);
  const link: SourceUseLink = {
    kind,
    collection: table.name,
    recordId,
    recordLabel: rowLabel(row, recordId),
    detail,
    targetKnown: recordId.length > 0,
  };
  if (quantity !== undefined) link.quantity = quantity;
  if (chance !== undefined) link.chance = chance;
  links.push(link);
}

function recipeLinks(itemId: string, table: NormalizedTable, links: SourceUseLink[]): void {
  for (const row of table.rows) {
    const inputs = row.inputs;
    if (Array.isArray(inputs)) {
      for (const input of inputs) {
        if (stackItemId(input) !== itemId) continue;
        const quantity = isRecord(input) ? quantityValue(input.quantity) : undefined;
        addLink(links, "recipe-input", table, row,
          detailText("Consumes", quantity), quantity);
      }
    }

    const output = isRecord(row.output) ? row.output : undefined;
    if (output && stackItemId(output) === itemId) {
      const quantity = quantityValue(output.quantity);
      addLink(links, "recipe-output", table, row,
        detailText("Produces", quantity), quantity);
    }

    if (itemReference(row.burntItemId) === itemId) {
      const quantity = output ? quantityValue(output.quantity) : undefined;
      addLink(links, "recipe-output", table, row,
        detailText("Burnt output", quantity), quantity);
    }
  }
}

function resourceLinks(itemId: string, table: NormalizedTable, links: SourceUseLink[]): void {
  for (const row of table.rows) {
    if (itemReference(row.itemId) === itemId) {
      const quantity = quantityValue(row.yieldRange);
      addLink(links, "resource-yield", table, row,
        detailText("Yields", quantity), quantity);
    }

    if (!Array.isArray(row.bonus)) continue;
    for (const bonus of row.bonus) {
      if (stackItemId(bonus) !== itemId) continue;
      const quantity = isRecord(bonus) ? quantityValue(bonus.quantity) : undefined;
      const chance = isRecord(bonus) ? chanceValue(bonus.chance) : undefined;
      addLink(links, "resource-bonus", table, row,
        detailText("Bonus yield", quantity, chance), quantity, chance);
    }
  }
}

function shopLinks(itemId: string, table: NormalizedTable, links: SourceUseLink[]): void {
  for (const row of table.rows) {
    if (!Array.isArray(row.stock)) continue;
    for (const stock of row.stock) {
      if (stackItemId(stock) !== itemId) continue;
      const quantity = isRecord(stock) ? quantityValue(stock.quantity) : undefined;
      addLink(links, "shop-sell", table, row,
        detailText("Sells", quantity, undefined, "in stock"), quantity);
    }
  }
}

function grantLinks(
  itemId: string,
  table: NormalizedTable,
  row: ContentRow,
  grant: unknown,
  context: string,
  links: SourceUseLink[],
): void {
  if (!isRecord(grant) || !Array.isArray(grant.items)) return;
  for (const stack of grant.items) {
    if (stackItemId(stack) !== itemId) continue;
    const quantity = isRecord(stack) ? quantityValue(stack.quantity) : undefined;
    addLink(links, "quest-grant", table, row,
      detailText("Granted", quantity, undefined, context), quantity);
  }
}

function questLinks(itemId: string, table: NormalizedTable, links: SourceUseLink[]): void {
  for (const row of table.rows) {
    grantLinks(itemId, table, row, row.onStart, "quest start", links);
    grantLinks(itemId, table, row, row.rewards, "completion reward", links);

    if (!Array.isArray(row.stages)) continue;
    for (const stage of row.stages) {
      if (!isRecord(stage)) continue;
      const index = typeof stage.index === "number" && Number.isFinite(stage.index) ? stage.index + 1 : undefined;
      grantLinks(itemId, table, row, stage.grants, index === undefined ? "stage reward" : `stage ${index} reward`, links);

      if (!Array.isArray(stage.onFlag)) continue;
      for (const onFlag of stage.onFlag) {
        if (!isRecord(onFlag)) continue;
        const flag = nonEmptyString(onFlag.flag);
        grantLinks(itemId, table, row, onFlag.grant, flag ? `flag ${flag}` : "flag reward", links);
      }
    }
  }
}

function setLinks(itemId: string, table: NormalizedTable, links: SourceUseLink[]): void {
  for (const row of table.rows) {
    if (!isRecord(row.members)) continue;
    for (const [slot, member] of Object.entries(row.members)) {
      if (itemReference(member) !== itemId) continue;
      addLink(links, "set-member", table, row,
        detailText("Set member", undefined, undefined, slot));
    }
  }
}

function enemyLinks(itemId: string, tables: readonly NormalizedTable[], links: SourceUseLink[]): void {
  const creatures = firstTable(tables, ["creatureDefinitions"]);
  if (!creatures) return;
  const lootTables = firstTable(tables, ["lootTables"]);
  const lookup = (id: string) => lootTables?.rows.find(row => rowId(row, lootTables.idKey) === id);
  for (const row of creatures.rows) {
    const base = creatures.rows.find(candidate => rowId(candidate, creatures.idKey) === row.baseId);
    for (const roll of lootRollPreview(row.loot ?? base?.loot, lookup)) {
      if (roll.count <= 0) continue;
      for (const drop of roll.drops) {
        if (stackItemId(drop) !== itemId) continue;
        const quantity = quantityValue(drop.quantity);
        const chance = chanceValue(drop.chance);
        addLink(links, "enemy-drop", creatures, row, detailText("Drops", quantity, chance, `${roll.name}, ${roll.count} rolls, chance per roll`), quantity, chance);
        Object.assign(links[links.length - 1]!, { rollId: roll.id, rollCount: roll.count });
      }
    }
  }
}

/**
 * Finds every loaded source record that references an item. The function deliberately knows only
 * the JSON row shapes used by the app; it does not import the game registry or read from disk.
 */
export function sourceUses(itemId: string, collections: LoadedCollections): SourceUsesResult {
  const tables = normalizeCollections(collections);
  const links: SourceUseLink[] = [];

  const items = firstTable(tables, ITEM_COLLECTIONS);
  const targetKnown = itemId.length > 0
    && items?.rows.some((row) => rowId(row, items.idKey) === itemId) === true;

  const recipes = firstTable(tables, RECIPE_COLLECTIONS);
  if (recipes) recipeLinks(itemId, recipes, links);

  const resources = firstTable(tables, RESOURCE_COLLECTIONS);
  if (resources) resourceLinks(itemId, resources, links);

  const shops = firstTable(tables, SHOP_COLLECTIONS);
  if (shops) shopLinks(itemId, shops, links);

  const quests = firstTable(tables, QUEST_COLLECTIONS);
  if (quests) questLinks(itemId, quests, links);

  // The canonical collection is equipmentSets. `sets` remains a compatibility alias for callers
  // holding an older response, but the table's supplied name is always kept on the link.
  const sets = firstTable(tables, SET_COLLECTIONS);
  if (sets) setLinks(itemId, sets, links);

  enemyLinks(itemId, tables, links);

  return { itemId, links, targetKnown };
}
