/** CPU gait evidence only. Root acceptance still requires production lab motion. */
import * as THREE from 'three';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildBestiary, BESTIARY_IDS } from './build.mjs';

const quantile = (a, q) => a.length ? a[Math.round((a.length - 1) * q)] : null;
const rounded = n => n === null ? null : Math.round(n * 100000) / 100000;
const stats = values => {
  const a = [...values].sort((x, y) => x - y);
  return Object.fromEntries([['min', 0], ['p10', .1], ['median', .5], ['p90', .9], ['max', 1]].map(([k, q]) => [k, rounded(quantile(a, q))]));
};

function contactsFor(object) {
  // Toe joints are closer to the contact patch than ankle pivots. Harpy authored
  // claws follow foot_*; the separate ankle audit exposes that approximation.
  for (const [sole, ankle] of [
    [['ball_l', 'ball_r'], ['foot_l', 'foot_r']],
    [['Bip001_L_Toe0', 'Bip001_R_Toe0'], ['Bip001_L_Foot', 'Bip001_R_Foot']],
    [['toes_01l', 'toes_01r'], ['footl', 'footr']],
  ]) if (sole.every(name => object.getObjectByName(name)?.isBone)) return { sole, ankle };
  throw new Error('No recognized paired contact joints; inspect rig before adding a mapping.');
}

export function measureClip(object, clip, names, count = 480) {
  const mixer = new THREE.AnimationMixer(object), action = mixer.clipAction(clip);
  action.play();
  const points = names.map(() => []), bones = names.map(n => object.getObjectByName(n));
  for (let i = 0; i < count; i++) {
    mixer.setTime(clip.duration * i / count); object.updateMatrixWorld(true);
    bones.forEach((bone, j) => points[j].push(bone.getWorldPosition(new THREE.Vector3())));
  }
  mixer.stopAllAction(); mixer.uncacheRoot(object);
  const pooled = [];
  const contacts = points.map((p, j) => {
    const low = Math.min(...p.map(v => v.y)), high = Math.max(...p.map(v => v.y));
    const window = Math.max(.008, Math.min(.04, (high - low) * .12));
    const speeds = [], mask = [], dt = clip.duration / count;
    // Adjacent samples, excluding the closing seam, avoid interpreting a root
    // discontinuity as travel. Height is measured independently for each foot.
    for (let i = 1; i < count; i++) {
      const speed = (p[i - 1].z - p[i].z) / dt;
      const grounded = (p[i - 1].y + p[i].y) / 2 <= low + window && speed > .05;
      mask.push(grounded);
      if (grounded) speeds.push(speed);
    }
    let longest = 0, run = 0;
    for (const hit of [...mask, ...mask]) { run = hit ? run + 1 : 0; longest = Math.min(mask.length, Math.max(longest, run)); }
    pooled.push(...speeds);
    return { bone: names[j], samples: speeds.length, stanceFraction: rounded(speeds.length / (count - 1)), longestStanceSeconds: rounded(longest * dt), heightMinM: rounded(low), heightMaxM: rounded(high), heightWindowM: rounded(window), speedMps: stats(speeds) };
  });
  const speedMps = stats(pooled), medians = contacts.map(c => c.speedMps.median).filter(x => x !== null);
  const bilateralDifferenceFraction = medians.length === 2 ? Math.abs(medians[0] - medians[1]) / Math.max(...medians) : 1;
  const spreadFraction = speedMps.median ? (speedMps.p90 - speedMps.p10) / speedMps.median : Infinity;
  const adequateContact = contacts.every(c => c.stanceFraction >= .08 && c.longestStanceSeconds >= clip.duration * .05);
  const credible = adequateContact && bilateralDifferenceFraction < .25 && spreadFraction < .65;
  return { cycleSeconds: rounded(clip.duration), impliedMps: speedMps.median, confidence: credible ? 'credible-joint-estimate' : 'needs-visual-review', bilateralDifferenceFraction: rounded(bilateralDifferenceFraction), p10ToP90SpreadFraction: rounded(spreadFraction), speedMps, contacts };
}

