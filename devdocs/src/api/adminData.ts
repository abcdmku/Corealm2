import { queryOptions } from "@tanstack/react-query";
import type { EquipSlot, ItemStack, SkillId, Vec3, WorldKey } from "../../../game/src/contracts.js";
import { backend } from "./backend.js";
import { AdminFailure } from "./session.js";

/**
 * The admin API beyond content: players, stats, audit, roles, tokens, settings, publish history.
 *
 * Everything here is one `backend().admin()` call behind a `queryOptions`, so a page asks for a
 * surface and gets caching, refetching and the shared 401 handling without knowing the transport.
 * The shapes are the ones `docs/multiplayer-hosting.md` documents; they are declared here rather
 * than imported from `game/src/multiplayer/adminStorage.ts` because that module reaches for
 * `node:crypto` and the editor is a browser bundle. `tests/devdocs-admin-data.test.ts` is what keeps
 * the two from drifting.
 */

export type ServerRole = "owner" | "admin";
/** Mirrors `API_SCOPES` in `game/src/multiplayer/adminStorage.ts`. */
export const API_SCOPES = ["content:read", "content:publish", "players:read", "players:write", "stats:read"] as const;
export type ApiScope = typeof API_SCOPES[number];
export const SCOPE_HELP: Readonly<Record<ApiScope, string>> = {
  "content:read": "Read the source collections and the server catalog.",
  "content:publish": "Publish a catalog to this server.",
  "players:read": "List players and bans.",
  "players:write": "Edit, kick and ban players.",
  "stats:read": "Read the server statistics.",
};

export interface BanRecord { accountId: string; name: string | null; reason: string; expiresAt: number | null; bannedBy: string; bannedAt: number }
export interface PlayerSummary {
  accountId: string; name: string; firstSeen: number; lastSeen: number; playtimeSeconds: number;
  lastWorld: WorldKey | null; position: Vec3 | null; regionId: string | null;
  /** The world holding this account right now, or null when they are offline. */
  online: WorldKey | null;
  ban: BanRecord | null;
}
export interface PlayerSkill { xp: number; level: number }
export interface InventorySlot { slotIndex: number; itemId: string; quantity: number }
export interface PlayerDetail extends PlayerSummary {
  currency: number | null;
  skills: Partial<Record<SkillId, PlayerSkill>> | null;
  inventory: (InventorySlot | null)[] | null;
  bank: ItemStack[] | null;
  equipment: Partial<Record<EquipSlot, ItemStack | null>> | null;
  /** Send back as `expect.revision`. Null when this account has no character yet. */
  revision: string | null;
}
export interface PlayerPage { players: PlayerSummary[]; cursor: string | null }

/** The typed operations `PATCH /admin/players/<id>` takes, applied in order. */
export type PlayerOp =
  | { op: "inventory.set"; slots: ({ itemId: string; quantity: number } | null)[] }
  | { op: "bank.add" | "bank.remove"; itemId: string; quantity: number }
  | { op: "equipment.set"; slot: EquipSlot; itemId: string | null }
  | { op: "currency.set"; amount: number }
  | { op: "skill.setXp"; skill: SkillId; xp: number }
  | { op: "position.set"; world: WorldKey; regionId: string; position: Vec3 };

export interface PlayerEditResult {
  applied: "live" | "stored";
  world: WorldKey | null;
  changed: boolean;
  warnings: string[];
  player: PlayerDetail;
}

export interface AuditEntry {
  id: number; at: number; accountId: string | null; credential: string; action: string; target: string | null;
  before: unknown; after: unknown;
}
export interface AuditFilter { action?: string; account?: string; target?: string; before?: number; limit?: number }

export interface RoleRecord { accountId: string; name: string | null; role: ServerRole; grantedBy: string | null; grantedAt: number }
export interface ApiTokenRecord { id: string; label: string; scopes: ApiScope[]; createdBy: string; createdAt: number; lastUsedAt: number | null; expiresAt: number | null }

export interface StatsWorld { providerId: string; worldId: string; name: string; playersOnline: number; capacity: number; tick: number }
export interface ServerEvent { at: number; kind: string; accountId: string | null; detail: string | null }
export interface ServerStats {
  startedAt: number; uptimeSeconds: number;
  worlds: StatsWorld[];
  tick: { samples: number; lastMs: number; meanMs: number; p95Ms: number; maxMs: number };
  stages: { samples: number; simulationMs: number; snapshotMs: number; commitMs: number; replicationMs: number };
  commands: number; rejected: number; errors: number; backlogDisconnects: number;
  bytesOut: number; bytesOutPerSecond: number;
  memory: { rssBytes: number; heapUsedBytes: number };
  events: ServerEvent[];
  catalogRevision: string;
  server: {
    name: string; description: string | null; endpoint: string; assetBaseUrl: string | null; identityUrl: string | null;
    authentication: string; catalogRevision: string; host: string; registerWithDirectory: boolean;
    worlds: { providerId: string; worldId: string; name: string; seed: number; capacity: number }[];
  };
}

export interface ServerSettings { name: string; description: string | null; registerWithDirectory: boolean; capacity: Record<string, number> }
/** What is in force, what an admin stored over the configuration, and what the configuration says. */
export interface SettingsPayload { settings: ServerSettings; overrides: Record<string, unknown>; defaults: ServerSettings }

export interface RevisionMove { id: number; revision: string; previous: string | null; by: string | null; at: number }
export interface RevisionPayload { revision: string; history: RevisionMove[] }

/** The publish reply, as the rollback action reports it. Mirrors `PublishResult`. */
export interface RollbackResult {
  revision: string; previous: string; unchanged: boolean; stored: boolean;
  changedCollections: string[]; changedTables: string[]; live: string[]; onRestart: string[];
  spawns: { world: string; added: number; pending: number; retiring: number; removed: number }[];
  notified: number;
}

