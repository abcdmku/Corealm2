import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import * as THREE from 'three';

const baseDir = 'assets/art/tripo/imports/creatures/emberbank-brute';
const sourcePath = 'assets/art/tripo/exports/corealm_emberbank_brute_2b3179ac_8k_rigged.glb';
const archivePath = `${baseDir}/source-original.glb`;
const candidatePath = `${baseDir}/emberbank-brute-native-rig-candidate.glb`;
const expectedSourceHash = '3368af107a2b4afcfee27c18f2da9e6a113679123fc7691cdeecd9012d31383b';
await mkdir(baseDir, { recursive: true });

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
if (sourceSha256 !== expectedSourceHash) throw new Error(`Approved source hash mismatch: ${sourceSha256}`);
await copyFile(sourcePath, archivePath);
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const skin = root.listSkins()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find((node) => node.getMesh() === mesh);
if (!scene || !skin || !primitive || !meshNode || skin.listJoints().length !== 54 || root.listAnimations().length !== 0) {
  throw new Error('Expected the approved 54-joint zero-animation source.');
}
const joints = skin.listJoints();
const positions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
const indices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
const uvs = Float32Array.from(primitive.getAttribute('TEXCOORD_0')?.getArray() ?? []);
const originalJointBytes = Buffer.from(primitive.getAttribute('JOINTS_0')?.getArray().buffer ?? []);
const sourceBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  sourceBounds.min[axis] = Math.min(sourceBounds.min[axis], positions[i + axis]);
  sourceBounds.max[axis] = Math.max(sourceBounds.max[axis], positions[i + axis]);
}

// The export's 54 joint nodes are collapsed at the origin. Its inverse-bind
// matrices retain the intended pose, so reconstruct their local transforms.
const inverseBinds = skin.getInverseBindMatrices();
const jointWorld = joints.map((joint, i) => new THREE.Matrix4().fromArray(inverseBinds.getElement(i, [])).invert());
const jointIndex = new Map(joints.map((joint, i) => [joint, i]));
const jointByName = new Map(joints.map((joint, i) => [joint.getName(), { joint, i }]));
for (let i = 0; i < joints.length; i++) {
  const parent = joints[i].getParentNode();
  const parentIndex = jointIndex.get(parent);
  const local = parentIndex === undefined ? jointWorld[i] : jointWorld[parentIndex].clone().invert().multiply(jointWorld[i]);
  const translation = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  local.decompose(translation, rotation, scale);
  if (Math.max(...scale.toArray().map((value) => Math.abs(value - 1))) > 0.002) {
    throw new Error(`Unexpected scale in reconstructed bind pose for ${joints[i].getName()}.`);
  }
  joints[i].setTranslation(translation.toArray()).setRotation(rotation.toArray()).setScale([1, 1, 1]);
}
const jointPoint = jointWorld.map((matrix) => new THREE.Vector3().setFromMatrixPosition(matrix).toArray());

const activeNames = [
  'mixamorig:Hips', 'mixamorig:Spine', 'mixamorig:Spine1', 'mixamorig:Spine2', 'mixamorig:Neck', 'mixamorig:Head',
  'mixamorig:LeftShoulder', 'mixamorig:LeftArm', 'mixamorig:LeftForeArm', 'mixamorig:LeftHand',
  'mixamorig:RightShoulder', 'mixamorig:RightArm', 'mixamorig:RightForeArm', 'mixamorig:RightHand',
  'mixamorig:LeftUpLeg', 'mixamorig:LeftLeg', 'mixamorig:LeftFoot', 'mixamorig:LeftToeBase',
  'mixamorig:RightUpLeg', 'mixamorig:RightLeg', 'mixamorig:RightFoot', 'mixamorig:RightToeBase',
];
const active = activeNames.map((name) => jointByName.get(name)?.i);
if (active.some((i) => i === undefined)) throw new Error('Source is missing a required Mixamo body joint.');
const byName = (name) => jointByName.get(`mixamorig:${name}`).i;
const sideOf = (name) => name.startsWith('Left') ? -1 : name.startsWith('Right') ? 1 : 0;
const groupOf = (name) => {
  if (/^(Hips|Spine|Spine1|Spine2|Neck)$/.test(name)) return 'torso';
  if (name === 'Head') return 'head';
  if (/^(Left|Right)(Shoulder|Arm|ForeArm|Hand)$/.test(name)) return name.startsWith('Left') ? 'leftArm' : 'rightArm';
  if (/^(Left|Right)(UpLeg|Leg|Foot|ToeBase)$/.test(name)) return name.startsWith('Left') ? 'leftLeg' : 'rightLeg';
  return 'other';
};
const sigmaOf = (name) => ({ Hips: .115, Spine: .105, Spine1: .11, Spine2: .105, Neck: .075, Head: .13,
  Shoulder: .08, Arm: .09, ForeArm: .085, Hand: .09, UpLeg: .085, Leg: .08, Foot: .07, ToeBase: .07 })[name.replace(/^Left|^Right/, '')] ?? .07;
