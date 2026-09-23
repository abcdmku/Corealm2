import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const projectId = '2dba7c96-0289-4979-8510-df23ce9577eb';
const sourceFile = `assets/art/tripo/exports/${projectId}.glb`;
const outputDirectory = 'assets/art/tripo/imports/creatures/starred-sheet-b';
const baseDirectory = `${outputDirectory}/base`;
const expectedSourceHash = '7559d698aea8fb679f6b63567a353e4f80d0ad91260133b70cf8220b10beac05';
const sourceSha = bytes => createHash('sha256').update(bytes).digest('hex');

const entries = [
  { row: 0, column: 0, slug: 'red-bone-mask-imp', name: 'Red Bone-Mask Imp' },
  { row: 0, column: 1, slug: 'lavender-bat-ear-imp', name: 'Lavender Bat-Ear Imp' },
  { row: 0, column: 2, slug: 'green-antler-imp', name: 'Green Antler Imp' },
  { row: 1, column: 0, slug: 'magma-imp', name: 'Magma Imp' },
  { row: 1, column: 1, slug: 'ivory-bone-imp', name: 'Ivory Bone Imp' },
  { row: 1, column: 2, slug: 'purple-cyclops-imp', name: 'Purple Cyclops Imp' },
  { row: 2, column: 0, slug: 'blue-crystal-imp', name: 'Blue Crystal Imp' },
  { row: 2, column: 1, slug: 'rust-iron-spike-imp', name: 'Rust-Iron Spike Imp' },
  { row: 2, column: 2, slug: 'yellow-green-spore-imp', name: 'Yellow-Green Spore Imp' },
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourceFile);
const actualSourceHash = sourceSha(sourceBytes);
assert.equal(actualSourceHash, expectedSourceHash, 'The pinned starred sheet source changed.');

const sourceDocument = await io.readBinary(sourceBytes);
const sourceRoot = sourceDocument.getRoot();
const sourceMesh = sourceRoot.listMeshes()[0];
const sourcePrimitive = sourceMesh?.listPrimitives()[0];
const sourceNode = sourceRoot.listNodes()[0];
assert(sourceMesh && sourcePrimitive && sourceNode, 'Expected one combined starred-sheet mesh.');
assert.equal(sourceRoot.listMeshes().length, 1, 'Expected exactly one source mesh.');
assert.equal(sourceMesh.listPrimitives().length, 1, 'Expected one material primitive in the source.');
assert.equal(sourceRoot.listSkins().length, 0, 'The source unexpectedly contains a skin.');
assert.equal(sourceRoot.listAnimations().length, 0, 'The source unexpectedly contains animations.');

const sourcePositions = sourcePrimitive.getAttribute('POSITION')?.getArray();
const sourceIndexAccessor = sourcePrimitive.getIndices();
const sourceIndices = sourceIndexAccessor?.getArray();
assert(sourcePositions && sourceIndexAccessor && sourceIndices, 'Expected indexed POSITION geometry.');
const sourceVertexCount = sourcePositions.length / 3;
const sourceTriangleCount = sourceIndices.length / 3;
assert.equal(sourceTriangleCount, 19_233, 'The pinned sheet topology changed.');
assert.equal(sourceVertexCount, 32_739, 'The pinned sheet vertex count changed.');

