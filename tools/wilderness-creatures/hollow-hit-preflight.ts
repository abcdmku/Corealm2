import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createMaskedHitOverlay, applyMaskedHitOverlay } from '../../game/src/render/creatureHitOverlay.js';

// Final-byte CPU check of the production mask on the authored rig. Browser Hit remains required.
const output = 'test-results/wilderness-creatures/keepers';
const catalog = JSON.parse(await readFile(`${output}/catalog.json`, 'utf8'));
const asset = catalog.assets.find((asset: any) => asset.id === 'creature_hollow_star');
const bytes = await readFile(`${output}/${catalog.files[asset.id]}`);
assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.readBinary(bytes);
for (const material of doc.getRoot().listMaterials()) {
  material.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null)
    .setEmissiveTexture(null).setOcclusionTexture(null);
}
await doc.transform(prune());
const bare = await io.writeBinary(doc);
const gltf = await new GLTFLoader().parseAsync(bare.buffer.slice(bare.byteOffset, bare.byteOffset + bare.byteLength), '');
const scene = gltf.scene, mixer = new THREE.AnimationMixer(scene);
const idle = gltf.animations.find(clip => clip.name === 'Idle')!;
const protectedNames = ['hollow_root', 'hollow_thorax', ...[4, 5].flatMap(i => [`hollow_arm_${i}`, `hollow_forearm_${i}`, `hollow_hook_${i}`])];
const protectedBones = protectedNames.map(name => {
  const node = scene.getObjectByName(name); assert(node, `Missing ${name}`); return node;
});
const movingMeshes: THREE.SkinnedMesh[] = [];
scene.traverse(node => { if ((node as THREE.SkinnedMesh).isSkinnedMesh) movingMeshes.push(node as THREE.SkinnedMesh); });
const sampleVertex = new THREE.Vector3();
const rows: any[] = [];
for (const hitName of ['Hit', 'HitLeft', 'HitRight']) {
  const nativeHit = gltf.animations.find(clip => clip.name === hitName)!;
  const overlay = createMaskedHitOverlay(scene, nativeHit, idle);
  assert.equal(overlay.status, 'native-masked'); assert(overlay.clip);
  assert(overlay.boneNames.length > 0);
  assert(overlay.boneNames.every(name => /^hollow_(arm|forearm|hook)_[0-3]$/.test(name)));
  for (const baseName of ['Idle', 'Walk', 'Run']) {
    const base = gltf.animations.find(clip => clip.name === baseName)!;
    mixer.stopAllAction(); mixer.clipAction(base).reset().play();
    let minimumFloor = Infinity, maximumSupportDifference = 0, maximumVertexTravel = 0;
    const count = Math.ceil(nativeHit.duration * 120);
    for (let index = 0; index <= count; index++) {
      const time = nativeHit.duration * index / count;
      mixer.setTime(base.duration * .31 + time); scene.updateMatrixWorld(true);
      const before = protectedBones.map(bone => bone.matrixWorld.clone());
      const vertices = movingMeshes.map(mesh => {
        const points: THREE.Vector3[] = [];
        for (let vertex = 0; vertex < mesh.geometry.attributes.position!.count; vertex += 64) {
          points.push(mesh.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
        }
        return points;
      });
      applyMaskedHitOverlay(scene, overlay, time); scene.updateMatrixWorld(true);
      for (let bone = 0; bone < protectedBones.length; bone++) {
        const after = protectedBones[bone]!.matrixWorld.elements;
        for (let element = 0; element < 16; element++) maximumSupportDifference = Math.max(maximumSupportDifference, Math.abs(after[element]! - before[bone]!.elements[element]!));
      }
      for (let meshIndex = 0; meshIndex < movingMeshes.length; meshIndex++) {
        const mesh = movingMeshes[meshIndex]!;
        for (let vertex = 0; vertex < mesh.geometry.attributes.position!.count; vertex++) {
          mesh.getVertexPosition(vertex, sampleVertex).applyMatrix4(mesh.matrixWorld);
          minimumFloor = Math.min(minimumFloor, sampleVertex.y);
          if (vertex % 64 === 0) maximumVertexTravel = Math.max(maximumVertexTravel, sampleVertex.distanceTo(vertices[meshIndex]![vertex / 64]!));
        }
      }
    }
    assert(maximumSupportDifference < 1e-10, `${baseName}/${hitName} moved protected hover/support bones`);
    assert(minimumFloor > .18, `${baseName}/${hitName} broke hover clearance: ${minimumFloor}`);
    assert(maximumVertexTravel > .02, `${baseName}/${hitName} has no visible reaction`);
    rows.push({ baseName, hitName, samples: count + 1, boneNames: overlay.boneNames, minimumFloor, maximumSupportDifference, maximumVertexTravel });
  }
}
await writeFile(`${output}/hollow-hit-preflight.json`, JSON.stringify({ status: 'pass', sha256: asset.sha256,
  note: 'Actual exported vertices with the production additive mask at 120 Hz; browser Hit is a separate gate.', rows }, null, 2));
console.log(JSON.stringify({ status: 'pass', combinations: rows.length, minimumFloor: Math.min(...rows.map(row => row.minimumFloor)),
  maximumProtectedDifference: Math.max(...rows.map(row => row.maximumSupportDifference)), minimumVisibleReaction: Math.min(...rows.map(row => row.maximumVertexTravel)) }));
