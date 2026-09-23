import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const ownerDir = 'assets/art/tripo/imports/creatures/starred-banshee';
const sourceFile = 'assets/art/tripo/exports/88a36c89-9ab9-4471-a3df-f8158b6bd0a8.glb';
const candidateFile = `${ownerDir}/banshee-native-rig-candidate.glb`;
const sourceShaExpected = '5df89799c3b9a27e0f151e2f93897de852a8cc780255ff9997d7c38a543495c7';
const sourceModelId = '956635da-08fc-4770-905e-5bee385bcaf9';
const sourceCardId = '88a36c89-9ab9-4471-a3df-f8158b6bd0a8';
const sourceImageId = '142a84c7-ce68-4a9a-be9e-d607c555beca';
const imageFile = 'assets/art/tripo/refs/crown-wild-banshee-v2.png';
const imageShaExpected = '938263bc97ceab41557c0e90f32a80dc699bb1ecbd941543570857feb2f5d402';

await mkdir(ownerDir, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourceFile);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
if (sourceSha256 !== sourceShaExpected) throw new Error(`Banshee source hash mismatch: ${sourceSha256}`);
const imageSha256 = createHash('sha256').update(await readFile(imageFile)).digest('hex');
if (imageSha256 !== imageShaExpected) throw new Error(`Approved Banshee image hash mismatch: ${imageSha256}`);

const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = mesh ? root.listNodes().find((node) => node.getMesh() === mesh) : undefined;
const sourceSkin = root.listSkins()[0];
if (!scene || !mesh || !primitive || !meshNode || !sourceSkin || root.listAnimations().length !== 0) {
  throw new Error('Expected the approved static, skinned Banshee GLB with no motion clips.');
}

const positions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
const indices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
const normals = Float32Array.from(primitive.getAttribute('NORMAL')?.getArray() ?? []);
const uvs = Float32Array.from(primitive.getAttribute('TEXCOORD_0')?.getArray() ?? []);
if (positions.length / 3 !== 3161 || indices.length / 3 !== 4474) {
  throw new Error(`Approved geometry changed: ${positions.length / 3} vertices, ${indices.length / 3} triangles.`);
}
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
  bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
}

// Tripo left 99.97% of Banshee vertices on BoneRoot and its joint bind matrices are invalid.
// Discard that unusable 54-joint skeleton, then rebuild weights against the approved floating silhouette.
const sourceJointIndices = primitive.getAttribute('JOINTS_0')?.getArray();
const sourceJointWeights = primitive.getAttribute('WEIGHTS_0')?.getArray();
if (!sourceJointIndices || !sourceJointWeights) throw new Error('Expected the exported source skin attributes.');
let sourceRootWeightedVertices = 0;
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  let rootWeight = 0;
  for (let slot = 0; slot < 4; slot++) {
    if (sourceJointIndices[vertex * 4 + slot] === 0) rootWeight += sourceJointWeights[vertex * 4 + slot];
  }
  if (rootWeight > 0.999) sourceRootWeightedVertices++;
}
if (sourceSkin.listJoints().length !== 54 || sourceRootWeightedVertices < positions.length / 3 * 0.99) {
  throw new Error(`Source rig drifted: ${sourceSkin.listJoints().length} joints, ${sourceRootWeightedVertices} root-weighted vertices.`);
}

const armature = meshNode.getParentNode();
if (!armature) throw new Error('Banshee mesh has no armature parent.');
meshNode.setSkin(null);
sourceSkin.dispose();
primitive.setAttribute('JOINTS_0', null);
primitive.setAttribute('WEIGHTS_0', null);
for (const child of [...armature.listChildren()]) {
  if (child === meshNode) continue;
  const drop = (node) => {
    for (const nested of [...node.listChildren()]) drop(nested);
    node.getParentNode()?.removeChild(node);
    node.dispose();
  };
  child.getParentNode()?.removeChild(child);
  drop(child);
}
armature.setName('BansheeArmature').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
meshNode.setName('BansheeMesh').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);

