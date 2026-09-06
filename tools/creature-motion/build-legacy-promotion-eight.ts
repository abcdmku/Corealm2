/** Freeze the remaining eight exact candidates and their acceptance evidence. No public writes. */
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = process.cwd(), directory = path.join(root, 'art/rebuild/candidates/finish-motion');
const ids = ['animal_coyote', 'animal_ibex', 'animal_cattle', 'animal_deer', 'animal_boar', 'animal_hog', 'animal_rat', 'animal_rabbit'];
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const catalog = JSON.parse(await readFile(path.join(directory, 'legacy-catalog.json'), 'utf8'));
const publicManifest = JSON.parse(await readFile(path.join(root, 'game/public/assets/manifest.json'), 'utf8'));
const rows = [];
for (const id of ids) {
  const asset = catalog.assets.find((row: any) => row.id === id);
  if (!asset) throw new Error(`Missing candidate ${id}`);
  const bytes = await readFile(path.join(directory, asset.candidateFile));
  if (hash(bytes) !== asset.sha256 || bytes.length !== asset.bytes) throw new Error(`Stale candidate ${id}`);
  const current = publicManifest.assets.find((row: any) => row.id === id);
  const currentHash = hash(await readFile(path.join(root, 'game/public/assets', current.file)));
  if (currentHash !== current.sha256.toLowerCase() || ![catalog.sourceHashes[id], asset.sha256].includes(currentHash)) throw new Error(`Changed public base ${id}`);
  for (const field of ['impliedWalkMps', 'impliedRunMps', 'walkClipSeconds', 'runClipSeconds', 'pack', 'file']) {
    if (JSON.stringify(current[field]) !== JSON.stringify(asset[field])) throw new Error(`Changed ${id}.${field}`);
  }
  const name = id.replace('animal_', '');
  const isolated = ['coyote', 'ibex', 'boar', 'rabbit'].includes(name);
  const session = isolated ? `legacy-visual-${name}` : ['cattle', 'deer'].includes(name) ? 'legacy-final-hooves' : 'legacy-final-small';
  const reportFile = `test-results/${session}/report.json`;
  const reportBytes = await readFile(path.join(root, reportFile));
  const report = JSON.parse(reportBytes.toString());
  const evidence = report.assets.find((row: any) => row.id === id);
  if (!report.hardware?.noSwiftShader || !Object.values(evidence.summary.checks).every(Boolean)) throw new Error(`Incomplete hardware/state evidence ${id}`);
  const stages = isolated ? ['walk', 'run', ...(['boar', 'rabbit'].includes(name) ? ['turn'] : [])] : ['patrol', 'pursuit', 'turn'];
  const images = stages.map(stage => `test-results/${session}/${id}-${stage}.png`);
  for (const image of images) await access(path.join(root, image));
  let extractedTurnEvidence = null;
  if (['coyote', 'ibex'].includes(name)) {
    const turnReport = `test-results/legacy-turn-video/${name}/report.json`;
    try {
      const turnBytes = await readFile(path.join(root, turnReport));
      const acceptedReportSha = name === 'coyote'
        ? '870349d844fbf590f7b4529e30fa27668c38ef9346de86f9943bf9a9201d8e0d'
        : 'f81f2fd64d00e284ce0d32a962bc41fa82bd1289a598e9b6a6f860bd6de12f31';
      if (hash(turnBytes) !== acceptedReportSha) throw new Error(`Root-reviewed turn report changed for ${id}`);
      extractedTurnEvidence = { report: turnReport, reportSha256: hash(turnBytes),
        contactSheet: `test-results/legacy-turn-video/${name}/contact-sheet.png`,
        fullFrame: `test-results/legacy-turn-video/${name}/frame-06.png`,
        inspected: true,
        rootAccepted: true,
        acceptance: 'Root inspected both exact video-derived contact sheets and accepted readable natural orientation transitions with intact bodies, combined with earlier actual moving state and unobscured Walk/Run stills. Historical frameChecks.turn=false remains unchanged.',
        limitation: 'Natural turning silhouette includes Attack/Idle transition. This is not continuous moving-gait contact proof. See timing uncertainty in extraction report.' };
    } catch (error) { throw new Error(`Required root-reviewed turn evidence is unavailable for ${id}`, { cause: error }); }
  }
  rows.push({ id, candidateFile: asset.candidateFile, candidateSha256: asset.sha256, bytes: asset.bytes,
    sourceSha256: catalog.sourceHashes[id], currentPublicSha256: currentHash,
    stateReport: reportFile, stateReportSha256: hash(reportBytes), hardware: report.hardware,
    sessionElapsedMs: report.elapsedMs, stateChecks: evidence.summary,
    images, extractedTurnEvidence, visualInspected: true, rootVisualAccepted: true,
    remaining: [],
    notes: ['hog', 'rat'].includes(name) ? 'Source has Walk only. Semantic run uses fallback, not a separate authored Run.' : isolated ? 'Walk/Run screenshots verify advancing exact clip and translation across screenshot.' : 'Live end-of-stage screenshots support shape review; actual locomotion coverage comes from sampled trace.',
  });
}
const assets = catalog.assets.filter((row: any) => ids.includes(row.id));
const output = { ...catalog, assets, files: Object.fromEntries(ids.map(id => [id, catalog.files[id]])),
  sourceHashes: Object.fromEntries(ids.map(id => [id, catalog.sourceHashes[id]])),
  packs: catalog.packs.filter((pack: any) => assets.some((asset: any) => asset.pack === pack.id)),
  skipped: [], visualAccepted: false, promotable: false };
const catalogPath = path.join(directory, 'legacy-eight-catalog.json');
const serialized = JSON.stringify(output, null, 2);
await writeFile(catalogPath, serialized);
const promotion = { catalog: 'art/rebuild/candidates/finish-motion/legacy-eight-catalog.json', catalogSha256: hash(Buffer.from(serialized)),
  status: 'root-accepted-awaiting-root-public-promotion', rootAccepted: true, publicWrites: false,
  historicalByteBinding: {
    method: 'motion worker attestation of unchanged frozen candidates during the listed browser sessions',
    frozenCatalogSha256: '27af1bc843c941376fa37278ac2e97df0917281af6f91127dcdda2b12f5d2f5c',
    rootAcceptedAttestation: true,
    limitation: 'Those browser reports record served URLs, not served-byte digests. Current matching hashes do not independently establish historical served-byte identity. Root must accept the run-time freeze attestation or obtain fresh digest-bound evidence.'
  }, models: rows };
await writeFile(path.join(directory, 'legacy-eight-promotion.json'), JSON.stringify(promotion, null, 2));
console.log(JSON.stringify({ catalog: promotion.catalog, sha256: promotion.catalogSha256, models: rows.map(row => ({ id: row.id, sha256: row.candidateSha256, remaining: row.remaining })) }));
