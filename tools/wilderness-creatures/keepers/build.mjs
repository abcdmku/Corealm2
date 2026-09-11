/** Original keeper anatomy on licensed native skeletons. Stages assets only. */
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, joinPrimitives } from '@gltf-transform/functions';
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { buildHollowStar } from './hollow-star.mjs';

const OUT = 'test-results/wilderness-creatures/keepers';
const ART = 'assets/art/wilderness-creatures/keepers';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const V = (x=0,y=0,z=0) => new T.Vector3(x,y,z);
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
await mkdir(OUT,{recursive:true});
const atlasSource = await readFile(`${ART}/material-atlas-v3.png`);
const atlas = await sharp(atlasSource).resize(1024,1024).jpeg({quality:91,mozjpeg:true}).toBuffer();
const heatSource = await readFile(`${ART}/heat-atlas-v2.png`);
const heat = await sharp(heatSource).resize(1024,1024).jpeg({quality:92,mozjpeg:true}).toBuffer();
const textureInputs = { atlas, sourceSha:sha(atlasSource), heat, heatSourceSha:sha(heatSource) };
const configs = [
 {id:'ashseal_warden',base:'iron_golem',factor:1.78,contact:.61,attackDuration:2.3,tempo:1.2,deep:false,
  design:'An ash seal imprisoned in a broad split volcanic breastplate. One forearm grows into a thick broken shield with a hollow centre. Tapered shins, interlocking feet, a recessed blind head and fused shoulder strata carry the mass.',
  motion:'Heavy native planted gait; broad shield brace precedes a delayed crushing arm strike, with extended recovery.'},
 {id:'furnace_regent',base:'lava_golem',factor:1.76,contact:.66,attackDuration:2.6,tempo:1.25,deep:false,
  design:'A walking open caldera. Slag ribs enclose a sunken molten organ beneath a high overhanging crater mantle. Its jaw is a broken vent and each forearm is a ridged furnace plunger.',
  motion:'Native lava-golem support cycle, prolonged two-arm windup, late descending contact and settling torso compression.'},
 {id:'chainbound_archon',base:'banshee',factor:2.22,contact:.64,attackDuration:2.5,tempo:1.6,deep:true,hover:true,
  design:'An unbodied archon suspended inside a broken double stone thorax. Open stone forearm rails, narrow hooked hands and separated wrist shackles expose recessed spectral marrow between asymmetric structural ribs. A sealed head, hanging split vertebral blades and load-bearing chain lengths retain its bound jailer silhouette.',
  motion:'Footless hover using native caster suspension. Split thorax counter-turns, long forearms rise then pull together on contact, with delayed chain movement.'},
 {id:'nightforge_marshal',base:'iron_golem',factor:1.94,contact:.68,attackDuration:2.75,tempo:1.32,deep:true,
  design:'A hollow gate-shaped cuirass with a pointed arch opening, buttressed shoulder armour and an integrated hammer forearm. There is no ordinary knight body or helmet inside the worn obsidian frame.',
  motion:'Slow braced step, a long hammer shoulder telegraph, late downward impact and a visibly weighted return.'},
];

