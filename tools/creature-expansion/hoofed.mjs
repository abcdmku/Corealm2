import { BIGHORN_REFINEMENT, bighornRefinedCoat, bighornRecessedEye, bighornRefinedHooves, bighornHornDetail, bighornHornColor } from './hoofed/bighorn-refinement.mjs';
import { tapirRefinedCoat, tapirRefinedEar, tapirRefinedEye, applyTapirRefinedMaterials } from './hoofed/tapir-refinement.mjs';
import * as THREE from 'three';
import { implicitAnatomy } from './hoofed/implicit-anatomy.mjs';
import { mooseAntlers } from './hoofed/organic-appendages.mjs';
import { coatTextures } from './hoofed/coat-textures.mjs';
import { ramHorns } from './hoofed/ram-horns.mjs';
import { tapirEar } from './hoofed/tapir-ears.mjs';
import { HORSE_LANDMARKS, HORSE_PROFILE_PATCH, horseHoof, horseHair } from './hoofed/horse-anatomy.mjs';
import { MOOSE_CONFIG, mooseBell, mooseHooves } from './hoofed/moose-anatomy.mjs';
import { BIGHORN_LANDMARKS } from './hoofed/bighorn-anatomy.mjs';

// Original Corealm anatomy. Every surface is a shaped loft or sculpted closed
// surface; there are no source meshes, texture dependencies, or distance swaps.
export const SPECIES = ['marchwild_horse', 'cairn_bighorn', 'marsh_moose', 'bracken_tapir'];
const V = (a) => new THREE.Vector3(...a);
const mix = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => { const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
const pulse = (a,b,c,t) => t<a||t>c ? 0 : t<b ? smooth(a,b,t) : 1-smooth(b,c,t);
const C = (hex) => new THREE.Color(hex);
const PROFILES = {
  marchwild_horse: { is:'wild horse', height:1.39, width:.40, front:.68, rear:-.77, hipY:1.43, ankle:.16, foot:.12, neck:[0,1.54,.67], head:[0,2.04,1.16], tail:[0,1.49,-1.01], legX:.28, kneeY:.77, kneeFront:.55, kneeRear:-.57, ankleFront:.76, ankleRear:-.87, legR:.12, coat:0x80523b, dark:0x261d1b, pale:0xc8b38d, walk:1.10, run:.70, stride:.78, runStride:1.10, attack:1.18, contact:.46, ...HORSE_PROFILE_PATCH },
  cairn_bighorn: { is:'bighorn sheep', height:.98, width:.29, front:.405, rear:-.545, hipY:1.025, ankle:.12, foot:.115, neck:BIGHORN_LANDMARKS.neck, head:BIGHORN_LANDMARKS.head, tail:[0,1.10,-.79], legX:.22, kneeY:.535, kneeFront:.435, kneeRear:-.400, ankleFront:.450, ankleRear:-.595, legR:.090, coat:0x82715a, dark:0x392f29, pale:0xc3b698, walk:.95, run:.64, stride:.48, runStride:.70, attack:1.05, contact:.46 },
  marsh_moose: { is:'moose', height:1.66, width:.47, front:.66, rear:-.76, hipY:1.70, ankle:.17, foot:.15, neck:[0,1.88,.67], head:[0,2.01,1.18], tail:[0,1.72,-1.01], legX:.32, kneeY:.91, kneeFront:.45, kneeRear:-.52, ankleFront:.77, ankleRear:-.88, legR:.13, coat:0x514337, dark:0x27241e, pale:0xa69372, walk:1.22, run:.78, stride:.96, runStride:1.25, attack:1.23, contact:.47, ...MOOSE_CONFIG.profile },
  bracken_tapir: { is:'tapir', height:.76, width:.37, front:.50, rear:-.58, hipY:.70, ankle:.12, foot:.115, neck:[0,.90,.63], head:[0,.94,.98], tail:[0,.83,-.94], legX:.265, kneeY:.37, kneeFront:.50, kneeRear:-.48, ankleFront:.56, ankleRear:-.61, legR:.13, coat:0x45413b, dark:0x262823, pale:0xd1c5a6, walk:.93, run:.64, stride:.30, runStride:.50, attack:.90, contact:.48 },
};

class Sculpt {
  constructor(rig, profile, id) { this.rig=rig; this.profile=profile; this.id=id; this.parts=[]; }
  weight(bone) { return [[typeof bone==='number'?bone:this.rig.index[bone],1]]; }
  add(pos,idx,bone,color,material=0,weightFn,uv) {
    const skin=[], weights=[], colors=[];
    pos.forEach((p,i)=>{const w=weightFn?weightFn(p,i):this.weight(bone); for(let j=0;j<4;j++){skin.push(w[j]?.[0]??0);weights.push(w[j]?.[1]??0);} const c=typeof color==='function'?color(p,i):C(color); colors.push(c.r,c.g,c.b);});
    this.parts.push({pos:pos.flat(),idx,skin,weights,colors,material,uv});
  }
  loft(points,bone,color,opts={}) {
    const rings=opts.rings??32, sides=opts.sides??32;
    const curve=new THREE.CatmullRomCurve3(points.map(p=>V(p)),false,'catmullrom',.35);
    const radii=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(p[3],p[4],0)),false,'catmullrom',.3);
    const pos=[],idx=[],uv=[];
    for(let j=0;j<=rings;j++){
      const t=j/rings,center=curve.getPoint(t), tangent=curve.getTangent(t).normalize();
      let u=V(opts.axis??[1,0,0]); u.addScaledVector(tangent,-u.dot(tangent)).normalize();
      if(u.lengthSq()<.01)u=V([0,0,1]);
      const v=new THREE.Vector3().crossVectors(tangent,u).normalize(),r=radii.getPoint(t);
      for(let k=0;k<sides;k++){
        const a=2*Math.PI*k/sides;
        const detail=opts.detail?opts.detail(t,a):1;
        const p=center.clone().addScaledVector(u,Math.cos(a)*Math.max(.001,r.x)*detail).addScaledVector(v,Math.sin(a)*Math.max(.001,r.y)*detail);
        if(opts.deform)opts.deform(p,t,a);
        pos.push(p.toArray());uv.push(k/sides,t);
      }
    }
    for(let j=0;j<rings;j++)for(let k=0;k<sides;k++){const a=j*sides+k,b=j*sides+(k+1)%sides,c=(j+1)*sides+k,d=(j+1)*sides+(k+1)%sides;idx.push(a,b,c,b,d,c);}
    for(let k=1;k<sides-1;k++){idx.push(0,k+1,k);const e=rings*sides;idx.push(e,e+k,e+k+1);}
    this.add(pos,idx,bone,color,opts.material??0,opts.weights,uv);
  }
  oval(center,scale,bone,color,opts={}) {
    const rings=opts.rings??16,sides=opts.sides??24,pos=[],idx=[],uv=[];
    const rotation=new THREE.Euler(...(opts.rotation??[0,0,0]));
    for(let j=0;j<=rings;j++)for(let k=0;k<sides;k++){
      const p=j/rings*Math.PI,a=k/sides*Math.PI*2;
      const d=opts.detail?opts.detail(p,a):1;
      const point=new THREE.Vector3(Math.sin(p)*Math.cos(a)*scale[0]*d,Math.cos(p)*scale[1],Math.sin(p)*Math.sin(a)*scale[2]*d).applyEuler(rotation).add(V(center));
      if(opts.deform)opts.deform(point,p,a);
      pos.push(point.toArray());uv.push(k/sides,j/rings);
    }
    for(let j=0;j<rings;j++)for(let k=0;k<sides;k++){let a=j*sides+k,b=j*sides+(k+1)%sides,c=(j+1)*sides+k,d=(j+1)*sides+(k+1)%sides;if(j>0)idx.push(a,b,c);if(j<rings-1)idx.push(b,d,c);}
    this.add(pos,idx,bone,color,opts.material??0,opts.weights,uv);
  }
  mesh() {
    const p=[],c=[],si=[],sw=[],uv=[],index=[],groups=[];
    for(let m=0;m<6;m++){
      const first=index.length;
      for(const part of this.parts.filter(x=>x.material===m)){
        const offset=p.length/3;
        for(const value of part.pos)p.push(value);for(const value of part.colors)c.push(value);for(const value of part.skin)si.push(value);for(const value of part.weights)sw.push(value);for(const value of part.uv)uv.push(value);for(const value of part.idx)index.push(value+offset);
      }
      if(index.length>first)groups.push([first,index.length-first,m]);
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(c,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(si,4));
    geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(sw,4));
    geometry.setIndex(index);geometry.computeVertexNormals();
    const normals=geometry.getAttribute('normal'),normalGroups=new Map();
    for(let i=0;i<p.length/3;i++){const key=`${Math.round(p[i*3]*100000)},${Math.round(p[i*3+1]*100000)},${Math.round(p[i*3+2]*100000)}`;let group=normalGroups.get(key);if(!group){group=[];normalGroups.set(key,group);}group.push(i);}
    for(const group of normalGroups.values())if(group.length>1){const normal=new THREE.Vector3();for(const i of group)normal.add(new THREE.Vector3().fromBufferAttribute(normals,i));normal.normalize();for(const i of group)normals.setXYZ(i,normal.x,normal.y,normal.z);}
    if(this.id==='bracken_tapir'){
      const raw=new Map(),key=i=>`${Math.round(p[i*3]*100000)},${Math.round(p[i*3+1]*100000)},${Math.round(p[i*3+2]*100000)}`;
      for(let i=0;i<index.length;i+=3){
        const ids=[index[i],index[i+1],index[i+2]];if(ids.every(vertex=>p[vertex*3+1]>=.16))continue;
        const a=V(p.slice(ids[0]*3,ids[0]*3+3)),b=V(p.slice(ids[1]*3,ids[1]*3+3)),c=V(p.slice(ids[2]*3,ids[2]*3+3)),normal=b.sub(a).cross(c.sub(a));
        for(const vertex of ids)if(p[vertex*3+1]<.16){const k=key(vertex);if(!raw.has(k))raw.set(k,new THREE.Vector3());raw.get(k).add(normal);}
      }
      for(const [key,normal]of raw){normal.normalize();for(const i of normalGroups.get(key)??[])normals.setXYZ(i,normal.x,normal.y,normal.z);}
    }
    for(const group of groups)geometry.addGroup(...group);
    const mats=[.91,.65,.80,.20,.92,.61].map((roughness,i)=>new THREE.MeshStandardMaterial({name:['Sculpted_coat','Hoof_keratin','Horn_ivory','Wet_eye','Inner_ear','Muzzle_skin'][i],color:0xffffff,vertexColors:true,roughness,metalness:0}));
    const textures=coatTextures(this.id);if(this.id==='cairn_bighorn'||this.id==='bracken_tapir')mats[0].map=textures.color;mats[0].normalMap=textures.normal;mats[0].normalScale.set(this.id==='bracken_tapir'?.18:.32,this.id==='bracken_tapir'?.18:.32);mats[0].roughnessMap=textures.roughness;
    mats[5].roughness=.91;mats[5].normalMap=textures.normal;mats[5].normalScale.set(.32,.32);mats[5].roughnessMap=textures.roughness;
    if(this.id==='cairn_bighorn'){mats[0].map=null;mats[0].normalScale.set(BIGHORN_REFINEMENT.coatNormalScale,BIGHORN_REFINEMENT.coatNormalScale);mats[0].roughness=BIGHORN_REFINEMENT.coatRoughness;mats[1].roughness=BIGHORN_REFINEMENT.hoofRoughness;mats[2].roughness=BIGHORN_REFINEMENT.hornRoughness;mats[3].roughness=BIGHORN_REFINEMENT.eyeRoughness;}
    if(this.id==='bracken_tapir')applyTapirRefinedMaterials(mats);
    const mesh=new THREE.SkinnedMesh(geometry,mats);mesh.name=`${this.id}_anatomy`;mesh.castShadow=true;mesh.receiveShadow=true;
    this.rig.root.add(mesh);this.rig.root.updateMatrixWorld(true);mesh.bind(new THREE.Skeleton(this.rig.bones));
    mesh.normalizeSkinWeights();geometry.computeBoundingBox();geometry.computeBoundingSphere();return mesh;
  }
}

