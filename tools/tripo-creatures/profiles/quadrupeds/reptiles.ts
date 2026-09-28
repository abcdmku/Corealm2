import type { Document, Node } from '@gltf-transform/core';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { applyClip, duration, restorePose, storedPose } from '../../../creature-motion/pose.js';
import { retargetCreatureMotion, type CreatureMotionProfile } from '../../retarget.js';
import { deformedBounds } from '../../../creature-motion/validate-deformation.js';
import type { CreatureRepairContext, CreatureRepairResult } from '../../repairProfile.js';
import { repairCinderAnatomy } from './cinderAnatomy.js';

export const assetIds = [
  'creature_cindercrest_salamander', 'creature_rimeback_tortoise', 'creature_quarry_nightmare',
  'creature_ashscale_monitor', 'creature_slateback_tortoise',
] as const;

const position = (node: Node) => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(node.getWorldMatrix()));

/** Studio GLBs can serialize a posed skeleton. Read the actual bind from the skin. */
function restoreStudioBind(doc: Document) {
  const skin = doc.getRoot().listSkins()[0];
  if (!skin?.getInverseBindMatrices()) throw new Error('The reptile donor requires exported inverse binds');
  const mesh = doc.getRoot().listNodes().find(node => node.getSkin() === skin);
  if (!mesh) throw new Error('The reptile donor has no skinned mesh');
  const meshWorld = new Matrix4().fromArray(mesh.getWorldMatrix());
  const binds = new Map(skin.listJoints().map((node, index) => [node, meshWorld.clone()
    .multiply(new Matrix4().fromArray(skin.getInverseBindMatrices()!.getElement(index, [])).invert())]));
  const depth = (node: Node): number => node.getParentNode() ? 1 + depth(node.getParentNode()!) : 0;
  for (const [node, world] of [...binds].sort(([a], [b]) => depth(a) - depth(b))) {
    const parent = node.getParentNode();
    const parentWorld = parent ? binds.get(parent) ?? new Matrix4().fromArray(parent.getWorldMatrix()) : new Matrix4();
    node.setMatrix(parentWorld.clone().invert().multiply(world).toArray());
  }
  return binds.size;
}

function bone(doc: Document, name: string) {
  const found = doc.getRoot().listNodes().filter(node => node.getName() === name);
  if (found.length !== 1) throw new Error(`Expected one anatomical node ${name}, found ${found.length}`);
  return found[0]!;
}

function length(doc: Document, a: string, b: string) { return position(bone(doc, a)).distanceTo(position(bone(doc, b))); }

/** Preserve the tortoise's moving body and retractable neck through the shorter target chain. */
function restoreTortoiseTranslations(doc: Document, donor: Document, mapping: Record<string, string>, translationScale: number) {
  const targetPose = storedPose(doc), donorPose = storedPose(donor), ground = bone(doc, 'corealm_retarget_ground');
  const relative = (node: Node, ancestor: Node) => position(node).applyMatrix4(new Matrix4().fromArray(ancestor.getWorldMatrix()).invert());
  const pairs = Object.entries(mapping).filter(([name]) => name !== 'Root').map(([name, sourceName]) => {
    const node = bone(doc, name), parent = node.getParentNode()!, source = bone(donor, sourceName);
    const sourceParent = bone(donor, mapping[parent.getName()]!), sourceRest = relative(source, sourceParent);
    const targetRest = new Vector3().fromArray(node.getTranslation());
    const scale = sourceRest.length() > .05 ? targetRest.length() / sourceRest.length() : translationScale;
    return { node, source, sourceParent, sourceRest, targetRest, scale };
  });
  const reports = [];
  try {
    for (const clip of doc.getRoot().listAnimations()) {
      const sourceClip = donor.getRoot().listAnimations().find(source => source.getName() === clip.getName())!;
      const sourceSeconds = duration(sourceClip);
      const groundSampler = clip.listChannels().find(channel => channel.getTargetNode() === ground && channel.getTargetPath() === 'translation')!.getSampler()!;
      const times = groundSampler.getInput()!, groundValues: number[][] = [];
      const tracks = pairs.map(pair => ({ ...pair, samples: [] as number[][], maximumDelta: 0,
        output: clip.listChannels().find(channel => channel.getTargetNode() === pair.node && channel.getTargetPath() === 'translation')!.getSampler()!.getOutput()! }));
      for (let frame = 0; frame < times.getCount(); frame++) {
        const time = times.getElement(frame, [] as number[])[0]!;
        restorePose(targetPose); applyClip(clip, time); restorePose(donorPose); applyClip(sourceClip, Math.min(time, sourceSeconds));
        for (const track of tracks) {
          const delta = relative(track.source, track.sourceParent).sub(track.sourceRest).multiplyScalar(track.scale);
          track.maximumDelta = Math.max(track.maximumDelta, delta.length());
          track.node.setTranslation(track.targetRest.clone().add(delta).toArray()); track.samples.push(track.node.getTranslation());
        }
        const correction = .003 - deformedBounds(doc).min[1]!;
        groundValues.push([0, ground.getTranslation()[1] + correction, 0]);
      }
      if (['Idle', 'Walk', 'Run'].includes(clip.getName())) {
        for (const track of tracks) track.samples[track.samples.length - 1] = [...track.samples[0]!];
        groundValues[groundValues.length - 1] = [...groundValues[0]!];
      }
      for (const track of tracks) track.samples.forEach((value, frame) => track.output.setElement(frame, value));
      groundValues.forEach((value, frame) => groundSampler.getOutput()!.setElement(frame, value));
      reports.push({ state: clip.getName(), translations: tracks.filter(track => track.maximumDelta > .001)
        .map(track => ({ bone: track.node.getName(), maximumDelta: track.maximumDelta })) });
    }
  } finally { restorePose(targetPose); restorePose(donorPose); }
  return { states: reports, sourceToTargetBasis: [0, 0, 0, 1], pairs: pairs.map(pair => ({
    target: pair.node.getName(), source: pair.source.getName(), sourceAncestor: pair.sourceParent.getName(),
    sourceRestLength: pair.sourceRest.length(), targetRestLength: pair.targetRest.length(), scale: pair.scale,
  })),
    method: 'Retain source motion relative to the nearest mapped parent, collapsing the two source neck segments into the target neck/head chain. Scale by target/source segment length, retain shell drop, and recompute mesh grounding.' };
}

