import type { Document, Node } from '@gltf-transform/core';
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { CreatureRepairContext, CreatureRepairResult } from '../../repairProfile.js';
import { retargetCreatureMotion, type CreatureMotionProfile } from '../../retarget.js';
import { addChannel, applyClip, duration, removeClip, restorePose, storedPose } from '../../../creature-motion/pose.js';
import { deformedBounds } from '../../../creature-motion/validate-deformation.js';
import { repairBullGeometry } from './bullGeometry.js';
import { repairThornAnatomy } from './thornAnatomy.js';

export const assetIds = ['creature_boss_galeskin', 'creature_rootdelve_badger', 'creature_thorn_maw'] as const;

/** Studio inverse binds use mesh-local coordinates, including their imported unit basis. */
function restoreDonorBind(doc: Document) {
  const worlds = new Map<Node, Matrix4>();
  for (const mesh of doc.getRoot().listNodes().filter(node => node.getSkin())) {
    const skin = mesh.getSkin()!, inverse = skin.getInverseBindMatrices();
    if (!inverse) throw new Error('Studio donor has no inverse binds');
    const meshWorld = new Matrix4().fromArray(mesh.getWorldMatrix());
    skin.listJoints().forEach((joint, i) => {
      const bind = meshWorld.clone().multiply(new Matrix4().fromArray(inverse.getElement(i, [])).invert());
      const existing = worlds.get(joint);
      if (existing && existing.elements.some((value, axis) => Math.abs(value - bind.elements[axis]!) > 1e-4)) {
        throw new Error(`Conflicting studio bind for ${joint.getName()}`);
      }
      worlds.set(joint, bind);
    });
  }
  for (const [joint, world] of worlds) {
    const parent = joint.getParentNode();
    const parentWorld = parent ? worlds.get(parent) ?? new Matrix4().fromArray(parent.getWorldMatrix()) : new Matrix4();
    joint.setMatrix(parentWorld.clone().invert().multiply(world).toArray());
  }
  let maximumBindError = 0;
  for (const mesh of doc.getRoot().listNodes().filter(node => node.getSkin())) {
    const meshWorld = new Matrix4().fromArray(mesh.getWorldMatrix());
    const skin = mesh.getSkin()!, inverse = skin.getInverseBindMatrices()!;
    skin.listJoints().forEach((joint, i) => {
      const actual = new Matrix4().fromArray(joint.getWorldMatrix()).multiply(new Matrix4().fromArray(inverse.getElement(i, [])));
      actual.elements.forEach((value, axis) => { maximumBindError = Math.max(maximumBindError, Math.abs(value - meshWorld.elements[axis]!)); });
    });
  }
  if (maximumBindError > 1e-4) throw new Error(`Studio donor bind reconstruction failed: ${maximumBindError}`);
  return { joints: worlds.size, maximumBindError };
}

const worldPosition = (doc: Document, name: string) => {
  const node = doc.getRoot().listNodes().find(node => node.getName() === name);
  if (!node) throw new Error(`Missing anatomical node ${name}`);
  return new Vector3().setFromMatrixPosition(new Matrix4().fromArray(node.getWorldMatrix()));
};
const length = (doc: Document, a: string, b: string) => worldPosition(doc, a).distanceTo(worldPosition(doc, b));

function repairGaleskinCutoff(doc: Document) {
  let affected = 0, clamped = 0;
  const smooth = (a: number, b: number, value: number) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (const node of doc.getRoot().listNodes()) for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
    const skin = node.getSkin()!, joints = skin.listJoints(), torso = joints.findIndex(joint => joint.getName() === 'Torso');
    const indices = primitive.getAttribute('JOINTS_0')!, weights = primitive.getAttribute('WEIGHTS_0')!, positions = primitive.getAttribute('POSITION')!;
    for (let vertex = 0; vertex < positions.getCount(); vertex++) {
      const p = positions.getElement(vertex, [] as number[]), js = indices.getElement(vertex, [] as number[]), ws = weights.getElement(vertex, [] as number[]);
      const oldFactor = p[1]! < .16 && Math.abs(p[0]!) > .20 ? .03 : 1;
      const factor = 1 - .97 * (1 - smooth(.10, .30, p[1]!)) * smooth(.10, .24, Math.abs(p[0]!));
      const slot = js.indexOf(torso);
      if (slot >= 0 && Math.abs(factor - oldFactor) > 1e-8 && ws[slot]! > 0) { ws[slot] = ws[slot]! * factor / oldFactor; affected++; }
      ws.forEach((value, slot) => { if (value < 0) { ws[slot] = 0; clamped++; } });
      const sum = ws.reduce((a, b) => a + b, 0); weights.setElement(vertex, ws.map(value => value / sum));
    }
  }
  return { affected, clamped, reason: 'The source changed torso influence abruptly at y=.16: adjacent hind-foot vertices had torso weights .3246 and .0131, producing 11x edge stretch. Replaced that hard spatial threshold with a smooth .10-.30m envelope; removed negative roundoff weights.' };
}

function repairGaleskinAnatomy(doc: Document) {
  const mesh = doc.getRoot().listNodes().find(node => node.getSkin())!, skin = mesh.getSkin()!, bones = skin.listJoints();
  const primitive = mesh.getMesh()!.listPrimitives()[0]!, positions = primitive.getAttribute('POSITION')!;
  const joints = primitive.getAttribute('JOINTS_0')!, weights = primitive.getAttribute('WEIGHTS_0')!, indices = primitive.getIndices()!.getArray()!;
  const points = Array.from({ length: positions.getCount() }, (_, index) => new Vector3().fromArray(positions.getElement(index, [])));
  const neighbors = points.map(() => new Set<number>()), welds = new Map<string, number>();
  points.forEach((point, index) => {
    const key = point.toArray().map(value => value.toFixed(5)).join(','), previous = welds.get(key);
    if (previous === undefined) welds.set(key, index);
    else { neighbors[index]!.add(previous); neighbors[previous]!.add(index); }
  });
  for (let i = 0; i < indices.length; i += 3) for (const [a, b] of [[indices[i]!, indices[i + 1]!], [indices[i + 1]!, indices[i + 2]!], [indices[i + 2]!, indices[i]!]]) {
    neighbors[a!]!.add(b!); neighbors[b!]!.add(a!);
  }
  const headSeed = points.reduce((best, point, index) => point.y > 1.08 && point.z > points[best]!.z ? index : best, points.findIndex(point => point.y > 1.08));
  const tailSeed = points.reduce((best, point, index) => point.z < points[best]!.z ? index : best, 0);
  const tailCut = (a: Vector3, b: Vector3) => (a.z + .25) * (b.z + .25) < 0 && a.y + (b.y - a.y) * (-.25 - a.z) / (b.z - a.z) < .85;
  const flood = (seed: number, allowed: (a: number, b: number) => boolean) => {
    const selected = new Set([seed]), queue = [seed];
    for (let at = 0; at < queue.length; at++) for (const next of neighbors[queue[at]!]!) {
      if (selected.has(next) || !allowed(queue[at]!, next)) continue;
      selected.add(next); queue.push(next);
    }
    return selected;
  };
  const head = flood(headSeed, (_, b) => points[b]!.y >= 1.08), tail = flood(tailSeed, (a, b) => !tailCut(points[a]!, points[b]!));
  if ([...head].some(index => tail.has(index)) || head.size < 500 || head.size > 1300 || tail.size < 300 || tail.size > 900) {
    throw new Error(`Galeskin anatomical components differ from the audited source: head ${head.size}, tail ${tail.size}`);
  }
  const distances = (selected: Set<number>) => {
    const distance = new Float64Array(points.length).fill(Infinity), queue: number[] = [];
    for (const at of selected) if ([...neighbors[at]!].some(next => !selected.has(next))) { distance[at] = 0; queue.push(at); }
    for (let i = 0; i < queue.length; i++) {
      const at = queue[i]!;
      for (const next of neighbors[at]!) if (selected.has(next)) {
        const value = distance[at]! + points[at]!.distanceTo(points[next]!);
        if (value < distance[next]! - 1e-9) { distance[next] = value; queue.push(next); }
      }
    }
    return distance;
  };
  const hd = distances(head), td = distances(tail), headIndex = bones.findIndex(node => node.getName() === 'Head'), tailIndex = bones.findIndex(node => node.getName() === 'Tail');
  const tailBone = bones[tailIndex]!, inverse = skin.getInverseBindMatrices()!, meshWorld = new Matrix4().fromArray(mesh.getWorldMatrix());
  const previousTailBind = new Matrix4().fromArray(tailBone.getWorldMatrix()).multiply(new Matrix4().fromArray(inverse.getElement(tailIndex, [])));
  const tailAttachment: [number, number, number] = [.095, .696, -.25];
  const tailWorld = meshWorld.clone().multiply(new Matrix4().makeTranslation(...tailAttachment));
  tailBone.setMatrix(new Matrix4().fromArray(tailBone.getParentNode()!.getWorldMatrix()).invert().multiply(tailWorld).toArray());
  inverse.setElement(tailIndex, tailWorld.clone().invert().multiply(meshWorld).toArray());
  const newTailBind = new Matrix4().fromArray(tailBone.getWorldMatrix()).multiply(new Matrix4().fromArray(inverse.getElement(tailIndex, [])));
  const maximumTailBindError = Math.max(...newTailBind.elements.map((value, index) => Math.abs(value - previousTailBind.elements[index]!)));
  if (maximumTailBindError > 1e-6) throw new Error(`Galeskin tail rebind changes rest geometry: ${maximumTailBindError}`);
  let changed = 0;
  for (let index = 0; index < points.length; index++) {
    const selected = head.has(index) ? headIndex : tail.has(index) ? tailIndex : -1;
    if (selected < 0) continue;
    const distance = selected === headIndex ? hd[index]! : td[index]!, t = Math.max(0, Math.min(1, distance / .18)), amount = t * t * (3 - 2 * t);
    if (amount === 0) continue;
    const ji = joints.getElement(index, [] as number[]), we = weights.getElement(index, [] as number[]), scores = new Float64Array(bones.length);
    we.forEach((value, slot) => { const at = ji[slot]!; scores[at] = scores[at]! + value * (1 - amount); }); scores[selected] = scores[selected]! + amount;
    const top = Array.from(scores, (weight, joint) => ({ weight, joint })).sort((a, b) => b.weight - a.weight).slice(0, 4), sum = top.reduce((total, item) => total + item.weight, 0);
    joints.setElement(index, top.map(item => item.joint)); weights.setElement(index, top.map(item => item.weight / sum)); changed++;
  }
  return { headVertices: head.size, tailVertices: tail.size, changed, neckCutY: 1.08, tailCutZ: -.25, geodesicBlendLength: .18,
    headPivot: [0, 1.18, .61], tailAttachment, maximumTailBindError,
    evidence: 'Textured source projections identify backward skull crown vertex4173 as98.36%Torso and curled tail vertex1151 as91.35%Torso. Beak faces+Z; connected crown is distinct from the lower back mane.',
    method: 'Weld position seams, seed connected skull and tail surfaces across measured neck/stalk cuts, and feather full anatomical ownership by surface distance from each cut; geometry and maps remain unchanged.' };
}

