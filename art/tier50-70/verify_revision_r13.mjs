import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, resolve, relative, isAbsolute, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import sharp from 'sharp';

// Read assets and provenance only. The sole output is the verification report.
// Run after all ten R13 candidates and both texture bakes have finished.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = 'runs/tier50-70/evidence/revision-r13.json';
const baselineDir = 'test-results/tier50-70/r12-final-baseline';
const themes = ['dragonhide', 'starhide'];
const pieces = ['hood', 'robe', 'leggings', 'boots', 'wraps'];
const opposite = theme => theme === 'dragonhide' ? 'starhide' : 'dragonhide';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const candidateRoot = theme => `art/item-models/candidates/armor-${theme}-reference`;
const currentFile = (theme, piece) => `${candidateRoot(theme)}/models/items/${theme}_${piece}.glb`;
const pathInRepo = file => {
  assert.equal(typeof file, 'string', 'Expected a repository-relative evidence path');
  assert(!isAbsolute(file), `Evidence path must be relative: ${file}`);
  const absolute = resolve(repo, file), local = relative(repo, absolute);
  assert(local && local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local), `Path escapes repository: ${file}`);
  return absolute;
};
const bytesAt = file => readFile(pathInRepo(file));
const jsonAt = async file => JSON.parse((await readFile(pathInRepo(file), 'utf8')).replace(/^\uFEFF/, ''));
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const digestObject = value => hash(JSON.stringify(stable(value)));

