/**
 * Offline frog/crab repair. Public assets are read-only inputs.
 * npx tsx tools/repair-ground-creature-gaits.ts [animal_frog|animal_frog_green|animal_crab]
 *
 * Keeps the entire original BIN prefix and every original non-animation object.
 * Only Walk/Run entries are replaced; new sampler buffers are appended.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeIO, type Document } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { Vector3 } from 'three';
import { applyClip, duration, restorePose, storedPose } from './creature-motion/pose.js';
import { contactAt, createSkinReader, fract, type BakedGait } from './lib/ground-gait.js';

const OUT = resolve('art/rebuild/candidates/finish-motion/ground-creature-gaits');
const IDS = ['animal_frog', 'animal_frog_green', 'animal_crab'] as const;
// Frog Run has 1920 authored intervals; twice that density also checks every key midpoint.
const SAMPLES = 3840;
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const sha = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
type RawGlb = { json: any; bin: Buffer };

export function readRawGlb(bytes: Buffer): RawGlb {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('Expected JSON-first GLB2');
  const jsonLength = bytes.readUInt32LE(12), binHeader = 20 + jsonLength;
  if (bytes.readUInt32LE(binHeader + 4) !== 0x004e4942 || bytes.length !== binHeader + 8 + bytes.readUInt32LE(binHeader)) throw new Error('Expected one embedded BIN chunk');
  return { json: JSON.parse(bytes.subarray(20, binHeader).toString('utf8')), bin: bytes.subarray(binHeader + 8) };
}

function writeRawGlb(json: any, bin: Buffer): Buffer {
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonSize = Math.ceil(jsonBytes.length / 4) * 4, binSize = Math.ceil(bin.length / 4) * 4;
  const result = Buffer.alloc(28 + jsonSize + binSize);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonSize, 12); result.writeUInt32LE(0x4e4f534a, 16);
  result.fill(0x20, 20, 20 + jsonSize); jsonBytes.copy(result, 20);
  result.writeUInt32LE(binSize, 20 + jsonSize); result.writeUInt32LE(0x004e4942, 24 + jsonSize); bin.copy(result, 28 + jsonSize);
  return result;
}

/** The unchanged original accessor and buffer-view indices still reference exact source bytes. */
export function appendGaitAnimations(source: Buffer, gaits: BakedGait[]): Buffer {
  const raw = readRawGlb(source), json = structuredClone(raw.json);
  if (json.buffers.length !== 1 || json.buffers[0].uri) throw new Error('Expected one embedded buffer');
  const chunks: Buffer[] = [raw.bin]; let byteLength = raw.bin.length;
  const addAccessor = (values: number[], width: number, time = false): number => {
    if (values.some(value => !Number.isFinite(value)) || values.length % width) throw new Error('Invalid authored sampler');
    const array = new Float32Array(values), bytes = Buffer.from(array.buffer);
    if (!array.every(Number.isFinite)) throw new Error('Authored sampler overflows Float32');
    if (time && Array.from(array).some((value, i) => i > 0 && value <= array[i - 1]!)) throw new Error('Authored Float32 key times are not strictly increasing');
    const view = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length });
    byteLength += bytes.length; chunks.push(bytes);
    const accessor = json.accessors.length;
    json.accessors.push({ bufferView: view, componentType: 5126, count: values.length / width, type: width === 1 ? 'SCALAR' : width === 4 ? 'VEC4' : 'VEC3', ...(time ? { min: [array[0]], max: [array[array.length - 1]] } : {}) });
    return accessor;
  };
  for (const gait of gaits) {
    const index = json.animations.findIndex((clip: any) => clip.name === gait.name);
    if (index < 0) throw new Error(`Missing source ${gait.name}`);
    const samplers: any[] = [], channels: any[] = [], timeInputs = new Map<number[], number>(), targets = new Set<string>();
    for (const track of gait.tracks) {
      const matching = json.nodes.flatMap((node: any, i: number) => node.name === track.node.getName() ? [i] : []);
      if (matching.length !== 1) throw new Error(`Ambiguous authored node ${track.node.getName()}`);
      const targetKey = `${matching[0]}/${track.path}`;
      if (targets.has(targetKey)) throw new Error(`Duplicate authored target ${targetKey}`); targets.add(targetKey);
      const width = track.path === 'rotation' ? 4 : 3;
      if (track.values.length !== track.times.length * width || track.times[0] !== 0 || Math.abs(track.times.at(-1)! - gait.seconds) > 1e-6) throw new Error(`Incomplete authored track ${targetKey}`);
      if (!timeInputs.has(track.times)) timeInputs.set(track.times, addAccessor(track.times, 1, true));
      const values = [...track.values];
      if (width === 4) for (let k = 4; k < values.length; k += 4) {
        if (values.slice(k, k + 4).reduce((sum, value, j) => sum + value * values[k - 4 + j]!, 0) < 0) for (let j = 0; j < 4; j++) values[k + j] = -values[k + j]!;
      }
      channels.push({ sampler: samplers.length, target: { node: matching[0], path: track.path } });
      samplers.push({ input: timeInputs.get(track.times), output: addAccessor(values, width), interpolation: 'LINEAR' });
    }
    json.animations[index] = { ...json.animations[index], channels, samplers, extras: { ...json.animations[index].extras, groundContactRepair: { version: 1, nativeMps: gait.nativeMps, forwardAxis: '+Z', generatedBy: 'tools/repair-ground-creature-gaits.ts' } } };
  }
  json.buffers[0].byteLength = byteLength;
  const output = writeRawGlb(json, Buffer.concat(chunks));
  assertSourcePreserved(source, output);
  return output;
}

