import * as THREE from 'three';

const AXIS_Y = new THREE.Vector3(0, 1, 0);

function point(node) { return node.getWorldPosition(new THREE.Vector3()); }

function aimBone(bone, child, targetDirection) {
  bone.updateWorldMatrix(true, true);
  const current = point(child).sub(point(bone)).normalize();
  const rotation = new THREE.Quaternion().setFromUnitVectors(current, targetDirection.clone().normalize());
  const world = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(rotation);
  const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parent.invert().multiply(world)).normalize();
  bone.updateWorldMatrix(true, true);
}

function solveLeg(hip, knee, ankle, target, ankleQuaternion) {
  const origin = point(hip);
  const first = origin.distanceTo(point(knee));
  const second = point(knee).distanceTo(point(ankle));
  const direction = target.clone().sub(origin);
  const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(first - second) + 0.0001, first + second - 0.0001);
  direction.normalize();
  const bend = new THREE.Vector3(0, 0, 1).addScaledVector(direction, -direction.z).normalize();
  const cosine = THREE.MathUtils.clamp((first * first + distance * distance - second * second) / (2 * first * distance), -1, 1);
  const desiredKnee = origin.clone().addScaledVector(direction, first * cosine).addScaledVector(bend, first * Math.sqrt(1 - cosine * cosine));
  aimBone(hip, knee, desiredKnee.sub(origin));
  aimBone(knee, ankle, target.clone().sub(point(knee)));
  const parent = ankle.parent.getWorldQuaternion(new THREE.Quaternion());
  ankle.quaternion.copy(parent.invert().multiply(ankleQuaternion));
  ankle.updateWorldMatrix(true, true);
}

function footCycle(phase, stride, lift, support) {
  if (phase < support) return { z: stride * (0.5 - phase / support), y: 0 };
  const swing = (phase - support) / (1 - support);
  return { z: -stride * 0.5 + stride * (0.5 - 0.5 * Math.cos(Math.PI * swing)), y: lift * Math.sin(Math.PI * swing) };
}

function minimumSkinY(object, meshes) {
  object.updateMatrixWorld(true);
  const vertex = new THREE.Vector3();
  let minimum = Infinity;
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld);
      minimum = Math.min(minimum, vertex.y);
    }
  }
  return minimum;
}

