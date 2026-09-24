import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import * as THREE from 'three';

const dir = 'assets/art/tripo/imports/creatures/audit-user-hollow-bough';
const sourceFile = `${dir}/sources/tree-humanoid-user-original.glb`;
const candidateFile = `${dir}/creature_hollow_bough.glb`;
const sha = b => createHash('sha256').update(b).digest('hex');
const sourceBytes = await readFile(sourceFile);
const sourceSha256 = '95b9f687b3a3209de01c2deebb1e34b571974bbd2ebb9ecdcf5734cc5b4864e4';
if (sha(sourceBytes) !== sourceSha256) throw new Error('User source changed');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.readBinary(sourceBytes), root = doc.getRoot();
const mesh = root.listMeshes()[0], primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find(n => n.getMesh() === mesh);
const positions = primitive?.getAttribute('POSITION')?.getArray();
if (!meshNode || !positions || positions.length !== 7492 * 3 || primitive.getIndices()?.getCount() !== 4771 * 3 || root.listSkins().length || root.listAnimations().length) throw new Error('Unexpected static source topology');
const material = primitive.getMaterial();
if (!material?.getBaseColorTexture() || !material.getNormalTexture() || !material.getMetallicRoughnessTexture()) throw new Error('Source PBR maps missing');
const sourceTextures = [];
for (const tex of root.listTextures()) {
  const bytes = tex.getImage(), meta = await sharp(bytes).metadata();
  sourceTextures.push({ name: tex.getName(), width: meta.width, height: meta.height, bytes: bytes.length, sha256: sha(bytes) });
  const role = tex === material.getBaseColorTexture() ? 'basecolor' : tex === material.getNormalTexture() ? 'normal' : 'roughness-metallic';
  const target = role === 'basecolor' ? 2048 : 1024;
  const resized = await sharp(bytes).resize(target, target, { fit: 'fill', kernel: role === 'roughness-metallic' ? 'cubic' : 'lanczos3' }).jpeg({ quality: role === 'basecolor' ? 86 : 88, mozjpeg: true }).toBuffer();
  tex.setImage(resized).setMimeType('image/jpeg').setName(`hollow-bough-${role}-${target}`);
}
// Tripo source is Y-up, branch arms along Z and the face looks along X.
// Native geometry, UVs, normals, indices and all three mapped material roles remain intact.
// A parent scale gives the 0.822 m source a 2.67 m model-space stature.
const nativeScale = 3.25;
meshNode.setName('HollowBoughMesh');
const container = doc.createNode('HollowBough').setScale([nativeScale, nativeScale, nativeScale]).setRotation([0,-Math.SQRT1_2,0,Math.SQRT1_2]);
root.listScenes()[0].addChild(container);
root.listScenes()[0].removeChild(meshNode);
container.addChild(meshNode);

