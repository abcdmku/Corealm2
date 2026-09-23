import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const baseDir = 'assets/art/tripo/imports/creatures/starred-sheet-c/parts/09-brown-many-horn-demon';
const slug = 'brown-many-horn-demon';
const displayName = 'Brown Many-Horn Demon';
const tier = 'T45-T55';
const part = JSON.parse(await readFile(`${baseDir}/part.json`, 'utf8'));
const sourcePath = `${baseDir}/base.glb`;
const candidatePath = `${baseDir}/brown-many-horn-demon-native-rig.glb`;
const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
if (sourceSha256 !== part.extracted.sha256) throw new Error(`Extracted source hash mismatch: ${sourceSha256}`);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find((node) => node.getMesh() === mesh);
if (!scene || !primitive || !meshNode || root.listSkins().length || root.listAnimations().length) throw new Error('Expected the extracted unrigged mesh.');
const positions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
const normals = Float32Array.from(primitive.getAttribute('NORMAL')?.getArray() ?? []);
const uvs = Float32Array.from(primitive.getAttribute('TEXCOORD_0')?.getArray() ?? []);
const indices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
if (positions.length / 3 !== part.extracted.geometry.vertices || indices.length / 3 !== part.extracted.geometry.triangles) throw new Error('Source topology disagrees with extraction evidence.');
function sha(array) { return createHash('sha256').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex'); }
const sourceAttrHashes = { POSITION: sha(positions), NORMAL: sha(normals), TEXCOORD_0: sha(uvs) };
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
  bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
}
const extent = bounds.max.map((value, axis) => value - bounds.min[axis]);
const center = bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2);
const h = extent[1], w = extent[0];
const targetHeightMeters = 2.35;
const presentationScale = targetHeightMeters / h;
const Y = (f) => bounds.min[1] + h * f;
const X = (f) => center[0] + w * f;
// The extraction is a compact, upright demon biped. Keep the spine fitted to its torso;
// horns/spikes remain part of the head-weighted source surface.
const bones = [
  { name:'mixamorigHips', parent:null, p:[center[0],Y(.39),center[2]], sigma:h*.14, group:'torso' },
  { name:'mixamorigSpine', parent:'mixamorigHips', p:[center[0],Y(.49),center[2]], sigma:h*.14, group:'torso' },
  { name:'mixamorigSpine1', parent:'mixamorigSpine', p:[center[0],Y(.60),center[2]], sigma:h*.13, group:'torso' },
  { name:'mixamorigSpine2', parent:'mixamorigSpine1', p:[center[0],Y(.71),center[2]], sigma:h*.12, group:'torso' },
  { name:'mixamorigNeck', parent:'mixamorigSpine2', p:[center[0],Y(.82),center[2]], sigma:h*.09, group:'torso' },
  { name:'mixamorigHead', parent:'mixamorigNeck', p:[center[0],Y(.91),center[2]], sigma:h*.15, group:'head' },
  { name:'mixamorigLeftShoulder', parent:'mixamorigSpine2', p:[X(-.48),Y(.71),center[2]], sigma:w*.26, group:'leftArm', side:-1 },
  { name:'mixamorigLeftArm', parent:'mixamorigLeftShoulder', p:[X(-.66),Y(.65),center[2]], sigma:w*.23, group:'leftArm', side:-1 },
  { name:'mixamorigLeftForeArm', parent:'mixamorigLeftArm', p:[X(-.73),Y(.51),center[2]], sigma:w*.22, group:'leftArm', side:-1 },
  { name:'mixamorigLeftHand', parent:'mixamorigLeftForeArm', p:[X(-.76),Y(.39),center[2]], sigma:w*.22, group:'leftArm', side:-1 },
  { name:'mixamorigRightShoulder', parent:'mixamorigSpine2', p:[X(.48),Y(.71),center[2]], sigma:w*.26, group:'rightArm', side:1 },
  { name:'mixamorigRightArm', parent:'mixamorigRightShoulder', p:[X(.66),Y(.65),center[2]], sigma:w*.23, group:'rightArm', side:1 },
  { name:'mixamorigRightForeArm', parent:'mixamorigRightArm', p:[X(.73),Y(.51),center[2]], sigma:w*.22, group:'rightArm', side:1 },
  { name:'mixamorigRightHand', parent:'mixamorigRightForeArm', p:[X(.76),Y(.39),center[2]], sigma:w*.22, group:'rightArm', side:1 },
  { name:'mixamorigLeftUpLeg', parent:'mixamorigHips', p:[X(-.28),Y(.32),center[2]], sigma:w*.30, group:'leftLeg', side:-1 },
  { name:'mixamorigLeftLeg', parent:'mixamorigLeftUpLeg', p:[X(-.29),Y(.16),center[2]], sigma:w*.27, group:'leftLeg', side:-1 },
  { name:'mixamorigLeftFoot', parent:'mixamorigLeftLeg', p:[X(-.29),Y(.045),center[2]], sigma:w*.24, group:'leftLeg', side:-1 },
  { name:'mixamorigLeftToeBase', parent:'mixamorigLeftFoot', p:[X(-.29),Y(.025),center[2]+extent[2]*.28], sigma:w*.24, group:'leftLeg', side:-1 },
  { name:'mixamorigRightUpLeg', parent:'mixamorigHips', p:[X(.28),Y(.32),center[2]], sigma:w*.30, group:'rightLeg', side:1 },
  { name:'mixamorigRightLeg', parent:'mixamorigRightUpLeg', p:[X(.29),Y(.16),center[2]], sigma:w*.27, group:'rightLeg', side:1 },
  { name:'mixamorigRightFoot', parent:'mixamorigRightLeg', p:[X(.29),Y(.045),center[2]], sigma:w*.24, group:'rightLeg', side:1 },
  { name:'mixamorigRightToeBase', parent:'mixamorigRightFoot', p:[X(.29),Y(.025),center[2]+extent[2]*.28], sigma:w*.24, group:'rightLeg', side:1 },
];
const byName = new Map(bones.map((bone,index)=>[bone.name,{...bone,index}]));
for (const bone of bones) { const parent = bone.parent && byName.get(bone.parent); bone.local = parent ? bone.p.map((v,i)=>v-parent.p[i]) : bone.p; }
const originalParent = meshNode.getParentNode();
if (originalParent) originalParent.removeChild(meshNode); else scene.removeChild(meshNode);
meshNode.setName('BrownManyHornDemonMesh').setTranslation([0,0,0]).setRotation([0,0,0,1]).setScale([1,1,1]);
const armature = doc.createNode('BrownManyHornDemonArmature').setScale([presentationScale,presentationScale,presentationScale]); scene.addChild(armature); armature.addChild(meshNode);
const jointNodes = new Map();
for (const bone of bones) {
  const node = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0,0,0,1]).setScale([1,1,1]); jointNodes.set(bone.name,node);
  (bone.parent ? jointNodes.get(bone.parent) : armature).addChild(node);
}
const skin = doc.createSkin('BrownManyHornDemon_Humanoid').setSkeleton(jointNodes.get('mixamorigHips'));
for (const bone of bones) skin.addJoint(jointNodes.get(bone.name));
const ibm = new Float32Array(bones.length*16);
for(let i=0;i<bones.length;i++){const [x,y,z]=bones[i].p;ibm.set([1,0,0,0,0,1,0,0,0,0,1,0,-x,-y,-z,1],i*16);}
const buffer=root.listBuffers()[0]; skin.setInverseBindMatrices(doc.createAccessor('BrownManyHornDemon_InverseBind').setArray(ibm).setType(Accessor.Type.MAT4).setBuffer(buffer)); meshNode.setSkin(skin);
function segDistance(p,a,b){const d=b.map((v,i)=>v-a[i]);const l=d.reduce((s,v)=>s+v*v,0)||1;const t=Math.max(0,Math.min(1,p.reduce((s,v,i)=>s+(v-a[i])*d[i],0)/l));return Math.hypot(...p.map((v,i)=>v-(a[i]+t*d[i])));}
const joints=new Uint16Array(positions.length/3*4), weights=new Float32Array(joints.length); let distributed=0,maxWeightSumError=0;
for(let v=0;v<positions.length/3;v++){
  const p=[positions[v*3],positions[v*3+1],positions[v*3+2]], [x,y]=p; const scored=[];
  for(const bone of bones){let gate=1;
    if(bone.group==='head')gate=y>=Y(.76)?1:.005;
    if(bone.group==='leftArm'||bone.group==='rightArm'){gate=y>Y(.23)&&y<Y(.89)?1:.006;gate*=.01+.99/(1+Math.exp(-(bone.side*(x-center[0])+w*.04)/(w*.12)));}
    if(bone.group==='leftLeg'||bone.group==='rightLeg'){gate=y<Y(.53)?1:.006;gate*=.01+.99/(1+Math.exp(-(bone.side*(x-center[0])+w*.035)/(w*.13)));}
    const parent=bone.parent?byName.get(bone.parent):null;const d=segDistance(p,parent?.p??bone.p,bone.p);const score=gate*Math.exp(-.5*(d/bone.sigma)**2);if(score>1e-12)scored.push({index:byName.get(bone.name).index,score});
  }
  scored.sort((a,b)=>b.score-a.score);const chosen=scored.slice(0,4);if(!chosen.length)throw new Error(`No weights for vertex ${v}`);const sum=chosen.reduce((s,c)=>s+c.score,0);let assigned=0;
  let active=0;for(let slot=0;slot<4;slot++){const c=chosen[slot]??chosen[0];const wt=slot>=chosen.length?0:slot===chosen.length-1?1-assigned:c.score/sum;joints[v*4+slot]=c.index;weights[v*4+slot]=wt;assigned+=wt;if(wt>1e-6)active++;}if(active>1)distributed++;
  const ws=weights[v*4]+weights[v*4+1]+weights[v*4+2]+weights[v*4+3];maxWeightSumError=Math.max(maxWeightSumError,Math.abs(ws-1));
}
primitive.setAttribute('JOINTS_0',doc.createAccessor('BrownManyHornDemon_Joints0').setArray(joints).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0',doc.createAccessor('BrownManyHornDemon_Weights0').setArray(weights).setType(Accessor.Type.VEC4).setBuffer(buffer));
const q=(axis,a)=>{const s=Math.sin(a/2),c=Math.cos(a/2);return axis==='x'?[s,0,0,c]:axis==='y'?[0,s,0,c]:[0,0,s,c];};
const clips=[];
function addClip(name,seconds,tracks){const anim=doc.createAnimation(name);for(const track of tracks){const input=doc.createAccessor(`${name}_${track.node}_time`).setArray(Float32Array.from(track.times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);const output=doc.createAccessor(`${name}_${track.node}_value`).setArray(Float32Array.from(track.values.flat())).setType(track.path==='translation'?Accessor.Type.VEC3:Accessor.Type.VEC4).setBuffer(buffer);const sampler=doc.createAnimationSampler(`${name}_${track.node}`).setInput(input).setOutput(output).setInterpolation('LINEAR');anim.addSampler(sampler);anim.addChannel(doc.createAnimationChannel(`${name}_${track.node}`).setTargetNode(jointNodes.get(track.node)).setTargetPath(track.path??'rotation').setSampler(sampler));}clips.push({name,seconds,channels:tracks.length});}
const phase=[0,.25,.5,.75,1], cycle=(offset,amount)=>phase.map(t=>q('x',Math.sin((t+offset)*Math.PI*2)*amount));
addClip('Idle',2.8,[{node:'mixamorigSpine1',times:[0,.7,1.4,2.1,2.8],values:[q('z',0),q('z',.02),q('z',0),q('z',-.02),q('z',0)]},{node:'mixamorigSpine2',times:[0,.7,1.4,2.1,2.8],values:[q('x',0),q('x',-.02),q('x',0),q('x',.015),q('x',0)]},{node:'mixamorigHead',times:[0,.7,1.4,2.1,2.8],values:[q('y',-.03),q('y',.02),q('y',.04),q('y',-.01),q('y',-.03)]}]);
addClip('Walk',1,[{node:'mixamorigLeftUpLeg',times:phase,values:cycle(0,.38)},{node:'mixamorigRightUpLeg',times:phase,values:cycle(.5,.38)},{node:'mixamorigLeftLeg',times:phase,values:phase.map(t=>q('x',-Math.max(0,Math.sin(t*Math.PI*2))*.25))},{node:'mixamorigRightLeg',times:phase,values:phase.map(t=>q('x',-Math.max(0,Math.sin((t+.5)*Math.PI*2))*.25))},{node:'mixamorigLeftArm',times:phase,values:cycle(.5,.22)},{node:'mixamorigRightArm',times:phase,values:cycle(0,.22)}]);
addClip('Run',.72,[{node:'mixamorigLeftUpLeg',times:phase.map(t=>t*.72),values:cycle(0,.68)},{node:'mixamorigRightUpLeg',times:phase.map(t=>t*.72),values:cycle(.5,.68)},{node:'mixamorigLeftLeg',times:phase.map(t=>t*.72),values:phase.map(t=>q('x',-Math.max(0,Math.sin(t*Math.PI*2))*.56))},{node:'mixamorigRightLeg',times:phase.map(t=>t*.72),values:phase.map(t=>q('x',-Math.max(0,Math.sin((t+.5)*Math.PI*2))*.56))},{node:'mixamorigLeftArm',times:phase.map(t=>t*.72),values:cycle(.5,.48)},{node:'mixamorigRightArm',times:phase.map(t=>t*.72),values:cycle(0,.48)},{node:'mixamorigSpine1',times:phase.map(t=>t*.72),values:phase.map(t=>q('x',.03+Math.sin(t*Math.PI*2)*.03))}]);
addClip('Attack',.92,[{node:'mixamorigSpine1',times:[0,.18,.5,.72,.92],values:[q('y',0),q('y',-.28),q('y',.24),q('y',.1),q('y',0)]},{node:'mixamorigRightArm',times:[0,.18,.5,.72,.92],values:[q('z',0),q('z',.82),q('z',-.15),q('z',-.25),q('z',0)]},{node:'mixamorigRightForeArm',times:[0,.18,.5,.72,.92],values:[q('x',0),q('x',.55),q('x',-.88),q('x',-.3),q('x',0)]},{node:'mixamorigLeftArm',times:[0,.18,.5,.72,.92],values:[q('x',0),q('x',-.2),q('x',-.3),q('x',.1),q('x',0)]}]);
addClip('Hit',.46,[{node:'mixamorigSpine1',times:[0,.08,.2,.46],values:[q('z',0),q('z',.3),q('z',-.1),q('z',0)]},{node:'mixamorigSpine2',times:[0,.08,.2,.46],values:[q('x',0),q('x',-.18),q('x',.06),q('x',0)]},{node:'mixamorigHead',times:[0,.08,.2,.46],values:[q('z',0),q('z',.22),q('z',-.06),q('z',0)]},{node:'mixamorigRightArm',times:[0,.08,.2,.46],values:[q('x',0),q('x',.36),q('x',-.08),q('x',0)]}]);
addClip('Death',1.45,[{node:'mixamorigHips',path:'translation',times:[0,.22,.65,1.05,1.45],values:[[center[0],Y(.39),center[2]],[center[0],Y(.36),center[2]],[center[0],Y(.27),center[2]],[center[0],Y(.24),center[2]],[center[0],Y(.24),center[2]]]},{node:'mixamorigHips',times:[0,.22,.65,1.05,1.45],values:[q('z',0),q('z',-.08),q('z',-.28),q('z',-.36),q('z',-.36)]},{node:'mixamorigSpine1',times:[0,.22,.65,1.05,1.45],values:[q('x',0),q('x',.14),q('x',.3),q('x',.36),q('x',.36)]},{node:'mixamorigHead',times:[0,.22,.65,1.05,1.45],values:[q('z',0),q('z',.12),q('z',.28),q('z',.36),q('z',.36)]},{node:'mixamorigLeftArm',times:[0,.22,.65,1.05,1.45],values:[q('x',0),q('x',.12),q('x',.6),q('x',.66),q('x',.66)]},{node:'mixamorigRightArm',times:[0,.22,.65,1.05,1.45],values:[q('x',0),q('x',-.12),q('x',-.5),q('x',-.56),q('x',-.56)]}]);
const outputBytes=await io.writeBinary(doc); await writeFile(candidatePath,outputBytes);
const candidateSha256=createHash('sha256').update(outputBytes).digest('hex');
const check=await io.readBinary(outputBytes), checkRoot=check.getRoot(), checkPrim=checkRoot.listMeshes()[0].listPrimitives()[0];
const checkPos=checkPrim.getAttribute('POSITION').getArray(), checkNormal=checkPrim.getAttribute('NORMAL').getArray(), checkUv=checkPrim.getAttribute('TEXCOORD_0').getArray(), checkIdx=checkPrim.getIndices().getArray(), checkWeights=checkPrim.getAttribute('WEIGHTS_0').getArray(), checkJoints=checkPrim.getAttribute('JOINTS_0').getArray();
if(sha(checkPos)!==sourceAttrHashes.POSITION||sha(checkNormal)!==sourceAttrHashes.NORMAL||sha(checkUv)!==sourceAttrHashes.TEXCOORD_0||sha(checkIdx)!==sha(indices))throw new Error('Candidate changed source positions, normals, UVs, or topology.');
const checkSkin=checkRoot.listSkins()[0]; if(!checkSkin||checkSkin.listJoints().length!==bones.length)throw new Error('Missing exported skin.');
for(let v=0;v<checkPos.length/3;v++){let sum=0;for(let s=0;s<4;s++){const j=checkJoints[v*4+s],wt=checkWeights[v*4+s];if(j>=bones.length||!Number.isFinite(wt)||wt<0)throw new Error(`Invalid influence on vertex ${v}`);sum+=wt;}if(Math.abs(sum-1)>1e-5)throw new Error(`Weights do not sum to one on vertex ${v}`);}
const animationNames=checkRoot.listAnimations().map(a=>a.getName()); const required=['Idle','Walk','Run','Attack','Hit','Death'];
if(required.some(n=>!animationNames.includes(n)))throw new Error('Missing required animation clip.');
for(const anim of checkRoot.listAnimations())for(const channel of anim.listChannels())if(!checkSkin.listJoints().includes(channel.getTargetNode()))throw new Error(`Non-joint animation target in ${anim.getName()}`);
const textureMetrics=[];for(const texture of root.listTextures()){const image=texture.getImage();const sharpMeta=await (await import('sharp')).default(image).metadata();if(sharpMeta.width>2048||sharpMeta.height>2048)throw new Error(`Runtime texture exceeds 2K: ${texture.getName()}`);textureMetrics.push({name:texture.getName(),width:sharpMeta.width,height:sharpMeta.height,mimeType:texture.getMimeType(),bytes:image.length,sha256:createHash('sha256').update(image).digest('hex')});}
const id='creature_brown_many_horn_demon';
const candidate={schema:'corealm-creature-native-rig-candidate/1',id,displayName,status:'awaiting-root-lab-review',accepted:false,source:{file:sourcePath,sha256:sourceSha256,bytes:sourceBytes.length,starredModelId:null,starredCardId:part.source.cardStorageUuid,starredDisplayName:displayName,geometry:{vertices:positions.length/3,triangles:indices.length/3,bounds,positionsPreserved:true,normalsPreserved:true,uvsPreserved:true,indicesPreserved:true,retopology:false},textures:part.extracted.textures,sourceSkin:'none',sourceAnimations:[]},candidate:{file:candidatePath,sha256:candidateSha256,bytes:outputBytes.length,productionTarget:`game/public/assets/models/creature/${id}.glb`,presentation:{targetHeightMeters,scaleFactor:presentationScale,neutralGroundedHeightMeters:targetHeightMeters,uniformRootScale:presentationScale,scaleNode:'BrownManyHornDemonArmature'},geometry:{vertices:positions.length/3,triangles:indices.length/3,positionsPreserved:true,normalsPreserved:true,uvsPreserved:true,indicesPreserved:true},rig:{type:'Mixamo-named humanoid glTF skin fitted to extracted upright demon anatomy',joints:bones.map(b=>({name:b.name,parent:b.parent,position:b.p})),influencesPerVertex:4,verticesWithDistributedWeights:distributed/4,maximumWeightSumError:maxWeightSumError,method:'Four highest model-specific bone-segment distance weights with anatomical lateral and vertical gates; original geometry retained.'},textures:textureMetrics,animations:clips},suggestedTier:tier,acceptance:{sourceDesignAudit:true,geometry:true,rig:false,animation:false,textures:false,labAccepted:false,worldIntegrated:false}};
await writeFile(`${baseDir}/catalog.json`,JSON.stringify(candidate,null,2)+'\n');
const presentationBounds={min:bounds.min.map(value=>value*presentationScale),max:bounds.max.map(value=>value*presentationScale)};
const labAsset={id,file:`models/creature/${id}.glb`,pack:'corealm-starred-creatures',category:'character',is:displayName,tags:['creature','demon','humanoid','many-horn','starred-sheet-c','tripo','candidate',tier],bytes:outputBytes.length,sha256:candidateSha256,size:{x:extent[0]*presentationScale,y:extent[1]*presentationScale,z:extent[2]*presentationScale},base:{x:bounds.min[0]*presentationScale,y:bounds.min[1]*presentationScale,z:bounds.min[2]*presentationScale},bounds:presentationBounds,groundY:0,triangles:indices.length/3,animations:required,materials:root.listMaterials().map(m=>m.getName()),presentation:{targetHeightMeters,scaleFactor:presentationScale,neutralGroundedHeightMeters:targetHeightMeters,uniformRootScale:presentationScale,scaleNode:'BrownManyHornDemonArmature'},sourceProvenance:{author:'Corealm candidate rig reconstruction',sourceCardId:part.source.cardStorageUuid,sourceFile:sourcePath,sourceSha256,candidateFile:candidatePath,candidateSha256,rigMethod:candidate.candidate.rig.method,textures:textureMetrics,candidateStatus:'awaiting-root-lab-review'},acceptance:{assetAudit:true,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false}};
await writeFile(`${baseDir}/lab-catalog.json`,JSON.stringify({schema:'corealm-lab-asset-candidates/1',assets:[labAsset]},null,2)+'\n');
console.log(JSON.stringify({candidatePath,vertices:positions.length/3,triangles:indices.length/3,joints:bones.length,clips:required,textureMetrics,maximumWeightSumError:maxWeightSumError,candidateSha256},null,2));
