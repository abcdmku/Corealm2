import * as THREE from 'three';

const SOURCE = new URL('../../../test-results/creature-expansion/sources/monsters/nightmare/', import.meta.url);
const PACK = 'raw/Assets/FourEvilDragonsPBR/';
const FPS = 30;
const SCALE = 0.45;
const CLIP_SPECS = [
  ['Idle', 'idle01', 40], ['Walk', 'walk', 40], ['Run', 'run', 30],
  ['Attack', 'Basic Attack', 36], ['Hit', 'getHit', 42], ['Death', 'die', 57],
];
const EMPTY_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';

async function checkedFetch(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Nightmare source unavailable: ${url} (${response.status})`);
  return response;
}

// The FBX reuses thirteen names on its left and right forelimbs. Carry Model IDs
// through Three's parser, then bind by full source ancestry instead of first name.
async function identityLoader() {
  const loaderUrl = import.meta.resolve('three/addons/loaders/FBXLoader.js');
  let code = await (await checkedFetch(loaderUrl)).text();
  const marker = 'tracks = tracks.concat( scope.generateTracks( rawTracks ) );';
  if (!code.includes(marker)) throw new Error('FBXLoader identity hook changed');
  code = code.replace(marker, 'const generated = scope.generateTracks(rawTracks); for (const track of generated) track.sourceNodeId = rawTracks.ID; tracks = tracks.concat(generated);');
  for (const [specifier, resolved] of [
    ['three', import.meta.resolve('three')],
    ['../libs/fflate.module.js', import.meta.resolve('three/addons/libs/fflate.module.js')],
    ['../curves/NURBSCurve.js', import.meta.resolve('three/addons/curves/NURBSCurve.js')],
  ]) code = code.replace(`from '${specifier}'`, `from ${JSON.stringify(resolved)}`);
  const { FBXLoader } = await import(/* @vite-ignore */ `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(() => EMPTY_IMAGE);
  return new FBXLoader(manager);
}

function nodeIdentities(root) {
  const byId = new Map();
  const byPath = new Map();
  root.traverse(node => {
    if (node.ID === undefined) return;
    const parts = [];
    for (let cursor = node; cursor && cursor !== root; cursor = cursor.parent) parts.unshift(cursor.name);
    const identity = parts.join('/');
    if (byPath.has(identity)) throw new Error(`Ambiguous Nightmare source ancestry: ${identity}`);
    byPath.set(identity, node);
    byId.set(node.ID, identity);
  });
  return { byId, byPath };
}

function nameRig(root, identities) {
  const counts = new Map();
  root.traverse(node => counts.set(node.name, (counts.get(node.name) ?? 0) + 1));
  for (const [identity, node] of identities.byPath) {
    if (counts.get(node.name) > 1) node.name = identity.replace(/[^a-zA-Z0-9_]/g, '__');
  }
  root.name = 'Nightmare_source_rig';
}

function cropTrack(track, firstFrame, lastFrame) {
  const start = firstFrame / FPS;
  const end = lastFrame / FPS;
  const times = [start, ...Array.from(track.times).filter(time => time > start + 1e-6 && time < end - 1e-6), end];
  const interpolant = track.createInterpolant();
  const values = times.flatMap(time => Array.from(interpolant.evaluate(time)));
  const result = track.clone();
  result.times = new Float32Array(times.map(time => time - start));
  result.values = new Float32Array(values);
  return result;
}

function importClip(source, rigIdentities, rootBone, name, lastFrame) {
  const take = source.animations.find(candidate => candidate.name === 'Take 001');
  if (!take) throw new Error(`Missing Nightmare Take 001 for ${name}`);
  if (Math.abs(take.duration - lastFrame / FPS) > 0.002) throw new Error(`Unexpected Nightmare ${name} take length: ${take.duration}`);
  const sourceIdentities = nodeIdentities(source);
  const targets = new Set();
  const tracks = take.tracks.map(original => {
    const path = sourceIdentities.byId.get(original.sourceNodeId);
    const target = rigIdentities.byPath.get(path);
    if (!target) throw new Error(`Unbound Nightmare ${name} source node ${original.sourceNodeId}: ${path}`);
    const property = original.name.slice(original.name.lastIndexOf('.') + 1);
    const track = cropTrack(original, 0, lastFrame);
    track.name = `${target.name}.${property}`;
    if (targets.has(track.name)) throw new Error(`Duplicate Nightmare channel: ${name}/${track.name}`);
    targets.add(track.name);
    if (target === rootBone && property === 'position') {
      for (let i = 0; i < track.values.length; i += 3) {
        track.values[i] = rootBone.position.x;
        track.values[i + 2] = rootBone.position.z;
      }
    }
    return track;
  });
  return new THREE.AnimationClip(name, lastFrame / FPS, tracks);
}

