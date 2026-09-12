/** Run only after the root has accepted the staged catalogue in the production foliage lab. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const stagedRoot = path.resolve('test-results/fairy-foliage');
const productionRoot = path.resolve('game/public/assets');
const catalog = JSON.parse(await readFile(path.join(stagedRoot, 'catalog.json'), 'utf8'));
const manifestPath = path.join(productionRoot, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const derivationGenerator = 'tools/fairy-foliage/build.mjs';
const derivationGeneratorSha256 = sha(await readFile(derivationGenerator));
const checked = [];
for (const entry of catalog.assets) {
  if (!/^models\/fairy-foliage\/[a-z0-9_]+\.glb$/.test(entry.file)) throw new Error(`Unexpected target ${entry.file}`);
  const bytes = await readFile(path.join(stagedRoot, entry.file));
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== entry.sha256 || bytes.length !== entry.bytes) throw new Error(`Stale candidate ${entry.id}`);
  checked.push({ entry, bytes });
}
await mkdir(path.join(productionRoot, 'models/fairy-foliage'), { recursive: true });
for (const { entry, bytes } of checked) {
  await writeFile(path.join(productionRoot, entry.file), bytes);
  const previous = manifest.assets.findIndex(asset => asset.id === entry.id);
  if (previous < 0) manifest.assets.push(entry);
  else manifest.assets[previous] = entry;
}
for (const pack of catalog.packs) {
  const source = manifest.packs.find(entry => entry.id === pack.upstreamPackId);
  if (!source || pack.id !== `${source.id}-fairy-skins`
    || pack.source !== source.source || pack.license !== source.license
    || pack.author !== source.author || pack.archiveSha256 !== source.archiveSha256
    || pack.generatorSha256 !== source.generatorSha256
    || pack.derivationGenerator !== derivationGenerator
    || pack.derivationGeneratorSha256 !== derivationGeneratorSha256
    || pack.derivedFrom?.id !== source.id || pack.derivedFrom?.source !== source.source
    || pack.derivedFrom?.license !== source.license) {
    throw new Error(`${pack.id}: stale or incomplete source-pack provenance`);
  }
  const previous = manifest.packs.findIndex(entry => entry.id === pack.id);
  if (previous < 0) manifest.packs.push(pack);
  else manifest.packs[previous] = pack;
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ promoted: checked.length, packs: catalog.packs.length, target: 'game/public/assets/models/fairy-foliage' }));