function segmentDistance(point, start, end) {
  const vector = end.map((value, axis) => value - start[axis]);
  const length2 = vector.reduce((sum, value) => sum + value * value, 0) || 1;
  const t = Math.max(0, Math.min(1, point.reduce((sum, value, axis) => sum + (value - start[axis]) * vector[axis], 0) / length2));
  return Math.hypot(...point.map((value, axis) => value - (start[axis] + t * vector[axis])));
}
const jointValues = new Uint16Array(positions.length / 3 * 4);
const weightValues = new Float32Array(positions.length / 3 * 4);
const influenceMass = new Float64Array(joints.length);
let maxWeightSumError = 0;
let verticesWithDistributedWeights = 0;
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const [x, y, z] = point;
  const candidates = [];
  for (const i of active) {
    const name = joints[i].getName().replace('mixamorig:', '');
    const group = groupOf(name);
    const side = sideOf(name);
    let gate = 1;
    if (group === 'head') gate = y > 0.77 ? 1 : 0.002;
    if (group === 'leftArm' || group === 'rightArm') {
      const lateral = side * z;
      gate = y > 0.30 && y < 0.94 ? 1 : 0.003;
      gate *= 0.015 + 0.985 / (1 + Math.exp(-(lateral - 0.025) / 0.035));
    }
    if (group === 'leftLeg' || group === 'rightLeg') {
      const lateral = side * z;
      gate = y < 0.61 ? 1 : 0.002;
      gate *= 0.02 + 0.98 / (1 + Math.exp(-(lateral - 0.008) / 0.035));
    }
    const parent = joints[i].getParentNode();
    const parentI = jointIndex.get(parent);
    const start = parentI === undefined ? jointPoint[i] : jointPoint[parentI];
    const distance = segmentDistance(point, start, jointPoint[i]);
    const sigma = sigmaOf(name);
    const score = gate * Math.exp(-0.5 * (distance / sigma) ** 2);
    if (score > 1e-12) candidates.push({ i, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 4);
  if (!chosen.length) throw new Error(`No anatomical weight for vertex ${vertex}.`);
  const total = chosen.reduce((sum, item) => sum + item.score, 0);
  let assigned = 0, nonzero = 0;
  for (let slot = 0; slot < 4; slot++) {
    const item = chosen[slot] ?? chosen[0];
    const weight = slot >= chosen.length ? 0 : slot === chosen.length - 1 ? 1 - assigned : item.score / total;
    jointValues[vertex * 4 + slot] = item.i;
    weightValues[vertex * 4 + slot] = weight;
    assigned += weight;
    influenceMass[item.i] += weight;
    if (weight > 1e-6) nonzero++;
  }
  maxWeightSumError = Math.max(maxWeightSumError, Math.abs(assigned - 1));
  if (nonzero > 1) verticesWithDistributedWeights++;
}
const buffer = root.listBuffers()[0];
primitive.setAttribute('JOINTS_0', doc.createAccessor('Emberbank_Repaired_Joints0').setArray(jointValues).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('Emberbank_Repaired_Weights0').setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(buffer));

const quat = (axis, angle) => { const s = Math.sin(angle / 2), c = Math.cos(angle / 2); return axis === 'x' ? [s, 0, 0, c] : axis === 'y' ? [0, s, 0, c] : [0, 0, s, c]; };
const clips = [];
function addClip(name, duration, tracks) {
  const animation = doc.createAnimation(name);
  for (const track of tracks) {
    const input = doc.createAccessor(`${name}_${track.node}_time`).setArray(Float32Array.from(track.times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const type = track.path === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4;
    const output = doc.createAccessor(`${name}_${track.node}_${track.path ?? 'rotation'}_value`).setArray(Float32Array.from(track.values.flat())).setType(type).setBuffer(buffer);
    const sampler = doc.createAnimationSampler(`${name}_${track.node}_${track.path ?? 'rotation'}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${track.node}_${track.path ?? 'rotation'}`).setTargetNode(jointByName.get(track.node).joint).setTargetPath(track.path ?? 'rotation').setSampler(sampler));
  }
  clips.push({ name, duration, channels: tracks.length });
}
const phases = [0, .25, .5, .75, 1];
const cycle = (phase, amount, axis = 'z') => phases.map((t) => quat(axis, Math.sin((t + phase) * Math.PI * 2) * amount));
const hips = (values) => phases.map((_, i) => [0, values[i], 0]);
const standardTimes = (duration) => phases.map((t) => t * duration);
addClip('Idle', 2.8, [
  { node: 'mixamorig:Spine1', times: [0, .7, 1.4, 2.1, 2.8], values: [quat('z', 0), quat('z', .014), quat('z', 0), quat('z', -.014), quat('z', 0)] },
  { node: 'mixamorig:Spine2', times: [0, .7, 1.4, 2.1, 2.8], values: [quat('x', 0), quat('x', -.012), quat('x', 0), quat('x', .012), quat('x', 0)] },
  { node: 'mixamorig:Head', times: [0, .7, 1.4, 2.1, 2.8], values: [quat('z', -.02), quat('z', .018), quat('z', .025), quat('z', -.01), quat('z', -.02)] },
]);
for (const [name, duration, stride, bend, bob] of [['Walk', 1.05, .30, .17, .008], ['Run', .72, .59, .46, .018]]) {
  const times = standardTimes(duration);
  const tracks = [
    { node: 'mixamorig:Hips', path: 'translation', times, values: hips(phases.map((t) => .572 + Math.sin(t * Math.PI * 2) * bob)) },
    { node: 'mixamorig:LeftUpLeg', times, values: cycle(0, stride) }, { node: 'mixamorig:RightUpLeg', times, values: cycle(.5, stride) },
    { node: 'mixamorig:LeftLeg', times, values: phases.map((t) => quat('z', -Math.max(0, Math.sin(t * Math.PI * 2)) * bend)) },
    { node: 'mixamorig:RightLeg', times, values: phases.map((t) => quat('z', -Math.max(0, Math.sin((t + .5) * Math.PI * 2)) * bend)) },
    { node: 'mixamorig:LeftArm', times, values: cycle(.5, stride * .64) }, { node: 'mixamorig:RightArm', times, values: cycle(0, stride * .64) },
    { node: 'mixamorig:Spine1', times, values: phases.map((t) => quat('z', Math.sin(t * Math.PI * 2) * .018)) },
  ];
  addClip(name, duration, tracks);
}
addClip('Attack', .96, [
  { node: 'mixamorig:Hips', path: 'translation', times: [0, .18, .48, .72, .96], values: [[0,.572,0],[0,.56,0],[.025,.55,0],[0,.57,0],[0,.572,0]] },
  { node: 'mixamorig:Spine1', times: [0,.18,.48,.72,.96], values: [quat('z',0),quat('z',-.18),quat('z',.24),quat('z',.08),quat('z',0)] },
  { node: 'mixamorig:RightArm', times: [0,.18,.48,.72,.96], values: [quat('x',0),quat('x',-.68),quat('x',.25),quat('x',.12),quat('x',0)] },
  { node: 'mixamorig:RightForeArm', times: [0,.18,.48,.72,.96], values: [quat('x',0),quat('x',-.5),quat('x',.72),quat('x',.28),quat('x',0)] },
  { node: 'mixamorig:LeftArm', times: [0,.18,.48,.72,.96], values: [quat('x',0),quat('x',-.3),quat('x',-.18),quat('x',-.08),quat('x',0)] },
]);
addClip('Hit', .44, [
  { node: 'mixamorig:Hips', path: 'translation', times: [0,.08,.2,.44], values: [[0,.572,0],[-.045,.56,0],[-.012,.57,0],[0,.572,0]] },
  { node: 'mixamorig:Spine1', times: [0,.08,.2,.44], values: [quat('z',0),quat('z',.23),quat('z',-.08),quat('z',0)] },
  { node: 'mixamorig:Spine2', times: [0,.08,.2,.44], values: [quat('x',0),quat('x',-.13),quat('x',.04),quat('x',0)] },
  { node: 'mixamorig:Head', times: [0,.08,.2,.44], values: [quat('z',0),quat('z',.13),quat('z',-.04),quat('z',0)] },
  { node: 'mixamorig:RightArm', times: [0,.08,.2,.44], values: [quat('x',0),quat('x',.24),quat('x',-.05),quat('x',0)] },
]);
addClip('Death', 1.5, [
  { node: 'mixamorig:Hips', path: 'translation', times: [0,.22,.68,1.1,1.5], values: [[0,.572,0],[0,.55,0],[0,.36,0],[0,.28,0],[0,.28,0]] },
  { node: 'mixamorig:Hips', times: [0,.22,.68,1.1,1.5], values: [quat('x',0),quat('x',-.1),quat('x',-.26),quat('x',-.32),quat('x',-.32)] },
  { node: 'mixamorig:Spine1', times: [0,.22,.68,1.1,1.5], values: [quat('z',0),quat('z',.12),quat('z',.28),quat('z',.32),quat('z',.32)] },
  { node: 'mixamorig:Spine2', times: [0,.22,.68,1.1,1.5], values: [quat('z',0),quat('z',.1),quat('z',.2),quat('z',.23),quat('z',.23)] },
  { node: 'mixamorig:Head', times: [0,.22,.68,1.1,1.5], values: [quat('z',0),quat('z',.1),quat('z',.26),quat('z',.32),quat('z',.32)] },
  { node: 'mixamorig:LeftArm', times: [0,.22,.68,1.1,1.5], values: [quat('x',0),quat('x',.12),quat('x',.48),quat('x',.55),quat('x',.55)] },
  { node: 'mixamorig:RightArm', times: [0,.22,.68,1.1,1.5], values: [quat('x',0),quat('x',-.1),quat('x',-.42),quat('x',-.5),quat('x',-.5)] },
  { node: 'mixamorig:LeftUpLeg', times: [0,.22,.68,1.1,1.5], values: [quat('z',0),quat('z',-.04),quat('z',-.2),quat('z',-.26),quat('z',-.26)] },
  { node: 'mixamorig:RightUpLeg', times: [0,.22,.68,1.1,1.5], values: [quat('z',0),quat('z',.04),quat('z',.2),quat('z',.26),quat('z',.26)] },
]);

const textureStats = [];
for (const texture of root.listTextures()) {
  const original = texture.getImage();
  const metadata = await sharp(original).metadata();
  textureStats.push({ name: texture.getName(), sourceWidth: metadata.width, sourceHeight: metadata.height, sourceSha256: createHash('sha256').update(original).digest('hex') });
  if (metadata.width > 2048 || metadata.height > 2048) texture.setImage(await sharp(original).resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer());
}
const texture = root.listTextures()[0];
const textureOutMeta = await sharp(texture.getImage()).metadata();
const textureOutSha = createHash('sha256').update(texture.getImage()).digest('hex');
textureStats[0].runtime = { width: textureOutMeta.width, height: textureOutMeta.height, sha256: textureOutSha, mapType: 'baseColor' };

const outputBytes = await io.writeBinary(doc);
await writeFile(candidatePath, outputBytes);
const candidateSha256 = createHash('sha256').update(outputBytes).digest('hex');
const checkRoot = (await io.readBinary(outputBytes)).getRoot();
const checkPrimitive = checkRoot.listMeshes()[0].listPrimitives()[0];
const checkSkin = checkRoot.listSkins()[0];
const checkPositions = checkPrimitive.getAttribute('POSITION').getArray();
const checkIndices = checkPrimitive.getIndices().getArray();
const checkUvs = checkPrimitive.getAttribute('TEXCOORD_0').getArray();
const checkWeights = checkPrimitive.getAttribute('WEIGHTS_0').getArray();
const checkJoints = checkPrimitive.getAttribute('JOINTS_0').getArray();
let maxGeometryDelta = 0, indexMismatches = 0, uvMismatches = 0;
for (let i = 0; i < positions.length; i++) maxGeometryDelta = Math.max(maxGeometryDelta, Math.abs(positions[i] - checkPositions[i]));
for (let i = 0; i < indices.length; i++) if (indices[i] !== checkIndices[i]) indexMismatches++;
for (let i = 0; i < uvs.length; i++) if (uvs[i] !== checkUvs[i]) uvMismatches++;
let maxCheckWeightSumError = 0;
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  let sum = 0, nonzero = 0;
  for (let slot = 0; slot < 4; slot++) {
    const joint = checkJoints[vertex * 4 + slot], weight = checkWeights[vertex * 4 + slot];
    if (!Number.isInteger(joint) || joint < 0 || joint >= 54 || !Number.isFinite(weight) || weight < 0) throw new Error(`Invalid weight at vertex ${vertex}.`);
    sum += weight; if (weight > 1e-6) nonzero++;
  }
  maxCheckWeightSumError = Math.max(maxCheckWeightSumError, Math.abs(sum - 1));
}
const animNames = checkRoot.listAnimations().map((animation) => animation.getName());
for (const animation of checkRoot.listAnimations()) for (const channel of animation.listChannels()) {
  if (!checkSkin.listJoints().includes(channel.getTargetNode())) throw new Error(`Animation ${animation.getName()} targets a non-joint.`);
}
if (maxGeometryDelta !== 0 || indexMismatches || uvMismatches || maxCheckWeightSumError > 1e-5 || verticesWithDistributedWeights < positions.length / 3 * .75 || animNames.join(',') !== 'Idle,Walk,Run,Attack,Hit,Death' || textureOutMeta.width > 2048 || textureOutMeta.height > 2048) {
  throw new Error('Candidate validation failed for geometry, texture budget, weights, or clips.');
}
const weightMassByJoint = Object.fromEntries(joints.map((joint, i) => [joint.getName(), +influenceMass[i].toFixed(3)]).filter(([, mass]) => mass > 0));
const catalog = {
  schema: 'corealm-creature-native-rig-candidate/1', id: 'creature_boss_cinderwake', displayName: 'Emberbank Brute', status: 'awaiting-root-lab-review', accepted: false,
  source: { file: sourcePath, archive: archivePath, sha256: sourceSha256, bytes: sourceBytes.length, provenance: { sourceImageId: 'ec644492-32d4-4cac-914f-079adef1e98d', modelId: '2b3179ac-d360-4e46-83fb-69681850ab0c', reviewStatus: 'approved' }, geometry: { vertices: positions.length / 3, triangles: indices.length / 3, bounds: sourceBounds, positionsPreserved: true, indicesPreserved: true, uvPreserved: true, retopology: false }, originalRig: { joints: 54, animations: 0, weightMass: '99.9769% Hips', finding: 'All joint nodes were collapsed at origin; reconstructed bind-pose transforms from the source inverse-bind matrices.' }, textures: textureStats },
  candidate: { file: candidatePath, sha256: candidateSha256, bytes: outputBytes.length, geometry: { maxPositionDelta: maxGeometryDelta, indexMismatches, uvMismatches }, rig: { joints: 54, influencesPerVertex: 4, verticesWithDistributedWeights, maxWeightSumError: maxCheckWeightSumError, method: 'Recovered the source bind pose from inverse-bind matrices; rebuilt four normalized anatomical influences using spatially gated distances to Mixamo bone segments.', weightMassByJoint }, textures: [{ name: texture.getName(), width: textureOutMeta.width, height: textureOutMeta.height, mapType: 'baseColor', sha256: textureOutSha }], animations: clips },
  acceptance: { sourceDesignAudit: true, geometry: true, rig: false, animation: false, textures: false, labAccepted: false, worldIntegrated: false },
  hold: { runtimeAnimation: 'held pending root animation acceptance', runtimeFace: 'not established by source review', productionPromotionAllowed: false, sourceTextureContainsOnly: ['baseColor'] },
};
await writeFile(`${baseDir}/catalog.json`, JSON.stringify(catalog, null, 2) + '\n');
await writeFile(`${baseDir}/validation.json`, JSON.stringify({ sourceSha256, candidateSha256, maxGeometryDelta, indexMismatches, uvMismatches, vertices: positions.length / 3, triangles: indices.length / 3, joints: checkSkin.listJoints().length, animations: animNames, verticesWithDistributedWeights, maxWeightSumError: maxCheckWeightSumError, texture: { width: textureOutMeta.width, height: textureOutMeta.height, mapType: 'baseColor', sourcePixelContentRetainedViaDownsample: true }, sourceArchiveExact: createHash('sha256').update(await readFile(archivePath)).digest('hex') === expectedSourceHash }, null, 2) + '\n');
console.log(JSON.stringify({ candidatePath, candidateSha256, vertices: positions.length / 3, triangles: indices.length / 3, clips: animNames, texture: [textureOutMeta.width, textureOutMeta.height], maxWeightSumError: maxCheckWeightSumError, massAtHips: weightMassByJoint['mixamorig:Hips'] }, null, 2));
