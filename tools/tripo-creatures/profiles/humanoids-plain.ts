import type { Document, Node } from '@gltf-transform/core';
import { Matrix4, Vector3 } from 'three';
import type { CreatureRepairProfile } from '../repairProfile.js';
import { retargetCreatureMotion, type CreatureMotionProfile } from '../retarget.js';
import { applyClip, duration, restorePose, storedPose } from '../../creature-motion/pose.js';
import { deformedBounds } from '../../creature-motion/validate-deformation.js';

const ids = [
  'ashseal_warden', 'banshee', 'beetle_golem', 'boss_ordrun', 'gloamfang_reaver', 'hollow_bough',
  'lava_golem', 'nightforge_marshal', 'pallid_shade', 'pearl_knight', 'revenant', 'road_bandit',
  'shale_elemental', 'starroot_guardian', 'voidstone_colossus',
].map(id => `creature_${id}`);
const world = (node: Node) => new Matrix4().fromArray(node.getWorldMatrix());
const at = (node: Node) => new Vector3().setFromMatrixPosition(world(node));
const depth = (node: Node): number => node.getParentNode() ? depth(node.getParentNode()!) + 1 : 0;

/** glTF inverse binds are relative to the skinned mesh, including its presentation scale. */
function restoreBind(doc: Document) {
  const skin = doc.getRoot().listSkins()[0]!;
  const mesh = doc.getRoot().listNodes().find(node => node.getSkin() === skin)!;
  const meshWorld = world(mesh);
  const bind = new Map(skin.listJoints().map((node, i) => [node,
    meshWorld.clone().multiply(new Matrix4().fromArray(skin.getInverseBindMatrices()!.getElement(i, [])).invert())]));
  for (const node of [...bind.keys()].sort((a, b) => depth(a) - depth(b))) {
    const parent = node.getParentNode();
    node.setMatrix((parent ? world(parent).invert() : new Matrix4()).multiply(bind.get(node)!).toArray());
  }
  return meshWorld;
}

const plainNames: Record<string, string> = { hips: 'Hips', spine: 'Spine', chest: 'Spine1', upper: 'Spine2', neck: 'Neck', head: 'Head' };
for (const side of ['Left', 'Right']) for (const [role, name] of Object.entries({ shoulder: 'Shoulder', arm: 'Arm', elbow: 'ForeArm', hand: 'Hand', hip: 'UpLeg', knee: 'Leg', foot: 'Foot', toe: 'ToeBase' })) plainNames[side + role] = side + name;
const nativeNames: Record<string, string> = { hips: 'Hips', spine: 'Spine', chest: 'Chest', upper: 'UpperChest', neck: 'Neck', head: 'Head' };
for (const side of ['Left', 'Right']) for (const [role, name] of Object.entries({ shoulder: '_Shoulder', arm: '_UpperArm', elbow: '_LowerArm', hand: '_Hand', hip: '_UpperLeg', knee: '_LowerLeg', foot: '_Foot', toe: '_Toes' })) nativeNames[side + role] = side + name;
const roadNames: Record<string, string> = { hips: 'Hips', spine: 'Spine', upper: 'Chest', neck: 'Neck', head: 'Head' };
for (const side of ['Left', 'Right']) for (const [role, name] of Object.entries({ arm: 'UpperArm', elbow: 'ForeArm', hand: 'Hand', hip: 'UpperLeg', knee: 'LowerLeg', foot: 'Foot' })) roadNames[side + role] = side + name;
const treeNames: Record<string, string> = { hips: 'Pelvis', spine: 'LowerTrunk', upper: 'Chest', neck: 'Neck', head: 'Crown' };
for (const [side, suffix] of [['Left', '_L'], ['Right', '_R']]) for (const [role, name] of Object.entries({ arm: 'Shoulder', elbow: 'Elbow', hand: 'Wrist', hip: 'Hip', knee: 'Knee', foot: 'Foot' })) treeNames[side! + role] = name + suffix;

function anatomy(doc: Document, id: string) {
  const names = id === 'creature_hollow_bough' ? treeNames : id === 'creature_road_bandit' ? roadNames :
    ['creature_beetle_golem', 'creature_boss_ordrun', 'creature_gloamfang_reaver'].includes(id) ? nativeNames :
      Object.fromEntries(Object.entries(plainNames).map(([role, name]) => [role, `mixamorig${name}`]));
  const byName = new Map(doc.getRoot().listNodes().map(node => [node.getName(), node]));
  return Object.fromEntries(Object.entries(names).map(([role, name]) => {
    const node = byName.get(name); if (!node) throw new Error(`${id}: missing anatomical joint ${name}`);
    return [role, node];
  })) as Record<string, Node>;
}

