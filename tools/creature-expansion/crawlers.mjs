import * as THREE from 'three';
import { makeCrawlerMaterials } from './crawlers/materials.mjs';
import { sculptSpider } from './crawlers/spider.mjs';

/** Original arthropod sculpture and skeletal animation. Metres, +Z forward. */
export const SPECIES = ['antler_beetle', 'slag_centipede', 'hollowroot_spider'];
const TAU = Math.PI * 2;
const V = (p) => new THREE.Vector3(...p);
const smooth = (x) => x * x * (3 - 2 * x);
const pulse = (t, a, b) => t < a || t > b ? 0 : Math.sin(Math.PI * (t - a) / (b - a));

class Sculpture {
  constructor(id) {
    this.id = id; this.object = new THREE.Group(); this.object.name = id;
    this.root = new THREE.Bone(); this.root.name = `${id}_root`; this.object.add(this.root);
    this.bones = [this.root]; this.parts = new Map(); this.legs = []; this.feelers = []; this.jaws = [];
    this.materials = makeCrawlerMaterials(THREE, id); this.bodyParts = [];
  }
  bone(name, p, parent = this.root) {
    const bone = new THREE.Bone(); bone.name = `${this.id}_${name}`;
    this.object.updateMatrixWorld(true); const pp = parent.getWorldPosition(new THREE.Vector3());
    bone.position.copy(V(p).sub(pp)); parent.add(bone); this.bones.push(bone); return bone;
  }
  add(geometry, material, bone, secondary = null, weight = 1) {
    const pos = geometry.getAttribute('position'); const ix = this.bones.indexOf(bone);
    const other = secondary ? this.bones.indexOf(secondary) : 0;
    const indices = new Uint16Array(pos.count * 4); const weights = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) { indices[i*4] = ix; indices[i*4+1] = other; weights[i*4] = weight; weights[i*4+1] = 1-weight; }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    if (!this.parts.has(material)) this.parts.set(material, []); this.parts.get(material).push(geometry);
  }
  surface(material, bone, fn, nu = 32, nv = 20, flip = false) {
    const density=this.id==='slag_centipede'?.59:this.id==='hollowroot_spider'?.83:.86;nu=Math.max(6,Math.round(nu*density));nv=Math.max(6,Math.round(nv*density));
    const p=[],uv=[],ind=[];
    for(let j=0;j<=nv;j++) for(let i=0;i<=nu;i++) { p.push(...fn(i/nu,j/nv)); uv.push(i/nu,j/nv); }
    for(let j=0;j<nv;j++) for(let i=0;i<nu;i++){const a=j*(nu+1)+i,b=a+nu+1;if(flip)ind.push(a,a+1,b,b,a+1,b+1);else ind.push(a,b,a+1,b,b+1,a+1);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ind);g.computeVertexNormals();this.add(g,material,bone);return g;
  }
  egg(material,bone,c,r,{rings=24,sides=36,ridges=0,taper=0,flatten=0,twist=0}={}) {
    return this.surface(material,bone,(u,v)=>{
      const a=u*TAU+twist*(v-.5),z=Math.cos(Math.PI*v),s=Math.sin(Math.PI*v),rib=1+ridges*Math.cos(a*12)*s*s;
      const x=Math.cos(a)*s*r[0]*(1+taper*z)*rib;
      let y=Math.sin(a)*s*r[1]*rib; if(y<0)y*=1-flatten;
      return [c[0]+x,c[1]+y,c[2]+z*r[2]];
    },sides,rings);
  }
  tube(material,bone,points,radii,{sides=12,steps=24,flute=.08,ellipse=1}={}) {
    const curve = new THREE.CatmullRomCurve3(points.map(V));const frames=curve.computeFrenetFrames(steps,false);
    return this.surface(material,bone,(u,v)=>{
      const j=Math.min(steps,Math.round(v*steps)),at=curve.getPointAt(v),n=frames.normals[j],b=frames.binormals[j];
      const k=v*(radii.length-1),ix=Math.min(radii.length-2,Math.floor(k)),f=k-ix;
      const r=THREE.MathUtils.lerp(radii[ix],radii[ix+1],f),a=u*TAU,rib=1+flute*Math.cos(a*6);
      return at.addScaledVector(n,Math.cos(a)*r*rib).addScaledVector(b,Math.sin(a)*r*rib*ellipse).toArray();
    },sides,steps,true);
  }
  bead(material,bone,p,r) { this.egg(material,bone,p,[r,r*.78,r],{sides:16,rings:10}); }
  roundedFemur(bone,hip,mid,knee,width){
    const curve=new THREE.CatmullRomCurve3([V(hip),V(mid),V(knee)]),frames=curve.computeFrenetFrames(80,false),tip=V(knee),axis=curve.getTangentAt(1).normalize(),radius=width*.76;
    const g=this.surface('shellAlt',bone,(u,v)=>{
      const a=u*TAU;let center,n,b,r;
      if(v<=.72){const p=v/.72,j=Math.min(80,Math.round(p*80));center=curve.getPointAt(p);n=frames.normals[j];b=frames.binormals[j];r=width*(p<.48?THREE.MathUtils.lerp(.82,.94,smooth(p/.48)):THREE.MathUtils.lerp(.94,.76,smooth((p-.48)/.52)))*(1+.018*Math.cos(a*6)*Math.sin(Math.PI*p));}
      else {const t=(v-.72)/.28*Math.PI/2;center=tip.clone().addScaledVector(axis,radius*Math.sin(t));n=frames.normals[80];b=frames.binormals[80];r=radius*Math.cos(t);}
      return center.addScaledVector(n,Math.cos(a)*r).addScaledVector(b,Math.sin(a)*r).toArray();
    },this.id==='hollowroot_spider'?16:20,this.id==='hollowroot_spider'?30:44,true);
    // Coincident UV-seam vertices share a normal so the rounded femur and its
    // integral socket read as one shell through the articulation.
    const p=g.getAttribute('position'),normal=g.getAttribute('normal'),groups=new Map();
    for(let i=0;i<p.count;i++){const key=[p.getX(i),p.getY(i),p.getZ(i)].map(x=>x.toFixed(6)).join(',');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);}
    for(const indices of groups.values())if(indices.length>1){const n=new THREE.Vector3();for(const i of indices)n.add(new THREE.Vector3().fromBufferAttribute(normal,i));n.normalize();for(const i of indices)normal.setXYZ(i,n.x,n.y,n.z);}
    return g;
  }
  leg(name,hip,knee,foot,{parent=this.body,phase=0,width=.055,spurs=1,toe=.15}={}) {
    const rounded=this.id==='antler_beetle'||this.id==='hollowroot_spider';
    const h=this.bone(`${name}_coxa`,hip,parent),k=this.bone(`${name}_tibia`,knee,h),f=this.bone(`${name}_tarsus`,foot,k);
    const hp=V(hip),kp=V(knee),fp=V(foot),s=Math.sign(hip[0]);
    const mid1=hp.clone().lerp(kp,.54).add(new THREE.Vector3(0,width*.65,0));
    const mid2=kp.clone().lerp(fp,.55).add(new THREE.Vector3(s*width*.35,0,0));
    const upperTip=rounded?kp.clone():kp.clone().addScaledVector(kp.clone().sub(hp).normalize(),width*.14);
    const lowerBase=kp.clone().addScaledVector(fp.clone().sub(kp).normalize(),-width*.16);
    if(rounded)this.roundedFemur(h,hip,mid1.toArray(),knee,width);
    else this.tube('shellAlt',h,[hip,mid1.toArray(),upperTip.toArray()],[width*.82,width*.92,width*.62],{steps:14,sides:12,flute:.035});
    this.tube('horn',k,[lowerBase.toArray(),mid2.toArray(),foot],[width*(rounded?.53:.67),width*.42,width*.17],{steps:18,sides:12,flute:.04,ellipse:.85});
    this.bead('shellAlt',h,hip,width*.70);
    if(!rounded)this.bead('shellAlt',k,knee,width*.57);
    this.bead('horn',f,foot,width*.23);
    for(let i=0;i<spurs;i++){const t=.36+i*.2,p=kp.clone().lerp(fp,t);this.tube('horn',k,[p.toArray(),p.clone().add(new THREE.Vector3(s*width*1.2,width*.2,-width)).toArray(),p.clone().add(new THREE.Vector3(s*width*2.2,width*.2,-width*2)).toArray()],[width*.25,width*.15,.001],{steps:7,sides:8});}
    this.tube('horn',f,[foot,[foot[0]+s*toe*.22,.019,foot[2]+toe*.5],[foot[0]+s*toe*.17,.012,foot[2]+toe]],[width*.24,width*.14,.001],{steps:10,sides:10});
    this.tube('horn',f,[foot,[foot[0]-s*toe*.15,.016,foot[2]+toe*.42],[foot[0]-s*toe*.2,.008,foot[2]+toe*.74]],[width*.16,width*.1,.001],{steps:8,sides:8});
    this.legs.push({h,k,f,hip:hp,knee:kp,foot:fp,upper:kp.clone().sub(hp),lower:fp.clone().sub(kp),phase,side:s});
  }
  antenna(name,points,width,parent=this.head) {
    const a=this.bone(`${name}_base`,points[0],parent),mid=points[2],b=this.bone(`${name}_tip`,mid,a);
    this.tube('horn',a,points.slice(0,3),[width,width*.82,width*.6],{steps:18,sides:10,flute:.1});
    this.tube('shellAlt',b,points.slice(2),[width*.6,width*.35,.003],{steps:20,sides:10,flute:.15});
    this.bead('joint',b,mid,width*.66);this.feelers.push({a,b,side:Math.sign(points[0][0])});return a;
  }
  finish() {
    this.object.updateMatrixWorld(true);const skeleton=new THREE.Skeleton(this.bones);skeleton.calculateInverses();
    for(const [mat,geos] of this.parts){
      const arrays={position:[],normal:[],uv:[],skinIndex:[],skinWeight:[]};const index=[];let offset=0;
      for(const g of geos){for(const key of Object.keys(arrays))arrays[key].push(...g.getAttribute(key).array);for(const ix of g.index.array)index.push(ix+offset);offset+=g.getAttribute('position').count;}
      const merged=new THREE.BufferGeometry();for(const [key,array] of Object.entries(arrays))merged.setAttribute(key,key==='skinIndex'?new THREE.Uint16BufferAttribute(array,4):new THREE.Float32BufferAttribute(array,key==='uv'?2:key==='skinWeight'?4:3));merged.setIndex(index);merged.computeBoundingSphere();
      const mesh=new THREE.SkinnedMesh(merged,this.materials[mat]);mesh.name=`${this.id}_${mat}`;mesh.frustumCulled=false;mesh.castShadow=true;mesh.receiveShadow=true;this.object.add(mesh);mesh.bind(skeleton);
    }
    this.rest=this.bones.map(b=>({p:b.position.clone(),q:b.quaternion.clone(),s:b.scale.clone()}));return this;
  }
  reset(){this.bones.forEach((b,i)=>{b.position.copy(this.rest[i].p);b.quaternion.copy(this.rest[i].q);b.scale.copy(this.rest[i].s);});}
  plant(leg,target,curl=0){
    this.object.updateMatrixWorld(true);const hip=leg.h.getWorldPosition(new THREE.Vector3()),end=target.clone();
    const a=leg.upper.length(),b=leg.lower.length(),delta=end.clone().sub(hip),d=Math.min(a+b-.002,Math.max(Math.abs(a-b)+.002,delta.length())),axis=delta.normalize();
    const pref=new THREE.Vector3(leg.side,1.05,0);const perp=pref.addScaledVector(axis,-pref.dot(axis)).normalize();
    const along=(a*a-b*b+d*d)/(2*d),height=Math.sqrt(Math.max(0,a*a-along*along));
    const knee=hip.clone().addScaledVector(axis,along).addScaledVector(perp,height);
    const upperGlobal=new THREE.Quaternion().setFromUnitVectors(leg.upper.clone().normalize(),knee.clone().sub(hip).normalize());
    const parentQ=leg.h.parent.getWorldQuaternion(new THREE.Quaternion());leg.h.quaternion.copy(parentQ.invert().multiply(upperGlobal));
    const lowerGlobal=new THREE.Quaternion().setFromUnitVectors(leg.lower.clone().normalize(),end.clone().sub(knee).normalize());
    leg.k.quaternion.copy(upperGlobal.clone().invert().multiply(lowerGlobal));
    leg.f.quaternion.copy(lowerGlobal.clone().invert()).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),curl));
  }
}

