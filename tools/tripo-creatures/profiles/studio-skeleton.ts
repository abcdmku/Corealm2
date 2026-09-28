import { createHash } from 'node:crypto';
import type { Animation, Document, Node } from '@gltf-transform/core';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { addChannel, applyClip, duration, removeClip, restorePose, storedPose } from '../../creature-motion/pose.js';
import { deformedBounds } from '../../creature-motion/validate-deformation.js';
import type { CreatureRepairContext, CreatureRepairResult } from '../repairProfile.js';
import { limitGroundCorrectionSpeed, sampleGroundSupport } from '../retarget.js';

export const studioSkeletonIds = ['soldier', 'archer', 'mage'].flatMap(role =>
  [`creature_skeleton_${role}`, `creature_skeleton_${role}_elite`]);
const donorId = 'animation_library_1';
const preservedNames = ['Idle', 'Walk', 'Run', 'Attack', 'Hit'];
const world = (node: Node) => new Matrix4().fromArray(node.getWorldMatrix());
const position = (node: Node) => new Vector3().setFromMatrixPosition(world(node));
const rotation = (node: Node) => {
  const value = new Quaternion(); world(node).decompose(new Vector3(), value, new Vector3()); return value.normalize();
};
const depth = (node: Node): number => node.getParentNode() ? depth(node.getParentNode()!) + 1 : 0;
const lookup = (doc: Document) => (name: string) => {
  const matches = doc.getRoot().listNodes().filter(node => node.getName() === name);
  if (matches.length !== 1) throw new Error(`Expected one Skeleton motion node ${name}, found ${matches.length}`);
  return matches[0]!;
};
const setRotation = (node: Node, value: Quaternion) => {
  const parent = node.getParentNode();
  node.setRotation((parent ? rotation(parent).invert().multiply(value) : value).normalize().toArray());
};
const setPosition = (node: Node, value: Vector3) => {
  const parent = node.getParentNode();
  node.setTranslation((parent ? value.applyMatrix4(world(parent).invert()) : value).toArray());
};
const clipDigest = (clip: Animation) => createHash('sha256').update(JSON.stringify({ name: clip.getName(), extras: clip.getExtras(),
  channels: clip.listChannels().map(channel => {
    const sampler = channel.getSampler()!;
    const accessor = (value: NonNullable<ReturnType<typeof sampler.getInput>>) => ({ name: value.getName(), type: value.getType(),
      componentType: value.getComponentType(), normalized: value.getNormalized(), extras: value.getExtras(), values: Array.from(value.getArray()!) });
    return { name: channel.getName(), node: channel.getTargetNode()!.getName(), path: channel.getTargetPath(), extras: channel.getExtras(),
      samplerName: sampler.getName(), interpolation: sampler.getInterpolation(), samplerExtras: sampler.getExtras(), input: accessor(sampler.getInput()!), output: accessor(sampler.getOutput()!) };
  }) })).digest('hex');
type Track = { t: number[]; r: number[]; s: number[] };