function sha(bytes){return createHash('sha256').update(bytes).digest('hex');}
export function roughen(g,amount=.012){const p=g.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i);p.setXYZ(i,x+Math.sin(y*29+z*31)*amount,y+Math.sin(x*23+z*37)*amount*.7,z+Math.sin(x*41+y*17)*amount);}g.computeVertexNormals();return g;}
export function tube(points,radius=.06,segments=20,sides=8){const c=new T.CatmullRomCurve3(points.map(p=>Array.isArray(p)?V(...p):p));return new T.TubeGeometry(c,segments,radius,sides,false);}
export function loft(rows,segments=16,cap=true){const p=[],uv=[],indices=[];for(let j=0;j<rows.length;j++){const [y,rx,rz,cx=0,cz=0]=rows[j];for(let i=0;i<=segments;i++){const a=i/segments*Math.PI*2,r=1+.036*Math.sin(i*2.71+j*.77);p.push(cx+Math.cos(a)*rx*r,y,cz+Math.sin(a)*rz*r);uv.push(i/segments,j/(rows.length-1));}}for(let j=0;j<rows.length-1;j++)for(let i=0;i<segments;i++){const a=j*(segments+1)+i,b=a+segments+1;indices.push(a,b,a+1,a+1,b,b+1);}if(cap)for(let i=1;i<segments-1;i++){indices.push(0,i,i+1);const a=(rows.length-1)*(segments+1);indices.push(a,a+i+1,a+i);}const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(p,3)).setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;}
export function plate(w,h,d,x,y,z,bevel=.04){const s=new T.Shape(),a=w/2,b=h/2;s.moveTo(-a+bevel,-b);s.lineTo(a-bevel,-b*.96);s.lineTo(a,-b+bevel);s.lineTo(a*.97,b-bevel);s.lineTo(a-bevel,b*.97);s.lineTo(-a+bevel,b);s.lineTo(-a,b-bevel);s.lineTo(-a,-b+bevel);s.closePath();const g=new T.ExtrudeGeometry(s,{depth:d,bevelEnabled:true,bevelSegments:1,bevelSize:bevel*.3,bevelThickness:bevel*.3,steps:1});g.translate(x,y,z-d/2);return roughen(g,.007);}
function ellipsoid(p,r,detail=2){const g=new T.IcosahedronGeometry(1,detail);g.scale(...r);g.translate(...p);return roughen(g,.01);}
function limb(a,b,r0,r1,flat=1){const length=a.distanceTo(b),g=loft([[-.05,r0,r0*flat],[length*.29,r0*1.12,r0*flat*.95],[length*.76,r1*1.1,r1*flat],[length+.05,r1*.93,r1*flat*.95]],12);g.applyQuaternion(new T.Quaternion().setFromUnitVectors(V(0,1,0),b.clone().sub(a).normalize()));g.translate(...a.toArray());return roughen(g,.007);}
function sector(cx,cy,cz,outer,inner,start,end,depth,segments=16){const s=new T.Shape();s.moveTo(cx+Math.cos(start)*outer,cy+Math.sin(start)*outer);for(let i=1;i<=segments;i++){const a=start+(end-start)*i/segments;s.lineTo(cx+Math.cos(a)*outer,cy+Math.sin(a)*outer);}for(let i=segments;i>=0;i--){const a=start+(end-start)*i/segments;s.lineTo(cx+Math.cos(a)*inner,cy+Math.sin(a)*inner);}s.closePath();const g=new T.ExtrudeGeometry(s,{depth,bevelEnabled:true,bevelSegments:1,bevelSize:.018,bevelThickness:.018,steps:1});g.translate(0,0,cz-depth/2);return roughen(g,.008);}
function gate(x,y,z,w,h,d,pointed=false){const s=new T.Shape(),a=w/2,b=h/2;s.moveTo(-a,-b);s.lineTo(a,-b);s.lineTo(a,b*.38);s.lineTo(pointed?0:a*.4,b);if(!pointed)s.lineTo(-a*.4,b);s.lineTo(-a,b*.38);s.closePath();const hole=new T.Path();hole.moveTo(-a*.53,-b*.85);hole.lineTo(-a*.53,b*.23);hole.lineTo(0,b*.70);hole.lineTo(a*.53,b*.23);hole.lineTo(a*.53,-b*.85);hole.closePath();s.holes.push(hole);const g=new T.ExtrudeGeometry(s,{depth:d,bevelEnabled:true,bevelSegments:1,bevelSize:.025,bevelThickness:.025,steps:1});g.translate(x,y,z-d/2);return roughen(g,.009);}

