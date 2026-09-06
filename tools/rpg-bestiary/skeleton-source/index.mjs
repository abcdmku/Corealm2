import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import * as THREE from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {buildSkeletonVariant} from './variants.mjs';
import {removeHelmetHorns} from './unhorned.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const SOURCE=path.resolve(HERE,'../../../test-results/rpg-bestiary-skeleton/Assets/DungeonCharacters/Skeletons_demo');
const PACKAGE_HASH='9e9e40c66eda22d756dd256bf670fcf5edc28bf0b4bba5026daa204791fdf23c';
function ensureSource() {
  if(fs.existsSync(path.join(SOURCE,'models/Materials/DemoEquipment.png')))return;
  const result=spawnSync('python',[path.join(HERE,'extract.py')],{encoding:'utf8',windowsHide:true});
  if(result.status!==0)throw new Error(`Dungeon Skeleton source extraction failed: ${result.stderr||result.error}`);
}
function parse(relative) {
  // Textures are embedded later by the Node exporter from the source binding paths.
  // No document, canvas, browser or GPU is required to parse this source rig.
  const manager=new THREE.LoadingManager();
  manager.addHandler(/./,{path:'',setPath(value){this.path=value;return this;},load(){return new THREE.Texture();}});
  const bytes=fs.readFileSync(path.join(SOURCE,relative));
  return new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
}
function staticPoseClip(idle,name,duration) {
  return new THREE.AnimationClip(name,duration,idle.tracks.map(track=>{
    const result=track.clone(),value=Array.from(track.createInterpolant().evaluate(0));
    result.times=new Float32Array([0,duration]);result.values=new Float32Array([...value,...value]);return result;
  }));
}
function replaceTrack(clip,track) {clip.tracks=clip.tracks.filter(candidate=>candidate.name!==track.name);clip.tracks.push(track);}
function deriveMissing(idle,walk) {
  // The demo has no authored run, reaction or death. These remain explicit proposals.
  const run=walk.clone();run.name='Run';for(const track of run.tracks)track.scale(.68);run.resetDuration();
  const rootQ=idle.tracks.find(track=>track.name==='Bip001.quaternion').createInterpolant().evaluate(0);
  const rootP=Array.from(idle.tracks.find(track=>track.name==='Bip001.position').createInterpolant().evaluate(0));
  const baseQ=new THREE.Quaternion().fromArray(rootQ);
  const clips=[run];
  for(const [name,side] of [['Hit',0],['HitLeft',1],['HitRight',-1]]) {
    const duration=.58,clip=staticPoseClip(idle,name,duration),times=[0,.1,.27,.58],envelope=[0,1,.45,0];
    replaceTrack(clip,new THREE.QuaternionKeyframeTrack('Bip001.quaternion',times,envelope.flatMap(value=>new THREE.Quaternion().setFromEuler(new THREE.Euler(-.16*value,side*.09*value,side*.2*value)).multiply(baseQ).toArray())));
    clips.push(clip);
  }
  const death=staticPoseClip(idle,'Death',1.6),times=[0,.25,.65,1.15,1.6],fall=[0,.05,.42,.94,1];
  replaceTrack(death,new THREE.QuaternionKeyframeTrack('Bip001.quaternion',times,fall.flatMap(value=>new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI*.48*value).multiply(baseQ).toArray())));
  replaceTrack(death,new THREE.VectorKeyframeTrack('Bip001.position',times,fall.flatMap(value=>[rootP[0],rootP[1]*(1-.8*value),rootP[2]-14*value])));
  clips.push(death);return clips;
}
function floorCorrect(object,ground,clips) {
  const states=[];object.traverse(node=>states.push([node,node.position.clone(),node.quaternion.clone(),node.scale.clone()]));
  const restore=()=>states.forEach(([node,p,q,s])=>{node.position.copy(p);node.quaternion.copy(q);node.scale.copy(s);});
  const mixer=new THREE.AnimationMixer(object),base=ground.position.clone();
  for(const clip of clips) {
    restore();const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
    const count=Math.ceil(clip.duration*120),times=Array.from(new Set([...Array.from({length:count+1},(_,i)=>i/count*clip.duration),...clip.tracks.flatMap(track=>Array.from(track.times))])).sort((a,b)=>a-b),values=[];
    for(const time of times){mixer.setTime(time);object.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(object,true);values.push(base.x,base.y+Math.max(0,-box.min.y)+.0005,base.z);}
    action.stop();mixer.uncacheClip(clip);clip.tracks.push(new THREE.VectorKeyframeTrack('SkeletonGround.position',times,values));
  }
  mixer.stopAllAction();restore();object.updateMatrixWorld(true);
}

