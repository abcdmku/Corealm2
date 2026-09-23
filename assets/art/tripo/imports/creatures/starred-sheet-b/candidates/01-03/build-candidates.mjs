import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../../../../');
const sourceDir = path.join(repo, 'assets/art/tripo/imports/creatures/starred-sheet-b/base');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sha = value => createHash('sha256').update(Buffer.from(value.buffer, value.byteOffset, value.byteLength)).digest('hex');
const clipNames = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
const models = [
  { part: 1, id: 'red-bone-mask-imp', label: 'Red Bone-Mask Imp', accent: 'bone mask and hooked claws' },
  { part: 2, id: 'lavender-bat-ear-imp', label: 'Lavender Bat-Ear Imp', accent: 'oversized bat ears and narrow shoulders' },
  { part: 3, id: 'green-antler-imp', label: 'Green Antler Imp', accent: 'branching antlers and leaf-like fins' },
];
const segments = (a, b) => { const v=b.map((n,i)=>n-a[i]), d=v.reduce((s,n)=>s+n*n,0)||1; return p=>{const t=Math.max(0,Math.min(1,p.reduce((s,n,i)=>s+(n-a[i])*v[i],0)/d));return Math.hypot(...p.map((n,i)=>n-a[i]-t*v[i]));}; };
function quaternion(axis, angle) { const s=Math.sin(angle/2), c=Math.cos(angle/2); return axis==='x'?[s,0,0,c]:axis==='y'?[0,s,0,c]:[0,0,s,c]; }

