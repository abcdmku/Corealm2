import type { CollectionResponse } from "../../shared/contracts.js";
import type { ContentRow } from "./contracts.js";

export function contentRows(response: CollectionResponse): ContentRow[] {
  if (response.collection.shape === "array") return response.data as ContentRow[];
  return Object.entries(response.data as Record<string, unknown>).map(([id, value]) => ({ id, name: collectionName(id), value }));
}
/** Name/tier joins are display-only; editors and source views retain the original response. */
export function displayRows(response: CollectionResponse, enemyResponse?: CollectionResponse): ContentRow[] {
  const rows = contentRows(response);
  const collection = response.collection.name;
  if (collection !== 'creatures' && collection !== 'enemyAliases') return rows;
  const blocks = new Map((enemyResponse ? contentRows(enemyResponse) : []).map(row => [String(row.id), row]));
  return rows.map(row => {
    const block = blocks.get(String(row.blockId));
    if (!block) return row;
    const overrides = collection === 'enemyAliases' ? row.overrides as ContentRow : undefined;
    return { ...row, name: overrides?.name ?? block.name, tier: overrides?.tier ?? block.tier, family: overrides?.family ?? block.family };
  });
}
export function rowId(row: ContentRow, idKey = "id"): string { return String(row[idKey] ?? ""); }
export function rowName(row: ContentRow, idKey = "id"): string { return String(row.name ?? row.title ?? row.label ?? row[idKey] ?? "Untitled"); }
export function collectionName(name: string): string { return name.replace(/^balance\//, "Balance · ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, value => value.toUpperCase()); }
