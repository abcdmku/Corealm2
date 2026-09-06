import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const directory = path.resolve('art/rebuild/candidates/finish-motion');
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
const assets: any[] = [], files: Record<string, string> = {}, sourceHashes: Record<string, string> = {}, timingUpdates: Record<string, unknown> = {};
for (const folder of ['ground-creature-gaits', 'scorpion-ground-gait', 'rhino-contact']) {
  const proposals = JSON.parse(await readFile(path.join(directory, folder, 'manifest-updates.json'), 'utf8'));
  for (const proposal of proposals) {
    const original = manifest.assets.find((asset: any) => asset.id === proposal.id);
    if (!original || !proposal.offlinePassed || original.sha256.toLowerCase() !== proposal.sourceSha256.toLowerCase()) throw new Error(`Missing or changed public base ${proposal.id}`);
    const candidateFile = `${folder}/${proposal.id}.glb`, bytes = await readFile(path.join(directory, candidateFile));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== proposal.sha256 || bytes.length !== proposal.bytes) throw new Error(`Stale staged candidate ${proposal.id}`);
    assets.push({ ...original, ...proposal.set, sha256, bytes: bytes.length, candidateFile });
    files[proposal.id] = candidateFile;
    sourceHashes[proposal.id] = proposal.sourceSha256;
    if (proposal.setTiming) timingUpdates[proposal.id] = proposal.setTiming;
  }
}
const packs = manifest.packs.filter((pack: any) => assets.some(asset => asset.pack === pack.id));
const catalog = { assets, files, packs, sourceHashes, timingUpdates, offlinePassed: true, visualAccepted: false, promotable: false,
  notes: 'Existing public entries and pack provenance are retained. Only candidate bytes/hash and measured gait fields change. Rhino timingUpdates require separate root integration after actual target-contact review.' };
await writeFile(path.join(directory, 'catalog.json'), JSON.stringify(catalog, null, 2));
console.log(JSON.stringify({ assets: assets.map(asset => asset.id), packs: packs.map((pack: any) => pack.id), output: path.join(directory, 'catalog.json') }));
