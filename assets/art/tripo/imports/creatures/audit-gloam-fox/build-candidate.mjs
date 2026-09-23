import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import * as THREE from 'three';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ownerDir = 'assets/art/tripo/imports/creatures/audit-gloam-fox';
const srcPath = `${ownerDir}/source-preview.glb`;
const outPath = `${ownerDir}/field-jackal-native-rig-candidate.glb`;
const sourceBytes = await readFile(srcPath);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder});
const doc = await io.read(srcPath);
const root = doc.getRoot();
const primitive = root.listMeshes()[0]?.listPrimitives()[0];
if (!primitive) throw new Error('Expected one source mesh primitive.');
const sourceMesh = root.listMeshes()[0];
const meshNode = root.listNodes().find(node => node.getMesh() === sourceMesh);
if (!meshNode) throw new Error('Cannot locate source mesh node.');
const rigContainer = meshNode.getParentNode();
if (!rigContainer) throw new Error('Source mesh has no root container.');

const positions = primitive.getAttribute('POSITION')?.getArray();
const indices = primitive.getIndices()?.getArray();
if (!(positions instanceof Float32Array) || !indices) throw new Error('Expected float positions and indexed mesh.');
const sourceVertexCount = positions.length / 3;
const sourceTriangleCount = indices.length / 3;
if (sourceVertexCount !== 2818 || sourceTriangleCount !== 3997) {
  throw new Error(`Source topology drifted: ${sourceVertexCount} vertices, ${sourceTriangleCount} triangles.`);
}

// Source points diagonally through X/Z. This rigid turn puts its muzzle on +Z.
// Original triangles, UVs, material, and image-generated coat map are retained.
const yaw = 0.76, c = Math.cos(yaw), s = Math.sin(yaw);
for (let i = 0; i < positions.length; i += 3) {
  const x = positions[i], z = positions[i + 2];
  positions[i] = c * x - s * z + 0.15;
  positions[i + 2] = s * x + c * z;
}
const normals = primitive.getAttribute('NORMAL')?.getArray();
if (normals) for (let i = 0; i < normals.length; i += 3) {
  const x = normals[i], z = normals[i + 2];
  normals[i] = c * x - s * z;
  normals[i + 2] = s * x + c * z;
}
const rotatedSourcePositions = new Float32Array(positions);
const bones = [
  { name: 'JackalRoot', parent: null, p: [0, 0, 0], sigma: 1 },
  { name: 'Pelvis', parent: 'JackalRoot', p: [0, 0.58, -0.28], sigma: 0.17, group: 'body' },
  { name: 'SpineMid', parent: 'Pelvis', p: [0, 0.61, -0.05], sigma: 0.17, group: 'body' },
  { name: 'Chest', parent: 'SpineMid', p: [0, 0.66, 0.19], sigma: 0.16, group: 'body' },
  { name: 'Neck', parent: 'Chest', p: [0, 0.75, 0.28], sigma: 0.13, group: 'body' },
  { name: 'Head', parent: 'Neck', p: [0, 0.84, 0.34], sigma: 0.13, group: 'body' },
  { name: 'TailBase', parent: 'Pelvis', p: [0.04, 0.58, -0.38], sigma: 0.105, group: 'tail' },
  { name: 'TailMid', parent: 'TailBase', p: [0.07, 0.39, -0.51], sigma: 0.105, group: 'tail' },
  { name: 'TailEnd', parent: 'TailMid', p: [0.22, 0.20, -0.35], sigma: 0.09, group: 'tail' },
  { name: 'TailTip', parent: 'TailEnd', p: [0.42, 0.18, -0.29], sigma: 0.075, group: 'tail' },
  { name: 'ForeUpper_L', parent: 'Chest', p: [-0.08, 0.54, 0.26], sigma: 0.10, group: 'foreL' },
  { name: 'ForeLower_L', parent: 'ForeUpper_L', p: [-0.09, 0.36, 0.19], sigma: 0.085, group: 'foreL' },
  { name: 'ForeWrist_L', parent: 'ForeLower_L', p: [-0.09, 0.13, 0.23], sigma: 0.070, group: 'foreL' },
  { name: 'ForePaw_L', parent: 'ForeWrist_L', p: [-0.09, 0.055, 0.26], sigma: 0.065, group: 'foreL' },
  { name: 'ForeUpper_R', parent: 'Chest', p: [0.08, 0.54, 0.25], sigma: 0.10, group: 'foreR' },
  { name: 'ForeLower_R', parent: 'ForeUpper_R', p: [0.08, 0.35, 0.17], sigma: 0.085, group: 'foreR' },
  { name: 'ForeWrist_R', parent: 'ForeLower_R', p: [0.08, 0.13, 0.20], sigma: 0.070, group: 'foreR' },
  { name: 'ForePaw_R', parent: 'ForeWrist_R', p: [0.09, 0.055, 0.23], sigma: 0.065, group: 'foreR' },
  { name: 'HindUpper_L', parent: 'Pelvis', p: [-0.09, 0.54, -0.28], sigma: 0.11, group: 'hindL' },
  { name: 'HindLower_L', parent: 'HindUpper_L', p: [-0.08, 0.36, -0.22], sigma: 0.09, group: 'hindL' },
  { name: 'HindHock_L', parent: 'HindLower_L', p: [-0.09, 0.20, -0.36], sigma: 0.08, group: 'hindL' },
  { name: 'HindPaw_L', parent: 'HindHock_L', p: [-0.08, 0.05, -0.33], sigma: 0.07, group: 'hindL' },
  { name: 'HindUpper_R', parent: 'Pelvis', p: [0.10, 0.54, -0.28], sigma: 0.11, group: 'hindR' },
  { name: 'HindLower_R', parent: 'HindUpper_R', p: [0.12, 0.36, -0.22], sigma: 0.09, group: 'hindR' },
  { name: 'HindHock_R', parent: 'HindLower_R', p: [0.16, 0.20, -0.35], sigma: 0.08, group: 'hindR' },
  { name: 'HindPaw_R', parent: 'HindHock_R', p: [0.20, 0.05, -0.33], sigma: 0.07, group: 'hindR' },
];
const boneIndex = new Map(bones.map((bone, index) => [bone.name, index]));
for (const bone of bones) {
  const parent = bone.parent ? bones[boneIndex.get(bone.parent)] : null;
  bone.local = parent ? bone.p.map((component, axis) => component - parent.p[axis]) : bone.p;
}

