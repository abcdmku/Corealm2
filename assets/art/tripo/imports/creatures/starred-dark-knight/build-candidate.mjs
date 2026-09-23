import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const baseDir = 'assets/art/tripo/imports/creatures/starred-dark-knight';
const sourcePath = 'assets/art/tripo/exports/8f2d7a21-7419-4337-ae73-570e04c16499.glb';
const candidatePath = `${baseDir}/black-keep-knight-native-rig.glb`;
await mkdir(baseDir, { recursive: true });

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
if (sourceSha256 !== '1cd47dbf8c637cf9d8f121ef5acaff0429f19ee01fa77cb2304e73e87169f121') {
  throw new Error(`Dark Knight source hash mismatch: ${sourceSha256}`);
}
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find((node) => node.getMesh() === mesh);
if (!scene || !primitive || !meshNode || root.listSkins().length !== 1 || root.listAnimations().length) {
  throw new Error('Expected the approved starred Dark Knight GLB with one damaged source skin and no clips.');
}
const positions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
const normals = Float32Array.from(primitive.getAttribute('NORMAL')?.getArray() ?? []);
const uvs = Float32Array.from(primitive.getAttribute('TEXCOORD_0')?.getArray() ?? []);
const indices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
if (positions.length / 3 !== 6153 || indices.length / 3 !== 4305 || normals.length !== positions.length || uvs.length / 2 !== positions.length / 3) {
  throw new Error(`Source topology changed: ${positions.length / 3} vertices, ${indices.length / 3} triangles.`);
}
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
  bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
}

