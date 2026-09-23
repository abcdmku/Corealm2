import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { Matrix4, Quaternion, Vector3 } from 'three';

const baseDir = 'assets/art/tripo/imports/creatures/new-star-minotaur';
const sourcePath = 'assets/art/tripo/exports/501ffade-8115-427c-8616-e2791cfb40f6.glb';
const candidatePath = baseDir + '/redmane-breaker-native-rig.glb';
const sourceExpectedSha256 = 'c69d605643fc9041fc02611e08c8d30a78c111e2bde20868e8e2366587e26b7c';
const cardId = 'f4934bef-8282-4dd6-b0b8-bc6072f4be3b';
const modelId = '501ffade-8115-427c-8616-e2791cfb40f6';
const displayName = 'Redmane Breaker';
const assetId = 'creature_redmane_breaker';
const suggestedTier = 'T40-T50';
const targetHeightMeters = 2.2;

const sha = (value) => createHash('sha256').update(value).digest('hex');
const attrHash = (accessor) => {
  const array = accessor?.getArray();
  if (!array) return null;
  return sha(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
};
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourcePath);
const sourceSha256 = sha(sourceBytes);
if (sourceSha256 !== sourceExpectedSha256 || sourceBytes.length !== 4478576) {
  throw new Error('Minotaur source hash or byte length changed: ' + sourceSha256 + ' (' + sourceBytes.length + ' bytes).');
}
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find((node) => node.getMesh() === mesh);
const sourceSkin = root.listSkins()[0];
const sourceJoints = primitive?.getAttribute('JOINTS_0')?.getArray();
const sourceWeights = primitive?.getAttribute('WEIGHTS_0')?.getArray();
const positionsAccessor = primitive?.getAttribute('POSITION');
const normalsAccessor = primitive?.getAttribute('NORMAL');
const uvsAccessor = primitive?.getAttribute('TEXCOORD_0');
const indicesAccessor = primitive?.getIndices();
if (!scene || !primitive || !meshNode || !sourceSkin || root.listAnimations().length) {
  throw new Error('Expected one skinned Minotaur mesh with no source clips.');
}
const vertexCount = positionsAccessor?.getCount() ?? 0;
const triangleCount = (indicesAccessor?.getCount() ?? 0) / 3;
if (vertexCount !== 7896 || triangleCount !== 5169 || sourceSkin.listJoints().length !== 24) {
  throw new Error('Minotaur source topology or skin changed: ' + vertexCount + ' vertices, ' + triangleCount + ' triangles, ' + sourceSkin.listJoints().length + ' joints.');
}
let rootWeightedVertices = 0;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  let dominant = -1, maxWeight = -1;
  for (let slot = 0; slot < 4; slot++) {
    const index = vertex * 4 + slot;
    if (sourceWeights[index] > maxWeight) {
      dominant = sourceJoints[index];
      maxWeight = sourceWeights[index];
    }
  }
  if (dominant === 0) rootWeightedVertices++;
}
if (rootWeightedVertices / vertexCount < 0.99) {
  throw new Error('Source weighting differs from the audited root-weighted skeleton: ' + rootWeightedVertices + '/' + vertexCount + ' vertices.');
}

const sourceAttributeHashes = {
  POSITION: attrHash(positionsAccessor),
  NORMAL: attrHash(normalsAccessor),
  TEXCOORD_0: attrHash(uvsAccessor),
  indices: attrHash(indicesAccessor),
};
const positions = Float32Array.from(positionsAccessor.getArray());
const indices = Uint32Array.from(indicesAccessor.getArray());
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) {
  for (let axis = 0; axis < 3; axis++) {
    bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
    bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
  }
}
const extent = bounds.max.map((value, axis) => value - bounds.min[axis]);
const center = bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2);
const height = extent[1], width = extent[0], depth = extent[2];
const Y = (fraction) => bounds.min[1] + height * fraction;
const X = (fraction) => center[0] + width * fraction;
const Z = (fraction) => center[2] + depth * fraction;
const presentationScale = targetHeightMeters / height;

