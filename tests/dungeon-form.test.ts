import * as THREE from 'three';
import { expect, it } from 'vitest';
import { buildDungeon, type DungeonSpec } from '../game/src/render/dungeon.js';
import { MaterialLibrary } from '../game/src/render/materials.js';

it('forms recessed standing-height faces and projecting upper shoulders in production rock', () => {
  const spec: DungeonSpec = { regionId: 'gravelmaw',
    chambers: [{ id: 'form', name: 'Form', centre: [-36, -36], radius: 5, floorY: -12, lit: true }],
    corridors: [], wallHeight: 8 };
  const built = buildDungeon(spec, new MaterialLibrary());
  const wall = built.group.getObjectByName('dungeon-wall') as THREE.Mesh;
  built.group.updateMatrixWorld(true);
  const distance = (angle: number, rise: number): number => {
    const ray = new THREE.Raycaster(new THREE.Vector3(-36, -12 + rise, -36),
      new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)));
    const hit = ray.intersectObject(wall)[0];
    expect(hit, `wall at angle ${angle}, rise ${rise}`).toBeDefined();
    return hit!.distance;
  };
  const lowerRelief: number[] = [], upperShoulders: number[] = [], standingDistances: number[] = [];
  for (let i = 0; i < 48; i++) {
    const angle = i * Math.PI / 24;
    const footing = distance(angle, 0.3), standing = distance(angle, 2.4);
    standingDistances.push(standing);
    // The unchanged authored play radius stays entirely open at standing height.
    expect(Math.min(footing, standing)).toBeGreaterThan(5);
    lowerRelief.push(Math.abs(footing - standing));
    upperShoulders.push(standing - distance(angle, 6));
  }
  expect(lowerRelief.filter(value => value > 0.25).length).toBeGreaterThan(12);
  expect(upperShoulders.filter(value => value > 1).length).toBeGreaterThan(12);
  expect(Math.max(...standingDistances) - Math.min(...standingDistances)).toBeGreaterThan(2);
  // Prove enclosure from inside the newly authored bays, beyond the original circular footprint.
  const roof = built.group.getObjectByName('dungeon-ceiling') as THREE.Mesh;
  let bayProbes = 0;
  for (let i = 0; i < standingDistances.length; i++) {
    if (standingDistances[i]! < 7.2) continue;
    const angle = i * Math.PI / 24, reach = standingDistances[i]! - 0.7;
    const origin = new THREE.Vector3(-36 + Math.cos(angle) * reach, -10.3, -36 + Math.sin(angle) * reach);
    const down = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0));
    const floor = down.intersectObject(built.group, true)[0];
    expect(floor, 'every visible erosion bay has floor coverage').toBeDefined();
    const ceiling = new THREE.Raycaster(origin, new THREE.Vector3(0, 1, 0)).intersectObject(roof)[0];
    expect(ceiling, 'every bay has a continuous opaque roof').toBeDefined();
    expect(ceiling!.point.y - floor!.point.y).toBeGreaterThanOrEqual(4);
    for (let bearing = 0; bearing < 16; bearing++) {
      const heading = bearing * Math.PI / 8;
      const ray = new THREE.Raycaster(origin, new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading)));
      expect(ray.intersectObject(wall)[0], `bay ${i}, bearing ${bearing} stays enclosed`).toBeDefined();
    }
    bayProbes++;
  }
  expect(bayProbes).toBeGreaterThan(4);
  const materials = new Set<THREE.Material>();
  built.group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  for (const material of materials) material.dispose();
});