function parseGLB(bytes, file) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, `${file}: expected GLB`);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${file}: truncated GLB`);
  let raw, bin;
  for (let offset = 12; offset < bytes.length;) {
    assert(offset + 8 <= bytes.length);
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    assert(offset + 8 + length <= bytes.length);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) { assert(!raw); raw = JSON.parse(chunk.toString('utf8').trim()); }
    else if (type === 0x004e4942) { assert(!bin); bin = chunk; }
    offset += 8 + length;
  }
  assert(raw && bin, `${file}: expected embedded JSON and binary chunks`);
  assert.equal(raw.buffers?.length, 1);
  assert(!raw.buffers[0].uri, `${file}: external buffers are not allowed`);
  return {raw, bin};
}

function embeddedImage(glb, index) {
  const image = glb.raw.images?.[index];
  assert(image && Number.isInteger(image.bufferView) && !image.uri, 'Texture must be embedded');
  const view = glb.raw.bufferViews[image.bufferView];
  assert.equal(view.buffer ?? 0, 0);
  const start = view.byteOffset ?? 0, end = start + view.byteLength;
  assert(end <= glb.bin.length);
  return {description: image, bytes: glb.bin.subarray(start, end)};
}

function materialState(glb, material, replaceClothPixels = false) {
  const visit = (value, key = '') => {
    if (Array.isArray(value)) return value.map(entry => visit(entry));
    if (!value || typeof value !== 'object') return value;
    if (key.endsWith('Texture') && Number.isInteger(value.index)) {
      const texture = glb.raw.textures[value.index];
      assert(texture && Number.isInteger(texture.source), 'Expected ordinary embedded PBR texture');
      const image = embeddedImage(glb, texture.source);
      const {source, sampler, name, ...textureProperties} = texture;
      const {bufferView, ...imageProperties} = image.description;
      const {index, ...info} = value;
      return {
        ...visit(info),
        texture: {
          ...textureProperties,
          ...(!replaceClothPixels ? {name} : {}),
          sampler: glb.raw.samplers?.[sampler] ?? {},
          image: replaceClothPixels ? {mimeType: imageProperties.mimeType, replacement: 'provenanced-r13-cloth-map'}
            : {...imageProperties, sha256: hash(image.bytes)},
        },
      };
    }
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, visit(child, childKey)]));
  };
  return visit(material);
}

function accessorState(accessor, semanticName) {
  if (!accessor) return null;
  const array = accessor.getArray();
  assert(array, 'Accessor has no decoded data');
  return {name: semanticName(accessor.getName()), type: accessor.getType(), componentType: accessor.getComponentType(),
    normalized: accessor.getNormalized(), count: accessor.getCount(),
    sha256: hash(Buffer.from(array.buffer, array.byteOffset, array.byteLength))};
}

function geometryState(document, itemId) {
  const root = document.getRoot(), nodes = root.listNodes(), meshes = root.listMeshes(), skins = root.listSkins();
  const semanticName = name => {
    if (name === itemId) return '<item>';
    for (const suffix of ['native-male', 'joints', 'weights']) if (name === `${itemId}-${suffix}`) return `<item>-${suffix}`;
    return name;
  };
  const accessor = value => accessorState(value, semanticName);
  assert.equal(root.listAnimations().length, 0, `${itemId}: unexpected animation data`);
  assert.equal(root.listCameras().length, 0, `${itemId}: unexpected camera data`);
  return {
    // Semantic accessor data is compared at every use, independently of the
    // ordering or byte layout of the GLB's buffer views.
    meshes: meshes.map(mesh => ({name: semanticName(mesh.getName()), extras: mesh.getExtras(),
      weights: mesh.getWeights(), primitives: mesh.listPrimitives().map(primitive => ({
        mode: primitive.getMode(), material: primitive.getMaterial()?.getName(),
        indices: accessor(primitive.getIndices()),
        attributes: Object.fromEntries(primitive.listSemantics().sort().map(name => [name, accessor(primitive.getAttribute(name))])),
        targets: primitive.listTargets().map(target => Object.fromEntries(target.listSemantics().sort()
          .map(name => [name, accessor(target.getAttribute(name))]))), extras: primitive.getExtras(),
      }))})),
    nodes: nodes.map(node => ({name: semanticName(node.getName()), matrix: node.getMatrix(), extras: node.getExtras(),
      mesh: meshes.indexOf(node.getMesh()), skin: skins.indexOf(node.getSkin()), weights: node.getWeights(),
      children: node.listChildren().map(child => nodes.indexOf(child))})),
    skins: skins.map(skin => ({name: semanticName(skin.getName()), skeleton: nodes.indexOf(skin.getSkeleton()),
      joints: skin.listJoints().map(node => nodes.indexOf(node)), inverseBind: accessor(skin.getInverseBindMatrices()), extras: skin.getExtras()})),
    scenes: root.listScenes().map(scene => ({name: semanticName(scene.getName()), children: scene.listChildren().map(node => nodes.indexOf(node))})),
  };
}

const decodedCache = new Map();
async function decodedPixels(bytes) {
  const key = hash(bytes);
  if (!decodedCache.has(key)) decodedCache.set(key, (async () => {
    const {data, info} = await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject: true});
    assert.equal(info.channels, 4);
    assert.equal(info.width, 2048, 'Cloth map must be 2048 pixels wide');
    assert.equal(info.height, 2048, 'Cloth map must be 2048 pixels high');
    for (let i = 3; i < data.length; i += 4) assert.equal(data[i], 255, 'Cloth PBR maps must be opaque');
    return {data, width: info.width, height: info.height, pixelSha256: hash(data)};
  })());
  return decodedCache.get(key);
}

async function clothStats(colorBytes, normalBytes, packedBytes, designTheme) {
  const [color, normal, packed] = await Promise.all([colorBytes, normalBytes, packedBytes].map(decodedPixels));
  const pixels = color.width * color.height, tileSize = 64, tilesAcross = color.width / tileSize;
  const tileSums = new Float64Array(tilesAcross ** 2), tileCounts = new Uint32Array(tileSums.length);
  const base = {pixels: 0, roughness: 0, metallic: 0, rgb: [0, 0, 0], luminance: 0, luminanceSquare: 0, normalTiltSquare: 0};
  const thread = {pixels: 0, roughness: 0, metallic: 0, rgb: [0, 0, 0]};
  let maskedPixels = 0, neighborPairs = 0, neighborDifferenceSquare = 0, maxMetallic = 0;
  const luma = index => .2126 * color.data[index] + .7152 * color.data[index + 1] + .0722 * color.data[index + 2];
  for (let p = 0; p < pixels; p++) {
    const i = p * 4, roughness = packed.data[i + 1] / 255, metallic = packed.data[i + 2] / 255;
    assert.equal(packed.data[i], 255, 'Packed map R channel must remain unused white');
    assert(roughness >= .38 && roughness <= 1, 'Cloth roughness outside authored range');
    assert(metallic <= .61, 'Embroidery metallic response outside authored range');
    maxMetallic = Math.max(maxMetallic, metallic);
    if (packed.data[i + 2] > 1) maskedPixels++;
    const row = packed.data[i + 2] <= 1 ? base : metallic >= .55 ? thread : null;
    if (!row) continue;
    row.pixels++; row.roughness += roughness; row.metallic += metallic;
    for (let c = 0; c < 3; c++) row.rgb[c] += color.data[i + c];
    if (row === thread) { assert(roughness <= .58, 'Metallic stitch cores must be smoother than the fabric'); continue; }
    assert(roughness >= .90, 'Nonmetallic base fabric must remain rough');
    const value = luma(i), x = p % color.width, y = Math.floor(p / color.width);
    base.luminance += value; base.luminanceSquare += value * value;
    const nx = normal.data[i] / 127.5 - 1, ny = normal.data[i + 1] / 127.5 - 1, nz = normal.data[i + 2] / 127.5 - 1;
    assert(nz > 0, 'Cloth normal must face out of the tangent plane');
    base.normalTiltSquare += nx * nx + ny * ny;
    const tile = Math.floor(y / tileSize) * tilesAcross + Math.floor(x / tileSize);
    tileSums[tile] += value; tileCounts[tile]++;
    for (const q of [x + 1 < color.width ? p + 1 : -1, y + 1 < color.height ? p + color.width : -1]) {
      if (q < 0 || packed.data[q * 4 + 2] > 1) continue;
      neighborPairs++; neighborDifferenceSquare += (value - luma(q * 4)) ** 2;
    }
  }
  assert(base.pixels / pixels > .10, 'Missing substantial nonmetallic base fabric');
  assert(thread.pixels / pixels > .0001, 'Missing metallic embroidery cores');
  const mean = base.luminance / base.pixels;
  const summarize = row => ({pixels: row.pixels, fraction: row.pixels / pixels,
    meanRoughness: row.roughness / row.pixels, meanMetallic: row.metallic / row.pixels,
    meanSRGB: row.rgb.map(value => value / row.pixels)});
  const baseCloth = summarize(base), embroidery = summarize(thread), dominant = designTheme === 'dragonhide' ? 0 : 2;
  assert(baseCloth.meanSRGB.every((value, c) => c === dominant || baseCloth.meanSRGB[dominant] > value), 'Base dye left its design color family');
  assert(embroidery.meanSRGB[0] > embroidery.meanSRGB[1] && embroidery.meanSRGB[1] > embroidery.meanSRGB[2], 'Metallic mask is not on warm embroidery');
  const tileMeans = Array.from(tileCounts, (count, i) => count >= tileSize ** 2 * .75 ? tileSums[i] / count : null).filter(value => value !== null);
  assert(tileMeans.length > 0);
  const tileMean = tileMeans.reduce((sum, value) => sum + value, 0) / tileMeans.length;
  return {baseCloth, embroidery, metallicMaskCoverage: maskedPixels / pixels, maxMetallic,
    noise: {
      baseLuminanceCoefficientVariation: Math.sqrt(Math.max(0, base.luminanceSquare / base.pixels - mean ** 2)) / mean,
      baseNeighborLuminanceRmsRelative: Math.sqrt(neighborDifferenceSquare / neighborPairs) / mean,
      base64PixelTileMeanCoefficientVariation: Math.sqrt(tileMeans.reduce((sum, value) => sum + (value - tileMean) ** 2, 0) / tileMeans.length) / tileMean,
      baseNormalTiltRms: Math.sqrt(base.normalTiltSquare / base.pixels), tileSamples: tileMeans.length,
    }, pixelSha256: {color: color.pixelSha256, normal: normal.pixelSha256, packed: packed.pixelSha256},
    method: 'Base pixels have metallic byte <=1; embroidery cores have metallic >=.55. Color means use sRGB bytes. Noise excludes embroidery, compares adjacent base pixels and 64-pixel tiles, and reports tangent-normal XY RMS. These are texture estimates, not visual acceptance.'};
}

const report = {round: 'r13', date: new Date().toISOString(), passed: false,
  scope: 'Read-only data verification of the full design swap and R13 cloth maps. No rendering, gameplay checks, visual acceptance, or production promotion.',
  designByItemTheme: {dragonhide: {tier: 50, designTheme: 'starhide', color: 'blue'}, starhide: {tier: 70, designTheme: 'dragonhide', color: 'red'}},
  baselineDirectory: baselineDir, currentFiles: [], clothProvenance: [], assets: [], errors: [],
  catalogApprovalTagException: ['reference-tailored-candidate', 'tier50-70-tailored-approved'],
  gameplayStats: {checked: false, reason: 'The preserved catalogs identify items but do not contain a preserved gameplay-stat source. This verifier checks item IDs and wearable/catalog semantics only.'},
};
async function checked(label, action) {
  try { return await action(); }
  catch (error) { report.errors.push({check: label, message: String(error.message ?? error).slice(0, 3000)}); return null; }
}

const baselineCatalogs = new Map(), currentCatalogs = new Map(), provenanceByDesign = new Map();
for (const theme of themes) {
  const before = await checked(`${theme} baseline catalog`, () => jsonAt(`${baselineDir}/${theme}-catalogue.json`));
  const after = await checked(`${theme} current catalog`, () => jsonAt(`${candidateRoot(theme)}/catalogue.json`));
  if (before) baselineCatalogs.set(theme, before);
  if (after) currentCatalogs.set(theme, after);
}
for (const itemTheme of themes) for (const piece of pieces) {
  const file = currentFile(itemTheme, piece), itemId = `${itemTheme}_${piece}`;
  await checked(`${itemId} current file hash`, async () => {
    const bytes = await bytesAt(file); report.currentFiles.push({itemId, file, bytes: bytes.length, sha256: hash(bytes)});
  });
}

for (const designTheme of themes) await checked(`${designTheme} R13 cloth provenance`, async () => {
  const file = `art/tier50-70/textures/${designTheme}/provenance.json`, provenanceBytes = await bytesAt(file), provenance = await jsonAt(file);
  const source = provenance.clothSource, sourceRoot = 'art/tier50-70/textures/imagegen-r13';
  assert.equal(source.mode, 'built-in image_gen');
  assert.equal(source.sourceImage, `${sourceRoot}/${designTheme}-embroidered-source.png`);
  assert.equal(source.promptFile, `${sourceRoot}/${designTheme}-embroidered-prompt.txt`);
  assert.equal(source.colorSourceImage, source.sourceImage); assert.equal(source.colorPromptFile, source.promptFile);
  for (const [pathKey, hashKey] of [['sourceImage', 'sourceSha256'], ['promptFile', 'promptSha256'],
    ['colorSourceImage', 'colorSourceSha256'], ['colorPromptFile', 'colorPromptSha256'],
    ['referenceImage', 'referenceSha256'], ['editTargetImage', 'editTargetSha256']]) {
    assert.equal(hash(await bytesAt(source[pathKey])), source[hashKey], `${designTheme}: stale ${hashKey}`);
  }
  assert((await bytesAt(source.promptFile)).toString('utf8').trim().length > 20, 'Missing image-generation prompt');
  assert.equal(source.baker, 'tools/item-models/tier50-70/materials-imagegen.ts');
  assert.deepEqual(source.resolution, [2048, 2048]);
  assert.deepEqual(source.heightGains, {broad: .010, medium: .0007, yarn: .00018, stitch: .0008});
  assert.equal(source.dyeMeanSRGB, designTheme === 'dragonhide' ? '#571827' : '#25355d');
  assert(source.method.includes('not measured'), 'Provenance must distinguish inferred relief from measured material data');
  assert.equal(source.packedMaterial.file, 'cloth-roughness.png');
  assert.deepEqual(source.packedMaterial.channels, {R: 'unused white', G: 'roughness', B: 'metallic'});
  assert.deepEqual(source.packedMaterial.baseCloth, {metallic: 0, roughness: [.92, .99]});
  assert.deepEqual(source.packedMaterial.embroidery, {maxMetallic: .58, roughness: .46});
  const mapNames = ['cloth-color.png', 'cloth-normal.png', 'cloth-roughness.png'];
  const declared = provenance.files.filter(row => row.file.startsWith('cloth-'));
  assert.deepEqual(declared.map(row => row.file).sort(), [...mapNames].sort());
  const maps = [];
  for (const name of mapNames) {
    const mapFile = `art/tier50-70/textures/${designTheme}/${name}`, bytes = await bytesAt(mapFile), entry = declared.find(row => row.file === name);
    assert.equal(entry.width, 2048); assert.equal(entry.height, 2048); assert.equal(hash(bytes), entry.sha256);
    const pixels = await decodedPixels(bytes);
    maps.push({file: mapFile, sha256: entry.sha256, width: pixels.width, height: pixels.height, pixelSha256: pixels.pixelSha256});
  }
  const stats = await clothStats(...await Promise.all(mapNames.map(name => bytesAt(`art/tier50-70/textures/${designTheme}/${name}`))), designTheme);
  const baselineFile = `${baselineDir}/${designTheme}_hood.glb`, baselineBytes = await bytesAt(baselineFile);
  const baselineAsset = baselineCatalogs.get(designTheme)?.assets.find(asset => asset.itemId === `${designTheme}_hood`);
  assert(baselineAsset); assert.equal(hash(baselineBytes), baselineAsset.sha256, 'R12 baseline is not the preserved catalog asset');
  const baselineDocument = await io.readBinary(baselineBytes);
  const baselineCloth = baselineDocument.getRoot().listMaterials().find(material => material.getName() === `${designTheme}-close-twill-cloth`);
  assert(baselineCloth);
  const priorStats = await clothStats(baselineCloth.getBaseColorTexture().getImage(), baselineCloth.getNormalTexture().getImage(), baselineCloth.getMetallicRoughnessTexture().getImage(), designTheme);
  const noiseChanges = Object.fromEntries(Object.keys(stats.noise).filter(key => key !== 'tileSamples').map(key => [key,
    {r12: priorStats.noise[key], r13: stats.noise[key], ratio: stats.noise[key] / priorStats.noise[key], reduced: stats.noise[key] < priorStats.noise[key]}]));
  const entry = {designTheme, usedByItemTheme: opposite(designTheme), file, sha256: hash(provenanceBytes), clothSource: source,
    bakerSha256: hash(await bytesAt(source.baker)), maps, stats,
    textureIntentMeasurements: {baselineFile, baselineSha256: hash(baselineBytes), noiseChanges,
      embroideryCoreFraction: {r12: priorStats.embroidery.fraction, r13: stats.embroidery.fraction,
        ratio: stats.embroidery.fraction / priorStats.embroidery.fraction, increased: stats.embroidery.fraction > priorStats.embroidery.fraction},
      metallicMaskCoverage: {r12: priorStats.metallicMaskCoverage, r13: stats.metallicMaskCoverage},
      visualAcceptance: false, note: 'Trend measurements are reported without treating a coverage ratio as proof of slightly more embroidery or a texture statistic as proof of full-view appearance.'}};
  provenanceByDesign.set(designTheme, entry); report.clothProvenance.push(entry);
});

for (const itemTheme of themes) for (const piece of pieces) await checked(`${itemTheme}_${piece} opposite R12 comparison`, async () => {
  const itemId = `${itemTheme}_${piece}`, designTheme = opposite(itemTheme), baselineId = `${designTheme}_${piece}`;
  const file = currentFile(itemTheme, piece), baselineFile = `${baselineDir}/${baselineId}.glb`;
  const [currentBytes, baselineBytes] = await Promise.all([bytesAt(file), bytesAt(baselineFile)]);
  const inventory = report.currentFiles.find(row => row.itemId === itemId);
  assert(inventory); assert.equal(hash(currentBytes), inventory.sha256, 'Candidate changed during verification');
  const currentCatalog = currentCatalogs.get(itemTheme), identityCatalog = baselineCatalogs.get(itemTheme), styleCatalog = baselineCatalogs.get(designTheme);
  assert(currentCatalog && identityCatalog && styleCatalog, 'Required catalog did not load');
  const current = currentCatalog.assets.find(asset => asset.itemId === itemId);
  const identity = identityCatalog.assets.find(asset => asset.itemId === itemId);
  const style = styleCatalog.assets.find(asset => asset.itemId === baselineId);
  assert(current && identity && style, 'Missing piece in candidate or baseline catalog');
  assert.equal(current.sha256, inventory.sha256); assert.equal(current.bytes, currentBytes.length);
  assert.equal(style.sha256, hash(baselineBytes)); assert.equal(style.bytes, baselineBytes.length);
  for (const key of ['id', 'file', 'pack', 'category', 'is', 'itemId', 'itemModel']) assert.deepEqual(current[key], identity[key], `${itemId}: catalog identity changed at ${key}`);
  const identityTags = tags => tags.filter(tag => !report.catalogApprovalTagException.includes(tag));
  assert.deepEqual(identityTags(current.tags), identityTags(identity.tags), `${itemId}: catalog identity tags changed`);
  for (const key of ['size', 'base', 'animations', 'materials', 'triangles', 'drawCalls', 'tailoredSkirtVertices']) assert.deepEqual(current[key], style[key], `${itemId}: opposite design catalog mismatch at ${key}`);
  const [before, after] = await Promise.all([io.readBinary(baselineBytes), io.readBinary(currentBytes)]);
  const beforeState = geometryState(before, baselineId), afterState = geometryState(after, itemId);
  assert.deepEqual(afterState, beforeState, `${itemId}: geometry, topology, material mapping, source parts, UVs, or rig differs from opposite R12`);
  const scenes = after.getRoot().listScenes(); assert.equal(scenes.length, 1);
  const metadata = scenes[0].getExtras().itemModel;
  assert.equal(metadata.itemId, itemId); assert.equal(metadata.author, `armor-${itemTheme}-reference`);
  assert.equal(metadata.designTheme, designTheme); assert.equal(metadata.reference, `art/item-icons/generated/${baselineId}.png`);
  assert.equal(metadata.wearable, true); assert.deepEqual(metadata.bodyCoverage, style.metadata.bodyCoverage);
  const oldGLB = parseGLB(baselineBytes, baselineFile), newGLB = parseGLB(currentBytes, file);
  assert.equal(oldGLB.raw.materials.length, newGLB.raw.materials.length);
  let nonClothMaterials = 0, scaleMaterials = 0;
  for (let index = 0; index < oldGLB.raw.materials.length; index++) {
    const oldMaterial = oldGLB.raw.materials[index], material = newGLB.raw.materials[index];
    assert.equal(material.name, oldMaterial.name, 'Material order/name changed');
    const cloth = material.name === `${designTheme}-close-twill-cloth`;
    assert.deepEqual(materialState(newGLB, material, cloth), materialState(oldGLB, oldMaterial, cloth),
      `${itemId}: ${cloth ? 'cloth physical parameters or mapping' : 'noncloth material, finish, texture or metadata'} changed at ${material.name}`);
    if (!cloth) nonClothMaterials++;
    if (material.name.includes('-scute-')) scaleMaterials++;
  }
  assert.equal(scaleMaterials, 6);
  const cloth = after.getRoot().listMaterials().find(material => material.getName() === `${designTheme}-close-twill-cloth`);
  const provenance = provenanceByDesign.get(designTheme); assert(cloth && provenance, 'Missing verified cloth material/provenance');
  assert.deepEqual(cloth.getBaseColorFactor(), [1, 1, 1, 1]);
  assert.equal(cloth.getMetallicFactor(), 1); assert.equal(cloth.getRoughnessFactor(), 1);
  assert.equal(cloth.getExtension('KHR_materials_ior')?.getIOR(), 1.3);
  assert.deepEqual(cloth.getEmissiveFactor(), [0, 0, 0]);
  assert.equal(cloth.getExtension('KHR_materials_clearcoat')?.getClearcoatFactor() ?? 0, 0);
  assert.deepEqual(cloth.getExtension('KHR_materials_sheen')?.getSheenColorFactor() ?? [0, 0, 0], [0, 0, 0]);
  const embedded = [cloth.getBaseColorTexture(), cloth.getNormalTexture(), cloth.getMetallicRoughnessTexture()];
  const embeddedMaps = [];
  for (let index = 0; index < embedded.length; index++) {
    assert(embedded[index]); const pixels = await decodedPixels(embedded[index].getImage());
    assert.equal(pixels.pixelSha256, provenance.maps[index].pixelSha256, `${itemId}: embedded cloth pixels differ from ${provenance.maps[index].file}`);
    embeddedMaps.push({role: ['baseColor', 'normal', 'packedRoughnessMetallic'][index], width: pixels.width, height: pixels.height,
      pixelSha256: pixels.pixelSha256, bakedMap: provenance.maps[index].file});
  }
  let triangles = 0;
  for (const mesh of after.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    assert.equal(primitive.getMode(), 4); triangles += (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION').getCount()) / 3;
  }
  assert(Number.isInteger(triangles) && triangles > 0 && triangles <= 150000); assert.equal(triangles, current.triangles);
  report.assets.push({itemId, tier: itemTheme === 'dragonhide' ? 50 : 70, designTheme, file, sha256: inventory.sha256,
    baselineItemId: baselineId, baselineFile, baselineSha256: hash(baselineBytes),
    geometrySha256: digestObject(afterState), exactOppositeR12GeometryTopologyUVSkinAndMaterialMapping: true,
    exactOppositeR12NonClothMaterialsAndTextureBytes: true, itemCatalogIdentityPreserved: true,
    triangles, nonClothMaterials, scaleMaterials, embeddedClothMaps: embeddedMaps});
});

report.passed = report.errors.length === 0 && report.currentFiles.length === 10 && report.assets.length === 10 && report.clothProvenance.length === 2;
await mkdir(dirname(pathInRepo(output)), {recursive: true});
await writeFile(pathInRepo(output), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({passed: report.passed, assets: report.assets.length, currentFileHashes: report.currentFiles.length,
  scaleMaterials: report.assets.reduce((sum, asset) => sum + asset.scaleMaterials, 0), report: output,
  errors: report.errors.map(error => ({check: error.check, message: error.message.split('\n')[0]}))}));
if (!report.passed) process.exitCode = 1;