export function assertSourcePreserved(source: Buffer, output: Buffer): void {
  const a = readRawGlb(source), b = readRawGlb(output);
  if (!b.bin.subarray(0, a.bin.length).equals(a.bin)) throw new Error('Original geometry/image/animation BIN bytes changed');
  for (const [key, value] of Object.entries(a.json)) {
    if (key === 'animations') {
      if (b.json.animations.length !== (value as any[]).length) throw new Error('Clip roster changed');
      (value as any[]).forEach((clip, i) => {
        if (b.json.animations[i].name !== clip.name) throw new Error('Clip identity changed');
        if (!['Walk', 'Run'].includes(clip.name) && JSON.stringify(clip) !== JSON.stringify(b.json.animations[i])) throw new Error(`Nonlocomotion ${clip.name} changed`);
      });
    } else if (key === 'accessors' || key === 'bufferViews') {
      if (JSON.stringify(value) !== JSON.stringify(b.json[key].slice(0, (value as any[]).length))) throw new Error(`Original ${key} changed`);
    } else if (key === 'buffers') {
      const stripped = (rows: any[]) => rows.map(({ byteLength: _, ...rest }) => rest);
      if (JSON.stringify(stripped(value as any[])) !== JSON.stringify(stripped(b.json.buffers))) throw new Error('Buffer metadata changed');
    } else if (JSON.stringify(value) !== JSON.stringify(b.json[key])) throw new Error(`Source ${key} changed`);
  }
}

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, min: sorted[0] ?? null, median: median(sorted), p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] ?? null, max: sorted.at(-1) ?? null };
}
const meanPoint = (points: Vector3[]): Vector3 => points.reduce((sum, point) => sum.add(point), new Vector3()).multiplyScalar(1 / points.length);
type WorstSlip = Record<string, { mps: number; cyclePhase: number; vertex: number }>;
function worstSlip(rows: WorstSlip, key: string, mps: number, phase: number, vertex: number): void {
  if (!rows[key] || mps > rows[key]!.mps) rows[key] = { mps, cyclePhase: fract(phase), vertex };
}
function phaseRanges(indices: number[], samples: number): number[][] {
  const rows: number[][] = [];
  for (const index of indices) { const last = rows.at(-1); if (last && last[1] === index - 1) last[1] = index; else rows.push([index - 1, index]); }
  return rows.map(row => row.map(index => index / samples));
}

