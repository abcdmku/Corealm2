import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsClearcoat, KHRMaterialsIridescence } from '@gltf-transform/extensions';
import * as THREE from 'three';
import sharp from 'sharp';

const dir = 'assets/art/tripo/imports/creatures/audit-user-beetle-golem';
const sourceFile = dir + '/sources/beetle+golem.glb';
const candidateFile = dir + '/beetle-golem-user-candidate.glb';
const sha = (v) => createHash('sha256').update(v).digest('hex');
const sourceBytes = await readFile(sourceFile);
if (sha(sourceBytes) !== 'fb03cd921a5ffed201d577cf4102a182d9826f12664e14d11db38b7a60db5193') throw Error('Source hash changed');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.readBinary(sourceBytes), root = doc.getRoot();
const primitive = root.listMeshes()[0]?.listPrimitives()[0];
const meshNode = root.listNodes().find((node) => node.getMesh() === root.listMeshes()[0]);
const armature = root.listNodes().find((node) => node.getName() === 'Armature');
const skin = meshNode?.getSkin(), joints = skin?.listJoints() ?? [];
if (!primitive || !armature || joints.length !== 67 || primitive.getAttribute('POSITION')?.getCount() !== 8266 || primitive.getIndices()?.getCount() !== 15498 || root.listAnimations().length) throw Error('Unexpected source topology or skin');
const material = primitive.getMaterial();
if (!material?.getBaseColorTexture() || !material.getNormalTexture() || !material.getMetallicRoughnessTexture()) throw Error('Source PBR maps missing');
const originals = Object.fromEntries(['POSITION','NORMAL','TEXCOORD_0','JOINTS_0','WEIGHTS_0'].map((key) => [key, Array.from(primitive.getAttribute(key).getArray())]));
originals.indices = Array.from(primitive.getIndices().getArray());
originals.inverseBinds = Array.from(skin.getInverseBindMatrices().getArray());
const textures = [];
for (const texture of root.listTextures()) {
  const image = texture.getImage(), info = await sharp(image).metadata();
  textures.push({ name:texture.getName(), width:info.width, height:info.height, bytes:image.length, sha256:sha(image) });
}
const materialSettings = JSON.parse(await readFile(dir+'/textures/material-settings.json','utf8'));
const opticsBytes = await readFile(dir+'/textures/'+materialSettings.opticsTexture);
const optics = doc.createTexture('BeetleShell_OpticsRG').setImage(new Uint8Array(opticsBytes)).setMimeType('image/png');
const iridescence = doc.createExtension(KHRMaterialsIridescence).createIridescence()
  .setIridescenceFactor(materialSettings.KHR_materials_iridescence.iridescenceFactor)
  .setIridescenceIOR(materialSettings.KHR_materials_iridescence.iridescenceIor)
  .setIridescenceThicknessMinimum(materialSettings.KHR_materials_iridescence.iridescenceThicknessMinimum)
  .setIridescenceThicknessMaximum(materialSettings.KHR_materials_iridescence.iridescenceThicknessMaximum)
  .setIridescenceTexture(optics).setIridescenceThicknessTexture(optics);
const clearcoat = doc.createExtension(KHRMaterialsClearcoat).createClearcoat()
  .setClearcoatFactor(materialSettings.KHR_materials_clearcoat.clearcoatFactor)
  .setClearcoatRoughnessFactor(materialSettings.KHR_materials_clearcoat.clearcoatRoughnessFactor).setClearcoatTexture(optics);