function rebuildBullRig(doc: Document, landmarks: Record<string, [number, number, number]>,
  frame: { lateral: [number, number, number]; forward: [number, number, number]; center: number }) {
  const mesh = doc.getRoot().listNodes().find(node => node.getSkin())!, skin = mesh.getSkin()!, joints = skin.listJoints();
  const byName = new Map(joints.map((joint, index) => [joint.getName(), { joint, index }]));
  for (const [name, point] of Object.entries(landmarks)) {
    const entry = byName.get(name);
    if (!entry) throw new Error(`Bull anatomical joint is absent: ${name}`);
    const parent = entry.joint.getParentNode(), origin = parent ? landmarks[parent.getName()] ?? [0, 0, 0] : [0, 0, 0];
    entry.joint.setTranslation(point.map((value, axis) => value - origin[axis]!) as [number, number, number])
      .setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  }
  const inverse = skin.getInverseBindMatrices()!;
  joints.forEach((joint, i) => {
    const point = landmarks[joint.getName()];
    if (!point) throw new Error(`Bull bind landmark is absent: ${joint.getName()}`);
    inverse.setElement(i, new Matrix4().makeTranslation(-point[0], -point[1], -point[2]).toArray());
  });
  const ends: Record<string, string> = { BullRoot: 'BullShoulders', BullRump: 'BullRoot', BullShoulders: 'BullNeck', BullNeck: 'BullHead' };
  for (const side of ['Left', 'Right']) for (const limb of ['Front', 'Hind']) {
    ends[`${limb}${side}Upper`] = `${limb}${side}Lower`;
    ends[`${limb}${side}Lower`] = `${limb}${side}Hoof`;
  }
  const smooth = (a: number, b: number, value: number) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); };
  const lateral = new Vector3().fromArray(frame.lateral), forward = new Vector3().fromArray(frame.forward);
  const capsules = joints.map((joint, index) => {
    const name = joint.getName(), a = new Vector3().fromArray(landmarks[name]!);
    const b = ends[name] ? new Vector3().fromArray(landmarks[ends[name]!]!)
      : name === 'BullHead' ? a.clone().addScaledVector(forward, .13).add(new Vector3(0, -.07, 0))
        : a.clone().addScaledVector(forward, .055).add(new Vector3(0, -.015, 0));
    return { name, index, a, b, sigma: name === 'BullRoot' ? .14 : name === 'BullHead' ? .15 : name.startsWith('Bull') ? .095 : .055 };
  });
  let vertices = 0, maximumWeightSumError = 0;
  const contactComponents: { name: string; vertices: number; center: number[] }[] = [];
  for (const primitive of mesh.getMesh()!.listPrimitives()) {
    const oldJoints = primitive.getAttribute('JOINTS_0'), oldWeights = primitive.getAttribute('WEIGHTS_0');
    const positions = primitive.getAttribute('POSITION')!, ji = new Uint16Array(positions.getCount() * 4), we = new Float32Array(ji.length);
    // The intact hoof can cross the sagittal plane. Its connected surface identifies
    // which limb owns it; a spatial left/right threshold would split the hoof again.
    const parents = Array.from({ length: positions.getCount() }, (_, i) => i);
    const find = (index: number): number => parents[index] === index ? index : (parents[index] = find(parents[index]!));
    const join = (a: number, b: number) => { parents[find(a)] = find(b); };
    const welded = new Map<string, number>();
    const low = (index: number) => positions.getElement(index, [])[1]! < .29999;
    for (let vertex = 0; vertex < positions.getCount(); vertex++) {
      if (!low(vertex)) continue;
      const key = positions.getElement(vertex, [] as number[]).map(value => value.toFixed(6)).join(',');
      if (welded.has(key)) join(vertex, welded.get(key)!); else welded.set(key, vertex);
    }
    const ix = primitive.getIndices()!.getArray()!;
    for (let i = 0; i < ix.length; i += 3) for (const [a, b] of [[ix[i]!, ix[i + 1]!], [ix[i + 1]!, ix[i + 2]!], [ix[i + 2]!, ix[i]!]]) {
      if (low(a!) && low(b!)) join(a!, b!);
    }
    const groups = new Map<number, number[]>();
    for (let vertex = 0; vertex < positions.getCount(); vertex++) if (low(vertex)) {
      const index = find(vertex); if (!groups.has(index)) groups.set(index, []); groups.get(index)!.push(vertex);
    }
    const component = new Map<number, string>();
    for (const group of groups.values()) {
      if (!group.some(vertex => positions.getElement(vertex, [])[1]! < .05) || group.length < 20) continue;
      const center = group.reduce((sum, vertex) => sum.add(new Vector3().fromArray(positions.getElement(vertex, []))), new Vector3()).divideScalar(group.length);
      const name = `${center.dot(forward) > -.15 ? 'Front' : 'Hind'}${center.dot(lateral) > frame.center ? 'Left' : 'Right'}`;
      contactComponents.push({ name, vertices: group.length, center: center.toArray() }); group.forEach(vertex => component.set(vertex, name));
    }
    if (new Set(contactComponents.map(group => group.name)).size !== 4) throw new Error('Reconstructed bull must have four separate anatomical hoof components');
    // Carry surface ownership through each thigh seam. Native ring vertices sit
    // just above the geometric cut, so testing their X side alone assigns the
    // narrow inside of the repaired thigh to its opposite leg.
    const neighbors = Array.from({ length: positions.getCount() }, () => new Set<number>());
    for (let i = 0; i < ix.length; i += 3) for (const [a, b] of [[ix[i]!, ix[i + 1]!], [ix[i + 1]!, ix[i + 2]!], [ix[i + 2]!, ix[i]!]]) {
      neighbors[a!]!.add(b!); neighbors[b!]!.add(a!);
    }
    const points = Array.from({ length: positions.getCount() }, (_, index) => new Vector3().fromArray(positions.getElement(index, [])));
    const allWelded = new Map<string, number>();
    points.forEach((point, index) => {
      const key = point.toArray().map(value => value.toFixed(6)).join(','), previous = allWelded.get(key);
      if (previous === undefined) allWelded.set(key, index);
      else { neighbors[index]!.add(previous); neighbors[previous]!.add(index); }
    });
    const componentDistances = [...new Set(component.values())].map(name => {
      const distance = new Float64Array(points.length).fill(Infinity), queue: number[] = [];
      for (const [vertex, owner] of component) if (owner === name) { distance[vertex] = 0; queue.push(vertex); }
      for (let index = 0; index < queue.length; index++) {
        const at = queue[index]!;
        for (const next of neighbors[at]!) {
          if (points[next]!.y > .48) continue;
          const nextDistance = distance[at]! + points[at]!.distanceTo(points[next]!);
          if (nextDistance >= distance[next]! - 1e-9) continue;
          distance[next] = nextDistance; queue.push(next);
        }
      }
      return { name, distance };
    });
    for (let vertex = 0; vertex < positions.getCount(); vertex++) {
      const p = new Vector3().fromArray(positions.getElement(vertex, [])), l = p.dot(lateral) - frame.center, f = p.dot(forward);
      const nearestSurface = Math.min(...componentDistances.map(item => item.distance[vertex]!));
      const ownership = componentDistances.map(item => ({ name: item.name,
        value: Number.isFinite(nearestSurface) ? Math.exp(-(item.distance[vertex]! - nearestSurface) / .04) : 0 }));
      const ownershipSum = ownership.reduce((sum, item) => sum + item.value, 0);
      const scores = capsules.map(capsule => {
        const segment = capsule.b.clone().sub(capsule.a), t = Math.max(0, Math.min(1, p.clone().sub(capsule.a).dot(segment) / segment.lengthSq()));
        const distance = p.distanceTo(capsule.a.clone().addScaledVector(segment, t));
        let gate = 1;
        if (/^(Front|Hind)/.test(capsule.name)) {
          const side = capsule.name.includes('Left') ? 1 : -1;
          let sideGate = .001 + .999 * smooth(-.04, .14, l * side);
          const blend = smooth(.30, .48, p.y);
          if (ownershipSum > 0) {
            const owner = ownership.find(item => capsule.name.startsWith(item.name))!.value / ownershipSum;
            sideGate = owner + (sideGate - owner) * blend;
          }
          gate = sideGate * (1 - smooth(.35, .56, p.y));
          gate *= capsule.name.startsWith('Front') ? smooth(-.30, -.05, f) : 1 - smooth(-.30, -.05, f);
        } else if (capsule.name === 'BullHead' || capsule.name === 'BullNeck') {
          gate = smooth(.24, .43, p.y) * smooth(.02, .22, f);
        } else {
          gate = smooth(.18, .43, p.y) * (1 - .85 * smooth(.10, .32, f));
        }
        return { ...capsule, score: Math.max(0, gate) * Math.exp(-.5 * (distance / capsule.sigma) ** 2) };
      }).sort((a, b) => b.score - a.score).slice(0, 4);
      const sum = scores.reduce((total, item) => total + item.score, 0);
      if (!(sum > 0)) throw new Error(`Bull vertex ${vertex} has no anatomical influence`);
      scores.forEach((item, slot) => { ji[vertex * 4 + slot] = item.index; we[vertex * 4 + slot] = item.score / sum; });
      maximumWeightSumError = Math.max(maximumWeightSumError, Math.abs(1 - we[vertex * 4]! - we[vertex * 4 + 1]! - we[vertex * 4 + 2]! - we[vertex * 4 + 3]!));
      vertices++;
    }
    const buffer = doc.getRoot().listBuffers()[0]!;
    primitive.setAttribute('JOINTS_0', doc.createAccessor('Redmane anatomical joint indices').setType('VEC4').setArray(ji).setBuffer(buffer));
    primitive.setAttribute('WEIGHTS_0', doc.createAccessor('Redmane anatomical weights').setType('VEC4').setArray(we).setBuffer(buffer));
    for (const accessor of [oldJoints, oldWeights]) if (accessor?.listParents().every(parent => parent.propertyType === 'Root')) accessor.dispose();
  }
  const meshWorld = new Matrix4().fromArray(mesh.getWorldMatrix());
  let maximumBindMatrixError = 0;
  joints.forEach((joint, index) => {
    const matrix = new Matrix4().fromArray(joint.getWorldMatrix()).multiply(new Matrix4().fromArray(inverse.getElement(index, [])));
    matrix.elements.forEach((value, i) => { maximumBindMatrixError = Math.max(maximumBindMatrixError, Math.abs(value - meshWorld.elements[i]!)); });
  });
  if (maximumBindMatrixError > 1e-4) throw new Error(`Rebuilt bull bind moved its rest geometry: ${maximumBindMatrixError}`);
  return { landmarks, vertices, maximumWeightSumError, maximumBindMatrixError, contactComponents,
    method: 'Measured hoof, elbow and posterior seam centers in the actual diagonal source frame; reset joint-local binds and rebuilt outgoing-segment capsule weights, with smooth geodesic ownership through the hind-thigh join and a forward-position head boundary.' };
}

