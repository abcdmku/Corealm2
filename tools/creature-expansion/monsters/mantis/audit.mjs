import fs from 'node:fs';
import * as THREE from 'three';
import { buildMantis } from '../mantis.mjs';
THREE.TextureLoader.prototype.load=function(url,onload){const t=new THREE.Texture();t.name=url;queueMicrotask(()=>onload?.(t));return t;};
globalThis.window={URL:URL};
globalThis.fetch=async(url)=>{try {const body=fs.readFileSync(String(url).replace(/^\//,''));return new Response(body,{status:200});}catch{return new Response('',{status:404});}};
const built=await buildMantis();const {object,clips}=built;
const report={meta:built.meta,clips:[],nodes:[]};
object.traverse(o=>{if(o.isBone)report.nodes.push(o.name);});
const p=new THREE.Vector3();
function measure(){object.updateMatrixWorld(true);const box=new THREE.Box3(); object.traverse(o=>{if(!o.isMesh)return; for(let j=0;j<o.geometry.attributes.position.count;j++){o.getVertexPosition(j,p).applyMatrix4(o.matrixWorld);box.expandByPoint(p);}});const bones={};for(const name of ['rootx','footl','footr','toes_01l','toes_01r','handl','handr','hand_dupli_001l','hand_dupli_001r','hand_dupli_002l','hand_dupli_002r','neckx','headx']){const n=object.getObjectByName(name);if(n)bones[name]=n.getWorldPosition(new THREE.Vector3()).toArray();}return {min:box.min.toArray(),max:box.max.toArray(),bones};}
for(const clip of clips){const mixer=new THREE.AnimationMixer(object);const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();const samples=[];for(let i=0;i<=12;i++){const time=clip.duration*i/12;mixer.setTime(time);samples.push({t:time,...measure()});}report.clips.push({name:clip.name,seconds:clip.duration,tracks:clip.tracks.length,keyframes:clip.tracks.reduce((a,t)=>a+t.times.length,0),samples});mixer.stopAllAction();mixer.uncacheRoot(object);}
fs.writeFileSync('test-results/creature-expansion/sources/monsters/mantis/motion-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({meta:report.meta,nodes:report.nodes,clips:report.clips.map(c=>({name:c.name,seconds:c.seconds,tracks:c.tracks,keys:c.keyframes,minY:Math.min(...c.samples.map(s=>s.min[1])),maxMinY:Math.max(...c.samples.map(s=>s.min[1])),height:Math.max(...c.samples.map(s=>s.max[1])),samples:c.samples.map(s=>({t:s.t,feet:[s.bones.footl,s.bones.footr],handL:s.bones.handl,handR:s.bones.handr}))}))},null,2));
