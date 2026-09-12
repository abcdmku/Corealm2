import { expect, it } from 'vitest';
import { assertWorldData, expectedWorldTiles, worldDataBuildGuard } from '../tools/lib/world-artifact.js';
import { gameRoot } from '../tools/lib/paths.js';

it('rejects development semantics even when the Vite command is build', () => {
  const guard = worldDataBuildGuard().configResolved as (config: any) => void;
  expect(() => guard({ root: gameRoot, isProduction: false })).toThrow('NODE_ENV=production');
  expect(() => guard({ root: gameRoot, isProduction: true })).not.toThrow();
});

it('ships current, intact world records for every island tile', async () => {
  const manifest = await assertWorldData(gameRoot);
  expect(manifest.tiles).toEqual(expectedWorldTiles());
  expect(manifest.tiles.length).toBeGreaterThan(100);
  expect(Object.keys(manifest.records)).toHaveLength(manifest.tiles.length + 2);
});
