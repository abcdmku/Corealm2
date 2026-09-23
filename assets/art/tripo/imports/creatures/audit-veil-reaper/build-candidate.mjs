import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const dir = 'assets/art/tripo/imports/creatures/audit-veil-reaper';
const sourcePath = 'assets/art/tripo/exports/corealm_veil_reaper_6fadb584_8k_rigged.glb';
const candidatePath = `${dir}/veil-reaper-native-rig.glb`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourcePath);
const sourceSha256 = hash(sourceBytes);
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot(), scene = root.listScenes()[0], mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find(n => n.getMesh() === mesh);
if (!scene || !primitive || !meshNode || root.listAnimations().length) throw new Error('Unexpected Veil Reaper source structure.');
const position = primitive.getAttribute('POSITION').getArray();
const normal = primitive.getAttribute('NORMAL').getArray();
const uv = primitive.getAttribute('TEXCOORD_0').getArray();
const indices = primitive.getIndices().getArray();
const geoHashes = { position: hash(Buffer.from(position.buffer, position.byteOffset, position.byteLength)), normal: hash(Buffer.from(normal.buffer, normal.byteOffset, normal.byteLength)), uv: hash(Buffer.from(uv.buffer, uv.byteOffset, uv.byteLength)), indices: hash(Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength)) };
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i=0;i<position.length;i+=3) for (let a=0;a<3;a++) { bounds.min[a]=Math.min(bounds.min[a],position[i+a]); bounds.max[a]=Math.max(bounds.max[a],position[i+a]); }
if (position.length/3 !== 3470 || indices.length/3 !== 4883) throw new Error('Source topology changed.');
const sourceJoints = primitive.getAttribute('JOINTS_0').getArray();
const sourceWeights = primitive.getAttribute('WEIGHTS_0').getArray();
let originalRootCount=0;
for(let i=0;i<position.length/3;i++) if(sourceJoints[i*4]===0 && sourceWeights[i*4]>.99) originalRootCount++;
if(originalRootCount<3400) throw new Error(`Source rig may have been repaired already: ${originalRootCount} root-bound vertices.`);

const originalNodes=[...root.listNodes()];
const oldParent=meshNode.getParentNode();
if(oldParent) oldParent.removeChild(meshNode); else scene.removeChild(meshNode);
primitive.setAttribute('JOINTS_0',null).setAttribute('WEIGHTS_0',null);
meshNode.setSkin(null).setTranslation([0,0,0]).setRotation([0,0,0,1]).setScale([1,1,1]).setName('VeilReaperMesh');
for(const skin of [...root.listSkins()]) skin.dispose();
for(const node of originalNodes) if(node!==meshNode) node.dispose();
scene.setName('VeilReaperScene');
const presentation=doc.createNode('VeilReaperPresentation').setScale([2.15,2.15,2.15]);
scene.addChild(presentation);
presentation.addChild(meshNode);

