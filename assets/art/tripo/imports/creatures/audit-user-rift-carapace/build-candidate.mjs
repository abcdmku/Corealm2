import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {NodeIO,Accessor} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import sharp from 'sharp';

const dir='assets/art/tripo/imports/creatures/audit-user-rift-carapace';
const sourceFile=dir+'/sources/rift-carapace-original.glb',candidateFile=dir+'/rift-carapace-candidate.glb';
const hash=b=>createHash('sha256').update(b).digest('hex');
const source=await readFile(sourceFile),sourceHash='ca486cf636be02a8615e45446d57bbde3922a9ba351235c8d258bcb7c91bc93a';
if(hash(source)!==sourceHash)throw Error('User source hash changed');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),doc=await io.readBinary(source),root=doc.getRoot();
const scene=root.listScenes()[0],meshNode=root.listNodes().find(n=>n.getMesh()),primitive=root.listMeshes()[0].listPrimitives()[0],buffer=root.listBuffers()[0];
if(!scene||!meshNode||primitive.getAttribute('POSITION')?.getCount()!==3807||primitive.getIndices()?.getCount()!==15450||root.listSkins().length||root.listAnimations().length)throw Error('Unexpected source topology');
if(!primitive.getMaterial()?.getBaseColorTexture()||!primitive.getMaterial()?.getNormalTexture()||!primitive.getMaterial()?.getMetallicRoughnessTexture())throw Error('Original PBR maps missing');
const pos=primitive.getAttribute('POSITION').getArray();
const original=Object.fromEntries(['POSITION','NORMAL','TEXCOORD_0'].map(k=>[k,hash(Buffer.from(primitive.getAttribute(k).getArray().buffer))]));
original.indices=hash(Buffer.from(primitive.getIndices().getArray().buffer));
const textures=[];for(const texture of root.listTextures()){const info=await sharp(texture.getImage()).metadata();textures.push({name:texture.getName(),width:info.width,height:info.height,bytes:texture.getImage().length,sha256:hash(texture.getImage())});}

