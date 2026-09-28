import type { Animation, Document, Node } from '@gltf-transform/core';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { addChannel, applyClip, curve, duration, removeClip, restorePose, storedPose } from '../../creature-motion/pose.js';
import { deformedBounds } from '../../creature-motion/validate-deformation.js';
import type { CreatureRepairProfile } from '../repairProfile.js';
import { retargetCreatureMotion } from '../retarget.js';
import { retargetMixamoColon } from './humanoids-colon.js';

const assetIds = [
  'creature_amethyst_sovereign', 'creature_bloomheart_matriarch', 'creature_hollow_star',
  'creature_veil_reaper', 'fairy_garden_reliquary_faeholme', 'fairy_garden_reliquary_gloamgarden',
  'fairy_garden_snail_gloamgarden', 'fairy_garden_sporekin_faeholme', 'fairy_garden_sporekin_gloamgarden',
  'fairy_garden_veilspirit_faeholme', 'fairy_garden_veilspirit_gloamgarden', 'fairy_monster_21',
] as const;

const q = (x = 0, y = 0, z = 0) => new Quaternion().setFromEuler(new Euler(x, y, z)).toArray();
const world = (node: Node) => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(node.getWorldMatrix()));
const smooth = (a: number, b: number, value: number) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); };
function nodesOf(doc: Document) {
  const nodes = new Map(doc.getRoot().listNodes().map(node => [node.getName(), node]));
  return (name: string) => { const node = nodes.get(name); if (!node) throw new Error(`Missing special anatomy ${name}`); return node; };
}

function scenePose(doc: Document) {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]!;
  const reachable = new Set<Node>();
  const visit = (node: Node) => { reachable.add(node); node.listChildren().forEach(visit); };
  scene.listChildren().forEach(visit);
  return storedPose(doc).filter(pose => reachable.has(pose.node));
}

/** Every authored state samples a complete pose, including the values old sparse clips omitted. */
function replaceClip(doc: Document, name: string, seconds: number, animate: (time: number, phase: number) => void) {
  const rest = scenePose(doc), steps = Math.ceil(seconds * 30);
  const times = Array.from({ length: steps + 1 }, (_, i) => seconds * i / steps);
  const tracks = rest.map(({ node }) => ({ node, t: [] as number[], r: [] as number[], s: [] as number[] }));
  for (let frame = 0; frame <= steps; frame++) {
    restorePose(rest); animate(times[frame]!, frame / steps);
    for (const track of tracks) { track.t.push(...track.node.getTranslation()); track.r.push(...track.node.getRotation()); track.s.push(...track.node.getScale()); }
  }
  restorePose(rest); removeClip(doc, name);
  const clip = doc.createAnimation(name);
  for (const track of tracks) {
    addChannel(doc, clip, track.node, 'translation', times, track.t);
    addChannel(doc, clip, track.node, 'rotation', times, track.r);
    addChannel(doc, clip, track.node, 'scale', times, track.s);
  }
}

/** Resolve skin-floor contact after presentation scaling, rather than in unscaled source units. */
function bakeCompleteStates(doc: Document, floating: boolean, modify?: (clip: Animation, time: number) => void) {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]!;
  const floor = doc.createNode('SpecialMotionFloor');
  for (const child of [...scene.listChildren()]) { scene.removeChild(child); floor.addChild(child); }
  scene.addChild(floor);
  const rest = scenePose(doc), baked = [];
  for (const source of [...doc.getRoot().listAnimations()]) {
    const name = source.getName(), seconds = duration(source), looping = ['Idle', 'Walk', 'Run'].includes(name);
    const steps = Math.ceil(seconds * 60), times = Array.from({ length: steps + 1 }, (_, i) => seconds * i / steps);
    const tracks = rest.map(({ node }) => ({ node, t: [] as number[], r: [] as number[], s: [] as number[] }));
    let maxCorrection = 0, minY = Infinity, maxY = -Infinity;
    for (let frame = 0; frame <= steps; frame++) {
      restorePose(rest); applyClip(source, times[frame]!); modify?.(source, times[frame]!);
      const bounds = deformedBounds(doc);
      // Floating creatures keep their vertical breath. A corpse is always grounded.
      const correction = floating && name !== 'Death' ? Math.max(0, .025 - bounds.min[1]!) : .003 - bounds.min[1]!;
      floor.setTranslation([0, correction, 0]);
      maxCorrection = Math.max(maxCorrection, Math.abs(correction));
      minY = Math.min(minY, bounds.min[1]! + correction); maxY = Math.max(maxY, bounds.max[1]! + correction);
      for (const track of tracks) { track.t.push(...track.node.getTranslation()); track.r.push(...track.node.getRotation()); track.s.push(...track.node.getScale()); }
    }
    if (looping) for (const track of tracks) {
      track.t.splice(-3, 3, ...track.t.slice(0, 3)); track.r.splice(-4, 4, ...track.r.slice(0, 4)); track.s.splice(-3, 3, ...track.s.slice(0, 3));
    }
    baked.push({ name, times, tracks, report: { name, seconds, samples: times.length, maxCorrection, minY, maxY } });
  }
  restorePose(rest);
  for (const source of [...doc.getRoot().listAnimations()]) removeClip(doc, source.getName());
  for (const { name, times, tracks } of baked) {
    const clip = doc.createAnimation(name);
    for (const track of tracks) {
      addChannel(doc, clip, track.node, 'translation', times, track.t);
      addChannel(doc, clip, track.node, 'rotation', times, track.r);
      addChannel(doc, clip, track.node, 'scale', times, track.s);
    }
  }
  return baked.map(item => item.report);
}

