import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(directory, '../..');
const catalog = JSON.parse(await readFile(path.join(directory, 'catalog.json'), 'utf8'));
const outputRoot = path.join(repositoryRoot, 'test-results/crownward-castles');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const transformPoint = (matrix, point) => [
  matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
  matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
  matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
];

function triangles(document) {
  const result = [];
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const matrix = node.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute('POSITION').getArray();
      const indices = primitive.getIndices()?.getArray() ?? Uint32Array.from({ length: positions.length / 3 }, (_, index) => index);
      const vertex = index => transformPoint(matrix, [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]]);
      for (let index = 0; index < indices.length; index += 3) result.push([vertex(indices[index]), vertex(indices[index + 1]), vertex(indices[index + 2])]);
    }
  }
  return result;
}

function rayTriangle(origin, direction, triangle) {
  const [a, b, c] = triangle;
  const edge1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const edge2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const p = cross(direction, edge2);
  const determinant = dot(edge1, p);
  if (Math.abs(determinant) < 1e-9) return null;
  const inverse = 1 / determinant;
  const t = [origin[0] - a[0], origin[1] - a[1], origin[2] - a[2]];
  const u = dot(t, p) * inverse;
  if (u < 0 || u > 1) return null;
  const q = cross(t, edge1);
  const v = dot(direction, q) * inverse;
  if (v < 0 || u + v > 1) return null;
  const distance = dot(edge2, q) * inverse;
  return distance > 1e-7 ? distance : null;
}

function scanOpenings(faces, bounds, side, y) {
  const xSize = bounds.max[0] - bounds.min[0];
  const zSize = bounds.max[2] - bounds.min[2];
  const alongX = side.endsWith('z');
  const lateralMin = bounds.min[alongX ? 0 : 2];
  const lateralMax = bounds.max[alongX ? 0 : 2];
  const depth = alongX ? zSize : xSize;
  const sign = side.startsWith('+') ? -1 : 1;
  const direction = alongX ? [0, 0, sign] : [sign, 0, 0];
  const start = side === '+z' ? bounds.max[2] + depth * 0.02
    : side === '-z' ? bounds.min[2] - depth * 0.02
      : side === '+x' ? bounds.max[0] + depth * 0.02 : bounds.min[0] - depth * 0.02;
  const rows = [];
  for (let sample = 0; sample <= 120; sample++) {
    const lateral = lateralMin + (lateralMax - lateralMin) * sample / 120;
    const origin = alongX ? [lateral, y, start] : [start, y, lateral];
    let distance = Infinity;
    for (const face of faces) {
      const hit = rayTriangle(origin, direction, face);
      if (hit !== null && hit < distance) distance = hit;
    }
    rows.push({ lateral, penetration: Number.isFinite(distance) ? distance - depth * 0.02 : null });
  }
  const threshold = depth * 0.17;
  const ranges = [];
  let begin = null;
  for (let index = 0; index <= rows.length; index++) {
    const open = index < rows.length && (rows[index].penetration === null || rows[index].penetration > threshold);
    if (open && begin === null) begin = index;
    if (!open && begin !== null) {
      if (index - begin >= 3) ranges.push({ min: rows[begin].lateral, max: rows[index - 1].lateral });
      begin = null;
    }
  }
  return { side, y, depthThreshold: threshold, ranges };
}

/** Raw even/odd-fill input in target world metres at player-body height. */
function horizontalSegments(faces, y, scale) {
  const segments = [];
  for (const triangle of faces) {
    const intersections = [];
    for (const [startIndex, endIndex] of [[0, 1], [1, 2], [2, 0]]) {
      const start = triangle[startIndex];
      const end = triangle[endIndex];
      const low = Math.min(start[1], end[1]);
      const high = Math.max(start[1], end[1]);
      if (y < low || y >= high || Math.abs(end[1] - start[1]) < 1e-9) continue;
      const t = (y - start[1]) / (end[1] - start[1]);
      intersections.push([start[0] + (end[0] - start[0]) * t, start[2] + (end[2] - start[2]) * t]);
    }
    const unique = intersections.filter((point, index) => intersections.findIndex(other => Math.hypot(point[0] - other[0], point[1] - other[1]) < 1e-7) === index);
    if (unique.length >= 2) segments.push(unique.slice(0, 2).map(point => point.map(value => Math.round(value * scale * 10000) / 10000)));
  }
  return segments;
}

const report = { assets: [] };
for (const asset of catalog.assets) {
  const sourcePath = path.resolve(directory, catalog.files[asset.id]);
  const document = await io.read(sourcePath);
  const meshNodes = document.getRoot().listNodes().filter(node => node.getMesh());
  const bounds = meshNodes.map(node => getBounds(node)).reduce((value, next) => ({
    min: value.min.map((number, index) => Math.min(number, next.min[index])),
    max: value.max.map((number, index) => Math.max(number, next.max[index])),
  }));
  const faces = triangles(document);
  const scale = asset.metadata.inspection.scaleSuggestion.targetUniformScale;
  const scans = [];
  for (const worldY of [0.5, 1, 1.5, 2]) {
    const y = worldY / scale;
    for (const side of ['+z', '-z', '+x', '-x']) scans.push(scanOpenings(faces, bounds, side, y));
  }
  report.assets.push({
    id: asset.id,
    bounds,
    targetUniformScale: scale,
    targetBoundsMeters: { min: bounds.min.map(value => value * scale), max: bounds.max.map(value => value * scale) },
    triangles: faces.length,
    scans,
    collisionSliceAtWorldY1m: {
      coordinateSystem: 'normalized candidate coordinates scaled to target metres; +Z is the front',
      segments: horizontalSegments(faces, 1 / scale, scale),
    },
  });
}
await mkdir(outputRoot, { recursive: true });
await writeFile(path.join(outputRoot, 'opening-scans.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  report: 'test-results/crownward-castles/opening-scans.json',
  assets: report.assets.map(asset => ({ id: asset.id, triangles: asset.triangles, sliceSegments: asset.collisionSliceAtWorldY1m.segments.length })),
}, null, 2));
