import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const baseDir = 'assets/art/tripo/imports/creatures/new-star-ashen-demon';
const sourcePath = 'assets/art/tripo/exports/e75eed94-f770-4fc3-83f2-d812e898b0ee.glb';
const candidatePath = `${baseDir}/ashen-carapax-native-rig-candidate.glb`;
const sourceSha256Expected = '6531b664fc404c5dee25dc21ba6177061af0bbc0a46bf830b20f1ff61cc96f02';
const modelScale = 2.0;
await mkdir(baseDir, { recursive: true });

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
if (sourceSha256 !== sourceSha256Expected) throw new Error(`Ashen Carapax source hash mismatch: ${sourceSha256}`);
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find((node) => node.getMesh() === mesh);
const sourceSkin = root.listSkins()[0];
if (!scene || !mesh || !primitive || !meshNode || !sourceSkin || root.listAnimations().length) {
  throw new Error('Expected the approved P1 source mesh with a root-only skin and no authored clips.');
}
const sourceInverseBinds = sourceSkin.getInverseBindMatrices()?.getArray();
const sourceJointCount = sourceSkin.listJoints().length;
if (!sourceInverseBinds || sourceInverseBinds.length !== sourceSkin.listJoints().length * 16) {
  throw new Error('Expected a complete source inverse-bind accessor before replacing its damaged rig.');
}
const sourceJointWeights = primitive.getAttribute('WEIGHTS_0')?.getArray();
const sourceJointIndices = primitive.getAttribute('JOINTS_0')?.getArray();
if (!sourceJointWeights || !sourceJointIndices) throw new Error('Source skin attributes are missing.');
const rootOnlyVertices = new Set();
for (let vertex = 0; vertex < sourceJointWeights.length / 4; vertex++) {
  let dominantJoint = -1, dominantWeight = -1;
  for (let influence = 0; influence < 4; influence++) {
    const weight = sourceJointWeights[vertex * 4 + influence];
    if (weight > dominantWeight) { dominantWeight = weight; dominantJoint = sourceJointIndices[vertex * 4 + influence]; }
  }
  if (dominantJoint === 0) rootOnlyVertices.add(vertex);
}
if (rootOnlyVertices.size < 0.99 * sourceJointWeights.length / 4) {
  throw new Error(`Unexpected source skin: only ${rootOnlyVertices.size}/${sourceJointWeights.length / 4} vertices are root-weighted.`);
}

const positions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
const normals = Float32Array.from(primitive.getAttribute('NORMAL')?.getArray() ?? []);
const uvs = Float32Array.from(primitive.getAttribute('TEXCOORD_0')?.getArray() ?? []);
const indices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
if (positions.length / 3 !== 4116 || indices.length / 3 !== 5077 || normals.length !== positions.length || uvs.length / 2 !== positions.length / 3) {
  throw new Error(`Unexpected source topology: ${positions.length / 3} vertices, ${indices.length / 3} triangles.`);
}
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
  bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
}

