import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { deformedBounds } from '../../../../../../tools/creature-motion/validate-deformation.js';
import { duration, storedPose, restorePose, applyClip } from '../../../../../../tools/creature-motion/pose.js';

const dir='assets/art/tripo/imports/creatures/audit-starhorn-hart';
const source='game/public/assets/models/fairy-garden/fairy_garden_hart_faeholme.glb';
const candidate=`${dir}/starhorn-hart-candidate.glb`;
const generated=`${dir}/starhorn-imagegen-atlas.png`;
const runtime=`${dir}/starhorn-runtime-atlas.jpg`;
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourceBytes=await readFile(source), generatedBytes=await readFile(generated);
const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
const original=manifest.assets.find(a=>a.id==='fairy_garden_hart_faeholme');
if(!original||original.sha256!==sha(sourceBytes))throw new Error('Source hart changed since inspection.');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc=await io.readBinary(sourceBytes), root=doc.getRoot();
const deer=root.listNodes().find(n=>n.getName()==='deer_body');
const antlers=root.listNodes().find(n=>n.getName()==='deer_horns');
if(!deer||!antlers||!deer.getSkin()||!antlers.getSkin()||antlers.getMesh().listPrimitives()[0].getAttribute('POSITION').getCount()!==397)throw new Error('Unexpected deer rig or native antlers.');
const material=root.listMaterials()[0], tex=material.getBaseColorTexture();
const originalAtlas=tex?.getImage();
if(!originalAtlas)throw new Error('Missing source atlas.');
const side=1254;
const base=await sharp(originalAtlas).resize(side,side).ensureAlpha().raw().toBuffer();
const paint=await sharp(generatedBytes).resize(side,side).ensureAlpha().raw().toBuffer();
for(let p=0;p<base.length;p+=4){
  const a=paint[p+3]/255;
  if(a<=0)continue;
  for(let c=0;c<3;c++)base[p+c]=Math.round(base[p+c]*(1-a)+paint[p+c]*a);
}
const atlas=await sharp(base,{raw:{width:side,height:side,channels:4}}).removeAlpha().jpeg({quality:94,chromaSubsampling:'4:4:4'}).toBuffer();
await writeFile(runtime,atlas);
tex.setImage(atlas).setMimeType('image/jpeg').setName('Starhorn layered violet constellation fur and opaline antlers');
material.setName('Starhorn fur and native moon-ivory antlers');
// The native skinned antler mesh is broadened toward its outer tines. Its bases,
// joints, skin weights, and all eight source clips remain attached to the head.
const position=antlers.getMesh().listPrimitives()[0].getAttribute('POSITION'), v=[];
for(let i=0;i<position.getCount();i++){
  position.getElement(i,v);
  const t=Math.max(0,Math.min(1,(v[1]-138.8723)/(186.7349-138.8723)));
  v[0]*=1+0.42*t;
  v[1]=138.8723+(v[1]-138.8723)*1.13;
  position.setElement(i,v);
}
const sceneRoot=root.listScenes()[0].listChildren()[0];
const scaleFactor=1.16;
sceneRoot.setScale([.01*scaleFactor,.01*scaleFactor,.01*scaleFactor]);
const pose=storedPose(doc);
const clips=root.listAnimations();
const motion=[];
for(const clip of clips){
  const length=duration(clip), samples=[];
  for(const part of [0,.25,.5,.75,1]){
    restorePose(pose);applyClip(clip,length*part);
    const b=deformedBounds(doc);
    samples.push({seconds:+(length*part).toFixed(4),minY:+b.min[1].toFixed(4),maxY:+b.max[1].toFixed(4),width:+(b.max[0]-b.min[0]).toFixed(4)});
  }
  motion.push({name:clip.getName(),seconds:length,channels:clip.listChannels().length,samples});
}
restorePose(pose);
const bounds=deformedBounds(doc);
if(bounds.min[1]<-.1||bounds.max[1]<2.15||bounds.max[1]>2.5)throw new Error(`Unexpected rest floor/height ${JSON.stringify(bounds)}`);
const bytes=await io.writeBinary(doc);await writeFile(candidate,bytes);
const triangles=root.listMeshes().reduce((s,m)=>s+m.listPrimitives().reduce((n,p)=>n+(p.getIndices()?.getCount()??0)/3,0),0);
const entry={id:original.id,file:original.file,pack:'corealm-starhorn-hart-candidate',category:'character',is:'Starhorn Hart',tags:[...new Set([...original.tags,'starhorn','image-generated-texture','candidate'])],bytes:bytes.length,sha256:sha(bytes),triangles,size:{x:bounds.max[0]-bounds.min[0],y:bounds.max[1]-bounds.min[1],z:bounds.max[2]-bounds.min[2]},base:{x:bounds.min[0],y:bounds.min[1],z:bounds.min[2]},bounds,groundY:bounds.min[1],animations:clips.map(c=>c.getName()),materials:root.listMaterials().map(m=>m.getName()),walkClipSeconds:duration(clips.find(c=>c.getName()==='Walk')),runClipSeconds:duration(clips.find(c=>c.getName()==='Run')),attackSeconds:duration(clips.find(c=>c.getName()==='Attack')),sourceProvenance:{sourceAssetId:original.id,sourceFile:source,sourceSha256:sha(sourceBytes),imagegenAtlas:generated,imagegenSha256:sha(generatedBytes),runtimeAtlas:runtime,runtimeAtlasSha256:sha(atlas),originalBodyGeometryRigWeightsAndClipsPreserved:true,nativeAntlerMeshSculpted:true,uniformScaleFactor:scaleFactor,candidateStatus:'awaiting-root-lab-review'},acceptance:{sourceIdentityVerified:true,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false}};
await writeFile(`${dir}/lab-catalog.json`,JSON.stringify({schema:'corealm-lab-asset-candidates/1',assets:[entry],files:{[original.id]:'starhorn-hart-candidate.glb'}},null,2));
await writeFile(`${dir}/validation.json`,JSON.stringify({schema:'corealm-starhorn-hart-cpu-validation/1',sourceSha256:sha(sourceBytes),candidateSha256:sha(bytes),restBounds:bounds,sourceBodyVertices:1880,nativeAntlerVertices:397,bodyJointCount:deer.getSkin().listJoints().length,antlerJointCount:antlers.getSkin().listJoints().length,animationClipsPreserved:clips.map(c=>c.getName()),motions:motion,floorNote:'CPU skinned bounds sampled at 0, 25, 50, 75, and 100 percent of each native clip. Browser pose and visual acceptance remain with root.'},null,2));
await writeFile(`${dir}/promotion.json`,JSON.stringify({schema:'corealm-creature-candidate-promotion/1',status:'awaiting-root-lab-review',accepted:false,assetId:original.id,creature:'Starhorn Hart',definition:'Starhorn Hart@115',candidateFile:candidate,productionFile:source,sourceProvenance:entry.sourceProvenance,cpuValidation:`${dir}/validation.json`,labCatalog:`${dir}/lab-catalog.json`,remainingAcceptance:['Inspect real gameplay-camera screenshots in the production feature lab.','Verify idle, walk, run, attack, hit, side hits and death semantic state in Chromium.','Confirm broadened native antlers and detailed coat read at gameplay distance.','Copy accepted model to production and run relevant build.']},null,2));
console.log(JSON.stringify({candidate,bytes:bytes.length,sha256:sha(bytes),bounds,clips:motion.map(m=>m.name)}));
