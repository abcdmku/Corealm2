import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const dir = 'assets/art/tripo/imports/creatures/starred-sheet-c/parts/01-red-horned-demon';
const id = 'creature_red_horned_demon';
const displayName = 'Red Horned Demon';
const part = JSON.parse(await readFile(`${dir}/part.json`, 'utf8'));
const input = await readFile(`${dir}/base.glb`);
const sourceHash = createHash('sha256').update(input).digest('hex');
if (sourceHash !== part.extracted.sha256) throw new Error(`Extracted GLB hash mismatch: ${sourceHash}`);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.readBinary(input), root = doc.getRoot(), scene = root.listScenes()[0];
const mesh = root.listMeshes()[0], primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find((node) => node.getMesh() === mesh);
if (!scene || !primitive || !meshNode || root.listSkins().length || root.listAnimations().length) throw new Error('Expected an unrigged extracted source mesh.');
const positions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
const normals = Float32Array.from(primitive.getAttribute('NORMAL')?.getArray() ?? []);
const uvs = Float32Array.from(primitive.getAttribute('TEXCOORD_0')?.getArray() ?? []);
const indices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
if (positions.length / 3 !== part.extracted.geometry.vertices || indices.length / 3 !== part.extracted.geometry.triangles) throw new Error('Extracted topology differs from part.json.');
const b = part.extracted.geometry.bounds;
const h = b.max[1] - b.min[1], w = b.max[0] - b.min[0];
const targetHeight = 1.75;
const rigScale = targetHeight / h;
const cx = (b.max[0] + b.min[0]) / 2, cz = (b.max[2] + b.min[2]) / 2;
const sy = (v) => b.min[1] + h * v, sx = (v) => cx + w * v;
const bones = [
  { name:'mixamorigHips', parent:null, p:[cx,sy(.48),cz], sigma:h*.19, group:'torso' },
  { name:'mixamorigSpine', parent:'mixamorigHips', p:[cx,sy(.59),cz], sigma:h*.16, group:'torso' },
  { name:'mixamorigSpine1', parent:'mixamorigSpine', p:[cx,sy(.70),cz], sigma:h*.15, group:'torso' },
  { name:'mixamorigSpine2', parent:'mixamorigSpine1', p:[cx,sy(.78),cz], sigma:h*.13, group:'torso' },
  { name:'mixamorigNeck', parent:'mixamorigSpine2', p:[cx,sy(.86),cz], sigma:h*.10, group:'head' },
  { name:'mixamorigHead', parent:'mixamorigNeck', p:[cx,sy(.92),cz], sigma:h*.15, group:'head' },
  { name:'mixamorigLeftShoulder', parent:'mixamorigSpine2', p:[sx(-.20),sy(.77),cz], sigma:w*.12, group:'leftArm', side:-1 },
  { name:'mixamorigLeftArm', parent:'mixamorigLeftShoulder', p:[sx(-.31),sy(.67),cz], sigma:w*.11, group:'leftArm', side:-1 },
  { name:'mixamorigLeftForeArm', parent:'mixamorigLeftArm', p:[sx(-.40),sy(.54),cz], sigma:w*.10, group:'leftArm', side:-1 },
  { name:'mixamorigLeftHand', parent:'mixamorigLeftForeArm', p:[sx(-.43),sy(.46),cz], sigma:w*.12, group:'leftArm', side:-1 },
  { name:'mixamorigRightShoulder', parent:'mixamorigSpine2', p:[sx(.20),sy(.77),cz], sigma:w*.12, group:'rightArm', side:1 },
  { name:'mixamorigRightArm', parent:'mixamorigRightShoulder', p:[sx(.31),sy(.67),cz], sigma:w*.11, group:'rightArm', side:1 },
  { name:'mixamorigRightForeArm', parent:'mixamorigRightArm', p:[sx(.40),sy(.54),cz], sigma:w*.10, group:'rightArm', side:1 },
  { name:'mixamorigRightHand', parent:'mixamorigRightForeArm', p:[sx(.43),sy(.46),cz], sigma:w*.12, group:'rightArm', side:1 },
  { name:'mixamorigLeftUpLeg', parent:'mixamorigHips', p:[sx(-.13),sy(.39),cz], sigma:w*.15, group:'leftLeg', side:-1 },
  { name:'mixamorigLeftLeg', parent:'mixamorigLeftUpLeg', p:[sx(-.14),sy(.17),cz], sigma:w*.13, group:'leftLeg', side:-1 },
  { name:'mixamorigLeftFoot', parent:'mixamorigLeftLeg', p:[sx(-.14),sy(.06),cz], sigma:w*.13, group:'leftLeg', side:-1 },
  { name:'mixamorigLeftToeBase', parent:'mixamorigLeftFoot', p:[sx(-.14),sy(.035),cz+h*.06], sigma:w*.12, group:'leftLeg', side:-1 },
  { name:'mixamorigRightUpLeg', parent:'mixamorigHips', p:[sx(.13),sy(.39),cz], sigma:w*.15, group:'rightLeg', side:1 },
  { name:'mixamorigRightLeg', parent:'mixamorigRightUpLeg', p:[sx(.14),sy(.17),cz], sigma:w*.13, group:'rightLeg', side:1 },
  { name:'mixamorigRightFoot', parent:'mixamorigRightLeg', p:[sx(.14),sy(.06),cz], sigma:w*.13, group:'rightLeg', side:1 },
  { name:'mixamorigRightToeBase', parent:'mixamorigRightFoot', p:[sx(.14),sy(.035),cz+h*.06], sigma:w*.12, group:'rightLeg', side:1 },
];
const byName = new Map(bones.map((x,i)=>[x.name,{...x,index:i}]));
for(const bone of bones){const parent=bone.parent?byName.get(bone.parent):null;bone.local=parent?bone.p.map((v,a)=>v-parent.p[a]):bone.p;}
const oldParent=meshNode.getParentNode(); if(oldParent) oldParent.removeChild(meshNode); else scene.removeChild(meshNode);
meshNode.setName('RedHornedDemonMesh');
const armature=doc.createNode('RedHornedDemonArmature').setScale([rigScale,rigScale,rigScale]); scene.addChild(armature); armature.addChild(meshNode);
const joints=new Map(); for(const bone of bones){const node=doc.createNode(bone.name).setTranslation(bone.local);joints.set(bone.name,node);(bone.parent?joints.get(bone.parent):armature).addChild(node);}
const skin=doc.createSkin('RedHornedDemonHumanoid').setSkeleton(joints.get('mixamorigHips')); for(const bone of bones)skin.addJoint(joints.get(bone.name));
const ibm=new Float32Array(bones.length*16); for(let i=0;i<bones.length;i++){const [x,y,z]=bones[i].p;ibm.set([1,0,0,0,0,1,0,0,0,0,1,0,-x,-y,-z,1],i*16);}
const buffer=root.listBuffers()[0]; skin.setInverseBindMatrices(doc.createAccessor('RedDemonInverseBind').setArray(ibm).setType(Accessor.Type.MAT4).setBuffer(buffer)); meshNode.setSkin(skin);
function distance(p,a,b){const v=b.map((x,i)=>x-a[i]),l=v.reduce((s,x)=>s+x*x,0)||1,t=Math.max(0,Math.min(1,p.reduce((s,x,i)=>s+(x-a[i])*v[i],0)/l));return Math.hypot(...p.map((x,i)=>x-a[i]-v[i]*t));}
const ji=new Uint16Array(positions.length/3*4), wt=new Float32Array(positions.length/3*4); let distributed=0,maxSumError=0;
for(let v=0;v<positions.length/3;v++){const p=[positions[v*3],positions[v*3+1],positions[v*3+2]], scores=[];for(const bone of bones){let gate=1;const y=(p[1]-b.min[1])/h;if(bone.group==='head')gate=y>.70?1:.015;if(/Arm/.test(bone.group)){gate=y>.28&&y<.94?1:.008;gate*=.02+.98/(1+Math.exp(-(bone.side*(p[0]-cx)+w*.035)/(w*.09)));}if(/Leg/.test(bone.group)){gate=y<.58?1:.006;gate*=.02+.98/(1+Math.exp(-(bone.side*(p[0]-cx)+w*.02)/(w*.10)));}const parent=bone.parent?byName.get(bone.parent):null,d=distance(p,parent?.p??bone.p,bone.p),s=gate*Math.exp(-.5*(d/bone.sigma)**2);if(s>1e-12)scores.push({index:byName.get(bone.name).index,score:s});}scores.sort((a,b)=>b.score-a.score);const chosen=scores.slice(0,4),total=chosen.reduce((s,x)=>s+x.score,0);if(!chosen.length)throw new Error(`No skin weights at vertex ${v}`);let sum=0;for(let j=0;j<4;j++){const c=chosen[j]??chosen[0],wgt=j>=chosen.length?0:j===chosen.length-1?1-sum:c.score/total;ji[v*4+j]=c.index;wt[v*4+j]=wgt;sum+=wgt;if(wgt>1e-6&&j>0)distributed++;}maxSumError=Math.max(maxSumError,Math.abs(sum-1));}
primitive.setAttribute('JOINTS_0',doc.createAccessor('RedDemonJoints').setArray(ji).setType(Accessor.Type.VEC4).setBuffer(buffer)); primitive.setAttribute('WEIGHTS_0',doc.createAccessor('RedDemonWeights').setArray(wt).setType(Accessor.Type.VEC4).setBuffer(buffer));
const quat=(axis,a)=>{const s=Math.sin(a/2),c=Math.cos(a/2);return axis==='x'?[s,0,0,c]:axis==='y'?[0,s,0,c]:[0,0,s,c];}; const clips=[];
function clip(name,seconds,tracks){const anim=doc.createAnimation(name);for(const t of tracks){const ti=doc.createAccessor(`${name}_${t.node}_time`).setArray(Float32Array.from(t.times)).setType(Accessor.Type.SCALAR).setBuffer(buffer),vo=doc.createAccessor(`${name}_${t.node}_value`).setArray(Float32Array.from(t.values.flat())).setType(t.path==='translation'?Accessor.Type.VEC3:Accessor.Type.VEC4).setBuffer(buffer),s=doc.createAnimationSampler(`${name}_${t.node}`).setInput(ti).setOutput(vo).setInterpolation('LINEAR');anim.addSampler(s).addChannel(doc.createAnimationChannel(`${name}_${t.node}`).setTargetNode(joints.get(t.node)).setTargetPath(t.path??'rotation').setSampler(s));}clips.push({name,seconds,channels:tracks.length});}
const phases=[0,.25,.5,.75,1], cyc=(phase,amp)=>phases.map(t=>quat('x',Math.sin((t+phase)*Math.PI*2)*amp));
clip('Idle',2.8,[{node:'mixamorigSpine1',times:[0,.7,1.4,2.1,2.8],values:[0,.012,0,-.012,0].map(a=>quat('z',a))},{node:'mixamorigHead',times:[0,.7,1.4,2.1,2.8],values:[-.02,.015,.03,-.01,-.02].map(a=>quat('y',a))}]);
for(const [name,duration,leg,arm,bob] of [['Walk',1,.32,.18,.012],['Run',.72,.64,.42,.026]])clip(name,duration,[{node:'mixamorigLeftUpLeg',times:phases.map(t=>t*duration),values:cyc(0,leg)},{node:'mixamorigRightUpLeg',times:phases.map(t=>t*duration),values:cyc(.5,leg)},{node:'mixamorigLeftLeg',times:phases.map(t=>t*duration),values:phases.map(t=>quat('x',-Math.max(0,Math.sin(t*2*Math.PI))*leg*.55))},{node:'mixamorigRightLeg',times:phases.map(t=>t*duration),values:phases.map(t=>quat('x',-Math.max(0,Math.sin((t+.5)*2*Math.PI))*leg*.55))},{node:'mixamorigLeftArm',times:phases.map(t=>t*duration),values:cyc(.5,arm)},{node:'mixamorigRightArm',times:phases.map(t=>t*duration),values:cyc(0,arm)},{node:'mixamorigHips',path:'translation',times:phases.map(t=>t*duration),values:phases.map(t=>[cx,sy(.48)+(t===.25||t===.75?bob:0),cz])}]);
clip('Attack',.92,[{node:'mixamorigSpine1',times:[0,.18,.5,.72,.92],values:[0,-.2,.24,.08,0].map(a=>quat('y',a))},{node:'mixamorigRightArm',times:[0,.18,.5,.72,.92],values:[0,.72,-.22,-.2,0].map(a=>quat('z',a))},{node:'mixamorigRightForeArm',times:[0,.18,.5,.72,.92],values:[0,.5,-.85,-.25,0].map(a=>quat('x',a))},{node:'mixamorigLeftArm',times:[0,.18,.5,.72,.92],values:[0,-.18,-.25,.08,0].map(a=>quat('x',a))}]);
clip('Hit',.46,[{node:'mixamorigSpine1',times:[0,.08,.2,.46],values:[0,.25,-.08,0].map(a=>quat('z',a))},{node:'mixamorigHead',times:[0,.08,.2,.46],values:[0,.2,-.05,0].map(a=>quat('z',a))},{node:'mixamorigRightArm',times:[0,.08,.2,.46],values:[0,.3,-.08,0].map(a=>quat('x',a))}]);
clip('Death',1.45,[{node:'mixamorigHips',times:[0,.22,.65,1.05,1.45],values:[0,-.08,-.28,-.34,-.34].map(a=>quat('z',a))},{node:'mixamorigSpine1',times:[0,.22,.65,1.05,1.45],values:[0,.14,.28,.34,.34].map(a=>quat('x',a))},{node:'mixamorigHead',times:[0,.22,.65,1.05,1.45],values:[0,.12,.28,.35,.35].map(a=>quat('z',a))},{node:'mixamorigLeftArm',times:[0,.22,.65,1.05,1.45],values:[0,.15,.58,.64,.64].map(a=>quat('x',a))},{node:'mixamorigRightArm',times:[0,.22,.65,1.05,1.45],values:[0,-.12,-.48,-.55,-.55].map(a=>quat('x',a))}]);
const sourceTextures=[],runtimeTextures=[];const mat=root.listMaterials()[0],bc=mat?.getBaseColorTexture(),mr=mat?.getMetallicRoughnessTexture(),nm=mat?.getNormalTexture();if(!bc||!mr||!nm)throw new Error('Missing source base color, packed PBR, or normal map.');
for(const tex of root.listTextures()){const bytes=tex.getImage(),meta=await sharp(bytes).metadata();sourceTextures.push({name:tex.getName(),width:meta.width,height:meta.height,sha256:createHash('sha256').update(bytes).digest('hex')});if(meta.width>2048||meta.height>2048)tex.setImage(await sharp(bytes).resize(2048,2048,{fit:'fill',kernel:tex===mr?'linear':'lanczos3'}).toFormat(meta.format==='jpeg'?'jpeg':'png',meta.format==='jpeg'?{quality:92,chromaSubsampling:'4:4:4'}:{}).toBuffer());const out=await sharp(tex.getImage()).metadata();if(out.width>2048||out.height>2048)throw new Error('Texture resize exceeded 2K');runtimeTextures.push({name:tex.getName(),width:out.width,height:out.height,mime:tex.getMimeType(),bytes:tex.getImage().length});}
const output=await io.writeBinary(doc);const candidateFile=`${dir}/red-horned-demon-rigged.glb`;await writeFile(candidateFile,output);const candidateHash=createHash('sha256').update(output).digest('hex');
const check=(await io.readBinary(output)).getRoot(),cm=check.listMeshes()[0].listPrimitives()[0],cs=check.listSkins()[0];if(cm.getAttribute('POSITION').getArray().some((v,i)=>v!==positions[i])||cm.getAttribute('NORMAL').getArray().some((v,i)=>v!==normals[i])||cm.getAttribute('TEXCOORD_0').getArray().some((v,i)=>v!==uvs[i])||cm.getIndices().getArray().some((v,i)=>v!==indices[i]))throw new Error('Geometry/UV/topology changed.');
const checkPos=cm.getAttribute('POSITION').getArray(),checkNormals=cm.getAttribute('NORMAL').getArray(),checkUvs=cm.getAttribute('TEXCOORD_0').getArray(),checkJoints=cm.getAttribute('JOINTS_0')?.getArray(),checkWeights=cm.getAttribute('WEIGHTS_0')?.getArray();
if(!checkJoints||!checkWeights||cs.listJoints().length!==bones.length||checkPos.length!==positions.length||checkNormals.length!==normals.length||checkUvs.length!==uvs.length)throw new Error('Candidate reread is missing geometry or skin data.');
let distributedCheck=0;for(let v=0;v<positions.length/3;v++){let sum=0,n=0;for(let k=0;k<4;k++){const j=checkJoints[v*4+k],weight=checkWeights[v*4+k];if(!Number.isInteger(j)||j<0||j>=bones.length||!Number.isFinite(weight)||weight<0)throw new Error(`Invalid joint influence at vertex ${v}`);sum+=weight;if(weight>1e-6)n++;}if(Math.abs(sum-1)>1e-5)throw new Error(`Weights do not normalize at vertex ${v}: ${sum}`);if(n>1)distributedCheck++;}if(distributedCheck<positions.length/3*.75)throw new Error('Insufficient distributed skin weights after export.');
const names=check.listAnimations().map(x=>x.getName());if(['Idle','Walk','Run','Attack','Hit','Death'].some(x=>!names.includes(x)))throw new Error('Candidate lost a required clip.');for(const anim of check.listAnimations())for(const channel of anim.listChannels())if(!cs.listJoints().includes(channel.getTargetNode()))throw new Error(`Animation ${anim.getName()} targets a non-joint.`);
const checkScene=check.listScenes()[0],checkArmature=checkScene.listChildren().find(n=>n.getName()==='RedHornedDemonArmature');
if(!checkArmature||checkArmature.getScale().some((v,i)=>Math.abs(v-rigScale)>1e-6))throw new Error('Root scale did not survive candidate export.');
const scaledBounds={min:b.min.map(v=>v*rigScale),max:b.max.map(v=>v*rigScale)};
const cand={schema:'corealm-creature-native-rig-candidate/1',id,displayName,status:'awaiting-root-lab-review',accepted:false,reviewHold:part.reviewHold,source:{file:part.extracted.file,sha256:sourceHash,bytes:input.length,modelSource:part.source,geometry:{vertices:positions.length/3,triangles:indices.length/3,positionsPreserved:true,normalsPreserved:true,uvsPreserved:true,indicesPreserved:true,retopology:false},textures:sourceTextures,sourceSkin:'none',sourceAnimations:[]},candidate:{file:candidateFile,sha256:candidateHash,bytes:output.length,productionTarget:`game/public/assets/models/creature/${id}.glb`,rig:{type:'Mixamo-named humanoid glTF skin',rootScale:[rigScale,rigScale,rigScale],scaleFactor:rigScale,targetHeightMeters:targetHeight,joints:bones.map(x=>({name:x.name,parent:x.parent,position:x.p})),influencesPerVertex:4,verticesWithDistributedWeights:distributedCheck,maximumWeightSumError:maxSumError,method:'Model-scaled four-influence anatomical segment distance fields with head, arm and leg gates; uniform scale is applied to the armature container.'},textures:runtimeTextures,animations:clips},acceptance:{sourceDesignAudit:true,geometry:true,rig:false,animation:false,textures:false,labAccepted:false,worldIntegrated:false}};await writeFile(`${dir}/catalog.json`,JSON.stringify(cand,null,2)+'\n');
const lab={id,file:`models/creature/${id}.glb`,pack:'corealm-starred-creatures',category:'character',is:displayName,tags:['creature','humanoid','demon','starred','tripo','candidate'],bytes:output.length,sha256:candidateHash,size:{x:w*rigScale,y:h*rigScale,z:(b.max[2]-b.min[2])*rigScale},base:scaledBounds.min,bounds:scaledBounds,groundY:scaledBounds.min[1],triangles:indices.length/3,animations:clips.map(x=>x.name),materials:root.listMaterials().map(x=>x.getName()),sourceProvenance:{author:'Corealm candidate rig reconstruction',sourceFile:part.extracted.file,sourceSha256:sourceHash,candidateFile:candidateFile,candidateSha256:candidateHash,sourceModelId:part.source.cardStorageUuid,rigMethod:cand.candidate.rig.method,textures:runtimeTextures,candidateStatus:'awaiting-root-lab-review'},acceptance:{assetAudit:true,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false}};await writeFile(`${dir}/lab-catalog.json`,JSON.stringify({schema:'corealm-lab-asset-candidates/1',assets:[lab]},null,2)+'\n');console.log(JSON.stringify({id,candidateFile,candidateHash,targetHeight,rigScale,vertices:positions.length/3,triangles:indices.length/3,joints:bones.length,clips:clips.map(c=>c.name),textures:runtimeTextures,distributed},null,2));
