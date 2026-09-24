import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import * as THREE from 'three';

const here='assets/art/tripo/imports/creatures/audit-fairy-snails';
const hash=b=>createHash('sha256').update(b).digest('hex');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
const settings=[
  {id:'fairy_garden_snail_faeholme',label:'Starwhorl Snail',region:'faeholme',level:80,scale:4.5,output:'starwhorl-snail-faeholme.glb',sourceSha:'6faa87ac2e74ed71b4c796eaa36693388570932767e4c6b2607ebcdab303baf7'},
  {id:'fairy_garden_snail_gloamgarden',label:'Glimmercap Snail',region:'gloamgarden',level:34,scale:1,output:'glimmercap-snail-gloamgarden.glb',sourceSha:'32baa4db780b943a65c893ab0cd672ea0f1803316ab4105e3ac39684555b1b50'},
];
const atlasPath=`${here}/gloamgarden-generated-atlas.png`,atlasBytes=await readFile(atlasPath),atlasSha=hash(atlasBytes);
const generated=await sharp(atlasBytes).resize(2048,2048,{kernel:'lanczos3'}).jpeg({quality:95,mozjpeg:true,chromaSubsampling:'4:4:4'}).toBuffer();
const results=[];
for(const v of settings){
  const prior=manifest.assets.find(a=>a.id===v.id);assert(prior);
  const source=`game/public/assets/${prior.file}`,sourceBytes=await readFile(source);assert.equal(hash(sourceBytes),v.sourceSha);
  const doc=await io.readBinary(sourceBytes),root=doc.getRoot(),scene=root.listScenes()[0];
  const mesh=root.listMeshes()[0],primitive=mesh.listPrimitives()[0],meshNode=root.listNodes().find(n=>n.getMesh()===mesh),material=primitive.getMaterial();
  const sourcePos=primitive.getAttribute('POSITION').getArray().slice(),sourceNormal=primitive.getAttribute('NORMAL').getArray().slice(),sourceUv=primitive.getAttribute('TEXCOORD_0').getArray().slice();
  const sourceIndex=primitive.getIndices()?.getArray().slice()??null;
  if(v.region==='gloamgarden'){
    material.getBaseColorTexture().setImage(new Uint8Array(generated)).setMimeType('image/jpeg').setName('Glimmercap multicolor generated UV atlas');
    material.setName('Glimmercap pearlescent shell and mantle').setBaseColorFactor([1,1,1,1]).setMetallicFactor(.04).setRoughnessFactor(.86);
  }
  const wrapper=doc.createNode('SnailPresentation').setScale([v.scale,v.scale,v.scale]);
  const oldChildren=[...scene.listChildren()];for(const child of oldChildren){scene.removeChild(child);wrapper.addChild(child);}scene.addChild(wrapper);
  const originalClips=root.listAnimations();
  // The Gloam model's existing motion is real but especially subtle on the small actor.
  // Increase anatomically authored foot, head, and stalk arcs without moving the rigid shell.
  if(v.region==='gloamgarden')for(const clip of originalClips){
    const name=clip.getName();if(!['Walk','Run','Attack','Hit'].includes(name))continue;
    for(const channel of clip.listChannels()){
      if(channel.getTargetPath()!=='rotation')continue;
      const bone=channel.getTargetNode()?.getName()??'';
      const factor=name==='Attack'?(bone==='Head'||bone==='Neck'?1.55:bone.startsWith('Feelers')?1.7:1.2)
        :name==='Hit'?1.25:bone.startsWith('Foot')?2.0:bone==='Head'||bone==='Neck'?1.65:bone.startsWith('Eye')||bone.startsWith('Feelers')?1.55:1;
      const sampler=channel.getSampler(),values=sampler.getOutput().getArray().slice();
      for(let i=0;i<values.length;i+=4){const q=new THREE.Quaternion(...values.slice(i,i+4)).normalize(),angle=2*Math.acos(Math.max(-1,Math.min(1,q.w))),axis=new THREE.Vector3(q.x,q.y,q.z);
        if(axis.lengthSq()<1e-10)continue;axis.normalize();const changed=new THREE.Quaternion().setFromAxisAngle(axis,Math.min(Math.PI*.7,angle*factor));values.set(changed.toArray(),i);}
      sampler.getOutput().setArray(values);
    }
  }
  // Complete the native collapse early and hold the exact corpse pose for gameplay cleanup.
  const death=originalClips.find(c=>c.getName()==='Death');assert(death);
  const oldDuration=Math.max(...death.listChannels().map(c=>c.getSampler().getInput().getArray().at(-1)));
  const samplers=[...new Set(death.listChannels().map(c=>c.getSampler()))];
  const originalKeys=new Map([...new Set(samplers.map(s=>s.getInput()))].map(a=>[a,a.getArray().slice()]));
  const originalValues=new Map([...new Set(samplers.map(s=>s.getOutput()))].map(a=>[a,a.getArray().slice()]));
  for(const sampler of samplers){const keys=originalKeys.get(sampler.getInput()),values=originalValues.get(sampler.getOutput()),width=values.length/keys.length;
    assert(Number.isInteger(width)&&width>0,`Death sampler ${sampler.getInterpolation()} width ${width} in ${v.id}`);
    sampler.getOutput().setArray(Float32Array.from([...values,...values.slice(-width)]));
  }
  for(const [input,keys] of originalKeys){const mapped=Array.from(keys,t=>t/oldDuration*.65);mapped.push(1.5);input.setArray(Float32Array.from(mapped));}
  const buffer=root.listBuffers()[0];
  const collapseTimes=[0,.15,.35,.5,.65,1.5],collapseY=[1,.97,.88,.79,v.region==='faeholme'?.67:.7,v.region==='faeholme'?.67:.7];
  const collapseInput=doc.createAccessor('Death collapse times').setType(Accessor.Type.SCALAR).setArray(Float32Array.from(collapseTimes)).setBuffer(buffer);
  const collapseOutput=doc.createAccessor('Death collapse scales').setType(Accessor.Type.VEC3).setArray(Float32Array.from(collapseY.flatMap(y=>[v.scale,v.scale*y,v.scale]))).setBuffer(buffer);
  const collapseSampler=doc.createAnimationSampler('Death shell-forward settling').setInput(collapseInput).setOutput(collapseOutput);
  death.addSampler(collapseSampler).addChannel(doc.createAnimationChannel('Death settle').setTargetNode(wrapper).setTargetPath('scale').setSampler(collapseSampler));
  // CPU evaluation uses complete joint matrices and every weighted vertex, including the
  // large native Faeholme mesh; no root-bone-only floor shortcut.
  const authoredContext={meshNode,primitive};
  function sample(clip,time,ctx=authoredContext){const {meshNode,primitive}=ctx;
    const pose=new Map();if(clip)for(const ch of clip.listChannels()){
      if(!['rotation','translation','scale'].includes(ch.getTargetPath()))continue;
      const s=ch.getSampler(),t=s.getInput().getArray(),data=s.getOutput().getArray(),w=ch.getTargetPath()==='rotation'?4:3;
      let k=0;while(k<t.length-2&&t[k+1]<time)k++;const f=t[k+1]>t[k]?Math.max(0,Math.min(1,(time-t[k])/(t[k+1]-t[k]))):0;
      const a=Array.from(data.slice(k*w,(k+1)*w)),b=Array.from(data.slice((k+1)*w,(k+2)*w));
      const value=w===4?new THREE.Quaternion(...a).slerp(new THREE.Quaternion(...b),f).normalize().toArray():a.map((x,i)=>x*(1-f)+b[i]*f);
      const rec=pose.get(ch.getTargetNode())??{};rec[ch.getTargetPath()]=value;pose.set(ch.getTargetNode(),rec);
    }
    const worlds=new Map();const world=n=>{if(worlds.has(n))return worlds.get(n);const o=pose.get(n)??{},local=new THREE.Matrix4().compose(new THREE.Vector3().fromArray(o.translation??n.getTranslation()),new THREE.Quaternion().fromArray(o.rotation??n.getRotation()),new THREE.Vector3().fromArray(o.scale??n.getScale()));const parent=n.getParentNode(),m=parent?world(parent).clone().multiply(local):local;worlds.set(n,m);return m;};
    const skin=meshNode.getSkin(),joint=skin.listJoints(),ibm=skin.getInverseBindMatrices().getArray(),meshWorld=world(meshNode),inv=meshWorld.clone().invert();
    const mats=joint.map((j,i)=>inv.clone().multiply(world(j)).multiply(new THREE.Matrix4().fromArray(Array.from(ibm.slice(i*16,i*16+16)))).elements);
    const pos=primitive.getAttribute('POSITION').getArray(),ji=primitive.getAttribute('JOINTS_0').getArray(),we=primitive.getAttribute('WEIGHTS_0').getArray(),mw=meshWorld.elements;
    const result=new Float32Array(pos.length);let minY=Infinity,maxY=-Infinity;
    for(let i=0;i<pos.length/3;i++){const x=pos[i*3],y=pos[i*3+1],z=pos[i*3+2];let sx=0,sy=0,sz=0;
      for(let k=0;k<4;k++){const w=we[i*4+k];if(!w)continue;const m=mats[ji[i*4+k]];sx+=w*(m[0]*x+m[4]*y+m[8]*z+m[12]);sy+=w*(m[1]*x+m[5]*y+m[9]*z+m[13]);sz+=w*(m[2]*x+m[6]*y+m[10]*z+m[14]);}
      const wx=mw[0]*sx+mw[4]*sy+mw[8]*sz+mw[12],wy=mw[1]*sx+mw[5]*sy+mw[9]*sz+mw[13],wz=mw[2]*sx+mw[6]*sy+mw[10]*sz+mw[14];
      result.set([wx,wy,wz],i*3);minY=Math.min(minY,wy);maxY=Math.max(maxY,wy);
    }
    return {points:result,minY,maxY};
  }
  const beforeRest=sample(null,0),groundRest=beforeRest.minY;
  for(const clip of originalClips){const duration=clip.getName()==='Death'?1.5:Math.max(...clip.listChannels().map(c=>c.getSampler().getInput().getArray().at(-1)));
    const times=Array.from({length:65},(_,i)=>duration*i/64);if(clip.getName()==='Death')times.push(.65);times.sort((a,b)=>a-b);
    const correction=times.map(t=>Math.max(0,.003-sample(clip,t).minY));
    if(clip.getName()==='Death'){const at65=Math.max(0,.003-sample(clip,.65).minY);for(let i=0;i<times.length;i++)if(times[i]>=.65)correction[i]=at65;}
    const input=doc.createAccessor().setType(Accessor.Type.SCALAR).setArray(Float32Array.from(times)).setBuffer(buffer),output=doc.createAccessor().setType(Accessor.Type.VEC3).setArray(Float32Array.from(correction.flatMap(y=>[0,y,0]))).setBuffer(buffer);
    const sampler=doc.createAnimationSampler().setInput(input).setOutput(output);clip.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(wrapper).setTargetPath('translation').setSampler(sampler));
  }
  doc.createExtension(EXTMeshoptCompression).setRequired(true);
  const outputBytes=await io.writeBinary(doc),file=`${here}/${v.output}`;await writeFile(file,outputBytes);
  const check=await io.readBinary(outputBytes),checkPrim=check.getRoot().listMeshes()[0].listPrimitives()[0];
  for(const [label,a,b] of [['POSITION',sourcePos,checkPrim.getAttribute('POSITION').getArray()],['NORMAL',sourceNormal,checkPrim.getAttribute('NORMAL').getArray()],['TEXCOORD_0',sourceUv,checkPrim.getAttribute('TEXCOORD_0').getArray()]])assert.deepEqual(Array.from(b),Array.from(a),`${label} changed`);
  if(sourceIndex)assert.deepEqual(Array.from(checkPrim.getIndices().getArray()),Array.from(sourceIndex));
  assert(check.getRoot().listExtensionsRequired().some(e=>e.extensionName==='EXT_meshopt_compression'));
  const skin=check.getRoot().listSkins()[0],ji=checkPrim.getAttribute('JOINTS_0').getArray(),we=checkPrim.getAttribute('WEIGHTS_0').getArray();
  for(let i=0;i<checkPrim.getAttribute('POSITION').getCount();i++){let total=0;for(let k=0;k<4;k++){assert(ji[i*4+k]<skin.listJoints().length);total+=we[i*4+k];}assert(Math.abs(total-1)<1e-4);}
  const checkContext={meshNode:check.getRoot().listNodes().find(n=>n.getMesh()===check.getRoot().listMeshes()[0]),primitive:checkPrim};
  const serialized=check.getRoot().listAnimations(),motions=[];
  for(const clip of serialized){const duration=clip.getName()==='Death'?1.5:Math.max(...clip.listChannels().map(c=>c.getSampler().getInput().getArray().at(-1)));
    const frames=Array.from({length:65},(_,i)=>sample(clip,duration*i/64,checkContext));let minY=Math.min(...frames.map(f=>f.minY)),maxMove=0;
    for(const f of [frames[16],frames[32],frames[48]])for(let i=0;i<f.points.length;i++)maxMove=Math.max(maxMove,Math.abs(f.points[i]-frames[0].points[i]));
    motions.push({clip:clip.getName(),duration,minY,maxVertexDelta:maxMove,finalHeight:frames.at(-1).maxY-frames.at(-1).minY});
  }
  const serializedDeath=serialized.find(c=>c.getName()==='Death'),a=sample(serializedDeath,.65,checkContext),b=sample(serializedDeath,1.5,checkContext);let deathHold=0;for(let i=0;i<a.points.length;i++)deathHold=Math.max(deathHold,Math.abs(a.points[i]-b.points[i]));
  const worstFloor=Math.min(...motions.map(m=>m.minY));
  if(worstFloor<-.006||deathHold>.002)throw new Error(`${v.id}: weighted floor ${worstFloor} or Death hold ${deathHold} invalid`);
  const size={x:prior.size.x*v.scale,y:prior.size.y*v.scale,z:prior.size.z*v.scale};
  const base={x:prior.base.x*v.scale,y:0,z:prior.base.z*v.scale};
  const bounds={min:[base.x,0,base.z],max:[base.x+size.x,size.y,base.z+size.z]};
  const asset={...prior,id:v.id,file:`models/fairy-garden/${v.output}`,candidateFile:v.output,pack:v.region==='faeholme'?prior.pack:'corealm-audit-fairy-snails',is:v.label,
    tags:['creature','fairy','snail',v.region,'image-generated-texture','skinned','candidate'],bytes:outputBytes.length,sha256:hash(outputBytes),size,base,bounds,groundY:0,
    animations:serialized.map(c=>c.getName()),materials:[material.getName()],impliedWalkMps:v.region==='faeholme'?prior.impliedWalkMps*v.scale:null,impliedRunMps:v.region==='faeholme'?prior.impliedRunMps*v.scale:null,measuredGait:null,
    sourceProvenance:{...prior.sourceProvenance,auditSourceFile:source,auditSourceSha256:v.sourceSha,generatedAtlas:v.region==='gloamgarden'?atlasPath:prior.sourceProvenance?.generatedTexture?.file,generatedAtlasSha256:v.region==='gloamgarden'?atlasSha:prior.sourceProvenance?.generatedTexture?.sha256,geometry:'Original mesh, normals, UV and skin retained',motion:'Original anatomical clips, retimed Death; Gloam articulated arcs strengthened; CPU weighted floor correction'},
    metadata:{family:'fairy_snail',region:v.region,level:v.level,anatomy:'Spiral shell, long traveling foot, paired eyestalks; no floating accessories',desiredInGameHeightMeters:size.y,deathPose:'original native collapse reaches final pose by .65 s and holds to 1.5 s'},
    acceptance:{assetAudit:true,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false}};
  results.push({variant:v,asset,source:{file:source,sha256:v.sourceSha,bytes:sourceBytes.length},candidate:{file:v.output,bytes:outputBytes.length,sha256:hash(outputBytes)},restMinY:groundRest,worstFloor,deathHold,motions});
}
const pack={id:'corealm-audit-fairy-snails',name:'Corealm Gloamgarden Snail Art',author:'Corealm',source:`${here}/build-candidates.mjs`,generatorSha256:hash(await readFile(import.meta.filename)),license:'LicenseRef-Corealm-Original'};
const upstreamPack=manifest.packs.find(p=>p.id==='animal-pack-deluxe');assert(upstreamPack);
const assets=results.map(r=>r.asset),promotion={schema:'corealm-creature-promotion/1',packs:[upstreamPack,pack],assets,sourceRoot:here,destinationRoot:'game/public/assets',apply:false,prerequisite:'Root production lab state and normal-camera screenshot review of two snail variants and Death.'};
const lab={schema:'corealm-lab-asset-candidates/1',packs:[upstreamPack,pack],assets:assets.map(a=>({...a,candidateFile:path.resolve(here,a.candidateFile)})),files:Object.fromEntries(assets.map(a=>[a.id,path.resolve(here,a.candidateFile)]))};
const catalog={schema:'corealm-fairy-snail-candidates/1',accepted:false,status:'awaiting-root-lab-review',atlas:{file:atlasPath,sha256:atlasSha,prompt:'UV-locked imagegen edit: pearlescent mint, teal, lilac, rose, gold; preserve islands and fine snail surface detail'},results};
await Promise.all([writeFile(`${here}/promotion.json`,JSON.stringify(promotion,null,2)+'\n'),writeFile(`${here}/lab-catalog.json`,JSON.stringify(lab,null,2)+'\n'),writeFile(`${here}/catalog.json`,JSON.stringify(catalog,null,2)+'\n')]);
console.log(JSON.stringify(results.map(r=>({id:r.variant.id,file:r.candidate.file,bytes:r.candidate.bytes,height:r.asset.size.y,worstFloor:r.worstFloor,deathHold:r.deathHold,motions:r.motions})),null,2));
