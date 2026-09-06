/** Species adaptation of the licensed complete rat source. Coordinates are source
 * Blender world units, converted internally to Y-up / nose +Z. No source mutation.
 * The original skin and native action tracks remain the source of motion.
 */
import {Vector3} from 'three';
export const PORCUPINE_REFERENCE = {
  target:'crested porcupine inspired fantasy animal',
  anatomySource:'https://animaldiversity.org/accounts/Hystrix_cristata/',
  anatomyNotes:'Short tail, nape crest, long defensive quills on flanks and rump. Measurements below are authored proportions, not zoological measurements.',
};
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export const canonical=([x,y,z])=>new Vector3(x,z,-y);
export const native=({x,y,z})=>[x,-z,y];
export function adaptSourcePoint(point,meshName,weights=[]){
  const p=canonical(point),old=p.clone();
  // Reshape the complete mesh continuously; keep source toes, shoulder joins and
  // pelvis. A broad barrel supports the coat without a separate overlay body.
  const torso=smooth(.18,.65,p.y)*(1-smooth(1.0,1.5,p.z));
  p.x*=1+.20*torso;
  p.y-=.12*smooth(.55,1.30,p.y)*(1-smooth(.85,1.4,p.z));
  // A short, substantial tail retains the original authored tail topology.
  const tailWeight=weights.filter(([name])=>name.startsWith('Tail')).reduce((n,[,w])=>n+w,0);
  const tail=smooth(.42,.82,-old.z)*tailWeight;
  const distance=Math.max(0,-old.z-.42),blendLength=.40,t=Math.min(1,distance/blendLength);
  const compressed=distance<=blendLength?distance-.82*blendLength*(t*t*t-.5*t*t*t*t):blendLength*.59+(distance-blendLength)*.18;
  p.z+=tailWeight*(distance-compressed);
  p.x*=1+.36*tail;
  p.y=.34+(p.y-.34)*(1-.30*tail);
  if(meshName==='Head'||meshName==='Teeth'||meshName==='Eyes'){
    const jawWeight=weights.filter(([name])=>name==='Backbone.003').reduce((n,[,w])=>n+w,0);
    const jaw=jawWeight;
    // Close the neutral lower jaw around its original authored hinge. Attack
    // clips retain their original animated jaw changes after this rest reshape.
    if(jaw>0){
      const dy=p.y-.5792035,dz=p.z-1.4637687,a=.56*jaw;
      p.y=.5792035+Math.cos(a)*dy+Math.sin(a)*dz;
      p.z=1.4637687-Math.sin(a)*dy+Math.cos(a)*dz;
    }
    // Shorter, fuller muzzle; blend across the head instead of replacing it.
    p.z=1.4276866+(p.z-1.4276866)*.76;
    p.x*=1.08;
    if(meshName==='Head'){
      const ear=smooth(.73,.94,old.y)*smooth(.13,.25,Math.abs(old.x))*(1-smooth(1.72,1.93,old.z));
      p.y=.78+(p.y-.78)*(1-.48*ear);
      const earRoot=Math.sign(p.x)*.22;
      p.x=earRoot+(p.x-earRoot)*(1-.40*ear);
    }
  }
  return native(p);
}
export function coatDescriptor(point,normal,random){
  const p=canonical(point),n=canonical(normal).normalize();
  const tail=p.z<-.48;
  if(p.y<.34||p.z>1.45||n.y<-.12||(!tail&&p.y<.57&&Math.abs(n.x)<.6))return null;
  const crest=!tail&&p.y>.86&&Math.abs(p.x)<.23&&p.z>.05;
  const defensive=!tail&&p.z<.65;
  const long=crest||defensive;
  const length=tail?.20+random()*.20:crest?.50+random()*.60:defensive?.30+random()*.66:.11+random()*.27;
  const direction=n.clone().multiplyScalar(.52).add(new Vector3((random()-.5)*.28,crest?.65:.25,-.72-random()*.25)).normalize();
  return {direction:native(direction),length,radius:long?.009+random()*.009:.004+random()*.005,banded:long,crest,tail};
}
export function seededRandom(seed=192837){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}



