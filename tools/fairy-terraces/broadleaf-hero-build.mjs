/** Mature central fairy tree: native Corealm oak geometry and an authored purple leaf atlas. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import sharp from 'sharp';

const out = 'test-results/fairy-terraces-assets/broadleaf';
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
const original = manifest.assets.find(asset => asset.id === 'corealm_oak_1');
if (!original) throw Error('Native mature Corealm oak is missing');
const sourcePath = `game/public/assets/${original.file}`;
const sourceBytes = await readFile(sourcePath);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
if (sha(sourceBytes) !== original.sha256) throw Error('Native oak hash does not match its manifest');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.readBinary(sourceBytes);
const arrays = doc.getRoot().listAccessors().map(accessor => ({ name: accessor.getName(),
  array: accessor.getArray().slice(), type: accessor.getType(), normalized: accessor.getNormalized() }));
const leaf = doc.getRoot().listMaterials().find(material => /Leaves/i.test(material.getName()));
const texture = leaf?.getBaseColorTexture();
if (!texture) throw Error('Original oak leaf atlas is missing');
const originalTextureBytes = texture.getImage();
const { data, info } = await sharp(originalTextureBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let tinted = 0, retainedTwigs = 0;
function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let h = 0;
  if (delta) h = max === r ? (g - b) / delta : max === g ? 2 + (b - r) / delta : 4 + (r - g) / delta;
  return [(h * 60 + 360) % 360, max ? delta / max : 0, max / 255];
}
function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgb.map(value => Math.round((value + m) * 255));
}
for (let i = 0; i < data.length; i += 4) {
  const [hue, saturation, value] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
  if (hue >= 51 && hue <= 170 && saturation > .08) {
    const purple = hsvToRgb(290 + (hue - 90) * .12, .34 + saturation * .16, Math.min(.92, .14 + value * 1.6));
    data.set(purple, i); tinted++;
  } else if (data[i + 3] > 128) retainedTwigs++;
}
const leafBytes = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
  .webp({ quality: 95, alphaQuality: 100 }).toBuffer();
texture.setImage(leafBytes).setMimeType('image/webp').setName('Mature fairy oak purple leaf cutout');
doc.createExtension(EXTTextureWebP).setRequired(true);
leaf.setName('Leaves_FairyHero_gloam_oak_cutout');
for (const node of doc.getRoot().listNodes()) if (node.getName() === original.id) node.setName('fairy_hero_gloam');
const result = await io.writeBinary(doc);
const decoded = await io.readBinary(result);
const after = decoded.getRoot().listAccessors();
if (arrays.length !== after.length) throw Error('Native accessor count changed');
arrays.forEach((before, index) => {
  const actual = after[index];
  if (actual.getName() !== before.name || actual.getType() !== before.type || actual.getNormalized() !== before.normalized)
    throw Error('Native geometry encoding changed');
  const values = actual.getArray();
  if (values.length !== before.array.length || values.some((v, i) => v !== before.array[i])) throw Error(`Native ${before.name} changed`);
});
const id = 'fairy_hero_gloam';
await mkdir(`${out}/models`, { recursive: true });
await mkdir(`${out}/textures`, { recursive: true });
await writeFile(`${out}/models/${id}.glb`, result);
await writeFile(`${out}/textures/${id}_leaves.webp`, leafBytes);
const asset = { ...original, id, name: 'Mature plum oak', file: `models/fairy/${id}.glb`,
  category: 'nature', is: 'tree', tags: ['oak', 'tree', 'broadleaf', 'mature', 'fairy', 'gloamgarden', 'corealm', 'original'],
  bytes: result.length, sha256: sha(result), groundY: original.groundY ?? original.base.y,
  materials: doc.getRoot().listMaterials().map(material => material.getName()),
  sourceProvenance: { sourceAsset: original.id, sourcePath, sourceSha256: sha(sourceBytes), sourcePack: original.pack,
    sourceLeafTextureSha256: sha(originalTextureBytes), modifications: [
      'Native mesh positions, indices, normals, vertex colors, UVs and encoding retained exactly.',
      'Original bark material, texture, roots and authored ground line retained.',
      'Original oak leaf atlas recolored from green to muted purple; warm twig pixels and source alpha retained.',
      'Leaf atlas encoded as WebP. No deformation, decimation, canopy copies or replacement geometry.' ],
    recommendedUniformScale: .85, leafTexture: { width: info.width, height: info.height, tintedPixels: tinted, retainedOpaqueTwigPixels: retainedTwigs },
  }, acceptance: { assetAudit: true, labAccepted: false, worldIntegrated: false } };
const candidatesPath = `${out}/candidates.json`;
const candidates = JSON.parse(await readFile(candidatesPath, 'utf8'));
candidates.assets = candidates.assets.filter(entry => entry.id !== id).concat(asset);
candidates.files[id] = `models/${id}.glb`;
const pack = manifest.packs.find(pack => pack.id === original.pack);
if (pack && !candidates.packs.some(entry => entry.id === pack.id)) candidates.packs.push(pack);
await writeFile(candidatesPath, JSON.stringify(candidates, null, 2) + '\n');
await writeFile(`${out}/${id}.audit.json`, JSON.stringify({ asset, allNativeAccessorsRoundtripExact: true,
  sourceAndOutputTriangles: original.triangles, sourceBytes: sourceBytes.length, outputBytes: result.length }, null, 2) + '\n');
console.log(JSON.stringify({ id, bytes: result.length, triangles: asset.triangles, size: asset.size,
  groundY: asset.groundY, trunkRadius: asset.trunkRadius, tinted, retainedTwigs, sha256: asset.sha256 }));

// Author a shorter bole and a low, broad crown into a separate mesh candidate.
// Integrating smoothstep gives a C1 height function: bark and leaves receive
// exactly the same continuous deformation, with no runtime axis scaling.
const shelteredId = 'fairy_hero_gloam_sheltered';
function shelteredY(y) {
  if (y <= 6) return y * .6;
  if (y >= 8) return y * .8 - 1.4;
  const t = (y - 6) / 2;
  return y * .6 + .4 * (t ** 3 - .5 * t ** 4);
}
function shelteredDerivative(y) {
  if (y <= 6) return .6;
  if (y >= 8) return .8;
  const t = (y - 6) / 2;
  return .6 + .2 * (t * t * (3 - 2 * t));
}
const sheltered = await io.readBinary(result);
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
const geometryAudit = [], preserved = [];
const samePosition = new Map();
let weldedDuplicates = 0, maxNormalUnitError = 0, maxTangentDot = 0, maxEdgeExpansion = 0;
const sourceLeafHeights = [], shapedLeafHeights = [];
const walkingPoints = [];
for (const mesh of sheltered.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
  const position = primitive.getAttribute('POSITION'), normal = primitive.getAttribute('NORMAL');
  const before = position.getArray().slice(), indices = primitive.getIndices().getArray();
  const after = new Float32Array(before.length), normals = new Float32Array(before.length);
  const isBark = /Bark/i.test(primitive.getMaterial().getName());
  for (let i = 0; i < position.getCount(); i++) {
    const offset = i * 3, y = before[offset + 1], slope = shelteredDerivative(y);
    after[offset] = before[offset]; after[offset + 1] = shelteredY(y); after[offset + 2] = before[offset + 2];
    const n = normal.getElement(i, []);
    // Recompute the authored smooth normal with the inverse transpose of the
    // deformation Jacobian. This preserves the source's smooth bark seams and
    // deliberate leaf normals, which face averaging would replace.
    const transformed = [n[0], n[1] / slope, n[2]];
    const length = Math.hypot(...transformed);
    if (!(length > 0)) throw Error('Source tree has a zero-length normal');
    for (let k = 0; k < 3; k++) normals[offset + k] = transformed[k] / length;
    maxNormalUnitError = Math.max(maxNormalUnitError, Math.abs(Math.hypot(...normals.subarray(offset, offset + 3)) - 1));
    const tangent = Math.abs(n[0]) + Math.abs(n[1]) > .01 ? [-n[1], n[0], 0] : [0, -n[2], n[1]];
    const tl = Math.hypot(tangent[0], tangent[1] * slope, tangent[2]);
    maxTangentDot = Math.max(maxTangentDot, Math.abs((normals[offset] * tangent[0]
      + normals[offset + 1] * tangent[1] * slope + normals[offset + 2] * tangent[2]) / tl));
    const key = `${before[offset]},${y},${before[offset + 2]}`;
    const shaped = `${after[offset]},${after[offset + 1]},${after[offset + 2]}`;
    if (samePosition.has(key)) {
      if (samePosition.get(key) !== shaped) throw Error('Deformation split a source seam');
      weldedDuplicates++;
    } else samePosition.set(key, shaped);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], after[offset + k]); max[k] = Math.max(max[k], after[offset + k]);
      if (!Number.isFinite(after[offset + k]) || !Number.isFinite(normals[offset + k])) throw Error('Invalid authored mesh value');
    }
    if (!isBark) { sourceLeafHeights.push(y); shapedLeafHeights.push(after[offset + 1]); }
  }
  for (let i = 0; i < indices.length; i += 3) {
    const triangle = [0, 1, 2].map(k => Array.from(after.subarray(indices[i + k] * 3, indices[i + k] * 3 + 3)));
    if (isBark) {
      for (const point of triangle) if (point[1] >= 0 && point[1] <= 1.8) walkingPoints.push(point);
      for (let edge = 0; edge < 3; edge++) {
        const a = triangle[edge], b = triangle[(edge + 1) % 3];
        if (a[1] === b[1]) continue;
        for (const height of [0, 1.8]) {
          const t = (height - a[1]) / (b[1] - a[1]);
          if (t > 0 && t < 1) walkingPoints.push([a[0] + (b[0] - a[0]) * t, height, a[2] + (b[2] - a[2]) * t]);
        }
      }
    }
    for (let edge = 0; edge < 3; edge++) {
      const a = indices[i + edge] * 3, b = indices[i + (edge + 1) % 3] * 3;
      const oldLength = Math.hypot(before[a] - before[b], before[a + 1] - before[b + 1], before[a + 2] - before[b + 2]);
      const newLength = Math.hypot(after[a] - after[b], after[a + 1] - after[b + 1], after[a + 2] - after[b + 2]);
      maxEdgeExpansion = Math.max(maxEdgeExpansion, newLength - oldLength);
    }
  }
  // UV, color and index accessors stay byte-for-byte identical.
  for (const semantic of primitive.listSemantics().filter(semantic => !['POSITION', 'NORMAL'].includes(semantic))) {
    const accessor = primitive.getAttribute(semantic);
    preserved.push({ index: sheltered.getRoot().listAccessors().indexOf(accessor), name: accessor.getName(), bytes: sha(new Uint8Array(accessor.getArray().buffer,
      accessor.getArray().byteOffset, accessor.getArray().byteLength)) });
  }
  preserved.push({ index: sheltered.getRoot().listAccessors().indexOf(primitive.getIndices()), name: primitive.getIndices().getName(), bytes: sha(new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength)) });
  position.setArray(after);
  normal.setArray(normals).setNormalized(false);
  geometryAudit.push({ material: primitive.getMaterial().getName(), vertices: position.getCount(), triangles: indices.length / 3,
    xzUnchanged: true, positionSha256: sha(new Uint8Array(after.buffer)), normalSha256: sha(new Uint8Array(normals.buffer)) });
}
if (min[1] !== 0 || maxNormalUnitError > 1e-6 || maxTangentDot > 1e-6 || maxEdgeExpansion > 2e-6)
  throw Error(`Sheltered tree continuity failed: ${JSON.stringify({ min, maxNormalUnitError, maxTangentDot, maxEdgeExpansion })}`);
const transitionAudit = [6, 8].map(height => ({ height, left: shelteredY(height - 1e-7), right: shelteredY(height + 1e-7),
  derivativeLeft: shelteredDerivative(height - 1e-7), derivativeRight: shelteredDerivative(height + 1e-7) }));
for (const seam of transitionAudit) if (Math.abs(seam.right - seam.left) > 2e-7 || Math.abs(seam.derivativeRight - seam.derivativeLeft) > 1e-7)
  throw Error('Height transition is not continuous');
for (const node of sheltered.getRoot().listNodes()) {
  if (node.getScale().some(value => value !== 1)) throw Error('Authored tree requires identity runtime scaling');
  if (node.getName() === id) node.setName(shelteredId);
}
const shelteredBytes = await io.writeBinary(sheltered);
const shelteredRoundtrip = await io.readBinary(shelteredBytes);
const roundtripPrimitives = shelteredRoundtrip.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
for (const [index, primitive] of roundtripPrimitives.entries()) {
  for (const [semantic, expected] of [['POSITION', geometryAudit[index].positionSha256], ['NORMAL', geometryAudit[index].normalSha256]]) {
    const array = primitive.getAttribute(semantic).getArray();
    if (sha(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)) !== expected) throw Error(`Roundtrip changed authored ${semantic}`);
  }
}
for (const record of preserved) {
  const accessor = shelteredRoundtrip.getRoot().listAccessors()[record.index];
  const array = accessor.getArray();
  if (sha(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)) !== record.bytes) throw Error(`Changed ${record.name}`);
}
const rawTrunkRadius = Math.max(...walkingPoints.map(([x, , z]) => Math.hypot(x, z)));
const trunkRadius = Math.ceil((rawTrunkRadius + .03) * 100) / 100;
const quantiles = values => { values.sort((a, b) => a - b); return Object.fromEntries([0, .05, .1, .25, .5, .75, .9, 1]
  .map(q => [q, values[Math.min(values.length - 1, Math.floor(q * values.length))]])); };
const shelteredAsset = { ...asset, id: shelteredId, name: 'Sheltered mature plum oak', file: `models/fairy/${shelteredId}.glb`,
  bytes: shelteredBytes.length, sha256: sha(shelteredBytes), base: { x: min[0], y: min[1], z: min[2] },
  size: { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] }, groundY: 0, trunkRadius,
  encoding: { positions: 'Float32 authored continuous Y deformation; source XZ unchanged', normals: 'Float32 normalized inverse-Jacobian normals',
    linearColours: original.encoding.linearColours, bladeUV: original.encoding.bladeUV, woodUV: original.encoding.woodUV,
    groundedIdentityTransform: true },
  sourceProvenance: { ...asset.sourceProvenance, sourceVariant: id, sourceVariantSha256: sha(result),
    recommendedUniformScale: 1, modifications: [
      'Every bark and leaf vertex uses the same continuous Y deformation. XZ, indices, UV and vertex color remain unchanged.',
      'Source Y below 6m compresses by0.6. Above8m it follows0.8Y-1.4. Integrated smoothstep joins the two derivatives across6..8m.',
      'Normals recomputed with the deformation inverse-transpose Jacobian, retaining authored smooth seams and leaf orientation.',
      'Original bark and purple oak leaf materials retained. Roots remain grounded at0. No runtime axis scaling or separate crown translation.' ],
    deformation: { lowerScale: .6, upperScale: .8, transition: [6, 8], maxEdgeExpansion, weldedDuplicates,
      normalMethod: 'normalize(nx,ny/fprime(y),nz)', maxNormalUnitError, maxTangentDot, transitionAudit,
      sourceLeafHeightQuantiles: quantiles(sourceLeafHeights), shapedLeafHeightQuantiles: quantiles(shapedLeafHeights) },
    walkingTrunk: { measuredRadius: rawTrunkRadius, radius: trunkRadius, verticalRange: [0, 1.8], margin: .03,
      method: 'Exact bark triangle intersections with output Y=0..1.8m, maximum radius about the native trunk origin, plus3cm rounded up.' },
  }, acceptance: { assetAudit: true, labAccepted: false, worldIntegrated: false } };
await writeFile(`${out}/models/${shelteredId}.glb`, shelteredBytes);
candidates.assets = candidates.assets.filter(entry => entry.id !== shelteredId).concat(shelteredAsset);
candidates.files[shelteredId] = `models/${shelteredId}.glb`;
await writeFile(candidatesPath, JSON.stringify(candidates, null, 2) + '\n');
await writeFile(`${out}/${shelteredId}.audit.json`, JSON.stringify({ asset: shelteredAsset, geometry: geometryAudit,
  preservedAccessorHashes: preserved, topologyPreserved: true, xzPreserved: true, sharedPositionSeamsPreserved: true,
  authoredPositionsAndNormalsRoundtripExact: true,
  branchLeafContinuity: 'A single monotone mapping with derivative0.6..0.8 applies to all mesh primitives, so existing attachment gaps cannot widen.' }, null, 2) + '\n');
console.log(JSON.stringify({ id: shelteredId, bytes: shelteredBytes.length, size: shelteredAsset.size, groundY:0, trunkRadius,
  maxEdgeExpansion, weldedDuplicates, maxNormalUnitError, maxTangentDot, sha256: shelteredAsset.sha256 }));

// T60 uses the same accepted broad, low crown with a cooler and less saturated
// leaf palette. Keep the warm bark and twig colors shared across both regions.
const faeId = 'fairy_hero_fae_sheltered';
const fae = await io.readBinary(shelteredBytes);
const faeLeaf = fae.getRoot().listMaterials().find(material => /Leaves/i.test(material.getName()));
const faeTexture = faeLeaf.getBaseColorTexture();
const { data: purplePixels, info: faeInfo } = await sharp(faeTexture.getImage()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const faePixels = Buffer.from(purplePixels);
let lavenderTexels = 0;
for (let i = 0; i < faePixels.length; i += 4) {
  const [hue, saturation, value] = rgbToHsv(...faePixels.subarray(i, i + 3));
  if (hue >= 240 && hue <= 330 && saturation >= .15) {
    faePixels.set(hsvToRgb(265 + (hue - 290) * .5, Math.min(.4, Math.max(.25, saturation * .72)), value * .91), i);
    lavenderTexels++;
  }
  if (faePixels[i + 3] !== purplePixels[i + 3]) throw Error('T60 leaf alpha changed');
}
if (lavenderTexels < 1000) throw Error('T60 leaf palette did not reach the source leaves');
const faeLeafBytes = await sharp(faePixels, { raw: { width: faeInfo.width, height: faeInfo.height, channels: 4 } })
  .webp({ quality: 95, alphaQuality: 100 }).toBuffer();
faeTexture.setImage(faeLeafBytes).setName('Mature sheltered fairy oak lavender leaf cutout');
faeLeaf.setName('Leaves_FairyHero_fae_oak_cutout');
for (const node of fae.getRoot().listNodes()) if (node.getName() === shelteredId) node.setName(faeId);
const faeBytes = await io.writeBinary(fae);
const faeRoundtrip = await io.readBinary(faeBytes);
const shapeAccessors = shelteredRoundtrip.getRoot().listAccessors(), faeAccessors = faeRoundtrip.getRoot().listAccessors();
if (shapeAccessors.length !== faeAccessors.length) throw Error('T60 tree geometry count changed');
shapeAccessors.forEach((accessor, index) => {
  const actual = faeAccessors[index], a = accessor.getArray(), b = actual.getArray();
  if (accessor.getType() !== actual.getType() || accessor.getNormalized() !== actual.getNormalized()
    || accessor.getComponentType() !== actual.getComponentType() || a.length !== b.length || a.some((v, i) => v !== b[i]))
    throw Error(`T60 tree changed authored geometry accessor ${index}`);
});
const barkImage = document => document.getRoot().listMaterials().find(material => /Bark/i.test(material.getName())).getBaseColorTexture().getImage();
if (sha(barkImage(shelteredRoundtrip)) !== sha(barkImage(faeRoundtrip))) throw Error('T60 tree changed the warm bark texture');
const faeDecoded = await sharp(faeRoundtrip.getRoot().listMaterials().find(material => /Leaves/i.test(material.getName()))
  .getBaseColorTexture().getImage()).ensureAlpha().raw().toBuffer();
for (let i = 3; i < faeDecoded.length; i += 4) if (faeDecoded[i] !== purplePixels[i]) throw Error('T60 texture encoding changed source alpha');
const faeAsset = { ...shelteredAsset, id: faeId, name: 'Sheltered mature lavender oak', file: `models/fairy/${faeId}.glb`,
  tags: shelteredAsset.tags.filter(tag => tag !== 'gloamgarden').concat('faeholme'), bytes: faeBytes.length, sha256: sha(faeBytes),
  materials: fae.getRoot().listMaterials().map(material => material.getName()),
  sourceProvenance: { ...shelteredAsset.sourceProvenance, sourceVariant: shelteredId, sourceVariantSha256: sha(shelteredBytes),
    leafPalette: { hue: 265, saturationRange: [.25, .4], saturationMultiplier: .72, valueMultiplier: .91, lavenderTexels },
    modifications: [...shelteredAsset.sourceProvenance.modifications,
      'T60 variant retains the authored sheltered geometry, Float32 normals, roots and warm bark exactly.',
      'Only purple leaf pixels become muted lavender/periwinkle. Alpha is exact after WebP reload; warm twig pixels remain brown.' ] },
  acceptance: { assetAudit: true, labAccepted: false, worldIntegrated: false } };
await writeFile(`${out}/models/${faeId}.glb`, faeBytes);
await writeFile(`${out}/textures/${faeId}_leaves.webp`, faeLeafBytes);
candidates.assets = candidates.assets.filter(entry => entry.id !== faeId).concat(faeAsset);
candidates.files[faeId] = `models/${faeId}.glb`;
await writeFile(candidatesPath, JSON.stringify(candidates, null, 2) + '\n');
await writeFile(`${out}/${faeId}.audit.json`, JSON.stringify({ asset: faeAsset,
  allAuthoredGeometryAccessorsRoundtripExact: true, sameGeometryAsGloamSheltered: true,
  sourceAlphaExactAfterReload: true, sourceBarkTextureExact: true, sourceTopologyAndUVsExact: true,
  groundY: faeAsset.groundY, trunkRadius: faeAsset.trunkRadius, size: faeAsset.size }, null, 2) + '\n');
console.log(JSON.stringify({ id: faeId, bytes: faeBytes.length, size: faeAsset.size,
  groundY: faeAsset.groundY, trunkRadius: faeAsset.trunkRadius, lavenderTexels, sha256: faeAsset.sha256 }));
