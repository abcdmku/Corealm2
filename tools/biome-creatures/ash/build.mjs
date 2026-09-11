import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {prune} from '@gltf-transform/functions';
import * as T from 'three';
import sharp from 'sharp';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {measureAndGround} from './measure.mjs';

const out='test-results/biome-creatures/ash', io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
await mkdir(out,{recursive:true});
const atlasSource=await readFile('art/biome-creatures/ash/anatomy-material-atlas.png');
const atlasBytes=await sharp(atlasSource).jpeg({quality:92,mozjpeg:true}).toBuffer();
const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
const plans=[
 {id:'kiln_marrow',source:'lava_golem',name:'Kiln Marrow',contact:.60,tempo:1.17,art:'A furnace-born giant with a hollow ribbed chest, a hunched basalt mantle and one fused crushing forearm. The glow is recessed inside the body.',motion:'Native two-arm smash with prolonged brace, delayed contact and spine compression on recovery.'},
 {id:'slag_crawler',source:'webweaver_spider',name:'Slag Crawler',contact:.44,tempo:1.28,art:'A broad, low eight-legged furnace scavenger. Its abdomen is rebuilt as overlapping ridged slag plates and its head as a shovel-shaped jaw. No animal abdomen or eye cluster remains.',motion:'Native eight-leg support cycle slowed for mass, with abdomen rocking and jaw closure on contact.'},
 {id:'cinder_penitent',source:'revenant',name:'Cinder Penitent',contact:.38,tempo:1.2,art:'A blind iron-faced apparition in an asymmetric burnt shroud. The ordinary hood, belt ornaments and knight pauldrons are removed; the new sealed elongated face is part of the body.',motion:'Suspended drift with opposing forearm suspension; deliberate head bow and torso recoil during the contact strike.'},
 {id:'grave_lantern',source:'grave_ghoul',name:'Grave Lantern',contact:.36,tempo:1.12,art:'A crouched corpse with a hollow cage-like skull, recessed corpse-light, exposed arched ribs and enlarged forearms. Its human face is removed and its back becomes a long shoulder hump.',motion:'Hunched stalk with a searching head pendulum; asymmetrical shoulder reach and head recoil in the claw attack.'},
 {id:'veil_reaper',source:'banshee',name:'Veil Reaper',contact:.46,tempo:1.3,art:'A tall, hollow veiled predator with a swept-back cowl, a long trailing split shroud and continuous torn membranes beneath both arms. Its hands end in long curved talons.',motion:'Slow levitation with independent membrane lag and an opening, pulling sweep; no walking leg cycle.'},
];
const catalog={assets:[],files:{}};
for(const plan of plans){
 const parent=manifest.assets.find(a=>a.id===`creature_${plan.source}`),doc=await io.read(`game/public/assets/${parent.file}`),root=doc.getRoot(),buffer=root.listBuffers()[0];
 const bone=name=>{const n=root.listNodes().find(n=>n.getName()===name||n.getName().endsWith('_'+name));if(!n)throw new Error(`Missing ${plan.id} bone ${name}`);return n;};
 const anatomicalBatches=new Map(), materialTiles=new Map();
 const anatomyAtlas=doc.createTexture('ash_authored_anatomy_atlas').setImage(atlasBytes).setMimeType('image/jpeg');
 const state={deformedVertices:0,removedTriangles:0,addedVertices:0,addedTriangles:0,addedSurfaces:[],animationEdits:[]};
 const newMat=(name,color,roughness=1,emissive=0)=>{const c=new T.Color(color),e=new T.Color(emissive);return doc.createMaterial(`animal_rpg_${plan.id}_${name}`).setBaseColorFactor([...c.toArray(),1]).setRoughnessFactor(roughness).setMetallicFactor(name.includes('iron')?.48:0).setEmissiveFactor(e.toArray()).setDoubleSided(true);};
 function tileMaterial(mat,tile){mat.setBaseColorTexture(anatomyAtlas).setBaseColorFactor([.92,.92,.92,1]);materialTiles.set(mat,tile);return mat;}
 const boneMat=newMat('weathered_bone',0xaaa38c,.92),darkMat=newMat('recessed_cavities',0x181b1c,1),stoneMat=newMat('layered_slag',0x696157,.97),ironMat=newMat('oxidized_iron',0x55453c,.79),clothMat=newMat('ash_linen',0x777b73,1),coreMat=newMat('recessed_corpse_light',0x476653,1,0x163f25);
 tileMaterial(boneMat,0);tileMaterial(stoneMat,1);tileMaterial(ironMat,2);tileMaterial(clothMat,3);
 function mapUv(uv,tile){const col=tile%3,row=Math.floor(tile/3);for(let i=0;i<uv.length;i+=2){uv[i]=(col+.035+uv[i]*.93)/3;uv[i+1]=(row+.035+uv[i+1]*.93)/2;}return uv;}
 function geo(name,geometry,mat,parentNode,shade=true){
  const inv=new T.Matrix4().fromArray(parentNode.getWorldMatrix()).invert(); geometry.applyMatrix4(inv);
  geometry.computeVertexNormals();
  const prim=doc.createPrimitive().setMaterial(mat),attr=(type,array)=>doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  prim.setAttribute('POSITION',attr('VEC3',Float32Array.from(geometry.attributes.position.array)));
  prim.setAttribute('NORMAL',attr('VEC3',Float32Array.from(geometry.attributes.normal.array)));
  if(geometry.attributes.uv)prim.setAttribute('TEXCOORD_0',attr('VEC2',mapUv(Float32Array.from(geometry.attributes.uv.array),materialTiles.get(mat)??5)));
  if(geometry.index)prim.setIndices(attr('SCALAR',Uint32Array.from(geometry.index.array)));
  if(shade){const colors=[];for(let i=0;i<geometry.attributes.position.count;i++){const p=new T.Vector3().fromBufferAttribute(geometry.attributes.position,i).applyMatrix4(new T.Matrix4().fromArray(parentNode.getWorldMatrix()));const n=Math.sin(p.x*37+p.y*13+p.z*21)*Math.sin(p.y*46-p.z*19);const strata=.88+.07*n+.04*Math.sin(p.y*91+p.z*8);colors.push(strata,strata,strata);}prim.setAttribute('COLOR_0',attr('VEC3',Float32Array.from(colors)));}
  const key=parentNode.getName()+':'+mat.getName(),previous=anatomicalBatches.get(key);
  let node;
  if(previous){node=previous;const dst=node.getMesh().listPrimitives()[0],offset=dst.getAttribute('POSITION').getCount();
   const oldIndices=Array.from(dst.getIndices()?.getArray()??Array.from({length:offset},(_,i)=>i));
   const newIndices=Array.from(prim.getIndices()?.getArray()??Array.from({length:prim.getAttribute('POSITION').getCount()},(_,i)=>i)).map(i=>i+offset);
   for(const semantic of ['POSITION','NORMAL','TEXCOORD_0','COLOR_0']){const a=dst.getAttribute(semantic),b=prim.getAttribute(semantic);if(a&&b)dst.setAttribute(semantic,attr(a.getType(),Float32Array.from([...a.getArray(),...b.getArray()])));}
   dst.setIndices(attr('SCALAR',Uint32Array.from([...oldIndices,...newIndices])));prim.dispose();
  }else{node=doc.createNode(`${plan.id}_${name}`).setMesh(doc.createMesh(name).addPrimitive(prim));parentNode.addChild(node);anatomicalBatches.set(key,node);}
  state.addedSurfaces.push(name);state.addedVertices+=geometry.attributes.position.count;state.addedTriangles+=(geometry.index?.count??geometry.attributes.position.count)/3;return node;
 }
 function ellipsoid(name,center,scale,mat,parentNode,detail=2){const g=new T.IcosahedronGeometry(1,detail);g.scale(...scale);g.translate(...center);return geo(name,g,mat,parentNode);}
 function tube(name,points,radius,mat,parentNode,taper=.65){const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),g=new T.TubeGeometry(curve,20,radius,8,false),p=g.attributes.position;for(let i=0;i<p.count;i++){const t=Math.floor(i/9)/20,center=curve.getPointAt(t),v=new T.Vector3().fromBufferAttribute(p,i).sub(center).multiplyScalar(1-t*taper).add(center);p.setXYZ(i,...v.toArray());}return geo(name,g,mat,parentNode);}
 function shell(name,rows,mat,parentNode,{open=false,ridges=0,segments=24}={}){const positions=[],uv=[],idx=[];for(let j=0;j<rows.length;j++){const [y,rx,rz,cx,cz]=rows[j];for(let i=0;i<=segments;i++){const a=i/segments*Math.PI*2,wave=1+ridges*Math.cos(a*9+j*.6);positions.push(cx+Math.cos(a)*rx*wave,y,cz+Math.sin(a)*rz*wave);uv.push(i/segments,j/(rows.length-1));}}for(let j=0;j<rows.length-1;j++)for(let i=0;i<segments;i++){if(open&&i>segments*.2&&i<segments*.3)continue;const a=j*(segments+1)+i,b=a+segments+1;idx.push(a,b,a+1,a+1,b,b+1);}const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(positions,3)).setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);return geo(name,g,mat,parentNode);}
 const touched=new Set();
 function deform(fn,filter){for(const n of root.listNodes()){if(!n.getMesh())continue;const world=new T.Matrix4().fromArray(n.getWorldMatrix()),inverse=world.clone().invert();for(const p of n.getMesh().listPrimitives()){const pos=p.getAttribute('POSITION');if(!pos)continue;const original=Array.from(pos.getArray());if(filter){const ids=Array.from(p.getIndices()?.getArray()??Array.from({length:pos.getCount()},(_,i)=>i)),kept=[];for(let i=0;i<ids.length;i+=3){const tri=ids.slice(i,i+3),points=tri.map(q=>new T.Vector3().fromArray(original,q*3).applyMatrix4(world));if(filter(points,n,p)){state.removedTriangles++;continue;}kept.push(...tri);}if(!kept.length){n.getMesh().removePrimitive(p);continue;}p.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(kept)).setBuffer(buffer));}
   if(!touched.has(pos)){const arr=Float32Array.from(original);for(let i=0;i<pos.getCount();i++){const a=new T.Vector3().fromArray(original,i*3).applyMatrix4(world),b=fn(a.clone(),n,p);if(a.distanceTo(b)>.00001)state.deformedVertices++;b.applyMatrix4(inverse).toArray(arr,i*3);}pos.setArray(arr);touched.add(pos);}
   const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(pos.getArray(),3));if(p.getIndices())g.setIndex(Array.from(p.getIndices().getArray()));g.computeVertexNormals();p.setAttribute('NORMAL',doc.createAccessor().setType('VEC3').setArray(Float32Array.from(g.attributes.normal.array)).setBuffer(buffer));
  }}}
 const G=(x,c,s)=>Math.exp(-(((x-c)/s)**2)),smooth=(a,b,x)=>T.MathUtils.smoothstep(x,a,b);
 function removeNodeMeshes(regex){for(const n of root.listNodes())if(regex.test(n.getName())&&n.getMesh()){for(const p of n.getMesh().listPrimitives())state.removedTriangles+=(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3;n.setMesh(null);}}
 if(plan.id==='kiln_marrow'){
  deform(v=>{const chest=G(v.y,1.94,.46)*G(v.x,0,.6),arm=G(v.x,-1.62,.40)*G(v.y,1.84,.4),mantle=G(v.y,2.29,.20)*G(v.x,0,.78);v.z-=chest*.18;v.y+=mantle*.045;v.x*=1+chest*.1;v.y=1.88+(v.y-1.88)*(1+arm*.36);v.z=-.18+(v.z+.18)*(1+arm*.6);return v;},points=>points.every(v=>Math.abs(v.x)<.30&&v.y>1.50&&v.y<2.18&&v.z>.085));
  const ribs=bone('ribs'),spine=bone('spine1');
  ellipsoid('fused_dorsal_mantle',[0,2.16,-.23],[.58,.48,.33],stoneMat,spine,2);
  ellipsoid('hollow_furnace_back',[0,1.88,-.035],[.37,.52,.16],darkMat,ribs,3);
  const ember=newMat('banked_furnace_marrow',0x72341c,.9,0x522006);
  shell('furnace_marrow',[[1.44,.06,.06,0,.04],[1.6,.12,.09,-.02,.04],[1.82,.10,.10,.02,.04],[2.08,.07,.065,0,.04]],ember,ribs,{ridges:.16,segments:16});
  for(let j=0;j<4;j++)for(const side of [-1,1]){const y=1.53+j*.18;tube(`furnace_rib_${j}_${side}`,[[side*.31,y+.13,-.03],[side*.34,y+.05,.16],[side*.14,y,.23],[side*.045,y+.025,.24]],.052,stoneMat,ribs,.18);}
  shell('sunken_crater_collar',[[2.17,.28,.25,0,-.07],[2.30,.46,.35,0,-.14],[2.46,.36,.29,0,-.20],[2.50,.27,.22,0,-.20]],stoneMat,spine,{ridges:.09,segments:28});
 } else if(plan.id==='slag_crawler'){
  deform(v=>{const body=G(v.x,0,.32)*smooth(.10,.30,v.y);v.x*=1+body*.42;v.y-=body*.07;return v;},(points,n,p)=>points.every(v=>Math.abs(v.x)<.29&&v.y>.18&&v.z<-.10)||p.getMaterial()?.getName().endsWith('Material.001'));
  const abdomen=bone('Abdomen'),head=bone('Head');
  ellipsoid('soft_under_shell',[0,.30,-.33],[.36,.13,.40],darkMat,abdomen,3);
  for(let j=0;j<6;j++) {const z=-.65+j*.117,width=.29+Math.sin(j/5*Math.PI)*.105;ellipsoid(`overlapping_slag_plate_${j}`,[Math.sin(j*1.7)*.017,.30+Math.sin(j*1.4)*.022,z],[width,.155+Math.sin(j*.7)*.024,.155],stoneMat,abdomen,2);}
  const jaw=ellipsoid('shovel_jaw',[0,.23,.19],[.25,.13,.27],ironMat,head,2);
  for(const side of [-1,1])tube(`folded_mandible_${side}`,[[side*.17,.21,.25],[side*.20,.17,.43],[side*.10,.17,.50],[side*.04,.2,.44]],.052,boneMat,head,.88);
  state.jawNode=jaw.getName();
 } else if(plan.id==='cinder_penitent'){
  removeNodeMeshes(/Hood|Belt|Pauldron/);
  deform((v,n)=>{if(n.getName().includes('Body')){const hem=1-smooth(.25,1.13,v.y);v.x*=1+hem*.42;v.z*=1+hem*.24;v.y+=hem*.11*Math.sin(Math.atan2(v.x,v.z)*3+.8);const waist=G(v.y,1.15,.18);v.x*=1-waist*.12;}return v;},(points,n)=>n.getName().includes('Body')&&points.every(v=>v.y<.73&&Math.abs(v.x)<.046&&v.z>.01));
  const head=bone('Head');
  shell('sealed_iron_face',[[1.47,.035,.046,0,.13],[1.57,.11,.12,0,.04],[1.78,.16,.15,0,0],[1.99,.105,.10,0,-.065],[2.08,.03,.035,0,-.11]],ironMat,head,{ridges:.025,segments:28});
  // The eye region is a recessed blind seam, embedded in the sealed face.
  tube('blind_face_seam',[[-.115,1.81,.091],[0,1.78,.139],[.115,1.81,.091]],.011,darkMat,head,.0);
  shell('burnt_high_collar',[[1.35,.24,.16,0,-.02],[1.48,.29,.19,0,-.025],[1.60,.21,.14,0,-.05]],clothMat,bone('spine_03'),{ridges:.11,segments:28});
  for(const mat of root.listMaterials())if(mat.getName().includes('source_')){mat.setBaseColorFactor(mat.getName().includes('Regular')?[.46,.43,.38,1]:[.83,.83,.83,1]).setRoughnessFactor(1).setEmissiveFactor([0,0,0]);}
 } else if(plan.id==='grave_lantern'){
  removeNodeMeshes(/RecessedTornMouth|DesiccatedTooth/);
  deform(v=>{const shoulder=G(v.y,1.14,.22)*G(v.x,0,.35),arm=G(Math.abs(v.x),.68,.22)*G(v.y,1.2,.15);v.z-=shoulder*.18;v.y+=shoulder*.12;v.z=-.05+(v.z+.05)*(1+arm*.6);v.y=1.21+(v.y-1.21)*(1+arm*.6);return v;},points=>points.every(v=>Math.abs(v.x)<.18&&v.y>1.28));
  const head=bone('Head'),spine=bone('spine_03');
  ellipsoid('skull_inner_void',[0,1.47,-.04],[.115,.20,.05],darkMat,head,2);
  shell('corpse_light_organ',[[1.29,.025,.025,0,.065],[1.39,.059,.055,0,.065],[1.50,.04,.04,0,.065],[1.61,.013,.013,0,.06]],coreMat,head,{segments:16});
  for(let j=0;j<9;j++){const a=j/9*Math.PI*2;const x=Math.cos(a),z=Math.sin(a);tube(`skull_cage_septum_${j}`,[[x*.052,1.29,.035+z*.052],[x*.16,1.41,.035+z*.14],[x*.14,1.61,.035+z*.12],[x*.04,1.70,.035+z*.04]],.025,boneMat,head,.26);}
  for(let j=0;j<4;j++)for(const s of [-1,1]){const y=.97+j*.071;tube(`exposed_rib_${j}_${s}`,[[s*.07,y+.07,-.15],[s*.22,y+.04,-.09],[s*.19,y,.07],[s*.035,y-.01,.095]],.018,boneMat,spine,.2);}
  for(const mat of root.listMaterials())if(mat.getName().includes('source_'))mat.setBaseColorFactor([.54,.62,.51,1]).setRoughnessFactor(.97);
 } else if(plan.id==='veil_reaper'){
  removeNodeMeshes(/Belt/);
  deform((v,n)=>{if(n.getName().includes('Hood')){const crown=smooth(1.5,1.88,v.y);v.y+=crown*.21;v.z-=crown*.22;v.x*=1.17;}if(n.getName()==='wraith_Male_Wizard_Body'){const hem=1-smooth(.2,1.14,v.y);v.x*=1+hem*.5;v.z-=hem*.24;v.y+=hem*.055*Math.sin(Math.atan2(v.x,v.z)*5);const upper=G(v.y,1.48,.22);v.x*=1+upper*.14;}return v;},(points,n)=>n.getName()==='wraith_Male_Wizard_Body'&&points.every(v=>v.y<.45&&Math.abs(v.x)<.048));
  for(const side of [-1,1]){
   const parent=bone(side===1?'upperarm_l':'upperarm_r'),coords=[],idx=[],uv=[];
   for(let u=0;u<=14;u++)for(let v=0;v<=8;v++){const t=u/14,h=v/8,x=side*(.20+t*.57),y=1.51-h*(.38+.19*Math.sin(t*Math.PI))+.022*Math.sin(t*22)*h,z=-.09+h*.09;coords.push(x,y,z);uv.push(t,h);}
   for(let u=0;u<14;u++)for(let v=0;v<8;v++){if(v===7&&u%4===2)continue;const a=u*9+v;idx.push(a,a+9,a+1,a+1,a+9,a+10);}
   const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(coords,3)).setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);const membrane=geo(`torn_arm_membrane_${side}`,g,clothMat,parent);
   // Continuous membrane skin follows both arm segments and the shoulder, rather than a rigid accessory.
   const joints=[bone('spine_03'),parent,bone(side===1?'lowerarm_l':'lowerarm_r'),bone(side===1?'hand_l':'hand_r')],inverse=[];
   for(const joint of joints)new T.Matrix4().fromArray(joint.getWorldMatrix()).invert().toArray(inverse,inverse.length);
   const membraneSkin=doc.createSkin(`${plan.id}_membrane_${side}`);for(const joint of joints)membraneSkin.addJoint(joint);
   membraneSkin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(Float32Array.from(inverse)).setBuffer(buffer));
   const mp=membrane.getMesh().listPrimitives()[0],positions=mp.getAttribute('POSITION'),values=Float32Array.from(positions.getArray()),sis=[],sws=[];
   const parentWorld=new T.Matrix4().fromArray(parent.getWorldMatrix());
   for(let i=0;i<positions.getCount();i++){const point=new T.Vector3().fromArray(values,i*3).applyMatrix4(parentWorld);point.toArray(values,i*3);const t=T.MathUtils.clamp((Math.abs(point.x)-.20)/.57,0,1),lower=T.MathUtils.smoothstep(t,.27,.75),hand=T.MathUtils.smoothstep(t,.78,1)*.8,spine=(1-T.MathUtils.smoothstep(t,0,.25))*.25;sis.push(0,1,2,3);sws.push(spine,(1-spine)*(1-lower),(1-spine)*(lower-hand),(1-spine)*hand);}
   const normals=mp.getAttribute('NORMAL'),normalValues=Float32Array.from(normals.getArray()),normalMatrix=new T.Matrix3().getNormalMatrix(parentWorld);for(let i=0;i<normals.getCount();i++)new T.Vector3().fromArray(normalValues,i*3).applyMatrix3(normalMatrix).normalize().toArray(normalValues,i*3);normals.setArray(normalValues);positions.setArray(values);mp.setAttribute('JOINTS_0',doc.createAccessor().setType('VEC4').setArray(Uint16Array.from(sis)).setBuffer(buffer)).setAttribute('WEIGHTS_0',doc.createAccessor().setType('VEC4').setArray(Float32Array.from(sws)).setBuffer(buffer));
   parent.removeChild(membrane);root.listScenes()[0].addChild(membrane);membrane.setSkin(membraneSkin);

   const hand=bone(side===1?'hand_l':'hand_r');for(let j=0;j<3;j++)tube(`hooked_digit_${side}_${j}`,[[side*.81,1.50,-.04-j*.035],[side*.94,1.47,-.035-j*.035],[side*1.03,1.36,.025-j*.035],[side*.98,1.30,.065-j*.035]],.016,boneMat,hand,.85);
  }
  for(const mat of root.listMaterials())if(mat.getName().includes('source_'))mat.setBaseColorFactor(mat.getName().includes('Regular')?[.58,.64,.6,1]:[.61,.64,.6,1]).setRoughnessFactor(1).setEmissiveFactor([0,0,0]);
 }
 // Detail is sampled from a dedicated material cell through each mesh's own existing UV unwrap.
 const remappedUv=new Set();
 for(const node of root.listNodes())if(node.getMesh())for(const primitive of node.getMesh().listPrimitives()){
  const mat=primitive.getMaterial(),uv=primitive.getAttribute('TEXCOORD_0');let tile;
  if(plan.id==='cinder_penitent'&&mat.getName().includes('MI_Wizard'))tile=3;
  if(plan.id==='slag_crawler'&&mat.getName().includes('animal_rpg_webweaver'))tile=5;
  if(plan.id==='grave_lantern'&&mat.getName().includes('source_base_male'))tile=4;
  if(tile!==undefined&&uv){mat.setBaseColorTexture(anatomyAtlas).setBaseColorFactor(plan.id==='grave_lantern'?[.65,.74,.68,1]:[.88,.88,.88,1]);if(!remappedUv.has(uv)){const original=uv.clone();primitive.setAttribute('TEXCOORD_1',original);if(mat.getNormalTexture())mat.getNormalTextureInfo().setTexCoord(1);uv.setArray(mapUv(Float32Array.from(uv.getArray()),tile));remappedUv.add(uv);}}
 }
 // Edit selected bone channels per action. Native support joints are preserved.
 function rotateChannels(animation,regex,axis,fn){for(const c of animation.listChannels()){if(c.getTargetPath()!=='rotation'||!regex.test(c.getTargetNode().getName()))continue;const sam=c.getSampler(),o=sam.getOutput(),arr=Float32Array.from(o.getArray()),times=sam.getInput().getArray(),duration=Math.max(...times);for(let i=0;i<times.length;i++){const phase=times[i]/duration,delta=fn(phase,c.getTargetNode().getName()),q=new T.Quaternion().fromArray(arr,i*4);q.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(...axis),delta)).normalize().toArray(arr,i*4);}sam.setOutput(doc.createAccessor().setType('VEC4').setArray(arr).setBuffer(buffer));state.animationEdits.push(`${animation.getName()}:${c.getTargetNode().getName()}`);}}
 if(['cinder_penitent','veil_reaper'].includes(plan.id)){
  const idle=root.listAnimations().find(a=>a.getName()==='Idle');
  for(const name of ['Walk','Run']){root.listAnimations().find(a=>a.getName()===name)?.dispose();const a=doc.createAnimation(name);for(const c of idle.listChannels()){const s=c.getSampler(),copy=doc.createAnimationSampler().setInput(s.getInput()).setOutput(s.getOutput()).setInterpolation(s.getInterpolation());a.addSampler(copy).addChannel(doc.createAnimationChannel().setTargetNode(c.getTargetNode()).setTargetPath(c.getTargetPath()).setSampler(copy));}}
 }
 for(const a of root.listAnimations()){
  const locomotion=['Idle','Walk','Run'].includes(a.getName()),attack=a.getName()==='Attack';
  if(plan.id==='kiln_marrow')rotateChannels(a,/spine1$/,[1,0,0],t=>(attack?.13*Math.sin(Math.PI*t):locomotion?.035*Math.sin(t*Math.PI*2):0));
  if(plan.id==='slag_crawler')rotateChannels(a,/Abdomen$/,[0,1,0],t=>locomotion?.035*Math.sin(t*Math.PI*2):attack?.12*Math.sin(t*Math.PI):0);
  if(plan.id==='grave_lantern'){rotateChannels(a,/Head$/,[0,1,0],t=>locomotion?.15*Math.sin(t*Math.PI*2):attack?-.16*Math.sin(t*Math.PI):0);rotateChannels(a,/spine_03$/,[1,0,0],t=>locomotion?.06:attack?.09*Math.sin(Math.PI*t):0);}
  if(plan.id==='cinder_penitent'){rotateChannels(a,/Head$/,[1,0,0],t=>locomotion?.08+.035*Math.sin(t*Math.PI*2):attack?.19*Math.sin(t*Math.PI):0);rotateChannels(a,/lowerarm_[lr]$/,[0,0,1],(t,n)=>(n.endsWith('l')?1:-1)*(locomotion?.12+.045*Math.sin(t*Math.PI*2):0));}
  if(plan.id==='veil_reaper'){rotateChannels(a,/upperarm_[lr]$/,[0,0,1],(t,n)=>(n.endsWith('l')?1:-1)*(locomotion?.09+.065*Math.sin(t*Math.PI*2):attack?.17*Math.sin(t*Math.PI):0));rotateChannels(a,/Head$/,[0,1,0],t=>locomotion?.10*Math.sin(t*Math.PI*2):0);}
  const inputs=new Map();for(const s of a.listSamplers()){const old=s.getInput();if(!inputs.has(old)){let arr=Array.from(old.getArray()),duration=Math.max(...arr);arr=arr.map(t=>{const p=t/duration;if(attack){const sourceContact=parent.contactNormalized??parent.metadata?.attackContact??.30;const remap=p<sourceContact?p/sourceContact*plan.contact:plan.contact+(p-sourceContact)/(1-sourceContact)*(1-plan.contact);return remap*duration*plan.tempo;}return t*plan.tempo;});inputs.set(old,doc.createAccessor().setType('SCALAR').setArray(Float32Array.from(arr)).setBuffer(buffer));}s.setInput(inputs.get(old));}
 }
 if(state.jawNode){const jaw=bone(state.jawNode),rest=jaw.getRotation();for(const a of root.listAnimations().filter(a=>a.getName()==='Attack')){const duration=Math.max(...a.listSamplers().flatMap(s=>[...s.getInput().getArray()])),times=Float32Array.from({length:31},(_,i)=>i/30*duration),q=[];for(let i=0;i<31;i++)new T.Quaternion().fromArray(rest).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),-.22*Math.sin(i/30*Math.PI))).toArray(q,i*4);const s=doc.createAnimationSampler().setInput(doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer)).setOutput(doc.createAccessor().setType('VEC4').setArray(Float32Array.from(q)).setBuffer(buffer));a.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(jaw).setTargetPath('rotation').setSampler(s));state.animationEdits.push('Attack:shovel_jaw');}}
 for(const mat of root.listMaterials())mat.setName(mat.getName().replaceAll(plan.source,plan.id));
 await doc.transform(prune());
 const measurements=measureAndGround(doc,plan.id,{hover:['cinder_penitent','veil_reaper'].includes(plan.id)});
 await doc.transform(prune());
 const id=`creature_${plan.id}`,filename=`${id}.glb`;await io.write(path.join(out,filename),doc);const bytes=await readFile(path.join(out,filename));
 const durations=Object.fromEntries(root.listAnimations().map(a=>[a.getName(),Math.max(...a.listSamplers().flatMap(s=>[...s.getInput().getArray()]))]));
 const b=measurements.idleBounds,min=b.min,size=b.max.map((v,i)=>v-min[i]);
 const entry={...structuredClone(parent),id,file:`models/creature/${filename}`,is:plan.name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),size:{x:size[0],y:size[1],z:size[2]},base:{x:min[0],y:min[1],z:min[2]},materials:root.listMaterials().map(m=>m.getName()),triangles:root.listMeshes().reduce((s,m)=>s+m.listPrimitives().reduce((t,p)=>t+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0),walkClipSeconds:durations.Walk,runClipSeconds:durations.Run,attackSeconds:durations.Attack,contactNormalized:plan.contact,impliedWalkMps:parent.impliedWalkMps?parent.impliedWalkMps/plan.tempo:undefined,impliedRunMps:parent.impliedRunMps?parent.impliedRunMps/plan.tempo:undefined,metadata:{...parent.metadata,redesign:{sourceAssetId:parent.id,sourceSha256:parent.sha256,generator:'tools/biome-creatures/ash/build.mjs',generatorSha256:createHash('sha256').update(await readFile('tools/biome-creatures/ash/build.mjs')).digest('hex'),artDirection:plan.art,anatomyAtlas:{path:'art/biome-creatures/ash/anatomy-material-atlas.png',sha256:createHash('sha256').update(atlasSource).digest('hex'),embeddedJpegSha256:createHash('sha256').update(atlasBytes).digest('hex'),uvLayout:'3x2: bone, slag, iron / linen, hide, basalt',generator:'Built-in imagegen; prompt in art/biome-creatures/ash/atlas-prompt.txt'},motionDirection:plan.motion,...state,measurements}},acceptance:{exported:true,labAccepted:false,worldIntegrated:false}};
 catalog.assets.push(entry);catalog.files[id]=filename;console.log(JSON.stringify({id,triangles:entry.triangles,bytes:bytes.length,size:entry.size,deformed:state.deformedVertices,removed:state.removedTriangles,added:state.addedTriangles,minFloor:measurements.minFloor}));
}
await writeFile(path.join(out,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');
await writeFile('art/biome-creatures/ash/designs.json',JSON.stringify(plans,null,2)+'\n');




