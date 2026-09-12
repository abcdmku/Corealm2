import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorldScene } from '../game/src/render/scene.js';
import { buildFairyTerrainSpec } from '../game/src/app/worldSpec.js';
import { prepareWorldSurface } from '../game/src/app/worldSurface.js';
import { FAIRY_UPPER_GARDEN_RAMPS } from '../game/src/world/fairyRegionalRelief.js';
import { FAIRY_GARDEN_SHOULDERS, fairyGardenShoulderRise } from '../game/src/world/fairyGardenShoulders.js';
import { FAIRY_GARDEN_LANDINGS } from '../game/src/world/fairyRegionalRelief.js';

describe('continuous fairy highlands', () => {
  const scene = new WorldScene(new THREE.Scene());
  beforeAll(() => scene.buildWorld(buildFairyTerrainSpec(), prepareWorldSurface));
  afterAll(() => scene.dispose());

  it('raises most of each whole region while retaining a meaningful valley network', () => {
    for (const [minZ, maxZ] of [[-200, 130], [130, 460]]) {
      let raised = 0, total = 0;
      for (let x = 2005; x < 2595; x += 5) for (let z = minZ! + 5; z < maxZ! - 5; z += 5) {
        total++; if (scene.meshHeightAt(x, z) > -117) raised++;
      }
      expect(raised / total).toBeGreaterThan(.65);
      expect(raised / total).toBeLessThan(.85);
    }
  });

  it('connects eight additional upper gardens through gentle physical ascents', () => {
    expect(FAIRY_UPPER_GARDEN_RAMPS).toHaveLength(8);
    for (const ramp of FAIRY_UPPER_GARDEN_RAMPS) {
      const a = ramp.points[0]!.position, b = ramp.points.at(-1)!.position;
      expect(scene.meshHeightAt(...b) - scene.meshHeightAt(...a), ramp.id).toBeGreaterThan(3.5);
      for (let i = 1; i < ramp.points.length; i++) {
        const from = ramp.points[i - 1]!.position, to = ramp.points[i]!.position;
        const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
        expect(Math.abs(scene.meshHeightAt(...to) - scene.meshHeightAt(...from)) / distance, ramp.id).toBeLessThan(.85);
      }
    }
  });

  it('keeps the north village path below connected banks on both sides', () => {
    for (const z of [-54, -49, -44]) {
      const floor = scene.meshHeightAt(2084, z);
      expect(scene.meshHeightAt(2076, z) - floor).toBeGreaterThan(3.5);
      expect(scene.meshHeightAt(2092, z) - floor).toBeGreaterThan(3.5);
    }
  });

  it('joins every ramp crest to its receiving garden without a trench or impassable lip', () => {
    for (const ramp of FAIRY_UPPER_GARDEN_RAMPS) {
      const end = ramp.points.at(-1)!.position, prior = ramp.points.at(-2)!.position;
      const length = Math.hypot(end[0] - prior[0], end[1] - prior[1]);
      const dx = (end[0] - prior[0]) / length, dz = (end[1] - prior[1]) / length;
      const crest = scene.meshHeightAt(...end);
      for (const offset of [-.9, 0, .9]) for (let distance = 0; distance <= 9; distance += .25) {
        const x = end[0] + dx * distance - dz * offset, z = end[1] + dz * distance + dx * offset;
        const height = scene.meshHeightAt(x, z);
        expect(height, `${ramp.id}: landing dip at ${distance}`).toBeGreaterThan(crest - 1);
        expect(scene.slopeAt(x, z), `${ramp.id}: landing grade at ${distance}`).toBeLessThan(.85);
      }
    }
  });

  it('fits unequal wooded shoulders inside the outer gardens while leaving every entrance clear', () => {
    for (const shoulder of FAIRY_GARDEN_SHOULDERS) {
      const [x, z] = shoulder.centre, [rx, rz] = shoulder.radii;
      expect(x - rx).toBeGreaterThan(2000); expect(x + rx).toBeLessThan(2600);
      expect(z - rz).toBeGreaterThan(-200); expect(z + rz).toBeLessThan(460);
      expect(fairyGardenShoulderRise(x, z, FAIRY_GARDEN_LANDINGS)).toBeGreaterThan(3);
    }
    for (const landing of FAIRY_GARDEN_LANDINGS) for (let t = 0; t <= 1; t += .05) {
      const x = landing.from[0] + (landing.to[0] - landing.from[0]) * t;
      const z = landing.from[1] + (landing.to[1] - landing.from[1]) * t;
      expect(fairyGardenShoulderRise(x, z, FAIRY_GARDEN_LANDINGS)).toBe(0);
    }
  });
});
