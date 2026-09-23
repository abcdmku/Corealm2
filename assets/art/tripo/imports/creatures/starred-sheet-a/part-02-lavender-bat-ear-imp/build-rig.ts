import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Accessor, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import sharp from "sharp";
import { Matrix4, Vector3 } from "three";
import { applyClip, duration, restorePose, storedPose } from "../../../../../../../tools/creature-motion/pose.js";
import { deformedBounds } from "../../../../../../../tools/creature-motion/validate-deformation.js";
import { retargetHumanoid } from "../../../../../../../tools/tripo-creatures/retarget.js";

const folder = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(folder, "../../../../../../../");
const id = path.basename(folder);
const pinnedBaseHashes: Record<string, string> = {
  "part-01-red-bone-mask-imp": "3b03d6fc1f5ee86d676eea4c93047fa8b69b32a99a86678f7ecfe1af7a156b6b",
  "part-02-lavender-bat-ear-imp": "37cdca6f0262b607e6b3b3b77bdb5dc9abc5460bd78d512dbbb692bb7ad7dc4f",
  "part-03-green-antler-imp": "9df3356d04266ac63acd48a8014d69780f5f4fe0eb49ec94ef1306327e7746e1",
};
const requestedHeights: Record<string, number> = {
  "part-01-red-bone-mask-imp": 1.3,
  "part-02-lavender-bat-ear-imp": 0.9,
  "part-03-green-antler-imp": 1.0,
};
const sourcePath = path.join(folder, "base.glb");
const motionPath = path.join(repo, "game/public/assets/models/animation/animation_library_1.glb");
const outputPath = path.join(folder, `${id}-native-rig-candidate.glb`);
const reportPath = path.join(folder, "rigging-verification.json");
const requiredClips = ["Idle", "Walk", "Run", "Attack", "Hit", "Death"];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const arrayHash = (array: ArrayLike<number> & { buffer?: ArrayBufferLike; byteOffset?: number; byteLength?: number }) => {
  if (!array.buffer || array.byteOffset === undefined || array.byteLength === undefined) throw new Error("Expected a typed accessor array.");
  return sha256(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
};
if (!pinnedBaseHashes[id]) throw new Error(`No reviewed extraction hash is pinned for ${id}.`);
if (!requestedHeights[id]) throw new Error(`No requested presentation height is configured for ${id}.`);

const sourceBytes = await readFile(sourcePath);
const sourceHash = sha256(sourceBytes);
if (sourceHash !== pinnedBaseHashes[id]) throw new Error(`Extracted base hash changed: ${sourceHash}`);
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find(node => node.getMesh() === mesh);
if (!scene || root.listScenes().length !== 1 || root.listMeshes().length !== 1 || !primitive || !meshNode || root.listSkins().length || root.listAnimations().length) {
  throw new Error("Expected the pinned one-mesh, unskinned extraction with no source clips.");
}
const originalTransform = new Matrix4().fromArray(meshNode.getWorldMatrix());
const normalizer = originalTransform.clone();
const scaleX = new Vector3().setFromMatrixColumn(normalizer, 0).length();
const scaleY = new Vector3().setFromMatrixColumn(normalizer, 1).length();
const scaleZ = new Vector3().setFromMatrixColumn(normalizer, 2).length();
if (Math.max(scaleX, scaleY, scaleZ) - Math.min(scaleX, scaleY, scaleZ) > 1e-6 || Math.abs(scaleY - 1) < 1e-6) {
  // The extraction transform is expected to be a uniform scale which turns source geometry into a 1 m creature.
  if (Math.max(scaleX, scaleY, scaleZ) - Math.min(scaleX, scaleY, scaleZ) > 1e-6) throw new Error("Source normalizer is not a uniform scale.");
}
const normalizerScale = scaleY;
const normalizerTranslationY = originalTransform.elements[13]!;
const presentationScale = requestedHeights[id]!;
const finalWorldScale = normalizerScale * presentationScale;
const finalTranslationY = normalizerTranslationY * presentationScale;
if (!(normalizerScale > 0)) throw new Error("Invalid extracted normalization scale.");
const toNormalized = originalTransform;
const toRaw = originalTransform.clone().invert();
const positions = primitive.getAttribute("POSITION")?.getArray();
const normals = primitive.getAttribute("NORMAL")?.getArray();
const uvs = primitive.getAttribute("TEXCOORD_0")?.getArray();
const sourceIndices = primitive.getIndices()?.getArray();
if (!positions || !normals || !uvs || !sourceIndices || positions.length % 3 || normals.length !== positions.length || uvs.length / 2 !== positions.length / 3) {
  throw new Error("Source mesh is missing a complete position, normal, UV or index stream.");
}
const geometryHashes = {
  positions: arrayHash(positions), normals: arrayHash(normals), uvs: arrayHash(uvs), indices: arrayHash(sourceIndices),
};
const triangleAttributesHash = (p: ArrayLike<number>, n: ArrayLike<number>, uv: ArrayLike<number>, indices: ArrayLike<number>) => {
  const hash = createHash("sha256");
  for (let cursor = 0; cursor < indices.length; cursor++) {
    const vertex = Number(indices[cursor]);
    hash.update(Buffer.from(Float32Array.of(p[vertex * 3]!, p[vertex * 3 + 1]!, p[vertex * 3 + 2]!).buffer));
    hash.update(Buffer.from(Float32Array.of(n[vertex * 3]!, n[vertex * 3 + 1]!, n[vertex * 3 + 2]!).buffer));
    hash.update(Buffer.from(Float32Array.of(uv[vertex * 2]!, uv[vertex * 2 + 1]!).buffer));
  }
  return hash.digest("hex");
};
const sourceTriangleHash = triangleAttributesHash(positions, normals, uvs, sourceIndices);

const sourceMaps = await Promise.all(root.listTextures().map(async texture => {
  const image = texture.getImage();
  if (!image) throw new Error(`Source texture ${texture.getName()} is not embedded.`);
  const meta = await sharp(image).metadata();
  return { name: texture.getName(), width: meta.width, height: meta.height, mimeType: texture.getMimeType(), bytes: image.length, sha256: sha256(image) };
}));
const motionBytes = await readFile(motionPath);
const motionHash = sha256(motionBytes);
const library = await io.readBinary(motionBytes);
const libraryRoot = library.getRoot();

// This 1 m library skeleton supplies its native bind pose and the six production takes.
// Convert its bones into the unnormalized mesh's local frame so vertex weights can be
// authored without changing the preserved source POSITION/NORMAL/UV/index accessors.
const nativeToTarget: Record<string, string> = {
  pelvis: "mixamorig:Hips", spine_01: "mixamorig:Spine", spine_02: "mixamorig:Spine1", spine_03: "mixamorig:Spine2",
  neck_01: "mixamorig:Neck", Head: "mixamorig:Head",
  clavicle_l: "mixamorig:LeftShoulder", upperarm_l: "mixamorig:LeftArm", lowerarm_l: "mixamorig:LeftForeArm", hand_l: "mixamorig:LeftHand",
  thigh_l: "mixamorig:LeftUpLeg", calf_l: "mixamorig:LeftLeg", foot_l: "mixamorig:LeftFoot", ball_l: "mixamorig:LeftToeBase", ball_leaf_l: "mixamorig:LeftToe_End",
  clavicle_r: "mixamorig:RightShoulder", upperarm_r: "mixamorig:RightArm", lowerarm_r: "mixamorig:RightForeArm", hand_r: "mixamorig:RightHand",
  thigh_r: "mixamorig:RightUpLeg", calf_r: "mixamorig:RightLeg", foot_r: "mixamorig:RightFoot", ball_r: "mixamorig:RightToeBase", ball_leaf_r: "mixamorig:RightToe_End",
};
for (const side of ["l", "r"] as const) {
  const title = side === "l" ? "Left" : "Right";
  for (const finger of ["index", "middle", "ring", "pinky", "thumb"]) for (let segment = 1; segment <= 3; segment++) {
    nativeToTarget[`${finger}_0${segment}_${side}`] = `mixamorig:${title}Hand${finger[0]!.toUpperCase()}${finger.slice(1)}${segment}`;
  }
}
const selectedNative = new Set(Object.keys(nativeToTarget));
const libraryNodes = new Map(libraryRoot.listNodes().map(node => [node.getName(), node]));
for (const nativeName of selectedNative) if (!libraryNodes.has(nativeName)) throw new Error(`Motion library is missing mapped bone ${nativeName}.`);
const libraryArmature = libraryNodes.get("Armature");
const libraryRootBone = libraryNodes.get("root");
if (!libraryArmature || !libraryRootBone) throw new Error("Motion library armature root changed.");

// The skinning weights and inverse binds are built in raw mesh-local space. The
// normalizer is restored as a common parent afterwards, so exported positions stay exact.
const meshParent = meshNode.getParentNode();
if (meshParent) meshParent.removeChild(meshNode);
else if (scene.listChildren().includes(meshNode)) scene.removeChild(meshNode);
else throw new Error("Source mesh node is detached from its scene.");
meshNode.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
scene.addChild(meshNode);

const armature = doc.createNode("mixamorig:Armature");
const armatureMatrix = toRaw.clone().multiply(new Matrix4().makeScale(0.62, 0.62, 0.62));
armature.setMatrix(armatureMatrix.toArray());
scene.addChild(armature);
const targetNodes = new Map<string, ReturnType<typeof doc.createNode>>();
const cloneNode = (sourceNode: ReturnType<typeof libraryRoot.listNodes>[number], parent: ReturnType<typeof doc.createNode>) => {
  const nativeName = sourceNode.getName();
  const targetName = nativeName === "root" ? "mixamorig:Root" : nativeToTarget[nativeName];
  if (!targetName) throw new Error(`No target bone name exists for ${nativeName}.`);
  const targetNode = doc.createNode(targetName).setMatrix(sourceNode.getMatrix());
  targetNodes.set(nativeName, targetNode);
  parent.addChild(targetNode);
  for (const child of sourceNode.listChildren()) if (selectedNative.has(child.getName())) cloneNode(child, targetNode);
};
cloneNode(libraryRootBone, armature);
const targetJoints = [...selectedNative].map(name => targetNodes.get(name)).filter((node): node is NonNullable<typeof node> => Boolean(node));
if (targetJoints.length !== selectedNative.size) throw new Error("The humanoid rig is missing one or more mapped joints.");
const skin = doc.createSkin(`${id}_Humanoid`).setSkeleton(targetNodes.get("pelvis")!);
for (const joint of targetJoints) skin.addJoint(joint);
meshNode.setSkin(skin);
const inverseBinds = new Float32Array(targetJoints.length * 16);
targetJoints.forEach((joint, index) => inverseBinds.set(new Matrix4().fromArray(joint.getWorldMatrix()).invert().toArray(), index * 16));
skin.setInverseBindMatrices(doc.createAccessor(`${id}_InverseBind`).setArray(inverseBinds).setType(Accessor.Type.MAT4).setBuffer(root.listBuffers()[0]!));

const jointIndex = new Map(targetJoints.map((joint, index) => [joint.getName(), index]));
const pointByTarget = new Map(targetJoints.map(joint => [joint.getName(), new Vector3().setFromMatrixPosition(new Matrix4().fromArray(joint.getWorldMatrix())).applyMatrix4(toNormalized)]));
const endpoints: Array<[string, string | null]> = [
  ["Hips", "Spine"], ["Spine", "Spine1"], ["Spine1", "Spine2"], ["Spine2", "Neck"], ["Neck", "Head"], ["Head", null],
  ["LeftShoulder", "LeftArm"], ["LeftArm", "LeftForeArm"], ["LeftForeArm", "LeftHand"], ["LeftHand", "LeftHandMiddle1"],
  ["LeftUpLeg", "LeftLeg"], ["LeftLeg", "LeftFoot"], ["LeftFoot", "LeftToeBase"], ["LeftToeBase", "LeftToe_End"],
  ["RightShoulder", "RightArm"], ["RightArm", "RightForeArm"], ["RightForeArm", "RightHand"], ["RightHand", "RightHandMiddle1"],
  ["RightUpLeg", "RightLeg"], ["RightLeg", "RightFoot"], ["RightFoot", "RightToeBase"], ["RightToeBase", "RightToe_End"],
];
const segments = endpoints.map(([name, child]) => {
  const start = pointByTarget.get(`mixamorig:${name}`);
  if (!start) throw new Error(`No bind point for ${name}.`);
  const end = child ? pointByTarget.get(`mixamorig:${child}`) : start.clone().add(new Vector3(0, 0.08, 0));
  if (!end) throw new Error(`No bind endpoint for ${name}/${child}.`);
  return { name, start, end };
});
const segmentDistance = (point: Vector3, start: Vector3, end: Vector3) => {
  const direction = end.clone().sub(start);
  const amount = Math.max(0, Math.min(1, point.clone().sub(start).dot(direction) / (direction.lengthSq() || 1)));
  return point.distanceTo(start.addScaledVector(direction, amount));
};
const weightIndices = new Uint16Array(positions.length / 3 * 4);
const weightValues = new Float32Array(positions.length / 3 * 4);
const width = 0.035;
let distributedVertices = 0;
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  const point = new Vector3(positions[vertex * 3]!, positions[vertex * 3 + 1]!, positions[vertex * 3 + 2]!).applyMatrix4(toNormalized);
  const nearest = segments.map(segment => ({
    joint: jointIndex.get(`mixamorig:${segment.name}`)!,
    distance: segmentDistance(point, segment.start, segment.end),
  })).sort((a, b) => a.distance - b.distance).slice(0, 4);
  const minimum = nearest[0]!.distance;
  const values = nearest.map(candidate => Math.exp(-((candidate.distance ** 2 - minimum ** 2) / (width ** 2))));
  const sum = values.reduce((total, value) => total + value, 0);
  if (!(sum > 0)) throw new Error(`No skin influence could be assigned at vertex ${vertex}.`);
  let slots = 0;
  nearest.forEach((candidate, index) => {
    weightIndices[vertex * 4 + index] = candidate.joint;
    weightValues[vertex * 4 + index] = values[index]! / sum;
    if (weightValues[vertex * 4 + index] > 1e-5) slots++;
  });
  if (slots > 1) distributedVertices++;
}
primitive.setAttribute("JOINTS_0", doc.createAccessor(`${id}_Joints0`).setArray(weightIndices).setType(Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]!));
primitive.setAttribute("WEIGHTS_0", doc.createAccessor(`${id}_Weights0`).setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]!));