function poseSampler(root, clip) {
  const originals = [];
  root.traverse(node => originals.push([node, node.position.clone(), node.quaternion.clone(), node.scale.clone()]));
  const restore = () => originals.forEach(([node, position, quaternion, scale]) => {
    node.position.copy(position); node.quaternion.copy(quaternion); node.scale.copy(scale);
  });
  const channels = clip.tracks.map(track => {
    const dot = track.name.lastIndexOf('.');
    const node = root.getObjectByName(track.name.slice(0, dot));
    if (!node) throw new Error(`Nightmare sampler target missing: ${track.name}`);
    return [node[track.name.slice(dot + 1)], track.createInterpolant()];
  });
  return {
    sample(time) {
      restore();
      for (const [property, interpolant] of channels) property.fromArray(interpolant.evaluate(time));
      root.updateMatrixWorld(true);
    },
    restore() { restore(); root.updateMatrixWorld(true); },
  };
}

function directionalHit(root, source, name, direction) {
  const chest = root.getObjectByName('Chest');
  const neck = root.getObjectByName('Neck01');
  const arms = ['R_UpperArm', 'R_UpperArm1'].map(bone => root.getObjectByName(bone));
  if (!chest || !neck || arms.some(bone => !bone)) throw new Error('Nightmare directional recoil bones missing');
  const changed = [chest, neck, ...arms];
  const channelNames = new Set(changed.flatMap(node => ['position', 'quaternion', 'scale'].map(property => `${node.name}.${property}`)));
  const clip = source.clone();
  clip.name = name;
  clip.tracks = clip.tracks.filter(track => !channelNames.has(track.name));
  const pose = poseSampler(root, source);
  const times = [];
  const channels = new Map(changed.map(node => [node, { position: [], quaternion: [], scale: [] }]));
  const worldUp = new THREE.Vector3(0, 1, 0);
  for (let frame = 0; frame <= 42; frame++) {
    const time = frame / FPS;
    times.push(time);
    pose.sample(time);
    const armWorld = arms.map(arm => arm.matrixWorld.clone());
    const phase = time / source.duration;
    const envelope = phase < 0.22 ? Math.sin(phase / 0.22 * Math.PI / 2) : Math.pow(Math.cos((phase - 0.22) / 0.78 * Math.PI / 2), 2);
    // Source Hit rolls onto its side, so fixed local Y becomes a downward tilt.
    // Convert world up to each current local pose to keep added recoil lateral.
    const chestAxis = worldUp.clone().applyQuaternion(chest.getWorldQuaternion(new THREE.Quaternion()).invert());
    chest.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(chestAxis, direction * THREE.MathUtils.degToRad(9) * envelope));
    root.updateMatrixWorld(true);
    const neckAxis = worldUp.clone().applyQuaternion(neck.getWorldQuaternion(new THREE.Quaternion()).invert());
    neck.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(neckAxis, direction * THREE.MathUtils.degToRad(12) * envelope));
    root.updateMatrixWorld(true);
    // Hold each forelimb's original world transform while its chest parent turns.
    // Hind legs branch from Root and therefore need no compensation.
    arms.forEach((arm, index) => {
      new THREE.Matrix4().copy(arm.parent.matrixWorld).invert().multiply(armWorld[index]).decompose(arm.position, arm.quaternion, arm.scale);
    });
    root.updateMatrixWorld(true);
    for (const node of changed) {
      const values = channels.get(node);
      values.position.push(...node.position.toArray());
      values.quaternion.push(...node.quaternion.toArray());
      values.scale.push(...node.scale.toArray());
    }
  }
  pose.restore();
  for (const [node, values] of channels) {
    clip.tracks.push(new THREE.VectorKeyframeTrack(`${node.name}.position`, times, values.position));
    clip.tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values.quaternion));
    clip.tracks.push(new THREE.VectorKeyframeTrack(`${node.name}.scale`, times, values.scale));
  }
  return clip;
}

