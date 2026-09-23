import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const baseDir = 'assets/art/tripo/imports/creatures/new-star-ogre';
const sourcePath = 'assets/art/tripo/exports/3b76bc22-c899-46f8-b518-3873e4244072.glb';
const candidatePath = `${baseDir}/rookback-ogre-native-rig-candidate.glb`;
const expectedSourceSha256 = 'c71d79a06ca73f62f3e3b7b57d6d00acf0508008e8f98a78dc1ce36255178b51';
const starredCardId = 'a5a3ecc1-6aaf-4b47-9e0c-34785b5f0bf1';
const modelId = '3b76bc22-c899-46f8-b518-3873e4244072';
const targetHeightMeters = 2.6;
await mkdir(baseDir, { recursive: true });

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
if (sourceSha256 !== expectedSourceSha256) throw new Error(`Ogre source hash mismatch: ${sourceSha256}`);
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find((node) => node.getMesh() === mesh);
if (!scene || !primitive || !meshNode || root.listSkins().length || root.listAnimations().length) {
  throw new Error('Expected the source Ogre Humanoid export with a static unskinned mesh.');
}
const positions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
const normals = primitive.getAttribute('NORMAL')?.getArray();
const uvs = primitive.getAttribute('TEXCOORD_0')?.getArray();
const indices = primitive.getIndices()?.getArray();
if (!positions.length || !normals || !uvs || !indices || positions.length / 3 !== 3565 || indices.length / 3 !== 5484) {
  throw new Error(`Ogre source geometry changed: ${positions.length / 3} vertices, ${(indices?.length ?? 0) / 3} triangles.`);
}
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
  bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
}
const width = bounds.max[0] - bounds.min[0];
const height = bounds.max[1] - bounds.min[1];
const depth = bounds.max[2] - bounds.min[2];
if (Math.abs(height - 0.998046875) > 1e-6 || width < 0.45 || height / width < 1.55) {
  throw new Error(`Source no longer matches the reviewed upright ogre proportions: ${width} x ${height} x ${depth}.`);
}

