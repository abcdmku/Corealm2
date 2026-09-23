import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { clone as cloneRigged } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const directory = 'assets/art/tripo/imports/creatures/starred-leafwing';
const glb = await readFile(`${directory}/ambervein-leafwing-native-rig.glb`);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.readBinary(glb);
for (const material of doc.getRoot().listMaterials()) {
  material.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null)
    .setEmissiveTexture(null).setOcclusionTexture(null);
}
await doc.transform(prune());
const bytes = await io.writeBinary(doc);
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const required = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
assert.deepEqual(gltf.animations.map(clip => clip.name), required);

function sample(scene, mesh, clip, time) {
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.play();
  mixer.setTime(time);
  scene.updateMatrixWorld(true);
  const positions = [];
  const vertex = new THREE.Vector3();
  for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
    mesh.getVertexPosition(i, vertex);
    vertex.applyMatrix4(mesh.matrixWorld);
    positions.push(vertex.x, vertex.y, vertex.z);
  }
  return positions;
}
function maxDelta(left, right) {
  assert.equal(left.length, right.length);
  let delta = 0;
  for (let i = 0; i < left.length; i++) delta = Math.max(delta, Math.abs(left[i] - right[i]));
  return delta;
}
function makeRegions(mesh) {
  const indexAttribute = mesh.geometry.attributes.skinIndex;
  const weightAttribute = mesh.geometry.attributes.skinWeight;
  const wingJoints = new Set(mesh.skeleton.bones.map((bone, index) => /^Wing/.test(bone.name) ? index : -1).filter(index => index >= 0));
  const legJoints = new Set(mesh.skeleton.bones.map((bone, index) => /^Leg/.test(bone.name) ? index : -1).filter(index => index >= 0));
  const wing = [], leg = [], body = [];
  for (let vertex = 0; vertex < indexAttribute.count; vertex++) {
    let wingWeight = 0, legWeight = 0;
    for (let component = 0; component < 4; component++) {
      const joint = indexAttribute.getComponent(vertex, component), weight = weightAttribute.getComponent(vertex, component);
      if (wingJoints.has(joint)) wingWeight += weight;
      if (legJoints.has(joint)) legWeight += weight;
    }
    if (wingWeight > .20) wing.push(vertex);
    if (legWeight > .20) leg.push(vertex);
    if (wingWeight < .20 && legWeight < .20) body.push(vertex);
  }
  assert(wing.length > 100 && leg.length > 100 && body.length > 100, `Unexpected skin partition sizes: ${wing.length}/${leg.length}/${body.length}`);
  return { wing, leg, body };
}
function regionDelta(before, after, indices) {
  let delta = 0;
  for (const vertex of indices) for (let axis = 0; axis < 3; axis++) {
    const at = vertex * 3 + axis;
    delta = Math.max(delta, Math.abs(before[at] - after[at]));
  }
  return delta;
}

const reports = [];
for (const clip of gltf.animations) {
  const scene = cloneRigged(gltf.scene);
  const mesh = [];
  scene.traverse(node => { if (node.isSkinnedMesh) mesh.push(node); });
  assert.equal(mesh.length, 1, 'Expected one skinned creature body.');
  const regions = makeRegions(mesh[0]);
  const start = sample(scene, mesh[0], clip, 0);
  const middle = sample(scene, mesh[0], clip, clip.duration * .50);
  const end = sample(scene, mesh[0], clip, clip.duration);
  const row = {
    clip: clip.name,
    seconds: clip.duration,
    maxVertexDelta: Math.max(maxDelta(start, middle), maxDelta(start, end)),
    wingSurfaceDelta: Math.max(regionDelta(start, middle, regions.wing), regionDelta(start, end, regions.wing)),
    legSurfaceDelta: Math.max(regionDelta(start, middle, regions.leg), regionDelta(start, end, regions.leg)),
    bodySurfaceDelta: Math.max(regionDelta(start, middle, regions.body), regionDelta(start, end, regions.body)),
  };
  assert(row.maxVertexDelta > .008, `${clip.name} barely deforms the skinned mesh: ${row.maxVertexDelta}`);
  reports.push(row);
}
assert(reports.find(row => row.clip === 'Idle').wingSurfaceDelta > .015, 'Idle does not visibly beat the leaf wings.');
assert(reports.find(row => row.clip === 'Walk').wingSurfaceDelta > .02, 'Glide slot does not articulate the leaf wings.');
assert(reports.find(row => row.clip === 'Run').wingSurfaceDelta > .02, 'Fast-flight slot does not articulate the leaf wings.');
assert(reports.find(row => row.clip === 'Attack').legSurfaceDelta > .012, 'Attack does not articulate the striking limbs.');
assert(reports.find(row => row.clip === 'Hit').bodySurfaceDelta > .012, 'Hit does not articulate the body recoil.');
assert(reports.find(row => row.clip === 'Death').wingSurfaceDelta > .03, 'Death does not fold the leaf wings.');
console.log(JSON.stringify({ vertices: 2682, triangles: 3754, clips: reports, evidence: 'CPU-sampled GLTFLoader skin deformation; renderer and artistic visual review remain root-lab tasks.' }, null, 2));
