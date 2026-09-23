import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { Matrix4, Vector3 } from 'three';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../../../');
const sourcePath = path.join(repo, 'assets/art/tripo/exports/corealm_strata_delver_707c39cd_8k_rigged.glb');
const referencePath = path.join(repo, 'assets/art/tripo/references/stone-strata-delver.png');
const candidatePath = path.join(here, 'strata-delver-native-rig-candidate.glb');
const sourceShaExpected = '881924b696f4ecf293da332b8d5e2e50052f4ceaa3fbc06383422c14a990abaf';
const referenceShaExpected = 'd6715e81c93b35e4ecdfb38041b4c521a48412654cebb356e1028664d12b639d';
const modelId = '707c39cd-4a8e-40c4-8ecf-ca03814e8a06';
const sourceImageId = '3432b9ea-8266-46e8-882f-47e840ea1750';
const candidateId = 'creature_strata_delver_ninepack2';
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const writeJson = async (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

const sourceBytes = await readFile(sourcePath);
const sourceSha = sha(sourceBytes);
if (sourceSha !== sourceShaExpected) throw new Error(`Approved source export SHA changed: ${sourceSha}`);
const referenceSha = sha(await readFile(referencePath));
if (referenceSha !== referenceShaExpected) throw new Error(`Approved source image SHA changed: ${referenceSha}`);

const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const originalArmature = scene?.listChildren().find((node) => node.getName() === 'Armature');
const meshNode = originalArmature?.listChildren().find((node) => node.getMesh());
const mesh = meshNode?.getMesh();
const primitive = mesh?.listPrimitives()[0];
const sourceSkin = root.listSkins()[0];
if (!scene || !originalArmature || !meshNode || !primitive || !sourceSkin) throw new Error('Expected the approved Tripo armature, mesh and single skin.');
if (root.listSkins().length !== 1 || sourceSkin.listJoints().length !== 10 || root.listAnimations().length !== 0) {
  throw new Error(`Unexpected source rig: skins=${root.listSkins().length}, joints=${sourceSkin.listJoints().length}, clips=${root.listAnimations().length}`);
}

const sourceGeometryHashes = {};
for (const semantic of ['POSITION', 'NORMAL', 'TEXCOORD_0']) {
  const accessor = primitive.getAttribute(semantic);
  if (!accessor) throw new Error(`Source mesh is missing ${semantic}.`);
  sourceGeometryHashes[semantic] = sha(Buffer.from(accessor.getArray().buffer, accessor.getArray().byteOffset, accessor.getArray().byteLength));
}
sourceGeometryHashes.INDICES = sha(Buffer.from(primitive.getIndices().getArray().buffer, primitive.getIndices().getArray().byteOffset, primitive.getIndices().getArray().byteLength));
const sourceJointValues = primitive.getAttribute('JOINTS_0')?.getArray();
const sourceWeightValues = primitive.getAttribute('WEIGHTS_0')?.getArray();
if (!sourceJointValues || !sourceWeightValues) throw new Error('The audited source skin has no JOINTS_0 / WEIGHTS_0 attributes.');
let sourceBone0Vertices = 0, sourceBone0DominantVertices = 0, sourceBone0ExclusiveVertices = 0;
let sourceBone0MinimumWeight = Infinity, sourceBone0MaximumWeight = -Infinity, sourceBone0WeightSum = 0, sourceOtherMaximumWeight = 0;
for (let vertex = 0; vertex < sourceWeightValues.length / 4; vertex++) {
  let bone0Weight = 0, otherWeight = 0;
  for (let slot = 0; slot < 4; slot++) {
    const at = vertex * 4 + slot, value = sourceWeightValues[at];
    if (sourceJointValues[at] === 0) bone0Weight += value;
    else otherWeight += value;
  }
  if (bone0Weight > 0) sourceBone0Vertices++;
  if (bone0Weight >= otherWeight) sourceBone0DominantVertices++;
  if (otherWeight < 1e-7) sourceBone0ExclusiveVertices++;
  sourceBone0MinimumWeight = Math.min(sourceBone0MinimumWeight, bone0Weight);
  sourceBone0MaximumWeight = Math.max(sourceBone0MaximumWeight, bone0Weight);
  sourceBone0WeightSum += bone0Weight;
  sourceOtherMaximumWeight = Math.max(sourceOtherMaximumWeight, otherWeight);
}
const sourceSkinningAudit = {
  auditReported: '100% weights on bone_0',
  verticesWithBone0: sourceBone0Vertices,
  verticesDominatedByBone0: sourceBone0DominantVertices,
  verticesExclusivelyOnBone0: sourceBone0ExclusiveVertices,
  minBone0Weight: sourceBone0MinimumWeight,
  meanBone0Weight: sourceBone0WeightSum / (sourceWeightValues.length / 4),
  maxBone0Weight: sourceBone0MaximumWeight,
  maximumOtherInfluence: sourceOtherMaximumWeight,
};
const positionAccessor = primitive.getAttribute('POSITION');
const positions = Float32Array.from(positionAccessor.getArray());
const positionArray = Array.from({ length: positions.length / 3 }, (_, index) => [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]]);
const indices = Uint32Array.from(primitive.getIndices().getArray());
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (const p of positionArray) for (let axis = 0; axis < 3; axis++) {
  bounds.min[axis] = Math.min(bounds.min[axis], p[axis]);
  bounds.max[axis] = Math.max(bounds.max[axis], p[axis]);
}

