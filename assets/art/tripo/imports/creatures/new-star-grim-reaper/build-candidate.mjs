import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import * as THREE from 'three';

const ownerDir = 'assets/art/tripo/imports/creatures/new-star-grim-reaper';
const sourceFile = 'assets/art/tripo/exports/68f8ab54-c998-4eb3-b0ed-1f9853f9f6ae.glb';
const sourceShaExpected = 'b66926a4ba2c2a9bb45d1c9af1d0558e4ed8676fe4d575ac5f291888c11ba248';
const cardStorageId = '52a15641-5c78-4f7b-a7c4-691f03f57b1a';
const projectId = '68f8ab54-c998-4eb3-b0ed-1f9853f9f6ae';
const candidatePath = `${ownerDir}/redwake-harvester-native-rig.glb`;
const productionId = 'creature_redwake_harvester';
const displayName = 'Redwake Harvester';
const presentationScale = 2.05;

await mkdir(ownerDir, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourceFile);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceSha = sha(sourceBytes);
if (sourceSha !== sourceShaExpected) throw new Error(`Source GLB changed: ${sourceSha}`);
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find((node) => node.getMesh() === mesh);
const oldSkin = root.listSkins()[0];
if (!scene || !mesh || !primitive || !meshNode || !oldSkin || root.listAnimations().length) {
  throw new Error('Expected the exact static, skinned Reaper source with no animations.');
}

const positionAccessor = primitive.getAttribute('POSITION');
const normalAccessor = primitive.getAttribute('NORMAL');
const uvAccessor = primitive.getAttribute('TEXCOORD_0');
const indexAccessor = primitive.getIndices();
const positions = Float32Array.from(positionAccessor?.getArray() ?? []);
const normals = Float32Array.from(normalAccessor?.getArray() ?? []);
const uvs = Float32Array.from(uvAccessor?.getArray() ?? []);
const indices = Uint32Array.from(indexAccessor?.getArray() ?? []);
if (positions.length / 3 !== 7030 || indices.length / 3 !== 4595 || normals.length !== positions.length || uvs.length / 2 !== positions.length / 3) {
  throw new Error(`Reaper source geometry drifted: ${positions.length / 3} vertices, ${indices.length / 3} triangles.`);
}
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
  bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
}
const geometryHash = (data) => sha(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
const sourceGeometryHashes = { positions: geometryHash(positions), normals: geometryHash(normals), uvs: geometryHash(uvs), indices: geometryHash(indices) };

// Rebuild the unusable all-Hips source weighting. The authored mesh is narrow through the
// torso, broad across the shoulders and arms, and trails into a ragged robe. These 32
// Mixamo-named humanoid and cloak joints follow those actual mesh axes; no vertices, normals,
// indices or UVs are edited. The parent root adds the Reaper's hover without a walking gait.
const bones = [
  { name: 'ReaperRoot', parent: null, p: [0, 0, 0], group: 'root', sigma: 1 },
  { name: 'mixamorigHips', parent: 'ReaperRoot', p: [0, .515, 0], group: 'core', sigma: .12 },
  { name: 'mixamorigSpine', parent: 'mixamorigHips', p: [0, .590, 0], group: 'core', sigma: .105 },
  { name: 'mixamorigSpine1', parent: 'mixamorigSpine', p: [0, .675, 0], group: 'core', sigma: .105 },
  { name: 'mixamorigSpine2', parent: 'mixamorigSpine1', p: [0, .752, 0], group: 'core', sigma: .09 },
  { name: 'mixamorigNeck', parent: 'mixamorigSpine2', p: [0, .832, 0], group: 'core', sigma: .065 },
  { name: 'mixamorigHead', parent: 'mixamorigNeck', p: [0, .910, 0], group: 'head', sigma: .085 },
  { name: 'mixamorigLeftShoulder', parent: 'mixamorigSpine2', p: [-.095, .748, 0], group: 'leftArm', side: -1, sigma: .055 },
  { name: 'mixamorigLeftArm', parent: 'mixamorigLeftShoulder', p: [-.205, .765, 0], group: 'leftArm', side: -1, sigma: .065 },
  { name: 'mixamorigLeftForeArm', parent: 'mixamorigLeftArm', p: [-.335, .760, 0], group: 'leftArm', side: -1, sigma: .06 },
  { name: 'mixamorigLeftHand', parent: 'mixamorigLeftForeArm', p: [-.445, .742, .012], group: 'leftArm', side: -1, sigma: .055 },
  { name: 'mixamorigRightShoulder', parent: 'mixamorigSpine2', p: [.095, .748, 0], group: 'rightArm', side: 1, sigma: .055 },
  { name: 'mixamorigRightArm', parent: 'mixamorigRightShoulder', p: [.205, .765, 0], group: 'rightArm', side: 1, sigma: .065 },
  { name: 'mixamorigRightForeArm', parent: 'mixamorigRightArm', p: [.335, .760, 0], group: 'rightArm', side: 1, sigma: .06 },
  { name: 'mixamorigRightHand', parent: 'mixamorigRightForeArm', p: [.445, .742, .012], group: 'rightArm', side: 1, sigma: .055 },
  { name: 'mixamorigLeftUpLeg', parent: 'mixamorigHips', p: [-.065, .435, 0], group: 'hiddenLeg', side: -1, sigma: .05 },
  { name: 'mixamorigLeftLeg', parent: 'mixamorigLeftUpLeg', p: [-.065, .285, 0], group: 'hiddenLeg', side: -1, sigma: .05 },
  { name: 'mixamorigLeftFoot', parent: 'mixamorigLeftLeg', p: [-.065, .105, .008], group: 'hiddenLeg', side: -1, sigma: .04 },
  { name: 'mixamorigLeftToeBase', parent: 'mixamorigLeftFoot', p: [-.065, .075, .045], group: 'hiddenLeg', side: -1, sigma: .035 },
  { name: 'mixamorigRightUpLeg', parent: 'mixamorigHips', p: [.065, .435, 0], group: 'hiddenLeg', side: 1, sigma: .05 },
  { name: 'mixamorigRightLeg', parent: 'mixamorigRightUpLeg', p: [.065, .285, 0], group: 'hiddenLeg', side: 1, sigma: .05 },
  { name: 'mixamorigRightFoot', parent: 'mixamorigRightLeg', p: [.065, .105, .008], group: 'hiddenLeg', side: 1, sigma: .04 },
  { name: 'mixamorigRightToeBase', parent: 'mixamorigRightFoot', p: [.065, .075, .045], group: 'hiddenLeg', side: 1, sigma: .035 },
  { name: 'ReaperShroudRoot', parent: 'mixamorigHips', p: [0, .455, -.005], group: 'cloak', sigma: .11 },
  { name: 'ReaperShroudMid', parent: 'ReaperShroudRoot', p: [0, .300, -.012], group: 'cloak', sigma: .13 },
  { name: 'ReaperShroudHem', parent: 'ReaperShroudMid', p: [0, .125, -.020], group: 'cloak', sigma: .11 },
  { name: 'ReaperCapeL', parent: 'ReaperShroudMid', p: [-.205, .255, -.010], group: 'capeL', side: -1, sigma: .10 },
  { name: 'ReaperCapeTipL', parent: 'ReaperCapeL', p: [-.330, .155, -.025], group: 'capeL', side: -1, sigma: .085 },
  { name: 'ReaperCapeR', parent: 'ReaperShroudMid', p: [.205, .255, -.010], group: 'capeR', side: 1, sigma: .10 },
  { name: 'ReaperCapeTipR', parent: 'ReaperCapeR', p: [.330, .155, -.025], group: 'capeR', side: 1, sigma: .085 },
  { name: 'WaistChainRoot', parent: 'mixamorigHips', p: [0, .492, .085], group: 'chain', sigma: .07 },
  { name: 'WaistChainTail', parent: 'WaistChainRoot', p: [.025, .405, .105], group: 'chain', side: 1, sigma: .065 },
];
const boneByName = new Map(bones.map((bone, index) => [bone.name, { ...bone, index }]));
for (const bone of bones) {
  const parent = bone.parent ? boneByName.get(bone.parent) : null;
  bone.local = parent ? bone.p.map((value, axis) => value - parent.p[axis]) : bone.p;
}

const oldNodes = [...root.listNodes()];
const oldParent = meshNode.getParentNode();
if (oldParent) oldParent.removeChild(meshNode);
else if (scene.listChildren().includes(meshNode)) scene.removeChild(meshNode);
else throw new Error('Source mesh node is not attached to its scene.');
meshNode.setSkin(null).setName('RedwakeHarvesterMesh').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
primitive.setAttribute('JOINTS_0', null).setAttribute('WEIGHTS_0', null);
for (const skin of [...root.listSkins()]) skin.dispose();
for (const node of oldNodes) if (node !== meshNode) node.dispose();
scene.setName('RedwakeHarvesterScene');
const presentation = doc.createNode('RedwakeHarvesterPresentation').setScale([presentationScale, presentationScale, presentationScale]);
const armature = doc.createNode('RedwakeHarvesterArmature');
scene.addChild(presentation);
presentation.addChild(armature);
armature.addChild(meshNode);

const jointNodes = new Map();
for (const bone of bones) {
  const node = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  jointNodes.set(bone.name, node);
  (bone.parent ? jointNodes.get(bone.parent) : armature).addChild(node);
}
const skin = doc.createSkin('RedwakeHarvester_UnityHumanoidAndCloak').setSkeleton(jointNodes.get('mixamorigHips'));
for (const bone of bones) skin.addJoint(jointNodes.get(bone.name));
const inverseBinds = new Float32Array(bones.length * 16);
for (let index = 0; index < bones.length; index++) {
  const [x, y, z] = bones[index].p;
  inverseBinds.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], index * 16);
}
const buffer = root.listBuffers()[0];
skin.setInverseBindMatrices(doc.createAccessor('RedwakeHarvester_InverseBindMatrices').setArray(inverseBinds).setType(Accessor.Type.MAT4).setBuffer(buffer));
meshNode.setSkin(skin);

