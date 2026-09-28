import { type Document, type Node, type Primitive } from '@gltf-transform/core';
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import type { CreatureRepairProfile } from '../repairProfile.js';
import { retargetCreatureMotion } from '../retarget.js';
import { addChannel, applyClip, duration, restorePose, sample, storedPose } from '../../creature-motion/pose.js';
import { deformedBounds } from '../../creature-motion/validate-deformation.js';

const smooth = (lo: number, hi: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
const world = (node: Node) => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(node.getWorldMatrix()));
const find = (doc: Document, name: string) => {
  const node = doc.getRoot().listNodes().find(node => node.getName() === name);
  if (!node) throw new Error(`Winged profile requires ${name}`);
  return node;
};

/** Weld only for anatomical classification. Original topology, normals and UVs stay untouched. */
function components(primitive: Primitive, accepts: (p: number[]) => boolean = () => true) {
  const positions = primitive.getAttribute('POSITION')!, indices = primitive.getIndices()!.getArray()!;
  const parents = Array.from({ length: positions.getCount() }, (_, i) => i);
  const root = (i: number): number => parents[i] === i ? i : parents[i] = root(parents[i]!);
  const join = (a: number, b: number) => { parents[root(a)] = root(b); };
  const welded = new Map<string, number>();
  for (let i = 0; i < positions.getCount(); i++) {
    const p = positions.getElement(i, []); if (!accepts(p)) continue;
    const key = p.map(x => Math.round(x * 1e5)).join(',');
    const previous = welded.get(key);
    if (previous !== undefined) join(i, previous); else welded.set(key, i);
  }
  for (let i = 0; i < indices.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = Number(indices[i + k]), b = Number(indices[i + (k + 1) % 3]);
    if (accepts(positions.getElement(a, [])) && accepts(positions.getElement(b, []))) join(a, b);
  }
  const result = new Map<number, number[]>();
  for (let i = 0; i < positions.getCount(); i++) {
    if (!accepts(positions.getElement(i, []))) continue;
    const key = root(i); if (!result.has(key)) result.set(key, []); result.get(key)!.push(i);
  }
  return [...result.values()].sort((a, b) => b.length - a.length);
}

function setWeights(doc: Document, node: Node, classify: (p: number[], vertex: number) => [string, number][], smoothPasses = 0) {
  const skin = node.getSkin()!, joints = new Map(skin.listJoints().map((joint, i) => [joint.getName(), i]));
  let vertices = 0;
  for (const primitive of node.getMesh()!.listPrimitives()) {
    const positions = primitive.getAttribute('POSITION')!;
    const indices = new Uint16Array(positions.getCount() * 4), weights = new Float32Array(positions.getCount() * 4);
    for (let vertex = 0; vertex < positions.getCount(); vertex++) {
      const merged = new Map<string, number>();
      for (const [name, weight] of classify(positions.getElement(vertex, []), vertex)) {
        if (!joints.has(name) || !Number.isFinite(weight) || weight < 0) throw new Error(`Invalid ${name} influence`);
        merged.set(name, (merged.get(name) ?? 0) + weight);
      }
      const chosen = [...merged].filter(([, weight]) => weight > 1e-8).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = chosen.reduce((total, [, weight]) => total + weight, 0);
      if (!(sum > 0)) throw new Error(`Unweighted vertex ${vertex}`);
      chosen.forEach(([name, weight], slot) => { indices[vertex * 4 + slot] = joints.get(name)!; weights[vertex * 4 + slot] = weight / sum; });
    }
    if (smoothPasses) {
      // Blend at actual connected joints, including coincident UV-seam vertices. A
      // spatially close blade, wing or opposite limb never participates in the average.
      const neighbours = Array.from({ length: positions.getCount() }, () => new Set<number>());
      const triangle = primitive.getIndices()!.getArray()!;
      for (let i = 0; i < triangle.length; i += 3) for (let j = 0; j < 3; j++) {
        const a = Number(triangle[i + j]), b = Number(triangle[i + (j + 1) % 3]);
        neighbours[a]!.add(b); neighbours[b]!.add(a);
      }
      const seams = new Map<string, number[]>();
      for (let i = 0; i < positions.getCount(); i++) {
        const key = positions.getElement(i, []).map(x => Math.round(x * 1e5)).join(',');
        if (!seams.has(key)) seams.set(key, []); seams.get(key)!.push(i);
      }
      for (const vertices of seams.values()) if (vertices.length > 1) for (const a of vertices) for (const b of vertices) if (a !== b) neighbours[a]!.add(b);
      let dense = new Float32Array(positions.getCount() * joints.size);
      for (let i = 0; i < positions.getCount(); i++) for (let k = 0; k < 4; k++) dense[i * joints.size + indices[i * 4 + k]!]! += weights[i * 4 + k]!;
      for (let pass = 0; pass < smoothPasses; pass++) {
        const next = dense.slice();
        for (let i = 0; i < positions.getCount(); i++) if (neighbours[i]!.size) for (let joint = 0; joint < joints.size; joint++) {
          let average = 0; for (const adjacent of neighbours[i]!) average += dense[adjacent * joints.size + joint]!;
          next[i * joints.size + joint] = .5 * dense[i * joints.size + joint]! + .5 * average / neighbours[i]!.size;
        }
        dense = next;
      }
      indices.fill(0); weights.fill(0);
      for (let i = 0; i < positions.getCount(); i++) {
        const influences = Array.from({ length: joints.size }, (_, joint) => ({ joint, weight: dense[i * joints.size + joint]! })).sort((a, b) => b.weight - a.weight).slice(0, 4);
        const sum = influences.reduce((total, influence) => total + influence.weight, 0);
        influences.forEach(({ joint, weight }, k) => { indices[i * 4 + k] = joint; weights[i * 4 + k] = weight / sum; });
      }
    }
    primitive.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(indices).setBuffer(doc.getRoot().listBuffers()[0]!));
    primitive.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(doc.getRoot().listBuffers()[0]!));
    vertices += positions.getCount();
  }
  return vertices;
}