function gaitSpeed(root, clip) {
  const feet = ['L_feet', 'R_feet'].map(name => root.getObjectByName(name));
  if (feet.some(foot => !foot)) throw new Error('Nightmare feet unavailable for gait measurement');
  const pose = poseSampler(root, clip);
  const samples = feet.map(() => []);
  const sampleCount = 120;
  for (let frame = 0; frame <= sampleCount; frame++) {
    pose.sample(clip.duration * frame / sampleCount);
    feet.forEach((foot, index) => samples[index].push(foot.getWorldPosition(new THREE.Vector3())));
  }
  pose.restore();
  const velocities = [];
  for (const foot of samples) {
    const bottom = Math.min(...foot.map(p => p.y));
    const top = Math.max(...foot.map(p => p.y));
    const contactY = bottom + (top - bottom) * 0.35;
    for (let i = 1; i < foot.length; i++) {
      const speed = (foot[i - 1].z - foot[i].z) / (clip.duration / sampleCount);
      if (foot[i - 1].y <= contactY && foot[i].y <= contactY && speed > 0.05) velocities.push(speed);
    }
  }
  if (!velocities.length) throw new Error(`No grounded backward foot sweep in Nightmare ${clip.name}`);
  velocities.sort((a, b) => a - b);
  return Number(velocities[Math.floor(velocities.length / 2)].toFixed(4));
}

function groundClip(object, clip, rootBone) {
  const pose = poseSampler(object, clip);
  const parentScaleY = rootBone.parent.getWorldScale(new THREE.Vector3()).y;
  const sampleCount = Math.round(clip.duration * 120);
  const times = [];
  const values = [];
  let minimumBeforeM = Infinity;
  let maximumCorrectionM = 0;
  for (let frame = 0; frame <= sampleCount; frame++) {
    const time = clip.duration * frame / sampleCount;
    pose.sample(time);
    const minimumY = new THREE.Box3().setFromObject(object, true).min.y;
    const liftM = Math.max(0, 0.002 - minimumY);
    minimumBeforeM = Math.min(minimumBeforeM, minimumY);
    maximumCorrectionM = Math.max(maximumCorrectionM, liftM);
    times.push(time);
    values.push(rootBone.position.x, rootBone.position.y + liftM / parentScaleY, rootBone.position.z);
  }
  pose.restore();
  clip.tracks = clip.tracks.filter(track => track.name !== `${rootBone.name}.position`);
  clip.tracks.push(new THREE.VectorKeyframeTrack(`${rootBone.name}.position`, times, values));
  return { minimumBeforeM, maximumCorrectionM, samplesPerSecond: 120, clearanceM: 0.002 };
}

async function texture(relative, colorSpace) {
  const map = await new THREE.TextureLoader().loadAsync(new URL(relative, SOURCE).href);
  map.colorSpace = colorSpace;
  map.flipY = true;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return map;
}

