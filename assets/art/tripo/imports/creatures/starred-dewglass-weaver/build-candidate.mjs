import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import * as THREE from 'three';

const ownerDir = 'assets/art/tripo/imports/creatures/starred-dewglass-weaver';
const sourceFile = 'assets/art/tripo/exports/corealm_dewglass_weaver_3ead9c24_8k_rigged.glb';
const outputFile = `${ownerDir}/dewglass-weaver-native-rig-candidate.glb`;
const expected = {
  sha256: '93c742635c17f766e50c3e5f38ab8c3f303ea820cadc9197ba0601618740de88',
  bytes: 27182612,
  sourceImageId: 'fd6a89d9-bc1a-4b39-9b3c-197179f4e281',
  sourceImageSha256: '290b413c7efd877bc804b08ffc35c8446d4a705ef3595c48b700673fc844e601',
  modelId: '3ead9c24-4f01-468d-9742-6995dc817118',
  vertices: 3555,
  triangles: 5460,
};
const fairyBatch = JSON.parse(await readFile('assets/art/tripo/batches/creatures-fairy.json', 'utf8'));
const batchRecord = fairyBatch.assets?.find(asset => asset.key === 'dewglass-weaver');
if (!batchRecord || batchRecord.modelId !== expected.modelId || batchRecord.sourceImageId !== expected.sourceImageId || batchRecord.sourceImageSha256 !== expected.sourceImageSha256 || batchRecord.review?.verdict !== 'approved' || batchRecord.facialAuditStatus !== 'approved' || batchRecord.modelStartedAfterApproval !== true || batchRecord.downloadReadyStarred !== true) {
  throw new Error('The approved, facially audited, starred image/model record is missing or has changed.');
}
const approvedImageBytes = await readFile(batchRecord.sourceImagePath);
const approvedImageSha256 = createHash('sha256').update(approvedImageBytes).digest('hex');
if (approvedImageSha256 !== expected.sourceImageSha256) throw new Error('Dewglass Weaver source image no longer matches its approved SHA-256.');
const sourceBytes = await readFile(sourceFile);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
if (sourceBytes.length !== expected.bytes || sourceSha256 !== expected.sha256) throw new Error('Dewglass Weaver source export does not match the recorded Tripo export.');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(sourceFile);
const root = doc.getRoot();
const sourceMesh = root.listMeshes()[0];
const primitive = sourceMesh?.listPrimitives()[0];
const meshNode = root.listNodes().find(node => node.getMesh() === sourceMesh);
if (!primitive || !meshNode) throw new Error('Expected the single source mesh primitive and node.');
const sourceSkin = meshNode.getSkin();
if (!sourceSkin || sourceSkin.listJoints().length !== 18) throw new Error('Expected the known broken 18-joint Tripo source rig.');
const sourceJointCount = sourceSkin.listJoints().length;
const sourceJointNodes = sourceSkin.listJoints();
if (root.listAnimations().length !== 0) throw new Error('Unexpected source animation drift; stop and review before replacing the skin.');
const positions = primitive.getAttribute('POSITION')?.getArray();
const sourceIndices = primitive.getIndices()?.getArray();
const sourceUv = primitive.getAttribute('TEXCOORD_0')?.getArray();
if (!(positions instanceof Float32Array) || !sourceIndices || !sourceUv) throw new Error('Expected float positions, indexed topology, and source UVs.');
const vertexCount = positions.length / 3;
const triangleCount = sourceIndices.length / 3;
if (vertexCount !== expected.vertices || triangleCount !== expected.triangles) throw new Error(`Source topology drifted: ${vertexCount} vertices / ${triangleCount} triangles.`);
const sourcePositionCopy = new Float32Array(positions);
const sourceIndexCopy = new Uint32Array(sourceIndices);
const sourceUvCopy = new Float32Array(sourceUv);
const originalJointIndices = primitive.getAttribute('JOINTS_0')?.getArray();
const originalJointWeights = primitive.getAttribute('WEIGHTS_0')?.getArray();
if (!originalJointIndices || !originalJointWeights) throw new Error('Source export is missing its unusable skin attributes.');
let sourceWeightMass = 0, sourceRootWeightMass = 0;
const sourceInfluentialJoints = new Set();
for (let vertex = 0; vertex < vertexCount; vertex++) for (let slot = 0; slot < 4; slot++) {
  const offset = vertex * 4 + slot;
  const weight = originalJointWeights[offset];
  if (weight > 1e-6) {
    sourceWeightMass += weight;
    sourceInfluentialJoints.add(originalJointIndices[offset]);
    if (originalJointIndices[offset] === 0) sourceRootWeightMass += weight;
  }
}
const sourceRootWeightFraction = sourceRootWeightMass / sourceWeightMass;
const sourceRestTransformsIdentity = sourceJointNodes.every(node => node.getTranslation().every(value => Math.abs(value) < 1e-9) && node.getRotation().every((value, axis) => Math.abs(value - (axis === 3 ? 1 : 0)) < 1e-9) && node.getScale().every(value => Math.abs(value - 1) < 1e-9));
if (sourceRootWeightFraction < 0.9999 || !sourceRestTransformsIdentity) throw new Error(`Source skin no longer matches its recorded root-dominated, identity-rest failure (root fraction ${sourceRootWeightFraction}, weighted joints ${[...sourceInfluentialJoints]}, identity rest ${sourceRestTransformsIdentity}); stop for a fresh review.`);
const sourceMaterial = primitive.getMaterial();
const baseTexture = sourceMaterial?.getBaseColorTexture();
const packedTexture = sourceMaterial?.getMetallicRoughnessTexture();
const normalTexture = sourceMaterial?.getNormalTexture();
if (!baseTexture || !packedTexture || !normalTexture) throw new Error('The approved Tripo export must retain base-color, packed metallic-roughness, and normal maps.');
const getTextureRecord = async texture => {
  const image = texture.getImage();
  const meta = await sharp(image).metadata();
  return { name: texture.getName(), mime: texture.getMimeType(), width: meta.width, height: meta.height, bytes: image.length, sha256: createHash('sha256').update(image).digest('hex') };
};
const sourceTextureRecords = await Promise.all([baseTexture, packedTexture, normalTexture].map(getTextureRecord));
if (sourceTextureRecords[0].width !== 8192 || sourceTextureRecords[0].height !== 8192 || sourceTextureRecords.slice(1).some(map => map.width !== 4096 || map.height !== 4096)) {
  throw new Error('Source texture dimensions drifted from the approved 8K base color and 4K PBR maps.');
}

