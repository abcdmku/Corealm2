import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { Matrix4, Quaternion, Vector3 } from 'three';
import sharp from 'sharp';

const ownerDir = 'assets/art/tripo/imports/npcs/slayer-garek';
const sourcePath = 'assets/art/tripo/exports/5e176d0c-cd1b-4b6c-833a-df6c5abd9f46.glb';
const outputPath = `${ownerDir}/master-garek-native-rig-candidate.glb`;
const expectedSourceSha256 = '380ce2c187999399fa9943b6d4a50f12ed0802ed4edaad648d3f071548ab7a0d';
const io = new NodeIO();

await mkdir(ownerDir, { recursive: true });
const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
if (sourceSha256 !== expectedSourceSha256) throw new Error(`Pinned Garek source hash changed: ${sourceSha256}`);
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const skin = root.listSkins()[0];
if (!primitive || !skin || root.listMeshes().length !== 1 || root.listSkins().length !== 1) {
  throw new Error('Pinned Tripo export no longer has the expected single mesh and humanoid skin.');
}
if (root.listAnimations().length) throw new Error('Expected the pinned Tripo export to contain no animations.');

const positionAccessor = primitive.getAttribute('POSITION');
const uvAccessor = primitive.getAttribute('TEXCOORD_0');
const indicesAccessor = primitive.getIndices();
const positionValues = positionAccessor?.getArray();
const indexValues = indicesAccessor?.getArray();
const uvValues = uvAccessor?.getArray();
if (!positionValues || !indexValues || !uvValues || positionValues.length / 3 !== 7860 || indexValues.length / 3 !== 4637) {
  throw new Error('Pinned Garek geometry signature changed.');
}
const originalPositions = new Float32Array(positionValues);
const originalIndices = new indexValues.constructor(indexValues);
const originalUvs = new uvValues.constructor(uvValues);
const bounds = { min: positionAccessor.getMin([]), max: positionAccessor.getMax([]) };

const originalNames = new Set(skin.listJoints().map((node) => node.getName()));
const renamedBones = {
  Armature: 'MasterGarek_Armature',
  'tripo_node_8de35dcb-6c45-4f56-882a-33941e074718': 'MasterGarek_MeshNode',
  Hips: 'mixamorigHips',
  Spine: 'mixamorigSpine',
  Chest: 'mixamorigSpine1',
  UpperChest: 'mixamorigSpine2',
  Neck: 'mixamorigNeck',
  Neck_Twist_A: 'MasterGarek_NeckTwist',
  Head: 'mixamorigHead',
  Left_Eye: 'mixamorigLeftEye',
  Right_Eye: 'mixamorigRightEye',
  Left_Shoulder: 'mixamorigLeftShoulder',
  Right_Shoulder: 'mixamorigRightShoulder',
  Left_UpperArm: 'mixamorigLeftArm',
  Left_LowerArm: 'mixamorigLeftForeArm',
  Left_Hand: 'mixamorigLeftHand',
  Right_UpperArm: 'mixamorigRightArm',
  Right_LowerArm: 'mixamorigRightForeArm',
  Right_Hand: 'mixamorigRightHand',
  Left_UpperLeg: 'mixamorigLeftUpLeg',
  Left_LowerLeg: 'mixamorigLeftLeg',
  Left_Foot: 'mixamorigLeftFoot',
  Left_Toes: 'mixamorigLeftToeBase',
  Left_ToesEnd: 'mixamorigLeftToe_End',
  Right_UpperLeg: 'mixamorigRightUpLeg',
  Right_LowerLeg: 'mixamorigRightLeg',
  Right_Foot: 'mixamorigRightFoot',
  Right_Toes: 'mixamorigRightToeBase',
  Right_ToesEnd: 'mixamorigRightToe_End',
};
for (const side of ['Left', 'Right']) {
  for (const [part, token] of [['Thumb', 'Thumb'], ['Index', 'Index'], ['Middle', 'Middle'], ['Ring', 'Ring'], ['Pinky', 'Pinky']]) {
    const stem = `${side}_${part}`;
    renamedBones[`${stem}Proximal`] = `mixamorig${side}Hand${token}1`;
    renamedBones[`${stem}Intermediate`] = `mixamorig${side}Hand${token}2`;
    renamedBones[`${stem}Distal`] = `mixamorig${side}Hand${token}3`;
    if (originalNames.has(`${stem}DistalEnd`)) renamedBones[`${stem}DistalEnd`] = `mixamorig${side}Hand${token}3_End`;
  }
}

