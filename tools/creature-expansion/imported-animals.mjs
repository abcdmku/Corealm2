import * as THREE from 'three';
import { GLTFLoader } from '/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import '/tools/animals/convert.js';
import { authorMissingMotions, articulateSourceMesh } from './imported-animals/motions.mjs';

const ROOT = '/test-results/creature-expansion/sources/animals';
const pack = {
  id: 'animal-pack-deluxe', name: 'Animal pack deluxe', author: 'janpec',
  source: 'https://assetstore.unity.com/?q=Animal%20pack%20deluxe',
  license: 'Standard Unity Asset Store EULA; project owner must confirm entitlement',
};

const footBones = {
  reedjaw_crocodile: ['l_FrontLeg_Ball', 'r_FrontLeg_Ball', 'l_HindLeg_Ball', 'r_HindLeg_Ball'].map(name => `Crocodile_${name}SHJnt`),
  kiln_salamander: ['l_FrontLeg_Ball', 'r_FrontLeg_Ball', 'l_HindLeg_Ball', 'r_HindLeg_Ball'].map(name => `FireSalamander_${name}SHJnt`),
  reedbank_goose: ['Bone020', 'Bone020(mirrored)'],
  quarry_snail: ['Bone003', 'Bone004', 'Bone005', 'Bone006'],
};

/** Median backward sole velocity in the low part of each foot's trajectory, in metres/second. */
function stanceSpeed(object, clip, names) {
  const mixer = new THREE.AnimationMixer(object);
  mixer.clipAction(clip).play();
  const feet = names.map(name => object.getObjectByName(name));
  if (feet.some(foot => !foot)) throw new Error(`${clip.name}: missing sole joint ${names}`);
  const positions = feet.map(() => []);
  const count = 120, dt = clip.duration / count;
  for (let i = 0; i < count; i++) {
    mixer.setTime(dt * i); object.updateMatrixWorld(true);
    feet.forEach((foot, index) => positions[index].push(foot.getWorldPosition(new THREE.Vector3())));
  }
  const speeds = [];
  for (const samples of positions) {
    const low = Math.min(...samples.map(p => p.y)), high = Math.max(...samples.map(p => p.y));
    const threshold = low + (high - low) * .2 + .00005;
    for (let i = 1; i < samples.length; i++) {
      const backwardsMps = (samples[i - 1].z - samples[i].z) / dt;
      if (Math.max(samples[i - 1].y, samples[i].y) <= threshold && backwardsMps > 0.00001) speeds.push(backwardsMps);
    }
  }
  mixer.stopAllAction(); object.updateMatrixWorld(true);
  speeds.sort((a, b) => a - b);
  return { mps: speeds[Math.floor(speeds.length / 2)] ?? 0, samples: speeds.length, method: '120 samples; backward sole velocity below each sole trajectory lower 20%; median' };
}

export const SPECIES = [
  {
    id: 'reedjaw_crocodile', is: 'crocodile', rig: 'Crocodile_Rig.fbx',
    texture: 'crocodile_col7_unity.png', normal: 'crocodile_nrml3.png', extraScale: 1,
    tags: ['crocodile', 'reptile', 'animal', 'wetland', 'territorial'],
    clips: [
      ['Crocodile_Idle.fbx', 'Idle', [1, 240]],
      ['Crocodile_Walk.fbx', 'Walk', [1, 43]],
      ['Crocodile_Run.fbx', 'Run', [1, 17]],
      ['Crocodile_Bite.fbx', 'Attack', [1, 25]],
      ['Crocodile_Die.fbx', 'Death', [1, 47]],
    ],
    // The source jaw reaches its minimum gape at sample 11/24, after its forward snap.
    contactNormalized: 11 / 24,
    notes: 'Unused licensed crocodile body, source bite and distinct source walk/run. Authored neck and tail hit recoils leave all four support chains planted.',
  },
  {
    id: 'kiln_salamander', is: 'salamander', rig: 'FireSalamander_Rig.fbx',
    texture: 'fire_salamander_col3_unity.png', normal: 'fire_salamander_nrml3.png', extraScale: 2.4,
    tags: ['salamander', 'amphibian', 'animal', 'warm-bank', 'spit'],
    clips: [
      ['FireSalamander_Idle.fbx', 'Idle', [1, 160]],
      ['FireSalamander_Walk.fbx', 'Walk', [1, 39]],
      ['FireSalamander_Run.fbx', 'Run', [1, 25]],
      ['FireSalamander_Die.fbx', 'Death', [1, 80]],
    ],
    contactNormalized: 0.43,
    notes: 'Unused licensed salamander body. Added lower-jaw articulation; throat-rise and forward spit gesture use a held source support pose. Distinct source walk/run.',
  },
  {
    id: 'reedbank_goose', is: 'goose', rig: 'swan_goose_rig_exp.FBX',
    texture: 'swan_goose_col_unity.png', normal: 'swan_goose_nrml13.png', extraScale: 1,
    tags: ['goose', 'bird', 'animal', 'reeds', 'territorial'],
    clips: [
      ['swan_goose_idle_anim.FBX', 'Idle', [100, 400]],
      ['swan_goose_walk_anim.FBX', 'Walk', [10, 40]],
      ['swan_goose_run_anim.FBX', 'Run', [60, 75]],
      ['swan_goose_die_anim.FBX', 'Death', [500, 530]],
    ],
    contactNormalized: 0.46,
    notes: 'Unused licensed goose body. Authored warning, neck-driven forward bill strike and paired wing flare. No feeding clip is used as Attack; both feet retain their source support pose.',
  },
  {
    id: 'quarry_snail', is: 'snail', rig: 'snail_rig_exp.FBX',
    texture: 'snail_col4_unity.png', normal: 'snail_nrml3.png', extraScale: 2.4,
    tags: ['snail', 'mollusc', 'animal', 'quarry', 'moss'],
    clips: [
      ['snail_idle_anim.FBX', 'Idle', [400, 670]],
      ['snail_walk_anim.FBX', 'Walk', [10, 140]],
      ['snail_die_anim.FBX', 'Death', [180, 260]],
    ],
    contactNormalized: 0.48,
    notes: 'Unused licensed snail body, refined with a continuous curved spiral shell, modeled whorl gutters and a muscular foot margin. Source UVs/material remain. Rigid shell influence is separated from soft foot. Added eye-stalk articulation, retract/emerge rasp attack, directional recoil, and a distinct authored traveling foot-wave faster crawl.',
  },
];