function sculptBeetle(){
  const s=new Sculpture('antler_beetle');s.body=s.bone('thorax',[0,.53,.06]);s.abdomen=s.bone('abdomen',[0,.55,-.28],s.body);s.head=s.bone('head',[0,.54,.68],s.body);
  // The ventral cuticle uses the authored chitin maps, including beneath the elytral rim.
  // Broad sternites are sculpted into a continuous abdomen instead of a separate flat band.
  s.materials.seam=s.materials.shellAlt.clone();s.materials.seam.name='antler_beetle_ventral_chitin';s.materials.seam.color.setRGB(.65,.67,.60);s.materials.seam.roughness=1;
  s.surface('seam',s.abdomen,(u,v)=>{
    const a=u*TAU,z=-.30+.63*Math.cos(Math.PI*v),span=Math.sin(Math.PI*v);
    const nearest=Math.min(...[-.77,-.58,-.39,-.20,-.01,.18].map(edge=>Math.abs(z-edge)));
    const groove=1-.038*Math.exp(-Math.pow(nearest/.012,2));
    const x=.407*Math.cos(a)*span*(1+.07*Math.cos(Math.PI*v))*groove;
    let y=.165*Math.sin(a)*span*groove;if(y<0)y*=.68;
    return [x,.452+y,z];
  },38,54);
  for(const side of [-1,1]){
    const wing=s.bone(`elytron_${side<0?'L':'R'}`,[side*.035,.54,.04],s.abdomen);s.bodyParts.push({bone:wing,phase:side,type:'elytron'});
    // Each elytron follows one half of a shared carapace, with a narrow vertical median seam.
    s.surface('shell',wing,(u,v)=>{
      const a=Math.PI*v,span=Math.sin(a),z=-.32+.635*Math.cos(a);
      let x,y;
      if(u<=.45){const phi=u/.45*Math.PI/2;x=(.004+.43*Math.sin(phi))*span;y=.54+(.27*Math.cos(phi)+.0025*Math.cos(phi*18)*Math.sin(phi)-.008*Math.exp(-Math.pow(Math.sin(phi)/.075,2)))*span;}
      else if(u<=.90){const phi=(.90-u)/.45*Math.PI/2;x=(.004+.43*Math.sin(phi))*span;y=.54+.236*Math.cos(phi)*span;}
      else{x=.004*span;y=.54+(.236+(u-.9)/.1*.026)*span;}
      return [side*x,y,z];
    },44,34,side>0);
  }
  s.surface('seam',s.abdomen,(u,v)=>{const span=Math.sin(Math.PI*v);return [(u*2-1)*.018*span,.54+.254*span,-.32+.635*Math.cos(Math.PI*v)];},8,34,true);
  s.egg('shellAlt',s.body,[0,.565,.34],[.395,.211,.34],{sides:40,rings:24,ridges:.01,taper:-.12,flatten:.35});
  s.egg('shellAlt',s.head,[0,.55,.72],[.29,.145,.25],{sides:32,rings:24,ridges:.01,flatten:.3,taper:-.1});
  s.egg('shell',s.head,[0,.628,.735],[.225,.066,.20],{sides:30,rings:18,ridges:.01});
  for(const side of [-1,1]){
    s.egg('shellAlt',s.head,[side*.25,.60,.748],[.035,.045,.078],{sides:20,rings:14});
    s.egg('eye',s.head,[side*.272,.608,.757],[.019,.030,.052],{sides:16,rings:12});
    const jaw=s.bone(`mandible_${side<0?'L':'R'}`,[side*.17,.50,.89],s.head);s.jaws.push({bone:jaw,side});
    const pts=[[side*.17,.50,.87],[side*.30,.515,1.04],[side*.375,.575,1.28],[side*.30,.63,1.50],[side*.155,.62,1.62]];
    s.tube('horn',jaw,pts,[.079,.080,.062,.028,.001],{sides:16,steps:35,flute:.025,ellipse:.84});
    for(const [z,x,len,y] of [[1.04,.30,.13,.52],[1.22,.365,.17,.56],[1.405,.343,.13,.607]])s.tube('horn',jaw,[[side*x,y,z],[side*(x-len*.6),y+.018,z+.025],[side*(x-len),y+.042,z+.105]],[.030,.018,.001],{sides:10,steps:12,flute:.025});
    s.antenna(`antenna_${side}`,[[side*.20,.65,.79],[side*.36,.78,.88],[side*.46,.87,1.02],[side*.56,.90,1.18],[side*.50,.93,1.31]],.025);
    for(let j=0;j<3;j++)s.egg('shellAlt',s.feelers.at(-1).b,[side*(.525-j*.013),.924+j*.011,1.245+j*.025],[.021,.013,.026],{sides:12,rings:10});
    const hips=[[side*.31,.49,.40],[side*.39,.45,.01],[side*.32,.43,-.44]];
    const knees=[[side*.70,.49,.68],[side*.78,.45,-.02],[side*.69,.43,-.64]];
    const feet=[[side*.84,.06,.72],[side*.97,.055,-.12],[side*.86,.055,-.86]];
    for(let i=0;i<3;i++)s.leg(`leg_${side<0?'L':'R'}_${i+1}`,hips[i],knees[i],feet[i],{phase:(i%2)*.5+(side<0?0:.5),width:i===0?.065:.069,spurs:2,toe:.14});
  }
  return s.finish();
}