/** These are source-mesh landmarks, not an animation pose or an assumed universal T-pose. */
function refitPlain(doc: Document, id: string, bones: Record<string, Node>) {
  const skin = doc.getRoot().listSkins()[0]!, joints = skin.listJoints();
  const meshNode = doc.getRoot().listNodes().find(node => node.getSkin() === skin)!;
  const meshWorld = world(meshNode), meshInverse = meshWorld.clone().invert();
  const points = meshNode.getMesh()!.listPrimitives().flatMap(primitive => {
    const positions = primitive.getAttribute('POSITION')!;
    return Array.from({ length: positions.getCount() }, (_, index) => new Vector3().fromArray(positions.getElement(index, [])));
  });
  const minY = Math.min(...points.map(p => p.y)), height = Math.max(...points.map(p => p.y)) - minY;
  const meshPositions = new Map(joints.map(node => [node, at(node).applyMatrix4(meshInverse)]));
  const sideways = id === 'creature_hollow_bough' || id === 'creature_road_bandit';
  const lateral = (p: Vector3) => sideways ? p.z : p.x;
  const leftSign = Math.sign(lateral(meshPositions.get(bones.Leftarm!)!));
  const landmark = (role: string, x: number, y: number, z?: number) => {
    const node = bones[role]; if (!node) return;
    const old = meshPositions.get(node)!;
    const p = sideways ? new Vector3(z ?? old.x, minY + y * height, x * height) : new Vector3(x * height, minY + y * height, z ?? old.z);
    if (z === undefined) {
      // The middle of the local front/back surface fits the pivot inside the source body.
      const nearby = points.filter(v => Math.abs(lateral(v) - lateral(p)) < height * .075 && Math.abs(v.y - p.y) < height * .04)
        .map(v => sideways ? v.x : v.z).sort((a, b) => a - b);
      if (nearby.length >= 8) {
        const center = (nearby[Math.floor((nearby.length - 1) * .18)]! + nearby[Math.floor((nearby.length - 1) * .82)]!) / 2;
        if (sideways) p.x = center; else p.z = center;
      }
    }
    meshPositions.set(node, p);
  };
  const mirrored = (role: string, x: number, y: number) => {
    landmark('Left' + role, x * leftSign, y); landmark('Right' + role, -x * leftSign, y);
  };
  if (id === 'creature_nightforge_marshal') {
    mirrored('shoulder', .105, .78); mirrored('arm', .18, .785); mirrored('elbow', .31, .79); mirrored('hand', .445, .785);
    mirrored('hip', .125, .39); mirrored('knee', .151, .235); mirrored('foot', .13, .07); mirrored('toe', .13, .034);
    landmark('hips', 0, .445); landmark('neck', 0, .80); landmark('head', 0, .845);
  } else if (id === 'creature_pearl_knight') {
    mirrored('shoulder', .10, .785); mirrored('arm', .17, .785); mirrored('elbow', .30, .785); mirrored('hand', .42, .785);
    mirrored('hip', .11, .40); mirrored('knee', .108, .23); mirrored('foot', .115, .06); mirrored('toe', .115, .025);
    landmark('hips', 0, .45); landmark('neck', 0, .815); landmark('head', 0, .855);
  } else if (id === 'creature_ashseal_warden' || id === 'creature_voidstone_colossus') {
    const ash = id === 'creature_ashseal_warden';
    mirrored('shoulder', .12, .75); mirrored('arm', ash ? .25 : .21, .73);
    mirrored('elbow', ash ? .34 : .285, .57); mirrored('hand', ash ? .36 : .31, .34);
    mirrored('hip', .15, .365); mirrored('knee', ash ? .18 : .145, .21); mirrored('foot', ash ? .18 : .14, .07); mirrored('toe', ash ? .18 : .14, .033);
    landmark('hips', 0, .425); landmark('spine', 0, .52); landmark('chest', 0, .63); landmark('upper', 0, .72); landmark('neck', 0, .81); landmark('head', 0, .845);
  } else if (id === 'creature_lava_golem') {
    // This sparse sculpt has a forward jaw overlapping the chest in front view.
    // Surface quantiles select the jaw for the chest and miss the narrow thighs;
    // use measured mesh-local pivots through the actual trunk and limb bends.
    const sculpt = (role: string, x: number, y: number, z: number) => landmark(role, x / height, (y - minY) / height, z);
    const pair = (role: string, x: number, y: number, z: number) => {
      sculpt('Left' + role, x * leftSign, y, z); sculpt('Right' + role, -x * leftSign, y, z);
    };
    sculpt('hips', 0, .139, .070); sculpt('spine', 0, .159, .059); sculpt('chest', 0, .185, .063);
    sculpt('upper', 0, .213, .070); sculpt('neck', 0, .237, .081); sculpt('head', 0, .253, .103);
    pair('shoulder', .030, .218, .073); pair('arm', .058, .219, .076);
    pair('elbow', .090, .179, .063); pair('hand', .123, .122, .071);
    pair('hip', .016, .131, .082); pair('knee', .031, .079, .104);
    pair('foot', .033, .031, .079); pair('toe', .033, .015, .077);
  } else if (id === 'creature_starroot_guardian') {
    landmark('hips', 0, .435); landmark('spine', 0, .515); landmark('chest', 0, .615); landmark('upper', 0, .70); landmark('neck', 0, .755); landmark('head', 0, .79);
    mirrored('shoulder', .10, .70); mirrored('arm', .19, .665); mirrored('elbow', .275, .49); mirrored('hand', .35, .275);
    mirrored('hip', .13, .37); mirrored('knee', .15, .20); mirrored('foot', .13, .07); mirrored('toe', .13, .035);
  } else if (id === 'creature_revenant' || id === 'creature_pallid_shade') {
    mirrored('shoulder', .09, .735); mirrored('arm', .15, .715); mirrored('elbow', .195, .54); mirrored('hand', .205, .41);
    mirrored('hip', .10, .395); mirrored('knee', .115, .235); mirrored('foot', .11, .07); mirrored('toe', .11, .03);
    landmark('hips', 0, .435); landmark('neck', 0, .805); landmark('head', 0, .85);
  } else if (id === 'creature_road_bandit') {
    mirrored('arm', .145, .775); mirrored('elbow', .29, .78); mirrored('hand', .412, .77);
    mirrored('hip', .095, .50); mirrored('knee', .105, .285); mirrored('foot', .11, .075);
    landmark('head', 0, .855);
  } else if (id === 'creature_hollow_bough') {
    mirrored('arm', .205, .725); mirrored('elbow', .365, .73); mirrored('hand', .515, .695);
    landmark('head', 0, .85);
  } else if (id === 'creature_banshee') {
    // Preserve the asymmetric bent trunk and the shroud; the skull pivots at the neck.
    const head = meshPositions.get(bones.head!)!, neck = meshPositions.get(bones.neck!)!;
    head.y = neck.y + height * .025;
  }
  // New inverse binds retain every source vertex in precisely the same static position.
  const oldBind = new Map(joints.map((node, index) => [node, new Matrix4().fromArray(skin.getInverseBindMatrices()!.getElement(index, [])).invert()]));
  for (const node of [...joints].sort((a, b) => depth(a) - depth(b))) {
    const bind = oldBind.get(node)!.clone().setPosition(meshPositions.get(node)!);
    const desired = meshWorld.clone().multiply(bind), parent = node.getParentNode();
    node.setMatrix((parent ? world(parent).invert() : new Matrix4()).multiply(desired).toArray());
  }
  const inverse = new Float32Array(joints.length * 16);
  joints.forEach((joint, index) => inverse.set(world(joint).invert().multiply(meshWorld).toArray(), index * 16));
  skin.getInverseBindMatrices()!.setArray(inverse);
  return { height, meshPositions, landmarks: Object.fromEntries(Object.entries(bones).map(([name, joint]) => [name, meshPositions.get(joint)!.toArray()])) };
}

