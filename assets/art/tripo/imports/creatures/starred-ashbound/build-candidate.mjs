import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { importCreatures } from '../../../../../../tools/tripo-creatures/import.ts';

const repo = path.resolve(fileURLToPath(new URL('../../../../../../', import.meta.url)));
const ownerDir = path.resolve(repo, 'assets/art/tripo/imports/creatures/starred-ashbound');
const originalFile = path.resolve(repo, 'assets/art/tripo/exports/corealm_ashbound_votary_bb588df9_8k_rigged.glb');
const outputFile = path.join(ownerDir, 'sources/creature_cinder_penitent-rest-recovered.glb');
const originalSha = '092103afcf086eb19b4c6ea51c7393915b861a54b58df0b54be09d15994446eb';
const originalImageId = '1a59c971-8c0d-4357-b40d-937546e79334';
const modelId = 'bb588df9-a59e-4c37-8255-4eb5718b3bc6';
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

const rawBytes = await readFile(originalFile);
if (sha(rawBytes) !== originalSha) throw new Error('The approved Ashbound Votary source export changed.');
const sourceDoc = await io.readBinary(rawBytes);
const donorBytes = await readFile(path.resolve(repo, 'game/public/assets/models/animation/animation_library_1.glb'));
const donorDoc = await io.readBinary(donorBytes);
const sourceRoot = sourceDoc.getRoot(), donorRoot = donorDoc.getRoot();
const skin = sourceRoot.listSkins()[0];
const donorSkin = donorRoot.listSkins()[0];
if (!skin?.getInverseBindMatrices() || !donorSkin) throw new Error('Expected the exported Mixamo skin and the existing humanoid motion rig.');
if (sourceRoot.listAnimations().length) throw new Error('Expected the approved export to contain no animation clips.');

const bounds = new Box3();
for (const node of sourceRoot.listNodes()) {
  if (!node.getMesh()) continue;
  const nodeWorld = new Matrix4().fromArray(node.getWorldMatrix());
  for (const primitive of node.getMesh().listPrimitives()) {
    const positions = primitive.getAttribute('POSITION');
    for (let index = 0; index < positions.getCount(); index++) {
      bounds.expandByPoint(new Vector3().fromArray(positions.getElement(index, [])).applyMatrix4(nodeWorld));
    }
  }
}
const meshSize = bounds.getSize(new Vector3());
if (Math.abs(meshSize.y - 1) > .02 || meshSize.x < .4 || meshSize.y / meshSize.x < 1.8) {
  throw new Error(`Unexpected source mesh dimensions ${meshSize.toArray().join(',')}`);
}

const donorByName = new Map(donorRoot.listNodes().map((node) => [node.getName(), node]));
const mapping = { Hips: 'pelvis', Spine: 'spine_01', Spine1: 'spine_02', Spine2: 'spine_03', Neck: 'neck_01', Head: 'Head' };
for (const [side, suffix] of [['Left', 'l'], ['Right', 'r']]) {
  for (const [target, donor] of [['Shoulder', 'clavicle'], ['Arm', 'upperarm'], ['ForeArm', 'lowerarm'],
    ['Hand', 'hand'], ['UpLeg', 'thigh'], ['Leg', 'calf'], ['Foot', 'foot'], ['ToeBase', 'ball']]) {
    mapping[`${side}${target}`] = `${donor}_${suffix}`;
  }
  for (const finger of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) {
    for (let segment = 1; segment <= 3; segment++) {
      mapping[`${side}Hand${finger}${segment}`] = `${finger.toLowerCase()}_0${segment}_${suffix}`;
    }
  }
  mapping[`${side}Toe_End`] = `ball_leaf_${suffix}`;
}

const donorWorld = new Map();
for (const name of new Set(Object.values(mapping))) {
  const node = donorByName.get(name);
  if (!node) throw new Error(`Missing matching native humanoid joint ${name}`);
  donorWorld.set(name, new Matrix4().fromArray(node.getWorldMatrix()));
}
const donorPosition = (name) => new Vector3().setFromMatrixPosition(donorWorld.get(name));
const footY = (donorPosition('foot_l').y + donorPosition('foot_r').y) / 2;
const pelvisZ = donorPosition('pelvis').z;
const handSpan = donorPosition('hand_l').x - donorPosition('hand_r').x;
const verticalSpan = donorPosition('Head').y - footY;
const donorZ = [...donorWorld.values()].map((matrix) => new Vector3().setFromMatrixPosition(matrix).z);
const donorDepth = Math.max(...donorZ) - Math.min(...donorZ);
const scale = { x: meshSize.x / handSpan, y: meshSize.y / verticalSpan, z: meshSize.z / donorDepth };
if (![scale.x, scale.y, scale.z].every((value) => Number.isFinite(value) && value > 0)) throw new Error('Invalid source-to-rig fit.');

