import * as THREE from 'three';
import { loadFbx, texture, cleanClip, directionalHit, groundObject, measureStance, preventFloorPenetration } from './common.mjs';
import { compressCinderGaits, sealCinderGaitFloor } from './cinder-gait.mjs';

export async function buildCinder() {
  const base = '/test-results/creature-expansion/sources/monsters/cinder/Assets/Stylized3DMonster/Monster04/';
  const root = await loadFbx(`${base}Monster04_AllAnim.fbx`);
  const atlas = await texture(`${base}Shader_Texture/Texture/Monster04_Color03.png`);
  const mat = new THREE.MeshStandardMaterial({ name: 'animal_cinder_ravager_hide', map: atlas, roughness: 0.78, metalness: 0 });
  root.traverse(node => { if (node.isMesh) { node.material = mat; node.frustumCulled = false; } });
  const rootBone = root.getObjectByName('rootx');
  const takeMap = { Idle: 'Idle', Walk: 'Walk', Run: 'Run', Attack: 'Attack01', Hit: 'GetHit', Death: 'Die' };
  const clips = Object.entries(takeMap).map(([name, suffix]) => {
    const source = root.animations.find(clip => clip.name === `Monster04_${suffix}`);
    if (!source) throw new Error(`Monster04 missing ${suffix}`);
    return cleanClip(source, name, root, rootBone);
  });
  const hit = clips.find(clip => clip.name === 'Hit');
  const reactions = [['spine_02x', [0, 0, 1], 9], ['spine_03x', [0, 0, 1], 7], ['headx', [0, 0, 1], 6]];
  clips.push(directionalHit(hit, 'HitLeft', reactions, 1), directionalHit(hit, 'HitRight', reactions, -1));
  const object = groundObject(root, clips, 0.012, 'rootx');
  object.name = 'cinder_ravager';
  const groundCorrections=preventFloorPenetration(object,clips,'rootx');
  const gaitAdaptation=compressCinderGaits(object,clips);
  const walk = clips.find(clip => clip.name === 'Walk'), run = clips.find(clip => clip.name === 'Run');
  const gaitGroundCorrections=preventFloorPenetration(object,[walk,run],'rootx');
  const gaitFloorSeal=sealCinderGaitFloor(object,[walk,run]);
  const feet=['toes_01l','toes_01r'];
  const walkStance=measureStance(object,walk,feet),runStance=measureStance(object,run,feet);
  return { object, clips, meta: {
    id: 'cinder_ravager', is: 'A tall plated ravager with a forked head crest, broad clawed arms and digitigrade feet.',
    tags: ['creature', 'monster', 'biped', 'ground', 'claw'],
    provenance: { author: 'PixeliusVita', pack: 'Fantasy Monster 3D Model 04 - Game Ready - PixeliusVita', license: 'Standard Unity Asset Store EULA', source: 'Assets/Stylized3DMonster/Monster04/Monster04_AllAnim.fbx', texture: 'Monster04_Color03.png', modifications: 'Metre conversion; in-place root channels; exact loop endpoint; directional torso/head recoil overlays over the authored GetHit take; upward-only root height corrections from actual skinned minima. Walk and Run have shorter toe paths solved on the original leg chain at native cadence; Run ankle roll is 40% and knee-plane variation 50% around the authored planted pose. Mesh scale and six non-gait clips are preserved.' },
    attackSeconds: clips.find(clip => clip.name === 'Attack').duration, contactNormalized: 0.235,
    impliedWalkMps: walkStance.mps, impliedRunMps: runStance.mps,
    gaitFootBones:feet, gaitStanceAudit:{walk:walkStance,run:runStance}, groundCorrections,gaitGroundCorrections,gaitFloorSeal,
    gaitAdaptation:gaitAdaptation.map(({samples,...summary})=>summary),
    walkClipSeconds: walk.duration, runClipSeconds: run.duration,
    animationResampleTolerance: 1e-6,
    notes: ['Six named embedded FBX takes retained without broad-take substitutions. Walk and Run retain source upper-body channels and cadence, with shorter planted toe paths solved through the original leg chain.', 'Native atlas and vertex normals retained. The source package has no true tangent normal or roughness texture.', 'Walk retains source ankle roll and knee bend direction. Run reduces ankle roll to 40% and knee-plane variation to 50% around the source planted pose. Toe contacts move backward at .9 m/s Walk and 3 m/s Run. Actual weighted sole vertices control leg contact height; metadata measures the final clips after floor correction.', 'Attack01 is the authored ground claw combination. Contact at 0.548s marks the first descending claw sweep; the later spin is recovery motion for the one-hit runtime attack.'],
  } };
}