function drakeMapping() {
  // The custom source calls its negative-X limbs L; the studio's L is positive X.
  return {
    Torso: 'Root', Neck: 'Chest', Head: 'Head', Tail: 'joint5',
    ForeLUpper: 'R_UpperArm', ForeLLower: 'R_RowerArm', ForeLFoot: 'R_Hand',
    ForeRUpper: 'L_UpperArm', ForeRLower: 'L_LowerArm', ForeRFoot: 'L_Hand',
    HindLUpper: 'R_UpperReg', HindLLower: 'R_RowerReg', HindLFoot: 'R_Feet',
    HindRUpper: 'L_UpperLeg', HindRLower: 'L_LowerLeg', HindRFoot: 'L_Feet',
  };
}

function bullMapping() {
  const result: Record<string, string> = { BullRoot: 'Cow_Spine_02SHJnt', BullRump: 'Cow_ROOTSHJnt',
    BullShoulders: 'Cow_Spine_TopSHJnt', BullNeck: 'Cow_Neck_01SHJnt', BullHead: 'Cow_Neck_TopSHJnt' };
  for (const [target, source] of [['Left', 'l'], ['Right', 'r']]) {
    for (const end of ['Front', 'Hind']) {
      result[`${end}${target}Upper`] = `Cow_${source}_${end}Leg_HipSHJnt`;
      result[`${end}${target}Lower`] = `Cow_${source}_${end}Leg_Knee1SHJnt`;
      result[`${end}${target}Hoof`] = `Cow_${source}_${end}Leg_AnkleSHJnt`;
    }
  }
  return result;
}

function plantMapping() {
  // Roots have one flexible woody segment. The terminal node carries the leaf foot,
  // so no donor knee is imposed on the unsegmented source shape.
  return { Bulb: 'Root', Stalk: 'Chest', Maw: 'Head', UpperLip: 'UpperMouth1', LowerLip: 'Jaw1',
    FrontLeftRoot: 'R_UpperArm', FrontLeftFoot: 'R_Hand', FrontRightRoot: 'L_UpperArm', FrontRightFoot: 'L_Hand',
    RearLeftRoot: 'R_UpperReg', RearLeftFoot: 'R_Feet', RearRightRoot: 'L_UpperLeg', RearRightFoot: 'L_Feet' };
}

/** Dragon Boar's horn thrust includes head travel authored below its chest. */
function restoreHeadTravel(doc: Document, donor: Document) {
  const target = doc.getRoot().listNodes().find(node => node.getName() === 'Head')!;
  const source = donor.getRoot().listNodes().find(node => node.getName() === 'Head')!;
  const targetRest = storedPose(doc), sourceRest = storedPose(donor);
  const targetBase = [...target.getTranslation()], sourceBase = new Vector3().fromArray(source.getTranslation());
  const scale = length(doc, 'Neck', 'Head') / length(donor, 'Chest', 'Head');
  const ground = doc.getRoot().listNodes().find(node => node.getName() === 'corealm_retarget_ground')!;
  const report: { clip: string; maximumDisplacement: number; maximumAdditionalGroundCorrection: number }[] = [];
  for (const clip of doc.getRoot().listAnimations()) {
    const sourceClip = donor.getRoot().listAnimations().find(item => item.getName() === clip.getName())!;
    const sourceSeconds = duration(sourceClip);
    const sampler = clip.listChannels().find(channel => channel.getTargetNode() === target && channel.getTargetPath() === 'translation')!.getSampler()!;
    const groundSampler = clip.listChannels().find(channel => channel.getTargetNode() === ground && channel.getTargetPath() === 'translation')!.getSampler()!;
    const times = sampler.getInput()!, translations: number[][] = [], groundTranslations: number[][] = [];
    let maximumDisplacement = 0, maximumAdditionalGroundCorrection = 0;
    for (let frame = 0; frame < times.getCount(); frame++) {
      const time = times.getElement(frame, [])[0]!;
      restorePose(targetRest); applyClip(clip, time); restorePose(sourceRest); applyClip(sourceClip, Math.min(time, sourceSeconds));
      const parentWorld = new Matrix4().fromArray(source.getParentNode()!.getWorldMatrix());
      const delta = new Vector3().fromArray(source.getTranslation()).sub(sourceBase).applyMatrix4(parentWorld)
        .sub(new Vector3().setFromMatrixPosition(parentWorld)).multiplyScalar(scale);
      maximumDisplacement = Math.max(maximumDisplacement, delta.length());
      const targetParent = new Matrix4().fromArray(target.getParentNode()!.getWorldMatrix());
      const localDelta = delta.clone().add(new Vector3().setFromMatrixPosition(targetParent)).applyMatrix4(targetParent.invert());
      target.setTranslation(targetBase.map((value, axis) => value + localDelta.getComponent(axis)) as [number, number, number]);
      translations.push(target.getTranslation());
      const correction = .003 - deformedBounds(doc).min[1]!;
      maximumAdditionalGroundCorrection = Math.max(maximumAdditionalGroundCorrection, Math.abs(correction));
      groundTranslations.push([0, ground.getTranslation()[1] + correction, 0]);
    }
    translations.forEach((value, index) => sampler.getOutput()!.setElement(index, value));
    groundTranslations.forEach((value, index) => groundSampler.getOutput()!.setElement(index, value));
    report.push({ clip: clip.getName(), maximumDisplacement, maximumAdditionalGroundCorrection });
  }
  restorePose(targetRest); restorePose(sourceRest);
  return { target: 'Head', source: 'Head', anatomicalScale: scale, report,
    evidence: 'Native horn attack Head translation moves from -.155m parent-space world Y during windup to +.153m during thrust; Chest translation stays constant.',
    method: 'Transfer only authored Head local translation deltas through the animated donor parent basis, scale by target neck-to-head / donor chest-to-head length, and reconstruct target-parent local offsets.' };
}

