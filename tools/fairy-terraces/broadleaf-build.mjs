/** Native BK Osmanthus LOD0 crowns, with fairy leaf palettes and the original bark. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { Box3, Vector3 } from 'three';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTTextureWebP } from '@gltf-transform/extensions';
import sharp from 'sharp';

const out = 'test-results/fairy-terraces-assets/broadleaf';
const source = JSON.parse(await readFile(`${out}/source-audit.json`, 'utf8'));
const base = `${source.sourceDirectory}/Assets/BK/PureNature_AsianMountains`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const linear = n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
const variants = [
  { id: 'fairy_canopy_gloam_1', number: 3, tint: [149, 96, 161], region: 'gloamgarden', name: 'Plumleaf Osmanthus' },
  { id: 'fairy_canopy_gloam_2', number: 4, tint: [184, 123, 158], region: 'gloamgarden', name: 'Roseleaf Osmanthus' },
  { id: 'fairy_canopy_fae_1', number: 3, tint: [139, 125, 178], region: 'faeholme', name: 'Lavender Osmanthus' },
  { id: 'fairy_canopy_fae_2', number: 4, tint: [174, 154, 192], region: 'faeholme', name: 'Pearlleaf Osmanthus' },
];
const pack = { id: 'bk-pure-nature-asian-mountains', name: source.package, author: 'BK',
  source: 'https://assetstore.unity.com/packages/3d/environments/pure-nature-2-asian-mountains-341972',
  license: 'Standard Unity Asset Store EULA', assetStoreId: '341972',
  sourceArchive: source.archive, archiveSha256: source.archiveSha256, acquiredVersion: '1.1' };
await mkdir(`${out}/models`, { recursive: true });
await mkdir(`${out}/textures`, { recursive: true });
const assets = [], files = {};

function measureWalkingTrunk(geometry, materials) {
  const p = geometry.attributes.position;
  const low = 0, high = 1.8;
  const samples = [];
  for (const group of geometry.groups) {
    if (!materials[group.materialIndex].name.includes('Trunk')) continue;
    for (let i = group.start; i < group.start + group.count; i += 3) {
      const triangle = [0, 1, 2].map(k => [p.getX(i + k) * .01, p.getY(i + k) * .01, p.getZ(i + k) * .01]);
      for (const v of triangle) if (v[1] >= low && v[1] <= high) samples.push(v);
      for (let edge = 0; edge < 3; edge++) {
        const a = triangle[edge], b = triangle[(edge + 1) % 3];
        if (a[1] === b[1]) continue;
        for (const height of [low, high]) {
          const t = (height - a[1]) / (b[1] - a[1]);
          if (t > 0 && t < 1) samples.push([a[0] + (b[0] - a[0]) * t, height, a[2] + (b[2] - a[2]) * t]);
        }
      }
    }
  }
  if (!samples.length) throw Error('Native trunk has no geometry within walking height');
  const measuredRadius = Math.max(...samples.map(([x, , z]) => Math.hypot(x, z)));
  // Triangle/slab intersections include bark that crosses a height boundary even
  // when its source vertices lie outside the player's vertical envelope.
  return { measuredRadius, radius: Math.ceil((measuredRadius + .03) * 100) / 100,
    sourceWalkingHeightMetres: [low, high], marginMetres: .03, clippedSamples: samples.length,
    method: 'Maximum XZ distance from the source trunk origin across native bark triangles clipped to source Y=0..1.8m, plus 3cm rounded upward.' };
}

for (const variant of variants) {
  const { id, number } = variant;
  const modelFile = `${base}/Models/Trees/Osmanthus/Osmanthus${number}/Osmanthus${number}.fbx`;
  const bytes = await readFile(modelFile);
  const imported = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  imported.updateMatrixWorld(true);
  const mesh = imported.getObjectByName(`Osmanthus${number}_LOD0`);
  if (!mesh?.isMesh) throw Error('Original Osmanthus LOD0 missing');
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  if (geometry.index || geometry.groups.length !== 2) throw Error('Unexpected native topology');
  const sourceBounds = new Box3().setFromBufferAttribute(geometry.attributes.position);
  const size = sourceBounds.getSize(new Vector3()).multiplyScalar(.01).toArray();
  // Source XZ origin is the trunk centre. Ground min Y for the engine, then retain the
  // authored Unity ground line as a recommended sink in the candidate metadata.
  const shiftY = -sourceBounds.min.y * .01;
  const positions = Float32Array.from(geometry.attributes.position.array, (v, i) => v * .01 + (i % 3 === 1 ? shiftY : 0));
  const walkingTrunk = measureWalkingTrunk(geometry, mesh.material);
  const document = new Document(), buffer = document.createBuffer(), scene = document.createScene(id);
  document.createExtension(EXTTextureWebP).setRequired(true);
  const textures = {}, textureAudit = [];
  for (const role of ['leaf_albedo', 'leaf_normal', 'bark_albedo', 'bark_normal']) {
    const staged = source.textures.find(t => t.role === role).staged;
    const { data, info } = await sharp(staged).resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (role === 'leaf_albedo') {
      for (let y = Math.floor(info.height / 2); y < info.height; y++) for (let x = 0; x < info.width; x++) {
        const at = (y * info.width + x) * 4;
        // The original atlas has warm twigs in its upper half and white leaf
        // clusters in its lower half. Tint leaves without turning twigs purple.
        const tone = .36 + .64 * (data[at] * .2126 + data[at + 1] * .7152 + data[at + 2] * .0722) / 255;
        const mottling = .965 + .035 * Math.sin(x * .057) * Math.sin(y * .043);
        for (let k = 0; k < 3; k++) data[at + k] = Math.round(variant.tint[k] * tone * mottling);
      }
    }
    // Keep source UV0 unchanged and adapt image row orientation to glTF.
    const image = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .flip().webp({ quality: role.endsWith('normal') ? 96 : 93, alphaQuality: 100 }).toBuffer();
    const texturePath = `${out}/textures/${id}_${role}.webp`;
    await writeFile(texturePath, image);
    textures[role] = document.createTexture(`${id}_${role}`).setImage(image).setMimeType('image/webp');
    textureAudit.push({ role, path: texturePath, sha256: hash(image), bytes: image.length, width: info.width, height: info.height });
  }
  const leaf = document.createMaterial(`${id}_leaves`).setBaseColorTexture(textures.leaf_albedo)
    .setNormalTexture(textures.leaf_normal).setNormalScale(.3).setAlphaMode('MASK').setAlphaCutoff(.45)
    .setDoubleSided(true).setRoughnessFactor(.86).setMetallicFactor(0);
  const bark = document.createMaterial(`${id}_bark`).setBaseColorTexture(textures.bark_albedo)
    .setNormalTexture(textures.bark_normal).setNormalScale(.75).setRoughnessFactor(.94).setMetallicFactor(0);
  const outMesh = document.createMesh(mesh.name);
  const arrays = [];
  const accessor = (name, type, array) => document.createAccessor(name).setType(type).setArray(array).setBuffer(buffer);
  for (const group of geometry.groups) {
    const materialName = mesh.material[group.materialIndex].name;
    const leaves = materialName.includes('Leaves');
    const start = group.start, end = start + group.count;
    const p = positions.slice(start * 3, end * 3);
    const n = Float32Array.from(geometry.attributes.normal.array.subarray(start * 3, end * 3));
    const uv = Float32Array.from(geometry.attributes.uv.array.subarray(start * 2, end * 2));
    const primitive = document.createPrimitive().setMaterial(leaves ? leaf : bark)
      .setAttribute('POSITION', accessor(`${materialName} native positions`, 'VEC3', p))
      .setAttribute('NORMAL', accessor(`${materialName} native normals`, 'VEC3', n))
      .setAttribute('TEXCOORD_0', accessor(`${materialName} native UV0`, 'VEC2', uv));
    if (leaves) {
      const colors = new Float32Array(group.count * 3);
      for (let i = 0; i < group.count; i++) {
        const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
        const high = clamp((y - 3) / 6);
        const patch = Math.sin(x * 1.11 + z * .43) * Math.cos(z * .86 - y * .63);
        const value = linear(clamp(.76 + high * .19 + patch * .05));
        colors.set([value, value, value], i * 3);
      }
      primitive.setAttribute('COLOR_0', accessor('Authored crown light variation', 'VEC3', colors));
    }
    arrays.push({ p, n, uv }); outMesh.addPrimitive(primitive);
  }
  scene.addChild(document.createNode(id).setMesh(outMesh));
  document.getRoot().setDefaultScene(scene);
  const io = new NodeIO().registerExtensions([EXTTextureWebP]);
  const result = await io.writeBinary(document);
  const reread = await io.readBinary(result);
  reread.getRoot().listMeshes()[0].listPrimitives().forEach((primitive, i) => {
    for (const [attribute, expected] of [['POSITION', arrays[i].p], ['NORMAL', arrays[i].n], ['TEXCOORD_0', arrays[i].uv]]) {
      const actual = primitive.getAttribute(attribute).getArray();
      if (actual.length !== expected.length || actual.some((v, k) => v !== expected[k])) throw Error(`Roundtrip changed native ${attribute}`);
    }
  });
  const file = `models/${id}.glb`; await writeFile(`${out}/${file}`, result);
  const nativeFiles = [modelFile, `${modelFile}.meta`, `${base}/Prefabs/Trees/Osmanthus${number}.prefab`,
    `${base}/Models/Trees/Osmanthus/OsmanthusLeaves.mat`, `${base}/Models/Trees/Osmanthus/OsmanthusTrunk.mat`,
    ...source.textures.map(t => t.source)];
  const sourceFiles = await Promise.all(nativeFiles.map(async path => ({ path, sha256: hash(await readFile(path)) })));
  const triangles = geometry.attributes.position.count / 3;
  const asset = { id, name: variant.name, file: `models/fairy/${id}.glb`, pack: pack.id,
    category: 'nature', is: 'tree', tags: ['tree', 'broadleaf', 'fairy', variant.region, 'source-derived'],
    bytes: result.length, sha256: hash(result), size: { x: size[0], y: size[1], z: size[2] },
    base: { x: sourceBounds.min.x * .01, y: 0, z: sourceBounds.min.z * .01 },
    groundY: shiftY, trunkRadius: walkingTrunk.radius,
    triangles, animations: [], materials: [leaf.getName(), bark.getName()],
    sourceProvenance: { archive: source.archive, archiveSha256: source.archiveSha256, source: pack.source,
      model: modelFile, sourceMesh: mesh.name, sourceFiles,
      modifications: ['Full native LOD0 positions, topology, UV0 and normals. No decimation or replacement geometry.',
        'Source centimetres converted to metres. Source trunk XZ origin retained; Y translated to minimum zero.',
        'Original source alpha retained. White leaves tinted to authored fairy palette; twig and trunk colors retained.',
        'Source wind vertex channels replaced by mild crown color variation. Production tree wind must come from the game shader.',
        'Source leaf and trunk normal maps retained; glTF double-sided alpha-mask leaf material and matte bark material.'],
      leafPaletteSrgb: variant.tint, recommendedSinkAtScaleOne: shiftY,
      walkingTrunk,
      placement: 'Place using AssetRegistry.baseY(), which returns groundY. This restores the original Unity ground line. Do not apply recommendedSinkAtScaleOne again after groundY placement.' },
    acceptance: { assetAudit: true, labAccepted: false, worldIntegrated: false } };
  await writeFile(`${out}/${id}.audit.json`, JSON.stringify({ asset, textures: textureAudit,
    sourceBoundsCentimetres: { min: sourceBounds.min.toArray(), max: sourceBounds.max.toArray() },
    sourceTriangleCount: triangles, outputTriangleCount: triangles,
    geometryRoundtripExact: true, originalUvRoundtripExact: true, normalsRoundtripExact: true }, null, 2) + '\n');
  assets.push(asset); files[id] = file;
  await writeFile(`${out}/candidates.json`, JSON.stringify({ packs: [pack], assets, files, browserErrors: [] }, null, 2) + '\n');
  console.log(JSON.stringify({ id, bytes: result.length, triangles, size: asset.size, groundY: shiftY, trunkRadius: walkingTrunk.radius, measuredTrunk: walkingTrunk.measuredRadius, path: `${out}/${file}` }));
}

