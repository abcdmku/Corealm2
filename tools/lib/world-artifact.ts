import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Plugin } from 'vite';
import { generationRevision } from './generation-revision.js';
import { buildWorldTerrainSpec, buildFairyTerrainSpec } from '../../game/src/app/worldSpec.js';
import { scatterTilesForBounds } from '../../game/src/world/scatter.js';
import type { WorldDataManifest } from '../../game/src/world/worldDataFormat.js';
import { assertNavigationArtifact } from '../build-navmesh.js';

export function expectedWorldTiles(): string[] {
  return [buildWorldTerrainSpec(), buildFairyTerrainSpec()].flatMap(spec => {
    const padding = spec.coast?.collar ?? 0;
    return scatterTilesForBounds({ minX: spec.bounds.minX - padding, maxX: spec.bounds.maxX + padding,
      minZ: spec.bounds.minZ - padding, maxZ: spec.bounds.maxZ + padding }).map(tile => tile.id);
  });
}

export async function assertWorldData(root: string): Promise<WorldDataManifest> {
  const directory = path.join(root, 'public/generated/world');
  try {
    await assertNavigationArtifact();
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')) as WorldDataManifest;
    const tiles = expectedWorldTiles();
    if (manifest.format !== 'corealm-world' || manifest.version !== 1 || manifest.scope !== 'game/1337/world'
      || manifest.revision !== generationRevision(root)) throw new Error('Stale world revision');
    const expected = ['terrain/world', 'terrain/fairy', 'spawns/world', ...tiles.map(tile => `scatter/${tile}`)].sort();
    if (JSON.stringify(manifest.tiles) !== JSON.stringify(tiles)
      || JSON.stringify(Object.keys(manifest.records).sort()) !== JSON.stringify(expected)) throw new Error('Incomplete island coverage');
    if (Object.values(manifest.records).reduce((sum, record) => sum + record.bytes, 0) > 128 * 1024 * 1024)
      throw new Error('Compressed world exceeds the 128 MiB release budget');
    await Promise.all(Object.values(manifest.records).map(async record => {
      if (!/^[a-f0-9]{64}\.world$/.test(record.file)) throw new Error('Invalid world filename');
      const bytes = await readFile(path.join(directory, record.file));
      if (bytes.length !== record.bytes || createHash('sha256').update(bytes).digest('hex') !== record.sha256) throw new Error(`Damaged world file ${record.file}`);
    }));
    return manifest;
  } catch (error) { throw new Error(`Release world data is missing, stale or incomplete. Run npm run world:build. ${String(error)}`); }
}

export function worldDataBuildGuard(): Plugin {
  let root = '';
  return { name: 'corealm-release-world', apply: 'build', configResolved(config) {
    if (!config.isProduction) throw new Error('Released game bundles require NODE_ENV=production');
    root = path.resolve(config.root);
  },
    async buildStart() { await assertWorldData(root); } };
}
