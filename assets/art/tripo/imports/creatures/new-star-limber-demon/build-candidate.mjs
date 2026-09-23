import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as T from 'three';
import sharp from 'sharp';

const dir = 'assets/art/tripo/imports/creatures/new-star-limber-demon';
const sourcePath = 'assets/art/tripo/exports/acc8f6a7-0d0d-4ae6-8f27-f4e86fb28734.glb';
const candidatePath = `${dir}/gloamreach-harrower-rigged.glb`;
const sourceExpectedHash = '7e3a7fccd31c24b69843009ba285388833403fb67823bb05bbf52735dd926d0b';
const sourceCardStorageUuid = 'b723120e-b183-40db-b613-5514965a2238';
const id = 'creature_gloamreach_harrower';
const displayName = 'Gloamreach Harrower';
const presentationScale = 2;
await mkdir(dir, { recursive: true });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourcePath);
const sourceHash = hash(sourceBytes);
if (sourceHash !== sourceExpectedHash) throw new Error(`Starred Tripo source hash mismatch: ${sourceHash}`);
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const sourceMesh = root.listMeshes()[0];
const primitive = sourceMesh?.listPrimitives()[0];
const meshNode = root.listNodes().find((node) => node.getMesh() === sourceMesh);
const sourceSkin = root.listSkins()[0];
const sourceSkinJointCount = sourceSkin?.listJoints().length ?? 0;
const originalJointWeightCounts = sourceSkin?.listJoints().map((joint) => ({ name: joint.getName(), vertices: 0 })) ?? [];
const originalJointIndices = primitive?.getAttribute('JOINTS_0')?.getArray() ?? [];
const originalWeights = primitive?.getAttribute('WEIGHTS_0')?.getArray() ?? [];
for (let v = 0; v < originalWeights.length / 4; v++) for (let k = 0; k < 4; k++) if (originalWeights[v * 4 + k] > .999) originalJointWeightCounts[originalJointIndices[v * 4 + k]].vertices++;if (!scene || !primitive || !meshNode || !sourceSkin || root.listSkins().length !== 1 || root.listAnimations().length !== 0) throw new Error('Expected the specified single-mesh, single-skin, no-clip Tripo P1 export.');
const positionAttribute = primitive.getAttribute('POSITION');
const normalAttribute = primitive.getAttribute('NORMAL');
const uvAttribute = primitive.getAttribute('TEXCOORD_0');
const sourceIndices = primitive.getIndices();
const positions = Float32Array.from(positionAttribute?.getArray() ?? []);
const normals = Float32Array.from(normalAttribute?.getArray() ?? []);
const uvs = Float32Array.from(uvAttribute?.getArray() ?? []);
const indices = Uint32Array.from(sourceIndices?.getArray() ?? []);
if (!positionAttribute || !normalAttribute || !uvAttribute || !sourceIndices || positions.length / 3 !== 7543 || indices.length / 3 !== 4912 || normals.length !== positions.length || uvs.length / 2 !== positions.length / 3) throw new Error(`Source topology changed: ${positions.length / 3} vertices, ${indices.length / 3} triangles.`);
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let a = 0; a < 3; a++) { bounds.min[a] = Math.min(bounds.min[a], positions[i + a]); bounds.max[a] = Math.max(bounds.max[a], positions[i + a]); }
const sourceMaterial = root.listMaterials()[0];
const textureSlots = { baseColor: sourceMaterial?.getBaseColorTexture(), metallicRoughness: sourceMaterial?.getMetallicRoughnessTexture(), normal: sourceMaterial?.getNormalTexture() };
if (!textureSlots.baseColor || !textureSlots.metallicRoughness || !textureSlots.normal) throw new Error('Source PBR map set is incomplete.');
const sourceMaterialFactors = { baseColor: sourceMaterial.getBaseColorFactor(), metallic: sourceMaterial.getMetallicFactor(), roughness: sourceMaterial.getRoughnessFactor(), normalScale: sourceMaterial.getNormalScale() };
const textures = [];
for (const texture of root.listTextures()) {
  const bytes = texture.getImage();
  const metadata = await sharp(bytes).metadata();
  textures.push({ name: texture.getName(), mime: texture.getMimeType(), width: metadata.width, height: metadata.height, sha256: hash(bytes), slots: Object.entries(textureSlots).filter(([, value]) => value === texture).map(([key]) => key) });
}
if (textures.some((texture) => texture.width > 2048 || texture.height > 2048)) throw new Error(`Unexpected >2K source texture: ${JSON.stringify(textures)}`);

