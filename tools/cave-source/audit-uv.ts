import { NodeIO } from '@gltf-transform/core';
import { mkdir, writeFile } from 'node:fs/promises';

const io = new NodeIO();
async function inspect(file: string) {
  const document = await io.read(file), primitive = document.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
  const p = primitive.getAttribute('POSITION')!, uv = primitive.getAttribute('TEXCOORD_0')!, indices = primitive.getIndices()!;
  const edges = new Map<string, { vertices: number[]; distance: number; uvDistance: number; uv: number[][]; position: number[][] }>();
  for (let i = 0; i < indices.getCount(); i += 3) for (let j = 0; j < 3; j++) {
    const a = indices.getScalar(i + j), b = indices.getScalar(i + (j + 1) % 3), key = [a, b].sort((a, b) => a - b).join(':');
    if (edges.has(key)) continue;
    const pa = p.getElement(a, []), pb = p.getElement(b, []), ua = uv.getElement(a, []), ub = uv.getElement(b, []);
    edges.set(key, { vertices: [a, b], distance: Math.hypot(...pa.map((v, k) => v - pb[k]!)),
      uvDistance: Math.hypot(...ua.map((v, k) => v - ub[k]!)), uv: [ua, ub], position: [pa, pb] });
  }
  const values = [...edges.values()], discontinuities = values.filter(edge => edge.distance < 0.15 && edge.uvDistance > 0.2);
  return { file, vertices: p.getCount(), triangles: indices.getCount() / 3, edges: edges.size,
    shortEdgesCrossingOver20PercentOfAtlas: discontinuities.length,
    maxUvSpan: Math.max(...values.map(edge => edge.uvDistance)),
    worst: discontinuities.sort((a, b) => b.uvDistance - a.uvDistance).slice(0, 8) };
}
const report = { v3: await inspect('art/rebuild/candidates/finish-cave-source/v3/models/cave/rock-face-01.glb'), source: await inspect('art/rebuild/candidates/finish-cave-source/models/cave/rock-face-01.glb'),
  v2: await inspect('art/rebuild/candidates/finish-cave-source/v2/models/cave/rock-face-01.glb') };
await mkdir('test-results/finish-cave-source-v3', { recursive: true });
await writeFile('test-results/finish-cave-source-v3/uv-audit.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));

