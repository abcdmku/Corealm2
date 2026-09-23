import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const ownerDir = 'assets/art/tripo/imports/creatures/starred-orchid-reaper';
const sourceFile = 'assets/art/tripo/exports/4c599d13-d2e0-4099-93f0-79bf17056049.glb';
const sourceShaExpected = '7f44b831fbc2b743c7156d4a45420e0b7948aae50cc635a49b8b5d40446da0d1';
const sourceImageFile = 'assets/art/tripo/refs/fairy-orchid-reaper-face-r3.png';
const sourceImageShaExpected = '9f9d7e75a6480dbac957757d5fbc90c311f0409a50e0f2ef6f0e4cb5a2e1829f';
const candidateFile = `${ownerDir}/orchid-reaper-native-rig-candidate.glb`;
const sourceModelId = '4c599d13-d2e0-4099-93f0-79bf17056049';
const sourceCardId = '3a2edc1d-6bda-4fc8-99fb-0d6bf673801c';
const sourceImageId = '6a942b74-b3c2-4b55-9b4d-13bf186a7c6a';

await mkdir(ownerDir, { recursive: true });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourceFile);
const sourceSha256 = sha256(sourceBytes);
assert.equal(sourceSha256, sourceShaExpected, 'The approved starred #18 source export changed.');
const sourceImageBytes = await readFile(sourceImageFile);
const sourceImageSha256 = sha256(sourceImageBytes);
assert.equal(sourceImageSha256, sourceImageShaExpected, 'The approved closed-face reference changed.');

const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = mesh ? root.listNodes().find((node) => node.getMesh() === mesh) : undefined;
const sourceSkin = root.listSkins()[0];
assert(scene && mesh && primitive && meshNode, 'Expected one scene and one starred Orchid Reaper mesh.');
assert.equal(root.listMeshes().length, 1, 'Expected the approved single-mesh topology.');
assert.equal(root.listAnimations().length, 0, 'The starred source must not contain unreviewed animation.');

const positions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
const normals = Float32Array.from(primitive.getAttribute('NORMAL')?.getArray() ?? []);
const uvs = Float32Array.from(primitive.getAttribute('TEXCOORD_0')?.getArray() ?? []);
const indices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
assert(positions.length > 0 && normals.length === positions.length, 'Expected source positions and normals.');
assert(uvs.length === positions.length / 3 * 2, 'Expected one preserved UV per source vertex.');
assert(indices.length > 0 && indices.length % 3 === 0, 'Expected triangle indices.');
const vertexCount = positions.length / 3;
const triangleCount = indices.length / 3;
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) {
  for (let axis = 0; axis < 3; axis++) {
    bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
    bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
  }
}
const size = bounds.max.map((value, axis) => value - bounds.min[axis]);
assert(size[1] > 0.25 && size[0] > 0.1, `Unexpected source dimensions: ${JSON.stringify(size)}.`);
const sourceGeometry = { positions, normals, uvs, indices };

// Keep the corrected flower face and blade silhouette locked to the approved image. The face
// has no jaw or mouth joints; only the outer crown petals receive a small independent flex.
const centerX = (bounds.min[0] + bounds.max[0]) / 2;
const centerZ = (bounds.min[2] + bounds.max[2]) / 2;
const width = size[0];
const height = size[1];
const depth = size[2];
const yAt = (fraction) => bounds.min[1] + height * fraction;
const zAt = (fraction) => bounds.min[2] + depth * fraction;
const xAt = (fraction) => centerX + width * fraction;
const point = (xFraction, yFraction, zFraction = 0.5) => [xAt(xFraction), yAt(yFraction), zAt(zFraction)];

// Tripo's static export carried a useless generated skeleton in early exports. Discard it and
// fit four normalized influences to this model's torso, three-lobed crown, scythe arms and legs.
let sourceRootWeightedVertices = 0;
let sourceJointCount = 0;
if (sourceSkin) {
  sourceJointCount = sourceSkin.listJoints().length;
  const sourceJoints = primitive.getAttribute('JOINTS_0')?.getArray();
  const sourceWeights = primitive.getAttribute('WEIGHTS_0')?.getArray();
  if (sourceJoints && sourceWeights) {
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      let rootMass = 0;
      for (let slot = 0; slot < 4; slot++) if (sourceJoints[vertex * 4 + slot] === 0) rootMass += sourceWeights[vertex * 4 + slot];
      if (rootMass > 0.999) sourceRootWeightedVertices++;
    }
  }
}

