import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const sourceFile = 'assets/art/tripo/exports/121e4591-e66b-4803-bf39-802fa7bdb392.glb';
const outputRoot = 'assets/art/tripo/imports/creatures/starred-sheet-c';
const expectedSourceSha256 = 'e031c4ec0d7d128576d59adced8b63de217e3f0e81da32de32aebc4946543c47';
const expectedTriangles = 18401;
const sourceCardStorageUuid = 'd64af48c-ff32-405e-a05d-86ffe671cbcb';
const cells = [
  { number: 1, folder: 'parts/01-red-horned-demon', displayName: 'Red Horned Demon' },
  { number: 2, folder: 'parts/02-pale-lavender-long-ear-demon', displayName: 'Pale Lavender Long-Ear Demon', reviewHold: 'C2 held for cute presentation; root visual review required.' },
  { number: 3, folder: 'parts/03-woodland-antler-demon', displayName: 'Woodland Antler Demon' },
  { number: 4, folder: 'parts/04-magma-spike-demon', displayName: 'Magma Spike Demon' },
  { number: 5, folder: 'parts/05-ivory-spike-demon', displayName: 'Ivory Spike Demon' },
  { number: 6, folder: 'parts/06-purple-cyclops-demon', displayName: 'Purple Cyclops Demon' },
  { number: 7, folder: 'parts/07-ice-spike-demon', displayName: 'Ice Spike Demon' },
  { number: 8, folder: 'parts/08-tan-bull-horn-demon', displayName: 'Tan Bull-Horn Demon' },
  { number: 9, folder: 'parts/09-brown-many-horn-demon', displayName: 'Brown Many-Horn Demon' },
];

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function typedHash(array) {
  return hash(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
}

function kMeans3(values, label) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = max - min;
  if (!(width > 0)) throw new Error('Cannot divide sheet axis with no extent: ' + label);
  let centers = [min + width / 6, min + width / 2, min + width * 5 / 6];
  for (let pass = 0; pass < 64; pass++) {
    const totals = [0, 0, 0];
    const counts = [0, 0, 0];
    for (const value of values) {
      let best = 0;
      for (let index = 1; index < centers.length; index++) {
        if (Math.abs(value - centers[index]) < Math.abs(value - centers[best])) best = index;
      }
      totals[best] += value;
      counts[best]++;
    }
    if (counts.some((count) => count === 0)) throw new Error('The sheet does not form three distinct ' + label + ' bands.');
    const next = totals.map((total, index) => total / counts[index]);
    const delta = Math.max(...next.map((value, index) => Math.abs(value - centers[index])));
    centers = next;
    if (delta < 1e-9) break;
  }
  return centers.sort((a, b) => a - b);
}

function nearest(values, value) {
  let best = 0;
  for (let index = 1; index < values.length; index++) {
    if (Math.abs(value - values[index]) < Math.abs(value - values[best])) best = index;
  }
  return best;
}

function boundsOfPoints(positions, vertexIds) {
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const vertex of vertexIds) for (let axis = 0; axis < 3; axis++) {
    const value = positions[vertex * 3 + axis];
    bounds.min[axis] = Math.min(bounds.min[axis], value);
    bounds.max[axis] = Math.max(bounds.max[axis], value);
  }
  return bounds;
}

function compactAttribute(accessor, vertexIds, positionOffset = [0, 0, 0]) {
  const source = accessor.getArray();
  const size = accessor.getElementSize();
  const output = new source.constructor(vertexIds.length * size);
  for (let newIndex = 0; newIndex < vertexIds.length; newIndex++) {
    const oldIndex = vertexIds[newIndex];
    for (let component = 0; component < size; component++) {
      const offset = size === 3 && accessor.getType() === 'VEC3' ? positionOffset[component] : 0;
      output[newIndex * size + component] = source[oldIndex * size + component] - offset;
    }
  }
  accessor.setArray(output);
  return output;
}

async function resizeTexture(texture) {
  const image = texture.getImage();
  const meta = await sharp(image).metadata();
  if (!meta.width || !meta.height) throw new Error('Could not read texture dimensions for ' + texture.getName());
  if (meta.width <= 2048 && meta.height <= 2048) return;
  const isColor = /base.?color|albedo/i.test(texture.getName());
  const filter = isColor ? 'lanczos3' : 'linear';
  const encoded = await sharp(image).resize(2048, 2048, { fit: 'fill', kernel: filter })
    .toFormat(meta.format === 'jpeg' ? 'jpeg' : 'png', meta.format === 'jpeg' ? { quality: 94, chromaSubsampling: '4:4:4' } : {})
    .toBuffer();
  texture.setImage(encoded);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourceFile);
