import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { clone as cloneRigged } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const here = 'assets/art/tripo/imports/creatures/audit-skeleton-elites';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const required = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'HitLeft', 'HitRight', 'Death'];
async function load(file) {
  const doc = await io.readBinary(await readFile(file));
  for (const material of doc.getRoot().listMaterials()) material.setBaseColorTexture(null).setNormalTexture(null)
    .setMetallicRoughnessTexture(null).setEmissiveTexture(null).setOcclusionTexture(null);
  await doc.transform(prune());
  const bytes = await io.writeBinary(doc);
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}
function frame(gltf, clip, seconds) {
  const scene = cloneRigged(gltf.scene);
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.setTime(seconds);
  scene.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  const flattened = [];
  const bounds = new THREE.Box3();
  scene.traverse(node => {
    if (!node.isMesh) return;
    for (let index = 0; index < node.geometry.attributes.position.count; index++) {
      if (node.isSkinnedMesh) node.getVertexPosition(index, point);
      else point.fromBufferAttribute(node.geometry.attributes.position, index);
      point.applyMatrix4(node.matrixWorld);
      flattened.push(point.x, point.y, point.z);
      bounds.expandByPoint(point);
    }
  });
  return { vertices: Float32Array.from(flattened), min: bounds.min.toArray(), max: bounds.max.toArray() };
}
const reports = [];
for (const [kind, scale] of [['archer', 1.08], ['mage', 1.06], ['soldier', 1.12]]) {
  const original = await load(`game/public/assets/models/creature/creature_skeleton_${kind}.glb`);
  const elite = await load(`${here}/creature_skeleton_${kind}_elite.glb`);
  assert.deepEqual(original.animations.map(clip => clip.name), required);
  assert.deepEqual(elite.animations.map(clip => clip.name), required);
  let maximumScaledVertexError = 0, minimumY = Infinity, deformation = Infinity;
  const clips = [];
  for (let index = 0; index < required.length; index++) {
    const sourceClip = original.animations[index], eliteClip = elite.animations[index];
    assert(Math.abs(sourceClip.duration - eliteClip.duration) < 1e-5);
    let clipDelta = 0;
    const rest = frame(elite, eliteClip, 0);
    for (const phase of [0, .125, .25, .375, .5, .625, .75, .875, 1]) {
      const time = Math.max(0, eliteClip.duration * phase - (phase === 1 ? 1e-5 : 0));
      const sourceFrame = frame(original, sourceClip, time);
      const eliteFrame = frame(elite, eliteClip, time);
      assert.equal(sourceFrame.vertices.length, eliteFrame.vertices.length);
      minimumY = Math.min(minimumY, eliteFrame.min[1]);
      for (let vertex = 0; vertex < eliteFrame.vertices.length; vertex++) {
        maximumScaledVertexError = Math.max(maximumScaledVertexError, Math.abs(sourceFrame.vertices[vertex] * scale - eliteFrame.vertices[vertex]));
        clipDelta = Math.max(clipDelta, Math.abs(eliteFrame.vertices[vertex] - rest.vertices[vertex]));
      }
    }
    assert(clipDelta > .01, `${kind}/${eliteClip.name} barely moves.`);
    clips.push({ name: eliteClip.name, seconds: eliteClip.duration, maximumVertexMovement: clipDelta });
    deformation = Math.min(deformation, clipDelta);
  }
  assert(maximumScaledVertexError < 1e-4, `${kind}: elite motion differs from starter beyond presentation scale: ${maximumScaledVertexError}.`);
  reports.push({ kind, scale, maximumScaledVertexError, minimumY, minimumClipMovement: deformation, clips });
}
console.log(JSON.stringify({ reports, evidence: 'CPU-skinned source and elite at nine phases of all eight clips; texture appearance still needs root lab review.' }, null, 2));