const sigmoid = (value) => 1 / (1 + Math.exp(-Math.max(-32, Math.min(32, value))));
function segmentDistance(point, start, end) {
  const delta = end.map((value, axis) => value - start[axis]);
  const lengthSq = delta.reduce((sum, value) => sum + value * value, 0) || 1;
  const t = Math.max(0, Math.min(1, point.reduce((sum, value, axis) => sum + (value - start[axis]) * delta[axis], 0) / lengthSq));
  return Math.hypot(...point.map((value, axis) => value - (start[axis] + t * delta[axis])));
}
function regionGate(bone, [x, y, z]) {
  if (bone.group === 'root' || bone.group === 'hiddenLeg') return 0;
  if (bone.group === 'head') return sigmoid((y - .790) / .025) * 12;
  if (bone.group === 'core') return sigmoid((y - .295) / .045) * sigmoid((.88 - y) / .05) * sigmoid((.205 - Math.abs(x)) / .035);
  if (bone.group === 'leftArm' || bone.group === 'rightArm') {
    const band = sigmoid((y - .565) / .045) * sigmoid((.885 - y) / .045);
    return band * sigmoid((bone.side * x - .105) / .030) * 2.0;
  }
  if (bone.group === 'cloak') return sigmoid((.595 - y) / .045) * sigmoid((.30 - Math.abs(x)) / .045) * 1.7;
  if (bone.group === 'capeL' || bone.group === 'capeR') {
    return sigmoid((.61 - y) / .045) * sigmoid((bone.side * x - .12) / .040) * 1.35;
  }
  if (bone.group === 'chain') {
    return sigmoid((y - .405) / .035) * sigmoid((.585 - y) / .04) * sigmoid((z - .025) / .025) * .75;
  }
  return 0;
}
const jointValues = new Uint16Array(positions.length / 3 * 4);
const weightValues = new Float32Array(positions.length / 3 * 4);
const influenceCoverage = new Uint32Array(bones.length);
let verticesWithDistributedWeights = 0;
let verticesWithCloakInfluence = 0;
let maximumWeightSumError = 0;
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const candidates = [];
  for (const bone of bones) {
    const gate = regionGate(bone, point);
    if (gate < 1e-5) continue;
    const parent = bone.parent ? boneByName.get(bone.parent) : null;
    const distance = segmentDistance(point, parent?.p ?? bone.p, bone.p);
    const score = gate * Math.exp(-.5 * (distance / bone.sigma) ** 2);
    if (score > 1e-11) candidates.push({ index: boneByName.get(bone.name).index, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 4);
  if (!chosen.length) throw new Error(`No valid rig influence at source vertex ${vertex}.`);
  const total = chosen.reduce((sum, item) => sum + item.score, 0);
  let assigned = 0;
  let hasCloak = false;
  for (let slot = 0; slot < 4; slot++) {
    const item = chosen[slot] ?? chosen[0];
    const weight = slot >= chosen.length ? 0 : slot === chosen.length - 1 ? 1 - assigned : item.score / total;
    jointValues[vertex * 4 + slot] = item.index;
    weightValues[vertex * 4 + slot] = weight;
    assigned += weight;
    if (weight > 1e-6) {
      influenceCoverage[item.index]++;
      if (['cloak', 'capeL', 'capeR'].includes(bones[item.index].group)) hasCloak = true;
    }
  }
  const sum = weightValues[vertex * 4] + weightValues[vertex * 4 + 1] + weightValues[vertex * 4 + 2] + weightValues[vertex * 4 + 3];
  maximumWeightSumError = Math.max(maximumWeightSumError, Math.abs(sum - 1));
  if (chosen.filter((item) => item.score / total > .01).length > 1) verticesWithDistributedWeights++;
  if (hasCloak) verticesWithCloakInfluence++;
}
primitive.setAttribute('JOINTS_0', doc.createAccessor('RedwakeHarvester_Joints0').setArray(jointValues).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('RedwakeHarvester_Weights0').setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(buffer));

const quat = (axis, angle) => {
  const s = Math.sin(angle / 2), c = Math.cos(angle / 2);
  if (axis === 'x') return [s, 0, 0, c];
  if (axis === 'y') return [0, s, 0, c];
  return [0, 0, s, c];
};
const clips = [];
function addClip(name, seconds, tracks) {
  const animation = doc.createAnimation(name);
  for (const track of tracks) {
    const input = doc.createAccessor(`${name}_${track.node}_${track.path ?? 'rotation'}_time`).setArray(Float32Array.from(track.times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const output = doc.createAccessor(`${name}_${track.node}_${track.path ?? 'rotation'}_value`)
      .setArray(Float32Array.from(track.values.flat())).setType(track.path === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4).setBuffer(buffer);
    const sampler = doc.createAnimationSampler(`${name}_${track.node}_${track.path ?? 'rotation'}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${name}_${track.node}_${track.path ?? 'rotation'}`)
      .setTargetNode(jointNodes.get(track.node)).setTargetPath(track.path ?? 'rotation').setSampler(sampler));
  }
  clips.push({ name, seconds, channels: tracks.length, style: 'spectral hover and cloak motion; no footfall gait', tracks });
}
const q = (axis, ...angles) => angles.map((angle) => quat(axis, angle));
const armQ = (yaw, roll) => new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, roll, 'XYZ')).toArray();
const idleTimes = [0, .75, 1.5, 2.25, 3.0];
const walkTimes = [0, .30, .60, .90, 1.20];
const runTimes = [0, .19, .38, .57, .76];
addClip('Idle', 3.0, [
  { node: 'ReaperRoot', path: 'translation', times: idleTimes, values: [[0,.100,0], [0,.120,-.008], [0,.100,0], [0,.082,.008], [0,.100,0]] },
  { node: 'mixamorigSpine1', times: idleTimes, values: q('z', 0, -.012, 0, .012, 0) },
  { node: 'mixamorigHead', times: idleTimes, values: q('x', 0, -.014, -.026, -.008, 0) },
  { node: 'mixamorigLeftArm', times: idleTimes, values: [armQ(.20,.92), armQ(.24,.87), armQ(.20,.92), armQ(.16,.97), armQ(.20,.92)] },
  { node: 'mixamorigLeftForeArm', times: idleTimes, values: [armQ(.42,-.48), armQ(.46,-.42), armQ(.42,-.48), armQ(.38,-.54), armQ(.42,-.48)] },
  { node: 'mixamorigLeftHand', times: idleTimes, values: [armQ(.30,.10), armQ(.34,.12), armQ(.30,.10), armQ(.28,.08), armQ(.30,.10)] },
  { node: 'mixamorigRightArm', times: idleTimes, values: [armQ(-.20,-.92), armQ(-.24,-.87), armQ(-.20,-.92), armQ(-.16,-.97), armQ(-.20,-.92)] },
  { node: 'mixamorigRightForeArm', times: idleTimes, values: [armQ(-.42,.48), armQ(-.46,.42), armQ(-.42,.48), armQ(-.38,.54), armQ(-.42,.48)] },
  { node: 'mixamorigRightHand', times: idleTimes, values: [armQ(-.30,-.10), armQ(-.34,-.12), armQ(-.30,-.10), armQ(-.28,-.08), armQ(-.30,-.10)] },
  { node: 'ReaperShroudMid', times: idleTimes, values: q('x', 0, .025, 0, -.022, 0) },
  { node: 'ReaperShroudHem', times: idleTimes, values: q('z', 0, -.025, 0, .025, 0) },
  { node: 'ReaperCapeTipL', times: idleTimes, values: q('y', -.03, .025, -.02, .024, -.03) },
  { node: 'ReaperCapeTipR', times: idleTimes, values: q('y', .024, -.02, .026, -.025, .024) },
  { node: 'WaistChainTail', times: idleTimes, values: q('x', 0, .045, .015, -.035, 0) },
]);
addClip('Walk', 1.20, [
  { node: 'ReaperRoot', path: 'translation', times: walkTimes, values: [[0,.095,-.025], [0,.125,0], [0,.095,.025], [0,.078,0], [0,.095,-.025]] },
  { node: 'mixamorigSpine1', times: walkTimes, values: q('x', .02, .045, .02, 0, .02) },
  { node: 'mixamorigSpine2', times: walkTimes, values: q('x', 0, -.035, 0, .035, 0) },
  { node: 'mixamorigHead', times: walkTimes, values: q('y', -.025, -.01, .025, .01, -.025) },
  { node: 'mixamorigLeftArm', times: walkTimes, values: [armQ(.20,.92), armQ(.28,1.00), armQ(.20,.90), armQ(.12,.85), armQ(.20,.92)] },
  { node: 'mixamorigLeftForeArm', times: walkTimes, values: [armQ(.42,-.48), armQ(.48,-.42), armQ(.42,-.50), armQ(.36,-.55), armQ(.42,-.48)] },
  { node: 'mixamorigLeftHand', times: walkTimes, values: [armQ(.30,.10), armQ(.38,.08), armQ(.30,.10), armQ(.25,.12), armQ(.30,.10)] },
  { node: 'mixamorigRightArm', times: walkTimes, values: [armQ(-.20,-.92), armQ(-.28,-1.00), armQ(-.20,-.90), armQ(-.12,-.85), armQ(-.20,-.92)] },
  { node: 'mixamorigRightForeArm', times: walkTimes, values: [armQ(-.42,.48), armQ(-.48,.42), armQ(-.42,.50), armQ(-.36,.55), armQ(-.42,.48)] },
  { node: 'mixamorigRightHand', times: walkTimes, values: [armQ(-.30,-.10), armQ(-.38,-.08), armQ(-.30,-.10), armQ(-.25,-.12), armQ(-.30,-.10)] },
  { node: 'ReaperShroudMid', times: walkTimes, values: q('x', .02, .105, .03, -.035, .02) },
  { node: 'ReaperCapeTipL', times: walkTimes, values: q('y', -.03, .10, -.02, -.10, -.03) },
  { node: 'ReaperCapeTipR', times: walkTimes, values: q('y', .03, -.10, .02, .10, .03) },
  { node: 'WaistChainTail', times: walkTimes, values: q('z', -.015, .09, -.015, -.08, -.015) },
]);
addClip('Run', .76, [
  { node: 'ReaperRoot', path: 'translation', times: runTimes, values: [[0,.090,-.045], [0,.145,-.012], [0,.090,.045], [0,.065,.012], [0,.090,-.045]] },
  { node: 'mixamorigSpine1', times: runTimes, values: q('x', .07, .12, .07, .02, .07) },
  { node: 'mixamorigSpine2', times: runTimes, values: q('x', .03, -.07, .03, .10, .03) },
  { node: 'mixamorigHead', times: runTimes, values: q('x', -.015, -.045, -.015, .02, -.015) },
  { node: 'mixamorigLeftArm', times: runTimes, values: [armQ(.30,.80), armQ(.42,.68), armQ(.24,.88), armQ(.12,1.00), armQ(.30,.80)] },
  { node: 'mixamorigLeftForeArm', times: runTimes, values: [armQ(.45,-.38), armQ(.65,-.25), armQ(.42,-.48), armQ(.30,-.60), armQ(.45,-.38)] },
  { node: 'mixamorigLeftHand', times: runTimes, values: [armQ(.35,.10), armQ(.55,.05), armQ(.32,.10), armQ(.24,.12), armQ(.35,.10)] },
  { node: 'mixamorigRightArm', times: runTimes, values: [armQ(-.30,-.80), armQ(-.42,-.68), armQ(-.24,-.88), armQ(-.12,-1.00), armQ(-.30,-.80)] },
  { node: 'mixamorigRightForeArm', times: runTimes, values: [armQ(-.45,.38), armQ(-.65,.25), armQ(-.42,.48), armQ(-.30,.60), armQ(-.45,.38)] },
  { node: 'mixamorigRightHand', times: runTimes, values: [armQ(-.35,-.10), armQ(-.55,-.05), armQ(-.32,-.10), armQ(-.24,-.12), armQ(-.35,-.10)] },
  { node: 'ReaperShroudMid', times: runTimes, values: q('x', .09, .24, .07, -.08, .09) },
  { node: 'ReaperShroudHem', times: runTimes, values: q('x', .02, .12, -.01, -.13, .02) },
  { node: 'ReaperCapeTipL', times: runTimes, values: q('y', -.05, .17, -.07, -.18, -.05) },
  { node: 'ReaperCapeTipR', times: runTimes, values: q('y', .05, -.18, .07, .17, .05) },
  { node: 'WaistChainTail', times: runTimes, values: q('z', -.04, .13, -.03, -.12, -.04) },
]);
const attackTimes = [0, .18, .42, .64, .90];
addClip('Attack', .90, [
  { node: 'ReaperRoot', path: 'translation', times: attackTimes, values: [[0,.100,0], [0,.085,-.025], [0,.115,.075], [0,.105,.035], [0,.100,0]] },
  { node: 'mixamorigSpine1', times: attackTimes, values: q('x', 0, -.08, .20, .10, 0) },
  { node: 'mixamorigSpine2', times: attackTimes, values: q('x', 0, -.04, .13, .05, 0) },
  { node: 'mixamorigHead', times: attackTimes, values: q('x', 0, .04, -.13, -.04, 0) },
  { node: 'mixamorigLeftArm', times: attackTimes, values: [armQ(.20,.92), armQ(.12,.82), armQ(.70,.62), armQ(.55,.72), armQ(.20,.92)] },
  { node: 'mixamorigLeftForeArm', times: attackTimes, values: [armQ(.42,-.48), armQ(.55,-.35), armQ(.95,-.18), armQ(.90,-.25), armQ(.42,-.48)] },
  { node: 'mixamorigLeftHand', times: attackTimes, values: [armQ(.30,.10), armQ(.55,.10), armQ(.85,.05), armQ(.70,.05), armQ(.30,.10)] },
  { node: 'mixamorigRightArm', times: attackTimes, values: [armQ(-.20,-.92), armQ(-.12,-.82), armQ(-.70,-.62), armQ(-.55,-.72), armQ(-.20,-.92)] },
  { node: 'mixamorigRightForeArm', times: attackTimes, values: [armQ(-.42,.48), armQ(-.55,.35), armQ(-.95,.18), armQ(-.90,.25), armQ(-.42,.48)] },
  { node: 'mixamorigRightHand', times: attackTimes, values: [armQ(-.30,-.10), armQ(-.55,-.10), armQ(-.85,-.05), armQ(-.70,-.05), armQ(-.30,-.10)] },
  { node: 'ReaperShroudMid', times: attackTimes, values: q('x', 0, .10, .38, .20, 0) },
  { node: 'ReaperCapeTipL', times: attackTimes, values: q('y', 0, .12, -.22, -.08, 0) },
  { node: 'ReaperCapeTipR', times: attackTimes, values: q('y', 0, -.12, .22, .08, 0) },
  { node: 'WaistChainTail', times: attackTimes, values: q('x', 0, .12, .30, .10, 0) },
]);
const hitTimes = [0, .08, .20, .36, .52];
addClip('Hit', .52, [
  { node: 'ReaperRoot', path: 'translation', times: hitTimes, values: [[0,.100,0], [0,.08,-.045], [0,.095,-.018], [0,.105,0], [0,.100,0]] },
  { node: 'mixamorigSpine1', times: hitTimes, values: q('x', 0, -.19, -.10, .035, 0) },
  { node: 'mixamorigSpine2', times: hitTimes, values: q('z', 0, .14, .07, -.02, 0) },
  { node: 'mixamorigHead', times: hitTimes, values: q('x', 0, .15, .06, -.02, 0) },
  { node: 'mixamorigLeftArm', times: hitTimes, values: [armQ(.20,.92), armQ(.10,.70), armQ(.15,.80), armQ(.20,.86), armQ(.20,.92)] },
  { node: 'mixamorigLeftForeArm', times: hitTimes, values: [armQ(.42,-.48), armQ(.25,-.35), armQ(.32,-.40), armQ(.38,-.46), armQ(.42,-.48)] },
  { node: 'mixamorigLeftHand', times: hitTimes, values: [armQ(.30,.10), armQ(.18,.15), armQ(.25,.14), armQ(.29,.10), armQ(.30,.10)] },
  { node: 'mixamorigRightArm', times: hitTimes, values: [armQ(-.20,-.92), armQ(-.10,-.70), armQ(-.15,-.80), armQ(-.20,-.86), armQ(-.20,-.92)] },
  { node: 'mixamorigRightForeArm', times: hitTimes, values: [armQ(-.42,.48), armQ(-.25,.35), armQ(-.32,.40), armQ(-.38,.46), armQ(-.42,.48)] },
  { node: 'mixamorigRightHand', times: hitTimes, values: [armQ(-.30,-.10), armQ(-.18,-.15), armQ(-.25,-.14), armQ(-.29,-.10), armQ(-.30,-.10)] },
  { node: 'ReaperShroudMid', times: hitTimes, values: q('x', 0, -.20, -.07, .03, 0) },
  { node: 'WaistChainTail', times: hitTimes, values: q('z', 0, -.15, -.05, .01, 0) },
]);
const deathTimes = [0, .32, .72, 1.18, 1.75];
addClip('Death', 1.75, [
  { node: 'ReaperRoot', path: 'translation', times: deathTimes, values: [[0,.100,0], [0,.145,0], [0,.115,-.02], [0,.055,-.035], [0,.025,-.04]] },
  { node: 'mixamorigHips', times: deathTimes, values: q('x', 0, -.06, -.14, -.20, -.20) },
  { node: 'mixamorigSpine1', times: deathTimes, values: q('x', 0, .08, .22, .32, .32) },
  { node: 'mixamorigSpine2', times: deathTimes, values: q('x', 0, .05, .15, .24, .24) },
  { node: 'mixamorigHead', times: deathTimes, values: q('x', 0, -.04, -.14, -.25, -.25) },
  { node: 'mixamorigLeftArm', times: deathTimes, values: [armQ(.20,.92), armQ(.15,.80), armQ(.08,.74), armQ(.02,.72), armQ(.02,.72)] },
  { node: 'mixamorigLeftForeArm', times: deathTimes, values: [armQ(.42,-.48), armQ(.20,-.32), armQ(.10,-.25), armQ(.05,-.20), armQ(.05,-.20)] },
  { node: 'mixamorigLeftHand', times: deathTimes, values: [armQ(.30,.10), armQ(.15,.08), armQ(.08,.04), armQ(.03,0), armQ(.03,0)] },
  { node: 'mixamorigRightArm', times: deathTimes, values: [armQ(-.20,-.92), armQ(-.15,-.80), armQ(-.08,-.74), armQ(-.02,-.72), armQ(-.02,-.72)] },
  { node: 'mixamorigRightForeArm', times: deathTimes, values: [armQ(-.42,.48), armQ(-.20,.32), armQ(-.10,.25), armQ(-.05,.20), armQ(-.05,.20)] },
  { node: 'mixamorigRightHand', times: deathTimes, values: [armQ(-.30,-.10), armQ(-.15,-.08), armQ(-.08,-.04), armQ(-.03,0), armQ(-.03,0)] },
  { node: 'ReaperShroudMid', times: deathTimes, values: q('x', 0, -.06, -.20, -.34, -.34) },
  { node: 'ReaperShroudHem', times: deathTimes, values: q('z', 0, .10, .24, .36, .36) },
  { node: 'ReaperCapeTipL', times: deathTimes, values: q('y', 0, .10, .27, .40, .40) },
  { node: 'ReaperCapeTipR', times: deathTimes, values: q('y', 0, -.10, -.25, -.38, -.38) },
  { node: 'WaistChainTail', times: deathTimes, values: q('x', 0, .06, .16, .20, .20) },
]);

