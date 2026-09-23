import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../../');
const sourceRelative = 'assets/art/tripo/exports/d1c16cfc-3f64-4e48-8205-9b53502184f8.glb';
const sourcePath = path.join(repo, sourceRelative);
const generatedAlbedoPath = path.join(here, 'leaf-sentinel-imagegen-basecolor.png');
const candidatePath = path.join(here, 'leaf-sentinel-native-rig-candidate.glb');
const catalogPath = path.join(here, 'catalog.json');
const labCatalogPath = path.join(here, 'lab-catalog.json');
const expectedSourceSha256 = '5df89799c3b9a27e0f151e2f93897de852a8cc780255ff9997d7c38a543495c7';
const sourceModelId = 'd1c16cfc-3f64-4e48-8205-9b53502184f8';
const sourcePrompt = 'green plant-like humanoid creature with leaf-like armor, bipedal stance, textured skin and brown veins';

await mkdir(here, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
assert.equal(sourceSha256, expectedSourceSha256, 'The pinned starred export changed.');
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const sourceMesh = root.listMeshes()[0];
const primitive = sourceMesh?.listPrimitives()[0];
const meshNode = root.listNodes().find(node => node.getMesh() === sourceMesh);
const sourceSkin = root.listSkins()[0];
assert(scene && primitive && meshNode && sourceSkin, 'Expected one skinned creature export.');
assert.equal(root.listMeshes().length, 1, 'Expected a single creature mesh.');
assert.equal(root.listSkins().length, 1, 'Expected a single source skin.');
assert.equal(root.listAnimations().length, 0, 'The pinned export must remain unanimated before rigging.');

const positions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
const normals = Float32Array.from(primitive.getAttribute('NORMAL')?.getArray() ?? []);
const uvs = Float32Array.from(primitive.getAttribute('TEXCOORD_0')?.getArray() ?? []);
const indices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
const vertexCount = positions.length / 3;
const triangleCount = indices.length / 3;
assert.equal(vertexCount, 3161, 'Decoded source vertex count changed.');
assert.equal(triangleCount, 4474, 'Decoded source triangle count changed.');
assert.equal(normals.length, positions.length, 'Expected one source normal per vertex.');
assert.equal(uvs.length, vertexCount * 2, 'Expected one retained UV per vertex.');
const sourceBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  sourceBounds.min[axis] = Math.min(sourceBounds.min[axis], positions[i + axis]);
  sourceBounds.max[axis] = Math.max(sourceBounds.max[axis], positions[i + axis]);
}
assert(Math.abs(sourceBounds.min[1]) < 1e-6 && sourceBounds.max[1] > .98, `Unexpected source orientation or grounding: ${JSON.stringify(sourceBounds)}`);
const sourceHeight = sourceBounds.max[1] - sourceBounds.min[1];
const targetLabAssetId = 'fairy_garden_sapling_gloamgarden';
const targetCreatureRows = JSON.parse(await readFile(path.join(repo, 'game/content/data/creatureDefinitions.json'), 'utf8'));
const targetCreature = targetCreatureRows.find(creature => creature.presentation?.assetId === targetLabAssetId);
assert(targetCreature && targetCreature.level === 30, 'Expected the existing T30 Briar Sapling source slot.');
const existingSlotScale = 0.4094204513089124;
assert(Math.abs(targetCreature.presentation.scale - existingSlotScale) < 1e-12, `Briar Sapling slot scale changed: ${targetCreature.presentation.scale}.`);
const targetTier = 30;
const tierSilhouetteScale = .9 + .5 * (Math.log(targetTier) / Math.log(99));
const targetDrawnHeightMeters = 1.5;
const candidateAssetScale = targetDrawnHeightMeters / (sourceHeight * existingSlotScale * tierSilhouetteScale);
const bounds = {
  min: sourceBounds.min.map(value => value * candidateAssetScale),
  max: sourceBounds.max.map(value => value * candidateAssetScale),
};

const sourceMaterials = root.listMaterials();
assert.equal(sourceMaterials.length, 1, 'Expected one material to receive the layered plant maps.');
const material = sourceMaterials[0];
assert(material.getBaseColorTexture() && material.getMetallicRoughnessTexture() && material.getNormalTexture(), 'Source is missing a PBR texture map.');
const sourceTextureInfo = [];
for (const texture of root.listTextures()) {
  const meta = await sharp(texture.getImage()).metadata();
  sourceTextureInfo.push({ name: texture.getName(), mimeType: texture.getMimeType(), dimensions: [meta.width, meta.height], bytes: texture.getImage().length });
}

