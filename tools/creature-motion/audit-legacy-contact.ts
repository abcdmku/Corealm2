/** Read-only signed contact audit. No velocity-direction filtering or per-foot median calibration. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { Vector3 } from 'three';
import { createSkinReader } from '../lib/ground-gait.js';
import { applyClip, duration, restorePose, storedPose } from './pose.js';

const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
const requested = process.argv.slice(2);
const ids = requested.length ? requested : ['animal_coyote', 'animal_goat', 'animal_cattle', 'animal_aurochs', 'animal_ibex', 'animal_deer', 'animal_bear', 'animal_boar'];
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const out = 'test-results/legacy-signed-contact'; await mkdir(out, { recursive: true });
const summarize = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, median: sorted[Math.floor(sorted.length / 2)] ?? null, p95: sorted[Math.floor(sorted.length * .95)] ?? null, max: sorted.at(-1) ?? null };
};
const reports = [];
for (const id of ids) {
  const asset = manifest.assets.find((asset: any) => asset.id === id);
  if (!asset) throw new Error(`Unknown ${id}`);
  const source = await readFile(`game/public/assets/${asset.file}`), doc = await io.readBinary(source), rest = storedPose(doc);
  const mesh = doc.getRoot().listNodes().filter(node => node.getMesh() && node.getSkin()).sort((a, b) => b.getMesh()!.listPrimitives()[0]!.getAttribute('POSITION')!.getCount() - a.getMesh()!.listPrimitives()[0]!.getAttribute('POSITION')!.getCount())[0]!;
  const skin = createSkinReader(doc, mesh.getName()), floorY = asset.groundY ?? asset.base.y;
  const ankles = doc.getRoot().listNodes().filter(node => /_[lr]_(FrontLeg|HindLeg)_Ankle/.test(node.getName()));
  if (ankles.length !== 4) throw new Error(`${id} requires separately reviewed sole groups (${ankles.length} ankles)`);
  const feet = ankles.map(node => {
    const all = skin.indicesForBranches([node.getName()], Infinity), restFloor = Math.min(...all.map(index => skin.restPoints[index]!.y));
    const indices = all.filter(index => skin.restPoints[index]!.y <= restFloor + .005);
    if (!indices.length) throw new Error(`${id} empty physical sole ${node.getName()}`);
    return { name: node.getName(), indices, restFloor };
  });
  const clips = [];
  for (const name of ['Walk', 'Run']) {
    const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === name);
    if (!clip) continue;
    const nativeMps = name === 'Walk' ? asset.impliedWalkMps : asset.impliedRunMps;
    if (!Number.isFinite(nativeMps)) throw new Error(`${id} missing measured ${name} speed`);
    const intervals = 1920, seconds = duration(clip), dt = seconds / intervals;
    const rows = feet.map(foot => ({ ...foot, minY: Infinity, maxPenetrationM: 0, penetrationSamples: 0, physicalContactSlip: [] as number[], previous: [] as Vector3[], worst: { speed: 0, phase: 0, vertex: -1 } }));
    let simultaneousDisagreementMps = 0, simultaneousContactPhases = 0;
    for (let i = 0; i <= intervals; i++) {
      restorePose(rest); applyClip(clip, seconds * i / intervals);
      const grounded: { foot: number; velocity: Vector3 }[] = [];
      rows.forEach((row, footIndex) => {
        const actual = skin.points(row.indices);
        actual.forEach((point, index) => {
          row.minY = Math.min(row.minY, point.y); row.maxPenetrationM = Math.max(row.maxPenetrationM, floorY - point.y);
          if (point.y < floorY - .002) row.penetrationSamples++;
          const previous = row.previous[index];
          if (!previous || Math.max(Math.abs(point.y - floorY), Math.abs(previous.y - floorY)) > .002) return;
          const velocity = point.clone().sub(previous).multiplyScalar(1 / dt).add(new Vector3(0, 0, nativeMps));
          row.physicalContactSlip.push(velocity.length()); grounded.push({ foot: footIndex, velocity });
          if (velocity.length() > row.worst.speed) row.worst = { speed: velocity.length(), phase: (i - .5) / intervals, vertex: row.indices[index]! };
        });
        row.previous = actual;
      });
      if (new Set(grounded.map(row => row.foot)).size > 1) simultaneousContactPhases++;
      for (const a of grounded) for (const b of grounded) if (a.foot !== b.foot) simultaneousDisagreementMps = Math.max(simultaneousDisagreementMps, a.velocity.distanceTo(b.velocity));
    }
    clips.push({ name, seconds, intervals, nativeMps, simultaneousContactPhases, simultaneousDisagreementMps,
      feet: rows.map(({ previous, physicalContactSlip, ...row }) => ({ ...row, physicalContactSlipMps: summarize(physicalContactSlip) })) });
  }
  const report = { id, sourceSha256: createHash('sha256').update(source).digest('hex'), floorY, mesh: mesh.getName(), clips,
    method: 'Actual weighted original sole vertices selected from ankle descendants within5mm of each rest sole minimum. Signed 3D velocity includes shipped native +Z root travel. Contact retains every individual vertex within2mm of common shipped groundY, regardless of direction/vertical speed. Simultaneous comparisons require different feet in the same sampled interval. Penetration is counted independently and is never discarded as contact absence.',
    units: 'Asset-native metres and metres/second. Runtime drawn scale multiplies spatial error. Physical contact mask remains an approximation; release/approach may cross its2mm band.', visualAccepted: false };
  reports.push(report); await writeFile(`${out}/${id}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ id, clips: clips.map(clip => ({ name: clip.name, penetrationM: Math.max(...clip.feet.map(foot => foot.maxPenetrationM)), disagreementMps: clip.simultaneousDisagreementMps, simultaneousContactPhases: clip.simultaneousContactPhases })) }));
}
await writeFile(`${out}/report.json`, JSON.stringify(reports, null, 2));
