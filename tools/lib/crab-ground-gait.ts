/** Offline +Z locomotion for the imported crab's eight walking legs. */
import type { AnimationChannel, Document, Node } from '@gltf-transform/core';
import { Quaternion, Vector3 } from 'three';
import { duration, restorePose, sample, storedPose } from '../creature-motion/pose.js';
import {
  captureTracks, createSkinReader, cyclicFootPath, fract,
  setWorldPosition, setWorldQuaternion, worldPosition, worldQuaternion,
  type BakedGait, type BakedTrack, type ContactFoot, type SkinReader,
} from './ground-gait.js';

const FOOT_CLEARANCE = .0005;
const FOOT_INSET = .015;
const CLOSURE_START = .85;
const LEG_SPECS = [
  { root: 'Bone020', middle: 'Bone021', terminal: 'Bone022', vertex: 1153, phaseOffset: 0 },
  { root: 'Bone023', middle: 'Bone024', terminal: 'Bone025', vertex: 1152, phaseOffset: .5 },
  { root: 'Bone026', middle: 'Bone027', terminal: 'Bone028', vertex: 1154, phaseOffset: 0 },
  { root: 'Bone029', middle: 'Bone030', terminal: 'Bone031', vertex: 1155, phaseOffset: .5 },
  { root: 'Bone020(mirrored)', middle: 'Bone021(mirrored)', terminal: 'Bone022(mirrored)', vertex: 692, phaseOffset: .5 },
  { root: 'Bone023(mirrored)', middle: 'Bone024(mirrored)', terminal: 'Bone025(mirrored)', vertex: 691, phaseOffset: 0 },
  { root: 'Bone026(mirrored)', middle: 'Bone027(mirrored)', terminal: 'Bone028(mirrored)', vertex: 693, phaseOffset: .5 },
  { root: 'Bone029(mirrored)', middle: 'Bone030(mirrored)', terminal: 'Bone031(mirrored)', vertex: 694, phaseOffset: 0 },
] as const;

type Leg = {
  root: Node; middle: Node; terminal: Node; vertex: number; phaseOffset: number;
  center: Vector3; pole: Vector3; upperLength: number; lowerLength: number;
};
type SourceChannel = {
  channel: AnimationChannel; node: Node; path: BakedTrack['path'];
  start: number[]; initialNext: number[]; initialSpan: number;
};

function requiredNode(doc: Document, name: string): Node {
  const matches = doc.getRoot().listNodes().filter(node => node.getName() === name);
  if (matches.length !== 1) throw new Error(`Crab gait requires one ${name}; found ${matches.length}`);
  return matches[0]!;
}

function setChannel(node: Node, path: BakedTrack['path'], values: number[]): void {
  if (path === 'rotation') node.setRotation(values as [number, number, number, number]);
  else if (path === 'translation') node.setTranslation(values as [number, number, number]);
  else node.setScale(values as [number, number, number]);
}

/** Close the source claws onto their initial pose and velocity over the last 15%. */
function applyClosedSource(channels: SourceChannel[], elapsed: number, seconds: number, phase: number): void {
  const t = Math.max(0, Math.min(1, (phase - CLOSURE_START) / (1 - CLOSURE_START)));
  const weight = t * t * t * (10 - 15 * t + 6 * t * t);
  for (const { channel, node, path, start, initialNext, initialSpan } of channels) {
    const values = sample(channel.getSampler()!, elapsed);
    const backwards = (elapsed - seconds) / initialSpan;
    if (path === 'rotation') {
      const startQ = new Quaternion().fromArray(start).normalize();
      const initialQ = new Quaternion().fromArray(initialNext).normalize();
      if (startQ.dot(initialQ) < 0) initialQ.set(-initialQ.x, -initialQ.y, -initialQ.z, -initialQ.w);
      const initialDelta = startQ.clone().invert().multiply(initialQ).normalize();
      // Negative interpolation extrapolates the first source segment backward.
      // The endpoint then has the same local angular velocity as the first key.
      const closingQ = startQ.multiply(new Quaternion().slerp(initialDelta, backwards));
      const q = new Quaternion().fromArray(values).normalize();
      q.slerp(closingQ, weight).normalize();
      node.setRotation(q.toArray());
    } else {
      setChannel(node, path, values.map((value, axis) => {
        const closing = start[axis]! + (initialNext[axis]! - start[axis]!) * backwards;
        return value + weight * (closing - value);
      }));
    }
  }
}