// Y-up, front facing +Z. This Generic plant rig follows the source's rooted biped shape,
// with flexible trunk, crown, paired branch arms and root-like two-segment legs.
// No Humanoid mapping is authored and no source vertex, normal, index or UV is moved.
const bones = [];
function addBone(name, parent, p, group, options = {}) {
  bones.push({ name, parent, p, group, sigma: options.sigma ?? .12, side: options.side ?? 0, ...options });
}
addBone('SentinelRoot', null, [0, 0, 0], 'root', { sigma: .8 });
addBone('RootCore', 'SentinelRoot', [0, .37, 0], 'core', { sigma: .15 });
addBone('StemLower', 'RootCore', [0, .49, 0], 'core', { sigma: .135 });
addBone('StemUpper', 'StemLower', [0, .625, .005], 'core', { sigma: .12 });
addBone('NeckStem', 'StemUpper', [0, .76, .01], 'core', { sigma: .10 });
addBone('FaceCrown', 'NeckStem', [0, .875, .035], 'head', { sigma: .095 });
addBone('CrownTip', 'FaceCrown', [0, .955, -.005], 'head', { sigma: .085 });
for (const side of [-1, 1]) {
  const suffix = side < 0 ? 'L' : 'R';
  addBone(`RootHip_${suffix}`, 'RootCore', [side * .085, .385, -.005], 'leg', { sigma: .11, side });
  addBone(`RootKnee_${suffix}`, `RootHip_${suffix}`, [side * .105, .23, -.002], 'leg', { sigma: .10, side });
  addBone(`RootAnkle_${suffix}`, `RootKnee_${suffix}`, [side * .11, .092, .018], 'leg', { sigma: .09, side });
  addBone(`RootFoot_${suffix}`, `RootAnkle_${suffix}`, [side * .11, .028, .084], 'leg', { sigma: .085, side });
  addBone(`BoughShoulder_${suffix}`, 'StemUpper', [side * .112, .684, .006], 'arm', { sigma: .105, side });
  addBone(`BoughElbow_${suffix}`, `BoughShoulder_${suffix}`, [side * .218, .587, .02], 'arm', { sigma: .105, side });
  addBone(`BoughWrist_${suffix}`, `BoughElbow_${suffix}`, [side * .305, .493, .042], 'arm', { sigma: .095, side });
  addBone(`BoughHand_${suffix}`, `BoughWrist_${suffix}`, [side * .362, .431, .055], 'arm', { sigma: .09, side });
  addBone(`CrownLeaf_${suffix}`, 'FaceCrown', [side * .082, .952, -.028], 'crown', { sigma: .08, side });
}
const boneByName = new Map(bones.map((bone, index) => [bone.name, { ...bone, index }]));
assert.equal(bones.length, 25, 'Unexpected Leaf Sentinel rig size.');
for (const bone of bones) {
  const parent = bone.parent ? boneByName.get(bone.parent) : null;
  assert(!bone.parent || parent, `Missing parent for ${bone.name}.`);
  bone.local = parent ? bone.p.map((value, axis) => value - parent.p[axis]) : [...bone.p];
}

