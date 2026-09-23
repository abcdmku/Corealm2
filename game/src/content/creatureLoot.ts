import { ITEM_DATA } from "./itemData.js";
import type { ItemDef } from "../contracts.js";
import type { RecipeDef } from "./index.js";
import { RECIPE_DATA } from "./recipeData.js";
/** Each species keeps its own material even when several recipes make familiar equipment. */
export const CREATURE_TROPHY_BY_SPECIES = {
    redbrush_fox: "fox_guardhair",
    duskoak_lynx: "lynx_sinew",
    rootdelve_badger: "emberhorn",
    quillback_porcupine: "porcupine_quill",
    marchwild_horse: "horse_tailhair",
    cairn_bighorn: "bighorn_fleece",
    marsh_moose: "moose_antler_palm",
    bracken_tapir: "tapir_leather",
    reedjaw_crocodile: "crocodile_scute",
    kiln_salamander: "salamander_secretion",
    slateback_tortoise: "tortoise_shell_plate",
    ashscale_monitor: "monitor_sinew",
    reedbank_goose: "goose_down",
    blackwater_heron: "heron_quill",
    scree_bustard: "bustard_plume",
    marchfield_turkey: "turkey_tailfeather",
    quarry_snail: "snail_mucus",
    antler_beetle: "beetle_mandible",
    slag_centipede: "centipede_chitin",
    hollowroot_spider: "spider_thread",
    cinder_ravager: "ravager_talon",
    basalt_drake: "drake_scale",
    gorge_mantis: "mantis_scythe",
    quarry_nightmare: "nightmare_plate"
} as const;
export const CREATURE_LOOT_ITEMS: readonly ItemDef[] = ITEM_DATA.filter(item => item.category === "resource" || item.category === "component");
export const CREATURE_LOOT_RECIPES: readonly RecipeDef[] = RECIPE_DATA.filter(recipe => recipe.kind === "craft");
