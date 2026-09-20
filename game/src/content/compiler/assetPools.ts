// This module has only a type import and pure geometry functions; it does not load game content.
import { ALL_PROCEDURAL_GEAR_ASSETS } from '../../render/proceduralGear.js';
import type { ReferencePools } from './references.js';

/**
 * The asset ids content may reference, from an asset host's `assets/manifest.json` as parsed JSON.
 * The caller fetches or reads the manifest, so the same check runs against the repo's public tree
 * and against a live server's remote asset host. `files` adds public file paths the manifest does
 * not list, which today is the audio tree. Authored ids come from the compiler, never from here.
 */
export function assetReferencePools(manifest: unknown, files: Iterable<string> = []): ReferencePools {
  const assets = (manifest as { assets?: unknown } | null)?.assets;
  if (!Array.isArray(assets) || !assets.every(row => typeof (row as { id?: unknown } | null)?.id === 'string')) throw new Error('The asset manifest must be {"assets":[{"id":"..."}]}');
  return { asset: new Set([...assets.map(row => (row as { id: string }).id), ...ALL_PROCEDURAL_GEAR_ASSETS.map(row => row.assetId), ...files]) };
}
