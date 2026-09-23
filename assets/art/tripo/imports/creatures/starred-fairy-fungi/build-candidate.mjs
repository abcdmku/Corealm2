import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const here = 'assets/art/tripo/imports/creatures/starred-fairy-fungi';
const sourcePath = 'assets/art/tripo/exports/7b895b19-d80b-4680-96b7-3f4cf63fa8a9.glb';
const candidateName = 'duskcap-sporekin-native-rig-candidate.glb';
const candidatePath = `${here}/${candidateName}`;
const sourceShaExpected = 'cdc218bf28e19b40c3f9070d3375478795752ee618c52e9cc2cb71c6513f192f';
const projectId = '7b895b19-d80b-4680-96b7-3f4cf63fa8a9';
const cardId = '2f2c8e61-97e8-40b2-80f8-2ac990d55fe3';
const starredPrompt = 'alien creature with fungal head, textured brown-purple skin, beige plate-like exoskeleton, elongated limbs and clawed feet';
const approvedSourceImageId = '612f264c-74d2-48c4-bbc8-36680dd6127e';
const approvedSourceImagePath = 'assets/art/tripo/refs/fairy-mooncap-sporekin-face-r3.png';
const approvedSourceImageSha = '5883497c239eef155dc0a686240ae4f58dff3b4def488eaa6351351c6c593d62';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

await mkdir(here, { recursive: true });
const exportLedger = JSON.parse(await readFile('assets/art/tripo/starred-export-middle.json', 'utf8'));
const starredRecord = exportLedger.items.find(item => item.starredOrder === 15);
assert(starredRecord, 'Missing #15 from the middle starred-export ledger.');
assert.equal(starredRecord.tripoId, projectId, 'The #15 project ID changed.');
assert.equal(starredRecord.prompt, starredPrompt, 'The exact starred prompt changed.');
assert.equal(starredRecord.download.archivePath, sourcePath, 'The #15 archive path changed.');
assert.equal(starredRecord.download.sha256.toLowerCase(), sourceShaExpected, 'The #15 ledger hash changed.');
const inventory = JSON.parse(await readFile('assets/art/tripo/starred-inventory-2026-09-22.json', 'utf8'));
const inventoryRecord = inventory.models.find(item => item.order === 15);
assert(inventoryRecord && inventoryRecord.projectUuid === projectId && inventoryRecord.cardStorageUuid === cardId, 'The #15 collection identity changed.');
const approvedImageBytes = await readFile(approvedSourceImagePath);
assert.equal(sha(approvedImageBytes), approvedSourceImageSha, 'The approved fungal face reference image changed.');
const sourceBytes = await readFile(sourcePath);
const sourceSha = sha(sourceBytes);
assert.equal(sourceSha, sourceShaExpected, 'The starred #15 GLB archive changed.');
const sourceDoc = await io.readBinary(sourceBytes);
const root = sourceDoc.getRoot();
const scene = root.listScenes()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find(node => node.getMesh() === mesh);
const sourceSkin = root.listSkins()[0];
assert(scene && mesh && primitive && meshNode && sourceSkin, 'Expected the archived skinned fungal creature GLB.');
assert.equal(root.listMeshes().length, 1, 'Expected one preserved source mesh.');
assert.equal(mesh.listPrimitives().length, 1, 'Expected one source primitive.');
assert.equal(root.listSkins().length, 1, 'Expected one source skin.');
assert.equal(sourceSkin.listJoints().length, 54, 'The inspected starred source rig changed.');
assert.equal(root.listAnimations().length, 0, 'The inspected starred source unexpectedly gained clips.');

const positionsAccessor = primitive.getAttribute('POSITION');
const indicesAccessor = primitive.getIndices();
const positions = positionsAccessor?.getArray();
const sourceIndices = indicesAccessor?.getArray();
assert(positions instanceof Float32Array && sourceIndices, 'Expected indexed float-position source geometry.');
const vertexCount = positions.length / 3;
const triangleCount = sourceIndices.length / 3;
assert.equal(vertexCount, 3395, 'The archived GLB vertex layout changed.');
assert.equal(triangleCount, 5258, 'The archived GLB triangle layout changed.');
const geometrySemantics = ['POSITION', 'NORMAL', 'TANGENT', 'TEXCOORD_0', 'TEXCOORD_1', 'COLOR_0'];
const sourceAttributes = new Map(geometrySemantics.flatMap(name => {
  const attribute = primitive.getAttribute(name);
  return attribute ? [[name, Array.from(attribute.getArray())]] : [];
}));
assert(sourceAttributes.has('NORMAL') && sourceAttributes.has('TEXCOORD_0'), 'Source normals and UVs are required.');
assert.equal(sourceAttributes.get('TEXCOORD_0').length, vertexCount * 2, 'Every source vertex must retain its UV.');

const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
  bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
}
assert(Math.abs(bounds.min[1]) < 1e-6 && bounds.max[1] > .98, `Expected a grounded Y-up source, got ${JSON.stringify(bounds)}.`);
assert(bounds.max[0] - bounds.min[0] > .45 && bounds.max[2] - bounds.min[2] > .25, 'Expected the approved broad cap and forward-facing body proportions.');
// The source mesh is only about one meter tall. Its Faeholme species scale is 0.65,
// which rendered it at roughly 0.4m beside the player. Scale the rig container so
// the unchanged mesh reads as a 1.43m creature in that existing T60 slot.
const presentationScale = 2.2;
const presentationBounds = {
  min: bounds.min.map(value => value * presentationScale),
  max: bounds.max.map(value => value * presentationScale),
};
const presentationSize = presentationBounds.max.map((value, axis) => value - presentationBounds.min[axis]);

