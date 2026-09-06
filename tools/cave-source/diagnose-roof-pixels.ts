/** Ray-cast screenshot pixels of a captured cave view back onto the CPU fixture to identify the first surface.
 * --version 7 --view ceiling --pixels "1050,460;930,540" [--radius 4] */
import { NodeIO } from '@gltf-transform/core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createCaveLabFixture } from '../../game/src/featureLab/cave.js';
import { MaterialLibrary } from '../../game/src/render/materials.js';
import { CAMERA } from '../../game/src/app/config.js';

const args = process.argv.slice(2), option = (name: string, fallback: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1]! : fallback; };
const version = option('--version', '7'), viewId = option('--view', 'ceiling'), radius = Number(option('--radius', '4'));
const pixels = option('--pixels', '300,290;800,540;790,705').split(';').map(pair => pair.split(',').map(Number) as [number, number]);
const root = `art/rebuild/candidates/finish-cave-source/v${version}`, out = `test-results/finish-cave-source-v${version}`;
const document = await new NodeIO().read(`${root}/models/cave/rock-face-01.glb`);
const extras = document.getRoot().listScenes()[0]!.getExtras() as { caveContinuousEnvelope?: boolean; caveDomainWarp?: { columns: number; rows: number } };
const primitive = document.getRoot().listMeshes()[0]!.listPrimitives()[0]!, geometry = new THREE.BufferGeometry();
for (const [semantic, name, size] of [['POSITION', 'position', 3], ['NORMAL', 'normal', 3], ['TEXCOORD_0', 'uv', 2]] as const) geometry.setAttribute(name, new THREE.Float32BufferAttribute(primitive.getAttribute(semantic)!.getArray()!, size));
geometry.setIndex(new THREE.BufferAttribute(primitive.getIndices()!.getArray()! as Uint16Array, 1));
const map = new THREE.Texture(), material = new THREE.MeshStandardMaterial({ map, normalMap: map, roughnessMap: map });
const maps = { albedo: map, normal: map, roughness: map, meanLinearRgb: [0.2, 0.2, 0.2] as [number, number, number], tileMetres: 2.4 };
const fixture = createCaveLabFixture({ scene: { root: new THREE.Group(), materials: new MaterialLibrary() },
  surfaceTextures: { bark: maps, leaf: maps, stone: maps }, rockSource: { geometry, material, continuousEnvelope: extras.caveContinuousEnvelope === true, domainWarp: extras.caveDomainWarp, provenance: 'CC0 scan' } });
fixture.group.updateMatrixWorld(true);
const source = fixture.group.getObjectByName('dungeon-rock-facing') as THREE.Mesh;
const captured = JSON.parse(await readFile(`${out}/report.json`, 'utf8'));
const shot = captured.shots.find((shot: any) => shot.view.id === viewId);
if (!shot) throw new Error(`No captured view ${viewId}`);
const view = shot.view, cam = shot.camera;
const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1440 / 900, CAMERA.near, CAMERA.far);
camera.position.set(cam.position.x, cam.position.y, cam.position.z);
if (view.target) camera.lookAt(new THREE.Vector3().fromArray(view.target));
else if (cam.target) camera.lookAt(new THREE.Vector3(cam.target.x, cam.target.y, cam.target.z));
else { const p = view.inspectPose; camera.lookAt(new THREE.Vector3(p.x, p.y - 1.2 + 1.1, p.z)); }
camera.updateMatrixWorld(true);
const ray = new THREE.Raycaster();
const results = pixels.map(([x, y]) => {
  const samples = [-radius, 0, radius].flatMap(dx => [-radius, 0, radius].map(dy => {
    ray.setFromCamera(new THREE.Vector2(((x + dx) / 1440) * 2 - 1, 1 - ((y + dy) / 900) * 2), camera);
    const hits = ray.intersectObjects(fixture.blockers, false);
    const hit = hits[0];
    if (!hit) return { pixel: [x + dx, y + dy], firstHit: null };
    const shell = hits.find(h => h.object !== source);
    const face = hit.face!, p = (hit.object as THREE.Mesh).geometry.getAttribute('position');
    const a = new THREE.Vector3().fromBufferAttribute(p, face.a), b = new THREE.Vector3().fromBufferAttribute(p, face.b), c = new THREE.Vector3().fromBufferAttribute(p, face.c);
    return { pixel: [x + dx, y + dy], firstHit: hit.object.name, distance: hit.distance, point: hit.point.toArray().map(v => +v.toFixed(3)),
      shellBehindMetres: shell ? shell.distance - hit.distance : null, faceArea: b.sub(a).cross(c.sub(a)).length() / 2,
      normal: face.normal.toArray().map(v => +v.toFixed(3)), facingCosine: +(-face.normal.dot(ray.ray.direction)).toFixed(3) };
  }));
  return { pixel: [x, y], allNineHitSource: samples.every(sample => sample.firstHit === 'dungeon-rock-facing'),
    backFacing: samples.filter(sample => (sample as any).facingCosine < 0).length,
    distanceSpanMetres: Math.max(...samples.map(sample => (sample as any).distance ?? 0)) - Math.min(...samples.map(sample => (sample as any).distance ?? 0)), samples };
});
await mkdir(out, { recursive: true });
await writeFile(`${out}/roof-pixel-audit-${viewId}.json`, JSON.stringify({ view, camera: cam, fov: CAMERA.fov, results }, null, 2));
console.log(JSON.stringify(results.map(r => ({ pixel: r.pixel, allNineHitSource: r.allNineHitSource, backFacing: r.backFacing, span: +r.distanceSpanMetres.toFixed(3),
  centre: r.samples[4] })))); fixture.dispose(); geometry.dispose(); material.dispose(); map.dispose();