// Tripo's source skin has normalized weights, but 7,459 of 7,543 vertices bind wholly to Hips.
// The exported joint nodes are flattened to zero local transforms; their inverse-bind matrices
// preserve the original anatomical landmarks. Rebuild a compact Unity/Mixamo-mapped rig around
// those landmarks and regenerate distributed weights without changing a mesh vertex or UV.
const sourceBind = new Map();
for (let i = 0; i < sourceSkin.listJoints().length; i++) {
  const joint = sourceSkin.listJoints()[i];
  const inverseBind = new T.Matrix4().fromArray(sourceSkin.getInverseBindMatrices().getArray().slice(i * 16, i * 16 + 16));
  sourceBind.set(joint.getName(), new T.Vector3().setFromMatrixPosition(inverseBind.invert()).toArray());
}
const anchor = (name) => { const value = sourceBind.get(name); if (!value) throw new Error(`Missing Tripo bind landmark ${name}`); return [...value]; };
const leftArmSide = 1; // Source positive-Z arm becomes Unity character-left after +X-to-+Z presentation yaw.
const rightArmSide = -1;
const boneDefs = [
  { name: 'mixamorigHips', parent: null, p: anchor('Hips'), sigma: 0.135, group: 'torso' },
  { name: 'mixamorigSpine', parent: 'mixamorigHips', p: anchor('Spine'), sigma: 0.105, group: 'torso' },
  { name: 'mixamorigSpine1', parent: 'mixamorigSpine', p: anchor('Chest'), sigma: 0.115, group: 'torso' },
  { name: 'mixamorigSpine2', parent: 'mixamorigSpine1', p: anchor('UpperChest'), sigma: 0.115, group: 'torso' },
  { name: 'mixamorigNeck', parent: 'mixamorigSpine2', p: anchor('Neck'), sigma: 0.082, group: 'head' },
  { name: 'mixamorigHead', parent: 'mixamorigNeck', p: anchor('Head'), sigma: 0.105, group: 'head' },
  { name: 'mixamorigLeftShoulder', parent: 'mixamorigSpine2', p: anchor('Right_Shoulder'), sigma: 0.074, group: 'arm', side: leftArmSide },
  { name: 'mixamorigLeftArm', parent: 'mixamorigLeftShoulder', p: anchor('Right_UpperArm'), sigma: 0.076, group: 'arm', side: leftArmSide },
  { name: 'mixamorigLeftForeArm', parent: 'mixamorigLeftArm', p: anchor('Right_LowerArm'), sigma: 0.070, group: 'arm', side: leftArmSide },
  { name: 'mixamorigLeftHand', parent: 'mixamorigLeftForeArm', p: anchor('Right_Hand'), sigma: 0.072, group: 'arm', side: leftArmSide },
  { name: 'mixamorigRightShoulder', parent: 'mixamorigSpine2', p: anchor('Left_Shoulder'), sigma: 0.074, group: 'arm', side: rightArmSide },
  { name: 'mixamorigRightArm', parent: 'mixamorigRightShoulder', p: anchor('Left_UpperArm'), sigma: 0.076, group: 'arm', side: rightArmSide },
  { name: 'mixamorigRightForeArm', parent: 'mixamorigRightArm', p: anchor('Left_LowerArm'), sigma: 0.070, group: 'arm', side: rightArmSide },
  { name: 'mixamorigRightHand', parent: 'mixamorigRightForeArm', p: anchor('Left_Hand'), sigma: 0.072, group: 'arm', side: rightArmSide },
  { name: 'mixamorigLeftUpLeg', parent: 'mixamorigHips', p: anchor('Right_UpperLeg'), sigma: 0.074, group: 'leg', side: leftArmSide },
  { name: 'mixamorigLeftLeg', parent: 'mixamorigLeftUpLeg', p: anchor('Right_LowerLeg'), sigma: 0.072, group: 'leg', side: leftArmSide },
  { name: 'mixamorigLeftFoot', parent: 'mixamorigLeftLeg', p: anchor('Right_Foot'), sigma: 0.060, group: 'foot', side: leftArmSide },
  { name: 'mixamorigLeftToeBase', parent: 'mixamorigLeftFoot', p: anchor('Right_Toes'), sigma: 0.052, group: 'foot', side: leftArmSide },
  { name: 'mixamorigRightUpLeg', parent: 'mixamorigHips', p: anchor('Left_UpperLeg'), sigma: 0.074, group: 'leg', side: rightArmSide },
  { name: 'mixamorigRightLeg', parent: 'mixamorigRightUpLeg', p: anchor('Left_LowerLeg'), sigma: 0.072, group: 'leg', side: rightArmSide },
  { name: 'mixamorigRightFoot', parent: 'mixamorigRightLeg', p: anchor('Left_Foot'), sigma: 0.060, group: 'foot', side: rightArmSide },
  { name: 'mixamorigRightToeBase', parent: 'mixamorigRightFoot', p: anchor('Left_Toes'), sigma: 0.052, group: 'foot', side: rightArmSide },
];
const boneByName = new Map(boneDefs.map((bone, index) => [bone.name, { ...bone, index }]));
for (const bone of boneDefs) { const parent = bone.parent ? boneByName.get(bone.parent) : null; bone.local = parent ? bone.p.map((v, a) => v - parent.p[a]) : [...bone.p]; }
const oldSkin = sourceSkin;
const armature = meshNode.getParentNode();
if (!armature || armature.getName() !== 'Armature') throw new Error('Unexpected source mesh parent.');
for (const child of [...armature.listChildren()]) if (child !== meshNode) armature.removeChild(child);
scene.removeChild(armature);
meshNode.setSkin(null).setName('GloamreachHarrowerMesh').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
oldSkin.dispose();
const groundNode = doc.createNode('GloamreachHarrowerGround').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
const presentation = doc.createNode('GloamreachHarrowerPresentation').setTranslation([0, 0, 0]).setRotation([0, -Math.SQRT1_2, 0, Math.SQRT1_2]).setScale([presentationScale, presentationScale, presentationScale]);
armature.setName('GloamreachHarrowerArmature').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
scene.addChild(groundNode); groundNode.addChild(presentation); presentation.addChild(armature); armature.addChild(meshNode);
const joints = new Map();
for (const bone of boneDefs) {
  const joint = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  joints.set(bone.name, joint);
  (bone.parent ? joints.get(bone.parent) : armature).addChild(joint);
}
const newSkin = doc.createSkin('GloamreachHarrower_UnityHumanoid').setSkeleton(joints.get('mixamorigHips'));
for (const bone of boneDefs) newSkin.addJoint(joints.get(bone.name));
const inverseBinds = new Float32Array(boneDefs.length * 16);
for (let i = 0; i < boneDefs.length; i++) { const [x,y,z] = boneDefs[i].p; inverseBinds.set([1,0,0,0, 0,1,0,0, 0,0,1,0, -x,-y,-z,1], i * 16); }
const buffer = root.listBuffers()[0];
newSkin.setInverseBindMatrices(doc.createAccessor('GloamreachHarrower_InverseBind').setArray(inverseBinds).setType(Accessor.Type.MAT4).setBuffer(buffer));
meshNode.setSkin(newSkin);