// Standard Mixamo bone labels make this a Unity Humanoid-mappable glTF skeleton.
// The bind pose follows the compact upright source mesh; no geometry is retopologized.
const bones = [
  { name: 'mixamorigHips', parent: null, p: [0, 0.430, 0.000], sigma: 0.115, group: 'torso' },
  { name: 'mixamorigSpine', parent: 'mixamorigHips', p: [0, 0.515, 0.000], sigma: 0.105, group: 'torso' },
  { name: 'mixamorigSpine1', parent: 'mixamorigSpine', p: [0, 0.610, 0.000], sigma: 0.105, group: 'torso' },
  { name: 'mixamorigSpine2', parent: 'mixamorigSpine1', p: [0, 0.700, 0.000], sigma: 0.100, group: 'torso' },
  { name: 'mixamorigNeck', parent: 'mixamorigSpine2', p: [0, 0.785, 0.015], sigma: 0.072, group: 'torso' },
  { name: 'mixamorigHead', parent: 'mixamorigNeck', p: [0, 0.875, 0.025], sigma: 0.085, group: 'head' },
  { name: 'mixamorigLeftShoulder', parent: 'mixamorigSpine2', p: [-0.145, 0.705, 0.000], sigma: 0.075, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftArm', parent: 'mixamorigLeftShoulder', p: [-0.205, 0.655, 0.000], sigma: 0.072, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftForeArm', parent: 'mixamorigLeftArm', p: [-0.235, 0.505, 0.010], sigma: 0.066, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftHand', parent: 'mixamorigLeftForeArm', p: [-0.245, 0.365, 0.025], sigma: 0.065, group: 'leftArm', side: -1 },
  { name: 'mixamorigRightShoulder', parent: 'mixamorigSpine2', p: [0.145, 0.705, 0.000], sigma: 0.075, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightArm', parent: 'mixamorigRightShoulder', p: [0.205, 0.655, 0.000], sigma: 0.072, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightForeArm', parent: 'mixamorigRightArm', p: [0.235, 0.505, 0.010], sigma: 0.066, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightHand', parent: 'mixamorigRightForeArm', p: [0.245, 0.365, 0.025], sigma: 0.065, group: 'rightArm', side: 1 },
  { name: 'mixamorigLeftUpLeg', parent: 'mixamorigHips', p: [-0.115, 0.380, -0.005], sigma: 0.072, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftLeg', parent: 'mixamorigLeftUpLeg', p: [-0.125, 0.205, 0.000], sigma: 0.062, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftFoot', parent: 'mixamorigLeftLeg', p: [-0.125, 0.052, 0.025], sigma: 0.052, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftToeBase', parent: 'mixamorigLeftFoot', p: [-0.125, 0.030, 0.095], sigma: 0.050, group: 'leftLeg', side: -1 },
  { name: 'mixamorigRightUpLeg', parent: 'mixamorigHips', p: [0.115, 0.380, -0.005], sigma: 0.072, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightLeg', parent: 'mixamorigRightUpLeg', p: [0.125, 0.205, 0.000], sigma: 0.062, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightFoot', parent: 'mixamorigRightLeg', p: [0.125, 0.052, 0.025], sigma: 0.052, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightToeBase', parent: 'mixamorigRightFoot', p: [0.125, 0.030, 0.095], sigma: 0.050, group: 'rightLeg', side: 1 },
  { name: 'mixamorigCapeRoot', parent: 'mixamorigSpine2', p: [0, 0.715, 0.072], sigma: 0.078, group: 'cape' },
  { name: 'mixamorigCapeMid', parent: 'mixamorigCapeRoot', p: [0, 0.405, 0.120], sigma: 0.070, group: 'cape' },
  { name: 'mixamorigCapeTip', parent: 'mixamorigCapeMid', p: [0, 0.125, 0.125], sigma: 0.065, group: 'cape' },
];
const boneByName = new Map(bones.map((bone, index) => [bone.name, { ...bone, index }]));
for (const bone of bones) {
  const parent = bone.parent ? boneByName.get(bone.parent) : null;
  bone.local = parent ? bone.p.map((value, axis) => value - parent.p[axis]) : bone.p;
}

const sourceNodes = [...root.listNodes()];
const originalParent = meshNode.getParentNode();
if (originalParent) originalParent.removeChild(meshNode);
else if (scene.listChildren().includes(meshNode)) scene.removeChild(meshNode);
else throw new Error('Source mesh node is detached from the scene.');
primitive.setAttribute('JOINTS_0', null);
primitive.setAttribute('WEIGHTS_0', null);
meshNode.setSkin(null).setName('BlackKeepKnightMesh').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
for (const sourceSkin of [...root.listSkins()]) sourceSkin.dispose();
for (const sourceNode of sourceNodes) if (sourceNode !== meshNode) sourceNode.dispose();
const presentationScale = 1.62;
const presentationRoot = doc.createNode('BlackKeepKnightPresentation').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([presentationScale, presentationScale, presentationScale]);
const rigContainer = doc.createNode('BlackKeepKnightArmature').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
scene.addChild(presentationRoot);
presentationRoot.addChild(rigContainer);
rigContainer.addChild(meshNode);

const jointNodes = new Map();
for (const bone of bones) {
  const node = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  jointNodes.set(bone.name, node);
  const parent = bone.parent ? jointNodes.get(bone.parent) : rigContainer;
  parent.addChild(node);
}
const skin = doc.createSkin('BlackKeepKnight_Humanoid').setSkeleton(jointNodes.get('mixamorigHips'));
for (const bone of bones) skin.addJoint(jointNodes.get(bone.name));
const inverseBinds = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i++) {
  const [x, y, z] = bones[i].p;
  inverseBinds.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
}
const buffer = root.listBuffers()[0];
skin.setInverseBindMatrices(doc.createAccessor('BlackKeepKnight_InverseBind').setArray(inverseBinds).setType(Accessor.Type.MAT4).setBuffer(buffer));
meshNode.setSkin(skin);

function segmentDistance(point, start, end) {
  const vector = end.map((value, axis) => value - start[axis]);
  const length2 = vector.reduce((sum, value) => sum + value * value, 0) || 1;
  const t = Math.max(0, Math.min(1, point.reduce((sum, value, axis) => sum + (value - start[axis]) * vector[axis], 0) / length2));
  return Math.hypot(...point.map((value, axis) => value - (start[axis] + t * vector[axis])));
}
const jointValues = new Uint16Array(positions.length / 3 * 4);
const weightValues = new Float32Array(positions.length / 3 * 4);
const influenceCounts = new Uint32Array(bones.length);
let maximumWeightSumError = 0;
let verticesWithCapeWeight = 0;
let capeMaxWeight = 0;
const smoothstep = (edge0, edge1, value) => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const [x, y] = point;
  const candidates = [];
  const capeHeight = smoothstep(0.075, 0.17, y) * (1 - smoothstep(0.72, 0.86, y));
  const capeDepth = 1 / (1 + Math.exp(-(point[2] - 0.078) / 0.024));
  const capeWidth = 1 - smoothstep(0.20, 0.31, Math.abs(x));
  const capeGate = 0.94 * capeHeight * capeDepth * capeWidth;
  if (capeGate > 0.35) verticesWithCapeWeight++;
  capeMaxWeight = Math.max(capeMaxWeight, capeGate);
  for (const bone of bones) {
    const parent = bone.parent ? boneByName.get(bone.parent) : null;
    const distance = segmentDistance(point, parent?.p ?? bone.p, bone.p);
    let gate = 1;
    if (bone.group === 'cape') {
      gate = capeGate;
    } else {
      if (bone.group === 'head') gate = y >= 0.815 ? 1 : 0.006;
      if (bone.group === 'leftArm' || bone.group === 'rightArm') {
        gate = y > 0.255 && y < 0.84 ? 1 : 0.006;
        const lateral = bone.side * x;
        gate *= 0.008 + 0.992 / (1 + Math.exp(-(lateral - 0.095) / 0.035));
      }
      if (bone.group === 'leftLeg' || bone.group === 'rightLeg') {
        gate = y < 0.475 ? 1 : 0.006;
        const lateral = bone.side * x;
        gate *= 0.008 + 0.992 / (1 + Math.exp(-(lateral - 0.012) / 0.040));
      }
      gate *= 1 - capeGate;
    }
    const score = gate * Math.exp(-0.5 * (distance / bone.sigma) ** 2);
    if (score > 1e-10) candidates.push({ index: boneByName.get(bone.name).index, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 4);
  if (!chosen.length) throw new Error(`No anatomical weights could be assigned at vertex ${vertex}.`);
  const total = chosen.reduce((sum, candidate) => sum + candidate.score, 0);
  let assigned = 0;
  for (let slot = 0; slot < 4; slot++) {
    const candidate = chosen[slot] ?? chosen[0];
    const weight = slot >= chosen.length ? 0 : slot === chosen.length - 1 ? 1 - assigned : candidate.score / total;
    jointValues[vertex * 4 + slot] = candidate.index;
    weightValues[vertex * 4 + slot] = weight;
    assigned += weight;
    if (weight > 1e-6) influenceCounts[candidate.index]++;
  }
  const sum = weightValues[vertex * 4] + weightValues[vertex * 4 + 1] + weightValues[vertex * 4 + 2] + weightValues[vertex * 4 + 3];
  maximumWeightSumError = Math.max(maximumWeightSumError, Math.abs(sum - 1));
}
primitive.setAttribute('JOINTS_0', doc.createAccessor('BlackKeepKnight_Joints0').setArray(jointValues).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('BlackKeepKnight_Weights0').setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(buffer));

const quat = (axis, angle) => {
  const sine = Math.sin(angle / 2), cosine = Math.cos(angle / 2);
  if (axis === 'x') return [sine, 0, 0, cosine];
  if (axis === 'y') return [0, sine, 0, cosine];
  return [0, 0, sine, cosine];
};
const clips = [];
function addClip(name, seconds, tracks) {
  const animation = doc.createAnimation(name);
  for (const track of tracks) {
    const input = doc.createAccessor(`${name}_${track.node}_time`).setArray(Float32Array.from(track.times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const output = doc.createAccessor(`${name}_${track.node}_${track.path ?? 'rotation'}_value`).setArray(Float32Array.from(track.values.flat())).setType(track.path === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4).setBuffer(buffer);
    const sampler = doc.createAnimationSampler(`${name}_${track.node}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${track.node}_${track.path ?? 'rotation'}`).setTargetNode(jointNodes.get(track.node)).setTargetPath(track.path ?? 'rotation').setSampler(sampler));
  }
  clips.push({ name, seconds, channels: tracks.length });
}
const phases = [0, 0.25, 0.5, 0.75, 1];
const cycleAngles = (phase, amount) => phases.map((t) => quat('x', Math.sin((t + phase) * Math.PI * 2) * amount));
const hips = (heights, forward = 0) => phases.map((_, i) => [0, heights[i], forward]);
addClip('Idle', 2.8, [
  { node: 'mixamorigLeftShoulder', times: [0, 0.7, 1.4, 2.1, 2.8], values: [quat('z', 0.62), quat('z', 0.66), quat('z', 0.62), quat('z', 0.58), quat('z', 0.62)] },
  { node: 'mixamorigRightShoulder', times: [0, 0.7, 1.4, 2.1, 2.8], values: [quat('z', -0.62), quat('z', -0.66), quat('z', -0.62), quat('z', -0.58), quat('z', -0.62)] },
  { node: 'mixamorigSpine1', times: [0, 0.7, 1.4, 2.1, 2.8], values: [quat('z', 0), quat('z', 0.018), quat('z', 0), quat('z', -0.018), quat('z', 0)] },
  { node: 'mixamorigSpine2', times: [0, 0.7, 1.4, 2.1, 2.8], values: [quat('x', 0), quat('x', -0.015), quat('x', 0), quat('x', 0.012), quat('x', 0)] },
  { node: 'mixamorigHead', times: [0, 0.7, 1.4, 2.1, 2.8], values: [quat('y', -0.025), quat('y', 0.015), quat('y', 0.035), quat('y', -0.015), quat('y', -0.025)] },
  { node: 'mixamorigCapeRoot', times: [0, 0.7, 1.4, 2.1, 2.8], values: [quat('x', 0), quat('x', -0.025), quat('x', 0), quat('x', 0.025), quat('x', 0)] },
  { node: 'mixamorigCapeMid', times: [0, 0.7, 1.4, 2.1, 2.8], values: [quat('z', 0), quat('z', 0.016), quat('z', 0), quat('z', -0.016), quat('z', 0)] },
  { node: 'mixamorigCapeTip', times: [0, 0.7, 1.4, 2.1, 2.8], values: [quat('x', 0.012), quat('x', -0.018), quat('x', 0.012), quat('x', -0.018), quat('x', 0.012)] },
]);
addClip('Walk', 1.0, [
  { node: 'mixamorigHips', path: 'translation', times: phases.map((t) => t), values: hips([0.430, 0.445, 0.430, 0.445, 0.430]) },
  { node: 'mixamorigLeftShoulder', times: phases, values: phases.map((t) => quat('z', 0.48 + Math.sin(t * Math.PI * 2) * 0.25)) },
  { node: 'mixamorigRightShoulder', times: phases, values: phases.map((t) => quat('z', -0.48 - Math.sin(t * Math.PI * 2) * 0.25)) },
  { node: 'mixamorigLeftUpLeg', times: phases, values: cycleAngles(0, 0.34) },
  { node: 'mixamorigRightUpLeg', times: phases, values: cycleAngles(0.5, 0.34) },
  { node: 'mixamorigLeftLeg', times: phases, values: phases.map((t) => quat('x', -Math.max(0, Math.sin(t * Math.PI * 2)) * 0.22)) },
  { node: 'mixamorigRightLeg', times: phases, values: phases.map((t) => quat('x', -Math.max(0, Math.sin((t + 0.5) * Math.PI * 2)) * 0.22)) },
  { node: 'mixamorigLeftArm', times: phases, values: cycleAngles(0.5, 0.20) },
  { node: 'mixamorigRightArm', times: phases, values: cycleAngles(0, 0.20) },
  { node: 'mixamorigCapeRoot', times: phases, values: phases.map((t) => quat('x', Math.sin(t * Math.PI * 2) * 0.09)) },
  { node: 'mixamorigCapeMid', times: phases, values: phases.map((t) => quat('z', Math.sin(t * Math.PI * 2) * 0.045)) },
  { node: 'mixamorigCapeTip', times: phases, values: phases.map((t) => quat('x', Math.sin((t + 0.15) * Math.PI * 2) * 0.12)) },
]);
addClip('Run', 0.72, [
  { node: 'mixamorigHips', path: 'translation', times: phases.map((t) => t * 0.72), values: hips([0.430, 0.465, 0.430, 0.465, 0.430]) },
  { node: 'mixamorigLeftShoulder', times: phases.map((t) => t * 0.72), values: phases.map((t) => quat('z', 0.50 + Math.sin(t * Math.PI * 2) * 0.34)) },
  { node: 'mixamorigRightShoulder', times: phases.map((t) => t * 0.72), values: phases.map((t) => quat('z', -0.50 - Math.sin(t * Math.PI * 2) * 0.34)) },
  { node: 'mixamorigLeftUpLeg', times: phases.map((t) => t * 0.72), values: cycleAngles(0, 0.68) },
  { node: 'mixamorigRightUpLeg', times: phases.map((t) => t * 0.72), values: cycleAngles(0.5, 0.68) },
  { node: 'mixamorigLeftLeg', times: phases.map((t) => t * 0.72), values: phases.map((t) => quat('x', -Math.max(0, Math.sin(t * Math.PI * 2)) * 0.62)) },
  { node: 'mixamorigRightLeg', times: phases.map((t) => t * 0.72), values: phases.map((t) => quat('x', -Math.max(0, Math.sin((t + 0.5) * Math.PI * 2)) * 0.62)) },
  { node: 'mixamorigLeftArm', times: phases.map((t) => t * 0.72), values: cycleAngles(0.5, 0.48) },
  { node: 'mixamorigRightArm', times: phases.map((t) => t * 0.72), values: cycleAngles(0, 0.48) },
  { node: 'mixamorigSpine1', times: phases.map((t) => t * 0.72), values: phases.map((t) => quat('x', 0.025 + Math.sin(t * Math.PI * 2) * 0.025)) },
  { node: 'mixamorigCapeRoot', times: phases.map((t) => t * 0.72), values: phases.map((t) => quat('x', 0.06 + Math.sin(t * Math.PI * 2) * 0.18)) },
  { node: 'mixamorigCapeMid', times: phases.map((t) => t * 0.72), values: phases.map((t) => quat('z', Math.sin(t * Math.PI * 2) * 0.075)) },
  { node: 'mixamorigCapeTip', times: phases.map((t) => t * 0.72), values: phases.map((t) => quat('x', -0.06 + Math.sin((t + 0.18) * Math.PI * 2) * 0.22)) },
]);
addClip('Attack', 0.92, [
  { node: 'mixamorigHips', path: 'translation', times: [0, 0.18, 0.50, 0.72, 0.92], values: [[0, 0.430, 0], [0, 0.430, 0.012], [0, 0.420, 0.060], [0, 0.430, 0.030], [0, 0.430, 0]] },
  { node: 'mixamorigLeftShoulder', times: [0, 0.18, 0.50, 0.72, 0.92], values: [quat('z', 0.62), quat('z', 0.72), quat('z', 0.48), quat('z', 0.42), quat('z', 0.62)] },
  { node: 'mixamorigRightShoulder', times: [0, 0.18, 0.50, 0.72, 0.92], values: [quat('z', -0.62), quat('z', -0.22), quat('z', 0.30), quat('z', -0.10), quat('z', -0.62)] },
  { node: 'mixamorigSpine1', times: [0, 0.18, 0.50, 0.72, 0.92], values: [quat('y', 0), quat('y', -0.28), quat('y', 0.24), quat('y', 0.10), quat('y', 0)] },
  { node: 'mixamorigRightArm', times: [0, 0.18, 0.50, 0.72, 0.92], values: [quat('z', 0), quat('z', 0.78), quat('z', -0.18), quat('z', -0.28), quat('z', 0)] },
  { node: 'mixamorigRightForeArm', times: [0, 0.18, 0.50, 0.72, 0.92], values: [quat('x', 0), quat('x', 0.60), quat('x', -0.92), quat('x', -0.30), quat('x', 0)] },
  { node: 'mixamorigLeftArm', times: [0, 0.18, 0.50, 0.72, 0.92], values: [quat('x', 0), quat('x', -0.20), quat('x', -0.28), quat('x', 0.10), quat('x', 0)] },
  { node: 'mixamorigCapeRoot', times: [0, 0.18, 0.50, 0.72, 0.92], values: [quat('x', 0), quat('x', -0.18), quat('x', 0.22), quat('x', 0.10), quat('x', 0)] },
  { node: 'mixamorigCapeMid', times: [0, 0.18, 0.50, 0.72, 0.92], values: [quat('z', 0), quat('z', -0.05), quat('z', 0.10), quat('z', 0.04), quat('z', 0)] },
  { node: 'mixamorigCapeTip', times: [0, 0.18, 0.50, 0.72, 0.92], values: [quat('x', 0), quat('x', -0.26), quat('x', 0.32), quat('x', 0.12), quat('x', 0)] },
]);
addClip('Hit', 0.46, [
  { node: 'mixamorigHips', path: 'translation', times: [0, 0.08, 0.20, 0.46], values: [[0, 0.430, 0], [0, 0.425, -0.035], [0, 0.428, -0.012], [0, 0.430, 0]] },
  { node: 'mixamorigLeftShoulder', times: [0, 0.08, 0.20, 0.46], values: [quat('z', 0.62), quat('z', 0.92), quat('z', 0.54), quat('z', 0.62)] },
  { node: 'mixamorigRightShoulder', times: [0, 0.08, 0.20, 0.46], values: [quat('z', -0.62), quat('z', -0.32), quat('z', -0.72), quat('z', -0.62)] },
  { node: 'mixamorigSpine1', times: [0, 0.08, 0.20, 0.46], values: [quat('z', 0), quat('z', 0.28), quat('z', -0.10), quat('z', 0)] },
  { node: 'mixamorigSpine2', times: [0, 0.08, 0.20, 0.46], values: [quat('x', 0), quat('x', -0.16), quat('x', 0.06), quat('x', 0)] },
  { node: 'mixamorigHead', times: [0, 0.08, 0.20, 0.46], values: [quat('z', 0), quat('z', 0.20), quat('z', -0.05), quat('z', 0)] },
  { node: 'mixamorigRightArm', times: [0, 0.08, 0.20, 0.46], values: [quat('x', 0), quat('x', 0.35), quat('x', -0.08), quat('x', 0)] },
  { node: 'mixamorigCapeRoot', times: [0, 0.08, 0.20, 0.46], values: [quat('x', 0), quat('x', 0.12), quat('x', -0.05), quat('x', 0)] },
  { node: 'mixamorigCapeMid', times: [0, 0.08, 0.20, 0.46], values: [quat('z', 0), quat('z', 0.04), quat('z', -0.02), quat('z', 0)] },
  { node: 'mixamorigCapeTip', times: [0, 0.08, 0.20, 0.46], values: [quat('x', 0), quat('x', 0.18), quat('x', -0.07), quat('x', 0)] },
]);
addClip('Death', 1.45, [
  { node: 'mixamorigHips', path: 'translation', times: [0, 0.22, 0.65, 1.05, 1.45], values: [[0, 0.430, 0], [0, 0.400, -0.015], [0, 0.315, -0.025], [0, 0.275, -0.025], [0, 0.275, -0.025]] },
  { node: 'mixamorigLeftShoulder', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('z', 0.62), quat('z', 0.78), quat('z', 0.95), quat('z', 0.90), quat('z', 0.90)] },
  { node: 'mixamorigRightShoulder', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('z', -0.62), quat('z', -0.48), quat('z', -0.28), quat('z', -0.25), quat('z', -0.25)] },
  { node: 'mixamorigHips', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('z', 0), quat('z', -0.08), quat('z', -0.26), quat('z', -0.34), quat('z', -0.34)] },
  { node: 'mixamorigSpine1', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('x', 0), quat('x', 0.14), quat('x', 0.28), quat('x', 0.34), quat('x', 0.34)] },
  { node: 'mixamorigSpine2', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('x', 0), quat('x', 0.12), quat('x', 0.22), quat('x', 0.24), quat('x', 0.24)] },
  { node: 'mixamorigHead', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('z', 0), quat('z', 0.12), quat('z', 0.28), quat('z', 0.35), quat('z', 0.35)] },
  { node: 'mixamorigLeftArm', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('x', 0), quat('x', 0.15), quat('x', 0.60), quat('x', 0.66), quat('x', 0.66)] },
  { node: 'mixamorigRightArm', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('x', 0), quat('x', -0.12), quat('x', -0.50), quat('x', -0.56), quat('x', -0.56)] },
  { node: 'mixamorigLeftUpLeg', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('x', 0), quat('x', -0.06), quat('x', -0.24), quat('x', -0.30), quat('x', -0.30)] },
  { node: 'mixamorigRightUpLeg', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('x', 0), quat('x', 0.06), quat('x', 0.25), quat('x', 0.31), quat('x', 0.31)] },
  { node: 'mixamorigCapeRoot', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('x', 0), quat('x', 0.24), quat('x', 0.42), quat('x', 0.46), quat('x', 0.46)] },
  { node: 'mixamorigCapeMid', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('z', 0), quat('z', -0.08), quat('z', -0.12), quat('z', -0.12), quat('z', -0.12)] },
  { node: 'mixamorigCapeTip', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('x', 0), quat('x', 0.28), quat('x', 0.52), quat('x', 0.58), quat('x', 0.58)] },
]);

