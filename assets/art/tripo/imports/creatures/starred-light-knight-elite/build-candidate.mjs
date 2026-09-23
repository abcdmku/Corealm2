import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const baseDir = 'assets/art/tripo/imports/creatures/starred-light-knight-elite';
const sourcePath = 'assets/art/tripo/exports/03614ce2-9922-4e76-93e9-c906adf800ed.glb';
const candidatePath = `${baseDir}/ivory-castellan-native-rig-candidate.glb`;
const sourceExpectedSha256 = 'f21a1e9b7cd30944395a0f94fa71b6582ab8d5dd2286ca5457f90c6a60194853';
await mkdir(baseDir, { recursive: true });

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
if (sourceSha256 !== sourceExpectedSha256) throw new Error(`Starred knight source hash mismatch: ${sourceSha256}`);
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const sourceMesh = root.listMeshes()[0];
const primitive = sourceMesh?.listPrimitives()[0];
const meshNode = root.listNodes().find((node) => node.getMesh() === sourceMesh);
const sourceSkin = meshNode?.getSkin();
if (!scene || !primitive || !meshNode || !sourceSkin || root.listAnimations().length !== 0) {
  throw new Error('Expected the approved static, skinned starred light-knight GLB with no animations.');
}
const positions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
const indices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
const uvs = Float32Array.from(primitive.getAttribute('TEXCOORD_0')?.getArray() ?? []);
const sourceJointNames = sourceSkin.listJoints().map((joint) => joint.getName());
const sourceJoints = Uint16Array.from(primitive.getAttribute('JOINTS_0')?.getArray() ?? []);
const sourceWeights = Float32Array.from(primitive.getAttribute('WEIGHTS_0')?.getArray() ?? []);
if (sourceJoints.length !== positions.length / 3 * 4 || sourceWeights.length !== sourceJoints.length) throw new Error('The source skin is missing its four-joint vertex attributes.');
let sourceHipOnlyVertices = 0;
let sourceSingleInfluenceVertices = 0;
const sourceHipIndex = sourceJointNames.indexOf('Hips');
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  let nonzero = 0, hipWeight = 0;
  for (let slot = 0; slot < 4; slot++) {
    const weight = sourceWeights[vertex * 4 + slot];
    if (weight > 1e-6) {
      nonzero++;
      if (sourceJoints[vertex * 4 + slot] === sourceHipIndex) hipWeight = weight;
    }
  }
  if (nonzero === 1) sourceSingleInfluenceVertices++;
  if (nonzero === 1 && hipWeight > 0.999) sourceHipOnlyVertices++;
}
if (positions.length / 3 !== 7241 || indices.length / 3 !== 4574 || uvs.length / 2 !== 7241) {
  throw new Error(`Source topology changed: ${positions.length / 3} vertices, ${indices.length / 3} triangles, ${uvs.length / 2} UVs.`);
}
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
  bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
}