function skeleton(p,id) {
  const root=new THREE.Group();root.name=id;
  const bones=[],index={},named={};
  const add=(name,parent,point)=>{
    const b=new THREE.Bone();b.name=`${id}_${name}`;b.position.copy(V(point));
    (parent?named[parent]:root).add(b);index[name]=bones.length;named[name]=b;bones.push(b);return b;
  };
  add('Root',null,[0,0,0]);add('Body','Root',[0,p.height,0]);
  add('Neck','Body',[0,p.neck[1]-p.height,p.neck[2]]);
  add('Head','Neck',[0,p.head[1]-p.neck[1],p.head[2]-p.neck[2]]);
  add('Jaw','Head',id==='cairn_bighorn'?BIGHORN_LANDMARKS.jaw.map((v,i)=>v-p.head[i]):id==='marsh_moose'?MOOSE_CONFIG.jaw.map((v,i)=>v-p.head[i]):[0,-.08,.12]);add('Nose','Head',[0,-.08,.30]);
  add('Tail','Body',[0,p.tail[1]-p.height,p.tail[2]]);add('TailTip','Tail',[0,-.35,-.20]);
  for(const side of [-1,1])add(side<0?'EarL':'EarR','Head',id==='cairn_bighorn'?BIGHORN_LANDMARKS.earBase.map((v,i)=>(i===0?v*side:v)-p.head[i]):id==='marsh_moose'?MOOSE_CONFIG.earBase.map((v,i)=>(i===0?v*side:v)-p.head[i]):[side*.14,.13,-.04]);
  const legs=[];
  for(const front of [true,false])for(const side of [-1,1]){
    const tag=(front?'Fore':'Hind')+(side<0?'L':'R'),x=(id==='cairn_bighorn'&&!front?.225:p.legX)*side;
    const hip=V([x,p.hipY,front?p.front:p.rear]);
    const knee=V([x,id==='cairn_bighorn'&&!front?.565:p.kneeY,front?p.kneeFront:p.kneeRear]);
    const ankle=V([x,p.ankle,front?p.ankleFront:p.ankleRear]);
    add(tag+'Hip','Body',hip.clone().sub(V([0,p.height,0])).toArray());
    add(tag+'Knee',tag+'Hip',knee.clone().sub(hip).toArray());
    add(tag+'Ankle',tag+'Knee',ankle.clone().sub(knee).toArray());
    add(tag+'Foot',tag+'Ankle',[0,-p.ankle+.065,.025]);
    legs.push({tag,front,side,hip,knee,ankle,upper:knee.distanceTo(hip),lower:ankle.distanceTo(knee),bindUpper:knee.clone().sub(hip).normalize(),bindLower:ankle.clone().sub(knee).normalize(),pole:V([0,0,id==='marchwild_horse'||front?-1:1])});
  }
  root.updateMatrixWorld(true);
  return {root,bones,index,named,legs,rest:bones.map(b=>({position:b.position.clone(),quaternion:b.quaternion.clone()}))};
}

