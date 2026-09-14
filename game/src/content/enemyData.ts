import type { EnemyDef } from './index.js';
import { CREATURE_CATALOG } from './creatureRuntime.js';

export const ENEMY_DATA: readonly EnemyDef[] = CREATURE_CATALOG.enemies;
export const ENEMY_BLOCK_DATA = ENEMY_DATA;
export const LAB_ONLY_ENEMY_DATA = CREATURE_CATALOG.creatures.filter(row => row.availability === 'lab').map(row => row.enemy);
export function enemyBlockById(id: string): EnemyDef {
  const enemy = CREATURE_CATALOG.byEnemyId.get(id);
  if (!enemy) throw new Error(`Unknown creature combat ${id}`);
  return enemy;
}
export function registeredEnemyById(id: string): EnemyDef | undefined {
  const row = CREATURE_CATALOG.byCreatureId.get(id);
  return row?.availability === 'world' ? row.enemy : undefined;
}
export const BIOME_REPLACEMENT_SPECIES: Readonly<Record<string, string>> = {
  "palewood_adders": "thorn_maw",
  "regional_gloam_fox": "heath_jack",
  "regional_redbrush_fox": "heath_jack",
  "pack_fallowmarch_palewood_far_south_scrub": "thorn_maw",
  "pack_fallowmarch_palewood_heath_scrub": "heath_jack",
  "pack_fallowmarch_palewood_reed_scrub": "reed_strider",
  "pack_fallowmarch_bracken_northeast_spiders": "thorn_maw",
  "marchwild_horse_residents": "briar_harrow",
  "duskoak_stags": "briar_harrow",
  "bramble_hogs": "fen_crawler",
  "deepwood_coyotes": "heath_jack",
  "blackwater_frogs": "reed_strider",
  "rootfall_coneys": "thorn_maw",
  "thornline_adders": "thorn_maw",
  "pack_vellenwood_marchgate_south_bramble": "thorn_maw",
  "pack_vellenwood_mossbound_west_bramble": "fen_crawler",
  "duskoak_lynx_residents": "heath_jack",
  "rootdelve_badger_residents": "briar_harrow",
  "marsh_moose_residents": "briar_harrow",
  "bracken_tapir_residents": "fen_crawler",
  "blackwater_heron_residents": "reed_strider",
  "quarry_snail_residents": "thorn_maw",
  "hollowroot_spider_residents": "thorn_maw",
  "highcairn_bears": "cairn_treader",
  "scree_boars": "vault_custodian",
  "ridge_ibex": "scree_watcher",
  "terrace_aurochs": "vault_custodian",
  "tarn_coyotes": "cairn_treader",
  "pack_karrowmoor_tarn_track_east_mandibles": "flint_mandible",
  "pack_karrowmoor_moor_road_far_west_watch": "vault_custodian",
  "quillback_porcupine_residents": "scree_watcher",
  "cairn_bighorn_residents": "cairn_treader",
  "reedjaw_crocodile_residents": "flint_mandible",
  "slateback_tortoise_residents": "vault_custodian",
  "scree_bustard_residents": "scree_watcher",
  "antler_beetle_residents": "flint_mandible",
  "quarry_nightmare_residents": "cairn_treader",
  "gravelmaw_ch1_rats": "blind_cave_weaver",
  "gravelmaw_ch2_scorpions": "blind_cave_weaver",
  "gravelmaw_ch2_crabs": "flint_mandible",
  "gravelmaw_ch3_bears": "vault_custodian",
  "gravelmaw_amethyst_spiders": "blind_cave_weaver",
  "ashback_bears": "kiln_marrow",
  "cinder_boars": "slag_crawler",
  "emberhorn_ibex": "cinder_penitent",
  "cinder_adders": "grave_lantern",
  "pack_kilnhalt_clinker_southern_approach_west": "kiln_marrow",
  "pack_kilnhalt_cinderpine_northwest_outer": "slag_crawler",
  "kiln_salamander_residents": "slag_crawler",
  "ashscale_monitor_residents": "cinder_penitent",
  "slag_centipede_residents": "slag_crawler",
  "cinder_ravager_residents": "kiln_marrow",
  "basalt_drake_residents": "slag_crawler",
  "gorge_mantis_residents": "veil_reaper"
};
