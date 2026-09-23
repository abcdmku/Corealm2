import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Matrix4, Quaternion, Vector3 } from 'three';
import sharp from 'sharp';

const ownerDir = 'assets/art/tripo/imports/npcs/slayer-aevra';
const sourcePath = 'assets/art/tripo/exports/98ca3c8c-f4de-43dc-9ba3-427d8a5bbfa0.glb';
const candidatePath = `${ownerDir}/aevra-wings-native-rig.glb`;
const sourceSha256Expected = '44603b348523d0cf683da09da8a38058785e156ea5194858d093848ba917c9e1';
await mkdir(ownerDir, { recursive: true });

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
if (sourceSha256 !== sourceSha256Expected) throw new Error(`Aevra source hash mismatch: ${sourceSha256}`);
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const skin = root.listSkins()[0];
const mesh = root.listMeshes()[0];
const meshNode = root.listNodes().find((node) => node.getMesh() === mesh);
const primitive = mesh?.listPrimitives()[0];
if (!scene || !skin || !meshNode || !primitive || root.listAnimations().length !== 0) {
  throw new Error('Expected Aevra source: one skinned mesh, one existing skeleton, and no source animation clips.');
}

const positions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
const normals = Float32Array.from(primitive.getAttribute('NORMAL')?.getArray() ?? []);
const uv0 = Float32Array.from(primitive.getAttribute('TEXCOORD_0')?.getArray() ?? []);
const indices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
if (positions.length / 3 !== 8103 || indices.length / 3 !== 4714 || uv0.length / 2 !== 8103) {
  throw new Error(`Aevra source topology changed: ${positions.length / 3} vertices, ${indices.length / 3} triangles, ${uv0.length / 2} UVs.`);
}

const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
  bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
}
const originalJoints = skin.listJoints();
const originalNames = originalJoints.map((node) => node.getName());
const originalIndexByName = new Map(originalNames.map((name, index) => [name, index]));
const originalIndexByNode = new Map(originalJoints.map((node, index) => [node, index]));
const inverseBindAccessor = skin.getInverseBindMatrices();
const sourceInverseBinds = Float32Array.from(inverseBindAccessor?.getArray() ?? []);
if (!inverseBindAccessor || sourceInverseBinds.length !== originalJoints.length * 16) throw new Error('Source inverse-bind matrix count does not match its skin joints.');
const sourceJoints = primitive.getAttribute('JOINTS_0')?.getArray();
const sourceWeights = primitive.getAttribute('WEIGHTS_0')?.getArray();
if (!sourceJoints || !sourceWeights) throw new Error('Aevra source skin has no joint/weight attributes.');
const sourceWeightedVertices = new Map();
for (let vertex = 0; vertex < positions.length / 3; vertex++) for (let slot = 0; slot < 4; slot++) {
  if (sourceWeights[vertex * 4 + slot] > 1e-6) {
    const jointIndex = sourceJoints[vertex * 4 + slot];
    sourceWeightedVertices.set(jointIndex, (sourceWeightedVertices.get(jointIndex) ?? 0) + 1);
  }
}
const sourceHipsBindWorld = new Matrix4().fromArray(Array.from(sourceInverseBinds.slice(0, 16))).invert();
const sourceHipsBindPosition = new Vector3().setFromMatrixPosition(sourceHipsBindWorld).toArray();

// Standard Mixamo names keep the humanoid portion easy to map in Unity; source geometry and vertex order stay fixed.
const standardNames = {
  Hips: 'mixamorigHips', Spine: 'mixamorigSpine', Chest: 'mixamorigSpine1', UpperChest: 'mixamorigSpine2',
  Neck: 'mixamorigNeck', Neck_Twist_A: 'mixamorigNeckTwist', Head: 'mixamorigHead',
  Left_Eye: 'mixamorigLeftEye', Right_Eye: 'mixamorigRightEye',
  Left_Shoulder: 'mixamorigLeftShoulder', Left_UpperArm: 'mixamorigLeftArm', Left_LowerArm: 'mixamorigLeftForeArm', Left_Hand: 'mixamorigLeftHand',
  Right_Shoulder: 'mixamorigRightShoulder', Right_UpperArm: 'mixamorigRightArm', Right_LowerArm: 'mixamorigRightForeArm', Right_Hand: 'mixamorigRightHand',
  Left_UpperLeg: 'mixamorigLeftUpLeg', Left_LowerLeg: 'mixamorigLeftLeg', Left_Foot: 'mixamorigLeftFoot', Left_Toes: 'mixamorigLeftToeBase', Left_ToesEnd: 'mixamorigLeftToeEnd',
  Right_UpperLeg: 'mixamorigRightUpLeg', Right_LowerLeg: 'mixamorigRightLeg', Right_Foot: 'mixamorigRightFoot', Right_Toes: 'mixamorigRightToeBase', Right_ToesEnd: 'mixamorigRightToeEnd',
};
for (const side of ['Left', 'Right']) {
  for (const [source, target] of [
    ['ThumbProximal', 'Thumb1'], ['ThumbIntermediate', 'Thumb2'], ['ThumbDistal', 'Thumb3'], ['ThumbDistalEnd', 'Thumb3End'],
    ['IndexProximal', 'Index1'], ['IndexIntermediate', 'Index2'], ['IndexDistal', 'Index3'], ['IndexDistalEnd', 'Index3End'],
    ['MiddleProximal', 'Middle1'], ['MiddleIntermediate', 'Middle2'], ['MiddleDistal', 'Middle3'], ['MiddleDistalEnd', 'Middle3End'],
    ['RingProximal', 'Ring1'], ['RingIntermediate', 'Ring2'], ['RingDistal', 'Ring3'], ['RingDistalEnd', 'Ring3End'],
    ['PinkyProximal', 'Pinky1'], ['PinkyIntermediate', 'Pinky2'], ['PinkyDistal', 'Pinky3'], ['PinkyDistalEnd', 'Pinky3End'],
  ]) standardNames[`${side}_${source}`] = `mixamorig${side}Hand${target}`;
}
for (const joint of originalJoints) if (standardNames[joint.getName()]) joint.setName(standardNames[joint.getName()]);
const jointNodes = new Map(originalJoints.map((node) => [node.getName(), node]));
const sourceNodeByName = new Map(originalJoints.map((node) => [originalNames[originalIndexByNode.get(node)], node]));