const sourceJointArray = primitive.getAttribute('JOINTS_0')?.getArray();
const sourceWeightArray = primitive.getAttribute('WEIGHTS_0')?.getArray();
assert(sourceJointArray && sourceWeightArray, 'The starred source should carry its exported skin attributes.');
const sourceJointNames = sourceSkin.listJoints().map(joint => joint.getName());
let rootDominantVertices = 0;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  let sum = 0, rootWeight = 0;
  for (let slot = 0; slot < 4; slot++) {
    const index = vertex * 4 + slot;
    sum += sourceWeightArray[index];
    if (sourceJointNames[sourceJointArray[index]] === 'BoneRoot') rootWeight += sourceWeightArray[index];
  }
  assert(Math.abs(sum - 1) < 1e-4, `Source weights are malformed at vertex ${vertex}.`);
  if (rootWeight > .99) rootDominantVertices++;
}
assert(rootDominantVertices / vertexCount > .95, 'The observed unusable BoneRoot-weighted source rig changed.');

// The exported 54-joint hierarchy has identity transforms, invalid bind data and almost all
// vertices bound to BoneRoot. Replace only those rig attributes: the approved alien body,
// normals, UVs, indices, layered color and PBR images remain the source of this candidate.
const bones = [];
function addBone(name, parent, p, group, sigma, extra = {}) {
  bones.push({ name, parent, p, group, sigma, ...extra });
}
addBone('DuskcapRoot', null, [0, 0, 0], 'root', .8);
addBone('Pelvis', 'DuskcapRoot', [0, .35, 0], 'body', .14);
addBone('Abdomen', 'Pelvis', [0, .435, 0], 'body', .11);
addBone('Spine', 'Abdomen', [0, .515, 0], 'body', .115);
addBone('Chest', 'Spine', [0, .605, 0], 'body', .115);
addBone('Neck', 'Chest', [0, .715, 0], 'head', .085);
addBone('Head', 'Neck', [0, .81, 0], 'head', .115);
addBone('FungalCap', 'Head', [0, .91, 0], 'cap', .10);
for (const side of [-1, 1]) {
  const suffix = side < 0 ? 'L' : 'R';
  addBone(`Clavicle_${suffix}`, 'Chest', [side * .075, .62, 0], 'arm', .095, { side, armPart: 'clavicle' });
  addBone(`UpperArm_${suffix}`, `Clavicle_${suffix}`, [side * .132, .535, .002], 'arm', .10, { side, armPart: 'upper' });
  addBone(`Forearm_${suffix}`, `UpperArm_${suffix}`, [side * .188, .385, .012], 'arm', .105, { side, armPart: 'forearm' });
  addBone(`Hand_${suffix}`, `Forearm_${suffix}`, [side * .222, .245, .045], 'hand', .095, { side });
  addBone(`Thigh_${suffix}`, 'Pelvis', [side * .063, .34, 0], 'leg', .105, { side, legPart: 'thigh' });
  addBone(`Knee_${suffix}`, `Thigh_${suffix}`, [side * .082, .205, .005], 'leg', .09, { side, legPart: 'knee' });
  addBone(`Ankle_${suffix}`, `Knee_${suffix}`, [side * .09, .072, .012], 'leg', .085, { side, legPart: 'ankle' });
  addBone(`Foot_${suffix}`, `Ankle_${suffix}`, [side * .092, .036, .07], 'foot', .065, { side });
  addBone(`Toe_${suffix}`, `Foot_${suffix}`, [side * .092, .018, .132], 'toe', .055, { side });
}

const byName = new Map(bones.map((bone, index) => [bone.name, { ...bone, index }]));
for (const bone of bones) {
  const parent = bone.parent ? byName.get(bone.parent) : null;
  assert(!bone.parent || parent, `Missing parent ${bone.parent} for ${bone.name}.`);
  bone.local = parent ? bone.p.map((value, axis) => value - parent.p[axis]) : [...bone.p];
}

