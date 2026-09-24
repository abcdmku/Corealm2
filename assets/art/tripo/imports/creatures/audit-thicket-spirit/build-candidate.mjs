import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import * as THREE from 'three';

const here = 'assets/art/tripo/imports/creatures/audit-thicket-spirit';
const source = 'assets/art/tripo/imports/creatures/audit-owned-plant-downloads/thicketwalker-64833df9-8eee-437f-9010-9ca3483dc015.glb';
const sourceSha = '1e41b47c9a4b80de1e828a8d45ec75220e7cdcc7eb017c37a776d4b37eee44f0';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const sourceBytes = await readFile(source);
assert.equal(hash(sourceBytes), sourceSha, 'Pinned thicket source changed');
const sourceDoc = await io.readBinary(sourceBytes);
const original = sourceDoc.getRoot().listMeshes()[0].listPrimitives()[0];
const oldPosition = original.getAttribute('POSITION').getArray();
const oldIndex = original.getIndices().getArray();
assert.equal(oldPosition.length / 3, 5303);
assert.equal(oldIndex.length / 3, 3889);
assert.equal(sourceDoc.getRoot().listSkins().length, 0);
assert.equal(sourceDoc.getRoot().listAnimations().length, 0);
const sourceTex = original.getMaterial().getBaseColorTexture();
assert(sourceTex && !original.getMaterial().getNormalTexture() && !original.getMaterial().getMetallicRoughnessTexture());
const basecolor = await sharp(sourceTex.getImage()).resize(2048, 2048, {kernel:'lanczos3'}).jpeg({quality:94,mozjpeg:true,chromaSubsampling:'4:4:4'}).toBuffer();
const bones = [
  ['Root',null,[0,0,0],'root',1], ['Pelvis','Root',[0,.53,-.24],'body',.18], ['Spine','Pelvis',[0,.55,0],'body',.20],
  ['Chest','Spine',[0,.55,.23],'body',.18], ['Neck','Chest',[0,.62,.35],'head',.14], ['Face','Neck',[0,.64,.43],'head',.12],
  ['CanopyBase','Spine',[0,.77,0],'canopy',.23], ['CanopyCrown','CanopyBase',[0,.91,.08],'canopy',.25],
  ...['L','R'].flatMap((side,i) => {const x=i===0?-.29:.29;return [
    [`FrontUpper_${side}`,'Chest',[x,.48,.29],`front${side}`,.12], [`FrontLower_${side}`,`FrontUpper_${side}`,[x,.28,.32],`front${side}`,.105], [`FrontFoot_${side}`,`FrontLower_${side}`,[x,.075,.34],`front${side}`,.09],
    [`HindUpper_${side}`,'Pelvis',[x,.48,-.29],`hind${side}`,.12], [`HindLower_${side}`,`HindUpper_${side}`,[x,.27,-.32],`hind${side}`,.105], [`HindFoot_${side}`,`HindLower_${side}`,[x,.075,-.33],`hind${side}`,.09],
  ];}),
].map(([name,parent,p,group,sigma])=>({name,parent,p,group,sigma}));
const byName = new Map(bones.map((b,i)=>[b.name,i]));
const q=(axis,angle)=>new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...({x:[1,0,0],y:[0,1,0],z:[0,0,1]}[axis])),angle).toArray();
const outputs=[];
for(const variant of [
  {id:'fairy_monster_21',name:'Thicket Spirit',level:46,region:'faeholme',scale:1.9,file:'thicket-spirit.glb'},
]) {
  const doc=await io.readBinary(sourceBytes), root=doc.getRoot(), mesh=root.listMeshes()[0], prim=mesh.listPrimitives()[0];
  const meshNode=root.listNodes().find(n=>n.getMesh()===mesh), buffer=root.listBuffers()[0];
  // Rigid basis change: source +X (face) -> +Z, source Y shifted to ground.
  const position=prim.getAttribute('POSITION').getArray();
  for(let i=0;i<position.length;i+=3){const x=position[i],z=position[i+2];position[i]=-z;position[i+1]+=.499755859375;position[i+2]=x;}
  const normal=prim.getAttribute('NORMAL')?.getArray();
  if(normal)for(let i=0;i<normal.length;i+=3){const x=normal[i],z=normal[i+2];normal[i]=-z;normal[i+2]=x;}
  const originalRotated=position.slice();
  const container=doc.createNode('ThicketSpiritContainer').setScale([variant.scale,variant.scale,variant.scale]);
  root.listScenes()[0].addChild(container); root.listScenes()[0].removeChild(meshNode); container.addChild(meshNode);
  meshNode.setName('ThicketSpiritMesh');
  const nodes=new Map();
  for(const b of bones){const parent=b.parent?bones[byName.get(b.parent)]:null;const local=parent?b.p.map((v,i)=>v-parent.p[i]):b.p;
    const node=doc.createNode(b.name).setTranslation(local);(b.parent?nodes.get(b.parent):container).addChild(node);nodes.set(b.name,node);}
  const skin=doc.createSkin('ThicketSpiritQuadruped').setSkeleton(nodes.get('Root'));
  for(const b of bones)skin.addJoint(nodes.get(b.name));
  const bind=new Float32Array(bones.length*16);
  for(let i=0;i<bones.length;i++){const [x,y,z]=bones[i].p;bind.set([1,0,0,0,0,1,0,0,0,0,1,0,-x,-y,-z,1],i*16);}
  skin.setInverseBindMatrices(doc.createAccessor('InverseBind').setType(Accessor.Type.MAT4).setArray(bind).setBuffer(buffer));meshNode.setSkin(skin);
  const joints=new Uint16Array(position.length/3*4),weights=new Float32Array(joints.length),influences=new Uint32Array(bones.length);
  for(let v=0;v<position.length/3;v++){
    const p=[position[v*3],position[v*3+1],position[v*3+2]];
    const allow=new Set(['body','head','canopy']);
    if(p[1]<.58){const side=p[0]<0?'L':'R',group=(p[2]>=0?'front':'hind')+side;
      const nearest=Math.min(...bones.filter(b=>b.group===group).map(b=>Math.hypot(...p.map((c,i)=>c-b.p[i]))));
      if(nearest<.23)allow.add(group);
    }
    const scores=bones.map((b,i)=>({i,score:allow.has(b.group)?Math.exp(-.5*(Math.hypot(...p.map((c,a)=>c-b.p[a]))/b.sigma)**2):0})).filter(s=>s.score>1e-9).sort((a,b)=>b.score-a.score).slice(0,4);
    assert(scores.length>0,`No weights at vertex ${v}`);const total=scores.reduce((s,a)=>s+a.score,0);let sum=0;
    scores.forEach((s,k)=>{const w=k===scores.length-1?1-sum:s.score/total;joints[v*4+k]=s.i;weights[v*4+k]=w;influences[s.i]++;sum+=w;});
  }
  prim.setAttribute('JOINTS_0',doc.createAccessor('Joints').setType(Accessor.Type.VEC4).setArray(joints).setBuffer(buffer));
  prim.setAttribute('WEIGHTS_0',doc.createAccessor('Weights').setType(Accessor.Type.VEC4).setArray(weights).setBuffer(buffer));
  const material=prim.getMaterial();material.setName('Thicket bark moss mushroom and luminous eyes').setMetallicFactor(0).setRoughnessFactor(.82);
  material.getBaseColorTexture().setImage(new Uint8Array(basecolor)).setMimeType('image/jpeg').setName('Tripo layered thicket art 2K');
  const clips=[];
  function add(name,duration,times,tracks){const animation=doc.createAnimation(name);clips.push({name,duration,animation});
    for(const [bone,path,values] of tracks){const input=doc.createAccessor(`${name}_${bone}_${path}_times`).setType(Accessor.Type.SCALAR).setArray(Float32Array.from(times)).setBuffer(buffer);
      const output=doc.createAccessor(`${name}_${bone}_${path}_values`).setType(path==='rotation'?Accessor.Type.VEC4:Accessor.Type.VEC3).setArray(Float32Array.from(values.flat())).setBuffer(buffer);
      const sampler=doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(nodes.get(bone)).setTargetPath(path).setSampler(sampler));}
  }
  const gait=(m,phase)=>[0,.25,.5,.75,1].map(t=>q('x',Math.sin((t+phase)*Math.PI*2)*m));
  add('Idle',2.8,[0,.7,1.4,2.1,2.8],[['Spine','rotation',[0,.018,0,-.018,0].map(a=>q('x',a))],['CanopyCrown','rotation',[0,.025,0,-.025,0].map(a=>q('z',a))],['Face','rotation',[0,-.025,0,.025,0].map(a=>q('y',a))]]);
  for(const [name,duration,amp] of [['Walk',1.16,.24],['Run',.74,.43]]){
    const tracks=[];for(const side of ['L','R'])for(const part of ['Front','Hind']){const phase=(part==='Front')===(side==='L')?0:.5;
      tracks.push([`${part}Upper_${side}`,'rotation',gait(amp,phase)]);
      tracks.push([`${part}Lower_${side}`,'rotation',[0,.25,.5,.75,1].map(t=>q('x',-.23*Math.max(0,Math.sin((t+phase)*Math.PI*2))))]);}
    tracks.push(['Spine','rotation',gait(.025,0)]);tracks.push(['CanopyBase','rotation',gait(.018,.25)]);
    add(name,duration,[0,.25,.5,.75,1].map(t=>t*duration),tracks);
  }
  add('Attack',.86,[0,.18,.43,.62,.86],[['Root','translation',[[0,0,0],[0,.035,0],[0,.045,.12],[0,.02,.07],[0,0,0]]],['Neck','rotation',[0,-.13,.30,.16,0].map(a=>q('x',a))],['Face','rotation',[0,-.11,.38,.14,0].map(a=>q('x',a))],['FrontUpper_L','rotation',[0,-.08,.35,.17,0].map(a=>q('x',a))],['FrontUpper_R','rotation',[0,-.08,.35,.17,0].map(a=>q('x',a))]]);
  add('Hit',.48,[0,.1,.22,.48],[['Spine','rotation',[0,-.18,.09,0].map(a=>q('x',a))],['Neck','rotation',[0,-.25,.12,0].map(a=>q('x',a))],['CanopyCrown','rotation',[0,.16,-.08,0].map(a=>q('z',a))]]);
  const deathTimes=[0,.15,.34,.5,.65,1.5],dead=[0,-.18,-.52,-1.04,-1.42,-1.42];
  const deathTracks=[['Root','rotation',dead.map(a=>q('z',a))],['Root','scale',[[1,1,1],[.96,.94,1],[.82,.72,1],[.68,.49,1],[.6,.38,1],[.6,.38,1]]],['Spine','rotation',[0,.08,.19,.25,.27,.27].map(a=>q('x',a))],['Neck','rotation',[0,.09,.23,.42,.49,.49].map(a=>q('x',a))],['CanopyBase','rotation',[0,-.05,-.16,-.29,-.33,-.33].map(a=>q('x',a))]];
  for(const side of ['L','R'])for(const part of ['Front','Hind'])deathTracks.push([`${part}Upper_${side}`,'rotation',[0,.06,.17,.28,.34,.34].map(a=>q('x',a))]);
  add('Death',1.5,deathTimes,deathTracks);
  // Evaluate the weighted mesh at a dense set of times, then author vertical root correction.
  const bindPose={meshNode,skin,bind,position,joints,weights};
  function pose(clip,time,ctx=bindPose){const {meshNode,skin,bind,position,joints,weights}=ctx;const overrides=new Map();for(const channel of clip.listChannels()){const sampler=channel.getSampler(),t=sampler.getInput().getArray(),a=sampler.getOutput().getArray(),w=channel.getTargetPath()==='rotation'?4:3;let k=0;while(k<t.length-2&&t[k+1]<time)k++;const u=t[k+1]>t[k]?(time-t[k])/(t[k+1]-t[k]):0;const va=Array.from(a.slice(k*w,(k+1)*w)),vb=Array.from(a.slice((k+1)*w,(k+2)*w));let value;
      if(w===4)value=new THREE.Quaternion(...va).slerp(new THREE.Quaternion(...vb),u).toArray();else value=va.map((x,i)=>x*(1-u)+vb[i]*u);
      const rec=overrides.get(channel.getTargetNode())??{};rec[channel.getTargetPath()]=value;overrides.set(channel.getTargetNode(),rec);}
    const matrices=new Map();const world=n=>{if(matrices.has(n))return matrices.get(n);const o=overrides.get(n)??{};const local=new THREE.Matrix4().compose(new THREE.Vector3().fromArray(o.translation??n.getTranslation()),new THREE.Quaternion().fromArray(o.rotation??n.getRotation()),new THREE.Vector3().fromArray(o.scale??n.getScale()));const parent=n.getParentNode();const m=parent?world(parent).clone().multiply(local):local;matrices.set(n,m);return m;};
    const meshWorld=world(meshNode),inverse=meshWorld.clone().invert(),jointMatrices=skin.listJoints().map((n,i)=>inverse.clone().multiply(world(n)).multiply(new THREE.Matrix4().fromArray(Array.from(bind.slice(i*16,i*16+16)))));
    const pts=new Float32Array(position.length),p=new THREE.Vector3(),weighted=new THREE.Vector3();let minY=Infinity,maxY=-Infinity;
    for(let v=0;v<position.length/3;v++){p.fromArray(position,v*3);weighted.set(0,0,0);for(let s=0;s<4;s++){const w=weights[v*4+s];if(w)weighted.addScaledVector(p.clone().applyMatrix4(jointMatrices[joints[v*4+s]]),w);}weighted.applyMatrix4(meshWorld);pts.set(weighted.toArray(),v*3);minY=Math.min(minY,weighted.y);maxY=Math.max(maxY,weighted.y);}
    return {pts,minY,maxY};
  }
  const correction=[];for(const clip of clips){const times=Array.from({length:65},(_,i)=>clip.duration*i/64);if(clip.name==='Death'){times.push(.65);times.sort((a,b)=>a-b);}
    const adjusted=times.map(t=>Math.max(0,.005-pose(clip.animation,t).minY)/variant.scale);
    if(clip.name==='Death'){const at65=Math.max(0,.005-pose(clip.animation,.65).minY)/variant.scale;for(let i=0;i<times.length;i++)if(times[i]>=.65)adjusted[i]=at65;}
    const baseTranslation=clip.animation.listChannels().find(c=>c.getTargetNode()===nodes.get('Root')&&c.getTargetPath()==='translation');
    const baseAt=t=>{if(!baseTranslation)return [0,0,0];const s=baseTranslation.getSampler(),keys=s.getInput().getArray(),values=s.getOutput().getArray();let i=0;while(i<keys.length-2&&keys[i+1]<t)i++;const f=(t-keys[i])/(keys[i+1]-keys[i]);return [0,1,2].map(a=>values[i*3+a]*(1-f)+values[(i+1)*3+a]*f);};
    const input=doc.createAccessor(`${clip.name}_ground_times`).setType(Accessor.Type.SCALAR).setArray(Float32Array.from(times)).setBuffer(buffer);
    const output=doc.createAccessor(`${clip.name}_ground_values`).setType(Accessor.Type.VEC3).setArray(Float32Array.from(times.flatMap((t,i)=>{const b=baseAt(t);return [b[0],b[1]+adjusted[i],b[2]];}))).setBuffer(buffer);
    if(baseTranslation){clip.animation.removeChannel(baseTranslation);clip.animation.removeSampler(baseTranslation.getSampler());}
    const sampler=doc.createAnimationSampler().setInput(input).setOutput(output);clip.animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(nodes.get('Root')).setTargetPath('translation').setSampler(sampler));
    correction.push({clip:clip.name,maxCorrection:Math.max(...adjusted)});
  }
  // Compressor leaves the source's vertex order and texture detail intact.
  doc.createExtension(EXTMeshoptCompression).setRequired(true);
  const bytes=await io.writeBinary(doc),file=`${here}/${variant.file}`;await writeFile(file,bytes);
  const check=await io.readBinary(bytes),r=check.getRoot(),p=r.listMeshes()[0].listPrimitives()[0];
  assert.deepEqual(Array.from(p.getIndices().getArray()),Array.from(oldIndex));
  assert.deepEqual(Array.from(p.getAttribute('POSITION').getArray()),Array.from(originalRotated));
  assert.equal(r.listSkins()[0].listJoints().length,bones.length);
  assert(r.listExtensionsRequired().some(e=>e.extensionName==='EXT_meshopt_compression'),'Meshopt compression missing');
  assert.deepEqual(r.listAnimations().map(a=>a.getName()),['Idle','Walk','Run','Attack','Hit','Death']);
  const checkCtx={meshNode:r.listNodes().find(n=>n.getMesh()===r.listMeshes()[0]),skin:r.listSkins()[0],bind:r.listSkins()[0].getInverseBindMatrices().getArray(),position:p.getAttribute('POSITION').getArray(),joints:p.getAttribute('JOINTS_0').getArray(),weights:p.getAttribute('WEIGHTS_0').getArray()};
  for(let v=0;v<position.length/3;v++){let sum=0;for(let s=0;s<4;s++)sum+=checkCtx.weights[v*4+s];assert(Math.abs(sum-1)<1e-5,`Unnormalized vertex ${v}`);}
  for(const b of bones.filter(b=>b.group.startsWith('front')||b.group.startsWith('hind')))assert(influences[byName.get(b.name)]>50,`Unweighted limb ${b.name}`);
  let worstFloor=Infinity;const motions=[];
  for(const clip of clips){const c=r.listAnimations().find(a=>a.getName()===clip.name);const frames=Array.from({length:49},(_,i)=>pose(c,clip.duration*i/48,checkCtx));const floor=Math.min(...frames.map(f=>f.minY));worstFloor=Math.min(worstFloor,floor);
    let displacement=0;for(const f of [frames[12],frames[24],frames[36]])for(let i=0;i<frames[0].pts.length;i++)displacement=Math.max(displacement,Math.abs(frames[0].pts[i]-f.pts[i]));
    motions.push({clip:clip.name,duration:clip.duration,minY:floor,maxVertexDelta:displacement,finalHeight:frames.at(-1).maxY-frames.at(-1).minY});}
  const death=r.listAnimations().find(a=>a.getName()==='Death'),at65=pose(death,.65,checkCtx),end=pose(death,1.5,checkCtx);let hold=0;for(let i=0;i<at65.pts.length;i++)hold=Math.max(hold,Math.abs(at65.pts[i]-end.pts[i]));
  if(worstFloor<-.004||hold>.002)throw new Error(`Motion failed: floor ${worstFloor}, Death hold ${hold}; clips ${JSON.stringify(motions.map(m=>[m.clip,m.minY]))}`);
  const idleHeight=motions[0].finalHeight,deadHeight=motions.at(-1).finalHeight;if(deadHeight>idleHeight*.8)throw new Error(`Death remains upright: ${deadHeight}/${idleHeight}`);
  outputs.push({variant,bytes:bytes.length,sha256:hash(bytes),motions,worstFloor,deathHoldMaxDelta:hold,influences:Array.from(influences),idleHeight,deadHeight,correction});
}
const pack={id:'corealm-audit-thicket-spirit',name:'Corealm Thicket Spirit',author:'Corealm',source:`${here}/build-candidate.mjs`,generatorSha256:hash(await readFile(import.meta.filename)),license:'LicenseRef-Corealm-Original'};
const assets=outputs.map(o=>{const {variant:v}=o,size={x:.95263671875*v.scale,y:.99951171875*v.scale,z:.86865234375*v.scale};return {
  id:v.id,file:`models/fairy-garden/${v.file}`,candidateFile:v.file,pack:pack.id,category:'character',is:v.name,tags:['creature','fairy','thicket','moss','mushroom','candidate'],bytes:o.bytes,sha256:o.sha256,size,
  base:{x:-size.x/2,y:0,z:-size.z/2},bounds:{min:[-size.x/2,0,-size.z/2],max:[size.x/2,size.y,size.z/2]},groundY:0,triangles:3889,vertices:5303,
  animations:['Idle','Walk','Run','Attack','Hit','Death'],materials:['Thicket bark moss mushroom and luminous eyes'],walkClipSeconds:1.16,runClipSeconds:.74,attackSeconds:.86,contactNormalized:.43/.86,
  impliedWalkMps:null,impliedRunMps:null,measuredGait:null,locomotionPolicy:null,
  sourceProvenance:{sourceFile:source,sourceSha256:sourceSha,originalTripoModelId:'64833df9-8eee-437f-9010-9ca3483dc015',sourceTexture:'8K Tripo texture generation albedo; resized to 2K',sourcePbrMaps:'none',rigMethod:'Authored 20-joint four-leg, canopy, neck and face skin; spatial anatomical weights; original topology retained after rigid +X to +Z basis transform.'},
  metadata:{family:'thicket_spirit',region:v.region,level:v.level,anatomy:'Four thin legs beneath a mossy thicket canopy, mushroom crown and luminous face.',desiredInGameHeightMeters:size.y,elderPresentationScale:2.45/1.9,deathPose:'side collapse complete by 0.65 s and held through 1.5 s; CPU weighted floor sampled'},
  acceptance:{assetAudit:true,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false}
};});
const promotion={schema:'corealm-creature-promotion/1',pack,assets,sourceRoot:here,destinationRoot:'game/public/assets',apply:false,prerequisite:'Root production lab browser state and screenshot review of Thicket Spirit and grounded Death.'};
const lab={schema:'corealm-lab-asset-candidates/1',pack,assets:assets.map(a=>({...a,candidateFile:path.resolve(here,a.candidateFile)})),files:Object.fromEntries(assets.map(a=>[a.id,path.resolve(here,a.candidateFile)]))};
const catalog={schema:'corealm-thicket-spirit-candidates/1',accepted:false,status:'awaiting-root-lab-review',source:{file:source,sha256:sourceSha,vertices:5303,triangles:3889,materials:1,basecolorOnly:true},candidates:outputs,
  notes:['One art asset serves both t30 and t60 species. The t60 target of 2.45 m is 1.2901 times the t30 target of 1.899 m after tier silhouette scaling; no duplicate GLB is staged.','Source supplies no normal or metallic-roughness maps; material uses calibrated scalar roughness.']};
await Promise.all([writeFile(`${here}/promotion.json`,JSON.stringify(promotion,null,2)+'\n'),writeFile(`${here}/lab-catalog.json`,JSON.stringify(lab,null,2)+'\n'),writeFile(`${here}/catalog.json`,JSON.stringify(catalog,null,2)+'\n')]);
console.log(JSON.stringify(outputs.map(o=>({file:o.variant.file,bytes:o.bytes,sha256:o.sha256,worstFloor:o.worstFloor,deathHold:o.deathHoldMaxDelta,motions:o.motions})),null,2));
