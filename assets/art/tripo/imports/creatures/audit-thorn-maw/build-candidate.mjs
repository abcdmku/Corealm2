import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { Quaternion, Euler } from 'three';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceFile = path.join(here, 'sources/1ef82040-source.glb');
const outputFile = path.join(here, 'thorn-maw-candidate.glb');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = await readFile(sourceFile);
const sourceSha = sha(sourceBytes);
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const meshNode = root.listNodes().find(node => node.getMesh());
const primitive = meshNode?.getMesh()?.listPrimitives()[0];
if (!scene || !meshNode || !primitive || root.listSkins().length || root.listAnimations().length) throw new Error('Unexpected Thorn Maw source structure.');
const position = primitive.getAttribute('POSITION');
const normal = primitive.getAttribute('NORMAL');
const uv = primitive.getAttribute('TEXCOORD_0');
const indices = primitive.getIndices();
if (position?.getCount() !== 8285 || indices?.getCount() !== 16893 || !normal || !uv) throw new Error('Thorn Maw source topology changed.');
const sourceGeometry = Object.fromEntries([['positions', position], ['normals', normal], ['uv', uv], ['indices', indices]]
  .map(([name, accessor]) => [name, sha(Buffer.from(accessor.getArray().buffer, accessor.getArray().byteOffset, accessor.getArray().byteLength))]));
const material = primitive.getMaterial();
const colorMap = material?.getBaseColorTexture();
if (!colorMap || root.listTextures().length !== 1) throw new Error('Expected the original layered color map.');
const originalImage = colorMap.getImage();
const originalMeta = await sharp(originalImage).metadata();
if (originalMeta.width !== 8192 || originalMeta.height !== 8192) throw new Error('Source color resolution changed.');
const originalImageSha = sha(originalImage);

// Source is Y-up with the four woody feet in the low quadrants. The purple
// corolla rises above the teal bulb; its open mouth faces +Z in the source view.
const bones = [
  ['Root', null, [0, -0.06, 0]],
  ['Bulb', 'Root', [0, -0.05, 0]],
  ['Stalk', 'Bulb', [0, 0.12, 0]],
  ['Maw', 'Stalk', [0, 0.27, 0.05]],
  ['UpperLip', 'Maw', [0, 0.37, 0.19]],
  ['LowerLip', 'Maw', [0, 0.20, 0.20]],
  ['PetalLeft', 'Stalk', [-0.28, 0.02, 0.10]],
  ['PetalRight', 'Stalk', [0.28, 0.02, 0.10]],
  ['FrontLeftRoot', 'Bulb', [-0.18, -0.20, 0.18]],
  ['FrontLeftFoot', 'FrontLeftRoot', [-0.34, -0.42, 0.31]],
  ['FrontRightRoot', 'Bulb', [0.18, -0.20, 0.18]],
  ['FrontRightFoot', 'FrontRightRoot', [0.34, -0.42, 0.31]],
  ['RearLeftRoot', 'Bulb', [-0.18, -0.20, -0.18]],
  ['RearLeftFoot', 'RearLeftRoot', [-0.34, -0.42, -0.31]],
  ['RearRightRoot', 'Bulb', [0.18, -0.20, -0.18]],
  ['RearRightFoot', 'RearRightRoot', [0.34, -0.42, -0.31]],
];
const candidateScale = 1.6;
const groundOffset = 0.499755859375 * candidateScale;
const boneIndex = new Map(bones.map(([name], index) => [name, index]));
const nodeByName = new Map();
for (const [name, parent, point] of bones) {
  const parentPoint = parent ? bones[boneIndex.get(parent)][2] : [0, 0, 0];
  const node = doc.createNode(name).setTranslation(point.map((value, axis) => value - parentPoint[axis]));
  nodeByName.set(name, node);
  (parent ? nodeByName.get(parent) : scene).addChild(node);
}
const skin = doc.createSkin('ThornMaw_Plant').setSkeleton(nodeByName.get('Root'));
for (const [name] of bones) skin.addJoint(nodeByName.get(name));
const bind = new Float32Array(bones.length * 16);
for (let index = 0; index < bones.length; index++) {
  const [x, y, z] = bones[index][2];
  bind.set([1,0,0,0, 0,1,0,0, 0,0,1,0, -x,-y,-z,1], index * 16);
}
const buffer = root.listBuffers()[0];
skin.setInverseBindMatrices(doc.createAccessor('ThornMaw_InverseBind').setArray(bind).setType(Accessor.Type.MAT4).setBuffer(buffer));
meshNode.setSkin(skin);

