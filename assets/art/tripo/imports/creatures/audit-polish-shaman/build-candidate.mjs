import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {Quaternion,Vector3} from 'three';
import sharp from 'sharp';
const dir='assets/art/tripo/imports/creatures/audit-polish-shaman';
const source=`${dir}/sources/creature_goblin_shaman.glb`;
const output=`${dir}/goblin-shaman-polish-candidate.glb`;
const sha=b=>createHash('sha256').update(b).digest('hex');
const builderSha256=sha(await readFile(`${dir}/build-candidate.mjs`));
const sourceBytes=await readFile(source);
if(sha(sourceBytes)!=='3cca8fe953e3b1dc59c948bd65d865497625b4567ba12f66a8d8a3d53069d421')throw new Error('Source changed');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc=await io.read(source),root=doc.getRoot();
const materials=root.listMaterials();
if(materials.length!==6||root.listSkins()[0].listJoints().length!==65||root.listAnimations().length!==8)throw new Error('Unexpected shaman source');
const texSpec=[
 {material:'MI_Superhero_Male',image:'goblin-skin-imagegen.png',runtime:'goblin-skin-2k.jpg',factor:[1,1,1,1]},
 {material:'MI_Peasant',image:'goblin-cloth-imagegen.png',runtime:'goblin-cloth-2k.jpg',factor:[.9,.87,.81,1]},
 {material:'MI_Knight',image:'goblin-scarf-imagegen.png',runtime:'goblin-scarf-2k.jpg',factor:[.9,.89,.84,1]}
];
const maps=[];
for(const spec of texSpec){
 const material=materials.find(m=>m.getName().includes(spec.material));
 if(!material)throw new Error(`Missing material ${spec.material}`);
 const imagegen=await readFile(`${dir}/${spec.image}`);
 const runtime=await sharp(imagegen).resize(2048,2048,{kernel:'lanczos3'}).jpeg({quality:91,chromaSubsampling:'4:4:4'}).toBuffer();
 await writeFile(`${dir}/${spec.runtime}`,runtime);
 material.getBaseColorTexture().setImage(runtime).setMimeType('image/jpeg').setName(`Goblin shaman imagegen ${spec.material} 2K`);
 material.setBaseColorFactor(spec.factor).setRoughnessFactor(.9);
 maps.push({material:material.getName(),imagegen:`${dir}/${spec.image}`,imagegenSha256:sha(imagegen),runtime:`${dir}/${spec.runtime}`,runtimeSha256:sha(runtime),width:2048,height:2048});
}
// The existing Attack has good staff-hand continuity but the free hand scarcely
// leaves its idle pose. Rotate the source left shoulder, upper arm and forearm
// through a short curse-release arc. Keep all other source channels untouched.
const attack=root.listAnimations().find(a=>a.getName()==='Attack');
const overlay=[
 {name:'clavicle_l',axis:new Vector3(1,0,0),radians:.35},
 {name:'upperarm_l',axis:new Vector3(0,0,1),radians:.65},
 {name:'lowerarm_l',axis:new Vector3(0,0,1),radians:.3},
 {name:'hand_l',axis:new Vector3(1,0,0),radians:-.16}
];
const envelope=[{time:0,value:0},{time:.10,value:.32},{time:.21,value:1},{time:.32,value:.58},{time:.42,value:.12},{time:.5,value:0}];
function amount(time){let i=1;while(i<envelope.length-1&&envelope[i].time<time)i++;const a=envelope[i-1],b=envelope[i],f=Math.max(0,Math.min(1,(time-a.time)/(b.time-a.time)));return a.value+(b.value-a.value)*f;}
const altered=[];
for(const entry of overlay){
 const channel=attack.listChannels().find(c=>c.getTargetNode().getName()===entry.name&&c.getTargetPath()==='rotation');
 if(!channel)throw new Error(`Missing attack rotation ${entry.name}`);
 const sampler=channel.getSampler(),times=sampler.getInput().getArray(),sourceArray=sampler.getOutput().getArray(),values=new Float32Array(sourceArray);
 let maxRadians=0;
 for(let i=0;i<times.length;i++){
  const radians=entry.radians*amount(times[i]);maxRadians=Math.max(maxRadians,Math.abs(radians));
  const q=new Quaternion(...values.slice(i*4,i*4+4)).multiply(new Quaternion().setFromAxisAngle(entry.axis,radians)).normalize();
  values.set(q.toArray(),i*4);
 }
 sampler.getOutput().setArray(values);
 altered.push({node:entry.name,axis:entry.axis.toArray(),peakRadians:entry.radians,sampledPeakRadians:maxRadians,keyCount:times.length});
}
const binary=await io.writeBinary(doc);await writeFile(output,binary);
const candidate={schema:'corealm-goblin-shaman-polish/1',id:'creature_goblin_shaman',displayName:'Goblin Shaman',status:'awaiting-root-lab-review',accepted:false,source:{file:source,sha256:sha(sourceBytes),bytes:sourceBytes.length,provenance:'Quaternius CC0 body, outfit and animations; Blink staff Standard Unity Asset Store EULA, per production manifest'},candidate:{file:output,sha256:sha(binary),bytes:binary.length,builderSha256,geometry:'preserved',skin:'preserved 65-joint source rig',maps,attack:{durationSeconds:.5,contactSeconds:.21,overlay:altered},animations:root.listAnimations().map(a=>a.getName()),productionTarget:source,strideCalibration:null},acceptance:{cpuValidated:false,labAccepted:false,worldIntegrated:false}};
await writeFile(`${dir}/catalog.json`,JSON.stringify(candidate,null,2)+'\n');
const lab={schema:'corealm-lab-asset-candidates/1',assets:[{id:candidate.id,file:'models/creature/creature_goblin_shaman.glb',pack:'corealm-goblin-shaman-polish',category:'character',is:candidate.displayName,tags:['creature','goblin','shaman','caster','candidate'],bytes:binary.length,sha256:sha(binary),builderSha256,size:{x:.47444,y:1.3284,z:1.50317},base:{x:-.26779,y:.002,z:-.90358},groundY:.002,triangles:19861,animations:candidate.candidate.animations,materials:materials.map(m=>m.getName()),attackSeconds:.5,contactNormalized:.42,strideCalibration:null,sourceProvenance:candidate.source,acceptance:{assetAudit:true,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false}}],files:{creature_goblin_shaman:'goblin-shaman-polish-candidate.glb'}};
await writeFile(`${dir}/lab-catalog.json`,JSON.stringify(lab,null,2)+'\n');
const promotion={schema:'corealm-creature-candidate-promotion/1',status:'awaiting-root-lab-review',accepted:false,assetId:candidate.id,creature:candidate.displayName,candidateFile:output,candidateSha256:sha(binary),candidateBytes:binary.length,builderFile:`${dir}/build-candidate.mjs`,builderSha256,productionFile:source,sourceProvenance:candidate.source,geometry:{size:lab.assets[0].size,base:lab.assets[0].base,groundY:lab.assets[0].groundY,triangles:lab.assets[0].triangles,skin:'preserved 65-joint source rig'},materials:lab.assets[0].materials,animations:lab.assets[0].animations,attack:{durationSeconds:.5,contactSeconds:.21,contactNormalized:.42},strideCalibration:null,cpuValidation:`${dir}/validation.json`,labCatalog:`${dir}/lab-catalog.json`,remainingAcceptance:['Inspect skin, garment, scarf, face and staff in the production creature lab at normal gameplay camera angles.','Compare Idle, Walk, Run and Attack; confirm the free hand clears the head at curse release without intersecting face or scarf.','Build after promotion to the production target.']};
await writeFile(`${dir}/promotion.json`,JSON.stringify(promotion,null,2)+'\n');
console.log(JSON.stringify({candidate:output,sha256:sha(binary),bytes:binary.length,maps,attack:altered},null,2));
