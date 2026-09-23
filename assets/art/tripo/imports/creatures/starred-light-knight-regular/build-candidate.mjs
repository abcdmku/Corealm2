import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const baseDir = 'assets/art/tripo/imports/creatures/starred-light-knight-regular';
const sourcePath = 'assets/art/tripo/exports/3255ba4a-055e-446b-9c47-0266c347710a.glb';
const candidatePath = `${baseDir}/pearl-patrol-knight-native-rig.glb`;
const expectedSourceHash = '9f0cb9c3eedc9645957e9bdd921b6ad44ad62a560325e42078505ff4dd452ba4';
await mkdir(baseDir, { recursive: true });

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourcePath);
const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
if (sourceHash !== expectedSourceHash) throw new Error(`Starred Light Knight source changed: ${sourceHash}`);
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find((node) => node.getMesh() === mesh);
if (!scene || !mesh || !primitive || !meshNode || root.listSkins().length || root.listAnimations().length) {
  throw new Error('Expected the approved static Light Knight export, without a Tripo skin or clips.');
}

const positions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
const indices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
const normals = Float32Array.from(primitive.getAttribute('NORMAL')?.getArray() ?? []);
const uvs = Float32Array.from(primitive.getAttribute('TEXCOORD_0')?.getArray() ?? []);
if (positions.length / 3 !== 7637 || indices.length / 3 !== 4697 || normals.length !== positions.length || uvs.length / 2 !== positions.length / 3) {
  throw new Error(`Source topology/UV contract changed: ${positions.length / 3} vertices, ${indices.length / 3} triangles.`);
}
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis += 1) {
  bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
  bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
}
if (bounds.min[1] !== 0 || Math.abs(bounds.max[1] - 0.990234375) > 1e-7) throw new Error('Starred source bounds changed.');