// The approved source image and orthographic mesh inspection establish Y-up, +X-forward,
// with three bilateral leg pairs distributed along the body axis.
const bones = [
  { name: 'WeaverRoot', parent: null, p: [0, 0.42, 0], group: 'root' },
  { name: 'Thorax', parent: 'WeaverRoot', p: [0.02, 0.49, 0], group: 'body', from: [0.02, 0.43, 0], sigma: 0.19 },
  { name: 'Abdomen', parent: 'Thorax', p: [-0.13, 0.72, 0], group: 'body', from: [0.02, 0.49, 0], sigma: 0.22 },
  { name: 'Head', parent: 'Thorax', p: [0.31, 0.70, 0], group: 'body', from: [0.02, 0.49, 0], sigma: 0.14 },
  { name: 'PalpNear', parent: 'Head', p: [0.37, 0.60, -0.045], group: 'palpNear', from: [0.31, 0.70, 0], sigma: 0.055 },
  { name: 'PalpNearTip', parent: 'PalpNear', p: [0.43, 0.53, -0.082], group: 'palpNear', from: [0.37, 0.60, -0.045], sigma: 0.040 },
  { name: 'PalpFar', parent: 'Head', p: [0.37, 0.60, 0.045], group: 'palpFar', from: [0.31, 0.70, 0], sigma: 0.055 },
  { name: 'PalpFarTip', parent: 'PalpFar', p: [0.43, 0.53, 0.082], group: 'palpFar', from: [0.37, 0.60, 0.045], sigma: 0.040 },
];
const legDefinitions = [
  { pair: 'Front', x: 0.17, kneeX: 0.22, ankleX: 0.30, footX: 0.33 },
  { pair: 'Middle', x: -0.02, kneeX: -0.01, ankleX: -0.055, footX: -0.06 },
  { pair: 'Rear', x: -0.21, kneeX: -0.26, ankleX: -0.31, footX: -0.34 },
];
const legs = [];
for (const definition of legDefinitions) for (const side of [{ name: 'Near', sign: -1 }, { name: 'Far', sign: 1 }]) {
  const prefix = `${definition.pair}${side.name}`;
  const hip = [definition.x, 0.48, side.sign * 0.115];
  const knee = [definition.kneeX, definition.pair === 'Middle' ? 0.27 : 0.30, side.sign * 0.245];
  const ankle = [definition.ankleX, definition.pair === 'Middle' ? 0.095 : 0.105, side.sign * (definition.pair === 'Middle' ? 0.365 : 0.335)];
  const toe = [definition.footX, 0.018, side.sign * (definition.pair === 'Middle' ? 0.395 : 0.365)];
  const gate = { anchorX: definition.x, side: side.sign, label: `${definition.pair}${side.name}` };
  const upper = `${prefix}Hip`, lower = `${prefix}Knee`, terminal = `${prefix}Ankle`;
  bones.push({ name: upper, parent: 'Thorax', p: hip, group: `leg:${gate.label}`, from: hip, to: knee, sigma: 0.078, gate });
  bones.push({ name: lower, parent: upper, p: knee, group: `leg:${gate.label}`, from: knee, to: ankle, sigma: 0.071, gate });
  bones.push({ name: terminal, parent: lower, p: ankle, group: `leg:${gate.label}`, from: ankle, to: toe, sigma: 0.057, gate });
  legs.push({ prefix, pair: definition.pair, side: side.name, sign: side.sign, x: definition.x, upper, lower, terminal });
}
const boneIndex = new Map(bones.map((bone, index) => [bone.name, index]));
for (const bone of bones) {
  const parent = bone.parent ? bones[boneIndex.get(bone.parent)] : null;
  bone.local = parent ? bone.p.map((component, axis) => component - parent.p[axis]) : bone.p;
}
const sourceRigContainer = meshNode.getParentNode();
if (!sourceRigContainer) throw new Error('Source mesh node is missing its armature container.');
primitive.setAttribute('JOINTS_0', null);
primitive.setAttribute('WEIGHTS_0', null);
meshNode.setSkin(null);
for (const child of sourceRigContainer.listChildren()) if (child !== meshNode) sourceRigContainer.removeChild(child);
sourceSkin.dispose();
sourceMesh.setName('DewglassWeaverMesh');
meshNode.setName('DewglassWeaverMeshNode');
sourceRigContainer.setName('DewglassWeaverRig').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
sourceRigContainer.addChild(meshNode);
const nodes = new Map();
for (const bone of bones) {
  const node = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  nodes.set(bone.name, node);
  const parent = bone.parent ? nodes.get(bone.parent) : sourceRigContainer;
  parent.addChild(node);
}
const skin = doc.createSkin('DewglassWeaver_Hexapod').setSkeleton(nodes.get('WeaverRoot'));
for (const bone of bones) skin.addJoint(nodes.get(bone.name));
const inverseBind = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i++) {
  const [x, y, z] = bones[i].p;
  inverseBind.set([1,0,0,0, 0,1,0,0, 0,0,1,0, -x,-y,-z,1], i * 16);
}
const buffer = root.listBuffers()[0];
skin.setInverseBindMatrices(doc.createAccessor('DewglassWeaver_InverseBindMatrices').setArray(inverseBind).setType(Accessor.Type.MAT4).setBuffer(buffer));
meshNode.setSkin(skin);