const joints = skin.listJoints();
const inverseBind = skin.getInverseBindMatrices()?.getArray();
if (!inverseBind || inverseBind.length !== joints.length * 16 || joints.length !== 66) {
  throw new Error('Expected the source 66-joint skin with one inverse-bind matrix per joint.');
}
const identity = new Matrix4();
const worldBind = joints.map((_, index) => new Matrix4().fromArray(Array.from(inverseBind.slice(index * 16, index * 16 + 16))).invert());
const indexByNode = new Map(joints.map((node, index) => [node, index]));
const oldNameByNode = new Map(joints.map((node) => [node, node.getName()]));
const localBind = [];
const bonePosition = [];
const boneRotation = [];
const boneScale = [];
for (let index = 0; index < joints.length; index++) {
  const node = joints[index];
  const parentIndex = indexByNode.get(node.getParentNode());
  const parentWorld = parentIndex === undefined ? identity : worldBind[parentIndex];
  const local = parentWorld.clone().invert().multiply(worldBind[index]);
  const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
  local.decompose(position, rotation, scale);
  if (![...position, ...rotation, ...scale].every(Number.isFinite)) throw new Error(`Invalid reconstructed bind for ${node.getName()}.`);
  localBind[index] = local;
  bonePosition[index] = new Vector3().setFromMatrixPosition(worldBind[index]);
  boneRotation[index] = rotation.normalize();
  boneScale[index] = scale;
  node.setTranslation(position.toArray()).setRotation(rotation.toArray()).setScale(scale.toArray());
  node.setName(renamedBones[oldNameByNode.get(node)] ?? `MasterGarek_${oldNameByNode.get(node)}`);
}
skin.setName('MasterGarek_Mixamo_Humanoid').setSkeleton(joints.find((node) => !indexByNode.has(node.getParentNode())));
mesh.setName('MasterGarekMesh');
const armature = root.listNodes().find((node) => node.getName() === 'Armature');
if (armature) armature.setName('MasterGarek_Armature');
const meshNode = root.listNodes().find((node) => node.getMesh() === mesh);
if (meshNode) meshNode.setName('MasterGarek_MeshNode');

