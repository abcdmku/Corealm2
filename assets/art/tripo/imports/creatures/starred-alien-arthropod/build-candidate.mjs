import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import * as THREE from 'three';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../../');
const ownerDir = path.relative(repo, here).replaceAll('\\', '/');
const sourcePath = path.join(repo, 'assets/art/tripo/exports/0ea08166-294b-467b-982b-8f3c1891eee3.glb');
const imagePath = path.join(repo, 'assets/art/tripo/references/marsh-ash-blind-cave-weaver.png');
const batchPath = path.join(repo, 'assets/art/tripo/batches/creatures-marsh-ash.json');
const manifestPath = path.join(repo, 'game/public/assets/manifest.json');
const outputPath = path.join(here, 'vaultweaver-native-rig-candidate.glb');
const catalogPath = path.join(here, 'catalog.json');
const labCatalogPath = path.join(here, 'lab-catalog.json');
const sourceBytes = await readFile(sourcePath);
const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
const imageBytes = await readFile(imagePath);
const imageHash = createHash('sha256').update(imageBytes).digest('hex');
const batch = JSON.parse(await readFile(batchPath, 'utf8'));
const sourceEntry = batch.assets.find((entry) => entry.modelId === '0ea08166-294b-467b-982b-8f3c1891eee3');
if (!sourceEntry?.starred || sourceEntry.review?.status !== 'approved' || sourceEntry.facialReview?.status !== 'approved') {
  throw new Error('The exact Vaultweaver source image or face review is not approved/starred.');
}
if (sourceEntry.sourceImageId !== '4adea6eb-8436-4a07-9c52-9b71300f70bf' || sourceEntry.sourcePath !== 'assets/art/tripo/references/marsh-ash-blind-cave-weaver.png') {
  throw new Error('The exact approved Vaultweaver source image reference changed.');
}
if (sourceEntry.smartUV?.status !== 'saved' || sourceEntry.texture?.status !== 'complete' || sourceEntry.pbr?.status !== 'complete' || sourceEntry.export?.exportSkeleton !== true) {
  throw new Error('Expected the starred Vaultweaver Smart UV, 8K texture, PBR and skeleton export.');
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(sourcePath);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const armature = scene?.listChildren().find((node) => node.getName() === 'Armature');
const meshNode = armature?.listChildren().find((node) => node.getMesh());
const mesh = meshNode?.getMesh();
const primitive = mesh?.listPrimitives()[0];
if (!scene || !armature || !meshNode || !mesh || !primitive) throw new Error('Unexpected Tripo Vaultweaver hierarchy.');
if (root.listAnimations().length) throw new Error('Source unexpectedly contains clips; refusing to overwrite them.');
const sourcePositions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
const sourceNormals = Float32Array.from(primitive.getAttribute('NORMAL')?.getArray() ?? []);
const sourceUVs = Float32Array.from(primitive.getAttribute('TEXCOORD_0')?.getArray() ?? []);
const sourceIndices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
const originalSkin = meshNode.getSkin();
const originalJointData = primitive.getAttribute('JOINTS_0')?.getArray();
const originalWeightData = primitive.getAttribute('WEIGHTS_0')?.getArray();
if (!originalSkin || !originalJointData || !originalWeightData) throw new Error('The archived Tripo source lost its exported 36-joint skin.');
const originalWeightedJoints = new Set();
let originalMultijointVertices = 0;
for (let vertex = 0; vertex < sourcePositions.length / 3; vertex += 1) {
  const used = new Set();
  for (let slot = 0; slot < 4; slot += 1) {
    const at = vertex * 4 + slot;
    if (originalWeightData[at] <= 1e-5) continue;
    originalWeightedJoints.add(originalJointData[at]);
    used.add(originalJointData[at]);
  }
  if (used.size > 1) originalMultijointVertices += 1;
}
const originalRig = {
  joints: originalSkin.listJoints().length,
  weightedJoints: originalWeightedJoints.size,
  multijointVertices: originalMultijointVertices,
  clips: root.listAnimations().length,
};
const vertexCount = sourcePositions.length / 3;
const triangleCount = sourceIndices.length / 3;
if (vertexCount !== 3436 || triangleCount !== 5400) throw new Error(`Approved source topology drifted: ${vertexCount} vertices / ${triangleCount} triangles.`);
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < sourcePositions.length; i += 3) for (let axis = 0; axis < 3; axis += 1) {
  bounds.min[axis] = Math.min(bounds.min[axis], sourcePositions[i + axis]);
  bounds.max[axis] = Math.max(bounds.max[axis], sourcePositions[i + axis]);
}
const size = bounds.max.map((value, axis) => value - bounds.min[axis]);

