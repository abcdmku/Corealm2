import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, Accessor } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';

const here = path.dirname(fileURLToPath(import.meta.url));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const correct = process.argv.includes('--correct');
const staged = process.argv.includes('--staged');
const candidates = [
  ['Lantern Sprite', staged ? 'lantern-sprite-candidate.glb' : '../starred-leafwing/ambervein-leafwing-native-rig.glb'],
  ['Orchid Reaper', staged ? 'orchid-reaper-candidate.glb' : '../starred-orchid-reaper/orchid-reaper-native-rig-candidate.glb'],
];

function sample(channel, seconds) {
  const sampler = channel.getSampler();
  const times = sampler.getInput().getArray();
  const values = sampler.getOutput().getArray();
  const width = channel.getTargetPath() === 'rotation' ? 4 : 3;
  let a = 0;
  while (a < times.length - 2 && times[a + 1] < seconds) a++;
  const b = Math.min(a + 1, times.length - 1);
  const fraction = times[b] > times[a] ? Math.max(0, Math.min(1, (seconds - times[a]) / (times[b] - times[a]))) : 0;
  const va = Array.from(values.slice(a * width, a * width + width));
  const vb = Array.from(values.slice(b * width, b * width + width));
  return width === 4
    ? new THREE.Quaternion(...va).slerp(new THREE.Quaternion(...vb), fraction).toArray()
    : va.map((value, index) => value * (1 - fraction) + vb[index] * fraction);
}

function weightedBounds(doc, clip, seconds) {
  const root = doc.getRoot();
  const meshNode = root.listNodes().find(node => node.getMesh() && node.getSkin());
  if (!meshNode) throw new Error('Missing skinned mesh');
  const primitive = meshNode.getMesh().listPrimitives()[0];
  const positions = primitive.getAttribute('POSITION').getArray();
  const indices = primitive.getAttribute('JOINTS_0').getArray();
  const weights = primitive.getAttribute('WEIGHTS_0').getArray();
  const skin = meshNode.getSkin();
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices().getArray();
  const overrides = new Map();
  for (const channel of clip.listChannels()) {
    const node = channel.getTargetNode();
    const value = overrides.get(node) ?? {};
    value[channel.getTargetPath()] = sample(channel, seconds);
    overrides.set(node, value);
  }
  const worlds = new Map();
  const worldOf = node => {
    if (worlds.has(node)) return worlds.get(node);
    const override = overrides.get(node);
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(override?.translation ?? node.getTranslation()),
      new THREE.Quaternion().fromArray(override?.rotation ?? node.getRotation()),
      new THREE.Vector3().fromArray(override?.scale ?? node.getScale()),
    );
    const parent = node.getParentNode();
    const world = parent ? worldOf(parent).clone().multiply(local) : local;
    worlds.set(node, world);
    return world;
  };
  const meshWorld = worldOf(meshNode);
  const inverseMesh = meshWorld.clone().invert();
  const boneMatrices = joints.map((joint, index) => inverseMesh.clone().multiply(worldOf(joint))
    .multiply(new THREE.Matrix4().fromArray(Array.from(ibm.slice(index * 16, index * 16 + 16)))));
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  const weighted = new THREE.Vector3();
  const transformed = new THREE.Vector3();
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    point.fromArray(positions, vertex * 3);
    weighted.set(0, 0, 0);
    for (let slot = 0; slot < 4; slot++) {
      const offset = vertex * 4 + slot;
      if (!weights[offset]) continue;
      transformed.copy(point).applyMatrix4(boneMatrices[indices[offset]]);
      weighted.addScaledVector(transformed, weights[offset]);
    }
    weighted.applyMatrix4(meshWorld);
    bounds.expandByPoint(weighted);
  }
  return { min: bounds.min.toArray(), max: bounds.max.toArray() };
}