const parentIndex = joints.map((node) => indexByNode.get(node.getParentNode()));
const jointByOldName = new Map(joints.map((node, index) => [oldNameByNode.get(node), { node, index }]));
function segmentDistance(point, start, end) {
  const vector = end.clone().sub(start);
  const lengthSquared = vector.lengthSq() || 1;
  const t = Math.max(0, Math.min(1, point.clone().sub(start).dot(vector) / lengthSquared));
  return point.distanceTo(start.clone().addScaledVector(vector, t));
}
const jointValues = new Uint16Array(positionValues.length / 3 * 4);
const weightValues = new Float32Array(positionValues.length / 3 * 4);
const weightedVertexCounts = new Uint32Array(joints.length);
let distributedVertexCount = 0;
let maximumWeightSumError = 0;
for (let vertex = 0; vertex < positionValues.length / 3; vertex++) {
  const point = new Vector3(positionValues[vertex * 3], positionValues[vertex * 3 + 1], positionValues[vertex * 3 + 2]);
  const [x, y, z] = point.toArray();
  const candidates = [];
  for (let index = 0; index < joints.length; index++) {
    const name = oldNameByNode.get(joints[index]);
    const parent = parentIndex[index];
    const start = parent === undefined ? bonePosition[index] : bonePosition[parent];
    const end = bonePosition[index];
    const distance = segmentDistance(point, start, end);
    let gate = 1;
    const isFinger = /_(Thumb|Index|Middle|Ring|Pinky)/.test(name);
    const side = name.startsWith('Left_') ? -1 : name.startsWith('Right_') ? 1 : 0;
    if (side) {
      const sideValue = side * z;
      gate *= 0.025 + 0.975 / (1 + Math.exp(-(sideValue + 0.006) / (isFinger ? 0.018 : 0.035)));
    }
    if (isFinger) {
      gate *= y > 0.61 && y < 0.82 && Math.abs(z) > 0.33 ? 1 : 0.01;
    } else if (name.includes('Eye')) {
      gate *= y > 0.80 && x > 0.015 ? 1 : 0.008;
    } else if (name === 'Head') {
      gate *= y > 0.73 ? 1 : 0.01;
    } else if (name.includes('Neck')) {
      gate *= y > 0.67 && y < 0.86 ? 1 : 0.01;
    } else if (/Shoulder|UpperArm|LowerArm|Hand/.test(name)) {
      gate *= y > 0.22 && y < 0.91 ? 1 : 0.01;
    } else if (/UpperLeg|LowerLeg|Foot|Toe/.test(name)) {
      gate *= y < 0.57 ? 1 : 0.01;
    } else {
      gate *= y > 0.30 && y < 0.84 ? 1 : 0.04;
    }
    let sigma = isFinger ? 0.020 : /UpperArm|LowerArm|Hand|UpperLeg|LowerLeg|Foot|Toe/.test(name) ? 0.050 : 0.068;
    if (/Spine|Chest|Hips/.test(name)) sigma = 0.085;
    const score = gate * Math.exp(-0.5 * (distance / sigma) ** 2);
    if (score > 1e-12) candidates.push({ index, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 4);
  if (!chosen.length) throw new Error(`No anatomical influence could be assigned to vertex ${vertex}.`);
  const total = chosen.reduce((sum, entry) => sum + entry.score, 0);
  let sum = 0, nonzero = 0;
  for (let slot = 0; slot < 4; slot++) {
    const entry = chosen[slot] ?? chosen[0];
    const weight = slot >= chosen.length ? 0 : slot === chosen.length - 1 ? 1 - sum : entry.score / total;
    jointValues[vertex * 4 + slot] = entry.index;
    weightValues[vertex * 4 + slot] = weight;
    sum += weight;
    if (weight > 1e-6) { nonzero++; weightedVertexCounts[entry.index]++; }
  }
  if (nonzero > 1) distributedVertexCount++;
  maximumWeightSumError = Math.max(maximumWeightSumError, Math.abs(sum - 1));
}
primitive.setAttribute('JOINTS_0', doc.createAccessor('MasterGarek_Joints0').setArray(jointValues).setType('VEC4').setBuffer(root.listBuffers()[0]));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('MasterGarek_Weights0').setArray(weightValues).setType('VEC4').setBuffer(root.listBuffers()[0]));

const baseColorTexture = root.listMaterials()[0]?.getBaseColorTexture();
const packedMetalRoughTexture = root.listMaterials()[0]?.getMetallicRoughnessTexture();
const normalTexture = root.listMaterials()[0]?.getNormalTexture();
if (!baseColorTexture || !packedMetalRoughTexture || !normalTexture) throw new Error('The starred export must keep its base color, packed metal/roughness, and normal maps.');
const sourceTextureMetrics = [];
const pbrMetrics = [];
for (const texture of root.listTextures()) {
  const image = texture.getImage();
  const hash = createHash('sha256').update(image).digest('hex');
  const { width, height } = await sharp(image).metadata();
  if (width !== 2048 || height !== 2048) throw new Error(`${texture.getName()} is not the expected 2K source map (${width}x${height}).`);
  sourceTextureMetrics.push({ name: texture.getName(), width, height, mime: texture.getMimeType(), bytes: image.length, sha256: hash });
  const sample = await sharp(image).removeAlpha().resize(128, 128, { kernel: 'nearest' }).raw().toBuffer();
  const channels = [];
  for (let channel = 0; channel < 3; channel++) {
    let minimum = 255, maximum = 0;
    for (let offset = channel; offset < sample.length; offset += 3) {
      minimum = Math.min(minimum, sample[offset]);
      maximum = Math.max(maximum, sample[offset]);
    }
    channels.push({ min: minimum, max: maximum });
  }
  if (texture === packedMetalRoughTexture) {
    if (channels[1].max - channels[1].min < 20 || channels[2].max - channels[2].min < 20) {
      throw new Error('The starred packed metal/roughness map is effectively flat.');
    }
    pbrMetrics.push({ map: 'metallicRoughness', packedChannelRanges: channels });
  }
  if (texture === normalTexture) pbrMetrics.push({ map: 'normal', channelRanges: channels });
  texture.setName(texture === baseColorTexture ? 'MasterGarek_BaseColor_2K' : texture === packedMetalRoughTexture ? 'MasterGarek_MetallicRoughness_2K' : texture === normalTexture ? 'MasterGarek_Normal_2K' : texture.getName());
}
const material = root.listMaterials()[0];
material.setName('MasterGarek_2K_PBR');

const jointIndexByOldName = new Map(joints.map((node, index) => [oldNameByNode.get(node), index]));
const restLocalQuaternion = joints.map((_, index) => {
  const p = new Vector3(), q = new Quaternion(), s = new Vector3();
  localBind[index].decompose(p, q, s);
  return q.normalize();
});
function axisQuaternion(axis, angle) {
  const vector = axis === 'x' ? new Vector3(1, 0, 0) : axis === 'y' ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
  return new Quaternion().setFromAxisAngle(vector, angle);
}
function combinedDelta(axes = []) {
  const result = new Quaternion();
  for (const [axis, angle] of axes) result.premultiply(axisQuaternion(axis, angle));
  return result.normalize();
}
const animationMetrics = [];
function addClip(name, duration, times, pose, hipOffset = () => [0, 0, 0]) {
  const animation = doc.createAnimation(name);
  const samples = times.map((time) => {
    const deltas = pose(time);
    const desiredWorld = new Array(joints.length);
    const localRotations = new Array(joints.length);
    for (let index = 0; index < joints.length; index++) {
      const parent = parentIndex[index];
      const inheritedWorld = parent === undefined ? restLocalQuaternion[index].clone() : desiredWorld[parent].clone().multiply(restLocalQuaternion[index]);
      const delta = deltas[oldNameByNode.get(joints[index])];
      desiredWorld[index] = delta ? delta.clone().multiply(inheritedWorld).normalize() : inheritedWorld;
      localRotations[index] = parent === undefined
        ? desiredWorld[index].clone()
        : desiredWorld[parent].clone().invert().multiply(desiredWorld[index]).normalize();
    }
    return { time, localRotations, hipTranslation: new Vector3(...joints[jointIndexByOldName.get('Hips')].getTranslation()).add(new Vector3(...hipOffset(time))).toArray() };
  });
  const buffer = root.listBuffers()[0];
  let trackCount = 0;
  for (let index = 0; index < joints.length; index++) {
    const differs = samples.some((sample) => Math.abs(sample.localRotations[index].dot(restLocalQuaternion[index])) < 0.999999);
    if (!differs) continue;
    const values = samples.map((sample) => sample.localRotations[index].toArray());
    const input = doc.createAccessor(`${name}_${joints[index].getName()}_time`).setArray(Float32Array.from(times.map((time) => time * duration))).setType('SCALAR').setBuffer(buffer);
    const output = doc.createAccessor(`${name}_${joints[index].getName()}_rotation`).setArray(Float32Array.from(values.flat())).setType('VEC4').setBuffer(buffer);
    const sampler = doc.createAnimationSampler(`${name}_${joints[index].getName()}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${name}_${joints[index].getName()}_rotation`).setTargetNode(joints[index]).setTargetPath('rotation').setSampler(sampler));
    trackCount++;
  }
  const hips = joints[jointIndexByOldName.get('Hips')];
  const translations = samples.map((sample) => sample.hipTranslation);
  if (translations.some((value) => value.some((component, axis) => Math.abs(component - hips.getTranslation()[axis]) > 1e-7))) {
    const input = doc.createAccessor(`${name}_Hips_translation_time`).setArray(Float32Array.from(times.map((time) => time * duration))).setType('SCALAR').setBuffer(buffer);
    const output = doc.createAccessor(`${name}_Hips_translation`).setArray(Float32Array.from(translations.flat())).setType('VEC3').setBuffer(buffer);
    const sampler = doc.createAnimationSampler(`${name}_Hips_translation`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${name}_Hips_translation`).setTargetNode(hips).setTargetPath('translation').setSampler(sampler));
    trackCount++;
  }
  animationMetrics.push({ name, seconds: duration, tracks: trackCount });
}

const idleTimes = [0, 0.25, 0.5, 0.75, 1];
const idle = (t) => {
  const breath = Math.sin(t * Math.PI * 2);
  return {
    Left_Shoulder: combinedDelta([['x', -0.78 - breath * 0.018]]),
    Right_Shoulder: combinedDelta([['x', 0.78 + breath * 0.018]]),
    Spine: combinedDelta([['y', breath * 0.012]]),
    Chest: combinedDelta([['z', breath * 0.014]]),
    Head: combinedDelta([['z', Math.sin(t * Math.PI * 2 + 0.6) * 0.018]]),
  };
};
addClip('Idle', 3.2, idleTimes, idle);
addClip('Walk', 1.0, idleTimes, (t) => {
  const phase = t * Math.PI * 2;
  const stride = Math.sin(phase);
  const lift = Math.max(0, Math.sin(phase));
  return {
    Left_Shoulder: combinedDelta([['x', -0.76], ['z', -stride * 0.11]]),
    Right_Shoulder: combinedDelta([['x', 0.76], ['z', stride * 0.11]]),
    Left_UpperLeg: combinedDelta([['z', stride * 0.28]]),
    Right_UpperLeg: combinedDelta([['z', -stride * 0.28]]),
    Left_LowerLeg: combinedDelta([['z', -lift * 0.20]]),
    Right_LowerLeg: combinedDelta([['z', -Math.max(0, -stride) * 0.20]]),
    Left_Foot: combinedDelta([['z', -stride * 0.10]]),
    Right_Foot: combinedDelta([['z', stride * 0.10]]),
    Spine: combinedDelta([['y', stride * 0.025]]),
  };
}, (t) => [0, 0.008 + Math.abs(Math.sin(t * Math.PI * 2)) * 0.008, 0]);
addClip('Run', 0.72, idleTimes, (t) => {
  const phase = t * Math.PI * 2;
  const stride = Math.sin(phase);
  return {
    Left_Shoulder: combinedDelta([['x', -0.62], ['z', -stride * 0.29]]),
    Right_Shoulder: combinedDelta([['x', 0.62], ['z', stride * 0.29]]),
    Left_UpperLeg: combinedDelta([['z', stride * 0.52]]),
    Right_UpperLeg: combinedDelta([['z', -stride * 0.52]]),
    Left_LowerLeg: combinedDelta([['z', -Math.max(0, Math.sin(phase)) * 0.48]]),
    Right_LowerLeg: combinedDelta([['z', -Math.max(0, -Math.sin(phase)) * 0.48]]),
    Left_Foot: combinedDelta([['z', -stride * 0.16]]),
    Right_Foot: combinedDelta([['z', stride * 0.16]]),
    Spine: combinedDelta([['y', stride * 0.06], ['z', Math.abs(stride) * 0.025]]),
  };
}, (t) => [0, 0.018 + Math.abs(Math.sin(t * Math.PI * 2)) * 0.016, 0]);
addClip('Talk', 2.1, [0, 0.16, 0.38, 0.58, 0.82, 1], (t) => {
  const wave = Math.sin(t * Math.PI * 4);
  const gesture = Math.sin(Math.min(1, t * 2.1) * Math.PI);
  return {
    Left_Shoulder: combinedDelta([['x', -0.78]]),
    Right_Shoulder: combinedDelta([['x', 0.76 - gesture * 0.20], ['z', -gesture * 0.10]]),
    Right_UpperArm: combinedDelta([['y', gesture * 0.34]]),
    Right_LowerArm: combinedDelta([['x', -gesture * 0.88]]),
    Right_Hand: combinedDelta([['x', -gesture * (0.10 + Math.max(0, wave) * 0.11)]]),
    Spine: combinedDelta([['y', gesture * 0.025]]),
    Head: combinedDelta([['z', Math.sin(t * Math.PI * 2) * 0.035]]),
  };
}, (t) => [0, Math.sin(Math.min(1, t * 2.1) * Math.PI) * 0.008, 0]);
addClip('Attack', 0.9, [0, 0.2, 0.52, 0.76, 1], (t) => {
  const windup = Math.max(0, Math.min(1, t / 0.2));
  const strike = t < 0.2 ? 0 : Math.sin(Math.PI * Math.min(1, (t - 0.2) / 0.56));
  const recover = t > 0.76 ? Math.max(0, 1 - (t - 0.76) / 0.24) : 0;
  const aim = windup * 0.28 + strike * 0.72;
  return {
    Left_Shoulder: combinedDelta([['x', -0.78], ['y', -aim * 0.34]]),
    Right_Shoulder: combinedDelta([['x', 0.50 - recover * 0.20], ['y', aim * 0.48]]),
    Right_UpperArm: combinedDelta([['y', aim * 0.66]]),
    Right_LowerArm: combinedDelta([['x', -0.42 + strike * 0.30]]),
    Spine: combinedDelta([['y', -aim * 0.16], ['z', strike * 0.06]]),
    Head: combinedDelta([['z', strike * 0.04]]),
  };
}, (t) => [0, t > 0.20 && t < 0.76 ? Math.sin(Math.PI * (t - 0.20) / 0.56) * 0.012 : 0, 0]);
addClip('Hit', 0.46, [0, 0.15, 0.44, 1], (t) => {
  const recoil = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 0.85);
  return {
    Left_Shoulder: combinedDelta([['x', -0.68 + recoil * 0.12]]),
    Right_Shoulder: combinedDelta([['x', 0.68 - recoil * 0.12]]),
    Left_UpperArm: combinedDelta([['z', -recoil * 0.24]]),
    Right_UpperArm: combinedDelta([['z', recoil * 0.24]]),
    Spine: combinedDelta([['z', recoil * 0.16], ['y', -recoil * 0.06]]),
    Head: combinedDelta([['z', recoil * 0.15]]),
  };
}, (t) => [-Math.max(0, 1 - t / 0.46) * 0.02, 0, 0]);
addClip('Death', 1.45, [0, 0.18, 0.48, 0.76, 1], (t) => {
  const fall = Math.min(1, t / 0.76);
  return {
    Left_Shoulder: combinedDelta([['x', -0.48], ['z', -fall * 0.18]]),
    Right_Shoulder: combinedDelta([['x', 0.48], ['z', fall * 0.18]]),
    Left_UpperArm: combinedDelta([['z', -fall * 0.32]]),
    Right_UpperArm: combinedDelta([['z', fall * 0.32]]),
    Left_UpperLeg: combinedDelta([['z', -fall * 0.20]]),
    Right_UpperLeg: combinedDelta([['z', fall * 0.20]]),
    Hips: combinedDelta([['z', fall * 0.92]]),
    Spine: combinedDelta([['z', fall * 0.18]]),
    Head: combinedDelta([['z', fall * 0.12]]),
  };
}, (t) => [Math.min(1, t / 0.76) * 0.04, -Math.min(1, t / 0.76) * 0.24, 0]);

const outputBytes = await io.writeBinary(doc);
await writeFile(outputPath, outputBytes);
const candidateSha256 = createHash('sha256').update(outputBytes).digest('hex');
const checkDoc = await io.readBinary(outputBytes);
const checkRoot = checkDoc.getRoot();
const checkMesh = checkRoot.listMeshes()[0];
const checkPrimitive = checkMesh.listPrimitives()[0];
const checkPositions = checkPrimitive.getAttribute('POSITION')?.getArray();
const checkIndices = checkPrimitive.getIndices()?.getArray();
const checkUvs = checkPrimitive.getAttribute('TEXCOORD_0')?.getArray();
const checkJoints = checkPrimitive.getAttribute('JOINTS_0')?.getArray();
const checkWeights = checkPrimitive.getAttribute('WEIGHTS_0')?.getArray();
const checkSkin = checkRoot.listSkins()[0];
if (!checkPositions || !checkIndices || !checkUvs || !checkJoints || !checkWeights || !checkSkin) throw new Error('The candidate export lost geometry, UVs, or skin data.');
let maxPositionDelta = 0, indexMismatches = 0, uvMismatches = 0, verticesWithDistributedWeights = 0;
for (let i = 0; i < originalPositions.length; i++) maxPositionDelta = Math.max(maxPositionDelta, Math.abs(originalPositions[i] - checkPositions[i]));
for (let i = 0; i < originalIndices.length; i++) if (originalIndices[i] !== checkIndices[i]) indexMismatches++;
for (let i = 0; i < originalUvs.length; i++) if (originalUvs[i] !== checkUvs[i]) uvMismatches++;
for (let vertex = 0; vertex < checkPositions.length / 3; vertex++) {
  let sum = 0, distributed = 0;
  for (let slot = 0; slot < 4; slot++) {
    const joint = checkJoints[vertex * 4 + slot], weight = checkWeights[vertex * 4 + slot];
    if (!Number.isInteger(joint) || joint < 0 || joint >= checkSkin.listJoints().length || !Number.isFinite(weight) || weight < 0) throw new Error(`Invalid influence at vertex ${vertex}.`);
    sum += weight;
    if (weight > 1e-6) distributed++;
  }
  if (Math.abs(sum - 1) > 1e-5) throw new Error(`Vertex ${vertex} has non-normalized weights (${sum}).`);
  if (distributed > 1) verticesWithDistributedWeights++;
}
const clipNames = checkRoot.listAnimations().map((entry) => entry.getName());
const requiredClips = ['Idle', 'Walk', 'Run', 'Talk', 'Attack', 'Hit', 'Death'];
if (requiredClips.some((name) => !clipNames.includes(name))) throw new Error(`Missing required motion clips: ${requiredClips.filter((name) => !clipNames.includes(name))}.`);
for (const animation of checkRoot.listAnimations()) for (const channel of animation.listChannels()) {
  if (!checkSkin.listJoints().includes(channel.getTargetNode())) throw new Error(`${animation.getName()} targets a node outside its humanoid skin.`);
}
const checkJointsList = checkSkin.listJoints();
const checkJointIndex = new Map(checkJointsList.map((node, index) => [node, index]));
const checkBindWorld = new Array(checkJointsList.length);
for (let index = 0; index < checkJointsList.length; index++) {
  const node = checkJointsList[index];
  const local = new Matrix4().compose(new Vector3(...node.getTranslation()), new Quaternion(...node.getRotation()), new Vector3(...node.getScale()));
  const parent = checkJointIndex.get(node.getParentNode());
  checkBindWorld[index] = parent === undefined ? local : checkBindWorld[parent].clone().multiply(local);
}
let bindTransformMaxError = 0, bindPoseMaxVertexDelta = 0;
for (let index = 0; index < checkJointsList.length; index++) {
  const expectedWorld = new Matrix4().fromArray(Array.from(inverseBind.slice(index * 16, index * 16 + 16))).invert();
  const error = checkBindWorld[index].clone().multiply(expectedWorld.clone().invert());
  for (let element = 0; element < 16; element++) bindTransformMaxError = Math.max(bindTransformMaxError, Math.abs(error.elements[element] - identity.elements[element]));
}
for (let vertex = 0; vertex < checkPositions.length / 3; vertex++) {
  const sourcePoint = new Vector3(originalPositions[vertex * 3], originalPositions[vertex * 3 + 1], originalPositions[vertex * 3 + 2]);
  const deformed = new Vector3();
  for (let slot = 0; slot < 4; slot++) {
    const influence = vertex * 4 + slot;
    const joint = checkJoints[influence], weight = checkWeights[influence];
    const sourceInverseBind = new Matrix4().fromArray(Array.from(inverseBind.slice(joint * 16, joint * 16 + 16)));
    const skinnedBindPoint = sourcePoint.clone().applyMatrix4(sourceInverseBind).applyMatrix4(checkBindWorld[joint]);
    deformed.addScaledVector(skinnedBindPoint, weight);
  }
  bindPoseMaxVertexDelta = Math.max(bindPoseMaxVertexDelta, deformed.distanceTo(sourcePoint));
}
if (maxPositionDelta !== 0 || indexMismatches || uvMismatches || verticesWithDistributedWeights < checkPositions.length / 3 * 0.75 || maximumWeightSumError > 1e-6 || bindTransformMaxError > 2e-5 || bindPoseMaxVertexDelta > 2e-5) {
  throw new Error(`Candidate preservation/bind check failed: position delta=${maxPositionDelta}, index=${indexMismatches}, UV=${uvMismatches}, distributed=${verticesWithDistributedWeights}/${checkPositions.length / 3}, weightSumError=${maximumWeightSumError}, bindTransformError=${bindTransformMaxError}, bindPoseDelta=${bindPoseMaxVertexDelta}.`);
}
const candidate = {
  schema: 'corealm-npc-native-rig-candidate/1',
  id: 'npc_slayer_garek',
  displayName: 'Master Garek',
  status: 'awaiting-root-lab-review',
  accepted: false,
  source: {
    file: sourcePath,
    sha256: sourceSha256,
    bytes: sourceBytes.length,
    starredModelId: '137e9dae-273c-4230-9da0-370e2a945c90',
    starredCardId: '5e176d0c-cd1b-4b6c-833a-df6c5abd9f46',
    starredDisplayName: 'goblin slayer master',
    prompt: 'green goblin with tattered leather armor, belts, and accessories.',
    sourceModelVersion: 'P1.0',
    sourceTriangleCount: indexValues.length / 3,
    sourceJointCount: joints.length,
    initialRigProblems: ['All 7,860 vertices weighted 100% to Hips.', 'Every source joint node has identity TRS; inverse bind matrices contain the bind-space joint transforms.', 'No animations were present.'],
    sourceSkin: 'Tripo 66-joint humanoid skeleton, preserved and given reconstructed bind TRS.',
    geometry: { vertices: positionValues.length / 3, triangles: indexValues.length / 3, positionsPreserved: maxPositionDelta === 0, indicesPreserved: indexMismatches === 0, uvsPreserved: uvMismatches === 0, retopology: false },
    textures: sourceTextureMetrics,
    pbr: pbrMetrics,
  },
  candidate: {
    file: outputPath,
    sha256: candidateSha256,
    bytes: outputBytes.length,
    productionTarget: 'game/public/assets/models/character/npc_slayer_garek.glb',
    geometry: { vertices: positionValues.length / 3, triangles: indexValues.length / 3, positionsPreserved: true, indicesPreserved: true, uvsPreserved: true, retopology: false },
    rig: {
      preset: 'Mixamo-named humanoid glTF rig for Unity Humanoid mapping review',
      jointCount: joints.length,
      influencesPerVertex: 4,
      verticesWithDistributedWeights,
      maximumWeightSumError,
      bindTransformMaxError,
      bindPoseMaxVertexDelta,
      bones: joints.map((node, index) => ({ name: node.getName(), parent: parentIndex[index] === undefined ? null : joints[parentIndex[index]].getName(), bindPosition: bonePosition[index].toArray() })),
      inverseBindsPreserved: true,
      method: 'Recovered rest-world joint transforms by inverting the source inverse-bind matrices, restored each joint local TRS, then assigned four normalized anatomy-gated segment-distance influences per vertex.',
    },
    textures: sourceTextureMetrics.map((texture) => ({ ...texture, runtimeWidth: texture.width, runtimeHeight: texture.height })),
    material: { name: material.getName(), baseColorTexture: baseColorTexture.getName(), metallicRoughnessTexture: packedMetalRoughTexture.getName(), normalTexture: normalTexture.getName(), baseColorFactor: material.getBaseColorFactor(), metallicFactor: material.getMetallicFactor(), roughnessFactor: material.getRoughnessFactor() },
    animations: animationMetrics,
  },
  acceptance: { userStarredSource: true, assetAudit: false, bindPoseAccepted: false, rigAccepted: false, motionAccepted: false, pbrAccepted: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${ownerDir}/catalog.json`, `${JSON.stringify(candidate, null, 2)}\n`);
const lab = {
  schema: 'corealm-lab-asset-candidates/1',
  pack: { id: 'corealm-starred-npcs', name: 'Corealm starred Tripo NPC candidates', author: 'Corealm', source: 'Starred Tripo P1 NPC and Corealm bind/weight/motion adaptation', license: 'LicenseRef-Corealm-Original' },
  assets: [{
    id: 'npc_slayer_garek', file: 'models/character/npc_slayer_garek.glb', pack: 'corealm-starred-npcs', category: 'character', is: 'Master Garek candidate',
    tags: ['npc', 'humanoid', 'goblin', 'slayer-master', 'coldbrace', 'starter-area', 'starred', 'tripo', 'candidate'],
    bytes: outputBytes.length, sha256: candidateSha256,
    size: { x: bounds.max[0] - bounds.min[0], y: bounds.max[1] - bounds.min[1], z: bounds.max[2] - bounds.min[2] },
    base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] }, bounds, groundY: bounds.min[1], triangles: indexValues.length / 3,
    animations: animationMetrics.map((entry) => entry.name), materials: [material.getName()],
    sourceProvenance: { author: 'Corealm bind, skin-weight and motion reconstruction', sourceModelId: '137e9dae-273c-4230-9da0-370e2a945c90', sourceCardId: '5e176d0c-cd1b-4b6c-833a-df6c5abd9f46', sourceFile: sourcePath, sourceSha256, candidateFile: outputPath, candidateSha256, candidateStatus: 'awaiting-root-lab-review', rigAuthoring: candidate.candidate.rig.method, prompt: candidate.source.prompt },
    candidateReview: { accepted: false, assetAudit: false, labAccepted: false, worldIntegrated: false },
  }],
};
await writeFile(`${ownerDir}/lab-catalog.json`, `${JSON.stringify(lab, null, 2)}\n`);
console.log(JSON.stringify({ sourceSha256, candidateSha256, outputBytes: outputBytes.length, geometry: candidate.candidate.geometry, rig: { joints: joints.length, distributedVertices: verticesWithDistributedWeights, totalVertices: positionValues.length / 3, maximumWeightSumError, bindTransformMaxError, bindPoseMaxVertexDelta }, animations: animationMetrics, textures: sourceTextureMetrics, pbr: pbrMetrics }, null, 2));
