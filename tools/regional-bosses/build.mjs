/** Seven authored hero bodies. Exports candidates only; root promotes after lab review. */
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {prune} from '@gltf-transform/functions';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import * as T from 'three';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const OUT='test-results/regional-bosses';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z),M=a=>new T.Matrix4().fromArray(a);
const smooth=(a,b,x)=>T.MathUtils.smoothstep(x,a,b),bell=(x,c,w)=>Math.exp(-(((x-c)/w)**2));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const plans=[
 {id:'tempest_roc',base:'flint_mandible',tempo:1.13,torso:/beetle_3_Bone_002$/,head:/beetle_5_Bone_004$/,
  design:'A low storm scarab with three swept carapace shields, a broad crescent shovel cranium and thick inward-cutting mandibles. The shell counter-rolls through its braced digging strike.',
  field(v){const torso=bell(v.y,1.45,.60)*(1-smooth(.45,.9,Math.abs(v.x))),head=smooth(1.55,1.9,v.y)*smooth(.6,.9,v.z);return V(v.x*(1.04+torso*.24+head*.25),v.y*.94-head*.08,v.z*(1+torso*.18));}},
 {id:'galeskin',base:'briar_harrow',tempo:1.18,torso:/_Spine3$/,head:/_Head$/,
  design:'A wind-stripped elder with a sideways-split timber mantle, one enlarged root forearm and a hollow wind-cut head. Long flattened timber ribs grow continuously out of its shoulders and bow in the walking cycle.',
  field(v){const upper=smooth(1.1,2.3,v.y),arm=smooth(.6,.95,Math.abs(v.x))*(1-smooth(1.7,2.1,v.y)),handLift=.18*smooth(.57,.82,Math.abs(v.x))*(1-smooth(.65,1.05,v.y));return V(v.x*(1.06+upper*.12+arm*(v.x<0?.26:.06)),v.y*(1+upper*.035)+handLift,v.z-upper*.10);}},
 {id:'rootheart',base:'briar_harrow',tempo:1.29,torso:/_Spine3$/,head:/_Head$/,
  design:'An ancient walking cathedral tree. Its ordinary torso and head are replaced by a split hollow trunk, two load-bearing arches and a recessed heart chamber. Root buttresses continue into its legs; asymmetric boughs frame an empty central silhouette.',
  field(v){const upper=smooth(.8,2,v.y),arm=smooth(.62,.9,Math.abs(v.x)),handLift=.14*smooth(.57,.82,Math.abs(v.x))*(1-smooth(.65,1.05,v.y));return V(v.x*(1.05+upper*.15+arm*.10),v.y+upper*.35+handLift,v.z-upper*.13);}},
 {id:'mossbound',base:'thorn_maw',tempo:1.21,torso:/beetle_3_Bone_002$/,head:/beetle_5_Bone_004$/,
  design:'A broad-bodied mature seed predator. Four interlocking woody pod valves surround a dark feeding chamber; curled root mandibles and an articulated jaw throat open into its attack. Thick shoulder pods carry its extra weight.',
  field(v){const upper=smooth(.6,1.6,v.y),jaw=smooth(.3,.7,v.z);return V(v.x*(1.15+upper*.16),v.y*(1+upper*.08),v.z*(1+jaw*.23));}},
 {id:'tideworn',base:'flint_mandible',tempo:1.25,torso:/beetle_3_Bone_002$/,head:/beetle_5_Bone_004$/,
  design:'An eroded shore colossus with a vaulted wave-cut shell and one enormous split crushing claw. Low layered back shelves and a sunken frontal mouth separate it from the high-domed storm scarab. The crushing side leads its attack.',
  field(v){const arm=smooth(.7,1.35,-v.x),body=bell(v.y,1.6,.6)*(1-smooth(.4,.8,Math.abs(v.x)));return V(v.x*(1+arm*.24+body*.25),v.y*.91+arm*.04,v.z*(1+arm*.23+body*.45));}},
 {id:'ordrun',base:'vault_custodian',tempo:1.24,torso:/spine_03$/,head:/^Head$/,
  design:'A quarry fortress given legs. Its entire upper body is rebuilt as twin open stone vaults, a slotted gate head, broken lintel shoulders and staggered masonry crushing fists. A hanging arch chest compresses over planted feet in the heavy strike.',
  field(v){const upper=smooth(.85,1.7,v.y),arms=smooth(.7,1.25,Math.abs(v.x));return V(v.x*(1.1+upper*.13+arms*.02),v.y+upper*.28,v.z*(1+upper*.28));}},
 {id:'cinderwake',base:'kiln_marrow',tempo:1.25,torso:/_ribs$/,head:/_head$/,
  design:'A furnace tyrant with a wide fused slag mantle, an open barred chest furnace, a recessed iron face and an enlarged asymmetric hammer arm. Thick ribs occlude the fire; the body braces, compresses and rolls forward on impact.',
  field(v){const upper=smooth(1.1,2.3,v.y),arm=smooth(.65,.9,-v.x);return V(v.x*(1.10+upper*.17+arm*.13),v.y+upper*.20,v.z*(1+upper*.2+arm*.20));}},
];