/** The bull's broad forelimb stance must fold with the fall instead of propping up the corpse. */
function settleBullDeath(doc: Document, donor: Document) {
  const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Death')!;
  const sourceClip = donor.getRoot().listAnimations().find(clip => clip.getName() === 'Death')!, sourceSeconds = duration(sourceClip);
  const rest = storedPose(doc), sourceRest = storedPose(donor), mapping = bullMapping();
  const targets = new Map(doc.getRoot().listNodes().map(node => [node.getName(), node]));
  const sources = new Map(donor.getRoot().listNodes().map(node => [node.getName(), node]));
  const limbs = ['FrontLeft', 'FrontRight', 'HindLeft', 'HindRight'].flatMap(limb => [['Upper', 'Lower'], ['Lower', 'Hoof']].map(([a, b]) => {
    const name = limb + a, child = limb + b;
    const channel = clip.listChannels().find(channel => channel.getTargetNode() === targets.get(name) && channel.getTargetPath() === 'rotation')!;
    return { node: targets.get(name)!, child: targets.get(child)!, source: sources.get(mapping[name]!)!, sourceChild: sources.get(mapping[child]!)!,
      output: channel.getSampler()!.getOutput()!, samples: [] as number[][] };
  }));
  const hooves = ['FrontLeft', 'FrontRight', 'HindLeft', 'HindRight'].map(limb => {
    const node = targets.get(limb + 'Hoof')!;
    return { node, output: clip.listChannels().find(channel => channel.getTargetNode() === node && channel.getTargetPath() === 'rotation')!.getSampler()!.getOutput()!,
      samples: [] as number[][] };
  });
  const ground = targets.get('corealm_retarget_ground')!;
  const body = targets.get('BullRoot')!, bodySamples: number[][] = [];
  const bodyOutput = clip.listChannels().find(channel => channel.getTargetNode() === body && channel.getTargetPath() === 'rotation')!.getSampler()!.getOutput()!;
  const groundSampler = clip.listChannels().find(channel => channel.getTargetNode() === ground && channel.getTargetPath() === 'translation')!.getSampler()!;
  const times = groundSampler.getInput()!, groundValues = groundSampler.getOutput()!, groundSamples: number[][] = [];
  const position = (node: Node) => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(node.getWorldMatrix()));
  const rotation = (node: Node) => new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(new Matrix4().fromArray(node.getWorldMatrix())));
  let maximumAdditionalGroundCorrection = 0;
  let initialHeight = 0, terminalHeight = 0, terminalBodyCenterY = 0;
  for (let frame = 0; frame < times.getCount(); frame++) {
    const time = times.getElement(frame, [])[0]!, t = Math.max(0, Math.min(1, (time / sourceSeconds - .10) / .50)), amount = t * t * (3 - 2 * t);
    restorePose(rest); applyClip(clip, time); restorePose(sourceRest); applyClip(sourceClip, Math.min(time, sourceSeconds));
    const hoofOrientations = hooves.map(hoof => rotation(hoof.node));
    for (const limb of limbs) {
      const current = position(limb.child).sub(position(limb.node)).normalize(), desired = position(limb.sourceChild).sub(position(limb.source)).normalize();
      const correction = new Quaternion().slerp(new Quaternion().setFromUnitVectors(current, desired), amount);
      const world = rotation(limb.node).premultiply(correction), parent = limb.node.getParentNode();
      limb.node.setRotation((parent ? rotation(parent).invert().multiply(world) : world).normalize().toArray());
      limb.samples.push(limb.node.getRotation());
    }
    hooves.forEach((hoof, index) => {
      hoof.node.setRotation(rotation(hoof.node.getParentNode()!).invert().multiply(hoofOrientations[index]!).normalize().toArray());
      hoof.samples.push(hoof.node.getRotation());
    });
    // The studio cow ends at roughly 74 degrees of roll. The bull's much wider
    // lower arms support that angle like props; finish the roll onto its flank.
    const rollTime = Math.max(0, Math.min(1, (time / sourceSeconds - .55) / .35));
    if (rollTime > 0) {
      const world = rotation(body), up = new Vector3(0, 1, 0).applyQuaternion(world), flat = up.clone().setY(0).normalize();
      const correction = new Quaternion().slerp(new Quaternion().setFromUnitVectors(up, flat), rollTime * rollTime * (3 - 2 * rollTime));
      world.premultiply(correction);
      body.setRotation(rotation(body.getParentNode()!).invert().multiply(world).normalize().toArray());
    }
    bodySamples.push(body.getRotation());
    const correction = .003 - deformedBounds(doc).min[1]!;
    maximumAdditionalGroundCorrection = Math.max(maximumAdditionalGroundCorrection, Math.abs(correction));
    groundSamples.push([0, ground.getTranslation()[1] + correction, 0]);
    if (frame === 0 || frame === times.getCount() - 1) {
      const bounds = deformedBounds(doc), height = bounds.max[1]! - bounds.min[1]!;
      if (frame === 0) initialHeight = height;
      else { terminalHeight = height; terminalBodyCenterY = position(body).y + correction; }
    }
  }
  for (const limb of limbs) limb.samples.forEach((value, index) => limb.output.setElement(index, value));
  for (const hoof of hooves) hoof.samples.forEach((value, index) => hoof.output.setElement(index, value));
  bodySamples.forEach((value, index) => bodyOutput.setElement(index, value));
  groundSamples.forEach((value, index) => groundValues.setElement(index, value));
  restorePose(rest); restorePose(sourceRest);
  return { startsNormalized: .10, completeNormalized: .60, finalFlankRoll: { startsNormalized: .55, completeNormalized: .90 }, maximumAdditionalGroundCorrection,
    finalGroundTrackRange: [Math.min(...groundSamples.map(value => value[1]!)), Math.max(...groundSamples.map(value => value[1]!))],
    initialHeight, terminalHeight, terminalBodyCenterY,
    method: 'Blend the fall into native cattle folded upper/lower segment directions, then finish the broad bull torso onto its flank; preserve the sculpted stance before collapse and all living clips.' };
}

/** Retain the studio timing, but limit bending of woody joints and broad blended petals. */
function restrainPlant(doc: Document) {
  const rest = storedPose(doc), byNode = new Map(rest.map(pose => [pose.node, pose]));
  // Drake Idle already rotates its lower jaw 28 degrees from bind. That is
  // incompatible with the plant's open sculpt and measured membrane limit;
  // only the separately fitted mouth snap articulates these two petal hinges.
  const amounts: Record<string, number> = { Bulb: .65, Stalk: .40, Maw: .55, UpperLip: 0, LowerLip: 0 };
  for (const clip of doc.getRoot().listAnimations()) {
    const death = clip.getName() === 'Death';
    for (const channel of clip.listChannels()) {
      if (channel.getTargetPath() !== 'rotation') continue;
      const node = channel.getTargetNode()!, name = node.getName();
      const amount = name === 'Bulb' && death ? 1 : amounts[name] ?? (/Root$/.test(name) ? .45 : /Foot$/.test(name) ? .55 : 1);
      if (amount === 1) continue;
      const values = channel.getSampler()!.getOutput()!, base = new Quaternion().fromArray(byNode.get(node)!.r);
      for (let i = 0; i < values.getCount(); i++) {
        const phase = channel.getSampler()!.getInput()!.getElement(i, [])[0]! / (duration(clip) - (death ? .4 : 0));
        const t = Math.max(0, Math.min(1, (phase - .3) / .5)), release = t * t * (3 - 2 * t);
        const restrained = death && /^(Front|Rear).+Root$/.test(name) ? amount + (1 - amount) * release : amount;
        values.setElement(i, base.clone().slerp(new Quaternion().fromArray(values.getElement(i, [])), restrained).normalize().toArray());
      }
    }
  }
  const ground = doc.getRoot().listNodes().find(node => node.getName() === 'corealm_retarget_ground')!;
  let maximumCorrection = 0;
  for (const clip of doc.getRoot().listAnimations()) {
    const channel = clip.listChannels().find(c => c.getTargetNode() === ground && c.getTargetPath() === 'translation')!;
    const sampler = channel.getSampler()!, times = sampler.getInput()!, values = sampler.getOutput()!;
    const corrections: number[][] = [];
    for (let i = 0; i < times.getCount(); i++) {
      restorePose(rest); applyClip(clip, times.getElement(i, [])[0]!);
      const correction = .003 - deformedBounds(doc).min[1]!;
      maximumCorrection = Math.max(maximumCorrection, Math.abs(correction));
      corrections.push([0, ground.getTranslation()[1] + correction, 0]);
    }
    corrections.forEach((value, index) => values.setElement(index, value));
  }
  restorePose(rest);
  return { rotationAmounts: amounts, rootLegAmount: .45, footAmount: .55, deathBulbAmount: 1, maximumAdditionalGroundCorrection: maximumCorrection };
}

