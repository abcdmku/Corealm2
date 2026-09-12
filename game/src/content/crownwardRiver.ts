import type { RiverChannel } from '../world/riverChannels.js';

// Layout remains staged until the production river and bridge fixture is accepted.
export const CROWNWARD_RIVER_CHANNELS: readonly RiverChannel[] = [
 { id:'crownmere',kind:'pool',points:[[435,235],[460,228],[485,220],[505,210]],
   widths:[22,38,34,14],halfWidth:36,bedHeights:[-1,-1,-1,-1],depth:2,bankWidth:36,seed:40401,naturalBanks:true,
   lake:{centre:[468,228],radius:82,shape:{seed:40401,irregularity:.6,lobes:4,aspectRatio:.77,rotation:-.3}} },
 { id:'pearlwater',points:[[495,214],[515,200],[535,195],[555,195],[575,195],[610,170],[650,180],[675,180],[690,180],[710,180],[735,164],[756,170],[774,184],[795,180],[820,175],[850,169],[880,178],[910,175]],
   widths:[9,6,4,4,4,5,5,4,4,4,5,6,5,7,10,11,12,13],halfWidth:5,
   bedHeights:[-1,-1,-1.05,-1.1,-1.15,-1.3,-1.8,-2.2,-2.3,-2.4,-2.9,-3.4,-3.9,-4.7,-7.25,-7.25,-7.25,-7.25],
   depth:2,bankWidth:14,seed:40402,openEnds:[true,true],naturalBanks:true,oceanLevel:-5.25 }
];
export const CROWNWARD_RIVER_LAB_CHANNELS: readonly RiverChannel[] = [
 {id:'lab-crownmere',kind:'pool',points:[[-13,-22],[-10,-14],[-8,-4]],widths:[9,12,7],halfWidth:12,bedHeights:[-4,-4,-4],depth:2,bankWidth:6,seed:40401,
   lake:{centre:[-10,-14],radius:20,shape:{seed:40401,irregularity:.6,lobes:4,aspectRatio:.77,rotation:-.3}}},
 {id:'lab-pearlwater',points:[[-8,-8],[-8,0],[-8,12],[-8,24],[-4,37]],widths:[5,4,4,4,5],halfWidth:4,bedHeights:[-4,-4,-4,-4.1,-4.4],depth:2,bankWidth:4,seed:40402,openEnds:[true,true]}
];
export const CROWNWARD_RIVER_BRIDGES = [
 {id:'crownward_kingroad_bridge',centre:[555,195] as const,height:3,rotationY:Math.PI/2},
 {id:'crownward_coast_bridge',centre:[690,180] as const,height:2,rotationY:Math.PI/2},
] as const;
