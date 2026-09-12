import * as THREE from 'three';
import { mkdir, writeFile } from 'node:fs/promises';
import { WorldScene } from '../game/src/render/scene.js';
import { buildFairyTerrainSpec } from '../game/src/app/worldSpec.js';
import { prepareWorldSurface } from '../game/src/app/worldSurface.js';

const scene = new WorldScene(new THREE.Scene());
scene.buildWorld(buildFairyTerrainSpec(), prepareWorldSurface);
const report: any = { coverage: [], roads: [] };
for (const [region, minZ, maxZ] of [['gloamgarden', -200, 130], ['faeholme', 130, 460]] as const) {
  let raised = 0, total = 0;
  for (let x = 2005; x < 2595; x += 5) for (let z = minZ + 5; z < maxZ - 5; z += 5) {
    total++; if (scene.meshHeightAt(x, z) > -117) raised++;
  }
  report.coverage.push({ region, raised, total, fraction: raised / total });
}
for (const [id, line] of scene.getRoadPolylines().entries()) {
  let maxGrade = 0, worst: unknown;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!, b = line[i]!, length = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const count = Math.ceil(length / .4), nx = -(b[2] - a[2]) / length, nz = (b[0] - a[0]) / length;
    for (let step = 0; step <= count; step++) for (const offset of [-.45, 0, .45]) {
      const x = a[0] + (b[0] - a[0]) * step / count + nx * offset;
      const z = a[2] + (b[2] - a[2]) * step / count + nz * offset;
      const grade = scene.slopeAt(x, z);
      if (grade > maxGrade) { maxGrade = grade; worst = [x, z, scene.meshHeightAt(x, z)]; }
    }
  }
  report.roads.push({ id, from: line[0], to: line.at(-1), maxGrade, worst });
}
await mkdir('test-results/fairy-terraces-world/relief-audit', { recursive: true });
await writeFile('test-results/fairy-terraces-world/relief-audit/report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ coverage: report.coverage, steepRoads: report.roads.filter((road: any) => road.maxGrade > 1.3) }));
scene.clear();
