import type { Document, Node } from '@gltf-transform/core';
import { Quaternion, Vector3 } from 'three';
import { createSkinReader, setWorldPosition, setWorldQuaternion, solveTwoBone, worldPosition, worldQuaternion } from '../lib/ground-gait.js';
import { addChannel, applyClip, curve, duration, removeClip, restorePose, storedPose } from './pose.js';
import { hitProfile } from './profiles.js';

export function authorRhinoHit(doc: Document, side: -1 | 0 | 1): void {
  const rest = storedPose(doc), idle = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Idle');
  if (!idle) throw new Error('Rhino recoil requires source Idle');
  applyClip(idle, 0);
  const initial = storedPose(doc), joints = new Set(doc.getRoot().listSkins().flatMap(skin => skin.listJoints()));
  const requireJoint = (name: string): Node => {
    const matches = [...joints].filter(node => node.getName() === name);
    if (matches.length !== 1) throw new Error(`Rhino recoil requires one skin joint ${name}, found ${matches.length}`);
    return matches[0]!;
  };
  const limbs = ['LArm', 'RArm', 'LLeg', 'RLeg'].map(prefix => {
    const a = requireJoint(`CATRig${prefix}1`), b = requireJoint(`CATRig${prefix}2`);
    const end = requireJoint(`CATRig${prefix}${prefix.endsWith('Arm') ? 'Palm' : 'Ankle'}`);
    if (b.getParentNode() !== a || end.getParentNode() !== b) throw new Error(`Rhino chain changed: ${prefix}`);
    const origin = worldPosition(a), knee = worldPosition(b), target = worldPosition(end), axis = target.clone().sub(origin).normalize();
    const pole = knee.sub(origin); pole.addScaledVector(axis, -pole.dot(axis)).normalize();
    return { a, b, end, target, orientation: worldQuaternion(end), pole, l1: worldPosition(a).distanceTo(worldPosition(b)), l2: worldPosition(b).distanceTo(target) };
  });
  const profile = hitProfile('boss_rhino_air', side), pelvis = requireJoint('CATRigHub001'), pelvisPosition = worldPosition(pelvis);
  const gestures = profile.joints.filter(gesture => !gesture.bone.source.includes('Arm')).map(gesture => {
    const node = [...joints].find(node => gesture.bone.test(node.getName()));
    if (!node) throw new Error(`Rhino missing recoil joint ${gesture.bone}`);
    return { ...gesture, node, axis: new Vector3(gesture.axis === 'x' ? 1 : 0, gesture.axis === 'y' ? 1 : 0, gesture.axis === 'z' ? 1 : 0).applyQuaternion(worldQuaternion(node).invert()) };
  });
  const times = Array.from({ length: 161 }, (_, i) => profile.seconds * i / 160);
  const tracks = initial.map(row => ({ node: row.node, translation: [] as number[], rotation: [] as number[], scale: [] as number[] }));
  try {
    for (const time of times) {
      const phase = time / profile.seconds;
      restorePose(initial);
      for (const gesture of gestures) gesture.node.setRotation(new Quaternion().fromArray(gesture.node.getRotation()).multiply(new Quaternion().setFromAxisAngle(gesture.axis, curve(profile.phases, gesture.angles, phase) * Math.PI / 180)).normalize().toArray());
      const compression = curve(profile.phases, [0, -.045, -.065, -.027, -.008, 0], phase);
      setWorldPosition(pelvis, pelvisPosition.clone().add(new Vector3(0, compression, 0)));
      for (const limb of limbs) {
        const hip = worldPosition(limb.a), distance = hip.distanceTo(limb.target);
        if (distance >= limb.l1 + limb.l2 || distance <= Math.abs(limb.l1 - limb.l2)) throw new Error(`Rhino planted ${limb.a.getName()} unreachable at ${phase}`);
        solveTwoBone(limb.a, limb.b, limb.end, limb.target, hip.clone().add(limb.pole));
        setWorldQuaternion(limb.end, limb.orientation);
        if (worldPosition(limb.end).distanceTo(limb.target) > 1e-6) throw new Error('Rhino planted limb failed');
      }
      for (const track of tracks) { track.translation.push(...track.node.getTranslation()); track.rotation.push(...track.node.getRotation()); track.scale.push(...track.node.getScale()); }
    }
  } finally { restorePose(rest); }
  const name = side < 0 ? 'HitLeft' : side > 0 ? 'HitRight' : 'Hit';
  removeClip(doc, name);
  const clip = doc.createAnimation(name);
  for (const track of tracks) for (const property of ['translation', 'rotation', 'scale'] as const) {
    const width = property === 'rotation' ? 4 : 3, values = track[property], varying = values.some((value, i) => Math.abs(value - values[i % width]!) > 1e-8);
    addChannel(doc, clip, track.node, property, varying ? times : [0, profile.seconds], varying ? values : [...values.slice(0, width), ...values.slice(0, width)]);
  }
  clip.setExtras({ authored: true, description: 'Directional head/chest recoil and body compression with four planted limb endpoints and world orientations.', requiresPhysicalSoleAudit: true });
}

