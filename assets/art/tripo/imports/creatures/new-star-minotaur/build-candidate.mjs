import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { Matrix4, Quaternion, Vector3 } from 'three';

const baseDir = 'assets/art/tripo/imports/creatures/new-star-minotaur';
const sourcePath = 'assets/art/tripo/exports/501ffade-8115-427c-8616-e2791cfb40f6.glb';
const nativePreviewPath = baseDir + '/redmane-native-preview.glb';
const candidatePath = baseDir + '/redmane-breaker-native-rig.glb';
const sourceExpectedSha256 = 'c69d605643fc9041fc02611e08c8d30a78c111e2bde20868e8e2366587e26b7c';
const cardId = 'f4934bef-8282-4dd6-b0b8-bc6072f4be3b';
const modelId = '501ffade-8115-427c-8616-e2791cfb40f6';
const displayName = 'Redmane Breaker';
const assetId = 'creature_redmane_breaker';
const suggestedTier = 'T40-T50';
const targetHeightMeters = 2.2;

const sha = (value) => createHash('sha256').update(value).digest('hex');
const attrHash = (accessor) => {
  const array = accessor?.getArray();
  if (!array) return null;
  return sha(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
};
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourcePath);
const nativePreviewBytes = await readFile(nativePreviewPath);
const nativePreviewSha256 = sha(nativePreviewBytes);
const sourceSha256 = sha(sourceBytes);
if (sourceSha256 !== sourceExpectedSha256 || sourceBytes.length !== 4478576) {
  throw new Error('Minotaur source hash or byte length changed: ' + sourceSha256 + ' (' + sourceBytes.length + ' bytes).');
}
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find((node) => node.getMesh() === mesh);
const sourceSkin = root.listSkins()[0];
const sourceJoints = primitive?.getAttribute('JOINTS_0')?.getArray();
const sourceWeights = primitive?.getAttribute('WEIGHTS_0')?.getArray();
const positionsAccessor = primitive?.getAttribute('POSITION');
const normalsAccessor = primitive?.getAttribute('NORMAL');
const uvsAccessor = primitive?.getAttribute('TEXCOORD_0');
const indicesAccessor = primitive?.getIndices();
if (!scene || !primitive || !meshNode || !sourceSkin || root.listAnimations().length) {
  throw new Error('Expected one skinned Minotaur mesh with no source clips.');
}
const vertexCount = positionsAccessor?.getCount() ?? 0;
const triangleCount = (indicesAccessor?.getCount() ?? 0) / 3;
if (vertexCount !== 7896 || triangleCount !== 5169 || sourceSkin.listJoints().length !== 24) {
  throw new Error('Minotaur source topology or skin changed: ' + vertexCount + ' vertices, ' + triangleCount + ' triangles, ' + sourceSkin.listJoints().length + ' joints.');
}
let rootWeightedVertices = 0;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  let dominant = -1, maxWeight = -1;
  for (let slot = 0; slot < 4; slot++) {
    const index = vertex * 4 + slot;
    if (sourceWeights[index] > maxWeight) {
      dominant = sourceJoints[index];
      maxWeight = sourceWeights[index];
    }
  }
  if (dominant === 0) rootWeightedVertices++;
}
if (rootWeightedVertices / vertexCount < 0.99) {
  throw new Error('Source weighting differs from the audited root-weighted skeleton: ' + rootWeightedVertices + '/' + vertexCount + ' vertices.');
}

const sourceAttributeHashes = {
  POSITION: attrHash(positionsAccessor),
  NORMAL: attrHash(normalsAccessor),
  TEXCOORD_0: attrHash(uvsAccessor),
  indices: attrHash(indicesAccessor),
};
const positions = Float32Array.from(positionsAccessor.getArray());
const indices = Uint32Array.from(indicesAccessor.getArray());
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) {
  for (let axis = 0; axis < 3; axis++) {
    bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
    bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
  }
}
const extent = bounds.max.map((value, axis) => value - bounds.min[axis]);
const center = bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2);
const height = extent[1], width = extent[0], depth = extent[2];
const Y = (fraction) => bounds.min[1] + height * fraction;
const X = (fraction) => center[0] + width * fraction;
const Z = (fraction) => center[2] + depth * fraction;
const presentationScale = targetHeightMeters / height;

