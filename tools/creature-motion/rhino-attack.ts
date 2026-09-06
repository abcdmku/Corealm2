import type { Document, Node } from '@gltf-transform/core';
import { Quaternion, Vector3 } from 'three';
import { createSkinReader, setWorldPosition, setWorldQuaternion, solveTwoBone, worldPosition, worldQuaternion } from '../lib/ground-gait.js';
import { addChannel, applyClip, curve, duration, removeClip, restorePose, storedPose } from './pose.js';

export const RHINO_ATTACK_SECONDS = 1.2333333492279053;
const phases = [0, .20, .43, .50, .72, .90, 1];

/** Idle-based neck/head strike with bounded angles; never samples the collapsed source Attack. */
export function authorRhinoAttack(doc: Document): void {
  const rest = storedPose(doc), idle = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Idle');
  if (!idle) throw new Error('Rhino attack requires Idle');
  applyClip(idle, 0);
  const body = doc.getRoot().listNodes().find(node => node.getName() === 'Body');
  if (!body?.getSkin()) throw new Error('Rhino Body skin missing');
  const initial = storedPose(doc), joints = new Set(body.getSkin()!.listJoints());
  const joint = (name: string): Node => {
    const found = [...joints].filter(node => node.getName() === name);
    if (found.length !== 1) throw new Error(`Expected one skin joint ${name}`);
    return found[0]!;
  };
  const headSkinJoint = joint('CATRigHub003'), head = headSkinJoint.getParentNode();
  if (!head || head.getName() !== 'CATRigHub003') throw new Error('Rhino head wrapper changed');
  // Duplicate source spine names are resolved by the head's actual ancestor chain.
  const neckChain: Node[] = [];
  for (let node = head.getParentNode(); node && neckChain.length < 2; node = node.getParentNode()) {
    if (/^CATRigSpine[12]$/.test(node.getName()) && joints.has(node)) neckChain.push(node);
  }
  if (neckChain.length !== 2) throw new Error('Head-to-neck hierarchy changed');
  const gestures = [
    { node: neckChain[1]!, angles: [0, 6, -12, -11, -3, 1, 0] },
    { node: neckChain[0]!, angles: [0, 4, -8, -7, -2, .5, 0] },
    { node: head, angles: [0, -3, 8, 7, 2, -.5, 0] },
  ].map(row => ({ ...row, axis: new Vector3(1, 0, 0).applyQuaternion(worldQuaternion(row.node).invert()) }));
  const pelvis = joint('CATRigHub001'), pelvisPosition = worldPosition(pelvis);
  const limbs = ['LArm', 'RArm', 'LLeg', 'RLeg'].map(prefix => {
    const a = joint(`CATRig${prefix}1`), b = joint(`CATRig${prefix}2`);
    const end = joint(`CATRig${prefix}${prefix.endsWith('Arm') ? 'Palm' : 'Ankle'}`);
    if (b.getParentNode() !== a || end.getParentNode() !== b) throw new Error('Rhino limb hierarchy changed');
    const origin = worldPosition(a), target = worldPosition(end), axis = target.clone().sub(origin).normalize();
    const pole = worldPosition(b).sub(origin); pole.addScaledVector(axis, -pole.dot(axis)).normalize();
    return { a, b, end, target, orientation: worldQuaternion(end), pole,
      l1: worldPosition(a).distanceTo(worldPosition(b)), l2: worldPosition(b).distanceTo(target) };
  });
  const times = Array.from({ length: 241 }, (_, i) => RHINO_ATTACK_SECONDS * i / 240);
  const tracks = initial.map(row => ({ node: row.node, translation: [] as number[], rotation: [] as number[], scale: [] as number[] }));
  try {
    for (const time of times) {
      restorePose(initial);
      const phase = time / RHINO_ATTACK_SECONDS;
      for (const gesture of gestures) gesture.node.setRotation(new Quaternion().fromArray(gesture.node.getRotation())
        .multiply(new Quaternion().setFromAxisAngle(gesture.axis, curve(phases, gesture.angles, phase) * Math.PI / 180)).normalize().toArray());
      setWorldPosition(pelvis, pelvisPosition.clone().add(new Vector3(0,
        curve(phases, [0, -.018, -.05, -.045, -.012, -.002, 0], phase),
        curve(phases, [0, -.018, .095, .09, .015, -.003, 0], phase))));
      for (const limb of limbs) {
        const hip = worldPosition(limb.a), d = hip.distanceTo(limb.target);
        if (d >= limb.l1 + limb.l2 || d <= Math.abs(limb.l1 - limb.l2)) throw new Error('Planted rhino limb unreachable');
        solveTwoBone(limb.a, limb.b, limb.end, limb.target, hip.clone().add(limb.pole));
        setWorldQuaternion(limb.end, limb.orientation);
        if (worldPosition(limb.end).distanceTo(limb.target) > 1e-6) throw new Error('Planted rhino attack solve failed');
      }
      for (const track of tracks) {
        track.translation.push(...track.node.getTranslation()); track.rotation.push(...track.node.getRotation()); track.scale.push(...track.node.getScale());
      }
    }
  } finally { restorePose(rest); }
  removeClip(doc, 'Attack'); const attack = doc.createAnimation('Attack');
  for (const track of tracks) for (const property of ['translation', 'rotation', 'scale'] as const) {
    const width = property === 'rotation' ? 4 : 3, values = track[property];
    const varying = values.some((value, i) => Math.abs(value - values[i % width]!) > 1e-8);
    addChannel(doc, attack, track.node, property, varying ? times : [0, RHINO_ATTACK_SECONDS], varying ? values : [...values.slice(0, width), ...values.slice(0, width)]);
  }
  attack.setExtras({ authored: true, description: 'Idle-based modest neck backdraw, supported forward horn presentation and damped recovery; four planted physical feet.',
    maximumAuthoredNeckJointDegrees: 12, targetContactRequiresBrowserReview: true });
}