// Y is up, +Z faces forward, and +X is the character's left. The pose-specific arm anchors
// follow the approved three-quarter source; the lower branches control its open mist gown.
const bones = [
  { name: 'BansheeRoot', parent: null, p: [0, 0, 0], group: 'root', sigma: 1 },
  { name: 'mixamorigHips', parent: 'BansheeRoot', p: [-0.055, 0.470, 0.010], group: 'core', sigma: 0.145 },
  { name: 'mixamorigSpine', parent: 'mixamorigHips', p: [-0.055, 0.565, 0.010], group: 'core', sigma: 0.135 },
  { name: 'mixamorigSpine1', parent: 'mixamorigSpine', p: [-0.060, 0.660, 0.025], group: 'core', sigma: 0.125 },
  { name: 'mixamorigSpine2', parent: 'mixamorigSpine1', p: [-0.060, 0.750, 0.035], group: 'core', sigma: 0.115 },
  { name: 'mixamorigNeck', parent: 'mixamorigSpine2', p: [-0.068, 0.835, 0.030], group: 'core', sigma: 0.105 },
  { name: 'mixamorigHead', parent: 'mixamorigNeck', p: [-0.068, 0.920, 0.020], group: 'head', sigma: 0.105 },

  { name: 'mixamorigLeftShoulder', parent: 'mixamorigSpine2', p: [0.018, 0.735, 0.035], group: 'leftArm', side: 1, sigma: 0.070 },
  { name: 'mixamorigLeftArm', parent: 'mixamorigLeftShoulder', p: [0.082, 0.650, 0.055], group: 'leftArm', side: 1, sigma: 0.070 },
  { name: 'mixamorigLeftForeArm', parent: 'mixamorigLeftArm', p: [0.150, 0.530, 0.080], group: 'leftArm', side: 1, sigma: 0.062 },
  { name: 'mixamorigLeftHand', parent: 'mixamorigLeftForeArm', p: [0.190, 0.425, 0.100], group: 'leftArm', side: 1, sigma: 0.060 },
  { name: 'mixamorigRightShoulder', parent: 'mixamorigSpine2', p: [-0.148, 0.725, 0.035], group: 'rightArm', side: -1, sigma: 0.070 },
  { name: 'mixamorigRightArm', parent: 'mixamorigRightShoulder', p: [-0.222, 0.640, 0.052], group: 'rightArm', side: -1, sigma: 0.070 },
  { name: 'mixamorigRightForeArm', parent: 'mixamorigRightArm', p: [-0.290, 0.510, 0.060], group: 'rightArm', side: -1, sigma: 0.062 },
  { name: 'mixamorigRightHand', parent: 'mixamorigRightForeArm', p: [-0.322, 0.405, 0.075], group: 'rightArm', side: -1, sigma: 0.060 },

  // These Unity Humanoid-mappable bones remain inside the gown and intentionally carry no skin weights.
  { name: 'mixamorigLeftUpLeg', parent: 'mixamorigHips', p: [0.005, 0.425, 0.010], group: 'hiddenLeg', side: 1, sigma: 0.065 },
  { name: 'mixamorigLeftLeg', parent: 'mixamorigLeftUpLeg', p: [0.010, 0.300, 0.010], group: 'hiddenLeg', side: 1, sigma: 0.055 },
  { name: 'mixamorigLeftFoot', parent: 'mixamorigLeftLeg', p: [0.015, 0.180, 0.020], group: 'hiddenLeg', side: 1, sigma: 0.045 },
  { name: 'mixamorigLeftToeBase', parent: 'mixamorigLeftFoot', p: [0.015, 0.115, 0.065], group: 'hiddenLeg', side: 1, sigma: 0.040 },
  { name: 'mixamorigRightUpLeg', parent: 'mixamorigHips', p: [-0.125, 0.425, 0.005], group: 'hiddenLeg', side: -1, sigma: 0.065 },
  { name: 'mixamorigRightLeg', parent: 'mixamorigRightUpLeg', p: [-0.135, 0.300, 0.005], group: 'hiddenLeg', side: -1, sigma: 0.055 },
  { name: 'mixamorigRightFoot', parent: 'mixamorigRightLeg', p: [-0.145, 0.180, 0.015], group: 'hiddenLeg', side: -1, sigma: 0.045 },
  { name: 'mixamorigRightToeBase', parent: 'mixamorigRightFoot', p: [-0.145, 0.115, 0.060], group: 'hiddenLeg', side: -1, sigma: 0.040 },

  { name: 'BansheeShroudRoot', parent: 'mixamorigHips', p: [-0.055, 0.420, 0.005], group: 'shroudCore', sigma: 0.105 },
  { name: 'BansheeShroudMid', parent: 'BansheeShroudRoot', p: [-0.045, 0.275, 0.005], group: 'shroudCore', sigma: 0.120 },
  { name: 'BansheeShroudHem', parent: 'BansheeShroudMid', p: [-0.025, 0.145, 0.005], group: 'shroudCore', sigma: 0.120 },
  { name: 'BansheeMistRibbonL', parent: 'BansheeShroudMid', p: [-0.225, 0.175, 0.020], group: 'shroudLeft', side: -1, sigma: 0.135 },
  { name: 'BansheeMistTipL', parent: 'BansheeMistRibbonL', p: [-0.330, 0.135, 0.050], group: 'shroudLeft', side: -1, sigma: 0.095 },
  { name: 'BansheeMistRibbonR', parent: 'BansheeShroudMid', p: [0.190, 0.150, 0.055], group: 'shroudRight', side: 1, sigma: 0.135 },
  { name: 'BansheeMistTipR', parent: 'BansheeMistRibbonR', p: [0.315, 0.060, 0.070], group: 'shroudRight', side: 1, sigma: 0.090 },
];

const byName = new Map(bones.map((bone, index) => [bone.name, { ...bone, index }]));
for (const bone of bones) {
  const parent = bone.parent ? byName.get(bone.parent) : null;
  bone.local = parent ? bone.p.map((value, axis) => value - parent.p[axis]) : bone.p;
}