// The exported inverse binds place the body off-center and send the arm chains through depth, while
// the unchanged source mesh is centered on X with its humanoid silhouette facing +Z. Rebuild the
// skeleton's bind pose on that actual mesh frame instead of inheriting the malformed source bind.
const bindGlobalPosition = new Map();
const bindWorld = new Map();
const bindLocal = new Map();
const standardNamesBySource = (name) => standardNames[name] ?? name;
const sideSign = (name) => name.startsWith('Left_') ? -1 : 1;
const restPointFor = (name) => {
  const named = {
    Hips: [0, 0.49, 0.15], Spine: [0, 0.54, 0.15], Chest: [0, 0.61, 0.15], UpperChest: [0, 0.68, 0.15],
    Neck: [0, 0.76, 0.15], Neck_Twist_A: [0, 0.79, 0.15], Head: [0, 0.84, 0.15],
    Left_Eye: [-0.027, 0.86, 0.238], Right_Eye: [0.027, 0.86, 0.238],
    Left_Shoulder: [-0.07, 0.75, 0.15], Left_UpperArm: [-0.105, 0.69, 0.15], Left_LowerArm: [-0.12, 0.63, 0.15], Left_Hand: [-0.14, 0.59, 0.15],
    Right_Shoulder: [0.07, 0.75, 0.15], Right_UpperArm: [0.105, 0.69, 0.15], Right_LowerArm: [0.12, 0.63, 0.15], Right_Hand: [0.14, 0.59, 0.15],
    Left_UpperLeg: [-0.065, 0.47, 0.15], Left_LowerLeg: [-0.075, 0.27, 0.15], Left_Foot: [-0.075, 0.07, 0.15], Left_Toes: [-0.075, 0.035, 0.23], Left_ToesEnd: [-0.075, 0.025, 0.28],
    Right_UpperLeg: [0.065, 0.47, 0.15], Right_LowerLeg: [0.075, 0.27, 0.15], Right_Foot: [0.075, 0.07, 0.15], Right_Toes: [0.075, 0.035, 0.23], Right_ToesEnd: [0.075, 0.025, 0.28],
  };
  if (named[name]) return new Vector3(...named[name]);
  const fingerMatch = name.match(/^(Left|Right)_(Thumb|Index|Middle|Ring|Pinky)(Proximal|Intermediate|Distal|DistalEnd)$/);
  if (fingerMatch) {
    const [, side, digit, phalanx] = fingerMatch;
    const digitIndex = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].indexOf(digit) - 2;
    const phalanxIndex = ['Proximal', 'Intermediate', 'Distal', 'DistalEnd'].indexOf(phalanx);
    const sign = side === 'Left' ? -1 : 1;
    return new Vector3(sign * (0.14 + digitIndex * 0.008), 0.59 - Math.max(0, phalanxIndex - 1) * 0.003, 0.15 + phalanxIndex * 0.025);
  }
  const parent = sourceNodeByName.get(name)?.getParentNode();
  const parentPosition = parent ? bindGlobalPosition.get(parent) : undefined;
  return parentPosition?.clone() ?? new Vector3(0, 0.49, 0.15);
};
const reconstructedInverseBinds = new Float32Array(originalJoints.length * 16);
for (let index = 0; index < originalJoints.length; index++) {
  const node = originalJoints[index];
  const sourceName = originalNames[index];
  const position = restPointFor(sourceName);
  const parent = node.getParentNode();
  const parentPosition = parent ? bindGlobalPosition.get(parent) : undefined;
  const localPosition = parentPosition ? position.clone().sub(parentPosition) : position.clone();
const local = new Matrix4().compose(localPosition, new Quaternion(), new Vector3(1, 1, 1));
  const world = new Matrix4().compose(position, new Quaternion(), new Vector3(1, 1, 1));
  node.setTranslation(localPosition.toArray()).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  bindWorld.set(node, world);
  bindLocal.set(node, local);
  bindGlobalPosition.set(node, position);
  reconstructedInverseBinds.set(world.clone().invert().toArray(), index * 16);
}
inverseBindAccessor.setArray(reconstructedInverseBinds).setType(Accessor.Type.MAT4);
const bindPositionBySourceName = new Map([...sourceNodeByName].map(([name, node]) => [name, bindGlobalPosition.get(node)]));
const bindPositionByStandardName = new Map([...sourceNodeByName].map(([name, node]) => [standardNamesBySource(name), bindGlobalPosition.get(node)]));

