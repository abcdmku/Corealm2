import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {Quaternion,Vector3} from 'three';
import sharp from 'sharp';
import {deformedBounds} from '../../../../../../tools/creature-motion/validate-deformation.js';
import {duration} from '../../../../../../tools/creature-motion/pose.js';

const dir='assets/art/tripo/imports/creatures/audit-undead-family';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
const sha=data=>createHash('sha256').update(data).digest('hex');
const entries=[];

function entryFor(id, doc, bytes, candidateFile, provenance, preserveSourceBounds=false){
  const original=manifest.assets.find(a=>a.id===id);
  if(!original)throw new Error(`Missing current ${id}`);
  const root=doc.getRoot(),bounds=preserveSourceBounds?
    {min:[original.base.x,original.base.y,original.base.z],max:[original.base.x+original.size.x,original.base.y+original.size.y,original.base.z+original.size.z]}:
    deformedBounds(doc);
  const size=bounds.min.map((v,i)=>bounds.max[i]-v);
  return {
    id,file:original.file,pack:original.pack,category:'character',is:original.is,
    tags:[...new Set([...original.tags,'candidate','undead-polish'])],
    bytes:bytes.length,sha256:sha(bytes),triangles:root.listMeshes().reduce((n,m)=>n+m.listPrimitives().reduce((t,p)=>t+(p.getIndices()?.getCount()??0)/3,0),0),
    size:dict(size),base:dict(bounds.min),bounds,groundY:original.groundY,
    animations:root.listAnimations().map(a=>a.getName()),materials:root.listMaterials().map(m=>m.getName()),
    walkClipSeconds:duration(root.listAnimations().find(a=>a.getName()==='Walk')),
    runClipSeconds:duration(root.listAnimations().find(a=>a.getName()==='Run')),
    attackSeconds:duration(root.listAnimations().find(a=>a.getName()==='Attack')),
    sourceProvenance:provenance,
    acceptance:{sourceIdentityVerified:true,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false},
    candidateFile,
  };
}
const dict=v=>({x:v[0],y:v[1],z:v[2]});

// The promoted source already has a repaired 30-joint skin and detailed Tripo
// PBR maps. Preserve that exact geometry/rig/material setup, improving only
// the two clips the audit found hard to read in live play.
{
  const id='creature_banshee';
  const original=manifest.assets.find(a=>a.id===id);
  const source='assets/art/tripo/imports/creatures/starred-banshee/banshee-native-rig-candidate.glb';
  const input=await readFile(source);
  if(sha(input)!==original.sha256)throw new Error('Banshee production/source hash changed');
  const doc=await io.readBinary(input),root=doc.getRoot();
  const firstMesh=root.listMeshes()[0].listPrimitives()[0];
  const geometry={positions:sha(Buffer.from(firstMesh.getAttribute('POSITION').getArray().buffer)),indices:sha(Buffer.from(firstMesh.getIndices().getArray().buffer))};
  for(const animation of root.listAnimations()){
    const name=animation.getName();
    if(name!=='Walk'&&name!=='Run'&&name!=='Attack')continue;
    for(const channel of animation.listChannels()){
      const target=channel.getTargetNode()?.getName(),path=channel.getTargetPath();
      const accessor=channel.getSampler().getOutput(), values=Float32Array.from(accessor.getArray());
      const component=path==='translation'?3:4;
      if(path==='translation'&&target==='BansheeRoot'){
        const factor=name==='Attack'?1.6:name==='Walk'?2.1:1.35;
        for(let i=0;i<values.length;i+=component){values[i]*=factor;values[i+1]*=factor;values[i+2]*=factor;}
      }else if(path==='translation'&&target==='mixamorigHips'&&name!=='Attack'){
        const baseline=values[1];
        for(let i=0;i<values.length;i+=component)values[i+1]=baseline+(values[i+1]-baseline)*2.0;
      }else if(path==='rotation'){
        const factor=name==='Attack'?(target.includes('Arm')||target.includes('ForeArm')?1.42:1.25):
          target.includes('Mist')||target.includes('Shroud')?1.8:1.6;
        for(let i=0;i<values.length;i+=component){
          const q=new Quaternion(values[i],values[i+1],values[i+2],values[i+3]).normalize();
          const angle=2*Math.acos(Math.max(-1,Math.min(1,q.w)));
          const axis=new Vector3(q.x,q.y,q.z).normalize();
          const amplified=axis.lengthSq()<.5?new Quaternion():new Quaternion().setFromAxisAngle(axis,angle*factor);
          values.set([amplified.x,amplified.y,amplified.z,amplified.w],i);
        }
      }
      accessor.setArray(values);
    }
  }
  const post=root.listMeshes()[0].listPrimitives()[0];
  if(sha(Buffer.from(post.getAttribute('POSITION').getArray().buffer))!==geometry.positions||sha(Buffer.from(post.getIndices().getArray().buffer))!==geometry.indices)throw new Error('Banshee geometry changed');
  const bytes=await io.writeBinary(doc),file='banshee-motion-polish.glb';
  await writeFile(`${dir}/${file}`,bytes);
  entries.push(entryFor(id,doc,bytes,file,{sourceAssetId:id,sourceFile:source,sourceSha256:sha(input),
    tripoSourceFile:'assets/art/tripo/exports/88a36c89-9ab9-4471-a3df-f8158b6bd0a8.glb',
    tripoSourceSha256:'5df89799c3b9a27e0f151e2f93897de852a8cc780255ff9997d7c38a543495c7',
    changes:'Preserved repaired skin, source geometry and 2K PBR maps; amplified hover, shroud drift and visible claw attack rotations.'}));
}