function coatColor(p,id) {
  if(id==='cairn_bighorn')return bighornRefinedCoat;
  if(id==='bracken_tapir')return tapirRefinedCoat(p);
  const base=C(p.coat), pale=C(p.pale),dark=C(p.dark);
  return point=>{
    const [x,y,z]=point;
    const ripple=.025*Math.sin(z*36+y*19)+.020*Math.sin(x*48+z*24);
    let c=base.clone();
    if(id==='bracken_tapir'){
      const saddle=smooth(-.73,-.55,z)*(1-smooth(.25,.45,z))*smooth(.55,.79,y);
      c.lerp(pale,saddle*.97);
    } else if(id==='marchwild_horse') {
      c.lerp(dark,smooth(1.61,1.77,y)*.28);c.lerp(pale,(1-smooth(.77,1.06,y))*.12);
    } else if(id==='cairn_bighorn') {
      c.lerp(pale,clamp((y-.88)*.35,0,.25));c.lerp(dark,(1-smooth(.35,.65,y))*.35);
      const rump=(1-smooth(-.77,-.62,z))*smooth(.72,.87,y)*(1-smooth(1.17,1.31,y));
      c.lerp(pale,rump*.91);
    } else { c.lerp(dark,smooth(1.80,2.16,y)*.35);c.lerp(pale,(1-smooth(.60,.95,y))*.32); }
    c.multiplyScalar(1+ripple);return c;
  };
}