/** The package's locomotion hovers. Keep its upper body, then author ground contacts. */
export function groundMantisAnimations(object, sourceClips) {
  object.updateMatrixWorld(true);
  const bind = new Map();
  const nodes = [];
  const meshes = [];
  object.traverse((node) => {
    if (node.isMesh) meshes.push(node);
    if (!node.isBone && node.name !== 'root') return;
    nodes.push(node);
    bind.set(node.name, { position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(), worldQuaternion: node.getWorldQuaternion(new THREE.Quaternion()) });
  });
  const root = object.getObjectByName('root');
  const pelvis = object.getObjectByName('rootx');
  const legs = ['l', 'r'].map((side) => ({
    side, hip: object.getObjectByName(`thigh_stretch${side}`), knee: object.getObjectByName(`leg_stretch${side}`),
    ankle: object.getObjectByName(`foot${side}`), toes: object.getObjectByName(`toes_01${side}`),
    contact: point(object.getObjectByName(`foot${side}`)),
  }));
  const wingParents = new Map();
  for (const side of ['l', 'r']) for (const layer of ['001', '002']) {
    const shoulder = object.getObjectByName(`shoulder_dupli_${layer}${side}`);
    wingParents.set(shoulder.name, shoulder.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
  }
  const lowerNames = /^(?:thigh_|leg_|foot[lr]$|toes_)/;
  const wingNames = /_dupli_00[12][lr]$/;
  const result = [];
  for (const source of sourceClips) {
    const mixer = new THREE.AnimationMixer(object);
    const action = mixer.clipAction(source);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const frames = Math.ceil(source.duration * 60);
    const times = Array.from({ length: frames + 1 }, (_, i) => i * source.duration / frames);
    const samples = new Map(nodes.map((node) => [node.name, { position: [], quaternion: [], scale: [] }]));
    for (const time of times) {
      mixer.setTime(time);
      root.position.set(0, 0, 0);
      const phase = time / source.duration;
      const gait = source.name === 'Walk' || source.name === 'Run';
      const run = source.name === 'Run';
      if (source.name !== 'Death') {
        for (const node of nodes) if (lowerNames.test(node.name)) {
          const saved = bind.get(node.name);
          node.position.copy(saved.position);
          node.quaternion.copy(saved.quaternion);
          node.scale.copy(saved.scale);
        }
        pelvis.position.copy(bind.get(pelvis.name).position);
        pelvis.position.y = (gait ? (run ? 0.78 : 0.87) : 0.90) * 100;
        pelvis.position.y += (gait ? 1.5 * Math.cos(phase * Math.PI * 4) : 0.7 * Math.sin(phase * Math.PI * 2));
        pelvis.quaternion.copy(bind.get(pelvis.name).quaternion);
        if (gait) pelvis.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_Y, Math.sin(phase * Math.PI * 2) * 0.045));
        object.updateMatrixWorld(true);
        for (const leg of legs) {
          const cycle = gait ? footCycle((phase + (leg.side === 'l' ? 0 : 0.5)) % 1, run ? 1.02 : 0.70, run ? 0.16 : 0.10, run ? 0.54 : 0.61) : { y: 0, z: 0 };
          const target = leg.contact.clone();
          target.y += cycle.y;
          target.z += cycle.z;
          solveLeg(leg.hip, leg.knee, leg.ankle, target, bind.get(leg.ankle.name).worldQuaternion);
        }
      }
      // Fold both wing pairs down the back. Their parent rotation still follows
      // torso recoil and collapse, so the tucked wings travel with the shell.
      for (const node of nodes) if (wingNames.test(node.name)) {
        const saved = bind.get(node.name);
        node.position.copy(saved.position);
        node.quaternion.copy(saved.quaternion);
        node.scale.copy(saved.scale);
      }
      object.updateMatrixWorld(true);
      for (const side of ['l', 'r']) for (const layer of ['001', '002']) {
        const sign = side === 'l' ? 1 : -1;
        const shoulder = object.getObjectByName(`shoulder_dupli_${layer}${side}`);
        const arm = object.getObjectByName(`arm_stretch_dupli_${layer}${side}`);
        const forearm = object.getObjectByName(`forearm_stretch_dupli_${layer}${side}`);
        const hand = object.getObjectByName(`hand_dupli_${layer}${side}`);
        const torsoDelta = shoulder.parent.getWorldQuaternion(new THREE.Quaternion()).multiply(wingParents.get(shoulder.name));
        const outward = layer === '001' ? 0.09 : 0.24;
        const direction = (x, y, z) => new THREE.Vector3(x * sign, y, z).applyQuaternion(torsoDelta);
        aimBone(shoulder, arm, direction(outward, -0.65, -0.4));
        aimBone(arm, forearm, direction(outward * 0.6, -0.95, -0.12));
        aimBone(forearm, hand, direction(outward * 0.3, -0.98, 0.10));
      }
      root.position.y -= minimumSkinY(object, meshes) / object.scale.y;
      object.updateMatrixWorld(true);
      for (const node of nodes) {
        const row = samples.get(node.name);
        row.position.push(...node.position.toArray());
        row.quaternion.push(...node.quaternion.toArray());
        row.scale.push(...node.scale.toArray());
      }
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(object);
    const tracks = [];
    for (const node of nodes) {
      const row = samples.get(node.name);
      tracks.push(new THREE.VectorKeyframeTrack(`${node.name}.position`, times, row.position).optimize());
      tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, row.quaternion).optimize());
      tracks.push(new THREE.VectorKeyframeTrack(`${node.name}.scale`, times, row.scale).optimize());
    }
    const clip = new THREE.AnimationClip(source.name, source.duration, tracks);
    clip.userData = { ...source.userData, groundAdaptation: 'Folded source wing rig; authored grounded two-bone leg IK and foot contact curves; in-place source upper-body motion.' };
    result.push(clip);
  }
  for (const node of nodes) {
    const saved = bind.get(node.name);
    node.position.copy(saved.position);
    node.quaternion.copy(saved.quaternion);
    node.scale.copy(saved.scale);
  }
  object.updateMatrixWorld(true);
  return result;
}
