/** Native BK fine grass tufts and a damp grass floor surface. Staged assets only. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { Box3, Vector3 } from 'three';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTTextureWebP } from '@gltf-transform/extensions';
import sharp from 'sharp';

const out = 'test-results/fairy-terraces-assets/finegrass';
const packageInfo = JSON.parse(await readFile('.asset-cache/fairy-terraces/unity/sources.json', 'utf8'))
  .find(p => p.package.includes('Pure Nature 2'));
const base = `${packageInfo.directory}/Assets/BK/PureNature_AsianMountains`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const arrayHash = array => hash(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const linear = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const io = new NodeIO().registerExtensions([EXTTextureWebP]);
for (const folder of ['models', 'textures', 'textures/fairy-ground']) await mkdir(`${out}/${folder}`, { recursive: true });
const pack = { id: 'bk-pure-nature-asian-mountains', name: packageInfo.package, author: 'BK',
  source: 'https://assetstore.unity.com/packages/3d/environments/pure-nature-2-asian-mountains-341972',
  license: 'Standard Unity Asset Store EULA', assetStoreId: '341972', sourceArchive: packageInfo.archive,
  archiveSha256: packageInfo.sha256, acquiredVersion: '1.1' };
const nativeRecord = async path => ({ path, sha256: hash(await readFile(path)) });
const variants = [
  { id: 'fairy_finegrass_gloam_1', source: 0, region: 'gloamgarden', tint: [105, 148, 115] },
  { id: 'fairy_finegrass_gloam_2', source: 1, region: 'gloamgarden', tint: [116, 156, 126] },
  { id: 'fairy_finegrass_fae_1', source: 0, region: 'faeholme', tint: [109, 148, 134] },
  { id: 'fairy_finegrass_fae_2', source: 1, region: 'faeholme', tint: [121, 157, 143] },
];
const assets = [], files = {};
const surfacesOnly = process.argv.includes('--surfaces-only');
if (surfacesOnly) {
  const existing = JSON.parse(await readFile(`${out}/candidates.json`, 'utf8'));
  assets.push(...existing.assets); Object.assign(files, existing.files);
}
const alphaPath = `${base}/Models/Plants/Textures/Grass_a.png`;
const { data: sourcePixels, info: atlasInfo } = await sharp(alphaPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (const variant of (surfacesOnly ? [] : variants)) {
  const modelFile = `${base}/Models/Plants/Grass_${variant.source}.fbx`;
  const bytes = await readFile(modelFile);
  const imported = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  imported.updateMatrixWorld(true);
  const meshes = []; imported.traverse(node => { if (node.isMesh) meshes.push(node); });
  if (meshes.length !== 1) throw Error('Native tuft must contain one mesh');
  const mesh = meshes[0], geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  if (geometry.index) throw Error('Unexpected indexed native tuft');
  geometry.scale(.01, .01, .01);
  const bounds = new Box3().setFromBufferAttribute(geometry.attributes.position), size = bounds.getSize(new Vector3());
  const document = new Document(), buffer = document.createBuffer(), scene = document.createScene(variant.id);
  document.createExtension(EXTTextureWebP).setRequired(true);
  const pixels = Buffer.from(sourcePixels);
  for (let i = 0; i < pixels.length; i += 4) for (let k = 0; k < 3; k++) {
    // The native atlas is grey/white: source Unity material multiplies it by two
    // grass colours. Preserve the source blade veins and every alpha texel.
    pixels[i + k] = Math.round(sourcePixels[i + k] * variant.tint[k] / 255);
  }
  // FBX UVs have bottom-up V. Keep them exact and flip the image rows for glTF's
  // top-down image origin (GLTFLoader flipY=false). This is not a GLB UV edit.
  const flipped = await sharp(pixels, { raw: { width: atlasInfo.width, height: atlasInfo.height, channels: 4 } })
    .flip().raw().toBuffer();
  const image = await sharp(flipped, { raw: { width: atlasInfo.width, height: atlasInfo.height, channels: 4 } })
    .webp({ lossless: true, alphaQuality: 100 }).toBuffer();
  const decoded = await sharp(image).ensureAlpha().raw().toBuffer();
  let visibleTexels = 0;
  for (let i = 0; i < decoded.length; i += 4) {
    if (decoded[i + 3] !== flipped[i + 3]) throw Error('Native alpha changed');
    if (decoded[i + 3] < 128) continue;
    visibleTexels++;
    for (let k = 0; k < 3; k++) if (decoded[i + k] !== flipped[i + k]) throw Error('Visible texture colour changed during encoding');
    if (decoded[i + 1] < decoded[i] || decoded[i + 1] < decoded[i + 2]) throw Error('Visible grass is not green');
  }
  const textureFile = `textures/${variant.id}_albedo.webp`; await writeFile(`${out}/${textureFile}`, image);
  const texture = document.createTexture(`${variant.id}_albedo`).setImage(image).setMimeType('image/webp');
  const material = document.createMaterial(`${variant.id}_cutout`).setBaseColorTexture(texture)
    .setAlphaMode('MASK').setAlphaCutoff(.5).setDoubleSided(true).setRoughnessFactor(.92).setMetallicFactor(0);
  const accessor = (name, type, array) => document.createAccessor(name).setType(type).setArray(array).setBuffer(buffer);
  const primitive = document.createPrimitive().setMaterial(material), expected = {};
  for (const [native, semantic, type] of [['position', 'POSITION', 'VEC3'], ['normal', 'NORMAL', 'VEC3'],
    ['uv', 'TEXCOORD_0', 'VEC2'], ['uv1', 'TEXCOORD_1', 'VEC2']]) {
    if (!geometry.attributes[native]) continue;
    const values = Float32Array.from(geometry.attributes[native].array);
    expected[semantic] = values; primitive.setAttribute(semantic, accessor(`Native ${semantic}`, type, values));
  }
  // Native red vertex colours control Unity wind, not visible grass pigment.
  // Retain their bytes as a custom attribute for provenance, not COLOR_0.
  if (geometry.attributes.color) {
    const values = Float32Array.from(geometry.attributes.color.array);
    expected._SOURCE_WIND = values; primitive.setAttribute('_SOURCE_WIND', accessor('Native wind data', 'VEC3', values));
  }
  scene.addChild(document.createNode(variant.id).setMesh(document.createMesh(mesh.name).addPrimitive(primitive)));
  document.getRoot().setDefaultScene(scene);
  const result = await io.writeBinary(document), reread = await io.readBinary(result);
  const outputPrimitive = reread.getRoot().listMeshes()[0].listPrimitives()[0];
  const attributes = {};
  for (const [semantic, expectedArray] of Object.entries(expected)) {
    const actual = outputPrimitive.getAttribute(semantic).getArray();
    if (actual.length !== expectedArray.length || actual.some((v, i) => v !== expectedArray[i])) throw Error(`Changed ${semantic}`);
    attributes[semantic] = { count: actual.length, sha256: arrayHash(actual), roundtripExact: true };
  }
  const file = `models/${variant.id}.glb`; await writeFile(`${out}/${file}`, result); files[variant.id] = file;
  const sourceFiles = await Promise.all([modelFile, `${modelFile}.meta`, alphaPath,
    `${base}/Models/Plants/Textures/Grass_n.png`, `${base}/Models/Plants/Textures/Materials/_Grass.mat`,
    `${base}/Prefabs/Plants/Grass_${variant.source}.prefab`].map(nativeRecord));
  const asset = { id: variant.id, name: `Damp fine grass ${variant.source + 1}`, pack: pack.id, category: 'nature', is: 'plant',
    file: `models/fairy/${variant.id}.glb`, tags: ['grass', 'fine-blades', 'fairy', variant.region, 'source-derived'],
    bytes: result.length, sha256: hash(result), size: { x: size.x, y: size.y, z: size.z },
    base: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z }, groundY: 0,
    triangles: geometry.attributes.position.count / 3, materials: [material.getName()], animations: [],
    sourceProvenance: { archive: packageInfo.archive, archiveSha256: packageInfo.sha256, model: modelFile,
      sourceMesh: mesh.name, sourceFiles, leafPaletteSrgb: variant.tint,
      modifications: ['Exact native tuft geometry, normals, UV0 and UV1; FBX centimetres uniformly converted to metres.',
        'Original authored origin and ground line retained; negative root vertices belong below soil.',
        'Native white blade atlas multiplied by a damp green palette. Original alpha retained exactly, image rows flipped for glTF.',
        'Native Unity wind vertex channel preserved as _SOURCE_WIND, rather than incorrectly rendering it as COLOR_0.',
        'Native upward mesh normals retained. Unity world-space normal noise is not baked into the model or misapplied through blade UVs.'],
      placement: 'AssetRegistry groundY=0 restores native soil contact. Suggested uniform scales .55–.8 for 14–24cm visible blades; use sparse shoulder/bank pockets.' },
    acceptance: { assetAudit: true, labAccepted: false, worldIntegrated: false } };
  const audit = { asset, attributes, originalUvRoundtripExact: true, nativeTopologyExact: true,
    nativeRootAndGroundLineRetained: true, visibleHeightAboveSoil: bounds.max.y,
    sourceNormalTextureMode: 'Unity world XZ * .02, strength .185; not an atlas-mapped blade normal.',
    texture: { file: textureFile, sha256: hash(image), width: atlasInfo.width, height: atlasInfo.height,
      alphaExact: true, visibleColoursRoundtripExact: true, visibleTexels, greenVisibleTexels: visibleTexels } };
  assets.push(asset); await writeFile(`${out}/${variant.id}.audit.json`, JSON.stringify(audit, null, 2) + '\n');
}

function hsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const h = !delta ? 0 : max === r ? (g - b) / delta : max === g ? 2 + (b - r) / delta : 4 + (r - g) / delta;
  return [(h * 60 + 360) % 360, max ? delta / max : 0, max / 255];
}
function rgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  return (h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]).map(a => Math.round((a + m) * 255));
}
function pixelStatistics(pixels, width, height) {
  const count = width * height, sums = [0, 0, 0], squares = [0, 0, 0], meanLinearRgb = [0, 0, 0];
  let edgeSum = 0, edges = 0;
  for (let i = 0; i < pixels.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      sums[k] += pixels[i + k]; squares[k] += pixels[i + k] ** 2;
      meanLinearRgb[k] += linear(pixels[i + k] / 255);
    }
    if ((i / 3) % width < width - 1) { edgeSum += Math.abs(pixels[i + 1] - pixels[i + 4]); edges++; }
  }
  return { meanSrgb: sums.map(v => v / count), standardDeviationSrgb: sums.map((v, k) => Math.sqrt(squares[k] / count - (v / count) ** 2)),
    meanLinearRgb: meanLinearRgb.map(v => v / count), meanAdjacentGreenDifference: edgeSum / edges };
}
const floorVariants = [
  { id: 'fine-stem-turf', directory: 'fairy-ground', diffuse: 'Grass_silvergrass.png', normal: 'Grass_silvergrass_n.png', tileMetres: 2.5,
    recolor: ([h, s, v]) => rgb(clamp(118 + (h - 62) * .7, 110, 150), clamp(.33 + .15 * (s - .3)), v * .78),
    description: 'Native densely layered fine grass stems and leaves. Warm pale stems recolored to restrained living green; source leaf/background value contrast retained.' },
  { id: 'small-leaf-turf', directory: 'fairy-ground-leaf-turf', diffuse: 'Grass_deadleaves_a.png', normal: 'Grass_deadleaves_n.png', tileMetres: 2.25,
    recolor: ([h, s, v]) => rgb(h < 65 ? 137 + (h - 35) * .25 : h + 54, clamp(s * .66), v * .82),
    description: 'Native small leaf litter and low turf. Warm leaves recolored green, with source leaf shadows and bare soil interruptions retained.' },
];
const surfaceVariants = [];
for (const variant of floorVariants) {
  const surfaceSource = `${base}/Textures/Surfaces/${variant.diffuse}`, normalSource = `${base}/Textures/Surfaces/${variant.normal}`;
  // The silvergrass diffuse is native 16-bit RGBA. Convert to display RGB8 and
  // resize both aligned maps together; no synthetic texture or geometry is added.
  const { data: originalSurface, info } = await sharp(surfaceSource).toColourspace('srgb').removeAlpha()
    .resize(2048, 2048, { kernel: 'lanczos3' }).raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  const surfacePixels = Buffer.from(originalSurface);
  for (let i = 0; i < surfacePixels.length; i += 3) surfacePixels.set(variant.recolor(hsv(...originalSurface.subarray(i, i + 3))), i);
  const groundDir = `${out}/textures/${variant.directory}`;
  await mkdir(groundDir, { recursive: true });
  const albedo = await sharp(surfacePixels, { raw: { width: info.width, height: info.height, channels: 3 } })
    .webp({ lossless: true }).toBuffer();
  const normalPixels = await sharp(normalSource).removeAlpha().resize(info.width, info.height, { kernel: 'lanczos3' })
    .raw({ depth: 'uchar' }).toBuffer();
  const normal = await sharp(normalPixels, { raw: { width: info.width, height: info.height, channels: 3 } })
    .webp({ lossless: true }).toBuffer();
  await writeFile(`${groundDir}/grass-albedo.webp`, albedo); await writeFile(`${groundDir}/grass-normal.webp`, normal);
  if (!(await sharp(albedo).removeAlpha().raw().toBuffer()).equals(surfacePixels)) throw Error('Floor diffuse changed during encoding');
  if (!(await sharp(normal).removeAlpha().raw().toBuffer()).equals(normalPixels)) throw Error('Floor normal changed during encoding');
  const statistics = pixelStatistics(surfacePixels, info.width, info.height);
  const sourceStatistics = pixelStatistics(originalSurface, info.width, info.height);
  if (statistics.standardDeviationSrgb[1] < 12) throw Error('Floor candidate still lacks native leaf/stem value contrast');
  const surface = { id: variant.id, stagedDirectory: groundDir, meanLinearRgb: statistics.meanLinearRgb, tileMetres: variant.tileMetres,
    sourceTileMetres: null, width: info.width, height: info.height,
    albedo: 'grass-albedo.webp', normal: 'grass-normal.webp', normalEncoding: 'RGB tangent normal; linear/no color-space transform; decode rgb*2-1.',
    floorTilingDecision: `Authored ${variant.tileMetres}m floor repeat gives small leaves/stems. No material binding establishes a native floor scale for this source surface.`,
    textureOrientation: 'Both surface maps retain matching original source rows and identical spatial registration.',
    sourceProvenance: { pack: pack.id, archive: packageInfo.archive, archiveSha256: packageInfo.sha256,
      sourceFiles: await Promise.all([surfaceSource, normalSource, `${surfaceSource}.meta`, `${normalSource}.meta`].map(nativeRecord)),
      modifications: [variant.description, 'Native diffuse and matching normal resized together to 2048x2048; all source spatial composition retained.',
        'Lossless WebP after RGB8 palette conversion; no new clouds/noise, leaf shapes, stems, or geometry.'] },
    contrastAudit: { source: sourceStatistics, staged: statistics, minimumGreenStandardDeviation: 12,
      earlierGrass01SourceGreenStd: 4.2340925803, earlierGrass01RecoloredGreenStd: 3.8875325638 },
    sha256: { albedo: hash(albedo), normal: hash(normal) }, bytes: { albedo: albedo.length, normal: normal.length },
    acceptance: { pixelAudit: true, labAccepted: false, worldIntegrated: false } };
  surfaceVariants.push(surface);
  await writeFile(`${groundDir}/grass-surface.json`, JSON.stringify(surface, null, 2) + '\n');
}
const surface = surfaceVariants[0];
for (const asset of assets) {
  // A surface-only correction must never silently rewrite or invalidate the
  // native tuft geometry already accepted in the lab and placed in the world.
  if (hash(await readFile(`${out}/${files[asset.id]}`)) !== asset.sha256) throw Error(`Tuft hash changed: ${asset.id}`);
}
await writeFile(`${out}/candidates.json`, JSON.stringify({ packs: [pack], assets, files, surface, surfaceVariants }, null, 2) + '\n');
console.log(JSON.stringify({ out, tuftHashesUnchanged: true,
  surfaces: surfaceVariants.map(({ id, stagedDirectory, tileMetres, meanLinearRgb, bytes, contrastAudit }) =>
    ({ id, stagedDirectory, tileMetres, meanLinearRgb, bytes, greenStandardDeviation: contrastAudit.staged.standardDeviationSrgb[1] })) }, null, 2));
