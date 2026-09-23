import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import * as THREE from 'three';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../../');
const relative = value => path.relative(repo, value).replaceAll('\\', '/');
const sourcePath = path.join(repo, 'assets/art/tripo/exports/corealm_flint_mandible_28d04ec6_8k_rigged.glb');
const referencePath = path.join(repo, 'assets/art/tripo/references/stone-flint-mandible.png');
const outputPath = path.join(here, 'storm-scarab-native-rig-candidate.glb');
const texturesDir = path.join(here, 'textures');
const expected = {
  modelId: '28d04ec6-6894-4388-a8b1-e8803e0d3f89',
  sourceImageId: '3db77a56-c3f1-4569-89b8-15f873effc6e',
  sourceSha256: '4db53464a2cf3ca38d76c1659ac267255ab6f6fb1f65db1db84f5cd1e323c074',
  sourceBytes: 16766828,
  referenceSha256: '95213149a958257cc3d0b28e408c8e07ece65d45e3e73450178edeec83635520',
  vertices: 2649,
  triangles: 4178,
  sourceJoints: 8,
};

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = await readFile(sourcePath);
const referenceBytes = await readFile(referencePath);
const sourceSha256 = hash(sourceBytes);
const referenceSha256 = hash(referenceBytes);
if (sourceBytes.length !== expected.sourceBytes || sourceSha256 !== expected.sourceSha256) {
  throw new Error(`Pinned Tripo source changed: ${sourceBytes.length} bytes, ${sourceSha256}.`);
}
if (referenceSha256 !== expected.referenceSha256) throw new Error(`Approved source image changed: ${referenceSha256}.`);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(sourcePath);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const meshNode = root.listNodes().find(node => node.getMesh());
const mesh = meshNode?.getMesh();
const primitive = mesh?.listPrimitives()[0];
const material = primitive?.getMaterial();
if (!scene || !meshNode || !mesh || !primitive || !material) throw new Error('Pinned source GLB hierarchy is incomplete.');
const originalSkin = meshNode.getSkin();
if (!originalSkin || originalSkin.listJoints().length !== expected.sourceJoints) throw new Error('Expected the audited eight-joint Tripo skin.');
if (root.listAnimations().length !== 0) throw new Error('Source now has animation clips; stop and audit before replacing the rig.');

const positions = primitive.getAttribute('POSITION')?.getArray();
const normals = primitive.getAttribute('NORMAL')?.getArray();
const sourceUvs = primitive.getAttribute('TEXCOORD_0')?.getArray();
const sourceIndices = primitive.getIndices()?.getArray();
const sourceJoints = primitive.getAttribute('JOINTS_0')?.getArray();
const sourceWeights = primitive.getAttribute('WEIGHTS_0')?.getArray();
if (!positions || !normals || !sourceUvs || !sourceIndices || !sourceJoints || !sourceWeights) throw new Error('Expected indexed source mesh with normals, UVs and a skin.');
const vertexCount = positions.length / 3;
const triangleCount = sourceIndices.length / 3;
if (vertexCount !== expected.vertices || triangleCount !== expected.triangles) throw new Error(`Source topology changed: ${vertexCount} vertices / ${triangleCount} triangles.`);
const preserved = {
  positions: positions.slice(),
  normals: normals.slice(),
  uvs: sourceUvs.slice(),
  indices: sourceIndices.slice(),
};
let sourceWeightMass = 0;
let sourceBone0Mass = 0;
for (let i = 0; i < sourceWeights.length; i += 1) {
  const weight = sourceWeights[i];
  if (weight <= 0) continue;
  sourceWeightMass += weight;
  if (sourceJoints[i] === 0) sourceBone0Mass += weight;
}
const sourceBone0Fraction = sourceBone0Mass / sourceWeightMass;
if (sourceBone0Fraction < 0.99999) throw new Error(`Source weight audit changed: bone_0 carries ${sourceBone0Fraction}.`);

const baseColor = material.getBaseColorTexture();
const sourceMaterialName = material.getName();
if (!baseColor || material.getMetallicRoughnessTexture() || material.getNormalTexture() || material.getOcclusionTexture()) {
  throw new Error('Expected the audited source to contain its 8K base color only.');
}
const sourceBaseBytes = Buffer.from(baseColor.getImage());
const sourceBaseInfo = await sharp(sourceBaseBytes).metadata();
if (sourceBaseInfo.width !== 8192 || sourceBaseInfo.height !== 8192) throw new Error('Source base-color map is no longer 8K.');
const sourceBaseSha256 = hash(sourceBaseBytes);

