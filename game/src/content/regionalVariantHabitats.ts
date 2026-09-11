import { REGIONAL_CREATURE_VARIANTS } from './regionalCreatureVariants.js';
import { CREATURE_EXPANSION } from './creatureExpansion.js';
import { RPG_BESTIARY } from './rpgBestiary.js';
import type { EnemyGroupDef } from './regions.js';
import type { HabitatDef } from './worldHabitats.js';

/** Compact undressed encounters. No disabled regional-pack dressing is activated here. */
const pockets = [
 ['gloam_fox', -280, -145], ['redbrush_fox', -280, -115],
 ['moonweave_spider', 23, 29], ['webweaver_spider', 279, 91],
 ['rimeback_tortoise', 305, -43], ['slateback_tortoise', 7, -14],
 ['cindercrest_salamander', -258, 238], ['kiln_salamander', 214, 427],
] as const;
const reservedPockets: Readonly<Record<string, string>> = {
 moonweave_spider: 'pack_vellenwood_marchgate_south_bramble',
 webweaver_spider: 'pack_vellenwood_mossbound_west_bramble',
 rimeback_tortoise: 'pack_karrowmoor_tarn_track_east_mandibles',
 slateback_tortoise: 'pack_karrowmoor_moor_road_far_west_watch',
 cindercrest_salamander: 'pack_kilnhalt_clinker_southern_approach_west',
 kiln_salamander: 'pack_kilnhalt_cinderpine_northwest_outer',
};
export const REGIONAL_VARIANT_RESERVED_PACK_IDS = Object.values(reservedPockets);
const catalogue = [...REGIONAL_CREATURE_VARIANTS, ...CREATURE_EXPANSION, ...RPG_BESTIARY];
export const REGIONAL_VARIANT_HABITATS: readonly HabitatDef[] = pockets.map(([id,x,z]) => {
 const species=catalogue.find(row=>row.id===id)!;
 return {id:`regional_${id}_habitat`,groupId:reservedPockets[id] ?? `regional_${id}`,regionId:species.regionId,
  centre:[x,z],radius:9,anchors:[[x-4,z],[x+4,z],[x,z-4],[x,z+4]],activity:species.activity,dressing:[]};
});
export const REGIONAL_VARIANT_GROUPS: readonly EnemyGroupDef[] = pockets.map(([id],index)=>{
 const species=catalogue.find(row=>row.id===id)!;const habitat=REGIONAL_VARIANT_HABITATS[index]!;
 return {id:habitat.groupId,family:species.stats.family,name:species.stats.name,tier:species.stats.tier,
  count:2,centre:habitat.centre,radius:habitat.radius,assetId:species.assetId,scale:species.scale};
});
const cave=REGIONAL_CREATURE_VARIANTS.find(row=>row.id==='amethyst_spider')!;
export const AMETHYST_CAVE_GROUP: EnemyGroupDef = {
 id:'gravelmaw_amethyst_spiders',family:cave.stats.family,name:cave.stats.name,tier:cave.stats.tier,
 count:3,centre:[35,-42],radius:4,assetId:cave.assetId,scale:cave.scale,
};

export const AMETHYST_CAVE_HABITAT: HabitatDef = {
 id:'gravelmaw_amethyst_habitat',groupId:AMETHYST_CAVE_GROUP.id,regionId:'gravelmaw',
 centre:AMETHYST_CAVE_GROUP.centre,radius:4,anchors:[[34,-43],[37,-44],[34,-39]],activity:'prowl',dressing:[],
};