function sculptCentipede(){
  const s=new Sculpture('slag_centipede');s.body=s.bone('collar',[0,.30,.91]);s.head=s.bone('head',[0,.31,1.09],s.body);s.segments=[];
  s.egg('joint',s.body,[0,.30,.85],[.30,.11,.24],{sides:28,rings:16,flatten:.28,ridges:.12});
  s.egg('shellAlt',s.head,[0,.365,1.10],[.32,.142,.285],{sides:36,rings:26,flatten:.54,taper:-.05,ridges:.045});
  s.egg('seam',s.head,[0,.29,1.12],[.278,.072,.27],{sides:28,rings:18,taper:-.12});
  let parent=s.body;
  for(let i=0;i<10;i++){
    const z=.80-i*.245,w=.265*(1-.35*Math.max(0,(i-5)/4)),y=.305-i*.003;
    const seg=s.bone(`trunk_${String(i+1).padStart(2,'0')}`,[0,y,z],parent);parent=seg;s.segments.push({bone:seg,phase:i*.65});
    s.egg('joint',seg,[0,y-.015,z],[w*.94,.075,.18],{sides:24,rings:14,flatten:.24,ridges:.16});
    s.egg(i%3===0?'shellAlt':'shell',seg,[0,y+.057,z],[w*1.04,.11,.158],{sides:28,rings:18,flatten:.7,taper:.09,ridges:.05});
    for(const side of [-1,1]){
      s.egg('shellAlt',seg,[side*w*.82,y+.01,z-.015],[w*.30,.060,.135],{sides:18,rings:14,flatten:.42,taper:.10});
      s.tube('horn',seg,[[side*w*.79,y+.061,z-.09],[side*w*1.13,y+.055,z-.14],[side*w*1.35,y+.045,z-.22]],[.031,.023,.001],{sides:8,steps:10,flute:.1});
      s.leg(`leg_${side<0?'L':'R'}_${String(i+1).padStart(2,'0')}`,[side*w*.81,y-.025,z],[side*(w+.25),y+.005,z-.018],[side*(w+.34),.043,z-.075],{parent:seg,phase:(i*.135+(side<0?0:.5))%1,width:.038*(1-i*.013),spurs:0,toe:.09});
    }
    s.egg('horn',seg,[0,y+.151,z-.031],[.025,.018,.074],{sides:12,rings:10,flatten:.5});
  }
  for(const side of [-1,1]){
    for(let i=0;i<4;i++){const x=side*(.26+i*.003),z=1.02+i*.053;s.egg('joint',s.head,[x,.376,z],[.033,.031,.042],{sides:12,rings:10});s.egg('eye',s.head,[x+side*.013,.390,z+.003],[.018,.024,.025],{sides:14,rings:10});}
    const jaw=s.bone(`forcipule_${side<0?'L':'R'}`,[side*.20,.275,1.27],s.head);s.jaws.push({bone:jaw,side});
    s.tube('shellAlt',jaw,[[side*.19,.285,1.22],[side*.31,.23,1.37],[side*.35,.235,1.51]],[.088,.089,.063],{sides:14,steps:17,flute:.08});
    s.tube('horn',jaw,[[side*.35,.235,1.49],[side*.26,.26,1.65],[side*.09,.295,1.68]],[.063,.04,.001],{sides:14,steps:17,flute:.09});
    s.antenna(`antenna_${side}`,[[side*.175,.415,1.27],[side*.31,.50,1.43],[side*.45,.52,1.64],[side*.55,.55,1.85],[side*.58,.56,2.03]],.023);
    const last=s.segments.at(-1).bone;const tail=s.bone(`tail_cercus_${side}`,[side*.13,.29,-1.43],last);s.bodyParts.push({bone:tail,phase:side*1.7});
    s.tube('shellAlt',tail,[[side*.13,.29,-1.43],[side*.29,.34,-1.63],[side*.36,.44,-1.88],[side*.30,.49,-2.01]],[.052,.05,.025,.001],{sides:12,steps:24,flute:.18});
    for(let i=0;i<3;i++)s.tube('horn',tail,[[side*(.24+i*.04),.33+i*.04,-1.59-i*.09],[side*(.34+i*.04),.34+i*.05,-1.68-i*.09]],[.016,.001],{sides:6,steps:7});
  }
  return s.finish();
}