// Keep the source's layered stone albedo. Generate aligned tangent normals and ORM
// channels from its painted mineral relief; no mesh or UV edits are performed.
await mkdir(texturesDir, { recursive: true });
const baseColorPath = path.join(texturesDir, 'storm-scarab-basecolor-2k.jpg');
const normalPath = path.join(texturesDir, 'storm-scarab-normal-2k.png');
const ormPath = path.join(texturesDir, 'storm-scarab-orm-2k.png');
const baseColorRuntime = await sharp(sourceBaseBytes)
  .resize({ width: 2048, height: 2048, fit: 'fill', kernel: 'lanczos3' })
  .jpeg({ quality: 94, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();
const { data: rgb, info: rgbInfo } = await sharp(baseColorRuntime).removeAlpha().raw().toBuffer({ resolveWithObject: true });
if (rgbInfo.width !== 2048 || rgbInfo.height !== 2048 || rgbInfo.channels !== 3) throw new Error('Could not decode the 2K albedo for PBR derivation.');
const pixelCount = rgbInfo.width * rgbInfo.height;
const heightField = new Float32Array(pixelCount);
for (let pixel = 0; pixel < pixelCount; pixel += 1) {
  const i = pixel * 3;
  heightField[pixel] = (0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2]) / 255;
}
const normalRgb = Buffer.alloc(pixelCount * 3);
const ormRgb = Buffer.alloc(pixelCount * 3);
const clamp01 = value => Math.max(0, Math.min(1, value));
const normalStrength = 4.2;
for (let y = 0; y < rgbInfo.height; y += 1) {
  const y0 = Math.max(0, y - 1), y1 = Math.min(rgbInfo.height - 1, y + 1);
  for (let x = 0; x < rgbInfo.width; x += 1) {
    const x0 = Math.max(0, x - 1), x1 = Math.min(rgbInfo.width - 1, x + 1);
    const p = y * rgbInfo.width + x;
    const left = heightField[y * rgbInfo.width + x0];
    const right = heightField[y * rgbInfo.width + x1];
    const above = heightField[y0 * rgbInfo.width + x];
    const below = heightField[y1 * rgbInfo.width + x];
    const gx = (right - left) * 0.5 * normalStrength;
    const gy = (below - above) * 0.5 * normalStrength;
    const invLength = 1 / Math.hypot(gx, gy, 1);
    const ni = p * 3;
    normalRgb[ni] = Math.round(127.5 * (1 - gx * invLength));
    normalRgb[ni + 1] = Math.round(127.5 * (1 + gy * invLength));
    normalRgb[ni + 2] = Math.round(127.5 * (1 + invLength));

    let neighborhood = 0, samples = 0;
    for (let oy = -1; oy <= 1; oy += 1) for (let ox = -1; ox <= 1; ox += 1) {
      const sx = Math.max(0, Math.min(rgbInfo.width - 1, x + ox));
      const sy = Math.max(0, Math.min(rgbInfo.height - 1, y + oy));
      neighborhood += heightField[sy * rgbInfo.width + sx];
      samples += 1;
    }
    const valley = Math.max(0, neighborhood / samples - heightField[p]);
    const relief = Math.min(1, Math.hypot(gx, gy));
    const luminance = heightField[p];
    const roughness = Math.max(0.72, Math.min(0.99, 0.78 + (1 - luminance) * 0.11 + relief * 0.055));
    const occlusion = Math.max(0.78, Math.min(1, 0.97 - valley * 1.6 - relief * 0.018));
    const oi = p * 3;
    ormRgb[oi] = Math.round(occlusion * 255); // R: ambient occlusion
    ormRgb[oi + 1] = Math.round(roughness * 255); // G: roughness
    ormRgb[oi + 2] = 0; // B: flint is non-metallic
  }
}
const normalRuntime = await sharp(normalRgb, { raw: { width: 2048, height: 2048, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
const ormRuntime = await sharp(ormRgb, { raw: { width: 2048, height: 2048, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
await Promise.all([
  writeFile(baseColorPath, baseColorRuntime),
  writeFile(normalPath, normalRuntime),
  writeFile(ormPath, ormRuntime),
]);
baseColor.setName('StormScarab_BaseColor_2K').setMimeType('image/jpeg').setImage(new Uint8Array(baseColorRuntime));
const normalTexture = doc.createTexture('StormScarab_Normal_2K').setMimeType('image/png').setImage(new Uint8Array(normalRuntime));
const ormTexture = doc.createTexture('StormScarab_ORM_2K').setMimeType('image/png').setImage(new Uint8Array(ormRuntime));
material.setName('animal_storm_scarab_fangstone');
material.setMetallicFactor(0).setRoughnessFactor(0.9);
material.setNormalTexture(normalTexture).setNormalScale(0.72);
material.setMetallicRoughnessTexture(ormTexture);
material.setOcclusionTexture(ormTexture);

const rootPos = [0, 0, 0];
const bones = [
  { name: 'ScarabRoot', parent: null, p: rootPos },
  { name: 'BodyCore', parent: 'ScarabRoot', p: [0, 0.32, 0] },
  { name: 'Carapace', parent: 'BodyCore', p: [0, 0.52, -0.02] },
  { name: 'Head', parent: 'BodyCore', p: [0, 0.44, 0.27] },
  { name: 'Mandible', parent: 'Head', p: [0, 0.23, 0.42] },
  { name: 'Abdomen', parent: 'BodyCore', p: [0, 0.42, -0.24] },
];
const legs = [];
const pairDefs = [
  { pair: 'Front', z: 0.31, kneeZ: 0.34, ankleZ: 0.37, toeZ: 0.39, hipY: 0.38 },
  { pair: 'Middle', z: 0.05, kneeZ: 0.045, ankleZ: 0.05, toeZ: 0.06, hipY: 0.37 },
  { pair: 'Rear', z: -0.16, kneeZ: -0.18, ankleZ: -0.20, toeZ: -0.21, hipY: 0.37 },
];
for (const pair of pairDefs) for (const side of [{ name: 'Left', sign: -1 }, { name: 'Right', sign: 1 }]) {
  const name = `${pair.pair}${side.name}`;
  const points = [
    [side.sign * 0.145, pair.hipY, pair.z],
    [side.sign * (pair.pair === 'Middle' ? 0.235 : 0.205), 0.235, pair.kneeZ],
    [side.sign * (pair.pair === 'Middle' ? 0.285 : 0.255), 0.09, pair.ankleZ],
    [side.sign * (pair.pair === 'Middle' ? 0.31 : 0.28), 0.025, pair.toeZ],
  ];
  const boneNames = [`${name}_Hip`, `${name}_Femur`, `${name}_Tibia`, `${name}_Tarsus`];
  for (let i = 0; i < boneNames.length; i += 1) {
    bones.push({ name: boneNames[i], parent: i === 0 ? 'BodyCore' : boneNames[i - 1], p: points[i], leg: name, segment: i });
  }
  legs.push({ name, pair: pair.pair, side: side.name, sign: side.sign, points, boneNames });
}
const boneIndex = new Map(bones.map((bone, index) => [bone.name, index]));
for (const bone of bones) {
  const parent = bone.parent ? bones[boneIndex.get(bone.parent)] : null;
  bone.local = parent ? bone.p.map((value, axis) => value - parent.p[axis]) : [...bone.p];
}

const armature = meshNode.getParentNode();
if (!armature) throw new Error('Source mesh node has no armature parent.');
const sceneRoots = root.listScenes();
const orphanedNodes = [];
const collectRigNodes = node => {
  for (const child of node.listChildren()) {
    if (child === meshNode) continue;
    orphanedNodes.push(child);
    collectRigNodes(child);
  }
};
collectRigNodes(armature);
for (const semantic of ['JOINTS_0', 'WEIGHTS_0', 'JOINTS_1', 'WEIGHTS_1']) primitive.setAttribute(semantic, null);
meshNode.setSkin(null);
for (const sceneRoot of sceneRoots) sceneRoot.removeChild(armature);
armature.removeChild(meshNode);
originalSkin.dispose();
for (const node of orphanedNodes.reverse()) node.dispose();
armature.dispose();
const sceneScale = 2;
const container = doc.createNode('StormScarabNativeRig').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([sceneScale, sceneScale, sceneScale]);
scene.addChild(container);
container.addChild(meshNode.setName('StormScarabMesh').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]));
const nodeByName = new Map();
for (const bone of bones) {
  const node = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  nodeByName.set(bone.name, node);
  (bone.parent ? nodeByName.get(bone.parent) : container).addChild(node);
}
const skin = doc.createSkin('StormScarab six-leg burrower').setSkeleton(nodeByName.get('ScarabRoot'));
for (const bone of bones) skin.addJoint(nodeByName.get(bone.name));
const inverseBind = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i += 1) {
  const [x, y, z] = bones[i].p;
  inverseBind.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
}
const buffer = root.listBuffers()[0] ?? doc.createBuffer('Storm Scarab rig and clips');
skin.setInverseBindMatrices(doc.createAccessor('StormScarab_InverseBindMatrices').setArray(inverseBind).setType(Accessor.Type.MAT4).setBuffer(buffer));
meshNode.setSkin(skin);

const distanceToSegment = (point, start, end) => {
  const vector = end.map((value, axis) => value - start[axis]);
  const delta = point.map((value, axis) => value - start[axis]);
  const lengthSq = vector.reduce((sum, value) => sum + value * value, 0);
  const t = lengthSq > 1e-10 ? Math.max(0, Math.min(1, delta.reduce((sum, value, axis) => sum + value * vector[axis], 0) / lengthSq)) : 0;
  const nearest = start.map((value, axis) => value + vector[axis] * t);
  return { distance: Math.hypot(...point.map((value, axis) => value - nearest[axis])), t };
};
const smoothstep = (low, high, value) => {
  const t = clamp01((value - low) / (high - low));
  return t * t * (3 - 2 * t);
};
const legSegments = legs.flatMap(leg => leg.boneNames.slice(0, -1).map((name, segment) => ({
  leg, boneA: name, boneB: leg.boneNames[segment + 1], start: leg.points[segment], end: leg.points[segment + 1],
})));
const bodySegments = [
  { name: 'BodyCore', start: [0, 0.36, -0.25], end: [0, 0.39, 0.24], sigma: 0.205, gate: () => 1 },
  { name: 'Carapace', start: [0, 0.49, -0.31], end: [0, 0.58, 0.13], sigma: 0.175, gate: (_, y) => smoothstep(0.27, 0.44, y) },
  { name: 'Abdomen', start: [0, 0.41, -0.42], end: [0, 0.43, -0.10], sigma: 0.135, gate: (_, __, z) => smoothstep(0.03, -0.25, z) },
  { name: 'Head', start: [0, 0.47, 0.12], end: [0, 0.43, 0.39], sigma: 0.125, gate: (_, __, z) => smoothstep(0.06, 0.24, z) },
  { name: 'Mandible', start: [0, 0.37, 0.32], end: [0, 0.16, 0.47], sigma: 0.085, gate: (_, y, z) => smoothstep(0.26, 0.40, z) * (1 - smoothstep(0.26, 0.44, y)) },
];
const joints0 = new Uint16Array(vertexCount * 4);
const weights0 = new Float32Array(vertexCount * 4);
const influenceVertexCounts = Array(bones.length).fill(0);
const weightedJointMass = Array(bones.length).fill(0);
let distributedVertices = 0;
let maxWeightSumError = 0;
for (let vertex = 0; vertex < vertexCount; vertex += 1) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const [x, y, z] = point;
  const radial = Math.hypot(x / 0.16, (z + 0.005) / 0.30);
  const lowerBody = smoothstep(0.47, 0.22, y);
  const outerGate = smoothstep(0.72, 1.0, radial);
  const nearest = legSegments.map(segment => ({ ...distanceToSegment(point, segment.start, segment.end), segment }))
    .sort((a, b) => a.distance - b.distance)[0];
  const legActivation = nearest ? lowerBody * outerGate * Math.exp(-0.5 * (nearest.distance / 0.088) ** 2) : 0;
  const candidates = bodySegments.map(segment => {
    const d = distanceToSegment(point, segment.start, segment.end).distance;
    return { name: segment.name, score: Math.exp(-0.5 * (d / segment.sigma) ** 2) * segment.gate(x, y, z) * (1 - 0.93 * legActivation) };
  });
  if (nearest && legActivation > 1e-8) {
    candidates.push(
      { name: nearest.segment.boneA, score: legActivation * (1 - nearest.t) },
      { name: nearest.segment.boneB, score: legActivation * nearest.t },
    );
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 4);
  const total = chosen.reduce((sum, item) => sum + item.score, 0);
  if (!(total > 1e-12) || !Number.isFinite(total)) throw new Error(`No rig support for source vertex ${vertex}.`);
  let active = 0;
  for (let slot = 0; slot < chosen.length; slot += 1) {
    const item = chosen[slot];
    const index = boneIndex.get(item.name);
    if (index == null) throw new Error(`Unknown rig joint ${item.name}.`);
    const weight = item.score / total;
    joints0[vertex * 4 + slot] = index;
    weights0[vertex * 4 + slot] = weight;
    weightedJointMass[index] += weight;
    if (weight > 1e-5) {
      influenceVertexCounts[index] += 1;
      active += 1;
    }
  }
  if (active > 1) distributedVertices += 1;
  const sum = weights0[vertex * 4] + weights0[vertex * 4 + 1] + weights0[vertex * 4 + 2] + weights0[vertex * 4 + 3];
  maxWeightSumError = Math.max(maxWeightSumError, Math.abs(sum - 1));
  if (Math.abs(sum - 1) > 1e-5) throw new Error(`Candidate weights at vertex ${vertex} sum to ${sum}.`);
}
primitive.setAttribute('JOINTS_0', doc.createAccessor('StormScarab_Joints0').setArray(joints0).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('StormScarab_Weights0').setArray(weights0).setType(Accessor.Type.VEC4).setBuffer(buffer));
for (const leg of legs) for (const name of leg.boneNames) {
  if (influenceVertexCounts[boneIndex.get(name)] < 4) throw new Error(`Rig path for ${name} did not reach enough source vertices.`);
}

const quaternionEuler = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ')).normalize().toArray();
const keyTimes = [0, 0.25, 0.5, 0.75, 1];
const animationReports = [];
function createClip(name, duration, tracks, normalizedTimes = keyTimes) {
  const animation = doc.createAnimation(name);
  for (const track of tracks) {
    const pathName = track.path ?? 'rotation';
    const type = pathName === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4;
    const times = normalizedTimes.map(time => time * duration);
    const input = doc.createAccessor(`${name}_${track.node}_${pathName}_time`).setArray(new Float32Array(times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const output = doc.createAccessor(`${name}_${track.node}_${pathName}_value`).setArray(new Float32Array(track.values.flat())).setType(type).setBuffer(buffer);
    const sampler = doc.createAnimationSampler(`${name}_${track.node}_${pathName}_sampler`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    const channel = doc.createAnimationChannel(`${track.node}_${pathName}`).setTargetNode(nodeByName.get(track.node)).setTargetPath(pathName).setSampler(sampler);
    animation.addSampler(sampler).addChannel(channel);
  }
  animationReports.push({ name, seconds: duration, channels: tracks.length });
  return animation;
}
const rotationTrack = (node, eulers) => ({ node, values: eulers.map(([x, y, z]) => quaternionEuler(x, y, z)) });
const translationTrack = (node, values) => ({ node, path: 'translation', values });
const phaseOf = leg => (['FrontLeft', 'MiddleRight', 'RearLeft'].includes(leg.name) ? 0 : Math.PI);

function gaitTracks(amplitude, kneeFlex, bob, idle = false) {
  const tracks = [];
  const bodyWave = keyTimes.map((time, i) => [0, 1, 2, 1, 0][i]);
  tracks.push(translationTrack('BodyCore', keyTimes.map((_, i) => [0, 0.32 + bob * bodyWave[i], 0])));
  tracks.push(rotationTrack('Carapace', bodyWave.map(value => [value * 0.008, 0, value * 0.005])));
  tracks.push(rotationTrack('Head', bodyWave.map(value => [value * (idle ? 0.025 : 0.012), 0, value * 0.008])));
  for (const leg of legs) {
    const phase = phaseOf(leg);
    const hip = [], femur = [], tibia = [], tarsus = [];
    for (const time of keyTimes) {
      const theta = 2 * Math.PI * time + phase;
      const stride = Math.sin(theta);
      const lift = Math.max(0, Math.cos(theta));
      const sign = leg.sign;
      const pairScale = leg.pair === 'Middle' ? 0.82 : 1;
      const idleScale = idle ? 0.4 : 1;
      hip.push([sign * lift * amplitude * 0.16 * idleScale, sign * stride * amplitude * 0.52 * pairScale * idleScale, sign * lift * amplitude * 0.12 * idleScale]);
      femur.push([0, sign * stride * amplitude * 0.24 * idleScale, sign * lift * kneeFlex * 0.34 * idleScale]);
      tibia.push([0, -sign * stride * amplitude * 0.08, sign * lift * kneeFlex * idleScale]);
      tarsus.push([0, sign * stride * amplitude * 0.035, -sign * lift * kneeFlex * 0.38 * idleScale]);
    }
    tracks.push(rotationTrack(leg.boneNames[0], hip), rotationTrack(leg.boneNames[1], femur), rotationTrack(leg.boneNames[2], tibia), rotationTrack(leg.boneNames[3], tarsus));
  }
  return tracks;
}

createClip('Idle', 2.8, [
  ...gaitTracks(0.08, 0.12, 0.004, true),
  rotationTrack('Mandible', keyTimes.map((_, i) => [0, 0.018, 0, -0.018, 0][i]).map(angle => [angle, 0, 0])),
]);
createClip('Walk', 1.12, gaitTracks(0.30, 0.46, 0.016));
createClip('Run', 0.72, gaitTracks(0.48, 0.68, 0.028));
createClip('Attack', 0.86, [
  translationTrack('BodyCore', [[0, 0.32, 0], [0, 0.305, -0.035], [0, 0.36, 0.075], [0, 0.32, 0.025], [0, 0.32, 0]]),
  rotationTrack('Carapace', [[0, 0, 0], [-0.06, 0, -0.08], [0.10, 0, 0.16], [-0.04, 0, -0.07], [0, 0, 0]]),
  rotationTrack('Abdomen', [[0, 0, 0], [0.03, 0, 0.05], [-0.05, 0, -0.10], [0.02, 0, 0.04], [0, 0, 0]]),
  rotationTrack('Head', [[0, 0, 0], [0.08, 0, 0], [0.34, 0, 0], [-0.18, 0, 0], [0, 0, 0]]),
  rotationTrack('Mandible', [[0, 0, 0], [0.12, 0, 0], [0.62, 0, 0], [0.10, 0, 0], [0, 0, 0]]),
  ...legs.filter(leg => leg.pair === 'Front').flatMap(leg => [
    rotationTrack(leg.boneNames[0], [[0, 0, 0], [0, 0.08 * leg.sign, 0], [0, -0.22 * leg.sign, 0], [0, 0.03 * leg.sign, 0], [0, 0, 0]]),
    rotationTrack(leg.boneNames[2], [[0, 0, 0], [0, 0, 0.05 * leg.sign], [0, 0, 0.18 * leg.sign], [0, 0, 0.02 * leg.sign], [0, 0, 0]]),
  ]),
]);
createClip('Hit', 0.44, [
  translationTrack('BodyCore', [[0, 0.32, 0], [0, 0.365, -0.055], [0, 0.34, -0.025], [0, 0.32, 0], [0, 0.32, 0]]),
  rotationTrack('BodyCore', [[0, 0, 0], [0.06, 0, -0.11], [-0.045, 0, 0.06], [0.012, 0, 0], [0, 0, 0]]),
  rotationTrack('Head', [[0, 0, 0], [0.22, 0, 0], [-0.12, 0, 0], [0.025, 0, 0], [0, 0, 0]]),
  ...legs.map(leg => rotationTrack(leg.boneNames[0], [[0, 0, 0], [0.08 * leg.sign, 0.08 * leg.sign, 0], [0.025 * leg.sign, -0.035 * leg.sign, 0], [0, 0, 0], [0, 0, 0]])),
]);
createClip('Death', 1.62, [
  translationTrack('BodyCore', [[0, 0.32, 0], [0, 0.36, -0.015], [0, 0.48, 0], [0, 0.57, -0.015], [0, 0.57, -0.015]]),
  rotationTrack('BodyCore', [[0, 0, 0], [0.08, 0, 0.07], [0.25, 0, 0.42], [0.47, 0, 0.96], [0.47, 0, 0.96]]),
  rotationTrack('Carapace', [[0, 0, 0], [0.06, 0, 0], [-0.10, 0, 0.08], [-0.18, 0, 0.12], [-0.18, 0, 0.12]]),
  rotationTrack('Head', [[0, 0, 0], [0.14, 0, 0], [0.32, 0, 0], [0.40, 0, 0], [0.40, 0, 0]]),
  rotationTrack('Mandible', [[0, 0, 0], [0.12, 0, 0], [0.28, 0, 0], [0.20, 0, 0], [0.20, 0, 0]]),
  ...legs.flatMap(leg => [
    rotationTrack(leg.boneNames[0], [[0, 0, 0], [0.04 * leg.sign, 0.05 * leg.sign, 0], [0.13 * leg.sign, 0.18 * leg.sign, 0.10 * leg.sign], [0.20 * leg.sign, 0.22 * leg.sign, 0.18 * leg.sign], [0.20 * leg.sign, 0.22 * leg.sign, 0.18 * leg.sign]]),
    rotationTrack(leg.boneNames[2], [[0, 0, 0], [0, 0, 0.08 * leg.sign], [0, 0, 0.25 * leg.sign], [0, 0, 0.42 * leg.sign], [0, 0, 0.42 * leg.sign]]),
  ]),
]);

await io.write(outputPath, doc);
const candidateBytes = await readFile(outputPath);
const candidateSha256 = hash(candidateBytes);
const checkDoc = await io.read(outputPath);
const checkRoot = checkDoc.getRoot();
const checkMesh = checkRoot.listMeshes()[0];
const checkPrimitive = checkMesh?.listPrimitives()[0];
const checkMeshNode = checkRoot.listNodes().find(node => node.getMesh() === checkMesh);
const checkSkin = checkMeshNode?.getSkin();
if (!checkPrimitive || !checkSkin || checkSkin.listJoints().length !== bones.length) throw new Error('Written candidate failed skin round-trip validation.');
const writtenJointNames = checkSkin.listJoints().map(node => node.getName());
if (writtenJointNames.some((name, index) => name !== bones[index].name)) throw new Error('Serialized skin joint index order changed.');
const writtenContainer = checkRoot.listNodes().find(node => node.getName() === 'StormScarabNativeRig');
if (!writtenContainer || writtenContainer.getScale().some(value => value !== sceneScale)) throw new Error('Serialized scene scale is incorrect.');
if (checkRoot.listAnimations().length !== 6 || animationReports.map(report => report.name).join(',') !== 'Idle,Walk,Run,Attack,Hit,Death') throw new Error('Candidate does not contain the six required named clips.');
const sameValues = (left, right) => left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
for (const [label, before, after] of [
  ['positions', preserved.positions, checkPrimitive.getAttribute('POSITION')?.getArray()],
  ['normals', preserved.normals, checkPrimitive.getAttribute('NORMAL')?.getArray()],
  ['UVs', preserved.uvs, checkPrimitive.getAttribute('TEXCOORD_0')?.getArray()],
  ['indices', preserved.indices, checkPrimitive.getIndices()?.getArray()],
]) if (!after || !sameValues(before, after)) throw new Error(`Source ${label} changed during rig/material build.`);
const outJoints = checkPrimitive.getAttribute('JOINTS_0')?.getArray();
const outWeights = checkPrimitive.getAttribute('WEIGHTS_0')?.getArray();
if (!outJoints || !outWeights) throw new Error('Candidate skin attributes did not survive serialization.');
let roundTripMaxWeightError = 0;
for (let vertex = 0; vertex < vertexCount; vertex += 1) {
  let sum = 0;
  for (let slot = 0; slot < 4; slot += 1) {
    const offset = vertex * 4 + slot;
    sum += outWeights[offset];
    if (outJoints[offset] >= bones.length) throw new Error(`Vertex ${vertex} references an unknown joint.`);
  }
  roundTripMaxWeightError = Math.max(roundTripMaxWeightError, Math.abs(sum - 1));
  if (Math.abs(sum - 1) > 1e-5) throw new Error(`Serialized weights at vertex ${vertex} sum to ${sum}.`);
}
const checkMaterial = checkPrimitive.getMaterial();
if (!checkMaterial?.getBaseColorTexture() || !checkMaterial.getNormalTexture() || !checkMaterial.getMetallicRoughnessTexture() || !checkMaterial.getOcclusionTexture()) {
  throw new Error('Candidate is missing one or more 2K PBR texture channels.');
}
if (checkMaterial.getBaseColorTexture().getMimeType() !== 'image/jpeg'
  || checkMaterial.getNormalTexture().getMimeType() !== 'image/png'
  || checkMaterial.getMetallicRoughnessTexture().getMimeType() !== 'image/png') {
  throw new Error('Embedded texture MIME types do not match their encoded PNG/JPEG bytes.');
}
const textureReports = [];
for (const [name, bytes, role, file] of [
  ['StormScarab_BaseColor_2K', baseColorRuntime, 'base-color', relative(baseColorPath)],
  ['StormScarab_Normal_2K', normalRuntime, 'normal', relative(normalPath)],
  ['StormScarab_ORM_2K', ormRuntime, 'occlusion-roughness-metallic', relative(ormPath)],
]) {
  const meta = await sharp(bytes).metadata();
  textureReports.push({ name, role, width: meta.width, height: meta.height, mimeType: meta.format === 'jpeg' ? 'image/jpeg' : 'image/png', bytes: bytes.length, sha256: hash(bytes), file });
}
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis += 1) {
  bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis] * sceneScale);
  bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis] * sceneScale);
}
const size = bounds.min.map((value, axis) => bounds.max[axis] - value);
const suggestedScale = 1;
const authoredTiming = { walkClipSeconds: 1.12, runClipSeconds: 0.72, attackSeconds: 0.86, contactNormalized: 0.5 };
for (const [name, seconds] of [['Walk', authoredTiming.walkClipSeconds], ['Run', authoredTiming.runClipSeconds], ['Attack', authoredTiming.attackSeconds]]) {
  if (Math.abs(animationReports.find(report => report.name === name)?.seconds - seconds) > 1e-6) throw new Error(`${name} authored timing differs from clip report.`);
}
// Sample the serialized clips through the same four-weight skinning math the
// renderer uses. This catches a named clip whose feet never actually move.
const motionChecks = [];
const sampleTimes = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
const legVertexIds = Object.fromEntries(legs.map(leg => [leg.name, []]));
for (let vertex = 0; vertex < vertexCount; vertex++) for (const leg of legs) {
  let influence = 0;
  for (let slot = 0; slot < 4; slot++) {
    const offset = vertex * 4 + slot;
    if (leg.boneNames.includes(bones[outJoints[offset]].name)) influence += outWeights[offset];
  }
  if (influence > 0.5) legVertexIds[leg.name].push(vertex);
}
for (const leg of legs) if (legVertexIds[leg.name].length < 20) throw new Error(`${leg.name} has too few predominantly weighted vertices.`);
const m = new THREE.Matrix4();
const p = new THREE.Vector3();
const s = new THREE.Vector3(1, 1, 1);
for (const clip of checkRoot.listAnimations()) {
  const channels = clip.listChannels();
  const duration = animationReports.find(report => report.name === clip.getName()).seconds;
  const frames = [];
  for (const normalizedTime of sampleTimes) {
    const seconds = normalizedTime * duration;
    const overrides = new Map();
    for (const channel of channels) {
      const node = channel.getTargetNode();
      const path = channel.getTargetPath();
      const times = channel.getSampler().getInput().getArray();
      const values = channel.getSampler().getOutput().getArray();
      const width = path === 'rotation' ? 4 : 3;
      let a = 0;
      while (a < times.length - 2 && times[a + 1] < seconds) a++;
      const b = Math.min(a + 1, times.length - 1);
      const ratio = times[b] > times[a] ? (seconds - times[a]) / (times[b] - times[a]) : 0;
      let value;
      if (path === 'rotation') {
        const qa = new THREE.Quaternion(...Array.from(values.slice(a * width, a * width + width)));
        const qb = new THREE.Quaternion(...Array.from(values.slice(b * width, b * width + width)));
        value = qa.slerp(qb, ratio);
      } else {
        value = Array.from({ length: width }, (_, axis) => values[a * width + axis] * (1 - ratio) + values[b * width + axis] * ratio);
      }
      const entry = overrides.get(node.getName()) ?? {};
      entry[path] = value;
      overrides.set(node.getName(), entry);
    }
    const worlds = new Map();
    for (const bone of bones) {
      const change = overrides.get(bone.name);
      const translation = change?.translation ?? bone.local;
      const rotation = change?.rotation ?? new THREE.Quaternion();
      m.compose(p.fromArray(translation), rotation, s);
      worlds.set(bone.name, bone.parent ? worlds.get(bone.parent).clone().multiply(m) : m.clone());
    }
    const skinMatrices = bones.map(bone => worlds.get(bone.name).clone().multiply(
      new THREE.Matrix4().makeTranslation(-bone.p[0], -bone.p[1], -bone.p[2])));
    let minY = Infinity;
    const legCenters = Object.fromEntries(legs.map(leg => [leg.name, { x: 0, y: 0, z: 0, mass: 0 }]));
    const posedPositions = new Float32Array(vertexCount * 3);
    let bodyY = 0, bodyMass = 0;
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const base = vertex * 3;
      const x = positions[base], y = positions[base + 1], z = positions[base + 2];
      let dx = 0, dy = 0, dz = 0;
      for (let slot = 0; slot < 4; slot++) {
        const offset = vertex * 4 + slot;
        const weight = outWeights[offset];
        if (!weight) continue;
        const elements = skinMatrices[outJoints[offset]].elements;
        dx += weight * (elements[0] * x + elements[4] * y + elements[8] * z + elements[12]);
        dy += weight * (elements[1] * x + elements[5] * y + elements[9] * z + elements[13]);
        dz += weight * (elements[2] * x + elements[6] * y + elements[10] * z + elements[14]);
      }
      dx *= sceneScale; dy *= sceneScale; dz *= sceneScale;
      posedPositions[base] = dx; posedPositions[base + 1] = dy; posedPositions[base + 2] = dz;
      minY = Math.min(minY, dy);
      for (const leg of legs) {
        let legWeight = 0;
        for (let slot = 0; slot < 4; slot++) {
          const offset = vertex * 4 + slot;
          if (leg.boneNames.includes(bones[outJoints[offset]].name)) legWeight += outWeights[offset];
        }
        if (legWeight > 0.5) {
          const center = legCenters[leg.name];
          center.x += dx * legWeight; center.y += dy * legWeight; center.z += dz * legWeight; center.mass += legWeight;
        }
      }
      const bodyWeight = outWeights[vertex * 4 + 0] * (bones[outJoints[vertex * 4 + 0]].name === 'BodyCore');
      if (bodyWeight > 0.5) { bodyY += dy * bodyWeight; bodyMass += bodyWeight; }
    }
    for (const center of Object.values(legCenters)) {
      center.x /= center.mass; center.y /= center.mass; center.z /= center.mass;
    }
    frames.push({ minY, legCenters, bodyY: bodyY / bodyMass, posedPositions });
  }
  const legExcursions = Object.fromEntries(legs.map(leg => {
    const first = frames[0].legCenters[leg.name];
    return [leg.name, Math.max(...frames.map(frame => {
      const now = frame.legCenters[leg.name];
      return Math.hypot(now.x - first.x, now.y - first.y, now.z - first.z);
    }))];
  }));
  const minFloor = Math.min(...frames.map(frame => frame.minY));
  const bodyVerticalRange = Math.max(...frames.map(frame => frame.bodyY)) - Math.min(...frames.map(frame => frame.bodyY));
  const weightedVertexMotion = Object.fromEntries(legs.map(leg => {
    const ids = legVertexIds[leg.name];
    const excursions = ids.map(vertex => {
      const base = vertex * 3;
      return Math.max(...frames.map(frame => Math.hypot(
        frame.posedPositions[base] - frames[0].posedPositions[base],
        frame.posedPositions[base + 1] - frames[0].posedPositions[base + 1],
        frame.posedPositions[base + 2] - frames[0].posedPositions[base + 2])));
    });
    return [leg.name, { vertices: ids.length, maximumMeters: Math.max(...excursions), meanMeters: excursions.reduce((sum, value) => sum + value, 0) / excursions.length, movingOver2cm: excursions.filter(value => value > .02).length }];
  }));
  if (['Walk', 'Run'].includes(clip.getName()) && Object.values(weightedVertexMotion).some(item => item.meanMeters < .02 || item.movingOver2cm < item.vertices * .6)) {
    throw new Error(`${clip.getName()} has a visually static weighted leg group: ${JSON.stringify(weightedVertexMotion)}`);
  }
  if (['Walk', 'Run'].includes(clip.getName()) && Object.values(legExcursions).some(value => !(value > 0.005))) {
    throw new Error(`${clip.getName()} has a non-articulating leg: ${JSON.stringify(legExcursions)}`);
  }
  if (minFloor < -0.04) {
    throw new Error(`${clip.getName()} sinks ${(-minFloor).toFixed(3)} m below the floor.`);
  }
  motionChecks.push({ clip: clip.getName(), minFloor, floorSamples: frames.map(frame => frame.minY), bodyVerticalRange, legExcursions, weightedVertexMotion });
}
const validation = {
  sourcePositionsNormalsUvsIndicesPreserved: true,
  sourceVertices: vertexCount,
  sourceTriangles: triangleCount,
  sourceWeightBone0Fraction: sourceBone0Fraction,
  normalizedFourSlotWeights: true,
  maxWeightSumError: roundTripMaxWeightError,
  distributedVertices,
  activeJointVertexCounts: Object.fromEntries(bones.map((bone, index) => [bone.name, influenceVertexCounts[index]])),
  activeJointWeightMass: Object.fromEntries(bones.map((bone, index) => [bone.name, Number(weightedJointMass[index].toFixed(5))])),
  clips: animationReports,
  runtimeMapsAll2K: textureReports.every(item => item.width === 2048 && item.height === 2048),
  serializedJointOrderMatchesRig: true,
  sceneScale,
  motionChecks,
};
const catalog = {
  schema: 'corealm-creature-native-rig-candidate/1',
  id: 'creature_boss_tempest_roc',
  displayName: 'Storm Scarab',
  status: 'awaiting-root-lab-review',
  accepted: false,
  source: {
    file: relative(sourcePath),
    sha256: sourceSha256,
    bytes: sourceBytes.length,
    modelId: expected.modelId,
    batchId: 'flint-mandible',
    sourceImage: relative(referencePath),
    sourceImageId: expected.sourceImageId,
    sourceImageSha256: referenceSha256,
    sourceAudit: { verdict: 'approved-for-flint-mandible', stormScarabFit: 'pending-root-review' },
    imageApproval: { verdict: 'approved-for-flint-mandible', stormScarabFit: 'pending-root-review', sourceReferencePinned: true },
    topology: { vertices: vertexCount, triangles: triangleCount, retopology: false },
    originalRig: { skinJoints: expected.sourceJoints, clips: 0, bone0WeightFraction: sourceBone0Fraction, restTransforms: 'identity' },
    sourceMaterial: { name: sourceMaterialName, baseColorMap: '8192x8192', metallicRoughnessMap: false, normalMap: false, occlusionMap: false, sha256: sourceBaseSha256 },
  },
  candidate: {
    file: path.basename(outputPath),
    sha256: candidateSha256,
    bytes: candidateBytes.length,
    vertices: vertexCount,
    triangles: triangleCount,
    bounds,
    size: { x: size[0], y: size[1], z: size[2] },
    groundY: bounds.min[1],
    ...authoredTiming,
    gaitCalibration: { status: 'pending-world-speed-fit', impliedWalkMps: null, impliedRunMps: null },
    presentation: { sceneScale, suggestedScale, suggestedHeightMeters: size[1] * suggestedScale, role: 'level-23 mid boss, 1.4 meter shell height' },
    rig: {
      type: 'custom six-leg stone beetle',
      jointCount: bones.length,
      boneNames: bones.map(bone => bone.name),
      legPairs: ['Front', 'Middle', 'Rear'],
      basis: 'Y-up, X lateral, +Z toward head and mandible',
      weights: 'Four normalized influences from model-space body regions and nearest six-leg rig segments. Original positions, normals, UVs and indices are retained.',
    },
    textures: textureReports,
    animations: animationReports,
    validation,
  },
  acceptance: {
    imageAudit: false,
    geometryAudit: false,
    textureAudit: false,
    rigAudit: false,
    animationAudit: false,
    rootLabReview: false,
    productionReady: false,
    worldIntegrated: false,
    status: 'pending-root-lab-review',
  },
  notes: [
    'Candidate only. It is not wired to a production manifest or final world.',
    'The approved Tripo source has no packed PBR maps. The original layered 8K stone base color is retained as a 2K runtime albedo; aligned 2K tangent normal and ORM maps are derived from its painted mineral relief.',
    'The source mesh remains the same 2,649 vertices and 4,178 triangles. The unusable identity-rest, bone_0-dominated source skin was replaced with a spatially weighted body and six-leg rig.',
    'The model uses a neutral rough, non-metallic mineral material. The same source is staged for Flint Mandible; species duplication and lack of storm-specific art need root review.',
  ],
};
const catalogPath = path.join(here, 'catalog.json');
const labCatalogPath = path.join(here, 'lab-catalog.json');
const labAsset = {
  id: 'creature_boss_tempest_roc',
  file: path.basename(outputPath),
  pack: 'corealm-tripo-creature-candidates',
  category: 'character',
  is: 'Storm Scarab six-leg stone beetle candidate',
  tags: ['creature', 'boss', 'storm-scarab', 'arthropod', 'mineral-shell', 'six-legged', 'candidate'],
  bytes: candidateBytes.length,
  sha256: candidateSha256,
  size: { x: size[0], y: size[1], z: size[2] },
  ...authoredTiming,
  gaitCalibration: { status: 'pending-world-speed-fit', impliedWalkMps: null, impliedRunMps: null },
  presentation: { sceneScale, suggestedScale, suggestedHeightMeters: size[1] * suggestedScale },
  base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] },
  bounds,
  groundY: bounds.min[1],
  triangles: triangleCount,
  animations: animationReports.map(report => report.name),
  materials: ['animal_storm_scarab_fangstone'],
  sourceProvenance: {
    author: 'Corealm candidate rig reconstruction',
    batchId: 'flint-mandible',
    modelId: expected.modelId,
    sourceImageId: expected.sourceImageId,
    sourceFile: relative(sourcePath),
    sourceSha256,
    sourceImage: relative(referencePath),
    sourceImageSha256: referenceSha256,
    candidateFile: path.basename(outputPath),
    candidateSha256,
    candidateStatus: 'awaiting-root-lab-review',
  },
  acceptance: { assetAudit: false, labAccepted: false, worldIntegrated: false },
};
await Promise.all([
  writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`),
  writeFile(labCatalogPath, `${JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', assets: [labAsset], files: { creature_boss_tempest_roc: path.basename(outputPath) } }, null, 2)}\n`),
]);
console.log(JSON.stringify({ candidate: relative(outputPath), sha256: candidateSha256, bytes: candidateBytes.length, vertices: vertexCount, triangles: triangleCount, joints: bones.length, distributedVertices, textures: textureReports, animations: animationReports, validation }, null, 2));
