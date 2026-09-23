import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const baseDir = 'assets/art/tripo/imports/creatures/starred-shade';
const sourcePath = 'assets/art/tripo/exports/bee97dff-f4bc-415f-85f5-7166421b3cf4.glb';
const sourceSha256Expected = 'cdc218bf28e19b40c3f9070d3375478795752ee618c52e9cc2cb71c6513f192f';
const candidatePath = `${baseDir}/ashveil-wraith-native-rig.glb`;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await mkdir(baseDir, { recursive: true });

const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
if (sourceSha256 !== sourceSha256Expected) throw new Error(`Starred shade hash mismatch: ${sourceSha256}`);
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find(node => node.getMesh() === mesh);
const originalSkin = root.listSkins()[0];
if (!scene || !primitive || !meshNode || !originalSkin || root.listAnimations().length !== 0) {
  throw new Error('Expected the exact starred shade export with one skin and no source clips.');
}

const positions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
const normals = Float32Array.from(primitive.getAttribute('NORMAL')?.getArray() ?? []);
const uvs = Float32Array.from(primitive.getAttribute('TEXCOORD_0')?.getArray() ?? []);
const indices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
if (positions.length / 3 !== 3395 || indices.length / 3 !== 5258 || normals.length !== positions.length || uvs.length / 2 !== positions.length / 3) {
  throw new Error(`Approved source topology changed: ${positions.length / 3} vertices, ${indices.length / 3} triangles.`);
}
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
  bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
}
const geometryHash = value => createHash('sha256').update(Buffer.from(value.buffer, value.byteOffset, value.byteLength)).digest('hex');
const sourceGeometryHashes = { positions: geometryHash(positions), normals: geometryHash(normals), uvs: geometryHash(uvs), indices: geometryHash(indices) };

// Mixamo names let Unity Humanoid map the familiar bones. This shade has no meaningful
// footfall, so its gameplay locomotion is authored as a buoyant drift and fast-glide cycle.
// All points below are in the source mesh's unchanged 1 m bind space.
const bones = [
  { name: 'mixamorigHips', parent: null, p: [0, 0.405, 0], sigma: 0.105, group: 'torso' },
  { name: 'mixamorigSpine', parent: 'mixamorigHips', p: [0, 0.490, 0], sigma: 0.095, group: 'torso' },
  { name: 'mixamorigSpine1', parent: 'mixamorigSpine', p: [0, 0.585, 0], sigma: 0.100, group: 'torso' },
  { name: 'mixamorigSpine2', parent: 'mixamorigSpine1', p: [0, 0.690, 0], sigma: 0.095, group: 'torso' },
  { name: 'mixamorigNeck', parent: 'mixamorigSpine2', p: [0, 0.785, 0], sigma: 0.070, group: 'torso' },
  { name: 'mixamorigHead', parent: 'mixamorigNeck', p: [0, 0.895, 0], sigma: 0.105, group: 'head' },
  { name: 'mixamorigLeftShoulder', parent: 'mixamorigSpine2', p: [-0.105, 0.710, 0], sigma: 0.050, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftArm', parent: 'mixamorigLeftShoulder', p: [-0.165, 0.630, 0], sigma: 0.052, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftForeArm', parent: 'mixamorigLeftArm', p: [-0.205, 0.485, 0.010], sigma: 0.050, group: 'leftArm', side: -1 },
  { name: 'mixamorigLeftHand', parent: 'mixamorigLeftForeArm', p: [-0.205, 0.355, 0.020], sigma: 0.055, group: 'leftArm', side: -1 },
  { name: 'mixamorigRightShoulder', parent: 'mixamorigSpine2', p: [0.105, 0.710, 0], sigma: 0.050, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightArm', parent: 'mixamorigRightShoulder', p: [0.165, 0.630, 0], sigma: 0.052, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightForeArm', parent: 'mixamorigRightArm', p: [0.205, 0.485, 0.010], sigma: 0.050, group: 'rightArm', side: 1 },
  { name: 'mixamorigRightHand', parent: 'mixamorigRightForeArm', p: [0.205, 0.355, 0.020], sigma: 0.055, group: 'rightArm', side: 1 },
  { name: 'mixamorigLeftUpLeg', parent: 'mixamorigHips', p: [-0.065, 0.345, 0], sigma: 0.065, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftLeg', parent: 'mixamorigLeftUpLeg', p: [-0.065, 0.190, 0], sigma: 0.060, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftFoot', parent: 'mixamorigLeftLeg', p: [-0.065, 0.060, 0.010], sigma: 0.050, group: 'leftLeg', side: -1 },
  { name: 'mixamorigLeftToeBase', parent: 'mixamorigLeftFoot', p: [-0.065, 0.035, 0.065], sigma: 0.045, group: 'leftLeg', side: -1 },
  { name: 'mixamorigRightUpLeg', parent: 'mixamorigHips', p: [0.065, 0.345, 0], sigma: 0.065, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightLeg', parent: 'mixamorigRightUpLeg', p: [0.065, 0.190, 0], sigma: 0.060, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightFoot', parent: 'mixamorigRightLeg', p: [0.065, 0.060, 0.010], sigma: 0.050, group: 'rightLeg', side: 1 },
  { name: 'mixamorigRightToeBase', parent: 'mixamorigRightFoot', p: [0.065, 0.035, 0.065], sigma: 0.045, group: 'rightLeg', side: 1 },
];
const boneByName = new Map(bones.map((bone, index) => [bone.name, { ...bone, index }]));
for (const bone of bones) {
  const parent = bone.parent ? boneByName.get(bone.parent) : null;
  bone.local = parent ? bone.p.map((value, axis) => value - parent.p[axis]) : bone.p;
}