/** Different leg rest angles must reach the donor's folded pose during the collapse. */
function settleTortoiseDeath(doc: Document, donor: Document, mapping: Record<string, string>) {
  const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Death')!;
  const sourceClip = donor.getRoot().listAnimations().find(clip => clip.getName() === 'Death')!, sourceSeconds = duration(sourceClip);
  const targetPose = storedPose(doc), donorPose = storedPose(donor), ground = bone(doc, 'corealm_retarget_ground');
  const rotation = (node: Node) => new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(new Matrix4().fromArray(node.getWorldMatrix())));
  const parts = ['ForeL', 'ForeR', 'HindL', 'HindR'].flatMap(prefix => [['Upper', 'Lower'], ['Lower', 'Foot']].map(([a, b]) => {
    const name = prefix + a, child = prefix + b, node = bone(doc, name);
    return { node, child: bone(doc, child), source: bone(donor, mapping[name]!), sourceChild: bone(donor, mapping[child]!), values: [] as number[][],
      output: clip.listChannels().find(channel => channel.getTargetNode() === node && channel.getTargetPath() === 'rotation')!.getSampler()!.getOutput()! };
  }));
  const feet = ['ForeL', 'ForeR', 'HindL', 'HindR'].map(prefix => {
    const node = bone(doc, prefix + 'Foot');
    return { node, values: [] as number[][], output: clip.listChannels().find(channel => channel.getTargetNode() === node && channel.getTargetPath() === 'rotation')!.getSampler()!.getOutput()! };
  });
  const groundSampler = clip.listChannels().find(channel => channel.getTargetNode() === ground && channel.getTargetPath() === 'translation')!.getSampler()!;
  const times = groundSampler.getInput()!, groundValues: number[][] = [];
  let shellBefore = 0, shellAfter = 0;
  try {
    for (let frame = 0; frame < times.getCount(); frame++) {
      const time = times.getElement(frame, [] as number[])[0]!, t = Math.max(0, Math.min(1, (time / sourceSeconds - .1) / .55)), amount = t * t * (3 - 2 * t);
      restorePose(targetPose); applyClip(clip, time); restorePose(donorPose); applyClip(sourceClip, Math.min(time, sourceSeconds));
      const footRotations = feet.map(foot => rotation(foot.node));
      if (frame === times.getCount() - 1) shellBefore = position(bone(doc, 'Shell')).y;
      for (const part of parts) {
        const current = position(part.child).sub(position(part.node)).normalize(), desired = position(part.sourceChild).sub(position(part.source)).normalize();
        const world = rotation(part.node).premultiply(new Quaternion().slerp(new Quaternion().setFromUnitVectors(current, desired), amount));
        part.node.setRotation(rotation(part.node.getParentNode()!).invert().multiply(world).normalize().toArray());
        part.values.push(part.node.getRotation());
      }
      feet.forEach((foot, index) => {
        foot.node.setRotation(rotation(foot.node.getParentNode()!).invert().multiply(footRotations[index]!).normalize().toArray());
        foot.values.push(foot.node.getRotation());
      });
      const correction = .003 - deformedBounds(doc).min[1]!;
      groundValues.push([0, ground.getTranslation()[1] + correction, 0]);
      if (frame === times.getCount() - 1) shellAfter = position(bone(doc, 'Shell')).y + correction;
    }
    for (const part of [...parts, ...feet]) part.values.forEach((value, frame) => part.output.setElement(frame, value));
    groundValues.forEach((value, frame) => groundSampler.getOutput()!.setElement(frame, value));
  } finally { restorePose(targetPose); restorePose(donorPose); }
  return { startsNormalized: .1, completeNormalized: .65, shellBefore, shellAfter,
    method: 'During Death only, progressively align upper and lower leg segments with the source tortoise collapsed limb directions while retaining foot orientation, then recompute actual skinned grounding.' };
}

function surfacePlaneNormal(points: Vector3[]) {
    const mean = points.reduce((sum, point) => sum.add(point), new Vector3()).multiplyScalar(1 / points.length);
    const covariance = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const point of points) { const delta = point.clone().sub(mean).toArray(); for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) covariance[a]![b] = covariance[a]![b]! + delta[a]! * delta[b]!; }
    const multiply = (v: Vector3) => new Vector3(...covariance.map(row => row[0]! * v.x + row[1]! * v.y + row[2]! * v.z) as [number, number, number]);
    let major = new Vector3(1, .37, .19).normalize();
    for (let i = 0; i < 30; i++) major = multiply(major).normalize();
    let secondary = new Vector3(.17, 1, .43).addScaledVector(major, -new Vector3(.17, 1, .43).dot(major)).normalize();
    for (let i = 0; i < 30; i++) { secondary = multiply(secondary); secondary.addScaledVector(major, -secondary.dot(major)).normalize(); }
    return major.cross(secondary).normalize();
}

