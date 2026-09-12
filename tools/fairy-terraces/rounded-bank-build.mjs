/** Rounded village geology from rigidly reoriented native BK boulders, joined at a grounded cut. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { Box3, Vector2, Vector3, Matrix4, ShapeUtils } from 'three';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTTextureWebP } from '@gltf-transform/extensions';
import sharp from 'sharp';
const out = 'test-results/fairy-terraces-assets/rounded-banks';
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
const ATLAS_W = 3072, ATLAS_H = 2048;
const tiles = [[0, 0, 2048], [2048, 0, 1024], [2048, 1024, 512], [2560, 1024, 512], [2048, 1536, 512]];
// [original source boulder, uniform scale, yaw, x, z, highest exposed Y]
const recipes = [
  [[4, .86, .10, 0, 0, 3.05], [2, .42, 1.0, 1.6, 1.45, 2.12],
    [3, .31, -.6, -2.15, -1.95, 1.05], [1, .28, .72, 2.25, -1.65, .92], [0, .21, 1.65, -.2, -2.9, .66]],
  [[4, .79, -.42, -.35, .2, 2.95], [3, .56, .48, 1.2, -.1, 2.22],
    [2, .29, 1.04, -2.45, -1.9, 1.06], [1, .28, -.5, 1.8, -2.45, .85], [3, .24, 2.14, 2.65, .7, .72]],
];
const sourceCache = new Map();
async function loadBoulder(number) {
  if (sourceCache.has(number)) return sourceCache.get(number);
  const modelFile = `${base}/Models/Boulders/Boulder_${number}.fbx`, modelBytes = await readFile(modelFile);
  const root = new FBXLoader().parse(modelBytes.buffer.slice(modelBytes.byteOffset, modelBytes.byteOffset + modelBytes.byteLength), '');
  root.updateMatrixWorld(true);
  const mesh = root.getObjectByName(`Boulder_${number}_LOD0`);
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld).scale(.01, .01, .01);
  geometry.computeBoundingBox();
  const centre = geometry.boundingBox.getCenter(new Vector3());
  geometry.translate(-centre.x, -centre.y, -centre.z);
  const textureFiles = {
    albedo: `${base}/Models/Boulders/Textures/Boulder_${number}_a.png`,
    normal: `${base}/Models/Boulders/Textures/Boulder_${number}_n.png`,
    mask: `${base}/Models/Boulders/Textures/Boulder_${number}_mask.png`,
    grass: `${base}/Textures/Surfaces/Grass01_a.png`, grassNormal: `${base}/Textures/Surfaces/Grass01_n.png`,
    detailAlbedo: `${base}/Textures/Surfaces/_RockDetail1_a.png`, detailNormal: `${base}/Textures/Surfaces/_RockDetail1_n.png`,
  };
  const textures = Object.fromEntries(await Promise.all(Object.entries(textureFiles).map(async ([key, file]) => [key, await readTexture(file)])));
  const sources = await Promise.all([modelFile, `${modelFile}.meta`, ...Object.values(textureFiles)].map(async path => ({ path, sha256: hash(await readFile(path)) })));
  const result = { number, geometry, textures, sources, modelFile, originalTriangles: geometry.attributes.position.count / 3 };
  sourceCache.set(number, result); return result;
}
function lerpVertex(a, b, t) {
  return { p: mix(a.p, b.p, t), n: normalize(mix(a.n, b.n, t)), uv: mix(a.uv, b.uv, t) };
}
function clipToGround(vertices) {
  const polygon = [];
  for (let i = 0; i < 3; i++) {
    const a = vertices[i], b = vertices[(i + 1) % 3], ai = a.p[1] >= 0, bi = b.p[1] >= 0;
    if (ai) polygon.push(a);
    if (ai !== bi) {
      const vertex = lerpVertex(a, b, -a.p[1] / (b.p[1] - a.p[1]));
      vertex.p[1] = 0; polygon.push(vertex);
    }
  }
  return polygon;
}
function capsForEdges(edges) {
  const key = p => `${Math.round(p[0] * 1e5)},${Math.round(p[2] * 1e5)}`;
  const points = new Map(), adjacency = new Map();
  for (const [a, b] of edges) {
    const ka = key(a), kb = key(b); if (ka === kb) continue;
    points.set(ka, a); points.set(kb, b);
    for (const [from, to] of [[ka, kb], [kb, ka]]) {
      const links = adjacency.get(from) ?? new Set(); links.add(to); adjacency.set(from, links);
    }
  }
  const remaining = new Set(adjacency.keys()), triangles = [];
  while (remaining.size) {
    const start = remaining.values().next().value, loop = [start]; remaining.delete(start);
    let prior = null, current = start;
    for (let safety = 0; safety < points.size + 1; safety++) {
      const next = [...adjacency.get(current)].find(k => k !== prior && (k === start || remaining.has(k)));
      if (!next) throw Error('Open source clipping boundary');
      if (next === start) break;
      loop.push(next); remaining.delete(next); prior = current; current = next;
    }
    const contour = loop.map(k => points.get(k));
    if (contour.length < 3) continue;
    for (const indices of ShapeUtils.triangulateShape(contour.map(p => new Vector2(p[0], p[2])), [])) {
      const vertices = indices.map(i => ({ p: contour[i].slice(), n: [0, -1, 0], uv: [.5, .5] }));
      const a = vertices[0].p, b = vertices[1].p, c = vertices[2].p;
      if ((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]) < 0) vertices.reverse();
      triangles.push(vertices);
    }
  }
  return triangles;
}
async function bakePart(part, tile, partIndex, id) {
  const side = tile[2], albedo = new Uint8Array(side * side * 3), normal = new Uint8Array(albedo.length), orm = new Uint8Array(albedo.length);
  const covered = new Uint8Array(side * side), { positions, normals, uv, source: native } = part;
  const textures = native.textures;
  let pixels = 0, mossPixels = 0;
  for (let ii = 0; ii < positions.length / 3; ii += 3) {
    const ps = [0, 1, 2].map(k => Array.from(positions.slice((ii + k) * 3, (ii + k) * 3 + 3)));
    const ns = [0, 1, 2].map(k => Array.from(normals.slice((ii + k) * 3, (ii + k) * 3 + 3)));
    const us = [0, 1, 2].map(k => Array.from(uv.slice((ii + k) * 2, (ii + k) * 2 + 2)));
    const d = (us[1][1] - us[2][1]) * (us[0][0] - us[2][0]) + (us[2][0] - us[1][0]) * (us[0][1] - us[2][1]);
    if (Math.abs(d) < 1e-12) continue;
    const dp1 = ps[1].map((v, k) => v - ps[0][k]), dp2 = ps[2].map((v, k) => v - ps[0][k]);
    const du1 = us[1][0] - us[0][0], du2 = us[2][0] - us[0][0], dv1 = us[1][1] - us[0][1], dv2 = us[2][1] - us[0][1];
    const inv = 1 / (du1 * dv2 - du2 * dv1), tangent = dp1.map((v, k) => (v * dv2 - dp2[k] * dv1) * inv);
    const bitangent = dp2.map((v, k) => (v * du1 - dp1[k] * du2) * inv);
    const minX = Math.max(0, Math.floor(Math.min(...us.map(v => v[0])) * side)), maxX = Math.min(side - 1, Math.ceil(Math.max(...us.map(v => v[0])) * side));
    const minY = Math.max(0, Math.floor((1 - Math.max(...us.map(v => v[1]))) * side)), maxY = Math.min(side - 1, Math.ceil((1 - Math.min(...us.map(v => v[1]))) * side));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const u = (x + .5) / side, v = 1 - (y + .5) / side;
      const a = ((us[1][1] - us[2][1]) * (u - us[2][0]) + (us[2][0] - us[1][0]) * (v - us[2][1])) / d;
      const b = ((us[2][1] - us[0][1]) * (u - us[2][0]) + (us[0][0] - us[2][0]) * (v - us[2][1])) / d, c = 1 - a - b;
      if (Math.min(a, b, c) < -1e-8) continue;
      const index = y * side + x, offset = index * 3; covered[index] = 1; pixels++;
      const p = ps[0].map((q, k) => q * a + ps[1][k] * b + ps[2][k] * c);
      const n = normalize(ns[0].map((q, k) => q * a + ns[1][k] * b + ns[2][k] * c));
      const slope = Math.min(1, Math.max(0, (n[1] - .03) / .83));
      const rock = sample(textures.albedo, u, v, true), grass = triplanar(textures.grass, p, n, 1.15, true);
      const detailColour = triplanar(textures.detailAlbedo, p, n, .72, true);
      const rockLuma = dot(rock, [.2126, .7152, .0722]), grassLuma = dot(grass, [.2126, .7152, .0722]);
      // The native detail map is white stone planes with fine gray fissures. A clamped
      // brightening multiplier erased that detail; retain the fissures as dark relief.
      const detailLuma = dot(detailColour, [.2126, .7152, .0722]);
      const fissure = Math.min(1, Math.max(0, (1 - detailLuma) * 5));
      const weathering = Math.min(1, Math.max(0, (.37 - rockLuma) * 4));
      const patches = (Math.sin(p[0] * 1.43 + p[2] * .67) * Math.sin(p[2] * 2.13 - p[1] * 1.2)
        + .42 * Math.sin(p[0] * 4.8 + p[2] * 3.3)) / 1.42;
      const alpha = Math.min(.9, Math.max(0, .07 + .76 * slope * slope * (3 - 2 * slope)
        + patches * .30 - fissure * .30 - weathering * .34));
      if (alpha > .5) mossPixels++;
      const grain = (1 - fissure * .52) * Math.min(1.55, Math.max(.52, (rockLuma / .37) ** 1.1));
      for (let k = 0; k < 3; k++) {
        const stone = (rock[k] * .55 + rockLuma * .45) * [.53, .60, .66][k] * grain;
        const moss = (grass[k] * .8 + grassLuma * .2) * [.9, .72, .68][k] * (.80 + rockLuma * .5);
        albedo[offset + k] = srgb(stone * (1 - alpha) + moss * alpha);
      }
      const t = normalize(tangent.map((q, k) => q - n[k] * dot(n, tangent))), bt = cross(n, t);
      const sign = dot(bt, bitangent) < 0 ? -1 : 1, bit = bt.map(q => q * sign);
      const sourceNormal = sample(textures.normal, u, v).slice(0, 3).map(q => q * 2 - 1);
      const detailWorld = triplanarNormal(textures.detailNormal, p, n, .72, .55);
      const detail = [dot(detailWorld, t), dot(detailWorld, bit), dot(detailWorld, n)];
      const combined = normalize([sourceNormal[0] + detail[0], sourceNormal[1] + detail[1], sourceNormal[2] * detail[2]]);
      const mossWorld = triplanarNormal(textures.grassNormal, p, n, 1.15, .38);
      const mossNormal = [dot(mossWorld, t), dot(mossWorld, bit), dot(mossWorld, n)];
      const finalNormal = normalize(mix(combined, mossNormal, alpha * .78));
      for (let k = 0; k < 3; k++) normal[offset + k] = byte(finalNormal[k] * .5 + .5);
      const mask = sample(textures.mask, u, v);
      orm[offset] = byte(.7 + mask[1] * .3); orm[offset + 1] = 245; orm[offset + 2] = 0;
    }
  }
  dilate([albedo, normal, orm], covered, side, 6);
  console.log(JSON.stringify({ id, part: partIndex, source: native.number, sourceTriangles: native.originalTriangles, pixels, mossPixels }));
  return { albedo, normal, orm };
}
const assets = [], files = {};
const pack = { id: 'bk-pure-nature-asian-mountains', name: source.packageMetadata.title, author: 'BK',
  source: 'https://assetstore.unity.com/packages/3d/environments/pure-nature-2-asian-mountains-341972',
  license: 'Standard Unity Asset Store EULA', assetStoreId: '341972', sourceArchive: source.package,
  archiveSha256: source.archiveSha256, acquiredVersion: source.packageMetadata.version };
for (const [variant, recipe] of recipes.entries()) {
  const id = `fairy_rounded_bank_${variant}`, merged = { positions: [], normals: [], uv: [] }, audit = [];
  const atlas = { albedo: new Uint8Array(ATLAS_W * ATLAS_H * 3), normal: new Uint8Array(ATLAS_W * ATLAS_H * 3), orm: new Uint8Array(ATLAS_W * ATLAS_H * 3) };
  for (const [partIndex, [number, scale, yaw, dx, dz, highestY]] of recipe.entries()) {
    const native = await loadBoulder(number);
    // Rigid cyclic orientation: the former long Y axis lies along X; old Z becomes vertical.
    const cyclic = new Matrix4().makeBasis(new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, 1, 0));
    const rotation = new Matrix4().makeRotationY(yaw).multiply(cyclic);
    const geometry = native.geometry.clone().applyMatrix4(rotation).scale(scale, scale, scale);
    geometry.computeBoundingBox();
    geometry.translate(dx, highestY - geometry.boundingBox.max.y, dz);
    const positions = geometry.attributes.position.array, normals = geometry.attributes.normal.array, uv = geometry.attributes.uv.array;
    const tile = tiles[partIndex];
    const baked = await bakePart({ positions, normals, uv, source: native }, tile, partIndex, id);
    for (const [role, pixels] of Object.entries(baked)) for (let row = 0; row < tile[2]; row++) {
      atlas[role].set(pixels.subarray(row * tile[2] * 3, (row + 1) * tile[2] * 3), ((tile[1] + row) * ATLAS_W + tile[0]) * 3);
    }
    let retainedTriangles = 0; const edges = [];
    const emit = vertices => { for (const vertex of vertices) {
      merged.positions.push(...vertex.p); merged.normals.push(...vertex.n);
      // The atlas will be vertically flipped for glTF; source UVs are packed affinely, not re-unwrapped.
      merged.uv.push((tile[0] + vertex.uv[0] * tile[2]) / ATLAS_W, 1 - (tile[1] + (1 - vertex.uv[1]) * tile[2]) / ATLAS_H);
    } };
    for (let i = 0; i < positions.length / 3; i += 3) {
      const vertices = [0, 1, 2].map(k => ({ p: Array.from(positions.slice((i + k) * 3, (i + k) * 3 + 3)),
        n: Array.from(normals.slice((i + k) * 3, (i + k) * 3 + 3)), uv: Array.from(uv.slice((i + k) * 2, (i + k) * 2 + 2)) }));
      const polygon = clipToGround(vertices);
      for (let j = 0; j < polygon.length; j++) {
        const a = polygon[j], b = polygon[(j + 1) % polygon.length];
        if (a.p[1] === 0 && b.p[1] === 0 && Math.hypot(a.p[0] - b.p[0], a.p[2] - b.p[2]) > 1e-7) edges.push([a.p, b.p]);
      }
      for (let j = 1; j + 1 < polygon.length; j++) { emit([polygon[0], polygon[j], polygon[j + 1]]); retainedTriangles++; }
    }
    const caps = capsForEdges(edges); for (const cap of caps) emit(cap);
    audit.push({ sourceBoulder: number, uniformScale: scale, yaw, centreXZ: [dx, dz], highestY,
      originalTriangles: native.originalTriangles, retainedTriangles, groundingCapTriangles: caps.length, sourceFiles: native.sources });
  }
  const bounds = new Box3().setFromBufferAttribute({ count: merged.positions.length / 3,
    getX: i => merged.positions[i * 3], getY: i => merged.positions[i * 3 + 1], getZ: i => merged.positions[i * 3 + 2] });
  const centre = bounds.getCenter(new Vector3());
  for (let i = 0; i < merged.positions.length; i += 3) { merged.positions[i] -= centre.x; merged.positions[i + 2] -= centre.z; }
  const size = bounds.getSize(new Vector3()).toArray();
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene(id);
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const maps = {};
  for (const [role, pixels] of Object.entries(atlas)) {
    const bytes = await sharp(pixels, { raw: { width: ATLAS_W, height: ATLAS_H, channels: 3 } }).flip().webp({ quality: role === 'normal' ? 97 : 94 }).toBuffer();
    await writeFile(`${out}/textures/${id}_${role}.webp`, bytes);
    maps[role] = doc.createTexture(`${id}_${role}`).setImage(bytes).setMimeType('image/webp');
  }
  const material = doc.createMaterial(`BK ${id} rounded stone and mottled moss`).setBaseColorTexture(maps.albedo)
    .setNormalTexture(maps.normal).setOcclusionTexture(maps.orm).setMetallicRoughnessTexture(maps.orm).setMetallicFactor(1).setRoughnessFactor(1);
  const accessor = (name, type, array) => doc.createAccessor(name).setType(type).setArray(Float32Array.from(array)).setBuffer(buffer);
  const primitive = doc.createPrimitive().setMaterial(material).setAttribute('POSITION', accessor('grounded rounded source surfaces', 'VEC3', merged.positions))
    .setAttribute('NORMAL', accessor('rigidly rotated source normals', 'VEC3', merged.normals)).setAttribute('TEXCOORD_0', accessor('source UVs packed in material atlas', 'VEC2', merged.uv));
  scene.addChild(doc.createNode(id).setMesh(doc.createMesh(id).addPrimitive(primitive))); doc.getRoot().setDefaultScene(scene);
  const io = new NodeIO().registerExtensions([EXTTextureWebP]), bytes = await io.writeBinary(doc), filepath = `models/${id}.glb`;
  await writeFile(`${out}/${filepath}`, bytes);
  const roundtrip = await io.readBinary(bytes), check = roundtrip.getRoot().listMeshes()[0].listPrimitives()[0];
  for (const name of ['POSITION', 'NORMAL', 'TEXCOORD_0']) if (check.getAttribute(name).getArray().some(v => !Number.isFinite(v))) throw Error(`${id}: non-finite ${name}`);
  if (check.getAttribute('POSITION').getMin([])[1] < -1e-7) throw Error('Ungrounded final mesh');
  const asset = { id, file: `models/fairy/${id}.glb`, pack: pack.id, category: 'rock', is: 'outcrop',
    tags: ['rock', 'moss', 'fairy', 'rounded-bank', 'source-derived'], bytes: bytes.length, sha256: hash(bytes),
    size: { x: size[0], y: size[1], z: size[2] }, base: { x: -size[0] / 2, y: 0, z: -size[2] / 2 },
    triangles: merged.positions.length / 9, animations: [], materials: [material.getName()], sourceProvenance: {
      source: pack.source, archive: source.archive, archiveSha256: source.archiveSha256,
      modifications: ['Five full-detail native boulder lobes rigidly laid sideways with varied uniform scales; no cuboid cliffs or substitute procedural mound geometry.',
        'Lower geometry clipped to one common Y=0 grounding plane and closed with downward triangulated caps. Source normals retained except the unseen caps.',
        'Original UVs retained on each clipped source surface, then packed by affine tile transforms into one 3072x2048 material atlas.',
        'Original boulder rock/normal/masks and Pure Nature grass/detail textures rebaked for the rounded orientation; finer triplanar detail and mottled moss with visible stone planes.'],
      parts: audit, centringTranslationXZ: [-centre.x, -centre.z], grounding: 'Flat closed minimum Y=0; bury 0.05 to 0.15m in final terrain, no deep skirt correction needed.' },
    acceptance: { assetAudit: true, labAccepted: false, worldIntegrated: false } };
  assets.push(asset); files[id] = filepath;
  await writeFile(`${out}/${id}.audit.json`, JSON.stringify({ asset, geometryBounds: { min: [-size[0] / 2, 0, -size[2] / 2], max: [size[0] / 2, size[1], size[2] / 2] }, parts: audit }, null, 2));
  await writeFile(`${out}/candidates.json`, JSON.stringify({ packs: [pack], assets, files, browserErrors: [] }, null, 2));
  console.log(JSON.stringify({ id, triangles: asset.triangles, size: asset.size, bytes: bytes.length, sha256: asset.sha256 }));
}

