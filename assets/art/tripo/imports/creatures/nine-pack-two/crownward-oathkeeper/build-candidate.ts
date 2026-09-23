import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Accessor, NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import sharp from "sharp";
import { deformedBounds } from "../../../../../../../tools/creature-motion/validate-deformation.js";
import { applyClip, duration, removeClip, restorePose, storedPose } from "../../../../../../../tools/creature-motion/pose.js";
import { retargetHumanoid } from "../../../../../../../tools/tripo-creatures/retarget.js";

const folder = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(folder, "../../../../../../../");
const sourcePath = path.join(repo, "assets/art/tripo/exports/corealm_crownward_oathkeeper_f3b036f0_8k_rigged.glb");
const referencePath = path.join(repo, "assets/art/tripo/refs/crown-wild-crown-knight.png");
const motionPath = path.join(repo, "game/public/assets/models/animation/animation_library_1.glb");
const outputPath = path.join(folder, "crownward-oathkeeper-native-rig-candidate.glb");
const sourceHashExpected = "c3a23753bac5be4d57c5127cc32280e5635a5c3b36fd0641abd7617b3e3be128";
const referenceHashExpected = "1b0967188b315b1ecf507d8299a07e4fee219f1d6b0eaece0a0ea25754c2b561";
const sourceImageId = "59ac6fb8-1bc6-4263-81a4-d21a548dc31a";
const modelId = "f3b036f0-e5a0-423e-bbce-4cd37cfbd51a";
const requiredClips = ["Idle", "Walk", "Run", "Attack", "Hit", "Death"];
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

function textureStats(bytes: Uint8Array) {
  return sharp(bytes).removeAlpha().resize(128, 128, { fit: "fill", kernel: "nearest" }).raw().toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => {
      const channels = Array.from({ length: info.channels }, (_, channel) => {
        let min = 255, max = 0, sum = 0;
        for (let pixel = 0; pixel < info.width * info.height; pixel++) {
          const value = data[pixel * info.channels + channel]!;
          min = Math.min(min, value); max = Math.max(max, value); sum += value;
        }
        return { min, max, mean: Number((sum / (info.width * info.height)).toFixed(2)) };
      });
      return channels;
    });
}

async function downsampleTexture(texture: any, kind: "baseColor" | "normal" | "metallicRoughness") {
  const original = texture.getImage() as Uint8Array | null;
  if (!original) throw new Error(`Texture ${texture.getName()} has no embedded image.`);
  const originalName = texture.getName();
  const originalMimeType = texture.getMimeType();
  const originalMetadata = await sharp(original).metadata();
  const originalStats = await textureStats(original);
  if (!originalMetadata.width || !originalMetadata.height) throw new Error(`Cannot read dimensions for ${texture.getName()}.`);
  const resized = sharp(original).resize(2048, 2048, { fit: "fill", kernel: kind === "baseColor" ? "lanczos3" : "linear" });
  let runtimeImage: Buffer;
  let mimeType: string;
  if (kind === "normal") {
    const { data, info } = await resized.removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 3) throw new Error(`Expected RGB tangent normals for ${texture.getName()}, got ${info.channels} channels.`);
    const normalized = Buffer.alloc(data.length);
    for (let offset = 0; offset < data.length; offset += 3) {
      let x = data[offset]! / 127.5 - 1;
      let y = data[offset + 1]! / 127.5 - 1;
      let z = data[offset + 2]! / 127.5 - 1;
      const length = Math.hypot(x, y, z) || 1;
      x /= length; y /= length; z /= length;
      normalized[offset] = Math.round((x * 0.5 + 0.5) * 255);
      normalized[offset + 1] = Math.round((y * 0.5 + 0.5) * 255);
      normalized[offset + 2] = Math.round((z * 0.5 + 0.5) * 255);
    }
    runtimeImage = await sharp(normalized, { raw: { width: 2048, height: 2048, channels: 3 } }).png().toBuffer();
    mimeType = "image/png";
  } else if (kind === "metallicRoughness") {
    runtimeImage = await resized.png().toBuffer();
    mimeType = "image/png";
  } else if (originalMetadata.format === "jpeg") {
    runtimeImage = await resized.jpeg({ quality: 94, chromaSubsampling: "4:4:4" }).toBuffer();
    mimeType = "image/jpeg";
  } else {
    runtimeImage = await resized.png().toBuffer();
    mimeType = "image/png";
  }
  const runtimeName = kind === "normal" ? originalName.replace(/\.jpe?g$/i, ".png") : originalName;
  texture.setName(runtimeName).setImage(runtimeImage).setMimeType(mimeType);
  const runtimeMetadata = await sharp(runtimeImage).metadata();
  if (runtimeMetadata.width !== 2048 || runtimeMetadata.height !== 2048) throw new Error(`Runtime map is not 2K: ${texture.getName()}.`);
  return {
    name: originalName, runtimeName, kind,
    channelMeaning: kind === "baseColor" ? "sRGB base color" : kind === "normal" ? "tangent-space normal XYZ" : "glTF packed metallic-roughness: G=roughness, B=metallic",
    source: { width: originalMetadata.width, height: originalMetadata.height, mimeType: originalMimeType, sha256: sha256(original), channelStats: originalStats },
    runtime: { width: runtimeMetadata.width, height: runtimeMetadata.height, mimeType, bytes: runtimeImage.length, sha256: sha256(runtimeImage) },
  };
}

