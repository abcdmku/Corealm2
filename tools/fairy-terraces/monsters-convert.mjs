import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { loadFbx, texture, cleanClip, closeLoop, groundObject, measureStance } from '../creature-expansion/monsters/common.mjs';
import { convertMantisUnityAnimation } from '../creature-expansion/monsters/mantis.mjs';

const verbs = [['Idle', 'Idle'], ['Walk', 'Walk'], ['Run', 'Run'], ['Attack', 'Attack01'], ['Hit', 'GetHit'], ['Death', 'Die']];

function rootJoint(root) {
  return root.getObjectByName('rootx') ?? root.getObjectByName('root') ?? (() => {
    let found;
    root.traverse(n => { if (!found && n.isBone && !n.parent?.isBone) found = n; });
    if (!found) throw new Error('Missing root skeleton joint');
    return found;
  })();
}

/** The free-trial package has only Idle and Walk. These are new, explicitly authored reactions. */
function trialCombat(idle, root, pivot, name) {
  const duration = { Attack: 1.1, Hit: .48, Death: 1.5 }[name];
  const frames = Math.ceil(duration * 30), tracks = [];
  const bones = [];
  root.traverse(n => { if (n.isBone) bones.push(n); });
  const torso = bones.filter(n => /spine|chest|neck|head|arm|hand/i.test(n.name));
  const choose = torso.length ? torso : [pivot];
  for (const track of idle.tracks) {
    const width = track.getValueSize();
    const values = [], times = [];
    const initial = Array.from(track.values.slice(0, width));
    const nodeName = track.name.split('.')[0];
    const node = root.getObjectByName(nodeName);
    for (let i = 0; i <= frames; i++) {
      const phase = i / frames;
      const envelope = name === 'Death' ? phase * phase * (3 - 2 * phase)
        : Math.sin(Math.PI * phase) ** 2;
      const value = initial.slice();
      if (track.name.endsWith('.quaternion') && choose.includes(node)) {
        const factor = /arm|hand/i.test(nodeName) ? 1.2 : .45;
        const turn = name === 'Attack' ? factor : name === 'Hit' ? -.4 : .95;
        new THREE.Quaternion().fromArray(value).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), envelope * turn)).toArray(value);
      }
      if (track.name === `${pivot.name}.quaternion` && name === 'Death') {
        new THREE.Quaternion().fromArray(value).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), envelope * 1.3)).toArray(value);
      }
      times.push(phase * duration); values.push(...value);
    }
    const Type = track.name.endsWith('.quaternion') ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    tracks.push(new Type(track.name, times, values).optimize());
  }
  return new THREE.AnimationClip(name, duration, tracks);
}

function sealFloor(object, clips, pivot) {
  const saved = [];
  object.traverse(node => saved.push([node, node.position.clone(), node.quaternion.clone(), node.scale.clone()]));
  const restore = () => { for (const [n, p, q, s] of saved) { n.position.copy(p); n.quaternion.copy(q); n.scale.copy(s); } object.updateMatrixWorld(true); };
  const reports = [];
  for (const clip of clips) {
    restore();
    let track = clip.tracks.find(t => t.name === `${pivot.name}.position`);
    if (!track) { track = new THREE.VectorKeyframeTrack(`${pivot.name}.position`, [0, clip.duration], [...pivot.position.toArray(), ...pivot.position.toArray()]); clip.tracks.push(track); }
    const interpolate = track.createInterpolant(), times = [], values = [];
    const mixer = new THREE.AnimationMixer(object), action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
    const frames = Math.ceil(clip.duration * 60); let maxLift = 0;
    for (let i = 0; i <= frames; i++) {
      const time = clip.duration * i / frames;
      mixer.setTime(time); object.updateMatrixWorld(true);
      const minimum = new THREE.Box3().setFromObject(object, true).min.y;
      const lift = Math.max(0, .016 - minimum);
      const local = new THREE.Vector3().fromArray(interpolate.evaluate(time));
      const world = pivot.parent.localToWorld(local.clone()); world.y += lift; pivot.parent.worldToLocal(world);
      times.push(time); values.push(...world.toArray()); maxLift = Math.max(maxLift, lift);
    }
    mixer.stopAllAction(); mixer.uncacheRoot(object);
    clip.tracks[clip.tracks.indexOf(track)] = new THREE.VectorKeyframeTrack(track.name, times, values);
    if (['Idle', 'Walk', 'Run'].includes(clip.name)) closeLoop(clip);
    reports.push({ name: clip.name, maximumGroundCorrectionM: maxLift });
  }
  restore(); return reports;
}

