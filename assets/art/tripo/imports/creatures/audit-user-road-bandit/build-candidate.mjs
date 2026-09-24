import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {NodeIO, Accessor} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import * as T from 'three';
import sharp from 'sharp';

const dir='assets/art/tripo/imports/creatures/audit-user-road-bandit';
const sourceFile=`${dir}/sources/medieval+rogue+3d+model.glb`;
const outputFile=`${dir}/creature_road_bandit.glb`;
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourceBytes=await readFile(sourceFile);
const sourceSha256=sha(sourceBytes);
if(sourceSha256!=='0977c5394de5f99f72c8c3f34b5768339d6cd7fefcf8e92537995b794d9a9afe')throw Error('Source changed');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc=await io.readBinary(sourceBytes),root=doc.getRoot();
const scene=root.listScenes()[0],meshNode=root.listNodes()[0],primitive=root.listMeshes()[0]?.listPrimitives()[0];
if(!scene||!meshNode||!primitive||root.listSkins().length||root.listAnimations().length||primitive.getAttribute('POSITION')?.getCount()!==3711)throw Error('Unexpected source layout');
const pos=primitive.getAttribute('POSITION').getArray(), normals=primitive.getAttribute('NORMAL').getArray(),uvs=primitive.getAttribute('TEXCOORD_0').getArray(),indices=primitive.getIndices().getArray();
const sourceTextures=await Promise.all(root.listTextures().map(async t=>{const m=await sharp(t.getImage()).metadata();return {name:t.getName(),sha256:sha(t.getImage()),bytes:t.getImage().length,width:m.width,height:m.height,mimeType:t.getMimeType()};}));
if(!primitive.getMaterial().getBaseColorTexture()||!primitive.getMaterial().getNormalTexture()||!primitive.getMaterial().getMetallicRoughnessTexture())throw Error('PBR maps missing');
const bones=[
 ['Hips',null,[0,.53,0],'torso',.13],['Spine','Hips',[0,.62,0],'torso',.11],['Chest','Spine',[0,.73,0],'torso',.12],['Neck','Chest',[0,.83,0],'head',.08],['Head','Neck',[0,.90,0],'head',.11],
 ['LeftUpperArm','Chest',[0,.76,.14],'leftArm',.09],['LeftForeArm','LeftUpperArm',[0,.75,.29],'leftArm',.075],['LeftHand','LeftForeArm',[0,.74,.41],'leftArm',.065],
 ['RightUpperArm','Chest',[0,.76,-.14],'rightArm',.09],['RightForeArm','RightUpperArm',[0,.75,-.29],'rightArm',.075],['RightHand','RightForeArm',[0,.74,-.41],'rightArm',.065],
 ['LeftUpperLeg','Hips',[0,.50,.065],'leftLeg',.075],['LeftLowerLeg','LeftUpperLeg',[0,.27,.067],'leftLeg',.065],['LeftFoot','LeftLowerLeg',[.025,.075,.067],'leftLeg',.07],
 ['RightUpperLeg','Hips',[0,.50,-.065],'rightLeg',.075],['RightLowerLeg','RightUpperLeg',[0,.27,-.067],'rightLeg',.065],['RightFoot','RightLowerLeg',[.025,.075,-.067],'rightLeg',.07],
].map(([name,parent,p,group,sigma],index)=>({name,parent,p,group,sigma,index}));
const by=new Map(bones.map(b=>[b.name,b]));
const container=doc.createNode('RoadBandit_Presentation').setScale([1.76,1.76,1.76]);
// Source front is +X; rotate all geometry and joints together to game +Z.
container.setRotation(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),-Math.PI/2).toArray());
scene.removeChild(meshNode);scene.addChild(container);container.addChild(meshNode.setName('RoadBanditMesh'));
const nodes=new Map();
for(const b of bones){const p=b.parent?by.get(b.parent).p:[0,0,0];const n=doc.createNode(b.name).setTranslation(b.p.map((v,i)=>v-p[i]));(b.parent?nodes.get(b.parent):container).addChild(n);nodes.set(b.name,n);}
const buffer=root.listBuffers()[0];
const skin=doc.createSkin('RoadBandit_AnatomicalSkin').setSkeleton(nodes.get('Hips'));
for(const b of bones)skin.addJoint(nodes.get(b.name));
skin.setInverseBindMatrices(doc.createAccessor('RoadBanditInverseBinds').setType(Accessor.Type.MAT4).setArray(Float32Array.from(bones.flatMap(b=>[1,0,0,0,0,1,0,0,0,0,1,0,-b.p[0],-b.p[1],-b.p[2],1]))).setBuffer(buffer));
meshNode.setSkin(skin);
const smooth=(x,s)=>1/(1+Math.exp(-Math.max(-40,Math.min(40,x/s))));
function segdist(v,a,b){const d=b.map((q,i)=>q-a[i]),len2=d.reduce((s,q)=>s+q*q,0);const t=len2<1e-12?0:Math.max(0,Math.min(1,v.reduce((s,q,i)=>s+(q-a[i])*d[i],0)/len2));return Math.hypot(...v.map((q,i)=>q-a[i]-t*d[i]));}
function gate(b,v){const [x,y,z]=v;
 if(b.group==='leftArm'||b.group==='rightArm')return smooth(y-.55,.035)*smooth(.86-y,.045)*smooth((b.group==='leftArm'?z:-z)-.10,.035);
 if(b.group==='leftLeg'||b.group==='rightLeg')return smooth(.57-y,.04)*smooth((b.group==='leftLeg'?z:-z)-.01,.027);
 if(b.group==='head')return smooth(y-.79,.035)*smooth(.13-Math.abs(z),.04);
 return smooth(.82-y,.04)*smooth(y-.43,.045)*smooth(.19-Math.abs(z),.035);
}
const joints=new Uint16Array(pos.length/3*4),weights=new Float32Array(pos.length/3*4),coverage=new Uint32Array(bones.length);
for(let vi=0;vi<pos.length/3;vi++){
 const v=[pos[vi*3],pos[vi*3+1],pos[vi*3+2]];
 const scored=bones.map(b=>{const p=b.parent?by.get(b.parent).p:b.p;const distance=segdist(v,p,b.p);return {i:b.index,s:gate(b,v)*Math.exp(-.5*(distance/b.sigma)**2)};}).sort((a,b)=>b.s-a.s).slice(0,4);
 const total=scored.reduce((s,c)=>s+c.s,0);if(!Number.isFinite(total)||total<1e-20)throw Error(`Unweighted vertex ${vi}`);
 let used=0;for(let k=0;k<4;k++){joints[vi*4+k]=scored[k].i;weights[vi*4+k]=k===3?1-used:scored[k].s/total;used+=weights[vi*4+k];if(weights[vi*4+k]>.08)coverage[scored[k].i]++;}
}
primitive.setAttribute('JOINTS_0',doc.createAccessor('RoadBanditJoints').setType(Accessor.Type.VEC4).setArray(joints).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0',doc.createAccessor('RoadBanditWeights').setType(Accessor.Type.VEC4).setArray(weights).setBuffer(buffer));
const q=(x=0,y=0,z=0)=>new T.Quaternion().setFromEuler(new T.Euler(x,y,z)).toArray();
const durations={Idle:2.4,Walk:1.08,Run:.72,Attack:.96,Hit:.46,Death:1.5};
const clips=[];
function pose(name,u){const a=new Map(),tr=new Map();const r=(n,x=0,y=0,z=0)=>a.set(n,[x,y,z]);const t=(n,x=0,y=0,z=0)=>tr.set(n,[x,y,z]);const phase=2*Math.PI*u;
 if(name==='Idle'){r('Spine',.015*Math.sin(phase));r('Chest',.02*Math.sin(phase+.3));r('Head',.012*Math.sin(phase),.028*Math.sin(phase));r('LeftUpperArm',1.16+.015*Math.sin(phase));r('RightUpperArm',-1.16-.015*Math.sin(phase));r('LeftForeArm',0,.24,0);r('RightForeArm',0,-.24,0);}
 if(name==='Walk'||name==='Run'){const fast=name==='Run',s=fast?.56:.34,k=fast?.47:.27,arm=fast?.48:.30;const sw=Math.sin(phase),lift=Math.max(0,sw);t('Hips',0,(fast?.013:.008)*(1-Math.cos(phase*2)),0);r('Spine',0,0,.025*sw);r('Chest',0,.025*sw,0);r('LeftUpperLeg',0,0,-s*sw);r('RightUpperLeg',0,0,s*sw);r('LeftLowerLeg',0,0,k*lift);r('RightLowerLeg',0,0,k*Math.max(0,-sw));r('LeftFoot',0,0,s*sw-k*lift);r('RightFoot',0,0,-s*sw-k*Math.max(0,-sw));r('LeftUpperArm',1.16,0,arm*sw);r('RightUpperArm',-1.16,0,-arm*sw);r('LeftForeArm',0,.32+.06*sw,0);r('RightForeArm',0,-.32+.06*sw,0);}
 if(name==='Attack'){const keys=[0,.15,.33,.43,.61,.8,1],val=[0,.3,.85,1,.58,.13,0];const interp=(arr)=>{let i=0;while(i<keys.length-2&&u>keys[i+1])i++;let f=(u-keys[i])/(keys[i+1]-keys[i]);f=Math.max(0,Math.min(1,f));return arr[i]*(1-f)+arr[i+1]*f;};const strike=interp(val),back=interp([0,.25,.55,.65,.2,0,0]);t('Hips',.045*strike,-.025*strike,0);r('Hips',0,.20*strike,0);r('Chest',0,-.30*back+.34*strike,.15*strike);r('RightUpperArm',-1.16,-.20*back,.90*strike-.28*back);r('RightForeArm',0,-.24-.42*strike,0);r('LeftUpperArm',1.16,.10*strike,-.18*strike);r('LeftForeArm',0,.24,0);r('Head',0,.10*strike,0);r('LeftUpperLeg',0,0,-.15*strike);r('RightUpperLeg',0,0,.13*strike);}
 if(name==='Hit'){const recoil=Math.sin(Math.PI*u);t('Hips',-.035*recoil,-.015*recoil,0);r('Spine',0,0,-.16*recoil);r('Chest',0,0,-.18*recoil);r('Head',0,0,-.10*recoil);r('LeftUpperArm',1.16+.1*recoil);r('RightUpperArm',-1.16-.1*recoil);r('LeftForeArm',0,.24,0);r('RightForeArm',0,-.24,0);}
 if(name==='Death'){const f=Math.max(0,Math.min(1,(u-.04)/.6)),e=f*f*(3-2*f);t('Hips',.15*e,-.1634*e,0);r('Hips',0,0,-1.40*e);r('Spine',0,0,-.12*e);r('Chest',0,0,.13*e);r('Head',0,0,.20*e);r('LeftUpperArm',1.16-.98*e);r('RightUpperArm',-1.16+.98*e);r('LeftForeArm',0,.24*(1-e),0);r('RightForeArm',0,-.24*(1-e),0);r('LeftUpperLeg',0,0,.28*e);r('RightUpperLeg',0,0,-.17*e);r('LeftLowerLeg',0,0,.34*e);r('RightLowerLeg',0,0,.19*e);}
 return {a,tr};}
for(const [name,seconds] of Object.entries(durations)){const animation=doc.createAnimation(name),n=name==='Death'?31:25,times=Float32Array.from({length:n},(_,i)=>seconds*i/(n-1)),poses=[...times].map(t=>pose(name,t/seconds)),affected=new Set(poses.flatMap(p=>[...p.a.keys(),...p.tr.keys()]));for(const boneName of affected){for(const path of ['rotation','translation']){if(!poses.some(p=>(path==='rotation'?p.a:p.tr).has(boneName)))continue;const b=by.get(boneName),values=Float32Array.from(poses.flatMap(p=>path==='rotation'?q(...(p.a.get(boneName)??[0,0,0])):b.p.map((v,i)=>v-(b.parent?by.get(b.parent).p[i]:0)+(p.tr.get(boneName)?.[i]??0))));const input=doc.createAccessor().setType(Accessor.Type.SCALAR).setArray(times).setBuffer(buffer),output=doc.createAccessor().setType(path==='rotation'?Accessor.Type.VEC4:Accessor.Type.VEC3).setArray(values).setBuffer(buffer),sampler=doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(nodes.get(boneName)).setTargetPath(path).setSampler(sampler));}}clips.push({name,seconds,channels:animation.listChannels().length});}
const candidate=await io.writeBinary(doc);await writeFile(outputFile,candidate);
const check=(await io.readBinary(candidate)).getRoot(),cp=check.listMeshes()[0].listPrimitives()[0];
for(const [label,a,b]of [['POSITION',pos,cp.getAttribute('POSITION').getArray()],['NORMAL',normals,cp.getAttribute('NORMAL').getArray()],['TEXCOORD_0',uvs,cp.getAttribute('TEXCOORD_0').getArray()],['indices',indices,cp.getIndices().getArray()]]){if(a.length!==b.length||a.some((v,i)=>v!==b[i]))throw Error(`${label} changed`);}
for(const t of check.listTextures())if(!sourceTextures.some(s=>s.name===t.getName()&&s.sha256===sha(t.getImage())))throw Error('Texture changed');
const builderSha256=sha(await readFile(new URL(import.meta.url)));
const metrics={sourceFile,sourceSha256,sourceBytes:sourceBytes.length,candidateFile:outputFile,candidateSha256:sha(candidate),candidateBytes:candidate.length,builderSha256,sourceBounds:{min:[-.1142578274,0,-.4833984375],max:[.1142578274,.9980469942,.4833984375]},presentationScale:1.76,vertices:3711,triangles:4880,joints:bones.map(b=>({name:b.name,coverage:coverage[b.index]})),textures:sourceTextures,clips,attackContactSeconds:.413,attackContactNormalized:.43,geometryUvNormalsIndicesAndPbrPreserved:true,sourceWasUnrigged:true,acceptance:false};
await writeFile(`${dir}/validation.json`,JSON.stringify(metrics,null,2)+'\n');
const pack={id:'corealm-user-road-bandit',name:'User supplied Road Bandit',author:'User / Corealm',source:`${dir}/build-candidate.mjs`,license:'User supplied source; reuse within Corealm',generatorSha256:builderSha256};
const asset={id:'creature_road_bandit',file:'models/creature/creature_road_bandit.glb',pack:pack.id,category:'character',is:'Road Bandit',tags:['creature','bandit','human','fallowmarch','starter','user-supplied'],bytes:candidate.length,sha256:sha(candidate),builderSha256,size:{x:.966796875*1.76,y:.9980469942*1.76,z:.2285156548*1.76},base:{x:-.4833984375*1.76,y:0,z:-.1142578274*1.76},bounds:{min:[-.4833984375*1.76,0,-.1142578274*1.76],max:[.4833984375*1.76,.9980469942*1.76,.1142578274*1.76]},groundY:0,triangles:4880,vertices:3711,animations:clips.map(c=>c.name),materials:root.listMaterials().map(m=>m.getName()),walkClipSeconds:durations.Walk,runClipSeconds:durations.Run,attackSeconds:durations.Attack,contactNormalized:.43,impliedWalkMps:null,impliedRunMps:null,locomotionPolicy:'definition-speed; authored in-place animation',sourceProvenance:{author:'User supplied Tripo export',license:'User supplied; project use',sourceFile,sourceSha256,sourceBytes:sourceBytes.length,sourceWasUnrigged:true,geometryUvNormalsIndicesAndPbrPreserved:true,originalPbrTextures:sourceTextures,rigMethod:'17-joint anatomical skin fitted to source mesh, four normalized weights per vertex',builderSha256},metadata:{tier:1,renderedIdleHeightMeters:.9980469942*1.76,attackContactSeconds:.413,attackContactNormalized:.43,deathClipSeconds:1.5,sourceForwardAxis:'+X',gameForwardAxis:'+Z',presentationScale:1.76,originalAssetId:'outfit_male_peasant',originalAssetRemainsPlayerGear:true},acceptance:{assetAudit:false,labAccepted:false,worldIntegrated:false},candidateFile:outputFile};
const lab={schema:'corealm-lab-asset-candidates/1',pack,assets:[asset],files:{creature_road_bandit:`C:/Users/Borg/Documents/GitHub/Corealm2/${outputFile}`}};
await writeFile(`${dir}/lab-catalog.json`,JSON.stringify(lab,null,2)+'\n');
const promotion={schema:'corealm-creature-replacement-promotion/1',pack:pack.id,builderFile:pack.source,builderSha256,status:'awaiting-root-lab-review',accepted:false,assets:[{id:asset.id,creatureDefinitionId:'march_road_reavers',candidateFile:outputFile,sha256:asset.sha256,bytes:asset.bytes,productionTarget:`game/public/assets/${asset.file}`,bounds:asset.bounds,triangles:asset.triangles,vertices:asset.vertices,materials:asset.materials,animations:asset.animations,clips,attack:{seconds:.96,contactSeconds:.413,contactNormalized:.43},sourceProvenance:asset.sourceProvenance}],exactContentMapping:{creatureDefinitionId:'march_road_reavers',presentationAssetId:'creature_road_bandit',presentationScale:1,replaceExistingAssetId:'outfit_male_peasant',preserveExistingAssetIdForPlayerGear:true,labHuntAssetId:'creature_road_bandit'},remainingAcceptance:['Root reviews normal-camera idle, walk, run, attack, hit, and held full-size grounded death in production feature lab.','Root confirms combat HP and clip transitions, then integrates dedicated creature ID into content and build.']};
await writeFile(`${dir}/promotion.json`,JSON.stringify(promotion,null,2)+'\n');
console.log(JSON.stringify(metrics,null,2));
