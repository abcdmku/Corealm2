import type { Document, Node } from '@gltf-transform/core';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { loadContactHelpers } from '../../calibrate-legacy-gait.js';
import { addChannel, applyClip, duration, removeClip, restorePose, storedPose } from '../../creature-motion/pose.js';
import { deformedBounds } from '../../creature-motion/validate-deformation.js';
import type { CreatureRepairContext, CreatureRepairResult } from '../repairProfile.js';
import { limitGroundCorrectionSpeed, sampleGroundSupport } from '../retarget.js';
import { contactRig } from './studio-animals.js';

export const studioTrollIds = ['creature_troll_mauler'] as const;
const donorId = 'animation_library_1';
const world = (node: Node) => new Matrix4().fromArray(node.getWorldMatrix());
const position = (node: Node) => new Vector3().setFromMatrixPosition(world(node));
const rotation = (node: Node) => {
  const value = new Quaternion(); world(node).decompose(new Vector3(), value, new Vector3()); return value.normalize();
};
const depth = (node: Node): number => node.getParentNode() ? depth(node.getParentNode()!) + 1 : 0;
const lookup = (doc: Document) => (name: string) => {
  const matches = doc.getRoot().listNodes().filter(node => node.getName() === name);
  if (matches.length !== 1) throw new Error(`Expected one Troll motion node ${name}, found ${matches.length}`);
  return matches[0]!;
};
const setWorld = (node: Node, matrix: Matrix4) => {
  const parent = node.getParentNode();
  node.setMatrix((parent ? world(parent).invert().multiply(matrix) : matrix).toArray());
};
const setPosition = (node: Node, value: Vector3) => {
  const parent = node.getParentNode(); node.setTranslation((parent ? value.applyMatrix4(world(parent).invert()) : value).toArray());
};
const setRotation = (node: Node, value: Quaternion) => {
  const parent = node.getParentNode(); node.setRotation((parent ? rotation(parent).invert().multiply(value) : value).normalize().toArray());
};

/** Recover the actual skin rest; the exported default may be an evaluated action pose. */
function prepareBind(doc: Document) {
  const matrices = new Map<Node, Matrix4>();
  for (const node of doc.getRoot().listNodes()) {
    const skin = node.getSkin(); if (!skin) continue;
    const inverse = skin.getInverseBindMatrices(); if (!inverse) throw new Error('Troll source lacks inverse binds');
    skin.listJoints().forEach((joint, index) => {
      const matrix = world(node).multiply(new Matrix4().fromArray(inverse.getElement(index, [])).invert());
      const previous = matrices.get(joint);
      if (previous && previous.elements.some((value, i) => Math.abs(value - matrix.elements[i]!) > .0001)) {
        throw new Error(`Conflicting Troll bind ${joint.getName()}`);
      }
      matrices.set(joint, matrix);
    });
  }
  for (const [joint, matrix] of [...matrices].sort((a, b) => depth(a[0]) - depth(b[0]))) setWorld(joint, matrix);
}

type Track = { t: number[]; r: number[]; s: number[] };