// The sheet's nine silhouettes occupy a regular X/Y grid, with the source-facing
// image plane toward +Z. Centroids stay within their own cell except for a few
// boundary triangles; those are assigned whole so no face is cut or discarded.
const xBreaks = [-0.17, 0.175];
const yBreaks = [0.32, 0.645];
const faceGroups = Array.from({ length: 9 }, () => []);
for (let face = 0; face < sourceTriangleCount; face++) {
  const indexOffset = face * 3;
  const ids = [sourceIndices[indexOffset], sourceIndices[indexOffset + 1], sourceIndices[indexOffset + 2]];
  const centerX = (sourcePositions[ids[0] * 3] + sourcePositions[ids[1] * 3] + sourcePositions[ids[2] * 3]) / 3;
  const centerY = (sourcePositions[ids[0] * 3 + 1] + sourcePositions[ids[1] * 3 + 1] + sourcePositions[ids[2] * 3 + 1]) / 3;
  const sourceColumn = centerX < xBreaks[0] ? 0 : centerX < xBreaks[1] ? 1 : 2;
  const sourceBottomToTopRow = centerY < yBreaks[0] ? 0 : centerY < yBreaks[1] ? 1 : 2;
  const imageTopToBottomRow = 2 - sourceBottomToTopRow;
  faceGroups[imageTopToBottomRow * 3 + sourceColumn].push(ids);
}
assert.equal(faceGroups.reduce((sum, faces) => sum + faces.length, 0), sourceTriangleCount, 'Some source faces were not assigned.');
assert(faceGroups.every(faces => faces.length > 1_000), 'At least one expected spatial component is missing.');

const sourceMaterials = sourceRoot.listMaterials();
assert.equal(sourceMaterials.length, 1, 'Expected the sheet to use one shared PBR material.');
const colorTexture = sourceMaterials[0].getBaseColorTexture();
const dataTextures = [sourceMaterials[0].getNormalTexture(), sourceMaterials[0].getMetallicRoughnessTexture()].filter(Boolean);
assert(colorTexture && dataTextures.length === 2, 'Expected base color, normal, and metallic-roughness maps.');
const sourceTextureInfo = await Promise.all(sourceRoot.listTextures().map(async texture => {
  const image = texture.getImage();
  assert(image, `Texture ${texture.getName()} has no embedded image.`);
  const metadata = await sharp(image).metadata();
  return {
    name: texture.getName(),
    mimeType: texture.getMimeType(),
    width: metadata.width,
    height: metadata.height,
    sha256: sourceSha(image),
  };
}));
assert.equal(sourceTextureInfo.length, 3, 'Expected three source PBR maps.');

