import { NodeIO } from '@gltf-transform/core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = 'art/rebuild/candidates/finish-cave-source', outputRoot = `${root}/v3`;
const io = new NodeIO(), document = await io.read(`${root}/models/cave/rock-face-01.glb`);
const primitive = document.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
const sourcePosition = primitive.getAttribute('POSITION')!, sourceUv = primitive.getAttribute('TEXCOORD_0')!;
const sourceNormal = primitive.getAttribute('NORMAL')!, sourceIndex = primitive.getIndices()!;
const crop = { minX: -1.5, maxX: 1.5, minY: 0.75, maxY: 3.35 };
type Vertex = { position: number[]; uv: number[]; normal: number[] };
const interpolate = (a: Vertex, b: Vertex, t: number): Vertex => ({
  position: a.position.map((v, i) => v + (b.position[i]! - v) * t),
  uv: a.uv.map((v, i) => v + (b.uv[i]! - v) * t),
  normal: a.normal.map((v, i) => v + (b.normal[i]! - v) * t),
});
function clip(input: Vertex[], axis: number, edge: number, sign: number): Vertex[] {
  const output: Vertex[] = [];
  for (let i = 0; i < input.length; i++) {
    const a = input[i]!, b = input[(i + 1) % input.length]!;
    const da = (a.position[axis]! - edge) * sign, db = (b.position[axis]! - edge) * sign;
    if (da >= 0) output.push(a);
    if ((da >= 0) !== (db >= 0)) output.push(interpolate(a, b, da / (da - db)));
  }
  return output;
}
const vertices: Vertex[] = [], indices: number[] = [], lookup = new Map<string, number>();
function append(vertex: Vertex): number {
  const key = [...vertex.position, ...vertex.uv].map(v => v.toFixed(7)).join(':');
  const known = lookup.get(key); if (known !== undefined) return known;
  const index = vertices.length; vertices.push(vertex); lookup.set(key, index); return index;
}
for (let i = 0; i < sourceIndex.getCount(); i += 3) {
  let polygon: Vertex[] = [0, 1, 2].map(corner => {
    const index = sourceIndex.getScalar(i + corner);
    return { position: sourcePosition.getElement(index, []), uv: sourceUv.getElement(index, []), normal: sourceNormal.getElement(index, []) };
  });
  for (const [axis, edge, sign] of [[0, crop.minX, 1], [0, crop.maxX, -1], [1, crop.minY, 1], [1, crop.maxY, -1]]) {
    polygon = clip(polygon, axis!, edge!, sign!);
  }
  // Each new triangle is entirely inside one original triangle/UV chart. Atlas islands never mix.
  for (let j = 1; j < polygon.length - 1; j++) indices.push(append(polygon[0]!), append(polygon[j]!), append(polygon[j + 1]!));
}
const minimumDepth = Math.min(...vertices.map(vertex => vertex.position[2]!));
const maximumDepth = Math.max(...vertices.map(vertex => vertex.position[2]!));
const boundaryDepth = (minimumDepth + maximumDepth) / 2, seamWidth = 0.18;
let boundaryVertices = 0;
for (const vertex of vertices) {
  const [x, y, depth] = vertex.position as [number, number, number];
  const distance = Math.min(x - crop.minX, crop.maxX - x, y - crop.minY, crop.maxY - y);
  const t = Math.max(0, Math.min(1, distance / seamWidth)), weight = t * t * (3 - 2 * t);
  if (t < 1) boundaryVertices++;
  // All four edges meet at one exact depth, so the same source orientation can join without mirrors.
  // Only this 18cm collar is adapted; source folds and their UV chart boundaries remain inside it.
  vertex.position = [x, y - crop.minY, boundaryDepth + (depth - boundaryDepth) * weight - minimumDepth];
}
sourcePosition.setArray(new Float32Array(vertices.flatMap(vertex => vertex.position)));
sourceUv.setArray(new Float32Array(vertices.flatMap(vertex => vertex.uv)));
sourceNormal.setArray(new Float32Array(vertices.flatMap(vertex => vertex.normal)));
sourceIndex.setArray(new Uint16Array(indices)); primitive.setAttribute('TANGENT', null);
const material = primitive.getMaterial()!;
material.setName('Poly Haven Rock Face 01 — continuous triangle crop');
material.setBaseColorFactor([0.38, 0.36, 0.34, 1]);
await mkdir(`${outputRoot}/models/cave`, { recursive: true });
const bytes = await io.writeBinary(document), file = 'models/cave/rock-face-01.glb';
await writeFile(`${outputRoot}/${file}`, bytes);
const previous = JSON.parse(await readFile(`${root}/catalog.json`, 'utf8'));
const asset = { ...previous.assets[0], bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  triangles: indices.length / 3, size: { x: 3, y: 2.6, z: maximumDepth - minimumDepth },
  base: { x: -1.5, y: 0, z: 0 }, materials: [material.getName()] };
await writeFile(`${outputRoot}/catalog.json`, JSON.stringify({ pack: previous.pack, assets: [asset] }, null, 2));
await writeFile(`${outputRoot}/provenance.json`, JSON.stringify({ ...previous.pack, sourceFile: '../models/cave/rock-face-01.glb',
  sourceSha256: previous.assets[0].sha256, crop, seamWidth, boundaryVertices,
  method: 'Original source triangles clipped independently to rectangle, attributes interpolated only within their original triangle. UV chart seams and interior folds retained. An18cm boundary collar converges to shared constant depth. No grid resampling, no invented interior relief. Original maps retained, base colour lowered.', derived: asset }, null, 2));
console.log(JSON.stringify(asset));
