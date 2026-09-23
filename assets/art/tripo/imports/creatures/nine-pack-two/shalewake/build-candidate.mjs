import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Accessor, NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../../../');
const sourcePath = path.join(repo, 'assets/art/tripo/exports/corealm_shalewake_da0d598a_8k_rigged.glb');
const referencePath = path.join(repo, 'assets/art/tripo/references/stone-shalewake.png');
const candidatePath = path.join(here, 'stone-shalewake-native-rig-candidate.glb');
const catalogPath = path.join(here, 'catalog.json');
const labCatalogPath = path.join(here, 'lab-catalog.json');
const provenancePath = path.join(here, 'provenance.json');
const id = 'creature_shale_elemental';
const sourceModelId = 'da0d598a-9330-4856-a88f-6341c1da299d';
const sourceImageId = '8a12eddb-3390-4475-9270-bc4efcacb8d3';
const expectedSourceSha = 'ab8111c81684fe47d41987fabca680c142779130b87cc84a5b022bc690c58dc1';
const expectedReferenceSha = '81dc3a08840683ed96d4d65a3b21682c60203dc14f257070aed5fe7a17f6b101';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

const sourceBytes = await readFile(sourcePath);
const sourceSha = hash(sourceBytes);
if (sourceSha !== expectedSourceSha) throw new Error(`Approved Shalewake export SHA changed: ${sourceSha}`);
const referenceSha = hash(await readFile(referencePath));
if (referenceSha !== expectedReferenceSha) throw new Error(`Approved Shalewake reference SHA changed: ${referenceSha}`);

const io = new NodeIO();
const doc = await io.read(sourcePath);
const root = doc.getRoot();
const scene = root.listScenes()[0];
if (!scene) throw new Error('Shalewake source has no scene');
if (root.listAnimations().length !== 0) throw new Error('Shalewake source unexpectedly contains animation clips');
if (root.listSkins().length !== 1 || root.listSkins()[0].listJoints().length !== 5) throw new Error('Unexpected Shalewake source skin');
const sourceArmature = scene.listChildren().find((node) => node.getName() === 'Armature');
const meshNode = sourceArmature?.listChildren().find((node) => node.getMesh());
const mesh = meshNode?.getMesh();
const primitive = mesh?.listPrimitives()[0];
if (!sourceArmature || !meshNode || !mesh || !primitive) throw new Error('Shalewake source mesh hierarchy was not found');

const positions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
const normals = Float32Array.from(primitive.getAttribute('NORMAL')?.getArray() ?? []);
const uv = Float32Array.from(primitive.getAttribute('TEXCOORD_0')?.getArray() ?? []);
const indices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
const sourceSkin = root.listSkins()[0];
const sourceJointIndices = primitive.getAttribute('JOINTS_0')?.getArray();
const sourceWeights = primitive.getAttribute('WEIGHTS_0')?.getArray();
const vertexCount = positions.length / 3;
const triangleCount = indices.length / 3;
if (vertexCount !== 3188 || triangleCount !== 5294 || !normals.length || !uv.length) throw new Error(`Unexpected approved Shalewake geometry: ${vertexCount} vertices, ${triangleCount} triangles`);
if (!sourceSkin || sourceSkin.listJoints()[0]?.getName() !== 'bone_0' || !sourceJointIndices || !sourceWeights || sourceWeights.length !== vertexCount * 4) throw new Error('Shalewake source skin attributes or bone_0 joint are missing');
let sourceWeightMass = 0, sourceBone0WeightMass = 0, sourceOtherWeightMass = 0;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  let vertexWeightSum = 0;
  for (let slot = 0; slot < 4; slot++) {
    const at = vertex * 4 + slot, joint = sourceJointIndices[at], weight = sourceWeights[at];
    if (!Number.isInteger(joint) || joint < 0 || joint >= sourceSkin.listJoints().length || !Number.isFinite(weight) || weight < 0) throw new Error(`Invalid original Shalewake influence at vertex ${vertex}`);
    vertexWeightSum += weight;
    if (joint === 0) sourceBone0WeightMass += weight; else sourceOtherWeightMass += weight;
  }
  if (Math.abs(vertexWeightSum - 1) > 1e-5) throw new Error(`Original Shalewake vertex ${vertex} has a weight sum of ${vertexWeightSum}`);
  sourceWeightMass += vertexWeightSum;
}
const sourceOtherWeightFraction = sourceOtherWeightMass / sourceWeightMass;
if (sourceOtherWeightFraction > 1e-6) throw new Error(`Original Shalewake skin is not root-weighted: other-bone weight fraction ${sourceOtherWeightFraction}`);
const sourceWeightAudit = { totalMass: sourceWeightMass, bone0Mass: sourceBone0WeightMass, otherJointMass: sourceOtherWeightMass, otherJointFraction: sourceOtherWeightFraction };
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
  bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
}