/** Weight a bone's outgoing segment to that bone, never to its distal child's pivot. */
function rebuildWeights(doc: Document, bones: Record<string, Node>, preservedPrefixes: string[] = [], limitLimbRegions = false) {
  const skin = doc.getRoot().listSkins()[0]!, joints = skin.listJoints(), meshNode = doc.getRoot().listNodes().find(node => node.getSkin() === skin)!;
  const inverseMesh = world(meshNode).invert();
  const positions = new Map(joints.map(node => [node, at(node).applyMatrix4(inverseMesh)]));
  const bounds = deformedBounds(doc), height = (bounds.max[1]! - bounds.min[1]!) / new Vector3().setFromMatrixScale(world(meshNode)).y;
  const children: Record<string, string> = { hips: 'spine', spine: bones.chest ? 'chest' : 'upper', chest: 'upper', upper: 'neck', neck: 'head' };
  for (const side of ['Left', 'Right']) for (const [role, child] of Object.entries({ shoulder: 'arm', arm: 'elbow', elbow: 'hand', hip: 'knee', knee: 'foot', foot: 'toe' })) if (bones[side + child]) children[side + role] = side + child;
  const capsules = Object.entries(bones).map(([role, node]) => {
    const a = positions.get(node)!, child = bones[children[role]!]; let b: Vector3;
    if (child) b = positions.get(child)!.clone();
    else if (role.endsWith('hand')) b = a.clone().addScaledVector(a.clone().sub(positions.get(bones[role.replace('hand', 'elbow')]!)!).normalize(), height * .075);
    else if (role.endsWith('foot') || role.endsWith('toe')) {
      const forward = new Vector3(0, 0, 1).transformDirection(inverseMesh);
      b = a.clone().addScaledVector(forward, height * .055);
    } else b = a.clone().add(new Vector3(0, height * .11, 0));
    return { role, node, index: joints.indexOf(node), a, b, parent: node.getParentNode() };
  });
  const buffer = doc.getRoot().listBuffers()[0]!, assigned: Record<string, number> = {};
  const center = positions.get(bones.hips!)!;
  const leftAxis = positions.get(bones.Lefthip!)!.clone().sub(center); leftAxis.y = 0; leftAxis.normalize();
  const smooth = (a: number, b: number, value: number) => {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t);
  };
  const eligibility = (role: string, p: Vector3) => {
    if (!limitLimbRegions) return 1;
    const side = role.startsWith('Left') ? 'Left' : role.startsWith('Right') ? 'Right' : null;
    if (!side) return 1;
    const lateral = p.clone().sub(center).dot(leftAxis) * (side === 'Left' ? 1 : -1);
    let gate = smooth(-height * .05, height * .02, lateral);
    const part = role.slice(side.length);
    if (['hip', 'knee', 'foot', 'toe'].includes(part)) {
      const hipY = positions.get(bones[side + 'hip']!)!.y;
      gate *= 1 - smooth(hipY - height * .02, hipY + height * .045, p.y);
    }
    if (['shoulder', 'arm', 'elbow', 'hand'].includes(part)) {
      const shoulder = positions.get(bones[side + 'shoulder'] ?? bones[side + 'arm']!)!;
      const upper = positions.get(bones[side + 'arm']!)!;
      const shoulderY = Math.max(shoulder.y, upper.y);
      gate *= 1 - smooth(shoulderY + height * .02, shoulderY + height * .15, p.y);
      const jointWidth = Math.abs((part === 'shoulder' ? shoulder : upper).clone().sub(center).dot(leftAxis));
      gate *= smooth(jointWidth * .48, jointWidth * .91, lateral);
    }
    return gate;
  };
  let vertices = 0;
  for (const primitive of meshNode.getMesh()!.listPrimitives()) {
    const ps = primitive.getAttribute('POSITION')!, oldJ = primitive.getAttribute('JOINTS_0')!, oldW = primitive.getAttribute('WEIGHTS_0')!;
    const js = new Uint16Array(ps.getCount() * 4), ws = new Float32Array(ps.getCount() * 4);
    for (let i = 0; i < ps.getCount(); i++) {
      const p = new Vector3().fromArray(ps.getElement(i, []));
      const oldIndices = oldJ.getElement(i, []), oldWeights = oldW.getElement(i, []);
      const preserve = oldIndices.flatMap((j, k) => preservedPrefixes.some(prefix => joints[j]!.getName().startsWith(prefix)) && oldWeights[k]! > .005 ? [{ index: j, weight: oldWeights[k]! }] : []);
      const preserved = Math.min(1, preserve.reduce((sum, item) => sum + item.weight, 0));
      const ranked = capsules.filter(c => eligibility(c.role, p) > 1e-8).map(c => {
        const delta = c.b.clone().sub(c.a), t = Math.max(0, Math.min(1, p.clone().sub(c.a).dot(delta) / Math.max(1e-12, delta.lengthSq())));
        return { ...c, distance: p.distanceToSquared(c.a.clone().addScaledVector(delta, t)) - Math.log(eligibility(c.role, p)) * (height * .024) ** 2 };
      }).sort((a, b) => a.distance - b.distance);
      const first = ranked[0]!;
      // Adjacency stops skin on a forearm blending into a nearby thigh or the other hand.
      const selected = ranked.filter(c => c.node === first.node || c.node === first.parent || c.parent === first.node).slice(0, Math.max(1, 4 - preserve.length));
      const scores = selected.map(c => Math.exp(-(c.distance - first.distance) / (height * .024) ** 2));
      const sum = scores.reduce((a, b) => a + b, 0);
      const out = [...preserve, ...selected.map((c, k) => ({ index: c.index, weight: scores[k]! / sum * (1 - preserved) }))].sort((a, b) => b.weight - a.weight).slice(0, 4);
      const total = out.reduce((a, b) => a + b.weight, 0);
      for (let k = 0; k < out.length; k++) { js[i * 4 + k] = out[k]!.index; ws[i * 4 + k] = out[k]!.weight / total; }
      const name = joints[out[0]!.index]!.getName(); assigned[name] = (assigned[name] ?? 0) + 1; vertices++;
    }
    // Match across UV seams and relax along the connected skin. A nearest-segment
    // region boundary must not turn two neighboring vertices into different rigid pieces.
    const weld = new Map<string, number>(), group = new Int32Array(ps.getCount()), groups: number[][] = [];
    for (let i = 0; i < ps.getCount(); i++) {
      const key = ps.getElement(i, []).map(v => Math.round(v / (height * 1e-6))).join(',');
      let index = weld.get(key); if (index === undefined) { index = groups.length; weld.set(key, index); groups.push([]); }
      group[i] = index; groups[index]!.push(i);
    }
    const neighbors = groups.map(() => new Set<number>()), triangles = primitive.getIndices()!.getArray()!;
    for (let i = 0; i < triangles.length; i += 3) for (let k = 0; k < 3; k++) {
      const a = group[triangles[i + k]!]!, b = group[triangles[i + (k + 1) % 3]!]!;
      if (a !== b) { neighbors[a]!.add(b); neighbors[b]!.add(a); }
    }
    let field = groups.map(vertices => {
      const values = new Float64Array(joints.length);
      for (const v of vertices) for (let k = 0; k < 4; k++) values[js[v * 4 + k]!]! += ws[v * 4 + k]! / vertices.length;
      return values;
    });
    for (let pass = 0; pass < 24; pass++) field = field.map((values, i) => {
      const adjacent = neighbors[i]!; if (!adjacent.size) return values;
      const next = Float64Array.from(values, value => value * .6);
      for (const neighbor of adjacent) for (let k = 0; k < joints.length; k++) next[k]! += field[neighbor]![k]! * .4 / adjacent.size;
      return next;
    });
    for (let i = 0; i < ps.getCount(); i++) {
      const p = new Vector3().fromArray(ps.getElement(i, []));
      const roles = new Map(capsules.map(c => [c.index, c.role]));
      const top = Array.from(field[group[i]!]!, (weight, index) => ({ weight: weight * (roles.has(index) ? eligibility(roles.get(index)!, p) : 1), index })).sort((a, b) => b.weight - a.weight).slice(0, 4);
      const sum = top.reduce((a, b) => a + b.weight, 0);
      top.forEach((item, slot) => { js[i * 4 + slot] = item.index; ws[i * 4 + slot] = item.weight / sum; });
    }
    primitive.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(js).setBuffer(buffer));
    primitive.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(ws).setBuffer(buffer));
  }
  return { vertices, dominantJointVertices: assigned, method: 'Source-fitted outgoing anatomical segments, adjacent-bone initialization, UV-seam welding and connected-surface weight relaxation; four normalized influences' };
}