function rebind(doc: Document) {
  for (const skin of doc.getRoot().listSkins()) {
    const mesh = doc.getRoot().listNodes().find(node => node.getSkin() === skin)!;
    const meshWorld = new Matrix4().fromArray(mesh.getWorldMatrix());
    const matrices = skin.listJoints().flatMap(joint => new Matrix4().fromArray(joint.getWorldMatrix()).invert().multiply(meshWorld).toArray());
    skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(new Float32Array(matrices)).setBuffer(doc.getRoot().listBuffers()[0]!));
  }
}

function repairWaspWeights(doc: Document) {
  const node = find(doc, 'BriarWaspMesh');
  const primitive = node.getMesh()!.listPrimitives()[0]!, islands = components(primitive);
  const isolated = new Map<number, string>();
  // Four separate leg shells must never blend with nearby wings or the opposite leg.
  for (const island of islands.slice(1)) {
    const points = island.map(i => primitive.getAttribute('POSITION')!.getElement(i, []));
    const x = points.reduce((sum, p) => sum + p[0]!, 0) / points.length;
    const z = points.reduce((sum, p) => sum + p[2]!, 0) / points.length;
    for (const i of island) isolated.set(i, `Leg${x < -.125 ? 'Front' : 'Mid'}Coxa_${z < 0 ? 'L' : 'R'}`);
  }
  const vertices = setWeights(doc, node, ([x, y, z], vertex) => {
    const isolatedJoint = isolated.get(vertex);
    if (isolatedJoint) return [[isolatedJoint, 1]];
    const side = z! < 0 ? 'L' : 'R';
    const wing = smooth(.10, .20, Math.abs(z!)) * smooth(.48, .65, y!);
    const head = (1 - smooth(-.27, -.15, x!)) * smooth(.32, .46, y!);
    const abdomen = smooth(-.01, .13, x!) * (1 - smooth(.48, .65, y!));
    const middle = 1 - smooth(.16, .31, y!), distal = 1 - smooth(.035, .14, y!);
    // One root owns each connected chitin membrane. The old mid/tip blend bent plates.
    return [[`WingUpperRoot_${side}`, wing], ['Head', (1 - wing) * head],
      ['AbdomenBase', (1 - wing) * (1 - head) * abdomen * (1 - middle)],
      ['AbdomenMid', (1 - wing) * (1 - head) * abdomen * middle * (1 - distal)],
      ['AbdomenTip', (1 - wing) * (1 - head) * abdomen * middle * distal],
      ['Thorax', (1 - wing) * (1 - head) * (1 - abdomen)]];
  });
  return { vertices, detachedLegVertices: isolated.size };
}

function repairOrchidWeights(doc: Document) {
  const node = find(doc, 'OrchidReaperMesh'), primitive = node.getMesh()!.listPrimitives()[0]!, positions = primitive.getAttribute('POSITION')!;
  const maximumY = Math.max(...Array.from({ length: positions.getCount() }, (_, i) => positions.getElement(i, [])[1]!));
  const lower = new Map<number, 'leg' | 'blade'>();
  for (const island of components(primitive, p => p[1]! < maximumY * .42)) {
    for (const vertex of island) lower.set(vertex, island.length > 300 ? 'leg' : 'blade');
  }
  return setWeights(doc, node, ([x, y], vertex) => {
    const yf = y! / maximumY, ax = Math.abs(x!), side = x! < 0 ? 'L' : 'R';
    if (lower.get(vertex) === 'blade') return [[`Elbow_${side}`, 1]];
    if (lower.get(vertex) === 'leg') {
      const shin = 1 - smooth(.16, .24, yf), foot = 1 - smooth(.045, .085, yf);
      return [[`Hip_${side}`, 1 - shin], [`Knee_${side}`, shin * (1 - foot)], [`Ankle_${side}`, shin * foot]];
    }
    const head = smooth(.65, .74, yf);
    if (head > .999) return [['Head', 1]];
    const upperArmRegion = smooth(.42, .62, yf);
    // Scythe tips extend below the knees. Height alone must not bind them to legs.
    const arm = smooth(.20 - .12 * upperArmRegion, .27 - .10 * upperArmRegion, ax) * (1 - smooth(.61, .70, yf));
    const forearm = 1 - smooth(.43, .52, yf);
    if (arm > .995) return [[`Shoulder_${side}`, 1 - forearm], [`Elbow_${side}`, forearm]];
    const leg = (1 - smooth(.32, .42, yf)) * smooth(.025, .075, ax);
    const shin = 1 - smooth(.16, .24, yf), foot = 1 - smooth(.045, .085, yf);
    if (leg > .995) return [[`Elbow_${side}`, arm], [`Hip_${side}`, (1 - arm) * (1 - shin)], [`Knee_${side}`, (1 - arm) * shin * (1 - foot)], [`Ankle_${side}`, (1 - arm) * shin * foot]];
    const chest = smooth(.39, .60, yf);
    const rest = 1 - head;
    return [['Head', head], [`Shoulder_${side}`, rest * arm * (1 - forearm)], [`Elbow_${side}`, rest * arm * forearm],
      [`Hip_${side}`, rest * (1 - arm) * leg], ['Chest', rest * (1 - arm) * (1 - leg) * chest], ['Pelvis', rest * (1 - arm) * (1 - leg) * (1 - chest)]];
  }, 12);
}