/** Replace only the old root-only collapse; keep the original five states and skin. */
export async function repairStudioSkeleton(doc: Document, context: CreatureRepairContext): Promise<CreatureRepairResult> {
  if (!studioSkeletonIds.includes(context.assetId)) throw new Error(`Unsupported Skeleton ${context.assetId}`);
  const donor = await context.readAsset(donorId), target = lookup(doc), source = lookup(donor);
  const original = storedPose(doc), sourceOriginal = storedPose(donor);
  const preserved = preservedNames.map(name => {
    const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === name);
    if (!clip) throw new Error(`Skeleton requires preserved ${name}`);
    return { clip, name, sha256: clipDigest(clip) };
  });
  const idle = preserved[0]!.clip;
  const donorIdle = donor.getRoot().listAnimations().find(clip => clip.getName() === 'Idle_Loop');
  const native = donor.getRoot().listAnimations().find(clip => clip.getName() === 'Death01');
  if (!donorIdle || !native) throw new Error('Skeleton transfer requires UAL1 Idle_Loop and Death01');
  const ground = target('SkeletonGround');
  const parentWorld = ground.getParentNode() ? world(ground.getParentNode()!) : new Matrix4();
  const parentScale = parentWorld.elements[0]!;
  const expectedParent = new Matrix4().makeScale(parentScale, parentScale, parentScale);
  if (!(parentScale > 0) || parentWorld.elements.some((value, index) => Math.abs(value - expectedParent.elements[index]!) > 1e-5)
    || ground.getScale().some(value => Math.abs(value - 1) > 1e-5)
    || ground.getRotation().some((value, index) => Math.abs(value - (index === 3 ? 1 : 0)) > 1e-5)) {
    throw new Error('Skeleton ground requires its verified world-aligned uniform basis');
  }
  applyClip(idle, 0); applyClip(donorIdle, 0); ground.setTranslation([0, 0, 0]);
  const baseline = storedPose(doc), sourceBaseline = storedPose(donor);
  const bounds = deformedBounds(doc), height = bounds.max[1]! - bounds.min[1]!;
  const targetRoot = target('Bip001'), donorRoot = source('pelvis');
  const targetRootStart = position(targetRoot), sourceRootStart = position(donorRoot);
  const mapping: Record<string, string> = {
    Bip001: 'pelvis', Bip001_Pelvis: 'pelvis', Bip001_Spine: 'spine_01',
    Bip001_Spine1: 'spine_03', Bip001_Neck: 'neck_01', Bip001_Head: 'Head',
  };
  const directions: Record<string, [string, string]> = {
    Bip001_Pelvis: ['Bip001_Spine', 'spine_01'], Bip001_Spine: ['Bip001_Spine1', 'spine_03'],
    Bip001_Spine1: ['Bip001_Neck', 'neck_01'], Bip001_Neck: ['Bip001_Head', 'Head'],
  };
  for (const [side, suffix] of [['L', 'l'], ['R', 'r']] as const) {
    for (const [name, from] of [['Clavicle', 'clavicle'], ['UpperArm', 'upperarm'], ['Forearm', 'lowerarm'],
      ['Hand', 'hand'], ['Thigh', 'thigh'], ['Calf', 'calf'], ['Foot', 'foot'], ['Toe0', 'ball']] as const) {
      mapping[`Bip001_${side}_${name}`] = `${from}_${suffix}`;
    }
    for (const [name, child, sourceChild] of [['Clavicle', 'UpperArm', 'upperarm'], ['UpperArm', 'Forearm', 'lowerarm'],
      ['Forearm', 'Hand', 'hand'], ['Hand', 'Finger0', 'middle_01'], ['Thigh', 'Calf', 'calf'],
      ['Calf', 'Foot', 'foot'], ['Foot', 'Toe0', 'ball']] as const) {
      directions[`Bip001_${side}_${name}`] = [`Bip001_${side}_${child}`, `${sourceChild}_${suffix}`];
    }
  }
  if (!(position(target('Bip001_L_Thigh')).x > position(target('Bip001_R_Thigh')).x
    && position(source('thigh_l')).x > position(source('thigh_r')).x
    && position(target('Bip001_L_Toe0')).z > position(target('Bip001_L_Foot')).z
    && position(source('ball_l')).z > position(source('foot_l')).z)) {
    throw new Error('Skeleton transfer requires verified +Z facing and left-positive-X anatomy');
  }
  const pairs = Object.entries(mapping).map(([name, from]) => {
    const node = target(name), donorNode = source(from), targetRef = rotation(node), sourceRef = rotation(donorNode);
    const direction = directions[name];
    return { node, donorNode, offset: sourceRef.invert().multiply(targetRef),
      localDirection: direction ? position(target(direction[0])).sub(position(node)).normalize().applyQuaternion(targetRef.clone().invert()) : undefined,
      sourceChild: direction ? source(direction[1]) : undefined };
  }).sort((a, b) => depth(a.node) - depth(b.node));
  const legLength = (get: (name: string) => Node, a: string, b: string, c: string) =>
    position(get(a)).distanceTo(position(get(b))) + position(get(b)).distanceTo(position(get(c)));
  const translationScale = legLength(target, 'Bip001_L_Thigh', 'Bip001_L_Calf', 'Bip001_L_Foot')
    / legLength(source, 'thigh_l', 'calf_l', 'foot_l');
  const archer = context.assetId.includes('_archer'), mage = context.assetId.includes('_mage');
  const hand = target(archer ? 'Bip001_L_Hand' : 'Bip001_R_Hand');
  let weaponAxis: Vector3;
  if (archer || mage) {
    const holder = target(archer ? 'ArcherBow' : 'MageStaff');
    weaponAxis = new Vector3(0, 1, 0).applyQuaternion(rotation(holder)).applyQuaternion(rotation(hand).invert()).normalize();
  } else {
    // The original sword is skinned rigidly to the right hand, rather than a
    // separate attachment node. Its farthest retained hand vertex is its tip.
    let farthest = new Vector3(), squaredDistance = 0;
    for (const node of doc.getRoot().listNodes()) {
      const skin = node.getSkin(), mesh = node.getMesh(); if (!skin || !mesh) continue;
      const joint = skin.listJoints().indexOf(hand); if (joint < 0) continue;
      const matrix = world(hand).multiply(new Matrix4().fromArray(skin.getInverseBindMatrices()!.getElement(joint, [])).clone());
      for (const primitive of mesh.listPrimitives()) {
        const positions = primitive.getAttribute('POSITION')!, joints = primitive.getAttribute('JOINTS_0')!, weights = primitive.getAttribute('WEIGHTS_0')!;
        for (let i = 0; i < positions.getCount(); i++) {
          const js = joints.getElement(i, []), ws = weights.getElement(i, []);
          if (!js.some((value, index) => value === joint && ws[index]! > .999)) continue;
          const delta = new Vector3().fromArray(positions.getElement(i, [])).applyMatrix4(matrix).sub(position(hand));
          if (delta.lengthSq() > squaredDistance) { farthest = delta; squaredDistance = delta.lengthSq(); }
        }
      }
    }
    if (squaredDistance < .25) throw new Error('Skeleton sword no longer has its verified rigid hand attachment');
    weaponAxis = farthest.normalize().applyQuaternion(rotation(hand).invert()).normalize();
  }
  const sourceSeconds = duration(native), frames = Math.ceil(sourceSeconds * 90);
  const originalTimes = Array.from({ length: frames + 1 }, (_, frame) => Math.fround(sourceSeconds * frame / frames));
  const tracks = new Map<Node, Track>(baseline.map(pose => [pose.node, { t: [], r: [], s: [] }]));
  let report: Record<string, unknown>;
  try {
    for (let frame = 0; frame <= frames; frame++) {
      const phase = frame / frames;
      restorePose(baseline); restorePose(sourceBaseline); applyClip(native, sourceSeconds * phase);
      // The native standing reference retains each role's ready pose at entry.
      // During the fall, release that offset into the donor's actual limb directions
      // so a bow-ready elbow cannot keep the corpse's arm and equipment raised.
      const release = Math.min(1, phase / .3), weight = release * release * (3 - 2 * release);
      for (const pair of pairs) {
        const desired = rotation(pair.donorNode).multiply(pair.offset);
        if (pair.localDirection && pair.sourceChild) {
          const current = pair.localDirection.clone().applyQuaternion(desired).normalize();
          const direction = position(pair.sourceChild).sub(position(pair.donorNode)).normalize();
          const correction = new Quaternion().setFromUnitVectors(current, direction);
          desired.premultiply(new Quaternion().slerp(correction, weight)).normalize();
        }
        setRotation(pair.node, desired);
      }
      setPosition(targetRoot, targetRootStart.clone().add(position(donorRoot).sub(sourceRootStart).multiplyScalar(translationScale)));
      const settle = Math.max(0, Math.min(1, (phase - .38) / .4));
      const axis = weaponAxis.clone().applyQuaternion(rotation(hand)), flat = axis.clone().setY(0).normalize();
      if (flat.lengthSq() < .5) throw new Error('Skeleton weapon has no stable landing direction');
      setRotation(hand, new Quaternion().slerp(new Quaternion().setFromUnitVectors(axis, flat), settle * settle * (3 - 2 * settle)).multiply(rotation(hand)));
      ground.setTranslation([0, 0, 0]);
      for (const pose of baseline) {
        const track = tracks.get(pose.node)!;
        track.t.push(...pose.node.getTranslation()); track.r.push(...pose.node.getRotation()); track.s.push(...pose.node.getScale());
      }
    }
    removeClip(doc, 'Death');
    const death = doc.createAnimation('Death').setExtras({ sourceAssetId: donorId, sourceTake: 'Death01',
      method: 'Native biped collapse with role-ready release, exact interpolated support and held corpse' });
    for (const [node, track] of tracks) {
      addChannel(doc, death, node, 'translation', originalTimes, track.t);
      addChannel(doc, death, node, 'rotation', originalTimes, track.r);
      addChannel(doc, death, node, 'scale', originalTimes, track.s);
    }
    const support = sampleGroundSupport(originalTimes, time => {
      restorePose(baseline); applyClip(death, time); ground.setTranslation([0, 0, 0]);
      return .003 - deformedBounds(doc).min[1]!;
    });
    // Slow the specific support-changing intervals instead of hovering the whole
    // corpse in anticipation of a fast impact. Every source pose remains intact.
    const maxSpeedMps = height * 1.25, times = [0];
    for (let index = 1; index < support.times.length; index++) times.push(Math.fround(times[index - 1]! + Math.max(
      support.times[index]! - support.times[index - 1]!, Math.abs(support.required[index]! - support.required[index - 1]!) / maxSpeedMps * 1.002)));
    const seconds = times.at(-1)!;
    if (seconds / sourceSeconds > 1.8) throw new Error(`Skeleton collapse needs excessive support retiming: ${seconds / sourceSeconds}`);
    const corrections = limitGroundCorrectionSpeed(times, support.required, maxSpeedMps);
    if (Math.max(...corrections.map((value, index) => Math.abs(value - support.required[index]!))) > 1e-5) {
      throw new Error('Skeleton support retiming introduced anticipatory body lift');
    }
    const replacements = death.listChannels().map(channel => ({ channel, sampler: channel.getSampler()!, values: [] as number[] }));
    for (let index = 0; index < support.times.length; index++) {
      restorePose(baseline); applyClip(death, support.times[index]!); ground.setTranslation([0, corrections[index]! / parentScale, 0]);
      for (const row of replacements) {
        const node = row.channel.getTargetNode()!, path = row.channel.getTargetPath();
        row.values.push(...(path === 'rotation' ? node.getRotation() : path === 'scale' ? node.getScale() : node.getTranslation()));
      }
    }
    const heldSeconds = .3, end = Math.fround(seconds + heldSeconds);
    for (const row of replacements) {
      const input = row.sampler.getInput()!, output = row.sampler.getOutput()!, width = output.getElementSize();
      row.sampler.setInput(input.clone().setArray(Float32Array.from([...times, end])));
      row.sampler.setOutput(output.clone().setArray(Float32Array.from([...row.values, ...row.values.slice(-width)])));
    }
    let minimumFloor = Infinity, maximumAirGap = 0;
    const count = Math.ceil(end * 960);
    for (let sample = 0; sample <= count; sample++) {
      restorePose(baseline); applyClip(death, end * sample / count);
      const floor = deformedBounds(doc).min[1]!;
      minimumFloor = Math.min(minimumFloor, floor); maximumAirGap = Math.max(maximumAirGap, floor - .003);
    }
    if (minimumFloor < -.00025 || maximumAirGap > .01) throw new Error(`Skeleton support failed: ${JSON.stringify({ minimumFloor, maximumAirGap })}`);
    restorePose(baseline); applyClip(death, end);
    report = { sourceAssetId: donorId, sourceTake: 'Death01', sourceSeconds, seconds: end, heldSeconds,
      mappedJoints: pairs.length, translationScale, parentScale, supportSamples: support.times.length, groundingMaxSpeedMps: maxSpeedMps,
      retimingFactor: seconds / sourceSeconds, minimumFloor, maximumAirGap, corpseBounds: deformedBounds(doc),
      limbDirectionReleasePhase: .3, equipmentLanding: { hand: hand.getName(), weaponAxis: weaponAxis.toArray(), settledAtPhase: .78 } };
  } finally { restorePose(original); restorePose(sourceOriginal); }
  for (const row of preserved) if (clipDigest(row.clip) !== row.sha256) throw new Error(`Skeleton repair mutated preserved ${row.name}`);
  return { changes: ['Replaced the root-only Skeleton Death with the native UAL1 articulated collapse and a grounded held corpse.',
    'Preserved Idle, Walk, Run, Attack, Hit, body geometry, original skin, materials and equipment attachments.'],
    provenance: { ...report, preservedClipDigests: preserved.map(({ name, sha256 }) => ({ name, sha256 })),
      geometryAndSkinWeightsUnchanged: true, requiresDevdocsReview: true } };
}
