import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Matrix4, Quaternion, Vector3 } from 'three';
const dir='assets/art/tripo/imports/creatures/audit-user-rimeback', id='creature_rimeback_tortoise';
const source=`${dir}/source-stone-turtle.glb`, output=`${dir}/rimeback-tortoise-candidate.glb`;
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourceBytes=await readFile(source),io=new NodeIO().registerExtensions(ALL_EXTENSIONS),doc=await io.readBinary(sourceBytes),root=doc.getRoot();
const mesh=root.listMeshes()[0],prim=mesh.listPrimitives()[0],meshNode=root.listNodes().find(n=>n.getMesh()===mesh),buffer=root.listBuffers()[0];
if(root.listMeshes().length!==1||mesh.listPrimitives().length!==1||root.listSkins().length||root.listAnimations().length||prim.getAttribute('POSITION').getCount()!==3418||prim.getIndices().getCount()!==15054)throw Error('Source anatomy changed');
const original={position:sha(Buffer.from(prim.getAttribute('POSITION').getArray().buffer)),normal:sha(Buffer.from(prim.getAttribute('NORMAL').getArray().buffer)),uv:sha(Buffer.from(prim.getAttribute('TEXCOORD_0').getArray().buffer)),indices:sha(Buffer.from(prim.getIndices().getArray().buffer))};
// Orient the source's +X muzzle toward gameplay +Z and uniformly grow to 1.49 m high.
const scale=2;for(const semantic of ['POSITION','NORMAL']){const a=prim.getAttribute(semantic).getArray();for(let i=0;i<a.length;i+=3){const x=a[i],z=a[i+2],f=semantic==='POSITION'?scale:1;a[i]=-z*f;a[i+1]*=f;a[i+2]=x*f;}}
const pos=prim.getAttribute('POSITION').getArray(),vertexCount=pos.length/3;
const bones=[
 ['Root',null,[0,0,0]],['Shell','Root',[0,.70,-.12]],['Neck','Shell',[0,.70,.48]],['Head','Neck',[0,.75,.79]],['Tail','Shell',[0,.40,-.71]],
 ['ForeLUpper','Shell',[-.51,.53,.33]],['ForeLLower','ForeLUpper',[-.55,.25,.38]],['ForeLFoot','ForeLLower',[-.56,.055,.43]],
 ['ForeRUpper','Shell',[.51,.53,.33]],['ForeRLower','ForeRUpper',[.55,.25,.38]],['ForeRFoot','ForeRLower',[.56,.055,.43]],
 ['HindLUpper','Shell',[-.51,.52,-.47]],['HindLLower','HindLUpper',[-.55,.25,-.51]],['HindLFoot','HindLLower',[-.56,.055,-.54]],
 ['HindRUpper','Shell',[.51,.52,-.47]],['HindRLower','HindRUpper',[.55,.25,-.51]],['HindRFoot','HindRLower',[.56,.055,-.54]],
];
const byName=new Map(),parentPos=n=>bones.find(b=>b[0]===n)?.[2];
for(const [name,parent,p] of bones){const pp=parent?parentPos(parent):[0,0,0],node=doc.createNode(name).setTranslation(p.map((v,i)=>v-pp[i]));byName.set(name,node);if(parent)byName.get(parent).addChild(node);else root.listScenes()[0].addChild(node);}
const skin=doc.createSkin('Rimeback anatomical quadruped').setSkeleton(byName.get('Root'));
const ibm=new Float32Array(bones.length*16);bones.forEach(([name,parent,p],i)=>{skin.addJoint(byName.get(name));ibm.set([1,0,0,0,0,1,0,0,0,0,1,0,-p[0],-p[1],-p[2],1],i*16);});
skin.setInverseBindMatrices(doc.createAccessor('Inverse bind matrices').setType(Accessor.Type.MAT4).setArray(ibm).setBuffer(buffer));meshNode.setSkin(skin).setName('RimebackTortoiseMesh');
const ji=new Uint16Array(vertexCount*4),we=new Float32Array(vertexCount*4),influence=new Uint32Array(bones.length);
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v)),smooth=(a,b,x)=>{let t=clamp((x-a)/(b-a));return t*t*(3-2*t)};
let multi=0,maxWeightError=0;for(let v=0;v<vertexCount;v++){
 const x=pos[v*3],y=pos[v*3+1],z=pos[v*3+2];
 // The dome is assigned to Shell. Low lateral geometry blends through the leg chain.
 const scores=new Float64Array(bones.length);scores[1]=.9;
 const headGate=smooth(.48,.76,z)*smooth(.38,.63,y),neckGate=smooth(.35,.60,z)*smooth(.32,.55,y)*(1-smooth(.77,.99,z));
 scores[2]=neckGate*3;scores[3]=headGate*5;scores[4]=smooth(.50,.75,-z)*(1-smooth(.45,.65,y))*1.5;
 if(y<.78){for(const [fore,side,upper,lower,foot] of [[true,-1,5,6,7],[true,1,8,9,10],[false,-1,11,12,13],[false,1,14,15,16]]){
  const longitudinal=fore?smooth(-.12,.2,z):1-smooth(-.34,-.04,z),lateral=smooth(.29,.48,x*side)*(1-smooth(-.15,.03,-x*side));
  const gate=longitudinal*lateral*(1-smooth(.64,.79,y));
  scores[upper]+=gate*3*(1-smooth(.28,.48,y));scores[lower]+=gate*4*(1-smooth(.17,.35,y));scores[foot]+=gate*6*(1-smooth(.07,.19,y));
 }}
 if(y>.78) scores[1]+=10;if(y<.32&&Math.abs(x)>.5)scores[1]*=.08;
 const best=Array.from(scores,(s,i)=>({s,i})).sort((a,b)=>b.s-a.s).slice(0,4),total=best.reduce((a,b)=>a+b.s,0);let sum=0,active=0;
 best.forEach((b,k)=>{const w=k===3?1-sum:b.s/total;ji[v*4+k]=b.i;we[v*4+k]=w;sum+=w;if(w>.001){active++;influence[b.i]++;}});
 if(active>1)multi++;maxWeightError=Math.max(maxWeightError,Math.abs(1-we[v*4]-we[v*4+1]-we[v*4+2]-we[v*4+3]));
}
prim.setAttribute('JOINTS_0',doc.createAccessor('Joint indices').setType(Accessor.Type.VEC4).setArray(ji).setBuffer(buffer));prim.setAttribute('WEIGHTS_0',doc.createAccessor('Joint weights').setType(Accessor.Type.VEC4).setArray(we).setBuffer(buffer));
const Q=(axis,a)=>{const q=new Quaternion().setFromAxisAngle(new Vector3(...axis),a);return q.toArray()},X=a=>Q([1,0,0],a),Y=a=>Q([0,1,0],a),Z=a=>Q([0,0,1],a);
function track(anim,name,path,times,values){const input=doc.createAccessor(`${anim.getName()} ${name} ${path} times`).setType(Accessor.Type.SCALAR).setArray(Float32Array.from(times)).setBuffer(buffer),type=path==='rotation'?Accessor.Type.VEC4:Accessor.Type.VEC3,output=doc.createAccessor(`${anim.getName()} ${name} ${path}`).setType(type).setArray(Float32Array.from(values.flat())).setBuffer(buffer),sampler=doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(byName.get(name)).setTargetPath(path).setSampler(sampler));}
const add=(name,seconds,defs)=>{const a=doc.createAnimation(name);for(const [bone,path,keys]of defs)track(a,bone,path,keys.map((_,i)=>seconds*i/(keys.length-1)),keys);return a;};
add('Idle',2.8,[['Shell','rotation',[X(0),X(.012),X(0),X(-.012),X(0)]],['Neck','rotation',[X(0),X(-.035),X(0),X(.025),X(0)]],['Head','rotation',[Y(-.035),Y(0),Y(.035),Y(0),Y(-.035)]],['Tail','rotation',[Y(-.05),Y(0),Y(.05),Y(0),Y(-.05)]]]);
for(const [name,seconds,amp]of[['Walk',1.55,.22],['Run',.96,.34]]){const defs=[];for(const [prefix,phase]of[['ForeL',0],['ForeR',2],['HindL',2],['HindR',0]]){const seq=[0,1,0,-1,0].map((_,i)=>[0,1,0,-1,0][(i+phase)%4]);defs.push([prefix+'Upper','rotation',seq.map(x=>X(x*amp))],[prefix+'Lower','rotation',seq.map(x=>X(-Math.max(0,x)*amp*.5))],[prefix+'Foot','rotation',seq.map(x=>X(Math.max(0,x)*amp*.3))]);}defs.push(['Shell','rotation',[X(0),X(.012),X(0),X(-.012),X(0)]],['Neck','rotation',[X(0),X(-.025),X(0),X(.025),X(0)]]);add(name,seconds,defs);}
add('Attack',1.25,[['Root','translation',[[0,0,0],[0,0,-.025],[0,0,.075],[0,0,.12],[0,0,0]]],['Shell','rotation',[X(0),X(-.04),X(.09),X(.05),X(0)]],['Neck','rotation',[X(0),X(-.13),X(.27),X(.20),X(0)]],['Head','rotation',[X(0),X(-.08),X(.24),X(.18),X(0)]],['ForeLUpper','rotation',[X(0),X(-.03),X(.13),X(.08),X(0)]],['ForeRUpper','rotation',[X(0),X(-.03),X(.13),X(.08),X(0)]]]);
add('Hit',.7,[['Shell','rotation',[X(0),X(-.07),X(.035),X(0)]],['Neck','rotation',[X(0),X(-.19),X(.07),X(0)]],['Head','rotation',[X(0),X(-.16),X(.06),X(0)]]]);
add('Death',1.8,[
 ['Root','translation',[[0,0,0],[0,-.02,0],[0,-.07,0],[0,-.11,0],[0,-.11,0]]],
 // A heavy side fall leaves the entire shell intact and visibly diagonal.
 ['Shell','rotation',[Z(0),Z(-.12),Z(-.55),Z(-1.04),Z(-1.04)]],
 ['Neck','rotation',[X(0),X(.20),X(.54),X(.88),X(.88)]],
 ['Head','rotation',[X(0),X(.14),X(.39),X(.66),X(.66)]],
 ['ForeLUpper','rotation',[X(0),X(-.09),X(-.26),X(-.44),X(-.44)]],
 ['ForeRUpper','rotation',[X(0),X(.06),X(.19),X(.31),X(.31)]],
 ['HindLUpper','rotation',[X(0),X(.10),X(.28),X(.41),X(.41)]],
 ['HindRUpper','rotation',[X(0),X(-.05),X(-.16),X(-.25),X(-.25)]],
 ['Tail','rotation',[Y(0),Y(.07),Y(.16),Y(.22),Y(.22)]],
]);
// Bake a vertical root correction against the deformed vertices, keeping every
// walk stance and the collapsed corpse at ground height without changing scale.
const bind=Array.from({length:bones.length},(_,i)=>new Matrix4().fromArray(ibm.slice(i*16,i*16+16)));
const rest=root.listNodes().map(n=>[n,n.getTranslation(),n.getRotation()]);
function apply(anim,time){for(const[n,t,r]of rest)n.setTranslation(t).setRotation(r);for(const channel of anim.listChannels()){const sampler=channel.getSampler(),times=sampler.getInput().getArray(),values=sampler.getOutput().getArray(),path=channel.getTargetPath(),stride=path==='rotation'?4:3;let i=0;while(i<times.length-2&&times[i+1]<time)i++;const f=clamp((time-times[i])/(times[i+1]-times[i]||1));let value;if(path==='rotation')value=new Quaternion().fromArray(values,i*4).slerp(new Quaternion().fromArray(values,(i+1)*4),f).toArray();else value=Array.from({length:stride},(_,j)=>values[i*stride+j]*(1-f)+values[(i+1)*stride+j]*f);if(path==='rotation')channel.getTargetNode().setRotation(value);else channel.getTargetNode().setTranslation(value);}}
function floor(){const matrices=skin.listJoints().map((joint,i)=>new Matrix4().fromArray(joint.getWorldMatrix()).multiply(bind[i]));let low=Infinity;const point=new Vector3(),transformed=new Vector3(),result=new Vector3();for(let v=0;v<vertexCount;v++){point.fromArray(pos,v*3);result.set(0,0,0);for(let slot=0;slot<4;slot++){const w=we[v*4+slot];if(w)result.add(transformed.copy(point).applyMatrix4(matrices[ji[v*4+slot]]).multiplyScalar(w));}low=Math.min(low,result.y);}return low;}
for(const anim of root.listAnimations()){
 const seconds=Math.max(...anim.listSamplers().map(s=>s.getInput().getArray().at(-1))),count=Math.ceil(seconds*60),times=new Float32Array(count+1),values=new Float32Array((count+1)*3);
 for(let i=0;i<=count;i++){const t=seconds*i/count;apply(anim,t);const original=byName.get('Root').getTranslation(),correction=.003-floor();times[i]=t;values.set([original[0],original[1]+correction,original[2]],i*3);}
 const existing=anim.listChannels().find(c=>c.getTargetNode()===byName.get('Root')&&c.getTargetPath()==='translation');
 if(existing){existing.getSampler().getInput().setArray(times);existing.getSampler().getOutput().setArray(values);}
 else track(anim,'Root','translation',times,Array.from({length:count+1},(_,i)=>Array.from(values.slice(i*3,i*3+3))));
}
for(const[n,t,r]of rest)n.setTranslation(t).setRotation(r);
const out=await io.writeBinary(doc);await writeFile(output,out);
const catalog={schema:'corealm-lab-asset-candidates/1',pack:{id:'corealm-audit-user-rimeback',name:'Rimeback tortoise replacement',author:'Corealm',source:`${dir}/build-candidate.mjs`,license:'User supplied; source license pending user confirmation',generatorSha256:sha(await readFile(`${dir}/build-candidate.mjs`))},assets:[{id,file:'models/creature/creature_rimeback_tortoise.glb',pack:'corealm-audit-user-rimeback',category:'character',is:'rimeback tortoise',tags:['creature','tortoise','rimeback','frost','user-supplied'],bytes:out.length,size:{x:1.67578125,y:1.4882731437683105,z:1.99609375},base:{x:-.837890625,y:0,z:-.998046875},groundY:0,animations:root.listAnimations().map(a=>a.getName()),walkClipSeconds:1.55,runClipSeconds:.96,attackSeconds:1.25,attackContactNormalized:.625/1.25,sha256:sha(out),materials:root.listMaterials().map(m=>m.getName()),candidateFile:'rimeback-tortoise-candidate.glb',acceptance:{exported:true,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false}}],files:{[id]:'rimeback-tortoise-candidate.glb'}};
await writeFile(`${dir}/lab-catalog.json`,JSON.stringify(catalog,null,2)+'\n');
const promotion={schema:'corealm-creature-replacement-promotion/1',id,status:'awaiting-root-lab-review',accepted:false,candidateFile:`${dir}/rimeback-tortoise-candidate.glb`,sha256:sha(out),bytes:out.length,bounds:{min:[-.837890625,0,-.998046875],max:[.837890625,1.4882731437683105,.998046875]},joints:bones.map(([name,parent,p],index)=>({index,name,parent,restPosition:p})),clips:root.listAnimations().map(a=>({name:a.getName(),seconds:Math.max(...a.listSamplers().map(s=>s.getInput().getArray().at(-1)))})),timing:{walkClipSeconds:1.55,runClipSeconds:.96,attackSeconds:1.25,contactNormalized:.5,contactBasis:'Maximum neck thrust and forward lunge at 0.625 s.'},source:{file:source,originalDownload:'C:/Users/Borg/Downloads/stone+turtle+3d+model.glb',sha256:sha(sourceBytes),bytes:sourceBytes.length,license:'User supplied; license to be confirmed by project owner',vertices:vertexCount,triangles:prim.getIndices().getCount()/3,originalGeometryHashes:original,sourceTextures:root.listTextures().map(t=>({name:t.getName(),mimeType:t.getMimeType(),bytes:t.getImage().length,sha256:sha(t.getImage())}))},builder:{file:`${dir}/build-candidate.mjs`,sha256:sha(await readFile(`${dir}/build-candidate.mjs`))},rig:{basis:'Y up, +Z muzzle; rigid shell with anatomical four-leg, neck, head and tail weights',vertexCount,multiInfluenceVertices:multi,maxWeightSumError:maxWeightError,jointInfluenceCounts:Array.from(influence)},textureNote:'Original layered 2K albedo, normal and PBR maps retained exactly; no reskin.'};
await writeFile(`${dir}/promotion.json`,JSON.stringify(promotion,null,2)+'\n');console.log(JSON.stringify({output,bytes:out.length,sha256:sha(out),vertexCount,multi,maxWeightError,jointInfluenceCounts:Array.from(influence)},null,2));
