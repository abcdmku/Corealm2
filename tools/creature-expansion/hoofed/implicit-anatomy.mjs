import { BIGHORN_REFINEMENT, bighornRefinedFields, bighornPasternFields } from './bighorn-refinement.mjs';
import { tapirRefinedFields, tapirRefinedDistance, tapirRefinedFaceFields, tapirRefinedLeg, TAPIR_REFINED_EYES } from './tapir-refinement.mjs';
import * as THREE from 'three';
import { MarchingCubes } from '../../../node_modules/three/examples/jsm/objects/MarchingCubes.js';
import { axialDistance, tapirFields } from './tapir-sections.mjs';
import { refineTapirToes } from './refine-tapir-toes.mjs';
import { bighornAnatomy, BIGHORN_LANDMARKS } from './bighorn-anatomy.mjs';

import { HORSE_LANDMARKS, horseAnatomy, horseLeg } from './horse-anatomy.mjs';
import { MOOSE_CONFIG, mooseAnatomy } from './moose-anatomy.mjs';

const clamp=THREE.MathUtils.clamp;
const lerp=THREE.MathUtils.lerp;
const vec=(p)=>new THREE.Vector3(...p);
const maxSmooth=(a,b,k)=>{const h=clamp(.5+.5*(b-a)/k,0,1);return lerp(a,b,h)+k*h*(1-h);};

/** A single watertight anatomical surface, including the leg roots and face.
 * The fields describe anatomical masses and tapered bones; smooth unions erase
 * their internal surfaces before topology is emitted and skinned.
 */
