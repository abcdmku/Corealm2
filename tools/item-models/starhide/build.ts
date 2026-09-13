import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Rebuild all five pieces and pin every geometry/material input, not just the author wrapper. */
const author = 'armor-starhide-tailored';
const catalogPath = `art/item-models/candidates/${author}/catalogue.json`;
const hash = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes:true});
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]))).flat();
}
const inputs = [
  `tools/item-models/authors/${author}.ts`, 'tools/item-models/contracts.ts', 'tools/item-models/build.ts',
  'tools/item-models/skin.ts', 'tools/item-models/core/profile.ts', 'tools/item-models/core/contracts.ts',
  'tools/item-models/core/body-profile.json', 'game/public/assets/models/character/base_male.glb',
  ...(await files('tools/item-models/starhide')).filter(file => /\.(ts|json|py)$/.test(file)),
  ...(await files('art/starhide/textures')).filter(file => /\.(png|json)$/.test(file)),
  ...['hood','robe','leggings','boots','wraps'].map(part => `art/item-icons/generated/starhide_${part}.png`),
].sort();
async function dependencies() {
  return Promise.all(inputs.map(async file => {
    const raw = await readFile(file);
    const bytes = /\.(ts|json|py)$/.test(file) ? Buffer.from(raw.toString().replaceAll('\r\n','\n')) : raw;
    return {file, sha256:hash(bytes), bytes:bytes.length, encoding:/\.(ts|json|py)$/.test(file) ? 'utf8-lf' : 'binary'};
  }));
}
const before = await dependencies();
if (process.argv.includes('--verify')) {
  const catalog = JSON.parse(await readFile(catalogPath,'utf8'));
  assert.equal(catalog.dependencySha256, hash(JSON.stringify(before)), 'Starhide source dependencies changed since export');
  for (const entry of catalog.assets) assert.equal(hash(await readFile(path.join(path.dirname(catalogPath),entry.file))),entry.sha256);
  console.log('Starhide source and five GLB hashes match.');
} else {
  const result = spawnSync(process.execPath,['--import','tsx','tools/item-models/build.ts','--author',author],{stdio:'inherit'});
  assert.equal(result.status,0,'Starhide export failed');
  assert.deepEqual(await dependencies(),before,'Starhide sources changed during export');
  const catalog = JSON.parse(await readFile(catalogPath,'utf8'));
  catalog.sourceDependencies=before;
  catalog.dependencySha256=hash(JSON.stringify(before));
  for(const entry of catalog.assets) entry.dependencySha256=catalog.dependencySha256;
  await writeFile(catalogPath,JSON.stringify(catalog,null,2)+'\n');
  console.log(`Pinned ${before.length} Starhide source dependencies.`);
}