type RigBone = { name: string; parent: string | null; p: number[]; sigma: number; group: string; side?: number };
const baseRigBones: RigBone[] = [
  { name: "mixamorigHips", parent: null, p: [0, 0.455, -0.005], sigma: 0.095, group: "torso" },
  { name: "mixamorigSpine", parent: "mixamorigHips", p: [0, 0.535, -0.004], sigma: 0.085, group: "torso" },
  { name: "mixamorigSpine1", parent: "mixamorigSpine", p: [0, 0.625, -0.006], sigma: 0.085, group: "torso" },
  { name: "mixamorigSpine2", parent: "mixamorigSpine1", p: [0, 0.715, -0.008], sigma: 0.082, group: "torso" },
  { name: "mixamorigNeck", parent: "mixamorigSpine2", p: [0, 0.805, -0.006], sigma: 0.063, group: "neck" },
  { name: "mixamorigHead", parent: "mixamorigNeck", p: [0, 0.895, -0.002], sigma: 0.085, group: "head" },
  { name: "mixamorigLeftShoulder", parent: "mixamorigSpine2", p: [-0.105, 0.755, -0.006], sigma: 0.058, group: "leftArm", side: -1 },
  { name: "mixamorigLeftArm", parent: "mixamorigLeftShoulder", p: [-0.150, 0.685, -0.003], sigma: 0.066, group: "leftArm", side: -1 },
  { name: "mixamorigLeftForeArm", parent: "mixamorigLeftArm", p: [-0.181, 0.565, 0.004], sigma: 0.061, group: "leftArm", side: -1 },
  { name: "mixamorigLeftHand", parent: "mixamorigLeftForeArm", p: [-0.188, 0.475, 0.018], sigma: 0.055, group: "leftArm", side: -1 },
  { name: "mixamorigRightShoulder", parent: "mixamorigSpine2", p: [0.105, 0.755, -0.006], sigma: 0.058, group: "rightArm", side: 1 },
  { name: "mixamorigRightArm", parent: "mixamorigRightShoulder", p: [0.150, 0.685, -0.003], sigma: 0.066, group: "rightArm", side: 1 },
  { name: "mixamorigRightForeArm", parent: "mixamorigRightArm", p: [0.181, 0.565, 0.004], sigma: 0.061, group: "rightArm", side: 1 },
  { name: "mixamorigRightHand", parent: "mixamorigRightForeArm", p: [0.188, 0.475, 0.018], sigma: 0.055, group: "rightArm", side: 1 },
  { name: "mixamorigLeftUpLeg", parent: "mixamorigHips", p: [-0.073, 0.420, -0.006], sigma: 0.069, group: "leftLeg", side: -1 },
  { name: "mixamorigLeftLeg", parent: "mixamorigLeftUpLeg", p: [-0.083, 0.240, -0.002], sigma: 0.060, group: "leftLeg", side: -1 },
  { name: "mixamorigLeftFoot", parent: "mixamorigLeftLeg", p: [-0.083, 0.070, 0.014], sigma: 0.051, group: "leftLeg", side: -1 },
  { name: "mixamorigLeftToeBase", parent: "mixamorigLeftFoot", p: [-0.083, 0.035, 0.070], sigma: 0.045, group: "leftLeg", side: -1 },
  { name: "mixamorigRightUpLeg", parent: "mixamorigHips", p: [0.073, 0.420, -0.006], sigma: 0.069, group: "rightLeg", side: 1 },
  { name: "mixamorigRightLeg", parent: "mixamorigRightUpLeg", p: [0.083, 0.240, -0.002], sigma: 0.060, group: "rightLeg", side: 1 },
  { name: "mixamorigRightFoot", parent: "mixamorigRightLeg", p: [0.083, 0.070, 0.014], sigma: 0.051, group: "rightLeg", side: 1 },
  { name: "mixamorigRightToeBase", parent: "mixamorigRightFoot", p: [0.083, 0.035, 0.070], sigma: 0.045, group: "rightLeg", side: 1 },
];
const fingerOffsets = [0.010, 0.004, -0.003, -0.009, -0.015];
const fingerNames = ["Index", "Middle", "Ring", "Pinky", "Thumb"];
const fingerBones: RigBone[] = [];
for (const side of [{ name: "Left", sign: -1 }, { name: "Right", sign: 1 }]) {
  const hand = baseRigBones.find((bone) => bone.name === `mixamorig${side.name}Hand`)!;
  for (let finger = 0; finger < fingerNames.length; finger++) {
    const fingerName = fingerNames[finger]!;
    let parent = hand.name;
    const lateral = fingerOffsets[finger]! * side.sign;
    for (let segment = 1; segment <= 3; segment++) {
      const thumb = fingerName === "Thumb";
      const position = thumb
        ? [hand.p[0]! + lateral * (segment === 1 ? 1 : segment === 2 ? 1.55 : 1.9), hand.p[1]! - (segment - 1) * 0.012 - 0.004, hand.p[2]! + segment * 0.010]
        : [hand.p[0]! + lateral, hand.p[1]! - 0.018 - (segment - 1) * 0.012, hand.p[2]! + 0.010 + segment * 0.009];
      const name = `mixamorig${side.name}Hand${fingerName}${segment}`;
      fingerBones.push({ name, parent, p: position, sigma: 0.020, group: `${side.name.toLowerCase()}Finger`, side: side.sign });
      parent = name;
    }
  }
}
const rigBones: RigBone[] = [...baseRigBones, ...fingerBones];