await mkdir(OUT,{recursive:true});
const only=process.argv.includes('--only')?process.argv[process.argv.indexOf('--only')+1]:null;
let catalog={assets:[],files:{}};
if(only){try{catalog=JSON.parse(await readFile(`${OUT}/catalog.json`,'utf8'));}catch{}}
for(const plan of plans.filter(p=>!only||p.id===only)){
 const parent=manifest.assets.find(a=>a.id===`creature_${plan.base}`);
 if(!parent)throw new Error(`Accepted source missing: ${plan.base}`);
 const doc=await io.read(`game/public/assets/${parent.file}`),root=doc.getRoot(),scene=root.listScenes()[0],buffer=root.listBuffers()[0];
 const nodes=root.listNodes(),skin=root.listSkins()[0],joints=skin.listJoints(),jointSet=new Set(joints);
 const oldWorld=new Map(nodes.map(n=>[n,M(n.getWorldMatrix())])),oldLocal=new Map(joints.map(n=>[n,n.getTranslation()]));
 const state={deformedVertices:0,removedTriangles:0,addedTriangles:0,parts:[],motionEdits:[],attachmentRepairs:[]};
 const stoneBoss=plan.id==='tempest_roc'||plan.id==='tideworn';
 let stoneTextureSource;
 if(stoneBoss){
  const donor=manifest.assets.find(a=>a.id==='creature_vault_custodian'),donorDoc=await io.read(`game/public/assets/${donor.file}`),texture=donorDoc.getRoot().listMaterials().find(m=>m.getBaseColorTexture()).getBaseColorTexture();
  const accepted=doc.createTexture(`boss_${plan.id}_weathered_stone`).setImage(texture.getImage()).setMimeType(texture.getMimeType());
  stoneTextureSource={assetId:donor.id,assetSha256:donor.sha256,textureSha256:sha(texture.getImage()),provenance:structuredClone(donor.metadata?.provenance)};
  for(const material of root.listMaterials())material.setBaseColorTexture(accepted).setBaseColorFactor(plan.id==='tideworn'?[.57,.64,.61,1]:[.45,.49,.53,1]).setNormalTexture(null).setMetallicRoughnessTexture(null).setRoughnessFactor(.94).setMetallicFactor(0);
 }
 const access=(type,values)=>doc.createAccessor().setType(type).setArray(Float32Array.from(values)).setBuffer(buffer);
 const ji=pattern=>{const i=joints.findIndex(j=>typeof pattern==='string'?j.getName()===pattern:pattern.test(j.getName()));if(i<0)throw new Error(`${plan.id}: missing joint ${pattern}`);return i;};
 const jp=pattern=>V().setFromMatrixPosition(M(joints[ji(pattern)].getWorldMatrix()));
 // Normalize every retained mesh into world bind coordinates. Rigid anatomy attached to
 // source bones joins the same skin so sample/bake/live paths all receive it identically.
 for(const node of nodes){const mesh=node.getMesh();if(!mesh)continue;
  const sourceSkin=node.getSkin(),sourceJoints=sourceSkin?.listJoints(),binds=sourceSkin?.listJoints().map((j,i)=>oldWorld.get(j).clone().multiply(M(sourceSkin.getInverseBindMatrices().getElement(i,[]))));
  let ancestor=node.getParentNode();while(ancestor&&!jointSet.has(ancestor))ancestor=ancestor.getParentNode();
  const rigidIndex=ancestor?joints.indexOf(ancestor):0;
  for(const p of mesh.listPrimitives()){
   const position=p.getAttribute('POSITION'),arr=Float32Array.from(position.getArray()),weights=p.getAttribute('WEIGHTS_0'),sourceIndices=p.getAttribute('JOINTS_0');
   const newIndices=new Uint16Array(position.getCount()*4),newWeights=new Float32Array(position.getCount()*4);
   for(let i=0;i<position.getCount();i++){
    const raw=V().fromArray(arr,i*3),world=V();
    if(binds&&weights){const w=weights.getElement(i,[]),jj=sourceIndices.getElement(i,[]);for(let k=0;k<4;k++){newWeights[i*4+k]=w[k];newIndices[i*4+k]=joints.indexOf(sourceJoints[jj[k]]);if(w[k])world.addScaledVector(raw.clone().applyMatrix4(binds[jj[k]]),w[k]);}}
    else{world.copy(raw).applyMatrix4(oldWorld.get(node));newIndices[i*4]=rigidIndex;newWeights[i*4]=1;}
    const next=plan.field(world);if(next.distanceTo(world)>.001)state.deformedVertices++;next.toArray(arr,i*3);
   }
   p.setAttribute('POSITION',access('VEC3',arr));p.setAttribute('JOINTS_0',doc.createAccessor().setType('VEC4').setArray(newIndices).setBuffer(buffer));p.setAttribute('WEIGHTS_0',access('VEC4',newWeights));normal(p,access);
   if(stoneBoss){const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(arr,3)).setAttribute('normal',new T.Float32BufferAttribute(p.getAttribute('NORMAL').getArray(),3));uvPlanar(g);p.setAttribute('TEXCOORD_0',access('VEC2',g.attributes.uv.array));}
  }
  node.getParentNode()?.removeChild(node);scene.addChild(node);node.setTranslation([0,0,0]).setRotation([0,0,0,1]).setScale([1,1,1]).setSkin(skin);
 }
 // Refit the bind skeleton in the same anatomical field. Preserve native contact motion
 // relative to the new rest pose; authored rig constraints must not undo the refit.
 scene.traverse(node=>{if(!jointSet.has(node))return;const world=stoneBoss&&plan.head.test(node.getName())?V(0,plan.id==='tideworn'?1.65:1.72,plan.id==='tideworn'?.75:.78):plan.field(V().setFromMatrixPosition(oldWorld.get(node))),parentMatrix=node.getParentNode()?M(node.getParentNode().getWorldMatrix()):new T.Matrix4();node.setTranslation(world.applyMatrix4(parentMatrix.invert()).toArray());});
 if(stoneBoss)state.attachmentRepairs.push({part:'complete replacement cranium',joint:joints[ji(plan.head)].getName(),change:'Removed the full original distal jaw surface, including the detached side plate; refitted its pivot to the authored skull centre and added an overlapping articulated neck.'});
 skin.setInverseBindMatrices(access('MAT4',joints.flatMap(j=>M(j.getWorldMatrix()).invert().toArray())));
 for(const a of root.listAnimations())for(const c of a.listChannels())if(c.getTargetPath()==='translation'&&jointSet.has(c.getTargetNode())){
  const node=c.getTargetNode(),old=oldLocal.get(node),next=node.getTranslation(),ratio=Math.hypot(...old)>.01?T.MathUtils.clamp(Math.hypot(...next)/Math.hypot(...old),.65,1.6):1;
  const s=c.getSampler(),out=Float32Array.from(s.getOutput().getArray());for(let i=0;i<out.length;i+=3)for(let k=0;k<3;k++)out[i+k]=next[k]+(out[i+k]-old[k])*ratio;s.setOutput(access('VEC3',out));
 }
 const sourceMat=plan.id==='cinderwake'?root.listMaterials().find(m=>m.getName().endsWith('_layered_slag')):root.listMaterials().find(m=>m.getBaseColorTexture()),materials=new Map();
 function mat(name,color=[1,1,1,1],rough=.92){if(materials.has(name))return materials.get(name);const m=sourceMat.clone().setName(`animal_rpg_boss_${plan.id}_${name}`).setBaseColorFactor(color).setRoughnessFactor(rough).setMetallicFactor(0).setNormalTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null).setEmissiveFactor([0,0,0]);materials.set(name,m);return m;}
 const surface=mat('anatomy',plan.id==='tideworn'?[.57,.64,.61,1]:plan.id==='tempest_roc'?[.45,.49,.53,1]:plan.id==='cinderwake'?[.76,.74,.70,1]:[1,1,1,1]);
 const inner=mat('inner_growth',[.13,.15,.13,1],1),edge=mat('eroded_edges',plan.id==='tideworn'?[.65,.69,.65,1]:plan.id==='tempest_roc'?[.56,.60,.62,1]:[.90,.87,.74,1]);
 const batches=new Map();
 function geo(name,g,material,bone){
  g.computeVertexNormals();if(!g.attributes.uv)uvPlanar(g);
  if(plan.id==='cinderwake'){
   // The authored ash atlas contains six materials. New furnace anatomy uses only
   // its slag tile, with a continuous coordinate map inside that tile's gutters.
   const uv=g.attributes.uv;let u0=Infinity,v0=Infinity,u1=-Infinity,v1=-Infinity;
   for(let i=0;i<uv.count;i++){u0=Math.min(u0,uv.getX(i));u1=Math.max(u1,uv.getX(i));v0=Math.min(v0,uv.getY(i));v1=Math.max(v1,uv.getY(i));}
   for(let i=0;i<uv.count;i++)uv.setXY(i,(1.035+.93*(uv.getX(i)-u0)/Math.max(.001,u1-u0))/3,(.035+.93*(uv.getY(i)-v0)/Math.max(.001,v1-v0))/2);
  }
  const index=typeof bone==='number'?bone:ji(bone),key=material.getName();
  const p=doc.createPrimitive().setAttribute('POSITION',access('VEC3',g.attributes.position.array)).setAttribute('NORMAL',access('VEC3',g.attributes.normal.array)).setAttribute('TEXCOORD_0',access('VEC2',g.attributes.uv.array)).setMaterial(material);
  const jj=new Uint16Array(g.attributes.position.count*4),ww=new Float32Array(jj.length);for(let i=0;i<g.attributes.position.count;i++){jj[i*4]=index;ww[i*4]=1;}
  p.setAttribute('JOINTS_0',doc.createAccessor().setType('VEC4').setArray(jj).setBuffer(buffer)).setAttribute('WEIGHTS_0',access('VEC4',ww));
  if(g.index)p.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(g.index.array)).setBuffer(buffer));
  const old=batches.get(key);
  if(old){const count=old.getAttribute('POSITION').getCount(),ids=[...old.getIndices().getArray(),...Array.from(p.getIndices()?.getArray()??Array.from({length:g.attributes.position.count},(_,i)=>i),i=>i+count)];
   for(const semantic of ['POSITION','NORMAL','TEXCOORD_0','WEIGHTS_0']){const a=old.getAttribute(semantic),b=p.getAttribute(semantic);old.setAttribute(semantic,access(a.getType(),[...a.getArray(),...b.getArray()]));}
   old.setAttribute('JOINTS_0',doc.createAccessor().setType('VEC4').setArray(Uint16Array.from([...old.getAttribute('JOINTS_0').getArray(),...jj])).setBuffer(buffer));old.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(ids)).setBuffer(buffer));p.dispose();
  }else{
   if(!p.getIndices())p.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from({length:g.attributes.position.count},(_,i)=>i)).setBuffer(buffer));
   scene.addChild(doc.createNode(`boss_${plan.id}_${name}`).setMesh(doc.createMesh(`boss_${plan.id}_${name}`).addPrimitive(p)).setSkin(skin));batches.set(key,p);
  }
  state.parts.push({name,joint:joints[index].getName(),triangles:(g.index?.count??g.attributes.position.count)/3});state.addedTriangles+=(g.index?.count??g.attributes.position.count)/3;
 }
 const ell=(name,c,r,material,bone,detail=2)=>{const g=new T.IcosahedronGeometry(1,detail);g.scale(...r);g.translate(...c);uvPlanar(g);geo(name,g,material,bone);};
 const tube=(name,points,radii,material,bone,flat=1)=>geo(name,tubeGeometry(points,radii,flat),material,bone);
 const plate=(name,outline,depth,material,bone)=>{const shape=new T.Shape();outline.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();const g=new T.ExtrudeGeometry(shape,{depth,steps:1,bevelEnabled:true,bevelSize:.026,bevelThickness:.025,bevelSegments:1});g.translate(0,0,-depth*.5);uvPlanar(g);geo(name,g,material,bone);};
 function remove(predicate){for(const n of nodes){const mesh=n.getMesh();if(!mesh)continue;for(const p of mesh.listPrimitives()){
  const pos=p.getAttribute('POSITION'),idx=Array.from(p.getIndices()?.getArray()??Array.from({length:pos.getCount()},(_,i)=>i)),keep=[];
  for(let i=0;i<idx.length;i+=3){const ids=idx.slice(i,i+3),vv=ids.map(k=>V().fromArray(pos.getArray(),k*3));if(predicate(vv,n,p,ids))state.removedTriangles++;else keep.push(...ids);}
  if(!keep.length)mesh.removePrimitive(p);else p.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(keep)).setBuffer(buffer));
 }if(!mesh.listPrimitives().length)n.setMesh(null);}}
 const chest=ji(plan.torso),head=ji(plan.head);
 const sourceHeadTriangle=(p,ids)=>ids.every(i=>{const weights=p.getAttribute('WEIGHTS_0').getElement(i,[]),indices=p.getAttribute('JOINTS_0').getElement(i,[]);return weights.reduce((sum,w,k)=>sum+(indices[k]===head?w:0),0)>.5;});
 if(plan.id==='tempest_roc'){
  remove((vv,n,p,ids)=>sourceHeadTriangle(p,ids));
  tube('articulated_neck',[[0,1.53,.24],[0,1.64,.43],[0,1.71,.66]],[.29,.28,.23],surface,/beetle_4_Bone_003$/);
  for(let i=0;i<3;i++){
   const y=1.66+i*.16,z=-.35+i*.10;
   ell(`swept_carapace_${i}`,[0,y,z],[.73-i*.06,.31,.72-i*.06],surface,chest,2);
   for(const sign of [-1,1])tube(`carapace_fold_${i}_${sign}`,[[sign*.1,y+.23,z+.35],[sign*.51,y+.17,z+.12],[sign*(.78-i*.04),y-.03,z-.25],[sign*(.85-i*.05),y-.10,z-.5]],[.062,.075,.040,.003],edge,chest,.7);
  }
  const blade=new T.Shape();blade.moveTo(-.71,0);blade.quadraticCurveTo(-.42,.27,0,.31);blade.quadraticCurveTo(.43,.27,.71,0);blade.lineTo(.57,-.20);blade.quadraticCurveTo(0,-.01,-.57,-.20);blade.closePath();
  const g=new T.ExtrudeGeometry(blade,{depth:.24,bevelEnabled:true,bevelSize:.035,bevelThickness:.03,bevelSegments:1,curveSegments:6});g.rotateX(-.22);g.translate(0,1.72,.78);uvPlanar(g);geo('crescent_cranium',g,surface,head);
  for(const sign of [-1,1])tube(`cutting_mandible_${sign}`,[[sign*.33,1.60,.84],[sign*.50,1.48,1.08],[sign*.38,1.43,1.32],[sign*.10,1.53,1.27]],[.13,.14,.08,.004],edge,head,.65);
 }
 if(plan.id==='galeskin'){
  remove((vv,n)=>n.getName()==='briar_harrow_sculpted_body'||vv.every(v=>Math.abs(v.x)<.23&&v.y>1.9&&v.z>.30));
  for(const sign of [-1,1])for(let i=0;i<3;i++){
   const low=1.35+i*.18,side=sign*(.38+i*.09);
   tube(`wind_split_mantle_${sign}_${i}`,[[sign*.18,low,-.44],[side,2.05+i*.04,-.55],[sign*(.93+i*.15),2.47-i*.12,-.57],[sign*(1.2+i*.13),2.57-i*.09,-.66]],[.20-i*.026,.16,.075,.008],surface,chest,.64);
   if(i!==2)tube(`returning_root_rib_${sign}_${i}`,[[sign*.15,1.42+i*.23,-.33],[sign*.55,1.82+i*.19,-.52],[sign*(.98+i*.20),2.32-i*.08,-.59]],[.095,.13,.007],edge,chest,.67);
  }
  for(const sign of [-1,1])tube(`open_wind_head_${sign}`,[[sign*.21,1.77,.40],[sign*.27,2.02,.48],[sign*.18,2.30,.40],[sign*.025,2.41,.29]],[.085,.105,.075,.016],surface,head);
  ell('blind_head_recess',[0,2.02,.30],[.21,.30,.08],inner,head);
  const left=jp(/_Forearm_R$/);tube('ancestral_root_forearm',[[left.x-.08,left.y+.31,left.z],[left.x-.17,left.y-.04,left.z+.06],[left.x-.23,left.y-.43,left.z+.12],[left.x-.1,left.y-.66,left.z+.24]],[.23,.24,.16,.04],surface,/_Forearm_R$/);
 }
 if(plan.id==='rootheart'){
  remove((vv,n)=>n.getName()==='briar_harrow_sculpted_body'||vv.every(v=>Math.abs(v.x)<.50&&v.y>1.46));
  ell('deep_heart_chamber',[0,2.03,-.46],[.38,.64,.18],inner,chest,2);
  for(const sign of [-1,1]){
   tube(`cathedral_trunk_${sign}`,[[sign*.18,.88,-.38],[sign*.40,1.52,-.38],[sign*.55,2.12,-.47],[sign*.42,2.76,-.48],[sign*.14,3.12,-.46]],[.25,.23,.20,.17,.055],surface,chest);
   tube(`loaded_arch_${sign}`,[[sign*.23,1.33,-.54],[sign*.66,2.14,-.76],[sign*.83,2.75,-.67],[sign*.61,3.32,-.57],[sign*.18,3.50,-.56]],[.19,.17,.13,.075,.004],surface,chest);
   tube(`root_buttress_${sign}`,[[sign*.18,1.54,-.30],[sign*.38,1.03,-.39],[sign*.38,.73,-.34]],[.19,.15,.04],surface,sign<0?/_Thigh_R$/:/_Thigh_L$/);
   tube(`living_cambium_${sign}`,[[sign*.11,1.55,-.16],[sign*.35,1.97,-.22],[sign*.40,2.38,-.32],[sign*.23,2.76,-.30]],[.062,.075,.06,.018],edge,chest);
   const arm=jp(sign<0?/_Arm_R$/:/_Arm_L$/);
   tube(`shoulder_bough_${sign}`,[[arm.x,arm.y-.10,arm.z],[sign*.95,2.47,-.15],[sign*1.35,2.84,-.24],[sign*1.41,3.21,-.28]],[.23,.17,.08,.008],surface,sign<0?/_Arm_R$/:/_Arm_L$/);
  }
  tube('buried_root_heart',[[0,1.61,-.23],[-.04,1.9,-.21],[.05,2.19,-.28],[0,2.43,-.30]],[.09,.12,.09,.035],edge,chest);
 }
 if(plan.id==='mossbound'){
  remove((vv,n)=>n.getName()==='thorn_maw_sculpted_body'&&vv.every(v=>v.y>1.65&&v.z>.30));
  ell('feeding_chamber',[0,1.86,.48],[.47,.52,.36],inner,head,2);
  for(const sign of [-1,1]){
   tube(`upper_pod_valve_${sign}`,[[sign*.15,1.58,.34],[sign*.49,1.93,.42],[sign*.48,2.37,.44],[sign*.16,2.55,.52],[sign*.055,2.33,.69]],[.20,.22,.17,.095,.025],surface,head,.78);
   tube(`lower_pod_valve_${sign}`,[[sign*.32,1.55,.37],[sign*.47,1.51,.69],[sign*.36,1.51,1.0],[sign*.08,1.65,1.12]],[.14,.16,.095,.008],edge,/beetle_4_Bone_003$/,.6);
   for(let i=0;i<2;i++)ell(`shoulder_pod_${sign}_${i}`,[sign*(.58+i*.17),1.64+i*.13,-.03-i*.13],[.29,.38,.38],surface,chest,1);
   tube(`root_jaw_${sign}`,[[sign*.26,1.91,.82],[sign*.40,1.76,1.04],[sign*.29,1.61,1.19],[sign*.08,1.75,1.1]],[.075,.075,.047,.004],edge,head);
  }
  for(let i=0;i<3;i++)tube(`throat_fold_${i}`,[[0,1.5-i*.09,.64],[.03,1.42-i*.1,.76],[0,1.33-i*.11,.68]],[.09,.07,.012],surface,/beetle_4_Bone_003$/,.6);
 }
 if(plan.id==='tideworn'){
  remove((vv,n,p,ids)=>vv.every(v=>v.x<-.9&&v.y<1.28)||sourceHeadTriangle(p,ids));
  tube('articulated_neck',[[0,1.48,.20],[0,1.56,.43],[0,1.65,.65]],[.30,.28,.24],surface,/beetle_4_Bone_003$/);
  for(let i=0;i<4;i++){
   ell(`eroded_wave_shelf_${i}`,[0,1.50+i*.15,-.40-i*.08],[.83-i*.09,.24,.70-i*.045],surface,chest,1);
   tube(`shell_waterline_${i}`,[[-.69+i*.06,1.6+i*.15,-.17],[0,1.64+i*.15,-.89-i*.05],[.69-i*.06,1.6+i*.15,-.17]],[.045,.06,.025],edge,chest);
  }
  const clawBone=/beetle_17_Bone_001_R_003$/;
  tube('crushing_claw_outer',[[-1.0,1.30,.02],[-1.73,1.10,.0],[-2.18,.69,.14],[-2.13,.36,.35],[-1.78,.39,.52]],[.23,.39,.33,.20,.04],surface,clawBone);
  tube('crushing_claw_inner',[[-1.20,1.12,.10],[-1.23,.74,.32],[-1.41,.45,.53],[-1.79,.45,.58]],[.19,.24,.17,.035],edge,/beetle_20_Bone_001_R_006$/);
  ell('sunken_cranium',[0,1.65,.75],[.44,.25,.28],surface,head,1);
  for(const sign of [-1,1])tube(`short_feeding_hook_${sign}`,[[sign*.24,1.63,.87],[sign*.32,1.46,1.02],[sign*.11,1.45,1.1]],[.11,.09,.007],edge,head,.65);
 }
 if(plan.id==='ordrun'){
  remove((vv,n)=>/vault_custodian_(hollow|vault|visor|lintel|gate_fist)/.test(n.getName()));
  for(const sign of [-1,1]){
   geo(`open_quarry_vault_${sign}`,archGeometry(.74,1.11,.56,sign*.35,1.73,.04),surface,chest);
   const shoulder=jp(sign<0?'upperarm_r':'upperarm_l'),hand=jp(sign<0?'hand_r':'hand_l'),bone=sign<0?'upperarm_r':'upperarm_l';
   geo(`broken_lintel_${sign}`,block(.81,.37,.68,shoulder.x,shoulder.y+.22,shoulder.z),edge,bone);
   for(let i=0;i<3;i++)geo(`layered_gate_fist_${sign}_${i}`,block(.66,.21,.68,hand.x,hand.y-.18+i*.18,hand.z+(i%2)*.09),surface,sign<0?'hand_r':'hand_l');
   geo(`vault_buttress_${sign}`,block(.25,.86,.51,sign*.64,1.55,-.02),surface,chest);
  }
  geo('gate_head',archGeometry(.52,.57,.44,0,2.33,.04),edge,head);
  geo('heavy_brow',block(.76,.20,.56,0,2.60,.06),surface,head);
  geo('split_lower_keystone',block(.28,.37,.68,0,1.25,.035),edge,chest);
  for(let i=0;i<3;i++)geo(`dorsal_crushed_column_${i}`,block(.27,.37+i*.14,.43,(i-1)*.39,2.22+i*.07,-.43),surface,chest);
 }
 if(plan.id==='cinderwake'){
  remove((vv,n)=>n.getName().startsWith('kiln_marrow_')||vv.every(v=>Math.abs(v.x)<.46&&v.y>1.54&&v.y<2.53&&v.z>.06));
  ell('black_furnace_cavity',[0,2.03,-.13],[.54,.65,.20],inner,chest,2);
  const ember=mat('recessed_furnace',[.47,.22,.10,1],1).setEmissiveFactor([.85,.18,.016]);
  ell('banked_fire',[0,2.00,.12],[.35,.52,.08],ember,chest,2);
  for(const sign of [-1,1]){
   for(let i=0;i<5;i++){const y=1.55+i*.2;tube(`furnace_bar_${sign}_${i}`,[[sign*.43,y+.12,-.10],[sign*.52,y+.10,.13],[sign*.31,y,.28],[sign*.07,y-.015,.31]],[.085,.085,.072,.045],surface,chest);}
   const shoulder=jp(sign<0?/_upper_arm_R$/:/_upper_arm_L$/);
   ell(`fused_slag_mantle_${sign}`,[sign*.61,2.56,-.18],[.63,.50,.47],surface,/_spine1$/,2);
   for(let i=0;i<3;i++)tube(`cooled_lava_fold_${sign}_${i}`,[[sign*.31,2.73,-.26],[sign*(.62+i*.1),2.80-i*.13,-.36],[sign*(1.1-i*.12),2.44-i*.16,-.24]],[.13,.10,.026],edge,/_spine1$/);
   if(sign<0)ell('slag_hammer_forearm',[shoulder.x-.27,shoulder.y-.82,shoulder.z],[.46,.61,.43],surface,/_forearm_R$/,2);
  }
  for(const sign of [-1,1])tube(`iron_face_cheek_${sign}`,[[sign*.20,2.35,.28],[sign*.27,2.57,.39],[sign*.17,2.79,.39],[sign*.025,2.82,.31]],[.12,.13,.10,.05],surface,head,.8);
  ell('sunken_face',[0,2.59,.28],[.20,.23,.09],inner,head,1);
  tube('heavy_furnace_jaw',[[-.21,2.38,.35],[0,2.29,.48],[.21,2.38,.35]],[.09,.12,.09],edge,/_jaw$/);
 }
 if(stoneBoss){
  // The native Hit assumes freely swinging small claws. Its additive production mask
  // must respect the heavier authored claw's floor clearance while the gait continues.
  const idle=root.listAnimations().find(a=>a.getName()==='Idle');
  for(const hit of root.listAnimations().filter(a=>/^Hit(?:Left|Right)?$/.test(a.getName())))for(const channel of hit.listChannels()){
   const node=channel.getTargetNode(),number=Number(node.getName().match(/^beetle_(\d+)_/)?.[1]);
   if(channel.getTargetPath()!=='rotation'||number<2||number>21||number===4||number===5)continue;
   const reference=idle.listChannels().find(c=>c.getTargetNode()===node&&c.getTargetPath()==='rotation');
   if(!reference)throw new Error(`${plan.id} claw has no idle reference: ${node.getName()}`);
   const base=new T.Quaternion().fromArray(reference.getSampler().getOutput().getArray()),sampler=channel.getSampler(),values=Float32Array.from(sampler.getOutput().getArray());
   const strength=number<4?.20:.28;
   for(let i=0;i<values.length;i+=4)base.clone().slerp(new T.Quaternion().fromArray(values,i),strength).toArray(values,i);
   sampler.setOutput(access('VEC4',values));state.motionEdits.push({clip:hit.getName(),joint:node.getName(),amplitude:strength,kind:'braced heavy claw relative to native idle'});
  }
 }
 // Each hero has changed torso and head tracks, plus its native limb contact cycle.
 for(const animation of root.listAnimations()){
  const name=animation.getName(),attack=name==='Attack',locomotion=['Walk','Run'].includes(name);
  for(const c of animation.listChannels())if(c.getTargetPath()==='rotation'){
   const node=c.getTargetNode(),torso=plan.torso.test(node.getName()),headMotion=plan.head.test(node.getName());if(!torso&&!headMotion)continue;
   const s=c.getSampler(),input=s.getInput().getArray(),output=Float32Array.from(s.getOutput().getArray()),duration=input.at(-1);
   const amplitude=torso?(attack?.14:locomotion?.035:.018):(attack?.095:.025),axis=torso?V(1,0,plan.id==='tideworn'?.65:0).normalize():V(0,1,0);
   for(let i=0;i<input.length;i++){const phase=input[i]/duration,wave=attack?Math.sin(Math.PI*phase)**2:Math.sin(2*Math.PI*phase);new T.Quaternion().fromArray(output,i*4).multiply(new T.Quaternion().setFromAxisAngle(axis,amplitude*wave)).toArray(output,i*4);}
   s.setOutput(access('VEC4',output));state.motionEdits.push({clip:name,joint:node.getName(),amplitude});
  }
 }
 const timeMap=new Map();for(const a of root.listAnimations())for(const s of a.listSamplers()){const input=s.getInput();if(!timeMap.has(input))timeMap.set(input,access('SCALAR',Array.from(input.getArray(),t=>t*plan.tempo)));s.setInput(timeMap.get(input));}
 for(const material of root.listMaterials())if(!material.getName().startsWith(`animal_rpg_boss_${plan.id}_`))material.setName(`animal_rpg_boss_${plan.id}_${material.getName()}`);
 await doc.transform(prune());
 const measured=await groundAndMeasure(doc,plan.id);
 await doc.transform(prune());
 const file=`creature_boss_${plan.id}.glb`;await io.write(`${OUT}/${file}`,doc);const bytes=await readFile(`${OUT}/${file}`);
 const duration=name=>Math.max(...root.listAnimations().find(a=>a.getName()===name).listSamplers().flatMap(s=>Array.from(s.getInput().getArray())));
 const asset={...structuredClone(parent),id:`creature_boss_${plan.id}`,file:`models/creature/${file}`,is:plan.id.replaceAll('_',' ')+' regional boss',bytes:bytes.length,sha256:sha(bytes),size:measured.size,base:measured.base,
  triangles:root.listMeshes().reduce((sum,m)=>sum+m.listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0),materials:root.listMaterials().map(m=>m.getName()),walkClipSeconds:duration('Walk'),runClipSeconds:duration('Run'),attackSeconds:duration('Attack'),
  impliedWalkMps:parent.impliedWalkMps/plan.tempo,impliedRunMps:parent.impliedRunMps/plan.tempo,
  metadata:{...parent.metadata,id:`boss_${plan.id}`,family:plan.id,height:measured.size.y,dimensions:[measured.size.x,measured.size.y,measured.size.z],redesign:{sourceAssetId:parent.id,sourceSha256:parent.sha256,generator:'tools/regional-bosses/build.mjs',design:plan.design,...state,clipTimeMultiplier:plan.tempo,measurement:measured},
   sourceProvenance:structuredClone(parent.metadata?.provenance),stoneTextureSource,
   textureBindings:root.listMaterials().filter(m=>m.getBaseColorTexture()).map(m=>({materialName:m.getName(),textureName:m.getBaseColorTexture().getName(),mimeType:m.getBaseColorTexture().getMimeType(),sha256:sha(m.getBaseColorTexture().getImage()),sourcePath:`Embedded accepted ${stoneTextureSource?.assetId??parent.id} texture; source asset SHA-256 ${stoneTextureSource?.assetSha256??parent.sha256}`})),
   provenance:{...parent.metadata?.provenance,sourceModifications:parent.metadata?.provenance?.modifications,modifications:plan.design+' New anatomical surfaces are part of the animated skin. Whole skeleton and surfaces receive a coordinated bind refit. Accepted source texture art retained with new surface UVs; native source license and attribution retained.'}},
  acceptance:{exported:true,labAccepted:false,worldIntegrated:false}};
 const old=catalog.assets.findIndex(a=>a.id===asset.id);if(old>=0)catalog.assets[old]=asset;else catalog.assets.push(asset);catalog.files[asset.id]=file;
 console.log(JSON.stringify({id:asset.id,triangles:asset.triangles,bytes:asset.bytes,size:asset.size,removed:state.removedTriangles,added:state.addedTriangles}));
}
await writeFile(`${OUT}/catalog.json`,JSON.stringify(catalog,null,2)+'\n');

