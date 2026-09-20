import { expect, it } from 'vitest';
import { assertWorldData, expectedWorldTiles, worldDataBuildGuard } from '../tools/lib/world-artifact.js';
import { gameRoot } from '../tools/lib/paths.js';
import { WORLD_SITES } from '../game/src/content/worldSites.js';
import { assertServerWorldPack, RELEASE_WORLD_SEED } from '../tools/build-server-world-pack.js';
import { generationRevision } from '../tools/lib/generation-revision.js';

it('rejects development semantics even when the Vite command is build', () => {
  const guard = worldDataBuildGuard().configResolved as (config: any) => void;
  expect(() => guard({ root: gameRoot, isProduction: false })).toThrow('NODE_ENV=production');
  expect(() => guard({ root: gameRoot, isProduction: true })).not.toThrow();
});

it('ships current, intact world records for every island tile', async () => {
  const manifest = await assertWorldData(gameRoot);
  expect(manifest.tiles).toEqual(expectedWorldTiles());
  expect(manifest.tiles.length).toBeGreaterThan(100);
  expect(Object.keys(manifest.records)).toHaveLength(manifest.tiles.length + 5
    + WORLD_SITES.filter(site => site.dressing.length && site.cutFace?.stations.length).length);
  expect(manifest.records['terrain/fairy']).toBeDefined();
});

it('ships a server world pack baked from the same revision as the world records', async () => {
  const pack = await assertServerWorldPack();
  expect(pack.revision).toBe(generationRevision(gameRoot));
  expect(pack.seeds).toContain(RELEASE_WORLD_SEED);
  const world = pack.worlds.get(RELEASE_WORLD_SEED)!;
  expect(world.nav.polyCount).toBeGreaterThan(10_000);
  expect(world.trees.length).toBeGreaterThan(1000);
  expect(world.terrain.main.lattice.heights.length).toBe(world.terrain.main.lattice.cols * world.terrain.main.lattice.rows);
});