// The source is a crouched four-legged bull, facing -X. Its three visible hoof
// clusters are near (-.34, ±.05), (+.21,+.36), (+.37,-.35) in XZ; the close
// front pair overlaps in projection. The Tripo skeleton has no useful joint
// transforms or weights, so place four leg chains on the actual sculpt.
const bones = [
  { name: 'BullRoot', parent: null, p: [0, Y(.46), 0], sigma: .22, group: 'body' },
  { name: 'BullRump', parent: 'BullRoot', p: [.19, Y(.49), 0], sigma: .20, group: 'body' },
  { name: 'BullShoulders', parent: 'BullRoot', p: [-.22, Y(.57), 0], sigma: .20, group: 'body' },
  { name: 'BullNeck', parent: 'BullShoulders', p: [-.34, Y(.70), 0], sigma: .14, group: 'head' },
  { name: 'BullHead', parent: 'BullNeck', p: [-.34, Y(.80), 0], sigma: .22, group: 'head' },
  { name: 'FrontLeftUpper', parent: 'BullShoulders', p: [-.29, Y(.44), .10], sigma: .13, group: 'front', side: 1 },
  { name: 'FrontLeftLower', parent: 'FrontLeftUpper', p: [-.32, Y(.20), .09], sigma: .12, group: 'front', side: 1 },
  { name: 'FrontLeftHoof', parent: 'FrontLeftLower', p: [-.33, Y(.04), .08], sigma: .10, group: 'front', side: 1 },
  { name: 'FrontRightUpper', parent: 'BullShoulders', p: [-.29, Y(.44), -.10], sigma: .13, group: 'front', side: -1 },
  { name: 'FrontRightLower', parent: 'FrontRightUpper', p: [-.35, Y(.20), -.08], sigma: .12, group: 'front', side: -1 },
  { name: 'FrontRightHoof', parent: 'FrontRightLower', p: [-.37, Y(.04), -.06], sigma: .10, group: 'front', side: -1 },
  { name: 'HindLeftUpper', parent: 'BullRump', p: [.21, Y(.40), .25], sigma: .17, group: 'hind', side: 1 },
  { name: 'HindLeftLower', parent: 'HindLeftUpper', p: [.22, Y(.20), .33], sigma: .14, group: 'hind', side: 1 },
  { name: 'HindLeftHoof', parent: 'HindLeftLower', p: [.21, Y(.04), .37], sigma: .11, group: 'hind', side: 1 },
  { name: 'HindRightUpper', parent: 'BullRump', p: [.30, Y(.40), -.25], sigma: .17, group: 'hind', side: -1 },
  { name: 'HindRightLower', parent: 'HindRightUpper', p: [.35, Y(.20), -.33], sigma: .14, group: 'hind', side: -1 },
  { name: 'HindRightHoof', parent: 'HindRightLower', p: [.37, Y(.04), -.36], sigma: .11, group: 'hind', side: -1 },
];
const boneByName = new Map(bones.map((bone, index) => [bone.name, { ...bone, index }]));
for (const bone of bones) {
  const parent = bone.parent ? boneByName.get(bone.parent) : null;
  bone.local = parent ? bone.p.map((value, axis) => value - parent.p[axis]) : bone.p;
}

// Remove the unusable source skin and its orphaned nodes. The mesh stays in its original
// scene-space pose; only its skin attributes are replaced.
primitive.setAttribute('JOINTS_0', null);
primitive.setAttribute('WEIGHTS_0', null);
meshNode.setSkin(null);
sourceSkin.dispose();
const originalParent = meshNode.getParentNode();
if (originalParent) originalParent.removeChild(meshNode);
else if (scene.listChildren().includes(meshNode)) scene.removeChild(meshNode);
else throw new Error('Source mesh is not connected to the source scene.');
const oldNodes = root.listNodes().filter((node) => node !== meshNode);
for (const node of oldNodes) {
  const parent = node.getParentNode();
  if (parent) parent.removeChild(node);
}
for (const node of oldNodes) node.dispose();
meshNode.setName('RedmaneBreakerMesh').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
const rigContainer = doc.createNode('RedmaneBreakerArmature')
  .setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([presentationScale, presentationScale, presentationScale]);
scene.addChild(rigContainer);
rigContainer.addChild(meshNode);

const jointNodes = new Map();
for (const bone of bones) {
  const node = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  jointNodes.set(bone.name, node);
  const parent = bone.parent ? jointNodes.get(bone.parent) : rigContainer;
  parent.addChild(node);
}
const skin = doc.createSkin('RedmaneBreaker_Quadruped').setSkeleton(jointNodes.get('BullRoot'));
for (const bone of bones) skin.addJoint(jointNodes.get(bone.name));
const inverseBinds = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i++) {
  const [x, y, z] = bones[i].p;
  inverseBinds.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
}
const buffer = root.listBuffers()[0];
skin.setInverseBindMatrices(doc.createAccessor('RedmaneBreaker_InverseBindMatrices').setArray(inverseBinds).setType(Accessor.Type.MAT4).setBuffer(buffer));
meshNode.setSkin(skin);

