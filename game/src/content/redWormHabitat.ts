import type { EnemyGroupDef } from './regions.js';
import type { HabitatDef } from './worldHabitats.js';
import { RED_WORM_SPECIES } from './redWorms.js';

const species=RED_WORM_SPECIES[0]!;
/** South wall's eastern grass verge, screen-left when approaching the gate. */
export const RED_WORM_HABITAT: HabitatDef = {
  id:'coldbrace_red_worms_habitat',groupId:'coldbrace_red_worms',regionId:'fallowmarch',
  centre:[-144,-119],radius:7.5,
  anchors:[[-149,-116],[-145.6,-115.5],[-142,-116.2],[-138.5,-117],
    [-148,-119.7],[-144.4,-119.2],[-140.5,-120.2],[-145.6,-122.8]],
  activity:'forage',roamRadius:.35,dressing:[],
};
export const RED_WORM_GROUP: EnemyGroupDef = {
  id:RED_WORM_HABITAT.groupId,family:species.stats.family,name:species.stats.name,tier:1,
  count:8,countPolicy:'fixed',centre:RED_WORM_HABITAT.centre,radius:RED_WORM_HABITAT.radius,
  assetId:species.assetId,scale:species.scale,
};
