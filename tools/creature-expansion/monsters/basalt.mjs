import * as THREE from 'three';
import { loadFbx, texture, cleanClip, directionalHit, groundObject, measureStance, preventFloorPenetration } from './common.mjs';

async function packedMaterial(base) {
  const [map, normalMap, orm] = await Promise.all([
    texture(`${base}Blue/Albedo.png`), texture(`${base}Blue/Normal.png`, false),
    texture('/test-results/creature-expansion/sources/monsters/basalt/derived/blue-orm.png', false),
  ]);
  return new THREE.MeshStandardMaterial({name:'animal_basalt_drake_armor',map,normalMap,normalScale:new THREE.Vector2(1,1),aoMap:orm,roughnessMap:orm,metalnessMap:orm,roughness:1,metalness:1});
}

export async function buildBasalt() {
  const base = '/test-results/creature-expansion/sources/monsters/basalt/Assets/FreeDragons/';
  const root = await loadFbx(`${base}Mesh/DragonBoarMesh.fbx`);
  const mat = await packedMaterial(`${base}Texture/DragonBoarPBR/`);
  root.traverse(node => { if (node.isMesh) { node.material=mat; node.frustumCulled=false; } });
  const rootBone = root.getObjectByName('Root');
  const files = {Idle:'idle',Walk:'walk',Run:'run',Attack:'HornAttack',Hit:'GetHit',Death:'Die'};
  const clips = [];
  for(const [name,file] of Object.entries(files)) {
    const imported = await loadFbx(`${base}Animations/DragonBoar/${file}.fbx`);
    const source = imported.animations[0];
    if (!source) throw new Error(`DragonBoar ${file} missing authored take`);
    // Every FBX is exactly the single Unity-marked window, starting at zero:
    // Idle/Hit/Death 0..40, Walk 0..30, Run 0..24, HornAttack 0..48 at 30 fps.
    clips.push(cleanClip(source,name,root,rootBone));
  }
  const hit=clips.find(clip=>clip.name==='Hit');
  const reactions=[['Head',[1,0,0],8],['Chest',[1,0,0],4]];
  clips.push(directionalHit(hit,'HitLeft',reactions,1),directionalHit(hit,'HitRight',reactions,-1));
  // Dungeon Mason has metre transforms already, with .01 on mesh/rig children.
  const object=groundObject(root,clips,.65,'Root'); object.name='basalt_drake';
  const walk=clips.find(clip=>clip.name==='Walk'),run=clips.find(clip=>clip.name==='Run');
  const groundCorrections=preventFloorPenetration(object,clips,'Root');
  const feet=['L_Hand','R_Hand','L_Toes','R_Toes'];
  const walkStance=measureStance(object,walk,feet),runStance=measureStance(object,run,feet);
  return {object,clips,meta:{
    id:'basalt_drake',is:'An armored low dragon with a boar-like snout, broad forepaws and a ridge of dorsal spikes.',
    tags:['creature','monster','quadruped','ground','horn'],
    provenance:{author:'Dungeon Mason',pack:'Dragon the Soul Eater and Dragon Boar',license:'Standard Unity Asset Store EULA',source:'Assets/FreeDragons/Mesh/DragonBoarMesh.fbx',texture:'DragonBoarPBR/Blue',modifications:'Proportional .65 scale, stationary horizontal root, native albedo and normal maps, Unity metallic/smoothness and AO packed into glTF ORM, directional upper-body recoil over authored hit, upward-only root height corrections from actual skinned minima at 240 Hz.'},
    attackSeconds:clips.find(clip=>clip.name==='Attack').duration,contactNormalized:.65,
    impliedWalkMps:walkStance.mps,impliedRunMps:runStance.mps,
    gaitFootBones:feet,gaitStanceAudit:{walk:walkStance,run:runStance},groundCorrections,
    walkClipSeconds:walk.duration,runClipSeconds:run.duration,
    notes:['All six full single-motion FBX takes match their Unity frame windows.','HornAttack lowers the head and drives its tusks forward. The source supplies a grounded four-leg walk and run.','Contact at 1.04 seconds matches the rising head thrust after its low windup; jaw-front reach peaks at 1.07 seconds.'],
  }};
}