const sourceTextures = [];
const runtimeTextures = [];
const material = root.listMaterials()[0];
const baseTexture = material?.getBaseColorTexture();
const packedPbrTexture = material?.getMetallicRoughnessTexture();
const normalTexture = material?.getNormalTexture();
if (!baseTexture || !packedPbrTexture || !normalTexture) throw new Error('Required base-color, roughness/metalness, or normal map missing.');
for (const texture of root.listTextures()) {
  const image = texture.getImage();
  const meta = await sharp(image).metadata();
  sourceTextures.push({ name: texture.getName(), width: meta.width, height: meta.height, mimeType: texture.getMimeType(), bytes: image.length, sha256: sha(image) });
  if (meta.width > 2048 || meta.height > 2048) throw new Error(`Unexpected non-2K source map ${texture.getName()} ${meta.width}x${meta.height}.`);
  runtimeTextures.push({ name: texture.getName(), width: meta.width, height: meta.height, mimeType: texture.getMimeType(), bytes: image.length, sha256: sha(image) });
}
const pbrRaw = await sharp(packedPbrTexture.getImage()).removeAlpha().resize(128, 128).raw().toBuffer({ resolveWithObject: true });
const channelRange = (channel) => {
  const values = [];
  for (let i = channel; i < pbrRaw.data.length; i += pbrRaw.info.channels) values.push(pbrRaw.data[i]);
  values.sort((a, b) => a - b);
  return [values[0] / 255, values[Math.floor(values.length / 2)] / 255, values.at(-1) / 255];
};
const pbrRanges = { occlusion: channelRange(0), roughness: channelRange(1), metallic: channelRange(2) };
if (!(pbrRanges.roughness[2] - pbrRanges.roughness[0] > .12) || !(pbrRanges.metallic[2] - pbrRanges.metallic[0] > .05)) {
  throw new Error(`Source PBR map is missing surface variation: ${JSON.stringify(pbrRanges)}.`);
}

