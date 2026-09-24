import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/(?=[A-Za-z]:)/, '');
const repo = path.resolve(here, '../../../../../../');
const relative = 'assets/art/tripo/imports/creatures/audit-polish-arthropods/';
const hash = data => createHash('sha256').update(data).digest('hex');
const expected = {
  beetle: 'ca94af139abe3fb452b18f2ac95261217c05b2286e16eaa48d0538bb6407f5fc',
  centipede: '1648c881291809bdd18529b9374ed2626643f203b93cf471131880a6be728ddf',
};

const beetle = await readFile(path.join(here, 'creature_antler_beetle.glb'));
if (hash(beetle) !== expected.beetle) throw new Error('Staged image-generated beetle candidate changed');
const source = await readFile(path.join(here, 'sources/creature_slag_centipede.glb'));
if (hash(source) !== expected.centipede) throw new Error('Production centipede source changed');
const jsonLength = source.readUInt32LE(12);
const json = JSON.parse(source.toString('utf8', 20, 20 + jsonLength));
const binOffset = 20 + jsonLength;
if (source.readUInt32LE(binOffset + 4) !== 0x004e4942) throw new Error('Expected GLB BIN');
const originalBin = source.subarray(binOffset + 8, binOffset + 8 + source.readUInt32LE(binOffset));
const atlas = await readFile(path.join(here, 'centipede-chitin-atlas-imagegen.png'));
const dimensions = await sharp(atlas).metadata();
if (!dimensions.width || dimensions.width !== dimensions.height || dimensions.width < 1000) throw new Error('Expected square 1K+ atlas');
const roles = ['dorsal', 'lateral', 'claws', 'ventral'];
const segments = [originalBin];
let byteLength = originalBin.length;
function addImage(data, name) {
  const bufferView = json.bufferViews.length;
  json.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.length });
  json.images.push({ name, mimeType: 'image/jpeg', bufferView });
  segments.push(data);
  byteLength += data.length;
  const padding = (4 - byteLength % 4) % 4;
  if (padding) { segments.push(Buffer.alloc(padding)); byteLength += padding; }
  json.textures.push({ source: json.images.length - 1, sampler: 0 });
  return json.textures.length - 1;
}
const textures = [];
for (let i = 0; i < 4; i++) {
  const left = Math.floor(i * dimensions.width / 4);
  const right = Math.floor((i + 1) * dimensions.width / 4);
  const image = await sharp(atlas).extract({ left, top: 0, width: right - left, height: dimensions.height })
    .resize(1024, 1024, { fit: 'fill' }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  textures.push(addImage(image, `imagegen_centipede_${roles[i]}`));
}
const materials = new Map(json.materials.map(material => [material.name, material]));
for (const [name, index] of [
  ['slag_centipede_shell', textures[0]],
  ['slag_centipede_shellAlt', textures[1]],
  ['slag_centipede_horn', textures[2]],
  ['slag_centipede_joint', textures[3]],
  ['slag_centipede_seam', textures[3]],
]) {
  const material = materials.get(name);
  if (!material) throw new Error(`Missing ${name}`);
  material.pbrMetallicRoughness.baseColorTexture = { index };
  material.pbrMetallicRoughness.baseColorFactor = [1, 1, 1, 1];
}
json.buffers[0].byteLength = byteLength;
const jsonBytes = Buffer.from(JSON.stringify(json));
const jsonPadded = Buffer.concat([jsonBytes, Buffer.alloc((4 - jsonBytes.length % 4) % 4, 0x20)]);
const bin = Buffer.concat(segments);
const header = Buffer.alloc(20);
header.write('glTF', 0, 'ascii'); header.writeUInt32LE(2, 4);
header.writeUInt32LE(20 + jsonPadded.length + 8 + bin.length, 8);
header.writeUInt32LE(jsonPadded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(bin.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
const centipede = Buffer.concat([header, jsonPadded, binHeader, bin]);
await writeFile(path.join(here, 'creature_slag_centipede.glb'), centipede);

const production = JSON.parse(await readFile(path.join(here, 'source-manifest.json'), 'utf8'));
const beetleOriginal = JSON.parse(await readFile(path.join(here, 'source-beetle.json'), 'utf8'));
const centipedeOriginal = production.assets.find(asset => asset.id === 'creature_slag_centipede');
if (!centipedeOriginal) throw new Error('Centipede production entry absent');
const builderHash = hash(await readFile(path.join(here, 'build.mjs')));
const catalog = {
  schema: 'corealm-lab-asset-candidates/1',
  pack: {
    id: 'corealm-arthropod-polish', name: 'Corealm arthropod chitin polish', author: 'Corealm',
    source: `${relative}build.mjs`, license: 'LicenseRef-Corealm-Original', generatorSha256: builderHash,
  },
  assets: [
    {
      ...beetleOriginal,
      pack: 'corealm-arthropod-polish',
      candidateFile: `${relative}creature_antler_beetle.glb`,
      metadata: { ...beetleOriginal.metadata, polishSourceBuilder: 'assets/art/tripo/imports/creatures/audit-antler-beetle/build.mjs' },
      acceptance: { assetAudit: false, labAccepted: false, worldIntegrated: false },
    },
    {
      ...centipedeOriginal,
      pack: 'corealm-arthropod-polish', bytes: centipede.length, sha256: hash(centipede),
      candidateFile: `${relative}creature_slag_centipede.glb`,
      sourceProvenance: `Original Corealm procedural centipede sculpture, 81-joint skin and eight clips; source GLB SHA-256 ${hash(source)}. New image-generated layered armor atlas SHA-256 ${hash(atlas)}.`,
      metadata: {
        ...centipedeOriginal.metadata,
        notes: 'Original twenty-leg segmented centipede anatomy, skinning, eight clips, normal and roughness maps unchanged. Image-generated red iron dorsal plates, bronze lateral chitin, highlighted leg cuticle and mandibles, dark ventral joints. No geometry or motion edits.',
        sourceGlbSha256: hash(source), sourceBinSha256: hash(originalBin), sourceAtlasSha256: hash(atlas),
        textureGeneratorSha256: builderHash,
      },
      acceptance: { assetAudit: false, labAccepted: false, worldIntegrated: false },
    },
  ],
};
await writeFile(path.join(here, 'lab-catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
await writeFile(path.join(here, 'promotion.json'), JSON.stringify(catalog, null, 2) + '\n');
console.log(JSON.stringify({ beetle: { bytes: beetle.length, sha256: hash(beetle) }, centipede: { bytes: centipede.length, sha256: hash(centipede), sourceBinPreserved: bin.subarray(0, originalBin.length).equals(originalBin) }, atlasSha256: hash(atlas), builderSha256: builderHash }, null, 2));
