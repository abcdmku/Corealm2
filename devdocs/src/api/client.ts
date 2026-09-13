import { queryOptions } from "@tanstack/react-query";
import type { CollectionResponse, CollectionSummary, ApiError } from "../../shared/contracts.js";

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`/__devdocs/${path}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as Partial<ApiError>;
    throw new Error(error.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}
export const collectionsQuery = () => queryOptions({ queryKey: ["collections"], queryFn: () => apiGet<CollectionSummary[]>("collections"), staleTime: 30_000 });
export const collectionQuery = (name: string) => queryOptions({ queryKey: ["collection", name], queryFn: () => apiGet<CollectionResponse>(`collections/${encodeURIComponent(name)}`), staleTime: 10_000, enabled: Boolean(name) });
