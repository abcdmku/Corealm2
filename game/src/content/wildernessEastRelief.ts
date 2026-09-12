import type { LavaChannel } from './wildernessLava.js';
import type { LavaRockMass } from '../world/lavaLandforms.js';

/** Authored volcanic shoulders in the unoccupied eastern gaps. The existing weathered
 * landform sampler owns their height, and the same channel cuts their lower slopes. */
export const WILDERNESS_EAST_ROCK_MASSES: Readonly<Record<string, readonly LavaRockMass[]>> = {
  'ashwind-cleft': [
    { id:'ashwind-west-ridge', crown:25, weathered:true,
      polygon:[[476,657],[486,649],[503,653],[510,666],[504,682],[493,690],[481,682],[475,670]] },
    { id:'ashwind-north-shoulder', crown:27, weathered:true,
      polygon:[[495,709],[506,699],[520,706],[533,721],[529,740],[514,748],[500,741],[490,727]] },
  ],
  'far-cinder-fissure': [
    { id:'far-cinder-coastal-ridge', crown:23, weathered:true,
      polygon:[[693,548],[704,551],[712,569],[708,591],[698,602],[687,593],[689,576]] },
  ],
  'nightglass-east-flow': [
    { id:'nightglass-coastal-shoulder', crown:28, weathered:true,
      polygon:[[696,715],[710,711],[721,726],[719,744],[707,760],[698,751],[701,733]] },
  ],
  'starless-west-rift': [
    { id:'starless-western-uplift', crown:26, weathered:true,
      polygon:[[365,874],[378,866],[389,877],[393,895],[383,908],[366,911],[355,898],[356,884]] },
    { id:'starless-northern-spur', crown:25, weathered:true,
      polygon:[[421,892],[434,898],[441,915],[435,932],[423,942],[413,932],[421,916],[414,904]] },
  ],
};

/** Add to the canonical WILDERNESS_LAVA_CHANNELS list, so terrain, renderer,
 * scatter, encounter placement and navigation all receive the same coordinates.
 * Bed heights descend along each flow; no route or resource aisle crosses lava. */
const EASTERN_FLOWS: readonly LavaChannel[] = [
  { id:'ashwind-cleft', points:[[500,680],[514,696],[532,712],[546,735]],
    widths:[1.2,2.8,4.5,3.2], bedHeights:[8.4,7.6,6.8,6.3],
    halfWidth:3.2, depth:2.8, bankWidth:7, seed:12801 },
  { id:'far-cinder-fissure', points:[[690,544],[680,562],[675,580],[664,600]],
    widths:[.8,2.4,3.4,2.3], bedHeights:[8.7,7.9,7.2,6.6],
    halfWidth:2.8, depth:2.8, bankWidth:6, seed:12802 },
  { id:'nightglass-east-flow', points:[[694,702],[679,721],[681,744],[692,762]],
    widths:[1.1,3,4.1,2.5], bedHeights:[9.1,8.1,7.2,6.7],
    halfWidth:3, depth:3, bankWidth:6.5, seed:12803 },
  { id:'starless-west-rift', points:[[390,880],[407,899],[420,916],[404,932]],
    widths:[1.3,3.2,4.4,3], bedHeights:[9.4,8.3,7.1,6.5],
    halfWidth:3.4, depth:3, bankWidth:7, seed:12804 },
];

export const WILDERNESS_EAST_LAVA_CHANNELS: readonly LavaChannel[] = EASTERN_FLOWS.map(channel => ({ ...channel, rugged:true, naturalBanks:true,
  rockMasses:WILDERNESS_EAST_ROCK_MASSES[channel.id] }));