function segmentDistance(point: number[], start: number[], end: number[]) {
  const vector = end.map((value, axis) => value - start[axis]!);
  const length2 = vector.reduce((sum, value) => sum + value * value, 0) || 1;
  const t = Math.max(0, Math.min(1, point.reduce((sum, value, axis) => sum + (value - start[axis]!) * vector[axis]!, 0) / length2));
  return Math.hypot(...point.map((value, axis) => value - (start[axis]! + vector[axis]! * t)));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function rebuildModelSpaceHumanoid(doc: any, scene: any, meshNode: any, primitive: any, positions: Float32Array) {
  const root = doc.getRoot();
  const currentParent = meshNode.getParentNode();
  if (currentParent) currentParent.removeChild(meshNode);
  else if (scene.listChildren().includes(meshNode)) scene.removeChild(meshNode);
  meshNode.setSkin(null).setName("CrownwardOathkeeperMesh").setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  for (const skin of [...root.listSkins()]) skin.dispose();
  const depth = (node: any): number => node.getParentNode() ? 1 + depth(node.getParentNode()) : 0;
  const oldNodes = root.listNodes().filter((node: any) => node !== meshNode).sort((a: any, b: any) => depth(b) - depth(a));
  for (const node of oldNodes) {
    const parent = node.getParentNode();
    if (parent) parent.removeChild(node);
    else if (scene.listChildren().includes(node)) scene.removeChild(node);
    node.setMesh(null).setSkin(null).dispose();
  }
  const leftovers = root.listNodes().filter((node: any) => node !== meshNode);
  if (leftovers.length) console.log("Detached source nodes remain in document:", leftovers.length, leftovers.slice(0, 8).map((node: any) => node.getName()));

  const armature = doc.createNode("Armature").setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  scene.addChild(armature);
  armature.addChild(meshNode);
  const byName = new Map(rigBones.map((bone, index) => [bone.name, { ...bone, index }]));
  const jointNodes = new Map<string, any>();
  for (const bone of rigBones) {
    const parent = bone.parent ? byName.get(bone.parent) : null;
    const local = parent ? bone.p.map((value, axis) => value - parent.p[axis]!) : bone.p;
    const node = doc.createNode(bone.name.replace(/^mixamorig/, "mixamorig:")).setTranslation(local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
    jointNodes.set(bone.name, node);
    (bone.parent ? jointNodes.get(bone.parent) : armature).addChild(node);
  }
  const skin = doc.createSkin("CrownwardOathkeeper_ModelSpaceHumanoid").setSkeleton(jointNodes.get("mixamorigHips"));
  for (const bone of rigBones) skin.addJoint(jointNodes.get(bone.name));
  const inverseBind = new Float32Array(rigBones.length * 16);
  for (let index = 0; index < rigBones.length; index++) {
    const [x, y, z] = rigBones[index]!.p;
    inverseBind.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], index * 16);
  }
  const buffer = root.listBuffers()[0];
  if (!buffer) throw new Error("Source GLB has no buffer for repaired skin data.");
  skin.setInverseBindMatrices(doc.createAccessor("CrownwardOathkeeper_InverseBind").setArray(inverseBind).setType(Accessor.Type.MAT4).setBuffer(buffer));
  meshNode.setSkin(skin);

  const jointValues = new Uint16Array(positions.length / 3 * 4);
  const weightValues = new Float32Array(positions.length / 3 * 4);
  let distributedVertices = 0, maximumWeightSumError = 0;
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const point = [positions[vertex * 3]!, positions[vertex * 3 + 1]!, positions[vertex * 3 + 2]!];
    const [x, y] = point;
    const candidates = [] as { index: number; score: number }[];
    for (const bone of rigBones) {
      const indexedBone = byName.get(bone.name)!;
      let gate = 1;
      if (bone.group === "head") gate = smoothstep(0.80, 0.875, y);
      if (bone.group === "neck") gate = smoothstep(0.735, 0.805, y) * (1 - smoothstep(0.83, 0.89, y));
      if (bone.group === "leftArm" || bone.group === "rightArm") {
        const lateral = bone.side! * x;
        gate = smoothstep(0.24, 0.34, y) * (1 - smoothstep(0.83, 0.90, y)) * (0.008 + 0.992 / (1 + Math.exp(-(lateral - 0.035) / 0.030)));
      }
      if (bone.group === "leftLeg" || bone.group === "rightLeg") {
        const lateral = bone.side! * x;
        gate = (1 - smoothstep(0.40, 0.535, y)) * (0.008 + 0.992 / (1 + Math.exp(-(lateral - 0.008) / 0.035)));
      }
      if (bone.group === "leftFinger" || bone.group === "rightFinger") {
        const lateral = bone.side! * x;
        gate = smoothstep(0.385, 0.43, y) * (1 - smoothstep(0.505, 0.535, y)) * (0.015 + 0.985 / (1 + Math.exp(-(lateral - 0.125) / 0.035)));
      }
      const parent = bone.parent ? byName.get(bone.parent) : null;
      const distance = segmentDistance(point, parent?.p ?? bone.p, bone.p);
      const score = gate * Math.exp(-0.5 * (distance / bone.sigma) ** 2);
      if (score > 1e-12) candidates.push({ index: indexedBone.index, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    const chosen = candidates.slice(0, 4);
    if (!chosen.length) throw new Error(`No anatomical weight support for source vertex ${vertex}.`);
    const total = chosen.reduce((sum, item) => sum + item.score, 0);
    let assigned = 0;
    for (let slot = 0; slot < 4; slot++) {
      const item = chosen[slot] ?? chosen[0]!;
      const weight = slot >= chosen.length ? 0 : slot === chosen.length - 1 ? 1 - assigned : item.score / total;
      jointValues[vertex * 4 + slot] = item.index;
      weightValues[vertex * 4 + slot] = weight;
      assigned += weight;
    }
    let sum = 0, count = 0;
    for (let slot = 0; slot < 4; slot++) {
      const weight = weightValues[vertex * 4 + slot]!;
      sum += weight; if (weight > 1e-5) count++;
    }
    maximumWeightSumError = Math.max(maximumWeightSumError, Math.abs(sum - 1));
    if (count > 1) distributedVertices++;
  }
  primitive.setAttribute("JOINTS_1", null).setAttribute("WEIGHTS_1", null);
  primitive.setAttribute("JOINTS_0", doc.createAccessor("CrownwardOathkeeper_Joints0").setArray(jointValues).setType(Accessor.Type.VEC4).setBuffer(buffer));
  primitive.setAttribute("WEIGHTS_0", doc.createAccessor("CrownwardOathkeeper_Weights0").setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(buffer));
  const geometryBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
    geometryBounds.min[axis] = Math.min(geometryBounds.min[axis]!, positions[i + axis]!);
    geometryBounds.max[axis] = Math.max(geometryBounds.max[axis]!, positions[i + axis]!);
  }
  const bindBounds = deformedBounds(doc);
  const bindDelta = Math.max(...bindBounds.min.map((value, axis) => Math.abs(value - geometryBounds.min[axis]!)), ...bindBounds.max.map((value, axis) => Math.abs(value - geometryBounds.max[axis]!)));
  if (bindDelta > 1e-5) throw new Error(`New bind pose does not preserve source geometry bounds (max delta ${bindDelta}).`);
  return { skin, jointNodes, armature, geometryBounds, bindBounds, bindBoundsDelta: bindDelta, distributedVertices, maximumWeightSumError };
}

const sourceBytes = await readFile(sourcePath);
const sourceHash = sha256(sourceBytes);
if (sourceHash !== sourceHashExpected) throw new Error(`Crownward source hash mismatch: ${sourceHash}`);
const referenceBytes = await readFile(referencePath);
const referenceHash = sha256(referenceBytes);
if (referenceHash !== referenceHashExpected) throw new Error(`Approved image hash mismatch: ${referenceHash}`);
const motionBytes = await readFile(motionPath);
const motionHash = sha256(motionBytes);
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find((node) => node.getMesh() === mesh);
const sourceSkin = root.listSkins()[0];
if (!scene || root.listScenes().length !== 1 || root.listMeshes().length !== 1 || !primitive || !meshNode || !sourceSkin || root.listSkins().length !== 1) {
  throw new Error("Expected the exact single-scene, single-mesh, single-skin Crownward Oathkeeper source.");
}
if (root.listAnimations().length !== 0 || sourceSkin.listJoints().length !== 54) throw new Error("Source rig or animation inventory changed.");
const positions = Float32Array.from(primitive.getAttribute("POSITION")?.getArray() ?? []);
const normals = Float32Array.from(primitive.getAttribute("NORMAL")?.getArray() ?? []);
const uvs = Float32Array.from(primitive.getAttribute("TEXCOORD_0")?.getArray() ?? []);
const indices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
const originalGeometry = { positions, normals, uvs, indices };
if (!positions.length || normals.length !== positions.length || uvs.length / 2 !== positions.length / 3 || !indices.length) {
  throw new Error("Crownward source geometry is missing positions, normals, UVs, or indexed triangles.");
}
const jointNames = sourceSkin.listJoints().map((joint) => joint.getName());
const hipsIndex = jointNames.findIndex((name) => name.replace(/^mixamorig:/, "") === "Hips");
if (hipsIndex < 0) throw new Error("Source skeleton no longer contains a Mixamo Hips joint.");
const sourceWeights = primitive.getAttribute("WEIGHTS_0")?.getArray();
const sourceJoints = primitive.getAttribute("JOINTS_0")?.getArray();
const sourceInverseBinds = sourceSkin.getInverseBindMatrices()?.getArray();
if (!sourceInverseBinds) throw new Error("Source humanoid skin has no inverse-bind matrices.");
const sourceInverseBindMaxAbs = Math.max(...Array.from(sourceInverseBinds).map(Math.abs));
const sourceJointTrsIdentity = sourceSkin.listJoints().every((joint) =>
  joint.getTranslation().every((value) => Math.abs(value) < 1e-8) &&
  joint.getRotation().every((value, index) => Math.abs(value - (index === 3 ? 1 : 0)) < 1e-8) &&
  joint.getScale().every((value) => Math.abs(value - 1) < 1e-8));
if (!sourceWeights || !sourceJoints || sourceWeights.length !== positions.length / 3 * 4 || sourceJoints.length !== sourceWeights.length) {
  throw new Error("Source humanoid skin does not expose one four-influence weight set.");
}
let sourceHipsWeight = 0, sourceWeightTotal = 0, hipsDominantVertices = 0;
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  let hips = 0, total = 0, dominant = -1;
  for (let slot = 0; slot < 4; slot++) {
    const i = vertex * 4 + slot, joint = sourceJoints[i]!, weight = sourceWeights[i]!;
    if (!Number.isFinite(weight) || weight < 0 || joint >= jointNames.length) throw new Error(`Invalid source skin attribute at vertex ${vertex}.`);
    total += weight;
    if (joint === hipsIndex) hips += weight;
    dominant = Math.max(dominant, weight);
  }
  sourceHipsWeight += hips;
  sourceWeightTotal += total;
  if (hips >= dominant - 1e-6) hipsDominantVertices++;
}
const sourceSkinEvidence = {
  joints: jointNames.length,
  vertices: positions.length / 3,
  hipsDominantVertices,
  hipsDominantVertexFraction: Number((hipsDominantVertices / (positions.length / 3)).toFixed(6)),
  totalWeightMassOnHips: Number((sourceHipsWeight / sourceWeightTotal).toFixed(6)),
  sourceJointTrsIdentity,
  sourceInverseBindMaxAbs: Number(sourceInverseBindMaxAbs.toExponential(4)),
  disposition: "Replaced after inverse-bind reconstruction produced non-anatomical, numerically unstable joint positions; the exact source mesh remains unchanged.",
  sourceAnimations: 0,
};
if (sourceSkinEvidence.hipsDominantVertexFraction < 0.95) throw new Error(`Expected the documented Hips-dominant export, observed ${sourceSkinEvidence.hipsDominantVertexFraction}.`);

