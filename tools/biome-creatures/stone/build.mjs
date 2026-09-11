/** Anatomy and rig edits to licensed native creatures; stages only, never promotes. */
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {prune} from '@gltf-transform/functions';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const OUT='test-results/biome-creatures/stone';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
const smooth=(a,b,x)=>THREE.MathUtils.smoothstep(x,a,b);
const bell=(x,c,w)=>Math.exp(-(((x-c)/w)**2));
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const configs=[
 {id:'cairn_treader',base:'shale_elemental',tempo:1.12,probe:'earth_35_hand_R',contact:.45,
  design:'Head recessed into a widened shoulder shelf, shortened reach and deeper stone palms, planted legs beneath a low torso; weighted torso sway and native punch recovery.',
  shape(v){const {x,y,z}=v,arms=smooth(.65,1.8,Math.abs(x)),head=smooth(1.94,2.20,y)*(1-smooth(.22,.55,Math.abs(x))),torso=bell(y,1.5,.55)*(1-smooth(.3,.9,Math.abs(x)));
   return V(x*(.92+torso*.28+arms*.015), y<1.1?y*1.06:1.166+(y-1.1)*(.78-head*.32),z*(1+torso*.35+arms*.10)+head*.18);}},
 {id:'flint_mandible',base:'beetle_golem',tempo:1.04,probe:'beetle_5_Bone_004',contact:.5,
  design:'Deep shell mantle, flattened forward shovel cranium and splayed digging claws; braced digging sweep replaces symmetrical upper-body motion.',
  shape(v){const {x,y,z}=v,head=smooth(1.8,2.05,y)*(1-smooth(.35,.65,Math.abs(x))),claw=smooth(.72,1.12,Math.abs(x))*(1-smooth(1.1,1.7,y)),shell=bell(y,1.7,.45)*(1-smooth(.3,.7,Math.abs(x))),shovel=smooth(.59,.68,z)*smooth(1.7,1.9,y);
   return V(x*(1+claw*.37+head*.22),y*.91-head*.15,z*(1+shell*.55)+head*.28+claw*.08+(z-.76)*shovel*1.6);}},
 {id:'vault_custodian',base:'iron_golem',tempo:1.24,probe:'hand_r',contact:.38,
  design:'Source helmet, chest, shoulders and hands removed. New hollow masonry arch torso, slotted vault head, lintel shoulders and closing gate fists share the native rig.',
  shape(v){const {x,y,z}=v,arm=smooth(.55,1.35,Math.abs(x));return V(x*(1.02+arm*.08),y<1.25?y*.82:1.025+(y-1.25)*.90,z*1.14);}},
 {id:'blind_cave_weaver',base:'webweaver_spider',tempo:1.11,probe:'Head',contact:.48,
  design:'Eye geometry removed; divided, ridged abdomen, forward sensory hood and lengthened flattened forelegs; searching head and opposed foreleg sweeps.',
  shape(v){const {x,y,z}=v,body=1-smooth(.22,.5,Math.abs(x)),back=1-smooth(-.35,-.12,z),front=smooth(.25,.6,z),cleft=Math.exp(-((x/.10)**2))*back*body;
   return V(x*(1+back*body*.65+front*.10),y*(.84+smooth(.27,.42,y)*.17)-cleft*.14*smooth(.23,.43,y)+Math.abs(x)*back*body*.2,z<-.18?-.18+(z+.18)*1.7:z*(1+front*.32));}},
 {id:'scree_watcher',base:'stone_golem',tempo:1.07,probe:'hand_r',contact:.38,
  design:'Every source knight mesh replaced by an integrated eroded stone effigy: tapered stilt legs, fused trunk, enclosed split hood and flat forearms. Native rig retained with slow head scan and asymmetric torso counter-turn.',
  shape(v){const {x,y,z}=v,arms=smooth(.7,1.5,Math.abs(x)),torso=bell(y,1.55,.5)*(1-smooth(.2,.55,Math.abs(x)));
   return V(x*(.78+arms*.08),y<1.25?y*1.20:1.5+(y-1.25)*.95,z*(.76+torso*.12));}},
];

