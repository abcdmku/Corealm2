import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { clone as cloneRigged } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const here = 'assets/art/tripo/imports/creatures/audit-petalguards';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const reports = [];
for (const id of ['fairy_garden_petalguard_faeholme', 'fairy_garden_petalguard_gloamgarden']) {
  const doc = await io.readBinary(await readFile(`${here}/${id}.glb`));
  for (const material of doc.getRoot().listMaterials()) material.setBaseColorTexture(null).setNormalTexture(null)
    .setMetallicRoughnessTexture(null).setEmissiveTexture(null).setOcclusionTexture(null);
  await doc.transform(prune());
  const bytes = await io.writeBinary(doc);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  assert.deepEqual(gltf.animations.map(clip => clip.name), ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death']);
  const scene = cloneRigged(gltf.scene);
  const skinned = [];
  scene.traverse(node => { if (node.isSkinnedMesh) skinned.push(node); });
  assert.equal(skinned.length, 1);
  const mesh = skinned[0];
  const sample = (clip, time) => {
    const mixer = new THREE.AnimationMixer(scene);
    const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    mixer.setTime(time);
    scene.updateMatrixWorld(true);
    const vertex = new THREE.Vector3();
    const bounds = new THREE.Box3();
    const positions = new Float32Array(mesh.geometry.attributes.position.count * 3);
    for (let index = 0; index < mesh.geometry.attributes.position.count; index++) {
      mesh.getVertexPosition(index, vertex);
      vertex.applyMatrix4(mesh.matrixWorld);
      positions.set(vertex.toArray(), index * 3);
      bounds.expandByPoint(vertex);
    }
    mixer.stopAllAction();
    return { min: bounds.min.toArray(), max: bounds.max.toArray(), positions };
  };
  const height = bounds => bounds.max[1] - bounds.min[1];
  const maxDelta = (a, b) => {
    let delta = 0;
    for (let index = 0; index < a.length; index++) delta = Math.max(delta, Math.abs(a[index] - b[index]));
    return delta;
  };
  const clipReports = [];
  for (const clip of gltf.animations) {
    const frames = Array.from({ length: 65 }, (_, index) => sample(clip, clip.duration * index / 64));
    const minimumY = Math.min(...frames.map(frame => frame.min[1]));
    const deformation = Math.max(...frames.slice(1).map(frame => maxDelta(frame.positions, frames[0].positions)));
    assert(minimumY > -.03, `${id}/${clip.name} penetrates floor by ${minimumY}m.`);
    assert(deformation > .01, `${id}/${clip.name} barely deforms.`);
    const row = { name: clip.name, duration: clip.duration, minimumY, maximumVertexDelta: deformation };
    if (clip.name === 'Death') {
      const at75 = sample(clip, .75);
      const end = frames.at(-1);
      const idle = sample(gltf.animations[0], 0);
      row.idleHeight = height(idle);
      row.heightAt75 = height(at75);
      row.endHeight = height(end);
      row.endMinimumY = end.min[1];
      assert(row.heightAt75 / row.idleHeight < .63, `${id} is still upright at 0.75s.`);
      assert(row.endHeight / row.idleHeight < .63, `${id} ends too upright.`);
      assert(row.endMinimumY < .08, `${id} corpse does not contact the floor.`);
    }
    clipReports.push(row);
  }
  reports.push({ id, vertices: mesh.geometry.attributes.position.count, clips: clipReports });
}
console.log(JSON.stringify({ reports, evidence: '65 CPU-skinned frames per clip; game-lab visual proof remains with root.' }, null, 2));