/** Evaluates the serialized clip, not the authoring targets, over two full cycles. */
export function auditGroundGait(doc: Document, gait: BakedGait, meshName: string, floorY: number, samples = SAMPLES) {
  const pose = storedPose(doc), skin = createSkinReader(doc, meshName);
  const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === gait.name);
  if (!clip || !(gait.seconds > 0) || !Number.isFinite(gait.seconds) || !(gait.nativeMps > 0) || !Number.isFinite(gait.nativeMps) || !Number.isFinite(floorY) || !Number.isInteger(samples) || samples < 8) throw new Error('Invalid ground gait audit inputs');
  if (!gait.feet.length) throw new Error('Ground gait audit requires physical feet');
  for (const foot of gait.feet) {
    if (!foot.vertices.length || !foot.primaryVertices.length || new Set(foot.vertices).size !== foot.vertices.length || new Set(foot.primaryVertices).size !== foot.primaryVertices.length) throw new Error(`Invalid or duplicate physical sole selection ${foot.name}`);
    if (foot.vertices.some(index => !Number.isInteger(index) || index < 0 || index >= skin.count) || foot.primaryVertices.some(index => !foot.vertices.includes(index))) throw new Error(`Physical sole outside mesh ${foot.name}`);
    if (!(foot.duty > 0 && foot.duty <= 1) || !Number.isFinite(foot.phaseOffset) || !(foot.clearance >= 0) || !Number.isFinite(foot.clearance)) throw new Error(`Invalid contact schedule ${foot.name}`);
  }
  const seconds = duration(clip), dt = seconds / samples;
  if (Math.abs(seconds - gait.seconds) > 1e-6) throw new Error('Serialized gait duration differs from authored schedule');
  const allIndices = Array.from({ length: skin.count }, (_, i) => i);
  const feet = gait.feet.map(foot => ({ foot, worstSlips: {} as WorstSlip, primarySlip: [] as number[], primaryVertexSlip: [] as number[], primaryHorizontalSlip: [] as number[], primaryVerticalSpeed: [] as number[], nativeVelocities: [] as number[], nearFloorSlip: [] as number[], allPhaseNearFloorSlip: [] as number[], physicalPlaneSlip: [] as number[], incidentalPlaneSlip: [] as number[], primaryClearance: [] as number[], allClearance: [] as number[], active: [] as number[], lastPrimary: null as Vector3 | null, lastPoints: [] as Vector3[], lastPrimaryPoints: [] as Vector3[], first: null as Vector3 | null, last: null as Vector3 | null, firstVelocity: null as Vector3 | null, lastVelocity: null as Vector3 | null }));
  let minimumMeshY = Infinity, minimumMeshVertex = -1, minimumMeshPhase = 0, nonFiniteGeometrySamples = 0;
  let maximumSimultaneousDisagreement = 0, maximumLoopPosition = 0, maximumLoopVelocity = 0;
  let firstMesh: Vector3[] = [], secondMesh: Vector3[] = [], penultimateMesh: Vector3[] = [], lastMesh: Vector3[] = [];
  const supportCounts: number[] = [];
  try {
    for (let i = 0; i <= samples * 2; i++) {
      const phase = i / samples, localPhase = i > 0 && i % samples === 0 ? 1 : fract(phase);
      restorePose(pose); applyClip(clip, localPhase * seconds);
      const points = skin.points(allIndices), plantedVelocities: Vector3[] = [];
      if (i === 0) firstMesh = points;
      if (i === 1) secondMesh = points;
      if (i === samples - 1) penultimateMesh = points;
      if (i === samples) lastMesh = points;
      for (let index = 0; index < points.length; index++) {
        const point = points[index]!;
        if (![point.x, point.y, point.z].every(Number.isFinite)) nonFiniteGeometrySamples++;
        if (point.y < minimumMeshY) { minimumMeshY = point.y; minimumMeshVertex = index; minimumMeshPhase = phase; }
      }
      for (const row of feet) {
        const primaryPoints = row.foot.primaryVertices.map(index => points[index]!.clone());
        const primary = meanPoint(primaryPoints);
        const active = contactAt(row.foot, phase), wasActive = i > 0 && contactAt(row.foot, (i - 1) / samples);
        const selected = row.foot.vertices.map(index => points[index]!);
        if (active) {
          row.primaryClearance.push(primary.y - floorY);
          row.allClearance.push(...selected.map(point => point.y - floorY));
          if (i > 0 && i <= samples) row.active.push(i);
        }
        if (row.lastPrimary) {
          const velocity = primary.clone().sub(row.lastPrimary).multiplyScalar(1 / dt);
          if (i === 1) row.firstVelocity = velocity.clone();
          if (i === samples) row.lastVelocity = velocity.clone();
          if (active && wasActive) {
            row.nativeVelocities.push(-velocity.z);
            const groundVelocity = velocity.clone().add(new Vector3(0, 0, gait.nativeMps));
            row.primarySlip.push(groundVelocity.length()); row.primaryHorizontalSlip.push(Math.hypot(groundVelocity.x, groundVelocity.z)); row.primaryVerticalSpeed.push(Math.abs(groundVelocity.y)); plantedVelocities.push(groundVelocity);
            primaryPoints.forEach((point, k) => {
              const slip = point.clone().sub(row.lastPrimaryPoints[k]!).multiplyScalar(1 / dt).add(new Vector3(0, 0, gait.nativeMps)).length();
              row.primaryVertexSlip.push(slip); worstSlip(row.worstSlips, 'declaredStancePrimary', slip, phase - .5 / samples, row.foot.primaryVertices[k]!);
            });
            selected.forEach((point, k) => {
              const previous = row.lastPoints[k]!;
              if (Math.max(point.y, previous.y) <= floorY + .002 && Math.min(point.y, previous.y) >= floorY - .002) row.nearFloorSlip.push(point.clone().sub(previous).multiplyScalar(1 / dt).add(new Vector3(0, 0, gait.nativeMps)).length());
            });
          }
          selected.forEach((point, k) => {
            const previous = row.lastPoints[k]!;
            const slip = point.clone().sub(previous).multiplyScalar(1 / dt).add(new Vector3(0, 0, gait.nativeMps)).length();
            if (Math.max(point.y, previous.y) <= floorY + .002 && Math.min(point.y, previous.y) >= floorY - .002) {
              row.allPhaseNearFloorSlip.push(slip); worstSlip(row.worstSlips, 'broadNearFloorAllPhases', slip, phase - .5 / samples, row.foot.vertices[k]!);
            }
            // This is the authored physical pad/tip plane, with only 1um for Float32/FK noise.
            // The broad 2mm window above deliberately retains airborne approach/release samples.
            if (Math.max(point.y, previous.y) <= floorY + row.foot.clearance + .000001) {
              row.physicalPlaneSlip.push(slip);
              worstSlip(row.worstSlips, 'intendedContactPlaneAllPhases', slip, phase - .5 / samples, row.foot.vertices[k]!);
              if (!active || !wasActive) { row.incidentalPlaneSlip.push(slip); worstSlip(row.worstSlips, 'incidentalContactPlane', slip, phase - .5 / samples, row.foot.vertices[k]!); }
            }
          });
        }
        if (i === 0) row.first = primary.clone();
        if (i === samples) row.last = primary.clone();
        row.lastPrimary = primary; row.lastPoints = selected; row.lastPrimaryPoints = primaryPoints;
      }
      if (i > 0) supportCounts.push(plantedVelocities.length);
      for (const a of plantedVelocities) for (const b of plantedVelocities) maximumSimultaneousDisagreement = Math.max(maximumSimultaneousDisagreement, a.distanceTo(b));
    }
    for (const row of feet) {
      maximumLoopPosition = Math.max(maximumLoopPosition, row.first!.distanceTo(row.last!));
      maximumLoopVelocity = Math.max(maximumLoopVelocity, row.firstVelocity!.distanceTo(row.lastVelocity!));
    }
    const reports = feet.map(row => ({ name: row.foot.name, vertices: row.foot.vertices, primaryVertices: row.foot.primaryVertices, phaseOffset: row.foot.phaseOffset, duty: row.foot.duty, contactPhaseIntervals: phaseRanges(row.active, samples), nativeBackwardMps: stats(row.nativeVelocities), primarySlipMps: stats(row.primarySlip), primaryVertexSlipMps: stats(row.primaryVertexSlip), primaryHorizontalSlipMps: stats(row.primaryHorizontalSlip), primaryVerticalMps: stats(row.primaryVerticalSpeed), physicalNearFloorSoleSlipMps: stats(row.nearFloorSlip), allPhaseNearFloorSoleSlipMps: stats(row.allPhaseNearFloorSlip), allPhasePhysicalPlaneSlipMps: stats(row.physicalPlaneSlip), incidentalPhysicalPlaneSlipMps: stats(row.incidentalPlaneSlip), worstSlips: row.worstSlips, primaryClearanceM: stats(row.primaryClearance), allSoleClearanceM: stats(row.allClearance), loopPositionM: row.first!.distanceTo(row.last!), loopVelocityMps: row.firstVelocity!.distanceTo(row.lastVelocity!) }));
    let maximumWholeMeshLoopPositionM = 0, maximumWholeMeshLoopVelocityMps = 0, wholeMeshLoopVelocityVertex = -1;
    for (let index = 0; index < skin.count; index++) {
      maximumWholeMeshLoopPositionM = Math.max(maximumWholeMeshLoopPositionM, firstMesh[index]!.distanceTo(lastMesh[index]!));
      const difference = secondMesh[index]!.clone().sub(firstMesh[index]!).sub(lastMesh[index]!.clone().sub(penultimateMesh[index]!)).length() / dt;
      if (difference > maximumWholeMeshLoopVelocityMps) { maximumWholeMeshLoopVelocityMps = difference; wholeMeshLoopVelocityVertex = index; }
    }
    const failures: string[] = [];
    if (nonFiniteGeometrySamples) failures.push('Nonfinite skinned geometry');
    for (const row of reports) {
      if (!row.primarySlipMps.count || (row.primarySlipMps.max ?? Infinity) > .008) failures.push(`${row.name}: primary contact speed exceeds8mm/s`);
      if (!row.primaryVertexSlipMps.count || (row.primaryVertexSlipMps.max ?? Infinity) > .008) failures.push(`${row.name}: individual primary vertex speed exceeds8mm/s`);
      if (!row.physicalNearFloorSoleSlipMps.count || (row.physicalNearFloorSoleSlipMps.max ?? Infinity) > .012) failures.push(`${row.name}: physical sole contact speed exceeds12mm/s`);
      if (!row.allPhasePhysicalPlaneSlipMps.count || (row.allPhasePhysicalPlaneSlipMps.max ?? Infinity) > .012) failures.push(`${row.name}: all-phase physical contact speed exceeds12mm/s`);
      if ((row.primaryClearanceM.min ?? -Infinity) < -.00025 || (row.primaryClearanceM.max ?? Infinity) > .006) failures.push(`${row.name}: primary contact height outside[-.25,6]mm`);
      if ((row.allSoleClearanceM.min ?? -Infinity) < -.001) failures.push(`${row.name}: sole penetration exceeds1mm`);
    }
    if (minimumMeshY < floorY - .001) failures.push('Mesh penetration exceeds1mm');
    if (maximumLoopPosition > .00001) failures.push('Loop position exceeds10um');
    if (maximumLoopVelocity > .02) failures.push('Loop velocity differs by more than20mm/s');
    if (maximumWholeMeshLoopPositionM > .00001) failures.push('Whole-mesh loop position exceeds10um');
    if (maximumWholeMeshLoopVelocityMps > .04) failures.push('Whole-mesh loop velocity differs by more than40mm/s');
    if (maximumSimultaneousDisagreement > .012) failures.push('Simultaneous contact velocities disagree by more than12mm/s');
    return { name: gait.name, seconds, nativeMps: gait.nativeMps, samplesPerCycle: samples, cycles: 2, passed: failures.length === 0, failures, method: 'Actual original POSITION/JOINTS_0/WEIGHTS_0 vertices CPU-skinned using serialized animation channels and all imported transforms. Signed velocity includes virtual +Z root travel. Every designated stance interval is retained; no backward/slow-velocity sample filter. Individual primary vertices cannot cancel each other. Additional all-phase contact checks ignore the authored stance schedule.', contactNearFloorWindowM: .002, physicalContactPlane: 'Per-foot intended floorY+clearance, plus1um tolerance. The separate broad2mm all-phase window includes airborne approach/release samples and is reported without treating them as planted.', floorY, nonFiniteGeometrySamples, minimumMeshY, maximumMeshPenetrationM: Math.max(0, floorY - minimumMeshY), minimumMeshVertex, minimumMeshPhase, simultaneousSupportCount: stats(supportCounts), maximumSimultaneousVelocityDisagreementMps: maximumSimultaneousDisagreement, maximumLoopPositionM: maximumLoopPosition, maximumLoopVelocityMps: maximumLoopVelocity, maximumWholeMeshLoopPositionM, maximumWholeMeshLoopVelocityMps, wholeMeshLoopVelocityVertex, feet: reports, notes: gait.notes, authoringDiagnostics: gait.diagnostics ?? null };
  } finally { restorePose(pose); }
}