const bones = [];
function addBone(name, parent, p, group, side = 0, options = {}) {
  bones.push({ name, parent, p, group, side, sigma: options.sigma ?? height * 0.075, ...options });
}
addBone('OrchidRoot', null, [centerX, bounds.min[1], centerZ], 'root', 0, { sigma: height * 0.5 });
addBone('Pelvis', 'OrchidRoot', point(0, 0.34), 'pelvis', 0, { sigma: height * 0.11 });
addBone('Spine', 'Pelvis', point(0, 0.45), 'torso', 0, { sigma: height * 0.095 });
addBone('Chest', 'Spine', point(0, 0.58), 'torso', 0, { sigma: height * 0.10 });
addBone('Neck', 'Chest', point(0, 0.71), 'neck', 0, { sigma: height * 0.065 });
addBone('Head', 'Neck', point(0, 0.80), 'head', 0, { sigma: height * 0.11 });
addBone('CrownCenterPetal', 'Head', point(0, 0.89, 0.5), 'crownCenter', 0, { sigma: height * 0.08 });
for (const side of [-1, 1]) {
  const suffix = side < 0 ? 'L' : 'R';
  addBone(`CrownSidePetal_${suffix}`, 'Head', point(side * 0.13, 0.84, 0.52), 'crownSide', side, { sigma: height * 0.09 });
  addBone(`Shoulder_${suffix}`, 'Chest', point(side * 0.13, 0.63, 0.53), 'arm', side, { sigma: height * 0.085 });
  addBone(`UpperArm_${suffix}`, `Shoulder_${suffix}`, point(side * 0.25, 0.56, 0.56), 'arm', side, { sigma: height * 0.09 });
  addBone(`Elbow_${suffix}`, `UpperArm_${suffix}`, point(side * 0.34, 0.47, 0.59), 'arm', side, { sigma: height * 0.08 });
  addBone(`ScytheRoot_${suffix}`, `Elbow_${suffix}`, point(side * 0.40, 0.39, 0.61), 'blade', side, { sigma: height * 0.075 });
  addBone(`ScytheMid_${suffix}`, `ScytheRoot_${suffix}`, point(side * 0.445, 0.29, 0.62), 'blade', side, { sigma: height * 0.075 });
  addBone(`ScytheTip_${suffix}`, `ScytheMid_${suffix}`, point(side * 0.455, 0.19, 0.62), 'bladeTip', side, { sigma: height * 0.06 });

  addBone(`Hip_${suffix}`, 'Pelvis', point(side * 0.13, 0.34, 0.50 + side * 0.025), 'leg', side, { sigma: height * 0.08 });
  addBone(`Knee_${suffix}`, `Hip_${suffix}`, point(side * 0.17, 0.19, 0.51 + side * 0.03), 'leg', side, { sigma: height * 0.075 });
  addBone(`Ankle_${suffix}`, `Knee_${suffix}`, point(side * 0.18, 0.055, 0.54 + side * 0.025), 'foot', side, { sigma: height * 0.06 });
  addBone(`Toe_${suffix}`, `Ankle_${suffix}`, point(side * 0.17, 0.035, 0.66 + side * 0.025), 'foot', side, { sigma: height * 0.05 });
}
const boneByName = new Map(bones.map((bone, index) => [bone.name, Object.assign(bone, { index })]));
for (const bone of bones) {
  const parent = bone.parent ? boneByName.get(bone.parent) : undefined;
  assert(!bone.parent || parent, `Missing parent ${bone.parent} for ${bone.name}.`);
  bone.local = parent ? bone.p.map((value, axis) => value - parent.p[axis]) : [...bone.p];
}

// Flatten away source rig nodes, retaining the source mesh node and all its vertex attributes.
const sourceNodes = [...root.listNodes()];
meshNode.getParentNode()?.removeChild(meshNode);
meshNode.setSkin(null).setName('OrchidReaperMesh').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
primitive.setAttribute('JOINTS_0', null).setAttribute('WEIGHTS_0', null);
for (const skin of [...root.listSkins()]) skin.dispose();
for (const node of sourceNodes.reverse()) if (node !== meshNode) node.dispose();
for (const child of [...scene.listChildren()]) scene.removeChild(child);
scene.setName('OrchidReaperScene');

// A 2.4 m authored envelope gives the existing level-60 Faeholme slot a threatening silhouette;
// that slot's creature scale remains owned by the world creature definition.
const presentationScale = 2.4 / height;
const presentation = doc.createNode('OrchidReaperPresentation').setScale([presentationScale, presentationScale, presentationScale]);
const armature = doc.createNode('OrchidReaperArmature');
scene.addChild(presentation);
presentation.addChild(armature);
armature.addChild(meshNode);
const jointNodes = new Map();
for (const bone of bones) {
  const node = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  jointNodes.set(bone.name, node);
  const parent = bone.parent ? jointNodes.get(bone.parent) : armature;
  parent.addChild(node);
}
const skin = doc.createSkin('OrchidReaper_GenericPlantHunter').setSkeleton(jointNodes.get('OrchidRoot'));
for (const bone of bones) skin.addJoint(jointNodes.get(bone.name));
const inverseBinds = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i++) {
  const [x, y, z] = bones[i].p;
  inverseBinds.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
}
const buffer = root.listBuffers()[0];
skin.setInverseBindMatrices(doc.createAccessor('OrchidReaper_InverseBinds').setArray(inverseBinds).setType(Accessor.Type.MAT4).setBuffer(buffer));
meshNode.setSkin(skin);