function recomputeNormals(p){const pos=p.getAttribute('POSITION'),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos.getArray(),3));if(p.getIndices())g.setIndex(new THREE.BufferAttribute(p.getIndices().getArray(),1));g.computeVertexNormals();p.getAttribute('NORMAL')?.setArray(g.attributes.normal.array);p.setAttribute('TANGENT',null);}
function addRigid(doc,skin,name,jointName,geometry,material){const joint=skin.listJoints().findIndex(j=>j.getName()===jointName);if(joint<0)throw new Error(`Missing ${jointName}`);const buffer=doc.getRoot().listBuffers()[0],p=doc.createPrimitive().setMaterial(material),g=geometry.index?geometry.toNonIndexed():geometry;
 for(const [semantic,attr,size]of [['POSITION','position',3],['NORMAL','normal',3],['TEXCOORD_0','uv',2]])if(g.attributes[attr])p.setAttribute(semantic,doc.createAccessor().setType(size===3?'VEC3':'VEC2').setArray(new Float32Array(g.attributes[attr].array)).setBuffer(buffer));
 const n=g.attributes.position.count,joints=new Uint16Array(n*4),weights=new Float32Array(n*4);for(let i=0;i<n;i++){joints[i*4]=joint;weights[i*4]=1;}
 p.setAttribute('JOINTS_0',doc.createAccessor().setType('VEC4').setArray(joints).setBuffer(buffer));p.setAttribute('WEIGHTS_0',doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer));
 const node=doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(p)).setSkin(skin);doc.getRoot().listScenes()[0].addChild(node);return node;
}
function block(width,height,depth,x,y,z,bevel=.05){
 // Twelve-sided cross-section makes chipped masonry edges, not a cube bolted on top.
 const w=width/2,h=height/2,b=Math.min(bevel,w*.35,h*.35),shape=new THREE.Shape();shape.moveTo(-w+b*1.5,-h);shape.lineTo(w-b*.7,-h*.97);shape.lineTo(w,-h+b*1.7);shape.lineTo(w*.98,h-b);shape.lineTo(w-b*1.7,h*.94);shape.lineTo(-w+b*.8,h);shape.lineTo(-w,h-b*2.1);shape.lineTo(-w*.98,-h+b);shape.closePath();
 const g=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelThickness:.014,bevelSize:.014,bevelSegments:1,steps:1});g.translate(x,y,z-depth/2);return wear(g,.009);
}
function arch(width,height,depth,x,y,z){const w=width/2,h=height/2,shape=new THREE.Shape();shape.moveTo(-w,-h);shape.lineTo(w,-h);shape.lineTo(w,h*.30);shape.quadraticCurveTo(w,h,w*.35,h);shape.lineTo(-w*.35,h);shape.quadraticCurveTo(-w,h,-w,h*.3);shape.closePath();const hole=new THREE.Path();hole.moveTo(-w*.48,-h*.88);hole.lineTo(-w*.48,h*.15);hole.quadraticCurveTo(-w*.48,h*.55,0,h*.58);hole.quadraticCurveTo(w*.48,h*.55,w*.48,h*.15);hole.lineTo(w*.48,-h*.88);hole.closePath();shape.holes.push(hole);const g=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelSize:.025,bevelThickness:.025,bevelSegments:1,steps:1,curveSegments:4});g.translate(x,y,z-depth/2);return g;}
function limb(a,b,r0,r1){const direction=b.clone().sub(a),g=new THREE.CylinderGeometry(r1,r0,direction.length()+.09,7,1);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0,1,0),direction.clone().normalize()));g.translate(...a.clone().add(b).multiplyScalar(.5).toArray());return g;}
function loft(rings,segments=10,groove=false){const positions=[],indices=[];for(const [ri,r]of rings.entries())for(let i=0;i<segments;i++){const angle=i/segments*Math.PI*2,edge=1+.075*Math.sin(i*3.7+ri*.9),x=Math.cos(angle)*r[1]*edge,z=Math.sin(angle)*r[2]*edge;positions.push(x,r[0],z-(groove&&z>0?Math.exp(-((x/.07)**2))*.095:0)+(r[3]??0));}for(let j=0;j<rings.length-1;j++)for(let i=0;i<segments;i++){const a=j*segments+i,b=j*segments+(i+1)%segments,c=a+segments,d=b+segments;indices.push(a,c,b,b,c,d);}for(let i=1;i<segments-1;i++){indices.push(0,i,i+1);const a=(rings.length-1)*segments;indices.push(a,a+i+1,a+i);}const g=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return g;}
function erodedLimb(a,b,r0,r1,flat=1){const direction=b.clone().sub(a),length=direction.length(),g=loft([[-.04,r0,r0*flat],[length*.3,r0*1.09,r0*flat*.90],[length*.64,r1*1.08,r1*flat*1.1],[length+.04,r1*.92,r1*flat]],8);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0,1,0),direction.clone().normalize()));g.translate(...a.toArray());return g;}
function wear(g,amount=.012){const p=g.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i);p.setXYZ(i,x+Math.sin(y*31+z*47)*amount,y+Math.sin(x*23+z*39)*amount*.65,z+Math.sin(x*43+y*27)*amount);}g.computeVertexNormals();return g;}
function ruinedArch(){const pieces=[block(.24,.42,.46,-.36,1.23,.01,.045),block(.26,.42,.46,.35,1.23,.015,.065)];
 for(let i=0;i<5;i++){const gap=.012,a0=i*Math.PI/5+gap,a1=(i+1)*Math.PI/5-gap,shape=new THREE.Shape(),outer=.49+(i===2?.035:0),inner=.245;shape.moveTo(Math.cos(a0)*inner,Math.sin(a0)*inner);shape.lineTo(Math.cos(a0)*outer,Math.sin(a0)*outer);for(let t=1;t<=3;t++){const a=a0+(a1-a0)*t/3;shape.lineTo(Math.cos(a)*outer,Math.sin(a)*outer);}shape.lineTo(Math.cos(a1)*inner,Math.sin(a1)*inner);for(let t=2;t>=0;t--){const a=a0+(a1-a0)*t/3;shape.lineTo(Math.cos(a)*inner,Math.sin(a)*inner);}shape.closePath();const depth=.47+(i===2?.035:0),g=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelThickness:.015,bevelSize:.012,bevelSegments:1,curveSegments:1,steps:1});g.translate(0,1.39,-depth/2+.015);pieces.push(wear(g,.01));}
 return mergeGeometries(pieces);
}

