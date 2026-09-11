import type { RegionDef, EnemyGroupDef } from './regions.js';
import type { HabitatDef } from './worldHabitats.js';
import { RPG_BESTIARY_BY_ID } from './rpgBestiary.js';
import { CREATURE_REDESIGNS } from './creatureRedesign.js';
import { encounterSetting } from './encounterDressing.js';
import { WILDERNESS_RUIN_SITES, WILDERNESS_RUIN_LANDMARKS, WILDERNESS_RUIN_LOCATIONS } from './wildernessLandmarks.js';
import { WILDERNESS_DEPTH } from './wildernessDepth.js';
import { tierSilhouetteScale } from '../core/math.js';
import { WILDERNESS_RESOURCE_CLUSTERS, WILDERNESS_RESOURCE_LOCATIONS } from './wildernessResources.js';
import { DEEP_WILDERNESS_LANDMARKS, DEEP_WILDERNESS_LOCATIONS, DEEP_WILDERNESS_ROADS, wildernessExpansionGroups } from './wildernessExpansion.js';
import { WILDERNESS_CREATURE_SPECIES } from './wildernessCreatureSpecies.js';
import { WILDERNESS_DRAGONS } from './wildernessDragons.js';

const encounters = [
  ['wilderness_broken_watch','skeleton_soldier',[-240,494],4,12],
  ['wilderness_west_graves','pallid_shade',[-205,570],3,16],
  ['wilderness_dead_boughs','hollow_bough',[-286,638],3,22],
  ['wilderness_lost_procession','wraith',[-100,655],3,22],
  ['wilderness_sunken_bones','grave_ghoul',[-90,527],4,16],
  ['black_keep_gate_guard','skeleton_soldier',[29,565],2,4],
  ['black_keep_gate_archers','skeleton_archer',[52,566],2,4],
  ['black_keep_court_guard','revenant',[40,594],2,4],
  ['black_keep_north_graves','skeleton_mage',[55,657],2,12],
  ['wilderness_east_shades','pallid_shade',[175,530],4,18],
  ['wilderness_petrified_grove','hollow_bough',[255,612],3,23],
  ['wilderness_bone_patrol','skeleton_soldier',[301,514],4,15],
  ['wilderness_lament','banshee',[148,620],2,12],
] as const;

const LEGACY_WILDERNESS_GROUPS: EnemyGroupDef[] = encounters.map(([id,speciesId,centre,count,radius]) => {
  const species = CREATURE_REDESIGNS.find(row=>row.id===speciesId) ?? RPG_BESTIARY_BY_ID.get(speciesId)!;
  return {id,family:species.stats.family,name:species.stats.name,tier:50,
    assetId:species.assetId,scale:species.scale * tierSilhouetteScale(species.stats.tier) / tierSilhouetteScale(50),centre,count,radius};
});
for (const [index, site] of WILDERNESS_RUIN_SITES.entries()) {
  const species = RPG_BESTIARY_BY_ID.get(index % 2 ? 'wraith' : 'skeleton_soldier')!;
  LEGACY_WILDERNESS_GROUPS.push({id:`${site.id}_haunt`,family:species.stats.family,name:species.stats.name,tier:50,
    assetId:species.assetId,scale:species.scale * tierSilhouetteScale(species.stats.tier) / tierSilhouetteScale(50),centre:site.position,count:2,radius:6});
}

export const WILDERNESS_GROUPS: EnemyGroupDef[] = [...LEGACY_WILDERNESS_GROUPS,
  ...wildernessExpansionGroups([...WILDERNESS_CREATURE_SPECIES, ...WILDERNESS_DRAGONS])];

export const WILDERNESS_HABITATS: HabitatDef[] = LEGACY_WILDERNESS_GROUPS.map(group => ({
  id:`${group.id}_habitat`,groupId:group.id,regionId:'wilderness',centre:group.centre,radius:group.radius,
  activity:'patrol',
  dressing: group.id === 'wilderness_west_graves' || group.id === 'black_keep_north_graves'
    ? encounterSetting('wraith', group.centre, group.radius * .3).dressing : [],
  anchors:WILDERNESS_RUIN_SITES.some(site=>`${site.id}_haunt`===group.id)
    ? [-3.5,3.5].map(z => {
      const site=WILDERNESS_RUIN_SITES.find(row=>`${row.id}_haunt`===group.id)!;
      return [site.position[0]+Math.sin(site.rotationY)*z,site.position[1]+Math.cos(site.rotationY)*z] as const;
    })
    : Array.from({length:Math.max(group.count,4)},(_,i)=>{
    const angle=i/Math.max(group.count,4)*Math.PI*2+.3;
    return [group.centre[0]+Math.cos(angle)*group.radius*.6,group.centre[1]+Math.sin(angle)*group.radius*.6] as const;
  }),
}));