// The source's five-joint skin is an identity-rest Tripo export with every vertex
// assigned to bone_0. Preserve its approved low quadruped mesh, normals and UVs;
// replace only that unusable skin with articulated torso and four-limb chains.
const rig = [
  ['ShalewakeRoot', null, [0, 0, 0]],
  ['Pelvis', 'ShalewakeRoot', [0, .285, -.32]],
  ['Spine', 'Pelvis', [0, .333, -.12]],
  ['Chest', 'Spine', [0, .343, .16]],
  ['Neck', 'Chest', [0, .327, .34]],
  ['SensingCleft', 'Neck', [0, .291, .423]],
  ['Sense_L', 'SensingCleft', [-.061, .285, .439]],
  ['Sense_R', 'SensingCleft', [.061, .285, .439]],
  ['HindlegUpper_L', 'Pelvis', [-.128, .238, -.232]],
  ['HindlegLower_L', 'HindlegUpper_L', [-.158, .122, -.231]],
  ['Hindpaw_L', 'HindlegLower_L', [-.180, .043, -.231]],
  ['HindlegUpper_R', 'Pelvis', [.128, .238, -.232]],
  ['HindlegLower_R', 'HindlegUpper_R', [.158, .122, -.231]],
  ['Hindpaw_R', 'HindlegLower_R', [.180, .043, -.231]],
  ['ForelegUpper_L', 'Chest', [-.128, .238, .221]],
  ['ForelegLower_L', 'ForelegUpper_L', [-.158, .122, .221]],
  ['Forepaw_L', 'ForelegLower_L', [-.180, .043, .221]],
  ['ForelegUpper_R', 'Chest', [.128, .238, .221]],
  ['ForelegLower_R', 'ForelegUpper_R', [.158, .122, .221]],
  ['Forepaw_R', 'ForelegLower_R', [.180, .043, .221]],
];
const orderedNames = rig.map(([name]) => name);
const jointIndex = new Map(orderedNames.map((name, index) => [name, index]));
const byName = new Map(rig.map(([name, parent, global]) => [name, { name, parent, global }]));
const children = new Map(rig.map(([name]) => [name, []]));
for (const [name, parentName] of rig) if (parentName) {
  if (!children.has(parentName)) throw new Error(`Rig parent ${parentName} for ${name} is missing`);
  children.get(parentName).push(name);
}
const nodeByName = new Map();
const localByName = new Map();
const worldByName = new Map();
const rigContainer = doc.createNode('Shalewake_Articulated_Rig');
scene.removeChild(sourceArmature);
sourceArmature.removeChild(meshNode);
scene.addChild(rigContainer);
rigContainer.addChild(meshNode);
for (const [name, parentName, global] of rig) {
  const parentGlobal = parentName ? byName.get(parentName).global : [0, 0, 0];
  const local = global.map((value, axis) => value - parentGlobal[axis]);
  const node = doc.createNode(name).setTranslation(local).setRotation([0, 0, 0, 1]);
  nodeByName.set(name, node);
  localByName.set(name, local);
  worldByName.set(name, new THREE.Matrix4().makeTranslation(...global));
}
for (const [name, parentName] of rig) (parentName ? nodeByName.get(parentName) : rigContainer).addChild(nodeByName.get(name));

