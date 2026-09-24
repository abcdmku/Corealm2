import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { deformedBounds } from '../../../../../../tools/creature-motion/validate-deformation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const entries = [
  { id: 'creature_wild_goblin', sourceDir: 'wild-goblin-round1' },
  { id: 'creature_troll_mauler', sourceDir: 'troll-mauler-round2' },
  { id: 'creature_cave_roach', sourceDir: 'cave-roach-round1' },
];

function duration(clip) {
  return Math.max(...clip.listChannels().map(ch => {
    const arr = ch.getSampler().getInput().getArray(); return arr[arr.length - 1];
  }));
}

function sampleClip(doc, clip, fractions) {
  const root = doc.getRoot();
  const rest = new Map(root.listNodes().map(n => [n, { t: n.getTranslation(), r: n.getRotation(), s: n.getScale() }]));
  const restore = () => { for (const [n, p] of rest) n.setTranslation(p.t).setRotation(p.r).setScale(p.s); };
  const frames = [];
  const seconds = duration(clip);
  for (const fraction of fractions) {
    restore(); const time = seconds * fraction;
    for (const ch of clip.listChannels()) {
      const node = ch.getTargetNode(), sampler = ch.getSampler(), times = sampler.getInput().getArray(), values = sampler.getOutput().getArray();
      const kind = ch.getTargetPath(), width = kind === 'rotation' ? 4 : 3;
      let i = 0; while (i < times.length - 2 && times[i + 1] < time) i++;
      const u = sampler.getInterpolation() === 'STEP' ? 0 : times[i + 1] > times[i] ? Math.min(1, Math.max(0, (time - times[i]) / (times[i + 1] - times[i]))) : 0;
      if (kind === 'rotation') {
        const a = new Quaternion(...values.slice(i * width, i * width + width));
        const b = new Quaternion(...values.slice((i + 1) * width, (i + 1) * width + width));
        node.setRotation(a.slerp(b, u).toArray());
      } else if (kind === 'translation' || kind === 'scale') {
        const value = Array.from({ length: width }, (_, k) => values[i * width + k] * (1 - u) + values[(i + 1) * width + k] * u);
        if (kind === 'translation') node.setTranslation(value); else node.setScale(value);
      }
    }
    const bounds = deformedBounds(doc);
    const size = bounds.max.map((v, i) => v - bounds.min[i]);
    if (![...bounds.min, ...bounds.max, ...size].every(Number.isFinite)) throw new Error(`${clip.getName()} nonfinite frame ${fraction}`);
    frames.push({ fraction, seconds: time, bounds, height: size[1] });
  }
  restore();
  return { clip: clip.getName(), duration: seconds, frames };
}

// Evaluates every Death channel at one time, including channels added below.
function poseDeath(doc, death, time, rest) {
  for (const [n, p] of rest) n.setTranslation(p.t).setRotation(p.r).setScale(p.s);
  for (const ch of death.listChannels()) {
    const sampler = ch.getSampler(), times = sampler.getInput().getArray(), values = sampler.getOutput().getArray();
    const kind = ch.getTargetPath(), width = kind === 'rotation' ? 4 : 3;
    let i = 0; while (i < times.length - 2 && times[i + 1] < time) i++;
    const u = times[i + 1] > times[i] ? Math.min(1, Math.max(0, (time - times[i]) / (times[i + 1] - times[i]))) : 0;
    const a = Array.from(values.slice(i * width, i * width + width)), b = Array.from(values.slice((i + 1) * width, (i + 2) * width));
    const node = ch.getTargetNode();
    if (kind === 'rotation') node.setRotation(new Quaternion(...a).slerp(new Quaternion(...b), u).toArray());
    else { const v = a.map((x, k) => x + (b[k] - x) * u); if (kind === 'translation') node.setTranslation(v); else node.setScale(v); }
  }
}

// Skinned vertices with their dominant joint, evaluated like deformedBounds.
function skinnedPoints(doc) {
  const points = [], bind = [], ids = [], ws = [], xyz = [];
  for (const node of doc.getRoot().listNodes()) {
    const skin = node.getSkin(); if (!skin) continue;
    const joints = skin.listJoints();
    const mats = joints.map((j, i) => new Matrix4().fromArray(j.getWorldMatrix()).multiply(new Matrix4().fromArray(skin.getInverseBindMatrices().getElement(i, bind))));
    for (const prim of node.getMesh().listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), ji = prim.getAttribute('JOINTS_0'), jw = prim.getAttribute('WEIGHTS_0');
      for (let v = 0; v < pos.getCount(); v++) {
        const src = new Vector3().fromArray(pos.getElement(v, xyz)); ji.getElement(v, ids); jw.getElement(v, ws);
        const p = new Vector3(); let best = 0;
        for (let k = 0; k < 4; k++) if (ws[k]) { p.addScaledVector(src.clone().applyMatrix4(mats[ids[k]]), ws[k]); if (ws[k] > ws[best]) best = k; }
        points.push({ joint: joints[ids[best]].getName(), p });
      }
    }
  }
  return points;
}

// Body regions by dominant joint; each must rest on the floor in the corpse.
const trollRegions = {
  pelvis: /^(Bone004|Bone)$/, upperBack: /^(Bone001|Bone002|shoulder[LR])$/, head: /^Bone003$/,
  armL: /^(forearm|hand)L$/, armR: /^(forearm|hand)R$/,
  legL: /^(thigh|shin|foot|foot_tip|sole|foot_IK)L$/, legR: /^(thigh|shin|foot|foot_tip|sole|foot_IK)R$/,
};