/** The final-world terrain/placement exception applies here; actors and castle use the lab first. */
export const WILDERNESS: RegionDef = {
  id:'wilderness',name:'Wilderness',tier:50,
  lore:'Beyond the ashlands, daylight fades over grey plains and broken stone hills. The Black Knight castle watches rivers of fire, gravefields and scorched groves. Farther north the T70 Deep Wilderness opens into violet night, where cold blue fissures wind past dragon roosts and ruined citadels.',
  bounds:{min:[-350,WILDERNESS_DEPTH.south],max:[350,WILDERNESS_DEPTH.north]},terrainSeed:0xdead70,terrainAmplitude:5.5,baseHeight:9,
  groundPalette:['#555961','#7b7e83','#535357','#72767e','#4b4a47','#49464a','#958b80','#b2b4b8'],
  fogStart:125,spawnPoint:[0,482],spawnFacingRad:0,respawnPointId:'emberfast',
  locations:[
    {id:'wilderness_south_track',name:'Last Light',position:[0,482],kind:'junction',routeNode:true,blurb:'The old north track leaves the warm ashlands.'},
    {id:'wilderness_west_watch',name:'Broken Watch',position:[-250,520],kind:'landmark',routeNode:true},
    {id:'wilderness_gravefield',name:'The Unnamed Graves',position:[-205,585],kind:'landmark',routeNode:true},
    {id:'black_keep_approach',name:'Black Knight Approach',position:[40,548],kind:'junction',routeNode:true},
    {id:'black_keep_gate',name:'Black Knight Gate',position:[40,580],kind:'gate',routeNode:true},
    {id:'black_keep_court',name:'Black Knight Castle',position:[40,600],kind:'landmark',routeNode:true,blurb:'A black masonry fortress around an open, haunted courtyard.'},
    {id:'wilderness_hollow_grove',name:'Petrified Grove',position:[255,640],kind:'landmark',routeNode:true},
    {id:'wilderness_north_stones',name:'The Silent Stones',position:[-80,680],kind:'landmark',routeNode:true},
    ...WILDERNESS_RUIN_LOCATIONS,
    ...WILDERNESS_RESOURCE_LOCATIONS,
    ...DEEP_WILDERNESS_LOCATIONS,
    {id:'wilderness_lava_overlook',name:"Widow's Furnace",position:[178,638],kind:'landmark',routeNode:true,
      blurb:'A slow river of molten stone cuts through the eastern wastes. The old path follows its dry southern bank.'},
  ],
  roads:[{from:'wilderness_south_track',to:'black_keep_approach'},{from:'black_keep_approach',to:'black_keep_gate'},
    {from:'black_keep_gate',to:'black_keep_court'}, {from:'wilderness_south_track',to:'wilderness_west_watch'},
    {from:'wilderness_west_watch',to:'wilderness_gravefield'}, {from:'black_keep_approach',to:'wilderness_hollow_grove'},
    {from:'wilderness_hollow_grove',to:'wilderness_lava_overlook'}, ...DEEP_WILDERNESS_ROADS],
  clusters:WILDERNESS_RESOURCE_CLUSTERS,stations:[],obstacles:[],gates:[],enemyGroups:WILDERNESS_GROUPS,
  landmarks:[
    ...DEEP_WILDERNESS_LANDMARKS,
    ...WILDERNESS_RUIN_LANDMARKS,
    {id:'black_knight_castle',name:'Black Knight Castle',position:[40,600],assetId:'wall_brick_straight',
      composition:'black_knight_castle',compositionOnly:true,rotationY:Math.PI,blurb:'The black keep rises over an open courtyard. Its gate faces the last road south.'},
    {id:'wilderness_stone_circle',name:'The Silent Stones',position:[-80,680],assetId:'rock_medium_2',scale:1.35,composition:'standing_stones',blurb:'Weathered stones ring a patch of bare slate.'},
  ],
  adjacency:[{toRegionId:'kilnhalt',fromLocationId:'wilderness_south_track',toLocationId:'kilnhalt_north_track',meters:69.5}],
};