const upperChest = sourceNodeByName.get('UpperChest');
if (!upperChest) throw new Error('Aevra skeleton is missing UpperChest.');
const centerX = 0;
const wingZ = 0.16;
const minX = bounds.min[0], maxX = bounds.max[0];
const wingSpan = { L: Math.abs(centerX - minX), R: Math.abs(maxX - centerX) };
const wingDefs = [
  { key: 'LUpper', side: 'L', y: 0.735, span: wingSpan.L * 0.98 },
  { key: 'RUpper', side: 'R', y: 0.735, span: wingSpan.R * 0.98 },
  { key: 'LLower', side: 'L', y: 0.645, span: wingSpan.L * 0.78 },
  { key: 'RLower', side: 'R', y: 0.645, span: wingSpan.R * 0.78 },
];
const wingBones = [];
const wingData = new Map();
const worldToLocal = (world, parentWorld) => parentWorld.clone().invert().multiply(world);
for (const def of wingDefs) {
  const sign = def.side === 'L' ? -1 : 1;
  const rootName = `AevraWing${def.key}Root`;
  const tipName = `AevraWing${def.key}Tip`;
  const rootWorld = new Matrix4().compose(new Vector3(centerX, def.y, wingZ), new Quaternion(), new Vector3(1, 1, 1));
  const tipWorld = new Matrix4().compose(new Vector3(centerX + sign * def.span, def.y, wingZ), new Quaternion(), new Vector3(1, 1, 1));
  const rootLocal = worldToLocal(rootWorld, bindWorld.get(upperChest));
  const rootPosition = new Vector3(), rootRotation = new Quaternion(), rootScale = new Vector3();
  rootLocal.decompose(rootPosition, rootRotation, rootScale);
  const rootNode = doc.createNode(rootName).setTranslation(rootPosition.toArray()).setRotation(rootRotation.toArray()).setScale(rootScale.toArray());
  upperChest.addChild(rootNode);
  const tipLocal = worldToLocal(tipWorld, rootWorld);
  const tipPosition = new Vector3(), tipRotation = new Quaternion(), tipScale = new Vector3();
  tipLocal.decompose(tipPosition, tipRotation, tipScale);
  const tipNode = doc.createNode(tipName).setTranslation(tipPosition.toArray()).setRotation(tipRotation.toArray()).setScale(tipScale.toArray());
  rootNode.addChild(tipNode);
  const rootIndex = skin.listJoints().length;
  skin.addJoint(rootNode);
  skin.addJoint(tipNode);
  const rootIbm = rootWorld.clone().invert().toArray();
  const tipIbm = tipWorld.clone().invert().toArray();
  wingBones.push({ name: rootName, node: rootNode, world: rootWorld, inverseBind: rootIbm, index: rootIndex, sourceName: def.key, kind: 'root', side: def.side, y: def.y, span: def.span });
  wingBones.push({ name: tipName, node: tipNode, world: tipWorld, inverseBind: tipIbm, index: rootIndex + 1, sourceName: def.key, kind: 'tip', side: def.side, y: def.y, span: def.span });
  jointNodes.set(rootName, rootNode);
  jointNodes.set(tipName, tipNode);
  bindGlobalPosition.set(rootNode, new Vector3(centerX, def.y, wingZ));
  bindGlobalPosition.set(tipNode, new Vector3().setFromMatrixPosition(tipWorld));
  bindPositionByStandardName.set(rootName, bindGlobalPosition.get(rootNode));
  bindPositionByStandardName.set(tipName, bindGlobalPosition.get(tipNode));
  wingData.set(def.key, { ...def, sign, rootIndex, tipIndex: rootIndex + 1, rootName, tipName });
}

const extendedInverseBinds = new Float32Array(reconstructedInverseBinds.length + wingBones.length * 16);
extendedInverseBinds.set(reconstructedInverseBinds);
for (let i = 0; i < wingBones.length; i++) extendedInverseBinds.set(wingBones[i].inverseBind, reconstructedInverseBinds.length + i * 16);
inverseBindAccessor.setArray(extendedInverseBinds).setType(Accessor.Type.MAT4);

const smoothstep = (a, b, value) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const segmentDistance = (point, start, end) => {
  const vector = end.clone().sub(start);
  const length2 = vector.lengthSq() || 1;
  const t = Math.max(0, Math.min(1, point.clone().sub(start).dot(vector) / length2));
  return point.distanceTo(start.clone().addScaledVector(vector, t));
};
const groupOf = (sourceName) => {
  if (sourceName === 'Hips') return 'hips';
  if (sourceName === 'Spine') return 'spine';
  if (sourceName === 'Chest') return 'chest';
  if (sourceName === 'UpperChest') return 'upperChest';
  if (sourceName === 'Neck' || sourceName === 'Neck_Twist_A') return 'neck';
  if (sourceName === 'Head') return 'head';
  if (sourceName.endsWith('_Eye')) return 'eye';
  if (sourceName.includes('Thumb') || sourceName.includes('Index') || sourceName.includes('Middle') || sourceName.includes('Ring') || sourceName.includes('Pinky')) return 'finger';
  if (sourceName.startsWith('Left_') && (sourceName.includes('Arm') || sourceName.includes('Hand') || sourceName.includes('Shoulder'))) return 'leftArm';
  if (sourceName.startsWith('Right_') && (sourceName.includes('Arm') || sourceName.includes('Hand') || sourceName.includes('Shoulder'))) return 'rightArm';
  if (sourceName.startsWith('Left_') && (sourceName.includes('Leg') || sourceName.includes('Foot') || sourceName.includes('Toe'))) return 'leftLeg';
  if (sourceName.startsWith('Right_') && (sourceName.includes('Leg') || sourceName.includes('Foot') || sourceName.includes('Toe'))) return 'rightLeg';
  return 'other';
};
const sigmaOf = (group) => ({ hips: 0.135, spine: 0.100, chest: 0.100, upperChest: 0.105, neck: 0.075, head: 0.095, eye: 0.035, finger: 0.045, leftArm: 0.085, rightArm: 0.085, leftLeg: 0.090, rightLeg: 0.090, other: 0.070 })[group];
const bodyScore = (point, sourceName, node) => {
  const group = groupOf(sourceName);
  const end = bindGlobalPosition.get(node);
  const parent = node.getParentNode();
  const start = parent && bindGlobalPosition.get(parent) ? bindGlobalPosition.get(parent) : end;
  const distance = segmentDistance(point, start, end);
  let gate = 1;
  if (group === 'hips') gate = (1 - smoothstep(0.39, 0.58, point.y)) * Math.exp(-0.5 * (point.x / 0.20) ** 2);
  if (group === 'spine') gate = smoothstep(0.43, 0.50, point.y) * (1 - smoothstep(0.60, 0.67, point.y)) * Math.exp(-0.5 * (point.x / 0.09) ** 2);
  if (group === 'chest') gate = smoothstep(0.52, 0.58, point.y) * (1 - smoothstep(0.68, 0.73, point.y)) * Math.exp(-0.5 * (point.x / 0.12) ** 2);
  if (group === 'upperChest') gate = smoothstep(0.61, 0.67, point.y) * (1 - smoothstep(0.76, 0.82, point.y)) * Math.exp(-0.5 * (point.x / 0.15) ** 2);
  if (group === 'neck') gate = smoothstep(0.68, 0.76, point.y) * (1 - smoothstep(0.83, 0.88, point.y));
  if (group === 'head') gate = smoothstep(0.76, 0.83, point.y);
  if (group === 'eye') gate = smoothstep(0.83, 0.87, point.y);
  if (group === 'leftArm' || group === 'rightArm') {
    const side = group === 'leftArm' ? -1 : 1;
    gate = smoothstep(0.56, 0.64, point.y) * (1 - smoothstep(0.88, 0.94, point.y));
    gate *= smoothstep(0.025, 0.095, side * point.x);
    gate *= Math.exp(-0.5 * ((point.z - 0.15) / 0.14) ** 2);
  }
  if (group === 'leftLeg' || group === 'rightLeg') {
    const side = group === 'leftLeg' ? -1 : 1;
    gate = 1 - smoothstep(0.45, 0.61, point.y);
    gate *= smoothstep(0.00, 0.075, side * point.x);
    gate *= Math.exp(-0.5 * ((point.z - 0.15) / 0.15) ** 2);
  }
  if (group === 'finger') {
    const side = sourceName.startsWith('Left_') ? -1 : 1;
    gate = smoothstep(0.43, 0.49, point.y) * smoothstep(0.10, 0.20, side * point.x);
    gate *= Math.exp(-0.5 * ((point.z - 0.18) / 0.10) ** 2);
  }
  if (group === 'eye') gate *= Math.exp(-0.5 * (point.x / 0.08) ** 2);
  const sigma = sigmaOf(group);
  return { index: originalIndexByName.get(sourceName), score: gate * Math.exp(-0.5 * (distance / sigma) ** 2) };
};

