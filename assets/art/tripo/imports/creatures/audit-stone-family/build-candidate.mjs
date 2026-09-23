import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { Quaternion } from 'three';
import { deformedBounds } from '../../../../../../tools/creature-motion/validate-deformation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const sourceFile = path.join(repo, 'assets/art/tripo/imports/creatures/cragbound-keeper/models/creature_stone_golem.glb');
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const hash = b => createHash('sha256').update(b).digest('hex');
const sourceBytes = await readFile(sourceFile);
if (hash(sourceBytes) !== '38971e2e9d3daf6097b13758228bd254c66f3c870998881454528c32062c2ca3') throw new Error('Source changed');
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const mesh = root.listNodes().find(n => n.getMesh());
const primitive = mesh?.getMesh()?.listPrimitives()[0];
const skin = mesh?.getSkin();
const clips = root.listAnimations();
if (!primitive || skin?.listJoints().length !== 52 || !['Idle','Walk','Run','Attack','Hit','Death'].every(n => clips.some(c => c.getName() === n))) throw new Error('Unexpected rig or clips');
const weights = primitive.getAttribute('WEIGHTS_0');
const joints = primitive.getAttribute('JOINTS_0');
let minWeightSum = Infinity, maxWeightSum = -Infinity, maxJoint = -1;
for (let i=0;i<weights.getCount();i++) {
  const w=[], j=[]; weights.getElement(i,w); joints.getElement(i,j);
  const sum=w.reduce((a,b)=>a+b,0);
  minWeightSum=Math.min(minWeightSum,sum); maxWeightSum=Math.max(maxWeightSum,sum);
  for(let k=0;k<4;k++) if(w[k]>.01) maxJoint=Math.max(maxJoint,j[k]);
}
if(minWeightSum<.998 || maxWeightSum>1.002 || maxJoint>=52) throw new Error('Invalid skin weights');
const material=primitive.getMaterial();
const color=material.getBaseColorTexture();
const meta=await sharp(color.getImage()).metadata();
if(root.listTextures().length!==3 || meta.width!==2048 || meta.height!==2048) throw new Error('Expected native PBR atlas');
const source=await sharp(color.getImage()).ensureAlpha().raw().toBuffer();
const tile=await sharp(path.join(here,'textures/stone-golem-generated-sediment.png')).resize(2048,2048).ensureAlpha().raw().toBuffer();
const blend=Buffer.alloc(source.length);
for(let i=0;i<2048*2048;i++) {
  const p=i*4, brightness=(source[p]+source[p+1]+source[p+2])/3;
  const alpha=brightness<48 ? .34 : .72;
  for(let c=0;c<3;c++) blend[p+c]=Math.round(source[p+c]*(1-alpha)+tile[p+c]*alpha);
  blend[p+3]=source[p+3];
}
const atlas=await sharp(blend,{raw:{width:2048,height:2048,channels:4}}).removeAlpha().jpeg({quality:94,chromaSubsampling:'4:4:4'}).toBuffer();
await writeFile(path.join(here,'textures/stone-golem-layered-atlas.jpg'),atlas);
color.setImage(atlas).setMimeType('image/jpeg').setName('stone_golem_layered_generated_sediment');
const sceneRoot=root.listScenes()[0].listChildren()[0];
const priorScale=sceneRoot.getScale();
sceneRoot.setScale(priorScale.map(v=>v*(2.1/3.2)));