// The Tripo export's skin is effectively rigid: 99.7% of its vertices use only Hips.
// Preserve all topology and UVs; replace the bind skeleton and weights with a compact,
// Unity Humanoid-mappable Mixamo hierarchy fitted to this knight's existing T-pose.
const bones = [
  { name: 'mixamorigHips', parent: null, p: [0, 0.375, -0.005], sigma: 0.085, group: 'torso' },
  { name: 'mixamorigSpine', parent: 'mixamorigHips', p: [0, 0.465, -0.005], sigma: 0.092, group: 'torso' },
  { name: 'mixamorigSpine1', parent: 'mixamorigSpine', p: [0, 0.565, -0.005], sigma: 0.100, group: 'torso' },
  { name: 'mixamorigSpine2', parent: 'mixamorigSpine1', p: [0, 0.675, -0.008], sigma: 0.105, group: 'torso' },
  { name: 'mixamorigNeck', parent: 'mixamorigSpine2', p: [0, 0.825, -0.018], sigma: 0.075, group: 'head' },
  { name: 'mixamorigHead', parent: 'mixamorigNeck', p: [0, 0.920, -0.018], sigma: 0.075, group: 'head' },
  { name: 'mixamorigLeftShoulder', parent: 'mixamorigSpine2', p: [-0.120, 0.755, -0.008], sigma: 0.065, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftArm', parent: 'mixamorigLeftShoulder', p: [-0.270, 0.785, -0.008], sigma: 0.070, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftForeArm', parent: 'mixamorigLeftArm', p: [-0.405, 0.785, -0.004], sigma: 0.065, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftHand', parent: 'mixamorigLeftForeArm', p: [-0.472, 0.780, 0.002], sigma: 0.060, group: 'leftArm', side: -1 },
  { name: 'mixamorigRightShoulder', parent: 'mixamorigSpine2', p: [0.120, 0.755, -0.008], sigma: 0.065, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightArm', parent: 'mixamorigRightShoulder', p: [0.270, 0.785, -0.008], sigma: 0.070, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightForeArm', parent: 'mixamorigRightArm', p: [0.405, 0.785, -0.004], sigma: 0.065, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightHand', parent: 'mixamorigRightForeArm', p: [0.472, 0.780, 0.002], sigma: 0.060, group: 'rightArm', side: 1 },
  { name: 'mixamorigLeftUpLeg', parent: 'mixamorigHips', p: [-0.100, 0.270, 0.000], sigma: 0.075, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftLeg', parent: 'mixamorigLeftUpLeg', p: [-0.102, 0.145, 0.000], sigma: 0.065, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftFoot', parent: 'mixamorigLeftLeg', p: [-0.102, 0.055, 0.025], sigma: 0.060, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftToeBase', parent: 'mixamorigLeftFoot', p: [-0.102, 0.032, 0.095], sigma: 0.050, group: 'leftLeg', side: -1 },
  { name: 'mixamorigRightUpLeg', parent: 'mixamorigHips', p: [0.100, 0.270, 0.000], sigma: 0.075, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightLeg', parent: 'mixamorigRightUpLeg', p: [0.102, 0.145, 0.000], sigma: 0.065, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightFoot', parent: 'mixamorigRightLeg', p: [0.102, 0.055, 0.025], sigma: 0.060, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightToeBase', parent: 'mixamorigRightFoot', p: [0.102, 0.032, 0.095], sigma: 0.050, group: 'rightLeg', side: 1 },
];
const boneByName = new Map(bones.map((bone, index) => [bone.name, { ...bone, index }]));
for (const bone of bones) {
  const parent = bone.parent ? boneByName.get(bone.parent) : null;
  bone.local = parent ? bone.p.map((value, axis) => value - parent.p[axis]) : bone.p;
}

const originalParent = meshNode.getParentNode();
if (originalParent) originalParent.removeChild(meshNode);
else if (scene.listChildren().includes(meshNode)) scene.removeChild(meshNode);
else throw new Error('Source mesh node is detached from its scene.');
meshNode.setSkin(null);
const sourceArmature = scene.listChildren().find((node) => node !== meshNode);
if (sourceArmature) {
  scene.removeChild(sourceArmature);
  const oldNodes = [];
  sourceArmature.traverse((node) => oldNodes.push(node));
  for (const node of oldNodes.reverse()) node.dispose();
}
sourceSkin.dispose();

meshNode.setName('IvoryCastellanMesh');
const rigRoot = doc.createNode('IvoryCastellanArmature').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
scene.addChild(rigRoot);
rigRoot.addChild(meshNode);
const jointNodes = new Map();
for (const bone of bones) {
  const node = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  jointNodes.set(bone.name, node);
  (bone.parent ? jointNodes.get(bone.parent) : rigRoot).addChild(node);
}
const skin = doc.createSkin('IvoryCastellan_UnityHumanoid').setSkeleton(jointNodes.get('mixamorigHips'));
for (const bone of bones) skin.addJoint(jointNodes.get(bone.name));
const inverseBinds = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i++) {
  const [x, y, z] = bones[i].p;
  inverseBinds.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
}
const buffer = root.listBuffers()[0];
skin.setInverseBindMatrices(doc.createAccessor('IvoryCastellan_InverseBind').setArray(inverseBinds).setType(Accessor.Type.MAT4).setBuffer(buffer));
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
let verticesWithDistributedWeights = 0;
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const [x, y] = point;
  const candidates = [];
  for (const bone of bones) {
    let gate = 1;
    if (bone.group === 'head') gate = y > 0.79 ? 1 : 0.02;
    if (bone.group === 'leftArm' || bone.group === 'rightArm') {
      gate = y > 0.64 && y < 0.90 ? 1 : 0.008;
      const lateral = bone.side * x;
      gate *= 0.015 + 0.985 / (1 + Math.exp(-(lateral - 0.092) / 0.026));
    }
    if (bone.group === 'leftLeg' || bone.group === 'rightLeg') {
      gate = y < 0.47 ? 1 : 0.006;
      const lateral = bone.side * x;
      gate *= 0.015 + 0.985 / (1 + Math.exp(-(lateral - 0.026) / 0.030));
    }
    const parent = bone.parent ? boneByName.get(bone.parent) : null;
    const distance = segmentDistance(point, parent?.p ?? bone.p, bone.p);
    const score = gate * Math.exp(-0.5 * (distance / bone.sigma) ** 2);
    if (score > 1e-10) candidates.push({ index: boneByName.get(bone.name).index, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 4);
  if (!chosen.length) throw new Error(`No anatomical weights could be assigned at vertex ${vertex}.`);
  const total = chosen.reduce((sum, candidate) => sum + candidate.score, 0);
  let assigned = 0;
  let nonzero = 0;
  for (let slot = 0; slot < 4; slot++) {
    const candidate = chosen[slot] ?? chosen[0];
    const weight = slot >= chosen.length ? 0 : slot === chosen.length - 1 ? 1 - assigned : candidate.score / total;
    jointValues[vertex * 4 + slot] = candidate.index;
    weightValues[vertex * 4 + slot] = weight;
    assigned += weight;
    if (weight > 1e-6) { influenceCounts[candidate.index]++; nonzero++; }
  }
  if (nonzero > 1) verticesWithDistributedWeights++;
  const sum = weightValues[vertex * 4] + weightValues[vertex * 4 + 1] + weightValues[vertex * 4 + 2] + weightValues[vertex * 4 + 3];
  maximumWeightSumError = Math.max(maximumWeightSumError, Math.abs(sum - 1));
}
primitive.setAttribute('JOINTS_0', doc.createAccessor('IvoryCastellan_Joints0').setArray(jointValues).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('IvoryCastellan_Weights0').setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(buffer));

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
const cycle = (phase, amount, side = 1, axis = 'x') => phases.map((t) => quat(axis, Math.sin((t + phase) * Math.PI * 2) * amount * side));
const hipTranslation = (bob, forward = 0) => phases.map((t) => [0, bones[0].p[1] + Math.sin(t * Math.PI * 4) * bob, forward]);
addClip('Idle', 2.8, [
  { node: 'mixamorigSpine1', times: [0, 0.7, 1.4, 2.1, 2.8], values: [quat('z', 0), quat('z', 0.014), quat('z', 0), quat('z', -0.014), quat('z', 0)] },
  { node: 'mixamorigSpine2', times: [0, 0.7, 1.4, 2.1, 2.8], values: [quat('x', 0), quat('x', -0.012), quat('x', 0), quat('x', 0.010), quat('x', 0)] },
  { node: 'mixamorigHead', times: [0, 0.7, 1.4, 2.1, 2.8], values: [quat('y', -0.018), quat('y', 0.012), quat('y', 0.026), quat('y', -0.012), quat('y', -0.018)] },
  { node: 'mixamorigLeftArm', times: [0, 0.7, 1.4, 2.1, 2.8], values: [quat('z', 0), quat('z', 0.025), quat('z', 0), quat('z', -0.020), quat('z', 0)] },
  { node: 'mixamorigRightArm', times: [0, 0.7, 1.4, 2.1, 2.8], values: [quat('z', 0), quat('z', -0.025), quat('z', 0), quat('z', 0.020), quat('z', 0)] },
]);
addClip('Walk', 1.0, [
  { node: 'mixamorigHips', path: 'translation', times: phases, values: hipTranslation(0.008) },
  { node: 'mixamorigLeftUpLeg', times: phases, values: cycle(0, 0.30) },
  { node: 'mixamorigRightUpLeg', times: phases, values: cycle(0.5, 0.30) },
  { node: 'mixamorigLeftLeg', times: phases, values: phases.map((t) => quat('x', -Math.max(0, Math.sin(t * Math.PI * 2)) * 0.20)) },
  { node: 'mixamorigRightLeg', times: phases, values: phases.map((t) => quat('x', -Math.max(0, Math.sin((t + 0.5) * Math.PI * 2)) * 0.20)) },
  { node: 'mixamorigLeftArm', times: phases, values: cycle(0, 0.11, -1, 'z') },
  { node: 'mixamorigRightArm', times: phases, values: cycle(0.5, 0.11, 1, 'z') },
]);
addClip('Run', 0.74, [
  { node: 'mixamorigHips', path: 'translation', times: phases.map((t) => t * 0.74), values: hipTranslation(0.014) },
  { node: 'mixamorigLeftUpLeg', times: phases.map((t) => t * 0.74), values: cycle(0, 0.54) },
  { node: 'mixamorigRightUpLeg', times: phases.map((t) => t * 0.74), values: cycle(0.5, 0.54) },
  { node: 'mixamorigLeftLeg', times: phases.map((t) => t * 0.74), values: phases.map((t) => quat('x', -Math.max(0, Math.sin(t * Math.PI * 2)) * 0.48)) },
  { node: 'mixamorigRightLeg', times: phases.map((t) => t * 0.74), values: phases.map((t) => quat('x', -Math.max(0, Math.sin((t + 0.5) * Math.PI * 2)) * 0.48)) },
  { node: 'mixamorigLeftArm', times: phases.map((t) => t * 0.74), values: cycle(0, 0.26, -1, 'z') },
  { node: 'mixamorigRightArm', times: phases.map((t) => t * 0.74), values: cycle(0.5, 0.26, 1, 'z') },
  { node: 'mixamorigSpine1', times: phases.map((t) => t * 0.74), values: phases.map((t) => quat('x', 0.025 + Math.sin(t * Math.PI * 2) * 0.025)) },
]);
addClip('Attack', 0.92, [
  { node: 'mixamorigHips', path: 'translation', times: [0, 0.18, 0.48, 0.70, 0.92], values: [[0, bones[0].p[1], 0], [0, bones[0].p[1], -0.012], [0, bones[0].p[1] - 0.008, 0.032], [0, bones[0].p[1], 0.012], [0, bones[0].p[1], 0]] },
  { node: 'mixamorigSpine1', times: [0, 0.18, 0.48, 0.70, 0.92], values: [quat('y', 0), quat('y', -0.18), quat('y', 0.22), quat('y', 0.08), quat('y', 0)] },
  { node: 'mixamorigRightArm', times: [0, 0.18, 0.48, 0.70, 0.92], values: [quat('z', 0), quat('z', 0.36), quat('z', -0.55), quat('z', -0.15), quat('z', 0)] },
  { node: 'mixamorigRightForeArm', times: [0, 0.18, 0.48, 0.70, 0.92], values: [quat('x', 0), quat('x', -0.22), quat('x', 0.72), quat('x', 0.22), quat('x', 0)] },
  { node: 'mixamorigLeftArm', times: [0, 0.18, 0.48, 0.70, 0.92], values: [quat('z', 0), quat('z', -0.10), quat('z', 0.12), quat('z', 0.04), quat('z', 0)] },
]);
addClip('Hit', 0.46, [
  { node: 'mixamorigHips', path: 'translation', times: [0, 0.08, 0.20, 0.46], values: [[0, bones[0].p[1], 0], [0, bones[0].p[1] - 0.010, -0.015], [0, bones[0].p[1] - 0.003, -0.005], [0, bones[0].p[1], 0]] },
  { node: 'mixamorigSpine1', times: [0, 0.08, 0.20, 0.46], values: [quat('z', 0), quat('z', 0.22), quat('z', -0.075), quat('z', 0)] },
  { node: 'mixamorigSpine2', times: [0, 0.08, 0.20, 0.46], values: [quat('x', 0), quat('x', -0.12), quat('x', 0.045), quat('x', 0)] },
  { node: 'mixamorigHead', times: [0, 0.08, 0.20, 0.46], values: [quat('z', 0), quat('z', 0.17), quat('z', -0.035), quat('z', 0)] },
  { node: 'mixamorigRightArm', times: [0, 0.08, 0.20, 0.46], values: [quat('z', 0), quat('z', 0.24), quat('z', -0.055), quat('z', 0)] },
]);
addClip('Death', 1.45, [
  { node: 'mixamorigHips', path: 'translation', times: [0, 0.22, 0.65, 1.05, 1.45], values: [[0, 0.375, 0], [0, 0.350, -0.010], [0, 0.270, -0.025], [0, 0.230, -0.025], [0, 0.230, -0.025]] },
  { node: 'mixamorigHips', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('z', 0), quat('z', -0.08), quat('z', -0.28), quat('z', -0.35), quat('z', -0.35)] },
  { node: 'mixamorigSpine1', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('x', 0), quat('x', 0.10), quat('x', 0.24), quat('x', 0.30), quat('x', 0.30)] },
  { node: 'mixamorigSpine2', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('x', 0), quat('x', 0.09), quat('x', 0.19), quat('x', 0.22), quat('x', 0.22)] },
  { node: 'mixamorigHead', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('z', 0), quat('z', 0.10), quat('z', 0.26), quat('z', 0.32), quat('z', 0.32)] },
  { node: 'mixamorigLeftArm', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('z', 0), quat('z', -0.12), quat('z', -0.40), quat('z', -0.46), quat('z', -0.46)] },
  { node: 'mixamorigRightArm', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('z', 0), quat('z', 0.12), quat('z', 0.40), quat('z', 0.46), quat('z', 0.46)] },
  { node: 'mixamorigLeftUpLeg', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('x', 0), quat('x', -0.05), quat('x', -0.22), quat('x', -0.28), quat('x', -0.28)] },
  { node: 'mixamorigRightUpLeg', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('x', 0), quat('x', 0.05), quat('x', 0.22), quat('x', 0.28), quat('x', 0.28)] },
]);