function repairReliquary(doc: Document) {
  const node = nodesOf(doc);
  // Original design and fitted joints place head at +X, tail at -X.
  node('DewglassReliquaryRig').setRotation(q(0, -Math.PI / 2, 0));
  for (const [name, seconds, amplitude] of [['Walk', 1.12, .28], ['Run', .72, .43]] as const) {
    replaceClip(doc, name, seconds, (_time, phase) => {
      const beat = phase * Math.PI * 2;
      for (const part of ['Fore', 'Hind']) for (const side of ['Near', 'Far']) {
        const offset = (part === 'Fore' ? 0 : Math.PI) + (side === 'Near' ? 0 : Math.PI);
        const angle = beat + offset, swing = Math.sin(angle), lift = Math.max(0, Math.cos(angle));
        // Source forward is X, so leg swing hinges around lateral Z, never X.
        node(`${part}${side}Upper`).setRotation(q(0, 0, amplitude * swing));
        node(`${part}${side}Lower`).setRotation(q(0, 0, -.09 - amplitude * .7 * lift));
      }
      node('ReservoirBody').setRotation(q(.008 * Math.sin(beat), 0, .014 * Math.sin(beat * 2)));
      node('Neck').setRotation(q(0, 0, -.018 * Math.sin(beat * 2)));
    });
  }
}

function repairTreeSpirit(doc: Document) {
  const node = nodesOf(doc);
  for (const [name, seconds, amplitude] of [['Walk', 1.3, .22], ['Run', .82, .34]] as const) {
    replaceClip(doc, name, seconds, (_time, phase) => {
      const beat = phase * Math.PI * 2, swing = Math.sin(beat);
      // These are two root limbs with flexible tips, not a humanoid knee chain.
      node('LeftRoot').setRotation(q(0, 0, amplitude * swing));
      node('RightRoot').setRotation(q(0, 0, -amplitude * swing));
      node('LeftTip').setRotation(q(0, 0, -.1 * Math.max(0, Math.cos(beat))));
      node('RightTip').setRotation(q(0, 0, -.1 * Math.max(0, -Math.cos(beat))));
      node('Root').setRotation(q(.018 * swing));
      node('Trunk').setRotation(q(0, 0, .015 * Math.sin(beat * 2)));
      node('Bole').setRotation(q(0, .025 * swing));
      node('LeftBranch').setRotation(q(.18, 0, -amplitude * .45 * swing));
      node('RightBranch').setRotation(q(-.18, 0, amplitude * .45 * swing));
      node('Crown').setRotation(q(.02 * Math.sin(beat - .4)));
    });
  }
}

function repairHollowStar(doc: Document) {
  const node = nodesOf(doc);
  node('HollowStarPresentation').setRotation(q(0, -Math.PI / 2, 0));
  replaceClip(doc, 'Death', 1.8, (time) => {
    const fall = curve([0, .18, .45, .78, 1.08, 1.8], [0, .035, .26, .72, 1, 1], time);
    node('HollowCore').setRotation(q(0, 0, -Math.PI / 2 * fall));
    node('HollowStarMotion').setTranslation([0, .08 * (1 - fall), 0]);
    // The ornate ring falls as one connected frame. Opposing 90-degree sector rotations
    // formerly crumpled its membrane into intersecting spokes.
    for (let i = 0; i < 8; i++) node(`MembraneSector${i}`).setRotation(q(.035 * fall * Math.cos(i * Math.PI / 4)));
  });
}

async function repairVeilspirit(doc: Document, donor: Document) {
  const node = nodesOf(doc), source = nodesOf(donor);
  const mapping: Record<string, string> = {
    Pelvis: 'pelvis', Spine: 'spine_01', Chest: 'spine_03', Neck: 'neck_01', Head: 'Head',
  };
  const directionChildren: Record<string, string> = { Pelvis: 'Spine', Spine: 'Chest', Chest: 'Neck', Neck: 'Head' };
  const sourceDirectionChildren: Record<string, string> = {};
  // These source labels follow +Z/-Z before its -90-degree presentation turn.
  // Consequently Left is game -X and matches the studio right-side chain.
  for (const [side, suffix] of [['Left', 'r'], ['Right', 'l']] as const) {
    for (const [target, native] of [['Shoulder', 'upperarm'], ['Elbow', 'lowerarm'], ['Hand', 'hand'], ['Hip', 'thigh'], ['Knee', 'calf'], ['Foot', 'foot']] as const) mapping[side + target] = `${native}_${suffix}`;
    directionChildren[side + 'Shoulder'] = side + 'Elbow'; directionChildren[side + 'Elbow'] = side + 'Hand';
    directionChildren[side + 'Hip'] = side + 'Knee'; directionChildren[side + 'Knee'] = side + 'Foot';
    const hand = node(side + 'Hand'), tipName = side + 'PalmDirection';
    const direction = new Vector3().fromArray(hand.getTranslation()).normalize().multiplyScalar(.08);
    hand.addChild(doc.createNode(tipName).setTranslation(direction.toArray()));
    directionChildren[side + 'Hand'] = tipName;
    sourceDirectionChildren[`hand_${suffix}`] = `middle_01_${suffix}`;
  }
  const length = (a: string, b: string, c: string, lookup: ReturnType<typeof nodesOf>) => world(lookup(a)).distanceTo(world(lookup(b))) + world(lookup(b)).distanceTo(world(lookup(c)));
  return retargetCreatureMotion(doc, donor, {
    mapping, directionChildren, sourceDirectionChildren, sourceToTargetRotation: [0, 0, 0, 1],
    root: { target: 'Pelvis', source: 'pelvis', translationScale: length('LeftHip', 'LeftKnee', 'LeftFoot', node) / length('thigh_l', 'calf_l', 'foot_l', source), horizontal: 'in-place' },
    clips: {
      Idle: { source: 'Idle_Loop', loop: true }, Walk: { source: 'Walk_Loop', loop: true }, Run: { source: 'Jog_Fwd_Loop', loop: true },
      Attack: { source: 'Punch_Jab' }, Hit: { source: 'Hit_Chest' },
      Death: { source: 'Death01', duration: 1.15, holdLastSeconds: .7 },
    }, replaceAnimations: true,
  });
}