const targets = new Map();
for (const joint of skin.listJoints()) {
  const name = joint.getName().replace(/^mixamorig:/, '');
  const mapped = mapping[name];
  if (!mapped) throw new Error(`No rest-pose mapping for Mixamo joint ${name}`);
  const donorMatrix = donorWorld.get(mapped);
  const donorPositionVector = new Vector3();
  const donorRotation = new Quaternion();
  const donorScale = new Vector3();
  donorMatrix.decompose(donorPositionVector, donorRotation, donorScale);
  const targetPosition = new Vector3(
    donorPositionVector.x * scale.x,
    bounds.min.y + (donorPositionVector.y - footY) * scale.y,
    (donorPositionVector.z - pelvisZ) * scale.z,
  );
  targets.set(joint, new Matrix4().compose(targetPosition, donorRotation, new Vector3(1, 1, 1)));
}

const depthOf = (node) => node.getParentNode() ? 1 + depthOf(node.getParentNode()) : 0;
for (const joint of [...skin.listJoints()].sort((a, b) => depthOf(a) - depthOf(b))) {
  const parent = joint.getParentNode();
  const parentWorld = parent ? targets.get(parent) ?? new Matrix4().fromArray(parent.getWorldMatrix()) : new Matrix4();
  const local = parentWorld.clone().invert().multiply(targets.get(joint));
  joint.setMatrix(local.toArray());
}

const inverseBinds = new Float32Array(skin.listJoints().length * 16);
skin.listJoints().forEach((joint, index) => inverseBinds.set(targets.get(joint).clone().invert().toArray(), index * 16));
const bindAccessor = sourceDoc.createAccessor('Ashbound recovered Mixamo inverse binds')
  .setArray(inverseBinds).setType(Accessor.Type.MAT4).setBuffer(sourceRoot.listBuffers()[0]);
skin.setInverseBindMatrices(bindAccessor);

await mkdir(path.dirname(outputFile), { recursive: true });
const recoveredBytes = await io.writeBinary(sourceDoc);
const recoveredDoc = await io.readBinary(recoveredBytes);

const accessorSha = (accessor) => {
  if (!accessor) return null;
  return sha(Buffer.from(accessor.getArray().buffer, accessor.getArray().byteOffset, accessor.getArray().byteLength));
};
const sourceMeshes = sourceRoot.listNodes().filter((node) => node.getMesh());
const recoveredMeshes = recoveredDoc.getRoot().listNodes().filter((node) => node.getMesh());
if (sourceMeshes.length !== recoveredMeshes.length) throw new Error('Mesh count changed while restoring rig binds.');
let triangles = 0, vertices = 0;
for (let nodeIndex = 0; nodeIndex < sourceMeshes.length; nodeIndex++) {
  const sourcePrimitives = sourceMeshes[nodeIndex].getMesh().listPrimitives();
  const recoveredPrimitives = recoveredMeshes[nodeIndex].getMesh().listPrimitives();
  if (sourcePrimitives.length !== recoveredPrimitives.length) throw new Error('Primitive count changed while restoring rig binds.');
  for (let primitiveIndex = 0; primitiveIndex < sourcePrimitives.length; primitiveIndex++) {
    const a = sourcePrimitives[primitiveIndex], b = recoveredPrimitives[primitiveIndex];
    const sourcePosition = a.getAttribute('POSITION'), targetPosition = b.getAttribute('POSITION');
    if (accessorSha(sourcePosition) !== accessorSha(targetPosition)) throw new Error('Source positions changed; geometry is not preserved.');
    if (accessorSha(a.getAttribute('TEXCOORD_0')) !== accessorSha(b.getAttribute('TEXCOORD_0'))) throw new Error('Source UVs changed.');
    if (accessorSha(a.getIndices()) !== accessorSha(b.getIndices())) throw new Error('Source topology/index order changed.');
    vertices += sourcePosition.getCount();
    triangles += (a.getIndices()?.getCount() ?? sourcePosition.getCount()) / 3;
  }
}
const textureHashes = (doc) => doc.getRoot().listTextures().map((texture) => sha(texture.getImage()));
if (JSON.stringify(textureHashes(sourceDoc)) !== JSON.stringify(textureHashes(recoveredDoc))) throw new Error('Source texture maps changed during bind recovery.');
await writeFile(outputFile, recoveredBytes);
const patchedSha = sha(recoveredBytes);