const material = root.listMaterials().find((candidate) => candidate.getBaseColorTexture());
const baseColorTexture = material?.getBaseColorTexture();
if (!material || !baseColorTexture?.getImage()) throw new Error('Expected the approved source base-color atlas.');
const sourceBaseColorBytes = Buffer.from(baseColorTexture.getImage());
const sourceBaseColorMetadata = await sharp(sourceBaseColorBytes).metadata();
if (sourceBaseColorMetadata.width !== 8192 || sourceBaseColorMetadata.height !== 8192) {
  throw new Error(`Expected an 8192x8192 source base color, received ${sourceBaseColorMetadata.width}x${sourceBaseColorMetadata.height}.`);
}
const textureNames = {
  baseColor: 'strata-delver-basecolor-2k.jpg',
  normal: 'strata-delver-normal-2k.png',
  orm: 'strata-delver-orm-2k.png',
};
const baseColor2k = await sharp(sourceBaseColorBytes)
  .resize(2048, 2048, { fit: 'fill', kernel: 'lanczos3' })
  .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
  .toBuffer();
const colorOutputPath = path.join(here, textureNames.baseColor);
await writeFile(colorOutputPath, baseColor2k);

// The approved Tripo export contains only albedo. Build coherent stone PBR maps from
// its layered sediment contrast, retaining the source atlas layout and UV orientation.
const colorRawResult = await sharp(baseColor2k).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { data: colorRaw, info: colorRawInfo } = colorRawResult;
const width = colorRawInfo.width, height = colorRawInfo.height;
const pixelCount = width * height;
const luminance = new Uint8Array(pixelCount);
for (let i = 0; i < pixelCount; i++) {
  const at = i * colorRawInfo.channels;
  luminance[i] = Math.round(colorRaw[at] * 0.2126 + colorRaw[at + 1] * 0.7152 + colorRaw[at + 2] * 0.0722);
}
const [blurFine, blurMid, blurWide] = await Promise.all([
  sharp(baseColor2k).greyscale().blur(1.2).raw().toBuffer(),
  sharp(baseColor2k).greyscale().blur(5).raw().toBuffer(),
  sharp(baseColor2k).greyscale().blur(18).raw().toBuffer(),
]);
const heightField = new Float32Array(pixelCount);
for (let i = 0; i < pixelCount; i++) {
  heightField[i] = 0.62 * (luminance[i] - blurFine[i])
    + 0.28 * (blurFine[i] - blurMid[i])
    + 0.10 * (blurMid[i] - blurWide[i]);
}
const normalRaw = Buffer.alloc(pixelCount * 3);
const ormRaw = Buffer.alloc(pixelCount * 3);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const i = y * width + x;
  const left = y * width + Math.max(0, x - 1), right = y * width + Math.min(width - 1, x + 1);
  const up = Math.max(0, y - 1) * width + x, down = Math.min(height - 1, y + 1) * width + x;
  const dx = (heightField[right] - heightField[left]) / 255;
  const dy = (heightField[down] - heightField[up]) / 255;
  let nx = -dx * 4.8, ny = dy * 4.8, nz = 1;
  const normalLength = Math.hypot(nx, ny, nz);
  nx /= normalLength; ny /= normalLength; nz /= normalLength;
  const at = i * 3;
  normalRaw[at] = Math.round((nx * 0.5 + 0.5) * 255);
  normalRaw[at + 1] = Math.round((ny * 0.5 + 0.5) * 255);
  normalRaw[at + 2] = Math.round((nz * 0.5 + 0.5) * 255);

  const localContrast = Math.abs(luminance[i] - blurMid[i]) + 0.45 * Math.abs(blurMid[i] - blurWide[i]);
  const value = luminance[i] / 255;
  const ao = clamp(0.83 + 0.17 * value - 0.075 * clamp(localContrast / 80, 0, 1), 0.72, 1);
  const roughness = clamp(0.82 + 0.10 * (1 - value) + 0.07 * clamp(localContrast / 95, 0, 1), 0.80, 0.99);
  ormRaw[at] = Math.round(ao * 255);         // R: occlusion
  ormRaw[at + 1] = Math.round(roughness * 255); // G: roughness
  ormRaw[at + 2] = 0;                       // B: metallic (non-metallic stone)
}
const normalBytes = await sharp(normalRaw, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
const ormBytes = await sharp(ormRaw, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
await writeFile(path.join(here, textureNames.normal), normalBytes);
await writeFile(path.join(here, textureNames.orm), ormBytes);

// Replace the collapsed Tripo skin with a compact 10-joint, six-legged stone-beast rig.
// The six large disconnected limb islands stay intact and receive their own pivots;
// the approved mesh, normals, indices and UVs remain byte-for-byte unchanged.
const componentsParent = Uint32Array.from(positionArray, (_, index) => index);
const find = (input) => {
  let value = input;
  while (componentsParent[value] !== value) {
    componentsParent[value] = componentsParent[componentsParent[value]];
    value = componentsParent[value];
  }
  return value;
};
const union = (left, right) => {
  const a = find(left), b = find(right);
  if (a !== b) componentsParent[b] = a;
};
for (let i = 0; i < indices.length; i += 3) {
  union(indices[i], indices[i + 1]);
  union(indices[i], indices[i + 2]);
}
const componentByRoot = new Map();
for (let vertex = 0; vertex < positionArray.length; vertex++) {
  const componentId = find(vertex);
  if (!componentByRoot.has(componentId)) componentByRoot.set(componentId, { id: componentId, vertices: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], sum: [0, 0, 0] });
  const component = componentByRoot.get(componentId);
  component.vertices.push(vertex);
  for (let axis = 0; axis < 3; axis++) {
    const value = positionArray[vertex][axis];
    component.min[axis] = Math.min(component.min[axis], value);
    component.max[axis] = Math.max(component.max[axis], value);
    component.sum[axis] += value;
  }
}
const components = [...componentByRoot.values()];
for (const component of components) component.center = component.sum.map((value) => value / component.vertices.length);

const jointDefs = [
  { name: 'DelverRoot', parent: null, world: [0, 0, 0] },
  { name: 'Body', parent: 'DelverRoot', world: [0, 0.28, 0] },
  { name: 'Head', parent: 'Body', world: [0, 0.33, -0.405] },
  { name: 'Tail', parent: 'Body', world: [0, 0.28, 0.455] },
  { name: 'FrontLeg_L', parent: 'Body', world: [-0.198, 0.215, -0.285] },
  { name: 'FrontLeg_R', parent: 'Body', world: [0.198, 0.215, -0.285] },
  { name: 'MiddleLeg_L', parent: 'Body', world: [-0.198, 0.215, -0.030] },
  { name: 'MiddleLeg_R', parent: 'Body', world: [0.198, 0.215, -0.030] },
  { name: 'RearLeg_L', parent: 'Body', world: [-0.198, 0.215, 0.310] },
  { name: 'RearLeg_R', parent: 'Body', world: [0.198, 0.215, 0.310] },
];
const jointIndex = new Map(jointDefs.map((definition, index) => [definition.name, index]));
const legDefinitions = [
  { name: 'FrontLeg_L', side: -1, z: -0.285 }, { name: 'FrontLeg_R', side: 1, z: -0.285 },
  { name: 'MiddleLeg_L', side: -1, z: -0.030 }, { name: 'MiddleLeg_R', side: 1, z: -0.030 },
  { name: 'RearLeg_L', side: -1, z: 0.310 }, { name: 'RearLeg_R', side: 1, z: 0.310 },
];
const isMainLegIsland = (component) => component.vertices.length > 175
  && component.min[1] < 0.005 && component.max[1] < 0.34
  && Math.abs(component.center[0]) > 0.14
  && component.max[0] - component.min[0] < 0.30
  && component.max[2] - component.min[2] < 0.30;
const mainLegIslands = components.filter(isMainLegIsland);
if (mainLegIslands.length !== 6) throw new Error(`Expected six disconnected leg assemblies, found ${mainLegIslands.length}.`);
const componentLeg = new Map();
for (const component of mainLegIslands) {
  const def = [...legDefinitions].sort((a, b) => {
    const da = Math.hypot(component.center[0] - a.side * 0.198, component.center[2] - a.z);
    const db = Math.hypot(component.center[0] - b.side * 0.198, component.center[2] - b.z);
    return da - db;
  })[0];
  componentLeg.set(component.id, def.name);
}
for (const component of components) {
  if (componentLeg.has(component.id) || component.vertices.length > 45 || component.max[1] > 0.02 || Math.abs(component.center[0]) < 0.17) continue;
  const closest = [...legDefinitions].sort((a, b) => {
    const da = Math.hypot(component.center[0] - a.side * 0.198, component.center[2] - a.z);
    const db = Math.hypot(component.center[0] - b.side * 0.198, component.center[2] - b.z);
    return da - db;
  })[0];
  const distance = Math.hypot(component.center[0] - closest.side * 0.198, component.center[2] - closest.z);
  if (distance < 0.15) componentLeg.set(component.id, closest.name);
}

const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const joints = new Uint16Array(positionArray.length * 4);
const weights = new Float32Array(positionArray.length * 4);
const coverage = new Uint32Array(jointDefs.length);
const influenceCounts = [0, 0, 0, 0, 0];
for (const component of components) for (const vertex of component.vertices) {
  const [x, y, z] = positionArray[vertex];
  const legName = componentLeg.get(component.id);
  let candidates;
  if (legName) {
    const footBlend = component.vertices.length < 45 ? 1 : 0.82 + 0.18 * (1 - smoothstep(0.11, 0.29, y));
    candidates = [{ name: legName, weight: footBlend }, { name: 'Body', weight: 1 - footBlend }];
  } else {
    const frontWeight = 0.34 * smoothstep(0.02, 0.47, -z);
    const rearWeight = 0.34 * smoothstep(0.02, 0.47, z);
    const smallFrontDetail = component.vertices.length < 150 && component.center[2] < -0.32 ? 0.12 : 0;
    const smallRearDetail = component.vertices.length < 150 && component.center[2] > 0.34 ? 0.12 : 0;
    const headWeight = Math.max(frontWeight, smallFrontDetail);
    const tailWeight = Math.max(rearWeight, smallRearDetail);
    const rootWeight = 0.08;
    candidates = [
      { name: 'DelverRoot', weight: rootWeight },
      { name: 'Body', weight: 1 - rootWeight - headWeight - tailWeight },
      { name: 'Head', weight: headWeight },
      { name: 'Tail', weight: tailWeight },
    ];
  }
  candidates = candidates.filter((candidate) => candidate.weight > 1e-6);
  const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  influenceCounts[candidates.length]++;
  let assigned = 0;
  for (let slot = 0; slot < candidates.length; slot++) {
    const candidate = candidates[slot], at = vertex * 4 + slot;
    const value = slot === candidates.length - 1 ? 1 - assigned : candidate.weight / total;
    const index = jointIndex.get(candidate.name);
    joints[at] = index;
    weights[at] = value;
    assigned += value;
    if (value > 1e-5) coverage[index]++;
  }
}
const influenceCountHistogram = Object.fromEntries(influenceCounts.map((count, index) => [String(index + 1), count]).filter(([, count]) => count > 0));

// Re-parent the original mesh under the replacement skeleton without changing vertices.
const oldSkins = [...root.listSkins()];
const oldNodes = [...root.listNodes()];
originalArmature.removeChild(meshNode);
scene.removeChild(originalArmature);
meshNode.setSkin(null).setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]).setName('Strata_Delver_Mesh');
for (const oldSkin of oldSkins) oldSkin.dispose();
for (const oldNode of oldNodes) {
  if (oldNode === meshNode) continue;
  const parent = oldNode.getParentNode();
  if (parent) parent.removeChild(oldNode);
}
for (const oldNode of oldNodes) if (oldNode !== meshNode) oldNode.dispose();
if (root.listNodes().length !== 1 || root.listNodes()[0] !== meshNode) throw new Error('Failed to remove the unusable source armature cleanly.');
const rigContainer = doc.createNode('Strata_Delver_Rig');
scene.addChild(rigContainer);
rigContainer.addChild(meshNode);
const nodeByName = new Map();
const worldByName = new Map();
for (const definition of jointDefs) {
  const node = doc.createNode(definition.name);
  const parentWorld = definition.parent ? worldByName.get(definition.parent) : new Matrix4();
  const localPosition = new Vector3(...definition.world).applyMatrix4(parentWorld.clone().invert());
  node.setTranslation(localPosition.toArray()).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  const parent = definition.parent ? nodeByName.get(definition.parent) : rigContainer;
  parent.addChild(node);
  nodeByName.set(definition.name, node);
  worldByName.set(definition.name, new Matrix4().makeTranslation(...definition.world));
}
const skin = doc.createSkin('Strata Delver repaired six-leg skin').setSkeleton(nodeByName.get('DelverRoot'));
for (const definition of jointDefs) skin.addJoint(nodeByName.get(definition.name));
meshNode.setSkin(skin);
const inverseBind = new Float32Array(jointDefs.length * 16);
jointDefs.forEach((definition, index) => worldByName.get(definition.name).clone().invert().toArray(inverseBind, index * 16));
const buffer = root.listBuffers()[0] ?? doc.createBuffer('Strata Delver rig, clips and runtime maps');
skin.setInverseBindMatrices(doc.createAccessor('Strata_Delver_inverse_bind').setType(Accessor.Type.MAT4).setArray(inverseBind).setBuffer(buffer));
primitive.setAttribute('JOINTS_0', doc.createAccessor('Strata_Delver_joints').setType(Accessor.Type.VEC4).setArray(joints).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('Strata_Delver_weights').setType(Accessor.Type.VEC4).setArray(weights).setBuffer(buffer));