export async function materialSet(doc,config){const tx=doc.createTexture('keeper_authored_basalt_iron_obsidian_atlas').setImage(textureInputs.atlas).setMimeType('image/jpeg');
 const m=(name,color,tile,rough=.9,metal=0,emissive=[0,0,0])=>{const mat=doc.createMaterial(`animal_rpg_${config.id}_${name}`).setBaseColorFactor([...color,1]).setRoughnessFactor(rough).setMetallicFactor(metal).setEmissiveFactor(emissive);if(tile!==null){mat.setBaseColorTexture(tx);mat.getBaseColorTextureInfo().setWrapS(33071).setWrapT(33071);}mat.setExtras({atlasTile:tile,role:name});return mat;};
 const roughBytes=await sharp(atlasSource).resize(1024,1024).raw().toBuffer({resolveWithObject:true});const mr=Buffer.alloc(1024*1024*3);for(let i=0;i<1024*1024;i++){const l=(roughBytes.data[i*roughBytes.info.channels]+roughBytes.data[i*roughBytes.info.channels+1]+roughBytes.data[i*roughBytes.info.channels+2])/3;mr[i*3]=255;mr[i*3+1]=Math.min(255,185+l*.42);mr[i*3+2]=255;}const rough=doc.createTexture('keeper_authored_grain_roughness').setImage(await sharp(mr,{raw:{width:1024,height:1024,channels:3}}).png().toBuffer()).setMimeType('image/png');
 const stone=m('weathered_body',[1,1,1],config.deep?2:0,.93),iron=m('forged_structural_iron',[1,1,1],1,.79,0),ash=m('worn_strata',[1,1,1],3,.98),dark=m('cavity_interior',[.44,.46,.50],config.deep?2:0,.96),core=m('recessed_seam_marrow',[1,1,1],config.deep?2:0,.91,0,config.deep?[.85,.85,.85]:[.90,.90,.90]);
 // Only the already-authored internal marrow receives heat. Dark crust in both maps occludes emission.
 const heatMap=doc.createTexture('keeper_crusted_molten_marrow_atlas').setImage(textureInputs.heat).setMimeType('image/jpeg');
 core.setBaseColorTexture(heatMap).setEmissiveTexture(heatMap);
 core.getBaseColorTextureInfo().setWrapS(33071).setWrapT(33071);
 core.getEmissiveTextureInfo().setWrapS(33071).setWrapT(33071);
 core.setExtras({...core.getExtras(),heatAtlas:true,emissionRole:'Recessed coloured heat with dark cooled crust, never emissive outside stone'});
 for(const mat of [stone,iron,ash,dark])mat.setMetallicRoughnessTexture(rough);
 return {stone,iron,ash,dark,core};
}
export function addSkinGeometry(doc,skin,name,geometry,mat,jointWeights){const buffer=doc.getRoot().listBuffers()[0],g=geometry.index?geometry.toNonIndexed():geometry;g.computeVertexNormals();const p=doc.createPrimitive().setMaterial(mat),positions=g.attributes.position,n=positions.count,uv=new Float32Array(n*2),tile=mat.getExtras().atlasTile;
 // Per-face physical projection avoids stretched generated tubes and keeps material cells isolated.
 for(let i=0;i<n;i+=3){const a=V().fromBufferAttribute(positions,i),b=V().fromBufferAttribute(positions,i+1),c=V().fromBufferAttribute(positions,i+2),normal=b.clone().sub(a).cross(c.clone().sub(a)),abs=[Math.abs(normal.x),Math.abs(normal.y),Math.abs(normal.z)],axis=abs.indexOf(Math.max(...abs)),points=[a,b,c],us=points.map(q=>(axis===0?q.z:q.x)*.75),vs=points.map(q=>(axis===1?q.z:q.y)*.75);
  // Translate the whole triangle inside one chart. Never wrap its vertices independently.
  const chart=values=>{const min=Math.min(...values),max=Math.max(...values),range=max-min,scale=range>.97?.97/range:1,span=range*scale,mid=(min+max)/2,origin=T.MathUtils.clamp(mid-Math.floor(mid)-span/2,0,1-span);return values.map(v=>origin+(v-min)*scale);},cu=chart(us),cv=chart(vs);for(let k=0;k<3;k++){uv[(i+k)*2]=(tile===null?0:tile%2)*.5+.012+cu[k]*.476;uv[(i+k)*2+1]=(tile===null?0:Math.floor(tile/2))*.5+.012+cv[k]*.476;}}
 for(const [semantic,a,type]of [['POSITION',g.attributes.position,'VEC3'],['NORMAL',g.attributes.normal,'VEC3']])p.setAttribute(semantic,doc.createAccessor().setType(type).setArray(Float32Array.from(a.array)).setBuffer(buffer));p.setAttribute('TEXCOORD_0',doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buffer));
 const ids=new Uint16Array(n*4),weights=new Float32Array(n*4);for(let i=0;i<n;i++){const point=V().fromBufferAttribute(positions,i),entries=typeof jointWeights==='function'?jointWeights(point):jointWeights;for(let k=0;k<entries.length;k++){ids[i*4+k]=skin.listJoints().indexOf(entries[k][0]);weights[i*4+k]=entries[k][1];if(ids[i*4+k]>65000)throw Error(`${name} missing skin joint`);}}
 p.setAttribute('JOINTS_0',doc.createAccessor().setType('VEC4').setArray(ids).setBuffer(buffer)).setAttribute('WEIGHTS_0',doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer));const node=doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(p)).setSkin(skin);doc.getRoot().listScenes()[0].addChild(node);return node;
}