function humanoidMapping(doc: Document, bones: Record<string, Node>, donor: Document, monster: boolean) {
  const sourceNames: Record<string, string> = monster ? { hips: 'rootx', spine: 'spine_01x', chest: 'spine_02x', upper: 'spine_03x', neck: 'neckx', head: 'headx' } :
    { hips: 'pelvis', spine: 'spine_01', chest: 'spine_02', upper: 'spine_03', neck: 'neck_01', head: 'Head' };
  const mapping: Record<string, string> = {}, directions: Record<string, string> = {}, sourceDirections: Record<string, string> = {};
  for (const side of ['Left', 'Right']) {
    // Some hand-authored Mixamo labels use the opposite side from studio assets.
    const suffix = at(bones[side + 'arm']!).x > at(bones.hips!).x ? 'l' : 'r';
    for (const [role, stem] of Object.entries(monster ? { shoulder: 'shoulder', arm: 'arm_stretch', elbow: 'forearm_stretch', hand: 'hand', hip: 'thigh_stretch', knee: 'leg_stretch', foot: 'foot', toe: 'toes_01' } :
      { shoulder: 'clavicle_', arm: 'upperarm_', elbow: 'lowerarm_', hand: 'hand_', hip: 'thigh_', knee: 'calf_', foot: 'foot_', toe: 'ball_' })) sourceNames[side + role] = stem + suffix;
  }
  for (const [role, node] of Object.entries(bones)) mapping[node.getName()] = sourceNames[role]!;
  for (const [role, child] of [['hips', 'spine'], ['spine', bones.chest ? 'chest' : 'upper'], ['chest', 'upper'], ['upper', 'neck'], ['neck', 'head']]) if (bones[role!] && bones[child!]) {
    directions[bones[role!]!.getName()] = bones[child!]!.getName(); sourceDirections[sourceNames[role!]!] = sourceNames[child!]!;
  }
  for (const side of ['Left', 'Right']) for (const [role, child] of [['shoulder', 'arm'], ['arm', 'elbow'], ['elbow', 'hand'], ['hip', 'knee'], ['knee', 'foot'], ['foot', 'toe']]) if (bones[side + role] && bones[side + child]) {
    directions[bones[side + role]!.getName()] = bones[side + child]!.getName(); sourceDirections[sourceNames[side + role]!] = sourceNames[side + child]!;
  }
  for (const side of ['Left', 'Right']) {
    const hand = bones[side + 'hand']!, elbow = bones[side + 'elbow']!, suffix = sourceNames[side + 'hand']!.slice(-1);
    const realFinger = doc.getRoot().listNodes().find(node => node.getName() === `${side}_MiddleProximal`);
    let palm = realFinger;
    if (!palm) {
      const end = at(hand).add(at(hand).sub(at(elbow)).multiplyScalar(.32));
      palm = doc.createNode(`${hand.getName()}_PalmDirection`).setTranslation(end.applyMatrix4(world(hand).invert()).toArray());
      hand.addChild(palm);
    }
    directions[hand.getName()] = palm.getName();
    sourceDirections[sourceNames[side + 'hand']!] = monster ? `middle1_base${suffix}` : `middle_01_${suffix}`;
    if (!bones[side + 'toe']) {
      const foot = bones[side + 'foot']!;
      const end = at(foot).add(new Vector3(0, 0, at(bones.hips!).distanceTo(at(foot)) * .12));
      const toe = doc.createNode(`${foot.getName()}_ToeDirection`).setTranslation(end.applyMatrix4(world(foot).invert()).toArray());
      foot.addChild(toe);
      directions[foot.getName()] = toe.getName();
      sourceDirections[sourceNames[side + 'foot']!] = monster ? `toes_01${suffix}` : `ball_${suffix}`;
    }
  }
  const sourceByName = new Map(donor.getRoot().listNodes().map(n => [n.getName(), n]));
  for (const source of Object.values(mapping)) if (!sourceByName.has(source)) throw new Error(`Donor missing ${source}`);
  const targetLength = at(bones.Lefthip!).distanceTo(at(bones.Leftknee!)) + at(bones.Leftknee!).distanceTo(at(bones.Leftfoot!));
  const sourceLength = at(sourceByName.get(sourceNames.Lefthip!)!).distanceTo(at(sourceByName.get(sourceNames.Leftknee!)!)) + at(sourceByName.get(sourceNames.Leftknee!)!).distanceTo(at(sourceByName.get(sourceNames.Leftfoot!)!));
  return { mapping, directionChildren: directions, sourceDirectionChildren: sourceDirections, translationScale: targetLength / sourceLength };
}