// Bisection on a monotone scalar; returns the parameter whose region floor gap is zero.
function solveFloor(lo, hi, gap) {
  let glo = gap(lo);
  const ghi = gap(hi);
  if (Math.sign(glo) === Math.sign(ghi)) return Math.abs(glo) < Math.abs(ghi) ? lo : hi;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2, g = gap(mid);
    if (Math.sign(g) === Math.sign(glo)) { lo = mid; glo = g; } else hi = mid;
  }
  return (lo + hi) / 2;
}

// The source Death only sags to 82% of standing height. This replaces its
// ending with a coordinated backward fall. The stagger is kept, then every
// bone blends to a relaxed supine pose derived from the bind pose while the
// ground wrapper tips the whole rig about the feet. The fall angle, head
// tilt, arm drop and hip extension are each solved so the pelvis, upper back,
// head, both arms and both legs rest on the floor; per-key contact is baked.
function trollBackFall(doc, death, collapseDuration, holdUntil) {
  const root = doc.getRoot();
  const node = name => { const n = root.listNodes().find(x => x.getName() === name); if (!n) throw new Error(`Troll joint ${name} missing`); return n; };
  const ground = node('troll_mauler_ground'), armature = node('Armature');
  const rest = new Map(root.listNodes().map(n => [n, { t: n.getTranslation(), r: n.getRotation(), s: n.getScale() }]));
  const restPose = () => { for (const [n, p] of rest) n.setTranslation(p.t).setRotation(p.r).setScale(p.s); };
  restPose();
  const restWorld = new Map(root.listNodes().map(n => [n, new Matrix4().fromArray(n.getWorldMatrix())]));
  const worldRotation = m => new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(m));
  // Local rotation applying a standing-frame rotation q to a joint whose parent keeps its rest pose.
  const turn = (name, q) => {
    const n = node(name), parent = worldRotation(restWorld.get(n.getParentNode()));
    return parent.clone().invert().multiply(q).multiply(parent).multiply(new Quaternion(...rest.get(n).r)).toArray();
  };
  const aimArm = (name, dir) => {
    const world = worldRotation(restWorld.get(node(name)));
    return turn(name, new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0).applyQuaternion(world), dir.clone().normalize()));
  };
  const bend = (name, radians) => new Quaternion(...rest.get(node(name)).r).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), radians)).toArray();
  const X = new Vector3(1, 0, 0), Z = new Vector3(0, 0, 1);
  const pitch = a => new Quaternion().setFromAxisAngle(X, a);
  const params = { fall: Math.PI / 2, head: 0, armL: .3, armR: .3, legL: 0, legR: 0 };
  const fallRotation = u => pitch(-params.fall * u);
  const targets = () => {
    const t = {
      Bone003: { r: turn('Bone003', pitch(-params.head)) },
      armL: { r: aimArm('armL', new Vector3(.8, -.6, -params.armL)) }, armR: { r: aimArm('armR', new Vector3(-.8, -.6, -params.armR)) },
      forearmL: { r: bend('forearmL', .2) }, forearmR: { r: bend('forearmR', .3) },
      thighL: { r: turn('thighL', new Quaternion().setFromAxisAngle(Z, .1).multiply(pitch(params.legL))) },
      thighR: { r: turn('thighR', new Quaternion().setFromAxisAngle(Z, -.14).multiply(pitch(params.legR))) },
      shinL: { r: bend('shinL', .1) }, shinR: { r: bend('shinR', .18) },
    };
    // The IK foot controllers carry a few sole vertices; move them rigidly with the FK foot.
    restPose();
    for (const [name, v] of Object.entries(t)) node(name).setRotation(v.r);
    const armatureInverse = new Matrix4().fromArray(armature.getWorldMatrix()).invert();
    for (const side of ['L', 'R']) {
      const foot = node(`foot${side}`), main = node(`foot_main${side}`);
      const delta = new Matrix4().fromArray(foot.getWorldMatrix()).multiply(restWorld.get(foot).clone().invert());
      const local = armatureInverse.clone().multiply(delta).multiply(restWorld.get(main));
      const tr = new Vector3(), q = new Quaternion(), sc = new Vector3(); local.decompose(tr, q, sc);
      t[`foot_main${side}`] = { r: q.toArray(), t: tr.toArray() };
    }
    return t;
  };
  const floors = () => {
    const t = targets();
    for (const [name, v] of Object.entries(t)) { node(name).setRotation(v.r); if (v.t) node(name).setTranslation(v.t); }
    const q = fallRotation(1), out = {};
    for (const { joint, p } of skinnedPoints(doc)) {
      const region = Object.keys(trollRegions).find(k => trollRegions[k].test(joint)); if (!region) continue;
      out[region] = Math.min(out[region] ?? Infinity, p.clone().applyQuaternion(q).y);
    }
    restPose();
    return out;
  };
  const solve = (key, lo, hi, gap) => { params[key] = solveFloor(lo, hi, x => { params[key] = x; return gap(floors()); }); };
  // Hip extension also moves buttock vertices, so alternate the coupled solves until they settle.
  const back = f => Math.min(f.pelvis, f.upperBack);
  for (let pass = 0; pass < 6; pass++) {
    solve('fall', 70 * Math.PI / 180, 120 * Math.PI / 180, f => f.upperBack - f.pelvis);
    solve('head', -.3, 1.2, f => f.head - back(f));
    for (const key of ['armL', 'armR']) solve(key, -.6, 1.6, f => f[key] - back(f));
    for (const key of ['legL', 'legR']) solve(key, -.6, 1.6, f => f[key] - back(f));
  }
  const solvedFloors = floors(), pose = targets();
  restPose();
  const startBlend = .1, endBlend = collapseDuration - .06;
  const blend = t => { const u = Math.min(1, Math.max(0, (t - startBlend) / (endBlend - startBlend))); return u * u * (3 - 2 * u); };
  for (const ch of death.listChannels()) {
    const n = ch.getTargetNode(); if (n === ground) continue;
    const kind = ch.getTargetPath(), sampler = ch.getSampler(), times = sampler.getInput().getArray();
    const source = sampler.getOutput().getArray(), width = kind === 'rotation' ? 4 : 3, values = new Float32Array(source.length);
    const own = pose[n.getName()], restTrs = rest.get(n);
    const target = kind === 'rotation' ? own?.r ?? restTrs.r : kind === 'translation' ? own?.t ?? restTrs.t : restTrs.s;
    for (let i = 0; i < times.length; i++) {
      const w = blend(times[i]), a = Array.from(source.slice(i * width, i * width + width));
      if (kind === 'rotation') new Quaternion(...a).slerp(new Quaternion(...target), w).toArray(values, i * 4);
      else for (let k = 0; k < 3; k++) values[i * 3 + k] = a[k] + (target[k] - a[k]) * w;
    }
    sampler.setOutput(doc.createAccessor(`${n.getName()}_${kind}_supine_death`).setType(kind === 'rotation' ? 'VEC4' : 'VEC3').setArray(values));
  }
  // Tip backwards about the feet, accelerating into the impact like a toppling body.
  const fallStart = .16;
  const keyCount = Math.round(collapseDuration * 480) + 1;
  const times = Float32Array.from([...Array.from({ length: keyCount }, (_, i) => collapseDuration * i / (keyCount - 1)), holdUntil]);
  const rotations = new Float32Array(times.length * 4);
  for (let i = 0; i < times.length; i++) {
    const u = Math.min(1, Math.max(0, (times[i] - fallStart) / (collapseDuration - fallStart)));
    fallRotation(u * u).toArray(rotations, i * 4);
  }
  const timeAccessor = doc.createAccessor('creature_troll_mauler_supine_fall_times').setType('SCALAR').setArray(times);
  const rotationSampler = doc.createAnimationSampler('creature_troll_mauler_supine_fall_rotation').setInput(timeAccessor)
    .setOutput(doc.createAccessor('creature_troll_mauler_supine_fall_rotation').setType('VEC4').setArray(rotations)).setInterpolation('LINEAR');
  death.addSampler(rotationSampler).addChannel(doc.createAnimationChannel().setTargetNode(ground).setTargetPath('rotation').setSampler(rotationSampler));
  // Replace the source contact track: every key moves the wrapper so the lowest skinned vertex rests at groundY.
  const groundChannel = death.listChannels().find(ch => ch.getTargetNode() === ground && ch.getTargetPath() === 'translation');
  if (!groundChannel) throw new Error('Troll Death ground translation missing');
  const groundY = .001, translations = new Float32Array(times.length * 3);
  groundChannel.getSampler().setInput(timeAccessor).setOutput(doc.createAccessor('creature_troll_mauler_supine_fall_contact').setType('VEC3').setArray(translations));
  for (let i = 0; i < times.length; i++) {
    poseDeath(doc, death, times[i], rest); ground.setTranslation([0, 0, 0]);
    translations[i * 3 + 1] = groundY - deformedBounds(doc).min[1];
  }
  let lowest = Infinity, highest = -Infinity;
  for (let i = 0; i <= 720; i++) {
    poseDeath(doc, death, collapseDuration * i / 720, rest);
    const y = deformedBounds(doc).min[1]; lowest = Math.min(lowest, y); highest = Math.max(highest, y);
  }
  poseDeath(doc, death, holdUntil, rest);
  const final = deformedBounds(doc), regionFloors = {};
  for (const { joint, p } of skinnedPoints(doc)) {
    const region = Object.keys(trollRegions).find(k => trollRegions[k].test(joint));
    if (region) regionFloors[region] = Math.min(regionFloors[region] ?? Infinity, p.y);
  }
  restPose();
  if (lowest < groundY - .004 || highest > groundY + .004) throw new Error(`Troll fall loses ground contact ${lowest} ${highest}`);
  if (Math.max(...Object.values(regionFloors)) > .06) throw new Error(`Troll corpse region floats ${JSON.stringify(regionFloors)} ${JSON.stringify(solvedFloors)} ${JSON.stringify(params)}`);
  const round = v => Math.round(v * 1000) / 1000;
  return { method: 'Source Death stagger kept to 0.1s; all 33 joints then blend to a relaxed supine pose derived from the bind pose while the ground wrapper tips the rig backwards about the feet. Fall angle, head tilt, arm drop and hip extension are solved so pelvis, upper back, head, both arms and both legs rest on the floor; IK foot controllers follow the FK feet; per-key vertical contact is CPU-baked from skinned vertices.',
    blendSeconds: [startBlend, round(endBlend)], fallStartSeconds: fallStart, fallDegrees: round(params.fall * 180 / Math.PI),
    solvedRadians: { headTiltBack: round(params.head), armDropBackL: round(params.armL), armDropBackR: round(params.armR), hipExtensionL: round(params.legL), hipExtensionR: round(params.legR) },
    contactKeys: times.length, contactRange: [round(lowest), round(highest)], finalBounds: { min: final.min.map(round), max: final.max.map(round) },
    finalRegionFloors: Object.fromEntries(Object.entries(regionFloors).map(([k, v]) => [k, round(v)])) };
}

