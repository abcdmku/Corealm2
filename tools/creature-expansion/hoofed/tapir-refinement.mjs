import * as THREE from 'three';
import { axialField } from './tapir-sections.mjs';

/** Isolated revision proposal. No generator imports this file until integration.
 * Reference: https://animals.sandiegozoo.org/animals/tapir
 * Small eyes/ears, a rear-heavy teardrop body, flexible short proboscis, short
 * bristly coat and four fore/three hind digits inform this authored anatomy.
 * The pale saddle identifies a Malayan-inspired adult. Dimensions below are
 * artistic measurements, not measurements asserted by the reference.
 *
 * Integration, preserving all profile pivots, animation and sole processing:
 * 1. implicit-anatomy.mjs: import tapirRefinedFields, tapirRefinedDistance,
 *    tapirRefinedFaceFields, tapirRefinedLeg, TAPIR_REFINED_EYES.
 *    Replace the entire tapir body/jaw/nostril branch with
 *      shapes.push(...tapirRefinedFields(s.rig));
 *      tapirRefinedFaceFields({ell,cavity});
 *    At the top of the leg loop, before generic leg fields, add
 *      if(tapir){tapirRefinedLeg({ell,capsule,cavity,s,leg,toes,p});continue;}
 *    Select TAPIR_REFINED_EYES for the tapir eyes constant. In the eye cavity
 *    loop use [0.015,0.018,0.021] for tapir instead of generic cavity radii.
 *    At the start of distance add
 *      if(f.type==='tapir-section')return tapirRefinedDistance(f,x,y,z);
 *    Preserve nail splitting, refineTapirToes, plantar flattening and weights.
 *    Move tapir muzzle material threshold from z>1.365 to z>1.255.
 * 2. hoofed.mjs: import tapirRefinedCoat, tapirRefinedEar, tapirRefinedEye,
 *    applyTapirRefinedMaterials. Return tapirRefinedCoat(p) immediately for
 *    tapir in coatColor. At the start of anatomy's eye loop, before the generic
 *    eye shapes: if(tapir){tapirRefinedEye(s,side,color);
 *    tapirRefinedEar(s,side,p);continue;}
 *    Call applyTapirRefinedMaterials(mats) after all existing material setup.
 * 3. Rebuild a NEW candidate revision; never overwrite the frozen accepted
 *    direction bytes. Audit every clip and view front/side/rear/normal gameplay,
 *    plus real approach, turn, hit, attack, death and respawn in production lab.
 */

const clamp=THREE.MathUtils.clamp;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const color=hex=>new THREE.Color(hex);
export const TAPIR_REFINED_EYES=Object.freeze([.137,.988,1.035]);

// Rows describe z, center y, half width and half height. The pelvis sits above
// the shoulder, the flank narrows ahead of the rump, and the belly has a sag.
// Neck is short and deep; cheek is broad before the short, downturned snout.
export function tapirRefinedFields(rig){
  const field=(rows,bone,blend,power=2)=>Object.assign(axialField(rows,bone,rig,blend),{type:'tapir-section',power});
  return [
    field([[-.97,.80,.005,.006],[-.89,.79,.17,.20],[-.72,.81,.325,.285],[-.57,.805,.359,.302],[-.38,.765,.345,.282],[-.17,.742,.319,.278],[.05,.748,.296,.277],[.25,.779,.267,.255],[.43,.817,.246,.239],[.57,.841,.194,.193],[.69,.866,.108,.123],[.74,.881,.007,.009]],'Body',.024),
    field([[.47,.848,.109,.151],[.60,.882,.173,.177],[.73,.919,.167,.155],[.85,.95,.131,.126],[.94,.964,.060,.062],[.98,.96,.004,.006]],'Neck',.020),
    field([[.79,.96,.006,.009],[.88,.972,.125,.119],[.99,.964,.152,.123],[1.075,.938,.127,.102],[1.15,.908,.096,.072],[1.215,.877,.075,.052],[1.255,.851,.055,.044],[1.29,.834,.034,.031],[1.306,.833,.004,.006]],'Head',.017,2.05),
    field([[1.23,.867,.035,.033],[1.271,.831,.047,.041],[1.298,.804,.037,.034],[1.316,.796,.007,.009]],'Nose',.010,2.05),
  ];
}

