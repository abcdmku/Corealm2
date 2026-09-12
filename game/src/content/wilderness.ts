import type { RegionDef, EnemyGroupDef, LocationDef } from './regions.js';
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

const easternEncounters = [
  ['wilderness_east_cinderback_shelf','cinderback_crag',[630,555],4,18],
  ['wilderness_east_furnace_herd','furnace_grazer',[565,650],4,20],
  ['wilderness_east_basalt_prowl','basalt_maw',[420,675],4,18],
  ['wilderness_east_rift_carapaces','rift_carapace',[445,735],4,20],
  ['wilderness_far_east_colossi','voidstone_colossus',[610,765],3,22],
  ['wilderness_east_gloam_patrol','gloam_wraith',[440,840],4,20],
  ['wilderness_northeast_carapaces','rift_carapace',[605,900],4,20],
] as const;

/** Small doorway posts occupy four ruins without turning each landmark into another roaming pack. */
const easternRuinSentries = [
  { id:'ashwind_cloister_sentries', speciesId:'cinderback_crag', siteId:'ashwind_cloister',
    approachName:'Ashwind Cloister Approach', localX:12, localZ:28, bodyRadius:2.5 },
  { id:'far_cinder_smithy_sentries', speciesId:'basalt_maw', siteId:'far_cinder_smithy',
    approachName:'Far Cinder Smithy Approach', localX:12, localZ:22, bodyRadius:3 },
  { id:'nightglass_waterway_sentries', speciesId:'gloam_wraith', siteId:'nightglass_waterway',
    approachName:'Nightglass Waterway Approach', localX:10, localZ:19, bodyRadius:1.5 },
  { id:'starless_abbey_sentries', speciesId:'rift_carapace', siteId:'starless_abbey',
    approachName:'Starless Abbey Approach', localX:12, localZ:28, bodyRadius:2.5 },
] as const;

const sentryAnchors = new Map<string, readonly (readonly [number, number])[]>();
const EASTERN_RUIN_SENTRY_GROUPS: EnemyGroupDef[] = easternRuinSentries.map(spec => {
  const site = WILDERNESS_RUIN_SITES.find(candidate => candidate.id === spec.siteId)!;
  const species = WILDERNESS_CREATURE_SPECIES.find(candidate => candidate.id === spec.speciesId)!;
  const cos = Math.cos(site.rotationY), sin = Math.sin(site.rotationY);
  const point = (x: number): readonly [number, number] => [
    site.position[0] + x * cos + spec.localZ * sin,
    site.position[1] - x * sin + spec.localZ * cos,
  ];
  const anchors = [point(-spec.localX), point(spec.localX)];
  sentryAnchors.set(spec.id, anchors);
  return { id:spec.id, family:species.stats.family, name:species.stats.name, tier:species.stats.tier,
    assetId:species.assetId, scale:species.scale,
    centre:[(anchors[0]![0] + anchors[1]![0]) / 2, (anchors[0]![1] + anchors[1]![1]) / 2],
    count:2, radius:spec.localX + spec.bodyRadius };
});
const EASTERN_RUIN_APPROACH_LOCATIONS: LocationDef[] = easternRuinSentries.map(spec => {
  const group = EASTERN_RUIN_SENTRY_GROUPS.find(candidate => candidate.id === spec.id)!;
  return { id:`${spec.siteId}_approach`, name:spec.approachName, position:group.centre,
    kind:'junction', routeNode:true };
});

const LEGACY_WILDERNESS_GROUPS: EnemyGroupDef[] = encounters.map(([id,speciesId,centre,count,radius]) => {
  const species = CREATURE_REDESIGNS.find(row=>row.id===speciesId) ?? RPG_BESTIARY_BY_ID.get(speciesId)!;
  return {id,family:species.stats.family,name:species.stats.name,tier:50,
    assetId:species.assetId,scale:species.scale * tierSilhouetteScale(species.stats.tier) / tierSilhouetteScale(50),centre,count,radius};
});
// The seven eastern roaming bands already occupy the widened ground. Keep the old close-set
// ruin haunts on the original half of the region instead of doubling every new roadside site.
for (const [index, site] of WILDERNESS_RUIN_SITES.filter(site => site.position[0] < 350).entries()) {
  const species = RPG_BESTIARY_BY_ID.get(index % 2 ? 'wraith' : 'skeleton_soldier')!;
  LEGACY_WILDERNESS_GROUPS.push({id:`${site.id}_haunt`,family:species.stats.family,name:species.stats.name,tier:50,
    assetId:species.assetId,scale:species.scale * tierSilhouetteScale(species.stats.tier) / tierSilhouetteScale(50),centre:site.position,count:2,radius:6});
}

const EASTERN_WILDERNESS_GROUPS: EnemyGroupDef[] = easternEncounters.map(([id,speciesId,centre,count,radius]) => {
  const species = WILDERNESS_CREATURE_SPECIES.find(row => row.id === speciesId)!;
  return { id, family:species.stats.family, name:species.stats.name, tier:species.stats.tier,
    assetId:species.assetId, scale:species.scale, centre, count, radius };
});

const ORDINARY_WILDERNESS_GROUPS = [
  ...LEGACY_WILDERNESS_GROUPS, ...EASTERN_WILDERNESS_GROUPS, ...EASTERN_RUIN_SENTRY_GROUPS,
];