// Roach regions by dominant joint: the shell, head and tail body, and each of the four legs.
const roachRegions = {
  body: /^roach_\d+_(SpineHigh|Shoulder|SpineLow|Tail\d*|TailEnd|Head|Jaw[LR]|Tongue\d*|TongueEnd)$/,
  frontL: /^roach_\d+_(ArmL|ForearmFrontL|ClawFrontL)$/, frontR: /^roach_\d+_(ArmR|ForearmFrontR|ClawFrontR)$/,
  backL: /^roach_\d+_(LegL|ForeLegL|ClawBackL)$/, backR: /^roach_\d+_(LegR|ForeLegR|ClawBackR)$/,
};
// Distal leg segments: the upper segment's thick joint can sit under the shell side whatever the
// aim, so each leg's lower segment and claw are what the solve lays on the floor.
const roachDistal = {
  frontL: /^roach_\d+_(ForearmFrontL|ClawFrontL)$/, frontR: /^roach_\d+_(ForearmFrontR|ClawFrontR)$/,
  backL: /^roach_\d+_(ForeLegL|ClawBackL)$/, backR: /^roach_\d+_(ForeLegR|ClawBackR)$/,
};

// The native roach Death sags but stays on stiff legs at ~70% of standing height. Its shell is
// 0.52 m deep but only 0.4 m wide, so the corpse rolls onto its side: the native stagger is kept,
// then all joints blend to a rest-derived pose whose four legs curl under the belly, while the
// ground wrapper rolls the body 90 degrees. Each leg's curl is solved so it rests on the floor
// beside the shell; the corpse is slid over the entity origin and per-key contact is baked.
function roachSideFall(doc, death, collapseDuration, holdUntil) {
  const root = doc.getRoot();
  const node = name => { const n = root.listNodes().find(x => x.getName() === name); if (!n) throw new Error(`Roach joint ${name} missing`); return n; };
  const ground = node('roach_source_ground');
  const rest = new Map(root.listNodes().map(n => [n, { t: n.getTranslation(), r: n.getRotation(), s: n.getScale() }]));
  const restPose = () => { for (const [n, p] of rest) n.setTranslation(p.t).setRotation(p.r).setScale(p.s); };
  restPose();
  const restWorld = new Map(root.listNodes().map(n => [n, new Matrix4().fromArray(n.getWorldMatrix())]));
  const worldRotation = m => new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(m));
  // Aim a leg chain (upper, lower, claw) along standing-frame directions. Each bone's axis is its
  // rest direction to the next joint; the claw's axis ends at its rest floor-contact node.
  const aimChain = (names, tip, dirs) => {
    const out = {};
    let parentWorld = worldRotation(restWorld.get(node(names[0]).getParentNode()));
    for (const [i, name] of names.entries()) {
      const n = node(name), world = worldRotation(restWorld.get(n));
      const from = new Vector3().setFromMatrixPosition(restWorld.get(n));
      const to = new Vector3().setFromMatrixPosition(restWorld.get(i + 1 < names.length ? node(names[i + 1]) : node(tip)));
      const posed = new Quaternion().setFromUnitVectors(to.sub(from).normalize(), dirs[i].clone().normalize()).multiply(world);
      out[name] = { r: parentWorld.clone().invert().multiply(posed).toArray() };
      parentWorld = posed;
    }
    return out;
  };
  const legs = {
    frontL: [['roach_20_ArmL', 'roach_21_ForearmFrontL', 'roach_22_ClawFrontL'], 'roach_45_ClawFrontLH', 1],
    frontR: [['roach_24_ArmR', 'roach_25_ForearmFrontR', 'roach_26_ClawFrontR'], 'roach_48_ClawFrontRH', 1],
    backL: [['roach_33_LegL', 'roach_34_ForeLegL', 'roach_35_ClawBackL'], 'roach_51_ClawBackLL', -1],
    backR: [['roach_37_LegR', 'roach_38_ForeLegR', 'roach_39_ClawBackR'], 'roach_54_ClawBackRL', -1],
  };
  // Rolling +90 degrees about Z puts the +X (left) side up; the -X shell side becomes the floor.
  const rollDegrees = 90, roll = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rollDegrees * Math.PI / 180);
  const params = { frontL: .3, frontR: 0, backL: .3, backR: 0, frontLUpper: .3, frontRUpper: 0, backLUpper: .3, backRUpper: 0 };
  // Legs fold under the belly (-Y) and fore/aft; the solved -X lean lays each one on the floor side.
  const targets = () => Object.assign({}, ...Object.entries(legs).map(([key, [bones, tip, fore]]) => aimChain(bones, tip,
    [new Vector3(-params[`${key}Upper`], -1, .3 * fore), new Vector3(-params[key], -.3, fore), new Vector3(-params[key], -.6, .4 * fore)])));
  const floors = () => {
    for (const [name, v] of Object.entries(targets())) node(name).setRotation(v.r);
    const out = {};
    for (const { joint, p } of skinnedPoints(doc)) {
      const h = p.clone().applyQuaternion(roll).y;
      for (const [k, re] of [...Object.entries(roachRegions), ...Object.entries(roachDistal).map(([k, re]) => [`${k}Distal`, re]), ['frontRUpper', /^roach_\d+_ArmR$/], ['backRUpper', /^roach_\d+_LegR$/]])
        if (re.test(joint)) out[k] = Math.min(out[k] ?? Infinity, h);
    }
    restPose();
    return out;
  };
  // The floor-side upper legs are leaned just onto the shell's floor, then every lower leg and
  // claw is laid down to the same floor.
  for (let pass = 0; pass < 3; pass++) {
    for (const key of ['frontRUpper', 'backRUpper']) params[key] = solveFloor(-1, 3, x => { params[key] = x; const f = floors(); return f[key] - f.body; });
    for (const key of Object.keys(legs)) params[key] = solveFloor(-1, 3, x => { params[key] = x; const f = floors(); return f[`${key}Distal`] - f.body; });
  }
  const solvedFloors = floors(), pose = targets();
  const startBlend = .1, endBlend = collapseDuration - .06;
  const blend = t => { const u = Math.min(1, Math.max(0, (t - startBlend) / (endBlend - startBlend))); return u * u * (3 - 2 * u); };
  for (const ch of death.listChannels()) {
    const n = ch.getTargetNode(); if (n === ground) continue;
    const kind = ch.getTargetPath(), sampler = ch.getSampler(), times = sampler.getInput().getArray();
    const source = sampler.getOutput().getArray(), width = kind === 'rotation' ? 4 : 3, values = new Float32Array(source.length);
    const restTrs = rest.get(n), target = kind === 'rotation' ? pose[n.getName()]?.r ?? restTrs.r : kind === 'translation' ? restTrs.t : restTrs.s;
    for (let i = 0; i < times.length; i++) {
      const w = blend(times[i]), a = Array.from(source.slice(i * width, i * width + width));
      if (kind === 'rotation') new Quaternion(...a).slerp(new Quaternion(...target), w).toArray(values, i * 4);
      else for (let k = 0; k < 3; k++) values[i * 3 + k] = a[k] + (target[k] - a[k]) * w;
    }
    sampler.setOutput(doc.createAccessor(`${n.getName()}_${kind}_side_death`).setType(kind === 'rotation' ? 'VEC4' : 'VEC3').setArray(values));
  }
  const fallStart = .16, keyCount = Math.round(collapseDuration * 480) + 1;
  const times = Float32Array.from([...Array.from({ length: keyCount }, (_, i) => collapseDuration * i / (keyCount - 1)), holdUntil]);
  const ease = t => { const u = Math.min(1, Math.max(0, (t - fallStart) / (collapseDuration - fallStart))); return u * u; };
  const rotations = new Float32Array(times.length * 4);
  for (let i = 0; i < times.length; i++) new Quaternion().slerp(roll, ease(times[i])).toArray(rotations, i * 4);
  const timeAccessor = doc.createAccessor('creature_cave_roach_side_fall_times').setType('SCALAR').setArray(times);
  if (death.listChannels().some(ch => ch.getTargetNode() === ground && ch.getTargetPath() === 'rotation')) throw new Error('Roach ground already rotates in Death');
  const rotationSampler = doc.createAnimationSampler('creature_cave_roach_side_fall_rotation').setInput(timeAccessor)
    .setOutput(doc.createAccessor('creature_cave_roach_side_fall_rotation').setType('VEC4').setArray(rotations)).setInterpolation('LINEAR');
  death.addSampler(rotationSampler).addChannel(doc.createAnimationChannel().setTargetNode(ground).setTargetPath('rotation').setSampler(rotationSampler));
  const groundY = .006, translations = new Float32Array(times.length * 3);
  const contactSampler = doc.createAnimationSampler('creature_cave_roach_side_fall_contact').setInput(timeAccessor)
    .setOutput(doc.createAccessor('creature_cave_roach_side_fall_contact').setType('VEC3').setArray(translations)).setInterpolation('LINEAR');
  death.addSampler(contactSampler);
  const groundChannel = death.listChannels().find(ch => ch.getTargetNode() === ground && ch.getTargetPath() === 'translation');
  if (groundChannel) groundChannel.setSampler(contactSampler);
  else death.addChannel(doc.createAnimationChannel().setTargetNode(ground).setTargetPath('translation').setSampler(contactSampler));
  const scale = new Vector3().setFromMatrixScale(new Matrix4().fromArray(ground.getParentNode().getWorldMatrix()));
  poseDeath(doc, death, holdUntil, rest); ground.setTranslation([0, 0, 0]);
  const settled = deformedBounds(doc), centre = [0, 2].map(k => (settled.min[k] + settled.max[k]) / 2);
  for (let i = 0; i < times.length; i++) {
    poseDeath(doc, death, times[i], rest); ground.setTranslation([0, 0, 0]);
    const slide = ease(times[i]);
    translations[i * 3] = -centre[0] * slide / scale.x;
    translations[i * 3 + 1] = (groundY - deformedBounds(doc).min[1]) / scale.y;
    translations[i * 3 + 2] = -centre[1] * slide / scale.z;
  }
  let lowest = Infinity, highest = -Infinity;
  for (let i = 0; i <= 720; i++) {
    poseDeath(doc, death, collapseDuration * i / 720, rest);
    const y = deformedBounds(doc).min[1]; lowest = Math.min(lowest, y); highest = Math.max(highest, y);
  }
  poseDeath(doc, death, holdUntil, rest);
  const final = deformedBounds(doc), regionFloors = {};
  for (const { joint, p } of skinnedPoints(doc)) {
    const region = Object.keys(roachRegions).find(k => roachRegions[k].test(joint));
    if (region) regionFloors[region] = Math.min(regionFloors[region] ?? Infinity, p.y);
  }
  restPose();
  if (lowest < groundY - .004 || highest > groundY + .006) throw new Error(`Roach fall loses ground contact ${lowest} ${highest}`);
  if (Math.max(...Object.values(regionFloors)) > groundY + .06) throw new Error(`Roach corpse region floats ${JSON.stringify(regionFloors)} ${JSON.stringify(solvedFloors)} ${JSON.stringify(params)}`);
  const round = v => Math.round(v * 1000) / 1000;
  return { method: 'Native Death stagger kept to 0.1 s; all joints then blend to a rest-derived pose with the four legs curled under the belly while the ground wrapper rolls the body 90 degrees onto its side (the 0.4 m wide shell, not the 0.52 m deep one, sets the corpse height). Each leg curl is solved so it rests on the floor beside the shell; the corpse is slid over the entity origin and per-key vertical contact is CPU-baked from skinned vertices.',
    blendSeconds: [startBlend, round(endBlend)], fallStartSeconds: fallStart, rollDegrees,
    solvedLegCurl: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, round(v)])), corpseCentreSlide: centre.map(v => -round(v)),
    contactKeys: times.length, contactRange: [round(lowest), round(highest)], finalBounds: { min: final.min.map(round), max: final.max.map(round) },
    finalRegionFloors: Object.fromEntries(Object.entries(regionFloors).map(([k, v]) => [k, round(v)])) };
}

