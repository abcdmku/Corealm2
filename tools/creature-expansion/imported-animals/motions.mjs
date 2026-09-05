import * as THREE from 'three';
import { splitSalamanderMouth } from './salamander-mouth.mjs';
import { refineSnail } from './refine-snail.mjs';
import { gooseWings as fittedGooseWings } from './goose-wings.mjs';

const axis = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

function curve(phases, values, t) {
  for (let i = 1; i < phases.length; i++) {
    if (t > phases[i]) continue;
    const u = THREE.MathUtils.clamp((t - phases[i - 1]) / (phases[i] - phases[i - 1]), 0, 1);
    return THREE.MathUtils.lerp(values[i - 1], values[i], u * u * (3 - 2 * u));
  }
  return values.at(-1);
}

function storedPose(object) {
  const pose = [];
  object.traverse(node => pose.push({ node, p: node.position.clone(), q: node.quaternion.clone(), s: node.scale.clone() }));
  return pose;
}

function restore(pose, object) {
  for (const state of pose) {
    state.node.position.copy(state.p);
    state.node.quaternion.copy(state.q);
    state.node.scale.copy(state.s);
  }
  object.updateMatrixWorld(true);
}

/** A complete source pose at both endpoints avoids bind-pose snaps when action weights crossfade. */
function author(object, idle, name, duration, animate, options = {}) {
  const original = storedPose(object);
  const mixer = new THREE.AnimationMixer(object);
  mixer.clipAction(idle).play();
  mixer.setTime(0);
  object.updateMatrixWorld(true);
  const base = storedPose(object);
  const nodes = base.filter(entry => entry.node.isBone);
  const byName = new Map(nodes.map(entry => [entry.node.name, entry]));
  const inverseWorld = new Map(nodes.map(entry => [entry.node.name, entry.node.getWorldQuaternion(new THREE.Quaternion()).invert()]));
  const samples = new Map(nodes.map(entry => [entry.node.name, { p: [], q: [], s: [] }]));
  const count = Math.ceil(duration * 30);
  const times = Array.from({ length: count + 1 }, (_, i) => duration * i / count);
  const rotate = (boneName, worldAxis, degrees) => {
    const entry = byName.get(boneName);
    if (!entry) throw new Error(`${name}: missing joint ${boneName}`);
    const localAxis = axis[worldAxis].clone().applyQuaternion(inverseWorld.get(boneName)).normalize();
    entry.node.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(localAxis, THREE.MathUtils.degToRad(degrees))).normalize();
  };
  const translate = (boneName, worldDelta) => {
    const entry = byName.get(boneName);
    if (!entry) throw new Error(`${name}: missing translated joint ${boneName}`);
    const world = entry.node.getWorldPosition(new THREE.Vector3()).add(worldDelta);
    entry.node.position.copy(entry.node.parent.worldToLocal(world));
  };
  for (const time of times) {
    restore(base, object);
    animate({ t: time / duration, rotate, translate, byName });
    object.updateMatrixWorld(true);
    for (const entry of nodes) {
      const sample = samples.get(entry.node.name);
      sample.p.push(...entry.node.position.toArray());
      sample.q.push(...entry.node.quaternion.toArray());
      sample.s.push(...entry.node.scale.toArray());
    }
  }
  const tracks = [];
  for (const entry of nodes) {
    const sample = samples.get(entry.node.name);
    tracks.push(new THREE.VectorKeyframeTrack(`${entry.node.name}.position`, times, sample.p));
    tracks.push(new THREE.QuaternionKeyframeTrack(`${entry.node.name}.quaternion`, times, sample.q));
    tracks.push(new THREE.VectorKeyframeTrack(`${entry.node.name}.scale`, times, sample.s));
  }
  mixer.stopAllAction();
  restore(original, object);
  const clip = new THREE.AnimationClip(name, duration, tracks);
  clip.userData = { authored: true, sourcePose: 'Idle:0', supportPoseHeld: true, ...options };
  return clip;
}

