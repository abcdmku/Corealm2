import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../../');
const sourcePath = path.join(repo, 'assets/art/tripo/exports/390315e8-2a4d-4bf5-a9bd-8906016dfde4.glb');
const candidatePath = path.join(here, 'gloamwing-scourer-native-rig-candidate.glb');
const catalogPath = path.join(here, 'catalog.json');
const labCatalogPath = path.join(here, 'lab-catalog.json');
const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
const expectedSourceSha256 = 'd400661f2aea193dbb55590bf45655984dbda444601fb08860368453b60a13f3';
if (sourceSha256 !== expectedSourceSha256) throw new Error(`Refusing noncanonical Flying Rat export: ${sourceSha256}`);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(sourcePath);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const primitive = root.listMeshes()[0]?.listPrimitives()[0];
const meshNode = root.listNodes().find((node) => node.getMesh() === root.listMeshes()[0]);
const rigContainer = meshNode?.getParentNode();
if (!scene || !primitive || !meshNode || !rigContainer) throw new Error('Canonical Flying Rat GLB does not contain the expected skinned mesh hierarchy.');
if (root.listAnimations().length !== 0) throw new Error('Canonical Flying Rat unexpectedly includes animations; refusing to overwrite them.');
const sourceSkin = meshNode.getSkin();
if (!sourceSkin || sourceSkin.listJoints().length !== 19) throw new Error('Wrong same-title source selected: expected the canonical 19-joint Flying Rat.');

const positionAccessor = primitive.getAttribute('POSITION');
const normalAccessor = primitive.getAttribute('NORMAL');
const uvAccessor = primitive.getAttribute('TEXCOORD_0');
const indexAccessor = primitive.getIndices();
if (!positionAccessor || !normalAccessor || !uvAccessor || !indexAccessor) throw new Error('Source must include positions, normals, UVs and indexed triangles.');
const positions = Float32Array.from(positionAccessor.getArray());
const normals = Float32Array.from(normalAccessor.getArray());
const uvs = Float32Array.from(uvAccessor.getArray());
const indices = Uint32Array.from(indexAccessor.getArray());
const vertexCount = positions.length / 3;
const triangleCount = indices.length / 3;
if (vertexCount !== 7985 || triangleCount !== 4837) throw new Error(`Source topology drifted: ${vertexCount} vertices, ${triangleCount} triangles.`);
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
  bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
}
const extent = bounds.max.map((value, axis) => value - bounds.min[axis]);
if (Math.abs(bounds.min[1]) > 1e-6 || extent[0] < .90 || extent[1] < .90 || extent[2] < .80) throw new Error(`Unexpected Flying Rat source orientation or scale: ${JSON.stringify(bounds)}.`);
const gameBounds = {
  min: [-bounds.max[2], bounds.min[1], bounds.min[0]],
  max: [-bounds.min[2], bounds.max[1], bounds.max[0]],
};
const gameExtent = gameBounds.max.map((value, axis) => value - gameBounds.min[axis]);

const material = primitive.getMaterial();
if (!material?.getBaseColorTexture() || !material.getMetallicRoughnessTexture() || !material.getNormalTexture()) throw new Error('Source Flying Rat is missing one of its 2K base color or PBR maps.');
const sourceTextureMetrics = await Promise.all(root.listTextures().map(async (texture) => {
  const image = texture.getImage();
  const imageInfo = await sharp(image).metadata();
  return {
    name: texture.getName(),
    role: texture === material.getBaseColorTexture() ? 'base-color' : texture === material.getMetallicRoughnessTexture() ? 'metallic-roughness' : texture === material.getNormalTexture() ? 'normal' : 'other',
    dimensions: [imageInfo.width, imageInfo.height],
    mimeType: texture.getMimeType(),
    bytes: image.length,
    sha256: createHash('sha256').update(image).digest('hex'),
  };
}));
if (sourceTextureMetrics.some((texture) => texture.role === 'other')) throw new Error('Source contains an unclassified texture; add explicit PBR provenance before building.');
if (sourceTextureMetrics.length !== 3 || sourceTextureMetrics.some((texture) => texture.dimensions[0] !== 2048 || texture.dimensions[1] !== 2048)) {
  throw new Error(`Expected three 2K source PBR textures: ${JSON.stringify(sourceTextureMetrics)}.`);
}

