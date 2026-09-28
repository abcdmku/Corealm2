import type { AssetCategory, AssetEntry } from "./assets.js";
import { CONTENT_ASSET_PATH } from "../multiplayer/contentAssetsContract.js";

/**
 * Models a server adds (`CONTENT_MANIFEST_OVERLAY`), merged over the asset host's manifest by id.
 *
 * No three.js here: the server's publish pools, the client registry and devdocs all read an overlay
 * through this module. An overlay comes from a server's file store, so it is parsed, never trusted:
 * an entry needs an id, a model file the store may hold, a category and a measured size.
 */

export const ASSET_CATEGORIES: readonly AssetCategory[] = ["nature", "rock", "building", "prop", "farm", "dungeon", "character", "outfit", "weapon", "animation", "water"];
/** An asset id: what content rows and file names use. */
export const ASSET_ID = /^[a-z0-9][a-z0-9_-]{0,95}$/;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const vector = (value: unknown): value is { x: number; y: number; z: number } =>
  value !== null && typeof value === "object" && ["x", "y", "z"].every(key => finite((value as Record<string, unknown>)[key]));
const names = (value: unknown): value is string[] => Array.isArray(value) && value.every(entry => typeof entry === "string");

/** One overlay entry, or the reason it is refused. */
export function overlayEntryProblem(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "not an object";
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== "string" || !ASSET_ID.test(entry.id)) return "id must be lowercase letters, digits, - and _";
  if (typeof entry.file !== "string" || !entry.file.startsWith("models/") || !entry.file.endsWith(".glb") || !CONTENT_ASSET_PATH.test(`assets/${entry.file}`)) return `${entry.id}: file must be models/<category>/<name>.glb`;
  if (!ASSET_CATEGORIES.includes(entry.category as AssetCategory)) return `${entry.id}: unknown category`;
  if (typeof entry.pack !== "string" || typeof entry.is !== "string" || !names(entry.tags)) return `${entry.id}: pack, is and tags are required`;
  if (!vector(entry.size) || !(entry.size.x >= 0 && entry.size.y >= 0 && entry.size.z >= 0)) return `${entry.id}: size must be measured`;
  if (entry.base !== undefined && !vector(entry.base)) return `${entry.id}: base must be x, y, z`;
  if (!finite(entry.bytes) || !names(entry.animations) || !names(entry.materials)) return `${entry.id}: bytes, animations and materials are required`;
  for (const key of ["groundY", "walkClipSeconds", "runClipSeconds", "impliedWalkMps", "impliedRunMps", "attackSeconds", "contactNormalized"]) {
    if (entry[key] !== undefined && !finite(entry[key])) return `${entry.id}: ${key} must be a number`;
  }
  return null;
}

/** The entries of an overlay file that may be used. A malformed entry is dropped, and a malformed file is empty. */
export function parseManifestOverlay(value: unknown): AssetEntry[] {
  const assets = (value as { assets?: unknown } | null)?.assets;
  if (!Array.isArray(assets)) return [];
  const seen = new Set<string>();
  return assets.filter((entry): entry is AssetEntry => {
    if (overlayEntryProblem(entry) !== null || seen.has((entry as AssetEntry).id)) return false;
    seen.add((entry as AssetEntry).id);
    return true;
  });
}

/** The host's entries with the overlay's over them by id: a replaced entry keeps its place, a new one is appended. */
export function mergeManifestEntries(host: readonly AssetEntry[], overlay: readonly AssetEntry[]): AssetEntry[] {
  const byId = new Map(overlay.map(entry => [entry.id, entry]));
  const merged = host.map(entry => byId.get(entry.id) ?? entry);
  const hostIds = new Set(host.map(entry => entry.id));
  return [...merged, ...overlay.filter(entry => !hostIds.has(entry.id))];
}

/** An overlay with one entry added or replaced (`entry`), or removed (`remove`). Order is kept. */
export function editManifestOverlay(current: readonly AssetEntry[], change: { entry: AssetEntry } | { remove: string }): { assets: AssetEntry[] } {
  if ("remove" in change) return { assets: current.filter(entry => entry.id !== change.remove) };
  const problem = overlayEntryProblem(change.entry);
  if (problem) throw new Error(`A model entry is invalid: ${problem}`);
  const at = current.findIndex(entry => entry.id === change.entry.id);
  return { assets: at < 0 ? [...current, change.entry] : current.map((entry, index) => index === at ? change.entry : entry) };
}

/**
 * The encounter footprint radius of a measured model, metres at scale 1: half its wider horizontal
 * extent, the formula `tools/build-encounter-footprints.ts` bakes into `ENCOUNTER_ASSET_RADII`.
 */
export function footprintRadius(size: { x: number; z: number }): number {
  return Number((Math.max(size.x, size.z) / 2).toFixed(5));
}