// Discover connected islands without changing topology. Shalewake is a low,
// long-bodied quadruped facing +Z: its four limbs lie in the ±X / ±Z corners.
const componentParent = Uint32Array.from({ length: vertexCount }, (_, index) => index);
const find = (value) => { let at = value; while (componentParent[at] !== at) { componentParent[at] = componentParent[componentParent[at]]; at = componentParent[at]; } return at; };
const union = (a, b) => { const aa = find(a), bb = find(b); if (aa !== bb) componentParent[bb] = aa; };
for (let i = 0; i < indices.length; i += 3) { union(indices[i], indices[i + 1]); union(indices[i], indices[i + 2]); }
const components = new Map();
for (let vertex = 0; vertex < vertexCount; vertex++) {
  const componentId = find(vertex);
  if (!components.has(componentId)) components.set(componentId, { id: componentId, vertices: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
  const component = components.get(componentId);
  component.vertices.push(vertex);
  for (let axis = 0; axis < 3; axis++) {
    const value = positions[vertex * 3 + axis];
    component.min[axis] = Math.min(component.min[axis], value);
    component.max[axis] = Math.max(component.max[axis], value);
  }
}
const islandList = [...components.values()].sort((a, b) => b.vertices.length - a.vertices.length);
for (const island of islandList) island.center = island.min.map((value, axis) => (value + island.max[axis]) * .5);
const bodyIslands = new Set(islandList.filter((island) => island.max[2] - island.min[2] > .32 && island.min[1] > .12).map((island) => island.id));
const sensorIslands = new Set(islandList.filter((island) => island.center[2] > .36 && island.min[1] > .24 && island.max[1] < .34 && Math.abs(island.center[0]) < .08).map((island) => island.id));
const islandRole = (island) => {
  if (sensorIslands.has(island.id)) return 'sensing-cleft';
  if (bodyIslands.has(island.id)) return 'torso';
  if (Math.abs(island.center[0]) > .075 && island.max[1] < .34) {
    return `${island.center[2] >= 0 ? 'fore' : 'hind'}-${island.center[0] < 0 ? 'L' : 'R'}`;
  }
  return 'torso';
};
const rolesByComponent = new Map(islandList.map((island) => [island.id, islandRole(island)]));
const requiredLimbRoles = ['fore-L', 'fore-R', 'hind-L', 'hind-R'];
for (const role of requiredLimbRoles) if (![...rolesByComponent.values()].includes(role)) throw new Error(`Could not identify a Shalewake ${role} limb island`);
if (sensorIslands.size < 2) throw new Error(`Could not identify the paired forward sensing details (${sensorIslands.size} islands)`);

const segmentByName = new Map();
for (const [name, parentName, global] of rig) {
  const start = parentName ? byName.get(parentName).global : global;
  segmentByName.set(name, [start, global]);
}
function distanceToSegment(point, [a, b]) {
  const ab = b.map((value, axis) => value - a[axis]);
  const ap = point.map((value, axis) => value - a[axis]);
  const denominator = ab.reduce((sum, value) => sum + value * value, 0);
  const t = denominator > 1e-10 ? Math.max(0, Math.min(1, ab.reduce((sum, value, axis) => sum + value * ap[axis], 0) / denominator)) : 0;
  return Math.hypot(...point.map((value, axis) => value - (a[axis] + ab[axis] * t)));
}
function candidateBones(point, role) {
  const [, y, z] = point;
  if (role === 'sensing-cleft') return ['Neck', 'SensingCleft', point[0] < 0 ? 'Sense_L' : 'Sense_R'];
  if (role === 'torso') {
    if (z > .31) return ['Chest', 'Neck', 'SensingCleft'];
    if (z > .08) return ['Spine', 'Chest', 'Neck'];
    if (z < -.24) return ['Pelvis', 'Spine'];
    return ['Pelvis', 'Spine', 'Chest'];
  }
  const [quadrant, side] = role.split('-');
  const prefix = quadrant === 'fore' ? 'Fore' : 'Hind';
  const upper = `${prefix}legUpper_${side}`;
  const lower = `${prefix}legLower_${side}`;
  const paw = `${prefix}paw_${side}`;
  const attach = quadrant === 'fore' ? 'Chest' : 'Pelvis';
  if (y < .09) return [paw, lower];
  if (y < .17) return [lower, paw, upper];
  return [attach, upper, lower, paw];
}
const joints = new Uint16Array(vertexCount * 4);
const weights = new Float32Array(vertexCount * 4);
const jointCoverage = new Uint32Array(orderedNames.length);
const verticesByRole = {};
const influenceCounts = [0, 0, 0, 0, 0];
for (let vertex = 0; vertex < vertexCount; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const role = rolesByComponent.get(find(vertex));
  verticesByRole[role] = (verticesByRole[role] ?? 0) + 1;
  const candidates = candidateBones(point, role).map((name) => ({ name, distance: distanceToSegment(point, segmentByName.get(name)) }));
  const sigma = role === 'torso' ? .105 : role === 'sensing-cleft' ? .075 : point[1] < .09 ? .075 : .09;
  const ranked = candidates.map(({ name, distance }) => ({ name, score: Math.exp(-.5 * (distance / sigma) ** 2) }))
    .filter((candidate) => candidate.score > 1e-7).sort((a, b) => b.score - a.score).slice(0, 4);
  if (!ranked.length) throw new Error(`No anatomical influences found for Shalewake vertex ${vertex} (${role})`);
  const total = ranked.reduce((sum, candidate) => sum + candidate.score, 0);
  influenceCounts[ranked.length]++;
  let assigned = 0;
  for (let slot = 0; slot < ranked.length; slot++) {
    const candidate = ranked[slot];
    const at = vertex * 4 + slot;
    const value = slot === ranked.length - 1 ? 1 - assigned : candidate.score / total;
    joints[at] = jointIndex.get(candidate.name);
    weights[at] = value;
    assigned += value;
    if (value > 1e-6) jointCoverage[jointIndex.get(candidate.name)]++;
  }
}

meshNode.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]).setSkin(null);
for (const oldSkin of [...root.listSkins()]) oldSkin.dispose();
const skin = doc.createSkin('Shalewake four-limb articulated skin').setSkeleton(nodeByName.get('ShalewakeRoot'));
for (const name of orderedNames) skin.addJoint(nodeByName.get(name));
meshNode.setSkin(skin);
const inverseBind = new Float32Array(orderedNames.length * 16);
for (let i = 0; i < orderedNames.length; i++) worldByName.get(orderedNames[i]).clone().invert().toArray(inverseBind, i * 16);
const buffer = root.listBuffers()[0] ?? doc.createBuffer('Shalewake native rig, clips and maps');
skin.setInverseBindMatrices(doc.createAccessor('Shalewake_inverse_bind').setType(Accessor.Type.MAT4).setArray(inverseBind).setBuffer(buffer));
primitive.setAttribute('JOINTS_0', doc.createAccessor('Shalewake_joints').setType(Accessor.Type.VEC4).setArray(joints).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('Shalewake_weights').setType(Accessor.Type.VEC4).setArray(weights).setBuffer(buffer));

const axisQuat = (axis, angle) => {
  const half = angle * .5, s = Math.sin(half), c = Math.cos(half);
  return axis === 'x' ? [s, 0, 0, c] : axis === 'y' ? [0, s, 0, c] : [0, 0, s, c];
};
const animationReport = [];
function rotationTrack(node, axis, angleFrames) {
  return { node, path: 'rotation', type: Accessor.Type.VEC4, values: angleFrames.map((angle) => axisQuat(axis, angle)) };
}
function translationTrack(node, offsetFrames) {
  const base = localByName.get(node);
  return { node, path: 'translation', type: Accessor.Type.VEC3, values: offsetFrames.map((offset) => base.map((value, axis) => value + offset[axis])) };
}
function addClip(name, duration, phases, tracks) {
  const animation = doc.createAnimation(name);
  for (const track of tracks) {
    const times = phases.map((phase) => phase * duration);
    const input = doc.createAccessor(`${name}_${track.node}_${track.path}_time`).setType(Accessor.Type.SCALAR).setArray(new Float32Array(times)).setBuffer(buffer);
    const output = doc.createAccessor(`${name}_${track.node}_${track.path}_value`).setType(track.type).setArray(new Float32Array(track.values.flat())).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(nodeByName.get(track.node)).setTargetPath(track.path).setSampler(sampler));
  }
  animationReport.push({ name, duration, channelCount: tracks.length, loop: name === 'Idle' || name === 'Walk' || name === 'Run' });
}
const cycle = Array.from({ length: 9 }, (_, index) => index / 8);
const sine = (phase, amount) => cycle.map((time) => amount * Math.sin(2 * Math.PI * time + phase));
const cosineLift = (phase, amount) => cycle.map((time) => amount * Math.max(0, Math.cos(2 * Math.PI * time + phase)));

