import { contentAssetOverride, publicBaseUrl } from "../app/config.js";
import {
  WORLD_MAP_DETAIL_RENDITIONS, WORLD_MAP_IMAGE_BOUNDS, WORLD_MAP_MINIMAP_RENDITION, WORLD_MAP_TILED_LEVELS,
} from "../generated/worldMapFingerprint.js";

/**
 * A live server's own world map: the renditions an admin rendered in devdocs for the world the
 * server baked (`world/serverWorldContract.ts`), stored in its file store under the build's paths
 * (`generated/world-map*.webp`) with `generated/world-map.json` describing them.
 *
 * A server's map is drawn in the build's frame: the same image bounds, pyramid and tile grid
 * (`world/worldMapRender.ts` `mapLayoutOf`), so the only thing a consumer takes from it is which
 * file to load and the hash that versions it. It is accepted only for the world it shows: its
 * `worldRevision` must be the world the page runs. A server that bakes again, or returns to the base
 * world, keeps the old files until the next render, and those must not be drawn over another world.
 *
 * This module evaluates no content, so the entry (`content/catalogEntry.ts`) can read it before boot.
 */

export const SERVER_WORLD_MAP_METADATA = "generated/world-map.json";

/** Every file the build's map loads, by path. A server map must replace all of them. */
const BUILD_MAP_FILES: readonly string[] = [
  WORLD_MAP_MINIMAP_RENDITION.path,
  ...WORLD_MAP_DETAIL_RENDITIONS.map(rendition => rendition.path),
  ...WORLD_MAP_TILED_LEVELS.flatMap(level => level.tiles.map(tile => tile.path)),
];

/** An accepted server map: the world it shows and each file's sha256. */
export interface ServerWorldMap { worldRevision: string; files: ReadonlyMap<string, string> }

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * A server's `world-map.json`, when it shows `worldRevision` in the build's frame and names every
 * file the build's map has. Anything else is undefined, and the build's own map is drawn instead.
 */
export function parseServerWorldMap(value: unknown, worldRevision: string): ServerWorldMap | undefined {
  if (!record(value) || value.worldRevision !== worldRevision || !record(value.imageBounds) || !record(value.renditions)) return undefined;
  const bounds = value.imageBounds;
  if ((["minX", "maxX", "minZ", "maxZ"] as const).some(key => bounds[key] !== WORLD_MAP_IMAGE_BOUNDS[key])) return undefined;
  const { minimap, detail, tiled } = value.renditions;
  const entries = [minimap, ...(Array.isArray(detail) ? detail : []),
    ...(Array.isArray(tiled) ? tiled.flatMap(level => record(level) && Array.isArray(level.tiles) ? level.tiles : []) : [])];
  const files = new Map<string, string>();
  for (const entry of entries) {
    if (record(entry) && typeof entry.path === "string" && typeof entry.sha256 === "string" && SHA256.test(entry.sha256)) files.set(entry.path, entry.sha256);
  }
  if (BUILD_MAP_FILES.some(path => !files.has(path))) return undefined;
  return { worldRevision, files };
}

let active: ServerWorldMap | null = null;

/** Set by the entry once, on a page that booted a server's baked world whose map was rendered. */
export function setServerWorldMap(map: ServerWorldMap | null): void { active = map; }
export function serverWorldMap(): ServerWorldMap | null { return active; }

/**
 * Where a map file loads from, versioned by its hash: the joined server's file when its map is
 * accepted, the build's otherwise. The build's files come from the asset base, never through the
 * server's file overlay, so a map the server rendered for another world is never mixed in.
 */
export function worldMapUrl(file: { readonly path: string; readonly sha256: string }): string {
  const sha = active?.files.get(file.path);
  const server = sha ? contentAssetOverride(file.path) : null;
  const url = new URL(server ?? `${publicBaseUrl()}${file.path}`, document.baseURI);
  url.searchParams.set("v", server ? sha! : file.sha256);
  return url.href;
}