function addJoint(object, mesh, name, parentName, meshPivot) {
  const parent = object.getObjectByName(parentName);
  if (!parent?.isBone) throw new Error(`Cannot attach ${name}: no bone ${parentName}`);
  const bone = new THREE.Bone();
  bone.name = name;
  parent.add(bone);
  bone.position.copy(parent.worldToLocal(mesh.localToWorld(meshPivot.clone())));
  bone.updateMatrix();
  object.updateMatrixWorld(true);
  const skeletons = new Set();
  object.traverse(node => { if (node.isSkinnedMesh && node.skeleton.bones.includes(parent)) skeletons.add(node.skeleton); });
  for (const skeleton of skeletons) {
    const parentIndex = skeleton.bones.indexOf(parent);
    const inverse = bone.matrix.clone().invert().multiply(skeleton.boneInverses[parentIndex]);
    skeleton.bones.push(bone);
    skeleton.boneInverses.push(inverse);
    skeleton.boneMatrices = new Float32Array(skeleton.bones.length * 16);
    if (skeleton.boneTexture) { skeleton.boneTexture.dispose(); skeleton.boneTexture = null; }
  }
  return bone;
}

function reweight(mesh, bone, weightFor) {
  const index = mesh.skeleton.bones.indexOf(bone);
  const joints = mesh.geometry.attributes.skinIndex;
  const weights = mesh.geometry.attributes.skinWeight;
  const position = mesh.geometry.attributes.position;
  let affected = 0;
  for (let i = 0; i < position.count; i++) {
    const amount = THREE.MathUtils.clamp(weightFor(i, new THREE.Vector3().fromBufferAttribute(position, i)), 0, 1);
    if (amount <= 0) continue;
    const original = Array.from({ length: 4 }, (_, c) => ({ joint: joints.getComponent(i, c), weight: weights.getComponent(i, c) * (1 - amount) }));
    original.push({ joint: index, weight: amount });
    original.sort((a, b) => b.weight - a.weight);
    const kept = original.slice(0, 4);
    const sum = kept.reduce((total, entry) => total + entry.weight, 0);
    for (let c = 0; c < 4; c++) {
      joints.setComponent(i, c, kept[c].joint);
      weights.setComponent(i, c, kept[c].weight / sum);
    }
    affected++;
  }
  joints.needsUpdate = weights.needsUpdate = true;
  return affected;
}

export function articulateSourceMesh(object, id) {
  const report = [], joints = {};
  let mesh;
  object.traverse(node => { if (!mesh && node.isSkinnedMesh) mesh = node; });
  if (!mesh) throw new Error(`${id}: no source skinned body`);
  object.updateMatrixWorld(true);
  if (id === 'quarry_snail') {
    const shell = addJoint(object, mesh, 'Snail_RigidShell', 'Bone001', new THREE.Vector3(-4.7, 4.5, 20.6));
    report.push({ role: 'rigid shell', joint: shell.name, vertices: reweight(mesh, shell, i => i < 579 ? 1 : 0), sourceComponent: 'vertices 0..578' });
    for (const [label, pivot, left] of [['Left', [-6.01914, -41.76808, 11.16222], true], ['Right', [7.20044, -41.76808, 11.16222], false]]) {
      const eye = addJoint(object, mesh, `Snail_Eye${label}`, 'Bone008', new THREE.Vector3(...pivot));
      report.push({ role: `${label.toLowerCase()} eye stalk`, joint: eye.name, vertices: reweight(mesh, eye, (i, p) => i >= 579 && p.z > 15 && (left ? p.x < 0.59065 : p.x > 0.59065) ? 1 : 0) });
    }
    report.push({ role: 'shell and soft-foot sculpture', ...refineSnail(mesh) });
  } else if (id === 'kiln_salamander') {
    const jaw = addJoint(object, mesh, 'Salamander_LowerJaw', 'FireSalamander_Neck_TopSHJnt', new THREE.Vector3(0, 4.62016, 10.12667));
    report.push({ role: 'lower jaw and throat', joint: jaw.name, ...splitSalamanderMouth(mesh, jaw), articulation: 'source lip split into independent upper and lower surfaces, with skinned interior roof and floor' });
  } else if (id === 'reedbank_goose') {
    report.push(...fittedGooseWings(object, mesh, addJoint));
  }
  return { report, joints };
}