const sourceTextureMetrics = [];
const runtimeTextureMetrics = [];
for (const texture of root.listTextures()) {
  const bytes = texture.getImage();
  const metadata = await sharp(bytes).metadata();
  sourceTextureMetrics.push({ name: texture.getName(), width: metadata.width, height: metadata.height, mime: texture.getMimeType(), sha256: createHash('sha256').update(bytes).digest('hex') });
  if (metadata.width > 2048 || metadata.height > 2048) {
    const encoded = await sharp(bytes).resize(2048, 2048, { fit: 'inside', kernel: 'lanczos3' })
      .jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
    texture.setImage(encoded).setMimeType('image/jpeg');
  }
  const runtimeMeta = await sharp(texture.getImage()).metadata();
  runtimeTextureMetrics.push({ name: texture.getName(), width: runtimeMeta.width, height: runtimeMeta.height, mime: texture.getMimeType(), bytes: texture.getImage().length });
  if (runtimeMeta.width > 2048 || runtimeMeta.height > 2048) throw new Error(`Runtime texture exceeds 2K: ${texture.getName()}`);
}
const material = root.listMaterials()[0];
if (!material?.getBaseColorTexture() || material.getMetallicRoughnessTexture() || material.getNormalTexture() || material.getOcclusionTexture() || material.getEmissiveTexture()) {
  throw new Error('Expected the source to contain only its diffuse/base-color map; material status changed.');
}
const sourceMaterial = { metallicFactor: material.getMetallicFactor(), roughnessFactor: material.getRoughnessFactor(), pbrMaps: { metallicRoughness: false, normal: false, occlusion: false, emissive: false } };