function segmentDistance(point, start, end) {
  const direction = end.map((value, axis) => value - start[axis]);
  const lengthSquared = direction.reduce((sum, value) => sum + value * value, 0) || 1;
  const t = Math.max(0, Math.min(1, point.reduce((sum, value, axis) => sum + (value - start[axis]) * direction[axis], 0) / lengthSquared));
  return Math.hypot(...point.map((value, axis) => value - (start[axis] + t * direction[axis])));
}
const jointValues = new Uint16Array(vertexCount * 4);
const weightValues = new Float32Array(vertexCount * 4);
const influenceCounts = new Uint32Array(bones.length);
let maximumWeightSumError = 0;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const [x, y, z] = point;
  const yn = (y - bounds.min[1]) / height;
  const candidates = [];
  for (const bone of bones) {
    let gate = 1;
    if (bone.group === 'head') {
      gate = 0.01 + 0.99 / (1 + Math.exp(-(yn - .64) / .055));
      gate *= 0.02 + .98 / (1 + Math.exp((x + .13) / .06));
    } else if (bone.group === 'front' || bone.group === 'hind') {
      const front = bone.group === 'front';
      gate = 0.005 + .995 / (1 + Math.exp((yn - (front ? .54 : .50)) / .055));
      gate *= .002 + .998 / (1 + Math.exp((front ? x + .10 : .10 - x) / .055));
      gate *= .005 + .995 / (1 + Math.exp((.015 - bone.side * z) / .025));
    } else {
      gate = (.03 + .97 / (1 + Math.exp((.42 - yn) / .06)))
        * (.08 + .92 / (1 + Math.exp((Math.abs(z) - .25) / .07)));
    }
    const parent = bone.parent ? boneByName.get(bone.parent) : null;
    const distance = segmentDistance(point, parent?.p ?? bone.p, bone.p);
    const score = gate * Math.exp(-0.5 * (distance / bone.sigma) ** 2);
    if (score > 1e-12) candidates.push({ index: boneByName.get(bone.name).index, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 4);
  if (!chosen.length) throw new Error('Could not find anatomical influences for vertex ' + vertex + '.');
  const total = chosen.reduce((sum, candidate) => sum + candidate.score, 0);
  let assigned = 0;
  for (let slot = 0; slot < 4; slot++) {
    const candidate = chosen[slot] ?? chosen[0];
    const weight = slot >= chosen.length ? 0 : slot === chosen.length - 1 ? 1 - assigned : candidate.score / total;
    jointValues[vertex * 4 + slot] = candidate.index;
    weightValues[vertex * 4 + slot] = weight;
    assigned += weight;
    if (weight > 1e-6) influenceCounts[candidate.index]++;
  }
  const sum = weightValues[vertex * 4] + weightValues[vertex * 4 + 1] + weightValues[vertex * 4 + 2] + weightValues[vertex * 4 + 3];
  maximumWeightSumError = Math.max(maximumWeightSumError, Math.abs(sum - 1));
}
primitive.setAttribute('JOINTS_0', doc.createAccessor('RedmaneBreaker_Joints0').setArray(jointValues).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('RedmaneBreaker_Weights0').setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(buffer));

const material = root.listMaterials()[0];
if (!material?.getBaseColorTexture() || !material.getMetallicRoughnessTexture() || !material.getNormalTexture()) {
  throw new Error('Expected embedded base-color, packed metallic-roughness, and normal maps.');
}
// Preserve Tripo's layered maps; set creature-level factors so the mostly rough, low-metal
// hide and horn surfaces do not render like metal.
material.setMetallicFactor(0.08).setRoughnessFactor(0.90);
const sourceTextureMetrics = [];
const runtimeTextureMetrics = [];
for (const texture of root.listTextures()) {
  const image = texture.getImage();
  const metadata = await sharp(image).metadata();
  sourceTextureMetrics.push({ name: texture.getName(), width: metadata.width, height: metadata.height, mime: texture.getMimeType(), bytes: image.length, sha256: sha(image) });
  if (metadata.width > 2048 || metadata.height > 2048) {
    const isDataTexture = texture === material.getMetallicRoughnessTexture() || texture === material.getNormalTexture();
    const encoded = await sharp(image)
      .resize(2048, 2048, { fit: 'fill', kernel: isDataTexture ? 'linear' : 'lanczos3' })
      .toFormat(metadata.format === 'jpeg' ? 'jpeg' : 'png', metadata.format === 'jpeg' ? { quality: 92, chromaSubsampling: '4:4:4' } : {})
      .toBuffer();
    texture.setImage(encoded);
  }
  const runtimeMetadata = await sharp(texture.getImage()).metadata();
  if (runtimeMetadata.width > 2048 || runtimeMetadata.height > 2048) throw new Error('Runtime texture exceeds 2K: ' + texture.getName());
  runtimeTextureMetrics.push({ name: texture.getName(), width: runtimeMetadata.width, height: runtimeMetadata.height, mime: texture.getMimeType(), bytes: texture.getImage().length, sha256: sha(texture.getImage()) });
}
const packed = await sharp(material.getMetallicRoughnessTexture().getImage()).removeAlpha().resize(128, 128).raw().toBuffer();
const metallicRange = [Infinity, -Infinity];
for (let i = 2; i < packed.length; i += 3) {
  const metallic = packed[i] / 255;
  metallicRange[0] = Math.min(metallicRange[0], metallic);
  metallicRange[1] = Math.max(metallicRange[1], metallic);
}
if (metallicRange[1] - metallicRange[0] < 0.05) throw new Error('The packed metallic channel is unexpectedly flat: ' + metallicRange);

const quat = (axis, angle) => {
  const sine = Math.sin(angle / 2), cosine = Math.cos(angle / 2);
  if (axis === 'x') return [sine, 0, 0, cosine];
  if (axis === 'y') return [0, sine, 0, cosine];
  return [0, 0, sine, cosine];
};
const phase = Array.from({ length: 17 }, (_, index) => index / 16);
const clips = [];
function addClip(name, seconds, tracks) {
  const animation = doc.createAnimation(name);
  for (const track of tracks) {
    const input = doc.createAccessor(name + '_' + track.node + '_time')
      .setArray(Float32Array.from(track.times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const output = doc.createAccessor(name + '_' + track.node + '_' + (track.path ?? 'rotation') + '_value')
      .setArray(Float32Array.from(track.values.flat()))
      .setType(track.path === 'translation' || track.path === 'scale' ? Accessor.Type.VEC3 : Accessor.Type.VEC4).setBuffer(buffer);
    const sampler = doc.createAnimationSampler(name + '_' + track.node).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(track.node + '_' + (track.path ?? 'rotation'))
      .setTargetNode(jointNodes.get(track.node)).setTargetPath(track.path ?? 'rotation').setSampler(sampler));
  }
  clips.push({ name, seconds, tracks });
}
const rootRest = bones[0].p;
const rootAt = (dy = 0, dx = 0) => [rootRest[0] + dx, rootRest[1] + dy, rootRest[2]];
const legPairs = [
  ['FrontLeftUpper', 'FrontLeftLower', 'FrontLeftHoof', 0],
  ['FrontRightUpper', 'FrontRightLower', 'FrontRightHoof', 0],
  ['HindLeftUpper', 'HindLeftLower', 'HindLeftHoof', .5],
  ['HindRightUpper', 'HindRightLower', 'HindRightHoof', .5],
];
function gait(name, seconds, swing, knee, bob, baseLift) {
  const times = phase.map(t => t * seconds);
  addClip(name, seconds, [
    { node: 'BullRoot', path: 'translation', times, values: phase.map(t => rootAt(baseLift + bob * (1 - Math.cos(4 * Math.PI * t)) / 2, .025 * Math.sin(2 * Math.PI * t))) },
    { node: 'BullShoulders', times, values: phase.map(t => quat('z', .07 * Math.sin(4 * Math.PI * t))) },
    { node: 'BullHead', times, values: phase.map(t => quat('z', .09 * Math.sin(4 * Math.PI * t))) },
    ...legPairs.flatMap(([upper, lower, hoof, offset]) => [
      { node: upper, times, values: phase.map(t => quat('z', Math.cos(2 * Math.PI * (t + offset)) * swing)) },
      { node: lower, times, values: phase.map(t => quat('z', -Math.max(0, Math.cos(2 * Math.PI * (t + offset))) * knee)) },
      { node: hoof, times, values: phase.map(t => quat('z', Math.max(0, Math.cos(2 * Math.PI * (t + offset))) * knee * .45)) },
    ]),
  ]);
}
addClip('Idle', 3, [
  { node: 'BullRoot', path: 'translation', times: [0, .75, 1.5, 2.25, 3], values: [rootAt(), rootAt(.006), rootAt(), rootAt(.005), rootAt()] },
  { node: 'BullShoulders', times: [0, .75, 1.5, 2.25, 3], values: [0,.018,0,-.014,0].map(v => quat('z',v)) },
  { node: 'BullHead', times: [0, .75, 1.5, 2.25, 3], values: [0,-.025,.015,.025,0].map(v => quat('z',v)) },
]);
gait('Walk', 1.12, .23, .16, 0, .016);
gait('Run', .76, .36, .27, .012, .013);
addClip('Attack', .95, [
  { node: 'BullRoot', path: 'translation', times: [0,.20,.43,.70,.95], values: [rootAt(),rootAt(.018,.045),rootAt(.025,-.16),rootAt(.025,-.05),rootAt()] },
  { node: 'BullShoulders', times: [0,.20,.43,.70,.95], values: [0,-.12,.20,.08,0].map(v => quat('z',v)) },
  { node: 'BullNeck', times: [0,.20,.43,.70,.95], values: [0,-.18,.38,.12,0].map(v => quat('z',v)) },
  { node: 'BullHead', times: [0,.20,.43,.70,.95], values: [0,-.15,.32,.10,0].map(v => quat('z',v)) },
  ...legPairs.map(([upper]) => ({ node: upper, times: [0,.20,.43,.70,.95], values: [0,.04,-.07,-.02,0].map(v => quat('z',v)) })),
]);
addClip('Hit', .48, [
  { node: 'BullRoot', path: 'translation', times: [0,.08,.20,.48], values: [rootAt(),rootAt(.025,.07),rootAt(.015,.025),rootAt()] },
  { node: 'BullShoulders', times: [0,.08,.20,.48], values: [0,-.20,.07,0].map(v => quat('z',v)) },
  { node: 'BullHead', times: [0,.08,.20,.48], values: [0,-.25,.08,0].map(v => quat('z',v)) },
]);
addClip('Death', 1.55, [
  { node: 'BullRoot', path: 'translation', times: [0,.22,.65,1.05,1.55], values: [rootAt(),rootAt(),rootAt(),rootAt(),rootAt()] },
  { node: 'BullRoot', path: 'scale', times: [0,.22,.65,1.05,1.55], values: [[1,1,1],[1,.96,1],[1,.80,1],[1,.70,1],[1,.70,1]] },
  { node: 'BullRoot', times: [0,.22,.65,1.05,1.55], values: [0,.08,.23,.35,.35].map(v => quat('x',v)) },
  { node: 'BullNeck', times: [0,.22,.65,1.05,1.55], values: [0,.08,.28,.42,.42].map(v => quat('z',v)) },
  { node: 'BullHead', times: [0,.22,.65,1.05,1.55], values: [0,.10,.24,.32,.32].map(v => quat('z',v)) },
  ...legPairs.map(([upper], i) => ({ node: upper, times: [0,.22,.65,1.05,1.55], values: [0,.06,.13,.20,.20].map(v => quat('z', v * (i < 2 ? 1 : -1))) })),
]);

// Sample all clips through the actual linear skin weights so obvious frozen poses,
// normalized-weight regressions and severe floor penetration are caught at build time.
function interpolate(track, time) {
  if (time <= track.times[0]) return track.values[0];
  if (time >= track.times[track.times.length - 1]) return track.values[track.values.length - 1];
  let i = 0;
  while (i < track.times.length - 2 && track.times[i + 1] < time) i++;
  const amount = (time - track.times[i]) / (track.times[i + 1] - track.times[i]);
  if (track.path === 'translation' || track.path === 'scale') return track.values[i].map((value, axis) => value + (track.values[i + 1][axis] - value) * amount);
  return new Quaternion(...track.values[i]).slerp(new Quaternion(...track.values[i + 1]), amount).toArray();
}
function sampleSkin(clip, time) {
  const pose = new Map(bones.map((bone) => [bone.name, { translation: [...bone.local], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }]));
  for (const track of clip.tracks) {
    const value = interpolate(track, time);
    pose.get(track.node)[track.path ?? 'rotation'] = value;
  }
  const worldByName = new Map();
  for (const bone of bones) {
    const localPose = pose.get(bone.name);
    const localMatrix = new Matrix4().compose(new Vector3(...localPose.translation), new Quaternion(...localPose.rotation), new Vector3(...localPose.scale));
    const parent = bone.parent ? worldByName.get(bone.parent) : null;
    worldByName.set(bone.name, parent ? parent.clone().multiply(localMatrix) : localMatrix);
  }
  const matrices = bones.map((bone, index) => worldByName.get(bone.name).clone().multiply(new Matrix4().fromArray(Array.from(inverseBinds.slice(index * 16, index * 16 + 16)))));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let maxDisplacement = 0, movedVertices = 0;
  const contactVertices = [2, 6254, 7681]; // front, left hind, right hind hoof tips
  const contacts = {};
  const deformed = new Float32Array(positions.length);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const source = new Vector3(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]);
    const out = new Vector3();
    for (let slot = 0; slot < 4; slot++) {
      const at = vertex * 4 + slot, weight = weightValues[at];
      if (weight > 0) out.add(source.clone().applyMatrix4(matrices[jointValues[at]]).multiplyScalar(weight));
    }
    const displacement = out.distanceTo(source);
    maxDisplacement = Math.max(maxDisplacement, displacement);
    if (displacement > 1e-4) movedVertices++;
    min[0] = Math.min(min[0], out.x);
    deformed.set(out.toArray(), vertex * 3);
    if (contactVertices.includes(vertex)) contacts[vertex] = out.toArray();
    min[1] = Math.min(min[1], out.y); min[2] = Math.min(min[2], out.z);
    max[0] = Math.max(max[0], out.x); max[1] = Math.max(max[1], out.y); max[2] = Math.max(max[2], out.z);
  }
  let maximumEdgeStretchRatio = 1, maximumEdgeLengthGain = 0, worstEdge = null;
  for (let i = 0; i < indices.length; i += 3) {
    for (const [a, b] of [[indices[i], indices[i + 1]], [indices[i + 1], indices[i + 2]], [indices[i + 2], indices[i]]]) {
      const rest = Math.hypot(...[0, 1, 2].map(axis => positions[a * 3 + axis] - positions[b * 3 + axis]));
      if (rest < .01) continue;
      const posed = Math.hypot(...[0, 1, 2].map(axis => deformed[a * 3 + axis] - deformed[b * 3 + axis]));
      maximumEdgeStretchRatio = Math.max(maximumEdgeStretchRatio, posed / rest);
      if (posed - rest > maximumEdgeLengthGain) {
        maximumEdgeLengthGain = posed - rest;
        worstEdge = { a, b, rest, posed, sourceA: Array.from(positions.slice(a * 3, a * 3 + 3)), sourceB: Array.from(positions.slice(b * 3, b * 3 + 3)) };
      }
    }
  }
  return { time, maximumVertexDisplacement: maxDisplacement, movedVertices, maximumEdgeStretchRatio, maximumEdgeLengthGain, worstEdge, contacts, bounds: { min, max } };
}
// Follow the irregular sculpted hooves rather than lifting the whole beast by
// a fixed amount. At each walk key the lowest hoof meets the authored floor.
// This preserves one planted contact as the paired front/rear legs exchange load.
const walkClip = clips.find(clip => clip.name === 'Walk');
const walkRootTrack = walkClip.tracks.find(track => track.node === 'BullRoot' && track.path === 'translation');
for (let index = 0; index < walkRootTrack.times.length; index++) {
  walkRootTrack.values[index][1] -= sampleSkin(walkClip, walkRootTrack.times[index]).bounds.min[1];
}
root.listAccessors().find(accessor => accessor.getName() === 'Walk_BullRoot_translation_value')
  .setArray(Float32Array.from(walkRootTrack.values.flat()));