const material = root.listMaterials()[0];
const baseColorTexture = material?.getBaseColorTexture();
const normalTexture = material?.getNormalTexture();
const metallicRoughnessTexture = material?.getMetallicRoughnessTexture();
if (!material || !baseColorTexture || !normalTexture || !metallicRoughnessTexture) throw new Error("Approved source is missing a complete base-color, normal, and packed PBR material.");
const sourceTextureEvidence = await Promise.all(root.listTextures().map(async (texture) => {
  const image = texture.getImage();
  if (!image) throw new Error(`Missing embedded source image: ${texture.getName()}`);
  const metadata = await sharp(image).metadata();
  return { name: texture.getName(), width: metadata.width, height: metadata.height, mimeType: texture.getMimeType(), bytes: image.length, sha256: sha256(image) };
}));
const sourceBaseColorMetadata = await sharp(baseColorTexture.getImage()!).metadata();
const sourceNormalMetadata = await sharp(normalTexture.getImage()!).metadata();
const sourcePackedPbrMetadata = await sharp(metallicRoughnessTexture.getImage()!).metadata();
if (sourceBaseColorMetadata.width !== 8192 || sourceBaseColorMetadata.height !== 8192 ||
    sourceNormalMetadata.width !== 4096 || sourceNormalMetadata.height !== 4096 ||
    sourcePackedPbrMetadata.width !== 4096 || sourcePackedPbrMetadata.height !== 4096) {
  throw new Error("Approved source texture dimensions changed: expected 8K base color and 4K normal/packed PBR maps.");
}