const normalTexture = doc.createTexture('Strata Delver 2K image-derived stone normal').setImage(normalBytes).setMimeType('image/png');
const ormTexture = doc.createTexture('Strata Delver 2K occlusion-roughness-metallic').setImage(ormBytes).setMimeType('image/png');
baseColorTexture.setName('Strata Delver layered source base color 2K').setImage(baseColor2k).setMimeType('image/jpeg');
material.setMetallicFactor(0).setRoughnessFactor(1)
  .setNormalTexture(normalTexture).setNormalScale(0.8)
  .setMetallicRoughnessTexture(ormTexture)
  .setOcclusionTexture(ormTexture).setOcclusionStrength(0.35);

const identity = [0, 0, 0, 1];
const qx = (angle) => [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
const qy = (angle) => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
const cycle = [0, 0.25, 0.5, 0.75, 1];
const animationStats = [];
function addTrack(animation, jointName, pathName, times, values, type = Accessor.Type.VEC4) {
  const input = doc.createAccessor(`Strata_Delver_${animation.getName()}_${jointName}_${pathName}_times`)
    .setType(Accessor.Type.SCALAR).setArray(new Float32Array(times)).setBuffer(buffer);
  const output = doc.createAccessor(`Strata_Delver_${animation.getName()}_${jointName}_${pathName}_values`)
    .setType(type).setArray(new Float32Array(values.flat())).setBuffer(buffer);
  const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
  animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(nodeByName.get(jointName)).setTargetPath(pathName).setSampler(sampler));
}
function addClip(name, times, tracks) {
  const animation = doc.createAnimation(name);
  for (const track of tracks) addTrack(animation, track.node, track.path ?? 'rotation', times, track.values, track.type ?? Accessor.Type.VEC4);
  animationStats.push({ name, seconds: times[times.length - 1], channels: tracks.length });
}
const bodyBase = jointDefs.find((definition) => definition.name === 'Body').world;
const headBase = jointDefs.find((definition) => definition.name === 'Head').world;
const headLocal = headBase.map((value, axis) => value - bodyBase[axis]);
const phases = { FrontLeg_L: 0, MiddleLeg_R: 0, RearLeg_L: 0, FrontLeg_R: Math.PI, MiddleLeg_L: Math.PI, RearLeg_R: Math.PI };
const legNames = Object.keys(phases);