function preparePrismatic(doc: Document) {
  const node = find(doc, 'PrismaticSpriteNativeBody'), skin = node.getSkin()!;
  // The old candidate generator appended six untextured rods, unrelated to the
  // supplied textured fae. They read as a rigid white beam and prop up its corpse.
  const rods = find(doc, 'Six crystal abdomen segments'), rodMesh = rods.getMesh()!;
  rods.dispose(); rodMesh.dispose();
  for (const name of ['WingLF', 'WingRF', 'AbdomenTip', 'AbdomenMid', 'AbdomenBase']) {
    const unused = find(doc, name); skin.removeJoint(unused); unused.dispose();
  }
  const thorax = find(doc, 'Thorax');
  // The old export parented the pelvis below the thorax, so pelvis motion could only
  // move the legs. Restore an anatomical pelvis-led hierarchy without changing rest.
  const pelvis = find(doc, 'Pelvis'), root = find(doc, 'Root');
  const pelvisPosition = world(pelvis), thoraxPosition = world(thorax);
  thorax.removeChild(pelvis); root.removeChild(thorax); root.addChild(pelvis); pelvis.addChild(thorax);
  pelvis.setTranslation(pelvisPosition.applyMatrix4(new Matrix4().fromArray(root.getWorldMatrix()).invert()).toArray());
  thorax.setTranslation(thoraxPosition.applyMatrix4(new Matrix4().fromArray(pelvis.getWorldMatrix()).invert()).toArray());
  const add = (name: string, parent: Node, p: [number, number, number]) => {
    const joint = doc.createNode(name).setTranslation(new Vector3(...p).applyMatrix4(new Matrix4().fromArray(parent.getWorldMatrix()).invert()).toArray());
    parent.addChild(joint); skin.addJoint(joint); return joint;
  };
  for (const sign of [-1, 1]) {
    const side = sign < 0 ? 'L' : 'R';
    const shoulder = add(`ArmShoulder${side}`, thorax, [sign * .20, 1.34, .01]);
    const elbow = add(`ArmElbow${side}`, shoulder, [sign * .58, 1.34, .01]);
    add(`ArmHand${side}`, elbow, [sign * .90, 1.34, .01]);
  }
  rebind(doc);
  const primitive = node.getMesh()!.listPrimitives()[0]!, detached = new Set(components(primitive).slice(1).flat());
  if (detached.size !== 135) throw new Error('Prismatic detached wing topology changed');
  const vertices = setWeights(doc, node, ([x, y, z], vertex) => {
    const ax = Math.abs(x!), side = x! < 0 ? 'L' : 'R';
    if (detached.has(vertex)) return [[`Wing${side}H`, 1]];
    if (y! > 1.5 && ax < .34) return [['Head', 1]];
    // Long finger filaments hang below the arm axis and must follow the wrist too.
    const arm = smooth(.18, .30, ax) * (1 - smooth(1.46, 1.58, y!));
    const elbow = smooth(.51, .63, ax), hand = smooth(.84, .94, ax);
    if (arm > .995) return [[`ArmShoulder${side}`, 1 - elbow], [`ArmElbow${side}`, elbow * (1 - hand)], [`ArmHand${side}`, elbow * hand]];
    const head = smooth(1.39, 1.54, y!);
    if (head > .999) return [['Head', 1]];
    if (y! < .94) {
      const leg = (1 - smooth(.78, .94, y!)) * smooth(.02, .10, ax);
      const shin = 1 - smooth(.32, .46, y!), foot = 1 - smooth(.12, .22, y!);
      return [['Pelvis', 1 - leg], [`NativeThigh${side}`, leg * (1 - shin)], [`NativeShin${side}`, leg * shin * (1 - foot)], [`NativeFoot${side}`, leg * shin * foot]];
    }
    return [['Head', head], [`ArmShoulder${side}`, (1 - head) * arm], ['Thorax', (1 - head) * (1 - arm)]];
  }, 12);
  return { vertices, newArmJoints: 6, detachedMembraneVertices: detached.size, removedProceduralRodVertices: 96, actualMembraneIslands: 2 };
}

function liftFlight(doc: Document, amount: number) {
  for (const clip of doc.getRoot().listAnimations()) {
    if (clip.getName() === 'Death') continue;
    const ground = clip.listChannels().find(channel => channel.getTargetNode()?.getName() === 'corealm_retarget_ground' && channel.getTargetPath() === 'translation');
    const output = ground?.getSampler()?.getOutput();
    if (!output) throw new Error('Flight requires complete grounding track');
    for (let i = 0; i < output.getCount(); i++) {
      const p: number[] = output.getElement(i, []); p[1] = p[1]! + amount; output.setElement(i, p);
    }
  }
}

function restoreStudioBind(doc: Document) {
  const worlds = new Map<Node, Matrix4>();
  for (const mesh of doc.getRoot().listNodes().filter(node => node.getSkin())) {
    const skin = mesh.getSkin()!, inverse = skin.getInverseBindMatrices()!;
    skin.listJoints().forEach((joint, i) => worlds.set(joint, new Matrix4().fromArray(mesh.getWorldMatrix())
      .multiply(new Matrix4().fromArray(inverse.getElement(i, [])).invert())));
  }
  const depth = (node: Node): number => node.getParentNode() ? 1 + depth(node.getParentNode()!) : 0;
  for (const [joint, matrix] of [...worlds].sort((a, b) => depth(a[0]) - depth(b[0]))) {
    const parent = joint.getParentNode();
    const parentWorld = parent ? worlds.get(parent) ?? new Matrix4().fromArray(parent.getWorldMatrix()) : new Matrix4();
    joint.setMatrix(parentWorld.clone().invert().multiply(matrix).toArray());
  }
  return worlds.size;
}