function fitVeilspiritDepth(doc: Document) {
  const skin = doc.getRoot().listSkins()[0]!, node = nodesOf(doc);
  const mesh = doc.getRoot().listNodes().find(n => n.getSkin() === skin && n.getMesh())!;
  const meshWorld = new Matrix4().fromArray(mesh.getWorldMatrix()), inverseMesh = meshWorld.clone().invert();
  // Source sections show the body centred at +.17..+.24 X. The long rear cape
  // made a bounding-box-centred X=0 skeleton sit entirely behind the torso.
  const depth: Record<string, number> = { SpiritRoot: .18, Pelvis: .19, Spine: .225, Chest: .21, Neck: .19, Head: .215, Crown: .22 };
  for (const side of ['Left', 'Right']) Object.assign(depth, {
    [side + 'Shoulder']: .20, [side + 'Elbow']: .18, [side + 'Hand']: .155,
    [side + 'Hip']: .18, [side + 'Knee']: .15, [side + 'Foot']: .17,
    [side + 'Mantle']: .025, [side + 'MantleTip']: -.16,
  });
  const poses = Object.entries(depth).map(([name, x]) => {
    const target = node(name), p = world(target).applyMatrix4(inverseMesh); p.x = x;
    return { target, desired: meshWorld.clone().multiply(new Matrix4().makeTranslation(p.x, p.y, p.z)) };
  });
  const level = (n: Node): number => n.getParentNode() ? level(n.getParentNode()!) + 1 : 0;
  poses.sort((a, b) => level(a.target) - level(b.target));
  for (const { target, desired } of poses) {
    const parent = target.getParentNode();
    target.setMatrix((parent ? new Matrix4().fromArray(parent.getWorldMatrix()).invert().multiply(desired) : desired).toArray());
  }
  skin.listJoints().forEach((joint, i) => skin.getInverseBindMatrices()!.setElement(i,
    new Matrix4().fromArray(joint.getWorldMatrix()).invert().multiply(meshWorld).toArray()));
  return { sourceDepthPivots: depth, method: 'Measured source body cross-sections, preserve rest surface using recomputed matching inverse binds' };
}

