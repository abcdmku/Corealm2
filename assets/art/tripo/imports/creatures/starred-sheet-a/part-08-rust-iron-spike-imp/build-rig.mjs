import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { Bone, Group, Matrix4, Quaternion, Vector3 } from 'three';

// Rebuildable source-matched imp skin. Mesh attributes remain byte-identical;
// the rig is authored in the source mesh's local bind space.
const folder = new URL('.', import.meta.url);
const sourcePath = new URL('base.glb', folder);
const outputPath = new URL('rigged-candidate.glb', folder);
const slug = 'part-08-rust-iron-spike-imp';
const targetHeightMeters = { 'part-08-rust-iron-spike-imp': 1.4, 'part-08-rust-iron-spike-imp': 1.8, 'part-09-yellow-green-spore-imp': 1.25 }[slug];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const hash = value => createHash('sha256').update(Buffer.from(value.buffer, value.byteOffset, value.byteLength)).digest('hex');
const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
const doc = await io.readBinary(sourceBytes), root = doc.getRoot(), scene = root.listScenes()[0];
const mesh = root.listMeshes()[0], primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find(node => node.getMesh() === mesh);
if (!scene || !primitive || !meshNode || root.listSkins().length || root.listAnimations().length) throw new Error('Expected the extracted, static, unskinned imp GLB.');
const originalWorldMatrix = new Matrix4().fromArray(meshNode.getWorldMatrix());
const positions = Float32Array.from(primitive.getAttribute('POSITION').getArray());
const normals = Float32Array.from(primitive.getAttribute('NORMAL').getArray());
const uvs = Float32Array.from(primitive.getAttribute('TEXCOORD_0').getArray());
const indices = primitive.getIndices().getArray().slice();
const sourceHashes = { positions: hash(positions), normals: hash(normals), uvs: hash(uvs), indices: hash(indices) };
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]); bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
}
const size = bounds.max.map((v, i) => v - bounds.min[i]), centerX = (bounds.min[0] + bounds.max[0]) / 2, centerZ = (bounds.min[2] + bounds.max[2]) / 2;
const at = (x, y, z = centerZ) => [centerX + x * size[0], bounds.min[1] + y * size[1], z];
const bones = [
  ['mixamorigHips', null, at(0,.45), .16,'torso'], ['mixamorigSpine','mixamorigHips',at(0,.56),.16,'torso'],
  ['mixamorigSpine1','mixamorigSpine',at(0,.67),.16,'torso'], ['mixamorigSpine2','mixamorigSpine1',at(0,.77),.15,'torso'],
  ['mixamorigNeck','mixamorigSpine2',at(0,.84),.12,'torso'], ['mixamorigHead','mixamorigNeck',at(0,.93),.19,'head'],
  ['mixamorigLeftShoulder','mixamorigSpine2',at(-.25,.77),.10,'leftArm'], ['mixamorigLeftArm','mixamorigLeftShoulder',at(-.46,.73),.12,'leftArm'],
  ['mixamorigLeftForeArm','mixamorigLeftArm',at(-.76,.63),.12,'leftArm'], ['mixamorigLeftHand','mixamorigLeftForeArm',at(-.96,.55),.13,'leftArm'],
  ['mixamorigRightShoulder','mixamorigSpine2',at(.25,.77),.10,'rightArm'], ['mixamorigRightArm','mixamorigRightShoulder',at(.46,.73),.12,'rightArm'],
  ['mixamorigRightForeArm','mixamorigRightArm',at(.76,.63),.12,'rightArm'], ['mixamorigRightHand','mixamorigRightForeArm',at(.96,.55),.13,'rightArm'],
  ['mixamorigLeftUpLeg','mixamorigHips',at(-.22,.39),.13,'leftLeg'], ['mixamorigLeftLeg','mixamorigLeftUpLeg',at(-.22,.20),.12,'leftLeg'],
  ['mixamorigLeftFoot','mixamorigLeftLeg',at(-.22,.07),.11,'leftLeg'], ['mixamorigLeftToeBase','mixamorigLeftFoot',at(-.22,.025,centerZ+size[2]*.30),.10,'leftLeg'],
  ['mixamorigRightUpLeg','mixamorigHips',at(.22,.39),.13,'rightLeg'], ['mixamorigRightLeg','mixamorigRightUpLeg',at(.22,.20),.12,'rightLeg'],
  ['mixamorigRightFoot','mixamorigRightLeg',at(.22,.07),.11,'rightLeg'], ['mixamorigRightToeBase','mixamorigRightFoot',at(.22,.025,centerZ+size[2]*.30),.10,'rightLeg'],
].map(([name,parent,p,sigma,group])=>({name,parent,p,sigma,group}));
const byName = new Map(bones.map((b,i)=>[b.name,{...b,index:i}]));
for(const bone of bones) bone.local = bone.parent ? bone.p.map((v,i)=>v-byName.get(bone.parent).p[i]) : bone.p;
// Move the mesh under a neutral presentation node while preserving all vertex streams.
const sourceTransform = { translation: meshNode.getTranslation(), rotation: meshNode.getRotation(), scale: meshNode.getScale() };
const anchor = [centerX, bounds.min[1], centerZ];
const presentationTranslation = sourceTransform.translation.map((value,axis)=>value+sourceTransform.scale[axis]*(1-targetHeightMeters)*anchor[axis]);
const parent = meshNode.getParentNode(); if(parent) parent.removeChild(meshNode); else scene.removeChild(meshNode);
meshNode.setTranslation([0,0,0]).setRotation([0,0,0,1]).setScale([1,1,1]);
const presentation = doc.createNode('ImpPresentation').setTranslation(presentationTranslation).setRotation(sourceTransform.rotation).setScale(sourceTransform.scale.map(value=>value*targetHeightMeters));
const armature = doc.createNode('ImpArmature'); scene.addChild(presentation); presentation.addChild(armature); armature.addChild(meshNode);
const joints = new Map();
for(const bone of bones){const node=doc.createNode(bone.name).setTranslation(bone.local); joints.set(bone.name,node); (bone.parent?joints.get(bone.parent):armature).addChild(node);}
const skin=doc.createSkin('Imp_MixamoHumanoid').setSkeleton(joints.get('mixamorigHips')); for(const b of bones) skin.addJoint(joints.get(b.name));
const ibm=new Float32Array(bones.length*16);
for(let i=0;i<bones.length;i++){const [x,y,z]=bones[i].p;ibm.set([1,0,0,0,0,1,0,0,0,0,1,0,-x,-y,-z,1],i*16);}
const buffer=root.listBuffers()[0]; skin.setInverseBindMatrices(doc.createAccessor('Imp_InverseBindMatrices').setArray(ibm).setType(Accessor.Type.MAT4).setBuffer(buffer)); meshNode.setSkin(skin);
function segDistance(p,a,b){const v=b.map((n,i)=>n-a[i]), den=v.reduce((s,n)=>s+n*n,0)||1,t=Math.max(0,Math.min(1,p.reduce((s,n,i)=>s+(n-a[i])*v[i],0)/den));return Math.hypot(...p.map((n,i)=>n-a[i]-t*v[i]));}
const ji=new Uint16Array(positions.length/3*4), ww=new Float32Array(ji.length); let distributed=0,maxWeightError=0;
for(let v=0;v<positions.length/3;v++){const p=[positions[v*3],positions[v*3+1],positions[v*3+2]], candidates=[];
 for(let i=0;i<bones.length;i++){const b=bones[i], parentBone=b.parent?byName.get(b.parent):null, a=parentBone?.p??b.p;
  let gate=1; if(b.group==='head')gate=p[1]>bounds.min[1]+size[1]*.69?5:.01;
  if(b.group.endsWith('Arm')){const side=b.group==='leftArm'?-1:1;gate=p[1]>bounds.min[1]+size[1]*.27&&p[1]<bounds.min[1]+size[1]*.93?1:.005;gate*=.02+.98/(1+Math.exp(-(side*(p[0]-centerX)-size[0]*.08)/(size[0]*.045)));}
  if(b.group.endsWith('Leg')){const side=b.group==='leftLeg'?-1:1;gate=p[1]<bounds.min[1]+size[1]*.61?1:.004;gate*=.02+.98/(1+Math.exp(-(side*(p[0]-centerX)-size[0]*.035)/(size[0]*.035)));}
  const distance=segDistance(p,a,b.p), score=gate*Math.exp(-.5*(distance/b.sigma)**2);if(score>1e-12)candidates.push({i,score});}
 candidates.sort((a,b)=>b.score-a.score);const chosen=candidates.slice(0,4);if(!chosen.length)throw new Error(`No weights for vertex ${v}`);const sum=chosen.reduce((s,c)=>s+c.score,0);let assigned=0,nz=0;
 for(let k=0;k<4;k++){const c=chosen[k]??chosen[0],w=k>=chosen.length?0:k===chosen.length-1?1-assigned:c.score/sum;ji[v*4+k]=c.i;ww[v*4+k]=w;assigned+=w;if(w>1e-6)nz++;}if(nz>1)distributed++;maxWeightError=Math.max(maxWeightError,Math.abs(assigned-1));}
