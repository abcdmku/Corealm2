import type { EnemyGroupDef } from './regions.js';
import type { HabitatDef } from './worldHabitats.js';
import { RED_WORM_SPECIES } from './redWorms.js';

const species=RED_WORM_SPECIES[0]!;
/** The narrow verge between the south wall and the two roads joining at its gate. */
export const RED_WORM_HABITAT: HabitatDef = {
  id:'coldbrace_red_worms_habitat',groupId:'coldbrace_red_worms',regionId:'fallowmarch',
  centre:[-144,-113],radius:8,
  anchors:[[-151,-111.5],[-147,-111.7],[-143,-111.8],[-139,-111.9],
    [-149,-114.4],[-145,-114.5],[-141,-114.6],[-137,-114.4]],
  activity:'forage',roamRadius:.35,dressing:[],
};
export const RED_WORM_GROUP: EnemyGroupDef = {
  id:RED_WORM_HABITAT.groupId,family:species.stats.family,name:species.stats.name,tier:1,
  count:8,countPolicy:'fixed',centre:RED_WORM_HABITAT.centre,radius:RED_WORM_HABITAT.radius,
  assetId:species.assetId,scale:species.scale,
};
