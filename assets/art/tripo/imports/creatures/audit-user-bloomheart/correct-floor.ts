import {readFile,writeFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {storedPose,restorePose,applyClip,duration} from '../../../../../../tools/creature-motion/pose.js';
import {deformedBounds} from '../../../../../../tools/creature-motion/validate-deformation.js';

const dir='assets/art/tripo/imports/creatures/audit-user-bloomheart';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),results:any={};
for(const kind of (process.argv.includes('--sovereign-only')?['amethyst-sovereign']:['bloomheart-matriarch','amethyst-sovereign'])){
 const file=`${dir}/${kind}-candidate.glb`,doc=await io.read(file),rest=storedPose(doc),clips:any={};
 for(const clip of doc.getRoot().listAnimations()){
  if(clip.getName()==='Idle')continue;
  const motion=doc.getRoot().listNodes().find(n=>n.getName()==='BloomheartMotion');
  const channel=clip.listChannels().find(c=>c.getTargetNode()===motion&&c.getTargetPath()==='translation');
  if(!channel)throw Error('Motion translation channel missing');
  const samples=65,length=duration(clip),times=[],values=[],raw=[];
  for(let i=0;i<samples;i++){
   const t=length*i/(samples-1);restorePose(rest);applyClip(clip,t);
   const b=deformedBounds(doc),current=motion!.getTranslation(),raise=Math.max(0,(.006-b.min[1])/3.7);
   times.push(t);values.push(current[0],current[1]+raise,current[2]);raw.push(b.min[1]);
  }
  channel.getSampler().getInput().setArray(Float32Array.from(times));
  channel.getSampler().getOutput().setArray(Float32Array.from(values));
  clips[clip.getName()]={rawMinimumY:Math.min(...raw),maximumCorrectionMeters:Math.max(...values.filter((_,i)=>i%3===1))*3.7};
 }
 restorePose(rest);const bytes=await io.writeBinary(doc);await writeFile(file,bytes);results[kind]=clips;
}
await writeFile(dir+'/floor-correction.json',JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