const rest=new Map(root.listNodes().map(n=>[n,{t:n.getTranslation(),r:n.getRotation(),s:n.getScale()}]));
function restore(){for(const [n,p] of rest)n.setTranslation(p.t).setRotation(p.r).setScale(p.s)}
const motion=[];
for(const clip of clips){
  const channels=clip.listChannels();
  const duration=Math.max(...channels.map(c=>{const a=c.getSampler().getInput().getArray();return a[a.length-1]}));
  const fractions=clip.getName()==='Attack'?Array.from({length:41},(_,i)=>i/40):[0,.125,.25,.375,.5,.625,.75,.875,1];
  const frames=[];
  for(const fraction of fractions){
    restore(); const t=duration*fraction;
    for(const ch of channels){
      const n=ch.getTargetNode(),s=ch.getSampler(),ts=s.getInput().getArray(),vs=s.getOutput().getArray(),kind=ch.getTargetPath(),stride=kind==='rotation'?4:3;
      let k=0;while(k<ts.length-2&&ts[k+1]<t)k++;
      const u=ts[k+1]>ts[k]?Math.min(1,Math.max(0,(t-ts[k])/(ts[k+1]-ts[k]))):0;
      let v;
      if(kind==='rotation')v=new Quaternion(...vs.slice(k*4,k*4+4)).slerp(new Quaternion(...vs.slice((k+1)*4,(k+1)*4+4)),u).toArray();
      else v=Array.from({length:3},(_,c)=>vs[k*3+c]*(1-u)+vs[(k+1)*3+c]*u);
      if(kind==='rotation')n.setRotation(v);else if(kind==='translation')n.setTranslation(v);else if(kind==='scale')n.setScale(v);
    }
    const bounds=deformedBounds(doc), size=bounds.max.map((v,i)=>v-bounds.min[i]);
    if(![...bounds.min,...bounds.max,...size].every(Number.isFinite)||size[1]>.1+3.5||size[1]<.5)throw new Error(`Bad ${clip.getName()} frame ${fraction}: ${JSON.stringify(bounds)}`);
    frames.push({fraction,bounds});
  }
  motion.push({clip:clip.getName(),duration,frames});
}
restore();
const bounds=deformedBounds(doc);
const out=await io.writeBinary(doc);
await writeFile(path.join(here,'stone-golem-candidate.glb'),out);
const roundtrip=await io.readBinary(out);
if(roundtrip.getRoot().listAnimations().length!==clips.length||roundtrip.getRoot().listTextures().length!==3)throw new Error('Roundtrip lost animation/PBR');
const result={schema:'corealm-stone-family/1',variants:[{
 id:'creature_stone_golem',status:'awaiting-root-lab-review',source:{file:path.relative(repo,sourceFile).replaceAll('\\','/'),sha256:hash(sourceBytes),tripoModelId:'00725e73-acb0-4633-a8b7-ee04d7c576e9'},
 production:{file:'game/public/assets/models/creature/creature_stone_golem.glb',sha256:'987f4f59e973922652a47aedc24849aa6646bab28b566e3285dd10b51f911e5e'},
 candidate:{file:'stone-golem-candidate.glb',sha256:hash(out),bytes:out.length,targetHeight:2.1,bounds,clips:clips.map(c=>c.getName()),weights:{vertices:weights.getCount(),minSum:minWeightSum,maxSum:maxWeightSum,maxJoint},motion},
 materials:{generatedTile:'textures/stone-golem-generated-sediment.png',layeredAtlas:'textures/stone-golem-layered-atlas.jpg',sourceNormalAndRoughnessPreserved:true,uvLayoutPreserved:true,imagegenPrompt:'Layered grey-taupe sediment and warm umber shale, quartz seams, olive/jade lichen, moss flecks, detailed erosion'},
 acceptance:{cpuMotionChecked:true,labAccepted:false,worldIntegrated:false}
 }],sourceGaps:[
 {id:'creature_boss_ordrun',status:'SOURCE_MISSING',reason:'Cragbound loses Quarry Warden architectural/quarry silhouette; existing boss is hollow and deformed, needs distinct imposing masonry quarry sentinel source.'},
 {id:'creature_ivory_castellan',status:'SOURCE_MISSING',reason:'Vault Custodian has plain block helmet, blue sash, no regal heraldry or arms; too generic for level-112 Ivory Castellan; needs ornate ivory/gold crowned construct source.'}
 ]};
await writeFile(path.join(here,'candidate.json'),JSON.stringify(result,null,2)+'\n');
await writeFile(path.join(here,'lab-catalog.json'),JSON.stringify({schema:'corealm-lab-asset-candidates/1',assets:[{
 id:'creature_stone_golem',file:'stone-golem-candidate.glb',pack:'corealm-tripo-audit-stone',category:'character',is:'Stone Golem candidate',
 tags:['creature','stone','tripo','candidate'],bytes:out.length,sha256:hash(out),triangles:6778,
 size:{x:bounds.max[0]-bounds.min[0],y:bounds.max[1]-bounds.min[1],z:bounds.max[2]-bounds.min[2]},
 base:{x:bounds.min[0],y:bounds.min[1],z:bounds.min[2]},groundY:bounds.min[1],animations:clips.map(c=>c.getName()),
 candidateReview:result.variants[0].acceptance
}],files:{creature_stone_golem:'stone-golem-candidate.glb'}},null,2)+'\n');
console.log(JSON.stringify({id:'creature_stone_golem',bytes:out.length,bounds,clips:clips.map(c=>c.getName()),motion:motion.map(m=>({clip:m.clip,duration:m.duration,frames:m.frames.length}))},null,2));
