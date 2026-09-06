import {readFile,writeFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {KHRONOS_EXTENSIONS} from '@gltf-transform/extensions';
import {loadNativeRatSource} from '../../../../../tools/creature-expansion/mammals/source-porcupine.mjs';
const dir=new URL('./',import.meta.url),io=new NodeIO().registerExtensions(KHRONOS_EXTENSIONS),{document:source}=await loadNativeRatSource(),candidate=await io.readBinary(await readFile(new URL('cdmir-badger-normalized.glb',dir)));
const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const sourceMeshes=source.getRoot().listNodes().filter(n=>n.getMesh()),candidateMeshes=candidate.getRoot().listNodes().filter(n=>n.getMesh());
let primitives=0,channels=0,rotationChannels=0;
for(const node of sourceMeshes){const target=candidateMeshes.find(n=>n.getName()===node.getName());if(!target)throw Error('Lost source mesh');for(const [i,p] of node.getMesh().listPrimitives().entries()){
 const q=target.getMesh().listPrimitives()[i];for(const attribute of ['JOINTS_0','WEIGHTS_0','TEXCOORD_0'])if(!equal(p.getAttribute(attribute).getArray(),q.getAttribute(attribute).getArray()))throw Error('Unexpected changed '+attribute);
 if(!equal(p.getIndices().getArray(),q.getIndices().getArray()))throw Error('Changed source topology');primitives++;
}}
const clips=[];for(const clip of source.getRoot().listAnimations()){
 const target=candidate.getRoot().listAnimations().find(a=>a.getName()===clip.getName());if(!target||target.listChannels().length!==clip.listChannels().length)throw Error('Native clip/channel missing');
 let duration=0;for(const channel of clip.listChannels()){
  const q=target.listChannels().find(c=>c.getTargetNode().getName()===channel.getTargetNode().getName()&&c.getTargetPath()===channel.getTargetPath());
  const a=channel.getSampler(),b=q.getSampler();if(a.getInterpolation()!==b.getInterpolation()||!equal(a.getInput().getArray(),b.getInput().getArray()))throw Error('Changed native timing');
  duration=Math.max(duration,a.getInput().getScalar(a.getInput().getCount()-1));
  if(channel.getTargetPath()!=='translation'){if(!equal(a.getOutput().getArray(),b.getOutput().getArray()))throw Error('Changed native rotation/scale');rotationChannels++;}channels++;
 }clips.push({name:clip.getName(),duration});
}
const motion=JSON.parse(await readFile(new URL('cdmir-badger-normalized-motion-readback.json',dir),'utf8'));
const report={sourceTopologyUVWeightsIntact:true,primitives,nativeTimingRotationScaleIntact:true,channels,rotationAndScaleChannels:rotationChannels,clips,finalByteSamples:motion.clips.reduce((s,c)=>s+c.samples.length,0),motionFloors:motion.clips.map(c=>({name:c.name,minimumY:Math.min(...c.samples.map(s=>s.min[1]))})),limits:['Walk dips up to 52.4mm and Die to60.1mm below rest floor in sampled motion. Not foot-contact acceptance.','16 head triangle normals turn more than90 degrees relative to source during rest jaw closure. Hardware mouth review required; no zero-area triangles.','Species visual review and runtime integration remain pending.']};
await writeFile(new URL('contract-audit.json',dir),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
