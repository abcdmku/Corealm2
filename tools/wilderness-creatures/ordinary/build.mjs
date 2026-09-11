/** Original Wilderness anatomy on licensed production rigs. Export candidates only. */
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {prune} from '@gltf-transform/functions';
import * as T from 'three';
import sharp from 'sharp';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {measureAndGround} from './measure.mjs';
import {batchRigidAnatomy} from './batch.mjs';

const OUT='test-results/wilderness-creatures/ordinary',ART='assets/art/wilderness-creatures/ordinary';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
const ATLAS_FILE=`${ART}/anatomy-atlas-v2.png`,CORE_FILE=`${ART}/core-atlas.png`;
const atlasSource=await readFile(ATLAS_FILE),atlasBytes=await sharp(atlasSource).resize(1024,1024).jpeg({quality:93,mozjpeg:true}).toBuffer();
const coreSource=await readFile(CORE_FILE),coreBytes=await sharp(coreSource).resize(1024,1024).jpeg({quality:95,mozjpeg:true}).toBuffer();
const GLOAM_WALL_FILE=`${ART}/gloam-innerwall-emission.png`,gloamWallSource=await readFile(GLOAM_WALL_FILE),gloamWallBytes=await sharp(gloamWallSource).resize(1024,1024).png().toBuffer();
const hash=b=>createHash('sha256').update(b).digest('hex');
export const DESIGNS=[
 {id:'cinderback_crag',source:'slag_crawler',name:'Cinderback Crag',tier:50,tempo:1.10,contact:.56,scale:[1.30,1.32,1.35],kind:'crawler',deep:false,
  design:'Eight planted basalt limbs support a transverse split crust mantle. Thick domed plates open onto a narrow banked molten interior. The forward jaw is a broad crushing shelf with no spider eyes.',motion:'Low alternating support gait, slower abdomen roll and a delayed jaw closure after the brace.'},
 {id:'furnace_grazer',source:'cairn_treader',name:'Furnace Grazer',tier:50,tempo:1.16,contact:.57,scale:[1.12,1.05,1.12],kind:'grazer',deep:false,
  design:'Headless head-and-shoulder dome merges into a broken basalt mantle. Slab forelimbs flank a deep hot throat, while original stone legs carry the mass. Long cooling fractures divide its shoulder shields.',motion:'Heavy native foot transfer with a forward shoulder dip, prolonged brace and one-sided crushing return.'},
 {id:'basalt_maw',source:'flint_mandible',name:'Basalt Maw',tier:50,tempo:1.13,contact:.55,scale:[.91,1.02,.94],kind:'maw',deep:false,
  design:'A broad excavation predator with a torn central jaw cavity between two crushing rock lobes. Layered shoulder slabs and a low broken dorsal keel replace the source cranium and shell.',motion:'Braced digging sweep with head compression and a timed closing lower jaw.'},
 {id:'rift_carapace',source:'slag_crawler',name:'Rift Carapace',tier:70,tempo:1.24,contact:.49,scale:[1.42,1.54,1.48],kind:'crawler',deep:true,
  design:'Eight angular supporting legs beneath four long upright slate plates. A deep longitudinal channel divides the high broken carapace, exposing blue-violet inner tissue; a narrow bifurcated prow replaces the shovel head.',motion:'Slow alternating leg cycle and independent lateral mantle motion, followed by a deliberate paired prow strike.'},
 {id:'voidstone_colossus',source:'vault_custodian',name:'Voidstone Colossus',tier:70,tempo:1.18,contact:.54,scale:[1.45,1.46,1.37],kind:'colossus',deep:true,
  design:'Entire knight statue mesh is removed. Thick irregular rib plates surround a vertical blue inner fissure; split column legs, long buttress arms, and an enclosed slotted head make a hollow standing stone creature.',motion:'Native planted walking rig, slow weight transfer and a two-stage torso compression before the heavy right-hand impact.'},
 {id:'gloam_wraith',source:'veil_reaper',name:'Gloam Wraith',tier:70,tempo:1.15,contact:.52,scale:[1.30,1.18,1.12],kind:'wraith',deep:true,
  design:'A hollow lengthened slit cowl opens into an empty throat. Its continuous torso becomes hanging split membranes and a broad trailing back fold. Long fibrous arm membranes move with the retained native shoulder and wrist rig; no human face or feet remain.',motion:'Slow suspended drift with asymmetric arm lag and throat bow, then an opening pull whose contact occurs late in the sweep.'},
];
const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z),smooth=(a,b,v)=>T.MathUtils.smoothstep(v,a,b);

