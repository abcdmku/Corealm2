import * as THREE from 'three';
import { splitSalamanderMouth } from './salamander-mouth.mjs';
import { refineSnail } from './refine-snail.mjs';
import { gooseWings as fittedGooseWings } from './goose-wings.mjs';

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
