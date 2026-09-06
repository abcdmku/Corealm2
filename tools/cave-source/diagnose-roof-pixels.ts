import { NodeIO } from '@gltf-transform/core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createCaveLabFixture } from '../../game/src/featureLab/cave.js';
import { MaterialLibrary } from '../../game/src/render/materials.js';
import { CAMERA } from '../../game/src/app/config.js';

const document = await new NodeIO().read('art/rebuild/candidates/finish-cave-source/v6/models/cave/rock-face-01.glb');
const primitive = document.getRoot().listMeshes()[0]!.listPrimitives()[0]!, geometry = new THREE.BufferGeometry();
for (const [semantic, name, size] of [['POSITION', 'position', 3], ['NORMAL', 'normal', 3], ['TEXCOORD_0', 'uv', 2]] as const) geometry.setAttribute(name, new THREE.Float32BufferAttribute(primitive.getAttribute(semantic)!.getArray()!, size));
geometry.setIndex(new THREE.BufferAttribute(primitive.getIndices()!.getArray()! as Uint16Array, 1));
const map = new THREE.Texture(), material = new THREE.MeshStandardMaterial({ map, normalMap: map, roughnessMap: map });
const maps = { albedo: map, normal: map, roughness: map, meanLinearRgb: [0.2, 0.2, 0.2] as [number, number, number], tileMetres: 2.4 };
const fixture = createCaveLabFixture({ scene: { root: new THREE.Group(), materials: new MaterialLibrary() },
  surfaceTextures: { bark: maps, leaf: maps, stone: maps }, rockSource: { geometry, material, continuousEnvelope: true, provenance: 'CC0 scan' } });
fixture.group.updateMatrixWorld(true);
const source = fixture.group.getObjectByName('dungeon-rock-facing') as THREE.Mesh;
const captured = JSON.parse(await readFile('test-results/finish-cave-source-v6/report.json', 'utf8'));
const view = captured.shots.find((shot: any) => shot.view.id === 'ceiling').view;
const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1440 / 900, CAMERA.near, CAMERA.far);
camera.position.fromArray(view.eye); camera.lookAt(new THREE.Vector3().fromArray(view.target)); camera.updateMatrixWorld(true);
const ray = new THREE.Raycaster();
const pixels = [[300, 290], [800, 540], [790, 705]];
const results = pixels.map(([x, y]) => {
  const samples = [-4, 0, 4].flatMap(dx => [-4, 0, 4].map(dy => {
    ray.setFromCamera(new THREE.Vector2(((x! + dx) / 1440) * 2 - 1, 1 - ((y! + dy) / 900) * 2), camera);
    const hit = ray.intersectObjects(fixture.blockers, false)[0]!;
    const shell = ray.intersectObjects(fixture.blockers.filter(mesh => mesh !== source), false)[0]!;
    const face = hit.face!, p = source.geometry.getAttribute('position');
    const a = new THREE.Vector3().fromBufferAttribute(p, face.a), b = new THREE.Vector3().fromBufferAttribute(p, face.b), c = new THREE.Vector3().fromBufferAttribute(p, face.c);
    return { pixel: [x! + dx, y! + dy], firstHit: hit.object.name, distance: hit.distance,
      shellBehindMetres: shell.distance - hit.distance, faceArea: b.sub(a).cross(c.sub(a)).length() / 2,
      normal: face.normal.toArray(), facingCosine: -face.normal.dot(ray.ray.direction) };
  }));
  return { pixel: [x, y], allNineHitSource: samples.every(sample => sample.firstHit === 'dungeon-rock-facing'),
    distanceSpanMetres: Math.max(...samples.map(sample => sample.distance)) - Math.min(...samples.map(sample => sample.distance)), samples };
});
await mkdir('test-results/finish-cave-source-v6', { recursive: true });
await writeFile('test-results/finish-cave-source-v6/roof-pixel-audit.json', JSON.stringify({ view, fov: CAMERA.fov, results }, null, 2));
console.log(JSON.stringify(results)); fixture.dispose(); geometry.dispose(); material.dispose(); map.dispose();