function distanceToSegment(pointValue, start, end) {
  const vector = end.map((value, axis) => value - start[axis]);
  const length2 = vector.reduce((sum, value) => sum + value * value, 0) || 1;
  const projection = pointValue.reduce((sum, value, axis) => sum + (value - start[axis]) * vector[axis], 0) / length2;
  const t = Math.max(0, Math.min(1, projection));
  return Math.hypot(...pointValue.map((value, axis) => value - (start[axis] + t * vector[axis])));
}
const sigmoid = (value) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
function regionGate(bone, vertex) {
  const [x, y] = vertex;
  const yf = (y - bounds.min[1]) / height;
  const xf = (x - centerX) / width;
  const centerGate = sigmoid((0.24 - Math.abs(xf)) / 0.045);
  const sideGate = bone.side === 0 ? 1 : sigmoid((bone.side * xf - 0.055) / 0.035);
  if (bone.group === 'root') return 0.022;
  if (bone.group === 'pelvis') return sigmoid((yf - 0.22) / 0.045) * sigmoid((0.51 - yf) / 0.055) * centerGate;
  if (bone.group === 'torso') return sigmoid((yf - 0.36) / 0.055) * sigmoid((0.76 - yf) / 0.05) * centerGate;
  if (bone.group === 'neck') return sigmoid((yf - 0.65) / 0.045) * sigmoid((0.84 - yf) / 0.05) * centerGate;
  if (bone.group === 'head') return sigmoid((yf - 0.73) / 0.045) * sigmoid((0.91 - yf) / 0.07) * sigmoid((0.19 - Math.abs(xf)) / 0.04);
  if (bone.group === 'crownCenter') return sigmoid((yf - 0.84) / 0.045) * sigmoid((0.19 - Math.abs(xf)) / 0.04);
  if (bone.group === 'crownSide') return sigmoid((yf - 0.80) / 0.045) * sigmoid((Math.abs(xf) - 0.07) / 0.035) * sideGate;
  if (bone.group === 'arm') return sigmoid((yf - 0.28) / 0.06) * sigmoid((0.79 - yf) / 0.055) * sideGate * sigmoid((Math.abs(xf) - 0.075) / 0.04);
  if (bone.group === 'blade') return sigmoid((yf - 0.18) / 0.05) * sigmoid((0.57 - yf) / 0.055) * sideGate * sigmoid((Math.abs(xf) - 0.25) / 0.045);
  if (bone.group === 'bladeTip') return sigmoid((yf - 0.13) / 0.045) * sigmoid((0.39 - yf) / 0.05) * sideGate * sigmoid((Math.abs(xf) - 0.30) / 0.04);
  if (bone.group === 'leg') return sigmoid((0.48 - yf) / 0.05) * sideGate * sigmoid((Math.abs(xf) - 0.055) / 0.035);
  if (bone.group === 'foot') return sigmoid((0.19 - yf) / 0.035) * sideGate * sigmoid((Math.abs(xf) - 0.065) / 0.035);
  return 0;
}

const jointIndices = new Uint16Array(vertexCount * 4);
const jointWeights = new Float32Array(vertexCount * 4);
const influenceCounts = new Uint32Array(bones.length);
const groupWeightedVertices = { core: 0, head: 0, petals: 0, arms: 0, blades: 0, legs: 0, feet: 0 };
let verticesWithDistributedWeights = 0;
let maxWeightSumError = 0;
for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
  const position = [positions[vertexIndex * 3], positions[vertexIndex * 3 + 1], positions[vertexIndex * 3 + 2]];
  const candidates = [];
  for (let boneIndex = 1; boneIndex < bones.length; boneIndex++) {
    const bone = bones[boneIndex];
    const gate = regionGate(bone, position);
    if (gate < 1e-5) continue;
    const parent = bone.parent ? boneByName.get(bone.parent) : undefined;
    const distance = distanceToSegment(position, parent?.p ?? bone.p, bone.p);
    const score = gate * Math.exp(-0.5 * (distance / bone.sigma) ** 2);
    if (score > 1e-11) candidates.push({ index: boneByName.get(bone.name).index, score });
  }
  if (!candidates.length) {
    let closest = 1;
    let closestDistance = Infinity;
    for (let boneIndex = 1; boneIndex < bones.length; boneIndex++) {
      const bone = bones[boneIndex];
      const parent = bone.parent ? boneByName.get(bone.parent) : undefined;
      const distance = distanceToSegment(position, parent?.p ?? bone.p, bone.p);
      if (distance < closestDistance) { closestDistance = distance; closest = boneIndex; }
    }
    candidates.push({ index: closest, score: 1 });
  }
  candidates.sort((left, right) => right.score - left.score);
  const chosen = candidates.slice(0, 4);
  const total = chosen.reduce((sum, value) => sum + value.score, 0);
  let assigned = 0;
  let hasMultiple = 0;
  const vertexGroups = new Set();
  for (let slot = 0; slot < 4; slot++) {
    const candidate = chosen[slot] ?? chosen[0];
    const weight = slot >= chosen.length ? 0 : slot === chosen.length - 1 ? 1 - assigned : candidate.score / total;
    jointIndices[vertexIndex * 4 + slot] = candidate.index;
    jointWeights[vertexIndex * 4 + slot] = weight;
    assigned += weight;
    if (weight > 1e-6) {
      influenceCounts[candidate.index]++;
      if (weight > 0.01) hasMultiple++;
      const group = bones[candidate.index].group;
      if (group === 'pelvis' || group === 'torso' || group === 'neck') vertexGroups.add('core');
      if (group === 'head') vertexGroups.add('head');
      if (group === 'crownCenter' || group === 'crownSide') vertexGroups.add('petals');
      if (group === 'arm') vertexGroups.add('arms');
      if (group === 'blade' || group === 'bladeTip') vertexGroups.add('blades');
      if (group === 'leg') vertexGroups.add('legs');
      if (group === 'foot') vertexGroups.add('feet');
    }
  }
  for (const group of vertexGroups) groupWeightedVertices[group]++;
  if (hasMultiple > 1) verticesWithDistributedWeights++;
  const sum = jointWeights[vertexIndex * 4] + jointWeights[vertexIndex * 4 + 1] + jointWeights[vertexIndex * 4 + 2] + jointWeights[vertexIndex * 4 + 3];
  maxWeightSumError = Math.max(maxWeightSumError, Math.abs(sum - 1));
}
primitive.setAttribute('JOINTS_0', doc.createAccessor('OrchidReaper_Joints0').setArray(jointIndices).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('OrchidReaper_Weights0').setArray(jointWeights).setType(Accessor.Type.VEC4).setBuffer(buffer));

