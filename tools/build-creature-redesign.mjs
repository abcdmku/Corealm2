import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {prune} from '@gltf-transform/functions';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

const out='test-results/creature-redesign'; await mkdir(out,{recursive:true});
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
const args=process.argv.slice(2),textureDir='art/creature-redesign';await mkdir(textureDir,{recursive:true});
const chalkPath=path.join(textureDir,'chalk-warden-albedo.png');
const hollowPath=path.join(textureDir,'hollow-bough-albedo.png');
if(args.includes('--chalk'))await copyFile(args[args.indexOf('--chalk')+1],chalkPath);
if(args.includes('--hollow'))await copyFile(args[args.indexOf('--hollow')+1],hollowPath);
const variants=[
 {id:'chalk_warden',base:'shale_elemental',axes:[1.16,.82,1.13],tempo:1.16,texture:chalkPath},
 {id:'hollow_bough',base:'mossback_sentinel',axes:[.84,1.08,.88],tempo:1.12,texture:hollowPath},
 {id:'pallid_shade',base:'wraith',axes:[.88,1.18,.92],tempo:1.22},
];
const catalogue={assets:[],files:{}};
for(const v of variants){
 const parent=manifest.assets.find(a=>a.id===`creature_${v.base}`),doc=await io.read(`game/public/assets/${parent.file}`),root=doc.getRoot();
 if(v.id==='hollow_bough') for(const node of root.listNodes()){
   if(node.getMesh()?.listPrimitives().every(p=>p.getMaterial()?.getName().endsWith('_Tree')))node.setMesh(null);
 }
 for(const scene of root.listScenes()){
   const children=scene.listChildren();const shape=doc.createNode(`${v.id}_whole_body`).setScale(v.axes);
   for(const child of children){scene.removeChild(child);shape.addChild(child);}scene.addChild(shape);
 }
 if(v.id==='pallid_shade'){
   const idle=root.listAnimations().find(a=>a.getName()==='Idle');
   for(const name of ['Walk','Run']){
     root.listAnimations().find(a=>a.getName()===name)?.dispose();
     const hover=doc.createAnimation(name);
     for(const source of idle.listChannels()){
       const sampler=source.getSampler();
       const copy=doc.createAnimationSampler().setInput(sampler.getInput()).setOutput(sampler.getOutput()).setInterpolation(sampler.getInterpolation());
       hover.addSampler(copy).addChannel(doc.createAnimationChannel().setTargetNode(source.getTargetNode()).setTargetPath(source.getTargetPath()).setSampler(copy));
     }
   }
   const duration=Math.max(...idle.listSamplers().flatMap(s=>Array.from(s.getInput().getArray())));
   const wrapper=root.listNodes().find(n=>n.getName()===`${v.id}_whole_body`),buffer=root.listBuffers()[0];
   for(const animation of root.listAnimations().filter(a=>['Idle','Walk','Run'].includes(a.getName()))){
     const times=doc.createAccessor().setType('SCALAR').setArray(Float32Array.from({length:25},(_,i)=>i/24*duration)).setBuffer(buffer);
     const positions=doc.createAccessor().setType('VEC3').setArray(Float32Array.from(Array.from({length:25},(_,i)=>[0,.06+.045*Math.sin(i/24*Math.PI*2),0]).flat())).setBuffer(buffer);
     const bob=doc.createAnimationSampler().setInput(times).setOutput(positions).setInterpolation('LINEAR');
     animation.addSampler(bob).addChannel(doc.createAnimationChannel().setTargetNode(wrapper).setTargetPath('translation').setSampler(bob));
   }
 }
 for(const mat of root.listMaterials()){
   mat.setName(mat.getName().replaceAll(v.base,v.id));
   if(v.texture && !mat.getName().endsWith('_Tree')){
     const texture=doc.createTexture(`${v.id}_authored_uv_albedo`).setImage(await readFile(v.texture)).setMimeType('image/png');
     mat.setBaseColorTexture(texture).setBaseColorFactor([1,1,1,1]).setRoughnessFactor(.95);
   }
   if(v.id==='pallid_shade'){
     mat.setBaseColorFactor([.83,.9,1,.72]).setAlphaMode('BLEND').setDoubleSided(true);
     // Only this apparition has a faint internal light. Stone and wood stay opaque and unlit.
     mat.setEmissiveFactor([.07,.09,.12]).setMetallicFactor(0).setRoughnessFactor(1);
   }
 }
 // Slow the complete native takes, retaining their contact/recovery proportions and skeleton.
 const retimed=new Set();
 for(const animation of root.listAnimations())for(const sampler of animation.listSamplers()){
   const input=sampler.getInput();if(!input||retimed.has(input))continue;
   retimed.add(input);input.setArray(Float32Array.from(input.getArray(),t=>t*v.tempo));
 }
 await doc.transform(prune());
 const assetId=`creature_${v.id}`,filename=`${assetId}.glb`;await io.write(path.join(out,filename),doc);
 const bytes=await readFile(path.join(out,filename));
 const asset={...structuredClone(parent),id:assetId,file:`models/creature/${filename}`,is:v.id.replaceAll('_',' '),
   bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),
   size:Object.fromEntries(['x','y','z'].map((a,i)=>[a,parent.size[a]*v.axes[i]])),
   base:Object.fromEntries(['x','y','z'].map((a,i)=>[a,parent.base[a]*v.axes[i]])),
   materials:root.listMaterials().map(m=>m.getName()),
   triangles:root.listMeshes().reduce((n,m)=>n+m.listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0),
   walkClipSeconds:clipSeconds('Walk'),runClipSeconds:clipSeconds('Run'),attackSeconds:clipSeconds('Attack'),
   impliedWalkMps:parent.impliedWalkMps?v.axes[2]*parent.impliedWalkMps/v.tempo:undefined,
   impliedRunMps:parent.impliedRunMps?v.axes[2]*parent.impliedRunMps/v.tempo:undefined,
   metadata:{...parent.metadata,redesign:{sourceAssetId:parent.id,sourceSha256:parent.sha256,
     axes:v.axes,clipTimeMultiplier:v.tempo,removedLeafCanopy:v.id==='hollow_bough',albedo:v.texture??null,
     generator:'tools/build-creature-redesign.mjs'}},acceptance:{exported:true,labAccepted:false,worldIntegrated:false}};
 catalogue.assets.push(asset);catalogue.files[assetId]=filename;console.log(`${v.id}: ${asset.triangles} triangles`);
 function clipSeconds(name){return Math.max(...root.listAnimations().find(a=>a.getName()===name).listSamplers().flatMap(s=>Array.from(s.getInput().getArray())));}
}
await writeFile(path.join(out,'catalog.json'),JSON.stringify(catalogue,null,2)+'\n');
