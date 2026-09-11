import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Root runs this only after inspecting the staged production lab renders and state evidence.
const catalogs = process.argv.slice(2);
if (!catalogs.length) throw new Error('Provide accepted candidate catalog paths');
const assetRoot = path.resolve('game/public/assets');
const manifestPath = path.join(assetRoot, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
for (const catalogPath of catalogs) {
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const directory = path.dirname(path.resolve(catalogPath));
  for (const entry of catalog.assets) {
    const source = path.resolve(directory, catalog.files?.[entry.id] ?? entry.file);
    const bytes = await readFile(source);
    if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
      throw new Error(`Candidate changed after export: ${entry.id}`);
    }
    const target = path.resolve(assetRoot, entry.file);
    if (!target.startsWith(assetRoot + path.sep)) throw new Error(`Invalid asset path ${entry.file}`);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    const accepted = { ...entry, acceptance: { ...entry.acceptance, exported: true, labAccepted: true, worldIntegrated: false } };
    const index = manifest.assets.findIndex(asset => asset.id === entry.id);
    if (index < 0) manifest.assets.push(accepted); else manifest.assets[index] = accepted;
    console.log(`${entry.id}: ${bytes.length} bytes`);
  }
  for (const texture of catalog.sharedTextures ?? []) {
    const target = path.resolve(assetRoot, texture.file);
    if (!target.startsWith(assetRoot + path.sep)) throw new Error(`Invalid texture path ${texture.file}`);
    const source = path.resolve(directory, texture.file), bytes = await readFile(source);
    if (bytes.length !== texture.bytes || createHash('sha256').update(bytes).digest('hex') !== texture.sha256) throw new Error(`Stale texture ${texture.file}`);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  for (const pack of [...(catalog.pack ? [catalog.pack] : []), ...(catalog.packs ?? [])]) {
    if (!manifest.packs.some(existing => existing.id === pack.id)) manifest.packs.push(pack);
  }
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
