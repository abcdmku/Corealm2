import * as THREE from 'three';
import {MarchingCubes} from '../../../node_modules/three/examples/jsm/objects/MarchingCubes.js';

const clamp=THREE.MathUtils.clamp,lerp=THREE.MathUtils.lerp;
const smax=(a,b,k)=>{const t=clamp(.5+.5*(b-a)/k,0,1);return lerp(a,b,t)+k*t*(1-t);};
const V=a=>new THREE.Vector3(...a);

/** Emits a single skin through rib cage, shoulder blades, haunches and limbs.
 * The field is sampled once, so no internal intersecting anatomical surfaces
 * survive as open caps or separate patches in the exported mesh.
 */
export function joinedMammal(s,r,out,coat,profileAt,bodyWeights,pawDesign,pawCoat){
  const shapes=[];
  const ell=(centre,scale,bone,blend=.028,weights=null,rotation=0)=>{
    shapes.push({type:'ell',centre,scale,inv:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-rotation),blend,weights:weights??[[r.index(bone),1]],leg:false});
  };
  const capsule=(a,b,r0,r1,bone,blend=.022,weights=null)=>{
    const direction=V(b).sub(V(a));const shape={type:'capsule',a,b,r0,r1,direction,lengthSq:direction.lengthSq(),blend,weights:weights??[[r.index(bone),1]],leg:true};shapes.push(shape);return shape;
  };
  const rows=s.kind==='fox'?s.body.filter(p=>p[0]<=.39).concat([[.48,.72,.099,.154],[.54,.75,.033,.073],[.555,.75,.001,.006]]):s.kind==='lynx'?s.body.filter(p=>p[0]<=.43).concat([[.50,.84,.12,.18],[.59,.92,.001,.04]]):s.body;
  const body={type:'profile',rows,blend:.038,weights:p=>bodyWeights(r,s,p[2]),leg:false};shapes.push(body);
  if(s.kind==='fox'){
    ell([0,.764,.52],[.105,.143,.144],'Neck',.034,[[r.index('Chest'),.18],[r.index('Neck'),.82]],-.30);
    ell([0,.831,.714],[.136,.126,.156],'Head',.030);
    ell([0,.815,.784],[.112,.098,.105],'Head',.022);
    const muzzle=capsule([0,.796,.802],[0,.773,1.034],.070,.023,'Head',.022);muzzle.leg=false;
    for(const sign of [-1,1])ell([sign*.075,.800,.771],[.061,.068,.106],'Head',.024);
  }else if(s.kind==='lynx'){
    ell([0,.89,.50],[.143,.18,.16],'Neck',.034,[[r.index('Chest'),.20],[r.index('Neck'),.80]],-.18);
    ell([0,.979,.713],[.180,.160,.187],'Head',.032);
    ell([0,.906,.840],[.128,.082,.070],'Head',.025);
    for(const sign of [-1,1])ell([sign*.066,.908,.813],[.078,.070,.090],'Head',.026);
  }
  const short=s.kind==='badger'||s.kind==='porc';
  for(const leg of r.legs){
    const {name,front,hip,knee,hock,paw}=leg;
    const muscle=hip.clone().lerp(knee,.32),origin=hip.clone();origin.x*=.63;origin.y+=.035;
    const upper=short?(front?.082:.105):s.kind==='lynx'?(front?.068:.102):(front?.059:.085),joint=short?.034:s.kind==='lynx'?.038:.029;
    const torso=front?'Chest':'Pelvis';
    capsule(origin.toArray(),muscle.toArray(),upper*.79,upper,name+'_Upper',.036,[[r.index(torso),.34],[r.index(name+'_Upper'),.66]]);
    capsule(muscle.toArray(),knee.toArray(),upper*.90,joint,name+'_Upper',.025);
    const lower=knee.clone().lerp(hock,.70);
    capsule(knee.toArray(),lower.toArray(),joint*.78,joint*.60,name+'_Lower',.015);
    capsule(lower.toArray(),hock.toArray(),joint*.60,joint*.83,name+'_Lower',.014,[[r.index(name+'_Lower'),.82],[r.index(name+'_Ankle'),.18]]);
    capsule(hock.toArray(),paw.toArray(),joint*.80,joint*.65,name+'_Ankle',.014);
    ell(knee.toArray(),[joint,joint*1.30,joint*1.08],name+'_Lower',.017,[[r.index(name+'_Upper'),.40],[r.index(name+'_Lower'),.60]]);shapes.at(-1).leg=true;
    ell(hock.clone().add(new THREE.Vector3(0,.005,-.007)).toArray(),[joint*.88,joint*1.13,joint*.96],name+'_Ankle',.012,[[r.index(name+'_Lower'),.38],[r.index(name+'_Ankle'),.62]]);shapes.at(-1).leg=true;
    const pad=pawDesign(s,leg);
    ell([paw.x,pad.height,paw.z+pad.forward],[pad.halfWidth,pad.height,pad.halfLength],name+'_Paw',.016);shapes.at(-1).leg=true;shapes.at(-1).paw=true;
    capsule([paw.x,paw.y+.042,paw.z-.025],[paw.x,pad.height+.012,paw.z+.003],joint*1.12,pad.halfWidth*.80,name+'_Paw',.019,[[r.index(name+'_Ankle'),.26],[r.index(name+'_Paw'),.74]]);shapes.at(-1).paw=true;
  }
  function distance(f,x,y,z){
    if(f.type==='profile'){
      if(z<f.rows[0][0]||z>f.rows.at(-1)[0])return 1;
      const q=profileAt(f.rows,z),px=x/q[2],py=(y-q[1])/q[3],k0=Math.hypot(px,py),k1=Math.hypot(px/q[2],py/q[3]);
      return k1<1e-8?-Math.min(q[2],q[3]):k0*(k0-1)/k1;
    }
    if(f.type==='capsule'){
      const dx=x-f.a[0],dy=y-f.a[1],dz=z-f.a[2],t=clamp((dx*f.direction.x+dy*f.direction.y+dz*f.direction.z)/f.lengthSq,0,1);
      return Math.hypot(dx-f.direction.x*t,dy-f.direction.y*t,dz-f.direction.z*t)-lerp(f.r0,f.r1,t);
    }
    const d=new THREE.Vector3(x-f.centre[0],y-f.centre[1],z-f.centre[2]).applyQuaternion(f.inv),q=f.scale;
    const k0=Math.hypot(d.x/q[0],d.y/q[1],d.z/q[2]),k1=Math.hypot(d.x/(q[0]*q[0]),d.y/(q[1]*q[1]),d.z/(q[2]*q[2]));
    return k1<1e-8?-Math.min(...q):k0*(k0-1)/k1;
  }
  const centre=[0,.57,.21],span=2.05,resolution=s.kind==='fox'?112:s.kind==='porc'?94:s.kind==='lynx'?100:104,half=span*.5,step=span/resolution,origin=centre.map(x=>x-half);
  const mc=new MarchingCubes(resolution,new THREE.MeshBasicMaterial(),false,false,120000);mc.isolation=0;mc.field.fill(-10);
  for(const f of shapes){
    let lo,hi;
    if(f.type==='capsule'){
      const rad=Math.max(f.r0,f.r1)+f.blend*2;lo=f.a.map((x,i)=>Math.min(x,f.b[i])-rad);hi=f.a.map((x,i)=>Math.max(x,f.b[i])+rad);
    }else if(f.type==='profile'){
      const q=f.rows,rx=Math.max(...q.map(x=>x[2]))+.08;lo=[-rx,Math.min(...q.map(x=>x[1]-x[3]))-.06,q[0][0]-.02];hi=[rx,Math.max(...q.map(x=>x[1]+x[3]))+.06,q.at(-1)[0]+.02];
    }else{
      const y=Math.max(f.scale[1],f.scale[2]),e=[f.scale[0]+f.blend*2,y+f.blend*2,y+f.blend*2];lo=f.centre.map((x,i)=>x-e[i]);hi=f.centre.map((x,i)=>x+e[i]);
    }
    lo=lo.map((x,i)=>clamp(Math.floor((x-origin[i])/step),1,resolution-2));hi=hi.map((x,i)=>clamp(Math.ceil((x-origin[i])/step),1,resolution-2));
    for(let z=lo[2];z<=hi[2];z++)for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++){
      const i=x+resolution*y+resolution*resolution*z,df=distance(f,origin[0]+step*x,origin[1]+step*y,origin[2]+step*z);mc.field[i]=smax(mc.field[i],-df,f.blend);
    }
  }
  mc.update();
  const weights=p=>{
    // Sole and toe-facing vertices stay rigid on the planted paw bone. The
    // raised instep blends into the ankle through the neighbouring fields.
    for(const leg of r.legs){const pad=pawDesign(s,leg);if(p[1]<pad.height*.82&&Math.abs(p[0]-leg.paw.x)<pad.halfWidth*1.25&&Math.abs(p[2]-leg.paw.z-pad.forward)<pad.halfLength*1.35)return [[r.index(leg.name+'_Paw'),1]];}
    const ds=shapes.map(f=>distance(f,...p)),low=Math.min(...ds),acc=new Map();
    shapes.forEach((f,i)=>{const influence=Math.exp(-Math.max(0,ds[i]-low)/.020);if(influence<.005)return;const pairs=typeof f.weights==='function'?f.weights(p):f.weights;for(const [bone,w]of pairs)acc.set(bone,(acc.get(bone)??0)+w*influence);});
    const pairs=[...acc].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=pairs.reduce((n,a)=>n+a[1],0);return pairs.map(([bone,w])=>[bone,w/sum]);
  };
  const cache=new Map(),source=mc.geometry.getAttribute('position'),base=out.p.length/3,indexStart=out.idx.length;
  for(let i=0;i<mc.count;i++){
    const p=[source.getX(i)*half+centre[0],source.getY(i)*half+centre[1],source.getZ(i)*half+centre[2]],key=p.map(x=>Math.round(x*100000)).join(',');let n=cache.get(key);
    if(n===undefined){
      const point=V(p),q=profileAt(s.body,clamp(p[2],s.body[0][0],s.body.at(-1)[0])),a=Math.atan2(p[0]/q[2],(p[1]-q[1])/q[3]);
      let closest=shapes[0],best=Infinity;for(const f of shapes){const d=distance(f,...p);if(d<best){best=d;closest=f;}}
      n=out.vertex(point,closest.paw?pawCoat(s,point):coat(s,point,a,closest.leg?'leg':'body'),weights(p),[(a+Math.PI)/(2*Math.PI),(p[2]+.70)/1.85]);cache.set(key,n);
    }
    out.idx.push(n);
  }
  const count=out.p.length/3-base,adjacent=Array.from({length:count},()=>new Set());
  for(let i=indexStart;i<out.idx.length;i+=3){const a=out.idx[i]-base,b=out.idx[i+1]-base,c=out.idx[i+2]-base;adjacent[a].add(b).add(c);adjacent[b].add(a).add(c);adjacent[c].add(a).add(b);}
  for(const factor of [.30,-.31]){
    const next=out.p.slice(base*3);
    for(let i=0;i<count;i++)for(let axis=0;axis<3;axis++){
      if(!adjacent[i].size)continue;let sum=0;for(const j of adjacent[i])sum+=out.p[(base+j)*3+axis];const current=out.p[(base+i)*3+axis];next[i*3+axis]=current+factor*(sum/adjacent[i].size-current);
    }
    for(let i=0;i<next.length;i++)out.p[base*3+i]=next[i];
  }
  // Author a small flat contact patch underneath each padded foot. The raised
  // instep unions may otherwise extend a few millimetres through the sole.
  for(let i=base;i<out.p.length/3;i++){
    const y=out.p[i*3+1];if(y>=.012)continue;
    for(const leg of r.legs){
      const pad=pawDesign(s,leg);
      if(Math.abs(out.p[i*3]-leg.paw.x)>pad.halfWidth*1.25||Math.abs(out.p[i*3+2]-leg.paw.z-pad.forward)>pad.halfLength*1.35)continue;
      const t=clamp((y-.003)/.009,0,1);out.p[i*3+1]=Math.max(0,y)*t*t*(3-2*t);
      for(let j=0;j<4;j++){out.si[i*4+j]=j===0?r.index(leg.name+'_Paw'):0;out.sw[i*4+j]=j===0?1:0;}break;
    }
  }
  mc.geometry.dispose();mc.material.dispose();return {triangles:mc.count/3,vertices:cache.size};
}