const q = (axis, angle) => {
  const sine = Math.sin(angle / 2);
  const cosine = Math.cos(angle / 2);
  if (axis === 'x') return [sine, 0, 0, cosine];
  if (axis === 'y') return [0, sine, 0, cosine];
  return [0, 0, sine, cosine];
};
const rest = (name) => boneByName.get(name).local;
const addOffset = (name, [x, y, z]) => rest(name).map((value, axis) => value + [x, y, z][axis]);
const clips = [];
function addClip(name, seconds, tracks) {
  const animation = doc.createAnimation(name);
  for (const track of tracks) {
    const times = Float32Array.from(track.times);
    const values = Float32Array.from(track.values.flat());
    const path = track.path ?? 'rotation';
    const input = doc.createAccessor(`${name}_${track.node}_time`).setArray(times).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const output = doc.createAccessor(`${name}_${track.node}_${path}_value`).setArray(values)
      .setType(path === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4).setBuffer(buffer);
    const sampler = doc.createAnimationSampler(`${name}_${track.node}_${path}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${name}_${track.node}_${path}`)
      .setTargetNode(jointNodes.get(track.node)).setTargetPath(path).setSampler(sampler));
  }
  clips.push({ name, seconds, channels: tracks.length });
}
const key5 = (duration) => [0, duration * 0.25, duration * 0.5, duration * 0.75, duration];
const cycle = [0, 0.25, 0.5, 0.75, 1];
const cyclic = (duration) => cycle.map((phase) => phase * duration);
const cycleAngles = (duration, angles, axis = 'x') => cyclic(duration).map((_, index) => q(axis, angles[index]));
const rootBobs = (duration, amplitude) => cyclic(duration).map((_, index) => addOffset('OrchidRoot', [0, [0, amplitude, 0, -amplitude * 0.45, 0][index], 0]));
const torsoBreath = (duration, amplitude) => cycleAngles(duration, [0, amplitude, 0, -amplitude * 0.7, 0], 'z');