// Y is vertical, X is the left/right leg axis and +Z points toward the hood, paired
// manipulators and forward feet. Three foot-pair clusters establish the axial layout:
// front at z≈+.46, middle at z≈0, rear at z≈−.33. The source's 29-joint export has
// identity rest transforms and 99.97% bone_0 weights, so only its broken rig is replaced.
const definitions = [
  { name: 'VaultweaverRoot', parent: null, p: [0, 0, 0], group: 'root' },
  { name: 'BodyCore', parent: 'VaultweaverRoot', p: [0, .48, .08], group: 'body', sigma: .20 },
  { name: 'Carapace', parent: 'BodyCore', p: [0, .66, .08], group: 'body', sigma: .20 },
  { name: 'Hood', parent: 'BodyCore', p: [0, .47, .29], group: 'body', sigma: .14 },
  { name: 'SilkSac', parent: 'BodyCore', p: [0, .45, -.23], group: 'body', sigma: .14 },
];
const legDefinitions = [];
for (const [name, side, frontZ, sign] of [
  ['ForeL', 'L', .46, -1], ['ForeR', 'R', .46, 1],
  ['MidL', 'L', -.01, -1], ['MidR', 'R', -.01, 1],
  ['HindL', 'L', -.334, -1], ['HindR', 'R', -.334, 1],
]) {
  const absSide = sign;
  const isMid = name.startsWith('Mid');
  const hipZ = isMid ? .025 : frontZ > 0 ? .18 : -.12;
  const kneeZ = isMid ? .015 : frontZ > 0 ? .31 : -.22;
  const ankleZ = isMid ? -.005 : frontZ > 0 ? .405 : -.298;
  const footZ = isMid ? -.018 : frontZ;
  const hipX = absSide * .125;
  const kneeX = absSide * (isMid ? .235 : .195);
  const ankleX = absSide * (isMid ? .33 : .25);
  const footX = absSide * (isMid ? .378 : .278);
  const leg = {
    name, side, phase: (name === 'ForeL' || name === 'HindL' || name === 'MidR') ? 0 : .5,
    axis: isMid ? 'z' : 'x', liftSign: isMid ? absSide : -Math.sign(frontZ - hipZ),
    bones: [`${name}_Hip`, `${name}_Knee`, `${name}_Ankle`, `${name}_Foot`],
    points: [[hipX, .445, hipZ], [kneeX, .29, kneeZ], [ankleX, .14, ankleZ], [footX, .04, footZ]],
  };
  legDefinitions.push(leg);
  leg.bones.forEach((boneName, index) => definitions.push({ name: boneName, parent: index === 0 ? 'BodyCore' : leg.bones[index - 1], p: leg.points[index], group: 'leg', leg: name }));
}
const jointNames = definitions.map((bone) => bone.name);
const jointIndex = new Map(jointNames.map((name, index) => [name, index]));
const byName = new Map(definitions.map((bone) => [bone.name, bone]));
for (const definition of definitions) {
  const parent = definition.parent ? byName.get(definition.parent) : null;
  definition.local = parent ? definition.p.map((value, axis) => value - parent.p[axis]) : [...definition.p];
}

// Remove the degenerate source rig, keeping approved positions, normals, UVs and indices.
const orphanedRigNodes = [];
const collectRigNodes = (node) => {
  for (const child of node.listChildren()) {
    if (child === meshNode) continue;
    orphanedRigNodes.push(child);
    collectRigNodes(child);
  }
};
collectRigNodes(armature);
for (const semantic of ['JOINTS_0', 'WEIGHTS_0', 'JOINTS_1', 'WEIGHTS_1']) primitive.setAttribute(semantic, null);
meshNode.setSkin(null);
scene.removeChild(armature);
armature.removeChild(meshNode);
if (originalSkin) originalSkin.dispose();
for (const node of orphanedRigNodes.reverse()) node.dispose();
armature.dispose();
const container = doc.createNode('VaultweaverNativeRigContainer').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
scene.addChild(container);
container.addChild(meshNode.setName('VaultweaverMesh').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]));
const nodeByName = new Map();
for (const definition of definitions) {
  const node = doc.createNode(definition.name).setTranslation(definition.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  nodeByName.set(definition.name, node);
  (definition.parent ? nodeByName.get(definition.parent) : container).addChild(node);
}
const skin = doc.createSkin('Vaultweaver six-leg cave arthropod skin').setSkeleton(nodeByName.get('VaultweaverRoot'));
for (const definition of definitions) skin.addJoint(nodeByName.get(definition.name));
meshNode.setSkin(skin);
const inverseBind = new Float32Array(definitions.length * 16);
for (let index = 0; index < definitions.length; index += 1) {
  const [x, y, z] = definitions[index].p;
  inverseBind.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], index * 16);
}
const buffer = root.listBuffers()[0] ?? doc.createBuffer('Vaultweaver native rig and motion');
skin.setInverseBindMatrices(doc.createAccessor('Vaultweaver_InverseBindMatrices').setArray(inverseBind).setType(Accessor.Type.MAT4).setBuffer(buffer));