// The source faces +X. Root yaw turns its pincers toward the game's +Z forward.
// Keep the model coordinates and 2K UV atlas exactly as delivered.
const bones=[{name:'Root',p:[0,0,0],parent:null},{name:'Carapace',p:[-.035,.43,0],parent:'Root'}];
for(const side of [-1,1]){
 const s=side<0?'L':'R';
 bones.push({name:`Claw_${s}`,p:[.145,.35,side*.24],parent:'Root'});
 bones.push({name:`Pincer_${s}`,p:[.30,.24,side*.29],parent:`Claw_${s}`});
 bones.push({name:`RearLeg_${s}`,p:[-.19,.34,side*.27],parent:'Root'});
 bones.push({name:`MidLeg_${s}`,p:[.045,.31,side*.30],parent:'Root'});
}
const byBone=new Map(bones.map((b,i)=>[b.name,{...b,index:i}]));
for(const b of bones)b.local=b.parent?b.p.map((v,k)=>v-byBone.get(b.parent).p[k]):b.p;
const rig=doc.createNode('RiftCarapaceRig').setRotation([0,-Math.SQRT1_2,0,Math.SQRT1_2]).setScale([2.35,2.35,2.35]);
scene.removeChild(meshNode);scene.addChild(rig);rig.addChild(meshNode);meshNode.setName('RiftCarapaceSkinnedMesh').setTranslation([0,0,0]).setRotation([0,0,0,1]).setScale([1,1,1]);
const joints=new Map();for(const b of bones){const n=doc.createNode(b.name).setTranslation(b.local);joints.set(b.name,n);(b.parent?joints.get(b.parent):rig).addChild(n);}
const skin=doc.createSkin('RiftCarapaceAnatomicalSkin').setSkeleton(joints.get('Root'));
for(const b of bones)skin.addJoint(joints.get(b.name));
const ibm=new Float32Array(bones.length*16);for(let i=0;i<bones.length;i++){const [x,y,z]=bones[i].p;ibm.set([1,0,0,0,0,1,0,0,0,0,1,0,-x,-y,-z,1],i*16);}
skin.setInverseBindMatrices(doc.createAccessor('RiftInverseBinds').setType(Accessor.Type.MAT4).setArray(ibm).setBuffer(buffer));meshNode.setSkin(skin);
const ids=new Uint16Array(pos.length/3*4),weights=new Float32Array(ids.length),counts=Object.fromEntries(bones.map(b=>[b.name,0]));
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
for(let i=0;i<pos.length/3;i++){
 const x=pos[i*3],y=pos[i*3+1],z=pos[i*3+2],az=Math.abs(z),s=z<0?'L':'R';
 let name='Carapace',amount=1;
 // The protruding paired arms and chelae are separated from the central shell
 // by their lateral origin and lower profile; taper weights at the sockets.
 if(x>.14&&az>.12&&y<.49){name=`${x>.30&&y<.38?'Pincer':'Claw'}_${s}`;amount=clamp((az-.12)/.12,.15,1);}
 else if(x<-.11&&az>.29){name=`RearLeg_${s}`;amount=clamp((az-.25)/.12,.15,1);}
 else if(x>=-.11&&x<=.18&&az>.32&&y<.48){name=`MidLeg_${s}`;amount=clamp((az-.27)/.12,.15,1);}
 ids[4*i]=byBone.get(name).index;weights[4*i]=amount;counts[name]++;
 if(amount<1){ids[4*i+1]=byBone.get('Carapace').index;weights[4*i+1]=1-amount;}
}
primitive.setAttribute('JOINTS_0',doc.createAccessor('RiftJoints').setArray(ids).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0',doc.createAccessor('RiftWeights').setArray(weights).setType(Accessor.Type.VEC4).setBuffer(buffer));
const q=(axis,a)=>{const s=Math.sin(a/2),c=Math.cos(a/2);return axis==='x'?[s,0,0,c]:axis==='y'?[0,s,0,c]:[0,0,s,c];};
const track=(joint,times,fn,path='rotation')=>({joint,times,values:times.map(fn),path});
const clips=[];
function clip(name,seconds,tracks){const a=doc.createAnimation(name);for(const t of tracks){const inp=doc.createAccessor(name+'_'+t.joint+'_time').setType(Accessor.Type.SCALAR).setArray(Float32Array.from(t.times)).setBuffer(buffer),out=doc.createAccessor(name+'_'+t.joint+'_value').setType(t.path==='translation'?Accessor.Type.VEC3:Accessor.Type.VEC4).setArray(Float32Array.from(t.values.flat())).setBuffer(buffer),sam=doc.createAnimationSampler().setInput(inp).setOutput(out).setInterpolation('LINEAR');a.addSampler(sam).addChannel(doc.createAnimationChannel().setTargetNode(joints.get(t.joint)).setTargetPath(t.path).setSampler(sam));}clips.push({name,seconds,channels:tracks.length});}
const wave=(t,d,p=0)=>Math.sin(t/d*Math.PI*2+p);
const idle=[0,.55,1.1,1.65,2.2];
clip('Idle',2.2,[track('Carapace',idle,t=>q('z',.018*wave(t,2.2))),...[-1,1].flatMap(side=>{const s=side<0?'L':'R';return [track(`Claw_${s}`,idle,t=>q('x',side*.027*wave(t,2.2))),track(`Pincer_${s}`,idle,t=>q('y',side*.021*wave(t,2.2,.7)))];})]);
for(const [name,d,a] of [['Walk',1.05,.28],['Run',.68,.43]]){
 const times=Array.from({length:13},(_,i)=>i*d/12);
 const tracks=[track('Root',times,t=>[0,.007*(1-Math.cos(4*Math.PI*t/d)),0],'translation'),track('Carapace',times,t=>q('z',.025*wave(t,d)))];
 for(const side of [-1,1]){
  const s=side<0?'L':'R';
  tracks.push(track(`RearLeg_${s}`,times,t=>q('y',side*a*wave(t,d,side<0?0:Math.PI))));
  tracks.push(track(`MidLeg_${s}`,times,t=>q('y',side*a*wave(t,d,side<0?Math.PI:0))));
  tracks.push(track(`Claw_${s}`,times,t=>q('z',.45*a*wave(t,d,side<0?0:Math.PI))));
 }
 clip(name,d,tracks);
}
// Both claws wind back, converge for a heavy crush at 0.58 s, then recover.
const at=[0,.14,.30,.46,.58,.72,.96,1.18];
clip('Attack',1.18,[track('Carapace',at,(t,i)=>q('z',[0,-.03,-.08,.02,.13,.08,.02,0][i])),...[-1,1].flatMap(side=>{const s=side<0?'L':'R';return [track(`Claw_${s}`,at,(t,i)=>q('y',side*[0,-.10,-.26,-.13,.35,.24,.07,0][i])),track(`Pincer_${s}`,at,(t,i)=>q('y',side*[0,-.04,-.13,.08,.39,.20,.04,0][i]))];})]);
const ht=[0,.10,.26,.50];clip('Hit',.50,[track('Root',ht,(t,i)=>[[0,0,0],[-.015,.018,0],[-.006,.006,0],[0,0,0]][i],'translation'),track('Carapace',ht,(t,i)=>q('z',[0,-.12,-.04,0][i]))]);
const dt=[0,.20,.43,.74,1.22,1.62];
clip('Death',1.62,[
 track('Root',[0,.20,.43,.74,.96,1.22,1.62],(t,i)=>[0,[0,.052,.123,.17,.215,.36,.36][i],0],'translation'),
 track('Root',dt,(t,i)=>q('z',[0,.20,.55,1.00,1.38,1.38][i])),
 track('Carapace',dt,(t,i)=>q('z',[0,.03,.06,.08,.08,.08][i])),
 ...[-1,1].flatMap(side=>{const s=side<0?'L':'R';return [
  track(`Claw_${s}`,dt,(t,i)=>q('y',side*[0,.05,.12,.25,.31,.31][i])),
  track(`Pincer_${s}`,dt,(t,i)=>q('y',side*[0,.07,.16,.25,.28,.28][i])),
  track(`RearLeg_${s}`,dt,(t,i)=>q('y',side*[0,.08,.20,.36,.42,.42][i])),
  track(`MidLeg_${s}`,dt,(t,i)=>q('y',side*[0,.08,.19,.33,.39,.39][i]))
 ];})
]);
const bytes=await io.writeBinary(doc);await writeFile(candidateFile,bytes);
const check=(await io.readBinary(bytes)).getRoot(),cp=check.listMeshes()[0].listPrimitives()[0];
for(const k of ['POSITION','NORMAL','TEXCOORD_0'])if(hash(Buffer.from(cp.getAttribute(k).getArray().buffer))!==original[k])throw Error(k+' changed');
if(hash(Buffer.from(cp.getIndices().getArray().buffer))!==original.indices)throw Error('Indices changed');
for(const t of check.listTextures())if(!textures.some(x=>x.name===t.getName()&&x.sha256===hash(t.getImage())))throw Error('Source map changed');
const report={sourceFile,sourceSha256:sourceHash,sourceBytes:source.length,candidateFile,candidateSha256:hash(bytes),candidateBytes:bytes.length,vertices:3807,triangles:5150,joints:bones.length,jointInfluence:counts,textures,sourceGeometryPreserved:true,sourcePBRPreserved:true,scale:2.35,sourceForward:'+X',gameForward:'+Z',clips,contactSeconds:.58,contactNormalized:.58/1.18,status:'awaiting-root-lab-review'};
await writeFile(dir+'/validation.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