// CPU-sample all six clips against the skin matrices before serialization. This checks that
// the ghost stays airborne through locomotion and that the attack/death actually deform mesh.
function trackValue(track, time) {
  if (!track) return undefined;
  if (time <= track.times[0]) return track.values[0];
  if (time >= track.times.at(-1)) return track.values.at(-1);
  let index = 0;
  while (track.times[index + 1] < time) index++;
  const amount = (time - track.times[index]) / (track.times[index + 1] - track.times[index]);
  const a = track.values[index], b = track.values[index + 1];
  if (track.path !== 'translation') {
    return new THREE.Quaternion(...a).slerp(new THREE.Quaternion(...b), amount).toArray();
  }
  return a.map((value, axis) => value + (b[axis] - value) * amount);
}
function samplePose(tracks, time) {
  const byTarget = new Map(tracks.map((track) => [`${track.node}|${track.path ?? 'rotation'}`, track]));
  const world = new Map(), matrices = new Map();
  for (const bone of bones) {
    const translation = trackValue(byTarget.get(`${bone.name}|translation`), time) ?? bone.local;
    const rotation = trackValue(byTarget.get(`${bone.name}|rotation`), time) ?? [0, 0, 0, 1];
    const local = new THREE.Matrix4().compose(new THREE.Vector3(...translation), new THREE.Quaternion(...rotation), new THREE.Vector3(1, 1, 1));
    const global = bone.parent ? world.get(bone.parent).clone().multiply(local) : local;
    world.set(bone.name, global);
    matrices.set(bone.name, global.clone().multiply(new THREE.Matrix4().makeTranslation(-bone.p[0], -bone.p[1], -bone.p[2])));
  }
  let minY = Infinity, maxDelta = 0;
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const original = new THREE.Vector3(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]);
    const posed = new THREE.Vector3();
    for (let slot = 0; slot < 4; slot++) {
      const weight = weightValues[vertex * 4 + slot];
      if (weight <= 0) continue;
      posed.addScaledVector(original.clone().applyMatrix4(matrices.get(bones[jointValues[vertex * 4 + slot]].name)), weight);
    }
    posed.multiplyScalar(presentationScale);
    minY = Math.min(minY, posed.y);
    maxDelta = Math.max(maxDelta, posed.distanceTo(original.clone().multiplyScalar(presentationScale)));
  }
  const jointPosition = (name) => new THREE.Vector3().setFromMatrixPosition(world.get(name)).multiplyScalar(presentationScale).toArray();
  return {
    minY,
    maxDelta,
    hands: { left: jointPosition('mixamorigLeftHand'), right: jointPosition('mixamorigRightHand') },
    shoulders: { left: jointPosition('mixamorigLeftShoulder'), right: jointPosition('mixamorigRightShoulder') },
  };
}
const clipMetrics = {};
for (const clip of clips) {
  const tracks = clip.tracks;
  const times = [...new Set([0, clip.seconds * .25, clip.seconds * .5, clip.seconds * .75, clip.seconds])];
  const frames = times.map((time) => ({ time, ...samplePose(tracks, time) }));
  clipMetrics[clip.name] = frames;
  const maximumDelta = Math.max(...frames.map((frame) => frame.maxDelta));
  if (maximumDelta < .015) throw new Error(`${clip.name} does not produce visible skin deformation (${maximumDelta}).`);
  if (['Idle', 'Walk', 'Run'].includes(clip.name) && Math.min(...frames.map((frame) => frame.minY)) < .07) {
    throw new Error(`${clip.name} loses visible hover clearance: ${JSON.stringify(frames)}.`);
  }
}
const idlePose = clipMetrics.Idle[0];
const leftArmDrop = idlePose.shoulders.left[1] - idlePose.hands.left[1];
const rightArmDrop = idlePose.shoulders.right[1] - idlePose.hands.right[1];
if (leftArmDrop < .18 || rightArmDrop < .18) throw new Error(`Idle arms remain too horizontal: drops=${leftArmDrop},${rightArmDrop}.`);
const attackContact = clipMetrics.Attack.find((frame) => Math.abs(frame.time - .45) < 1e-4);
const attackReachLeft = attackContact.hands.left[2] - idlePose.hands.left[2];
const attackReachRight = attackContact.hands.right[2] - idlePose.hands.right[2];
if (attackReachLeft < .10 || attackReachRight < .10) throw new Error(`Attack hands do not reach forward: deltaZ=${attackReachLeft},${attackReachRight}.`);
const basePoseByClip = Object.fromEntries(Object.entries(clipMetrics).map(([name, frames]) => {
  const frame = frames[0];
  return [name, {
    leftArmDropMeters: frame.shoulders.left[1] - frame.hands.left[1],
    rightArmDropMeters: frame.shoulders.right[1] - frame.hands.right[1],
    leftHandZMeters: frame.hands.left[2],
    rightHandZMeters: frame.hands.right[2],
  }];
}));
for (const [name, pose] of Object.entries(basePoseByClip)) {
  if (pose.leftArmDropMeters < .18 || pose.rightArmDropMeters < .18) throw new Error(`${name} clip starts in a horizontal arm pose: ${JSON.stringify(pose)}.`);
}
const poseSummary = Object.fromEntries(Object.entries(clipMetrics).map(([name, frames]) => [name, frames.map(({ time, minY, maxDelta }) => ({ time, minY, maxDelta }))]));
if (verticesWithDistributedWeights < positions.length / 3 * .60 || verticesWithCloakInfluence < positions.length / 3 * .12) {
  throw new Error(`Rig weight coverage is too sparse: distributed=${verticesWithDistributedWeights}, cloak=${verticesWithCloakInfluence}.`);
}
if (maximumWeightSumError > 1e-5) throw new Error(`Skin weights are not normalized: ${maximumWeightSumError}.`);