addClip('Idle', cycle.map((time) => time * 3.2), [
  { node: 'Body', path: 'translation', type: Accessor.Type.VEC3, values: cycle.map((time) => [0, bodyBase[1] + 0.0025 * Math.sin(2 * Math.PI * time), 0]) },
  { node: 'Head', values: cycle.map((time) => qx(0.025 * Math.sin(2 * Math.PI * time))) },
  { node: 'Tail', values: cycle.map((time) => qy(0.025 * Math.sin(2 * Math.PI * time + 0.8))) },
  ...legNames.map((name) => ({ node: name, values: cycle.map((time) => qx(0.008 * Math.sin(2 * Math.PI * time + phases[name]))) })),
]);
for (const [name, seconds, swing, bob] of [['Walk', 1.52, 0.28, 0.008], ['Run', 0.88, 0.49, 0.015]]) {
  addClip(name, cycle.map((time) => time * seconds), [
    { node: 'Body', path: 'translation', type: Accessor.Type.VEC3, values: cycle.map((time) => [0, bodyBase[1] + bob * (0.5 - 0.5 * Math.cos(4 * Math.PI * time)), 0]) },
    { node: 'Body', values: cycle.map((time) => qx((name === 'Run' ? 0.035 : 0.018) * Math.sin(2 * Math.PI * time))) },
    { node: 'Head', values: cycle.map((time) => qx(0.035 * Math.sin(2 * Math.PI * time + Math.PI))) },
    { node: 'Tail', values: cycle.map((time) => qy(0.06 * Math.sin(2 * Math.PI * time + Math.PI / 2))) },
    ...legNames.map((leg) => ({ node: leg, values: cycle.map((time) => qx(swing * Math.sin(2 * Math.PI * time + phases[leg]))) })),
  ]);
}
addClip('Attack', [0, 0.16, 0.31, 0.49, 0.78], [
  { node: 'Head', path: 'translation', type: Accessor.Type.VEC3, values: [[...headLocal], [headLocal[0], headLocal[1] + 0.012, headLocal[2] - 0.018], [headLocal[0], headLocal[1] - 0.015, headLocal[2] - 0.075], [headLocal[0], headLocal[1] - 0.006, headLocal[2] - 0.025], [...headLocal]] },
  { node: 'Head', values: [identity, qx(-0.08), qx(-0.36), qx(-0.13), identity] },
  { node: 'Body', values: [identity, qx(0.06), qx(0.15), qx(0.04), identity] },
  { node: 'Tail', values: [identity, qy(-0.04), qy(0.10), qy(0.03), identity] },
  { node: 'FrontLeg_L', values: [identity, qx(-0.08), qx(0.13), qx(0.02), identity] },
  { node: 'FrontLeg_R', values: [identity, qx(-0.08), qx(0.13), qx(0.02), identity] },
]);
addClip('Hit', [0, 0.07, 0.2, 0.46], [
  { node: 'Body', values: [identity, qx(0.22), qx(-0.08), identity] },
  { node: 'Head', values: [identity, qx(0.18), qx(-0.08), identity] },
  { node: 'Tail', values: [identity, qy(-0.12), qy(0.04), identity] },
  { node: 'FrontLeg_L', values: [identity, qx(-0.12), qx(0.04), identity] },
  { node: 'FrontLeg_R', values: [identity, qx(-0.12), qx(0.04), identity] },
  { node: 'MiddleLeg_L', values: [identity, qx(-0.10), qx(0.03), identity] },
  { node: 'MiddleLeg_R', values: [identity, qx(-0.10), qx(0.03), identity] },
]);
addClip('Death', [0, 0.34, 0.76, 1.18, 1.72], [
  { node: 'Body', values: [identity, qx(-0.18), qx(-0.72), qx(-0.98), qx(-0.98)] },
  { node: 'Body', path: 'translation', type: Accessor.Type.VEC3, values: [[...bodyBase], [0, bodyBase[1] - 0.015, 0], [0, bodyBase[1] - 0.06, 0], [0, bodyBase[1] - 0.075, 0], [0, bodyBase[1] - 0.075, 0]] },
  { node: 'Head', values: [identity, qx(0.14), qx(0.32), qx(0.28), qx(0.28)] },
  { node: 'Tail', values: [identity, qy(0.12), qy(0.24), qy(0.32), qy(0.32)] },
  ...legNames.map((name, index) => ({ node: name, values: [identity, qx(index % 2 ? 0.12 : -0.12), qx(index % 2 ? 0.42 : -0.38), qx(index % 2 ? 0.52 : -0.44), qx(index % 2 ? 0.52 : -0.44)] })),
]);