// A 22-joint Unity Humanoid-named rig fitted to the source's lateral T-pose. Mesh
// positions, indices, normals, UV islands and generated maps remain from the export.
const bones = [
  { name: 'mixamorigHips', parent: null, p: [0, 0.365, -0.012], sigma: 0.10, group: 'torso' },
  { name: 'mixamorigSpine', parent: 'mixamorigHips', p: [0, 0.465, -0.012], sigma: 0.095, group: 'torso' },
  { name: 'mixamorigSpine1', parent: 'mixamorigSpine', p: [0, 0.565, -0.020], sigma: 0.105, group: 'torso' },
  { name: 'mixamorigSpine2', parent: 'mixamorigSpine1', p: [0, 0.675, -0.024], sigma: 0.095, group: 'torso' },
  { name: 'mixamorigNeck', parent: 'mixamorigSpine2', p: [0, 0.800, -0.025], sigma: 0.070, group: 'neck' },
  { name: 'mixamorigHead', parent: 'mixamorigNeck', p: [0, 0.895, -0.022], sigma: 0.095, group: 'head' },
  { name: 'mixamorigLeftShoulder', parent: 'mixamorigSpine2', p: [-0.105, 0.715, -0.022], sigma: 0.065, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftArm', parent: 'mixamorigLeftShoulder', p: [-0.245, 0.750, -0.018], sigma: 0.060, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftForeArm', parent: 'mixamorigLeftArm', p: [-0.365, 0.750, -0.012], sigma: 0.055, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftHand', parent: 'mixamorigLeftForeArm', p: [-0.455, 0.750, -0.005], sigma: 0.060, group: 'leftArm', side: -1 },
  { name: 'mixamorigRightShoulder', parent: 'mixamorigSpine2', p: [0.105, 0.715, -0.022], sigma: 0.065, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightArm', parent: 'mixamorigRightShoulder', p: [0.245, 0.750, -0.018], sigma: 0.060, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightForeArm', parent: 'mixamorigRightArm', p: [0.365, 0.750, -0.012], sigma: 0.055, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightHand', parent: 'mixamorigRightForeArm', p: [0.455, 0.750, -0.005], sigma: 0.060, group: 'rightArm', side: 1 },
  { name: 'mixamorigLeftUpLeg', parent: 'mixamorigHips', p: [-0.090, 0.305, -0.010], sigma: 0.070, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftLeg', parent: 'mixamorigLeftUpLeg', p: [-0.105, 0.160, -0.004], sigma: 0.062, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftFoot', parent: 'mixamorigLeftLeg', p: [-0.105, 0.055, 0.015], sigma: 0.050, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftToeBase', parent: 'mixamorigLeftFoot', p: [-0.105, 0.035, 0.073], sigma: 0.047, group: 'leftLeg', side: -1 },
  { name: 'mixamorigRightUpLeg', parent: 'mixamorigHips', p: [0.090, 0.305, -0.010], sigma: 0.070, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightLeg', parent: 'mixamorigRightUpLeg', p: [0.105, 0.160, -0.004], sigma: 0.062, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightFoot', parent: 'mixamorigRightLeg', p: [0.105, 0.055, 0.015], sigma: 0.050, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightToeBase', parent: 'mixamorigRightFoot', p: [0.105, 0.035, 0.073], sigma: 0.047, group: 'rightLeg', side: 1 },
];
const byName = new Map(bones.map((bone, index) => [bone.name, { ...bone, index }]));
for (const bone of bones) {
  const parent = bone.parent ? byName.get(bone.parent) : null;
  bone.local = parent ? bone.p.map((value, axis) => value - parent.p[axis]) : [...bone.p];
}

const oldParent = meshNode.getParentNode();
if (oldParent) oldParent.removeChild(meshNode);
else if (scene.listChildren().includes(meshNode)) scene.removeChild(meshNode);
else throw new Error('Source mesh is unexpectedly detached from its scene.');
meshNode.setName('PearlPatrolKnightMesh');
const container = doc.createNode('PearlPatrolKnightArmature').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
scene.addChild(container);
container.addChild(meshNode);
const nodes = new Map();
for (const bone of bones) {
  const node = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  nodes.set(bone.name, node);
  (bone.parent ? nodes.get(bone.parent) : container).addChild(node);
}
const skin = doc.createSkin('PearlPatrolKnight_UnityHumanoid').setSkeleton(nodes.get('mixamorigHips'));
for (const bone of bones) skin.addJoint(nodes.get(bone.name));
const inverseBind = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i += 1) {
  const [x, y, z] = bones[i].p;
  inverseBind.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
}
const buffer = root.listBuffers()[0] ?? doc.createBuffer('Pearl patrol rig and animation data');
skin.setInverseBindMatrices(doc.createAccessor('PearlPatrolKnight_InverseBind').setArray(inverseBind).setType(Accessor.Type.MAT4).setBuffer(buffer));
meshNode.setSkin(skin);

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const distanceToSegment = (point, a, b) => {
  const vector = b.map((value, axis) => value - a[axis]);
  const offset = point.map((value, axis) => value - a[axis]);
  const length2 = vector.reduce((sum, value) => sum + value * value, 0) || 1;
  const t = Math.max(0, Math.min(1, offset.reduce((sum, value, axis) => sum + value * vector[axis], 0) / length2));
  return Math.hypot(...point.map((value, axis) => value - (a[axis] + vector[axis] * t)));
};
const armBand = (y) => smooth(0.63, 0.72, y) * (1 - smooth(0.80, 0.89, y));
const legBand = (y) => 1 - smooth(0.37, 0.49, y);
const joints = new Uint16Array(positions.length / 3 * 4);
const weights = new Float32Array(positions.length / 3 * 4);
const influenceCounts = new Uint32Array(bones.length);
let distributedVertices = 0, maxWeightError = 0;
for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const [x, y] = point;
  const candidates = [];
  for (const bone of bones) {
    let gate = 1;
    if (bone.group === 'head') gate = smooth(0.78, 0.865, y);
    if (bone.group === 'neck') gate = smooth(0.70, 0.79, y) * (1 - smooth(0.83, 0.91, y));
    if (bone.group === 'leftArm' || bone.group === 'rightArm') {
      gate = armBand(y) * smooth(0.075, 0.205, bone.side * x);
    }
    if (bone.group === 'leftLeg' || bone.group === 'rightLeg') {
      gate = legBand(y) * smooth(0.025, 0.095, bone.side * x);
    }
    const parent = bone.parent ? byName.get(bone.parent) : null;
    const distance = distanceToSegment(point, parent?.p ?? bone.p, bone.p);
    const score = gate * Math.exp(-0.5 * (distance / bone.sigma) ** 2);
    if (score > 1e-11) candidates.push({ index: byName.get(bone.name).index, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 4);
  const total = chosen.reduce((sum, item) => sum + item.score, 0);
  if (!chosen.length || !(total > 0) || !Number.isFinite(total)) throw new Error(`No anatomical support for vertex ${vertex}.`);
  let assigned = 0;
  for (let slot = 0; slot < 4; slot += 1) {
    const candidate = chosen[slot] ?? chosen[0];
    const weight = slot >= chosen.length ? 0 : slot === chosen.length - 1 ? 1 - assigned : candidate.score / total;
    joints[vertex * 4 + slot] = candidate.index;
    weights[vertex * 4 + slot] = weight;
    assigned += weight;
    if (weight > 1e-6) influenceCounts[candidate.index] += 1;
  }
  const sum = weights[vertex * 4] + weights[vertex * 4 + 1] + weights[vertex * 4 + 2] + weights[vertex * 4 + 3];
  maxWeightError = Math.max(maxWeightError, Math.abs(sum - 1));
  if (Math.abs(sum - 1) > 1e-5) throw new Error(`Vertex ${vertex} weights sum to ${sum}.`);
  if (weights[vertex * 4 + 1] + weights[vertex * 4 + 2] + weights[vertex * 4 + 3] > 1e-5) distributedVertices += 1;
}
for (const bone of bones) if (influenceCounts[byName.get(bone.name).index] < 2) throw new Error(`Unused fitted joint: ${bone.name}`);
primitive.setAttribute('JOINTS_0', doc.createAccessor('PearlPatrolKnight_Joints0').setArray(joints).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('PearlPatrolKnight_Weights0').setArray(weights).setType(Accessor.Type.VEC4).setBuffer(buffer));

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
    const path = track.path ?? 'rotation';
    const times = track.times ?? track.values.map((_, index) => index * seconds / (track.values.length - 1));
    const input = doc.createAccessor(`${name}_${track.node}_${path}_time`).setArray(Float32Array.from(times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const output = doc.createAccessor(`${name}_${track.node}_${path}_value`).setArray(Float32Array.from(track.values.flat())).setType(path === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4).setBuffer(buffer);
    const sampler = doc.createAnimationSampler(`${name}_${track.node}_${path}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${track.node}_${path}`).setTargetNode(nodes.get(track.node)).setTargetPath(path).setSampler(sampler));
  }
  clips.push({ name, seconds, channels: tracks.length });
}
const phases = [0, 0.25, 0.5, 0.75, 1];
const swing = (phase, magnitude) => phases.map((t) => quat('x', Math.sin((t + phase) * Math.PI * 2) * magnitude));
const hipsY = (values, z = -0.012) => values.map((y) => [0, y, z]);
addClip('Idle', 2.6, [
  { node: 'mixamorigSpine1', times: [0, 0.65, 1.3, 1.95, 2.6], values: [quat('z', 0), quat('z', 0.012), quat('z', 0), quat('z', -0.012), quat('z', 0)] },
  { node: 'mixamorigSpine2', times: [0, 0.65, 1.3, 1.95, 2.6], values: [quat('y', 0), quat('y', 0.012), quat('y', 0), quat('y', -0.012), quat('y', 0)] },
  { node: 'mixamorigHead', times: [0, 0.65, 1.3, 1.95, 2.6], values: [quat('y', -0.02), quat('y', 0), quat('y', 0.025), quat('y', 0), quat('y', -0.02)] },
]);
addClip('Walk', 1.0, [
  { node: 'mixamorigHips', path: 'translation', times: phases, values: hipsY([0.365, 0.376, 0.365, 0.376, 0.365]) },
  { node: 'mixamorigLeftUpLeg', times: phases, values: swing(0, 0.30) },
  { node: 'mixamorigRightUpLeg', times: phases, values: swing(0.5, 0.30) },
  { node: 'mixamorigLeftLeg', times: phases, values: phases.map((t) => quat('x', -Math.max(0, Math.sin(t * Math.PI * 2)) * 0.18)) },
  { node: 'mixamorigRightLeg', times: phases, values: phases.map((t) => quat('x', -Math.max(0, Math.sin((t + 0.5) * Math.PI * 2)) * 0.18)) },
  { node: 'mixamorigLeftArm', times: phases, values: swing(0.5, 0.30) },
  { node: 'mixamorigRightArm', times: phases, values: swing(0, 0.30) },
]);
addClip('Run', 0.72, [
  { node: 'mixamorigHips', path: 'translation', times: phases.map((t) => t * 0.72), values: hipsY([0.365, 0.390, 0.365, 0.390, 0.365]) },
  { node: 'mixamorigLeftUpLeg', times: phases.map((t) => t * 0.72), values: swing(0, 0.58) },
  { node: 'mixamorigRightUpLeg', times: phases.map((t) => t * 0.72), values: swing(0.5, 0.58) },
  { node: 'mixamorigLeftLeg', times: phases.map((t) => t * 0.72), values: phases.map((t) => quat('x', -Math.max(0, Math.sin(t * Math.PI * 2)) * 0.46)) },
  { node: 'mixamorigRightLeg', times: phases.map((t) => t * 0.72), values: phases.map((t) => quat('x', -Math.max(0, Math.sin((t + 0.5) * Math.PI * 2)) * 0.46)) },
  { node: 'mixamorigLeftArm', times: phases.map((t) => t * 0.72), values: phases.map((t) => quat('y', Math.sin((t + 0.5) * Math.PI * 2) * 0.36)) },
  { node: 'mixamorigRightArm', times: phases.map((t) => t * 0.72), values: phases.map((t) => quat('y', Math.sin(t * Math.PI * 2) * 0.36)) },
  { node: 'mixamorigSpine1', times: phases.map((t) => t * 0.72), values: phases.map((t) => quat('x', 0.025 + Math.sin(t * Math.PI * 2) * 0.025)) },
]);
addClip('Attack', 0.92, [
  { node: 'mixamorigHips', path: 'translation', times: [0, 0.18, 0.48, 0.72, 0.92], values: [[0, 0.365, -0.012], [0, 0.365, -0.028], [0, 0.355, 0.025], [0, 0.365, 0.010], [0, 0.365, -0.012]] },
  { node: 'mixamorigSpine1', times: [0, 0.18, 0.48, 0.72, 0.92], values: [quat('y', 0), quat('y', -0.14), quat('y', 0.14), quat('y', 0.06), quat('y', 0)] },
  { node: 'mixamorigRightArm', times: [0, 0.18, 0.48, 0.72, 0.92], values: [quat('y', 0), quat('y', -0.28), quat('y', -0.92), quat('y', -0.35), quat('y', 0)] },
  { node: 'mixamorigRightForeArm', times: [0, 0.18, 0.48, 0.72, 0.92], values: [quat('z', 0), quat('z', -0.16), quat('z', -0.42), quat('z', -0.18), quat('z', 0)] },
  { node: 'mixamorigLeftArm', times: [0, 0.18, 0.48, 0.72, 0.92], values: [quat('y', 0), quat('y', 0.10), quat('y', 0.28), quat('y', 0.12), quat('y', 0)] },
]);
addClip('Hit', 0.46, [
  { node: 'mixamorigHips', path: 'translation', times: [0, 0.08, 0.20, 0.46], values: [[0, 0.365, -0.012], [0, 0.360, -0.040], [0, 0.363, -0.025], [0, 0.365, -0.012]] },
  { node: 'mixamorigSpine1', times: [0, 0.08, 0.20, 0.46], values: [quat('z', 0), quat('z', 0.20), quat('z', -0.08), quat('z', 0)] },
  { node: 'mixamorigSpine2', times: [0, 0.08, 0.20, 0.46], values: [quat('x', 0), quat('x', -0.13), quat('x', 0.05), quat('x', 0)] },
  { node: 'mixamorigHead', times: [0, 0.08, 0.20, 0.46], values: [quat('z', 0), quat('z', 0.13), quat('z', -0.035), quat('z', 0)] },
  { node: 'mixamorigRightArm', times: [0, 0.08, 0.20, 0.46], values: [quat('y', 0), quat('y', -0.24), quat('y', 0.06), quat('y', 0)] },
]);
addClip('Death', 1.45, [
  { node: 'mixamorigHips', path: 'translation', times: [0, 0.22, 0.65, 1.05, 1.45], values: [[0, 0.365, -0.012], [0, 0.345, -0.020], [0, 0.245, -0.030], [0, 0.205, -0.030], [0, 0.205, -0.030]] },
  { node: 'mixamorigHips', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('z', 0), quat('z', -0.10), quat('z', -0.54), quat('z', -0.92), quat('z', -0.92)] },
  { node: 'mixamorigSpine1', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('x', 0), quat('x', 0.10), quat('x', 0.20), quat('x', 0.20), quat('x', 0.20)] },
  { node: 'mixamorigSpine2', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('x', 0), quat('x', 0.08), quat('x', 0.16), quat('x', 0.16), quat('x', 0.16)] },
  { node: 'mixamorigHead', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('z', 0), quat('z', 0.10), quat('z', 0.22), quat('z', 0.22), quat('z', 0.22)] },
  { node: 'mixamorigLeftArm', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('z', 0), quat('z', -0.10), quat('z', -0.35), quat('z', -0.35), quat('z', -0.35)] },
  { node: 'mixamorigRightArm', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('z', 0), quat('z', 0.08), quat('z', 0.30), quat('z', 0.30), quat('z', 0.30)] },
  { node: 'mixamorigLeftUpLeg', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('x', 0), quat('x', -0.06), quat('x', -0.18), quat('x', -0.18), quat('x', -0.18)] },
  { node: 'mixamorigRightUpLeg', times: [0, 0.22, 0.65, 1.05, 1.45], values: [quat('x', 0), quat('x', 0.06), quat('x', 0.18), quat('x', 0.18), quat('x', 0.18)] },
]);