addClip('Idle', 2.8, [
  { node: 'OrchidRoot', path: 'translation', times: cyclic(2.8), values: rootBobs(2.8, height * 0.008) },
  { node: 'Spine', times: cyclic(2.8), values: torsoBreath(2.8, 0.018) },
  { node: 'Chest', times: cyclic(2.8), values: cycleAngles(2.8, [0, 0.015, 0, -0.012, 0], 'x') },
  { node: 'Head', times: cyclic(2.8), values: cycleAngles(2.8, [0, 0.02, 0, -0.012, 0], 'y') },
  { node: 'CrownSidePetal_L', times: cyclic(2.8), values: cycleAngles(2.8, [0, -0.025, 0, 0.018, 0], 'z') },
  { node: 'CrownSidePetal_R', times: cyclic(2.8), values: cycleAngles(2.8, [0, -0.018, 0, 0.025, 0], 'z') },
  { node: 'ScytheMid_L', times: cyclic(2.8), values: cycleAngles(2.8, [0, 0.018, 0, -0.015, 0], 'x') },
  { node: 'ScytheMid_R', times: cyclic(2.8), values: cycleAngles(2.8, [0, -0.015, 0, 0.02, 0], 'x') },
]);
addClip('Walk', 1.05, [
  { node: 'OrchidRoot', path: 'translation', times: cyclic(1.05), values: rootBobs(1.05, height * 0.016) },
  { node: 'Pelvis', times: cyclic(1.05), values: cycleAngles(1.05, [0, 0.025, 0, -0.025, 0], 'z') },
  { node: 'Hip_L', times: cyclic(1.05), values: cycleAngles(1.05, [0.30, 0, -0.30, 0, 0.30]) },
  { node: 'Hip_R', times: cyclic(1.05), values: cycleAngles(1.05, [-0.30, 0, 0.30, 0, -0.30]) },
  { node: 'Knee_L', times: cyclic(1.05), values: cycleAngles(1.05, [0.04, 0.25, 0.06, 0.18, 0.04]) },
  { node: 'Knee_R', times: cyclic(1.05), values: cycleAngles(1.05, [0.18, 0.05, 0.24, 0.05, 0.18]) },
  { node: 'UpperArm_L', times: cyclic(1.05), values: cycleAngles(1.05, [-0.12, 0.04, 0.14, -0.03, -0.12], 'z') },
  { node: 'UpperArm_R', times: cyclic(1.05), values: cycleAngles(1.05, [0.14, -0.03, -0.12, 0.04, 0.14], 'z') },
  { node: 'ScytheRoot_L', times: cyclic(1.05), values: cycleAngles(1.05, [-0.08, 0.04, 0.10, -0.02, -0.08], 'z') },
  { node: 'ScytheRoot_R', times: cyclic(1.05), values: cycleAngles(1.05, [0.10, -0.02, -0.08, 0.04, 0.10], 'z') },
]);
addClip('Run', 0.72, [
  { node: 'OrchidRoot', path: 'translation', times: cyclic(0.72), values: rootBobs(0.72, height * 0.027) },
  { node: 'Spine', times: cyclic(0.72), values: cycleAngles(0.72, [0.04, 0.09, 0.04, 0.01, 0.04], 'x') },
  { node: 'Pelvis', times: cyclic(0.72), values: cycleAngles(0.72, [0, 0.05, 0, -0.05, 0], 'z') },
  { node: 'Hip_L', times: cyclic(0.72), values: cycleAngles(0.72, [0.48, 0, -0.48, 0, 0.48]) },
  { node: 'Hip_R', times: cyclic(0.72), values: cycleAngles(0.72, [-0.48, 0, 0.48, 0, -0.48]) },
  { node: 'Knee_L', times: cyclic(0.72), values: cycleAngles(0.72, [0.08, 0.43, 0.09, 0.32, 0.08]) },
  { node: 'Knee_R', times: cyclic(0.72), values: cycleAngles(0.72, [0.32, 0.08, 0.43, 0.08, 0.32]) },
  { node: 'UpperArm_L', times: cyclic(0.72), values: cycleAngles(0.72, [-0.24, 0.08, 0.27, -0.08, -0.24], 'z') },
  { node: 'UpperArm_R', times: cyclic(0.72), values: cycleAngles(0.72, [0.27, -0.08, -0.24, 0.08, 0.27], 'z') },
  { node: 'ScytheRoot_L', times: cyclic(0.72), values: cycleAngles(0.72, [-0.20, 0.06, 0.25, -0.06, -0.20], 'z') },
  { node: 'ScytheRoot_R', times: cyclic(0.72), values: cycleAngles(0.72, [0.25, -0.06, -0.20, 0.06, 0.25], 'z') },
  { node: 'ScytheTip_L', times: cyclic(0.72), values: cycleAngles(0.72, [0, -0.08, 0.02, 0.09, 0], 'y') },
  { node: 'ScytheTip_R', times: cyclic(0.72), values: cycleAngles(0.72, [0, 0.09, 0.02, -0.08, 0], 'y') },
]);
addClip('Attack', 0.86, [
  { node: 'OrchidRoot', path: 'translation', times: [0, 0.18, 0.43, 0.68, 0.86], values: [addOffset('OrchidRoot', [0, 0, 0]), addOffset('OrchidRoot', [0, height * 0.004, -depth * 0.05]), addOffset('OrchidRoot', [0, height * 0.012, depth * 0.035]), addOffset('OrchidRoot', [0, height * 0.004, depth * 0.01]), addOffset('OrchidRoot', [0, 0, 0])] },
  { node: 'Spine', times: [0, 0.18, 0.43, 0.68, 0.86], values: [q('x', 0), q('x', 0.10), q('x', 0.23), q('x', 0.12), q('x', 0)] },
  { node: 'Chest', times: [0, 0.18, 0.43, 0.68, 0.86], values: [q('z', 0), q('z', -0.08), q('z', -0.19), q('z', -0.08), q('z', 0)] },
  { node: 'Head', times: [0, 0.18, 0.43, 0.68, 0.86], values: [q('x', 0), q('x', -0.06), q('x', -0.14), q('x', -0.06), q('x', 0)] },
  { node: 'UpperArm_L', times: [0, 0.18, 0.43, 0.68, 0.86], values: [q('z', 0), q('z', -0.36), q('z', -0.72), q('z', -0.30), q('z', 0)] },
  { node: 'Elbow_L', times: [0, 0.18, 0.43, 0.68, 0.86], values: [q('x', 0), q('x', 0.20), q('x', 0.44), q('x', 0.18), q('x', 0)] },
  { node: 'ScytheRoot_L', times: [0, 0.18, 0.43, 0.68, 0.86], values: [q('z', 0), q('z', -0.28), q('z', -0.61), q('z', -0.24), q('z', 0)] },
  { node: 'ScytheMid_L', times: [0, 0.18, 0.43, 0.68, 0.86], values: [q('x', 0), q('x', 0.14), q('x', 0.34), q('x', 0.12), q('x', 0)] },
  { node: 'UpperArm_R', times: [0, 0.18, 0.43, 0.68, 0.86], values: [q('z', 0), q('z', 0.18), q('z', 0.38), q('z', 0.15), q('z', 0)] },
  { node: 'ScytheRoot_R', times: [0, 0.18, 0.43, 0.68, 0.86], values: [q('z', 0), q('z', 0.12), q('z', 0.32), q('z', 0.12), q('z', 0)] },
  { node: 'CrownSidePetal_L', times: [0, 0.18, 0.43, 0.68, 0.86], values: [q('z', 0), q('z', -0.08), q('z', -0.15), q('z', -0.05), q('z', 0)] },
  { node: 'CrownSidePetal_R', times: [0, 0.18, 0.43, 0.68, 0.86], values: [q('z', 0), q('z', 0.05), q('z', 0.09), q('z', 0.03), q('z', 0)] },
]);
addClip('Hit', 0.48, [
  { node: 'OrchidRoot', path: 'translation', times: [0, 0.08, 0.22, 0.48], values: [addOffset('OrchidRoot', [0, 0, 0]), addOffset('OrchidRoot', [0, -height * 0.008, -depth * 0.04]), addOffset('OrchidRoot', [0, height * 0.003, -depth * 0.015]), addOffset('OrchidRoot', [0, 0, 0])] },
  { node: 'Spine', times: [0, 0.08, 0.22, 0.48], values: [q('z', 0), q('z', -0.13), q('z', 0.055), q('z', 0)] },
  { node: 'Chest', times: [0, 0.08, 0.22, 0.48], values: [q('x', 0), q('x', -0.11), q('x', 0.045), q('x', 0)] },
  { node: 'Head', times: [0, 0.08, 0.22, 0.48], values: [q('z', 0), q('z', 0.12), q('z', -0.04), q('z', 0)] },
  { node: 'UpperArm_L', times: [0, 0.08, 0.22, 0.48], values: [q('z', 0), q('z', -0.22), q('z', -0.04), q('z', 0)] },
  { node: 'UpperArm_R', times: [0, 0.08, 0.22, 0.48], values: [q('z', 0), q('z', 0.20), q('z', 0.035), q('z', 0)] },
  { node: 'ScytheMid_L', times: [0, 0.08, 0.22, 0.48], values: [q('x', 0), q('x', 0.16), q('x', -0.04), q('x', 0)] },
  { node: 'ScytheMid_R', times: [0, 0.08, 0.22, 0.48], values: [q('x', 0), q('x', -0.13), q('x', 0.03), q('x', 0)] },
]);
addClip('Death', 1.55, [
  { node: 'OrchidRoot', path: 'translation', times: [0, 0.25, 0.68, 1.10, 1.55], values: [addOffset('OrchidRoot', [0, 0, 0]), addOffset('OrchidRoot', [0, height * 0.015, 0]), addOffset('OrchidRoot', [0, height * 0.025, -depth * 0.02]), addOffset('OrchidRoot', [0, -height * 0.015, -depth * 0.04]), addOffset('OrchidRoot', [0, -height * 0.07, -depth * 0.055])] },
  { node: 'Pelvis', times: [0, 0.25, 0.68, 1.10, 1.55], values: [q('z', 0), q('z', -0.05), q('z', -0.16), q('z', -0.29), q('z', -0.34)] },
  { node: 'Spine', times: [0, 0.25, 0.68, 1.10, 1.55], values: [q('x', 0), q('x', -0.05), q('x', -0.13), q('x', -0.20), q('x', -0.24)] },
  { node: 'Head', times: [0, 0.25, 0.68, 1.10, 1.55], values: [q('z', 0), q('z', 0.06), q('z', 0.16), q('z', 0.27), q('z', 0.33)] },
  { node: 'UpperArm_L', times: [0, 0.25, 0.68, 1.10, 1.55], values: [q('z', 0), q('z', -0.05), q('z', -0.24), q('z', -0.42), q('z', -0.47)] },
  { node: 'UpperArm_R', times: [0, 0.25, 0.68, 1.10, 1.55], values: [q('z', 0), q('z', 0.05), q('z', 0.22), q('z', 0.39), q('z', 0.44)] },
  { node: 'ScytheMid_L', times: [0, 0.25, 0.68, 1.10, 1.55], values: [q('x', 0), q('x', 0.08), q('x', 0.22), q('x', 0.34), q('x', 0.38)] },
  { node: 'ScytheMid_R', times: [0, 0.25, 0.68, 1.10, 1.55], values: [q('x', 0), q('x', -0.08), q('x', -0.21), q('x', -0.33), q('x', -0.36)] },
  { node: 'Hip_L', times: [0, 0.25, 0.68, 1.10, 1.55], values: [q('x', 0), q('x', 0.18), q('x', 0.40), q('x', 0.52), q('x', 0.56)] },
  { node: 'Hip_R', times: [0, 0.25, 0.68, 1.10, 1.55], values: [q('x', 0), q('x', -0.12), q('x', -0.28), q('x', -0.39), q('x', -0.42)] },
  { node: 'Knee_L', times: [0, 0.25, 0.68, 1.10, 1.55], values: [q('x', 0), q('x', 0.16), q('x', 0.42), q('x', 0.68), q('x', 0.72)] },
  { node: 'Knee_R', times: [0, 0.25, 0.68, 1.10, 1.55], values: [q('x', 0), q('x', 0.12), q('x', 0.31), q('x', 0.55), q('x', 0.60)] },
  { node: 'CrownSidePetal_L', times: [0, 0.25, 0.68, 1.10, 1.55], values: [q('z', 0), q('z', 0.05), q('z', 0.14), q('z', 0.23), q('z', 0.27)] },
  { node: 'CrownSidePetal_R', times: [0, 0.25, 0.68, 1.10, 1.55], values: [q('z', 0), q('z', -0.05), q('z', -0.12), q('z', -0.20), q('z', -0.24)] },
]);