const sourceTextureMetrics = [];
const runtimeTextureMetrics = [];
const material = root.listMaterials()[0];
const baseColorTexture = material?.getBaseColorTexture();
const metallicRoughnessTexture = material?.getMetallicRoughnessTexture();
const normalTexture = material?.getNormalTexture();
if (!baseColorTexture || !metallicRoughnessTexture || !normalTexture) throw new Error('Expected embedded base-color, packed PBR, and normal maps.');
for (const texture of root.listTextures()) {
  const bytes = texture.getImage();
  const metadata = await sharp(bytes).metadata();
  sourceTextureMetrics.push({ name: texture.getName(), width: metadata.width, height: metadata.height, mime: texture.getMimeType(), sha256: createHash('sha256').update(bytes).digest('hex') });
  if (metadata.width > 2048 || metadata.height > 2048) {
    const isDataTexture = texture === metallicRoughnessTexture;
    const encoded = await sharp(bytes).resize(2048, 2048, { fit: 'fill', kernel: isDataTexture ? 'linear' : 'lanczos3' })
      .toFormat(metadata.format === 'jpeg' ? 'jpeg' : 'png', metadata.format === 'jpeg' ? { quality: 92, chromaSubsampling: '4:4:4' } : {})
      .toBuffer();
    texture.setImage(encoded);
  }
  const runtimeMeta = await sharp(texture.getImage()).metadata();
  runtimeTextureMetrics.push({ name: texture.getName(), width: runtimeMeta.width, height: runtimeMeta.height, mime: texture.getMimeType(), bytes: texture.getImage().length });
  if (runtimeMeta.width > 2048 || runtimeMeta.height > 2048) throw new Error(`Runtime texture exceeds 2K: ${texture.getName()}`);
}
const baseColorMeta = await sharp(baseColorTexture.getImage()).metadata();
const baseColorPixels = await sharp(baseColorTexture.getImage()).removeAlpha().raw().toBuffer();
const pbrMeta = await sharp(metallicRoughnessTexture.getImage()).metadata();
const pbrPixels = await sharp(metallicRoughnessTexture.getImage()).removeAlpha().raw().toBuffer();
const materialRegions = {
  burgundyCloth: { count: 0, baseColor: [0, 0, 0], metallic: 0, roughness: 0 },
  plateAndTrim: { count: 0, baseColor: [0, 0, 0], metallic: 0, roughness: 0 },
};
const capeBoneStart = bones.findIndex((bone) => bone.group === 'cape');
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  let capeWeight = 0;
  for (let slot = 0; slot < 4; slot++) if (jointValues[vertex * 4 + slot] >= capeBoneStart) capeWeight += weightValues[vertex * 4 + slot];
  const u = Math.max(0, Math.min(0.999999, uvs[vertex * 2]));
  const v = Math.max(0, Math.min(0.999999, uvs[vertex * 2 + 1]));
  const colorIndex = (Math.floor((1 - v) * baseColorMeta.height) * baseColorMeta.width + Math.floor(u * baseColorMeta.width)) * 3;
  const pbrIndex = (Math.floor((1 - v) * pbrMeta.height) * pbrMeta.width + Math.floor(u * pbrMeta.width)) * 3;
  const color = [baseColorPixels[colorIndex], baseColorPixels[colorIndex + 1], baseColorPixels[colorIndex + 2]];
  const burgundy = color[0] > color[1] * 1.15 && color[0] > color[2] * 1.1;
  const region = capeWeight > 0.35 && burgundy ? materialRegions.burgundyCloth
    : capeWeight < 0.10 && positions[vertex * 3 + 1] > 0.25 && !burgundy ? materialRegions.plateAndTrim : null;
  if (!region) continue;
  region.count++;
  for (let channel = 0; channel < 3; channel++) region.baseColor[channel] += color[channel];
  region.roughness += pbrPixels[pbrIndex + 1] / 255;
  region.metallic += pbrPixels[pbrIndex + 2] / 255;
}
for (const region of Object.values(materialRegions)) if (region.count) {
  region.baseColor = region.baseColor.map((value) => value / region.count);
  region.roughness /= region.count;
  region.metallic /= region.count;
}
if (materialRegions.burgundyCloth.count < 20 || materialRegions.burgundyCloth.metallic > 0.20 || materialRegions.burgundyCloth.roughness < 0.70) {
  throw new Error(`Burgundy cape PBR sample is not cloth-like: ${JSON.stringify(materialRegions.burgundyCloth)}`);
}
if (materialRegions.plateAndTrim.count < 100 || materialRegions.plateAndTrim.metallic < 0.25) {
  throw new Error(`Plate PBR sample is not metal-like: ${JSON.stringify(materialRegions.plateAndTrim)}`);
}
const packedMap = await sharp(metallicRoughnessTexture.getImage()).removeAlpha().resize(128, 128).raw().toBuffer();
const pbrRange = [Infinity, -Infinity];
const roughnessRange = [Infinity, -Infinity];
for (let i = 2; i < packedMap.length; i += 3) {
  const metallic = packedMap[i] / 255;
  pbrRange[0] = Math.min(pbrRange[0], metallic);
  pbrRange[1] = Math.max(pbrRange[1], metallic);
  const roughness = packedMap[i - 1] / 255;
  roughnessRange[0] = Math.min(roughnessRange[0], roughness);
  roughnessRange[1] = Math.max(roughnessRange[1], roughness);
}
if (!(pbrRange[1] - pbrRange[0] > 0.05)) throw new Error(`Packed metallic channel is effectively flat: ${pbrRange}`);
if (!(roughnessRange[1] - roughnessRange[0] > 0.05)) throw new Error(`Packed roughness channel is effectively flat: ${roughnessRange}`);