const outputBytes = await io.writeBinary(doc);
await writeFile(candidatePath, outputBytes);
const candidateSha = sha(outputBytes);
const checkDoc = await io.readBinary(outputBytes);
const checkRoot = checkDoc.getRoot();
const checkPrimitive = checkRoot.listMeshes()[0]?.listPrimitives()[0];
const checkSkin = checkRoot.listSkins()[0];
const checkPositions = checkPrimitive?.getAttribute('POSITION')?.getArray();
const checkNormals = checkPrimitive?.getAttribute('NORMAL')?.getArray();
const checkUvs = checkPrimitive?.getAttribute('TEXCOORD_0')?.getArray();
const checkIndices = checkPrimitive?.getIndices()?.getArray();
const checkJoints = checkPrimitive?.getAttribute('JOINTS_0')?.getArray();
const checkWeights = checkPrimitive?.getAttribute('WEIGHTS_0')?.getArray();
if (!checkPositions || !checkNormals || !checkUvs || !checkIndices || !checkJoints || !checkWeights || !checkSkin) throw new Error('Serialized candidate is missing mesh/skin attributes.');
const mismatchCount = (a, b) => { let count = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) count++; return count; };
const geometryMismatches = {
  positions: mismatchCount(positions, checkPositions), normals: mismatchCount(normals, checkNormals),
  uvs: mismatchCount(uvs, checkUvs), indices: mismatchCount(indices, checkIndices),
};
if (Object.values(geometryMismatches).some(Boolean)) throw new Error(`Source geometry/UV changed: ${JSON.stringify(geometryMismatches)}.`);
const clipsAfter = checkRoot.listAnimations().map((animation) => animation.getName());
const requiredClips = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
if (requiredClips.some((name) => !clipsAfter.includes(name))) throw new Error(`Missing gameplay clips: ${clipsAfter}`);
for (const animation of checkRoot.listAnimations()) for (const channel of animation.listChannels()) {
  if (!checkSkin.listJoints().includes(channel.getTargetNode())) throw new Error(`${animation.getName()} targets a non-joint node.`);
}
const postTextureHashes = checkRoot.listTextures().map((texture) => sha(texture.getImage()));
if (postTextureHashes.join(',') !== runtimeTextures.map((texture) => texture.sha256).join(',')) throw new Error('Embedded PBR images changed during serialization.');

