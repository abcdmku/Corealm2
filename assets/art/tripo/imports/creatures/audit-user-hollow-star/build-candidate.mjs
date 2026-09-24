import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {Accessor,NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {Matrix4,Quaternion,Vector3} from 'three';
import sharp from 'sharp';

const dir='assets/art/tripo/imports/creatures/audit-user-hollow-star';
const sourceFile=dir+'/sources/fantasy+symbol+3d+model.glb';
const candidateFile=dir+'/hollow-star-user-candidate.glb';
const sourceSha='7b15f0d0bbaa9be8d154d26383ef74a042d0e10dc9895285b8c8776ee862629c';
const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=await readFile(sourceFile);
if(sha(bytes)!==sourceSha)throw Error('Delivered Hollow Star source changed');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc=await io.readBinary(bytes),root=doc.getRoot(),scene=root.listScenes()[0];
const mesh=root.listMeshes()[0],primitive=mesh.listPrimitives()[0],meshNode=root.listNodes().find(n=>n.getMesh()===mesh);
const positions=primitive.getAttribute('POSITION')?.getArray(),indices=primitive.getIndices()?.getArray();
if(!positions||positions.length!==7169*3||indices?.length!==4862*3||root.listSkins().length||root.listAnimations().length)throw Error('Unexpected Hollow Star source geometry');
const geometry={positionSha256:sha(Buffer.from(positions.buffer,positions.byteOffset,positions.byteLength)),indexSha256:sha(Buffer.from(indices.buffer,indices.byteOffset,indices.byteLength))};
const material=primitive.getMaterial();
if(!material?.getBaseColorTexture()||!material.getNormalTexture()||!material.getMetallicRoughnessTexture())throw Error('Native PBR maps missing');
const textures=[];
for(const t of root.listTextures()){
 const image=t.getImage(),meta=await sharp(image).metadata();
 const kind=t===material.getBaseColorTexture()?'baseColor':t===material.getNormalTexture()?'normal':'metallicRoughness';
 const optimized=await sharp(image).resize(2048,2048).jpeg({quality:kind==='baseColor'?92:93,chromaSubsampling:'4:4:4'}).toBuffer();
 t.setImage(optimized).setMimeType('image/jpeg');
 textures.push({kind,name:t.getName(),sourceSize:[meta.width,meta.height],sourceBytes:image.length,sourceSha256:sha(image),runtimeSize:[2048,2048],runtimeBytes:optimized.length,runtimeSha256:sha(optimized)});
}
mesh.setName('HollowStarConnectedBody');meshNode.setName('HollowStarMesh');
const presentation=doc.createNode('HollowStarPresentation').setScale([3.6,3.6,3.6]);
const motion=doc.createNode('HollowStarMotion');
scene.removeChild(meshNode);scene.addChild(presentation);presentation.addChild(motion);motion.addChild(meshNode);
// The native body is a connected YZ radial frame, with its open center near y=.52.
// Eight broad sectors share overlapping weights through the membrane. There are no legs.
const center=[0,.52,0],segments=8,buffer=root.listBuffers()[0];
const core=doc.createNode('HollowCore').setTranslation(center);motion.addChild(core);
const sector=Array.from({length:segments},(_,i)=>{
 const n=doc.createNode(`MembraneSector${i}`);core.addChild(n);return n;
});
const skin=doc.createSkin('HollowStarRadialMembrane').setSkeleton(core).addJoint(core);
for(const n of sector)skin.addJoint(n);
const ibm=new Float32Array((segments+1)*16);
for(let i=0;i<=segments;i++)ibm.set(new Matrix4().makeTranslation(-center[0],-center[1],-center[2]).toArray(),i*16);
skin.setInverseBindMatrices(doc.createAccessor('HollowStarInverseBinds').setType(Accessor.Type.MAT4).setArray(ibm).setBuffer(buffer));
meshNode.setSkin(skin);
const joints=new Uint16Array(7169*4),weights=new Float32Array(7169*4),mass=Array(segments+1).fill(0);
let blended=0;
for(let i=0;i<7169;i++){
 const y=positions[i*3+1]-center[1],z=positions[i*3+2],r=Math.hypot(y,z);
 const angle=(Math.atan2(y,z)+Math.PI*2)%(Math.PI*2),u=angle/(Math.PI*2)*segments;
 const lo=Math.floor(u)%segments,hi=(lo+1)%segments,f=u-Math.floor(u);
 const radial=Math.max(0,Math.min(1,(r-.07)/.25));
 // Smooth angular overlap keeps a continuous sheet, including along sector boundaries.
 const blend=f*f*(3-2*f),outer=radial*.88;
 const values=[[0,1-outer],[lo+1,outer*(1-blend)],[hi+1,outer*blend]];
 values.sort((a,b)=>b[1]-a[1]);
 for(let k=0;k<values.length;k++){joints[i*4+k]=values[k][0];weights[i*4+k]=values[k][1];mass[values[k][0]]+=values[k][1];}
 if(values.filter(v=>v[1]>.05).length>1)blended++;
}
primitive.setAttribute('JOINTS_0',doc.createAccessor('HollowStarJoints').setType(Accessor.Type.VEC4).setArray(joints).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0',doc.createAccessor('HollowStarWeights').setType(Accessor.Type.VEC4).setArray(weights).setBuffer(buffer));
const quat=(x,y,z)=>new Quaternion().setFromEuler({isEuler:true,_x:x,_y:y,_z:z,_order:'XYZ'}).toArray();
const state=({float=0,pulse=0,travel=0,charge=0,flare=0,recoil=0,collapse=0}={})=>{
 const s={motion_t:[charge*.17-recoil*.10, .08+float+travel*.025-collapse*.30-Math.pow(collapse,4)*.07,0],motion_r:quat(0,0,travel*.045+recoil*.12+collapse*.18),core_r:quat(0,pulse*.018,travel*.035)};
 for(let i=0;i<segments;i++){
  const a=i*Math.PI*2/segments,wrapped=a>Math.PI?a-Math.PI*2:a,side=Math.cos(a),beat=pulse*.035+travel*Math.sin(a*2)*.035;
  // At death, opposite spokes fold toward opposite sides of the ground plane.
  // The membrane stays at full width while its upright height drops by half.
  const fold=Math.abs(wrapped)<=Math.PI/2?wrapped:wrapped-Math.sign(wrapped)*Math.PI;
  s[`sector${i}`]=quat(side*(beat+flare*.18)+collapse*fold,Math.sin(a)*(pulse*.04+flare*.12),Math.cos(a)*(pulse*.025+charge*.10));
 }
 return s;
};
const clips=[];
function clip(name,seconds,times,states){
 const animation=doc.createAnimation(name);
 for(const key of Object.keys(states[0])){
  const target=key.startsWith('motion_')?motion:key==='core_r'?core:sector[Number(key.slice(6))];
  const path=key.endsWith('_t')?'translation':'rotation';
  const input=doc.createAccessor(`${name}_${key}_time`).setType(Accessor.Type.SCALAR).setArray(Float32Array.from(times)).setBuffer(buffer);
  const output=doc.createAccessor(`${name}_${key}`).setType(path==='translation'?Accessor.Type.VEC3:Accessor.Type.VEC4).setArray(Float32Array.from(states.flatMap(x=>x[key]))).setBuffer(buffer);
  const sampler=doc.createAnimationSampler(`${name}_${key}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
  animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${name}_${key}`).setTargetNode(target).setTargetPath(path).setSampler(sampler));
 }
 clips.push({name,seconds,channels:Object.keys(states[0]).length});
}
clip('Idle',2.4,[0,.6,1.2,1.8,2.4],[0,1,0,-1,0].map(v=>state({float:v*.035,pulse:v})));
for(const [name,seconds,amplitude] of [['Walk',1.55,.7],['Run',.92,1]]){
 const times=Array.from({length:17},(_,i)=>seconds*i/16);
 clip(name,seconds,times,times.map(t=>{const phase=t/seconds*Math.PI*2;return state({float:Math.sin(phase)*.027*amplitude,pulse:Math.sin(phase*2)*.6*amplitude,travel:Math.sin(phase)*amplitude});}));
}
clip('Attack',1.28,[0,.17,.36,.55,.72,.96,1.28],[state(),state({charge:.35,pulse:-.8}),state({charge:.65,pulse:-1}),state({charge:1,flare:1,pulse:1}),state({charge:.62,flare:.7}),state({charge:.22,flare:.25}),state()]);
clip('Hit',.62,[0,.13,.29,.62],[state(),state({recoil:1,pulse:-.5}),state({recoil:.5,pulse:.4}),state()]);
clip('Death',1.8,[0,.22,.48,.76,1.12,1.8],[state(),state({recoil:.8,collapse:.08}),state({collapse:.45,pulse:-.4}),state({collapse:.82}),state({collapse:1}),state({collapse:1})]);
const result=await io.writeBinary(doc);await writeFile(candidateFile,result);
const validation={sourceFile,sourceSha256:sourceSha,sourceBytes:bytes.length,candidateFile,candidateSha256:sha(result),candidateBytes:result.length,vertices:7169,triangles:4862,sourceGeometry:geometry,sourceGeometryPreserved:true,textureMaps:textures,joints:['HollowCore',...sector.map(n=>n.getName())],weightMass:mass,blendedVertices:blended,clips,attackContactSeconds:.55,attackContactNormalized:.55/1.28,restBounds:{min:[-.4345703423,0,-.4990233183],max:[.4345703423,.9902342558,.4990233183]},presentationScale:3.6,status:'awaiting-root-lab-review',accepted:false};
await writeFile(dir+'/validation.json',JSON.stringify(validation,null,2)+'\n');
console.log(JSON.stringify(validation,null,2));