const rigQuality = {
  vertexCount: positions.length / 3,
  jointCount: targetJoints.length,
  distributedWeightVertices: distributedVertices,
  distributedWeightFraction: Number((distributedVertices / (positions.length / 3)).toFixed(5)),
  weighting: "Four nearest humanoid bone segments, Gaussian distance blending in the normalized 1 m creature frame; source vertex arrays remain unchanged.",
  visualDeformationReviewRequired: true,
};
if (distributedVertices < positions.length / 3 * 0.9) throw new Error(`Too few vertices have blended weights: ${distributedVertices}.`);

const textureEvidence: Array<Record<string, unknown>> = [];
for (const texture of root.listTextures()) {
  const image = texture.getImage();
  const sourceMeta = await sharp(image!).metadata();
  if (!sourceMeta.width || !sourceMeta.height) throw new Error(`Cannot identify dimensions for ${texture.getName()}.`);
  const sourceMapHash = sha256(image!);
  if (sourceMeta.width > 2048 || sourceMeta.height > 2048) {
    const isNormal = /normal/i.test(texture.getName());
    const format = sourceMeta.format === "jpeg" ? "jpeg" : "png";
    const resized = await sharp(image!).resize(2048, 2048, { fit: "inside", withoutEnlargement: true, kernel: isNormal ? "linear" : "lanczos3" })
      .toFormat(format, format === "jpeg" ? { quality: 92, chromaSubsampling: "4:4:4" } : {}).toBuffer();
    texture.setImage(resized);
  }
  const runtimeMeta = await sharp(texture.getImage()!).metadata();
  if (!runtimeMeta.width || !runtimeMeta.height || runtimeMeta.width > 2048 || runtimeMeta.height > 2048) throw new Error(`Runtime map exceeds 2K: ${texture.getName()}.`);
  textureEvidence.push({
    name: texture.getName(), source: { width: sourceMeta.width, height: sourceMeta.height, bytes: image!.length, sha256: sourceMapHash },
    runtime: { width: runtimeMeta.width, height: runtimeMeta.height, bytes: texture.getImage()!.length, sha256: sha256(texture.getImage()!), preserved: sourceMapHash === sha256(texture.getImage()!) },
  });
}
if (!textureEvidence.length) throw new Error("Source texture maps are missing.");

