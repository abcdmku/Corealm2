import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { WorldScene } from '../game/src/render/scene.js';
import { COMBAT_LAB_BOOT_PROFILE } from '../game/src/app/bootProfile.js';
import { buildWorldTerrainSpec } from '../game/src/app/worldSpec.js';
import { prepareWorldSurface } from '../game/src/app/worldSurface.js';
import { interpolatedGroundHeight } from '../game/src/render/terrainContact.js';

describe('drawn terrain contact', () => {
  it.each([64, 70])('matches ray hits with a %s metre requested chunk size', (chunkSize) => {
    const scene = new WorldScene(new THREE.Scene());
    const spec = COMBAT_LAB_BOOT_PROFILE.terrain();
    spec.regions[0]!.amplitude = 180;
    spec.chunkSize = chunkSize;
    const meshes = scene.buildWorld(spec);
    for (const mesh of meshes) mesh.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    let maxError = 0;
    for (let x=-100; x<=100; x+=7.3) for(let z=-100;z<=100;z+=9.7) {
      ray.set(new THREE.Vector3(x, 300, z), new THREE.Vector3(0,-1,0));
      const hit = ray.intersectObjects(meshes, false)[0];
      expect(hit).toBeDefined();
      maxError = Math.max(maxError, Math.abs(hit!.point.y-scene.meshHeightAt(x,z)));
    }
    expect(maxError).toBeLessThan(0.0001);
    scene.clear();
  });
  it('keeps coastal foothills low while retaining the authored Highland plateau', () => {
    const scene = new WorldScene(new THREE.Scene());
    const meshes = scene.buildWorld(buildWorldTerrainSpec(), prepareWorldSurface);
    expect(scene.meshHeightAt(0, -242)).toBeLessThan(30);
    expect(scene.meshHeightAt(48, -290)).toBeLessThan(15);
    expect(scene.meshHeightAt(210, 268)).toBeLessThan(25);
    expect(scene.meshHeightAt(194, -132)).toBeGreaterThan(40);
    for (let x = -450; x <= 450; x += 37) for (let z = -320; z <= 560; z += 41) {
      const sample = scene.sampleWorld(x, z), placement = scene.placementSurfaceAt(x, z);
      expect(placement !== null).toBe(sample.playable);
      if (placement) expect(placement).toEqual({ height: sample.height, slope: sample.slope,
        semanticRegion: sample.semanticRegion, waterBodyId: sample.waterBodyId });
    }
    for (const mesh of meshes) mesh.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    for (let x=-340.3; x<350; x+=31.7) for(let z=-190.7; z<460; z+=29.3) {
      ray.set(new THREE.Vector3(x, 300, z), new THREE.Vector3(0,-1,0));
      const hit = ray.intersectObjects(meshes, false)[0];
      expect(hit).toBeDefined();
      expect(Math.abs(hit!.point.y-scene.meshHeightAt(x,z))).toBeLessThan(0.0001);
    }
    scene.clear();
  });
  it('follows a valley between grounded ticks without pulling a bridge down', () => {
    const h = (x:number) => Math.abs(x);
    expect(interpolatedGroundHeight([-1,1,0],[1,1,0],[0,1,0],h)).toBe(0);
    expect(interpolatedGroundHeight([-1,5,0],[1,5,0],[0,5,0],h)).toBe(5);
  });
});
