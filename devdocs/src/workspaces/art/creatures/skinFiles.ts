/*
  Plain facts about skin map files for the raw file view and the upload form: where a map lives in
  the repo, how a hand-made map's size compares with the model's own, and short labels. Pure; the
  canvas and network work lives in `skinApi.ts`.
*/

export interface PixelSize { width: number; height: number }

/** A skin map path as stored in the record (`skins/<asset>/<skin>/<mat>.png`), from the repo root. */
export const repoPathOfSkinMap = (path: string): string => `game/public/assets/${path.replace(/^\/+/, "")}`;

/**
 * Why an uploaded map may not line up with the model's UVs, or undefined when it matches. A
 * different aspect distorts the paint; a different size with the same aspect only rescales it.
 */
export function sizeWarning(expected: PixelSize, actual: PixelSize): string | undefined {
  if (expected.width === actual.width && expected.height === actual.height) return undefined;
  const size = `${actual.width}×${actual.height}, the model's map is ${expected.width}×${expected.height}`;
  const sameAspect = Math.abs(actual.width / actual.height - expected.width / expected.height) < 0.01;
  return sameAspect ? `${size}: same aspect, it will be sampled at another resolution.` : `${size}: a different aspect stretches the paint across the UVs.`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

export const shortSha = (sha: string | undefined): string | undefined => sha ? sha.slice(0, 12) : undefined;

/** A download name: `<skin or model>-<material>.png`, safe for any file system. */
export function downloadName(owner: string, material: string, suffix = ""): string {
  const safe = (text: string) => text.normalize("NFKD").replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "map";
  return `${safe(owner)}-${safe(material)}${suffix}.png`;
}

/** Image files the upload accepts; each is converted to PNG before saving. */
export const UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const isUploadType = (type: string): boolean => (UPLOAD_TYPES as readonly string[]).includes(type);