async function make(config){const parent=manifest.assets.find(a=>a.id===`creature_${config.base}`),doc=await io.read(`game/public/assets/${parent.file}`),root=doc.getRoot(),buffer=root.listBuffers()[0];
 const oldWorld=new Map(root.listNodes().map(n=>[n,new THREE.Matrix4().fromArray(n.getWorldMatrix())]));
 const jointSet=new Set(root.listSkins().flatMap(s=>s.listJoints()));const oldLocal=new Map([...jointSet].map(n=>[n,n.getTranslation()]));
 let removedTriangles=0,deformedVertices=0;
 for(const node of root.listNodes())if(node.getMesh()){
  const remove=(config.id==='vault_custodian'&&/Body_Armor|Pauldron|Armet|_Arms|Eyes|SuperHero/.test(node.getName()))||config.id==='scree_watcher';
  if(remove){for(const p of node.getMesh().listPrimitives())removedTriangles+=(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3;node.setMesh(null);continue;}
  const world=oldWorld.get(node),sourceSkin=node.getSkin(),binds=sourceSkin?.listJoints().map((joint,i)=>oldWorld.get(joint).clone().multiply(new THREE.Matrix4().fromArray(sourceSkin.getInverseBindMatrices().getArray(),i*16)));for(const p of node.getMesh().listPrimitives()){
   if(config.id==='blind_cave_weaver'&&p.getMaterial()?.getName().endsWith('Material.001')){node.getMesh().removePrimitive(p);removedTriangles+=(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3;continue;}
   const pos=p.getAttribute('POSITION'),array=pos.getArray().slice(),weights=p.getAttribute('WEIGHTS_0')?.getArray(),joints=p.getAttribute('JOINTS_0')?.getArray();for(let i=0;i<pos.getCount();i++){const raw=V().fromArray(array,i*3),worldPoint=V();if(binds&&weights){for(let k=0;k<4;k++)if(weights[i*4+k])worldPoint.addScaledVector(raw.clone().applyMatrix4(binds[joints[i*4+k]]),weights[i*4+k]);}else worldPoint.copy(raw).applyMatrix4(world);const point=config.shape(worldPoint);point.toArray(array,i*3);deformedVertices++;}pos.setArray(array);recomputeNormals(p);
  }
  node.getParentNode()?.removeChild(node);root.listScenes()[0].addChild(node);node.setTranslation([0,0,0]).setRotation([0,0,0,1]).setScale([1,1,1]);
 }
 // The same continuous body field moves joints, vertices and local translation keys.
 const oldParent=new Map([...jointSet].map(n=>[n,n.getParentNode()?oldWorld.get(n.getParentNode()):new THREE.Matrix4()]));
 for(const scene of root.listScenes())scene.traverse(n=>{if(!jointSet.has(n))return;const worldPoint=config.shape(V().setFromMatrixPosition(oldWorld.get(n))),parent=n.getParentNode(),inverse=new THREE.Matrix4().fromArray(parent?parent.getWorldMatrix():new THREE.Matrix4().toArray()).invert();n.setTranslation(worldPoint.applyMatrix4(inverse).toArray());});
 for(const skin of root.listSkins())skin.getInverseBindMatrices().setArray(Float32Array.from(skin.listJoints().flatMap(j=>new THREE.Matrix4().fromArray(j.getWorldMatrix()).invert().toArray())));
 for(const animation of root.listAnimations())for(const channel of animation.listChannels())if(channel.getTargetPath()==='translation'&&jointSet.has(channel.getTargetNode())){
  const node=channel.getTargetNode(),sampler=channel.getSampler(),src=sampler.getOutput(),values=src.getArray().slice(),old=oldLocal.get(node),now=node.getTranslation();
  // Rest translation differences are preserved exactly. Native local motion deltas are adapted to new limb length.
  const lengthOld=Math.hypot(...old),lengthNew=Math.hypot(...now),ratio=lengthOld>.001?lengthNew/lengthOld:1;
  for(let i=0;i<values.length;i+=3)for(let k=0;k<3;k++)values[i+k]=now[k]+(values[i+k]-old[k])*ratio;
  sampler.setOutput(src.clone().setArray(values));
 }
 const skin=root.listSkins()[0];
 const stone=doc.createMaterial(`animal_rpg_${config.id}_weathered_limestone`).setBaseColorFactor([.72,.72,.69,1]).setRoughnessFactor(.94);
 const iron=doc.createMaterial(`animal_rpg_${config.id}_worn_cast_iron`).setBaseColorFactor([.42,.43,.40,1]).setRoughnessFactor(.81).setMetallicFactor(.28);
 const rigid=(name,joint,g,mat=stone)=>addRigid(doc,skin,`${config.id}_${name}`,joint,g,mat);
 if(['vault_custodian','scree_watcher'].includes(config.id))for(const side of ['l','r']){
  const point=name=>V().setFromMatrixPosition(new THREE.Matrix4().fromArray(skin.listJoints().find(j=>j.getName()===name).getWorldMatrix()));
  const upper=point(`upperarm_${side}`),elbow=point(`lowerarm_${side}`),wrist=point(`hand_${side}`),vault=config.id==='vault_custodian';
  rigid(`upper_limb_${side}`,`upperarm_${side}`,wear(erodedLimb(upper,elbow,vault?.21:.12,vault?.16:.095),.009));
  rigid(`lower_limb_${side}`,`lowerarm_${side}`,wear(erodedLimb(elbow,wrist,vault?.17:.15,vault?.20:.19,vault?1:.55),.008));
 }
 if(config.id==='vault_custodian'){
  rigid('hollow_vault_body','spine_03',ruinedArch());
  rigid('vault_crown','Head',block(.57,.19,.40,0,1.91,.01),iron);
  rigid('visor_left','Head',block(.12,.24,.33,-.205,1.755,.01),iron);rigid('visor_right','Head',block(.12,.24,.33,.205,1.755,.01),iron);
  rigid('visor_sill','Head',block(.50,.10,.36,0,1.62,.01),iron);
  for(const sign of [-1,1]){const side=sign<0?'r':'l';rigid(`lintel_${side}`,`upperarm_${side}`,block(.52,.35,.55,sign*.49,1.77,-.06),iron);rigid(`gate_fist_${side}`,`hand_${side}`,block(.45,.47,.60,sign*1.61,1.73,-.12),iron);}
 }else if(config.id==='scree_watcher'){
  rigid('eroded_trunk','spine_03',loft([[1.27,.23,.20],[1.45,.22,.18],[1.65,.30,.21],[1.87,.39,.25],[2.08,.44,.23],[2.18,.29,.17]],12));
  rigid('split_listening_hood','Head',loft([[2.07,.18,.15,-.025],[2.19,.29,.20,-.025],[2.43,.27,.185,-.025],[2.62,.21,.14,-.025],[2.73,.09,.065,-.025]],12,true));
  const point=name=>V().setFromMatrixPosition(new THREE.Matrix4().fromArray(skin.listJoints().find(j=>j.getName()===name).getWorldMatrix()));
  for(const sign of [-1,1]){const side=sign<0?'r':'l',upper=point(`upperarm_${side}`),wrist=point(`hand_${side}`),thigh=point(`thigh_${side}`),knee=point(`calf_${side}`),foot=point(`foot_${side}`);
   const mantle=loft([[-.11,.15,.19],[.05,.22,.22],[.16,.16,.13]],10);mantle.translate(...upper.toArray());rigid(`stone_mantle_${side}`,`upperarm_${side}`,mantle);
   const blade=loft([[-.04,.17,.09],[.05,.19,.1],[.20,.15,.08],[.29,.08,.04]],8);blade.rotateZ(sign*-Math.PI/2);blade.translate(...wrist.toArray());rigid(`flat_palm_${side}`,`hand_${side}`,blade);
   rigid(`stilt_thigh_${side}`,`thigh_${side}`,erodedLimb(thigh,knee,.14,.095,.95));
   rigid(`stilt_shin_${side}`,`calf_${side}`,erodedLimb(knee,foot,.10,.07,.85));
   const sole=loft([[foot.y-.12,.13,.20,.025],[foot.y-.025,.13,.21,.02],[foot.y+.12,.075,.11,-.02]],8);sole.translate(foot.x,0,foot.z+.055);rigid(`forked_sole_${side}`,`foot_${side}`,sole);
  }
 }
 for(const mat of root.listMaterials()){
  mat.setName(mat.getName().replaceAll(config.base,config.id));mat.setEmissiveFactor([0,0,0]);
  if(config.id==='cairn_treader'){mat.setRoughnessFactor(.98);mat.setBaseColorFactor([1,1,.96,1]);}
  if(config.id==='flint_mandible'){mat.setRoughnessFactor(.78);mat.setBaseColorFactor([.53,.57,.55,1]);}
  if(config.id==='blind_cave_weaver'){mat.setBaseColorFactor([.63,.63,.58,1]);mat.setRoughnessFactor(.72);mat.setMetallicFactor(0);}
  if(config.id==='scree_watcher'&&mat.getBaseColorTexture())mat.setBaseColorFactor([.54,.54,.50,1]);
 }
 const textureFile=config.id==='blind_cave_weaver'?'art/biome-creatures/stone/cave-chitin-albedo.png':['cairn_treader','vault_custodian','scree_watcher'].includes(config.id)?'art/biome-creatures/stone/ancient-limestone-albedo.png':null;
 if(textureFile){const albedo=doc.createTexture(`animal_rpg_${config.id}_authored_albedo`).setImage(await readFile(textureFile)).setMimeType('image/png');for(const mat of root.listMaterials()){
   mat.setBaseColorTexture(albedo).setBaseColorFactor(config.id==='blind_cave_weaver'?[.86,.89,.85,1]:config.id==='vault_custodian'?[.66,.68,.65,1]:[.86,.88,.82,1]).setRoughnessFactor(config.id==='blind_cave_weaver'?.72:.94).setMetallicFactor(0).setMetallicRoughnessTexture(null);
   mat.getBaseColorTextureInfo().setWrapS(10497).setWrapT(10497);
  }
  for(const node of root.listNodes())if(node.getMesh())for(const p of node.getMesh().listPrimitives()){
   // Native source UVs remain on sculpted bodies. Replacement masonry uses physical planar coordinates.
   if(node.getName().startsWith(config.id+'_')||!p.getAttribute('TEXCOORD_0')){const pos=p.getAttribute('POSITION'),uv=new Float32Array(pos.getCount()*2);for(let i=0;i<pos.getCount();i+=3){const a=V().fromArray(pos.getElement(i,[])),b=V().fromArray(pos.getElement(i+1,[])),c=V().fromArray(pos.getElement(i+2,[])),n=b.sub(a).cross(c.sub(a)).normalize().toArray(),axis=Math.abs(n[0])>Math.abs(n[1])&&Math.abs(n[0])>Math.abs(n[2])?0:Math.abs(n[1])>Math.abs(n[2])?1:2;for(let k=0;k<3;k++){const x=pos.getElement(i+k,[]);uv[(i+k)*2]=x[axis===0?2:0]*1.5;uv[(i+k)*2+1]=x[axis===1?2:1]*1.5;}}p.setAttribute('TEXCOORD_0',doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buffer));}
  }
 }
 const motionEdits=[];
 if(config.id==='vault_custodian'){
  root.listAnimations().find(a=>a.getName()==='Run')?.dispose();const run=doc.createAnimation('Run'),walk=root.listAnimations().find(a=>a.getName()==='Walk');
  for(const source of walk.listChannels()){const s=source.getSampler(),sampler=doc.createAnimationSampler().setInput(s.getInput().clone().setArray(Float32Array.from(s.getInput().getArray(),t=>t*.72))).setOutput(s.getOutput()).setInterpolation(s.getInterpolation());run.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(source.getTargetNode()).setTargetPath(source.getTargetPath()).setSampler(sampler));}
  motionEdits.push('Run: deliberately derives from the weight-transferring native Walk at 1/0.72 speed; no floating jog pose');
 }
 function rotateTrack(animation,regex,axis,angle,wave){for(const channel of animation.listChannels())if(channel.getTargetPath()==='rotation'&&regex.test(channel.getTargetNode()?.getName()??'')){
  const sampler=channel.getSampler(),input=sampler.getInput().getArray(),output=sampler.getOutput(),values=output.getArray().slice(),duration=input.at(-1);for(let i=0;i<input.length;i++){const t=input[i]/duration,a=angle*wave(t);new THREE.Quaternion().fromArray(values,i*4).multiply(new THREE.Quaternion().setFromAxisAngle(axis,a)).toArray(values,i*4);}sampler.setOutput(output.clone().setArray(values));motionEdits.push(`${animation.getName()}:${channel.getTargetNode().getName()}`);}}
 for(const animation of root.listAnimations()){
  const name=animation.getName(),walking=['Walk','Run'].includes(name),idle=name==='Idle',attack=name==='Attack';
  if(config.id==='cairn_treader')rotateTrack(animation,/earth_15_chest/,V(0,0,1),walking?.075:attack?.14:.03,t=>Math.sin(t*Math.PI*(walking?2:1)));
  if(config.id==='flint_mandible')rotateTrack(animation,/beetle_3_Bone_002/,V(0,1,0),attack?.22:.055,t=>Math.sin(t*Math.PI*(attack?1:2)));
  if(config.id==='vault_custodian'){rotateTrack(animation,/spine_03/,V(1,0,0),attack?.14:walking?.045:.015,t=>Math.sin(t*Math.PI*(attack?1:2)));if(attack)rotateTrack(animation,/lowerarm_l/,V(0,0,1),.24,t=>Math.sin(t*Math.PI));}
  if(config.id==='blind_cave_weaver'&&(idle||walking)){rotateTrack(animation,/^Head$/,V(0,1,0),.18,t=>Math.sin(t*Math.PI*2));rotateTrack(animation,/^FrontLegL$/,V(0,0,1),.14,t=>Math.sin(t*Math.PI*2));rotateTrack(animation,/^FrontLegR$/,V(0,0,1),-.14,t=>Math.sin(t*Math.PI*2));}
  if(config.id==='scree_watcher'){rotateTrack(animation,/^Head$/,V(0,1,0),idle?.25:.1,t=>Math.sin(t*Math.PI*2));rotateTrack(animation,/spine_03/,V(0,1,0),walking?.085:attack?.18:.055,t=>Math.sin(t*Math.PI*(attack?1:2)));}
  const retimed=new Map();for(const sampler of animation.listSamplers()){const input=sampler.getInput();if(!retimed.has(input))retimed.set(input,input.clone().setArray(Float32Array.from(input.getArray(),v=>v*config.tempo)));sampler.setInput(retimed.get(input));}
 }
 await doc.transform(prune());
 // Recompute grounding and extents from the actual skinned result, including new body parts.
 const measure=await measureAndGround(doc,config);
 await doc.transform(prune());
 const assetId=`creature_${config.id}`,file=`${assetId}.glb`;await io.write(path.join(OUT,file),doc);const bytes=await readFile(path.join(OUT,file));
 const asset={...structuredClone(parent),id:assetId,file:`models/creature/${file}`,is:config.id.replaceAll('_',' '),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),size:measure.size,base:measure.base,triangles:root.listMeshes().reduce((n,m)=>n+m.listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0),materials:root.listMaterials().map(m=>m.getName()),walkClipSeconds:measure.clips.Walk.duration,runClipSeconds:measure.clips.Run.duration,attackSeconds:measure.clips.Attack.duration,contactNormalized:measure.attackContact,
  impliedWalkMps:parent.impliedWalkMps?parent.impliedWalkMps/config.tempo:undefined,impliedRunMps:parent.impliedRunMps?parent.impliedRunMps/config.tempo:undefined,
  metadata:{...parent.metadata,redesign:{sourceAssetId:parent.id,sourceSha256:parent.sha256,design:config.design,generator:'tools/biome-creatures/stone/build.mjs',albedo:textureFile,deformedVertices,removedTriangles,motionEdits,measurement:measure,sourceLicense:parent.license??parent.metadata?.provenance?.license}},acceptance:{exported:true,labAccepted:false,worldIntegrated:false}};
 return{asset,file};
}