// The source model has a 24-joint hierarchy, but every vertex is fully weighted to
// bone_0 and there are no clips. Replace those unusable influences with an anatomical
// Unity Humanoid skin while retaining every source position, normal, UV, index and map.
const bones = [
  { name: 'mixamorigHips', parent: null, p: [center[0], Y(0.40), center[2]], sigma: height * 0.13, group: 'torso' },
  { name: 'mixamorigSpine', parent: 'mixamorigHips', p: [center[0], Y(0.49), Z(0.03)], sigma: height * 0.13, group: 'torso' },
  { name: 'mixamorigSpine1', parent: 'mixamorigSpine', p: [center[0], Y(0.58), Z(0.07)], sigma: height * 0.14, group: 'torso' },
  { name: 'mixamorigSpine2', parent: 'mixamorigSpine1', p: [center[0], Y(0.67), Z(0.08)], sigma: height * 0.13, group: 'torso' },
  { name: 'mixamorigNeck', parent: 'mixamorigSpine2', p: [center[0], Y(0.77), Z(0.10)], sigma: height * 0.09, group: 'torso' },
  { name: 'mixamorigHead', parent: 'mixamorigNeck', p: [center[0], Y(0.85), Z(0.14)], sigma: height * 0.15, group: 'head' },
  { name: 'mixamorigLeftShoulder', parent: 'mixamorigSpine2', p: [X(-0.18), Y(0.69), Z(0.07)], sigma: width * 0.13, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftArm', parent: 'mixamorigLeftShoulder', p: [X(-0.31), Y(0.67), Z(0.07)], sigma: width * 0.13, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftForeArm', parent: 'mixamorigLeftArm', p: [X(-0.43), Y(0.63), Z(0.06)], sigma: width * 0.12, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftHand', parent: 'mixamorigLeftForeArm', p: [X(-0.49), Y(0.59), Z(0.08)], sigma: width * 0.12, group: 'leftArm', side: -1 },
  { name: 'mixamorigRightShoulder', parent: 'mixamorigSpine2', p: [X(0.18), Y(0.69), Z(0.07)], sigma: width * 0.13, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightArm', parent: 'mixamorigRightShoulder', p: [X(0.31), Y(0.67), Z(0.07)], sigma: width * 0.13, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightForeArm', parent: 'mixamorigRightArm', p: [X(0.43), Y(0.63), Z(0.06)], sigma: width * 0.12, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightHand', parent: 'mixamorigRightForeArm', p: [X(0.49), Y(0.59), Z(0.08)], sigma: width * 0.12, group: 'rightArm', side: 1 },
  { name: 'mixamorigLeftUpLeg', parent: 'mixamorigHips', p: [X(-0.17), Y(0.34), Z(0.00)], sigma: width * 0.15, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftLeg', parent: 'mixamorigLeftUpLeg', p: [X(-0.22), Y(0.17), Z(0.00)], sigma: width * 0.14, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftFoot', parent: 'mixamorigLeftLeg', p: [X(-0.36), Y(0.055), Z(0.10)], sigma: width * 0.13, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftToeBase', parent: 'mixamorigLeftFoot', p: [X(-0.36), Y(0.025), Z(0.25)], sigma: width * 0.13, group: 'leftLeg', side: -1 },
  { name: 'mixamorigRightUpLeg', parent: 'mixamorigHips', p: [X(0.17), Y(0.34), Z(0.00)], sigma: width * 0.15, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightLeg', parent: 'mixamorigRightUpLeg', p: [X(0.22), Y(0.17), Z(0.00)], sigma: width * 0.14, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightFoot', parent: 'mixamorigRightLeg', p: [X(0.36), Y(0.055), Z(0.10)], sigma: width * 0.13, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightToeBase', parent: 'mixamorigRightFoot', p: [X(0.36), Y(0.025), Z(0.25)], sigma: width * 0.13, group: 'rightLeg', side: 1 },
];
const boneByName = new Map(bones.map((bone, index) => [bone.name, { ...bone, index }]));
for (const bone of bones) {
  const parent = bone.parent ? boneByName.get(bone.parent) : null;
  bone.local = parent ? bone.p.map((value, axis) => value - parent.p[axis]) : bone.p;
}

// Remove the unusable source skin and its orphaned nodes. The mesh stays in its original
// scene-space pose; only its skin attributes are replaced.
primitive.setAttribute('JOINTS_0', null);
primitive.setAttribute('WEIGHTS_0', null);
meshNode.setSkin(null);
sourceSkin.dispose();
const originalParent = meshNode.getParentNode();
if (originalParent) originalParent.removeChild(meshNode);
else if (scene.listChildren().includes(meshNode)) scene.removeChild(meshNode);
else throw new Error('Source mesh is not connected to the source scene.');
const oldNodes = root.listNodes().filter((node) => node !== meshNode);
for (const node of oldNodes) {
  const parent = node.getParentNode();
  if (parent) parent.removeChild(node);
}
for (const node of oldNodes) node.dispose();
meshNode.setName('RedmaneBreakerMesh').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
const rigContainer = doc.createNode('RedmaneBreakerArmature')
  .setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([presentationScale, presentationScale, presentationScale]);
scene.addChild(rigContainer);
rigContainer.addChild(meshNode);

const jointNodes = new Map();
for (const bone of bones) {
  const node = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  jointNodes.set(bone.name, node);
  const parent = bone.parent ? jointNodes.get(bone.parent) : rigContainer;
  parent.addChild(node);
}
const skin = doc.createSkin('RedmaneBreaker_UnityHumanoid').setSkeleton(jointNodes.get('mixamorigHips'));
for (const bone of bones) skin.addJoint(jointNodes.get(bone.name));
const inverseBinds = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i++) {
  const [x, y, z] = bones[i].p;
  inverseBinds.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
}
const buffer = root.listBuffers()[0];
skin.setInverseBindMatrices(doc.createAccessor('RedmaneBreaker_InverseBindMatrices').setArray(inverseBinds).setType(Accessor.Type.MAT4).setBuffer(buffer));
meshNode.setSkin(skin);

function segmentDistance(point, start, end) {
  const direction = end.map((value, axis) => value - start[axis]);
  const lengthSquared = direction.reduce((sum, value) => sum + value * value, 0) || 1;
  const t = Math.max(0, Math.min(1, point.reduce((sum, value, axis) => sum + (value - start[axis]) * direction[axis], 0) / lengthSquared));
  return Math.hypot(...point.map((value, axis) => value - (start[axis] + t * direction[axis])));
}
const jointValues = new Uint16Array(vertexCount * 4);
const weightValues = new Float32Array(vertexCount * 4);
const influenceCounts = new Uint32Array(bones.length);
let maximumWeightSumError = 0;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const [x, y] = point;
  const yn = (y - bounds.min[1]) / height;
  const lateral = (x - center[0]) / width;
  const candidates = [];
  for (const bone of bones) {
    let gate = 1;
    if (bone.group === 'head') {
      gate = 0.02 + 0.98 / (1 + Math.exp(-(yn - 0.76) / 0.035));
    } else if (bone.group === 'leftArm' || bone.group === 'rightArm') {
      gate = yn > 0.33 && yn < 0.84 ? 1 : 0.012;
      gate *= 0.02 + 0.98 / (1 + Math.exp(-((bone.side * lateral - 0.13) / 0.055)));
    } else if (bone.group === 'leftLeg' || bone.group === 'rightLeg') {
      gate = yn < 0.52 ? 1 : 0.008;
      gate *= 0.02 + 0.98 / (1 + Math.exp(-((bone.side * lateral - 0.04) / 0.09)));
    } else {
      const central = 0.08 + 0.92 / (1 + Math.exp((Math.abs(lateral) - 0.34) / 0.08));
      gate = central * (yn < 0.90 ? 1 : 0.08);
    }
    const parent = bone.parent ? boneByName.get(bone.parent) : null;
    const distance = segmentDistance(point, parent?.p ?? bone.p, bone.p);
    const score = gate * Math.exp(-0.5 * (distance / bone.sigma) ** 2);
    if (score > 1e-12) candidates.push({ index: boneByName.get(bone.name).index, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 4);
  if (!chosen.length) throw new Error('Could not find anatomical influences for vertex ' + vertex + '.');
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
primitive.setAttribute('JOINTS_0', doc.createAccessor('RedmaneBreaker_Joints0').setArray(jointValues).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('RedmaneBreaker_Weights0').setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(buffer));

const material = root.listMaterials()[0];
if (!material?.getBaseColorTexture() || !material.getMetallicRoughnessTexture() || !material.getNormalTexture()) {
  throw new Error('Expected embedded base-color, packed metallic-roughness, and normal maps.');
}
// Preserve Tripo's layered maps; set creature-level factors so the mostly rough, low-metal
// hide and horn surfaces do not render like metal.
material.setMetallicFactor(0.08).setRoughnessFactor(0.90);
const sourceTextureMetrics = [];
const runtimeTextureMetrics = [];
for (const texture of root.listTextures()) {
  const image = texture.getImage();
  const metadata = await sharp(image).metadata();
  sourceTextureMetrics.push({ name: texture.getName(), width: metadata.width, height: metadata.height, mime: texture.getMimeType(), bytes: image.length, sha256: sha(image) });
  if (metadata.width > 2048 || metadata.height > 2048) {
    const isDataTexture = texture === material.getMetallicRoughnessTexture() || texture === material.getNormalTexture();
    const encoded = await sharp(image)
      .resize(2048, 2048, { fit: 'fill', kernel: isDataTexture ? 'linear' : 'lanczos3' })
      .toFormat(metadata.format === 'jpeg' ? 'jpeg' : 'png', metadata.format === 'jpeg' ? { quality: 92, chromaSubsampling: '4:4:4' } : {})
      .toBuffer();
    texture.setImage(encoded);
  }
  const runtimeMetadata = await sharp(texture.getImage()).metadata();
  if (runtimeMetadata.width > 2048 || runtimeMetadata.height > 2048) throw new Error('Runtime texture exceeds 2K: ' + texture.getName());
  runtimeTextureMetrics.push({ name: texture.getName(), width: runtimeMetadata.width, height: runtimeMetadata.height, mime: texture.getMimeType(), bytes: texture.getImage().length, sha256: sha(texture.getImage()) });
}
const packed = await sharp(material.getMetallicRoughnessTexture().getImage()).removeAlpha().resize(128, 128).raw().toBuffer();
const metallicRange = [Infinity, -Infinity];
for (let i = 2; i < packed.length; i += 3) {
  const metallic = packed[i] / 255;
  metallicRange[0] = Math.min(metallicRange[0], metallic);
  metallicRange[1] = Math.max(metallicRange[1], metallic);
}
if (metallicRange[1] - metallicRange[0] < 0.05) throw new Error('The packed metallic channel is unexpectedly flat: ' + metallicRange);

const quat = (axis, angle) => {
  const sine = Math.sin(angle / 2), cosine = Math.cos(angle / 2);
  if (axis === 'x') return [sine, 0, 0, cosine];
  if (axis === 'y') return [0, sine, 0, cosine];
  return [0, 0, sine, cosine];
};
const phase = [0, 0.25, 0.5, 0.75, 1];
const cycle = (offset, amount) => phase.map((t) => quat('x', Math.sin((t + offset) * Math.PI * 2) * amount));
const idleArms = (side, angle) => side < 0 ? quat('z', angle) : quat('z', -angle);
const clips = [];
function addClip(name, seconds, tracks) {
  const animation = doc.createAnimation(name);
  for (const track of tracks) {
    const input = doc.createAccessor(name + '_' + track.node + '_time')
      .setArray(Float32Array.from(track.times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const output = doc.createAccessor(name + '_' + track.node + '_' + (track.path ?? 'rotation') + '_value')
      .setArray(Float32Array.from(track.values.flat()))
      .setType(track.path === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4).setBuffer(buffer);
    const sampler = doc.createAnimationSampler(name + '_' + track.node).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(track.node + '_' + (track.path ?? 'rotation'))
      .setTargetNode(jointNodes.get(track.node)).setTargetPath(track.path ?? 'rotation').setSampler(sampler));
  }
  clips.push({ name, seconds, tracks });
}
const hY = Y(0.40), hZ = center[2];
const hipsAt = (y, z = hZ) => [center[0], y, z];
const armSides = [['mixamorigLeftShoulder', 'mixamorigLeftArm', 'mixamorigLeftForeArm', 'mixamorigLeftHand', -1], ['mixamorigRightShoulder', 'mixamorigRightArm', 'mixamorigRightForeArm', 'mixamorigRightHand', 1]];
addClip('Idle', 3.0, [
  ...armSides.flatMap(([shoulder, upper, fore, hand, side]) => [
    { node: shoulder, times: [0, 0.75, 1.5, 2.25, 3], values: [idleArms(side, 0.72), idleArms(side, 0.73), idleArms(side, 0.71), idleArms(side, 0.72), idleArms(side, 0.72)] },
    { node: upper, times: [0, 0.75, 1.5, 2.25, 3], values: [quat('x', 0), quat('x', -0.025), quat('x', 0), quat('x', 0.018), quat('x', 0)] },
    { node: fore, times: [0, 0.75, 1.5, 2.25, 3], values: [quat('z', side * 0.12), quat('z', side * 0.13), quat('z', side * 0.12), quat('z', side * 0.11), quat('z', side * 0.12)] },
    { node: hand, times: [0, 0.75, 1.5, 2.25, 3], values: [quat('x', 0), quat('x', 0.02), quat('x', 0), quat('x', -0.02), quat('x', 0)] },
  ]),
  { node: 'mixamorigSpine1', times: [0, 0.75, 1.5, 2.25, 3], values: [quat('x', 0), quat('x', 0.018), quat('x', 0), quat('x', -0.014), quat('x', 0)] },
  { node: 'mixamorigSpine2', times: [0, 0.75, 1.5, 2.25, 3], values: [quat('z', 0), quat('z', 0.012), quat('z', 0), quat('z', -0.01), quat('z', 0)] },
  { node: 'mixamorigHead', times: [0, 0.75, 1.5, 2.25, 3], values: [quat('x', 0), quat('x', -0.025), quat('x', 0.015), quat('x', 0), quat('x', 0)] },
]);
addClip('Walk', 1.12, [
  { node: 'mixamorigHips', path: 'translation', times: phase.map((t) => t * 1.12), values: [[...hipsAt(hY)], [...hipsAt(hY + 0.025)], [...hipsAt(hY)], [...hipsAt(hY + 0.012)], [...hipsAt(hY)]] },
  { node: 'mixamorigLeftUpLeg', times: phase.map((t) => t * 1.12), values: cycle(0, 0.14) },
  { node: 'mixamorigRightUpLeg', times: phase.map((t) => t * 1.12), values: cycle(0.5, 0.14) },
  { node: 'mixamorigLeftLeg', times: phase.map((t) => t * 1.12), values: phase.map((t) => quat('x', -Math.max(0, Math.sin(t * Math.PI * 2)) * 0.12)) },
  { node: 'mixamorigRightLeg', times: phase.map((t) => t * 1.12), values: phase.map((t) => quat('x', -Math.max(0, Math.sin((t + 0.5) * Math.PI * 2)) * 0.12)) },
  ...armSides.flatMap(([shoulder, upper, fore, , side]) => [
    { node: shoulder, times: phase.map((t) => t * 1.12), values: phase.map((t) => idleArms(side, 0.72 + Math.sin((t + (side < 0 ? 0.5 : 0)) * Math.PI * 2) * 0.08)) },
    { node: upper, times: phase.map((t) => t * 1.12), values: cycle(side < 0 ? 0.5 : 0, 0.13) },
    { node: fore, times: phase.map((t) => t * 1.12), values: phase.map((t) => quat('z', side * (0.12 + Math.max(0, Math.sin(t * Math.PI * 2)) * 0.18))) },
  ]),
]);
addClip('Run', 0.76, [
  { node: 'mixamorigHips', path: 'translation', times: phase.map((t) => t * 0.76), values: [[...hipsAt(hY)], [...hipsAt(hY + 0.055)], [...hipsAt(hY)], [...hipsAt(hY + 0.035)], [...hipsAt(hY)]] },
  { node: 'mixamorigLeftUpLeg', times: phase.map((t) => t * 0.76), values: cycle(0, 0.30) },
  { node: 'mixamorigRightUpLeg', times: phase.map((t) => t * 0.76), values: cycle(0.5, 0.30) },
  { node: 'mixamorigLeftLeg', times: phase.map((t) => t * 0.76), values: phase.map((t) => quat('x', -Math.max(0, Math.sin(t * Math.PI * 2)) * 0.28)) },
  { node: 'mixamorigRightLeg', times: phase.map((t) => t * 0.76), values: phase.map((t) => quat('x', -Math.max(0, Math.sin((t + 0.5) * Math.PI * 2)) * 0.28)) },
  ...armSides.flatMap(([shoulder, upper, fore, , side]) => [
    { node: shoulder, times: phase.map((t) => t * 0.76), values: phase.map((t) => idleArms(side, 0.72 + Math.sin((t + (side < 0 ? 0.5 : 0)) * Math.PI * 2) * 0.13)) },
    { node: upper, times: phase.map((t) => t * 0.76), values: cycle(side < 0 ? 0.5 : 0, 0.30) },
    { node: fore, times: phase.map((t) => t * 0.76), values: phase.map((t) => quat('z', side * (0.12 + Math.max(0, Math.sin(t * Math.PI * 2)) * 0.30))) },
  ]),
  { node: 'mixamorigSpine1', times: phase.map((t) => t * 0.76), values: phase.map((t) => quat('x', 0.025 + Math.sin(t * Math.PI * 2) * 0.045)) },
]);
addClip('Attack', 1.0, [
  { node: 'mixamorigHips', path: 'translation', times: [0, 0.20, 0.46, 0.72, 1], values: [hipsAt(hY), hipsAt(hY + 0.015, hZ - 0.07), hipsAt(hY - 0.005, hZ + 0.16), hipsAt(hY, hZ + 0.04), hipsAt(hY)] },
  { node: 'mixamorigSpine1', times: [0, 0.20, 0.46, 0.72, 1], values: [quat('x', 0), quat('x', -0.24), quat('x', 0.35), quat('x', 0.16), quat('x', 0)] },
  { node: 'mixamorigSpine2', times: [0, 0.20, 0.46, 0.72, 1], values: [quat('x', 0), quat('x', -0.12), quat('x', 0.24), quat('x', 0.08), quat('x', 0)] },
  { node: 'mixamorigNeck', times: [0, 0.20, 0.46, 0.72, 1], values: [quat('x', 0), quat('x', -0.18), quat('x', 0.28), quat('x', 0.08), quat('x', 0)] },
  { node: 'mixamorigHead', times: [0, 0.20, 0.46, 0.72, 1], values: [quat('x', 0), quat('x', -0.24), quat('x', 0.42), quat('x', 0.16), quat('x', 0)] },
  ...armSides.flatMap(([shoulder, upper, fore, , side]) => [
    { node: shoulder, times: [0, 0.20, 0.46, 0.72, 1], values: [idleArms(side, 0.72), idleArms(side, 1.02), idleArms(side, 0.40), idleArms(side, 0.56), idleArms(side, 0.72)] },
    { node: upper, times: [0, 0.20, 0.46, 0.72, 1], values: [quat('x', 0), quat('x', -0.18), quat('x', 0.12), quat('x', 0.08), quat('x', 0)] },
    { node: fore, times: [0, 0.20, 0.46, 0.72, 1], values: [quat('z', side * 0.12), quat('z', side * 0.36), quat('z', side * 0.10), quat('z', side * 0.08), quat('z', side * 0.12)] },
  ]),
]);
addClip('Hit', 0.48, [
  { node: 'mixamorigHips', path: 'translation', times: [0, 0.08, 0.20, 0.48], values: [hipsAt(hY), hipsAt(hY + 0.01, hZ - 0.10), hipsAt(hY, hZ - 0.04), hipsAt(hY)] },
  { node: 'mixamorigSpine1', times: [0, 0.08, 0.20, 0.48], values: [quat('z', 0), quat('z', 0.23), quat('z', -0.08), quat('z', 0)] },
  { node: 'mixamorigSpine2', times: [0, 0.08, 0.20, 0.48], values: [quat('x', 0), quat('x', -0.20), quat('x', 0.06), quat('x', 0)] },
  { node: 'mixamorigHead', times: [0, 0.08, 0.20, 0.48], values: [quat('z', 0), quat('z', -0.20), quat('z', 0.05), quat('z', 0)] },
  ...armSides.map(([shoulder, , fore, , side]) => ({ node: shoulder, times: [0, 0.08, 0.20, 0.48], values: [idleArms(side, 0.72), idleArms(side, 0.92), idleArms(side, 0.70), idleArms(side, 0.72)] })),
  ...armSides.map(([, , fore, , side]) => ({ node: fore, times: [0, 0.08, 0.20, 0.48], values: [quat('z', side * 0.12), quat('z', side * 0.24), quat('z', side * 0.10), quat('z', side * 0.12)] })),
]);
addClip('Death', 1.55, [
  { node: 'mixamorigHips', path: 'translation', times: [0, 0.22, 0.65, 1.05, 1.55], values: [hipsAt(hY), hipsAt(hY), hipsAt(hY), hipsAt(hY), hipsAt(hY)] },
  { node: 'mixamorigHips', times: [0, 0.22, 0.65, 1.05, 1.55], values: [quat('z', 0), quat('z', 0.01), quat('z', 0.015), quat('z', 0.015), quat('z', 0.015)] },
  { node: 'mixamorigSpine1', times: [0, 0.22, 0.65, 1.05, 1.55], values: [quat('x', 0), quat('x', 0.12), quat('x', 0.30), quat('x', 0.40), quat('x', 0.40)] },
  { node: 'mixamorigSpine2', times: [0, 0.22, 0.65, 1.05, 1.55], values: [quat('x', 0), quat('x', 0.10), quat('x', 0.22), quat('x', 0.26), quat('x', 0.26)] },
  { node: 'mixamorigHead', times: [0, 0.22, 0.65, 1.05, 1.55], values: [quat('x', 0), quat('x', 0.12), quat('x', 0.28), quat('x', 0.34), quat('x', 0.34)] },
  { node: 'mixamorigLeftUpLeg', times: [0, 0.22, 0.65, 1.05, 1.55], values: [quat('x', 0), quat('x', -0.05), quat('x', -0.12), quat('x', -0.14), quat('x', -0.14)] },
  { node: 'mixamorigRightUpLeg', times: [0, 0.22, 0.65, 1.05, 1.55], values: [quat('x', 0), quat('x', 0.04), quat('x', 0.10), quat('x', 0.12), quat('x', 0.12)] },
  { node: 'mixamorigLeftLeg', times: [0, 0.22, 0.65, 1.05, 1.55], values: [quat('x', 0), quat('x', -0.08), quat('x', -0.18), quat('x', -0.22), quat('x', -0.22)] },
  { node: 'mixamorigRightLeg', times: [0, 0.22, 0.65, 1.05, 1.55], values: [quat('x', 0), quat('x', 0.06), quat('x', 0.14), quat('x', 0.18), quat('x', 0.18)] },
  { node: 'mixamorigLeftFoot', times: [0, 0.22, 0.65, 1.05, 1.55], values: [quat('x', 0), quat('x', 0.13), quat('x', 0.30), quat('x', 0.36), quat('x', 0.36)] },
  { node: 'mixamorigRightFoot', times: [0, 0.22, 0.65, 1.05, 1.55], values: [quat('x', 0), quat('x', -0.10), quat('x', -0.24), quat('x', -0.30), quat('x', -0.30)] },
  ...armSides.flatMap(([shoulder, upper, fore, , side]) => [
    { node: shoulder, times: [0, 0.22, 0.65, 1.05, 1.55], values: [idleArms(side, 0.72), idleArms(side, 0.90), idleArms(side, 1.12), idleArms(side, 1.15), idleArms(side, 1.15)] },
    { node: upper, times: [0, 0.22, 0.65, 1.05, 1.55], values: [quat('x', 0), quat('x', 0.08), quat('x', 0.36), quat('x', 0.40), quat('x', 0.40)] },
    { node: fore, times: [0, 0.22, 0.65, 1.05, 1.55], values: [quat('z', side * 0.12), quat('z', side * 0.18), quat('z', side * 0.30), quat('z', side * 0.32), quat('z', side * 0.32)] },
  ]),
]);

// Sample all clips through the actual linear skin weights so obvious frozen poses,
// normalized-weight regressions and severe floor penetration are caught at build time.
function interpolate(track, time) {
  if (time <= track.times[0]) return track.values[0];
  if (time >= track.times[track.times.length - 1]) return track.values[track.values.length - 1];
  let i = 0;
  while (i < track.times.length - 2 && track.times[i + 1] < time) i++;
  const amount = (time - track.times[i]) / (track.times[i + 1] - track.times[i]);
  if (track.path === 'translation') return track.values[i].map((value, axis) => value + (track.values[i + 1][axis] - value) * amount);
  return new Quaternion(...track.values[i]).slerp(new Quaternion(...track.values[i + 1]), amount).toArray();
}
function sampleSkin(clip, time) {
  const pose = new Map(bones.map((bone) => [bone.name, { translation: [...bone.local], rotation: [0, 0, 0, 1] }]));
  for (const track of clip.tracks) {
    const value = interpolate(track, time);
    pose.get(track.node)[track.path ?? 'rotation'] = value;
  }
  const worldByName = new Map();
  for (const bone of bones) {
    const localPose = pose.get(bone.name);
    const localMatrix = new Matrix4().compose(new Vector3(...localPose.translation), new Quaternion(...localPose.rotation), new Vector3(1, 1, 1));
    const parent = bone.parent ? worldByName.get(bone.parent) : null;
    worldByName.set(bone.name, parent ? parent.clone().multiply(localMatrix) : localMatrix);
  }
  const matrices = bones.map((bone, index) => worldByName.get(bone.name).clone().multiply(new Matrix4().fromArray(Array.from(inverseBinds.slice(index * 16, index * 16 + 16)))));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let maxDisplacement = 0, movedVertices = 0;
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const source = new Vector3(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]);
    const out = new Vector3();
    for (let slot = 0; slot < 4; slot++) {
      const at = vertex * 4 + slot, weight = weightValues[at];
      if (weight > 0) out.add(source.clone().applyMatrix4(matrices[jointValues[at]]).multiplyScalar(weight));
    }
    const displacement = out.distanceTo(source);
    maxDisplacement = Math.max(maxDisplacement, displacement);
    if (displacement > 1e-4) movedVertices++;
    min[0] = Math.min(min[0], out.x);
    min[1] = Math.min(min[1], out.y); min[2] = Math.min(min[2], out.z);
    max[0] = Math.max(max[0], out.x); max[1] = Math.max(max[1], out.y); max[2] = Math.max(max[2], out.z);
  }
  return { time, maximumVertexDisplacement: maxDisplacement, movedVertices, bounds: { min, max } };
}
const sampledMotions = clips.map((clip) => {
  const samples = Array.from({ length: 9 }, (_, index) => sampleSkin(clip, clip.seconds * index / 8));
  return {
    name: clip.name,
    seconds: clip.seconds,
    channels: clip.tracks.length,
    sampledPoses: samples.length,
    maximumVertexDisplacement: Math.max(...samples.map((sample) => sample.maximumVertexDisplacement)),
    maximumMovedVertices: Math.max(...samples.map((sample) => sample.movedVertices)),
    minimumGroundY: Math.min(...samples.map((sample) => sample.bounds.min[1])),
    sweptBounds: {
      min: [0, 1, 2].map((axis) => Math.min(...samples.map((sample) => sample.bounds.min[axis]))),
      max: [0, 1, 2].map((axis) => Math.max(...samples.map((sample) => sample.bounds.max[axis]))),
    },
  };
});
for (const motion of sampledMotions) {
  if (motion.maximumVertexDisplacement < 0.01 || motion.maximumMovedVertices < vertexCount * 0.25) {
    throw new Error(motion.name + ' does not produce enough actual skin deformation.');
  }
}
const worstPenetration = Math.min(...sampledMotions.map((motion) => motion.minimumGroundY));
if (worstPenetration < -0.18) throw new Error('Animation falls more than 0.18m below the rest floor: ' + worstPenetration + '; ' + JSON.stringify(sampledMotions.map((motion) => ({ name: motion.name, minY: motion.sweptBounds.min[1], maxY: motion.sweptBounds.max[1] }))));

const outputBytes = await io.writeBinary(doc);
await writeFile(candidatePath, outputBytes);
const candidateSha256 = sha(outputBytes);
const checkDoc = await io.readBinary(outputBytes);
const checkRoot = checkDoc.getRoot();
const checkPrimitive = checkRoot.listMeshes()[0]?.listPrimitives()[0];
const checkSkin = checkRoot.listSkins()[0];
if (!checkPrimitive || !checkSkin || checkSkin.listJoints().length !== bones.length) throw new Error('Exported skin is incomplete.');
for (const semantic of ['POSITION', 'NORMAL', 'TEXCOORD_0']) {
  if (attrHash(checkPrimitive.getAttribute(semantic)) !== sourceAttributeHashes[semantic]) {
    throw new Error('Candidate changed source ' + semantic + ' values.');
  }
}
if (attrHash(checkPrimitive.getIndices()) !== sourceAttributeHashes.indices) throw new Error('Candidate changed source triangle indices.');
const checkPositions = checkPrimitive.getAttribute('POSITION').getArray();
const checkJoints = checkPrimitive.getAttribute('JOINTS_0')?.getArray();
const checkWeights = checkPrimitive.getAttribute('WEIGHTS_0')?.getArray();
if (checkPositions.length / 3 !== vertexCount || !checkJoints || !checkWeights) throw new Error('Candidate is missing its exported mesh skin.');
let checkedWeightError = 0, distributedVertices = 0;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  let sum = 0, active = 0;
  for (let slot = 0; slot < 4; slot++) {
    const at = vertex * 4 + slot, joint = checkJoints[at], weight = checkWeights[at];
    if (!Number.isInteger(joint) || joint < 0 || joint >= bones.length || !Number.isFinite(weight) || weight < 0) throw new Error('Invalid exported influence on vertex ' + vertex + '.');
    sum += weight;
    if (weight > 1e-6) active++;
  }
  checkedWeightError = Math.max(checkedWeightError, Math.abs(sum - 1));
  if (active > 1) distributedVertices++;
}
if (checkedWeightError > 1e-5 || distributedVertices < vertexCount * 0.75) {
  throw new Error('Exported skin weights are not sufficiently distributed: ' + distributedVertices + ' vertices; error ' + checkedWeightError + '.');
}
const requiredClips = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
const animationNames = checkRoot.listAnimations().map((animation) => animation.getName());
if (requiredClips.some((name) => !animationNames.includes(name))) throw new Error('Exported creature is missing a gameplay clip.');
for (const animation of checkRoot.listAnimations()) {
  for (const channel of animation.listChannels()) {
    if (!checkSkin.listJoints().includes(channel.getTargetNode())) throw new Error(animation.getName() + ' targets a node outside the exported humanoid skin.');
  }
}

const geometry = {
  vertices: vertexCount,
  triangles: triangleCount,
  bounds,
  positionsPreserved: true,
  normalsPreserved: true,
  uvsPreserved: true,
  indicesPreserved: true,
  retopology: false,
};
const rigMethod = 'Mixamo-named Unity Humanoid skeleton with four normalized anatomical influences per vertex; source had 100% bone_0 weighting, so only JOINTS_0/WEIGHTS_0 and its unusable source skeleton were rebuilt.';
const catalog = {
  schema: 'corealm-creature-native-rig-candidate/1',
  id: assetId,
  displayName,
  status: 'awaiting-root-lab-review',
  accepted: false,
  source: {
    file: sourcePath,
    sha256: sourceSha256,
    bytes: sourceBytes.length,
    starredModelId: modelId,
    starredCardId: cardId,
    starredDisplayName: 'minotaur 3d model',
    generator: 'Tripo P1',
    prompt: 'horned minotaur with beige horns, red-brown mane, muscular build, sharp fangs, low-poly texture',
    geometry,
    sourceSkin: { jointCount: 24, rootWeightedVertices, vertexCount, allVerticesWeightedToBoneZero: rootWeightedVertices === vertexCount },
    sourceAnimations: [],
    textures: sourceTextureMetrics,
  },
  candidate: {
    file: candidatePath,
    sha256: candidateSha256,
    bytes: outputBytes.length,
    productionTarget: 'game/public/assets/models/creature/' + assetId + '.glb',
    presentation: { targetHeightMeters, scaleFactor: presentationScale, uniformRootScale: presentationScale, scaleNode: 'RedmaneBreakerArmature' },
    geometry: { vertices: vertexCount, triangles: triangleCount, positionsPreserved: true, normalsPreserved: true, uvsPreserved: true, indicesPreserved: true },
    rig: {
      type: 'Mixamo-named Unity Humanoid glTF skin',
      joints: bones.map((bone) => ({ name: bone.name, parent: bone.parent, position: bone.p })),
      influencesPerVertex: 4,
      verticesWithDistributedWeights: distributedVertices,
      maximumWeightSumError: checkedWeightError,
      method: rigMethod,
    },
    material: { metallicFactor: material.getMetallicFactor(), roughnessFactor: material.getRoughnessFactor(), sourceMapsPreserved: true },
    textures: runtimeTextureMetrics,
    packedMetallicChannelRange: metallicRange,
    animations: clips.map((clip) => ({ name: clip.name, seconds: clip.seconds, channels: clip.tracks.length })),
    motionVerification: sampledMotions,
  },
  suggestedTier,
  suggestedRegionFit: 'Highland border or upper Wilderness; large aggressive humanoid belongs well above the starter region.',
  acceptance: { sourceDesignAudit: false, geometry: true, rig: false, animation: false, textures: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(baseDir + '/catalog.json', JSON.stringify(catalog, null, 2) + '\n');

const scaledBounds = {
  min: bounds.min.map((value, axis) => axis === 1 ? value * presentationScale : (value - center[axis]) * presentationScale),
  max: bounds.max.map((value, axis) => axis === 1 ? value * presentationScale : (value - center[axis]) * presentationScale),
};
const scaledSize = scaledBounds.max.map((value, axis) => value - scaledBounds.min[axis]);
const labAsset = {
  id: assetId,
  file: 'models/creature/' + assetId + '.glb',
  pack: 'corealm-starred-creatures',
  category: 'character',
  is: displayName,
  tags: ['creature', 'humanoid', 'minotaur', 'redmane', 'T40-T50', 'starred', 'tripo', 'candidate'],
  bytes: outputBytes.length,
  sha256: candidateSha256,
  size: { x: scaledSize[0], y: scaledSize[1], z: scaledSize[2] },
  base: { x: scaledBounds.min[0], y: scaledBounds.min[1], z: scaledBounds.min[2] },
  bounds: scaledBounds,
  groundY: scaledBounds.min[1],
  triangles: triangleCount,
  animations: requiredClips,
  materials: root.listMaterials().map((entry) => entry.getName()),
  presentation: { targetHeightMeters, scaleFactor: presentationScale, uniformRootScale: presentationScale, scaleNode: 'RedmaneBreakerArmature' },
  sourceProvenance: { author: 'Corealm candidate rig reconstruction', sourceModelId: modelId, sourceCardId: cardId, sourceFile: sourcePath, sourceSha256, candidateFile: candidatePath, candidateSha256, rigMethod, textures: runtimeTextureMetrics, candidateStatus: 'awaiting-root-lab-review' },
  acceptance: { assetAudit: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(baseDir + '/lab-catalog.json', JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', assets: [labAsset], files: { [assetId]: 'redmane-breaker-native-rig.glb' } }, null, 2) + '\n');
console.log(JSON.stringify({ candidatePath, bytes: outputBytes.length, candidateSha256, vertices: vertexCount, triangles: triangleCount, sourceRootWeightedVertices: rootWeightedVertices, joints: bones.length, distributedVertices, maximumWeightSumError: checkedWeightError, presentationScale, runtimeTextureMetrics, motionVerification: sampledMotions, worstPenetration }, null, 2));
