/** Build an installAssetCandidates-compatible catalog from passed mammal repairs. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const directory = path.resolve('art/rebuild/candidates/finish-motion');
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
const assets: any[] = [], files: Record<string, string> = {}, sourceHashes: Record<string, string> = {}, skipped: { id: string; reason: string }[] = [];
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
for (const folder of ['legacy-canines', 'legacy-bovines', 'legacy-caprines', 'legacy-cervines', 'legacy-suids', 'legacy-small-mammals']) {
  let proposals;
  try { proposals = JSON.parse(await readFile(path.join(directory, folder, 'manifest-updates.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { skipped.push({ id: folder, reason: 'staging manifest not yet available' }); continue; } throw error; }
  for (const proposal of proposals) {
    if (proposal.offlinePassed !== true) { skipped.push({ id: proposal.id, reason: 'offlinePassed is not true' }); continue; }
    if (assets.some(asset => asset.id === proposal.id)) throw new Error(`Duplicate ${proposal.id}`);
    const original = manifest.assets.find((asset: any) => asset.id === proposal.id);
    if (!original) throw new Error(`Missing public asset ${proposal.id}`);
    const candidateFile = `${folder}/${proposal.id}.glb`, bytes = await readFile(path.join(directory, candidateFile)), sha256 = sha(bytes);
    if (sha256 !== proposal.sha256?.toLowerCase() || bytes.length !== proposal.bytes) throw new Error(`Stale staged candidate ${proposal.id}`);
    if (folder === 'legacy-small-mammals' || folder === 'legacy-suids') {
      let coverage;
      try { coverage = JSON.parse(await readFile(path.join(directory, folder, `${proposal.id}-coverage.json`), 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { skipped.push({ id: proposal.id, reason: 'Whole-mesh contact coverage pending' }); continue; } throw error; }
      const clips = original.animations.filter((name: string) => name === 'Walk' || name === 'Run');
      if (coverage.passed !== true || coverage.candidateSha256 !== sha256 || coverage.sourceSha256 !== proposal.sourceSha256 || clips.some((name: string) => !coverage.results?.some((row: any) => row.name === name && row.passed === true && row.candidateSha256 === sha256 && row.samplesPerCycle >= 7680 && row.cycles >= 2))) { skipped.push({ id: proposal.id, reason: 'Whole-mesh contact coverage failed or stale' }); continue; }
    }
    const publicBytes = await readFile(path.resolve('game/public/assets', original.file)), publicHash = sha(publicBytes);
    if (publicHash !== original.sha256.toLowerCase() || (publicHash !== proposal.sourceSha256.toLowerCase() && publicHash !== sha256)) throw new Error(`Changed public base ${proposal.id}`);
    for (const field of ['impliedWalkMps', 'impliedRunMps', 'walkClipSeconds', 'runClipSeconds']) {
      if (proposal.set?.[field] !== undefined && proposal.set[field] !== original[field]) throw new Error(`Legacy repair changed ${proposal.id}.${field}`);
    }
    // Candidate metadata changes only its bytes and hash. Public identity and pack provenance remain exact.
    assets.push({ ...original, sha256, bytes: bytes.length, candidateFile });
    files[proposal.id] = candidateFile; sourceHashes[proposal.id] = proposal.sourceSha256.toLowerCase();
  }
}
if (!assets.length) throw new Error('No offline-passed legacy candidates');
const catalog = { assets, files, packs: manifest.packs.filter((pack: any) => assets.some(asset => asset.pack === pack.id)), sourceHashes,
  offlinePassed: true, visualAccepted: false, promotable: false, skipped,
  notes: 'Only offline-passed candidates with matching actual hashes. Public bytes must match the recorded source or this exact promoted candidate. Production identity, speeds, durations and pack provenance are unchanged.' };
const output = path.join(directory, 'legacy-catalog.json');
await writeFile(output, JSON.stringify(catalog, null, 2));
console.log(JSON.stringify({ output, assets: assets.map(asset => asset.id), skipped }));
