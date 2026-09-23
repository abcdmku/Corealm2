import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import * as THREE from 'three';
import { addChannel, duration } from '../../../../../../tools/creature-motion/pose.js';
import { deformedBounds } from '../../../../../../tools/creature-motion/validate-deformation.js';

const owner = 'assets/art/tripo/imports/creatures/dewglass-reliquary';
const sourceFile = 'assets/art/tripo/exports/corealm_dewglass_reliquary_d95af2cf_8k_rigged.glb';
const sourceSha256 = '93cf506871643de157ede59b35972fbf61befd0be0934fe6df1b14963b0eed35';
const sourceImageId = '46fc14b8-a68c-4020-a738-ad8423dbae96';
const modelId = 'd95af2cf-3b9a-498d-9403-7a55fd873a73';
const hash = value => createHash('sha256').update(value).digest('hex');
const source = await readFile(sourceFile);
if (hash(source) !== sourceSha256) throw new Error('Source export SHA-256 differs from the approved export.');
const bindings = JSON.parse(await readFile('assets/art/tripo/imports/content-bindings.json', 'utf8'));
const binding = bindings.bindings?.find(item => item.bindingId === 'dewglass-reliquary')?.source;
if (!binding || binding.imageId !== sourceImageId || binding.modelId !== modelId || binding.reviewStatus !== 'approved' || binding.stage !== 'exported_rigged_glb' || binding.review?.verdict !== 'approved') {
  throw new Error('Approved image/model provenance or exported_rigged_glb stage is missing or changed.');
}
const batch = JSON.parse(await readFile('assets/art/tripo/batches/creatures-fairy.json', 'utf8'));
const batchItem = batch.assets?.find(item => item.key === 'dewglass-reliquary');
if (!batchItem || batchItem.modelId !== modelId || batchItem.sourceImageId !== sourceImageId || batchItem.review?.verdict !== 'approved' || batchItem.stage !== 'exported_rigged_glb' || batchItem.downloadReadyStarred !== true) {
  throw new Error('Starred approved Tripo batch entry does not match the binding.');
}
const approvedImage = await readFile(batchItem.sourceImagePath);
const approvedImageSha256 = hash(approvedImage);
if (approvedImageSha256 !== batchItem.sourceImageSha256) throw new Error('Approved image bytes have changed.');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(sourceFile), root = doc.getRoot();
const mesh = root.listMeshes()[0], meshNode = root.listNodes().find(node => node.getMesh() === mesh);
const primitive = mesh?.listPrimitives()[0], sourceSkin = meshNode?.getSkin();
if (!meshNode || !primitive || !sourceSkin || sourceSkin.listJoints().length !== 14 || root.listAnimations().length !== 0) {
  throw new Error('Source must remain the known one-mesh, 14-joint, zero-clip Tripo export.');
}
const pos = primitive.getAttribute('POSITION')?.getArray(), index = primitive.getIndices()?.getArray(), uv = primitive.getAttribute('TEXCOORD_0')?.getArray();
const oldJoints = primitive.getAttribute('JOINTS_0')?.getArray(), oldWeights = primitive.getAttribute('WEIGHTS_0')?.getArray();
if (!(pos instanceof Float32Array) || !index || !uv || !oldJoints || !oldWeights) throw new Error('Missing source geometry, UVs, or original skin attributes.');
const vertexCount = pos.length / 3, triangleCount = index.length / 3;
const sourceJointCount = sourceSkin.listJoints().length;
const sourcePos = new Float32Array(pos), sourceIndex = new Uint32Array(index), sourceUv = new Float32Array(uv);
let totalWeight = 0, rootWeight = 0; const weightedJointIds = new Set();
for (let i = 0; i < oldWeights.length; i++) if (oldWeights[i] > 1e-6) {
  totalWeight += oldWeights[i]; weightedJointIds.add(oldJoints[i]); if (oldJoints[i] === 0) rootWeight += oldWeights[i];
}
const rootWeightFraction = rootWeight / totalWeight;
if (Math.abs(rootWeightFraction - .999685) > .00002 || weightedJointIds.size !== 3) throw new Error(`Source rig drift: expected the recorded 99.9685% bone_0 mass on three joints, found ${rootWeightFraction} on ${weightedJointIds.size} joints.`);
const material = primitive.getMaterial();
const baseMap = material?.getBaseColorTexture(), mrMap = material?.getMetallicRoughnessTexture(), normalMap = material?.getNormalTexture();
if (!baseMap || !mrMap || !normalMap) throw new Error('The approved source must keep base color, metallic-roughness, and normal maps.');
const sourceMaps = [];
for (const [role, texture, expected] of [['baseColor', baseMap, 8192], ['metallicRoughness', mrMap, 4096], ['normal', normalMap, 4096]]) {
  const meta = await sharp(texture.getImage()).metadata();
  if (meta.width !== expected || meta.height !== expected) throw new Error(`${role} source map drift: ${meta.width}x${meta.height}`);
  sourceMaps.push({ role, name: texture.getName(), width: meta.width, height: meta.height, sha256: hash(texture.getImage()) });
}