const deathClip = clips.find(clip => clip.name === 'Death');
const deathRootTrack = deathClip.tracks.find(track => track.node === 'BullRoot' && track.path === 'translation');
for (let index = 0; index < deathRootTrack.times.length; index++) {
  deathRootTrack.values[index][1] -= sampleSkin(deathClip, deathRootTrack.times[index]).bounds.min[1];
}
root.listAccessors().find(accessor => accessor.getName() === 'Death_BullRoot_translation_value')
  .setArray(Float32Array.from(deathRootTrack.values.flat()));

const sampledMotions = clips.map((clip) => {
  const samples = Array.from({ length: 33 }, (_, index) => sampleSkin(clip, clip.seconds * index / 32));
  return {
    name: clip.name,
    seconds: clip.seconds,
    channels: clip.tracks.length,
    sampledPoses: samples.length,
    maximumVertexDisplacement: Math.max(...samples.map((sample) => sample.maximumVertexDisplacement)),
    maximumMovedVertices: Math.max(...samples.map((sample) => sample.movedVertices)),
    maximumEdgeStretchRatio: Math.max(...samples.map((sample) => sample.maximumEdgeStretchRatio)),
    maximumEdgeLengthGain: Math.max(...samples.map((sample) => sample.maximumEdgeLengthGain)),
    worstEdge: samples.reduce((best, sample) => sample.maximumEdgeLengthGain > best.maximumEdgeLengthGain ? sample : best).worstEdge,
    minimumGroundY: Math.min(...samples.map((sample) => sample.bounds.min[1])),
    contactTravel: Object.fromEntries([2, 6254, 7681].map(vertex => {
      const points = samples.map(sample => sample.contacts[vertex]);
      return [vertex, Math.max(...points.flatMap(a => points.map(b => Math.hypot(...a.map((value, axis) => value - b[axis])))))];
    })),
    contactVelocity: Object.fromEntries([2, 6254, 7681].map(vertex => {
      const steps = [];
      for (let index = 1; index < samples.length; index++) {
        const from = samples[index - 1].contacts[vertex], to = samples[index].contacts[vertex];
        const backwardMps = (to[0] - from[0]) * presentationScale * 32 / clip.seconds;
        const verticalMps = Math.abs(to[1] - from[1]) * presentationScale * 32 / clip.seconds;
        if (Math.max(from[1], to[1]) < .01 && backwardMps > 0 && verticalMps < .1 * backwardMps + .03) steps.push(backwardMps);
      }
      steps.sort((a, b) => a - b);
      const median = steps.length ? steps[Math.floor(steps.length / 2)] : null;
      return [vertex, { stanceSamples: steps.length, medianMps: median, p10Mps: steps.length ? steps[Math.floor(steps.length * .1)] : null, p90Mps: steps.length ? steps[Math.floor(steps.length * .9)] : null }];
    })),
    samples: samples.map((sample) => ({ time: sample.time, groundY: sample.bounds.min[1], ceilingY: sample.bounds.max[1] })),
    sweptBounds: {
      min: [0, 1, 2].map((axis) => Math.min(...samples.map((sample) => sample.bounds.min[axis]))),
      max: [0, 1, 2].map((axis) => Math.max(...samples.map((sample) => sample.bounds.max[axis]))),
    },
  };
});
const deathStart = sampleSkin(deathClip, 0), deathFinal = sampleSkin(deathClip, deathClip.seconds);
const deathPoseVerification = {
  startBounds: deathStart.bounds,
  finalBounds: deathFinal.bounds,
  finalRootTranslation: deathRootTrack.values.at(-1),
  finalRootScale: deathClip.tracks.find(track => track.node === 'BullRoot' && track.path === 'scale').values.at(-1),
  horizontalCenterShift: [0, 2].map(axis =>
    (deathFinal.bounds.min[axis] + deathFinal.bounds.max[axis] - deathStart.bounds.min[axis] - deathStart.bounds.max[axis]) / 2),
};
for (const motion of sampledMotions) {
  if (motion.maximumVertexDisplacement < 0.01 || motion.maximumMovedVertices < vertexCount * 0.25) {
    throw new Error(motion.name + ' does not produce enough actual skin deformation.');
  }
  if (motion.maximumEdgeLengthGain > .05) {
    throw new Error(motion.name + ' stretches a mesh edge by more than .05 source units: ' + JSON.stringify(motion.worstEdge));
  }
}
for (const name of ['Walk', 'Run']) {
  const motion = sampledMotions.find(entry => entry.name === name);
  if (Math.min(...Object.values(motion.contactTravel)) < .10) {
    throw new Error(name + ' does not move every sampled hoof at least .10 source units through its full cycle.');
  }
}
const worstPenetration = Math.min(...sampledMotions.map((motion) => motion.minimumGroundY));
  if (worstPenetration < -0.004) throw new Error('Animation passes more than 1cm through the floor after presentation scale: ' + worstPenetration + ' ' + JSON.stringify(sampledMotions.map(m => ({ name: m.name, floor: m.minimumGroundY }))));