const outputRelative = path.relative(repo, ownerDir).replaceAll('\\', '/');
const imports = await importCreatures({
  output: outputRelative,
  entries: [{
    id: 'creature_cinder_penitent', name: 'Ashbound Votary', source: outputFile,
    expectedSourceSha256: patchedSha, sourceImageId: originalImageId, modelId,
    imageReview: { verdict: 'approved', reviewer: 'Exact-source Astra-low batch review and face_audit_marsh' },
    heightMeters: 2, yawDegrees: 0, orientationVerified: true, requirePbrMaps: true,
    sourceBaseColorMinimumPx: 8192, repairHumanoidWeights: true, retargetHumanoid: true,
  }],
});
const record = imports.imports[0];
if (!record?.readyForLab || record.reasons.length) throw new Error(`Candidate held after import: ${record?.reasons?.join('; ')}`);

const labEntry = { ...imports.assets[0] };
labEntry.file = JSON.parse(await readFile(path.join(repo, 'game/public/assets/manifest.json'), 'utf8'))
  .assets.find((entry) => entry.id === labEntry.id).file;
labEntry.candidateFile = 'models/creature_cinder_penitent.glb';
labEntry.is = 'Ashbound Votary candidate';
labEntry.tags = ['creature', 'humanoid', 'ashlands', 'ashbound-votary', 'tripo', 'root-lab-review'];
labEntry.bounds = { min: record.runtime.bounds.min, max: record.runtime.bounds.max };
labEntry.groundY = 0;
labEntry.sourceProvenance = {
  generator: 'Tripo Studio P1.0 Smart Mesh', imageGenerator: 'Tripo GPT Image 2.5',
  sourceImageId: originalImageId, modelId, originalSourceFile: path.relative(repo, originalFile).replaceAll('\\', '/'),
  originalSourceSha256: originalSha, patchedBindSourceSha256: patchedSha,
  bindPoseReconstruction: {
    sourceSkeleton: 'game/public/assets/models/animation/animation_library_1.glb',
    method: 'Mapped the exact Mixamo hierarchy onto the existing humanoid rig rest pose, fitted bone positions independently to the approved unmodified mesh bounds, and rebuilt inverse binds.',
    scale, meshSize: meshSize.toArray(), sourceMeshGeometryAndUvsPreserved: true,
    noRetopology: true,
  },
  weightRepair: record.weightRepair, retarget: record.retarget,
  runtimeTextures: record.runtime.textures.map((texture) => ({ name: texture.name, role: texture.role, dimensions: [texture.width, texture.height] })),
};
labEntry.metadata = {
  ...labEntry.metadata,
  runtimeTexturePolicy: { maxDimension: 2048, originalsPreserved: true },
  sourceMaterialChannels: ['baseColor', 'normal', 'metallicRoughness'],
  rigPreset: 'Mixamo hierarchy with recovered rest transforms and repaired distributed weights',
  requestedCoreMotions: ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'],
  visualAndMotionAcceptance: 'pending-root-feature-lab-review',
};
labEntry.acceptance = { exported: true, labAccepted: false, worldIntegrated: false };
const labCatalog = {
  schema: 'corealm-lab-asset-candidates/1',
  pack: { id: 'corealm-tripo-creatures', name: 'Corealm Tripo creature candidates', author: 'Corealm', source: 'Tripo Studio generated creatures and Corealm rig adaptation', license: 'LicenseRef-Tripo-Generated' },
  assets: [labEntry],
  files: { [labEntry.id]: labEntry.candidateFile },
};
await writeFile(path.join(ownerDir, 'lab-catalog.json'), `${JSON.stringify(labCatalog, null, 2)}\n`);

record.originalSource = { file: path.relative(repo, originalFile).replaceAll('\\', '/'), sha256: originalSha, modelId, sourceImageId: originalImageId };
record.bindPoseReconstruction = labEntry.sourceProvenance.bindPoseReconstruction;
record.geometryUvTexturePreservation = { triangles, vertices, positions: true, indices: true, uv: true, embeddedTextures: textureHashes(sourceDoc).length, hashesUnchanged: true };
imports.assets[0].sourceProvenance = labEntry.sourceProvenance;
imports.assets[0].candidateFile = labEntry.candidateFile;
await writeFile(path.join(ownerDir, 'catalog.json'), `${JSON.stringify(imports, null, 2)}\n`);
await unlink(outputFile);
console.log(JSON.stringify({ output: outputRelative, assetId: labEntry.id, sourceSha256: originalSha, patchedBindSourceSha256: patchedSha, candidateSha256: labEntry.sha256, triangles, vertices, scale, coreMotions: labEntry.metadata.requestedCoreMotions, clips: labEntry.animations, textureDimensions: labEntry.sourceProvenance.runtimeTextures, readyForLab: true, rootVisualAcceptance: false }, null, 2));
