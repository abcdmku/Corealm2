import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { importCreatures } from '../../../../../../tools/tripo-creatures/import.ts';

const repo = path.resolve(fileURLToPath(new URL('../../../../../../', import.meta.url)));
const ownerDir = path.resolve(repo, 'assets/art/tripo/imports/creatures/starred-grove-guardian');
const originalFile = path.resolve(repo, 'assets/art/tripo/exports/4580db8d-f714-4acf-be53-33a2543e7090.glb');
const candidateFile = path.join(ownerDir, 'models/creature_starroot_guardian.glb');
const originalSha = '47b5d6c821d36620d814d3f79ab073dd81a49dbb5305ba3825c62c48ce0b36f4';
const modelId = '4580db8d-f714-4acf-be53-33a2543e7090';
const sourceImageId = null;
const prompt = 'tree creature with mossy vines, leaf-like back appendages, rugged bark texture, plant-like limbs';
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

const rawBytes = await readFile(originalFile);
if (sha(rawBytes) !== originalSha) throw new Error('The archived Sep 22 #17 Tree Guardian export hash changed.');
const sourceDoc = await io.readBinary(rawBytes);
const sourceRoot = sourceDoc.getRoot();
const sourceSkin = sourceRoot.listSkins()[0];
if (!sourceSkin?.getInverseBindMatrices()) throw new Error('Expected the archived Mixamo-compatible skin and inverse-bind matrices.');
if (sourceRoot.listAnimations().length) throw new Error('The source unexpectedly contains clips; refusing to replace them.');
if (sourceRoot.listSkins().length !== 1) throw new Error('Expected exactly one Tripo skin.');

const sourceMeshes = sourceRoot.listNodes().filter(node => node.getMesh());
if (sourceMeshes.length !== 1 || sourceMeshes[0].getSkin() !== sourceSkin) throw new Error('Expected one skinned source mesh.');
const sourceMesh = sourceMeshes[0];
const sourcePrimitives = sourceMesh.getMesh().listPrimitives();
if (sourcePrimitives.length !== 1) throw new Error('Expected the source guardian mesh to have one primitive.');
const sourcePrimitive = sourcePrimitives[0];
const sourcePosition = sourcePrimitive.getAttribute('POSITION');
const sourceNormal = sourcePrimitive.getAttribute('NORMAL');
const sourceUv = sourcePrimitive.getAttribute('TEXCOORD_0');
const sourceIndices = sourcePrimitive.getIndices();
if (!sourcePosition || !sourceNormal || !sourceUv || !sourceIndices) throw new Error('Missing source positions, normals, UVs, or indices.');
if (sourcePosition.getCount() !== 2828 || sourceIndices.getCount() / 3 !== 4478) throw new Error('Archived #17 topology differs from its approved export ledger.');
const accessorSha = accessor => sha(Buffer.from(accessor.getArray().buffer, accessor.getArray().byteOffset, accessor.getArray().byteLength));
const geometryHashes = {
  positions: accessorSha(sourcePosition), normals: accessorSha(sourceNormal), uvs: accessorSha(sourceUv), indices: accessorSha(sourceIndices),
};
const originalTextureHashes = sourceRoot.listTextures().map(texture => sha(texture.getImage()));

const bounds = new Box3();
const localToWorld = new Matrix4().fromArray(sourceMesh.getWorldMatrix());
for (let index = 0; index < sourcePosition.getCount(); index += 1) {
  bounds.expandByPoint(new Vector3().fromArray(sourcePosition.getElement(index, [])).applyMatrix4(localToWorld));
}
const size = bounds.getSize(new Vector3());
if (Math.abs(size.y - 1) > 0.01 || size.x < 0.65 || size.z < 0.25) throw new Error(`Unexpected source bounds ${size.toArray().join(',')}.`);

