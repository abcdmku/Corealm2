import { queryOptions } from "@tanstack/react-query";
import { backend } from "./backend.js";

/**
 * The editor's reads, routed through whichever backend `main.tsx` installed. Nothing here knows
 * which one that is; a page that needs to know asks `can(...)` for the surface it wants.
 */

export function apiGet<T>(path: string): Promise<T> { return backend().get<T>(path); }

export const collectionsQuery = () => queryOptions({ queryKey: ["collections"], queryFn: () => backend().collections(), staleTime: 30_000 });
export const collectionQuery = (name: string) => queryOptions({ queryKey: ["collection", name], queryFn: () => backend().collection(name), staleTime: 10_000, enabled: Boolean(name) });
