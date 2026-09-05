import * as THREE from 'three';
import { SPECIES, buildSpecies } from '../birds.mjs';
import { birdProfiles } from './profiles.mjs';

// Focused source-model diagnostics. Production browser acceptance is root-owned.
for (const id of SPECIES) {
  const { object, clips } = await buildSpecies(id), p = birdProfiles[id];
  let mesh; object.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
  const summary = { id, triangles: mesh.geometry.index.count / 3, uvCount: mesh.geometry.attributes.uv.count, bones: mesh.skeleton.bones.length, clips: {} };
  for (const clip of clips) {
    const mixer = new THREE.AnimationMixer(object), action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
    const bounds = new THREE.Box3(), q = new THREE.Vector3();
    let maxStanceError = 0, minY = Infinity;
    for (let frame = 0; frame <= 40; frame++) {
      const u = frame / 40; mixer.setTime(clip.duration * u); object.updateMatrixWorld(true); mesh.skeleton.update();
      for (let j = 0; j < mesh.geometry.attributes.position.count; j++) {
        q.fromBufferAttribute(mesh.geometry.attributes.position, j); mesh.applyBoneTransform(j, q); bounds.expandByPoint(q); minY = Math.min(minY, q.y);
      }
      if (clip.name === 'Walk' || clip.name === 'Run') for (const side of [-1, 1]) {
        const run = clip.name === 'Run', phase = (u + (side > 0 ? .5 : 0)) % 1, stance = run ? .51 : .64;
        if (phase >= stance) continue;
        const stride = (run ? p.runMps : p.walkMps) * clip.duration * stance;
        const wanted = new THREE.Vector3(side * p.legX, p.ankle[0], p.ankle[1] + stride * (.5 - phase / stance));
        const bone = mesh.skeleton.bones.find(b => b.name === (side < 0 ? 'FootL' : 'FootR'));
        maxStanceError = Math.max(maxStanceError, bone.getWorldPosition(new THREE.Vector3()).distanceTo(wanted));
      }
    }
    summary.clips[clip.name] = { minY: +minY.toFixed(4), maxStanceError: +maxStanceError.toFixed(5), bounds: { min: bounds.min.toArray().map(n => +n.toFixed(3)), max: bounds.max.toArray().map(n => +n.toFixed(3)) } };
    mixer.stopAllAction(); mixer.uncacheRoot(object);
  }
  console.log(JSON.stringify(summary));
}
