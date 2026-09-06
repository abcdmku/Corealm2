import * as THREE from "three";

/** The playback clock belongs to an actor, not to its current render representation. */
export interface CreaturePlayback {
  hitOverlay: { clip: THREE.AnimationClip; time: number; timeScale: number; bones?: readonly string[]; maskStatus?: string } | null;
  clip: THREE.AnimationClip;
  time: number;
  timeScale: number;
  loop: boolean;
  previousClip: THREE.AnimationClip | null;
  previousTime: number;
  previousTimeScale: number;
  previousLoop: boolean;
  transitionSeconds: number;
  transitionElapsed: number;
}

export function playbackTime(time: number, duration: number, loop: boolean): number {
  if (duration <= 0) return 0;
  return loop ? ((time % duration) + duration) % duration : Math.min(duration, Math.max(0, time));
}

export function createCreaturePlayback(
  clip: THREE.AnimationClip, timeScale: number, phase = 0,
): CreaturePlayback {
  return {
    hitOverlay: null,
    clip, time: playbackTime(phase * clip.duration, clip.duration, true), timeScale, loop: true,
    previousClip: null, previousTime: 0, previousTimeScale: 1, previousLoop: true,
    transitionSeconds: 0, transitionElapsed: 0,
  };
}

export function transitionCreaturePlayback(
  state: CreaturePlayback, clip: THREE.AnimationClip, timeScale: number, loop: boolean,
  transitionSeconds: number,
): void {
  state.previousClip = state.clip;
  state.previousTime = state.time;
  state.previousTimeScale = state.timeScale;
  state.previousLoop = state.loop;
  state.transitionSeconds = transitionSeconds;
  state.transitionElapsed = 0;
  state.clip = clip;
  state.time = 0;
  state.timeScale = timeScale;
  state.loop = loop;
}

/** Returns true once a non-looping action reaches its final pose. */
export function advanceCreaturePlayback(state: CreaturePlayback, seconds: number): boolean {
  const delta = Math.max(0, Math.min(0.25, seconds));
  if (state.hitOverlay) {
    state.hitOverlay.time += delta * state.hitOverlay.timeScale;
    if (state.hitOverlay.time >= state.hitOverlay.clip.duration) state.hitOverlay = null;
  }
  const next = state.time + delta * state.timeScale;
  state.time = playbackTime(next, state.clip.duration, state.loop);
  state.transitionElapsed += delta;
  if (state.previousClip) {
    state.previousTime = playbackTime(
      state.previousTime + delta * state.previousTimeScale,
      state.previousClip.duration, state.previousLoop,
    );
    if (state.transitionElapsed >= state.transitionSeconds) state.previousClip = null;
  }
  return !state.loop && next >= state.clip.duration;
}

export function creatureBlend(state: CreaturePlayback): number {
  return state.previousClip && state.transitionSeconds > 0
    ? Math.min(1, state.transitionElapsed / state.transitionSeconds) : 1;
}

/** Missing-content guard: articulated upper-body recoil, with the support limbs left planted. */
export function missingCreatureHit(root: THREE.Object3D, idle: THREE.AnimationClip): THREE.AnimationClip | null {
  const bones: THREE.Bone[] = [];
  root.traverse((node) => {
    if ((node as THREE.Bone).isBone && /chest|spine|neck/i.test(node.name)) bones.push(node as THREE.Bone);
  });
  if (bones.length === 0) return null;
  const seconds = 0.38;
  const times = [0, 0.045, 0.095, 0.18, 0.29, seconds];
  const recoil = [0, 0.8, 1, 0.42, -0.12, 0];
  const clip = THREE.AnimationUtils.subclip(idle, "Hit_Fallback", 0, Math.ceil(seconds * 30), 30);
  clip.duration = seconds;
  for (const bone of bones) {
    const index = clip.tracks.findIndex((track) => track.name === `${bone.name}.quaternion`);
    const original = idle.tracks.find((track) => track.name === `${bone.name}.quaternion`);
    const interpolant = original ? new THREE.QuaternionLinearInterpolant(original.times, original.values, 4) : null;
    const values: number[] = [];
    const angle = (/neck/i.test(bone.name) ? -0.15 : 0.09) / Math.max(1, bones.length / 3);
    for (let i = 0; i < times.length; i += 1) {
      const base = interpolant
        ? new THREE.Quaternion().fromArray(interpolant.evaluate(times[i]!)) : bone.quaternion.clone();
      base.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle * recoil[i]!));
      values.push(base.x, base.y, base.z, base.w);
    }
    const track = new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values);
    if (index >= 0) clip.tracks[index] = track;
    else clip.tracks.push(track);
  }
  return clip;
}