type PlantSurfacePoint = { point: Vector3; joints: Node[]; inverse: Matrix4[]; weights: number[]; indices: number[] };

function plantSurfacePoints(doc: Document): PlantSurfacePoint[] {
  const points: PlantSurfacePoint[] = [];
  for (const mesh of doc.getRoot().listNodes().filter(node => node.getSkin())) {
    const skin = mesh.getSkin()!, joints = skin.listJoints();
    const inverse = joints.map((_, index) => new Matrix4().fromArray(skin.getInverseBindMatrices()!.getElement(index, [])));
    for (const primitive of mesh.getMesh()!.listPrimitives()) {
      const positions = primitive.getAttribute('POSITION')!, indices = primitive.getAttribute('JOINTS_0')!, weights = primitive.getAttribute('WEIGHTS_0')!;
      for (let index = 0; index < positions.getCount(); index++) points.push({ point: new Vector3().fromArray(positions.getElement(index, [])),
        joints, inverse, indices: indices.getElement(index, []), weights: weights.getElement(index, []) });
    }
  }
  return points;
}

function posePlantSurface(points: PlantSurfacePoint[]) {
  const matrices = new Map<Node, Matrix4>();
  for (const point of points) point.joints.forEach((joint, index) => {
    if (!matrices.has(joint)) matrices.set(joint, new Matrix4().fromArray(joint.getWorldMatrix()).multiply(point.inverse[index]!));
  });
  return points.map(point => {
    const result = new Vector3();
    point.weights.forEach((weight, slot) => {
      if (weight > 0) result.add(point.point.clone().applyMatrix4(matrices.get(point.joints[point.indices[slot]!]!)!).multiplyScalar(weight));
    });
    return result;
  });
}

function plantSoles(doc: Document) {
  const points = plantSurfacePoints(doc);
  return ['FrontLeft', 'FrontRight', 'RearLeft', 'RearRight'].map(name => ({ name,
    root: doc.getRoot().listNodes().find(node => node.getName() === name + 'Root')!,
    points: points.filter(({ point }) => point.y < -.40 && Math.abs(point.z) > .12
      && (name.startsWith('Front') ? point.x > -.15 : point.x < -.25)
      && (name.endsWith('Left') ? point.z > 0 : point.z < 0)),
  }));
}

/** Condensing a bent knee chain into one woody segment loses its changing reach. */
function fitPlantSupport(doc: Document, donor: Document, liftScale: number) {
  const rest = storedPose(doc), sourceRest = storedPose(donor), sourcePoints = plantSurfacePoints(donor);
  const sourceNames = ['R_Hand', 'L_Hand', 'R_Feet', 'L_Feet'];
  const limbs = plantSoles(doc).map((limb, index) => {
    const foot = donor.getRoot().listNodes().find(node => node.getName() === sourceNames[index])!, descendants = new Set<Node>();
    const visit = (node: Node) => { descendants.add(node); node.listChildren().forEach(visit); };
    visit(foot);
    const source = sourcePoints.filter(point => point.weights.reduce((sum, weight, slot) =>
      sum + (descendants.has(point.joints[point.indices[slot]!]!) ? weight : 0), 0) > .5);
    if (!limb.points.length || !source.length) throw new Error(`Missing measured sole surface for ${limb.name}`);
    return { ...limb, source };
  });
  const ground = doc.getRoot().listNodes().find(node => node.getName() === 'corealm_retarget_ground')!;
  const minimum = (points: PlantSurfacePoint[]) => Math.min(...posePlantSurface(points).map(point => point.y));
  const reports: { name: string; sourceTake: string; sourceFloor: number[]; limbs: { name: string; maximumTranslationM: number; soleVertices: number }[] }[] = [];
  const idleOffsets: Vector3[] = [];
  for (const name of ['Idle', 'Walk', 'Run', 'Hit']) {
    const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === name)!;
    const sourceTake = name === 'Run' ? 'Walk' : name, sourceClip = donor.getRoot().listAnimations().find(clip => clip.getName() === sourceTake)!;
    const groundSampler = clip.listChannels().find(channel => channel.getTargetNode() === ground && channel.getTargetPath() === 'translation')!.getSampler()!;
    const times = groundSampler.getInput()!, samples = limbs.map(limb => ({ output: clip.listChannels()
      .find(channel => channel.getTargetNode() === limb.root && channel.getTargetPath() === 'translation')!.getSampler()!.getOutput()!, values: [] as number[][], max: 0 }));
    const sourceHeights = Array.from({ length: times.getCount() }, (_, index) => {
      restorePose(sourceRest); applyClip(sourceClip, times.getElement(index, [])[0]! / duration(clip) * duration(sourceClip));
      return limbs.map(limb => minimum(limb.source));
    });
    const sourceFloor = limbs.map((_, limb) => Math.min(...sourceHeights.map(heights => heights[limb]!))), groundValues: number[][] = [];
    for (let index = 0; index < times.getCount(); index++) {
      restorePose(rest); applyClip(clip, times.getElement(index, [])[0]!);
      limbs.forEach((limb, limbIndex) => {
        const original = new Vector3().fromArray(limb.root.getTranslation());
        const desired = .003 + Math.max(0, sourceHeights[index]![limbIndex]! - sourceFloor[limbIndex]!) * liftScale;
        const parentWorld = new Matrix4().fromArray(limb.root.getParentNode()!.getWorldMatrix());
        for (let iteration = 0; iteration < 4; iteration++) {
          const correction = desired - minimum(limb.points);
          if (Math.abs(correction) < 1e-6) break;
          const local = new Vector3(0, correction, 0).add(new Vector3().setFromMatrixPosition(parentWorld)).applyMatrix4(parentWorld.clone().invert());
          limb.root.setTranslation(new Vector3().fromArray(limb.root.getTranslation()).add(local).toArray());
        }
        const adjusted = new Vector3().fromArray(limb.root.getTranslation()), offset = adjusted.clone().sub(original);
        // Compare two transformed local positions, so imported wrapper units are included.
        const distance = adjusted.clone().applyMatrix4(parentWorld).distanceTo(original.clone().applyMatrix4(parentWorld));
        samples[limbIndex]!.max = Math.max(samples[limbIndex]!.max, distance);
        if (distance > .15) throw new Error(`${name} needs excessive ${limb.name} reach correction: ${distance}`);
        samples[limbIndex]!.values.push(adjusted.toArray());
        if (name === 'Idle' && index === 0) idleOffsets[limbIndex] = offset;
      });
      groundValues.push([0, ground.getTranslation()[1] + .003 - deformedBounds(doc).min[1]!, 0]);
    }
    samples.forEach(sample => sample.values.forEach((value, index) => sample.output.setElement(index, value)));
    groundValues.forEach((value, index) => groundSampler.getOutput()!.setElement(index, value));
    reports.push({ name, sourceTake, sourceFloor, limbs: limbs.map((limb, index) => ({ name: limb.name,
      maximumTranslationM: samples[index]!.max, soleVertices: limb.points.length })) });
  }
  // Start the collapse from the same supported stance, then release this small
  // attachment correction before the native folded corpse reaches the ground.
  const death = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Death')!, deathSeconds = duration(death) - .4;
  limbs.forEach((limb, limbIndex) => {
    const sampler = death.listChannels().find(channel => channel.getTargetNode() === limb.root && channel.getTargetPath() === 'translation')!.getSampler()!;
    for (let index = 0; index < sampler.getInput()!.getCount(); index++) {
      const t = Math.max(0, Math.min(1, sampler.getInput()!.getElement(index, [])[0]! / deathSeconds / .3));
      sampler.getOutput()!.setElement(index, new Vector3().fromArray(sampler.getOutput()!.getElement(index, []))
        .addScaledVector(idleOffsets[limbIndex]!, 1 - t * t * (3 - 2 * t)).toArray());
    }
  });
  restorePose(rest); restorePose(sourceRest);
  return { reports, liftScale, maximumAllowedTranslationM: .15, deathReleaseNormalized: .3,
    method: 'Match each measured target sole to the corresponding native skinned sole lift by a small world-vertical root attachment translation. This restores reach lost when the donor elbow/knee chain is condensed into one woody segment; bone lengths, rotations and surface attributes remain unchanged.' };
}