const jointValues = new Uint16Array((positions.length / 3) * 4);
const weightValues = new Float32Array((positions.length / 3) * 4);
const influenceCounts = new Uint32Array(skin.listJoints().length);
let verticesWithDistributedWeights = 0;
let maxWeightSumError = 0;
const wingVertexCounts = { LUpper: 0, RUpper: 0, LLower: 0, RLower: 0 };
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  const point = new Vector3(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]);
  const candidates = [];
  for (let i = 0; i < originalJoints.length; i++) {
    const sourceName = originalNames[i];
    const candidate = bodyScore(point, sourceName, originalJoints[i]);
    if (candidate.score > 1e-10) candidates.push(candidate);
  }

  const lateralDistance = Math.abs(point.x - centerX);
  const wingBand = smoothstep(0.59, 0.64, point.y) * (1 - smoothstep(0.79, 0.83, point.y));
  const wingStrength = wingBand * smoothstep(0.14, 0.20, lateralDistance);
  if (wingStrength > 1e-5) {
    const side = point.x < centerX ? 'L' : 'R';
    const vertical = smoothstep(0.675, 0.72, point.y);
    const classes = side === 'L' ? ['LLower', 'LUpper'] : ['RLower', 'RUpper'];
    for (const [classKey, bandShare] of [[classes[0], 1 - vertical], [classes[1], vertical]]) {
      if (bandShare < 1e-5) continue;
      const data = wingData.get(classKey);
      const radial = Math.min(1, lateralDistance / Math.max(0.001, data.span));
      const tipShare = smoothstep(0.30, 0.90, radial);
      const classShare = wingStrength * bandShare;
      candidates.push({ index: data.rootIndex, score: classShare * (1 - tipShare) });
      candidates.push({ index: data.tipIndex, score: classShare * tipShare });
      if (classShare > 0.55) wingVertexCounts[classKey]++;
    }
    for (const candidate of candidates) {
      if (candidate.index < originalJoints.length) candidate.score *= 1 - wingStrength;
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 4);
  if (!chosen.length || chosen.reduce((sum, item) => sum + item.score, 0) <= 1e-12) {
    const hipsIndex = originalIndexByName.get('Hips');
    chosen.push({ index: hipsIndex, score: 1 });
  }
  const total = chosen.reduce((sum, item) => sum + item.score, 0);
  let assigned = 0;
  for (let slot = 0; slot < 4; slot++) {
    const item = chosen[slot] ?? chosen[0];
    const weight = slot >= chosen.length ? 0 : slot === chosen.length - 1 ? Math.max(0, 1 - assigned) : item.score / total;
    jointValues[vertex * 4 + slot] = item.index;
    weightValues[vertex * 4 + slot] = weight;
    assigned += weight;
    if (weight > 1e-6) influenceCounts[item.index]++;
  }
  const weightSum = weightValues[vertex * 4] + weightValues[vertex * 4 + 1] + weightValues[vertex * 4 + 2] + weightValues[vertex * 4 + 3];
  maxWeightSumError = Math.max(maxWeightSumError, Math.abs(weightSum - 1));
  if (weightValues[vertex * 4 + 1] > 1e-5 || weightValues[vertex * 4 + 2] > 1e-5) verticesWithDistributedWeights++;
}
const buffer = root.listBuffers()[0];
primitive.setAttribute('JOINTS_0', doc.createAccessor('Aevra_Joints0').setArray(jointValues).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('Aevra_Weights0').setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(buffer));