function normal(p,access){const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(p.getAttribute('POSITION').getArray(),3));if(p.getIndices())g.setIndex(Array.from(p.getIndices().getArray()));g.computeVertexNormals();p.setAttribute('NORMAL',access('VEC3',g.attributes.normal.array));p.setAttribute('TANGENT',null);}
function uvPlanar(g){const p=g.attributes.position,n=g.attributes.normal,uv=[];for(let i=0;i<p.count;i++){const nx=Math.abs(n?.getX(i)??0),ny=Math.abs(n?.getY(i)??0),nz=Math.abs(n?.getZ(i)??1);uv.push((nx>nz?p.getZ(i):p.getX(i))*.8,(ny>Math.max(nx,nz)?p.getZ(i):p.getY(i))*.8);}g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));}
function tubeGeometry(points,radii,flat=1){const curve=new T.CatmullRomCurve3(points.map(p=>V(...p))),segments=24,sides=8,frames=curve.computeFrenetFrames(segments,false),pos=[],uv=[],idx=[];
 for(let i=0;i<=segments;i++){const t=i/segments,p=curve.getPoint(t),u=t*(radii.length-1),r=T.MathUtils.lerp(radii[Math.floor(u)],radii[Math.min(radii.length-1,Math.floor(u)+1)],u%1);for(let j=0;j<=sides;j++){const a=j/sides*Math.PI*2,q=p.clone().addScaledVector(frames.normals[i],Math.cos(a)*r).addScaledVector(frames.binormals[i],Math.sin(a)*r*flat);pos.push(...q.toArray());uv.push(j/sides,t*1.6);if(i<segments&&j<sides){const k=i*(sides+1)+j;idx.push(k,k+1,k+sides+2,k,k+sides+2,k+sides+1);}}}
 const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(pos,3)).setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;
}
function block(w,h,d,x,y,z){const shape=new T.Shape(),a=w*.5,b=h*.5,c=Math.min(.065,w*.12,h*.15);shape.moveTo(-a+c,-b);shape.lineTo(a-c*.6,-b);shape.lineTo(a,-b+c);shape.lineTo(a-c*.4,b-c);shape.lineTo(a-c*1.7,b);shape.lineTo(-a+c,b);shape.lineTo(-a,b-c*1.3);shape.lineTo(-a,-b+c);shape.closePath();const g=new T.ExtrudeGeometry(shape,{depth:d,bevelEnabled:true,bevelSize:.017,bevelThickness:.02,bevelSegments:1,steps:1});g.translate(x,y,z-d*.5);uvPlanar(g);return g;}
function archGeometry(w,h,d,x,y,z){const shape=new T.Shape(),a=w*.5,b=h*.5;shape.moveTo(-a,-b);shape.lineTo(a,-b);shape.lineTo(a,b*.25);shape.quadraticCurveTo(a,b,a*.1,b);shape.lineTo(-a*.1,b);shape.quadraticCurveTo(-a,b,-a,b*.25);shape.closePath();const hole=new T.Path();hole.moveTo(-a*.49,-b*.96);hole.lineTo(-a*.49,b*.14);hole.quadraticCurveTo(-a*.49,b*.61,0,b*.66);hole.quadraticCurveTo(a*.49,b*.61,a*.49,b*.14);hole.lineTo(a*.49,-b*.96);hole.closePath();shape.holes.push(hole);const g=new T.ExtrudeGeometry(shape,{depth:d,bevelEnabled:true,bevelSize:.015,bevelThickness:.02,bevelSegments:1,curveSegments:6,steps:1});g.translate(x,y,z-d*.5);uvPlanar(g);return g;}