const smooth = v => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };
const joints = new Uint16Array(position.getCount() * 4);
const weights = new Float32Array(position.getCount() * 4);
const pos = position.getArray();
const influenceCounts = Object.fromEntries(bones.map(([name]) => [name, 0]));
for (let i = 0; i < position.getCount(); i++) {
  const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
  const head = smooth((y - 0.07) / 0.18);
  const leg = smooth((-y - 0.13) / 0.20);
  const scores = [
    ['Bulb', 0.9 * (1 - head) * (1 - leg * 0.8) + 0.01],
    ['Stalk', 0.65 * smooth((y + 0.02) / 0.17) * (1 - head * 0.7)],
    ['Maw', 0.95 * head],
    ['UpperLip', 2.1 * smooth((y - 0.25) / 0.12) * smooth((z + 0.04) / 0.23)],
    ['LowerLip', 2.0 * smooth((y - 0.10) / 0.09) * (1 - smooth((y - 0.27) / 0.09)) * smooth((z + 0.02) / 0.23)],
    ['PetalLeft', 0.6 * smooth((-x - 0.17) / 0.15) * smooth((y + 0.19) / 0.20) * (1 - smooth((y - 0.20) / 0.13))],
    ['PetalRight', 0.6 * smooth((x - 0.17) / 0.15) * smooth((y + 0.19) / 0.20) * (1 - smooth((y - 0.20) / 0.13))],
  ];
  for (const [label, sx, sz] of [['FrontLeft', -1, 1], ['FrontRight', 1, 1], ['RearLeft', -1, -1], ['RearRight', 1, -1]]) {
    const gate = smooth((sx * x + 0.04) / 0.23) * smooth((sz * z + 0.04) / 0.23) * leg;
    scores.push([`${label}Root`, gate * (0.9 - 0.55 * smooth((-y - 0.32) / 0.12))]);
    scores.push([`${label}Foot`, gate * 0.95 * smooth((-y - 0.26) / 0.18)]);
  }
  scores.sort((a, b) => b[1] - a[1]);
  const best = scores.slice(0, 4);
  const sum = best.reduce((value, [, score]) => value + score, 0);
  for (let slot = 0; slot < best.length; slot++) {
    const [name, score] = best[slot];
    joints[i * 4 + slot] = boneIndex.get(name);
    weights[i * 4 + slot] = score / sum;
    if (score / sum > 0.05) influenceCounts[name]++;
  }
}
primitive.setAttribute('JOINTS_0', doc.createAccessor('ThornMaw_Joints').setArray(joints).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('ThornMaw_Weights').setArray(weights).setType(Accessor.Type.VEC4).setBuffer(buffer));
// Keep source geometry, UVs and inverse binds unchanged. Move the entire rig and
// mesh together so the ground plane is Y=0 in the production asset coordinate frame.
const modelFrame = doc.createNode('ThornMawGroundFrame').setTranslation([0, groundOffset, 0]).setScale([candidateScale, candidateScale, candidateScale]);
scene.removeChild(meshNode).removeChild(nodeByName.get('Root'));
modelFrame.addChild(meshNode).addChild(nodeByName.get('Root'));
scene.addChild(modelFrame);