export async function buildSpecies(id) {
  const species = SPECIES.find(entry => entry.id === id);
  if (!species) throw new Error(`Unknown imported animal ${id}`);
  const path = file => `${ROOT}/${id}/${file}`;
  const source = await window.convertAnimal({
    id: `animal_${id}`, rig: path(species.rig), texture: path(species.texture),
    extraScale: species.extraScale, materialName: `animal_${id}_mat`,
    clips: species.clips.map(([file, name, frames]) => ({ url: path(file), name, frames })),
  });
  const failed = source.clips.filter(clip => !clip.ok);
  if (failed.length) throw new Error(`${id}: source clip import failed ${JSON.stringify(failed)}`);
  const bytes = Uint8Array.from(atob(source.base64), char => char.charCodeAt(0));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '');
  const object = gltf.scene;
  object.name = `animal_${id}`;
  const normalMap = await new THREE.TextureLoader().loadAsync(path(species.normal));
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.flipY = true;
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  object.traverse(node => {
    if (!node.isMesh) return;
    node.castShadow = node.receiveShadow = true;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      material.normalMap = normalMap;
      material.normalScale.setScalar(0.55);
      material.needsUpdate = true;
    }
  });
  const articulation = articulateSourceMesh(object, id);
  const authored = authorMissingMotions(object, gltf.animations, id, articulation);
  const clips = [...gltf.animations.filter(clip => !authored.some(replacement => replacement.name === clip.name)), ...authored];
  const attack = clips.find(clip => clip.name === 'Attack');
  const gaitStance = {
    Walk: stanceSpeed(object, clips.find(clip => clip.name === 'Walk'), footBones[id]),
    Run: stanceSpeed(object, clips.find(clip => clip.name === 'Run'), footBones[id]),
  };
  object.userData.creatureSource = { ...pack, rig: species.rig, authoredJoints: articulation.report };
  object.userData.sourceFrames = species.clips.map(([file, name, frames]) => ({ file, name, frames }));
  return {
    object, clips,
    meta: {
      is: species.is, tags: species.tags,
      provenance: { ...pack, sourceRig: species.rig, sourceManifest: `${ROOT.slice(1)}/source-provenance.json` },
      attackSeconds: attack.duration, contactNormalized: species.contactNormalized,
      impliedWalkMps: gaitStance.Walk.mps || source.impliedWalkMps,
      impliedRunMps: gaitStance.Run.mps || source.impliedRunMps,
      walkClipSeconds: clips.find(clip => clip.name === 'Walk').duration,
      runClipSeconds: clips.find(clip => clip.name === 'Run').duration,
      notes: species.notes,
      sourceClips: source.clips,
      articulation: articulation.report,
      gaitFootBones: footBones[id], gaitStance,
      sourceConverterImpliedMps: { Walk: source.impliedWalkMps, Run: source.impliedRunMps },
      ...(id === 'quarry_snail' ? { gaitContactNote: 'Continuous soft sole. These are foot-chain probes, not articulated planted leg feet.' } : {}),
    },
  };
}