async function groundAndMeasure(doc,id){
 const root=doc.getRoot(),bare=await io.readBinary(await io.writeBinary(doc));for(const m of bare.getRoot().listMaterials())m.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null).setOcclusionTexture(null);await bare.transform(prune());
 const bytes=await io.writeBinary(bare),gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),''),renderScene=gltf.scene,mixer=new T.AnimationMixer(renderScene);
 const floor=doc.createNode(`boss_${id}_ground_contact`),scene=root.listScenes()[0];for(const n of scene.listChildren()){scene.removeChild(n);floor.addChild(n);}scene.addChild(floor);
 const buffer=root.listBuffers()[0],clips=[],union=new T.Box3();let idle;
 for(const clip of gltf.animations){mixer.stopAllAction();const action=mixer.clipAction(clip).setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();const samples=Math.max(48,Math.ceil(clip.duration*60)),times=[],values=[],bounds=new T.Box3();let minCorrection=Infinity,maxCorrection=-Infinity;
  for(let i=0;i<=samples;i++){const time=clip.duration*i/samples;mixer.setTime(time);renderScene.updateMatrixWorld(true);renderScene.traverse(n=>{if(n.isSkinnedMesh)n.computeBoundingBox();});const box=new T.Box3().setFromObject(renderScene,true),correction=.003-box.min.y;times.push(time);values.push(0,correction,0);minCorrection=Math.min(minCorrection,correction);maxCorrection=Math.max(maxCorrection,correction);box.translate(V(0,correction,0));bounds.union(box);if(clip.name==='Idle'&&i===0)idle=box.clone();}
  const a=root.listAnimations().find(a=>a.getName()===clip.name),s=doc.createAnimationSampler().setInput(doc.createAccessor().setType('SCALAR').setArray(Float32Array.from(times)).setBuffer(buffer)).setOutput(doc.createAccessor().setType('VEC3').setArray(Float32Array.from(values)).setBuffer(buffer)).setInterpolation('LINEAR');a.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(floor).setTargetPath('translation').setSampler(s));
  union.union(bounds);clips.push({name:clip.name,duration:clip.duration,samples:samples+1,min:bounds.min.toArray(),max:bounds.max.toArray(),minCorrection,maxCorrection});
 }
 if(!idle)throw new Error(`Missing Idle in ${id}`);const size=idle.getSize(V());return{size:{x:size.x,y:size.y,z:size.z},base:{x:idle.min.x,y:idle.min.y,z:idle.min.z},animatedMin:union.min.toArray(),animatedMax:union.max.toArray(),clips,method:'Complete weighted surface sampled at 60 Hz or finer. Native skeletal tracks retained; whole-body correction closes ground gaps.'};
}