// The canonical export is y-up with the rat's muzzle along +X and its wings extending across
// +/-Z. Its Tripo skin stores every vertex at bone_0 with zero transforms on the joint tree, so
// the apparent 19-joint rig cannot animate the source. Rebuild a purpose-fit Generic skeleton
// and rotate the shared rig container so the muzzle faces game-forward (+Z), while retaining
// the source position, normal, index, UV and embedded PBR image buffers byte-for-byte.
const B = (name, parent, p, sigma, group = 'body') => ({ name, parent, p, sigma, group });
const bones = [
  B('RatRoot', null, [0, 0, 0], .2, 'root'),
  B('Pelvis', 'RatRoot', [-.085, .39, 0], .105, 'body'),
  B('SpineLow', 'Pelvis', [-.005, .47, 0], .115, 'body'),
  B('SpineMid', 'SpineLow', [.075, .55, 0], .12, 'body'),
  B('Chest', 'SpineMid', [.15, .63, 0], .11, 'body'),
  B('Neck', 'Chest', [.265, .73, 0], .09, 'body'),
  B('Head', 'Neck', [.36, .81, 0], .095, 'head'),
  B('Muzzle', 'Head', [.457, .775, 0], .062, 'head'),
  B('Ear_L', 'Head', [.338, .887, -.102], .06, 'earL'),
  B('Ear_R', 'Head', [.338, .887, .102], .06, 'earR'),
  B('TailBase', 'Pelvis', [-.18, .355, 0], .085, 'tail'),
  B('TailMid', 'TailBase', [-.285, .305, 0], .075, 'tail'),
  B('TailEnd', 'TailMid', [-.387, .275, 0], .065, 'tail'),
  B('TailTip', 'TailEnd', [-.465, .265, 0], .055, 'tail'),
  B('ForeUpper_L', 'Chest', [.145, .53, -.085], .060, 'foreL'),
  B('ForeLower_L', 'ForeUpper_L', [.245, .38, -.11], .052, 'foreL'),
  B('ForePaw_L', 'ForeLower_L', [.323, .275, -.13], .045, 'foreL'),
  B('ForeUpper_R', 'Chest', [.145, .53, .085], .060, 'foreR'),
  B('ForeLower_R', 'ForeUpper_R', [.245, .38, .11], .052, 'foreR'),
  B('ForePaw_R', 'ForeLower_R', [.323, .275, .13], .045, 'foreR'),
  B('HindUpper_L', 'Pelvis', [-.105, .30, -.105], .068, 'hindL'),
  B('HindLower_L', 'HindUpper_L', [-.22, .16, -.132], .057, 'hindL'),
  B('HindFoot_L', 'HindLower_L', [-.135, .055, -.15], .052, 'hindL'),
  B('HindUpper_R', 'Pelvis', [-.105, .30, .105], .068, 'hindR'),
  B('HindLower_R', 'HindUpper_R', [-.22, .16, .132], .057, 'hindR'),
  B('HindFoot_R', 'HindLower_R', [-.135, .055, .15], .052, 'hindR'),
  B('WingShoulder_L', 'Chest', [.14, .64, -.105], .090, 'wingL'),
  B('WingElbow_L', 'WingShoulder_L', [.10, .68, -.245], .092, 'wingL'),
  B('WingWrist_L', 'WingElbow_L', [.055, .655, -.365], .084, 'wingL'),
  B('WingThumb_L', 'WingWrist_L', [.135, .596, -.285], .071, 'wingL'),
  B('WingFingerA_L', 'WingWrist_L', [.235, .744, -.480], .071, 'wingL'),
  B('WingFingerB_L', 'WingWrist_L', [.045, .568, -.492], .071, 'wingL'),
  B('WingFingerC_L', 'WingWrist_L', [-.115, .397, -.410], .066, 'wingL'),
  B('WingShoulder_R', 'Chest', [.14, .64, .105], .090, 'wingR'),
  B('WingElbow_R', 'WingShoulder_R', [.10, .68, .245], .092, 'wingR'),
  B('WingWrist_R', 'WingElbow_R', [.055, .655, .365], .084, 'wingR'),
  B('WingThumb_R', 'WingWrist_R', [.135, .596, .285], .071, 'wingR'),
  B('WingFingerA_R', 'WingWrist_R', [.235, .744, .480], .071, 'wingR'),
  B('WingFingerB_R', 'WingWrist_R', [.045, .568, .492], .071, 'wingR'),
  B('WingFingerC_R', 'WingWrist_R', [-.115, .397, .410], .066, 'wingR'),
];
const boneIndex = new Map(bones.map((bone, index) => [bone.name, index]));
const boneByName = new Map(bones.map((bone) => [bone.name, bone]));
for (const bone of bones) {
  const parent = bone.parent ? boneByName.get(bone.parent) : null;
  bone.local = parent ? bone.p.map((value, axis) => value - parent.p[axis]) : [...bone.p];
}

// Retire the zero-weight Tripo skeleton only; leave all mesh and material accessors intact.
meshNode.setSkin(null).setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
primitive.setAttribute('JOINTS_0', null);
primitive.setAttribute('WEIGHTS_0', null);
for (const child of [...rigContainer.listChildren()]) rigContainer.removeChild(child);
for (const oldSkin of [...root.listSkins()]) oldSkin.dispose();
rigContainer.setName('Gloamwing_Scourer_Rig').setTranslation([0, 0, 0]).setRotation([0, -Math.SQRT1_2, 0, Math.SQRT1_2]).setScale([1, 1, 1]);
rigContainer.addChild(meshNode);