const outputBytes = await io.writeBinary(doc);
await writeFile(candidatePath, outputBytes);
const candidateSha256 = sha(outputBytes);
const checkDoc = await io.readBinary(outputBytes);
const checkRoot = checkDoc.getRoot();
const checkPrimitive = checkRoot.listMeshes()[0]?.listPrimitives()[0];
const checkSkin = checkRoot.listSkins()[0];
if (!checkPrimitive || !checkSkin || checkSkin.listJoints().length !== bones.length) throw new Error('Exported skin is incomplete.');
for (const semantic of ['POSITION', 'NORMAL', 'TEXCOORD_0']) {
  if (attrHash(checkPrimitive.getAttribute(semantic)) !== sourceAttributeHashes[semantic]) {
    throw new Error('Candidate changed source ' + semantic + ' values.');
  }
}
if (attrHash(checkPrimitive.getIndices()) !== sourceAttributeHashes.indices) throw new Error('Candidate changed source triangle indices.');
const checkPositions = checkPrimitive.getAttribute('POSITION').getArray();
const checkJoints = checkPrimitive.getAttribute('JOINTS_0')?.getArray();
const checkWeights = checkPrimitive.getAttribute('WEIGHTS_0')?.getArray();
if (checkPositions.length / 3 !== vertexCount || !checkJoints || !checkWeights) throw new Error('Candidate is missing its exported mesh skin.');
let checkedWeightError = 0, distributedVertices = 0;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  let sum = 0, active = 0;
  for (let slot = 0; slot < 4; slot++) {
    const at = vertex * 4 + slot, joint = checkJoints[at], weight = checkWeights[at];
    if (!Number.isInteger(joint) || joint < 0 || joint >= bones.length || !Number.isFinite(weight) || weight < 0) throw new Error('Invalid exported influence on vertex ' + vertex + '.');
    sum += weight;
    if (weight > 1e-6) active++;
  }
  checkedWeightError = Math.max(checkedWeightError, Math.abs(sum - 1));
  if (active > 1) distributedVertices++;
}
if (checkedWeightError > 1e-5 || distributedVertices < vertexCount * 0.75) {
  throw new Error('Exported skin weights are not sufficiently distributed: ' + distributedVertices + ' vertices; error ' + checkedWeightError + '.');
}
const requiredClips = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
const animationNames = checkRoot.listAnimations().map((animation) => animation.getName());
if (requiredClips.some((name) => !animationNames.includes(name))) throw new Error('Exported creature is missing a gameplay clip.');
for (const animation of checkRoot.listAnimations()) {
  for (const channel of animation.listChannels()) {
    if (!checkSkin.listJoints().includes(channel.getTargetNode())) throw new Error(animation.getName() + ' targets a node outside the exported quadruped skin.');
  }
}