// Y-up, +X forward and Z lateral follow the approved orthographic creature design.
// The source has four separated leg chains below a central body; paired fore/hind
// limbs retain the large dorsal seed husk as deforming body surface.
const bones = [
  { name: 'ReliquaryRoot', parent: null, p: [0, .29, 0], kind: 'root' },
  { name: 'ReservoirBody', parent: 'ReliquaryRoot', p: [0, .43, 0], kind: 'body' },
  { name: 'PearlHusk', parent: 'ReservoirBody', p: [-.035, .68, 0], kind: 'husk' },
  { name: 'Neck', parent: 'ReservoirBody', p: [.20, .38, 0], kind: 'neck' },
  { name: 'Head', parent: 'Neck', p: [.30, .28, 0], kind: 'head' },
  { name: 'Tail', parent: 'ReservoirBody', p: [-.29, .39, 0], kind: 'tail' },
];
const legs = [];
for (const leg of [
  { name: 'ForeNear', x: .17, z: -.25 }, { name: 'ForeFar', x: .17, z: .25 },
  { name: 'HindNear', x: -.19, z: -.25 }, { name: 'HindFar', x: -.19, z: .25 },
]) {
  const shoulder = [leg.x, .36, leg.z * .72], knee = [leg.x + (leg.x > 0 ? .025 : -.045), .19, leg.z * 1.03];
  const hipName = `${leg.name}Upper`, shinName = `${leg.name}Lower`;
  bones.push({ name: hipName, parent: 'ReservoirBody', p: shoulder, kind: 'legUpper', leg });
  bones.push({ name: shinName, parent: hipName, p: knee, kind: 'legLower', leg });
  legs.push({ ...leg, hipName, shinName, shoulder, knee });
}
if (bones.length !== 14) throw new Error(`Expected a 14-joint quadruped rig; authored ${bones.length}.`);
const boneByName = new Map(bones.map((bone, i) => { bone.index = i; return [bone.name, bone]; }));
for (const bone of bones) bone.local = bone.parent ? bone.p.map((v, axis) => v - bones[boneByName.get(bone.parent).index].p[axis]) : bone.p;
const oldContainer = meshNode.getParentNode();
if (!oldContainer) throw new Error('Source mesh has no rig container.');
primitive.setAttribute('JOINTS_0', null); primitive.setAttribute('WEIGHTS_0', null); meshNode.setSkin(null);
for (const child of oldContainer.listChildren()) if (child !== meshNode) oldContainer.removeChild(child);
sourceSkin.dispose();
mesh.setName('DewglassReliquaryMesh'); meshNode.setName('DewglassReliquaryMeshNode');
oldContainer.setName('DewglassReliquaryRig').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
const nodes = new Map();
for (const bone of bones) {
  const node = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]); nodes.set(bone.name, node);
  (bone.parent ? nodes.get(bone.parent) : oldContainer).addChild(node);
}
const skin = doc.createSkin('DewglassReliquary_Quadruped').setSkeleton(nodes.get('ReliquaryRoot'));
for (const bone of bones) skin.addJoint(nodes.get(bone.name));
const ibm = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i++) { const [x,y,z] = bones[i].p; ibm.set([1,0,0,0,0,1,0,0,0,0,1,0,-x,-y,-z,1], i * 16); }
skin.setInverseBindMatrices(doc.createAccessor('DewglassReliquary_InverseBinds').setArray(ibm).setType(Accessor.Type.MAT4).setBuffer(root.listBuffers()[0]));
meshNode.setSkin(skin);