const material = root.listMaterials()[0];
const baseColorTexture = material?.getBaseColorTexture();
const metalRoughTexture = material?.getMetallicRoughnessTexture();
const normalTexture = material?.getNormalTexture();
if (!material || !baseColorTexture || !metalRoughTexture || !normalTexture) throw new Error('Starred armor source is missing its base-color, packed PBR, or normal map.');
const sourceTextures = [], runtimeTextures = [];
for (const texture of root.listTextures()) {
  const image = texture.getImage();
  const metadata = await sharp(image).metadata();
  sourceTextures.push({ name: texture.getName(), width: metadata.width, height: metadata.height, mime: texture.getMimeType(), sha256: createHash('sha256').update(image).digest('hex') });
  if (metadata.width > 2048 || metadata.height > 2048) {
    const isDataTexture = texture === metalRoughTexture;
    const resized = await sharp(image).resize(2048, 2048, { fit: 'fill', kernel: isDataTexture ? 'linear' : 'lanczos3' })
      .toFormat(metadata.format === 'jpeg' ? 'jpeg' : 'png', metadata.format === 'jpeg' ? { quality: 93, chromaSubsampling: '4:4:4' } : {})
      .toBuffer();
    texture.setImage(resized);
  }
  const resized = await sharp(texture.getImage()).metadata();
  if (resized.width !== 2048 || resized.height !== 2048) throw new Error(`Expected exact 2K runtime PBR texture: ${texture.getName()}`);
  runtimeTextures.push({ name: texture.getName(), width: resized.width, height: resized.height, mime: texture.getMimeType(), bytes: texture.getImage().length });
}
const materialSample = await sharp(metalRoughTexture.getImage()).removeAlpha().resize(128, 128).raw().toBuffer();
const metalRange = [Infinity, -Infinity], roughRange = [Infinity, -Infinity];
for (let i = 0; i < materialSample.length; i += 3) {
  roughRange[0] = Math.min(roughRange[0], materialSample[i + 1] / 255);
  roughRange[1] = Math.max(roughRange[1], materialSample[i + 1] / 255);
  metalRange[0] = Math.min(metalRange[0], materialSample[i + 2] / 255);
  metalRange[1] = Math.max(metalRange[1], materialSample[i + 2] / 255);
}
if (metalRange[1] - metalRange[0] < 0.20 || roughRange[1] - roughRange[0] < 0.20) throw new Error(`Armor PBR channels lost variation: metal ${metalRange}, roughness ${roughRange}.`);