const outputBytes = await io.writeBinary(doc);
await writeFile(candidatePath, outputBytes);
const candidateSha256 = createHash('sha256').update(outputBytes).digest('hex');
const checkDoc = await io.readBinary(outputBytes);
const checkRoot = checkDoc.getRoot();
const checkMesh = checkRoot.listMeshes()[0];
const checkPrimitive = checkMesh.listPrimitives()[0];
const checkPositions = checkPrimitive.getAttribute('POSITION')?.getArray();
const checkNormals = checkPrimitive.getAttribute('NORMAL')?.getArray();
const checkUvs = checkPrimitive.getAttribute('TEXCOORD_0')?.getArray();
const checkIndices = checkPrimitive.getIndices()?.getArray();
const checkJoints = checkPrimitive.getAttribute('JOINTS_0')?.getArray();
const checkWeights = checkPrimitive.getAttribute('WEIGHTS_0')?.getArray();
const checkSkin = checkMesh ? checkRoot.listSkins()[0] : undefined;
if (!checkPositions || !checkNormals || !checkUvs || !checkIndices || !checkJoints || !checkWeights || !checkSkin) throw new Error('Exported candidate is missing required source geometry or skin attributes.');
const checkInverseBinds = checkSkin.getInverseBindMatrices()?.getArray();
if (!checkInverseBinds || checkInverseBinds.length !== bones.length * 16 || checkInverseBinds.some((value) => !Number.isFinite(value))) {
  throw new Error('Exported candidate has missing or non-finite inverse-bind matrices.');
}
let maxPositionDelta = 0;
let maxNormalDelta = 0;
let maxUvDelta = 0;
let indexMismatches = 0;
let verticesWithDistributedWeights = 0;
for (let i = 0; i < checkPositions.length; i++) maxPositionDelta = Math.max(maxPositionDelta, Math.abs(checkPositions[i] - positions[i]));
for (let i = 0; i < checkNormals.length; i++) maxNormalDelta = Math.max(maxNormalDelta, Math.abs(checkNormals[i] - normals[i]));
for (let i = 0; i < checkUvs.length; i++) maxUvDelta = Math.max(maxUvDelta, Math.abs(checkUvs[i] - uvs[i]));
for (let i = 0; i < checkIndices.length; i++) if (checkIndices[i] !== indices[i]) indexMismatches++;
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  let sum = 0, nonzero = 0;
  for (let slot = 0; slot < 4; slot++) {
    const joint = checkJoints[vertex * 4 + slot], weight = checkWeights[vertex * 4 + slot];
    if (!Number.isInteger(joint) || joint < 0 || joint >= checkSkin.listJoints().length || !Number.isFinite(weight) || weight < 0) throw new Error(`Invalid skin weight at vertex ${vertex}.`);
    sum += weight;
    if (weight > 1e-6) nonzero++;
  }
  if (Math.abs(sum - 1) > 1e-5) throw new Error(`Vertex ${vertex} has non-normalized weights: ${sum}`);
  if (nonzero > 1) verticesWithDistributedWeights++;
}
if (maxPositionDelta !== 0 || maxNormalDelta !== 0 || maxUvDelta !== 0 || indexMismatches !== 0 || verticesWithDistributedWeights < positions.length / 3 * 0.75) {
  throw new Error(`Geometry/weights check failed: position delta ${maxPositionDelta}, normal delta ${maxNormalDelta}, UV delta ${maxUvDelta}, index mismatches ${indexMismatches}, distributed ${verticesWithDistributedWeights}.`);
}
const animationNames = checkRoot.listAnimations().map((animation) => animation.getName());
const requiredClips = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
if (requiredClips.some((name) => !animationNames.includes(name))) throw new Error('The candidate does not contain all six gameplay clips.');
for (const animation of checkRoot.listAnimations()) for (const channel of animation.listChannels()) {
  if (!checkSkin.listJoints().includes(channel.getTargetNode())) throw new Error(`${animation.getName()} targets a non-joint node.`);
}

