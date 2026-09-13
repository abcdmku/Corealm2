import assert from 'node:assert/strict';
import type {Document} from '@gltf-transform/core';

const smooth=(a:number,b:number,x:number)=>{
 const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);
};

/** Long coat panels hang from the pelvis, with limited leg-follow at their hems.
 * Front panels need more swing clearance; back panels retain the seat coverage.
 * This is authored skeletal cloth, not a simulated cloth solver.
 */
export function tailorSkirtWeights(document:Document):number {
 let changed=0;
 for(const node of document.getRoot().listNodes()) {
  if(node.getExtras().itemModelDeform!=='skirt'||!node.getMesh())continue;
  const skin=node.getSkin();assert(skin,'Skirt requires native skin');
  const joints=skin.listJoints(),joint=(name:string)=>{const index=joints.findIndex(j=>j.getName()===name);assert(index>=0,name);return index;};
  const ids=[joint('pelvis'),joint('thigh_l'),joint('thigh_r')];
  for(const primitive of node.getMesh()!.listPrimitives()) {
   const pos=primitive.getAttribute('POSITION')!,indices=primitive.getAttribute('JOINTS_0')!,weights=primitive.getAttribute('WEIGHTS_0')!;
   assert(pos&&indices&&weights,'Skirt requires position and weight attributes');
   const p:number[]=[];
   for(let vertex=0;vertex<pos.getCount();vertex++) {
    pos.getElement(vertex,p);
    const front=smooth(-.075,.085,p[2]!);
    // A raised knee must carry the cloth in front of it. The former broad
    // left/right blend averaged opposing thighs, leaving the cloth behind the
    // knee guard. Keep the rear drape and waist anchored, but let each front
    // half follow its own thigh below the hip seam.
    const kneeFollow=front*(1-smooth(.76,.98,p[1]!));
    const kneeCrest=.14*kneeFollow*Math.exp(-Math.pow((p[1]!-.635)/.11,2));
    const swing=Math.min(.96,(.30+.30*front)*(1-smooth(.34,1.04,p[1]!))+.43*kneeFollow+kneeCrest);
    const oldLeft=smooth(-.20,.20,p[0]!);
    const left=oldLeft+(smooth(-.065,.065,p[0]!)-oldLeft)*front*(1-smooth(.85,1.02,p[1]!));
    indices.setElement(vertex,[...ids,0]);
    weights.setElement(vertex,[1-swing,swing*left,swing*(1-left),0]);
    changed++;
   }
  }
 }
 return changed;
}