const donorFile = path.resolve(repo, 'game/public/assets/models/animation/animation_library_1.glb');
const donorBytes = await readFile(donorFile);
const donorDoc = await io.readBinary(donorBytes);
const donorRoot = donorDoc.getRoot();
const donorSkin = donorRoot.listSkins()[0];
if (!donorSkin) throw new Error('The existing animation library has no humanoid rig.');
const mapping = { Hips: 'pelvis', Spine: 'spine_01', Spine1: 'spine_02', Spine2: 'spine_03', Neck: 'neck_01', Head: 'Head' };
for (const [side, suffix] of [['Left', 'l'], ['Right', 'r']]) {
  for (const [target, donor] of [['Shoulder', 'clavicle'], ['Arm', 'upperarm'], ['ForeArm', 'lowerarm'],
    ['Hand', 'hand'], ['UpLeg', 'thigh'], ['Leg', 'calf'], ['Foot', 'foot'], ['ToeBase', 'ball']]) {
    mapping[`${side}${target}`] = `${donor}_${suffix}`;
  }
  for (const finger of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) {
    for (let segment = 1; segment <= 3; segment += 1) mapping[`${side}Hand${finger}${segment}`] = `${finger.toLowerCase()}_0${segment}_${suffix}`;
  }
  mapping[`${side}Toe_End`] = `ball_leaf_${suffix}`;
}
const donorByName = new Map(donorRoot.listNodes().map(node => [node.getName(), node]));
const donorWorld = new Map();
for (const name of new Set(Object.values(mapping))) {
  const node = donorByName.get(name);
  if (!node) throw new Error(`Missing existing humanoid motion joint ${name}.`);
  donorWorld.set(name, new Matrix4().fromArray(node.getWorldMatrix()));
}
const donorPosition = name => new Vector3().setFromMatrixPosition(donorWorld.get(name));
const footY = (donorPosition('foot_l').y + donorPosition('foot_r').y) / 2;
const pelvisZ = donorPosition('pelvis').z;
const handSpan = donorPosition('hand_l').x - donorPosition('hand_r').x;
const verticalSpan = donorPosition('Head').y - footY;
const donorZ = [...donorWorld.values()].map(matrix => new Vector3().setFromMatrixPosition(matrix).z);
const donorDepth = Math.max(...donorZ) - Math.min(...donorZ);
const fit = { x: size.x / handSpan, y: size.y / verticalSpan, z: size.z / donorDepth };
if (![fit.x, fit.y, fit.z].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid model-to-humanoid bind fit.');

const targets = new Map();
for (const joint of sourceSkin.listJoints()) {
  const name = joint.getName().replace(/^mixamorig:/, '');
  const donorName = mapping[name];
  if (!donorName) throw new Error(`No approved humanoid mapping for ${name}.`);
  const donorMatrix = donorWorld.get(donorName);
  const donorPositionVector = new Vector3();
  const donorRotation = new Quaternion();
  donorMatrix.decompose(donorPositionVector, donorRotation, new Vector3());
  const targetPosition = new Vector3(
    donorPositionVector.x * fit.x,
    bounds.min.y + (donorPositionVector.y - footY) * fit.y,
    (donorPositionVector.z - pelvisZ) * fit.z,
  );
  targets.set(joint, new Matrix4().compose(targetPosition, donorRotation, new Vector3(1, 1, 1)));
}
const depthOf = node => node.getParentNode() ? 1 + depthOf(node.getParentNode()) : 0;
for (const joint of [...sourceSkin.listJoints()].sort((a, b) => depthOf(a) - depthOf(b))) {
  const parent = joint.getParentNode();
  const parentWorld = parent ? targets.get(parent) ?? new Matrix4().fromArray(parent.getWorldMatrix()) : new Matrix4();
  joint.setMatrix(parentWorld.clone().invert().multiply(targets.get(joint)).toArray());
}
const inverseBinds = new Float32Array(sourceSkin.listJoints().length * 16);
sourceSkin.listJoints().forEach((joint, index) => inverseBinds.set(targets.get(joint).clone().invert().toArray(), index * 16));
sourceSkin.setInverseBindMatrices(sourceDoc.createAccessor('Starroot Guardian recovered Mixamo inverse binds')
  .setArray(inverseBinds).setType(Accessor.Type.MAT4).setBuffer(sourceRoot.listBuffers()[0]));

const recoveredDirectory = path.join(ownerDir, 'sources');
await mkdir(recoveredDirectory, { recursive: true });
const recoveredBytes = await io.writeBinary(sourceDoc);
const recoveredDoc = await io.readBinary(recoveredBytes);
const recoveredSha = sha(recoveredBytes);
const recoveredFile = path.join(recoveredDirectory, `creature_starroot_guardian-${recoveredSha.slice(0, 12)}.glb`);
const recoveredMesh = recoveredDoc.getRoot().listNodes().find(node => node.getMesh());
const recoveredPrimitive = recoveredMesh.getMesh().listPrimitives()[0];
for (const [semantic, hash] of [['POSITION', geometryHashes.positions], ['NORMAL', geometryHashes.normals],
  ['TEXCOORD_0', geometryHashes.uvs]]) {
  if (accessorSha(recoveredPrimitive.getAttribute(semantic)) !== hash) throw new Error(`${semantic} changed during bind recovery.`);
}
if (accessorSha(recoveredPrimitive.getIndices()) !== geometryHashes.indices) throw new Error('Source topology/index order changed during bind recovery.');
if (JSON.stringify(recoveredDoc.getRoot().listTextures().map(texture => sha(texture.getImage()))) !== JSON.stringify(originalTextureHashes)) {
  throw new Error('Source image maps changed during bind recovery.');
}
await writeFile(recoveredFile, recoveredBytes);

const imported = await importCreatures({
  output: path.relative(repo, ownerDir).replaceAll('\\', '/'),
  entries: [{
    id: 'creature_starroot_guardian',
    name: 'Starroot Guardian',
    source: recoveredFile,
    expectedSourceSha256: recoveredSha,
    sourceImageId,
    modelId,
    imageReview: { verdict: 'approved', reviewer: 'User-selected starred #17; exact prompt and export ledger preserved in candidate provenance' },
    heightMeters: 2.7,
    yawDegrees: 0,
    orientationVerified: true,
    requirePbrMaps: true,
    sourceBaseColorMinimumPx: 8192,
    repairHumanoidWeights: true,
    retargetHumanoid: true,
  }],
});
const record = imported.imports[0];
if (!record?.readyForLab || record.reasons.length) throw new Error(`Candidate was held: ${record?.reasons?.join('; ')}`);
const candidateBytes = await readFile(candidateFile);
const candidateDoc = await io.readBinary(candidateBytes);
const candidateMesh = candidateDoc.getRoot().listNodes().find(node => node.getMesh());
const candidatePrimitive = candidateMesh.getMesh().listPrimitives()[0];
for (const [semantic, hash] of [['POSITION', geometryHashes.positions], ['NORMAL', geometryHashes.normals], ['TEXCOORD_0', geometryHashes.uvs]]) {
  if (accessorSha(candidatePrimitive.getAttribute(semantic)) !== hash) throw new Error(`Candidate ${semantic} accessor changed.`);
}
if (accessorSha(candidatePrimitive.getIndices()) !== geometryHashes.indices) throw new Error('Candidate source topology/index order changed.');
const textureDimensions = [];
for (const texture of candidateDoc.getRoot().listTextures()) {
  const { default: sharp } = await import('sharp');
  const metadata = await sharp(texture.getImage()).metadata();
  if (metadata.width > 2048 || metadata.height > 2048) throw new Error(`Runtime map exceeds 2K: ${texture.getName()} ${metadata.width}x${metadata.height}.`);
  textureDimensions.push({ name: texture.getName(), width: metadata.width, height: metadata.height, mimeType: texture.getMimeType() });
}
if (textureDimensions.length !== 3) throw new Error('Expected preserved base-color, packed metallic-roughness, and normal maps.');
if (candidateDoc.getRoot().listAnimations().filter(clip => ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'].includes(clip.getName())).length !== 6) {
  throw new Error('Expected the six core creature motion clips.');
}

const labEntry = { ...imported.assets[0] };
labEntry.file = 'models/fairy-crown/creature_starroot_guardian.glb';
labEntry.candidateFile = 'models/creature_starroot_guardian.glb';
labEntry.is = 'Starroot Guardian candidate from starred #17 Tree Guardian';
labEntry.tags = ['creature', 'fairy', 'faeholme', 't60', 'starred', 'tree-guardian', 'skinned', 'articulated', 'tripo', 'root-lab-review'];
labEntry.bounds = { min: record.runtime.bounds.min, max: record.runtime.bounds.max };
labEntry.groundY = 0;
labEntry.sourceProvenance = {
  generator: 'Tripo Studio P2.0 Smart Mesh',
  modelId,
  sourceImageId,
  originalSourceFile: path.relative(repo, originalFile).replaceAll('\\', '/'),
  originalSourceSha256: originalSha,
  sourceLedger: 'assets/art/tripo/starred-export-middle.json, starredOrder 17',
  sourcePrompt: prompt,
  laterSameIdRevisionExcluded: 'Root Tender R3 in creatures-fairy.json is a separate later image/prompt revision and is not the source of this candidate.',
  bindRecoveredSource: path.relative(repo, recoveredFile).replaceAll('\\', '/'),
  bindRecoveredSourceSha256: recoveredSha,
  bindPoseReconstruction: {
    sourceSkeleton: path.relative(repo, donorFile).replaceAll('\\', '/'),
    sourceSkeletonSha256: sha(donorBytes),
    method: 'Fitted the existing Mixamo hierarchy to the archived mesh bounds, reconstructed local rest transforms, and rebuilt inverse binds; source positions, normals, indices, and UVs are byte-preserved.',
    scale: fit,
    sourceMeshGeometryAndUvsPreserved: true,
    noRetopology: true,
  },
  weightRepair: record.weightRepair,
  retarget: record.retarget,
  runtimeTextures: textureDimensions,
  sourceTextureHashesPreservedThroughBindRecovery: originalTextureHashes,
};
labEntry.metadata = {
  ...labEntry.metadata,
  runtimeTexturePolicy: { maxDimension: 2048, originalsPreserved: true },
  sourceMaterialChannels: ['baseColor', 'normal', 'metallicRoughness'],
  rigPreset: 'Recovered Mixamo humanoid hierarchy with distributed anatomical weights fitted to the tree creature',
  requestedCoreMotions: ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'],
  role: { region: 'faeholme', tier: 60, level: 66, currentForm: 'Starroot Guardian' },
  visualAndMotionAcceptance: 'pending-root-feature-lab-review',
};
labEntry.acceptance = { exported: true, labAccepted: false, worldIntegrated: false };
const labCatalog = {
  schema: 'corealm-lab-asset-candidates/1',
  pack: { id: 'corealm-tripo-creatures', name: 'Corealm Tripo creature candidates', author: 'Corealm', source: 'Tripo Studio starred export with Corealm rig adaptation', license: 'LicenseRef-Tripo-Generated' },
  assets: [labEntry],
  files: { [labEntry.id]: labEntry.candidateFile },
};
await writeFile(path.join(ownerDir, 'lab-catalog.json'), `${JSON.stringify(labCatalog, null, 2)}\n`);

record.originalSource = { file: path.relative(repo, originalFile).replaceAll('\\', '/'), sha256: originalSha, modelId, sourceImageId, prompt, ledger: 'assets/art/tripo/starred-export-middle.json#starredOrder17' };
record.bindPoseReconstruction = labEntry.sourceProvenance.bindPoseReconstruction;
record.geometryUvPreservation = { vertices: sourcePosition.getCount(), triangles: sourceIndices.getCount() / 3, accessorSha256: geometryHashes, unchanged: true, noRetopology: true };
record.runtimePbrMaps = textureDimensions;
record.candidateFile = labEntry.candidateFile;
record.role = labEntry.metadata.role;
record.acceptance = { sourceSelectedByUser: true, rigAndMotion: 'pending-root-lab-review', textureResponse: 'pending-root-lab-review', labAccepted: false, worldIntegrated: false };
imported.assets[0].sourceProvenance = labEntry.sourceProvenance;
imported.assets[0].candidateFile = labEntry.candidateFile;
await writeFile(path.join(ownerDir, 'catalog.json'), `${JSON.stringify(imported, null, 2)}\n`);

console.log(JSON.stringify({
  source: path.relative(repo, originalFile).replaceAll('\\', '/'), originalSha,
  recoveredSource: path.relative(repo, recoveredFile).replaceAll('\\', '/'), recoveredSha,
  candidate: path.relative(repo, candidateFile).replaceAll('\\', '/'), candidateSha256: sha(candidateBytes), bytes: candidateBytes.length,
  id: labEntry.id, role: labEntry.metadata.role, vertices: sourcePosition.getCount(), triangles: sourceIndices.getCount() / 3,
  geometryPreserved: geometryHashes, runtimeTextures: textureDimensions,
  weights: record.weightRepair, clips: record.retarget.clips.map(clip => clip.name), labCatalog: path.relative(repo, path.join(ownerDir, 'lab-catalog.json')).replaceAll('\\', '/'),
  rootLabReview: 'pending',
}, null, 2));
