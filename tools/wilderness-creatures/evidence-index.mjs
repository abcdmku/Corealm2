import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// A disposable index of exact-byte evidence. This does not accept or promote any asset.
const directory = 'test-results/wilderness-creatures';
const catalog = JSON.parse(await readFile(`${directory}/catalog.json`, 'utf8'));
const proofs = {
  cinderback_crag: ['lab-shallow_a'], rift_carapace: ['lab-deep_a'],
  furnace_grazer: ['lab-final_grazer_gloam', 'lab-final_shallow'],
  basalt_maw: ['lab-final_shallow'], voidstone_colossus: ['lab-final_voidstone'],
  gloam_wraith: ['lab-final_grazer_gloam', 'lab-final_gloam'],
  ashseal_warden: ['lab-final_keeper_shallow'], furnace_regent: ['lab-final_keeper_shallow'],
  chainbound_archon: ['lab-final_chainbound'],
  nightforge_marshal: ['lab-final_keeper_deep'], hollow_star: ['lab-final_keeper_deep'],
};
const visualPass = new Set(Object.keys(proofs));
const visualHold = {};
// Material retakes use unchanged geometry/motion from these earlier runs. Their old
// images are not current-material evidence; Hollow's old Hit failure is superseded.
const retainedCycles = {
  ashseal_warden: ['lab-shallow_keepers_a', 'keepers/material-core-audit.json'],
  furnace_regent: ['lab-shallow_keepers_b', 'keepers/material-core-audit.json'],
  nightforge_marshal: ['lab-deep_keepers_b', 'keepers/material-core-audit.json'],
  hollow_star: ['lab-deep_keepers_c', 'keepers/material-core-audit.json'],
  gloam_wraith: ['lab-final_gloam', 'ordinary/material-audit.json'],
};
function clipCycles(actor, name) {
  const motion = actor.motions.find(row => row.motion === name);
  if (!motion) return null;
  if (typeof motion.clipCycles === 'number') return motion.clipCycles;
  const states = [motion.initialMotion, ...motion.samples.map(sample => sample.motion)];
  if (!states[0]?.duration || states.some(state => state.clip?.toLowerCase() !== name)) return null;
  return states.slice(1).reduce((elapsed, state, index) => {
    const delta = state.time - states[index].time;
    return elapsed + (delta < 0 ? delta + state.duration : delta);
  }, 0) / states[0].duration;
}
const rows = [];
for (const asset of catalog.assets) {
  const id = asset.id.replace(/^creature_/, '');
  const bytes = await readFile(`${directory}/${catalog.files[asset.id]}`);
  let browser = null;
  for (const job of proofs[id]) {
    const reportPath = `${directory}/${job}/report.json`;
    let report;
    try { report = JSON.parse(await readFile(reportPath, 'utf8')); } catch { continue; }
    const actor = report.evidence?.find(row => row.id === id && row.sha256 === asset.sha256);
    if (!actor) continue;
    const screenshots = [];
    for (const view of ['idle-2', 'orbit', 'run-2', 'run-5', 'attack-2', 'attack-5', 'hit-2']) {
      const file = `${directory}/${job}/${id}-${view}.png`;
      try { await access(file); screenshots.push(file); } catch {}
    }
    const required = (actor.mode ?? report.mode) === 'material-key-poses'
      ? ['idle', 'run', 'attack', 'hit'] : ['idle', 'walk', 'run', 'attack', 'hit'];
    browser = { reportPath, mode: actor.mode ?? report.mode ?? 'full-cycles', reportPassed: report.passed,
      actorComplete: required.every(name => actor.motions?.some(motion => motion.motion === name && motion.samples?.length === 7))
        && !!actor.effectsMovement && !!actor.profile && !!actor.afterCamera,
      elapsedMs: report.elapsedMs, pageErrors: report.pageErrors, consoleErrors: report.consoleErrors, screenshots,
      note: report.passed ? null : `This actor finished before the job failed on ${report.failure?.id}; root must judge its complete actor-specific evidence.` };
    break;
  }
  let retainedGeometryMotion = null;
  if (retainedCycles[id]) {
    const [job, audit] = retainedCycles[id];
    const reportPath = `${directory}/${job}/report.json`;
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    const actor = report.evidence.find(row => row.id === id);
    retainedGeometryMotion = { reportPath, priorAssetSha256: actor.sha256,
      materialEquivalenceAudit: `${directory}/${audit}`,
      walkCycles: clipCycles(actor, 'walk'), runCycles: clipCycles(actor, 'run'),
      scope: 'Unchanged geometry and complete Walk/Run/Attack cycles only. Materials and Hit use the current-byte retake.',
      note: id === 'hollow_star' ? 'The earlier report failed at Hit before the production topology mask was added; the current retake proves the repaired Hit.' : null };
  }
  rows.push({ id, assetId: asset.id, sha256: asset.sha256,
    fileMatchesCatalog: bytes.length === asset.bytes && createHash('sha256').update(bytes).digest('hex') === asset.sha256,
    browser, retainedGeometryMotion,
    visualReview: visualPass.has(id) ? 'fresh-critic-pass' : visualHold[id] ? 'hold' : 'pending',
    visualNote: visualHold[id] ?? null });
}
await writeFile(`${directory}/acceptance-index.json`, JSON.stringify({ generatedAt: new Date().toISOString(),
  acceptanceOwner: 'root', promotedByThisTool: false,
  scope: 'Stationary production gallery animation cycles, material views, camera controls and effect movement/culling. Moving world foot planting, combat timing and world placement remain separate root gates.',
  rows }, null, 2) + '\n');
console.log(`Indexed ${rows.length} staged bodies; ${rows.filter(row => row.browser?.actorComplete && row.visualReview === 'fresh-critic-pass').length} have current-byte completed actor evidence and a fresh visual pass.`);