const candidateBytes = await io.writeBinary(doc);
await writeFile(candidatePath, candidateBytes);
const candidateDoc = await io.readBinary(candidateBytes);
const candidateRoot = candidateDoc.getRoot();
const candidatePrimitive = candidateRoot.listMeshes()[0].listPrimitives()[0];
const candidateSkin = candidateRoot.listSkins()[0];
const candidatePositions = candidatePrimitive.getAttribute('POSITION');
for (const [semantic, accessor] of [['POSITION', candidatePositions], ['NORMAL', candidatePrimitive.getAttribute('NORMAL')], ['TEXCOORD_0', candidatePrimitive.getAttribute('TEXCOORD_0')], ['INDICES', candidatePrimitive.getIndices()]]) {
  const actual = sha(Buffer.from(accessor.getArray().buffer, accessor.getArray().byteOffset, accessor.getArray().byteLength));
  if (actual !== sourceGeometryHashes[semantic]) throw new Error(`${semantic} changed while building the candidate.`);
}
if (candidateSkin.listJoints().length !== 10 || candidateRoot.listAnimations().length !== 6) throw new Error('Candidate joint or clip count changed during export.');
if (candidateRoot.listNodes().some((node) => /^(Armature|bone_\d+|neutral_bone)$/.test(node.getName()))) throw new Error('Unusable Tripo source joints remain in the candidate.');
const candidateWeights = candidatePrimitive.getAttribute('WEIGHTS_0').getArray();
let weightMaxSumError = 0, minimumNonzeroWeight = Infinity, verticesWithMultipleInfluences = 0;
for (let vertex = 0; vertex < positionArray.length; vertex++) {
  const at = vertex * 4;
  const sum = candidateWeights[at] + candidateWeights[at + 1] + candidateWeights[at + 2] + candidateWeights[at + 3];
  weightMaxSumError = Math.max(weightMaxSumError, Math.abs(1 - sum));
  let active = 0;
  for (let slot = 0; slot < 4; slot++) if (candidateWeights[at + slot] > 1e-6) { active++; minimumNonzeroWeight = Math.min(minimumNonzeroWeight, candidateWeights[at + slot]); }
  if (active > 1) verticesWithMultipleInfluences++;
}
if (weightMaxSumError > 1e-5 || !Number.isFinite(minimumNonzeroWeight)) throw new Error(`Invalid candidate weights: max sum error ${weightMaxSumError}.`);
const textureReport = [];
for (const texture of candidateRoot.listTextures()) {
  const info = await sharp(Buffer.from(texture.getImage())).metadata();
  textureReport.push({ name: texture.getName(), dimensions: [info.width, info.height], mimeType: texture.getMimeType(), bytes: texture.getImage().byteLength, sha256: sha(Buffer.from(texture.getImage())) });
  if (info.width !== 2048 || info.height !== 2048) throw new Error(`Runtime texture ${texture.getName()} is not 2048x2048.`);
}
const candidateSha = sha(candidateBytes);
const textureSidecars = [
  { role: 'base-color', file: textureNames.baseColor, bytes: baseColor2k.length, sha256: sha(baseColor2k), sourceResolution: [8192, 8192], runtimeResolution: [2048, 2048], method: 'Approved image-generated Tripo atlas downsampled with Lanczos; colors, strata layers and atlas UV layout retained.' },
  { role: 'normal', file: textureNames.normal, bytes: normalBytes.length, sha256: sha(normalBytes), runtimeResolution: [2048, 2048], method: 'Tangent-space normal derived at three spatial scales from the layered source albedo; no atlas repaint or UV change.' },
  { role: 'occlusion-roughness-metallic', file: textureNames.orm, bytes: ormBytes.length, sha256: sha(ormBytes), runtimeResolution: [2048, 2048], channels: { R: 'occlusion', G: 'roughness', B: 'metallic (zero for stone)' }, method: 'Packed from source-atlas luminance and local sediment contrast; stone remains non-metallic and high-roughness.' },
];
const jointCoverage = jointDefs.map((definition, index) => ({ name: definition.name, vertices: coverage[index] }));
if (jointCoverage.some((joint) => joint.vertices === 0)) throw new Error(`Unweighted replacement joint: ${JSON.stringify(jointCoverage)}`);
const sourceAudit = {
  status: 'approved',
  batchId: 'beetle-golem',
  otherCandidatesFound: false,
  modelId,
  approvedSourceImageId: sourceImageId,
  approvedSourceImage: 'assets/art/tripo/references/stone-strata-delver.png',
  approvedSourceImageSha256: referenceSha,
  rawExport: 'assets/art/tripo/exports/corealm_strata_delver_707c39cd_8k_rigged.glb',
  rawExportSha256: sourceSha,
  rawExportBytes: sourceBytes.length,
  sourceFacts: {
    skins: 1,
    animationClips: 0,
    joints: 10,
    baseColor: { dimensions: [sourceBaseColorMetadata.width, sourceBaseColorMetadata.height], sha256: sha(sourceBaseColorBytes) },
    initialSkinning: sourceSkinningAudit,
    vertices: positionArray.length,
    triangles: indices.length / 3,
  },
};
await writeJson(path.join(here, 'source-audit.json'), sourceAudit);