for (const model of models) {
  const folder = path.join(here, `part-${String(model.part).padStart(2,'0')}-${model.id}`);
  await mkdir(folder, { recursive: true });
  const sourcePath = path.join(sourceDir, `part-${String(model.part).padStart(2,'0')}.glb`);
  const sourceBytes = await readFile(sourcePath), sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
  const doc = await io.readBinary(sourceBytes), root = doc.getRoot(), scene = root.getDefaultScene() ?? root.listScenes()[0];
  const mesh = root.listMeshes()[0], primitive = mesh?.listPrimitives()[0], meshNode = root.listNodes().find(n=>n.getMesh()===mesh);
  if (!scene || !primitive || !meshNode || root.listSkins().length || root.listAnimations().length) throw new Error(`${model.id}: expected a static unskinned source GLB`);
  const positionAccessor=primitive.getAttribute('POSITION'), normalAccessor=primitive.getAttribute('NORMAL'), uvAccessor=primitive.getAttribute('TEXCOORD_0'), indexAccessor=primitive.getIndices();
  if (!positionAccessor || !normalAccessor || !uvAccessor || !indexAccessor) throw new Error(`${model.id}: required mesh attributes missing`);
  const positions=Float32Array.from(positionAccessor.getArray()), sourceHashes={positions:sha(positionAccessor.getArray()),normals:sha(normalAccessor.getArray()),uvs:sha(uvAccessor.getArray()),indices:sha(indexAccessor.getArray())};
  const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  for(let i=0;i<positions.length;i+=3)for(let a=0;a<3;a++){bounds.min[a]=Math.min(bounds.min[a],positions[i+a]);bounds.max[a]=Math.max(bounds.max[a],positions[i+a]);}
  const size=bounds.max.map((v,i)=>v-bounds.min[i]), cx=(bounds.min[0]+bounds.max[0])/2, cz=(bounds.min[2]+bounds.max[2])/2;
  const at=(x,y,z=cz)=>[cx+x*size[0],bounds.min[1]+y*size[1],z];
  const b=[
    ['mixamorigHips',null,at(0,.45),.15,'torso'],['mixamorigSpine','mixamorigHips',at(0,.56),.16,'torso'],['mixamorigSpine1','mixamorigSpine',at(0,.67),.16,'torso'],['mixamorigSpine2','mixamorigSpine1',at(0,.77),.15,'torso'],['mixamorigNeck','mixamorigSpine2',at(0,.84),.12,'torso'],['mixamorigHead','mixamorigNeck',at(0,.93),.20,'head'],
    ['mixamorigLeftShoulder','mixamorigSpine2',at(-.25,.77),.10,'leftArm'],['mixamorigLeftArm','mixamorigLeftShoulder',at(-.46,.73),.12,'leftArm'],['mixamorigLeftForeArm','mixamorigLeftArm',at(-.76,.63),.12,'leftArm'],['mixamorigLeftHand','mixamorigLeftForeArm',at(-.96,.55),.13,'leftArm'],['mixamorigRightShoulder','mixamorigSpine2',at(.25,.77),.10,'rightArm'],['mixamorigRightArm','mixamorigRightShoulder',at(.46,.73),.12,'rightArm'],['mixamorigRightForeArm','mixamorigRightArm',at(.76,.63),.12,'rightArm'],['mixamorigRightHand','mixamorigRightForeArm',at(.96,.55),.13,'rightArm'],
    ['mixamorigLeftUpLeg','mixamorigHips',at(-.22,.39),.13,'leftLeg'],['mixamorigLeftLeg','mixamorigLeftUpLeg',at(-.22,.20),.12,'leftLeg'],['mixamorigLeftFoot','mixamorigLeftLeg',at(-.22,.07),.11,'leftLeg'],['mixamorigLeftToeBase','mixamorigLeftFoot',at(-.22,.025,cz+size[2]*.30),.10,'leftLeg'],['mixamorigRightUpLeg','mixamorigHips',at(.22,.39),.13,'rightLeg'],['mixamorigRightLeg','mixamorigRightUpLeg',at(.22,.20),.12,'rightLeg'],['mixamorigRightFoot','mixamorigRightLeg',at(.22,.07),.11,'rightLeg'],['mixamorigRightToeBase','mixamorigRightFoot',at(.22,.025,cz+size[2]*.30),.10,'rightLeg'],
  ].map(([name,parent,p,sigma,group])=>({name,parent,p,sigma,group}));
  const byName=new Map(b.map((bone,index)=>[bone.name,{...bone,index}]));
  for(const bone of b)bone.local=bone.parent?bone.p.map((v,i)=>v-byName.get(bone.parent).p[i]):bone.p;
  const sourceTransform={translation:meshNode.getTranslation(),rotation:meshNode.getRotation(),scale:meshNode.getScale()}, parent=meshNode.getParentNode();
  if(parent)parent.removeChild(meshNode);else scene.removeChild(meshNode);
  meshNode.setTranslation([0,0,0]).setRotation([0,0,0,1]).setScale([1,1,1]);
  const presentation=doc.createNode(`${model.id}_Presentation`).setTranslation(sourceTransform.translation).setRotation(sourceTransform.rotation).setScale(sourceTransform.scale);
  const armature=doc.createNode(`${model.id}_Armature`);scene.addChild(presentation);presentation.addChild(armature);armature.addChild(meshNode);
  const joints=new Map();
  for(const bone of b){const node=doc.createNode(bone.name).setTranslation(bone.local);joints.set(bone.name,node);(bone.parent?joints.get(bone.parent):armature).addChild(node);}
  const skin=doc.createSkin(`${model.id}_HumanoidRig`).setSkeleton(joints.get('mixamorigHips'));for(const bone of b)skin.addJoint(joints.get(bone.name));
  const ibm=new Float32Array(b.length*16);for(let i=0;i<b.length;i++){const[x,y,z]=b[i].p;ibm.set([1,0,0,0,0,1,0,0,0,0,1,0,-x,-y,-z,1],i*16);}
  const buffer=root.listBuffers()[0];skin.setInverseBindMatrices(doc.createAccessor(`${model.id}_InverseBindMatrices`).setArray(ibm).setType(Accessor.Type.MAT4).setBuffer(buffer));meshNode.setSkin(skin);
  const jointsArray=new Uint16Array(positions.length/3*4), weightsArray=new Float32Array(jointsArray.length);let distributed=0,maxWeightError=0;
  for(let v=0;v<positions.length/3;v++){const p=[positions[v*3],positions[v*3+1],positions[v*3+2]],scores=[];for(let i=0;i<b.length;i++){const bone=b[i],pb=bone.parent?byName.get(bone.parent):null,a=pb?.p??bone.p;let gate=1;if(bone.group==='head')gate=p[1]>bounds.min[1]+size[1]*.69?5:.01;if(bone.group.endsWith('Arm')){const side=bone.group==='leftArm'?-1:1;gate=p[1]>bounds.min[1]+size[1]*.27&&p[1]<bounds.min[1]+size[1]*.93?1:.005;gate*=.02+.98/(1+Math.exp(-(side*(p[0]-cx)-size[0]*.08)/(size[0]*.045)));}if(bone.group.endsWith('Leg')){const side=bone.group==='leftLeg'?-1:1;gate=p[1]<bounds.min[1]+size[1]*.61?1:.004;gate*=.02+.98/(1+Math.exp(-(side*(p[0]-cx)-size[0]*.035)/(size[0]*.035)));}const distance=segments(a,bone.p)(p),score=gate*Math.exp(-.5*(distance/bone.sigma)**2);if(score>1e-12)scores.push({i,score});}scores.sort((a,b)=>b.score-a.score);const chosen=scores.slice(0,4);if(!chosen.length)throw new Error(`${model.id}: no joint influence for vertex ${v}`);const sum=chosen.reduce((s,c)=>s+c.score,0);let assigned=0,nz=0;for(let k=0;k<4;k++){const c=chosen[k]??chosen[0],w=k>=chosen.length?0:k===chosen.length-1?1-assigned:c.score/sum;jointsArray[v*4+k]=c.i;weightsArray[v*4+k]=w;assigned+=w;if(w>1e-6)nz++;}if(nz>1)distributed++;maxWeightError=Math.max(maxWeightError,Math.abs(assigned-1));}
  primitive.setAttribute('JOINTS_0',doc.createAccessor(`${model.id}_Joints`).setArray(jointsArray).setType(Accessor.Type.VEC4).setBuffer(buffer));primitive.setAttribute('WEIGHTS_0',doc.createAccessor(`${model.id}_Weights`).setArray(weightsArray).setType(Accessor.Type.VEC4).setBuffer(buffer));
  const animationReports=[];
  function addClip(name,duration,tracks){const animation=doc.createAnimation(name);for(const track of tracks){const input=doc.createAccessor(`${name}_${track.node}_time`).setArray(Float32Array.from(track.times)).setType(Accessor.Type.SCALAR).setBuffer(buffer),output=doc.createAccessor(`${name}_${track.node}_${track.path??'rotation'}_value`).setArray(Float32Array.from(track.values.flat())).setType(track.path==='translation'?Accessor.Type.VEC3:Accessor.Type.VEC4).setBuffer(buffer),sampler=doc.createAnimationSampler(`${name}_${track.node}`).setInput(input).setOutput(output).setInterpolation('LINEAR');animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${name}_${track.node}`).setTargetNode(joints.get(track.node)).setTargetPath(track.path??'rotation').setSampler(sampler));}animationReports.push({name,duration,channels:tracks.length});}
  const q=(axis,...angles)=>angles.map(a=>quaternion(axis,a)), cycle=(duration)=>[0,.25,.5,.75,1].map(t=>t*duration), one=[0,.18,.38,.62,1];
  addClip('Idle',2.4,[{node:'mixamorigSpine1',times:cycle(2.4),values:q('z',0,.018,0,-.018,0)},{node:'mixamorigHead',times:cycle(2.4),values:q('x',0,.012,0,-.012,0)},{node:'mixamorigLeftArm',times:cycle(2.4),values:q('z',-.025,-.04,-.025,-.01,-.025)},{node:'mixamorigRightArm',times:cycle(2.4),values:q('z',.025,.04,.025,.01,.025)}]);
  addClip('Walk',1.1,[{node:'mixamorigLeftArm',times:cycle(1.1),values:q('z',-.22,0,.22,0,-.22)},{node:'mixamorigRightArm',times:cycle(1.1),values:q('z',.22,0,-.22,0,.22)},{node:'mixamorigLeftUpLeg',times:cycle(1.1),values:q('z',-.20,0,.20,0,-.20)},{node:'mixamorigRightUpLeg',times:cycle(1.1),values:q('z',.20,0,-.20,0,.20)},{node:'mixamorigSpine1',times:cycle(1.1),values:q('x',.025,0,-.025,0,.025)}]);
  addClip('Run',.72,[{node:'mixamorigLeftArm',times:cycle(.72),values:q('z',-.43,0,.43,0,-.43)},{node:'mixamorigRightArm',times:cycle(.72),values:q('z',.43,0,-.43,0,.43)},{node:'mixamorigLeftUpLeg',times:cycle(.72),values:q('z',-.36,0,.36,0,-.36)},{node:'mixamorigRightUpLeg',times:cycle(.72),values:q('z',.36,0,-.36,0,.36)},{node:'mixamorigSpine1',times:cycle(.72),values:q('x',.09,.04,0,.04,.09)}]);
  addClip('Attack',.85,[{node:'mixamorigSpine1',times:one.map(t=>t*.85),values:q('x',0,.08,-.20,-.12,0)},{node:'mixamorigLeftArm',times:one.map(t=>t*.85),values:q('z',-.08,-.48,-.62,.34,-.08)},{node:'mixamorigRightArm',times:one.map(t=>t*.85),values:q('z',.08,.28,.42,-.50,.08)},{node:'mixamorigLeftForeArm',times:one.map(t=>t*.85),values:q('z',0,-.14,-.28,.24,0)},{node:'mixamorigHead',times:one.map(t=>t*.85),values:q('x',0,-.05,.12,.04,0)}]);
  addClip('Hit',.5,[{node:'mixamorigSpine1',times:[0,.1,.24,.38,.5],values:q('x',0,.20,.08,-.03,0)},{node:'mixamorigHead',times:[0,.1,.24,.38,.5],values:q('x',0,-.17,-.06,.02,0)},{node:'mixamorigLeftArm',times:[0,.1,.24,.38,.5],values:q('z',0,-.32,-.18,-.03,0)},{node:'mixamorigRightArm',times:[0,.1,.24,.38,.5],values:q('z',0,.32,.18,.03,0)}]);
  addClip('Death',1.9,[{node:'mixamorigHips',path:'translation',times:[0,.35,.8,1.35,1.9],values:[b[0].p,at(0,.50),at(0,.46),at(0,.32),at(0,.30)]},{node:'mixamorigSpine1',times:[0,.35,.8,1.35,1.9],values:q('z',0,-.08,-.20,-.42,-.42)},{node:'mixamorigHead',times:[0,.35,.8,1.35,1.9],values:q('x',0,.08,.18,.30,.30)},{node:'mixamorigLeftArm',times:[0,.35,.8,1.35,1.9],values:q('z',0,-.20,-.50,-.65,-.65)},{node:'mixamorigRightArm',times:[0,.35,.8,1.35,1.9],values:q('z',0,.20,.50,.65,.65)},{node:'mixamorigLeftUpLeg',times:[0,.35,.8,1.35,1.9],values:q('z',0,-.10,-.22,-.32,-.32)},{node:'mixamorigRightUpLeg',times:[0,.35,.8,1.35,1.9],values:q('z',0,.10,.22,.32,.32)}]);
  const sourceTextures=[];for(const texture of root.listTextures()){const image=texture.getImage(),meta=await sharp(image).metadata();sourceTextures.push({name:texture.getName(),width:meta.width,height:meta.height,sha256:createHash('sha256').update(image).digest('hex')});if(meta.width>2048||meta.height>2048)texture.setImage(await sharp(image).resize(2048,2048,{fit:'inside',withoutEnlargement:true}).toFormat(meta.format==='jpeg'?'jpeg':'png',meta.format==='jpeg'?{quality:92,chromaSubsampling:'4:4:4'}:{}).toBuffer());}
  const bytes=await io.writeBinary(doc), candidateFile=`${model.id}-native-rig-candidate.glb`;await writeFile(path.join(folder,candidateFile),bytes);
  const check=(await io.readBinary(bytes)).getRoot(),cp=check.listMeshes()[0].listPrimitives()[0],cs=check.listSkins()[0];
  const outputHashes={positions:sha(cp.getAttribute('POSITION').getArray()),normals:sha(cp.getAttribute('NORMAL').getArray()),uvs:sha(cp.getAttribute('TEXCOORD_0').getArray()),indices:sha(cp.getIndices().getArray())};
  if(JSON.stringify(sourceHashes)!==JSON.stringify(outputHashes)||distributed<positions.length/3*.60||maxWeightError>1e-5)throw new Error(`${model.id}: geometry or weight verification failed`);
  const clips=check.listAnimations().map(a=>({name:a.getName(),channels:a.listChannels().length,duration:Math.max(...a.listSamplers().flatMap(s=>Array.from(s.getInput().getArray())))}));
  if(clips.map(c=>c.name).join(',')!==clipNames.join(','))throw new Error(`${model.id}: six required clips are missing`);
  for(const animation of check.listAnimations())for(const channel of animation.listChannels())if(!cs.listJoints().includes(channel.getTargetNode()))throw new Error(`${model.id}: clip targets outside its skin`);
  const runtimeTextures=[];for(const texture of check.listTextures()){const m=await sharp(texture.getImage()).metadata();if(m.width!==2048||m.height!==2048)throw new Error(`${model.id}: expected each retained map at 2K`);runtimeTextures.push({name:texture.getName(),width:m.width,height:m.height,sha256:createHash('sha256').update(texture.getImage()).digest('hex')});}
  const report={schema:'corealm-starred-sheet-b-rig-candidate/1',part:model.part,id:model.id,label:model.label,designDisposition:'provisional-held-for-root-review',source:{file:`assets/art/tripo/imports/creatures/starred-sheet-b/base/part-${String(model.part).padStart(2,'0')}.glb`,sha256:sourceSha256},candidate:{file:candidateFile,sha256:createHash('sha256').update(bytes).digest('hex')},geometry:{vertices:positions.length/3,triangles:indexAccessor.getCount()/3,sourceAttributeHashes:sourceHashes,outputAttributeHashes:outputHashes,retopology:false},rig:{type:'Y-up humanoid imp',bones:b.length,boneNames:b.map(x=>x.name),influencesPerVertex:4,verticesWithDistributedWeights:distributed,maxWeightSumError:maxWeightError,modelSpecificAnatomy:model.accent},clips, textures:{source:sourceTextures,runtime:runtimeTextures},acceptance:{rigMotionLabAccepted:false,productionReady:false,reason:'Chibi-proportioned source sheet is held for root visual review; deformation and motion still need lab review.'}};
  await writeFile(path.join(folder,'candidate-manifest.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({id:model.id,candidateSha256:report.candidate.sha256,vertices:report.geometry.vertices,triangles:report.geometry.triangles,bones:b.length,clips:clips.map(c=>c.name),textures:runtimeTextures.length,distributed},null,2));
}
