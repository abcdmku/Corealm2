import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

export async function loadFbx(url) {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((resource) => /\.(png|jpe?g|tga|bmp)$/i.test(resource)
    ? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' : resource);
  const root = await new FBXLoader(manager).loadAsync(url);
  const helpers = [];
  root.traverse(node => { if (node.isLine || node.isPoints || node.isCamera || node.isLight) helpers.push(node); });
  for (const node of helpers) node.removeFromParent();
  return root;
}

export async function texture(url, color = true) {
  const map = await new THREE.TextureLoader().loadAsync(url);
  map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.flipY = true;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return map;
}

export function closeLoop(clip) {
  for (const track of clip.tracks) {
    const width = track.getValueSize();
    if (track.times.length < 2) continue;
    // All three authored looping takes include a closing key. Enforce exact
    // float equality at the existing endpoint, retaining their source cadence.
    for (let j = 0; j < width; j++) track.values[track.values.length - width + j] = track.values[j];
  }
  return clip;
}

export function cleanClip(source, name, root, rootBone) {
  const clip = source.clone();
  clip.name = name;
  const deforming = new Set();
  root.traverse(node => {
    if (!node.isMesh) return;
    deforming.add(node.name);
    for (const bone of node.skeleton?.bones ?? []) deforming.add(bone.name);
  });
  clip.tracks = clip.tracks.filter(track => deforming.has(track.name.split('.')[0]));
  for (const track of clip.tracks) {
    if (track.name !== `${rootBone.name}.position`) continue;
    for (let i = 0; i < track.values.length; i += 3) {
      track.values[i] = rootBone.position.x;
      track.values[i + 2] = rootBone.position.z;
    }
  }
  if (['Idle', 'Walk', 'Run'].includes(name)) closeLoop(clip);
  return clip;
}

export function directionalHit(source, name, bones, side) {
  const clip = source.clone();
  clip.name = name;
  for (const [bone, axis, degrees] of bones) {
    const original = clip.tracks.find(track => track.name === `${bone}.quaternion`);
    if (!original) continue;
    const interpolant = original.createInterpolant();
    const times = [], values = [];
    const samples = Math.max(20, Math.ceil(clip.duration * 60));
    for (let i = 0; i <= samples; i++) {
      const t = clip.duration * i / samples;
      const envelope = Math.pow(Math.sin(Math.PI * i / samples), 2);
      const q = new THREE.Quaternion().fromArray(interpolant.evaluate(t));
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis), side * degrees * Math.PI / 180 * envelope));
      times.push(t); values.push(...q.toArray());
    }
    clip.tracks[clip.tracks.indexOf(original)] = new THREE.QuaternionKeyframeTrack(original.name, times, values);
  }
  return clip;
}

export function measureStance(root, clip, feet) {
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip); action.play();
  const samples = new Map(feet.map(name => [name, []]));
  const count = 240;
  for (let i = 0; i <= count; i++) {
    mixer.setTime(clip.duration * i / count); root.updateMatrixWorld(true);
    for (const [name, points] of samples) {
      const bone = root.getObjectByName(name);
      if (!bone) throw new Error(`Missing contact bone ${name}`);
      points.push(bone.getWorldPosition(new THREE.Vector3()));
    }
  }
  mixer.stopAllAction(); mixer.uncacheRoot(root);
  const velocities = [], contacts = [];
  const median = values => values.length ? values[Math.floor(values.length / 2)] : 0;
  for (const [bone, points] of samples) {
    const low = Math.min(...points.map(point => point.y)), high = Math.max(...points.map(point => point.y));
    // Evaluate each sole separately: a forepaw joint can sit higher inside its
    // thick pad than a rear toe, even while both surfaces touch the same plane.
    const window = Math.max(.008, Math.min(.04, (high-low)*.12));
    const speeds = [];
    for (let i = 1; i < points.length; i++) {
      const speed = (points[i-1].z-points[i].z) / (clip.duration/count);
      if ((points[i].y+points[i-1].y)/2 <= low+window && speed > .05) speeds.push(speed);
    }
    speeds.sort((a,b)=>a-b); velocities.push(...speeds);
    contacts.push({bone,samples:speeds.length,stanceMps:median(speeds),heightWindowM:window});
  }
  velocities.sort((a,b)=>a-b);
  return {mps:median(velocities),contacts,method:'Median backward speed at 240 phase samples, named sole joints within their lowest 12% vertical range, 8-40 mm window.'};
}

export function preventFloorPenetration(object, clips, rootBoneName) {
  const rootBone = object.getObjectByName(rootBoneName);
  const corrections = [];
  for (const clip of clips) {
    const original = clip.tracks.find(track => track.name === `${rootBoneName}.position`);
    if (!original) throw new Error(`Missing root channel for grounding ${clip.name}`);
    const interpolant = original.createInterpolant();
    const mixer = new THREE.AnimationMixer(object);
    const action = mixer.clipAction(clip); action.setLoop(THREE.LoopOnce,1); action.clampWhenFinished=true; action.play();
    const times = [], values = []; let maxCorrection = 0;
    const frames = Math.ceil(clip.duration*240);
    for (let i=0;i<=frames;i++) {
      const t=clip.duration*i/frames;
      mixer.setTime(t); object.updateMatrixWorld(true);
      const minimum = new THREE.Box3().setFromObject(object,true).min.y;
      const correction = minimum < 0 ? -minimum+.001 : 0;
      const local = new THREE.Vector3().fromArray(interpolant.evaluate(t));
      const base = rootBone.parent.localToWorld(local.clone());
      base.y += correction;
      rootBone.parent.worldToLocal(base);
      times.push(t); values.push(...base.toArray()); maxCorrection=Math.max(maxCorrection,correction);
    }
    mixer.stopAllAction(); mixer.uncacheRoot(object);
    clip.tracks[clip.tracks.indexOf(original)] = new THREE.VectorKeyframeTrack(original.name,times,values);
    if(['Idle','Walk','Run'].includes(clip.name)) closeLoop(clip);
    corrections.push({name:clip.name,maxLiftM:maxCorrection});
  }
  return corrections;
}

export function groundObject(root, clips, scale, pivotBone) {
  const object = new THREE.Group(); object.name = 'creature_import';
  object.add(root); object.scale.setScalar(scale);
  root.animations = [];
  const mixer = new THREE.AnimationMixer(object);
  mixer.clipAction(clips.find(clip => clip.name === 'Idle')).play(); mixer.setTime(0);
  object.updateMatrixWorld(true);
  const pivot = root.getObjectByName(pivotBone).getWorldPosition(new THREE.Vector3());
  const box = new THREE.Box3().setFromObject(object, true);
  object.position.set(-pivot.x, -box.min.y, -pivot.z);
  mixer.stopAllAction(); mixer.uncacheRoot(object);
  object.updateMatrixWorld(true);
  return object;
}