// Discard the all-root source bind, retaining only the exact mesh, face, normals and UV layout.
const sourceNodes = [...root.listNodes()];
const sourceParent = meshNode.getParentNode();
if (sourceParent) sourceParent.removeChild(meshNode);
else if (scene.listChildren().includes(meshNode)) scene.removeChild(meshNode);
else throw new Error('The source mesh node is detached from the scene.');
primitive.setAttribute('JOINTS_0', null).setAttribute('WEIGHTS_0', null);
meshNode.setSkin(null).setName('AshveilWraithMesh').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
for (const skin of [...root.listSkins()]) skin.dispose();
for (const node of sourceNodes) if (node !== meshNode) node.dispose();
scene.setName('AshveilWraithScene');
const presentationRoot = doc.createNode('AshveilWraithPresentation').setScale([2.05, 2.05, 2.05]);
const rigContainer = doc.createNode('AshveilWraithArmature');
scene.addChild(presentationRoot);
presentationRoot.addChild(rigContainer);
rigContainer.addChild(meshNode);

const jointNodes = new Map();
for (const bone of bones) {
  const node = doc.createNode(bone.name).setTranslation(bone.local);
  jointNodes.set(bone.name, node);
  const parent = bone.parent ? jointNodes.get(bone.parent) : rigContainer;
  parent.addChild(node);
}
const skin = doc.createSkin('AshveilWraith_UnityHumanoid').setSkeleton(jointNodes.get('mixamorigHips'));
for (const bone of bones) skin.addJoint(jointNodes.get(bone.name));
const inverseBinds = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i++) {
  const [x, y, z] = bones[i].p;
  inverseBinds.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
}
const buffer = root.listBuffers()[0];
skin.setInverseBindMatrices(doc.createAccessor('AshveilWraith_InverseBind').setArray(inverseBinds).setType(Accessor.Type.MAT4).setBuffer(buffer));
meshNode.setSkin(skin);

