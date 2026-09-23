import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { Box3, Matrix4, Vector3 } from 'three';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../../');
const sourceFile = path.join(repo, 'assets/art/tripo/exports/0956205f-6d69-4216-b4ef-afdb3fe2db07.glb');
const expectedSourceSha256 = '05d9f5c1fcd1d7a7a04978ea00d9cae50c7b2d214a1cce9ee4f3038a97ce7f64';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

const parts = [
  { id: 'part-01-red-bone-mask-imp', label: 'Red bone-mask imp', row: 1, column: 1 },
  { id: 'part-02-lavender-bat-ear-imp', label: 'Lavender bat-ear imp', row: 1, column: 2 },
  { id: 'part-03-green-antler-imp', label: 'Green antler/leaf imp', row: 1, column: 3 },
  { id: 'part-04-magma-imp', label: 'Magma imp', row: 2, column: 1 },
  { id: 'part-05-ivory-bone-imp', label: 'Ivory bone imp', row: 2, column: 2 },
  { id: 'part-06-purple-cyclops-imp', label: 'Purple cyclops', row: 2, column: 3 },
  { id: 'part-07-blue-crystal-imp', label: 'Blue crystal imp', row: 3, column: 1 },
  { id: 'part-08-rust-iron-spike-imp', label: 'Rust/iron spike imp', row: 3, column: 2 },
  { id: 'part-09-yellow-green-spore-imp', label: 'Yellow-green spore imp', row: 3, column: 3 },
];
const expectedTriangles = [1720, 958, 2823, 1522, 2476, 2217, 2150, 2197, 3473];
const maxTextureDimension = 2048;

