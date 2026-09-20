import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { assetReferencePools } from '../../game/src/content/compiler/assetPools.js';
import type { ReferencePools } from '../../game/src/content/compiler/references.js';
import { repoRoot } from '../lib/paths.js';

/** The repo's own asset host: `game/public`. Devdocs and `content:check` validate against the same pools. */
export async function readRepoReferencePools(publicRoot = path.join(repoRoot, 'game/public')): Promise<ReferencePools> {
  const audio: string[] = [];
  for (const entry of await readdir(path.join(publicRoot, 'audio'), { recursive: true, withFileTypes: true }))
    if (entry.isFile()) audio.push(path.relative(publicRoot, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
  return assetReferencePools(JSON.parse(await readFile(path.join(publicRoot, 'assets/manifest.json'), 'utf8')), audio);
}