const nodeByName = new Map();
const nodeWorld = new Map();
const orderedNames = [];
const childMap = new Map(bones.map((bone) => [bone.name, []]));
for (const bone of bones) if (bone.parent) childMap.get(bone.parent).push(bone.name);
function createBone(name) {
  const def = boneByName.get(name);
  const node = doc.createNode(name).setTranslation(def.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  const local = new THREE.Matrix4().makeTranslation(...def.local);
  const world = def.parent ? nodeWorld.get(def.parent).clone().multiply(local) : local;
  nodeByName.set(name, node);
  nodeWorld.set(name, world);
  orderedNames.push(name);
  (def.parent ? nodeByName.get(def.parent) : rigContainer).addChild(node);
  for (const child of childMap.get(name)) createBone(child);
}
createBone('RatRoot');
if (orderedNames.length !== bones.length) throw new Error('The rat rig hierarchy is disconnected or contains cycles.');

const skin = doc.createSkin('Gloamwing Scourer Generic Rig').setSkeleton(nodeByName.get('RatRoot'));
for (const name of orderedNames) skin.addJoint(nodeByName.get(name));
meshNode.setSkin(skin);
const inverseBind = new Float32Array(orderedNames.length * 16);
for (let i = 0; i < orderedNames.length; i++) nodeWorld.get(orderedNames[i]).clone().invert().toArray(inverseBind, i * 16);
const buffer = root.listBuffers()[0] ?? doc.createBuffer('Gloamwing skeleton and animation data');
skin.setInverseBindMatrices(doc.createAccessor('Gloamwing_inverse_bind_matrices').setType(Accessor.Type.MAT4).setArray(inverseBind).setBuffer(buffer));

const distanceToSegment = (point, a, b) => {
  const ab = b.map((value, axis) => value - a[axis]);
  const ap = point.map((value, axis) => value - a[axis]);
  const denominator = ab.reduce((sum, value) => sum + value * value, 0);
  const t = denominator > 1e-10 ? Math.max(0, Math.min(1, ab.reduce((sum, value, axis) => sum + value * ap[axis], 0) / denominator)) : 0;
  return Math.hypot(...point.map((value, axis) => value - (a[axis] + ab[axis] * t)));
};
function anatomicalSet(point) {
  const [x, y, z] = point;
  const side = z < 0 ? 'L' : 'R';
  if (x > .27 && y > .835 && Math.abs(z) > .07 && Math.abs(z) < .19) return ['Head', `Ear_${side}`];
  if (x > .26 && y > .70 && Math.abs(z) < .23) return ['Neck', 'Head', 'Muzzle'];
  if (x < -.22 && y < .62 && Math.abs(z) < .19) return ['Pelvis', 'TailBase', 'TailMid', 'TailEnd', 'TailTip'];
  if (Math.abs(z) > .105 && y > .275 && y < .93) {
    return ['SpineMid', 'Chest', 'Neck', `WingShoulder_${side}`, `WingElbow_${side}`, `WingWrist_${side}`, `WingThumb_${side}`, `WingFingerA_${side}`, `WingFingerB_${side}`, `WingFingerC_${side}`];
  }
  if (y < .32 && x > .02 && Math.abs(z) > .035 && x < .39) return ['Chest', `ForeUpper_${side}`, `ForeLower_${side}`, `ForePaw_${side}`];
  if (y < .32 && Math.abs(z) > .035 && x <= .02) return ['Pelvis', `HindUpper_${side}`, `HindLower_${side}`, `HindFoot_${side}`];
  return ['Pelvis', 'SpineLow', 'SpineMid', 'Chest', 'Neck', 'Head'];
}
const jointIndices = new Uint16Array(vertexCount * 4);
const jointWeights = new Float32Array(vertexCount * 4);
const influenceCounts = new Uint32Array(bones.length);
const multiInfluenceVertexCount = { value: 0 };
let maxWeightSumError = 0;
let minNonzeroWeight = 1;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const candidates = anatomicalSet(point).map((name) => {
    const bone = boneByName.get(name);
    const parent = bone.parent ? boneByName.get(bone.parent) : bone;
    const distance = distanceToSegment(point, parent.p, bone.p);
    let bias = 1;
    if ((bone.group === 'wingL' || bone.group === 'wingR') && name.startsWith('Wing')) bias = 1.28;
    if ((name === 'Chest' || name === 'SpineMid') && (bone.group === 'wingL' || bone.group === 'wingR')) bias = .72;
    return { name, index: boneIndex.get(name), score: bias * Math.exp(-.5 * (distance / bone.sigma) ** 2) };
  }).sort((a, b) => b.score - a.score).slice(0, 4);
  if (!candidates.length || !candidates.some((item) => item.score > 1e-12)) throw new Error(`No valid rat anatomical weights for vertex ${vertex}.`);
  const total = candidates.reduce((sum, item) => sum + item.score, 0);
  let assigned = 0;
  for (let slot = 0; slot < candidates.length; slot++) {
    const candidate = candidates[slot];
    const weight = slot === candidates.length - 1 ? 1 - assigned : candidate.score / total;
    jointIndices[vertex * 4 + slot] = candidate.index;
    jointWeights[vertex * 4 + slot] = weight;
    assigned += weight;
    if (weight > 1e-6) { influenceCounts[candidate.index]++; minNonzeroWeight = Math.min(minNonzeroWeight, weight); }
  }
  const sum = jointWeights[vertex * 4] + jointWeights[vertex * 4 + 1] + jointWeights[vertex * 4 + 2] + jointWeights[vertex * 4 + 3];
  maxWeightSumError = Math.max(maxWeightSumError, Math.abs(sum - 1));
  if (candidates.filter((item, slot) => jointWeights[vertex * 4 + slot] > 1e-6).length > 1) multiInfluenceVertexCount.value++;
}
primitive.setAttribute('JOINTS_0', doc.createAccessor('Gloamwing_joint_indices').setType(Accessor.Type.VEC4).setArray(jointIndices).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('Gloamwing_joint_weights').setType(Accessor.Type.VEC4).setArray(jointWeights).setBuffer(buffer));

