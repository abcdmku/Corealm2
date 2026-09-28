import type { ServerWorldBake, WorldBakeStatus } from "../../../game/src/world/serverWorldContract.js";
import { queryOptions } from "@tanstack/react-query";
import { backend, type PublishSummary } from "./backend.js";

/*
  The world a live server runs, and the bakes that move it: `GET /admin/world` and the `bake` a publish
  reply carries, parsed. The World workspace's status strip (`workspaces/world/bakeStrip.ts`) and the
  save bar's publish result read these.
*/

/** The status route (`game/src/multiplayer/adminWorld.ts`). `GET` reads the world status; `POST {}` bakes the active catalog's world again. */
export const WORLD_STATUS_PATH = "/admin/world";

/**
 * Tables a publish changes only through a server world bake: `CATALOG_TABLE_APPLIES` in
 * `game/src/multiplayer/catalogHost.ts` marks them `rebake`. That module is server-only, so the list
 * is repeated here and a test holds the two equal.
 */
export const WORLD_REBAKE_TABLES: readonly string[] = ["resourcePlacements", "worldRegions", "worldTerrain"];

export const BAKE_STEPS = ["pack", "records", "navmesh", "publish"] as const;
export type BakeStepName = (typeof BAKE_STEPS)[number];

export interface WorldStatus {
  /** The geometry revision every world runs now. */
  revision: string;
  /** The build's own world: the server's geometry content still matches the base game. */
  base: boolean;
  /** The bake queued or running, if any. */
  active?: ServerWorldBake;
  /** Finished bakes, newest first. */
  history: ServerWorldBake[];
  /** The server accepts `POST /admin/world` to bake again. */
  canBake: boolean;
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const STATUSES: readonly WorldBakeStatus[] = ["queued", "baking", "ready", "failed", "superseded"];

/** One bake record, or undefined when the server sent something else. */
export function parseBake(value: unknown): ServerWorldBake | undefined {
  if (!record(value) || typeof value.revision !== "string" || !STATUSES.includes(value.status as WorldBakeStatus)) return undefined;
  const text = (key: string): string | undefined => typeof value[key] === "string" ? value[key] as string : undefined;
  const steps = Array.isArray(value.steps) ? value.steps.filter(record).filter(step => BAKE_STEPS.includes(step.name as BakeStepName)).map(step => ({
    name: step.name as BakeStepName,
    ...(typeof step.ms === "number" ? { ms: step.ms } : {}),
    ...(typeof step.ok === "boolean" ? { ok: step.ok } : {}),
  })) : undefined;
  return {
    revision: value.revision, catalogRevision: text("catalogRevision") ?? "", status: value.status as WorldBakeStatus, queuedAt: text("queuedAt") ?? "",
    ...(text("startedAt") ? { startedAt: text("startedAt") } : {}),
    ...(text("finishedAt") ? { finishedAt: text("finishedAt") } : {}),
    ...(steps ? { steps } : {}),
    ...(text("error") ? { error: text("error") } : {}),
  };
}

/**
 * `GET /admin/world`. The running revision is `revision` (or `current`, bare or as `{ revision }`);
 * whether it is the base game's own world is `base`, `source` (`base` | `embedded` | `build`), or a
 * `baseRevision` equal to it. A server that says nothing either way is taken as running the base.
 */
export function parseWorldStatus(body: unknown): WorldStatus | undefined {
  if (!record(body)) return undefined;
  const current = record(body.current) ? body.current.revision : body.current;
  const revision = typeof body.revision === "string" ? body.revision : typeof current === "string" ? current : "";
  if (!revision) return undefined;
  const base = typeof body.base === "boolean" ? body.base
    : typeof body.source === "string" ? ["base", "embedded", "build"].includes(body.source)
    : typeof body.baseRevision === "string" ? body.baseRevision === revision : true;
  // The server names the running bake `active` and the next one `queued`; the strip shows whichever comes first.
  const active = parseBake(body.active) ?? parseBake(body.queued);
  const history = (Array.isArray(body.history) ? body.history : []).map(parseBake).filter((bake): bake is ServerWorldBake => Boolean(bake));
  return { revision, base, ...(active ? { active } : {}), history, canBake: body.canBake !== false };
}

/** The world status, read again every two seconds while a bake is queued or running. */
export const worldStatusQuery = () => queryOptions({
  queryKey: ["admin", "world"],
  queryFn: async ({ signal }) => parseWorldStatus(await backend().admin<unknown>(WORLD_STATUS_PATH, { signal })) ?? null,
  staleTime: 2_000, retry: false,
  refetchInterval: query => { const active = query.state.data?.active?.status; return active === "queued" || active === "baking" ? 2_000 : false; },
});

/** Bake the active catalog's world again, after a failed bake. Resolves to the new status. */
export const bakeWorld = async (): Promise<WorldStatus | undefined> => parseWorldStatus(await backend().admin<unknown>(WORLD_STATUS_PATH, { method: "POST", body: {} }));

export interface PublishGroups {
  live: readonly string[];
  /** Tables that wait for the world bake the publish started. */
  rebuilding: readonly string[];
  onRestart: readonly string[];
  /** The publish queued a world bake, so the result links to its status. */
  bakeQueued: boolean;
}

/** Splits the publish reply's "not live" tables into those a world bake carries and those a restart does. */
export function publishGroups(summary: PublishSummary): PublishGroups {
  const rebake = new Set(WORLD_REBAKE_TABLES);
  return {
    live: summary.live,
    rebuilding: summary.onRestart.filter(name => rebake.has(name)),
    onRestart: summary.onRestart.filter(name => !rebake.has(name)),
    bakeQueued: Boolean(summary.bake),
  };
}