function fitVeilspiritSegmentWeights(doc: Document) {
  const skin = doc.getRoot().listSkins()[0]!, joints = skin.listJoints(), lookup = nodesOf(doc);
  const capsules: { name: string; index: number; a: Vector3; b: Vector3; kind: string }[] = [];
  const add = (name: string, child: string | Vector3, kind: string) => capsules.push({ name, index: joints.indexOf(lookup(name)), a: world(lookup(name)), b: typeof child === 'string' ? world(lookup(child)) : child, kind });
  for (const [name, child] of [['Pelvis', 'Spine'], ['Spine', 'Chest'], ['Chest', 'Neck'], ['Neck', 'Head'], ['Head', 'Crown']] as const) add(name, child, 'body');
  add('Crown', world(lookup('Crown')).add(new Vector3(0, .10, 0)), 'body');
  for (const side of ['Left', 'Right']) {
    add(side + 'Shoulder', side + 'Elbow', side + 'arm'); add(side + 'Elbow', side + 'Hand', side + 'arm');
    add(side + 'Hand', world(lookup(side + 'Hand')).add(world(lookup(side + 'Hand')).sub(world(lookup(side + 'Elbow'))).normalize().multiplyScalar(.1)), side + 'arm');
    add(side + 'Hip', side + 'Knee', side + 'leg'); add(side + 'Knee', side + 'Foot', side + 'leg');
    add(side + 'Foot', world(lookup(side + 'Foot')).add(new Vector3(0, 0, .08)), side + 'leg');
    add(side + 'Mantle', side + 'MantleTip', side + 'mantle');
    add(side + 'MantleTip', world(lookup(side + 'MantleTip')).add(new Vector3(0, -.1, -.04)), side + 'mantle');
  }
  const bounds = deformedBounds(doc), sigma = (bounds.max[1]! - bounds.min[1]!) * .04;
  for (const mesh of doc.getRoot().listNodes().filter(n => n.getSkin() === skin && n.getMesh())) for (const primitive of mesh.getMesh()!.listPrimitives()) {
    const positions = primitive.getAttribute('POSITION')!, matrix = new Matrix4().fromArray(mesh.getWorldMatrix());
    const indices = new Uint16Array(positions.getCount() * 4), weights = new Float32Array(indices.length);
    for (let i = 0; i < positions.getCount(); i++) {
      const p = positions.getElement(i, []), position = new Vector3().fromArray(p).applyMatrix4(matrix), side = p[2]! >= 0 ? 'Left' : 'Right';
      const candidates = capsules.map(c => {
        const segment = c.b.clone().sub(c.a), t = Math.max(0, Math.min(1, position.clone().sub(c.a).dot(segment) / segment.lengthSq()));
        return { ...c, distance: position.distanceTo(c.a.clone().addScaledVector(segment, t)) };
      }).sort((a, b) => a.distance - b.distance);
      const body = candidates.filter(c => c.kind === 'body');
      const arm = candidates.filter(c => c.kind === side + 'arm');
      let allowed = body;
      if (p[1]! < .44 && p[0]! > .07 && Math.abs(p[2]!) > .035) allowed = candidates.filter(c => c.kind === side + 'leg' || c.name === 'Pelvis');
      else if (p[1]! < .65 && p[0]! < .08) {
        // The center train is cloth too. Its hem must reach the distal mantle
        // joint, rather than staying mostly attached to pelvis or upper panel.
        const left = smooth(-.07, .07, p[2]!), chest = smooth(.57, .67, p[1]!);
        const mass: [number, number][] = [[joints.indexOf(lookup('Chest')), chest]];
        for (const [label, lateral] of [['Left', left], ['Right', 1 - left]] as const) {
          const a = world(lookup(label + 'Mantle')), b = world(lookup(label + 'MantleTip')), axis = b.clone().sub(a);
          const t = position.clone().sub(a).dot(axis) / axis.lengthSq(), tip = smooth(.20, .85, t);
          mass.push([joints.indexOf(lookup(label + 'Mantle')), lateral * (1 - chest) * (1 - tip)]);
          mass.push([joints.indexOf(lookup(label + 'MantleTip')), lateral * (1 - chest) * tip]);
        }
        const selected = mass.sort((a, b) => b[1] - a[1]).slice(0, 4), total = selected.reduce((sum, [, weight]) => sum + weight, 0);
        selected.forEach(([joint, weight], slot) => { indices[i * 4 + slot] = joint; weights[i * 4 + slot] = weight / total; });
        continue;
      }
      else if (p[1]! > .48 && p[1]! < .82 && p[0]! > .06 && Math.abs(p[2]!) > .14 && arm[0]!.distance < body[0]!.distance) allowed = candidates.filter(c => c.kind === side + 'arm' || c.name === 'Chest');
      const owner = allowed[0]!, ownerNode = joints[owner.index]!;
      const selected = allowed.filter(c => c === owner || joints[c.index] === ownerNode.getParentNode() || joints[c.index]!.getParentNode() === ownerNode).slice(0, 4);
      const raw = selected.map(c => Math.exp(-(c.distance ** 2 - selected[0]!.distance ** 2) / (sigma ** 2))), total = raw.reduce((sum, v) => sum + v, 0);
      selected.forEach((c, slot) => { indices[i * 4 + slot] = c.index; weights[i * 4 + slot] = raw[slot]! / total; });
    }
    const buffer = doc.getRoot().listBuffers()[0]!;
    primitive.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(indices).setBuffer(buffer));
    primitive.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer));
  }
  return { method: 'Fitted anatomical bone capsules with adjacent-joint-only blending; cloak, head, arm and leg regions cannot select unrelated joints' };
}

/** Blend weights over welded mesh edges, so connected cloth cannot tear at region borders. */
function smoothSkinSeams(doc: Document, iterations = 10) {
  for (const mesh of doc.getRoot().listNodes().filter(n => n.getSkin() && n.getMesh())) for (const primitive of mesh.getMesh()!.listPrimitives()) {
    const positions = primitive.getAttribute('POSITION')!, indices = primitive.getAttribute('JOINTS_0')!, weights = primitive.getAttribute('WEIGHTS_0')!;
    const boneCount = mesh.getSkin()!.listJoints().length, weld = new Map<string, number>(), vertexGroup: number[] = [], groups: number[][] = [];
    for (let i = 0; i < positions.getCount(); i++) {
      const key = positions.getElement(i, []).map(v => Math.round(v * 1e5)).join(','), existing = weld.get(key);
      const group = existing ?? groups.length;
      if (existing === undefined) { weld.set(key, group); groups.push([]); }
      vertexGroup.push(group); groups[group]!.push(i);
    }
    const neighbours = groups.map(() => new Set<number>()), triangles = primitive.getIndices()!.getArray()!;
    for (let i = 0; i < triangles.length; i += 3) for (let edge = 0; edge < 3; edge++) {
      const a = vertexGroup[triangles[i + edge]!]!, b = vertexGroup[triangles[i + (edge + 1) % 3]!]!;
      if (a !== b) { neighbours[a]!.add(b); neighbours[b]!.add(a); }
    }
    let field = groups.map(vertices => {
      const mass = new Float64Array(boneCount);
      for (const v of vertices) { const js = indices.getElement(v, []), ws = weights.getElement(v, []); js.forEach((j, k) => { mass[j]! += ws[k]! / vertices.length; }); }
      return mass;
    });
    for (let pass = 0; pass < iterations; pass++) field = field.map((mass, i) => {
      if (!neighbours[i]!.size) return mass;
      const next = Float64Array.from(mass, v => v * .35);
      for (const other of neighbours[i]!) field[other]!.forEach((value, joint) => { next[joint]! += value * .65 / neighbours[i]!.size; });
      return next;
    });
    groups.forEach((vertices, i) => {
      const chosen = Array.from(field[i]!, (weight, joint) => ({ joint, weight })).sort((a, b) => b.weight - a.weight).slice(0, 4);
      const sum = chosen.reduce((total, item) => total + item.weight, 0);
      for (const v of vertices) { indices.setElement(v, chosen.map(item => item.joint)); weights.setElement(v, chosen.map(item => item.weight / sum)); }
    });
  }
}