const rigRepair = rebuildModelSpaceHumanoid(doc, scene, meshNode, primitive, positions);
const retarget = retargetHumanoid(doc, await io.readBinary(motionBytes));
removeClip(doc, "HitLeft");
removeClip(doc, "HitRight");
const selectedAnimations = root.listAnimations();
if (selectedAnimations.map((animation) => animation.getName()).join(",") !== requiredClips.join(",")) {
  throw new Error(`Retargeted clip set changed: ${selectedAnimations.map((animation) => animation.getName()).join(", ")}`);
}
const bindBounds = deformedBounds(doc);
const savedPose = storedPose(doc);
const motionEvidence = [] as { name: string; seconds: number; sampledTimes: number[]; maximumBoundsChange: number }[];
for (const animation of selectedAnimations) {
  const seconds = duration(animation), times = [0, 0.25, 0.5, 0.75, 1].map((phase) => Number((seconds * phase).toFixed(4)));
  restorePose(savedPose);
  const base = deformedBounds(doc);
  let maximumBoundsChange = 0;
  for (const time of times) {
    restorePose(savedPose);
    applyClip(animation, time);
    const bounds = deformedBounds(doc);
    maximumBoundsChange = Math.max(maximumBoundsChange,
      ...bounds.min.map((value, axis) => Math.abs(value - base.min[axis]!)),
      ...bounds.max.map((value, axis) => Math.abs(value - base.max[axis]!)));
  }
  motionEvidence.push({ name: animation.getName(), seconds, sampledTimes: times, maximumBoundsChange });
}
restorePose(savedPose);
if (motionEvidence.some((clip) => clip.name !== "Idle" && clip.maximumBoundsChange < 0.01)) {
  throw new Error(`One or more retargeted clips did not measurably move the bound mesh: ${JSON.stringify(motionEvidence)}`);
}
const sourceHeight = bindBounds.max[1]! - bindBounds.min[1]!;
if (!(sourceHeight > 0)) throw new Error("Retargeted bind pose has no positive vertical height.");
if (retarget.translationScale < 0.25 || retarget.translationScale > 4 || retarget.clips.some((clip: any) => clip.maximumGroundCorrection > 0.5)) {
  throw new Error(`Native retarget motion is outside useful humanoid scale/grounding bounds: ${JSON.stringify({ translationScale: retarget.translationScale, clips: retarget.clips })}`);
}
const targetHeightMeters = 1.9;
const presentationScale = targetHeightMeters / sourceHeight;
const wrapper = doc.createNode("CrownwardOathkeeperPresentation");
for (const child of [...scene.listChildren()]) { scene.removeChild(child); wrapper.addChild(child); }
scene.addChild(wrapper);
wrapper.setScale([presentationScale, presentationScale, presentationScale]);
const scaledBounds = deformedBounds(doc);
wrapper.setTranslation([-(scaledBounds.min[0]! + scaledBounds.max[0]!) / 2, -scaledBounds.min[1]!, -(scaledBounds.min[2]! + scaledBounds.max[2]!) / 2]);
const candidateBindBounds = deformedBounds(doc);
const candidateBindSize = candidateBindBounds.max.map((value, axis) => value - candidateBindBounds.min[axis]!);
if (candidateBindSize[0]! < 0.45 || candidateBindSize[1]! < 1.85 || candidateBindSize[2]! < 0.24) {
  throw new Error(`Presentation geometry bounds are degenerate or unexpectedly small: ${candidateBindSize.join(", ")}`);
}

