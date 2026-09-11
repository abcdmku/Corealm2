import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {prune} from '@gltf-transform/functions';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from 'three';
import sharp from 'sharp';

const OUT='test-results/biome-creatures/forest', ART='art/biome-creatures/forest';
await mkdir(OUT,{recursive:true});
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v)), smooth=(v,a,b)=>{const x=clamp((v-a)/(b-a));return x*x*(3-2*x);};
const vec=a=>new T.Vector3(...a), mat=a=>new T.Matrix4().fromArray(a), sha=b=>createHash('sha256').update(b).digest('hex');
const configs=[
 {id:'briar_harrow',base:'mossback_sentinel',tempo:1.16,design:'Hollow rooted torso, removed leaf canopy, bowed upper trunk and broad hooked forearms; rooted arch grows from shoulders into the back.'},
 {id:'fen_crawler',base:'webweaver_spider',tempo:1.18,design:'Eight native articulated legs support a rebuilt low armored body of overlapping scalloped shields; broad opposed jaw paddles replace the spider face.'},
 {id:'reed_strider',base:'webweaver_spider',tempo:.88,design:'Six-legged reed mimic with a raised narrow thorax, tapered segmented abdomen, long folded limbs and a vertically split feeding mask. Entire visible mesh rebuilt on the native arthropod rig.'},
 {id:'thorn_maw',base:'beetle_golem',tempo:1.13,design:'Heavy rooted biped with the original stone core and head removed, replaced by a deep split seedpod with two moving jaw valves and a dark oral cavity.'},
 {id:'heath_jack',base:'goblin_scout',tempo:1.08,design:'Hunched heath scavenger with lengthened forearms and fingers, narrow torso, and a fully replaced hollow carved face with real open eye slots. Retains worn cloth and functional knife.'},
];
const catalog={assets:[],files:{}};
for(const config of configs){
 const parent=manifest.assets.find(a=>a.id===`creature_${config.base}`),doc=await io.read(`game/public/assets/${parent.file}`),root=doc.getRoot(),buffer=root.listBuffers()[0];
 const originalNodes=root.listNodes(),rest=new Map(originalNodes.map(n=>[n,{t:n.getTranslation(),q:n.getRotation(),s:n.getScale(),world:mat(n.getWorldMatrix())}]));
 const primary=originalNodes.find(n=>n.getSkin()),sourceMesh=primary.getMesh(),skin=primary.getSkin(),joints=skin.listJoints();
 const skinBind=new Map(root.listSkins().map(s=>[s,s.listJoints().map((j,i)=>mat(j.getWorldMatrix()).multiply(mat(s.getInverseBindMatrices().getElement(i,[]))))]));
 const bind=skinBind.get(skin)[0],inverseBind=bind.clone().invert();
 let removedTriangles=0,changedVertices=0,newTriangles=0;
 const originalPosition=new Map();for(const mesh of root.listMeshes())for(const p of mesh.listPrimitives()){const a=p.getAttribute('POSITION');if(!originalPosition.has(a))originalPosition.set(a,Float32Array.from(a.getArray()));}
 const field=p=>{
  const x=p.x,y=p.y,z=p.z;
  if(config.id==='briar_harrow'){
   const upper=smooth(y,1.1,2.7),arm=smooth(Math.abs(x),.48,.85)*(1-smooth(y,2.6,3));
   return new T.Vector3(x*(.91+arm*.15),y-.32*upper,z+.26*upper+.10*arm);
  }
  if(config.id==='fen_crawler')return new T.Vector3(x*1.08,y*.86,z*1.06);
  if(config.id==='reed_strider')return new T.Vector3(x*1.3,y*1.95,z*1.22);
  if(config.id==='thorn_maw')return new T.Vector3(x*(1-.13*smooth(y,.65,1.6)),y-.13*smooth(y,.5,1.8),z+.13*smooth(y,.8,1.8));
  const arm=smooth(Math.abs(x),.14,.35)*(1-smooth(y,1.04,1.13));
  return new T.Vector3(x*(.91+arm*.34),y-.11*smooth(y,.65,1.12),z+.09*smooth(y,.7,1.1));
 };
 // The same nonlinear field reshapes both the bind skeleton and the weighted surface.
 const nextWorld=new Map(originalNodes.map(n=>[n,field(new T.Vector3().setFromMatrixPosition(rest.get(n).world))]));
 for(const scene of root.listScenes())for(const n of scene.listChildren())visit(n);
 function visit(n){const target=nextWorld.get(n);if(target){const parentWorld=n.getParentNode()?mat(n.getParentNode().getWorldMatrix()):new T.Matrix4();n.setTranslation(target.clone().applyMatrix4(parentWorld.invert()).toArray());}for(const child of n.listChildren())visit(child);}
 const newRest=new Map(originalNodes.map(n=>[n,{t:n.getTranslation(),q:n.getRotation(),s:n.getScale()}]));
 for(const s of root.listSkins()){
  const values=[];s.listJoints().forEach((j,i)=>values.push(...mat(j.getWorldMatrix()).invert().multiply(skinBind.get(s)[i]).toArray()));
  s.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(new Float32Array(values)).setBuffer(buffer));
 }
 // Translation channels include baked constraint animation. Preserve their displacement
 // relative to the remapped bind pose, rather than allowing native tracks to undo the refit.
 for(const animation of root.listAnimations())for(const c of animation.listChannels())if(c.getTargetPath()==='translation'){
  const n=c.getTargetNode(),source=c.getSampler().getOutput(),arr=Float32Array.from(source.getArray()),old=rest.get(n)?.t,fresh=newRest.get(n)?.t;
  if(!old||!fresh)continue;
  const oldLen=Math.hypot(...old),newLen=Math.hypot(...fresh),ratio=oldLen>.025?clamp(newLen/oldLen,.6,2):1;
  for(let i=0;i<arr.length;i+=3)for(let k=0;k<3;k++)arr[i+k]=fresh[k]+(arr[i+k]-old[k])*ratio;
  c.getSampler().setOutput(doc.createAccessor().setType('VEC3').setArray(arr).setBuffer(buffer));
 }
 const processed=new Set();
 for(const n of originalNodes){if(!n.getMesh())continue;const s=n.getSkin(),b=s?skinBind.get(s)[0]:rest.get(n).world,inv=s?b.clone().invert():mat(n.getWorldMatrix()).invert();
  for(const p of n.getMesh().listPrimitives()){
   const a=p.getAttribute('POSITION');if(processed.has(a))continue;processed.add(a);const src=originalPosition.get(a),arr=Float32Array.from(src);
   for(let i=0;i<a.getCount();i++){const before=new T.Vector3().fromArray(src,i*3).applyMatrix4(b),after=field(before);if(before.distanceTo(after)>.001)changedVertices++;after.applyMatrix4(inv).toArray(arr,i*3);}
   a.setArray(arr);recomputeNormals(p);
  }
 }
 // Native textures stay on retained cloth and limbs. Newly sculpted wood/chitin surfaces
 // use longitudinal UVs, with separate dark inner tissue and pale cut edges.
 const bark=await surface('heartwood',`${ART}/heartwood-albedo.png`,[1,1,1,1],.91);
 const chitin=await surface('chitin',`${ART}/chitin-albedo.png`,[1,1,1,1],.76);
 const inner=doc.createMaterial(`animal_rpg_${config.id}_inner_fibres`).setBaseColorFactor([.035,.044,.023,1]).setRoughnessFactor(1).setDoubleSided(true);
 const ivory=doc.createMaterial(`animal_rpg_${config.id}_worn_cambium`).setBaseColorTexture(bark.getBaseColorTexture()).setBaseColorFactor([1,.93,.72,1]).setRoughnessFactor(.91);
 async function surface(label,file,color,rough){const image=await sharp(await readFile(file)).jpeg({quality:90,chromaSubsampling:'4:4:4'}).toBuffer(),texture=doc.createTexture(`${config.id}_${label}_albedo`).setImage(image).setMimeType('image/jpeg');return doc.createMaterial(`animal_rpg_${config.id}_${label}`).setBaseColorTexture(texture).setBaseColorFactor(color).setRoughnessFactor(rough);}
 const indexJoint=pattern=>{const i=joints.findIndex(n=>typeof pattern==='string'?n.getName()===pattern:pattern.test(n.getName()));if(i<0)throw new Error(`${config.id}: joint ${pattern} missing`);return i;};
 const jp=pattern=>new T.Vector3().setFromMatrixPosition(mat(joints[indexJoint(pattern)].getWorldMatrix()));
 const created=[],createdNodes=[];
 function addGeometry(name,geometry,material,jointFn){
  geometry.computeVertexNormals();const positions=Array.from(geometry.attributes.position.array),normals=Array.from(geometry.attributes.normal.array),uv=geometry.attributes.uv?Array.from(geometry.attributes.uv.array):Array(positions.length/3*2).fill(0),ji=[],jw=[];
  const normalMatrix=new T.Matrix3().getNormalMatrix(inverseBind);
  for(let i=0;i<positions.length/3;i++){const p=new T.Vector3().fromArray(positions,i*3),weight=jointFn(p,i);p.applyMatrix4(inverseBind).toArray(positions,i*3);new T.Vector3().fromArray(normals,i*3).applyMatrix3(normalMatrix).normalize().toArray(normals,i*3);ji.push(weight[0],weight[1]??0,0,0);jw.push(weight[2]??1,weight[1]===undefined?0:1-(weight[2]??1),0,0);}
  const primitive=doc.createPrimitive().setAttribute('POSITION',accessor('VEC3',positions)).setAttribute('NORMAL',accessor('VEC3',normals)).setAttribute('TEXCOORD_0',accessor('VEC2',uv)).setAttribute('JOINTS_0',doc.createAccessor().setType('VEC4').setArray(new Uint16Array(ji)).setBuffer(buffer)).setAttribute('WEIGHTS_0',accessor('VEC4',jw)).setMaterial(material);
  if(geometry.index)primitive.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(geometry.index.array)).setBuffer(buffer));
  const mesh=doc.createMesh(`${config.id}_${name}`).addPrimitive(primitive),node=doc.createNode(`${config.id}_${name}`).setMesh(mesh).setSkin(skin);
  root.listScenes()[0].addChild(node);createdNodes.push(node);newTriangles+=(geometry.index?.count??positions.length/3)/3;created.push(name);
 }
 const accessor=(type,array)=>doc.createAccessor().setType(type).setArray(new Float32Array(array)).setBuffer(buffer);
 function tube(name,points,radii,material,jointFn,segments=28,sides=9,flatten=1){
  const curve=new T.CatmullRomCurve3(points.map(p=>p.isVector3?p:vec(p))),frames=curve.computeFrenetFrames(segments,false),pos=[],uv=[],idx=[];
  for(let i=0;i<=segments;i++){const t=i/segments,p=curve.getPoint(t),ri=t*(radii.length-1),r=T.MathUtils.lerp(radii[Math.floor(ri)],radii[Math.min(radii.length-1,Math.floor(ri)+1)],ri%1);for(let j=0;j<=sides;j++){const a=j/sides*Math.PI*2,q=p.clone().addScaledVector(frames.normals[i],Math.cos(a)*r).addScaledVector(frames.binormals[i],Math.sin(a)*r);q.y=p.y+(q.y-p.y)*flatten;pos.push(...q.toArray());uv.push(j/sides,t*1.8);if(i<segments&&j<sides){const k=i*(sides+1)+j;idx.push(k,k+1,k+sides+2,k,k+sides+2,k+sides+1);}}}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);addGeometry(name,g,material,jointFn);
 }
 function shell(name,center,radius,material,bone,{cut=()=>false,segments=40,rings=20,profile=()=>1}={}){
  const pos=[],uv=[],idx=[];for(let v=0;v<=rings;v++){const phi=v/rings*Math.PI;for(let u=0;u<=segments;u++){const theta=u/segments*Math.PI*2,f=profile(theta,phi),p=[center[0]+radius[0]*Math.sin(phi)*Math.cos(theta)*f,center[1]+radius[1]*Math.cos(phi)*f,center[2]+radius[2]*Math.sin(phi)*Math.sin(theta)*f];pos.push(...p);uv.push(u/segments,v/rings);}}
  for(let v=0;v<rings;v++)for(let u=0;u<segments;u++){const a=v*(segments+1)+u,b=a+segments+1,centerP=new T.Vector3().fromArray(pos,a*3).add(new T.Vector3().fromArray(pos,(b+1)*3)).multiplyScalar(.5);if(!cut(centerP))idx.push(a,a+1,b,b,a+1,b+1);}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);addGeometry(name,g,material,()=>[bone]);
 }
 function cutSource(predicate){for(const n of originalNodes){const mesh=n.getMesh();if(!mesh)continue;for(const p of mesh.listPrimitives()){const pos=p.getAttribute('POSITION'),b=n.getSkin()?skinBind.get(n.getSkin())[0]:rest.get(n).world,ids=p.getIndices()?Array.from(p.getIndices().getArray()):Array.from({length:pos.getCount()},(_,i)=>i),kept=[];for(let i=0;i<ids.length;i+=3){const vv=ids.slice(i,i+3).map(k=>new T.Vector3().fromArray(pos.getArray(),k*3).applyMatrix4(b));if(predicate(vv,n,p,ids.slice(i,i+3)))removedTriangles++;else kept.push(...ids.slice(i,i+3));}p.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(kept)).setBuffer(buffer));}}}
 const dominant=(p,k)=>{const w=p.getAttribute('WEIGHTS_0'),j=p.getAttribute('JOINTS_0');if(!w||!j)return '';const weights=w.getElement(k,[]),ids=j.getElement(k,[]);return joints[ids[weights.indexOf(Math.max(...weights))]]?.getName()??'';};
 if(config.id==='briar_harrow'){
  for(const n of originalNodes)if(n.getMesh()?.listPrimitives().every(p=>p.getMaterial()?.getName().endsWith('_Tree'))){removedTriangles+=n.getMesh().listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0);n.setMesh(null);}
  const spine=indexJoint(/_Spine2$/),upper=indexJoint(/_Spine3$/);
  cutSource(vv=>vv.every(p=>Math.abs(p.x)<.24&&Math.abs(p.y-1.54)<.35&&p.z>-.10));
  shell('hollow_trunk_interior',[0,1.57,-.18],[.28,.40,.20],inner,spine);
  for(const side of [-1,1])tube(`rooted_shoulder_${side}`,[[side*.24,1.1,-.32],[side*.50,1.72,-.48],[side*.68,2.24,-.4],[side*.36,2.61,-.27],[side*.12,2.31,-.14]],[.16,.14,.085,.025],bark,p=>p.y>1.95?[upper]:[spine]);
  for(const n of originalNodes)for(const p of n.getMesh()?.listPrimitives()??[]){p.setMaterial(bark);const a=p.getAttribute('POSITION'),uv=[];for(let i=0;i<a.getCount();i++){const q=new T.Vector3().fromArray(a.getArray(),i*3).applyMatrix4(bind);uv.push(Math.atan2(q.z+.2,q.x)/Math.PI/2+.5,q.y*.65);}p.setAttribute('TEXCOORD_0',accessor('VEC2',uv));}
 }
 if(config.id==='fen_crawler'){
  cutSource((vv,n,p,ids)=>ids.every(i=>!dominant(p,i).includes('Leg')));
  const abdomen=indexJoint('Abdomen'),head=indexJoint('Head');
  shell('broad_caudal_shield',[0,.29,-.28],[.44,.21,.55],chitin,abdomen,{profile:(t,p)=>1+.055*Math.cos(t*6)*Math.sin(p)**2});
  shell('thoracic_shield',[0,.29,.14],[.32,.18,.38],chitin,head,{profile:(t,p)=>1+.05*Math.cos(t*5)*Math.sin(p)**2});
  shell('mouth_recess',[0,.21,.43],[.17,.10,.13],inner,head);
  for(const side of [-1,1])tube(`jaw_paddle_${side}`,[[side*.17,.25,.31],[side*.24,.20,.42],[side*.22,.16,.53],[side*.10,.14,.68]],[.055,.085,.046,.002],ivory,()=>[head],24,10,.27);
 }
 if(config.id==='reed_strider'){
  for(const n of originalNodes)if(n.getMesh()){removedTriangles+=n.getMesh().listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0);n.setMesh(null);}
  const body=indexJoint('Body'),abdomen=indexJoint('Abdomen'),head=indexJoint('Head');
  shell('reed_thorax',[0,.53,-.10],[.14,.30,.38],chitin,body);
  for(let i=0;i<3;i++)shell(`tapered_abdomen_${i}`,[0,.51-i*.02,-.40-i*.18],[.13-i*.025,.17-i*.023,.23-i*.035],chitin,abdomen);
  shell('split_feeding_mask',[0,.47,.38],[.14,.25,.23],bark,head,{cut:p=>p.z>.43&&Math.abs(p.x)<.024});
  shell('feeding_fold',[0,.47,.34],[.09,.20,.18],inner,head);
  for(const side of ['L','R'])for(const prefix of ['FrontLeg','MidFrontLeg','BackLeg']){
   const ids=[indexJoint(prefix+side),indexJoint(prefix+'2'+side),indexJoint(prefix+'3'+side)],points=ids.map(i=>new T.Vector3().setFromMatrixPosition(mat(joints[i].getWorldMatrix()))),sgn=side==='L'?1:-1;
   points[0].x*=.48;
   // Preserve the native distal contact position in bind space. An invented endpoint
   // would change the support polygon and make this taller stance skate or float.
   let contact=null;
   for(const primitive of sourceMesh.listPrimitives()){
    const position=primitive.getAttribute('POSITION'),used=primitive.getIndices()?new Set(primitive.getIndices().getArray()):Array.from({length:position.getCount()},(_,i)=>i);
    for(const vertex of used)if(dominant(primitive,vertex)===prefix+'3'+side){const p=new T.Vector3().fromArray(position.getArray(),vertex*3).applyMatrix4(bind);if(!contact||p.y<contact.y)contact=p;}
   }
   if(!contact)throw new Error(`Missing distal support ${prefix}${side}`);
   points.push(contact);
   const footName=prefix==='FrontLeg'?(side==='L'?'FrontFootL':'FrontFoot2R'):prefix.replace('Leg','Foot')+side;
   ids.push(indexJoint(footName));
   for(let part=0;part<3;part++){const a=points[part],b=points[part+1],mid=a.clone().lerp(b,.45);mid.z-=.04;tube(`${prefix}_${side}_${part}`,[a,mid,b],[.049-part*.011,.037-part*.01,.020-part*.006],chitin,(p,i)=>[ids[part],ids[part+1],1-Math.floor(i/9)/10],10,8);}
  }
 }
 if(config.id==='thorn_maw'){
  const chest=indexJoint('beetle_3_Bone_002'),head=indexJoint('beetle_4_Bone_003'),jaw=indexJoint('beetle_5_Bone_004');
  cutSource(vv=>vv.every(p=>Math.abs(p.x)<.60&&p.y>1.07));
  shell('rooted_pod_back',[0,1.61,-.11],[.52,.76,.47],bark,chest,{cut:p=>p.z>.08&&p.y>1.3,profile:(t,p)=>1+.045*Math.cos(t*7)*Math.sin(p)});
  shell('oral_cavity',[0,1.69,.06],[.37,.58,.32],inner,head);
  shell('upper_pod_valve',[0,2.04,.18],[.49,.50,.43],bark,head,{cut:p=>p.y<1.96&&p.z>.15,profile:(t,p)=>1+.035*Math.cos(t*6)});
  shell('lower_pod_valve',[0,1.48,.24],[.46,.33,.44],bark,jaw,{cut:p=>p.y>1.48&&p.z>.17,profile:(t,p)=>1+.045*Math.cos(t*6)});
  for(const side of [-1,1])tube(`hinged_maw_rim_${side}`,[[side*.08,2.35,.29],[side*.40,2.04,.45],[side*.43,1.77,.42],[side*.33,1.55,.52],[side*.10,1.41,.52]],[.065,.095,.075,.035],ivory,()=>[head]);
  for(const n of originalNodes)for(const p of n.getMesh()?.listPrimitives()??[]){p.setMaterial(bark);const a=p.getAttribute('POSITION'),uv=[];for(let i=0;i<a.getCount();i++){const q=new T.Vector3().fromArray(a.getArray(),i*3).applyMatrix4(bind);uv.push(Math.atan2(q.z+.1,q.x)/Math.PI/2+.5,q.y*.85);}p.setAttribute('TEXCOORD_0',accessor('VEC2',uv));}
 }
 if(config.id==='heath_jack'){
  const head=indexJoint('Head');
  for(const n of originalNodes)if(/Eyebrows|Eyes/.test(n.getName()))n.setMesh(null);
  cutSource((vv,n)=>n.getName().includes('SuperHero')&&vv.every(p=>p.y>1.01));
  shell('hollow_carved_mask',[0,1.13,.17],[.15,.245,.19],bark,head,{cut:p=>p.z>.235&&Math.abs(p.y-1.17)<.027&&Math.abs(p.x)>.025&&Math.abs(p.x)<.116,profile:(theta,phi)=>1+.045*Math.cos(theta*5)*Math.sin(phi)});
  shell('mask_inner_shadow',[0,1.13,.12],[.12,.20,.15],inner,head);
  tube('downturned_nose',[[0,1.22,.30],[0,1.10,.37],[0,.98,.33]],[.025,.040,.015],ivory,()=>[head],16,8);
 }
 // A body may contain many anatomical pieces, but each material needs only one
 // skinned submission. This also keeps the near-rig budget available for crowds.
 const byMaterial=new Map();for(const node of createdNodes)for(const p of node.getMesh().listPrimitives()){const key=p.getMaterial();if(!byMaterial.has(key))byMaterial.set(key,[]);byMaterial.get(key).push(p);}
 const joinedMesh=doc.createMesh(`${config.id}_sculpted_body`);
 for(const [material,parts]of byMaterial){
  const arrays={POSITION:[],NORMAL:[],TEXCOORD_0:[],JOINTS_0:[],WEIGHTS_0:[]},indices=[];let offset=0;
  for(const p of parts){for(const key of Object.keys(arrays))arrays[key].push(...p.getAttribute(key).getArray());const ids=p.getIndices()?.getArray()??Array.from({length:p.getAttribute('POSITION').getCount()},(_,i)=>i);indices.push(...Array.from(ids,i=>i+offset));offset+=p.getAttribute('POSITION').getCount();}
  const p=doc.createPrimitive().setMaterial(material);for(const key of Object.keys(arrays)){const size=key==='TEXCOORD_0'?'VEC2':key==='JOINTS_0'||key==='WEIGHTS_0'?'VEC4':'VEC3';p.setAttribute(key,doc.createAccessor().setType(size).setArray(key==='JOINTS_0'?new Uint16Array(arrays[key]):new Float32Array(arrays[key])).setBuffer(buffer));}p.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer));joinedMesh.addPrimitive(p);
 }
 root.listScenes()[0].addChild(doc.createNode(`${config.id}_sculpted_body`).setMesh(joinedMesh).setSkin(skin));for(const node of createdNodes)node.dispose();
 // New gait attitude is articulated into spine/head channels. Feet keep their source
 // rotation curves and phase. This preserves planted limb sequencing and attack contact.
 const motionChanges=[];
 for(const animation of root.listAnimations()){
  const name=animation.getName();
  for(const channel of animation.listChannels()){
   if(channel.getTargetPath()!=='rotation')continue;const target=channel.getTargetNode().getName();
   const active=config.id==='briar_harrow'?/_Spine[23]$/.test(target):config.id==='fen_crawler'?target==='Abdomen':config.id==='reed_strider'?target==='Head':config.id==='thorn_maw'?target==='beetle_5_Bone_004':target==='spine_03';
   if(!active)continue;const sampler=channel.getSampler(),out=Float32Array.from(sampler.getOutput().getArray()),times=sampler.getInput().getArray(),duration=Math.max(...times),amplitude=config.id==='thorn_maw'?.10:config.id==='heath_jack'?.07:.04;
   for(let i=0;i<times.length;i++){const phase=times[i]/duration,attack=name==='Attack'?Math.sin(Math.PI*phase)**2:Math.sin(Math.PI*2*phase),q=new T.Quaternion().fromArray(out,i*4);q.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),amplitude*attack));q.toArray(out,i*4);}
   sampler.setOutput(accessor('VEC4',out));motionChanges.push({clip:name,joint:target,amplitude});
  }
 }
 const retimed=new Set();for(const animation of root.listAnimations())for(const sampler of animation.listSamplers()){const input=sampler.getInput();if(!retimed.has(input)){retimed.add(input);input.setArray(Float32Array.from(input.getArray(),t=>t*config.tempo));}}
 await doc.transform(prune());
 const floor=doc.createNode(`${config.id}_ground_contact`),scene=root.listScenes()[0];for(const n of scene.listChildren()){scene.removeChild(n);floor.addChild(n);}scene.addChild(floor);
 const sampled=measureAndGround(doc,floor,buffer);
 const filename=`creature_${config.id}.glb`;await io.write(`${OUT}/${filename}`,doc);const bytes=await readFile(`${OUT}/${filename}`),bounds=sampled.idleBounds;
 const asset={...structuredClone(parent),id:`creature_${config.id}`,file:`models/creature/${filename}`,is:config.id.replaceAll('_',' '),bytes:bytes.length,sha256:sha(bytes),size:{x:bounds.max[0]-bounds.min[0],y:bounds.max[1]-bounds.min[1],z:bounds.max[2]-bounds.min[2]},base:{x:bounds.min[0],y:bounds.min[1],z:bounds.min[2]},materials:root.listMaterials().map(m=>m.getName()),triangles:root.listMeshes().reduce((sum,m)=>sum+m.listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0),walkClipSeconds:clipSeconds('Walk'),runClipSeconds:clipSeconds('Run'),attackSeconds:clipSeconds('Attack'),impliedWalkMps:parent.impliedWalkMps/config.tempo*(config.id==='reed_strider'?1.22:config.id==='fen_crawler'?1.06:1),impliedRunMps:parent.impliedRunMps/config.tempo*(config.id==='reed_strider'?1.22:config.id==='fen_crawler'?1.06:1),metadata:{...parent.metadata,redesign:{sourceAssetId:parent.id,sourceSha256:parent.sha256,generator:'tools/biome-creatures/forest/build.mjs',design:config.design,changedVertices,removedTriangles,newTriangles,createdParts:created,clipTimeMultiplier:config.tempo,motionChanges,textures:['art/biome-creatures/forest/heartwood-albedo.png','art/biome-creatures/forest/chitin-albedo.png'],sampledBounds:sampled}},acceptance:{exported:true,labAccepted:false,worldIntegrated:false}};
 asset.metadata.sourceProvenance=structuredClone(parent.metadata.provenance);
 asset.metadata.provenance={...structuredClone(parent.metadata.provenance),sourceModifications:parent.metadata.provenance?.modifications,modifications:config.design+' Coordinated nonlinear skin and bind-joint refit; revised articulated body motion; source action contacts retained; whole weighted surface ground correction. New Corealm wood/chitin materials generated with builtin imagegen and JPEG-encoded at quality 90 for runtime; source PNGs and prompts retained in art/biome-creatures/forest.'};
 if(config.id==='thorn_maw')asset.metadata.provenance.attribution='Thorn Maw, a Corealm adaptation of Beetle Golem by killyoverdrive, animated by Dm3d. https://opengameart.org/content/beetle-golem-animated. CC BY-SA 3.0. Rebuilt hollow pod torso and head, replaced surface materials, coordinated anatomy/rig refit and revised jaw motion. This adapted creature asset is CC BY-SA 3.0.';
 asset.metadata.id=config.id;asset.metadata.family=config.id;asset.metadata.height=asset.size.y;asset.metadata.dimensions=[asset.size.x,asset.size.y,asset.size.z];
 asset.metadata.textureBindings=root.listMaterials().filter(m=>m.getBaseColorTexture()).map(m=>({materialName:m.getName(),textureName:m.getBaseColorTexture().getName(),mimeType:m.getBaseColorTexture().getMimeType(),sha256:sha(m.getBaseColorTexture().getImage()),sourcePath:m.getName().includes('_heartwood')?`${ART}/heartwood-albedo.png`:m.getName().includes('_chitin')?`${ART}/chitin-albedo.png`:'Preserved embedded source texture'}));
 catalog.assets.push(asset);catalog.files[asset.id]=filename;console.log(JSON.stringify({id:config.id,bytes:asset.bytes,triangles:asset.triangles,changedVertices,removedTriangles,newTriangles,bounds:asset.size,clips:sampled.clips}));
 function clipSeconds(name){return Math.max(...root.listAnimations().find(a=>a.getName()===name).listSamplers().flatMap(s=>Array.from(s.getInput().getArray())));}
}
await writeFile(`${OUT}/catalog.json`,JSON.stringify(catalog,null,2)+'\n');