function segmentDistance(point, start, end) {
  const vector = end.map((value, axis) => value - start[axis]);
  const length2 = vector.reduce((sum, value) => sum + value * value, 0) || 1;
  const t = Math.max(0, Math.min(1, point.reduce((sum, value, axis) => sum + (value - start[axis]) * vector[axis], 0) / length2));
  return Math.hypot(...point.map((value, axis) => value - (start[axis] + vector[axis] * t)));
}
const sigmoid = value => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
function groupGate(bone, [x, y]) {
  const ax = Math.abs(x);
  if (bone.group === 'root') return .002;
  if (bone.group === 'core') return sigmoid((.235 - ax) / .04) * sigmoid((y - .27) / .06) * sigmoid((.90 - y) / .06);
  if (bone.group === 'head') return sigmoid((y - .72) / .055) * sigmoid((.225 - ax) / .04);
  if (bone.group === 'crown') return sigmoid((y - .88) / .04) * (.04 + .96 * sigmoid((bone.side * x + .018) / .025));
  if (bone.group === 'arm') return sigmoid((bone.side * x - .065) / .035) * sigmoid((y - .32) / .055) * sigmoid((.86 - y) / .055);
  if (bone.group === 'leg') return sigmoid((bone.side * x - .018) / .04) * sigmoid((.53 - y) / .055);
  return 0;
}
const joints = new Uint16Array(vertexCount * 4);
const weights = new Float32Array(vertexCount * 4);
const jointCoverage = new Uint32Array(bones.length);
let maximumWeightSumError = 0;
let multiWeightedVertices = 0;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const candidates = [];
  for (const bone of bones) {
    const parent = bone.parent ? boneByName.get(bone.parent) : null;
    const distance = segmentDistance(point, parent?.p ?? bone.p, bone.p);
    const gate = groupGate(bone, point);
    const score = gate * Math.exp(-.5 * (distance / bone.sigma) ** 2);
    if (score > 1e-12) candidates.push({ index: boneByName.get(bone.name).index, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const selected = candidates.slice(0, 4);
  assert(selected.length, `Vertex ${vertex} has no weight candidates.`);
  const total = selected.reduce((sum, candidate) => sum + candidate.score, 0);
  let assigned = 0;
  let active = 0;
  for (let slot = 0; slot < 4; slot++) {
    const candidate = selected[slot] ?? selected[0];
    const weight = slot >= selected.length ? 0 : slot === selected.length - 1 ? 1 - assigned : candidate.score / total;
    joints[vertex * 4 + slot] = candidate.index;
    weights[vertex * 4 + slot] = weight;
    assigned += weight;
    if (weight > 1e-6) { jointCoverage[candidate.index]++; active++; }
  }
  if (active > 1) multiWeightedVertices++;
  maximumWeightSumError = Math.max(maximumWeightSumError, Math.abs(assigned - 1));
}
assert(multiWeightedVertices / vertexCount > .60, `Too few vertices blend across the authored rig (${multiWeightedVertices}/${vertexCount}).`);
const unweightedJoints = bones.filter((bone, index) => index > 0 && jointCoverage[index] === 0).map(bone => bone.name);
assert.deepEqual(unweightedJoints, [], `Rig joints received no geometry weights: ${unweightedJoints.join(', ')}`);

const rigParent = meshNode.getParentNode();
assert(rigParent, 'Expected the source mesh under an export armature.');
rigParent.removeChild(meshNode);
if (scene.listChildren().includes(rigParent)) scene.removeChild(rigParent);
meshNode.setName('LeafSentinelMesh').setSkin(null).setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
primitive.setAttribute('JOINTS_0', doc.createAccessor('LeafSentinel_Joints0').setArray(joints).setType(Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('LeafSentinel_Weights0').setArray(weights).setType(Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]));
const oldInverseBinds = sourceSkin.getInverseBindMatrices();
sourceSkin.dispose();
oldInverseBinds?.dispose();
for (const node of [...root.listNodes()].reverse()) if (node !== meshNode) node.dispose();

const rigContainer = doc.createNode('LeafSentinelGenericRig').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([candidateAssetScale, candidateAssetScale, candidateAssetScale]);
scene.addChild(rigContainer);
rigContainer.addChild(meshNode);
const jointNodes = new Map();
const restWorldMatrices = new Map();
for (const bone of bones) {
  const node = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  jointNodes.set(bone.name, node);
  const parentNode = bone.parent ? jointNodes.get(bone.parent) : rigContainer;
  assert(parentNode, `Joint parent was not created for ${bone.name}.`);
  parentNode.addChild(node);
  const local = new THREE.Matrix4().makeTranslation(...bone.local);
  restWorldMatrices.set(bone.name, bone.parent ? restWorldMatrices.get(bone.parent).clone().multiply(local) : local);
}
const skin = doc.createSkin('LeafSentinel_Generic_Skin').setSkeleton(jointNodes.get('SentinelRoot'));
for (const bone of bones) skin.addJoint(jointNodes.get(bone.name));
const inverseBinds = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i++) inverseBinds.set(restWorldMatrices.get(bones[i].name).clone().invert().toArray([]), i * 16);
skin.setInverseBindMatrices(doc.createAccessor('LeafSentinel_InverseBind').setArray(inverseBinds).setType(Accessor.Type.MAT4).setBuffer(root.listBuffers()[0]));
meshNode.setSkin(skin);

const quat = (axis, angle) => {
  const sine = Math.sin(angle / 2), cosine = Math.cos(angle / 2);
  if (axis === 'x') return [sine, 0, 0, cosine];
  if (axis === 'y') return [0, sine, 0, cosine];
  return [0, 0, sine, cosine];
};
function sampledTimes(duration, count = 5) { return Array.from({ length: count }, (_, index) => Number((duration * index / (count - 1)).toFixed(6))); }
const clips = [];
function addClip(name, duration, tracks) {
  const animation = doc.createAnimation(name);
  const times = sampledTimes(duration);
  for (const track of tracks) {
    assert(jointNodes.has(track.node), `Clip ${name} targets missing joint ${track.node}.`);
    const values = typeof track.values === 'function' ? times.map(track.values) : track.values;
    assert.equal(values.length, times.length, `Clip ${name}/${track.node} has mismatched keys.`);
    const pathName = track.path ?? 'rotation';
    const input = doc.createAccessor(`${name}_${track.node}_time`).setArray(Float32Array.from(times)).setType(Accessor.Type.SCALAR).setBuffer(root.listBuffers()[0]);
    const output = doc.createAccessor(`${name}_${track.node}_${pathName}_value`).setArray(Float32Array.from(values.flat())).setType(pathName === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]);
    const sampler = doc.createAnimationSampler(`${name}_${track.node}_${pathName}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${name}_${track.node}_${pathName}`).setTargetNode(jointNodes.get(track.node)).setTargetPath(pathName).setSampler(sampler));
  }
  clips.push({ name, duration, channels: tracks.length, intent: trackIntents[name] });
}
const trackIntents = {
  Idle: 'Quiet rooted breathing: the stem sways, the crown nods and the branch tips settle in a slow loop.',
  Walk: 'Measured root-step locomotion with alternating feet, counter-swinging boughs and a soft stem bounce.',
  Run: 'Faster charging gait with deeper foot lift, active branch counter-swing and a forward stem lean.',
  Attack: 'A forward bark-core lunge and a broad right bough sweep, with the left branch braced.',
  Hit: 'A brief backward recoil through the stem and face, with both branches flaring.',
  Death: 'The roots buckle, stem folds forward, branch arms drop and the crown settles to the ground.',
};
function rotate(node, axis, angles) { return { node, values: angles.map(angle => quat(axis, angle)) }; }
function translate(node, values) { return { node, path: 'translation', values }; }
const sideOf = suffix => suffix === 'L' ? -1 : 1;

addClip('Idle', 2.4, [
  rotate('StemLower', 'z', [0, .018, 0, -.018, 0]),
  rotate('StemUpper', 'z', [0, -.028, 0, .028, 0]),
  rotate('NeckStem', 'x', [0, .015, 0, -.01, 0]),
  rotate('FaceCrown', 'x', [0, -.035, 0, .025, 0]),
  rotate('CrownTip', 'z', [0, .035, 0, -.035, 0]),
  ...['L', 'R'].flatMap(side => [
    rotate(`BoughShoulder_${side}`, 'z', [0, sideOf(side) * .035, 0, -sideOf(side) * .025, 0]),
    rotate(`BoughWrist_${side}`, 'y', [0, sideOf(side) * .035, 0, -sideOf(side) * .03, 0]),
    rotate(`CrownLeaf_${side}`, 'z', [0, sideOf(side) * .045, 0, -sideOf(side) * .035, 0]),
  ]),
]);

