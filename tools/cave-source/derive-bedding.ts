import { NodeIO } from '@gltf-transform/core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';

const root = 'art/rebuild/candidates/finish-cave-source';
const outputRoot = `${root}/v2`;
const io = new NodeIO();
const input = `${root}/models/cave/rock-face-01.glb`;
const document = await io.read(input);
const primitive = document.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
const position = primitive.getAttribute('POSITION')!, uv = primitive.getAttribute('TEXCOORD_0')!;
const index = primitive.getIndices()!;
// Central intact bed: omit the scan's ragged outer outline and moss-bearing upper cap.
const crop = { minX: -1.5, maxX: 1.5, minY: 0.75, maxY: 3.35 };
const columns = 64, rows = 56, count = (columns + 1) * (rows + 1);
const depths = new Float64Array(count).fill(-Infinity), texcoords = new Float32Array(count * 2);
const dx = (crop.maxX - crop.minX) / columns, dy = (crop.maxY - crop.minY) / rows;
for (let triangle = 0; triangle < index.getCount(); triangle += 3) {
  const vertices = [0, 1, 2].map(corner => index.getScalar(triangle + corner));
  const p = vertices.map(vertex => position.getElement(vertex, []));
  const t = vertices.map(vertex => uv.getElement(vertex, []));
  const ax = p[0]![0]!, ay = p[0]![1]!, bx = p[1]![0]!, by = p[1]![1]!, cx = p[2]![0]!, cy = p[2]![1]!;
  const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(denominator) < 1e-10) continue;
  const minColumn = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - crop.minX) / dx));
  const maxColumn = Math.min(columns, Math.floor((Math.max(ax, bx, cx) - crop.minX) / dx));
  const minRow = Math.max(0, Math.ceil((Math.min(ay, by, cy) - crop.minY) / dy));
  const maxRow = Math.min(rows, Math.floor((Math.max(ay, by, cy) - crop.minY) / dy));
  for (let row = minRow; row <= maxRow; row++) for (let column = minColumn; column <= maxColumn; column++) {
    const x = crop.minX + column * dx, y = crop.minY + row * dy;
    const a = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denominator;
    const b = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denominator, c = 1 - a - b;
    if (Math.min(a, b, c) < -1e-6) continue;
    const z = a * p[0]![2]! + b * p[1]![2]! + c * p[2]![2]!, vertex = row * (columns + 1) + column;
    if (z <= depths[vertex]!) continue;
    depths[vertex] = z;
    for (let axis = 0; axis < 2; axis++) texcoords[vertex * 2 + axis] = a * t[0]![axis]! + b * t[1]![axis]! + c * t[2]![axis]!;
  }
}
const missing = Array.from(depths).filter(depth => !Number.isFinite(depth)).length;
if (missing) throw new Error(`Crop contains ${missing}/${count} unsupported source samples; choose an intact source bed`);
// A mirrored neighbour shares the edge position/UV exactly. Zero boundary slope prevents a crease
// caused solely by reflection; all interior relief remains sampled from the licensed scan.
for (let row = 0; row <= rows; row++) {
  depths[row * (columns + 1)] = depths[row * (columns + 1) + 1]!;
  depths[row * (columns + 1) + columns] = depths[row * (columns + 1) + columns - 1]!;
}
for (let column = 0; column <= columns; column++) {
  depths[column] = depths[columns + 1 + column]!;
  depths[rows * (columns + 1) + column] = depths[(rows - 1) * (columns + 1) + column]!;
}
const minimumDepth = Math.min(...depths), positions: number[] = [], indices: number[] = [];
for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
  positions.push((column - columns / 2) * dx, row * dy, depths[row * (columns + 1) + column]! - minimumDepth);
  if (row === rows || column === columns) continue;
  const a = row * (columns + 1) + column, b = a + 1, c = a + columns + 1, d = c + 1;
  indices.push(a, b, d, a, d, c);
}
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingBox();
position.setArray(new Float32Array(positions));
uv.setArray(texcoords);
primitive.getAttribute('NORMAL')!.setArray(new Float32Array(geometry.getAttribute('normal').array));
index.setArray(new Uint16Array(indices));
primitive.setAttribute('TANGENT', null);
const material = primitive.getMaterial()!;
material.setName('Poly Haven Rock Face 01 — cropped bedding');
material.setBaseColorFactor([0.38, 0.36, 0.34, 1]);
const file = 'models/cave/rock-face-01.glb';
await mkdir(`${outputRoot}/models/cave`, { recursive: true });
const bytes = await io.writeBinary(document);
await writeFile(`${outputRoot}/${file}`, bytes);
const previous = JSON.parse(await readFile(`${root}/catalog.json`, 'utf8'));
const size = geometry.boundingBox!.getSize(new THREE.Vector3());
const asset = { ...previous.assets[0], bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  triangles: indices.length / 3, size: { x: size.x, y: size.y, z: size.z }, base: { x: -size.x / 2, y: 0, z: 0 },
  materials: [material.getName()] };
await writeFile(`${outputRoot}/catalog.json`, JSON.stringify({ pack: previous.pack, assets: [asset] }, null, 2));
await writeFile(`${outputRoot}/provenance.json`, JSON.stringify({ ...previous.pack,
  sourceFile: '../models/cave/rock-face-01.glb', sourceSha256: previous.assets[0].sha256, crop, columns, rows,
  method: 'Frontmost barycentric sampling of original source triangle positions and UVs, cropped to intact central bedding. Mirrored boundary depth slopes flattened over one sample; original 1K maps retained. No procedural relief. Base colour factor lowered to match cave floor.',
  missingSamples: missing, derived: asset }, null, 2));
console.log(JSON.stringify(asset));