async function native(config){const parent=manifest.assets.find(a=>a.id===`creature_${config.base}`),doc=await io.read(`game/public/assets/${parent.file}`),root=doc.getRoot(),scene=root.listScenes()[0],skin=root.listSkins()[0],buffer=root.listBuffers()[0];let removedTriangles=0;
 const jointSet=new Set(root.listSkins().flatMap(s=>s.listJoints()));for(const n of root.listNodes())if(n.getMesh()){removedTriangles+=n.getMesh().listPrimitives().reduce((a,p)=>a+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0);n.setMesh(null);}
 // Rebuilt geometry is authored in world bind coordinates, so native inverse binds must use that space.
 skin.getInverseBindMatrices().setArray(Float32Array.from(skin.listJoints().flatMap(j=>new T.Matrix4().fromArray(j.getWorldMatrix()).invert().toArray())));
 // Imported reaction/death wrappers are real motion. Only remove the old mesh-specific floor correction.
 for(const a of root.listAnimations())for(const channel of a.listChannels())if(!jointSet.has(channel.getTargetNode())&&/ground|floor/i.test(channel.getTargetNode().getName()))channel.dispose();
 const bone=(name)=>{const n=skin.listJoints().find(n=>n.getName()===name||n.getName().endsWith('_'+name));if(!n)throw Error(`${config.id}: missing ${name}`);return n;};
 const pos=name=>V().setFromMatrixPosition(new T.Matrix4().fromArray(bone(name).getWorldMatrix()));
 const lava=config.base==='lava_golem';const B={chest:lava?'ribs':'spine_03',back:lava?'spine1':'spine_03',head:lava?'head':'Head',hips:lava?'hips':'pelvis',ua:s=>lava?`upper_arm_${s.toUpperCase()}`:`upperarm_${s}`,fa:s=>lava?`forearm_${s.toUpperCase()}`:`lowerarm_${s}`,hand:s=>lava?`hand_${s.toUpperCase()}`:`hand_${s}`,thigh:s=>lava?`thigh_${s.toUpperCase()}`:`thigh_${s}`,knee:s=>lava?`shin_${s.toUpperCase()}`:`calf_${s}`,foot:s=>lava?`foot_${s.toUpperCase()}`:`foot_${s}`};
 const mats=await materialSet(doc,config),parts=[];
 const add=(name,g,mat,joint)=>{parts.push(name);return addSkinGeometry(doc,skin,`${config.id}_${name}`,g,mat,[[bone(joint),1]]);};
 const addLimb=(name,a,b,r0,r1,mat,joint,flat=1)=>add(name,limb(a,b,r0,r1,flat),mat,joint);
 if(!config.hover)for(const s of ['l','r']){const sign=s==='l'?1:-1,a=pos(B.thigh(s)),b=pos(B.knee(s)),f=pos(B.foot(s));addLimb(`loadbearing_thigh_${s}`,a,b,lava?.25:.19,lava?.21:.16,mats.stone,B.thigh(s));addLimb(`fluted_shin_${s}`,b,f,lava?.19:.16,lava?.17:.13,mats.stone,B.knee(s));
  // Rounded dark inner matter bridges the articulated outer stone segments through the gait.
  const kneeRadius=lava?.225:.195;
  const innerKnee=ellipsoid(b.toArray(),[kneeRadius,kneeRadius*1.10,kneeRadius]);
  parts.push(`continuous_inner_knee_${s}`);
  addSkinGeometry(doc,skin,`${config.id}_continuous_inner_knee_${s}`,innerKnee,mats.dark,[[bone(B.thigh(s)),.45],[bone(B.knee(s)),.55]]);
  for(let j=0;j<3;j++){const zz=f.z+.11+j*.12;add(`interlocked_toe_${s}_${j}`,plate(.33,.16,.20,f.x+sign*(j-1)*.035,f.y-.035,zz),mats.ash,B.foot(s));}
  add(`shin_front_stratum_${s}`,tube([[b.x,b.y+.02,b.z+.16],[b.x,b.y-.2,b.z+.17],[f.x,f.y+.15,f.z+.16]],.053,12,6),mats.ash,B.knee(s));
 }
 for(const s of ['l','r']){const a=pos(B.ua(s)),b=pos(B.fa(s)),w=pos(B.hand(s));addLimb(`upper_arm_${s}`,a,b,config.hover?.085:.22,config.hover?.095:.19,mats.stone,B.ua(s));
  if(config.hover){
   // Two stone tendons leave real negative space through the forearm, joined at elbow and wrist.
   for(const side of [-1,1])add(`open_forearm_rail_${s}_${side}`,tube([b.toArray(),b.clone().lerp(w,.3).add(V(0,side*.072,side*.025)).toArray(),b.clone().lerp(w,.75).add(V(0,side*.080,side*.020)).toArray(),w.toArray()],.046,14,7),mats.stone,B.fa(s));
   add(`closing_palm_${s}`,ellipsoid(w.toArray(),[.11,.13,.115]),mats.iron,B.hand(s));
  }else{
   addLimb(`forearm_${s}`,b,w,.24,.29,mats.stone,B.fa(s));
   if(config.id!=='nightforge_marshal'||s==='l')add(`closing_palm_${s}`,ellipsoid(w.toArray(),[.27,.22,.27]),mats.iron,B.hand(s));
  }
  for(let j=0;j<3;j++){const side=s==='l'?1:-1,spread=config.hover?.075:.12,start=config.hover?.075:.13,end=config.hover?.045:.07;add(`fused_digit_${s}_${j}`,tube([[w.x+side*(config.hover?.08:.13),w.y-.09,w.z-start+j*spread],[w.x+side*(config.hover?.17:.23),w.y-.23,w.z-start+j*spread],[w.x+side*.1,w.y-.29,w.z-end+j*spread]],config.hover?.035:.055,9,6),mats.stone,B.hand(s));}
 }
 if(config.id==='ashseal_warden'){
  add('split_seal_breastplate',gate(0,1.56,.025,1.02,1.12,.42),mats.stone,B.chest);
  add('seal_inner_back',plate(.54,.68,.14,0,1.5,-.21),mats.dark,B.chest);
  add('molten_seal_core',loft([[1.12,.06,.035,0,-.10],[1.33,.115,.05,-.03,-.1],[1.6,.07,.045,.018,-.1],[1.88,.055,.025,0,-.1]],14),mats.core,B.chest);
  for(let i=0;i<4;i++)for(const sign of [-1,1])add(`seal_segment_${i}_${sign}`,plate(.16,.19,.16,sign*(.37-i*.035),1.18+i*.23,.265),mats.ash,B.chest);
  for(const sign of [-1,1]){const s=sign>0?'l':'r';add(`fused_shoulder_strata_${s}`,loft([[1.77,.37,.35,sign*.52,-.1],[1.99,.47,.39,sign*.52,-.14],[2.14,.36,.32,sign*.47,-.18],[2.22,.21,.20,sign*.43,-.2]],14),mats.stone,B.ua(s));}
  add('recessed_blind_crown',loft([[1.81,.16,.15,0,-.09],[2.02,.21,.17,0,-.11],[2.23,.16,.12,0,-.16],[2.32,.045,.05,0,-.19]],14),mats.iron,B.head);
  add('blind_vertical_crack',tube([[0,1.9,.065],[-.02,2.03,.06],[.006,2.13,.01]],.016,12,5),mats.core,B.head);
  const w=pos(B.hand('l'));const shield=gate(w.x,w.y,w.z,.92,1.27,.30);shield.rotateX(.1);add('fused_hollow_shield',shield,mats.stone,B.hand('l'));
  add('shield_recess',plate(.45,.73,.09,w.x,w.y,w.z-.08),mats.dark,B.hand('l'));
  for(let j=0;j<3;j++)add(`shield_cooling_split_${j}`,plate(.12,.45,.13,w.x-.21+j*.20,w.y+.05,w.z+.07),mats.ash,B.hand('l'));
  add('shield_recessed_heat',tube([[w.x-.11,w.y-.40,w.z],[w.x+.03,w.y-.13,w.z],[w.x-.03,w.y+.29,w.z]],.025,13,6),mats.core,B.hand('l'));
 }else if(config.id==='furnace_regent'){
  add('caldera_inner_back',loft([[1.02,.28,.14,0,-.24],[1.35,.48,.20,0,-.25],[1.79,.50,.20,0,-.26],[2.12,.43,.18,0,-.26]],16),mats.dark,B.chest);
  add('banked_molten_organ',loft([[1.10,.10,.09,0,-.03],[1.39,.22,.13,-.03,-.03],[1.72,.18,.14,.03,-.04],[2.09,.10,.085,0,-.035]],16),mats.core,B.chest);
  for(let j=0;j<5;j++)for(const sign of [-1,1]){const y=1.20+j*.185;add(`caldera_rib_${j}_${sign}`,tube([[sign*.16,y+.14,-.26],[sign*(.47+j*.01),y+.11,-.14],[sign*.43,y,.24],[sign*.11,y-.02,.33]],.075+j*.003,18,9),mats.stone,B.chest);}
  add('open_crater_rim',loft([[2.03,.37,.31,0,-.12],[2.23,.69,.52,0,-.17],[2.51,.60,.46,0,-.23],[2.57,.39,.32,0,-.23],[2.28,.30,.27,0,-.18]],24,false),mats.stone,B.back);
  for(let j=0;j<8;j++){const a=j/8*Math.PI*2;add(`crater_overhang_${j}`,ellipsoid([Math.cos(a)*.56,2.37,Math.sin(a)*.42-.18],[.24,.19,.23],1),j%3===0?mats.ash:mats.stone,B.back);}
  add('broken_vent_jaw',gate(0,2.16,.27,.40,.46,.24),mats.iron,B.head);
  for(const s of ['l','r']){const w=pos(B.hand(s));for(let j=0;j<3;j++)add(`plunger_ridge_${s}_${j}`,loft([[w.y-.29+j*.22,.34,.32,w.x,w.z],[w.y-.18+j*.22,.38,.35,w.x,w.z],[w.y-.11+j*.22,.32,.29,w.x,w.z]],12),mats.ash,B.hand(s));}
 }else if(config.id==='chainbound_archon'){
  // Two open rib frames form its torso; all ordinary robe and human body geometry was removed.
  // The side ribs bow behind the marrow, creating a true three-dimensional side window.
  const bowedRib=(g,cy,height,bow)=>{const p=g.attributes.position;for(let i=0;i<p.count;i++){const arch=Math.max(0,1-((p.getY(i)-cy)/height)**2);p.setZ(i,p.getZ(i)-bow*arch);}g.computeVertexNormals();return g;};
  add('left_open_thorax',bowedRib(sector(-.08,1.32,-.03,.56,.43,Math.PI*.48,Math.PI*1.52,.14,21),1.32,.56,.24),mats.stone,B.chest);
  add('right_open_thorax',bowedRib(sector(.08,1.39,-.08,.59,.46,-Math.PI*.52,Math.PI*.48,.14,21),1.39,.59,.34),mats.iron,B.chest);
  add('sealed_inner_marrow',loft([[.94,.035,.035,0,.005],[1.14,.105,.065,-.025,.005],[1.37,.105,.065,.020,.005],[1.57,.045,.045,0,.005]],14),mats.core,B.chest);
  add('faceless_crown',loft([[1.61,.10,.10,0,-.1],[1.83,.17,.14,0,-.11],[2.09,.12,.10,0,-.15],[2.19,.027,.035,0,-.20]],14),mats.stone,B.head);
  add('crown_split',tube([[-.005,1.75,.035],[.005,1.94,.012],[0,2.08,-.06]],.016,10,6),mats.core,B.head);
  for(let j=0;j<5;j++){const x=(j-2)*.13,y=.96-Math.abs(j-2)*.025;add(`hanging_vertebral_blade_${j}`,loft([[.18+Math.abs(j-2)*.07,.025,.025,x,-.18],[.43,.065,.055,x,-.12],[y,.092,.085,x,-.12]],10),mats.stone,B.hips);}
  for(const s of ['l','r']){const sign=s==='l'?1:-1,w=pos(B.hand(s));
   // An open U shackle hangs outside the wrist instead of two overlapping solid chest-sized loops.
   add(`open_arm_binding_yoke_${s}`,sector(w.x+sign*.015,w.y-.04,w.z-.015,.185,.132,Math.PI*.10,Math.PI*1.90,.055,15),mats.iron,B.hand(s));
   for(let j=0;j<4;j++){const x=sign*(.4+j*.11),y=1.14-j*.03,g=new T.TorusGeometry(.070,.020,6,10);if(j%2)g.rotateY(Math.PI/2);g.translate(x,y,-.04);add(`loadbearing_chain_${s}_${j}`,g,mats.iron,j<2?B.chest:B.fa(s));}
  }
 }else if(config.id==='nightforge_marshal'){
  add('pointed_gate_cuirass',gate(0,1.58,-.055,1.13,1.37,.38,true),mats.stone,B.chest);
  add('second_gate_recess',gate(0,1.58,-.23,.85,1.07,.13,true),mats.iron,B.chest);
  add('gate_dark_back',plate(.45,.75,.05,0,1.4,-.34),mats.dark,B.chest);
  add('nightforge_spine_seam',tube([[0,1.08,-.26],[-.025,1.32,-.24],[.015,1.62,-.24],[0,1.93,-.2]],.024,18,6),mats.core,B.chest);
  for(const sign of [-1,1]){const s=sign>0?'l':'r';for(let j=0;j<3;j++)add(`buttress_shoulder_${s}_${j}`,plate(.33,.37+j*.12,.50,sign*(.42+j*.16),1.94+j*.045,-.11-j*.05),j===1?mats.iron:mats.stone,B.ua(s));}
  add('hollow_belfry_head',gate(0,2.02,-.065,.43,.67,.29,true),mats.iron,B.head);
  const w=pos(B.hand('r'));add('integrated_hammer_neck',limb(w,V(w.x-.30,w.y,w.z),.25,.29),mats.iron,B.hand('r'));
  add('integrated_hammer_head',plate(.83,.71,.84,w.x-.33,w.y,w.z),mats.stone,B.hand('r'));
  for(const sign of [-1,1])add(`hammer_striking_end_${sign}`,plate(.17,.75,.91,w.x-.33+sign*.36,w.y,w.z),mats.iron,B.hand('r'));
  add('hammer_internal_fissure',tube([[w.x-.50,w.y-.28,w.z+.43],[w.x-.32,w.y-.05,w.z+.435],[w.x-.41,w.y+.29,w.z+.43]],.024,12,6),mats.core,B.hand('r'));
 }
 adaptMotion(doc,config,B);
 const scaled=doc.createNode(`${config.id}_anatomy_scale`).setScale([config.factor,config.factor,config.factor]);for(const n of [...scene.listChildren()]){scene.removeChild(n);scaled.addChild(n);}scene.addChild(scaled);
 await doc.transform(prune());const measure=await measureGround(doc,config);await doc.transform(prune());
 return finish(doc,config,parent,{removedTriangles,addedBodyParts:parts,sourceMeshesRetained:0,measurements:measure,rig:'Native weighted skeleton with all visible geometry rebuilt'});
}
function adaptMotion(doc,c,B){const root=doc.getRoot(),edits=[];
 if(c.hover){const idle=root.listAnimations().find(a=>a.getName()==='Idle');for(const name of ['Walk','Run']){root.listAnimations().find(a=>a.getName()===name)?.dispose();const a=doc.createAnimation(name);for(const ch of idle.listChannels()){const source=ch.getSampler(),s=doc.createAnimationSampler().setInput(source.getInput()).setOutput(source.getOutput()).setInterpolation(source.getInterpolation());a.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(ch.getTargetNode()).setTargetPath(ch.getTargetPath()).setSampler(s));}}}
 // Derive heavy Run from the planted walk on universal golems. No jogging flight phase.
 if(c.base==='iron_golem'){root.listAnimations().find(a=>a.getName()==='Run')?.dispose();const run=doc.createAnimation('Run'),walk=root.listAnimations().find(a=>a.getName()==='Walk');for(const ch of walk.listChannels()){const source=ch.getSampler(),s=doc.createAnimationSampler().setInput(source.getInput().clone().setArray(Float32Array.from(source.getInput().getArray(),v=>v*.68))).setOutput(source.getOutput()).setInterpolation(source.getInterpolation());run.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(ch.getTargetNode()).setTargetPath(ch.getTargetPath()).setSampler(s));}}
 for(const a of root.listAnimations()){const name=a.getName(),attack=name==='Attack',duration=Math.max(...a.listSamplers().flatMap(s=>[...s.getInput().getArray()])),sourceContact=c.base==='lava_golem'?.4:c.base==='banshee'?.42:.38;
  for(const ch of a.listChannels()){if(ch.getTargetPath()!=='rotation')continue;const n=ch.getTargetNode().getName(),sam=ch.getSampler(),ts=sam.getInput().getArray(),out=sam.getOutput(),arr=Float32Array.from(out.getArray());let edited=false;for(let i=0;i<ts.length;i++){const p=ts[i]/duration,axis=V(0,0,0);if(n===B.chest||n.endsWith('_'+B.chest)){axis.x=attack?-.11*Math.sin(p*Math.PI):.026*Math.sin(p*Math.PI*2);axis.y=c.hover?.07*Math.sin(p*Math.PI*2):0;edited=true;}if(attack&&(n===B.ua('l')||n.endsWith('_'+B.ua('l')))){axis.z=c.id==='ashseal_warden'?.18*Math.sin(p*Math.PI):c.hover?.22*Math.sin(p*Math.PI):.065*Math.sin(p*Math.PI);edited=true;}if(edited){const q=new T.Quaternion().fromArray(arr,i*4);q.multiply(new T.Quaternion().setFromEuler(new T.Euler(axis.x,axis.y,axis.z))).normalize().toArray(arr,i*4);}}if(edited)sam.setOutput(out.clone().setArray(arr));}
  const retimed=new Map();for(const s of a.listSamplers()){const input=s.getInput();if(!retimed.has(input)){const times=Float32Array.from(input.getArray(),t=>{const p=t/duration;if(!attack)return t*c.tempo;const remap=p<sourceContact?p/sourceContact*c.contact:c.contact+(p-sourceContact)/(1-sourceContact)*(1-c.contact);return remap*c.attackDuration;});retimed.set(input,input.clone().setArray(times));}s.setInput(retimed.get(input));}
 }
}
export async function measureGround(doc,c){const stripped=await io.readBinary(await io.writeBinary(doc));for(const m of stripped.getRoot().listMaterials())m.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null).setOcclusionTexture(null);await stripped.transform(prune());const bytes=await io.writeBinary(stripped),gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),''),scene=gltf.scene,mixer=new T.AnimationMixer(scene),root=doc.getRoot(),ground=doc.createNode(`${c.id}_floor`),gscene=root.listScenes()[0],buffer=root.listBuffers()[0];for(const n of [...gscene.listChildren()]){gscene.removeChild(n);ground.addChild(n);}gscene.addChild(ground);
 const clips={},union=new T.Box3();let idleBounds;for(const clip of gltf.animations){mixer.stopAllAction();const action=mixer.clipAction(clip).setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();const ts=[],values=[],bounds=new T.Box3();let minCorrection=Infinity,maxCorrection=-Infinity,maxDeathRecentering=0;const steps=Math.ceil(clip.duration*60);for(let i=0;i<=steps;i++){const t=Math.min(clip.duration,i/60);mixer.setTime(t);scene.updateMatrixWorld(true);scene.traverse(n=>{if(n.isSkinnedMesh)n.computeBoundingBox();});const b=new T.Box3().setFromObject(scene,true);let correction=(c.hover&&clip.name!=='Death'?.23:.004)-b.min.y;if(c.hover&&clip.name!=='Death')correction+=.025*Math.sin(t/clip.duration*Math.PI*2);
  // Rebuilt hammer/shield mass changes a rear fall. Keep its progressively collapsing body over the combat pad.
  const centredFall=clip.name==='Death'&&!c.hover,fallWeight=centredFall?T.MathUtils.smoothstep(t/clip.duration,.10,.58):0,dx=-(b.min.x+b.max.x)*.5*fallWeight,dz=-(b.min.z+b.max.z)*.5*fallWeight;maxDeathRecentering=Math.max(maxDeathRecentering,Math.hypot(dx,dz));minCorrection=Math.min(minCorrection,correction);maxCorrection=Math.max(maxCorrection,correction);ts.push(t);values.push(dx,correction,dz);b.translate(V(dx,correction,dz));bounds.union(b);if(clip.name==='Idle'&&i===0)idleBounds={min:b.min.toArray(),max:b.max.toArray()};}union.union(bounds);clips[clip.name]={duration:clip.duration,min:bounds.min.toArray(),max:bounds.max.toArray(),samples:ts.length,floorCorrection:[minCorrection,maxCorrection],deathRecentering:maxDeathRecentering};const anim=root.listAnimations().find(a=>a.getName()===clip.name),s=doc.createAnimationSampler().setInput(doc.createAccessor().setType('SCALAR').setArray(Float32Array.from(ts)).setBuffer(buffer)).setOutput(doc.createAccessor().setType('VEC3').setArray(Float32Array.from(values)).setBuffer(buffer));anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(ground).setTargetPath('translation').setSampler(s));}
 return {idleBounds,animatedMin:union.min.toArray(),animatedMax:union.max.toArray(),clips,grounding:c.hover?'Suspended body at 23 cm with a subtle independent hover wave; death contacts the floor':'Actual skinned vertex floor contact sampled at 60 Hz for all eight clips'};
}
export async function finish(doc,c,parent,detail){batchBody(doc,c.id);await doc.transform(prune());const id=`creature_${c.id}`,file=`${id}.glb`;await io.write(`${OUT}/${file}`,doc);const bytes=await readFile(`${OUT}/${file}`),root=doc.getRoot(),b=detail.measurements.idleBounds,sz=b.max.map((v,i)=>v-b.min[i]),durations=Object.fromEntries(root.listAnimations().map(a=>[a.getName(),Math.max(...a.listSamplers().flatMap(s=>[...s.getInput().getArray()]))]));const asset={...structuredClone(parent),id,file:`models/creature/${file}`,is:c.id.replaceAll('_',' '),tags:['creature','rpg','boss','wilderness',c.deep?'deep':'shallow',c.id],bytes:bytes.length,sha256:sha(bytes),size:{x:sz[0],y:sz[1],z:sz[2]},base:{x:b.min[0],y:b.min[1],z:b.min[2]},groundY:c.hover?0:b.min[1],triangles:root.listMeshes().reduce((n,m)=>n+m.listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0),materials:root.listMaterials().map(m=>m.getName()),animations:Object.keys(durations),walkClipSeconds:durations.Walk,runClipSeconds:durations.Run,attackSeconds:durations.Attack,contactNormalized:c.contact,impliedWalkMps:c.hover?2.1:(parent.impliedWalkMps??1.15)*(c.factor??1)/(c.tempo??1),impliedRunMps:c.hover?3.0:(parent.impliedRunMps??2.9)*(c.factor??1)/(c.tempo??1),metadata:{family:'wilderness_keeper',height:sz[1],dimensions:sz,rig:detail.rig,source:parent.id,license:parent.sourceProvenance?.license??'LicenseRef-Corealm-Original',redesign:{generator:'tools/wilderness-creatures/keepers/build.mjs',generatorSha256:sha(await readFile('tools/wilderness-creatures/keepers/build.mjs')),sourceAssetId:parent.id,sourceSha256:parent.sha256,sourceProvenance:parent.sourceProvenance,artDirection:c.design,motionDirection:c.motion,anatomyAtlas:{path:`${ART}/material-atlas-v3.png`,sha256:textureInputs.sourceSha,embeddedJpegSha256:sha(atlas),uvLayout:'2x2 basalt / iron / obsidian / cooled ash; physical face projection with cell gutters',heatAtlas:{path:ART+'/heat-atlas-v2.png',sha256:textureInputs.heatSourceSha,embeddedJpegSha256:sha(heat),uvLayout:'Top row crusted orange-red molten marrow, bottom row crusted blue-violet marrow'}},...detail},attackContact:c.contact,animationAcceptance:'candidate-needs-production-lab-review'},acceptance:{exported:true,labAccepted:false,worldIntegrated:false}};console.log(JSON.stringify({id,triangles:asset.triangles,bytes:asset.bytes,size:asset.size}));return {asset,file};}

