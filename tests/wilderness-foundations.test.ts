import { it, expect } from 'vitest';
import { Scene, Vector3, Matrix4 } from 'three';
import { WorldScene } from '../game/src/render/scene.js';
import { buildWorldTerrainSpec } from '../game/src/app/worldSpec.js';
import { prepareWorldSurface } from '../game/src/app/worldSurface.js';
import { WILDERNESS_RUIN_SITES } from '../game/src/content/wildernessLandmarks.js';
import { WILDERNESS_RUINS } from '../game/src/render/compositions/wildernessRuins.js';

it('keeps the complete rotated ruin footprints level in the graded production terrain', () => {
  const scene = new WorldScene(new Scene());
  try {
    scene.buildWorld(buildWorldTerrainSpec(), prepareWorldSurface);
    for (const site of WILDERNESS_RUIN_SITES) {
      const [width, depth] = WILDERNESS_RUINS[site.composition].footprint;
      const rotation = new Matrix4().makeRotationY(site.rotationY);
      const centre = scene.meshHeightAt(...site.position);
      for (const x of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
        const point = new Vector3(x * (width / 2 - .6), 0, z * (depth / 2 - .6)).applyMatrix4(rotation);
        const height = scene.meshHeightAt(site.position[0] + point.x, site.position[1] + point.z);
        expect(Math.abs(height - centre), `${site.id} corner ${x},${z}`).toBeLessThan(.02);
      }
    }
  } finally { scene.clear(); }
}, 15000);
