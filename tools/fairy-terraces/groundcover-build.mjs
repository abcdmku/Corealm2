/** Low native broadleaf mats with fairy moss palettes; original geometry and UVs retained. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Matrix4, Vector3 } from 'three';
import sharp from 'sharp';

const out = 'test-results/fairy-terraces-assets/groundcover';
await mkdir(`${out}/models`, { recursive: true });
await mkdir(`${out}/textures`, { recursive: true });
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const arrayHash = array => hash(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
const variants = [
  { id: 'fairy_groundcover_gloam_1', source: 'plant_broad_small', region: 'gloamgarden', hue: 158, saturation: .42, valueScale: .78 },
  { id: 'fairy_groundcover_gloam_2', source: 'plant_broad_large', region: 'gloamgarden', hue: 162, saturation: .40, valueScale: .87 },
  { id: 'fairy_groundcover_fae_1', source: 'plant_broad_small', region: 'faeholme', hue: 170, saturation: .42, valueScale: .80 },
  { id: 'fairy_groundcover_fae_2', source: 'plant_broad_large', region: 'faeholme', hue: 174, saturation: .40, valueScale: .88 },
];
function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = 0;
  if (delta) hue = max === r ? (g - b) / delta : max === g ? 2 + (b - r) / delta : 4 + (r - g) / delta;
  return [(hue * 60 + 360) % 360, max ? delta / max : 0, max / 255];
}
function hsvToRgb(hue, saturation, value) {
  const c = value * saturation, x = c * (1 - Math.abs((hue / 60) % 2 - 1)), m = value - c;
  const rgb = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return rgb.map(v => Math.round((v + m) * 255));
}
const assets = [], files = {}, packs = [];
for (const variant of variants) {
  const original = manifest.assets.find(entry => entry.id === variant.source);
  if (!original) throw Error(`Missing native groundcover ${variant.source}`);
  const sourcePath = `game/public/assets/${original.file}`, sourceBytes = await readFile(sourcePath);
  if (original.sha256 && hash(sourceBytes) !== original.sha256) throw Error('Native source hash mismatch');
  const doc = await io.readBinary(sourceBytes);
  const attributesBefore = doc.getRoot().listAccessors().map(accessor => ({ type: accessor.getType(),
    componentType: accessor.getComponentType(), normalized: accessor.getNormalized(), count: accessor.getCount(), hash: arrayHash(accessor.getArray()) }));
  const transformsBefore = doc.getRoot().listNodes().map(node => ({ name: node.getName(),
    translation: node.getTranslation(), rotation: node.getRotation(), scale: node.getScale() }));
  const materialsBefore = doc.getRoot().listMaterials().map(material => ({ name: material.getName(),
    baseColorFactor: material.getBaseColorFactor(), alphaMode: material.getAlphaMode(), alphaCutoff: material.getAlphaCutoff(),
    doubleSided: material.getDoubleSided(), roughness: material.getRoughnessFactor(), metallic: material.getMetallicFactor(),
    normalTexture: material.getNormalTexture()?.getName() ?? null, normalScale: material.getNormalScale() }));
  const material = doc.getRoot().listMaterials().find(material => material.getName() === 'Leaves');
  const texture = material?.getBaseColorTexture();
  if (!texture) throw Error('Native leaf material or texture is missing');
  const nativeImage = texture.getImage();
  const { data: sourcePixels, info } = await sharp(nativeImage).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = Buffer.from(sourcePixels);
  let changedPixels = 0, visibleChangedPixels = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const [hue, saturation, value] = rgbToHsv(...pixels.subarray(i, i + 3));
    if ((hue <= 63 || hue >= 240) && saturation > .25) {
      const warmHue = hue >= 340 ? hue - 360 : hue;
      const hueVariation = hue >= 240 && hue < 340 ? hue - 290 : warmHue - 25;
      // Keep the source's vein and shaded-leaf value variation. A small hue range
      // follows both warm leaves and the purple clover swatch used by these GLBs.
      pixels.set(hsvToRgb(variant.hue + hueVariation * .10,
        variant.saturation + (saturation - .7) * .05, value * variant.valueScale), i);
      changedPixels++; if (pixels[i + 3] > 128) visibleChangedPixels++;
    }
    if (pixels[i + 3] !== sourcePixels[i + 3]) throw Error('Source alpha changed');
  }
  if (visibleChangedPixels < 1000) throw Error('Expected leaf swatches were not recolored');
  const imageBytes = await sharp(pixels, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  // Keep texture names, UV transforms, alpha settings and all material factors.
  texture.setImage(imageBytes).setMimeType('image/png');
  const nativeMin = new Vector3(Infinity, Infinity, Infinity), nativeMax = new Vector3(-Infinity, -Infinity, -Infinity);
  let triangles = 0;
  const sampledColors = { direct: [], flipped: [] };
  const runtimeTexels = new Set();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const matrix = new Matrix4().fromArray(node.getWorldMatrix());
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION'), uv = primitive.getAttribute('TEXCOORD_0'), index = primitive.getIndices();
      triangles += (index?.getCount() ?? position.getCount()) / 3;
      for (let i = 0; i < position.getCount(); i++) {
        const point = new Vector3(...position.getElement(i, [])).applyMatrix4(matrix);
        nativeMin.min(point); nativeMax.max(point);
      }
      if (primitive.getMaterial() !== material) continue;
      for (let i = 0; i < (index?.getCount() ?? position.getCount()); i += 3) {
        const coords = [0, 1, 2].map(k => uv.getElement(index ? index.getScalar(i + k) : i + k, []));
        const u = coords.reduce((sum, pair) => sum + pair[0], 0) / 3;
        const v = coords.reduce((sum, pair) => sum + pair[1], 0) / 3;
        // GLTFLoader sets flipY=false. Direct UV.v is the source image row.
        // Rasterize every source UV triangle, not just its centroid, so a second
        // unconverted swatch cannot pass this asset audit again.
        const denominator = (coords[1][1] - coords[2][1]) * (coords[0][0] - coords[2][0])
          + (coords[2][0] - coords[1][0]) * (coords[0][1] - coords[2][1]);
        if (Math.abs(denominator) > 1e-12) {
          const minX = Math.max(0, Math.floor(Math.min(...coords.map(pair => pair[0])) * info.width));
          const maxX = Math.min(info.width - 1, Math.ceil(Math.max(...coords.map(pair => pair[0])) * info.width));
          const minY = Math.max(0, Math.floor(Math.min(...coords.map(pair => pair[1])) * info.height));
          const maxY = Math.min(info.height - 1, Math.ceil(Math.max(...coords.map(pair => pair[1])) * info.height));
          for (let row = minY; row <= maxY; row++) for (let x = minX; x <= maxX; x++) {
            const tu = (x + .5) / info.width, tv = (row + .5) / info.height;
            const a = ((coords[1][1] - coords[2][1]) * (tu - coords[2][0])
              + (coords[2][0] - coords[1][0]) * (tv - coords[2][1])) / denominator;
            const b = ((coords[2][1] - coords[0][1]) * (tu - coords[2][0])
              + (coords[0][0] - coords[2][0]) * (tv - coords[2][1])) / denominator;
            if (Math.min(a, b, 1 - a - b) < 0) continue;
            const offset = (row * info.width + x) * 4;
            if (sourcePixels[offset + 3] >= material.getAlphaCutoff() * 255) runtimeTexels.add(offset);
          }
        }
        for (const [key, y] of [['direct', v], ['flipped', 1 - v]]) {
          const x = Math.max(0, Math.min(info.width - 1, Math.floor(u * info.width)));
          const row = Math.max(0, Math.min(info.height - 1, Math.floor(y * info.height)));
          const offset = (row * info.width + x) * 4;
          sampledColors[key].push({ before: Array.from(sourcePixels.subarray(offset, offset + 4)), after: Array.from(pixels.subarray(offset, offset + 4)) });
        }
      }
    }
  }
  const runtimeColorAudit = { sampler: 'GLTFLoader flipY=false: source row=floor(UV.v*height), no vertical flip',
    sampledTexels: runtimeTexels.size, greenTexels: 0, remainingPurpleOrWarmTexels: 0, meanSourceRgb: [0, 0, 0], meanOutputRgb: [0, 0, 0] };
  for (const offset of runtimeTexels) {
    const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2];
    if (g >= r && g >= b) runtimeColorAudit.greenTexels++;
    const [hue, saturation] = rgbToHsv(r, g, b);
    if (saturation > .25 && (hue >= 240 || hue <= 63)) runtimeColorAudit.remainingPurpleOrWarmTexels++;
    for (let channel = 0; channel < 3; channel++) {
      runtimeColorAudit.meanSourceRgb[channel] += sourcePixels[offset + channel];
      runtimeColorAudit.meanOutputRgb[channel] += pixels[offset + channel];
    }
  }
  for (const key of ['meanSourceRgb', 'meanOutputRgb']) runtimeColorAudit[key] = runtimeColorAudit[key]
    .map(value => Math.round(value / runtimeTexels.size));
  if (runtimeTexels.size < 100 || runtimeColorAudit.greenTexels / runtimeTexels.size < .97
    || runtimeColorAudit.remainingPurpleOrWarmTexels > 0) throw Error(`Actual runtime UVs are not moss green: ${JSON.stringify(runtimeColorAudit)}`);
  const output = await io.writeBinary(doc), reread = await io.readBinary(output);
  const attributesAfter = reread.getRoot().listAccessors();
  if (attributesAfter.length !== attributesBefore.length) throw Error('Native accessor count changed');
  attributesBefore.forEach((before, index) => {
    const after = attributesAfter[index];
    if (before.type !== after.getType() || before.componentType !== after.getComponentType()
      || before.normalized !== after.getNormalized() || before.count !== after.getCount() || before.hash !== arrayHash(after.getArray()))
      throw Error(`Changed native geometry/UV/normal accessor ${index}`);
  });
  const transformsAfter = reread.getRoot().listNodes().map(node => ({ name: node.getName(),
    translation: node.getTranslation(), rotation: node.getRotation(), scale: node.getScale() }));
  if (JSON.stringify(transformsBefore) !== JSON.stringify(transformsAfter)) throw Error('Native model transforms changed');
  const materialsAfter = reread.getRoot().listMaterials().map(material => ({ name: material.getName(),
    baseColorFactor: material.getBaseColorFactor(), alphaMode: material.getAlphaMode(), alphaCutoff: material.getAlphaCutoff(),
    doubleSided: material.getDoubleSided(), roughness: material.getRoughnessFactor(), metallic: material.getMetallicFactor(),
    normalTexture: material.getNormalTexture()?.getName() ?? null, normalScale: material.getNormalScale() }));
  if (JSON.stringify(materialsBefore) !== JSON.stringify(materialsAfter)) throw Error('Native material factors changed');
  const finalImage = reread.getRoot().listMaterials().find(material => material.getName() === 'Leaves').getBaseColorTexture().getImage();
  const decodedPixels = await sharp(finalImage).ensureAlpha().raw().toBuffer();
  if (!decodedPixels.equals(pixels)) throw Error('PNG pixels changed in roundtrip');
  const size = nativeMax.clone().sub(nativeMin), id = variant.id;
  const pack = manifest.packs.find(pack => pack.id === original.pack);
  if (pack && !packs.some(entry => entry.id === pack.id)) packs.push(pack);
  const asset = { ...original, id, file: `models/fairy/${id}.glb`,
    category: 'nature', is: 'plant', tags: ['plant', 'groundcover', 'broadleaf', 'fairy', variant.region, 'undergrowth'],
    bytes: output.length, sha256: hash(output), size: { x: size.x, y: size.y, z: size.z },
    base: { x: nativeMin.x, y: nativeMin.y, z: nativeMin.z }, groundY: nativeMin.y, triangles,
    sourceProvenance: { sourceAsset: original.id, sourcePath, sourceSha256: hash(sourceBytes), sourcePack: original.pack,
      sourceTextureSha256: hash(nativeImage), palette: { hue: variant.hue, saturation: variant.saturation, valueScale: variant.valueScale },
      modifications: [
        'Red/orange and purple leaf atlas RGB pixels become moss teal-green. The native GLBs sample the purple clover swatch using direct UV.v.',
        'Alpha and non-target atlas pixels remain exact. Every visible texel in the direct runtime UV triangles is audited for green output.',
        'Native vertices, indices, UVs, normals, quantization, node transforms and all material factors retained exactly.',
        'Lossless PNG texture encoding. No replacement geometry, new normals, decimation, deformation or runtime axis scaling.' ],
      placement: 'GroundY equals the exact transformed source mesh minimum; use it once to place the low leaf mat at soil level.' },
    acceptance: { assetAudit: true, labAccepted: false, worldIntegrated: false } };
  await writeFile(`${out}/models/${id}.glb`, output);
  await writeFile(`${out}/textures/${id}_leaves.png`, imageBytes);
  await writeFile(`${out}/${id}.audit.json`, JSON.stringify({ asset, sourceManifestEntry: original,
    allGeometryAccessorsRoundtripExact: true, sourceUVsAndNormalsExact: true, transformsRoundtripExact: true,
    sourceAlphaExact: true, texturePixelsRoundtripExact: true, materialFactorsRoundtripExact: true,
    attributes: attributesBefore, transforms: transformsBefore,
    materialFactors: materialsBefore, texture: { width: info.width, height: info.height, changedPixels, visibleChangedPixels,
      bytes: imageBytes.length, sha256: hash(imageBytes), runtimeColorAudit, triangleCentroidSamples: sampledColors,
      flippedSamplesAreDiagnosticOnly: true } }, null, 2) + '\n');
  assets.push(asset); files[id] = `models/${id}.glb`;
  await writeFile(`${out}/candidates.json`, JSON.stringify({ packs, assets, files, browserErrors: [] }, null, 2) + '\n');
  console.log(JSON.stringify({ id, bytes: output.length, triangles, size: asset.size, groundY: asset.groundY,
    visibleChangedPixels, runtimeColorAudit, sha256: asset.sha256 }));
}