const geometry = {
  vertices: vertexCount,
  triangles: triangleCount,
  bounds,
  positionsPreserved: true,
  normalsPreserved: true,
  uvsPreserved: true,
  indicesPreserved: true,
  retopology: false,
};
const rigMethod = 'Four-leg bull skeleton with anatomically partitioned front and hind hoof weights; source had 100% bone_0 weighting, so JOINTS_0/WEIGHTS_0 and its unusable source skeleton were rebuilt.';
const gaitCalibration = {
  status: 'uncalibrated',
  impliedWalkMps: null,
  impliedRunMps: null,
  reason: 'Grounded backward-sole velocity is sparse and inconsistent: the 33-pose Walk sample has 8, 4 and 0 usable stance intervals at the three sampled hooves; Run has 2, 0 and 0. No defensible speed scalar follows from this clip.',
  metadataToRemoveOnPromotion: ['impliedWalkMps', 'impliedRunMps'],
};
const catalog = {
  schema: 'corealm-creature-native-rig-candidate/1',
  id: assetId,
  displayName,
  status: 'awaiting-root-lab-review',
  accepted: false,
  source: {
    file: sourcePath,
    sha256: sourceSha256,
    bytes: sourceBytes.length,
    starredModelId: modelId,
    starredCardId: cardId,
    starredDisplayName: 'minotaur 3d model',
    generator: 'Tripo P1',
    prompt: 'horned minotaur with beige horns, red-brown mane, muscular build, sharp fangs, low-poly texture',
    geometry,
    sourceSkin: { jointCount: 24, rootWeightedVertices, vertexCount, allVerticesWeightedToBoneZero: rootWeightedVertices === vertexCount },
    sourceAnimations: [],
    nativePreview: {
      file: nativePreviewPath, sha256: nativePreviewSha256, bytes: nativePreviewBytes.length,
      rigJoints: 41, clips: 0,
      assessment: 'Rejected for motion: hoof-height vertices are fully weighted to a high head-area bone or neutral_bone.',
    },
    textures: sourceTextureMetrics,
  },
  candidate: {
    file: candidatePath,
    sha256: candidateSha256,
    bytes: outputBytes.length,
    productionTarget: 'game/public/assets/models/creature/' + assetId + '.glb',
    presentation: { targetHeightMeters, scaleFactor: presentationScale, uniformRootScale: presentationScale, scaleNode: 'RedmaneBreakerArmature' },
    geometry: { vertices: vertexCount, triangles: triangleCount, positionsPreserved: true, normalsPreserved: true, uvsPreserved: true, indicesPreserved: true },
    rig: {
      type: 'Anatomical quadruped glTF skin',
      joints: bones.map((bone) => ({ name: bone.name, parent: bone.parent, position: bone.p })),
      influencesPerVertex: 4,
      verticesWithDistributedWeights: distributedVertices,
      maximumWeightSumError: checkedWeightError,
      method: rigMethod,
    },
    material: { metallicFactor: material.getMetallicFactor(), roughnessFactor: material.getRoughnessFactor(), sourceMapsPreserved: true },
    textures: runtimeTextureMetrics,
    packedMetallicChannelRange: metallicRange,
    animations: clips.map((clip) => ({ name: clip.name, seconds: clip.seconds, channels: clip.tracks.length })),
    motionTiming: { walkClipSeconds: 1.12, runClipSeconds: .76, attackSeconds: .95, attackContactNormalized: .43 / .95 },
    gaitCalibration,
    motionVerification: sampledMotions,
    deathPoseVerification,
  },
  suggestedTier,
  suggestedRegionFit: 'Highland border or upper Wilderness; large aggressive bull belongs well above the starter region.',
  acceptance: { sourceDesignAudit: false, geometry: true, rig: false, animation: false, textures: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(baseDir + '/catalog.json', JSON.stringify(catalog, null, 2) + '\n');

const scaledBounds = {
  min: bounds.min.map((value, axis) => axis === 1 ? value * presentationScale : (value - center[axis]) * presentationScale),
  max: bounds.max.map((value, axis) => axis === 1 ? value * presentationScale : (value - center[axis]) * presentationScale),
};
const scaledSize = scaledBounds.max.map((value, axis) => value - scaledBounds.min[axis]);
const labAsset = {
  id: assetId,
  file: 'models/creature/' + assetId + '.glb',
  pack: 'corealm-starred-creatures',
  category: 'character',
  is: displayName,
  tags: ['creature', 'quadruped', 'bull', 'minotaur', 'redmane', 'T40-T50', 'starred', 'tripo', 'candidate'],
  bytes: outputBytes.length,
  sha256: candidateSha256,
  size: { x: scaledSize[0], y: scaledSize[1], z: scaledSize[2] },
  base: { x: scaledBounds.min[0], y: scaledBounds.min[1], z: scaledBounds.min[2] },
  bounds: scaledBounds,
  groundY: scaledBounds.min[1],
  triangles: triangleCount,
  animations: requiredClips,
  walkClipSeconds: 1.12,
  runClipSeconds: .76,
  attackSeconds: .95,
  attackContactNormalized: .43 / .95,
  gaitCalibration,
  materials: root.listMaterials().map((entry) => entry.getName()),
  presentation: { targetHeightMeters, scaleFactor: presentationScale, uniformRootScale: presentationScale, scaleNode: 'RedmaneBreakerArmature' },
  sourceProvenance: { author: 'Corealm candidate rig reconstruction', sourceModelId: modelId, sourceCardId: cardId, sourceFile: sourcePath, sourceSha256, candidateFile: candidatePath, candidateSha256, rigMethod, textures: runtimeTextureMetrics, candidateStatus: 'awaiting-root-lab-review' },
  acceptance: { assetAudit: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(baseDir + '/lab-catalog.json', JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', assets: [labAsset], files: { [assetId]: 'redmane-breaker-native-rig.glb' } }, null, 2) + '\n');
const badgerLabAsset = { ...labAsset, id: 'creature_rootdelve_badger' };
await writeFile(baseDir + '/as-badger.lab-catalog.json', JSON.stringify({
  schema: 'corealm-lab-asset-candidates/1',
  assets: [badgerLabAsset],
  files: { creature_rootdelve_badger: 'redmane-breaker-native-rig.glb' },
}, null, 2) + '\n');
console.log(JSON.stringify({ candidatePath, bytes: outputBytes.length, candidateSha256, vertices: vertexCount, triangles: triangleCount, sourceRootWeightedVertices: rootWeightedVertices, joints: bones.length, distributedVertices, maximumWeightSumError: checkedWeightError, presentationScale, runtimeTextureMetrics, motionVerification: sampledMotions, worstPenetration }, null, 2));
