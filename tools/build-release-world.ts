import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gameRoot } from './lib/paths.js';
import { assertWorldData } from './lib/world-artifact.js';
import { assertNavigationArtifact, buildNavmeshArtifact } from './build-navmesh.js';
import { bakeWorldData } from './build-world.js';

export async function ensureReleaseWorld(): Promise<void> {
  let navigationCurrent = false;
  try { await assertNavigationArtifact(); navigationCurrent = true; }
  catch { /* A missing or invalid bake must be generated before release. */ }
  if (!navigationCurrent) { console.log('Building release navigation'); await buildNavmeshArtifact(); }
  try { await assertWorldData(gameRoot); console.log('Release world data is current'); }
  catch { await bakeWorldData(); await assertWorldData(gameRoot); }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) await ensureReleaseWorld();