const smooth = v => { const t = Math.max(0, Math.min(1, v)); return t*t*(3-2*t); };
const pointSegmentDistance = (p, a, b) => { const d = b.map((v,i)=>v-a[i]), w=p.map((v,i)=>v-a[i]); const n=d.reduce((s,v)=>s+v*v,0); const t=n ? Math.max(0,Math.min(1,w.reduce((s,v,i)=>s+v*d[i],0)/n)) : 0; return Math.hypot(...p.map((v,i)=>v-a[i]-d[i]*t)); };
const jointValues = new Uint16Array(vertexCount * 4), weightValues = new Float32Array(vertexCount * 4);
let multiInfluenceVertices = 0; const dominantCounts = Object.fromEntries(bones.map(b => [b.name, 0]));
for (let vertex = 0; vertex < vertexCount; vertex++) {
  const p = [pos[vertex*3],pos[vertex*3+1],pos[vertex*3+2]], [x,y,z] = p;
  const candidates = [];
  for (const bone of bones.slice(1)) {
    let score = 0;
    if (bone.kind === 'body' || bone.kind === 'husk') {
      const shell = smooth((y-.42)/.28), d = Math.hypot((x + .035)*.82, y-.58, z*.76);
      score = Math.exp(-.5*(d/(bone.kind === 'husk' ? .30 : .27))**2) * (bone.kind === 'husk' ? shell : 1-shell*.60);
    } else if (bone.kind === 'neck' || bone.kind === 'head') {
      const a = bone.kind === 'head' ? [.20,.38,0] : [.04,.42,0], b = bone.kind === 'head' ? [.37,.30,0] : [.30,.28,0];
      const d = pointSegmentDistance(p,a,b), front = smooth((x-.05)/.27), low = smooth((.65-y)/.27);
      score = Math.exp(-.5*(d/(bone.kind === 'head' ? .105 : .13))**2)*front*low;
    } else if (bone.kind === 'tail') {
      const d = pointSegmentDistance(p,[-.12,.42,0],[-.34,.38,0]);
      score = Math.exp(-.5*(d/.11)**2)*smooth((.02-x)/.18);
    } else {
      const { leg } = bone, side = Math.sign(leg.z), fore = leg.x > 0;
      const local = bone.kind === 'legUpper' ? [leg.x,.36,leg.z*.72] : [leg.x+(fore?.025:-.045),.19,leg.z*1.03];
      const end = bone.kind === 'legUpper' ? [leg.x+(fore?.025:-.045),.19,leg.z*1.03] : [leg.x+(fore?.07:-.10),.055,leg.z*1.20];
      const d = pointSegmentDistance(p,local,end), along = Math.exp(-.5*((x-leg.x)/.19)**2), lateral = smooth((side*z+.025)/.20), below = smooth((.55-y)/.30);
      score = Math.exp(-.5*(d/(bone.kind === 'legUpper' ? .105 : .095))**2)*along*lateral*below;
    }
    if (score > 1e-10) candidates.push({ index: bone.index, name: bone.name, score });
  }
  candidates.sort((a,b)=>b.score-a.score); const chosen = candidates.slice(0,4);
  if (!chosen.length) chosen.push({ index: 1, name: 'ReservoirBody', score: 1 });
  const sum = chosen.reduce((v,b)=>v+b.score,0); let assigned=0;
  chosen.forEach((item,slot)=>{ const value = slot === chosen.length-1 ? 1-assigned : item.score/sum; jointValues[vertex*4+slot]=item.index; weightValues[vertex*4+slot]=value; assigned+=value; });
  if (chosen.filter(item=>item.score/sum > 1e-5).length > 1) multiInfluenceVertices++;
  dominantCounts[chosen[0].name]++;
}
primitive.setAttribute('JOINTS_0',doc.createAccessor('DewglassReliquary_Joints').setArray(jointValues).setType(Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]));
primitive.setAttribute('WEIGHTS_0',doc.createAccessor('DewglassReliquary_Weights').setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]));