function gaitTracks(amplitude, bob) {
  const angles = [0, 1, 0, -1, 0];
  return [
    translate('SentinelRoot', [[0, 0, 0], [0, bob, 0], [0, 0, 0], [0, bob, 0], [0, 0, 0]]),
    rotate('StemLower', 'x', [0, .025, 0, -.025, 0]),
    rotate('StemUpper', 'z', [0, .04, 0, -.04, 0]),
    ...['L', 'R'].flatMap(side => {
      const sign = sideOf(side);
      return [
        rotate(`RootHip_${side}`, 'x', angles.map(value => sign * value * amplitude)),
        rotate(`RootKnee_${side}`, 'x', angles.map(value => Math.max(0, value) * .55 * amplitude)),
        rotate(`RootAnkle_${side}`, 'x', angles.map(value => -sign * value * .22 * amplitude)),
        rotate(`BoughShoulder_${side}`, 'x', angles.map(value => -sign * value * .34 * amplitude)),
        rotate(`BoughElbow_${side}`, 'x', angles.map(value => Math.max(0, -value) * .18 * amplitude)),
        rotate(`CrownLeaf_${side}`, 'z', angles.map(value => sign * value * .035)),
      ];
    }),
    rotate('FaceCrown', 'x', [0, -.035, 0, .035, 0]),
  ];
}
addClip('Walk', 1.15, gaitTracks(.42, .018));
addClip('Run', .82, gaitTracks(.68, .03));
addClip('Attack', .78, [
  rotate('StemLower', 'x', [0, -.04, .05, -.02, 0]),
  rotate('StemUpper', 'x', [0, .11, .22, .13, 0]),
  rotate('NeckStem', 'x', [0, .12, .08, -.035, 0]),
  rotate('FaceCrown', 'x', [0, .09, -.03, -.05, 0]),
  rotate('BoughShoulder_R', 'z', [0, -.28, -.82, -.35, 0]),
  rotate('BoughElbow_R', 'x', [0, -.12, -.42, -.16, 0]),
  rotate('BoughWrist_R', 'x', [0, -.08, -.28, -.09, 0]),
  rotate('BoughShoulder_L', 'z', [0, .10, .28, .18, 0]),
  rotate('RootHip_L', 'x', [0, -.04, -.09, -.04, 0]),
  rotate('CrownTip', 'z', [0, -.04, .09, .02, 0]),
]);
addClip('Hit', .48, [
  rotate('StemLower', 'x', [0, -.12, -.18, -.055, 0]),
  rotate('StemUpper', 'x', [0, -.19, -.08, .05, 0]),
  rotate('FaceCrown', 'x', [0, -.22, -.08, .04, 0]),
  rotate('CrownTip', 'z', [0, .11, -.06, .025, 0]),
  rotate('BoughShoulder_L', 'z', [0, .24, .10, .02, 0]),
  rotate('BoughShoulder_R', 'z', [0, -.24, -.10, -.02, 0]),
  rotate('RootKnee_L', 'x', [0, .09, .03, 0, 0]),
  rotate('RootKnee_R', 'x', [0, -.09, -.03, 0, 0]),
]);
addClip('Death', 1.6, [
  translate('SentinelRoot', [[0, 0, 0], [0, -.01, .015], [0, -.025, .035], [0, -.055, .06], [0, -.06, .06]]),
  rotate('RootCore', 'z', [0, .04, .18, .42, .52]),
  rotate('StemLower', 'x', [0, .18, .42, .68, .72]),
  rotate('StemUpper', 'x', [0, .28, .62, .88, .9]),
  rotate('NeckStem', 'x', [0, .3, .65, .94, .96]),
  rotate('FaceCrown', 'x', [0, .34, .7, 1.02, 1.04]),
  rotate('CrownTip', 'z', [0, -.12, -.22, -.12, -.10]),
  ...['L', 'R'].flatMap(side => [
    rotate(`RootHip_${side}`, 'x', [0, -.08, -.28, -.62, -.65]),
    rotate(`RootKnee_${side}`, 'x', [0, .10, .48, .9, .92]),
    rotate(`RootAnkle_${side}`, 'x', [0, -.12, -.25, -.32, -.32]),
    rotate(`BoughShoulder_${side}`, 'z', [0, sideOf(side) * .12, sideOf(side) * .38, sideOf(side) * .62, sideOf(side) * .64]),
    rotate(`BoughElbow_${side}`, 'x', [0, .08, .28, .44, .45]),
  ]),
]);

