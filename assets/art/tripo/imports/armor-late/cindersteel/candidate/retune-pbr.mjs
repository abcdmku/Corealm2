import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const scriptPath = fileURLToPath(import.meta.url);
const candidateDir = path.dirname(scriptPath);
const cataloguePath = path.join(candidateDir, 'catalogue.json');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const smoothstep = (low, high, value) => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

// Steel in this atlas is charcoal and neutral. Warm copper, leather, and cloth are
// separated by chroma and red excess. Dark cavities stay dielectric through the value gate.
const targetMetal = 205;
const targetRoughness = 92;
const profile = 'masked-charcoal-iron-v1';

function accessorHash(accessor) {
  const array = accessor?.getArray();
  if (!array) return null;
  return hash(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
}

function documentSignature(document) {
  const root = document.getRoot();
  const accessors = root.listAccessors().map(accessor => ({
    type: accessor.getType(), count: accessor.getCount(), normalized: accessor.getNormalized(), data: accessorHash(accessor),
  }));
  const nodes = root.listNodes().map(node => ({
    name: node.getName(), children: node.listChildren().map(child => child.getName()),
    mesh: node.getMesh()?.getName() ?? null, skin: node.getSkin()?.getName() ?? null,
    translation: node.getTranslation(), rotation: node.getRotation(), scale: node.getScale(), matrix: node.getMatrix(),
    extras: node.getExtras(),
  }));
  const meshes = root.listMeshes().map(mesh => ({
    name: mesh.getName(), primitives: mesh.listPrimitives().map(primitive => ({
      mode: primitive.getMode(), material: primitive.getMaterial()?.getName() ?? null,
      attributes: primitive.listSemantics().sort().map(semantic => [semantic, accessorHash(primitive.getAttribute(semantic))]),
      indices: accessorHash(primitive.getIndices()),
    })),
  }));
  const skins = root.listSkins().map(skin => ({
    name: skin.getName(), joints: skin.listJoints().map(joint => joint.getName()),
    skeleton: skin.getSkeleton()?.getName() ?? null, inverseBindMatrices: accessorHash(skin.getInverseBindMatrices()),
  }));
  const scenes = root.listScenes().map(scene => ({ name: scene.getName(), roots: scene.listChildren().map(node => node.getName()) }));
  const animations = root.listAnimations().map(animation => animation.getName());
  return JSON.stringify({ accessors, nodes, meshes, skins, scenes, animations });
}

async function rgb(image, label) {
  const decoded = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (decoded.info.channels !== 3) throw new Error(`${label}: expected RGB pixels, found ${decoded.info.channels} channels`);
  return decoded;
}

function pixelMask(r, g, b) {
  const peak = Math.max(1, r, g, b);
  const light = (r + g + b) / 3;
  const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / peak;
  const redExcess = (r - g) / peak;
  return (1 - smoothstep(0.12, 0.23, chroma))
    * smoothstep(28, 50, light)
    * (1 - smoothstep(0.13, 0.26, redExcess));
}

function summarize(values) {
  if (!values.length) return { count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = fraction => sorted[Math.round((sorted.length - 1) * fraction)];
  return {
    count: values.length,
    mean: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)),
    p10: Number(at(0.1).toFixed(3)), p50: Number(at(0.5).toFixed(3)), p90: Number(at(0.9).toFixed(3)),
  };
}