const jointNodes = new Map();
for (const bone of bones) {
  const node = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  jointNodes.set(bone.name, node);
  const parent = bone.parent ? jointNodes.get(bone.parent) : armature;
  parent.addChild(node);
}
const skin = doc.createSkin('Banshee_UnityHumanoidAndMist').setSkeleton(jointNodes.get('BansheeRoot'));
for (const bone of bones) skin.addJoint(jointNodes.get(bone.name));
const inverseBinds = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i++) {
  const [x, y, z] = bones[i].p;
  inverseBinds.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
}
const buffer = root.listBuffers()[0];
skin.setInverseBindMatrices(doc.createAccessor('Banshee_InverseBindMatrices').setArray(inverseBinds).setType(Accessor.Type.MAT4).setBuffer(buffer));
meshNode.setSkin(skin);

function distanceToSegment(point, start, end) {
  const line = end.map((value, axis) => value - start[axis]);
  const length2 = line.reduce((sum, value) => sum + value * value, 0) || 1;
  const t = Math.max(0, Math.min(1, point.reduce((sum, value, axis) => sum + (value - start[axis]) * line[axis], 0) / length2));
  return Math.hypot(...point.map((value, axis) => value - (start[axis] + t * line[axis])));
}
const sigmoid = (value) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
function regionGate(bone, point) {
  const [x, y] = point;
  const centerX = -0.055;
  const centerGate = sigmoid((0.255 - Math.abs(x - centerX)) / 0.032);
  if (bone.group === 'root' || bone.group === 'hiddenLeg') return 0;
  if (bone.group === 'core') {
    const upperBody = sigmoid((y - 0.355) / 0.036);
    if (bone.name === 'mixamorigHead') return sigmoid((y - 0.775) / 0.045);
    return upperBody * centerGate;
  }
  if (bone.group === 'leftArm' || bone.group === 'rightArm') {
    const inLimbBand = sigmoid((y - 0.335) / 0.040) * sigmoid((0.825 - y) / 0.045);
    const lateral = bone.side * (x - centerX);
    return inLimbBand * sigmoid((lateral - 0.065) / 0.032);
  }
  if (bone.group === 'shroudCore') {
    return sigmoid((0.565 - y) / 0.035) * centerGate;
  }
  if (bone.group === 'shroudLeft' || bone.group === 'shroudRight') {
    const belowWaist = sigmoid((0.475 - y) / 0.040);
    const lateral = bone.side * (x - centerX);
    return belowWaist * sigmoid((lateral - 0.035) / 0.055);
  }
  return 0;
}