const candidate = {
  schema: 'corealm-creature-native-rig-candidate/1',
  id: 'creature_skeleton_soldier',
  displayName: 'Black Keep Knight',
  status: 'awaiting-root-lab-review',
  accepted: false,
  source: {
    file: sourcePath,
    sha256: sourceSha256,
    bytes: sourceBytes.length,
    starredModelId: '8f2d7a21-7419-4337-ae73-570e04c16499',
    starredCardId: 'ee9e261b-ce0b-4393-8a95-f29e62aca233',
    starredDisplayName: 'dark fantasy armor 3d model',
    prompt: 'dark armored knight wearing black metal plate armor with silver trim, burgundy cape, spiked helmet, layered pauldrons, belt and ornate detailing',
    geometry: { vertices: positions.length / 3, triangles: indices.length / 3, bounds, positionsPreserved: maxPositionDelta === 0, normalsPreserved: maxNormalDelta === 0, uvsPreserved: maxUvDelta === 0, indicesPreserved: indexMismatches === 0, retopology: false, presentationScale },
    preliminaryDesignReview: 'Astra-low approved the full-body medieval black plate and burgundy cape design. The source skin has invalid inverse binds and the source has no clips; this candidate rebuilds the rig while retaining all 4,305 source triangles.',
    textures: sourceTextureMetrics,
    sourceSkin: { joints: 63, sourceJointTranslations: 'all identity transforms', sourceInverseBindMatrices: 'invalid extreme values', sourceWeights: 'Hips-dominant distribution; source rig unusable', rebuilt: true },
    sourceAnimations: [],
  },
  candidate: {
    file: candidatePath,
    sha256: candidateSha256,
    bytes: outputBytes.length,
    productionTarget: 'game/public/assets/models/creature/creature_skeleton_soldier.glb',
    geometry: { vertices: positions.length / 3, triangles: indices.length / 3, positionsPreserved: maxPositionDelta === 0, normalsPreserved: maxNormalDelta === 0, uvsPreserved: maxUvDelta === 0, indicesPreserved: indexMismatches === 0, presentationScale },
    rig: { type: 'Mixamo-named humanoid glTF skin with three accessory cape joints for Unity Humanoid mapping review', joints: bones.map((bone) => ({ name: bone.name, parent: bone.parent, position: bone.p })), finiteInverseBindMatrices: checkInverseBinds.length / 16, influencesPerVertex: 4, verticesWithDistributedWeights, verticesWithCapeWeight, capeMaxWeight, maximumWeightSumError, method: 'Model-specific four-weight skin from anatomical bone-segment distance fields, lateral gates and a rear cape-sheet gate; no fallback to one root joint.' },
    textures: runtimeTextureMetrics,
    packedPbrChannels: { metallicBlueRange: pbrRange, roughnessGreenRange: roughnessRange, sourceRedChannel: 'constant 255; retained as original image data' },
    materialRegions,
    materialResponse: 'Retains the image-generated ORM map and applies its blue metallic channel to plate surfaces and low metallic/high roughness values to the burgundy cloth. No flat recolor or synthetic PBR mask was applied.',
    animations: clips,
  },
  acceptance: { sourceDesignAudit: true, geometry: true, rig: false, animation: false, textures: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${baseDir}/catalog.json`, JSON.stringify(candidate, null, 2) + '\n');

const labAsset = {
  id: 'creature_skeleton_soldier',
  file: 'models/creature/creature_skeleton_soldier.glb',
  pack: 'corealm-starred-creatures',
  category: 'character',
  is: 'Black Keep Knight',
  tags: ['creature', 'humanoid', 'knight', 'wilderness', 'black-keep', 'T50', 'starred', 'tripo', 'candidate'],
  bytes: outputBytes.length,
  sha256: candidateSha256,
  size: { x: (bounds.max[0] - bounds.min[0]) * presentationScale, y: (bounds.max[1] - bounds.min[1]) * presentationScale, z: (bounds.max[2] - bounds.min[2]) * presentationScale },
  base: { x: bounds.min[0] * presentationScale, y: bounds.min[1] * presentationScale, z: bounds.min[2] * presentationScale },
  bounds: { min: bounds.min.map((value) => value * presentationScale), max: bounds.max.map((value) => value * presentationScale) },
  groundY: bounds.min[1] * presentationScale,
  triangles: indices.length / 3,
  animations: clips.map((clip) => clip.name),
  materials: root.listMaterials().map((entry) => entry.getName()),
  sourceProvenance: {
    author: 'Corealm candidate rig reconstruction',
    sourceModelId: '8f2d7a21-7419-4337-ae73-570e04c16499',
    sourceCardId: 'ee9e261b-ce0b-4393-8a95-f29e62aca233',
    prompt: 'dark armored knight wearing black metal plate armor with silver trim, burgundy cape, spiked helmet, layered pauldrons, belt and ornate detailing',
    sourceFile: sourcePath,
    sourceSha256,
    candidateFile: candidatePath,
    candidateSha256,
    rigMethod: 'Mixamo-named humanoid skeleton plus three cape joints; atlas color/PBR review places low-metallic, high-roughness burgundy cloth on the positive-Z back sheet. Original mesh positions, normals, indices, UVs and image-generated maps are retained.',
    textures: runtimeTextureMetrics,
    candidateStatus: 'awaiting-root-lab-review',
  },
  acceptance: { assetAudit: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${baseDir}/lab-catalog.json`, JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', files: { creature_skeleton_soldier: 'black-keep-knight-native-rig.glb' }, assets: [labAsset] }, null, 2) + '\n');
console.log(JSON.stringify({ candidatePath, bytes: outputBytes.length, candidateSha256, triangles: indices.length / 3, vertices: positions.length / 3, joints: bones.length, clips: clips.map(({ name, seconds }) => ({ name, seconds })), runtimeTextureMetrics, verticesWithDistributedWeights, verticesWithCapeWeight, maximumWeightSumError, maxPositionDelta, maxNormalDelta, maxUvDelta, indexMismatches }, null, 2));