addClip('Idle', 3.0, [0, .2, .4, .6, .8, 1], [
  translationTrack('Chest', [[0, 0, 0], [0, .003, 0], [0, .001, 0], [0, -.002, 0], [0, -.001, 0], [0, 0, 0]]),
  rotationTrack('Spine', 'x', [0, .008, 0, -.008, 0, 0]),
  rotationTrack('Chest', 'x', [0, -.012, -.004, .01, .004, 0]),
  rotationTrack('Neck', 'x', [0, .018, .008, -.012, -.004, 0]),
  rotationTrack('SensingCleft', 'x', [0, -.018, .004, .012, -.006, 0]),
  rotationTrack('Sense_L', 'z', [0, .035, .008, -.025, -.008, 0]),
  rotationTrack('Sense_R', 'z', [0, -.026, -.01, .032, .008, 0]),
  rotationTrack('HindlegLower_L', 'x', [0, .012, .004, -.009, -.003, 0]),
  rotationTrack('ForelegLower_R', 'x', [0, -.01, -.003, .012, .004, 0]),
]);

for (const [name, duration, upperAmp, lowerAmp, torsoAmp] of [['Walk', 1.2, .22, .25, .022], ['Run', .78, .36, .38, .038]]) {
  const tracks = [
    translationTrack('ShalewakeRoot', cycle.map((time) => [0, torsoAmp * Math.max(0, Math.sin(4 * Math.PI * time)), 0])),
    rotationTrack('Pelvis', 'x', sine(0, torsoAmp * .85)),
    rotationTrack('Spine', 'x', sine(Math.PI / 2, torsoAmp * .7)),
    rotationTrack('Chest', 'x', sine(Math.PI, torsoAmp * 1.1)),
    rotationTrack('Neck', 'x', sine(Math.PI + .3, torsoAmp * .8)),
    rotationTrack('SensingCleft', 'x', sine(Math.PI, torsoAmp * .65)),
  ];
  const gait = [
    { prefix: 'Fore', side: 'L', phase: 0, multiplier: 1 },
    { prefix: 'Fore', side: 'R', phase: Math.PI, multiplier: .94 },
    { prefix: 'Hind', side: 'L', phase: Math.PI, multiplier: 1.08 },
    { prefix: 'Hind', side: 'R', phase: 0, multiplier: 1.02 },
  ];
  for (const leg of gait) {
    const upper = `${leg.prefix}legUpper_${leg.side}`, lower = `${leg.prefix}legLower_${leg.side}`, paw = `${leg.prefix}paw_${leg.side}`;
    tracks.push(rotationTrack(upper, 'x', sine(leg.phase, upperAmp * leg.multiplier)));
    tracks.push(rotationTrack(lower, 'x', cosineLift(leg.phase + .35, lowerAmp)));
    tracks.push(rotationTrack(paw, 'x', cycle.map((time, index) => {
      const angle = 2 * Math.PI * time + leg.phase;
      return -.38 * upperAmp * leg.multiplier * Math.sin(angle) - .3 * lowerAmp * Math.max(0, Math.cos(angle + .35));
    })));
  }
  addClip(name, duration, cycle, tracks);
}

addClip('Attack', .84, [0, .18, .42, .58, .78, 1], [
  translationTrack('ShalewakeRoot', [[0, 0, 0], [0, 0, .008], [0, -.004, .034], [0, -.006, .075], [0, 0, .032], [0, 0, 0]]),
  rotationTrack('Spine', 'x', [0, -.015, -.035, -.06, -.025, 0]),
  rotationTrack('Chest', 'x', [0, -.04, -.09, -.14, -.05, 0]),
  rotationTrack('Neck', 'x', [0, .06, .12, .18, .07, 0]),
  rotationTrack('SensingCleft', 'x', [0, .05, .14, .18, .05, 0]),
  rotationTrack('Sense_L', 'z', [0, .04, .11, .14, .04, 0]),
  rotationTrack('Sense_R', 'z', [0, -.04, -.11, -.14, -.04, 0]),
  rotationTrack('ForelegUpper_L', 'x', [0, -.04, -.12, -.18, -.06, 0]),
  rotationTrack('ForelegUpper_R', 'x', [0, -.04, -.12, -.18, -.06, 0]),
  rotationTrack('ForelegLower_L', 'x', [0, .05, .13, .2, .06, 0]),
  rotationTrack('ForelegLower_R', 'x', [0, .05, .13, .2, .06, 0]),
  rotationTrack('HindlegLower_L', 'x', [0, -.02, .07, .1, .025, 0]),
  rotationTrack('HindlegLower_R', 'x', [0, -.02, .07, .1, .025, 0]),
]);
addClip('Hit', .48, [0, .16, .42, .72, 1], [
  translationTrack('ShalewakeRoot', [[0, 0, 0], [0, -.01, -.018], [0, -.022, -.052], [0, -.006, -.016], [0, 0, 0]]),
  rotationTrack('ShalewakeRoot', 'z', [0, -.055, -.085, .028, 0]),
  rotationTrack('Spine', 'x', [0, .045, .085, -.025, 0]),
  rotationTrack('Chest', 'x', [0, .08, .13, -.035, 0]),
  rotationTrack('Neck', 'x', [0, -.11, -.18, .04, 0]),
  rotationTrack('SensingCleft', 'x', [0, -.08, -.15, .04, 0]),
  rotationTrack('ForelegUpper_L', 'x', [0, .08, .13, -.025, 0]),
  rotationTrack('ForelegUpper_R', 'x', [0, .08, .13, -.025, 0]),
  rotationTrack('HindlegLower_L', 'x', [0, .09, .14, -.02, 0]),
  rotationTrack('HindlegLower_R', 'x', [0, .09, .14, -.02, 0]),
]);
addClip('Death', 1.7, [0, .18, .48, .78, 1], [
  translationTrack('ShalewakeRoot', [[0, 0, 0], [0, -.003, 0], [0, -.008, 0], [0, -.01, 0], [0, -.01, 0]]),
  translationTrack('Chest', [[0, 0, 0], [0, -.004, 0], [0, -.009, 0], [0, -.012, 0], [0, -.012, 0]]),
  translationTrack('Neck', [[0, 0, 0], [0, -.009, .004], [0, -.025, -.006], [0, -.03, -.009], [0, -.03, -.009]]),
  rotationTrack('Pelvis', 'x', [0, .006, .014, .016, .016]),
  rotationTrack('Spine', 'x', [0, .01, .022, .025, .025]),
  rotationTrack('Chest', 'z', [0, .018, .05, .07, .07]),
  rotationTrack('Neck', 'x', [0, -.06, -.12, -.16, -.16]),
  rotationTrack('SensingCleft', 'x', [0, -.04, -.1, -.13, -.13]),
  rotationTrack('HindlegUpper_L', 'z', [0, -.04, -.09, -.11, -.11]),
  rotationTrack('HindlegUpper_R', 'z', [0, .04, .09, .11, .11]),
  rotationTrack('ForelegUpper_L', 'z', [0, -.04, -.09, -.115, -.115]),
  rotationTrack('ForelegUpper_R', 'z', [0, .04, .09, .115, .115]),
  rotationTrack('HindlegLower_L', 'x', [0, .06, .16, .21, .21]),
  rotationTrack('HindlegLower_R', 'x', [0, .06, .16, .21, .21]),
  rotationTrack('ForelegLower_L', 'x', [0, .07, .18, .24, .24]),
  rotationTrack('ForelegLower_R', 'x', [0, .07, .18, .24, .24]),
  rotationTrack('Hindpaw_L', 'x', [0, -.02, -.06, -.09, -.09]),
  rotationTrack('Hindpaw_R', 'x', [0, -.02, -.06, -.09, -.09]),
  rotationTrack('Forepaw_L', 'x', [0, -.02, -.07, -.1, -.1]),
  rotationTrack('Forepaw_R', 'x', [0, -.02, -.07, -.1, -.1]),
]);