const quat = (x,y,z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x,y,z,'XYZ')).normalize().toArray();
const times5 = [0,.25,.5,.75,1], clips = [];
function clip(name, seconds, poseRows) {
  const animation=doc.createAnimation(name), times=times5.map(t=>t*seconds);
  for (const [boneName, rotations] of Object.entries(poseRows)) addChannel(doc,animation,nodes.get(boneName),'rotation',times,rotations.flat());
  clips.push({name,seconds,channels:animation.listChannels().length});
}
const asRot = rows => rows.map(v=>quat(...v));
const legsFor = (fn, key) => Object.fromEntries(legs.map((leg,i)=>[leg[key],asRot(times5.map((_,frame)=>fn(leg,i,frame)))]));
clip('Idle',3.2,{ ReservoirBody:asRot([[0,0,0],[.008,0,-.012],[0,0,0],[-.008,0,.012],[0,0,0]]),PearlHusk:asRot([[0,0,0],[0,.008,0],[0,0,0],[0,-.008,0],[0,0,0]]),Neck:asRot([[0,0,0],[0,.012,-.018],[0,0,0],[0,-.012,.018],[0,0,0]]),Head:asRot([[0,0,0],[.015,0,-.015],[0,0,0],[-.015,0,.015],[0,0,0]]),...legsFor((leg,i,f)=>[0,0,Math.sin(f*Math.PI/2+i*Math.PI)*.012],'hipName') });
const gait=(rate, amplitude) => ({ ...legsFor((leg,i,f)=>{const phase=f*Math.PI*2+(leg.name.startsWith('Fore')?0:Math.PI)+(leg.z>0?Math.PI:0);return [amplitude*Math.sin(phase),0,.11*Math.cos(phase)];},'hipName'),...legsFor((leg,i,f)=>{const phase=f*Math.PI*2+(leg.name.startsWith('Fore')?0:Math.PI)+(leg.z>0?Math.PI:0);return [-.18+Math.max(0,Math.sin(phase))*amplitude*.48,0,0];},'shinName'), ReservoirBody:asRot([[0,0,.015],[0,0,-.015],[0,0,.015],[0,0,-.015],[0,0,.015]]), Neck:asRot([[0,0,0],[.018,0,0],[0,0,0],[-.018,0,0],[0,0,0]]) });
clip('Walk',1.12,gait(1,.16)); clip('Run',.72,gait(1.55,.27));
clip('Attack',.86,{ ReservoirBody:asRot([[0,0,0],[0,0,-.04],[0,0,.11],[0,0,-.025],[0,0,0]]),Neck:asRot([[0,0,0],[.07,0,-.05],[.18,0,-.12],[.07,0,-.04],[0,0,0]]),Head:asRot([[0,0,0],[.12,0,-.04],[.25,0,-.08],[.10,0,-.03],[0,0,0]]),...legsFor((leg,i,f)=>[0,0,leg.name.startsWith('Fore')?[0,.06,.13,.04,0][f]:[0,-.03,-.06,-.02,0][f]],'hipName'),...legsFor((leg,i,f)=>[.0,0,leg.name.startsWith('Fore')?[0,-.16,-.24,-.06,0][f]:0],'shinName') });
clip('Hit',.44,{ ReservoirBody:asRot([[0,0,0],[.08,0,.09],[-.03,0,-.04],[0,0,.02],[0,0,0]]),PearlHusk:asRot([[0,0,0],[.04,0,.03],[0,0,0],[0,0,0],[0,0,0]]),Neck:asRot([[0,0,0],[.08,0,.12],[.02,0,-.05],[0,0,.02],[0,0,0]]),...legsFor((leg,i,f)=>[0,0,[0,leg.z>0?-.13:.13,leg.z>0?.08:-.08,0,0][f]],'hipName') });
clip('Death',1.62,{ ReliquaryRoot:asRot([[0,0,0],[.08,0,-.10],[.31,0,-.28],[.48,0,-.36],[.48,0,-.36]]),ReservoirBody:asRot([[0,0,0],[.04,0,.06],[.11,0,.13],[.12,0,.16],[.12,0,.16]]),PearlHusk:asRot([[0,0,0],[.04,0,-.05],[.10,0,-.12],[.12,0,-.14],[.12,0,-.14]]),Neck:asRot([[0,0,0],[.10,0,-.08],[.22,0,-.14],[.25,0,-.16],[.25,0,-.16]]),Head:asRot([[0,0,0],[.10,0,-.08],[.24,0,-.18],[.28,0,-.20],[.28,0,-.20]]),...legsFor((leg,i,f)=>[leg.z>0?.06:-.06,0,[0,.08,.24,.3,.3][f]*(leg.z>0?1:-1)],'hipName'),...legsFor((leg,i,f)=>[.14,0,[0,-.08,-.20,-.24,-.24][f]],'shinName') });