const materials = root.listMaterials();
if (materials.length !== 1 || !materials[0].getBaseColorTexture() || !materials[0].getMetallicRoughnessTexture() || !materials[0].getNormalTexture()) {
  throw new Error('Aevra must retain embedded base-color, packed PBR, and normal maps.');
}
const sourceTextureMetrics = [];
const runtimeTextureMetrics = [];
for (const texture of root.listTextures()) {
  const sourceImage = texture.getImage();
  const sourceMeta = await sharp(sourceImage).metadata();
  sourceTextureMetrics.push({ name: texture.getName(), width: sourceMeta.width, height: sourceMeta.height, mime: texture.getMimeType(), bytes: sourceImage.length, sha256: createHash('sha256').update(sourceImage).digest('hex') });
  if (sourceMeta.width > 2048 || sourceMeta.height > 2048) {
    const isPackedData = texture === materials[0].getMetallicRoughnessTexture() || texture === materials[0].getNormalTexture();
    const encoded = await sharp(sourceImage)
      .resize(2048, 2048, { fit: 'fill', kernel: isPackedData ? 'linear' : 'lanczos3' })
      .toFormat(sourceMeta.format === 'jpeg' ? 'jpeg' : 'png', sourceMeta.format === 'jpeg' ? { quality: 92, chromaSubsampling: '4:4:4' } : {})
      .toBuffer();
    texture.setImage(encoded);
  }
  const runtimeMeta = await sharp(texture.getImage()).metadata();
  if (runtimeMeta.width !== 2048 || runtimeMeta.height !== 2048) throw new Error(`Expected a 2K runtime texture, got ${runtimeMeta.width}x${runtimeMeta.height} for ${texture.getName()}.`);
  runtimeTextureMetrics.push({ name: texture.getName(), width: runtimeMeta.width, height: runtimeMeta.height, mime: texture.getMimeType(), bytes: texture.getImage().length, sha256: createHash('sha256').update(texture.getImage()).digest('hex') });
}
const packed = materials[0].getMetallicRoughnessTexture();
const packedRaw = await sharp(packed.getImage()).removeAlpha().resize(128, 128).raw().toBuffer({ resolveWithObject: true });
const channelRanges = { roughness: [Infinity, -Infinity], metallic: [Infinity, -Infinity] };
for (let i = 0; i < packedRaw.data.length; i += packedRaw.info.channels) {
  const roughness = packedRaw.data[i + 1] / 255;
  const metallic = packedRaw.data[i + 2] / 255;
  channelRanges.roughness[0] = Math.min(channelRanges.roughness[0], roughness);
  channelRanges.roughness[1] = Math.max(channelRanges.roughness[1], roughness);
  channelRanges.metallic[0] = Math.min(channelRanges.metallic[0], metallic);
  channelRanges.metallic[1] = Math.max(channelRanges.metallic[1], metallic);
}
if (channelRanges.metallic[1] - channelRanges.metallic[0] < 0.05 || channelRanges.roughness[1] - channelRanges.roughness[0] < 0.05) {
  throw new Error(`Packed PBR channels are effectively flat: ${JSON.stringify(channelRanges)}.`);
}

const quatDelta = (axis, radians) => new Quaternion().setFromAxisAngle(axis === 'x' ? new Vector3(1, 0, 0) : axis === 'y' ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1), radians);
const restQuat = (node) => new Quaternion().fromArray(node.getRotation());
const rotationValues = (node, axis, angles) => angles.map((angle) => restQuat(node).multiply(quatDelta(axis, angle)).toArray());
const animationClips = [];
function addClip(name, duration, tracks) {
  const animation = doc.createAnimation(name);
  for (const track of tracks) {
    const times = Float32Array.from(track.times);
    const values = Float32Array.from(track.values.flat());
    const input = doc.createAccessor(`${name}_${track.nodeName}_${track.path ?? 'rotation'}_time`).setArray(times).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const output = doc.createAccessor(`${name}_${track.nodeName}_${track.path ?? 'rotation'}_value`).setArray(values).setType(track.path === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4).setBuffer(buffer);
    const sampler = doc.createAnimationSampler(`${name}_${track.nodeName}_${track.path ?? 'rotation'}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${track.nodeName}_${track.path ?? 'rotation'}`).setTargetNode(track.node).setTargetPath(track.path ?? 'rotation').setSampler(sampler));
  }
  animationClips.push({ name, seconds: duration, channels: tracks.length });
}
const body = (sourceName) => sourceNodeByName.get(sourceName);
const standard = (sourceName) => standardNames[sourceName] ?? sourceName;
const sampleTimes = [0, 0.25, 0.5, 0.75, 1];
const wingRotationTrack = (classKey, axis, amplitude, times = sampleTimes, phase = 0, restAngle = 0) => {
  const data = wingData.get(classKey);
  const rootNode = jointNodes.get(data.rootName);
  const tipNode = jointNodes.get(data.tipName);
  const angles = times.map((_, index) => restAngle + Math.sin((sampleTimes[index] + phase) * Math.PI * 2) * amplitude);
  return [
    { nodeName: data.rootName, node: rootNode, times, values: rotationValues(rootNode, axis, angles) },
    { nodeName: data.tipName, node: tipNode, times, values: rotationValues(tipNode, axis, angles.map((value) => -value * 0.42)) },
  ];
};
const cycle = (sourceName, axis, amount, phase = 0, times = sampleTimes) => {
  const node = body(sourceName);
  return { nodeName: standard(sourceName), node, times, values: rotationValues(node, axis, sampleTimes.map((t) => Math.sin((t + phase) * Math.PI * 2) * amount)) };
};
const pose = (sourceName, axis, times, angles) => {
  const node = body(sourceName);
  return { nodeName: standard(sourceName), node, times, values: rotationValues(node, axis, angles) };
};
const armTrack = (sourceName, times, zAngles, xAngles) => {
  const node = body(sourceName);
  const values = times.map((_, index) => restQuat(node)
    .multiply(quatDelta('z', zAngles[index]))
    .multiply(quatDelta('x', xAngles[index] ?? 0))
    .toArray());
  return { nodeName: standard(sourceName), node, times, values };
};
const armTracks = (times, options = {}) => {
  const constant = (value) => times.map(() => value);
  const values = (key, fallback) => Array.isArray(options[key]) ? options[key] : constant(options[key] ?? fallback);
  const output = [];
  for (const side of ['Left', 'Right']) {
    const prefix = side === 'Left' ? 'left' : 'right';
    const sign = side === 'Left' ? 1 : -1;
    output.push(
      armTrack(`${side}_Shoulder`, times, values(`${prefix}ShoulderZ`, sign * (options.shoulder ?? 0.30)), values(`${prefix}ShoulderX`, 0)),
      armTrack(`${side}_UpperArm`, times, values(`${prefix}UpperZ`, sign * (options.upperArm ?? 0.72)), values(`${prefix}UpperX`, 0)),
      armTrack(`${side}_LowerArm`, times, values(`${prefix}LowerZ`, sign * (options.forearm ?? 0.14)), values(`${prefix}LowerX`, 0)),
    );
  }
  return output;
};
const allWingCycle = (amplitude, phase = 0, times = sampleTimes, restAngle = 0.16) => [
  ...wingRotationTrack('LUpper', 'z', amplitude, times, phase, restAngle),
  ...wingRotationTrack('RUpper', 'z', -amplitude, times, phase, -restAngle),
  ...wingRotationTrack('LLower', 'z', amplitude * 0.70, times, phase + 0.18, restAngle * 0.70),
  ...wingRotationTrack('RLower', 'z', -amplitude * 0.70, times, phase + 0.18, -restAngle * 0.70),
];

