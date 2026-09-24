import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/(?=[A-Za-z]:)/, '');
const repo = path.resolve(here, '../../../../../../');
const sourceFile = path.join(repo, 'game/public/assets/models/creature/creature_antler_beetle.glb');
const atlasFile = path.join(here, 'chitin-atlas-imagegen.png');
const source = await readFile(sourceFile);
const sourceHash = createHash('sha256').update(source).digest('hex');
if (sourceHash !== '20d84497501fe66ce610b3a28f1fd050d161f94e382d2bca08d5381a27046779') throw new Error(`Source changed: ${sourceHash}`);
const originalJsonLength = source.readUInt32LE(12);
const originalJson = JSON.parse(source.toString('utf8', 20, 20 + originalJsonLength));
const originalBinOffset = 20 + originalJsonLength;
if (source.readUInt32LE(originalBinOffset + 4) !== 0x004e4942) throw new Error('Expected GLB BIN chunk');
const originalBin = source.subarray(originalBinOffset + 8, originalBinOffset + 8 + source.readUInt32LE(originalBinOffset));
const atlas = await readFile(atlasFile);
const dimensions = await sharp(atlas).metadata();
if (dimensions.width !== dimensions.height || !dimensions.width || dimensions.width < 1000) throw new Error('Expected square 1K+ atlas');
const width = dimensions.width;
const roles = ['elytra', 'thorax_legs', 'mandibles', 'ventral'];
const images = [];
for (let index = 0; index < roles.length; index++) {
  const left = Math.floor(index * width / 4);
  const right = Math.floor((index + 1) * width / 4);
  const jpeg = await sharp(atlas).extract({left, top: 0, width: right - left, height: width})
    .resize(1024, 1024, {fit: 'fill'}).jpeg({quality: 84, mozjpeg: true}).toBuffer();
  await writeFile(path.join(here, `chitin-${roles[index]}.jpg`), jpeg);
  images.push(jpeg);
}
const json = originalJson;
const segments = [originalBin];
let byteLength = originalBin.length;
function addImage(buffer, name) {
  const view = json.bufferViews.length;
  json.bufferViews.push({buffer: 0, byteOffset: byteLength, byteLength: buffer.length});
  json.images.push({name, mimeType: 'image/jpeg', bufferView: view});
  segments.push(buffer);
  byteLength += buffer.length;
  const padding = (4 - (byteLength % 4)) % 4;
  if (padding) { segments.push(Buffer.alloc(padding)); byteLength += padding; }
  json.textures.push({source: json.images.length - 1, sampler: 0});
  return json.textures.length - 1;
}
const slots = images.map((jpeg, index) => addImage(jpeg, `imagegen_${roles[index]}`));
const byName = new Map(json.materials.map((material) => [material.name, material]));
for (const [name, slot] of [
  ['antler_beetle_shell', slots[0]],
  ['antler_beetle_shellAlt', slots[1]],
  ['antler_beetle_horn', slots[2]],
  ['antler_beetle_ventral_chitin', slots[3]],
  ['antler_beetle_joint', slots[3]],
]) {
  const material = byName.get(name);
  if (!material) throw new Error(`Missing ${name}`);
  material.pbrMetallicRoughness.baseColorTexture = {index: slot};
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
const result = Buffer.concat([header, jsonPadded, binHeader, bin]);
const candidate = path.join(here, 'creature_antler_beetle.glb');
await writeFile(candidate, result);
const manifest = JSON.parse(await readFile(path.join(repo, 'game/public/assets/manifest.json'), 'utf8'));
const existing = manifest.assets.find((asset) => asset.id === 'creature_antler_beetle');
if (!existing) throw new Error('Current beetle entry absent');
const buildSource = path.join(here, 'build.mjs');
const builderHash = createHash('sha256').update(await readFile(buildSource)).digest('hex');
const atlasHash = createHash('sha256').update(atlas).digest('hex');
const candidateHash = createHash('sha256').update(result).digest('hex');
const catalog = {
  schema: 'corealm-lab-asset-candidates/1',
  pack: {
    id: 'corealm-antler-beetle-chitin-polish', name: 'Corealm Stag Beetle chitin polish',
    author: 'Corealm',
    source: 'assets/art/tripo/imports/creatures/audit-antler-beetle/build.mjs',
    license: 'LicenseRef-Corealm-Original', generatorSha256: builderHash,
  },
  assets: [{
    ...existing,
    candidateFile: 'assets/art/tripo/imports/creatures/audit-antler-beetle/creature_antler_beetle.glb',
    pack: 'corealm-antler-beetle-chitin-polish', bytes: result.length, sha256: candidateHash,
    sourceProvenance: `Original Corealm procedural sculpture and eight clips; base GLB SHA-256 ${sourceHash}. Four image-generated layered chitin surfaces; master atlas SHA-256 ${atlasHash}.`,
    metadata: {
      ...existing.metadata,
      notes: 'Original Stag Beetle anatomy, weights, eight animation clips, normal and roughness maps unchanged. Image-generated jade elytra, olive thorax and upper legs, bronze mandibles and lower legs, dark ventral chitin. Separate detailed surface colors now resolve segmentation at gameplay distance.',
      sourceGlbSha256: sourceHash, sourceBinSha256: createHash('sha256').update(originalBin).digest('hex'),
      sourceAtlasSha256: atlasHash, textureGeneratorSha256: builderHash,
    },
    acceptance: {assetAudit: true, labAccepted: false, worldIntegrated: false},
  }],
};
await writeFile(path.join(here, 'lab-catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
await writeFile(path.join(here, 'promotion.json'), JSON.stringify(catalog, null, 2) + '\n');
console.log(JSON.stringify({sourceHash, atlasHash: createHash('sha256').update(atlas).digest('hex'), candidateHash: createHash('sha256').update(result).digest('hex'), bytes: result.length, originalBinSha256: createHash('sha256').update(originalBin).digest('hex'), preservedOriginalBinPrefix: bin.subarray(0, originalBin.length).equals(originalBin), roles}, null, 2));