function fitMooncapAnatomy(doc: Document) {
  const skin = doc.getRoot().listSkins()[0]!, bones = skin.listJoints(), node = nodesOf(doc);
  const mesh = doc.getRoot().listNodes().find(n => n.getSkin() === skin && n.getMesh())!;
  const meshWorld = new Matrix4().fromArray(mesh.getWorldMatrix());
  // Devdocs front/side orbit and horizontal mesh contours establish Z-lateral
  // anatomy. The old X-lateral skeleton put every arm/leg chain in empty space.
  // Points below are source-mesh coordinates, including its ground offset.
  const pivots: Record<string, [number, number, number]> = {
    Hips: [-.075, .31, .045], Spine: [-.095, .43, .065], Spine1: [-.095, .53, .08],
    Spine2: [-.065, .64, .065], Neck: [-.066, .71, .053], Head: [-.065, .79, .065], Cap: [-.065, .87, .05],
    LeftShoulder: [-.01, .66, .13], LeftArm: [.03, .62, .20], LeftForeArm: [.11, .47, .32],
    LeftHand: [.17, .34, .33], LeftHandMiddle1: [.21, .23, .31],
    RightShoulder: [-.14, .66, -.02], RightArm: [-.17, .62, -.10], RightForeArm: [-.20, .54, -.25],
    RightHand: [-.12, .45, -.34], RightHandMiddle1: [-.075, .34, -.33],
    LeftUpLeg: [-.025, .285, .13], LeftLeg: [.03, .16, .218], LeftFoot: [.048, .065, .24], LeftToeBase: [.14, .022, .25],
    RightUpLeg: [-.13, .29, -.05], RightLeg: [-.15, .16, -.10], RightFoot: [-.175, .065, -.135], RightToeBase: [-.095, .022, -.16],
  };
  // Refit parent-first and rebuild the matching inverse binds. Surface positions
  // are unchanged in the bind pose; no vertices, normals or UVs are rewritten.
  for (const [name, p] of Object.entries(pivots)) {
    const joint = node('mixamorig:' + name), parent = joint.getParentNode()!;
    joint.setMatrix(new Matrix4().fromArray(parent.getWorldMatrix()).invert().multiply(meshWorld).multiply(new Matrix4().makeTranslation(...p)).toArray());
  }
  bones.forEach((joint, i) => skin.getInverseBindMatrices()!.setElement(i,
    new Matrix4().fromArray(joint.getWorldMatrix()).invert().multiply(meshWorld).toArray()));
  const chains = [
    ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'Cap'],
    ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftHandMiddle1'],
    ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'RightHandMiddle1'],
    ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase'], ['RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'],
  ];
  const segments = chains.flatMap(chain => chain.map((name, i) => {
    const a = new Vector3().fromArray(pivots[name]!);
    const b = i < chain.length - 1 ? new Vector3().fromArray(pivots[chain[i + 1]!]!) : a.clone().add(a.clone().sub(new Vector3().fromArray(pivots[chain[i - 1]!]!)).multiplyScalar(.35));
    return { name, index: bones.indexOf(node('mixamorig:' + name)), a, b };
  }));
  const cap = bones.indexOf(node('mixamorig:Cap'));
  for (const primitive of mesh.getMesh()!.listPrimitives()) {
    const positions = primitive.getAttribute('POSITION')!, indices = primitive.getAttribute('JOINTS_0')!, weights = primitive.getAttribute('WEIGHTS_0')!;
    for (let vertex = 0; vertex < positions.getCount(); vertex++) {
      const p = new Vector3().fromArray(positions.getElement(vertex, []));
      const candidates = segments.map(segment => {
        const axis = segment.b.clone().sub(segment.a), t = Math.max(0, Math.min(1, p.clone().sub(segment.a).dot(axis) / axis.lengthSq()));
        return { ...segment, distance: p.distanceTo(segment.a.clone().addScaledVector(axis, t)) };
      }).sort((a, b) => a.distance - b.distance);
      const owner = bones[candidates[0]!.index]!;
      const selected = candidates.filter(c => bones[c.index] === owner || bones[c.index] === owner.getParentNode() || bones[c.index]!.getParentNode() === owner).slice(0, 4);
      const raw = selected.map(c => Math.exp(-(c.distance ** 2 - selected[0]!.distance ** 2) / (.055 ** 2))), total = raw.reduce((sum, value) => sum + value, 0);
      const capAmount = smooth(.72, .80, p.y), mass = new Map<number, number>([[cap, capAmount]]);
      selected.forEach((c, i) => mass.set(c.index, (mass.get(c.index) ?? 0) + raw[i]! / total * (1 - capAmount)));
      const chosen = [...mass].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = chosen.reduce((total, [, weight]) => total + weight, 0);
      while (chosen.length < 4) chosen.push([cap, 0]);
      indices.setElement(vertex, chosen.map(([joint]) => joint)); weights.setElement(vertex, chosen.map(([, weight]) => weight / sum));
    }
  }
  node('MooncapPresentation').setRotation(q(0, -Math.PI / 2, 0));
  smoothSkinSeams(doc, 12);
  return { pivots, forward: '+X source to +Z game', method: 'Devdocs orbit plus triangle-contour limb centers, adjacent bone capsules, welded seam diffusion' };
}