const idleTimes = [0, 0.6, 1.2, 1.8, 2.4];
addClip('Idle', 2.4, [
  pose('Chest', 'x', idleTimes, [0, -0.014, 0, 0.014, 0]),
  pose('Head', 'y', idleTimes, [0, -0.018, 0.015, 0, 0]),
  ...armTracks(idleTimes, {
    leftUpperX: [0, 0.025, 0, -0.025, 0],
    rightUpperX: [0, -0.025, 0, 0.025, 0],
  }),
  ...allWingCycle(0.22, 0.05, idleTimes),
]);
const walkTimes = sampleTimes.map((t) => t * 1.16);
const gaitSwing = (amount, phase) => sampleTimes.map((t) => Math.sin((t + phase) * Math.PI * 2) * amount);
addClip('Walk', 1.16, [
  { nodeName: 'mixamorigHips', node: body('Hips'), path: 'translation', times: walkTimes, values: walkTimes.map((_, i) => { const p = body('Hips').getTranslation(); return [p[0], p[1] + [0, 0.025, 0, -0.025, 0][i], p[2]]; }) },
  cycle('Left_UpperLeg', 'x', 0.20, 0, walkTimes), cycle('Right_UpperLeg', 'x', 0.20, 0.5, walkTimes),
  cycle('Left_LowerLeg', 'x', 0.11, 0.5, walkTimes), cycle('Right_LowerLeg', 'x', 0.11, 0, walkTimes),
  ...armTracks(walkTimes, {
    leftUpperX: gaitSwing(0.34, 0.5), rightUpperX: gaitSwing(0.34, 0),
    leftLowerX: gaitSwing(0.12, 0), rightLowerX: gaitSwing(0.12, 0.5),
  }),
  ...allWingCycle(0.22, 0, walkTimes),
]);
const runTimes = sampleTimes.map((t) => t * 0.74);
addClip('Run', 0.74, [
  { nodeName: 'mixamorigHips', node: body('Hips'), path: 'translation', times: runTimes, values: runTimes.map((_, i) => { const p = body('Hips').getTranslation(); return [p[0], p[1] + [0, 0.04, 0, -0.04, 0][i], p[2]]; }) },
  cycle('Left_UpperLeg', 'x', 0.38, 0, runTimes), cycle('Right_UpperLeg', 'x', 0.38, 0.5, runTimes),
  cycle('Left_LowerLeg', 'x', 0.22, 0.5, runTimes), cycle('Right_LowerLeg', 'x', 0.22, 0, runTimes),
  ...armTracks(runTimes, {
    leftUpperX: gaitSwing(0.50, 0.5), rightUpperX: gaitSwing(0.50, 0),
    leftLowerX: gaitSwing(0.20, 0), rightLowerX: gaitSwing(0.20, 0.5),
  }),
  ...allWingCycle(0.39, 0, runTimes),
]);
const attackTimes = [0, 0.18, 0.44, 0.72, 0.96];
addClip('Attack', 0.96, [
  pose('UpperChest', 'y', attackTimes, [0, -0.12, 0.16, 0.08, 0]),
  ...armTracks(attackTimes, {
    rightUpperZ: [-0.72, -0.34, -0.28, -0.58, -0.72],
    rightUpperX: [0, -0.30, -0.18, 0.12, 0],
    rightLowerZ: [-0.16, -0.28, -0.66, -0.27, -0.16],
    rightLowerX: [0, -0.12, 0.18, 0, 0],
    leftUpperZ: [0.72, 0.64, 0.62, 0.70, 0.72],
    leftUpperX: [0, 0.10, 0.07, 0, 0],
  }),
  ...allWingCycle(0.24, 0.08, attackTimes),
]);
const hitTimes = [0, 0.08, 0.22, 0.48];
addClip('Hit', 0.48, [
  pose('UpperChest', 'z', hitTimes, [0, -0.18, 0.08, 0]),
  pose('Head', 'z', hitTimes, [0, -0.12, 0.04, 0]),
  ...armTracks(hitTimes, {
    leftUpperZ: [0.72, 0.42, 0.55, 0.72], rightUpperZ: [-0.72, -0.40, -0.55, -0.72],
    leftUpperX: [0, 0.26, -0.08, 0], rightUpperX: [0, -0.26, 0.08, 0],
    leftLowerZ: [0.16, 0.34, 0.25, 0.16], rightLowerZ: [-0.16, -0.34, -0.25, -0.16],
  }),
  ...allWingCycle(0.30, 0.15, hitTimes),
]);
const deathTimes = [0, 0.22, 0.65, 1.05, 1.45];
addClip('Death', 1.45, [
  { nodeName: 'mixamorigHips', node: body('Hips'), path: 'translation', times: deathTimes, values: deathTimes.map((_, i) => { const p = body('Hips').getTranslation(); return [p[0], p[1] + [0, -0.02, -0.11, -0.16, -0.16][i], p[2]]; }) },
  pose('Hips', 'z', deathTimes, [0, 0.04, 0.22, 0.32, 0.32]),
  pose('Chest', 'x', deathTimes, [0, 0.10, 0.24, 0.30, 0.30]),
  pose('Head', 'z', deathTimes, [0, 0.12, 0.24, 0.32, 0.32]),
  ...armTracks(deathTimes, {
    leftUpperZ: [0.72, 0.66, 0.95, 1.08, 1.08], rightUpperZ: [-0.72, -0.66, -0.95, -1.08, -1.08],
    leftUpperX: [0, 0.08, 0.42, 0.50, 0.50], rightUpperX: [0, -0.08, -0.42, -0.50, -0.50],
    leftLowerZ: [0.16, 0.16, 0.31, 0.40, 0.40], rightLowerZ: [-0.16, -0.16, -0.31, -0.40, -0.40],
  }),
  ...allWingCycle(0.44, 0.12, deathTimes),
]);
const talkTimes = [0, 0.35, 0.72, 1.05, 1.42];
addClip('Talk', 1.42, [
  pose('Head', 'y', talkTimes, [0, -0.08, 0.06, -0.04, 0]),
  ...armTracks(talkTimes, {
    rightUpperZ: [-0.72, -0.42, -0.54, -0.64, -0.72],
    rightUpperX: [0, -0.12, -0.24, -0.08, 0],
    rightLowerZ: [-0.16, -0.48, -0.38, -0.28, -0.16],
    rightLowerX: [0, -0.10, 0.04, -0.06, 0],
    leftUpperX: [0, 0.08, 0.04, 0.08, 0],
  }),
  ...allWingCycle(0.09, 0.17, talkTimes),
]);