const sigmoid = value => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
function segmentDistance(point, start, end) {
  const vector = end.map((value, axis) => value - start[axis]);
  const length2 = vector.reduce((sum, value) => sum + value * value, 0) || 1;
  const t = Math.max(0, Math.min(1,
    point.reduce((sum, value, axis) => sum + (value - start[axis]) * vector[axis], 0) / length2));
  return Math.hypot(...point.map((value, axis) => value - (start[axis] + vector[axis] * t)));
}
const joints = new Uint16Array(vertexCount * 4);
const weights = new Float32Array(vertexCount * 4);
const influenceCounts = new Uint32Array(bones.length);
const multiInfluencedVertices = new Set();
let maxWeightSumError = 0;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const [x, y] = point;
  const scores = [];
  for (const bone of bones) {
    const parent = bone.parent ? byName.get(bone.parent) : null;
    const distance = segmentDistance(point, parent?.p ?? bone.p, bone.p);
    const central = .035 + .965 * Math.exp(-.5 * (x / .14) ** 2);
    let gate = 1;
    if (bone.group === 'root') gate = .006;
    if (bone.group === 'body') {
      const yBands = {
        Pelvis: .05 + .95 * sigmoid((.45 - y) / .045),
        Abdomen: (.04 + .96 * sigmoid((y - .37) / .045)) * (.04 + .96 * sigmoid((.53 - y) / .045)),
        Spine: (.04 + .96 * sigmoid((y - .45) / .045)) * (.04 + .96 * sigmoid((.62 - y) / .045)),
        Chest: .05 + .95 * sigmoid((y - .52) / .045),
      }[bone.name];
      gate = central * yBands;
    }
    if (bone.group === 'head') {
      const yBand = bone.name === 'Neck'
        ? (.04 + .96 * sigmoid((y - .64) / .04)) * (.04 + .96 * sigmoid((.80 - y) / .05))
        : .04 + .96 * sigmoid((y - .69) / .055);
      gate = central * yBand;
    }
    if (bone.group === 'cap') {
      gate = (.04 + .96 * sigmoid((y - .82) / .035)) * (.18 + .82 * Math.exp(-.5 * (x / .205) ** 2));
    }
    if (bone.group === 'arm') {
      const sideGate = .015 + .985 * sigmoid((bone.side * x - .055) / .03);
      const heightGate = (.03 + .97 * sigmoid((y - .20) / .07)) * (.04 + .96 * sigmoid((.70 - y) / .06));
      const outsideTorso = .05 + .95 * sigmoid((Math.abs(x) - .045) / .025);
      gate = sideGate * heightGate * outsideTorso;
    }
    if (bone.group === 'hand') {
      const sideGate = .01 + .99 * sigmoid((bone.side * x - .16) / .028);
      const handBand = (.035 + .965 * sigmoid((.34 - y) / .045)) * (.03 + .97 * sigmoid((y - .14) / .045));
      gate = sideGate * handBand;
    }
    if (bone.group === 'leg') {
      const sideGate = .015 + .985 * sigmoid((bone.side * x - .025) / .025);
      const lowerBody = .035 + .965 * sigmoid((.49 - y) / .045);
      const outsideBody = .035 + .965 * sigmoid((Math.abs(x) - .035) / .025);
      gate = sideGate * lowerBody * outsideBody;
    }
    if (bone.group === 'foot' || bone.group === 'toe') {
      const sideGate = .01 + .99 * sigmoid((bone.side * x - .035) / .022);
      const lowGate = .02 + .98 * sigmoid((.13 - y) / .025);
      const toeGate = bone.group === 'toe' ? .03 + .97 * sigmoid((point[2] - .025) / .025) : 1;
      gate = sideGate * lowGate * toeGate;
    }
    const score = gate * Math.exp(-.5 * (distance / bone.sigma) ** 2);
    if (score > 1e-12) scores.push({ index: byName.get(bone.name).index, score });
  }
  scores.sort((a, b) => b.score - a.score);
  const selected = scores.slice(0, 4);
  assert(selected.length, `Vertex ${vertex} has no anatomical joint candidate.`);
  const total = selected.reduce((sum, entry) => sum + entry.score, 0);
  let assigned = 0, active = 0;
  for (let slot = 0; slot < 4; slot++) {
    const entry = selected[slot] ?? selected[0];
    const weight = slot >= selected.length ? 0 : slot === selected.length - 1 ? 1 - assigned : entry.score / total;
    joints[vertex * 4 + slot] = entry.index;
    weights[vertex * 4 + slot] = weight;
    assigned += weight;
    if (weight > 1e-6) { influenceCounts[entry.index]++; active++; }
  }
  if (active > 1) multiInfluencedVertices.add(vertex);
  const sum = weights[vertex * 4] + weights[vertex * 4 + 1] + weights[vertex * 4 + 2] + weights[vertex * 4 + 3];
  maxWeightSumError = Math.max(maxWeightSumError, Math.abs(sum - 1));
}
const multiInfluenceRatio = multiInfluencedVertices.size / vertexCount;
assert(multiInfluenceRatio > .45, `Weights are too rigid for the long limbs (${(multiInfluenceRatio * 100).toFixed(1)}% blended).`);
const unweightedJoints = bones.filter((_, index) => influenceCounts[index] === 0).map(bone => bone.name);
assert.deepEqual(unweightedJoints, [], `Anatomical joints received no surface weights: ${unweightedJoints.join(', ')}.`);

const originalArmature = meshNode.getParentNode();
assert(originalArmature, 'Expected the original mesh under its exported armature.');
originalArmature.removeChild(meshNode);
if (scene.listChildren().includes(originalArmature)) scene.removeChild(originalArmature);
meshNode.setName('DuskcapStalkerMesh').setSkin(null).setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
primitive.setAttribute('JOINTS_0', sourceDoc.createAccessor('Duskcap_Joints0').setArray(joints).setType(Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]));
primitive.setAttribute('WEIGHTS_0', sourceDoc.createAccessor('Duskcap_Weights0').setArray(weights).setType(Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]));
const inverseBindAccessor = sourceSkin.getInverseBindMatrices();
sourceSkin.dispose();
inverseBindAccessor?.dispose();
for (const node of [...root.listNodes()].reverse()) if (node !== meshNode) node.dispose();

const rigContainer = sourceDoc.createNode('DuskcapStalkerRig').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([presentationScale, presentationScale, presentationScale]);
scene.addChild(rigContainer);
rigContainer.addChild(meshNode);
const jointNodes = new Map();
for (const bone of bones) {
  const node = sourceDoc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  jointNodes.set(bone.name, node);
  (bone.parent ? jointNodes.get(bone.parent) : rigContainer).addChild(node);
}
const skin = sourceDoc.createSkin('DuskcapStalkerSkin').setSkeleton(jointNodes.get('DuskcapRoot'));
for (const bone of bones) skin.addJoint(jointNodes.get(bone.name));
const inverseBinds = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i++) {
  const [x, y, z] = bones[i].p;
  inverseBinds.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
}
skin.setInverseBindMatrices(sourceDoc.createAccessor('Duskcap_InverseBind').setArray(inverseBinds).setType(Accessor.Type.MAT4).setBuffer(root.listBuffers()[0]));
meshNode.setSkin(skin);