const distanceToSegment = (point, start, end) => {
  const direction = end.map((value, axis) => value - start[axis]);
  const offset = point.map((value, axis) => value - start[axis]);
  const lengthSq = direction.reduce((sum, value) => sum + value * value, 0);
  const t = lengthSq > 1e-10 ? Math.max(0, Math.min(1, offset.reduce((sum, value, axis) => sum + value * direction[axis], 0) / lengthSq)) : 0;
  const closest = start.map((value, axis) => value + direction[axis] * t);
  return { distance: Math.hypot(...point.map((value, axis) => value - closest[axis])), t };
};
const smoothstep = (low, high, value) => {
  const x = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return x * x * (3 - 2 * x);
};
const segmentRecords = legDefinitions.flatMap((leg) => leg.bones.slice(0, -1).map((boneName, index) => ({
  leg, boneA: boneName, boneB: leg.bones[index + 1], a: leg.points[index], b: leg.points[index + 1],
})));
const bodyBones = [
  { name: 'BodyCore', p: [0, .48, .08], sigma: .19 },
  { name: 'Carapace', p: [0, .66, .08], sigma: .20 },
  { name: 'Hood', p: [0, .47, .29], sigma: .145 },
  { name: 'SilkSac', p: [0, .45, -.23], sigma: .15 },
];
const joints0 = new Uint16Array(vertexCount * 4);
const weights0 = new Float32Array(vertexCount * 4);
const influenceCounts = new Array(definitions.length).fill(0);
let distributedVertices = 0;
let maxWeightSumError = 0;
for (let vertex = 0; vertex < vertexCount; vertex += 1) {
  const point = [sourcePositions[vertex * 3], sourcePositions[vertex * 3 + 1], sourcePositions[vertex * 3 + 2]];
  const [x, y, z] = point;
  let nearest = null;
  for (const segment of segmentRecords) {
    const result = distanceToSegment(point, segment.a, segment.b);
    if (!nearest || result.distance < nearest.distance) nearest = { ...result, segment };
  }
  const radial = Math.hypot(x / .20, (z - .08) / .31);
  const limbGate = smoothstep(.52, .28, y) * smoothstep(.72, 1.12, radial);
  const limbActivation = nearest ? limbGate * Math.exp(-.5 * (nearest.distance / .072) ** 2) : 0;
  const bodyScores = bodyBones.map((bone) => {
    const distance = Math.hypot(x - bone.p[0], y - bone.p[1], z - bone.p[2]);
    return { name: bone.name, score: Math.exp(-.5 * (distance / bone.sigma) ** 2) * (1 - .94 * limbActivation) };
  });
  const candidates = bodyScores;
  if (nearest && limbActivation > 1e-7) {
    candidates.push(
      { name: nearest.segment.boneA, score: limbActivation * (1 - nearest.t) },
      { name: nearest.segment.boneB, score: limbActivation * nearest.t },
    );
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 4);
  const total = chosen.reduce((sum, item) => sum + item.score, 0);
  if (!(total > 0) || !Number.isFinite(total)) throw new Error(`No anatomical support for vertex ${vertex}.`);
  let used = 0;
  for (let slot = 0; slot < 4; slot += 1) {
    const item = chosen[slot];
    if (!item) continue;
    const joint = jointIndex.get(item.name);
    if (joint == null) throw new Error(`Unknown anatomical joint ${item.name}.`);
    const weight = item.score / total;
    joints0[vertex * 4 + slot] = joint;
    weights0[vertex * 4 + slot] = weight;
    influenceCounts[joint] += weight > 1e-5 ? 1 : 0;
    used += weight > 1e-5 ? 1 : 0;
  }
  if (used > 1) distributedVertices += 1;
  const sum = weights0[vertex * 4] + weights0[vertex * 4 + 1] + weights0[vertex * 4 + 2] + weights0[vertex * 4 + 3];
  maxWeightSumError = Math.max(maxWeightSumError, Math.abs(sum - 1));
  if (Math.abs(sum - 1) > 1e-5) throw new Error(`Weights at vertex ${vertex} sum to ${sum}.`);
}
primitive.setAttribute('JOINTS_0', doc.createAccessor('Vaultweaver_Joints0').setArray(joints0).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('Vaultweaver_Weights0').setArray(weights0).setType(Accessor.Type.VEC4).setBuffer(buffer));
if (distributedVertices < vertexCount * .35) throw new Error(`Too few distributed weights: ${distributedVertices}/${vertexCount}.`);
for (const leg of legDefinitions) for (const name of leg.bones) {
  if (influenceCounts[jointIndex.get(name)] < 4) throw new Error(`Underused leg bone ${name}: ${influenceCounts[jointIndex.get(name)]} vertices.`);
}
for (const definition of definitions) if (definition.name !== 'VaultweaverRoot' && influenceCounts[jointIndex.get(definition.name)] < 4) {
  throw new Error(`Underused authored joint ${definition.name}: ${influenceCounts[jointIndex.get(definition.name)]} vertices.`);
}