function segmentDistance(point, start, end) {
  const vector = end.map((value, axis) => value - start[axis]);
  const length2 = vector.reduce((sum, value) => sum + value * value, 0) || 1;
  const t = Math.max(0, Math.min(1, point.reduce((sum, value, axis) => sum + (value - start[axis]) * vector[axis], 0) / length2));
  return Math.hypot(...point.map((value, axis) => value - (start[axis] + t * vector[axis])));
}
const jointValues = new Uint16Array(positions.length / 3 * 4);
const weightValues = new Float32Array(positions.length / 3 * 4);
const influenceCoverage = new Uint32Array(bones.length);
let maximumWeightSumError = 0;
let headZoneVertices = 0;
let headZoneHeadInfluence = 0;
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const [x, y] = point;
  const candidates = [];
  for (const bone of bones) {
    let gate = 1;
    if (bone.group === 'head') gate = y >= 0.76 ? 8 : 0.008;
    if (bone.group === 'leftArm' || bone.group === 'rightArm') {
      gate = y > 0.25 && y < 0.88 ? 1 : 0.005;
      const lateral = bone.side * x;
      gate *= 0.012 + 0.988 / (1 + Math.exp(-(lateral - 0.105) / 0.028));
    }
    if (bone.group === 'leftLeg' || bone.group === 'rightLeg') {
      gate = y < 0.38 ? 1 : 0.004;
      const lateral = bone.side * x;
      gate *= 0.02 + 0.98 / (1 + Math.exp(-(lateral - 0.038) / 0.025));
    }
    const parent = bone.parent ? boneByName.get(bone.parent) : null;
    const distance = segmentDistance(point, parent?.p ?? bone.p, bone.p);
    const score = gate * Math.exp(-0.5 * (distance / bone.sigma) ** 2);
    if (score > 1e-10) candidates.push({ index: boneByName.get(bone.name).index, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 4);
  if (!chosen.length) throw new Error(`No anatomical weights could be assigned to source vertex ${vertex}.`);
  const total = chosen.reduce((sum, candidate) => sum + candidate.score, 0);
  let assigned = 0;
  for (let slot = 0; slot < 4; slot++) {
    const candidate = chosen[slot] ?? chosen[0];
    const weight = slot >= chosen.length ? 0 : slot === chosen.length - 1 ? 1 - assigned : candidate.score / total;
    jointValues[vertex * 4 + slot] = candidate.index;
    weightValues[vertex * 4 + slot] = weight;
    assigned += weight;
    if (weight > 1e-6) influenceCoverage[candidate.index]++;
  }
  const sum = weightValues[vertex * 4] + weightValues[vertex * 4 + 1] + weightValues[vertex * 4 + 2] + weightValues[vertex * 4 + 3];
  maximumWeightSumError = Math.max(maximumWeightSumError, Math.abs(sum - 1));
  if (y >= 0.80) {
    headZoneVertices++;
    headZoneHeadInfluence += weightValues.slice(vertex * 4, vertex * 4 + 4).reduce((sum, weight, slot) =>
      sum + (jointValues[vertex * 4 + slot] === boneByName.get('mixamorigHead').index ? weight : 0), 0);
  }
}
const headZoneHeadAverage = headZoneVertices ? headZoneHeadInfluence / headZoneVertices : 0;
if (headZoneHeadAverage < 0.9) throw new Error(`Upper face/head area is not held by the stable head bone: ${headZoneHeadAverage.toFixed(3)}.`);
primitive.setAttribute('JOINTS_0', doc.createAccessor('AshveilWraith_Joints0').setArray(jointValues).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('AshveilWraith_Weights0').setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(buffer));

const quat = (axis, angle) => {
  const sine = Math.sin(angle / 2), cosine = Math.cos(angle / 2);
  if (axis === 'x') return [sine, 0, 0, cosine];
  if (axis === 'y') return [0, sine, 0, cosine];
  return [0, 0, sine, cosine];
};
const clips = [];
function addClip(name, seconds, tracks) {
  const animation = doc.createAnimation(name);
  for (const track of tracks) {
    const input = doc.createAccessor(`${name}_${track.node}_${track.path ?? 'rotation'}_time`).setArray(Float32Array.from(track.times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const output = doc.createAccessor(`${name}_${track.node}_${track.path ?? 'rotation'}_value`)
      .setArray(Float32Array.from(track.values.flat())).setType(track.path === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4).setBuffer(buffer);
    const sampler = doc.createAnimationSampler(`${name}_${track.node}_${track.path ?? 'rotation'}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${track.node}_${track.path ?? 'rotation'}`)
      .setTargetNode(jointNodes.get(track.node)).setTargetPath(track.path ?? 'rotation').setSampler(sampler));
  }
  clips.push({ name, seconds, channels: tracks.length });
}
const q = (axis, ...angles) => angles.map(angle => quat(axis, angle));
const idleTimes = [0, 0.7, 1.4, 2.1, 2.8];
addClip('Idle', 2.8, [
  { node: 'mixamorigHips', path: 'translation', times: idleTimes, values: [[0, .405, 0], [0, .420, -.006], [0, .405, 0], [0, .390, .006], [0, .405, 0]] },
  { node: 'mixamorigSpine1', times: idleTimes, values: q('z', 0, .025, 0, -.025, 0) },
  { node: 'mixamorigSpine2', times: idleTimes, values: q('x', 0, -.018, 0, .018, 0) },
  { node: 'mixamorigHead', times: idleTimes, values: q('y', -.018, .012, .025, -.010, -.018) },
]);
const glideTimes = [0, .3125, .625, .9375, 1.25];
addClip('Walk', 1.25, [
  { node: 'mixamorigHips', path: 'translation', times: glideTimes, values: [[0,.405,-.020], [0,.426,0], [0,.405,.020], [0,.384,0], [0,.405,-.020]] },
  { node: 'mixamorigSpine1', times: glideTimes, values: q('z', -.045, 0, .045, 0, -.045) },
  { node: 'mixamorigSpine2', times: glideTimes, values: q('y', -.045, 0, .045, 0, -.045) },
  { node: 'mixamorigLeftArm', times: glideTimes, values: q('x', -.08, -.02, .08, .02, -.08) },
  { node: 'mixamorigRightArm', times: glideTimes, values: q('x', .08, .02, -.08, -.02, .08) },
]);
const runTimes = [0, .2, .4, .6, .8];
addClip('Run', .8, [
  { node: 'mixamorigHips', path: 'translation', times: runTimes, values: [[0,.405,-.025], [0,.444,0], [0,.405,.025], [0,.366,0], [0,.405,-.025]] },
  { node: 'mixamorigSpine1', times: runTimes, values: q('z', -.075, 0, .075, 0, -.075) },
  { node: 'mixamorigSpine2', times: runTimes, values: q('x', .035, .08, .035, -.01, .035) },
  { node: 'mixamorigLeftArm', times: runTimes, values: q('x', -.18, -.04, .18, .04, -.18) },
  { node: 'mixamorigRightArm', times: runTimes, values: q('x', .18, .04, -.18, -.04, .18) },
]);
const attackTimes = [0, .16, .32, .50, .78];
addClip('Attack', .78, [
  { node: 'mixamorigSpine1', times: attackTimes, values: q('x', 0, .025, -.13, -.10, 0) },
  { node: 'mixamorigSpine2', times: attackTimes, values: q('x', 0, .045, -.18, -.10, 0) },
  { node: 'mixamorigHead', times: attackTimes, values: q('x', 0, -.025, .10, .04, 0) },
  { node: 'mixamorigLeftArm', times: attackTimes, values: q('z', -.08, -.40, -.64, .38, -.08) },
  { node: 'mixamorigLeftForeArm', times: attackTimes, values: q('z', 0, -.08, -.24, .26, 0) },
  { node: 'mixamorigRightArm', times: attackTimes, values: q('z', .08, .36, .48, -.56, .08) },
  { node: 'mixamorigRightForeArm', times: attackTimes, values: q('z', 0, .08, .18, -.28, 0) },
]);
const hitTimes = [0, .09, .20, .36, .50];
addClip('Hit', .50, [
  { node: 'mixamorigSpine1', times: hitTimes, values: q('x', 0, .13, .07, -.025, 0) },
  { node: 'mixamorigSpine2', times: hitTimes, values: q('x', 0, .18, .08, -.03, 0) },
  { node: 'mixamorigHead', times: hitTimes, values: q('x', 0, -.14, -.06, .025, 0) },
  { node: 'mixamorigLeftArm', times: hitTimes, values: q('z', 0, -.30, -.19, -.04, 0) },
  { node: 'mixamorigRightArm', times: hitTimes, values: q('z', 0, .32, .18, .04, 0) },
]);
const deathTimes = [0, .35, .8, 1.35, 2.0];
addClip('Death', 2.0, [
  { node: 'mixamorigHips', path: 'translation', times: deathTimes, values: [[0,.405,0], [0,.465,0], [0,.510,0], [0,.485,0], [0,.465,0]] },
  { node: 'mixamorigHips', times: deathTimes, values: q('z', 0, -.06, -.17, -.31, -.31) },
  { node: 'mixamorigSpine1', times: deathTimes, values: q('x', 0, .10, .24, .31, .31) },
  { node: 'mixamorigSpine2', times: deathTimes, values: q('x', 0, .08, .20, .27, .27) },
  { node: 'mixamorigHead', times: deathTimes, values: q('z', 0, .08, .18, .25, .25) },
  { node: 'mixamorigLeftArm', times: deathTimes, values: q('z', 0, -.16, -.46, -.60, -.60) },
  { node: 'mixamorigRightArm', times: deathTimes, values: q('z', 0, .18, .48, .62, .62) },
  { node: 'mixamorigLeftUpLeg', times: deathTimes, values: q('x', 0, -.06, -.18, -.24, -.24) },
  { node: 'mixamorigRightUpLeg', times: deathTimes, values: q('x', 0, .06, .18, .24, .24) },
]);

const sourceTextureMetrics = [];
const runtimeTextureMetrics = [];
const material = root.listMaterials()[0];
const baseColorTexture = material?.getBaseColorTexture();
const metallicRoughnessTexture = material?.getMetallicRoughnessTexture();
const normalTexture = material?.getNormalTexture();
if (!baseColorTexture || !metallicRoughnessTexture || !normalTexture) throw new Error('The starred shade is missing one of its embedded 8K/PBR maps.');
for (const texture of root.listTextures()) {
  const original = texture.getImage();
  const metadata = await sharp(original).metadata();
  sourceTextureMetrics.push({ name: texture.getName(), width: metadata.width, height: metadata.height, mime: texture.getMimeType(), sha256: createHash('sha256').update(original).digest('hex') });
  if (metadata.width > 2048 || metadata.height > 2048) {
    const isDataTexture = texture === metallicRoughnessTexture || texture === normalTexture;
    const encoded = await sharp(original).resize(2048, 2048, { fit: 'fill', kernel: isDataTexture ? 'linear' : 'lanczos3' })
      .toFormat(metadata.format === 'jpeg' ? 'jpeg' : 'png', metadata.format === 'jpeg' ? { quality: 92, chromaSubsampling: '4:4:4' } : {})
      .toBuffer();
    texture.setImage(encoded);
  }
  const runtime = await sharp(texture.getImage()).metadata();
  runtimeTextureMetrics.push({ name: texture.getName(), width: runtime.width, height: runtime.height, mime: texture.getMimeType(), bytes: texture.getImage().length });
  if (runtime.width > 2048 || runtime.height > 2048) throw new Error(`Runtime texture exceeds 2K: ${texture.getName()}`);
}
const pbrSample = await sharp(metallicRoughnessTexture.getImage()).removeAlpha().resize(128, 128).raw().toBuffer();
const pbrRanges = {};
for (const [name, channel] of [['occlusion', 0], ['roughness', 1], ['metallic', 2]]) {
  const values = [];
  for (let i = channel; i < pbrSample.length; i += 3) values.push(pbrSample[i]);
  values.sort((a, b) => a - b);
  pbrRanges[name] = [values[0] / 255, values[Math.floor(values.length * .5)] / 255, values[values.length - 1] / 255];
}
if (!(pbrRanges.roughness[2] - pbrRanges.roughness[0] > .2) || !(pbrRanges.metallic[2] - pbrRanges.metallic[0] > .05)) {
  throw new Error(`The packed PBR maps lost useful material variation: ${JSON.stringify(pbrRanges)}.`);
}

const outputBytes = await io.writeBinary(doc);
await writeFile(candidatePath, outputBytes);
const candidateSha256 = createHash('sha256').update(outputBytes).digest('hex');
const checkDoc = await io.readBinary(outputBytes);
const checkRoot = checkDoc.getRoot();
const checkMesh = checkRoot.listMeshes()[0];
const checkPrimitive = checkMesh?.listPrimitives()[0];
const checkPositions = checkPrimitive?.getAttribute('POSITION')?.getArray();
const checkNormals = checkPrimitive?.getAttribute('NORMAL')?.getArray();
const checkUvs = checkPrimitive?.getAttribute('TEXCOORD_0')?.getArray();
const checkIndices = checkPrimitive?.getIndices()?.getArray();
const checkJoints = checkPrimitive?.getAttribute('JOINTS_0')?.getArray();
const checkWeights = checkPrimitive?.getAttribute('WEIGHTS_0')?.getArray();
const checkSkin = checkRoot.listSkins()[0];
if (!checkPositions || !checkNormals || !checkUvs || !checkIndices || !checkJoints || !checkWeights || !checkSkin) {
  throw new Error('Exported shade is missing required mesh, skin or UV data.');
}
const postHashes = { positions: geometryHash(checkPositions), normals: geometryHash(checkNormals), uvs: geometryHash(checkUvs), indices: geometryHash(checkIndices) };
if (JSON.stringify(postHashes) !== JSON.stringify(sourceGeometryHashes)) throw new Error('Source geometry/UV preservation check failed.');
let maxPositionDelta = 0, maxNormalDelta = 0, maxUvsDelta = 0, indexMismatches = 0, verticesWithDistributedWeights = 0;
for (let i = 0; i < checkPositions.length; i++) maxPositionDelta = Math.max(maxPositionDelta, Math.abs(checkPositions[i] - positions[i]));
for (let i = 0; i < checkNormals.length; i++) maxNormalDelta = Math.max(maxNormalDelta, Math.abs(checkNormals[i] - normals[i]));
for (let i = 0; i < checkUvs.length; i++) maxUvsDelta = Math.max(maxUvsDelta, Math.abs(checkUvs[i] - uvs[i]));
for (let i = 0; i < checkIndices.length; i++) if (checkIndices[i] !== indices[i]) indexMismatches++;
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  let sum = 0, nonzero = 0;
  for (let slot = 0; slot < 4; slot++) {
    const joint = checkJoints[vertex * 4 + slot], weight = checkWeights[vertex * 4 + slot];
    if (!Number.isInteger(joint) || joint < 0 || joint >= checkSkin.listJoints().length || !Number.isFinite(weight) || weight < 0) throw new Error(`Invalid skin weight at vertex ${vertex}.`);
    sum += weight;
    if (weight > 1e-6) nonzero++;
  }
  if (Math.abs(sum - 1) > 1e-5) throw new Error(`Vertex ${vertex} has non-normalized skin weights: ${sum}`);
  if (nonzero > 1) verticesWithDistributedWeights++;
}
if (maxPositionDelta || maxNormalDelta || maxUvsDelta || indexMismatches || verticesWithDistributedWeights < positions.length / 3 * .72) {
  throw new Error(`Candidate preservation/weight check failed: Δp=${maxPositionDelta}, Δn=${maxNormalDelta}, Δuv=${maxUvsDelta}, index mismatches=${indexMismatches}, distributed=${verticesWithDistributedWeights}.`);
}
const clipNames = checkRoot.listAnimations().map(animation => animation.getName());
const required = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
if (required.some(name => !clipNames.includes(name))) throw new Error(`Missing required creature clip: ${required.filter(name => !clipNames.includes(name)).join(', ')}.`);
for (const animation of checkRoot.listAnimations()) for (const channel of animation.listChannels()) {
  if (!checkSkin.listJoints().includes(channel.getTargetNode())) throw new Error(`${animation.getName()} targets an unskinned node.`);
}

const scaledBounds = {
  min: bounds.min.map(value => value * 2.05), max: bounds.max.map(value => value * 2.05),
};
const size = scaledBounds.max.map((value, axis) => value - scaledBounds.min[axis]);
const candidate = {
  schema: 'corealm-creature-native-rig-candidate/1',
  id: 'creature_pallid_shade', displayName: 'Ashveil Wraith', status: 'awaiting-root-lab-review', accepted: false,
  userDirection: 'Include this exact starred shade as-is, including its smooth face with the vertical split; no face replacement or mesh edits.',
  source: {
    file: sourcePath, sha256: sourceSha256, bytes: sourceBytes.length,
    starredModelId: 'bee97dff-f4bc-415f-85f5-7166421b3cf4', tripoProjectId: 'cc8d0574-7f00-44f2-97c0-09fa30e9f6e2',
    starredTitle: 'floating shade', triangles: indices.length / 3, vertices: positions.length / 3,
    geometry: { bounds, hashes: sourceGeometryHashes, retopology: false },
    originalTripoRig: { joints: 54, sourceClips: 0, defect: '3392 of 3395 source vertices bind to BoneRoot; source limb weights are unusable.' },
    textures: sourceTextureMetrics, sourceMaterials: { metallicFactor: 1, roughnessFactor: 1 },
  },
  candidate: {
    file: candidatePath, sha256: candidateSha256, bytes: outputBytes.length,
    productionTarget: 'game/public/assets/models/creature/creature_pallid_shade.glb',
    geometry: { vertices: positions.length / 3, triangles: indices.length / 3, positionsPreserved: true, normalsPreserved: true, indicesPreserved: true, uvPreserved: true, scaledBounds, size },
    rig: {
      type: 'Mixamo-named Unity Humanoid-mappable glTF skin', joints: bones.map(bone => ({ name: bone.name, parent: bone.parent, position: bone.p })),
      influencesPerVertex: 4, verticesWithDistributedWeights, maximumWeightSumError,
      stableHeadZone: { vertices: headZoneVertices, averageHeadWeight: headZoneHeadAverage },
      method: 'Model-specific, four-weight anatomical distance-field fit. Head area has a stable head-only bias; original mesh, face and UVs are unchanged.',
    },
    textures: runtimeTextureMetrics, packedPbrRanges: pbrRanges, animations: clips,
  },
  acceptance: { userDesignDecision: true, geometry: true, rig: false, animation: false, textures: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${baseDir}/catalog.json`, JSON.stringify(candidate, null, 2) + '\n');

const labAsset = {
  id: 'creature_pallid_shade', file: 'models/creature/creature_pallid_shade.glb', pack: 'corealm-starred-creatures', category: 'character',
  is: 'Ashveil Wraith', tags: ['creature', 'wraith', 'floating', 'wilderness', 'starred', 'tripo', 'candidate'],
  bytes: outputBytes.length, sha256: candidateSha256, size: { x: size[0], y: size[1], z: size[2] },
  base: { x: scaledBounds.min[0], y: scaledBounds.min[1], z: scaledBounds.min[2] }, bounds: scaledBounds, groundY: scaledBounds.min[1],
  triangles: indices.length / 3, animations: clipNames, materials: checkRoot.listMaterials().map(entry => entry.getName()),
  walkClipSeconds: 1.25, runClipSeconds: .8, attackSeconds: .78, contactNormalized: .45,
  sourceProvenance: {
    author: 'Corealm candidate rig reconstruction', sourceModelId: 'bee97dff-f4bc-415f-85f5-7166421b3cf4',
    tripoProjectId: 'cc8d0574-7f00-44f2-97c0-09fa30e9f6e2', sourceFile: sourcePath, sourceSha256,
    candidateFile: candidatePath, candidateSha256, rigMethod: candidate.candidate.rig.method,
    locomotion: 'Hover and spectral drift. Walk and Run clip names are preserved for the game action map; neither clip uses planted ground contact.',
    originalGeometryAndFaceUnchanged: true, noRetopology: true, sourceTexturesPreserved: true,
    runtimeTexturePolicy: { maxDimension: 2048, originalsPreserved: true }, textures: runtimeTextureMetrics,
    candidateStatus: 'awaiting-root-lab-review', userApprovedFaceDesignAsIs: true,
  },
  acceptance: { assetAudit: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${baseDir}/lab-catalog.json`, JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', assets: [labAsset], files: { [labAsset.id]: path.basename(candidatePath) }, pack: { id: 'corealm-starred-creatures', name: 'Corealm starred creatures', author: 'Corealm', source: 'https://studio.tripo3d.ai/', license: 'LicenseRef-Tripo-Generated' } }, null, 2) + '\n');
console.log(JSON.stringify({ candidatePath, candidateSha256, bytes: outputBytes.length, triangles: indices.length / 3, vertices: positions.length / 3, joints: bones.length, clips, runtimeTextureMetrics, pbrRanges, verticesWithDistributedWeights, maximumWeightSumError, headZoneHeadAverage, geometryUnchanged: true }, null, 2));
