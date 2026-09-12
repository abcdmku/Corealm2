/** Root-authorized asset registration; this does not place creatures in the final world. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const assetRoot = path.resolve(directory, '../../game/public/assets');
const manifestPath = path.join(assetRoot, 'manifest.json');
const catalog = JSON.parse(await readFile(path.join(directory, 'catalog.json'), 'utf8'));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const before = structuredClone(manifest);
const ids = new Set(catalog.assets.map(asset => asset.id));
assert.equal(ids.size, 12);
for (const asset of catalog.assets) {
  assert(asset.file.startsWith('models/fairy-crown/'));
  const bytes = await readFile(path.join(assetRoot, asset.file));
  assert.equal(bytes.length, asset.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
  const index = manifest.assets.findIndex(row => row.id === asset.id);
  if (index < 0) manifest.assets.push(asset);
  else manifest.assets[index] = asset;
}
assert.deepEqual(manifest.assets.filter(asset => !ids.has(asset.id)), before.assets.filter(asset => !ids.has(asset.id)));
assert.deepEqual({ ...manifest, assets: [] }, { ...before, assets: [] });
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('Registered only the 12 fairy/Crownward asset entries. Existing manifest entries preserved.');