const quat = (axis, angle) => {
  const sine = Math.sin(angle / 2), cosine = Math.cos(angle / 2);
  if (axis === 'x') return [sine, 0, 0, cosine];
  if (axis === 'y') return [0, sine, 0, cosine];
  return [0, 0, sine, cosine];
};
const clipSummaries = [];
function sampledTimes(duration, step) {
  const result = [];
  for (let time = 0; time < duration - 1e-6; time += step) result.push(Number(time.toFixed(6)));
  result.push(duration);
  return result;
}
function addClip(name, duration, tracks) {
  const animation = sourceDoc.createAnimation(name);
  for (const track of tracks) {
    const node = jointNodes.get(track.node);
    assert(node, `${name} targets an unknown joint ${track.node}.`);
    assert.equal(track.times.length, track.values.length, `${name}/${track.node} key count mismatch.`);
    const type = track.path === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4;
    const input = sourceDoc.createAccessor(`${name}_${track.node}_time`).setArray(Float32Array.from(track.times)).setType(Accessor.Type.SCALAR).setBuffer(root.listBuffers()[0]);
    const output = sourceDoc.createAccessor(`${name}_${track.node}_${track.path ?? 'rotation'}_value`).setArray(Float32Array.from(track.values.flat())).setType(type).setBuffer(root.listBuffers()[0]);
    const sampler = sourceDoc.createAnimationSampler(`${name}_${track.node}_${track.path ?? 'rotation'}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(sourceDoc.createAnimationChannel(`${name}_${track.node}`).setTargetNode(node).setTargetPath(track.path ?? 'rotation').setSampler(sampler));
  }
  clipSummaries.push({ name, seconds: duration, channels: tracks.length });
}
const rotate = (node, times, angles, axis = 'x') => ({ node, times, values: angles.map(angle => quat(axis, angle)) });
const translate = (node, times, values) => ({ node, path: 'translation', times, values });

// Grounded breathing and a small searching tilt give the wide fungal cap an organic idle.
{
  const times = [0, .6, 1.2, 1.8, 2.4];
  const tracks = [
    translate('DuskcapRoot', times, [[0, 0, 0], [0, .006, 0], [0, 0, 0], [0, -.002, 0], [0, 0, 0]]),
    rotate('Pelvis', times, [0, .012, 0, -.012, 0], 'x'),
    rotate('Spine', times, [0, -.018, 0, .018, 0], 'x'),
    rotate('Chest', times, [0, .018, 0, -.018, 0], 'x'),
    rotate('Neck', times, [0, .015, -.01, 0, 0], 'z'),
    rotate('Head', times, [0, -.012, .01, .018, 0], 'x'),
    rotate('FungalCap', times, [0, .012, -.008, .006, 0], 'z'),
  ];
  for (const side of [-1, 1]) {
    const suffix = side < 0 ? 'L' : 'R';
    tracks.push(rotate(`UpperArm_${suffix}`, times, [0, side * .012, 0, -side * .01, 0], 'x'));
    tracks.push(rotate(`Hand_${suffix}`, times, [0, side * .025, -side * .012, 0, 0], 'z'));
    tracks.push(rotate(`Foot_${suffix}`, times, [0, .018, 0, -.01, 0], 'x'));
  }
  addClip('Idle', 2.4, tracks);
}

// The standard Walk slot is a cautious stalking gait with alternating long legs and arms.
{
  const duration = 1.2, times = sampledTimes(duration, .10);
  const phaseAt = time => time / duration * Math.PI * 2;
  const tracks = [
    translate('DuskcapRoot', times, times.map(time => [0, .008 * (1 - Math.cos(phaseAt(time) * 2)), 0])),
    rotate('Pelvis', times, times.map(time => -.035 + .025 * Math.sin(phaseAt(time) * 2)), 'x'),
    rotate('Spine', times, times.map(time => .045 + .025 * Math.sin(phaseAt(time) * 2 + .4)), 'x'),
    rotate('Chest', times, times.map(time => -.025 + .022 * Math.sin(phaseAt(time) * 2)), 'x'),
    rotate('Head', times, times.map(time => -.01 + .018 * Math.sin(phaseAt(time) * 2 + .25)), 'x'),
  ];
  for (const side of [-1, 1]) {
    const suffix = side < 0 ? 'L' : 'R';
    const phase = time => phaseAt(time) + (side < 0 ? 0 : Math.PI);
    tracks.push(rotate(`Thigh_${suffix}`, times, times.map(time => .27 * Math.sin(phase(time))), 'x'));
    tracks.push(rotate(`Knee_${suffix}`, times, times.map(time => .04 + .23 * Math.max(0, Math.sin(phase(time) - .3))), 'x'));
    tracks.push(rotate(`Ankle_${suffix}`, times, times.map(time => -.08 * Math.sin(phase(time) + .2)), 'x'));
    tracks.push(rotate(`Foot_${suffix}`, times, times.map(time => .045 * Math.sin(phase(time))), 'x'));
    tracks.push(rotate(`Toe_${suffix}`, times, times.map(time => -.035 * Math.sin(phase(time) - .1)), 'x'));
    tracks.push(rotate(`UpperArm_${suffix}`, times, times.map(time => -.19 * Math.sin(phase(time))), 'x'));
    tracks.push(rotate(`Forearm_${suffix}`, times, times.map(time => .08 + .08 * Math.max(0, Math.sin(phase(time) + .2))), 'x'));
    tracks.push(rotate(`Hand_${suffix}`, times, times.map(time => .06 * Math.sin(phase(time) + .4)), 'x'));
  }
  addClip('Walk', duration, tracks);
}

// Run shortens the stride and folds the knees, keeping this narrow creature planted between bounds.
{
  const duration = .78, times = sampledTimes(duration, .065);
  const phaseAt = time => time / duration * Math.PI * 2;
  const tracks = [
    translate('DuskcapRoot', times, times.map(time => [0, .018 * (1 - Math.cos(phaseAt(time) * 2)), 0])),
    rotate('Pelvis', times, times.map(time => -.09 + .04 * Math.sin(phaseAt(time) * 2)), 'x'),
    rotate('Spine', times, times.map(time => .10 + .035 * Math.sin(phaseAt(time) * 2 + .4)), 'x'),
    rotate('Chest', times, times.map(time => -.045 + .028 * Math.sin(phaseAt(time) * 2)), 'x'),
    rotate('Head', times, times.map(time => -.03 + .025 * Math.sin(phaseAt(time) * 2 + .4)), 'x'),
  ];
  for (const side of [-1, 1]) {
    const suffix = side < 0 ? 'L' : 'R';
    const phase = time => phaseAt(time) + (side < 0 ? 0 : Math.PI);
    tracks.push(rotate(`Thigh_${suffix}`, times, times.map(time => .39 * Math.sin(phase(time))), 'x'));
    tracks.push(rotate(`Knee_${suffix}`, times, times.map(time => .08 + .34 * Math.max(0, Math.sin(phase(time) - .2))), 'x'));
    tracks.push(rotate(`Ankle_${suffix}`, times, times.map(time => -.12 * Math.sin(phase(time) + .1)), 'x'));
    tracks.push(rotate(`Foot_${suffix}`, times, times.map(time => .07 * Math.sin(phase(time))), 'x'));
    tracks.push(rotate(`Toe_${suffix}`, times, times.map(time => -.05 * Math.sin(phase(time) - .1)), 'x'));
    tracks.push(rotate(`UpperArm_${suffix}`, times, times.map(time => -.28 * Math.sin(phase(time))), 'x'));
    tracks.push(rotate(`Forearm_${suffix}`, times, times.map(time => .13 + .13 * Math.max(0, Math.sin(phase(time) + .2))), 'x'));
    tracks.push(rotate(`Hand_${suffix}`, times, times.map(time => .08 * Math.sin(phase(time) + .4)), 'x'));
  }
  addClip('Run', duration, tracks);
}

// A forward claw sweep winds the thorax, draws one shoulder back and sends the opposite hand through.
{
  const times = [0, .12, .28, .44, .62, .88];
  const tracks = [
    translate('DuskcapRoot', times, [[0, 0, 0], [0, 0, -.012], [0, .005, .018], [0, .004, .06], [0, 0, .035], [0, 0, 0]]),
    rotate('Pelvis', times, [0, -.04, .05, .03, -.025, 0], 'y'),
    rotate('Spine', times, [0, .06, -.11, -.08, .04, 0], 'y'),
    rotate('Chest', times, [0, -.06, .18, .13, -.05, 0], 'y'),
    rotate('Neck', times, [0, -.04, -.12, -.1, .04, 0], 'x'),
    rotate('Head', times, [0, -.06, -.16, -.1, .05, 0], 'x'),
    rotate('FungalCap', times, [0, -.02, -.05, .015, .02, 0], 'z'),
    rotate('UpperArm_R', times, [0, -.16, -.38, -.16, .20, 0], 'x'),
    rotate('Forearm_R', times, [0, -.06, .22, .48, .20, 0], 'x'),
    rotate('Hand_R', times, [0, -.02, .10, .27, .08, 0], 'x'),
    rotate('UpperArm_L', times, [0, .10, .26, .18, -.05, 0], 'x'),
    rotate('Forearm_L', times, [0, .05, -.12, -.08, .02, 0], 'x'),
    rotate('Hand_L', times, [0, .04, .10, -.06, 0, 0], 'z'),
    rotate('Knee_R', times, [0, .03, .1, .08, .03, 0], 'x'),
  ];
  addClip('Attack', .88, tracks);
}

// Impact recoils the head and upper shell while the long claws brace low.
{
  const times = [0, .065, .17, .32, .52];
  const tracks = [
    translate('DuskcapRoot', times, [[0, 0, 0], [0, .005, -.025], [0, 0, -.018], [0, 0, -.004], [0, 0, 0]]),
    rotate('DuskcapRoot', times, [0, -.10, -.04, .015, 0], 'x'),
    rotate('Pelvis', times, [0, -.05, .02, 0, 0], 'x'),
    rotate('Spine', times, [0, .12, .035, 0, 0], 'x'),
    rotate('Chest', times, [0, .14, .02, -.015, 0], 'z'),
    rotate('Neck', times, [0, .22, .08, .015, 0], 'x'),
    rotate('Head', times, [0, .18, .06, .01, 0], 'x'),
    rotate('FungalCap', times, [0, -.08, .025, 0, 0], 'z'),
    rotate('UpperArm_L', times, [0, -.12, .04, 0, 0], 'x'),
    rotate('UpperArm_R', times, [0, .16, .02, 0, 0], 'x'),
    rotate('Forearm_L', times, [0, -.10, .03, 0, 0], 'x'),
    rotate('Forearm_R', times, [0, .13, .02, 0, 0], 'x'),
  ];
  addClip('Hit', .52, tracks);
}

// The creature folds at the waist, drops onto its side and curls its clawed feet.
{
  const times = [0, .18, .48, .88, 1.25, 1.62];
  const tracks = [
    translate('DuskcapRoot', times, [[0, 0, 0], [0, .006, 0], [0, .004, .005], [0, 0, .012], [0, 0, .012], [0, 0, .012]]),
    rotate('DuskcapRoot', times, [0, -.12, -.43, -.62, -.66, -.66], 'x'),
    rotate('Pelvis', times, [0, .04, .10, .14, .14, .14], 'z'),
    rotate('Abdomen', times, [0, -.04, -.16, -.24, -.24, -.24], 'x'),
    rotate('Spine', times, [0, .04, .16, .28, .30, .30], 'x'),
    rotate('Chest', times, [0, .025, .11, .20, .22, .22], 'x'),
    rotate('Neck', times, [0, .04, .18, .32, .34, .34], 'x'),
    rotate('Head', times, [0, .06, .18, .30, .31, .31], 'x'),
    rotate('FungalCap', times, [0, .015, .08, .18, .18, .18], 'z'),
  ];
  for (const side of [-1, 1]) {
    const suffix = side < 0 ? 'L' : 'R';
    tracks.push(rotate(`UpperArm_${suffix}`, times, [0, -.06, -.22, -.35, -.36, -.36], 'x'));
    tracks.push(rotate(`Forearm_${suffix}`, times, [0, .03, .20, .36, .38, .38], 'x'));
    tracks.push(rotate(`Hand_${suffix}`, times, [0, .04, .14, .22, .23, .23], 'z'));
    tracks.push(rotate(`Thigh_${suffix}`, times, [0, .08, .18, .22, .23, .23], 'x'));
    tracks.push(rotate(`Knee_${suffix}`, times, [0, .10, .28, .45, .46, .46], 'x'));
    tracks.push(rotate(`Ankle_${suffix}`, times, [0, -.06, -.16, -.25, -.25, -.25], 'x'));
    tracks.push(rotate(`Foot_${suffix}`, times, [0, .04, .13, .22, .22, .22], 'x'));
    tracks.push(rotate(`Toe_${suffix}`, times, [0, -.03, -.12, -.18, -.18, -.18], 'x'));
  }
  addClip('Death', 1.62, tracks);
}
assert.deepEqual(clipSummaries.map(clip => clip.name), ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death']);

const material = root.listMaterials()[0];
const baseTexture = material?.getBaseColorTexture();
const roughnessTexture = material?.getMetallicRoughnessTexture();
const normalTexture = material?.getNormalTexture();
assert(material && baseTexture && roughnessTexture && normalTexture, 'The starred source must include all three PBR maps.');
const sourceTextureMetrics = [];
const runtimeTextureMetrics = [];
for (const texture of root.listTextures()) {
  const sourceImage = texture.getImage();
  const meta = await sharp(sourceImage).metadata();
  const role = texture === baseTexture ? 'base color' : texture === roughnessTexture ? 'packed metallic-roughness' : texture === normalTexture ? 'normal' : 'unassigned';
  assert.notEqual(role, 'unassigned', `Unexpected extra source texture ${texture.getName()}.`);
  sourceTextureMetrics.push({ name: texture.getName(), role, width: meta.width, height: meta.height, mime: texture.getMimeType(), bytes: sourceImage.length, sha256: sha(sourceImage) });
  let encoded;
  if (texture === baseTexture) {
    assert(meta.width === 8192 && meta.height === 8192, 'Expected the source 8K layered color atlas.');
    encoded = await sharp(sourceImage).resize(2048, 2048, { fit: 'fill', kernel: 'lanczos3' }).jpeg({ quality: 93, chromaSubsampling: '4:4:4' }).toBuffer();
    texture.setName(`${projectId}_basecolor_runtime2k.jpg`).setMimeType('image/jpeg');
  } else if (texture === roughnessTexture) {
    assert(meta.width === 4096 && meta.height === 4096, 'Expected the source 4K packed PBR atlas.');
    encoded = await sharp(sourceImage).resize(2048, 2048, { fit: 'fill', kernel: 'linear' }).png({ compressionLevel: 9 }).toBuffer();
    texture.setName(`${projectId}_rm_runtime2k.png`).setMimeType('image/png');
  } else {
    assert(meta.width === 4096 && meta.height === 4096, 'Expected the source 4K tangent-space normal atlas.');
    const raw = await sharp(sourceImage).resize(2048, 2048, { fit: 'fill', kernel: 'linear' }).removeAlpha().raw().toBuffer();
    for (let i = 0; i < raw.length; i += 3) {
      let nx = raw[i] / 127.5 - 1, ny = raw[i + 1] / 127.5 - 1, nz = raw[i + 2] / 127.5 - 1;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length; ny /= length; nz /= length;
      raw[i] = Math.round((nx + 1) * 127.5); raw[i + 1] = Math.round((ny + 1) * 127.5); raw[i + 2] = Math.round((nz + 1) * 127.5);
    }
    encoded = await sharp(raw, { raw: { width: 2048, height: 2048, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
    texture.setName(`${projectId}_normal_runtime2k.png`).setMimeType('image/png');
  }
  texture.setImage(encoded);
  const runtimeBytes = texture.getImage();
  const runtimeMeta = await sharp(runtimeBytes).metadata();
  assert.equal(runtimeMeta.width, 2048, `${role} runtime width must be 2K.`);
  assert.equal(runtimeMeta.height, 2048, `${role} runtime height must be 2K.`);
  runtimeTextureMetrics.push({ name: texture.getName(), role, width: runtimeMeta.width, height: runtimeMeta.height, mime: texture.getMimeType(), bytes: runtimeBytes.length, sha256: sha(runtimeBytes) });
}
assert.equal(runtimeTextureMetrics.length, 3, 'Keep the full layered color, normal and roughness/metallic set.');

const outputBytes = await io.writeBinary(sourceDoc);
await writeFile(candidatePath, outputBytes);
const candidateSha = sha(outputBytes);
const checkDoc = await io.readBinary(outputBytes);
const checkRoot = checkDoc.getRoot();
const checkPrimitive = checkRoot.listMeshes()[0].listPrimitives()[0];
const checkSkin = checkRoot.listSkins()[0];
assert.equal(checkRoot.listSkins().length, 1, 'Candidate must serialize one replacement skin.');
assert.equal(checkSkin.listJoints().length, bones.length, 'Serialized candidate lost a joint.');
assert.equal(checkRoot.listAnimations().length, 6, 'Candidate must serialize all six gameplay clips.');
assert.equal(checkPrimitive.getAttribute('POSITION').getCount(), vertexCount, 'Candidate geometry vertex count changed.');
assert.equal(checkPrimitive.getIndices().getCount() / 3, triangleCount, 'Candidate triangle count changed.');
let maxAttributeDelta = 0, maxPositionDelta = 0, indexMismatches = 0, readbackWeightError = 0, readbackMultiInfluenced = 0;
for (const [semantic, original] of sourceAttributes) {
  const current = checkPrimitive.getAttribute(semantic)?.getArray();
  assert(current && current.length === original.length, `Source ${semantic} data disappeared or changed length.`);
  for (let i = 0; i < original.length; i++) maxAttributeDelta = Math.max(maxAttributeDelta, Math.abs(original[i] - current[i]));
}
for (let i = 0; i < positions.length; i++) maxPositionDelta = Math.max(maxPositionDelta, Math.abs(positions[i] - checkPrimitive.getAttribute('POSITION').getArray()[i]));
for (let i = 0; i < sourceIndices.length; i++) if (sourceIndices[i] !== checkPrimitive.getIndices().getArray()[i]) indexMismatches++;
const readJoints = checkPrimitive.getAttribute('JOINTS_0').getArray();
const readWeights = checkPrimitive.getAttribute('WEIGHTS_0').getArray();
for (let vertex = 0; vertex < vertexCount; vertex++) {
  let sum = 0, active = 0;
  for (let slot = 0; slot < 4; slot++) {
    const index = vertex * 4 + slot;
    assert(Number.isInteger(readJoints[index]) && readJoints[index] >= 0 && readJoints[index] < bones.length, `Invalid joint index at ${vertex}/${slot}.`);
    assert(Number.isFinite(readWeights[index]) && readWeights[index] >= 0 && readWeights[index] <= 1, `Invalid joint weight at ${vertex}/${slot}.`);
    sum += readWeights[index];
    if (readWeights[index] > 1e-5) active++;
  }
  readbackWeightError = Math.max(readbackWeightError, Math.abs(sum - 1));
  if (active > 1) readbackMultiInfluenced++;
}
assert.equal(maxAttributeDelta, 0, 'Candidate changed source geometry attributes.');
assert.equal(maxPositionDelta, 0, 'Candidate moved source mesh positions.');
assert.equal(indexMismatches, 0, 'Candidate changed source triangle indices.');
assert(readbackWeightError < 1e-5, `Candidate skin weights are not normalized: ${readbackWeightError}.`);
assert(readbackMultiInfluenced / vertexCount > .45, 'Candidate lost smooth anatomical weight distribution.');
for (const animation of checkRoot.listAnimations()) {
  assert(animation.listChannels().length > 0, `${animation.getName()} has no motion channels.`);
  for (const channel of animation.listChannels()) assert(checkSkin.listJoints().includes(channel.getTargetNode()), `${animation.getName()} targets a non-skeleton node.`);
}
const checkTextures = [];
for (const texture of checkRoot.listTextures()) {
  const meta = await sharp(texture.getImage()).metadata();
  assert.equal(meta.width, 2048, `${texture.getName()} must stay within 2K runtime width.`);
  assert.equal(meta.height, 2048, `${texture.getName()} must stay within 2K runtime height.`);
  checkTextures.push({ name: texture.getName(), width: meta.width, height: meta.height, mime: texture.getMimeType(), bytes: texture.getImage().length, sha256: sha(texture.getImage()) });
}

const sourceReport = {
  file: sourcePath,
  sha256: sourceSha,
  bytes: sourceBytes.length,
  starredOrder: 15,
  starredProjectId: projectId,
  starredCardUuid: cardId,
  sourceTitle: 'alien creature 3d model',
  prompt: starredPrompt,
  sourceModelLabel: '8K PBR Tripo P2.0',
  approvedSourceImage: {
    id: approvedSourceImageId,
    file: approvedSourceImagePath,
    sha256: approvedSourceImageSha,
    review: 'Approved facial revision: intact ivory fungal face beneath mature gills; original textured body and limbs retained.',
    linkedTextureReferenceId: '74d01d72-e984-43f7-b8cb-9fab480b7081',
  },
  sourceTopologyReportedByTripo: { faces: 4438, vertices: 2858 },
  sourceGeometryReadFromGlb: { vertices: vertexCount, triangles: triangleCount, bounds, positionsPreserved: true, indicesPreserved: true, normalsUvPreserved: true, retopology: false },
  sourceRig: { joints: sourceSkin.listJoints().length, rootDominantVertices, rootDominantRatio: rootDominantVertices / vertexCount, animationClips: 0, disposition: 'replaced; joint nodes were identity-transformed and over 95% of vertices were fully weighted to BoneRoot' },
  sourceTextures: sourceTextureMetrics,
};
const candidateReport = {
  file: candidatePath,
  sha256: candidateSha,
  bytes: outputBytes.length,
  vertices: vertexCount,
  triangles: triangleCount,
  presentation: {
    scale: presentationScale,
    sourceHeightMeters: bounds.max[1] - bounds.min[1],
    displayedHeightMeters: presentationSize[1],
    heightAtFaeholmeSpeciesScaleMeters: presentationSize[1] * .65,
    bounds: presentationBounds,
    note: 'Uniform rig-container scale; source vertex positions, normals, UVs, indices and texture maps remain unchanged.',
  },
  positionsPreserved: maxPositionDelta === 0,
  indicesPreserved: indexMismatches === 0,
  normalsUvPreserved: maxAttributeDelta === 0,
  maximumSourceAttributeDelta: maxAttributeDelta,
  rig: {
    type: 'Y-up Generic fungal humanoid, facing +Z',
    jointCount: bones.length,
    joints: bones.map((bone, index) => ({ name: bone.name, index, parent: bone.parent, position: bone.p })),
    weighting: 'Four-influence normalized skin with signed-X limb gates, body-height bands and segment-distance weights; source root-only skin discarded.',
    influenceEntriesByJoint: Object.fromEntries(bones.map((bone, index) => [bone.name, influenceCounts[index]])),
    verticesWithMultipleInfluences: readbackMultiInfluenced,
    multiInfluenceRatio: readbackMultiInfluenced / vertexCount,
    maximumWeightSumError: readbackWeightError,
  },
  animations: clipSummaries,
  runtimeTextures: checkTextures,
  material: {
    metallicFactor: checkRoot.listMaterials()[0].getMetallicFactor(),
    roughnessFactor: checkRoot.listMaterials()[0].getRoughnessFactor(),
    baseColor: 'original layered brown-purple and beige image atlas, Lanczos reduced to 2K',
    normal: 'original tangent-space normal image, reduced to 2K with vector averaging and renormalization',
    metallicRoughness: 'original packed metallic-roughness image, reduced to 2K without channel changes',
    look: 'preserved source color and organic exoskeleton; no recolor or texture replacement',
  },
  intendedRole: { region: 'Faeholme', tier: 60, activity: 'forage', behaviour: 'passive', level: 54, targetAssetId: 'fairy_garden_sporekin_faeholme', rationale: 'This T60 fungal fey slot matches the approved gilled cap, intact face and organic alien body; it avoids duplicating the independently staged T60 Orchid Reaper.' },
  validation: { serializedGlbReadBack: true, exactSourceGeometry: true, normalizedWeights: readbackWeightError < 1e-5, allSixClips: true, allRuntimeMaps2K: checkTextures.length === 3, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${here}/catalog.json`, `${JSON.stringify({ schema: 'corealm-creature-native-rig-candidate/1', id: 'fairy_garden_sporekin_faeholme', displayName: 'Duskcap Sporekin', status: 'awaiting-root-lab-review', accepted: false, source: sourceReport, candidate: candidateReport, acceptance: { assetAudit: true, rigAccepted: false, motionAccepted: false, texturesAccepted: true, labAccepted: false, worldIntegrated: false } }, null, 2)}\n`);

const labAsset = {
  id: 'fairy_garden_sporekin_faeholme',
  file: 'models/fairy-garden/fairy_garden_sporekin_faeholme.glb',
  pack: 'corealm-starred-fairy-candidates',
  category: 'character',
  is: 'Duskcap Sporekin (starred fungal fairy candidate)',
  tags: ['creature', 'fairy', 'fungal', 'humanoid', 'Faeholme', 'T60', 'starred', 'tripo', 'skinned', 'candidate'],
  bytes: outputBytes.length,
  sha256: candidateSha,
  size: { x: presentationSize[0], y: presentationSize[1], z: presentationSize[2] },
  base: { x: presentationBounds.min[0], y: presentationBounds.min[1], z: presentationBounds.min[2] },
  bounds: presentationBounds,
  presentationScale,
  groundY: presentationBounds.min[1],
  triangles: triangleCount,
  animations: clipSummaries.map(clip => clip.name),
  walkClipSeconds: clipSummaries.find(clip => clip.name === 'Walk').seconds,
  runClipSeconds: clipSummaries.find(clip => clip.name === 'Run').seconds,
  attackSeconds: clipSummaries.find(clip => clip.name === 'Attack').seconds,
  materials: checkRoot.listMaterials().map(entry => entry.getName()),
  sourceProvenance: {
    sourceModelId: projectId,
    sourceCardId: cardId,
    sourceFile: sourcePath,
    sourceSha256: sourceSha,
    approvedSourceImageId,
    approvedSourceImagePath,
    approvedSourceImageSha256: approvedSourceImageSha,
    sourceTitle: sourceReport.sourceTitle,
    prompt: starredPrompt,
    candidateFile: candidatePath,
    candidateSha256: candidateSha,
    rigMethod: '26-joint Y-up fungal humanoid rig; original mesh, UVs and image-generated base-color/PBR maps preserved; 2K runtime maps.',
    textureMetrics: checkTextures,
  },
  metadata: { source: sourceReport, candidate: candidateReport },
  acceptance: { assetAudit: true, rigAccepted: false, motionAccepted: false, texturesAccepted: true, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${here}/lab-catalog.json`, `${JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', assets: [labAsset], files: { fairy_garden_sporekin_faeholme: candidateName } }, null, 2)}\n`);

console.log(JSON.stringify({ candidatePath, candidateSha, bytes: outputBytes.length, vertices: vertexCount, triangles: triangleCount, sourceRootDominantRatio: rootDominantVertices / vertexCount, joints: bones.length, animations: clipSummaries, runtimeTextures: checkTextures, weights: { multiInfluenceRatio: readbackMultiInfluenced / vertexCount, maxSumError: readbackWeightError }, geometry: { maxAttributeDelta, maxPositionDelta, indexMismatches } }, null, 2));

function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