// Fur and bare wing membrane stay dielectric. Preserve every source texture map without recoloring.
material.setMetallicFactor(0.02).setRoughnessFactor(0.88);
const axisQuaternion = (axis, angle) => {
  const half = angle / 2, sine = Math.sin(half), cosine = Math.cos(half);
  if (axis === 'x') return [sine, 0, 0, cosine];
  if (axis === 'y') return [0, sine, 0, cosine];
  return [0, 0, sine, cosine];
};
const cycle = [0, .25, .5, .75, 1];
const sineLoop = (axis, amplitude, phase = 0, bias = 0) => cycle.map((t) => axisQuaternion(axis, bias + Math.sin(2 * Math.PI * t + phase) * amplitude));
const clips = [];
function addClip(name, duration, phaseTimes, tracks) {
  const animation = doc.createAnimation(name);
  for (const track of tracks) {
    const pathName = track.path ?? 'rotation';
    const type = track.type ?? (pathName === 'rotation' ? Accessor.Type.VEC4 : Accessor.Type.VEC3);
    const times = phaseTimes.map((t) => t * duration);
    const input = doc.createAccessor(`${name}_${track.node}_${pathName}_time`).setType(Accessor.Type.SCALAR).setArray(new Float32Array(times)).setBuffer(buffer);
    const output = doc.createAccessor(`${name}_${track.node}_${pathName}_value`).setType(type).setArray(new Float32Array(track.values.flat())).setBuffer(buffer);
    const sampler = doc.createAnimationSampler(`${name}_${track.node}_${pathName}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    const channel = doc.createAnimationChannel(`${track.node}_${pathName}`).setTargetNode(nodeByName.get(track.node)).setTargetPath(pathName).setSampler(sampler);
    animation.addSampler(sampler).addChannel(channel);
  }
  clips.push({ name, duration, channels: tracks.length, description: clipDescriptions[name] });
}
const clipDescriptions = {
  Idle: 'Alert grounded rest with a restrained breath, a slight leather-wing settle, small ear turns and a slow counterweighted tail sway.',
  Walk: 'Low cautious quadrupedal skitter with alternating fore and hind steps, compact folded wings and a balancing tail.',
  Run: 'Fast low pounce stride with opposed fore and hind limbs, compacting elbows and broad wing-assisted balance.',
  Flying: 'Airborne hover and travel loop with synchronized downstrokes, a compact recovery stroke, tucked feet and a counter-swinging tail.',
  Attack: 'Short wing-assisted lunge with a committed forward head strike and a heavy closing downstroke.',
  Hit: 'Brief asymmetric wing recoil, a chest flinch and a stabilizing tail whip.',
  Death: 'The creature loses lift, folds its wings, drops its head and settles onto its side without a violent or gory pose.',
};

addClip('Idle', 2.7, cycle, [
  { node: 'SpineMid', values: sineLoop('z', .010) },
  { node: 'Head', values: sineLoop('y', .024, .4) },
  { node: 'Ear_L', values: sineLoop('z', .024, .2) },
  { node: 'Ear_R', values: sineLoop('z', -.020, .7) },
  { node: 'TailMid', values: sineLoop('y', .048, .4) },
  { node: 'TailTip', values: sineLoop('y', .080, -.4) },
  { node: 'WingShoulder_L', values: sineLoop('x', .020, 0, -.12) },
  { node: 'WingShoulder_R', values: sineLoop('x', -.020, 0, .12) },
  { node: 'WingFingerB_L', values: sineLoop('x', .022, .3) },
  { node: 'WingFingerB_R', values: sineLoop('x', -.022, .3) },
]);
const walkWaveL = [0, 1, 0, -1, 0];
const walkWaveR = [0, -1, 0, 1, 0];
function locomotionTracks(amplitude, kneeBend, wingBias, tailAmplitude) {
  const tracks = [];
  for (const side of ['L', 'R']) {
    const wave = side === 'L' ? walkWaveL : walkWaveR;
    const sign = side === 'L' ? 1 : -1;
    tracks.push({ node: `HindUpper_${side}`, values: wave.map((v) => axisQuaternion('z', v * amplitude)) });
    tracks.push({ node: `HindLower_${side}`, values: wave.map((v) => axisQuaternion('z', -.05 - Math.max(0, v) * kneeBend + Math.min(0, v) * .08)) });
    tracks.push({ node: `HindFoot_${side}`, values: wave.map((v) => axisQuaternion('z', -.10 * v + .03)) });
    tracks.push({ node: `ForeUpper_${side}`, values: wave.map((v) => axisQuaternion('z', -.68 * v * amplitude)) });
    tracks.push({ node: `ForeLower_${side}`, values: wave.map((v) => axisQuaternion('z', -.08 - Math.max(0, v) * kneeBend * .8)) });
    tracks.push({ node: `WingShoulder_${side}`, values: wave.map((v) => axisQuaternion('x', -sign * (wingBias + Math.abs(v) * .035))) });
    tracks.push({ node: `WingElbow_${side}`, values: wave.map((v) => axisQuaternion('x', sign * .08 - v * .025)) });
  }
  tracks.push({ node: 'SpineMid', values: cycle.map((_, i) => axisQuaternion('z', [0, .012, 0, -.012, 0][i])) });
  tracks.push({ node: 'TailBase', values: cycle.map((_, i) => axisQuaternion('y', [0, tailAmplitude, 0, -tailAmplitude, 0][i])) });
  tracks.push({ node: 'TailTip', values: cycle.map((_, i) => axisQuaternion('y', [0, -tailAmplitude * 1.2, 0, tailAmplitude * 1.2, 0][i])) });
  return tracks;
}
addClip('Walk', 1.08, cycle, locomotionTracks(.20, .18, .20, .045));
addClip('Run', .72, cycle, locomotionTracks(.42, .34, .12, .082));

const flightCycles = [0, .25, .5, .75, 1];
const flightSin = flightCycles.map((t) => Math.sin(2 * Math.PI * t));
const flightTracks = [];
for (const side of ['L', 'R']) {
  const mirror = side === 'L' ? -1 : 1;
  flightTracks.push({ node: `WingShoulder_${side}`, values: flightSin.map((v) => axisQuaternion('x', mirror * v * .56)) });
  flightTracks.push({ node: `WingElbow_${side}`, values: flightSin.map((v) => axisQuaternion('x', mirror * v * .24)) });
  flightTracks.push({ node: `WingWrist_${side}`, values: flightSin.map((v) => axisQuaternion('x', mirror * v * .15)) });
  flightTracks.push({ node: `WingFingerA_${side}`, values: flightSin.map((v) => axisQuaternion('x', mirror * v * .12)) });
  flightTracks.push({ node: `WingFingerB_${side}`, values: flightSin.map((v) => axisQuaternion('x', mirror * v * .10)) });
  flightTracks.push({ node: `WingFingerC_${side}`, values: flightSin.map((v) => axisQuaternion('x', mirror * v * .08)) });
  flightTracks.push({ node: `WingThumb_${side}`, values: flightSin.map((v) => axisQuaternion('y', -.08 + Math.abs(v) * .06)) });
  flightTracks.push({ node: `HindUpper_${side}`, values: flightSin.map((v) => axisQuaternion('z', .28 + Math.abs(v) * .04)) });
  flightTracks.push({ node: `HindLower_${side}`, values: flightSin.map((v) => axisQuaternion('z', -.18)) });
}
flightTracks.push({ node: 'RatRoot', path: 'translation', type: Accessor.Type.VEC3, values: flightCycles.map((_, i) => [0, [.00, .026, .052, .026, .00][i], 0]) });
flightTracks.push({ node: 'Head', values: flightSin.map((v) => axisQuaternion('z', -.035 + v * .025)) });
flightTracks.push({ node: 'TailMid', values: flightSin.map((v) => axisQuaternion('y', v * .11)) });
flightTracks.push({ node: 'TailTip', values: flightSin.map((v) => axisQuaternion('y', -v * .17)) });
addClip('Flying', 1.02, flightCycles, flightTracks);

addClip('Attack', .74, [0, .22, .52, 1], [
  { node: 'RatRoot', path: 'translation', type: Accessor.Type.VEC3, values: [[0, 0, 0], [0, .012, .035], [0, .042, .105], [0, 0, 0]] },
  { node: 'Chest', values: [0, -.11, .16, 0].map((v) => axisQuaternion('z', v)) },
  { node: 'Head', values: [0, .08, .24, 0].map((v) => axisQuaternion('z', v)) },
  { node: 'Muzzle', values: [0, .02, .11, 0].map((v) => axisQuaternion('z', v)) },
  { node: 'WingShoulder_L', values: [0, -.18, .20, .06].map((v) => axisQuaternion('x', -v)) },
  { node: 'WingShoulder_R', values: [0, .18, -.20, -.06].map((v) => axisQuaternion('x', v)) },
  { node: 'WingElbow_L', values: [0, -.12, .18, .05].map((v) => axisQuaternion('x', v)) },
  { node: 'WingElbow_R', values: [0, .12, -.18, -.05].map((v) => axisQuaternion('x', -v)) },
  { node: 'TailBase', values: [0, -.04, .08, 0].map((v) => axisQuaternion('y', v)) },
]);
addClip('Hit', .42, [0, .12, .42, 1], [
  { node: 'RatRoot', path: 'translation', type: Accessor.Type.VEC3, values: [[0, 0, 0], [0, -.008, -.03], [0, .006, -.01], [0, 0, 0]] },
  { node: 'Chest', values: [0, -.21, .045, 0].map((v) => axisQuaternion('z', v)) },
  { node: 'Head', values: [0, -.18, .035, 0].map((v) => axisQuaternion('z', v)) },
  { node: 'WingShoulder_L', values: [0, .38, .06, 0].map((v) => axisQuaternion('x', v)) },
  { node: 'WingShoulder_R', values: [0, -.12, .02, 0].map((v) => axisQuaternion('x', v)) },
  { node: 'WingElbow_L', values: [0, -.24, .04, 0].map((v) => axisQuaternion('x', v)) },
  { node: 'TailMid', values: [0, .23, -.07, 0].map((v) => axisQuaternion('y', v)) },
]);
addClip('Death', 1.42, [0, .18, .52, .78, 1], [
  { node: 'RatRoot', path: 'translation', type: Accessor.Type.VEC3, values: [[0, 0, 0], [0, -.012, 0], [0, -.025, 0], [0, -.025, 0], [0, -.025, 0]] },
  { node: 'SpineMid', values: [0, .10, .32, .40, .40].map((v) => axisQuaternion('z', v)) },
  { node: 'Chest', values: [0, .12, .38, .48, .48].map((v) => axisQuaternion('z', v)) },
  { node: 'Neck', values: [0, .08, .24, .31, .31].map((v) => axisQuaternion('y', v)) },
  { node: 'Head', values: [0, .12, .31, .38, .38].map((v) => axisQuaternion('y', v)) },
  { node: 'WingShoulder_L', values: [0, .14, .36, .42, .42].map((v) => axisQuaternion('x', v)) },
  { node: 'WingShoulder_R', values: [0, -.14, -.36, -.42, -.42].map((v) => axisQuaternion('x', v)) },
  { node: 'WingElbow_L', values: [0, -.12, -.35, -.40, -.40].map((v) => axisQuaternion('x', v)) },
  { node: 'WingElbow_R', values: [0, .12, .35, .40, .40].map((v) => axisQuaternion('x', v)) },
  { node: 'HindUpper_L', values: [0, .05, .28, .31, .31].map((v) => axisQuaternion('z', v)) },
  { node: 'HindUpper_R', values: [0, -.05, -.25, -.28, -.28].map((v) => axisQuaternion('z', v)) },
  { node: 'TailMid', values: [0, .16, .28, .30, .30].map((v) => axisQuaternion('y', v)) },
]);

const outputBytes = await io.writeBinary(doc);
await writeFile(candidatePath, outputBytes);
const candidateSha256 = createHash('sha256').update(outputBytes).digest('hex');
const validation = await validateCandidate(candidatePath);
const candidateRecord = {
  schema: 'corealm-creature-native-rig-candidate/1',
  id: 'creature_gloamwing_scourer',
  displayName: 'Gloamwing Scourer',
  status: 'awaiting-root-visual-and-lab-review',
  accepted: false,
  source: {
    file: 'assets/art/tripo/exports/390315e8-2a4d-4bf5-a9bd-8906016dfde4.glb',
    sha256: sourceSha256,
    bytes: sourceBytes.length,
    starredModelId: '390315e8-2a4d-4bf5-a9bd-8906016dfde4',
    starredCardStorageId: 'e5fa04f1-b25d-4a4e-a8fb-0ca2cbc5da73',
    title: 'Fantasy Flying Rat 3d Model',
    prompt: 'flying rat creature with fur, bat-like wings, large red eyes, sharp teeth, long tail',
    tripoExportRigJoints: 19,
    originalTripoSkinStatus: 'invalid: 100 percent of vertices assigned to bone_0; every exported joint has identity local transform; zero animations',
    topology: { vertices: vertexCount, triangles: triangleCount, bounds, positionsPreserved: true, normalsPreserved: true, indicesPreserved: true, uvsPreserved: true, retopology: false },
    textures: sourceTextureMetrics,
    generator: 'Tripo P1.0 Smart Mesh; exact canonical 19-joint export selected by the verified SHA-256',
  },
  candidate: {
    file: path.basename(candidatePath),
    sha256: candidateSha256,
    bytes: outputBytes.length,
    geometry: { vertices: vertexCount, triangles: triangleCount, positionsPreserved: true, normalsPreserved: true, indicesPreserved: true, uvsPreserved: true },
    rig: { type: 'Unity Generic-ready flying mammal rig; import review required', jointCount: bones.length, jointNames: orderedNames, weightMethod: 'Four-influence anatomically gated capsule distances: flexible trunk and muzzle, paired hind legs and feet, chained bat-like wing shoulder/elbow/wrist/membrane digits, and segmented tail.' },
    coordinateBasis: { sourceForward: '+X', sourceUp: '+Y', sourceWingSpan: '+/-Z', presentationYawDegrees: -90, gameForward: '+Z', axisMapping: 'source (x, y, z) maps to game (-z, y, x)' },
    material: { metallicFactor: material.getMetallicFactor(), roughnessFactor: material.getRoughnessFactor(), texturePolicy: 'Original image-generated layered 2K base-color, packed metallic-roughness and tangent-space normal maps retained byte-for-byte; metallic factor corrected for nonmetallic fur and leather membrane.' },
    animations: clips,
    productionTargetSuggestion: 'game/public/assets/models/creature/creature_gloamwing_scourer.glb',
    suggestedTier: 'T10',
    regionSuggestion: 'Outer cave mouths or a purposeful dusk scavenger niche; root should choose final population and name after the style audit.',
  },
  validation,
  acceptance: { sourceImageAudit: false, geometry: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(catalogPath, `${JSON.stringify(candidateRecord, null, 2)}\n`);

const labEntry = {
  id: candidateRecord.id,
  file: 'models/creature/creature_gloamwing_scourer.glb',
  pack: 'corealm-starred-creatures',
  category: 'character',
  is: candidateRecord.displayName,
  tags: ['creature', 'mammal', 'winged', 'fantasy', 'tripo-starred', 'candidate', 'skinned', 'articulated', 't10'],
  bytes: outputBytes.length,
  sha256: candidateSha256,
  size: { x: gameExtent[0], y: gameExtent[1], z: gameExtent[2] },
  base: { x: gameBounds.min[0], y: gameBounds.min[1], z: gameBounds.min[2] },
  bounds: gameBounds,
  groundY: 0,
  triangles: triangleCount,
  vertices: vertexCount,
  animations: clips.map((clip) => clip.name),
  materials: root.listMaterials().map((entry) => entry.getName()),
  walkClipSeconds: clips.find((clip) => clip.name === 'Walk').duration,
  runClipSeconds: clips.find((clip) => clip.name === 'Run').duration,
  attackSeconds: clips.find((clip) => clip.name === 'Attack').duration,
  contactNormalized: .53,
  sourceProvenance: {
    author: 'Corealm flying-creature rig reconstruction',
    source: 'User-starred Tripo P1 flying rat; 19-joint version selected by source hash; original mesh and layered PBR retained.',
    modelId: '390315e8-2a4d-4bf5-a9bd-8906016dfde4',
    cardStorageId: 'e5fa04f1-b25d-4a4e-a8fb-0ca2cbc5da73',
    sourceSha256,
    candidateFile: path.basename(candidatePath),
    candidateSha256,
    rigMethod: candidateRecord.candidate.rig.weightMethod,
    textures: sourceTextureMetrics,
  },
  metadata: {
    is: candidateRecord.displayName,
    tags: ['creature', 'mammal', 'winged', 'fantasy', 'tripo-starred', 'candidate', 't10'],
    walkClipSeconds: clips.find((clip) => clip.name === 'Walk').duration,
    runClipSeconds: clips.find((clip) => clip.name === 'Run').duration,
    attackSeconds: clips.find((clip) => clip.name === 'Attack').duration,
    contactNormalized: .53,
    suggestedAirborneClip: 'Flying',
    boneNames: orderedNames,
  },
  acceptance: { assetAudit: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(labCatalogPath, `${JSON.stringify({
  schema: 'corealm-lab-asset-candidates/1',
  pack: { id: 'corealm-starred-creatures', name: 'Corealm starred creatures', author: 'Corealm', source: 'Tripo Studio source exports and Corealm candidate rig/material adaptation', license: 'LicenseRef-Tripo-Generated' },
  assets: [labEntry],
  files: { [candidateRecord.id]: path.basename(candidatePath) },
}, null, 2)}\n`);
console.log(JSON.stringify({ candidatePath, bytes: outputBytes.length, sha256: candidateSha256, validation }, null, 2));

async function validateCandidate(file) {
  const checkDoc = await io.read(file);
  const checkRoot = checkDoc.getRoot();
  const checkPrimitive = checkRoot.listMeshes()[0]?.listPrimitives()[0];
  const checkPosition = checkPrimitive?.getAttribute('POSITION')?.getArray();
  const checkNormal = checkPrimitive?.getAttribute('NORMAL')?.getArray();
  const checkUv = checkPrimitive?.getAttribute('TEXCOORD_0')?.getArray();
  const checkIndex = checkPrimitive?.getIndices()?.getArray();
  const checkJoints = checkPrimitive?.getAttribute('JOINTS_0')?.getArray();
  const checkWeights = checkPrimitive?.getAttribute('WEIGHTS_0')?.getArray();
  const checkSkins = checkRoot.listSkins();
  const animations = checkRoot.listAnimations();
  if (!checkPosition || !checkNormal || !checkUv || !checkIndex || !checkJoints || !checkWeights || checkSkins.length !== 1) throw new Error('Candidate is missing source mesh, skin or weight data.');
  if (checkPosition.length !== positions.length || checkNormal.length !== normals.length || checkUv.length !== uvs.length || checkIndex.length !== indices.length) throw new Error('Source accessor cardinality changed during export.');
  let maxPositionDelta = 0, maxNormalDelta = 0, maxUvDelta = 0, indexMismatches = 0;
  for (let i = 0; i < positions.length; i++) {
    maxPositionDelta = Math.max(maxPositionDelta, Math.abs(checkPosition[i] - positions[i]));
    maxNormalDelta = Math.max(maxNormalDelta, Math.abs(checkNormal[i] - normals[i]));
  }
  for (let i = 0; i < uvs.length; i++) maxUvDelta = Math.max(maxUvDelta, Math.abs(checkUv[i] - uvs[i]));
  for (let i = 0; i < indices.length; i++) if (checkIndex[i] !== indices[i]) indexMismatches++;
  if (maxPositionDelta > 1e-7 || maxNormalDelta > 1e-7 || maxUvDelta > 1e-7 || indexMismatches !== 0) {
    throw new Error(`Source geometry was changed: position=${maxPositionDelta}, normal=${maxNormalDelta}, uv=${maxUvDelta}, index=${indexMismatches}.`);
  }
  const skinCheck = checkSkins[0];
  if (skinCheck.listJoints().length !== bones.length) throw new Error('Candidate joint count changed while writing.');
  if (skinCheck.getSkeleton()?.getName() !== 'RatRoot') throw new Error('Unity Generic rig root is missing.');
  const inverseBindArray = skinCheck.getInverseBindMatrices()?.getArray();
  if (!inverseBindArray || inverseBindArray.length !== bones.length * 16) throw new Error('Candidate inverse-bind matrix count does not match joints.');
  let maxInverseBindError = 0;
  for (let i = 0; i < bones.length; i++) {
    const expected = nodeWorld.get(orderedNames[i]).clone().invert().elements;
    for (let j = 0; j < 16; j++) maxInverseBindError = Math.max(maxInverseBindError, Math.abs(inverseBindArray[i * 16 + j] - expected[j]));
  }
  if (maxInverseBindError > 1e-6) throw new Error(`Inverse-bind matrix error ${maxInverseBindError} exceeds tolerance.`);
  let maxWeightSumErrorCandidate = 0, verticesWithMultipleInfluences = 0, maxJointIndex = 0;
  const candidateBoneCounts = new Uint32Array(bones.length);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    let sum = 0, nonzero = 0;
    for (let slot = 0; slot < 4; slot++) {
      const joint = checkJoints[vertex * 4 + slot], weight = checkWeights[vertex * 4 + slot];
      if (!Number.isInteger(joint) || joint < 0 || joint >= bones.length || !Number.isFinite(weight) || weight < -1e-7 || weight > 1.00001) throw new Error(`Invalid skin influence at vertex ${vertex}, slot ${slot}.`);
      maxJointIndex = Math.max(maxJointIndex, joint);
      if (weight > 1e-6) { sum += weight; nonzero++; candidateBoneCounts[joint]++; }
    }
    if (Math.abs(sum - 1) > 1e-5) throw new Error(`Unnormalized influences at vertex ${vertex}: ${sum}.`);
    maxWeightSumErrorCandidate = Math.max(maxWeightSumErrorCandidate, Math.abs(sum - 1));
    if (nonzero > 1) verticesWithMultipleInfluences++;
  }
  const essentialJoints = ['Pelvis', 'SpineMid', 'Head', 'TailBase', 'HindUpper_L', 'HindUpper_R', 'WingShoulder_L', 'WingShoulder_R', 'WingElbow_L', 'WingElbow_R', 'WingWrist_L', 'WingWrist_R'];
  const unweightedEssentialJoints = essentialJoints.filter((name) => candidateBoneCounts[boneIndex.get(name)] === 0);
  if (unweightedEssentialJoints.length) throw new Error(`Anatomically essential joints received no vertices: ${unweightedEssentialJoints.join(', ')}.`);
  if (animations.map((animation) => animation.getName()).join('|') !== 'Idle|Walk|Run|Flying|Attack|Hit|Death') throw new Error(`Unexpected animation list: ${animations.map((animation) => animation.getName()).join(', ')}.`);
  const nodeMap = new Map(checkRoot.listNodes().map((node) => [node.getName(), node]));
  const checkedMeshNode = checkRoot.listNodes().find((node) => node.getMesh() === checkRoot.listMeshes()[0]);
  if (!checkedMeshNode) throw new Error('Candidate mesh node was lost while writing.');
  const checkIbm = skinCheck.getInverseBindMatrices().getArray();
  const invBindMatrices = skinCheck.listJoints().map((_, index) => new THREE.Matrix4().fromArray(Array.from(checkIbm.slice(index * 16, index * 16 + 16))));
  const getWorldMatrix = (node, cache, pose) => {
    const cached = cache.get(node); if (cached) return cached;
    const animated = pose.get(node) ?? {};
    const translation = new THREE.Vector3(...(animated.translation ?? node.getTranslation()));
    const rotation = new THREE.Quaternion(...(animated.rotation ?? node.getRotation()));
    const scale = new THREE.Vector3(...(animated.scale ?? node.getScale()));
    const local = new THREE.Matrix4().compose(translation, rotation, scale);
    const parent = node.getParentNode();
    const world = parent ? getWorldMatrix(parent, cache, pose).clone().multiply(local) : local;
    cache.set(node, world); return world;
  };
  const sampleAnimation = (animation, time) => {
    const pose = new Map();
    for (const channel of animation.listChannels()) {
      const target = channel.getTargetNode();
      if (!skinCheck.listJoints().includes(target)) throw new Error(`${animation.getName()} targets a node outside the Generic skeleton.`);
      const sampler = channel.getSampler();
      const times = Array.from(sampler.getInput().getArray());
      const values = Array.from(sampler.getOutput().getArray());
      const width = channel.getTargetPath() === 'rotation' ? 4 : 3;
      let upper = times.findIndex((key) => key >= time);
      if (upper < 0) upper = times.length - 1;
      const lower = Math.max(0, upper - (times[upper] === time ? 0 : 1));
      const alpha = upper === lower ? 0 : (time - times[lower]) / (times[upper] - times[lower]);
      const start = values.slice(lower * width, (lower + 1) * width);
      const end = values.slice(upper * width, (upper + 1) * width);
      let value;
      if (channel.getTargetPath() === 'rotation') {
        const rotation = new THREE.Quaternion(...start).slerp(new THREE.Quaternion(...end), alpha).normalize();
        value = [rotation.x, rotation.y, rotation.z, rotation.w];
      } else value = start.map((component, index) => component + (end[index] - component) * alpha);
      const jointPose = pose.get(target) ?? {}; jointPose[channel.getTargetPath()] = value; pose.set(target, jointPose);
    }
    const cache = new Map();
    const meshInverse = getWorldMatrix(checkedMeshNode, cache, pose).clone().invert();
    const jointMatrices = skinCheck.listJoints().map((joint, index) => meshInverse.clone().multiply(getWorldMatrix(joint, cache, pose)).multiply(invBindMatrices[index]));
    let displacementMax = 0, moved = 0;
    const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const source = new THREE.Vector3(checkPosition[vertex * 3], checkPosition[vertex * 3 + 1], checkPosition[vertex * 3 + 2]);
      const deformed = new THREE.Vector3();
      for (let slot = 0; slot < 4; slot++) {
        const weight = checkWeights[vertex * 4 + slot];
        if (weight > 0) deformed.add(source.clone().applyMatrix4(jointMatrices[checkJoints[vertex * 4 + slot]]).multiplyScalar(weight));
      }
      if (![deformed.x, deformed.y, deformed.z].every(Number.isFinite)) throw new Error(`${animation.getName()} produced a non-finite vertex.`);
      const delta = deformed.distanceTo(source);
      displacementMax = Math.max(displacementMax, delta);
      if (delta > 1e-4) moved++;
      minimum[0] = Math.min(minimum[0], deformed.x); minimum[1] = Math.min(minimum[1], deformed.y); minimum[2] = Math.min(minimum[2], deformed.z);
      maximum[0] = Math.max(maximum[0], deformed.x); maximum[1] = Math.max(maximum[1], deformed.y); maximum[2] = Math.max(maximum[2], deformed.z);
    }
    return { minimum, maximum, displacementMax, moved };
  };
  const rest = sampleAnimation({ getName: () => 'Rest', listChannels: () => [] }, 0);
  const restBoundError = Math.max(...rest.minimum.map((value, axis) => Math.abs(value - bounds.min[axis])), ...rest.maximum.map((value, axis) => Math.abs(value - bounds.max[axis])));
  if (restBoundError > 1e-5) throw new Error(`Rest skin differs from the untouched source mesh bounds by ${restBoundError}.`);
  const clipReports = [];
  for (const animation of animations) {
    let duration = 0; const sampleTimes = new Set([0]);
    for (const channel of animation.listChannels()) {
      const times = Array.from(channel.getSampler().getInput().getArray());
      const output = channel.getSampler().getOutput().getArray();
      if (times.length < 2 || times[0] !== 0 || times.some((time, i) => i > 0 && time <= times[i - 1])) throw new Error(`${animation.getName()} has unordered or incomplete animation keys.`);
      if (output.some((value) => !Number.isFinite(value))) throw new Error(`${animation.getName()} contains non-finite animation values.`);
      duration = Math.max(duration, times.at(-1));
      for (const time of times) sampleTimes.add(time);
    }
    for (const phase of [.125, .25, .375, .5, .625, .75, .875, 1]) sampleTimes.add(duration * phase);
    const sampled = [...sampleTimes].sort((a, b) => a - b).map((time) => sampleAnimation(animation, time));
    const maxDisplacement = Math.max(...sampled.map((sample) => sample.displacementMax));
    const maxMovedVertices = Math.max(...sampled.map((sample) => sample.moved));
    const sweptBounds = {
      min: [0, 1, 2].map((axis) => Math.min(...sampled.map((sample) => sample.minimum[axis]))),
      max: [0, 1, 2].map((axis) => Math.max(...sampled.map((sample) => sample.maximum[axis]))),
    };
    if (!(maxDisplacement > (animation.getName() === 'Idle' ? .001 : .005)) || maxMovedVertices < 8) throw new Error(`${animation.getName()} does not deform a useful part of the source mesh.`);
    if (sweptBounds.min[1] < -.18 || sweptBounds.max[1] > 1.28 || Math.abs(sweptBounds.min[0]) > .92 || Math.abs(sweptBounds.max[0]) > .92 || Math.abs(sweptBounds.min[2]) > .82 || Math.abs(sweptBounds.max[2]) > .82) {
      throw new Error(`${animation.getName()} leaves plausible ground and animation bounds: ${JSON.stringify(sweptBounds)}.`);
    }
    clipReports.push({ name: animation.getName(), seconds: Number(duration.toFixed(5)), channels: animation.listChannels().length, sampledPoses: sampled.length, maximumVertexDisplacement: Number(maxDisplacement.toFixed(5)), maximumVerticesMoved: maxMovedVertices, sweptBounds });
  }
  const outputTextureMetrics = await Promise.all(checkRoot.listTextures().map(async (texture) => {
    const image = texture.getImage();
    return { name: texture.getName(), dimensions: await sharp(image).metadata().then(({ width, height }) => [width, height]), bytes: image.length, sha256: createHash('sha256').update(image).digest('hex') };
  }));
  for (const sourceTexture of sourceTextureMetrics) {
    const copied = outputTextureMetrics.find((texture) => texture.name === sourceTexture.name);
    if (!copied || copied.sha256 !== sourceTexture.sha256 || copied.bytes !== sourceTexture.bytes) throw new Error(`Source texture was changed: ${sourceTexture.name}.`);
  }
  return {
    sourceGeometry: { vertices: vertexCount, triangles: triangleCount, maxPositionDelta, maxNormalDelta, maxUvDelta, indexMismatches },
    skin: { joints: bones.length, maxJointIndex, normalized: true, maxWeightSumError: maxWeightSumErrorCandidate, verticesWithMultipleInfluences, minimumNonzeroWeight: minNonzeroWeight, influencedVertexCounts: bones.map((bone, index) => ({ name: bone.name, vertices: candidateBoneCounts[index] })) },
    inverseBind: { matrices: inverseBindArray.length / 16, maximumMatrixDelta: maxInverseBindError },
    textures: outputTextureMetrics,
    animations: clipReports,
  };
}