function channelValue(ch, time) {
  const sampler = ch.getSampler(), times = sampler.getInput().getArray(), values = sampler.getOutput().getArray();
  const width = ch.getTargetPath() === 'rotation' ? 4 : 3;
  let i = 0; while (i < times.length - 2 && times[i + 1] < time) i++;
  const u = times[i + 1] > times[i] ? Math.min(1, Math.max(0, (time - times[i]) / (times[i + 1] - times[i]))) : 0;
  const a = Array.from(values.slice(i * width, i * width + width)), b = Array.from(values.slice((i + 1) * width, (i + 2) * width));
  return width === 4 ? new Quaternion(...a).slerp(new Quaternion(...b), u).toArray() : a.map((x, k) => x + (b[k] - x) * u);
}

// The goblin mocap Death is 3.58 s at 48 Hz. From 0.1 to 0.9 s the actor leaps backwards with
// both feet off the ground (lowest point up to 0.64 m), which cannot be grounded without planting
// the head first. Replace that airborne span with a 0.45 s eased topple from the standing first
// key to the source landing pose at 0.95 s, then keep the native 48 Hz settle (0.95-1.5 s) at
// 1.25x so the corpse rests by goblinSettle and holds. Hips horizontal travel is removed and the
// corpse is slid over the entity origin; a dense contact track on mocap_Armature keeps the lowest
// skinned vertex on the floor throughout.
const goblinLanding = .95, goblinSourceEnd = 1.5, goblinTopple = .45, goblinSettleSpeed = 1.25;
const goblinSettle = goblinTopple + (goblinSourceEnd - goblinLanding) / goblinSettleSpeed;
function goblinDeath(doc, death, holdUntil) {
  const root = doc.getRoot();
  const node = name => root.listNodes().find(n => n.getName() === name);
  const armature = node('mocap_Armature'), hips = node('mocap_Hips');
  const rest = new Map(root.listNodes().map(n => [n, { t: n.getTranslation(), r: n.getRotation(), s: n.getScale() }]));
  const channels = death.listChannels();
  const armatureChannel = channels.find(ch => ch.getTargetNode() === armature && ch.getTargetPath() === 'translation');
  const hipsChannel = channels.find(ch => ch.getTargetNode() === hips && ch.getTargetPath() === 'translation');
  if (!armatureChannel || !hipsChannel) throw new Error('Goblin Death tracks missing');
  const nativeTimes = Array.from(hipsChannel.getSampler().getInput().getArray());
  if (Math.abs(nativeTimes[1] - 1 / 48) > 1e-5) throw new Error('Goblin Death is not 48 Hz');
  const toppleKeys = Math.round(goblinTopple * 48);
  // [output time, source time or null for the topple, topple weight]
  const plan = [
    ...Array.from({ length: toppleKeys }, (_, i) => { const u = i / toppleKeys; return [goblinTopple * u, null, u * u]; }),
    ...nativeTimes.filter(t => t >= goblinLanding - 1e-6 && t <= goblinSourceEnd + 1e-6).map(t => [goblinTopple + (t - goblinLanding) / goblinSettleSpeed, t, 1]),
  ];
  const times = doc.createAccessor('creature_wild_goblin_death_times').setType('SCALAR')
    .setArray(Float32Array.from([...plan.map(p => p[0]), holdUntil]));
  // The hips local axis that maps to world vertical carries height; the other two are horizontal travel.
  const armatureRotation = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(new Matrix4().fromArray(armature.getWorldMatrix())));
  const vertical = [0, 1, 2].reduce((best, axis) => {
    const dir = new Vector3().setComponent(axis, 1).applyQuaternion(armatureRotation);
    return Math.abs(dir.y) > Math.abs(new Vector3().setComponent(best, 1).applyQuaternion(armatureRotation).y) ? axis : best;
  }, 0);
  const hipsStart = channelValue(hipsChannel, 0);
  for (const ch of channels) {
    if (ch === armatureChannel) continue;
    const width = ch.getTargetPath() === 'rotation' ? 4 : 3, values = [];
    const start = channelValue(ch, 0), landing = channelValue(ch, goblinLanding);
    for (const [, source, w] of plan) {
      const v = source !== null ? channelValue(ch, source) : width === 4
        ? new Quaternion(...start).slerp(new Quaternion(...landing), w).toArray() : start.map((x, k) => x + (landing[k] - x) * w);
      if (ch === hipsChannel) for (let k = 0; k < 3; k++) if (k !== vertical) v[k] = hipsStart[k];
      values.push(...v);
    }
    values.push(...values.slice(-width));
    ch.getSampler().setInput(times).setOutput(doc.createAccessor(`${ch.getTargetNode().getName()}_${ch.getTargetPath()}_death_topple`)
      .setType(width === 4 ? 'VEC4' : 'VEC3').setArray(Float32Array.from(values)));
  }
  const keyCount = Math.round(goblinSettle * 240) + 1, groundY = .006;
  const contactTimes = Float32Array.from([...Array.from({ length: keyCount }, (_, i) => goblinSettle * i / (keyCount - 1)), holdUntil]);
  const contact = new Float32Array(contactTimes.length * 3);
  armatureChannel.getSampler().setInput(doc.createAccessor('creature_wild_goblin_death_contact_times').setType('SCALAR').setArray(contactTimes))
    .setOutput(doc.createAccessor('creature_wild_goblin_death_contact').setType('VEC3').setArray(contact));
  const gain = new Vector3().setFromMatrixScale(new Matrix4().fromArray(armature.getParentNode().getWorldMatrix())).y;
  // Centre the settled corpse over the origin, sliding it there as the body goes down.
  poseDeath(doc, death, holdUntil, rest); armature.setTranslation([0, 0, 0]);
  const settled = deformedBounds(doc), centre = [0, 2].map(k => (settled.min[k] + settled.max[k]) / 2);
  const slide = t => { const u = Math.min(1, Math.max(0, (t - .2) / (goblinSettle - .2))); return u * u * (3 - 2 * u); };
  for (let i = 0; i < contactTimes.length; i++) {
    poseDeath(doc, death, contactTimes[i], rest); armature.setTranslation([0, 0, 0]);
    contact[i * 3] = -centre[0] * slide(contactTimes[i]) / gain;
    contact[i * 3 + 1] = (groundY - deformedBounds(doc).min[1]) / gain;
    contact[i * 3 + 2] = -centre[1] * slide(contactTimes[i]) / gain;
  }
  let lowest = Infinity, highest = -Infinity;
  for (let i = 0; i <= 960; i++) {
    poseDeath(doc, death, goblinSettle * i / 960, rest);
    const y = deformedBounds(doc).min[1]; lowest = Math.min(lowest, y); highest = Math.max(highest, y);
  }
  poseDeath(doc, death, holdUntil, rest);
  const final = deformedBounds(doc);
  for (const [n, p] of rest) n.setTranslation(p.t).setRotation(p.r).setScale(p.s);
  if (lowest < groundY - .004 || highest > groundY + .01) throw new Error(`Goblin fall loses ground contact ${lowest} ${highest}`);
  const round = v => Math.round(v * 1000) / 1000;
  return { method: 'Source airborne leap (0.1-0.9 s, feet up to 0.64 m) replaced by a 0.45 s eased topple from the first standing key to the source landing pose at 0.95 s; native 48 Hz settle keys 0.95-1.5 s kept at 1.25x; hips horizontal travel removed and the corpse slid so its centre ends over the entity origin; dense per-key vertical contact on mocap_Armature keeps the lowest skinned vertex on the floor.',
    toppleSeconds: [0, goblinTopple], sourceLandingSeconds: goblinLanding, sourceSettleSeconds: [goblinLanding, goblinSourceEnd], settleSpeed: goblinSettleSpeed, sourceKeyHz: 48, settleSeconds: round(goblinSettle), heldUntilSeconds: holdUntil,
    hipsHorizontalTravelRemoved: true, corpseCentreSlide: centre.map(v => -round(v)), contactKeys: contactTimes.length, contactRange: [round(lowest), round(highest)],
    finalBounds: { min: final.min.map(round), max: final.max.map(round) } };
}