const quat = (x = 0, y = 0, z = 0) => new Quaternion().setFromEuler(new Euler(x, y, z)).toArray();
const times = [0, 0.25, 0.5, 0.75, 1];
const qtrack = (node, angles) => ({ node, values: angles.map(a => quat(...a)) });
const loop = (a, axis = 0) => times.map(t => { const v = Math.sin(t * Math.PI * 2) * a; return axis === 0 ? [v,0,0] : axis === 1 ? [0,v,0] : [0,0,v]; });
const legNames = ['FrontLeft', 'FrontRight', 'RearLeft', 'RearRight'];
function clip(name, duration, tracks) {
  const animation = doc.createAnimation(name);
  for (const track of tracks) {
    const input = doc.createAccessor(`${name}_${track.node}_time`).setArray(new Float32Array(times.map(t => t * duration))).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const output = doc.createAccessor(`${name}_${track.node}_rotation`).setArray(new Float32Array(track.values.flat())).setType(Accessor.Type.VEC4).setBuffer(buffer);
    const sampler = doc.createAnimationSampler(`${name}_${track.node}_sampler`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${name}_${track.node}`).setTargetNode(nodeByName.get(track.node)).setTargetPath('rotation').setSampler(sampler));
  }
}
clip('Idle', 3.0, [qtrack('Stalk', loop(0.065, 2)), qtrack('Maw', loop(0.10, 0)), qtrack('UpperLip', loop(0.10, 0)), qtrack('LowerLip', loop(-0.14, 0)), qtrack('PetalLeft', loop(0.14, 2)), qtrack('PetalRight', loop(-0.14, 2))]);
function gait(amp) { return legNames.flatMap((name, i) => { const sign = (i === 0 || i === 3) ? 1 : -1; return [qtrack(`${name}Root`, times.map(t => [Math.sin(t * Math.PI * 2) * amp * sign, 0, (i % 2 ? -1 : 1) * 0.07])), qtrack(`${name}Foot`, times.map(t => [Math.max(0, Math.sin(t * Math.PI * 2) * sign) * amp * -0.5, 0, 0]))]; }); }
clip('Walk', 1.15, [...gait(0.62), qtrack('Stalk', loop(0.13, 2)), qtrack('Maw', loop(0.10, 0)), qtrack('PetalLeft', loop(0.17, 2)), qtrack('PetalRight', loop(-0.17, 2))]);
clip('Run', 0.73, [...gait(0.82), qtrack('Stalk', loop(0.19, 2)), qtrack('Maw', loop(0.14, 0)), qtrack('PetalLeft', loop(0.25, 2)), qtrack('PetalRight', loop(-0.25, 2))]);
clip('Attack', 0.85, [qtrack('Stalk', [[0,0,0],[-0.23,0,0],[0.50,0,0],[0.17,0,0],[0,0,0]]), qtrack('Maw', [[0,0,0],[-0.30,0,0],[0.52,0,0],[0.16,0,0],[0,0,0]]), qtrack('UpperLip', [[0,0,0],[-0.24,0,0],[-0.78,0,0],[-0.30,0,0],[0,0,0]]), qtrack('LowerLip', [[0,0,0],[0.22,0,0],[0.82,0,0],[0.31,0,0],[0,0,0]]), qtrack('PetalLeft', [[0,0,0],[0,0,-0.10],[0,0,-0.35],[0,0,-0.12],[0,0,0]]), qtrack('PetalRight', [[0,0,0],[0,0,0.10],[0,0,0.35],[0,0,0.12],[0,0,0]])]);
clip('Hit', 0.44, [qtrack('Stalk', [[0,0,0],[-0.17,0,0],[0.11,0,0],[-0.03,0,0],[0,0,0]]), qtrack('Maw', [[0,0,0],[-0.15,0,0],[0.09,0,0],[0,0,0],[0,0,0]])]);
clip('Death', 1.5, [qtrack('Root', [[0,0,0],[0.08,0,0],[0.27,0,0],[0.48,0,0],[0.48,0,0]]), qtrack('Stalk', [[0,0,0],[0.12,0,0],[0.35,0,0],[0.55,0,0],[0.55,0,0]]), qtrack('Maw', [[0,0,0],[0.1,0,0],[0.28,0,0],[0.42,0,0],[0.42,0,0]]), ...legNames.map((name,i) => qtrack(`${name}Root`, [[0,0,0],[0,0,0],[(i % 2 ? -1 : 1) * 0.12,0,0],[(i % 2 ? -1 : 1) * 0.22,0,0],[(i % 2 ? -1 : 1) * 0.22,0,0]]))]);

colorMap.setImage(await sharp(originalImage).resize(2048, 2048, { kernel: 'lanczos3' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer());
colorMap.setName('thorn_maw_layered_basecolor_2k.jpg');
const outputBytes = await io.writeBinary(doc);
await writeFile(outputFile, outputBytes);
const roundtrip = await io.readBinary(outputBytes);
const checkPrimitive = roundtrip.getRoot().listMeshes()[0].listPrimitives()[0];
for (const [name, accessor] of [['positions', checkPrimitive.getAttribute('POSITION')], ['normals', checkPrimitive.getAttribute('NORMAL')], ['uv', checkPrimitive.getAttribute('TEXCOORD_0')], ['indices', checkPrimitive.getIndices()]]) {
  if (sha(Buffer.from(accessor.getArray().buffer, accessor.getArray().byteOffset, accessor.getArray().byteLength)) !== sourceGeometry[name]) throw new Error(`${name} changed during rigging.`);
}
if (roundtrip.getRoot().listSkins().length !== 1 || roundtrip.getRoot().listAnimations().length !== 6) throw new Error('Skin or clips missing from staged candidate.');
const candidateSha = sha(outputBytes);
const record = { schema: 'corealm-creature-candidate/1', id: 'creature_thorn_maw', status: 'awaiting-root-lab-review', source: { modelId: '1ef82040-8e4f-47e1-b2c5-4e3b1d61a311', operatorId: '9d8f609d-e20f-49d0-983d-d3125e7c215a', file: 'sources/1ef82040-source.glb', sha256: sourceSha, bytes: sourceBytes.length, prompt: 'plant monster with purple open maw, teal bulbous body, clawed legs, thorny vines and sharp teeth', imageMap: { dimensions: [8192, 8192], sha256: originalImageSha }, vertices: 8285, triangles: 5631 }, candidate: { file: 'thorn-maw-candidate.glb', productionFile: 'models/creature/creature_thorn_maw.glb', sha256: candidateSha, bytes: outputBytes.length, geometryAndUvPreserved: true, scale: candidateScale, groundOffset, colorMap: { dimensions: [2048, 2048], originalLayeredSourcePreserved: true }, bones: bones.map(([name, parent, point]) => ({ name, parent, point, influencedVertices: influenceCounts[name] })), clips: ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'] }, limitations: ['Source is a single continuous mesh; jaw and petals are deformed by spatial skin weights, not separate rigid pieces.', 'Motion and material appearance await root feature lab review.'] };
await writeFile(path.join(here, 'catalog.json'), `${JSON.stringify(record, null, 2)}\n`);
const lab = { schema: 'corealm-lab-asset-candidates/1', pack: { id: 'corealm-tripo-creatures', name: 'Corealm Tripo creature candidates', author: 'Corealm', source: 'Tripo Studio saved account asset', license: 'LicenseRef-Tripo-Generated' }, assets: [{ id: 'creature_thorn_maw', file: 'models/creature/creature_thorn_maw.glb', candidateFile: 'thorn-maw-candidate.glb', pack: 'corealm-tripo-creatures', category: 'character', is: 'Thorn Maw purple flower predator candidate', tags: ['creature', 'plant', 'thorn-maw', 'tripo', 'candidate'], bytes: outputBytes.length, sha256: candidateSha, size: { x: 0.89599609375 * candidateScale, y: 0.99951171875 * candidateScale, z: 0.94677734375 * candidateScale }, base: { x: -0.447998046875 * candidateScale, y: 0, z: -0.473388671875 * candidateScale }, groundY: 0, triangles: 5631, vertices: 8285, animations: record.candidate.clips, materials: [material.getName()], sourceProvenance: { ...record.source, candidateFile: 'assets/art/tripo/imports/creatures/audit-thorn-maw/thorn-maw-candidate.glb', candidateSha256: candidateSha }, candidateReview: { labAccepted: false, worldIntegrated: false } }], files: { creature_thorn_maw: 'thorn-maw-candidate.glb' } };
await writeFile(path.join(here, 'lab-catalog.json'), `${JSON.stringify(lab, null, 2)}\n`);
console.log(JSON.stringify({ candidate: outputFile, sourceSha, candidateSha, bytes: outputBytes.length, clips: record.candidate.clips, influenceCounts }, null, 2));