function animate(s,kind,t){
  s.reset();const locomotion=kind==='Walk'||kind==='Run',run=kind==='Run';const cfg=s.config;
  const cycle=t*TAU;let attack=0,recoil=0,death=0;
  if(kind==='Attack')attack=pulse(t,.12,.78);
  if(kind.startsWith('Hit'))recoil=pulse(t,0,.85)*(1-t*.3);
  if(kind==='Death')death=smooth(Math.min(1,t*1.6));
  const idle=kind==='Idle'?Math.sin(cycle):0;
  s.body.position.y += locomotion ? .018*Math.cos(cycle*2) : idle*.007;
  s.body.rotation.x = locomotion?.014*Math.sin(cycle):attack*(s.id==='slag_centipede'?-.032:-.15)+recoil*.13;
  s.body.rotation.z = locomotion?.018*Math.sin(cycle):recoil*(kind==='HitLeft'?.15:kind==='HitRight'?-.15:.045)+death*(s.id==='slag_centipede'?.13:s.id==='antler_beetle'?.30:.18);
  if(death)s.body.position.y-=cfg.collapse*death;
  if(s.abdomen){s.abdomen.rotation.y=locomotion?.025*Math.sin(cycle-.7):idle*.012+recoil*.055;s.abdomen.rotation.x=attack*.12-death*.14;}
  s.head.rotation.x=locomotion?.025*Math.sin(cycle+.6):idle*.018-attack*.22+recoil*.16-death*.52;
  s.head.position.z+=attack*.09;s.head.rotation.y=recoil*(kind==='HitLeft'?-.2:kind==='HitRight'?.2:.05);
  s.head.position.y-=death*.035;
  for(const {bone,phase,type} of s.bodyParts){bone.rotation.z=type==='elytron'?0:locomotion?.012*Math.sin(cycle+phase):idle*.004;bone.rotation.y=type==='elytron'?0:locomotion?.024*Math.sin(cycle+phase):attack*.055*Math.sin(phase);}
  for(const seg of s.segments??[]){seg.bone.rotation.y=locomotion?.035*Math.sin(cycle-seg.phase):idle*.018*Math.sin(seg.phase)+attack*.035*Math.sin(seg.phase);seg.bone.rotation.x=locomotion?.018*Math.cos(cycle-seg.phase):death*.012;}
  for(const {a,b,side} of s.feelers){a.rotation.y=side*(.06*Math.sin(cycle+(side<0?0:1))-.19*attack+.3*death);a.rotation.x=.065*Math.sin(cycle+.6)+attack*.2-death*(s.id==='hollowroot_spider'?.9:0);b.rotation.z=side*.08*Math.sin(cycle+1.1);b.rotation.x=.12*Math.sin(cycle+side*.6)+death*(s.id==='hollowroot_spider'?-.8:.4);}
  for(const {bone,side} of s.jaws) {const wind=pulse(t,0,.42);bone.rotation.y=locomotion?side*.028*Math.sin(cycle):kind==='Attack'?side*(-.22*wind+.36*pulse(t,.27,.72)):side*(idle*.04+death*.24);bone.rotation.x=-attack*.075-death*.3;}
  const duty=run?cfg.runDuty:cfg.duty,stride=run?cfg.runStride:cfg.stride,lift=run?cfg.runLift:cfg.lift;
  for(let i=0;i<s.legs.length;i++){
    const leg=s.legs[i],target=leg.foot.clone();let curl=0;
    if(locomotion){let p=(t+leg.phase)%1;if(t===1)p=leg.phase%1;if(p<duty){target.z+=stride*(.5-p/duty);}else{const q=(p-duty)/(1-duty);target.z+=stride*(-.5+smooth(q));target.y+=lift*Math.sin(Math.PI*q)**2;curl=-.27*Math.sin(Math.PI*q);} }
    if(kind==='Attack'){target.z+=attack*(i<2?.12:-.02);target.y+=i<2?attack*.055:0;}
    if(death){target.x*=1-death*.29;target.z-=death*.07;target.y+=death*.035;curl=-death*.8;}
    s.plant(leg,target,curl);
  }
  s.object.updateMatrixWorld(true);
}