const size = bounds.max.map((value, axis) => value - bounds.min[axis]);
const provenance = {
  author: 'Corealm creature rig reconstruction',
  generator: 'Tripo Studio P1.0 Smart Mesh',
  imageGenerator: 'Tripo GPT Image 2.5',
  modelId,
  sourceImageId,
  sourceImage: sourceAudit.approvedSourceImage,
  sourceImageSha256: referenceSha,
  originalSourceFile: sourceAudit.rawExport,
  originalSourceSha256: sourceSha,
  originalSourceBytes: sourceBytes.length,
  sourceTextureSha256: sha(sourceBaseColorBytes),
  sourceAudit: 'approved',
  batchId: 'beetle-golem',
  otherCandidatesFound: false,
  geometry: {
    vertices: positionArray.length,
    triangles: indices.length / 3,
    bounds,
    positionsNormalsIndicesAndUvHashesUnchanged: true,
    noRetopology: true,
    noUvRepack: true,
  },
  rigRepair: {
    source: '10-joint Tripo skin with collapsed identity transforms and all vertices dominated by bone_0',
    method: 'Replaced unusable joint transforms and inverse binds with 10 named pivots: root, body, head, tail and six legs. Six isolated limb islands were assigned to individual leg joints; small floor islands were matched to their nearest leg; body vertices blend along the long axis into head and tail joints.',
    joints: jointDefs.map((definition) => definition.name),
    weights: { normalized: true, maxSumError: weightMaxSumError, minimumNonzeroWeight, verticesWithMultipleInfluences, influenceCountHistogram, jointCoverage },
    axis: 'Y up; body length follows Z; head/front is negative Z based on the approved reference silhouette and six source limb islands.',
  },
  runtimeTextures: {
    maxDimension: 2048,
    originalsPreserved: 'Raw export remains unchanged at its approved path and hash; candidate embeds the same 8K base-color atlas resampled to 2K.',
    maps: textureSidecars,
  },
  requestedCoreMotions: animationStats,
  acceptance: {
    imageApproved: false,
    geometryApproved: false,
    rigAccepted: false,
    motionAccepted: false,
    textureAccepted: false,
    labAccepted: false,
    promotable: false,
    worldIntegrated: false,
    status: 'pending-root-feature-lab-review',
  },
};
const catalog = {
  schema: 'corealm-creature-candidate/1',
  id: candidateId,
  displayName: 'Strata Delver',
  status: 'awaiting-root-lab-review',
  acceptance: provenance.acceptance,
  source: {
    file: sourceAudit.rawExport,
    sha256: sourceSha,
    bytes: sourceBytes.length,
    modelId,
    approvedImageId: sourceImageId,
    imageReference: sourceAudit.approvedSourceImage,
    imageReferenceSha256: referenceSha,
    sourceBaseColor: '8192x8192',
    sourcePbr: ['no normal map', 'no metallic-roughness map'],
    sourceAudit: sourceAudit.sourceFacts,
  },
  candidate: {
    file: path.basename(candidatePath),
    sha256: candidateSha,
    bytes: candidateBytes.length,
    vertices: positionArray.length,
    triangles: indices.length / 3,
    bounds,
    size: { x: size[0], y: size[1], z: size[2] },
    rig: { type: 'custom six-legged quadruped-like arthropod rig', joints: jointDefs.map((definition) => definition.name), weighting: provenance.rigRepair.weights },
    textures: textureReport,
    clips: animationStats,
    notes: [
      'The approved layered sedimentary source albedo is retained and reduced from 8K to 2K for runtime use.',
      'The original geometry, vertex order, normals, indices and UV atlas are byte-for-byte preserved; no retopology or UV repacking was performed.',
      'Two-kilopixel tangent normals and packed occlusion-roughness-metallic maps are derived from the source atlas; stone is non-metallic.',
      'Six disconnected source leg assemblies receive individual pivots and custom Idle, Walk, Run, Attack, Hit and Death clips.',
      'All review and integration acceptance remains pending the root feature-lab pass.',
    ],
  },
  provenance,
  validation: {
    geometryHashesUnchanged: true,
    weightMaxSumError,
    minimumNonzeroWeight,
    verticesWithMultipleInfluences,
    jointCoverage,
    textureDimensions: textureReport.map((texture) => ({ name: texture.name, dimensions: texture.dimensions, mimeType: texture.mimeType })),
    clips: animationStats,
  },
};
await writeJson(path.join(here, 'catalog.json'), catalog);

