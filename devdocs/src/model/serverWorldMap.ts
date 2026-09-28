import { useSyncExternalStore } from "react";
import { parseServerWorldMap, SERVER_WORLD_MAP_METADATA, type ServerWorldMap } from "../../../game/src/world/serverWorldMap.js";
import { backend, can } from "../api/backend.js";
import { parseWorldStatus, WORLD_STATUS_PATH } from "../api/worldBake.js";
import { gameUrl } from "./gameUrl.js";
import { gameFileUrl, onContentFiles, serverFileSha } from "./serverFiles.js";

/*
  Which world map devdocs draws: the live server's own (`game/src/world/serverWorldMap.ts`) when it
  rendered one for the world it runs now, the build's otherwise. The World workspace's map, the
  record maps (`PointsMap`) and the map thumbnails all ask `worldMapFileUrl`.

  The server's map is read whenever its file index names a new `generated/world-map.json`, and checked
  against the running world whenever the world status moves (`noteRunningWorld`).
*/

interface State {
  /** The world geometry the server runs, once known. */
  running: string | null;
  /** The server's map metadata, parsed against nothing yet, and the index hash it was read at. */
  metadata: { sha: string; value: unknown } | null;
  accepted: ServerWorldMap | null;
}

let state: State = { running: null, metadata: null, accepted: null };
const listeners = new Set<() => void>();
let reading: string | undefined;

function settle(next: Partial<State>): void {
  state = { ...state, ...next };
  const accepted = state.running && state.metadata ? parseServerWorldMap(state.metadata.value, state.running) ?? null : null;
  if (sameMap(accepted, state.accepted)) return;
  state = { ...state, accepted };
  for (const listener of listeners) listener();
}

function sameMap(a: ServerWorldMap | null, b: ServerWorldMap | null): boolean {
  if (!a || !b) return a === b;
  if (a.worldRevision !== b.worldRevision || a.files.size !== b.files.size) return false;
  for (const [path, sha] of a.files) if (b.files.get(path) !== sha) return false;
  return true;
}

async function readMetadata(sha: string): Promise<void> {
  reading = sha;
  try {
    const response = await fetch(gameFileUrl(SERVER_WORLD_MAP_METADATA), { credentials: "omit" });
    const value: unknown = response.ok ? await response.json() : null;
    if (reading !== sha) return;
    // The running world is read with it the first time, so a map drawn outside the World workspace is right too.
    const running = state.running ?? (can("publish") ? parseWorldStatus(await backend().admin<unknown>(WORLD_STATUS_PATH).catch(() => null))?.revision ?? null : null);
    if (reading !== sha) return;
    settle({ metadata: { sha, value }, running: state.running ?? running });
  } catch (error) {
    console.warn("Could not read the server's world map", error);
  }
}

onContentFiles(() => {
  const sha = serverFileSha(SERVER_WORLD_MAP_METADATA);
  if (!sha) { reading = undefined; if (state.metadata) settle({ metadata: null }); return; }
  if (sha !== state.metadata?.sha && sha !== reading) void readMetadata(sha);
});

/** The world status says which geometry runs now. `null` in repo mode. */
export function noteRunningWorld(revision: string | null): void {
  if (revision !== state.running) settle({ running: revision });
}

/** The server's map, when it shows the world the server runs now. */
export function serverWorldMapNow(): ServerWorldMap | null { return state.accepted; }

export function useServerWorldMap(): ServerWorldMap | null {
  return useSyncExternalStore(subscribe, serverWorldMapNow, serverWorldMapNow);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Where a map file loads from: the server's file for its accepted map, the build's asset base otherwise. */
export function worldMapFileUrl(path: string, map: ServerWorldMap | null = state.accepted): string {
  return map?.files.has(path) ? gameFileUrl(path) : gameUrl(path);
}