const sourceSha256 = hash(sourceBytes);
if (sourceSha256 !== expectedSourceSha256) throw new Error('Sheet C source SHA-256 mismatch: ' + sourceSha256);
const document = await io.readBinary(sourceBytes);
const root = document.getRoot();
const textureReport = [];
for (const texture of root.listTextures()) {
  const image = texture.getImage();
  const meta = await sharp(image).metadata();
  textureReport.push({
    name: texture.getName(), width: meta.width, height: meta.height,
    mimeType: texture.getMimeType(), format: meta.format, bytes: image.length,
    sha256: hash(image),
  });
}
const meshReport = [];
for (const mesh of root.listMeshes()) for (let index = 0; index < mesh.listPrimitives().length; index++) {
  const primitive = mesh.listPrimitives()[index];
  const positions = primitive.getAttribute('POSITION')?.getArray();
  const indices = primitive.getIndices()?.getArray();
  if (!positions || !indices) throw new Error('Every sheet primitive must be indexed and have positions.');
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let vertex = 0; vertex < positions.length / 3; vertex++) for (let axis = 0; axis < 3; axis++) {
    const value = positions[vertex * 3 + axis];
    bounds.min[axis] = Math.min(bounds.min[axis], value);
    bounds.max[axis] = Math.max(bounds.max[axis], value);
  }
  meshReport.push({
    mesh: mesh.getName(), primitive: index, vertices: positions.length / 3,
    triangles: indices.length / 3, bounds,
    attributes: primitive.listAttributes().map((attribute) => ({
      semantic: attribute.getName(), type: attribute.getType(), componentType: attribute.getComponentType(), count: attribute.getCount(),
    })),
    material: primitive.getMaterial()?.getName() ?? null,
  });
}
const summary = {
  sourceFile, sourceSha256, sourceBytes: sourceBytes.length,
  scenes: root.listScenes().map((scene) => ({ name: scene.getName(), children: scene.listChildren().map((node) => node.getName()) })),
  nodes: root.listNodes().map((node) => ({
    name: node.getName(), mesh: node.getMesh()?.getName() ?? null,
    translation: node.getTranslation(), rotation: node.getRotation(), scale: node.getScale(),
    children: node.listChildren().map((child) => child.getName()),
  })),
  meshes: meshReport,
  materials: root.listMaterials().map((material) => ({
    name: material.getName(), baseColor: material.getBaseColorTexture()?.getName() ?? null,
    normal: material.getNormalTexture()?.getName() ?? null,
    metallicRoughness: material.getMetallicRoughnessTexture()?.getName() ?? null,
    metallicFactor: material.getMetallicFactor(), roughnessFactor: material.getRoughnessFactor(),
  })),
  textures: textureReport,
  skins: root.listSkins().map((skin) => ({ name: skin.getName(), joints: skin.listJoints().length })),
  animations: root.listAnimations().map((animation) => animation.getName()),
};
if (meshReport.length !== 1 || meshReport[0].triangles !== expectedTriangles || root.listSkins().length || root.listAnimations().length) {
  throw new Error('Expected the exact single-mesh, unrigged, 18,401-triangle Sheet C export.');
}

const sourceMesh = root.listMeshes()[0];
const sourcePrimitive = sourceMesh.listPrimitives()[0];
if (sourcePrimitive.getMode() !== 4) throw new Error('Expected TRIANGLES primitive mode.');
const sourcePositions = sourcePrimitive.getAttribute('POSITION').getArray();
const sourceIndices = sourcePrimitive.getIndices().getArray();
const triangleCentroids = [];
for (let triangle = 0; triangle < sourceIndices.length / 3; triangle++) {
  const ids = [sourceIndices[triangle * 3], sourceIndices[triangle * 3 + 1], sourceIndices[triangle * 3 + 2]];
  triangleCentroids.push({
    triangle,
    x: (sourcePositions[ids[0] * 3] + sourcePositions[ids[1] * 3] + sourcePositions[ids[2] * 3]) / 3,
    y: (sourcePositions[ids[0] * 3 + 1] + sourcePositions[ids[1] * 3 + 1] + sourcePositions[ids[2] * 3 + 1]) / 3,
  });
}
const columns = kMeans3(triangleCentroids.map((value) => value.x), 'horizontal');
const rowsAscending = kMeans3(triangleCentroids.map((value) => value.y), 'vertical');
const rowsTopDown = [...rowsAscending].reverse();
const trianglesByCell = cells.map(() => []);
for (const sample of triangleCentroids) {
  const column = nearest(columns, sample.x);
  const rowFromBottom = nearest(rowsAscending, sample.y);
  const rowTopDown = 2 - rowFromBottom;
  trianglesByCell[rowTopDown * 3 + column].push(sample.triangle);
}
if (trianglesByCell.some((triangles) => triangles.length === 0)) throw new Error('At least one Sheet C cell is empty.');
if (trianglesByCell.reduce((sum, triangles) => sum + triangles.length, 0) !== expectedTriangles) {
  throw new Error('The 3x3 split did not preserve all source triangles.');
}