/** Fit the native collapsed curl to the shorter, raised target tail. */
function settleSalamanderTail(doc: Document, donor: Document, mapping: Record<string, string>) {
  const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Death')!;
  const sourceClip = donor.getRoot().listAnimations().find(clip => clip.getName() === 'Death')!, sourceSeconds = duration(sourceClip);
  const targetPose = storedPose(doc), donorPose = storedPose(donor), ground = bone(doc, 'corealm_retarget_ground');
  const target = ['TailBase', 'TailMid', 'TailTip'].map(name => bone(doc, name)), source = target.map(node => bone(donor, mapping[node.getName()]!));
  const lengths = [position(target[0]!).distanceTo(position(target[1]!)), position(target[1]!).distanceTo(position(target[2]!))];
  const scale = (lengths[0]! + lengths[1]!) / (position(source[0]!).distanceTo(position(source[1]!)) + position(source[1]!).distanceTo(position(source[2]!)));
  const rotation = (node: Node) => new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(new Matrix4().fromArray(node.getWorldMatrix())));
  restorePose(donorPose); applyClip(sourceClip, sourceSeconds);
  const terminalChord = position(source[2]!).sub(position(source[0]!)).normalize();
  const pole = position(source[1]!).sub(position(source[0]!)); pole.addScaledVector(terminalChord, -pole.dot(terminalChord)).normalize();
  restorePose(donorPose);
  const parts = target.slice(0, 2).map(node => ({ node, values: [] as number[][],
    output: clip.listChannels().find(channel => channel.getTargetNode() === node && channel.getTargetPath() === 'rotation')!.getSampler()!.getOutput()! }));
  const groundSampler = clip.listChannels().find(channel => channel.getTargetNode() === ground && channel.getTargetPath() === 'translation')!.getSampler()!;
  const times = groundSampler.getInput()!, groundValues: number[][] = [];
  let tipBefore = 0, tipAfter = 0;
  try {
    for (let frame = 0; frame < times.getCount(); frame++) {
      const time = times.getElement(frame, [] as number[])[0]!, t = Math.max(0, Math.min(1, (time / sourceSeconds - .2) / .6)), amount = t * t * (3 - 2 * t);
      restorePose(targetPose); applyClip(clip, time); restorePose(donorPose); applyClip(sourceClip, Math.min(time, sourceSeconds));
      const origin = position(target[0]!), first = position(source[1]!).sub(position(source[0]!)).normalize(), second = position(source[2]!).sub(position(source[1]!)).normalize();
      const end = origin.clone().addScaledVector(first, lengths[0]!).addScaledVector(second, lengths[1]!);
      end.y = .003 + Math.max(.01, position(source[2]!).y - deformedBounds(donor).min[1]!) * scale;
      const direction = end.clone().sub(origin), distance = Math.max(Math.abs(lengths[0]! - lengths[1]!) + .0001,
        Math.min(lengths[0]! + lengths[1]! - .0001, direction.length())); direction.normalize();
      end.copy(origin).addScaledVector(direction, distance);
      const bend = pole.clone().addScaledVector(direction, -pole.dot(direction));
      if (bend.lengthSq() < 1e-8) bend.set(1, 0, 0).addScaledVector(direction, -direction.x);
      bend.normalize();
      const along = (lengths[0]! ** 2 - lengths[1]! ** 2 + distance ** 2) / (2 * distance);
      const middle = origin.clone().addScaledVector(direction, along).addScaledVector(bend, Math.sqrt(Math.max(0, lengths[0]! ** 2 - along ** 2)));
      if (frame === times.getCount() - 1) tipBefore = position(target[2]!).y;
      for (let index = 0; index < parts.length; index++) {
        const part = parts[index]!, current = position(target[index + 1]!).sub(position(part.node)).normalize();
        const desired = (index === 0 ? middle.clone().sub(origin) : end.clone().sub(middle)).normalize();
        const world = rotation(part.node).premultiply(new Quaternion().slerp(new Quaternion().setFromUnitVectors(current, desired), amount));
        part.node.setRotation(rotation(part.node.getParentNode()!).invert().multiply(world).normalize().toArray());
        part.values.push(part.node.getRotation());
      }
      const correction = .003 - deformedBounds(doc).min[1]!;
      groundValues.push([0, ground.getTranslation()[1] + correction, 0]);
      if (frame === times.getCount() - 1) tipAfter = position(target[2]!).y + correction;
    }
    for (const part of parts) part.values.forEach((value, frame) => part.output.setElement(frame, value));
    groundValues.forEach((value, frame) => groundSampler.getOutput()!.setElement(frame, value));
  } finally { restorePose(targetPose); restorePose(donorPose); }
  return { startsNormalized: .2, completeNormalized: .8, sourceToTargetTailLengthScale: scale, targetSegmentLengths: lengths, tipBefore, tipAfter,
    method: 'During Death only, solve the target tail segments toward the native curled shape and scaled native tip ground clearance. Preserve the actual attachment and segment lengths, then ground the skinned mesh.' };
}

/** The native mouth attack advances at Chest; its head has no translation track. */
function restoreDragonChestAttack(doc: Document, donor: Document) {
  const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Attack')!;
  const sourceClip = donor.getRoot().listAnimations().find(clip => clip.getName() === 'Attack')!;
  const pose = storedPose(doc), sourcePose = storedPose(donor), chest = bone(doc, 'Chest'), sourceChest = bone(donor, 'Chest');
  const sourceParent = sourceChest.getParentNode()!, parent = chest.getParentNode()!, ground = bone(doc, 'corealm_retarget_ground');
  const sourceRest = new Vector3().fromArray(sourceChest.getTranslation()), targetRest = new Vector3().fromArray(chest.getTranslation());
  const sourceBodyLength = length(donor, 'Spine01', 'Chest'), targetBodyLength = length(doc, 'SpineRear', 'Chest'), scale = targetBodyLength / sourceBodyLength;
  const output = clip.listChannels().find(channel => channel.getTargetNode() === chest && channel.getTargetPath() === 'translation')!.getSampler()!.getOutput()!;
  const groundSampler = clip.listChannels().find(channel => channel.getTargetNode() === ground && channel.getTargetPath() === 'translation')!.getSampler()!;
  const times = groundSampler.getInput()!, translations: number[][] = [], groundValues: number[][] = [];
  let maximumSourceDelta = 0, maximumTargetDelta = 0;
  try {
    for (let frame = 0; frame < times.getCount(); frame++) {
      const time = times.getElement(frame, [] as number[])[0]!;
      restorePose(pose); applyClip(clip, time); restorePose(sourcePose); applyClip(sourceClip, time);
      const sourceExpected = sourceRest.clone().applyMatrix4(new Matrix4().fromArray(sourceParent.getWorldMatrix()));
      const delta = position(sourceChest).sub(sourceExpected); maximumSourceDelta = Math.max(maximumSourceDelta, delta.length());
      delta.multiplyScalar(scale); maximumTargetDelta = Math.max(maximumTargetDelta, delta.length());
      const inverseParent = new Matrix4().fromArray(parent.getWorldMatrix()).invert();
      const localDelta = delta.applyMatrix4(inverseParent).sub(new Vector3().applyMatrix4(inverseParent));
      chest.setTranslation(targetRest.clone().add(localDelta).toArray()); translations.push(chest.getTranslation());
      groundValues.push([0, ground.getTranslation()[1] + .003 - deformedBounds(doc).min[1]!, 0]);
    }
    translations.forEach((value, frame) => output.setElement(frame, value));
    groundValues.forEach((value, frame) => groundSampler.getOutput()!.setElement(frame, value));
  } finally { restorePose(pose); restorePose(sourcePose); }
  return { state: 'Attack', source: 'Chest', target: 'Chest', sourceParent: sourceParent.getName(), targetParent: parent.getName(),
    sourceBodyLength, targetBodyLength, scale, maximumSourceDelta, maximumTargetDelta,
    method: 'Retain the authored Chest advance relative to its animated source parent, convert through canonical world space into the target parent basis, scale by measured body length, and recompute skinned grounding.' };
}

