import type { CreatureSpeciesDef } from "./creatureSpecies.js";
import type { EnemyDef } from "./index.js";

const drop = (itemId: string, min: number, max: number, chance: number): EnemyDef["drops"][number] =>
  ({ itemId, quantity: [min, max], chance });

function species(
  id: string,
  regionId: CreatureSpeciesDef["regionId"],
  activity: CreatureSpeciesDef["activity"],
  description: string,
  stats: Omit<EnemyDef, "id" | "family" | "marks">,
): CreatureSpeciesDef {
  return {
    id, assetId: `creature_${id}`, scale: 1, regionId, activity, description,
    stats: { ...stats, id: `${id}_t${stats.tier}`, family: id, marks: [2 * stats.tier, 6 * stats.tier] },
  };
}

/**
 * Additive production species. World populations are authored only after lab acceptance.
 * Speeds are initial ground-motion targets, pending each new rig's measured stride and contact
 * proof. No row grants flight, poison, guarding or a special attack absent from EnemyDef.
 */
export const CREATURE_EXPANSION: readonly CreatureSpeciesDef[] = [
  // Small and medium mammals.
  species("redbrush_fox", "fallowmarch", "forage",
    "A narrow hedge hunter with a broad brush tail. Forages near cover and bites only when provoked.", {
      name: "Red Fox", tier: 1, maxHealth: 8, attackLevel: 3, defenceLevel: 4,
      accuracy: 2, armour: 2, magicArmour: 4, maxHit: 2, attackSpeedMs: 1800,
      aggroRadius: 4, moveSpeedMps: 1.8, walkSpeedMps: 0.5, behaviour: "passive",
      drops: [drop("fox_guardhair", 1, 2, 0.65), drop("coarse_hide", 1, 1, 0.35), drop("raw_game_meat", 1, 1, 0.3)],
    }),
  species("duskoak_lynx", "vellenwood", "prowl",
    "Broad paws, tufted ears and a short tail mark this solitary clearing hunter. Its heavy paw strike has a long recovery.", {
      name: "Lynx", tier: 5, maxHealth: 30, attackLevel: 14, defenceLevel: 8,
      accuracy: 16, armour: 10, magicArmour: 10, maxHit: 8, attackSpeedMs: 3000,
      aggroRadius: 8, moveSpeedMps: 2.2, walkSpeedMps: 0.65, behaviour: "aggressive",
      drops: [drop("lynx_sinew", 1, 2, 0.6), drop("bramble_hide", 1, 1, 0.45), drop("raw_venison", 1, 1, 0.35)],
    }),
  species("rootdelve_badger", "vellenwood", "forage",
    "A low, broad-footed root digger. Holds its ground with a sideways claw strike when provoked.", {
      name: "Badger", tier: 5, maxHealth: 24, attackLevel: 11, defenceLevel: 10,
      accuracy: 8, armour: 35, magicArmour: 12, maxHit: 5, attackSpeedMs: 3000,
      aggroRadius: 5, moveSpeedMps: 1.25, walkSpeedMps: 0.4, behaviour: "territorial",
      drops: [drop("badger_bristle", 1, 3, 0.7), drop("bramble_hide", 1, 1, 0.35), drop("raw_venison", 1, 1, 0.35)],
    }),
  species("quillback_porcupine", "karrowmoor", "forage",
    "A heavy quilled animal browsing exposed roots. Slow attacks and a tough coat reward a deliberate approach.", {
      name: "Porcupine", tier: 10, maxHealth: 34, attackLevel: 17, defenceLevel: 12,
      accuracy: 10, armour: 65, magicArmour: 15, maxHit: 7, attackSpeedMs: 3000,
      aggroRadius: 5, moveSpeedMps: 1.0, walkSpeedMps: 0.32, behaviour: "territorial",
      drops: [drop("porcupine_quill", 2, 4, 0.75), drop("cairn_pelt", 1, 1, 0.3)],
    }),
  // Hoofed mammals. Different bodies and gaits, not existing deer/goat palette variants.
  species("marchwild_horse", "fallowmarch", "graze",
    "A long-legged grazer with a hanging mane and tail. Needs open grass and an escape lane; its tailhair binds fishing rods.", {
      name: "Wild Horse", tier: 5, maxHealth: 28, attackLevel: 12, defenceLevel: 8,
      accuracy: 6, armour: 14, magicArmour: 20, maxHit: 7, attackSpeedMs: 3600,
      aggroRadius: 5, moveSpeedMps: 2.15, walkSpeedMps: 0.65, behaviour: "passive",
      drops: [drop("horse_tailhair", 1, 3, 0.7), drop("bramble_hide", 1, 2, 0.45), drop("raw_venison", 1, 2, 0.45)],
    }),
  species("cairn_bighorn", "karrowmoor", "graze",
    "Thick fleece and curled horns distinguish this broad sheep from ibex. A slow planted ram protects its grazing shelf.", {
      name: "Bighorn Sheep", tier: 10, maxHealth: 42, attackLevel: 19, defenceLevel: 13,
      accuracy: 14, armour: 35, magicArmour: 50, maxHit: 9, attackSpeedMs: 3600,
      aggroRadius: 6, moveSpeedMps: 1.7, walkSpeedMps: 0.5, behaviour: "territorial",
      drops: [drop("bighorn_fleece", 1, 2, 0.7), drop("cairn_pelt", 1, 1, 0.4), drop("raw_haunch", 1, 2, 0.45)],
    }),
  species("marsh_moose", "vellenwood", "graze",
    "A high-shouldered marsh browser with palmate antlers and a hanging throat bell. Needs broad dry banks and room to turn.", {
      name: "Moose", tier: 10, maxHealth: 50, attackLevel: 20, defenceLevel: 12,
      accuracy: 12, armour: 22, magicArmour: 45, maxHit: 10, attackSpeedMs: 3600,
      aggroRadius: 6, moveSpeedMps: 1.95, walkSpeedMps: 0.55, behaviour: "territorial",
      drops: [drop("moose_antler_palm", 1, 1, 0.6), drop("cairn_pelt", 1, 2, 0.4), drop("raw_haunch", 1, 2, 0.45)],
    }),
  species("bracken_tapir", "vellenwood", "forage",
    "A smooth-backed forest browser with a short flexible snout. Keeps to sheltered dry ground beside the marsh.", {
      name: "Tapir", tier: 5, maxHealth: 22, attackLevel: 8, defenceLevel: 8,
      accuracy: 4, armour: 20, magicArmour: 28, maxHit: 4, attackSpeedMs: 3000,
      aggroRadius: 4, moveSpeedMps: 1.1, walkSpeedMps: 0.4, behaviour: "passive",
      drops: [drop("tapir_leather", 1, 2, 0.7), drop("bramble_hide", 1, 1, 0.35), drop("raw_venison", 1, 1, 0.35)],
    }),
  // Sprawling vertebrates stay on dry ground in the first release.
  species("reedjaw_crocodile", "karrowmoor", "prowl",
    "A long flat-jawed bank predator with a heavy tail. Basks on dry ground and answers provocation with one weighty bite.", {
      name: "Crocodile", tier: 10, maxHealth: 46, attackLevel: 20, defenceLevel: 12,
      accuracy: 16, armour: 55, magicArmour: 30, maxHit: 10, attackSpeedMs: 3600,
      aggroRadius: 6, moveSpeedMps: 1.3, walkSpeedMps: 0.35, behaviour: "territorial",
      drops: [drop("crocodile_scute", 1, 2, 0.65), drop("cairn_pelt", 1, 1, 0.25), drop("raw_haunch", 1, 2, 0.4)],
    }),
  species("kiln_salamander", "kilnhalt", "forage",
    "A small-headed crawler sheltering beneath warm damp stone. Its flexible body recoils behind a quick jaw strike.", {
      name: "Salamander", tier: 20, maxHealth: 50, attackLevel: 25, defenceLevel: 19,
      accuracy: 18, armour: 24, magicArmour: 90, maxHit: 8, attackSpeedMs: 2400,
      aggroRadius: 5, moveSpeedMps: 0.9, walkSpeedMps: 0.32, behaviour: "territorial",
      drops: [drop("salamander_secretion", 1, 2, 0.65), drop("fire_essence", 1, 2, 0.25)],
    }),
  species("slateback_tortoise", "karrowmoor", "forage",
    "A domed shell carries this slow ledge browser. Its beak reaches out between long rests; magic gets through its armor more easily.", {
      name: "Tortoise", tier: 10, maxHealth: 34, attackLevel: 16, defenceLevel: 13,
      accuracy: 8, armour: 90, magicArmour: 20, maxHit: 7, attackSpeedMs: 3600,
      aggroRadius: 4, moveSpeedMps: 0.45, walkSpeedMps: 0.18, behaviour: "territorial",
      drops: [drop("tortoise_shell_plate", 1, 2, 0.65), drop("raw_haunch", 1, 1, 0.25)],
    }),
  species("ashscale_monitor", "kilnhalt", "prowl",
    "A raised long-necked lizard with a whip tail and spread claws. Patrols dry scree and snaps more often than the crocodile.", {
      name: "Monitor Lizard", tier: 20, maxHealth: 56, attackLevel: 27, defenceLevel: 20,
      accuracy: 24, armour: 40, magicArmour: 65, maxHit: 9, attackSpeedMs: 2400,
      aggroRadius: 9, moveSpeedMps: 1.65, walkSpeedMps: 0.48, behaviour: "aggressive",
      drops: [drop("monitor_sinew", 1, 2, 0.65), drop("charhide", 1, 1, 0.3), drop("raw_ember_haunch", 1, 1, 0.35)],
    }),
  // Ground birds. Wing articulation never implies an airborne movement path.
  species("reedbank_goose", "fallowmarch", "forage",
    "A long-necked broad-billed bird on the dry reed margin. Spreads its wings and pecks when provoked.", {
      name: "Goose", tier: 1, maxHealth: 10, attackLevel: 4, defenceLevel: 2,
      accuracy: 2, armour: 3, magicArmour: 0, maxHit: 3, attackSpeedMs: 2400,
      aggroRadius: 4, moveSpeedMps: 0.5, walkSpeedMps: 0.36, behaviour: "territorial",
      drops: [drop("goose_down", 1, 3, 0.75), drop("raw_game_meat", 1, 1, 0.45)],
    }),
  species("blackwater_heron", "vellenwood", "forage",
    "A narrow reed hunter with long legs and a spear bill. Stands between deliberate steps on a dry bank.", {
      name: "Heron", tier: 5, maxHealth: 18, attackLevel: 13, defenceLevel: 9,
      accuracy: 20, armour: 2, magicArmour: 26, maxHit: 6, attackSpeedMs: 3000,
      aggroRadius: 4, moveSpeedMps: 1.0, walkSpeedMps: 0.28, behaviour: "territorial",
      drops: [drop("heron_quill", 1, 2, 0.65), drop("bramble_trout", 1, 1, 0.2)],
    }),
  species("scree_bustard", "karrowmoor", "prowl",
    "A tall deep-chested ground bird ranging the open shelves. Displays before closing with fast light blows.", {
      name: "Bustard", tier: 10, maxHealth: 32, attackLevel: 18, defenceLevel: 11,
      accuracy: 16, armour: 10, magicArmour: 70, maxHit: 6, attackSpeedMs: 1800,
      aggroRadius: 8, moveSpeedMps: 1.8, walkSpeedMps: 0.55, behaviour: "aggressive",
      drops: [drop("bustard_plume", 1, 3, 0.65), drop("raw_haunch", 1, 1, 0.45)],
    }),
  species("marchfield_turkey", "fallowmarch", "forage",
    "A broad fan-tailed bird with a bare neck and hanging wattle. Struts around its feeding yard and pecks back when attacked.", {
      name: "Turkey", tier: 1, maxHealth: 7, attackLevel: 3, defenceLevel: 2,
      accuracy: 0, armour: 1, magicArmour: 2, maxHit: 2, attackSpeedMs: 2400,
      aggroRadius: 3, moveSpeedMps: 1.0, walkSpeedMps: 0.3, behaviour: "passive",
      drops: [drop("turkey_tailfeather", 1, 3, 0.75), drop("raw_game_meat", 1, 1, 0.45)],
    }),
  // Crawling invertebrates require their own limb counts and continuous contact gait.
  species("quarry_snail", "vellenwood", "forage",
    "A spiral-shelled crawler on damp stone. Its eye stalks retract while the shell remains rigid.", {
      name: "Snail", tier: 5, maxHealth: 14, attackLevel: 6, defenceLevel: 8,
      accuracy: 0, armour: 45, magicArmour: 5, maxHit: 3, attackSpeedMs: 3600,
      aggroRadius: 3, moveSpeedMps: 0.08, walkSpeedMps: 0.025, behaviour: "passive",
      drops: [drop("snail_mucus", 1, 2, 0.8), drop("march_stone", 1, 2, 0.2)],
    }),
  species("antler_beetle", "karrowmoor", "forage",
    "Six planted legs brace a compact shell and branching mandibles. Its slow clamp leaves a long recovery.", {
      name: "Stag Beetle", tier: 10, maxHealth: 30, attackLevel: 18, defenceLevel: 12,
      accuracy: 12, armour: 70, magicArmour: 18, maxHit: 8, attackSpeedMs: 3600,
      aggroRadius: 5, moveSpeedMps: 0.9, walkSpeedMps: 0.32, behaviour: "territorial",
      drops: [drop("beetle_mandible", 1, 1, 0.6), drop("kaldite_ore", 1, 1, 0.15)],
    }),
  species("slag_centipede", "kilnhalt", "prowl",
    "Paired legs travel in a wave beneath linked armored segments. The forward jaws strike while the body remains on its ground route.", {
      name: "Giant Centipede", tier: 20, maxHealth: 52, attackLevel: 26, defenceLevel: 20,
      accuracy: 20, armour: 65, magicArmour: 80, maxHit: 7, attackSpeedMs: 1800,
      aggroRadius: 7, moveSpeedMps: 1.2, walkSpeedMps: 0.4, behaviour: "aggressive",
      drops: [drop("centipede_chitin", 1, 3, 0.7), drop("venom_gland", 1, 1, 0.25)],
    }),
  species("hollowroot_spider", "vellenwood", "prowl",
    "Eight legs surround a narrow waist and broad abdomen. A short-range root hunter with quick fang strikes.", {
      name: "Giant Spider", tier: 5, maxHealth: 20, attackLevel: 11, defenceLevel: 7,
      accuracy: 12, armour: 6, magicArmour: 30, maxHit: 3, attackSpeedMs: 1200,
      aggroRadius: 6, moveSpeedMps: 1.4, walkSpeedMps: 0.42, behaviour: "aggressive",
      drops: [drop("spider_thread", 1, 3, 0.75), drop("venom_gland", 1, 1, 0.1)],
    }),
  // Distinct ground-monster sources. These are ordinary encounters, without Orb drops.
  species("cinder_ravager", "kilnhalt", "patrol",
    "A plated insectoid biped with heavy clawed forearms. Ranges abandoned kiln courts and commits to a slow powerful strike.", {
      name: "Armored Demon", tier: 20, maxHealth: 74, attackLevel: 29, defenceLevel: 23,
      accuracy: 22, armour: 65, magicArmour: 45, maxHit: 13, attackSpeedMs: 3600,
      aggroRadius: 10, moveSpeedMps: 3, walkSpeedMps: 0.9, behaviour: "aggressive",
      drops: [drop("ravager_talon", 1, 2, 0.7), drop("charhide", 1, 1, 0.4), drop("emberite_ore", 1, 2, 0.25)],
    }),
  species("basalt_drake", "kilnhalt", "prowl",
    "A squat armored drake with dorsal plates and a heavy horned head. Holds an outer quarry bench rather than chasing far.", {
      name: "Armored Dragon", tier: 20, maxHealth: 90, attackLevel: 28, defenceLevel: 24,
      accuracy: 18, armour: 120, magicArmour: 30, maxHit: 12, attackSpeedMs: 3600,
      aggroRadius: 7, moveSpeedMps: 2.4, walkSpeedMps: 0.7, behaviour: "territorial",
      drops: [drop("drake_scale", 1, 3, 0.8), drop("emberite_ore", 1, 2, 0.25), drop("fire_opal", 1, 1, 0.08)],
    }),
  species("gorge_mantis", "kilnhalt", "prowl",
    "A tall thin-winged insectoid walking on long jointed legs. Quick raptorial claws make it dangerous in sheltered ravines.", {
      name: "Giant Mantis", tier: 20, maxHealth: 58, attackLevel: 28, defenceLevel: 21,
      accuracy: 24, armour: 35, magicArmour: 95, maxHit: 8, attackSpeedMs: 1800,
      aggroRadius: 8, moveSpeedMps: 1.8, walkSpeedMps: 0.52, behaviour: "aggressive",
      drops: [drop("mantis_scythe", 1, 1, 0.55), drop("charhide", 1, 1, 0.35), drop("fire_essence", 1, 2, 0.2)],
    }),
  species("quarry_nightmare", "karrowmoor", "patrol",
    "A lean raised ground dragon with long clawed legs, a horned head and a thin tail. Keeps to broad abandoned cuts.", {
      name: "Pale Dragon", tier: 10, maxHealth: 66, attackLevel: 21, defenceLevel: 14,
      accuracy: 16, armour: 45, magicArmour: 25, maxHit: 10, attackSpeedMs: 3600,
      aggroRadius: 7, moveSpeedMps: 1.65, walkSpeedMps: 0.5, behaviour: "territorial",
      drops: [drop("nightmare_plate", 1, 2, 0.7), drop("cairn_garnet", 1, 1, 0.08), drop("kaldite_ore", 1, 2, 0.2)],
    }),
];
