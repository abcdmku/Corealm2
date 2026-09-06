import * as THREE from 'three';
import {NodeIO} from '@gltf-transform/core';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

// Slice 05: freeze one complete-source Fox actor GLB into a review/promotion catalogue with
// measured bind bounds, measured stance speeds and full source provenance. CPU only.
// Usage: node tools/creature-expansion/mammals/stage-fox-candidate.mjs <input.glb> <batch-dir-name> "<scope>"
const [inputFile,batch,scope]=process.argv.slice(2);
if(!inputFile||!batch||!scope)throw Error('Usage: stage-fox-candidate.mjs <input.glb> <batch-dir-name> "<scope>"');
const root=new URL('../../../',import.meta.url),quadrupeds=new URL('art/rebuild/candidates/finish-quadrupeds/',root);
const bytes=await readFile(inputFile),sha=createHash('sha256').update(bytes).digest('hex');
const io=new NodeIO(),doc=await io.readBinary(bytes),rt=doc.getRoot(),nodes=rt.listNodes();
const objects=new Map(nodes.map(n=>[n,new THREE.Object3D()])),rest=new Map();
for(const n of nodes){const o=objects.get(n);o.name=n.getName();o.position.fromArray(n.getTranslation());o.quaternion.fromArray(n.getRotation());o.scale.fromArray(n.getScale());rest.set(n,{p:o.position.clone(),q:o.quaternion.clone(),s:o.scale.clone()});if(n.getParentNode())objects.get(n.getParentNode()).add(o);}
const tops=nodes.filter(n=>!n.getParentNode()).map(n=>objects.get(n)),update=()=>tops.forEach(o=>o.updateMatrixWorld(true));update();
const skin=rt.listSkins()[0],joints=skin.listJoints(),ibm=skin.getInverseBindMatrices();
const vertices=[];
for(const node of nodes)for(const p of node.getMesh()?.listPrimitives()??[]){const pos=p.getAttribute('POSITION'),J=p.getAttribute('JOINTS_0'),W=p.getAttribute('WEIGHTS_0');for(let i=0;i<pos.getCount();i++){const js=J.getElement(i,[]),ws=W.getElement(i,[]);vertices.push({p:new THREE.Vector3(...pos.getElement(i,[])),w:js.map((j,k)=>[j,ws[k]]).filter(x=>x[1]>0)});}}
const skinned=()=>{const mats=joints.map((j,i)=>objects.get(j).matrixWorld.clone().multiply(new THREE.Matrix4().fromArray(ibm.getElement(i,[]))).elements);const out=new Float64Array(vertices.length*3);for(let i=0;i<vertices.length;i++){const v=vertices[i];for(const [j,w] of v.w){const e=mats[j];out[i*3]+=w*(e[0]*v.p.x+e[4]*v.p.y+e[8]*v.p.z+e[12]);out[i*3+1]+=w*(e[1]*v.p.x+e[5]*v.p.y+e[9]*v.p.z+e[13]);out[i*3+2]+=w*(e[2]*v.p.x+e[6]*v.p.y+e[10]*v.p.z+e[14]);}}return out;};
const bounds=()=>{const s=skinned(),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<s.length;i+=3)for(let k=0;k<3;k++){min[k]=Math.min(min[k],s[i+k]);max[k]=Math.max(max[k],s[i+k]);}return {min,max};};
const clips=rt.listAnimations().map(a=>({name:a.getName(),duration:Math.max(...a.listSamplers().map(s=>Math.max(...s.getInput().getArray()))),channels:a.listChannels().map(c=>({node:c.getTargetNode(),path:c.getTargetPath(),times:Array.from(c.getSampler().getInput().getArray()),values:c.getSampler().getOutput()}))}));
function pose(clip,time){for(const [n,t]of rest){const o=objects.get(n);o.position.copy(t.p);o.quaternion.copy(t.q);o.scale.copy(t.s);}if(clip)for(const c of clip.channels){let i=0;while(i<c.times.length-2&&c.times[i+1]<time)i++;const t=THREE.MathUtils.clamp((time-c.times[i])/(c.times[i+1]-c.times[i]||1),0,1),a=c.values.getElement(i,[]),b=c.values.getElement(i+1,[]),o=objects.get(c.node);if(c.path==='rotation')o.quaternion.fromArray(a).slerp(new THREE.Quaternion().fromArray(b),t);else if(c.path==='translation')o.position.fromArray(a.map((n,k)=>THREE.MathUtils.lerp(n,b[k],t)));else if(c.path==='scale')o.scale.fromArray(a.map((n,k)=>THREE.MathUtils.lerp(n,b[k],t)));}update();}
// Bind bounds: the renderer places by manifest size/base; the deformed idle extent is reported separately.
pose(null,0);const bind=bounds();
// Stance speed on the same basis as build-creature-expansion.ts measureMotion: 96 samples per cycle,
// distal joint backward speed during the lowest 12% of its vertical travel.
const feet=['b_RightHand_08','b_LeftHand_011','b_LeftFoot02_018','b_RightFoot02_022'].map(name=>joints.find(j=>j.getName()===name));
const gait={},loops={};
// The Khronos source calls its resting clip Survey; the production renderer's own-clip idle row
// matches /^idle/i, so an adapted actor may ship it renamed. Resolve whichever this GLB carries.
const idleName=clips.some(c=>c.name==='Idle')?'Idle':'Survey';
for(const name of [idleName,'Walk','Run']){const clip=clips.find(c=>c.name===name);if(!clip)continue;
 let maxTranslationGap=0,maxRotationGap=0;for(const c of clip.channels){const first=c.values.getElement(0,[]),last=c.values.getElement(c.times.length-1,[]);if(c.path==='rotation')maxRotationGap=Math.max(maxRotationGap,new THREE.Quaternion().fromArray(first).angleTo(new THREE.Quaternion().fromArray(last)));else if(c.path==='translation')maxTranslationGap=Math.max(maxTranslationGap,Math.hypot(...first.map((v,i)=>v-last[i])));}
 loops[name]={seconds:clip.duration,maxTranslationGap,maxRotationGapRadians:maxRotationGap};
 if(name===idleName)continue;
 const count=96,dt=clip.duration/count,rows=feet.map(()=>[]);let minMeshY=Infinity;
 for(let i=0;i<=count;i++){pose(clip,i*dt);feet.forEach((f,k)=>rows[k].push(objects.get(f).getWorldPosition(new THREE.Vector3()).toArray()));const s=skinned();for(let j=1;j<s.length;j+=3)minMeshY=Math.min(minMeshY,s[j]);}
 const all=[],footRows=[];
 feet.forEach((f,k)=>{const r=rows[k],ys=r.map(v=>v[1]),low=Math.min(...ys),high=Math.max(...ys),threshold=low+Math.max(.008,(high-low)*.12),speeds=[];for(let i=1;i<r.length;i++)if(r[i][1]<=threshold&&r[i-1][1]<=threshold){const speed=-(r[i][2]-r[i-1][2])/dt;if(speed>.02)speeds.push(speed);}speeds.sort((a,b)=>a-b);all.push(...speeds);footRows.push({bone:f.getName(),minY:low,maxY:high,strideZ:Math.max(...r.map(v=>v[2]))-Math.min(...r.map(v=>v[2])),contactSamples:speeds.length,stanceMedianMps:speeds.length?speeds[Math.floor(speeds.length/2)]:null});});
 all.sort((a,b)=>a-b);gait[name.toLowerCase()]={seconds:clip.duration,sampledFootBones:feet.length,stanceSamples:all.length,measuredStanceMps:all.length?all[Math.floor(all.length/2)]:null,feet:footRows,minimumSkinnedMeshY:minMeshY};
}
const base=JSON.parse(await readFile(new URL('fox-adaptive-comparison/catalogue.json',quadrupeds),'utf8')).assets[0];
const size={x:bind.max[0]-bind.min[0],y:bind.max[1]-bind.min[1],z:bind.max[2]-bind.min[2]};
const materials=rt.listMaterials().map(m=>m.getName()),animations=rt.listAnimations().map(a=>a.getName());
let triangles=0;for(const m of rt.listMeshes())for(const p of m.listPrimitives())triangles+=(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3;
const asset={
 id:'creature_redbrush_fox',file:'models/creature/creature_redbrush_fox.glb',pack:'khronos-fox-complete-source',category:'character',
 is:'a red fox adapted from the complete Khronos sample Fox: narrow chest, pointed muzzle, tall ears, dark stockings, padded paws and a white-tipped brush',
 tags:['mammal','quadruped','fox','canid','woodland','complete-source','skinned'],
 bytes:bytes.length,sha256:sha,size,base:{x:bind.min[0],y:bind.min[1],z:bind.min[2]},bounds:bind,groundY:bind.min[1],triangles,animations,materials,
 sourceProvenance:{...base.sourceProvenance,modifications:[...base.sourceProvenance.modifications,'Slice 05: bind-pose distal paw reshape into padded four-lobed canid paws with preserved contact vertex set, skin weights, rig, clips and colours (paws-v2.mjs).']},
 impliedWalkMps:base.impliedWalkMps,impliedRunMps:base.impliedRunMps,walkClipSeconds:base.clipDurations.Walk,runClipSeconds:base.clipDurations.Run,
 attackSeconds:base.clipDurations.Attack,contactNormalized:Number((0.46/base.clipDurations.Attack).toFixed(6)),
 measuredGait:{gait,loops,basis:'96 samples per locomotion cycle; distal joint (Hand/Foot02) backward speed during the lowest 12 percent of its vertical travel, from the authored contact-corrected clips. Whole-mesh contact velocity evidence is in source-fox-adaptation review JSON; production movement review remains required.'},
 clipDurations:Object.fromEntries(clips.map(c=>[c.name,c.duration])),gameplayRoleProvenance:base.gameplayRoleProvenance,
 metadata:{is:'red fox (complete Khronos source adaptation)',source:'Khronos glTF-Sample-Assets Fox',license:'CC-BY-4.0 (rigging, animation, glTF conversion) over a CC0-1.0 model',rig:'original-khronos-fox-24-joint',idleClip:idleName,boneNames:joints.map(j=>j.getName()),authoringModule:'art/rebuild/candidates/finish-quadrupeds/source-fox-adaptation/*.mjs'},
 acceptance:{assetAudit:true,labAccepted:false,worldIntegrated:false},
};
const pack={id:'khronos-fox-complete-source',name:'Khronos glTF Sample Fox (complete source adaptation)',author:'PixelMannen (model); tomkranis (rigging and animation); @AsoboStudio and @scurest (glTF conversion)',
 source:'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox',license:'CC-BY-4.0',derivativeLicense:'CC-BY-4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',
 archiveSha256:'d97044e701822bac5a62696459b27d7b375aada5de8574ed4362edbba94771f7',sourceArchive:'Models/Fox/glTF-Binary/Fox.glb at commit 81e8b567643b5166e6ff40024e4ff71ad4b18676',upstreamPackId:'khronos-gltf-sample-assets-fox',
 attribution:'Fox by PixelMannen (model, CC0-1.0), rigging and animation by tomkranis (CC-BY-4.0), glTF conversion by @AsoboStudio and @scurest (CC-BY-4.0). Source: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox. Adapted for Corealm: controlled subdivision and paw/eye reshaping of the complete source body, vertex-colour coat, contact-corrected Walk/Run, and newly authored Attack, Hit, HitLeft, HitRight and Death on the original 24-joint rig. The adapted asset is distributed under CC BY 4.0; the original model portion remains CC0-1.0.',
 derivation:'Complete original mesh topology cage, rig, inverse binds and the three native clips (Survey/Idle, Walk, Run) retained, the resting clip renamed to Idle to match the production clip convention; Walk/Run contact-corrected; five gameplay clips authored on the native rig; geometry subdivided and reshaped at paws and eyes; source palette converted to vertex colours. See art/rebuild/candidates/finish-quadrupeds/source-fox for the unchanged source snapshot and provenance.json.'};
const dir=new URL(`${batch}/`,quadrupeds);await mkdir(dir,{recursive:true});
const fileName=`creature_redbrush_fox.${sha.slice(0,12)}.glb`;await copyFile(inputFile,new URL(fileName,dir));
const catalogue={schema:'corealm-asset-candidates/1',scope,packs:[pack],files:{creature_redbrush_fox:fileName},assets:[asset],
 origins:[{slot:'creature_redbrush_fox',inputFile:path.relative(process.cwd(),inputFile).replaceAll('\\','/'),sha256:sha,sourceSnapshot:'source-fox/provenance.json',sourceSha256:'d97044e701822bac5a62696459b27d7b375aada5de8574ed4362edbba94771f7'}]};
await writeFile(new URL('catalogue.json',dir),JSON.stringify(catalogue,null,2)+'\n');
console.log(JSON.stringify({batch,fileName,sha256:sha,bytes:bytes.length,size,groundY:bind.min[1],triangles,gait:Object.fromEntries(Object.entries(gait).map(([k,v])=>[k,{measuredStanceMps:v.measuredStanceMps,minimumSkinnedMeshY:v.minimumSkinnedMeshY,stanceSamples:v.stanceSamples}])),contactNormalized:asset.contactNormalized},null,2));