export async function deriveGaits(ids = BESTIARY_IDS) {
  const results = [];
  for (const id of ids) {
    if (['wraith', 'banshee', 'revenant'].includes(id)) {
      results.push({ id, status: 'exempt-hover', impliedWalkMps: null, impliedRunMps: null, reason: 'Floating robe has no authored planted feet; hidden leg motion cannot establish travel speed.' });
      continue;
    }
    const { object, clips, meta } = buildBestiary(id), mapping = contactsFor(object);
    const measurements = {};
    for (const name of ['Walk', 'Run']) {
      const clip = clips.find(c => c.name === name);
      if (!clip) throw new Error(`${id}: missing ${name}`);
      const sole = measureClip(object, clip, mapping.sole), ankle = measureClip(object, clip, mapping.ankle);
      measurements[name.toLowerCase()] = { ...sole, ankleCrossCheckMps: ankle.impliedMps, ankleConfidence: ankle.confidence };
    }
    const row = { id, rig: meta.rig, status: Object.values(measurements).every(m => m.confidence === 'credible-joint-estimate') ? 'credible-joint-estimate' : 'needs-visual-review', impliedWalkMps: measurements.walk.impliedMps, impliedRunMps: measurements.run.impliedMps, ...measurements };
    if (id.includes('harpy')) { row.status = 'needs-visual-review'; row.caveat = 'Authored claw geometry follows ankle, not ball joint. Compare ankle estimate and inspect claw contact before adopting.'; }
    if (id.startsWith('skeleton')) row.caveat = 'Run is retimed Walk; this measures the resulting clip without claiming an authored run.';
    results.push(row);
    console.log(`${id}: walk ${row.impliedWalkMps}, run ${row.impliedRunMps}, ${row.status}`);
  }
  return { version: 1, units: 'metres and seconds', forwardAxis: '+Z', method: '480 uniform phase samples of final buildBestiary Walk/Run. Median negative-Z velocity at named toe joints within lowest 12% of their vertical range, clamped to an 8-40 mm height window. Require backward velocity >0.05 m/s. Exclude closing seam. Report bilateral agreement, speed distribution, contiguous stance length, and ankle cross-check. Estimates use actual transformed joint paths after proportions and floor correction, never copied source metadata.', limitations: 'Joint contact is a proxy for weighted sole geometry. Confidence labels are CPU evidence only. Production lab playback must confirm visible foot contact, speed, and cycle cadence before acceptance. No public catalogue mutation.', results };
}

/** Contact patches use referenced vertices with >= 50% weight on the foot/toes.
 * Different patch vertices may touch in consecutive frames, so velocity always
 * tracks the SAME vertex across adjacent poses before taking the patch median.
 */