/** Let each membrane settle flat as the body falls, without distorting the wing's internal joints. */
function settleDragonDeath(doc: Document) {
  const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Death')!;
  const sourceSeconds = duration(clip) - .35, targetPose = storedPose(doc), ground = bone(doc, 'corealm_retarget_ground');
  const rotation = (node: Node) => new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(new Matrix4().fromArray(node.getWorldMatrix())));
  const mesh = doc.getRoot().listNodes().find(node => node.getMesh() && node.getSkin())!, skin = mesh.getSkin()!, joints = skin.listJoints();
  const samples = mesh.getMesh()!.listPrimitives().flatMap(primitive => {
    const positions = primitive.getAttribute('POSITION')!, indices = primitive.getAttribute('JOINTS_0')!, weights = primitive.getAttribute('WEIGHTS_0')!;
    return Array.from({ length: positions.getCount() }, (_, index) => ({ point: new Vector3().fromArray(positions.getElement(index, [])),
      indices: indices.getElement(index, [] as number[]), weights: weights.getElement(index, [] as number[]) }));
  });
  const surface = (side?: string) => {
    const matrices = joints.map((joint, index) => new Matrix4().fromArray(joint.getWorldMatrix())
      .multiply(new Matrix4().fromArray(skin.getInverseBindMatrices()!.getElement(index, []))));
    return samples.filter(sample => sample.indices.reduce((sum, index, slot) => sum + ((side
      ? joints[index]!.getName().startsWith('Wing') && joints[index]!.getName().endsWith(`_${side}`)
      : ['Pelvis', 'SpineRear', 'SpineMid', 'Chest'].includes(joints[index]!.getName())) ? sample.weights[slot]! : 0), 0) > (side ? .85 : .8))
      .map(sample => sample.indices.reduce((out, index, slot) => out.add(sample.point.clone().applyMatrix4(matrices[index]!).multiplyScalar(sample.weights[slot]!)), new Vector3()));
  };
  const wings = ['L', 'R'].map(side => {
    const node = bone(doc, `WingShoulder_${side}`);
    return { node, side, values: [] as number[][],
      output: clip.listChannels().find(channel => channel.getTargetNode() === node && channel.getTargetPath() === 'rotation')!.getSampler()!.getOutput()! };
  });
  const groundSampler = clip.listChannels().find(channel => channel.getTargetNode() === ground && channel.getTargetPath() === 'translation')!.getSampler()!;
  const times = groundSampler.getInput()!, groundValues: number[][] = [];
  restorePose(targetPose); applyClip(clip, sourceSeconds);
  const terminalNormals = new Map(wings.map(wing => [wing.side, surfacePlaneNormal(surface(wing.side))]));
  restorePose(targetPose);
  let pelvisBefore = 0, pelvisAfter = 0;
  try {
    for (let frame = 0; frame < times.getCount(); frame++) {
      const time = times.getElement(frame, [] as number[])[0]!, t = Math.max(0, Math.min(1, (time / sourceSeconds - .2) / .55)), amount = t * t * (3 - 2 * t);
      restorePose(targetPose); applyClip(clip, time);
      if (frame === times.getCount() - 1) pelvisBefore = position(bone(doc, 'Pelvis')).y;
      const bodyFloor = Math.min(...surface().map(point => point.y));
      for (const wing of wings) {
        const points = surface(wing.side), normal = surfacePlaneNormal(points), origin = position(wing.node), terminalNormal = terminalNormals.get(wing.side)!;
        // PCA normals have two equivalent signs. Keep both that sign and the
        // destination hemisphere fixed for the take, including vertical planes.
        if (normal.dot(terminalNormal) < 0) normal.negate();
        const up = new Vector3(0, terminalNormal.y < 0 ? -1 : 1, 0);
        const flat = new Quaternion().setFromUnitVectors(normal, up);
        const flattened = points.map(point => point.clone().sub(origin).applyQuaternion(flat));
        const radial = flattened.reduce((sum, point) => sum.add(point), new Vector3()).multiplyScalar(1 / flattened.length).setY(0).normalize();
        const axis = radial.cross(new Vector3(0, 1, 0)).normalize();
        let lifted = flat;
        for (let angle = 0; angle <= Math.PI / 3; angle += Math.PI / 180) {
          const lift = new Quaternion().setFromAxisAngle(axis, angle);
          lifted = flat.clone().premultiply(lift);
          if (Math.min(...flattened.map(point => point.clone().applyQuaternion(lift).y + origin.y)) >= bodyFloor + .01) break;
        }
        const correction = new Quaternion().slerp(lifted, amount);
        const world = rotation(wing.node).premultiply(correction);
        wing.node.setRotation(rotation(wing.node.getParentNode()!).invert().multiply(world).normalize().toArray());
        wing.values.push(wing.node.getRotation());
      }
      const correction = .003 - deformedBounds(doc).min[1]!;
      groundValues.push([0, ground.getTranslation()[1] + correction, 0]);
      if (frame === times.getCount() - 1) pelvisAfter = position(bone(doc, 'Pelvis')).y + correction;
    }
    for (const wing of wings) wing.values.forEach((value, frame) => wing.output.setElement(frame, value));
    groundValues.forEach((value, frame) => groundSampler.getOutput()!.setElement(frame, value));
  } finally { restorePose(targetPose); }
  return { startsNormalized: .2, completeNormalized: .75, pelvisBefore, pelvisAfter,
    method: 'During Death only, settle the measured membrane plane at its shoulder and lift its outer edge just enough for the flank to reach ground. Preserve native internal wing motion and recompute actual skinned grounding.' };
}

function tortoiseMeshData(doc:Document) {
  const node = doc.getRoot().listNodes().find(n=>n.getSkin() && n.getMesh())!, skin = node.getSkin()!;
  const primitive = node.getMesh()!.listPrimitives()[0]!, positions=primitive.getAttribute('POSITION')!;
  const vertices:Vector3[] = [], originals:number[][] = [], lookup = new Map<string,number>();
  const canonical = Array.from({length:positions.getCount()},(_,i)=>{
    const values=positions.getElement(i,[] as number[]), key=values.map(x=>x.toFixed(5)).join(',');
    let index=lookup.get(key);if(index===undefined){index=vertices.length;lookup.set(key,index);vertices.push(new Vector3().fromArray(values));originals.push([]);}
    originals[index]!.push(i);return index;
  });
  const adjacency=vertices.map(()=>new Set<number>()), indices=primitive.getIndices()!.getArray()!;
  for(let i=0;i<indices.length;i+=3)for(let k=0;k<3;k++){
    const a=canonical[indices[i+k]!]!,b=canonical[indices[i+(k+1)%3]!]!;adjacency[a]!.add(b);adjacency[b]!.add(a);
  }
  return {node,skin,primitive,positions,vertices,originals,canonical,adjacency,
    joints:primitive.getAttribute('JOINTS_0')!,weights:primitive.getAttribute('WEIGHTS_0')!};
}