/** First forward strike peak after the measured anticipation minimum. Uses real
 * front head vertices over the entire clip, rather than a truncated bone-tip scan. */
export function measureRhinoAttackContact(doc: Document) {
  const pose = storedPose(doc), skin = createSkinReader(doc, 'Body');
  const strikeVertices = skin.restPoints.flatMap((point, index) => point.z > 1.4 ? [index] : []);
  if (strikeVertices.length < 100) throw new Error('Rhino forward head geometry changed');
  const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Attack')!;
  const seconds = duration(clip), intervals = 2400;
  const samples: { phase: number; reach: number }[] = [];
  try {
    for (let i = 0; i <= intervals; i++) {
      restorePose(pose); applyClip(clip, seconds * i / intervals);
      samples.push({ phase: i / intervals, reach: Math.max(...skin.points(strikeVertices).map(point => point.z)) });
    }
  } finally { restorePose(pose); }
  const anticipationIndex = samples.reduce((best, row, index) => row.reach < samples[best]!.reach ? index : best, 0);
  let contactIndex = anticipationIndex + 1;
  while (contactIndex + 1 < samples.length && samples[contactIndex + 1]!.reach >= samples[contactIndex]!.reach) contactIndex++;
  if (anticipationIndex === 0 || contactIndex >= samples.length - 1 || samples[contactIndex]!.reach - samples[anticipationIndex]!.reach < .15) throw new Error('Rhino attack lacks a distinct anticipation and forward strike');
  return { seconds, contactNormalized: samples[contactIndex]!.phase, contactSeconds: samples[contactIndex]!.phase * seconds, temporalResolutionSeconds: seconds / intervals, anticipationNormalized: samples[anticipationIndex]!.phase, strikeReachM: samples[contactIndex]!.reach, strikeVertices, samples, method: 'First full forward-head mesh reach maximum after the full-clip anticipation minimum. Requires side-view target contact confirmation.' };
}

export function auditRhinoRecoil(doc: Document) {
  const pose = storedPose(doc), skin = createSkinReader(doc, 'Body');
  const soles = ['LArm', 'RArm', 'LLeg', 'RLeg'].map(limb => ({ limb, indices: skin.indicesForBranches([`CATRig${limb}1`], .02) }));
  if (soles.some(sole => sole.indices.length < 10)) throw new Error('Rhino physical sole selection changed');
  const idle = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Idle')!;
  applyClip(idle, 0);
  const references = soles.map(sole => skin.points(sole.indices));
  const rows = [];
  try {
    for (const name of ['Hit', 'HitLeft', 'HitRight']) {
      const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === name)!;
      let maximumSoleDisplacementM = 0, minimumSoleY = Infinity, maximumWholeMeshRecoveryErrorM = 0;
      let startMesh: Vector3[] = [];
      for (let i = 0; i <= 320; i++) {
        restorePose(pose); applyClip(clip, duration(clip) * i / 320);
        soles.forEach((sole, j) => skin.points(sole.indices).forEach((point, k) => {
          maximumSoleDisplacementM = Math.max(maximumSoleDisplacementM, point.distanceTo(references[j]![k]!));
          minimumSoleY = Math.min(minimumSoleY, point.y);
        }));
        if (i === 0) startMesh = skin.points(Array.from({ length: skin.count }, (_, i) => i));
        if (i === 320) skin.points(Array.from({ length: skin.count }, (_, i) => i)).forEach((point, i) => { maximumWholeMeshRecoveryErrorM = Math.max(maximumWholeMeshRecoveryErrorM, point.distanceTo(startMesh[i]!)); });
      }
      rows.push({ name, samples: 321, maximumSoleDisplacementM, minimumSoleY, maximumWholeMeshRecoveryErrorM, passed: maximumSoleDisplacementM < .002 && minimumSoleY >= -.002 && maximumWholeMeshRecoveryErrorM < .00001 });
    }
  } finally { restorePose(pose); }
  return { passed: rows.every(row => row.passed), physicalSoles: soles, clips: rows, method: 'Serialized Body POSITION/JOINTS_0/WEIGHTS_0 skinned at every key and midpoint. Every selected physical sole vertex is compared with Idle; no bone-tip proxy.' };
}