function prepareLeafwing(doc: Document) {
  const node = find(doc, 'AmberveinLeafwingMesh'), skin = node.getSkin()!;
  const positions = new Map(doc.getRoot().listNodes().map(node => [node.getName(), world(node)]));
  const refit: Record<string, [number, number, number]> = {
    Thorax: [0, .50, .14], Neck: [0, .61, .20], Head: [0, .68, .20],
    AbdomenBase: [0, .34, .07], AbdomenMid: [0, .22, -.13], AbdomenTip: [0, .07, -.30],
  };
  for (const [side, sign] of [['L', -1], ['R', 1]] as const) {
    refit[`LegFrontCoxa_${side}`] = [sign * .10, .43, .16];
    refit[`LegFrontDistal_${side}`] = [sign * .12, .34, .25];
    refit[`WingUpperRoot_${side}`] = [sign * .08, .52, .12];
    refit[`WingLowerRoot_${side}`] = [sign * .08, .49, .12];
  }
  // Store every desired world point before moving ancestors. Unchanged helper
  // endpoints retain their original geometry locations for anatomical alignment.
  for (const [name, p] of Object.entries(refit)) positions.set(name, new Vector3(...p));
  const depth = (n: Node): number => n.getParentNode() ? 1 + depth(n.getParentNode()!) : 0;
  for (const joint of [...skin.listJoints()].sort((a, b) => depth(a) - depth(b))) {
    const parent = joint.getParentNode(), p = positions.get(joint.getName())!.clone();
    if (parent) p.applyMatrix4(new Matrix4().fromArray(parent.getWorldMatrix()).invert());
    joint.setTranslation(p.toArray());
  }
  for (const [side, sign] of [['L', -1], ['R', 1]] as const) {
    const parent = find(doc, `LegFrontDistal_${side}`);
    const hand = doc.createNode(`LeafClaw_${side}`).setTranslation(new Vector3(sign * .11, .25, .32)
      .applyMatrix4(new Matrix4().fromArray(parent.getWorldMatrix()).invert()).toArray());
    parent.addChild(hand); skin.addJoint(hand);
  }
  rebind(doc);
  const primitive = node.getMesh()!.listPrimitives()[0]!, isolated = new Map<number, string>();
  for (const island of components(primitive).filter(vertices => vertices.length > 50 && vertices.length < 200)) {
    const points = island.map(i => primitive.getAttribute('POSITION')!.getElement(i, []));
    const x = points.reduce((sum, p) => sum + p[0]!, 0) / points.length;
    const y = points.reduce((sum, p) => sum + p[1]!, 0) / points.length;
    for (const i of island) isolated.set(i, `Wing${y > .55 ? 'Upper' : 'Lower'}Root_${x < 0 ? 'L' : 'R'}`);
  }
  if (isolated.size !== 496) throw new Error('Leafwing membrane topology changed');
  const vertices = setWeights(doc, node, ([x, y, z], vertex) => {
    if (isolated.has(vertex)) return [[isolated.get(vertex)!, 1]];
    const side = x! < 0 ? 'L' : 'R';
    const arm = smooth(.045, .085, Math.abs(x!)) * smooth(.14, .23, z!) * (1 - smooth(.39, .46, y!));
    const forearm = 1 - smooth(.29, .37, y!), hand = 1 - smooth(.23, .28, y!);
    if (arm > .995) return [[`LegFrontCoxa_${side}`, 1 - forearm], [`LegFrontDistal_${side}`, forearm * (1 - hand)], [`LeafClaw_${side}`, forearm * hand]];
    const head = smooth(.51, .64, y!);
    const tail = (1 - smooth(.29, .43, y!)) * (1 - smooth(.05, .17, z!));
    const distal = 1 - smooth(-.22, -.06, z!), tip = 1 - smooth(-.31, -.22, z!);
    return [['Head', head], [`LegFrontCoxa_${side}`, (1 - head) * arm],
      ['Thorax', (1 - head) * (1 - arm) * (1 - tail)], ['AbdomenBase', (1 - head) * (1 - arm) * tail * (1 - distal)],
      ['AbdomenMid', (1 - head) * (1 - arm) * tail * distal * (1 - tip)], ['AbdomenTip', (1 - head) * (1 - arm) * tail * distal * tip]];
  }, 12);
  return { vertices, membraneVertices: isolated.size, refittedWorldPivots: refit, addedClawJoints: 2 };
}