function measurePlantSoleMotion(doc: Document) {
  const rest = storedPose(doc), feet = plantSoles(doc), samples = 240;
  const gait = (name: string) => {
    const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === name)!, seconds = duration(clip);
    const frames = Array.from({ length: samples + 1 }, (_, index) => {
      restorePose(rest); applyClip(clip, seconds * index / samples);
      return feet.map(foot => { const points = posePlantSurface(foot.points); return {
        y: Math.min(...points.map(point => point.y)), z: points.reduce((sum, point) => sum + point.z, 0) / points.length,
      }; });
    });
    const all: number[] = [], contacts = feet.map((foot, footIndex) => {
      const speeds: number[] = [], phases: number[] = [];
      for (let index = 1; index <= samples; index++) {
        const a = frames[index - 1]![footIndex]!, b = frames[index]![footIndex]!, speed = (a.z - b.z) / (seconds / samples);
        if (Math.max(a.y, b.y) <= .008 && speed > .05) { speeds.push(speed); phases.push((index - .5) / samples); }
      }
      speeds.sort((a, b) => a - b); all.push(...speeds);
      return { bone: foot.name + 'Foot', soleVertices: foot.points.length, samples: speeds.length,
        medianMps: speeds[Math.floor(speeds.length / 2)] ?? null, phases,
        minimumY: Math.min(...frames.map(frame => frame[footIndex]!.y)), maximumY: Math.max(...frames.map(frame => frame[footIndex]!.y)) };
    });
    all.sort((a, b) => a - b);
    return { contacts, mps: contacts.every(contact => contact.samples >= 3) ? all[Math.floor(all.length / 2)] : undefined,
      maximumLowestSoleY: Math.max(...frames.map(frame => Math.min(...frame.map(foot => foot.y)))) };
  };
  try { return { walk: gait('Walk'), run: gait('Run'), method: '240 phases; backward centroid speed of each anatomical sole only while both ends of the sample interval are within 8 mm of the floor. At least three backward contact intervals above .05 m/s are required on all four soles.' }; }
  finally { restorePose(rest); }
}

function settlePlantDeath(doc: Document, donor: Document) {
  const clip = doc.getRoot().listAnimations().find(item => item.getName() === 'Death')!;
  const sourceClip = donor.getRoot().listAnimations().find(item => item.getName() === 'Death')!, sourceSeconds = duration(sourceClip);
  const rest = storedPose(doc), sourceRest = storedPose(donor), nodes = new Map(doc.getRoot().listNodes().map(node => [node.getName(), node]));
  const sources = new Map(donor.getRoot().listNodes().map(node => [node.getName(), node])), mapping = plantMapping() as Record<string, string>;
  const position = (node: Node) => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(node.getWorldMatrix()));
  const rotation = (node: Node) => new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(new Matrix4().fromArray(node.getWorldMatrix())));
  const limbs = ['FrontLeft', 'FrontRight', 'RearLeft', 'RearRight'].map(name => {
    const root = nodes.get(name + 'Root')!, foot = nodes.get(name + 'Foot')!;
    const output = (node: Node) => clip.listChannels().find(channel => channel.getTargetNode() === node && channel.getTargetPath() === 'rotation')!.getSampler()!.getOutput()!;
    return { root, foot, source: sources.get(mapping[root.getName()]!)!, sourceFoot: sources.get(mapping[foot.getName()]!)!,
      rootOutput: output(root), footOutput: output(foot), roots: [] as number[][], feet: [] as number[][] };
  });
  const ground = nodes.get('corealm_retarget_ground')!;
  const sampler = clip.listChannels().find(channel => channel.getTargetNode() === ground && channel.getTargetPath() === 'translation')!.getSampler()!;
  const times = sampler.getInput()!, groundValues: number[][] = [];
  let terminalHeight = 0, terminalBulbY = 0;
  for (let index = 0; index < times.getCount(); index++) {
    const time = times.getElement(index, [])[0]!, t = Math.max(0, Math.min(1, (time / sourceSeconds - .3) / .5)), amount = t * t * (3 - 2 * t);
    restorePose(rest); applyClip(clip, time); restorePose(sourceRest); applyClip(sourceClip, Math.min(time, sourceSeconds));
    for (const limb of limbs) {
      const footRotation = rotation(limb.foot), current = position(limb.foot).sub(position(limb.root)).normalize();
      const desired = position(limb.sourceFoot).sub(position(limb.source)).normalize();
      const correction = new Quaternion().slerp(new Quaternion().setFromUnitVectors(current, desired), amount);
      const rootRotation = rotation(limb.root).premultiply(correction);
      limb.root.setRotation(rotation(limb.root.getParentNode()!).invert().multiply(rootRotation).normalize().toArray());
      limb.foot.setRotation(rotation(limb.foot.getParentNode()!).invert().multiply(footRotation).normalize().toArray());
      limb.roots.push(limb.root.getRotation()); limb.feet.push(limb.foot.getRotation());
    }
    const bounds = deformedBounds(doc), correction = .003 - bounds.min[1]!;
    groundValues.push([0, ground.getTranslation()[1] + correction, 0]);
    if (index === times.getCount() - 1) { terminalHeight = bounds.max[1]! - bounds.min[1]!; terminalBulbY = position(nodes.get('Bulb')!).y + correction; }
  }
  for (const limb of limbs) { limb.roots.forEach((value, index) => limb.rootOutput.setElement(index, value)); limb.feet.forEach((value, index) => limb.footOutput.setElement(index, value)); }
  groundValues.forEach((value, index) => sampler.getOutput()!.setElement(index, value));
  restorePose(rest); restorePose(sourceRest);
  return { terminalHeight, terminalBulbY, releaseWindow: [.3, .8],
    evidence: 'The earlier uniformly restrained death remained propped up by FrontLeftFoot instead of folding that support during collapse.',
    method: 'Release root-leg damping during collapse and align each single woody limb to the donor shoulder-to-hand or hip-to-foot folded segment; preserve terminal-foot orientation and living gait restraint.' };
}

