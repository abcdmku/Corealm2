import { NodeIO } from '@gltf-transform/core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = 'art/rebuild/candidates/finish-cave-source', outputRoot = `${root}/v5`;
const io = new NodeIO(), document = await io.read(`${root}/models/cave/rock-face-01.glb`);
const primitive = document.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
const sourcePosition = primitive.getAttribute('POSITION')!, sourceUv = primitive.getAttribute('TEXCOORD_0')!;
const sourceNormal = primitive.getAttribute('NORMAL')!, sourceIndex = primitive.getIndices()!;
const crop = { minX: -1.5, maxX: 1.5, minY: 0.75, maxY: 3.35 };
const seamWidth = 0.18;
const inner = { minX: crop.minX + seamWidth, maxX: crop.maxX - seamWidth,
  minY: crop.minY + seamWidth, maxY: crop.maxY - seamWidth };
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
const segments: Array<Array<[Vertex, Vertex]>> = [[], [], [], []];
const sides = [[0, inner.minX, 1], [0, inner.maxX, -1], [1, inner.minY, 1], [1, inner.maxY, -1]] as const;
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
  for (const [axis, edge, sign] of sides) {
    polygon = clip(polygon, axis!, edge!, sign!);
  }
  // Each new triangle is entirely inside one original triangle/UV chart. Atlas islands never mix.
  for (let j = 1; j < polygon.length - 1; j++) indices.push(append(polygon[0]!), append(polygon[j]!), append(polygon[j + 1]!));
  for (const [side, [axis, edge]] of sides.entries()) for (let j = 0; j < polygon.length; j++) {
    const a = polygon[j]!, b = polygon[(j + 1) % polygon.length]!;
    if (Math.abs(a.position[axis]! - edge) < 1e-8 && Math.abs(b.position[axis]! - edge) < 1e-8
      && Math.abs(a.position[1 - axis]! - b.position[1 - axis]!) > 1e-8) segments[side]!.push([a, b]);
  }
}
const minimumDepth = Math.min(...vertices.map(vertex => vertex.position[2]!));
const maximumDepth = Math.max(...vertices.map(vertex => vertex.position[2]!));
const boundaryDepth = (minimumDepth + maximumDepth) / 2, interiorTriangles = indices.length / 3;
let boundaryVertices = 0;
// All four outer edges use the same parameters. Adjacent roof patches therefore sample the
// height field at identical points, rather than creating mismatched piecewise-linear borders.
const sharedFractions = Array.from({ length: 65 }, (_, index) => index / 64);
for (const [side, [axis, edge]] of sides.entries()) {
  const varying = 1 - axis, sourceSegments = segments[side]!;
  const low = varying === 0 ? inner.minX : inner.minY, high = varying === 0 ? inner.maxX : inner.maxY;
  const along = (segment: [Vertex, Vertex], t: number): number => {
    const [a, b] = segment, u = (t - a.position[varying]!) / (b.position[varying]! - a.position[varying]!);
    return a.position[2]! + u * (b.position[2]! - a.position[2]!);
  };
  const supported = (segment: [Vertex, Vertex], t: number): boolean => t >= Math.min(segment[0].position[varying]!, segment[1].position[varying]!) - 1e-8
    && t <= Math.max(segment[0].position[varying]!, segment[1].position[varying]!) + 1e-8;
  const breaks = [low, high, ...sourceSegments.flatMap(segment => segment.map(vertex => vertex.position[varying]!))];
  // Include every crossing of source border segments so the frontmost envelope is piecewise exact.
  for (let a = 0; a < sourceSegments.length; a++) for (let b = a + 1; b < sourceSegments.length; b++) {
    const first = sourceSegments[a]!, second = sourceSegments[b]!;
    const slope = along(first, high) - along(first, low) - along(second, high) + along(second, low);
    if (Math.abs(slope) < 1e-10) continue;
    const t = low + (along(second, low) - along(first, low)) / slope * (high - low);
    if (t > low && t < high && supported(first, t) && supported(second, t)) breaks.push(t);
  }
  const sorted = [...new Set(breaks.map(value => Math.round(value * 1e8) / 1e8))].sort((a, b) => a - b);
  const outerEdge = axis === 0 ? (side === 0 ? crop.minX : crop.maxX) : (side === 2 ? crop.minY : crop.maxY);
  const outerLow = varying === 0 ? crop.minX : crop.minY, outerHigh = varying === 0 ? crop.maxX : crop.maxY;
  const make = (t: number, depth: number, ring: number): Vertex => {
    const p = [0, 0, depth];
    p[axis] = edge + (outerEdge - edge) * ring;
    const fraction = (t - low) / (high - low);
    p[varying] = t + (outerLow + fraction * (outerHigh - outerLow) - t) * ring;
    return { position: p, uv: [0, 0], normal: [0, 0, 1] };
  };
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!, b = sorted[i + 1]!; if (b - a < 1e-7) continue;
    const candidates = sourceSegments.filter(segment => supported(segment, (a + b) / 2));
    candidates.sort((one, two) => along(two, (a + b) / 2) - along(one, (a + b) / 2));
    const front = candidates[0]; if (!front) throw new Error(`Source border has uncovered interval ${side}:${a}-${b}`);
    const rings = [[make(a, along(front, a), 0), make(b, along(front, b), 0)],
      [make(a, boundaryDepth, 0.75), make(b, boundaryDepth, 0.75)],
      [make(a, boundaryDepth, 1), make(b, boundaryDepth, 1)]];
    for (let ring = 0; ring < 1; ring++) {
      const quad = [rings[ring]![0]!, rings[ring]![1]!, rings[ring + 1]![1]!, rings[ring + 1]![0]!];
      for (const corners of [[0, 1, 2], [0, 2, 3]]) {
        const p = corners.map(corner => quad[corner]!);
        const cross = (p[1]!.position[0]! - p[0]!.position[0]!) * (p[2]!.position[1]! - p[0]!.position[1]!)
          - (p[1]!.position[1]! - p[0]!.position[1]!) * (p[2]!.position[0]! - p[0]!.position[0]!);
        if (cross < 0) [p[1], p[2]] = [p[2]!, p[1]!];
        indices.push(...p.map(append));
      }
    }
  }
  // Triangulate the flat lip between the irregular source envelope and one shared 64-step edge.
  // This avoids multiplying every source breakpoint around all four sides of every panel.
  let innerIndex = 0, outerIndex = 0;
  while (innerIndex < sorted.length - 1 || outerIndex < sharedFractions.length - 1) {
    const insideT = sorted[innerIndex]!, outsideT = low + sharedFractions[outerIndex]! * (high - low);
    const nextInside = sorted[innerIndex + 1] ?? Infinity;
    const nextOutside = outerIndex + 1 < sharedFractions.length ? low + sharedFractions[outerIndex + 1]! * (high - low) : Infinity;
    const p = nextInside < nextOutside
      ? [make(insideT, boundaryDepth, 0.75), make(nextInside, boundaryDepth, 0.75), make(outsideT, boundaryDepth, 1)]
      : [make(insideT, boundaryDepth, 0.75), make(nextOutside, boundaryDepth, 1), make(outsideT, boundaryDepth, 1)];
    if (nextInside < nextOutside) innerIndex++; else outerIndex++;
    const cross = (p[1]!.position[0]! - p[0]!.position[0]!) * (p[2]!.position[1]! - p[0]!.position[1]!)
      - (p[1]!.position[1]! - p[0]!.position[1]!) * (p[2]!.position[0]! - p[0]!.position[0]!);
    if (Math.abs(cross) < 1e-12) continue;
    if (cross < 0) [p[1], p[2]] = [p[2]!, p[1]!];
    indices.push(...p.map(append));
  }
}
boundaryVertices = vertices.length;
for (const vertex of vertices) vertex.position = [vertex.position[0]!, vertex.position[1]! - crop.minY, vertex.position[2]! - minimumDepth];
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
  sourceSha256: previous.assets[0].sha256, crop, seamWidth, boundaryVertices, interiorTriangles,
  transitionTriangles: indices.length / 3 - interiorTriangles,
  method: 'Original interior source triangles retained with their UV charts. Outer18cm replaced by consistently +Z-wound strips following exact frontmost source border segment envelope, with flat outer45mm lip. No source folds flattened into degenerate topology. Transition UVs constant because world stone owns this collar.', derived: asset }, null, 2));
console.log(JSON.stringify(asset));