/** Keep the studio action's body motion; settle the target's broad wings on the ground. */
function finishFairyFlight(doc: Document, prismatic: boolean) {
  const original = storedPose(doc), ground = find(doc, 'corealm_retarget_ground');
  const wings: { upper: Node; lower?: Node }[] = ['L', 'R'].map(side => prismatic ? { upper: find(doc, `Wing${side}H`) }
    : { upper: find(doc, `WingUpperRoot_${side}`), lower: find(doc, `WingLowerRoot_${side}`) });
  const members = (wing: { upper: Node; lower?: Node }) => wing.lower ? [wing.upper, wing.lower] : [wing.upper];
  const qWorld = (node: Node) => {
    const q = new Quaternion(); new Matrix4().fromArray(node.getWorldMatrix()).decompose(new Vector3(), q, new Vector3()); return q.normalize();
  };
  const normals = new Map<Node, Vector3>();
  for (const wing of wings) for (const joint of members(wing)) {
    const points: Vector3[] = [];
    for (const mesh of doc.getRoot().listNodes().filter(node => node.getSkin())) {
      const slot = mesh.getSkin()!.listJoints().indexOf(joint); if (slot < 0) continue;
      const transform = new Matrix4().fromArray(mesh.getWorldMatrix());
      for (const primitive of mesh.getMesh()!.listPrimitives()) {
        const positions = primitive.getAttribute('POSITION')!, joints = primitive.getAttribute('JOINTS_0')!, weights = primitive.getAttribute('WEIGHTS_0')!;
        for (let vertex = 0; vertex < positions.getCount(); vertex++) {
          const indices = joints.getElement(vertex, []), masses = weights.getElement(vertex, []);
          if (indices.reduce((sum, index, k) => sum + (index === slot ? masses[k]! : 0), 0) > .6) points.push(new Vector3().fromArray(positions.getElement(vertex, [])).applyMatrix4(transform));
        }
      }
    }
    if (points.length < 15) throw new Error(`Insufficient ${joint.getName()} membrane geometry`);
    const center = points.reduce((sum, point) => sum.add(point), new Vector3()).multiplyScalar(1 / points.length);
    const covariance = new Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);
    for (const point of points) {
      const p = point.clone().sub(center).toArray();
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) covariance.elements[col * 3 + row]! += p[row]! * p[col]! / points.length;
    }
    const epsilon = (covariance.elements[0]! + covariance.elements[4]! + covariance.elements[8]!) * 1e-8;
    for (const axis of [0, 4, 8]) covariance.elements[axis]! += epsilon;
    const inverse = covariance.invert(), normal = new Vector3(.37, .61, .7).normalize();
    for (let iteration = 0; iteration < 32; iteration++) normal.applyMatrix3(inverse).normalize();
    normals.set(joint, normal.applyQuaternion(qWorld(joint).invert()));
  }
  const bounds = deformedBounds(doc), lift = (bounds.max[1]! - bounds.min[1]!) * .13;
  const supportSpeed = (bounds.max[1]! - bounds.min[1]!) * 1.25;
  const flap = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Run')!;
  const flapSamplers = new Map(wings.map(wing => [wing.upper, flap.listChannels().find(channel => channel.getTargetNode() === wing.upper && channel.getTargetPath() === 'rotation')!.getSampler()!]));
  const supportReports: { clip: string; maximumSpeed: number }[] = [];
  const supports: { clip: ReturnType<Document['createAnimation']>; times: number[]; values: number[]; active: number; death: boolean }[] = [];
  for (const clip of doc.getRoot().listAnimations()) {
    const seconds = duration(clip), death = clip.getName() === 'Death', active = death ? seconds - .65 : seconds;
    const loop = ['Idle', 'Walk', 'Run'].includes(clip.getName());
    const cycles = Math.max(1, Math.round(seconds / (clip.getName() === 'Idle' ? 1 : clip.getName() === 'Walk' ? .85 : duration(flap))));
    const finalNormals = new Map<Node, Vector3>();
    if (death) {
      restorePose(original); applyClip(clip, active);
      for (const wing of wings) {
        wing.lower?.setRotation(wing.upper.getRotation());
        for (const joint of members(wing)) finalNormals.set(joint, new Vector3(0, normals.get(joint)!.clone().applyQuaternion(qWorld(joint)).y < 0 ? -1 : 1, 0));
      }
    }
    const steps = Math.ceil(active * 60), times = Array.from({ length: steps + 1 }, (_, i) => active * i / steps);
    if (death) times.push(seconds);
    const tracks = new Map<Node, number[]>([...wings.flatMap(members), ground].map(node => [node, []]));
    for (const t of times) {
      restorePose(original); applyClip(clip, t);
      for (const wing of wings) {
        // Native Idle's wings end mid-stroke even though its body loops. Repeat
        // the closed native Run wing cycle an integer number of times, avoiding
        // a false last-frame "seam fix" with a visible 119-degree discontinuity.
        if (loop) wing.upper.setRotation(sample(flapSamplers.get(wing.upper)!, (t / seconds * cycles % 1) * duration(flap)) as [number, number, number, number]);
        wing.lower?.setRotation(wing.upper.getRotation());
        if (death) for (const joint of members(wing)) {
          const q = qWorld(joint), normal = normals.get(joint)!.clone().applyQuaternion(q);
          const settled = new Quaternion().setFromUnitVectors(normal, finalNormals.get(joint)!).multiply(q);
          q.slerp(settled, smooth(active * .45, active * .82, t));
          const parent = joint.getParentNode(); joint.setRotation((parent ? qWorld(parent).invert().multiply(q) : q).toArray());
        }
        for (const joint of members(wing)) tracks.get(joint)!.push(...joint.getRotation());
      }
      ground.setTranslation([0, 0, 0]);
      const minimum = deformedBounds(doc).min[1]!;
      // The living body floats above its lowest appendage. Death loses that lift
      // during the donor's initial recoil and ends with physical geometry at floor.
      const hover = death ? 0 : lift;
      tracks.get(ground)!.push(0, .006 - minimum + hover, 0);
    }
    supports.push({ clip, times, values: tracks.get(ground)!, active, death });
    for (const [node, values] of tracks) {
      const path = node === ground ? 'translation' : 'rotation';
      for (const channel of [...clip.listChannels()]) if (channel.getTargetNode() === node && channel.getTargetPath() === path) channel.dispose();
      if (loop) values.splice(values.length - (path === 'rotation' ? 4 : 3), path === 'rotation' ? 4 : 3, ...values.slice(0, path === 'rotation' ? 4 : 3));
      addChannel(doc, clip, node, path, times, values);
    }
  }
  // Flying bodies retain their studio vertical movement. A common constant
  // offset clears every living wing stroke; per-frame floor tracking would
  // cancel hover and make wing strokes jerk the whole creature up and down.
  const livingOffset = Math.max(...supports.filter(support => !support.death).flatMap(support => support.times.map((_, i) => support.values[i * 3 + 1]!)));
  for (const { clip, times, values, active, death } of supports) {
    if (death) {
      // Native studio arms can swing through 80 degrees in one source frame.
      // The smallest speed-limited upper envelope anticipates contact without
      // allowing that hand swing to teleport the entire target upward.
      const finalContact = values[values.length - 2]!;
      const required = times.map((t, i) => Math.max(values[i * 3 + 1]!, livingOffset + (finalContact - livingOffset) * smooth(active * .15, active * .75, t)));
      for (let i = 0; i < times.length; i++) values[i * 3 + 1] = Math.max(...required.map((height, j) => height - supportSpeed * Math.abs(times[j]! - times[i]!)));
    } else for (let i = 0; i < times.length; i++) values[i * 3 + 1] = livingOffset;
    const output = clip.listChannels().find(channel => channel.getTargetNode() === ground && channel.getTargetPath() === 'translation')!.getSampler()!.getOutput()!;
    for (let i = 0; i < times.length; i++) output.setElement(i, values.slice(i * 3, i * 3 + 3));
    supportReports.push({ clip: clip.getName(), maximumSpeed: Math.max(...times.slice(1).map((t, i) => Math.abs(values[(i + 1) * 3 + 1]! - values[i * 3 + 1]!) / (t - times[i]!))) });
  }
  restorePose(original);
  return { wingPlaneNormals: [...normals].map(([node, normal]) => ({ node: node.getName(), localNormal: normal.toArray() })),
    livingOffset, deathSupportSpeedLimit: supportSpeed, supportReports, loopWingSource: 'Integer repeats of the closed native Run wing take' };
}

