/** Stage fairy material skins. The entire source BIN chunk is copied byte for byte. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const out = path.resolve('test-results/fairy-foliage');
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const derivationGenerator = 'tools/fairy-foliage/build.mjs';
const derivationGeneratorSha256 = sha(await readFile(derivationGenerator));
const variants = [
  ['corealm_willow_gloam_1', 'corealm_willow_1', 'gloam'],
  ['corealm_willow_gloam_2', 'corealm_willow_2', 'gloam'],
  ['corealm_yew_fae_1', 'corealm_yew_1', 'fae'],
  ['corealm_yew_fae_2', 'corealm_yew_2', 'fae'],
  ['corealm_fern_gloam_1', 'corealm_fern_1', 'gloam'],
  ['corealm_shrub_fae_1', 'corealm_shrub_1', 'fae'],
  ['mushroom_gloam', 'mushroom_common', 'gloam'],
  ['mushroom_fae', 'mushroom_bracket', 'fae'],
];
const packs = ['corealm-original-nature', 'stylized-nature-megakit'].map(id => {
  const source = manifest.packs.find(pack => pack.id === id);
  if (!source) throw new Error(`Missing source pack ${id}`);
  return { ...source, id: `${id}-fairy-skins`, name: `${source.name}, fairy material skins`,
    upstreamPackId: source.id,
    derivation: 'Material-name aliases only; source geometry records and GLB binary chunks retained unchanged',
    derivationGenerator,
    derivationGeneratorSha256,
    derivedFrom: { ...source } };
});
const assets = [], proof = [];
await mkdir(path.join(out, 'models/fairy-foliage'), { recursive: true });
for (const [id, sourceId, style] of variants) {
  const entry = manifest.assets.find(asset => asset.id === sourceId);
  if (!entry) throw new Error(`Missing source ${sourceId}`);
  const bytes = await readFile(path.join('game/public/assets', entry.file));
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(16) !== 0x4e4f534a) {
    throw new Error(`Expected GLB v2 JSON-first source: ${sourceId}`);
  }
  const jsonSize = bytes.readUInt32LE(12);
  const document = JSON.parse(bytes.subarray(20, 20 + jsonSize).toString('utf8'));
  const geometry = JSON.stringify({ meshes: document.meshes, accessors: document.accessors, bufferViews: document.bufferViews, nodes: document.nodes });
  for (const material of document.materials ?? []) {
    const sourceName = material.name;
    material.name = `${sourceName === 'Mushrooms' ? 'Leaves_Fairy_mushroom' : sourceName === 'Stem_Corealm' ? 'Bark_Corealm' : sourceName}@fairy:${style}`;
  }
  const json = Buffer.from(JSON.stringify(document));
  const paddedJson = Buffer.alloc((json.length + 3) & ~3, 0x20);
  json.copy(paddedJson);
  const sourceTail = bytes.subarray(20 + jsonSize);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + paddedJson.length + sourceTail.length, 8);
  header.writeUInt32LE(paddedJson.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const result = Buffer.concat([header, paddedJson, sourceTail]);
  const finalDocument = JSON.parse(result.subarray(20, 20 + result.readUInt32LE(12)).toString('utf8'));
  const nextGeometry = JSON.stringify({ meshes: finalDocument.meshes, accessors: finalDocument.accessors, bufferViews: finalDocument.bufferViews, nodes: finalDocument.nodes });
  if (geometry !== nextGeometry || sha(sourceTail) !== sha(result.subarray(20 + paddedJson.length))) throw new Error(`Changed source geometry: ${id}`);
  const file = `models/fairy-foliage/${id}.glb`;
  await writeFile(path.join(out, file), result);
  assets.push({ ...entry, id, file, pack: `${entry.pack}-fairy-skins`,
    is: `${style === 'gloam' ? 'Teal Gloamgarden' : 'Lilac Faeholme'} skin of ${entry.is ?? sourceId}.`,
    tags: [...new Set([...(entry.tags ?? []), 'fairy', style === 'gloam' ? 'gloamgarden' : 'faeholme'])],
    bytes: result.length, sha256: sha(result), materials: finalDocument.materials.map(material => material.name),
    provenance: { sourceId, source: entry.file, sourceSha256: sha(bytes), sourcePack: entry.pack,
      sourceBinaryChunksSha256: sha(sourceTail), geometryJsonSha256: sha(geometry),
      geometry: 'Source mesh, accessor, bufferView, nodes and all binary chunks unchanged',
      material: `Material name suffix @fairy:${style}; production MaterialLibrary applies luminance-preserving chroma skin`,
      generator: 'tools/fairy-foliage/build.mjs' } });
  proof.push({ id, sourceId, binaryChunksUnchanged: true, geometryUnchanged: true, triangles: entry.triangles ?? null });
}
await writeFile(path.join(out, 'catalog.json'), `${JSON.stringify({ packs, generator: { command: 'node tools/fairy-foliage/build.mjs', deterministic: true }, assets }, null, 2)}\n`);
await writeFile(path.join(out, 'geometry-proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
console.log(JSON.stringify({ catalog: 'test-results/fairy-foliage/catalog.json', assets: assets.length, bytes: assets.reduce((total, asset) => total + asset.bytes, 0), unchangedBinaryChunks: proof.every(row => row.binaryChunksUnchanged) }));