function rock(center,scale,seed=1){const g=new T.IcosahedronGeometry(1,2),p=g.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),n=1+.095*Math.sin(x*8.2+y*4.7+seed)*Math.sin(z*7.1-y*3.8);p.setXYZ(i,x*n,y*n,z*n);}g.scale(...scale).translate(...center);g.computeVertexNormals();return g;}
function tube(points,r0,r1=r0,segments=10,sides=7){const curve=new T.CatmullRomCurve3(points.map(p=>V(...p))),g=new T.TubeGeometry(curve,segments,r0,sides,false),p=g.attributes.position;for(let i=0;i<p.count;i++){const t=Math.floor(i/(sides+1))/segments,c=curve.getPointAt(t),v=V().fromBufferAttribute(p,i).sub(c).multiplyScalar(T.MathUtils.lerp(1,r1/r0,t)).add(c);p.setXYZ(i,...v.toArray());}return g;}
function slab(center,scale,seed=1){const g=new T.IcosahedronGeometry(1,1),p=g.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),f=1+.12*Math.sin(x*5.7+z*3.3+seed);p.setXYZ(i,x*f,y*(.94+.08*Math.sin(z*8+seed)),z*f);}g.scale(...scale).translate(...center);g.computeVertexNormals();return g;}
/** A closed piece of rock crust. Gaps are empty space, revealing the smaller core below. */
function crust(center,scale,az0,az1,el0,el1,seed=0,opening=[]){const xyz=[],uv=[],idx=[],nx=7,ny=4,radial=.80,cut=new Set(opening.map(([x,y])=>`${x}:${y}`)),missing=(x,y)=>cut.has(`${x}:${y}`);
 for(let layer=0;layer<2;layer++)for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
  const a=T.MathUtils.lerp(az0,az1,i/nx),b=T.MathUtils.lerp(el0,el1,j/ny),wav=1+.035*Math.sin(a*8+seed)*Math.cos(b*11+seed),r=(layer?radial:1)*wav;
  xyz.push(center[0]+Math.cos(a)*Math.sin(b)*scale[0]*r,center[1]+Math.cos(b)*scale[1]*r,center[2]+Math.sin(a)*Math.sin(b)*scale[2]*r);uv.push(i/nx,j/ny);
 }
 const row=nx+1,n=(nx+1)*(ny+1),quad=(a,b,c,d,flip=false)=>idx.push(...(flip?[a,c,b,b,c,d]:[a,b,c,b,d,c]));
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){if(missing(i,j))continue;const a=j*row+i;quad(a,a+1,a+row,a+row+1);quad(a+n,a+row+n,a+1+n,a+row+1+n);}
 for(let i=0;i<nx;i++){quad(i,i+n,i+1,i+1+n);const a=ny*row+i;quad(a,a+1,a+n,a+n+1);}
 for(let j=0;j<ny;j++){const a=j*row,b=a+nx;if(!missing(0,j))quad(a,a+row,a+n,a+row+n);if(!missing(nx-1,j))quad(b,b+n,b+row,b+row+n);}
 const colors=Array.from({length:xyz.length},()=>1);
 // Bank faces span the existing shell thickness. Outer vertices stay exactly where they were.
 function bank(a,b){const offset=xyz.length/3;for(const q of [a,b,a+n,b+n]){xyz.push(...xyz.slice(q*3,q*3+3));uv.push(...uv.slice(q*2,q*2+2));colors.push(.48,.48,.48);}quad(offset,offset+1,offset+2,offset+3);}
 if(cut.size)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){if(missing(i,j))continue;const a=j*row+i;if(missing(i-1,j))bank(a,a+row);if(missing(i+1,j))bank(a+row+1,a+1);if(missing(i,j-1))bank(a+1,a);if(missing(i,j+1))bank(a+row,a+row+1);}
 const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(xyz,3)).setAttribute('uv',new T.Float32BufferAttribute(uv,2));if(cut.size)g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(idx);g.computeVertexNormals();return g;
}
function unwrap(geometry,tile){const g=geometry.index?geometry.toNonIndexed():geometry.clone(),p=g.attributes.position,uv=[];g.computeBoundingBox();const b=g.boundingBox,span=Math.max(...b.getSize(V()).toArray(),.01);
 // One projection for every corner of a face; no modulo wrap can cross an atlas cell mid-face.
 for(let i=0;i<p.count;i+=3){const a=V().fromBufferAttribute(p,i),b0=V().fromBufferAttribute(p,i+1),c=V().fromBufferAttribute(p,i+2),n=b0.sub(a).cross(c.sub(a)).normalize(),nx=Math.abs(n.x),ny=Math.abs(n.y),nz=Math.abs(n.z),axes=ny>=nx&&ny>=nz?['x','z']:nx>=nz?['z','y']:['x','y'];for(let j=0;j<3;j++){const q=V().fromBufferAttribute(p,i+j),u=(q[axes[0]]-b.min[axes[0]])/span,v=(q[axes[1]]-b.min[axes[1]])/span;uv.push((tile%2+.035+u*.93)/2,(Math.floor(tile/2)+.035+v*.93)/2);}}
 g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));return g;
}
async function make(plan){
 const parent=manifest.assets.find(a=>a.id===`creature_${plan.source}`);if(!parent)throw Error(`No source ${plan.source}`);
 const doc=await io.read(`game/public/assets/${parent.file}`),root=doc.getRoot(),buffer=root.listBuffers()[0],scene=root.listScenes()[0];
 const state={removedTriangles:0,addedTriangles:0,retainedTriangles:0,anatomy:[],animationEdits:[],emission:'Recessed core geometry visible through physical plate gaps. No surface dot lights.'};
 const attr=(type,array)=>doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
 const bone=name=>{const node=root.listNodes().find(n=>n.getName()===name);if(!node)throw Error(`${plan.id} missing bone ${name}`);return node;};
 const point=name=>V().setFromMatrixPosition(new T.Matrix4().fromArray(bone(name).getWorldMatrix()));
 const atlas=doc.createTexture('wilderness_original_anatomy_atlas').setImage(atlasBytes).setMimeType('image/jpeg'),coreAtlas=doc.createTexture('wilderness_original_core_heat_atlas').setImage(coreBytes).setMimeType('image/jpeg');
 const mat=(name,color,roughness,emission=null)=>{const m=doc.createMaterial(`animal_rpg_${plan.id}_${name}`).setBaseColorFactor([...new T.Color(color).toArray(),1]).setMetallicFactor(0).setRoughnessFactor(roughness).setDoubleSided(true);if(emission)m.setEmissiveFactor(new T.Color(emission).toArray());return m;};
 const stone=mat(plan.deep?'cleaved_void_slate':'rough_basalt_crust',0xffffff,.92).setBaseColorTexture(atlas),secondary=mat('eroded_fracture_faces',0xffffff,.95).setBaseColorTexture(atlas),dark=mat('deep_unlit_cavities',0x141318,1),core=mat(plan.deep?'recessed_blue_violet_core':'recessed_molten_veins',0xffffff,.80).setBaseColorTexture(coreAtlas).setEmissiveTexture(coreAtlas).setEmissiveFactor([.8,.8,.8]),fibre=mat('gloam_tendon_membrane',0xffffff,.97).setBaseColorTexture(atlas);
 const tiles=new Map([[stone,plan.deep?2:0],[secondary,plan.deep?2:1],[fibre,3],[core,plan.deep?2:0]]),batches=new Map();
 function geo(name,geometry,material,node){let g=tiles.has(material)?unwrap(geometry,tiles.get(material)):geometry.index?geometry.toNonIndexed():geometry.clone();const world=g.clone();g.applyMatrix4(new T.Matrix4().fromArray(node.getWorldMatrix()).invert());g.computeVertexNormals();
  const p=doc.createPrimitive().setMaterial(material);p.setAttribute('POSITION',attr('VEC3',Float32Array.from(g.attributes.position.array))).setAttribute('NORMAL',attr('VEC3',Float32Array.from(g.attributes.normal.array)));if(g.attributes.uv)p.setAttribute('TEXCOORD_0',attr('VEC2',Float32Array.from(g.attributes.uv.array)));
  const colors=[];for(let i=0;i<world.attributes.position.count;i++){const q=V().fromBufferAttribute(world.attributes.position,i),v=(.88+.08*Math.sin(q.x*7+q.y*16)*Math.sin(q.z*14+q.y*8))*(world.attributes.color?.getX(i)??1);colors.push(v,v,v);}p.setAttribute('COLOR_0',attr('VEC3',Float32Array.from(colors)));
  const key=node.getName()+material.getName(),old=batches.get(key);if(old){const dest=old.getMesh().listPrimitives()[0];for(const semantic of ['POSITION','NORMAL','TEXCOORD_0','COLOR_0']){const a=dest.getAttribute(semantic),b=p.getAttribute(semantic);if(a&&b)dest.setAttribute(semantic,attr(a.getType(),Float32Array.from([...a.getArray(),...b.getArray()])));}p.dispose();}else{const child=doc.createNode(`${plan.id}_${name}`).setMesh(doc.createMesh(`${plan.id}_${name}`).addPrimitive(p));node.addChild(child);batches.set(key,child);}
  state.addedTriangles+=g.attributes.position.count/3;state.anatomy.push({name,joint:node.getName(),material:material.getName(),triangles:g.attributes.position.count/3});return batches.get(key);
 }
 // Evaluate source vertices in bind space, retaining their original skin weights and support joints.
 function filterSource(keep){for(const node of root.listNodes()){if(!node.getMesh())continue;const matrix=new T.Matrix4().fromArray(node.getWorldMatrix()),skin=node.getSkin(),binds=skin?.listJoints().map((j,i)=>new T.Matrix4().fromArray(j.getWorldMatrix()).multiply(new T.Matrix4().fromArray(skin.getInverseBindMatrices().getArray(),i*16)));
  for(const p of node.getMesh().listPrimitives()){
   const pos=p.getAttribute('POSITION'),weights=p.getAttribute('WEIGHTS_0')?.getArray(),joints=p.getAttribute('JOINTS_0')?.getArray(),points=[];
   for(let i=0;i<pos.getCount();i++){const raw=V().fromArray(pos.getArray(),i*3),v=V();if(binds&&weights){for(let k=0;k<4;k++)if(weights[i*4+k])v.addScaledVector(raw.clone().applyMatrix4(binds[joints[i*4+k]]),weights[i*4+k]);}else v.copy(raw).applyMatrix4(matrix);points.push(v);}
   const ids=Array.from(p.getIndices()?.getArray()??Array.from({length:pos.getCount()},(_,i)=>i)),next=[];for(let i=0;i<ids.length;i+=3){const tri=ids.slice(i,i+3);if(keep(tri.map(i=>points[i]),node,p))next.push(...tri);else state.removedTriangles++;}
   if(next.length){
    p.setIndices(attr('SCALAR',Uint32Array.from(next)));state.retainedTriangles+=next.length/3;p.setMaterial(plan.kind==='wraith'?fibre:stone);const old=p.getAttribute('TEXCOORD_0'),tile=tiles.get(plan.kind==='wraith'?fibre:stone);
    if(old){const arr=Float32Array.from(old.getArray());for(let i=0;i<arr.length;i+=2){arr[i]=(tile%2+.04+arr[i]*.92)/2;arr[i+1]=(Math.floor(tile/2)+.04+arr[i+1]*.92)/2;}p.setAttribute('TEXCOORD_0',old.clone().setArray(arr));}
    else{
     // Some native leg meshes use vertex colours and have no UVs. Give every face a
     // bounded planar chart in bind space, splitting corners at projection seams.
     const bounds=new T.Box3().setFromPoints(next.map(i=>points[i])),span=Math.max(...bounds.getSize(V()).toArray(),.01),uv=[];
     for(let i=0;i<next.length;i+=3){const a=points[next[i]],b=points[next[i+1]],c=points[next[i+2]],normal=b.clone().sub(a).cross(c.clone().sub(a)).normalize(),nx=Math.abs(normal.x),ny=Math.abs(normal.y),nz=Math.abs(normal.z),axes=ny>=nx&&ny>=nz?['x','z']:nx>=nz?['z','y']:['x','y'];
      for(let j=0;j<3;j++){const q=points[next[i+j]],u=(q[axes[0]]-bounds.min[axes[0]])/span,v=(q[axes[1]]-bounds.min[axes[1]])/span;uv.push((tile%2+.04+u*.92)/2,(Math.floor(tile/2)+.04+v*.92)/2);}
     }
     for(const semantic of p.listSemantics()){const accessor=p.getAttribute(semantic),array=accessor.getArray(),stride=accessor.getElementSize(),expanded=new array.constructor(next.length*stride);for(let i=0;i<next.length;i++)for(let k=0;k<stride;k++)expanded[i*stride+k]=array[next[i]*stride+k];p.setAttribute(semantic,accessor.clone().setArray(expanded));}
     p.setIndices(null).setAttribute('TEXCOORD_0',attr('VEC2',Float32Array.from(uv)));state.anatomy.push({name:`${node.getName()}_authored_leg_uvs`,material:p.getMaterial().getName(),triangles:next.length/3,uvLayout:'One bound-space planar projection per face, atlas cell without wrapping'});
    }
    p.setAttribute('TANGENT',null);
   }
   else node.getMesh().removePrimitive(p);
  }if(!node.getMesh().listPrimitives().length)node.setMesh(null);
 }}
 if(plan.kind==='crawler'){
  filterSource((points,node)=>!!node.getSkin()&&!points.every(v=>Math.abs(v.x)<.30&&v.y>.13));
  const abdomen=bone('Abdomen'),head=bone('Head'),body=bone('Body');
  geo('banked_inner_mantle',rock([0,.315,-.35],[.36,.19,.43],3),core,abdomen);
  geo('underside',rock([0,.205,-.27],[.39,.085,.38],3),dark,body);
  if(!plan.deep){
   // Six broad transverse pieces form one cooling shell with nonuniform seams.
   for(let j=0;j<3;j++)for(const s of [-1,1]){const z=-.65+j*.23,rx=.37+Math.sin(j/2*Math.PI)*.07;
    geo(`split_dorsal_plate_${j}_${s}`,crust([0,.29,z],[rx,.27,.175],s<0?Math.PI*.52:-Math.PI*.48,s<0?Math.PI*1.48:Math.PI*.48,.075,1.6,j),stone,abdomen);
   }
   geo('wide_crushing_head',slab([0,.275,.19],[.255,.15,.29],4),stone,head);
   geo('dark_mouth',slab([0,.218,.405],[.185,.045,.07],4),dark,head);
   for(const s of [-1,1])geo(`lower_jaw_${s}`,tube([[s*.17,.185,.22],[s*.24,.16,.38],[s*.16,.165,.50],[s*.035,.19,.48]],.065,.014),secondary,head);
  }else{
   for(const s of [-1,1])for(let j=0;j<2;j++){
    const x=s*(.10+j*.17),height=j===0?.36:.24;
    geo(`upright_cleaved_carapace_${s}_${j}`,slab([x,.30+height*.36,-.38-j*.045],[.097,height,.43-j*.04],j+s*4),stone,abdomen);
   }
   for(const s of [-1,1])geo(`bifurcated_prow_${s}`,slab([s*.14,.31,.27],[.105,.19,.35],3+s),stone,head);
   geo('prow_inner_fissure',tube([[0,.265,.02],[0,.31,.29],[0,.26,.50]],.055,.014),core,head);
  }
 }else if(plan.kind==='grazer'){
  filterSource(points=>!points.every(v=>v.y>1.27));
  const chest=bone('earth_15_chest'),spine=bone('earth_12_spine');
  geo('molten_shoulder_interior',rock([0,1.64,-.20],[.58,.54,.48],3),core,chest);
  for(let j=0;j<6;j++){
   const startGap=j===1||j===2?.060:.025,endGap=j===0||j===1?.060:.025;
   const brokenOpening=j===1?[[0,1],[1,1],[2,1],[3,1],[1,2],[2,2],[3,2]]:[];
   geo(`fractured_shoulder_dome_${j}`,crust([0,1.57,-.27],[.82,.71,.68],j*Math.PI/3+startGap,(j+1)*Math.PI/3-endGap,.12,1.90,j,brokenOpening),j%3===0?secondary:stone,chest);
  }
  geo('lower_throat_shadow',slab([0,1.24,.015],[.40,.32,.10]),dark,spine);
  state.cavityRepair='Recessed throat rear wall and a connected asymmetric opening in the middle front mantle, joined to an existing seam. Original outer vertices retained, dark bank faces span the actual 20-percent shell thickness, and the mottled inner core is unchanged';
  for(const s of [-1,1]){
   geo(`split_mouth_lip_${s}`,slab([s*.23,1.39,.41],[.26,.22,.25],s+7),stone,chest);
   const side=s>0?'L':'R',arm=`earth_${s>0?26:27}_upper_arm_${side}`,forearm=`earth_${s>0?32:33}_forearm_${side}`,hand=`earth_${s>0?34:35}_hand_${side}`;
   geo(`arm_shield_${s}`,tube([point(arm).toArray(),point(forearm).toArray()],.31,.23),stone,bone(arm));
   geo(`forearm_crust_${s}`,tube([point(forearm).toArray(),point(hand).toArray()],.27,.32),secondary,bone(forearm));
   const handP=point(hand);geo(`crushing_palm_${s}`,slab(handP.clone().add(V(s*.19,0,.02)).toArray(),[.40,.24,.39],s+5),stone,bone(hand));
   geo(`palm_fissure_${s}`,slab(handP.clone().add(V(s*.21,.03,.11)).toArray(),[.26,.05,.31],s),core,bone(hand));
  }
 }else if(plan.kind==='maw'){
  filterSource(points=>!points.every(v=>Math.abs(v.x)<.72&&v.y>1.35));
  const chest=bone('beetle_3_Bone_002'),jaw=bone('beetle_5_Bone_004'),head=bone('beetle_4_Bone_003');
  geo('deep_jaw_void',rock([0,1.64,.27],[.42,.33,.095],3),dark,head);
  state.cavityRepair='Closed opaque mouth ellipsoid replaced with a recessed dark rear wall behind the unchanged textured molten gullet; original stone lips and external silhouette retained';
  geo('molten_gullet',rock([0,1.62,.44],[.32,.21,.21],3),core,head);
  for(const s of [-1,1]){
   geo(`crushing_upper_lobe_${s}`,slab([s*.32,1.84,.58],[.29,.30,.49],s+4),stone,head);
   geo(`lower_mandible_${s}`,slab([s*.24,1.42,.79],[.28,.15,.43],s+2),secondary,jaw);
   for(let j=0;j<3;j++)geo(`jaw_tooth_${s}_${j}`,slab([s*(.13+j*.09),1.58,.76+j*.09],[.07,.17,.095],j+s),stone,jaw);
   for(let j=0;j<3;j++)geo(`dorsal_slab_${s}_${j}`,slab([s*(.16+j*.13),1.77-j*.07,-.33],[.20,.28,.61-j*.06],j+s*4),stone,chest);
  }
  geo('dorsal_molten_split',tube([[0,1.87,-.87],[0,1.83,-.4],[0,1.82,-.05]],.06,.045),core,chest);
 }else if(plan.kind==='colossus'){
  filterSource(()=>false);
  const spine=bone('spine_03'),head=bone('Head');
  geo('vertical_inner_fissure',rock([0,1.40,.005],[.19,.61,.18],3),core,spine);
  geo('hollow_back_wall',rock([0,1.41,-.16],[.45,.57,.15],2),dark,spine);
  for(let j=0;j<5;j++)for(const s of [-1,1])geo(`separated_rib_slab_${s}_${j}`,tube([[s*.31,1.02+j*.16,-.15],[s*.46,1.05+j*.16,.0],[s*.25,1.02+j*.16,.24],[s*.045,1.03+j*.16,.25]],.10,.066,8,6),stone,spine);
  for(const s of [-1,1]){
   const side=s>0?'l':'r',upper=point(`upperarm_${side}`),elbow=point(`lowerarm_${side}`),wrist=point(`hand_${side}`),hip=point(`thigh_${side}`),knee=point(`calf_${side}`),foot=point(`foot_${side}`);
   geo(`buttress_upper_arm_${s}`,tube([upper.toArray(),elbow.toArray()],.28,.19),stone,bone(`upperarm_${side}`));
   geo(`buttress_lower_arm_${s}`,tube([elbow.toArray(),wrist.toArray()],.19,.27),stone,bone(`lowerarm_${side}`));
   geo(`split_hand_base_${s}`,slab(wrist.clone().add(V(s*.14,0,0)).toArray(),[.33,.22,.34],s),stone,bone(`hand_${side}`));
   geo(`hand_inner_seam_${s}`,slab(wrist.clone().add(V(s*.10,.11,.10)).toArray(),[.25,.038,.15],s),core,bone(`hand_${side}`));
   for(let j=0;j<2;j++)geo(`long_shoulder_plate_${s}_${j}`,slab(upper.clone().add(V(s*.025,.18+j*.085,-.01)).toArray(),[.28,.18,.35],j+s),secondary,bone(`upperarm_${side}`));
   geo(`stone_thigh_${s}`,tube([hip.toArray(),knee.toArray()],.24,.16),stone,bone(`thigh_${side}`));
   geo(`stone_shin_${s}`,tube([knee.toArray(),foot.toArray()],.17,.22),stone,bone(`calf_${side}`));
   geo(`planted_foot_${s}`,slab([foot.x,.083,foot.z+.13],[.23,.092,.39],s),stone,bone(`foot_${side}`));
   geo(`head_side_${s}`,slab([s*.19,1.89,.02],[.16,.37,.28],s),stone,head);
  }
  geo('slotted_head_crown',slab([0,2.16,-.015],[.34,.12,.26],2),secondary,head);
  geo('inner_head_fissure',slab([0,1.91,-.005],[.034,.28,.20],2),core,head);
 }else if(plan.kind==='wraith'){
  filterSource((points,node)=>node.getName().includes('Arms')||node.getName().includes('torn_arm_membrane')||node.getName().includes('hooked_digit'));
  for(const n of root.listNodes())if(n.getMesh())for(const p of n.getMesh().listPrimitives())p.setMaterial(fibre);
  const head=bone('Head'),spine=bone('spine_03'),pelvis=bone('pelvis');
  // This cowl is physically hollow at the front. The narrow throat lies behind the opening.
  for(let j=0;j<7;j++){const a0=Math.PI*.66+j*Math.PI*1.68/7,a1=a0+Math.PI*1.68/7+.009;geo(`hollow_cowl_fold_${j}`,crust([0,1.93,-.05],[.34,.52,.34],a0,a1,.04,2.60,j),fibre,head);}
  const innerWallMap=doc.createTexture('gloam_original_innerwall_emission_mask').setImage(gloamWallBytes).setMimeType('image/png');
  dark.setName('animal_rpg_gloam_wraith_recessed_innerwall_mask').setBaseColorTexture(innerWallMap).setEmissiveTexture(innerWallMap).setEmissiveFactor([.8,.8,.8]);
  const innerWall=geo('empty_throat',slab([0,1.79,-.035],[.16,.37,.075],2),dark,head),wallPrimitive=innerWall.getMesh().listPrimitives()[0],wallPositions=wallPrimitive.getAttribute('POSITION').getArray(),wallWorld=new T.Matrix4().fromArray(innerWall.getWorldMatrix()),wallUv=[];
  for(let i=0;i<wallPositions.length;i+=3){const v=V().fromArray(wallPositions,i).applyMatrix4(wallWorld);wallUv.push(T.MathUtils.clamp((v.x+.17)/.34,0,1),T.MathUtils.clamp((v.y-1.40)/.80,0,1));}
  wallPrimitive.setAttribute('TEXCOORD_0',attr('VEC2',Float32Array.from(wallUv)));
  state.innerWallMaterialRepair={file:GLOAM_WALL_FILE,sha256:hash(gloamWallSource),encodedSha256:hash(gloamWallBytes),prompt:`${ART}/gloam-innerwall-prompt.txt`,geometry:'Existing inner wall, unchanged positions/normals/indices and bone attachment',uvException:'Added planar XY UVs to the previously unmapped dark inner wall; only its narrow off-centre strip emits. Centre and right half of mask remain black.',bindings:['baseColorTexture','emissiveTexture']};
  geo('slit_throat',tube([[0,1.47,.001],[-.018,1.82,.006],[0,2.20,-.018]],.023,.007),core,head);
  // Continuous tapered skirt panels attach across pelvis and spine. Their folds hang behind the body.
  for(let j=0;j<11;j++){
   const a=j/11*Math.PI*2,r=.24+.022*Math.sin(j*1.6),bottom=.12+.19*(.5+.5*Math.sin(j*1.9)),rear=Math.max(0,-Math.sin(a));
   const pos=[],uv=[],idx=[];for(let u=0;u<=8;u++)for(let v=0;v<=14;v++){const t=v/14,phi=a+(u/8-.5)*.62,rad=r*(1+t*.90)+.08*Math.sin(t*Math.PI),x=Math.cos(phi)*rad,y=T.MathUtils.lerp(1.50,bottom,t),z=Math.sin(phi)*rad-.22*t*t-.21*rear*t*t;pos.push(x,y,z);uv.push(u/8,t);}
   for(let u=0;u<8;u++)for(let v=0;v<14;v++){const q=u*15+v;idx.push(q,q+15,q+1,q+1,q+15,q+16);}const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(pos,3)).setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();geo(`trailing_body_fold_${j}`,g,fibre,j%2?spine:pelvis);
  }
  for(const s of [-1,1])geo(`shoulder_membrane_root_${s}`,tube([[s*.13,1.58,-.01],[s*.32,1.58,-.12],[s*.41,1.33,-.19]],.115,.015),fibre,spine);
 }
 // Source motion keeps its stance chain; new torso/head edits and attack remapping are explicit.
 function rotate(a,re,axis,amount,cycles=1){for(const c of a.listChannels()){if(c.getTargetPath()!=='rotation'||!re.test(c.getTargetNode().getName()))continue;const s=c.getSampler(),values=Float32Array.from(s.getOutput().getArray()),ts=s.getInput().getArray(),dur=Math.max(...ts);for(let i=0;i<ts.length;i++){const q=new T.Quaternion().fromArray(values,i*4);q.multiply(new T.Quaternion().setFromAxisAngle(V(...axis),amount*Math.sin(ts[i]/dur*Math.PI*cycles))).toArray(values,i*4);}s.setOutput(s.getOutput().clone().setArray(values));state.animationEdits.push(`${a.getName()}:${c.getTargetNode().getName()}`);}}
 for(const a of root.listAnimations()){
  const attack=a.getName()==='Attack',locomotion=['Walk','Run','Idle'].includes(a.getName());
  if(plan.kind==='crawler')rotate(a,/^Abdomen$/,[0,0,1],attack?.06:plan.deep?.055:.032,attack?1:2);
  if(plan.kind==='grazer')rotate(a,/earth_15_chest/,[1,0,0],attack?.10:.026,attack?1:2);
  if(plan.kind==='maw')rotate(a,/beetle_4_Bone_003/,[1,0,0],attack?.14:.025,attack?1:2);
  if(plan.kind==='colossus')rotate(a,/^spine_03$/,[1,0,0],attack?.13:.035,attack?1:2);
  if(plan.kind==='wraith'){
   rotate(a,/^Head$/,[1,0,0],attack?.14:.06,attack?1:2);
   rotate(a,/^upperarm_l$/,[0,1,0],attack?.18:locomotion?.09:0,attack?1:2);
   rotate(a,/^upperarm_r$/,[0,1,0],attack?-.11:locomotion?-.07:0,attack?1:2);
  }
  const changed=new Map();for(const s of a.listSamplers()){const input=s.getInput();if(!changed.has(input)){const arr=input.getArray(),duration=Math.max(...arr),sourceContact=parent.contactNormalized??.4;const times=Float32Array.from(arr,t=>{const phase=t/duration,remap=phase<sourceContact?phase/sourceContact*plan.contact:plan.contact+(phase-sourceContact)/(1-sourceContact)*(1-plan.contact);return (attack?remap*duration:t)*plan.tempo;});changed.set(input,input.clone().setArray(times));}s.setInput(changed.get(input));}
 }
 if(plan.kind==='colossus')state.materialBatch=batchRigidAnatomy(doc,plan.id);
 const scaleNode=doc.createNode(`${plan.id}_body_scale`).setScale(plan.scale);for(const child of scene.listChildren()){scene.removeChild(child);scaleNode.addChild(child);}scene.addChild(scaleNode);
 if(plan.kind==='wraith'){
  // A hanging apparition folds downward on death instead of falling as a human ragdoll.
  root.listAnimations().find(a=>a.getName()==='Death')?.dispose();const idle=root.listAnimations().find(a=>a.getName()==='Idle'),death=doc.createAnimation('Death'),duration=2.65,idleDuration=Math.max(...idle.listSamplers().flatMap(s=>[...s.getInput().getArray()]));
  for(const c of idle.listChannels()){const source=c.getSampler(),s=doc.createAnimationSampler().setInput(source.getInput().clone().setArray(Float32Array.from(source.getInput().getArray(),t=>t/idleDuration*duration))).setOutput(source.getOutput()).setInterpolation(source.getInterpolation());death.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(c.getTargetNode()).setTargetPath(c.getTargetPath()).setSampler(s));}
  const times=[],scales=[];for(let i=0;i<=32;i++){const t=i/32,p=smooth(.12,.93,t);times.push(t*duration);scales.push(plan.scale[0]*(1-p*.35),plan.scale[1]*(1-p*.91),plan.scale[2]*(1-p*.35));}
  const sampler=doc.createAnimationSampler().setInput(attr('SCALAR',Float32Array.from(times))).setOutput(attr('VEC3',Float32Array.from(scales))).setInterpolation('LINEAR');death.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(scaleNode).setTargetPath('scale').setSampler(sampler));state.animationEdits.push('Death: authored hanging-membrane collapse, preserves a compact horizontal footprint');
 }
 // Eliminate vertices no longer referenced after anatomical removal. Three.js uses every position
 // for precise mesh bounds, so retaining invisible source vertices would create phantom extents.
 for(const mesh of root.listMeshes())for(const p of mesh.listPrimitives())if(p.getIndices()){
  const source=Array.from(p.getIndices().getArray()),used=[...new Set(source)],remap=new Map(used.map((old,index)=>[old,index]));
  for(const semantic of p.listSemantics()){const accessor=p.getAttribute(semantic),array=accessor.getArray(),stride=accessor.getElementSize(),next=new array.constructor(used.length*stride);for(let i=0;i<used.length;i++)for(let k=0;k<stride;k++)next[i*stride+k]=array[used[i]*stride+k];p.setAttribute(semantic,accessor.clone().setArray(next));}
  p.setIndices(p.getIndices().clone().setArray(Uint32Array.from(source,i=>remap.get(i))));
 }
 await doc.transform(prune());const measurements=measureAndGround(doc,plan.id,{hover:plan.kind==='wraith'});await doc.transform(prune());
 const file=`creature_${plan.id}.glb`;await io.write(path.join(OUT,file),doc);const bytes=await readFile(path.join(OUT,file)),b=measurements.idleBounds;
 const clips=Object.fromEntries(root.listAnimations().map(a=>[a.getName(),Math.max(...a.listSamplers().flatMap(s=>[...s.getInput().getArray()]))]));
 const size={x:b.max[0]-b.min[0],y:b.max[1]-b.min[1],z:b.max[2]-b.min[2]};
 const asset={...structuredClone(parent),id:`creature_${plan.id}`,file:`models/creature/${file}`,is:plan.name,bytes:bytes.length,sha256:hash(bytes),size,base:{x:b.min[0],y:b.min[1],z:b.min[2]},triangles:root.listMeshes().reduce((v,m)=>v+m.listPrimitives().reduce((n,p)=>n+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0),materials:root.listMaterials().map(m=>m.getName()),walkClipSeconds:clips.Walk,runClipSeconds:clips.Run,attackSeconds:clips.Attack,contactNormalized:plan.contact,impliedWalkMps:parent.impliedWalkMps?parent.impliedWalkMps*plan.scale[2]/plan.tempo:undefined,impliedRunMps:parent.impliedRunMps?parent.impliedRunMps*plan.scale[2]/plan.tempo:undefined,
 metadata:{...parent.metadata,height:size.y,dimensions:[size.x,size.y,size.z],attackContact:plan.contact,wildernessAnatomy:{sourceAssetId:parent.id,sourceSha256:parent.sha256,sourceLicense:parent.license??parent.metadata?.provenance?.license,sourceAttribution:parent.metadata?.provenance??parent.metadata?.source,generator:'tools/wilderness-creatures/ordinary/build.mjs',generatorSha256:hash(await readFile('tools/wilderness-creatures/ordinary/build.mjs')),atlas:{file:ATLAS_FILE,sha256:hash(atlasSource),generator:'Built-in imagegen edit of original atlas',prompt:`${ART}/atlas-v2-prompt.txt`,uvLayout:'2x2: weathered grey basalt, pale ash slag / muted blue-violet slate, faded fibrous membrane',encodedSha256:hash(atlasBytes)},coreAtlas:{file:CORE_FILE,sha256:hash(coreSource),generator:'Built-in imagegen',prompt:`${ART}/core-atlas-prompt.txt`,encodedSha256:hash(coreBytes),bindings:['baseColorTexture','emissiveTexture'],uvLayout:'2x2: molten red crust, cooling orange crust / blue spectral crust, violet spectral crust'},materialRevision:'Explicit nonmetal diffuse response, weathered midtone faces, unchanged dark cavities, textured recessed core emission',design:plan.design,motion:plan.motion,tier:plan.tier,palette:plan.deep?'indigo stone and blue-violet recessed emission':'neutral basalt and orange-red recessed molten emission',...state,measurements,clips}},acceptance:{exported:true,labAccepted:false,worldIntegrated:false}};
 console.log(JSON.stringify({id:asset.id,triangles:asset.triangles,size,removed:state.removedTriangles,added:state.addedTriangles,minFloor:measurements.minFloor}));return {asset,file};
}
await mkdir(OUT,{recursive:true});await mkdir(ART,{recursive:true});
const only=process.argv.includes('--only')?process.argv[process.argv.indexOf('--only')+1]:undefined;
let catalog={assets:[],files:{}};if(only){try{catalog=JSON.parse(await readFile(`${OUT}/catalog.json`,'utf8'));}catch{}}
for(const plan of DESIGNS.filter(p=>!only||p.id===only)){const {asset,file}=await make(plan),i=catalog.assets.findIndex(a=>a.id===asset.id);if(i<0)catalog.assets.push(asset);else catalog.assets[i]=asset;catalog.files[asset.id]=file;}
await writeFile(`${OUT}/catalog.json`,JSON.stringify(catalog,null,2)+'\n');
await writeFile(`${ART}/designs.json`,JSON.stringify(DESIGNS,null,2)+'\n');