for (const [name, relative] of candidates) {
  const doc = await io.read(path.resolve(here, relative));
  const skin = doc.getRoot().listSkins()[0];
  if (correct) {
    const rootName = name === 'Lantern Sprite' ? 'LeafwingRoot' : 'OrchidRoot';
    const rootJoint = doc.getRoot().listNodes().find(node => node.getName() === rootName);
    const buffer = doc.getRoot().listBuffers()[0];
    let parentScale = 1;
    for (let node = rootJoint.getParentNode(); node; node = node.getParentNode()) parentScale *= node.getScale()[1];
    for (const clip of doc.getRoot().listAnimations()) {
      if (clip.getName() === 'Death') {
        const duration = name === 'Lantern Sprite' ? 1.55 : 1.55;
        const times = [0, .22, .52, .9, 1.25, duration];
        const angles = name === 'Lantern Sprite'
          ? [0, .08, .43, 1.12, 1.63, 1.82]
          : [0, .06, .47, 1.08, 1.43, 1.51];
        const values = angles.flatMap(angle => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle).toArray());
        const existing = clip.listChannels().find(item => item.getTargetNode() === rootJoint && item.getTargetPath() === 'rotation');
        const sampler = existing?.getSampler() ?? doc.createAnimationSampler('Death collapsed root sampler');
        sampler.setInput(doc.createAccessor('Death collapsed root times').setType(Accessor.Type.SCALAR).setArray(new Float32Array(times)).setBuffer(buffer))
          .setOutput(doc.createAccessor('Death collapsed root rotations').setType(Accessor.Type.VEC4).setArray(new Float32Array(values)).setBuffer(buffer));
        if (!existing) clip.addSampler(sampler).addChannel(doc.createAnimationChannel('Death collapsed root channel')
          .setTargetNode(rootJoint).setTargetPath('rotation').setSampler(sampler));
        if (name === 'Lantern Sprite') {
          const scales = [1, 1, .96, .86, .76, .70].flatMap(value => [value, value, value]);
          const scaleSampler = doc.createAnimationSampler('Death crumpled sprite sampler')
            .setInput(doc.createAccessor('Death crumpled sprite times').setType(Accessor.Type.SCALAR).setArray(new Float32Array(times)).setBuffer(buffer))
            .setOutput(doc.createAccessor('Death crumpled sprite scales').setType(Accessor.Type.VEC3).setArray(new Float32Array(scales)).setBuffer(buffer));
          clip.addSampler(scaleSampler).addChannel(doc.createAnimationChannel('Death crumpled sprite channel')
            .setTargetNode(rootJoint).setTargetPath('scale').setSampler(scaleSampler));
        }
      }
      const channel = clip.listChannels().find(item => item.getTargetNode() === rootJoint && item.getTargetPath() === 'translation');
      const duration = Math.max(...clip.listChannels().flatMap(item => Array.from(item.getSampler().getInput().getArray())));
      const times = Array.from({ length: 65 }, (_, index) => duration * index / 64);
      const values = [];
      for (const time of times) {
        const original = channel ? sample(channel, time) : rootJoint.getTranslation();
        const floor = weightedBounds(doc, clip, time).min[1];
        values.push(original[0], original[1] + Math.max(0, .006 - floor) / parentScale, original[2]);
      }
      const sampler = channel?.getSampler() ?? doc.createAnimationSampler(`${clip.getName()} grounded root sampler`);
      sampler
        .setInput(doc.createAccessor(`${clip.getName()} grounded times`).setType(Accessor.Type.SCALAR).setArray(new Float32Array(times)).setBuffer(buffer))
        .setOutput(doc.createAccessor(`${clip.getName()} grounded root`).setType(Accessor.Type.VEC3).setArray(new Float32Array(values)).setBuffer(buffer));
      if (!channel) clip.addSampler(sampler).addChannel(doc.createAnimationChannel(`${clip.getName()} grounded root channel`)
        .setTargetNode(rootJoint).setTargetPath('translation').setSampler(sampler));
    }
    const output = path.join(here, name === 'Lantern Sprite' ? 'lantern-sprite-candidate.glb' : 'orchid-reaper-candidate.glb');
    await io.write(output, doc);
  }
  const report = { name, joints: skin.listJoints().length, clips: [] };
  for (const clip of doc.getRoot().listAnimations()) {
    const duration = Math.max(...clip.listChannels().flatMap(channel => Array.from(channel.getSampler().getInput().getArray())));
    const sampleCount = staged ? 65 : 17;
    const samples = Array.from({ length: sampleCount }, (_, index) => weightedBounds(doc, clip, duration * index / (sampleCount - 1)));
    const minY = Math.min(...samples.map(item => item.min[1]));
    const maxY = Math.max(...samples.map(item => item.max[1]));
    report.clips.push({ name: clip.getName(), duration, minY, maxY,
      midBounds: samples[(sampleCount - 1) / 2], endBounds: samples[sampleCount - 1] });
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