function hashTypedArray(array) {
  return sha(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
}

function accessorBytes(accessor) {
  const array = accessor.getArray();
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function kMeans(values, count) {
  const sorted = [...values].sort((a, b) => a - b);
  let centers = [0.16, 0.5, 0.84].slice(0, count).map(q => sorted[Math.floor((sorted.length - 1) * q)]);
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const sums = Array(count).fill(0), sizes = Array(count).fill(0);
    for (const value of values) {
      let nearest = 0;
      for (let i = 1; i < count; i += 1) if (Math.abs(value - centers[i]) < Math.abs(value - centers[nearest])) nearest = i;
      sums[nearest] += value;
      sizes[nearest] += 1;
    }
    if (sizes.some(size => size === 0)) throw new Error('Spatial grouping produced an empty row or column.');
    const next = sums.map((sum, i) => sum / sizes[i]).sort((a, b) => a - b);
    const delta = Math.max(...next.map((value, i) => Math.abs(value - centers[i])));
    centers = next;
    if (delta < 1e-9) break;
  }
  return centers;
}

function nearest(value, centers) {
  let index = 0;
  for (let i = 1; i < centers.length; i += 1) if (Math.abs(value - centers[i]) < Math.abs(value - centers[index])) index = i;
  return index;
}

const sourceBytes = await readFile(sourceFile);
const sourceSha256 = sha(sourceBytes);
if (sourceSha256 !== expectedSourceSha256) throw new Error(`Source SHA-256 mismatch: ${sourceSha256}`);
const sourceDoc = await io.readBinary(sourceBytes);
const sourceRoot = sourceDoc.getRoot();
const scene = sourceRoot.getDefaultScene() ?? sourceRoot.listScenes()[0];
const meshNodes = sourceRoot.listNodes().filter(node => node.getMesh());
if (!scene || sourceRoot.listScenes().length !== 1 || meshNodes.length !== 1 || sourceRoot.listMeshes().length !== 1 ||
  sourceRoot.listSkins().length !== 0 || sourceRoot.listAnimations().length !== 0) {
  throw new Error('Expected the verified single-scene, single-mesh, unskinned A source without clips.');
}
const sourceNode = meshNodes[0];
if (sourceNode.getTranslation().some(value => Math.abs(value) > 1e-8) || sourceNode.getRotation().some((value, index) => Math.abs(value - [0, 0, 0, 1][index]) > 1e-8) ||
  sourceNode.getScale().some(value => Math.abs(value - 1) > 1e-8)) {
  throw new Error('Source mesh transform changed; inspect before extracting in local coordinates.');
}
const sourceMesh = sourceNode.getMesh();
const sourcePrimitives = sourceMesh.listPrimitives();
if (sourcePrimitives.length !== 1) throw new Error(`Expected one primitive, found ${sourcePrimitives.length}.`);
const sourcePrimitive = sourcePrimitives[0];
const sourcePosition = sourcePrimitive.getAttribute('POSITION');
const sourceNormal = sourcePrimitive.getAttribute('NORMAL');
const sourceUv = sourcePrimitive.getAttribute('TEXCOORD_0');
const sourceIndices = sourcePrimitive.getIndices();
if (!sourcePosition || !sourceNormal || !sourceUv || !sourceIndices || sourceIndices.getCount() / 3 !== 19536 || sourcePosition.getCount() !== 34977) {
  throw new Error('Source geometry differs from the audited 34,977-vertex / 19,536-face grid.');
}
if (!sourcePrimitive.getMaterial() || sourceRoot.listMaterials().length !== 1 || sourceRoot.listTextures().length !== 3) {
  throw new Error('Expected the single source material and three embedded PBR maps.');
}

const positions = sourcePosition.getArray();
const normals = sourceNormal.getArray();
const uvs = sourceUv.getArray();
const sourceIndexValues = sourceIndices.getArray();
const triangles = [];
for (let face = 0; face < sourceIndexValues.length / 3; face += 1) {
  const vertexIds = [sourceIndexValues[face * 3], sourceIndexValues[face * 3 + 1], sourceIndexValues[face * 3 + 2]];
  const center = [0, 0, 0];
  for (const vertexId of vertexIds) for (let axis = 0; axis < 3; axis += 1) center[axis] += positions[vertexId * 3 + axis] / 3;
  triangles.push({ face, vertexIds, center });
}
const xCenters = kMeans(triangles.map(triangle => triangle.center[0]), 3);
const yCenters = kMeans(triangles.map(triangle => triangle.center[1]), 3);
const buckets = Array.from({ length: 9 }, () => []);
for (const triangle of triangles) {
  const column = nearest(triangle.center[0], xCenters);
  const yBand = nearest(triangle.center[1], yCenters);
  const rowFromTop = 2 - yBand;
  buckets[rowFromTop * 3 + column].push(triangle);
}
for (let index = 0; index < parts.length; index += 1) {
  if (buckets[index].length !== expectedTriangles[index]) {
    throw new Error(`${parts[index].id} triangle count changed: ${buckets[index].length}, expected ${expectedTriangles[index]}.`);
  }
}
if (buckets.reduce((sum, bucket) => sum + bucket.length, 0) !== triangles.length) throw new Error('A source triangle was dropped or duplicated.');

const sourceMaterials = sourceRoot.listMaterials().map(material => ({
  name: material.getName(),
  baseColorTexture: material.getBaseColorTexture()?.getName() ?? null,
  normalTexture: material.getNormalTexture()?.getName() ?? null,
  metallicRoughnessTexture: material.getMetallicRoughnessTexture()?.getName() ?? null,
  baseColorFactor: material.getBaseColorFactor(),
  metallicFactor: material.getMetallicFactor(),
  roughnessFactor: material.getRoughnessFactor(),
}));
const sourceTextures = await Promise.all(sourceRoot.listTextures().map(async texture => {
  const bytes = texture.getImage();
  const metadata = await sharp(bytes).metadata();
  return { name: texture.getName(), mimeType: texture.getMimeType(), width: metadata.width, height: metadata.height, bytes: bytes.length, sha256: sha(bytes) };
}));

const partRecords = [];
for (let index = 0; index < parts.length; index += 1) {
  const part = parts[index];
  const bucket = buckets[index];
  const vertexMap = new Map();
  const originalVertexIds = [];
  const mappedIndices = [];
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const sourceTriangleHash = createHash('sha256');
  const sourceMeshArrays = { POSITION: [], NORMAL: [], TEXCOORD_0: [] };
  for (const triangle of bucket) {
    for (const vertexId of triangle.vertexIds) {
      sourceTriangleHash.update(Buffer.from(positions.buffer, positions.byteOffset + vertexId * 12, 12));
      sourceTriangleHash.update(Buffer.from(normals.buffer, normals.byteOffset + vertexId * 12, 12));
      sourceTriangleHash.update(Buffer.from(uvs.buffer, uvs.byteOffset + vertexId * 8, 8));
      let mapped = vertexMap.get(vertexId);
      if (mapped === undefined) {
        mapped = originalVertexIds.length;
        vertexMap.set(vertexId, mapped);
        originalVertexIds.push(vertexId);
        for (let axis = 0; axis < 3; axis += 1) {
          const value = positions[vertexId * 3 + axis];
          sourceMeshArrays.POSITION.push(value);
          sourceMeshArrays.NORMAL.push(normals[vertexId * 3 + axis]);
          bounds.min[axis] = Math.min(bounds.min[axis], value);
          bounds.max[axis] = Math.max(bounds.max[axis], value);
        }
        sourceMeshArrays.TEXCOORD_0.push(uvs[vertexId * 2], uvs[vertexId * 2 + 1]);
      }
      mappedIndices.push(mapped);
    }
  }
  const partHeight = bounds.max[1] - bounds.min[1];
  if (!(partHeight > 0)) throw new Error(`${part.id} has no vertical extent.`);
  const scale = 1 / partHeight;
  const centerX = (bounds.min[0] + bounds.max[0]) / 2;
  const centerZ = (bounds.min[2] + bounds.max[2]) / 2;

  const doc = await io.readBinary(sourceBytes);
  const root = doc.getRoot();
  const meshNode = root.listNodes().find(node => node.getMesh());
  const primitive = meshNode.getMesh().listPrimitives()[0];
  const buffer = root.listBuffers()[0];
  for (const [semantic, values, type] of [
    ['POSITION', sourceMeshArrays.POSITION, 'VEC3'],
    ['NORMAL', sourceMeshArrays.NORMAL, 'VEC3'],
    ['TEXCOORD_0', sourceMeshArrays.TEXCOORD_0, 'VEC2'],
  ]) {
    const previous = primitive.getAttribute(semantic);
    const accessor = doc.createAccessor(`${part.id} source-preserved ${semantic}`)
      .setBuffer(buffer).setType(type).setArray(Float32Array.from(values));
    primitive.setAttribute(semantic, accessor);
    previous.dispose();
  }
  const previousIndices = primitive.getIndices();
  const indexArray = originalVertexIds.length <= 65535 ? Uint16Array.from(mappedIndices) : Uint32Array.from(mappedIndices);
  primitive.setIndices(doc.createAccessor(`${part.id} extracted source triangle order`)
    .setBuffer(buffer).setType('SCALAR').setArray(indexArray));
  previousIndices.dispose();
  meshNode.setName(`${part.id} source mesh`).setScale([scale, scale, scale])
    .setTranslation([-centerX * scale, -bounds.min[1] * scale, -centerZ * scale]);
  for (const texture of root.listTextures()) {
    const image = texture.getImage();
    const metadata = await sharp(image).metadata();
    if (Math.max(metadata.width ?? 0, metadata.height ?? 0) <= maxTextureDimension) continue;
    const resize = sharp(image).resize({ width: maxTextureDimension, height: maxTextureDimension, fit: 'inside', withoutEnlargement: true });
    const jpeg = texture.getMimeType() === 'image/jpeg';
    texture.setImage(await (jpeg ? resize.jpeg({ quality: 92, chromaSubsampling: '4:4:4' }) : resize.png()).toBuffer())
      .setMimeType(jpeg ? 'image/jpeg' : 'image/png');
  }

  const outputBytes = await io.writeBinary(doc);
  const checked = await io.readBinary(outputBytes);
  const checkedRoot = checked.getRoot();
  const checkedPrimitive = checkedRoot.listMeshes()[0].listPrimitives()[0];
  const checkedNode = checkedRoot.listNodes().find(node => node.getMesh());
  const checkedPosition = checkedPrimitive.getAttribute('POSITION').getArray();
  const checkedNormal = checkedPrimitive.getAttribute('NORMAL').getArray();
  const checkedUv = checkedPrimitive.getAttribute('TEXCOORD_0').getArray();
  const checkedIndices = checkedPrimitive.getIndices().getArray();
  const candidateTriangleHash = createHash('sha256');
  for (let cursor = 0; cursor < checkedIndices.length; cursor += 1) {
    const vertexId = checkedIndices[cursor];
    candidateTriangleHash.update(Buffer.from(checkedPosition.buffer, checkedPosition.byteOffset + vertexId * 12, 12));
    candidateTriangleHash.update(Buffer.from(checkedNormal.buffer, checkedNormal.byteOffset + vertexId * 12, 12));
    candidateTriangleHash.update(Buffer.from(checkedUv.buffer, checkedUv.byteOffset + vertexId * 8, 8));
  }
  const sourceTriangleAttributesSha256 = sourceTriangleHash.digest('hex');
  const candidateTriangleAttributesSha256 = candidateTriangleHash.digest('hex');
  if (sourceTriangleAttributesSha256 !== candidateTriangleAttributesSha256) throw new Error(`${part.id} changed a source triangle position, normal or UV value.`);
  const runtimeBounds = new Box3();
  const nodeMatrix = new Matrix4().fromArray(checkedNode.getWorldMatrix());
  for (let vertex = 0; vertex < checkedPosition.length / 3; vertex += 1) {
    runtimeBounds.expandByPoint(new Vector3().fromArray(checkedPosition, vertex * 3).applyMatrix4(nodeMatrix));
  }
  const runtimeSize = runtimeBounds.getSize(new Vector3());
  if (Math.abs(runtimeBounds.min.y) > 1e-5 || Math.abs(runtimeBounds.max.y - 1) > 1e-5 ||
    Math.abs(runtimeBounds.min.x + runtimeBounds.max.x) > 1e-5 || Math.abs(runtimeBounds.min.z + runtimeBounds.max.z) > 1e-5 ||
    !(runtimeSize.x > 0 && runtimeSize.z > 0)) {
    throw new Error(`${part.id} output is not centered at ground level with a 1 m height.`);
  }
  const runtimeTextures = await Promise.all(checkedRoot.listTextures().map(async texture => {
    const metadata = await sharp(texture.getImage()).metadata();
    if (Math.max(metadata.width ?? 0, metadata.height ?? 0) > maxTextureDimension) throw new Error(`${part.id} retained a map larger than 2K.`);
    return { name: texture.getName(), mimeType: texture.getMimeType(), width: metadata.width, height: metadata.height, bytes: texture.getImage().length, sha256: sha(texture.getImage()) };
  }));
  if (checkedIndices.length / 3 !== expectedTriangles[index] || checkedPosition.length / 3 !== originalVertexIds.length || runtimeTextures.length !== 3) {
    throw new Error(`${part.id} output failed its geometry or PBR-map count check.`);
  }
  const file = `${part.id}/base.glb`;
  const outputFile = path.join(here, file);
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, outputBytes);
  partRecords.push({
    id: part.id,
    label: part.label,
    row: part.row,
    column: part.column,
    candidateFile: `assets/art/tripo/imports/creatures/starred-sheet-a/${file}`,
    candidateBytes: outputBytes.length,
    candidateSha256: sha(outputBytes),
    vertices: originalVertexIds.length,
    triangles: bucket.length,
    sourceBounds: bounds,
    normalizedNodeTransform: { scale: Number(scale.toFixed(8)), translation: [-centerX * scale, -bounds.min[1] * scale, -centerZ * scale], resultingHeightMeters: 1 },
    runtimeBounds: { min: runtimeBounds.min.toArray(), max: runtimeBounds.max.toArray() },
    sourceTriangleAttributesSha256,
    candidateTriangleAttributesSha256,
    sourceTopology: { facesPreserved: true, retopology: false, triangleOrderPreserved: true, positionsPreserved: true, normalsPreserved: true, uvsPreserved: true },
    sourceMaterialNames: [sourcePrimitive.getMaterial().getName()],
    runtimeTextures,
  });
}