/** Same bounding protocol as axialField, with rounder cross sections. */
export function tapirRefinedDistance(f,x,y,z){
  const rows=f.rows,zz=clamp(z,rows[0][0],rows.at(-1)[0]);
  let i=0;while(i<rows.length-2&&rows[i+1][0]<zz)i++;
  const a=rows[i],b=rows[i+1],prev=rows[Math.max(0,i-1)],next=rows[Math.min(rows.length-1,i+2)],h=b[0]-a[0],t=(zz-a[0])/h;
  const sample=k=>{const m0=(b[k]-prev[k])/(b[0]-prev[0]),m1=(next[k]-a[k])/(next[0]-a[0]);return (2*t**3-3*t*t+1)*a[k]+(t**3-2*t*t+t)*h*m0+(-2*t**3+3*t*t)*b[k]+(t**3-t*t)*h*m1;};
  const cy=sample(1),w=Math.max(.004,sample(2)),height=Math.max(.004,sample(3)),q=(Math.abs(x/w)**f.power+Math.abs((y-cy)/height)**f.power)**(1/f.power);
  const radial=(q-1)*Math.min(w,height),end=Math.abs(z-zz);
  return end>0?Math.hypot(Math.max(0,radial),end):radial;
}

export function tapirRefinedFaceFields({ell,cavity}){
  ell([0,.862,1.109],[.083,.034,.105],'Jaw',[.10,0,0],.008).power=2.25;
  for(const side of [-1,1])cavity([side*.025,.806,1.302],[.009,.008,.013],[.10,side*.12,0]);
}

/** Continuous shins and padded soles. Only shallow terminal clefts separate
 * the digits; the small outer fore digit no longer forms an isolated ball. */
export function tapirRefinedLeg({ell,capsule,cavity,s,leg,toes,p}){
  const {tag,hip,knee,ankle,front,side}=leg,index=s.rig.index;
  const muscle=hip.clone().lerp(knee,.29);muscle.x=hip.x*.93;
  const upper=front?.086:.113;
  capsule([hip.x*.69,hip.y+.035,hip.z],muscle.toArray(),upper*.82,upper,tag+'Hip',.038,[[index.Body,.25],[index[tag+'Hip'],.75]]);
  capsule(muscle.toArray(),knee.toArray(),upper*.91,.050,tag+'Hip',.025);
  ell(knee.toArray(),[.047,.055,.050],tag+'Knee',[front?-.18:.18,0,0],.014,[[index[tag+'Hip'],.42],[index[tag+'Knee'],.58]]);
  const shin=knee.clone().lerp(ankle,.72);
  capsule(knee.toArray(),shin.toArray(),.044,.036,tag+'Knee',.012);
  capsule(shin.toArray(),ankle.toArray(),.036,.043,tag+'Knee',.012,[[index[tag+'Knee'],.76],[index[tag+'Ankle'],.24]]);
  ell([ankle.x,.132,ankle.z+.006],[.050,.075,.055],tag+'Ankle',[.10,0,0],.019,[[index[tag+'Knee'],.25],[index[tag+'Foot'],.75]]);
  ell([ankle.x,.067,ankle.z+.035],[front?.074:.070,.053,.086],tag+'Foot',[.03,0,0],.020).power=2.45;
  const digits=[{x:0,y:.036,z:.097,r:[.033,.035,.066]},
    {x:-.048,y:.033,z:.082,r:[.025,.032,.060]},
    {x:.048,y:.033,z:.082,r:[.025,.032,.060]}];
  if(front)digits.push({x:side*.074,y:.034,z:.031,r:[.024,.030,.044]});
  for(const digit of digits){
    const center=[ankle.x+digit.x,digit.y,ankle.z+digit.z];
    ell(center,digit.r,tag+'Foot',[.02,0,0],.013).power=2.45;
    toes.push({center,r:digit.r,foot:index[tag+'Foot']});
  }
  for(const sign of [-1,1])cavity([ankle.x+sign*.025,.043,ankle.z+.153],[.004,.032,.027],[0,0,0],p.dark);
}