function segmentDistance(p, a, b) { const v=b.map((x,i)=>x-a[i]), len2=v.reduce((s,x)=>s+x*x,0)||1, t=Math.max(0,Math.min(1,p.reduce((s,x,i)=>s+(x-a[i])*v[i],0)/len2)); return Math.hypot(...p.map((x,i)=>x-a[i]-v[i]*t)); }
function smoothstep(a,b,x) { const t=T.MathUtils.clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); }
const jointValues = new Uint16Array(positions.length / 3 * 4);
const weightValues = new Float32Array(positions.length / 3 * 4);
const influenceCounts = new Uint32Array(boneDefs.length);
let maxWeightSumError = 0;
let multiInfluenceVertices = 0;
for (let vertex=0; vertex<positions.length/3; vertex++) {
  const point=[positions[vertex*3],positions[vertex*3+1],positions[vertex*3+2]], y=point[1], z=point[2], scores=[];
  for (const bone of boneDefs) {
    let gate=1;
    if (bone.group==='head') gate=smoothstep(.585,.70,y);
    if (bone.group==='arm') {
      const outward=bone.side*z;
      gate=smoothstep(-.035,.105,outward)*(1-smoothstep(.70,.83,y))*smoothstep(.39,.52,y);
    }
    if (bone.group==='leg' || bone.group==='foot') {
      const outward=bone.side*z;
      gate=smoothstep(.50,.36,y)*smoothstep(-.01,.09,outward);
    }
    const parent=bone.parent?boneByName.get(bone.parent):null;
    const distance=segmentDistance(point,parent?.p??bone.p,bone.p);
    const score=gate*Math.exp(-.5*(distance/bone.sigma)**2);
    if(score>1e-12)scores.push({index:boneByName.get(bone.name).index,score});
  }
  scores.sort((a,b)=>b.score-a.score);
  let chosen=scores.slice(0,4);
  if(!chosen.length){let closest=Infinity,best=0;for(const bone of boneDefs){const parent=bone.parent?boneByName.get(bone.parent):null,d=segmentDistance(point,parent?.p??bone.p,bone.p);if(d<closest){closest=d;best=boneByName.get(bone.name).index;}}chosen=[{index:best,score:1}];}
  const total=chosen.reduce((s,x)=>s+x.score,0);let assigned=0,nonzero=0;
  for(let slot=0;slot<4;slot++){const candidate=chosen[slot]??chosen[0],weight=slot>=chosen.length?0:slot===chosen.length-1?1-assigned:candidate.score/total;jointValues[vertex*4+slot]=candidate.index;weightValues[vertex*4+slot]=weight;assigned+=weight;if(weight>1e-6){influenceCounts[candidate.index]++;nonzero++;}}
  if(nonzero>1)multiInfluenceVertices++;
  maxWeightSumError=Math.max(maxWeightSumError,Math.abs(assigned-1));
}
primitive.setAttribute('JOINTS_0',doc.createAccessor('GloamreachHarrower_Joints0').setArray(jointValues).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0',doc.createAccessor('GloamreachHarrower_Weights0').setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(buffer));

const quat=(axis,angle)=>{const s=Math.sin(angle/2),c=Math.cos(angle/2);return axis==='x'?[s,0,0,c]:axis==='y'?[0,s,0,c]:[0,0,s,c];};
const clips=[];
function addClip(name,seconds,tracks){const animation=doc.createAnimation(name);for(const track of tracks){const input=doc.createAccessor(`${name}_${track.node}_time`).setArray(Float32Array.from(track.times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);const output=doc.createAccessor(`${name}_${track.node}_${track.path??'rotation'}_value`).setArray(Float32Array.from(track.values.flat())).setType(track.path==='translation'?Accessor.Type.VEC3:Accessor.Type.VEC4).setBuffer(buffer);const sampler=doc.createAnimationSampler(`${name}_${track.node}`).setInput(input).setOutput(output).setInterpolation('LINEAR');animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${name}_${track.node}_${track.path??'rotation'}`).setTargetNode(track.node==='__ground'?groundNode:joints.get(track.node)).setTargetPath(track.path??(track.node==='__ground'?'translation':'rotation')).setSampler(sampler));}clips.push({name,seconds,channels:tracks.length});}
const cycle=[0,.25,.5,.75,1];
const cyclic=(phase,axis,amount)=>cycle.map(t=>quat(axis,Math.sin((t+phase)*Math.PI*2)*amount));
const hp=boneDefs.find((bone)=>bone.name==='mixamorigHips').local;
const hips=(bob,forward=0)=>cycle.map((t,i)=>[hp[0]+(i===1||i===2?forward:0),hp[1]+(i===1||i===3?bob:0),hp[2]]);
addClip('Idle',3.2,[
 {node:'mixamorigSpine1',times:[0,.8,1.6,2.4,3.2],values:[0,.013,0,-.013,0].map(a=>quat('z',a))},
 {node:'mixamorigSpine2',times:[0,.8,1.6,2.4,3.2],values:[0,-.014,0,.014,0].map(a=>quat('x',a))},
 {node:'mixamorigHead',times:[0,.8,1.6,2.4,3.2],values:[-.025,.01,.04,-.005,-.025].map(a=>quat('y',a))},
 {node:'mixamorigLeftForeArm',times:[0,.8,1.6,2.4,3.2],values:[0,.035,0,-.025,0].map(a=>quat('x',a))},
 {node:'mixamorigRightForeArm',times:[0,.8,1.6,2.4,3.2],values:[0,-.03,0,.04,0].map(a=>quat('x',a))},
]);
for(const [name,duration,leg,arm,bob] of [['Walk',1.12,.31,.17,.012],['Run',.76,.59,.36,.025]])addClip(name,duration,[
 {node:'mixamorigHips',path:'translation',times:cycle.map(t=>t*duration),values:hips(bob)},
 {node:'mixamorigLeftUpLeg',times:cycle.map(t=>t*duration),values:cyclic(0,'z',leg)},
 {node:'mixamorigRightUpLeg',times:cycle.map(t=>t*duration),values:cyclic(.5,'z',leg)},
 {node:'mixamorigLeftLeg',times:cycle.map(t=>t*duration),values:cycle.map(t=>quat('z',-.10-Math.max(0,Math.sin(t*2*Math.PI))*leg*.55))},
 {node:'mixamorigRightLeg',times:cycle.map(t=>t*duration),values:cycle.map(t=>quat('z',-.10-Math.max(0,Math.sin((t+.5)*2*Math.PI))*leg*.55))},
 {node:'mixamorigLeftArm',times:cycle.map(t=>t*duration),values:cyclic(.5,'y',arm)},
 {node:'mixamorigRightArm',times:cycle.map(t=>t*duration),values:cyclic(0,'y',arm)},
 {node:'mixamorigLeftForeArm',times:cycle.map(t=>t*duration),values:cycle.map(t=>quat('x',-.18+Math.max(0,Math.sin((t+.5)*2*Math.PI))*.13))},
 {node:'mixamorigRightForeArm',times:cycle.map(t=>t*duration),values:cycle.map(t=>quat('x',-.18+Math.max(0,Math.sin(t*2*Math.PI))*.13))},
 {node:'mixamorigSpine1',times:cycle.map(t=>t*duration),values:cycle.map(t=>quat('z',Math.sin(t*2*Math.PI)*.025))},
]);
addClip('Attack',1.02,[
 {node:'mixamorigHips',path:'translation',times:[0,.18,.46,.68,1.02],values:[[hp[0],hp[1],hp[2]],[hp[0],hp[1]-.045,hp[2]],[hp[0]+.055,hp[1]-.025,hp[2]],[hp[0]+.025,hp[1],hp[2]],[hp[0],hp[1],hp[2]]]},
 {node:'mixamorigSpine1',times:[0,.18,.46,.68,1.02],values:[0,-.18,.20,.08,0].map(a=>quat('y',a))},
 {node:'mixamorigSpine2',times:[0,.18,.46,.68,1.02],values:[0,-.10,.12,.04,0].map(a=>quat('z',a))},
 {node:'mixamorigLeftArm',times:[0,.18,.46,.68,1.02],values:[0,.88,-.20,-.25,0].map(a=>quat('y',a))},
 {node:'mixamorigLeftForeArm',times:[0,.18,.46,.68,1.02],values:[0,.30,-.72,-.35,0].map(a=>quat('x',a))},
 {node:'mixamorigRightArm',times:[0,.18,.46,.68,1.02],values:[0,-.16,-.28,.10,0].map(a=>quat('y',a))},
 {node:'mixamorigRightForeArm',times:[0,.18,.46,.68,1.02],values:[0,.12,-.18,-.12,0].map(a=>quat('x',a))},
]);
addClip('Hit',.52,[
 {node:'mixamorigHips',path:'translation',times:[0,.07,.21,.52],values:[[hp[0],hp[1],hp[2]],[hp[0]-.025,hp[1]-.018,hp[2]],[hp[0]-.012,hp[1],hp[2]],[hp[0],hp[1],hp[2]]]},
 {node:'mixamorigSpine1',times:[0,.07,.21,.52],values:[0,.24,-.08,0].map(a=>quat('z',a))},
 {node:'mixamorigSpine2',times:[0,.07,.21,.52],values:[0,-.18,.06,0].map(a=>quat('y',a))},
 {node:'mixamorigHead',times:[0,.07,.21,.52],values:[0,.18,-.04,0].map(a=>quat('z',a))},
 {node:'mixamorigLeftArm',times:[0,.07,.21,.52],values:[0,-.28,.08,0].map(a=>quat('y',a))},
 {node:'mixamorigRightArm',times:[0,.07,.21,.52],values:[0,.28,-.08,0].map(a=>quat('y',a))},
]);
addClip('Death',1.75,[
 {node:'mixamorigHips',path:'translation',times:[0,.22,.66,1.18,1.75],values:[[hp[0],hp[1],hp[2]],[hp[0]-.01,hp[1]-.14,hp[2]],[hp[0]-.04,.10,hp[2]],[hp[0]-.07,.06,hp[2]],[hp[0]-.07,.06,hp[2]]]},
 {node:'mixamorigHips',times:[0,.22,.66,1.18,1.75],values:[0,-.30,-.92,-1.18,-1.18].map(a=>quat('z',a))},
 {node:'mixamorigSpine1',times:[0,.22,.66,1.18,1.75],values:[0,.08,.20,.16,.16].map(a=>quat('x',a))},
 {node:'mixamorigSpine2',times:[0,.22,.66,1.18,1.75],values:[0,.10,.16,.12,.12].map(a=>quat('z',a))},
 {node:'mixamorigHead',times:[0,.22,.66,1.18,1.75],values:[0,.13,.31,.38,.38].map(a=>quat('z',a))},
 {node:'mixamorigLeftArm',times:[0,.22,.66,1.18,1.75],values:[0,.20,.68,.75,.75].map(a=>quat('y',a))},
 {node:'mixamorigRightArm',times:[0,.22,.66,1.18,1.75],values:[0,-.17,-.55,-.62,-.62].map(a=>quat('y',a))},
 {node:'mixamorigLeftUpLeg',times:[0,.22,.66,1.18,1.75],values:[0,-.06,-.23,-.27,-.27].map(a=>quat('z',a))},
 {node:'mixamorigRightUpLeg',times:[0,.22,.66,1.18,1.75],values:[0,.06,.24,.29,.29].map(a=>quat('z',a))},
]);

const loader = new GLTFLoader();
async function loadScene(bytes) { const probeDoc=await io.readBinary(bytes); for(const mat of probeDoc.getRoot().listMaterials()) mat.setBaseColorTexture(null).setMetallicRoughnessTexture(null).setNormalTexture(null).setEmissiveTexture(null).setOcclusionTexture(null); await probeDoc.transform(prune()); const probeBytes=await io.writeBinary(probeDoc); globalThis.self=globalThis; const ab=probeBytes.buffer.slice(probeBytes.byteOffset,probeBytes.byteOffset+probeBytes.byteLength); return await new Promise((resolve,reject)=>loader.parse(ab,'',resolve,reject)); }
function poseAndBounds(gltf,clip,seconds){const mixer=new T.AnimationMixer(gltf.scene);mixer.stopAllAction();const action=mixer.clipAction(clip).setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();mixer.setTime(seconds);gltf.scene.updateMatrixWorld(true);let minY=Infinity,maxY=-Infinity,maxTravel=0,seen=[];const v=new T.Vector3();for(const object of gltf.scene.children.flatMap(function walk(n){return [n,...n.children.flatMap(walk)];})){if(!object.isSkinnedMesh)continue;for(let i=0;i<object.geometry.attributes.position.count;i++){object.getVertexPosition(i,v);v.applyMatrix4(object.matrixWorld);minY=Math.min(minY,v.y);maxY=Math.max(maxY,v.y);if(i%13===0)seen.push(v.clone());}}return {minY,maxY,seen};}
async function makeFloorTracks(bytes){const gltf=await loadScene(bytes), rows=[];for(const clip of gltf.animations){const count=Math.max(2,Math.ceil(clip.duration*60));const times=[],values=[];let maximum=0;for(let i=0;i<=count;i++){const t=clip.duration*i/count;const bounds=poseAndBounds(gltf,clip,t);const lift=Math.max(0,.006-bounds.minY);maximum=Math.max(maximum,lift);times.push(t);values.push(0,lift,0);}rows.push({clip:clip.name,times,values,maximum});}return rows;}
function addGroundTracks(rows){for(const row of rows){const animation=root.listAnimations().find((a)=>a.getName()===row.clip);const sampler=doc.createAnimationSampler(`${row.clip}_ground`).setInput(doc.createAccessor(`${row.clip}_ground_time`).setType(Accessor.Type.SCALAR).setArray(Float32Array.from(row.times)).setBuffer(buffer)).setOutput(doc.createAccessor(`${row.clip}_ground_translation`).setType(Accessor.Type.VEC3).setArray(Float32Array.from(row.values)).setBuffer(buffer)).setInterpolation('LINEAR');animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${row.clip}_floor_ground`).setTargetNode(groundNode).setTargetPath('translation').setSampler(sampler));}}