function measureMotion(doc: Document, feet: Node[], strikers: Node[], hips: Node, hover = false) {
  const pose = storedPose(doc), clips = new Map(doc.getRoot().listAnimations().map(clip => [clip.getName(), clip]));
  const gait = (name: string) => {
    const clip = clips.get(name)!, seconds = duration(clip), samples = 121;
    const paths: Vector3[][] = feet.map(() => []);
    for (let frame = 0; frame < samples; frame++) {
      restorePose(pose); applyClip(clip, seconds * frame / (samples - 1));
      feet.forEach((foot, index) => paths[index]!.push(at(foot)));
    }
    const speeds: number[] = [];
    for (const path of paths) {
      const floor = Math.min(...path.map(p => p.y)), range = Math.max(...path.map(p => p.y)) - floor;
      for (let i = 1; i < samples - 1; i++) if (path[i]!.y <= floor + Math.max(.004, range * .18)) {
        const delta = path[i + 1]!.clone().sub(path[i - 1]!); delta.y = 0;
        const speed = delta.length() / (seconds * 2 / (samples - 1)); if (speed > .005) speeds.push(speed);
      }
    }
    speeds.sort((a, b) => a - b);
    return { seconds, mps: hover || !speeds.length ? undefined : speeds[Math.floor(speeds.length / 2)]! };
  };
  const walk = gait('Walk'), run = gait('Run'), attack = clips.get('Attack')!, seconds = duration(attack);
  restorePose(pose); applyClip(attack, 0); const attackOrigin = at(hips);
  let contact = .5, maximum = -Infinity;
  for (let frame = 3; frame <= 93; frame++) {
    restorePose(pose); applyClip(attack, seconds * frame / 96);
    const forward = Math.max(...strikers.map(node => at(node).z - attackOrigin.z));
    if (forward > maximum) { maximum = forward; contact = frame / 96; }
  }
  restorePose(pose);
  return { walkClipSeconds: walk.seconds, runClipSeconds: run.seconds, attackSeconds: seconds,
    contactNormalized: contact, impliedWalkMps: walk.mps, impliedRunMps: run.mps };
}