for (const record of partRecords) {
  const partDirectory = path.join(here, record.id);
  // The two possible rigging report names are owned by the per-part riggers.
  let reportFile = null;
  for (const name of ['rigging-verification.json', 'rigging-provenance.json']) {
    try { await readFile(path.join(partDirectory, name)); reportFile = path.join(partDirectory, name); break; } catch { /* no rig report for this part yet */ }
  }
  if (!reportFile) continue;
  const report = JSON.parse(await readFile(reportFile, 'utf8'));
  const reportCandidate = report.candidate ?? {};
  const reportedFile = reportCandidate.file ?? 'rigged-candidate.glb';
  const candidateFile = reportedFile.startsWith('assets/')
    ? path.join(repo, reportedFile)
    : path.join(partDirectory, path.basename(reportedFile));
  const candidateBytes = await readFile(candidateFile);
  const candidateSha256 = sha(candidateBytes);
  const expectedCandidateSha256 = reportCandidate.sha256 ?? report.candidateSha256;
  if (expectedCandidateSha256 && expectedCandidateSha256 !== candidateSha256) {
    throw new Error(`${record.id} rigged candidate hash differs from its rig report.`);
  }
  const reportedSourceSha256 = report.source?.sha256 ?? report.sourceSha256;
  if (reportedSourceSha256 && reportedSourceSha256 !== sha(await readFile(path.join(here, `${record.id}/base.glb`)))) {
    throw new Error(`${record.id} rig report points at a different extracted base.`);
  }
  const rig = report.rig ?? {};
  const jointCount = typeof rig.jointCount === 'number' ? rig.jointCount
    : Array.isArray(rig.joints) ? rig.joints.length
      : typeof rig.joints === 'number' ? rig.joints : null;
  const motionRecords = report.candidate?.animationClips ?? report.motions?.durations ?? report.animations ?? [];
  const riggedClips = motionRecords.map(clip => {
    const detailed = report.motions?.clips?.find(candidate => candidate.name === clip.name);
    return { name: clip.name, seconds: clip.seconds ?? clip.duration, channels: clip.channels ?? detailed?.channels ?? null };
  });
  const sourceGeometryHashes = report.sourceGeometryHashes ?? report.source?.geometryHashes;
  const outputGeometryHashes = report.outputGeometryHashes ?? report.candidate?.geometryHashes;
  const exactHashes = sourceGeometryHashes && outputGeometryHashes &&
    JSON.stringify(sourceGeometryHashes) === JSON.stringify(outputGeometryHashes);
  const geometryPreserved = report.candidate?.sourceGeometryPreserved ?? report.verification?.geometryExact ?? exactHashes ??
    (report.candidate?.triangleCornerAttributesSha256 && report.source?.triangleCornerAttributesSha256
      ? report.candidate.triangleCornerAttributesSha256 === report.source.triangleCornerAttributesSha256 : null);
  const runtimeTextureRecords = report.maps?.maps ?? report.candidate?.textures ?? report.textures?.runtime ??
    report.runtimeTextures ?? report.textures ?? report.source?.textures ?? [];
  const scaleReview = report.scaleReview ?? {};
  const outputBounds = scaleReview.groundedOutputBounds ?? scaleReview.bindOutputBounds ?? scaleReview.outputBounds ?? report.normalization?.outputBounds ??
    report.worldTransform?.candidateBounds ?? report.rig?.bindBounds ?? null;
  const measuredHeightMeters = scaleReview.measuredOutputHeightMeters ?? scaleReview.heightMeters ?? report.normalization?.outputHeight ??
    report.worldTransform?.height ?? (outputBounds
      ? outputBounds.max[1] - outputBounds.min[1]
      : null);
  const targetHeightMeters = scaleReview.targetHeightMeters ?? report.normalization?.targetHeightMeters ??
    report.worldTransform?.targetHeightMeters ?? measuredHeightMeters;
  const motionBounds = scaleReview.perClipAnimatedBounds ?? scaleReview.animatedClips ?? scaleReview.clips ?? scaleReview.perClipBounds ?? report.motionBounds ??
    report.motions?.perClipBounds ?? report.motions?.clips ?? null;
  record.riggedCandidate = {
    file: path.relative(repo, candidateFile).replaceAll('\\', '/'),
    sha256: candidateSha256,
    bytes: candidateBytes.length,
    rigReport: path.relative(repo, reportFile).replaceAll('\\', '/'),
    joints: jointCount,
    clips: riggedClips,
    scale: {
      targetHeightMeters,
      measuredHeightMeters,
      grounded: scaleReview.grounded ?? report.normalization?.grounded ??
        report.worldTransform?.centeredGroundedOneMeter ?? null,
      sixClipGroundingVerified: scaleReview.clipsGrounded ?? scaleReview.groundedAllClips ??
        (motionBounds ? scaleReview.grounded ?? null : null),
      outputBounds,
      motionBounds,
    },
    geometryPreserved: geometryPreserved === true,
    textureMaxDimension: report.maps?.maxDimension ?? Math.max(0, ...runtimeTextureRecords
      .map(texture => Math.max(texture.width ?? texture[0] ?? 0, texture.height ?? texture[1] ?? 0))),
    review: 'pending-root-visual-motion-lab-acceptance',
  };
}