const outputBytes = await io.writeBinary(doc);
await writeFile(candidatePath, outputBytes);
const candidateSha256 = createHash('sha256').update(outputBytes).digest('hex');
const checkDoc = await io.readBinary(outputBytes);
const checkRoot = checkDoc.getRoot();
const checkMesh = checkRoot.listMeshes()[0];
const checkPrimitive = checkMesh.listPrimitives()[0];
const checkPositions = checkPrimitive.getAttribute('POSITION')?.getArray();
const checkIndices = checkPrimitive.getIndices()?.getArray();
const checkUvs = checkPrimitive.getAttribute('TEXCOORD_0')?.getArray();
const checkJoints = checkPrimitive.getAttribute('JOINTS_0')?.getArray();
const checkWeights = checkPrimitive.getAttribute('WEIGHTS_0')?.getArray();
const checkSkin = checkRoot.listSkins()[0];
if (!checkPositions || !checkIndices || !checkUvs || !checkJoints || !checkWeights || !checkSkin) throw new Error('Candidate lost required geometry or skin attributes.');
let maxPositionDelta = 0, indexMismatches = 0, uvMismatches = 0, verticesWithValidWeights = 0;
for (let i = 0; i < checkPositions.length; i++) maxPositionDelta = Math.max(maxPositionDelta, Math.abs(checkPositions[i] - positions[i]));
for (let i = 0; i < checkIndices.length; i++) if (checkIndices[i] !== indices[i]) indexMismatches++;
for (let i = 0; i < checkUvs.length; i++) if (checkUvs[i] !== uvs[i]) uvMismatches++;
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  let sum = 0, nonzero = 0;
  for (let slot = 0; slot < 4; slot++) {
    const joint = checkJoints[vertex * 4 + slot], weight = checkWeights[vertex * 4 + slot];
    if (!Number.isInteger(joint) || joint < 0 || joint >= checkSkin.listJoints().length || !Number.isFinite(weight) || weight < 0) throw new Error(`Invalid skin weight at vertex ${vertex}.`);
    sum += weight;
    if (weight > 1e-6) nonzero++;
  }
  if (Math.abs(sum - 1) > 1e-5) throw new Error(`Vertex ${vertex} has non-normalized weights: ${sum}.`);
  if (nonzero > 1) verticesWithValidWeights++;
}
if (maxPositionDelta !== 0 || indexMismatches || uvMismatches || verticesWithValidWeights < positions.length / 3 * 0.75) {
  throw new Error(`Preservation/weights check failed: position ${maxPositionDelta}, index ${indexMismatches}, UV ${uvMismatches}, multiweighted ${verticesWithValidWeights}.`);
}
const animationNames = checkRoot.listAnimations().map((animation) => animation.getName());
const requiredClips = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
if (requiredClips.some((name) => !animationNames.includes(name))) throw new Error('Candidate does not contain all six gameplay clips.');
for (const animation of checkRoot.listAnimations()) for (const channel of animation.listChannels()) {
  if (!checkSkin.listJoints().includes(channel.getTargetNode())) throw new Error(`${animation.getName()} targets a non-joint node.`);
}
const jointNames = checkSkin.listJoints().map((joint) => joint.getName());
if (jointNames.length !== bones.length || !jointNames.includes('mixamorigHips') || !jointNames.includes('mixamorigHead')) throw new Error('Candidate is not a compact Mixamo-mappable humanoid skin.');