// The source carries a complete 57-bone Humanoid tree, but 99.95% of its vertices
// are bound to Hips. Build a small Mixamo-named Humanoid rig in the mesh's own
// upright space, retaining every source vertex, triangle, UV, and PBR map.
const bones = [
  { name: 'mixamorigHips', parent: null, p: [0, 0.445, 0.000], sigma: 0.105, group: 'torso' },
  { name: 'mixamorigSpine', parent: 'mixamorigHips', p: [0, 0.515, 0.000], sigma: 0.090, group: 'torso' },
  { name: 'mixamorigSpine1', parent: 'mixamorigSpine', p: [0, 0.590, 0.000], sigma: 0.090, group: 'torso' },
  { name: 'mixamorigSpine2', parent: 'mixamorigSpine1', p: [0, 0.675, 0.000], sigma: 0.085, group: 'torso' },
  { name: 'mixamorigNeck', parent: 'mixamorigSpine2', p: [0, 0.755, 0.005], sigma: 0.072, group: 'torso' },
  { name: 'mixamorigHead', parent: 'mixamorigNeck', p: [0, 0.830, 0.012], sigma: 0.090, group: 'head' },
  { name: 'mixamorigLeftShoulder', parent: 'mixamorigSpine2', p: [-0.105, 0.680, 0.000], sigma: 0.070, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftArm', parent: 'mixamorigLeftShoulder', p: [-0.220, 0.678, 0.000], sigma: 0.073, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftForeArm', parent: 'mixamorigLeftArm', p: [-0.345, 0.675, 0.000], sigma: 0.070, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftHand', parent: 'mixamorigLeftForeArm', p: [-0.445, 0.670, 0.005], sigma: 0.074, group: 'leftArm', side: -1 },
  { name: 'mixamorigRightShoulder', parent: 'mixamorigSpine2', p: [0.105, 0.680, 0.000], sigma: 0.070, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightArm', parent: 'mixamorigRightShoulder', p: [0.220, 0.678, 0.000], sigma: 0.073, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightForeArm', parent: 'mixamorigRightArm', p: [0.345, 0.675, 0.000], sigma: 0.070, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightHand', parent: 'mixamorigRightForeArm', p: [0.445, 0.670, 0.005], sigma: 0.074, group: 'rightArm', side: 1 },
  { name: 'mixamorigLeftUpLeg', parent: 'mixamorigHips', p: [-0.070, 0.405, 0.000], sigma: 0.068, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftLeg', parent: 'mixamorigLeftUpLeg', p: [-0.082, 0.230, 0.002], sigma: 0.060, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftFoot', parent: 'mixamorigLeftLeg', p: [-0.085, 0.065, 0.010], sigma: 0.050, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftToeBase', parent: 'mixamorigLeftFoot', p: [-0.085, 0.033, 0.075], sigma: 0.048, group: 'leftLeg', side: -1 },
  { name: 'mixamorigRightUpLeg', parent: 'mixamorigHips', p: [0.070, 0.405, 0.000], sigma: 0.068, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightLeg', parent: 'mixamorigRightUpLeg', p: [0.082, 0.230, 0.002], sigma: 0.060, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightFoot', parent: 'mixamorigRightLeg', p: [0.085, 0.065, 0.010], sigma: 0.050, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightToeBase', parent: 'mixamorigRightFoot', p: [0.085, 0.033, 0.075], sigma: 0.048, group: 'rightLeg', side: 1 },
];
const boneByName = new Map(bones.map((bone, index) => [bone.name, { ...bone, index }]));
for (const bone of bones) {
  const parent = bone.parent ? boneByName.get(bone.parent) : null;
  bone.local = parent ? bone.p.map((value, axis) => value - parent.p[axis]) : bone.p;
}

const sourceNodes = [...root.listNodes()];
const sourceParent = meshNode.getParentNode();
if (sourceParent) sourceParent.removeChild(meshNode);
else if (scene.listChildren().includes(meshNode)) scene.removeChild(meshNode);
else throw new Error('Source mesh node is detached from its scene.');
meshNode.setSkin(null).setName('AshenCarapaxMesh').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
for (const attr of ['JOINTS_0', 'WEIGHTS_0', 'JOINTS_1', 'WEIGHTS_1']) primitive.setAttribute(attr, null);
for (const sourceSkinEntry of [...root.listSkins()]) sourceSkinEntry.dispose();
for (const sourceNode of sourceNodes) if (sourceNode !== meshNode) sourceNode.dispose();

const presentation = doc.createNode('AshenCarapaxPresentation').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([modelScale, modelScale, modelScale]);
const rigContainer = doc.createNode('AshenCarapaxArmature').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
scene.addChild(presentation);
presentation.addChild(meshNode);
presentation.addChild(rigContainer);
const jointNodes = new Map();
for (const bone of bones) {
  const node = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  jointNodes.set(bone.name, node);
  (bone.parent ? jointNodes.get(bone.parent) : rigContainer).addChild(node);
}
const skin = doc.createSkin('AshenCarapax_UnityHumanoid').setSkeleton(jointNodes.get('mixamorigHips'));
for (const bone of bones) skin.addJoint(jointNodes.get(bone.name));
const inverseBinds = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i++) {
  const [x, y, z] = bones[i].p;
  inverseBinds.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
}
const buffer = root.listBuffers()[0];
skin.setInverseBindMatrices(doc.createAccessor('AshenCarapax_InverseBind').setArray(inverseBinds).setType(Accessor.Type.MAT4).setBuffer(buffer));
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
const dominantCounts = new Uint32Array(bones.length);
let maximumWeightSumError = 0;
const smoothstep = (edge0, edge1, value) => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const [x, y] = point;
  const candidates = [];
  const headGate = smoothstep(0.70, 0.80, y) * (0.28 + 0.72 * (1 - smoothstep(0.10, 0.25, Math.abs(x))));
  const armHeight = smoothstep(0.27, 0.43, y) * (1 - smoothstep(0.82, 0.93, y));
  const legHeight = 1 - smoothstep(0.40, 0.54, y);
  for (const bone of bones) {
    const parent = bone.parent ? boneByName.get(bone.parent) : null;
    const distance = segmentDistance(point, parent?.p ?? bone.p, bone.p);
    let gate = 1;
    if (bone.group === 'head') gate = headGate;
    if (bone.group === 'leftArm' || bone.group === 'rightArm') {
      const lateral = bone.side * x;
      const sideGate = 0.006 + 0.994 / (1 + Math.exp(-(lateral - 0.105) / 0.035));
      gate = armHeight * sideGate;
    }
    if (bone.group === 'leftLeg' || bone.group === 'rightLeg') {
      const lateral = bone.side * x;
      const sideGate = 0.012 + 0.988 / (1 + Math.exp(-(lateral - 0.010) / 0.030));
      gate = legHeight * sideGate;
    }
    const score = gate * Math.exp(-0.5 * (distance / bone.sigma) ** 2);
    if (score > 1e-10) candidates.push({ index: boneByName.get(bone.name).index, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 4);
  if (!chosen.length) throw new Error(`No anatomical weights could be assigned at vertex ${vertex}.`);
  dominantCounts[chosen[0].index]++;
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
primitive.setAttribute('JOINTS_0', doc.createAccessor('AshenCarapax_Joints0').setArray(jointValues).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('AshenCarapax_Weights0').setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(buffer));

const quat = (axis, angle) => {
  const sine = Math.sin(angle / 2), cosine = Math.cos(angle / 2);
  if (axis === 'x') return [sine, 0, 0, cosine];
  if (axis === 'y') return [0, sine, 0, cosine];
  return [0, 0, sine, cosine];
};
const multiplyQuat = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const clips = [];
function addClip(name, seconds, tracks) {
  const animation = doc.createAnimation(name);
  for (const track of tracks) {
    const input = doc.createAccessor(`${name}_${track.node}_time`).setArray(Float32Array.from(track.times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const output = doc.createAccessor(`${name}_${track.node}_${track.path ?? 'rotation'}_value`).setArray(Float32Array.from(track.values.flat())).setType(track.path === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4).setBuffer(buffer);
    const sampler = doc.createAnimationSampler(`${name}_${track.node}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${track.node}_${track.path ?? 'rotation'}`).setTargetNode(jointNodes.get(track.node)).setTargetPath(track.path ?? 'rotation').setSampler(sampler));
  }
  clips.push({ name, seconds, channels: tracks.length, tracks });
}
const phases = [0, 0.25, 0.5, 0.75, 1];
const cycle = (axis, phase, amount, base = 0) => phases.map((t) => quat(axis, base + Math.sin((t + phase) * Math.PI * 2) * amount));
addClip('Idle', 2.8, [
  { node: 'mixamorigLeftArm', times: [0, 0.7, 1.4, 2.1, 2.8], values: [quat('z', 0.94), quat('z', 0.96), quat('z', 0.94), quat('z', 0.92), quat('z', 0.94)] },
  { node: 'mixamorigRightArm', times: [0, 0.7, 1.4, 2.1, 2.8], values: [quat('z', -0.94), quat('z', -0.96), quat('z', -0.94), quat('z', -0.92), quat('z', -0.94)] },
  { node: 'mixamorigLeftForeArm', times: [0, 0.7, 1.4, 2.1, 2.8], values: [quat('z', 0.12), quat('z', 0.10), quat('z', 0.12), quat('z', 0.14), quat('z', 0.12)] },
  { node: 'mixamorigRightForeArm', times: [0, 0.7, 1.4, 2.1, 2.8], values: [quat('z', -0.12), quat('z', -0.10), quat('z', -0.12), quat('z', -0.14), quat('z', -0.12)] },
  { node: 'mixamorigSpine1', times: [0, 0.7, 1.4, 2.1, 2.8], values: [quat('x', 0.012), quat('x', -0.012), quat('x', 0.012), quat('x', 0.022), quat('x', 0.012)] },
  { node: 'mixamorigHead', times: [0, 0.7, 1.4, 2.1, 2.8], values: [quat('y', -0.018), quat('y', 0.020), quat('y', 0.035), quat('y', -0.012), quat('y', -0.018)] },
]);
addClip('Walk', 1.0, [
  { node: 'mixamorigHips', path: 'translation', times: phases, values: [[0, 0.445, 0], [0, 0.457, 0], [0, 0.445, 0], [0, 0.457, 0], [0, 0.445, 0]] },
  { node: 'mixamorigLeftUpLeg', times: phases, values: cycle('x', 0, 0.30) },
  { node: 'mixamorigRightUpLeg', times: phases, values: cycle('x', 0.5, 0.30) },
  { node: 'mixamorigLeftLeg', times: phases, values: phases.map((t) => quat('x', -Math.max(0, Math.sin(t * Math.PI * 2)) * 0.24)) },
  { node: 'mixamorigRightLeg', times: phases, values: phases.map((t) => quat('x', -Math.max(0, Math.sin((t + 0.5) * Math.PI * 2)) * 0.24)) },
  { node: 'mixamorigLeftArm', times: phases, values: phases.map((t) => multiplyQuat(quat('z', 0.94), quat('x', Math.sin(t * Math.PI * 2) * 0.14))) },
  { node: 'mixamorigRightArm', times: phases, values: phases.map((t) => multiplyQuat(quat('z', -0.94), quat('x', Math.sin((t + 0.5) * Math.PI * 2) * 0.14))) },
  { node: 'mixamorigSpine1', times: phases, values: phases.map((t) => quat('x', 0.012 + Math.sin(t * Math.PI * 2) * 0.018)) },
]);
// Keep the lowered carapace-arm pose through locomotion while the fore-arms counter-swing.
addClip('Run', 0.72, [
  { node: 'mixamorigHips', path: 'translation', times: phases.map((t) => t * 0.72), values: [[0, 0.445, 0], [0, 0.472, 0], [0, 0.445, 0], [0, 0.472, 0], [0, 0.445, 0]] },
  { node: 'mixamorigLeftUpLeg', times: phases.map((t) => t * 0.72), values: cycle('x', 0, 0.56) },
  { node: 'mixamorigRightUpLeg', times: phases.map((t) => t * 0.72), values: cycle('x', 0.5, 0.56) },
  { node: 'mixamorigLeftLeg', times: phases.map((t) => t * 0.72), values: phases.map((t) => quat('x', -Math.max(0, Math.sin(t * Math.PI * 2)) * 0.48)) },
  { node: 'mixamorigRightLeg', times: phases.map((t) => t * 0.72), values: phases.map((t) => quat('x', -Math.max(0, Math.sin((t + 0.5) * Math.PI * 2)) * 0.48)) },
  { node: 'mixamorigLeftArm', times: phases.map((t) => t * 0.72), values: phases.map((t) => multiplyQuat(quat('z', 0.94), quat('x', Math.sin(t * Math.PI * 2) * 0.28))) },
  { node: 'mixamorigRightArm', times: phases.map((t) => t * 0.72), values: phases.map((t) => multiplyQuat(quat('z', -0.94), quat('x', Math.sin((t + 0.5) * Math.PI * 2) * 0.28))) },
  { node: 'mixamorigLeftForeArm', times: phases.map((t) => t * 0.72), values: phases.map(() => quat('z', 0.15)) },
  { node: 'mixamorigRightForeArm', times: phases.map((t) => t * 0.72), values: phases.map(() => quat('z', -0.15)) },
  { node: 'mixamorigSpine1', times: phases.map((t) => t * 0.72), values: phases.map((t) => quat('x', 0.025 + Math.sin(t * Math.PI * 2) * 0.028)) },
]);
addClip('Attack', 0.96, [
  { node: 'mixamorigHips', path: 'translation', times: [0, 0.18, 0.46, 0.70, 0.96], values: [[0, 0.445, 0], [0, 0.445, -0.012], [0, 0.445, 0.035], [0, 0.445, 0.015], [0, 0.445, 0]] },
  { node: 'mixamorigSpine1', times: [0, 0.18, 0.46, 0.70, 0.96], values: [quat('y', 0), quat('y', -0.18), quat('y', 0.30), quat('y', 0.12), quat('y', 0)] },
  { node: 'mixamorigSpine2', times: [0, 0.18, 0.46, 0.70, 0.96], values: [quat('x', 0), quat('x', -0.12), quat('x', 0.06), quat('x', 0.04), quat('x', 0)] },
  { node: 'mixamorigRightArm', times: [0, 0.18, 0.46, 0.70, 0.96], values: [quat('z', -0.94), quat('z', -0.10), quat('z', -1.34), quat('z', -0.46), quat('z', -0.94)] },
  { node: 'mixamorigRightForeArm', times: [0, 0.18, 0.46, 0.70, 0.96], values: [quat('z', -0.12), quat('z', -0.36), quat('z', 0.34), quat('z', -0.18), quat('z', -0.12)] },
  { node: 'mixamorigLeftArm', times: [0, 0.18, 0.46, 0.70, 0.96], values: [quat('z', 0.94), quat('z', 0.48), quat('z', 0.75), quat('z', 0.86), quat('z', 0.94)] },
  { node: 'mixamorigLeftForeArm', times: [0, 0.18, 0.46, 0.70, 0.96], values: [quat('z', 0.12), quat('z', 0.22), quat('z', -0.22), quat('z', 0.08), quat('z', 0.12)] },
]);
addClip('Hit', 0.48, [
  { node: 'mixamorigHips', path: 'translation', times: [0, 0.08, 0.22, 0.48], values: [[0, 0.445, 0], [0, 0.445, -0.030], [0, 0.445, -0.008], [0, 0.445, 0]] },
  { node: 'mixamorigSpine1', times: [0, 0.08, 0.22, 0.48], values: [quat('x', 0), quat('x', -0.22), quat('x', 0.08), quat('x', 0)] },
  { node: 'mixamorigSpine2', times: [0, 0.08, 0.22, 0.48], values: [quat('z', 0), quat('z', 0.16), quat('z', -0.07), quat('z', 0)] },
  { node: 'mixamorigLeftArm', times: [0, 0.08, 0.22, 0.48], values: [quat('z', 0.94), multiplyQuat(quat('z', 0.42), quat('x', -0.16)), multiplyQuat(quat('z', 0.82), quat('x', 0.06)), quat('z', 0.94)] },
  { node: 'mixamorigRightArm', times: [0, 0.08, 0.22, 0.48], values: [quat('z', -0.94), multiplyQuat(quat('z', -0.40), quat('x', 0.20)), multiplyQuat(quat('z', -0.82), quat('x', -0.08)), quat('z', -0.94)] },
  { node: 'mixamorigHead', times: [0, 0.08, 0.22, 0.48], values: [quat('x', 0), quat('x', -0.12), quat('x', 0.04), quat('x', 0)] },
]);
addClip('Death', 1.55, [
  { node: 'mixamorigHips', path: 'translation', times: [0, 0.24, 0.70, 1.12, 1.55], values: [[0, 0.445, 0], [0, 0.445, 0], [0, 0.445, -0.010], [0, 0.445, -0.015], [0, 0.445, -0.015]] },
  { node: 'mixamorigSpine1', times: [0, 0.24, 0.70, 1.12, 1.55], values: [quat('x', 0), quat('x', 0.16), quat('x', 0.52), quat('x', 0.84), quat('x', 0.84)] },
  { node: 'mixamorigSpine2', times: [0, 0.24, 0.70, 1.12, 1.55], values: [quat('x', 0), quat('x', 0.08), quat('x', 0.24), quat('x', 0.38), quat('x', 0.38)] },
  { node: 'mixamorigHead', times: [0, 0.24, 0.70, 1.12, 1.55], values: [quat('x', 0), quat('x', 0.08), quat('x', 0.18), quat('x', 0.28), quat('x', 0.28)] },
  { node: 'mixamorigLeftArm', times: [0, 0.24, 0.70, 1.12, 1.55], values: [quat('z', 0.94), quat('z', 0.62), quat('z', 0.48), quat('z', 0.56), quat('z', 0.56)] },
  { node: 'mixamorigRightArm', times: [0, 0.24, 0.70, 1.12, 1.55], values: [quat('z', -0.94), quat('z', -0.66), quat('z', -0.50), quat('z', -0.58), quat('z', -0.58)] },
]);

const sourceTextureMetrics = [];
const originalMaterials = root.listMaterials().map((material) => ({
  name: material.getName(), metallic: material.getMetallicFactor(), roughness: material.getRoughnessFactor(),
  normalScale: material.getNormalScale(), baseColorFactor: material.getBaseColorFactor(),
}));
const sourceTextureBytes = new Map();
for (const texture of root.listTextures()) {
  const image = texture.getImage();
  const metadata = await sharp(image).metadata();
  const metrics = { name: texture.getName(), width: metadata.width, height: metadata.height, mimeType: texture.getMimeType(), sha256: createHash('sha256').update(image).digest('hex') };
  sourceTextureMetrics.push(metrics);
  sourceTextureBytes.set(texture.getName(), image);
}
const material = root.listMaterials()[0];
if (!material?.getBaseColorTexture() || !material.getMetallicRoughnessTexture() || !material.getNormalTexture()) {
  throw new Error('Source must retain embedded base-color, metallic-roughness and normal PBR maps.');
}
await io.write(candidatePath, doc);

const candidateBytes = await readFile(candidatePath);
const candidateSha256 = createHash('sha256').update(candidateBytes).digest('hex');
const verified = await io.readBinary(candidateBytes);
const verifiedRoot = verified.getRoot();
const verifiedPrimitive = verifiedRoot.listMeshes()[0].listPrimitives()[0];
const readTyped = (semantic) => verifiedPrimitive.getAttribute(semantic)?.getArray();
const sameArray = (expected, actual) => expected.length === actual.length && expected.every((value, i) => value === actual[i]);
if (!sameArray(positions, readTyped('POSITION')) || !sameArray(normals, readTyped('NORMAL')) || !sameArray(uvs, readTyped('TEXCOORD_0')) || !sameArray(indices, verifiedPrimitive.getIndices().getArray())) {
  throw new Error('Candidate changed source positions, normals, UVs or triangle indices.');
}
const verifiedWeights = verifiedPrimitive.getAttribute('WEIGHTS_0').getArray();
const verifiedJoints = verifiedPrimitive.getAttribute('JOINTS_0').getArray();
let verifiedWeightError = 0;
const verifiedInfluenceCounts = new Array(bones.length).fill(0);
for (let vertex = 0; vertex < verifiedWeights.length / 4; vertex++) {
  let sum = 0;
  for (let influence = 0; influence < 4; influence++) {
    const weight = verifiedWeights[vertex * 4 + influence];
    const joint = verifiedJoints[vertex * 4 + influence];
    sum += weight;
    if (weight > 1e-6) verifiedInfluenceCounts[joint]++;
  }
  verifiedWeightError = Math.max(verifiedWeightError, Math.abs(sum - 1));
}
const outputTextureMetrics = [];
for (const texture of verifiedRoot.listTextures()) {
  const image = texture.getImage();
  const metadata = await sharp(image).metadata();
  outputTextureMetrics.push({ name: texture.getName(), width: metadata.width, height: metadata.height, mimeType: texture.getMimeType(), sha256: createHash('sha256').update(image).digest('hex'), unchanged: sourceTextureBytes.has(texture.getName()) && Buffer.from(sourceTextureBytes.get(texture.getName())).equals(Buffer.from(image)) });
}
const animationMetrics = verifiedRoot.listAnimations().map((animation) => ({ name: animation.getName(), samplers: animation.listSamplers().length, channels: animation.listChannels().length, duration: Math.max(...animation.listSamplers().map((sampler) => sampler.getInput()?.getArray()?.at(-1) ?? 0)) }));
const requiredClips = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
if (JSON.stringify(animationMetrics.map((clip) => clip.name)) !== JSON.stringify(requiredClips) || animationMetrics.some((clip) => clip.channels < 5)) {
  throw new Error(`Missing required motion clips or channels: ${JSON.stringify(animationMetrics)}`);
}
const { Matrix4, Quaternion, Vector3 } = await import('three');
function sampleTrack(track, time) {
  const values = track.values;
  if (time <= track.times[0]) return values[0];
  if (time >= track.times.at(-1)) return values.at(-1);
  let next = 1;
  while (track.times[next] < time) next++;
  const before = next - 1;
  const amount = (time - track.times[before]) / (track.times[next] - track.times[before]);
  if (track.path !== 'translation') {
    const a = new Quaternion(...values[before]);
    const b = new Quaternion(...values[next]);
    return a.slerp(b, amount).normalize().toArray();
  }
  return values[before].map((value, axis) => value + (values[next][axis] - value) * amount);
}
function transformPoint(point, matrix) {
  const m = matrix.elements, [x, y, z] = point;
  const w = 1 / (m[3] * x + m[7] * y + m[11] * z + m[15]);
  return [(m[0] * x + m[4] * y + m[8] * z + m[12]) * w, (m[1] * x + m[5] * y + m[9] * z + m[13]) * w, (m[2] * x + m[6] * y + m[10] * z + m[14]) * w];
}
const motionProof = [];
for (const clip of clips) {
  const samples = [];
  for (const fraction of [0.25, 0.5, 0.75]) {
    const time = clip.seconds * fraction;
    const translations = new Map();
    const rotations = new Map();
    for (const track of clip.tracks) {
      const value = sampleTrack(track, time);
      (track.path === 'translation' ? translations : rotations).set(track.node, value);
    }
    const world = new Map();
    for (const bone of bones) {
      const translation = translations.get(bone.name) ?? bone.local;
      const rotation = rotations.get(bone.name) ?? [0, 0, 0, 1];
      const localMatrix = new Matrix4().compose(new Vector3(...translation), new Quaternion(...rotation), new Vector3(1, 1, 1));
      const parent = bone.parent ? world.get(bone.parent) : new Matrix4();
      world.set(bone.name, parent.clone().multiply(localMatrix));
    }
    const skinMatrices = bones.map((bone) => world.get(bone.name).clone().multiply(new Matrix4().makeTranslation(-bone.p[0], -bone.p[1], -bone.p[2])));
    let sumSquared = 0, maxDisplacement = 0, minY = Infinity, maxY = -Infinity;
    for (let vertex = 0; vertex < positions.length / 3; vertex++) {
      const original = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
      let current = [0, 0, 0];
      for (let slot = 0; slot < 4; slot++) {
        const weight = verifiedWeights[vertex * 4 + slot];
        if (weight <= 0) continue;
        const transformed = transformPoint(original, skinMatrices[verifiedJoints[vertex * 4 + slot]]);
        current[0] += transformed[0] * weight; current[1] += transformed[1] * weight; current[2] += transformed[2] * weight;
      }
      const dx = (current[0] - original[0]) * modelScale;
      const dy = (current[1] - original[1]) * modelScale;
      const dz = (current[2] - original[2]) * modelScale;
      const displacement = Math.hypot(dx, dy, dz);
      sumSquared += displacement * displacement;
      maxDisplacement = Math.max(maxDisplacement, displacement);
      minY = Math.min(minY, current[1] * modelScale);
      maxY = Math.max(maxY, current[1] * modelScale);
    }
    samples.push({ fraction, rmsDisplacementMeters: Math.sqrt(sumSquared / (positions.length / 3)), maxDisplacementMeters: maxDisplacement, minY, maxY });
  }
  motionProof.push({ name: clip.name, samples, maximumRmsDisplacementMeters: Math.max(...samples.map((sample) => sample.rmsDisplacementMeters)) });
}
if (motionProof.some((clip) => clip.maximumRmsDisplacementMeters < 0.015)) throw new Error(`A clip does not deform the weighted mesh: ${JSON.stringify(motionProof)}`);
if (verifiedRoot.listSkins().length !== 1 || verifiedRoot.listSkins()[0].listJoints().length !== bones.length || verifiedWeightError > 1e-6 || verifiedInfluenceCounts.some((count) => count === 0)) {
  throw new Error('Candidate rig or normalized four-influence vertex weights failed validation.');
}
if (outputTextureMetrics.some((texture) => !texture.unchanged) || originalMaterials.length !== verifiedRoot.listMaterials().length) {
  throw new Error('Candidate PBR maps or material slots changed.');
}
const scaledBounds = { min: bounds.min.map((value) => value * modelScale), max: bounds.max.map((value) => value * modelScale) };
const rigRows = bones.map((bone, i) => ({ name: bone.name, parent: bone.parent, position: bone.p, dominantVertices: dominantCounts[i], weightedVertexInfluences: verifiedInfluenceCounts[i] }));
const candidateReport = {
  schema: 'corealm-creature-native-rig-candidate/1', id: 'creature_ashen_carapax', displayName: 'Ashen Carapax', status: 'awaiting-root-lab-review', accepted: false,
  source: { file: sourcePath, sha256: sourceSha256, bytes: sourceBytes.byteLength, starredModelId: 'e75eed94-f770-4fc3-83f2-d812e898b0ee', starredCardId: '3c2e7cf1-8b90-4ae5-b1ef-7c21ed5a84b8', starred: true, starredDisplayName: 'demon creature 3d model', prompt: 'demon creature with jagged armored exoskeleton, horned helmet, red eyes, dark gray texture, beige spikes, muscular build, fantasy monster', generator: 'Tripo P1.0', textureResolution: '2K PBR', geometry: { vertices: positions.length / 3, triangles: indices.length / 3, bounds, positionsPreserved: true, normalsPreserved: true, uvsPreserved: true, indicesPreserved: true, retopology: false, modelScale }, sourceSkin: { joints: sourceJointCount, rootWeightedVertices: rootOnlyVertices.size, totalVertices: positions.length / 3, repaired: true }, sourceAnimations: [], textures: sourceTextureMetrics, materials: originalMaterials },
  candidate: { file: candidatePath, sha256: candidateSha256, bytes: candidateBytes.byteLength, geometry: { vertices: positions.length / 3, triangles: indices.length / 3, boundsMeters: scaledBounds, positionsPreserved: true, normalsPreserved: true, uvsPreserved: true, indicesPreserved: true }, rig: { type: '22-joint Mixamo-named humanoid glTF skin for Unity Humanoid mapping review', joints: rigRows, influencesPerVertex: 4, verticesWithDistributedWeights: verifiedWeights.length / 4, perJointVertexInfluences: Object.fromEntries(bones.map((bone, i) => [bone.name, verifiedInfluenceCounts[i]])), maximumWeightSumError: verifiedWeightError, method: 'Replaced the root-only P1 skin with spatially gated anatomical distance weights in the source mesh basis; source geometry, UVs and textures stay unchanged.' }, textures: outputTextureMetrics, animations: animationMetrics, motionProof, productionTarget: 'game/public/assets/models/creature/creature_ashen_carapax.glb' },
  acceptance: { imageAudit: 'starred-by-user', rigAccepted: false, animationAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${baseDir}/catalog.json`, `${JSON.stringify(candidateReport, null, 2)}\n`);
await writeFile(`${baseDir}/validation.json`, `${JSON.stringify(candidateReport, null, 2)}\n`);
const labAsset = {
  id: candidateReport.id,
  file: 'models/creature/creature_ashen_carapax.glb', pack: 'corealm-starred-creatures', category: 'character', is: candidateReport.displayName,
  tags: ['creature', 'humanoid', 'demon', 'wilderness', 'T40+', 'starred', 'tripo', 'candidate'],
  bytes: candidateBytes.byteLength, sha256: candidateSha256,
  size: { x: scaledBounds.max[0] - scaledBounds.min[0], y: scaledBounds.max[1] - scaledBounds.min[1], z: scaledBounds.max[2] - scaledBounds.min[2] },
  base: { x: scaledBounds.min[0], y: scaledBounds.min[1], z: scaledBounds.min[2] }, bounds: scaledBounds, groundY: 0,
  triangles: indices.length / 3, animations: requiredClips, materials: verifiedRoot.listMaterials().map((entry) => entry.getName()),
  sourceProvenance: { author: 'Corealm candidate rig reconstruction', sourceModelId: candidateReport.source.starredModelId, sourceCardId: candidateReport.source.starredCardId, sourceFile: sourcePath, sourceSha256, candidateFile: candidatePath, candidateSha256, rigMethod: candidateReport.candidate.rig.method, textures: outputTextureMetrics, candidateStatus: 'awaiting-root-lab-review' },
  acceptance: { assetAudit: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${baseDir}/lab-catalog.json`, `${JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', assets: [labAsset], files: { [candidateReport.id]: 'ashen-carapax-native-rig-candidate.glb' } }, null, 2)}\n`);
console.log(JSON.stringify({ candidate: candidatePath, candidateSha256, candidateBytes: candidateBytes.byteLength, joints: bones.length, animations: animationMetrics, maximumWeightSumError: verifiedWeightError, textures: outputTextureMetrics }, null, 2));
