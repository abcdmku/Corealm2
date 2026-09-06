/** Copy a hash-verified candidate subset; never public promotion. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const [source, destination, names] = process.argv.slice(2);
assert(source && destination && names, 'Usage: stage-subset.mjs source-directory destination-directory comma-separated-species');
const catalogue = JSON.parse(await readFile(path.join(source, 'catalog.json'), 'utf8'));
const ids = new Set(names.split(',').map(id => `creature_${id}`));
const assets = catalogue.assets.filter(entry => ids.has(entry.id));
assert.equal(assets.length, ids.size, 'Missing requested subset asset');
const referenced = new Set();
async function copyVerified(file, expected) {
  assert(!path.isAbsolute(file) && !file.split(/[\\/]/).includes('..'), `Unsafe candidate path ${file}`);
  const bytes = await readFile(path.join(source, file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, `Hash mismatch ${file}`);
  assert.equal(bytes.length, expected.bytes, `Byte count mismatch ${file}`);
  await mkdir(path.dirname(path.join(destination, file)), { recursive: true });
  await writeFile(path.join(destination, file), bytes);
  return bytes;
}
for (const entry of assets) {
  const bytes = await copyVerified(entry.candidateFile, entry);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  for (const image of gltf.images ?? []) if (image.uri && !image.uri.startsWith('data:')) referenced.add(path.posix.normalize(path.posix.join(path.posix.dirname(entry.file), image.uri)));
}
const sharedTextures = (catalogue.sharedTextures ?? []).filter(texture => referenced.has(texture.file));
assert.equal(sharedTextures.length, referenced.size, 'Missing referenced shared texture');
for (const texture of sharedTextures) await copyVerified(texture.file, texture);
const packs = catalogue.packs.filter(pack => assets.some(entry => entry.pack === pack.id));
await writeFile(path.join(destination, 'catalog.json'), JSON.stringify({ packs, sharedTextures, files: Object.fromEntries(assets.map(entry => [entry.id, entry.candidateFile])), assets }, null, 2) + '\n');
console.log(JSON.stringify({ models: assets.length, sharedTextures: sharedTextures.length, destination }));