function anatomy(s,p,id) {
  const color=coatColor(p,id),r=s.rig,horse=id==='marchwild_horse',ram=id==='cairn_bighorn',moose=id==='marsh_moose',tapir=id==='bracken_tapir';
  const core=implicitAnatomy(s,p,id,color);
  for(const leg of r.legs){
    const ankle=leg.ankle;
    if(tapir)continue;
    if(horse){horseHoof(s,leg,p);continue;}
    if(moose){mooseHooves(s,leg,p);continue;}
    if(ram){
      bighornRefinedHooves(s,leg);
      continue;
    }
    const toeCount=tapir?(leg.front?4:3):horse?1:2;
    for(let toe=0;toe<toeCount;toe++){
      const spread=horse?0:(toe-(toeCount-1)/2)*(tapir?.062:.069);
      const radius=horse?.093:tapir?.044:.055;
      const z=ankle.z+.025+(tapir?(.024-.012*Math.abs(toe-(toeCount-1)/2)):0);
      s.loft([[ankle.x+spread,.17,z-.017,radius*.67,.07],[ankle.x+spread,.12,z+.006,radius*.90,.087],[ankle.x+spread,.052,z+.025,radius,.099],[ankle.x+spread,.002,z+.025,radius*.95,.09]],leg.tag+'Foot',point=>C(p.dark).multiplyScalar(1+.12*Math.sin(point[1]*90)),{rings:10,sides:20,material:1});
    }
    if(!horse&&!tapir)for(const side of [-1,1]){
      const y=ankle.y+.055,z=mix(ankle.z,leg.knee.z,.055/(leg.knee.y-ankle.y));
      s.loft([[ankle.x+side*.023,y+.023,z-.021,.013,.015],[ankle.x+side*.023,y,z-.035,.016,.022],[ankle.x+side*.021,y-.028,z-.042,.004,.006]],leg.tag+'Knee',p.dark,{rings:10,sides:12,material:1});
    }
  }

  for(const side of [-1,1]){
    if(tapir){tapirRefinedEye(s,side,color);tapirRefinedEar(s,side,p);continue;}
    const eye=[core.eyes[0]*side,core.eyes[1],core.eyes[2]];
    if(ram)bighornRecessedEye(s,side);
    else {
    s.oval([eye[0]-side*.031,eye[1],eye[2]],[.026,.026,.030],'Head',0x1b1915,{rings:12,sides:20,material:3});
    s.oval([eye[0]-side*.010,eye[1]-.001,eye[2]+.002],[.004,.011,.013],'Head',0x362b1e,{rings:10,sides:16,material:3});
    s.oval([eye[0]-side*.007,eye[1]-.001,eye[2]+.004],[.003,.008,.010],'Head',0x080c0b,{rings:10,sides:16,material:3});
    const eyelid=[];for(let i=0;i<=10;i++){const a=i/10*Math.PI;eyelid.push([eye[0]+side*(-.009+.005*Math.sin(a)),eye[1]+Math.sin(a)*.031,eye[2]+Math.cos(a)*.035,.004,.005]);}
    s.loft(eyelid,'Head',color,{rings:16,sides:8,axis:[1,0,0],material:5});
    }
    if(tapir){
      tapirEar(s,side,p);
      continue;
    }
    if(moose){
      const mirrored=point=>point.map((v,i)=>i===0?v*side:v),base=mirrored(MOOSE_CONFIG.earBase),center=mirrored(MOOSE_CONFIG.earCenter),tip=mirrored(MOOSE_CONFIG.earTip),ear=side<0?'EarL':'EarR';
      s.loft([base,center,tip].map((point,i)=>[...point,...MOOSE_CONFIG.earRadii[i]]),ear,color,{rings:16,sides:20});
      s.loft([[base[0],base[1]+.008,base[2]+.017,.012,.004],[center[0],center[1],center[2]+.016,.044,.004],[tip[0],tip[1]-.009,tip[2]+.006,.002,.002]],ear,0x756150,{rings:12,sides:16,material:4});
      continue;
    }
    const base=horse?HORSE_LANDMARKS.earBase.map((v,i)=>i===0?v*side:v):ram?BIGHORN_LANDMARKS.earBase.map((v,i)=>i===0?v*side:v):[side*.205,2.19,1.12];
    const tip=horse?HORSE_LANDMARKS.earTip.map((v,i)=>i===0?v*side:v):ram?BIGHORN_LANDMARKS.earTip.map((v,i)=>i===0?v*side:v):moose?[side*.47,2.46,1.03]:[side*.239,1.47,.95];
    const center=horse?HORSE_LANDMARKS.earCenter.map((v,i)=>i===0?v*side:v):ram?BIGHORN_LANDMARKS.earCenter.map((v,i)=>i===0?v*side:v):V(base).lerp(V(tip),.53).toArray(),ear=side<0?'EarL':'EarR';
    s.loft([[...base,.054,.044],[...center,horse?.068:moose?.099:.042,.040],[...tip,tapir?.043:.008,.017]],ear,tapir?p.pale:color,{rings:16,sides:20});
    s.loft([[base[0],base[1]+.025,base[2]+.034,.020,.009],[center[0],center[1],center[2]+.039,horse?.040:moose?.064:.025,.009],[tip[0],tip[1]-.022,tip[2]+.022,.005,.006]],ear,tapir?p.dark:0x756150,{rings:12,sides:16,material:4});
  }
  if(horse)horseDetail(s,p);
  if(ram)ramDetail(s,p);
  if(moose)mooseDetail(s,p);
  if(tapir){
    s.loft([[0,.84,-.91,.042,.041],[0,.81,-.995,.028,.027],[0,.765,-1.023,.008,.008]],'Tail',color,{rings:14,sides:16});
  }
}