const call = <T,>(path: string, init?: { method?: string; body?: unknown }): Promise<T> => backend().admin<T>(path, init);

const query = <T,>(key: readonly unknown[], path: string, extra: { staleTime?: number; refetchInterval?: number | false } = {}) =>
  queryOptions({ queryKey: ["admin", ...key], queryFn: ({ signal }) => backend().admin<T>(path, { signal }), staleTime: 5_000, retry: false, ...extra });

const search = (params: Readonly<Record<string, string | number | undefined>>): string => {
  const parts = Object.entries(params).filter(([, value]) => value !== undefined && value !== "").map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`);
  return parts.length ? `?${parts.join("&")}` : "";
};

/** One page of the population. The rail pages through it; other views want the first page for names. */
export const listPlayers = (text: string, cursor?: string, signal?: AbortSignal): Promise<PlayerPage> =>
  backend().admin<PlayerPage>(`/admin/players${search({ query: text, limit: 25, cursor })}`, signal ? { signal } : {});
export const playersQuery = (text: string, cursor?: string) =>
  query<PlayerPage>(["players", text, cursor ?? ""], `/admin/players${search({ query: text, limit: 25, cursor })}`, { staleTime: 2_000 });
export const playerQuery = (accountId: string | undefined) => ({
  ...query<PlayerDetail>(["player", accountId ?? ""], `/admin/players/${encodeURIComponent(accountId ?? "")}`, { staleTime: 1_000 }),
  enabled: Boolean(accountId),
});
export const statsQuery = (live: boolean) => query<ServerStats>(["stats"], "/admin/stats", { staleTime: 0, refetchInterval: live ? 1_000 : false });
export const auditQuery = (filter: AuditFilter) =>
  query<{ entries: AuditEntry[] }>(["audit", filter.action ?? "", filter.account ?? "", filter.target ?? "", filter.before ?? 0, filter.limit ?? 50],
    `/admin/audit${search({ action: filter.action, account: filter.account, target: filter.target, before: filter.before, limit: filter.limit ?? 50 })}`, { staleTime: 2_000 });
export const rolesQuery = () => query<{ roles: RoleRecord[] }>(["roles"], "/admin/roles");
export const tokensQuery = () => query<{ tokens: ApiTokenRecord[] }>(["tokens"], "/admin/tokens");
export const settingsQuery = () => query<SettingsPayload>(["settings"], "/admin/settings");
export const revisionQuery = () => query<RevisionPayload>(["revision"], "/admin/content/revision?limit=50", { staleTime: 2_000 });

export const editPlayer = (accountId: string, ops: readonly PlayerOp[], expect: string | null): Promise<PlayerEditResult> =>
  call(`/admin/players/${encodeURIComponent(accountId)}`, { method: "PATCH", body: { ops, ...(expect ? { expect: { revision: expect } } : {}) } });
export const kickPlayer = (accountId: string, reason: string): Promise<{ kicked: boolean }> =>
  call(`/admin/players/${encodeURIComponent(accountId)}/kick`, { method: "POST", body: reason.trim() ? { reason: reason.trim() } : {} });
export const banPlayer = (accountId: string, reason: string, expiresAt: number | null): Promise<{ ban: BanRecord; kicked: boolean }> =>
  call("/admin/bans", { method: "POST", body: { accountId, reason, ...(expiresAt === null ? {} : { expiresAt }) } });
export const liftBan = (accountId: string): Promise<{ ok: true }> => call(`/admin/bans/${encodeURIComponent(accountId)}`, { method: "DELETE" });

export const grantAdmin = (accountId: string): Promise<{ role: RoleRecord }> => call(`/admin/roles/${encodeURIComponent(accountId)}`, { method: "PUT", body: { role: "admin" } });
export const revokeRole = (accountId: string): Promise<{ ok: true }> => call(`/admin/roles/${encodeURIComponent(accountId)}`, { method: "DELETE" });

export const createToken = (input: { label: string; scopes: readonly ApiScope[]; expiresAt: number | null }): Promise<ApiTokenRecord & { token: string }> =>
  call("/admin/tokens", { method: "POST", body: { label: input.label, scopes: [...input.scopes], ...(input.expiresAt === null ? {} : { expiresAt: input.expiresAt }) } });
export const revokeToken = (id: string): Promise<{ ok: true }> => call(`/admin/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });

export const patchSettings = (changes: Record<string, unknown>): Promise<SettingsPayload> => call("/admin/settings", { method: "PATCH", body: changes });
export const rollbackTo = (revision: string): Promise<RollbackResult> => call("/admin/content/rollback", { method: "POST", body: { revision } });

/**
 * What to show an operator when an admin call fails. The API's codes are turned into the sentence
 * that says what to do about it; anything else keeps the server's own message, which is written for
 * a person already.
 */
export function failureMessage(error: unknown): string {
  if (!(error instanceof AdminFailure)) return error instanceof Error ? error.message : "That did not work.";
  switch (error.code) {
    case "revision_mismatch": return "This player changed while the edit was open. Their record has been reloaded; check it and apply again.";
    case "player_busy": return "That player was being saved at that moment. Try again.";
    case "not_online": return "That player is not connected, so there was nobody to disconnect.";
    case "already_active": return "That revision is already the active catalog.";
    case "forbidden": return `${error.message}.`.replace(/\.\.$/, ".");
    default: return error.message;
  }
}
/** The failing operation's index, when the API named one. */
export const failedOpIndex = (error: unknown): number | null =>
  error instanceof AdminFailure && typeof error.details.op === "number" ? error.details.op : null;