async function downsamplePbrMap(encoded, renormalize) {
  const { data, info } = await sharp(encoded).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 4096, `Expected 4096px source PBR map, got ${info.width}.`);
  assert.equal(info.height, 4096, `Expected 4096px source PBR map, got ${info.height}.`);
  assert.equal(info.channels, 3, `Expected RGB source PBR map, got ${info.channels} channels.`);
  const output = Buffer.alloc(2048 * 2048 * 3);
  for (let y = 0; y < 2048; y++) for (let x = 0; x < 2048; x++) {
    const out = (y * 2048 + x) * 3, a = ((y * 2) * 4096 + x * 2) * 3, b = a + 3, c = a + 4096 * 3, d = c + 3;
    let red = (data[a] + data[b] + data[c] + data[d]) / 4;
    let green = (data[a + 1] + data[b + 1] + data[c + 1] + data[d + 1]) / 4;
    let blue = (data[a + 2] + data[b + 2] + data[c + 2] + data[d + 2]) / 4;
    if (renormalize) {
      let nx = red / 127.5 - 1, ny = green / 127.5 - 1, nz = blue / 127.5 - 1;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length; ny /= length; nz /= length;
      red = (nx + 1) * 127.5; green = (ny + 1) * 127.5; blue = (nz + 1) * 127.5;
    }
    output[out] = Math.round(red); output[out + 1] = Math.round(green); output[out + 2] = Math.round(blue);
  }
  return output;
}
const runtimeTextures = [];
for (const texture of root.listTextures()) {
  const role = texture === material.getBaseColorTexture() ? 'base-color'
    : texture === material.getMetallicRoughnessTexture() ? 'metallic-roughness'
      : texture === material.getNormalTexture() ? 'normal' : null;
  assert(role, `Unexpected unclassified texture: ${texture.getName()}.`);
  const original = await sharp(texture.getImage()).metadata();
  let output, mimeType;
  if (role === 'base-color') {
    const generated = await readFile(generatedAlbedoPath);
    const generatedMeta = await sharp(generated).metadata();
    assert(generatedMeta.width > 1024 && generatedMeta.height > 1024, 'The generated layered plant atlas must retain high detail.');
    output = await sharp(generated).resize({ width: 2048, height: 2048, kernel: 'lanczos3' }).jpeg({ quality: 96, mozjpeg: true }).toBuffer();
    mimeType = 'image/jpeg';
  } else {
    const raw = await downsamplePbrMap(texture.getImage(), role === 'normal');
    if (role === 'normal') {
      output = await sharp(raw, { raw: { width: 2048, height: 2048, channels: 3 } }).jpeg({ quality: 96, chromaSubsampling: '4:4:4' }).toBuffer();
      mimeType = 'image/jpeg';
    } else {
      output = await sharp(raw, { raw: { width: 2048, height: 2048, channels: 3 } }).png().toBuffer();
      mimeType = 'image/png';
    }
  }
  texture.setMimeType(mimeType).setImage(output);
  const after = await sharp(output).metadata();
  assert.deepEqual([after.width, after.height], [2048, 2048], `${role} map is not 2K.`);
  runtimeTextures.push({ name: texture.getName(), role, sourceDimensions: [original.width, original.height], runtimeDimensions: [after.width, after.height], mimeType, bytes: output.length, sha256: createHash('sha256').update(output).digest('hex') });
}
material.setMetallicFactor(0).setRoughnessFactor(1);

