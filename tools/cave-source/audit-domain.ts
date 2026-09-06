import { NodeIO } from '@gltf-transform/core';
import { mkdir, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { caveEnvelopeSampler, caveSourceCoordinates } from '../../game/src/render/caveSourceDomain.js';

const document = await new NodeIO().read('art/rebuild/candidates/finish-cave-source/v7/models/cave/rock-face-01.glb');
const primitive = document.getRoot().listMeshes()[0]!.listPrimitives()[0]!, geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute(primitive.getAttribute('POSITION')!.getArray()!, 3));
const sample = caveEnvelopeSampler(geometry, 64, 56), scale = 1.3;
function correlation(a: number[], b: number[]): number {
  const am = a.reduce((sum, value) => sum + value, 0) / a.length, bm = b.reduce((sum, value) => sum + value, 0) / b.length;
  const covariance = a.reduce((sum, value, i) => sum + (value - am) * (b[i]! - bm), 0);
  return covariance / Math.sqrt(a.reduce((sum, value) => sum + (value - am) ** 2, 0) * b.reduce((sum, value) => sum + (value - bm) ** 2, 0));
}
const repeatedPatchCorrelations: number[] = [], jacobians: number[] = [];
for (const originX of [-42, -38, -34, -30, -26]) for (const originY of [-13, -10]) for (const originZ of [-42, -35]) {
  for (const shift of ['horizontal', 'vertical']) {
    const a: number[] = [], b: number[] = [];
    for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) {
      const u = (i + 0.5) / 12 * 3 - 1.5, v = (j + 0.5) / 12 * 2.6;
      a.push(sample(...caveSourceCoordinates(u, v, originX + u * scale, originY + v * scale, originZ)));
      const du = shift === 'horizontal' ? 3 : 0, dv = shift === 'vertical' ? 2.6 : 0;
      b.push(sample(...caveSourceCoordinates(u + du, v + dv, originX + (u + du) * scale, originY + (v + dv) * scale, originZ)));
    }
    repeatedPatchCorrelations.push(correlation(a, b));
  }
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
    const step = 0.001, dx = Math.cos(angle) * step, dz = Math.sin(angle) * step;
    const centre = caveSourceCoordinates(0, 0, originX, originY, originZ);
    const along = caveSourceCoordinates(step / scale, 0, originX + dx, originY, originZ + dz);
    const up = caveSourceCoordinates(0, step / scale, originX, originY + step, originZ);
    jacobians.push(((along[0] - centre[0]) * (up[1] - centre[1]) - (along[1] - centre[1]) * (up[0] - centre[0])) / step ** 2);
  }
}
const distribution = (values: number[]) => { values.sort((a, b) => a - b); return { minimum: values[0], median: values[Math.floor(values.length / 2)], p95: values[Math.floor(values.length * 0.95)], maximum: values[values.length - 1] }; };
const report = { translatedPatchPairs: repeatedPatchCorrelations.length, baselineCorrelation: 1,
  warpedCorrelation: distribution(repeatedPatchCorrelations), domainJacobianDeterminant: distribution(jacobians),
  sourceAmplitudeBounds: [geometry.boundingBox!.min.z, geometry.boundingBox!.max.z] };
await mkdir('test-results/finish-cave-source-v7', { recursive: true });
await writeFile('test-results/finish-cave-source-v7/domain-audit.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report)); geometry.dispose();