function horseDetail(s,p){
  horseHair(s,p);
}

function ramDetail(s,p){
  ramHorns(s,p,{detail:bighornHornDetail,color:bighornHornColor});
  s.loft([[0,1.11,-.78,.075,.070],[0,1.01,-.95,.072,.06],[0,.91,-.96,.016,.02]],'Tail',p.coat,{rings:14,sides:16});
}

function bighornHooves(s,leg,p){
  // Separate toe wedges with flat soles leave a 12 mm cleft at their widest
  // point. Their upper walls narrow into the pastern without a raised cuff.
  const outline=[[-.022,-.026],[-.026,.016],[-.022,.083],[-.009,.104],[.009,.104],[.022,.083],[.026,.016],[.022,-.026]];
  for(const side of [-1,1]){
    const points=[],faces=[];
    const sections=[{y:.124,w:.66,l:.53,z:-.003},{y:.095,w:.90,l:.75,z:0},{y:.039,w:1,l:1,z:.003},{y:.002,w:.96,l:.98,z:.003}];
    for(const section of sections)for(const [x,z]of outline)points.push([leg.ankle.x+side*.032+x*section.w,section.y,leg.ankle.z+z*section.l+section.z]);
    for(let row=0;row<sections.length-1;row++)for(let k=0;k<8;k++){
      const a=row*8+k,b=row*8+(k+1)%8,c=a+8,d=b+8;
      faces.push(a,c,b,b,c,d);
    }
    for(let k=1;k<7;k++){faces.push(0,k,k+1);faces.push(24,24+k+1,24+k);}
    const uv=points.flatMap(point=>[(point[0]-leg.ankle.x+.060)/.120,(point[2]-leg.ankle.z+.03)/.14]);
    s.add(points,faces,leg.tag+'Foot',point=>C(p.dark).multiplyScalar(.91+.12*smooth(.002,.12,point[1])),1,null,uv);
  }
  for(const side of [-1,1])s.loft([[leg.ankle.x+side*.022,.164,leg.ankle.z-.021,.009,.012],[leg.ankle.x+side*.023,.145,leg.ankle.z-.032,.010,.014],[leg.ankle.x+side*.022,.131,leg.ankle.z-.036,.003,.005]],leg.tag+'Knee',p.dark,{rings:8,sides:10,material:1});
}