const originalTextures = [];
const runtimeTextures = [];
const materialList = root.listMaterials();
assert(materialList.length > 0, 'Expected image-textured source material.');
const material = materialList[0];
const baseColorTexture = material.getBaseColorTexture();
const packedPbrTexture = material.getMetallicRoughnessTexture();
const normalTexture = material.getNormalTexture();
assert(baseColorTexture && packedPbrTexture && normalTexture, 'Expected source base color, packed PBR and normal maps.');
for (const texture of root.listTextures()) {
  const original = texture.getImage();
  assert(original, `Texture ${texture.getName()} has no source pixels.`);
  const originalMeta = await sharp(original).metadata();
  originalTextures.push({ name: texture.getName(), width: originalMeta.width, height: originalMeta.height, mimeType: texture.getMimeType(), bytes: original.length, sha256: sha256(original) });
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
    const normalImage = sharp(raw.data, { raw: raw.info });
    encoded = texture.getMimeType() === 'image/png'
      ? await normalImage.png({ compressionLevel: 9 }).toBuffer()
      : await normalImage.jpeg({ quality: 96, chromaSubsampling: '4:4:4' }).toBuffer();
  } else if (texture === packedPbrTexture) {
    encoded = await sharp(original).resize(2048, 2048, { fit: 'fill', kernel: 'linear' }).png({ compressionLevel: 9 }).toBuffer();
    texture.setMimeType('image/png');
  } else {
    const base = sharp(original).resize(2048, 2048, { fit: 'fill', kernel: 'lanczos3' });
    encoded = texture.getMimeType() === 'image/png'
      ? await base.png({ compressionLevel: 9 }).toBuffer()
      : await base.jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
  }
  texture.setImage(encoded);
  const runtimeMeta = await sharp(encoded).metadata();
  assert.equal(runtimeMeta.width, 2048, `Runtime map ${texture.getName()} is not 2K wide.`);
  assert.equal(runtimeMeta.height, 2048, `Runtime map ${texture.getName()} is not 2K tall.`);
  runtimeTextures.push({ name: texture.getName(), width: runtimeMeta.width, height: runtimeMeta.height, mimeType: texture.getMimeType(), bytes: encoded.length, sha256: sha256(encoded) });
}
const pbrSample = await sharp(packedPbrTexture.getImage()).resize(128, 128).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const roughnessValues = [];
const metallicValues = [];
for (let i = 0; i < pbrSample.data.length; i += pbrSample.info.channels) {
  roughnessValues.push(pbrSample.data[i + 1] / 255);
  metallicValues.push(pbrSample.data[i + 2] / 255);
}
const valueRange = (values) => [Math.min(...values), Math.max(...values)];
const roughnessRange = valueRange(roughnessValues);
const metallicRange = valueRange(metallicValues);
assert(roughnessRange[1] - roughnessRange[0] > 0.05, `PBR roughness channel is flat: ${roughnessRange}`);
assert(metallicRange[1] - metallicRange[0] > 0.025, `PBR metallic channel is flat: ${metallicRange}`);