const commonStatus = {
  pbr: 'held-maps-absent',
  materialReview: 'PBR HOLD: Tripo export embeds only an 8192x8192 base-color JPEG. It has no metallic-roughness, normal, occlusion or emissive texture. Do not describe this as PBR-ready or promote until layered metal/roughness and tangent-space normal maps are generated and their rendered response is reviewed.',
  pbrPlan: 'Return to the starred Tripo project and generate PBR maps for the approved source. Verify a non-flat packed metallic-roughness map and tangent-space normal map, downsample both to 2K, then inspect the plate, cloth, leather, and trim under neutral and angled light in the production lab.',
};
const candidate = {
  schema: 'corealm-creature-native-rig-candidate/1',
  id: 'creature_ivory_castellan',
  displayName: 'Ivory Castellan',
  status: 'awaiting-root-lab-review; material-held',
  accepted: false,
  ...commonStatus,
  source: {
    file: sourcePath,
    sha256: sourceSha256,
    bytes: sourceBytes.length,
    starredModelId: 'ae5cec06-0458-43a9-a16e-ee9aadbd4d91',
    starredCardId: '03614ce2-9922-4e76-93e9-c906adf800ed',
    starredDisplayName: 'medieval knight armor 3d model light',
    prompt: 'armor-clad knight in full plate armor with gold trim and white tabard',
    sourceGenerator: 'Tripo P1, skeleton enabled',
    geometry: { vertices: positions.length / 3, triangles: indices.length / 3, bounds, positionsPreserved: maxPositionDelta === 0, indicesPreserved: indexMismatches === 0, uvPreserved: uvMismatches === 0, retopology: false },
    preliminaryDesignReview: 'Astra-low accepted as Crownward T40 Ivory Castellan visual; white/gold plate, white tabard and restrained dark steel details fit the regional elite knight role.',
    textures: sourceTextureMetrics,
    sourceMaterial,
    sourceSkin: { joints: sourceJointNames.length, sourceSingleInfluenceVertices, sourceHipOnlyVertices, sourceWeights: 'Single-joint rigid weights are replaced with the model-specific anatomical four-weight skin.' },
    sourceAnimations: [],
  },
  candidate: {
    file: candidatePath,
    sha256: candidateSha256,
    bytes: outputBytes.length,
    productionTarget: 'game/public/assets/models/creature/creature_ivory_castellan.glb',
    geometry: { vertices: positions.length / 3, triangles: indices.length / 3, positionsPreserved: true, indicesPreserved: true, uvPreserved: true },
    rig: { type: 'Mixamo-named Unity Humanoid-mappable glTF skin', joints: bones.map((bone) => ({ name: bone.name, parent: bone.parent, position: bone.p })), influencesPerVertex: 4, verticesWithDistributedWeights, maximumWeightSumError, method: 'Model-specific four-weight anatomical skin fitted to the T-pose; source mesh, UVs, indices and atlas are retained without retopology.' },
    textures: runtimeTextureMetrics,
    material: { ...sourceMaterial, status: 'held; PBR maps absent' },
    animations: clips,
  },
  acceptance: { sourceDesignAudit: true, geometry: true, rig: false, animation: false, textures: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${baseDir}/catalog.json`, JSON.stringify(candidate, null, 2) + '\n');

const labAsset = {
  id: 'creature_ivory_castellan',
  file: 'models/creature/creature_ivory_castellan.glb',
  pack: 'animal-pack-deluxe',
  category: 'character',
  is: 'Ivory Castellan',
  tags: ['creature', 'humanoid', 'knight', 'crownward', 't40', 'starred', 'rig-candidate', 'material-held'],
  bytes: outputBytes.length,
  sha256: candidateSha256,
  size: { x: bounds.max[0] - bounds.min[0], y: bounds.max[1] - bounds.min[1], z: bounds.max[2] - bounds.min[2] },
  base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] },
  bounds,
  groundY: bounds.min[1],
  triangles: indices.length / 3,
  animations: clips.map((clip) => clip.name),
  materials: checkRoot.listMaterials().map((entry) => entry.getName()),
  walkClipSeconds: 1.0,
  runClipSeconds: 0.74,
  attackSeconds: 0.92,
  sourceProvenance: {
    author: 'Corealm candidate rig reconstruction',
    sourceModelId: 'ae5cec06-0458-43a9-a16e-ee9aadbd4d91',
    sourceCardId: '03614ce2-9922-4e76-93e9-c906adf800ed',
    sourceFile: sourcePath,
    sourceSha256,
    candidateFile: candidatePath,
    candidateSha256,
    rigMethod: 'Mixamo-named anatomical four-weight skeleton fitted to the original T-pose mesh; topology and UVs unchanged.',
    textures: runtimeTextureMetrics,
    materialStatus: 'Base color only; metallic-roughness and normal maps absent. Held pending Tripo PBR generation and neutral/angled light review.',
    candidateStatus: 'awaiting-root-lab-review; material-held',
  },
  acceptance: { assetAudit: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${baseDir}/lab-catalog.json`, JSON.stringify({
  schema: 'corealm-lab-asset-candidates/1',
  assets: [labAsset],
  files: { creature_ivory_castellan: './ivory-castellan-native-rig-candidate.glb' },
}, null, 2) + '\n');

console.log(JSON.stringify({ candidatePath, bytes: outputBytes.length, candidateSha256, triangles: indices.length / 3, vertices: positions.length / 3, joints: bones.length, clips: clips.map(({ name, seconds }) => ({ name, seconds })), sourceTextureMetrics, runtimeTextureMetrics, pbr: commonStatus.pbr, verticesWithDistributedWeights, maximumWeightSumError, maxPositionDelta, indexMismatches, uvMismatches }, null, 2));