/** Weighted physical head crossing a declared target plane, not an envelope-peak timestamp.
 * This plane is an offline strike fixture; it is NOT a claim of live player mesh intersection. */
export function auditRhinoAttack(doc: Document) {
  const rest = storedPose(doc), skin = createSkinReader(doc, 'Body');
  const soles = ['LArm', 'RArm', 'LLeg', 'RLeg'].map(limb => ({ limb, indices: skin.indicesForBranches([`CATRig${limb}1`], .02) }));
  const headIndices = skin.restPoints.flatMap((point, index) => point.z > 1.4 ? [index] : []);
  if (headIndices.length < 100 || soles.some(sole => sole.indices.length < 10)) throw new Error('Physical rhino selections changed');
  applyClip(doc.getRoot().listAnimations().find(clip => clip.getName() === 'Idle')!, 0);
  const references = soles.map(sole => skin.points(sole.indices));
  const headRest = skin.points(headIndices), idleReach = Math.max(...headRest.map(point => point.z));
  const targetPlaneZ = idleReach + .06;
  const attack = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Attack')!;
  let maximumSoleDisplacementM = 0, minimumSoleY = Infinity, minimumHeadReach = Infinity, maximumHeadDisplacementM = 0, recoveryErrorM = 0;
  const samples: { phase: number; reach: number }[] = [];
  let initialMesh: Vector3[] = [];
  try {
    for (let i = 0; i <= 960; i++) {
      restorePose(rest); applyClip(attack, duration(attack) * i / 960);
      soles.forEach((sole, j) => skin.points(sole.indices).forEach((point, k) => {
        maximumSoleDisplacementM = Math.max(maximumSoleDisplacementM, point.distanceTo(references[j]![k]!));
        minimumSoleY = Math.min(minimumSoleY, point.y);
      }));
      const head = skin.points(headIndices), reach = Math.max(...head.map(point => point.z));
      minimumHeadReach = Math.min(minimumHeadReach, reach);
      head.forEach((point, j) => { maximumHeadDisplacementM = Math.max(maximumHeadDisplacementM, point.distanceTo(headRest[j]!)); });
      samples.push({ phase: i / 960, reach });
      if (i === 0) initialMesh = skin.points(Array.from({ length: skin.count }, (_, i) => i));
      if (i === 960) skin.points(Array.from({ length: skin.count }, (_, i) => i)).forEach((point, j) => { recoveryErrorM = Math.max(recoveryErrorM, point.distanceTo(initialMesh[j]!)); });
    }
  } finally { restorePose(rest); }
  const crossing = samples.findIndex((row, i) => i > 0 && row.reach >= targetPlaneZ && samples[i - 1]!.reach < targetPlaneZ);
  const contactNormalized = crossing > 0 ? samples[crossing - 1]!.phase +
    (samples[crossing]!.phase - samples[crossing - 1]!.phase) * (targetPlaneZ - samples[crossing - 1]!.reach) / (samples[crossing]!.reach - samples[crossing - 1]!.reach) : null;
  return { passed: maximumSoleDisplacementM < .002 && minimumSoleY >= -.002 && recoveryErrorM < .00001
      && minimumHeadReach > idleReach - .05 && maximumHeadDisplacementM < .25 && contactNormalized !== null,
    seconds: duration(attack), contactNormalized, targetPlaneZ, idleReach, minimumHeadReach,
    maximumHeadReach: Math.max(...samples.map(row => row.reach)), maximumHeadDisplacementM,
    maximumSoleDisplacementM, minimumSoleY, recoveryErrorM, physicalSoles: soles, headVertices: headIndices.length, samples,
    initialTargetOverlap: samples[0]!.reach >= targetPlaneZ, visualAccepted: false,
    method: '961 weighted physical skin samples. First forward head crossing of a declared plane 6cm beyond Idle; live player intersection remains unverified.' };
}
