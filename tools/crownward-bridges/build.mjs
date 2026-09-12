/** Stage the pinned CC0 Quaternius timber bridge. No production files are modified. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import { Matrix4, Vector3, Ray } from 'three';
const id = 'crownward_timber_bridge';
const root = 'test-results/crownward-bridges';
const page = 'https://poly.pizza/m/j4KsIuJYnq';
const download = 'https://static.poly.pizza/e36966b4-e13e-46e8-aa2c-f9b643536d46.glb';
const expectedHash = '055ec4fa6c401f655641894ee4b0bd360c28b7907bc00183ef3b1eabd6fc0890';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const round = value => Math.round(value * 1e6) / 1e6;
const vector = v => ({ x: round(v[0]), y: round(v[1]), z: round(v[2]) });
await Promise.all(['sources', 'models/crownward-bridges'].map(p => mkdir(`${root}/${p}`, { recursive: true })));
const response = await fetch(download); assert(response.ok);
const source = Buffer.from(await response.arrayBuffer());
assert.equal(hash(source), expectedHash); assert.equal(source.length, 72792);
await writeFile(`${root}/sources/${id}.source.glb`, source);
const io = new NodeIO();
const original = await io.readBinary(source);
const sourceBounds = getBounds(original.getRoot().getDefaultScene());
const n = source.readUInt32LE(12), tail = source.subarray(20 + n);
const json = JSON.parse(source.subarray(20, 20 + n).toString());
const scene = json.scenes[json.scene ?? 0]; assert.equal(scene.nodes.length, 1);
const sceneRoot = json.nodes[scene.nodes[0]]; assert(!sceneRoot.mesh && !sceneRoot.matrix);
sceneRoot.translation = [-(sourceBounds.min[0] + sourceBounds.max[0]) / 2, -sourceBounds.min[1], -(sourceBounds.min[2] + sourceBounds.max[2]) / 2];
const rawJson = Buffer.from(JSON.stringify(json));
const padded = Buffer.alloc((rawJson.length + 3) & ~3, 32); rawJson.copy(padded);
const header = Buffer.alloc(20); header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length + tail.length, 8); header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
const staged = Buffer.concat([header, padded, tail]);
const file = `models/crownward-bridges/${id}.glb`;
await writeFile(`${root}/${file}`, staged);
const doc = await io.readBinary(staged), bounds = getBounds(doc.getRoot().getDefaultScene());
const size = bounds.max.map((v, i) => v - bounds.min[i]);
const triangles = [];
for (const node of doc.getRoot().listNodes()) {
  if (!node.getMesh()) continue;
  const matrix = new Matrix4().fromArray(node.getWorldMatrix());
  for (const primitive of node.getMesh().listPrimitives()) {
    const pos = primitive.getAttribute('POSITION'), index = primitive.getIndices();
    const vertex = i => new Vector3().fromArray(pos.getElement(index ? index.getScalar(i) : i, [])).applyMatrix4(matrix);
    for (let i = 0; i < (index?.getCount() ?? pos.getCount()); i += 3) triangles.push([vertex(i), vertex(i + 1), vertex(i + 2)]);
  }
}
const sample = (x, z) => {
  const ray = new Ray(new Vector3(x, 10, z), new Vector3(0, -1, 0)), hits = [];
  for (const t of triangles) { const hit = ray.intersectTriangle(...t, false, new Vector3()); if (hit) hits.push(hit.y); }
  return hits.length ? round(Math.max(...hits)) : null;
};
const deckProfile = Array.from({ length: 33 }, (_, i) => {
  const x = -3.2 + i * .2;
  return { x: round(x), y: sample(x, 0), leftY: sample(x, -.65), rightY: sample(x, .65) };
});
const pack = { id: 'quaternius-small-bridge-source-glb', name: 'Quaternius Small Bridge source GLB', author: 'Quaternius', license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', source: page, directDownload: download, sourcePath: `${root}/sources/${id}.source.glb`, archiveName: 'e36966b4-e13e-46e8-aa2c-f9b643536d46.glb', archiveSha256: expectedHash };
const scale = 24 / size[0];
const asset = { id, file, pack: pack.id, category: 'building', is: 'bridge', tags: ['building', 'bridge', 'wood', 'crownward', 'premade'], bytes: staged.length, sha256: hash(staged), size: vector(size), base: vector(bounds.min), animations: [], materials: doc.getRoot().listMaterials().map(m => m.getName()), triangles: triangles.length,
  metadata: { premadeSource: { title: 'Small Bridge', author: 'Quaternius', sourcePage: page, directDownload: download, license: pack.license, licenseUrl: pack.licenseUrl, sourceSha256: expectedHash, sourceBytes: source.length, transform: 'Scene-root translation only. Center X/Z, authored minimum Y to zero. Geometry and embedded material bytes unchanged.' }, inspection: { sourceBounds: { min: vector(sourceBounds.min), max: vector(sourceBounds.max) }, normalizedBounds: { min: vector(bounds.min), max: vector(bounds.max) }, crossingAxis: 'X', deckProfile, targetSpanMeters: 24, targetUniformScale: round(scale), resultMeters: vector(size.map(v => v * scale)), note: 'Arched timber deck; do not use a flat deck collider. Deck samples are normalized asset-local top-surface ray hits at Z=0 and +/-0.65. Outer rail tips extend beyond traversable deck ends. A profile-following walkable surface and matching bank ramps are required.' } }, acceptance: { exported: true, labAccepted: false, worldIntegrated: false } };
const catalog = { packs: [pack], files: { [id]: `../../${root}/${file}` }, assets: [asset], generator: { command: 'node tools/crownward-bridges/build.mjs', deterministicForPinnedSources: true, generatorSha256: hash(await readFile(import.meta.filename)), stagingRoot: root } };
await writeFile('tools/crownward-bridges/catalog.json', JSON.stringify(catalog, null, 2) + '\n');
await writeFile('tools/crownward-bridges/provenance.json', JSON.stringify({ pack, sourceByteIdentical: true, sourceBinSha256: hash(tail), candidateBinSha256: hash(staged.subarray(20 + padded.length)), asset }, null, 2) + '\n');
console.log(JSON.stringify({ id, size: asset.size, triangles: asset.triangles, scale, resultMeters: asset.metadata.inspection.resultMeters, deckProfile }, null, 2));