const outputBytes = await io.writeBinary(doc);
await writeFile(candidateFile, outputBytes);
const candidateSha256 = sha256(outputBytes);
const checkDoc = await io.readBinary(outputBytes);
const checkRoot = checkDoc.getRoot();
const checkPrimitive = checkRoot.listMeshes()[0].listPrimitives()[0];
const checkPositions = checkPrimitive.getAttribute('POSITION')?.getArray();
const checkNormals = checkPrimitive.getAttribute('NORMAL')?.getArray();
const checkUvs = checkPrimitive.getAttribute('TEXCOORD_0')?.getArray();
const checkIndices = checkPrimitive.getIndices()?.getArray();
const checkJoints = checkPrimitive.getAttribute('JOINTS_0')?.getArray();
const checkWeights = checkPrimitive.getAttribute('WEIGHTS_0')?.getArray();
const checkSkin = checkRoot.listSkins()[0];
assert(checkPositions && checkNormals && checkUvs && checkIndices && checkJoints && checkWeights && checkSkin, 'Candidate is missing source geometry, UV, or rig attributes.');
const mismatches = {
  positions: checkPositions.some((value, index) => value !== sourceGeometry.positions[index]),
  normals: checkNormals.some((value, index) => value !== sourceGeometry.normals[index]),
  uvs: checkUvs.some((value, index) => value !== sourceGeometry.uvs[index]),
  indices: checkIndices.some((value, index) => value !== sourceGeometry.indices[index]),
};
assert.deepEqual(mismatches, { positions: false, normals: false, uvs: false, indices: false }, 'Source geometry and UVs changed.');
assert.equal(checkRoot.listAnimations().length, 6, 'Expected exactly six authored animation clips.');
const requiredClips = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
assert.deepEqual(checkRoot.listAnimations().map((animation) => animation.getName()), requiredClips);
for (const animation of checkRoot.listAnimations()) {
  for (const channel of animation.listChannels()) assert(checkSkin.listJoints().includes(channel.getTargetNode()), `${animation.getName()} targets an unskinned node.`);
}
for (let vertex = 0; vertex < vertexCount; vertex++) {
  let sum = 0;
  for (let slot = 0; slot < 4; slot++) {
    const joint = checkJoints[vertex * 4 + slot];
    const weight = checkWeights[vertex * 4 + slot];
    assert(Number.isInteger(joint) && joint >= 0 && joint < checkSkin.listJoints().length, `Invalid joint index at vertex ${vertex}.`);
    assert(Number.isFinite(weight) && weight >= 0, `Invalid weight at vertex ${vertex}.`);
    sum += weight;
  }
  assert(Math.abs(sum - 1) < 1e-5, `Unnormalized weights at vertex ${vertex}: ${sum}.`);
}
assert(groupWeightedVertices.head > vertexCount * 0.015, 'The closed head and face do not have meaningful head weights.');
assert(groupWeightedVertices.blades > vertexCount * 0.025, 'Both curved blade arms need meaningful articulation weights.');
assert(groupWeightedVertices.legs > vertexCount * 0.025 && groupWeightedVertices.feet > vertexCount * 0.005, 'Both legs and feet need meaningful articulation weights.');

