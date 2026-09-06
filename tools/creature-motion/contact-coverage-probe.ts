/** Read-only full-cycle coverage gate for all original mesh vertices.
 * npx tsx tools/creature-motion/contact-coverage-probe.ts REPORT.json MESH_NAME --samples 7680 --clearance 0.0005
 * Supplements the foot-specific serialized audit without changing its provenance.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { createSkinReader } from '../lib/ground-gait.js';
import { applyClip, duration, restorePose, storedPose } from './pose.js';

const [reportFile, meshName, ...options] = process.argv.slice(2);
let clearance = .0005, samples = 7680;
for (let i = 0; i < options.length; i += 2) {
  if (options[i] === '--samples') samples = Number(options[i + 1]);
  else if (options[i] === '--clearance') clearance = Number(options[i + 1]);
  else throw new Error(`Unknown option ${options[i]}`);
}
if (!reportFile || !meshName || !Number.isFinite(clearance) || clearance < 0 || !Number.isInteger(samples) || samples < 8) {
  throw new Error('Expected REPORT.json MESH_NAME [--samples 7680] [--clearance 0.0005]');
}
const report = JSON.parse(await readFile(reportFile, 'utf8'));
const bytes = await readFile(report.stagedFile), source = await readFile(report.sourceFile);
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const candidateSha256 = sha(bytes), sourceSha256 = sha(source);
if (candidateSha256 !== report.sha256 || sourceSha256 !== report.sourceSha256) throw new Error('Candidate or source digest differs from report');
const doc = await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).readBinary(bytes);
const rest = storedPose(doc), skin = createSkinReader(doc, meshName);
const all = Array.from({ length: skin.count }, (_, i) => i);
let failed = false;
const results = [];
try {
  for (const audit of report.audit ?? report.audits) {
    const clip = doc.getRoot().listAnimations().find(c => c.getName() === audit.name);
    if (!clip || !Number.isFinite(audit.floorY) || !(audit.nativeMps > 0)) throw new Error('Invalid audit entry');
    const seconds = duration(clip), dt = seconds / samples;
    const declared = new Set<number>(audit.feet.flatMap((foot: { vertices: number[] }) => foot.vertices));
    let maximumMps = 0, count = 0, nonFiniteVertices = 0, minimumY = Infinity;
    let before: ReturnType<typeof skin.points> | null = null;
    let worst: { vertex: number; phase: number; clearanceM: number; declared: boolean } | null = null;
    for (let i = 0; i <= samples * 2; i++) {
      const localPhase = i > 0 && i % samples === 0 ? 1 : (i % samples) / samples;
      restorePose(rest); applyClip(clip, seconds * localPhase); const after = skin.points(all);
      after.forEach((point, vertex) => {
        if (![point.x, point.y, point.z].every(Number.isFinite)) nonFiniteVertices++;
        minimumY = Math.min(minimumY, point.y);
        if (!before) return;
        const previous = before[vertex]!;
        if (Math.max(point.y, previous.y) > audit.floorY + clearance + .000001) return;
        count++;
        const velocity = point.clone().sub(previous).multiplyScalar(1 / dt);
        velocity.z += audit.nativeMps;
        const speed = velocity.length();
        if (speed > maximumMps) {
          maximumMps = speed;
          worst = { vertex, phase: ((i - .5) / samples) % 1, clearanceM: point.y - audit.floorY, declared: declared.has(vertex) };
        }
      });
      before = after;
    }
    const maximumPenetrationM = Math.max(0, audit.floorY - minimumY);
    const passed = count > 0 && maximumMps <= .012 && nonFiniteVertices === 0 && maximumPenetrationM <= .001;
    failed ||= !passed;
    const result = { id: report.id, name: audit.name, candidateSha256, sourceSha256, clearanceM: clearance, samplesPerCycle: samples, cycles: 2, velocityIntervalSeconds: dt, maximumMps, count, worst, nonFiniteVertices, maximumPenetrationM, passed };
    results.push(result); console.log(JSON.stringify(result));
  }
} finally { restorePose(rest); }
await writeFile(reportFile.replace(/\.json$/, '-coverage.json'), JSON.stringify({ id: report.id, candidateSha256, sourceSha256, passed: !failed, results }, null, 2));
if (failed) process.exitCode = 1;