const bytes = await io.writeBinary(doc);
await writeFile(candidatePath, bytes);
const candidateHash = createHash('sha256').update(bytes).digest('hex');
const check = await io.readBinary(bytes);
const checkRoot = check.getRoot();
const checkMesh = checkRoot.listMeshes()[0];
const checkPrimitive = checkMesh.listPrimitives()[0];
const outPositions = checkPrimitive.getAttribute('POSITION')?.getArray();
const outNormals = checkPrimitive.getAttribute('NORMAL')?.getArray();
const outUvs = checkPrimitive.getAttribute('TEXCOORD_0')?.getArray();
const outIndices = checkPrimitive.getIndices()?.getArray();
const outJoints = checkPrimitive.getAttribute('JOINTS_0')?.getArray();
const outWeights = checkPrimitive.getAttribute('WEIGHTS_0')?.getArray();
const outSkin = checkRoot.listSkins()[0];
if (!outPositions || !outNormals || !outUvs || !outIndices || !outJoints || !outWeights || !outSkin) throw new Error('Generated knight GLB is missing render, UV, or skin attributes.');
if (outPositions.length !== positions.length || outNormals.length !== normals.length || outUvs.length !== uvs.length || outIndices.length !== indices.length) throw new Error('Original mesh buffers changed length.');
for (let i = 0; i < positions.length; i += 1) if (outPositions[i] !== positions[i] || outNormals[i] !== normals[i] || outUvs[i] !== uvs[i]) throw new Error(`Mesh/normal/UV changed at scalar ${i}.`);
for (let i = 0; i < indices.length; i += 1) if (outIndices[i] !== indices[i]) throw new Error(`Index order changed at ${i}.`);
for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
  let sum = 0;
  for (let slot = 0; slot < 4; slot += 1) {
    const joint = outJoints[vertex * 4 + slot], weight = outWeights[vertex * 4 + slot];
    if (!Number.isInteger(joint) || joint < 0 || joint >= outSkin.listJoints().length || !Number.isFinite(weight) || weight < 0) throw new Error(`Bad influence at vertex ${vertex}.`);
    sum += weight;
  }
  if (Math.abs(sum - 1) > 1e-5) throw new Error(`Output influence sum is ${sum} at vertex ${vertex}.`);
}
const clipNames = checkRoot.listAnimations().map((animation) => animation.getName());
const requiredClips = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
if (requiredClips.some((name) => !clipNames.includes(name))) throw new Error('Generated knight is missing a required action clip.');
for (const animation of checkRoot.listAnimations()) for (const channel of animation.listChannels()) {
  if (!outSkin.listJoints().includes(channel.getTargetNode())) throw new Error(`${animation.getName()} targets a non-joint node.`);
}