// Base color uses Lanczos. Packed linear metallic-roughness uses box averaging.
// Normal maps average as vectors and are renormalized after reduction.
async function reduceLinearMap(encoded, renormalize) {
  const {data,info}=await sharp(encoded).removeAlpha().raw().toBuffer({resolveWithObject:true});
  if(info.width!==4096||info.height!==4096||info.channels!==3)throw new Error(`Expected 4096 RGB linear map, got ${info.width}x${info.height}x${info.channels}`);
  const out=Buffer.alloc(2048*2048*3);
  for(let y=0;y<2048;y++)for(let x=0;x<2048;x++){const o=(y*2048+x)*3,a=(y*2*4096+x*2)*3,b=a+3,c=a+4096*3,d=c+3;for(let ch=0;ch<3;ch++)out[o+ch]=Math.round((data[a+ch]+data[b+ch]+data[c+ch]+data[d+ch])/4);}
  if(renormalize)for(let i=0;i<out.length;i+=3){let x=out[i]/127.5-1,y=out[i+1]/127.5-1,z=out[i+2]/127.5-1;const n=Math.hypot(x,y,z)||1;out[i]=Math.round((x/n+1)*127.5);out[i+1]=Math.round((y/n+1)*127.5);out[i+2]=Math.round((z/n+1)*127.5);}
  return out;
}
const runtimeMaps=[];
for(const [role,texture] of [['baseColor',baseMap],['metallicRoughness',mrMap],['normal',normalMap]]){
  const encoded=texture.getImage();
  if(role==='baseColor')texture.setImage(await sharp(encoded).resize(2048,2048,{kernel:'lanczos3'}).jpeg({quality:92,mozjpeg:true}).toBuffer()).setMimeType('image/jpeg');
  else {const pixels=await reduceLinearMap(encoded,role==='normal');const next=await sharp(pixels,{raw:{width:2048,height:2048,channels:3}})[role==='normal'?'jpeg':'png'](role==='normal'?{quality:96,chromaSubsampling:'4:4:4'}:{}).toBuffer();texture.setImage(next).setMimeType(role==='normal'?'image/jpeg':'image/png');}
  texture.setName(`dewglass_reliquary_${role}_2k.${role==='metallicRoughness'?'png':'jpg'}`);
  const meta=await sharp(texture.getImage()).metadata(); if(meta.width!==2048||meta.height!==2048)throw new Error(`Runtime map ${role} not 2K.`);
  runtimeMaps.push({role,name:texture.getName(),dimensions:[meta.width,meta.height],mime:texture.getMimeType(),sha256:hash(texture.getImage()),reduction:role==='baseColor'?'Lanczos color':role==='normal'?'2x2 linear box average plus vector renormalization':'2x2 linear box average'});
}
material.setMetallicFactor(1).setRoughnessFactor(1);