const transformedBounds = {
  min: bounds.min.map((value) => value * presentationScale),
  max: bounds.max.map((value) => value * presentationScale),
};
const transformedSize = transformedBounds.max.map((value, axis) => value - transformedBounds.min[axis]);
const rigSummary = {
  type: 'Y-up Unity Generic botanical biped with articulated orchid crown and scythe arms',
  forward: '+Z',
  jointCount: bones.length,
  joints: bones.map(({ name, parent, p, group }) => ({ name, parent, position: p, role: group })),
  influencesPerVertex: 4,
  verticesWithDistributedWeights,
  maximumWeightSumError: maxWeightSumError,
  groupWeightedVertices,
  method: 'Model-specific four-influence weights gated by source bounds and segment distance. The solid corrected lower face is held to one head joint; no mouth, jaw or facial-slit controls are added. Outer petals and the curved forearm scythe blades have separate chains.',
};
const candidate = {
  schema: 'corealm-creature-native-rig-candidate/1',
  id: 'creature_orchid_reaper',
  displayName: 'Orchid Reaper',
  status: 'awaiting-root-lab-review',
  accepted: false,
  source: {
    file: sourceFile,
    sha256: sourceSha256,
    bytes: sourceBytes.length,
    starredOrder: 18,
    starredCardId: sourceCardId,
    starredProjectId: sourceModelId,
    starredDisplayName: 'fantasy creature 3d model',
    sourceImageFile,
    sourceImageId,
    sourceImageSha256,
    imageReview: { verdict: 'approved', reviewer: 'face_audit_fairy', scope: 'Closed chitin cheeks and mandibles; approved orchid crown, petals, blades and body preserved.' },
    generator: 'Tripo P2.0 Smart Mesh, 8K PBR, triangle topology; source retopology disabled.',
    approvedPrompt: 'Orchid Reaper face correction r3: preserve the burgundy and cream orchid crown, broad side petals, eyes, shoulders, torso, curved forearm blades, legs, feet, green joints and painted surface detail; keep a solid dark aubergine chitin lower face with two closed insect mandibles.',
    geometry: { vertices: vertexCount, triangles: triangleCount, sourceBounds: bounds, outputScale: presentationScale, outputBounds: transformedBounds, outputSize: { x: transformedSize[0], y: transformedSize[1], z: transformedSize[2] }, positionsPreserved: true, normalsPreserved: true, indicesPreserved: true, uvPreserved: true, retopology: false },
    sourceSkin: { joints: sourceJointCount, rootWeightedVertices: sourceRootWeightedVertices, disposition: 'discarded; gameplay rig and weights rebuilt against the approved static source pose' },
    sourceAnimations: [],
    textures: originalTextures,
  },
  candidate: {
    file: candidateFile,
    sha256: candidateSha256,
    bytes: outputBytes.length,
    productionTarget: 'game/public/assets/models/fairy-crown/creature_orchid_reaper.glb',
    targetCreature: 'orchid_reaper_t60',
    geometry: { vertices: vertexCount, triangles: triangleCount, positionsPreserved: !mismatches.positions, normalsPreserved: !mismatches.normals, indicesPreserved: !mismatches.indices, uvPreserved: !mismatches.uvs },
    rig: rigSummary,
    textures: runtimeTextures,
    pbr: { baseColor: true, packedMetallicRoughness: true, normal: true, roughnessRange, metallicRange, allMapsMaximum: 2048, maps: 'Original image-generated layered textures preserved at 2K runtime resolution; no monochrome recolor.' },
    animations: clips,
    locomotion: 'Walk and Run are alternating biped steps with the scythe arms counter-swinging; the broad flower crown remains closed around the rigid face.',
    attackContactNormalized: 0.50,
  },
  acceptance: { approvedSource: true, geometry: true, textures2K: true, rigAccepted: false, motionAccepted: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${ownerDir}/catalog.json`, `${JSON.stringify(candidate, null, 2)}\n`);

const labAsset = {
  id: 'creature_orchid_reaper',
  file: 'models/fairy-crown/creature_orchid_reaper.glb',
  candidateFile,
  pack: 'corealm-starred-fairy-candidates',
  category: 'character',
  is: 'Orchid Reaper, starred #18 closed-face rig candidate',
  tags: ['creature', 'fairy', 'plant-hunter', 'orchid', 'scythe-arms', 'T60', 'starred', 'tripo', 'candidate'],
  bytes: outputBytes.length,
  sha256: candidateSha256,
  size: { x: transformedSize[0], y: transformedSize[1], z: transformedSize[2] },
  base: { x: transformedBounds.min[0], y: transformedBounds.min[1], z: transformedBounds.min[2] },
  bounds: transformedBounds,
  groundY: transformedBounds.min[1],
  triangles: triangleCount,
  vertices: vertexCount,
  animations: clips.map(({ name }) => name),
  materials: materialList.map((entry) => entry.getName()),
  sourceProvenance: {
    author: 'Corealm candidate rig reconstruction',
    starredOrder: 18,
    sourceModelId,
    sourceCardId,
    sourceImageId,
    sourceFile,
    sourceSha256,
    candidateFile,
    candidateSha256,
    rigMethod: rigSummary.method,
    texturePolicy: 'Preserve the approved image-generated layered base color, metallic-roughness and normal maps; reduce each to a 2K runtime map.',
    targetCreature: 'orchid_reaper_t60',
    candidateStatus: 'awaiting-root-lab-review',
  },
  acceptance: { sourceDesignAudit: true, geometryPreserved: true, runtimeTextures2K: true, rigAccepted: false, motionAccepted: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${ownerDir}/lab-catalog.json`, `${JSON.stringify({
  schema: 'corealm-lab-asset-candidates/1',
  pack: { id: 'corealm-starred-fairy-candidates', name: 'Corealm starred fairy creature candidates', author: 'Corealm', source: 'User-starred Tripo models and Corealm rig/texture adaptation', license: 'LicenseRef-Corealm-Original' },
  files: { creature_orchid_reaper: 'orchid-reaper-native-rig-candidate.glb' },
  sourceAliases: { creature_orchid_reaper: 'creature_veil_reaper' },
  assets: [labAsset],
}, null, 2)}\n`);

console.log(JSON.stringify({
  candidateFile, candidateSha256, bytes: outputBytes.length, vertices: vertexCount, triangles: triangleCount,
  sourceBounds: bounds, outputBounds: transformedBounds, joints: bones.length, clips, runtimeTextures,
  groupWeightedVertices, verticesWithDistributedWeights, maximumWeightSumError: maxWeightSumError,
  geometryMismatches: mismatches, sourceJointCount, sourceRootWeightedVertices, roughnessRange, metallicRange,
}, null, 2));