function tortoiseComponents(data:ReturnType<typeof tortoiseMeshData>, maxY:number) {
  const seen=new Set<number>(), groups: { count: number; centroid: number[]; min: number[]; max: number[]; indices: number[] }[]=[];
  for(let start=0;start<data.vertices.length;start++)if(!seen.has(start)&&data.vertices[start]!.y<maxY){
    const group=[start];seen.add(start);
    for(let c=0;c<group.length;c++)for(const next of data.adjacency[group[c]!]!)if(!seen.has(next)&&data.vertices[next]!.y<maxY){seen.add(next);group.push(next);}
    const points=group.map(i=>data.vertices[i]!);
    groups.push({count:group.length,centroid:points.reduce((v,p)=>v.add(p),new Vector3()).divideScalar(points.length).toArray(),
      min:[0,1,2].map(k=>Math.min(...points.map(p=>p.getComponent(k)))),max:[0,1,2].map(k=>Math.max(...points.map(p=>p.getComponent(k)))),indices:group});
  }
  return groups.sort((a,b)=>b.count-a.count);
}

/** The low hindfeet are distinct connected branches, including their inner toes. */
function repairRimebackHindWeights(doc:Document) {
  const data=tortoiseMeshData(doc), names=data.skin.listJoints().map(n=>n.getName()), groups=tortoiseComponents(data,.2);
  const reports: { side: number; seedVertices: number; changed: number; range: { min: number[]; max: number[] } }[]=[];
  for(const side of [-1,1]) {
    const seed=groups.find(g=>g.count>80 && side*g.centroid[0]!>.25 && g.centroid[2]!<-.4);
    if(!seed)throw new Error('Rimeback hindfoot topology does not match the reviewed source');
    const seeds=new Set<number>(seed.indices);
    const outside=(p:Vector3)=>p.y>=.40||side*p.x<.18||p.z>-.3||p.z<-.85;
    let membership: number[]=data.vertices.map((p,i)=>seeds.has(i)?1:0);
    for(let pass=0;pass<120;pass++)membership=membership.map((m,i)=>{
      if(seeds.has(i))return 1;if(outside(data.vertices[i]!))return 0;
      const adjacent=[...data.adjacency[i]!];return adjacent.length?adjacent.reduce((sum,j)=>sum+membership[j]!,0)/adjacent.length:0;
    });
    const chain=['Upper','Lower','Foot'].map(part=>names.indexOf(`Hind${side<0?'L':'R'}${part}`));
    let changed=0;
    for(let index=0;index<data.vertices.length;index++) {
      const blend=membership[index]!,p=data.vertices[index]!;if(blend<.00001)continue;
      const foot=Math.max(0,Math.min(1,(.27-p.y)/.18)),upper=Math.max(0,Math.min(1,(p.y-.18)/.22));
      const lower=Math.max(0,1-foot-upper),sum=foot+lower+upper;
      for(const original of data.originals[index]!) {
        const oldJ=data.joints.getElement(original,[] as number[]),oldW=data.weights.getElement(original,[] as number[]);
        const weights=new Map<number,number>();oldJ.forEach((j,k)=>weights.set(j,(weights.get(j)||0)+Math.max(0,oldW[k]!)*(1-blend)));
        [upper,lower,foot].forEach((w,k)=>weights.set(chain[k]!, (weights.get(chain[k]!)||0)+blend*w/sum));
        const top=[...weights].sort((a,b)=>b[1]-a[1]).slice(0,4),total=top.reduce((s,w)=>s+w[1],0);
        while(top.length<4)top.push([0,0]);
        data.joints.setElement(original,top.map(x=>x[0]));data.weights.setElement(original,top.map(x=>x[1]/total));changed++;
      }
    }
    reports.push({side,seedVertices:seed.count,changed,range:{min:seed.min,max:seed.max}});
  }
  return reports;
}