const inspect = process.argv.includes('--inspect');
const summary = [];
for (const entry of entries) {
  const sourceDir = path.join(repo, 'art/rebuild/candidates/finish-bestiary', entry.sourceDir);
  const catalog = JSON.parse(await readFile(path.join(sourceDir, 'catalog.json'), 'utf8'));
  const original = catalog.assets.find(a => a.id === entry.id);
  if (!original) throw new Error(`Missing catalog ${entry.id}`);
  const sourceFile = path.join(sourceDir, original.candidateFile);
  const sourceBytes = await readFile(sourceFile);
  if (hash(sourceBytes) !== original.sha256 || sourceBytes.length !== original.bytes) throw new Error(`Source hash mismatch ${entry.id}`);
  const doc = await io.read(sourceFile);
  const root = doc.getRoot();
  const originalClips = root.listAnimations().map(a => a.getName());
  const originalMaterials = root.listMaterials().map(m => m.getName());
  if (JSON.stringify(originalClips.slice().sort()) !== JSON.stringify(original.animations.slice().sort()) ||
      JSON.stringify(originalMaterials.slice().sort()) !== JSON.stringify(original.materials.slice().sort())) throw new Error(`Metadata mismatch ${entry.id}`);
  let materialRepair = null;
  if (!inspect && entry.id === 'creature_troll_mauler') {
    const cloth = root.listMaterials().find(m => m.getName() === 'animal_rpg_troll_mauler_cloth');
    if (!cloth?.getBaseColorTexture()?.getImage()) throw new Error('Troll cloth atlas missing');
    cloth.setAlphaMode('MASK').setAlphaCutoff(.5);
    materialRepair = { material: cloth.getName(), alphaMode: 'MASK', alphaCutoff: .5,
      reason: 'Cloth PNG contains a transparent ragged hem; OPAQUE rendered its white atlas backing as a rectangle.' };
  }
  const death = root.listAnimations().find(a => a.getName() === 'Death');
  const sourceDeath = sampleClip(doc, death, [0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1]);
  const startHeight = sourceDeath.frames[0].height, endHeight = sourceDeath.frames.at(-1).height;
  const sourceFloor = Math.min(...sourceDeath.frames.map(f => f.bounds.min[1]));
  const sourceResult = { id: entry.id, sourceFile: path.relative(repo, sourceFile).replaceAll('\\', '/'), sourceSha256: original.sha256,
    sourceDeath: { duration: sourceDeath.duration, startHeight, endHeight, endHeightRatio: endHeight / startHeight, minY: sourceFloor,
      samples: sourceDeath.frames.map(f => ({ fraction: f.fraction, height: f.height, minY: f.bounds.min[1] })) } };
  if (inspect) { summary.push(sourceResult); continue; }
  // Death must settle before the combat workbench fades the corpse at 1.5s.
  // Each unique source time accessor is cloned; no locomotion or attack action is retimed.
  const oldDuration = duration(death), newDuration = 1.5;
  const collapseDuration = entry.id === 'creature_wild_goblin' ? goblinSettle : .72;
  const replacements = new Map();
  for (const channel of entry.id === 'creature_wild_goblin' ? [] : death.listChannels()) {
    const sampler = channel.getSampler(), input = sampler.getInput(), output = sampler.getOutput();
    if (!replacements.has(input)) {
      const times = input.getArray();
      const retimed = Float32Array.from([...times].map(value => value * collapseDuration / oldDuration).concat([newDuration]));
      replacements.set(input, doc.createAccessor(`${entry.id}_death_held_1.5s`).setType('SCALAR').setArray(retimed));
    }
    const values = output.getArray(), stride = values.length / input.getCount();
    if (!Number.isInteger(stride) || ![3, 4].includes(stride)) throw new Error(`Unexpected Death output stride ${stride}`);
    const held = new Float32Array(values.length + stride);
    held.set(values); held.set(values.slice(values.length - stride), values.length);
    if (entry.id === 'creature_cave_roach' && channel.getTargetNode()?.getName() === 'roach_source_ground' && channel.getTargetPath() === 'translation') {
      const sourceTimes = input.getArray(), lastSourceKey = sourceTimes.length - 1;
      for (let i = lastSourceKey - 1; i >= 0 && Math.abs(sourceTimes[i] - sourceTimes[lastSourceKey]) < 1e-6; i--)
        held.set(values.slice(lastSourceKey * stride, (lastSourceKey + 1) * stride), i * stride);
    }
    sampler.setInput(replacements.get(input));
    sampler.setOutput(doc.createAccessor(`${entry.id}_death_held_pose`).setType(output.getType()).setArray(held));
  }
  let authoredFall = null;
  if (entry.id === 'creature_wild_goblin') authoredFall = goblinDeath(doc, death, newDuration);
  if (entry.id === 'creature_troll_mauler') authoredFall = trollBackFall(doc, death, collapseDuration, newDuration);
  if (entry.id === 'creature_cave_roach') authoredFall = roachSideFall(doc, death, collapseDuration, newDuration);
  const checked = root.listAnimations().map(clip => sampleClip(doc, clip,
    clip.getName() === 'Death' ? [...new Set([...Array.from({ length: 31 }, (_, i) => i / 30), collapseDuration / newDuration])].sort((a,b)=>a-b) : [0, .25, .5, .75, 1]));
  const deathCheck = checked.find(row => row.clip === 'Death');
  const collapseFrame = deathCheck.frames.find(frame => Math.abs(frame.seconds - collapseDuration) < .0001);
  const floorRange = Object.fromEntries(checked.map(row => [row.clip, {
    minY: Math.min(...row.frames.map(f => f.bounds.min[1])), maxY: Math.max(...row.frames.map(f => f.bounds.max[1])),
    duration: row.duration, samples: row.frames.length,
  }]));
  const stageFile = path.join(here, original.file);
  await mkdir(path.dirname(stageFile), { recursive: true });
  // Retimed and rebuilt Death tracks replace their source accessors; drop the unreferenced originals.
  for (const accessor of root.listAccessors()) if (accessor.listParents().every(parent => parent === root)) accessor.dispose();
  const bytes = await io.writeBinary(doc);
  await writeFile(stageFile, bytes);
  const roundtrip = await io.readBinary(bytes);
  if (roundtrip.getRoot().listAnimations().length !== originalClips.length ||
      JSON.stringify(roundtrip.getRoot().listMaterials().map(m => m.getName()).sort()) !== JSON.stringify(originalMaterials.sort())) throw new Error(`Roundtrip loss ${entry.id}`);
  summary.push({ ...sourceResult, candidateFile: path.relative(here, stageFile).replaceAll('\\', '/'),
    candidateSha256: hash(bytes), candidateBytes: bytes.length, clips: originalClips, materials: original.materials,
    rigSkins: root.listSkins().map(s => s.listJoints().length),
    materialRepair,
    deathRetime: { duration: deathCheck.duration, endHeight: deathCheck.frames.at(-1).height,
      endHeightRatio: deathCheck.frames.at(-1).height / deathCheck.frames[0].height,
      endMinY: deathCheck.frames.at(-1).bounds.min[1], finalReachedAtSeconds: collapseDuration,
      collapseHeight: collapseFrame?.height, collapseMinY: collapseFrame?.bounds.min[1],
      heldUntilSeconds: newDuration,
      authoredFall,
      cpuCollapseByHeight: deathCheck.frames.at(-1).height / deathCheck.frames[0].height < .55,
      visualAcceptancePending: true },
    cpuMotion: floorRange });
}
await writeFile(path.join(here, inspect ? 'source-motion.json' : 'validation.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary.map(s => ({ id: s.id, sourceDeath: s.sourceDeath, candidateSha256: s.candidateSha256,
  deathRetime: s.deathRetime })), null, 2));