function clipsFor(s){
  const result=[];const durations={Idle:3.8,Walk:s.config.walkSeconds,Run:s.config.runSeconds,Attack:s.config.attackSeconds,Hit:.55,HitLeft:.58,HitRight:.58,Death:1.55};
  for(const [name,duration] of Object.entries(durations)){
    const frames=name==='Idle'?33:49,times=[],channels=s.bones.map(()=>({p:[],q:[],s:[]}));
    for(let i=0;i<frames;i++){const t=i/(frames-1);times.push(duration*t);animate(s,name,t);s.bones.forEach((b,j)=>{channels[j].p.push(...b.position.toArray());channels[j].q.push(...b.quaternion.toArray());channels[j].s.push(...b.scale.toArray());});}
    const tracks=[];s.bones.forEach((b,j)=>{if(j===0)return;tracks.push(new THREE.VectorKeyframeTrack(`${b.name}.position`,times,channels[j].p),new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`,times,channels[j].q));});result.push(new THREE.AnimationClip(name,duration,tracks));
  }
  s.reset();s.object.updateMatrixWorld(true);return result;
}

export async function buildSpecies(id){
  if(!SPECIES.includes(id))throw new Error(`Unknown crawler species: ${id}`);
  let s;
  if(id==='antler_beetle')s=sculptBeetle();
  else if(id==='slag_centipede')s=sculptCentipede();
  else s=sculptSpider(Sculpture);
  s.config=id==='antler_beetle'?{stride:.36,runStride:.56,duty:.64,runDuty:.57,lift:.12,runLift:.18,walkSeconds:1.26,runSeconds:.70,attackSeconds:1.10,collapse:.268}:id==='slag_centipede'?{stride:.23,runStride:.36,duty:.7,runDuty:.62,lift:.075,runLift:.12,walkSeconds:1.05,runSeconds:.62,attackSeconds:.94,collapse:.11}:{stride:.44,runStride:.66,duty:.63,runDuty:.56,lift:.16,runLift:.24,walkSeconds:1.26,runSeconds:.70,attackSeconds:1.04,collapse:.32};
  const clips=clipsFor(s);
  const description=id==='antler_beetle'?'A jade stag beetle with bronze branching mandibles, divided ribbed elytra and six articulated legs.':id==='slag_centipede'?'An iron plated centipede with a flattened chain of articulated trunk segments, twenty walking legs and curved venom forcipules.':'A root patterned hunting spider with eight jointed legs, a tapered abdomen, eight eyes, paired pedipalps and hooked chelicerae.';
  s.object.userData={species:id,original:true,authoredForward:'+Z',units:'metres',anatomy:description};
  return {object:s.object,clips,meta:{is:id==='antler_beetle'?'beetle':id==='slag_centipede'?'centipede':'spider',tags:['creature','crawler','arthropod',id,id==='antler_beetle'?'forest':id==='slag_centipede'?'cave':'woodland'],provenance:'Original Corealm procedural sculpture, materials, skinning and animation; no third party geometry or animation.',attackSeconds:s.config.attackSeconds,contactNormalized:.5,impliedWalkMps:s.config.stride/(s.config.walkSeconds*s.config.duty),impliedRunMps:s.config.runStride/(s.config.runSeconds*s.config.runDuty),walkClipSeconds:s.config.walkSeconds,runClipSeconds:s.config.runSeconds,notes:`${description} Authored skeletal IK foot targets preserve straight stance travel; ${id==='slag_centipede'?'metachronal':id==='antler_beetle'?'alternating tripod':'alternating tetrapod'} cycles. In-place clips, sealed loop endpoints, full directional hit reactions and a held collapse. Original painted chitin color, normal and roughness textures.`}};
}
