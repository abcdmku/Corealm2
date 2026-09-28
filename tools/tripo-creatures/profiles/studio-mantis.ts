import type { Document } from '@gltf-transform/core';
import { Matrix4, Vector3 } from 'three';
import { addChannel, applyClip, duration, restorePose, sample, storedPose } from '../../creature-motion/pose.js';
import { deformedBounds } from '../../creature-motion/validate-deformation.js';
import type { CreatureRepairContext, CreatureRepairResult } from '../repairProfile.js';
import { limitGroundCorrectionSpeed, sampleGroundSupport } from '../retarget.js';

export const studioMantisIds = ['creature_gorge_mantis'];

/** Keep the native fall poses, but let changing contacts settle at a finite speed. */
export async function repairStudioMantis(doc: Document, context: CreatureRepairContext): Promise<CreatureRepairResult> {
  if (context.assetId !== 'creature_gorge_mantis') throw new Error('Studio mantis repair requires the verified Gorge Mantis');
  const root = doc.getRoot().listNodes().find(node => node.getName() === 'root');
  const pelvis = doc.getRoot().listNodes().find(node => node.getName() === 'rootx');
  const death = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Death');
  const idle = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Idle');
  if (!root || !pelvis || !death || !idle) throw new Error('Mantis is missing its verified root, pelvis, Idle or Death');
  if (death.getExtras().studioMantisSupport) throw new Error('Mantis support requires the unrepaired source');
  const baseline = storedPose(doc), seconds = duration(death), floor = .003;
  const channels = death.listChannels().map(channel => ({ node: channel.getTargetNode()!,
    path: channel.getTargetPath(), sampler: channel.getSampler()! }));
  const groundChannel = channels.find(channel => channel.node === root && channel.path === 'translation');
  if (!groundChannel || channels.some(channel => channel.sampler.getInterpolation() !== 'LINEAR')) {
    throw new Error('Mantis requires its verified linear root support track');
  }
  const sourceTimes = [...new Set([0, seconds, ...channels.flatMap(channel => Array.from(channel.sampler.getInput()!.getArray()!)),
    ...Array.from({ length: Math.ceil(seconds * 60) + 1 }, (_, index) => Math.fround(index * seconds / Math.ceil(seconds * 60)))])]
    .sort((a, b) => a - b).filter((time, index, times) => !index || time === seconds
      || (time - times[index - 1]! > .00001 && seconds - time > .00001));
  try {
    restorePose(baseline); applyClip(idle, 0);
    const bounds = deformedBounds(doc), bodyHeight = bounds.max[1]! - bounds.min[1]!;
    const maximumSupportSpeedMps = bodyHeight * 1.5;
    restorePose(baseline);
    const parentWorld = new Matrix4().fromArray(root.getParentNode()!.getWorldMatrix());
    const yAxis = new Vector3(0, 1, 0).applyMatrix4(parentWorld).sub(new Vector3().applyMatrix4(parentWorld));
    if (Math.abs(yAxis.x) > 1e-8 || Math.abs(yAxis.z) > 1e-8 || !(yAxis.y > 0)) {
      throw new Error('Mantis support root no longer has its verified world-up basis');
    }
    const cache = new Map<number, number>();
    const ungrounded = (time: number) => {
      const found = cache.get(time); if (found !== undefined) return found;
      restorePose(baseline); applyClip(death, time);
      const local = root.getTranslation();
      if (Math.abs(local[0]) > 1e-6 || Math.abs(local[2]) > 1e-6) throw new Error('Mantis support contains unexpected horizontal travel');
      root.setTranslation([0, 0, 0]);
      const value = floor - deformedBounds(doc).min[1]!;
      cache.set(time, value); return value;
    };
    const refined = sampleGroundSupport(sourceTimes, ungrounded);
    // The shared sampler only refines where the chord would sink. Retiming stretches
    // fast source intervals, so also refine where the linear support would hover.
    const sampleTimes: number[] = [];
    const refineAbove = (left: number, right: number, depth: number): void => {
      const a = ungrounded(left), b = ungrounded(right);
      const hovers = [.25, .5, .75].some(alpha => a * (1 - alpha) + b * alpha - ungrounded(left + (right - left) * alpha) > .002);
      if (depth < 8 && hovers) { refineAbove(left, (left + right) / 2, depth + 1); refineAbove((left + right) / 2, right, depth + 1); }
      else sampleTimes.push(Math.fround(left));
    };
    for (let index = 1; index < refined.times.length; index++) refineAbove(refined.times[index - 1]!, refined.times[index]!, 0);
    sampleTimes.push(Math.fround(refined.times.at(-1)!));
    sampleTimes.splice(0, sampleTimes.length, ...new Set(sampleTimes));
    const required = sampleTimes.map(time => ungrounded(time) + (time > 0 && time < seconds ? .0005 : 0));
    const times = [0];
    for (let index = 1; index < sampleTimes.length; index++) {
      const interval = Math.max(sampleTimes[index]! - sampleTimes[index - 1]!,
        Math.abs(required[index]! - required[index - 1]!) / maximumSupportSpeedMps * 1.002);
      times.push(Math.fround(times[index - 1]! + interval));
    }
    const settledSeconds = times.at(-1)!, timeScale = settledSeconds / seconds;
    if (timeScale > 2) throw new Error(`Mantis contact timing needs excessive retiming: ${timeScale}`);
    const support = limitGroundCorrectionSpeed(times, required, maximumSupportSpeedMps);
    if (Math.abs(support[0]! - required[0]!) > 1e-5 || Math.abs(support.at(-1)! - required.at(-1)!) > 1e-5) {
      throw new Error('Mantis support changes the standing or terminal contact');
    }
    const tracks = channels.map(channel => ({ ...channel, values: sampleTimes.flatMap((time, index) =>
      channel === groundChannel ? [0, support[index]! / yAxis.y, 0] : sample(channel.sampler, time)) }));
    // The final quarter second holds the corpse and cannot interpolate toward Idle.
    times.push(Math.fround(settledSeconds + .25));
    for (const track of tracks) track.values.push(...track.values.slice(-(track.path === 'rotation' ? 4 : 3)));
    for (const channel of [...death.listChannels()]) channel.dispose();
    for (const track of tracks) {
      if (track.path !== 'translation' && track.path !== 'rotation' && track.path !== 'scale') throw new Error('Unsupported mantis pose track');
      addChannel(doc, death, track.node, track.path, times, track.values);
    }
    // Remove the old unreferenced samplers; all articulated values came from them unchanged.
    for (const sampler of [...death.listSamplers()]) if (!death.listChannels().some(channel => channel.getSampler() === sampler)) {
      death.removeSampler(sampler); sampler.dispose();
    }
    death.setExtras({ ...death.getExtras(), studioMantisSupport: 1,
      method: 'Native articulated fall, locally retimed against exact interpolated support; held corpse' });
    return {
      changes: ['Replaced Gorge Mantis Death ground impulses with bounded contact settling and a held corpse; native body poses and other states remain intact.'],
      warnings: ['Requires devdocs playback of the complete retimed fall.'],
      provenance: { source: 'Existing PixeliusVita Monster09 Death body curves', floor, bodyHeight,
        maximumSupportSpeedMps, originalSeconds: seconds, settledSeconds, holdSeconds: .25, timeScale,
        supportSamples: sampleTimes.length, maximumAddedSupport: Math.max(...support.map((value, index) => value - required[index]!)),
        phaseMap: sampleTimes.map((time, index) => [time, times[index]!]),
        preserved: ['Other animation samplers', 'Geometry', 'Skin weights', 'Inverse binds', 'Materials', 'Native articulated Death pose sequence'] },
    };
  } finally { restorePose(baseline); }
}