const candidate = {
  schema: 'corealm-creature-native-rig-candidate/1',
  id: 'creature_pearl_knight',
  displayName: 'Crownward Pearl Knight',
  status: 'awaiting-root-lab-review',
  accepted: false,
  source: {
    file: sourcePath,
    sha256: sourceHash,
    bytes: sourceBytes.length,
    starredModelId: '7449b4c6-86b9-44e4-a26b-5f02e3c00a72',
    starredCardId: '3255ba4a-055e-446b-9c47-0266c347710a',
    starredDisplayName: 'medieval knight 3d model light',
    geometry: { vertices: positions.length / 3, triangles: indices.length / 3, bounds, positionsPreserved: true, indicesPreserved: true, uvsPreserved: true, retopology: false },
    preliminaryDesignReview: 'Astra-low approved the source as a medieval white-and-gold plate knight for regular Crownward T40 patrols.',
    sourceSkin: 'none; Tripo individual export did not offer Export Skeleton',
    sourceAnimations: [],
    textures: sourceTextures,
  },
  candidate: {
    file: candidatePath,
    sha256: candidateHash,
    bytes: bytes.length,
    productionTarget: 'game/public/assets/models/fairy-crown/creature_pearl_knight.glb',
    geometry: { vertices: positions.length / 3, triangles: indices.length / 3, positionsPreserved: true, indicesPreserved: true, uvsPreserved: true },
    rig: { type: 'Mixamo-named Unity Humanoid glTF skin', joints: bones.map((bone) => ({ name: bone.name, parent: bone.parent, position: bone.p })), influencesPerVertex: 4, distributedVertices, maximumWeightSumError: maxWeightError, method: 'Source-specific four-weight distance fields fitted to the T-pose; original topology and UVs remain untouched.' },
    textures: runtimeTextures,
    metallicChannelRange: metalRange,
    roughnessChannelRange: roughRange,
    pbr: 'Original Tripo base color, packed metallic-roughness and normal maps; image-generated source art is retained and downsampled to 2K for runtime.',
    animations: clips,
  },
  acceptance: { sourceDesignAudit: true, geometry: true, rig: false, animation: false, textures: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${baseDir}/catalog.json`, JSON.stringify(candidate, null, 2) + '\n');
const labAsset = {
  id: 'creature_pearl_knight',
  file: 'models/fairy-crown/creature_pearl_knight.glb',
  pack: 'corealm-starred-creatures',
  category: 'character',
  is: 'Crownward Pearl Knight',
  tags: ['creature', 'crownward', 'T40', 'white-gold-plate', 'patrol', 'starred', 'tripo', 'candidate'],
  bytes: bytes.length,
  sha256: candidateHash,
  size: { x: bounds.max[0] - bounds.min[0], y: bounds.max[1] - bounds.min[1], z: bounds.max[2] - bounds.min[2] },
  base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] },
  bounds,
  groundY: bounds.min[1],
  triangles: indices.length / 3,
  animations: clips.map((clip) => clip.name),
  materials: root.listMaterials().map((entry) => entry.getName()),
  sourceProvenance: {
    author: 'Starred Tripo model, source-specific rig reconstruction',
    sourceModelId: '7449b4c6-86b9-44e4-a26b-5f02e3c00a72',
    sourceCardId: '3255ba4a-055e-446b-9c47-0266c347710a',
    sourceFile: sourcePath,
    sourceSha256: sourceHash,
    candidateFile: candidatePath,
    candidateSha256: candidateHash,
    rigMethod: '22-joint Mixamo-named Unity Humanoid skeleton; four-weight anatomical fields; source mesh positions, topology, normals, UV islands and map images preserved.',
    textures: runtimeTextures,
    candidateStatus: 'awaiting-root-lab-review',
  },
  acceptance: { assetAudit: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${baseDir}/lab-catalog.json`, JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', assets: [labAsset] }, null, 2) + '\n');
console.log(JSON.stringify({ candidatePath, bytes: bytes.length, sha256: candidateHash, triangles: indices.length / 3, vertices: positions.length / 3, joints: bones.length, distributedVertices, metallicChannelRange: metalRange, roughnessChannelRange: roughRange, clips, runtimeTextures }, null, 2));