const scaledBounds = { min: bounds.min.map((value) => value * presentationScale), max: bounds.max.map((value) => value * presentationScale) };
const size = scaledBounds.max.map((value, axis) => value - scaledBounds.min[axis]);
const clipSummaries = clips.map(({ tracks, ...summary }) => summary);
const rigMethod = 'Replaced the all-Hips source weights with a model-fitted 32-joint Mixamo-named Unity Humanoid/cloak rig and four normalized spatial influences per vertex. The original 4,595-triangle mesh, normals, UVs and 2K base-color, packed roughness/metalness and normal maps are byte-preserved. The idle pose lowers and curls both arms; every gameplay clip preserves that posture, while Attack turns both forearms forward to reach. Root animation supplies hover; Walk and Run are spectral glides with no footfall gait.';
const candidate = {
  schema: 'corealm-creature-native-rig-candidate/1', id: productionId, displayName,
  status: 'awaiting-root-lab-review', accepted: false,
  source: {
    file: sourceFile, sha256: sourceSha, bytes: sourceBytes.length,
    starredModelId: projectId, tripoProjectId: projectId, starredCardId: cardStorageId,
    starredDisplayName: 'grim reaper 3d model', prompt: 'dark hooded skeletal demon with red eyes, jagged bone armor, tattered cloak, chained waist, clawed feet',
    geometry: { vertices: positions.length / 3, triangles: indices.length / 3, bounds, hashes: sourceGeometryHashes, positionsPreserved: true, normalsPreserved: true, indicesPreserved: true, uvPreserved: true, retopology: false },
    originalRig: { joints: 59, sourceClips: [], defect: 'All 7,030 vertices have 100 percent weight on Hips, so no limb or cloak motion is possible.' },
    materials: { metallicFactor: material.getMetallicFactor(), roughnessFactor: material.getRoughnessFactor(), pbrMapInterpretation: 'glTF metallic-roughness texture; G=roughness, B=metallic' },
    textures: sourceTextures,
  },
  candidate: {
    file: candidatePath, sha256: candidateSha, bytes: outputBytes.length, productionTarget: `game/public/assets/models/creature/${productionId}.glb`,
    presentationScale, geometry: { vertices: positions.length / 3, triangles: indices.length / 3, maxPositionDelta: 0, normalMismatches: 0, indexMismatches: 0, uvMismatches: 0, scaledBounds, size },
    rig: { type: 'Mixamo-named Unity Humanoid-mappable glTF skin with spectral cloak extensions', jointCount: bones.length, joints: bones.map(({ name, parent, p, group }) => ({ name, parent, restPosition: p, role: group })), influencesPerVertex: 4, verticesWithDistributedWeights, verticesWithCloakInfluence, maximumWeightSumError, method: rigMethod },
    basePose: { arms: 'Lowered and curled, with hands angled forward. This posture is present at the first key of all six clips.', leftArmDropMeters: leftArmDrop, rightArmDropMeters: rightArmDrop, clipStarts: basePoseByClip, attackReachDeltaZMeters: { left: attackReachLeft, right: attackReachRight } },
    textures: runtimeTextures, packedPbrRanges: pbrRanges, animations: clipSummaries, poseSamples: poseSummary,
  },
  placement: { suggestedRegion: 'Wilderness / Dark Night Castle approaches', suggestedTier: 'T60+', role: 'high-threat floating elite; red-eyed hooded skeletal reaper', scaleReason: 'The 0.97 m source mesh is presented at 1.98 m for an elite humanoid silhouette. Larger bosses should remain above this tier.' },
  acceptance: { sourceIdentityVerified: true, geometry: true, weights: true, animations: true, pbr: true, normalCameraLabAccepted: false, worldIntegrated: false },
};
await writeFile(`${ownerDir}/catalog.json`, JSON.stringify(candidate, null, 2) + '\n');
await writeFile(`${ownerDir}/validation.json`, JSON.stringify({ source: { file: sourceFile, sha256: sourceSha, bytes: sourceBytes.length }, candidate: { file: candidatePath, sha256: candidateSha, bytes: outputBytes.length }, geometryMismatches, vertices: positions.length / 3, triangles: indices.length / 3, joints: bones.length, weight: { verticesWithDistributedWeights, verticesWithCloakInfluence, maximumWeightSumError }, basePose: { clips: basePoseByClip, attackReachDeltaZMeters: { left: attackReachLeft, right: attackReachRight } }, textures: runtimeTextures, pbrRanges, clips: clipsAfter, poseSamples: poseSummary, acceptance: 'Automated source/rig/material/clip checks pass; normal-camera feature-lab acceptance remains pending root review.' }, null, 2) + '\n');
const labAsset = {
  id: productionId, file: `models/creature/${productionId}.glb`, pack: 'corealm-starred-creatures', category: 'character',
  is: `${displayName} (floating wilderness elite candidate)`, tags: ['creature', 'undead', 'reaper', 'floating', 'wilderness', 'dark-night-castle', 'T60', 'starred', 'tripo', 'candidate'],
  bytes: outputBytes.length, sha256: candidateSha, size: { x: size[0], y: size[1], z: size[2] },
  base: { x: scaledBounds.min[0], y: scaledBounds.min[1], z: scaledBounds.min[2] }, bounds: scaledBounds, groundY: scaledBounds.min[1],
  triangles: indices.length / 3, animations: clipsAfter, materials: checkRoot.listMaterials().map((entry) => entry.getName()),
  walkClipSeconds: 1.20, runClipSeconds: .76, attackSeconds: .90, contactNormalized: .47,
  sourceProvenance: { author: 'Corealm candidate rig reconstruction', sourceModelId: projectId, cardStorageId, sourceFile, sourceSha256: sourceSha, candidateFile: candidatePath, candidateSha256: candidateSha, rigMethod, locomotion: 'Floating hover, slow spectral drift and fast glide. Walk and Run keep the action-map names without planted steps.', pbr: 'Preserves the embedded layered base-color, roughness/metalness and normal maps unchanged at 2K.', noRetopology: true, geometryUnchanged: true, candidateStatus: 'awaiting-root-lab-review' },
  acceptance: { assetAudit: false, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${ownerDir}/lab-catalog.json`, JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', files: { [productionId]: path.basename(candidatePath) }, assets: [labAsset], pack: { id: 'corealm-starred-creatures', name: 'Corealm starred creatures', author: 'Corealm', source: 'Tripo generated and Corealm adapted', license: 'LicenseRef-Tripo-Generated' } }, null, 2) + '\n');
console.log(JSON.stringify({ candidatePath, candidateSha, bytes: outputBytes.length, vertices: positions.length / 3, triangles: indices.length / 3, joints: bones.length, clips: clipsAfter, verticesWithDistributedWeights, verticesWithCloakInfluence, maximumWeightSumError, pbrRanges, basePose: basePoseByClip, attackReachDeltaZMeters: { left: attackReachLeft, right: attackReachRight }, poseSamples: poseSummary, geometryMismatches }, null, 2));