function authorPlantBite(doc: Document, donor: Document, closureAngles: { upper: number; lower: number }) {
  const rest = storedPose(doc), sourceRest = storedPose(donor), nodes = new Map(doc.getRoot().listNodes().map(node => [node.getName(), node]));
  const source = (name: string) => {
    const node = donor.getRoot().listNodes().find(node => node.getName() === name);
    if (!node) throw new Error(`Plant bite donor lacks ${name}`);
    return node;
  };
  const sourceClip = donor.getRoot().listAnimations().find(clip => clip.getName() === 'Attack')!;
  const idle = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Idle')!, seconds = duration(sourceClip), steps = Math.ceil(seconds * 120);
  const position = (node: Node) => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(node.getWorldMatrix()));
  const sourceHead = source('Head'), sourceRoot = source('Root'), sourceJaw = source('Jaw01');
  restorePose(sourceRest); applyClip(sourceClip, 0);
  const initialJaw = new Quaternion().fromArray(sourceJaw.getRotation()), initialHead = position(sourceHead).sub(position(sourceRoot));
  const sourceBounds = deformedBounds(donor), targetBounds = deformedBounds(doc);
  const anatomicalScale = (targetBounds.max[1]! - targetBounds.min[1]!) / (sourceBounds.max[1]! - sourceBounds.min[1]!);
  const jawAngles = Array.from({ length: steps + 1 }, (_, index) => {
    restorePose(sourceRest); applyClip(sourceClip, seconds * index / steps);
    return initialJaw.angleTo(new Quaternion().fromArray(sourceJaw.getRotation()));
  });
  const maximumJawAngle = Math.max(...jawAngles), peakIndex = jawAngles.indexOf(maximumJawAngle);
  if (maximumJawAngle < .5) throw new Error('Plant bite donor no longer contains the audited opening and snap');
  const maw = nodes.get('Maw')!, upper = nodes.get('UpperLip')!, lower = nodes.get('LowerLip')!, ground = nodes.get('corealm_retarget_ground')!;
  const mawRestRotation = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(new Matrix4().fromArray(maw.getWorldMatrix())));
  const hingeAxis = new Vector3(1, 0, 0).applyQuaternion(mawRestRotation.invert());
  const lipRest = [upper, lower].map(node => new Vector3().fromArray(rest.find(pose => pose.node === node)!.t));
  const lipRestRotation = [upper, lower].map(node => new Quaternion().fromArray(rest.find(pose => pose.node === node)!.r));
  const tracks = new Map(rest.map(pose => [pose.node, { t: [] as number[], r: [] as number[], s: [] as number[] }]));
  const times: number[] = [], envelope: { phase: number; jawOpenRadians: number; closure: number; headTravel: number[] }[] = [];
  let contactNormalized = 0, maximumClosure = -Infinity, maximumHeadTravel = 0;
  const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
  for (let index = 0; index <= steps; index++) {
    const phase = index / steps, time = seconds * phase;
    restorePose(rest); applyClip(idle, duration(idle) * phase); restorePose(sourceRest); applyClip(sourceClip, time);
    // The sculpt starts open. Reuse the donor's fast closing half of the snap,
    // then release back into that same open stance after the strike.
    const closure = index < peakIndex ? 0 : Math.max(0, 1 - jawAngles[index]! / maximumJawAngle) * (1 - smooth((phase - .55) / .45));
    if (closure > maximumClosure) { maximumClosure = closure; contactNormalized = phase; }
    const travel = position(sourceHead).sub(position(sourceRoot)).sub(initialHead).multiplyScalar(anatomicalScale);
    maximumHeadTravel = Math.max(maximumHeadTravel, travel.length());
    const parent = new Matrix4().fromArray(maw.getParentNode()!.getWorldMatrix());
    const localTravel = travel.clone().add(new Vector3().setFromMatrixPosition(parent)).applyMatrix4(parent.invert());
    maw.setTranslation(new Vector3().fromArray(maw.getTranslation()).add(localTravel).toArray());
    [upper, lower].forEach((node, lip) => {
      const angle = (lip === 0 ? closureAngles.upper : -closureAngles.lower) * closure;
      const rotation = new Quaternion().setFromAxisAngle(hingeAxis, angle);
      node.setRotation(rotation.clone().multiply(lipRestRotation[lip]!).toArray()).setTranslation(lipRest[lip]!.clone().applyQuaternion(rotation).toArray());
    });
    ground.setTranslation([0, ground.getTranslation()[1] + .003 - deformedBounds(doc).min[1]!, 0]);
    times.push(time); envelope.push({ phase, jawOpenRadians: jawAngles[index]!, closure, headTravel: travel.toArray() });
    for (const { node } of rest) {
      const track = tracks.get(node)!; track.t.push(...node.getTranslation()); track.r.push(...node.getRotation()); track.s.push(...node.getScale());
    }
  }
  removeClip(doc, 'Attack'); const clip = doc.createAnimation('Attack');
  for (const [node, track] of tracks) {
    addChannel(doc, clip, node, 'translation', times, track.t); addChannel(doc, clip, node, 'rotation', times, track.r); addChannel(doc, clip, node, 'scale', times, track.s);
  }
  restorePose(rest); restorePose(sourceRest);
  return { donorId: 'creature_black_wilderness_dragon', sourceTake: 'attackMouth', seconds, closureAngles,
    anatomicalScale, maximumHeadTravel, maximumJawAngle, maximumClosure, contactNormalized, contactSeconds: seconds * contactNormalized, envelope,
    method: 'Native Jaw01 closing envelope after its open anticipation drives a shared Maw hinge through lip rotation plus pivot translation. Root-relative donor head travel supplies the neck impulse at body-height scale. Attack starts and ends in the open sculpted stance.' };
}

function measureMotion(doc: Document, names: string[]) {
  const rest = storedPose(doc), nodes = doc.getRoot().listNodes(), samples = 240;
  const feet = names.map(name => {
    const node = nodes.find(node => node.getName() === name);
    if (!node) throw new Error(`Missing contact joint ${name}`);
    return node;
  });
  const position = (node: Node) => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(node.getWorldMatrix()));
  const gait = (name: string) => {
    const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === name)!, seconds = duration(clip);
    const tracks = feet.map(() => [] as Vector3[]);
    for (let frame = 0; frame <= samples; frame++) {
      restorePose(rest); applyClip(clip, seconds * frame / samples);
      feet.forEach((foot, index) => tracks[index]!.push(position(foot)));
    }
    const all: number[] = [];
    const contacts = tracks.map((track, index) => {
      const low = Math.min(...track.map(point => point.y)), high = Math.max(...track.map(point => point.y));
      const heightWindowM = Math.max(.008, Math.min(.04, (high - low) * .12)), speeds: number[] = [];
      for (let frame = 1; frame < track.length; frame++) {
        const a = track[frame - 1]!, b = track[frame]!, speed = (a.z - b.z) * samples / seconds;
        if ((a.y + b.y) * .5 <= low + heightWindowM && speed > .05) speeds.push(speed);
      }
      speeds.sort((a, b) => a - b); all.push(...speeds);
      return { bone: names[index]!, samples: speeds.length, medianMps: speeds[Math.floor(speeds.length / 2)] ?? null, heightWindowM };
    });
    all.sort((a, b) => a - b);
    return { contacts, mps: contacts.every(contact => contact.samples >= 3) ? all[Math.floor(all.length / 2)] : undefined };
  };
  try {
    const walk = gait('Walk'), run = gait('Run');
    const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Attack')!, seconds = duration(clip);
    let maximumReach = -Infinity, contactNormalized = 0;
    for (let frame = 0; frame <= samples; frame++) {
      restorePose(rest); applyClip(clip, seconds * frame / samples);
      const reach = deformedBounds(doc).max[2]!;
      if (reach > maximumReach) { maximumReach = reach; contactNormalized = frame / samples; }
    }
    return { walk, run, contactNormalized, contactSeconds: seconds * contactNormalized, maximumReach,
      method: '240 phases per take; median backward foot-joint speed within the lowest 12% of each foot arc; contact is maximum deformed +Z reach. Speeds require at least three stance samples on every foot.' };
  } finally { restorePose(rest); }
}

function measureBullContact(doc: Document, frame: { lateral: number[]; forward: number[]; center: number }) {
  const mesh = doc.getRoot().listNodes().find(node => node.getSkin())!, skin = mesh.getSkin()!, joints = skin.listJoints();
  const primitive = mesh.getMesh()!.listPrimitives()[0]!, positions = primitive.getAttribute('POSITION')!;
  const indices = primitive.getAttribute('JOINTS_0')!, weights = primitive.getAttribute('WEIGHTS_0')!, inverse = skin.getInverseBindMatrices()!;
  const lateral = new Vector3().fromArray(frame.lateral), forward = new Vector3().fromArray(frame.forward);
  const horns = Array.from({ length: positions.getCount() }, (_, index) => ({ index, point: new Vector3().fromArray(positions.getElement(index, [])) }))
    .filter(({ point }) => point.y > .55 && point.dot(forward) > .19 && Math.abs(point.dot(lateral) - frame.center) > .18);
  if (!horns.length) throw new Error('Bull contact marker has no horn surface');
  const rest = storedPose(doc), clip = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Attack')!, seconds = duration(clip);
  const samples: { phase: number; reach: number; crownY: number; meanY: number }[] = [];
  for (let i = 108; i <= 144; i++) {
    restorePose(rest); applyClip(clip, seconds * i / 240);
    const matrices = joints.map((joint, index) => new Matrix4().fromArray(joint.getWorldMatrix()).multiply(new Matrix4().fromArray(inverse.getElement(index, []))));
    let reach = -Infinity, crownY = -Infinity, meanY = 0;
    for (const { index, point } of horns) {
      const js = indices.getElement(index, [] as number[]), ws = weights.getElement(index, [] as number[]), posed = new Vector3();
      ws.forEach((weight, slot) => { if (weight > 0) posed.add(point.clone().applyMatrix4(matrices[js[slot]!]!).multiplyScalar(weight)); });
      reach = Math.max(reach, posed.z); crownY = Math.max(crownY, posed.y); meanY += posed.y / horns.length;
    }
    samples.push({ phase: i / 240, reach, crownY, meanY });
  }
  restorePose(rest);
  const peak = samples.reduce((best, sample) => sample.reach > best.reach ? sample : best);
  const rise = samples.slice(1).map((sample, index) => ({ phase: (sample.phase + samples[index]!.phase) * .5,
    speed: (sample.meanY - samples[index]!.meanY) / ((sample.phase - samples[index]!.phase) * seconds) }))
    .reduce((best, sample) => sample.speed > best.speed ? sample : best);
  return { contactNormalized: rise.phase, contactSeconds: rise.phase * seconds, upwardHornMps: rise.speed,
    maximumForwardReachPhase: peak.phase, samples, hornSurfaceVertices: horns.length, requiresVisualContactReview: true,
    sourceReference: 'Native cattle HeadTop maximum forward reach is phase .50.',
    method: 'Strike impulse proxy from the fastest upward motion of the target horn surface centroid within the verified studio cattle rising-thrust interval .45-.60. Forward reach peaks at the interval boundary while horns continue upward, so reach alone marks the end of the low windup.' };
}