await mkdir(baseDirectory, { recursive: true });
const partMetrics = [];
for (let index = 0; index < entries.length; index++) {
  const entry = entries[index];
  const triangles = faceGroups[index];
  const sourceVertexIds = [];
  const remap = new Map();
  const localIndices = [];
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const face of triangles) {
    for (const sourceId of face) {
      let localId = remap.get(sourceId);
      if (localId === undefined) {
        localId = sourceVertexIds.length;
        remap.set(sourceId, localId);
        sourceVertexIds.push(sourceId);
        for (let axis = 0; axis < 3; axis++) {
          const value = sourcePositions[sourceId * 3 + axis];
          bounds.min[axis] = Math.min(bounds.min[axis], value);
          bounds.max[axis] = Math.max(bounds.max[axis], value);
        }
      }
      localIndices.push(localId);
    }
  }

  const document = await io.readBinary(sourceBytes);
  const root = document.getRoot();
  const mesh = root.listMeshes()[0];
  const primitive = mesh.listPrimitives()[0];
  const node = root.listNodes()[0];
  const buffer = root.listBuffers()[0];
  assert(mesh && primitive && node && buffer, `Part ${index + 1}: source mesh structure changed.`);

  for (const semantic of primitive.listSemantics()) {
    const original = primitive.getAttribute(semantic);
    assert(original, `Part ${index + 1}: missing ${semantic} accessor.`);
    const values = original.getArray();
    const elementSize = original.getElementSize();
    assert.equal(values.length, sourceVertexCount * elementSize, `Part ${index + 1}: unexpected ${semantic} cardinality.`);
    const selected = new values.constructor(sourceVertexIds.length * elementSize);
    for (let vertex = 0; vertex < sourceVertexIds.length; vertex++) {
      const sourceOffset = sourceVertexIds[vertex] * elementSize;
      selected.set(values.subarray(sourceOffset, sourceOffset + elementSize), vertex * elementSize);
    }
    const accessor = document.createAccessor(`${entry.slug}_${semantic}`, buffer)
      .setType(original.getType())
      .setArray(selected)
      .setNormalized(original.getNormalized());
    primitive.setAttribute(semantic, accessor);
  }

  const localIndexArray = new sourceIndices.constructor(localIndices);
  const indicesAccessor = document.createAccessor(`${entry.slug}_indices`, buffer)
    .setType(Accessor.Type.SCALAR)
    .setArray(localIndexArray);
  primitive.setIndices(indicesAccessor);

  const centerX = (bounds.min[0] + bounds.max[0]) / 2;
  const centerZ = (bounds.min[2] + bounds.max[2]) / 2;
  node.setName(`${entry.name} Source Mesh`)
    .setTranslation([-centerX, -bounds.min[1], -centerZ]);
  mesh.setName(`${entry.name} Source Geometry`);
  await document.transform(prune());

  const material = root.listMaterials()[0];
  assert(material, `Part ${index + 1}: source PBR material was pruned.`);
  for (const texture of root.listTextures()) {
    const image = texture.getImage();
    assert(image, `Part ${index + 1}: texture ${texture.getName()} lost its image.`);
    const isDataTexture = dataTextures.some(sourceTexture => sourceTexture.getName() === texture.getName());
    const resized = await sharp(image)
      .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true, kernel: isDataTexture ? 'linear' : 'lanczos3' })
      .toFormat(isDataTexture ? 'png' : 'jpeg', isDataTexture ? { compressionLevel: 9 } : { quality: 94, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toBuffer();
    texture.setName(`${entry.slug}_${isDataTexture ? 'data' : 'basecolor'}_2k.${isDataTexture ? 'png' : 'jpg'}`)
      .setImage(resized)
      .setMimeType(isDataTexture ? 'image/png' : 'image/jpeg');
  }

  const outputFile = `${baseDirectory}/part-${String(index + 1).padStart(2, '0')}.glb`;
  const outputBytes = await io.writeBinary(document);
  await writeFile(outputFile, outputBytes);
  const check = await io.readBinary(outputBytes);
  const checkRoot = check.getRoot();
  const checkMesh = checkRoot.listMeshes()[0];
  const checkPrimitive = checkMesh?.listPrimitives()[0];
  assert(checkPrimitive, `Part ${index + 1}: output lost its geometry.`);
  assert.equal(checkRoot.listMeshes().length, 1, `Part ${index + 1}: expected one output mesh.`);
  assert.equal(checkPrimitive.getIndices()?.getCount(), triangles.length * 3, `Part ${index + 1}: face count changed.`);
  assert.equal(checkRoot.listMaterials().length, 1, `Part ${index + 1}: PBR material is missing.`);
  assert.equal(checkRoot.listTextures().length, 3, `Part ${index + 1}: PBR maps are missing.`);
  const outputTextureMetrics = await Promise.all(checkRoot.listTextures().map(async texture => {
    const metadata = await sharp(texture.getImage()).metadata();
    assert((metadata.width ?? 0) <= 2048 && (metadata.height ?? 0) <= 2048, `Part ${index + 1}: texture exceeded 2K.`);
    return { name: texture.getName(), mimeType: texture.getMimeType(), width: metadata.width, height: metadata.height };
  }));
  const outputPrimitive = checkMesh.listPrimitives()[0];
  const attributes = Object.fromEntries(outputPrimitive.listSemantics().map(semantic => {
    const original = sourcePrimitive.getAttribute(semantic);
    const actual = outputPrimitive.getAttribute(semantic);
    assert(original && actual, `Part ${index + 1}: ${semantic} was lost.`);
    const expected = new (original.getArray().constructor)(sourceVertexIds.length * original.getElementSize());
    const originalValues = original.getArray();
    for (let vertex = 0; vertex < sourceVertexIds.length; vertex++) {
      const sourceOffset = sourceVertexIds[vertex] * original.getElementSize();
      expected.set(originalValues.subarray(sourceOffset, sourceOffset + original.getElementSize()), vertex * original.getElementSize());
    }
    const found = actual.getArray();
    assert.equal(found.length, expected.length, `Part ${index + 1}: ${semantic} length changed.`);
    for (let item = 0; item < expected.length; item++) assert.equal(found[item], expected[item], `Part ${index + 1}: ${semantic} source values changed.`);
    return [semantic, { values: found.length, preserved: true }];
  }));

  const crossingFaces = triangles.filter(face => {
    const xs = face.map(id => sourcePositions[id * 3]);
    const ys = face.map(id => sourcePositions[id * 3 + 1]);
    return xBreaks.some(cut => Math.min(...xs) < cut && Math.max(...xs) > cut)
      || yBreaks.some(cut => Math.min(...ys) < cut && Math.max(...ys) > cut);
  }).length;
  partMetrics.push({
    part: index + 1,
    row: entry.row + 1,
    column: entry.column + 1,
    id: entry.slug,
    displayName: entry.name,
    sourceFile,
    outputFile: path.normalize(outputFile).replaceAll('\\', '/'),
    sha256: sourceSha(outputBytes),
    bytes: outputBytes.byteLength,
    sourceBounds: bounds,
    centeredTranslation: [-centerX, -bounds.min[1], -centerZ],
    faces: triangles.length,
    vertices: sourceVertexIds.length,
    crossingBoundaryFaces: crossingFaces,
    sourceAttributesPreserved: attributes,
    textures: outputTextureMetrics,
  });
}

