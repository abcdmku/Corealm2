import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { collectionQuery } from "../api/client.js";
import { playersQuery, rolesQuery } from "../api/adminData.js";
import { readSession } from "../api/session.js";
import { contentRows } from "./rows.js";

/*
  Ids are how the admin API keys everything and the worst way to read a page. These two hooks are
  what every server-mode surface uses to put a name and an icon where an id was: the catalog's items
  by id, and the accounts this server knows by account id.
*/

export interface CatalogItem { id: string; name: string; stackable: boolean; category: string; equipSlot?: string }

/** The items of the running server's catalog, by id. A stored inventory is meaningless without it. */
export function useCatalogItems(): { byId: ReadonlyMap<string, CatalogItem>; all: readonly CatalogItem[]; loading: boolean } {
  const query = useQuery(collectionQuery("compiled-items"));
  return useMemo(() => {
    const all = (query.data ? contentRows(query.data) : []).map(row => ({
      id: String(row.id), name: String(row.name ?? row.id), stackable: row.stackable === true,
      category: String(row.category ?? ""), equipSlot: (row.equip as { slot?: string } | undefined)?.slot,
    }));
    return { byId: new Map(all.map(item => [item.id, item])), all, loading: query.isPending };
  }, [query.data, query.isPending]);
}

export const itemName = (items: ReadonlyMap<string, CatalogItem>, id: string): string => items.get(id)?.name ?? id;

/**
 * Display names for account ids, from the first page of players and the role list. Both are already
 * read by other surfaces, so this costs nothing new; an account neither list holds keeps its id,
 * which is still the truth.
 */
export function useAccountNames(): (accountId: string) => string | undefined {
  const players = useQuery(playersQuery(""));
  const roles = useQuery(rolesQuery());
  return useMemo(() => {
    const names = new Map<string, string>();
    // An admin who has never played is in neither list, and their own writes are most of the log,
    // so the session's own name goes in first and anything better overwrites it.
    const session = readSession();
    if (session) names.set(session.accountId, session.name);
    for (const role of roles.data?.roles ?? []) if (role.name) names.set(role.accountId, role.name);
    for (const player of players.data?.players ?? []) names.set(player.accountId, player.name);
    return (accountId: string) => names.get(accountId);
  }, [players.data, roles.data]);
}