// Preserve the source's richly layered image-generated 8K stone atlas at 2K.
// The Tripo file has no PBR channels, so build a restrained tangent normal from
// softened atlas luminance and a stone roughness field. Metallic stays zero.
const material = root.listMaterials()[0];
const baseTexture = material?.getBaseColorTexture();
if (!material || !baseTexture) throw new Error('Shalewake source material has no base-color atlas');
const originalImage = baseTexture.getImage();
const originalMeta = await sharp(originalImage).metadata();
if (originalMeta.width !== 8192 || originalMeta.height !== 8192) throw new Error(`Expected 8K source base color, got ${originalMeta.width}x${originalMeta.height}`);
const baseColor2k = await sharp(originalImage).resize({ width: 2048, height: 2048, kernel: 'lanczos3' }).jpeg({ quality: 94, mozjpeg: true }).toBuffer();
const rgb = await sharp(baseColor2k).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
const gray = await sharp(baseColor2k).greyscale().blur(.7).raw().toBuffer();
if (rgb.info.width !== 2048 || rgb.info.height !== 2048 || rgb.info.channels !== 3) throw new Error('Could not decode the 2K Shalewake color atlas');
const width = 2048, height = 2048;
const normalRgb = Buffer.alloc(width * height * 3);
const mrRgb = Buffer.alloc(width * height * 3);
const lum = (x, y) => gray[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))] / 255;
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const pixel = y * width + x;
  const dx = (lum(x + 2, y) - lum(x - 2, y)) * 3.2;
  const dy = (lum(x, y + 2) - lum(x, y - 2)) * 3.2;
  let nx = -dx, ny = dy, nz = 1;
  const length = Math.hypot(nx, ny, nz) || 1;
  nx /= length; ny /= length; nz /= length;
  const normalAt = pixel * 3;
  normalRgb[normalAt] = Math.round((nx + 1) * 127.5);
  normalRgb[normalAt + 1] = Math.round((ny + 1) * 127.5);
  normalRgb[normalAt + 2] = Math.round((nz + 1) * 127.5);
  const sourceAt = pixel * 3;
  const value = gray[pixel];
  const neighborhood = (lum(x - 1, y) + lum(x + 1, y) + lum(x, y - 1) + lum(x, y + 1)) * .25 * 255;
  const localTexture = Math.min(38, Math.abs(value - neighborhood));
  const chroma = Math.max(rgb.data[sourceAt], rgb.data[sourceAt + 1], rgb.data[sourceAt + 2]) - Math.min(rgb.data[sourceAt], rgb.data[sourceAt + 1], rgb.data[sourceAt + 2]);
  const roughness = Math.max(208, Math.min(244, Math.round(225 + (128 - value) * .055 + localTexture * .22 + chroma * .025)));
  mrRgb[sourceAt] = 255;
  mrRgb[sourceAt + 1] = roughness;
  mrRgb[sourceAt + 2] = 0;
}
const normal2k = await sharp(normalRgb, { raw: { width, height, channels: 3 } }).jpeg({ quality: 98, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();
const metallicRoughness2k = await sharp(mrRgb, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
await writeFile(path.join(here, 'shalewake_basecolor_2k.jpg'), baseColor2k);
await writeFile(path.join(here, 'shalewake_normal_2k.jpg'), normal2k);
await writeFile(path.join(here, 'shalewake_metallic_roughness_2k.png'), metallicRoughness2k);
baseTexture.setName('Shalewake layered stone base color 2K').setMimeType('image/jpeg').setImage(baseColor2k);
const normalTexture = doc.createTexture('Shalewake derived tangent normal 2K').setMimeType('image/jpeg').setImage(normal2k);
const metallicRoughnessTexture = doc.createTexture('Shalewake stone roughness and zero metal 2K').setMimeType('image/png').setImage(metallicRoughness2k);
material.setNormalTexture(normalTexture).setMetallicRoughnessTexture(metallicRoughnessTexture).setMetallicFactor(0).setRoughnessFactor(1);

const candidateBytes = await io.writeBinary(doc);
await writeFile(candidatePath, candidateBytes);
const candidateSha = hash(candidateBytes);
const check = await io.read(candidatePath);
const checkRoot = check.getRoot();
const checkPrimitive = checkRoot.listMeshes()[0]?.listPrimitives()[0];
const checkPos = checkPrimitive?.getAttribute('POSITION')?.getArray();
const checkNormal = checkPrimitive?.getAttribute('NORMAL')?.getArray();
const checkUv = checkPrimitive?.getAttribute('TEXCOORD_0')?.getArray();
const checkIndex = checkPrimitive?.getIndices()?.getArray();
const checkJoints = checkPrimitive?.getAttribute('JOINTS_0')?.getArray();
const checkWeights = checkPrimitive?.getAttribute('WEIGHTS_0')?.getArray();
const checkSkin = checkRoot.listSkins()[0];
if (checkRoot.listSkins().length !== 1 || !checkPos || !checkNormal || !checkUv || !checkIndex || !checkJoints || !checkWeights || !checkSkin) throw new Error('Candidate lost its mesh, maps, or articulated skin');
const maximumDelta = (a, b) => { if (!a || a.length !== b.length) return Infinity; let result = 0; for (let i = 0; i < a.length; i++) result = Math.max(result, Math.abs(a[i] - b[i])); return result; };
const positionDelta = maximumDelta(checkPos, positions), normalDelta = maximumDelta(checkNormal, normals), uvDelta = maximumDelta(checkUv, uv);
let indexMismatches = 0, maxWeightSumError = 0, multiWeightVertices = 0, minNonzeroWeight = 1;
for (let i = 0; i < indices.length; i++) if (checkIndex[i] !== indices[i]) indexMismatches++;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  let sum = 0, active = 0;
  for (let slot = 0; slot < 4; slot++) {
    const at = vertex * 4 + slot, joint = checkJoints[at], weight = checkWeights[at];
    if (!Number.isInteger(joint) || joint < 0 || joint >= orderedNames.length || !Number.isFinite(weight) || weight < 0 || weight > 1.00001) throw new Error(`Invalid Shalewake skin influence at vertex ${vertex}`);
    if (weight > 1e-6) { sum += weight; active++; minNonzeroWeight = Math.min(minNonzeroWeight, weight); }
  }
  if (Math.abs(sum - 1) > 1e-5) throw new Error(`Shalewake vertex ${vertex} has a weight sum of ${sum}`);
  maxWeightSumError = Math.max(maxWeightSumError, Math.abs(sum - 1));
  if (active > 1) multiWeightVertices++;
}
if (positionDelta > 1e-7 || normalDelta > 1e-7 || uvDelta > 1e-7 || indexMismatches) throw new Error(`Approved source geometry or UVs changed (${positionDelta}, ${normalDelta}, ${uvDelta}, ${indexMismatches})`);
const ibm = checkSkin.getInverseBindMatrices()?.getArray();
if (!ibm || ibm.length !== orderedNames.length * 16 || [...ibm].some((value) => !Number.isFinite(value))) throw new Error('Shalewake inverse bind matrices are missing or non-finite');
let inverseBindMaxDelta = 0;
for (let i = 0; i < orderedNames.length; i++) {
  const expected = worldByName.get(orderedNames[i]).clone().invert().toArray([]);
  for (let j = 0; j < 16; j++) inverseBindMaxDelta = Math.max(inverseBindMaxDelta, Math.abs(ibm[i * 16 + j] - expected[j]));
}
if (inverseBindMaxDelta > 1e-6) throw new Error(`Shalewake inverse binds do not match rest pose: ${inverseBindMaxDelta}`);
if (checkSkin.listJoints().map((node) => node.getName()).join(',') !== orderedNames.join(',')) throw new Error('Candidate skin joint order changed');
const requiredClips = 'Idle,Walk,Run,Attack,Hit,Death';
if (checkRoot.listAnimations().map((animation) => animation.getName()).join(',') !== requiredClips) throw new Error('Candidate is missing one of the six named clips');
const checkNodes = new Map(checkRoot.listNodes().map((node) => [node.getName(), node]));
const inverseMatrices = checkSkin.listJoints().map((_, index) => new THREE.Matrix4().fromArray(Array.from(ibm.slice(index * 16, index * 16 + 16))));
const candidateMeshNode = checkRoot.listNodes().find((node) => node.getMesh() === checkRoot.listMeshes()[0]);
function poseAt(animation, time) {
  const pose = new Map();
  for (const channel of animation.listChannels()) {
    const sampler = channel.getSampler(), times = Array.from(sampler.getInput().getArray()), values = Array.from(sampler.getOutput().getArray());
    const width = channel.getTargetPath() === 'rotation' ? 4 : 3;
    let upper = times.findIndex((key) => key >= time); if (upper < 0) upper = times.length - 1;
    const lower = Math.max(0, upper - (times[upper] === time ? 0 : 1));
    const alpha = upper === lower ? 0 : (time - times[lower]) / (times[upper] - times[lower]);
    const a = values.slice(lower * width, (lower + 1) * width), b = values.slice(upper * width, (upper + 1) * width);
    let value;
    if (channel.getTargetPath() === 'rotation') { const qa = new THREE.Quaternion(...a), qb = new THREE.Quaternion(...b); qa.slerp(qb, alpha).normalize(); value = [qa.x, qa.y, qa.z, qa.w]; }
    else value = a.map((component, index) => component + (b[index] - component) * alpha);
    const target = pose.get(channel.getTargetNode()) ?? {};
    target[channel.getTargetPath()] = value;
    pose.set(channel.getTargetNode(), target);
  }
  return pose;
}
function sampleSkin(animation, time) {
  const pose = animation ? poseAt(animation, time) : new Map(), world = new Map();
  for (const [name, parentName] of rig) {
    const node = checkNodes.get(name), edit = pose.get(node) ?? {};
    const localTranslation = edit.translation ?? localByName.get(name);
    const rotation = new THREE.Quaternion(...(edit.rotation ?? [0, 0, 0, 1]));
    const local = new THREE.Matrix4().compose(new THREE.Vector3(...localTranslation), rotation, new THREE.Vector3(1, 1, 1));
    world.set(name, parentName ? world.get(parentName).clone().multiply(local) : local);
  }
  const meshWorld = new THREE.Matrix4().compose(new THREE.Vector3(...candidateMeshNode.getTranslation()), new THREE.Quaternion(...candidateMeshNode.getRotation()), new THREE.Vector3(...candidateMeshNode.getScale())).invert();
  const skinMatrices = orderedNames.map((name, index) => meshWorld.clone().multiply(world.get(name)).multiply(inverseMatrices[index]));
  let maximumDisplacement = 0, movedVertices = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const sourcePoint = new THREE.Vector3(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]);
    const point = new THREE.Vector3();
    for (let slot = 0; slot < 4; slot++) {
      const at = vertex * 4 + slot, weight = checkWeights[at];
      if (weight > 0) point.add(sourcePoint.clone().applyMatrix4(skinMatrices[checkJoints[at]]).multiplyScalar(weight));
    }
    if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error(`${animation?.getName() ?? 'Rest pose'} produced non-finite Shalewake vertex ${vertex}`);
    maximumDisplacement = Math.max(maximumDisplacement, point.distanceTo(sourcePoint));
    if (point.distanceTo(sourcePoint) > 1e-4) movedVertices++;
    for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], point.getComponent(axis)); max[axis] = Math.max(max[axis], point.getComponent(axis)); }
  }
  return { maximumDisplacement, movedVertices, min, max };
}
const restPose = sampleSkin(null, 0);
if (restPose.maximumDisplacement > 1e-5) throw new Error(`Shalewake rest skin moved the source geometry (${restPose.maximumDisplacement})`);
const clipValidation = checkRoot.listAnimations().map((animation) => {
  const duration = Math.max(...animation.listChannels().map((channel) => channel.getSampler().getInput().getArray().at(-1)));
  const samples = [0, .25, .5, .75, 1].map((phase) => ({ phase, ...sampleSkin(animation, duration * phase) }));
  const maximumDisplacement = Math.max(...samples.map((sample) => sample.maximumDisplacement));
  const movedVertices = Math.max(...samples.map((sample) => sample.movedVertices));
  if (!(maximumDisplacement > (animation.getName() === 'Idle' ? .001 : .004)) || movedVertices < 8) throw new Error(`${animation.getName()} does not produce useful sampled deformation (${maximumDisplacement}, ${movedVertices})`);
  const swept = { min: [0, 1, 2].map((axis) => Math.min(...samples.map((sample) => sample.min[axis]))), max: [0, 1, 2].map((axis) => Math.max(...samples.map((sample) => sample.max[axis]))) };
  if (swept.min[1] < -.065 || swept.max[1] > .72 || Math.abs(swept.min[0]) > .4 || Math.abs(swept.max[0]) > .4 || Math.abs(swept.min[2]) > .72 || Math.abs(swept.max[2]) > .72) throw new Error(`${animation.getName()} has implausible Shalewake deformation bounds: ${JSON.stringify(swept)}`);
  return { name: animation.getName(), duration, channels: animation.listChannels().length, maximumDisplacement, movedVertices, sweptBounds: swept };
});
const mapReport = [];
for (const texture of checkRoot.listTextures()) {
  const info = await sharp(texture.getImage()).metadata();
  if (info.width !== 2048 || info.height !== 2048) throw new Error(`Runtime texture ${texture.getName()} is ${info.width}x${info.height}, expected 2K`);
  mapReport.push({ name: texture.getName(), dimensions: [info.width, info.height], mimeType: texture.getMimeType(), bytes: texture.getImage().length, sha256: hash(texture.getImage()) });
}
if (mapReport.length !== 3) throw new Error(`Expected 3 embedded 2K PBR maps, got ${mapReport.length}`);