primitive.setAttribute('JOINTS_0',doc.createAccessor('Imp_Joints0').setArray(ji).setType(Accessor.Type.VEC4).setBuffer(buffer));primitive.setAttribute('WEIGHTS_0',doc.createAccessor('Imp_Weights0').setArray(ww).setType(Accessor.Type.VEC4).setBuffer(buffer));
const quat=(axis,a)=>{const s=Math.sin(a/2),c=Math.cos(a/2);return axis==='x'?[s,0,0,c]:axis==='y'?[0,s,0,c]:[0,0,s,c];};const clips=[];
function addClip(name,duration,tracks){const animation=doc.createAnimation(name);for(const t of tracks){const input=doc.createAccessor(`${name}_${t.node}_time`).setArray(Float32Array.from(t.times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);const output=doc.createAccessor(`${name}_${t.node}_${t.path??'rotation'}_value`).setArray(Float32Array.from(t.values.flat())).setType(t.path==='translation'?Accessor.Type.VEC3:Accessor.Type.VEC4).setBuffer(buffer);const sampler=doc.createAnimationSampler(`${name}_${t.node}`).setInput(input).setOutput(output).setInterpolation('LINEAR');animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${name}_${t.node}`).setTargetNode(joints.get(t.node)).setTargetPath(t.path??'rotation').setSampler(sampler));}clips.push({name,duration,channels:tracks.length,tracks});}
const q=(axis,...angles)=>angles.map(a=>quat(axis,a));
const cyc=[0,.25,.5,.75,1];const cycle=(dur)=>cyc.map(t=>t*dur);
addClip('Idle',2.4,[{node:'mixamorigSpine1',times:cycle(2.4),values:q('z',0,.018,0,-.018,0)},{node:'mixamorigHead',times:cycle(2.4),values:q('x',0,.012,0,-.012,0)},{node:'mixamorigLeftArm',times:cycle(2.4),values:q('z',-.025,-.04,-.025,-.01,-.025)},{node:'mixamorigRightArm',times:cycle(2.4),values:q('z',.025,.04,.025,.01,.025)}]);
addClip('Walk',1.1,[{node:'mixamorigHips',path:'translation',times:cycle(1.1),values:cyc.map(()=>[bones[0].p[0],bones[0].p[1]+.0015,bones[0].p[2]])},{node:'mixamorigLeftArm',times:cycle(1.1),values:q('z',-.22,0,.22,0,-.22)},{node:'mixamorigRightArm',times:cycle(1.1),values:q('z',.22,0,-.22,0,.22)},{node:'mixamorigLeftUpLeg',times:cycle(1.1),values:q('z',-.12,0,.12,0,-.12)},{node:'mixamorigRightUpLeg',times:cycle(1.1),values:q('z',.12,0,-.12,0,.12)},{node:'mixamorigSpine1',times:cycle(1.1),values:q('x',.025,0,-.025,0,.025)}]);
addClip('Run',.72,[{node:'mixamorigHips',path:'translation',times:cycle(.72),values:cyc.map(()=>[bones[0].p[0],bones[0].p[1]+.0015,bones[0].p[2]])},{node:'mixamorigLeftArm',times:cycle(.72),values:q('z',-.43,0,.43,0,-.43)},{node:'mixamorigRightArm',times:cycle(.72),values:q('z',.43,0,-.43,0,.43)},{node:'mixamorigLeftUpLeg',times:cycle(.72),values:q('z',-.20,0,.20,0,-.20)},{node:'mixamorigRightUpLeg',times:cycle(.72),values:q('z',.20,0,-.20,0,.20)},{node:'mixamorigSpine1',times:cycle(.72),values:q('x',.09,.04,0,.04,.09)}]);
const one=[0,.18,.38,.62,1];addClip('Attack',.85,[{node:'mixamorigSpine1',times:one.map(t=>t*.85),values:q('x',0,.08,-.20,-.12,0)},{node:'mixamorigLeftArm',times:one.map(t=>t*.85),values:q('z',-.08,-.48,-.62,.34,-.08)},{node:'mixamorigRightArm',times:one.map(t=>t*.85),values:q('z',.08,.28,.42,-.50,.08)},{node:'mixamorigLeftForeArm',times:one.map(t=>t*.85),values:q('z',0,-.14,-.28,.24,0)},{node:'mixamorigHead',times:one.map(t=>t*.85),values:q('x',0,-.05,.12,.04,0)}]);
const short=[0,.1,.24,.38,.5];addClip('Hit',.5,[{node:'mixamorigSpine1',times:short,values:q('x',0,.20,.08,-.03,0)},{node:'mixamorigHead',times:short,values:q('x',0,-.17,-.06,.02,0)},{node:'mixamorigLeftArm',times:short,values:q('z',0,-.32,-.18,-.03,0)},{node:'mixamorigRightArm',times:short,values:q('z',0,.32,.18,.03,0)}]);
const death=[0,.35,.8,1.35,1.9];addClip('Death',1.9,[{node:'mixamorigHips',path:'translation',times:death,values:[bones[0].p,at(0,.50),at(0,.46),at(0,.55),at(0,.55)]},{node:'mixamorigSpine1',times:death,values:q('z',0,-.08,-.20,-.42,-.42)},{node:'mixamorigHead',times:death,values:q('x',0,.08,.18,.30,.30)},{node:'mixamorigLeftArm',times:death,values:q('z',0,-.20,-.50,-.65,-.65)},{node:'mixamorigRightArm',times:death,values:q('z',0,.20,.50,.65,.65)},{node:'mixamorigLeftUpLeg',times:death,values:q('z',0,-.10,-.22,-.32,-.32)},{node:'mixamorigRightUpLeg',times:death,values:q('z',0,.10,.22,.32,.32)}]);
const sourceTextures=[];for(const texture of root.listTextures()){const image=texture.getImage(),m=await sharp(image).metadata();sourceTextures.push({name:texture.getName(),width:m.width,height:m.height,sha256:createHash('sha256').update(image).digest('hex')});if(m.width>2048||m.height>2048)texture.setImage(await sharp(image).resize(2048,2048,{fit:'inside',withoutEnlargement:true}).toFormat(m.format==='jpeg'?'jpeg':'png',m.format==='jpeg'?{quality:92,chromaSubsampling:'4:4:4'}:{}).toBuffer());}
const bytes=await io.writeBinary(doc);await writeFile(outputPath,bytes);const check=(await io.readBinary(bytes)).getRoot(),cp=check.listMeshes()[0].listPrimitives()[0],cs=check.listSkins()[0];const outputHashes={positions:hash(cp.getAttribute('POSITION').getArray()),normals:hash(cp.getAttribute('NORMAL').getArray()),uvs:hash(cp.getAttribute('TEXCOORD_0').getArray()),indices:hash(cp.getIndices().getArray())};
const checkedMeshNode=check.listNodes().find(node=>node.getMesh()===check.listMeshes()[0]);
const checkedWorldMatrix=new Matrix4().fromArray(checkedMeshNode.getWorldMatrix());
const boundsOf=(matrix,stream)=>{const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<stream.length;i+=3){const p=new Vector3(stream[i],stream[i+1],stream[i+2]).applyMatrix4(matrix);for(let a=0;a<3;a++){min[a]=Math.min(min[a],p.getComponent(a));max[a]=Math.max(max[a],p.getComponent(a));}}return{min,max};};
const sourceWorldBounds=boundsOf(originalWorldMatrix,positions),candidateWorldBounds=boundsOf(checkedWorldMatrix,cp.getAttribute('POSITION').getArray());
const worldMatrixDelta=Math.max(...originalWorldMatrix.elements.map((v,i)=>Math.abs(v-checkedWorldMatrix.elements[i])));
const candidateHeight=candidateWorldBounds.max[1]-candidateWorldBounds.min[1];
if(Math.abs(candidateHeight-targetHeightMeters)>.01||Math.abs((candidateWorldBounds.min[0]+candidateWorldBounds.max[0])/2)>.01||Math.abs((candidateWorldBounds.min[2]+candidateWorldBounds.max[2])/2)>.01||Math.abs(candidateWorldBounds.min[1])>.01)throw new Error(`Presentation root did not preserve centered grounded target bounds: ${JSON.stringify({sourceWorldBounds,candidateWorldBounds,targetHeightMeters,candidateHeight})}`);
if(JSON.stringify(sourceHashes)!==JSON.stringify(outputHashes)||distributed<positions.length/3*.60||maxWeightError>1e-5)throw new Error(`Geometry or weight verification failed: hashes=${JSON.stringify({sourceHashes,outputHashes})}, distributed=${distributed}/${positions.length/3}, weightError=${maxWeightError}`);
const animations=check.listAnimations().map(a=>({name:a.getName(),channels:a.listChannels().length,duration:Math.max(...a.listSamplers().flatMap(s=>Array.from(s.getInput().getArray())))}));
if(animations.map(a=>a.name).join(',')!=='Idle,Walk,Run,Attack,Hit,Death')throw new Error('Required clip sequence is missing.');
for(const a of check.listAnimations())for(const ch of a.listChannels())if(!cs.listJoints().includes(ch.getTargetNode()))throw new Error('Clip targets an unskinned node.');
// Sample each authored track through the actual four-weight skinning matrices.
const poseRoot=new Group(),poseArmature=new Group();poseRoot.add(poseArmature);
const poseBones=new Map();for(const spec of bones){const b=new Bone();b.name=spec.name;b.position.fromArray(spec.local);poseBones.set(spec.name,b);(spec.parent?poseBones.get(spec.parent):poseArmature).add(b);}
const bindInverse=bones.map(spec=>new Matrix4().makeTranslation(-spec.p[0],-spec.p[1],-spec.p[2]));
const presentationMatrix=checkedWorldMatrix;
function sampleTrack(track,time){let right=track.times.findIndex(t=>t>=time);if(right<0)right=track.times.length-1;const left=Math.max(0,right-1),a=track.times[left],b=track.times[right],u=b===a?0:(time-a)/(b-a),v0=track.values[left],v1=track.values[right];if(track.path==='translation')return v0.map((v,i)=>v+(v1[i]-v)*u);const qa=new Quaternion(v0[0],v0[1],v0[2],v0[3]),qb=new Quaternion(v1[0],v1[1],v1[2],v1[3]);return qa.slerp(qb,u).toArray();}
const animatedClipBounds=[];
for(const clip of clips){const times=new Set([0,clip.duration]);for(const track of clip.tracks)for(const key of track.times){times.add(key);if(key>0)times.add(key-1e-4);if(key<clip.duration)times.add(key+1e-4);}for(let i=1;i<24;i++)times.add(clip.duration*i/24);const frames=[...times].sort((a,b)=>a-b),union={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
 for(const time of frames){for(const spec of bones){const b=poseBones.get(spec.name);b.position.fromArray(spec.local);b.quaternion.identity();}for(const track of clip.tracks){const b=poseBones.get(track.node),value=sampleTrack(track,time);if(track.path==='translation')b.position.fromArray(value);else b.quaternion.fromArray(value);}poseRoot.updateMatrixWorld(true);for(let bi=0;bi<bones.length;bi++)bones[bi].matrixWorld=poseBones.get(bones[bi].name).matrixWorld;
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let vertex=0;vertex<positions.length/3;vertex++){const local=new Vector3(positions[vertex*3],positions[vertex*3+1],positions[vertex*3+2]),deformed=new Vector3();for(let k=0;k<4;k++){const offset=vertex*4+k,w=ww[offset];if(!w)continue;const j=ji[offset],skinMatrix=poseBones.get(bones[j].name).matrixWorld.clone().multiply(bindInverse[j]);deformed.addScaledVector(local.clone().applyMatrix4(skinMatrix),w);}deformed.applyMatrix4(presentationMatrix);for(let axis=0;axis<3;axis++){min[axis]=Math.min(min[axis],deformed.getComponent(axis));max[axis]=Math.max(max[axis],deformed.getComponent(axis));}}
  for(let axis=0;axis<3;axis++){union.min[axis]=Math.min(union.min[axis],min[axis]);union.max[axis]=Math.max(union.max[axis],max[axis]);}}
 const height=union.max[1]-union.min[1],grounded=union.min[1]>=-.005&&union.min[1]<=.08;animatedClipBounds.push({name:clip.name,frames:frames.length,bounds:union,height,grounded});}
const sixClipGroundingVerified=animatedClipBounds.length===6&&animatedClipBounds.every(clip=>clip.grounded&&clip.bounds.min[1]>=-.005);
if(!sixClipGroundingVerified)throw new Error(`Animation root/feet exceed the -5mm ground penetration limit after presentation scaling: ${JSON.stringify(animatedClipBounds.map(({name,bounds})=>({name,minY:bounds.min[1],maxY:bounds.max[1]})))}`);
const runtimeTextures=[];for(const t of check.listTextures()){const m=await sharp(t.getImage()).metadata();if(m.width>2048||m.height>2048)throw new Error('Runtime map exceeds 2K.');runtimeTextures.push({name:t.getName(),width:m.width,height:m.height,sha256:createHash('sha256').update(t.getImage()).digest('hex')});}
const report={schema:'corealm-starred-sheet-rigging/1',part:slug,sourceSha256,candidateSha256:createHash('sha256').update(bytes).digest('hex'),sourceGeometryHashes:sourceHashes,outputGeometryHashes:outputHashes,scaleReview:{targetHeightMeters,groundedBindBounds:sourceWorldBounds,groundedOutputBounds:candidateWorldBounds,measuredHeightMeters:candidateHeight,grounded:true,sixClipGroundingVerified,animatedClips:animatedClipBounds,visualAcceptance:false},vertices:positions.length/3,triangles:indices.length/3,rig:{type:'Mixamo-named compact imp humanoid',joints:bones.length,influencesPerVertex:4,verticesWithDistributedWeights:distributed,maxWeightSumError:maxWeightError,bindSpace:'source local mesh coordinates',deformationReview:'pending root visual acceptance'},animations,textures:{source:sourceTextures,runtime:runtimeTextures},holds:['The source is a static creature sheet extraction without authored motion; clips are custom motion authored for the imp silhouette.','Weight deformation and visual clip quality need root browser review.'],retopology:false};
await writeFile(new URL('rigging-provenance.json',folder),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