/** The fixed terminal local transform makes even the blended tip a rigid middle-joint point. */
function solvePhysicalTip(leg: Leg, skin: SkinReader, target: Vector3): { error: number; extensionMargin: number; foldMargin: number } {
  const rootPosition = worldPosition(leg.root), middlePosition = worldPosition(leg.middle);
  const originalTip = skin.point(leg.vertex);
  const axis = target.clone().sub(rootPosition), distance = axis.length();
  const upperLength = rootPosition.distanceTo(middlePosition), lowerLength = middlePosition.distanceTo(originalTip);
  const extensionMargin = upperLength + lowerLength - distance;
  const foldMargin = distance - Math.abs(upperLength - lowerLength);
  if (distance < 1e-9 || extensionMargin < 1e-6 || foldMargin < 1e-6) {
    throw new Error(`Crab ${leg.root.getName()} target is unreachable: extension ${extensionMargin}, fold ${foldMargin}`);
  }
  axis.normalize();
  const bend = leg.pole.clone().addScaledVector(axis, -leg.pole.dot(axis));
  if (bend.lengthSq() < 1e-10) throw new Error(`Crab ${leg.root.getName()} has a degenerate pole`);
  bend.normalize();
  const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance);
  const kneeHeight = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  const desiredMiddle = rootPosition.clone().addScaledVector(axis, along).addScaledVector(bend, kneeHeight);

  const upperRotation = new Quaternion().setFromUnitVectors(
    middlePosition.clone().sub(rootPosition).normalize(), desiredMiddle.clone().sub(rootPosition).normalize(),
  ).multiply(worldQuaternion(leg.root));
  setWorldQuaternion(leg.root, upperRotation);

  const posedMiddle = worldPosition(leg.middle), posedTip = skin.point(leg.vertex);
  const lowerRotation = new Quaternion().setFromUnitVectors(
    posedTip.sub(posedMiddle).normalize(), target.clone().sub(posedMiddle).normalize(),
  ).multiply(worldQuaternion(leg.middle));
  setWorldQuaternion(leg.middle, lowerRotation);
  return { error: skin.point(leg.vertex).distanceTo(target), extensionMargin, foldMargin };
}