/** Separate touching anatomical branches in mesh topology before calculating their weights. */
function repairBranchWeights(doc: Document, assetId: string) {
  const mesh = doc.getRoot().listNodes().find(node => node.getMesh() && node.getSkin())!;
  const skin = mesh.getSkin()!, joints = skin.listJoints(), inverseWorld = new Matrix4().fromArray(mesh.getWorldMatrix()).invert();
  const centers = joints.map(joint => position(joint).applyMatrix4(inverseWorld));
  const salamander = assetId === 'creature_cindercrest_salamander';
  const groups = salamander ? [{ name: 'tail', names: ['TailBase', 'TailMid', 'TailTip'], side: 0 },
    { name: 'head', names: ['Neck', 'Head', 'Muzzle'], side: 0 }]
    : [-1, 1].map(side => ({ name: `wing_${side < 0 ? 'L' : 'R'}`, side,
      names: ['WingShoulder', 'WingArm', 'WingElbow', 'WingTip', 'WingFingerA', 'WingFingerB'].map(name => `${name}_${side < 0 ? 'L' : 'R'}`) }));
  const reports: Record<string, unknown>[] = [];
  for (const primitive of mesh.getMesh()!.listPrimitives()) {
    const positions = primitive.getAttribute('POSITION')!, indices = primitive.getIndices()!.getArray()!;
    const js = primitive.getAttribute('JOINTS_0')!, ws = primitive.getAttribute('WEIGHTS_0')!;
    const vertices: Vector3[] = [], originals: number[][] = [], lookup = new Map<string, number>();
    const canonical = Array.from({ length: positions.getCount() }, (_, index) => {
      const values = positions.getElement(index, [] as number[]), key = values.map(value => value.toFixed(5)).join(',');
      let joint = lookup.get(key);
      if (joint === undefined) { joint = vertices.length; lookup.set(key, joint); vertices.push(new Vector3().fromArray(values)); originals.push([]); }
      originals[joint]!.push(index); return joint;
    });
    const adjacent = vertices.map(() => new Set<number>());
    for (let i = 0; i < indices.length; i += 3) for (const [a, b] of [[indices[i]!, indices[i + 1]!], [indices[i + 1]!, indices[i + 2]!], [indices[i + 2]!, indices[i]!]]) {
      const ca = canonical[a!]!, cb = canonical[b!]!;
      if (ca !== cb) { adjacent[ca]!.add(cb); adjacent[cb]!.add(ca); }
    }
    for (const group of groups) {
      const branchBones = group.names.map(name => joints.findIndex(joint => joint.getName() === name));
      if (branchBones.some(index => index < 0)) throw new Error(`Missing ${assetId} branch anatomy`);
      const headBranch = group.name === 'head';
      const inside = (point: Vector3) => headBranch ? point.x > .24 && point.y > .16
        : salamander ? point.x < -.12 && point.y > .36 : point.x * group.side > .075 && point.y > .23;
      const score = (point: Vector3) => headBranch ? point.x : salamander ? point.y : point.x * group.side;
      const seed = vertices.reduce((best, point, index) => inside(point) && score(point) > score(vertices[best]!) ? index : best,
        vertices.findIndex(inside));
      if (seed < 0) throw new Error(`Missing ${assetId} branch seed`);
      const branch = new Set([seed]), queue = [seed];
      for (let cursor = 0; cursor < queue.length; cursor++) for (const neighbor of adjacent[queue[cursor]!]!) {
        if (!branch.has(neighbor) && inside(vertices[neighbor]!)) { branch.add(neighbor); queue.push(neighbor); }
      }
      if (branch.size < 100 || branch.size > vertices.length * .35) throw new Error(`${assetId} ${group.name} no longer separates anatomically`);
      const pinned = vertices.map((point, index) => branch.has(index)
        ? headBranch ? point.x > .34 && point.y > .18 : salamander ? point.y > .48 && point.x < -.18 : point.x * group.side > .14 && point.y > .30
        : headBranch ? point.x < .18 || point.y < .11 : salamander ? point.x > .08 || point.y < .26 : point.x * group.side < .045 || point.y > .3 || point.y < .15);
      let membership: number[] = vertices.map((_, index) => branch.has(index) ? 1 : 0);
      for (let iteration = 0; iteration < 120; iteration++) {
        const next = membership.slice();
        for (let i = 0; i < vertices.length; i++) {
          if (pinned[i] || !adjacent[i]!.size) continue;
          let value = 0, total = 0;
          for (const neighbor of adjacent[i]!) {
            const mass = 1 / Math.max(.005, vertices[i]!.distanceTo(vertices[neighbor]!));
            value += membership[neighbor]! * mass; total += mass;
          }
          next[i] = value / total;
        }
        membership = next;
      }
      const affected = vertices.map((_, index) => membership[index]! > 1e-6 || originals[index]!.some(vertex =>
        js.getElement(vertex, []).some((joint, slot) => branchBones.includes(joint) && ws.getElement(vertex, [])[slot]! > 0)));
      let fields = vertices.map((point, index) => {
        const field = new Float64Array(joints.length), vertex = originals[index]![0]!, oldJoints = js.getElement(vertex, [] as number[]), oldWeights = ws.getElement(vertex, [] as number[]);
        oldJoints.forEach((joint, slot) => field[joint] = field[joint]! + oldWeights[slot]!);
        if (!affected[index]) return field;
        // A tail attaches to the pelvis. The old nearest-four field spread its
        // attachment over chest and spine too, forcing 20% influences to disappear
        // whenever a tail bone became the fourth strongest influence.
        if (salamander && !headBranch) {
          const t = Math.min(1, membership[index]! / .3), blend = t * t * (3 - 2 * t);
          const pelvis = joints.findIndex(joint => joint.getName() === 'Pelvis');
          for (const name of ['Spine', 'Chest']) {
            const joint = joints.findIndex(joint => joint.getName() === name), moved = field[joint]! * blend;
            field[joint] = field[joint]! - moved; field[pelvis] = field[pelvis]! + moved;
          }
        }
        let bodyMass = 0;
        for (let joint = 0; joint < field.length; joint++) {
          if (branchBones.includes(joint)) field[joint] = 0; else bodyMass += field[joint]!;
        }
        if (bodyMass < 1e-8) { field[joints.findIndex(joint => joint.getName() === (salamander ? 'Pelvis' : 'Chest'))] = 1; bodyMass = 1; }
        for (let joint = 0; joint < field.length; joint++) field[joint] = field[joint]! / bodyMass * (1 - membership[index]!);
        const gaussian = branchBones.map(joint => Math.exp(-.5 * point.distanceToSquared(centers[joint]!) / (headBranch ? .10 : salamander ? .13 : .14) ** 2));
        const total = gaussian.reduce((sum, value) => sum + value, 0);
        branchBones.forEach((joint, i) => field[joint] = gaussian[i]! / total * membership[index]!);
        return field;
      });
      for (let iteration = 0; iteration < 8; iteration++) {
        const next = fields.map(field => field.slice());
        for (let i = 0; i < vertices.length; i++) {
          if (!affected[i] || !adjacent[i]!.size) continue;
          let total = 0; const average = new Float64Array(joints.length);
          for (const neighbor of adjacent[i]!) {
            const mass = 1 / Math.max(.005, vertices[i]!.distanceTo(vertices[neighbor]!)); total += mass;
            for (let joint = 0; joint < average.length; joint++) average[joint] = average[joint]! + fields[neighbor]![joint]! * mass;
          }
          for (let joint = 0; joint < average.length; joint++) next[i]![joint] = fields[i]![joint]! * .6 + average[joint]! / total * .4;
        }
        fields = next;
      }
      let changedVertices = 0;
      for (let i = 0; i < vertices.length; i++) {
        if (!affected[i]) continue;
        const selected = Array.from(fields[i]!, (weight, joint) => ({ joint, weight })).sort((a, b) => b.weight - a.weight).slice(0, 4);
        const total = selected.reduce((sum, entry) => sum + entry.weight, 0);
        for (const vertex of originals[i]!) {
          js.setElement(vertex, selected.map(entry => entry.joint)); ws.setElement(vertex, selected.map(entry => entry.weight / total)); changedVertices++;
        }
      }
      reports.push({ branch: group.name, branchVertices: branch.size, changedVertices });
    }
  }
  return { branches: reports, method: 'Welded topology only for branch classification, harmonic attachment memberships, branch-only skin weights and eight local diffusion passes. Original mesh topology, coordinates and textures remain byte-identical.' };
}