// A short spectral tail replaces legs. These bind points follow this source's hood,
// mantle, long claw arms and curling lower veils, rather than a generic biped.
const bones=[
  {n:'SpiritRoot',p:null,at:[0,0,0],kind:'root',sigma:.18},
  {n:'TailBase',p:'SpiritRoot',at:[0,.37,0],kind:'tail',sigma:.12},
  {n:'TailMiddle',p:'TailBase',at:[0,.22,0],kind:'tail',sigma:.12},
  {n:'TailTip',p:'TailMiddle',at:[0,.07,0],kind:'tail',sigma:.13},
  {n:'Spine',p:'TailBase',at:[0,.53,0],kind:'torso',sigma:.15},
  {n:'Chest',p:'Spine',at:[0,.68,0],kind:'torso',sigma:.16},
  {n:'Neck',p:'Chest',at:[0,.80,0],kind:'head',sigma:.10},
  {n:'Head',p:'Neck',at:[0,.90,0],kind:'head',sigma:.12},
  {n:'LeftShoulder',p:'Chest',at:[-.15,.72,0],kind:'arm',side:-1,sigma:.075},
  {n:'LeftArm',p:'LeftShoulder',at:[-.22,.61,0],kind:'arm',side:-1,sigma:.085},
  {n:'LeftForearm',p:'LeftArm',at:[-.26,.47,0],kind:'arm',side:-1,sigma:.075},
  {n:'LeftClaw',p:'LeftForearm',at:[-.29,.34,0],kind:'arm',side:-1,sigma:.08},
  {n:'RightShoulder',p:'Chest',at:[.15,.72,0],kind:'arm',side:1,sigma:.075},
  {n:'RightArm',p:'RightShoulder',at:[.22,.61,0],kind:'arm',side:1,sigma:.085},
  {n:'RightForearm',p:'RightArm',at:[.26,.47,0],kind:'arm',side:1,sigma:.075},
  {n:'RightClaw',p:'RightForearm',at:[.29,.34,0],kind:'arm',side:1,sigma:.08},
];
const byName=new Map(bones.map((b,i)=>[b.n,{...b,i}]));
const nodes=new Map();
for(const bone of bones){
  const parent=bone.p?byName.get(bone.p):null;
  const at=parent?bone.at.map((v,a)=>v-parent.at[a]):bone.at;
  const node=doc.createNode(bone.n).setTranslation(at);
  nodes.set(bone.n,node);
  (parent?nodes.get(parent.n):presentation).addChild(node);
}
const buffer=root.listBuffers()[0];
const skin=doc.createSkin('VeilReaperAnatomicalSkin').setSkeleton(nodes.get('SpiritRoot'));
for(const b of bones) skin.addJoint(nodes.get(b.n));
const ibm=new Float32Array(bones.length*16);
for(let i=0;i<bones.length;i++){const [x,y,z]=bones[i].at;ibm.set([1,0,0,0,0,1,0,0,0,0,1,0,-x,-y,-z,1],i*16);}
skin.setInverseBindMatrices(doc.createAccessor('VeilReaperInverseBinds').setArray(ibm).setType(Accessor.Type.MAT4).setBuffer(buffer));
meshNode.setSkin(skin);
function segmentDistance(point,a,b){const d=b.map((v,i)=>v-a[i]);const l=d.reduce((s,v)=>s+v*v,0)||1;const t=Math.max(0,Math.min(1,point.reduce((s,v,i)=>s+(v-a[i])*d[i],0)/l));return Math.hypot(...point.map((v,i)=>v-a[i]-t*d[i]));}
const joints=new Uint16Array(position.length/3*4),weights=new Float32Array(position.length/3*4),coverage=new Uint32Array(bones.length);
let distributed=0,maxWeightError=0;
for(let i=0;i<position.length/3;i++){
  const point=[position[i*3],position[i*3+1],position[i*3+2]], [x,y]=point;
  const candidates=[];
  for(const b of bones){
    if(b.kind==='root')continue;
    let gate=1;
    if(b.kind==='head')gate=y>.76?7:.003;
    if(b.kind==='tail')gate=y<.52?1:.002;
    if(b.kind==='torso')gate=y>.32&&y<.83?1:.02;
    if(b.kind==='arm')gate=(y>.27&&y<.81?1:.003)*(.005+.995/(1+Math.exp(-((b.side*x)-.14)/.025)));
    const p=b.p?byName.get(b.p).at:b.at;
    const distance=segmentDistance(point,p,b.at);
    const score=gate*Math.exp(-.5*(distance/b.sigma)**2);
    if(score>1e-12)candidates.push({i:byName.get(b.n).i,score});
  }
  candidates.sort((a,b)=>b.score-a.score);
  const top=candidates.slice(0,4),total=top.reduce((s,v)=>s+v.score,0);
  let assigned=0,nonzero=0;
  for(let s=0;s<4;s++){
    const v=top[s]??top[0],w=s>=top.length?0:s===top.length-1?1-assigned:v.score/total;
    joints[i*4+s]=v.i;weights[i*4+s]=w;assigned+=w;
    if(w>1e-6){coverage[v.i]++;nonzero++;}
  }
  if(nonzero>1)distributed++;
  maxWeightError=Math.max(maxWeightError,Math.abs(1-weights[i*4]-weights[i*4+1]-weights[i*4+2]-weights[i*4+3]));
}
if(distributed<position.length/3*.8||maxWeightError>1e-5)throw new Error(`Bad weight fit: ${distributed} distributed, error ${maxWeightError}`);
primitive.setAttribute('JOINTS_0',doc.createAccessor('VeilReaperJoints').setArray(joints).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0',doc.createAccessor('VeilReaperWeights').setArray(weights).setType(Accessor.Type.VEC4).setBuffer(buffer));

const quat=(axis,a)=>{const s=Math.sin(a/2),c=Math.cos(a/2);return axis==='x'?[s,0,0,c]:axis==='y'?[0,s,0,c]:[0,0,s,c];};
const clips=[];
function clip(name,seconds,tracks){
  const animation=doc.createAnimation(name);
  for(const [bone,path,times,values] of tracks){
    const input=doc.createAccessor(`${name}_${bone}_${path}_times`).setArray(Float32Array.from(times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const output=doc.createAccessor(`${name}_${bone}_${path}_values`).setArray(Float32Array.from(values.flat())).setType(path==='rotation'?Accessor.Type.VEC4:Accessor.Type.VEC3).setBuffer(buffer);
    const sampler=doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(nodes.get(bone)).setTargetPath(path).setSampler(sampler));
  }
  clips.push({name,seconds,channels:tracks.length});
}
const R=(b,a,t,v)=>[b,'rotation',t,v.map(n=>quat(a,n))],T=(b,t,v)=>[b,'translation',t,v],S=(b,t,v)=>[b,'scale',t,v];
const id=[0,.55,1.1,1.65,2.2];
clip('Idle',2.2,[T('SpiritRoot',id,[[0,0,0],[0,.014,0],[0,0,0],[0,-.014,0],[0,0,0]]),R('TailMiddle','z',id,[0,.07,0,-.07,0]),R('TailTip','y',id,[0,.13,0,-.13,0]),R('Chest','y',id,[0,-.025,0,.025,0]),R('Head','y',id,[0,.04,0,-.04,0])]);
const walk=[0,.3,.6,.9,1.2];
clip('Walk',1.2,[T('SpiritRoot',walk,[[0,0,0],[0,.025,0],[0,0,0],[0,-.025,0],[0,0,0]]),R('Spine','z',walk,[-.025,0,.025,0,-.025]),R('TailMiddle','z',walk,[.09,0,-.09,0,.09]),R('TailTip','y',walk,[.17,0,-.17,0,.17]),R('LeftArm','x',walk,[-.09,0,.09,0,-.09]),R('RightArm','x',walk,[.09,0,-.09,0,.09])]);
const run=[0,.18,.36,.54,.72];
clip('Run',.72,[T('SpiritRoot',run,[[0,0,0],[0,.034,.015],[0,0,0],[0,-.034,-.015],[0,0,0]]),R('Spine','x',run,[-.06,-.02,-.06,-.10,-.06]),R('TailMiddle','z',run,[.16,0,-.16,0,.16]),R('TailTip','y',run,[.26,0,-.26,0,.26]),R('LeftArm','x',run,[-.15,0,.15,0,-.15]),R('RightArm','x',run,[.15,0,-.15,0,.15])]);
const attack=[0,.16,.32,.46,.78];
clip('Attack',.78,[T('SpiritRoot',attack,[[0,0,0],[0,0,-.015],[0,.015,.045],[0,.01,.10],[0,0,0]]),R('Chest','x',attack,[0,.05,-.13,-.16,0]),R('Head','x',attack,[0,-.03,.07,.11,0]),R('LeftShoulder','z',attack,[0,-.21,-.34,.22,0]),R('RightShoulder','z',attack,[0,.21,.34,-.22,0]),R('LeftArm','x',attack,[0,-.18,-.48,-.66,0]),R('RightArm','x',attack,[0,-.18,-.48,-.66,0]),R('LeftForearm','x',attack,[0,-.07,-.22,-.36,0]),R('RightForearm','x',attack,[0,-.07,-.22,-.36,0])]);
const hit=[0,.1,.22,.38,.5];
clip('Hit',.5,[R('Spine','x',hit,[0,.15,.09,-.025,0]),R('Head','x',hit,[0,-.13,-.07,.025,0]),R('LeftArm','z',hit,[0,-.22,-.15,0,0]),R('RightArm','z',hit,[0,.22,.15,0,0])]);
clip('HitLeft',.5,[R('Spine','z',hit,[0,.15,.08,-.02,0]),R('Head','z',hit,[0,-.11,-.06,.02,0]),R('LeftArm','z',hit,[0,-.32,-.19,0,0])]);
clip('HitRight',.5,[R('Spine','z',hit,[0,-.15,-.08,.02,0]),R('Head','z',hit,[0,.11,.06,-.02,0]),R('RightArm','z',hit,[0,.32,.19,0,0])]);
// The complete body turns and settles by 0.65 s, then holds its fallen silhouette.
const death=[0,.18,.4,.65,1.4];
clip('Death',1.4,[T('SpiritRoot',death,[[0,0,0],[0,.09,0],[0,.28,0],[0,.24,0],[0,.24,0]]),R('SpiritRoot','z',death,[0,.20,.88,1.57,1.57]),S('SpiritRoot',death,[[1,1,1],[.96,1,1],[.82,1,1],[.66,1,1],[.66,1,1]]),R('TailMiddle','z',death,[0,-.04,-.13,-.19,-.19]),R('TailTip','z',death,[0,.03,.14,.24,.24]),R('LeftArm','x',death,[0,-.10,-.38,-.48,-.48]),R('RightArm','x',death,[0,-.08,-.31,-.39,-.39]),R('Head','z',death,[0,.04,.13,.20,.20])]);

const sourceTextures=[],runtimeTextures=[];
for(const texture of root.listTextures()){
  const bytes=texture.getImage(),meta=await sharp(bytes).metadata();
  sourceTextures.push({name:texture.getName(),width:meta.width,height:meta.height,bytes:bytes.length,sha256:hash(bytes)});
  if(meta.width>2048||meta.height>2048){
    const data=texture===root.listMaterials()[0].getMetallicRoughnessTexture()||texture===root.listMaterials()[0].getNormalTexture();
    const scaled=await sharp(bytes).resize(2048,2048,{kernel:data?'linear':'lanczos3'}).toFormat(meta.format==='jpeg'?'jpeg':'png',meta.format==='jpeg'?{quality:92,chromaSubsampling:'4:4:4'}:{}).toBuffer();
    texture.setImage(scaled);
  }
  const rt=await sharp(texture.getImage()).metadata();
  runtimeTextures.push({name:texture.getName(),width:rt.width,height:rt.height,bytes:texture.getImage().length,sha256:hash(texture.getImage())});
}
const out=await io.writeBinary(doc),outSha=hash(out);
await writeFile(candidatePath,out);
const reread=await io.readBinary(out),pr=reread.getRoot().listMeshes()[0].listPrimitives()[0];
for(const [key,accessor] of [['position',pr.getAttribute('POSITION')],['normal',pr.getAttribute('NORMAL')],['uv',pr.getAttribute('TEXCOORD_0')],['indices',pr.getIndices()]]){
  const arr=accessor.getArray(),sha=hash(Buffer.from(arr.buffer,arr.byteOffset,arr.byteLength));
  if(sha!==geoHashes[key])throw new Error(`Source ${key} changed.`);
}
const actualClips=reread.getRoot().listAnimations().map(a=>a.getName());
if(actualClips.length!==8||clips.some(c=>!actualClips.includes(c.name)))throw new Error('Eight action clips missing.');
const scale=2.15,scaled={min:bounds.min.map(v=>v*scale),max:bounds.max.map(v=>v*scale)};
const size=scaled.max.map((v,i)=>v-scaled.min[i]);
const meta={schema:'corealm-creature-native-rig-candidate/1',id:'creature_veil_reaper',displayName:'Veil Reaper',status:'awaiting-root-lab-review',source:{file:sourcePath,sha256:sourceSha256,bytes:sourceBytes.length,modelId:'6fadb584-9372-420c-87b0-b53632c3cbf3',vertices:position.length/3,triangles:indices.length/3,originalRootBoundVertices:originalRootCount,geometryHashes:geoHashes,textures:sourceTextures},candidate:{file:candidatePath,sha256:outSha,bytes:out.length,vertices:position.length/3,triangles:indices.length/3,size,scale,rigJoints:bones.length,distributedVertices:distributed,maximumWeightError:maxWeightError,textureRuntime:runtimeTextures,clips,death:{collapsedAtSeconds:.65,finalTiltRadians:1.57,finalRootLiftSourceMeters:.24,finalHorizontalScale:.66}},acceptance:{labAccepted:false,worldIntegrated:false}};
await writeFile(`${dir}/catalog.json`,JSON.stringify(meta,null,2)+'\n');
const upstreamUrl='https://studio.tripo3d.ai/3d-model/hooded-wraith-with-layered-tattered-cloak-clawed-hands-and-swirling-6fadb584-9372-420c-87b0-b53632c3cbf3';
const asset={id:'creature_veil_reaper',candidateFile:candidatePath,file:'models/creature/creature_veil_reaper.glb',pack:'corealm-tripo-audit-veil-reaper',category:'character',is:'Veil Reaper',tags:['creature','wraith','floating','tripo','candidate'],bytes:out.length,sha256:outSha,size:{x:size[0],y:size[1],z:size[2]},base:{x:scaled.min[0],y:scaled.min[1],z:scaled.min[2]},bounds:scaled,groundY:0,triangles:indices.length/3,vertices:position.length/3,animations:actualClips,materials:reread.getRoot().listMaterials().map(m=>m.getName()),walkClipSeconds:1.2,runClipSeconds:.72,attackSeconds:.78,contactNormalized:.46/.78,impliedWalkMps:null,impliedRunMps:null,locomotionPolicy:'definition-speed; authored in-place spectral float',metadata:{contactSeconds:.46,contactBasis:'Both claw arms extend and torso lunges forward at 0.46 s.',gamePresentationScale:scale},sourceProvenance:{author:'Corealm reconstruction of owned Tripo Veil Reaper',sourceModelId:'6fadb584-9372-420c-87b0-b53632c3cbf3',upstreamSourceUrl:upstreamUrl,upstreamSource:'Tripo Studio generated GLB',sourceFile:sourcePath,sourceSha256,candidateFile:candidatePath,candidateSha256:outSha,rigMethod:'16-joint source-specific four-weight anatomical float rig; original 3466-root-weight source skin replaced.',geometryPreserved:true,sourceTexturesPreserved:true,sourceTextures,runtimeTextures},acceptance:{assetAudit:true,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false}};
const pack={id:asset.pack,name:'Corealm Tripo Veil Reaper',author:'Corealm / Tripo Studio',source:`${dir}/build-candidate.mjs`,license:'LicenseRef-Corealm-Original',generatorSha256:hash(await readFile(`${dir}/build-candidate.mjs`))};
await writeFile(`${dir}/lab-catalog.json`,JSON.stringify({schema:'corealm-lab-asset-candidates/1',assets:[asset],files:{[asset.id]:'veil-reaper-native-rig.glb'},pack},null,2)+'\n');
await writeFile(`${dir}/promotion.json`,JSON.stringify({schema:'corealm-creature-promotion/1',sourceRoot:'.',destinationRoot:'game/public/assets',pack,assets:[asset],files:{[asset.id]:candidatePath}},null,2)+'\n');
console.log(JSON.stringify({sourceSha256,outSha,bytes:out.length,originalRootCount,distributed,coverage:[...coverage],clips,size,runtimeTextures},null,2));
