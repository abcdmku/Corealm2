import * as THREE from 'three';
import { axialField } from './tapir-sections.mjs';

// Original authored proportions informed by UMN Extension's conformation guide:
// https://extension.umn.edu/agriculture/animals-and-livestock/horse/conformation-of-the-horse
// NPS field photographs: https://www.nps.gov/asis/learn/nature/horses.htm
// Coordinates are artistic targets, not measurements of a particular horse.
export const HORSE_LANDMARKS = Object.freeze({
  eyes: [.148, 2.064, 1.257],
  neck: [0, 1.54, .67], head: [0, 2.04, 1.16],
  earBase: [.108, 2.196, 1.105], earCenter: [.134, 2.315, 1.097],
  earTip: [.161, 2.428, 1.079], tail: [0, 1.49, -1.01],
});

// Retain clip timing and stride. Straighten the fore column and give the hind
// hock a rearward point. For horse ONLY, use pole [0,0,-1] on both leg pairs.
export const HORSE_PROFILE_PATCH = Object.freeze({
  width: .355, legX: .255, front: .665, rear: -.725, hipY: 1.40,
  kneeY: .745, kneeFront: .665, kneeRear: -.835,
  ankle: .16, ankleFront: .695, ankleRear: -.760, legR: .098,
});

export function horseAnatomy({ ell, capsule, cavity, shapes, s, p }) {
  const bone = s.rig.index;
  const plane = (c, r, name, rotation = [0, 0, 0], blend = .021, weights) => {
    const f = ell(c, r, name, rotation, blend, weights); f.power = 2.45; return f;
  };
  // One axial barrel controls the loin, rib basket, girth and brisket contour.
  // The shoulder is deepest; the flank rises and the croup slopes to the dock.
  shapes.push(axialField([
    [-1.095,1.435,.008,.012],[-.98,1.421,.214,.230],[-.79,1.420,.332,.300],
    [-.57,1.409,.322,.286],[-.35,1.385,.287,.250],[-.13,1.354,.309,.276],
    [.12,1.347,.343,.304],[.35,1.367,.332,.337],[.55,1.373,.286,.357],
    [.72,1.382,.206,.299],[.81,1.418,.083,.190],[.86,1.446,.006,.016],
  ], 'Body', s.rig, .025));
  plane([0,1.684,.385],[.145,.118,.305],'Body',[-.14,0,0],.022);
  plane([0,1.563,.711],[.193,.353,.229],'Neck',[.43,0,0],.032,
    [[bone.Body,.22],[bone.Neck,.78]]);
  plane([0,1.924,.926],[.136,.320,.167],'Neck',[.48,0,0],.026);
  for (const side of [-1, 1]) {
    plane([side*.245,1.394,.482],[.075,.270,.205],'Body',[-.36,0,side*.06]);
    plane([side*.239,1.303,-.768],[.109,.285,.188],`Hind${side<0?'L':'R'}Hip`,[.22,0,0],.028,
      [[bone.Body,.32],[bone[`Hind${side<0?'L':'R'}Hip`],.68]]);
  }
  // Forehead, straight nasal bridge and contracted muzzle are one profile.
  shapes.push(axialField([
    [.988,2.078,.008,.015],[1.079,2.074,.118,.132],[1.193,2.057,.142,.149],
    [1.300,1.988,.115,.136],[1.421,1.892,.093,.098],
    [1.565,1.781,.104,.074],[1.660,1.741,.111,.070],[1.716,1.740,.067,.057],
    [1.741,1.742,.006,.014],
  ], 'Head', s.rig, .017));
  plane([0,1.870,1.286],[.103,.109,.172],'Head',[.38,0,0],.019);
  plane([0,1.730,1.567],[.091,.041,.137],'Jaw',[.18,0,0],.010,
    [[bone.Head,.45],[bone.Jaw,.55]]);
  for (const side of [-1,1]) {
    cavity([side*.096,1.764,1.682],[.025,.020,.037],[.15,side*.25,0],p.dark);
  }
  return HORSE_LANDMARKS;
}

// Called instead of the generic leg block. Long narrow cannon bones and a
// small fetlock replace the repeated capsules and terminal swelling.
export function horseLeg({ ell, capsule, s, leg }) {
  const {hip,knee,ankle,tag,front} = leg, b = s.rig.index;
  const blend = [[b.Body,.18],[b[tag+'Hip'],.82]];
  const mid = hip.clone().lerp(knee,front?.39:.32);
  capsule([hip.x*.87,hip.y,hip.z],mid.toArray(),front?.100:.128,front?.077:.106,tag+'Hip',.029,blend);
  capsule(mid.toArray(),knee.toArray(),front?.077:.097,.043,tag+'Hip',.019);
  const joint=ell(knee.toArray(),[.049,.061,front?.045:.058],tag+'Knee',[0,0,0],.011,
    [[b[tag+'Hip'],.38],[b[tag+'Knee'],.62]]); joint.power=2.5;
  const fetlock=[ankle.x,.245,ankle.z-.033];
  capsule(knee.toArray(),fetlock,.034,.030,tag+'Knee',.010);
  const knot=ell(fetlock,[.037,.045,.040],tag+'Knee',[.25,0,0],.009);knot.power=2.25;
  capsule(fetlock,[ankle.x,.132,ankle.z+.018],.031,.036,tag+'Ankle',.009,
    [[b[tag+'Ankle'],.40],[b[tag+'Foot'],.60]]);
}