export async function repair(doc: Document, context: CreatureRepairContext): Promise<CreatureRepairResult> {
  const bull = context.assetId === 'creature_rootdelve_badger', plant = context.assetId === 'creature_thorn_maw';
  if (!assetIds.some(id => id === context.assetId)) throw new Error(`Unsupported unusual quadruped ${context.assetId}`);
  const donorId = bull ? 'animal_cattle' : 'creature_basalt_drake';
  const donor = await context.readAsset(donorId), donorBind = restoreDonorBind(donor);
  const galeskinWeightRepair = !bull && !plant ? repairGaleskinCutoff(doc) : undefined;
  const galeskinAnatomy = !bull && !plant ? repairGaleskinAnatomy(doc) : undefined;
  const bullGeometry = bull ? repairBullGeometry(doc) : undefined;
  const bullRig = bullGeometry ? rebuildBullRig(doc, bullGeometry.landmarks, bullGeometry.frame) : undefined;
  const plantAnatomy = plant ? await repairThornAnatomy(doc) : undefined;
  let yawDegrees: number | undefined;
  if (bullGeometry) {
    const scene = doc.getRoot().listScenes()[0]!;
    // Mirrored front-leg matches establish the actual diagonal facing basis.
    const yaw = -Math.atan2(bullGeometry.frame.forward[0], bullGeometry.frame.forward[2]);
    yawDegrees = yaw * 180 / Math.PI;
    const sourceScale = new Vector3().setFromMatrixScale(new Matrix4().fromArray(doc.getRoot().listNodes().find(node => node.getMesh())!.getWorldMatrix())).x;
    const frame = doc.createNode('RedmaneForwardFrame').setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw).toArray())
      .setTranslation([-bullGeometry.frame.center * sourceScale, 0, 0]);
    for (const child of [...scene.listChildren()]) { scene.removeChild(child); frame.addChild(child); }
    scene.addChild(frame);
  }
  const translationScale = bull
    ? length(doc, 'FrontLeftUpper', 'FrontLeftHoof') / length(donor, 'Cow_l_FrontLeg_HipSHJnt', 'Cow_l_FrontLeg_AnkleSHJnt')
    : plant ? length(doc, 'FrontLeftRoot', 'FrontLeftFoot') / length(donor, 'R_UpperArm', 'R_Hand') * .6
      : length(doc, 'ForeLUpper', 'ForeLFoot') / length(donor, 'R_UpperArm', 'R_Hand');
  const profile: CreatureMotionProfile = {
    mapping: bull ? bullMapping() : plant ? plantMapping() : drakeMapping(),
    sourceToTargetRotation: [0, 0, 0, 1], root: { target: bull ? 'BullRoot' : plant ? 'Bulb' : 'Torso',
      ...(bull ? { source: 'Cow_ROOTSHJnt' } : {}), translationScale, horizontal: 'in-place' },
    clips: Object.fromEntries(['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'].map(name => [name, {
      source: plant && name === 'Run' ? 'Walk' : name, loop: ['Idle', 'Walk', 'Run'].includes(name),
      ...(plant && name === 'Run' ? { duration: .55 } : {}), ...(name === 'Death' ? { holdLastSeconds: .4 } : {}),
    }])),
    replaceAnimations: true, samplesPerSecond: 90, grounding: { floor: .003, maxCorrection: 2.5 },
  };
  const report = retargetCreatureMotion(doc, donor, profile);
  const headTravel = !bull && !plant ? restoreHeadTravel(doc, donor) : undefined;
  const bullDeathSettle = bull ? settleBullDeath(doc, donor) : undefined;
  const plantRestraint = plant ? restrainPlant(doc) : undefined;
  const plantSupport = plant ? fitPlantSupport(doc, donor, translationScale) : undefined;
  const plantDeath = plant ? settlePlantDeath(doc, donor) : undefined;
  const biteDonor = plant ? await context.readAsset('creature_black_wilderness_dragon') : undefined;
  const biteDonorBind = biteDonor ? restoreDonorBind(biteDonor) : undefined;
  const plantBite = biteDonor && plantAnatomy ? authorPlantBite(doc, biteDonor, plantAnatomy.closureAngles) : undefined;
  const measurements = measureMotion(doc, bull ? ['FrontLeftHoof', 'FrontRightHoof', 'HindLeftHoof', 'HindRightHoof']
    : plant ? ['FrontLeftFoot', 'FrontRightFoot', 'RearLeftFoot', 'RearRightFoot'] : ['ForeLFoot', 'ForeRFoot', 'HindLFoot', 'HindRFoot']);
  const soleMeasurements = plant ? measurePlantSoleMotion(doc) : undefined;
  const locomotion = soleMeasurements ?? measurements;
  const contactEvidence = bullGeometry ? measureBullContact(doc, bullGeometry.frame) : !plant ? {
    contactNormalized: .65, contactSeconds: 1.04,
    method: 'Studio Dragon Boar HornAttack is unretimed at 1.6 seconds. Verified tusk impact is 1.04 seconds; whole-body maximum reach during the earlier paw windup does not define horn contact.',
    rejectedWholeBodyMarker: measurements.contactNormalized,
  } : { contactNormalized: plantBite!.contactNormalized, contactSeconds: plantBite!.contactSeconds,
    method: 'First maximum anatomical maw closure in the native attackMouth snap; opposing teeth retain the measured non-intersection gap. This marks the strike, not a collision measurement.',
    rejectedWholeBodyMarker: measurements.contactNormalized };
  const clipSeconds = (name: string) => duration(doc.getRoot().listAnimations().find(clip => clip.getName() === name)!);
  return {
    changes: [
      `Replaced sparse procedural clips with complete poses retargeted from ${donorId}.`,
      ...(bullGeometry ? bullGeometry.changes : ['Preserved geometry, native bind stance and embedded textures; transferred motion as verified world-space bind deltas.']),
      'Baked every scene node in every state, including neutral scales, so Idle restores limbs after Death.',
      'Removed horizontal loop travel, grounded sampled deformed geometry and held the final death pose.',
      ...(bull ? ['Replaced the anatomically misplaced rig and cross-limb weights using the actual hoof, elbow and thigh positions.',
        `Aligned the measured diagonal bull source to +Z by ${yawDegrees!.toFixed(4)} degrees; replaced the old 30% vertical death squash.`,
        'Adapted the native death to fold the broader limbs and finish on the flank, retaining studio timing and a held corpse.'] : []),
      ...(plant ? ['Used only woody root and terminal-foot joints with restrained studio angular trajectories, while retaining full-body death collapse.'] : []),
      ...(plantAnatomy ? plantAnatomy.changes : []),
      ...(plantBite ? ['Replaced the horn attack with the native dragon mouth snap, fitted to the measured plant tooth gap and shared maw hinge.',
        'Released root-leg restraint during death and folded the woody supports with the donor collapse.',
        'Restored native sole support with measured root-attachment reach corrections, eliminating the inherited rear-foot hover.',
        'Retimed the native four-contact Walk from 1.0 to .55 seconds for a faster rooted Run; the multi-joint gallop could not preserve support on the single woody root segments.'] : []),
      ...(galeskinWeightRepair ? ['Smoothed the source torso-to-foot weight discontinuity and clamped negative roundoff weights.'] : []),
      ...(galeskinAnatomy ? ['Assigned the connected skull crown and curled tail to their anatomical joints with smooth neck/stalk transitions.',
        'Moved the tail pivot to its measured asymmetric attachment and updated the inverse bind to preserve the rest sculpture.'] : []),
      ...(headTravel ? ['Restored the studio-authored head travel through verified parent bases and measured neck-to-head scale.'] : []),
    ],
    warnings: ['Pending devdocs review of all motion states.', ...(!locomotion.walk.mps || !locomotion.run.mps ? ['One or more feet lacks a reliable stance interval; no speed inferred for that gait.'] : [])],
    provenance: { donorId, donorBind, profile, motionTransfer: report, measurements, contactEvidence, ...(headTravel ? { headTravel } : {}), ...(plantRestraint ? { plantRestraint, plantSupport, soleMeasurements, plantDeath, plantAnatomy: plantAnatomy!.provenance, plantBite, biteDonorBind } : {}), ...(galeskinWeightRepair ? { galeskinWeightRepair, galeskinAnatomy } : {}),
      ...(bullGeometry ? { geometryRepair: bullGeometry.provenance, rigRepair: bullRig, bullDeathSettle, yawDegrees } : {}),
      sourceAnatomy: bull ? 'Four-leg redmane bull, despite the retained rootdelve_badger asset ID.' : plant ? 'Four woody roots, bulb, flexible stalk, and articulated maw.' : 'Four-leg fantasy creature with tall forelimbs, short hindlimbs, horned head and tail.' },
    motion: { walkClipSeconds: clipSeconds('Walk'), runClipSeconds: clipSeconds('Run'), attackSeconds: clipSeconds('Attack'),
      impliedWalkMps: locomotion.walk.mps, impliedRunMps: locomotion.run.mps,
      contactNormalized: contactEvidence.contactNormalized, groundY: .003 },
  };
}
