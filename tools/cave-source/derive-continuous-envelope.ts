import { NodeIO } from '@gltf-transform/core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';

const root = 'art/rebuild/candidates/finish-cave-source', outputRoot = `${root}/v6`;
const io = new NodeIO(), document = await io.read(`${root}/models/cave/rock-face-01.glb`);
const primitive = document.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
const source = primitive.getAttribute('POSITION')!, sourceIndex = primitive.getIndices()!;
type Triangle = { a: number[]; b: number[]; c: number[]; denominator: number };
const bins = new Map<string, Triangle[]>(), binSize = 0.12;
for (let i = 0; i < sourceIndex.getCount(); i += 3) {
  const [a, b, c] = [0, 1, 2].map(corner => source.getElement(sourceIndex.getScalar(i + corner), []));
  const denominator = (b![1]! - c![1]!) * (a![0]! - c![0]!) + (c![0]! - b![0]!) * (a![1]! - c![1]!);
  if (Math.abs(denominator) < 1e-10) continue;
  const triangle = { a: a!, b: b!, c: c!, denominator };
  for (let y = Math.floor(Math.min(a![1]!, b![1]!, c![1]!) / binSize); y <= Math.floor(Math.max(a![1]!, b![1]!, c![1]!) / binSize); y++) {
    for (let x = Math.floor(Math.min(a![0]!, b![0]!, c![0]!) / binSize); x <= Math.floor(Math.max(a![0]!, b![0]!, c![0]!) / binSize); x++) {
      const key = `${x}:${y}`, list = bins.get(key) ?? []; list.push(triangle); bins.set(key, list);
    }
  }
}
function sample(x: number, y: number): number {
  let front = -Infinity;
  for (const { a, b, c, denominator } of bins.get(`${Math.floor(x / binSize)}:${Math.floor(y / binSize)}`) ?? []) {
    const u = ((b[1]! - c[1]!) * (x - c[0]!) + (c[0]! - b[0]!) * (y - c[1]!)) / denominator;
    const v = ((c[1]! - a[1]!) * (x - c[0]!) + (a[0]! - c[0]!) * (y - c[1]!)) / denominator, w = 1 - u - v;
    if (Math.min(u, v, w) < -1e-7) continue;
    front = Math.max(front, u * a[2]! + v * b[2]! + w * c[2]!);
  }
  if (!Number.isFinite(front)) throw new Error(`Unsupported source sample ${x},${y}`);
  return front;
}
const width = 3, height = 2.6, centreY = 2.05, halfBand = 0.25, columns = 64, rows = 56;
function contributors(value: number, period: number): Array<[number, number]> {
  const edgeDistance = period / 2 - Math.abs(value);
  if (edgeDistance >= halfBand) return [[value, 1]];
  const t = (edgeDistance + halfBand) / (2 * halfBand), weight = t * t * (3 - 2 * t);
  return [[value, weight], [value - Math.sign(value) * period, 1 - weight]];
}
function field(x: number, y: number): number {
  x = ((x + width / 2) % width + width) % width - width / 2;
  y = ((y + height / 2) % height + height) % height - height / 2;
  let z = 0;
  for (const [sx, wx] of contributors(x, width)) for (const [sy, wy] of contributors(y, height)) z += sample(sx, sy + centreY) * wx * wy;
  return z;
}
const positions: number[] = [], uvs: number[] = [], indices: number[] = [], errors: number[] = [], rawCurvature: number[] = [], blendedCurvature: number[] = [];
let interiorMaximumError = 0;
const stepX = width / columns, stepY = height / rows;
for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
  const x = (column / columns - 0.5) * width, y = (row / rows - 0.5) * height, depth = field(x, y), original = sample(x, y + centreY);
  positions.push(x, y + height / 2, depth); uvs.push(column / columns, row / rows);
  const error = Math.abs(depth - original);
  const inBand = width / 2 - Math.abs(x) < halfBand || height / 2 - Math.abs(y) < halfBand;
  if (inBand) {
    errors.push(error);
    rawCurvature.push(Math.abs(sample(x + stepX, y + centreY) - 2 * original + sample(x - stepX, y + centreY)) / stepX ** 2
      + Math.abs(sample(x, y + centreY + stepY) - 2 * original + sample(x, y + centreY - stepY)) / stepY ** 2);
    blendedCurvature.push(Math.abs(field(x + stepX, y) - 2 * depth + field(x - stepX, y)) / stepX ** 2
      + Math.abs(field(x, y + stepY) - 2 * depth + field(x, y - stepY)) / stepY ** 2);
  } else interiorMaximumError = Math.max(interiorMaximumError, error);
  if (column < columns && row < rows) {
    const a = row * (columns + 1) + column, b = a + 1, c = a + columns + 1, d = c + 1;
    indices.push(a, b, d, a, d, c);
  }
}
const minimum = Math.min(...positions.filter((_, index) => index % 3 === 2));
const interpolatedReliefError: number[] = [], interpolatedInteriorError: number[] = [];
for (let i = 0; i < indices.length; i += 3) {
  const x = (positions[indices[i]! * 3]! + positions[indices[i + 1]! * 3]! + positions[indices[i + 2]! * 3]!) / 3;
  const y = (positions[indices[i]! * 3 + 1]! + positions[indices[i + 1]! * 3 + 1]! + positions[indices[i + 2]! * 3 + 1]!) / 3 - height / 2;
  const z = (positions[indices[i]! * 3 + 2]! + positions[indices[i + 1]! * 3 + 2]! + positions[indices[i + 2]! * 3 + 2]!) / 3;
  interpolatedReliefError.push(Math.abs(z - field(x, y)));
  if (width / 2 - Math.abs(x) >= halfBand && height / 2 - Math.abs(y) >= halfBand) interpolatedInteriorError.push(Math.abs(z - sample(x, y + centreY)));
}
for (let i = 2; i < positions.length; i += 3) positions[i]! -= minimum;
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
source.setArray(new Float32Array(positions));
primitive.getAttribute('NORMAL')!.setArray(new Float32Array(geometry.getAttribute('normal').array));
primitive.getAttribute('TEXCOORD_0')!.setArray(new Float32Array(uvs)); sourceIndex.setArray(new Uint16Array(indices));
primitive.setAttribute('TANGENT', null);
document.getRoot().listScenes()[0]!.setExtras({ caveContinuousEnvelope: true });
primitive.getMaterial()!.setName('Poly Haven Rock Face 01 front-envelope');
await mkdir(`${outputRoot}/models/cave`, { recursive: true });
const bytes = await io.writeBinary(document), file = 'models/cave/rock-face-01.glb';
await writeFile(`${outputRoot}/${file}`, bytes);
const previous = JSON.parse(await readFile(`${root}/catalog.json`, 'utf8'));
const maximum = Math.max(...positions.filter((_, index) => index % 3 === 2));
const asset = { ...previous.assets[0], bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), triangles: indices.length / 3,
  size: { x: width, y: height, z: maximum }, base: { x: -width / 2, y: 0, z: 0 }, materials: [primitive.getMaterial()!.getName()] };
const distribution = (values: number[]) => { values.sort((a, b) => a - b); return { median: values[Math.floor(values.length / 2)], p95: values[Math.floor(values.length * 0.95)], maximum: values[values.length - 1] }; };
const metrics = { interiorMaximumError, blendedBandErrorMetres: distribution(errors),
  rawBandCurvature: distribution(rawCurvature), blendedBandCurvature: distribution(blendedCurvature),
  interpolatedReliefErrorMetres: distribution(interpolatedReliefError), interpolatedInteriorErrorMetres: distribution(interpolatedInteriorError) };
await writeFile(`${outputRoot}/catalog.json`, JSON.stringify({ pack: previous.pack, assets: [asset] }, null, 2));
await writeFile(`${outputRoot}/provenance.json`, JSON.stringify({ ...previous.pack, sourceSha256: previous.assets[0].sha256,
  method: 'Continuous frontmost source-triangle envelope. Periodic cubic blending of adjacent source fields over a50cm band; unblended interior samples are exact. Only geometry derives from scan; runtime uses continuous world stone, never source atlas interpolation.',
  width, height, centreY, halfBand, columns, rows, metrics, derived: asset }, null, 2));
console.log(JSON.stringify({ asset, metrics }));