export function implicitAnatomy(s,p,id,coat){
  const horse=id==='marchwild_horse',ram=id==='cairn_bighorn',moose=id==='marsh_moose',tapir=id==='bracken_tapir';
  const shapes=[],cuts=[],toes=[];
  function ell(center,scale,bone,rotation=[0,0,0],blend=.075,weights=null){
    const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));
    const inv=q.clone().invert(),matrix=new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
    const extent=[0,1,2].map(i=>Math.sqrt((matrix[i]*scale[0])**2+(matrix[i+4]*scale[1])**2+(matrix[i+8]*scale[2])**2)+blend*1.8);
    const f={center,scale,q,inv,extent,blend,weights:weights??[[s.rig.index[bone],1]],type:'ell'};shapes.push(f);return f;
  }
  function capsule(a,b,r0,r1,bone,blend=.035,weights=null){
    const direction=vec(b).sub(vec(a)),lengthSq=direction.lengthSq();
    const f={a,b,direction,lengthSq,r0,r1,blend,weights:weights??[[s.rig.index[bone],1]],type:'capsule'};shapes.push(f);return f;
  }
  function cavity(center,scale,rotation=[0,0,0],shade=0x211d19){
    const f=ell(center,scale,'Head',rotation,.010);shapes.pop();f.shade=shade;cuts.push(f);return f;
  }
  if(horse){
    horseAnatomy({ell,capsule,cavity,shapes,s,p});
  }else if(ram){
    shapes.push(...bighornRefinedFields(s.rig));
    for(const side of [-1,1])cavity([side*.067,1.343,1.268],[.015,.013,.023],[0,side*.20,0],p.dark);
  }else if(moose){
    mooseAnatomy({shapes,cavity,s,p});
  }else{
    shapes.push(...tapirRefinedFields(s.rig));
    tapirRefinedFaceFields({ell,cavity});
  }
  for(const leg of s.rig.legs){
    if(tapir){tapirRefinedLeg({ell,capsule,cavity,s,leg,toes,p});continue;}
    if(horse){horseLeg({ell,capsule,s,leg});continue;}
    const tag=leg.tag,hip=leg.hip,knee=leg.knee,ankle=leg.ankle;
    const origin=[hip.x*.72,hip.y-.01,hip.z];
    const muscle=hip.clone().lerp(knee,.34);muscle.x=hip.x*.96;
    const thigh=horse?(leg.front?.125:.179):moose?(leg.front?MOOSE_CONFIG.upperLegRadii.front:MOOSE_CONFIG.upperLegRadii.hind):ram?(leg.front?.085:.119):(leg.front?.104:.128);
    capsule(origin,muscle.toArray(),thigh*.78,thigh,tag+'Hip',ram?.036:moose?MOOSE_CONFIG.upperLegRadii.rootBlend:.072,[[s.rig.index.Body,.23],[s.rig.index[tag+'Hip'],.77]]);
    capsule(muscle.toArray(),knee.toArray(),thigh*.84,p.legR*.52,tag+'Hip',.036);
    ell(knee.toArray(),[p.legR*(tapir?.46:.60),p.legR*(tapir?.60:.72),p.legR*(tapir?.46:.62)],tag+'Knee',[leg.front?-.3:.25,0,0],.023,[[s.rig.index[tag+'Hip'],.42],[s.rig.index[tag+'Knee'],.58]]);
    const shin=knee.clone().lerp(ankle,.73);
    capsule(knee.toArray(),shin.toArray(),p.legR*.45,p.legR*.33,tag+'Knee',.020);
    capsule(shin.toArray(),ankle.toArray(),p.legR*.33,p.legR*.43,tag+'Knee',.020,[[s.rig.index[tag+'Knee'],.76],[s.rig.index[tag+'Ankle'],.24]]);
    if(ram)bighornPasternFields({ell,capsule,s,leg});
    if(tapir){
      // The instep, padded sole and fanned digits belong to this continuous
      // surface. Keratin is confined to each digit's low rounded front tip.
      ell([ankle.x,.158,ankle.z-.009],[.062,.090,.063],tag+'Ankle',[.12,0,0],.028,[[s.rig.index[tag+'Knee'],.25],[s.rig.index[tag+'Foot'],.75]]);
      ell([ankle.x,.085,ankle.z+.021],[leg.front?.078:.073,.062,.098],tag+'Foot',[.07,0,0],.021);
      const digits=[
        {x:0,y:.050,z:.102,r:[.037,.045,.081]},
        {x:-.054,y:.044,z:.083,r:[.029,.038,.069]},
        {x:.055,y:.044,z:.085,r:[.029,.038,.070]},
      ];
      if(leg.front)digits.push({x:leg.side*.101,y:.041,z:.019,r:[.023,.036,.051]});
      for(const digit of digits){
        const center=[ankle.x+digit.x,digit.y,ankle.z+digit.z];
        ell(center,digit.r,tag+'Foot',[.03,0,-digit.x*.7],.009);
        toes.push({center,r:digit.r,foot:s.rig.index[tag+'Foot']});
      }
      for(const side of [-1,1])cavity([ankle.x+side*.027,.064,ankle.z+.175],[.007,.054,.070],[0,0,0],p.dark);
    }
  }
  const eyes=horse?HORSE_LANDMARKS.eyes:ram?BIGHORN_REFINEMENT.eyes:moose?MOOSE_CONFIG.eyes:TAPIR_REFINED_EYES;
  for(const side of [-1,1])cavity([eyes[0]*side,eyes[1],eyes[2]],ram?BIGHORN_REFINEMENT.eyeCavityScale:tapir?[.015,.018,.021]:[.035,.037,.042],[0,0,0],0x403329);
  const center=[0,moose?1.25:1.04,.32],span=moose?3.5:3.2,resolution=moose?132:128;
  const half=span*.5,step=span/resolution,origin=center.map(v=>v-half);
  const mc=new MarchingCubes(resolution,new THREE.MeshStandardMaterial(),false,false,140000);mc.isolation=0;mc.field.fill(-10);
  function distance(f,x,y,z){
    if(f.type==='tapir-section')return tapirRefinedDistance(f,x,y,z);
    if(f.type==='axial')return axialDistance(f,x,y,z);
    if(f.type==='capsule'){
      const dx=x-f.a[0],dy=y-f.a[1],dz=z-f.a[2],a=clamp((dx*f.direction.x+dy*f.direction.y+dz*f.direction.z)/f.lengthSq,0,1);
      return Math.hypot(dx-f.direction.x*a,dy-f.direction.y*a,dz-f.direction.z*a)-lerp(f.r0,f.r1,a);
    }
    const dx=x-f.center[0],dy=y-f.center[1],dz=z-f.center[2],q=f.inv;
    const ix=q.w*dx+q.y*dz-q.z*dy,iy=q.w*dy+q.z*dx-q.x*dz,iz=q.w*dz+q.x*dy-q.y*dx,iw=-q.x*dx-q.y*dy-q.z*dz;
    const px=ix*q.w+iw*-q.x+iy*-q.z-iz*-q.y,py=iy*q.w+iw*-q.y+iz*-q.x-ix*-q.z,pz=iz*q.w+iw*-q.z+ix*-q.y-iy*-q.x;
    const power=f.power??2,k0=(Math.abs(px/f.scale[0])**power+Math.abs(py/f.scale[1])**power+Math.abs(pz/f.scale[2])**power)**(1/power),k1=Math.hypot(px/(f.scale[0]**2),py/(f.scale[1]**2),pz/(f.scale[2]**2));
    return k1<1e-8?-Math.min(...f.scale):k0*(k0-1)/k1;
  }
  function stamp(f,cut=false){
    let low,high;
    if(f.type==='capsule'){const radius=Math.max(f.r0,f.r1)+f.blend*2;low=f.a.map((v,i)=>Math.min(v,f.b[i])-radius);high=f.a.map((v,i)=>Math.max(v,f.b[i])+radius);}
    else {low=f.center.map((v,i)=>v-f.extent[i]);high=f.center.map((v,i)=>v+f.extent[i]);}
    low=low.map((v,i)=>clamp(Math.floor((v-origin[i])/step),1,resolution-2));high=high.map((v,i)=>clamp(Math.ceil((v-origin[i])/step),1,resolution-2));
    for(let z=low[2];z<=high[2];z++)for(let y=low[1];y<=high[1];y++)for(let x=low[0];x<=high[0];x++){
      const index=x+resolution*y+resolution*resolution*z,df=distance(f,origin[0]+step*x,origin[1]+step*y,origin[2]+step*z);
      mc.field[index]=cut?-maxSmooth(-mc.field[index],-df,.008):maxSmooth(mc.field[index],-df,f.blend);
    }
  }
  for(const shape of shapes)stamp(shape);for(const cut of cuts)stamp(cut,true);
  if(tapir){
    const lastY=Math.min(resolution-2,Math.ceil((.018-origin[1])/step));
    for(let z=1;z<resolution-1;z++)for(let y=1;y<=lastY;y++)for(let x=1;x<resolution-1;x++){
      const index=x+resolution*y+resolution*resolution*z;
      mc.field[index]=Math.min(mc.field[index],origin[1]+y*step-.002);
    }
  }
  mc.update();
  const vertices=[],indices=[],uv=[],cache=new Map(),source=mc.geometry.getAttribute('position');
  for(let i=0;i<mc.count;i++){
    const point=[source.getX(i)*half+center[0],source.getY(i)*half+center[1],source.getZ(i)*half+center[2]];
    const key=point.map(v=>Math.round(v*100000)).join(',');let n=cache.get(key);
    if(n===undefined){n=vertices.length;cache.set(key,n);vertices.push(point);uv.push((Math.atan2(point[0],point[2]-.2)/Math.PI+1)*.5,point[1]/(moose?2.5:2.3));}
    indices.push(n);
  }
  // Remove grid-scale curvature changes while retaining the authored volume.
  const neighbours=vertices.map(()=>new Set());
  for(let i=0;i<indices.length;i+=3){const a=indices[i],b=indices[i+1],c=indices[i+2];neighbours[a].add(b).add(c);neighbours[b].add(a).add(c);neighbours[c].add(a).add(b);}
  for(const strength of [.40,-.38,.40,-.38]){
    const next=vertices.map((v,i)=>{
      if(!neighbours[i].size)return v;
      const average=[0,0,0];for(const n of neighbours[i])for(let axis=0;axis<3;axis++)average[axis]+=vertices[n][axis];
      return v.map((value,axis)=>value+strength*(average[axis]/neighbours[i].size-value));
    });
    next.forEach((v,i)=>{vertices[i]=v;});
  }
  if(tapir){
    const field=(x,y,z)=>{
      let value=-10;
      for(const shape of shapes)value=maxSmooth(value,-distance(shape,x,y,z),shape.blend);
      for(const cut of cuts)value=-maxSmooth(-value,-distance(cut,x,y,z),.008);
      return Math.min(value,y-.002);
    };
    refineTapirToes(vertices,indices,uv,field,s.rig.legs.map(leg=>({x:leg.ankle.x,z:leg.ankle.z})));
  }
  if(tapir)for(const point of vertices)if(point[1]<.032){
    const t=clamp((point[1]-.011)/.021,0,1);
    point[1]=.001+.072*t*t-.041*t*t*t;
  }
  const weights=point=>{
    let min=Infinity;const ds=shapes.map(f=>{const d=distance(f,...point);min=Math.min(min,d);return d;});
    const map=new Map();
    shapes.forEach((f,i)=>{const influence=Math.exp(-Math.max(0,ds[i]-min)/.035);if(influence<.005)return;for(const [index,w]of f.weights)map.set(index,(map.get(index)??0)+w*influence);});
    if(tapir&&point[1]<.235){
      let closest=s.rig.legs[0],best=Infinity;
      for(const leg of s.rig.legs){const d=(point[0]-leg.ankle.x)**2+(point[2]-leg.ankle.z-.045)**2;if(d<best){closest=leg;best=d;}}
      const raw=clamp((point[1]-.120)/(.235-.120),0,1),shin=raw*raw*(3-2*raw),total=[...map.values()].reduce((a,b)=>a+b,0);
      for(const [bone,weight]of map)map.set(bone,weight/total*shin);
      const foot=s.rig.index[closest.tag+'Foot'];map.set(foot,(map.get(foot)??0)+1-shin);
    }
    const ranked=[...map].sort((a,b)=>b[1]-a[1]).slice(0,4),total=ranked.reduce((v,a)=>v+a[1],0);return ranked.map(([a,b])=>[a,b/total]);
  };
  const nailAmount=point=>{
    if(!tapir||point[1]>.095)return 0;
    let amount=0;
    for(const toe of toes){
      const [x,y,z]=point,dx=(x-toe.center[0])/(toe.r[0]*1.12),dy=(y-toe.center[1])/toe.r[1];
      if(dx*dx+dy*dy>1.45)continue;
      const edge=toe.center[2]+toe.r[2]*.27;
      amount=Math.max(amount,clamp((z-edge)/.018,0,1)*(1-clamp((y-.068)/.020,0,1)));
    }
    return amount;
  };
  const color=point=>{
    const [x,y,z]=point;let c=coat(point);
    const grain=.014*Math.sin(x*91+z*43+y*23)*Math.sin(y*79-z*37)+.006*Math.sin(z*143+y*137);
    c.multiplyScalar(1+grain);
    if(horse){
      const muzzle=clamp((z-1.48)/.20,0,1)*.65;c.lerp(new THREE.Color(0x4e443d),muzzle);
      const sock=(1-clamp((y-.27)/.20,0,1))*.43;c.lerp(new THREE.Color(p.dark),sock);
      const width=.020+.006*Math.sin(z*32),blaze=(1-clamp((Math.abs(x)-width*.60)/(width*.65),0,1))*clamp((z-1.20)/.08,0,1)*(1-clamp((z-1.54)/.10,0,1))*clamp((y-(2.18-.85*(z-1.18)))/.055,0,1);
      c.lerp(new THREE.Color(0xd6c4a1),blaze*.86);
    }
    for(const cut of cuts){const d=distance(cut,...point);if(d<.012)c.lerp(new THREE.Color(cut.shade),clamp((.015-d)/.025,.25,.88));}
    if(tapir)c.lerp(new THREE.Color(0x181c19),nailAmount(point)*.92);
    return c;
  };
  const groups=[[],[],[]];
  const keratinEdges=new Map();
  const splitKeratin=(triangle,inside)=>{
    const result=[];
    for(let i=0;i<triangle.length;i++){
      const a=triangle[i],b=triangle[(i+1)%triangle.length],da=nailAmount(vertices[a])-.52,db=nailAmount(vertices[b])-.52;
      const takeA=inside?da>=0:da<0,takeB=inside?db>=0:db<0;
      if(takeA)result.push(a);
      if(takeA!==takeB){
        const key=a<b?`${a},${b}`:`${b},${a}`;let index=keratinEdges.get(key);
        if(index===undefined){
          const t=da/(da-db),point=vertices[a].map((value,axis)=>lerp(value,vertices[b][axis],t));
          index=vertices.length;vertices.push(point);uv.push(lerp(uv[a*2],uv[b*2],t),lerp(uv[a*2+1],uv[b*2+1],t));keratinEdges.set(key,index);
        }
        result.push(index);
      }
    }
    return result;
  };
  for(let i=0;i<indices.length;i+=3){
    const a=vertices[indices[i]],b=vertices[indices[i+1]],c=vertices[indices[i+2]],z=(a[2]+b[2]+c[2])/3,y=(a[1]+b[1]+c[1])/3;
    const skin=horse?z>1.53&&y<1.88:ram?z>1.21:moose?z>MOOSE_CONFIG.muzzleSkin.minZ&&y<MOOSE_CONFIG.muzzleSkin.maxY:z>1.255;
    if(tapir&&y<.13){
      const triangle=[indices[i],indices[i+1],indices[i+2]],amounts=triangle.map(index=>nailAmount(vertices[index])-.52);
      if(amounts.some(v=>v>=0)&&amounts.some(v=>v<0)){
        for(const inside of [false,true]){const polygon=splitKeratin(triangle,inside);for(let j=1;j<polygon.length-1;j++)groups[inside?2:0].push(polygon[0],polygon[j],polygon[j+1]);}
        continue;
      }
    }
    const nail=tapir&&nailAmount([(a[0]+b[0]+c[0])/3,y,z])>.52;
    groups[nail?2:skin?1:0].push(indices[i],indices[i+1],indices[i+2]);
  }
  groups.forEach((faces,group)=>{
    if(!faces.length)return;
    const map=new Map(),points=[],tex=[],facesRemapped=[];
    for(const index of faces){let local=map.get(index);if(local===undefined){local=points.length;map.set(index,local);points.push(vertices[index]);tex.push(uv[index*2],uv[index*2+1]);}facesRemapped.push(local);}
    s.add(points,facesRemapped,'Body',color,group===2?1:group===1?5:0,weights,tex);
  });
  mc.geometry.dispose();mc.material.dispose();
  return {eyes,bodyTriangles:indices.length/3};
}