function recomputeNormals(p){const a=p.getAttribute('POSITION'),g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(a.getArray(),3));if(p.getIndices())g.setIndex(Array.from(p.getIndices().getArray()));g.computeVertexNormals();const n=p.getAttribute('NORMAL');if(n)n.setArray(new Float32Array(g.attributes.normal.array));}

/** Evaluate production glTF channels and all weighted vertices. No bounding-box estimates. */
function measureAndGround(doc,floor,buffer){
 const root=doc.getRoot(),nodes=root.listNodes(),initial=new Map(nodes.map(n=>[n,{t:n.getTranslation(),q:n.getRotation(),s:n.getScale()}])),draws=nodes.filter(n=>n.getMesh());
 const reset=()=>{for(const[n,r]of initial)n.setTranslation(r.t).setRotation(r.q).setScale(r.s);};
 function pose(animation,time){reset();for(const c of animation.listChannels()){const s=c.getSampler(),input=s.getInput().getArray(),out=s.getOutput(),size=out.getElementSize();let k=0;while(k<input.length-2&&input[k+1]<time)k++;const t=clamp((time-input[k])/Math.max(1e-8,input[k+1]-input[k])),a=out.getElement(k,[]),b=out.getElement(Math.min(k+1,input.length-1),[]),node=c.getTargetNode();let value;if(c.getTargetPath()==='rotation')value=new T.Quaternion().fromArray(a).slerp(new T.Quaternion().fromArray(b),s.getInterpolation()==='STEP'?0:t).toArray();else value=a.map((v,i)=>T.MathUtils.lerp(v,b[i],s.getInterpolation()==='STEP'?0:t));if(c.getTargetPath()==='translation')node.setTranslation(value);else if(c.getTargetPath()==='rotation')node.setRotation(value);else if(c.getTargetPath()==='scale')node.setScale(value);}
  const world=new Map(nodes.map(n=>[n,mat(n.getWorldMatrix())])),box=new T.Box3();
  for(const n of draws){const skin=n.getSkin(),matrices=skin?skin.listJoints().map((j,i)=>world.get(j).clone().multiply(mat(skin.getInverseBindMatrices().getElement(i,[])))):null;for(const p of n.getMesh().listPrimitives()){const a=p.getAttribute('POSITION'),j=p.getAttribute('JOINTS_0'),w=p.getAttribute('WEIGHTS_0'),used=p.getIndices()?new Set(p.getIndices().getArray()):Array.from({length:a.getCount()},(_,i)=>i);for(const i of used){const v=vec(a.getElement(i,[]));let actual;if(matrices&&j&&w){actual=new T.Vector3();const jj=j.getElement(i,[]),ww=w.getElement(i,[]);for(let k=0;k<4;k++)if(ww[k])actual.addScaledVector(v.clone().applyMatrix4(matrices[jj[k]]),ww[k]);}else actual=v.applyMatrix4(world.get(n));if(!Number.isFinite(actual.x+actual.y+actual.z))throw new Error('Nonfinite animated surface');box.expandByPoint(actual);}}}
  return box;
 }
 const result={idleBounds:null,clips:[]};
 for(const animation of root.listAnimations()){
  const duration=Math.max(...animation.listSamplers().flatMap(s=>Array.from(s.getInput().getArray()))),times=Array.from({length:49},(_,i)=>duration*i/48),corrections=[];let rawMin=Infinity;
  for(const time of times){const b=pose(animation,time);rawMin=Math.min(rawMin,b.min.y);corrections.push(0,.003-b.min.y,0);}
  const input=doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer),output=doc.createAccessor().setType('VEC3').setArray(new Float32Array(corrections)).setBuffer(buffer),sampler=doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(floor).setTargetPath('translation').setSampler(sampler));
  let minY=Infinity,maxY=-Infinity;for(let i=0;i<=24;i++){const b=pose(animation,duration*i/24);minY=Math.min(minY,b.min.y);maxY=Math.max(maxY,b.min.y);if(animation.getName()==='Idle'&&i===0)result.idleBounds={min:b.min.toArray(),max:b.max.toArray()};}result.clips.push({name:animation.getName(),duration,minY,maxY,rawMin,samples:49});
 }
 reset();return result;
}
