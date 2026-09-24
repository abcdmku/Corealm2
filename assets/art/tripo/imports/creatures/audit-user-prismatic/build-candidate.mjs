import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsIridescence } from '@gltf-transform/extensions';
import { Quaternion, Vector3 } from 'three';

const dir='assets/art/tripo/imports/creatures/audit-user-prismatic';
const source=`${dir}/sources/fantasy+insect+3d+model.glb`, output=`${dir}/prismatic-sprite-candidate.glb`;
const sourceHash='10d092f72e9bac46e2bdd88b157dd4b1d1b1b6eb0d1a0cb9e8c4c9b81f39c174';
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourceBytes=await readFile(source);
if(sha(sourceBytes)!==sourceHash)throw Error('Source changed');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),doc=await io.readBinary(sourceBytes),root=doc.getRoot(),buffer=root.listBuffers()[0];
const mesh=root.listMeshes()[0],prim=mesh.listPrimitives()[0],meshNode=root.listNodes().find(n=>n.getMesh()===mesh);
if(root.listMeshes().length!==1||mesh.listPrimitives().length!==1||root.listSkins().length||root.listAnimations().length||prim.getAttribute('POSITION').getCount()!==6537||prim.getIndices().getCount()!==14598)throw Error('Unexpected source topology');
const nativeMaps=root.listTextures().map(t=>({name:t.getName(),sha256:sha(t.getImage()),bytes:t.getImage().length,mimeType:t.getMimeType()}));
if(!prim.getMaterial().getBaseColorTexture()||!prim.getMaterial().getNormalTexture()||!prim.getMaterial().getMetallicRoughnessTexture())throw Error('Native PBR missing');
// Source faces +X. Preserve its complete body and native UVs while orienting
// the gem-eyed fae toward game-forward +Z.
const scale=2,position=prim.getAttribute('POSITION').getArray(),normal=prim.getAttribute('NORMAL').getArray();
for(let i=0;i<position.length;i+=3){const x=position[i],z=position[i+2];position[i]=-z*scale;position[i+1]*=scale;position[i+2]=(x-.28)*scale;}
for(let i=0;i<normal.length;i+=3){const x=normal[i],z=normal[i+2];normal[i]=-z;normal[i+2]=x;}
const idx=prim.getIndices().getArray();
const bones=[
 ['Root',null,[0,0,0]],['Thorax','Root',[0,1.05,0]],['Head','Thorax',[0,1.47,.07]],
 ['Pelvis','Thorax',[0,.88,0]],['NativeThighL','Pelvis',[-.13,.75,0]],['NativeShinL','NativeThighL',[-.14,.36,0]],['NativeFootL','NativeShinL',[-.15,.08,.04]],
 ['NativeThighR','Pelvis',[.13,.75,0]],['NativeShinR','NativeThighR',[.14,.36,0]],['NativeFootR','NativeShinR',[.15,.08,.04]],
 ['AbdomenBase','Thorax',[0,.96,-.23]],['AbdomenMid','AbdomenBase',[0,.83,-.67]],['AbdomenTip','AbdomenMid',[0,.77,-1.05]],
 ['WingLF','Thorax',[-.14,1.36,.02]],['WingRF','Thorax',[.14,1.36,.02]],
 ['WingLH','Thorax',[-.14,1.31,-.09]],['WingRH','Thorax',[.14,1.31,-.09]],
];
const byName=new Map(),absolute=new Map(bones.map(b=>[b[0],b[2]]));
for(const [name,parent,p] of bones){const pp=parent?absolute.get(parent):[0,0,0],node=doc.createNode(name).setTranslation(p.map((x,i)=>x-pp[i]));byName.set(name,node);if(parent)byName.get(parent).addChild(node);else root.listScenes()[0].addChild(node);}
const skin=doc.createSkin('Prismatic sprite anatomical skin').setSkeleton(byName.get('Root'));
const inverse=new Float32Array(bones.length*16);bones.forEach(([name,,p],i)=>{skin.addJoint(byName.get(name));inverse.set([1,0,0,0,0,1,0,0,0,0,1,0,-p[0],-p[1],-p[2],1],i*16);});
skin.setInverseBindMatrices(doc.createAccessor('Inverse binds').setType(Accessor.Type.MAT4).setArray(inverse).setBuffer(buffer));meshNode.setSkin(skin).setName('PrismaticSpriteNativeBody');
const jointIndex=new Map(bones.map((b,i)=>[b[0],i])),vcount=position.length/3,joints=new Uint16Array(vcount*4),weights=new Float32Array(vcount*4);
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));const smooth=(a,b,x)=>{let v=clamp((x-a)/(b-a));return v*v*(3-2*v)};
for(let i=0;i<vcount;i++){
 const x=position[i*3],y=position[i*3+1],z=position[i*3+2],ax=Math.abs(x);
 let choices=[['Thorax',1]];
 if(y<1.05){const pelvisGate=1-smooth(.90,1.08,y);choices=[['Pelvis',pelvisGate],['Thorax',1-pelvisGate]];}
 if(y<.91){const side=x<0?'L':'R',hip=smooth(.02,.10,Math.abs(x)),low=1-smooth(.69,.89,y),foot=1-smooth(.10,.24,y),shin=(1-smooth(.34,.53,y))*(1-foot);choices=[[`NativeFoot${side}`,hip*low*foot],[`NativeShin${side}`,hip*low*shin],[`NativeThigh${side}`,hip*low*(1-shin-foot)],['Pelvis',1-hip*low]];}
 if(y>1.40&&ax<.26)choices=[['Head',smooth(1.4,1.56,y)],['Thorax',1-smooth(1.4,1.56,y)]];
 if(ax>.21&&y>1.24){const side=x<0?'L':'R',fore=z>-.09?'F':'H';const gate=smooth(.17,.38,ax);choices=[[`Wing${side}${fore}`,gate],['Thorax',1-gate]];}
 const total=choices.reduce((s,c)=>s+c[1],0);choices.forEach(([n,w],k)=>{joints[i*4+k]=jointIndex.get(n);weights[i*4+k]=w/total;});
}
prim.setAttribute('JOINTS_0',doc.createAccessor('Source joint indices').setType(Accessor.Type.VEC4).setArray(joints).setBuffer(buffer));
prim.setAttribute('WEIGHTS_0',doc.createAccessor('Source joint weights').setType(Accessor.Type.VEC4).setArray(weights).setBuffer(buffer));
// Faceted abdomen is an added accent. The native body, limbs, wing surfaces,
// detailed color, normal, and metallic-roughness maps remain complete.
const crystal=doc.createMaterial('Opaline segmented crystal').setBaseColorFactor([.52,.35,.92,1]).setMetallicFactor(.33).setRoughnessFactor(.25).setDoubleSided(true);
crystal.setEmissiveFactor([.09,.045,.18]);
const iri=doc.createExtension(KHRMaterialsIridescence).createIridescence().setIridescenceFactor(.82).setIridescenceIOR(1.3).setIridescenceThicknessMinimum(160).setIridescenceThicknessMaximum(390);
crystal.setExtension('KHR_materials_iridescence',iri);
function addRods(name,segments,material){
 const p=[],n=[],uv=[],ji=[],we=[],tri=[];let vertex=0;
 for(const s of segments){const [a,b,r0,r1,bone]=s,start=vertex,axis=new Vector3(...b).sub(new Vector3(...a)).normalize(),side=new Vector3(0,1,0).cross(axis).normalize();if(side.length()<.01)side.set(1,0,0);const up=axis.clone().cross(side).normalize();
  for(let ring=0;ring<2;ring++)for(let k=0;k<8;k++){const angle=k*Math.PI/4,rad=ring?r1:r0,center=ring?b:a,off=side.clone().multiplyScalar(Math.cos(angle)*rad).addScaledVector(up,Math.sin(angle)*rad);p.push(center[0]+off.x,center[1]+off.y,center[2]+off.z);n.push(off.x/rad,off.y/rad,off.z/rad);uv.push(k/8,ring);ji.push(jointIndex.get(bone),0,0,0);we.push(1,0,0,0);vertex++;}
  for(let k=0;k<8;k++){const j=(k+1)%8;tri.push(start+k,start+j,start+8+k,start+j,start+8+j,start+8+k);}
 }
 const m=doc.createMesh(name),q=doc.createPrimitive().setMaterial(material).setIndices(doc.createAccessor(name+' indices').setType(Accessor.Type.SCALAR).setArray(Uint16Array.from(tri)).setBuffer(buffer));
 for(const [sem,arr,type] of [['POSITION',p,Accessor.Type.VEC3],['NORMAL',n,Accessor.Type.VEC3],['TEXCOORD_0',uv,Accessor.Type.VEC2],['JOINTS_0',ji,Accessor.Type.VEC4],['WEIGHTS_0',we,Accessor.Type.VEC4]])q.setAttribute(sem,doc.createAccessor(name+' '+sem).setType(type).setArray(sem==='JOINTS_0'?Uint16Array.from(arr):Float32Array.from(arr)).setBuffer(buffer));
 m.addPrimitive(q);root.listScenes()[0].addChild(doc.createNode(name).setMesh(m).setSkin(skin));return {vertices:vertex,triangles:tri.length/3};
}
const abdomen=[];const centers=[[0,.98,-.19],[0,.91,-.34],[0,.84,-.50],[0,.77,-.67],[0,.71,-.84],[0,.66,-1.01],[0,.62,-1.16]];
for(let i=0;i<6;i++)abdomen.push([centers[i],centers[i+1],i<2?.095:.082,i===5?.025:.075,i<2?'AbdomenBase':i<4?'AbdomenMid':'AbdomenTip']);
const abdomenStats=addRods('Six crystal abdomen segments',abdomen,crystal);
const Q=(axis,a)=>new Quaternion().setFromAxisAngle(new Vector3(...axis),a).toArray(),X=a=>Q([1,0,0],a),Y=a=>Q([0,1,0],a),Z=a=>Q([0,0,1],a);
function clip(name,seconds,tracks){const a=doc.createAnimation(name);for(const [bone,path,keys]of tracks){const times=keys.map(k=>k[0]),values=keys.flatMap(k=>k[1]),type=path==='rotation'?Accessor.Type.VEC4:Accessor.Type.VEC3;const input=doc.createAccessor(name+bone+path+'time').setType(Accessor.Type.SCALAR).setArray(Float32Array.from(times)).setBuffer(buffer),out=doc.createAccessor(name+bone+path+'value').setType(type).setArray(Float32Array.from(values)).setBuffer(buffer),sampler=doc.createAnimationSampler().setInput(input).setOutput(out).setInterpolation('LINEAR');a.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(byName.get(bone)).setTargetPath(path).setSampler(sampler));}return {name,seconds,channels:a.listChannels().length};}
const wingTracks=(seconds,rate=1,amplitude=.32)=>['WingLF','WingRF','WingLH','WingRH'].map((name,i)=>[name,'rotation',Array.from({length:rate*8+1},(_,k)=>{const t=seconds*k/(rate*8),phase=k/8*Math.PI*2+(i>=2?Math.PI:0),sign=i%2===0?-1:1;return [t,Z(sign*amplitude*Math.sin(phase))];})]);
const limbs=(seconds,amount)=>['L','R'].flatMap((side,i)=>[[`NativeThigh${side}`,'rotation',Array.from({length:9},(_,k)=>[seconds*k/8,X(amount*Math.sin(k*Math.PI/4+i*Math.PI))])],[`NativeShin${side}`,'rotation',Array.from({length:9},(_,k)=>[seconds*k/8,X(-.12-.18*Math.max(0,Math.sin(k*Math.PI/4+i*Math.PI)))])]]);
const clips=[];
clips.push(clip('Idle',2,[['Root','translation',[[0,[0,.20,0]],[.5,[0,.235,0]],[1,[0,.20,0]],[1.5,[0,.175,0]],[2,[0,.20,0]]]],['AbdomenTip','rotation',[[0,Y(-.09)],[1,Y(.09)],[2,Y(-.09)]]],...wingTracks(2,9,.24),...limbs(2,.09)]));
for(const [name,seconds,rate,amp]of[['Walk',1.1,7,.38],['Run',.7,6,.50]])clips.push(clip(name,seconds,[['Root','translation',[[0,[0,.20,0]],[seconds/4,[0,.26,0]],[seconds/2,[0,.20,0]],[seconds*3/4,[0,.25,0]],[seconds,[0,.20,0]]]],['Thorax','rotation',[[0,Y(-.05)],[seconds/2,Y(.05)],[seconds,Y(-.05)]]],...wingTracks(seconds,rate,amp),...limbs(seconds,name==='Run'?.24:.16)]));
clips.push(clip('Attack',1.12,[['Root','translation',[[0,[0,.20,0]],[.28,[0,.30,-.13]],[.58,[0,.24,.24]],[.78,[0,.22,.11]],[1.12,[0,.20,0]]]],['Thorax','rotation',[[0,X(0)],[.28,X(-.18)],[.58,X(.30)],[.78,X(.12)],[1.12,X(0)]]],['Head','rotation',[[0,X(0)],[.28,X(-.12)],[.58,X(.18)],[1.12,X(0)]]],['AbdomenMid','rotation',[[0,X(0)],[.28,X(-.12)],[.58,X(.26)],[1.12,X(0)]]],...wingTracks(1.12,6,.54)]));
clips.push(clip('Hit',.55,[['Root','translation',[[0,[0,.20,0]],[.1,[0,.16,0]],[.28,[0,.21,0]],[.55,[0,.20,0]]]],['Thorax','rotation',[[0,X(0)],[.1,X(-.22)],[.28,X(.09)],[.55,X(0)]]],['Head','rotation',[[0,X(0)],[.1,X(-.18)],[.55,X(0)]]],...wingTracks(.55,3,.25)]));
clips.push(clip('Death',1.6,[['Root','translation',[[0,[0,.20,0]],[.2,[0,.10,0]],[.52,[0,-.33,0]],[.85,[0,-.85,0]],[1.6,[0,-.85,0]]]],['Thorax','rotation',[[0,X(0)],[.2,X(.30)],[.52,X(.90)],[.85,X(1.45)],[1.6,X(1.45)]]],['Head','rotation',[[0,X(0)],[.52,X(.18)],[.85,X(.34)],[1.6,X(.34)]]],['AbdomenBase','rotation',[[0,X(0)],[.52,X(-.55)],[.85,X(-1.15)],[1.6,X(-1.15)]]],...['WingLF','WingRF','WingLH','WingRH'].map((name,i)=>[name,'rotation',[[0,Z(0)],[.52,Z(i%2?-.18:.18)],[.85,Z(i%2?-.80:.80)],[1.6,Z(i%2?-.80:.80)]]]),...['L','R'].flatMap(side=>[['NativeThigh'+side,'rotation',[[0,X(0)],[.52,X(.35)],[.85,X(.75)],[1.6,X(.75)]]],['NativeShin'+side,'rotation',[[0,X(0)],[.52,X(-.35)],[.85,X(-.85)],[1.6,X(-.85)]]]]) ]));
const bytes=await io.writeBinary(doc);await writeFile(output,bytes);
const builderSha=sha(await readFile(`${dir}/build-candidate.mjs`));
const entry={id:'creature_prismatic_sprite',file:'models/creature/creature_prismatic_sprite.glb',candidateFile:output,pack:'corealm-user-prismatic',category:'character',is:'Prismatic Sprite',tags:['creature','fae','dragonfly','sprite','user-supplied'],bytes:bytes.length,sha256:sha(bytes),size:{x:1.996094,y:1.996094,z:1.535975},base:{x:-.998047,y:0,z:-1.319766},bounds:{min:[-.998047,0,-1.319766],max:[.998047,1.996094,.216209]},groundY:0,animations:clips.map(c=>c.name),materials:root.listMaterials().map(m=>m.getName()),walkClipSeconds:1.1,runClipSeconds:.7,attackSeconds:1.12,contactNormalized:.58/1.12,impliedWalkMps:null,impliedRunMps:null,locomotionPolicy:'definition-speed; in-place hovering',metadata:{contactSeconds:.58,contactBasis:'Thorax and head dive reach forward maximum at 0.58 s'},sourceProvenance:{file:source,sha256:sourceHash,bytes:sourceBytes.length,nativeTextures:nativeMaps,sourceVertices:6537,sourceTriangles:4866,sourceGeometryPreserved:true,addedAbdomen:abdomenStats,rig:'Anatomical 17-joint skin with native legs and four independently fluttering wing roots'},acceptance:{assetAudit:false,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false}};
const pack={id:'corealm-user-prismatic',name:'User Prismatic Sprite',author:'User / Corealm',source:`${dir}/build-candidate.mjs`,license:'User supplied; license pending project owner',generatorSha256:builderSha};
await writeFile(`${dir}/lab-catalog.json`,JSON.stringify({schema:'corealm-lab-asset-candidates/1',pack,assets:[entry],files:{[entry.id]:output}},null,2)+'\n');
await writeFile(`${dir}/promotion.json`,JSON.stringify({schema:'corealm-creature-promotion/1',sourceRoot:'.',destinationRoot:'game/public/assets',pack,assets:[entry],status:'awaiting-root-lab-review',accepted:false,builder:{file:`${dir}/build-candidate.mjs`,sha256:builderSha},joints:bones.map(([name,parent,position],index)=>({index,name,parent,position})),clips},null,2)+'\n');
console.log(JSON.stringify({output,sha256:sha(bytes),bytes:bytes.length,sourceHash,joints:bones.length,clips,sourceTriangles:idx.length/3,abdomenStats},null,2));
