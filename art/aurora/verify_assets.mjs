import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

// CPU-only inspection of final exported bytes. Run with:
// node --import tsx art/aurora/verify_assets.mjs
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(repo);
const output = 'runs/aurora/geometry-materials.json';
const candidate = 'art/item-models/candidates/armor-frostweave-aurora';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = file => readFile(resolve(repo, file));
const json = async file => JSON.parse((await bytes(file)).toString('utf8').replace(/^\uFEFF/, ''));
const near = (actual, expected, label, tolerance = 1e-10) => {
  assert.equal(actual.length, expected.length, label);
  for (let i = 0; i < actual.length; i++) assert(Math.abs(actual[i] - expected[i]) <= tolerance, `${label}: ${actual[i]} != ${expected[i]}`);
};
const pixelCache = new Map();
async function pixels(texture) {
  assert(texture?.getImage(), 'Missing embedded texture');
  const image = texture.getImage(), digest = hash(image);
  if (!pixelCache.has(digest)) pixelCache.set(digest, sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
  return pixelCache.get(digest);
}
function sourcePixels(map) {
  const { data, width, height } = map.image;
  assert.equal(data.length, width * height * 4, 'Expected source RGBA8 texture');
  return { data, width, height, sha256: hash(data) };
}
function ormPixels(material) {
  const rough = material.roughnessMap, metal = material.metalnessMap;
  const basis = rough ?? metal;
  if (!basis) return undefined;
  const { width, height } = basis.image, data = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    data[p * 4] = data[p * 4 + 3] = 255;
    data[p * 4 + 1] = rough ? rough.image.data[p * 4 + 1] : 255;
    data[p * 4 + 2] = metal ? metal.image.data[p * 4 + 2] : 255;
  }
  return { data, width, height, sha256: hash(data), basis };
}
function sampling(info, source, label) {
  assert(info, label);
  assert.equal(info.getWrapS(), 10497, `${label} wrap S`);
  assert.equal(info.getWrapT(), 10497, `${label} wrap T`);
  const transform = info.getExtension('KHR_texture_transform');
  near(transform?.getScale() ?? [1, 1], source.repeat.toArray(), `${label} UV scale`);
  near(transform?.getOffset() ?? [0, 0], source.offset.toArray(), `${label} UV offset`);
}
async function compareTexture(texture, info, source, label, expected = sourcePixels(source)) {
  const decoded = await pixels(texture);
  assert.equal(decoded.info.width, expected.width, label);
  assert.equal(decoded.info.height, expected.height, label);
  assert.equal(hash(decoded.data), expected.sha256, `${label}: decoded pixels differ from source`);
  sampling(info, source, label);
  return { size: [expected.width, expected.height], pixelSha256: expected.sha256 };
}
async function materialState(material, source) {
  const name = material.getName(); assert(source, `${name}: unknown material`);
  near(material.getBaseColorFactor(), [...source.color.toArray(), source.opacity], `${name} base factor`);
  near([material.getMetallicFactor(), material.getRoughnessFactor()], [source.metalness, source.roughness], `${name} PBR factors`);
  near(material.getEmissiveFactor(), [0, 0, 0], `${name} emission`);
  assert(!material.getEmissiveTexture(), `${name}: unexpected emission map`);
  assert.equal(material.getDoubleSided(), true); assert.equal(material.getAlphaMode(), 'OPAQUE');
  const row = { name, metallic: source.metalness, roughness: source.roughness, noEmission: true, textures: {} };
  if (source.map) row.textures.color = await compareTexture(material.getBaseColorTexture(), material.getBaseColorTextureInfo(), source.map, `${name} albedo`);
  else assert(!material.getBaseColorTexture());
  if (source.normalMap) {
    row.textures.normal = await compareTexture(material.getNormalTexture(), material.getNormalTextureInfo(), source.normalMap, `${name} normal`);
    near([material.getNormalScale()], [source.normalScale.x], `${name} normal strength`);
  } else assert(!material.getNormalTexture());
  const orm = ormPixels(source);
  if (orm) row.textures.orm = await compareTexture(material.getMetallicRoughnessTexture(), material.getMetallicRoughnessTextureInfo(), orm.basis, `${name} ORM`, orm);
  else assert(!material.getMetallicRoughnessTexture());
  const film = material.getExtension('KHR_materials_iridescence');
  if (source.iridescence > 0) {
    assert(film, `${name}: missing iridescence`);
    const expected = [source.iridescence, source.iridescenceIOR, ...source.iridescenceThicknessRange];
    near([film.getIridescenceFactor(), film.getIridescenceIOR(), film.getIridescenceThicknessMinimum(), film.getIridescenceThicknessMaximum()], expected, `${name} thin film`);
    row.iridescence = expected;
  } else assert(!film);
  const sheen = material.getExtension('KHR_materials_sheen');
  if (source.sheen > 0) {
    assert(sheen, `${name}: missing sheen`);
    const color = source.sheenColor.clone().multiplyScalar(source.sheen).toArray();
    near(sheen.getSheenColorFactor(), color, `${name} sheen color`);
    near([sheen.getSheenRoughnessFactor()], [source.sheenRoughness], `${name} sheen roughness`);
    row.sheen = { color, roughness: source.sheenRoughness };
  } else assert(!sheen);
  const coat = material.getExtension('KHR_materials_clearcoat');
  if (source.clearcoat > 0) {
    assert(coat, `${name}: missing clearcoat`);
    near([coat.getClearcoatFactor(), coat.getClearcoatRoughnessFactor()], [source.clearcoat, source.clearcoatRoughness], `${name} clearcoat`);
  } else assert(!coat);
  near([material.getExtension('KHR_materials_ior')?.getIOR() ?? 1.5], [source.ior], `${name} IOR`);
  return row;
}
function positionKey(p) { return p.map(v => v.toFixed(6)).join(','); }
// Compare the exported roof of the pauldrons with the real rest-pose body.
// This catches ornaments placed in front of the shoulder while leaving its top bare.
function shoulderRoof(document) {
  const probes = [-1, 1].flatMap(side => [-.12, -.075, -.03].map(z => ({ x: side * .215, z, hits: [] })));
  for (const node of document.getRoot().listNodes()) {
    if (!node.getMesh()) continue;
    const m = node.getWorldMatrix();
    for (const primitive of node.getMesh().listPrimitives()) {
      const p = primitive.getAttribute('POSITION'), coords = new Float64Array(p.getCount() * 3);
      for (let i = 0; i < p.getCount(); i++) {
        const [x,y,z] = p.getElement(i, []);
        coords.set([m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],m[2]*x+m[6]*y+m[10]*z+m[14]],i*3);
      }
      const indices = primitive.getIndices()?.getArray() ?? Array.from({length:p.getCount()},(_,i)=>i);
      for (let i=0;i<indices.length;i+=3) {
        const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
        if (Math.max(coords[a+1],coords[b+1],coords[c+1])<1.35 || Math.min(coords[a+1],coords[b+1],coords[c+1])>1.72) continue;
        const ax=coords[a],az=coords[a+2],bx=coords[b],bz=coords[b+2],cx=coords[c],cz=coords[c+2];
        const d=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
        if (Math.abs(d)<1e-12) continue;
        for (const probe of probes) {
          const u=((bz-cz)*(probe.x-cx)+(cx-bx)*(probe.z-cz))/d;
          const v=((cz-az)*(probe.x-cx)+(ax-cx)*(probe.z-cz))/d;
          if (u<-.000001 || v<-.000001 || u+v>1.000001) continue;
          const y=u*coords[a+1]+v*coords[b+1]+(1-u-v)*coords[c+1];
          if (y>=1.35 && y<=1.72) probe.hits.push(y);
        }
      }
    }
  }
  return probes;
}
function shoulderCoverage(document, nativeDocument) {
  const body=shoulderRoof(nativeDocument), armor=shoulderRoof(document);
  const probes=body.map((probe,i)=>{
    const bodyY=probe.hits.length?Math.max(...probe.hits):null;
    const above=bodyY===null?[]:armor[i].hits.filter(y=>y>bodyY+.001).sort((a,b)=>a-b);
    const armorY=above[0]??null, clearance=armorY===null?null:armorY-bodyY;
    return {x:probe.x,z:probe.z,bodyY,armorY,clearance,covered:clearance!==null&&clearance<=.12};
  });
  return {passed:probes.every(p=>p.covered),probes,method:'Vertical triangle intersections through the native deltoid and exported robe in bind pose. Motion and silhouette still require visual review.'};
}
function zeroNormals(document) {
  const result = new Set();
  for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const n = primitive.getAttribute('NORMAL'), p = primitive.getAttribute('POSITION');
    for (let i = 0; i < n.getCount(); i++) if (Math.hypot(...n.getElement(i, [])) === 0) result.add(positionKey(p.getElement(i, [])));
  }
  return result;
}
function rigState(document, native) {
  const skins = document.getRoot().listSkins(); assert.equal(skins.length, 1);
  const skin = skins[0], joints = skin.listJoints(), reference = native.listJoints();
  assert.equal(joints.length, 65);
  assert.deepEqual(joints.map(j => j.getName()), reference.map(j => j.getName()), 'Native joint order');
  for (let i = 0; i < 65; i++) {
    near(joints[i].getMatrix(), reference[i].getMatrix(), `Joint ${joints[i].getName()} local transform`);
    near(joints[i].getWorldMatrix(), reference[i].getWorldMatrix(), `Joint ${joints[i].getName()} world transform`);
    assert.equal(joints[i].getParentNode()?.getName(), reference[i].getParentNode()?.getName());
  }
  const inverse = skin.getInverseBindMatrices(), expected = native.getInverseBindMatrices();
  assert.equal(inverse.getType(), 'MAT4'); assert.equal(inverse.getCount(), 65);
  near(inverse.getArray(), expected.getArray(), 'Native inverse bind matrices');
  for (const node of document.getRoot().listNodes()) {
    assert(node.getWorldMatrix().every(Number.isFinite));
    if (node.getMesh()) assert.equal(node.getSkin(), skin, `${node.getName()}: unskinned geometry`);
  }
  assert.equal(document.getRoot().listAnimations().length, 0);
  return { bones: 65, nativeJointOrderTransformsInverseBinds: true };
}
function geometryState(document, oldZeros, itemId) {
  let triangles = 0, vertices = 0, maxWeightSumError = 0, maxNormalError = 0;
  const zeroPositions = [], scaleVertices = new Set();
  let scaleFaceTriangles = 0, bevelTriangles = 0, sourceScaleFields = 0;
  const scalePrimitives = [], edgePrimitives = [];
  for (const node of document.getRoot().listNodes()) {
    if (!node.getMesh()) continue;
    for (const primitive of node.getMesh().listPrimitives()) {
      assert.equal(primitive.getMode(), 4); assert.equal(primitive.listTargets().length, 0);
      const p = primitive.getAttribute('POSITION'), count = p.getCount();
      vertices += count;
      for (const [semantic, type] of Object.entries({ POSITION: 'VEC3', NORMAL: 'VEC3', TEXCOORD_0: 'VEC2', JOINTS_0: 'VEC4', WEIGHTS_0: 'VEC4' })) {
        const attribute = primitive.getAttribute(semantic); assert(attribute, `${itemId}: missing ${semantic}`);
        assert.equal(attribute.getType(), type); assert.equal(attribute.getCount(), count);
      }
      for (const attribute of primitive.listAttributes()) {
        assert.equal(attribute.getCount(), count);
        assert(attribute.getArray().every(Number.isFinite), `${itemId}: nonfinite attribute`);
      }
      const ix = primitive.getIndices(), indexCount = ix?.getCount() ?? count;
      assert.equal(indexCount % 3, 0); triangles += indexCount / 3;
      if (ix) for (const i of ix.getArray()) assert(Number.isInteger(i) && i >= 0 && i < count, 'Invalid triangle index');
      const n = primitive.getAttribute('NORMAL'), w = primitive.getAttribute('WEIGHTS_0'), j = primitive.getAttribute('JOINTS_0');
      for (let i = 0; i < count; i++) {
        const length = Math.hypot(...n.getElement(i, []));
        if (length === 0) {
          const point = positionKey(p.getElement(i, []));
          assert(itemId.endsWith('_hood') && oldZeros.has(point), `${itemId}: new zero normal ${point}`);
          zeroPositions.push(point);
        } else { maxNormalError = Math.max(maxNormalError, Math.abs(length - 1)); assert(Math.abs(length - 1) < .001); }
        const weights = w.getElement(i, []); assert(weights.every(v => v >= 0 && v <= 1));
        const error = Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1);
        maxWeightSumError = Math.max(maxWeightSumError, error); assert(error < .00001);
        assert(j.getElement(i, []).every(value => Number.isInteger(value) && value >= 0 && value < 65));
      }
      const parts = node.getExtras().sourceParts ?? [];
      if (/^aurora-opal-scute-\d$/.test(primitive.getMaterial().getName())) {
        assert(parts.some(name => /overlapping scutes/.test(name)), 'Scute material must be attached to authored plates');
        scalePrimitives.push(primitive); scaleFaceTriangles += indexCount / 3;
        sourceScaleFields += parts.filter(name => /overlapping scutes/.test(name)).length;
        for (let i = 0; i < count; i++) scaleVertices.add(positionKey(p.getElement(i, [])));
      }
      if (parts.some(name => /dark cut-hide scute bevels/.test(name))) edgePrimitives.push(primitive);
    }
  }
  assert(triangles > 0 && triangles <= 150000, `${itemId}: triangle budget ${triangles}`);
  // The front plate vertices are duplicated on the separately shaded closed
  // edge geometry. A triangle with both a face vertex and an offset vertex
  // proves a real sidewall, independent of albedo or the source part's label.
  let minWallLength = Infinity, maxWallLength = 0;
  for (const primitive of edgePrimitives) {
    const p = primitive.getAttribute('POSITION'), ix = primitive.getIndices();
    const indices = ix?.getArray() ?? Array.from({ length: p.getCount() }, (_, i) => i);
    for (let t = 0; t < indices.length; t += 3) {
      const points = [0, 1, 2].map(k => p.getElement(indices[t + k], []));
      const top = points.map(point => scaleVertices.has(positionKey(point)));
      const hits = top.filter(Boolean).length;
      if (hits === 0 || hits === 3) continue;
      const lengths = [];
      for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) if (top[a] !== top[b]) lengths.push(Math.hypot(...points[a].map((v, axis) => v - points[b][axis])));
      const length = Math.min(...lengths);
      if (length > .00001) { bevelTriangles++; minWallLength = Math.min(minWallLength, length); maxWallLength = Math.max(maxWallLength, length); }
    }
  }
  assert(scaleFaceTriangles > 100 && bevelTriangles > 100, `${itemId}: missing dimensional scale faces or matching sidewalls`);
  return { vertices, triangles, finiteAttributes: true, indicesValid: true, normalizedNonnegativeWeights: true,
    maxWeightSumError, maxNormalError, inheritedHoodZeroNormalPositions: zeroPositions,
    physicalScales: { sourceScaleFields, scaleFaceTriangles, matchingSidewallTriangles: bevelTriangles, measuredConnectingEdgeMeters: [minWallLength, maxWallLength], method: 'Exported front-position matches into separately shaded sidewall triangles; positive geometric separation, not texture inference.' } };
}

