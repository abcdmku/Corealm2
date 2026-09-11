import * as THREE from 'three';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { WorldScene } from '../game/src/render/scene.js';
import { buildWorldTerrainSpec } from '../game/src/app/worldSpec.js';
import { prepareWorldSurface } from '../game/src/app/worldSurface.js';
import { WILDERNESS_LAVA_CHANNELS, lavaSections, carveLavaTerrain, isMoltenLavaAt } from '../game/src/content/wildernessLava.js';
import { buildLavaSurfaceField } from '../game/src/world/lavaSurface.js';
const scene = new WorldScene(new THREE.Scene());
scene.buildWorld({ ...buildWorldTerrainSpec(), lavaChannels: [] }, prepareWorldSurface);
await mkdir('test-results/lava-survey', { recursive: true });
const rows: number[][] = [];
for (let z = 640; z <= 940; z += 4) for (let x = -240; x <= 250; x += 4)
  rows.push([x, z, scene.meshHeightAt(x, z)]);
await writeFile('test-results/lava-survey/heights.json', JSON.stringify(rows));
for (const c of WILDERNESS_LAVA_CHANNELS.filter(c => c.kind !== 'pool')) {
  console.log(c.id, JSON.stringify(lavaSections(c, 15).map(s => [Math.round(s.x), Math.round(s.z), +scene.meshHeightAt(s.x,s.z).toFixed(2)])));
  const sections = lavaSections(c, 1);
  const beds = sections.map(s => carveLavaTerrain(scene.meshHeightAt(s.x,s.z),s.x,s.z));
  const maxUphill = Math.max(...beds.slice(1).map((h,i)=>h-beds[i]!));
  assert(maxUphill < .015, `${c.id} has an uphill bed step of ${maxUphill}`);
  console.log('bed', beds[0], beds.at(-1), 'max uphill', maxUphill);
}
for (const road of scene.getRoadPolylines()) {
  for (const p of road) {
    const h = scene.meshHeightAt(p[0], p[2]);
    assert(Math.abs(h - carveLavaTerrain(h, p[0], p[2])) <= .2, `Lava landform changes road at ${p[0]}, ${p[2]}`);
  }
}

// A measured cross-section of the same final terrain lattice used for movement.
const revised = new WorldScene(new THREE.Scene());
revised.buildWorld(buildWorldTerrainSpec(), prepareWorldSurface);
const lavaHeight = buildLavaSurfaceField(WILDERNESS_LAVA_CHANNELS, (x,z) => revised.meshHeightAt(x,z));
const section = lavaSections(WILDERNESS_LAVA_CHANNELS[0]!).find(row => row.progress >= .5)!;
const profile = [];
for (let offset = -25; offset <= 25; offset += .1) {
  const x = section.x - section.tz * offset, z = section.z + section.tx * offset;
  profile.push({ offset, x, z, original: scene.meshHeightAt(x,z), terrain: revised.meshHeightAt(x,z),
    lava: isMoltenLavaAt(x,z,WILDERNESS_LAVA_CHANNELS) ? lavaHeight(x,z) : null });
}
await writeFile('test-results/lava-survey/cross-section.json', JSON.stringify(profile));