// Ashen Ghoul is a POLISH verdict, and its good source rig/geometry/clips are
// retained. Two prompted image edits provide differentiated ash-burned skin
// and woven cloth rather than a flat tint of Grave Ghoul.
{
  const id='creature_grave_lantern';
  const original=manifest.assets.find(a=>a.id===id);
  const source=`game/public/assets/${original.file}`;
  const input=await readFile(source);
  if(sha(input)!==original.sha256)throw new Error('Ashen Ghoul source hash changed');
  const doc=await io.readBinary(input),root=doc.getRoot();
  const materials=root.listMaterials();
  const skin=materials.find(m=>m.getName().includes('MI_Superhero_Male'))?.getBaseColorTexture();
  const cloth=materials.find(m=>m.getName().includes('MI_Peasant'))?.getBaseColorTexture();
  if(!skin||!cloth||root.listSkins()[0]?.listJoints().length!==65)throw new Error('Unexpected Ashen Ghoul rig or UV layout');
  const originalCloth=cloth.getImage();
  const genSkin=await readFile(`${dir}/ashen-ghoul-skin-imagegen.png`);
  const genCloth=await readFile(`${dir}/ashen-ghoul-cloth-imagegen.png`);
  const runtimeSkin=await sharp(genSkin).resize(1024,1024).jpeg({quality:94,chromaSubsampling:'4:4:4'}).toBuffer();
  const painted=await sharp(genCloth).resize(1024,1024).removeAlpha().raw().toBuffer();
  const oldAlpha=await sharp(originalCloth).ensureAlpha().extractChannel('alpha').raw().toBuffer();
  const runtimeCloth=await sharp(painted,{raw:{width:1024,height:1024,channels:3}}).joinChannel(oldAlpha,{raw:{width:1024,height:1024,channels:1}}).png({compressionLevel:9}).toBuffer();
  skin.setImage(runtimeSkin).setMimeType('image/jpeg').setName('Ashen Ghoul layered ash and ember skin');
  cloth.setImage(runtimeCloth).setMimeType('image/png').setName('Ashen Ghoul charred woven cloth');
  await writeFile(`${dir}/ashen-ghoul-skin-runtime.jpg`,runtimeSkin);
  await writeFile(`${dir}/ashen-ghoul-cloth-runtime.png`,runtimeCloth);
  const bytes=await io.writeBinary(doc),file='ashen-ghoul-polish.glb';
  await writeFile(`${dir}/${file}`,bytes);
  entries.push(entryFor(id,doc,bytes,file,{sourceAssetId:id,sourceFile:source,sourceSha256:sha(input),
    sourceRigAndGeometryPreserved:true,sourceAnimationsPreserved:true,
    sourcePack:original.pack,sourceLicense:'CC0-1.0',
    imagegenSkin:`${dir}/ashen-ghoul-skin-imagegen.png`,imagegenSkinSha256:sha(genSkin),
    imagegenCloth:`${dir}/ashen-ghoul-cloth-imagegen.png`,imagegenClothSha256:sha(genCloth),
    runtimeSkinSha256:sha(runtimeSkin),runtimeClothSha256:sha(runtimeCloth),
    changes:'Layered ash-gray lesions, burnt umber fissures, soot, ember crevices and charred frayed cloth; original UVs, rig and eight clips retained.'},true));
}

const catalogue={schema:'corealm-lab-asset-candidates/1',assets:entries.map(({candidateFile,...entry})=>entry),files:Object.fromEntries(entries.map(e=>[e.id,e.candidateFile]))};
await writeFile(`${dir}/lab-catalog.json`,JSON.stringify(catalogue,null,2));
console.log(JSON.stringify(entries.map(e=>({id:e.id,file:e.candidateFile,bytes:e.bytes,sha256:e.sha256,clipNames:e.animations,size:e.size})),null,2));