function batchBody(doc,id){
 const nodes=doc.getRoot().listNodes().filter(n=>n.getSkin()&&n.getMesh());if(!nodes.length)return;
 const skin=nodes[0].getSkin(),parent=nodes[0].getParentNode(),groups=new Map();
 for(const n of nodes){if(n.getSkin()!==skin||n.getParentNode()!==parent)throw Error(`${id}: incompatible batch skin or parent`);for(const p of n.getMesh().listPrimitives()){const key=p.getMaterial();if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}n.setMesh(null).setSkin(null);}
 const mesh=doc.createMesh(`${id}_weighted_anatomy`);for(const prims of groups.values())mesh.addPrimitive(prims.length===1?prims[0]:joinPrimitives(prims));const node=doc.createNode(`${id}_weighted_anatomy`).setMesh(mesh).setSkin(skin);if(parent)parent.addChild(node);else doc.getRoot().listScenes()[0].addChild(node);
}

const catalog={assets:[],files:{}};
const only=process.argv.includes('--only')?process.argv[process.argv.indexOf('--only')+1]:null;
if(only){try{Object.assign(catalog,JSON.parse(await readFile(`${OUT}/catalog.json`,'utf8')));}catch{}}
for(const c of configs.filter(c=>!only||c.id===only)){const result=await native(c),i=catalog.assets.findIndex(a=>a.id===result.asset.id);if(i<0)catalog.assets.push(result.asset);else catalog.assets[i]=result.asset;catalog.files[result.asset.id]=result.file;}
if(!only||only==='hollow_star'){const result=await buildHollowStar({Document,T,V,io,loft,tube,plate,roughen,materialSet,addSkinGeometry,measureGround,finish});const i=catalog.assets.findIndex(a=>a.id===result.asset.id);if(i<0)catalog.assets.push(result.asset);else catalog.assets[i]=result.asset;catalog.files[result.asset.id]=result.file;catalog.packs=[result.pack];}
await writeFile(`${OUT}/catalog.json`,JSON.stringify(catalog,null,2)+'\n');
await writeFile(`${ART}/designs.json`,JSON.stringify(configs,null,2)+'\n');