const specs = [
  ['Root',null,[0,0,0],'root'],
  ['Pelvis','Root',[0,.285,0],'torso'],
  ['LowerTrunk','Pelvis',[0,.37,0],'torso'],
  ['Chest','LowerTrunk',[0,.49,0],'torso'],
  ['Neck','Chest',[0,.625,0],'torso'],
  ['Crown','Neck',[0,.735,0],'crown'],
  ['Shoulder_L','Chest',[0,.56,-.16],'armL'],
  ['Elbow_L','Shoulder_L',[0,.53,-.305],'armL'],
  ['Wrist_L','Elbow_L',[0,.50,-.435],'armL'],
  ['Shoulder_R','Chest',[0,.56,.16],'armR'],
  ['Elbow_R','Shoulder_R',[0,.53,.305],'armR'],
  ['Wrist_R','Elbow_R',[0,.50,.435],'armR'],
  ['Hip_L','Pelvis',[0,.28,-.07],'legL'],
  ['Knee_L','Hip_L',[0,.14,-.09],'legL'],
  ['Foot_L','Knee_L',[0,.025,-.105],'legL'],
  ['Hip_R','Pelvis',[0,.28,.07],'legR'],
  ['Knee_R','Hip_R',[0,.14,.09],'legR'],
  ['Foot_R','Knee_R',[0,.025,.105],'legR'],
];
const bones = specs.map(([name,parent,p,group])=>({name,parent,p,group}));
const byName = new Map(bones.map((b,i)=>[b.name,i]));
const jointNodes = new Map();
for(const b of bones){
  const parent = b.parent ? bones[byName.get(b.parent)] : null;
  const local = parent ? b.p.map((v,i)=>v-parent.p[i]) : b.p;
  const n = doc.createNode(b.name).setTranslation(local);
  jointNodes.set(b.name,n);
  (b.parent ? jointNodes.get(b.parent) : container).addChild(n);
}
const skin = doc.createSkin('HollowBoughAnatomical').setSkeleton(jointNodes.get('Root'));
for(const b of bones) skin.addJoint(jointNodes.get(b.name));
const buffer = root.listBuffers()[0];
const ibm = new Float32Array(bones.length*16);
for(let i=0;i<bones.length;i++){
  const [x,y,z]=bones[i].p;
  ibm.set([1,0,0,0,0,1,0,0,0,0,1,0,-x,-y,-z,1],i*16);
}
skin.setInverseBindMatrices(doc.createAccessor('inverseBind').setArray(ibm).setType(Accessor.Type.MAT4).setBuffer(buffer));
meshNode.setSkin(skin);
const joints = new Uint16Array(7492*4), weights = new Float32Array(7492*4), influence = new Array(bones.length).fill(0);
for(let i=0;i<7492;i++){
  const x=positions[i*3], y=positions[i*3+1], z=positions[i*3+2];
  let group='torso';
  if(y>.61) group='crown';
  if(y<.34 && Math.abs(z)>.038) group=z<0?'legL':'legR';
  if(y>.40 && Math.abs(z)>.135) group=z<0?'armL':'armR';
  const candidates=[];
  for(let k=1;k<bones.length;k++){
    const b=bones[k];
    if(b.group!==group && !(group==='crown'&&b.group==='torso') && !(group==='torso'&&b.group==='crown') && !(group.startsWith('arm')&&b.group==='torso'&&Math.abs(z)<.23) && !(group.startsWith('leg')&&b.group==='torso'&&y>.24))continue;
    const d=Math.hypot(x-b.p[0],y-b.p[1],z-b.p[2]);
    const sigma=b.group==='torso'?.095:b.group==='crown'?.11:.08;
    const score=Math.exp(-.5*(d/sigma)**2);
    candidates.push({k,score});
  }
  candidates.sort((a,b)=>b.score-a.score);
  const top=candidates.slice(0,4), sum=top.reduce((a,b)=>a+b.score,0);
  if(!top.length||sum<1e-12)throw new Error(`Unweighted vertex ${i}`);
  let used=0;
  top.forEach((c,j)=>{const w=j===top.length-1?1-used:c.score/sum;joints[i*4+j]=c.k;weights[i*4+j]=w;used+=w;influence[c.k]++;});
}
primitive.setAttribute('JOINTS_0',doc.createAccessor('joints').setArray(joints).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0',doc.createAccessor('weights').setArray(weights).setType(Accessor.Type.VEC4).setBuffer(buffer));

const q=(axis,angle)=>new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis),angle).toArray();
const X=[1,0,0], Y=[0,1,0], Z=[0,0,1], identity=[0,0,0,1];
// The static Tripo body is T-posed. Bend each branch down from its shoulder,
// then swing about Y so the opposite arm counters each root-leg stride.
const branch=(side,swing=0,drop=.62)=>new THREE.Quaternion(...q(X,side==='L'?-drop:drop)).multiply(new THREE.Quaternion(...q(Y,swing))).toArray();
const clips=[];
function makeClip(name,duration,tracks){
  const a=doc.createAnimation(name);
  for(const {joint,path='rotation',times,values} of tracks){
    if(times.length!==values.length)throw new Error('Track length mismatch');
    const inp=doc.createAccessor(`${name}_${joint}_${path}_t`).setArray(Float32Array.from(times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const out=doc.createAccessor(`${name}_${joint}_${path}_v`).setArray(Float32Array.from(values.flat())).setType(path==='translation'?Accessor.Type.VEC3:Accessor.Type.VEC4).setBuffer(buffer);
    const sampler=doc.createAnimationSampler().setInput(inp).setOutput(out).setInterpolation('LINEAR');
    a.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(jointNodes.get(joint)).setTargetPath(path).setSampler(sampler));
  }
  clips.push({name,seconds:duration,channels:tracks.length});
}
const tr=(joint,times,fn,path='rotation')=>({joint,path,times,values:times.map(fn)});
const wave=(t,d,phase=0)=>Math.sin((t/d+phase)*Math.PI*2);
const idle=[0,.6,1.2,1.8,2.4];
makeClip('Idle',2.4,[tr('LowerTrunk',idle,t=>q(X,.025*wave(t,2.4))),tr('Crown',idle,t=>q(X,-.05*wave(t,2.4))),tr('Shoulder_L',idle,t=>branch('L',.035*wave(t,2.4))),tr('Shoulder_R',idle,t=>branch('R',-.035*wave(t,2.4)))]);
for(const [name,d,stride,knee,bob] of [['Walk',1.18,.32,.25,.028],['Run',.78,.57,.46,.042]]){
  const times=Array.from({length:9},(_,i)=>d*i/8);
  makeClip(name,d,[
    tr('Root',times,t=>[0,bob*(1-Math.cos(4*Math.PI*t/d))/2,0],'translation'),
    tr('Hip_L',times,t=>q(Z,stride*wave(t,d))),tr('Hip_R',times,t=>q(Z,-stride*wave(t,d))),
    tr('Knee_L',times,t=>q(Z,-knee*Math.max(0,wave(t,d)))),tr('Knee_R',times,t=>q(Z,-knee*Math.max(0,-wave(t,d)))),
    tr('Shoulder_L',times,t=>branch('L',stride*.88*wave(t,d))),tr('Shoulder_R',times,t=>branch('R',stride*.88*wave(t,d))),
    tr('Chest',times,t=>q(Y,.04*wave(t,d))),tr('Crown',times,t=>q(X,.03*wave(t,d)))
  ]);
}
const at=[0,.18,.34,.52,.73,1.02,1.2];
makeClip('Attack',1.2,[
  tr('Root',at,(_,i)=>[[0,0,0],[-.01,.005,0],[-.04,.00,0],[.11,.018,0],[.05,.015,0],[0,0,0],[0,0,0]][i],'translation'),
  tr('Chest',at,(_,i)=>q(Z,[0,.10,.20,-.27,-.10,0,0][i])),
  tr('Shoulder_R',at,(_,i)=>branch('R',[0,-.18,-.36,.70,.38,.06,0][i])),
  tr('Elbow_R',at,(_,i)=>q(Y,[0,-.12,-.30,.48,.20,0,0][i])),
  tr('Shoulder_L',at,(_,i)=>branch('L',[0,.10,.18,-.10,-.04,0,0][i])),
  tr('Crown',at,(_,i)=>q(Z,[0,-.04,-.08,.12,.05,0,0][i]))
]);
const ht=[0,.12,.25,.48];
makeClip('Hit',.48,[tr('Root',ht,(_,i)=>[[0,0,0],[-.035,.00,0],[-.012,.00,0],[0,0,0]][i],'translation'),tr('Chest',ht,(_,i)=>q(Z,[0,.20,-.05,0][i])),tr('Crown',ht,(_,i)=>q(Z,[0,.16,-.04,0][i])),tr('Shoulder_R',ht,(_,i)=>branch('R',0,.62+[0,.12,.03,0][i])),tr('Shoulder_L',ht,(_,i)=>branch('L',0,.62+[0,.12,.03,0][i]))]);
const dt=[0,.2,.46,.75,1.1,1.5];
makeClip('Death',1.5,[
  tr('Pelvis',dt,(_,i)=>q(Z,[0,.13,.48,1.06,1.42,1.42][i])),
  tr('Root',dt,(_,i)=>[[0,0,0],[.015,.015,0],[.06,.015,0],[.15,-.045,0],[.20,-.12,0],[.20,-.12,0]][i],'translation'),
  tr('Chest',dt,(_,i)=>q(Z,[0,.02,.09,.18,.22,.22][i])),
  tr('Crown',dt,(_,i)=>q(Z,[0,0,.06,.11,.14,.14][i])),
  tr('Hip_L',dt,(_,i)=>q(Z,[0,-.04,-.15,-.35,-.55,-.55][i])),
  tr('Hip_R',dt,(_,i)=>q(Z,[0,-.05,-.17,-.40,-.62,-.62][i])),
  tr('Knee_L',dt,(_,i)=>q(Z,[0,.06,.20,.50,.72,.72][i])),
  tr('Knee_R',dt,(_,i)=>q(Z,[0,.06,.22,.53,.75,.75][i])),
  tr('Shoulder_L',dt,(_,i)=>branch('L',[0,.04,.15,.35,.48,.48][i])),
  tr('Shoulder_R',dt,(_,i)=>branch('R',[0,-.04,-.15,-.35,-.48,-.48][i]))
]);
const candidateBytes=await io.writeBinary(doc);
await writeFile(candidateFile,candidateBytes);
const report={sourceFile,sourceSha256,sourceBytes:sourceBytes.length,candidateFile,candidateSha256:sha(candidateBytes),candidateBytes:candidateBytes.length,vertices:7492,triangles:4771,joints:bones.map(b=>b.name),influence,sourceTextures,runtimeTextures:root.listTextures().map(t=>({name:t.getName(),bytes:t.getImage().length})),nativeScale,sourceBounds:{min:[-.1298828274,0,-.4990233779],max:[.1298828274,.8222660422,.4990233779]},modelHeight:.8222660422*nativeScale,clips,attackContactSeconds:.52,acceptance:{assetAudit:false,labAccepted:false,worldIntegrated:false}};
await writeFile(`${dir}/validation.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
