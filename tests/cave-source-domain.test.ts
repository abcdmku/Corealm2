import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';
import { expect, it } from 'vitest';
import { caveEnvelopeSampler, caveSourceCoordinates } from '../game/src/render/caveSourceDomain.js';

function correlation(a: number[], b: number[]): number {
  const n = a.length, am = a.reduce((s, v) => s + v, 0) / n, bm = b.reduce((s, v) => s + v, 0) / n;
  let c = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { c += (a[i]! - am) * (b[i]! - bm); va += (a[i]! - am) ** 2; vb += (b[i]! - bm) ** 2; }
  return c / Math.sqrt(va * vb);
}

it('keeps neighbouring scan tiles decorrelated without folding the sampling domain across the authored dungeon', async () => {
  const document = await new NodeIO().read('art/rebuild/candidates/finish-cave-source/v7/models/cave/rock-face-01.glb');
  const primitive = document.getRoot().listMeshes()[0]!.listPrimitives()[0]!, geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(primitive.getAttribute('POSITION')!.getArray()!, 3));
  const sample = caveEnvelopeSampler(geometry, 64, 56), scale = 1.3, width = 3.9, height = 3.38;
  const correlations: number[] = [];
  // Wall frames: u follows arc length along several bearings, v follows height; four 3.38 m rows as in the 13 m Gravelmaw.
  for (const bearing of [0, 0.7, 1.4, 2.1, 2.8]) for (let s = 0; s < 60; s += width) for (let row = 0; row < 4; row++) {
    const x0 = 20 + Math.cos(bearing) * s, z0 = -60 + Math.sin(bearing) * s, y0 = -30 + row * height;
    const tile = (du: number, dy: number): number[] => {
      const values: number[] = [];
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
        const along = (i + 0.5) / 8 * width + du * width, up = (j + 0.5) / 8 * height + dy * height;
        values.push(sample(...caveSourceCoordinates((s + along) / scale, (y0 + up) / scale,
          x0 + Math.cos(bearing) * along, y0 + up, z0 + Math.sin(bearing) * along)));
      }
      return values;
    };
    correlations.push(correlation(tile(0, 0), tile(1, 0)), correlation(tile(0, 0), tile(0, 1)));
  }
  // Roof frames: u and v follow world x and z at a fixed roof height.
  for (let x = 0; x < 40; x += width) for (let z = -100; z < -60; z += height) {
    const tile = (kx: number, kz: number): number[] => {
      const values: number[] = [];
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
        const px = x + kx * width + (i + 0.5) / 8 * width, pz = z + kz * height + (j + 0.5) / 8 * height;
        values.push(sample(...caveSourceCoordinates(px / scale, pz / scale, px, -20, pz)));
      }
      return values;
    };
    correlations.push(correlation(tile(0, 0), tile(1, 0)), correlation(tile(0, 0), tile(0, 1)));
  }
  correlations.sort((a, b) => a - b);
  const nearCopies = correlations.filter(value => value > 0.6).length / correlations.length;
  expect(correlations.length).toBeGreaterThan(500);
  expect(correlations[Math.floor(correlations.length * 0.95)]!).toBeLessThan(0.62);
  expect(nearCopies).toBeLessThan(0.05);
  let minimumDeterminant = Infinity;
  const step = 0.001;
  for (let x = -40; x <= 60; x += 2.3) for (let y = -35; y <= -5; y += 3.1) for (let z = -110; z <= -20; z += 2.9) {
    const centre = caveSourceCoordinates(0, 0, x, y, z);
    for (const angle of [0, 0.8, 1.6, 2.4]) {
      const along = caveSourceCoordinates(step / scale, 0, x + Math.cos(angle) * step, y, z + Math.sin(angle) * step);
      const up = caveSourceCoordinates(0, step / scale, x, y + step, z);
      minimumDeterminant = Math.min(minimumDeterminant, ((along[0] - centre[0]) * (up[1] - centre[1]) - (along[1] - centre[1]) * (up[0] - centre[0])) / step ** 2 * scale * scale);
    }
    const alongX = caveSourceCoordinates(step / scale, 0, x + step, y, z), alongZ = caveSourceCoordinates(0, step / scale, x, y, z + step);
    minimumDeterminant = Math.min(minimumDeterminant, ((alongX[0] - centre[0]) * (alongZ[1] - centre[1]) - (alongX[1] - centre[1]) * (alongZ[0] - centre[0])) / step ** 2 * scale * scale);
  }
  expect(minimumDeterminant).toBeGreaterThan(0.2);
  geometry.dispose();
}, 30000);