const outputBytes = await io.writeBinary(doc);
await writeFile(candidatePath, outputBytes);
const candidateSha256 = createHash('sha256').update(outputBytes).digest('hex');
const checkRoot = (await io.readBinary(outputBytes)).getRoot();
const checkMesh = checkRoot.listMeshes()[0];
const checkPrimitive = checkMesh.listPrimitives()[0];
const checkSkin = checkRoot.listSkins()[0];
const checkPositions = checkPrimitive.getAttribute('POSITION')?.getArray();
const checkNormals = checkPrimitive.getAttribute('NORMAL')?.getArray();
const checkUv = checkPrimitive.getAttribute('TEXCOORD_0')?.getArray();
const checkIndices = checkPrimitive.getIndices()?.getArray();
const checkJoints = checkPrimitive.getAttribute('JOINTS_0')?.getArray();
const checkWeights = checkPrimitive.getAttribute('WEIGHTS_0')?.getArray();
if (!checkPositions || !checkNormals || !checkUv || !checkIndices || !checkJoints || !checkWeights) throw new Error('Candidate lost geometry or skin attributes.');
const maxPositionDelta = Math.max(...Array.from(checkPositions, (value, i) => Math.abs(value - positions[i])));
const maxNormalDelta = Math.max(...Array.from(checkNormals, (value, i) => Math.abs(value - normals[i])));
const maxUvDelta = Math.max(...Array.from(checkUv, (value, i) => Math.abs(value - uv0[i])));
let indexMismatches = 0;
for (let i = 0; i < checkIndices.length; i++) if (checkIndices[i] !== indices[i]) indexMismatches++;
if (maxPositionDelta > 1e-7 || maxNormalDelta > 1e-7 || maxUvDelta > 1e-7 || indexMismatches !== 0) throw new Error(`Geometry preservation failed: position=${maxPositionDelta}, normal=${maxNormalDelta}, UV=${maxUvDelta}, index mismatches=${indexMismatches}.`);
const clipNames = checkRoot.listAnimations().map((animation) => animation.getName());
const requiredClips = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death', 'Talk'];
if (requiredClips.some((name) => !clipNames.includes(name))) throw new Error(`Candidate missing clips: ${requiredClips.filter((name) => !clipNames.includes(name)).join(', ')}.`);
const requiredArmNodes = ['mixamorigLeftShoulder', 'mixamorigLeftArm', 'mixamorigLeftForeArm', 'mixamorigRightShoulder', 'mixamorigRightArm', 'mixamorigRightForeArm'];
for (const animation of checkRoot.listAnimations()) {
  const targets = new Set(animation.listChannels().map((channel) => channel.getTargetNode()?.getName()));
  const missing = requiredArmNodes.filter((name) => !targets.has(name));
  if (missing.length) throw new Error(`${animation.getName()} does not preserve Aevra's relaxed-arm baseline: ${missing.join(', ')}.`);
}
const idle = checkRoot.listAnimations().find((animation) => animation.getName() === 'Idle');
for (const name of ['mixamorigLeftArm', 'mixamorigRightArm']) {
  const channel = idle.listChannels().find((item) => item.getTargetNode()?.getName() === name);
  const q = channel?.getSampler().getOutput().getArray();
  if (!q || Math.abs(2 * Math.atan2(q[2], q[3])) < 0.45) throw new Error(`Idle leaves ${name} in the source T-pose.`);
}
const clipChannel = (name, target) => checkRoot.listAnimations().find((animation) => animation.getName() === name)
  ?.listChannels().find((channel) => channel.getTargetNode()?.getName() === target);
const rotationTravel = (channel) => {
  const values = channel?.getSampler().getOutput().getArray();
  if (!values || values.length < 8) return 0;
  const first = values.slice(0, 4);
  let minimumDot = 1;
  for (let offset = 4; offset < values.length; offset += 4) {
    const other = values.slice(offset, offset + 4);
    minimumDot = Math.min(minimumDot, Math.abs(first.reduce((sum, value, i) => sum + value * other[i], 0)));
  }
  return 2 * Math.acos(Math.min(1, minimumDot));
};
for (const [clip, target, minimum] of [
  ['Idle', 'AevraWingLUpperRoot', 0.12],
  ['Walk', 'mixamorigLeftArm', 0.20],
  ['Run', 'mixamorigRightArm', 0.30],
  ['Talk', 'mixamorigRightArm', 0.20],
]) if (rotationTravel(clipChannel(clip, target)) < minimum) throw new Error(`${clip} has no readable ${target} motion.`);
for (const [clip, minimumRange] of [['Walk', 0.04], ['Run', 0.07]]) {
  const channel = clipChannel(clip, 'mixamorigHips');
  const yValues = [];
  if (channel) {
    const values = channel.getSampler().getOutput().getArray();
    for (let index = 1; index < values.length; index += 3) yValues.push(values[index]);
  }
  if (yValues.length < 2 || Math.max(...yValues) - Math.min(...yValues) < minimumRange) throw new Error(`${clip} has no readable gait bounce.`);
}
if (checkSkin.listJoints().length !== originalJoints.length + wingBones.length || wingBones.length !== 8) throw new Error('Candidate skin joint count does not include all wing roots and tips.');
if (checkJoints.length !== positions.length / 3 * 4 || checkWeights.length !== checkJoints.length) throw new Error('Candidate skin weight data has the wrong length.');
let checkDistributedVertices = 0;
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  let sum = 0, nonzero = 0;
  for (let slot = 0; slot < 4; slot++) {
    const joint = checkJoints[vertex * 4 + slot], weight = checkWeights[vertex * 4 + slot];
    if (!Number.isInteger(joint) || joint < 0 || joint >= checkSkin.listJoints().length || !Number.isFinite(weight) || weight < 0) throw new Error(`Invalid joint/weight on vertex ${vertex}.`);
    sum += weight;
    if (weight > 1e-6) nonzero++;
  }
  if (Math.abs(sum - 1) > 1e-5) throw new Error(`Vertex ${vertex} has unnormalized weights (${sum}).`);
  if (nonzero > 1) checkDistributedVertices++;
}
for (const animation of checkRoot.listAnimations()) for (const channel of animation.listChannels()) {
  if (!checkSkin.listJoints().includes(channel.getTargetNode())) throw new Error(`${animation.getName()} targets a node outside the Aevra skin.`);
}