export function measureGeometryContact(object, clip, count = 480) {
  object.updateMatrixWorld(true);
  const patches = ['l', 'r'].map(side => {
    const candidates = [];
    object.traverse(mesh => {
      if (!mesh.isSkinnedMesh || !mesh.visible) return;
      const p = mesh.geometry.attributes.position, si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
      const bones = new Set(mesh.skeleton.bones.flatMap((b, i) => [`foot_${side}`, `ball_${side}`, `ball_leaf_${side}`].includes(b.name) ? [i] : []));
      const used = mesh.geometry.index ? new Set(mesh.geometry.index.array) : Array.from({ length: p.count }, (_, i) => i);
      for (const index of used) {
        let weight = 0;
        for (let k = 0; k < 4; k++) if (bones.has(si.getComponent(index, k))) weight += sw.getComponent(index, k);
        if (weight >= .5) candidates.push({ mesh, index });
      }
    });
    if (!candidates.length) throw Error(`No ${side} foot-weighted geometry`);
    return { side, candidates, poses: [] };
  });
  const mixer = new THREE.AnimationMixer(object), action = mixer.clipAction(clip); action.play();
  const tmp = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    mixer.setTime(clip.duration * i / count); object.updateMatrixWorld(true);
    for (const patch of patches) {
      const values = new Float32Array(patch.candidates.length * 2);
      patch.candidates.forEach(({ mesh, index }, j) => {
        mesh.getVertexPosition(index, tmp).applyMatrix4(mesh.matrixWorld);
        values[j * 2] = tmp.y; values[j * 2 + 1] = tmp.z;
      });
      patch.poses.push(values);
    }
  }
  mixer.stopAllAction(); mixer.uncacheRoot(object);
  const pooled = [], contacts = [], dt = clip.duration / count;
  for (const { side, candidates, poses } of patches) {
    const minima = poses.map(p => { let min = Infinity; for (let j = 0; j < p.length; j += 2) min = Math.min(min, p[j]); return min; });
    const speeds = [], intervals = [], mask = [], contactVertexCounts = [], frameSpeeds = [];
    // 20 mm above the actor's y=0 floor allows interpolation/floor corrections.
    // The 8 mm patch thickness selects soles/claw tips rather than whole feet.
    for (let i = 1; i < count - 1; i++) {
      const touching = minima[i] <= .02, velocities = [];
      if (touching) for (let j = 0; j < candidates.length; j++) {
        if (poses[i][j * 2] > minima[i] + .008) continue;
        velocities.push((poses[i - 1][j * 2 + 1] - poses[i + 1][j * 2 + 1]) / (2 * dt));
      }
      const velocity = stats(velocities).median, grounded = touching && velocity !== null && velocity > .05;
      mask.push(grounded);
      frameSpeeds.push(grounded ? velocity : null);
      if (grounded) { speeds.push(velocity); contactVertexCounts.push(velocities.length); }
    }
    let start = null;
    for (let i = 0; i <= mask.length; i++) {
      if (mask[i] && start === null) start = i;
      if (!mask[i] && start !== null) { intervals.push({ startPhase: rounded((start + 1) / count), endPhase: rounded((i + 1) / count), seconds: rounded((i - start) * dt) }); start = null; }
    }
    // Measure the center 70% of the longest contiguous contact, excluding heel
    // strike and toe-off. Join contacts crossing phase zero before trimming.
    const runs = []; let current = [];
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) current.push(i);
      else if (current.length) { runs.push(current); current = []; }
    }
    if (current.length) runs.push(current);
    if (runs.length > 1 && mask[0] && mask.at(-1)) runs[0] = [...runs.pop(), ...runs[0]];
    runs.sort((a, b) => b.length - a.length);
    const main = runs[0] ?? [], trim = Math.floor(main.length * .15), core = main.slice(trim, main.length - trim).map(i => frameSpeeds[i]);
    pooled.push(...core);
    contacts.push({ side, candidateVertices: candidates.length, meshNames: [...new Set(candidates.map(c => c.mesh.name))], samples: speeds.length, stanceFraction: rounded(speeds.length / (count - 2)), intervals, soleHeightM: stats(minima), speedMps: stats(speeds), coreSpeedMps: stats(core), mainStanceSeconds: rounded(main.length * dt), coreStanceSeconds: rounded(core.length * dt), contactVertexCounts: stats(contactVertexCounts) });
  }
  const speedMps = stats(pooled), medians = contacts.map(c => c.coreSpeedMps.median), bilateral = medians.every(n => n > 0) ? Math.abs(medians[0] - medians[1]) / Math.max(...medians) : 1;
  const spread = speedMps.median ? (speedMps.p90 - speedMps.p10) / speedMps.median : Infinity;
  const credible = bilateral < .25 && spread < .65 && contacts.every(c => c.stanceFraction >= .08 && c.intervals.some(i => i.seconds >= clip.duration * .05));
  return { cycleSeconds: rounded(clip.duration), impliedMps: speedMps.median, confidence: credible ? 'credible-geometry-estimate' : 'needs-visual-review', bilateralDifferenceFraction: rounded(bilateral), p10ToP90SpreadFraction: rounded(spread), speedMps, contacts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const geometry = process.argv.includes('--geometry');
  const report = geometry ? JSON.parse(await readFile(new URL('./gait-results.json', import.meta.url), 'utf8')) : await deriveGaits(process.argv.slice(2).filter(v => !v.startsWith('--')) .length ? process.argv.slice(2).filter(v => !v.startsWith('--')) : BESTIARY_IDS);
  if (geometry) {
    report.geometryMethod = '480 poses of actual referenced vertices with >=50% foot/toe weights. Grounded sole must be <=20 mm above floor. Contact patch comprises vertices within 8 mm of each foot minimum. Track identical vertex through adjacent poses for central-difference negative-Z speed, then median per-frame patch speeds to avoid tessellation weighting. Main estimate uses center 70% of longest contiguous grounded backward interval per foot, joining intervals across phase zero, to exclude heel-strike/toe-off roll. Full interval distributions retained. No seam derivatives. Bilateral and stance thresholds match joint audit. CPU evidence only.';
    for (const row of report.results.filter(r => ['zombie', 'plague_zombie', 'harpy', 'cliff_harpy', 'storm_harpy'].includes(r.id))) {
      const { object, clips } = buildBestiary(row.id);
      row.geometryContact = Object.fromEntries(['Walk', 'Run'].map(name => [name.toLowerCase(), measureGeometryContact(object, clips.find(c => c.name === name))]));
      row.status = Object.values(row.geometryContact).every(r => r.confidence === 'credible-geometry-estimate') ? 'credible-geometry-estimate' : 'needs-visual-review';
      row.jointProxySpeeds ??= { impliedWalkMps: row.walk.impliedMps, impliedRunMps: row.run.impliedMps };
      row.impliedWalkMps = row.geometryContact.walk.impliedMps; row.impliedRunMps = row.geometryContact.run.impliedMps;
      row.caveat = 'Speed fields now derive from actual weighted contact geometry. Joint audit retained for comparison. Production contact playback still required.';
      console.log(row.id, row.status, row.impliedWalkMps, row.impliedRunMps);
    }
  }
  await writeFile(new URL('./gait-results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
}