const quat = (axis, angle) => {
  const half = angle / 2, sin = Math.sin(half), cos = Math.cos(half);
  if (axis === 'x') return [sin, 0, 0, cos];
  if (axis === 'y') return [0, sin, 0, cos];
  return [0, 0, sin, cos];
};
const keyTimes = [0, .25, .5, .75, 1];
const clipReports = [];
function addClip(name, duration, tracks) {
  const animation = doc.createAnimation(name);
  for (const track of tracks) {
    const pathName = track.path ?? 'rotation';
    const type = track.type ?? (pathName === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4);
    const times = track.times ?? keyTimes.map((time) => time * duration);
    const input = doc.createAccessor(`${name}_${track.node}_${pathName}_time`).setArray(new Float32Array(times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const output = doc.createAccessor(`${name}_${track.node}_${pathName}_value`).setArray(new Float32Array(track.values.flat())).setType(type).setBuffer(buffer);
    const sampler = doc.createAnimationSampler(`${name}_${track.node}_${pathName}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    const channel = doc.createAnimationChannel(`${track.node}_${pathName}`).setTargetNode(nodeByName.get(track.node)).setTargetPath(pathName).setSampler(sampler);
    animation.addSampler(sampler).addChannel(channel);
  }
  clipReports.push({ name, seconds: duration, channels: tracks.length });
  return animation;
}

function gaitTracks(amplitude, kneeFlex, bodyBob) {
  const tracks = [];
  for (const leg of legDefinitions) {
    const phaseValues = keyTimes.map((time) => Math.sin((time + leg.phase) * Math.PI * 2));
    const [hip, knee, ankle, foot] = leg.bones;
    const signed = phaseValues.map((value) => leg.liftSign * value * amplitude);
    tracks.push({ node: hip, values: signed.map((angle) => quat(leg.axis, angle)) });
    tracks.push({ node: knee, values: phaseValues.map((value) => quat(leg.axis, leg.liftSign * Math.max(0, value) * kneeFlex)) });
    tracks.push({ node: ankle, values: phaseValues.map((value, index) => quat(leg.axis, -signed[index] * .42 - leg.liftSign * Math.max(0, value) * kneeFlex * .22)) });
    tracks.push({ node: foot, values: phaseValues.map((value, index) => quat(leg.axis, -signed[index] * .25 + leg.liftSign * Math.max(0, value) * kneeFlex * .10)) });
  }
  tracks.push({ node: 'BodyCore', path: 'translation', type: Accessor.Type.VEC3, values: keyTimes.map((_, index) => [0, .48 + bodyBob * [0, 1, 0, -1, 0][index], .08]) });
  tracks.push({ node: 'Carapace', values: keyTimes.map((_, index) => quat('x', .012 * [0, 1, 0, -1, 0][index])) });
  return tracks;
}

const idleTracks = gaitTracks(.014, .018, .0025);
addClip('Idle', 2.6, idleTracks);
addClip('Walk', 1.08, gaitTracks(.22, .20, .004));
addClip('Run', .72, gaitTracks(.46, .34, .014));
addClip('Attack', .88, [
  { node: 'BodyCore', path: 'translation', type: Accessor.Type.VEC3, times: [0, .20, .42, .88], values: [[0,.48,.08], [0,.48,.098], [0,.48,.135], [0,.48,.08]] },
  { node: 'BodyCore', times: [0, .20, .42, .88], values: [quat('x', 0), quat('x', -.035), quat('x', -.08), quat('x', 0)] },
  { node: 'Hood', times: [0, .20, .42, .88], values: [quat('x', 0), quat('x', .045), quat('x', -.105), quat('x', 0)] },
  { node: 'Carapace', times: [0, .20, .42, .88], values: [quat('x', 0), quat('x', -.018), quat('x', .04), quat('x', 0)] },
  ...legDefinitions.filter((leg) => leg.name.startsWith('Fore')).map((leg) => ({
    node: leg.bones[0], times: [0, .20, .42, .88],
    values: [quat(leg.axis, 0), quat(leg.axis, leg.liftSign * .06), quat(leg.axis, -leg.liftSign * .16), quat(leg.axis, 0)],
  })),
]);
addClip('Hit', .48, [
  { node: 'BodyCore', path: 'translation', type: Accessor.Type.VEC3, times: [0, .09, .22, .48], values: [[0,.48,.08], [0,.445,.045], [0,.468,.068], [0,.48,.08]] },
  { node: 'BodyCore', times: [0, .09, .22, .48], values: [quat('x', 0), quat('x', -.12), quat('x', .035), quat('x', 0)] },
  { node: 'Carapace', times: [0, .09, .22, .48], values: [quat('z', 0), quat('z', .10), quat('z', -.025), quat('z', 0)] },
  { node: 'Hood', times: [0, .09, .22, .48], values: [quat('x', 0), quat('x', -.12), quat('x', .035), quat('x', 0)] },
  ...legDefinitions.map((leg) => ({ node: leg.bones[0], times: [0, .09, .22, .48], values: [quat(leg.axis, 0), quat(leg.axis, leg.liftSign * .06), quat(leg.axis, -leg.liftSign * .018), quat(leg.axis, 0)] })),
]);
const deathEnd = .48;
const deathTimes = [0, .24, .62, 1.05, 1.55];
const deathFraction = deathTimes.map((time) => time / deathEnd);
addClip('Death', 1.55, [
  { node: 'BodyCore', path: 'translation', type: Accessor.Type.VEC3, times: deathTimes, values: deathFraction.map((f) => [0, .48 - .035 * smoothstep(0, 1, f), .08 - .018 * smoothstep(0, 1, f)]) },
  { node: 'BodyCore', times: deathTimes, values: deathFraction.map((f) => quat('x', -.11 * smoothstep(0, 1, f))) },
  { node: 'Carapace', times: deathTimes, values: deathFraction.map((f) => quat('z', .12 * smoothstep(0, 1, f))) },
  { node: 'Hood', times: deathTimes, values: deathFraction.map((f) => quat('x', .10 * smoothstep(0, 1, f))) },
  ...legDefinitions.flatMap((leg) => [
    { node: leg.bones[0], times: deathTimes, values: deathFraction.map((f) => quat(leg.axis, leg.liftSign * .30 * smoothstep(0, 1, f))) },
    { node: leg.bones[1], times: deathTimes, values: deathFraction.map((f) => quat(leg.axis, -leg.liftSign * .46 * smoothstep(0, 1, f))) },
    { node: leg.bones[2], times: deathTimes, values: deathFraction.map((f) => quat(leg.axis, leg.liftSign * .22 * smoothstep(0, 1, f))) },
    { node: leg.bones[3], times: deathTimes, values: deathFraction.map((f) => quat(leg.axis, -leg.liftSign * .08 * smoothstep(0, 1, f))) },
  ]),
]);

// Keep the approved 8K layered albedo and generated normal/roughness maps as source data;
// ship each runtime map at 2K. Renormalize the filtered normal vectors and preserve the
// original packed PBR channels. Vaultweaver is mineral/organic, so its exported PBR values
// and the nearly-zero metallic map are kept intact rather than inventing a shiny finish.
const material = primitive.getMaterial();
if (!material?.getBaseColorTexture() || !material.getNormalTexture() || !material.getMetallicRoughnessTexture()) throw new Error('Vaultweaver is missing one of its generated PBR maps.');
const textureRoles = new Map([
  [material.getBaseColorTexture(), 'base-color'],
  [material.getNormalTexture(), 'normal'],
  [material.getMetallicRoughnessTexture(), 'metallic-roughness'],
]);
const sourceMaterialName = material.getName();
const sourceMaterialFactors = {
  baseColor: [...material.getBaseColorFactor()],
  metallic: material.getMetallicFactor(),
  roughness: material.getRoughnessFactor(),
};
// The live enemy renderer applies a strong tier-metal wash unless the material name is a
// recognized creature surface. The Tripo name fell through that rule, turning this authored
// pale, layered mineral shell Emberdrift orange in the T20 lab. Renaming only the material keeps
// the approved albedo and PBR maps untouched while opting into the existing animal_* exemption.
material.setName('animal_vaultweaver_mineral_shell');
const textureReport = [];
async function downsampleData(encoded, renormalizeNormal) {
  const { data, info } = await sharp(encoded).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3 || info.width !== info.height || info.width < 2048 || info.width % 2048 !== 0) {
    throw new Error(`Unexpected PBR source map dimensions ${info.width}x${info.height}x${info.channels}.`);
  }
  const stride = info.width / 2048;
  const sampleCount = stride * stride;
  const out = Buffer.alloc(2048 * 2048 * 3);
  for (let y = 0; y < 2048; y += 1) for (let x = 0; x < 2048; x += 1) {
    const sums = [0, 0, 0];
    for (let dy = 0; dy < stride; dy += 1) for (let dx = 0; dx < stride; dx += 1) {
      const at = (((y * stride + dy) * info.width) + x * stride + dx) * 3;
      sums[0] += data[at]; sums[1] += data[at + 1]; sums[2] += data[at + 2];
    }
    let channels = sums.map((sum) => sum / sampleCount);
    if (renormalizeNormal) {
      let [nx, ny, nz] = channels.map((value) => value / 127.5 - 1);
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length; ny /= length; nz /= length;
      channels = [(nx + 1) * 127.5, (ny + 1) * 127.5, (nz + 1) * 127.5];
    }
    const outputAt = (y * 2048 + x) * 3;
    out[outputAt] = Math.round(channels[0]); out[outputAt + 1] = Math.round(channels[1]); out[outputAt + 2] = Math.round(channels[2]);
  }
  return out;
}
for (const texture of root.listTextures()) {
  const encoded = texture.getImage();
  if (!encoded) continue;
  const role = textureRoles.get(texture);
  if (!role) throw new Error(`Unclassified source texture ${texture.getName()}; refusing to flatten an unknown map.`);
  const sourceMeta = await sharp(encoded).metadata();
  let output;
  if (role === 'base-color') {
    output = await sharp(encoded).resize({ width: 2048, height: 2048, fit: 'fill', kernel: 'lanczos3' }).jpeg({ quality: 91, mozjpeg: true }).toBuffer();
    texture.setMimeType('image/jpeg');
  } else {
    const reduced = await downsampleData(encoded, role === 'normal');
    if (role === 'normal') {
      output = await sharp(reduced, { raw: { width: 2048, height: 2048, channels: 3 } }).jpeg({ quality: 96, chromaSubsampling: '4:4:4' }).toBuffer();
      texture.setMimeType('image/jpeg');
    } else {
      output = await sharp(reduced, { raw: { width: 2048, height: 2048, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
      texture.setMimeType('image/png');
    }
  }
  texture.setImage(new Uint8Array(output));
  const runtimeMeta = await sharp(output).metadata();
  textureReport.push({
    name: texture.getName(), role,
    source: `${sourceMeta.width}x${sourceMeta.height}`,
    sourceSha256: createHash('sha256').update(encoded).digest('hex'),
    runtime: `${runtimeMeta.width}x${runtimeMeta.height}`,
    runtimeSha256: createHash('sha256').update(output).digest('hex'),
    mimeType: texture.getMimeType(), bytes: output.length,
  });
}

await io.write(outputPath, doc);
const candidateBytes = await readFile(outputPath);
const candidateHash = createHash('sha256').update(candidateBytes).digest('hex');
const validation = await validateCandidate(outputPath);
const catalog = {
  schema: 'corealm-creature-native-rig-candidate/1',
  id: 'creature_vaultweaver',
  displayName: 'Vaultweaver',
  identityProposal: {
    tier: 20,
    role: 'Medium mineral-shell cave weaver; territorial when approached, otherwise part of the living cavern ecosystem.',
    biome: ['limestone caves', 'chalk caverns', 'stone hollows'],
    combat: 'Grounded six-leg approach, short front-palp strike, moderate aggression; retain a normal creature tier rather than a boss slot.',
    drops: ['vault-shell chitin', 'mineral silk'],
  },
  duplicateSourceWarning: 'This is a newer archived export of the exact Tripo project already used by assets/art/tripo/imports/creatures/starred-vaultweaver/. Treat this candidate as a rig/export alternative; only one Vaultweaver version should enter production.',
  status: 'awaiting-root-lab-review',
  accepted: false,
  source: {
    file: 'assets/art/tripo/exports/0ea08166-294b-467b-982b-8f3c1891eee3.glb',
    sha256: sourceHash,
    bytes: sourceBytes.length,
    modelId: '0ea08166-294b-467b-982b-8f3c1891eee3',
    sourceImage: 'assets/art/tripo/references/marsh-ash-blind-cave-weaver.png',
    sourceImageId: '4adea6eb-8436-4a07-9c52-9b71300f70bf',
    sourceImageSha256: imageHash,
    imageApproval: { reviewer: 'marsh_audit / gpt-6-astra low', verdict: 'approved', faceReview: 'approved', starred: true },
    geometryReview: { reviewer: 'gpt-6-astra low', verdict: 'accept', scope: 'T20/T40 mineral shell, complete limbs, serious stone styling' },
    triangleCount: triangleCount,
    topologyPreserved: true,
    originalRig,
    materialAudit: {
      sourceName: sourceMaterialName,
      runtimeName: material.getName(),
      rendererRule: 'animal_* materials preserve authored creature colors without the enemy tier-metal tint.',
      factors: sourceMaterialFactors,
      uvCount: sourceUVs.length / 2,
      uvSha256: createHash('sha256').update(Buffer.from(sourceUVs.buffer, sourceUVs.byteOffset, sourceUVs.byteLength)).digest('hex'),
    },
  },
  candidate: {
    file: path.basename(outputPath),
    sha256: candidateHash,
    bytes: candidateBytes.length,
    vertices: vertexCount,
    triangles: triangleCount,
    bounds,
    size: { x: size[0], y: size[1], z: size[2] },
    groundY: bounds.min[1],
    rig: {
      type: 'authored non-humanoid arthropod skeleton',
      joints: jointNames,
      jointCount: jointNames.length,
      legPairs: ['fore', 'mid', 'hind'],
      pairedPalps: 'Kept with the hood/body weights; no isolated joints were accepted because the visible source geometry did not align with the first conservative palp paths.',
      basis: 'Y-up, X lateral, +Z hood/front',
      weights: 'Per-vertex distances to model-fitted six-leg polylines with body/leg spatial gating; normalized 4-influence skin. Source mesh, indices, normals and UVs retained.',
    },
    textures: textureReport,
    animations: clipReports,
    validation,
  },
  acceptance: { imageApproved: true, geometryApproved: true, rigAccepted: false, motionAccepted: false, textureAccepted: false, labAccepted: false, promotable: false, worldIntegrated: false },
  notes: [
    'This is a lab candidate, not a production promotion. Root reviews Idle, Walk, Run, Attack, Hit and Death on the normal gameplay camera before any integration.',
    'A previous candidate exists under assets/art/tripo/imports/creatures/starred-vaultweaver/ from a separate export of this same starred image/model. This new folder uses the directly archived GLB export and should supersede or be compared against that candidate, never coexist as a duplicate creature.',
    'The approved Smart Mesh P2.0 topology, atlas, albedo, normal map and packed metallic-roughness map remain intact; only the broken skeleton, weights and clips were rebuilt.',
    'Runtime source image maps are downsampled to 2K. The generated packed mineral PBR remains near-zero-metallic and rough; its generated material factors and surface maps are preserved.',
    'The source material name bypassed the renderer’s natural-creature tier-tint exemption; the runtime material now uses its animal_* creature prefix so the original layered mineral colors stay visible.',
  ],
};
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

const productionManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const slot = productionManifest.assets.find((asset) => asset.id === 'creature_slag_centipede');
if (!slot) throw new Error('Expected the existing T20 arthropod lab comparison slot creature_slag_centipede.');
const { measuredGait: _gait, impliedWalkMps: _walk, impliedRunMps: _run, ...baseSlot } = slot;
const candidateTags = ['creature', 'crawler', 'arthropod', 'cave', 'vaultweaver', 'mineral-shell', 'skinned', 'articulated'];
const { authoringModule: _oldAuthoringModule, ...oldMetadata } = slot.metadata ?? {};
const labAsset = {
  ...baseSlot,
  is: 'Vaultweaver (temporary T20 arthropod lab candidate)',
  tags: candidateTags,
  bytes: candidateBytes.length,
  sha256: candidateHash,
  size: { x: size[0], y: size[1], z: size[2] },
  base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] },
  bounds,
  groundY: bounds.min[1],
  triangles: triangleCount,
  animations: clipReports.map((clip) => clip.name),
  materials: [material.getName()],
  walkClipSeconds: 1.08,
  runClipSeconds: .72,
  attackSeconds: .88,
  contactNormalized: .5,
  sourceProvenance: {
    author: 'Corealm candidate rig reconstruction',
    source: 'Starred, image-approved Tripo P2.0 Vaultweaver; 5400 source triangles retained with new model-fitted six-leg rig.',
    sourceImageId: '4adea6eb-8436-4a07-9c52-9b71300f70bf',
    modelId: '0ea08166-294b-467b-982b-8f3c1891eee3',
    sourceSha256: sourceHash,
    candidateFile: path.basename(outputPath),
    candidateSha256: candidateHash,
  },
  metadata: {
    ...oldMetadata,
    is: 'Vaultweaver',
    tags: candidateTags,
    provenance: { sourceImageId: sourceEntry.sourceImageId, modelId: sourceEntry.modelId, sourceSha256: sourceHash, candidateSha256: candidateHash },
    walkClipSeconds: 1.08,
    runClipSeconds: .72,
    attackSeconds: .88,
  },
};
await writeFile(labCatalogPath, `${JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', assets: [labAsset], files: { creature_slag_centipede: path.basename(outputPath) } }, null, 2)}\n`);
console.log(JSON.stringify({ file: path.relative(repo, outputPath), sha256: candidateHash, bytes: candidateBytes.length, vertices: vertexCount, triangles: triangleCount, joints: jointNames.length, distributedVertices, textures: textureReport, validation }, null, 2));

async function validateCandidate(filePath) {
  const check = await io.read(filePath);
  const outRoot = check.getRoot();
  const outMesh = outRoot.listMeshes()[0];
  const outPrimitive = outMesh?.listPrimitives()[0];
  if (!outPrimitive) throw new Error('Candidate lost its source mesh.');
  const positions = outPrimitive.getAttribute('POSITION')?.getArray();
  const normals = outPrimitive.getAttribute('NORMAL')?.getArray();
  const uvs = outPrimitive.getAttribute('TEXCOORD_0')?.getArray();
  const indices = outPrimitive.getIndices()?.getArray();
  const joints = outPrimitive.getAttribute('JOINTS_0')?.getArray();
  const weights = outPrimitive.getAttribute('WEIGHTS_0')?.getArray();
  const outputSkin = outMeshNode(outRoot, outMesh)?.getSkin();
  if (!positions || !normals || !uvs || !indices || !joints || !weights || !outputSkin || outRoot.listSkins().length !== 1) throw new Error('Candidate lost its required mesh/skin attributes.');
  const same = (a, b) => a.length === b.length && Array.from(a).every((value, index) => value === b[index]);
  if (!same(positions, sourcePositions) || !same(normals, sourceNormals) || !same(uvs, sourceUVs) || !same(indices, sourceIndices)) throw new Error('Approved mesh geometry, normal, UV or index data changed.');
  const outMaterial = outPrimitive.getMaterial();
  if (outMaterial?.getName() !== 'animal_vaultweaver_mineral_shell'
    || !outMaterial.getBaseColorTexture()
    || !outMaterial.getNormalTexture()
    || !outMaterial.getMetallicRoughnessTexture()
    || JSON.stringify(outMaterial.getBaseColorFactor()) !== JSON.stringify(sourceMaterialFactors.baseColor)
    || outMaterial.getMetallicFactor() !== sourceMaterialFactors.metallic
    || outMaterial.getRoughnessFactor() !== sourceMaterialFactors.roughness) {
    throw new Error('Candidate material lost its creature-safe name, PBR maps or source factors.');
  }
  if (outputSkin.listJoints().length !== definitions.length) throw new Error('Native rig joint list changed during serialization.');
  let maxWeightError = 0;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    let sum = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      const joint = joints[vertex * 4 + slot], weight = weights[vertex * 4 + slot];
      if (!Number.isInteger(joint) || joint < 0 || joint >= definitions.length || !Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error(`Invalid joint weight at ${vertex}:${slot}.`);
      sum += weight;
    }
    maxWeightError = Math.max(maxWeightError, Math.abs(sum - 1));
    if (Math.abs(sum - 1) > 1e-5) throw new Error(`Candidate weights at vertex ${vertex} sum to ${sum}.`);
  }
  const ibm = outputSkin.getInverseBindMatrices()?.getArray();
  if (!ibm || ibm.length !== definitions.length * 16 || [...ibm].some((value) => !Number.isFinite(value))) throw new Error('Candidate inverse-bind matrices are invalid.');
  const names = outRoot.listAnimations().map((animation) => animation.getName()).sort();
  const required = ['Attack', 'Death', 'Hit', 'Idle', 'Run', 'Walk'];
  if (JSON.stringify(names) !== JSON.stringify(required)) throw new Error(`Candidate clips differ from required locomotion/combat clips: ${names.join(', ')}`);
  for (const animation of outRoot.listAnimations()) for (const channel of animation.listChannels()) {
    const sampler = channel.getSampler();
    const times = sampler.getInput()?.getArray(), values = sampler.getOutput()?.getArray();
    if (!channel.getTargetNode() || !jointNames.includes(channel.getTargetNode().getName()) || !times?.length || !values?.length) throw new Error(`Invalid channel in ${animation.getName()}.`);
    for (let i = 1; i < times.length; i += 1) if (!(times[i] > times[i - 1])) throw new Error(`Unordered sampler in ${animation.getName()}.`);
    if ([...times, ...values].some((value) => !Number.isFinite(value))) throw new Error(`Non-finite animation data in ${animation.getName()}.`);
  }
  const materialCheck = outPrimitive.getMaterial();
  if (!materialCheck?.getBaseColorTexture() || !materialCheck.getNormalTexture() || !materialCheck.getMetallicRoughnessTexture()) throw new Error('Candidate lost one or more embedded PBR maps.');
  const mapSizes = await Promise.all([materialCheck.getBaseColorTexture(), materialCheck.getNormalTexture(), materialCheck.getMetallicRoughnessTexture()].map(async (texture) => {
    const meta = await sharp(texture.getImage()).metadata();
    return [meta.width, meta.height];
  }));
  if (mapSizes.some(([width, height]) => width !== 2048 || height !== 2048)) throw new Error(`Runtime PBR maps are not all 2K: ${JSON.stringify(mapSizes)}.`);
  const sampledDeformations = sampleAnimations(outRoot, positions, joints, weights, ibm);
  for (const sample of sampledDeformations) if (sample.maximumDisplacement < (sample.name === 'Idle' ? .001 : .005) || sample.minimumY < -.14 || sample.maximumY > 1.05) throw new Error(`${sample.name} has weak motion or implausible bounds: ${JSON.stringify(sample)}.`);
  return {
    exactSourcePositionsNormalsUVIndicesPreserved: true,
    normalizedFourSlotWeights: true,
    distributedVertices,
    activeJointVertexCounts: Object.fromEntries(definitions.map((definition, index) => [definition.name, influenceCounts[index]])),
    maximumWeightSumError: maxWeightError,
    inverseBindMatricesFinite: true,
    pbrMapDimensions: mapSizes,
    sampledDeformations,
  };
}

function outMeshNode(outRoot, targetMesh) {
  return outRoot.listNodes().find((node) => node.getMesh() === targetMesh);
}

function sampleAnimations(outRoot, positions, joints, weights, ibm) {
  const objects = new Map();
  for (const definition of definitions) {
    const object = new THREE.Object3D();
    object.name = definition.name;
    object.position.fromArray(definition.local);
    objects.set(definition.name, object);
    const parent = definition.parent ? objects.get(definition.parent) : null;
    if (parent) parent.add(object);
  }
  const sceneRoot = objects.get('VaultweaverRoot');
  const inverse = definitions.map((_, index) => new THREE.Matrix4().fromArray(Array.from(ibm.slice(index * 16, index * 16 + 16))));
  const getPose = (animation, time) => {
    const pose = new Map();
    for (const channel of animation.listChannels()) {
      const sampler = channel.getSampler();
      const times = Array.from(sampler.getInput().getArray());
      const values = Array.from(sampler.getOutput().getArray());
      const width = channel.getTargetPath() === 'rotation' ? 4 : 3;
      const hi = Math.max(1, times.findIndex((key) => key >= time));
      const upper = hi >= times.length ? times.length - 1 : hi;
      const lower = Math.max(0, upper - 1);
      const fraction = upper === lower ? 0 : Math.max(0, Math.min(1, (time - times[lower]) / (times[upper] - times[lower])));
      const start = values.slice(lower * width, (lower + 1) * width), end = values.slice(upper * width, (upper + 1) * width);
      let value;
      if (channel.getTargetPath() === 'rotation') {
        const a = new THREE.Quaternion(...start), b = new THREE.Quaternion(...end);
        a.slerp(b, fraction).normalize();
        value = [a.x, a.y, a.z, a.w];
      } else value = start.map((component, axis) => component + (end[axis] - component) * fraction);
      const nodeName = channel.getTargetNode().getName();
      const nodePose = pose.get(nodeName) ?? {};
      nodePose[channel.getTargetPath()] = value;
      pose.set(nodeName, nodePose);
    }
    return pose;
  };
  const results = [];
  for (const animation of outRoot.listAnimations()) {
    let maximumDisplacement = 0, minimumY = Infinity, maximumY = -Infinity;
    const times = new Set([0]);
    let duration = 0;
    for (const channel of animation.listChannels()) {
      const input = channel.getSampler().getInput().getArray();
      for (const time of input) times.add(time);
      duration = Math.max(duration, input.at(-1));
    }
    for (const fraction of [.125, .25, .375, .5, .625, .75, .875, 1]) times.add(duration * fraction);
    for (const time of [...times].sort((a, b) => a - b)) {
      const pose = getPose(animation, time);
      for (const definition of definitions) {
        const object = objects.get(definition.name);
        object.position.fromArray(definition.local);
        object.quaternion.identity();
        const value = pose.get(definition.name);
        if (value?.translation) object.position.fromArray(value.translation);
        if (value?.rotation) object.quaternion.fromArray(value.rotation);
      }
      sceneRoot.updateMatrixWorld(true);
      const matrices = definitions.map((definition, index) => objects.get(definition.name).matrixWorld.clone().multiply(inverse[index]));
      let sampleMinY = Infinity, sampleMaxY = -Infinity;
      for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
        const original = new THREE.Vector3(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]);
        const point = new THREE.Vector3();
        for (let slot = 0; slot < 4; slot += 1) {
          const weight = weights[vertex * 4 + slot];
          if (weight > 0) point.add(original.clone().applyMatrix4(matrices[joints[vertex * 4 + slot]]).multiplyScalar(weight));
        }
        if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error(`${animation.getName()} deforms a non-finite vertex.`);
        maximumDisplacement = Math.max(maximumDisplacement, point.distanceTo(original));
        sampleMinY = Math.min(sampleMinY, point.y); sampleMaxY = Math.max(sampleMaxY, point.y);
      }
      minimumY = Math.min(minimumY, sampleMinY); maximumY = Math.max(maximumY, sampleMaxY);
    }
    results.push({ name: animation.getName(), maximumDisplacement: +maximumDisplacement.toFixed(4), minimumY: +minimumY.toFixed(4), maximumY: +maximumY.toFixed(4) });
  }
  return results;
}
