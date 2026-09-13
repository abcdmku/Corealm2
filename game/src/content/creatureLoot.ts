import type { EquipmentBonuses, ItemDef, ItemId, SkillId } from "../contracts.js";
import type { RecipeDef } from "./index.js";
import { recipeXp } from "./index.js";
/** Each species keeps its own material even when several recipes make familiar equipment. */
export const CREATURE_TROPHY_BY_SPECIES = {
    redbrush_fox: "fox_guardhair",
    duskoak_lynx: "lynx_sinew",
    rootdelve_badger: "badger_bristle",
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
type CreatureTier = 1 | 5 | 10 | 20;
type SpeciesId = keyof typeof CREATURE_TROPHY_BY_SPECIES;
const MATERIAL_VALUE: Readonly<Record<CreatureTier, number>> = { 1: 3, 5: 8, 10: 17, 20: 35 };
function material(species: SpeciesId, name: string, tier: CreatureTier, description: string): ItemDef {
    return {
        id: CREATURE_TROPHY_BY_SPECIES[species], name, tier, description,
        category: "component", stackable: true, value: MATERIAL_VALUE[tier]
    };
}
const MATERIALS: readonly ItemDef[] = [
    material("redbrush_fox", "Fox Fur", 1, "Coarse red hair from a fox's back. Bind it around a Copper band for a padded guard ring."),
    material("duskoak_lynx", "Lynx Sinew", 5, "Springy tendon, cleaned and dried. A tight winding gives a hunter's ring its grip."),
    material("rootdelve_badger", "Badger Bristle", 5, "Stiff black and silver bristles. Worked into leg linings, they save a sheet of hide."),
    material("quillback_porcupine", "Porcupine Quill", 10, "A thick hollow quill with a hard point. Short sections can be set around a guard ring."),
    material("marchwild_horse", "Horsehair", 5, "Long strong strands. Braided into fishing line, they replace a rod's hide binding."),
    material("cairn_bighorn", "Bighorn Wool", 10, "Dense wool from a ridge ram. A felted lining stretches a pelt into a pair of leggings."),
    material("marsh_moose", "Moose Antler", 10, "A flat antler section. Cut and polished, it makes a broad protective charm."),
    material("bracken_tapir", "Tapir Leather", 5, "Thick strips from a tapir's flank. Trim three strips into two standard hide sheets."),
    material("reedjaw_crocodile", "Crocodile Armor Plate", 10, "A hard plate from a crocodile's back. Scute soles let one pelt cover two pairs of boots."),
    material("kiln_salamander", "Salamander Secretion", 20, "A heat-stable mineral paste. Ashford uses it instead of mined flux stone."),
    material("slateback_tortoise", "Tortoise Shell Plate", 10, "A curved shell section. Lash several across a wooden shield in place of its metal boss."),
    material("ashscale_monitor", "Monitor Lizard Sinew", 20, "Heat-tough tendon from a monitor's tail. Twisted into line, it binds a Cedar rod."),
    material("reedbank_goose", "Goose Down", 1, "Soft breast feathers. Pack them between hide panels to finish a robe with less leather."),
    material("blackwater_heron", "Heron Quill", 5, "A long hollow flight quill. Cut around an amber bead, it steadies a casting charm."),
    material("scree_bustard", "Bustard Plume", 10, "A broad feather from a heavy moorland bird. Layered plumes replace a robe's inner pelt."),
    material("marchfield_turkey", "Turkey Tail Feather", 1, "A barred tail feather. Millfield hunters bind a fan of them around a small warding charm."),
    material("quarry_snail", "Snail Mucus", 5, "A sealed dab of clear adhesive. It bonds a wooden shield's layers in place of a metal boss."),
    material("antler_beetle", "Beetle Jaw", 10, "A hooked jaw hard enough to score stone. Several brace a pick head with less metal."),
    material("slag_centipede", "Centipede Chitin", 20, "Dark overlapping plates. Small segments fit an armored ring without spoiling its grip."),
    material("hollowroot_spider", "Spider Silk", 5, "A reel of strong dry silk. Close stitching makes a full robe from fewer hide panels."),
    material("cinder_ravager", "Demon Claw", 20, "A hooked black claw. Cut down, it replaces the wooden grip beneath a Titanium blade."),
    material("basalt_drake", "Armored Dragon Scale", 20, "A broad scale with a tough leather backing. Trim several into standard heavy hide sheets."),
    material("gorge_mantis", "Mantis Claw", 20, "A curved cutting spur. Its sharpened edge can be caged inside an aggressive hunting charm."),
    material("quarry_nightmare", "Pale Dragon Plate", 10, "A ridged shoulder plate. Riveted over a helm, it replaces part of the Cobalt shell."),
];
interface AccessorySpec {
    id: string;
    name: string;
    tier: CreatureTier;
    slot: "accessory1" | "accessory2";
    value: number;
    description: string;
    skill: SkillId;
    bonuses: Partial<EquipmentBonuses>;
}
function accessory(spec: AccessorySpec): ItemDef {
    return {
        id: spec.id, name: spec.name, tier: spec.tier, description: spec.description,
        category: "equipment", stackable: false, value: spec.value,
        equip: {
            slot: spec.slot,
            requires: { [spec.skill]: spec.tier },
            bonuses: {
                meleeAccuracy: 0, meleePower: 0, defence: Math.max(0, 0), magicAccuracy: 0,
                magicPower: 0, health: 0, ...spec.bonuses,
                vitality: 0
            }
        }
    };
}
// These trade the usual accuracy or warding bonuses for a specific job. No new combat rules.
const ACCESSORIES: readonly ItemDef[] = [








];
export const CREATURE_LOOT_ITEMS: readonly ItemDef[] = [...MATERIALS, ...ACCESSORIES];
type Ingredient = readonly [
    itemId: ItemId,
    quantity: number
];
const SKILL_FOR_KIND: Readonly<Record<RecipeDef["kind"], SkillId>> = {
    smelt: "smithing", smith: "smithing", cook: "cooking", craft: "crafting", fletch: "fletching"
};
const STATION_FOR_KIND: Readonly<Record<RecipeDef["kind"], RecipeDef["stations"]>> = {
    smelt: ["furnace"], smith: ["anvil"], cook: ["range", "campfire"],
    craft: ["crafting_table"], fletch: ["fletching_bench"]
};
function recipe(species: SpeciesId, name: string, tier: CreatureTier, kind: RecipeDef["kind"], inputs: readonly Ingredient[], output: Ingredient, weight: number): RecipeDef {
    return {
        id: `creature_${CREATURE_TROPHY_BY_SPECIES[species]}`, name, tier, kind,
        skill: SKILL_FOR_KIND[kind], reqLevel: tier, stations: STATION_FOR_KIND[kind],
        inputs: [
            { itemId: CREATURE_TROPHY_BY_SPECIES[species], quantity: 3 },
            ...inputs.map(([itemId, quantity]) => ({ itemId, quantity })),
        ],
        output: { itemId: output[0], quantity: output[1] },
        durationMs: kind === "smith" ? 3000 : kind === "fletch" ? 1800 : 2400,
        xp: recipeXp(tier, weight)
    };
}
/** One recipe per trophy. Sixteen supply the existing production ladder; eight make sidegrades. */
export const CREATURE_LOOT_RECIPES: readonly RecipeDef[] = [


    recipe("rootdelve_badger", "Bristle-lined Thick Hide Leggings", 5, "craft", [["bramble_hide", 1]], ["bramblehide_leggings", 1], 4),

    recipe("marchwild_horse", "Horsehair Maple Rod", 5, "fletch", [["duskoak_shaft", 2]], ["duskoak_rod", 1], 1.8),
    recipe("cairn_bighorn", "Fleece-lined Fur Leggings", 10, "craft", [["cairn_pelt", 1]], ["cairnpelt_leggings", 1], 4),

    recipe("bracken_tapir", "Trim Tapir Hide Sheets", 5, "craft", [], ["bramble_hide", 2], 1),
    recipe("reedjaw_crocodile", "Scute-soled Fur Boots", 10, "craft", [["cairn_pelt", 1]], ["cairnpelt_boots", 2], 2.5),
    recipe("kiln_salamander", "Salamander-fluxed Titanium Bar", 20, "smelt", [["emberite_ore", 3]], ["emberite_bar", 1], 0.8),
    recipe("slateback_tortoise", "Shell-backed Pine Shield", 10, "fletch", [["cairnpine_log", 2]], ["cairnpine_shield", 1], 2.8),
    recipe("ashscale_monitor", "Sinew-bound Cedar Rod", 20, "fletch", [["cinderpine_shaft", 2]], ["cinderpine_rod", 1], 1.8),
    recipe("reedbank_goose", "Down-lined Hide Robe", 1, "craft", [["coarse_hide", 2]], ["marchhide_robe", 1], 4),

    recipe("scree_bustard", "Plume-lined Fur Robe", 10, "craft", [["cairn_pelt", 2]], ["cairnpelt_robe", 1], 4),

    recipe("quarry_snail", "Glue-bound Maple Shield", 5, "fletch", [["duskoak_log", 2]], ["duskoak_shield", 1], 2.8),
    recipe("antler_beetle", "Mandible-braced Cobalt Pickaxe", 10, "smith", [["kaldite_bar", 1], ["cairnpine_handle", 1]], ["kaldite_pickaxe", 1], 2.2),

    recipe("hollowroot_spider", "Silk-stitched Thick Hide Robe", 5, "craft", [["bramble_hide", 2]], ["bramblehide_robe", 1], 4),
    recipe("cinder_ravager", "Demon Claw Grip Titanium Dagger", 20, "smith", [["emberite_bar", 1]], ["emberite_dagger", 1], 2),
    recipe("basalt_drake", "Trim Armored Dragon Hide Sheets", 20, "craft", [], ["charhide", 2], 1),

    recipe("quarry_nightmare", "Pale Dragon Plated Cobalt Helm", 10, "smith", [["kaldite_bar", 1]], ["kaldite_helm", 1], 2.5),
];