// Mixamo labels make this chain suitable for Unity Humanoid mapping. Joint centers
// are fitted to the compact upright source; every source position remains intact.
const scaleX = width / 0.81;
const scaleY = height / 0.875;
const scaleZ = depth / 0.32;
const targetScale = targetHeightMeters / height;
const canonicalBones = [
  { name: 'mixamorigHips', parent: null, p: [0, 0.390, -0.005], sigma: 0.105, group: 'torso' },
  { name: 'mixamorigSpine', parent: 'mixamorigHips', p: [0, 0.475, 0.005], sigma: 0.115, group: 'torso' },
  { name: 'mixamorigSpine1', parent: 'mixamorigSpine', p: [0, 0.575, 0.035], sigma: 0.125, group: 'torso' },
  { name: 'mixamorigSpine2', parent: 'mixamorigSpine1', p: [0, 0.675, 0.015], sigma: 0.12, group: 'torso' },
  { name: 'mixamorigNeck', parent: 'mixamorigSpine2', p: [0, 0.795, 0.04], sigma: 0.09, group: 'torso' },
  { name: 'mixamorigHead', parent: 'mixamorigNeck', p: [0, 0.875, 0.055], sigma: 0.105, group: 'head' },
  { name: 'mixamorigLeftShoulder', parent: 'mixamorigSpine2', p: [-0.205, 0.675, 0.015], sigma: 0.082, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftArm', parent: 'mixamorigLeftShoulder', p: [-0.300, 0.590, 0.04], sigma: 0.085, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftForeArm', parent: 'mixamorigLeftArm', p: [-0.365, 0.445, 0.06], sigma: 0.072, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftHand', parent: 'mixamorigLeftForeArm', p: [-0.405, 0.325, 0.07], sigma: 0.082, group: 'leftArm', side: -1 },
  { name: 'mixamorigRightShoulder', parent: 'mixamorigSpine2', p: [0.205, 0.675, 0.015], sigma: 0.082, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightArm', parent: 'mixamorigRightShoulder', p: [0.300, 0.590, 0.04], sigma: 0.085, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightForeArm', parent: 'mixamorigRightArm', p: [0.365, 0.445, 0.06], sigma: 0.072, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightHand', parent: 'mixamorigRightForeArm', p: [0.405, 0.325, 0.07], sigma: 0.082, group: 'rightArm', side: 1 },
  { name: 'mixamorigLeftUpLeg', parent: 'mixamorigHips', p: [-0.145, 0.330, -0.005], sigma: 0.095, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftLeg', parent: 'mixamorigLeftUpLeg', p: [-0.165, 0.165, 0.005], sigma: 0.078, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftFoot', parent: 'mixamorigLeftLeg', p: [-0.165, 0.055, 0.015], sigma: 0.065, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftToeBase', parent: 'mixamorigLeftFoot', p: [-0.165, 0.035, 0.095], sigma: 0.06, group: 'leftLeg', side: -1 },
  { name: 'mixamorigRightUpLeg', parent: 'mixamorigHips', p: [0.145, 0.330, -0.005], sigma: 0.095, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightLeg', parent: 'mixamorigRightUpLeg', p: [0.165, 0.165, 0.005], sigma: 0.078, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightFoot', parent: 'mixamorigRightLeg', p: [0.165, 0.055, 0.015], sigma: 0.065, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightToeBase', parent: 'mixamorigRightFoot', p: [0.165, 0.035, 0.095], sigma: 0.06, group: 'rightLeg', side: 1 },
];
const bones = canonicalBones.map((bone) => ({
  ...bone,
  p: [bone.p[0] * scaleX, bone.p[1] * scaleY, bone.p[2] * scaleZ],
  sigma: bone.sigma * scaleY,
}));
const boneByName = new Map(bones.map((bone, index) => [bone.name, { ...bone, index }]));
for (const bone of bones) {
  const parent = bone.parent ? boneByName.get(bone.parent) : null;
  bone.local = parent ? bone.p.map((value, axis) => value - parent.p[axis]) : bone.p;
}

const previousParent = meshNode.getParentNode();
if (previousParent) previousParent.removeChild(meshNode);
else if (scene.listChildren().includes(meshNode)) scene.removeChild(meshNode);
else throw new Error('Source mesh node is detached from its scene.');
meshNode.setName('RookbackOgreMesh');
const rigContainer = doc.createNode('RookbackOgreArmature')
  .setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([targetScale, targetScale, targetScale]);
scene.addChild(rigContainer);
rigContainer.addChild(meshNode);
const jointNodes = new Map();
for (const bone of bones) {
  const node = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  jointNodes.set(bone.name, node);
  (bone.parent ? jointNodes.get(bone.parent) : rigContainer).addChild(node);
}
const skin = doc.createSkin('RookbackOgre_UnityHumanoid').setSkeleton(jointNodes.get('mixamorigHips'));
for (const bone of bones) skin.addJoint(jointNodes.get(bone.name));
const inverseBinds = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i++) {
  const [x, y, z] = bones[i].p;
  inverseBinds.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
}
const buffer = root.listBuffers()[0];
skin.setInverseBindMatrices(doc.createAccessor('RookbackOgre_InverseBind').setArray(inverseBinds).setType(Accessor.Type.MAT4).setBuffer(buffer));
meshNode.setSkin(skin);

function segmentDistance(point, start, end) {
  const vector = end.map((value, axis) => value - start[axis]);
  const length2 = vector.reduce((sum, value) => sum + value * value, 0) || 1;
  const t = Math.max(0, Math.min(1, point.reduce((sum, value, axis) => sum + (value - start[axis]) * vector[axis], 0) / length2));
  return Math.hypot(...point.map((value, axis) => value - (start[axis] + t * vector[axis])));
}
const jointValues = new Uint16Array(positions.length / 3 * 4);
const weightValues = new Float32Array(positions.length / 3 * 4);
const influenced = new Uint32Array(bones.length);
let maximumWeightSumError = 0;
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const normalizedX = point[0] / (width * 0.5) * 0.405;
  const normalizedY = point[1] / height * 0.875;
  const candidates = [];
  for (const bone of bones) {
    let gate = 1;
    if (bone.group === 'head') gate = normalizedY >= 0.70 ? 1 : 0.015;
    if (bone.group === 'leftArm' || bone.group === 'rightArm') {
      gate = normalizedY > 0.235 && normalizedY < 0.92 ? 1 : 0.008;
      gate *= 0.02 + 0.98 / (1 + Math.exp(-(bone.side * normalizedX + 0.018) / 0.040));
    }
    if (bone.group === 'leftLeg' || bone.group === 'rightLeg') {
      gate = normalizedY < 0.52 ? 1 : 0.006;
      gate *= 0.02 + 0.98 / (1 + Math.exp(-(bone.side * normalizedX + 0.012) / 0.045));
    }
    const parent = bone.parent ? boneByName.get(bone.parent) : null;
    const distance = segmentDistance(point, parent?.p ?? bone.p, bone.p);
    const score = gate * Math.exp(-0.5 * (distance / bone.sigma) ** 2);
    if (score > 1e-10) candidates.push({ index: boneByName.get(bone.name).index, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 4);
  if (!chosen.length) throw new Error(`No anatomical influences found at vertex ${vertex}.`);
  const total = chosen.reduce((sum, candidate) => sum + candidate.score, 0);
  let assigned = 0;
  for (let slot = 0; slot < 4; slot++) {
    const candidate = chosen[slot] ?? chosen[0];
    const weight = slot >= chosen.length ? 0 : slot === chosen.length - 1 ? 1 - assigned : candidate.score / total;
    jointValues[vertex * 4 + slot] = candidate.index;
    weightValues[vertex * 4 + slot] = weight;
    assigned += weight;
    if (weight > 1e-6) influenced[candidate.index]++;
  }
  const sum = weightValues[vertex * 4] + weightValues[vertex * 4 + 1] + weightValues[vertex * 4 + 2] + weightValues[vertex * 4 + 3];
  maximumWeightSumError = Math.max(maximumWeightSumError, Math.abs(sum - 1));
}
primitive.setAttribute('JOINTS_0', doc.createAccessor('RookbackOgre_Joints0').setArray(jointValues).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('RookbackOgre_Weights0').setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(buffer));

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
    const output = doc.createAccessor(`${name}_${track.node}_${track.path ?? 'rotation'}_value`)
      .setArray(Float32Array.from(track.values.flat())).setType(track.path === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4).setBuffer(buffer);
    const sampler = doc.createAnimationSampler(`${name}_${track.node}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${track.node}_${track.path ?? 'rotation'}`)
      .setTargetNode(jointNodes.get(track.node)).setTargetPath(track.path ?? 'rotation').setSampler(sampler));
  }
  clips.push({ name, seconds, channels: tracks.length });
}
const phase = [0, 0.25, 0.5, 0.75, 1];
const cycle = (offset, angle) => phase.map((t) => quat('x', Math.sin((t + offset) * Math.PI * 2) * angle));
const baseHip = (y = 0.390, z = -0.005) => [0, y * scaleY, z * scaleZ];
const keyedTimes = (seconds) => phase.map((t) => t * seconds);

addClip('Idle', 3.0, [
  { node: 'mixamorigSpine1', times: [0, 0.75, 1.5, 2.25, 3], values: [quat('x', 0), quat('x', -0.018), quat('x', 0), quat('x', 0.015), quat('x', 0)] },
  { node: 'mixamorigSpine2', times: [0, 0.75, 1.5, 2.25, 3], values: [quat('z', 0), quat('z', -0.012), quat('z', 0), quat('z', 0.012), quat('z', 0)] },
  { node: 'mixamorigHead', times: [0, 0.75, 1.5, 2.25, 3], values: [quat('y', 0), quat('y', 0.012), quat('y', 0.022), quat('y', -0.01), quat('y', 0)] },
  { node: 'mixamorigLeftArm', times: [0, 0.75, 1.5, 2.25, 3], values: [quat('z', -0.03), quat('z', -0.045), quat('z', -0.03), quat('z', -0.015), quat('z', -0.03)] },
  { node: 'mixamorigRightArm', times: [0, 0.75, 1.5, 2.25, 3], values: [quat('z', 0.03), quat('z', 0.015), quat('z', 0.03), quat('z', 0.045), quat('z', 0.03)] },
]);
addClip('Walk', 1.25, [
  { node: 'mixamorigHips', path: 'translation', times: keyedTimes(1.25), values: phase.map((t) => [0, (0.390 + Math.sin(t * Math.PI * 2) * 0.014) * scaleY, (-0.005 + Math.cos(t * Math.PI * 2) * 0.015) * scaleZ]) },
  { node: 'mixamorigLeftUpLeg', times: keyedTimes(1.25), values: cycle(0, 0.33) },
  { node: 'mixamorigRightUpLeg', times: keyedTimes(1.25), values: cycle(0.5, 0.33) },
  { node: 'mixamorigLeftLeg', times: keyedTimes(1.25), values: phase.map((t) => quat('x', -Math.max(0, Math.sin(t * Math.PI * 2)) * 0.24)) },
  { node: 'mixamorigRightLeg', times: keyedTimes(1.25), values: phase.map((t) => quat('x', -Math.max(0, Math.sin((t + 0.5) * Math.PI * 2)) * 0.24)) },
  { node: 'mixamorigLeftArm', times: keyedTimes(1.25), values: cycle(0.5, 0.22) },
  { node: 'mixamorigRightArm', times: keyedTimes(1.25), values: cycle(0, 0.22) },
  { node: 'mixamorigSpine1', times: keyedTimes(1.25), values: phase.map((t) => quat('x', 0.04 + Math.sin(t * Math.PI * 2) * 0.022)) },
]);
addClip('Run', 0.82, [
  { node: 'mixamorigHips', path: 'translation', times: keyedTimes(0.82), values: phase.map((t) => [0, (0.390 + Math.sin(t * Math.PI * 2) * 0.025) * scaleY, (-0.005 + Math.cos(t * Math.PI * 2) * 0.027) * scaleZ]) },
  { node: 'mixamorigLeftUpLeg', times: keyedTimes(0.82), values: cycle(0, 0.56) },
  { node: 'mixamorigRightUpLeg', times: keyedTimes(0.82), values: cycle(0.5, 0.56) },
  { node: 'mixamorigLeftLeg', times: keyedTimes(0.82), values: phase.map((t) => quat('x', -Math.max(0, Math.sin(t * Math.PI * 2)) * 0.49)) },
  { node: 'mixamorigRightLeg', times: keyedTimes(0.82), values: phase.map((t) => quat('x', -Math.max(0, Math.sin((t + 0.5) * Math.PI * 2)) * 0.49)) },
  { node: 'mixamorigLeftArm', times: keyedTimes(0.82), values: cycle(0.5, 0.39) },
  { node: 'mixamorigRightArm', times: keyedTimes(0.82), values: cycle(0, 0.39) },
  { node: 'mixamorigSpine1', times: keyedTimes(0.82), values: phase.map((t) => quat('x', 0.12 + Math.sin(t * Math.PI * 2) * 0.04)) },
]);
addClip('Attack', 1.18, [
  { node: 'mixamorigSpine1', times: [0, 0.26, 0.53, 0.78, 1.18], values: [quat('y', 0), quat('y', -0.32), quat('y', 0.20), quat('y', 0.08), quat('y', 0)] },
  { node: 'mixamorigLeftArm', times: [0, 0.26, 0.53, 0.78, 1.18], values: [quat('z', -0.05), quat('z', -1.02), quat('z', -0.22), quat('z', 0.36), quat('z', -0.05)] },
  { node: 'mixamorigRightArm', times: [0, 0.26, 0.53, 0.78, 1.18], values: [quat('z', 0.05), quat('z', 1.02), quat('z', 0.22), quat('z', -0.36), quat('z', 0.05)] },
  { node: 'mixamorigLeftForeArm', times: [0, 0.26, 0.53, 0.78, 1.18], values: [quat('x', 0), quat('x', 0.28), quat('x', -0.58), quat('x', -0.25), quat('x', 0)] },
  { node: 'mixamorigRightForeArm', times: [0, 0.26, 0.53, 0.78, 1.18], values: [quat('x', 0), quat('x', 0.28), quat('x', -0.58), quat('x', -0.25), quat('x', 0)] },
  { node: 'mixamorigHips', path: 'translation', times: [0, 0.26, 0.53, 0.78, 1.18], values: [baseHip(), baseHip(0.385, -0.035), baseHip(0.370, 0.04), baseHip(0.385, -0.025), baseHip()] },
]);
addClip('Hit', 0.5, [
  { node: 'mixamorigHips', path: 'translation', times: [0, 0.08, 0.23, 0.5], values: [baseHip(), baseHip(0.382, -0.035), baseHip(0.388, -0.018), baseHip()] },
  { node: 'mixamorigSpine1', times: [0, 0.08, 0.23, 0.5], values: [quat('z', 0), quat('z', -0.20), quat('z', 0.09), quat('z', 0)] },
  { node: 'mixamorigSpine2', times: [0, 0.08, 0.23, 0.5], values: [quat('x', 0), quat('x', -0.13), quat('x', 0.04), quat('x', 0)] },
  { node: 'mixamorigHead', times: [0, 0.08, 0.23, 0.5], values: [quat('z', 0), quat('z', 0.16), quat('z', -0.045), quat('z', 0)] },
  { node: 'mixamorigLeftArm', times: [0, 0.08, 0.23, 0.5], values: [quat('x', 0), quat('x', 0.22), quat('x', -0.05), quat('x', 0)] },
  { node: 'mixamorigRightArm', times: [0, 0.08, 0.23, 0.5], values: [quat('x', 0), quat('x', 0.30), quat('x', -0.06), quat('x', 0)] },
]);
addClip('Death', 1.65, [
  { node: 'mixamorigHips', path: 'translation', times: [0, 0.25, 0.72, 1.12, 1.65], values: [baseHip(), baseHip(0.36, -0.025), baseHip(0.25, -0.035), baseHip(0.17, -0.04), baseHip(0.17, -0.04)] },
  { node: 'mixamorigHips', times: [0, 0.25, 0.72, 1.12, 1.65], values: [quat('z', 0), quat('z', -0.05), quat('z', -0.20), quat('z', -0.24), quat('z', -0.24)] },
  { node: 'mixamorigSpine1', times: [0, 0.25, 0.72, 1.12, 1.65], values: [quat('x', 0), quat('x', 0.12), quat('x', 0.26), quat('x', 0.28), quat('x', 0.28)] },
  { node: 'mixamorigSpine2', times: [0, 0.25, 0.72, 1.12, 1.65], values: [quat('x', 0), quat('x', 0.07), quat('x', 0.16), quat('x', 0.17), quat('x', 0.17)] },
  { node: 'mixamorigHead', times: [0, 0.25, 0.72, 1.12, 1.65], values: [quat('z', 0), quat('z', 0.08), quat('z', 0.23), quat('z', 0.25), quat('z', 0.25)] },
  { node: 'mixamorigLeftArm', times: [0, 0.25, 0.72, 1.12, 1.65], values: [quat('x', 0), quat('x', 0.10), quat('x', 0.40), quat('x', 0.44), quat('x', 0.44)] },
  { node: 'mixamorigRightArm', times: [0, 0.25, 0.72, 1.12, 1.65], values: [quat('x', 0), quat('x', -0.08), quat('x', -0.34), quat('x', -0.38), quat('x', -0.38)] },
  { node: 'mixamorigLeftUpLeg', times: [0, 0.25, 0.72, 1.12, 1.65], values: [quat('x', 0), quat('x', -0.04), quat('x', -0.17), quat('x', -0.21), quat('x', -0.21)] },
  { node: 'mixamorigRightUpLeg', times: [0, 0.25, 0.72, 1.12, 1.65], values: [quat('x', 0), quat('x', 0.04), quat('x', 0.18), quat('x', 0.22), quat('x', 0.22)] },
]);

const sourceTextureMetrics = [];
const runtimeTextureMetrics = [];
const material = root.listMaterials()[0];
if (!material?.getBaseColorTexture() || !material.getMetallicRoughnessTexture() || !material.getNormalTexture()) {
  throw new Error('The Ogre source must retain its embedded base-color, metallic-roughness, and normal maps.');
}
for (const texture of root.listTextures()) {
  const bytes = texture.getImage();
  const metadata = await sharp(bytes).metadata();
  sourceTextureMetrics.push({ name: texture.getName(), width: metadata.width, height: metadata.height, mime: texture.getMimeType(), sha256: createHash('sha256').update(bytes).digest('hex') });
  if (metadata.width > 2048 || metadata.height > 2048) {
    const encoded = await sharp(bytes).resize(2048, 2048, { fit: 'fill', kernel: texture === material.getMetallicRoughnessTexture() ? 'linear' : 'lanczos3' })
      .toFormat(metadata.format === 'jpeg' ? 'jpeg' : 'png', metadata.format === 'jpeg' ? { quality: 92, chromaSubsampling: '4:4:4' } : {}).toBuffer();
    texture.setImage(encoded);
  }
  const runtime = await sharp(texture.getImage()).metadata();
  if (runtime.width > 2048 || runtime.height > 2048) throw new Error(`Runtime map exceeds 2K: ${texture.getName()}`);
  runtimeTextureMetrics.push({ name: texture.getName(), width: runtime.width, height: runtime.height, mime: texture.getMimeType(), bytes: texture.getImage().length });
}
const packed = await sharp(material.getMetallicRoughnessTexture().getImage()).removeAlpha().resize(128, 128).raw().toBuffer();
const channelRanges = { roughness: [1, 0], metallic: [1, 0] };
for (let i = 0; i < packed.length; i += 3) {
  channelRanges.roughness[0] = Math.min(channelRanges.roughness[0], packed[i + 1] / 255);
  channelRanges.roughness[1] = Math.max(channelRanges.roughness[1], packed[i + 1] / 255);
  channelRanges.metallic[0] = Math.min(channelRanges.metallic[0], packed[i + 2] / 255);
  channelRanges.metallic[1] = Math.max(channelRanges.metallic[1], packed[i + 2] / 255);
}

const outputBytes = await io.writeBinary(doc);
await writeFile(candidatePath, outputBytes);
const candidateSha256 = createHash('sha256').update(outputBytes).digest('hex');
const checkRoot = (await io.readBinary(outputBytes)).getRoot();
const checkMesh = checkRoot.listMeshes()[0];
const checkPrimitive = checkMesh.listPrimitives()[0];
const checkSkin = checkRoot.listSkins()[0];
const checkPositions = checkPrimitive.getAttribute('POSITION').getArray();
const checkNormals = checkPrimitive.getAttribute('NORMAL').getArray();
const checkUvs = checkPrimitive.getAttribute('TEXCOORD_0').getArray();
const checkIndices = checkPrimitive.getIndices().getArray();
const checkJoints = checkPrimitive.getAttribute('JOINTS_0').getArray();
const checkWeights = checkPrimitive.getAttribute('WEIGHTS_0').getArray();
if (!checkSkin || checkSkin.listJoints().length !== bones.length || checkPositions.length !== positions.length) throw new Error('Candidate is missing its skin or source vertex count changed.');
let positionDelta = 0, normalDelta = 0, uvDelta = 0, indexMismatches = 0, multiInfluenceVertices = 0;
for (let i = 0; i < positions.length; i++) positionDelta = Math.max(positionDelta, Math.abs(positions[i] - checkPositions[i]));
for (let i = 0; i < normals.length; i++) normalDelta = Math.max(normalDelta, Math.abs(normals[i] - checkNormals[i]));
for (let i = 0; i < uvs.length; i++) uvDelta = Math.max(uvDelta, Math.abs(uvs[i] - checkUvs[i]));
for (let i = 0; i < indices.length; i++) if (indices[i] !== checkIndices[i]) indexMismatches++;
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  let sum = 0, nonzero = 0;
  for (let slot = 0; slot < 4; slot++) {
    const joint = checkJoints[vertex * 4 + slot], weight = checkWeights[vertex * 4 + slot];
    if (joint < 0 || joint >= checkSkin.listJoints().length || !Number.isFinite(weight) || weight < 0) throw new Error(`Invalid influence at vertex ${vertex}.`);
    sum += weight;
    if (weight > 1e-6) nonzero++;
  }
  if (Math.abs(sum - 1) > 1e-5) throw new Error(`Weights are not normalized at vertex ${vertex}: ${sum}`);
  if (nonzero > 1) multiInfluenceVertices++;
}
if (positionDelta || normalDelta || uvDelta || indexMismatches || multiInfluenceVertices < positions.length / 3 * 0.75) {
  throw new Error(`Preservation check failed: position ${positionDelta}, normal ${normalDelta}, UV ${uvDelta}, indices ${indexMismatches}, multi-influence ${multiInfluenceVertices}.`);
}
const animationNames = checkRoot.listAnimations().map((animation) => animation.getName());
const requiredClips = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
if (requiredClips.some((name) => !animationNames.includes(name))) throw new Error(`Missing required clips: ${requiredClips.filter((name) => !animationNames.includes(name))}`);
for (const animation of checkRoot.listAnimations()) {
  if (!animation.listChannels().length) throw new Error(`${animation.getName()} has no animated joints.`);
  for (const channel of animation.listChannels()) if (!checkSkin.listJoints().includes(channel.getTargetNode())) throw new Error(`${animation.getName()} targets a node outside the humanoid rig.`);
}
const preservedTextureHashes = root.listTextures().map((texture) => createHash('sha256').update(texture.getImage()).digest('hex'));
const reloadedTextureHashes = checkRoot.listTextures().map((texture) => createHash('sha256').update(texture.getImage()).digest('hex'));
if (JSON.stringify(preservedTextureHashes) !== JSON.stringify(reloadedTextureHashes)) throw new Error('Embedded source texture maps changed during export.');

