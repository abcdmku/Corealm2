/** Isolated wraith candidates; root owns browser acceptance and promotion. */
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {prune} from '@gltf-transform/functions';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import assert from 'node:assert/strict';
const out='test-results/wilderness-creatures/families/wraiths';
const art='assets/art/wilderness-creatures/wraiths/cloth-atlas-v1.png';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const source=await readFile(art),encoded=await sharp(source).resize(2048,2048).linear(1.12,18).jpeg({quality:94,chromaSubsampling:'4:4:4'}).toBuffer();
await mkdir(out,{recursive:true});
const only=process.argv.includes('--only')?process.argv[process.argv.indexOf('--only')+1]:null;
const catalog=only?JSON.parse(await readFile(`${out}/catalog.json`,'utf8')):{assets:[],files:{}};
for(const species of ['gloam_wraith','wraith','pallid_shade','banshee','revenant','veil_reaper','cinder_penitent'].filter(id=>!only||id===only)){
 const id=`creature_${species}`,entry=structuredClone(manifest.assets.find(a=>a.id===id));
 const sourceEntry=species==='gloam_wraith'?manifest.assets.find(a=>a.id==='creature_veil_reaper'):entry;
 const doc=await io.read(`game/public/assets/${sourceEntry.file}`),root=doc.getRoot();
 if(species==='gloam_wraith'){
  entry.metadata=structuredClone(sourceEntry.metadata);
  for(const key of ['attackSeconds','walkClipSeconds','runClipSeconds'])entry[key]=sourceEntry[key]*1.15;
  entry.contactNormalized=sourceEntry.contactNormalized;
  entry.size=Object.fromEntries(Object.entries(sourceEntry.size).map(([k,v])=>[k,v*1.18]));entry.base=Object.fromEntries(Object.entries(sourceEntry.base).map(([k,v])=>[k,v*1.18]));
  const seen=new Set();for(const a of root.listAnimations())for(const sampler of a.listSamplers()){const input=sampler.getInput();if(seen.has(input))continue;seen.add(input);input.setArray(Float32Array.from(input.getArray(),v=>v*1.15));}
  const scene=root.listScenes()[0],wrapper=doc.createNode('gloam_native_scale').setScale([1.18,1.18,1.18]);for(const n of scene.listChildren()){scene.removeChild(n);wrapper.addChild(n);}scene.addChild(wrapper);
 }
 const texture=doc.createTexture(`${species}_woven_burial_cloth`).setImage(encoded).setMimeType('image/jpeg');
 const edits=[];
 if(species==='gloam_wraith')edits.push('Detailed native Veil Reaper tailored robe, torn sleeves, articulated hands and original hood replace rejected shell/strip construction. Uniform1.18 size; native clips slowed1.15.');
 for(const node of root.listNodes()){
  const mesh=node.getMesh();if(!mesh)continue;
  const name=`${node.getName()} ${mesh.getName()}`;
  for(const p of mesh.listPrimitives()){
   const old=p.getMaterial(),role=old.getName();
   node.setName(`${species}_${node.getName()}`);mesh.setName(`${species}_${mesh.getName()||node.getName()}`);
   if(/empty_throat|slit_throat|gloam_tailored/.test(name))continue;
   const hand=/hooked_digit/.test(name)||/Regular_Male/.test(role);
   const hood=/cowl|Hood/.test(name)||(species==='cinder_penitent'&&/sealed_iron_face|burnt_high_collar/.test(name)),belt=/Belt/.test(name),armor=/Knight|pauldron/.test(role);
   if(species==='cinder_penitent'&&/blind_face_seam/.test(name)){p.setMaterial(old.clone().setName('cinder_penitent_dark_face_recess').setBaseColorTexture(null).setEmissiveTexture(null).setEmissiveFactor([0,0,0]).setBaseColorFactor([.012,.009,.013,1]).setRoughnessFactor(1));continue;}
   const tile=hand?3:hood?0:belt?2:species==='gloam_wraith'&&/Wizard_Body/.test(name)?0:species==='pallid_shade'||species==='banshee'?0:species==='revenant'?2:1;
   const material=old.clone().setName(`${species}_${hand?'ash_hands':hood?'ash_linen_cowl':belt?'aged_binding':armor?'worn_iron':'woven_shroud'}`);
   p.setMaterial(material);
   if(armor){material.setBaseColorFactor([.65,.53,.40,1]).setMetallicFactor(.55).setRoughnessFactor(.72);continue;}
   material.setBaseColorTexture(texture).setBaseColorFactor([1,1,1,1]).setAlphaMode('OPAQUE').setMetallicFactor(0).setRoughnessFactor(hand?.86:.96).setMetallicRoughnessTexture(null).setEmissiveTexture(null).setEmissiveFactor([0,0,0]);
   if(species==='cinder_penitent'&&hood)material.setBaseColorFactor([.75,.77,.79,1]).setRoughnessFactor(.88);
   // Native normal maps retain tailored seams; Gloam's rock-like maps are removed.

   const pos=p.getAttribute('POSITION'),min=pos.getMin([]),max=pos.getMax([]),uv=p.getAttribute('TEXCOORD_0');
   let coords;
   {coords=new Float32Array(pos.getCount()*2);const a=pos.getArray();for(let i=0;i<pos.getCount();i++){coords[i*2]=(a[i*3]-min[0])/Math.max(.01,max[0]-min[0]);coords[i*2+1]=1-(a[i*3+1]-min[1])/Math.max(.01,max[1]-min[1]);}}
   for(let i=0;i<coords.length;i+=2){coords[i]=(tile%2)*.5+.015+coords[i]*.47;coords[i+1]=Math.floor(tile/2)*.5+.015+coords[i+1]*.47;}
   p.setAttribute('TEXCOORD_0',(uv?uv.clone():doc.createAccessor().setBuffer(root.listBuffers()[0]).setType('VEC2')).setArray(coords));
   if(/Wizard_Body/.test(name)&&!belt){
    const a=Float32Array.from(pos.getArray());
    for(let i=0;i<a.length;i+=3){const y=a[i+1],hang=T.MathUtils.clamp((1.16-y)/1.03,0,1),waist=Math.exp(-Math.pow((y-1.12)/.22,2));a[i]*=1-.16*waist-.17*hang;a[i+2]*=1-.12*waist-.15*hang;if(a[i+2]<0)a[i+2]-=.075*hang*hang;}
    p.setAttribute('POSITION',pos.clone().setArray(a));recompute(p);edits.push('Narrowed waist and long shroud volume, swept rear hem; original ragged floor edge retained');
   }
   if(hood){const a=Float32Array.from(pos.getArray());for(let i=0;i<a.length;i+=3){const crown=T.MathUtils.clamp((a[i+1]-1.68)/.20,0,1);a[i]*=.96;a[i+1]+=.035*crown;a[i+2]-=.025*crown;}p.setAttribute('POSITION',pos.clone().setArray(a));recompute(p);edits.push('Slimmer drawn-back hood crown; front opening preserved');}
  }
 }
 await doc.transform(prune());
 if(species==='gloam_wraith'){
  const bare=await io.readBinary(await io.writeBinary(doc));for(const m of bare.getRoot().listMaterials())m.setBaseColorTexture(null).setNormalTexture(null).setEmissiveTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null);await bare.transform(prune());
  const bytes=await io.writeBinary(bare),g=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const skinned=[];g.scene.traverse(n=>{if(n.isSkinnedMesh)skinned.push(n);});assert(skinned.length>0,'Gloam must load as actual skinned meshes');
  const mixer=new T.AnimationMixer(g.scene),clip=g.animations.find(c=>c.name==='Attack');assert(clip,'Gloam Attack clip missing');mixer.clipAction(clip).play();
  const sample=t=>{mixer.setTime(t);g.scene.updateMatrixWorld(true);return skinned.flatMap(n=>{n.skeleton.update();return Array.from({length:Math.min(80,n.geometry.attributes.position.count)},(_,i)=>n.getVertexPosition(i,new T.Vector3()).applyMatrix4(n.matrixWorld).toArray()).flat();});};
  const a=sample(0),b=sample(clip.duration*.52);assert(a.every(Number.isFinite)&&b.every(Number.isFinite));assert(a.some((v,i)=>Math.abs(v-b[i])>.01),'Gloam attack must deform actual rendered vertices');console.log(`Gloam CPU GLTFLoader proof: ${skinned.length} skinned meshes; Attack changes world vertices`);
 }
 const file=`${id}.glb`;await io.write(`${out}/${file}`,doc);const bytes=await readFile(`${out}/${file}`);
 Object.assign(entry,{bytes:bytes.length,sha256:hash(bytes),triangles:root.listMeshes().reduce((sum,m)=>sum+m.listPrimitives().reduce((n,p)=>n+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0),materials:root.listMaterials().map(m=>m.getName()),acceptance:{exported:true,labAccepted:false,worldIntegrated:false}});
 entry.metadata.familyRefinement={family:'wraiths',generator:'tools/wilderness-creatures/families/wraiths.mjs',sourceAssetId:sourceEntry.id,sourceAssetSha256:sourceEntry.sha256,atlas:art,atlasSha256:hash(source),edits:[...new Set(edits)],scope:'Woven shrouds, pale linen cowls and ash hands; opaque readable surfaces. Existing joints, weights and animation clips retained. No whole-body emission; spectral particles remain production effects.'};
 const previous=catalog.assets.findIndex(a=>a.id===id);if(previous>=0)catalog.assets[previous]=entry;else catalog.assets.push(entry);catalog.files[id]=file;console.log(`${id}: ${hash(bytes)}`);
 function recompute(p){const g=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(p.getAttribute('POSITION').getArray(),3));if(p.getIndices())g.setIndex(new T.BufferAttribute(p.getIndices().getArray(),1));g.computeVertexNormals();p.setAttribute('NORMAL',p.getAttribute('NORMAL').clone().setArray(g.getAttribute('normal').array));g.dispose();}
}
await writeFile(`${out}/catalog.json`,JSON.stringify(catalog,null,2)+'\n');
