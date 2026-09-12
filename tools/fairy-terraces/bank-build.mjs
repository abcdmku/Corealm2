/** Source AsianCliff crags: uniform scale, grounded native topology and damp moss material baked into original UVs. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { Box3, Vector3 } from 'three';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTTextureWebP } from '@gltf-transform/extensions';
import sharp from 'sharp';

const out = 'test-results/fairy-terraces-assets/banks';
await mkdir(`${out}/models`, { recursive: true });
await mkdir(`${out}/textures`, { recursive: true });
const source = JSON.parse(await readFile('test-results/fairy-terraces-assets/rocks/source-audit.json', 'utf8'));
const base = `${source.sourceDirectory}/Assets/BK/PureNature_AsianMountains`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const linear = Float32Array.from({ length: 256 }, (_, c) => {
  const v = c / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
});
const byte = x => Math.max(0, Math.min(255, Math.round(x * 255)));
const srgb = x => byte(x <= .0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - .055);
const normalize = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
async function readTexture(file) {
  // Unity opaque rock shaders ignore albedo alpha. Some authored PNGs carry zero alpha with
  // valid RGB; resizing RGBA would premultiply those RGB values to black. Resize independently.
  const metadata = await sharp(file).metadata();
  const opaque = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = await sharp(opaque.data, { raw: { width: opaque.info.width, height: opaque.info.height, channels: 3 } })
    .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (metadata.hasAlpha) {
    const alpha = await sharp(file).extractChannel('alpha').resize(info.width, info.height).raw().toBuffer();
    for (let i = 0; i < alpha.length; i++) data[i * 4 + 3] = alpha[i];
  }
  return { data, width: info.width, height: info.height };
}
function sample(texture, u, v, colour = false) {
  const x = ((u % 1 + 1) % 1) * texture.width - .5;
  const y = ((1 - v % 1 + 1) % 1) * texture.height - .5;
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const indices = [[ix, iy], [ix + 1, iy], [ix, iy + 1], [ix + 1, iy + 1]]
    .map(([px, py]) => (((py + texture.height) % texture.height) * texture.width + (px + texture.width) % texture.width) * 4);
  return [0, 1, 2, 3].map(c => {
    const values = indices.map(i => colour && c < 3 ? linear[texture.data[i + c]] : texture.data[i + c] / 255);
    return (values[0] * (1 - fx) + values[1] * fx) * (1 - fy) + (values[2] * (1 - fx) + values[3] * fx) * fy;
  });
}
function triplanar(texture, p, n, tiling, colour = false) {
  const values = [sample(texture, p[2] * Math.sign(n[0]) * tiling, p[1] * tiling, colour),
    sample(texture, p[0] * Math.sign(n[1]) * tiling, p[2] * tiling, colour),
    sample(texture, -p[0] * Math.sign(n[2]) * tiling, p[1] * tiling, colour)];
  const weights = n.map(Math.abs), sum = weights.reduce((a, b) => a + b, .00001);
  return [0, 1, 2, 3].map(c => values.reduce((total, value, axis) => total + value[c] * weights[axis] / sum, 0));
}
function triplanarNormal(texture, p, n, tiling, strength) {
  const xy = (u, v) => sample(texture, u, v).slice(0, 2).map(x => (x * 2 - 1) * strength);
  const sx = Math.sign(n[0]), sy = Math.sign(n[1]), sz = Math.sign(n[2]);
  const a = xy(p[2] * sx * tiling, p[1] * tiling), b = xy(p[0] * sy * tiling, p[2] * tiling),
    c = xy(-p[0] * sz * tiling, p[1] * tiling);
  const values = [[n[0], a[1] + n[1], a[0] * sx + n[2]],
    [b[0] * sy + n[0], n[1], b[1] + n[2]], [c[0] * -sz + n[0], c[1] + n[1], n[2]]];
  return normalize([0, 1, 2].map(k => values.reduce((total, value, axis) => total + value[k] * Math.abs(n[axis]), 0)));
}
function dilate(buffers, covered, side, iterations = 8) {
  for (let pass = 0; pass < iterations; pass++) {
    const prior = covered.slice();
    for (let i = 0; i < covered.length; i++) {
      if (prior[i]) continue;
      const x = i % side, y = Math.floor(i / side);
      const from = [x ? i - 1 : -1, x + 1 < side ? i + 1 : -1, y ? i - side : -1, y + 1 < side ? i + side : -1]
        .find(j => j >= 0 && prior[j]);
      if (from === undefined) continue;
      for (const buffer of buffers) buffer.set(buffer.subarray(from * 3, from * 3 + 3), i * 3);
      covered[i] = 1;
    }
  }
}

const assets = [], files = {}, pack = {
  id: 'bk-pure-nature-asian-mountains', name: source.packageMetadata.title, author: 'BK',
  source: 'https://assetstore.unity.com/packages/3d/environments/pure-nature-2-asian-mountains-341972',
  license: 'Standard Unity Asset Store EULA', assetStoreId: '341972',
  sourceArchive: source.package, archiveSha256: source.archiveSha256, acquiredVersion: source.packageMetadata.version,
};
for (const number of [0, 1]) {
  const uniformScale = number === 0 ? .5 : .4;
  const id = `fairy_moss_bank_${number}`, modelFile = `${base}/Models/AsianCliff/AsianCliff_${number}.fbx`;
  const matFile = `${base}/Models/AsianCliff/Textures/Materials/AsianCliff_${number}.mat`;
  const matSource = await readFile(matFile, 'utf8');
  const parameter = name => {
    const match = matSource.match(new RegExp(`- ${name}: ([\\d.+-]+)`));
    if (!match) throw Error(`Missing original material parameter ${name}`);
    return Number(match[1]);
  };
  if (!matSource.includes('_LAYERMODE_TOPDOWN')) throw Error('Source layer mode changed');
  const materialParameters = Object.fromEntries(['_LayerPower', '_LayerThreshold', '_Tiling', '_Tiling2',
    '_SecondNormalPower', '_NormalPower', '_SmoothnessPower', '_OcclusionPower', '_MetallicPower'].map(k => [k, parameter(k)]));
  const textureFiles = {
    albedo: `${base}/Models/AsianCliff/Textures/AsianCliff_${number}_a.png`,
    normal: `${base}/Models/AsianCliff/Textures/AsianCliff_${number}_n.png`,
    mask: `${base}/Models/AsianCliff/Textures/AsianCliff_${number}_mask.png`,
    grass: `${base}/Textures/Surfaces/Grass01_a.png`, grassMask: `${base}/Textures/Surfaces/Grass01_m.png`,
    detailNormal: `${base}/Textures/Surfaces/_RockDetail1_n.png`,
  };
  const textures = Object.fromEntries(await Promise.all(Object.entries(textureFiles).map(async ([key, file]) => [key, await readTexture(file)])));
  const modelBytes = await readFile(modelFile);
  const root = new FBXLoader().parse(modelBytes.buffer.slice(modelBytes.byteOffset, modelBytes.byteOffset + modelBytes.byteLength), '');
  root.updateMatrixWorld(true);
  const mesh = root.getObjectByName(`AsianCliff_${number}_LOD0`);
  if (!mesh?.isMesh) throw Error('Original LOD0 mesh missing');
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  const pos = geometry.attributes.position, uv = geometry.attributes.uv, nor = geometry.attributes.normal;
  if (geometry.index || !uv || !nor) throw Error('Unexpected source topology/attributes');
  const triangles = pos.count / 3, expected = number === 0 ? 15268 : 30790;
  if (triangles !== expected) throw Error(`LOD0 triangle mismatch ${triangles}`);
  const originalPositions = Float32Array.from(pos.array, x => x * .01);
  const scaledPositions = Float32Array.from(originalPositions, x => x * uniformScale);
  const sourceBounds = new Box3().setFromBufferAttribute(pos), midpoint = sourceBounds.getCenter(new Vector3()).multiplyScalar(.01 * uniformScale);
  const shift = [-midpoint.x, -sourceBounds.min.y * .01 * uniformScale, -midpoint.z];
  const positions = Float32Array.from(scaledPositions, (x, i) => x + shift[i % 3]);
  const size = sourceBounds.getSize(new Vector3()).multiplyScalar(.01 * uniformScale).toArray();
  const side = 2048, albedo = new Uint8Array(side * side * 3), normal = new Uint8Array(albedo.length), orm = new Uint8Array(albedo.length);
  const covered = new Uint8Array(side * side), owners = new Int32Array(side * side).fill(-1);
  let shaded = 0, overlap = 0, mossPixels = 0, mossWeight = 0;
  const extract = (array, i, count) => Array.from(array.subarray(i * count, (i + 1) * count));
  for (let triangle = 0; triangle < triangles; triangle++) {
    const ii = triangle * 3, us = [0, 1, 2].map(k => extract(uv.array, ii + k, 2));
    const ps = [0, 1, 2].map(k => extract(originalPositions, ii + k, 3));
    const ns = [0, 1, 2].map(k => extract(nor.array, ii + k, 3));
    const d = (us[1][1] - us[2][1]) * (us[0][0] - us[2][0]) + (us[2][0] - us[1][0]) * (us[0][1] - us[2][1]);
    if (Math.abs(d) < 1e-12) continue;
    const dp1 = ps[1].map((v, k) => v - ps[0][k]), dp2 = ps[2].map((v, k) => v - ps[0][k]);
    const du1 = us[1][0] - us[0][0], du2 = us[2][0] - us[0][0], dv1 = us[1][1] - us[0][1], dv2 = us[2][1] - us[0][1];
    const inv = 1 / (du1 * dv2 - du2 * dv1);
    const tangent = dp1.map((v, k) => (v * dv2 - dp2[k] * dv1) * inv);
    const bitangent = dp2.map((v, k) => (v * du1 - dp1[k] * du2) * inv);
    const minX = Math.max(0, Math.floor(Math.min(...us.map(v => v[0])) * side)), maxX = Math.min(side - 1, Math.ceil(Math.max(...us.map(v => v[0])) * side));
    const minY = Math.max(0, Math.floor((1 - Math.max(...us.map(v => v[1]))) * side)), maxY = Math.min(side - 1, Math.ceil((1 - Math.min(...us.map(v => v[1]))) * side));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const u = (x + .5) / side, v = 1 - (y + .5) / side;
      const a = ((us[1][1] - us[2][1]) * (u - us[2][0]) + (us[2][0] - us[1][0]) * (v - us[2][1])) / d;
      const b = ((us[2][1] - us[0][1]) * (u - us[2][0]) + (us[0][0] - us[2][0]) * (v - us[2][1])) / d, c = 1 - a - b;
      if (Math.min(a, b, c) < -1e-8) continue;
      const pixel = y * side + x, offset = pixel * 3;
      if (owners[pixel] >= 0) overlap++;
      owners[pixel] = triangle; covered[pixel] = 1; shaded++;
      const p = ps[0].map((q, k) => q * a + ps[1][k] * b + ps[2][k] * c);
      const n = normalize(ns[0].map((q, k) => q * a + ns[1][k] * b + ns[2][k] * c));
      // Damp forest adaptation uses original Grass01 with broader moss on upward-facing ledges and mottled creep over faces.
      const slope = Math.min(1, Math.max(0, (n[1] + .14) / .90));
      const broadNoise = .5 + .22 * Math.sin(p[0] * 1.7 + p[2] * .81) + .17 * Math.sin(p[1] * 3.1 - p[2] * 2.3);
      const alpha = Math.min(.94, Math.max(0, .06 + .91 * slope * slope * (3 - 2 * slope) + (broadNoise - .5) * .65));
      mossWeight += alpha; if (alpha > .5) mossPixels++;
      const rock = sample(textures.albedo, u, v, true), grass = triplanar(textures.grass, p, n, materialParameters._Tiling, true);
      const grassLuma = dot(grass, [.2126, .7152, .0722]);
      for (let k = 0; k < 3; k++) {
        const dampRock = rock[k] * [.64, .70, .66][k];
        const mutedMoss = (grass[k] * .72 + grassLuma * .28) * [.62, .60, .54][k];
        albedo[offset + k] = srgb(dampRock * (1 - alpha) + mutedMoss * alpha);
      }
      const t = normalize(tangent.map((q, k) => q - n[k] * dot(n, tangent))), bt = cross(n, t);
      const sign = dot(bt, bitangent) < 0 ? -1 : 1, bit = bt.map(q => q * sign);
      const sourceNormal = sample(textures.normal, u, v).slice(0, 3).map(q => q * 2 - 1);
      sourceNormal[0] *= materialParameters._NormalPower; sourceNormal[1] *= materialParameters._NormalPower;
      sourceNormal[2] = Math.sqrt(Math.max(0, 1 - sourceNormal[0] ** 2 - sourceNormal[1] ** 2));
      const detailWorld = triplanarNormal(textures.detailNormal, p, n, materialParameters._Tiling2, materialParameters._SecondNormalPower);
      const detail = [dot(detailWorld, t), dot(detailWorld, bit), dot(detailWorld, n)];
      const combined = normalize([sourceNormal[0] + detail[0], sourceNormal[1] + detail[1], sourceNormal[2] * detail[2]]);
      const resultNormal = normalize(mix(combined, [0, 0, 1], alpha));
      for (let k = 0; k < 3; k++) normal[offset + k] = byte(resultNormal[k] * .5 + .5);
      const mask = sample(textures.mask, u, v), grassMask = triplanar(textures.grassMask, p, n, materialParameters._Tiling);
      // The original material sets smoothness/occlusion powers to zero. Respect those source settings.
      orm[offset] = byte((mask[1] * (1 - alpha) + grassMask[1] * alpha) ** materialParameters._OcclusionPower);
      orm[offset + 1] = byte(1 - (mask[3] * (1 - alpha) + grassMask[3] * alpha) * materialParameters._SmoothnessPower);
      orm[offset + 2] = byte(mask[0] * (1 - alpha) + grassMask[0] * alpha + materialParameters._MetallicPower);
    }
  }
  if (overlap / shaded > .001) throw Error(`Source UV overlap prevents reliable layer bake: ${overlap}/${shaded}`);
  dilate([albedo, normal, orm], covered, side);
  const document = new Document(), buffer = document.createBuffer(), scene = document.createScene(id);
  document.createExtension(EXTTextureWebP).setRequired(true);
  const baked = {}, texturesAudit = [];
  for (const [role, pixels] of Object.entries({ albedo, normal, orm })) {
    // Source UV values are untouched. Flip image rows for glTF's top-left image convention.
    const bytes = await sharp(pixels, { raw: { width: side, height: side, channels: 3 } }).flip().webp({ quality: role === 'normal' ? 96 : 92 }).toBuffer();
    const file = `${out}/textures/${id}_${role}.webp`; await writeFile(file, bytes);
    baked[role] = document.createTexture(`${id}_source_${role}`).setImage(bytes).setMimeType('image/webp');
    texturesAudit.push({ role, path: file, bytes: bytes.length, sha256: hash(bytes), width: side, height: side });
  }
  const material = document.createMaterial(`BK ${id} damp source rock and broad ledge moss`)
    .setBaseColorTexture(baked.albedo).setNormalTexture(baked.normal).setMetallicRoughnessTexture(baked.orm)
    .setOcclusionTexture(baked.orm).setMetallicFactor(1).setRoughnessFactor(1);
  const accessor = (name, type, array) => document.createAccessor(name).setType(type).setArray(array).setBuffer(buffer);
  const primitive = document.createPrimitive().setMaterial(material)
    .setAttribute('POSITION', accessor('source LOD0 metres, rigidly grounded', 'VEC3', positions))
    .setAttribute('NORMAL', accessor('source LOD0 normals', 'VEC3', Float32Array.from(nor.array)))
    .setAttribute('TEXCOORD_0', accessor('unchanged source UV0', 'VEC2', Float32Array.from(uv.array)));
  const outputMesh = document.createMesh(`AsianCliff_${number}_LOD0`).addPrimitive(primitive);
  scene.addChild(document.createNode(id).setMesh(outputMesh)); document.getRoot().setDefaultScene(scene);
  const io = new NodeIO().registerExtensions([EXTTextureWebP]), bytes = await io.writeBinary(document);
  if (bytes.length >= 8_000_000) throw Error(`${id}: size budget exceeded ${bytes.length}`);
  const roundtrip = await io.readBinary(bytes), outputPrimitive = roundtrip.getRoot().listMeshes()[0].listPrimitives()[0];
  for (const [name, expectedArray] of [['POSITION', positions], ['NORMAL', nor.array], ['TEXCOORD_0', uv.array]]) {
    const actual = outputPrimitive.getAttribute(name).getArray();
    if (actual.length !== expectedArray.length || actual.some((v, i) => v !== expectedArray[i])) throw Error(`Changed source ${name}`);
  }
  const sources = await Promise.all([modelFile, `${modelFile}.meta`, matFile,
    `${base}/Prefabs/Cliffs/AsianCliff_${number}.prefab`, ...Object.values(textureFiles)].map(async path => ({ path, sha256: hash(await readFile(path)) })));
  const asset = { id, file: `models/fairy/${id}.glb`, pack: pack.id, category: 'rock', is: 'crag',
    tags: ['rock', 'cliff', 'bank', 'fairy', 'source-derived', 'moss'], bytes: bytes.length, sha256: hash(bytes),
    size: { x: size[0], y: size[1], z: size[2] }, base: { x: -size[0] / 2, y: 0, z: -size[2] / 2 }, triangles,
    animations: [], materials: [material.getName()], sourceProvenance: {
      archive: source.archive, archiveSha256: source.archiveSha256, source: pack.source,
      model: modelFile, sourceMesh: mesh.name, sourceFiles: sources, sourceShader: source.additionalSources[0],
      modifications: ['Full original LOD0. No decimation, deformation, replacement geometry or UV changes.',
        `Centimetres to metres; uniform source scale ${uniformScale}; rigid translation centres XZ and grounds minimum Y.`,
        'Source Grass01, original rock albedo/normal, triplanar detail normal and masks baked into unchanged UVs. Broader orientation/noise moss blend and damp stone colour adaptation.',
        '2048 WebP source-material atlases; source opaque RGB resized independently of source alpha to preserve authored hidden RGB; material smoothness and occlusion powers retained.'],
      uniformScale, materialParameters, unresolvedSourceReference: 'Source grass normal is available but this candidate uses flat moss normal blending. Rock and triplanar detail normal retained.',
      bakePlacement: 'World-space source triplanar detail baked at source origin. Yaw/uniform instance scaling moves the baked surface with the rock.',
    }, acceptance: { assetAudit: true, labAccepted: false, worldIntegrated: false } };
  const file = `models/${id}.glb`; await writeFile(`${out}/${file}`, bytes);
  const audit = { asset, sourceTriangleCount: triangles, outputTriangleCount: triangles,
    geometryRoundtripExact: true, originalUvRoundtripExact: true, normalsRoundtripExact: true, rigidTranslationMetres: shift,
    sourceBoundsCentimetres: { min: sourceBounds.min.toArray(), max: sourceBounds.max.toArray() },
    bake: { side, shadedPixels: shaded, overlappingPixels: overlap, mossPixels, mossWeightMean: mossWeight / shaded,
      shaderFormula: 'clamp(.06 + .91 * smoothstep(-.14,.76,normal.y) + broadNoiseVariation, 0, .94)' , textures: texturesAudit },
  };
  await writeFile(`${out}/${id}.audit.json`, JSON.stringify(audit, null, 2) + '\n');
  assets.push(asset); files[id] = file;
  await writeFile(`${out}/candidates.json`, JSON.stringify({ packs: [pack], assets, files, browserErrors: [] }, null, 2) + '\n');
  console.log(JSON.stringify({ id, bytes: bytes.length, triangles, size: asset.size, mossPixels, sha256: asset.sha256 }));
}
