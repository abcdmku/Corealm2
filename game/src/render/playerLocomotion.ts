import * as THREE from "three";

export interface JogBakeDiagnostics {
  readonly sourceNativeMps: number;
  readonly targetNativeMps: number;
  readonly strideRatio: number;
  readonly sampleCount: number;
  readonly maxIkResidualM: number;
  readonly minReachMarginM: number;
  readonly elapsedMs: number;
}

export interface BakedPlayerJog {
  readonly clip: THREE.AnimationClip;
  readonly diagnostics: JogBakeDiagnostics;
}

const SIDES = ["l", "r"] as const;
const LEG_NAMES = SIDES.flatMap(side => [`thigh_${side}`, `calf_${side}`, `foot_${side}`]);
const REPLACED = new Set(LEG_NAMES.map(name => `${name}.quaternion`));
const SAMPLE_HZ = 240;
const cache = new WeakMap<THREE.AnimationClip, Map<string, BakedPlayerJog>>();

type Leg = { hip: THREE.Object3D; knee: THREE.Object3D; ankle: THREE.Object3D; ball: THREE.Object3D };
type LegPose = { hip: THREE.Vector3; knee: THREE.Vector3; ankle: THREE.Vector3; ball: THREE.Vector3; rotation: THREE.Quaternion };
const point = (node: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
const rotation = (node: THREE.Object3D) => node.getWorldQuaternion(new THREE.Quaternion());

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2;
}

/** Copy transforms only: the temporary solver owns no geometry, materials or live bones. */
function scratchRig(body: THREE.Object3D): THREE.Object3D {
  const copy = new THREE.Object3D();
  copy.name = body.name;
  copy.position.copy(body.position);
  copy.quaternion.copy(body.quaternion);
  copy.scale.copy(body.scale);
  for (const child of body.children) copy.add(scratchRig(child));
  return copy;
}

function aim(node: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3): void {
  const origin = point(node);
  const turn = new THREE.Quaternion().setFromUnitVectors(
    point(child).sub(origin).normalize(), target.clone().sub(origin).normalize(),
  );
  const wanted = rotation(node).premultiply(turn);
  node.quaternion.copy(rotation(node.parent!).invert().multiply(wanted)).normalize();
  node.updateMatrixWorld(true);
}

function solve(leg: Leg, pose: LegPose, target: THREE.Vector3): { residual: number; margin: number } {
  const upper = pose.hip.distanceTo(pose.knee), lower = pose.knee.distanceTo(pose.ankle);
  const axis = target.clone().sub(pose.hip), distance = axis.length();
  const margin = Math.min(upper + lower - distance, distance - Math.abs(upper - lower));
  if (!Number.isFinite(margin) || margin < 1e-5) throw new Error(`Player jog target is outside the leg's reach (${margin}m)`);
  axis.divideScalar(distance);
  const sourceAxis = pose.ankle.clone().sub(pose.hip).normalize();
  const pole = pose.knee.clone().sub(pose.hip);
  // Extract the source bend direction before projecting onto the shorter leg.
  // Projecting the whole knee offset onto the new axis can reverse the knee.
  pole.addScaledVector(sourceAxis, -pole.dot(sourceAxis));
  pole.addScaledVector(axis, -pole.dot(axis));
  if (pole.lengthSq() < 1e-10) throw new Error("Player jog source knee has no stable bend plane");
  pole.normalize();
  const along = (upper * upper + distance * distance - lower * lower) / (2 * distance);
  const knee = pose.hip.clone().addScaledVector(axis, along)
    .addScaledVector(pole, Math.sqrt(Math.max(0, upper * upper - along * along)));
  aim(leg.hip, leg.knee, knee);
  aim(leg.knee, leg.ankle, target);
  // Keep the original world foot orientation and untouched toe articulation.
  leg.ankle.quaternion.copy(rotation(leg.knee).invert().multiply(pose.rotation)).normalize();
  leg.ankle.updateMatrixWorld(true);
  return { residual: point(leg.ankle).distanceTo(target), margin };
}