export async function measuredScene(doc){const bare=await io.readBinary(await io.writeBinary(doc));for(const m of bare.getRoot().listMaterials()){m.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null).setOcclusionTexture(null);}await bare.transform(prune());const bytes=await io.writeBinary(bare);return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');}
async function measureAndGround(doc,config){const root=doc.getRoot(),gltf=await measuredScene(doc),scene=gltf.scene,mixer=new THREE.AnimationMixer(scene),ground=doc.createNode(`${config.id}_ground`),children=root.listScenes()[0].listChildren();for(const c of children){root.listScenes()[0].removeChild(c);ground.addChild(c);}root.listScenes()[0].addChild(ground);
 const union=new THREE.Box3(),clips={},buffer=root.listBuffers()[0];let idleBox,attackContact=config.contact,maxReach=-Infinity;
 for(const clip of gltf.animations){mixer.stopAllAction();const action=mixer.clipAction(clip).setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();const times=[],values=[],bounds=new THREE.Box3();let maxLift=0,maxDrop=0;
  for(let i=0;i<=Math.ceil(clip.duration*120);i++){const time=Math.min(clip.duration,i/120);mixer.setTime(time);scene.updateMatrixWorld(true);scene.traverse(n=>{if(n.isSkinnedMesh)n.computeBoundingBox();});const box=new THREE.Box3().setFromObject(scene,true),offset=.003-box.min.y;maxLift=Math.max(maxLift,offset);maxDrop=Math.min(maxDrop,offset);times.push(time);values.push(0,offset,0);box.translate(V(0,offset,0));bounds.union(box);if(clip.name==='Idle'&&i===0)idleBox=box.clone();
   if(clip.name==='Attack'){const probe=scene.getObjectByName(config.probe),z=probe?.getWorldPosition(V()).z;if(z>maxReach){maxReach=z;attackContact=time/clip.duration;}}
  }
  union.union(bounds);clips[clip.name]={duration:clip.duration,samples:times.length,min:bounds.min.toArray(),max:bounds.max.toArray(),floorCorrection:{maxLift,maxDrop}};
  const animation=root.listAnimations().find(a=>a.getName()===clip.name),sampler=doc.createAnimationSampler().setInterpolation('LINEAR').setInput(doc.createAccessor().setType('SCALAR').setArray(Float32Array.from(times)).setBuffer(buffer)).setOutput(doc.createAccessor().setType('VEC3').setArray(Float32Array.from(values)).setBuffer(buffer));animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(ground).setTargetPath('translation').setSampler(sampler));
 }
 mixer.stopAllAction();const size=idleBox.getSize(V());return{size:{x:size.x,y:size.y,z:size.z},base:{x:idleBox.min.x,y:idleBox.min.y,z:idleBox.min.z},animatedMin:union.min.toArray(),animatedMax:union.max.toArray(),clips,attackContact:Number.isFinite(attackContact)?attackContact:config.contact,attackContactSource:`Maximum forward reach of ${config.probe}, sampled at 120 Hz`,grounding:'Actual deformed geometry per clip at 120 Hz; wrapper correction preserves native skeletal contacts'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 await mkdir(OUT,{recursive:true});const only=process.argv.includes('--only')?process.argv[process.argv.indexOf('--only')+1]:null,catalog=only?JSON.parse(await readFile(path.join(OUT,'catalog.json'),'utf8')):{assets:[],files:{}};
 if(only&&!configs.some(c=>c.id===only))throw new Error(`Unknown stone candidate ${only}`);
 for(const config of configs.filter(c=>!only||c.id===only)){const {asset,file}=await make(config),index=catalog.assets.findIndex(a=>a.id===asset.id);if(index<0)catalog.assets.push(asset);else catalog.assets[index]=asset;catalog.files[asset.id]=file;console.log(`${asset.id}: ${asset.triangles} triangles; ${Object.values(asset.size).map(x=>x.toFixed(2)).join(' x ')} m`);}
 await writeFile(path.join(OUT,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');
}