export function authorMissingMotions(object, sourceClips, id, articulation) {
  const idle = sourceClips.find(clip => clip.name === 'Idle');
  if (!idle) throw new Error(`${id}: no Idle source pose`);
  const result = [];
  if (id === 'reedjaw_crocodile') {
    for (const [name, side] of [['Hit', 0], ['HitLeft', -1], ['HitRight', 1]]) {
      result.push(author(object, idle, name, 0.64, ({ t, rotate }) => {
        const p = [0, 0.12, 0.28, 0.56, 1];
        const shock = curve(p, [0, 1, 0.85, -0.18, 0], t);
        const recoil = curve(p, [0, 1, 0.72, -0.1, 0], t);
        rotate('Crocodile_Neck_01SHJnt', 'x', -8 * recoil);
        rotate('Crocodile_Neck_02SHJnt', 'x', -9 * recoil);
        rotate('Crocodile_Neck_TopSHJnt', 'y', (side || 0.25) * 17 * shock);
        rotate('Crocodile_Head_JawSHJnt', 'x', 10 * shock);
        for (let i = 1; i <= 5; i++) rotate(`Crocodile_Tail_01_0${i}SHJnt`, 'y', -(side || 0.4) * 5 * shock);
      }, { description: 'Articulated neck recoil and tail counterbalance; four planted source feet.' }));
    }
    return result;
  }
  if (id === 'kiln_salamander') {
    result.push(author(object, idle, 'Attack', 1.08, ({ t, rotate, translate }) => {
      const p = [0, 0.16, 0.32, 0.43, 0.53, 0.72, 1];
      const throat = curve(p, [0, -4, -26, -4, 7, -3, 0], t);
      rotate('FireSalamander_Neck_01SHJnt', 'x', throat * 0.7);
      rotate('FireSalamander_Neck_02SHJnt', 'x', throat * 0.55);
      rotate('FireSalamander_Neck_TopSHJnt', 'x', -throat * 0.3);
      rotate('Salamander_LowerJaw', 'x', curve(p, [0, 3, 21, 18, 4, 1, 0], t));
      translate('FireSalamander_Neck_01SHJnt', new THREE.Vector3(0, 0, curve(p, [0, -.006, -.012, .016, .010, -.003, 0], t)));
      for (let i = 1; i <= 5; i++) rotate(`FireSalamander_Tail_01_0${i}SHJnt`, 'y', curve(p, [0, -1, -3, 3, 4, -1, 0], t));
    }, { contactNormalized: 0.43, description: 'Brace, expose throat, snap head forward at spit contact, recover; fixed limb support.' }));
    for (const [name, side] of [['Hit', 0], ['HitLeft', -1], ['HitRight', 1]]) {
      result.push(author(object, idle, name, 0.63, ({ t, rotate }) => {
        const p = [0, 0.15, 0.33, 0.62, 1];
        const r = curve(p, [0, 1, 0.8, -0.13, 0], t);
        rotate('FireSalamander_Neck_01SHJnt', 'x', -12 * r);
        rotate('FireSalamander_Neck_02SHJnt', 'x', -8 * r);
        rotate('FireSalamander_Neck_TopSHJnt', 'y', (side || 0.2) * 22 * r);
        rotate('Salamander_LowerJaw', 'x', 6 * r);
        for (let i = 1; i <= 5; i++) rotate(`FireSalamander_Tail_01_0${i}SHJnt`, 'y', -(side || 0.3) * (6 - i * 0.5) * r);
      }));
    }
  } else if (id === 'reedbank_goose') {
    result.push(author(object, idle, 'Attack', 1.14, ({ t, rotate }) => {
      const p = [0, 0.18, 0.32, 0.46, 0.56, 0.78, 1];
      const strike = curve(p, [0, -7, -11, 15, 10, -3, 0], t);
      for (const name of ['Bone006', 'Bone007', 'Bone008']) rotate(name, 'x', strike);
      for (const name of ['Bone009', 'Bone010', 'Bone011']) rotate(name, 'x', -strike * 0.45);
      rotate('Bone014', 'x', strike * 0.65);
      rotate('Bone023', 'x', curve(p, [0, 9, 15, 5, 0, 1, 0], t));
      const flare = curve(p, [0, 46, 58, 44, 36, 12, 0], t);
      rotate('Goose_WingLeft', 'y', -flare); rotate('Goose_WingRight', 'y', flare);
      rotate('Goose_WingLeft', 'z', flare * 0.3); rotate('Goose_WingRight', 'z', -flare * 0.3);
      rotate('Goose_WristLeft', 'y', -flare * 0.28); rotate('Goose_WristRight', 'y', flare * 0.28);
    }, { contactNormalized: 0.46, description: 'Raised bill warning and articulated feather flare, forward neck peck, planted webbed feet.' }));
    for (const [name, side] of [['Hit', 0], ['HitLeft', -1], ['HitRight', 1]]) {
      result.push(author(object, idle, name, 0.65, ({ t, rotate }) => {
        const r = curve([0, 0.14, 0.3, 0.62, 1], [0, 1, 0.8, -0.12, 0], t);
        for (const bone of ['Bone007', 'Bone008', 'Bone009']) {
          rotate(bone, 'x', -9 * r);
          rotate(bone, 'z', (side || 0.15) * 7 * r);
        }
        rotate('Bone014', 'x', 11 * r);
        rotate('Goose_WingLeft', 'y', -(side > 0 ? 12 : 28) * r);
        rotate('Goose_WingRight', 'y', (side < 0 ? 12 : 28) * r);
      }));
    }
  } else if (id === 'quarry_snail') {
    result.push(author(object, idle, 'Attack', 1.5, ({ t, rotate, translate }) => {
      const p = [0, 0.18, 0.32, 0.48, 0.62, 0.8, 1];
      const extend = curve(p, [0, -0.025, -0.032, 0.038, 0.02, -0.004, 0], t);
      translate('Bone007', new THREE.Vector3(0, 0, extend));
      rotate('Bone007', 'x', curve(p, [0, -10, -14, 9, 5, -2, 0], t));
      rotate('Bone008', 'x', curve(p, [0, 8, 12, -10, -5, 1, 0], t));
      rotate('Snail_EyeLeft', 'x', curve(p, [0, 33, 42, -9, -4, 5, 0], t));
      rotate('Snail_EyeRight', 'x', curve(p, [0, 30, 38, -7, -3, 4, 0], t));
    }, { contactNormalized: 0.48, description: 'Retract eye stalks and neck under rigid shell, emerge into short forward rasp, recover.' }));
    result.push(author(object, idle, 'Run', 2.6, ({ t, rotate, translate }) => {
      const envelope = Math.sin(Math.PI * t) ** 2;
      for (let i = 2; i <= 6; i++) {
        const phase = t * Math.PI * 4 - (i - 2) * 0.95;
        translate(`Bone00${i}`, new THREE.Vector3(0, 0, Math.sin(phase) * 0.018 * envelope));
        rotate(`Bone00${i}`, 'y', Math.sin(phase + 0.45) * 2 * envelope);
      }
      translate('Bone007', new THREE.Vector3(0, 0, (0.017 + Math.sin(t * Math.PI * 4) * 0.009) * envelope));
      rotate('Bone008', 'x', -5 * envelope);
      rotate('Snail_EyeLeft', 'y', Math.sin(t * Math.PI * 4) * 5 * envelope);
      rotate('Snail_EyeRight', 'y', -Math.sin(t * Math.PI * 4) * 5 * envelope);
    }, { description: 'Two traveling contractions along the soft foot; steady rigid shell and extended head. Newly authored cycle, not retimed Walk.' }));
    for (const [name, side] of [['Hit', 0], ['HitLeft', -1], ['HitRight', 1]]) {
      result.push(author(object, idle, name, 0.9, ({ t, rotate, translate }) => {
        const r = curve([0, 0.13, 0.32, 0.66, 1], [0, 1, 0.88, 0.15, 0], t);
        translate('Bone007', new THREE.Vector3((side || 0) * 0.018 * r, 0, -0.045 * r));
        rotate('Bone007', 'y', (side || 0.15) * 15 * r);
        rotate('Bone008', 'x', -10 * r);
        rotate('Snail_EyeLeft', 'x', 43 * r);
        rotate('Snail_EyeRight', 'x', 43 * r);
        rotate('Snail_EyeLeft', 'y', (side || 0.3) * 15 * r);
        rotate('Snail_EyeRight', 'y', (side || -0.3) * 15 * r);
      }));
    }
  }
  return result;
}