function mooseDetail(s,p){
  mooseAntlers(s,p);
  mooseBell(s,p);
  s.loft([[0,1.73,-1.01,.064,.061],[0,1.59,-1.14,.063,.071],[0,1.42,-1.16,.015,.022]],'Tail',p.dark,{rings:16,sides:16});
}

function plant(r,leg,target) {
  const hipBone=r.named[leg.tag+'Hip'],kneeBone=r.named[leg.tag+'Knee'],ankleBone=r.named[leg.tag+'Ankle'];
  r.root.updateMatrixWorld(true);
  const hip=hipBone.getWorldPosition(new THREE.Vector3()),dir=target.clone().sub(hip);
  const d=clamp(dir.length(),Math.abs(leg.upper-leg.lower)+.0001,leg.upper+leg.lower-.0001);dir.normalize();
  const pole=leg.pole.clone().addScaledVector(dir,-leg.pole.dot(dir)).normalize();
  const along=(leg.upper**2-leg.lower**2+d*d)/(2*d),height=Math.sqrt(Math.max(0,leg.upper**2-along**2));
  const knee=hip.clone().addScaledVector(dir,along).addScaledVector(pole,height);
  const parentQ=hipBone.parent.getWorldQuaternion(new THREE.Quaternion());
  const upperQ=new THREE.Quaternion().setFromUnitVectors(leg.bindUpper,knee.clone().sub(hip).normalize());
  hipBone.quaternion.copy(parentQ.clone().invert().multiply(upperQ));
  kneeBone.quaternion.copy(upperQ.clone().invert().multiply(new THREE.Quaternion().setFromUnitVectors(leg.bindLower,target.clone().sub(knee).normalize())));
  r.root.updateMatrixWorld(true);
  ankleBone.quaternion.copy(kneeBone.getWorldQuaternion(new THREE.Quaternion()).invert());
}