const candidateBytes = await io.writeBinary(doc);
await writeFile(candidatePath, candidateBytes);
const candidateSha256 = createHash('sha256').update(candidateBytes).digest('hex');
const check = await io.readBinary(candidateBytes);
const checkRoot = check.getRoot();
const checkPrimitive = checkRoot.listMeshes()[0].listPrimitives()[0];
const checkPositions = checkPrimitive.getAttribute('POSITION')?.getArray();
const checkNormals = checkPrimitive.getAttribute('NORMAL')?.getArray();
const checkUvs = checkPrimitive.getAttribute('TEXCOORD_0')?.getArray();
const checkIndices = checkPrimitive.getIndices()?.getArray();
const checkJoints = checkPrimitive.getAttribute('JOINTS_0')?.getArray();
const checkWeights = checkPrimitive.getAttribute('WEIGHTS_0')?.getArray();
const checkSkin = checkRoot.listSkins()[0];
assert(checkPositions && checkNormals && checkUvs && checkIndices && checkJoints && checkWeights && checkSkin, 'Candidate lost geometry, maps or its new skin.');
function maximumDelta(a, b) {
  assert.equal(a.length, b.length);
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
}
const positionDelta = maximumDelta(checkPositions, positions);
const normalDelta = maximumDelta(checkNormals, normals);
const uvDelta = maximumDelta(checkUvs, uvs);
let indexMismatches = 0;
let readbackMaxWeightSumError = 0;
let readbackMultiWeightedVertices = 0;
const weightsByJoint = new Uint32Array(bones.length);
for (let i = 0; i < indices.length; i++) if (checkIndices[i] !== indices[i]) indexMismatches++;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  let sum = 0, active = 0;
  for (let slot = 0; slot < 4; slot++) {
    const at = vertex * 4 + slot, joint = checkJoints[at], weight = checkWeights[at];
    assert(Number.isInteger(joint) && joint >= 0 && joint < bones.length, `Invalid joint index at vertex ${vertex}.`);
    assert(Number.isFinite(weight) && weight >= 0 && weight <= 1.00001, `Invalid weight at vertex ${vertex}.`);
    sum += weight;
    if (weight > 1e-6) { active++; weightsByJoint[joint]++; }
  }
  readbackMaxWeightSumError = Math.max(readbackMaxWeightSumError, Math.abs(sum - 1));
  if (active > 1) readbackMultiWeightedVertices++;
  assert(Math.abs(sum - 1) < 1e-5, `Weights at vertex ${vertex} sum to ${sum}.`);
}
assert(positionDelta <= 1e-7 && normalDelta <= 1e-7 && uvDelta <= 1e-7 && indexMismatches === 0, 'The source mesh buffers changed.');
assert.deepEqual([...weightsByJoint].slice(1), [...jointCoverage].slice(1), 'Skin weight coverage changed on GLB round-trip.');
const checkInverseBinds = checkSkin.getInverseBindMatrices()?.getArray();
assert(checkInverseBinds && checkInverseBinds.length === bones.length * 16, 'Candidate inverse binds are missing.');
let inverseBindMaxDelta = 0;
for (let i = 0; i < bones.length; i++) {
  const expected = restWorldMatrices.get(bones[i].name).clone().invert().toArray([]);
  for (let axis = 0; axis < 16; axis++) inverseBindMaxDelta = Math.max(inverseBindMaxDelta, Math.abs(checkInverseBinds[i * 16 + axis] - expected[axis]));
}
assert(inverseBindMaxDelta < 1e-6, `Inverse binds do not match the rest hierarchy: ${inverseBindMaxDelta}.`);
assert.deepEqual(checkRoot.listAnimations().map(animation => animation.getName()), ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'], 'Candidate must provide the six creature slots.');
const checkTextureDimensions = [];
for (const texture of checkRoot.listTextures()) {
  const meta = await sharp(texture.getImage()).metadata();
  checkTextureDimensions.push({ name: texture.getName(), dimensions: [meta.width, meta.height], mimeType: texture.getMimeType() });
}
assert(checkTextureDimensions.every(texture => texture.dimensions[0] === 2048 && texture.dimensions[1] === 2048), 'A runtime map is not 2K.');

const checkNodes = new Map(checkRoot.listNodes().map(node => [node.getName(), node]));
const checkJointNodes = checkSkin.listJoints();
const inverseMatrices = checkJointNodes.map((_, index) => new THREE.Matrix4().fromArray(Array.from(checkInverseBinds.slice(index * 16, index * 16 + 16))));
const points = Array.from({ length: vertexCount }, (_, vertex) => new THREE.Vector3(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]));
const checkMeshNode = checkRoot.listNodes().find(node => node.getMesh() === checkRoot.listMeshes()[0]);
assert(checkMeshNode, 'Candidate mesh node is missing.');
function poseAt(animation, time) {
  const pose = new Map();
  for (const channel of animation.listChannels()) {
    const sampler = channel.getSampler();
    const times = Array.from(sampler.getInput().getArray());
    const values = Array.from(sampler.getOutput().getArray());
    const pathName = channel.getTargetPath();
    const width = pathName === 'rotation' ? 4 : 3;
    let upper = times.findIndex(key => key >= time);
    if (upper < 0) upper = times.length - 1;
    const lower = Math.max(0, upper - (times[upper] === time ? 0 : 1));
    const alpha = upper === lower ? 0 : (time - times[lower]) / (times[upper] - times[lower]);
    const a = values.slice(lower * width, (lower + 1) * width), b = values.slice(upper * width, (upper + 1) * width);
    let value;
    if (pathName === 'rotation') {
      const qa = new THREE.Quaternion(...a), qb = new THREE.Quaternion(...b).normalize();
      qa.slerp(qb, alpha).normalize(); value = [qa.x, qa.y, qa.z, qa.w];
    } else value = a.map((component, index) => component + (b[index] - component) * alpha);
    const changes = pose.get(channel.getTargetNode()) ?? {};
    changes[pathName] = value;
    pose.set(channel.getTargetNode(), changes);
  }
  return pose;
}
function sampleSkin(animation, time) {
  const pose = animation ? poseAt(animation, time) : new Map();
  const world = new Map();
  for (const bone of bones) {
    const node = checkNodes.get(bone.name), edit = pose.get(node) ?? {};
    const translation = new THREE.Vector3(...(edit.translation ?? bone.local));
    const rotation = new THREE.Quaternion(...(edit.rotation ?? [0, 0, 0, 1]));
    const scale = new THREE.Vector3(...(edit.scale ?? [1, 1, 1]));
    const local = new THREE.Matrix4().compose(translation, rotation, scale);
    world.set(bone.name, bone.parent ? world.get(bone.parent).clone().multiply(local) : local);
  }
  const meshWorld = new THREE.Matrix4().compose(new THREE.Vector3(...checkMeshNode.getTranslation()), new THREE.Quaternion(...checkMeshNode.getRotation()), new THREE.Vector3(...checkMeshNode.getScale())).invert();
  const skinMatrices = bones.map((bone, index) => meshWorld.clone().multiply(world.get(bone.name)).multiply(inverseMatrices[index]));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let maximumDisplacement = 0, movedVertices = 0;
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const source = points[vertex], transformed = new THREE.Vector3();
    for (let slot = 0; slot < 4; slot++) {
      const at = vertex * 4 + slot, weight = checkWeights[at];
      if (weight > 0) transformed.add(source.clone().applyMatrix4(skinMatrices[checkJoints[at]]).multiplyScalar(weight));
    }
    assert([transformed.x, transformed.y, transformed.z].every(Number.isFinite), `Nonfinite ${animation?.getName() ?? 'rest'} deformation at vertex ${vertex}.`);
    maximumDisplacement = Math.max(maximumDisplacement, transformed.distanceTo(source));
    if (transformed.distanceTo(source) > 1e-4) movedVertices++;
    for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], transformed.getComponent(axis)); max[axis] = Math.max(max[axis], transformed.getComponent(axis)); }
  }
  return { maximumDisplacement, movedVertices, min, max };
}
const restCheck = sampleSkin(null, 0);
assert(restCheck.maximumDisplacement < 1e-5, `The rest rig changes source positions (${restCheck.maximumDisplacement}).`);
const clipValidation = checkRoot.listAnimations().map(animation => {
  const duration = Math.max(...animation.listChannels().map(channel => channel.getSampler().getInput().getArray().at(-1)));
  const samples = [0, .25, .5, .75, 1].map(phase => ({ phase, ...sampleSkin(animation, duration * phase) }));
  const localMaximumDisplacement = Math.max(...samples.map(sample => sample.maximumDisplacement));
  const maximumDisplacement = localMaximumDisplacement * candidateAssetScale;
  const movedVertices = Math.max(...samples.map(sample => sample.movedVertices));
  assert(localMaximumDisplacement > .003 && movedVertices > 20, `${animation.getName()} has too little visible movement (${localMaximumDisplacement}, ${movedVertices}).`);
  const sourceSpaceSweptBounds = { min: [0, 1, 2].map(axis => Math.min(...samples.map(sample => sample.min[axis]))), max: [0, 1, 2].map(axis => Math.max(...samples.map(sample => sample.max[axis]))) };
  const sweptBounds = { min: sourceSpaceSweptBounds.min.map(value => value * candidateAssetScale), max: sourceSpaceSweptBounds.max.map(value => value * candidateAssetScale) };
  assert(sweptBounds.min[1] > -.30 && sweptBounds.max[1] < 3.55 && Math.abs(sweptBounds.min[0]) < 2.1 && Math.abs(sweptBounds.max[0]) < 2.1 && Math.abs(sweptBounds.min[2]) < 1.6 && Math.abs(sweptBounds.max[2]) < 1.6, `${animation.getName()} has implausible presentation bounds: ${JSON.stringify(sweptBounds)}.`);
  if (animation.getName() === 'Death') assert(sweptBounds.min[1] > -.15, `Death buries the creature below the ground plane: ${sweptBounds.min[1]}.`);
  return { name: animation.getName(), seconds: duration, channels: animation.listChannels().length, maximumDisplacement, localMaximumDisplacement, maximumMovedVertices: movedVertices, sourceSpaceSweptBounds, sweptBounds };
});