const candidate = {
  schema: 'corealm-humanoid-native-rig-candidate/1',
  id: 'npc_slayer_aevra',
  displayName: 'Master Aevra',
  status: 'awaiting-root-lab-review',
  accepted: false,
  source: {
    file: sourcePath,
    sha256: sourceSha256,
    bytes: sourceBytes.length,
    starredModelId: '98ca3c8c-f4de-43dc-9ba3-427d8a5bbfa0',
    starredProjectId: '4f8d5f1b-5840-40ca-ab7c-0336d059f779',
    starredDisplayName: 'fairy slayer master',
    prompt: 'fairy character with tattered brown leather outfit, wings, green skin, yellow eyes, fantasy creature',
    geometry: { vertices: positions.length / 3, triangles: indices.length / 3, bounds, positionsPreserved: true, indicesPreserved: true, normalsPreserved: true, uvPreserved: true, retopology: false },
    sourceRig: { joints: originalJoints.length, weightedVerticesByJoint: Object.fromEntries([...sourceWeightedVertices].map(([index, count]) => [originalNames[index], count])), hipsBindPosition: sourceHipsBindPosition, sourceAnimations: [] },
    textures: sourceTextureMetrics,
    pbr: { modelPreset: 'P1', sourceTextures: ['base-color', 'metallic-roughness', 'normal'], textureResolution: '2K' },
  },
  candidate: {
    file: candidatePath,
    sha256: candidateSha256,
    bytes: outputBytes.length,
    productionTarget: 'game/public/assets/models/character/npc_slayer_aevra.glb',
    geometry: { vertices: positions.length / 3, triangles: indices.length / 3, positionsPreserved: maxPositionDelta === 0, normalsPreserved: maxNormalDelta === 0, uvPreserved: maxUvDelta === 0, indicesPreserved: indexMismatches === 0 },
    rig: { type: 'Mixamo-named humanoid plus eight articulated wing joints', joints: checkSkin.listJoints().map((node) => node.getName()), wingInfluencedVertices: wingVertexCounts, verticesWithDistributedWeights: checkDistributedVertices, maximumWeightSumError: maxWeightSumError, method: 'Unity-compatible rest transforms fitted to the source mesh proportions; source root-only weights replaced by centerline-gated four-influence limb weights and silhouette-gated upper/lower wing chains. Relaxed arm pose and readable wing/gait keys are embedded in every action clip. No retopology.' },
    textures: runtimeTextureMetrics,
    pbr: { baseColor: true, metallicRoughness: true, normal: true, channelRanges, materialFactors: { metallic: materials[0].getMetallicFactor(), roughness: materials[0].getRoughnessFactor() } },
    animations: animationClips,
  },
  acceptance: { sourceDesignAudit: 'pending-root-review', geometry: true, rig: false, motion: false, textures: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${ownerDir}/catalog.json`, `${JSON.stringify(candidate, null, 2)}\n`);
const labAsset = {
  id: 'npc_slayer_aevra',
  file: 'models/character/npc_slayer_aevra.glb',
  pack: 'corealm-starred-slayer-npcs',
  category: 'character',
  is: 'Master Aevra',
  tags: ['npc', 'humanoid', 'fairy', 'slayer-master', 'gloamgarden', 'starred', 'tripo', 'candidate'],
  bytes: outputBytes.length,
  sha256: candidateSha256,
  size: { x: bounds.max[0] - bounds.min[0], y: bounds.max[1] - bounds.min[1], z: bounds.max[2] - bounds.min[2] },
  base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] },
  bounds,
  groundY: bounds.min[1],
  triangles: indices.length / 3,
  animations: clipNames,
  materials: checkRoot.listMaterials().map((material) => material.getName()),
  sourceProvenance: {
    author: 'Corealm candidate rig repair',
    sourceModelId: '98ca3c8c-f4de-43dc-9ba3-427d8a5bbfa0',
    sourceProjectId: '4f8d5f1b-5840-40ca-ab7c-0336d059f779',
    sourceFile: sourcePath,
    sourceSha256,
    candidateFile: candidatePath,
    candidateSha256,
    rigMethod: 'Mixamo-named body joints refitted to the source mesh proportions, with anatomy-gated arm weights and four upper/lower wing chains on the unchanged source topology. Every clip preserves a relaxed arm baseline.',
    textures: runtimeTextureMetrics,
    candidateStatus: 'awaiting-root-lab-review',
  },
  acceptance: { assetAudit: false, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${ownerDir}/lab-catalog.json`, `${JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', assets: [labAsset], files: { npc_slayer_aevra: 'aevra-wings-native-rig.glb' } }, null, 2)}\n`);
console.log(JSON.stringify({ candidatePath, bytes: outputBytes.length, sha256: candidateSha256, vertices: positions.length / 3, triangles: indices.length / 3, sourceJoints: originalJoints.length, candidateJoints: checkSkin.listJoints().length, wingVertexCounts, verticesWithDistributedWeights: checkDistributedVertices, maxPositionDelta, maxNormalDelta, maxUvDelta, indexMismatches, clips: animationClips, runtimeTextureMetrics, channelRanges }, null, 2));
