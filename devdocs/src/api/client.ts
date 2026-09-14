import { queryOptions } from "@tanstack/react-query";
import type { CollectionResponse, CollectionSummary, ApiError } from "../../shared/contracts.js";

let playerBundle: Promise<{ requests: Record<string, unknown> }> | undefined;

export async function apiGet<T>(path: string): Promise<T> {
  if (__DEVDOCS_PLAYER__) {
    playerBundle ??= fetch(`${import.meta.env.BASE_URL}content-bundle.json`).then(async response => {
      if (!response.ok) throw new Error(`Unable to load guide content (${response.status})`);
      return response.json();
    });
    const bundle = await playerBundle;
    const value = bundle.requests[path] ?? bundle.requests[decodeURIComponent(path)];
    if (value === undefined) throw new Error('This content is unavailable in the player guide');
    return value as T;
  }
  const response = await fetch(`/__devdocs/${path}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as Partial<ApiError>;
    throw new Error(error.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}
export const collectionsQuery = () => queryOptions({ queryKey: ["collections"], queryFn: () => apiGet<CollectionSummary[]>("collections"), staleTime: 30_000 });
async function readCollection(name: string): Promise<CollectionResponse> {
  return apiGet<CollectionResponse>(`collections/${encodeURIComponent(name)}`);
}
export const collectionQuery = (name: string) => queryOptions({ queryKey: ["collection", name], queryFn: () => readCollection(name), staleTime: 10_000, enabled: Boolean(name) });