const baseGeometry = { vertices: vertexCount, triangles: triangleCount, positionsPreserved: positionDelta === 0, normalsPreserved: normalDelta === 0, indicesPreserved: indexMismatches === 0, uv: 'TEXCOORD_0 retained unchanged; no retopology or unwrap' };
const boundsSize = bounds.max.map((value, axis) => value - bounds.min[axis]);
const acceptance = { imageApproved: false, geometryApproved: false, rigAccepted: false, motionAccepted: false, textureAccepted: false, promotable: false, labAccepted: false, worldIntegrated: false };
const catalog = {
  schema: 'corealm-creature-candidate/1', id, displayName: 'Shalewake', status: 'awaiting-root-lab-review', acceptance,
  provenance: {
    batchId: 'shale-elemental', candidateSearch: 'No other candidate found in the prior nine-pack-two batch.', sourceAudit: { status: 'approved', reviewer: 'stone_audit', verdict: 'approved-with-face-audit', sourceImageId, reason: 'Flowing geological body, integrated sensing cleft, balanced four limbs and violet/ochre seams; no dinosaur neck or tail.' },
    modelId: sourceModelId, sourceImageId, sourceReference: 'assets/art/tripo/references/stone-shalewake.png', sourceReferenceSha256: referenceSha,
    sourceFile: 'assets/art/tripo/exports/corealm_shalewake_da0d598a_8k_rigged.glb', sourceSha256: sourceSha, sourceBytes: sourceBytes.length,
    sourceBaseColor: `${originalMeta.width}x${originalMeta.height} image-generated layered stone atlas`, sourceSkin: '1 skin, 5 joints, rounded 100% of original weight mass on bone_0; 0 clips; residual weight on other joints is below 0.0001% of total.',
    sourceWeightAudit,
    sourceGeometry: baseGeometry,
  },
  candidate: {
    file: path.basename(candidatePath), sha256: candidateSha, bytes: candidateBytes.length, vertices: vertexCount, triangles: triangleCount, bounds,
    rig: { type: 'authored non-humanoid quadruped rig', profile: 'Generic glTF skin; importer and lab review pending', joints: orderedNames, jointsCount: orderedNames.length, weighting: 'Connected-island and four-limb regional masks; torso follows pelvis/spine/chest/neck, each fore/hind leg has upper/lower/paw joints; normalized four-influence weights.' },
    maps: mapReport, sidecarMaps: ['shalewake_basecolor_2k.jpg', 'shalewake_normal_2k.jpg', 'shalewake_metallic_roughness_2k.png'], clips: animationReport,
    targetAssetId: id, notes: ['Approved source base-color atlas is retained and reduced from 8K to 2K; no monochromatic recolor or replacement skin.', 'The 2K normal channel is a restrained height-derived tangent map from smoothed source-albedo relief. Packed metallic-roughness keeps metal at zero and applies variable high stone roughness.', 'Four-limb walk and run use diagonal quadruped gait phases. Attack is a low forward shoulder ram; Hit recoils; Death folds the legs and lowers the long torso.', 'All candidate acceptance remains false pending root feature-lab review and screenshot inspection.'],
  },
  validation: {
    positionsMaxDelta: positionDelta, normalsMaxDelta: normalDelta, uvsMaxDelta: uvDelta, indexMismatches, sourceWeightAudit, weightMaxSumError: maxWeightSumError, minimumNonzeroWeight: minNonzeroWeight,
    verticesWithMultipleInfluences: multiWeightVertices, influenceCountByActiveWeights: influenceCounts,
    verticesByAnatomicalRole: verticesByRole, connectedIslands: islandList.length,
    jointsWithWeights: orderedNames.map((name, index) => ({ name, vertices: jointCoverage[index] })), inverseBindMaxDelta: inverseBindMaxDelta,
    clipSamples: clipValidation,
  },
};
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
await writeFile(provenancePath, `${JSON.stringify({ schema: 'corealm-creature-candidate-provenance/1', ...catalog.provenance, candidate: { file: path.basename(candidatePath), sha256: candidateSha, bytes: candidateBytes.length }, status: 'source-audit-approved; runtime-candidate-acceptance-pending-root-lab' }, null, 2)}\n`);