const sourceTextureMap = Object.fromEntries(sourceTextureInfo.map(texture => [texture.name, texture]));
const catalog = {
  schema: 'corealm-creature-candidate/1',
  id: 'creature_leaf_sentinel',
  displayName: 'Leaf Sentinel',
  status: 'awaiting-root-lab-review',
  acceptance: { sourceImageApproved: true, geometryPreserved: true, textureGenerated: true, rigAccepted: false, motionAccepted: false, textureAccepted: false, labAccepted: false, worldIntegrated: false, promotable: false },
  source: {
    file: sourceRelative,
    sha256: sourceSha256,
    bytes: sourceBytes.length,
    modelId: sourceModelId,
    projectUuid: sourceModelId,
    prompt: sourcePrompt,
    generator: 'Tripo P2.0, 8K PBR export',
    ledgerGeometry: { vertices: 3555, faces: 5350 },
    decodedGeometry: { vertices: vertexCount, triangles: triangleCount },
    baseGeometry: { vertices: vertexCount, triangles: triangleCount, bounds: sourceBounds, positionsPreserved: true, normalsPreserved: true, indicesPreserved: true, uv: 'TEXCOORD_0 retained byte-for-byte; no unwrap or retopology.' },
    originalSkin: '54-joint Tripo humanoid hierarchy discarded: the pinned GLB places nearly all vertices on BoneRoot and has no animation clips.',
    textures: sourceTextureInfo,
  },
  candidate: {
    file: path.basename(candidatePath),
    sha256: candidateSha256,
    bytes: candidateBytes.length,
    vertices: vertexCount,
    triangles: triangleCount,
    bounds,
    presentationSizing: { targetWorldHeightMeters: targetDrawnHeightMeters, targetTier, existingSlotScale, tierSilhouetteScale, sourceHeightMeters: sourceHeight, candidateAssetScale, expectedDrawnHeightMeters: sourceHeight * candidateAssetScale * existingSlotScale * tierSilhouetteScale },
    rig: {
      type: 'authored non-humanoid plant creature rig',
      profile: 'Unity Generic-ready glTF skeleton; no Humanoid mapping; importer review required',
      jointsCount: bones.length,
      jointNames: bones.map(bone => bone.name),
      parentHierarchy: Object.fromEntries(bones.map(bone => [bone.name, bone.parent])),
      weighting: 'Four-influence normalized spatial weights for the flexible plant stem, leaf crown, paired bough arms and root-like legs.',
      verticesWithMultipleInfluences: readbackMultiWeightedVertices,
      jointsWithWeights: bones.map((bone, index) => ({ name: bone.name, vertices: weightsByJoint[index] })),
    },
    textures: runtimeTextures,
    imageGeneration: { file: path.basename(generatedAlbedoPath), dimensions: [1254, 1254], output: 'Layered jade and teal leaves, copper-brown veins, bark grain and moss details painted into the source atlas layout with face/eye islands retained.' },
    clips: clipValidation,
    labTargetAssetId: 'fairy_garden_sapling_gloamgarden',
    notes: [
      'The exact #16 starred source prompt and UUID are retained. Its face, source topology, positions, normals, indices and UV atlas remain unchanged.',
      'A new image-generated base-color map adds layered forest greens, leaf veins, bark grain, copper edges and moss while preserving the source atlas layout and face/eye details.',
      'Base color, metallic-roughness and tangent-space normal maps are embedded at 2K. The source PBR roughness and normal detail are retained; the living leaf/bark material is dielectric.',
      'The discarded root-only Tripo skin is replaced by a 25-joint Generic plant rig and six custom clips for idle, rooted locomotion, attack, hit recoil and collapse.',
      `The 1.5 m target size accounts for Briar Sapling's existing ${existingSlotScale.toFixed(4)} view scale and ${tierSilhouetteScale.toFixed(4)} T30 silhouette multiplier; a ${candidateAssetScale.toFixed(4)} uniform rig-container scale leaves the source vertex buffers unchanged.`,
      'Lab staging targets the existing T30 Gloamgarden Briar Sapling tree-creature asset; production acceptance and world integration remain pending.',
    ],
  },
  validation: {
    positionsMaxDelta: positionDelta,
    normalsMaxDelta: normalDelta,
    uvsMaxDelta: uvDelta,
    indexMismatches,
    maxWeightSumError: readbackMaxWeightSumError,
    inverseBindMaxDelta,
    textureDimensions: checkTextureDimensions,
    restPoseMaximumDisplacement: restCheck.maximumDisplacement,
    clips: clipValidation,
  },
};
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