const textureEvidence = [];
for (const texture of root.listTextures()) {
  const kind = texture === baseColorTexture ? "baseColor" : texture === normalTexture ? "normal" : texture === metallicRoughnessTexture ? "metallicRoughness" : null;
  if (!kind) throw new Error(`Unexpected fourth texture channel cannot be classified: ${texture.getName()}`);
  textureEvidence.push(await downsampleTexture(texture, kind));
}
if (textureEvidence.length !== 3 || textureEvidence.some((item) => item.runtime.width !== 2048 || item.runtime.height !== 2048)) {
  throw new Error("Runtime PBR maps must contain exactly three 2K images.");
}
const outputBytes = await io.writeBinary(doc);
await mkdir(folder, { recursive: true });
await writeFile(outputPath, outputBytes);
const candidateHash = sha256(outputBytes);
const check = await io.readBinary(outputBytes);
const checkRoot = check.getRoot();
const checkPrimitive = checkRoot.listMeshes()[0]?.listPrimitives()[0];
const checkPositions = checkPrimitive?.getAttribute("POSITION")?.getArray();
const checkNormals = checkPrimitive?.getAttribute("NORMAL")?.getArray();
const checkUvs = checkPrimitive?.getAttribute("TEXCOORD_0")?.getArray();
const checkIndices = checkPrimitive?.getIndices()?.getArray();
if (!checkPrimitive || !checkPositions || !checkNormals || !checkUvs || !checkIndices) throw new Error("Serialized candidate lost source geometry attributes.");
const compareExact = (a: ArrayLike<number>, b: ArrayLike<number>, label: string) => {
  if (a.length !== b.length) throw new Error(`${label} count changed: ${a.length} -> ${b.length}`);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error(`${label} changed at ${i}: ${a[i]} -> ${b[i]}`);
};
compareExact(originalGeometry.positions, checkPositions, "positions");
compareExact(originalGeometry.normals, checkNormals, "normals");
compareExact(originalGeometry.uvs, checkUvs, "UV coordinates");
compareExact(originalGeometry.indices, checkIndices, "triangle indices");
const checkSkin = checkRoot.listSkins()[0];
const checkJointNames = checkSkin?.listJoints().map((joint) => joint.getName()) ?? [];
if (!checkSkin || checkJointNames.length !== rigBones.length) throw new Error(`Serialized candidate no longer has the repaired ${rigBones.length}-joint humanoid skeleton.`);
const checkWeights = checkPrimitive.getAttribute("WEIGHTS_0")?.getArray();
const checkJoints = checkPrimitive.getAttribute("JOINTS_0")?.getArray();
if (!checkWeights || !checkJoints) throw new Error("Serialized candidate is missing repaired skin weights.");
let distributedVertices = 0, maximumWeightSumError = 0;
const dominantWeightVertices = new Uint32Array(checkJointNames.length);
const weightedVertexInfluences = new Uint32Array(checkJointNames.length);
for (let vertex = 0; vertex < checkPositions.length / 3; vertex++) {
  let sum = 0, count = 0, dominantJoint = -1, maximumWeight = -1;
  for (let slot = 0; slot < 4; slot++) {
    const i = vertex * 4 + slot, joint = checkJoints[i]!, weight = checkWeights[i]!;
    if (!Number.isInteger(joint) || joint < 0 || joint >= checkJointNames.length || !Number.isFinite(weight) || weight < 0) throw new Error(`Invalid repaired skin influence on vertex ${vertex}.`);
    sum += weight;
    if (weight > 1e-5) {
      count++;
      weightedVertexInfluences[joint]++;
    }
    if (weight > maximumWeight) { maximumWeight = weight; dominantJoint = joint; }
  }
  if (dominantJoint < 0) throw new Error(`Vertex ${vertex} has no dominant repaired joint.`);
  dominantWeightVertices[dominantJoint]++;
  maximumWeightSumError = Math.max(maximumWeightSumError, Math.abs(sum - 1));
  if (count > 1) distributedVertices++;
  if (Math.abs(sum - 1) > 0.002) throw new Error(`Weights on vertex ${vertex} sum to ${sum}.`);
}
if (distributedVertices < checkPositions.length / 3 * 0.9) throw new Error(`Only ${distributedVertices} vertices have distributed weights.`);
const dominantWeightVerticesByJoint = Object.fromEntries(checkJointNames.map((name, index) => [name, dominantWeightVertices[index]]));
const weightedVertexInfluencesByJoint = Object.fromEntries(checkJointNames.map((name, index) => [name, weightedVertexInfluences[index]]));
const unusedBodyJoints = checkJointNames.slice(0, baseRigBones.length).filter((name, index) => weightedVertexInfluences[index] === 0);
if (unusedBodyJoints.length) throw new Error(`Rebuilt skin does not use expected body joints: ${unusedBodyJoints.join(", ")}`);
const inverseBinds = checkSkin.getInverseBindMatrices()?.getArray();
if (!inverseBinds || inverseBinds.length !== checkJointNames.length * 16 || Array.from(inverseBinds).some((value) => !Number.isFinite(value))) {
  throw new Error("Candidate inverse-bind matrices are incomplete or non-finite.");
}
const candidateAnimations = checkRoot.listAnimations().map((animation) => ({
  name: animation.getName(), seconds: duration(animation), channels: animation.listChannels().length,
}));
if (candidateAnimations.map((animation) => animation.name).join(",") !== requiredClips.join(",") || candidateAnimations.some((animation) => !(animation.seconds > 0 && animation.channels > 0))) {
  throw new Error("Serialized candidate is missing a usable required clip.");
}
const jointSet = new Set(checkJointNames);
for (const animation of checkRoot.listAnimations()) for (const channel of animation.listChannels()) {
  const target = channel.getTargetNode()?.getName();
  if (target !== "corealm_motion_ground" && target && !jointSet.has(target)) throw new Error(`${animation.getName()} targets an unreviewed node ${target}.`);
}
const runtimeMaps = await Promise.all(checkRoot.listTextures().map(async (texture) => {
  const metadata = await sharp(texture.getImage()!).metadata();
  if (metadata.width !== 2048 || metadata.height !== 2048) throw new Error(`Serialized texture changed dimension: ${texture.getName()}`);
  return { name: texture.getName(), width: metadata.width, height: metadata.height, mimeType: texture.getMimeType(), bytes: texture.getImage()!.length, sha256: sha256(texture.getImage()!) };
}));
const finalBounds = deformedBounds(check);
const prompt = "Crownward Oathkeeper, a noble living medieval knight guarding a prosperous kingdom. Adult balanced athletic build and human proportions, practical closed greathelm with a straight narrow eye slit and flat crown, no sculpted face. Well-maintained silver steel plate over quilted deep blue cloth, softly worn steel edges and restrained engraved lines only at borders. Proportionate shoulder plates, overlapping elbow and knee armor conceals the articulation, practical five-finger gloves, solid walking sabatons. A simple ivory tabard divided below belt carries one small blue heraldic bar. Both hands empty, no sword or shield. Dignified neutral sentinel, no gold ornament, wings, horns or glowing eyes.";
const acceptance = { sourceDesignAccepted: false, geometryAccepted: false, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false };
const catalog = {
  schema: "corealm-creature-native-rig-candidate/1",
  id: "creature_crownward_oathkeeper",
  displayName: "Crownward Oathkeeper",
  status: "awaiting-root-lab-review",
  accepted: false,
  provenance: {
    batchId: "crown-knight",
    source: { file: "assets/art/tripo/exports/corealm_crownward_oathkeeper_f3b036f0_8k_rigged.glb", sha256: sourceHash, bytes: sourceBytes.length, modelId, sourceImageId, approvedImage: "assets/art/tripo/refs/crown-wild-crown-knight.png", approvedImageSha256: referenceHash, prompt },
    sourceAudits: { image: "approved", intactFace: "approved", reviewedAgainstExactSourceImage: true },
  },
  source: {
    geometry: { vertices: positions.length / 3, triangles: indices.length / 3, positionsPreserved: true, normalsPreserved: true, uvsPreserved: true, indicesPreserved: true, retopology: false },
    skin: sourceSkinEvidence,
    textures: sourceTextureEvidence,
    sourceAnimations: [],
    sourceExportEvidence: { skins: 1, clips: 0, baseColor: "8192x8192", normalAndPackedPbr: "4096x4096", sourceWeightsHipsDominant: true },
  },
  candidate: {
    file: outputPath.replace(`${repo}${path.sep}`, "").replaceAll(path.sep, "/"),
    sha256: candidateHash,
    bytes: outputBytes.length,
    geometry: { vertices: checkPositions.length / 3, triangles: checkIndices.length / 3, positionsPreserved: true, normalsPreserved: true, uvsPreserved: true, indicesPreserved: true, retopology: false },
    presentation: { heightMeters: 1.9, scale: presentationScale, bounds: { min: finalBounds.min, max: finalBounds.max }, groundY: 0 },
    rig: { method: "Replaced the unusable 54-joint Tripo skin with a 52-joint model-space Mixamo humanoid rig fitted to the source silhouette: 22 torso/limb joints and 30 finger joints. Source inverse binds are numerically corrupt. Four-influence weights are rebuilt from anatomical bone-segment distance fields and spatial body-region gates.", jointCount: checkJointNames.length, jointNames: checkJointNames, joints: rigBones.map((bone) => ({ name: bone.name, parent: bone.parent, position: bone.p })), distributedWeightVertices: distributedVertices, maximumWeightSumError, inverseBindMatrixCount: inverseBinds.length / 16, bindBoundsDelta: rigRepair.bindBoundsDelta, dominantWeightVerticesByJoint, weightedVertexInfluencesByJoint, nativeRestPoseJointCount: retarget.restoredJoints, nativeMappedJointCount: retarget.mappedJoints },
    animations: candidateAnimations.map((clip) => ({ ...clip, sourceTake: ({ Idle: "Idle_Loop", Walk: "Walk_Loop", Run: "Jog_Fwd_Loop", Attack: "Punch_Jab", Hit: "Hit_Chest", Death: "Death01" } as Record<string, string>)[clip.name] })),
    motionEvidence,
    motionSource: { file: "game/public/assets/models/animation/animation_library_1.glb", sha256: motionHash, method: retarget.method, yawDegrees: retarget.yawDegrees, translationScale: retarget.translationScale, discardedAliases: ["HitLeft", "HitRight"] },
    textures: textureEvidence,
    materialChannels: { baseColor: "approved image-generated layered albedo; source image retained, resized only", normal: "tangent-space XYZ normals; resized and vector-renormalized", metallicRoughness: "glTF G roughness and B metallic channels retained with data-aware resizing", runtimeMaximumDimension: 2048 },
  },
  build: { command: "npx tsx assets/art/tripo/imports/creatures/nine-pack-two/crownward-oathkeeper/build-candidate.ts", script: "assets/art/tripo/imports/creatures/nine-pack-two/crownward-oathkeeper/build-candidate.ts" },
  acceptance,
};
await writeFile(path.join(folder, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
const labCatalog = {
  schema: "corealm-lab-asset-candidates/1",
  files: { creature_crownward_oathkeeper: path.relative(repo, outputPath).split(path.sep).join("/") },
  assets: [{
    id: "creature_crownward_oathkeeper", file: path.relative(repo, outputPath).split(path.sep).join("/"), pack: "corealm-nine-pack-two-candidates", category: "character",
    is: "Crownward Oathkeeper candidate", tags: ["creature", "humanoid", "knight", "crownward", "tripo", "candidate"], bytes: outputBytes.length,
    sha256: candidateHash, triangles: checkIndices.length / 3, size: { x: finalBounds.max[0]! - finalBounds.min[0]!, y: finalBounds.max[1]! - finalBounds.min[1]!, z: finalBounds.max[2]! - finalBounds.min[2]! },
    base: { x: finalBounds.min[0], y: finalBounds.min[1], z: finalBounds.min[2] }, groundY: 0,
    animations: candidateAnimations.map((clip) => clip.name), materials: checkRoot.listMaterials().map((entry) => entry.getName()),
    sourceProvenance: { modelId, sourceImageId, sourceFile: "assets/art/tripo/exports/corealm_crownward_oathkeeper_f3b036f0_8k_rigged.glb", sourceSha256: sourceHash, candidateFile: path.relative(repo, outputPath).split(path.sep).join("/"), candidateSha256: candidateHash, candidateStatus: "awaiting-root-lab-review" },
    acceptance: { assetAudit: false, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
  }],
};
await writeFile(path.join(folder, "lab-catalog.json"), `${JSON.stringify(labCatalog, null, 2)}\n`);
console.log(JSON.stringify({ candidate: path.relative(repo, outputPath).split(path.sep).join("/"), bytes: outputBytes.length, sha256: candidateHash, geometry: catalog.candidate.geometry, sourceSkin: sourceSkinEvidence, repairedRig: catalog.candidate.rig, clips: candidateAnimations, motionEvidence, runtimeMaps, acceptance }, null, 2));