function measureMotion(doc: Document, assetId: string) {
  const footNames = assetId === 'creature_rimeback_tortoise' ? ['ForeLFoot', 'ForeRFoot', 'HindLFoot', 'HindRFoot']
    : assetId === 'creature_cindercrest_salamander' ? ['FrontLeftFoot', 'FrontRightFoot', 'HindLeftFoot', 'HindRightFoot']
      : ['ForePaw_L', 'ForePaw_R', 'HindPaw_L', 'HindPaw_R'];
  const feet = footNames.map(name => bone(doc, name)), head = bone(doc, assetId === 'creature_cindercrest_salamander' ? 'Muzzle' : 'Head');
  const pose = storedPose(doc), frames = 120;
  const gait = (name: string) => {
    const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === name)!, seconds = duration(clip);
    const points = feet.map(() => [] as Vector3[]);
    for (let frame = 0; frame <= frames; frame++) {
      restorePose(pose); applyClip(clip, frame * seconds / frames);
      feet.forEach((foot, i) => points[i]!.push(position(foot)));
    }
    const contacts = points.map((track, i) => {
      const low = Math.min(...track.map(point => point.y)), high = Math.max(...track.map(point => point.y));
      const window = Math.max(.005, Math.min(.04, (high - low) * .15)), speeds: number[] = [];
      for (let frame = 1; frame <= frames; frame++) {
        const a = track[frame - 1]!, b = track[frame]!, speed = (a.z - b.z) * frames / seconds;
        if ((a.y + b.y) * .5 < low + window && speed > .001) speeds.push(speed);
      }
      speeds.sort((a, b) => a - b);
      return { bone: feet[i]!.getName(), contactSamples: speeds.length, stanceMps: speeds[Math.floor(speeds.length / 2)] ?? 0 };
    });
    const speeds = contacts.map(contact => contact.stanceMps).filter(speed => speed > 0).sort((a, b) => a - b);
    if (speeds.length !== 4) throw new Error(`${assetId} ${name} does not have backward ground stance on every foot`);
    return { mps: (speeds[1]! + speeds[2]!) / 2, contacts };
  };
  try {
    const walk = gait('Walk'), run = gait('Run'), attack = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Attack')!;
    let forward = -Infinity, contactNormalized = 0;
    for (let frame = 0; frame <= frames; frame++) {
      restorePose(pose); applyClip(attack, duration(attack) * frame / frames);
      const reach = position(head).z;
      if (reach > forward) { forward = reach; contactNormalized = frame / frames; }
    }
    const headPeakPhase = contactNormalized;
    // The native dragon take is attackMouth. Its jaw snaps after the neck retracts;
    // the back of the skull is not the attack contact marker. Preserve the verified
    // source snap phase because this transfer preserves the take's complete timing.
    if (assetId === 'creature_quarry_nightmare') contactNormalized = .4336734873237641;
    return { walk, run, contactNormalized, headPeakPhase,
      method: 'Median backward distal-joint speed in each foot ground-contact window; contact at maximum target head/muzzle reach, except the dragon native attackMouth snap uses its verified source contact phase.' };
  } finally { restorePose(pose); }
}

function takes(donor: Document, durations: Partial<Record<string, number>> = {}): CreatureMotionProfile['clips'] {
  const names = new Set(donor.getRoot().listAnimations().map(clip => clip.getName()));
  const clips: CreatureMotionProfile['clips'] = {};
  for (const name of ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death']) {
    if (!names.has(name)) throw new Error(`Missing native reptile donor take ${name}`);
    clips[name] = { source: name, ...(durations[name] ? { duration: durations[name] } : {}),
      ...(['Idle', 'Walk', 'Run'].includes(name) ? { loop: true } : {}),
      ...(name === 'Death' ? { holdLastSeconds: .35 } : {}) };
  }
  return clips;
}

async function transfer(doc: Document, context: CreatureRepairContext, donorId: string,
  mapping: Record<string, string>, root: string, ratio: [string, string, string, string],
  durations: Partial<Record<string, number>>, nativeBind: boolean, notes: string[]): Promise<CreatureRepairResult> {
  const donor = await context.readAsset(donorId);
  const restoredJoints = nativeBind ? restoreStudioBind(donor) : 0;
  const translationScale = context.assetId === 'creature_cindercrest_salamander'
    ? (length(doc, ratio[0], ratio[0].replace('Upper', 'Lower')) + length(doc, ratio[0].replace('Upper', 'Lower'), ratio[1]))
      / (length(donor, ratio[2], ratio[2].replace('_HipSHJnt', '_KneeSHJnt')) + length(donor, ratio[2].replace('_HipSHJnt', '_KneeSHJnt'), ratio[3]))
    : length(doc, ratio[0], ratio[1]) / length(donor, ratio[2], ratio[3]);
  const anatomicalDirections = context.assetId === 'creature_cindercrest_salamander'
    ? Object.fromEntries(['FrontLeft', 'FrontRight', 'HindLeft', 'HindRight'].flatMap(prefix => [[prefix + 'Upper', prefix + 'Lower'], [prefix + 'Lower', prefix + 'Foot']])) : undefined;
  const report = retargetCreatureMotion(doc, donor, {
    mapping, directionChildren: anatomicalDirections, sourceToTargetRotation: [0, 0, 0, 1], root: { target: root, translationScale, horizontal: 'in-place' },
    clips: takes(donor, durations), replaceAnimations: true, samplesPerSecond: 30,
    grounding: { floor: .003, maxCorrection: 2.5 },
  });
  const translationRepair = context.assetId === 'creature_rimeback_tortoise'
    ? restoreTortoiseTranslations(doc, donor, mapping, translationScale)
    : context.assetId === 'creature_quarry_nightmare' ? restoreDragonChestAttack(doc, donor) : undefined;
  const deathRepair = context.assetId === 'creature_rimeback_tortoise' ? settleTortoiseDeath(doc, donor, mapping)
    : context.assetId === 'creature_quarry_nightmare' ? settleDragonDeath(doc)
      : context.assetId === 'creature_cindercrest_salamander' ? settleSalamanderTail(doc, donor, mapping) : undefined;
  const measurements = measureMotion(doc, context.assetId);
  const seconds = (name: string) => duration(doc.getRoot().listAnimations().find(clip => clip.getName() === name)!);
  return { changes: notes, provenance: { donorAssetId: donorId, restoredDonorBindJoints: restoredJoints,
    anatomicalMapping: mapping, anatomicalDirections, retarget: report, translationRepair, deathRepair, measurements, sourceGeometryAndTexturesPreserved: true,
    restDirections: anatomicalDirections ? 'Match source hip-to-knee and knee-to-paw directions after fitting the target joints to actual limb bends.'
      : 'Preserve target anatomical directions and transfer donor world-space rotation deltas, with explicit corpse settling where anatomy requires it.' },
    motion: { walkClipSeconds: seconds('Walk'), runClipSeconds: seconds('Run'), attackSeconds: seconds('Attack'),
      impliedWalkMps: measurements.walk.mps, impliedRunMps: measurements.run.mps, contactNormalized: measurements.contactNormalized, groundY: .003 },
    warnings: ['All clips require devdocs visual acceptance; numeric deformation checks do not establish correct anatomy.'] };
}