assert.equal(partMetrics.reduce((sum, part) => sum + part.faces, 0), sourceTriangleCount, 'Output face counts do not cover the source.');
const manifest = {
  schema: 'corealm-starred-sheet-extraction/1',
  status: 'awaiting-root-in-game-review',
  designDisposition: 'provisional-held: source-sheet creatures have chibi proportions against the serious RPG direction; extraction and rig candidates do not imply visual approval or production readiness.',
  source: {
    projectUuid: projectId,
    cardStorageUuid: '7d8ede80-cd10-4b2e-8b71-15c6aa28687e',
    displayName: 'fantasy creature 3d model',
    prompt: 'nine stylized fantasy monsters with horned skulls and clawed limbs, varied color schemes.',
    file: sourceFile,
    sha256: actualSourceHash,
    bytes: sourceBytes.byteLength,
    generator: 'Tripo Studio P1.0',
    triangles: sourceTriangleCount,
    vertices: sourceVertexCount,
    sourceRig: { joints: 0, animations: [] },
    textures: sourceTextureInfo,
  },
  extraction: {
    method: 'Each triangle is assigned whole by centroid to the source 3x3 silhouette grid; X breaks -0.17 and 0.175, Y breaks 0.32 and 0.645. Source vertex attributes, indices within each extracted face set, material and UVs are retained. A node translation centers each extracted model at X/Z origin and ground level without changing vertex positions.',
    rowOrder: 'screenshot row-major, top to bottom; the top row is high source Y.',
    sourceAttributes: sourcePrimitive.listSemantics(),
    noRetopology: true,
    sharedPbrMaps: 'Base color, normal and metallic-roughness maps retained as separate 2K images in each base GLB.',
  },
  parts: partMetrics,
};
await writeFile(`${outputDirectory}/extraction-ledger.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ source: sourceFile, sourceSha: actualSourceHash, sourceTriangles: sourceTriangleCount, extractedParts: partMetrics.map(({ part, id, faces, vertices, crossingBoundaryFaces, sha256 }) => ({ part, id, faces, vertices, crossingBoundaryFaces, sha256 })) }, null, 2));