function finishTracks(tracks: BakedTrack[]): BakedTrack[] {
  for (const track of tracks) {
    const width = track.path === 'rotation' ? 4 : 3;
    // Close every target, including source channels with exporter endpoint noise.
    for (let component = 0; component < width; component++) {
      track.values[track.values.length - width + component] = track.values[component]!;
    }
    if (track.path === 'rotation') {
      let previous: Quaternion | undefined;
      for (let index = 0; index < track.values.length; index += 4) {
        const q = new Quaternion().fromArray(track.values, index).normalize();
        if (previous && previous.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        q.toArray(track.values, index); previous = q;
      }
    }
    const constant = track.values.every((value, index) => value === track.values[index % width]);
    if (constant) {
      track.times = [track.times[0]!, track.times.at(-1)!];
      track.values = [...track.values.slice(0, width), ...track.values.slice(0, width)];
    }
    if (![...track.times, ...track.values].every(Number.isFinite)) throw new Error(`Nonfinite crab track ${track.node.getName()}.${track.path}`);
  }
  return tracks;
}

export function authorCrabGait(doc: Document, name: 'Walk' | 'Run', seconds: number, floorY: number): BakedGait {
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(floorY)) throw new Error('Crab gait requires finite duration and floor');
  const clip = doc.getRoot().listAnimations().find(animation => animation.getName() === name);
  if (!clip || Math.abs(duration(clip) - seconds) > 1e-6) throw new Error(`Crab ${name} source duration changed`);
  const restPose = storedPose(doc);
  try {
    const bodyRoot = requiredNode(doc, 'Bone001'), body = requiredNode(doc, 'Bone002');
    if (body.getParentNode() !== bodyRoot) throw new Error('Crab body hierarchy changed');
    const skin = createSkinReader(doc, 'crab_exp8');
    const nativeMps = (name === 'Walk' ? .5 : 1.3) / 4.6;
    const duty = name === 'Walk' ? .66 : .58;
    const lift = name === 'Walk' ? .012 : .018;
    const bob = name === 'Walk' ? .001 : .0015;
    // These are offline keys. Run needs finer quaternion interpolation near touchdown.
    const samplesPerSecond = name === 'Walk' ? 480 : 960;
    const bodyPosition = worldPosition(body);
    const legs: Leg[] = LEG_SPECS.map(spec => {
      const root = requiredNode(doc, spec.root), middle = requiredNode(doc, spec.middle), terminal = requiredNode(doc, spec.terminal);
      if (root.getParentNode() !== body || middle.getParentNode() !== root || terminal.getParentNode() !== middle) {
        throw new Error(`Crab walking hierarchy changed at ${spec.root}`);
      }
      if (spec.vertex >= skin.count) throw new Error(`Crab physical tip vertex ${spec.vertex} is absent`);
      const influences = skin.influences(spec.vertex);
      if (influences.some(influence => influence.node !== middle && influence.node !== terminal)
        || Math.abs(influences.reduce((sum, influence) => sum + influence.weight, 0) - 1) > 1e-6) {
        throw new Error(`Crab physical tip ${spec.vertex} is not rigid beneath ${spec.middle}`);
      }
      const hip = worldPosition(root), knee = worldPosition(middle), tip = skin.point(spec.vertex);
      const axis = tip.clone().sub(hip).normalize(), pole = knee.clone().sub(hip);
      pole.addScaledVector(axis, -pole.dot(axis));
      if (pole.lengthSq() < 1e-10) throw new Error(`Crab rest pole is degenerate at ${spec.root}`);
      const center = tip.clone(); center.x -= Math.sign(center.x) * FOOT_INSET; center.y = floorY + FOOT_CLEARANCE;
      return { ...spec, root, middle, terminal, center, pole: pole.normalize(), upperLength: hip.distanceTo(knee), lowerLength: knee.distanceTo(tip) };
    });
    const fixedNodes = new Set([bodyRoot, body, ...legs.flatMap(leg => [leg.root, leg.middle, leg.terminal])]);
    const fixedPose = restPose.filter(pose => fixedNodes.has(pose.node));
    for (const { node, s } of fixedPose) {
      if (s.some(value => value <= 0) || Math.max(...s) - Math.min(...s) > Math.max(...s) * 1e-5) {
        throw new Error(`Crab ${node.getName()} requires positive uniform local scale`);
      }
    }

    const source: SourceChannel[] = clip.listChannels().map(channel => {
      const path = channel.getTargetPath();
      if (path !== 'rotation' && path !== 'translation' && path !== 'scale') throw new Error(`Unsupported crab channel ${path}`);
      const node = channel.getTargetNode();
      if (!node) throw new Error('Crab source channel has no target');
      const sampler = channel.getSampler()!;
      const input = Array.from(sampler.getInput()!.getArray()!, Number);
      // Some constant exporter channels have their sole key after zero. Sampling
      // the first positive key still gives their correct zero initial velocity.
      const start = sample(sampler, 0), initialSpan = input.find(time => time > 0) ?? seconds;
      const initialNext = sampler.getInterpolation() === 'STEP' ? start : sample(sampler, initialSpan);
      return { channel, node, path, start, initialNext, initialSpan };
    });
    const specs: { node: Node; path: BakedTrack['path'] }[] = [];
    const seen = new Set<string>();
    const addSpec = (node: Node, path: BakedTrack['path']): void => {
      const key = `${node.getName()}.${path}`;
      if (!seen.has(key)) { seen.add(key); specs.push({ node, path }); }
    };
    source.forEach(({ node, path }) => addSpec(node, path));
    addSpec(body, 'translation'); addSpec(body, 'rotation');
    for (const leg of legs) for (const node of [leg.root, leg.middle, leg.terminal]) {
      addSpec(node, 'rotation'); addSpec(node, 'translation'); addSpec(node, 'scale');
    }
    const sampleCount = Math.ceil(seconds * samplesPerSecond);
    const rawTimes = [0, seconds, ...Array.from({ length: sampleCount - 1 }, (_, index) => seconds * (index + 1) / sampleCount)];
    for (const leg of legs) rawTimes.push(leg.phaseOffset * seconds, fract(leg.phaseOffset + duty) * seconds);
    if (name === 'Run') {
      // A tip stays within a micrometre of its contact plane immediately before
      // touchdown. Refine these quaternion chords, including both loop sides,
      // so interpolation follows the solved tip there as closely as in stance.
      const transitions = new Set(legs.flatMap(leg => [leg.phaseOffset, fract(leg.phaseOffset + duty)]));
      for (const transition of transitions) for (let offset = -16; offset <= 16; offset++) {
        rawTimes.push(fract(transition + offset / (1920 * seconds)) * seconds);
      }
    }
    for (const { channel } of source) rawTimes.push(...Array.from(channel.getSampler()!.getInput()!.getArray()!, Number));
    // Float32 key times are the export contract. Deduplicate after rounding.
    const times = [...new Set(rawTimes.map(time => Math.fround(Math.max(0, Math.min(seconds, time)))))].sort((a, b) => a - b);
    const poses: number[][][] = [];
    let maximumTipErrorM = 0, minimumExtensionMarginM = Infinity, minimumFoldMarginM = Infinity;
    for (const time of times) {
      const phase = Math.min(1, time / seconds);
      restorePose(restPose);
      applyClosedSource(source, time, seconds, phase);
      restorePose(fixedPose);
      setWorldPosition(body, bodyPosition.clone().add(new Vector3(0, bob * Math.cos(4 * Math.PI * phase), 0)));
      for (const leg of legs) {
        const path = cyclicFootPath(phase - leg.phaseOffset, duty, seconds, nativeMps, lift);
        const target = leg.center.clone().add(new Vector3(0, path.y, path.z));
        const solved = solvePhysicalTip(leg, skin, target);
        maximumTipErrorM = Math.max(maximumTipErrorM, solved.error);
        minimumExtensionMarginM = Math.min(minimumExtensionMarginM, solved.extensionMargin);
        minimumFoldMarginM = Math.min(minimumFoldMarginM, solved.foldMargin);
      }
      poses.push(specs.map(({ node, path }) => path === 'rotation' ? node.getRotation() : path === 'translation' ? node.getTranslation() : node.getScale()));
    }
    if (maximumTipErrorM > 1e-6) throw new Error(`Crab physical-tip solve error ${maximumTipErrorM} m`);
    const tracks = finishTracks(captureTracks(specs, times, poses));
    const feet: ContactFoot[] = legs.map(leg => ({
      name: leg.terminal.getName(), vertices: skin.indicesForBranches([leg.root.getName()], Infinity),
      primaryVertices: [leg.vertex], phaseOffset: leg.phaseOffset, duty, clearance: FOOT_CLEARANCE,
    }));
    return {
      name, seconds, nativeMps, tracks, feet,
      notes: [
        'Eight physical mesh tips alternate in two four-foot groups; every planted tip travels in -Z at the same native speed.',
        'Root and middle rotations target the actual weighted tip. Fixed terminal local transforms also preserve the blended vertex 691.',
        'Rest body orientation, 15 mm inward footprint shift, original cadence, and small twice-per-cycle body bob.',
        'Original claw channels retain their first 85%; a quintic blend closes the final segment onto the initial pose and velocity.',
        'All source document transforms are restored. No mesh, material, skin, hierarchy or source animation data is changed.',
        'A straight authored cycle does not lock feet during runtime turning, changing speed or crossfades.',
      ],
      diagnostics: {
        mesh: 'crab_exp8', samplesPerSecond, sampledKeys: times.length,
        contactSamplesPerSecond: name === 'Run' ? 1920 : samplesPerSecond,
        contactRefinementHalfWindowSeconds: name === 'Run' ? 16 / 1920 : 0,
        floorY, contactY: floorY + FOOT_CLEARANCE, footprintInsetM: FOOT_INSET,
        plantedSweepM: nativeMps * seconds * duty, swingLiftM: lift, bodyBobAmplitudeM: bob,
        maximumTipErrorM, minimumExtensionMarginM, minimumFoldMarginM,
        reference: legs.map(leg => ({ root: leg.root.getName(), middle: leg.middle.getName(), terminal: leg.terminal.getName(),
          tipVertex: leg.vertex, center: leg.center.toArray(), pole: leg.pole.toArray(), upperLengthM: leg.upperLength, effectiveLowerLengthM: leg.lowerLength })),
      },
    };
  } finally {
    restorePose(restPose);
  }
}