const bindBounds=deformedBounds(doc);
const outFile=`${owner}/dewglass-reliquary-native-rig-candidate.glb`;
const output=await io.writeBinary(doc); await writeFile(outFile,output);
const reopened=await io.read(outFile), rr=reopened.getRoot(), rp=rr.listMeshes()[0].listPrimitives()[0], rpos=rp.getAttribute('POSITION').getArray(), ridx=rp.getIndices().getArray(), ruv=rp.getAttribute('TEXCOORD_0').getArray();
if(rpos.length!==sourcePos.length||ridx.length!==sourceIndex.length||ruv.length!==sourceUv.length||rr.listSkins()[0].listJoints().length!==14)throw new Error('Candidate topology, UVs or joint count changed.');
let positionDelta=0,uvDelta=0,indexMismatches=0,weightSumError=0,multi=0;
const rj=rp.getAttribute('JOINTS_0').getArray(), rw=rp.getAttribute('WEIGHTS_0').getArray();
for(let i=0;i<rpos.length;i++)positionDelta=Math.max(positionDelta,Math.abs(rpos[i]-sourcePos[i]));
for(let i=0;i<ruv.length;i++)uvDelta=Math.max(uvDelta,Math.abs(ruv[i]-sourceUv[i]));
for(let i=0;i<ridx.length;i++)if(ridx[i]!==sourceIndex[i])indexMismatches++;
for(let v=0;v<vertexCount;v++){let sum=0,n=0;for(let j=0;j<4;j++){const i=v*4+j,w=rw[i];if(!Number.isFinite(w)||w<0||rj[i]>=14)throw new Error(`Invalid weight at vertex ${v}.`);if(w>1e-6){sum+=w;n++;}}if(Math.abs(sum-1)>1e-5)throw new Error(`Weight sum ${sum} at vertex ${v}.`);if(n>1)multi++;weightSumError=Math.max(weightSumError,Math.abs(sum-1));}
if(positionDelta>1e-7||uvDelta>1e-7||indexMismatches||multiInfluenceVertices<vertexCount*.3)throw new Error(`Geometry/UV change or poor blend distribution: position ${positionDelta}, UV ${uvDelta}, indices ${indexMismatches}, multi ${multiInfluenceVertices}/${vertexCount}.`);
const animations=rr.listAnimations();
if(['Idle','Walk','Run','Attack','Hit','Death'].some(name=>!animations.some(clip=>clip.getName()===name&&duration(clip)>0)))throw new Error('Required animation clips absent.');
const restBounds=deformedBounds(reopened);
const motionBounds=[];
// Sample actual clips with the shared pose utility and CPU deformation path.
const {applyClip,storedPose,restorePose}=await import('../../../../../../tools/creature-motion/pose.js');
const originalPose=storedPose(reopened);
const inverseMatrices=rr.listSkins()[0].getInverseBindMatrices().getArray(), targetJoints=rr.listSkins()[0].listJoints(), meshNodeCheck=rr.listNodes().find(node=>node.getMesh()===rr.listMeshes()[0]);
const sampleDeformation=()=>{const meshInverse=new THREE.Matrix4().fromArray(meshNodeCheck.getWorldMatrix()).invert(),matrices=targetJoints.map((joint,j)=>meshInverse.clone().multiply(new THREE.Matrix4().fromArray(joint.getWorldMatrix())).multiply(new THREE.Matrix4().fromArray(Array.from(inverseMatrices.slice(j*16,j*16+16)))));let maximum=0,moved=0;for(let v=0;v<vertexCount;v++){const p=new THREE.Vector3(sourcePos[v*3],sourcePos[v*3+1],sourcePos[v*3+2]),out=new THREE.Vector3();for(let slot=0;slot<4;slot++){const k=v*4+slot,w=rw[k];if(w>0)out.add(p.clone().applyMatrix4(matrices[rj[k]]).multiplyScalar(w));}const delta=out.distanceTo(p);maximum=Math.max(maximum,delta);if(delta>1e-4)moved++;}return {maximumVertexDisplacement:maximum,movedVertices:moved};};
for(const animation of animations){const d=duration(animation),frames=Array.from({length:9},(_,i)=>d*i/8),samples=[],deformations=[];for(const t of frames){restorePose(originalPose);applyClip(animation,t);samples.push(deformedBounds(reopened));deformations.push(sampleDeformation());}motionBounds.push({name:animation.getName(),seconds:d,sampleCount:frames.length,sweptMin:[0,1,2].map(axis=>Math.min(...samples.map(s=>s.min[axis]))),sweptMax:[0,1,2].map(axis=>Math.max(...samples.map(s=>s.max[axis]))),maximumVertexDisplacement:Math.max(...deformations.map(s=>s.maximumVertexDisplacement)),maximumMovedVertices:Math.max(...deformations.map(s=>s.movedVertices))});}
restorePose(originalPose);
const catalog={schema:'corealm-creature-native-rig-candidate/1',id:'creature_dewglass_reliquary',status:'awaiting-root-lab-review',accepted:false,worldIntegrated:false,runtimeAnimationHeld:true,
  source:{file:'../../../../exports/corealm_dewglass_reliquary_d95af2cf_8k_rigged.glb',sha256:sourceSha256,bytes:source.length,vertices:vertexCount,triangles:triangleCount,sourceImageId,sourceImageSha256:approvedImageSha256,sourceModelId:modelId,stage:'exported_rigged_glb',starred:true,imageReview:binding.review,sourceRig:{joints:sourceJointCount,clips:0,rootWeightFraction,weightedJointIds:[...weightedJointIds],replaced:true},sourceMaps},
  candidate:{file:outFile.split('/').at(-1),sha256:hash(output),bytes:output.length,vertices:vertexCount,triangles:triangleCount,joints:bones.map((bone,index)=>({name:bone.name,index,parent:bone.parent,restPosition:bone.p})),maps:runtimeMaps,clips:clips.map(item=>({...item,source:'Corealm quadruped action authoring; shared glTF animation channel and CPU deformation utilities'}))},
  rig:{preset:'custom four-legged living seed-husk reservoir',jointCount:bones.length,basis:'Y-up, +X forward, Z across near/far limb pairs',weightMethod:'Four normalized influences scored against torso, husk, head/neck, tail and four separate anatomical limb capsules with longitudinal/lateral gates',geometryPreserved:true,uvPreserved:true,topologyChanged:false,dominantVertices:dominantCounts,multiInfluenceVertices},
  validation:{positionMaxDelta:positionDelta,uvMaxDelta:uvDelta,indexMismatches,maxWeightSumError:weightSumError,restBounds,bindBounds,motionBounds,runtimeTextureMaxDimension:2048}};
await writeFile(`${owner}/catalog.json`,JSON.stringify(catalog,null,2)+'\n');
await writeFile(`${owner}/source.sha256`,`${sourceSha256}  corealm_dewglass_reliquary_d95af2cf_8k_rigged.glb\n`);
await mkdir(`${owner}/sources`,{recursive:true}); await writeFile(`${owner}/sources/corealm_dewglass_reliquary_d95af2cf_8k_rigged.glb`,source);
console.log(JSON.stringify({candidate:outFile,sha256:hash(output),bytes:output.length,vertices:vertexCount,triangles:triangleCount,joints:bones.length,clips:clips.map(c=>c.name),multiInfluenceVertices,validation:catalog.validation},null,2));
