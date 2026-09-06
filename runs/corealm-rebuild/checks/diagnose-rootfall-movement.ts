import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import * as THREE from 'three';
import {Navigation} from '../../../game/src/systems/navigation.js';
import {Movement} from '../../../game/src/systems/movement.js';
import {EventBus} from '../../../game/src/core/events.js';
import {createInitialState} from '../../../game/src/state/store.js';
import {assembleFeatureLabStructure} from '../../../game/src/featureLab/structures.js';
import {buildRootfallNavigationSources} from '../../../game/src/render/rootfallNavigation.js';
import type {Vec3} from '../../../game/src/contracts.js';
import {WorldScene} from '../../../game/src/render/scene.js';
import {COMBAT_LAB_BOOT_PROFILE,GAME_BOOT_PROFILE} from '../../../game/src/app/bootProfile.js';
import {ROOTFALL_STUMP} from '../../../game/src/world/rootfallStump.js';

const loaded = new Map<string,THREE.Group>();
for (const id of ['corealm_stump_oak','stairs_exterior']) {
 const file=id.startsWith('corealm')?'corealm/nature/'+id:'building/'+id;
 const document=await new NodeIO().registerExtensions(ALL_EXTENSIONS).read('game/public/assets/models/'+file+'.glb');
 const group=new THREE.Group();
 for(const node of document.getRoot().listNodes()) for(const primitive of node.getMesh()?.listPrimitives()??[]) {
  const positions=primitive.getAttribute('POSITION')!;
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions.getArray()!,3));
  const indices=primitive.getIndices(); if(indices)geometry.setIndex(Array.from(indices.getArray()!));
  geometry.applyMatrix4(new THREE.Matrix4().fromArray(node.getWorldMatrix()));
  group.add(new THREE.Mesh(geometry));
 }
 loaded.set(id,group);
}
const worldMode=process.argv[2]?.startsWith('world')??false;
const origin:Vec3=worldMode?[60+Number(process.argv[5]??0),8.29,120+Number(process.argv[6]??0)]:[-8,0,12];
const fixture=assembleFeatureLabStructure({kind:'composition',id:'rootfall_stump',kit:'timber',width:6,depth:6,seed:1},origin);
const stretch=worldMode?Number(process.argv[3]??1):1;
const widen=worldMode?Number(process.argv[4]??1):1;
const stretchedFront=ROOTFALL_STUMP.stairFrontZ+(ROOTFALL_STUMP.stairFlights-1)*2*ROOTFALL_STUMP.stairScale*(stretch-1);
if(stretch!==1||widen!==1)for(const entity of fixture.entities){
 const index=Number(entity.id.match(/#step_(\d+)$/)?.[1]??0)-1;
 if(index<0)continue;
 const distance=stretchedFront-index*2*ROOTFALL_STUMP.stairScale*stretch;
 entity.position=[origin[0]+Math.sin(ROOTFALL_STUMP.stairYaw)*distance,entity.position[1],origin[2]+Math.cos(ROOTFALL_STUMP.stairYaw)*distance];
 entity.view!.scaleAxes=[widen,1,stretch];
}
if(process.argv[2]==='four'){
 const stairs=fixture.entities.filter(e=>e.id.includes('#step_'));
 if(stairs.length===3){const fourth=structuredClone(stairs[2]!);fourth.id=fourth.id.replace('#step_3','#step_4');fixture.entities.push(fourth);stairs.push(fourth);}
 const scale=3.5272/3.818;
 const front=Number(process.argv[3]??5.9);
 stairs.forEach((entity,index)=>{entity.position=[-8,index*scale,12+front-index*2*scale];entity.view!.scale=scale;});
}
const seamLowering=['four','tops','world','world-sweep','coarse'].includes(process.argv[2]??'')?0:Number(process.argv[2]??0);
for(const entity of fixture.entities){
 const step=Number(entity.id.match(/#step_(\d+)$/)?.[1]??0);
 if(step>1)entity.position=[entity.position[0],entity.position[1]-(step-1)*seamLowering,entity.position[2]];
}
const sources=await buildRootfallNavigationSources({load:async id=>loaded.get(id)!,instance:id=>loaded.get(id)!.clone(true)},fixture.entities);
if(process.argv[2]==='tops')for(const mesh of sources.meshes){
 if(!String(mesh.userData['structureNavigation']).includes('#step_'))continue;
 const original=mesh.geometry,index=original.index!,position=original.getAttribute('position'),kept:number[]=[];
 for(let i=0;i<index.count;i+=3){
  const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)];
  const [a,b,c]=ids.map(id=>new THREE.Vector3().fromBufferAttribute(position,id));
  if(b!.sub(a!).cross(c!.sub(a!)).normalize().y>.5)kept.push(...ids);
 }
 mesh.geometry=original.clone();mesh.geometry.setIndex(kept);
}
const world=new WorldScene(new THREE.Scene());
const terrain=world.buildWorld((worldMode?GAME_BOOT_PROFILE:COMBAT_LAB_BOOT_PROFILE).terrain());
await Navigation.initLibrary();
if(process.argv[2]==='world-sweep'){
 const box=new THREE.Box3();for(const mesh of terrain)box.expandByObject(mesh);
 const sin=Math.sin(ROOTFALL_STUMP.stairYaw),cos=Math.cos(ROOTFALL_STUMP.stairYaw),approach=stretchedFront+4;
 for(const phase of [0,.04,.08,.12,.16]){
  const y=Math.floor(box.min.y/.2)*.2-.4+phase,x=box.min.x+2,z=box.min.z+2;
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([x,y,z,x+.1,y,z,x,y,z+.1],3));
  const anchor=new THREE.Mesh(geometry),nav=new Navigation();
  if(!nav.build([...terrain,...sources.meshes,anchor]))throw new Error('Phase navigation failed');
  const bounds=sources.meshes.map(mesh=>new THREE.Box3().setFromObject(mesh).expandByScalar(.35));
  const state=createInitialState();state.player.position=[origin[0]+approach*sin,origin[1],origin[2]+approach*cos];
  const movement=new Movement(nav,new EventBus(),{heightAt:(_region,x,z)=>world.heightAtXZ(x,z),preserveNavigationHeight:p=>bounds.some(b=>b.containsPoint(new THREE.Vector3(...p)))});
  const along=(p:Vec3)=>(p[0]-origin[0])*sin+(p[2]-origin[2])*cos;
  let crest:Vec3|null=null,maxStep=0,maxRise=0,lateral=0;
  for(const [forward,destination]of [[1,.5],[-1,approach]]){
   movement.setDirectInput({forward:forward!,strafe:0,cameraYaw:ROOTFALL_STUMP.stairYaw});
   for(let tick=0;tick<120&&forward!*(along(state.player.position)-destination!)>0;tick++){
    const before=state.player.position;movement.update(state,100,tick*100);const p=state.player.position;
    maxStep=Math.max(maxStep,Math.hypot(p[0]-before[0],p[2]-before[2]));maxRise=Math.max(maxRise,Math.abs(p[1]-before[1]));
    lateral=Math.max(lateral,Math.abs((p[0]-origin[0])*cos-(p[2]-origin[2])*sin));
   }
   if(forward===1){if(along(state.player.position)>.5)break;crest=[...state.player.position];}
  }
  console.log(JSON.stringify({phase,anchorY:y,widen,crest,end:state.player.position,maxStep,maxRise,lateral,passed:crest!==null&&along(state.player.position)>=approach&&Math.abs(state.player.position[1]-origin[1])<.02}));
 }
 process.exit(0);
}
const nav=new Navigation();if(!nav.build([...terrain,...sources.meshes],'auto',process.argv[2]==='coarse'?{cs:.45}:{}))throw new Error('Navigation failed');
const bounds=sources.meshes.map(mesh=>new THREE.Box3().setFromObject(mesh).expandByScalar(.35));
const preserve=(p:Vec3)=>bounds.some(b=>p[0]>=b.min.x&&p[0]<=b.max.x&&p[1]>=b.min.y&&p[1]<=b.max.y&&p[2]>=b.min.z&&p[2]<=b.max.z);
const yaw=process.argv[2]==='four'?0:ROOTFALL_STUMP.stairYaw;
const sin=Math.sin(yaw),cos=Math.cos(yaw);
const along=(point:Vec3)=>(point[0]-origin[0])*sin+(point[2]-origin[2])*cos;
const approach=(process.argv[2]==='four'?Number(process.argv[3]??5.9):stretchedFront)+4;
const state=createInitialState();state.player.position=[origin[0]+approach*sin,origin[1],origin[2]+approach*cos];
const movement=new Movement(nav,new EventBus(),{heightAt:(_region,x,z)=>world.heightAtXZ(x,z),preserveNavigationHeight:preserve});
const closest=nav.closestPoint.bind(nav);let queries:unknown[]=[];
nav.closestPoint=(point:Vec3)=>{const snapped=closest(point);queries.push({point,snapped});return snapped;};
movement.setDirectInput({forward:1,strafe:0,cameraYaw:yaw});
for(let tick=0;tick<80;tick++) {
 queries=[];const before=[...state.player.position];movement.update(state,100,tick*100);
 console.log(JSON.stringify({tick,before,after:state.player.position,queries}));
 if(along(state.player.position)<=.5)break;
 if(tick>5&&Math.hypot(...before.map((v,i)=>v-state.player.position[i]!))<.001)break;
}
if(along(state.player.position)<=.5){
 movement.setDirectInput({forward:-1,strafe:0,cameraYaw:yaw});
 for(let tick=0;tick<100;tick++){
  queries=[];const before=[...state.player.position];movement.update(state,100,(tick+80)*100);
  console.log(JSON.stringify({descent:tick,before,after:state.player.position,queries}));
  if(along(state.player.position)>=approach)break;
 }
}
console.log(JSON.stringify({fixtureSolids:fixture.solids,stairs:fixture.entities.filter(e=>e.id.includes('#step')).map(e=>({id:e.id,position:e.position,view:e.view}))}));
const ray=new THREE.Raycaster();
for(let distance=ROOTFALL_STUMP.stairFrontZ+1;distance>=0;distance-=.2){
 const x=origin[0]+distance*sin,z=origin[2]+distance*cos;
 ray.set(new THREE.Vector3(x,origin[1]+8,z),new THREE.Vector3(0,-1,0));
 const hits=ray.intersectObjects(sources.meshes,false).map(hit=>({y:hit.point.y,id:hit.object.userData['structureNavigation']}));
 console.log(JSON.stringify({distance,x,z,geometry:hits,navLow:closest([x,origin[1]+1,z]),navHigh:closest([x,origin[1]+3.5,z])}));
}