// Detach the bad Tripo rig but preserve the original mesh, UVs, normals, indices and material.
const sourceSkin = meshNode.getSkin();
primitive.setAttribute('JOINTS_0', null);
primitive.setAttribute('WEIGHTS_0', null);
meshNode.setSkin(null);
for (const child of rigContainer.listChildren()) rigContainer.removeChild(child);
if (sourceSkin) sourceSkin.dispose();
meshNode.setName('FieldJackalMesh');
rigContainer.setName('FieldJackalRigContainer').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
rigContainer.addChild(meshNode);

const nodes = new Map();
for (const bone of bones) {
  const node = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  nodes.set(bone.name, node);
  const parent = bone.parent ? nodes.get(bone.parent) : rigContainer;
  parent.addChild(node);
}
const skin = doc.createSkin('FieldJackal_Quadruped').setSkeleton(nodes.get('JackalRoot'));
for (const bone of bones) skin.addJoint(nodes.get(bone.name));
const inverseBind = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i++) {
  const [x, y, z] = bones[i].p;
  inverseBind.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
}
const buffer = root.listBuffers()[0];
const bindAccessor = doc.createAccessor('FieldJackal_InverseBindMatrices').setArray(inverseBind).setType(Accessor.Type.MAT4).setBuffer(buffer);
skin.setInverseBindMatrices(bindAccessor);
meshNode.setSkin(skin);

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const allLegGroups = ['foreL', 'foreR', 'hindL', 'hindR'];
const jointValues = new Uint16Array(sourceVertexCount * 4);
const weightValues = new Float32Array(sourceVertexCount * 4);
const influences = new Uint32Array(bones.length);
let minWeights = Infinity;
let maxWeights = 0;
for (let vertex = 0; vertex < sourceVertexCount; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const [x, y, z] = point;
  const allowed = new Set(['body']);
  if (z < -0.35 && y < 0.60 && x > 0.01) allowed.add('tail');
  if (y < 0.66) {
    const group = (z > -0.02 ? 'fore' : 'hind') + (x < 0 ? 'L' : 'R');
    const limb = bones.filter(bone => bone.group === group);
    const nearest = Math.min(...limb.map(bone => dist3(point, bone.p)));
    if (nearest < 0.17) allowed.add(group);
  }
  const candidates = [];
  for (let i = 1; i < bones.length; i++) {
    const bone = bones[i];
    if (!allowed.has(bone.group)) continue;
    const d = dist3(point, bone.p);
    const score = Math.exp(-0.5 * (d / bone.sigma) ** 2);
    if (score > 1e-10) candidates.push({ index: i, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 4);
  if (!chosen.length) throw new Error(`No anatomical influence for vertex ${vertex}.`);
  const total = chosen.reduce((sum, item) => sum + item.score, 0);
  let normalized = 0;
  for (let slot = 0; slot < chosen.length; slot++) {
    const item = chosen[slot];
    const weight = slot === chosen.length - 1 ? 1 - normalized : item.score / total;
    jointValues[vertex * 4 + slot] = item.index;
    weightValues[vertex * 4 + slot] = weight;
    normalized += weight;
    influences[item.index]++;
  }
  const sum = weightValues[vertex * 4] + weightValues[vertex * 4 + 1] + weightValues[vertex * 4 + 2] + weightValues[vertex * 4 + 3];
  minWeights = Math.min(minWeights, Math.abs(sum - 1));
  maxWeights = Math.max(maxWeights, Math.abs(sum - 1));
}
primitive.setAttribute('JOINTS_0', doc.createAccessor('FieldJackal_Joints0').setArray(jointValues).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('FieldJackal_Weights0').setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(buffer));

function quat(axis, angle) {
  const s = Math.sin(angle / 2), c = Math.cos(angle / 2);
  if (axis === 'x') return [s, 0, 0, c];
  if (axis === 'y') return [0, s, 0, c];
  return [0, 0, s, c];
}
function addTrack(clip, nodeName, pathName, times, values, type) {
  const input = doc.createAccessor(`${clip.name}_${nodeName}_${pathName}_time`).setArray(new Float32Array(times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);
  const output = doc.createAccessor(`${clip.name}_${nodeName}_${pathName}_value`).setArray(new Float32Array(values.flat())).setType(type).setBuffer(buffer);
  const sampler = doc.createAnimationSampler(`${clip.name}_${nodeName}_${pathName}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
  const channel = doc.createAnimationChannel(`${nodeName}_${pathName}`).setTargetNode(nodes.get(nodeName)).setTargetPath(pathName).setSampler(sampler);
  clip.animation.addSampler(sampler).addChannel(channel);
  clip.trackMap.push({ node: nodeName, path: pathName, times: [...times], values: values.map(value => [...value]) });
}
const clips = [];
function clip(name, duration, times, trackDefinitions) {
  const animation = doc.createAnimation(name);
  const record = { name, duration, animation, trackMap: [] };
  for (const track of trackDefinitions) addTrack(record, track.node, track.path ?? 'rotation', times, track.values, track.type ?? Accessor.Type.VEC4);
  clips.push(record);
  return record;
}
const loopAngles = (amplitude, phase, values = [0, 1, 0, -1, 0]) => values.map(v => quat('x', Math.sin((phase + v * 0.25) * Math.PI * 2) * amplitude));
const gaitTimes = [0, 0.25, 0.5, 0.75, 1];
clip('Idle', 3.0, [0, 0.75, 1.5, 2.25, 3.0], [
  { node: 'SpineMid', values: [quat('x', 0), quat('x', 0.012), quat('x', 0), quat('x', -0.012), quat('x', 0)] },
  { node: 'Neck', values: [quat('x', 0), quat('x', -0.018), quat('x', 0), quat('x', 0.012), quat('x', 0)] },
  { node: 'TailMid', values: [quat('y', -0.055), quat('y', 0), quat('y', 0.055), quat('y', 0), quat('y', -0.055)] },
  { node: 'TailTip', values: [quat('y', 0.025), quat('y', -0.025), quat('y', 0.025), quat('y', -0.025), quat('y', 0.025)] },
]);
const walkTracks = [];
for (const [group, phase] of [['foreL', 0], ['foreR', 0.5], ['hindL', 0.5], ['hindR', 0]]) {
  const suffix = group.endsWith('L') ? '_L' : '_R';
  const swing = [-1, 0, 1, 0, -1].map(value => value);
  for (const limb of bones.filter(bone => bone.group === group)) {
    const ordinal = Number(limb.name.match(/_(\d+)$/)?.[1] ?? 0);
    const upper = limb.name.includes('Upper');
    const lower = limb.name.includes('Lower') || limb.name.includes('Hock');
    if (upper) walkTracks.push({ node: limb.name, values: loopAngles(group.startsWith('fore') ? 0.34 : 0.42, phase, swing) });
    else if (lower) walkTracks.push({ node: limb.name, values: swing.map(value => quat('x', -Math.max(0, value) * 0.32 + Math.min(0, value) * 0.12)) });
  }
}
for (const side of ['L', 'R']) walkTracks.push({ node: `ForePaw_${side}`, values: gaitTimes.map((_, i) => quat('x', [0, -0.08, 0, 0.08, 0][i])) });
walkTracks.push({ node: 'SpineMid', values: [0, 0.25, 0.5, 0.75, 1].map(v => quat('x', Math.sin(v * Math.PI * 2) * 0.018)) });
walkTracks.push({ node: 'TailMid', values: [quat('y', -0.06), quat('y', 0), quat('y', 0.06), quat('y', 0), quat('y', -0.06)] });
clip('Walk', 1.15, gaitTimes.map(t => t * 1.15), walkTracks);
const runTracks = [];
for (const [group, phase] of [['foreL', 0], ['foreR', 0.03], ['hindL', 0.48], ['hindR', 0.52]]) {
  for (const limb of bones.filter(bone => bone.group === group)) {
    const upper = limb.name.includes('Upper');
    const lower = limb.name.includes('Lower') || limb.name.includes('Hock');
    const phaseSamples = gaitTimes.map(t => Math.sin((t + phase) * Math.PI * 2));
    if (upper) runTracks.push({ node: limb.name, values: phaseSamples.map(value => quat('x', value * (group.startsWith('fore') ? 0.70 : 0.78))) });
    else if (lower) runTracks.push({ node: limb.name, values: phaseSamples.map(value => quat('x', -Math.max(0, value) * 0.62)) });
  }
  const side = group.endsWith('L') ? 'L' : 'R';
  runTracks.push({ node: `${group.startsWith('fore') ? 'ForePaw' : 'HindPaw'}_${side}`, values: gaitTimes.map(t => quat('x', Math.sin((t + phase) * Math.PI * 2) * 0.12)) });
}
runTracks.push({ node: 'SpineMid', values: [0, 0.25, 0.5, 0.75, 1].map(v => quat('x', 0.035 + Math.sin(v * Math.PI * 2) * 0.035)) });
runTracks.push({ node: 'TailBase', values: gaitTimes.map(t => quat('x', -0.06 + Math.sin(t * Math.PI * 2) * 0.08)) });
clip('Run', 0.78, gaitTimes.map(t => t * 0.78), runTracks);
clip('Attack', 0.82, [0, 0.24, 0.50, 0.82], [
  { node: 'JackalRoot', path: 'translation', type: Accessor.Type.VEC3, values: [[0,0,0], [0,0,0.025], [0,0,0.085], [0,0,0]] },
  { node: 'Neck', values: [quat('x', 0), quat('x', 0.10), quat('x', 0.24), quat('x', 0)] },
  { node: 'Head', values: [quat('x', 0), quat('x', 0.14), quat('x', 0.30), quat('x', 0)] },
  { node: 'ForeUpper_L', values: [quat('x', 0), quat('x', -0.06), quat('x', -0.16), quat('x', 0)] },
  { node: 'ForeUpper_R', values: [quat('x', 0), quat('x', -0.06), quat('x', -0.16), quat('x', 0)] },
  { node: 'TailBase', values: [quat('x', 0), quat('x', 0.06), quat('x', 0.10), quat('x', 0)] },
]);
clip('Hit', 0.42, [0, 0.08, 0.19, 0.42], [
  { node: 'JackalRoot', path: 'translation', type: Accessor.Type.VEC3, values: [[0,0,0], [0,0,-0.045], [0,0,-0.015], [0,0,0]] },
  { node: 'SpineMid', values: [quat('x', 0), quat('x', -0.24), quat('x', 0.08), quat('x', 0)] },
  { node: 'Neck', values: [quat('x', 0), quat('x', -0.20), quat('x', 0.06), quat('x', 0)] },
  { node: 'Head', values: [quat('x', 0), quat('x', -0.16), quat('x', 0.05), quat('x', 0)] },
  { node: 'TailMid', values: [quat('y', 0), quat('y', 0.24), quat('y', -0.08), quat('y', 0)] },
]);
clip('Death', 1.55, [0, 0.25, 0.70, 1.15, 1.55], [
  { node: 'JackalRoot', path: 'translation', type: Accessor.Type.VEC3, values: [[0,0,0], [0,0.055,0], [0,0.23,0], [0,0.36,0], [0,0.36,0]] },
  { node: 'JackalRoot', path: 'rotation', values: [quat('z',0), quat('z',-0.13), quat('z',-0.75), quat('z',-1.30), quat('z',-1.30)] },
  { node: 'SpineMid', values: [quat('x', 0), quat('x', 0.12), quat('x', 0.27), quat('x', 0.31), quat('x', 0.31)] },
  { node: 'Chest', values: [quat('x', 0), quat('x', 0.10), quat('x', 0.22), quat('x', 0.25), quat('x', 0.25)] },
  { node: 'Neck', values: [quat('x', 0), quat('x', 0.20), quat('x', 0.42), quat('x', 0.48), quat('x', 0.48)] },
  { node: 'Head', values: [quat('x', 0), quat('x', 0.18), quat('x', 0.34), quat('x', 0.38), quat('x', 0.38)] },
  { node: 'ForeUpper_L', values: [quat('x', 0), quat('x', -0.12), quat('x', -0.38), quat('x', -0.42), quat('x', -0.42)] },
  { node: 'ForeUpper_R', values: [quat('x', 0), quat('x', -0.12), quat('x', -0.38), quat('x', -0.42), quat('x', -0.42)] },
  { node: 'ForeLower_L', values: [quat('x', 0), quat('x', 0.16), quat('x', 0.54), quat('x', 0.54), quat('x', 0.54)] },
  { node: 'ForeLower_R', values: [quat('x', 0), quat('x', 0.16), quat('x', 0.54), quat('x', 0.54), quat('x', 0.54)] },
  { node: 'HindUpper_L', values: [quat('x', 0), quat('x', 0.08), quat('x', 0.30), quat('x', 0.30), quat('x', 0.30)] },
  { node: 'HindUpper_R', values: [quat('x', 0), quat('x', 0.08), quat('x', 0.30), quat('x', 0.30), quat('x', 0.30)] },
  { node: 'HindLower_L', values: [quat('x', 0), quat('x', -0.20), quat('x', -0.48), quat('x', -0.48), quat('x', -0.48)] },
  { node: 'HindLower_R', values: [quat('x', 0), quat('x', -0.20), quat('x', -0.48), quat('x', -0.48), quat('x', -0.48)] },
  { node: 'TailBase', values: [quat('x', 0), quat('x', 0.12), quat('x', 0.20), quat('x', 0.20), quat('x', 0.20)] },
]);

// Runtime maps are 2K. The coat uses Lanczos; packed linear PBR data uses box averaging;
// normal vectors are averaged and renormalized after a box reduction to avoid invalid normals.
const textureMetrics = [];
const sourceTextureMetrics = await Promise.all(root.listTextures().map(async texture => {
  const image = texture.getImage();
  const metadata = await sharp(image).metadata();
  return { name: texture.getName(), role: texture === root.listMaterials()[0].getBaseColorTexture() ? 'base color' : texture === root.listMaterials()[0].getMetallicRoughnessTexture() ? 'packed metallic-roughness' : texture === root.listMaterials()[0].getNormalTexture() ? 'normal' : 'other', dimensions: [metadata.width, metadata.height], mime: texture.getMimeType(), sha256: createHash('sha256').update(image).digest('hex') };
}));
async function reduceDataMap(encoded, renormalizeNormals) {
  const { data, info } = await sharp(encoded).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3 || info.width !== info.height || info.width !== 4096) {
    throw new Error(`Expected a 4096x4096 RGB PBR map, got ${info.width}x${info.height}x${info.channels}.`);
  }
  const output = Buffer.alloc(2048 * 2048 * 3);
  for (let y = 0; y < 2048; y++) for (let x = 0; x < 2048; x++) {
    const out = (y * 2048 + x) * 3;
    const a = ((y * 2) * 4096 + x * 2) * 3;
    const b = a + 3;
    const c = a + 4096 * 3;
    const d = c + 3;
    let red = (data[a] + data[b] + data[c] + data[d]) / 4;
    let green = (data[a + 1] + data[b + 1] + data[c + 1] + data[d + 1]) / 4;
    let blue = (data[a + 2] + data[b + 2] + data[c + 2] + data[d + 2]) / 4;
    if (renormalizeNormals) {
      let nx = red / 127.5 - 1, ny = green / 127.5 - 1, nz = blue / 127.5 - 1;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length; ny /= length; nz /= length;
      red = (nx + 1) * 127.5; green = (ny + 1) * 127.5; blue = (nz + 1) * 127.5;
    }
    output[out] = Math.round(red); output[out + 1] = Math.round(green); output[out + 2] = Math.round(blue);
  }
  return output;
}
for (const texture of root.listTextures()) {
  const encoded = texture.getImage();
  if (!encoded) continue;
  const originalMeta = await sharp(encoded).metadata();
  if (!originalMeta.width || !originalMeta.height) throw new Error(`Cannot read texture dimensions for ${texture.getName()}.`);
  if (originalMeta.width <= 2048 && originalMeta.height <= 2048) continue;
  const isNormal = texture === root.listMaterials()[0].getNormalTexture();
  const isPacked = texture === root.listMaterials()[0].getMetallicRoughnessTexture();
  if (isNormal) {
    const output = await reduceDataMap(encoded, true);
    texture.setImage(await sharp(output, { raw: { width: 2048, height: 2048, channels: 3 } }).jpeg({ quality: 96, chromaSubsampling: '4:4:4' }).toBuffer());
  } else if (isPacked) {
    const output = await reduceDataMap(encoded, false);
    texture.setImage(await sharp(output, { raw: { width: 2048, height: 2048, channels: 3 } }).png().toBuffer());
  } else {
    texture.setImage(await sharp(encoded).resize({ width: 2048, height: 2048, kernel: 'lanczos3' }).jpeg({ quality: 91, mozjpeg: true }).toBuffer());
  }
  const finalMeta = await sharp(texture.getImage()).metadata();
  textureMetrics.push({ name: texture.getName(), role: isNormal ? 'normal-renormalized' : isPacked ? 'packed-metallic-roughness-box-filtered' : 'base-color-lanczos', original: [originalMeta.width, originalMeta.height], runtime: [finalMeta.width, finalMeta.height], mime: texture.getMimeType(), bytes: texture.getImage().length });
}

const outputBytes = await io.writeBinary(doc);
await writeFile(outPath, outputBytes);
const outputSha256 = createHash('sha256').update(outputBytes).digest('hex');
const validation = await validateCandidate(outPath, {sourceTriangleCount, sourceVertexCount, sourcePositions: rotatedSourcePositions, sourceIndices: indices, bones, boneIndex, influences, clips, minWeights, maxWeights});
const report = {
  schema: 'corealm-creature-native-rig-candidate/1',
  id: 'creature_gloam_fox',
  status: 'root-lab-geometry-reviewed-contact-pending',
  accepted: false,
  source: { file: 'source-preview.glb', sha256: sourceSha256, bytes: sourceBytes.length, vertices: sourceVertexCount, triangles: sourceTriangleCount, sourceModelId: '4ab4ccdd-3722-45bf-8686-b6af44cb6d06', generator: 'Tripo Smart Mesh', observedIdentity: 'golden horned jackal/wolf, not a fox', geometryPreservedAfterRigidOrientation: true, textures: sourceTextureMetrics, existingTripoSkinDiscarded: true },
  candidate: { file: 'field-jackal-native-rig-candidate.glb', sha256: outputSha256, bytes: outputBytes.length, vertices: sourceVertexCount, triangles: sourceTriangleCount, joints: bones.map((bone, index) => ({ name: bone.name, index, parent: bone.parent, restPosition: bone.p })), maps: textureMetrics, clips: clips.map(clip => ({ name: clip.name, seconds: clip.duration, channels: clip.trackMap.length })) },
  runtimeTiming: { walkClipSeconds: 1.15, runClipSeconds: 0.78, attackSeconds: 0.82, contactNormalized: 0.5 / 0.82, contactSeconds: 0.5, contactBasis: 'Attack key at 0.50 s: maximum authored forward root reach (0.085 m), head pitch (0.30 rad), and paired foreleg extension (-0.16 rad); clip lasts 0.82 s.' },
  rig: { basis: 'Y-up, +Z toward muzzle after 0.76-radian Y turn; X across shoulders', weightMethod: 'spatially gated anatomical influence fields fitted to source mesh bounds, four normalized influences per vertex; no bone_0 fallback', bind: 'translation-only rest matrices from the authored joint hierarchy; inverse bind matrices computed from those joint rest positions' },
  validation,
};
await writeFile(`${ownerDir}/catalog.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({candidate: outPath, bytes: outputBytes.length, sha256: outputSha256, validation}, null, 2));

async function validateCandidate(file, ctx) {
  const checkDoc = await io.read(file);
  const r = checkDoc.getRoot();
  const p = r.listMeshes()[0].listPrimitives()[0];
  const pos = p.getAttribute('POSITION')?.getArray();
  const idx = p.getIndices()?.getArray();
  const joints = p.getAttribute('JOINTS_0')?.getArray();
  const weights = p.getAttribute('WEIGHTS_0')?.getArray();
  const skins = r.listSkins();
  const anims = r.listAnimations();
  if (!pos || !idx || !joints || !weights || skins.length !== 1) throw new Error('Candidate is missing required mesh or skin data.');
  if (idx.length / 3 !== ctx.sourceTriangleCount || pos.length / 3 !== ctx.sourceVertexCount) throw new Error('Topology count changed during export.');
  let maxPositionDelta = 0, maxIndexMismatch = 0;
  for (let i = 0; i < pos.length; i++) maxPositionDelta = Math.max(maxPositionDelta, Math.abs(pos[i] - ctx.sourcePositions[i]));
  for (let i = 0; i < idx.length; i++) if (idx[i] !== ctx.sourceIndices[i]) maxIndexMismatch++;
  let maxWeightSumError = 0, minNonzeroWeight = 1, maxJointIndex = 0, verticesWithTwoOrMoreInfluences = 0;
  for (let vertex = 0; vertex < pos.length / 3; vertex++) {
    let sum = 0, n = 0;
    for (let slot = 0; slot < 4; slot++) {
      const j = joints[vertex * 4 + slot], w = weights[vertex * 4 + slot];
      if (!Number.isInteger(j) || j < 0 || j >= skins[0].listJoints().length || !Number.isFinite(w) || w < -1e-7 || w > 1.00001) throw new Error(`Invalid joint weight at vertex ${vertex}, slot ${slot}.`);
      maxJointIndex = Math.max(maxJointIndex, j);
      if (w > 1e-6) { sum += w; n++; minNonzeroWeight = Math.min(minNonzeroWeight, w); }
    }
    if (Math.abs(sum - 1) > 1e-5) throw new Error(`Weights not normalized at vertex ${vertex}: ${sum}`);
    if (n >= 2) verticesWithTwoOrMoreInfluences++;
    maxWeightSumError = Math.max(maxWeightSumError, Math.abs(sum - 1));
  }
  if (maxPositionDelta > 1e-7 || maxIndexMismatch) throw new Error(`Source geometry changed: max position delta ${maxPositionDelta}, index mismatches ${maxIndexMismatch}.`);
  const ibm = skins[0].getInverseBindMatrices()?.getArray();
  if (!ibm || ibm.length !== skins[0].listJoints().length * 16) throw new Error('Inverse bind matrix count does not match joint count.');
  let minDeterminant = Infinity, maxMatrixError = 0;
  for (let i = 0; i < ibm.length; i += 16) {
    const m = Array.from(ibm.slice(i, i + 16));
    if (m.some(value => !Number.isFinite(value))) throw new Error(`Non-finite inverse bind matrix ${i / 16}.`);
    const det = m[0] * m[5] * m[10] * m[15];
    minDeterminant = Math.min(minDeterminant, Math.abs(det));
    const expected = [1,0,0,0, 0,1,0,0, 0,0,1,0, -ctx.bones[i / 16].p[0], -ctx.bones[i / 16].p[1], -ctx.bones[i / 16].p[2], 1];
    for (let j = 0; j < 16; j++) maxMatrixError = Math.max(maxMatrixError, Math.abs(m[j] - expected[j]));
  }
  if (minDeterminant < 1e-8 || maxMatrixError > 1e-6) throw new Error(`Bind matrices are not finite translation inverses: det ${minDeterminant}, err ${maxMatrixError}.`);
  const animationNames = anims.map(animation => animation.getName());
  const required = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
  if (required.some(name => !animationNames.includes(name))) throw new Error(`Missing required animation: ${required.filter(name => !animationNames.includes(name)).join(', ')}.`);
  let animationSamples = 0;
  const allowedTargets = new Set(skins[0].listJoints());
  const clipReport = [];
  const nodeByName = new Map(r.listNodes().map(node => [node.getName(), node]));
  const meshNodeCheck = [...nodeByName.values()].find(node => node.getMesh() === r.listMeshes()[0]);
  if (!meshNodeCheck) throw new Error('Candidate mesh node missing after export.');
  const inverseBindMatrices = skins[0].listJoints().map((_, index) => new THREE.Matrix4().fromArray(Array.from(ibm.slice(index * 16, index * 16 + 16))));
  const bounds = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
  for (let i = 0; i < pos.length; i += 3) for (let axis = 0; axis < 3; axis++) { bounds[0][axis] = Math.min(bounds[0][axis], pos[i + axis]); bounds[1][axis] = Math.max(bounds[1][axis], pos[i + axis]); }
  const identityPose = new Map();
  const getWorldMatrix = (node, cache, pose) => {
    const cached = cache.get(node);
    if (cached) return cached;
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
  const deformAt = (animation, time) => {
    const pose = new Map(identityPose);
    for (const channel of animation.listChannels()) {
      const node = channel.getTargetNode();
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
        const a = new THREE.Quaternion(start[0], start[1], start[2], start[3]);
        const b = new THREE.Quaternion(end[0], end[1], end[2], end[3]);
        a.slerp(b, alpha).normalize();
        value = [a.x, a.y, a.z, a.w];
      } else value = start.map((component, index) => component + (end[index] - component) * alpha);
      const nodePose = pose.get(node) ?? {};
      nodePose[channel.getTargetPath()] = value;
      pose.set(node, nodePose);
    }
    const cache = new Map();
    const meshWorldInverse = getWorldMatrix(meshNodeCheck, cache, pose).clone().invert();
    const jointMatrices = skins[0].listJoints().map((joint, index) => meshWorldInverse.clone().multiply(getWorldMatrix(joint, cache, pose)).multiply(inverseBindMatrices[index]));
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let maximumDisplacement = 0, displacedVertices = 0;
    const regions = { jawAndHead: { count: 0, forwardSum: 0, maxForward: -Infinity, maxDistance: 0 }, frontLegs: { count: 0, forwardSum: 0, maxForward: -Infinity, maxDistance: 0 } };
    for (let vertex = 0; vertex < pos.length / 3; vertex++) {
      const source = new THREE.Vector3(pos[vertex * 3], pos[vertex * 3 + 1], pos[vertex * 3 + 2]);
      const point = new THREE.Vector3();
      for (let slot = 0; slot < 4; slot++) {
        const joint = joints[vertex * 4 + slot], weight = weights[vertex * 4 + slot];
        point.add(source.clone().applyMatrix4(jointMatrices[joint]).multiplyScalar(weight));
      }
      if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error(`Non-finite skinned vertex at ${animation.getName()}@${time}, vertex ${vertex}.`);
      const delta = point.distanceTo(source);
      const region = source.y > 0.68 && source.z > 0.25 ? regions.jawAndHead : source.y < 0.40 && source.z > 0.05 ? regions.frontLegs : null;
      if (region) {
        region.count++;
        region.forwardSum += point.z - source.z;
        region.maxForward = Math.max(region.maxForward, point.z - source.z);
        region.maxDistance = Math.max(region.maxDistance, delta);
      }
      maximumDisplacement = Math.max(maximumDisplacement, delta);
      if (delta > 1e-4) displacedVertices++;
      min[0] = Math.min(min[0], point.x); min[1] = Math.min(min[1], point.y); min[2] = Math.min(min[2], point.z);
      max[0] = Math.max(max[0], point.x); max[1] = Math.max(max[1], point.y); max[2] = Math.max(max[2], point.z);
    }
    return { time, min, max, maximumDisplacement, displacedVertices, regions: Object.fromEntries(Object.entries(regions).map(([key, value]) => [key, { vertices: value.count, meanForward: value.forwardSum / value.count, maxForward: value.maxForward, maxDistance: value.maxDistance }])) };
  };
  const rest = deformAt({ getName: () => 'Rest', listChannels: () => [] }, 0);
  const restBoundError = Math.max(...rest.min.map((value, axis) => Math.abs(value - bounds[0][axis])), ...rest.max.map((value, axis) => Math.abs(value - bounds[1][axis])));
  if (restBoundError > 1e-5) throw new Error(`Rest skin bounds differ from source geometry by ${restBoundError}.`);
  for (const animation of anims) {
    for (const channel of animation.listChannels()) {
      const sampler = channel.getSampler();
      const input = sampler.getInput()?.getArray();
      const output = sampler.getOutput()?.getArray();
      if (!channel.getTargetNode() || !allowedTargets.has(channel.getTargetNode())) throw new Error(`Animation ${animation.getName()} targets a non-joint.`);
      if (!input || !output || input.length < 2 || input[0] !== 0) throw new Error(`Animation ${animation.getName()} has invalid sampler accessors.`);
      for (let i = 1; i < input.length; i++) if (!(input[i] > input[i - 1])) throw new Error(`Animation ${animation.getName()} has unordered keys.`);
      if (output.some(value => !Number.isFinite(value))) throw new Error(`Animation ${animation.getName()} has non-finite pose data.`);
      const width = channel.getTargetPath() === 'rotation' ? 4 : channel.getTargetPath() === 'translation' ? 3 : channel.getTargetPath() === 'scale' ? 3 : 0;
      if (!width || output.length !== input.length * width) throw new Error(`Animation ${animation.getName()} output cardinality does not match key count.`);
      animationSamples += input.length;
    }
    const sampleTimes = new Set([0]);
    let duration = 0;
    for (const channel of animation.listChannels()) {
      const times = Array.from(channel.getSampler().getInput().getArray());
      duration = Math.max(duration, times.at(-1) ?? 0);
      for (const time of times) sampleTimes.add(time);
    }
    for (const phase of [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]) sampleTimes.add(duration * phase);
    const samples = [...sampleTimes].sort((a, b) => a - b).map(time => deformAt(animation, time));
    const maximumDisplacement = Math.max(...samples.map(sample => sample.maximumDisplacement));
    const maximumDisplacedVertices = Math.max(...samples.map(sample => sample.displacedVertices));
    const sweptBounds = {
      min: [0, 1, 2].map(axis => Math.min(...samples.map(sample => sample.min[axis]))),
      max: [0, 1, 2].map(axis => Math.max(...samples.map(sample => sample.max[axis]))),
    };
    if (!(maximumDisplacement > (animation.getName() === 'Idle' ? 0.001 : 0.005)) || maximumDisplacedVertices < 8) throw new Error(`Animation ${animation.getName()} does not deform a meaningful mesh region.`);
    if (sweptBounds.min[1] < -0.25 || sweptBounds.max[1] > 1.35 || Math.abs(sweptBounds.min[0]) > 1.25 || Math.abs(sweptBounds.max[0]) > 1.25 || Math.abs(sweptBounds.min[2]) > 1.15 || Math.abs(sweptBounds.max[2]) > 1.15) throw new Error(`Animation ${animation.getName()} produces implausible swept bounds: ${JSON.stringify(sweptBounds)}.`);
    const contactSample = animation.getName() === 'Attack' ? samples.find(sample => Math.abs(sample.time - 0.5) < 1e-6) : null;
    clipReport.push({ name: animation.getName(), channels: animation.listChannels().length, sampledPoses: samples.length, maximumVertexDisplacement: Number(maximumDisplacement.toFixed(5)), maximumVerticesMoved: maximumDisplacedVertices, sweptBounds, ...(contactSample ? { contactRegions: contactSample.regions } : {}) });
  }
  return {
    mesh: { vertices: pos.length / 3, triangles: idx.length / 3, sourcePositionMaxDelta: maxPositionDelta, indexMismatches: maxIndexMismatch, restBounds: bounds },
    skin: { joints: skins[0].listJoints().length, maxJointIndex, fourSlotsPerVertex: true, verticesWithMultipleInfluences: verticesWithTwoOrMoreInfluences, maxWeightSumError, minimumNonzeroWeight: minNonzeroWeight, influenceVertexCounts: Array.from(ctx.influences) },
    inverseBind: { count: ibm.length / 16, finiteAndInvertible: true, minimumAbsDeterminant: minDeterminant, maximumTranslationMatrixDelta: maxMatrixError },
    animation: { clips: clipReport, sampledKeyframes: animationSamples, allChannelsTargetRigJoints: true },
    textures: r.listTextures().map(texture => ({ name: texture.getName(), mime: texture.getMimeType(), embeddedBytes: texture.getImage()?.length })),
  };
}