const round = process.argv[2];
assert(/^aurora-r\d+$/.test(round ?? ''), 'Pass the current Aurora review round, for example aurora-r13');
const report = { round, createdAt: new Date().toISOString(), passed: false, baseline: [], assets: [], limits: ['Geometry/material evidence only; animation and visual acceptance are separate browser gates.', 'Two inherited red-hood zero normals may remain only at identical accepted positions.'] };
try {
  const baseline = await json('art/aurora/baseline.json');
  for (const entry of baseline.files) {
    const actual = hash(await bytes(entry.file)); assert.equal(actual, entry.sha256, `${entry.file}: frozen baseline changed`);
    report.baseline.push({ ...entry, unchanged: true });
  }
  const catalogue = await json(`${candidate}/catalogue.json`);
  assert.equal(catalogue.assets.length, 5);
  assert.equal(catalogue.dependencySha256, hash(JSON.stringify(catalogue.sourceDependencies)));
  for (const entry of catalogue.sourceDependencies) {
    const raw = await bytes(entry.file), current = entry.encoding === 'utf8-lf' ? Buffer.from(raw.toString().replaceAll('\r\n', '\n')) : raw;
    assert.equal(hash(current), entry.sha256, `${entry.file}: stale candidate dependency`);
  }
  report.dependencySha256 = catalogue.dependencySha256;
  const { createAuroraMaterials } = await import('../../tools/item-models/aurora/materials.ts');
  const source = createAuroraMaterials(), materialMap = new Map([...new Set(Object.values(source).flat())].map(m => [m.name, m]));
  const nativeDocument = await io.read('game/public/assets/models/character/base_male.glb');
  const native = nativeDocument.getRoot().listSkins()[0];
  const oldZeros = zeroNormals(await io.read('game/public/assets/models/items/starhide_hood.glb'));
  const clothBytes = source.cloth.roughnessMap.image.data;
  let clothPixels = 0, goldPixels = 0, minRough = 1, maxRough = 0, maxMetal = 0;
  for (let p = 0; p < clothBytes.length; p += 4) {
    const rough = clothBytes[p + 1] / 255, metal = clothBytes[p + 2] / 255;
    minRough = Math.min(minRough, rough); maxRough = Math.max(maxRough, rough); maxMetal = Math.max(maxMetal, metal);
    if (metal === 0) { clothPixels++; assert(rough >= .83, 'Base cloth is too polished'); }
    if (metal > .34) goldPixels++;
    assert(rough >= .415 && rough <= .945 && metal <= .685, 'Cloth ORM bounds');
  }
  assert(clothPixels / (clothBytes.length / 4) > .75, 'Gold mask leaked into base cloth');
  report.clothORM = { resolution: [2048, 2048], zeroMetalClothFraction: clothPixels / (clothBytes.length / 4), strongGoldFraction: goldPixels / (clothBytes.length / 4), roughnessRange: [minRough, maxRough], maxMetallic: maxMetal, pixelsSha256: hash(clothBytes) };
  for (const asset of catalogue.assets) {
    const file = `${candidate}/${asset.file}`, raw = await bytes(file);
    assert.equal(hash(raw), asset.sha256); assert.equal(raw.length, asset.bytes);
    const doc = await io.readBinary(raw);
    const materials = [];
    for (const material of doc.getRoot().listMaterials()) materials.push(await materialState(material, materialMap.get(material.getName())));
    const geometry = geometryState(doc, oldZeros, asset.itemId); assert.equal(geometry.triangles, asset.triangles);
    if (asset.itemId==='frostweave_robe') {
      report.shoulderCoverage=shoulderCoverage(doc,nativeDocument);
      assert(report.shoulderCoverage.passed,'Pauldrons leave the native shoulder roof uncovered');
    }
    report.assets.push({ itemId: asset.itemId, file, sha256: asset.sha256, bytes: raw.length, rig: rigState(doc, native), geometry, materials });
  }
  report.passed = true;
} catch (error) {
  report.failure = error.stack ?? String(error); process.exitCode = 1;
} finally {
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, output, verifiedAssets: report.assets.map(a => ({ itemId: a.itemId, triangles: a.geometry.triangles, physicalSidewalls: a.geometry.physicalScales.matchingSidewallTriangles })), baselineFiles: report.baseline.length, failure: report.failure }, null, 2));
}