async function fairyFlyer(doc: Document, readAsset: (id: string) => Promise<Document>, prismatic: boolean) {
  const weights = prismatic ? preparePrismatic(doc) : prepareLeafwing(doc), donor = await readAsset('fantasy_monster_08');
  const restoredDonorJoints = restoreStudioBind(donor);
  const mapping: Record<string, string> = prismatic ? { Pelvis: 'rootx', Thorax: 'spine_03x', Head: 'headx' }
    : { LeafwingRoot: 'rootx', Thorax: 'spine_03x', Neck: 'neckx', Head: 'headx' };
  const directions: Record<string, string> = prismatic ? { Pelvis: 'Thorax', Thorax: 'Head' } : { Thorax: 'Neck', Neck: 'Head' };
  const sourceDirections: Record<string, string> = { rootx: 'spine_01x', spine_03x: 'neckx', neckx: 'headx' };
  for (const [side, donorSide] of [['L', 'r'], ['R', 'l']]) {
    const names = prismatic ? [`ArmShoulder${side}`, `ArmElbow${side}`, `ArmHand${side}`]
      : [`LegFrontCoxa_${side}`, `LegFrontDistal_${side}`, `LeafClaw_${side}`];
    names.forEach((name, i) => mapping[name!] = `${['arm_stretch', 'forearm_stretch', 'hand'][i]}${donorSide}`);
    directions[names[0]!] = names[1]!; directions[names[1]!] = names[2]!;
    sourceDirections[`arm_stretch${donorSide}`] = `forearm_stretch${donorSide}`;
    sourceDirections[`forearm_stretch${donorSide}`] = `hand${donorSide}`;
    const wing = find(doc, prismatic ? `Wing${side}H` : `WingUpperRoot_${side}`);
    mapping[wing.getName()] = `arm_stretch_dupli_001${donorSide}`;
    if (prismatic) {
      const guide = doc.createNode(`WingGuide${side}`).setTranslation([side === 'L' ? -.55 : .55, .40, -.25]); wing.addChild(guide);
      directions[wing.getName()] = guide.getName();
      for (const [target, source, child] of [['NativeThigh', 'thigh_stretch', 'NativeShin'], ['NativeShin', 'leg_stretch', 'NativeFoot'], ['NativeFoot', 'foot', '']]) {
        mapping[`${target}${side}`] = `${source}${donorSide}`;
        if (child) directions[`${target}${side}`] = `${child}${side}`;
      }
      sourceDirections[`thigh_stretch${donorSide}`] = `leg_stretch${donorSide}`;
      sourceDirections[`leg_stretch${donorSide}`] = `foot${donorSide}`;
    } else directions[wing.getName()] = `WingUpperMid_${side}`;
    sourceDirections[`arm_stretch_dupli_001${donorSide}`] = `forearm_stretch_dupli_001${donorSide}`;
  }
  const targetHeight = deformedBounds(doc).max[1]! - deformedBounds(doc).min[1]!;
  const sourceHeight = world(find(donor, 'headx')).y - world(find(donor, 'rootx')).y;
  const targetTorso = world(find(doc, 'Head')).distanceTo(world(find(doc, prismatic ? 'Pelvis' : 'Thorax')));
  const motion = retargetCreatureMotion(doc, donor, { mapping, directionChildren: directions, sourceDirectionChildren: sourceDirections,
    sourceToTargetRotation: [0, 0, 0, 1], root: { target: prismatic ? 'Pelvis' : 'LeafwingRoot', source: 'rootx', translationScale: targetTorso / sourceHeight, horizontal: 'in-place' },
    clips: { Idle: { source: 'Idle', loop: true }, Walk: { source: 'Walk', loop: true }, Run: { source: 'Run', loop: true },
      Attack: { source: 'Attack' }, Hit: { source: 'Hit' }, Death: { source: 'Death', holdLastSeconds: .65 } },
    replaceAnimations: true, samplesPerSecond: 60, grounding: { floor: .006, maxCorrection: targetHeight * 2 } });
  const flight = finishFairyFlight(doc, prismatic);
  // Native08 winds its right arm back through .5, strikes at .6, then recovers.
  // A long target hand can reach farther during recovery; that is not a second hit.
  const contact = attackContact(doc, prismatic ? ['ArmHandL'] : ['LeafClaw_L'], [.5, .7]);
  return { changes: ['Refitted body and claw pivots to the actual winged anatomy; preserved original geometry and textures.',
    'Transferred six native Pixelius mantis flying takes, including forward-pitched Run, claw swipe, recoil and full falling roll.',
    'Separated broad wing membranes from arm and head ownership; wings settle beside the held corpse.'],
    provenance: { weights, donor: 'fantasy_monster_08', restoredDonorJoints, motion, contact, flight },
    motion: { walkClipSeconds: 1, runClipSeconds: duration(doc.getRoot().listAnimations().find(c => c.getName() === 'Run')!),
      attackSeconds: duration(doc.getRoot().listAnimations().find(c => c.getName() === 'Attack')!), contactNormalized: contact.normalized,
      groundY: 0, impliedWalkMps: 0, impliedRunMps: 0 } };
}

function attackContact(doc: Document, names: string[], window: [number, number] = [0, 1]) {
  const pose = storedPose(doc), clip = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Attack')!;
  const seconds = duration(clip); let best = -Infinity, phase = 0;
  for (let i = 0; i <= 120; i++) {
    const sampledPhase = window[0] + (window[1] - window[0]) * i / 120;
    restorePose(pose); applyClip(clip, seconds * sampledPhase);
    const reach = Math.max(...names.map(name => world(find(doc, name)).z));
    if (reach > best + 1e-7) { best = reach; phase = sampledPhase; }
  }
  restorePose(pose);
  return { normalized: phase, seconds: phase * seconds, nodes: names, window, method: 'Maximum forward world-Z of the anatomical strike joint across 121 production clip samples in the donor strike window' };
}