function repairSnail(doc: Document) {
  const node = nodesOf(doc), base = new Map(storedPose(doc).map(p => [p.node.getName(), p.t]));
  for (const [name, seconds, amplitude] of [['Walk', 1.45, .024], ['Run', .92, .04]] as const) {
    replaceClip(doc, name, seconds, (_time, phase) => {
      // A traveling muscular sole wave, offset along the body. Synchronous rocking
      // made the entire foot hinge through the floor instead of crawling.
      for (const [i, part] of ['FootRear', 'FootMiddle', 'FootFront'].entries()) {
        const beat = phase * Math.PI * 2 - i * 1.65, p = base.get(part)!;
        node(part).setRotation(q(amplitude * .45 * Math.sin(beat)));
        node(part).setTranslation([p[0], p[1] + amplitude * .14 * (1 + Math.sin(beat)), p[2] + amplitude * .22 * Math.cos(beat)]);
      }
      node('Neck').setRotation(q(-amplitude * .2 * Math.sin(phase * Math.PI * 2 - 2)));
      node('Head').setRotation(q(amplitude * .15 * Math.sin(phase * Math.PI * 2 - 2.3)));
      node('EyeStalk_L').setRotation(q(.016 * Math.sin(phase * Math.PI * 2), 0, .025));
      node('EyeStalk_R').setRotation(q(.016 * Math.sin(phase * Math.PI * 2 + .8), 0, -.025));
    });
  }
}

function repairThicketDeath(doc: Document) {
  const node = nodesOf(doc);
  replaceClip(doc, 'Death', 1.5, time => {
    const fold = smooth(.10, .65, time);
    // Continue beyond the unsupported rim balance and land on the curved dome.
    // The knees buckle while the upper limbs stay near their canopy sockets.
    // Large hip folds pull the attached moss fringe into stretched sheets.
    const roll = curve([0, .12, .3, .5, .72, .9, 1.5], [0, -.14, -.62, -1.28, -2.30, -2.45, -2.45], time);
    node('Root').setRotation(q(0, 0, roll));
    node('Spine').setRotation(q(.12 * fold));
    node('Neck').setRotation(q(.28 * fold));
    node('Face').setRotation(q(.15 * fold));
    for (const side of ['L', 'R']) for (const [part, direction] of [['Front', 1], ['Hind', -1]] as const) {
      node(`${part}Upper_${side}`).setRotation(q(direction * .30 * fold));
      node(`${part}Lower_${side}`).setRotation(q(-direction * .70 * fold));
      node(`${part}Foot_${side}`).setRotation(q(direction * .20 * fold));
    }
  });
}