const manifest = JSON.parse(await readFile(path.join(repo, 'game/public/assets/manifest.json'), 'utf8'));
const productionTarget = manifest.assets.find(asset => asset.id === 'fairy_garden_sapling_gloamgarden');
assert(productionTarget && productionTarget.file, 'The existing T30 Briar Sapling overlay target is missing from the asset manifest.');
const size = { x: bounds.max[0] - bounds.min[0], y: bounds.max[1] - bounds.min[1], z: bounds.max[2] - bounds.min[2] };
const labAsset = {
  id: productionTarget.id,
  file: productionTarget.file,
  pack: productionTarget.pack,
  category: productionTarget.category,
  is: 'Leaf Sentinel (starred T30 rig candidate)',
  tags: ['creature', 'fairy', 'plant', 'tree', 'leaf-armor', 'gloamgarden', 'T30', 'starred', 'tripo', 'skinned', 'articulated', 'candidate'],
  bytes: candidateBytes.length,
  sha256: candidateSha256,
  size,
  base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] },
  bounds,
  groundY: bounds.min[1],
  triangles: triangleCount,
  animations: clipValidation.map(clip => clip.name),
  materials: [material.getName()],
  walkClipSeconds: clipValidation.find(clip => clip.name === 'Walk').seconds,
  runClipSeconds: clipValidation.find(clip => clip.name === 'Run').seconds,
  attackSeconds: clipValidation.find(clip => clip.name === 'Attack').seconds,
  contactNormalized: .52,
  sourceProvenance: {
    generator: 'Tripo P2.0, 8K PBR export',
    prompt: sourcePrompt,
    sourceModelId,
    projectUuid: sourceModelId,
    sourceFile: sourceRelative,
    sourceSha256,
    candidateFile: path.basename(candidatePath),
    candidateSha256,
    presentationSizing: { targetWorldHeightMeters: targetDrawnHeightMeters, targetTier, existingSlotScale, tierSilhouetteScale, sourceHeightMeters: sourceHeight, candidateAssetScale },
    rigMethod: '25-joint non-humanoid Generic plant rig with normalized four-influence stem, crown, branch-arm and root-leg skin weights; source mesh buffers preserved.',
    generatedBaseColor: path.basename(generatedAlbedoPath),
    textureMaps: runtimeTextures,
    candidateStatus: 'awaiting-root-lab-review',
  },
  acceptance: { assetAudit: true, geometryPreserved: true, rigAccepted: false, motionAccepted: false, textureAccepted: false, labAccepted: false, worldIntegrated: false },
};
const resolvedCandidate = path.resolve(here, path.basename(candidatePath));
assert(!path.relative(here, resolvedCandidate).startsWith('..'), 'Candidate lab override escaped its import folder.');
assert.equal(createHash('sha256').update(await readFile(resolvedCandidate)).digest('hex'), candidateSha256, 'Lab override candidate digest changed.');
await writeFile(labCatalogPath, `${JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', assets: [labAsset], files: { [productionTarget.id]: path.basename(candidatePath) } }, null, 2)}\n`);

console.log(JSON.stringify({
  sourceSha256,
  candidatePath: path.relative(repo, candidatePath),
  candidateSha256,
  bytes: candidateBytes.length,
  vertices: vertexCount,
  triangles: triangleCount,
  bounds,
  joints: bones.length,
  sourceLedgerGeometry: { vertices: 3555, faces: 5350 },
  geometryDelta: { positionDelta, normalDelta, uvDelta, indexMismatches },
  weights: { maxSumError: readbackMaxWeightSumError, multiWeightedVertices: readbackMultiWeightedVertices, joints: bones.map((bone, index) => [bone.name, weightsByJoint[index]]) },
  textures: runtimeTextures,
  clips: clipValidation,
  labTargetAssetId: productionTarget.id,
  sourceTextureMap,
}, null, 2));