export const profile: CreatureRepairProfile = {
  id: 'humanoids-plain', assetIds: ids,
  async repair(doc, { assetId, readAsset }) {
    if (!ids.includes(assetId)) throw new Error(`Unowned asset ${assetId}`);
    if (assetId === 'creature_shale_elemental') return repairShale(doc, readAsset);
    restoreBind(doc);
    const bones = anatomy(doc, assetId), native = ['creature_beetle_golem', 'creature_boss_ordrun', 'creature_gloamfang_reaver'].includes(assetId);
    const spectral = assetId === 'creature_banshee' || assetId === 'creature_pallid_shade';
    const monster = ['creature_ashseal_warden', 'creature_voidstone_colossus', 'creature_boss_ordrun', 'creature_beetle_golem', 'creature_hollow_bough'].includes(assetId);
    const fit = native ? undefined : refitPlain(doc, assetId, bones);
    const weights = native ? undefined : rebuildWeights(doc, bones,
      assetId === 'creature_banshee' ? ['BansheeShroud', 'BansheeMist'] : assetId === 'creature_nightforge_marshal' ? ['mixamorigCape'] : [],
      ['creature_road_bandit', 'creature_starroot_guardian'].includes(assetId));
    const donorId = monster ? 'fantasy_monster_02' : 'animation_library_1', donor = await readAsset(donorId);
    if (monster) restoreBind(donor);
    const mapped = humanoidMapping(doc, bones, donor, monster);
    if (spectral) for (const side of ['Left', 'Right']) for (const role of ['hip', 'knee', 'foot', 'toe']) {
      const name = bones[side + role]!.getName(); delete mapped.mapping[name]; delete mapped.directionChildren[name];
    }
    // Pixelius Death briefly tucks every limb above the floor. Preserve that
    // airborne motion instead of snapping the entire body to its lowest vertex.
    // Starroot's wide crown and arms also change support rapidly during its fall.
    const deathSupportBounds = monster || assetId === 'creature_starroot_guardian' ? deformedBounds(doc) : undefined;
    const deathGroundingMaxSpeedMps = deathSupportBounds ? (deathSupportBounds.max[1]! - deathSupportBounds.min[1]!) * 1.25 : undefined;
    const clips: CreatureMotionProfile['clips'] = monster ? {
      Idle: { source: 'Idle', loop: true }, Walk: { source: 'Walk', loop: true }, Run: { source: 'Run', loop: true }, Attack: { source: 'Attack' }, Hit: { source: 'Hit' }, Death: { source: 'Death', holdLastSeconds: .65, groundingMaxSpeedMps: deathGroundingMaxSpeedMps },
    } : {
      Idle: { source: 'Idle_Loop', loop: true },
      Walk: { source: spectral ? 'Idle_Loop' : 'Walk_Loop', loop: true, ...(spectral ? { duration: 1.4 } : {}) },
      Run: { source: spectral ? 'Idle_Loop' : 'Jog_Fwd_Loop', loop: true, ...(spectral ? { duration: 1 } : {}) },
      Attack: { source: spectral ? 'Spell_Simple_Shoot' : 'Punch_Jab' }, Hit: { source: 'Hit_Chest' }, Death: { source: 'Death01', holdLastSeconds: .7, groundingMaxSpeedMps: deathGroundingMaxSpeedMps },
    };
    const report = retargetCreatureMotion(doc, donor, {
      ...mapped, root: { target: bones.hips!.getName(), source: mapped.mapping[bones.hips!.getName()]!, translationScale: mapped.translationScale, horizontal: 'in-place' },
      sourceToTargetRotation: [0, 0, 0, 1], clips, replaceAnimations: true, samplesPerSecond: 30, grounding: { floor: 0 },
    });
    return {
      changes: [native ? 'Retained native anatomical bind and original skin weights.' : 'Refitted source anatomy and corrected distal-joint skin ownership.', `Replaced every action with ${donorId} studio sequences, using world-space rest alignment and in-place locomotion.`],
      warnings: ['Candidate requires devdocs review of every motion state.'],
      provenance: { donor: donorId, nativeSkinPreserved: native, landmarks: fit?.landmarks, weights, retarget: report, spectralUpperBodyOnly: spectral },
      motion: measureMotion(doc, [bones.Leftfoot!, bones.Rightfoot!], [bones.Lefthand!, bones.Righthand!], bones.hips!, spectral),
    };
  },
};

