/** Derive deterministic native-Y top surfaces from the accepted GLBs; no hand-painted terrain data. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { EXTTextureWebP } from '@gltf-transform/extensions';

const SPACING = .25;
const IDS = ['fairy_moss_bank_0', 'fairy_moss_bank_1', 'fairy_rounded_bank_0', 'fairy_rounded_bank_1'];
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
const io = new NodeIO().registerExtensions([EXTTextureWebP]);
const maps = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const round = value => Number(value.toFixed(7));

for (const id of IDS) {
  const asset = manifest.assets.find(asset => asset.id === id);
  if (!asset) throw Error(`Accepted asset missing: ${id}`);
  const sourceFile = `game/public/assets/${asset.file}`;
  const bytes = await readFile(sourceFile), sha256 = hash(bytes);
  if (sha256 !== asset.sha256) throw Error(`Accepted manifest/GLB hash mismatch: ${id}`);
  const doc = await io.readBinary(bytes);
  // The source-derived bank builder bakes scale/grounding into vertices. Refuse silent new transforms.
  for (const node of doc.getRoot().listNodes()) {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    if (node.getMatrix().some((v, i) => Math.abs(v - identity[i]) > 1e-10)) throw Error(`${id}: unexpected node transform`);
  }
  const triangles = [], min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    if (primitive.getMode() !== 4) throw Error(`${id}: non-triangle primitive`);
    const p = primitive.getAttribute('POSITION').getArray(), n = primitive.getAttribute('NORMAL').getArray();
    const indices = primitive.getIndices()?.getArray() ?? Array.from({ length: p.length / 3 }, (_, i) => i);
    for (let i = 0; i < p.length; i += 3) for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], p[i + axis]); max[axis] = Math.max(max[axis], p[i + axis]);
    }
    for (let i = 0; i < indices.length; i += 3) {
      const corners = [0, 1, 2].map(k => {
        const offset = indices[i + k] * 3;
        return { p: Array.from(p.slice(offset, offset + 3)), n: Array.from(n.slice(offset, offset + 3)) };
      });
      const [a, b, c] = corners.map(corner => corner.p);
      const denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      // Exactly vertical triangles have no XZ area and cannot own a top-facing height sample.
      if (Math.abs(denominator) < 1e-12) continue;
      triangles.push({ corners, denominator, minX: Math.min(a[0], b[0], c[0]), maxX: Math.max(a[0], b[0], c[0]),
        minZ: Math.min(a[2], b[2], c[2]), maxZ: Math.max(a[2], b[2], c[2]) });
    }
  }
  const width = Math.ceil((max[0] - min[0]) / SPACING) + 1;
  const depth = Math.ceil((max[2] - min[2]) / SPACING) + 1;
  const heights = Array(width * depth).fill(null), normals = Array(width * depth * 3).fill(0);
  for (const triangle of triangles) {
    const [a, b, c] = triangle.corners.map(corner => corner.p);
    const minColumn = Math.max(0, Math.ceil((triangle.minX - min[0]) / SPACING - 1e-9));
    const maxColumn = Math.min(width - 1, Math.floor((triangle.maxX - min[0]) / SPACING + 1e-9));
    const minRow = Math.max(0, Math.ceil((triangle.minZ - min[2]) / SPACING - 1e-9));
    const maxRow = Math.min(depth - 1, Math.floor((triangle.maxZ - min[2]) / SPACING + 1e-9));
    for (let row = minRow; row <= maxRow; row++) for (let column = minColumn; column <= maxColumn; column++) {
      const x = min[0] + column * SPACING, z = min[2] + row * SPACING;
      const wa = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / triangle.denominator;
      const wb = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / triangle.denominator;
      const wc = 1 - wa - wb;
      if (Math.min(wa, wb, wc) < -1e-8) continue;
      const y = wa * a[1] + wb * b[1] + wc * c[1], index = row * width + column;
      if (heights[index] !== null && y <= heights[index]) continue;
      heights[index] = y;
      const ns = triangle.corners.map(corner => corner.n);
      const normal = [0, 1, 2].map(axis => wa * ns[0][axis] + wb * ns[1][axis] + wc * ns[2][axis]);
      const length = Math.hypot(...normal);
      if (!Number.isFinite(y) || length < 1e-8) throw Error(`${id}: invalid surface sample`);
      for (let axis = 0; axis < 3; axis++) normals[index * 3 + axis] = round(normal[axis] / length);
    }
  }
  // Numeric values retain native absolute local Y; there is no normalisation, terrain offset or unit quantisation.
  const validSamples = heights.filter(value => value !== null).length;
  if (validSamples < width * depth * .5) throw Error(`${id}: unexpectedly sparse top footprint`);
  maps.push({ id, sourceFile, sourceSha256: sha256, bounds: { min, max }, origin: [min[0], min[2]],
    spacing: SPACING, width, depth, validSamples, heights, normals });
}

const arrayRows = (array, stride) => Array.from({ length: Math.ceil(array.length / stride) }, (_, row) =>
  `    ${array.slice(row * stride, (row + 1) * stride).map(value => value === null ? 'null' : String(value)).join(',')},`).join('\n');
const records = maps.map(map => `  ${map.id}: {
    sourceFile: ${JSON.stringify(map.sourceFile)},
    sourceSha256: '${map.sourceSha256}',
    bounds: { min: [${map.bounds.min.join(',')}], max: [${map.bounds.max.join(',')}] },
    origin: [${map.origin.join(',')}], spacing: ${map.spacing}, width: ${map.width}, depth: ${map.depth},
    validSamples: ${map.validSamples},
    heights: [
${arrayRows(map.heights, map.width)}
    ],
    normals: [
${arrayRows(map.normals, map.width * 3)}
    ],
  }`).join(',\n');
const source = `// Generated by tools/fairy-terraces/bank-heightmaps.mjs from accepted source GLBs.
// Native absolute local-Y highest triangle intersections on a 0.25 m XZ grid. Null means no mesh beneath.
// Do not hand-edit. Placement rotation, translation, uniform scaling and burial belong to the caller.

export type FairyBankAssetId = ${IDS.map(id => `'${id}'`).join(' | ')};
export interface FairyBankHeightmap {
  readonly sourceFile: string;
  readonly sourceSha256: string;
  readonly bounds: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] };
  readonly origin: readonly [number, number];
  readonly spacing: number;
  readonly width: number;
  readonly depth: number;
  readonly validSamples: number;
  /** Row-major local-Y metres; nulls preserve holes and the irregular native footprint. */
  readonly heights: readonly (number | null)[];
  /** Row-major normal XYZ triples. An unoccupied sample uses zeroes and must not be interpolated. */
  readonly normals: readonly number[];
}