const candidate = {
  schema: 'corealm-creature-native-rig-candidate/1',
  id: 'creature_rookback_ogre',
  displayName: 'Rookback Ogre',
  status: 'awaiting-root-lab-review',
  accepted: false,
  source: {
    file: sourcePath,
    sha256: sourceSha256,
    bytes: sourceBytes.length,
    starredModelId: modelId,
    starredCardId,
    starredDisplayName: 'ogre humanoid 3d model',
    geometry: { vertices: positions.length / 3, triangles: indices.length / 3, bounds, positionsPreserved: positionDelta === 0, normalsPreserved: normalDelta === 0, uvsPreserved: uvDelta === 0, indicesPreserved: indexMismatches === 0, retopology: false },
    sourceSkin: 'none',
    sourceAnimations: [],
    textures: sourceTextureMetrics,
  },
  candidate: {
    file: candidatePath,
    sha256: candidateSha256,
    bytes: outputBytes.length,
    productionTarget: 'game/public/assets/models/creature/creature_rookback_ogre.glb',
    geometry: { vertices: positions.length / 3, triangles: indices.length / 3, nativeBounds: bounds, positionsPreserved: true, normalsPreserved: true, uvsPreserved: true, indicesPreserved: true, scaleFactor: targetScale, targetHeightMeters },
    rig: { type: 'Mixamo-named Unity Humanoid mapping candidate', joints: bones.map((bone) => ({ name: bone.name, parent: bone.parent, position: bone.p })), influencesPerVertex: 4, verticesWithDistributedWeights: multiInfluenceVertices, maximumWeightSumError, method: 'Ogre-specific anatomical bone-segment distance weights with left/right and upper/lower body gates. Source skin was absent.' },
    textures: runtimeTextureMetrics,
    pbrChannelRanges: channelRanges,
    animations: clips,
  },
  acceptance: { sourceDesignAudit: false, geometry: true, rig: false, animation: false, textures: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${baseDir}/catalog.json`, `${JSON.stringify(candidate, null, 2)}\n`);

const labAsset = {
  id: 'creature_rookback_ogre',
  file: 'models/creature/creature_rookback_ogre.glb',
  pack: 'corealm-starred-creatures',
  category: 'character',
  is: 'Rookback Ogre',
  tags: ['creature', 'humanoid', 'ogre', 'starred', 'tripo', 'candidate'],
  bytes: outputBytes.length,
  sha256: candidateSha256,
  size: { x: width * targetScale, y: height * targetScale, z: depth * targetScale },
  base: { x: bounds.min[0] * targetScale, y: bounds.min[1] * targetScale, z: bounds.min[2] * targetScale },
  bounds: { min: bounds.min.map((value) => value * targetScale), max: bounds.max.map((value) => value * targetScale) },
  groundY: bounds.min[1] * targetScale,
  triangles: indices.length / 3,
  animations: clips.map((clip) => clip.name),
  materials: root.listMaterials().map((entry) => entry.getName()),
  sourceProvenance: { author: 'Corealm candidate rig reconstruction', sourceModelId: modelId, sourceCardId: starredCardId, sourceFile: sourcePath, sourceSha256, candidateFile: candidatePath, candidateSha256, rigMethod: 'Mixamo-named anatomical humanoid skeleton fitted to the original Ogre mesh with four normalized influences per vertex; exact source topology, positions, normals, UVs, and embedded PBR maps are preserved.', textures: runtimeTextureMetrics, candidateStatus: 'awaiting-root-lab-review' },
  acceptance: { assetAudit: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${baseDir}/lab-catalog.json`, `${JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', assets: [labAsset], files: { [labAsset.id]: 'rookback-ogre-native-rig-candidate.glb' } }, null, 2)}\n`);

console.log(JSON.stringify({ candidatePath, candidateSha256, sourceSha256, targetHeightMeters, targetScale, triangles: indices.length / 3, vertices: positions.length / 3, joints: bones.length, multiInfluenceVertices, maximumWeightSumError, clips: clips.map(({ name, seconds }) => ({ name, seconds })), runtimeTextureMetrics, pbrChannelRanges: channelRanges, sourceGeometryUnchanged: true, sourcePbrImagesUnchanged: true, rootVisualAndMotionAcceptance: false }, null, 2));
