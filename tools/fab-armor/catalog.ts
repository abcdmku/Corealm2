import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { AssetManifest, AssetEntry, AssetPack } from '../../game/src/render/assets.js';

const staging = path.resolve('.asset-cache/fab-armor');
const catalogs = ['lowpoly/candidates.json', ...['melee', 'mage'].flatMap(style =>
  [50, 70, 90].flatMap(tier => ['male', 'female'].map(body => `adapted-paragon/candidates-${style}-t${tier}-${body}.json`)))];
const assets: AssetEntry[] = [];
const files: Record<string, string> = {};
const packs = new Map<string, AssetPack>();
for (const relative of catalogs) {
  const filename = path.join(staging, relative);
  const catalog = JSON.parse(await readFile(filename, 'utf8'));
  packs.set(catalog.pack.id, catalog.pack);
  for (const entry of catalog.assets as (AssetEntry & { sha256: string })[]) {
    if (files[entry.id]) throw new Error(`Duplicate candidate ${entry.id}`);
    const source = path.resolve(path.dirname(filename), catalog.files?.[entry.id] ?? entry.file);
    if (!source.startsWith(staging + path.sep)) throw new Error('Candidate source leaves staging');
    const bytes = await readFile(source);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== entry.bytes || hash !== entry.sha256) throw new Error(`Stale ${entry.id}`);
    assets.push(entry);
    files[entry.id] = path.relative(staging, source).replaceAll('\\', '/');
  }
}
if (assets.length !== 64) throw new Error(`Expected 64 fitted armor assets, found ${assets.length}`);
if (process.argv.includes('--mystic')) {
  const filename = path.join(staging, 'mystic-cloth/candidates.json');
  const catalog = JSON.parse(await readFile(filename, 'utf8'));
  const mageEntries = (catalog.assets as (AssetEntry & { sha256: string })[])
    .filter(entry => /^fab_(male|female)_(tideweave|nightweave|frostweave)_/.test(entry.id));
  if (mageEntries.length !== 28) throw new Error(`Expected 28 mystic cloth candidates, found ${mageEntries.length}`);
  for (const entry of mageEntries) {
    const source = path.resolve(path.dirname(filename), catalog.files?.[entry.id] ?? entry.file);
    if (!source.startsWith(staging + path.sep)) throw new Error('Mystic candidate leaves staging');
    const bytes = await readFile(source);
    if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
      throw new Error(`Stale mystic cloth candidate ${entry.id}`);
    }
    const index = assets.findIndex(row => row.id === entry.id);
    if (index < 0) throw new Error(`Unexpected mystic cloth asset ${entry.id}`);
    assets[index] = entry;
    files[entry.id] = path.relative(staging, source).replaceAll('\\', '/');
  }
}
packs.get('fab-paragon-greystone')!.source = 'https://www.fab.com/listings/122fd7bf-6f12-4304-a930-cccbbacdaebc';
packs.get('fab-paragon-kwang')!.source = 'https://www.fab.com/listings/f4c67e92-b976-4b5b-ab9f-4c25b010f6f3';
packs.get('fab-lowpoly-medieval-modular-armors')!.source = 'https://www.fab.com/listings/d32023d6-cc7c-4a6b-bbc6-b0821c3d3391';
for (const pack of packs.values()) pack.license = 'Fab Standard License';
await writeFile(path.join(staging, 'candidates.json'), JSON.stringify({ assets, files, packs: [...packs.values()] }, null, 2) + '\n');
if (process.argv.includes('--promote')) {
  const destination = path.resolve('game/public/assets');
  const manifest: AssetManifest = JSON.parse(await readFile(path.join(destination, 'manifest.json'), 'utf8'));
  for (const entry of assets) {
    const target = path.resolve(destination, entry.file);
    if (!target.startsWith(destination + path.sep)) throw new Error('Asset output leaves public assets');
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.resolve(staging, files[entry.id]!), target);
    const index = manifest.assets.findIndex(row => row.id === entry.id);
    if (index < 0) manifest.assets.push(entry); else manifest.assets[index] = entry;
  }
  for (const pack of packs.values()) {
    const index = manifest.packs.findIndex(row => row.id === pack.id);
    if (index < 0) manifest.packs.push(pack); else manifest.packs[index] = pack;
  }
  await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}
console.log(JSON.stringify({ assets: assets.length, bytes: assets.reduce((sum, row) => sum + row.bytes, 0), promoted: process.argv.includes('--promote') }));
