import { NodeIO } from '@gltf-transform/core';
import fs from 'node:fs';
import * as THREE from 'three';
import { buildWraps } from './wraps.js';
const d=await new NodeIO().read('game/public/assets/models/character/base_male.glb');
const s=d.getRoot().listSkins()[0]!;
if(process.argv.includes('--anatomy'))console.log(JSON.stringify(s.listJoints().filter(n=>/hand_l|lowerarm_l|thumb.*_l|index.*_l|middle.*_l|ring.*_l|pinky.*_l/.test(n.getName())).map(n=>({name:n.getName(),p:n.getWorldTranslation()})),null,2));
const p=JSON.parse(fs.readFileSync('tools/item-models/core/body-profile.json','utf8'));
if(process.argv.includes('--anatomy'))for(const k of ['leftArm','leftHand'])console.log(k,JSON.stringify(p[k].filter((v:any)=>v.level>.48).map((v:any)=>({x:v.level,c:v.center,y:[Math.min(...v.outline.map((v:any)=>v[0])),Math.max(...v.outline.map((v:any)=>v[0]))],z:[Math.min(...v.outline.map((v:any)=>v[1])),Math.max(...v.outline.map((v:any)=>v[1]))]}))));
const material = new THREE.MeshStandardMaterial();
const g = buildWraps({cloth:material,scales:material,silver:material,lining:material,gem:material,sole:material,thread:material});
let vertices=0,triangles=0,meshes=0;
const bones=new Set(s.listJoints().map(j=>j.getName()));
g.traverse(o=>{if(!(o instanceof THREE.Mesh))return;meshes++;const p=o.geometry.getAttribute('position');vertices+=p.count;triangles+=(o.geometry.index?.count??p.count)/3;if(!Array.from(p.array).every(Number.isFinite))throw new Error('Nonfinite '+o.name);const bone=o.userData.itemModelBone;if(bone&&!bones.has(bone))throw new Error('Bad bone '+bone);});
console.log({meshes,vertices,triangles,bounds:new THREE.Box3().setFromObject(g)});
const cloth = g.children.find(o=>o.name==='starhide-wrap-left-hand-shell') as THREE.Mesh;
cloth.material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});cloth.updateMatrixWorld();
for(const child of g.children.filter(o=>/ l .*four-point knuckle motif$/.test(o.name)||/ l .*fingertip scale panel$/.test(o.name))){
 if(!(child instanceof THREE.Mesh))continue;const b=new THREE.Box3().setFromObject(child),c=b.getCenter(new THREE.Vector3());
 const hit=new THREE.Raycaster(new THREE.Vector3(c.x,1.65,c.z),new THREE.Vector3(0,-1,0)).intersectObject(cloth)[0];
 console.log(child.name, 'boundsY',b.min.y,b.max.y,'center',c.toArray(),'native top',hit?.point.y);
}
const cuff=g.children.find(o=>o.name==='Starhide l slim pointed indigo bracer shell') as THREE.Mesh;
const panel=g.children.find(o=>o.name==='Starhide l dorsal iridescent overlapping scale inset') as THREE.Mesh;
cuff.material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});cuff.updateMatrixWorld();
let minimum=Infinity,behind=0,hits=0;
const pp=panel.geometry.getAttribute('position');
for(let i=0;i<pp.count;i++){
 const pt=new THREE.Vector3().fromBufferAttribute(pp,i),normal=new THREE.Vector3(0,pt.y-1.447,pt.z+.075).normalize();
 const hit=new THREE.Raycaster(pt.clone().addScaledVector(normal,.02),normal.clone().negate()).intersectObject(cuff)[0];
 if(hit&&hit.distance<.035){const clearance=hit.distance-.02;minimum=Math.min(minimum,clearance);hits++;if(clearance<0)behind++;}
}
console.log({bracerPanelClearance:minimum,behind,hits});
