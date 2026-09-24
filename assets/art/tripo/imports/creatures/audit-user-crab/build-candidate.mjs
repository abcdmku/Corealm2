import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {NodeIO,Accessor} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import sharp from 'sharp';
const dir='assets/art/tripo/imports/creatures/audit-user-crab';
const sourceFile=`${dir}/sources/crab+3d+model.glb`, candidateFile=`${dir}/animal_crab-candidate.glb`;
const hash=b=>createHash('sha256').update(b).digest('hex');
const source=await readFile(sourceFile), sourceHash='4a9c381f600c428f8ed14364f8ad8b3702caa2129b833e50ae3a3f3c32026f33';
if(hash(source)!==sourceHash)throw Error('Source changed');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),doc=await io.readBinary(source),root=doc.getRoot();
const scene=root.listScenes()[0],node=root.listNodes().find(n=>n.getMesh()),prim=root.listMeshes()[0].listPrimitives()[0],buffer=root.listBuffers()[0];
if(!scene||!node||!prim||root.listSkins().length||root.listAnimations().length||prim.getAttribute('POSITION').getCount()!==3784)throw Error('Unexpected source');
const pos=prim.getAttribute('POSITION').getArray();
const textures=[];for(const tex of root.listTextures()){const meta=await sharp(tex.getImage()).metadata();textures.push({name:tex.getName(),width:meta.width,height:meta.height,bytes:tex.getImage().length,sha256:hash(tex.getImage())});}
const original={positions:hash(Buffer.from(pos.buffer)),indices:hash(Buffer.from(prim.getIndices().getArray().buffer)),uvs:hash(Buffer.from(prim.getAttribute('TEXCOORD_0').getArray().buffer)),normal:hash(Buffer.from(prim.getAttribute('NORMAL').getArray().buffer)),textures};
// Source front is -X. The native shell is low and central; the raised outer pieces are
// claws at negative X, while paired walking legs project to each side along Z.
const bones=[{name:'CrabRoot',p:[0,0,0],parent:null},{name:'Carapace',p:[-.06,.48,0],parent:'CrabRoot'}];
for(const side of [-1,1]){
 const s=side<0?'L':'R';
 bones.push({name:`Claw_${s}`,p:[-.18,.59,side*.19],parent:'CrabRoot',side,group:'claw'});
 bones.push({name:`Pincer_${s}`,p:[-.29,.77,side*.28],parent:`Claw_${s}`,side,group:'pincer'});
 for(let i=0;i<4;i++)bones.push({name:`Leg_${s}_${i+1}`,p:[-.07+i*.075,.43,side*(.20+i*.012)],parent:'CrabRoot',side,leg:i,group:'leg'});
}
const bm=new Map(bones.map(b=>[b.name,b]));
for(const b of bones)b.local=b.parent?b.p.map((v,k)=>v-bm.get(b.parent).p[k]):b.p;
const rig=doc.createNode('CreekCrabRig').setRotation([0,Math.SQRT1_2,0,Math.SQRT1_2]).setScale([.315,.315,.315]);
scene.removeChild(node);scene.addChild(rig);rig.addChild(node);node.setTranslation([0,0,0]).setRotation([0,0,0,1]).setScale([1,1,1]);
const joints=new Map();for(const b of bones){const n=doc.createNode(b.name).setTranslation(b.local);joints.set(b.name,n);(b.parent?joints.get(b.parent):rig).addChild(n);}
const skin=doc.createSkin('CreekCrabSkin').setSkeleton(joints.get('CrabRoot'));
for(const b of bones)skin.addJoint(joints.get(b.name));
const ibm=new Float32Array(bones.length*16);for(let i=0;i<bones.length;i++){const [x,y,z]=bones[i].p;ibm.set([1,0,0,0,0,1,0,0,0,0,1,0,-x,-y,-z,1],i*16);}
skin.setInverseBindMatrices(doc.createAccessor('CreekCrabIBMs').setArray(ibm).setType(Accessor.Type.MAT4).setBuffer(buffer));node.setSkin(skin);
const ids=new Uint16Array(pos.length/3*4), weights=new Float32Array(ids.length), counts=new Uint32Array(bones.length);
const bi=new Map(bones.map((b,i)=>[b.name,i]));
for(let v=0;v<pos.length/3;v++){
 const x=pos[3*v],y=pos[3*v+1],z=pos[3*v+2],side=z<0?'L':'R',az=Math.abs(z);
 let name='Carapace',influence=1;
 if(x<-.16&&az>.09&&y>.54){name=`${x<-.235&&y>.72?'Pincer':'Claw'}_${side}`;influence=Math.min(1,Math.max(.2,(az-.09)*7));}
 else if(az>.22&&x>-.17){const leg=Math.max(0,Math.min(3,Math.round((x+.045)/.075)));name=`Leg_${side}_${leg+1}`;influence=Math.min(1,Math.max(.15,(az-.22)*7));}
 ids[4*v]=bi.get(name);weights[4*v]=influence;counts[bi.get(name)]++;
 if(influence<1){ids[4*v+1]=bi.get('Carapace');weights[4*v+1]=1-influence;}
}
prim.setAttribute('JOINTS_0',doc.createAccessor('CrabJoints').setArray(ids).setType(Accessor.Type.VEC4).setBuffer(buffer));
prim.setAttribute('WEIGHTS_0',doc.createAccessor('CrabWeights').setArray(weights).setType(Accessor.Type.VEC4).setBuffer(buffer));
const q=(axis,a)=>{const s=Math.sin(a/2),c=Math.cos(a/2);return axis==='x'?[s,0,0,c]:axis==='y'?[0,s,0,c]:[0,0,s,c];};
const clips=[];
function addClip(name,duration,tracks){const a=doc.createAnimation(name);for(const tr of tracks){const typ=tr.path==='translation'?Accessor.Type.VEC3:Accessor.Type.VEC4;const inp=doc.createAccessor(`${name}_${tr.joint}_t`).setArray(Float32Array.from(tr.times)).setType(Accessor.Type.SCALAR).setBuffer(buffer),out=doc.createAccessor(`${name}_${tr.joint}_v`).setArray(Float32Array.from(tr.values.flat())).setType(typ).setBuffer(buffer),s=doc.createAnimationSampler(`${name}_${tr.joint}`).setInput(inp).setOutput(out).setInterpolation('LINEAR');a.addSampler(s).addChannel(doc.createAnimationChannel(`${name}_${tr.joint}`).setTargetNode(joints.get(tr.joint)).setTargetPath(tr.path??'rotation').setSampler(s));}clips.push({name,seconds:duration,channels:tracks.length});}
const tr=(joint,times,fn,path='rotation')=>({joint,times,values:times.map(fn),path});
const cycle=(t,d,p=0)=>Math.sin(t/d*Math.PI*2+p),loc=bm.get('CrabRoot').local;
addClip('Idle',2,[tr('Carapace',[0,.5,1,1.5,2],t=>q('z',.015*cycle(t,2))),...[-1,1].map(side=>tr(`Claw_${side<0?'L':'R'}`,[0,.5,1,1.5,2],t=>q('z',side*.035*cycle(t,2))))]);
for(const [name,d,amp] of [['Walk',1,.20],['Run',.62,.34]]){const times=Array.from({length:9},(_,i)=>i*d/8),tracks=[tr('CrabRoot',times,t=>[.014*cycle(t,d),.01*(1-Math.cos(4*Math.PI*t/d)),0],'translation')];for(const side of [-1,1]){const s=side<0?'L':'R';for(let i=0;i<4;i++)tracks.push(tr(`Leg_${s}_${i+1}`,times,t=>q('x',side*amp*cycle(t,d,i%2?Math.PI:0))));tracks.push(tr(`Claw_${s}`,times,t=>q('z',side*.08*cycle(t,d))));}addClip(name,d,tracks);}
const at=[0,.15,.30,.42,.52,.70,.9];addClip('Attack',.9,[tr('CrabRoot',at,(t,i)=>[[0,0,0],[0,0,0],[-.014,0,0],[-.03,0,0],[-.018,0,0],[0,0,0],[0,0,0]][i],'translation'),...[-1,1].flatMap(side=>{const s=side<0?'L':'R';return [tr(`Claw_${s}`,at,(t,i)=>q('y',side*[0,-.13,-.20,.32,.16,.05,0][i])),tr(`Pincer_${s}`,at,(t,i)=>q('y',side*[0,-.05,-.11,.29,.08,.02,0][i]))];})]);
const ht=[0,.1,.24,.47];addClip('Hit',.47,[tr('CrabRoot',ht,(t,i)=>[[0,0,0],[.016,-.016,0],[.005,-.006,0],[0,0,0]][i],'translation'),tr('Carapace',ht,(t,i)=>q('z',[0,.11,.03,0][i]))]);
const dt=[0,.25,.5,.8,1.15];addClip('Death',1.15,[tr('CrabRoot',dt,(t,i)=>[[0,0,0],[0,.08,0],[0,.23,0],[0,.37,0],[0,.465,0]][i],'translation'),tr('CrabRoot',dt,(t,i)=>q('x',[0,.28,.75,1.27,1.55][i])),tr('Carapace',dt,(t,i)=>q('x',[0,.03,.10,.18,.18][i])),...[-1,1].flatMap(side=>{const s=side<0?'L':'R';return [tr(`Claw_${s}`,dt,(t,i)=>q('z',side*[0,.12,.27,.40,.40][i])),...Array.from({length:4},(_,k)=>tr(`Leg_${s}_${k+1}`,dt,(t,i)=>q('x',side*[0,.08,.20,.31,.31][i])))];})]);
const bytes=await io.writeBinary(doc);await writeFile(candidateFile,bytes);const check=(await io.readBinary(bytes)).getRoot(),cp=check.listMeshes()[0].listPrimitives()[0];
for(const [key,a,b] of [['positions',original.positions,hash(Buffer.from(cp.getAttribute('POSITION').getArray().buffer))],['indices',original.indices,hash(Buffer.from(cp.getIndices().getArray().buffer))],['uvs',original.uvs,hash(Buffer.from(cp.getAttribute('TEXCOORD_0').getArray().buffer))],['normals',original.normal,hash(Buffer.from(cp.getAttribute('NORMAL').getArray().buffer))]])if(a!==b)throw Error(`${key} changed`);
for(const t of check.listTextures())if(!textures.some(v=>v.name===t.getName()&&v.sha256===hash(t.getImage())))throw Error('Texture changed');
const report={sourceFile,sourceSha256:sourceHash,sourceBytes:source.length,candidateFile,candidateSha256:hash(bytes),candidateBytes:bytes.length,geometryPreserved:true,pbrTexturesPreserved:true,vertices:3784,triangles:5074,joints:bones.length,jointInfluence:Object.fromEntries(bones.map((b,i)=>[b.name,counts[i]])),textures,clips,contactSeconds:.42,contactNormalized:.42/.9,status:'awaiting-root-review'};await writeFile(`${dir}/validation.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));