export function tapirRefinedCoat(){
  const dark=color(0x30312f),pale=color(0xbfc1b6),mud=color(0x56564b);
  return ([x,y,z])=>{
    // Fur boundaries follow the shoulder and haunch rather than a rectangle.
    const front=.26+.075*smooth(.56,1.04,y)-.045*smooth(.16,.32,Math.abs(x));
    const rear=-.78+.11*(1-smooth(.55,1.06,y));
    const saddle=smooth(rear-.022,rear+.026,z)*(1-smooth(front-.022,front+.022,z))*smooth(.48,.62,y);
    const c=dark.clone().lerp(pale,saddle);
    const grain=.018*Math.sin(x*207+z*133)*Math.sin(y*191-z*97)+.011*Math.sin(x*53+y*67+z*49);
    c.multiplyScalar(1+grain);
    c.lerp(mud,(1-smooth(.02,.24,y))*.13);
    return c;
  };
}

/** Small partly buried eyes, with a continuous upper/lower eyelid. */
export function tapirRefinedEye(s,side,coat){
  const [x,y,z]=TAPIR_REFINED_EYES;
  s.oval([side*(x-.007),y,z],[.010,.010,.013],'Head',0x101412,{rings:10,sides:16,material:3});
  const lid=[];
  for(let i=0;i<=24;i++){
    const a=i/24*Math.PI*2;
    lid.push([side*(x-.002+.002*Math.sin(a)),y+Math.sin(a)*.012,z+Math.cos(a)*.016,.0028,.0032]);
  }
  s.loft(lid,'Head',coat,{rings:32,sides:8,axis:[1,0,0],material:5});
}

/** Thick-based cupped ear with a rounded crown. Pale fringe only crosses the
 * upper edge, leaving the root dark. This avoids circular white eyelet ears. */
export function tapirRefinedEar(s,side,palette){
  const bone=side<0?'EarL':'EarR',segments=32,rings=9,points=[],indices=[],uv=[],rim=[],yaw=side*.52;
  s.loft([[side*.100,1.010,.940,.031,.028],[side*.123,1.050,.927,.029,.023]],bone,palette.coat,{rings:10,sides:16});
  for(const back of [false,true])for(let j=0;j<=rings;j++)for(let k=0;k<segments;k++){
    const r=Math.max(.001,j/rings),a=k/segments*Math.PI*2;
    const xx=Math.sin(a)*r*.036*(1+.12*Math.cos(a)),yy=Math.cos(a)*r*.046;
    const depth=(back?-.008:.003)+.010*r**3;
    points.push([side*.127+xx*Math.cos(yaw)+depth*Math.sin(yaw)+side*yy*.24,1.078+yy,.925-xx*Math.sin(yaw)+depth*Math.cos(yaw)]);
    uv.push(k/segments,j/rings);
    rim.push(smooth(.89,1,r)*smooth(-.10,.35,Math.cos(a))*(back?.65:1));
  }
  const sheet=(rings+1)*segments;
  for(let f=0;f<2;f++)for(let j=0;j<rings;j++)for(let k=0;k<segments;k++){
    const a=f*sheet+j*segments+k,b=f*sheet+j*segments+(k+1)%segments,c=a+segments,d=b+segments;
    if(f)indices.push(a,c,b,b,c,d);else indices.push(a,b,c,b,d,c);
  }
  for(let k=0;k<segments;k++){const a=rings*segments+k,b=rings*segments+(k+1)%segments;indices.push(a,a+sheet,b,b,a+sheet,b+sheet);}
  s.add(points,indices,bone,(_p,i)=>color(i<sheet?0x353933:0x343632).lerp(color(0xa9ada0),rim[i]*.8),4,undefined,uv);
}

export function applyTapirRefinedMaterials(materials){
  materials[0].roughness=.94;materials[0].normalScale?.set(.13,.13);
  // The existing map is tan and would tint the gray-white vertex saddle.
  materials[0].map=null;
  materials[1].roughness=.84;
  materials[3].roughness=.43;
  materials[4].roughness=.97;
  materials[5].roughness=.91;
}