/** Measure the actual weighted soles, after retargeting and grounding, in model metres. */
function orchidGaits(doc: Document) {
  const node = find(doc, 'OrchidReaperMesh'), primitive = node.getMesh()!.listPrimitives()[0]!, skin = node.getSkin()!;
  const positions = primitive.getAttribute('POSITION')!, indices = primitive.getAttribute('JOINTS_0')!, weights = primitive.getAttribute('WEIGHTS_0')!;
  const joints = skin.listJoints(), inverse = skin.getInverseBindMatrices()!, pose = storedPose(doc);
  const point = new Vector3(), total = new Vector3();
  const matrices = () => joints.map((joint, i) => new Matrix4().fromArray(joint.getWorldMatrix()).multiply(new Matrix4().fromArray(inverse.getElement(i, []))));
  const deform = (vertex: number, transforms: Matrix4[]) => {
    const p = positions.getElement(vertex, []), j = indices.getElement(vertex, []), w = weights.getElement(vertex, []);
    total.set(0, 0, 0);
    for (let k = 0; k < 4; k++) if (w[k]! > 0) total.add(point.fromArray(p).applyMatrix4(transforms[j[k]!]!).multiplyScalar(w[k]!));
    return total.toArray();
  };
  const bounds = deformedBounds(doc), height = bounds.max[1]! - bounds.min[1]!;
  const patches = ['L', 'R'].map(side => {
    const vertices: number[] = [];
    for (let vertex = 0; vertex < positions.getCount(); vertex++) {
      const j = indices.getElement(vertex, []), w = weights.getElement(vertex, []);
      const mass = j.reduce((sum, joint, k) => sum + (joints[joint]?.getName() === `Ankle_${side}` ? w[k]! : 0), 0);
      if (mass > .6) vertices.push(vertex);
    }
    // A digitigrade claw can land on a toe surface that was not the lowest part
    // of its authored rest pose. Retain the whole foot, then select the actual
    // lowest weighted surface independently at each production clip sample.
    if (vertices.length < 3) throw new Error(`Insufficient ${side} sole vertices for gait measurement`);
    return { side, vertices };
  });
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  };
  const reports = ['Walk', 'Run'].map(name => {
    const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === name)!, seconds = duration(clip), samples = 240, dt = seconds / samples;
    const traces = patches.map(() => [] as number[][][]);
    for (let i = 0; i <= samples; i++) {
      restorePose(pose); applyClip(clip, i * dt); const transforms = matrices();
      patches.forEach((patch, foot) => traces[foot]!.push(patch.vertices.map(vertex => deform(vertex, transforms))));
    }
    const velocities: number[] = [];
    const feet = patches.map((patch, foot) => {
      const trace = traces[foot]!, contactVelocities: number[] = [], phases: number[] = [];
      for (let i = 1; i < samples; i++) {
        const current = trace[i]!, floor = Math.min(...current.map(p => p[1]!));
        if (floor > .006 + height * .005) continue;
        const speeds: number[] = [];
        current.forEach((p, vertex) => {
          if (p[1]! > floor + height * .004) return;
          const before = trace[i - 1]![vertex]!, after = trace[i + 1]![vertex]!;
          const speed = (before[2]! - after[2]!) / (2 * dt), vertical = Math.abs(after[1]! - before[1]!) / (2 * dt);
          if (speed > height * .01 && vertical < height * .20) speeds.push(speed);
        });
        if (speeds.length) { contactVelocities.push(median(speeds)); phases.push(i / samples); }
      }
      if (contactVelocities.length < 5) throw new Error(`${name} ${patch.side} has insufficient physical stance samples`);
      velocities.push(...contactVelocities);
      return { side: patch.side, candidateFootVertices: patch.vertices.length, stanceSamples: contactVelocities.length, medianMps: median(contactVelocities), phases };
    });
    const bilateralRatio = Math.max(...feet.map(foot => foot.medianMps)) / Math.min(...feet.map(foot => foot.medianMps));
    if (bilateralRatio > 1.35) throw new Error(`${name} has inconsistent bilateral physical contact speeds: ${bilateralRatio}`);
    return { name, seconds, samples: samples + 1, impliedMps: median(velocities), bilateralRatio, feet };
  });
  restorePose(pose);
  return { method: 'Median backward velocity of the same weighted foot vertices across 240 phase intervals. Select the actual lowest surface per frame (including rotating claws), within 0.5% model height of the floor and 0.4% height of the foot minimum; reject vertical speed above 20% height/second and bilateral median disagreement above 35%.', reports };
}

async function wasp(doc: Document, readAsset: (id: string) => Promise<Document>) {
  const weights = repairWaspWeights(doc), donor = await readAsset('enemy_bee');
  const root = 'WaspRoot';
  const mapping: Record<string, string> = { [root]: 'Head' };
  for (const [side, donorSide] of [['L', 'R'], ['R', 'L']]) for (const tier of ['Upper', 'Lower']) mapping[`Wing${tier}Root_${side}`] = `Wing2.${donorSide}`;
  const motion = retargetCreatureMotion(doc, donor, {
    mapping, sourceToTargetRotation: [0, 0, 0, 1], root: { target: root, source: 'Head', translationScale: .5, horizontal: 'in-place' },
    clips: { Idle: { source: 'Flying', loop: true }, Walk: { source: 'Flying', duration: .9, loop: true }, Run: { source: 'Flying', duration: .65, loop: true },
      Attack: { source: 'Bite_Front' }, Hit: { source: 'HitRecieve' }, Death: { source: 'Death', holdLastSeconds: .6 } },
    replaceAnimations: true, samplesPerSecond: 60, grounding: { floor: .006, maxCorrection: 1.5 },
  });
  // The bee's bite has separate mouth articulation. A body-only transfer loses
  // the strike entirely on this jawless target. Adapt that authored articulation
  // to the wasp's neck and abdominal hinge while retaining its timing and recoil.
  const targetPose = storedPose(doc), sourcePose = storedPose(donor);
  const bite = donor.getRoot().listAnimations().find(c => c.getName() === 'Bite_Front')!;
  const attack = doc.getRoot().listAnimations().find(c => c.getName() === 'Attack')!;
  const mouth = find(donor, 'Mouth'), restMouth = new Quaternion().fromArray(mouth.getRotation());
  const seconds = duration(attack), steps = Math.ceil(seconds * 60), times = Array.from({ length: steps + 1 }, (_, i) => seconds * i / steps);
  for (const [name, amplitude] of [['Neck', 1.8], ['AbdomenBase', 4], ['AbdomenMid', 3], ['AbdomenTip', 2.5]] as const) {
    const node = find(doc, name), restLocal = new Quaternion().fromArray(node.getRotation()), restWorld = new Quaternion();
    new Matrix4().fromArray(node.getWorldMatrix()).decompose(new Vector3(), restWorld, new Vector3());
    const values: number[] = [];
    for (const t of times) {
      restorePose(sourcePose); applyClip(bite, t);
      const delta = new Quaternion().fromArray(mouth.getRotation()).multiply(restMouth.clone().invert());
      const angle = 2 * Math.acos(Math.max(-1, Math.min(1, delta.w))), axis = new Vector3(delta.x, delta.y, delta.z);
      const amplified = axis.lengthSq() > 1e-10 ? new Quaternion().setFromAxisAngle(axis.normalize(), angle * amplitude) : new Quaternion();
      values.push(...restLocal.clone().multiply(restWorld.clone().invert().multiply(amplified).multiply(restWorld)).toArray());
    }
    for (const channel of [...attack.listChannels()]) if (channel.getTargetNode() === node && channel.getTargetPath() === 'rotation') channel.dispose();
    addChannel(doc, attack, node, 'rotation', times, values);
  }
  restorePose(sourcePose); restorePose(targetPose);
  const height = deformedBounds(doc).max[1]! - deformedBounds(doc).min[1]!;
  liftFlight(doc, height * .10);
  const contact = attackContact(doc, ['AbdomenTip']);
  return { changes: ['Replaced arbitrary wing oscillations with Quaternius bee flight, strike, hit and death sequences.',
    'Removed wing/leg cross-influences and kept each separate membrane on its anatomical hinge.', 'Baked complete poses for every clip, exact loop seams and a held grounded corpse.'],
    provenance: { weights, donor: 'enemy_bee', donorAnatomy: 'Compatible flying body and wing hinges. Native mouth strike articulation drives the jawless wasp neck and three segmented abdominal hinges (neck1.8×,base4×,mid3×,tip2.5×), bringing its stinger forward.', motion, contact },
    motion: { walkClipSeconds: .9, runClipSeconds: .65, attackSeconds: 1.125, contactNormalized: contact.normalized, groundY: 0, impliedWalkMps: 0, impliedRunMps: 0 } };
}

