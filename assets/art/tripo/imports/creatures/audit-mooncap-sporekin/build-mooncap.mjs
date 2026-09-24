import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {Accessor,NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import sharp from 'sharp';
import {Quaternion,Vector3,Matrix4} from 'three';
import {retargetHumanoid} from '../../../../../../tools/tripo-creatures/retarget.js';
import {addChannel,applyClip,duration,removeClip,restorePose,storedPose} from '../../../../../../tools/creature-motion/pose.js';
import {deformedBounds} from '../../../../../../tools/creature-motion/validate-deformation.js';
await MeshoptDecoder.ready;
const dir='assets/art/tripo/imports/creatures/audit-mooncap-sporekin';
const source='assets/art/tripo/imports/creatures/audit-owned-plant-downloads/mooncap-fungus-eab6d009-e9e3-4685-ad92-370117420c63.glb';
const sourceSha='1fc21c19b6b94831f6d0c122dbdd3cd5bc1415f3f205d12f73f515908cb3610a';
const libraryPath='game/public/assets/models/animation/animation_library_1.glb';
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourceBytes=await readFile(source);if(sha(sourceBytes)!==sourceSha)throw new Error('Mooncap download changed');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const doc=await io.readBinary(sourceBytes),root=doc.getRoot();
for(const extension of root.listExtensionsUsed())if(extension.extensionName==='EXT_meshopt_compression')extension.dispose();
const scene=root.listScenes()[0],mesh=root.listMeshes()[0],primitive=mesh.listPrimitives()[0],meshNode=root.listNodes().find(n=>n.getMesh()===mesh);
const positions=primitive.getAttribute('POSITION').getArray();
if(primitive.getIndices().getCount()/3!==4713||positions.length/3!==6945||root.listSkins().length)throw new Error('Unexpected unrigged Mooncap source');
const sourcePositionSha=sha(Buffer.from(positions.buffer));
const groundOffset=.499755859375;
for(let i=1;i<positions.length;i+=3)positions[i]+=groundOffset;
primitive.getAttribute('POSITION').setArray(positions);
const sourceGeometry=Object.fromEntries(primitive.listSemantics().map(s=>[s,sha(Buffer.from(primitive.getAttribute(s).getArray().buffer))]));
const sourceIndices=sha(Buffer.from(primitive.getIndices().getArray().buffer));
const sourceImage=root.listTextures()[0].getImage(),imageMeta=await sharp(sourceImage).metadata();
if(imageMeta.width!==8192||imageMeta.height!==8192)throw new Error('Unexpected Mooncap color atlas');

// The source is a centred 1 m model. Shift it rigidly to ground without
// changing topology, shape, normals or UVs; scale only after retargeting.
scene.removeChild(meshNode);
const presentation=doc.createNode('MooncapPresentation');
const armature=doc.createNode('mixamorig:Armature');
scene.addChild(presentation);presentation.addChild(armature);armature.addChild(meshNode);
const bones=[];
const bone=(name,parent,p,group,sigma,side=0)=>bones.push({name:`mixamorig:${name}`,parent:parent?`mixamorig:${parent}`:'mixamorig:Armature',p,group,sigma,side});
bone('Hips',null,[0,-.17,0],'body',.12);
bone('Spine','Hips',[0,-.07,0],'body',.13);
bone('Spine1','Spine',[0,.055,0],'body',.12);
bone('Spine2','Spine1',[0,.16,0],'body',.12);
bone('Neck','Spine2',[0,.24,0],'head',.09);
bone('Head','Neck',[0,.31,0],'head',.11);
bone('Cap','Head',[0,.40,0],'cap',.18);
for(const [side,label] of [[-1,'Left'],[1,'Right']]){
 bone(`${label}Shoulder`,'Spine2',[side*.11,.15,0],'arm',.10,side);
 bone(`${label}Arm`,`${label}Shoulder`,[side*.17,.075,0],'arm',.10,side);
 bone(`${label}ForeArm`,`${label}Arm`,[side*.225,-.065,.01],'arm',.11,side);
 bone(`${label}Hand`,`${label}ForeArm`,[side*.275,-.20,.035],'hand',.10,side);
 bone(`${label}HandMiddle1`,`${label}Hand`,[side*.30,-.255,.08],'hand',.055,side);
 bone(`${label}UpLeg`,'Hips',[side*.068,-.22,0],'leg',.105,side);
 bone(`${label}Leg`,`${label}UpLeg`,[side*.085,-.35,.005],'leg',.09,side);
 bone(`${label}Foot`,`${label}Leg`,[side*.10,-.455,.05],'foot',.08,side);
 bone(`${label}ToeBase`,`${label}Foot`,[side*.10,-.475,.125],'toe',.07,side);
}
for(const b of bones)b.p[1]+=groundOffset;
const byName=new Map(bones.map((b,i)=>[b.name,{...b,index:i}]));
const joints=new Map();
for(const b of bones){const parent=joints.get(b.parent)||armature,parentP=byName.get(b.parent)?.p||[0,0,0];
 const node=doc.createNode(b.name).setTranslation(b.p.map((v,k)=>v-parentP[k]));parent.addChild(node);joints.set(b.name,node);}
const skin=doc.createSkin('MooncapFungalSkin').setSkeleton(joints.get('mixamorig:Hips'));
for(const b of bones)skin.addJoint(joints.get(b.name));
const ibm=new Float32Array(bones.length*16);
for(let i=0;i<bones.length;i++){
 const [x,y,z]=bones[i].p;ibm.set(new Matrix4().makeTranslation(-x,-y,-z).toArray(),i*16);
}
skin.setInverseBindMatrices(doc.createAccessor('MooncapInverseBinds').setType(Accessor.Type.MAT4).setArray(ibm).setBuffer(root.listBuffers()[0]));
meshNode.setSkin(skin);

const sigmoid=v=>1/(1+Math.exp(-Math.max(-30,Math.min(30,v))));
const segmentDistance=(p,a,b)=>{const d=b.map((v,k)=>v-a[k]),l=d.reduce((s,v)=>s+v*v,0)||1,t=Math.max(0,Math.min(1,p.reduce((s,v,k)=>s+(v-a[k])*d[k],0)/l));return Math.hypot(...p.map((v,k)=>v-a[k]-t*d[k]));};
const ji=new Uint16Array(6945*4),wv=new Float32Array(6945*4),weightMass=new Float64Array(bones.length);
let blended=0,maxWeightError=0;
for(let v=0;v<6945;v++){
 const p=[positions[v*3],positions[v*3+1],positions[v*3+2]],[x,y,z]=p,cy=y-groundOffset,scores=[];
 for(const b of bones){const parent=byName.get(b.parent),d=segmentDistance(p,parent?.p||b.p,b.p);let gate=1;
  const center=.02+.98*Math.exp(-.5*(x/.12)**2);
  if(b.group==='body')gate=center*(.03+.97*sigmoid((.25-cy)/.055))*(.03+.97*sigmoid((cy+.27)/.07));
  if(b.group==='head')gate=center*(.03+.97*sigmoid((cy-.17)/.05));
  if(b.group==='cap')gate=.025+.975*sigmoid((cy-.27)/.035);
  if(b.group==='arm'||b.group==='hand')gate=(.01+.99*sigmoid((b.side*x-.10)/.03))*(.02+.98*sigmoid((.22-cy)/.055))*(.02+.98*sigmoid((cy+.33)/.07));
  if(b.group==='hand')gate*=.02+.98*sigmoid((-.09-cy)/.045);
  if(b.group==='leg'||b.group==='foot'||b.group==='toe')gate=(.02+.98*sigmoid((b.side*x-.025)/.025))*(.02+.98*sigmoid((-.14-cy)/.055));
  if(b.group==='foot'||b.group==='toe')gate*=.02+.98*sigmoid((-.34-cy)/.025);
  if(b.group==='toe')gate*=.04+.96*sigmoid((z-.03)/.035);
  const score=gate*Math.exp(-.5*(d/b.sigma)**2);if(score>1e-12)scores.push({index:byName.get(b.name).index,score});
 }
 scores.sort((a,b)=>b.score-a.score);const selected=scores.slice(0,4),total=selected.reduce((s,q)=>s+q.score,0);let assigned=0,nonzero=0;
 for(let k=0;k<4;k++){const q=selected[k]||selected[0],weight=k>=selected.length?0:k===selected.length-1?1-assigned:q.score/total;ji[v*4+k]=q.index;wv[v*4+k]=weight;assigned+=weight;weightMass[q.index]+=weight;if(weight>1e-6)nonzero++;}
 maxWeightError=Math.max(maxWeightError,Math.abs(assigned-1));if(nonzero>1)blended++;
}
if(maxWeightError>1e-5||blended<6945*.5)throw new Error('Mooncap weight validation failed');
primitive.setAttribute('JOINTS_0',doc.createAccessor('MooncapJoints').setType(Accessor.Type.VEC4).setArray(ji).setBuffer(root.listBuffers()[0]));
primitive.setAttribute('WEIGHTS_0',doc.createAccessor('MooncapWeights').setType(Accessor.Type.VEC4).setArray(wv).setBuffer(root.listBuffers()[0]));

// Retarget the proven native locomotion and frontal hit takes to this fitted fungal skeleton.
const libBytes=await readFile(libraryPath),library=await io.readBinary(libBytes);
const retarget=retargetHumanoid(doc,library);
const motionGround=scene.listChildren().find(n=>n.getName()==='corealm_motion_ground');
if(!motionGround)throw new Error('Retarget ground missing');
motionGround.setScale([2,2,2]);
for(const clip of root.listAnimations())for(const channel of clip.listChannels())if(channel.getTargetNode()===motionGround&&channel.getTargetPath()==='translation'){
 const output=channel.getSampler().getOutput(),values=Float32Array.from(output.getArray());
 for(let i=1;i<values.length;i+=3)values[i]*=2;
 output.setArray(values);
}

// Keep the source's layered lilac atlas. Only downsample and derive dielectric microrelief.
const color=await sharp(sourceImage).resize(2048,2048).jpeg({quality:93,chromaSubsampling:'4:4:4'}).toBuffer();
const rgb=await sharp(color).raw().toBuffer(),gray=await sharp(color).greyscale().raw().toBuffer();
const blurred=await sharp(gray,{raw:{width:2048,height:2048,channels:1}}).blur(2).raw().toBuffer();
const height=new Float32Array(2048*2048),rough=Buffer.alloc(2048*2048*3),normal=Buffer.alloc(2048*2048*3);
for(let i=0;i<height.length;i++){
 const r=rgb[i*3]/255,g=rgb[i*3+1]/255,b=rgb[i*3+2]/255,saturation=Math.max(r,g,b)-Math.min(r,g,b),grain=Math.abs(gray[i]-blurred[i])/255;
 height[i]=(gray[i]-blurred[i])/255;
 const value=Math.max(.75,Math.min(.97,.87-.065*saturation+.06*grain));
 rough[i*3]=255;rough[i*3+1]=Math.round(value*255);rough[i*3+2]=0;
}
for(let y=0;y<2048;y++)for(let x=0;x<2048;x++){
 const i=y*2048+x,l=y*2048+Math.max(0,x-1),r=y*2048+Math.min(2047,x+1),u=Math.max(0,y-1)*2048+x,d=Math.min(2047,y+1)*2048+x;
 let nx=-(height[r]-height[l])*3,ny=-(height[d]-height[u])*3;const s=Math.hypot(nx,ny);if(s>.8){nx*=.8/s;ny*=.8/s;}
 const len=1/Math.sqrt(1+nx*nx+ny*ny);normal[i*3]=Math.round((nx*len*.5+.5)*255);normal[i*3+1]=Math.round((ny*len*.5+.5)*255);normal[i*3+2]=Math.round((len*.5+.5)*255);
}
const normalImage=await sharp(normal,{raw:{width:2048,height:2048,channels:3}}).png().toBuffer();
const roughImage=await sharp(rough,{raw:{width:2048,height:2048,channels:3}}).png().toBuffer();
const material=root.listMaterials()[0],baseTexture=root.listTextures()[0];baseTexture.setImage(color).setMimeType('image/jpeg');
const normalTexture=doc.createTexture('Mooncap layered cap and bark relief').setImage(normalImage).setMimeType('image/png');
const roughTexture=doc.createTexture('Mooncap matte fungal and bark roughness').setImage(roughImage).setMimeType('image/png');
material.setMetallicFactor(0).setRoughnessFactor(1).setNormalScale(.35).setNormalTexture(normalTexture).setMetallicRoughnessTexture(roughTexture);

// Replace jab with a visible two-handed spore cast and a cap pulse.
for(const name of ['Attack','Death'])removeClip(doc,name);
const makeClip=name=>doc.createAnimation(name);
const rotate=(clip,node,times,angles,axis='x')=>addChannel(doc,clip,joints.get(`mixamorig:${node}`),'rotation',times,angles.flatMap(a=>new Quaternion().setFromAxisAngle(new Vector3(axis==='x'?1:0,axis==='y'?1:0,axis==='z'?1:0),a).toArray()));
const attack=makeClip('Attack'),at=[0,.16,.34,.55,.76,1.0];
rotate(attack,'Spine1',at,[0,-.08,-.16,.22,.08,0]);
rotate(attack,'LeftShoulder',at,[0,-.2,-.65,-.95,-.45,0],'z');
rotate(attack,'RightShoulder',at,[0,.2,.65,.95,.45,0],'z');
rotate(attack,'LeftArm',at,[0,-.18,-.55,-.90,-.28,0]);
rotate(attack,'RightArm',at,[0,-.18,-.55,-.90,-.28,0]);
rotate(attack,'LeftForeArm',at,[0,-.10,-.35,.25,.12,0]);
rotate(attack,'RightForeArm',at,[0,-.10,-.35,.25,.12,0]);
rotate(attack,'Cap',at,[0,-.08,-.18,.19,.08,0]);
addChannel(doc,attack,joints.get('mixamorig:Cap'),'scale',at,[1,1,1,1.03,1,1.03,1.08,1,1.08,1,1,1,1,1,1,1,1,1]);

// Death is a rapid whole-body wilt followed by a still, grounded side fall.
const death=makeClip('Death'),dt=[0,.12,.25,.4,.55,.65,1.5];
rotate(death,'Spine1',dt,[0,.10,.22,.38,.47,.50,.50]);
rotate(death,'Head',dt,[0,.06,.16,.32,.42,.45,.45]);
rotate(death,'Cap',dt,[0,.08,.19,.35,.43,.45,.45]);
rotate(death,'LeftArm',dt,[0,.12,.25,.42,.5,.52,.52]);
rotate(death,'RightArm',dt,[0,-.10,-.24,-.39,-.48,-.5,-.5]);
rotate(death,'LeftUpLeg',dt,[0,-.04,-.13,-.27,-.35,-.38,-.38]);
rotate(death,'RightUpLeg',dt,[0,.04,.14,.28,.36,.39,.39]);
addChannel(doc,death,armature,'rotation',dt,[0,.12,.4,.88,1.32,1.56,1.56].flatMap(a=>new Quaternion().setFromAxisAngle(new Vector3(0,0,1),a).toArray()));
addChannel(doc,death,armature,'scale',dt,[0,.25,.70,.90,.98,1,1].flatMap(p=>[1-.18*p,1-.30*p,1-.08*p]));
const rest=storedPose(doc),floorTimes=Array.from({length:61},(_,i)=>i*1.5/60),raw=[];
for(const t of floorTimes){restorePose(rest);applyClip(death,t);raw.push(deformedBounds(doc));}
restorePose(rest);
const floorLift=raw.map(b=>Math.max(0,.006-b.min[1]));
addChannel(doc,death,motionGround,'translation',floorTimes,floorLift.flatMap(l=>[0,l,0]));
const deathSamples=[];
for(const t of [0,.25,.4,.55,.65,.8,1,1.5]){restorePose(rest);applyClip(death,t);const b=deformedBounds(doc);deathSamples.push({seconds:t,minY:b.min[1],topY:b.max[1]});}
restorePose(rest);
if(deathSamples.find(s=>s.seconds===.65).topY>deathSamples[0].topY*.64||deathSamples.some(s=>s.minY<-.02))throw new Error(`Death failed: ${JSON.stringify(deathSamples)}`);
if(Math.abs(deathSamples.find(s=>s.seconds===.65).topY-deathSamples.at(-1).topY)>.002)throw new Error('Death does not hold its final pose');
const motionSamples={};
for(const clip of root.listAnimations().filter(a=>a!==death)){
 const length=duration(clip),checks=[];
 for(let i=0;i<=8;i++){restorePose(rest);applyClip(clip,i*length/8);const b=deformedBounds(doc);checks.push({seconds:+(i*length/8).toFixed(4),minY:b.min[1],topY:b.max[1]});}
 if(checks.some(s=>s.minY<-.035||s.minY>.15))throw new Error(`${clip.getName()} floor invalid: ${JSON.stringify(checks)}`);
 motionSamples[clip.getName()]=checks;
}
restorePose(rest);
const bounds=deformedBounds(doc),output=await io.writeBinary(doc),name='mooncap-sporekin-candidate.glb',file=`${dir}/${name}`;
await writeFile(file,output);
const check=(await io.readBinary(output)).getRoot(),cp=check.listMeshes()[0].listPrimitives()[0];
for(const [semantic,hash]of Object.entries(sourceGeometry))if(sha(Buffer.from(cp.getAttribute(semantic).getArray().buffer))!==hash)throw new Error(`${semantic} changed`);
if(sha(Buffer.from(cp.getIndices().getArray().buffer))!==sourceIndices)throw new Error('Indices changed');
const existing=JSON.parse(await readFile('game/public/assets/manifest.json','utf8')).assets.find(a=>a.id==='fairy_garden_sporekin_gloamgarden');
const candidate={id:existing.id,file:existing.file,candidateFile:file,pack:'corealm-tripo-audit-mooncap-sporekin',category:'character',is:'Mooncap Sporekin',tags:['creature','fairy','fungus','sporekin','tripo'],
 bytes:output.length,sha256:sha(output),size:{x:bounds.max[0]-bounds.min[0],y:bounds.max[1]-bounds.min[1],z:bounds.max[2]-bounds.min[2]},base:{x:bounds.min[0],y:bounds.min[1],z:bounds.min[2]},bounds,groundY:0,triangles:4713,
 animations:check.listAnimations().map(a=>a.getName()),materials:check.listMaterials().map(m=>m.getName()),walkClipSeconds:duration(check.listAnimations().find(a=>a.getName()==='Walk')),runClipSeconds:duration(check.listAnimations().find(a=>a.getName()==='Run')),attackSeconds:1,contactNormalized:.55,
 locomotionPolicy:null,impliedWalkMps:null,impliedRunMps:null,measuredGait:null,
 sourceProvenance:{tool:'Tripo Studio',projectId:'eab6d009-e9e3-4685-ad92-370117420c63',sourceFile:source,sourceSha256:sourceSha,sourceOperatorId:'16ca8513-2496-49f3-934c-713ecedd022f',sourceTextureSha256:sha(sourceImage),rig:'Source unrigged; anatomical 25-joint fitted skin built with four normalized weights per vertex',motionLibrary:libraryPath,motionLibrarySha256:sha(libBytes)},
 metadata:{sourceGeometry:{vertices:6945,triangles:4713,sourcePositionSha256:sourcePositionSha,rigidGroundOffsetY:groundOffset,sourceShapeNormalsUvAndIndicesPreserved:true},sourceIdentity:'Broad lilac mushroom cap, gills, woody branch arms, root feet; compact level-30 fairy fungus',presentation:{sceneScale:2,rawHeightMeters:bounds.max[1]-bounds.min[1],existingSpeciesScale:.5117755641361406},
  textures:{sourceBaseColor:[8192,8192],runtimeBaseColor:[2048,2048],derivedNormal:[2048,2048],derivedRoughness:[2048,2048],reskin:false},rig:{joints:bones.length,blendedVertices:blended,maxWeightError},retarget:{...retarget,clips:retarget.clips.filter(c=>!['Attack','Death'].includes(c.name)),customAttackAndDeath:true},deathSamples},
 acceptance:{sourceIdentityVerified:true,labAccepted:false,worldIntegrated:false}};
await writeFile(`${dir}/lab-catalog.json`,JSON.stringify({schema:'corealm-lab-asset-candidates/1',assets:[{...candidate,file:name,candidateFile:undefined}],files:{[candidate.id]:name}},null,2));
await writeFile(`${dir}/promotion.json`,JSON.stringify({schema:'corealm-creature-promotion/1',assets:[candidate],pack:{id:candidate.pack,name:'Corealm Tripo Mooncap Sporekin',author:'Corealm / Tripo Studio',source:`${dir}/build-mooncap.mjs`,license:'LicenseRef-Corealm-Original',generatorSha256:'TO_BE_FILLED'}},null,2));
await writeFile(`${dir}/validation.json`,JSON.stringify({sourceSha256:sourceSha,candidateSha256:candidate.sha256,restBounds:bounds,deathSamples,motionSamples,rig:{joints:bones.length,blendedVertices:blended,maxWeightError,weightMass:Array.from(weightMass)},clipNames:candidate.animations,textureSha256:root.listTextures().map(t=>[t.getName(),sha(t.getImage())])},null,2));
console.log(JSON.stringify({file,sha256:candidate.sha256,bounds,clips:candidate.animations,deathSamples,rig:{joints:bones.length,blended,maxWeightError}},null,2));
