import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const baseDir = 'assets/art/tripo/imports/creatures/starred-sheet-c/parts/04-magma-spike-demon';
const sourcePath = 'assets/art/tripo/imports/creatures/starred-sheet-c/parts/04-magma-spike-demon/base.glb';
const candidatePath = `${baseDir}/magma-spike-demon-native-rig.glb`;
await mkdir(baseDir, { recursive: true });

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
if (sourceSha256 !== 'b5920c3b04fe7d7dfeade19a353e4b1739f951d0258b8b6d30f8adbbb75deeb3') {
  throw new Error(`Extracted source hash mismatch: ${sourceSha256}`);
}
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find((node) => node.getMesh() === mesh);
if (!scene || !primitive || !meshNode || root.listSkins().length || root.listAnimations().length) {
  throw new Error('Expected this extracted static demon GLB with no source skin or clips.');
}
const positions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
const indices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
if (positions.length / 3 !== 4722 || indices.length / 3 !== 2519) {
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
  { name: 'mixamorigHips', parent: null, p: [0, 0.390, -0.090], sigma: 0.130, group: 'torso' },
  { name: 'mixamorigSpine', parent: 'mixamorigHips', p: [0, 0.475, -0.070], sigma: 0.130, group: 'torso' },
  { name: 'mixamorigSpine1', parent: 'mixamorigSpine', p: [0, 0.575, -0.060], sigma: 0.130, group: 'torso' },
  { name: 'mixamorigSpine2', parent: 'mixamorigSpine1', p: [0, 0.675, -0.055], sigma: 0.125, group: 'torso' },
  { name: 'mixamorigNeck', parent: 'mixamorigSpine2', p: [0, 0.795, -0.040], sigma: 0.105, group: 'torso' },
  { name: 'mixamorigHead', parent: 'mixamorigNeck', p: [0, 0.875, -0.035], sigma: 0.120, group: 'head' },
  { name: 'mixamorigLeftShoulder', parent: 'mixamorigSpine2', p: [-0.205, 0.675, -0.055], sigma: 0.075, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftArm', parent: 'mixamorigLeftShoulder', p: [-0.300, 0.590, -0.035], sigma: 0.075, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftForeArm', parent: 'mixamorigLeftArm', p: [-0.365, 0.445, 0.005], sigma: 0.065, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftHand', parent: 'mixamorigLeftForeArm', p: [-0.405, 0.325, 0.035], sigma: 0.075, group: 'leftArm', side: -1 },
  { name: 'mixamorigRightShoulder', parent: 'mixamorigSpine2', p: [0.205, 0.675, -0.055], sigma: 0.075, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightArm', parent: 'mixamorigRightShoulder', p: [0.300, 0.590, -0.035], sigma: 0.075, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightForeArm', parent: 'mixamorigRightArm', p: [0.365, 0.445, 0.005], sigma: 0.065, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightHand', parent: 'mixamorigRightForeArm', p: [0.405, 0.325, 0.035], sigma: 0.075, group: 'rightArm', side: 1 },
  { name: 'mixamorigLeftUpLeg', parent: 'mixamorigHips', p: [-0.145, 0.330, -0.085], sigma: 0.090, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftLeg', parent: 'mixamorigLeftUpLeg', p: [-0.165, 0.165, -0.055], sigma: 0.075, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftFoot', parent: 'mixamorigLeftLeg', p: [-0.165, 0.055, 0.005], sigma: 0.060, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftToeBase', parent: 'mixamorigLeftFoot', p: [-0.165, 0.035, 0.095], sigma: 0.060, group: 'leftLeg', side: -1 },
  { name: 'mixamorigRightUpLeg', parent: 'mixamorigHips', p: [0.145, 0.330, -0.085], sigma: 0.090, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightLeg', parent: 'mixamorigRightUpLeg', p: [0.165, 0.165, -0.055], sigma: 0.075, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightFoot', parent: 'mixamorigRightLeg', p: [0.165, 0.055, 0.005], sigma: 0.060, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightToeBase', parent: 'mixamorigRightFoot', p: [0.165, 0.035, 0.095], sigma: 0.060, group: 'rightLeg', side: 1 },
];
const width = bounds.max[0] - bounds.min[0];
const height = bounds.max[1] - bounds.min[1];
const depth = bounds.max[2] - bounds.min[2];
const targetHeight = 2.2;
const presentationScale = targetHeight / height;
const scaleX = width / 0.81, scaleY = height / 0.875, scaleZ = depth / 0.32;
for (const bone of bones) {
  bone.p = [bone.p[0] * scaleX, bone.p[1] * scaleY, bone.p[2] * scaleZ];
  bone.sigma *= scaleY;
}
const boneByName = new Map(bones.map((bone, index) => [bone.name, { ...bone, index }]));
for (const bone of bones) {
  const parent = bone.parent ? boneByName.get(bone.parent) : null;
  bone.local = parent ? bone.p.map((value, axis) => value - parent.p[axis]) : bone.p;
}

const originalParent = meshNode.getParentNode();
if (originalParent) originalParent.removeChild(meshNode);
else if (scene.listChildren().includes(meshNode)) scene.removeChild(meshNode);
else throw new Error('Source mesh node is detached from the scene.');
meshNode.setName('MagmaSpikeDemonMesh');
const rigContainer = doc.createNode('MagmaSpikeDemonArmature').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([presentationScale, presentationScale, presentationScale]);
scene.addChild(rigContainer);
rigContainer.addChild(meshNode);

const jointNodes = new Map();
for (const bone of bones) {
  const node = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  jointNodes.set(bone.name, node);
  const parent = bone.parent ? jointNodes.get(bone.parent) : rigContainer;
  parent.addChild(node);
}
const skin = doc.createSkin('MagmaSpikeDemon_Humanoid').setSkeleton(jointNodes.get('mixamorigHips'));
for (const bone of bones) skin.addJoint(jointNodes.get(bone.name));
const inverseBinds = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i++) {
  const [x, y, z] = bones[i].p;
  inverseBinds.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
}
const buffer = root.listBuffers()[0];
skin.setInverseBindMatrices(doc.createAccessor('MagmaSpikeDemon_InverseBind').setArray(inverseBinds).setType(Accessor.Type.MAT4).setBuffer(buffer));
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
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const [x, y] = point;
  const normalizedX = x / (width * 0.5) * 0.405;
  const normalizedY = y / height * 0.875;
  const candidates = [];
  for (const bone of bones) {
    let gate = 1;
    if (bone.group === 'head') gate = normalizedY >= 0.70 ? 1 : 0.015;
    if (bone.group === 'leftArm' || bone.group === 'rightArm') {
      gate = normalizedY > 0.235 && normalizedY < 0.92 ? 1 : 0.008;
      const lateral = bone.side * normalizedX;
      gate *= 0.02 + 0.98 / (1 + Math.exp(-(lateral + 0.018) / 0.040));
    }
    if (bone.group === 'leftLeg' || bone.group === 'rightLeg') {
      gate = normalizedY < 0.52 ? 1 : 0.006;
      const lateral = bone.side * normalizedX;
      gate *= 0.02 + 0.98 / (1 + Math.exp(-(lateral + 0.012) / 0.045));
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
primitive.setAttribute('JOINTS_0', doc.createAccessor('MagmaSpikeDemon_Joints0').setArray(jointValues).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('MagmaSpikeDemon_Weights0').setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(buffer));

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
    if (track.node === 'mixamorigHips' && track.path === 'translation') track.values = track.values.map(([x, y, z]) => [x * scaleX, y * scaleY, z * scaleZ]);
    const input = doc.createAccessor(`${name}_${track.node}_time`).setArray(Float32Array.from(track.times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const output = doc.createAccessor(`${name}_${track.node}_${track.path ?? 'rotation'}_value`).setArray(Float32Array.from(track.values.flat())).setType(track.path === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4).setBuffer(buffer);
    const sampler = doc.createAnimationSampler(`${name}_${track.node}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${track.node}_${track.path ?? 'rotation'}`).setTargetNode(jointNodes.get(track.node)).setTargetPath(track.path ?? 'rotation').setSampler(sampler));
  }
  clips.push({ name, seconds, channels: tracks.length });
}
const phases = [0, 0.25, 0.5, 0.75, 1];
const cycleAngles = (phase, amount) => phases.map((t) => quat('x', Math.sin((t + phase) * Math.PI * 2) * amount));
const hips = (heights, forward = -0.09) => phases.map((_, i) => [0, heights[i], forward]);
addClip('Idle', 2.8, [
  { node: 'mixamorigSpine1', times: [0, 0.7, 1.4, 2.1, 2.8], values: [quat('z', 0), quat('z', 0.018), quat('z', 0), quat('z', -0.018), quat('z', 0)] },
  { node: 'mixamorigSpine2', times: [0, 0.7, 1.4, 2.1, 2.8], values: [quat('x', 0), quat('x', -0.015), quat('x', 0), quat('x', 0.012), quat('x', 0)] },
  { node: 'mixamorigHead', times: [0, 0.7, 1.4, 2.1, 2.8], values: [quat('y', -0.025), quat('y', 0.015), quat('y', 0.035), quat('y', -0.015), quat('y', -0.025)] },
]);
addClip('Walk', 1.0, [
  { node: 'mixamorigHips', path: 'translation', times: phases.map((t) => t), values: hips([0.390, 0.405, 0.390, 0.405, 0.390]) },
  { node: 'mixamorigLeftUpLeg', times: phases, values: cycleAngles(0, 0.34) },
  { node: 'mixamorigRightUpLeg', times: phases, values: cycleAngles(0.5, 0.34) },
  { node: 'mixamorigLeftLeg', times: phases, values: phases.map((t) => quat('x', -Math.max(0, Math.sin(t * Math.PI * 2)) * 0.22)) },
  { node: 'mixamorigRightLeg', times: phases, values: phases.map((t) => quat('x', -Math.max(0, Math.sin((t + 0.5) * Math.PI * 2)) * 0.22)) },
  { node: 'mixamorigLeftArm', times: phases, values: cycleAngles(0.5, 0.20) },
  { node: 'mixamorigRightArm', times: phases, values: cycleAngles(0, 0.20) },
]);
addClip('Run', 0.72, [
  { node: 'mixamorigHips', path: 'translation', times: phases.map((t) => t * 0.72), values: hips([0.390, 0.425, 0.390, 0.425, 0.390]) },
  { node: 'mixamorigLeftUpLeg', times: phases.map((t) => t * 0.72), values: cycleAngles(0, 0.68) },
  { node: 'mixamorigRightUpLeg', times: phases.map((t) => t * 0.72), values: cycleAngles(0.5, 0.68) },
  { node: 'mixamorigLeftLeg', times: phases.map((t) => t * 0.72), values: phases.map((t) => quat('x', -Math.max(0, Math.sin(t * Math.PI * 2)) * 0.62)) },
  { node: 'mixamorigRightLeg', times: phases.map((t) => t * 0.72), values: phases.map((t) => quat('x', -Math.max(0, Math.sin((t + 0.5) * Math.PI * 2)) * 0.62)) },
  { node: 'mixamorigLeftArm', times: phases.map((t) => t * 0.72), values: cycleAngles(0.5, 0.48) },
  { node: 'mixamorigRightArm', times: phases.map((t) => t * 0.72), values: cycleAngles(0, 0.48) },
  { node: 'mixamorigSpine1', times: phases.map((t) => t * 0.72), values: phases.map((t) => quat('x', 0.025 + Math.sin(t * Math.PI * 2) * 0.025)) },
]);
addClip('Attack', 0.92, [
  { node: 'mixamorigHips', path: 'translation', times: [0, 0.18, 0.50, 0.72, 0.92], values: [[0, 0.390, -0.090], [0, 0.390, -0.060], [0, 0.380, 0.010], [0, 0.390, -0.025], [0, 0.390, -0.090]] },
  { node: 'mixamorigSpine1', times: [0, 0.18, 0.50, 0.72, 0.92], values: [quat('y', 0), quat('y', -0.28), quat('y', 0.24), quat('y', 0.10), quat('y', 0)] },
  { node: 'mixamorigRightArm', times: [0, 0.18, 0.50, 0.72, 0.92], values: [quat('z', 0), quat('z', 0.78), quat('z', -0.18), quat('z', -0.28), quat('z', 0)] },
  { node: 'mixamorigRightForeArm', times: [0, 0.18, 0.50, 0.72, 0.92], values: [quat('x', 0), quat('x', 0.60), quat('x', -0.92), quat('x', -0.30), quat('x', 0)] },
  { node: 'mixamorigLeftArm', times: [0, 0.18, 0.50, 0.72, 0.92], values: [quat('x', 0), quat('x', -0.20), quat('x', -0.28), quat('x', 0.10), quat('x', 0)] },
]);
addClip('Hit', 0.46, [
  { node: 'mixamorigHips', path: 'translation', times: [0, 0.08, 0.20, 0.46], values: [[0, 0.390, -0.090], [0, 0.385, -0.125], [0, 0.388, -0.102], [0, 0.390, -0.090]] },
  { node: 'mixamorigSpine1', times: [0, 0.08, 0.20, 0.46], values: [quat('z', 0), quat('z', 0.28), quat('z', -0.10), quat('z', 0)] },
  { node: 'mixamorigSpine2', times: [0, 0.08, 0.20, 0.46], values: [quat('x', 0), quat('x', -0.16), quat('x', 0.06), quat('x', 0)] },
  { node: 'mixamorigHead', times: [0, 0.08, 0.20, 0.46], values: [quat('z', 0), quat('z', 0.20), quat('z', -0.05), quat('z', 0)] },
  { node: 'mixamorigRightArm', times: [0, 0.08, 0.20, 0.46], values: [quat('x', 0), quat('x', 0.35), quat('x', -0.08), quat('x', 0)] },
]);
addClip('Death', 1.45, [
  { node: 'mixamorigHips', path: 'translation', times: [0, 0.22, 0.65, 1.05, 1.45], values: [[0, 0.390, -0.090], [0, 0.360, -0.105], [0, 0.265, -0.125], [0, 0.225, -0.125], [0, 0.225, -0.125]] },
  { node: 'mixamorigHips', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('z', 0), quat('z', -0.08), quat('z', -0.26), quat('z', -0.34), quat('z', -0.34)] },
  { node: 'mixamorigSpine1', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('x', 0), quat('x', 0.14), quat('x', 0.28), quat('x', 0.34), quat('x', 0.34)] },
  { node: 'mixamorigSpine2', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('x', 0), quat('x', 0.12), quat('x', 0.22), quat('x', 0.24), quat('x', 0.24)] },
  { node: 'mixamorigHead', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('z', 0), quat('z', 0.12), quat('z', 0.28), quat('z', 0.35), quat('z', 0.35)] },
  { node: 'mixamorigLeftArm', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('x', 0), quat('x', 0.15), quat('x', 0.60), quat('x', 0.66), quat('x', 0.66)] },
  { node: 'mixamorigRightArm', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('x', 0), quat('x', -0.12), quat('x', -0.50), quat('x', -0.56), quat('x', -0.56)] },
  { node: 'mixamorigLeftUpLeg', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('x', 0), quat('x', -0.06), quat('x', -0.24), quat('x', -0.30), quat('x', -0.30)] },
  { node: 'mixamorigRightUpLeg', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('x', 0), quat('x', 0.06), quat('x', 0.25), quat('x', 0.31), quat('x', 0.31)] },
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
const packedMap = await sharp(metallicRoughnessTexture.getImage()).removeAlpha().resize(128, 128).raw().toBuffer();
const pbrRange = [Infinity, -Infinity];
for (let i = 2; i < packedMap.length; i += 3) {
  const metallic = packedMap[i] / 255;
  pbrRange[0] = Math.min(pbrRange[0], metallic);
  pbrRange[1] = Math.max(pbrRange[1], metallic);
}
if (!(pbrRange[1] - pbrRange[0] > 0.05)) throw new Error(`Packed metallic channel is effectively flat: ${pbrRange}`);

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
const checkContainer = checkRoot.listNodes().find((node) => node.getName() === 'MagmaSpikeDemonArmature');
const checkScale = checkContainer?.getScale();
if (!checkScale || checkScale.some((value) => Math.abs(value - presentationScale) > 1e-7)) throw new Error('Serialized rig container scale does not match presentation scale.');
if (!checkPositions || !checkNormals || !checkUvs || !checkIndices || !checkJoints || !checkWeights || !checkSkin) throw new Error('Exported candidate is missing required skin attributes.');
let maxPositionDelta = 0;
let indexMismatches = 0;
let maxNormalDelta = 0, maxUvDelta = 0;
const sourceNormals = primitive.getAttribute('NORMAL').getArray(), sourceUvs = primitive.getAttribute('TEXCOORD_0').getArray();
for (let i = 0; i < checkNormals.length; i++) maxNormalDelta = Math.max(maxNormalDelta, Math.abs(checkNormals[i] - sourceNormals[i]));
for (let i = 0; i < checkUvs.length; i++) maxUvDelta = Math.max(maxUvDelta, Math.abs(checkUvs[i] - sourceUvs[i]));
let verticesWithDistributedWeights = 0;
for (let i = 0; i < checkPositions.length; i++) maxPositionDelta = Math.max(maxPositionDelta, Math.abs(checkPositions[i] - positions[i]));
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
  id: 'creature_magma_spike_demon',
  displayName: 'Magma Spike Demon',
  status: 'awaiting-root-lab-review',
  accepted: false,
  source: {
    file: sourcePath,
    sha256: sourceSha256,
    bytes: sourceBytes.length,
    starredModelId: 'd64af48c-ff32-405e-a05d-86ffe671cbcb',
    starredCardId: 'd64af48c-ff32-405e-a05d-86ffe671cbcb',
    starredDisplayName: 'demon creature 3d model',
    geometry: { vertices: positions.length / 3, triangles: indices.length / 3, bounds, positionsPreserved: maxPositionDelta === 0, indicesPreserved: indexMismatches === 0, retopology: false, retainedTopology: true, removedForeignComponents: 4, removedForeignTriangles: 256 },
    preliminaryDesignReview: 'Removed four detached row-boundary foreign shard components assigned from the adjacent C1 cell (256 triangles); remaining C4 geometry, UVs, normals, PBR and topology are preserved without retopology. Rig and motion remain staged for root lab review.',
    textures: sourceTextureMetrics,
    sourceSkin: 'none',
    filtering: { method: 'Removed four detached C1 row-boundary shards by welded spatial connected component; preserved all remaining triangles and source vertex attributes without retopology.', originalExtractedSha256: '8a694dfb5d8158dd8ad23f6fea0c68c338e8a33a89a5abc3b5d3379b162b321d', removedComponents: [{ triangles: 57 }, { triangles: 67 }, { triangles: 61 }, { triangles: 71 }] },
    sourceAnimations: [],
  },
  candidate: {
    file: candidatePath,
    sha256: candidateSha256,
    bytes: outputBytes.length,
    productionTarget: 'game/public/assets/models/creature/creature_magma_spike_demon.glb',
    geometry: { vertices: positions.length / 3, triangles: indices.length / 3, nativeBounds: bounds, positionsPreserved: true, normalsPreserved: true, uvsPreserved: true, indicesPreserved: true, scaleFactor: presentationScale, targetHeightMeters: targetHeight },
    rig: { type: 'Mixamo-named humanoid glTF skin for Unity Humanoid mapping review', joints: bones.map((bone) => ({ name: bone.name, parent: bone.parent, position: bone.p })), influencesPerVertex: 4, verticesWithDistributedWeights, maximumWeightSumError, method: 'Model-specific four-weight skin from anatomical bone-segment distance fields; no fallback to one root joint.' },
    textures: runtimeTextureMetrics,
    packedMetallicChannelRange: pbrRange,
    animations: clips,
  },
  acceptance: { sourceDesignAudit: true, geometry: true, rig: false, animation: false, textures: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${baseDir}/catalog.json`, JSON.stringify(candidate, null, 2) + '\n');

const labAsset = {
  id: 'creature_magma_spike_demon',
  file: 'models/creature/creature_magma_spike_demon.glb',
  pack: 'corealm-starred-creatures',
  category: 'character',
  is: 'Magma Spike Demon',
  tags: ['creature', 'humanoid', 'demon', 'starred', 'tripo', 'candidate'],
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
    sourceModelId: 'd64af48c-ff32-405e-a05d-86ffe671cbcb',
    sourceCardId: 'd64af48c-ff32-405e-a05d-86ffe671cbcb',
    sourceFile: sourcePath,
    sourceSha256,
    candidateFile: candidatePath,
    candidateSha256,
    rigMethod: 'Mixamo-named humanoid skeleton scaled to source bounds with four anatomical distance-field influences; source mesh topology, positions, normals, UVs and PBR maps are retained.',
    textures: runtimeTextureMetrics,
    candidateStatus: 'awaiting-root-lab-review',
    sourceFiltering: 'Four detached C1 row-boundary shards removed (256 triangles); retained C4 mesh topology, UVs, normals, and PBR maps unchanged.'
  },
  acceptance: { assetAudit: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${baseDir}/lab-catalog.json`, JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', assets: [labAsset] }, null, 2) + '\n');
console.log(JSON.stringify({ candidatePath, bytes: outputBytes.length, candidateSha256, scaleFactor: presentationScale, targetHeightMeters: targetHeight, triangles: indices.length / 3, vertices: positions.length / 3, joints: bones.length, clips: clips.map(({ name, seconds }) => ({ name, seconds })), runtimeTextureMetrics, verticesWithDistributedWeights, maximumWeightSumError, maxPositionDelta, indexMismatches }, null, 2));