const jointIndices = new Uint16Array(positions.length / 3 * 4);
const jointWeights = new Float32Array(positions.length / 3 * 4);
const influenceCounts = new Uint32Array(bones.length);
let maximumWeightSumError = 0;
let verticesWithDistributedWeights = 0;
let verticesWithMistInfluence = 0;
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const candidates = [];
  for (let index = 1; index < bones.length; index++) {
    const bone = bones[index];
    const gate = regionGate(bone, point);
    if (gate < 0.001) continue;
    const parent = bone.parent ? byName.get(bone.parent) : null;
    const distance = distanceToSegment(point, parent?.p ?? bone.p, bone.p);
    const score = gate * Math.exp(-0.5 * (distance / bone.sigma) ** 2);
    if (score > 1e-9) candidates.push({ index, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  let chosen = candidates.slice(0, 4);
  if (!chosen.length) chosen = [{ index: 1, score: 1 }]; // torso/hips fallback, never BoneRoot.
  const total = chosen.reduce((sum, item) => sum + item.score, 0);
  let assigned = 0;
  let hasMistInfluence = false;
  for (let slot = 0; slot < 4; slot++) {
    const item = chosen[slot] ?? chosen[0];
    const weight = slot >= chosen.length ? 0 : slot === chosen.length - 1 ? 1 - assigned : item.score / total;
    jointIndices[vertex * 4 + slot] = item.index;
    jointWeights[vertex * 4 + slot] = weight;
    assigned += weight;
    if (weight > 1e-6) influenceCounts[item.index]++;
    const group = bones[item.index].group;
    if (weight > 1e-6 && (group === 'shroudCore' || group === 'shroudLeft' || group === 'shroudRight')) hasMistInfluence = true;
  }
  const sum = jointWeights[vertex * 4] + jointWeights[vertex * 4 + 1] + jointWeights[vertex * 4 + 2] + jointWeights[vertex * 4 + 3];
  maximumWeightSumError = Math.max(maximumWeightSumError, Math.abs(sum - 1));
  if (chosen.filter((item) => item.score / total > 0.01).length > 1) verticesWithDistributedWeights++;
  if (hasMistInfluence) verticesWithMistInfluence++;
}
primitive.setAttribute('JOINTS_0', doc.createAccessor('Banshee_Joints0').setArray(jointIndices).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('Banshee_Weights0').setArray(jointWeights).setType(Accessor.Type.VEC4).setBuffer(buffer));

const q = (axis, angle) => {
  const sine = Math.sin(angle / 2), cosine = Math.cos(angle / 2);
  if (axis === 'x') return [sine, 0, 0, cosine];
  if (axis === 'y') return [0, sine, 0, cosine];
  return [0, 0, sine, cosine];
};
const clips = [];
function addClip(name, seconds, tracks) {
  const animation = doc.createAnimation(name);
  for (const track of tracks) {
    const times = Float32Array.from(track.times);
    const values = Float32Array.from(track.values.flat());
    const input = doc.createAccessor(`${name}_${track.node}_time`).setArray(times).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const output = doc.createAccessor(`${name}_${track.node}_${track.path ?? 'rotation'}_value`)
      .setArray(values).setType(track.path === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4).setBuffer(buffer);
    const sampler = doc.createAnimationSampler(`${name}_${track.node}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${name}_${track.node}`).setTargetNode(jointNodes.get(track.node)).setTargetPath(track.path ?? 'rotation').setSampler(sampler));
  }
  clips.push({ name, seconds, channels: tracks.length });
}

const cycle = [0, 0.25, 0.5, 0.75, 1];
const cyclet = (duration) => cycle.map((value) => value * duration);
const rootDrift = (duration, amplitude, sign = 1) => cyclet(duration).map((_, index) => [0, 0, [0, 0.65, 0, -0.20, 0][index] * amplitude * sign]);
addClip('Idle', 3.0, [
  { node: 'mixamorigHips', path: 'translation', times: [0, 0.75, 1.5, 2.25, 3], values: [[-0.055, 0.470, 0.010], [-0.055, 0.493, 0.010], [-0.055, 0.470, 0.010], [-0.055, 0.486, 0.010], [-0.055, 0.470, 0.010]] },
  { node: 'mixamorigSpine1', times: [0, 0.75, 1.5, 2.25, 3], values: [q('z', 0), q('z', -0.012), q('z', 0), q('z', 0.014), q('z', 0)] },
  { node: 'mixamorigHead', times: [0, 0.75, 1.5, 2.25, 3], values: [q('y', -0.012), q('y', 0.012), q('y', 0.025), q('y', 0.005), q('y', -0.012)] },
  { node: 'mixamorigLeftArm', times: [0, 0.75, 1.5, 2.25, 3], values: [q('z', 0), q('z', -0.020), q('z', 0), q('z', 0.020), q('z', 0)] },
  { node: 'mixamorigRightArm', times: [0, 0.75, 1.5, 2.25, 3], values: [q('z', 0), q('z', 0.018), q('z', 0), q('z', -0.018), q('z', 0)] },
  { node: 'BansheeShroudMid', times: [0, 0.75, 1.5, 2.25, 3], values: [q('x', 0), q('x', 0.028), q('x', 0), q('x', -0.026), q('x', 0)] },
  { node: 'BansheeMistTipL', times: [0, 0.75, 1.5, 2.25, 3], values: [q('y', -0.025), q('y', 0.024), q('y', -0.020), q('y', 0.022), q('y', -0.025)] },
  { node: 'BansheeMistTipR', times: [0, 0.75, 1.5, 2.25, 3], values: [q('y', 0.024), q('y', -0.020), q('y', 0.025), q('y', -0.022), q('y', 0.024)] },
]);
addClip('Walk', 1.15, [
  { node: 'BansheeRoot', path: 'translation', times: cyclet(1.15), values: rootDrift(1.15, 0.035) },
  { node: 'mixamorigHips', path: 'translation', times: cyclet(1.15), values: cyclet(1.15).map((_, index) => [-0.055, 0.470 + [0, 0.022, 0, 0.022, 0][index], 0.010]) },
  { node: 'mixamorigSpine1', times: cyclet(1.15), values: [0, 0.25, 0.5, 0.75, 1].map((phase) => q('z', Math.sin(phase * Math.PI * 2) * 0.025)) },
  { node: 'mixamorigSpine2', times: cyclet(1.15), values: [q('x', 0.035), q('x', 0.045), q('x', 0.035), q('x', 0.025), q('x', 0.035)] },
  { node: 'mixamorigLeftArm', times: cyclet(1.15), values: [q('x', -0.05), q('x', -0.12), q('x', -0.05), q('x', 0.02), q('x', -0.05)] },
  { node: 'mixamorigRightArm', times: cyclet(1.15), values: [q('x', 0.03), q('x', -0.02), q('x', 0.03), q('x', 0.08), q('x', 0.03)] },
  { node: 'BansheeShroudMid', times: cyclet(1.15), values: [q('x', 0.03), q('x', 0.09), q('x', 0.02), q('x', -0.04), q('x', 0.03)] },
  { node: 'BansheeMistTipL', times: cyclet(1.15), values: [q('y', 0.02), q('y', 0.08), q('y', -0.01), q('y', -0.07), q('y', 0.02)] },
  { node: 'BansheeMistTipR', times: cyclet(1.15), values: [q('y', -0.01), q('y', -0.07), q('y', 0.02), q('y', 0.08), q('y', -0.01)] },
]);
addClip('Run', 0.78, [
  { node: 'BansheeRoot', path: 'translation', times: cyclet(0.78), values: rootDrift(0.78, 0.072) },
  { node: 'mixamorigHips', path: 'translation', times: cyclet(0.78), values: cyclet(0.78).map((_, index) => [-0.055, 0.470 + [0, 0.033, 0, 0.026, 0][index], 0.010]) },
  { node: 'mixamorigSpine1', times: cyclet(0.78), values: [q('x', 0.06), q('x', 0.11), q('x', 0.06), q('x', 0.015), q('x', 0.06)] },
  { node: 'mixamorigSpine2', times: cyclet(0.78), values: [q('z', 0), q('z', -0.045), q('z', 0), q('z', 0.045), q('z', 0)] },
  { node: 'mixamorigLeftArm', times: cyclet(0.78), values: [q('x', -0.10), q('x', -0.25), q('x', -0.10), q('x', 0.05), q('x', -0.10)] },
  { node: 'mixamorigRightArm', times: cyclet(0.78), values: [q('x', -0.10), q('x', 0.05), q('x', -0.10), q('x', -0.25), q('x', -0.10)] },
  { node: 'BansheeShroudMid', times: cyclet(0.78), values: [q('x', 0.06), q('x', 0.24), q('x', 0.06), q('x', -0.13), q('x', 0.06)] },
  { node: 'BansheeMistTipL', times: cyclet(0.78), values: [q('z', 0.04), q('z', 0.12), q('z', -0.04), q('z', -0.12), q('z', 0.04)] },
  { node: 'BansheeMistTipR', times: cyclet(0.78), values: [q('z', -0.04), q('z', -0.12), q('z', 0.04), q('z', 0.12), q('z', -0.04)] },
]);
addClip('Attack', 0.96, [
  { node: 'BansheeRoot', path: 'translation', times: [0, 0.18, 0.48, 0.72, 0.96], values: [[0, 0, 0], [0, 0.005, -0.025], [0, 0.015, 0.060], [0, 0.005, 0.020], [0, 0, 0]] },
  { node: 'mixamorigSpine1', times: [0, 0.18, 0.48, 0.72, 0.96], values: [q('x', 0), q('x', 0.08), q('x', 0.22), q('x', 0.12), q('x', 0)] },
  { node: 'mixamorigHead', times: [0, 0.18, 0.48, 0.72, 0.96], values: [q('x', 0), q('x', -0.08), q('x', -0.16), q('x', -0.08), q('x', 0)] },
  { node: 'mixamorigLeftArm', times: [0, 0.18, 0.48, 0.72, 0.96], values: [q('x', 0), q('x', -0.38), q('x', -0.72), q('x', -0.36), q('x', 0)] },
  { node: 'mixamorigLeftForeArm', times: [0, 0.18, 0.48, 0.72, 0.96], values: [q('x', 0), q('x', -0.16), q('x', -0.35), q('x', -0.12), q('x', 0)] },
  { node: 'mixamorigRightArm', times: [0, 0.18, 0.48, 0.72, 0.96], values: [q('x', 0), q('x', -0.32), q('x', -0.66), q('x', -0.30), q('x', 0)] },
  { node: 'mixamorigRightForeArm', times: [0, 0.18, 0.48, 0.72, 0.96], values: [q('x', 0), q('x', -0.14), q('x', -0.32), q('x', -0.10), q('x', 0)] },
  { node: 'BansheeShroudMid', times: [0, 0.18, 0.48, 0.72, 0.96], values: [q('x', 0), q('x', 0.18), q('x', 0.48), q('x', 0.26), q('x', 0)] },
  { node: 'BansheeMistTipL', times: [0, 0.18, 0.48, 0.72, 0.96], values: [q('z', 0), q('z', 0.08), q('z', -0.18), q('z', -0.08), q('z', 0)] },
  { node: 'BansheeMistTipR', times: [0, 0.18, 0.48, 0.72, 0.96], values: [q('z', 0), q('z', -0.08), q('z', 0.18), q('z', 0.08), q('z', 0)] },
]);
addClip('Hit', 0.48, [
  { node: 'BansheeRoot', path: 'translation', times: [0, 0.08, 0.22, 0.48], values: [[0, 0, 0], [0, -0.018, -0.045], [0, 0.008, -0.020], [0, 0, 0]] },
  { node: 'mixamorigSpine1', times: [0, 0.08, 0.22, 0.48], values: [q('z', 0), q('z', -0.15), q('z', 0.06), q('z', 0)] },
  { node: 'mixamorigSpine2', times: [0, 0.08, 0.22, 0.48], values: [q('x', 0), q('x', -0.11), q('x', 0.04), q('x', 0)] },
  { node: 'mixamorigHead', times: [0, 0.08, 0.22, 0.48], values: [q('z', 0), q('z', 0.12), q('z', -0.04), q('z', 0)] },
  { node: 'mixamorigLeftArm', times: [0, 0.08, 0.22, 0.48], values: [q('x', 0), q('x', -0.24), q('x', -0.05), q('x', 0)] },
  { node: 'mixamorigRightArm', times: [0, 0.08, 0.22, 0.48], values: [q('x', 0), q('x', 0.20), q('x', -0.03), q('x', 0)] },
  { node: 'BansheeShroudMid', times: [0, 0.08, 0.22, 0.48], values: [q('x', 0), q('x', -0.18), q('x', 0.06), q('x', 0)] },
]);
addClip('Death', 1.5, [
  { node: 'BansheeRoot', path: 'translation', times: [0, 0.25, 0.65, 1.05, 1.5], values: [[0, 0, 0], [0, 0.045, 0], [0, 0.065, -0.025], [0, -0.005, -0.045], [0, -0.075, -0.055]] },
  { node: 'mixamorigHips', times: [0, 0.25, 0.65, 1.05, 1.5], values: [q('z', 0), q('z', -0.06), q('z', -0.16), q('z', -0.28), q('z', -0.28)] },
  { node: 'mixamorigSpine1', times: [0, 0.25, 0.65, 1.05, 1.5], values: [q('x', 0), q('x', -0.04), q('x', -0.12), q('x', -0.20), q('x', -0.20)] },
  { node: 'mixamorigHead', times: [0, 0.25, 0.65, 1.05, 1.5], values: [q('z', 0), q('z', 0.08), q('z', 0.20), q('z', 0.34), q('z', 0.34)] },
  { node: 'mixamorigLeftArm', times: [0, 0.25, 0.65, 1.05, 1.5], values: [q('x', 0), q('x', -0.05), q('x', -0.28), q('x', -0.42), q('x', -0.42)] },
  { node: 'mixamorigRightArm', times: [0, 0.25, 0.65, 1.05, 1.5], values: [q('x', 0), q('x', -0.06), q('x', -0.26), q('x', -0.40), q('x', -0.40)] },
  { node: 'BansheeShroudMid', times: [0, 0.25, 0.65, 1.05, 1.5], values: [q('x', 0), q('x', 0.05), q('x', 0.18), q('x', 0.30), q('x', 0.30)] },
  { node: 'BansheeMistTipL', times: [0, 0.25, 0.65, 1.05, 1.5], values: [q('z', 0), q('z', 0.10), q('z', 0.26), q('z', 0.40), q('z', 0.40)] },
  { node: 'BansheeMistTipR', times: [0, 0.25, 0.65, 1.05, 1.5], values: [q('z', 0), q('z', -0.10), q('z', -0.24), q('z', -0.38), q('z', -0.38)] },
]);

const originalTextures = [];
const runtimeTextures = [];
const material = root.listMaterials()[0];
const baseColorTexture = material?.getBaseColorTexture();
const packedPbrTexture = material?.getMetallicRoughnessTexture();
const normalTexture = material?.getNormalTexture();
if (!baseColorTexture || !packedPbrTexture || !normalTexture) throw new Error('Banshee must retain base-color, packed PBR, and normal maps.');
for (const texture of root.listTextures()) {
  const original = texture.getImage();
  const sourceMeta = await sharp(original).metadata();
  originalTextures.push({ name: texture.getName(), width: sourceMeta.width, height: sourceMeta.height, mimeType: texture.getMimeType(), bytes: original.length, sha256: createHash('sha256').update(original).digest('hex') });
  if (sourceMeta.width > 2048 || sourceMeta.height > 2048) {
    let encoded;
    if (texture === normalTexture) {
      const raw = await sharp(original).resize(2048, 2048, { fit: 'fill', kernel: 'linear' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let i = 0; i < raw.data.length; i += raw.info.channels) {
        const nx = raw.data[i] / 127.5 - 1;
        const ny = raw.data[i + 1] / 127.5 - 1;
        const nz = raw.data[i + 2] / 127.5 - 1;
        const magnitude = Math.hypot(nx, ny, nz) || 1;
        raw.data[i] = Math.round((nx / magnitude + 1) * 127.5);
        raw.data[i + 1] = Math.round((ny / magnitude + 1) * 127.5);
        raw.data[i + 2] = Math.round((nz / magnitude + 1) * 127.5);
      }
      encoded = await sharp(raw.data, { raw: raw.info }).jpeg({ quality: 96, chromaSubsampling: '4:4:4' }).toBuffer();
    } else if (texture === packedPbrTexture) {
      encoded = await sharp(original).resize(2048, 2048, { fit: 'fill', kernel: 'linear' }).png({ compressionLevel: 9 }).toBuffer();
    } else {
      encoded = await sharp(original).resize(2048, 2048, { fit: 'fill', kernel: 'lanczos3' }).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
    }
    texture.setImage(encoded);
  }
  const resultMeta = await sharp(texture.getImage()).metadata();
  if (resultMeta.width !== 2048 || resultMeta.height !== 2048) throw new Error(`Runtime texture is not 2K: ${texture.getName()} ${resultMeta.width}x${resultMeta.height}`);
  runtimeTextures.push({ name: texture.getName(), width: resultMeta.width, height: resultMeta.height, mimeType: texture.getMimeType(), bytes: texture.getImage().length, sha256: createHash('sha256').update(texture.getImage()).digest('hex') });
}
const metallic = await sharp(packedPbrTexture.getImage()).resize(128, 128).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const metallicValues = [];
for (let i = 2; i < metallic.data.length; i += metallic.info.channels) metallicValues.push(metallic.data[i] / 255);
const metallicRange = [Math.min(...metallicValues), Math.max(...metallicValues)];
if (metallicRange[1] - metallicRange[0] < 0.05) throw new Error(`PBR metallic channel is flat: ${metallicRange}`);

const outputBytes = await io.writeBinary(doc);
await writeFile(candidateFile, outputBytes);
const candidateSha256 = createHash('sha256').update(outputBytes).digest('hex');
const checkDoc = await io.readBinary(outputBytes);
const checkRoot = checkDoc.getRoot();
const checkPrimitive = checkRoot.listMeshes()[0].listPrimitives()[0];
const checkPositions = checkPrimitive.getAttribute('POSITION')?.getArray();
const checkIndices = checkPrimitive.getIndices()?.getArray();
const checkUvs = checkPrimitive.getAttribute('TEXCOORD_0')?.getArray();
const checkNormals = checkPrimitive.getAttribute('NORMAL')?.getArray();
const checkJoints = checkPrimitive.getAttribute('JOINTS_0')?.getArray();
const checkWeights = checkPrimitive.getAttribute('WEIGHTS_0')?.getArray();
const checkSkin = checkRoot.listSkins()[0];
if (!checkPositions || !checkIndices || !checkUvs || !checkNormals || !checkJoints || !checkWeights || !checkSkin) throw new Error('Candidate skin or source geometry attributes are missing.');
const mismatch = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
const positionsChanged = mismatch(checkPositions, positions);
const indicesChanged = mismatch(checkIndices, indices);
const uvsChanged = mismatch(checkUvs, uvs);
const normalsChanged = mismatch(checkNormals, normals);
let maxWeightSumError = 0;
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  let sum = 0;
  for (let slot = 0; slot < 4; slot++) {
    const joint = checkJoints[vertex * 4 + slot], weight = checkWeights[vertex * 4 + slot];
    if (!Number.isInteger(joint) || joint < 0 || joint >= checkSkin.listJoints().length || !Number.isFinite(weight) || weight < 0) throw new Error(`Invalid Banshee influence at vertex ${vertex}.`);
    sum += weight;
  }
  maxWeightSumError = Math.max(maxWeightSumError, Math.abs(sum - 1));
  if (Math.abs(sum - 1) > 1e-5) throw new Error(`Banshee weights are not normalized at vertex ${vertex}: ${sum}`);
}
if (positionsChanged || indicesChanged || uvsChanged || normalsChanged) throw new Error(`Source mesh changed: ${JSON.stringify({ positionsChanged, indicesChanged, uvsChanged, normalsChanged })}`);
const names = checkRoot.listAnimations().map((animation) => animation.getName());
const required = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
if (required.some((name) => !names.includes(name))) throw new Error(`Banshee motion clips missing: ${names}`);
for (const animation of checkRoot.listAnimations()) for (const channel of animation.listChannels()) {
  if (!checkSkin.listJoints().includes(channel.getTargetNode())) throw new Error(`${animation.getName()} targets a non-rig node.`);
}
if (influenceCounts[1] < positions.length / 3 * 0.03 || verticesWithMistInfluence < positions.length / 3 * 0.12) {
  throw new Error(`Banshee rig lacks useful body/mist skinning: hips=${influenceCounts[1]}, mist=${verticesWithMistInfluence}.`);
}

const candidate = {
  schema: 'corealm-creature-native-rig-candidate/1',
  id: 'creature_banshee',
  displayName: 'Banshee',
  status: 'awaiting-root-lab-review',
  accepted: false,
  source: {
    file: sourceFile,
    sha256: sourceSha256,
    bytes: sourceBytes.length,
    starredModelId: sourceModelId,
    starredCardId: sourceCardId,
    starredDisplayName: 'fantasy female character 3d model',
    sourceImageId,
    sourceImageFile: imageFile,
    sourceImageSha256: imageSha256,
    prompt: 'Banshee, a floating wilderness mourning ghost for a serious medieval RPG. Full adult female upper body with balanced anatomy, stern long face with closed eyes and gray lavender skin, mouth slightly open in a solemn breath. Dense dark hair forms two broad swept-back locks joined into a short heavy braid. Faded midnight-blue burial gown with a woven silver hem. The empty lower gown opens into three broad curling ribbons of pale blue mist that taper in open air, unmistakably hovering above the ground, no legs or feet beneath. Proportionate arms separated from torso, wrapped forearms and relaxed visible hands. Restrained lavender light at throat, quiet mournful menace, no exposed bones, no gore, no shredded rag cloud.',
    generator: 'Tripo P2.0 Smart Mesh',
    sourceImageAudit: { reviewer: 'wild_audit (gpt-6-astra low)', verdict: 'approved', reasons: ['Unmistakably floating female ghost', 'Dress dissolves into translucent tails without corpse or gore'] },
    geometryAudit: { reviewer: 'Astra-low', verdict: 'approved', review: 'Close front/rear review confirms intact human face, floating smoky skirt and no anatomy defects.' },
    geometry: { vertices: positions.length / 3, triangles: indices.length / 3, bounds, positionsPreserved: positionsChanged === 0, indicesPreserved: indicesChanged === 0, retopology: false },
    sourceSkin: { joints: 54, rootWeightedVertices: sourceRootWeightedVertices, status: 'discarded; 99.97% of source vertices use the root joint and inverse bind matrices are corrupt' },
    sourceAnimations: [],
    textures: originalTextures,
  },
  candidate: {
    file: candidateFile,
    sha256: candidateSha256,
    bytes: outputBytes.length,
    productionTarget: 'game/public/assets/models/creature/creature_banshee.glb',
    geometry: { vertices: positions.length / 3, triangles: indices.length / 3, positionsPreserved: true, indicesPreserved: true, uvPreserved: true, normalsPreserved: true },
    rig: { type: 'Mixamo-named Unity Humanoid plus spectral shroud joints', jointCount: bones.length, joints: bones.map(({ name, parent, p, group }) => ({ name, parent, restPosition: p, role: group })), influencesPerVertex: 4, verticesWithDistributedWeights, maximumWeightSumError: maxWeightSumError, verticesWithMistInfluence, method: 'Model-specific region-gated four-influence weights; legs remain mapped inside the hollow gown and unweighted; lower mist ribbons use independent shroud joints.' },
    textures: runtimeTextures,
    pbr: { baseColor: true, packedMetallicRoughness: true, normal: true, metallicChannelRange: metallicRange, allMapsMaximum: 2048 },
    animations: clips,
    locomotion: 'Walk and Run are floating hover-glide cycles with no foot contact or gait animation.',
  },
  acceptance: { imageAudit: true, geometry: true, rig: false, animations: false, textures: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${ownerDir}/catalog.json`, JSON.stringify(candidate, null, 2) + '\n');

const labAsset = {
  id: 'creature_banshee',
  file: 'models/creature/creature_banshee.glb',
  pack: 'corealm-tripo-creatures',
  category: 'character',
  is: 'Starred Wilderness Banshee, hover-rig candidate',
  tags: ['creature', 'humanoid', 'wilderness', 'spectral', 'T50', 'starred', 'tripo', 'candidate'],
  bytes: outputBytes.length,
  sha256: candidateSha256,
  size: { x: bounds.max[0] - bounds.min[0], y: bounds.max[1] - bounds.min[1], z: bounds.max[2] - bounds.min[2] },
  base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] },
  bounds,
  groundY: -0.10,
  triangles: indices.length / 3,
  vertices: positions.length / 3,
  animations: clips.map(({ name }) => name),
  materials: root.listMaterials().map((entry) => entry.getName()),
  sourceProvenance: {
    author: 'Corealm candidate rig reconstruction',
    sourceImageId,
    sourceModelId,
    sourceCardId,
    sourceFile,
    sourceSha256,
    candidateFile,
    candidateSha256,
    rigMethod: 'Mixamo-named humanoid mapping with independent body, arm and mist ribbon chains; hover cycles contain no leg stride.',
    texturePolicy: 'Exact approved 8K image-generated base color and Tripo PBR maps downsampled to 2K for runtime.',
    candidateStatus: 'awaiting-root-lab-review',
  },
  acceptance: { assetAudit: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${ownerDir}/lab-catalog.json`, JSON.stringify({
  schema: 'corealm-lab-asset-candidates/1',
  pack: { id: 'corealm-tripo-creatures', name: 'Corealm Tripo creature candidates', author: 'Corealm', source: 'Tripo Studio generated creatures and Corealm rig/material adaptation', license: 'LicenseRef-Corealm-Original' },
  files: { creature_banshee: 'banshee-native-rig-candidate.glb' },
  assets: [labAsset],
}, null, 2) + '\n');
console.log(JSON.stringify({ candidateFile, candidateSha256, bytes: outputBytes.length, vertices: positions.length / 3, triangles: indices.length / 3, joints: bones.length, clips, runtimeTextures, verticesWithDistributedWeights, verticesWithMistInfluence, maximumWeightSumError: maxWeightSumError, geometryMismatches: { positionsChanged, indicesChanged, uvsChanged, normalsChanged }, sourceRootWeightedVertices, metallicRange }, null, 2));