function measureFootGaits(doc: Document, feet: Node[], donor: Document, swapped: boolean) {
  const rest = storedPose(doc), donorRest = storedPose(donor), source = nodesOf(donor);
  const sourceFeet = (swapped ? ['foot_r', 'foot_l'] : ['foot_l', 'foot_r']).map(source);
  const measure = (name: string, native: string) => {
    const clip = doc.getRoot().listAnimations().find(c => c.getName() === name)!, seconds = duration(clip), intervals = 240;
    const sourceClip = donor.getRoot().listAnimations().find(c => c.getName() === native)!;
    const samples = Array.from({ length: intervals + 1 }, (_, i) => {
      restorePose(rest); applyClip(clip, seconds * i / intervals);
      restorePose(donorRest); applyClip(sourceClip, duration(sourceClip) * i / intervals);
      return { target: feet.map(world), source: sourceFeet.map(world) };
    });
    const speeds: number[] = [], sides: { targetBone: string; sourceBone: string; metresPerSecond: number; stanceSamples: number }[] = [];
    for (let side = 0; side < feet.length; side++) {
      const sideSpeeds: number[] = [];
      // The native take establishes contact phase. A low ankle on the target is
      // not sufficient: large caps and asymmetric skins can change floor lift.
      const low = Math.min(...samples.map(row => row.source[side]!.y)), high = Math.max(...samples.map(row => row.source[side]!.y));
      const window = (high - low) * .12;
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1]!.target[side]!, b = samples[i]!.target[side]!, velocity = (a.z - b.z) * intervals / seconds;
        if (samples[i - 1]!.source[side]!.y < low + window && samples[i]!.source[side]!.y < low + window && velocity > 0) { speeds.push(velocity); sideSpeeds.push(velocity); }
      }
      sideSpeeds.sort((a, b) => a - b);
      if (!sideSpeeds.length) throw new Error(`${name} ${feet[side]!.getName()} has no measurable donor-phase stance`);
      sides.push({ targetBone: feet[side]!.getName(), sourceBone: sourceFeet[side]!.getName(), metresPerSecond: sideSpeeds[Math.floor(sideSpeeds.length / 2)]!, stanceSamples: sideSpeeds.length });
    }
    speeds.sort((a, b) => a - b);
    if (!speeds.length) throw new Error(`${name} has no measurable backward stance`);
    return { metresPerSecond: speeds[Math.floor(speeds.length / 2)]!, stanceSamples: speeds.length, sides };
  };
  const walk = measure('Walk', 'Walk_Loop'), run = measure('Run', 'Jog_Fwd_Loop'); restorePose(rest); restorePose(donorRest);
  return { walk, run, method: 'Target backward-foot speed during native studio donor contact phases' };
}