const outputs = [];
for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
  const cell = cells[cellIndex];
  const selectedTriangles = trianglesByCell[cellIndex];
  const selectedVertexSet = new Set();
  for (const triangle of selectedTriangles) for (let corner = 0; corner < 3; corner++) {
    selectedVertexSet.add(sourceIndices[triangle * 3 + corner]);
  }
  const originalVertexIds = [...selectedVertexSet].sort((a, b) => a - b);
  const sourceBounds = boundsOfPoints(sourcePositions, originalVertexIds);
  const positionOffset = [
    (sourceBounds.min[0] + sourceBounds.max[0]) / 2,
    sourceBounds.min[1],
    (sourceBounds.min[2] + sourceBounds.max[2]) / 2,
  ];
  const vertexRemap = new Map(originalVertexIds.map((id, index) => [id, index]));
  const localIndices = [];
  const sourceTriangleIndices = [];
  for (const triangle of selectedTriangles) for (let corner = 0; corner < 3; corner++) {
    const sourceIndex = sourceIndices[triangle * 3 + corner];
    sourceTriangleIndices.push(sourceIndex);
    localIndices.push(vertexRemap.get(sourceIndex));
  }

  const partDocument = await io.readBinary(sourceBytes);
  const partRoot = partDocument.getRoot();
  const primitive = partRoot.listMeshes()[0].listPrimitives()[0];
  const expectedAttributes = {};
  const sourceAttributeHashes = {};
  for (const semantic of primitive.listSemantics()) {
    const accessor = primitive.getAttribute(semantic);
    const originalArray = accessor.getArray();
    const sourceCompacted = new originalArray.constructor(originalVertexIds.length * accessor.getElementSize());
    for (let newIndex = 0; newIndex < originalVertexIds.length; newIndex++) {
      const sourceVertex = originalVertexIds[newIndex];
      for (let component = 0; component < accessor.getElementSize(); component++) {
        sourceCompacted[newIndex * accessor.getElementSize() + component] = originalArray[sourceVertex * accessor.getElementSize() + component];
      }
    }
    sourceAttributeHashes[semantic] = typedHash(sourceCompacted);
    expectedAttributes[semantic] = compactAttribute(accessor, originalVertexIds, semantic === 'POSITION' ? positionOffset : [0, 0, 0]);
  }
  const sourceIndexAccessor = primitive.getIndices();
  const SourceIndexArray = sourceIndexAccessor.getArray().constructor;
  const compactedIndices = new SourceIndexArray(localIndices);
  sourceIndexAccessor.setArray(compactedIndices);
  for (const texture of partRoot.listTextures()) await resizeTexture(texture);
  const localPosition = primitive.getAttribute('POSITION').getArray();
  const localBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let vertex = 0; vertex < originalVertexIds.length; vertex++) for (let axis = 0; axis < 3; axis++) {
    const value = localPosition[vertex * 3 + axis];
    localBounds.min[axis] = Math.min(localBounds.min[axis], value);
    localBounds.max[axis] = Math.max(localBounds.max[axis], value);
  }
  const bytes = await io.writeBinary(partDocument);
  const roundTrip = await io.readBinary(bytes);
  const roundPrimitive = roundTrip.getRoot().listMeshes()[0].listPrimitives()[0];
  const roundPositions = roundPrimitive.getAttribute('POSITION').getArray();
  const roundIndices = roundPrimitive.getIndices().getArray();
  const roundMaterial = roundPrimitive.getMaterial();
  if (roundPositions.length / 3 !== originalVertexIds.length || roundIndices.length / 3 !== selectedTriangles.length) {
    throw new Error('Part ' + (cellIndex + 1) + ' changed vertex or triangle count during GLB serialization.');
  }
  if (!roundMaterial?.getBaseColorTexture() || !roundMaterial.getNormalTexture() || !roundMaterial.getMetallicRoughnessTexture()) {
    throw new Error('Part ' + (cellIndex + 1) + ' lost an image-generated PBR map during GLB serialization.');
  }
  for (let index = 0; index < localIndices.length; index++) {
    if (roundIndices[index] !== localIndices[index]) throw new Error('Part ' + (cellIndex + 1) + ' changed triangle connectivity.');
  }
  const extractedAttributeHashes = {};
  for (const semantic of primitive.listSemantics()) {
    const actual = roundPrimitive.getAttribute(semantic).getArray();
    const expected = expectedAttributes[semantic];
    if (actual.length !== expected.length) throw new Error('Part ' + (cellIndex + 1) + ' changed ' + semantic + ' element count.');
    for (let index = 0; index < expected.length; index++) {
      if (actual[index] !== expected[index]) throw new Error('Part ' + (cellIndex + 1) + ' changed ' + semantic + ' value at ' + index + '.');
    }
    extractedAttributeHashes[semantic] = typedHash(actual);
  }
  const runtimeTextures = [];
  for (const texture of roundTrip.getRoot().listTextures()) {
    const image = texture.getImage();
    const meta = await sharp(image).metadata();
    if (meta.width > 2048 || meta.height > 2048) throw new Error('Part texture exceeds 2K: ' + texture.getName());
    runtimeTextures.push({ name: texture.getName(), width: meta.width, height: meta.height, mimeType: texture.getMimeType(), bytes: image.length, sha256: hash(image) });
  }
  const folder = outputRoot + '/' + cell.folder;
  await mkdir(folder, { recursive: true });
  const baseFile = folder + '/base.glb';
  await writeFile(baseFile, bytes);
  const part = {
    part: cell.number,
    displayName: cell.displayName,
    status: 'extracted-candidate-pending-root-review',
    reviewHold: cell.reviewHold ?? null,
    source: {
      file: sourceFile,
      sha256: sourceSha256,
      cardStorageUuid: sourceCardStorageUuid,
      starredStatus: 'in My Assets; not starred in Collected at extraction time',
      sourceCell: { row: Math.floor(cellIndex / 3) + 1, column: cellIndex % 3 + 1 },
      triangleCount: selectedTriangles.length,
      vertexCount: originalVertexIds.length,
      sourceBounds,
      sourcePositionOffset: positionOffset,
      attributeHashes: sourceAttributeHashes,
      triangleIndexHash: typedHash(new sourceIndices.constructor(sourceTriangleIndices)),
      pbrTextures: textureReport,
      skin: 'none',
      animations: [],
    },
    extracted: {
      file: baseFile,
      sha256: hash(bytes),
      bytes: bytes.length,
      geometry: {
        vertices: roundPositions.length / 3,
        triangles: roundIndices.length / 3,
        bounds: localBounds,
        retopology: false,
        triangleConnectivityPreserved: true,
        attributeHashes: extractedAttributeHashes,
        indexHash: typedHash(roundIndices),
      },
      textures: runtimeTextures,
      acceptance: { extraction: true, sourceDesign: true, rig: false, animation: false, textures: false, labAccepted: false, worldIntegrated: false },
    },
  };
  await writeFile(folder + '/part.json', JSON.stringify(part, null, 2) + '\n');
  outputs.push({
    part: cell.number,
    displayName: cell.displayName,
    folder,
    file: baseFile,
    sha256: hash(bytes),
    vertices: roundPositions.length / 3,
    triangles: roundIndices.length / 3,
    bounds: localBounds,
    sourceBounds,
    pbrTextureCount: runtimeTextures.length,
  });
}