async function main() {
  const requested = process.argv.slice(2);
  if (requested[0] === '--asset') {
    if (requested.length !== 2 || requested[1] !== 'animal_scorpion') throw new Error('The separate --asset path currently owns only animal_scorpion');
    await stageScorpionRun();
    return;
  }
  const ids = requested.length ? IDS.filter(id => requested.includes(id)) : [...IDS];
  if (!ids.length || requested.some(id => !IDS.includes(id as typeof IDS[number]))) throw new Error('Only frog, frog_green and crab belong to this repair');
  await mkdir(OUT, { recursive: true });
  const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
  const results: any[] = [];
  for (const id of ids) {
    const asset = manifest.assets.find((asset: any) => asset.id === id), sourceFile = resolve('game/public/assets', asset.file);
    const source = await readFile(sourceFile), doc = await io.readBinary(source), floorY = asset.groundY ?? asset.base.y;
    const author = id === 'animal_crab' ? (await import('./lib/crab-ground-gait.js')).authorCrabGait : (await import('./lib/frog-ground-gait.js')).authorFrogGait;
    const gaits = (['Walk', 'Run'] as const).map(name => {
      const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === name)!;
      return author(doc, name, duration(clip), floorY);
    });
    const output = appendGaitAnimations(source, gaits), destination = resolve(OUT, `${id}.glb`);
    const restored = await io.readBinary(output);
    const audit = gaits.map(gait => auditGroundGait(restored, gait, id === 'animal_crab' ? 'crab_exp8' : 'lloop', floorY));
    const row = { id, sourceFile, stagedFile: destination, sourceSha256: sha(source), sha256: sha(output), sourceBytes: source.length, bytes: output.length, passed: audit.every(row => row.passed), preserved: { originalBinBytes: true, geometryUvNormalsSkinWeightsInverseBinds: true, materialTextureImages: true, nodeHierarchyIdentityRestTransforms: true, nonlocomotionAnimationJSONAndSamplerBytes: true }, set: { impliedWalkMps: gaits[0]!.nativeMps, impliedRunMps: gaits[1]!.nativeMps, walkClipSeconds: gaits[0]!.seconds, runClipSeconds: gaits[1]!.seconds }, audit };
    await writeFile(destination, output);
    await writeFile(resolve(OUT, `${id}.json`), JSON.stringify(row, null, 2));
    results.push(row);
    console.log(JSON.stringify({ id, passed: row.passed, bytes: output.length, clips: audit.map(row => ({ name: row.name, failures: row.failures, maxSlip: Math.max(...row.feet.map(foot => foot.primarySlipMps.max ?? Infinity)), maxPenetration: row.maximumMeshPenetrationM, loop: row.maximumLoopPositionM })) }));
  }
  const generatorFiles = ['tools/repair-ground-creature-gaits.ts', 'tools/lib/ground-gait.ts', 'tools/lib/crab-ground-gait.ts', 'tools/lib/frog-ground-gait.ts', 'tools/creature-motion/pose.ts'];
  const generator = await Promise.all(generatorFiles.map(async file => ({ file, sha256: sha(await readFile(file)) })));
  const report = { generatedAt: new Date().toISOString(), generator, visualAccepted: false, publicAssetsWritten: false, limitations: 'Straight steady-cycle bake. Runtime acceleration, arbitrary root turning and crossfade contacts still require production lab review. No camera or browser test runs in this tool.', assets: results };
  await writeFile(resolve(OUT, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(resolve(OUT, 'manifest-updates.json'), JSON.stringify(results.map(({ id, sourceSha256, sha256, bytes, set, passed }) => ({ id, sourceSha256, sha256, bytes, set, offlinePassed: passed, visualAccepted: false, promotable: false })), null, 2));
  if (results.some(row => !row.passed)) process.exitCode = 1;
}

/** Separate Run-only output. Never writes the frozen frog/crab staging directory. */
async function stageScorpionRun(): Promise<void> {
  const out = resolve('art/rebuild/candidates/finish-motion/scorpion-ground-gait'), id = 'animal_scorpion';
  await mkdir(out, { recursive: true });
  const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
  const asset = manifest.assets.find((asset: any) => asset.id === id), sourceFile = resolve('game/public/assets', asset.file);
  const source = await readFile(sourceFile), sourceSha256 = sha(source);
  if (sourceSha256 !== '69997972b3cd201feb1e20dc123fa0de64981b384be50de94b192446b42bc704') throw new Error('Scorpion source GLB changed; review the new source before applying this Run repair');
  const doc = await io.readBinary(source), floorY = asset.groundY ?? asset.base.y;
  const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Run')!;
  const gait = (await import('./lib/scorpion-ground-gait.js')).authorScorpionRun(doc, duration(clip), floorY);
  const output = appendGaitAnimations(source, [gait]);
  const sourceAnimations = readRawGlb(source).json.animations, outputAnimations = readRawGlb(output).json.animations;
  sourceAnimations.forEach((clip: any, index: number) => { if (clip.name !== 'Run' && JSON.stringify(clip) !== JSON.stringify(outputAnimations[index])) throw new Error(`Scorpion ${clip.name} changed outside Run scope`); });
  const restored = await io.readBinary(output), audit = auditGroundGait(restored, gait, 'Scorpion_Mesh', floorY);
  const stagedFile = resolve(out, `${id}.glb`);
  const generatorFiles = ['tools/repair-ground-creature-gaits.ts', 'tools/lib/scorpion-ground-gait.ts', 'tools/lib/ground-gait.ts', 'tools/creature-motion/pose.ts'];
  const generator = await Promise.all(generatorFiles.map(async file => ({ file, sha256: sha(await readFile(file)) })));
  const row = { id, sourceFile, stagedFile, sourceSha256, sha256: sha(output), sourceBytes: source.length, bytes: output.length, passed: audit.passed, visualAccepted: false,
    preserved: { originalBinBytes: true, geometryUvNormalsSkinWeightsInverseBinds: true, materialTextureImages: true, nodeHierarchyIdentityRestTransforms: true, allSevenOtherClipsIncludingWalk: true, originalGroundY: floorY },
    set: { impliedRunMps: gait.nativeMps, runClipSeconds: gait.seconds }, generator, audit };
  await writeFile(stagedFile, output);
  await writeFile(resolve(out, 'report.json'), JSON.stringify(row, null, 2));
  await writeFile(resolve(out, 'manifest-updates.json'), JSON.stringify([{ id, sourceSha256, sha256: row.sha256, bytes: row.bytes, set: row.set, offlinePassed: row.passed, visualAccepted: false, promotable: false }], null, 2));
  console.log(JSON.stringify({ id, passed: row.passed, bytes: output.length, failures: audit.failures, nativeMps: gait.nativeMps, maxIndividualSlip: Math.max(...audit.feet.map(foot => foot.primaryVertexSlipMps.max ?? Infinity)), maxContactPlaneSlip: Math.max(...audit.feet.map(foot => foot.allPhasePhysicalPlaneSlipMps.max ?? Infinity)), maxPenetration: audit.maximumMeshPenetrationM, loop: audit.maximumWholeMeshLoopPositionM }));
  if (!row.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