async function retune(baseImage, packedImage) {
  const base = await rgb(baseImage, 'base-color atlas');
  const packed = await rgb(packedImage, 'metallic-roughness atlas');
  assert.equal(base.info.width, packed.info.width, 'base-color and packed maps must have matching width');
  assert.equal(base.info.height, packed.info.height, 'base-color and packed maps must have matching height');
  assert.deepEqual([base.info.width, base.info.height], [1024, 1024], 'the available source atlas is expected to remain 1K');

  const pixels = base.data.length / 3;
  const steelMetal = [], steelRough = [], warmMetal = [], warmRough = [];
  const valuesMetal = [], valuesRough = [];
  let coverage50 = 0, coverage80 = 0, confidenceTotal = 0;
  for (let i = 0; i < base.data.length; i += 3) {
    const r = base.data[i], g = base.data[i + 1], b = base.data[i + 2];
    const confidence = pixelMask(r, g, b);
    const originalRoughness = packed.data[i + 1];
    const originalMetal = packed.data[i + 2];
    const nextRoughness = Math.round(originalRoughness + (targetRoughness - originalRoughness) * confidence);
    const nextMetal = Math.round(originalMetal + (targetMetal - originalMetal) * confidence);
    packed.data[i + 1] = nextRoughness;
    packed.data[i + 2] = nextMetal;
    const rough = nextRoughness / 255, metal = nextMetal / 255;
    const peak = Math.max(1, r, g, b), light = (r + g + b) / 3;
    const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / peak;
    const redExcess = (r - g) / peak;
    if (confidence >= 0.5) coverage50++;
    if (confidence >= 0.8) coverage80++;
    confidenceTotal += confidence;
    valuesMetal.push(metal); valuesRough.push(rough);
    if (chroma < 0.2 && light >= 30 && (b - r) / peak > -0.15) { steelMetal.push(metal); steelRough.push(rough); }
    if (redExcess > 0.2 && light >= 20) { warmMetal.push(metal); warmRough.push(rough); }
  }
  const png = await sharp(packed.data, { raw: { width: packed.info.width, height: packed.info.height, channels: 3 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  return {
    png,
    size: [base.info.width, base.info.height],
    stats: {
      confidenceMean: Number((confidenceTotal / pixels).toFixed(3)),
      coverageAtLeast50: Number((coverage50 / pixels).toFixed(3)),
      coverageAtLeast80: Number((coverage80 / pixels).toFixed(3)),
      mapMetalness: summarize(valuesMetal), mapRoughness: summarize(valuesRough),
      steelMetalness: summarize(steelMetal), steelRoughness: summarize(steelRough),
      warmStrapMetalness: summarize(warmMetal), warmStrapRoughness: summarize(warmRough),
    },
  };
}

const catalogue = JSON.parse(await readFile(cataloguePath, 'utf8'));
assert.equal(catalogue.status, 'pending', 'only pending candidates may be retuned');
assert.equal(catalogue.pbrRetune, undefined, 'rebuild fresh GLBs before applying the mask a second time');
assert.equal(catalogue.assets.length, 5, 'expected all five fitted armor pieces');

const expectedIds = new Set(['cindersteel_helm', 'cindersteel_plate', 'cindersteel_gauntlets', 'cindersteel_greaves', 'cindersteel_boots']);
const prepared = [];
let sourceMaps;
let maskStats;
for (const entry of catalogue.assets) {
  assert(expectedIds.delete(entry.itemId), `unexpected or duplicate candidate ${entry.itemId}`);
  const file = path.resolve(candidateDir, entry.file);
  assert(file.startsWith(candidateDir + path.sep), `candidate path escaped its directory: ${entry.file}`);
  const originalBytes = await readFile(file);
  assert.equal(originalBytes.length, entry.bytes, `${entry.itemId}: stale candidate byte count`);
  assert.equal(hash(originalBytes), entry.sha256, `${entry.itemId}: stale candidate hash`);
  const document = await io.readBinary(originalBytes);
  const before = documentSignature(document);
  const materials = document.getRoot().listMaterials();
  assert(materials.length > 0, `${entry.itemId}: no materials`);
  for (const material of materials) {
    const base = material.getBaseColorTexture()?.getImage();
    const packedTexture = material.getMetallicRoughnessTexture();
    const packed = packedTexture?.getImage();
    const normal = material.getNormalTexture()?.getImage();
    assert(base && packed && normal, `${entry.itemId}/${material.getName()}: expected base, packed PBR, and normal maps`);
    const maps = { baseColor: hash(base), metallicRoughness: hash(packed), normal: hash(normal) };
    if (!sourceMaps) sourceMaps = maps;
    else assert.deepEqual(maps, sourceMaps, `${entry.itemId}: source atlas differs across armor pieces`);
    const tuned = await retune(base, packed);
    packedTexture.setImage(tuned.png).setMimeType('image/png');
    maskStats ??= { size: tuned.size, ...tuned.stats };
  }
  const output = await io.writeBinary(document);
  const reopened = await io.readBinary(output);
  assert.equal(documentSignature(reopened), before, `${entry.itemId}: retune changed geometry, UVs, rig, or node structure`);
  for (const material of reopened.getRoot().listMaterials()) {
    assert(material.getBaseColorTexture()?.getImage(), `${entry.itemId}: base-color binding was lost`);
    const packed = material.getMetallicRoughnessTexture();
    assert(packed?.getImage() && packed.getMimeType() === 'image/png', `${entry.itemId}: packed PBR binding was lost`);
    assert(material.getNormalTexture()?.getImage(), `${entry.itemId}: normal binding was lost`);
  }
  prepared.push({ file, output, entry, geometryPreserved: true, joints: reopened.getRoot().listSkins().map(skin => skin.listJoints().length) });
}
assert.equal(expectedIds.size, 0, `missing candidates: ${[...expectedIds].join(', ')}`);
assert(sourceMaps && maskStats, 'no material maps were processed');

for (const row of prepared) {
  await writeFile(row.file, row.output);
  row.entry.bytes = row.output.byteLength;
  row.entry.sha256 = hash(row.output);
}
const repoRoot = path.resolve(candidateDir, '../../../../../../..');
catalogue.pbrRetune = {
  profile,
  generator: {
    file: path.relative(repoRoot, scriptPath).replaceAll('\\', '/'),
    sha256: hash(await readFile(scriptPath)),
  },
  sourceMaps: {
    baseColorSha256: sourceMaps.baseColor,
    metallicRoughnessSha256: sourceMaps.metallicRoughness,
    normalSha256: sourceMaps.normal,
  },
  dimensions: maskStats.size,
  resolutionNote: 'Source exports are 1K; keep these maps at 1K until the requested 8K masters are downloaded.',
  channels: { roughness: 'G', metalness: 'B', redPreserved: true },
  target: { roughness: targetRoughness / 255, metalness: targetMetal / 255 },
  mask: {
    rule: '(1 - smoothstep(0.12, 0.23, chroma)) * smoothstep(28, 50, light) * (1 - smoothstep(0.13, 0.26, redExcess))',
    intent: 'neutral charcoal steel receives metal response; warm copper, leather, and cloth remain dielectric and rough',
  },
  stats: maskStats,
  geometryPreserved: prepared.every(row => row.geometryPreserved),
  rigJointCounts: Object.fromEntries(prepared.map(row => [row.entry.itemId, row.joints])),
};
await writeFile(cataloguePath, JSON.stringify(catalogue, null, 2) + '\n');
console.log(JSON.stringify({ profile, sourceMaps, dimensions: maskStats.size, stats: maskStats, candidates: prepared.map(({ entry, joints }) => ({ itemId: entry.itemId, bytes: entry.bytes, sha256: entry.sha256, joints })) }, null, 2));
