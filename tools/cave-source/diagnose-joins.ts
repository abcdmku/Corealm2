import { NodeIO } from '@gltf-transform/core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createCaveLabFixture } from '../../game/src/featureLab/cave.js';
import { MaterialLibrary } from '../../game/src/render/materials.js';

const document = await new NodeIO().read('art/rebuild/candidates/finish-cave-source/v5/models/cave/rock-face-01.glb');
const primitive = document.getRoot().listMeshes()[0]!.listPrimitives()[0]!, geometry = new THREE.BufferGeometry();
for (const [semantic, name, size] of [['POSITION', 'position', 3], ['NORMAL', 'normal', 3], ['TEXCOORD_0', 'uv', 2]] as const) {
  geometry.setAttribute(name, new THREE.Float32BufferAttribute(primitive.getAttribute(semantic)!.getArray()!, size));
}
geometry.setIndex(new THREE.BufferAttribute(primitive.getIndices()!.getArray()! as Uint16Array, 1));
const map = new THREE.Texture(), sourceMaterial = new THREE.MeshStandardMaterial({ map, normalMap: map, roughnessMap: map });
const maps = { albedo: map, normal: map, roughness: map, meanLinearRgb: [0.2, 0.2, 0.2] as [number, number, number], tileMetres: 2.4 };
const fixture = createCaveLabFixture({ scene: { root: new THREE.Group(), materials: new MaterialLibrary() },
  surfaceTextures: { bark: maps, leaf: maps, stone: maps }, rockSource: { geometry, material: sourceMaterial, provenance: 'CC0 Rock Face01' } });
const facing = fixture.group.getObjectByName('dungeon-rock-facing') as THREE.Mesh;
const source = geometry.getAttribute('position'), position = facing.geometry.getAttribute('position'), normal = facing.geometry.getAttribute('normal');
const sourceCount = source.count, state = fixture.getState().sourceFacing!, courses = 3, columns = state.wallPanels / courses;
type Sample = { p: THREE.Vector3; n: THREE.Vector3 };
function border(panel: number, side: number): Sample[] {
  const samples: Sample[] = [];
  for (let i = 0; i < source.count; i++) {
    if (Math.abs(source.getX(i) - side * 1.5) > 1e-5) continue;
    const index = panel * sourceCount + i;
    samples.push({ p: new THREE.Vector3().fromBufferAttribute(position, index), n: new THREE.Vector3().fromBufferAttribute(normal, index) });
  }
  return samples.sort((a, b) => a.p.y - b.p.y);
}
let maxPositionGap = 0, maxNormalAngle = 0, count = 0;
const angles: number[] = [], worst: object[] = [];
for (let course = 0; course < courses; course++) for (let panel = 0; panel < columns; panel++) {
  const left = border(course * columns + panel, 1), right = border(course * columns + (panel + 1) % columns, -1);
  for (const sample of left) {
    let match = 0;
    while (match + 1 < right.length && right[match + 1]!.p.y < sample.p.y) match++;
    const a = right[match]!, b = right[Math.min(match + 1, right.length - 1)]!;
    const t = THREE.MathUtils.clamp((sample.p.y - a.p.y) / (b.p.y - a.p.y || 1), 0, 1);
    const p = a.p.clone().lerp(b.p, t), n = a.n.clone().lerp(b.n, t).normalize();
    const gap = p.distanceTo(sample.p), angle = THREE.MathUtils.radToDeg(sample.n.angleTo(n));
    maxPositionGap = Math.max(maxPositionGap, gap); maxNormalAngle = Math.max(maxNormalAngle, angle);
    angles.push(angle); count++;
    if (angle > 60) worst.push({ course, panel, y: sample.p.y, gap, angle, leftNormal: sample.n.toArray(), rightNormal: n.toArray() });
  }
}
angles.sort((a, b) => a - b);
const provenance = JSON.parse(await readFile('art/rebuild/candidates/finish-cave-source/v5/provenance.json', 'utf8'));
let collapsedTransitionTriangles = 0, reversedTransitionTriangles = 0, interiorBackFacingTriangles = 0;
const interiorEdges = new Map<string, { count: number; centre: THREE.Vector3 }>();
for (let i = 0; i < geometry.index!.count; i += 3) {
  const [a, b, c] = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(source, geometry.index!.getX(i + j)));
  const cross = b!.sub(a!).cross(c!.sub(a!));
  if (i / 3 < provenance.interiorTriangles) {
    if (cross.z < 0) interiorBackFacingTriangles++;
    const points = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(source, geometry.index!.getX(i + j)));
    for (let j = 0; j < 3; j++) {
      const a = points[j]!, b = points[(j + 1) % 3]!;
      const key = [a, b].map(p => p.toArray().map(value => Math.round(value * 1e5)).join(':')).sort().join('|');
      const previous = interiorEdges.get(key);
      if (previous) previous.count++; else interiorEdges.set(key, { count: 1, centre: a.clone().add(b).multiplyScalar(0.5) });
    }
    continue;
  }
  if (cross.length() < 1e-10) collapsedTransitionTriangles++;
  if (cross.z <= 0) reversedTransitionTriangles++;
}
const report = { borderSamples: count, maxPositionGap, normalDegrees: { maximum: maxNormalAngle,
  median: angles[Math.floor(angles.length / 2)], p95: angles[Math.floor(angles.length * 0.95)] }, worst: worst.slice(0, 12),
  transitionTriangles: provenance.transitionTriangles, collapsedTransitionTriangles, reversedTransitionTriangles,
  interiorBackFacingTriangles,
  interiorOpenEdgesAwayFromCrop: [...interiorEdges.values()].filter(edge => edge.count === 1 && Math.abs(edge.centre.x) < 1.319
    && edge.centre.y > 0.181 && edge.centre.y < 2.419).length };
await mkdir('test-results/finish-cave-source-v5', { recursive: true });
await writeFile('test-results/finish-cave-source-v5/join-audit.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
fixture.dispose(); geometry.dispose(); sourceMaterial.dispose(); map.dispose();