export async function buildNightmare() {
  const loader = await identityLoader();
  const loadFbx = async relative => loader.parse(await (await checkedFetch(new URL(PACK + relative, SOURCE))).arrayBuffer(), '');
  const rig = await loadFbx('Mesh/DragonTheNightmareMesh.fbx');
  const sourceControls = [];
  rig.traverse(node => { if (node.isLine || node.isPoints || node.isCamera || node.isLight) sourceControls.push(node); });
  for (const node of sourceControls) node.removeFromParent();
  const rigIdentities = nodeIdentities(rig);
  nameRig(rig, rigIdentities);
  const rootBone = rig.getObjectByName('Root');
  if (!rootBone?.isBone) throw new Error('Nightmare Root bone missing');
  const clips = [];
  for (const [name, file, lastFrame] of CLIP_SPECS) {
    clips.push(importClip(await loadFbx(`Animations/DragonNightMare/${file}.fbx`), rigIdentities, rootBone, name, lastFrame));
  }
  const hit = clips.find(clip => clip.name === 'Hit');
  clips.push(directionalHit(rig, hit, 'HitLeft', -1), directionalHit(rig, hit, 'HitRight', 1));
  clips.sort((a, b) => ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'HitLeft', 'HitRight', 'Death'].indexOf(a.name) - ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'HitLeft', 'HitRight', 'Death'].indexOf(b.name));
  const [albedo, normal, orm] = await Promise.all([
    texture(PACK + 'Texture/DragonNightmare/Albino/Albedo.png', THREE.SRGBColorSpace),
    texture(PACK + 'Texture/DragonNightmare/Albino/Normal.png', THREE.NoColorSpace),
    texture('textures/Albino_ORM.png', THREE.NoColorSpace),
  ]);
  const material = new THREE.MeshStandardMaterial({
    name: 'animal_quarry_nightmare_AlbinoPBR', map: albedo, normalMap: normal,
    aoMap: orm, aoMapIntensity: 1, roughnessMap: orm, roughness: 1,
    metalnessMap: orm, metalness: 1, normalScale: new THREE.Vector2(1, 1),
  });
  let meshCount = 0;
  rig.traverse(node => {
    if (!node.isMesh) return;
    meshCount++;
    for (const attribute of ['position', 'normal', 'uv']) {
      const data = node.geometry.getAttribute(attribute);
      if (!data || Array.from(data.array).some(value => !Number.isFinite(value))) throw new Error(`Invalid Nightmare ${node.name} ${attribute}`);
    }
    node.material = material;
    node.frustumCulled = false;
    if (node.isSkinnedMesh) node.normalizeSkinWeights();
  });
  if (meshCount !== 1) throw new Error(`Unexpected Nightmare mesh count: ${meshCount}`);
  const object = new THREE.Group();
  object.name = 'quarry_nightmare';
  object.scale.setScalar(SCALE);
  object.add(rig);
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object, true);
  object.position.y = -bounds.min.y;
  object.updateMatrixWorld(true);
  const grounding = Object.fromEntries(clips.map(clip => [clip.name, groundClip(object, clip, rootBone)]));
  const impliedWalkMps = gaitSpeed(object, clips.find(clip => clip.name === 'Walk'));
  const impliedRunMps = gaitSpeed(object, clips.find(clip => clip.name === 'Run'));
  object.updateMatrixWorld(true);
  object.animations = clips;
  const meta = {
    id: 'quarry_nightmare', is: 'an albino plated ground dragon with a hooked skull, heavy foreclaws and a long tail',
    tags: ['creature', 'monster', 'dragon', 'grounded', 'quarry'],
    provenance: {
      publisher: 'Dungeon Mason', package: 'Dragon for Boss Monster PBR', sourceFolder: 'FourEvilDragonsPBR',
      mesh: 'Assets/FourEvilDragonsPBR/Mesh/DragonTheNightmareMesh.fbx', material: 'DragonNightmare/AlbinoPBR',
      textureResolution: 2048, scale: SCALE, facing: '+Z',
      clips: Object.fromEntries(CLIP_SPECS.map(([name, file, last]) => [name, {
        file: `Assets/FourEvilDragonsPBR/Animations/DragonNightMare/${file}.fbx`, take: 'Take 001', frames: [0, last], fps: FPS,
      }])),
      directionalHits: 'Source getHit plus signed chest and neck recoil; forelimb world transforms compensated at every 30 Hz source sample',
      rootMotion: 'Root X/Z fixed to mesh rest translation, source Y compression preserved',
      grounding: { method: 'Actual skinned minimum sampled at 120 Hz; upward-only Root Y correction with 2 mm clearance', clips: grounding },
      gaitMeasurement: 'Median backward hind-foot velocity in lowest 35% of each foot height range, 120 samples per clip, final .45 scale',
    },
    attackSeconds: 1.2, contactNormalized: 0.72, contactWindowNormalized: [0.66, 0.82],
    gaitFootBones: ['L_feet', 'R_feet'],
    impliedWalkMps, impliedRunMps, walkClipSeconds: 40 / FPS, runClipSeconds: 1,
    notes: [
      'All required clips use authored ground motions; no flight or jump clips are imported.',
      'Both same-named forelimb branches bind by FBX Model identity and full ancestry before export.',
      'Loaded FBX is already metre scale; outer .45 scale preserves the authored rig proportions.',
      'Native 2048px albedo and tangent normal retained; Unity metal/smoothness and AO packed into glTF ORM.',
      'Three FBXLoader retains the strongest four skin influences; exported weights are normalized.',
      'Per-sample root height corrections keep the posed skinned mesh above ground while retaining source rotation and articulation.',
      'Attack contact is provisionally authored strike frames 24–30; root lab gameplay and screenshot acceptance still required.',
    ],
  };
  return { object, clips, meta };
}