export function buildSkeletonSource(id='skeleton_soldier') {
  ensureSource();
  const source=parse('models/DungeonSkeleton_demo.FBX');source.name='DungeonSkeletonSource';
  const object=new THREE.Group();object.name=id;
  const ground=new THREE.Group();ground.name='SkeletonGround';object.add(ground);ground.add(source);
  source.scale.setScalar(.018); // Source bind height 100.80 units, target 1.814 m.
  const materialNames=new Set();let vertices=0,bones=0;
  source.traverse(node=>{
    if(node.isBone)bones++;
    if(!node.isMesh)return;
    if(!node.isSkinnedMesh)throw new Error('Unexpected unskinned Dungeon Skeleton source');
    vertices+=node.geometry.attributes.position.count;
    if(!node.geometry.attributes.uv||!node.geometry.attributes.skinIndex||!node.geometry.attributes.skinWeight)throw new Error('Source UV or skinning absent');
    const convert=material=>{materialNames.add(material.name);return new THREE.MeshStandardMaterial({name:material.name,color:0xffffff,roughness:.8,metalness:0});};
    node.material=Array.isArray(node.material)?node.material.map(convert):convert(node.material);
    node.castShadow=true;node.receiveShadow=true;node.frustumCulled=false;
  });
  object.updateMatrixWorld(true);ground.position.y-=new THREE.Box3().setFromObject(object,true).min.y;
  const sourceClips=[['Idle','idle_A'],['Walk','walk'],['Attack','attack_A']].map(([name,file])=>{
    const rig=parse(`animation/DS_onehand_${file}.FBX`),clip=rig.animations[0]?.clone();
    if(!clip)throw new Error(`Missing source take ${file}`);
    clip.name=name;
    for(const track of clip.tracks){const nodeName=track.name.slice(0,track.name.lastIndexOf('.'));if(!source.getObjectByName(nodeName))throw new Error(`Unmatched source joint ${nodeName}`);}
    return clip;
  });
  const [idle,walk,attack]=sourceClips,derived=deriveMissing(idle,walk);
  let clips=[idle,walk,derived[0],attack,...derived.slice(1)],variantMeta={};
  if(id!=='skeleton_soldier'){
    const variant=buildSkeletonVariant(object,source,id==='skeleton_archer'?'archer':'mage',clips);clips=variant.clips;variantMeta=variant.meta;
  }
  floorCorrect(object,ground,clips);object.animations=clips;
  // Keep accepted clip curves and their conservative grounding exactly unchanged.
  // Horn removal only reduces occupied geometry, so no new floor crossing arises.
  const unhorned=id==='skeleton_mage'?null:removeHelmetHorns(source);
  const box=new THREE.Box3().setFromObject(object,true),size=box.getSize(new THREE.Vector3());
  const materials=path.join(SOURCE,'models/Materials');
  const meta={family:'skeleton',style:id==='skeleton_soldier'?'source-onehand-soldier':'source-'+variantMeta.role,heightM:size.y,dimensionsM:{width:size.x,height:size.y,depth:size.z},forwardAxis:'+Z',upAxis:'+Y',groundY:box.min.y,
    rig:'Original Dungeon Skeletons biped skin, bind matrices and weights',sourceSkinned:true,boneCount:bones,sourceVertices:vertices,attackContactPhase:.4,
    attackContactStatus:'Provisional contact phase pending production review of original Attack take',
    textureBindings:[{materialName:'DS_Skeleton_standard',baseColorPath:path.join(materials,'DemoSkeleton.png'),flipY:true},{materialName:'DS_equipment_standard',baseColorPath:path.join(materials,'DemoEquipment.png'),flipY:true}],
    provenance:{publisher:'Polygon Blacksmith',package:'Dungeon Skeletons Demo.unitypackage',sha256:PACKAGE_HASH,license:'Standard Unity Asset Store EULA; local entitlement cache',mesh:'models/DungeonSkeleton_demo.FBX',textureNotes:'Original UV albedo maps preserved. Demo contains no normal/roughness texture. Unity material smoothness .2 maps to roughness .8; metallic 0.'},
    animationProvenance:{Idle:'Original DS_onehand_idle_A.FBX take',Walk:'Original DS_onehand_walk.FBX take',Attack:'Original DS_onehand_attack_A.FBX take',Run:'PROPOSAL: original Walk retimed to 68% duration; no authored run in demo',Hit:'PROPOSAL: authored root recoil over source idle pose',HitLeft:'PROPOSAL: authored directional root recoil over source idle pose',HitRight:'PROPOSAL: authored directional root recoil over source idle pose',Death:'PROPOSAL: authored backward root collapse over source idle pose; no authored death in demo'},
    acceptance:'Source candidate. Original mesh/material/rig preserved; derived motions need production review. Not accepted.',...variantMeta,...(unhorned?{helmetModification:unhorned}:{})};
  if(id!=='skeleton_soldier'){
    for(const name of ['Idle','Walk','Run','Hit','HitLeft','HitRight'])meta.animationProvenance[name]+='; Corealm-derived role arm poses over source rig.';
    meta.animationProvenance.Attack=variantMeta.roleAnimationProvenance;
    source.traverse(node=>{if(node.isSkinnedMesh)meta.retainedSourceVertices=node.geometry.attributes.position.count;});
  }
  for(const binding of meta.textureBindings)if(!materialNames.has(binding.materialName))throw new Error('Unexpected source material binding '+binding.materialName);
  return {object,clips,meta};
}