const ledger = {
  schema: 'corealm-starred-sheet-creature-extraction/1',
  source: { file: sourceFile, sha256: sourceSha256, bytes: sourceBytes.length, cardStorageUuid: sourceCardStorageUuid, starredStatus: 'unstarred in Collected; included from My Assets under user’s three-sheet request', designReview: 'Sheet C: adult proportions and threatening claws. All nine parts are staged for root review; C2 has a cute-presentation hold.' },
  method: 'Preserved source triangles and UV/material assignments by selecting existing triangle faces and compacting only each part’s referenced vertex attributes. No retopology. Grid assignment uses triangle-centroid 3-means on source X and Y; row-major output follows top-to-bottom rows and left-to-right columns. Each part is translated by one uniform origin offset so its bounds begin at ground Y=0 and its horizontal center is at the origin.',
  sourceGeometry: { meshCount: root.listMeshes().length, primitiveCount: meshReport.length, vertices: meshReport[0].vertices, triangles: expectedTriangles, retopology: false, positionsCenteredPerPart: true },
  grid: { horizontalCenters: columns, verticalCentersBottomToTop: rowsAscending, verticalCentersTopToBottom: rowsTopDown },
  sourceTextures: textureReport,
  parts: outputs,
  extractedTriangles: outputs.reduce((sum, part) => sum + part.triangles, 0),
  acceptance: { sourceProvenance: true, extraction: true, sourceDesign: false, rig: false, animation: false, textures: false, labAccepted: false, worldIntegrated: false },
};
if (ledger.extractedTriangles !== expectedTriangles) throw new Error('Extraction ledger does not account for every source triangle.');
await writeFile(outputRoot + '/extraction-ledger.json', JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ sourceSha256, sourceTriangles: expectedTriangles, columns, rowsTopDown, parts: outputs }, null, 2));