material.setExtension('KHR_materials_iridescence',iridescence).setExtension('KHR_materials_clearcoat',clearcoat);
// Source has useful weights, but the bind pose is an upright T-pose.
// The authored animation rest is a low planted beetle.
const nativeScale = 2.25;
armature.setScale([nativeScale,nativeScale,nativeScale]);
const byName = new Map(joints.map((joint) => [joint.getName(),joint]));
const base = new Map(joints.map((joint) => [joint.getName(),{p:[...joint.getTranslation()],q:[...joint.getRotation()]}]));
const parentQ = new Map(joints.map((joint) => {
  const q = new THREE.Quaternion();
  new THREE.Matrix4().fromArray(joint.getParentNode()?.getWorldMatrix() ?? new THREE.Matrix4().elements).decompose(new THREE.Vector3(),q,new THREE.Vector3());
  return [joint.getName(),q];
}));
const X=[1,0,0],Y=[0,1,0],Z=[0,0,1];
function pose(name,axes) {
  const parent=parentQ.get(name),delta=new THREE.Quaternion();
  for (const [axis,angle] of axes) delta.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis),angle));
  return parent.clone().invert().multiply(delta).multiply(parent).multiply(new THREE.Quaternion(...base.get(name).q)).normalize().toArray();
}
const mix=(a,b,t)=>a+(b-a)*t, restHip=base.get('Hips').p, buffer=root.listBuffers()[0], clips=[];
function addClip(name,seconds,times,states) {
  const animation=doc.createAnimation(name);
  for (const key of Object.keys(states[0])) {
    const translation=key.endsWith('_t'), joint=translation?key.slice(0,-2):key, path=translation?'translation':'rotation';
    const input=doc.createAccessor(name+'_'+key+'_time').setArray(Float32Array.from(times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const output=doc.createAccessor(name+'_'+key+'_value').setArray(Float32Array.from(states.flatMap((s)=>s[key]))).setType(translation?Accessor.Type.VEC3:Accessor.Type.VEC4).setBuffer(buffer);
    const sampler=doc.createAnimationSampler(name+'_'+key).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(name+'_'+key).setTargetNode(byName.get(joint)).setTargetPath(path).setSampler(sampler));
  }
  clips.push({name,seconds,channels:Object.keys(states[0]).length});
}
// Solve in native model units. Only Hips translates; every limb retains its bind length.
const worldQuaternion=(node)=>{const q=new THREE.Quaternion();new THREE.Matrix4().fromArray(node.getWorldMatrix()).decompose(new THREE.Vector3(),q,new THREE.Vector3());return q;};
const point=(name)=>new THREE.Vector3(...byName.get(name).getWorldTranslation());
const nativeWorldQ=new Map(joints.map(j=>[j.getName(),worldQuaternion(j)]));
function setWorldQ(name,q){const node=byName.get(name);node.setRotation(worldQuaternion(node.getParentNode()).invert().multiply(q).normalize().toArray());}
function aim(name,child,target){
  const node=byName.get(name),origin=point(name),from=point(child).sub(origin).normalize(),to=target.clone().sub(origin).normalize();
  setWorldQ(name,new THREE.Quaternion().setFromUnitVectors(from,to).multiply(worldQuaternion(node)));
}
function solveLimb(upper,lower,end,target,pole){
  const origin=point(upper),l1=point(lower).distanceTo(origin),l2=point(end).distanceTo(point(lower));
  const direction=target.clone().sub(origin),distance=Math.min(direction.length(),(l1+l2)*.995);direction.normalize();
  const bend=pole.clone().sub(origin);bend.addScaledVector(direction,-bend.dot(direction)).normalize();
  const along=(l1*l1-l2*l2+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,l1*l1-along*along));
  const elbow=origin.clone().addScaledVector(direction,along).addScaledVector(bend,height);
  aim(upper,lower,elbow);aim(lower,end,origin.clone().addScaledVector(direction,distance));
}
function state({rise=0,swing=0,step=0,lift=0,recoil=0,roll=0,drop=0,breath=0}={}) {
  armature.setScale([1,1,1]);
  for(const joint of joints){const rest=base.get(joint.getName());joint.setTranslation(rest.p).setRotation(rest.q);}
  const fold=Math.min(1,roll);
  const lean=mix(mix(1.22,.08,rise)+recoil*.12,1.52,fold);
  byName.get('Hips').setTranslation([restHip[0],mix(mix(.17,.425,rise)+lift+breath*.002,.095,fold),restHip[2]]).setRotation(pose('Hips',[[X,lean]]));
  byName.get('Neck').setRotation(pose('Neck',[[X,mix(-.40*(1-rise),-.40,fold)]]));
  byName.get('Head').setRotation(pose('Head',[[X,mix(-.65*(1-rise),-.75,fold)]]));
  for(const [side,sign] of [['Left',1],['Right',-1]]){
    const phase=step*sign,up=Math.max(0,phase)*.055;
    const hand=new THREE.Vector3(sign*mix(mix(.185,.27,rise),.235,fold),mix(mix(.044,.55,rise)+up,.065,fold),mix(mix(.24,.02,rise)+phase*.15,.15,fold));
    if(side==='Right'){hand.y+=rise*(-swing*.14);hand.z+=rise*swing*.24;}
    solveLimb(side+'_UpperArm',side+'_LowerArm',side+'_Hand',hand,new THREE.Vector3(sign*.33,.23,.05));
    setWorldQ(side+'_Hand',new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-sign*Math.PI/2).multiply(nativeWorldQ.get(side+'_Hand')));
    const foot=new THREE.Vector3(sign*mix(.12,.20,fold),mix(.065+Math.max(0,-phase)*.065,.06,fold),mix(mix(-.15,-.045,rise)-phase*.14,-.10,fold));
    solveLimb(side+'_UpperLeg',side+'_LowerLeg',side+'_Foot',foot,new THREE.Vector3(sign*mix(.15,.31,fold),mix(.2,.07,fold),.17));
    setWorldQ(side+'_Foot',nativeWorldQ.get(side+'_Foot').clone());
  }
  const result={Hips_t:[...byName.get('Hips').getTranslation()]};
  for(const name of ['Hips','Spine','Chest','UpperChest','Neck','Head','Left_Shoulder','Right_Shoulder','Left_UpperArm','Right_UpperArm','Left_LowerArm','Right_LowerArm','Left_Hand','Right_Hand','Left_UpperLeg','Right_UpperLeg','Left_LowerLeg','Right_LowerLeg','Left_Foot','Right_Foot']) result[name]=[...byName.get(name).getRotation()];
  for(const joint of joints){const rest=base.get(joint.getName());joint.setTranslation(rest.p).setRotation(rest.q);}
  armature.setScale([nativeScale,nativeScale,nativeScale]);
  return result;
}
addClip('Idle',2.4,[0,.6,1.2,1.8,2.4],[0,1,0,-1,0].map((breath)=>state({breath})));
for (const [name,seconds,stride,bob] of [['Walk',1.12,.36,.011],['Run',.72,.58,.025]]) {
  const times=Array.from({length:17},(_,i)=>seconds*i/16);
  addClip(name,seconds,times,times.map((t)=>{
    const phase=t/seconds*Math.PI*2;
    return state({step:stride*Math.sin(phase),lift:bob*(1-Math.cos(phase*4))/2,breath:.25*Math.sin(phase*2)});
  }));
}
// Heavy hind-leg rise, wide forearm windup, 0.56 s impact, then settle.
const attackTimes=[0,.14,.31,.44,.56,.72,.94,1.14];
addClip('Attack',1.14,attackTimes,[state(),state({rise:.36}),state({rise:.84,swing:-.55}),state({rise:1,swing:-.9}),state({rise:.94,swing:1}),state({rise:.66,swing:.55,recoil:.25}),state({rise:.18}),state()]);
addClip('Hit',.50,[0,.10,.24,.50],[state(),state({recoil:1,drop:.025}),state({recoil:.48,drop:.012}),state()]);
addClip('Death',1.55,[0,.16,.36,.62,1.05,1.55],[state(),state({recoil:.55}),state({recoil:.8,roll:.35}),state({roll:1}),state({roll:1}),state({roll:1})]);
const bytes=await io.writeBinary(doc);
await writeFile(candidateFile,bytes);
const check=(await io.readBinary(bytes)).getRoot(),p=check.listMeshes()[0].listPrimitives()[0];
for (const key of ['POSITION','NORMAL','TEXCOORD_0','JOINTS_0','WEIGHTS_0']) {
  const a=p.getAttribute(key).getArray(),b=originals[key];
  if (a.length!==b.length || b.some((v,i)=>v!==a[i])) throw Error(key+' changed');
}
if (originals.indices.some((v,i)=>v!==p.getIndices().getArray()[i])) throw Error('Indices changed');
if (originals.inverseBinds.some((v,i)=>v!==check.listSkins()[0].getInverseBindMatrices().getArray()[i])) throw Error('Skin bind changed');
for (const entry of textures) if (!check.listTextures().some((texture)=>texture.getName()===entry.name&&sha(texture.getImage())===entry.sha256)) throw Error('Source PBR map changed');
if (!check.listTextures().some((texture)=>texture.getName()==='BeetleShell_OpticsRG'&&sha(texture.getImage())===sha(opticsBytes))) throw Error('Shell optics map missing');
const validation={sourceFile,sourceSha256:sha(sourceBytes),sourceBytes:sourceBytes.length,candidateFile,candidateSha256:sha(bytes),candidateBytes:bytes.length,vertices:8266,triangles:5166,joints:67,geometryPreserved:true,sourceSkinAndWeightsPreserved:true,pbrTexturesPreserved:true,nativeScale,textures,optics:{file:dir+'/textures/beetle-shell-optics-rg.png',sha256:sha(opticsBytes)},clips,contactSeconds:.56,contactNormalized:.56/1.14,status:'awaiting-root-lab-review'};
await writeFile(dir+'/validation.json',JSON.stringify(validation,null,2)+'\n');
console.log(JSON.stringify(validation,null,2));