const riggedPartCount = partRecords.filter(part => part.riggedCandidate).length;

const ledger = {
  schema: 'corealm-starred-sheet-extraction/1',
  source: {
    file: 'assets/art/tripo/exports/0956205f-6d69-4216-b4ef-afdb3fe2db07.glb',
    sha256: sourceSha256,
    bytes: sourceBytes.length,
    starredProjectId: '0956205f-6d69-4216-b4ef-afdb3fe2db07',
    geometry: { nodes: 1, meshes: 1, primitives: 1, sourceVertices: sourcePosition.getCount(), sourceTriangles: sourceIndices.getCount() / 3, skins: 0, clips: 0, retopology: false },
    sourceMaterials,
    sourceTextures,
  },
  extraction: {
    method: 'Partition source triangles by nearest X/Y cell center after deterministic three-cluster 1D k-means. Grid axes are X columns and Y-up rows; output order is the visually audited front view from top-left to bottom-right.',
    cellCenters: { xAscending: xCenters, yAscending: yCenters },
    faceAssignment: 'Each source triangle is assigned once by its centroid. Each candidate remaps only referenced source vertices while preserving each source triangle corner sequence and exact position, normal, and UV values.',
    runtimeTexturePolicy: { maxDimension: maxTextureDimension, sourceMapPixelsArchivedInSourceGlb: true, candidateMapsAreResizedCopies: true },
    noSkinOrAnimationClaim: true,
  },
  parts: partRecords,
  totalTriangles: partRecords.reduce((sum, part) => sum + part.triangles, 0),
  preliminaryDesignReview: {
    status: 'root-decision-pending',
    recommendation: 'Hold A for the serious RPG direction: oversized grins/eyes and a repeated cartoon imp template.',
    reviewer: 'new-sheet visual audit',
  },
  acceptance: {
    extracted: true,
    riggedCandidates: `${riggedPartCount}/9 staged`,
    animationClips: `${riggedPartCount}/9 staged`,
    rootVisualMotionLab: 'pending',
    worldIntegrated: false,
  },
  };
await writeFile(path.join(here, 'extraction-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ sourceSha256, parts: partRecords.map(({ id, triangles, vertices, candidateFile }) => ({ id, triangles, vertices, candidateFile })), totalTriangles: ledger.totalTriangles }, null, 2));