/**
 * Bake a shorter player-only UAL jog without changing cadence or the shared library.
 * The supplied body must be in its rest pose, expressed in the game's metre/Y-up frame.
 * Only thigh/calf/foot quaternion tracks change. Pelvis motion, toe roll, clip duration,
 * markers and all other tracks are copied. Results are cached by clip identity and rig
 * transforms; callers must treat returned clips as immutable and keep them locally.
 *
 * This corrects steady forward travel. Acceleration, turning and crossfade contacts still
 * depend on the caller's movement/rate policy; a baked loop cannot plant those transients.
 */
export function bakePlayerJog(
  sourceClip: THREE.AnimationClip,
  restBody: THREE.Object3D,
  targetNativeMps = 3.5,
): BakedPlayerJog {
  if (sourceClip.name !== "Jog_Fwd_Loop" || !Number.isFinite(sourceClip.duration) || sourceClip.duration <= 0) {
    throw new Error("Player jog bake requires the in-place Jog_Fwd_Loop clip");
  }
  if (!Number.isFinite(targetNativeMps) || targetNativeMps <= 0) throw new Error("Invalid player jog target speed");
  for (const name of REPLACED) {
    if (sourceClip.tracks.filter(track => track.name === name).length !== 1) throw new Error(`Player jog needs one ${name} track`);
  }
  const started = performance.now();
  const rig = scratchRig(restBody);
  const need = (name: string) => {
    const node = rig.getObjectByName(name);
    if (!node) throw new Error(`Player jog rig is missing ${name}`);
    return node;
  };
  const pelvis = need("pelvis");
  const legs = SIDES.map(side => ({ hip: need(`thigh_${side}`), knee: need(`calf_${side}`), ankle: need(`foot_${side}`), ball: need(`ball_${side}`) }));
  const needed = new Set<THREE.Object3D>();
  for (const leg of legs) {
    if (leg.knee.parent !== leg.hip || leg.ankle.parent !== leg.knee || leg.ball.parent !== leg.ankle) throw new Error("Unsupported player leg hierarchy");
    for (let node: THREE.Object3D | null = leg.ball; node; node = node.parent) needed.add(node);
  }
  const nodes = [...needed];
  const key = `${targetNativeMps}:` + JSON.stringify(nodes.map(node => [node.name, node.position.toArray(), node.quaternion.toArray(), node.scale.toArray()]));
  const cached = cache.get(sourceClip)?.get(key);
  if (cached) return cached;
  const initial = nodes.map(node => ({ node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() }));
  const samplers = sourceClip.tracks.flatMap(track => {
    const split = track.name.lastIndexOf("."), name = track.name.slice(0, split), property = track.name.slice(split + 1);
    const node = rig.getObjectByName(name);
    if (!node || !needed.has(node)) return [];
    if (property !== "position" && property !== "quaternion" && property !== "scale") throw new Error(`Unsupported player jog track ${track.name}`);
    // Three's runtime exposes this factory, while its KeyframeTrack declaration omits it.
    const interpolant = (track as THREE.KeyframeTrack & { createInterpolant(): THREE.Interpolant }).createInterpolant();
    return [{ node, property, interpolant }];
  });
  const sourcePose = (time: number) => {
    // Direct interpolants restore constant channels too: an AnimationMixer can retain
    // the previous manually solved pose when a source channel's value has not changed.
    for (const saved of initial) {
      saved.node.position.copy(saved.position); saved.node.quaternion.copy(saved.quaternion); saved.node.scale.copy(saved.scale);
    }
    for (const sampler of samplers) {
      const value = sampler.interpolant.evaluate(time);
      if (sampler.property === "quaternion") sampler.node.quaternion.fromArray(value);
      else if (sampler.property === "position") sampler.node.position.fromArray(value);
      else sampler.node.scale.fromArray(value);
    }
    rig.updateMatrixWorld(true);
  };
  // Preserve source interpolation knots (including its half-cycle foot-roll turn).
  // A uniform grid alone can straddle that knot and add an ankle twist between keys.
  const intervals = Math.round(sourceClip.duration * SAMPLE_HZ);
  const sourceTimes = [...new Set(sourceClip.tracks.flatMap(track => Array.from(track.times)))];
  const uniformTimes = Array.from({ length: intervals + 1 }, (_, index) => sourceClip.duration * index / intervals)
    .filter(time => !sourceTimes.some(sourceTime => Math.abs(sourceTime - time) < 1e-6));
  const times = Float32Array.from([...sourceTimes, ...uniformTimes].sort((a, b) => a - b));
  const frames = times.length - 1;
  const samples: { pelvis: THREE.Vector3; legs: LegPose[] }[] = [];
  for (const time of times) {
    sourcePose(time);
    samples.push({ pelvis: point(pelvis), legs: legs.map(leg => ({ hip: point(leg.hip), knee: point(leg.knee), ankle: point(leg.ankle), ball: point(leg.ball), rotation: rotation(leg.ankle) })) });
  }
  const speeds = legs.map((_, side) => {
    const minimum = Math.min(...samples.map(sample => sample.legs[side]!.ball.y));
    const measured: number[] = [];
    for (let i = 1; i < frames; i++) {
      if (samples[i]!.legs[side]!.ball.y > minimum + .015) continue;
      const speed = -(samples[i + 1]!.legs[side]!.ball.z - samples[i - 1]!.legs[side]!.ball.z) / (times[i + 1]! - times[i - 1]!);
      if (speed > .1) measured.push(speed);
    }
    if (measured.length < 8) throw new Error("Player jog lacks a measurable planted interval");
    return median(measured);
  });
  const sourceNativeMps = (speeds[0]! + speeds[1]!) / 2, strideRatio = targetNativeMps / sourceNativeMps;
  if (strideRatio > 1.01) throw new Error("Player jog bake only supports shortening the source stride");
  const channels = new Map(LEG_NAMES.map(name => [name, new Float32Array(times.length * 4)]));
  let maxIkResidualM = 0, minReachMarginM = Infinity;
  for (let i = 0; i <= frames; i++) {
    sourcePose(times[i]!);
    const sample = samples[i]!;
    for (let side = 0; side < legs.length; side++) {
      const pose = sample.legs[side]!, target = pose.ankle.clone();
      // root has a -90-degree X rotation. Work in the fixed body frame, never
      // by scaling a bone-local Z channel or a rotating pelvis coordinate.
      target.z += (strideRatio - 1) * (pose.ball.z - sample.pelvis.z);
      const solved = solve(legs[side]!, pose, target);
      maxIkResidualM = Math.max(maxIkResidualM, solved.residual);
      minReachMarginM = Math.min(minReachMarginM, solved.margin);
    }
    for (const [name, values] of channels) {
      const q = need(name).quaternion;
      if (i > 0 && q.dot(new THREE.Quaternion().fromArray(values, (i - 1) * 4)) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      q.toArray(values, i * 4);
    }
  }
  const clip = sourceClip.clone();
  clip.tracks = clip.tracks.map(track => {
    if (!REPLACED.has(track.name)) return track;
    const values = channels.get(track.name.slice(0, track.name.lastIndexOf(".")))!;
    const last = values.length - 4;
    const sign = values[0]! * values[last]! + values[1]! * values[last + 1]! + values[2]! * values[last + 2]! + values[3]! * values[last + 3]! < 0 ? -1 : 1;
    for (let c = 0; c < 4; c++) values[last + c] = values[c]! * sign;
    return new THREE.QuaternionKeyframeTrack(track.name, times, values);
  });
  const result: BakedPlayerJog = { clip, diagnostics: { sourceNativeMps, targetNativeMps, strideRatio, sampleCount: times.length, maxIkResidualM, minReachMarginM, elapsedMs: performance.now() - started } };
  const entries = cache.get(sourceClip) ?? new Map<string, BakedPlayerJog>();
  entries.set(key, result); cache.set(sourceClip, entries);
  return result;
}