export const WILDERNESS_GROUPS: EnemyGroupDef[] = [...ORDINARY_WILDERNESS_GROUPS,
  ...wildernessExpansionGroups([...WILDERNESS_CREATURE_SPECIES, ...WILDERNESS_DRAGONS])];

export const WILDERNESS_HABITATS: HabitatDef[] = ORDINARY_WILDERNESS_GROUPS.map(group => ({
  id:`${group.id}_habitat`,groupId:group.id,regionId:'wilderness',centre:group.centre,radius:group.radius,
  activity:'patrol',
  dressing: group.id === 'wilderness_west_graves' || group.id === 'black_keep_north_graves'
    ? encounterSetting('wraith', group.centre, group.radius * .3).dressing : [],
  anchors:sentryAnchors.get(group.id) ?? (WILDERNESS_RUIN_SITES.some(site=>`${site.id}_haunt`===group.id)
    ? [-3.5,3.5].map(z => {
      const site=WILDERNESS_RUIN_SITES.find(row=>`${row.id}_haunt`===group.id)!;
      return [site.position[0]+Math.sin(site.rotationY)*z,site.position[1]+Math.cos(site.rotationY)*z] as const;
    })
    : Array.from({length:Math.max(group.count,4)},(_,i)=>{
    const angle=i/Math.max(group.count,4)*Math.PI*2+.3;
    return [group.centre[0]+Math.cos(angle)*group.radius*.6,group.centre[1]+Math.sin(angle)*group.radius*.6] as const;
  })),
}));

/** The final-world terrain/placement exception applies here; actors and castle use the lab first. */
export const WILDERNESS: RegionDef = {
  id:'wilderness',name:'Wilderness',tier:50,
  lore:'Beyond the ashlands, daylight fades over grey plains and broken stone hills. The Black Knight castle watches rivers of fire, gravefields and scorched groves. Farther north the T70 Deep Wilderness opens into violet night, where cold blue fissures wind past dragon roosts and ruined citadels.',
  bounds:{min:[-350,WILDERNESS_DEPTH.south],max:[700,WILDERNESS_DEPTH.north]},terrainSeed:0xdead70,terrainAmplitude:12,baseHeight:9,
  groundPalette:['#555961','#7b7e83','#535357','#72767e','#4b4a47','#49464a','#958b80','#b2b4b8'],
  fogStart:125,spawnPoint:[0,482],spawnFacingRad:0,respawnPointId:'emberfast',
  locations:[
    {id:'wilderness_crownward_track',name:'Lost Crown Road',position:[560,482],kind:'junction',routeNode:true,blurb:'The royal road enters the widened northern wastes.'},
    {id:'east_shallow_crossroads',name:'Kingspan Crossroads',position:[540,535],kind:'junction',routeNode:true},
    {id:'east_cinder_road',name:'Cinderward Road',position:[600,610],kind:'junction',routeNode:true},
    {id:'east_depth_threshold',name:'Far Cinder Gate',position:[625,710],kind:'junction',routeNode:true,
      blurb:'The eastern road crosses into the cold violet reach.'},
    {id:'east_night_road',name:'Nightglass Road',position:[550,785],kind:'junction',routeNode:true},
    {id:'east_star_road',name:'Starfall Road',position:[570,865],kind:'junction',routeNode:true},
    {id:'east_upper_bend',name:'Upper Nightglass Bend',position:[610,790],kind:'junction',routeNode:true},
    {id:'starless_outer_road',name:'Starless Outer Road',position:[690,875],kind:'junction',routeNode:true},
    {id:'ashwind_shelter_bend',name:'Ashwind Shelter Bend',position:[570,620],kind:'junction',routeNode:true},
    ...EASTERN_RUIN_APPROACH_LOCATIONS,
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
  roads:[{from:'wilderness_crownward_track',to:'wilderness_hollow_grove'},
    {from:'wilderness_crownward_track',to:'east_shallow_crossroads'},
    {from:'east_shallow_crossroads',to:'east_kingspan_site'},
    {from:'east_shallow_crossroads',to:'east_cinder_cut'},
    {from:'east_shallow_crossroads',to:'ashwind_cloister_approach'},
    {from:'ashwind_cloister_approach',to:'ashwind_cloister_site'},
    {from:'east_shallow_crossroads',to:'ashwind_shelter_bend'},
    {from:'ashwind_shelter_bend',to:'ashwind_shelter'},
    {from:'east_shallow_crossroads',to:'east_cinder_road'},
    {from:'east_cinder_road',to:'far_cinder_smithy_approach'},
    {from:'far_cinder_smithy_approach',to:'far_cinder_smithy_site'},
    {from:'east_cinder_road',to:'east_depth_threshold'},
    {from:'east_depth_threshold',to:'east_night_road'},
    {from:'east_night_road',to:'rift_watch_site'},
    {from:'east_night_road',to:'nightglass_waterway_approach'},
    {from:'nightglass_waterway_approach',to:'nightglass_waterway_site'},
    {from:'east_night_road',to:'nightglass_ridge'},
    {from:'east_night_road',to:'east_upper_bend'},
    {from:'east_upper_bend',to:'east_star_road'},
    {from:'east_star_road',to:'starfall_copse'},
    {from:'east_star_road',to:'starless_outer_road'},
    {from:'starless_outer_road',to:'starless_abbey_approach'},
    {from:'starless_abbey_approach',to:'starless_abbey_site'},
    {from:'wilderness_south_track',to:'black_keep_approach'},{from:'black_keep_approach',to:'black_keep_gate'},
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
