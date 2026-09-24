import {readFile,writeFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {storedPose,restorePose,applyClip,duration} from '../../../../../../tools/creature-motion/pose.js';
import {deformedBounds} from '../../../../../../tools/creature-motion/validate-deformation.js';

const dir='assets/art/tripo/imports/creatures/audit-user-bloomheart';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const result:any={};
for(const kind of ['bloomheart-matriarch','amethyst-sovereign']){
 const file=`${dir}/${kind}-candidate.glb`;
 try {await readFile(file);} catch {continue;}
 const doc=await io.read(file),rest=storedPose(doc);
 const clips:any={};
 for(const clip of doc.getRoot().listAnimations()){
  const length=duration(clip),samples=[];
  for(let i=0;i<=16;i++){
   restorePose(rest);applyClip(clip,length*i/16);
   const bounds=deformedBounds(doc);
   samples.push({seconds:+(length*i/16).toFixed(4),minY:bounds.min[1],maxY:bounds.max[1],bounds});
  }
  clips[clip.getName()]={seconds:length,samples,minimumY:Math.min(...samples.map(s=>s.minY)),finalHeight:samples.at(-1).maxY-samples.at(-1).minY};
 }
 restorePose(rest);result[kind]=clips;
}
await writeFile(`${dir}/motion-audit.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([k,v]:any)=>[k,Object.fromEntries(Object.entries(v).map(([n,c]:any)=>[n,{seconds:c.seconds,minY:c.minimumY,finalHeight:c.finalHeight}]))])),null,2));
