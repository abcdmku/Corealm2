import type { CollectionResponse, CollectionSummary, ContentTransactionRequest, ContentTransactionResponse } from "../../shared/contracts.js";
import type { TransactionFailure } from "../model/store.js";

/**
 * One interface, two places content can live.
 *
 * `RepoBackend` is the development workflow: the Vite middleware under `/__devdocs/`, which edits
 * `game/content/data/` and everything that lives beside it in the checkout — git, the request queue,
 * authoring notes, asset import, formula source.
 *
 * `ServerBackend` is a running game server's admin API. It has the content and nothing else: there
 * is no checkout behind it, so a save is a publish and the repo-only surfaces are not there at all.
 * The editor asks `capabilities` and leaves those surfaces out rather than letting them 404.
 *
 * Everything the editing UI needs goes through here, so a page never knows which one it is talking
 * to. `devdocs/src/api/client.ts` and the draft store are the only callers that should reach for the
 * backend directly; a page uses their hooks.
 */

/** What a mode can do. Every flag is false in at least one mode, and the UI hides what is false. */
export interface DevdocsCapabilities {
  /** Content can be changed at all. A player guide build reads only. */
  readonly write: boolean;
  /** Authoring metadata beside the content: status, notes, review requests. Repo only. */
  readonly meta: boolean;
  /** The request queue on Home, which is a file in the checkout. Repo only. */
  readonly requests: boolean;
  /** Working-tree status, per-file diff and the Local changes view. Repo only. */
  readonly git: boolean;
  /** Bulk status, note and retier actions, which write metadata. Repo only. */
  readonly bulk: boolean;
  /** Asset import, candidate review, generation and rendered thumbnail capture. Repo only. */
  readonly assets: boolean;
  /** Balance formula source, its preview and the compiled check. Formulas ship with a release. Repo only. */
  readonly formulas: boolean;
  /** A save publishes to a running game server and reports what it changed there. Server only. */
  readonly publish: boolean;
}

/** What a publish did to the running game, shown in the save confirmation. */
export interface PublishSummary {
  revision: string;
  previous: string;
  unchanged: boolean;
  /** Compiled tables the running server reads now, and those it reads again only at its next start. */
  live: readonly string[];
  onRestart: readonly string[];
  /** Changed record ids by collection and by compiled table. */
  affected: Readonly<Record<string, readonly string[]>>;
  /** Per world: creatures added now, living ones waiting for a respawn, retiring and removed. */
  spawns: readonly { world: string; added: number; pending: number; retiring: number; removed: number }[];
  /** Connected players told to refresh. */
  notified: number;
}

/** Who held a definition this save would have removed. `POST /admin/content/publish` 409 `definition_in_use`. */
export interface PublishBlocker {
  kind: "item" | "creature";
  id: string;
  heldBy: "player" | "loot-pile" | "world";
  place?: string;
  accountId?: string;
  name?: string;
  world?: string;
  pileId?: string;
  alive?: number;
}

/** One line per holder, so an author can see who to talk to before retiring a definition. */
export function describeBlocker(blocker: PublishBlocker): string {
  if (blocker.kind === "creature") return `${blocker.id}: ${blocker.alive ?? 0} alive in ${blocker.world ?? "a world"}`;
  if (blocker.heldBy === "loot-pile") return `${blocker.id}: in a loot pile in ${blocker.world ?? "a world"}`;
  const where = blocker.place === "recovery-cache" && blocker.world ? `recovery cache in ${blocker.world}` : blocker.place ?? "inventory";
  return `${blocker.id}: ${blocker.name ?? blocker.accountId ?? "a player"} holds one in their ${where}`;
}

export type TransactionSuccess = ContentTransactionResponse & { revisions?: Record<string, string>; publish?: PublishSummary };
export type TransactionRefusal = TransactionFailure & { blockers?: readonly PublishBlocker[] };
export type BackendTransaction = { ok: true; body: TransactionSuccess } | { ok: false; status: number; body: TransactionRefusal };

export interface DevdocsBackend {
  readonly kind: "repo" | "server" | "player";
  /** Shown in the shell footer, so an author always knows what a save would write to. */
  readonly label: string;
  readonly capabilities: DevdocsCapabilities;
  /** Where models, icons, map tiles and audio load from. Empty means the document base. */
  readonly assetBaseUrl: string;
  /** A read on a devdocs API path, such as `collections` or `meta/items/$all`. */
  get<T>(path: string): Promise<T>;
  /** Every collection the editor can browse. */
  collections(): Promise<CollectionSummary[]>;
  collection(name: string): Promise<CollectionResponse>;
  /** The dry run and the save. Never throws for an answered request; the status is in the result. */
  transact(request: ContentTransactionRequest): Promise<BackendTransaction>;
  /**
   * An authenticated request to this backend's own API, for the surfaces beyond content: players,
   * stats, roles, tokens, settings. `path` is absolute, such as `/admin/players`. Only server mode
   * has one; repo mode and the guide refuse, which is what `can("publish")` gates on.
   */
  admin<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T>;
}

export class BackendUnavailable extends Error {
  constructor(what: string) { super(`${what} is part of the repository checkout and is not available on a live server.`); this.name = "BackendUnavailable"; }
}

let installed: DevdocsBackend | undefined;

export function setBackend(next: DevdocsBackend): void { installed = next; }
export function backend(): DevdocsBackend {
  if (!installed) throw new Error("No devdocs backend is installed");
  return installed;
}
/** Whether this mode has a surface. Safe before a backend is installed, which is how login renders. */
export function can(capability: keyof DevdocsCapabilities): boolean {
  return installed?.capabilities[capability] ?? false;
}