async function repairShale(doc: Document, readAsset: (id: string) => Promise<Document>) {
  restoreBind(doc);
  const donor = await readAsset('animal_boar');
  const byName = new Map(doc.getRoot().listNodes().map(n => [n.getName(), n]));
  const mapping: Record<string, string> = { Pelvis: 'WildBoar_ROOTSHJnt', Spine: 'WildBoar_Spine_02SHJnt', Chest: 'WildBoar_Spine_TopSHJnt', Neck: 'WildBoar_Neck_01SHJnt', SensingCleft: 'WildBoar_Neck_TopSHJnt' };
  const directions: Record<string, string> = { Pelvis: 'Spine', Spine: 'Chest', Chest: 'Neck', Neck: 'SensingCleft' };
  for (const [side, sourceSide] of [['L', 'r'], ['R', 'l']]) for (const [limb, sourceLimb] of [['Fore', 'Front'], ['Hind', 'Hind']]) {
    const upper = `${limb}legUpper_${side}`, lower = `${limb}legLower_${side}`, paw = `${limb}paw_${side}`;
    mapping[upper] = `WildBoar_${sourceSide}_${sourceLimb}Leg_HipSHJnt`; mapping[lower] = `WildBoar_${sourceSide}_${sourceLimb}Leg_Knee1SHJnt`; mapping[paw] = `WildBoar_${sourceSide}_${sourceLimb}Leg_AnkleSHJnt`;
    directions[upper] = lower; directions[lower] = paw;
  }
  const pseudoBones: Record<string, Node> = { hips: byName.get('Pelvis')!, spine: byName.get('Spine')!, upper: byName.get('Chest')!, neck: byName.get('Neck')!, head: byName.get('SensingCleft')! };
  for (const side of ['L', 'R']) for (const limb of ['Fore', 'Hind']) {
    const alias = side === 'L' ? 'Left' : 'Right', arm = limb === 'Fore';
    pseudoBones[alias + (arm ? 'arm' : 'hip')] = byName.get(`${limb}legUpper_${side}`)!;
    pseudoBones[alias + (arm ? 'elbow' : 'knee')] = byName.get(`${limb}legLower_${side}`)!;
    pseudoBones[alias + (arm ? 'hand' : 'foot')] = byName.get(`${limb}paw_${side}`)!;
  }
  const weights = rebuildWeights(doc, pseudoBones, ['Sense_']);
  const donorNodes = new Map(donor.getRoot().listNodes().map(n => [n.getName(), n]));
  const sourceRoot = donorNodes.get('WildBoar_ROOTSHJnt')!;
  const ratio = at(byName.get('Pelvis')!).y / at(sourceRoot).y;
  // Shalewake's long forelimbs switch support during the boar strike; that switch
  // must not turn the donor's small root dip into a whole-body downward snap.
  const bounds = deformedBounds(doc), attackGroundingMaxSpeedMps = (bounds.max[1]! - bounds.min[1]!) * 1.25;
  const retarget = retargetCreatureMotion(doc, donor, { mapping, directionChildren: directions,
    sourceToTargetRotation: [0, 0, 0, 1], root: { target: 'Pelvis', source: 'WildBoar_ROOTSHJnt', translationScale: ratio, horizontal: 'in-place' },
    clips: { Idle: { source: 'Idle', loop: true }, Walk: { source: 'Walk', loop: true }, Run: { source: 'Run', loop: true }, Attack: { source: 'Attack', groundingMaxSpeedMps: attackGroundingMaxSpeedMps }, Hit: { source: 'Hit' }, Death: { source: 'Death', holdLastSeconds: .7 } },
    replaceAnimations: true, samplesPerSecond: 30, grounding: { floor: 0 },
  });
  const motion = measureMotion(doc, ['Forepaw_L', 'Forepaw_R', 'Hindpaw_L', 'Hindpaw_R'].map(name => byName.get(name)!), [byName.get('SensingCleft')!], byName.get('Pelvis')!);
  // The target sensing cleft is a neck pivot, not the striking muzzle surface.
  // Keep the unretimed donor's measured jaw-tip strike event rather than timing that pivot.
  motion.contactNormalized = .715;
  return { changes: ['Corrected Shalewake parent-segment ownership and retargeted compatible studio quadruped actions.'], warnings: ['Candidate requires devdocs review of every motion state.'],
    provenance: { donor: 'animal_boar', weights, retarget, contact: { method: 'Studio donor JawEnd maximum forward reach over 200 samples; native Attack timing retained', normalized: .715 } }, motion };
}