const labAsset = {
  id: candidateId,
  file: path.basename(candidatePath),
  candidateFile: path.basename(candidatePath),
  pack: 'nine-pack-two-strata-delver-review',
  category: 'character',
  is: 'Strata Delver',
  tags: ['creature', 'stone', 'strata', 'six-legged', 'tripo', 'skinned', 'root-lab-review'],
  bytes: candidateBytes.length,
  sha256: candidateSha,
  size: { x: size[0], y: size[1], z: size[2] },
  base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] },
  bounds,
  groundY: 0,
  triangles: indices.length / 3,
  animations: animationStats.map((clip) => clip.name),
  materials: candidateRoot.listMaterials().map((candidate) => candidate.getName()),
  walkClipSeconds: 1.52,
  runClipSeconds: 0.88,
  attackSeconds: 0.78,
  sourceProvenance: {
    author: provenance.author,
    source: 'Approved Tripo source image and raw export from the beetle-golem batch.',
    modelId,
    sourceImageId,
    sourceImageSha256: referenceSha,
    sourceSha256: sourceSha,
    candidateFile: path.basename(candidatePath),
    candidateSha256: candidateSha,
    rigMethod: provenance.rigRepair.method,
    textureMaps: textureSidecars,
  },
  metadata: {
    is: 'Strata Delver',
    tags: ['creature', 'stone', 'strata', 'six-legged', 'tripo', 'skinned', 'root-lab-review'],
    boneNames: jointDefs.map((definition) => definition.name),
    notes: 'Layered sedimentary rock creature with six source limb islands, a repaired 10-joint rig and 2K runtime PBR maps.',
  },
  acceptance: { assetAudit: false, labAccepted: false, worldIntegrated: false },
};
await writeJson(path.join(here, 'lab-catalog.json'), {
  schema: 'corealm-lab-asset-candidates/1',
  assets: [labAsset],
  files: { [candidateId]: path.basename(candidatePath) },
});

console.log(JSON.stringify({
  candidate: path.basename(candidatePath),
  candidateSha256: candidateSha,
  sourceSha256: sourceSha,
  referenceSha256: referenceSha,
  vertices: positionArray.length,
  triangles: indices.length / 3,
  joints: jointDefs.length,
  componentCount: components.length,
  isolatedLegIslands: mainLegIslands.map((component) => ({ vertices: component.vertices.length, center: component.center })),
  weightMaxSumError,
  verticesWithMultipleInfluences,
  clips: animationStats,
  textures: textureSidecars,
  rootLabAcceptance: false,
}, null, 2));