window.convertFairyMonster = async function(spec) {
  const root = await loadFbx(spec.model);
  const pivot = rootJoint(root);
  const atlas = await texture(spec.texture);
  atlas.name = `${spec.id}_source_albedo`;
  const material = new THREE.MeshStandardMaterial({name: `animal_${spec.id}_source`, map: atlas, roughness: .78, metalness: 0});
  root.traverse(n => { if (n.isMesh) { n.material = material; n.frustumCulled = false; if (n.isSkinnedMesh) n.normalizeSkinWeights(); } });
  const sourceNames = root.animations.map(c => c.name);
  const chooseTake = suffix => {
    const exact = root.animations.find(c => c.name === `Monster${spec.number}_${suffix}_InPlace`) ?? root.animations.find(c => c.name === `Monster${spec.number}_${suffix}`);
    if (!exact) throw new Error(`${spec.id} missing authored ${suffix}; available ${sourceNames.join(', ')}`);
    return exact;
  };
  let clips;
  if (spec.animationBase) {
    clips = [];
    for (const [name, suffix] of verbs) {
      const response = await fetch(`${spec.animationBase}/Monster${spec.number}_${suffix}.anim`);
      if (!response.ok) throw new Error(`${spec.id} missing ${suffix} source animation`);
      const clip = convertMantisUnityAnimation(await response.text(), root, name);
      if (['Idle', 'Walk', 'Run'].includes(name)) closeLoop(clip);
      clips.push(clip);
    }
  } else if (spec.trial) {
    clips = ['Idle', 'Walk'].map(name => cleanClip(chooseTake(name), name, root, pivot));
    const run = clips[1].clone(); run.name = 'Run'; clips.push(run);
    for (const name of ['Attack', 'Hit', 'Death']) clips.push(trialCombat(clips[0], root, pivot, name));
  } else clips = verbs.map(([name, suffix]) => cleanClip(chooseTake(suffix), name, root, pivot));
  // FBX stores displacement on the wrapper root as well as the pelvis on some bodies.
  // Simulation owns travel, so neither horizontal channel may move the drawn root away.
  for (const clip of clips) for (const name of ['root', pivot.name]) {
    const node = root.getObjectByName(name), track = clip.tracks.find(t => t.name === `${name}.position`);
    if (!node || !track) continue;
    for(let i=0;i<track.values.length;i+=3) {track.values[i]=node.position.x;track.values[i+2]=node.position.z;}
  }
  const object = groundObject(root, clips, .01, pivot.name); object.name = spec.id;
  if (spec.trial) {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object, true), height = box.max.y - box.min.y;
    const desired = spec.number === '27' || spec.number === '30' ? 1.45 : .95;
    const factor = desired / height;
    object.scale.multiplyScalar(factor); object.position.multiplyScalar(factor);
  }
  const groundCorrections = sealFloor(object, clips, pivot);
  const mixer = new THREE.AnimationMixer(object); mixer.clipAction(clips[0]).play(); mixer.setTime(0); object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object, true); mixer.stopAllAction(); mixer.uncacheRoot(object);
  const feet = [];
  root.traverse(n => { if (n.isBone && /(?:foot[lrx]*|toes_01[lr]|ankle[lrx]*)$/i.test(n.name)) feet.push(n.name); });
  // These three source rigs hover. Their moving toes never define a planted ground stride.
  const hovering = !spec.trial && ['07','08','09'].includes(spec.number);
  const walk = !hovering && feet.length ? measureStance(object, clips.find(c => c.name === 'Walk'), feet) : null;
  const run = !hovering && feet.length ? measureStance(object, clips.find(c => c.name === 'Run'), feet) : null;
  const bytes = await new GLTFExporter().parseAsync(object, {binary:true, animations:clips, onlyVisible:true, maxTextureSize:1024});
  const array = new Uint8Array(bytes); let raw = ''; for(let i=0;i<array.length;i+=32768)raw+=String.fromCharCode(...array.subarray(i,i+32768));
  return { base64: btoa(raw), sourceNames, bounds: {min:box.min.toArray(),max:box.max.toArray()}, rootJoint:pivot.name, groundCorrections,
    walk:walk?.mps ?? null, run:run?.mps ?? null, gaitFootBones:hovering ? [] : feet, clips:clips.map(c=>({name:c.name,seconds:c.duration,tracks:c.tracks.length})),
    modifications:spec.trial ? 'Original body, atlas, Idle and Walk. Run reuses the source Walk. New skeleton attack, recoil and collapse poses authored because this free-trial package has no combat clips. Uniform body size and in-place root travel. Source materials use albedo with scalar roughness; the source packages contain no normal maps.' : 'Original body, atlas and six source gameplay clips; source units converted to metres, horizontal root travel removed, exact loop endpoints and sampled floor correction. Source material uses albedo with scalar roughness; the source packages contain no normal maps.' };
};
