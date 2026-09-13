import type { CollectionResponse } from "../../shared/contracts.js";
import type { ContentRow } from "./contracts.js";

export function contentRows(response: CollectionResponse): ContentRow[] {
  if (response.collection.shape === "array") return response.data as ContentRow[];
  return Object.entries(response.data as Record<string, unknown>).map(([id, value]) => ({ id, name: collectionName(id), value }));
}
export function rowId(row: ContentRow, idKey = "id"): string { return String(row[idKey] ?? ""); }
export function rowName(row: ContentRow, idKey = "id"): string { return String(row.name ?? row.title ?? row.label ?? row[idKey] ?? "Untitled"); }
export function collectionName(name: string): string { return name.replace(/^balance\//, "Balance · ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, value => value.toUpperCase()); }