export const profile: CreatureRepairProfile = {
  id: 'specials', assetIds,
  async repair(doc, { assetId, readAsset }) {
    if (doc.getRoot().listNodes().some(node => node.getName() === 'SpecialMotionFloor')) {
      throw new Error(`${assetId} is already repaired; rebuild from its recorded original source, not the promoted candidate`);
    }
    const changes: string[] = [], provenance: Record<string, unknown> = {};
    removeClip(doc, 'HitLeft'); removeClip(doc, 'HitRight');
    let floating = false;
    if (assetId.includes('reliquary')) {
      repairReliquary(doc);
      changes.push('Turned the source +X face and attack into game +Z.', 'Replaced aliased zero-motion leg samples with alternating four-leg cycles in the correct sagittal plane.');
    } else if (assetId === 'creature_bloomheart_matriarch' || assetId === 'creature_amethyst_sovereign') {
      repairTreeSpirit(doc); changes.push('Changed root-limb stepping from sideways splay to forward/back travel; preserved the tree anatomy, attached crystals and branch response.');
    } else if (assetId === 'creature_hollow_star') {
      repairHollowStar(doc); floating = true;
      changes.push('Turned the radial face and attack toward game +Z.', 'Replaced intersecting radial death folds with a held fall of the connected frame.');
    } else if (assetId.includes('veilspirit')) {
      provenance.fittedPivots = fitVeilspiritDepth(doc);
      provenance.weights = fitVeilspiritSegmentWeights(doc);
      smoothSkinSeams(doc);
      provenance.retarget = await repairVeilspirit(doc, await readAsset('animation_library_1'));
      changes.push('Replaced face-to-hand and crown-to-elbow weights with smooth anatomical chains.', 'Replaced outstretched bind-pose idles and sparse hand-authored humanoid clips with studio idle, gait, attack, hit and death takes mapped to the botanical skeleton.');
    } else if (assetId === 'fairy_garden_snail_gloamgarden') {
      smoothSkinSeams(doc, 12);
      repairSnail(doc); changes.push('Replaced whole-foot rocking with a phased traveling sole wave; retained the rigid shell and independent eye stalks.');
    } else if (assetId === 'creature_veil_reaper') {
      floating = true; changes.push('Preserved spectral floating and claw takes while resetting every pose channel and retaining full corpse volume.');
    } else if (assetId === 'fairy_monster_21') {
      repairThicketDeath(doc);
      changes.push('Removed nonuniform death shrinking; the thicket settles beyond its canopy rim onto the curved dome with all four limbs folded close.');
    } else if (assetId.includes('sporekin')) {
      const donor = await readAsset('animation_library_1');
      if (assetId === 'fairy_garden_sporekin_gloamgarden') {
        // This authored rig uses Left for negative world X. The library uses positive
        // X, so pair the physical sides rather than trusting those opposite labels.
        for (const joint of donor.getRoot().listNodes()) {
          const name = joint.getName();
          if (name.endsWith('_l')) joint.setName(name.slice(0, -2) + '_r');
          else if (name.endsWith('_r')) joint.setName(name.slice(0, -2) + '_l');
        }
        provenance.fittedAnatomy = fitMooncapAnatomy(doc);
        changes.push('Removed sharp cross-foot and cross-arm weight seams on the connected fungal body; paired donor sides by world anatomy.');
      }
      provenance.retarget = retargetMixamoColon(doc, donor);
      changes.push('Rebuilt complete fungal poses and corrected the scaled mesh floor in every state; removed death-only body shrinking.');
    }
    removeClip(doc, 'HitLeft'); removeClip(doc, 'HitRight');
    const node = nodesOf(doc);
    const rigidPresentation = assetId.includes('reliquary') ? node('DewglassReliquaryRig') : assetId === 'fairy_garden_snail_gloamgarden' ? node('SnailPresentation') : undefined;
    const rigidPresentationScale = rigidPresentation?.getScale();
    if (rigidPresentation) changes.push('Removed death-only whole-model Y compression so the rigid shell retains its authored proportions.');
    const samples = bakeCompleteStates(doc, floating, (clip, time) => {
      if (clip.getName() === 'Death') {
        if (rigidPresentation && rigidPresentationScale) rigidPresentation.setScale(rigidPresentationScale);
        if (assetId === 'fairy_garden_snail_gloamgarden') {
          const slump = smooth(.1, .7, time), head = node('Head'), t = head.getTranslation();
          head.setTranslation([t[0], t[1] - .05 * slump, t[2] - .022 * slump]);
          head.setRotation(q(.25 * slump));
          // Original stalk rotation almost exactly cancelled the parent neck and
          // foot rotations, leaving both eyes upright in the supposedly dead pose.
          node('EyeStalk_L').setRotation(q(1.68 * slump, 0, .12 * slump));
          node('EyeStalk_R').setRotation(q(1.56 * slump, 0, -.15 * slump));
          node('Eye_L').setRotation(q(-.3 * slump));
          node('Eye_R').setRotation(q(-.2 * slump));
          node('Feelers_L').setRotation(q(.65 * slump, 0, .3 * slump));
          node('Feelers_R').setRotation(q(.65 * slump, 0, -.3 * slump));
        }
        if (assetId === 'creature_veil_reaper') node('SpiritRoot').setScale([1, 1, 1]);
        if (assetId === 'fairy_monster_21') node('Root').setScale([1, 1, 1]);
        if (assetId === 'fairy_garden_sporekin_gloamgarden') node('mixamorig:Armature').setScale([1, 1, 1]);
        if (assetId.includes('veilspirit')) {
          // The wide trailing mantle must fold with a supine fall. Leaving its
          // bind shape rigidly behind the torso makes it a vertical support.
          // Fold about the chest attachment, including the upper panel's pivot.
          const foldDegrees = curve([0, .12, .28, .46, .65, .85, 1.85], [0, 0, 45, 110, 75, 65, 65], time);
          const fold = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), foldDegrees * Math.PI / 180);
          for (const side of ['Left', 'Right']) {
            const mantle = node(side + 'Mantle');
            mantle.setTranslation(new Vector3().fromArray(mantle.getTranslation()).applyQuaternion(fold).toArray());
            mantle.setRotation(fold.clone().multiply(new Quaternion().fromArray(mantle.getRotation())).toArray());
            const hemCurl = curve([0, .12, .28, .46, .65, .85, 1.85], [0, 0, .65, 1.35, .45, 0, 0], time);
            node(side + 'MantleTip').setRotation(q(0, 0, hemCurl));
          }
        }
      }
      if ((assetId === 'creature_bloomheart_matriarch' || assetId === 'creature_amethyst_sovereign') && clip.getName() === 'Idle') {
        node('LeftBranch').setRotation(q(.18 + .012 * Math.sin(time * Math.PI * 2 / duration(clip))));
        node('RightBranch').setRotation(q(-.18 - .012 * Math.sin(time * Math.PI * 2 / duration(clip))));
      }
    });
    changes.push('Baked complete TRS states and ground contact after final model scaling; source mesh topology, UVs and all texture bytes remain unchanged.');
    provenance.samples = samples;
    const clips = doc.getRoot().listAnimations(), seconds = (name: string) => duration(clips.find(clip => clip.getName() === name)!);
    let contactNormalized: number | undefined, impliedWalkMps: number | undefined, impliedRunMps: number | undefined;
    if (assetId.includes('veilspirit') || assetId.includes('sporekin')) {
      const attack = clips.find(clip => clip.getName() === 'Attack')!, rest = storedPose(doc);
      const prefix = assetId.includes('sporekin') ? 'mixamorig:' : '';
      const gait = measureFootGaits(doc, [node(prefix + 'LeftFoot'), node(prefix + 'RightFoot')], await readAsset('animation_library_1'), assetId !== 'fairy_garden_sporekin_faeholme');
      provenance.gait = gait; impliedWalkMps = gait.walk.metresPerSecond; impliedRunMps = gait.run.metresPerSecond;
      const strikingHand = assetId === 'fairy_garden_sporekin_faeholme' ? 'LeftHand' : 'RightHand';
      const hand = node(prefix + strikingHand), pelvis = node(prefix + (prefix ? 'Hips' : 'Pelvis'));
      let reach = -Infinity;
      for (let i = 0; i <= 120; i++) {
        restorePose(rest); applyClip(attack, i * duration(attack) / 120);
        const forward = world(hand).z - world(pelvis).z;
        if (forward > reach) { reach = forward; contactNormalized = i / 120; }
      }
      restorePose(rest);
      provenance.attackContact = { contactNormalized, strikingHand, method: 'Peak +Z striking-hand reach relative to pelvis over 121 studio-jab samples' };
    }
    return { changes, provenance, motion: { walkClipSeconds: seconds('Walk'), runClipSeconds: seconds('Run'), attackSeconds: seconds('Attack'), ...(contactNormalized !== undefined ? { contactNormalized } : {}), ...(impliedWalkMps !== undefined ? { impliedWalkMps, impliedRunMps } : {}), groundY: 0 } };
  },
};