export function horseHoof(s, leg, p) {
  // A closed low wall with a sloping toe, rounded quarters and flat sole.
  // Hind hoof is narrower. No circular cuff sits around the pastern.
  const xscale=leg.front?1:.91, outline=[[-.046,-.040],[-.068,-.010],[-.070,.041],[-.049,.091],[-.021,.110],[.021,.110],[.049,.091],[.070,.041],[.068,-.010],[.046,-.040]];
  const sections=[{y:.134,w:.65,l:.60,z:-.020},{y:.085,w:.90,l:.83,z:-.006},{y:.002,w:1,l:1,z:0}];
  const points=[],indices=[],uv=[];
  for(const row of sections)for(const [x,z] of outline){points.push([leg.ankle.x+x*xscale*row.w,row.y,leg.ankle.z+z*row.l+row.z]);uv.push((x+.075)/.15,row.y/.134);}
  for(let row=0;row<2;row++)for(let k=0;k<10;k++){const a=row*10+k,c=a+10,d=row*10+(k+1)%10+10,b=row*10+(k+1)%10;indices.push(a,c,b,b,c,d);}
  for(let k=1;k<9;k++){indices.push(0,k,k+1,20,20+k+1,20+k);}
  s.add(points,indices,leg.tag+'Foot',point=>new THREE.Color(p.dark).multiplyScalar(.83+.11*point[1]/.134),1,null,uv);
}

export function horseHair(s,p) {
  const tone=i=>new THREE.Color(p.dark).multiplyScalar(.73+.19*(.5+.5*Math.sin(i*2.71)));
  // Fine overlapping locks follow the crest and hang to one side. Unequal tips
  // make a continuous shaggy edge rather than the former row of broad leaves.
  for(let i=0;i<52;i++){
    const t=i/51,z=1.100-t*.75,y=2.193-t*.565,drop=.135+.037*Math.sin(i*2.31),x=.016;
    s.loft([[x,y,z,.010,.008],[.063,y-.045,z-.021,.010,.007],[.096,y-drop*.67,z-.049,.007,.005],[.091,y-drop,z-.067,.001,.001]],'Neck',tone(i),{rings:12,sides:7});
  }
  for(let i=0;i<17;i++){
    const t=i/16,x=(t-.5)*.17;
    s.loft([[x,2.190,1.128,.008,.006],[x*.92,2.165,1.210,.009,.006],[x*.83+.015,2.078-.027*Math.sin(i),1.266,.001,.001]],'Head',tone(i),{rings:10,sides:7});
  }
  // Dock and 42 narrow locks share the Tail -> TailTip skeleton. Roots overlap;
  // the lower contour breaks into tapered ends without ribbon-width fins.
  s.loft([[0,1.49,-1.010,.056,.052],[0,1.36,-1.118,.052,.046],[0,1.23,-1.18,.029,.027]],'Tail',p.coat,{rings:14,sides:12});
  for(let i=0;i<42;i++){
    const a=i*2.399963,r=.025+.036*((i%7)/6),x=Math.sin(a)*r,z=Math.cos(a)*r;
    const length=.68+.13*(.5+.5*Math.sin(i*1.41));
    s.loft([[x,1.39,-1.100+z,.011,.010],[x*1.16,1.14,-1.205+z,.014,.012],[x*1.22,.82,-1.298+z,.011,.009],[x*.80,1.37-length,-1.304+z,.001,.001]],'Tail',tone(i),{rings:18,sides:7,weights:point=>{const t=THREE.MathUtils.smoothstep(1.32-point[1],0,.40);return [[s.rig.index.Tail,1-t],[s.rig.index.TailTip,t]];}});
  }
}

/* Integration, horse branch only:
 * implicit-anatomy imports horseAnatomy/horseLeg/HORSE_LANDMARKS. Replace the
 * old if(horse) masses with horseAnatomy({ell,capsule,cavity,shapes,s,p}); at
 * start of generic leg loop: if(horse){horseLeg({ell,capsule,s,leg});continue;}
 * Use HORSE_LANDMARKS.eyes in the shared eye-cavity expression.
 * hoofed.mjs merges HORSE_PROFILE_PATCH into horse profile before skeleton;
 * horse hind and fore IK poles use [0,0,-1]. Replace horse hoof loop with
 * horseHoof(s,leg,p);continue. Replace horseDetail calls with horseHair(s,p).
 * Use landmarks for ear base/center/tip. Existing ear bones remain compatible.
 * Do not change the other species, shared clip names or clip timings.
 * Candidate build, whole-skinned pose/contact audit and production hardware
 * screenshots remain required. This module alone is not acceptance evidence.
 */