async function orchid(doc: Document, readAsset: (id: string) => Promise<Document>) {
  const weights = { vertices: repairOrchidWeights(doc) };
  const donor = await readAsset('animation_library_1');
  const mapping: Record<string, string> = { Pelvis: 'pelvis', Spine: 'spine_01', Chest: 'spine_03', Neck: 'neck_01', Head: 'Head' };
  const directionChildren: Record<string, string> = { Pelvis: 'Spine', Spine: 'Chest', Chest: 'Neck', Neck: 'Head' };
  const sourceDirectionChildren: Record<string, string> = { pelvis: 'spine_01', spine_01: 'spine_02', spine_03: 'neck_01', neck_01: 'Head' };
  // These authored rigs call negative-X "L". The studio library calls positive-X
  // "l"; semantic left/right must follow the geometry rather than the spelling.
  for (const [side, sourceSide] of [['L', 'r'], ['R', 'l']]) {
    const names = [`Shoulder_${side}`, `Elbow_${side}`, `ScytheRoot_${side}`, `Hip_${side}`, `Knee_${side}`, `Ankle_${side}`];
    mapping[names[0]!] = `upperarm_${sourceSide}`; mapping[names[1]!] = `lowerarm_${sourceSide}`;
    mapping[names[3]!] = `thigh_${sourceSide}`; mapping[names[4]!] = `calf_${sourceSide}`; mapping[names[5]!] = `foot_${sourceSide}`;
    directionChildren[names[0]!] = names[1]!; directionChildren[names[1]!] = names[2]!;
    directionChildren[names[3]!] = names[4]!; directionChildren[names[4]!] = names[5]!;
    sourceDirectionChildren[`upperarm_${sourceSide}`] = `lowerarm_${sourceSide}`;
    sourceDirectionChildren[`lowerarm_${sourceSide}`] = `hand_${sourceSide}`;
    sourceDirectionChildren[`thigh_${sourceSide}`] = `calf_${sourceSide}`;
    sourceDirectionChildren[`calf_${sourceSide}`] = `foot_${sourceSide}`;
  }
  const targetLeg = ['Hip_L', 'Knee_L', 'Ankle_L'];
  const length = (d: Document, names: string[]) => world(find(d, names[0]!)).distanceTo(world(find(d, names[1]!))) + world(find(d, names[1]!)).distanceTo(world(find(d, names[2]!)));
  const scale = length(doc, targetLeg) / length(donor, ['thigh_l', 'calf_l', 'foot_l']);
  const motion = retargetCreatureMotion(doc, donor, {
    mapping, directionChildren, sourceDirectionChildren, sourceToTargetRotation: [0, 0, 0, 1],
    root: { target: 'Pelvis', source: 'pelvis', translationScale: scale, horizontal: 'in-place' },
    clips: { Idle: { source: 'Idle_Loop', loop: true }, Walk: { source: 'Walk_Loop', loop: true }, Run: { source: 'Jog_Fwd_Loop', loop: true },
      Attack: { source: 'Sword_Attack' }, Hit: { source: 'Hit_Chest' }, Death: { source: 'Death01', holdLastSeconds: .6 } },
    replaceAnimations: true, samplesPerSecond: 30, grounding: { floor: .006, maxCorrection: 2 },
  });
  const contact = attackContact(doc, ['ScytheTip_L', 'ScytheTip_R']);
  const gait = orchidGaits(doc);
  return { changes: ['Replaced coordinate-crossed weights with anatomical arm, shin, foot and rigid blade/crown influences.',
    'Retargeted studio biped poses through world-space anatomical alignment and complete reset tracks.', 'Preserved every original texture and mesh triangle.'],
    provenance: { weights, donor: 'animation_library_1', motion, contact, gait },
    motion: { walkClipSeconds: duration(doc.getRoot().listAnimations().find(c => c.getName() === 'Walk')!), runClipSeconds: duration(doc.getRoot().listAnimations().find(c => c.getName() === 'Run')!),
      attackSeconds: duration(doc.getRoot().listAnimations().find(c => c.getName() === 'Attack')!), contactNormalized: contact.normalized, groundY: 0,
      impliedWalkMps: gait.reports[0]!.impliedMps, impliedRunMps: gait.reports[1]!.impliedMps } };
}

export const profile: CreatureRepairProfile = {
  id: 'winged',
  assetIds: ['creature_field_wasp', 'creature_heath_wasp', 'creature_marsh_wasp', 'creature_reed_wasp', 'creature_lantern_sprite',
    'fairy_garden_imp_gloamgarden', 'fairy_garden_imp_faeholme', 'creature_orchid_reaper',
    'fairy_garden_petalguard_gloamgarden', 'fairy_garden_petalguard_faeholme', 'creature_prismatic_sprite'],
  async repair(doc, { assetId, readAsset }) {
    if (/orchid_reaper|petalguard/.test(assetId)) return orchid(doc, readAsset);
    if (assetId === 'creature_prismatic_sprite') return fairyFlyer(doc, readAsset, true);
    if (!assetId.endsWith('_wasp')) return fairyFlyer(doc, readAsset, false);
    return wasp(doc, readAsset);
  },
};