/** Original biped skin with independent, skin-weighted foot and knee controls. */
export async function repairStudioTroll(doc: Document, context: CreatureRepairContext): Promise<CreatureRepairResult> {
  if (context.assetId !== 'creature_troll_mauler') throw new Error(`Unsupported Troll ${context.assetId}`);
  const donor = await context.readAsset(donorId), target = lookup(doc), source = lookup(donor);
  const original = storedPose(doc), sourceOriginal = storedPose(donor);
  const idle = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Idle');
  if (!idle) throw new Error('Troll native Idle is required');
  const ground = target('troll_mauler_ground');
  if (ground.getRotation().some((value, index) => Math.abs(value - (index === 3 ? 1 : 0)) > 1e-6)
    || ground.getScale().some(value => Math.abs(value - 1) > 1e-6)) throw new Error('Troll ground must retain its identity basis');
  prepareBind(doc); prepareBind(donor);
  const donorIdle = donor.getRoot().listAnimations().find(clip => clip.getName() === 'Idle_Loop');
  if (!donorIdle) throw new Error('Troll transfer requires the native studio standing reference');
  applyClip(idle, 0); applyClip(donorIdle, 0);
  ground.setTranslation([0, 0, 0]);
  const baseline = storedPose(doc), sourceBind = storedPose(donor);
  const initialBounds = deformedBounds(doc), height = initialBounds.max[1]! - initialBounds.min[1]!;
  const targetRoot = target('Bone004'), donorRoot = source('pelvis');
  const targetRootStart = position(targetRoot), sourceRootStart = position(donorRoot);
  const map: Record<string, string> = {
    Bone004: 'pelvis', Bone: 'pelvis', Bone001: 'spine_01', Bone002: 'spine_03', Bone003: 'Head',
  };
  const directions: Record<string, string> = { Bone: 'Bone001', Bone001: 'Bone002', Bone002: 'Bone003' };
  for (const [side, suffix] of [['L', 'l'], ['R', 'r']] as const) {
    for (const [name, from] of [['shoulder', 'clavicle'], ['arm', 'upperarm'], ['forearm', 'lowerarm'],
      ['hand', 'hand'], ['thigh', 'thigh'], ['shin', 'calf'], ['foot', 'foot'], ['foot_tip', 'ball']] as const) map[name + side] = `${from}_${suffix}`;
    for (const [name, child] of [['shoulder', 'arm'], ['arm', 'forearm'], ['forearm', 'hand'],
      ['thigh', 'shin'], ['shin', 'foot'], ['foot', 'foot_tip']] as const) directions[name + side] = child + side;
  }
  if (!(position(target('thighL')).x > position(target('thighR')).x
    && position(source('thigh_l')).x > position(source('thigh_r')).x
    && position(target('foot_tipL')).z > position(target('footL')).z
    && position(source('ball_l')).z > position(source('foot_l')).z)) {
    throw new Error('Troll retarget requires verified +Z facing and left-positive-X anatomy');
  }
  const pairs = Object.entries(map).map(([name, from]) => {
    const node = target(name), donorNode = source(from), targetBind = rotation(node), donorBind = rotation(donorNode);
    const child = directions[name];
    if (child) {
      const a = position(target(child)).sub(position(node)), b = position(source(map[child]!)).sub(position(donorNode));
      if (a.lengthSq() < 1e-10 || b.lengthSq() < 1e-10) throw new Error(`Troll anatomical segment is degenerate: ${name}`);
      // Both rigs have a genuine relaxed standing pose. Keep the Troll's bowed
      // legs and down-arm anatomy, transferring the donor's change from that pose.
      // Aligning this broad creature to the human bind straightens its native legs.
    }
    return { node, donorNode, offset: donorBind.invert().multiply(targetBind) };
  }).sort((a, b) => depth(a.node) - depth(b.node));
  const followers = (['L', 'R'] as const).flatMap(side => [
    ['foot_main', 'foot'], ['roll_IK', 'foot'], ['sole_inverse', 'foot'],
    ['pole', 'shin'], ['sole', 'foot_tip'], ['foot_IK', 'foot'],
  ].map(([name, driver]) => {
    const node = target(name! + side), bone = target(driver! + side);
    return { node, bone, offset: world(bone).invert().multiply(world(node)) };
  })).sort((a, b) => depth(a.node) - depth(b.node));
  const length = (get: (name: string) => Node, a: string, b: string, c: string) =>
    position(get(a)).distanceTo(position(get(b))) + position(get(b)).distanceTo(position(get(c)));
  const scale = length(target, 'thighL', 'shinL', 'footL') / length(source, 'thigh_l', 'calf_l', 'foot_l');
  const takes = [
    { name: 'Walk', source: 'Walk_Loop', seconds: 1.6, loop: true },
    { name: 'Run', source: 'Jog_Fwd_Loop', seconds: 1.1, loop: true },
    { name: 'Attack', source: 'Punch_Jab', seconds: 1.25, loop: false },
    { name: 'Hit', source: 'Hit_Chest', seconds: .7, loop: false },
    { name: 'Death', source: 'Death01', seconds: 1.6, loop: false },
  ];
  const reports = [];
  let contactNormalized = .5;
  try {
    for (const take of takes) {
      const native = donor.getRoot().listAnimations().find(clip => clip.getName() === take.source);
      if (!native) throw new Error(`Missing studio Troll source ${take.source}`);
      const nativeSeconds = duration(native), steps = Math.ceil(take.seconds * 90);
      const times = Array.from({ length: steps + 1 }, (_, frame) => Math.fround(frame * take.seconds / steps));
      const tracks = new Map<Node, Track>(baseline.map(pose => [pose.node, { t: [], r: [], s: [] }]));
      restorePose(sourceBind); applyClip(native, 0); const firstRoot = position(donorRoot);
      restorePose(sourceBind); applyClip(native, nativeSeconds); const lastRoot = position(donorRoot);
      const reaches: number[] = [];
      for (let frame = 0; frame <= steps; frame++) {
        const phase = frame / steps;
        restorePose(baseline); restorePose(sourceBind); applyClip(native, nativeSeconds * phase);
        for (const pair of pairs) setRotation(pair.node, rotation(pair.donorNode).multiply(pair.offset));
        const displacement = position(donorRoot).sub(sourceRootStart).multiplyScalar(scale);
        if (take.loop) {
          const travel = firstRoot.clone().lerp(lastRoot, phase).sub(sourceRootStart).multiplyScalar(scale);
          displacement.x -= travel.x; displacement.z -= travel.z;
        }
        setPosition(targetRoot, targetRootStart.clone().add(displacement));
        for (const follower of followers) setWorld(follower.node, world(follower.bone).multiply(follower.offset));
        ground.setTranslation([0, 0, 0]);
        for (const pose of baseline) {
          const values = tracks.get(pose.node)!;
          values.t.push(...pose.node.getTranslation()); values.r.push(...pose.node.getRotation()); values.s.push(...pose.node.getScale());
        }
        if (take.name === 'Attack') reaches.push(Math.max(position(target('handL')).z, position(target('handR')).z) - position(target('Bone002')).z);
      }
      if (take.loop) for (const values of tracks.values()) {
        values.t.splice(-3, 3, ...values.t.slice(0, 3)); values.r.splice(-4, 4, ...values.r.slice(0, 4)); values.s.splice(-3, 3, ...values.s.slice(0, 3));
      }
      removeClip(doc, take.name);
      const clip = doc.createAnimation(take.name).setExtras({ sourceAssetId: donorId, sourceTake: take.source,
        method: 'Native standing-reference studio transfer with weighted FK-control followers and evaluated interpolated support' });
      for (const [node, values] of tracks) {
        addChannel(doc, clip, node, 'translation', times, values.t);
        addChannel(doc, clip, node, 'rotation', times, values.r);
        addChannel(doc, clip, node, 'scale', times, values.s);
      }
      // Evaluate exactly what glTF will interpolate, including Float32 rotations,
      // follower transforms and loop closure. The support callback excludes itself.
      const groundChannel = clip.listChannels().find(channel => channel.getTargetNode() === ground && channel.getTargetPath() === 'translation')!;
      const sampled = sampleGroundSupport(times, time => {
        restorePose(baseline); applyClip(clip, time); ground.setTranslation([0, 0, 0]);
        return .001 - deformedBounds(doc).min[1]!;
      });
      let corrections: number[];
      if (take.loop) {
        const seconds = times.at(-1)!, repeatedTimes: number[] = [], repeatedRequired: number[] = [];
        for (const cycle of [-1, 0, 1]) for (let index = 0; index < sampled.times.length - 1; index++) {
          repeatedTimes.push(sampled.times[index]! + cycle * seconds); repeatedRequired.push(sampled.required[index]!);
        }
        repeatedTimes.push(2 * seconds); repeatedRequired.push(sampled.required[0]!);
        const limited = limitGroundCorrectionSpeed(repeatedTimes, repeatedRequired, height);
        const start = sampled.times.length - 1;
        corrections = limited.slice(start, start + sampled.times.length);
        corrections[corrections.length - 1] = corrections[0]!;
      } else {
        corrections = limitGroundCorrectionSpeed(sampled.times, sampled.required, height);
        if (Math.abs(corrections.at(-1)! - sampled.required.at(-1)!) > .000001) {
          throw new Error(`Troll ${take.name} support envelope changes the final contact pose`);
        }
      }
      const input = groundChannel.getSampler()!.getInput()!.clone().setArray(Float32Array.from(sampled.times));
      const output = groundChannel.getSampler()!.getOutput()!.clone().setArray(Float32Array.from(corrections.flatMap(value => [0, value, 0])));
      groundChannel.getSampler()!.setInput(input).setOutput(output);
      if (take.name === 'Death') {
        const heldEnd = Math.fround(take.seconds + .5);
        for (const sampler of clip.listSamplers()) {
          const oldInput = sampler.getInput()!, oldOutput = sampler.getOutput()!, width = oldOutput.getElementSize();
          sampler.setInput(oldInput.clone().setArray(Float32Array.from([...oldInput.getArray()!, heldEnd])));
          sampler.setOutput(oldOutput.clone().setArray(Float32Array.from([...oldOutput.getArray()!, ...oldOutput.getArray()!.slice(-width)])));
        }
      }
      let minimumFloor = Infinity;
      for (let frame = 0; frame <= 960; frame++) {
        restorePose(baseline); applyClip(clip, duration(clip) * frame / 960);
        minimumFloor = Math.min(minimumFloor, deformedBounds(doc).min[1]!);
      }
      if (minimumFloor < -.00025) throw new Error(`Troll ${take.name} penetrates floor: ${minimumFloor}`);
      if (reaches.length) contactNormalized = reaches.indexOf(Math.max(...reaches)) / steps;
      reports.push({ name: take.name, sourceTake: take.source, seconds: duration(clip), sourceSeconds: nativeSeconds,
        supportSamples: sampled.times.length, maximumAddedSupport: Math.max(...corrections.map((value, index) => value - sampled.required[index]!)),
        groundingMaxSpeedMps: height, minimumFloor, heldSeconds: take.name === 'Death' ? .5 : 0 });
    }
  } finally { restorePose(original); restorePose(sourceOriginal); }
  removeClip(doc, 'HitLeft'); removeClip(doc, 'HitRight');
  const { measureContactGait } = await loadContactHelpers(), rig = contactRig(doc);
  const contacts = ['Walk', 'Run'].map(name => ({ name, measurement: measureContactGait(rig.root,
    rig.clips.find(clip => clip.name === name), { samples: 1920, axis: 'z', direction: 1,
      groups: [['footL', 'foot_tipL'], ['footR', 'foot_tipR']], heightM: .03 }) }));
  if (contacts.some(row => !(row.measurement.speedMps && row.measurement.speedMps > 0))) throw new Error('Troll gait lacks measurable backward contact');
  return {
    changes: ['Replaced the five experimental Troll motions with articulated studio biped takes while preserving native Idle.',
      'Kept skin-weighted foot and knee controls attached to the corresponding FK anatomy; geometry, original weights and materials remain intact.'],
    provenance: { donorAssetId: donorId, mappedJoints: pairs.length, controlFollowers: followers.length, translationScale: scale,
      clips: reports, preservedNativeClips: ['Idle'], geometryAndSkinWeightsUnchanged: true,
      contacts: contacts.map(({ name, measurement }) => ({ name, speedMps: measurement.speedMps, method: measurement.method })),
      requiresDevdocsReview: true },
    motion: { walkClipSeconds: 1.6, runClipSeconds: 1.1, attackSeconds: 1.25, contactNormalized,
      impliedWalkMps: contacts[0]!.measurement.speedMps!, impliedRunMps: contacts[1]!.measurement.speedMps!, groundY: .001 },
  };
}