const retarget = retargetHumanoid(doc, library);
for (const clip of [...root.listAnimations()]) if (!requiredClips.includes(clip.getName())) clip.dispose();
// retargetHumanoid authoring and bind verification expect a mesh-local identity root.
// Move the original extraction TRS to a shared presentation parent only after baking.
const motionGround = root.listNodes().find(node => node.getName() === "corealm_motion_ground");
if (!motionGround) throw new Error("Retargeter did not create its motion-ground node.");
for (const clip of root.listAnimations()) {
  for (const channel of clip.listChannels()) {
    if (channel.getTargetNode() !== motionGround || channel.getTargetPath() !== "translation") continue;
    const values = channel.getSampler().getOutput()!.getArray()!;
    for (let i = 1; i < values.length; i += 3) {
      values[i] = values[i]! * finalWorldScale - finalTranslationY + 0.001 * (1 - finalWorldScale);
    }
  }
}
const presentationMatrix = new Matrix4().makeScale(presentationScale, presentationScale, presentationScale).multiply(originalTransform);
const presentation = doc.createNode(`${id}_Presentation`).setMatrix(presentationMatrix.toArray());
for (const child of [...motionGround.listChildren()]) { motionGround.removeChild(child); presentation.addChild(child); }
motionGround.addChild(presentation);

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
const checkJoints = checkPrimitive?.getAttribute("JOINTS_0")?.getArray();
const checkWeights = checkPrimitive?.getAttribute("WEIGHTS_0")?.getArray();
const checkSkin = checkRoot.listSkins()[0];
if (!checkPrimitive || !checkPositions || !checkNormals || !checkUvs || !checkIndices || !checkJoints || !checkWeights || !checkSkin) throw new Error("Serialized GLB lost required geometry or skin attributes.");
const outputGeometryHashes = { positions: arrayHash(checkPositions), normals: arrayHash(checkNormals), uvs: arrayHash(checkUvs), indices: arrayHash(checkIndices) };
if (JSON.stringify(outputGeometryHashes) !== JSON.stringify(geometryHashes)) throw new Error("Serialized output changed source geometry, UVs or triangle-index order.");
const outputTriangleHash = triangleAttributesHash(checkPositions, checkNormals, checkUvs, checkIndices);
if (outputTriangleHash !== sourceTriangleHash) throw new Error("Triangle corner attribute order changed during rigging.");
const jointNames = checkSkin.listJoints().map(joint => joint.getName());
let maxWeightSumError = 0;
for (let vertex = 0; vertex < checkPositions.length / 3; vertex++) {
  let sum = 0;
  for (let slot = 0; slot < 4; slot++) {
    const index = vertex * 4 + slot;
    if (checkJoints[index]! >= jointNames.length || checkWeights[index]! < 0 || !Number.isFinite(checkWeights[index]!)) throw new Error(`Invalid serialized skin influence at vertex ${vertex}.`);
    sum += checkWeights[index]!;
  }
  maxWeightSumError = Math.max(maxWeightSumError, Math.abs(sum - 1));
  if (Math.abs(sum - 1) > 0.002) throw new Error(`Weights sum to ${sum} at vertex ${vertex}.`);
}
const clips = checkRoot.listAnimations().map(clip => ({ name: clip.getName(), seconds: duration(clip), channels: clip.listChannels().length }));
if (clips.map(clip => clip.name).join(",") !== requiredClips.join(",") || clips.some(clip => !(clip.seconds > 0 && clip.channels > 0))) {
  throw new Error(`Required six usable clips changed: ${JSON.stringify(clips)}.`);
}
const checkMaps = await Promise.all(checkRoot.listTextures().map(async texture => {
  const image = texture.getImage()!;
  const meta = await sharp(image).metadata();
  if (!meta.width || !meta.height || meta.width > 2048 || meta.height > 2048) throw new Error(`Output map exceeds 2K: ${texture.getName()}.`);
  return { name: texture.getName(), width: meta.width, height: meta.height, bytes: image.length, sha256: sha256(image) };
}));
const finalPose = storedPose(check);
const deformationSamples = [];
for (const clip of checkRoot.listAnimations()) {
  const seconds = duration(clip);
  for (const time of [...new Set([0, seconds / 2, seconds])]) {
    restorePose(finalPose);
    applyClip(clip, time);
    const bounds = deformedBounds(check);
    if (![...bounds.min, ...bounds.max].every(Number.isFinite)) throw new Error(`${clip.getName()} produced non-finite skinned bounds at ${time}s.`);
    deformationSamples.push({ clip: clip.getName(), seconds: Number(time.toFixed(4)), bounds, height: Number((bounds.max[1]! - bounds.min[1]!).toFixed(6)) });
  }
}
restorePose(finalPose);
const sourceBounds = deformedBounds(check);
const bindBounds = sourceBounds;
const perClipBounds = clips.map(clip => {
  const samples = deformationSamples.filter(sample => sample.clip === clip.name);
  return {
    name: clip.name,
    sampleCount: samples.length,
    minimumY: Math.min(...samples.map(sample => sample.bounds.min[1]!)),
    maximumY: Math.max(...samples.map(sample => sample.bounds.max[1]!)),
    minimumHeight: Math.min(...samples.map(sample => sample.height)),
    maximumHeight: Math.max(...samples.map(sample => sample.height)),
    samples: samples.map(sample => ({ seconds: sample.seconds, bounds: sample.bounds, height: sample.height })),
  };
});
const measuredBindHeight = bindBounds ? bindBounds.max[1]! - bindBounds.min[1]! : NaN;
const measuredOutputHeight = sourceBounds.max[1]! - sourceBounds.min[1]!;
if (Math.abs(measuredBindHeight - requestedHeights[id]!) > 0.005 || Math.abs(measuredOutputHeight - requestedHeights[id]!) > 0.005) {
  throw new Error(`Scaled bind/output height does not meet ${requestedHeights[id]} m: ${measuredBindHeight}/${measuredOutputHeight}.`);
}
const grounded = sourceBounds.min[1]! >= -0.005 && perClipBounds.every(clip => clip.minimumY >= -0.005);
if (!grounded) throw new Error(`Presentation scaling left sampled motion below the floor: ${JSON.stringify({ bindBounds, perClipBounds })}`);
const report = {
  schema: "corealm-starred-sheet-creature-rigging/1",
  id,
  status: "awaiting-root-rig-and-motion-review",
  source: { file: path.relative(repo, sourcePath).replaceAll(path.sep, "/"), sha256: sourceHash, geometryHashes, triangleCornerAttributesSha256: sourceTriangleHash, textures: sourceMaps },
  candidate: { file: path.relative(repo, outputPath).replaceAll(path.sep, "/"), sha256: candidateHash, bytes: outputBytes.length,
    geometryHashes: outputGeometryHashes, triangleCornerAttributesSha256: outputTriangleHash, sourceGeometryPreserved: true,
    presentationHeightMeters: Number((sourceBounds.max[1]! - sourceBounds.min[1]!).toFixed(6)), presentationScale,
    bounds: sourceBounds, textures: checkMaps, animationClips: clips, perClipBounds, deformationSamples },
  scaleReview: {
    targetHeightMeters: requestedHeights[id],
    measuredBindHeightMeters: Number(measuredBindHeight.toFixed(6)),
    measuredOutputHeightMeters: Number(measuredOutputHeight.toFixed(6)),
    grounded,
    groundedBindBounds: bindBounds,
    groundedOutputBounds: sourceBounds,
    perClipAnimatedBounds: Object.fromEntries(perClipBounds.map(clip => [clip.name, {
      minimumY: clip.minimumY, maximumY: clip.maximumY, minimumHeight: clip.minimumHeight, maximumHeight: clip.maximumHeight, samples: clip.samples,
    }])),
  },
  rig: { ...rigQuality, maximumWeightSumError: maxWeightSumError, jointNames, bindBounds, method: "Existing animation-library humanoid skeleton mapped to Mixamo semantic names; original extraction transform retained as a shared presentation parent; four nearest limb/torso/head segments blended in normalized source space." },
  motionSource: { file: path.relative(repo, motionPath).replaceAll(path.sep, "/"), sha256: motionHash,
    retarget: { method: retarget.method, restoredJoints: retarget.restoredJoints, mappedJoints: retarget.mappedJoints, translationScale: retarget.translationScale,
      clipMap: { Idle: "Idle_Loop", Walk: "Walk_Loop", Run: "Jog_Fwd_Loop", Attack: "Punch_Jab", Hit: "Hit_Chest", Death: "Death01" } } },
  holds: ["Rig weights and source geometry/map preservation are mechanically verified. Root visual inspection is still required for silhouette-specific deformation and motion fit."],
  acceptance: { sourceDesignAccepted: false, rigAccepted: false, motionAccepted: false, rootFeatureLabAccepted: false, worldIntegrated: false },
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ id, candidate: path.relative(repo, outputPath).replaceAll(path.sep, "/"), clips, bounds: sourceBounds, distributedWeights: rigQuality.distributedWeightFraction, hash: candidateHash }, null, 2));
