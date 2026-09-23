import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const base = 'assets/art/tripo/imports/creatures/audit-knights/revenant';
const file = `${base}/waygrave-warden-native-rig.glb`;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.readBinary(await readFile(file));
const texture = doc.getRoot().listMeshes()[0].listPrimitives()[0].getMaterial().getBaseColorTexture();
if (!texture) throw new Error('Revenant has no base-color texture');
const image = await readFile(`${base}/runtime-atlas.jpg`);
texture.setImage(image).setMimeType('image/jpeg');
const bytes = await io.writeBinary(doc);
await writeFile(file, bytes);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const textureSha256 = createHash('sha256').update(image).digest('hex');
for (const path of [`${base}/catalog.json`, `${base}/lab-catalog.json`]) {
  const data = JSON.parse(await readFile(path, 'utf8'));
  if (data.candidate) {
    data.candidate.bytes = bytes.length;
    data.candidate.sha256 = sha256;
    data.candidate.pbr = 'Image-generated ashen undead skin, pale eyes and layered ragged gravecloth aligned to source UV atlas; original packed PBR and normal maps retained.';
    data.candidate.textureOverride = { file: `${base}/runtime-atlas.jpg`, sha256: textureSha256, width: 2048, height: 2048, imagegenCoverage: 0.86 };
  }
  for (const asset of data.assets ?? []) {
    asset.bytes = bytes.length;
    asset.sha256 = sha256;
    asset.sourceProvenance.candidateSha256 = sha256;
    asset.sourceProvenance.textureOverride = { file: `${base}/runtime-atlas.jpg`, sha256: textureSha256, width: 2048, height: 2048, imagegenCoverage: 0.86 };
    asset.metadata.is = 'Ashen waygrave revenant with ragged gravecloth';
  }
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
}
console.log(JSON.stringify({ file, bytes: bytes.length, sha256, textureSha256 }));
