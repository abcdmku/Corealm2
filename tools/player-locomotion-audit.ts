/**
 * Browser-free audit of the shipped player jog and the player-local stride bake.
 * Run: npx tsx tools/player-locomotion-audit.ts
 *
 * Texture references are removed only from an in-memory GLB JSON chunk. Geometry,
 * skinning, animation and BIN bytes are the shipped data. Boot assembly uses the
 * production name-keyed rebind. Contact coordinates use the fixed body frame.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { bakePlayerJog } from "../game/src/render/playerLocomotion.js";
import { collectBones, collectSkinnedMeshes, rebindSkinnedPart } from "../game/src/render/skinning.js";

const ASSETS = resolve("game/public/assets/models");
const OUT = resolve("test-results/player-locomotion");
const SAMPLES = 1920;
const TARGET_NATIVE_MPS = 3.5;
const GAME_MPS = 4.2;
const PLAYBACK_RATE = 1.2;
const CONTACT_HEIGHT_M = .015;
const EXPECTED_TRACKS = new Set(["thigh_l", "thigh_r", "calf_l", "calf_r", "foot_l", "foot_r"].map(name => `${name}.quaternion`));
type Side = "l" | "r";
type SoleVertex = { mesh: THREE.SkinnedMesh; index: number; rest: number[] };
type PoseSample = { bones: Map<string, { p: number[]; q: number[] }>; soles: Record<Side, number[][]> };
type Rig = { body: THREE.Object3D; bones: Map<string, THREE.Bone>; soles: Record<Side, SoleVertex[]>; rebind: { bound: number; missing: string[]; discardedBones: number }; fixedInverse: THREE.Matrix4 };

const failures: string[] = [];
function check(condition: boolean, message: string): void { if (!condition) failures.push(message); }
function sha(bytes: string | Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function median(values: number[]): number | null { return quantile(values, .5); }
function quantile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}
function summary(values: number[]) {
  return { count: values.length, min: values.length ? Math.min(...values) : null, median: median(values), p95: quantile(values, .95), max: values.length ? Math.max(...values) : null };
}
function clipHash(clip: THREE.AnimationClip): string {
  const hash = createHash("sha256"); hash.update(`${clip.name}|${clip.duration}|${clip.blendMode}`);
  for (const track of clip.tracks) { hash.update(`${track.name}|${track.getInterpolation()}|${track.ValueTypeName}`); hash.update(Buffer.from(track.times.buffer, track.times.byteOffset, track.times.byteLength)); hash.update(Buffer.from(track.values.buffer, track.values.byteOffset, track.values.byteLength)); }
  return hash.digest("hex");
}
function restHash(root: THREE.Object3D): string {
  const rows: unknown[] = [];
  root.traverse(node => rows.push([node.name, node.position.toArray(), node.quaternion.toArray(), node.scale.toArray(), node.matrix.toArray()]));
  return sha(JSON.stringify(rows));
}
export async function loadGeometryGlb(file: string): Promise<GLTF> {
  const bytes = await readFile(file);
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`Not a JSON-first GLB: ${file}`);
  const oldLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + oldLength).toString("utf8")) as { materials?: { name?: string; doubleSided?: boolean }[]; images?: unknown[]; textures?: unknown[]; samplers?: unknown[] };
  json.materials = json.materials?.map(material => ({ name: material.name, doubleSided: material.doubleSided }));
  json.images = []; json.textures = []; json.samplers = [];
  const text = Buffer.from(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const tail = bytes.subarray(20 + oldLength);
  const rebuilt = Buffer.alloc(20 + jsonLength + tail.length, 0x20);
  rebuilt.writeUInt32LE(0x46546c67, 0); rebuilt.writeUInt32LE(2, 4); rebuilt.writeUInt32LE(rebuilt.length, 8);
  rebuilt.writeUInt32LE(jsonLength, 12); rebuilt.writeUInt32LE(0x4e4f534a, 16);
  text.copy(rebuilt, 20); tail.copy(rebuilt, 20 + jsonLength);
  const buffer = new Uint8Array(rebuilt).buffer;
  return new GLTFLoader().parseAsync(buffer, "");
}
async function loadAsset(file: string): Promise<{ gltf: GLTF; hash: string }> {
  const [gltf, bytes] = await Promise.all([loadGeometryGlb(file), readFile(file)]);
  return { gltf, hash: sha(bytes) };
}
function assemble(bodySource: THREE.Object3D, bootSource: THREE.Object3D): Rig {
  const body = cloneSkinned(bodySource);
  body.updateMatrixWorld(true);
  const bones = collectBones(body);
  const rebound = rebindSkinnedPart(cloneSkinned(bootSource), bones, body, { onMissingBone: "reject" });
  if (rebound.rejected || !rebound.bound) throw new Error(`Boot rebind failed: ${rebound.missing.join(", ")}`);
  body.updateMatrixWorld(true);
  const fixedInverse = body.matrixWorld.clone().invert();
  const candidates: Record<Side, SoleVertex[]> = { l: [], r: [] };
  const point = new THREE.Vector3();
  for (const mesh of rebound.meshes) {
    const position = mesh.geometry.getAttribute("position");
    for (let index = 0; index < position.count; index++) {
      mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld).applyMatrix4(fixedInverse);
      const side: Side = point.x >= 0 ? "l" : "r";
      candidates[side].push({ mesh, index, rest: point.toArray() });
    }
  }
  const soles = { l: [] as SoleVertex[], r: [] as SoleVertex[] };
  for (const side of ["l", "r"] as const) {
    // Heel, middle and forefoot have different authored rest heights. Keep fixed
    // low vertices in each region, including the heel's real calf skin weights.
    const regions = [
      candidates[side].filter(vertex => vertex.rest[1]! < .05 && vertex.rest[2]! < 0),
      candidates[side].filter(vertex => vertex.rest[1]! < .05 && vertex.rest[2]! >= 0 && vertex.rest[2]! < .06),
      candidates[side].filter(vertex => vertex.rest[1]! < .05 && vertex.rest[2]! >= .06),
    ];
    soles[side] = regions.flatMap(vertices => {
      const low = Math.min(...vertices.map(vertex => vertex.rest[1]!));
      return vertices.filter(vertex => vertex.rest[1]! <= low + .008);
    });
    if (!soles[side].length) throw new Error(`No ${side} boot sole vertices`);
  }
  return { body, bones, soles, fixedInverse, rebind: { bound: rebound.bound, missing: rebound.missing, discardedBones: rebound.discardedBones } };
}
function validateRig(rig: Rig, label: string) {
  let vertices = 0, invalidPositions = 0, invalidJoints = 0, invalidWeights = 0, maxWeightSumError = 0;
  for (const mesh of collectSkinnedMeshes(rig.body)) {
    const position = mesh.geometry.getAttribute("position"), joints = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
    check(Boolean(joints && weights), `${label}: missing skin attributes on ${mesh.name}`);
    if (!joints || !weights) continue;
    for (let i = 0; i < position.count; i++) {
      vertices++;
      if (![position.getX(i), position.getY(i), position.getZ(i)].every(Number.isFinite)) invalidPositions++;
      let sum = 0;
      for (let j = 0; j < weights.itemSize; j++) {
        const weight = weights.getComponent(i, j), joint = joints.getComponent(i, j);
        if (!Number.isFinite(weight) || weight < 0) invalidWeights++;
        if (!Number.isInteger(joint) || joint < 0 || joint >= mesh.skeleton.bones.length) invalidJoints++;
        sum += weight;
      }
      maxWeightSumError = Math.max(maxWeightSumError, Math.abs(1 - sum));
    }
  }
  check(invalidPositions === 0 && invalidJoints === 0 && invalidWeights === 0 && maxWeightSumError < 1e-5, `${label}: invalid original body/boot geometry or skin`);
  return { vertices, invalidPositions, invalidJoints, invalidWeights, maxWeightSumError };
}
function sampleRig(rig: Rig, clip: THREE.AnimationClip): PoseSample[] {
  const mixer = new THREE.AnimationMixer(rig.body);
  const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true; action.play();
  const result: PoseSample[] = [];
  const point = new THREE.Vector3(), rotation = new THREE.Quaternion();
  for (let index = 0; index <= SAMPLES; index++) {
    mixer.setTime(index * clip.duration / SAMPLES); rig.body.updateMatrixWorld(true);
    const bones = new Map<string, { p: number[]; q: number[] }>();
    for (const [name, bone] of rig.bones) {
      bone.getWorldPosition(point).applyMatrix4(rig.fixedInverse);
      bone.getWorldQuaternion(rotation);
      bones.set(name, { p: point.toArray(), q: rotation.toArray() });
    }
    const soles = { l: [] as number[][], r: [] as number[][] };
    for (const side of ["l", "r"] as const) for (const vertex of rig.soles[side]) {
      vertex.mesh.getVertexPosition(vertex.index, point).applyMatrix4(vertex.mesh.matrixWorld).applyMatrix4(rig.fixedInverse);
      soles[side].push(point.toArray());
    }
    result.push({ bones, soles });
  }
  mixer.stopAllAction(); mixer.uncacheRoot(rig.body);
  return result;
}
function validateClip(source: THREE.AnimationClip, baked: THREE.AnimationClip, label: string) {
  const before = new Map(source.tracks.map(track => [track.name, track]));
  const changed: string[] = [];
  let maxQuaternionNormError = 0, maxLoopQuaternionAngle = 0, maxBakedLegLoopQuaternionAngle = 0, minAdjacentQuaternionDot = 1;
  check(baked !== source, `${label}: baked clip aliases shared source`);
  check(baked.duration === source.duration && baked.name === source.name && baked.blendMode === source.blendMode, `${label}: clip name/duration/blend mode changed`);
  check(baked.tracks.length === source.tracks.length, `${label}: track count changed`);
  check(new Set(baked.tracks.map(track => track.name)).size === baked.tracks.length, `${label}: duplicate track names`);
  for (const track of baked.tracks) {
    const original = before.get(track.name);
    check(Boolean(original), `${label}: unexpected track ${track.name}`);
    if (!original) continue;
    const same = track.getInterpolation() === original.getInterpolation() && track.times.length === original.times.length && track.values.length === original.values.length && track.times.every((v, i) => v === original.times[i]) && track.values.every((v, i) => v === original.values[i]);
    if (!same) changed.push(track.name);
    check(same || EXPECTED_TRACKS.has(track.name), `${label}: non-leg track modified ${track.name}`);
    check([...track.times, ...track.values].every(Number.isFinite), `${label}: nonfinite track ${track.name}`);
    check(track.times.every((time, i) => time >= 0 && time <= baked.duration + 1e-6 && (i === 0 || time > track.times[i - 1]!)), `${label}: invalid key times ${track.name}`);
    if (track.ValueTypeName !== "quaternion") continue;
    for (let i = 0; i < track.values.length; i += 4) {
      const q = new THREE.Quaternion().fromArray(track.values, i);
      maxQuaternionNormError = Math.max(maxQuaternionNormError, Math.abs(q.length() - 1));
      if (i > 0 && EXPECTED_TRACKS.has(track.name)) minAdjacentQuaternionDot = Math.min(minAdjacentQuaternionDot, q.dot(new THREE.Quaternion().fromArray(track.values, i - 4)));
    }
    const first = new THREE.Quaternion().fromArray(track.values, 0).normalize(), last = new THREE.Quaternion().fromArray(track.values, track.values.length - 4).normalize();
    maxLoopQuaternionAngle = Math.max(maxLoopQuaternionAngle, first.angleTo(last));
    if (EXPECTED_TRACKS.has(track.name)) maxBakedLegLoopQuaternionAngle = Math.max(maxBakedLegLoopQuaternionAngle, first.angleTo(last));
  }
  check(changed.length === EXPECTED_TRACKS.size && changed.every(name => EXPECTED_TRACKS.has(name)), `${label}: expected exactly six changed leg quaternion tracks; got ${changed.join(", ")}`);
  check(maxQuaternionNormError < 1e-5, `${label}: nonunit quaternion ${maxQuaternionNormError}`);
  check(maxBakedLegLoopQuaternionAngle < .002, `${label}: baked leg quaternion loop seam ${maxBakedLegLoopQuaternionAngle}`);
  check(minAdjacentQuaternionDot >= 0, `${label}: baked quaternion sign discontinuity`);
  return { changedTracks: changed, sourceTracks: source.tracks.length, bakedTracks: baked.tracks.length, durationSeconds: baked.duration, maxQuaternionNormError, maxLoopQuaternionAngle, maxBakedLegLoopQuaternionAngle, minAdjacentQuaternionDot };
}
function contacts(samples: PoseSample[], reference: PoseSample[], duration: number, side: Side, rate: number, groundMps: number, soleContactHeightM = CONTACT_HEIGHT_M) {
  const dt = duration / SAMPLES;
  const bone = `ball_${side}`;
  const minimumBallY = Math.min(...reference.map(row => row.bones.get(bone)!.p[1]!));
  const minimumSoleY = reference.reduce((low, row) => row.soles[side].reduce((minimum, point) => Math.min(minimum, point[1]!), low), Infinity);
  const sampledBallMinimumY = samples.reduce((low, row) => Math.min(low, row.bones.get(bone)!.p[1]!), Infinity);
  const sampledSoleMinimumY = samples.reduce((low, row) => row.soles[side].reduce((minimum, point) => Math.min(minimum, point[1]!), low), Infinity);
  const ballVelocity: number[] = [], ballResidual: number[] = [], soleVelocity: number[] = [], soleResidual: number[] = [], soleAbsoluteSlip: number[] = [];
  const contactPhases: number[] = [];
  for (let i = 1; i <= SAMPLES; i++) {
    const previous = reference[i - 1]!, next = reference[i]!;
    const a = previous.bones.get(bone)!.p, b = next.bones.get(bone)!.p;
    if (Math.max(a[1]!, b[1]!) <= minimumBallY + CONTACT_HEIGHT_M && a[2]! > b[2]!) {
      const from = samples[i - 1]!.bones.get(bone)!.p, to = samples[i]!.bones.get(bone)!.p;
      const velocity = (from[2]! - to[2]!) / dt;
      ballVelocity.push(velocity); ballResidual.push(groundMps - velocity * rate); contactPhases.push((i - .5) / SAMPLES);
    }
    const speeds: number[] = [], signed: number[] = [], slips: number[] = [];
    for (let v = 0; v < previous.soles[side].length; v++) {
      const oldRef = previous.soles[side][v]!, newRef = next.soles[side][v]!;
      if (Math.max(oldRef[1]!, newRef[1]!) > minimumSoleY + soleContactHeightM || oldRef[2]! <= newRef[2]!) continue;
      const from = samples[i - 1]!.soles[side][v]!, to = samples[i]!.soles[side][v]!;
      const velocity = (from[2]! - to[2]!) / dt, residual = groundMps - velocity * rate;
      speeds.push(velocity); signed.push(residual); slips.push(Math.hypot(residual, (to[0]! - from[0]!) / dt * rate));
    }
    // Each phase has one vote; duplicate mesh vertices do not dominate the audit.
    if (speeds.length) { soleVelocity.push(median(speeds)!); soleResidual.push(median(signed)!); soleAbsoluteSlip.push(median(slips)!); }
  }
  return { referenceMask: "Original clip, backward motion and near per-foot cycle minimum; identical phases/vertices for source and baked", ballContactHeightM: CONTACT_HEIGHT_M, soleContactHeightM, rate, groundMps, minimumBallY, minimumSoleY, sampledBallMinimumY, sampledSoleMinimumY,
    ballNativeBackwardMps: summary(ballVelocity), ballSignedWorldSlipMps: summary(ballResidual), soleNativeBackwardMps: summary(soleVelocity), soleSignedWorldSlipMps: summary(soleResidual), soleAbsoluteWorldSlipMps: summary(soleAbsoluteSlip), contactPhases };
}
function comparePoses(source: PoseSample[], baked: PoseSample[], label: string) {
  let maxUpperPositionDelta = 0, maxUpperQuaternionDelta = 0, maxSoleYDelta = 0, maxSoleXDelta = 0, maxFootWorldQuaternionDelta = 0, maxLengthDelta = 0, maxLoopPositionDelta = 0, sourceMaxLoopPositionDelta = 0;
  let maxSoleYPhase = 0, maxSoleXPhase = 0, maxFootQuaternionPhase = 0;
  let maxContactSoleYDelta = 0, maxContactSoleXDelta = 0;
  const soleMinima = Object.fromEntries((["l", "r"] as const).map(side => [side, source.reduce((low, row) => row.soles[side].reduce((minimum, point) => Math.min(minimum, point[1]!), low), Infinity)])) as Record<Side, number>;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Quaternion(), r = new THREE.Quaternion();
  for (let i = 0; i <= SAMPLES; i++) {
    for (const [name, before] of source[i]!.bones) {
      const after = baked[i]!.bones.get(name)!;
      check([...after.p, ...after.q].every(Number.isFinite), `${label}: nonfinite bone ${name} at ${i}`);
      if (!/^(thigh|calf|foot|ball)(_|$)/.test(name)) {
        maxUpperPositionDelta = Math.max(maxUpperPositionDelta, a.fromArray(before.p).distanceTo(b.fromArray(after.p)));
        maxUpperQuaternionDelta = Math.max(maxUpperQuaternionDelta, q.fromArray(before.q).normalize().angleTo(r.fromArray(after.q).normalize()));
      }
    }
    for (const side of ["l", "r"] as const) {
      const footAngle = q.fromArray(source[i]!.bones.get(`foot_${side}`)!.q).normalize().angleTo(r.fromArray(baked[i]!.bones.get(`foot_${side}`)!.q).normalize());
      if (footAngle > maxFootWorldQuaternionDelta) { maxFootWorldQuaternionDelta = footAngle; maxFootQuaternionPhase = i / SAMPLES; }
      for (const [parent, child] of [[`thigh_${side}`, `calf_${side}`], [`calf_${side}`, `foot_${side}`]]) {
        const originalLength = a.fromArray(source[i]!.bones.get(parent!)!.p).distanceTo(b.fromArray(source[i]!.bones.get(child!)!.p));
        const bakedLength = a.fromArray(baked[i]!.bones.get(parent!)!.p).distanceTo(b.fromArray(baked[i]!.bones.get(child!)!.p));
        maxLengthDelta = Math.max(maxLengthDelta, Math.abs(originalLength - bakedLength));
      }
      for (let v = 0; v < source[i]!.soles[side].length; v++) {
        const original = source[i]!.soles[side][v]!, corrected = baked[i]!.soles[side][v]!;
        const yDelta = Math.abs(original[1]! - corrected[1]!), xDelta = Math.abs(original[0]! - corrected[0]!);
        if (yDelta > maxSoleYDelta) { maxSoleYDelta = yDelta; maxSoleYPhase = i / SAMPLES; }
        if (xDelta > maxSoleXDelta) { maxSoleXDelta = xDelta; maxSoleXPhase = i / SAMPLES; }
        if (original[1]! <= soleMinima[side] + CONTACT_HEIGHT_M) { maxContactSoleYDelta = Math.max(maxContactSoleYDelta, yDelta); maxContactSoleXDelta = Math.max(maxContactSoleXDelta, xDelta); }
      }
    }
  }
  for (const [name, first] of baked[0]!.bones) {
    maxLoopPositionDelta = Math.max(maxLoopPositionDelta, a.fromArray(first.p).distanceTo(b.fromArray(baked[SAMPLES]!.bones.get(name)!.p)));
    sourceMaxLoopPositionDelta = Math.max(sourceMaxLoopPositionDelta, a.fromArray(source[0]!.bones.get(name)!.p).distanceTo(b.fromArray(source[SAMPLES]!.bones.get(name)!.p)));
  }
  check(maxUpperPositionDelta < 1e-7 && maxUpperQuaternionDelta < 1e-5, `${label}: pelvis/upper-body pose changed`);
  check(maxLengthDelta < 1e-5, `${label}: leg segment length changed`);
  check(maxFootWorldQuaternionDelta < .01, `${label}: foot world rotation changed ${maxFootWorldQuaternionDelta}`);
  check(maxContactSoleYDelta < .002 && maxContactSoleXDelta < .002, `${label}: contact shoe sole X/Y moved, ${maxContactSoleXDelta}/${maxContactSoleYDelta}`);
  check(maxLoopPositionDelta <= sourceMaxLoopPositionDelta + .001, `${label}: worsened positional loop seam ${maxLoopPositionDelta}`);
  return { maxUpperPositionDelta, maxUpperQuaternionDelta, maxSoleYDelta, maxSoleYPhase, maxSoleXDelta, maxSoleXPhase, maxContactSoleYDelta, maxContactSoleXDelta, maxFootWorldQuaternionDelta, maxFootQuaternionPhase, maxLengthDelta, maxLoopPositionDelta, sourceMaxLoopPositionDelta };
}

export async function runAudit(): Promise<void> {
failures.length = 0;
await mkdir(OUT, { recursive: true });
const started = performance.now();
const library = await loadAsset(resolve(ASSETS, "animation/animation_library_1.glb"));
const source = library.gltf.animations.find(clip => clip.name === "Jog_Fwd_Loop");
const walk = library.gltf.animations.find(clip => clip.name === "Walk_Loop");
if (!source || !walk) throw new Error("Shipped player library lacks required locomotion clips");
const libraryBefore = library.gltf.animations.map(clipHash);
const reports: unknown[] = [];
for (const sex of ["male", "female"]) {
  const [bodyAsset, bootAsset] = await Promise.all([
    loadAsset(resolve(ASSETS, `character/base_${sex}.glb`)),
    loadAsset(resolve(ASSETS, `outfit/outfit_${sex}_peasant_boots.glb`)),
  ]);
  const restBefore = restHash(bodyAsset.gltf.scene);
  const bakeStarted = performance.now();
  const { clip: baked, diagnostics } = bakePlayerJog(source, bodyAsset.gltf.scene, TARGET_NATIVE_MPS);
  const bakeMilliseconds = performance.now() - bakeStarted;
  check(restBefore === restHash(bodyAsset.gltf.scene), `${sex}: bake mutated supplied rest body`);
  const clipValidation = validateClip(source, baked, sex);
  const originalRig = assemble(bodyAsset.gltf.scene, bootAsset.gltf.scene);
  const bakedRig = assemble(bodyAsset.gltf.scene, bootAsset.gltf.scene);
  const walkRig = assemble(bodyAsset.gltf.scene, bootAsset.gltf.scene);
  const rigValidation = validateRig(originalRig, sex);
  const original = sampleRig(originalRig, source), corrected = sampleRig(bakedRig, baked), walked = sampleRig(walkRig, walk);
  const comparison = comparePoses(original, corrected, sex);
  const feet = Object.fromEntries((["l", "r"] as const).map(side => {
    const originalContact = contacts(original, original, source.duration, side, PLAYBACK_RATE, GAME_MPS);
    const bakedContact = contacts(corrected, original, source.duration, side, PLAYBACK_RATE, GAME_MPS);
    const walkContact = contacts(walked, walked, walk.duration, side, 1, .98);
    const strictGround = {
      original: contacts(original, original, source.duration, side, PLAYBACK_RATE, GAME_MPS, .005),
      baked: contacts(corrected, original, source.duration, side, PLAYBACK_RATE, GAME_MPS, .005),
    };
    const implied = bakedContact.ballNativeBackwardMps.median;
    check(implied !== null && Math.abs(implied - TARGET_NATIVE_MPS) < .10, `${sex}/${side}: baked ball speed ${implied} misses native target ${TARGET_NATIVE_MPS}`);
    check(bakedContact.soleAbsoluteWorldSlipMps.median !== null && bakedContact.soleAbsoluteWorldSlipMps.median < originalContact.soleAbsoluteWorldSlipMps.median! * .35, `${sex}/${side}: actual boot sole slip did not improve by 65%`);
    return [side, { selectedSoleVertices: originalRig.soles[side].length, soleRestBounds: { minY: Math.min(...originalRig.soles[side].map(v => v.rest[1]!)), maxY: Math.max(...originalRig.soles[side].map(v => v.rest[1]!)) }, original: originalContact, baked: bakedContact, walk: walkContact, strictGround }];
  }));
  reports.push({ sex, assets: { bodySha256: bodyAsset.hash, bootsSha256: bootAsset.hash }, bakeMilliseconds, diagnostics, rebind: originalRig.rebind, bones: originalRig.bones.size, skinnedMeshes: collectSkinnedMeshes(originalRig.body).length, rigValidation, clipValidation, comparison, feet });
  await writeFile(resolve(OUT, `${sex}-phase-traces.json`), JSON.stringify(Array.from({ length: SAMPLES + 1 }, (_, i) => ({ phase: i / SAMPLES, original: { leftBall: original[i]!.bones.get("ball_l")!.p, rightBall: original[i]!.bones.get("ball_r")!.p, pelvis: original[i]!.bones.get("pelvis")!.p }, baked: { leftBall: corrected[i]!.bones.get("ball_l")!.p, rightBall: corrected[i]!.bones.get("ball_r")!.p, pelvis: corrected[i]!.bones.get("pelvis")!.p } })), null, 2));
}
check(library.gltf.animations.every((clip, index) => clipHash(clip) === libraryBefore[index]), "Bake mutated the shared library or an unrelated clip");
const report = { passed: failures.length === 0, generatedAt: new Date().toISOString(), method: { samplesPerCycle: SAMPLES, fixedFrame: "Body scene at rest; no pelvis-relative rotation", contactHeightMetres: CONTACT_HEIGHT_M, targetNativeMps: TARGET_NATIVE_MPS, playbackRate: PLAYBACK_RATE, gameplayMps: GAME_MPS, originalLibrarySha256: library.hash, bakeModuleSha256: sha(await readFile(resolve("game/src/render/playerLocomotion.ts"))), checksSharedSourceUnchanged: true, actualBootGeometry: true, usesProductionRebind: true, browserUsed: false }, reports, failures, elapsedMilliseconds: performance.now() - started };
await writeFile(resolve(OUT, "audit.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, output: resolve(OUT, "audit.json"), failures, elapsedMilliseconds: report.elapsedMilliseconds }, null, 2));
if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await runAudit(); }
  catch (error) {
    // Never leave an older successful report behind after a failed build/load.
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    await mkdir(OUT, { recursive: true });
    await writeFile(resolve(OUT, "audit.json"), JSON.stringify({ passed: false, generatedAt: new Date().toISOString(), failures: [message] }, null, 2));
    console.error(message); process.exitCode = 1;
  }
}
