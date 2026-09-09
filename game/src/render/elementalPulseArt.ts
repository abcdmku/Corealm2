import type { ElementalSpellId } from "../content/elementalSpells.js";

/** Contact recipes change silhouette and motion, not combat radius or damage. */
export interface PulseArt {
  name: string;
  width: number;
  depth: number;
  lift: number;
  bend: number;
  arc: number;
  lobes: number;
  yaw: number;
}
const recipe = (name:string,width:number,depth:number,lift:number,bend:number,arc:number,lobes:number,yaw:number):PulseArt =>
  ({name,width,depth,lift,bend,arc,lobes,yaw});

// Deliberate alternating silhouettes: fan, folded hook, split crown, low skirt,
// tall plume and side spill. Every simultaneous group receives different recipes.
const contacts: readonly PulseArt[] = [
  recipe("swept-fan",1.25,.68,.72,-.72,.68,3,-.55),
  recipe("folded-hook",.78,1.18,1.3,.95,.83,2,.72),
  recipe("split-crown",1.05,.91,1.05,-.28,.56,5,-.18),
  recipe("low-skirt",1.32,1.08,.56,.58,.92,4,1.12),
  recipe("rising-plume",.73,.84,1.48,-.9,.61,3,-1.05),
  recipe("side-spill",1.13,.74,.92,.38,.76,6,.34),
  recipe("forked-roll",.91,1.24,1.18,-.52,.64,2,-.82),
  recipe("broken-collar",1.21,.89,.82,.81,.87,5,.91),
  recipe("twisted-spray",.85,1.11,1.37,.21,.73,4,-.37),
  recipe("wide-collapse",1.28,1.02,.65,-.37,.95,6,.15),
  recipe("curling-tail",.96,.77,1.24,.67,.58,3,1.38),
  recipe("divided-front",1.09,1.17,.94,-.83,.81,4,-1.32),
];
const offsets: Partial<Record<ElementalSpellId,number>> = {
  "razor-crescent":0,"thunder-lance":3,"skybreaker":6,
  "waterjet":1,"tidal-fan":0,"geyser-chain":2,"undertow":6,"deluge":3,
  "faultline":4,"basalt-jaw":1,"mountainfall":0,
  "ember-dart":3,"furnace-whip":2,"phoenix-pass":0,"starfall":1,
};
export function elementalPulseArt(spell:ElementalSpellId,index:number):PulseArt {
  return contacts[(index+(offsets[spell]??0))%contacts.length]!;
}