// First write an internal probe, then bake just enough root lift into each clip to keep the
// original feet on the ground at the doubled presentation scale. This does not change skinning.
await doc.transform(prune());
let probe = await io.writeBinary(doc);
const floorRows = await makeFloorTracks(probe);
addGroundTracks(floorRows);
await doc.transform(prune());
const output=await io.writeBinary(doc);
await writeFile(candidatePath,output);
const candidateHash=hash(output);
const check=(await io.readBinary(output)).getRoot();
const checkPrimitive=check.listMeshes()[0].listPrimitives()[0];
const checked={positions:checkPrimitive.getAttribute('POSITION')?.getArray(),normals:checkPrimitive.getAttribute('NORMAL')?.getArray(),uvs:checkPrimitive.getAttribute('TEXCOORD_0')?.getArray(),indices:checkPrimitive.getIndices()?.getArray()};
for(const [key,expected]of Object.entries({positions,normals,uvs,indices}))if(!checked[key]||checked[key].length!==expected.length||checked[key].some((value,i)=>value!==expected[i]))throw new Error(`${key} changed during candidate export.`);
if(check.listSkins().length!==1||check.listSkins()[0].listJoints().length!==boneDefs.length)throw new Error('Unity skin is missing or incomplete.');
const checkJoints=checkPrimitive.getAttribute('JOINTS_0')?.getArray(),checkWeights=checkPrimitive.getAttribute('WEIGHTS_0')?.getArray();if(!checkJoints||!checkWeights)throw new Error('Skinning attributes did not survive GLB export.');
let maxSumError=0;for(let v=0;v<positions.length/3;v++){let sum=0;for(let k=0;k<4;k++){const j=checkJoints[v*4+k],w=checkWeights[v*4+k];if(!Number.isInteger(j)||j<0||j>=boneDefs.length||!Number.isFinite(w)||w<0)throw new Error(`Invalid skin influence at vertex ${v}.`);sum+=w;}maxSumError=Math.max(maxSumError,Math.abs(1-sum));}if(maxSumError>1e-5||multiInfluenceVertices<positions.length/3*.7)throw new Error(`Skin quality failed: max sum error ${maxSumError}; distributed ${multiInfluenceVertices}/${positions.length/3}.`);
const checksTextures=[];for(const texture of check.listTextures()){const original=textures.find((x)=>x.name===texture.getName());if(!original||hash(texture.getImage())!==original.sha256)throw new Error(`PBR map changed: ${texture.getName()}`);checksTextures.push({...original,bytes:texture.getImage().length});}
const finalGltf=await loadScene(output),motionRows=[];for(const clip of finalGltf.animations){if(!['Idle','Walk','Run','Attack','Hit','Death'].includes(clip.name))throw new Error(`Unexpected clip ${clip.name}`);const n=Math.max(12,Math.ceil(clip.duration*60));let minY=Infinity,maxY=-Infinity,motion=0,first=null;for(let i=0;i<=n;i++){const t=clip.duration*i/n,pose=poseAndBounds(finalGltf,clip,t);minY=Math.min(minY,pose.minY);maxY=Math.max(maxY,pose.maxY);if(!first)first=pose.seen;else for(let j=0;j<Math.min(first.length,pose.seen.length);j++)motion=Math.max(motion,first[j].distanceTo(pose.seen[j]));}if(motion<.012)throw new Error(`${clip.name} has no visible skeletal/root motion (${motion}).`);if(minY<-.008)throw new Error(`${clip.name} penetrates floor (${minY}).`);motionRows.push({name:clip.name,seconds:clip.duration,minimumWorldY:minY,maximumWorldY:maxY,maximumGroundLift:floorRows.find(x=>x.clip===clip.name).maximum,visibleSampledMotion:motion});}
if(motionRows.length!==6)throw new Error(`Expected six clips, got ${motionRows.length}.`);
const scaledSize={x:(bounds.max[2]-bounds.min[2])*presentationScale,y:(bounds.max[1]-bounds.min[1])*presentationScale,z:(bounds.max[0]-bounds.min[0])*presentationScale};
const scaledBounds={min:[-bounds.max[2]*presentationScale,bounds.min[1]*presentationScale,bounds.min[0]*presentationScale],max:[-bounds.min[2]*presentationScale,bounds.max[1]*presentationScale,bounds.max[0]*presentationScale]};const rig={type:'Unity Humanoid compatible glTF skin with Mixamo bone names',joints:boneDefs.map(x=>({name:x.name,parent:x.parent,bindPosition:x.p})),influencesPerVertex:4,verticesWithDistributedWeights:multiInfluenceVertices,maximumWeightSumError:maxWeightSumError,method:'Recover Tripo anatomical landmarks from inverse-bind matrices, rebuild a compact Mixamo-named humanoid, then assign four normalized influences by model-local landmark segment distance with separate left/right arm and leg gates.',sourceRigRepair:'Tripo nodes were flattened to zero transforms and 7,459/7,543 source vertices were rigidly bound to Hips. Reconstructed fresh bind matrices and model-specific distributed weights.'};
const candidate={schema:'corealm-creature-native-rig-candidate/1',id,displayName,status:'awaiting-root-lab-review',accepted:false,source:{file:sourcePath,sha256:sourceHash,bytes:sourceBytes.length,modelSource:'Tripo P1, user-starred',tripoCardStorageUuid:sourceCardStorageUuid,geometry:{vertices:positions.length/3,triangles:indices.length/3,positionsPreserved:true,normalsPreserved:true,uvsPreserved:true,indicesPreserved:true,retopology:false},sourceSkin:{joints:sourceSkinJointCount,animations:0,weightsWithFullHipsInfluence:originalJointWeightCounts.find(x=>x.name==='Hips')?.vertices},textures,materialFactors:sourceMaterialFactors},candidate:{file:candidatePath,sha256:candidateHash,bytes:output.length,productionTarget:`game/public/assets/models/creature/${id}.glb`,presentation:{scale:presentationScale,sourceForwardAxis:'+X',unityForwardAxis:'+Z',yawRadians:-Math.PI/2,size:scaledSize,groundCorrection:'60 Hz sampled per-clip root translation; preserves floor contact during custom motion'},rig,textures:checksTextures,animations:motionRows},acceptance:{sourceDesignAudit:false,geometry:true,rig:false,animation:false,textures:false,labAccepted:false,worldIntegrated:false}};
await writeFile(`${dir}/catalog.json`,JSON.stringify(candidate,null,2)+'\n');
const lab={id,file:`models/creature/${id}.glb`,pack:'corealm-new-starred-creatures',category:'character',is:displayName,tags:['creature','humanoid','demon','wilderness','starred','tripo','candidate'],bytes:output.length,sha256:candidateHash,size:scaledSize,base:{x:scaledBounds.min[0],y:scaledBounds.min[1],z:scaledBounds.min[2]},bounds:scaledBounds,groundY:0,triangles:indices.length/3,animations:motionRows.map(x=>x.name),materials:check.listMaterials().map(x=>x.getName()),sourceProvenance:{author:'Corealm candidate rig reconstruction',sourceFile:sourcePath,sourceSha256:sourceHash,cardStorageUuid:sourceCardStorageUuid,candidateFile:candidatePath,candidateSha256:candidateHash,rigMethod:rig.method,textures:checksTextures,candidateStatus:'awaiting-root-lab-review'},acceptance:{assetAudit:true,sourceDesignAudit:false,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false}};
await writeFile(`${dir}/lab-catalog.json`,JSON.stringify({schema:'corealm-lab-asset-candidates/1',assets:[lab]},null,2)+'\n');
console.log(JSON.stringify({id,displayName,candidateFile:candidatePath,candidateHash,bytes:output.length,sourceHash,vertices:positions.length/3,triangles:indices.length/3,joints:boneDefs.length,distributedVertices:multiInfluenceVertices,textureMaps:checksTextures.map(x=>({name:x.name,width:x.width,height:x.height,sha256:x.sha256})),animations:motionRows},null,2));