export async function repair(doc: Document, context: CreatureRepairContext): Promise<CreatureRepairResult> {
  if (!assetIds.includes(context.assetId as typeof assetIds[number])) throw new Error(`Unowned reptile ${context.assetId}`);
  if (context.assetId === 'creature_slateback_tortoise' || context.assetId === 'creature_ashscale_monitor') {
    return { changes: [],
      provenance: { preservedAuthoredMotion: true },
      warnings: ['The source has anatomical IK with complete limb channels. Source review found no defect that justifies replacing its motion; devdocs visual review remains required.'] };
  }
  if (context.assetId === 'creature_cindercrest_salamander') {
    const anatomyRepair = repairCinderAnatomy(doc);
    const skinRepair = repairBranchWeights(doc, context.assetId);
    const prefix = 'FireSalamander_';
    const mapping: Record<string, string> = { SalamanderRoot: `${prefix}MAINSHJnt`, Pelvis: `${prefix}ROOTSHJnt`,
      Spine: `${prefix}Spine_02SHJnt`, Chest: `${prefix}Spine_TopSHJnt`, Neck: `${prefix}Neck_01SHJnt`,
      Head: `${prefix}Neck_TopSHJnt`, Muzzle: `${prefix}Head_TopSHJnt`, TailBase: `${prefix}Tail_01_01SHJnt`,
      TailMid: `${prefix}Tail_01_04SHJnt`, TailTip: `${prefix}Tail_01_07SHJnt` };
    // The custom target calls negative X "Left"; the studio calls negative X "r".
    for (const [side, source] of [['Left', 'r'], ['Right', 'l']]) for (const [targetLeg, sourceLeg] of [['Front', 'FrontLeg'], ['Hind', 'HindLeg']]) {
      mapping[`${targetLeg}${side}Upper`] = `${prefix}${source}_${sourceLeg}_HipSHJnt`;
      mapping[`${targetLeg}${side}Lower`] = `${prefix}${source}_${sourceLeg}_KneeSHJnt`;
      mapping[`${targetLeg}${side}Foot`] = `${prefix}${source}_${sourceLeg}_BallSHJnt`;
    }
    const result = await transfer(doc, context, 'creature_kiln_salamander', mapping, 'Pelvis',
      ['FrontLeftUpper', 'FrontLeftFoot', `${prefix}r_FrontLeg_HipSHJnt`, `${prefix}r_FrontLeg_BallSHJnt`], {}, true,
      ['Replaced sparse sine-rotation clips with the studio salamander movement and death sequence.', 'Separated connected tail and head skin weights from nearby torso and leg surfaces; preserved the mesh and PBR maps.', 'Baked complete state poses and grounded the weighted mesh.']);
    result.provenance!.skinRepair = skinRepair;
    result.provenance!.anatomyRepair = anatomyRepair;
    return result;
  }
  if (context.assetId === 'creature_rimeback_tortoise') {
    let roundoffWeights = 0;
    for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
      const accessor = primitive.getAttribute('WEIGHTS_0');
      if (!accessor) continue;
      for (let vertex = 0; vertex < accessor.getCount(); vertex++) {
        const values = accessor.getElement(vertex, []);
        if (values.some(weight => weight < -1e-12)) throw new Error('Rimeback has substantive negative skin weights');
        if (values.some(weight => weight < 0)) {
          accessor.setElement(vertex, values.map(weight => Math.max(0, weight))); roundoffWeights++;
        }
      }
    }
    const skinRepair = repairRimebackHindWeights(doc);
    const mapping: Record<string, string> = { Root: 'tortoise_root', Shell: 'tortoise_body', Neck: 'tortoise_neck_base',
      Head: 'tortoise_head', Tail: 'tortoise_tail_base' };
    for (const [targetEnd, sourceEnd] of [['Fore', 'front'], ['Hind', 'rear']]) for (const [targetSide, sourceSide] of [['L', 'left'], ['R', 'right']])
      for (const part of ['Upper', 'Lower', 'Foot']) mapping[`${targetEnd}${targetSide}${part}`] = `tortoise_${sourceEnd}_${sourceSide}_${part.toLowerCase()}`;
    const result = await transfer(doc, context, 'creature_slateback_tortoise', mapping, 'Root',
      ['ForeLUpper', 'ForeLFoot', 'tortoise_front_left_upper', 'tortoise_front_left_foot'], {}, false,
      ['Replaced sparse paired leg swings with the existing anatomical tortoise four-beat IK sequence.', 'Preserved the rigid shell and original Tripo geometry and PBR maps.',
        'Retained the source body collapse and neck retraction through the shorter target chain, and folded the legs during Death.',
        'Bound the connected inner hind toes to their leg chain; those vertices were incorrectly bound entirely to Shell/Tail.',
        `Clamped negative arithmetic roundoff in ${roundoffWeights} source weight tuples.`]);
    result.provenance!.roundoffWeightTuples = roundoffWeights;
    result.provenance!.skinRepair = skinRepair;
    return result;
  }
  const skinRepair = repairBranchWeights(doc, context.assetId);
  const mapping: Record<string, string> = { DragonRoot: 'black_wilderness_dragon_source', Pelvis: 'Root', SpineRear: 'Spine01',
    SpineMid: 'Spine02', Chest: 'Chest', NeckBase: 'Neck01', NeckMid: 'Neck03', Head: 'Head', Jaw: 'Jaw01',
    TailBase: 'joint19', TailMid: 'joint20', TailEnd: 'joint22', TailTip: 'joint23' };
  for (const [targetSide, sourceSide] of [['L', 'R'], ['R', 'L']]) {
    const right = sourceSide === 'R';
    mapping[`ForeUpper_${targetSide}`] = `UpperArm_${sourceSide}`;
    mapping[`ForeLower_${targetSide}`] = `${right ? 'RowerArm' : 'LowerArm'}_${sourceSide}`;
    mapping[`ForePaw_${targetSide}`] = `Hand_${sourceSide}`;
    mapping[`HindUpper_${targetSide}`] = `${right ? 'UpperReg' : 'UpperLeg'}_${sourceSide}`;
    mapping[`HindLower_${targetSide}`] = `${right ? 'RowerReg' : 'LowerLeg'}_${sourceSide}`;
    mapping[`HindPaw_${targetSide}`] = `Feet_${sourceSide}`;
    mapping[`WingShoulder_${targetSide}`] = `Wing01_${sourceSide}`;
    mapping[`WingArm_${targetSide}`] = `Wing02_${sourceSide}`;
    mapping[`WingElbow_${targetSide}`] = `Wing03_${sourceSide}`;
    mapping[`WingTip_${targetSide}`] = `WingIndex03_${sourceSide}`;
    mapping[`WingFingerA_${targetSide}`] = `WingMiddle04_${sourceSide}`;
    mapping[`WingFingerB_${targetSide}`] = `WingPinky04_${sourceSide}`;
  }
  const result = await transfer(doc, context, 'creature_black_wilderness_dragon', mapping, 'Pelvis',
    ['ForeUpper_L', 'ForePaw_L', 'UpperArm_R', 'Hand_R'], {}, true,
    ['Replaced generic procedural pale-dragon motion with compatible studio quadruped dragon takes.', 'Matched left and right by world anatomy and transferred the articulated wing sequence.',
      'Settled the raised wing membranes during the final collapse so their tips no longer prop the body above ground.',
      'Preserved source topology, pale texture maps and bind geometry, with complete poses and grounded death.']);
  result.provenance!.skinRepair = skinRepair;
  return result;
}
