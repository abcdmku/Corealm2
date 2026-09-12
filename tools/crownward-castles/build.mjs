/** Fetch and stage the two accepted CreativeTrio castle candidates without changing their GLBs. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(directory, '../..');
const outputRoot = path.join(repositoryRoot, 'test-results/crownward-castles');
const modelRoot = path.join(outputRoot, 'models/crownward-castles');
const sourceRoot = path.join(outputRoot, 'sources');
const previewRoot = path.join(outputRoot, 'source-previews');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const round = number => Math.round(number * 1e6) / 1e6;
const vector = values => ({ x: round(values[0]), y: round(values[1]), z: round(values[2]) });

function parseGlb(bytes, label) {
  assert(bytes.length >= 28 && bytes.toString('ascii', 0, 4) === 'glTF', `${label}: expected GLB`);
  assert.equal(bytes.readUInt32LE(4), 2, `${label}: expected GLB 2`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${label}: incomplete GLB`);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, `${label}: expected JSON-first GLB`);
  const jsonLength = bytes.readUInt32LE(12);
  const tailOffset = 20 + jsonLength;
  assert.equal(bytes.readUInt32LE(tailOffset + 4), 0x004e4942, `${label}: expected embedded BIN chunk`);
  return { json: JSON.parse(bytes.subarray(20, tailOffset).toString('utf8')), tail: bytes.subarray(tailOffset) };
}

function writeGlb(json, tail) {
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const paddedJson = Buffer.alloc((jsonBytes.length + 3) & ~3, 0x20);
  jsonBytes.copy(paddedJson);
  const header = Buffer.alloc(20);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + paddedJson.length + tail.length, 8);
  header.writeUInt32LE(paddedJson.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, paddedJson, tail]);
}

function normalizedGlb(sourceBytes, sourceBounds, label) {
  const parsed = parseGlb(sourceBytes, label);
  const json = structuredClone(parsed.json);
  const scene = json.scenes?.[json.scene ?? 0];
  assert.equal(scene?.nodes?.length, 1, `${label}: expected one scene root`);
  const rootNode = json.nodes?.[scene.nodes[0]];
  assert(rootNode && !rootNode.mesh, `${label}: expected a transform-only scene root`);
  assert(!rootNode.matrix, `${label}: scene root matrix changed upstream`);
  assert.deepEqual(rootNode.rotation ?? [0, 0, 0, 1], [0, 0, 0, 1], `${label}: scene root rotation changed upstream`);
  assert.deepEqual(rootNode.scale ?? [1, 1, 1], [1, 1, 1], `${label}: scene root scale changed upstream`);
  const centerX = (sourceBounds.min[0] + sourceBounds.max[0]) * 0.5;
  const centerZ = (sourceBounds.min[2] + sourceBounds.max[2]) * 0.5;
  rootNode.translation = [-centerX, -sourceBounds.min[1], -centerZ];
  rootNode.extras = {
    ...(rootNode.extras ?? {}),
    corealmNormalization: { centerXZ: true, baseY: 0, front: '+Z', yawRadians: 0 },
  };
  return { bytes: writeGlb(json, parsed.tail), sourceBinSha256: sha256(parsed.tail) };
}

const sharedPalette = {
  name: 'Diffuse_palette_2.jpg',
  sha256: '858d426dc2fa507874c2578c3ec3bc706c23c428fdfcfe06909aadba6c27b5da',
  dimensions: [256, 256],
  note: 'Both models share this embedded 8-by-8 swatch atlas. A later selective swatch remap can make the stone warm ivory while retaining the brown roof swatches and their contrast.',
};

const commonPack = {
  author: 'CreativeTrio',
  license: 'CC0-1.0',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  sourceHost: 'Poly Pizza',
  sharedPalette,
};

const plans = [
  {
    id: 'crownward_premade_fortress',
    packId: 'creative-trio-fortress-source-glb',
    title: 'Fortress',
    pageUrl: 'https://poly.pizza/m/HZPOZU2NiM',
    downloadUrl: 'https://static.poly.pizza/2fe2f6c8-717d-4ad6-9a27-21ec15d57fbf.glb',
    previewUrl: 'https://static.poly.pizza/2fe2f6c8-717d-4ad6-9a27-21ec15d57fbf.jpg',
    sourceSha256: 'a9028bbfb3f14dbdf47b751ee26c48362cfcc5ce7d964f63cd57f697cbbbd134',
    sourceBytes: 369916,
    expectedTriangles: 4524,
    targetWidth: 60,
    widthRange: [50, 75],
    role: 'northern fortress with traversable inner court',
    authoredIngress: {
      primarySide: '+z',
      travelAxis: '-z',
      note: 'The prominent exterior arch faces the positive-Z side. Preserve a collision opening through that wall and keep the broad central court free.',
    },
  },
  {
    id: 'crownward_premade_castle',
    packId: 'creative-trio-castle-source-glb',
    title: 'Castle',
    pageUrl: 'https://poly.pizza/m/4360GdbxRe',
    downloadUrl: 'https://static.poly.pizza/22111935-8912-4e80-836d-9b105da164f5.glb',
    previewUrl: 'https://static.poly.pizza/22111935-8912-4e80-836d-9b105da164f5.jpg',
    sourceSha256: '8d6776a6304f0aee2abb39ee5d1410b5945b996c3431bd97789967fd84e40542',
    sourceBytes: 1044432,
    expectedTriangles: 13860,
    targetWidth: 52,
    widthRange: [45, 60],
    role: 'southern compact landmark castle',
    authoredIngress: {
      primarySide: '+z',
      travelAxis: '-z',
      note: 'The pointed main gate faces the positive-Z side. The interior is densely built, so accept the threshold and exterior rather than promising a large inner court.',
    },
  },
];

const packs = plans.map(plan => ({
  ...commonPack,
  id: plan.packId,
  name: `CreativeTrio ${plan.title} source GLB`,
  source: plan.pageUrl,
  directDownload: plan.downloadUrl,
  sourcePath: `test-results/crownward-castles/sources/${plan.id}.source.glb`,
  archiveName: new URL(plan.downloadUrl).pathname.split('/').at(-1),
  archiveSha256: plan.sourceSha256,
  sourceKind: 'Individual GLB download; archiveSha256 hashes this exact downloaded source object.',
}));

async function fetchBytes(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function documentMetadata(document) {
  const root = document.getRoot();
  const meshNodes = root.listNodes().filter(node => node.getMesh());
  assert(meshNodes.length, 'source contains no mesh nodes');
  const bounds = meshNodes.map(node => getBounds(node)).reduce((value, next) => ({
    min: value.min.map((number, index) => Math.min(number, next.min[index])),
    max: value.max.map((number, index) => Math.max(number, next.max[index])),
  }));
  const triangles = meshNodes.reduce((total, node) => total + node.getMesh().listPrimitives().reduce((meshTotal, primitive) => {
    const indices = primitive.getIndices();
    return meshTotal + (indices ? indices.getCount() : primitive.getAttribute('POSITION').getCount()) / 3;
  }, 0), 0);
  return {
    bounds,
    size: bounds.max.map((number, index) => number - bounds.min[index]),
    triangles,
    nodes: root.listNodes().length,
    meshes: root.listMeshes().length,
    accessors: root.listAccessors().length,
    materials: root.listMaterials().map(material => material.getName()),
    animations: root.listAnimations().map(animation => animation.getName()),
    textures: root.listTextures().map(texture => ({
      name: texture.getName(),
      mimeType: texture.getMimeType(),
      size: texture.getSize(),
      sha256: sha256(texture.getImage()),
    })),
  };
}

await mkdir(modelRoot, { recursive: true });
await mkdir(sourceRoot, { recursive: true });
await mkdir(previewRoot, { recursive: true });
const assets = [];
const files = {};
const provenanceAssets = [];

for (const plan of plans) {
  const [bytes, preview] = await Promise.all([fetchBytes(plan.downloadUrl), fetchBytes(plan.previewUrl)]);
  assert.equal(bytes.length, plan.sourceBytes, `${plan.id}: source byte count changed`);
  assert.equal(sha256(bytes), plan.sourceSha256, `${plan.id}: source hash changed`);
  const sourcePath = path.join(sourceRoot, `${plan.id}.source.glb`);
  await writeFile(sourcePath, bytes);
  const sourceDocument = await io.read(sourcePath);
  const sourceMetadata = documentMetadata(sourceDocument);
  const sourcePalette = sourceDocument.getRoot().listTextures()[0]?.getImage();
  assert(sourcePalette, `${plan.id}: embedded palette bytes are missing`);
  await writeFile(path.join(previewRoot, `${plan.id}-palette.jpg`), sourcePalette);
  const normalized = normalizedGlb(bytes, sourceMetadata.bounds, plan.id);
  const stagedPath = path.join(modelRoot, `${plan.id}.glb`);
  const previewPath = path.join(previewRoot, `${plan.id}.jpg`);
  await Promise.all([writeFile(stagedPath, normalized.bytes), writeFile(previewPath, preview)]);
  const stagedBytes = await readFile(stagedPath);
  assert.equal(sha256(parseGlb(stagedBytes, plan.id).tail), normalized.sourceBinSha256, `${plan.id}: BIN chunk changed during normalization`);
  const document = await io.read(stagedPath);
  const metadata = documentMetadata(document);
  assert.equal(metadata.triangles, plan.expectedTriangles, `${plan.id}: triangle count changed`);
  assert.deepEqual(metadata.animations, [], `${plan.id}: unexpected animation`);
  assert.deepEqual(metadata.materials, ['Diffuse_color'], `${plan.id}: material layout changed`);
  assert.equal(metadata.textures.length, 1, `${plan.id}: expected one embedded palette`);
  assert.deepEqual(metadata.textures[0].size, [256, 256], `${plan.id}: palette dimensions changed`);
  assert.equal(metadata.textures[0].sha256, sharedPalette.sha256, `${plan.id}: shared palette changed`);
  assert(Math.abs(metadata.bounds.min[1]) < 1e-6, `${plan.id}: normalized base is not Y=0`);
  assert(Math.abs(metadata.bounds.min[0] + metadata.bounds.max[0]) < 1e-6, `${plan.id}: normalized X is off center`);
  assert(Math.abs(metadata.bounds.min[2] + metadata.bounds.max[2]) < 1e-6, `${plan.id}: normalized Z is off center`);
  const targetScale = plan.targetWidth / metadata.size[0];
  const scaleRange = plan.widthRange.map(width => width / metadata.size[0]);
  const scaled = scale => ({
    width: round(metadata.size[0] * scale),
    height: round(metadata.size[1] * scale),
    depth: round(metadata.size[2] * scale),
    groundOffsetY: 0,
    centerOffsetX: 0,
    centerOffsetZ: 0,
  });
  const file = `models/crownward-castles/${plan.id}.glb`;
  files[plan.id] = `../../test-results/crownward-castles/${file}`;
  assets.push({
    id: plan.id,
    file,
    pack: plan.packId,
    category: 'building',
    is: plan.title.toLowerCase(),
    tags: ['building', 'castle', 'medieval', 'crownward', 'premade', plan.id.endsWith('fortress') ? 'fortress' : 'landmark'],
    bytes: stagedBytes.length,
    sha256: sha256(stagedBytes),
    size: vector(metadata.size),
    base: vector(metadata.bounds.min),
    animations: metadata.animations,
    materials: metadata.materials,
    triangles: metadata.triangles,
    metadata: {
      premadeSource: {
        title: plan.title,
        author: commonPack.author,
        sourcePage: plan.pageUrl,
        directDownload: plan.downloadUrl,
        license: commonPack.license,
        licenseUrl: commonPack.licenseUrl,
        sourceSha256: plan.sourceSha256,
        sourceBytes: plan.sourceBytes,
        transform: 'Scene-root translation only: center X/Z and move authored base to Y=0. Front already faces +Z, so yaw is 0. Mesh BIN chunk and embedded palette bytes are unchanged.',
      },
      inspection: {
        sourceBounds: { min: vector(sourceMetadata.bounds.min), max: vector(sourceMetadata.bounds.max) },
        normalizedBounds: { min: vector(metadata.bounds.min), max: vector(metadata.bounds.max) },
        nodes: metadata.nodes,
        meshes: metadata.meshes,
        accessors: metadata.accessors,
        textures: metadata.textures,
        authoredIngress: plan.authoredIngress,
        scaleSuggestion: {
          role: plan.role,
          targetWidthMeters: plan.targetWidth,
          targetUniformScale: round(targetScale),
          resultMeters: scaled(targetScale),
          acceptedWidthRangeMeters: plan.widthRange,
          uniformScaleRange: scaleRange.map(round),
          rangeAtEndpointsMeters: scaleRange.map(scaled),
        },
      },
    },
    acceptance: { exported: true, labAccepted: false, worldIntegrated: false },
  });
  provenanceAssets.push({
    id: plan.id,
    sourcePage: plan.pageUrl,
    directDownload: plan.downloadUrl,
    sourceSha256: plan.sourceSha256,
    sourceBytes: plan.sourceBytes,
    sourceFile: `test-results/crownward-castles/sources/${plan.id}.source.glb`,
    sourceFileSha256: sha256(await readFile(sourcePath)),
    stagedSha256: sha256(stagedBytes),
    stagedBytes: stagedBytes.length,
    sourceFileByteIdentical: (await readFile(sourcePath)).equals(bytes),
    candidateByteIdentical: stagedBytes.equals(bytes),
    sourceBinChunkSha256: normalized.sourceBinSha256,
    stagedBinChunkSha256: sha256(parseGlb(stagedBytes, plan.id).tail),
    normalization: { centerXZ: true, baseY: 0, front: '+Z', yawRadians: 0 },
    previewUrl: plan.previewUrl,
    previewFile: `test-results/crownward-castles/source-previews/${plan.id}.jpg`,
    previewSha256: sha256(preview),
    paletteFile: `test-results/crownward-castles/source-previews/${plan.id}-palette.jpg`,
    paletteSha256: sha256(sourcePalette),
  });
}

const generator = {
  command: 'node tools/crownward-castles/build.mjs',
  deterministicForPinnedSources: true,
  generatorSha256: sha256(await readFile(import.meta.filename)),
  stagingRoot: 'test-results/crownward-castles',
};
await writeFile(path.join(directory, 'catalog.json'), `${JSON.stringify({ packs, files, assets, generator }, null, 2)}\n`);
await writeFile(path.join(directory, 'provenance.json'), `${JSON.stringify({
  packs,
  licenseSummary: 'CC0 permits copying, modification, redistribution, and commercial use without permission or attribution.',
  sourceGlbsPreservedByteForByte: true,
  candidateGeometryAndPalettePreserved: true,
  assets: provenanceAssets,
}, null, 2)}\n`);
console.log(JSON.stringify({
  catalog: 'tools/crownward-castles/catalog.json',
  provenance: 'tools/crownward-castles/provenance.json',
  stagedAssets: assets.map(asset => ({ id: asset.id, bytes: asset.bytes, sha256: asset.sha256, size: asset.size, triangles: asset.triangles })),
}, null, 2));