export const FAIRY_BANK_HEIGHTMAPS: Readonly<Record<FairyBankAssetId, FairyBankHeightmap>> = {
${records}
};

function gridPosition(map: FairyBankHeightmap, x: number, z: number): readonly [number, number] | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)
    || x < map.bounds.min[0] || x > map.bounds.max[0] || z < map.bounds.min[2] || z > map.bounds.max[2]) return null;
  return [(x - map.origin[0]) / map.spacing, (z - map.origin[1]) / map.spacing];
}

function bilinearSamples(map: FairyBankHeightmap, x: number, z: number): readonly (readonly [number, number])[] | null {
  const grid = gridPosition(map, x, z);
  if (!grid) return null;
  const column = Math.floor(grid[0]), row = Math.floor(grid[1]);
  const fx = grid[0] - column, fz = grid[1] - row;
  const candidates: readonly (readonly [number, number, number])[] = [
    [column, row, (1 - fx) * (1 - fz)], [column + 1, row, fx * (1 - fz)],
    [column, row + 1, (1 - fx) * fz], [column + 1, row + 1, fx * fz],
  ];
  const samples: [number, number][] = [];
  for (const [c, r, weight] of candidates) {
    if (weight <= 1e-12) continue;
    if (c >= map.width || r >= map.depth) return null;
    const index = r * map.width + c;
    if (map.heights[index] === null || map.heights[index] === undefined) return null;
    samples.push([index, weight]);
  }
  return samples;
}

/** Native absolute local Y, bilinear within the actual sampled footprint; never bridges missing samples. */
export function sampleFairyBankHeight(assetId: FairyBankAssetId, x: number, z: number): number | null {
  const map = FAIRY_BANK_HEIGHTMAPS[assetId], samples = bilinearSamples(map, x, z);
  if (!samples) return null;
  let height = 0;
  for (const [index, weight] of samples) height += map.heights[index]! * weight;
  return height;
}

/** Exact nearest grid sample for placement diagnostics. Missing footprint samples stay null. */
export function sampleFairyBankHeightNearest(assetId: FairyBankAssetId, x: number, z: number): number | null {
  const map = FAIRY_BANK_HEIGHTMAPS[assetId], grid = gridPosition(map, x, z);
  if (!grid) return null;
  return map.heights[Math.round(grid[1]) * map.width + Math.round(grid[0])] ?? null;
}

/** Interpolated source normal at the highest surface, with the same conservative footprint as height. */
export function sampleFairyBankNormal(assetId: FairyBankAssetId, x: number, z: number): readonly [number, number, number] | null {
  const map = FAIRY_BANK_HEIGHTMAPS[assetId], samples = bilinearSamples(map, x, z);
  if (!samples) return null;
  let nx = 0, ny = 0, nz = 0;
  for (const [index, weight] of samples) {
    nx += map.normals[index * 3]! * weight;
    ny += map.normals[index * 3 + 1]! * weight;
    nz += map.normals[index * 3 + 2]! * weight;
  }
  const length = Math.hypot(nx, ny, nz);
  return length > 1e-8 ? [nx / length, ny / length, nz / length] : [0, 1, 0];
}
`;
await writeFile('game/src/world/fairyBankHeightmaps.ts', source);
console.log(JSON.stringify(maps.map(({ id, sourceSha256, width, depth, validSamples, heights }) => ({
  id, sourceSha256, width, depth, validSamples, minHeight: Math.min(...heights.filter(h => h !== null)),
  maxHeight: Math.max(...heights.filter(h => h !== null)),
})), null, 2));