const manifest = JSON.parse(await readFile(path.join(repo, 'game/public/assets/manifest.json'), 'utf8'));
const existingAsset = manifest.assets.find((asset) => asset.id === id);
if (!existingAsset) throw new Error(`Root-owned manifest has no existing ${id} asset; candidate stays isolated`);
const labAsset = {
  id, file: existingAsset.file, pack: existingAsset.pack, category: existingAsset.category, is: 'Shalewake',
  tags: ['creature', 'elemental', 'stone', 'quadruped', 'shale', 'skinned', 'articulated'],
  bytes: candidateBytes.length, sha256: candidateSha,
  size: { x: boundsSize[0], y: boundsSize[1], z: boundsSize[2] }, base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] }, bounds, groundY: bounds.min[1], triangles: triangleCount,
  animations: animationReport.map((clip) => clip.name), materials: [material.getName()], walkClipSeconds: 1.2, runClipSeconds: .78, attackSeconds: .84, contactNormalized: .58,
  sourceProvenance: { author: 'Corealm creature rig reconstruction', batchId: 'shale-elemental', sourceImageId, modelId: sourceModelId, sourceSha256: sourceSha, sourceReferenceSha256: referenceSha, rigMethod: '20-joint articulated four-limb quadruped rig with torso and four limb chains; connected-island weights and six custom clips.', candidateFile: path.basename(candidatePath), candidateSha256: candidateSha },
  metadata: { is: 'Shalewake', tags: ['creature', 'elemental', 'stone', 'quadruped', 'shale', 'skinned', 'articulated'], walkClipSeconds: 1.2, runClipSeconds: .78, attackSeconds: .84, contactNormalized: .58, notes: 'Approved long-bodied shale elemental; layered source stone atlas and derived 2K PBR maps. Candidate-only pending root lab review.', boneNames: orderedNames },
  acceptance: { assetAudit: false, labAccepted: false, worldIntegrated: false },
};
const labCatalog = { schema: 'corealm-lab-asset-candidates/1', assets: [labAsset], files: { [id]: path.basename(candidatePath) } };
const mappedCandidate = path.resolve(here, labCatalog.files[id]);
if (path.relative(here, mappedCandidate).startsWith('..') || mappedCandidate.toLowerCase() !== path.resolve(candidatePath).toLowerCase()) throw new Error('Candidate file mapping escapes or disagrees with the selected local override');
if (labAsset.bytes !== candidateBytes.length || labAsset.sha256 !== hash(await readFile(mappedCandidate))) throw new Error('Local catalog does not match the candidate GLB bytes');
await writeFile(labCatalogPath, `${JSON.stringify(labCatalog, null, 2)}\n`);

console.log(JSON.stringify({ candidate: path.relative(repo, candidatePath), sha256: candidateSha, bytes: candidateBytes.length, vertices: vertexCount, triangles: triangleCount, joints: orderedNames.length, connectedIslands: islandList.length, verticesByAnatomicalRole: verticesByRole, maxWeightSumError, multiWeightVertices, maps: mapReport, clips: clipValidation }, null, 2));