const distancePointToSegment = (point, from, to) => {
  const v = to.map((value, axis) => value - from[axis]);
  const w = point.map((value, axis) => value - from[axis]);
  const lengthSquared = v.reduce((sum, value) => sum + value * value, 0);
  const t = lengthSquared ? Math.max(0, Math.min(1, w.reduce((sum, value, axis) => sum + value * v[axis], 0) / lengthSquared)) : 0;
  return Math.hypot(...point.map((value, axis) => value - (from[axis] + t * v[axis])));
};
const smooth01 = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const jointValues = new Uint16Array(vertexCount * 4);
const weightValues = new Float32Array(vertexCount * 4);
const influenceVertexCounts = new Uint32Array(bones.length);
let verticesWithMultipleInfluences = 0;
let maxWeightSumError = 0;
let minimumNonzeroWeight = 1;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const [x, y, z] = point;
  const candidates = [];
  for (let index = 1; index < bones.length; index++) {
    const bone = bones[index];
    let score = 0;
    if (bone.group === 'body') {
      const sigma = bone.sigma;
      const d = distancePointToSegment(point, bone.from, bone.p);
      const longitudinalGate = bone.name === 'Head' ? smooth01((x + 0.02) / 0.20) : bone.name === 'Abdomen' ? smooth01((0.31 - x) / 0.25) : 1;
      score = Math.exp(-0.5 * (d / sigma) ** 2) * longitudinalGate;
    } else if (bone.group.startsWith('leg:')) {
      const { anchorX, side } = bone.gate;
      const alongBody = Math.exp(-0.5 * ((x - anchorX) / 0.145) ** 2);
      const bodyHeight = smooth01((0.70 - y) / 0.24);
      const lateralSide = smooth01((side * z + 0.035) / 0.19);
      const d = distancePointToSegment(point, bone.from, bone.to);
      score = Math.exp(-0.5 * (d / bone.sigma) ** 2) * alongBody * bodyHeight * lateralSide;
    } else {
      const side = bone.group === 'palpFar' ? 1 : -1;
      const headRegion = smooth01((x - 0.22) / 0.16) * smooth01((0.74 - y) / 0.22);
      const lateralSide = smooth01((side * z + 0.015) / 0.06);
      const d = distancePointToSegment(point, bone.from, bone.p);
      score = Math.exp(-0.5 * (d / bone.sigma) ** 2) * headRegion * lateralSide;
    }
    if (score > 1e-12) candidates.push({ index, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 4);
  if (!chosen.length) {
    const fallback = ['Thorax', 'Abdomen', 'Head'].map(name => boneIndex.get(name)).map(index => ({ index, score: Math.exp(-0.5 * (distancePointToSegment(point, bones[index].from, bones[index].p) / 0.30) ** 2) })).sort((a, b) => b.score - a.score)[0];
    chosen.push(fallback);
  }
  const total = chosen.reduce((sum, item) => sum + item.score, 0);
  let assigned = 0;
  for (let slot = 0; slot < chosen.length; slot++) {
    const item = chosen[slot];
    const weight = slot === chosen.length - 1 ? 1 - assigned : item.score / total;
    jointValues[vertex * 4 + slot] = item.index;
    weightValues[vertex * 4 + slot] = weight;
    assigned += weight;
    if (weight > 1e-6) influenceVertexCounts[item.index]++;
    minimumNonzeroWeight = Math.min(minimumNonzeroWeight, weight);
  }
  if (chosen.filter(item => item.score / total > 1e-6).length >= 2) verticesWithMultipleInfluences++;
  const sum = weightValues[vertex * 4] + weightValues[vertex * 4 + 1] + weightValues[vertex * 4 + 2] + weightValues[vertex * 4 + 3];
  maxWeightSumError = Math.max(maxWeightSumError, Math.abs(sum - 1));
}
primitive.setAttribute('JOINTS_0', doc.createAccessor('DewglassWeaver_Joints0').setArray(jointValues).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('DewglassWeaver_Weights0').setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(buffer));

const quatFromEuler = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ')).normalize().toArray();
const identity = [0, 0, 0, 1];
const samples = [0, 0.25, 0.5, 0.75, 1];
const clips = [];
function createClip(name, duration, normalizedTimes, tracks) {
  const animation = doc.createAnimation(name);
  const trackMap = [];
  for (const track of tracks) {
    const path = track.path ?? 'rotation';
    const type = path === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4;
    const values = track.values;
    const times = normalizedTimes.map(value => value * duration);
    const input = doc.createAccessor(`${name}_${track.node}_${path}_time`).setArray(new Float32Array(times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const output = doc.createAccessor(`${name}_${track.node}_${path}_value`).setArray(new Float32Array(values.flat())).setType(type).setBuffer(buffer);
    const sampler = doc.createAnimationSampler(`${name}_${track.node}_${path}_sampler`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    const channel = doc.createAnimationChannel(`${track.node}_${path}`).setTargetNode(nodes.get(track.node)).setTargetPath(path).setSampler(sampler);
    animation.addSampler(sampler).addChannel(channel);
    trackMap.push({ node: track.node, path, times, values });
  }
  clips.push({ name, duration, animation, trackMap });
}
const rotations = (angles) => angles.map(([x, y, z]) => quatFromEuler(x, y, z));
const translations = (values) => values.map(value => [...value]);
const baseRoot = bones[0].local;
const tripodPhase = leg => ((leg.pair === 'Front' && leg.side === 'Near') || (leg.pair === 'Middle' && leg.side === 'Far') || (leg.pair === 'Rear' && leg.side === 'Near')) ? 0 : Math.PI;
function gaitTracks(duration, amplitude, frequencyScale = 1) {
  const tracks = [];
  for (const leg of legs) {
    const phase = tripodPhase(leg);
    const sideBias = leg.sign;
    const hipAngles = [], kneeAngles = [], ankleAngles = [];
    for (const s of samples) {
      const theta = s * Math.PI * 2 * frequencyScale + phase;
      const swing = Math.sin(theta);
      const lift = Math.max(0, swing);
      const foreScale = leg.pair === 'Middle' ? 0.82 : 1;
      const hipPitch = Math.cos(theta) * amplitude * 0.48 * foreScale;
      const hipRoll = sideBias * (0.045 + lift * amplitude * 0.16);
      const kneeFlex = lift * amplitude * 0.70 + 0.035;
      const ankleFlex = -hipPitch * 0.35 - kneeFlex * 0.50;
      hipAngles.push([hipRoll, 0, hipPitch]);
      kneeAngles.push([sideBias * lift * amplitude * 0.10, 0, kneeFlex]);
      ankleAngles.push([-sideBias * lift * amplitude * 0.08, 0, ankleFlex]);
    }
    tracks.push({ node: leg.upper, values: rotations(hipAngles) }, { node: leg.lower, values: rotations(kneeAngles) }, { node: leg.terminal, values: rotations(ankleAngles) });
  }
  return tracks;
}
createClip('Idle', 3.0, samples, [
  { node: 'Thorax', values: rotations([[0,0,0],[0.008,0,0.012],[0,0,0],[ -0.008,0,-0.012],[0,0,0]]) },
  { node: 'Abdomen', values: rotations([[0,0,0],[0.010,0,0.006],[0,0,0],[-0.010,0,-0.006],[0,0,0]]) },
  { node: 'Head', values: rotations([[0,0,0],[0,0.012,-0.010],[0,0,0],[0,-0.012,0.010],[0,0,0]]) },
  { node: 'PalpNearTip', values: rotations([[0,0,0],[0.018,0.02,-0.015],[0,0,0],[-0.018,-0.02,0.015],[0,0,0]]) },
  { node: 'PalpFarTip', values: rotations([[0,0,0],[-0.018,-0.02,0.015],[0,0,0],[0.018,0.02,-0.015],[0,0,0]]) },
  ...legs.map((leg, index) => ({ node: leg.upper, values: rotations(samples.map((_, i) => [leg.sign * 0.018, 0, Math.sin((i / 4) * Math.PI * 2 + index) * 0.014]) )})),
]);
createClip('Walk', 1.10, samples, [
  ...gaitTracks(1.10, 0.78),
  { node: 'Thorax', values: rotations([[0,0,0.012],[0,0,-0.012],[0,0,0.012],[0,0,-0.012],[0,0,0.012]]) },
  { node: 'Abdomen', values: rotations([[0,0,-0.02],[0,0,0.02],[0,0,-0.02],[0,0,0.02],[0,0,-0.02]]) },
  { node: 'PalpNearTip', values: rotations([[0,0,0],[0.035,0.02,-0.02],[0,0,0],[-0.035,-0.02,0.02],[0,0,0]]) },
  { node: 'PalpFarTip', values: rotations([[0,0,0],[-0.035,-0.02,0.02],[0,0,0],[0.035,0.02,-0.02],[0,0,0]]) },
]);
createClip('Run', 0.74, samples, [
  ...gaitTracks(0.74, 1.08),
  { node: 'Thorax', values: rotations([[0,0,0.025],[0,0,-0.025],[0,0,0.025],[0,0,-0.025],[0,0,0.025]]) },
  { node: 'Abdomen', values: rotations([[0,0,-0.05],[0,0,0.05],[0,0,-0.05],[0,0,0.05],[0,0,-0.05]]) },
  { node: 'Head', values: rotations([[0,0,0],[0,0.018,-0.02],[0,0,0],[0,-0.018,0.02],[0,0,0]]) },
]);
createClip('Attack', 0.82, samples, [
  { node: 'WeaverRoot', path: 'translation', values: translations(samples.map(s => [baseRoot[0] + (s === 0.5 ? 0.055 : s === 0.25 ? 0.025 : 0), baseRoot[1] + (s === 0.25 ? 0.015 : 0), baseRoot[2]])) },
  { node: 'Thorax', values: rotations([[0,0,0],[0.04,0,0.07],[-0.01,0,-0.12],[0,0,0.06],[0,0,0]]) },
  { node: 'Head', values: rotations([[0,0,0],[0,0,-0.16],[0,0,-0.34],[0,0,-0.10],[0,0,0]]) },
  { node: 'Abdomen', values: rotations([[0,0,0],[0,0,0.09],[0,0,0.15],[0,0,0.04],[0,0,0]]) },
  ...legs.filter(leg => leg.pair === 'Front').flatMap(leg => [
    { node: leg.upper, values: rotations([[leg.sign*0.04,0,0],[leg.sign*0.14,0,0.28],[leg.sign*0.12,0,-0.30],[leg.sign*0.02,0,-0.12],[0,0,0]]) },
    { node: leg.lower, values: rotations([[0,0,0],[leg.sign*0.05,0,0.18],[leg.sign*0.04,0,0.42],[0,0,0.14],[0,0,0]]) },
  ]),
  { node: 'PalpNearTip', values: rotations([[0,0,0],[0.08,0.02,-0.05],[0.15,0.04,-0.08],[0.05,0,0],[0,0,0]]) },
  { node: 'PalpFarTip', values: rotations([[0,0,0],[-0.08,-0.02,0.05],[-0.15,-0.04,0.08],[-0.05,0,0],[0,0,0]]) },
]);
createClip('Hit', 0.42, samples, [
  { node: 'WeaverRoot', path: 'translation', values: translations(samples.map((_,i) => [baseRoot[0] + [0,-0.075,-0.025,0,0][i], baseRoot[1] + [0,-0.015,0.008,0,0][i], baseRoot[2]])) },
  { node: 'WeaverRoot', values: rotations([[0,0,0],[0.10,0,0.12],[0.025,0,-0.05],[0,0,0.02],[0,0,0]]) },
  { node: 'Head', values: rotations([[0,0,0],[0.08,0,-0.20],[0.02,0,0.10],[0,0,-0.02],[0,0,0]]) },
  { node: 'Abdomen', values: rotations([[0,0,0],[-0.08,0,0.06],[0.02,0,-0.02],[0,0,0],[0,0,0]]) },
  ...legs.map(leg => ({ node: leg.upper, values: rotations([[leg.sign*0.03,0,0],[leg.sign*0.16,0,-0.18],[leg.sign*0.08,0,0.12],[leg.sign*0.02,0,0],[leg.sign*0.02,0,0]]) })),
  { node: 'PalpNearTip', values: rotations([[0,0,0],[0.12,-0.08,0.10],[0,0.04,-0.04],[0,0,0],[0,0,0]]) },
  { node: 'PalpFarTip', values: rotations([[0,0,0],[-0.12,0.08,-0.10],[0,-0.04,0.04],[0,0,0],[0,0,0]]) },
]);
createClip('Death', 1.55, samples, [
  { node: 'WeaverRoot', path: 'translation', values: translations(samples.map((_,i) => [[baseRoot[0],baseRoot[0],baseRoot[0]+0.01,baseRoot[0]+0.01,baseRoot[0]+0.01][i], [baseRoot[1],baseRoot[1]-0.035,baseRoot[1]-0.095,baseRoot[1]-0.12,baseRoot[1]-0.12][i], baseRoot[2]])) },
  { node: 'WeaverRoot', values: rotations([[0,0,0],[0.20,0,-0.18],[0.45,0,-0.32],[0.60,0,-0.38],[0.60,0,-0.38]]) },
  { node: 'Head', values: rotations([[0,0,0],[0.10,0,-0.10],[0.24,0,-0.20],[0.28,0,-0.22],[0.28,0,-0.22]]) },
  { node: 'Abdomen', values: rotations([[0,0,0],[-0.08,0,0.05],[-0.18,0,0.10],[-0.20,0,0.12],[-0.20,0,0.12]]) },
  ...legs.flatMap(leg => {
    const phase = leg.sign * (leg.pair === 'Middle' ? -1 : 1);
    return [
      { node: leg.upper, values: rotations([[0,0,0],[leg.sign*0.08,0,phase*0.12],[leg.sign*0.24,0,phase*0.30],[leg.sign*0.28,0,phase*0.34],[leg.sign*0.28,0,phase*0.34]]) },
      { node: leg.lower, values: rotations([[0,0,0],[leg.sign*0.05,0,-phase*0.15],[leg.sign*0.14,0,-phase*0.40],[leg.sign*0.15,0,-phase*0.42],[leg.sign*0.15,0,-phase*0.42]]) },
      { node: leg.terminal, values: rotations([[0,0,0],[0,0,phase*0.08],[0,0,phase*0.20],[0,0,phase*0.20],[0,0,phase*0.20]]) },
    ];
  }),
  { node: 'PalpNearTip', values: rotations([[0,0,0],[0.05,0,0.05],[0.10,0,-0.08],[0.10,0,-0.08],[0.10,0,-0.08]]) },
  { node: 'PalpFarTip', values: rotations([[0,0,0],[-0.05,0,-0.05],[-0.10,0,0.08],[-0.10,0,0.08],[-0.10,0,0.08]]) },
]);

// Creature PBR maps are 2K runtime. Color uses Lanczos; packed linear data uses box averaging;
// normals are averaged as vectors and renormalized after reduction.
async function resizeDataMap(encoded, renormalizeNormal) {
  const { data, info } = await sharp(encoded).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== 4096 || info.height !== 4096 || info.channels !== 3) throw new Error(`Expected a 4096x4096 RGB PBR map, got ${info.width}x${info.height}x${info.channels}.`);
  const reduced = Buffer.alloc(2048 * 2048 * 3);
  for (let y = 0; y < 2048; y++) for (let x = 0; x < 2048; x++) {
    const out = (y * 2048 + x) * 3;
    const a = ((y * 2) * 4096 + x * 2) * 3;
    const b = a + 3;
    const c = a + 4096 * 3;
    const d = c + 3;
    reduced[out] = Math.round((data[a] + data[b] + data[c] + data[d]) / 4);
    reduced[out + 1] = Math.round((data[a + 1] + data[b + 1] + data[c + 1] + data[d + 1]) / 4);
    reduced[out + 2] = Math.round((data[a + 2] + data[b + 2] + data[c + 2] + data[d + 2]) / 4);
  }
  const output = reduced;
  if (renormalizeNormal) for (let offset = 0; offset < output.length; offset += 3) {
    let x = output[offset] / 127.5 - 1, y = output[offset + 1] / 127.5 - 1, z = output[offset + 2] / 127.5 - 1;
    const length = Math.hypot(x, y, z) || 1; x /= length; y /= length; z /= length;
    output[offset] = Math.round((x + 1) * 127.5); output[offset + 1] = Math.round((y + 1) * 127.5); output[offset + 2] = Math.round((z + 1) * 127.5);
  }
  return output;
}
const runtimeMaps = [];
for (const texture of [baseTexture, packedTexture, normalTexture]) {
  const encoded = texture.getImage();
  const original = await sharp(encoded).metadata();
  if (texture === baseTexture) {
    texture.setImage(await sharp(encoded).resize({ width: 2048, height: 2048, kernel: 'lanczos3' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer());
  } else {
    const normal = texture === normalTexture;
    const reduced = await resizeDataMap(encoded, normal);
    const resizedEncoded = await sharp(reduced, { raw: { width: 2048, height: 2048, channels: 3 } })[normal ? 'jpeg' : 'png'](normal ? { quality: 96, chromaSubsampling: '4:4:4' } : {}).toBuffer();
    texture.setImage(resizedEncoded);
  }
  if (texture === baseTexture) texture.setName('dewglass_weaver_basecolor_2k.jpg');
  else if (texture === packedTexture) texture.setName('dewglass_weaver_metallic_roughness_2k.png');
  else if (texture === normalTexture) texture.setName('dewglass_weaver_normal_2k.jpg');
  const runtime = await sharp(texture.getImage()).metadata();
  if (runtime.width !== 2048 || runtime.height !== 2048) throw new Error(`Texture ${texture.getName()} did not reach the 2K runtime target.`);
  runtimeMaps.push({ name: texture.getName(), role: texture === baseTexture ? 'base-color-lanczos' : texture === packedTexture ? 'packed-metallic-roughness-box' : 'normal-box-renormalized', original: [original.width, original.height], runtime: [runtime.width, runtime.height], mime: texture.getMimeType(), bytes: texture.getImage().length, sha256: createHash('sha256').update(texture.getImage()).digest('hex') });
}
sourceMaterial.setMetallicFactor(1).setRoughnessFactor(1);

const outputBytes = await io.writeBinary(doc);
await writeFile(outputFile, outputBytes);
const outputSha256 = createHash('sha256').update(outputBytes).digest('hex');
const validation = await validateCandidate(outputFile);
const report = {
  schema: 'corealm-creature-native-rig-candidate/1',
  id: 'creature_dewglass_weaver',
  status: 'awaiting-root-lab-review',
  accepted: false,
  source: { file: '../../../exports/corealm_dewglass_weaver_3ead9c24_8k_rigged.glb', sha256: sourceSha256, bytes: sourceBytes.length, vertices: vertexCount, triangles: triangleCount, sourceImageId: expected.sourceImageId, sourceImageSha256: approvedImageSha256, sourceModelId: expected.modelId, generator: 'Tripo Smart Mesh P2', imageGenerator: 'Tripo GPT Image 2.5', starred: batchRecord.downloadReadyStarred, imagePrompt: batchRecord.prompt, promptSource: batchRecord.promptSource, approvedGeometryAndMapsPreserved: true, imageReview: batchRecord.review, facialAudit: batchRecord.facialAudit, sourceTextures: sourceTextureRecords, sourceRig: { joints: sourceJointCount, usableClips: 0, nonzeroWeightedSourceJoints: sourceInfluentialJoints.size, rootWeightFraction: sourceRootWeightFraction, identityRestTransforms: sourceRestTransformsIdentity }, existingTripoSkinDiscarded: true },
  candidate: { file: 'dewglass-weaver-native-rig-candidate.glb', sha256: outputSha256, bytes: outputBytes.length, vertices: vertexCount, triangles: triangleCount, joints: bones.map((bone, index) => ({ name: bone.name, index, parent: bone.parent, restPosition: bone.p })), maps: runtimeMaps, clips: clips.map(clip => ({ name: clip.name, seconds: clip.duration, channels: clip.trackMap.length })) },
  rig: { preset: 'custom six-legged arthropod', jointCount: bones.length, basis: 'Y-up, +X toward head, Z across left/right leg pairs; three bilateral pairs run head-to-abdomen', weightMethod: 'anatomy-specific spatial fields along six visible leg chains, abdomen, head and mouthpalps; four normalized influences per vertex; source root-only skin removed', bind: 'translation-only rest pivots fit to the source mesh silhouette; inverse binds computed from those authored rest positions' },
  runtimeMaterials: [{ name: sourceMaterial.getName(), metallicFactor: sourceMaterial.getMetallicFactor(), roughnessFactor: sourceMaterial.getRoughnessFactor(), maps: runtimeMaps.map(map => ({ name: map.name, role: map.role, dimensions: map.runtime })) }],
  validation,
};
await writeFile(`${ownerDir}/catalog.json`, `${JSON.stringify(report, null, 2)}\n`);
const labCatalog = {
  pack: { id: 'corealm-tripo-creatures', name: 'Corealm Tripo creature candidates', author: 'Corealm', source: 'Tripo Studio generated creatures and Corealm rig/material adaptation', license: 'LicenseRef-Corealm-Original' },
  assets: [{ id: 'creature_dewglass_weaver', file: outputFile.replace(`${ownerDir}/`, ''), pack: 'corealm-tripo-creatures', category: 'character', is: 'Dewglass Weaver custom six-leg candidate', tags: ['creature', 'arthropod', 'fairy', 'gloamgarden', 'tripo', 'candidate'], bytes: outputBytes.length, sha256: outputSha256, size: { x: validation.mesh.bounds[1][0] - validation.mesh.bounds[0][0], y: validation.mesh.bounds[1][1] - validation.mesh.bounds[0][1], z: validation.mesh.bounds[1][2] - validation.mesh.bounds[0][2] }, base: { x: validation.mesh.bounds[0][0], y: validation.mesh.bounds[0][1], z: validation.mesh.bounds[0][2] }, groundY: validation.mesh.bounds[0][1], triangles: triangleCount, vertices: vertexCount, animations: clips.map(clip => clip.name), materials: [sourceMaterial.getName()], sourceProvenance: { generator: 'Tripo Smart Mesh P2', modelId: expected.modelId, sourceImageId: expected.sourceImageId, sourceFile: sourceFile, sourceSha256, candidateFile: outputFile, candidateSha256: outputSha256, candidateStatus: 'awaiting-root-lab-review', imageApproved: true, geometryAndMapsPreserved: true, rigAuthoring: 'Custom six-leg spatially weighted native rig; original skin removed because all rest transforms were identity and more than 99.99% of source weight mass targeted bone_0.' }, candidateReview: { accepted: false, imageAudit: true, geometryAudit: false, textureAudit: false, rigAudit: false, labAccepted: false, worldIntegrated: false }, rig: { preset: 'custom six-legged arthropod', jointCount: bones.length, boneNames: bones.map(bone => bone.name), basis: 'Y-up, +X toward head, Z across leg pairs' }, animationMetadata: clips.map(clip => ({ name: clip.name, seconds: clip.duration, channels: clip.trackMap.length, targetPaths: [...new Set(clip.trackMap.map(track => track.path))] })) }],
  files: { creature_dewglass_weaver: outputFile.replace(`${ownerDir}/`, '') },
};
await writeFile(`${ownerDir}/lab-catalog.json`, `${JSON.stringify(labCatalog, null, 2)}\n`);
console.log(JSON.stringify({ candidate: outputFile, bytes: outputBytes.length, sha256: outputSha256, vertices: vertexCount, triangles: triangleCount, joints: bones.length, validation }, null, 2));

async function validateCandidate(file) {
  const checkDoc = await io.read(file);
  const r = checkDoc.getRoot();
  const p = r.listMeshes()[0].listPrimitives()[0];
  const pos = p.getAttribute('POSITION')?.getArray(), idx = p.getIndices()?.getArray(), uv = p.getAttribute('TEXCOORD_0')?.getArray();
  const jointData = p.getAttribute('JOINTS_0')?.getArray(), weightData = p.getAttribute('WEIGHTS_0')?.getArray();
  const checkSkin = r.listSkins()[0], animations = r.listAnimations();
  if (!pos || !idx || !uv || !jointData || !weightData || r.listSkins().length !== 1) throw new Error('Candidate is missing mesh, preserved UV, or new skin data.');
  if (idx.length / 3 !== triangleCount || pos.length / 3 !== vertexCount) throw new Error('Topology counts changed during processing.');
  let positionDelta = 0, indexMismatches = 0, uvDelta = 0, maxWeightSumError = 0, multipleInfluences = 0, maxJointIndex = 0;
  for (let i = 0; i < pos.length; i++) positionDelta = Math.max(positionDelta, Math.abs(pos[i] - sourcePositionCopy[i]));
  for (let i = 0; i < idx.length; i++) if (idx[i] !== sourceIndexCopy[i]) indexMismatches++;
  for (let i = 0; i < uv.length; i++) uvDelta = Math.max(uvDelta, Math.abs(uv[i] - sourceUvCopy[i]));
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    let sum = 0, active = 0;
    for (let slot = 0; slot < 4; slot++) {
      const offset = vertex * 4 + slot, joint = jointData[offset], weight = weightData[offset];
      if (!Number.isInteger(joint) || joint < 0 || joint >= bones.length || !Number.isFinite(weight) || weight < -1e-8 || weight > 1.00001) throw new Error(`Invalid skin influence at vertex ${vertex}.`);
      maxJointIndex = Math.max(maxJointIndex, joint);
      if (weight > 1e-6) { sum += weight; active++; }
    }
    if (Math.abs(sum - 1) > 1e-5) throw new Error(`Non-normalized skin weights at vertex ${vertex}: ${sum}`);
    if (active > 1) multipleInfluences++;
    maxWeightSumError = Math.max(maxWeightSumError, Math.abs(sum - 1));
  }
  if (positionDelta > 1e-7 || indexMismatches || uvDelta > 1e-7) throw new Error(`Geometry/UV changed (position ${positionDelta}, indices ${indexMismatches}, UV ${uvDelta}).`);
  if (multipleInfluences < vertexCount * 0.35) throw new Error('Spatial weighting lacks distributed blends across the source mesh.');
  const ibm = checkSkin.getInverseBindMatrices()?.getArray();
  if (!ibm || ibm.length !== bones.length * 16 || ibm.some(value => !Number.isFinite(value))) throw new Error('Inverse bind matrices are missing or invalid.');
  const animationNames = animations.map(animation => animation.getName());
  const required = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
  if (required.some(name => !animationNames.includes(name))) throw new Error(`Missing required clip(s): ${required.filter(name => !animationNames.includes(name)).join(', ')}`);
  for (const texture of r.listTextures()) {
    const meta = await sharp(texture.getImage()).metadata();
    if (meta.width !== 2048 || meta.height !== 2048) throw new Error(`Runtime texture is not 2K: ${texture.getName()} ${meta.width}x${meta.height}`);
  }
  const bounds = [[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]];
  for (let i=0;i<pos.length;i+=3) for(let axis=0;axis<3;axis++){ bounds[0][axis]=Math.min(bounds[0][axis],pos[i+axis]);bounds[1][axis]=Math.max(bounds[1][axis],pos[i+axis]); }
  const nodeByName = new Map(r.listNodes().map(node => [node.getName(), node]));
  const candidateMeshNode = [...nodeByName.values()].find(node => node.getMesh() === r.listMeshes()[0]);
  if (!candidateMeshNode) throw new Error('Candidate mesh node disappeared after GLB export.');
  const inverseBindMatrices = checkSkin.listJoints().map((_, index) => new THREE.Matrix4().fromArray(Array.from(ibm.slice(index * 16, index * 16 + 16))));
  const getWorldMatrix = (node, cache, pose) => {
    if (cache.has(node)) return cache.get(node);
    const localPose = pose.get(node) ?? {};
    const translation = new THREE.Vector3(...(localPose.translation ?? node.getTranslation()));
    const rotation = new THREE.Quaternion(...(localPose.rotation ?? node.getRotation()));
    const scale = new THREE.Vector3(...(localPose.scale ?? node.getScale()));
    const local = new THREE.Matrix4().compose(translation, rotation, scale);
    const parent = node.getParentNode();
    const world = parent ? getWorldMatrix(parent, cache, pose).clone().multiply(local) : local;
    cache.set(node, world);
    return world;
  };
  const samplePose = (animation, time) => {
    const pose = new Map();
    if (animation) for (const channel of animation.listChannels()) {
      const sampler = channel.getSampler();
      const times = Array.from(sampler.getInput().getArray());
      const values = Array.from(sampler.getOutput().getArray());
      const width = channel.getTargetPath() === 'rotation' ? 4 : 3;
      let upper = times.findIndex(key => key >= time);
      if (upper < 0) upper = times.length - 1;
      const lower = Math.max(0, upper - (times[upper] === time ? 0 : 1));
      const start = values.slice(lower * width, (lower + 1) * width);
      const end = values.slice(upper * width, (upper + 1) * width);
      const alpha = upper === lower ? 0 : (time - times[lower]) / (times[upper] - times[lower]);
      let value;
      if (channel.getTargetPath() === 'rotation') {
        const a = new THREE.Quaternion(...start), b = new THREE.Quaternion(...end).normalize();
        a.slerp(b, alpha).normalize(); value = [a.x, a.y, a.z, a.w];
      } else value = start.map((component, axis) => component + (end[axis] - component) * alpha);
      const nodePose = pose.get(channel.getTargetNode()) ?? {};
      nodePose[channel.getTargetPath()] = value;
      pose.set(channel.getTargetNode(), nodePose);
    }
    const cache = new Map();
    const meshInverse = getWorldMatrix(candidateMeshNode, cache, pose).clone().invert();
    const jointMatrices = checkSkin.listJoints().map((joint, index) => meshInverse.clone().multiply(getWorldMatrix(joint, cache, pose)).multiply(inverseBindMatrices[index]));
    const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
    let maximumDisplacement = 0, displacedVertices = 0;
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const source = new THREE.Vector3(pos[vertex*3],pos[vertex*3+1],pos[vertex*3+2]);
      const result = new THREE.Vector3();
      for (let slot = 0; slot < 4; slot++) {
        const offset = vertex*4+slot, weight = weightData[offset];
        if (weight <= 0) continue;
        result.add(source.clone().applyMatrix4(jointMatrices[jointData[offset]]).multiplyScalar(weight));
      }
      if (![result.x,result.y,result.z].every(Number.isFinite)) throw new Error(`Non-finite animated vertex at ${animation?.getName() ?? 'Rest'}@${time}, vertex ${vertex}.`);
      const delta = result.distanceTo(source);
      maximumDisplacement = Math.max(maximumDisplacement, delta);
      if (delta > 1e-4) displacedVertices++;
      min[0]=Math.min(min[0],result.x);min[1]=Math.min(min[1],result.y);min[2]=Math.min(min[2],result.z);
      max[0]=Math.max(max[0],result.x);max[1]=Math.max(max[1],result.y);max[2]=Math.max(max[2],result.z);
    }
    return { min, max, maximumDisplacement, displacedVertices };
  };
  const restPose = samplePose(null, 0);
  const restBoundsError = Math.max(...restPose.min.map((value, axis) => Math.abs(value - bounds[0][axis])), ...restPose.max.map((value, axis) => Math.abs(value - bounds[1][axis])));
  if (restBoundsError > 1e-5) throw new Error(`Rest skin bounds differ from the source by ${restBoundsError}.`);
  const motionChecks = [];
  for (const animation of animations) {
    const duration = Math.max(...animation.listChannels().map(channel => channel.getSampler().getInput().getArray().at(-1)));
    const frames = Array.from({ length: 9 }, (_, index) => duration * index / 8);
    const poses = frames.map(time => samplePose(animation, time));
    const maximumDisplacement = Math.max(...poses.map(pose => pose.maximumDisplacement));
    const maximumVerticesMoved = Math.max(...poses.map(pose => pose.displacedVertices));
    const sweptBounds = { min: [0,1,2].map(axis => Math.min(...poses.map(pose => pose.min[axis]))), max: [0,1,2].map(axis => Math.max(...poses.map(pose => pose.max[axis]))) };
    const threshold = animation.getName() === 'Idle' ? 0.001 : 0.008;
    if (maximumDisplacement <= threshold || maximumVerticesMoved < 12) throw new Error(`${animation.getName()} has no meaningful skinned motion (${maximumDisplacement} / ${maximumVerticesMoved} vertices).`);
    if (sweptBounds.min[1] < -0.28 || sweptBounds.max[1] > 1.42 || Math.abs(sweptBounds.min[0]) > 0.78 || Math.abs(sweptBounds.max[0]) > 0.78 || Math.abs(sweptBounds.min[2]) > 0.78 || Math.abs(sweptBounds.max[2]) > 0.78) throw new Error(`${animation.getName()} exceeded the expected body bounds: ${JSON.stringify(sweptBounds)}.`);
    motionChecks.push({ name: animation.getName(), seconds: duration, sampleCount: frames.length, maximumVertexDisplacement: Number(maximumDisplacement.toFixed(5)), maximumVerticesMoved, sweptBounds });
  }
  return { mesh: { vertices: vertexCount, triangles: triangleCount, sourcePositionMaxDelta: positionDelta, indexMismatches, sourceUvMaxDelta: uvDelta, bounds }, skin: { joints: checkSkin.listJoints().length, maxJointIndex, verticesWithMultipleInfluences: multipleInfluences, maxWeightSumError, influenceVertexCounts: Array.from(influenceVertexCounts) }, inverseBind: { count: ibm.length / 16, finite: true, restBoundsError }, animation: { clips: animations.map(animation => ({ name: animation.getName(), channels: animation.listChannels().length, seconds: Math.max(...animation.listChannels().map(channel => channel.getSampler().getInput().getArray().at(-1))) })), sampledDeformation: motionChecks, allSixRequiredClips: true }, textures: r.listTextures().map(texture => ({ name: texture.getName(), mime: texture.getMimeType(), bytes: texture.getImage().length, dimensions: [2048, 2048] })) };
}

