import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { applyFantasyWasp } from './fantasy-wasp.mjs';
import { repairWaspSkin } from './repair-wasp-skin.mjs';

const inventory=JSON.parse(fs.readFileSync(new URL('../replacement-inventory/nature.json',import.meta.url)));
const configurations={webweaver_spider:{source:'spider',width:1.6,rotation:0,probe:'Head_end'},marsh_wasp:{source:'wasp',width:1.2,rotation:-Math.PI/2,probe:'Sting_end'}};
const v=new THREE.Vector3();
function copy(source,name,speed=1){const c=source.clone();c.name=name;for(const t of c.tracks)t.scale(1/speed);c.duration/=speed;return c;}

/** Complete original Quaternius source bodies, with their original bone hierarchy. */
export function buildWholeInsect(id){
 const config=configurations[id];if(!config)throw new Error(`Unsupported whole insect ${id}`);
 const record=inventory.sources.find(r=>r.id===config.source),file=new URL(`./derived/${config.source==='spider'?'Spider':'Wasp'}.fbx`,import.meta.url),bytes=fs.readFileSync(file);
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==record.memberSha256)throw new Error(`Source hash mismatch: ${file}`);
 const source=new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const sourceSkinRepair=id==='marsh_wasp'?repairWaspSkin(source):null;
 const fantasyRevision=id==='marsh_wasp'?applyFantasyWasp(source):null;
 const native=source.animations,find=s=>native.find(c=>c.name.endsWith(`_${s}`)),flying=config.source==='wasp';
 const idle=find(flying?'Flying':'Idle'),walk=find(flying?'Flying':'Walk');
 const object=new THREE.Group();object.name=id;
 const lift=new THREE.Group();lift.name='insect_floor';object.add(lift);
 const recoil=new THREE.Group();recoil.name='insect_recoil';lift.add(recoil);
 const orientation=new THREE.Group();orientation.name='insect_orientation';orientation.rotation.y=config.rotation;recoil.add(orientation);orientation.add(source);
 const mixer=new THREE.AnimationMixer(object);mixer.clipAction(idle).play();mixer.setTime(0);object.updateMatrixWorld(true);
 const initial=new THREE.Box3().setFromObject(object,true);orientation.scale.setScalar(config.width/initial.getSize(v).x);object.updateMatrixWorld(true);
 const scale=orientation.scale.x;const mats=new Map();let jointCount=0,vertices=0;
 const pbr=original=>{
  if(mats.has(original))return mats.get(original);
  const material=new THREE.MeshStandardMaterial({name:`animal_rpg_${id}_${original.name}`,color:original.color.clone(),opacity:original.opacity,transparent:original.transparent,side:original.side,alphaTest:original.alphaTest,depthWrite:original.depthWrite,vertexColors:original.vertexColors,map:original.map,roughness:original.userData.fantasyPbr?.roughness??.85,metalness:original.userData.fantasyPbr?.metalness??0});
  mats.set(original,material);return material;
 };
 source.traverse(n=>{if(n.isBone)jointCount++;if(n.isMesh){n.castShadow=true;n.receiveShadow=true;vertices+=n.geometry.attributes.position.count;n.material=Array.isArray(n.material)?n.material.map(pbr):pbr(n.material);}});
 mixer.stopAllAction();
 const clips=[copy(idle,'Idle'),copy(walk,'Walk'),copy(walk,'Run',1.65),copy(find('Attack'),'Attack')];
 // Source has no hit takes. Preserve source idle/flying pose and add a short whole-body recoil.
 for(const [name,side]of [['Hit',0],['HitLeft',1],['HitRight',-1]]){
  const c=copy(idle,name);const ratio=.42/c.duration;for(const t of c.tracks)t.scale(ratio);c.duration=.42;
  const times=[0,.055,.14,.27,.42],angles=[0,1,.65,.18,0],q=[];
  for(const a of angles)q.push(...new THREE.Quaternion().setFromEuler(new THREE.Euler(-.11*a,side*.10*a,side*.16*a)).toArray());
  c.tracks.push(new THREE.QuaternionKeyframeTrack('insect_recoil.quaternion',times,q));clips.push(c);
 }
 clips.push(copy(find('Death'),'Death'));
 const floorCorrection={};
 for(const c of clips){
  mixer.stopAllAction();const action=mixer.clipAction(c);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
  const grid=new Set([0,c.duration]);for(let i=0;i<=Math.ceil(c.duration*60);i++)grid.add(Math.min(c.duration,i/60));for(const t of c.tracks)for(const time of t.times)grid.add(Math.min(c.duration,time));
  const times=[...grid].sort((a,b)=>a-b),values=[];let maxLift=0;
  for(const time of times){mixer.setTime(time);object.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(object,true),y=Math.max(0,.003-box.min.y);values.push(0,y,0);maxLift=Math.max(y,maxLift);}
  mixer.stopAllAction();c.tracks.push(new THREE.VectorKeyframeTrack('insect_floor.position',times,values));floorCorrection[c.name]={samples:times.length,maximumLift:maxLift};
 }
 // Contact marker is measured from the original attack tip's greatest forward reach.
 mixer.stopAllAction();const attack=clips.find(c=>c.name==='Attack');mixer.clipAction(attack).setLoop(THREE.LoopOnce,1).play();
 let contact=0,maxReach=-Infinity;const probe=object.getObjectByName(config.probe);
 for(let i=0;i<=180;i++){const t=attack.duration*i/180;mixer.setTime(t);object.updateMatrixWorld(true);const z=probe.getWorldPosition(v).z;if(z>maxReach){maxReach=z;contact=i/180;}}
 mixer.stopAllAction();mixer.clipAction(clips[0]).play();mixer.setTime(0);object.updateMatrixWorld(true);const size=new THREE.Box3().setFromObject(object,true).getSize(new THREE.Vector3());mixer.stopAllAction();
 return {object,clips,meta:{family:config.source,height:size.y,dimensions:size.toArray(),rig:`whole-source-${jointCount}-joint`,attackContact:contact,attackContactSource:`Measured maximum forward world-z of original ${config.probe} bone over 181 original Attack samples`,source:'Quaternius Easy Enemy Pack complete body and original skeletal animation',license:'CC0-1.0',provenance:{author:'Quaternius',license:'CC0-1.0',source:'https://quaternius.itch.io/animated-easy-enemies',archiveSha256:record.archiveSha256,sourceMember:record.archiveMember,sourceSha256:record.memberSha256,modifications:(fantasyRevision?'Complete source body, rig, native animation and UVs retained; wing contour, vertex palette and skinned veins revised by fantasy-wasp.mjs.':'Complete source geometry and UVs retained.')+' uniform scale and forward-axis rotation applied. FBXLoader converts source weights to normalized strongest four influences. Native locomotion preserved; Run is source locomotion at 1.65x; three hit clips add authored whole-body recoil to source idle/flying. No humanoid or animal-head grafting.',fantasyRevision,sourceSkinRepair,materialTranslation:{from:'MeshPhongMaterial',to:'MeshStandardMaterial',preserved:['color','opacity','transparent','side','alphaTest','depthWrite','vertexColors','map'],roughness:fantasyRevision?'Per-material fantasyPbr overrides':.85,metalness:fantasyRevision?'Per-material fantasyPbr overrides':0,transmission:false},floorLift:{track:'insect_floor.position',method:'Per-clip wrapper translation from complete deformed geometry floor; source key times plus 60 Hz samples',clearanceMeters:.003,changesSourceGeometry:false}},floorCorrection,nativeMotion:{sourceClips:native.map(c=>({name:c.name,duration:c.duration})),locomotion:walk.name,runTimeScale:1.65,mode:flying?'airborne':'ground',uniformSourceScale:scale,vertexCount:vertices},animationAcceptance:'CPU candidate; production visual and contact review required'}};
}