function animate(r,p,id,mesh) {
  const clips=[],count=64,horse=id==='marchwild_horse',ram=id==='cairn_bighorn',moose=id==='marsh_moose';
  for(const [name,seconds] of [['Idle',3.2],['Walk',p.walk],['Run',p.run],['Attack',p.attack],['Hit',.76],['HitLeft',.80],['HitRight',.80],['Death',1.55]]){
    const times=[],positions=r.bones.map(()=>[]),rotations=r.bones.map(()=>[]);
    const clipCount=name==='Death'?256:count;
    const keyTimes=new Set(Array.from({length:clipCount+1},(_,i)=>i/clipCount));
    if(name==='Walk'||name==='Run'){
      const offsets=name==='Walk'?[0,.50,.75,.25]:horse?[0,.13,.56,.66]:[0,.50,.50,0],duty=name==='Walk'?.64:.47;
      for(const offset of offsets){keyTimes.add((1-offset)%1);keyTimes.add((duty-offset+1)%1);}
    }
    for(const t of [...keyTimes].sort((a,b)=>a-b)){
      const phase=t*Math.PI*2;
      r.bones.forEach((b,i)=>{b.position.copy(r.rest[i].position);b.quaternion.copy(r.rest[i].quaternion);});
      const root=r.named.Root,body=r.named.Body,neck=r.named.Neck,head=r.named.Head;
      let bob=0, pitch=0,roll=0;
      const moving=name==='Walk'||name==='Run',run=name==='Run';
      const strike=pulse(.10,p.contact,.84,t),recoil=pulse(.0,.12,.75,t);
      if(name==='Idle'){
        neck.rotation.x=.019*Math.sin(phase);head.rotation.x=.018*Math.sin(phase+.4);head.rotation.y=.03*Math.sin(phase);
        r.named.Jaw.rotation.x=.028*Math.sin(phase*2);r.named.Tail.rotation.y=.12*Math.sin(phase);r.named.TailTip.rotation.y=.16*Math.sin(phase+.5);
      }
      if(moving){
        const crouch=run?(horse?.22:moose?MOOSE_CONFIG.runCrouch:ram?.16:.12):(horse?.08:moose?MOOSE_CONFIG.walkCrouch:ram?.07:.045);
        bob=-crouch+(run?.030:.012)*(1-Math.cos(phase*2));pitch=(run?.023:.007)*Math.sin(phase*2);
        neck.rotation.x=(run?.10:.03)*Math.sin(phase*2+.4);head.rotation.x=-neck.rotation.x*.62;
        r.named.Tail.rotation.x=(run?-.23:0)+.055*Math.sin(phase*2);r.named.Tail.rotation.y=.08*Math.sin(phase);
        r.named.TailTip.rotation.x=.10*Math.sin(phase*2+.7);
      }
      if(name==='Attack'){
        const wind=pulse(.01,.23,.44,t),recover=pulse(.52,.66,.96,t);
        bob=-(horse?.055:.035)*strike;pitch=ram?.075*strike:moose?.10*strike:horse?-.06*strike:.05*strike;
        neck.rotation.x=-.16*wind+(ram?.69:moose?.57:horse?.24:.26)*strike-.055*recover;
        head.rotation.x=.12*wind+(ram?.20:moose?.18:horse?-.08:.1)*strike;
        r.named.Jaw.rotation.x=horse?.19*strike:.07*strike;
        r.named.Tail.rotation.x=-.14*strike;
      }
      if(name.startsWith('Hit')){
        const side=name==='HitLeft'?-1:name==='HitRight'?1:0;
        bob=-(moose?.080:horse?.080:.055)*recoil;pitch=-.075*recoil;roll=side*.07*recoil;
        neck.rotation.x=-.19*recoil;neck.rotation.z=-side*.14*recoil;head.rotation.y=-side*.19*recoil;
        r.named.Tail.rotation.y=side*.22*recoil;
      }
      if(name==='Death'){
        const collapse=smooth(.09,.52,t),fall=smooth(.12,.87,t);
        bob=-(p.height-p.width)*fall;roll=Math.PI*.5*fall;pitch=.10*collapse*(1-fall);
        neck.rotation.x=.33*collapse;head.rotation.z=(ram?.18:-.18)*fall;head.rotation.x=.15*collapse;
        if(moose||ram){neck.rotation.z=-roll*.50;head.rotation.z=-roll*.50;neck.rotation.x=.12*collapse;head.rotation.x=.05*collapse;}
        r.named.Tail.rotation.x=-.28*collapse;
      }
      root.position.y=bob;body.rotation.x=pitch;body.rotation.z=roll;
      r.named.EarL.rotation.x=.07*Math.sin(phase+(moving?.4:0));r.named.EarR.rotation.x=.06*Math.sin(phase+(moving?.2:1));
      if(name==='Attack'){r.named.EarL.rotation.x=-.40*strike;r.named.EarR.rotation.x=-.40*strike;}
      if(name==='Death'){r.named.EarL.rotation.x=-.30*smooth(.09,.52,t);r.named.EarR.rotation.x=-.30*smooth(.09,.52,t);}
      if(id==='bracken_tapir')r.named.Nose.rotation.x=name==='Attack'?-.17*strike:name==='Death'?.10*smooth(.09,.52,t):.035*Math.sin(phase);
      for(let i=0;i<r.legs.length;i++){
        const leg=r.legs[i],target=leg.ankle.clone();
        if(moving){
          // Linear rearward stance gives a planted hoof after navigation moves the
          // actor forward. The swing uses zero vertical velocity at both contacts.
          const offset=run?(horse?[0,.13,.56,.66]:[0,.50,.50,0])[i]:[0,.50,.75,.25][i];
          const cycle=(t+offset)%1,stance=run?.47:.64,stride=run?p.runStride:p.stride;
          if(cycle<stance)target.z+=stride*(.5-cycle/stance);
          else {const a=(cycle-stance)/(1-stance);target.z+=stride*(-.5+smooth(0,1,a));target.y+=(run?.24:.13)*(Math.sin(Math.PI*a)**2);}
        }
        if(name==='Attack'&&horse&&leg.front&&leg.side<0){target.y+=.34*strike;target.z+=.36*strike;}
        if(name==='Death'){
          const c=smooth(.09,.55,t);target.y+=.16*c;target.z+=(leg.front?-.28:.22)*c;
        }
        if(name==='Death'){
          // Fold directly from the bind pose. Blending a near-singular standing
          // IK solve into the fall can flip knees before the body reaches ground.
          const fold=smooth(.09,.50,t);
          r.named[leg.tag+'Hip'].quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(leg.front?-1.10:1.10,0,0)),fold);
          r.named[leg.tag+'Knee'].quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(leg.front?2.0:-2.0,0,0)),fold);
        }else plant(r,leg,target);
      }
      r.root.updateMatrixWorld(true);
      if(name==='Death'&&t>.09){
        mesh.skeleton.update();let floor=Infinity;const vertex=new THREE.Vector3();
        for(let i=0;i<mesh.geometry.attributes.position.count;i++){mesh.getVertexPosition(i,vertex).applyMatrix4(mesh.matrixWorld);floor=Math.min(floor,vertex.y);}
        root.position.y+=.002-floor;r.root.updateMatrixWorld(true);
      }
      times.push(t*seconds);
      r.bones.forEach((b,i)=>{positions[i].push(...b.position.toArray());rotations[i].push(...b.quaternion.toArray());});
    }
    const tracks=[];
    r.bones.forEach((bone,i)=>{
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`,times,rotations[i]));
      if(i===0)tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.position`,times,positions[i]));
    });
    const clip=new THREE.AnimationClip(name,seconds,tracks);clip.userData={authored:true,contactNormalized:name==='Attack'?p.contact:undefined};clips.push(clip);
  }
  r.bones.forEach((b,i)=>{b.position.copy(r.rest[i].position);b.quaternion.copy(r.rest[i].quaternion);});r.root.updateMatrixWorld(true);
  return clips;
}

