import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {Accessor,NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {Matrix4,Quaternion,Vector3} from 'three';
import sharp from 'sharp';

const dir='assets/art/tripo/imports/creatures/audit-user-bloomheart';
const sourceFile=dir+'/sources/tree+spirit+3d+model.glb';
const sourceSha='b910e4ae7848a9b8f8da73e05df58b08de9388535daee58452ce158afb50d9ab';
const sha=b=>createHash('sha256').update(b).digest('hex');
const source=await readFile(sourceFile);
if(sha(source)!==sourceSha)throw Error('Delivered Bloomheart source changed');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc=await io.readBinary(source),root=doc.getRoot(),scene=root.listScenes()[0];
const mesh=root.listMeshes()[0],primitive=mesh.listPrimitives()[0],meshNode=root.listNodes().find(n=>n.getMesh()===mesh);
const positions=primitive.getAttribute('POSITION').getArray(),indices=primitive.getIndices().getArray();
if(positions.length!==7992*3||indices.length!==14766||root.listSkins().length||root.listAnimations().length)throw Error('Unexpected source geometry');
const sourcePositionSha=sha(Buffer.from(positions.buffer)),sourceIndicesSha=sha(Buffer.from(indices.buffer));
const tex=[];
for(const t of root.listTextures()){
 const image=t.getImage(),meta=await sharp(image).metadata(),data=await sharp(image).resize(2048,2048,{fit:'fill'}).jpeg({quality:t===root.listMaterials()[0].getBaseColorTexture()?92:90,chromaSubsampling:'4:4:4'}).toBuffer();
 tex.push({name:t.getName(),source:[meta.width,meta.height],sourceSha256:sha(image),runtime:[2048,2048],runtimeSha256:sha(data)});
 t.setImage(data).setMimeType('image/jpeg');
}
const material=root.listMaterials()[0];
material.setMetallicFactor(0).setRoughnessFactor(1);
// Production actors face +Z; the delivered Tripo model faces +X.
const group=doc.createNode('BloomheartPresentation').setScale([3.7,3.7,3.7]).setRotation([0,-Math.SQRT1_2,0,Math.SQRT1_2]);
scene.removeChild(meshNode);scene.addChild(group);
const motion=doc.createNode('BloomheartMotion');group.addChild(motion);
motion.addChild(meshNode);
// The source faces along +X, with the branch arms extending across Z.
const specs=[
 ['Root',null,[0,.20,0],'core',.20],
 ['Trunk','Root',[0,.43,0],'core',.20],
 ['Bole','Trunk',[0,.62,0],'core',.18],
 ['Face','Bole',[.035,.75,0],'head',.15],
 ['Crown','Face',[0,.91,0],'crown',.17],
 ['LeftBranch','Bole',[0,.57,.18],'arm',.13],
 ['LeftTwig','LeftBranch',[0,.47,.39],'arm',.11],
 ['RightBranch','Bole',[0,.57,-.18],'arm',.13],
 ['RightTwig','RightBranch',[0,.47,-.39],'arm',.11],
 ['LeftRoot','Root',[0,.20,.14],'leg',.15],
 ['LeftTip','LeftRoot',[.01,.06,.20],'leg',.11],
 ['RightRoot','Root',[0,.20,-.14],'leg',.15],
 ['RightTip','RightRoot',[.01,.06,-.20],'leg',.11],
];
const byName=new Map(),world=new Map();
for(const [name,parent,p] of specs){const parentP=parent?world.get(parent):[0,0,0],node=doc.createNode(name).setTranslation(p.map((x,i)=>x-parentP[i]));(parent?byName.get(parent):motion).addChild(node);byName.set(name,node);world.set(name,p);}
const skin=doc.createSkin('Bloomheart anatomical skin').setSkeleton(byName.get('Root'));
for(const [name] of specs)skin.addJoint(byName.get(name));
skin.setInverseBindMatrices(doc.createAccessor('inverseBindMatrices').setType(Accessor.Type.MAT4).setArray(Float32Array.from(specs.flatMap(([, ,p])=>new Matrix4().makeTranslation(-p[0],-p[1],-p[2]).toArray()))).setBuffer(root.listBuffers()[0]));
meshNode.setSkin(skin);
const distance=(p,a,b)=>{const d=b.map((v,i)=>v-a[i]),den=d.reduce((s,v)=>s+v*v,0)||1,t=Math.max(0,Math.min(1,p.reduce((s,v,i)=>s+(v-a[i])*d[i],0)/den));return Math.hypot(...p.map((v,i)=>v-a[i]-t*d[i]));};
const sigmoid=x=>1/(1+Math.exp(-Math.max(-25,Math.min(25,x))));
const joint=new Uint16Array(7992*4),weight=new Float32Array(7992*4),weightMass=Array(specs.length).fill(0);let blended=0;
for(let i=0;i<7992;i++){
 const p=[positions[i*3],positions[i*3+1],positions[i*3+2]],[x,y,z]=p,scores=[];
 for(let j=0;j<specs.length;j++){
  const [name,parent,b,kind,sigma]=specs[j],a=parent?world.get(parent):b;
  let gate=1;
  if(kind==='core')gate=(.05+.95*sigmoid((y-.15)/.045))*(.05+.95*sigmoid((.79-y)/.06))*(.10+.90*sigmoid((.18-Math.abs(z))/.045));
  if(kind==='head')gate=(.05+.95*sigmoid((y-.64)/.045))*(.1+.9*sigmoid((.87-y)/.045));
  if(kind==='crown')gate=.02+.98*sigmoid((y-.78)/.045);
  if(kind==='arm'){const side=name.startsWith('Left')?1:-1;gate=(.005+.995*sigmoid((side*z-.14)/.035))*(.03+.97*sigmoid((.76-y)/.05))*(.03+.97*sigmoid((y-.31)/.05));}
  if(kind==='leg'){const side=name.startsWith('Left')?1:-1;gate=(.015+.985*sigmoid((side*z-.015)/.035))*(.02+.98*sigmoid((.37-y)/.055));}
  const score=gate*Math.exp(-.5*(distance(p,a,b)/sigma)**2);scores.push({j,score});
 }
 scores.sort((a,b)=>b.score-a.score);const best=scores.slice(0,4),sum=best.reduce((s,v)=>s+v.score,0);let assigned=0,n=0;
 for(let k=0;k<4;k++){const v=best[k],w=k===3?1-assigned:v.score/sum;joint[i*4+k]=v.j;weight[i*4+k]=w;weightMass[v.j]+=w;assigned+=w;if(w>1e-4)n++;}if(n>1)blended++;
}
primitive.setAttribute('JOINTS_0',doc.createAccessor('joints').setType(Accessor.Type.VEC4).setArray(joint).setBuffer(root.listBuffers()[0]));
primitive.setAttribute('WEIGHTS_0',doc.createAccessor('weights').setType(Accessor.Type.VEC4).setArray(weight).setBuffer(root.listBuffers()[0]));
const base=new Map(specs.map(([name])=>[name,[...byName.get(name).getTranslation()]]));
const q=(axis,angle)=>new Quaternion().setFromAxisAngle(new Vector3(...axis),angle).toArray();
const X=[1,0,0],Y=[0,1,0],Z=[0,0,1];
const pose=({breath=0,step=0,bob=0,sweep=0,hit=0,fall=0}={})=>({
 motion_t:[0,bob+fall*.155,0],motion_r:q(Z,fall*1.45),
 Root:q(X,step*.055),Trunk:q(Z,breath*.016+hit*.14),Bole:q(Y,sweep*.16+step*.045),
 Face:q(Z,-hit*.09-fall*.12),Crown:q(X,breath*.025+fall*.24),
 LeftBranch:q(X,step*.22-sweep*.20+fall*.20),LeftTwig:q(Y,-sweep*.38+breath*.025),
 RightBranch:q(X,-step*.22+sweep*.20-fall*.20),RightTwig:q(Y,sweep*.38-breath*.025),
 LeftRoot:q(X,-step*.26+fall*.38),LeftTip:q(X,step*.14),
 RightRoot:q(X,step*.26-fall*.38),RightTip:q(X,-step*.14)
});
const clips=[];
function clip(name,seconds,times,states){const a=doc.createAnimation(name);for(const key of Object.keys(states[0])){
 const isMotion=key.startsWith('motion_'),target=isMotion?motion:byName.get(key),path=key.endsWith('_t')?'translation':'rotation';
 const input=doc.createAccessor(name+'_'+key+'_time').setType(Accessor.Type.SCALAR).setArray(Float32Array.from(times)).setBuffer(root.listBuffers()[0]);
 const output=doc.createAccessor(name+'_'+key).setType(path==='rotation'?Accessor.Type.VEC4:Accessor.Type.VEC3).setArray(Float32Array.from(states.flatMap(s=>s[key]))).setBuffer(root.listBuffers()[0]);
 const sampler=doc.createAnimationSampler(name+'_'+key).setInput(input).setOutput(output).setInterpolation('LINEAR');a.addSampler(sampler).addChannel(doc.createAnimationChannel(name+'_'+key).setSampler(sampler).setTargetNode(target).setTargetPath(path));
 }clips.push({name,seconds,channels:Object.keys(states[0]).length});}
clip('Idle',2.4,[0,.6,1.2,1.8,2.4],[0,1,0,-1,0].map(breath=>pose({breath})));
for(const [name,seconds,stride,bounce] of [['Walk',1.3,.7,.008],['Run',.82,1,.016]]){const times=Array.from({length:17},(_,i)=>i*seconds/16);clip(name,seconds,times,times.map(t=>{const p=t/seconds*Math.PI*2;return pose({step:Math.sin(p)*stride,bob:(1-Math.cos(2*p))*bounce,breath:Math.sin(2*p)*.4});}));}
clip('Attack',1.3,[0,.18,.43,.67,.84,1.08,1.3],[pose(),pose({sweep:-.3}),pose({sweep:-1}),pose({sweep:1}),pose({sweep:.65}),pose({sweep:.2}),pose()]);
clip('Hit',.56,[0,.13,.28,.56],[pose(),pose({hit:1}),pose({hit:.45}),pose()]);
clip('Death',1.65,[0,.18,.38,.62,.84,1.2,1.65],[pose(),pose({hit:.8,fall:.08}),pose({fall:.37}),pose({fall:.72}),pose({fall:1}),pose({fall:1}),pose({fall:1})]);
const out=await io.writeBinary(doc),file=dir+'/bloomheart-matriarch-candidate.glb';await writeFile(file,out);
const validation={sourceFile,sourceSha256:sourceSha,sourceBytes:source.length,candidateFile:file,candidateSha256:sha(out),candidateBytes:out.length,vertices:7992,triangles:4922,sourcePositionSha256:sourcePositionSha,sourceIndicesSha256:sourceIndicesSha,sourceGeometryPreserved:true,joints:specs.map(s=>s[0]),blendedVertices:blended,weightMass,textures:tex,clips,contactSeconds:.67,contactNormalized:.67/1.3,status:'awaiting-root-lab-review'};
await writeFile(dir+'/validation.json',JSON.stringify(validation,null,2)+'\n');
console.log(JSON.stringify(validation,null,2));