export async function buildSpecies(id) {
  const p=PROFILES[id];if(!p)throw new Error(`Unknown hoofed species ${id}`);
  const rig=skeleton(p,id),sculpt=new Sculpt(rig,p,id);anatomy(sculpt,p,id);const mesh=sculpt.mesh();
  const clips=animate(rig,p,id,mesh);rig.root.animations=clips;
  const meta={id,is:p.is,tags:['animal','hoofed',id==='bracken_tapir'?'forest':id==='marsh_moose'?'wetland':id==='cairn_bighorn'?'mountain':'grassland','original','skinned'],provenance:{author:'Corealm',source:'Original continuous anatomical fields, sculpted appendages, procedural coat textures and IK animation',license:'Project-owned original'},attackSeconds:p.attack,contactNormalized:p.contact,impliedWalkMps:p.stride/(p.walk*.64),impliedRunMps:p.runStride/(p.run*.47),walkClipSeconds:p.walk,runClipSeconds:p.run,notes:'Continuous skinned torso, neck, face and leg topology with recessed facial cavities. Embedded coat normal and roughness maps. In-place IK stance, articulated knees, ground-level hoof soles, eight authored clips. No source-model reuse or reduced-distance model.',triangles:mesh.geometry.index.count/3};
  rig.root.userData={species:id,...meta};return {object:rig.root,clips,meta};
}
