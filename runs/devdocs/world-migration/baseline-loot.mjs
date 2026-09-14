// .baseline/game/src/content/creatureExpansion.ts
var drop = (itemId, min, max, chance) => ({ itemId, quantity: [min, max], chance });
function species(id, regionId, activity, description, stats) {
  return {
    id,
    assetId: `creature_${id}`,
    scale: 1,
    regionId,
    activity,
    description,
    stats: { ...stats, id: `${id}_t${stats.tier}`, family: id, marks: [2 * stats.tier, 6 * stats.tier] }
  };
}
var CREATURE_EXPANSION = [
  // Small and medium mammals.
  species(
    "redbrush_fox",
    "fallowmarch",
    "forage",
    "A narrow hedge hunter with a broad brush tail. Forages near cover and bites only when provoked.",
    {
      name: "Red Fox",
      tier: 1,
      maxHealth: 8,
      attackLevel: 3,
      defenceLevel: 4,
      accuracy: 2,
      armour: 2,
      magicArmour: 4,
      maxHit: 2,
      attackSpeedMs: 1800,
      aggroRadius: 4,
      moveSpeedMps: 1.8,
      walkSpeedMps: 0.5,
      behaviour: "passive",
      drops: [drop("fox_guardhair", 1, 2, 0.65), drop("coarse_hide", 1, 1, 0.35), drop("raw_game_meat", 1, 1, 0.3)]
    }
  ),
  species(
    "duskoak_lynx",
    "vellenwood",
    "prowl",
    "Broad paws, tufted ears and a short tail mark this solitary clearing hunter. Its heavy paw strike has a long recovery.",
    {
      name: "Lynx",
      tier: 5,
      maxHealth: 30,
      attackLevel: 14,
      defenceLevel: 8,
      accuracy: 16,
      armour: 10,
      magicArmour: 10,
      maxHit: 8,
      attackSpeedMs: 3e3,
      aggroRadius: 8,
      moveSpeedMps: 2.2,
      walkSpeedMps: 0.65,
      behaviour: "aggressive",
      drops: [drop("lynx_sinew", 1, 2, 0.6), drop("bramble_hide", 1, 1, 0.45), drop("raw_venison", 1, 1, 0.35)]
    }
  ),
  species(
    "rootdelve_badger",
    "vellenwood",
    "forage",
    "A low, broad-footed root digger. Holds its ground with a sideways claw strike when provoked.",
    {
      name: "Badger",
      tier: 5,
      maxHealth: 24,
      attackLevel: 11,
      defenceLevel: 10,
      accuracy: 8,
      armour: 35,
      magicArmour: 12,
      maxHit: 5,
      attackSpeedMs: 3e3,
      aggroRadius: 5,
      moveSpeedMps: 1.25,
      walkSpeedMps: 0.4,
      behaviour: "territorial",
      drops: [drop("badger_bristle", 1, 3, 0.7), drop("bramble_hide", 1, 1, 0.35), drop("raw_venison", 1, 1, 0.35)]
    }
  ),
  species(
    "quillback_porcupine",
    "karrowmoor",
    "forage",
    "A heavy quilled animal browsing exposed roots. Slow attacks and a tough coat reward a deliberate approach.",
    {
      name: "Porcupine",
      tier: 10,
      maxHealth: 34,
      attackLevel: 17,
      defenceLevel: 12,
      accuracy: 10,
      armour: 65,
      magicArmour: 15,
      maxHit: 7,
      attackSpeedMs: 3e3,
      aggroRadius: 5,
      moveSpeedMps: 1,
      walkSpeedMps: 0.32,
      behaviour: "territorial",
      drops: [drop("porcupine_quill", 2, 4, 0.75), drop("cairn_pelt", 1, 1, 0.3)]
    }
  ),
  // Hoofed mammals. Different bodies and gaits, not existing deer/goat palette variants.
  species(
    "marchwild_horse",
    "fallowmarch",
    "graze",
    "A long-legged grazer with a hanging mane and tail. Needs open grass and an escape lane; its tailhair binds fishing rods.",
    {
      name: "Wild Horse",
      tier: 5,
      maxHealth: 28,
      attackLevel: 12,
      defenceLevel: 8,
      accuracy: 6,
      armour: 14,
      magicArmour: 20,
      maxHit: 7,
      attackSpeedMs: 3600,
      aggroRadius: 5,
      moveSpeedMps: 2.15,
      walkSpeedMps: 0.65,
      behaviour: "passive",
      drops: [drop("horse_tailhair", 1, 3, 0.7), drop("bramble_hide", 1, 2, 0.45), drop("raw_venison", 1, 2, 0.45)]
    }
  ),
  species(
    "cairn_bighorn",
    "karrowmoor",
    "graze",
    "Thick fleece and curled horns distinguish this broad sheep from ibex. A slow planted ram protects its grazing shelf.",
    {
      name: "Bighorn Sheep",
      tier: 10,
      maxHealth: 42,
      attackLevel: 19,
      defenceLevel: 13,
      accuracy: 14,
      armour: 35,
      magicArmour: 50,
      maxHit: 9,
      attackSpeedMs: 3600,
      aggroRadius: 6,
      moveSpeedMps: 1.7,
      walkSpeedMps: 0.5,
      behaviour: "territorial",
      drops: [drop("bighorn_fleece", 1, 2, 0.7), drop("cairn_pelt", 1, 1, 0.4), drop("raw_haunch", 1, 2, 0.45)]
    }
  ),
  species(
    "marsh_moose",
    "vellenwood",
    "graze",
    "A high-shouldered marsh browser with palmate antlers and a hanging throat bell. Needs broad dry banks and room to turn.",
    {
      name: "Moose",
      tier: 10,
      maxHealth: 50,
      attackLevel: 20,
      defenceLevel: 12,
      accuracy: 12,
      armour: 22,
      magicArmour: 45,
      maxHit: 10,
      attackSpeedMs: 3600,
      aggroRadius: 6,
      moveSpeedMps: 1.95,
      walkSpeedMps: 0.55,
      behaviour: "territorial",
      drops: [drop("moose_antler_palm", 1, 1, 0.6), drop("cairn_pelt", 1, 2, 0.4), drop("raw_haunch", 1, 2, 0.45)]
    }
  ),
  species(
    "bracken_tapir",
    "vellenwood",
    "forage",
    "A smooth-backed forest browser with a short flexible snout. Keeps to sheltered dry ground beside the marsh.",
    {
      name: "Tapir",
      tier: 5,
      maxHealth: 22,
      attackLevel: 8,
      defenceLevel: 8,
      accuracy: 4,
      armour: 20,
      magicArmour: 28,
      maxHit: 4,
      attackSpeedMs: 3e3,
      aggroRadius: 4,
      moveSpeedMps: 1.1,
      walkSpeedMps: 0.4,
      behaviour: "passive",
      drops: [drop("tapir_leather", 1, 2, 0.7), drop("bramble_hide", 1, 1, 0.35), drop("raw_venison", 1, 1, 0.35)]
    }
  ),
  // Sprawling vertebrates stay on dry ground in the first release.
  species(
    "reedjaw_crocodile",
    "karrowmoor",
    "prowl",
    "A long flat-jawed bank predator with a heavy tail. Basks on dry ground and answers provocation with one weighty bite.",
    {
      name: "Crocodile",
      tier: 10,
      maxHealth: 46,
      attackLevel: 20,
      defenceLevel: 12,
      accuracy: 16,
      armour: 55,
      magicArmour: 30,
      maxHit: 10,
      attackSpeedMs: 3600,
      aggroRadius: 6,
      moveSpeedMps: 1.3,
      walkSpeedMps: 0.35,
      behaviour: "territorial",
      drops: [drop("crocodile_scute", 1, 2, 0.65), drop("cairn_pelt", 1, 1, 0.25), drop("raw_haunch", 1, 2, 0.4)]
    }
  ),
  species(
    "kiln_salamander",
    "kilnhalt",
    "forage",
    "A small-headed crawler sheltering beneath warm damp stone. Its flexible body recoils behind a quick jaw strike.",
    {
      name: "Salamander",
      tier: 20,
      maxHealth: 50,
      attackLevel: 25,
      defenceLevel: 19,
      accuracy: 18,
      armour: 24,
      magicArmour: 90,
      maxHit: 8,
      attackSpeedMs: 2400,
      aggroRadius: 5,
      moveSpeedMps: 0.9,
      walkSpeedMps: 0.32,
      behaviour: "territorial",
      drops: [drop("salamander_secretion", 1, 2, 0.65), drop("fire_essence", 1, 2, 0.25)]
    }
  ),
  species(
    "slateback_tortoise",
    "karrowmoor",
    "forage",
    "A domed shell carries this slow ledge browser. Its beak reaches out between long rests; magic gets through its armor more easily.",
    {
      name: "Tortoise",
      tier: 10,
      maxHealth: 34,
      attackLevel: 16,
      defenceLevel: 13,
      accuracy: 8,
      armour: 90,
      magicArmour: 20,
      maxHit: 7,
      attackSpeedMs: 3600,
      aggroRadius: 4,
      moveSpeedMps: 0.45,
      walkSpeedMps: 0.18,
      behaviour: "territorial",
      drops: [drop("tortoise_shell_plate", 1, 2, 0.65), drop("raw_haunch", 1, 1, 0.25)]
    }
  ),
  species(
    "ashscale_monitor",
    "kilnhalt",
    "prowl",
    "A raised long-necked lizard with a whip tail and spread claws. Patrols dry scree and snaps more often than the crocodile.",
    {
      name: "Monitor Lizard",
      tier: 20,
      maxHealth: 56,
      attackLevel: 27,
      defenceLevel: 20,
      accuracy: 24,
      armour: 40,
      magicArmour: 65,
      maxHit: 9,
      attackSpeedMs: 2400,
      aggroRadius: 9,
      moveSpeedMps: 1.65,
      walkSpeedMps: 0.48,
      behaviour: "aggressive",
      drops: [drop("monitor_sinew", 1, 2, 0.65), drop("charhide", 1, 1, 0.3), drop("raw_ember_haunch", 1, 1, 0.35)]
    }
  ),
  // Ground birds. Wing articulation never implies an airborne movement path.
  species(
    "reedbank_goose",
    "fallowmarch",
    "forage",
    "A long-necked broad-billed bird on the dry reed margin. Spreads its wings and pecks when provoked.",
    {
      name: "Goose",
      tier: 1,
      maxHealth: 10,
      attackLevel: 4,
      defenceLevel: 2,
      accuracy: 2,
      armour: 3,
      magicArmour: 0,
      maxHit: 3,
      attackSpeedMs: 2400,
      aggroRadius: 4,
      moveSpeedMps: 0.5,
      walkSpeedMps: 0.36,
      behaviour: "territorial",
      drops: [drop("goose_down", 1, 3, 0.75), drop("raw_game_meat", 1, 1, 0.45)]
    }
  ),
  species(
    "blackwater_heron",
    "vellenwood",
    "forage",
    "A narrow reed hunter with long legs and a spear bill. Stands between deliberate steps on a dry bank.",
    {
      name: "Heron",
      tier: 5,
      maxHealth: 18,
      attackLevel: 13,
      defenceLevel: 9,
      accuracy: 20,
      armour: 2,
      magicArmour: 26,
      maxHit: 6,
      attackSpeedMs: 3e3,
      aggroRadius: 4,
      moveSpeedMps: 1,
      walkSpeedMps: 0.28,
      behaviour: "territorial",
      drops: [drop("heron_quill", 1, 2, 0.65), drop("bramble_trout", 1, 1, 0.2)]
    }
  ),
  species(
    "scree_bustard",
    "karrowmoor",
    "prowl",
    "A tall deep-chested ground bird ranging the open shelves. Displays before closing with fast light blows.",
    {
      name: "Bustard",
      tier: 10,
      maxHealth: 32,
      attackLevel: 18,
      defenceLevel: 11,
      accuracy: 16,
      armour: 10,
      magicArmour: 70,
      maxHit: 6,
      attackSpeedMs: 1800,
      aggroRadius: 8,
      moveSpeedMps: 1.8,
      walkSpeedMps: 0.55,
      behaviour: "aggressive",
      drops: [drop("bustard_plume", 1, 3, 0.65), drop("raw_haunch", 1, 1, 0.45)]
    }
  ),
  species(
    "marchfield_turkey",
    "fallowmarch",
    "forage",
    "A broad fan-tailed bird with a bare neck and hanging wattle. Struts around its feeding yard and pecks back when attacked.",
    {
      name: "Turkey",
      tier: 1,
      maxHealth: 7,
      attackLevel: 3,
      defenceLevel: 2,
      accuracy: 0,
      armour: 1,
      magicArmour: 2,
      maxHit: 2,
      attackSpeedMs: 2400,
      aggroRadius: 3,
      moveSpeedMps: 1,
      walkSpeedMps: 0.3,
      behaviour: "passive",
      drops: [drop("turkey_tailfeather", 1, 3, 0.75), drop("raw_game_meat", 1, 1, 0.45)]
    }
  ),
  // Crawling invertebrates require their own limb counts and continuous contact gait.
  species(
    "quarry_snail",
    "vellenwood",
    "forage",
    "A spiral-shelled crawler on damp stone. Its eye stalks retract while the shell remains rigid.",
    {
      name: "Snail",
      tier: 5,
      maxHealth: 14,
      attackLevel: 6,
      defenceLevel: 8,
      accuracy: 0,
      armour: 45,
      magicArmour: 5,
      maxHit: 3,
      attackSpeedMs: 3600,
      aggroRadius: 3,
      moveSpeedMps: 0.08,
      walkSpeedMps: 0.025,
      behaviour: "passive",
      drops: [drop("snail_mucus", 1, 2, 0.8), drop("march_stone", 1, 2, 0.2)]
    }
  ),
  species(
    "antler_beetle",
    "karrowmoor",
    "forage",
    "Six planted legs brace a compact shell and branching mandibles. Its slow clamp leaves a long recovery.",
    {
      name: "Stag Beetle",
      tier: 10,
      maxHealth: 30,
      attackLevel: 18,
      defenceLevel: 12,
      accuracy: 12,
      armour: 70,
      magicArmour: 18,
      maxHit: 8,
      attackSpeedMs: 3600,
      aggroRadius: 5,
      moveSpeedMps: 0.9,
      walkSpeedMps: 0.32,
      behaviour: "territorial",
      drops: [drop("beetle_mandible", 1, 1, 0.6), drop("kaldite_ore", 1, 1, 0.15)]
    }
  ),
  species(
    "slag_centipede",
    "kilnhalt",
    "prowl",
    "Paired legs travel in a wave beneath linked armored segments. The forward jaws strike while the body remains on its ground route.",
    {
      name: "Giant Centipede",
      tier: 20,
      maxHealth: 52,
      attackLevel: 26,
      defenceLevel: 20,
      accuracy: 20,
      armour: 65,
      magicArmour: 80,
      maxHit: 7,
      attackSpeedMs: 1800,
      aggroRadius: 7,
      moveSpeedMps: 1.2,
      walkSpeedMps: 0.4,
      behaviour: "aggressive",
      drops: [drop("centipede_chitin", 1, 3, 0.7), drop("venom_gland", 1, 1, 0.25)]
    }
  ),
  species(
    "hollowroot_spider",
    "vellenwood",
    "prowl",
    "Eight legs surround a narrow waist and broad abdomen. A short-range root hunter with quick fang strikes.",
    {
      name: "Giant Spider",
      tier: 5,
      maxHealth: 20,
      attackLevel: 11,
      defenceLevel: 7,
      accuracy: 12,
      armour: 6,
      magicArmour: 30,
      maxHit: 3,
      attackSpeedMs: 1200,
      aggroRadius: 6,
      moveSpeedMps: 1.4,
      walkSpeedMps: 0.42,
      behaviour: "aggressive",
      drops: [drop("spider_thread", 1, 3, 0.75), drop("venom_gland", 1, 1, 0.1)]
    }
  ),
  // Distinct ground-monster sources. These are ordinary encounters, without Orb drops.
  species(
    "cinder_ravager",
    "kilnhalt",
    "patrol",
    "A plated insectoid biped with heavy clawed forearms. Ranges abandoned kiln courts and commits to a slow powerful strike.",
    {
      name: "Armored Demon",
      tier: 20,
      maxHealth: 74,
      attackLevel: 29,
      defenceLevel: 23,
      accuracy: 22,
      armour: 65,
      magicArmour: 45,
      maxHit: 13,
      attackSpeedMs: 3600,
      aggroRadius: 10,
      moveSpeedMps: 3,
      walkSpeedMps: 0.9,
      behaviour: "aggressive",
      drops: [drop("ravager_talon", 1, 2, 0.7), drop("charhide", 1, 1, 0.4), drop("emberite_ore", 1, 2, 0.25)]
    }
  ),
  species(
    "basalt_drake",
    "kilnhalt",
    "prowl",
    "A squat armored drake with dorsal plates and a heavy horned head. Holds an outer quarry bench rather than chasing far.",
    {
      name: "Armored Dragon",
      tier: 20,
      maxHealth: 90,
      attackLevel: 28,
      defenceLevel: 24,
      accuracy: 18,
      armour: 120,
      magicArmour: 30,
      maxHit: 12,
      attackSpeedMs: 3600,
      aggroRadius: 7,
      moveSpeedMps: 2.4,
      walkSpeedMps: 0.7,
      behaviour: "territorial",
      drops: [drop("drake_scale", 1, 3, 0.8), drop("emberite_ore", 1, 2, 0.25), drop("fire_opal", 1, 1, 0.08)]
    }
  ),
  species(
    "gorge_mantis",
    "kilnhalt",
    "prowl",
    "A tall thin-winged insectoid walking on long jointed legs. Quick raptorial claws make it dangerous in sheltered ravines.",
    {
      name: "Giant Mantis",
      tier: 20,
      maxHealth: 58,
      attackLevel: 28,
      defenceLevel: 21,
      accuracy: 24,
      armour: 35,
      magicArmour: 95,
      maxHit: 8,
      attackSpeedMs: 1800,
      aggroRadius: 8,
      moveSpeedMps: 1.8,
      walkSpeedMps: 0.52,
      behaviour: "aggressive",
      drops: [drop("mantis_scythe", 1, 1, 0.55), drop("charhide", 1, 1, 0.35), drop("fire_essence", 1, 2, 0.2)]
    }
  ),
  species(
    "quarry_nightmare",
    "karrowmoor",
    "patrol",
    "A lean raised ground dragon with long clawed legs, a horned head and a thin tail. Keeps to broad abandoned cuts.",
    {
      name: "Pale Dragon",
      tier: 10,
      maxHealth: 66,
      attackLevel: 21,
      defenceLevel: 14,
      accuracy: 16,
      armour: 45,
      magicArmour: 25,
      maxHit: 10,
      attackSpeedMs: 3600,
      aggroRadius: 7,
      moveSpeedMps: 1.65,
      walkSpeedMps: 0.5,
      behaviour: "territorial",
      drops: [drop("nightmare_plate", 1, 2, 0.7), drop("cairn_garnet", 1, 1, 0.08), drop("kaldite_ore", 1, 2, 0.2)]
    }
  )
];

// .baseline/game/src/content/starterCreatures.ts
function small(id, name, assetId, scale, health, behaviour, activity, loot, description, armour = 0, moveSpeedMps = 1.6) {
  return {
    id,
    assetId,
    scale,
    regionId: "fallowmarch",
    activity,
    description,
    stats: {
      id: `${id}_t1`,
      family: id,
      name,
      tier: 1,
      maxHealth: health,
      attackLevel: 2,
      defenceLevel: 1,
      accuracy: 4,
      armour,
      magicArmour: 0,
      maxHit: 2,
      attackSpeedMs: 2400,
      aggroRadius: behaviour === "aggressive" ? 5 : 3,
      moveSpeedMps,
      walkSpeedMps: Math.min(0.4, moveSpeedMps / 3),
      behaviour,
      marks: [1, 3],
      drops: [{ itemId: loot, quantity: [1, 2], chance: 0.65 }]
    }
  };
}
var STARTER_CREATURES = [
  small(
    "grass_viper",
    "Grass Viper",
    "animal_viper",
    0.8,
    8,
    "territorial",
    "prowl",
    "venom_gland",
    "A low grassland snake. Strikes when disturbed and lets passing travelers through."
  ),
  small(
    "field_wasp",
    "Field Wasp",
    "creature_field_wasp",
    0.45,
    7,
    "aggressive",
    "prowl",
    "venom_gland",
    "A small moss-green winged predator guarding scrub away from the farm."
  ),
  small(
    "heath_wasp",
    "Heath Wasp",
    "creature_heath_wasp",
    0.45,
    7,
    "aggressive",
    "prowl",
    "venom_gland",
    "A tiny dusty-brown wasp sheltering in dry scrub. Attacks with a short stinger strike."
  ),
  small(
    "reed_wasp",
    "Reed Wasp",
    "creature_reed_wasp",
    0.45,
    7,
    "aggressive",
    "prowl",
    "venom_gland",
    "A small slate-blue wasp with quiet translucent wings and a sharp sting."
  ),
  small(
    "creek_crab",
    "Creek Crab",
    "animal_crab",
    2.8,
    10,
    "territorial",
    "forage",
    "crab_claw",
    "A small armored bank scavenger. Holds its ground when attacked.",
    25,
    0.6
  ),
  small(
    "briar_spider",
    "Briar Spider",
    "creature_webweaver_spider",
    0.6,
    8,
    "aggressive",
    "prowl",
    "spider_thread",
    "A low bramble hunter. Short-range aggression and a quick mandible strike.",
    0,
    0.95
  ),
  small(
    "granary_rat",
    "Granary Rat",
    "animal_rat",
    1.8,
    6,
    "passive",
    "forage",
    "rat_tail",
    "A small scavenger around abandoned supplies. Retaliates with a bite."
  )
];

// .baseline/game/src/content/redWorms.ts
var RED_WORM_SPECIES = [{
  id: "red_worm",
  assetId: "creature_red_worm",
  scale: 4.8,
  regionId: "fallowmarch",
  activity: "forage",
  description: "A dark red worm nosing through the grass outside Coldbrace.",
  stats: {
    id: "red_worm_t1",
    family: "red_worm",
    name: "Red Worm",
    tier: 1,
    maxHealth: 8,
    attackLevel: 1,
    defenceLevel: 1,
    accuracy: 3,
    armour: 0,
    magicArmour: 0,
    maxHit: 1,
    attackSpeedMs: 2400,
    aggroRadius: 2,
    moveSpeedMps: 0.45,
    walkSpeedMps: 0.15,
    behaviour: "passive",
    marks: [1, 2],
    drops: []
  }
}];

// .baseline/game/src/content/creatureMotionTiming.ts
var CREATURE_MOTION_TIMING = {
  "animal_aurochs": { seconds: 1.8, contactNormalized: 0.575 },
  "animal_bear": { seconds: 2.466667, contactNormalized: 0.15 },
  "animal_boar": { seconds: 0.7, contactNormalized: 0.7 },
  "animal_cattle": { seconds: 1.8, contactNormalized: 0.575 },
  "animal_chicken": { seconds: 0.7, contactNormalized: 0.43 },
  "animal_chicken_speckled": { seconds: 0.7, contactNormalized: 0.43 },
  "animal_coyote": { seconds: 1.4, contactNormalized: 0.525 },
  "animal_crab": { seconds: 0.88, contactNormalized: 0.43 },
  "animal_deer": { seconds: 1.08, contactNormalized: 0.43 },
  "animal_frog": { seconds: 0.68, contactNormalized: 0.43 },
  "animal_frog_green": { seconds: 0.68, contactNormalized: 0.43 },
  "animal_goat": { seconds: 1.466667, contactNormalized: 0.55 },
  "animal_hog": { seconds: 0.86, contactNormalized: 0.43 },
  "animal_ibex": { seconds: 1.533333, contactNormalized: 0.55 },
  "animal_rabbit": { seconds: 0.66, contactNormalized: 0.43 },
  "animal_rabbit_dark": { seconds: 0.66, contactNormalized: 0.43 },
  "animal_rat": { seconds: 0.58, contactNormalized: 0.43 },
  "animal_scorpion": { seconds: 0.8, contactNormalized: 0.45 },
  "animal_viper": { seconds: 1.666667, contactNormalized: 0.525 },
  // Remeasured off the repaired Attack, where the horn actually crosses the target: 0.7 was a
  // third of a second after the strike had already swept past and started back down. Measured
  // offline by `tools/creature-motion/rhino-contact.ts` and confirmed in the production combat
  // lab, where the observed damage lands at normalized 0.392 once the simulation tick quantizes
  // it (test-results/rhino-{air,earth,water}-attack).
  "boss_rhino_air": { seconds: 1.233333, contactNormalized: 0.33229264631653577 },
  "boss_rhino_earth": { seconds: 1.233333, contactNormalized: 0.33229264631653577 },
  "boss_rhino_water": { seconds: 1.233333, contactNormalized: 0.33229264631653577 },
  "creature_redbrush_fox": { seconds: 0.88, contactNormalized: 0.49 },
  "creature_duskoak_lynx": { seconds: 1.02, contactNormalized: 0.43 },
  "creature_rootdelve_badger": { seconds: 1.1, contactNormalized: 0.46 },
  "creature_quillback_porcupine": { seconds: 1.16, contactNormalized: 0.54 },
  "creature_marchwild_horse": { seconds: 1.18, contactNormalized: 0.46 },
  "creature_cairn_bighorn": { seconds: 1.05, contactNormalized: 0.46 },
  "creature_marsh_moose": { seconds: 1.23, contactNormalized: 0.47 },
  "creature_bracken_tapir": { seconds: 0.9, contactNormalized: 0.48 },
  "creature_reedjaw_crocodile": { seconds: 0.833333, contactNormalized: 0.458333 },
  "creature_kiln_salamander": { seconds: 1.08, contactNormalized: 0.43 },
  "creature_slateback_tortoise": { seconds: 1.45, contactNormalized: 0.49 },
  "creature_ashscale_monitor": { seconds: 1.1, contactNormalized: 0.48 },
  "creature_reedbank_goose": { seconds: 1.14, contactNormalized: 0.46 },
  "creature_blackwater_heron": { seconds: 1.05, contactNormalized: 0.455 },
  "creature_scree_bustard": { seconds: 0.8, contactNormalized: 0.455 },
  "creature_marchfield_turkey": { seconds: 0.78, contactNormalized: 0.455 },
  "creature_quarry_snail": { seconds: 1.5, contactNormalized: 0.48 },
  "creature_antler_beetle": { seconds: 1.1, contactNormalized: 0.5 },
  "creature_slag_centipede": { seconds: 0.94, contactNormalized: 0.5 },
  "creature_hollowroot_spider": { seconds: 1.04, contactNormalized: 0.5 },
  "creature_cinder_ravager": { seconds: 2.333333, contactNormalized: 0.235 },
  "creature_basalt_drake": { seconds: 1.6, contactNormalized: 0.65 },
  "creature_gorge_mantis": { seconds: 1, contactNormalized: 0.316667 },
  "creature_quarry_nightmare": { seconds: 1.2, contactNormalized: 0.72 }
};
var CREATURE_PURSUIT_CEILING_MPS = {
  "animal_aurochs": 6.2288,
  "animal_bear": 8.7634,
  "animal_boar": 3.59,
  "animal_cattle": 6.2288,
  "animal_chicken": 1.7626,
  "animal_chicken_speckled": 1.7626,
  "animal_coyote": 7.3224,
  "animal_crab": 0.3957,
  "animal_deer": 6.5502,
  "animal_frog": 0.69,
  "animal_frog_green": 0.69,
  "animal_goat": 4.4859,
  "animal_hog": 1.673,
  "animal_ibex": 4.0096,
  "animal_rabbit": 1.7055,
  "animal_rabbit_dark": 1.7055,
  // animal_rat: stride 0.122 m/s is below the artefact floor
  "animal_scorpion": 0.589,
  // animal_viper: no measured stride
  "boss_rhino_air": 4.9258,
  "boss_rhino_earth": 4.9258,
  "boss_rhino_water": 4.9258,
  "creature_antler_beetle": 2.9474,
  "creature_ashscale_monitor": 3.6429,
  // creature_banshee: no measured stride
  "creature_basalt_drake": 8.8191,
  "creature_beetle_golem": 6.5016,
  "creature_blackwater_heron": 2.262,
  "creature_bracken_tapir": 3.1915,
  "creature_cairn_bighorn": 4.4681,
  "creature_cinder_ravager": 6,
  "creature_duskoak_lynx": 5.0455,
  "creature_goblin_archer": 11.2765,
  "creature_goblin_scout": 11.2787,
  "creature_goblin_shaman": 11.2634,
  "creature_gorge_mantis": 5.6667,
  "creature_grave_ghoul": 14.1415,
  "creature_hollowroot_spider": 3.5357,
  "creature_iron_golem": 22.5261,
  "creature_kiln_salamander": 0.9316,
  "creature_lava_golem": 9.1254,
  "creature_marchfield_turkey": 1.8285,
  "creature_marchwild_horse": 7.0213,
  "creature_marsh_moose": 7.0213,
  // creature_marsh_wasp: no measured stride
  "creature_mossback_sentinel": 3.8976,
  "creature_plague_zombie": 4.0891,
  "creature_quarry_nightmare": 7.6323,
  // creature_quarry_snail: stride 0.054 m/s is below the artefact floor
  "creature_quillback_porcupine": 2.6591,
  "creature_redbrush_fox": 2.16,
  "creature_reedbank_goose": 0.6933,
  "creature_reedjaw_crocodile": 2.9833,
  // creature_revenant: no measured stride
  "creature_rootdelve_badger": 2.8636,
  "creature_scree_bustard": 2.184,
  "creature_shale_elemental": 9.4107,
  "creature_skeleton_archer": 5.1914,
  "creature_skeleton_mage": 5.1914,
  "creature_skeleton_soldier": 5.1914,
  "creature_slag_centipede": 1.7419,
  "creature_slateback_tortoise": 0.9091,
  "creature_stone_golem": 22.5261,
  "creature_webweaver_spider": 2.7324,
  // creature_wraith: no measured stride
  "creature_zombie": 4.0849,
  "miniboss_cinderwake": 19.0918,
  "miniboss_galeskin": 19.0918,
  "miniboss_mossbound": 19.0918,
  "miniboss_tideworn": 19.0918
  // outfit_female_ranger: no measured stride
  // outfit_male_peasant: no measured stride
  // outfit_male_ranger: no measured stride
};
for (const [variant, source] of [
  ["gloam_fox", "redbrush_fox"],
  ["moonweave_spider", "webweaver_spider"],
  ["rimeback_tortoise", "slateback_tortoise"],
  ["cindercrest_salamander", "kiln_salamander"],
  ["amethyst_spider", "webweaver_spider"]
]) {
  const base = `creature_${source}`, id = `creature_${variant}`;
  if (CREATURE_MOTION_TIMING[base]) CREATURE_MOTION_TIMING[id] = { ...CREATURE_MOTION_TIMING[base] };
  if (CREATURE_PURSUIT_CEILING_MPS[base]) CREATURE_PURSUIT_CEILING_MPS[id] = CREATURE_PURSUIT_CEILING_MPS[base];
}
CREATURE_PURSUIT_CEILING_MPS["creature_chalk_warden"] = 10.6341;
CREATURE_PURSUIT_CEILING_MPS["creature_hollow_bough"] = 3.4299;
CREATURE_PURSUIT_CEILING_MPS["creature_briar_harrow"] = 3.8976;
CREATURE_PURSUIT_CEILING_MPS["creature_fen_crawler"] = 2.8964;
CREATURE_PURSUIT_CEILING_MPS["creature_reed_strider"] = 3.3336;
CREATURE_PURSUIT_CEILING_MPS["creature_thorn_maw"] = 6.5016;
CREATURE_PURSUIT_CEILING_MPS["creature_heath_jack"] = 11.2787;
CREATURE_PURSUIT_CEILING_MPS["creature_kiln_marrow"] = 9.1254;
CREATURE_PURSUIT_CEILING_MPS["creature_slag_crawler"] = 2.7324;
CREATURE_PURSUIT_CEILING_MPS["creature_grave_lantern"] = 14.1415;
CREATURE_PURSUIT_CEILING_MPS["creature_cairn_treader"] = 8.1089;
CREATURE_PURSUIT_CEILING_MPS["creature_flint_mandible"] = 5.9942;
CREATURE_PURSUIT_CEILING_MPS["creature_vault_custodian"] = 9.8903;
CREATURE_PURSUIT_CEILING_MPS["creature_blind_cave_weaver"] = 3.1556;
CREATURE_PURSUIT_CEILING_MPS["creature_scree_watcher"] = 26.585;
CREATURE_PURSUIT_CEILING_MPS["creature_baby_red_dragon"] = 1.2841;
CREATURE_PURSUIT_CEILING_MPS["creature_baby_black_dragon"] = 3.2393;
CREATURE_PURSUIT_CEILING_MPS["creature_baby_lava_dragon"] = 1.2582;
CREATURE_PURSUIT_CEILING_MPS["creature_cinderback_crag"] = 3.679;
CREATURE_PURSUIT_CEILING_MPS["creature_red_wilderness_dragon"] = 3.5593;
CREATURE_PURSUIT_CEILING_MPS["creature_rift_carapace"] = 4.0333;
CREATURE_PURSUIT_CEILING_MPS["creature_basalt_maw"] = 6;
CREATURE_PURSUIT_CEILING_MPS["creature_voidstone_colossus"] = 29.2839;
CREATURE_PURSUIT_CEILING_MPS["creature_black_wilderness_dragon"] = 7.8385;
CREATURE_PURSUIT_CEILING_MPS["creature_furnace_grazer"] = 6.3498;
CREATURE_PURSUIT_CEILING_MPS["creature_purple_wilderness_dragon"] = 3.6817;
CREATURE_PURSUIT_CEILING_MPS["creature_boss_tideworn"] = 5.5693;
CREATURE_PURSUIT_CEILING_MPS["creature_boss_tempest_roc"] = 5.7844;
CREATURE_PURSUIT_CEILING_MPS["creature_boss_mossbound"] = 6.6059;
CREATURE_PURSUIT_CEILING_MPS["creature_boss_cinderwake"] = 9.6872;
CREATURE_PURSUIT_CEILING_MPS["creature_boss_ordrun"] = 9.7581;
CREATURE_PURSUIT_CEILING_MPS["creature_furnace_regent"] = 11.0199;
CREATURE_PURSUIT_CEILING_MPS["creature_hollow_star"] = 10.8546;
CREATURE_PURSUIT_CEILING_MPS["creature_ashseal_warden"] = 9.7587;
CREATURE_PURSUIT_CEILING_MPS["creature_nightforge_marshal"] = 31.7487;
CREATURE_PURSUIT_CEILING_MPS["creature_amethyst_dragon"] = 7.8385;
CREATURE_MOTION_TIMING["creature_basalt_maw"] = { seconds: 2.3333332538604736, contactNormalized: 0.235 };
CREATURE_PURSUIT_CEILING_MPS["creature_grave_ghoul"] = 14.1415;
CREATURE_MOTION_TIMING["creature_grave_ghoul"] = { seconds: 1.7999999523162842, contactNormalized: 0.33 };
CREATURE_MOTION_TIMING["creature_grave_lantern"] = { seconds: 1.7999999523162842, contactNormalized: 0.33 };
CREATURE_MOTION_TIMING["creature_furnace_grazer"] = { seconds: 1.600000023841858, contactNormalized: 0.65 };
CREATURE_MOTION_TIMING["creature_ashseal_warden"] = { seconds: 1.5, contactNormalized: 0.4 };
CREATURE_MOTION_TIMING["creature_furnace_regent"] = { seconds: 2, contactNormalized: 0.52 };
CREATURE_MOTION_TIMING["creature_chainbound_archon"] = { seconds: 0.5, contactNormalized: 0.42 };
CREATURE_MOTION_TIMING["creature_hollow_star"] = { seconds: 1, contactNormalized: 0.316667 };
CREATURE_MOTION_TIMING["creature_voidstone_colossus"] = { seconds: 1.1266666650772095, contactNormalized: 0.38 };
CREATURE_MOTION_TIMING["creature_kiln_marrow"] = { seconds: 2, contactNormalized: 0.52 };
CREATURE_MOTION_TIMING["creature_nightforge_marshal"] = { seconds: 1.1266666650772095, contactNormalized: 0.38 };
for (const [variant, source] of [
  ["creature_pearl_knight", "creature_nightforge_marshal"],
  ["creature_ivory_castellan", "creature_nightforge_marshal"],
  ["creature_crown_hart", "animal_deer"],
  ["creature_silverthorn_harrow", "creature_briar_harrow"],
  ["creature_lantern_sprite", "creature_marsh_wasp"],
  ["creature_moonpetal_stalker", "creature_heath_jack"],
  ["creature_dewglass_weaver", "creature_fen_crawler"],
  ["creature_bloomheart_matriarch", "creature_boss_rootheart"],
  ["creature_prismatic_sprite", "creature_marsh_wasp"],
  ["creature_orchid_reaper", "creature_veil_reaper"],
  ["creature_starroot_guardian", "creature_briar_harrow"],
  ["creature_amethyst_sovereign", "creature_hollow_star"]
]) {
  if (CREATURE_MOTION_TIMING[source]) CREATURE_MOTION_TIMING[variant] = { ...CREATURE_MOTION_TIMING[source] };
  if (CREATURE_PURSUIT_CEILING_MPS[source]) CREATURE_PURSUIT_CEILING_MPS[variant] = CREATURE_PURSUIT_CEILING_MPS[source];
}
CREATURE_MOTION_TIMING["fantasy_monster_01"] = { seconds: 2, contactNormalized: 0.4 };
CREATURE_MOTION_TIMING["fantasy_monster_02"] = { seconds: 2, contactNormalized: 0.4 };
CREATURE_MOTION_TIMING["fantasy_monster_03"] = { seconds: 2, contactNormalized: 0.4 };
CREATURE_MOTION_TIMING["fantasy_monster_04"] = { seconds: 2.3333332538604736, contactNormalized: 0.4 };
CREATURE_MOTION_TIMING["fantasy_monster_05"] = { seconds: 2.3333332538604736, contactNormalized: 0.4 };
CREATURE_MOTION_TIMING["fantasy_monster_06"] = { seconds: 2.3333332538604736, contactNormalized: 0.4 };
CREATURE_MOTION_TIMING["fantasy_monster_07"] = { seconds: 2, contactNormalized: 0.4 };
CREATURE_MOTION_TIMING["fantasy_monster_08"] = { seconds: 1, contactNormalized: 0.4 };
CREATURE_MOTION_TIMING["fantasy_monster_09"] = { seconds: 1, contactNormalized: 0.4 };
CREATURE_MOTION_TIMING["fairy_monster_11"] = { seconds: 1.1, contactNormalized: 0.5 };
CREATURE_MOTION_TIMING["fairy_monster_14"] = { seconds: 1.1, contactNormalized: 0.5 };
CREATURE_MOTION_TIMING["fairy_monster_16"] = { seconds: 1.1, contactNormalized: 0.5 };
CREATURE_MOTION_TIMING["fairy_monster_21"] = { seconds: 1.1, contactNormalized: 0.5 };
CREATURE_MOTION_TIMING["fairy_monster_27"] = { seconds: 1.1, contactNormalized: 0.5 };
CREATURE_MOTION_TIMING["fairy_monster_30"] = { seconds: 1.1, contactNormalized: 0.5 };
CREATURE_PURSUIT_CEILING_MPS["fairy_monster_16"] = 3.3342;
CREATURE_PURSUIT_CEILING_MPS["fairy_monster_27"] = 5.0565;
CREATURE_PURSUIT_CEILING_MPS["fairy_monster_30"] = 5.0988;
CREATURE_PURSUIT_CEILING_MPS["fairy_monster_34"] = 3.1874;
CREATURE_PURSUIT_CEILING_MPS["fairy_monster_28"] = 2.2757;
CREATURE_PURSUIT_CEILING_MPS["fairy_monster_31"] = 2.03;
for (const region of ["gloamgarden", "faeholme"]) {
  for (const [form, source] of [
    ["spriggle", "fairy_monster_10"],
    ["sporekin", "creature_goblin_shaman"],
    ["frog", "animal_frog"],
    ["imp", "fairy_monster_19"],
    ["snail", "creature_quarry_snail"],
    ["reliquary", "fairy_monster_28"],
    ["hart", "animal_deer"],
    ["veilspirit", "creature_wraith"],
    ["sapling", "creature_briar_harrow"],
    ["drake", "creature_baby_red_dragon"],
    ["wardling", "fairy_monster_34"],
    ["petalguard", "fairy_monster_31"]
  ]) {
    const id = `fairy_garden_${form}_${region}`;
    const timing = source.startsWith("fairy_monster_") ? { seconds: 1.1, contactNormalized: 0.5 } : CREATURE_MOTION_TIMING[source];
    if (timing) CREATURE_MOTION_TIMING[id] = { ...timing };
    const ceiling = CREATURE_PURSUIT_CEILING_MPS[source];
    if (ceiling) CREATURE_PURSUIT_CEILING_MPS[id] = ceiling;
  }
  for (const number of ["02", "03", "06", "07", "08", "09"]) {
    CREATURE_MOTION_TIMING[`fairy_guardian_${number}_${region}`] = { ...CREATURE_MOTION_TIMING[`fantasy_monster_${number}`] };
  }
}

// .baseline/game/src/core/math.ts
function tierSilhouetteScale(tier) {
  const clamped = Math.min(99, Math.max(1, tier));
  return 0.9 + 0.5 * (Math.log(clamped) / Math.log(99));
}

// .baseline/game/src/content/index.ts
var EMPTY = { items: [], resources: [], recipes: [], spells: [], enemies: [], shops: [] };
var ContentRegistry = class {
  tables = EMPTY;
  itemsById = /* @__PURE__ */ new Map();
  resourcesById = /* @__PURE__ */ new Map();
  recipesById = /* @__PURE__ */ new Map();
  spellsById = /* @__PURE__ */ new Map();
  enemiesById = /* @__PURE__ */ new Map();
  shopsById = /* @__PURE__ */ new Map();
  /** Called once at boot, before any system ticks. */
  register(tables) {
    this.tables = { ...this.tables, ...tables };
    this.itemsById = new Map(this.tables.items.map((row) => [row.id, row]));
    this.resourcesById = new Map(this.tables.resources.map((row) => [row.id, row]));
    this.recipesById = new Map(this.tables.recipes.map((row) => [row.id, row]));
    this.spellsById = new Map(this.tables.spells.map((row) => [row.id, row]));
    this.enemiesById = new Map(this.tables.enemies.map((row) => [row.id, row]));
    this.shopsById = new Map(this.tables.shops.map((row) => [row.id, row]));
  }
  item(id) {
    return this.itemsById.get(id);
  }
  resource(id) {
    return this.resourcesById.get(id);
  }
  recipe(id) {
    return this.recipesById.get(id);
  }
  spell(id) {
    return this.spellsById.get(id);
  }
  enemy(id) {
    return this.enemiesById.get(id);
  }
  shop(id) {
    return this.shopsById.get(id);
  }
  allItems() {
    return this.tables.items;
  }
  allResources() {
    return this.tables.resources;
  }
  allRecipes() {
    return this.tables.recipes;
  }
  allSpells() {
    return this.tables.spells;
  }
  allEnemies() {
    return this.tables.enemies;
  }
  allShops() {
    return this.tables.shops;
  }
  /**
   * Every spell of one element, weakest first.
   *
   * The spellbook is the only caller that needs this shape, and it needs it per element rather than
   * per rung: a player picks "I cast fire" once and then wants the strongest fire spell they
   * qualify for, which is the last row here that passes their Magic level.
   */
  spellsOfElement(element) {
    return this.tables.spells.filter((row) => row.element === element).sort((a, b) => a.reqLevel - b.reqLevel);
  }
  /**
   * The strongest spell of an element a Magic level unlocks, or undefined below the first.
   *
   * Level only. Affordability lives in `systems/combat.ts`, which is the layer that can see the
   * pack; a registry that took an inventory port would make content depend on state.
   */
  bestSpellOfElement(element, magicLevel) {
    let best;
    for (const spell of this.tables.spells) {
      if (spell.element !== element) continue;
      if (magicLevel < spell.reqLevel) continue;
      if (!best || spell.reqLevel > best.reqLevel) best = spell;
    }
    return best;
  }
  /** Recipes a station can make, for the production UI. */
  recipesForStation(station) {
    return this.tables.recipes.filter((row) => row.stations?.includes(station));
  }
  /** Recipes for a skill, ordered by requirement. The skill guide reads this. */
  recipesForSkill(skill) {
    return this.tables.recipes.filter((row) => row.skill === skill).sort((a, b) => a.reqLevel - b.reqLevel);
  }
  /** Every item that equips into a slot, ordered by tier. */
  equipmentForSlot(slot) {
    return this.tables.items.filter((row) => row.equip?.slot === slot).sort((a, b) => a.tier - b.tier);
  }
  isRegistered() {
    return this.tables.items.length > 0;
  }
};
var content = new ContentRegistry();
function gatherXp(tier) {
  return Math.round(10 * Math.pow(tier, 0.55));
}
function recipeXp(tier, craftWeight) {
  return Math.round(gatherXp(tier) * craftWeight);
}
function toolBonus(tier) {
  return Math.min(40, Math.round(1.6 + 0.75 * tier));
}
var PLAYER_HEALTH_PER_LEVEL = 3;
function enemyCombatLevel(def) {
  const offence = (def.attackLevel + 9) * (1 + def.accuracy / 100) - 9;
  const defence = (def.defenceLevel + 9) * (1 + (def.armour + def.magicArmour) / 2 / 100) - 9;
  const health = def.maxHealth / PLAYER_HEALTH_PER_LEVEL;
  return Math.max(1, Math.round(0.5 * offence + 0.25 * defence + 0.25 * health));
}

// .baseline/game/src/content/rpgBestiary.ts
var nativeBounds = {
  giant_rat: [-0.141679335, 4e-3, -0.619674694, 0.283358671, 0.34, 1.239349388],
  wild_goblin: [-0.493633103, 6e-3, -0.256327075, 0.987266206, 1.35, 0.51265415],
  troll_mauler: [-1.558338501, 1e-3, -0.819256479, 3.110015344, 3.075232424, 1.675653406],
  webweaver_spider: [-0.8, 3e-3, -0.625535, 1.6, 0.520136, 1.353785],
  marsh_wasp: [-0.576492, 0.378816, -0.751139, 1.2, 1.882373, 2.482819],
  cave_roach: [-0.592252, 5e-3, -0.924792, 1.184504, 1.15, 1.626328],
  mossback_sentinel: [-1.049472, 3e-3, -1.619951, 2.017049, 4.018234, 2.392775],
  shale_elemental: [-1.393284, 3e-3, -0.795828, 2.778613, 2.55, 1.281181],
  beetle_golem: [-1.237891, 3e-3, -0.529829, 2.475101, 2.55, 1.414106],
  lava_golem: [-0.943108, 3e-3, -0.629999, 1.85112, 2.815493, 1.163049],
  goblin_scout: [-0.254276, 2e-3, -0.271784, 0.541855, 1.327607, 0.512835],
  goblin_archer: [-0.254276, 2e-3, -0.271784, 0.605896, 1.327607, 0.512835],
  goblin_shaman: [-0.267722, 2e-3, -0.904144, 0.474369, 1.328404, 1.503733],
  orc_warrior: [-0.440445, 2e-3, -0.453897, 0.939455, 1.966316, 0.903847],
  orc_berserker: [-0.437784, 2e-3, -0.453897, 0.991211, 1.966316, 1.003561],
  orc_warlord: [-0.449815, 2e-3, -0.453897, 0.948825, 1.966316, 0.999641],
  gnoll_hunter: [-0.450548, 2e-3, -0.811069, 0.864918, 1.796064, 1.378549],
  gnoll_brute: [-0.566822, 2e-3, -0.595868, 0.981192, 1.796064, 1.078706],
  gnoll_chieftain: [-0.421955, 2e-3, -0.396683, 0.836325, 1.796064, 0.87952],
  lizardman_scout: [-0.372655, 2e-3, -0.909, 0.69932, 1.734628, 1.515027],
  lizardman_guard: [-0.333649, 2e-3, -0.909, 0.802464, 1.734628, 1.470446],
  lizardman_shaman: [-0.344195, 2e-3, -1.162961, 0.917055, 1.738904, 1.896518],
  skeleton_soldier: [-0.872977, 3274e-6, -0.38727, 1.229458, 1.595942, 0.835135],
  skeleton_archer: [-0.457728, 3274e-6, -0.38727, 0.837203, 1.649144, 0.812991],
  skeleton_mage: [-0.465797, 3274e-6, -0.38727, 0.85874, 1.944003, 0.812991],
  zombie: [-0.366457, 0.010608, -0.294692, 0.706815, 1.355349, 0.732274],
  plague_zombie: [-0.360696, 0.013174, -0.312365, 0.706227, 1.354252, 0.750708],
  grave_ghoul: [-0.354186, 1e-3, -0.267868, 0.770518, 1.065226, 0.712601],
  wraith: [-0.329546, 0.09, -0.462466, 0.585141, 1.731475, 1.265196],
  banshee: [-0.3706, 0.09, -0.462466, 0.649938, 1.869651, 1.265196],
  revenant: [-0.350503, 0.09, -0.310453, 0.748118, 1.723984, 0.516036],
  stone_golem: [-0.701402, 3e-3, -0.614629, 1.511812, 2.140015, 1.193236],
  iron_golem: [-0.723342, 3e-3, -0.670835, 1.551952, 2.341389, 1.290052],
  fire_golem: [-0.75501, 3e-3, -0.693356, 1.589861, 2.219845, 1.271963],
  harpy: [-0.465834, 2e-3, -0.374225, 0.943939, 1.813311, 0.775834],
  cliff_harpy: [-0.465834, 2e-3, -0.374225, 0.943939, 1.808541, 0.775834],
  storm_harpy: [-0.465834, 2e-3, -0.380875, 0.943939, 1.89388, 0.782484],
  gargoyle: [-1.322836, 1e-3, -0.735638, 2.433198, 2.375324, 1.066589],
  obsidian_gargoyle: [-1.145799, 1e-3, -0.796021, 2.059469, 2.622583, 1.126972],
  ancient_gargoyle: [-1.673159, 108e-5, -0.81406, 3.1165, 2.826226, 1.171487],
  minotaur: [-0.510895, 2e-3, -0.514962, 1.078798, 2.509786, 1.090392],
  labyrinth_guardian: [-0.538139, 2e-3, -0.550211, 1.436629, 2.449201, 1.12605],
  elder_minotaur: [-0.579754, 2e-3, -0.561645, 1.231625, 2.590493, 1.137348],
  imp: [-0.515704, 66e-5, -0.503711, 1.046599, 1.574378, 0.732477],
  horned_demon: [-0.78137, 1e-3, -0.334879, 1.585756, 2.329191, 0.66583],
  abyssal_demon: [-0.875134, 113e-5, -0.748775, 1.776046, 3.158813, 1.106203]
};
var importedSources = {
  webweaver_spider: { author: "Quaternius", license: "CC0-1.0", generator: "tools/rpg-bestiary/whole-insects/index.mjs" },
  marsh_wasp: { author: "Quaternius", license: "CC0-1.0", generator: "tools/rpg-bestiary/whole-insects/index.mjs" },
  cave_roach: { author: "Atmostatic; animation and textures by Danimal", license: "CC-BY-SA-3.0", generator: "tools/rpg-bestiary/roach-source/roach.mjs" },
  giant_rat: { author: "CDmir and TinyWorlds", license: "CC0-1.0", generator: "tools/rpg-bestiary/giant-rat-source/giant-rat.mjs" },
  wild_goblin: { author: "Danimal; body xGhostx7; knife Wind astella", license: "CC-BY-3.0", generator: "tools/rpg-bestiary/mocap-goblin-source/goblin.mjs" },
  troll_mauler: { author: "piacenti", license: "CC-BY-3.0", generator: "tools/rpg-bestiary/troll-mauler-source/index.mjs" },
  mossback_sentinel: { author: "\u010Cestm\xEDr Dammer (CDmir)", license: "CC0-1.0", generator: "tools/rpg-bestiary/forest-monster-source/forest-monster.mjs" },
  shale_elemental: { author: "piacenti", license: "CC-BY-3.0", generator: "tools/rpg-bestiary/earth-elemental-source/earth.mjs" },
  beetle_golem: { author: "killyoverdrive; animation by Dm3d", license: "CC-BY-SA-3.0", generator: "tools/rpg-bestiary/beetle-golem-source/beetle.mjs" },
  lava_golem: { author: "gavlig; replacement rock maps by Corealm", license: "CC0-1.0 source; original project replacement maps", generator: "tools/rpg-bestiary/lava-golem-source/lava-golem.mjs" },
  "goblin_scout": {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "goblin_archer": {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "goblin_shaman": {
    "author": "Quaternius; Blink staff",
    "license": "CC0-1.0 plus Blink weapon Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "orc_warrior": {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "gnoll_hunter": {
    "author": "Quaternius; Jan Pec animal head",
    "license": "CC0-1.0 plus Animal Pack Deluxe Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "lizardman_scout": {
    "author": "Quaternius; Jan Pec animal head",
    "license": "CC0-1.0 plus Animal Pack Deluxe Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "skeleton_soldier": {
    "author": "Polygon Blacksmith",
    "license": "Standard Unity Asset Store EULA; local entitlement cache",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "skeleton_archer": {
    "author": "Polygon Blacksmith",
    "license": "Standard Unity Asset Store EULA; local entitlement cache",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "skeleton_mage": {
    "author": "Polygon Blacksmith",
    "license": "Standard Unity Asset Store EULA; local entitlement cache",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "zombie": {
    "author": "Quaternius; Corealm corpse proportion, damage and clothing edits",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "plague_zombie": {
    "author": "Quaternius; Corealm corpse proportion, damage and clothing edits",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "grave_ghoul": {
    "author": "Quaternius; Corealm corpse proportion, damage and clothing edits",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "wraith": {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "banshee": {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "revenant": {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "stone_golem": {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "iron_golem": {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "fire_golem": {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "gargoyle": {
    "author": "PixeliusVita",
    "license": "Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "obsidian_gargoyle": {
    "author": "PixeliusVita",
    "license": "Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "ancient_gargoyle": {
    "author": "PixeliusVita",
    "license": "Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "minotaur": {
    "author": "Quaternius; janpec",
    "license": "CC0-1.0 humanoid, clothing, axe and animations; Standard Unity Asset Store EULA; project owner must confirm entitlement for animal-pack-deluxe",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "imp": {
    "author": "PixeliusVita",
    "license": "Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "horned_demon": {
    "author": "PixeliusVita",
    "license": "Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "abyssal_demon": {
    "author": "PixeliusVita",
    "license": "Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "orc_berserker": {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "orc_warlord": {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "gnoll_brute": {
    "author": "Quaternius; Jan Pec animal head",
    "license": "CC0-1.0 plus Animal Pack Deluxe Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "gnoll_chieftain": {
    "author": "Quaternius; Jan Pec animal head",
    "license": "CC0-1.0 plus Animal Pack Deluxe Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "lizardman_guard": {
    "author": "Quaternius; Jan Pec animal head",
    "license": "CC0-1.0 plus Animal Pack Deluxe Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "lizardman_shaman": {
    "author": "Quaternius; Jan Pec animal head",
    "license": "CC0-1.0 plus Animal Pack Deluxe Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "labyrinth_guardian": {
    "author": "Quaternius; janpec",
    "license": "CC0-1.0 humanoid, clothing, axe and animations; Standard Unity Asset Store EULA; project owner must confirm entitlement for animal-pack-deluxe",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "elder_minotaur": {
    "author": "Quaternius; janpec",
    "license": "CC0-1.0 humanoid, clothing, axe and animations; Standard Unity Asset Store EULA; project owner must confirm entitlement for animal-pack-deluxe",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "harpy": {
    "author": "Quaternius and Corealm",
    "license": "CC0-1.0 source packs; Corealm additions project-owned",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "cliff_harpy": {
    "author": "Quaternius and Corealm",
    "license": "CC0-1.0 source packs; Corealm additions project-owned",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "storm_harpy": {
    "author": "Quaternius and Corealm",
    "license": "CC0-1.0 source packs; Corealm additions project-owned",
    "generator": "tools/rpg-bestiary/build.mjs"
  }
};
var rows = [
  ["webweaver_spider", "Webweaver Spider", "spider", "vellenwood", 5, "skirmisher", "fang bite", "woodland web hollows"],
  ["marsh_wasp", "Marsh Wasp", "wasp", "vellenwood", 5, "skirmisher", "stinger strike", "reedbank nest margins"],
  ["goblin_scout", "Goblin Scout", "goblin", "fallowmarch", 1, "skirmisher", "dagger thrust", "hedge camps"],
  ["goblin_archer", "Goblin Archer", "goblin", "fallowmarch", 1, "skirmisher", "bow shot", "hedge camp lookouts"],
  ["goblin_shaman", "Goblin Shaman", "goblin", "fallowmarch", 5, "caster", "staff curse", "abandoned farm circles"],
  ["orc_warrior", "Orc Warrior", "orc", "vellenwood", 5, "fighter", "axe chop", "logging camp ruins"],
  ["orc_berserker", "Orc Berserker", "orc", "vellenwood", 10, "brute", "overhead cleave", "forest war camps"],
  ["orc_warlord", "Orc Warlord", "orc", "karrowmoor", 20, "guard", "heavy cleave", "fortified highland camps"],
  ["skeleton_soldier", "Skeleton Soldier", "skeleton", "vellenwood", 5, "fighter", "sword cut", "dry crypt approaches"],
  ["skeleton_archer", "Skeleton Archer", "skeleton", "vellenwood", 5, "skirmisher", "bow shot", "ruined watch posts"],
  ["skeleton_mage", "Skeleton Mage", "skeleton", "kilnhalt", 20, "caster", "staff curse", "sealed burial halls"],
  ["zombie", "Zombie", "zombie", "fallowmarch", 1, "brute", "grasp", "abandoned graveyards"],
  ["plague_zombie", "Plague Zombie", "zombie", "kilnhalt", 20, "brute", "grasp", "abandoned infirmaries"],
  ["grave_ghoul", "Grave Ghoul", "zombie", "vellenwood", 10, "skirmisher", "claw rake", "graveyard hollows"],
  ["wraith", "Wraith", "wraith", "vellenwood", 10, "caster", "spectral touch", "ruined forest shrines"],
  ["banshee", "Banshee", "wraith", "kilnhalt", 20, "caster", "lament", "buried chapel rooms"],
  ["revenant", "Revenant", "wraith", "kilnhalt", 20, "guard", "spectral cut", "sealed tomb guards"],
  ["stone_golem", "Stone Golem", "golem", "karrowmoor", 10, "guard", "hammer fist", "abandoned quarry yards"],
  ["iron_golem", "Iron Golem", "golem", "karrowmoor", 20, "guard", "hammer fist", "ruined forge yards"],
  ["fire_golem", "Fire Golem", "golem", "kilnhalt", 20, "brute", "furnace slam", "cold kiln chambers"],
  ["harpy", "Harpy", "harpy", "vellenwood", 5, "skirmisher", "wing strike", "dry forest crags"],
  ["cliff_harpy", "Cliff Harpy", "harpy", "karrowmoor", 10, "skirmisher", "wing strike", "cliff nesting shelves"],
  ["storm_harpy", "Storm Harpy", "harpy", "karrowmoor", 20, "caster", "wing strike", "exposed summit ruins"],
  ["gargoyle", "Gargoyle", "gargoyle", "karrowmoor", 10, "guard", "stone claw", "ruined gate courts"],
  ["obsidian_gargoyle", "Obsidian Gargoyle", "gargoyle", "kilnhalt", 20, "guard", "stone claw", "volcanic temple floors"],
  ["ancient_gargoyle", "Ancient Gargoyle", "gargoyle", "karrowmoor", 20, "brute", "stone claw", "forgotten monument courts"],
  ["gnoll_hunter", "Gnoll Hunter", "gnoll", "fallowmarch", 5, "skirmisher", "spear thrust", "grassland hunting camps"],
  ["gnoll_brute", "Gnoll Brute", "gnoll", "karrowmoor", 10, "brute", "club swing", "rocky hunting dens"],
  ["gnoll_chieftain", "Gnoll Chieftain", "gnoll", "karrowmoor", 20, "guard", "heavy spear thrust", "ridge hunting camps"],
  ["lizardman_scout", "Lizardman Scout", "lizardman", "vellenwood", 5, "skirmisher", "spear thrust", "dry reedbank camps"],
  ["lizardman_guard", "Lizardman Guard", "lizardman", "vellenwood", 10, "guard", "spear thrust", "marsh ruin approaches"],
  ["lizardman_shaman", "Lizardman Shaman", "lizardman", "vellenwood", 10, "caster", "staff curse", "marsh shrine clearings"],
  ["minotaur", "Minotaur", "minotaur", "karrowmoor", 10, "brute", "axe sweep", "broad ruin courts"],
  ["labyrinth_guardian", "Labyrinth Guardian", "minotaur", "karrowmoor", 20, "guard", "heavy axe sweep", "labyrinth outer courts"],
  ["elder_minotaur", "Elder Minotaur", "minotaur", "kilnhalt", 20, "brute", "overhead axe strike", "buried labyrinth halls"],
  ["imp", "Imp", "demon", "kilnhalt", 10, "skirmisher", "claw jab", "abandoned furnace niches"],
  ["horned_demon", "Horned Demon", "demon", "kilnhalt", 20, "fighter", "claw rake", "broken summoning rooms"],
  ["abyssal_demon", "Abyssal Demon", "demon", "kilnhalt", 20, "brute", "claw sweep", "deep ritual halls"]
];
function entry([id, name, bodyFamily, regionId, tier, role, action, habitat]) {
  const sourceId = id === "fire_golem" ? "lava_golem" : id;
  const bounds = nativeBounds[sourceId];
  const nativeSize = bounds.slice(3);
  const nativeBase = bounds.slice(0, 3);
  const nativeVisualRadius = Math.hypot(Math.max(Math.abs(bounds[0]), Math.abs(bounds[0] + bounds[3])), Math.max(Math.abs(bounds[2]), Math.abs(bounds[2] + bounds[5])));
  const brute = role === "brute", guard = role === "guard", caster = role === "caster", swift = role === "skirmisher";
  const generator = ["goblin", "orc", "gnoll", "lizardman"].includes(bodyFamily) ? "humanoids" : ["skeleton", "zombie", "wraith", "golem"].includes(bodyFamily) ? "undead" : "mythic";
  const attackSpeedMs = brute ? 3400 : guard ? 3e3 : caster ? 2800 : swift ? 2e3 : 2400;
  const attackStyle = action === "bow shot" ? "ranged" : action === "staff curse" || action === "lament" ? "magic" : "melee";
  const essence = { fallowmarch: "air_essence", vellenwood: "earth_essence", karrowmoor: "water_essence", kilnhalt: "fire_essence" }[regionId];
  const stats = {
    id: `${id}_t${tier}`,
    family: id,
    name,
    tier,
    attackStyle,
    attackRangeM: attackStyle === "melee" ? 1.8 : attackStyle === "ranged" ? 10 : 8,
    maxHealth: Math.round((8 + tier * 2.2) * (brute ? 1.4 : guard ? 1.2 : caster ? 0.8 : 1)),
    attackLevel: tier + (brute ? 6 : 2),
    defenceLevel: tier + (guard ? 4 : 0),
    accuracy: swift ? 12 : caster ? 16 : 6,
    armour: guard ? 45 : brute ? 16 : caster ? 3 : 10,
    magicArmour: caster ? 55 : bodyFamily === "golem" ? 5 : 15,
    maxHit: Math.max(2, Math.round(tier * 0.45 + (brute ? 4 : 1))),
    attackSpeedMs,
    aggroRadius: swift ? 10 : 7,
    moveSpeedMps: brute ? 1.2 : guard ? 1.3 : 1.6,
    walkSpeedMps: 0.4,
    behaviour: bodyFamily === "golem" || bodyFamily === "gargoyle" ? "territorial" : "aggressive",
    drops: [{ itemId: essence, quantity: [1, Math.max(1, Math.ceil(tier / 10))], chance: caster ? 0.45 : 0.15 }],
    marks: [Math.max(1, tier), Math.max(3, tier * 3)]
  };
  return {
    id,
    assetId: `creature_${sourceId}`,
    scale: 1,
    regionId,
    activity: "patrol",
    stats,
    description: `${name} inhabits ${habitat}. Uses ${action} with ${attackSpeedMs / 1e3} seconds between attacks.`,
    bodyFamily,
    rigFamily: `corealm_${bodyFamily}`,
    movement: bodyFamily === "wraith" ? "hover" : bodyFamily === "spider" || bodyFamily === "roach" ? "arthropod" : bodyFamily === "wasp" ? "flying" : bodyFamily === "rat" ? "quadruped" : "biped",
    habitat,
    nativeSize,
    nativeBase,
    nativeVisualRadius,
    nativeBodyRadius: Math.max(0.3, Math.max(nativeSize[0], nativeSize[2]) / 2),
    respawnMs: 3e4,
    attack: { action, proposedMechanic: action === "bow shot" ? "projectile" : action === "staff curse" || action === "lament" ? "spell" : "melee", recoveryMs: Math.round(attackSpeedMs * 0.45) },
    source: importedSources[sourceId] ?? { author: "Corealm", license: "Original project asset", generator: `tools/rpg-bestiary/${generator}.mjs` },
    acceptance: "candidate"
  };
}
var retainedFamilies = /* @__PURE__ */ new Set(["goblin", "skeleton", "zombie", "wraith", "golem", "spider", "wasp"]);
var acceptedCompleteSources = [
  entry(["shale_elemental", "Shale Elemental", "elemental", "karrowmoor", 10, "guard", "stone punch", "exposed shale beds"]),
  entry(["lava_golem", "Lava Golem", "elemental", "kilnhalt", 10, "brute", "two-arm stone smash", "cooling volcanic chambers"]),
  entry(["mossback_sentinel", "Mossback Sentinel", "forest_creature", "vellenwood", 10, "brute", "root-arm strike", "old woodland groves"]),
  entry(["beetle_golem", "Beetle Golem", "golem", "vellenwood", 10, "guard", "plated forelimb strike", "mossy ruin courts"])
];
var RPG_BESTIARY = [...rows.filter((row) => retainedFamilies.has(row[2])).map(entry), ...acceptedCompleteSources];
var RPG_BESTIARY_BY_ID = new Map(RPG_BESTIARY.map((row) => [row.id, row]));
var RPG_BESTIARY_STAGED = [
  entry(["giant_rat", "Giant Rat", "rat", "fallowmarch", 3, "skirmisher", "biting lunge", "old granaries and creek banks"]),
  entry(["wild_goblin", "Wild Goblin", "goblin", "vellenwood", 5, "skirmisher", "knife slash", "fern thickets and woodland ruins"]),
  entry(["troll_mauler", "Troll Mauler", "troll", "karrowmoor", 12, "brute", "heavy fist strike", "rocky hollows and abandoned quarries"]),
  entry(["cave_roach", "Cave Roach", "roach", "karrowmoor", 5, "skirmisher", "mandible snap", "sheltered limestone hollows"])
];
var RPG_BESTIARY_STAGED_BY_ID = new Map(RPG_BESTIARY_STAGED.map((row) => [row.id, row]));
var RPG_BESTIARY_REVIEW_BY_ID = new Map([...RPG_BESTIARY, ...RPG_BESTIARY_STAGED].map((row) => [row.id, row]));

// .baseline/game/src/content/creatureRedesign.ts
var CREATURE_REDESIGNS = [
  {
    id: "chalk_warden",
    source: "shale_elemental",
    name: "Chalk Warden",
    regionId: "karrowmoor",
    description: "A broad, low stone guardian with weathered chalk plates and a deliberate hammering gait.",
    health: 48
  },
  {
    id: "hollow_bough",
    source: "mossback_sentinel",
    name: "Hollow Bough",
    regionId: "wilderness",
    description: "A leafless, petrified forest guardian. Its split trunk bends forward before a sweeping root-arm strike.",
    health: 70
  },
  {
    id: "pallid_shade",
    source: "wraith",
    name: "Pallid Shade",
    regionId: "wilderness",
    description: "A hollow shroud drifting above the graves. Its hem and outstretched hands move without a walking step.",
    health: 32
  }
].map((row) => {
  const base = RPG_BESTIARY_BY_ID.get(row.source);
  return {
    id: row.id,
    assetId: `creature_${row.id}`,
    scale: 1,
    regionId: row.regionId,
    activity: "patrol",
    description: row.description,
    stats: {
      ...base.stats,
      id: `${row.id}_t10`,
      family: row.id,
      name: row.name,
      tier: 10,
      maxHealth: row.health,
      behaviour: row.id === "chalk_warden" ? "territorial" : "aggressive",
      drops: [{ itemId: row.id === "chalk_warden" ? "water_essence" : "earth_essence", quantity: [1, 2], chance: 0.4 }]
    }
  };
});

// .baseline/game/src/content/forestCreatureRedesigns.ts
var FOREST_CREATURE_REDESIGNS = [
  {
    id: "briar_harrow",
    source: "mossback_sentinel",
    name: "Briar Harrow",
    regionId: "vellenwood",
    scale: 0.85,
    activity: "patrol",
    health: 64,
    behaviour: "territorial",
    description: "A bowed, hollow trunk carried by root hands. Its shoulder roots turn inward around a dark body cavity, and its heavy arms sweep low across the forest floor."
  },
  {
    id: "fen_crawler",
    source: "webweaver_spider",
    name: "Fen Crawler",
    regionId: "vellenwood",
    scale: 1,
    activity: "prowl",
    health: 26,
    behaviour: "aggressive",
    description: "An eight-legged fen scavenger under a broad, overlapping carapace. Curved feeding blades frame a recessed mouth beneath its low front shield."
  },
  {
    id: "reed_strider",
    source: "webweaver_spider",
    name: "Reed Strider",
    regionId: "vellenwood",
    scale: 1,
    activity: "forage",
    health: 22,
    behaviour: "territorial",
    description: "A six-legged wetland mimic with a raised reed-thin body, folded walking limbs, tapered abdomen and a long split feeding mask."
  },
  {
    id: "thorn_maw",
    source: "beetle_golem",
    name: "Thorn Maw",
    regionId: "vellenwood",
    scale: 0.85,
    activity: "prowl",
    health: 56,
    behaviour: "aggressive",
    description: "A rooted biped whose upper body is a split seedpod. Thick wooden jaw valves hinge around a hollow mouth while its heavy forearms drive a close crushing strike."
  },
  {
    id: "heath_jack",
    source: "goblin_scout",
    name: "Heath Jack",
    regionId: "fallowmarch",
    scale: 1,
    activity: "patrol",
    health: 23,
    behaviour: "aggressive",
    description: "A long-armed heath scavenger in worn cloth. Its hollow carved face has open eye slits and a downturned cambium nose; its hands and knife move with quick, narrow cuts."
  }
].map((row) => {
  const base = RPG_BESTIARY_BY_ID.get(row.source);
  return {
    id: row.id,
    assetId: `creature_${row.id}`,
    scale: row.scale,
    regionId: row.regionId,
    activity: row.activity,
    description: row.description,
    stats: {
      ...base.stats,
      id: `${row.id}_t10`,
      family: row.id,
      name: row.name,
      tier: 10,
      maxHealth: row.health,
      behaviour: row.behaviour,
      drops: [{ itemId: "earth_essence", quantity: [1, 2], chance: 0.35 }]
    }
  };
});

// .baseline/game/src/content/ashCreatureRedesigns.ts
var ASH_CREATURE_REDESIGNS = [
  {
    id: "kiln_marrow",
    source: "lava_golem",
    name: "Kiln Marrow",
    regionId: "kilnhalt",
    health: 74,
    tier: 20,
    scale: 0.88,
    description: "A hunched stone giant with long, heavy arms. Banked heat shows through narrow cracks in its cooled ash hide."
  },
  {
    id: "slag_crawler",
    source: "webweaver_spider",
    name: "Slag Crawler",
    regionId: "kilnhalt",
    health: 38,
    tier: 10,
    scale: 1,
    description: "An eight-legged furnace scavenger with overlapping slag plates, a shovel mouth and folding mandibles. Its body rocks over a low, heavy support gait."
  },
  {
    id: "cinder_penitent",
    source: "revenant",
    name: "Cinder Penitent",
    regionId: "kilnhalt",
    health: 52,
    tier: 20,
    scale: 1,
    description: "An apparition in a pale ash cowl and scorched maroon robes. A dark face slit sits above its long reaching hands."
  },
  {
    id: "grave_lantern",
    source: "grave_ghoul",
    name: "Ashen Ghoul",
    regionId: "wilderness",
    health: 46,
    tier: 20,
    scale: 1.08,
    description: "A crouched corpse with cold pale skin and torn dark clothing. Its long arms hang beside a lean, hunched torso as it searches the graves."
  },
  {
    id: "veil_reaper",
    source: "banshee",
    name: "Veil Reaper",
    regionId: "wilderness",
    health: 58,
    tier: 20,
    scale: 1.05,
    description: "A hooded apparition in worn ceremonial cloth. Long sleeves follow its hooked hands through a sweeping strike."
  }
].map((row) => {
  const base = RPG_BESTIARY_BY_ID.get(row.source);
  return {
    id: row.id,
    assetId: `creature_${row.id}`,
    scale: row.scale,
    regionId: row.regionId,
    activity: "patrol",
    description: row.description,
    stats: {
      ...base.stats,
      id: `${row.id}_t${row.tier}`,
      family: row.id,
      name: row.name,
      tier: row.tier,
      maxHealth: row.health,
      attackStyle: "melee",
      attackRangeM: row.id === "kiln_marrow" ? 2.1 : 1.8,
      behaviour: row.id === "kiln_marrow" ? "territorial" : "aggressive",
      drops: [{ itemId: row.regionId === "kilnhalt" ? "fire_essence" : "earth_essence", quantity: [1, 2], chance: 0.35 }]
    }
  };
});

// .baseline/game/src/content/stoneCreatureRedesigns.ts
var STONE_CREATURE_REDESIGNS = [
  {
    id: "cairn_treader",
    source: "shale_elemental",
    name: "Cairn Treader",
    regionId: "karrowmoor",
    tier: 10,
    health: 52,
    scale: 0.9,
    description: "A low, weathered slab creature with a recessed head and heavy hammer forearms. It transfers its weight before striking."
  },
  {
    id: "flint_mandible",
    source: "beetle_golem",
    name: "Flint Mandible",
    regionId: "karrowmoor",
    tier: 10,
    health: 46,
    scale: 0.8,
    description: "A stone burrower with a flattened shovel cranium and wide digging claws. Its upper body sweeps sideways while its feet brace."
  },
  {
    id: "vault_custodian",
    source: "iron_golem",
    name: "Vault Custodian",
    regionId: "gravelmaw",
    tier: 10,
    health: 64,
    scale: 1,
    description: "A walking remnant of a sealed vault. Its hollow masonry chest and massive lintel arms close around intruders."
  },
  {
    id: "blind_cave_weaver",
    source: "webweaver_spider",
    name: "Blind Cave Weaver",
    regionId: "gravelmaw",
    tier: 10,
    health: 30,
    scale: 1,
    description: "An eyeless cave hunter with a cleft abdomen, a low sensory hood and long searching forelegs. It feels for movement before lunging."
  },
  {
    id: "scree_watcher",
    source: "stone_golem",
    name: "Scree Watcher",
    regionId: "karrowmoor",
    tier: 10,
    health: 40,
    scale: 1,
    description: "An eroded stone effigy with tapered stilt legs, a closed split hood and flat forearms. It turns its torso to listen across the scree."
  }
].map((row) => {
  const source = RPG_BESTIARY_BY_ID.get(row.source);
  return {
    id: row.id,
    assetId: `creature_${row.id}`,
    regionId: row.regionId,
    scale: row.scale,
    activity: "patrol",
    description: row.description,
    stats: {
      ...source.stats,
      id: `${row.id}_t${row.tier}`,
      family: row.id,
      name: row.name,
      tier: row.tier,
      maxHealth: row.health,
      behaviour: row.regionId === "gravelmaw" ? "aggressive" : "territorial"
    }
  };
});

// .baseline/game/src/content/encounterBalance.ts
function tuneEnemyCombatLevel(base, targetLevel, tier = base.tier) {
  const target = Math.max(1, Math.round(targetLevel));
  const sample = (factor) => ({
    ...base,
    tier,
    maxHealth: Math.max(3, Math.round(base.maxHealth * factor)),
    attackLevel: Math.max(1, Math.round(base.attackLevel * factor)),
    defenceLevel: Math.max(1, Math.round(base.defenceLevel * factor)),
    accuracy: Math.max(0, Math.round(Math.min(80, base.accuracy) * Math.min(1, factor))),
    armour: Math.max(0, Math.round(Math.min(80, base.armour) * Math.min(1, factor))),
    magicArmour: Math.max(0, Math.round(Math.min(80, base.magicArmour) * Math.min(1, factor))),
    maxHit: Math.max(1, Math.round(base.maxHit * Math.pow(factor, 0.68)))
  });
  let low = 0, high = 1;
  while (enemyCombatLevel(sample(high)) < target) high *= 2;
  let best = sample(high);
  for (let i = 0; i < 48; i++) {
    const mid = (low + high) / 2, candidate = sample(mid);
    const level = enemyCombatLevel(candidate);
    if (Math.abs(level - target) < Math.abs(enemyCombatLevel(best) - target)) best = candidate;
    if (level < target) low = mid;
    else high = mid;
  }
  const offence = (best.attackLevel + 9) * (1 + best.accuracy / 100) - 9;
  const defence = (best.defenceLevel + 9) * (1 + (best.armour + best.magicArmour) / 200) - 9;
  best.maxHealth = Math.max(3, Math.round((target - 0.5 * offence - 0.25 * defence) * 12));
  if (enemyCombatLevel(best) !== target) throw new Error(`Cannot tune ${base.id} to combat level ${target}`);
  return best;
}
var REGION_COMBAT_TIERS = {
  fallowmarch: 1,
  vellenwood: 5,
  karrowmoor: 10,
  gravelmaw: 10,
  kilnhalt: 20,
  wilderness: 50,
  crownward: 40,
  gloamgarden: 30,
  faeholme: 60
};
var REGIONAL_BOSS_LEVELS = {
  // Fallowmarch's ordinary residents already reach level 6 on their own stats, so a tier-1 boss
  // needs a much larger multiplier than the tier 5+ regions to stay above its own trash mobs.
  galeskin: { tier: 1, multiplier: 11 },
  tempest_roc: { tier: 1, multiplier: 13 },
  mossbound: { tier: 5, multiplier: 3 },
  rootheart: { tier: 5, multiplier: 5 },
  tideworn: { tier: 10, multiplier: 4 },
  ordrun: { tier: 10, multiplier: 5 },
  cinderwake: { tier: 20, multiplier: 4 }
};

// .baseline/game/src/content/wildernessDragons.ts
var DRAGON_SPECIES = [
  { id: "baby_red_dragon", name: "Red Dragon Hatchling", tier: 50, combatLevel: 50, description: "A red hatchling with a broad brow, short tail and developing wing fingers. It braces on its rear claws before snapping forward." },
  { id: "baby_black_dragon", name: "Black Dragon Hatchling", tier: 50, combatLevel: 53, description: "A low black hatchling with a short hooked muzzle, round throat and broad small wings. It stalks the charcoal flats." },
  { id: "baby_lava_dragon", name: "Cinder Dreadwing", tier: 50, combatLevel: 56, description: "A lean volcanic dreadwing with a tucked throat, long tail and copper-red hide above an ochre underside." },
  { id: "red_wilderness_dragon", name: "Red Wilderness Dragon", tier: 70, combatLevel: 72, description: "A tall red wyvern with a spear-shaped skull, hooked wing claws and a long blade tail. Its rear legs brace a heavy neck strike." },
  { id: "black_wilderness_dragon", name: "Black Wilderness Dragon", tier: 70, combatLevel: 75, description: "A black four-legged dragon with a long low neck, backward crown horns and broad sail wings." },
  { id: "purple_wilderness_dragon", name: "Violet Dreadwing", tier: 70, combatLevel: 78, description: "A narrow-bodied dreadwing with a raised throat, long legs and a swept tail. Pale horns break up its plum hide and violet wing membranes." },
  { id: "amethyst_dragon", name: "Purple Wilderness Dragon", tier: 70, combatLevel: 78, description: "A lean purple dragon with a long neck and dark sail wings. Fine amethyst light follows the grain of its scales." }
].map((row) => ({
  id: row.id,
  assetId: `creature_${row.id}`,
  scale: 1 / tierSilhouetteScale(row.tier),
  regionId: "wilderness",
  activity: "prowl",
  description: row.description,
  stats: tuneEnemyCombatLevel({
    id: `${row.id}_t${row.tier}`,
    family: row.id,
    name: row.name,
    tier: row.tier,
    maxHealth: row.tier * 3,
    attackLevel: row.tier - 3,
    defenceLevel: row.tier - 5,
    accuracy: 12,
    armour: 24,
    magicArmour: 32,
    maxHit: Math.round(row.tier * 0.32),
    attackSpeedMs: row.tier === 50 ? 2800 : 3600,
    attackStyle: "melee",
    attackRangeM: row.tier === 50 ? 2.3 : 3.5,
    aggroRadius: row.tier === 50 ? 8 : 11,
    moveSpeedMps: row.tier === 50 ? 1.4 : 1.8,
    walkSpeedMps: row.tier === 50 ? 0.65 : 0.8,
    behaviour: "aggressive",
    marks: [row.tier * 2, row.tier * 6],
    drops: [{ itemId: "drake_scale", quantity: [1, row.tier === 50 ? 2 : 4], chance: 0.85 }, { itemId: "fire_essence", quantity: [2, 5], chance: 0.65 }]
  }, row.combatLevel)
}));
var WILDERNESS_DRAGONS = DRAGON_SPECIES;

// .baseline/game/src/content/wildernessDepth.ts
var WILDERNESS_DEPTH = {
  south: 460,
  divide: 700,
  north: 940,
  shallowTier: 50,
  deepTier: 70,
  magicFadeStart: 650,
  magicFadeEnd: 810
};
function wildernessTierAt(z) {
  return z < WILDERNESS_DEPTH.divide ? 50 : 70;
}
var WILDERNESS_RUNE_KEEPERS = [
  { id: "ashseal_warden", name: "Ashseal Warden", tier: 50, multiplier: 3, rune: "mind_rune" },
  { id: "furnace_regent", name: "Furnace Regent", tier: 50, multiplier: 4, rune: "chaos_rune" },
  { id: "chainbound_archon", name: "Chainbound Archon", tier: 70, multiplier: 3, rune: "death_rune" },
  { id: "nightforge_marshal", name: "Nightforge Marshal", tier: 70, multiplier: 4, rune: "blood_rune" },
  { id: "hollow_star", name: "The Hollow Star", tier: 70, multiplier: 5, rune: "wrath_rune" }
];
var WILDERNESS_EXPANSION_SITES = [
  { id: "cinder_chain_foundry", position: [-210, 735], footprint: [64, 56], rotationY: 0.12 },
  { id: "nightforge_bastion", position: [175, 815], footprint: [68, 64], rotationY: -0.14 },
  { id: "hollow_star_sanctum", position: [-20, 875], footprint: [70, 64], rotationY: 0.08 }
];
var WILDERNESS_RESOURCE_INTENTS = [
  { id: "cindervein_workings", tier: 50, kind: "mine", position: [-285, 680] },
  { id: "nightglass_excavation", tier: 70, kind: "mine", position: [285, 895] },
  { id: "lastroot_teak", tier: 50, kind: "grove", position: [-285, 490] },
  { id: "ember_shelter_teak", tier: 50, kind: "grove", position: [280, 585] },
  { id: "starwood_hollow", tier: 70, kind: "grove", position: [-285, 850] },
  { id: "moonvein_copse", tier: 70, kind: "grove", position: [285, 755] },
  { id: "east_cinder_cut", tier: 50, kind: "mine", position: [668, 492] },
  { id: "ashwind_shelter", tier: 50, kind: "grove", position: [435, 600] },
  { id: "nightglass_ridge", tier: 70, kind: "mine", position: [650, 830] },
  { id: "starfall_copse", tier: 70, kind: "grove", position: [500, 905] }
];

// .baseline/game/src/content/wildernessCreatureSpecies.ts
var bodies = [
  {
    id: "cinderback_crag",
    name: "Cinderback Crag",
    tier: 50,
    level: 48,
    role: "crawler",
    description: "A low eight-legged furnace scavenger. Its split basalt mantle exposes molten seams between load-bearing plates."
  },
  {
    id: "furnace_grazer",
    name: "Furnace Grazer",
    tier: 50,
    level: 53,
    role: "heavy",
    description: "A low, horned grazer with heavy claws, overlapping scales and a pale folded throat. It lowers its head before charging."
  },
  {
    id: "basalt_maw",
    name: "Basalt Maw",
    tier: 50,
    level: 57,
    role: "predator",
    description: "A lean horned predator with ochre plates over dark hide. Long hooked claws and powerful hind legs carry it across the basalt wastes."
  },
  {
    id: "rift_carapace",
    name: "Rift Carapace",
    tier: 70,
    level: 69,
    role: "crawler",
    description: "An angular deep-earth crawler with separated upright plates. Blue and violet fissures show through the gaps as its mantle twists."
  },
  {
    id: "voidstone_colossus",
    name: "Voidstone Colossus",
    tier: 70,
    level: 76,
    role: "heavy",
    description: "A tall stone guardian with worn slate armour over a darker jointed body. Faint violet eyes sit beneath its heavy brow."
  },
  {
    id: "gloam_wraith",
    name: "Gloam Wraith",
    tier: 70,
    level: 73,
    role: "ghost",
    description: "A slender apparition in worn ash cloth and dark plum sleeves. Its hollow cowl and hooked hands lead a pulling spectral strike."
  },
  ...WILDERNESS_RUNE_KEEPERS.map((keeper) => ({
    id: keeper.id,
    name: keeper.name,
    tier: keeper.tier,
    level: keeper.tier * keeper.multiplier,
    role: "keeper",
    description: {
      ashseal_warden: "An ancient skeletal guard in a blackened helmet, carrying a sword and shield. Pale ribs and long bony limbs show beneath its equipment.",
      furnace_regent: "A broad stone sovereign with molten seams running through its dark hide. It bends at the waist to bring both heavy arms into a crushing strike.",
      chainbound_archon: "A hooded spectral jailer in worn ceremonial robes. Its long sleeves trail behind outstretched hands during a curse.",
      nightforge_marshal: "An armoured guardian with fitted plate, articulated gauntlets and a closed helm. Its heavy shoulders turn into each strike.",
      hollow_star: "A winged deep-earth hunter with layered chitin, long antennae and hooked claws. Folded membranes rise behind its shoulders as it reaches for its prey."
    }[keeper.id]
  }))
];
function bodyStats(body) {
  const heavy = body.role === "heavy" || body.role === "keeper";
  const magic = body.role === "ghost" || body.id === "chainbound_archon" || body.id === "hollow_star";
  const attackLevel = Math.round(body.level * (magic ? 0.83 : heavy ? 0.74 : 0.87));
  const defenceLevel = Math.round(body.level * (heavy ? 0.77 : 0.62));
  const accuracy = magic ? 20 : body.role === "predator" ? 15 : 8;
  const armour = magic ? 10 : heavy ? 35 : 20;
  const magicArmour = magic ? 40 : body.tier === 70 ? 25 : 10;
  return tuneEnemyCombatLevel({
    id: `${body.id}_t${body.tier}`,
    family: body.id,
    name: body.name,
    tier: body.tier,
    attackStyle: magic ? "magic" : "melee",
    attackRangeM: magic ? 8 : heavy ? 2.6 : 1.9,
    maxHealth: body.level * (heavy ? 5 : 3),
    attackLevel,
    defenceLevel,
    accuracy,
    armour,
    magicArmour,
    maxHit: Math.round(body.tier * (body.role === "keeper" ? 0.76 : heavy ? 0.49 : 0.4)),
    attackSpeedMs: body.role === "keeper" ? 3800 : heavy ? 3400 : magic ? 2900 : 2500,
    aggroRadius: body.role === "keeper" ? 15 : magic ? 10 : 8,
    moveSpeedMps: magic ? 1.6 : heavy ? 1.1 : 1.5,
    walkSpeedMps: heavy ? 0.32 : 0.42,
    behaviour: heavy ? "territorial" : "aggressive",
    drops: [],
    marks: [body.tier, body.tier * (body.role === "keeper" ? 12 : 3)]
  }, body.level, body.tier);
}
var WILDERNESS_CREATURE_SPECIES = bodies.map((body) => ({
  id: body.id,
  assetId: `creature_${body.id}`,
  scale: 1 / tierSilhouetteScale(body.tier),
  regionId: "wilderness",
  activity: body.role === "heavy" ? "graze" : body.role === "predator" ? "prowl" : "patrol",
  description: body.description,
  stats: bodyStats(body)
}));

// .baseline/game/src/content/regionalTierEquipment.ts
var REGIONAL_CRAFTING_TIERS = [
  {
    tier: 30,
    metal: "dewglass",
    metalName: "Dewglass",
    ore: "dewglass_ore",
    wood: "willow",
    woodName: "Willow",
    hide: "mistweave",
    hideName: "Mistweave",
    thread: "mistweave_thread",
    threadName: "Mistweave Thread",
    metalArt: "Translucent turquoise mineral-metal with pearly silver edges, overlapping leaf-shaped plates and dark leather straps",
    clothArt: "Layered blue-green cloth with pointed petal panels, pale embroidered seams and softly shaded folds",
    woodArt: "Pale willow with bent flowing grain, turquoise bindings and pearly silver Dewglass fittings"
  },
  {
    tier: 40,
    metal: "crownsilver",
    metalName: "Crownsilver",
    ore: "crownsilver_ore",
    wood: "maple",
    woodName: "Maple",
    hide: "crownhide",
    hideName: "Crownhide",
    thread: "crownhide_thread",
    threadName: "Crownhide Lacing",
    metalArt: "Ivory silver with shaped fluting, brass fasteners and a dark navy underlayer",
    clothArt: "Cream and tan pebbled leather with dark blue gussets, brass buckles, braided leather borders and visible saddle stitching",
    woodArt: "Amber-red maple with figured grain, warm leather grips and silver and brass fittings"
  },
  {
    tier: 60,
    metal: "staramethyst",
    metalName: "Star Amethyst",
    ore: "star_amethyst_ore",
    wood: "yew",
    woodName: "Yew",
    hide: "faesilk",
    hideName: "Faesilk",
    thread: "faesilk_thread",
    threadName: "Faesilk Thread",
    metalArt: "Dark violet crystalline metal with blue-violet depths, sharp facets and silver branching inlay",
    clothArt: "Lavender and teal silk with silver embroidery, layered pointed hems and silver closures",
    woodArt: "Reddish yew heartwood with pale sapwood edges, teal bindings and silver and amethyst fittings"
  }
];
var GEAR = [
  {
    family: "metal",
    suffix: "sword",
    name: "Sword",
    slot: "mainHand",
    skill: "melee",
    values: [3200, 8200, 13700],
    stats: [{ meleeAccuracy: 48, meleePower: 45 }, { meleeAccuracy: 92, meleePower: 92 }, { meleeAccuracy: 125, meleePower: 128 }],
    shape: "A solid double-edged blade with beveled cutting edges, a shaped crossguard and a wrapped wood grip."
  },
  {
    family: "wood",
    suffix: "shield",
    name: "Shield",
    slot: "offHand",
    skill: "melee",
    values: [1250, 4700, 7600],
    stats: [{ meleeAccuracy: 3, defence: 22, health: 2 }, { meleeAccuracy: 6, defence: 43, health: 5 }, { meleeAccuracy: 8, defence: 56, health: 7 }],
    shape: "A curved layered-wood shield with a reinforced metal rim, central boss and two leather straps on its back."
  },
  {
    family: "metal",
    suffix: "helm",
    name: "Helm",
    slot: "head",
    skill: "melee",
    values: [1950, 5500, 9e3],
    stats: [{ meleeAccuracy: 4, defence: 14, health: 3 }, { meleeAccuracy: 7, defence: 28, health: 6 }, { meleeAccuracy: 9, defence: 37, health: 8 }],
    shape: "A fitted helmet with a raised brow, layered cheek guards and a protective nape."
  },
  {
    family: "metal",
    suffix: "plate",
    name: "Plate",
    slot: "body",
    skill: "melee",
    values: [3900, 9400, 15400],
    stats: [{ meleeAccuracy: 6, defence: 30, health: 7 }, { meleeAccuracy: 10, defence: 60, health: 14 }, { meleeAccuracy: 13, defence: 79, health: 19 }],
    shape: "A shaped breastplate and backplate with overlapping shoulder plates, a fitted waist and articulated lower lames."
  },
  {
    family: "metal",
    suffix: "greaves",
    name: "Greaves",
    slot: "legs",
    skill: "melee",
    values: [3600, 8700, 14200],
    stats: [{ meleeAccuracy: 4, defence: 19, health: 5 }, { meleeAccuracy: 7, defence: 39, health: 10 }, { meleeAccuracy: 9, defence: 51, health: 14 }],
    shape: "A matched pair of leg guards with separate thigh shells, raised knee cups and shin plates over leather lining."
  },
  {
    family: "metal",
    suffix: "boots",
    name: "Boots",
    slot: "feet",
    skill: "melee",
    values: [1350, 4200, 6900],
    stats: [{ meleeAccuracy: 2, defence: 6, health: 2 }, { meleeAccuracy: 4, defence: 18, health: 5 }, { meleeAccuracy: 5, defence: 24, health: 7 }],
    shape: "A matched pair of leather-soled boots with overlapping metal toe plates, ankle guards and rear buckles."
  },
  {
    family: "metal",
    suffix: "gauntlets",
    name: "Gauntlets",
    slot: "hands",
    skill: "melee",
    values: [1350, 4200, 6900],
    stats: [{ meleeAccuracy: 4, defence: 4, health: 3 }, { meleeAccuracy: 6, defence: 16, health: 5 }, { meleeAccuracy: 8, defence: 21, health: 7 }],
    shape: "A matched pair of five-fingered gauntlets with articulated knuckles, flared cuffs and leather palms."
  },
  {
    family: "wood",
    suffix: "wand",
    name: "Wand",
    slot: "mainHand",
    skill: "magic",
    values: [1900, 5400, 8700],
    stats: [{ magicAccuracy: 27, magicPower: 23, defence: 5 }, { magicAccuracy: 54, magicPower: 46, defence: 9 }, { magicAccuracy: 74, magicPower: 63, defence: 13 }],
    shape: "A short tapered wand with a wrapped grip and a small crystal held in an open metal tip cage. One-handed; carried Essence pays for spells."
  },
  {
    family: "wood",
    suffix: "staff",
    name: "Staff",
    slot: "mainHand",
    skill: "magic",
    values: [2700, 7200, 11700],
    stats: [{ meleePower: 7, magicAccuracy: 40, magicPower: 34, defence: 7 }, { meleePower: 15, magicAccuracy: 80, magicPower: 69, defence: 13 }, { meleePower: 21, magicAccuracy: 110, magicPower: 94, defence: 19 }],
    shape: "A long staff with a forked metal crown around a large crystal, wrapped handhold and reinforced foot. Two-handed; carried Essence pays for spells."
  },
  {
    family: "hide",
    suffix: "hood",
    name: "Hood",
    slot: "head",
    skill: "magic",
    values: [1650, 4800, 7800],
    stats: [{ defence: 15, magicAccuracy: 8, magicPower: 4, health: 3 }, { defence: 27, magicAccuracy: 15, magicPower: 7, health: 7 }, { defence: 38, magicAccuracy: 20, magicPower: 10, health: 10 }],
    shape: "A deep open-faced hood with an embroidered brow, folded lining and a short shoulder cowl."
  },
  {
    family: "hide",
    suffix: "robe",
    name: "Robe",
    slot: "body",
    skill: "magic",
    values: [3300, 8300, 13500],
    stats: [{ defence: 26, magicAccuracy: 12, magicPower: 6, health: 6 }, { defence: 48, magicAccuracy: 23, magicPower: 11, health: 13 }, { defence: 67, magicAccuracy: 31, magicPower: 15, health: 18 }],
    shape: "A fitted sleeveless robe with a belted waist, overlapping front panels and split flowing tails. Open armholes leave the arms visible."
  },
  {
    family: "hide",
    suffix: "leggings",
    name: "Leggings",
    slot: "legs",
    skill: "magic",
    values: [2950, 7500, 12200],
    stats: [{ defence: 18, magicAccuracy: 7, magicPower: 4, health: 4 }, { defence: 33, magicAccuracy: 13, magicPower: 7, health: 9 }, { defence: 46, magicAccuracy: 18, magicPower: 9, health: 12 }],
    shape: "A fitted pair of trousers with a reinforced waistband, separate legs, stitched knee panels and tapered ankle cuffs."
  },
  {
    family: "hide",
    suffix: "boots",
    name: "Boots",
    slot: "feet",
    skill: "magic",
    values: [1150, 3500, 5700],
    stats: [{ defence: 5, magicAccuracy: 2, health: 2 }, { defence: 10, magicAccuracy: 4, health: 4 }, { defence: 15, magicAccuracy: 6, health: 6 }],
    shape: "A matched pair of soft casting boots with turned cuffs, side lacing, embroidered uppers and dark leather soles."
  },
  {
    family: "hide",
    suffix: "wraps",
    name: "Wraps",
    slot: "hands",
    skill: "magic",
    values: [1150, 3500, 5700],
    stats: [{ defence: 5, magicAccuracy: 2, health: 2 }, { defence: 10, magicAccuracy: 4, health: 4 }, { defence: 15, magicAccuracy: 6, health: 6 }],
    shape: "A matched pair of fingerless hand wraps with layered wrist bands, fitted thumb openings and embroidered cuff borders."
  }
];
var BONUS_KEYS = ["meleeAccuracy", "meleePower", "defence", "magicAccuracy", "magicPower", "health", "vitality"];
function interpolate(tier, values) {
  const [low, high, deep] = values;
  return Math.round(tier <= 50 ? low + (high - low) * (tier - 20) / 30 : high + (deep - high) * (tier - 50) / 20);
}
function tierItems(def) {
  const t = def.tier;
  const mat = (id, name, description, value, category = "component") => ({ id, name, tier: t, description, value, category, stackable: category === "component" });
  return [
    mat(def.ore, `${def.metalName} Ore`, `${def.metalArt}. Rough mineral fragments in a dark stone matrix; smelt three into one bar.`, interpolate(t, [160, 360, 590]), "resource"),
    mat(`${def.metal}_bar`, `${def.metalName} Bar`, `${def.metalArt}. A solid cast ingot with beveled ends and a stamped maker's mark.`, interpolate(t, [600, 1250, 2050]), "bar"),
    mat(def.hide, def.hideName, `${def.clothArt}. ${def.hide === "crownhide" ? "A folded tanned hide with a natural irregular edge" : "A folded bolt with a visible woven edge"}. Cut into garments or binding thread.`, interpolate(t, [150, 340, 560])),
    mat(def.thread, def.threadName, `${def.hide === "crownhide" ? "Narrow tan leather lacing braided around an ivory spool" : "Fine " + def.hideName + " thread wound around a carved wooden spool"}. Used for seams, casting grips and fishing line.`, interpolate(t, [40, 90, 150])),
    mat(`${def.wood}_handle`, `${def.woodName} Handle`, `${def.woodArt}. A shaped grip with a shouldered tang socket for swords, pickaxes and hatchets.`, interpolate(t, [220, 640, 1010])),
    ...GEAR.map((spec) => {
      const family = def[spec.family], familyName = def[`${spec.family}Name`];
      const art = spec.family === "metal" ? def.metalArt : spec.family === "hide" ? def.clothArt : def.woodArt;
      const weapon = spec.suffix === "sword" || spec.suffix === "wand" || spec.suffix === "staff" ? spec.suffix : void 0;
      const bonuses3 = Object.fromEntries(BONUS_KEYS.map((key) => [key, interpolate(t, spec.stats.map((s) => s[key] ?? 0))]));
      return {
        id: `${family}_${spec.suffix}`,
        name: `${familyName} ${spec.name}`,
        tier: t,
        value: interpolate(t, spec.values),
        description: `${art}. ${t === 30 && spec.suffix === "robe" ? "A fitted robe with flared sleeves, pale botanical embroidery and split pointed tails." : t === 30 && spec.suffix === "staff" ? "A long willow staff with a bent branch loop around a Dewglass crystal. Two-handed; carried Essence pays for spells." : spec.shape}`,
        category: "equipment",
        stackable: false,
        equip: {
          slot: spec.slot,
          requires: { [spec.skill]: t },
          bonuses: bonuses3,
          ...weapon ? { attackSpeedMs: weapon === "staff" ? 3e3 : weapon === "wand" ? 2200 : 2400 } : {}
        },
        ...weapon && weapon !== "sword" ? { magicWeapon: { kind: weapon, hands: weapon === "staff" ? 2 : 1 } } : {}
      };
    }),
    ...["pickaxe", "hatchet", "rod"].map((tool) => ({
      id: `${tool === "rod" ? def.wood : def.metal}_${tool}`,
      name: `${tool === "rod" ? def.woodName : def.metalName} ${tool === "pickaxe" ? "Pickaxe" : tool === "hatchet" ? "Hatchet" : "Rod"}`,
      tier: t,
      value: interpolate(t, tool === "rod" ? [1100, 3200, 5300] : tool === "pickaxe" ? [1400, 4e3, 6500] : [1350, 4e3, 6500]),
      category: "tool",
      stackable: false,
      tool: { skill: tool === "pickaxe" ? "mining" : tool === "hatchet" ? "woodcutting" : "fishing", gatherBonus: toolBonus(t) },
      description: `${def.woodArt}. ${tool === "rod" ? "A flexible fishing rod with spaced line guides, a working reel, crank knob and hanging float." : tool === "pickaxe" ? `A curved two-ended ${def.metalName} mining head with a pointed pick and a flat chisel.` : `A broad bearded ${def.metalName} axe head with a honed edge and wedge-fastened eye.`} Adds ${toolBonus(t)} effective gathering levels; resource requirements still apply.`
    }))
  ];
}
var REGIONAL_TIER_ITEMS = REGIONAL_CRAFTING_TIERS.flatMap(tierItems);
function regionalFabricDrops(tier, boss = false) {
  const row = REGIONAL_CRAFTING_TIERS.find((row2) => row2.tier === tier);
  return row ? [{ itemId: row.hide, quantity: boss ? [4, 7] : [1, 3], chance: boss ? 1 : 0.75 }] : [];
}
var SKILLS = { smelt: "smithing", smith: "smithing", craft: "crafting", fletch: "fletching", cook: "cooking" };
var STATIONS = { smelt: ["furnace"], smith: ["anvil"], craft: ["crafting_table"], fletch: ["fletching_bench"], cook: ["range", "campfire"] };
function tierRecipes(def) {
  const { tier: t, metal: m, wood: w, hide: h, thread } = def;
  const bar = `${m}_bar`, handle = `${w}_handle`, log = `${w}_log`;
  const recipe2 = (output, kind, inputs, weight, quantity = 1) => ({
    id: `${kind}_${output}`,
    name: REGIONAL_TIER_ITEMS.find((item) => item.id === output).name,
    tier: t,
    reqLevel: t,
    kind,
    skill: SKILLS[kind],
    stations: STATIONS[kind],
    inputs: inputs.map(([itemId, quantity2]) => ({ itemId, quantity: quantity2 })),
    output: { itemId: output, quantity },
    durationMs: kind === "smith" ? 3e3 : kind === "fletch" ? 1800 : 2400,
    xp: recipeXp(t, weight)
  });
  return [
    recipe2(bar, "smelt", [[def.ore, 3]], 0.8),
    recipe2(handle, "fletch", [[log, 1]], 1),
    recipe2(thread, "craft", [[h, 1]], 0.8, 4),
    recipe2(`${m}_sword`, "smith", [[bar, 3], [handle, 1]], 3.5),
    recipe2(`${w}_shield`, "fletch", [[log, 2], [bar, 2]], 2.8),
    ...["helm", "plate", "greaves", "boots", "gauntlets"].map((part) => recipe2(`${m}_${part}`, "smith", [[bar, part === "plate" || part === "greaves" ? 4 : part === "helm" ? 2 : 1]], part === "plate" || part === "greaves" ? 5 : 2.5)),
    recipe2(`${w}_wand`, "fletch", [[log, 2], [bar, 1], [thread, 3]], 2.4),
    recipe2(`${w}_staff`, "fletch", [[log, 3], [bar, 2], [thread, 5]], 3.2),
    ...["hood", "robe", "leggings", "boots", "wraps"].map((part) => recipe2(`${h}_${part}`, "craft", [[h, part === "robe" || part === "leggings" ? 4 : part === "hood" ? 2 : 1], [thread, part === "robe" || part === "leggings" ? 4 : 2]], part === "robe" || part === "leggings" ? 4 : 2.5)),
    recipe2(`${m}_pickaxe`, "smith", [[bar, 2], [handle, 1]], 2.2),
    recipe2(`${m}_hatchet`, "smith", [[bar, 2], [handle, 1]], 2.2),
    recipe2(`${w}_rod`, "fletch", [[log, 2], [bar, 1], [thread, 3]], 1.8)
  ];
}
var REGIONAL_TIER_RECIPES = REGIONAL_CRAFTING_TIERS.flatMap(tierRecipes);

// .baseline/game/src/content/crownwardDragons.ts
var CROWNWARD_DRAGON_FORMS = [
  {
    id: "crownward_red_hatchling",
    sourceSpeciesId: "baby_red_dragon",
    name: "Red Dragon Whelp",
    rank: "miniboss",
    level: 65,
    nativeScale: 1.1,
    description: "A young red dragon nesting beyond the royal patrols. Its short wings spread as it braces for a snapping strike."
  },
  {
    id: "crownward_black_hatchling",
    sourceSpeciesId: "baby_black_dragon",
    name: "Black Dragon Whelp",
    rank: "miniboss",
    level: 68,
    nativeScale: 1.1,
    description: "A young black dragon with a hooked muzzle and broad small wings. It guards its patch of old kingdom pasture."
  },
  {
    id: "crownward_red_dragon",
    sourceSpeciesId: "red_wilderness_dragon",
    name: "Red Dragon of Crownward",
    rank: "boss",
    level: 110,
    nativeScale: 1.05,
    description: "An adult red dragon that has claimed a hunting ground in the old kingdom. Its tall neck, wing claws and long blade tail rise above the young dragons."
  }
];
var CROWNWARD_DRAGON_SPECIES = CROWNWARD_DRAGON_FORMS.map((form) => {
  const source = WILDERNESS_DRAGONS.find((species2) => species2.id === form.sourceSpeciesId);
  if (!source) throw new Error(`Missing accepted source dragon ${form.sourceSpeciesId}`);
  const boss = form.rank === "boss";
  return {
    id: form.id,
    assetId: source.assetId,
    regionId: "crownward",
    activity: source.activity,
    scale: form.nativeScale / tierSilhouetteScale(40),
    description: form.description,
    stats: tuneEnemyCombatLevel({
      ...source.stats,
      id: `${form.id}_t40`,
      family: form.id,
      name: form.name,
      tier: 40,
      behaviour: "territorial",
      aggroRadius: boss ? 11 : 7,
      // Preserve the existing cadence and locomotion speeds of each accepted rig.
      marks: boss ? [600, 1e3] : [220, 380],
      drops: [
        ...regionalFabricDrops(40, boss),
        { itemId: "drake_scale", quantity: boss ? [4, 7] : [1, 3], chance: 1 },
        { itemId: "fire_essence", quantity: boss ? [10, 18] : [4, 8], chance: 1 },
        { itemId: "death_rune", quantity: boss ? [4, 7] : [1, 3], chance: boss ? 0.75 : 0.35 }
      ]
    }, form.level, 40)
  };
});

// .baseline/game/src/content/regionalBossBodies.ts
var REGIONAL_BOSS_BODIES = {
  tempest_roc: {
    assetId: "creature_boss_tempest_roc",
    scale: 1,
    description: "A storm scarab with swept carapace shields, a crescent shovel cranium and inward-cutting stone mandibles."
  },
  // Galeskin and Rootheart are the only two bodies built on briar_harrow, whose run cycle covers
  // 0.48 of its own height per stride where every other boss base covers 0.85 or more. A boss has
  // to hold the shared 4.68 m/s run speed, so that short stride cycles its legs at 3.62 Hz, past
  // the 3 Hz legibility ceiling in creatureMotionTiming. Drawing them larger lengthens the drawn
  // stride by the same factor and is the only fix that does not re-author the rig; it also settles
  // the oddity that both bosses rendered smaller than an ordinary 4.02 m mossback sentinel.
  galeskin: {
    assetId: "creature_boss_galeskin",
    scale: 1.35,
    description: "A wind-stripped elder with a split timber mantle, one heavy root forearm and a hollow wind-cut head."
  },
  rootheart: {
    assetId: "creature_boss_rootheart",
    scale: 1.35,
    description: "A walking cathedral tree with a split hollow trunk, load-bearing bough arches and a recessed heart chamber."
  },
  mossbound: {
    assetId: "creature_boss_mossbound",
    scale: 1,
    description: "A mature seed predator with interlocking woody pod valves, thick shoulder pods and an articulated root jaw."
  },
  tideworn: {
    assetId: "creature_boss_tideworn",
    scale: 1,
    description: "A wave-eroded shore colossus with a low layered shell and an enormous split crushing claw."
  },
  ordrun: {
    assetId: "creature_boss_ordrun",
    scale: 1,
    description: "A quarry fortress with twin open stone vaults, a slotted gate head, broken lintel shoulders and masonry crushing fists."
  },
  cinderwake: {
    assetId: "creature_boss_cinderwake",
    scale: 1,
    description: "A furnace tyrant with a fused slag mantle, open barred chest, recessed iron face and asymmetric hammer arm."
  }
};
var SOURCES = {
  tempest_roc: ["beetle_golem", "Storm Scarab", "fallowmarch"],
  galeskin: ["mossback_sentinel", "Plains Ogre", "fallowmarch"],
  rootheart: ["mossback_sentinel", "Rootbound Colossus", "vellenwood"],
  mossbound: ["beetle_golem", "Forest Ogre", "vellenwood"],
  tideworn: ["beetle_golem", "Cave Ogre", "karrowmoor"],
  ordrun: ["iron_golem", "Quarry Warden", "gravelmaw"],
  cinderwake: ["lava_golem", "Fire Ogre", "kilnhalt"]
};
var REGIONAL_BOSS_SPECIES = Object.entries(REGIONAL_BOSS_BODIES).map(([key, body]) => {
  const id = key;
  const [sourceId, name, regionId] = SOURCES[id];
  const source = RPG_BESTIARY_BY_ID.get(sourceId);
  const { tier, multiplier } = REGIONAL_BOSS_LEVELS[id];
  const stats = tuneEnemyCombatLevel(source.stats, tier * multiplier, tier);
  return {
    id: `boss_${id}`,
    ...body,
    scale: body.scale / tierSilhouetteScale(tier),
    regionId,
    activity: "patrol",
    stats: { ...stats, id: `boss_${id}_t${tier}`, family: `boss_${id}`, name, behaviour: "territorial" }
  };
});

// .baseline/game/src/content/fairyCrownCreatures.ts
var FAIRY_CROWN_FORMS = [
  {
    id: "pearl_knight",
    sourceSpeciesId: "nightforge_marshal",
    sourceAssetId: "creature_nightforge_marshal",
    name: "Pearl Knight",
    regionId: "crownward",
    tier: 40,
    level: 40,
    nativeScale: 0.66,
    activity: "patrol",
    behaviour: "territorial",
    description: "A knight in pearl-white plate and a closed silver helm. Cool light catches the fitted armour above dark articulated joints."
  },
  {
    id: "ivory_castellan",
    sourceSpeciesId: "nightforge_marshal",
    sourceAssetId: "creature_nightforge_marshal",
    name: "Ivory Castellan",
    regionId: "crownward",
    tier: 40,
    level: 100,
    nativeScale: 1.05,
    activity: "patrol",
    behaviour: "territorial",
    boss: true,
    description: "A towering castle guardian in white plate, with pale gold shoulders and a shimmering silver helm. Its heavy gauntlets lead each strike."
  },
  {
    id: "crown_hart",
    sourceSpeciesId: "marchwild_horse",
    sourceAssetId: "animal_deer",
    name: "Crown Hart",
    regionId: "crownward",
    tier: 40,
    level: 36,
    nativeScale: 1.1,
    activity: "graze",
    behaviour: "passive",
    description: "A pale silver-antlered deer browsing the old royal parkland. Its cream coat has the faint green sheen of the surrounding groves."
  },
  {
    id: "silverthorn_harrow",
    sourceSpeciesId: "briar_harrow",
    sourceAssetId: "creature_briar_harrow",
    name: "Silverthorn Harrow",
    regionId: "crownward",
    tier: 40,
    level: 44,
    nativeScale: 1.05,
    activity: "patrol",
    behaviour: "territorial",
    description: "An old walking tree with silver bark and dark moss-green hollows. Heavy root hands drag beside its bowed trunk."
  },
  {
    id: "lantern_sprite",
    sourceSpeciesId: "marsh_wasp",
    sourceAssetId: "creature_marsh_wasp",
    name: "Lantern Sprite",
    regionId: "gloamgarden",
    tier: 30,
    level: 28,
    nativeScale: 0.58,
    activity: "forage",
    behaviour: "territorial",
    description: "A small winged garden spirit with a teal body and translucent lilac wings. Soft mint light gathers on its existing shell markings."
  },
  {
    id: "moonpetal_stalker",
    sourceSpeciesId: "heath_jack",
    sourceAssetId: "creature_heath_jack",
    name: "Moonpetal Stalker",
    regionId: "gloamgarden",
    tier: 30,
    level: 32,
    nativeScale: 0.85,
    activity: "prowl",
    behaviour: "aggressive",
    description: "A small carved woodland hunter in plum cloth. Pale turquoise grain follows its long hands and hollow wooden face."
  },
  {
    id: "dewglass_weaver",
    sourceSpeciesId: "fen_crawler",
    sourceAssetId: "creature_fen_crawler",
    name: "Dewglass Weaver",
    regionId: "gloamgarden",
    tier: 30,
    level: 30,
    nativeScale: 0.9,
    activity: "prowl",
    behaviour: "aggressive",
    description: "A low teal crawler with lilac shell edges and long folded legs. Its feeding blades shine like wet glass beneath the front shield."
  },
  {
    id: "bloomheart_matriarch",
    sourceSpeciesId: "boss_rootheart",
    sourceAssetId: "creature_boss_rootheart",
    name: "Bloomheart Matriarch",
    regionId: "gloamgarden",
    tier: 30,
    level: 75,
    nativeScale: 1.35,
    activity: "patrol",
    behaviour: "territorial",
    boss: true,
    description: "An ancient violet tree guardian with teal inner growth and pale rose edges. A recessed luminous heart sits inside the split trunk."
  },
  {
    id: "prismatic_sprite",
    sourceSpeciesId: "marsh_wasp",
    sourceAssetId: "creature_marsh_wasp",
    name: "Prismatic Sprite",
    regionId: "faeholme",
    tier: 60,
    level: 58,
    nativeScale: 0.85,
    activity: "forage",
    behaviour: "territorial",
    description: "A large violet-winged garden spirit with a deep turquoise shell. Magenta and cyan marks trace its familiar winged insect body."
  },
  {
    id: "orchid_reaper",
    sourceSpeciesId: "veil_reaper",
    sourceAssetId: "creature_veil_reaper",
    name: "Orchid Reaper",
    regionId: "faeholme",
    tier: 60,
    level: 62,
    nativeScale: 0.85,
    activity: "patrol",
    behaviour: "aggressive",
    description: "A drifting figure in orchid-purple woven robes and an ivory cowl. Teal light runs softly across its outstretched hands."
  },
  {
    id: "starroot_guardian",
    sourceSpeciesId: "briar_harrow",
    sourceAssetId: "creature_briar_harrow",
    name: "Starroot Guardian",
    regionId: "faeholme",
    tier: 60,
    level: 66,
    nativeScale: 1.2,
    activity: "patrol",
    behaviour: "territorial",
    description: "A mature walking root with dark violet bark and bright turquoise inner fibres. Its crooked branches frame a deep shadowed body cavity."
  },
  {
    id: "amethyst_sovereign",
    sourceSpeciesId: "hollow_star",
    sourceAssetId: "creature_hollow_star",
    name: "Amethyst Sovereign",
    regionId: "faeholme",
    tier: 60,
    level: 150,
    nativeScale: 1.25,
    activity: "patrol",
    behaviour: "territorial",
    boss: true,
    description: "A tall winged chitin sovereign with amethyst plates, wine-purple membranes and a pale teal sheen. Long antennae and hooked claws retain its ancient insect silhouette."
  }
];
var FAIRY_CROWN_SOURCE_ASSETS = Object.fromEntries(
  FAIRY_CROWN_FORMS.map((form) => [`creature_${form.id}`, form.sourceAssetId])
);
var FAIRY_CROWN_BOSS_IDS = FAIRY_CROWN_FORMS.filter((form) => form.boss).map((form) => form.id);
var sourceSpecies = new Map([
  ...CREATURE_EXPANSION,
  ...RPG_BESTIARY,
  ...FOREST_CREATURE_REDESIGNS,
  ...ASH_CREATURE_REDESIGNS,
  ...REGIONAL_BOSS_SPECIES,
  ...WILDERNESS_CREATURE_SPECIES
].map((species2) => [species2.id, species2]));
function dropsFor(form) {
  const fairy = form.regionId !== "crownward";
  const essence = fairy ? "earth_essence" : "air_essence";
  const rune = form.tier === 30 ? "chaos_rune" : form.tier === 40 ? "death_rune" : "blood_rune";
  return [
    ...regionalFabricDrops(form.tier, form.boss),
    { itemId: essence, quantity: form.boss ? [8, 14] : [2, 4], chance: form.boss ? 1 : 0.55 },
    { itemId: rune, quantity: form.boss ? [3, 6] : [1, 2], chance: form.boss ? 1 : 0.18 },
    ...fairy ? [{ itemId: "cosmic_rune", quantity: form.boss ? [3, 5] : [1, 1], chance: form.boss ? 1 : 0.14 }] : [],
    ...form.id === "crown_hart" ? [{ itemId: "raw_venison", quantity: [1, 2], chance: 0.8 }] : []
  ];
}
var FAIRY_CROWN_SPECIES = FAIRY_CROWN_FORMS.map((form) => {
  const source = sourceSpecies.get(form.sourceSpeciesId);
  if (!source) throw new Error(`Missing source creature ${form.sourceSpeciesId} for ${form.id}`);
  const base = source.stats;
  const stats = tuneEnemyCombatLevel({
    ...base,
    id: `${form.id}_t${form.tier}`,
    family: form.id,
    name: form.name,
    tier: form.tier,
    behaviour: form.behaviour,
    // Keep the source motion within its existing cadence when the drawn body becomes smaller.
    ...base.moveSpeedMps === void 0 ? {} : { moveSpeedMps: base.moveSpeedMps * Math.min(1, form.nativeScale) },
    ...base.walkSpeedMps === void 0 ? {} : { walkSpeedMps: base.walkSpeedMps * Math.min(1, form.nativeScale) },
    attackRangeM: form.boss ? Math.max(2.4, base.attackRangeM ?? 2) : Math.min(2, base.attackRangeM ?? 1.8),
    aggroRadius: form.boss ? 12 : form.behaviour === "passive" ? 4 : form.behaviour === "territorial" ? 5 : 8,
    marks: form.boss ? [form.tier * 12, form.tier * 24] : [form.tier * 3, form.tier * 7],
    drops: dropsFor(form)
  }, form.level, form.tier);
  return {
    id: form.id,
    assetId: `creature_${form.id}`,
    regionId: form.regionId,
    scale: form.nativeScale / tierSilhouetteScale(form.tier),
    activity: form.activity,
    description: form.description,
    stats
  };
});

// .baseline/game/src/content/fairyMinibossForms.ts
var FAIRY_MINIBOSS_POOLS = {
  gloamgarden: ["02", "03", "07"],
  faeholme: ["06", "08", "09"]
};
var FAIRY_MINIBOSS_FORMS = Object.entries(FAIRY_MINIBOSS_POOLS).flatMap(([regionId, numbers]) => numbers.map((number) => ({
  number,
  regionId,
  source: `fantasy_monster_${number}`,
  assetId: `fairy_guardian_${number}_${regionId}`,
  look: "mint"
})));
function fairyMinibossAsset(number, regionId) {
  return FAIRY_MINIBOSS_FORMS.find((form) => form.number === number && form.regionId === regionId)?.assetId;
}

// .baseline/game/src/content/universalMinibosses.ts
var UNIVERSAL_MINIBOSS_RESPAWN_SECONDS = 30 * 60;
var UNIQUE_JEWELLERY_CHANCE = 0.3;
var UNIVERSAL_MINIBOSS_ROSTER = [
  { number: "01", name: "Bramblehorn", style: "melee", unique: "Brambleheart Ring" },
  { number: "02", name: "Gloamwarden", style: "magic", unique: "Gloamwarden Pendant" },
  { number: "03", name: "Thorn Sovereign", style: "melee", unique: "Thorn Sovereign Ring" },
  { number: "04", name: "Hollow Crown", style: "magic", unique: "Hollow Crown Pendant" },
  { number: "05", name: "Stonevein", style: "melee", unique: "Stonevein Ring" },
  { number: "06", name: "Nightbloom", style: "magic", unique: "Nightbloom Pendant" },
  { number: "07", name: "Dreadroot", style: "melee", unique: "Dreadroot Ring" },
  { number: "08", name: "Veilkeeper", style: "magic", unique: "Veilkeeper Pendant" },
  { number: "09", name: "Elder Thorne", style: "melee", unique: "Elder Thorne Ring" }
];
var RESERVED_UNIVERSAL_MINIBOSS_ASSET_IDS = /* @__PURE__ */ new Set([
  ...UNIVERSAL_MINIBOSS_ROSTER.map((row) => `fantasy_monster_${row.number}`),
  ...FAIRY_MINIBOSS_FORMS.map((row) => row.assetId),
  "miniboss_cinderwake",
  "miniboss_galeskin",
  "miniboss_mossbound",
  "miniboss_tideworn",
  "creature_cinder_ravager",
  "creature_basalt_maw",
  "creature_gorge_mantis",
  "creature_hollow_star",
  "creature_amethyst_sovereign"
]);
var template = {
  id: "universal_guardian",
  family: "guardian",
  name: "Guardian",
  tier: 30,
  maxHealth: 180,
  attackLevel: 14,
  defenceLevel: 12,
  accuracy: 22,
  armour: 32,
  magicArmour: 24,
  maxHit: 8,
  attackSpeedMs: 2600,
  aggroRadius: 9,
  attackRangeM: 2.6,
  moveSpeedMps: 2.6,
  walkSpeedMps: 0.55,
  behaviour: "territorial",
  drops: []
};
function universalMinibossSpecies(number, regionId, tierOverride) {
  const row = UNIVERSAL_MINIBOSS_ROSTER.find((candidate) => candidate.number === number);
  const tier = tierOverride ?? Math.max(10, REGION_COMBAT_TIERS[regionId]);
  const targetLevel = Math.max(12, Math.round(tier * 2.5));
  const stats = {
    ...tuneEnemyCombatLevel(template, targetLevel, tier),
    id: `guardian_${number}_t${tier}`,
    family: `guardian_${number}`,
    name: row.name,
    attackStyle: row.style,
    respawnSeconds: UNIVERSAL_MINIBOSS_RESPAWN_SECONDS,
    drops: tier < 10 ? [] : [
      { itemId: `guardian_ring_t${tier}`, quantity: [1, 1], chance: UNIQUE_JEWELLERY_CHANCE / 2, exclusiveGroup: "jewelry" },
      { itemId: `guardian_earring_t${tier}`, quantity: [1, 1], chance: UNIQUE_JEWELLERY_CHANCE / 2, exclusiveGroup: "jewelry" }
    ],
    marks: [Math.max(15, tier * 10), Math.max(30, tier * 20)]
  };
  return {
    id: `guardian_${number}_${regionId}${tierOverride ? `_t${tierOverride}` : ""}`,
    assetId: fairyMinibossAsset(number, regionId) ?? `fantasy_monster_${number}`,
    regionId,
    scale: 1 / tierSilhouetteScale(tier),
    activity: "patrol",
    stats,
    description: `Fantasy Monster ${number}. A roaming ${row.name} with a thirty-minute respawn.`
  };
}
var UNIVERSAL_MINIBOSS_SPECIES = Object.keys(REGION_COMBAT_TIERS).flatMap((regionId) => UNIVERSAL_MINIBOSS_ROSTER.flatMap((row) => [
  universalMinibossSpecies(row.number, regionId),
  ...regionId === "wilderness" ? [universalMinibossSpecies(row.number, regionId, 70)] : []
]));
var UNIVERSAL_MINIBOSS_ENEMIES = [...new Map(
  UNIVERSAL_MINIBOSS_SPECIES.map((species2) => [species2.stats.id, species2.stats])
).values()];

// .baseline/game/src/content/jewelry.ts
var JEWELRY_TIERS = [10, 20, 30, 40, 50, 60, 70];
var JEWELRY_STATS = ["meleeAccuracy", "magicAccuracy", "defence", "health", "meleePower", "magicPower", "vitality"];
var JEWELRY_SHAPES = ["ring", "earring"];
var JEWELRY_MATERIALS = [
  ["Cobalt Garnet", "kaldite_bar", "cairn_garnet"],
  ["Titanium Opal", "emberite_bar", "fire_opal"],
  ["Dewglass Quartz", "kaldite_bar", "pale_quartz"],
  ["Titanium Amber", "emberite_bar", "vell_amber"],
  ["Cindersteel Garnet", "cindersteel_bar", "cairn_garnet"],
  ["Cindersteel Opal", "cindersteel_bar", "fire_opal"],
  ["Nightglass Opal", "nightglass_bar", "fire_opal"]
];
function jewelryBonuses(values = {}) {
  return { meleeAccuracy: 0, magicAccuracy: 0, defence: 0, health: 0, meleePower: 0, magicPower: 0, vitality: 0, ...values };
}
var CRAFTED_JEWELRY = JEWELRY_TIERS.flatMap((tier, index) => JEWELRY_SHAPES.map((shape) => ({
  id: `crafted_${shape}_t${tier}`,
  name: `${JEWELRY_MATERIALS[index][0]} ${shape === "ring" ? "Ring" : "Earring"}`,
  tier,
  category: "equipment",
  stackable: false,
  value: tier * 80,
  description: `A ${shape} set with ${JEWELRY_MATERIALS[index][2].replaceAll("_", " ")}. Grants only ${JEWELRY_STATS[index].replace(/([A-Z])/g, " $1").toLowerCase()}${tier === 70 ? ", critical hit chance" : ""}.`,
  equip: {
    slot: shape === "ring" ? "accessory1" : "accessory2",
    requires: { [index === 1 || index === 5 ? "magic" : "melee"]: tier },
    bonuses: jewelryBonuses({ [JEWELRY_STATS[index]]: tier / 10 * (index === 3 ? 3 : 1) })
  }
})));
var JEWELRY_RECIPES = CRAFTED_JEWELRY.map((item) => {
  const material2 = JEWELRY_MATERIALS[JEWELRY_TIERS.indexOf(item.tier)];
  return {
    id: `craft_${item.id}`,
    name: item.name,
    kind: "craft",
    stations: ["crafting_table"],
    skill: "crafting",
    reqLevel: item.tier,
    tier: item.tier,
    durationMs: 3e3,
    xp: recipeXp(item.tier, 3),
    inputs: [{ itemId: material2[1], quantity: 1 }, { itemId: material2[2], quantity: 1 }],
    output: { itemId: item.id, quantity: 1 }
  };
});

// .baseline/game/src/content/universalMinibossLoot.ts
var MINIBOSS_JEWELRY_PROFILES = [
  ["meleeAccuracy", "defence"],
  ["magicAccuracy", "defence"],
  ["defence", "health"],
  ["meleeAccuracy", "meleePower"],
  ["magicAccuracy", "magicPower"],
  ["meleeAccuracy", "meleePower", "defence"],
  ["magicAccuracy", "magicPower", "defence"]
];
var NAMES = ["Brambleguard", "Moonsigil", "Hollow Crown", "Thornstrike", "Nightbloom", "Stoneheart", "Veilweaver"];
var MINIBOSS_JEWELLERY = JEWELRY_TIERS.flatMap((tier, index) => JEWELRY_SHAPES.map((shape) => ({
  id: `guardian_${shape}_t${tier}`,
  name: `${NAMES[index]} ${shape === "ring" ? "Ring" : "Earring"}`,
  tier,
  category: "equipment",
  stackable: false,
  value: tier * 360,
  description: `A rare ${shape} carried by minibosses. Its paired ring and earring carry the same bonuses.`,
  equip: {
    slot: shape === "ring" ? "accessory1" : "accessory2",
    requires: { [index === 1 || index === 4 || index === 6 ? "magic" : "melee"]: tier },
    bonuses: jewelryBonuses(Object.fromEntries(MINIBOSS_JEWELRY_PROFILES[index].map((stat) => [stat, 2])))
  }
})));

// .baseline/game/src/content/fairyCreatures.ts
var FAIRY_CREATURE_ROSTER = [
  { number: "11", id: "petal_pouncer", name: "Petal Pouncer", levelOffset: -4, nativeScale: 0.7 },
  { number: "14", id: "moss_nibbler", name: "Moss Nibbler", levelOffset: -2, nativeScale: 0.65 },
  { number: "16", id: "bloom_hopper", name: "Bloom Hopper", levelOffset: 0, nativeScale: 0.8 },
  { number: "21", id: "thicket_spirit", name: "Thicket Spirit", levelOffset: 3, nativeScale: 0.9 },
  { number: "27", id: "bramble_prowler", name: "Bramble Prowler", levelOffset: 8, nativeScale: 1.1 },
  { number: "30", id: "elder_grovebeast", name: "Elder Grovebeast", levelOffset: 14, nativeScale: 1.2 }
];
var template2 = {
  id: "fairy_creature",
  family: "fairy_creature",
  name: "Fairy Creature",
  tier: 30,
  maxHealth: 70,
  attackLevel: 8,
  defenceLevel: 7,
  accuracy: 18,
  armour: 20,
  magicArmour: 12,
  maxHit: 6,
  attackSpeedMs: 2400,
  aggroRadius: 6,
  moveSpeedMps: 2.1,
  walkSpeedMps: 0.45,
  behaviour: "territorial",
  drops: []
};
var FAIRY_CREATURE_SPECIES = [
  { regionId: "gloamgarden", tier: 30 },
  { regionId: "faeholme", tier: 60 }
].flatMap(({ regionId, tier }) => FAIRY_CREATURE_ROSTER.map((row) => ({
  id: `${row.id}_t${tier}`,
  assetId: `fairy_monster_${row.number}`,
  regionId,
  scale: row.nativeScale / tierSilhouetteScale(tier),
  activity: row.levelOffset >= 8 ? "prowl" : "forage",
  description: `A T${tier} fairy grove inhabitant from Stylized Fantasy Vol 01 model ${row.number}.`,
  stats: {
    ...tuneEnemyCombatLevel(template2, tier + row.levelOffset, tier),
    id: `${row.id}_t${tier}`,
    family: row.id,
    name: row.name,
    behaviour: row.levelOffset >= 8 ? "aggressive" : "territorial",
    aggroRadius: row.levelOffset >= 8 ? 8 : 5,
    drops: [
      ...regionalFabricDrops(tier),
      { itemId: "earth_essence", quantity: [1, 3], chance: 0.55 },
      { itemId: tier === 30 ? "chaos_rune" : "blood_rune", quantity: [1, 2], chance: 0.18 },
      { itemId: "cosmic_rune", quantity: [1, 1], chance: 0.14 }
    ],
    marks: [tier * 3, tier * 7]
  }
})));

// .baseline/game/src/content/fairyGardenCreatures.ts
var FAIRY_GARDEN_FORMS = [
  { id: "spriggle", source: "fairy_monster_10", names: ["Dewdrop Spriggle", "Prism Spriggle"], scale: 0.75, level: -3, speed: 0.8, activity: "forage", behaviour: "territorial", look: "mint", description: "A rotund garden sprite with curling tail, stone buds and winding markings across its back." },
  { id: "sporekin", source: "creature_goblin_shaman", names: ["Mooncap Sporekin", "Duskcap Sporekin"], scale: 0.65, level: -6, speed: 1.1, activity: "forage", behaviour: "passive", look: "rose", description: "A staff-carrying woodland fey with spore-dappled skin and fungal markings on its robes." },
  { id: "frog", source: "animal_frog", names: ["Glasspond Frog", "Orchid Pondling"], scale: 3.4, level: -4, speed: 0.65, activity: "forage", behaviour: "territorial", look: "mint", description: "A jewel-coloured frog resting in the damp shade of the gardens." },
  { id: "imp", source: "fairy_monster_19", names: ["Lantern Imp", "Twilight Imp"], scale: 0.85, level: 1, speed: 1.1, activity: "forage", behaviour: "territorial", look: "rose", description: "A small, one-eyed winged imp with pale membranes and curling horns." },
  { id: "snail", source: "creature_quarry_snail", names: ["Mooncap Snail", "Starcap Snail"], scale: 2.1, level: -2, speed: 0.3, activity: "forage", behaviour: "passive", look: "rose", description: "A slow garden snail carrying a lilac spiral shell." },
  { id: "reliquary", source: "fairy_monster_28", names: ["Dewglass Reliquary", "Starporcelain Reliquary"], scale: 0.95, level: 0, speed: 0.55, activity: "patrol", behaviour: "territorial", look: "mint", description: "A squat one-eyed construct with moss-veined porcelain plates and gilded vine inlays." },
  { id: "hart", source: "animal_deer", names: ["Silverleaf Hart", "Starhorn Hart"], scale: 0.85, level: 2, speed: 1.2, activity: "graze", behaviour: "territorial", look: "pearl", description: "A pale woodland hart with silver antlers and a cool sheen across its coat." },
  { id: "veilspirit", source: "creature_wraith", names: ["Thistledown Veilspirit", "Orchid Veilspirit"], scale: 0.75, level: 4, speed: 1.2, activity: "prowl", behaviour: "territorial", look: "rose", description: "A hovering fey spirit wrapped in trailing veils sewn with branching veins and tiny stars." },
  { id: "sapling", source: "creature_briar_harrow", names: ["Briar Sapling", "Starroot Tender"], scale: 0.52, level: 7, speed: 0.85, activity: "patrol", behaviour: "territorial", look: "mint", description: "A small walking tree with twisted root hands and light inside its bark." },
  { id: "drake", source: "creature_baby_red_dragon", names: ["Petal Drake", "Orchid Drake"], scale: 0.72, level: 9, speed: 0.9, activity: "prowl", behaviour: "aggressive", look: "rose", description: "A young fairy drake with flower-coloured scales and broad folded wings." },
  { id: "wardling", source: "fairy_monster_34", names: ["Dewstone Wardling", "Amethyst Wardling"], scale: 1.2, level: 11, speed: 1, activity: "patrol", behaviour: "territorial", look: "mint", description: "A compact guardian made of separated, floating stones around a luminous mineral core." },
  { id: "petalguard", source: "fairy_monster_31", names: ["Silverleaf Petalguard", "Moonstone Petalguard"], scale: 1.5, level: 5, speed: 0.7, activity: "patrol", behaviour: "territorial", look: "pearl", description: "A small enchanted suit of armor with leaf-etched enamel, a gemstone shield and a narrow blade." }
];
var FAIRY_GARDEN_VARIANTS = [{ regionId: "gloamgarden", tier: 30 }, { regionId: "faeholme", tier: 60 }].flatMap(({ regionId, tier }, index) => FAIRY_GARDEN_FORMS.map((form) => ({
  ...form,
  regionId,
  tier,
  name: form.names[index],
  family: `garden_${form.id}`,
  id: `garden_${form.id}_t${tier}`,
  assetId: `fairy_garden_${form.id}_${regionId}`
})));
var template3 = {
  id: "fairy_garden",
  family: "fairy_garden",
  name: "Garden Creature",
  tier: 30,
  maxHealth: 70,
  attackLevel: 8,
  defenceLevel: 7,
  accuracy: 18,
  armour: 20,
  magicArmour: 12,
  maxHit: 6,
  attackSpeedMs: 2400,
  aggroRadius: 5,
  moveSpeedMps: 1,
  walkSpeedMps: 0.3,
  behaviour: "territorial",
  drops: []
};
var FAIRY_GARDEN_SPECIES = FAIRY_GARDEN_VARIANTS.map((form) => ({
  id: form.id,
  assetId: form.assetId,
  regionId: form.regionId,
  scale: form.scale / tierSilhouetteScale(form.tier),
  activity: form.activity,
  description: form.description,
  stats: {
    ...tuneEnemyCombatLevel(template3, form.tier + form.level, form.tier),
    id: form.id,
    family: form.family,
    name: form.name,
    behaviour: form.behaviour,
    moveSpeedMps: form.speed,
    walkSpeedMps: Math.min(0.35, form.speed * 0.45),
    aggroRadius: form.behaviour === "aggressive" ? 7 : 4,
    drops: [
      ...regionalFabricDrops(form.tier),
      { itemId: "earth_essence", quantity: [1, 3], chance: 0.55 },
      { itemId: form.tier === 30 ? "chaos_rune" : "blood_rune", quantity: [1, 2], chance: 0.18 },
      { itemId: "cosmic_rune", quantity: [1, 1], chance: 0.14 }
    ],
    marks: [form.tier * 3, form.tier * 7]
  }
}));

// .baseline/game/src/content/regionalCreatureVariants.ts
var variants = [
  ["gloam_fox", "redbrush_fox", "Gloam Fox", "fallowmarch", 1.08, 12, "air_essence", "Lilac dusk fur marks this shy hedge spirit."],
  ["moonweave_spider", "webweaver_spider", "Moonweave Spider", "vellenwood", 0.82, 28, "earth_essence", "A jade woodland spider with a faintly luminous shell."],
  ["rimeback_tortoise", "slateback_tortoise", "Rimeback Tortoise", "karrowmoor", 1.12, 44, "water_essence", "An ice-blue shell protects this slow highland browser."],
  ["cindercrest_salamander", "kiln_salamander", "Cindercrest Salamander", "kilnhalt", 1.15, 62, "fire_essence", "A copper crawler whose skin glows like cooling embers."],
  ["amethyst_spider", "webweaver_spider", "Amethyst Spider", "gravelmaw", 0.72, 32, "earth_essence", "A violet cave hunter with a mineral sheen."]
];
var REGIONAL_CREATURE_VARIANTS = variants.map(([id, baseId, name, regionId, scale, health, essence, description]) => {
  const base = [...CREATURE_EXPANSION, ...RPG_BESTIARY].find((row) => row.id === baseId);
  return {
    ...base,
    id,
    assetId: `creature_${id}`,
    regionId,
    scale,
    description,
    stats: {
      ...base.stats,
      id: `${id}_t${base.stats.tier}`,
      family: id,
      name,
      maxHealth: health,
      magicArmour: base.stats.magicArmour + 12,
      drops: [...base.stats.drops, { itemId: essence, quantity: [1, 1], chance: 0.25 }]
    }
  };
});

// .baseline/game/src/content/creatureSpecies.ts
var CREATURE_SPECIES = [
  ...CREATURE_EXPANSION,
  ...STARTER_CREATURES,
  ...RED_WORM_SPECIES,
  ...REGIONAL_CREATURE_VARIANTS,
  ...CREATURE_REDESIGNS,
  ...FOREST_CREATURE_REDESIGNS,
  ...ASH_CREATURE_REDESIGNS,
  ...STONE_CREATURE_REDESIGNS,
  ...WILDERNESS_DRAGONS,
  ...WILDERNESS_CREATURE_SPECIES,
  ...FAIRY_CROWN_SPECIES,
  ...CROWNWARD_DRAGON_SPECIES,
  ...FAIRY_CREATURE_SPECIES,
  ...FAIRY_GARDEN_SPECIES,
  ...UNIVERSAL_MINIBOSS_SPECIES
];

// .baseline/game/src/content/biomePopulation.ts
var BIOME_POPULATION_LEGACY_REPLACEMENTS = {
  palewood_adders: "thorn_maw",
  regional_gloam_fox: "heath_jack",
  regional_redbrush_fox: "heath_jack",
  pack_fallowmarch_palewood_far_south_scrub: "thorn_maw",
  pack_fallowmarch_palewood_heath_scrub: "heath_jack",
  pack_fallowmarch_palewood_reed_scrub: "reed_strider",
  pack_fallowmarch_bracken_northeast_spiders: "thorn_maw",
  marchwild_horse_residents: "briar_harrow",
  duskoak_stags: "briar_harrow",
  bramble_hogs: "fen_crawler",
  deepwood_coyotes: "heath_jack",
  blackwater_frogs: "reed_strider",
  rootfall_coneys: "thorn_maw",
  thornline_adders: "thorn_maw",
  pack_vellenwood_marchgate_south_bramble: "thorn_maw",
  pack_vellenwood_mossbound_west_bramble: "fen_crawler",
  duskoak_lynx_residents: "heath_jack",
  rootdelve_badger_residents: "briar_harrow",
  marsh_moose_residents: "briar_harrow",
  bracken_tapir_residents: "fen_crawler",
  blackwater_heron_residents: "reed_strider",
  quarry_snail_residents: "thorn_maw",
  hollowroot_spider_residents: "thorn_maw",
  highcairn_bears: "cairn_treader",
  scree_boars: "vault_custodian",
  ridge_ibex: "scree_watcher",
  terrace_aurochs: "vault_custodian",
  tarn_coyotes: "cairn_treader",
  pack_karrowmoor_tarn_track_east_mandibles: "flint_mandible",
  pack_karrowmoor_moor_road_far_west_watch: "vault_custodian",
  quillback_porcupine_residents: "scree_watcher",
  cairn_bighorn_residents: "cairn_treader",
  reedjaw_crocodile_residents: "flint_mandible",
  slateback_tortoise_residents: "vault_custodian",
  scree_bustard_residents: "scree_watcher",
  antler_beetle_residents: "flint_mandible",
  quarry_nightmare_residents: "cairn_treader",
  gravelmaw_ch1_rats: "blind_cave_weaver",
  gravelmaw_ch2_scorpions: "blind_cave_weaver",
  gravelmaw_ch2_crabs: "flint_mandible",
  gravelmaw_ch3_bears: "vault_custodian",
  gravelmaw_amethyst_spiders: "blind_cave_weaver",
  ashback_bears: "kiln_marrow",
  cinder_boars: "slag_crawler",
  emberhorn_ibex: "cinder_penitent",
  cinder_adders: "grave_lantern",
  pack_kilnhalt_clinker_southern_approach_west: "kiln_marrow",
  pack_kilnhalt_cinderpine_northwest_outer: "slag_crawler",
  kiln_salamander_residents: "slag_crawler",
  ashscale_monitor_residents: "cinder_penitent",
  slag_centipede_residents: "slag_crawler",
  cinder_ravager_residents: "kiln_marrow",
  basalt_drake_residents: "slag_crawler",
  gorge_mantis_residents: "veil_reaper"
};
var BIOME_POPULATION = [
  { id: "population_palewood_south_harrow", speciesId: "briar_harrow", regionId: "fallowmarch", centre: [-314, -122], count: 2, radius: 9 },
  { id: "population_palewood_west_jacks", speciesId: "heath_jack", regionId: "fallowmarch", centre: [-296, -50], count: 3, radius: 9 },
  { id: "population_palewood_root_maws", speciesId: "thorn_maw", regionId: "fallowmarch", centre: [-290, -2], count: 3, radius: 9 },
  { id: "population_northgate_fen_crawlers", speciesId: "fen_crawler", regionId: "fallowmarch", centre: [-62, 70], count: 3, radius: 9 },
  { id: "population_galeskin_south_jacks", speciesId: "heath_jack", regionId: "fallowmarch", centre: [-308, 100], count: 3, radius: 9 },
  { id: "population_northern_march_harrows", speciesId: "briar_harrow", regionId: "fallowmarch", centre: [-224, 106], count: 2, radius: 9 },
  { id: "population_bracken_north_striders", speciesId: "reed_strider", regionId: "fallowmarch", centre: [-116, 112], count: 3, radius: 9 },
  { id: "population_northgate_outer_jacks", speciesId: "heath_jack", regionId: "fallowmarch", centre: [-62, 118], count: 3, radius: 9 },
  { id: "population_marchgate_root_maws", speciesId: "thorn_maw", regionId: "vellenwood", centre: [28, 52], count: 3, radius: 9 },
  { id: "population_blackwater_south_crawlers", speciesId: "fen_crawler", regionId: "vellenwood", centre: [124, 40], count: 3, radius: 9 },
  { id: "population_gorge_south_striders", speciesId: "reed_strider", regionId: "vellenwood", centre: [208, 34], count: 3, radius: 9 },
  { id: "population_mossbound_south_harrows", speciesId: "briar_harrow", regionId: "vellenwood", centre: [298, 40], count: 2, radius: 9 },
  { id: "population_rootfall_west_jacks", speciesId: "heath_jack", regionId: "vellenwood", centre: [34, 76], count: 3, radius: 9 },
  { id: "population_rootfall_south_crawlers", speciesId: "fen_crawler", regionId: "vellenwood", centre: [82, 64], count: 3, radius: 9 },
  { id: "population_thornline_south_maws", speciesId: "thorn_maw", regionId: "vellenwood", centre: [226, 112], count: 3, radius: 9 },
  { id: "population_rootheart_south_harrows", speciesId: "briar_harrow", regionId: "vellenwood", centre: [304, 112], count: 2, radius: 9 },
  { id: "population_mire_skirt_striders", speciesId: "reed_strider", regionId: "vellenwood", centre: [-8, 94], count: 3, radius: 9 },
  { id: "population_hollowcut_east_harrows", speciesId: "briar_harrow", regionId: "vellenwood", centre: [154, 154], count: 2, radius: 9 },
  { id: "population_thornline_north_jacks", speciesId: "heath_jack", regionId: "vellenwood", centre: [232, 184], count: 3, radius: 9 },
  { id: "population_rootheart_east_maws", speciesId: "thorn_maw", regionId: "vellenwood", centre: [334, 184], count: 3, radius: 9 },
  { id: "population_cairn_south_weavers", speciesId: "blind_cave_weaver", regionId: "karrowmoor", centre: [34, -128], count: 3, radius: 9 },
  { id: "population_low_moor_custodians", speciesId: "vault_custodian", regionId: "karrowmoor", centre: [100, -176], count: 2, radius: 9 },
  { id: "population_upper_seam_mandibles", speciesId: "flint_mandible", regionId: "karrowmoor", centre: [214, -164], count: 3, radius: 9 },
  { id: "population_south_ridge_watchers", speciesId: "scree_watcher", regionId: "karrowmoor", centre: [268, -170], count: 3, radius: 9 },
  { id: "population_cairn_hall_outer_weavers", speciesId: "blind_cave_weaver", regionId: "karrowmoor", centre: [40, -80], count: 3, radius: 9 },
  { id: "population_second_ramp_treaders", speciesId: "cairn_treader", regionId: "karrowmoor", centre: [76, -86], count: 2, radius: 9 },
  { id: "population_cairn_tarn_west_watchers", speciesId: "scree_watcher", regionId: "karrowmoor", centre: [202, -50], count: 3, radius: 9 },
  { id: "population_far_tarn_mandibles", speciesId: "flint_mandible", regionId: "karrowmoor", centre: [322, -74], count: 3, radius: 9 },
  { id: "population_gravelmaw_west_weavers", speciesId: "blind_cave_weaver", regionId: "karrowmoor", centre: [22, -38], count: 3, radius: 9 },
  { id: "population_low_terrace_custodians", speciesId: "vault_custodian", regionId: "karrowmoor", centre: [52, -44], count: 2, radius: 9 },
  { id: "population_northern_tarn_treaders", speciesId: "cairn_treader", regionId: "karrowmoor", centre: [208, -26], count: 2, radius: 9 },
  { id: "population_east_tarn_watchers", speciesId: "scree_watcher", regionId: "karrowmoor", centre: [304, -20], count: 3, radius: 9 },
  { id: "population_clinker_south_crawlers", speciesId: "slag_crawler", regionId: "kilnhalt", centre: [-266, 260], count: 3, radius: 9 },
  { id: "population_kilnroad_west_marrow", speciesId: "kiln_marrow", regionId: "kilnhalt", centre: [-92, 248], count: 2, radius: 9 },
  { id: "population_emberfast_south_penitents", speciesId: "cinder_penitent", regionId: "kilnhalt", centre: [88, 248], count: 3, radius: 9 },
  { id: "population_ashfin_east_crawlers", speciesId: "slag_crawler", regionId: "kilnhalt", centre: [262, 248], count: 3, radius: 9 },
  { id: "population_clinker_west_marrow", speciesId: "kiln_marrow", regionId: "kilnhalt", centre: [-296, 332], count: 2, radius: 9 },
  { id: "population_emberfast_west_lanterns", speciesId: "grave_lantern", regionId: "kilnhalt", centre: [-92, 314], count: 3, radius: 9 },
  { id: "population_emberfast_east_penitents", speciesId: "cinder_penitent", regionId: "kilnhalt", centre: [88, 320], count: 3, radius: 9 },
  { id: "population_cinderpine_east_crawlers", speciesId: "slag_crawler", regionId: "kilnhalt", centre: [280, 332], count: 3, radius: 9 },
  { id: "population_west_cinder_reapers", speciesId: "veil_reaper", regionId: "kilnhalt", centre: [-248, 398], count: 3, radius: 9 },
  { id: "population_ashback_north_lanterns", speciesId: "grave_lantern", regionId: "kilnhalt", centre: [-86, 416], count: 3, radius: 9 },
  { id: "population_north_track_penitents", speciesId: "cinder_penitent", regionId: "kilnhalt", centre: [88, 410], count: 3, radius: 9 },
  { id: "population_cinderwake_west_marrow", speciesId: "kiln_marrow", regionId: "kilnhalt", centre: [244, 416], count: 2, radius: 9 },
  { id: "population_broken_watch_lanterns", speciesId: "grave_lantern", regionId: "wilderness", centre: [-272, 496], count: 3, radius: 9 },
  { id: "population_last_light_west_penitents", speciesId: "cinder_penitent", regionId: "wilderness", centre: [-92, 484], count: 3, radius: 9 },
  { id: "population_last_light_east_shades", speciesId: "pallid_shade", regionId: "wilderness", centre: [88, 502], count: 3, radius: 9 },
  { id: "population_east_march_reapers", speciesId: "veil_reaper", regionId: "wilderness", centre: [262, 502], count: 3, radius: 9 },
  { id: "population_deadwood_west_boughs", speciesId: "hollow_bough", regionId: "wilderness", centre: [-260, 580], count: 2, radius: 9 },
  { id: "population_abbey_east_lanterns", speciesId: "grave_lantern", regionId: "wilderness", centre: [-86, 580], count: 3, radius: 9 },
  { id: "population_black_keep_east_reapers", speciesId: "veil_reaper", regionId: "wilderness", centre: [88, 586], count: 3, radius: 9 },
  { id: "population_petrified_grove_south_shades", speciesId: "pallid_shade", regionId: "wilderness", centre: [280, 574], count: 3, radius: 9 },
  { id: "population_aqueduct_west_lanterns", speciesId: "grave_lantern", regionId: "wilderness", centre: [-260, 664], count: 3, radius: 9 },
  { id: "population_silent_stones_reapers", speciesId: "veil_reaper", regionId: "wilderness", centre: [-50, 635], count: 3, radius: 9 },
  { id: "population_black_keep_north_penitents", speciesId: "cinder_penitent", regionId: "wilderness", centre: [88, 658], count: 3, radius: 9 },
  { id: "population_lava_east_marrow", speciesId: "kiln_marrow", regionId: "wilderness", centre: [262, 658], count: 2, radius: 9 }
];
var BIOME_POPULATION_HABITATS = BIOME_POPULATION.map((pack) => ({
  id: `${pack.id}_habitat`,
  groupId: pack.id,
  regionId: pack.regionId,
  centre: pack.centre,
  radius: pack.radius,
  activity: "patrol",
  dressing: [],
  anchors: Array.from({ length: Math.max(pack.count, 4) }, (_, index) => {
    const angle = index / Math.max(pack.count, 4) * Math.PI * 2 + 0.3;
    return [
      Number((pack.centre[0] + Math.cos(angle) * 5.25).toFixed(3)),
      Number((pack.centre[1] + Math.sin(angle) * 5.25).toFixed(3))
    ];
  })
}));
function resolveBiomePopulation(species2) {
  const byId = new Map(species2.map((row) => [row.id, row]));
  const tierByRegion = {
    fallowmarch: 1,
    vellenwood: 5,
    karrowmoor: 10,
    kilnhalt: 20,
    wilderness: 20,
    crownward: 40,
    gloamgarden: 30,
    faeholme: 60
  };
  return BIOME_POPULATION.map((pack) => {
    const creature = byId.get(pack.speciesId);
    if (!creature) throw new Error(`Missing accepted population species ${pack.speciesId} for ${pack.id}`);
    const previousTier = Object.values(BIOME_POPULATION_LEGACY_REPLACEMENTS).includes(creature.id) ? tierByRegion[pack.regionId] : creature.stats.tier;
    const tier = pack.regionId === "wilderness" ? 50 : previousTier;
    return {
      id: pack.id,
      family: creature.stats.family,
      name: creature.stats.name,
      tier,
      assetId: creature.assetId,
      scale: creature.scale * tierSilhouetteScale(previousTier) / tierSilhouetteScale(tier),
      centre: pack.centre,
      count: pack.count,
      radius: pack.radius
    };
  });
}

// .baseline/game/src/content/encounterDressing.ts
function encounterSetting(family, centre, availableRadius) {
  if (!Number.isFinite(availableRadius) || availableRadius < 1.5)
    throw new Error(`Encounter ${family} needs at least 1.5 m of central setting space`);
  const roomy = availableRadius >= 2.7;
  let kind, purpose, pieces;
  if (["goblin", "orc", "gnoll", "lizardman"].includes(family)) {
    kind = "supply-camp";
    purpose = "A lookout's ration cache and water barrel mark a defended rest stop. The open south side is its approach.";
    pieces = [
      { id: "ration-cache", assetId: "crate_wood", x: -0.65, z: -0.55, yaw: 0.08, scale: 0.85 },
      { id: "water-barrel", assetId: "barrel", x: 0.62, z: -0.55, yaw: 0, scale: 0.9 }
    ];
    if (roomy) pieces.push(
      { id: "back-barricade", assetId: "fence_wood_single", x: 0, z: -1.75, yaw: 0, scale: 1 },
      { id: "blade-stone", assetId: "whetstone", x: -1.65, z: 0.2, yaw: 0.25, scale: 0.75 }
    );
  } else if (["skeleton", "zombie", "wraith"].includes(family)) {
    kind = "burial-shrine";
    purpose = "Paired weathered grave markers face a broken offering table, leaving a clear approach for mourners and intruders.";
    pieces = [
      { id: "offering-table", assetId: "altar_ruins_altar", x: 0, z: -0.6, yaw: 0, scale: 0.8 }
    ];
    if (roomy) pieces.push(
      { id: "grave-west", assetId: "corealm_rock_strata_3", x: -1.7, z: 0.25, yaw: 0.1, scale: [0.1, 0.36, 0.17], sink: 0.08 },
      { id: "grave-east", assetId: "corealm_rock_strata_3", x: 1.7, z: 0.25, yaw: -0.08, scale: [0.1, 0.3, 0.17], sink: 0.06 },
      { id: "chapel-remnant", assetId: "wall_brick_straight", x: 0, z: -1.9, yaw: 0, scale: [0.75, 0.25, 1] }
    );
  } else if (family === "golem") {
    kind = "stone-working";
    purpose = "A split stone block and abandoned sorting crate mark an old working face. The front aisle remains open.";
    pieces = [
      { id: "split-block", assetId: "corealm_rock_strata_2", x: -0.5, z: -0.5, yaw: 0.1, scale: [0.28, 0.3, 0.25], sink: 0.08 },
      { id: "sorting-box", assetId: "crate_wood", x: 0.85, z: -0.45, yaw: -0.1, scale: 0.75 }
    ];
    if (roomy) pieces.push({
      id: "abandoned-workface",
      assetId: "corealm_rock_strata_1",
      x: 0,
      z: -1.75,
      yaw: 0.1,
      scale: [0.55, 0.45, 0.22],
      sink: 0.16
    });
  } else if (family === "harpy" || family === "gargoyle") {
    kind = "roost";
    purpose = "An exposed stone perch anchors the roost. Its low fallen slab leaves landing and retreat space around it.";
    pieces = [{
      id: "stone-perch",
      assetId: "corealm_rock_strata_2",
      x: 0,
      z: -0.5,
      yaw: 0.1,
      scale: [0.28, 0.4, 0.25],
      sink: 0.1
    }];
    if (roomy) pieces.push({
      id: "fallen-slab",
      assetId: "corealm_rock_strata_3",
      x: -1.5,
      z: 0.3,
      yaw: 0.4,
      scale: [0.2, 0.13, 0.3],
      sink: 0.08
    });
  } else {
    kind = "ritual-court";
    purpose = "A surviving altar and broken rear wall mark a ruined ritual court. Its open front gives the guards a readable approach.";
    pieces = [{ id: "ritual-altar", assetId: "altar_ruins_altar", x: 0, z: -0.6, yaw: 0, scale: 0.8 }];
    if (roomy) pieces.push({
      id: "court-remnant",
      assetId: "wall_brick_straight",
      x: 0,
      z: -1.9,
      yaw: 0,
      scale: [0.9, 0.35, 1]
    });
  }
  return { kind, purpose, approach: "south", dressing: pieces.map((piece) => ({
    ...piece,
    x: centre[0] + piece.x,
    z: centre[1] + piece.z
  })) };
}

// .baseline/game/src/render/compositions/wildernessRuins.ts
var WILDERNESS_RUINS = {
  wilderness_broken_watchtower: {
    name: "Broken watchtower",
    footprint: [22, 20],
    clearThrough: [[0, 12], [0, -12]],
    torches: [
      { position: [-3.6, 1.9, 4.54], yaw: 0 },
      { position: [3.6, 1.7, -4.54], yaw: Math.PI },
      { position: [-4.06, 5.3, -2.8], yaw: Math.PI / 2 }
    ]
  },
  wilderness_roofless_abbey: {
    name: "Roofless abbey",
    footprint: [28, 34],
    clearThrough: [[0, 18], [0, -18]],
    torches: [
      { position: [-4.8, 2.1, 11.54], yaw: 0 },
      { position: [4.8, 2.1, -11.54], yaw: Math.PI },
      { position: [-7.96, 1.8, 0], yaw: Math.PI / 2 }
    ]
  },
  wilderness_ruined_smithy: {
    name: "Ruined smithy",
    footprint: [30, 22],
    clearThrough: [[0, 13], [0, -13]],
    torches: [{ position: [-3.46, 1.8, 3], yaw: Math.PI / 2 }, { position: [3.46, 1.8, -3], yaw: -Math.PI / 2 }]
  },
  wilderness_shattered_aqueduct: {
    name: "Shattered aqueduct",
    footprint: [42, 16],
    clearThrough: [[0, 10], [0, -10]],
    torches: [{ position: [-3.8, 1.9, 1.04], yaw: 0 }, { position: [3.8, 1.9, -1.04], yaw: Math.PI }]
  }
};

// .baseline/game/src/content/wildernessLandmarks.ts
var WILDERNESS_RUIN_SITES = [
  { id: "broken_watch_tower", name: "Broken Watchtower", position: [-250, 520], composition: "wilderness_broken_watchtower", rotationY: 0.2 },
  { id: "nameless_abbey", name: "The Nameless Abbey", position: [-130, 610], composition: "wilderness_roofless_abbey", rotationY: 0.12 },
  { id: "dead_smithy", name: "Cinderwatch Smithy", position: [130, 565], composition: "wilderness_ruined_smithy", rotationY: -0.45 },
  { id: "fallen_aqueduct", name: "The Broken Waterway", position: [-205, 665], composition: "wilderness_shattered_aqueduct", rotationY: 0.17 },
  { id: "outer_watch", name: "Widow Watch", position: [-310, 575], composition: "wilderness_broken_watchtower", rotationY: 1.9 },
  // Moved 5 m north off [-55, 675]. The Cinder Crossing road junction at [-65, 690] takes a
  // generic 7 m location pad that grades 0.87 m higher, and its core used to reach 2.2 m inside
  // this ruin's pad. applyFlats averages overlapping cores by depth, so the shared lattice
  // vertices built high and tilted the rotated footprint's south-west corner 0.099 m out of
  // level. Separating the two pads levels all eight ruins exactly and moves the ruin further off
  // the Grave Road centreline. legacyEncounterPlacements.ts carries the matching haunt centre.
  { id: "forgotten_forge", name: "The Cold Forge", position: [-55, 670], composition: "wilderness_ruined_smithy", rotationY: 2.4 },
  { id: "eastern_cloister", name: "Hollow Choir Cloister", position: [305, 670], composition: "wilderness_roofless_abbey", rotationY: -0.4 },
  { id: "eastern_aqueduct", name: "The Empty Sluice", position: [230, 555], composition: "wilderness_shattered_aqueduct", rotationY: Math.PI / 2 },
  { id: "east_kingspan", name: "The Lost Kingspan", position: [390, 500], composition: "wilderness_shattered_aqueduct", rotationY: 1.34 },
  { id: "ashwind_cloister", name: "Ashwind Cloister", position: [505, 585], composition: "wilderness_roofless_abbey", rotationY: 2.53 },
  { id: "far_cinder_smithy", name: "Far Cinder Smithy", position: [665, 660], composition: "wilderness_ruined_smithy", rotationY: -2.23 },
  { id: "rift_watch", name: "Rift Watch", position: [385, 775], composition: "wilderness_broken_watchtower", rotationY: 1.51 },
  { id: "nightglass_waterway", name: "The Nightglass Waterway", position: [535, 815], composition: "wilderness_shattered_aqueduct", rotationY: 2.68 },
  { id: "starless_abbey", name: "The Starless Abbey", position: [675, 915], composition: "wilderness_roofless_abbey", rotationY: 2.78 }
];
var WILDERNESS_RUIN_LANDMARKS = WILDERNESS_RUIN_SITES.map((site) => ({
  ...site,
  assetId: "kerb_straight",
  compositionOnly: true,
  blurb: `${WILDERNESS_RUINS[site.composition].name}. Broken masonry and the last burning torches mark an open way through.`
}));
var WILDERNESS_RUIN_LOCATIONS = WILDERNESS_RUIN_SITES.filter((site) => site.id !== "broken_watch_tower").map((site) => ({ id: `${site.id}_site`, name: site.name, position: site.position, kind: "landmark", routeNode: true }));

// .baseline/game/src/content/wildernessResources.ts
var labels = {
  cindervein_workings: "Cindervein Workings",
  nightglass_excavation: "Nightglass Excavation",
  lastroot_teak: "Lastroot Shelter",
  ember_shelter_teak: "Ember Shelter",
  starwood_hollow: "Starwood Hollow",
  moonvein_copse: "Moonvein Copse",
  east_cinder_cut: "East Cinder Cut",
  ashwind_shelter: "Ashwind Shelter",
  nightglass_ridge: "Nightglass Ridge",
  starfall_copse: "Starfall Copse"
};
var clusterId = (id) => `${id}_resources`;
var EASTERN_SITE_ROTATIONS = {
  east_cinder_cut: -1.25,
  ashwind_shelter: 1.42,
  nightglass_ridge: -1.99,
  starfall_copse: 2.09
};
var WILDERNESS_RESOURCE_LOCATIONS = WILDERNESS_RESOURCE_INTENTS.map((intent) => ({
  id: intent.id,
  name: labels[intent.id],
  position: intent.position,
  kind: intent.kind === "mine" ? "seam" : "grove",
  routeNode: true,
  blurb: intent.kind === "mine" ? `Worked T${intent.tier} seams open above a dry mining aisle.` : intent.tier === 50 ? "Veinwood survives in a sheltered pocket among scorched trunks." : "Old magic trees draw blue and violet sap through the deep stone."
}));
var WILDERNESS_RESOURCE_CLUSTERS = WILDERNESS_RESOURCE_INTENTS.map((intent) => ({
  id: clusterId(intent.id),
  resourceId: intent.kind === "mine" ? intent.tier === 50 ? "cindervein_vein" : "nightglass_vein" : intent.tier === 50 ? "tree_wilderness_teak" : "tree_wilderness_magic",
  count: intent.kind === "mine" ? 7 : 9,
  centre: intent.position,
  radius: intent.kind === "mine" ? 13 : 18,
  locationId: intent.id
}));
var WILDERNESS_RESOURCE_SITES = WILDERNESS_RESOURCE_INTENTS.map((intent) => {
  const mine = intent.kind === "mine", cluster = clusterId(intent.id), deep = intent.tier === 70;
  const rotationY = EASTERN_SITE_ROTATIONS[intent.id] ?? (mine ? Math.PI : 0.18);
  const site = {
    id: intent.id,
    locationId: intent.id,
    regionId: "wilderness",
    centre: intent.position,
    rotationY,
    kind: intent.kind,
    workRadius: mine ? 8 : 10,
    extent: mine ? [23, 25] : [23, 23],
    terrain: { floorRadius: mine ? 10.5 : 16, backRise: mine ? 5.4 : 1.15, backDistance: mine ? 7.2 : 21, bermWidth: mine ? 10 : 8, approachAngle: 0 },
    resourceSlots: mine ? Array.from({ length: 7 }, (_, i) => {
      const x = (i - 3) * 3.65;
      return { clusterId: cluster, index: i + 1, x, z: -4.5 + Math.abs(i - 3) * 0.46, yaw: -(i - 3) * 0.095, scale: [0.94, 1.06, 0.98, 1.08, 0.95, 1.03, 0.97][i] };
    }) : Array.from({ length: 9 }, (_, i) => {
      const left = i < 5, rank = left ? i : i - 5;
      return {
        clusterId: cluster,
        index: i + 1,
        x: (left ? -1 : 1) * (8 + rank % 2 * 6.6),
        z: -13 + rank * 6.1,
        yaw: i * 2.399963,
        scale: [0.91, 1.02, 0.96, 1.06, 0.94, 1, 0.92, 1.04, 0.97][i]
      };
    }),
    ...mine ? { cutFace: {
      backDepth: 10.4,
      buryDepth: 0.65,
      frontSetback: 0.4,
      stations: Array.from({ length: 7 }, (_, i) => ({ clusterId: cluster, index: i + 1, crestHeight: [3.2, 3.7, 3.5, 3.9, 3.4, 3.6, 3.1][i] }))
    } } : {},
    dressing: mine ? [
      { id: "west-shoulder", assetId: "corealm_rock_strata_3", x: -13.8, z: -6.3, yaw: 0.62, scale: [1.25, 1.1, 1.1], sink: 0.48 },
      { id: "east-shoulder", assetId: "corealm_rock_strata_1", x: 13.7, z: -6, yaw: -0.74, scale: [1.2, 1.05, 1.17], sink: 0.52 },
      { id: "tailings", assetId: "corealm_scree_2", x: -14.4, z: 2.5, yaw: 0.43, scale: [1.25, 0.85, 1.08], sink: 0.12 },
      // Handling sits on the graded floor east of the last station, inside the working area and
      // clear of both the mining stances and the central haul lane.
      { id: "sorting-bench", assetId: "workbench", x: 12.9, z: 1.5, yaw: -0.28, scale: 1 },
      { id: "ore-crate", assetId: "crate_wood", x: 14.5, z: 2.3, yaw: 0.22, scale: 0.9 }
    ] : [
      { id: "windbreak-west", assetId: "corealm_rock_strata_1", x: -18.8, z: -8, yaw: 0.38, scale: [1.2, 0.84, 0.85], sink: 0.3 },
      { id: "windbreak-east", assetId: "corealm_rock_strata_3", x: 18.5, z: -6, yaw: -0.45, scale: [1.12, 0.84, 0.9], sink: 0.3 },
      { id: "old-trunk", assetId: "corealm_deadwood_fallen", x: 0, z: -18, yaw: Math.PI / 2, scale: 0.75, sink: 0.08 },
      ...!deep ? [
        { id: "living-understory-west", assetId: "corealm_fern_1", x: -8.8, z: 7.5, yaw: 0.3, scale: 1.1 },
        { id: "living-understory-east", assetId: "corealm_shrub_2", x: 9, z: 7.8, yaw: 1.2, scale: 0.85 }
      ] : []
    ]
  };
  return site;
});

// .baseline/game/src/content/encounterPopulation.ts
var ENCOUNTER_POPULATION_LIMITS = { minimum: 7, maximum: 15, bodyGap: 0.5 };
function hashId(id) {
  let value = 2166136261;
  for (let index = 0; index < id.length; index++) value = Math.imul(value ^ id.charCodeAt(index), 16777619);
  return value >>> 0;
}
function encounterPopulationCount(group) {
  if (group.boss || group.miniBoss) return 1;
  if (group.countPolicy === "fixed") {
    if (!Number.isInteger(group.count) || group.count < 1 || group.count > ENCOUNTER_POPULATION_LIMITS.maximum)
      throw new Error(`${group.id}: fixed resident count must be between 1 and ${ENCOUNTER_POPULATION_LIMITS.maximum}`);
    return group.count;
  }
  if (Number.isInteger(group.count) && group.count >= 7 && group.count <= 15) return group.count;
  return ENCOUNTER_POPULATION_LIMITS.minimum + hashId(group.id) % 9;
}
function encounterActorId(group, index, legacyCount = group.legacyCount ?? group.count) {
  if (!Number.isInteger(index) || index < 0) throw new Error(`${group.id}: invalid actor index`);
  return legacyCount === 1 && index === 0 ? group.id : `${group.id}_${index + 1}`;
}
var EncounterFormationError = class extends Error {
  constructor(groupId, required, placed, maxRadius) {
    super(`${groupId}: only ${placed}/${required} residents fit inside ${maxRadius.toFixed(2)} m; enlarge or move the encounter`);
    this.groupId = groupId;
    this.required = required;
    this.placed = placed;
    this.maxRadius = maxRadius;
    this.name = "EncounterFormationError";
  }
  groupId;
  required;
  placed;
  maxRadius;
};
function createEncounterFormation(group, options) {
  const boss = group.boss || group.miniBoss;
  const count = boss ? 1 : options.count ?? encounterPopulationCount(group);
  if (!Number.isFinite(options.bodyRadius) || options.bodyRadius <= 0) throw new Error(`${group.id}: invalid moving body radius`);
  const minimum = group.countPolicy === "fixed" ? 1 : ENCOUNTER_POPULATION_LIMITS.minimum;
  if (!boss && (!Number.isInteger(count) || count < minimum || count > 15))
    throw new Error(`${group.id}: ordinary population must be ${minimum}\u201315`);
  const gap = options.bodyGap ?? ENCOUNTER_POPULATION_LIMITS.bodyGap;
  if (!Number.isFinite(gap) || gap < 0) throw new Error(`${group.id}: invalid body gap`);
  const spacing = options.bodyRadius * 2 + gap;
  const maximum = options.maxRadius ?? Math.max(group.radius, spacing * 4 + options.bodyRadius);
  if (!Number.isFinite(maximum) || maximum < options.bodyRadius) throw new Error(`${group.id}: invalid formation radius`);
  const angle = options.rotationY ?? hashId(group.id) / 4294967296 * Math.PI * 2;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const anchors = [];
  const permitted = (point) => {
    if (!point.every(Number.isFinite)) return false;
    if (Math.hypot(point[0] - group.centre[0], point[1] - group.centre[1]) + options.bodyRadius > maximum + 1e-6) return false;
    if (anchors.some((other) => Math.hypot(point[0] - other[0], point[1] - other[1]) < spacing - 1e-6)) return false;
    if (options.occupied?.some((other) => Math.hypot(point[0] - other.position[0], point[1] - other.position[1]) < options.bodyRadius + other.bodyRadius + gap - 1e-6)) return false;
    return options.accepts?.(point, options.bodyRadius) ?? true;
  };
  const add = (point) => {
    if (anchors.length < count && permitted(point)) anchors.push(point);
  };
  for (const point of options.preferredAnchors ?? []) add(point);
  const candidate = (q, r) => {
    const x = spacing * (q + r * 0.5), z = spacing * r * Math.sqrt(3) * 0.5;
    add([group.centre[0] + x * cos - z * sin, group.centre[1] + x * sin + z * cos]);
  };
  candidate(0, 0);
  const directions = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  const rings = Math.min(128, Math.ceil(maximum / (spacing * Math.sqrt(3) * 0.5)) + 1);
  for (let ring = 1; ring <= rings && anchors.length < count; ring++) {
    let q = 0, r = -ring;
    for (const [dq, dr] of directions) for (let side = 0; side < ring; side++) {
      candidate(q, r);
      q += dq;
      r += dr;
    }
  }
  if (anchors.length !== count && options.preferredAnchors?.length) {
    return createEncounterFormation(group, { ...options, preferredAnchors: [] });
  }
  if (anchors.length !== count) throw new EncounterFormationError(group.id, count, anchors.length, maximum);
  const envelope = Math.max(...anchors.map((point) => Math.hypot(point[0] - group.centre[0], point[1] - group.centre[1]))) + options.bodyRadius;
  return {
    group: { ...group, count, radius: Math.max(Math.min(group.radius, maximum), envelope) },
    anchors,
    actorIds: anchors.map((_, index) => encounterActorId(group, index)),
    bodyRadius: options.bodyRadius,
    minimumSeparation: spacing
  };
}

// .baseline/game/src/render/compositions/deepWildernessStructures.ts
function court(id, centre, radius) {
  const spacing = radius === 7 ? 2.55 : 3;
  const residentSockets = [];
  for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
    if (row === 0 && column === 0) continue;
    residentSockets.push([
      centre[0] + (column - 1.5) * spacing,
      centre[1] + (row - 1.5) * spacing
    ]);
  }
  return { id, centre, radius, residentSockets, maxBodyRadius: 1.1 };
}
var footprint = (id) => WILDERNESS_EXPANSION_SITES.find((site) => site.id === id).footprint;
var DEEP_WILDERNESS_STRUCTURES = {
  cinder_chain_foundry: {
    name: "Cinder Chain Foundry",
    footprint: footprint("cinder_chain_foundry"),
    clearThrough: [[0, 30], [0, -30]],
    clearWidth: 10,
    courts: [
      court("west_casting_yard", [-16, 0], 8),
      court("east_chain_yard", [16, 0], 8),
      court("forecourt", [0, 17], 7)
    ],
    keeper: { centre: [0, -15], radius: 5 },
    torches: [
      { position: [-6.1, 2.2, 25.1], yaw: 0, theme: "ember" },
      { position: [6.1, 2.2, 25.1], yaw: 0, theme: "ember" },
      { position: [-16.7, 1.6, -19.42], yaw: 0, theme: "ember" },
      { position: [16.7, 1.6, -19.42], yaw: 0, theme: "ember" },
      { position: [-29.27, 2, 4], yaw: Math.PI / 2, theme: "ember" },
      { position: [29.27, 2, -4], yaw: -Math.PI / 2, theme: "azure" }
    ],
    inspectionStops: [[0, 32], [-16, 8], [16, -8], [0, -15]]
  },
  nightforge_bastion: {
    name: "Nightforge Bastion",
    footprint: footprint("nightforge_bastion"),
    clearThrough: [[0, 34], [0, -34]],
    clearWidth: 10,
    courts: [
      court("west_muster", [-16, 1], 9),
      court("east_muster", [16, 1], 9),
      court("gate_court", [0, 19], 7)
    ],
    keeper: { centre: [0, -15], radius: 5 },
    torches: [
      { position: [-6.1, 2.4, 29.1], yaw: 0, theme: "azure" },
      { position: [6.1, 2.4, 29.1], yaw: 0, theme: "azure" },
      { position: [-30.01, 2.4, 0], yaw: Math.PI / 2, theme: "azure" },
      { position: [30.01, 2.4, 0], yaw: -Math.PI / 2, theme: "violet" },
      { position: [-6.1, 2.4, -26.9], yaw: 0, theme: "violet" },
      { position: [6.1, 2.4, -26.9], yaw: 0, theme: "violet" }
    ],
    inspectionStops: [[0, 36], [-16, 7], [16, -6], [0, -15]]
  },
  hollow_star_sanctum: {
    name: "Hollow Star Sanctum",
    footprint: footprint("hollow_star_sanctum"),
    clearThrough: [[0, 34], [0, -34]],
    clearWidth: 10,
    courts: [
      court("west_vespers", [-17, 1], 9),
      court("east_vespers", [17, 1], 9),
      court("pilgrims_court", [0, 19], 7)
    ],
    keeper: { centre: [0, -15], radius: 5 },
    torches: [
      { position: [-6.1, 2.1, 28.1], yaw: 0, theme: "violet" },
      { position: [6.1, 2.1, 28.1], yaw: 0, theme: "azure" },
      { position: [-30.1, 1.6, 0], yaw: Math.PI / 2, theme: "violet" },
      { position: [30.1, 1.6, 0], yaw: -Math.PI / 2, theme: "azure" },
      { position: [-6.1, 2.1, -26.9], yaw: 0, theme: "azure" },
      { position: [6.1, 2.1, -26.9], yaw: 0, theme: "violet" }
    ],
    inspectionStops: [[0, 36], [-17, 8], [17, -5], [0, -15]]
  }
};

// .baseline/game/src/content/deepWildernessEncounters.ts
function courtPack(siteIndex, side) {
  const site = WILDERNESS_EXPANSION_SITES[siteIndex];
  const court2 = DEEP_WILDERNESS_STRUCTURES[site.id].courts[side === "west" ? 0 : 1];
  const [x, z] = court2.centre;
  const cos = Math.cos(site.rotationY), sin = Math.sin(site.rotationY);
  return {
    id: `${site.id}_${side}_conclave`,
    speciesId: "gloam_wraith",
    centre: [site.position[0] + x * cos + z * sin, site.position[1] - x * sin + z * cos],
    count: 7,
    radius: court2.radius,
    bodyRadius: 1.5,
    siteId: site.id,
    court: side,
    rotationY: -site.rotationY
  };
}
var DEEP_WILDERNESS_PACKS = [
  { id: "wilderness_red_hatchling_nest", speciesId: "baby_red_dragon", centre: [-178, 484], count: 7, radius: 28, bodyRadius: 2.4 },
  { id: "wilderness_black_hatchling_nest", speciesId: "baby_black_dragon", centre: [-325, 612], count: 7, radius: 28, bodyRadius: 2.4 },
  { id: "wilderness_lava_hatchling_nest", speciesId: "baby_lava_dragon", centre: [325, 620], count: 7, radius: 28, bodyRadius: 2.4 },
  { id: "wilderness_cinderback_scree", speciesId: "cinderback_crag", centre: [-181, 630], count: 7, radius: 28, bodyRadius: 2.5 },
  { id: "wilderness_furnace_grazers", speciesId: "furnace_grazer", centre: [190, 484], count: 7, radius: 28, bodyRadius: 2.6 },
  { id: "wilderness_basalt_maw_hollow", speciesId: "basalt_maw", centre: [-8, 680], count: 7, radius: 28, bodyRadius: 3 },
  { id: "wilderness_foundry_west_carapaces", speciesId: "rift_carapace", centre: [-292, 732], count: 7, radius: 28, bodyRadius: 2.5 },
  { id: "wilderness_foundry_north_carapaces", speciesId: "rift_carapace", centre: [-200, 791], count: 7, radius: 28, bodyRadius: 2.5 },
  { id: "wilderness_rift_mouth_conclave", speciesId: "gloam_wraith", centre: [-31, 738], count: 7, radius: 28, bodyRadius: 1.5 },
  { id: "wilderness_midnight_carapaces", speciesId: "rift_carapace", centre: [163, 724], count: 7, radius: 28, bodyRadius: 2.5 },
  { id: "wilderness_nightforge_east_colossi", speciesId: "voidstone_colossus", centre: [254, 812], count: 7, radius: 28, bodyRadius: 3.3 },
  { id: "wilderness_northwest_black_dragons", speciesId: "black_wilderness_dragon", centre: [-319, 910], count: 7, radius: 34, bodyRadius: 5.7 },
  { id: "wilderness_northwest_red_dragons", speciesId: "red_wilderness_dragon", centre: [-265, 903], count: 7, radius: 34, bodyRadius: 5.5 },
  { id: "wilderness_central_purple_dragons", speciesId: "purple_wilderness_dragon", centre: [17, 803], count: 7, radius: 34, bodyRadius: 5.7 },
  { id: "wilderness_eastern_red_dragons", speciesId: "amethyst_dragon", centre: [233, 866], count: 7, radius: 34, bodyRadius: 5.5 },
  { id: "wilderness_eastern_gloam_conclave", speciesId: "gloam_wraith", centre: [317, 802], count: 7, radius: 28, bodyRadius: 1.5 },
  { id: "wilderness_sanctum_east_carapaces", speciesId: "rift_carapace", centre: [146, 885], count: 7, radius: 28, bodyRadius: 2.5 },
  { id: "wilderness_sanctum_west_colossi", speciesId: "voidstone_colossus", centre: [-101, 860], count: 7, radius: 28, bodyRadius: 3.3 },
  courtPack(0, "west"),
  courtPack(0, "east"),
  courtPack(1, "west"),
  courtPack(1, "east"),
  courtPack(2, "west"),
  courtPack(2, "east")
];
function keeperCentre(index) {
  if (index === 0) return [-171, 573];
  if (index === 1) return [155, 694];
  const site = WILDERNESS_EXPANSION_SITES[index - 2];
  const [x, z] = DEEP_WILDERNESS_STRUCTURES[site.id].keeper.centre;
  return [
    site.position[0] + Math.cos(site.rotationY) * x + Math.sin(site.rotationY) * z,
    site.position[1] - Math.sin(site.rotationY) * x + Math.cos(site.rotationY) * z
  ];
}
var DEEP_WILDERNESS_KEEPERS = WILDERNESS_RUNE_KEEPERS.map((keeper, index) => ({
  ...keeper,
  centre: keeperCentre(index),
  count: 1,
  radius: 5,
  siteId: index >= 2 ? WILDERNESS_EXPANSION_SITES[index - 2].id : void 0
}));
function resolveDeepWildernessPacks(species2) {
  const byId = new Map(species2.map((row) => [row.id, row]));
  return DEEP_WILDERNESS_PACKS.map((pack) => {
    const body = byId.get(pack.speciesId);
    if (!body) throw new Error(`Missing accepted Wilderness species ${pack.speciesId} for ${pack.id}`);
    return {
      id: pack.id,
      family: body.stats.family,
      name: body.stats.name,
      tier: wildernessTierAt(pack.centre[1]),
      assetId: body.assetId,
      scale: body.scale,
      centre: pack.centre,
      count: pack.count,
      radius: pack.radius
    };
  });
}
function deepWildernessPackFormation(pack) {
  const group = {
    id: pack.id,
    family: pack.speciesId,
    name: pack.speciesId,
    tier: wildernessTierAt(pack.centre[1]),
    assetId: `creature_${pack.speciesId}`,
    scale: 1,
    centre: pack.centre,
    count: pack.count,
    radius: pack.radius
  };
  return createEncounterFormation(group, {
    bodyRadius: pack.bodyRadius,
    count: pack.count,
    maxRadius: pack.radius,
    rotationY: pack.rotationY,
    bodyGap: pack.speciesId.endsWith("_wilderness_dragon") || pack.speciesId === "amethyst_dragon" ? Math.max(0.5, 24 - pack.bodyRadius * 2) : pack.siteId ? 3 : Math.max(4, 14 - pack.bodyRadius * 2)
  });
}
var DEEP_WILDERNESS_PACK_HABITATS = DEEP_WILDERNESS_PACKS.map((pack) => ({
  id: `${pack.id}_habitat`,
  groupId: pack.id,
  regionId: "wilderness",
  centre: pack.centre,
  radius: pack.radius,
  activity: "patrol",
  dressing: [],
  anchors: deepWildernessPackFormation(pack).anchors
}));

// .baseline/game/src/content/wildernessExpansion.ts
function wildernessExpansionGroups(species2) {
  return [...resolveDeepWildernessPacks(species2), ...DEEP_WILDERNESS_KEEPERS.map((keeper) => {
    const body = species2.find((row) => row.id === keeper.id);
    if (!body) throw new Error(`Missing accepted keeper ${keeper.id}`);
    return {
      id: keeper.id,
      family: body.stats.family,
      name: body.stats.name,
      tier: keeper.tier,
      assetId: body.assetId,
      scale: body.scale / 1.3,
      centre: keeper.centre,
      count: 1,
      radius: 5,
      miniBoss: true
    };
  })];
}
var DEEP_WILDERNESS_LANDMARKS = WILDERNESS_EXPANSION_SITES.map((site) => ({
  id: site.id,
  name: DEEP_WILDERNESS_STRUCTURES[site.id].name,
  position: site.position,
  assetId: "kerb_straight",
  composition: site.id,
  compositionOnly: true,
  rotationY: site.rotationY,
  blurb: site.id === "cinder_chain_foundry" ? "Broken casting yards shelter the Chainbound Archon and two haunted conclaves." : site.id === "nightforge_bastion" ? "An open fortress of ruined towers and cold forges, held by the Nightforge Marshal." : "A roofless sanctuary built around the Hollow Star. Violet wards light its occupied courts."
}));
var DEEP_WILDERNESS_LOCATIONS = [
  ...[
    ["black_keep_east_road", "The East Rampart Road", 82, 550],
    ["black_keep_north_road", "The North Rampart Road", 78, 657],
    ["silent_stones_south_road", "The Grave Road", -45, 675],
    ["foundry_south_road", "The Cinder Crossing", -65, 690],
    ["foundry_west_road", "Foundry West Track", -210, 688],
    ["veilburn_east_road", "Veilburn East Bank", 134, 710],
    ["nightforge_west_road", "Nightforge Outer Road", 134, 868],
    ["veilburn_north_road", "Beyond the Cold River", 144, 910],
    ["hollow_star_north_road", "The Starless Road", 15, 928]
  ].map(([id, name, x, z]) => ({
    id: String(id),
    name: String(name),
    position: [Number(x), Number(z)],
    kind: "junction",
    routeNode: true
  })),
  {
    id: "deep_wilderness_threshold",
    name: "The Violet Reach",
    position: [70, 712],
    kind: "junction",
    routeNode: true,
    blurb: "The grey waste opens into the T70 Deep Wilderness. Cold fire marks the old north road."
  },
  ...WILDERNESS_EXPANSION_SITES.map((site) => ({
    id: `${site.id}_approach`,
    name: DEEP_WILDERNESS_STRUCTURES[site.id].name,
    position: [
      site.position[0] + Math.sin(site.rotationY) * 38,
      site.position[1] + Math.cos(site.rotationY) * 38
    ],
    kind: "landmark",
    routeNode: true
  })),
  ...DEEP_WILDERNESS_KEEPERS.slice(0, 2).map((keeper) => ({
    id: `${keeper.id}_court`,
    name: keeper.id === "ashseal_warden" ? "Ashseal Court" : "Furnace Throne",
    position: keeper.centre,
    kind: "landmark",
    routeNode: true
  }))
];
var DEEP_WILDERNESS_ROADS = [
  { from: "black_keep_approach", to: "black_keep_east_road" },
  { from: "black_keep_east_road", to: "black_keep_north_road" },
  { from: "black_keep_north_road", to: "silent_stones_south_road" },
  { from: "silent_stones_south_road", to: "wilderness_north_stones" },
  { from: "wilderness_north_stones", to: "deep_wilderness_threshold" },
  { from: "deep_wilderness_threshold", to: "foundry_south_road" },
  { from: "foundry_south_road", to: "foundry_west_road" },
  { from: "foundry_west_road", to: "cinder_chain_foundry_approach" },
  { from: "deep_wilderness_threshold", to: "veilburn_east_road" },
  { from: "veilburn_east_road", to: "nightforge_west_road" },
  { from: "nightforge_west_road", to: "nightforge_bastion_approach" },
  { from: "nightforge_bastion_approach", to: "veilburn_north_road" },
  { from: "veilburn_north_road", to: "hollow_star_north_road" },
  { from: "hollow_star_north_road", to: "hollow_star_sanctum_approach" }
];

// .baseline/game/src/content/wilderness.ts
var encounters = [
  ["wilderness_broken_watch", "skeleton_soldier", [-240, 494], 4, 12],
  ["wilderness_west_graves", "pallid_shade", [-205, 570], 3, 16],
  ["wilderness_dead_boughs", "hollow_bough", [-286, 638], 3, 22],
  ["wilderness_lost_procession", "wraith", [-100, 655], 3, 22],
  ["wilderness_sunken_bones", "grave_ghoul", [-90, 527], 4, 16],
  ["black_keep_gate_guard", "skeleton_soldier", [29, 565], 2, 4],
  ["black_keep_gate_archers", "skeleton_archer", [52, 566], 2, 4],
  ["black_keep_court_guard", "revenant", [40, 594], 2, 4],
  ["black_keep_north_graves", "skeleton_mage", [55, 657], 2, 12],
  ["wilderness_east_shades", "pallid_shade", [175, 530], 4, 18],
  ["wilderness_petrified_grove", "hollow_bough", [255, 612], 3, 23],
  ["wilderness_bone_patrol", "skeleton_soldier", [301, 514], 4, 15],
  ["wilderness_lament", "banshee", [148, 620], 2, 12]
];
var easternEncounters = [
  ["wilderness_east_cinderback_shelf", "cinderback_crag", [630, 555], 4, 18],
  ["wilderness_east_furnace_herd", "furnace_grazer", [565, 650], 4, 20],
  ["wilderness_east_basalt_prowl", "basalt_maw", [420, 675], 4, 18],
  ["wilderness_east_rift_carapaces", "rift_carapace", [445, 735], 4, 20],
  ["wilderness_far_east_colossi", "voidstone_colossus", [610, 765], 3, 22],
  ["wilderness_east_gloam_patrol", "gloam_wraith", [440, 840], 4, 20],
  ["wilderness_northeast_carapaces", "rift_carapace", [605, 900], 4, 20]
];
var easternRuinSentries = [
  {
    id: "ashwind_cloister_sentries",
    speciesId: "cinderback_crag",
    siteId: "ashwind_cloister",
    approachName: "Ashwind Cloister Approach",
    localX: 12,
    localZ: 28,
    bodyRadius: 2.5
  },
  {
    id: "far_cinder_smithy_sentries",
    speciesId: "basalt_maw",
    siteId: "far_cinder_smithy",
    approachName: "Far Cinder Smithy Approach",
    localX: 12,
    localZ: 22,
    bodyRadius: 3
  },
  {
    id: "nightglass_waterway_sentries",
    speciesId: "gloam_wraith",
    siteId: "nightglass_waterway",
    approachName: "Nightglass Waterway Approach",
    localX: 10,
    localZ: 19,
    bodyRadius: 1.5
  },
  {
    id: "starless_abbey_sentries",
    speciesId: "rift_carapace",
    siteId: "starless_abbey",
    approachName: "Starless Abbey Approach",
    localX: 12,
    localZ: 28,
    bodyRadius: 2.5
  }
];
var sentryAnchors = /* @__PURE__ */ new Map();
var EASTERN_RUIN_SENTRY_GROUPS = easternRuinSentries.map((spec) => {
  const site = WILDERNESS_RUIN_SITES.find((candidate) => candidate.id === spec.siteId);
  const species2 = WILDERNESS_CREATURE_SPECIES.find((candidate) => candidate.id === spec.speciesId);
  const cos = Math.cos(site.rotationY), sin = Math.sin(site.rotationY);
  const point = (x) => [
    site.position[0] + x * cos + spec.localZ * sin,
    site.position[1] - x * sin + spec.localZ * cos
  ];
  const anchors = [point(-spec.localX), point(spec.localX)];
  sentryAnchors.set(spec.id, anchors);
  return {
    id: spec.id,
    family: species2.stats.family,
    name: species2.stats.name,
    tier: species2.stats.tier,
    assetId: species2.assetId,
    scale: species2.scale,
    centre: [(anchors[0][0] + anchors[1][0]) / 2, (anchors[0][1] + anchors[1][1]) / 2],
    count: 2,
    radius: spec.localX + spec.bodyRadius
  };
});
var EASTERN_RUIN_APPROACH_LOCATIONS = easternRuinSentries.map((spec) => {
  const group = EASTERN_RUIN_SENTRY_GROUPS.find((candidate) => candidate.id === spec.id);
  return {
    id: `${spec.siteId}_approach`,
    name: spec.approachName,
    position: group.centre,
    kind: "junction",
    routeNode: true
  };
});
var LEGACY_WILDERNESS_GROUPS = encounters.map(([id, speciesId, centre, count, radius]) => {
  const species2 = CREATURE_REDESIGNS.find((row) => row.id === speciesId) ?? RPG_BESTIARY_BY_ID.get(speciesId);
  return {
    id,
    family: species2.stats.family,
    name: species2.stats.name,
    tier: 50,
    assetId: species2.assetId,
    scale: species2.scale * tierSilhouetteScale(species2.stats.tier) / tierSilhouetteScale(50),
    centre,
    count,
    radius
  };
});
for (const [index, site] of WILDERNESS_RUIN_SITES.filter((site2) => site2.position[0] < 350).entries()) {
  const species2 = RPG_BESTIARY_BY_ID.get(index % 2 ? "wraith" : "skeleton_soldier");
  LEGACY_WILDERNESS_GROUPS.push({
    id: `${site.id}_haunt`,
    family: species2.stats.family,
    name: species2.stats.name,
    tier: 50,
    assetId: species2.assetId,
    scale: species2.scale * tierSilhouetteScale(species2.stats.tier) / tierSilhouetteScale(50),
    centre: site.position,
    count: 2,
    radius: 6
  });
}
var EASTERN_WILDERNESS_GROUPS = easternEncounters.map(([id, speciesId, centre, count, radius]) => {
  const species2 = WILDERNESS_CREATURE_SPECIES.find((row) => row.id === speciesId);
  return {
    id,
    family: species2.stats.family,
    name: species2.stats.name,
    tier: species2.stats.tier,
    assetId: species2.assetId,
    scale: species2.scale,
    centre,
    count,
    radius
  };
});
var ORDINARY_WILDERNESS_GROUPS = [
  ...LEGACY_WILDERNESS_GROUPS,
  ...EASTERN_WILDERNESS_GROUPS,
  ...EASTERN_RUIN_SENTRY_GROUPS
];
var WILDERNESS_GROUPS = [
  ...ORDINARY_WILDERNESS_GROUPS,
  ...wildernessExpansionGroups([...WILDERNESS_CREATURE_SPECIES, ...WILDERNESS_DRAGONS])
];
var WILDERNESS_HABITATS = ORDINARY_WILDERNESS_GROUPS.map((group) => ({
  id: `${group.id}_habitat`,
  groupId: group.id,
  regionId: "wilderness",
  centre: group.centre,
  radius: group.radius,
  activity: "patrol",
  dressing: group.id === "wilderness_west_graves" || group.id === "black_keep_north_graves" ? encounterSetting("wraith", group.centre, group.radius * 0.3).dressing : [],
  anchors: sentryAnchors.get(group.id) ?? (WILDERNESS_RUIN_SITES.some((site) => `${site.id}_haunt` === group.id) ? [-3.5, 3.5].map((z) => {
    const site = WILDERNESS_RUIN_SITES.find((row) => `${row.id}_haunt` === group.id);
    return [site.position[0] + Math.sin(site.rotationY) * z, site.position[1] + Math.cos(site.rotationY) * z];
  }) : Array.from({ length: Math.max(group.count, 4) }, (_, i) => {
    const angle = i / Math.max(group.count, 4) * Math.PI * 2 + 0.3;
    return [group.centre[0] + Math.cos(angle) * group.radius * 0.6, group.centre[1] + Math.sin(angle) * group.radius * 0.6];
  }))
}));
var WILDERNESS = {
  id: "wilderness",
  name: "Wilderness",
  tier: 50,
  lore: "Beyond the ashlands, daylight fades over grey plains and broken stone hills. The Black Knight castle watches rivers of fire, gravefields and scorched groves. Farther north the T70 Deep Wilderness opens into violet night, where cold blue fissures wind past dragon roosts and ruined citadels.",
  bounds: { min: [-350, WILDERNESS_DEPTH.south], max: [700, WILDERNESS_DEPTH.north] },
  terrainSeed: 14593392,
  terrainAmplitude: 12,
  baseHeight: 9,
  groundPalette: ["#555961", "#7b7e83", "#535357", "#72767e", "#4b4a47", "#49464a", "#958b80", "#b2b4b8"],
  fogStart: 125,
  spawnPoint: [0, 482],
  spawnFacingRad: 0,
  respawnPointId: "emberfast",
  locations: [
    { id: "wilderness_crownward_track", name: "Lost Crown Road", position: [560, 482], kind: "junction", routeNode: true, blurb: "The royal road enters the widened northern wastes." },
    { id: "east_shallow_crossroads", name: "Kingspan Crossroads", position: [540, 535], kind: "junction", routeNode: true },
    { id: "east_cinder_road", name: "Cinderward Road", position: [600, 610], kind: "junction", routeNode: true },
    {
      id: "east_depth_threshold",
      name: "Far Cinder Gate",
      position: [625, 710],
      kind: "junction",
      routeNode: true,
      blurb: "The eastern road crosses into the cold violet reach."
    },
    { id: "east_night_road", name: "Nightglass Road", position: [550, 785], kind: "junction", routeNode: true },
    { id: "east_star_road", name: "Starfall Road", position: [570, 865], kind: "junction", routeNode: true },
    { id: "east_upper_bend", name: "Upper Nightglass Bend", position: [610, 790], kind: "junction", routeNode: true },
    { id: "starless_outer_road", name: "Starless Outer Road", position: [690, 875], kind: "junction", routeNode: true },
    { id: "ashwind_shelter_bend", name: "Ashwind Shelter Bend", position: [570, 620], kind: "junction", routeNode: true },
    ...EASTERN_RUIN_APPROACH_LOCATIONS,
    { id: "wilderness_south_track", name: "Last Light", position: [0, 482], kind: "junction", routeNode: true, blurb: "The old north track leaves the warm ashlands." },
    { id: "wilderness_west_watch", name: "Broken Watch", position: [-250, 520], kind: "landmark", routeNode: true },
    { id: "wilderness_gravefield", name: "The Unnamed Graves", position: [-205, 585], kind: "landmark", routeNode: true },
    { id: "black_keep_approach", name: "Black Knight Approach", position: [40, 548], kind: "junction", routeNode: true },
    { id: "black_keep_gate", name: "Black Knight Gate", position: [40, 580], kind: "gate", routeNode: true },
    { id: "black_keep_court", name: "Black Knight Castle", position: [40, 600], kind: "landmark", routeNode: true, blurb: "A black masonry fortress around an open, haunted courtyard." },
    { id: "wilderness_hollow_grove", name: "Petrified Grove", position: [255, 640], kind: "landmark", routeNode: true },
    { id: "wilderness_north_stones", name: "The Silent Stones", position: [-80, 680], kind: "landmark", routeNode: true },
    ...WILDERNESS_RUIN_LOCATIONS,
    ...WILDERNESS_RESOURCE_LOCATIONS,
    ...DEEP_WILDERNESS_LOCATIONS,
    {
      id: "wilderness_lava_overlook",
      name: "Widow's Furnace",
      position: [178, 638],
      kind: "landmark",
      routeNode: true,
      blurb: "A slow river of molten stone cuts through the eastern wastes. The old path follows its dry southern bank."
    }
  ],
  roads: [
    { from: "wilderness_crownward_track", to: "wilderness_hollow_grove" },
    { from: "wilderness_crownward_track", to: "east_shallow_crossroads" },
    { from: "east_shallow_crossroads", to: "east_kingspan_site" },
    { from: "east_shallow_crossroads", to: "east_cinder_cut" },
    { from: "east_shallow_crossroads", to: "ashwind_cloister_approach" },
    { from: "ashwind_cloister_approach", to: "ashwind_cloister_site" },
    { from: "east_shallow_crossroads", to: "ashwind_shelter_bend" },
    { from: "ashwind_shelter_bend", to: "ashwind_shelter" },
    { from: "east_shallow_crossroads", to: "east_cinder_road" },
    { from: "east_cinder_road", to: "far_cinder_smithy_approach" },
    { from: "far_cinder_smithy_approach", to: "far_cinder_smithy_site" },
    { from: "east_cinder_road", to: "east_depth_threshold" },
    { from: "east_depth_threshold", to: "east_night_road" },
    { from: "east_night_road", to: "rift_watch_site" },
    { from: "east_night_road", to: "nightglass_waterway_approach" },
    { from: "nightglass_waterway_approach", to: "nightglass_waterway_site" },
    { from: "east_night_road", to: "nightglass_ridge" },
    { from: "east_night_road", to: "east_upper_bend" },
    { from: "east_upper_bend", to: "east_star_road" },
    { from: "east_star_road", to: "starfall_copse" },
    { from: "east_star_road", to: "starless_outer_road" },
    { from: "starless_outer_road", to: "starless_abbey_approach" },
    { from: "starless_abbey_approach", to: "starless_abbey_site" },
    { from: "wilderness_south_track", to: "black_keep_approach" },
    { from: "black_keep_approach", to: "black_keep_gate" },
    { from: "black_keep_gate", to: "black_keep_court" },
    { from: "wilderness_south_track", to: "wilderness_west_watch" },
    { from: "wilderness_west_watch", to: "wilderness_gravefield" },
    { from: "black_keep_approach", to: "wilderness_hollow_grove" },
    { from: "wilderness_hollow_grove", to: "wilderness_lava_overlook" },
    ...DEEP_WILDERNESS_ROADS
  ],
  clusters: WILDERNESS_RESOURCE_CLUSTERS,
  stations: [],
  obstacles: [],
  gates: [],
  enemyGroups: WILDERNESS_GROUPS,
  landmarks: [
    ...DEEP_WILDERNESS_LANDMARKS,
    ...WILDERNESS_RUIN_LANDMARKS,
    {
      id: "black_knight_castle",
      name: "Black Knight Castle",
      position: [40, 600],
      assetId: "wall_brick_straight",
      composition: "black_knight_castle",
      compositionOnly: true,
      rotationY: Math.PI,
      blurb: "The black keep rises over an open courtyard. Its gate faces the last road south."
    },
    { id: "wilderness_stone_circle", name: "The Silent Stones", position: [-80, 680], assetId: "rock_medium_2", scale: 1.35, composition: "standing_stones", blurb: "Weathered stones ring a patch of bare slate." }
  ],
  adjacency: [{ toRegionId: "kilnhalt", fromLocationId: "wilderness_south_track", toLocationId: "kilnhalt_north_track", meters: 69.5 }]
};

// .baseline/game/src/content/elementalSpells.ts
var ELEMENTAL_SPELLS = [
  {
    id: "breeze-puff",
    name: "Breeze puff",
    element: "wind",
    rank: 0,
    scale: "Basic",
    description: "A tiny silver-blue enchantment gathers at the staff and releases one rippling pocket of air. One 10-damage hit within 0.9 m.",
    watch: "A quick puff reaches T5 and opens into one fading pressure ripple."
  },
  {
    id: "air-needle",
    name: "Air needle",
    element: "wind",
    rank: 1,
    scale: "Precision",
    description: "A concentrated silver-blue dart slips through rippling air. Its tapered wake sheds fine sparks and opens into two short swooshes on contact. One 18-damage strike within 1.1 m.",
    watch: "The centre dummy takes one hit; its neighbours stay untouched."
  },
  {
    id: "razor-crescent",
    name: "Razor crescent",
    element: "wind",
    rank: 2,
    scale: "Wide sweep",
    description: "Three luminous wind cuts bank across the target line 140 ms apart. Each has its own tilt, broad leading edge and scattered wake. Each deals 14 damage within 2.2 m and pushes targets sideways.",
    watch: "Follow the staggered blade arrivals and compare the side dummies' positions."
  },
  {
    id: "vacuum-coil",
    name: "Vacuum coil",
    element: "wind",
    rank: 3,
    scale: "Control field",
    description: "Open spirals of silver light and pressure draw targets inward. Four 9-damage contractions pull targets within 5.5 m toward the empty eye, followed by a 28-damage pressure rupture.",
    watch: "Watch the inward currents gather the dummies, then collapse into the eye before the final rupture."
  },
  {
    id: "thunder-lance",
    name: "Thunder lance",
    element: "wind",
    rank: 4,
    scale: "Piercing lane",
    description: "One concentrated light wake drives a corkscrew of compressed air down the lane. Five unequal contact bursts deal 26 damage each within 1.7 m and briefly stagger victims.",
    watch: "Near and far lane targets are hit in order as the lance passes through."
  },
  {
    id: "skybreaker",
    name: "Skybreaker",
    element: "wind",
    rank: 5,
    scale: "Massive storm",
    description: "Loose storm currents form overhead and descend into a broad 11 m tornado. Touchdown deals 45 damage, then three sweeping fronts deal 18 each. After circulation breaks, lifted debris falls and settles. The full cast lasts 4.95 seconds.",
    watch: "Watch the neck form and widen during descent, then follow the debris to the ground after the wind fades."
  },
  {
    id: "water-bead",
    name: "Water bead",
    element: "water",
    rank: 0,
    scale: "Basic",
    description: "A compact blue light streak carries a tiny water bead inside its wake. It scatters into a small liquid splash for 12 damage within 0.9 m, with a brief wet slow.",
    watch: "A small glowing shot reaches T5, followed by one splash and one hit."
  },
  {
    id: "waterjet",
    name: "Waterjet",
    element: "water",
    rank: 1,
    scale: "Focused stream",
    description: "Two narrow cobalt light jets carry liquid threads inside their wakes, shedding turquoise spray. Two close 11-damage impacts arrive 120 ms apart in a 1.2 m pocket and leave a short slow.",
    watch: "Two hits land on the centre dummy, with a narrow splash footprint."
  },
  {
    id: "tidal-fan",
    name: "Tidal fan",
    element: "water",
    rank: 2,
    scale: "Liquid spread",
    description: "Five luminous blue wakes bank across a 10 m arc and arrive 35 ms apart. Each has a different bend, breadth and spray direction. Each deals 16 damage in a 1.6 m pocket and slows movement.",
    watch: "Follow five liquid paths, then the falling splashes around the middle row."
  },
  {
    id: "geyser-chain",
    name: "Geyser chain",
    element: "water",
    rank: 3,
    scale: "Rising columns",
    description: "Three branching spring bursts climb along the aim line. Separate glowing arcs carry thin liquid threads and falling spray. Each area takes 24 damage, then another 12 as the spray lands.",
    watch: "Watch three upward bursts and their falling spray, with six impacts total."
  },
  {
    id: "undertow",
    name: "Undertow",
    element: "water",
    rank: 4,
    scale: "Whirlpool",
    description: "Low blue wakes curve inward through a shallow whirlpool. Three 12-damage pulses gather targets over 1.1 seconds, then the eye pinches shut in collapsing foam, striking the group for 35 damage inside 3.5 m.",
    watch: "The inward spiral gathers targets before the smaller finishing hit."
  },
  {
    id: "deluge",
    name: "Deluge",
    element: "water",
    rank: 5,
    scale: "Massive flood",
    description: "Heavy teal waves gather around a 20 m field, then crash inward. Three converging sets of four 20-damage contacts pull targets toward the centre. The collision throws a towering splash upward, followed by falling spray over a 4.95-second cast.",
    watch: "Follow the perimeter waves toward the centre, then watch the collision rise into a tall splash and fall back as rain."
  },
  {
    id: "pebble-toss",
    name: "Pebble toss",
    element: "earth",
    rank: 0,
    scale: "Basic",
    description: "A small jade streak carries an enchanted mineral chip through a shallow arc. The chip breaks on contact for 14 damage within 0.9 m, leaving fine sparks and grit.",
    watch: "Follow the short glowing wake to T5. Neighbouring dummies remain untouched."
  },
  {
    id: "flint-shot",
    name: "Flint shot",
    element: "earth",
    rank: 1,
    scale: "Stone projectile",
    description: "A bright jade lance carries a small flint core under a curved light wake. One 1.2 m impact deals 24 damage, splitting the core into 72 pieces inside a fan of glowing mineral sparks.",
    watch: "The luminous shot breaks at contact. The stone fragments separate from its small core."
  },
  {
    id: "faultline",
    name: "Faultline",
    element: "earth",
    rank: 2,
    scale: "Ground rupture",
    description: "A low jagged seam races down the lane, throwing jade light across the ground as short rock ridges heave beneath it. Five sections strike 150 ms apart for 19 damage within 1.8 m, briefly staggering targets.",
    watch: "Follow the moving front along the connected ridge and the dust thrown from its seam."
  },
  {
    id: "basalt-jaw",
    name: "Basalt jaw",
    element: "earth",
    rank: 3,
    scale: "Closing trap",
    description: "Opposing mineral rakes sweep inward above low broken stone. Six outer strikes bind targets before a concentrated crossing burst crushes the centre for 40 damage. The ground stays visible between the light paths.",
    watch: "Watch the outer roots, then the crossing light and debris at the centre."
  },
  {
    id: "siege-boulder",
    name: "Siege boulder",
    element: "earth",
    rank: 4,
    scale: "Heavy bombardment",
    description: "A heavy braided jade comet carries a small bound stone core through a high arc. Its first strike deals 65 damage within 5 m and breaks the core into 180 pieces. A later 18-damage ground sweep reaches 7 m.",
    watch: "Follow the glowing comet, its core fracture and the wider delayed sweep."
  },
  {
    id: "mountainfall",
    name: "Mountainfall",
    element: "earth",
    rank: 5,
    scale: "Massive upheaval",
    description: "Jade currents gather around five stone anchors across an 18 m field, then crush inward and erupt as mineral light. The first rupture deals 50 damage, eight outer surges deal 32 each and the implosion deals 22 across 10 m. Fragments settle over 4.41 seconds.",
    watch: "Watch the ridges lean and move toward the centre before they fracture. The compressed debris surges upward, then falls."
  },
  {
    id: "kindle",
    name: "Kindle",
    element: "fire",
    rank: 0,
    scale: "Basic",
    description: "One compact gold-red light streak carries a lick of flame to T5. A brief spray of embers deals 11 damage within 0.9 m.",
    watch: "One short glowing shot and one compact contact. No follow-up burst."
  },
  {
    id: "ember-dart",
    name: "Ember dart",
    element: "fire",
    rank: 1,
    scale: "Quick ignition",
    description: "A tapered gold-red comet leaves a bright curled wake, then scatters embers on contact. The initial hit deals 15 damage, followed by two small 4-damage burns.",
    watch: "Track the comet arrival and the two smaller burning contacts."
  },
  {
    id: "furnace-whip",
    name: "Furnace whip",
    element: "fire",
    rank: 2,
    scale: "Flame arc",
    description: "One broad ribbon of fire unfurls into the front line, then cracks sideways across six targets. The trailing flame follows the tip and tears into cinders. Six successive contacts deal 13 damage each.",
    watch: "Follow the single ribbon through its unfurl, sideways crack and falling cinders."
  },
  {
    id: "cinder-mine",
    name: "Cinder mine",
    element: "fire",
    rank: 3,
    scale: "Delayed detonation",
    description: "Low ember streams draw inward, pause, then burst into separate flame tongues around an open blast front. The first strike deals 55 damage in 4.5 m; a later 15-damage wave reaches 6 m.",
    watch: "Watch the gathering sparks, brief pause and two outward bursts."
  },
  {
    id: "phoenix-pass",
    name: "Kiln rupture",
    element: "fire",
    rank: 4,
    scale: "Erupting fire vents",
    description: "Seven uneven vents split the ground in sequence, each erupting into torn red-gold flames and rising ash. Each vent deals 32 damage within 2.7 m and burns targets.",
    watch: "Watch the ground brighten beneath each vent before its eruption. No returning pass."
  },
  {
    id: "starfall",
    name: "Sunfall",
    element: "fire",
    rank: 5,
    scale: "Solar impact",
    description: "A large sun gathers a torn burning corona and accelerates into one 110-damage impact across 9 m. Tall rolling flames, airborne embers and dark ash linger from that single blast. The full cast lasts 4.3 seconds.",
    watch: "Follow the growing sun into one heavy strike, then watch the fire subside and embers fall. There is no second damage wave."
  }
];

// .baseline/game/src/content/xp.ts
var MAX_LEVEL = 99;
var TIERS = [1, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 99];
var XP_TABLE = buildTable();
function buildTable() {
  const table = new Array(MAX_LEVEL + 1).fill(0);
  for (let level = 1; level <= MAX_LEVEL; level += 1) {
    table[level] = Math.floor(873 * Math.pow(1.1, level - 1) - 873 + 6 * level * (level - 1));
  }
  return table;
}
function tierForLevel(level) {
  let tier = TIERS[0];
  for (const candidate of TIERS) if (level >= candidate) tier = candidate;
  return tier;
}

// .baseline/game/src/content/spells.ts
var SPELLS = [
  // -------------------------------------------------------------------- lash, Magic 1-15
  {
    id: "voltrend",
    name: "Voltrend",
    element: "wind",
    rung: "lash",
    reqLevel: 1,
    tier: 1,
    baseMax: 3,
    divisor: 8,
    baseXp: 5,
    castMs: 3e3,
    cost: { element: "wind", charges: 1 },
    description: "A compact wind charm with a pale leading edge and a rippling pressure wake."
  },
  {
    id: "stonebrand",
    name: "Stonebrand",
    element: "earth",
    rung: "lash",
    reqLevel: 5,
    tier: 5,
    baseMax: 5,
    divisor: 7,
    baseXp: 12,
    castMs: 3e3,
    cost: { element: "earth", charges: 1 },
    description: "A small green-gold charm carrying fine stone grit into a sharp magical impact."
  },
  {
    id: "rimewash",
    name: "Rimewash",
    element: "water",
    rung: "lash",
    reqLevel: 10,
    tier: 10,
    baseMax: 8,
    divisor: 6,
    baseXp: 22,
    castMs: 3e3,
    cost: { element: "water", charges: 1 },
    description: "A bright water charm that streams toward one target and breaks into fine liquid spray."
  },
  {
    id: "emberlash",
    name: "Emberlash",
    element: "fire",
    rung: "lash",
    reqLevel: 15,
    tier: 10,
    baseMax: 9,
    divisor: 6,
    baseXp: 30,
    castMs: 3e3,
    cost: { element: "fire", charges: 1 },
    description: "A small, living flame gathered at the weapon tip and released with a trail of sparks."
  },
  // -------------------------------------------------------------------- bolt, Magic 17-35
  {
    id: "skirlbolt",
    name: "Skirlbolt",
    element: "wind",
    rung: "bolt",
    reqLevel: 17,
    tier: 10,
    baseMax: 11,
    divisor: 5.5,
    baseXp: 36,
    castMs: 3e3,
    cost: { element: "wind", charges: 1 },
    description: "A stronger wind charm with a wider pressure wake and more luminous motes."
  },
  {
    id: "sleetbolt",
    name: "Sleetbolt",
    element: "water",
    rung: "bolt",
    reqLevel: 23,
    tier: 20,
    baseMax: 13,
    divisor: 5.2,
    baseXp: 47,
    castMs: 3e3,
    cost: { element: "water", charges: 1 },
    description: "A stronger water charm with a fuller flowing wake and a denser splash on contact."
  },
  {
    id: "shalebolt",
    name: "Shalebolt",
    element: "earth",
    rung: "bolt",
    reqLevel: 29,
    tier: 20,
    baseMax: 15,
    divisor: 5,
    baseXp: 59,
    castMs: 3e3,
    cost: { element: "earth", charges: 1 },
    description: "A stronger earth charm with a brighter mineral wake and more scattered grit."
  },
  {
    id: "cinderbolt",
    name: "Cinderbolt",
    element: "fire",
    rung: "bolt",
    reqLevel: 35,
    tier: 30,
    baseMax: 17,
    divisor: 4.8,
    baseXp: 71,
    castMs: 3e3,
    cost: { element: "fire", charges: 1 },
    description: "A stronger flame charm with a fuller burning core and a longer ember wake."
  },
  // -------------------------------------------------------------------- burst, Magic 41-59
  {
    id: "galeburst",
    name: "Galeburst",
    element: "wind",
    rung: "burst",
    reqLevel: 41,
    tier: 40,
    baseMax: 19,
    divisor: 4.6,
    baseXp: 84,
    castMs: 3e3,
    cost: { element: "wind", charges: 1 },
    description: "A broad wind charm that drives a dense, shimmering pressure wake into one target."
  },
  {
    id: "spateburst",
    name: "Spateburst",
    element: "water",
    rung: "burst",
    reqLevel: 47,
    tier: 40,
    baseMax: 21,
    divisor: 4.4,
    baseXp: 97,
    castMs: 3e3,
    cost: { element: "water", charges: 1 },
    description: "A broad water charm with rolling liquid highlights and a dense burst of spray."
  },
  {
    id: "cragburst",
    name: "Cragburst",
    element: "earth",
    rung: "burst",
    reqLevel: 53,
    tier: 50,
    baseMax: 23,
    divisor: 4.2,
    baseXp: 111,
    castMs: 3e3,
    cost: { element: "earth", charges: 1 },
    description: "A broad earth charm with a dense green-gold wake that scatters tiny fragments on contact."
  },
  {
    id: "pyreburst",
    name: "Pyreburst",
    element: "fire",
    rung: "burst",
    reqLevel: 59,
    tier: 50,
    baseMax: 25,
    divisor: 4,
    baseXp: 125,
    castMs: 3e3,
    cost: { element: "fire", charges: 1 },
    description: "A broad flame charm with curling fire and a dense shower of embers on contact."
  },
  // -------------------------------------------------------------------- surge, Magic 62-70
  {
    id: "squallsurge",
    name: "Squallsurge",
    element: "wind",
    rung: "surge",
    reqLevel: 62,
    tier: 60,
    baseMax: 27,
    divisor: 3.8,
    baseXp: 133,
    castMs: 3e3,
    cost: { element: "wind", charges: 1 },
    description: "The strongest wind charm: a wide luminous wake, dense motes, and one concentrated impact."
  },
  {
    id: "tidesurge",
    name: "Tidesurge",
    element: "water",
    rung: "surge",
    reqLevel: 65,
    tier: 60,
    baseMax: 29,
    divisor: 3.6,
    baseXp: 141,
    castMs: 3e3,
    cost: { element: "water", charges: 1 },
    description: "The strongest water charm: a full flowing wake and a brilliant, concentrated splash."
  },
  {
    id: "scarpsurge",
    name: "Scarpsurge",
    element: "earth",
    rung: "surge",
    reqLevel: 68,
    tier: 60,
    baseMax: 31,
    divisor: 3.5,
    baseXp: 149,
    castMs: 3e3,
    cost: { element: "earth", charges: 1 },
    description: "The strongest earth charm: a broad mineral glow and dense fragments released on impact."
  },
  {
    id: "kilnsurge",
    name: "Kilnsurge",
    element: "fire",
    rung: "surge",
    reqLevel: 70,
    tier: 70,
    baseMax: 33,
    divisor: 3.4,
    baseXp: 155,
    castMs: 3e3,
    cost: { element: "fire", charges: 1 },
    description: "The strongest flame charm: a full organic flame wake and a concentrated burst of glowing embers."
  }
];
function spellsOfRung(rung) {
  return SPELLS.filter((spell) => spell.rung === rung).sort((a, b) => a.reqLevel - b.reqLevel);
}
var SPELLS_BY_RUNG = {
  lash: spellsOfRung("lash"),
  bolt: spellsOfRung("bolt"),
  burst: spellsOfRung("burst"),
  surge: spellsOfRung("surge")
};
var SPELL_RUNES = [
  {
    itemId: "mind_rune",
    name: "Mind Rune",
    tier: 1,
    description: "A pale rune etched with a single clear eye. It steadies the caster's thought onto one mark. Spent by every rank-one invocation."
  },
  {
    itemId: "chaos_rune",
    name: "Chaos Rune",
    tier: 2,
    description: "An orange rune scored with a jagged fork. It lets a spell break loose and scatter across a line of foes. Spent by every rank-two invocation."
  },
  {
    itemId: "death_rune",
    name: "Death Rune",
    tier: 3,
    description: "A bone-white rune cut with a hollow skull. It holds a spell's shape while it gathers and closes. Spent by every rank-three invocation."
  },
  {
    itemId: "blood_rune",
    name: "Blood Rune",
    tier: 4,
    description: "A dark red rune with a drop sunk into its face. It feeds invocations heavy enough to batter the ground. Spent by every rank-four invocation."
  },
  {
    itemId: "wrath_rune",
    name: "Wrath Rune",
    tier: 5,
    description: "A black rune split through with slow red light. Spent by the four finales and by nothing smaller."
  },
  {
    itemId: "cosmic_rune",
    name: "Cosmic Rune",
    tier: 0,
    description: "A yellow rune ringed with a wheel of stars. It spreads an invocation across an area. Spent alongside the tier rune by every area invocation."
  }
];
var COSMIC_RUNE_ID = "cosmic_rune";
function tierRune(rank) {
  const rune = SPELL_RUNES.find((row) => row.tier === rank);
  if (!rune) throw new Error(`No spell rune for rank ${rank}`);
  return rune;
}
var ADVANCED_ELEMENT_ORDER = ["wind", "earth", "water", "fire"];
var ADVANCED_RANKS = [
  { rank: 1, reqLevel: 20, baseMax: 14, divisor: 5, baseXp: 40, aoe: false },
  { rank: 2, reqLevel: 32, baseMax: 18, divisor: 4.6, baseXp: 66, aoe: true },
  { rank: 3, reqLevel: 44, baseMax: 22, divisor: 4.2, baseXp: 92, aoe: true },
  { rank: 4, reqLevel: 56, baseMax: 27, divisor: 3.8, baseXp: 120, aoe: true },
  { rank: 5, reqLevel: 74, baseMax: 40, divisor: 3.2, baseXp: 170, aoe: true }
];
function rungForRank(rank) {
  return rank <= 1 ? "bolt" : rank <= 3 ? "burst" : "surge";
}
var ADVANCED_SPELLS = ADVANCED_RANKS.flatMap((row) => ADVANCED_ELEMENT_ORDER.map((element, offset) => {
  const source = ELEMENTAL_SPELLS.find((spell) => spell.element === element && spell.rank === row.rank);
  if (!source) throw new Error(`No elemental spell for ${element} rank ${row.rank}`);
  const reqLevel = row.reqLevel + offset * 2;
  const runes = [{ itemId: tierRune(row.rank).itemId, quantity: 1 }];
  if (row.aoe) runes.push({ itemId: COSMIC_RUNE_ID, quantity: 1 });
  return {
    id: source.id,
    name: source.name,
    element,
    rung: rungForRank(row.rank),
    rank: row.rank,
    aoe: row.aoe,
    reqLevel,
    tier: tierForLevel(reqLevel),
    baseMax: row.baseMax + offset,
    divisor: row.divisor,
    baseXp: row.baseXp + offset * 4,
    castMs: 3e3,
    cost: { element, charges: 1, runes },
    description: source.description
  };
}));
var ALL_SPELLS = [...SPELLS, ...ADVANCED_SPELLS];

// .baseline/game/src/content/bossArmor.ts
var SLOTS = ["head", "body", "legs", "hands", "feet"];
var SUFFIXES = {
  melee: ["helm", "plate", "greaves", "gauntlets", "boots"],
  magic: ["hood", "robe", "leggings", "wraps", "boots"]
};
function bonuses(partial = {}) {
  return {
    meleeAccuracy: 0,
    meleePower: 0,
    defence: Math.max(0, 0),
    magicAccuracy: 0,
    magicPower: 0,
    health: 0,
    ...partial,
    vitality: 0
  };
}
var BASELINES = {
  melee: [
    [bonuses({ meleeAccuracy: 7, defence: Math.max(28, 9), health: 6 }), bonuses({ meleeAccuracy: 9, defence: Math.max(37, 12), health: 8 })],
    [bonuses({ meleeAccuracy: 10, defence: Math.max(60, 16), health: 14 }), bonuses({ meleeAccuracy: 13, defence: Math.max(79, 22), health: 19 })],
    [bonuses({ meleeAccuracy: 7, defence: Math.max(39, 12), health: 10 }), bonuses({ meleeAccuracy: 9, defence: Math.max(51, 16), health: 14 })],
    [bonuses({ meleeAccuracy: 6, defence: Math.max(16, 8), health: 5 }), bonuses({ meleeAccuracy: 8, defence: Math.max(21, 11), health: 7 })],
    [bonuses({ meleeAccuracy: 4, defence: Math.max(18, 8), health: 5 }), bonuses({ meleeAccuracy: 5, defence: Math.max(24, 11), health: 7 })]
  ],
  magic: [
    [bonuses({ defence: Math.max(5, 27), magicAccuracy: 15, magicPower: 7, health: 7, vitality: 0 }), bonuses({ defence: Math.max(7, 38), magicAccuracy: 20, magicPower: 10, health: 10, vitality: 0 })],
    [bonuses({ defence: Math.max(8, 48), magicAccuracy: 23, magicPower: 11, health: 13, vitality: 0 }), bonuses({ defence: Math.max(11, 67), magicAccuracy: 31, magicPower: 15, health: 18, vitality: 0 })],
    [bonuses({ defence: Math.max(6, 33), magicAccuracy: 13, magicPower: 7, health: 9, vitality: 0 }), bonuses({ defence: Math.max(9, 46), magicAccuracy: 18, magicPower: 9, health: 12, vitality: 0 })],
    [bonuses({ defence: Math.max(3, 10), magicAccuracy: 4, health: 4, vitality: 0 }), bonuses({ defence: Math.max(4, 15), magicAccuracy: 6, health: 6, vitality: 0 })],
    [bonuses({ defence: Math.max(3, 10), magicAccuracy: 4, health: 4, vitality: 0 }), bonuses({ defence: Math.max(4, 15), magicAccuracy: 6, health: 6, vitality: 0 })]
  ]
};
var SET_ROWS = [
  { id: "duskguard", name: "Chitin Duskguard", style: "melee", tier: 50 },
  { id: "oathguard", name: "Void Oathguard", style: "melee", tier: 70 },
  { id: "frostguard", name: "Aurora Frostguard", style: "melee", tier: 90 },
  { id: "tideweave", name: "Chitin Tideweave", style: "magic", tier: 50 },
  { id: "nightweave", name: "Void Nightweave", style: "magic", tier: 70 },
  { id: "frostweave", name: "Aurora Frostweave", style: "magic", tier: 90 }
];
var BAREHEADED = /* @__PURE__ */ new Set(["duskguard", "oathguard"]);
function setSlots(id) {
  return BAREHEADED.has(id) ? SLOTS.filter((slot) => slot !== "head") : SLOTS;
}
function pieceBonuses(style, tier, index) {
  const [low, high] = BASELINES[style][index];
  const result = bonuses();
  for (const key of Object.keys(result)) {
    const baseline = tier === 50 ? low[key] : tier === 70 ? high[key] : high[key] + (high[key] - low[key]);
    result[key] = Math.round(baseline * 1.1);
  }
  return result;
}
var BOSS_ARMOR_ITEMS = SET_ROWS.flatMap((set) => setSlots(set.id).map((slot) => {
  const index = SLOTS.indexOf(slot);
  const suffix = SUFFIXES[set.style][index];
  const label = suffix === "hood" ? set.id === "frostweave" ? "Hood" : "Headwrap" : suffix.charAt(0).toUpperCase() + suffix.slice(1);
  return {
    id: `${set.id}_${suffix}`,
    name: `${set.name} ${label}`,
    tier: set.tier,
    description: `${set.name} ${label.toLowerCase()} for level ${set.tier} ${set.style === "magic" ? "Magic" : "Melee"}.${set.tier === 90 ? "" : " A rare boss reward."}`,
    category: "equipment",
    stackable: false,
    value: Math.round(set.tier * (slot === "body" || slot === "legs" ? 220 : 120)),
    equip: { slot, requires: { [set.style]: set.tier }, bonuses: pieceBonuses(set.style, set.tier, index) }
  };
}));
var BOSS_ARMOR_SETS = SET_ROWS.map((set) => {
  const defence = set.tier === 50 ? 10 : set.tier === 70 ? 14 : 18;
  const health = set.tier === 50 ? 7 : set.tier === 70 ? 10 : 13;
  return {
    ...set,
    members: Object.fromEntries(setSlots(set.id).map((slot) => [slot, `${set.id}_${SUFFIXES[set.style][SLOTS.indexOf(slot)]}`])),
    thresholds: [
      { pieces: 2, bonuses: bonuses(set.style === "melee" ? { defence } : { defence }) },
      { pieces: BAREHEADED.has(set.id) ? 3 : 4, bonuses: bonuses({ health }) },
      { pieces: BAREHEADED.has(set.id) ? 4 : 5, bonuses: bonuses(set.style === "melee" ? { defence } : { defence }) }
    ]
  };
});
function bossArmorDrops(tier) {
  const items = BOSS_ARMOR_ITEMS.filter((item) => item.tier === tier);
  return items.map((item) => ({
    itemId: item.id,
    quantity: [1, 1],
    chance: 0.02 / items.length
  }));
}

// .baseline/game/src/content/wildernessLoot.ts
var WILDERNESS_CRAFTING_TIERS = [
  {
    tier: 50,
    metal: "cindersteel",
    metalName: "Cindersteel",
    ore: "cindervein_ore",
    wood: "teak",
    woodName: "Teak",
    hide: "dragonhide",
    hideName: "Dragonhide",
    thread: "grave_thread",
    flux: "molten_heart",
    jewellery: "emberweave",
    gem: "fire_opal"
  },
  {
    tier: 70,
    metal: "nightglass",
    metalName: "Nightglass",
    ore: "nightglass_ore",
    wood: "magic",
    woodName: "Magic",
    hide: "starhide",
    hideName: "Starhide",
    thread: "void_thread",
    flux: "astral_core",
    jewellery: "starweave",
    gem: "fire_opal"
  }
];
function material(id, name, tier, value, description, category = "component") {
  return { id, name, tier, value, description, category, stackable: category === "component" };
}
var MATERIALS = [
  material("cindervein_ore", "Cindervein Ore", 50, 360, "Black ore shot through with copper-red seams. Smelt three with a Molten Heart into Cindersteel.", "resource"),
  material("nightglass_ore", "Nightglass Ore", 70, 590, "Violet ore with a blue fracture. Smelt three with an Astral Core into a Nightglass Bar.", "resource"),
  material("cindersteel_bar", "Cindersteel Bar", 50, 1250, "Dense dark steel cast with a molten stone heart. Used for level 50 armour, weapons and tools.", "bar"),
  material("nightglass_bar", "Nightglass Bar", 70, 2050, "A solid bar of blue-black glass metal. Used for level 70 armour, weapons and tools.", "bar"),
  material("molten_heart", "Molten Heart", 50, 110, "A cooled kernel from a living stone creature. It replaces flux when smelting Cindersteel."),
  material("dragonhide", "Dragonhide", 50, 340, "Supple hide beneath a young dragon's scales. Grave Thread binds it into level 50 casting armour."),
  material("grave_thread", "Grave Thread", 50, 90, "Black binding drawn from the Wilderness dead. Stitch Dragonhide or wind it into a Teak casting weapon."),
  material("astral_core", "Astral Core", 70, 180, "A blue-violet heart from a deep Wilderness creature. It fuses Nightglass Ore without shattering it."),
  material("starhide", "Starhide", 70, 560, "Adult dragon hide steeped in deep magic. Void Thread stitches it into level 70 casting armour."),
  material("void_thread", "Void Thread", 70, 150, "A dark strand pulled from a deep spirit. Binds Starhide and the crowns of Magic casting weapons."),
  material("teak_handle", "Teak Handle", 50, 640, "Oiled teak cut for a Cindersteel sword, pickaxe or hatchet."),
  material("magic_handle", "Magic Handle", 70, 1010, "A carved magic-wood grip for Nightglass weapons and gathering tools."),
  material("ashseal_iron", "Ashseal Iron", 50, 1700, "The Ashseal Warden's dense shield iron. Rivet it across a Teak Shield to make an Ashseal Guard."),
  material("furnace_crown", "Furnace Crown", 50, 2100, "A piece of the Furnace Regent's crucible crown. Set three around a Teak Staff to make a Regent Staff."),
  material("chainbound_link", "Chainbound Link", 70, 2400, "A living link carried by the foundry guard and Chainbound Archon. Three bind a Nightglass Sword into a Chainbound Sword."),
  material("nightforge_seal", "Nightforge Seal", 70, 2600, "A breastplate stamp taken from the bastion guard or Nightforge Marshal. Reinforces Nightglass Plate into Nightmarshal Plate."),
  material("hollow_star_fragment", "Hollow Star Fragment", 70, 3e3, "A heavy black shard carried by the sanctum guard and Hollow Star. Three form the crown of a Hollowstar Staff.")
];
function bonuses2(partial) {
  return {
    meleeAccuracy: 0,
    meleePower: 0,
    defence: Math.max(0, 0),
    magicAccuracy: 0,
    magicPower: 0,
    health: 0,
    ...partial,
    vitality: 0
  };
}
function gear(id, name, tier, slot, skill, value, description, stats, weapon) {
  return {
    id,
    name,
    tier,
    value,
    description,
    category: "equipment",
    stackable: false,
    equip: {
      slot,
      requires: { [skill]: tier },
      bonuses: bonuses2(stats),
      ...weapon ? { attackSpeedMs: weapon === "staff" ? 3e3 : weapon === "wand" ? 2200 : 2400 } : {}
    },
    ...weapon && weapon !== "sword" ? { magicWeapon: { kind: weapon, hands: weapon === "staff" ? 2 : 1 } } : {}
  };
}
function tierGear(def) {
  const { tier: t, metal: m, metalName: mn, wood: w, woodName: wn, hide: h, hideName: hn, jewellery: j } = def;
  const deep = t === 70;
  const pair = (shallow, northern) => deep ? northern : shallow;
  const defence = (suffix, name, slot, stats, value) => gear(`${m}_${suffix}`, `${mn} ${name}`, t, slot, "melee", value, `${mn} ${name.toLowerCase()} forged for level ${t} melee combat.`, stats);
  const robes = (suffix, name, slot, stats, value) => gear(`${h}_${suffix}`, `${hn} ${name}`, t, slot, "magic", value, `${hn} ${name.toLowerCase()} sewn with ${deep ? "Void" : "Grave"} Thread. Requires level ${t} Magic.`, stats);
  return [
    gear(`${m}_sword`, `${mn} Sword`, t, "mainHand", "melee", pair(8200, 13700), `A ${deep ? "blue-black glass edge on a magic-wood grip" : "broad dark blade on an oiled teak grip"}. Requires level ${t} Melee.`, { meleeAccuracy: pair(92, 125), meleePower: pair(92, 128) }, "sword"),
    gear(`${w}_shield`, `${wn} Shield`, t, "offHand", "melee", pair(4700, 7600), `Layered ${wn.toLowerCase()} faced in ${mn}.`, { meleeAccuracy: pair(6, 8), defence: Math.max(pair(43, 56), pair(19, 25)), health: pair(5, 7) }),
    defence("helm", "Helm", "head", { meleeAccuracy: pair(7, 9), defence: Math.max(pair(28, 37), pair(9, 12)), health: pair(6, 8) }, pair(5500, 9e3)),
    defence("plate", "Plate", "body", { meleeAccuracy: pair(10, 13), defence: Math.max(pair(60, 79), pair(16, 22)), health: pair(14, 19) }, pair(9400, 15400)),
    defence("greaves", "Greaves", "legs", { meleeAccuracy: pair(7, 9), defence: Math.max(pair(39, 51), pair(12, 16)), health: pair(10, 14) }, pair(8700, 14200)),
    defence("boots", "Boots", "feet", { meleeAccuracy: pair(4, 5), defence: Math.max(pair(18, 24), pair(8, 11)), health: pair(5, 7) }, pair(4200, 6900)),
    defence("gauntlets", "Gauntlets", "hands", { meleeAccuracy: pair(6, 8), defence: Math.max(pair(16, 21), pair(8, 11)), health: pair(5, 7) }, pair(4200, 6900)),
    gear(`${w}_wand`, `${wn} Wand`, t, "mainHand", "magic", pair(5400, 8700), `${wn} wrapped with ${deep ? "Void" : "Grave"} Thread. A fast one-handed weapon; carried Essence pays for spells.`, { magicAccuracy: pair(54, 74), magicPower: pair(46, 63), defence: pair(9, 13) }, "wand"),
    gear(`${w}_staff`, `${wn} Staff`, t, "mainHand", "magic", pair(7200, 11700), `${wn} crowned with ${mn}. A heavy two-handed casting weapon; carried Essence pays for spells.`, { meleePower: pair(15, 21), magicAccuracy: pair(80, 110), magicPower: pair(69, 94), defence: pair(13, 19) }, "staff"),
    robes("hood", "Hood", "head", { defence: Math.max(pair(5, 7), pair(27, 38)), magicAccuracy: pair(15, 20), magicPower: pair(7, 10), health: pair(7, 10), vitality: 0 }, pair(4800, 7800)),
    robes("robe", "Robe", "body", { defence: Math.max(pair(8, 11), pair(48, 67)), magicAccuracy: pair(23, 31), magicPower: pair(11, 15), health: pair(13, 18), vitality: 0 }, pair(8300, 13500)),
    robes("leggings", "Leggings", "legs", { defence: Math.max(pair(6, 9), pair(33, 46)), magicAccuracy: pair(13, 18), magicPower: pair(7, 9), health: pair(9, 12), vitality: 0 }, pair(7500, 12200)),
    robes("boots", "Boots", "feet", { defence: Math.max(pair(3, 4), pair(10, 15)), magicAccuracy: pair(4, 6), health: pair(4, 6), vitality: 0 }, pair(3500, 5700)),
    robes("wraps", "Wraps", "hands", { defence: Math.max(pair(3, 4), pair(10, 15)), magicAccuracy: pair(4, 6), health: pair(4, 6), vitality: 0 }, pair(3500, 5700)),
    ...["pickaxe", "hatchet"].map((tool) => ({
      id: `${m}_${tool}`,
      name: `${mn} ${tool === "pickaxe" ? "Pickaxe" : "Hatchet"}`,
      tier: t,
      description: `${mn} on a ${wn.toLowerCase()} handle. Adds ${toolBonus(t)} effective gathering levels; resource requirements still apply.`,
      category: "tool",
      stackable: false,
      value: pair(4e3, 6500),
      tool: { skill: tool === "pickaxe" ? "mining" : "woodcutting", gatherBonus: toolBonus(t) }
    }))
  ];
}
var SPECIAL_GEAR = [
  gear("ashseal_guard", "Ashseal Guard", 50, "offHand", "melee", 12600, "The Ashseal Warden's iron spread across a Teak Shield. A heavy guard for close fighting.", { meleeAccuracy: 6, defence: Math.max(57, 25), health: 9 }),
  gear("regent_staff", "Regent Staff", 50, "mainHand", "magic", 16200, "Three pieces of the Furnace Regent's crown brace a Teak Staff. Casts through carried Essence.", { meleePower: 17, magicAccuracy: 89, magicPower: 81, defence: 16 }, "staff"),
  gear("chainbound_sword", "Chainbound Sword", 70, "mainHand", "melee", 26e3, "Living foundry chain wound through a Nightglass blade. The edge tightens under a full swing.", { meleeAccuracy: 141, meleePower: 141 }, "sword"),
  gear("nightmarshal_plate", "Nightmarshal Plate", 70, "body", "melee", 28900, "Nightglass Plate reinforced with the bastion's old seals. Heavy overlapping ribs protect the chest.", { meleeAccuracy: 14, defence: Math.max(98, 30), health: 25 }),
  gear("hollowstar_staff", "Hollowstar Staff", 70, "mainHand", "magic", 29900, "Three fragments of the Hollow Star turn above a magic-wood shaft. Casts through carried Essence.", { meleePower: 24, magicAccuracy: 123, magicPower: 111, defence: 24 }, "staff")
];
var WILDERNESS_LOOT_ITEMS = [
  ...MATERIALS,
  ...WILDERNESS_CRAFTING_TIERS.flatMap(tierGear),
  ...SPECIAL_GEAR
];
var SKILLS2 = {
  smelt: "smithing",
  smith: "smithing",
  craft: "crafting",
  fletch: "fletching",
  cook: "cooking"
};
var STATIONS2 = {
  smelt: ["furnace"],
  smith: ["anvil"],
  craft: ["crafting_table"],
  fletch: ["fletching_bench"],
  cook: ["range", "campfire"]
};
function recipe(tier, output, kind, inputs, weight) {
  const item = WILDERNESS_LOOT_ITEMS.find((candidate) => candidate.id === output);
  if (!item)
    throw new Error(`Wilderness recipe has no output item: ${output}`);
  return {
    id: `${kind}_${output}`,
    name: item.name,
    tier,
    kind,
    skill: SKILLS2[kind],
    reqLevel: tier,
    stations: STATIONS2[kind],
    inputs: inputs.map(([itemId, quantity]) => ({ itemId, quantity })),
    output: { itemId: output, quantity: 1 },
    durationMs: kind === "smith" ? 3e3 : kind === "fletch" ? 1800 : 2400,
    xp: recipeXp(tier, weight)
  };
}
function tierRecipes2(def) {
  const { tier: t, metal: m, wood: w, hide: h, jewellery: j, thread, flux, gem } = def;
  const bar = `${m}_bar`, handle = `${w}_handle`, log = `${w}_log`;
  return [
    recipe(t, bar, "smelt", [[def.ore, 3], [flux, 1]], 0.8),
    recipe(t, handle, "fletch", [[log, 1]], 1),
    recipe(t, `${m}_sword`, "smith", [[bar, 3], [handle, 1]], 3.5),
    recipe(t, `${w}_shield`, "fletch", [[log, 2], [bar, 2]], 2.8),
    ...["helm", "plate", "greaves", "boots", "gauntlets"].map((part) => {
      const large = part === "plate" || part === "greaves";
      return recipe(t, `${m}_${part}`, "smith", [[bar, large ? 4 : part === "helm" ? 2 : 1]], large ? 5 : 2.5);
    }),
    recipe(t, `${w}_wand`, "fletch", [[log, 2], [bar, 1], [thread, 3]], 2.4),
    recipe(t, `${w}_staff`, "fletch", [[log, 3], [bar, 2], [thread, 5]], 3.2),
    ...["hood", "robe", "leggings", "boots", "wraps"].map((part) => {
      const large = part === "robe" || part === "leggings";
      return recipe(t, `${h}_${part}`, "craft", [[h, large ? 4 : part === "hood" ? 2 : 1], [thread, large ? 4 : 2]], large ? 4 : 2.5);
    }),
    recipe(t, `${m}_pickaxe`, "smith", [[bar, 2], [handle, 1]], 2.2),
    recipe(t, `${m}_hatchet`, "smith", [[bar, 2], [handle, 1]], 2.2)
  ];
}
var WILDERNESS_LOOT_RECIPES = [
  ...WILDERNESS_CRAFTING_TIERS.flatMap(tierRecipes2),
  recipe(50, "ashseal_guard", "smith", [["teak_shield", 1], ["ashseal_iron", 3], ["cindersteel_bar", 2]], 2.8),
  recipe(50, "regent_staff", "fletch", [["teak_staff", 1], ["furnace_crown", 3], ["grave_thread", 6]], 3.2),
  recipe(70, "chainbound_sword", "smith", [["nightglass_sword", 1], ["chainbound_link", 3], ["nightglass_bar", 2]], 3.5),
  recipe(70, "nightmarshal_plate", "smith", [["nightglass_plate", 1], ["nightforge_seal", 3], ["nightglass_bar", 2]], 5),
  recipe(70, "hollowstar_staff", "fletch", [["magic_staff", 1], ["hollow_star_fragment", 3], ["void_thread", 6]], 3.2)
];
var WILDERNESS_STRUCTURE_COMPONENTS = {
  cinder_chain_foundry: "chainbound_link",
  nightforge_bastion: "nightforge_seal",
  hollow_star_sanctum: "hollow_star_fragment"
};
var WILDERNESS_KEEPER_COMPONENTS = {
  ashseal_warden: "ashseal_iron",
  furnace_regent: "furnace_crown",
  chainbound_archon: "chainbound_link",
  nightforge_marshal: "nightforge_seal",
  hollow_star: "hollow_star_fragment"
};
function runeForRank(rank) {
  const rune = SPELL_RUNES.find((candidate) => candidate.tier === rank);
  if (!rune)
    throw new Error(`Missing merged invocation rune rank ${rank}`);
  return rune.itemId;
}
function drop2(itemId, min, max, chance = 1) {
  return { itemId, quantity: [min, max], chance };
}
var STONE_SPECIES = /* @__PURE__ */ new Set([
  "cinderback_crag",
  "furnace_grazer",
  "basalt_maw",
  "rift_carapace",
  "voidstone_colossus",
  "ashseal_warden",
  "furnace_regent",
  "nightforge_marshal"
]);
function wildernessDrops(speciesId, tier, keeperId, structureId) {
  const keeper = WILDERNESS_RUNE_KEEPERS.find((candidate) => candidate.id === keeperId);
  if (keeperId && !keeper)
    throw new Error(`Unknown Wilderness rune keeper: ${keeperId}`);
  const deep = (keeper?.tier ?? tier) >= 70;
  const lootSpecies = keeper?.id ?? speciesId;
  const draconic = /dragon|drake|hatchling/.test(lootSpecies);
  const stony = STONE_SPECIES.has(lootSpecies) || /stone|rock|golem|cairn|flint|basalt|slag|kiln|obsidian|magma|crag|colossus|nightglass/.test(lootSpecies);
  const materialId = draconic ? deep ? "starhide" : "dragonhide" : stony ? deep ? "astral_core" : "molten_heart" : deep ? "void_thread" : "grave_thread";
  if (keeper) {
    return [
      drop2(materialId, 5, 9),
      drop2(WILDERNESS_KEEPER_COMPONENTS[keeper.id], 1, 2),
      drop2(keeper.rune, 24, 40),
      drop2(COSMIC_RUNE_ID, 24, 40),
      drop2(deep ? "nightglass_ore" : "cindervein_ore", 3, 6),
      drop2("fire_opal", 1, 2, 0.35),
      ...bossArmorDrops(keeper.tier)
    ];
  }
  return [
    drop2(materialId, 1, 3),
    // A pack of eleven averages 13.2 Cosmic Runes; upper ranks remain scarcer than lower ones.
    drop2(COSMIC_RUNE_ID, 2, 4, 0.4),
    ...deep ? [drop2(runeForRank(3), 2, 4, 0.32), drop2(runeForRank(4), 1, 3, 0.22), drop2(runeForRank(5), 1, 2, 0.1)] : [drop2(runeForRank(1), 2, 4, 0.4), drop2(runeForRank(2), 2, 3, 0.28)],
    ...stony ? [drop2(deep ? "nightglass_ore" : "cindervein_ore", 1, 2, 0.25)] : [],
    drop2("fire_opal", 1, 1, 0.04),
    ...structureId ? [drop2(WILDERNESS_STRUCTURE_COMPONENTS[structureId], 1, 1, 0.12)] : []
  ];
}

// .baseline/game/src/content/wildernessEnemyProgression.ts
var KEEPERS = new Map(WILDERNESS_RUNE_KEEPERS.map((keeper) => [keeper.id, keeper]));
var KEEPER_FAMILIES = new Set(WILDERNESS_RUNE_KEEPERS.map((keeper) => keeper.id));
var TIERS2 = [50, 70];
var LEGACY_TIERS = [20, 10, 5, 1];
function wildernessStructureLootForGroup(groupId) {
  for (const siteId of Object.keys(WILDERNESS_STRUCTURE_COMPONENTS)) {
    if (groupId === `${siteId}_west_conclave` || groupId === `${siteId}_east_conclave`) return siteId;
  }
  return void 0;
}
function bandProgress(z, tier) {
  const south = tier === 50 ? WILDERNESS_DEPTH.south : WILDERNESS_DEPTH.divide;
  const north = tier === 50 ? WILDERNESS_DEPTH.divide : WILDERNESS_DEPTH.north;
  return Math.max(0, Math.min(1, (z - south) / (north - south)));
}
function wildernessEnemyLevelAt(base, z) {
  if (!Number.isFinite(z)) throw new Error(`Invalid Wilderness encounter depth for ${base.id}`);
  const tier = wildernessTierAt(z);
  const progress = bandProgress(z, tier);
  if (base.tier < 50) return (tier === 50 ? 48 : 69) + Math.round(progress * 8);
  const low = tier === 50 ? 48 : 69, high = tier === 50 ? 57 : 77;
  const authored = enemyCombatLevel(base);
  const nativeLevel = base.tier === tier && !KEEPER_FAMILIES.has(base.family) ? authored : Math.max(low, Math.min(high, tier + authored - base.tier));
  return nativeLevel + Math.round(progress * 4);
}
function requireUsableBase(base, groupId) {
  for (const [key, value] of Object.entries({
    maxHealth: base.maxHealth,
    attackLevel: base.attackLevel,
    defenceLevel: base.defenceLevel,
    accuracy: base.accuracy,
    armour: base.armour,
    magicArmour: base.magicArmour,
    maxHit: base.maxHit
  })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${groupId}: invalid source ${key}`);
  }
  if (base.maxHealth <= 0 || base.attackLevel <= 0 || base.defenceLevel <= 0 || base.tier <= 0) {
    throw new Error(`${groupId}: Wilderness source needs positive health, combat levels and tier`);
  }
  return base;
}
function scaledMarks(base, tier) {
  const ratio = tier / base.tier;
  const min = Math.max(tier, Math.round((base.marks?.[0] ?? base.tier) * ratio));
  return [min, Math.max(min, tier * 2, Math.round((base.marks?.[1] ?? base.tier * 3) * ratio))];
}
function buildWildernessEnemyProgression(groups, baseLookup, speciesList) {
  const uniqueGroups = /* @__PURE__ */ new Set();
  const speciesByFamily = /* @__PURE__ */ new Map();
  for (const species2 of speciesList) {
    const family = species2.stats.family;
    const rows2 = speciesByFamily.get(family) ?? [];
    rows2.push(species2);
    speciesByFamily.set(family, rows2);
  }
  for (const rows2 of speciesByFamily.values()) rows2.sort((a, b) => a.id.localeCompare(b.id));
  const resolved = groups.map((group) => {
    if (uniqueGroups.has(group.id)) throw new Error(`Duplicate Wilderness encounter ${group.id}`);
    uniqueGroups.add(group.id);
    if (!group.family || !Number.isFinite(group.centre[1])) throw new Error(`${group.id}: invalid Wilderness family or depth`);
    const keeper = KEEPERS.get(group.id);
    if (keeper && wildernessTierAt(group.centre[1]) !== keeper.tier) {
      throw new Error(`${group.id}: rune keeper is outside its ${keeper.tier} depth band`);
    }
    if (keeper && (group.count !== 1 || !(group.boss || group.miniBoss))) {
      throw new Error(`${group.id}: rune keeper must be one boss or miniboss`);
    }
    const supplied = baseLookup(group.id, group.family, group.tier);
    const candidates = speciesByFamily.get(group.family) ?? [];
    const species2 = candidates.find((row) => row.assetId === group.assetId) ?? candidates[0];
    let base = supplied?.id === group.id && supplied.family === group.family ? supplied : species2?.stats;
    base ??= supplied?.family === group.family ? supplied : void 0;
    if (!base) {
      for (const tier of [...TIERS2, ...LEGACY_TIERS]) {
        const fallback = baseLookup(group.id, group.family, tier);
        if (fallback?.family === group.family) {
          base = fallback;
          break;
        }
      }
    }
    if (!base) throw new Error(`Missing Wilderness source for ${group.id} (${group.family})`);
    return { group, keeper, base: requireUsableBase(base, group.id), speciesId: species2?.id ?? group.family };
  });
  const output = /* @__PURE__ */ new Map();
  const add = (block) => {
    if (output.has(block.id)) throw new Error(`Conflicting Wilderness block id ${block.id}`);
    output.set(block.id, block);
  };
  const byFamily = /* @__PURE__ */ new Map();
  for (const row of resolved) {
    const siblings = byFamily.get(row.group.family) ?? [];
    siblings.push(row);
    byFamily.set(row.group.family, siblings);
  }
  for (const [family, siblings] of [...byFamily].sort(([a], [b]) => a.localeCompare(b))) {
    const keeper = siblings.find((row) => row.keeper)?.keeper;
    const ordered = [...siblings].sort((a, b) => a.group.centre[1] - b.group.centre[1] || a.group.id.localeCompare(b.group.id));
    const representative = keeper ? siblings.find((row) => row.keeper?.id === keeper.id) : ordered[0];
    const canonicalSpecies = speciesByFamily.get(family)?.find((row) => row.assetId === representative.group.assetId) ?? speciesByFamily.get(family)?.[0];
    const base = requireUsableBase(canonicalSpecies?.stats ?? representative.base, representative.group.id);
    for (const tier of keeper ? [keeper.tier] : TIERS2) {
      const z = tier === 50 ? WILDERNESS_DEPTH.south : WILDERNESS_DEPTH.divide;
      const level = keeper ? keeper.tier * keeper.multiplier : wildernessEnemyLevelAt(base, z);
      add({
        ...tuneEnemyCombatLevel(base, level, tier),
        id: `${family}_t${tier}`,
        family,
        name: canonicalSpecies?.stats.name ?? representative.group.name,
        marks: scaledMarks(base, tier),
        drops: wildernessDrops(canonicalSpecies?.id ?? representative.speciesId, tier, keeper?.id)
      });
    }
  }
  for (const { group, keeper, base, speciesId } of resolved) {
    const tier = keeper?.tier ?? wildernessTierAt(group.centre[1]);
    const target = keeper ? tier * keeper.multiplier : wildernessEnemyLevelAt(base, group.centre[1]);
    add({
      ...tuneEnemyCombatLevel(base, target, tier),
      id: group.id,
      family: group.family,
      name: group.name,
      marks: scaledMarks(base, tier),
      drops: wildernessDrops(speciesId, tier, keeper?.id, wildernessStructureLootForGroup(group.id))
    });
  }
  return [...output.values()];
}

// .baseline/game/src/content/enemies.ts
function marksFor(tier) {
  return [Math.round(tier * 3), Math.round(tier * 11)];
}
function purseMarksFor(tier) {
  return [Math.round(tier * 7), Math.round(tier * 27)];
}
function enemyIdFor(family, tier) {
  return `${family}_t${tier}`;
}
var BLOCKS = [
  // ---------------------------------------------------------------- Fallowmarch, tier 1
  {
    id: "frog_t1",
    name: "Frog",
    family: "frog",
    tier: 1,
    // The first thing most characters kill, and it inherits the Rill Skitterling's numbers EXACTLY
    // because PRD 2.4 solves two of its rows against them: defenceLevel 1 / armour 0 is what makes
    // "Melee 1 unarmed, 50% hit chance, 19 s" and "Melee 3 with a Grithe dagger, 56%, 10 s" both
    // true. 6 health also fixes the XP maths: 6*4 + round(6*2) = 36 XP a kill, 48 kills to Melee 10.
    // Passive at 5 m, sitting on the Redsill shallows, so a player chooses this fight.
    maxHealth: 6,
    attackLevel: 2,
    defenceLevel: 1,
    accuracy: 0,
    armour: 0,
    magicArmour: 0,
    maxHit: 2,
    attackSpeedMs: 2400,
    aggroRadius: 5,
    moveSpeedMps: 0.79,
    walkSpeedMps: 0.17,
    behaviour: "passive",
    marks: marksFor(1),
    drops: [
      { itemId: "raw_game_meat", quantity: [1, 1], chance: 0.4 },
      { itemId: "marsh_gland", quantity: [1, 2], chance: 0.3 },
      { itemId: "march_stone", quantity: [1, 2], chance: 0.2 },
      { itemId: "pale_quartz", quantity: [1, 1], chance: 0.06 }
    ]
  },
  {
    id: "hen_t1",
    name: "Hen",
    family: "hen",
    tier: 1,
    // The swarm shape, and the only one in the table: 1200 ms is the fastest cadence in the game
    // (two combat ticks) and max hit 1 makes every landed peck worth exactly 1. Against a Melee 1
    // player in the starter kit it deals 0.437 dmg/s and dies in 12.6 s, so one hen costs 5.5 of 23
    // health: four of them is a real problem and one is a nuisance. Passive at 3 m, so a new
    // character walks the March Road through the flock and fights only what they swing at.
    maxHealth: 4,
    attackLevel: 2,
    defenceLevel: 1,
    accuracy: 0,
    armour: 0,
    magicArmour: 0,
    maxHit: 1,
    attackSpeedMs: 1200,
    aggroRadius: 3,
    moveSpeedMps: 1.02,
    walkSpeedMps: 0.22,
    behaviour: "passive",
    marks: marksFor(1),
    drops: [
      { itemId: "hen_feather", quantity: [1, 3], chance: 0.55 },
      { itemId: "raw_game_meat", quantity: [1, 1], chance: 0.35 },
      { itemId: "hen_egg", quantity: [1, 2], chance: 0.25 }
    ]
  },
  {
    id: "goat_t1",
    name: "Goat",
    family: "goat",
    tier: 1,
    // The aggressive tier 1 spawn: the one animal on the plain that starts the fight. Against a
    // naked Melee 1 player (23 max health, PRD 2.3) it runs 43 s and lands 0.479 dmg/s, so it costs
    // about 21 health - survivable, and obviously not free. With a Grithe dagger it is 31 s and 15
    // damage; in the full tier 1 kit (29 max health, armour 16) it is 25 s and 11 damage.
    maxHealth: 12,
    attackLevel: 4,
    defenceLevel: 3,
    accuracy: 4,
    armour: 4,
    magicArmour: 2,
    maxHit: 3,
    attackSpeedMs: 2400,
    aggroRadius: 8,
    moveSpeedMps: 2.06,
    walkSpeedMps: 0.52,
    behaviour: "aggressive",
    marks: marksFor(1),
    drops: [
      { itemId: "coarse_hide", quantity: [1, 2], chance: 0.55 },
      { itemId: "raw_game_meat", quantity: [1, 2], chance: 0.4 },
      { itemId: "curl_horn", quantity: [1, 1], chance: 0.22 },
      { itemId: "grithe_ore", quantity: [1, 2], chance: 0.15 },
      { itemId: "grithe_dagger", quantity: [1, 1], chance: 0.02 }
    ]
  },
  {
    id: "cattle_t1",
    name: "Cow",
    family: "cattle",
    tier: 1,
    // The bulwark: armour 35 against magicArmour 0, the widest split at tier 1, so a staff is the
    // right answer and a dagger is the wrong one. 3600 ms is the slowest cadence in the game and
    // max hit 5 is the biggest single blow at the tier, which is a cow exactly: it ignores you, and
    // then it does not. Territorial at 5 m, grazing beside the Marchfield farmstead. At Melee 1
    // this fight is unwinnable (65.9 s, 32.8 damage against 23 health) and the whole point of
    // territorial is that it never starts.
    maxHealth: 16,
    attackLevel: 5,
    defenceLevel: 3,
    accuracy: 6,
    armour: 35,
    magicArmour: 0,
    maxHit: 5,
    attackSpeedMs: 3600,
    aggroRadius: 5,
    moveSpeedMps: 2.64,
    walkSpeedMps: 0.51,
    behaviour: "territorial",
    marks: marksFor(1),
    drops: [
      { itemId: "coarse_hide", quantity: [1, 2], chance: 0.6 },
      { itemId: "raw_game_meat", quantity: [1, 3], chance: 0.5 },
      { itemId: "ox_horn", quantity: [1, 1], chance: 0.2 },
      { itemId: "march_stone", quantity: [1, 3], chance: 0.15 }
    ]
  },
  {
    id: "coney_t1",
    name: "Rabbit",
    family: "coney",
    tier: 1,
    // The rare one. Defence 4 against attack 2 is the only inverted block in the table and it is
    // the whole design: a coney is hard to land a swing on and cannot hurt you back. 2 m aggro is
    // the smallest in the game, so it is passive in the strongest sense - you have to walk onto it.
    // Worth killing for the hide and the foot, not for the fight.
    maxHealth: 5,
    attackLevel: 2,
    defenceLevel: 4,
    accuracy: 0,
    armour: 0,
    magicArmour: 0,
    maxHit: 1,
    attackSpeedMs: 1800,
    aggroRadius: 2,
    moveSpeedMps: 0.81,
    walkSpeedMps: 0.41,
    behaviour: "passive",
    marks: marksFor(1),
    drops: [
      { itemId: "coarse_hide", quantity: [1, 1], chance: 0.5 },
      { itemId: "raw_game_meat", quantity: [1, 1], chance: 0.45 },
      { itemId: "coney_foot", quantity: [1, 1], chance: 0.12 }
    ]
  },
  {
    id: "viper_t1",
    name: "Viper",
    family: "viper",
    tier: 1,
    // The glass cannon. Armour 0 and 9 health make it the fastest tier 1 kill in the table, and max
    // hit 5 on a 3000 ms cadence makes it the hardest single blow at the tier - a bad roll takes a
    // fifth of a new character's health in one bite. magicArmour 20 against armour 0 is the mirror
    // of the cow standing 240 m east, so the two tier 1 territorial blocks want opposite styles.
    maxHealth: 9,
    attackLevel: 7,
    defenceLevel: 2,
    accuracy: 10,
    armour: 0,
    magicArmour: 20,
    maxHit: 5,
    attackSpeedMs: 3e3,
    aggroRadius: 7,
    moveSpeedMps: 1.2,
    walkSpeedMps: 0.5,
    behaviour: "territorial",
    marks: marksFor(1),
    drops: [
      { itemId: "viper_skin", quantity: [1, 1], chance: 0.45 },
      { itemId: "marsh_gland", quantity: [1, 1], chance: 0.2 },
      { itemId: "palewood_log", quantity: [1, 2], chance: 0.2 },
      { itemId: "air_essence", quantity: [1, 1], chance: 0.1 }
    ]
  },
  {
    id: "reaver_t1",
    name: "Road Bandit",
    family: "reaver",
    tier: 1,
    // The humanoid shape, and the widest aggro radius in the game outside Ordrun: 14 m, against
    // 6-11 m everywhere else. A Reaver is the enemy that comes to you, and the one that pays for
    // it (see `purseMarksFor`). Balanced armour and magicArmour both at 10, so neither style has an
    // answer to it and it is the block a new player learns to just fight.
    //
    // Humanoids RUN. The family's pursuit speeds (3.4 / 3.6 / 3.9 by tier) sit just under the
    // player's 4.2 on purpose: they share the player's own Jog_Fwd_Loop, which implies 5.92 m/s,
    // and a pursuit much slower than ~3.3 forces that clip under the rate where a jog stops
    // reading as running (`render/entityViews.ts: HUMANOID_JOG_MIN_RATE`). Escaping on foot
    // stays possible at every tier, just barely, which is what a raider should feel like.
    //
    // 9 health is the number that makes an UNAVOIDABLE tier 1 fight survivable, and it is a hard
    // constraint rather than a taste: at Melee 1 in the starter kit the player deals 0.26 dmg/s, so
    // every extra point of enemy health costs about 2 of the player's 23. At 9 the fight runs 34.4 s
    // and costs 17.6 - worse than an Open March Billy's 20.3 only in that it finds you from 14 m instead
    // of 8. Everything harder than this in Fallowmarch is territorial and can be walked past.
    maxHealth: 9,
    attackLevel: 6,
    defenceLevel: 4,
    accuracy: 6,
    armour: 10,
    magicArmour: 10,
    maxHit: 3,
    attackSpeedMs: 2400,
    aggroRadius: 14,
    moveSpeedMps: 3.4,
    walkSpeedMps: 0.9,
    behaviour: "aggressive",
    marks: purseMarksFor(1),
    drops: [
      { itemId: "coarse_hide", quantity: [1, 2], chance: 0.35 },
      { itemId: "grithe_ore", quantity: [1, 2], chance: 0.25 },
      { itemId: "air_essence", quantity: [1, 1], chance: 0.1 },
      { itemId: "grithe_helm", quantity: [1, 1], chance: 0.03 }
    ]
  },
  {
    id: "tempest_roc_t1",
    name: "Storm Scarab",
    family: "tempest_roc",
    tier: 1,
    // 2.1 m/s, which is 1.6x the 1.32 m/s its own walk cycle implies — the same rule every animal
    // in this table follows, and it has to be here rather than left to the shared default. Without
    // it `render/entityViews.ts: motionTimeScale` has nothing to divide by, plays the cycle at its
    // authored tempo under a body the AI moves at 3.1, and the walk probe measured 61% foot slide
    // on the biggest, most-looked-at creature in the region. It also keeps the boss slower than the
    // player's 4.2, so running is still the answer for a character who took the fight too early.
    // Fallowmarch's region boss. Its slow heavy cadence leaves room to eat or disengage, while
    // enough health separates the fight from the ordinary road enemies.
    maxHealth: 80,
    attackLevel: 9,
    defenceLevel: 7,
    accuracy: 10,
    armour: 18,
    magicArmour: 24,
    maxHit: 6,
    attackSpeedMs: 3e3,
    aggroRadius: 20,
    moveSpeedMps: 2.11,
    walkSpeedMps: 0.72,
    behaviour: "territorial",
    marks: [80, 140],
    drops: [
      { itemId: "air_orb", quantity: [1, 1], chance: 1 },
      { itemId: "palewood_log", quantity: [3, 5], chance: 1 },
      { itemId: "pale_quartz", quantity: [1, 2], chance: 0.75 }
    ]
  },
  // ---------------------------------------------------------------- Vellenwood, tier 5
  {
    id: "deer_t5",
    name: "Stag",
    family: "deer",
    tier: 5,
    // Carries PRD 2.4's tier 5 defensive row verbatim: defenceLevel 7 / armour 10 is what makes
    // "Melee 7 with a Corven sword, 51% hit chance, max hit 7, 30 s" true, and 26 health is the
    // other half of it. magicArmour 18 is deliberately modest - a stag is fast, not warded, and the
    // "do not bring a staff" slot at this tier belongs to the hog 60 m south.
    // Territorial at 9 m: a rutting hart is the one deer that does not run.
    maxHealth: 26,
    attackLevel: 12,
    defenceLevel: 7,
    accuracy: 12,
    armour: 10,
    magicArmour: 18,
    maxHit: 5,
    attackSpeedMs: 2400,
    aggroRadius: 9,
    moveSpeedMps: 1.85,
    walkSpeedMps: 0.62,
    behaviour: "territorial",
    marks: marksFor(5),
    drops: [
      { itemId: "bramble_hide", quantity: [1, 2], chance: 0.55 },
      { itemId: "raw_venison", quantity: [1, 2], chance: 0.5 },
      { itemId: "stag_antler", quantity: [1, 1], chance: 0.22 },
      { itemId: "duskoak_log", quantity: [1, 2], chance: 0.15 },
      { itemId: "vell_amber", quantity: [1, 1], chance: 0.06 }
    ]
  },
  {
    id: "hog_t5",
    name: "Pig",
    family: "hog",
    tier: 5,
    // magicArmour 55 against armour 18 is the tier's "put the staff away" block: a bristled hide
    // caked in Vellenwood mud sheds a spell and does very little against a blade. Aggressive at
    // 7 m, which is short for an aggressive block, so it is the fight you walk into rather than the
    // one that crosses a clearing for you.
    maxHealth: 22,
    attackLevel: 10,
    defenceLevel: 6,
    accuracy: 8,
    armour: 18,
    magicArmour: 55,
    maxHit: 4,
    attackSpeedMs: 2400,
    aggroRadius: 7,
    moveSpeedMps: 0.93,
    walkSpeedMps: 0.29,
    behaviour: "aggressive",
    marks: marksFor(5),
    drops: [
      { itemId: "bramble_hide", quantity: [1, 2], chance: 0.5 },
      { itemId: "raw_venison", quantity: [1, 2], chance: 0.45 },
      { itemId: "curved_tusk", quantity: [1, 1], chance: 0.2 },
      { itemId: "corven_ore", quantity: [1, 2], chance: 0.15 }
    ]
  },
  {
    id: "coyote_t5",
    name: "Forest Wolf",
    family: "coyote",
    tier: 5,
    // The pack hunter. magicArmour 8 is the lowest in Vellenwood, so this is the block a staff
    // answers and the hog does not. 28 health and max hit 6 make it the most expensive ordinary
    // fight in the region after the Reaver: 27.6 s at Melee 7 with a Corven sword.
    maxHealth: 28,
    attackLevel: 13,
    defenceLevel: 8,
    accuracy: 10,
    armour: 14,
    magicArmour: 8,
    maxHit: 6,
    attackSpeedMs: 2400,
    aggroRadius: 10,
    moveSpeedMps: 2.79,
    walkSpeedMps: 0.68,
    behaviour: "aggressive",
    marks: marksFor(5),
    drops: [
      { itemId: "bramble_hide", quantity: [1, 2], chance: 0.55 },
      { itemId: "raw_venison", quantity: [1, 1], chance: 0.35 },
      { itemId: "coyote_fang", quantity: [1, 2], chance: 0.25 },
      { itemId: "corven_ore", quantity: [1, 2], chance: 0.15 }
    ]
  },
  {
    id: "frog_t5",
    name: "Green Frog",
    family: "frog",
    tier: 5,
    // The tier 5 swarm, on the Blackwater Pools. Same 1200 ms cadence as the Marchfield hen and the
    // same passive 4 m, scaled to the region: 12 health and max hit 3 instead of 4 and 1.
    maxHealth: 12,
    attackLevel: 10,
    defenceLevel: 5,
    accuracy: 6,
    armour: 8,
    magicArmour: 8,
    maxHit: 3,
    attackSpeedMs: 1200,
    aggroRadius: 4,
    moveSpeedMps: 0.79,
    walkSpeedMps: 0.17,
    behaviour: "passive",
    marks: marksFor(5),
    drops: [
      { itemId: "marsh_gland", quantity: [1, 2], chance: 0.45 },
      { itemId: "raw_venison", quantity: [1, 1], chance: 0.25 },
      { itemId: "vell_amber", quantity: [1, 1], chance: 0.05 }
    ]
  },
  {
    id: "coney_t5",
    name: "Forest Rabbit",
    family: "coney",
    tier: 5,
    // The same inverted block as the Marchfield coney, at tier 5 and much more common: defence 9
    // against attack 4. Vellenwood is where coneys actually live, so this is the group a player
    // meets in numbers, and it is still the cheapest thing in the region to kill.
    maxHealth: 10,
    attackLevel: 4,
    defenceLevel: 9,
    accuracy: 0,
    armour: 0,
    magicArmour: 0,
    maxHit: 2,
    attackSpeedMs: 1800,
    aggroRadius: 2,
    moveSpeedMps: 0.81,
    walkSpeedMps: 0.41,
    behaviour: "passive",
    marks: marksFor(5),
    drops: [
      { itemId: "bramble_hide", quantity: [1, 1], chance: 0.45 },
      { itemId: "raw_venison", quantity: [1, 1], chance: 0.35 },
      { itemId: "coney_foot", quantity: [1, 1], chance: 0.15 }
    ]
  },
  {
    id: "viper_t5",
    name: "Forest Viper",
    family: "viper",
    tier: 5,
    // Armour 6 is the lowest in Vellenwood and max hit 8 at 3000 ms is the biggest single blow in
    // it, two above the coyote. The glass cannon stated in numbers: it dies quickly and it takes a
    // quarter of a Corven-kitted player's health with it if the roll goes badly.
    maxHealth: 24,
    attackLevel: 16,
    defenceLevel: 6,
    accuracy: 16,
    armour: 6,
    magicArmour: 40,
    maxHit: 8,
    attackSpeedMs: 3e3,
    aggroRadius: 8,
    moveSpeedMps: 1.2,
    walkSpeedMps: 0.5,
    behaviour: "territorial",
    marks: marksFor(5),
    drops: [
      { itemId: "venom_gland", quantity: [1, 1], chance: 0.35 },
      { itemId: "viper_skin", quantity: [1, 1], chance: 0.3 },
      { itemId: "bramble_hide", quantity: [1, 1], chance: 0.2 },
      { itemId: "vell_amber", quantity: [1, 1], chance: 0.08 }
    ]
  },
  {
    id: "reaver_t5",
    name: "Forest Bandit",
    family: "reaver",
    tier: 5,
    // Armour 26 / magicArmour 24 hold the family's "no style has the answer" rule at tier 5, where
    // every other Vellenwood block is lopsided (Duskoak Stag 10/18, Bramble Hog 18/55, Deepwood
    // Coyote 14/8). Melee 7 with a Corven sword takes 35.0 s and 28.9 of 32 health, which is the
    // most expensive ordinary fight in the region - just past the coyote's 27.6 and no further,
    // because this one initiates from 14 m and the coyote does not. The purse pays 35-135 marks.
    maxHealth: 26,
    attackLevel: 14,
    defenceLevel: 9,
    accuracy: 14,
    armour: 26,
    magicArmour: 24,
    maxHit: 6,
    attackSpeedMs: 2400,
    aggroRadius: 14,
    moveSpeedMps: 3.6,
    walkSpeedMps: 0.9,
    behaviour: "aggressive",
    marks: purseMarksFor(5),
    drops: [
      { itemId: "bramble_hide", quantity: [1, 2], chance: 0.35 },
      { itemId: "corven_ore", quantity: [1, 2], chance: 0.25 },
      { itemId: "earth_essence", quantity: [1, 2], chance: 0.15 },
      { itemId: "corven_boots", quantity: [1, 1], chance: 0.03 }
    ]
  },
  {
    id: "rootheart_t5",
    name: "Rootbound Colossus",
    family: "rootheart",
    tier: 5,
    // Same 2.1 m/s and the same reason as the Tempest Roc: one rig, one walk cycle, one honest gait.
    // Vellenwood's region boss. High physical armour favours the Earth Orb it guards once the
    // player has earned that progression reward.
    maxHealth: 140,
    attackLevel: 18,
    defenceLevel: 14,
    accuracy: 16,
    armour: 48,
    magicArmour: 32,
    maxHit: 9,
    attackSpeedMs: 3e3,
    aggroRadius: 22,
    moveSpeedMps: 2.11,
    walkSpeedMps: 0.72,
    behaviour: "territorial",
    marks: [350, 550],
    drops: [
      { itemId: "earth_orb", quantity: [1, 1], chance: 1 },
      { itemId: "duskoak_log", quantity: [3, 6], chance: 1 },
      { itemId: "vell_amber", quantity: [2, 3], chance: 0.75 },
      { itemId: "bramble_hide", quantity: [1, 2], chance: 0.6 }
    ]
  },
  // ---------------------------------------------------------------- Karrowmoor, tier 10
  {
    id: "bear_t10",
    name: "Brown Bear",
    family: "bear",
    tier: 10,
    // Carries PRD 2.4's Cairnwight row verbatim: defenceLevel 11 / armour 55 is what makes "Melee
    // 12 with a Kaldite sword, 46%, max hit 11, 33 s" true, and magicArmour 10 against that armour
    // 55 is the reason the magic gate in the same section works - Voltrend at Magic 10 kills this
    // in 24.0 s against melee's 32.7, so MAGIC WINS by 27%. Aggressive at 10 m and the largest
    // silhouette on the moor.
    maxHealth: 38,
    attackLevel: 18,
    defenceLevel: 11,
    accuracy: 16,
    armour: 55,
    magicArmour: 10,
    maxHit: 7,
    attackSpeedMs: 2400,
    aggroRadius: 10,
    moveSpeedMps: 3.06,
    walkSpeedMps: 0.74,
    behaviour: "aggressive",
    marks: marksFor(10),
    drops: [
      { itemId: "cairn_pelt", quantity: [1, 1], chance: 0.45 },
      { itemId: "raw_haunch", quantity: [1, 2], chance: 0.45 },
      { itemId: "bear_claw", quantity: [1, 2], chance: 0.28 },
      { itemId: "kaldite_ore", quantity: [1, 2], chance: 0.18 },
      { itemId: "cairn_garnet", quantity: [1, 1], chance: 0.08 }
    ]
  },
  {
    id: "boar_t10",
    name: "Wild Boar",
    family: "boar",
    tier: 10,
    // The other half of PRD 2.4's magic gate, and the block the PRD's own number could not support.
    // defenceLevel 11 / armour 30 is solved from "Melee 12 with a Kaldite sword, 51%, 11, 27 s".
    // magicArmour is 115, not the +40 the PRD quotes: hit chance saturates, so with a magic attack
    // roll R the best possible time-to-kill ratio between this and the bear is (R + 20*1.40)/
    // (R + 20*1.10), which caps at 1.27 even as R goes to 0, while the PRD needs at least 1.257
    // AFTER the 34/38 health ratio - that needs R below 1.4, and R is 32.1. The two claims are only
    // simultaneously satisfiable if this block's magic resistance is far higher. At 115 the staff
    // takes 29.8 s against melee's 26.8, so MELEE WINS by 10% and both halves of the gate hold.
    // A mud-caked bristle hide over stone dust is what that number reads as on an animal.
    maxHealth: 34,
    attackLevel: 16,
    defenceLevel: 11,
    accuracy: 14,
    armour: 30,
    magicArmour: 115,
    maxHit: 6,
    attackSpeedMs: 2400,
    aggroRadius: 8,
    moveSpeedMps: 1.5,
    walkSpeedMps: 0.67,
    behaviour: "aggressive",
    marks: marksFor(10),
    drops: [
      { itemId: "cairn_pelt", quantity: [1, 1], chance: 0.4 },
      { itemId: "raw_haunch", quantity: [1, 2], chance: 0.4 },
      { itemId: "curved_tusk", quantity: [1, 1], chance: 0.25 },
      { itemId: "boar_bristle", quantity: [1, 3], chance: 0.25 },
      { itemId: "kaldite_ore", quantity: [1, 2], chance: 0.15 }
    ]
  },
  {
    id: "ibex_t10",
    name: "Ibex",
    family: "ibex",
    tier: 10,
    // The biggest ordinary health pool on the surface at 44, and the block that punishes standing
    // still: max hit 8 at 3000 ms off armour 40 / magicArmour 30. Symmetric resistances on purpose,
    // because the bear and the boar between them already own both lopsided answers at this tier, so
    // the ibex is the one you simply have to out-fight. Territorial at 11 m on the ridge line.
    maxHealth: 44,
    attackLevel: 20,
    defenceLevel: 12,
    accuracy: 18,
    armour: 40,
    magicArmour: 30,
    maxHit: 8,
    attackSpeedMs: 3e3,
    aggroRadius: 11,
    moveSpeedMps: 2.26,
    walkSpeedMps: 0.6,
    behaviour: "territorial",
    marks: marksFor(10),
    drops: [
      { itemId: "cairn_pelt", quantity: [1, 2], chance: 0.5 },
      { itemId: "ibex_horn", quantity: [1, 1], chance: 0.28 },
      { itemId: "raw_haunch", quantity: [1, 2], chance: 0.35 },
      { itemId: "cairnpine_log", quantity: [1, 2], chance: 0.15 },
      { itemId: "cairn_garnet", quantity: [1, 1], chance: 0.1 }
    ]
  },
  {
    id: "aurochs_t10",
    name: "Aurochs",
    family: "aurochs",
    tier: 10,
    // The highest armour in the game at 78, against magicArmour 0 - the widest split anywhere, and
    // the tier 10 restatement of the Redsill cow it is descended from. 3600 ms and max hit 11 make
    // it the single hardest blow outside the boss. Territorial at 6 m, which is what keeps a herd of
    // them walkable.
    maxHealth: 46,
    attackLevel: 20,
    defenceLevel: 13,
    accuracy: 14,
    armour: 78,
    magicArmour: 0,
    maxHit: 11,
    attackSpeedMs: 3600,
    aggroRadius: 6,
    moveSpeedMps: 2.64,
    walkSpeedMps: 0.51,
    behaviour: "territorial",
    marks: marksFor(10),
    drops: [
      { itemId: "cairn_pelt", quantity: [1, 2], chance: 0.55 },
      { itemId: "raw_haunch", quantity: [1, 3], chance: 0.5 },
      { itemId: "aurochs_horn", quantity: [1, 1], chance: 0.25 },
      { itemId: "march_stone", quantity: [2, 5], chance: 0.25 },
      { itemId: "cairn_garnet", quantity: [1, 1], chance: 0.1 }
    ]
  },
  {
    id: "reaver_t10",
    name: "Highland Bandit",
    family: "reaver",
    tier: 10,
    // The last quarry crew, still armed. Armour 42 / magicArmour 40 keeps the family symmetric at
    // the top tier, and 40 health puts it between the Highcairn Bear (38) and the Ridge Ibex (44)
    // rather than beyond either. Aggro 14 makes it the thing that finds you on the moor road, so its
    // cost is capped at the bear's: 34.6 s and 31.8 of 41 health at Melee 12 in a Kaldite
    // sword, against the Cairnwight's 32.7 s and 27.9.
    maxHealth: 40,
    attackLevel: 22,
    defenceLevel: 13,
    accuracy: 18,
    armour: 42,
    magicArmour: 40,
    maxHit: 7,
    attackSpeedMs: 2400,
    aggroRadius: 14,
    moveSpeedMps: 3.9,
    walkSpeedMps: 0.9,
    behaviour: "aggressive",
    marks: purseMarksFor(10),
    drops: [
      { itemId: "cairn_pelt", quantity: [1, 1], chance: 0.3 },
      { itemId: "kaldite_ore", quantity: [1, 3], chance: 0.3 },
      { itemId: "water_essence", quantity: [1, 3], chance: 0.2 },
      { itemId: "kaldite_dagger", quantity: [1, 1], chance: 0.03 }
    ]
  },
  {
    id: "coyote_t10",
    name: "Dire Wolf",
    family: "coyote",
    tier: 10,
    // The family's second tier, and the only tier 10 block that swings faster than 2400 ms. 1800 ms
    // is three combat ticks, so it lands four swings for every three of anything else on the moor:
    // 1.206 dmg/s through a Melee 12 Kaldite kit, the highest on the surface, off the LOWEST tier 10
    // armour (20) and magicArmour (12). It dies fast and hurts while it lives - 23.3 s and 28.0 of
    // 41 health, where the bear is 32.7 s and 27.9.
    maxHealth: 30,
    attackLevel: 21,
    defenceLevel: 12,
    accuracy: 18,
    armour: 20,
    magicArmour: 12,
    maxHit: 7,
    attackSpeedMs: 1800,
    aggroRadius: 12,
    moveSpeedMps: 2.79,
    walkSpeedMps: 0.68,
    behaviour: "aggressive",
    marks: marksFor(10),
    drops: [
      { itemId: "cairn_pelt", quantity: [1, 1], chance: 0.35 },
      { itemId: "coyote_fang", quantity: [1, 3], chance: 0.35 },
      { itemId: "raw_haunch", quantity: [1, 1], chance: 0.3 },
      { itemId: "cragfin", quantity: [1, 2], chance: 0.25 },
      { itemId: "cairn_garnet", quantity: [1, 1], chance: 0.06 }
    ]
  },
  // ---------------------------------------------------------------- Gravelmaw, tier 10
  {
    id: "rat_t10",
    name: "Giant Rat",
    family: "rat",
    tier: 10,
    // Underground, nothing is armoured and everything is quick. 1800 ms off armour 12 makes this
    // the fastest, softest tier 10 block in the game: it is the first thing in the dungeon and it
    // is meant to be survivable while telling you the cadence down here is different.
    maxHealth: 26,
    attackLevel: 18,
    defenceLevel: 10,
    accuracy: 16,
    armour: 12,
    magicArmour: 12,
    maxHit: 5,
    attackSpeedMs: 1800,
    aggroRadius: 10,
    moveSpeedMps: 1.5,
    walkSpeedMps: 0.6,
    behaviour: "aggressive",
    marks: marksFor(10),
    drops: [
      { itemId: "rat_tail", quantity: [1, 3], chance: 0.55 },
      { itemId: "cairn_pelt", quantity: [1, 1], chance: 0.25 },
      { itemId: "raw_haunch", quantity: [1, 1], chance: 0.2 },
      { itemId: "kaldite_ore", quantity: [1, 2], chance: 0.15 }
    ]
  },
  {
    id: "scorpion_t10",
    name: "Giant Scorpion",
    family: "scorpion",
    tier: 10,
    // The armoured scuttler, and the only block in the game with high armour AND high magicArmour
    // (45 / 60). Nothing answers a scorpion cheaply; you pay for it in time whichever hand you
    // fight with. That is the correct shape for the middle of a dungeon, where a player has already
    // committed and cannot re-kit.
    maxHealth: 32,
    attackLevel: 17,
    defenceLevel: 11,
    accuracy: 14,
    armour: 45,
    magicArmour: 60,
    maxHit: 6,
    attackSpeedMs: 2400,
    aggroRadius: 8,
    moveSpeedMps: 1.2,
    walkSpeedMps: 0.5,
    behaviour: "aggressive",
    marks: marksFor(10),
    drops: [
      { itemId: "scorpion_stinger", quantity: [1, 2], chance: 0.4 },
      { itemId: "venom_gland", quantity: [1, 2], chance: 0.3 },
      { itemId: "cairn_pelt", quantity: [1, 1], chance: 0.2 },
      { itemId: "cairn_garnet", quantity: [1, 1], chance: 0.1 }
    ]
  },
  {
    id: "crab_t10",
    name: "Giant Crab",
    family: "crab",
    tier: 10,
    // The dungeon's bulwark: armour 82 against magicArmour 0, one point of armour above the
    // Terrace Aurochs and the highest in the game. 3600 ms and max hit 10. In the flooded lower
    // chamber this is the block that says "bring the staff you left in the bank".
    maxHealth: 42,
    attackLevel: 19,
    defenceLevel: 13,
    accuracy: 12,
    armour: 82,
    magicArmour: 0,
    maxHit: 10,
    attackSpeedMs: 3600,
    aggroRadius: 6,
    moveSpeedMps: 1.3,
    walkSpeedMps: 0.5,
    behaviour: "territorial",
    marks: marksFor(10),
    drops: [
      { itemId: "crab_claw", quantity: [1, 1], chance: 0.45 },
      { itemId: "raw_haunch", quantity: [1, 2], chance: 0.35 },
      { itemId: "cragfin", quantity: [1, 3], chance: 0.3 },
      { itemId: "cairn_garnet", quantity: [1, 1], chance: 0.1 }
    ]
  },
  // ---------------------------------------------------------------- Kilnhalt, tier 20
  // Solved against the tier-20 kits in equipment.ts (kit accuracy 75, sword power 45 -> attack
  // roll 50.75, maxHit 17; magic kit magicAccuracy 75 / magicPower 50 -> Emberlash attack roll
  // 58.4, maxHit 20). Every ordinary row lands in the amendment's 25-40 s on-tier band, and the
  // bear/boar pair restates the Karrowmoor style gate at tier 20: the Ashback answers to a staff
  // in 27.6 s against melee's 36.5, the Cinder Boar answers to a sword in 29.1 against magic's 34.9.
  {
    id: "bear_t20",
    name: "Dire Bear",
    family: "bear",
    tier: 20,
    // The staff answer, one tier up: armour 110 against magicArmour 15. Melee 20 in the full
    // Emberite kit takes 36.5 s; Emberlash in the Charhide kit takes 27.6 s. MAGIC WINS by 24%.
    maxHealth: 60,
    attackLevel: 26,
    defenceLevel: 22,
    accuracy: 20,
    armour: 110,
    magicArmour: 15,
    maxHit: 10,
    attackSpeedMs: 2400,
    aggroRadius: 10,
    moveSpeedMps: 3.06,
    walkSpeedMps: 0.74,
    behaviour: "aggressive",
    marks: marksFor(20),
    drops: [
      { itemId: "charhide", quantity: [1, 1], chance: 0.5 },
      { itemId: "raw_ember_haunch", quantity: [1, 2], chance: 0.45 },
      { itemId: "ashback_claw", quantity: [1, 2], chance: 0.28 },
      { itemId: "emberite_ore", quantity: [1, 2], chance: 0.18 },
      { itemId: "fire_opal", quantity: [1, 1], chance: 0.08 }
    ]
  },
  {
    id: "boar_t20",
    name: "Dire Boar",
    family: "boar",
    tier: 20,
    // The sword answer: magicArmour 130 continues the Scree Boar's mud-caked rule at tier 20.
    // Melee takes 29.1 s, the staff 34.9 s. MELEE WINS by 17%.
    maxHealth: 56,
    attackLevel: 24,
    defenceLevel: 21,
    accuracy: 18,
    armour: 60,
    magicArmour: 130,
    maxHit: 9,
    attackSpeedMs: 2400,
    aggroRadius: 8,
    moveSpeedMps: 1.5,
    walkSpeedMps: 0.67,
    behaviour: "aggressive",
    marks: marksFor(20),
    drops: [
      { itemId: "charhide", quantity: [1, 1], chance: 0.45 },
      { itemId: "raw_ember_haunch", quantity: [1, 2], chance: 0.4 },
      { itemId: "cinder_tusk", quantity: [1, 1], chance: 0.25 },
      { itemId: "emberite_ore", quantity: [1, 2], chance: 0.15 }
    ]
  },
  {
    id: "ibex_t20",
    name: "Large Ibex",
    family: "ibex",
    tier: 20,
    // The out-fight-it block, as at tier 10: near-symmetric 80/60 with the biggest ordinary
    // health pool in the region. 35.3 s at Melee 20; neither style shortcuts it.
    maxHealth: 62,
    attackLevel: 27,
    defenceLevel: 23,
    accuracy: 22,
    armour: 80,
    magicArmour: 60,
    maxHit: 11,
    attackSpeedMs: 3e3,
    aggroRadius: 11,
    moveSpeedMps: 2.26,
    walkSpeedMps: 0.6,
    behaviour: "territorial",
    marks: marksFor(20),
    drops: [
      { itemId: "charhide", quantity: [1, 2], chance: 0.5 },
      { itemId: "emberhorn", quantity: [1, 1], chance: 0.28 },
      { itemId: "raw_ember_haunch", quantity: [1, 2], chance: 0.35 },
      { itemId: "cinderpine_log", quantity: [1, 2], chance: 0.15 },
      { itemId: "fire_opal", quantity: [1, 1], chance: 0.1 }
    ]
  },
  {
    id: "viper_t20",
    name: "Giant Viper",
    family: "viper",
    tier: 20,
    // The family's glass cannon, kept honest at the fast end of the band: 25.7 s at Melee 20,
    // and maxHit 14 at 3000 ms is the hardest ordinary blow in Kilnhalt when it lands.
    maxHealth: 58,
    attackLevel: 30,
    defenceLevel: 18,
    accuracy: 26,
    armour: 25,
    magicArmour: 75,
    maxHit: 14,
    attackSpeedMs: 3e3,
    aggroRadius: 8,
    moveSpeedMps: 1.2,
    walkSpeedMps: 0.5,
    behaviour: "territorial",
    marks: marksFor(20),
    drops: [
      { itemId: "kiln_fang", quantity: [1, 2], chance: 0.4 },
      { itemId: "venom_gland", quantity: [1, 2], chance: 0.25 },
      { itemId: "charhide", quantity: [1, 1], chance: 0.2 },
      { itemId: "fire_essence", quantity: [1, 2], chance: 0.12 }
    ]
  },
  {
    id: "reaver_t20",
    name: "Quarry Bandit",
    family: "reaver",
    tier: 20,
    // The family rule holds at tier 20: symmetric 62/60, aggro 14, and a pursuit at 4.05 m/s -
    // still under the player's 4.2, and the closest any reaver comes. 31.2 s at Melee 20, purse
    // pays 140-540 marks.
    maxHealth: 58,
    attackLevel: 28,
    defenceLevel: 23,
    accuracy: 22,
    armour: 62,
    magicArmour: 60,
    maxHit: 10,
    attackSpeedMs: 2400,
    aggroRadius: 14,
    moveSpeedMps: 4.05,
    walkSpeedMps: 0.9,
    behaviour: "aggressive",
    marks: purseMarksFor(20),
    drops: [
      { itemId: "charhide", quantity: [1, 1], chance: 0.3 },
      { itemId: "emberite_ore", quantity: [1, 3], chance: 0.3 },
      { itemId: "fire_essence", quantity: [1, 3], chance: 0.2 },
      { itemId: "emberite_boots", quantity: [1, 1], chance: 0.03 }
    ]
  },
  // ---------------------------------------------------------------- regional minibosses
  // One Monster02 rig in four texture variants, one per region, each holding the region's rare
  // sword and staff at independent 10% rolls (see equipment.ts RARE_MINIBOSS_WEAPONS). They use
  // the "boss" semantic archetype and the boss respawn window, publish `meta.rank: "miniboss"`,
  // and draw at 1.3x authored scale against the major bosses' 1.6x (world/regionBuilder.ts).
  // Movement speeds follow the one-rig-one-gait rule: the pipeline measured the Monster02 walk
  // cycle at 0.82 m/s implied and the run at 2.22, so the authored walk matches the cycle and the
  // 2.0 m/s pursuit sits under the run clip's rate and well under the player's 4.2.
  {
    id: "galeskin_t1",
    name: "Plains Ogre",
    family: "galeskin",
    tier: 1,
    // Sized between the road reavers and the Tempest Roc: a fight a tier-1 player chooses, long
    // but survivable, and territorial so the choice is real.
    maxHealth: 50,
    attackLevel: 8,
    defenceLevel: 6,
    accuracy: 8,
    armour: 14,
    magicArmour: 14,
    maxHit: 5,
    attackSpeedMs: 3e3,
    aggroRadius: 16,
    moveSpeedMps: 2,
    walkSpeedMps: 0.82,
    behaviour: "territorial",
    marks: [40, 90],
    drops: [
      { itemId: "galeskin_sword", quantity: [1, 1], chance: 0.1 },
      { itemId: "galeskin_staff", quantity: [1, 1], chance: 0.1 },
      { itemId: "air_essence", quantity: [2, 5], chance: 0.5 },
      { itemId: "pale_quartz", quantity: [1, 2], chance: 0.5 },
      { itemId: "coarse_hide", quantity: [1, 2], chance: 0.4 }
    ]
  },
  {
    id: "mossbound_t5",
    name: "Forest Ogre",
    family: "mossbound",
    tier: 5,
    maxHealth: 95,
    attackLevel: 14,
    defenceLevel: 10,
    accuracy: 12,
    armour: 34,
    magicArmour: 30,
    maxHit: 7,
    attackSpeedMs: 3e3,
    aggroRadius: 16,
    moveSpeedMps: 2,
    walkSpeedMps: 0.82,
    behaviour: "territorial",
    marks: [180, 320],
    drops: [
      { itemId: "mossbound_sword", quantity: [1, 1], chance: 0.1 },
      { itemId: "mossbound_staff", quantity: [1, 1], chance: 0.1 },
      { itemId: "earth_essence", quantity: [2, 5], chance: 0.5 },
      { itemId: "vell_amber", quantity: [1, 2], chance: 0.5 },
      { itemId: "duskoak_log", quantity: [2, 4], chance: 0.4 }
    ]
  },
  {
    id: "tideworn_t10",
    name: "Cave Ogre",
    family: "tideworn",
    tier: 10,
    maxHealth: 140,
    attackLevel: 20,
    defenceLevel: 14,
    accuracy: 16,
    armour: 50,
    magicArmour: 40,
    maxHit: 9,
    attackSpeedMs: 3e3,
    aggroRadius: 18,
    moveSpeedMps: 2,
    walkSpeedMps: 0.82,
    behaviour: "territorial",
    marks: [450, 750],
    drops: [
      { itemId: "tideworn_sword", quantity: [1, 1], chance: 0.1 },
      { itemId: "tideworn_staff", quantity: [1, 1], chance: 0.1 },
      { itemId: "water_essence", quantity: [2, 5], chance: 0.5 },
      { itemId: "cairn_garnet", quantity: [1, 2], chance: 0.5 },
      { itemId: "kaldite_ore", quantity: [1, 3], chance: 0.4 }
    ]
  },
  {
    id: "cinderwake_t20",
    name: "Fire Ogre",
    family: "cinderwake",
    tier: 20,
    // Kilnhalt's arena fight and the Fire Orb's keeper. 260 health at Melee 20 in the Emberite
    // kit runs about 149 s and roughly 187 incoming damage - a boss you can lose, exactly like
    // Ordrun. The Orb drop is 100% and singleton: once it is owned or consumed, the shared
    // duplicate-Orb suppression in the loot path withholds later copies.
    maxHealth: 260,
    attackLevel: 32,
    defenceLevel: 24,
    accuracy: 22,
    armour: 78,
    magicArmour: 45,
    maxHit: 15,
    attackSpeedMs: 3e3,
    aggroRadius: 22,
    moveSpeedMps: 2,
    walkSpeedMps: 0.82,
    behaviour: "territorial",
    marks: [1800, 2800],
    drops: [
      { itemId: "fire_orb", quantity: [1, 1], chance: 1 },
      { itemId: "cinderwake_sword", quantity: [1, 1], chance: 0.1 },
      { itemId: "cinderwake_staff", quantity: [1, 1], chance: 0.1 },
      { itemId: "emberite_bar", quantity: [1, 3], chance: 1 },
      { itemId: "fire_opal", quantity: [1, 3], chance: 0.75 },
      { itemId: "charhide", quantity: [1, 2], chance: 0.6 }
    ]
  },
  // ---------------------------------------------------------------- Gravelmaw boss
  {
    id: "quarrykeeper_t10",
    name: "Quarry Warden",
    family: "quarrykeeper",
    tier: 10,
    // Same 2.1 m/s as the other two orb bosses. He is heavier than anything else on the floor and
    // reads that way; the arena is 24 m across, so this is not a fight anyone outruns by accident.
    // 200 HP and magicArmour 18 are given. defenceLevel 20 / armour 62 are solved from the 45%
    // row; attackLevel 24 / accuracy 15 / maxHit 12 at 3.0 s are solved from "about 1.02 damage/s
    // through tier 10 armour". 165 s x 1.020 = 168 damage against a 75 health pool: a boss you
    // can lose, which PRD 2.4 says is the point.
    maxHealth: 200,
    attackLevel: 24,
    defenceLevel: 20,
    accuracy: 15,
    armour: 62,
    magicArmour: 18,
    maxHit: 12,
    attackSpeedMs: 3e3,
    aggroRadius: 24,
    moveSpeedMps: 2.11,
    walkSpeedMps: 0.72,
    behaviour: "territorial",
    marks: [900, 1400],
    drops: [
      { itemId: "water_orb", quantity: [1, 1], chance: 1 },
      // PRD 2.10: "900 to 1,400 plus a guaranteed Kaldite piece".
      { itemId: "kaldite_sword", quantity: [1, 1], chance: 1 },
      { itemId: "kaldite_bar", quantity: [3, 6], chance: 1 },
      { itemId: "cairn_garnet", quantity: [2, 4], chance: 1 },
      { itemId: "cairn_pelt", quantity: [1, 2], chance: 0.75 }
    ]
  }
];
var REGIONAL_BOSS_BLOCKS = new Map(Object.entries(REGIONAL_BOSS_LEVELS).map(([id, target]) => {
  const canonicalId = id === "ordrun" ? "quarrykeeper_t10" : `${id}_t${target.tier}`;
  const base = BLOCKS.find((row) => row.id === canonicalId);
  if (!base) throw new Error(`Missing saved regional boss ${canonicalId}`);
  return [canonicalId, tuneEnemyCombatLevel(base, target.tier * target.multiplier, target.tier)];
}));
var balancedOrdrun = REGIONAL_BOSS_BLOCKS.get("quarrykeeper_t10");
var ORDRUN_PHASES = [
  { atHealthFraction: 1, armour: balancedOrdrun.armour, attackSpeedMs: 3e3, maxHit: balancedOrdrun.maxHit },
  {
    atHealthFraction: 0.55,
    armour: Math.round(balancedOrdrun.armour * 50 / 62),
    attackSpeedMs: 2400,
    maxHit: Math.round(balancedOrdrun.maxHit * 14 / 12),
    telegraphId: "ground_slam",
    telegraphWindupMs: 1800,
    telegraphRadiusM: 6
  }
];
var GROUP_BLOCK = [
  // Fallowmarch, tier 1 - plains, and the water at its edges
  ["redsill_frogs", "frog_t1"],
  ["marchfield_hens", "hen_t1"],
  ["bracken_hens", "hen_t1"],
  ["open_march_goats", "goat_t1"],
  ["redsill_cattle", "cattle_t1"],
  ["marchfield_coneys", "coney_t1"],
  ["palewood_adders", "viper_t1"],
  ["march_road_reavers", "reaver_t1"],
  ["tempest_roc", "tempest_roc_t1"],
  // Vellenwood, tier 5 - forest, and the pools in it
  ["duskoak_stags", "deer_t5"],
  ["bramble_hogs", "hog_t5"],
  ["deepwood_coyotes", "coyote_t5"],
  ["blackwater_frogs", "frog_t5"],
  ["rootfall_coneys", "coney_t5"],
  ["thornline_adders", "viper_t5"],
  ["gorge_reavers", "reaver_t5"],
  ["rootheart", "rootheart_t5"],
  // Karrowmoor, tier 10 - rock, scree and the tarns
  ["highcairn_bears", "bear_t10"],
  ["scree_boars", "boar_t10"],
  ["ridge_ibex", "ibex_t10"],
  ["terrace_aurochs", "aurochs_t10"],
  ["tarn_coyotes", "coyote_t10"],
  ["karrow_reavers", "reaver_t10"],
  // Kilnhalt, tier 20 - ember foothills
  ["ashback_bears", "bear_t20"],
  ["cinder_boars", "boar_t20"],
  ["emberhorn_ibex", "ibex_t20"],
  ["cinder_adders", "viper_t20"],
  ["kilnroad_reavers", "reaver_t20"],
  // Minibosses, count 1 each, so the entity id is the group id.
  ["galeskin", "galeskin_t1"],
  ["mossbound", "mossbound_t5"],
  ["tideworn", "tideworn_t10"],
  ["cinderwake", "cinderwake_t20"],
  // Gravelmaw, tier 10 - underground
  ["gravelmaw_ch1_rats", "rat_t10"],
  ["gravelmaw_ch1_reavers", "reaver_t10"],
  ["gravelmaw_ch2_scorpions", "scorpion_t10"],
  ["gravelmaw_ch2_crabs", "crab_t10"],
  ["gravelmaw_ch3_bears", "bear_t10"],
  // Count 1, so the entity id is the group id: content.enemy("ordrun") resolves the boss.
  ["ordrun", "quarrykeeper_t10"]
];
var FANTASY_SPECIES = [...FOREST_CREATURE_REDESIGNS, ...STONE_CREATURE_REDESIGNS, ...ASH_CREATURE_REDESIGNS];
var FANTASY_SPECIES_BY_ID = new Map(FANTASY_SPECIES.map((species2) => [species2.id, species2]));
var FANTASY_TIER_BLOCKS = FANTASY_SPECIES.flatMap((species2) => [1, 5, 10, 20].map((tier) => {
  const base = species2.stats;
  if (tier === base.tier) return base;
  const ratio = tier / base.tier;
  const scaled = (value, minimum = 0) => Math.max(minimum, Math.round(value * ratio));
  return {
    ...base,
    id: enemyIdFor(base.family, tier),
    tier,
    maxHealth: scaled(base.maxHealth, 1),
    attackLevel: scaled(base.attackLevel, 1),
    defenceLevel: scaled(base.defenceLevel, 1),
    accuracy: scaled(base.accuracy),
    armour: scaled(base.armour),
    magicArmour: scaled(base.magicArmour),
    maxHit: scaled(base.maxHit, 1),
    marks: base.marks ? [scaled(base.marks[0]), scaled(base.marks[1])] : void 0
  };
}));
var FANTASY_ENCOUNTER_LINEAGE = {
  palewood_adders: ["viper_t1", "goblin_scout_t1"],
  regional_gloam_fox: ["gloam_fox_t1", "goblin_shaman_t5"],
  regional_redbrush_fox: ["redbrush_fox_t1", "goblin_archer_t1"],
  pack_fallowmarch_palewood_far_south_scrub: ["field_wasp_t1", "goblin_scout_t1"],
  pack_fallowmarch_palewood_heath_scrub: ["heath_wasp_t1", "goblin_archer_t1"],
  pack_fallowmarch_palewood_reed_scrub: ["reed_wasp_t1", "goblin_scout_t1"],
  pack_fallowmarch_bracken_northeast_spiders: ["briar_spider_t1", "briar_spider_t1"],
  marchwild_horse_residents: ["marchwild_horse_t5", "beetle_golem_t10"],
  duskoak_stags: ["deer_t5", "mossback_sentinel_t10"],
  bramble_hogs: ["hog_t5", "beetle_golem_t10"],
  deepwood_coyotes: ["coyote_t5", "goblin_shaman_t5"],
  blackwater_frogs: ["frog_t5", "marsh_wasp_t5"],
  rootfall_coneys: ["coney_t5", "webweaver_spider_t5"],
  thornline_adders: ["viper_t5", "webweaver_spider_t5"],
  pack_vellenwood_marchgate_south_bramble: ["moonweave_spider_t5", "webweaver_spider_t5"],
  pack_vellenwood_mossbound_west_bramble: ["webweaver_spider_t5", "webweaver_spider_t5"],
  duskoak_lynx_residents: ["duskoak_lynx_t5", "beetle_golem_t10"],
  rootdelve_badger_residents: ["rootdelve_badger_t5", "mossback_sentinel_t10"],
  marsh_moose_residents: ["marsh_moose_t10", "mossback_sentinel_t10"],
  bracken_tapir_residents: ["bracken_tapir_t5", "beetle_golem_t10"],
  blackwater_heron_residents: ["blackwater_heron_t5", "marsh_wasp_t5"],
  quarry_snail_residents: ["quarry_snail_t5", "webweaver_spider_t5"],
  hollowroot_spider_residents: ["hollowroot_spider_t5", "hollowroot_spider_t5"],
  highcairn_bears: ["bear_t10", "shale_elemental_t10"],
  scree_boars: ["boar_t10", "stone_golem_t10"],
  ridge_ibex: ["ibex_t10", "chalk_warden_t10"],
  terrace_aurochs: ["aurochs_t10", "iron_golem_t20"],
  tarn_coyotes: ["coyote_t10", "shale_elemental_t10"],
  pack_karrowmoor_tarn_track_east_mandibles: ["rimeback_tortoise_t10", "chalk_warden_t10"],
  pack_karrowmoor_moor_road_far_west_watch: ["slateback_tortoise_t10", "stone_golem_t10"],
  quillback_porcupine_residents: ["quillback_porcupine_t10", "chalk_warden_t10"],
  cairn_bighorn_residents: ["cairn_bighorn_t10", "shale_elemental_t10"],
  reedjaw_crocodile_residents: ["reedjaw_crocodile_t10", "beetle_golem_t10"],
  slateback_tortoise_residents: ["slateback_tortoise_t10", "stone_golem_t10"],
  scree_bustard_residents: ["scree_bustard_t10", "chalk_warden_t10"],
  antler_beetle_residents: ["antler_beetle_t10", "beetle_golem_t10"],
  quarry_nightmare_residents: ["quarry_nightmare_t10", "quarry_nightmare_t10"],
  gravelmaw_ch1_rats: ["rat_t10", "skeleton_soldier_t5"],
  gravelmaw_ch2_scorpions: ["scorpion_t10", "webweaver_spider_t5"],
  gravelmaw_ch2_crabs: ["crab_t10", "beetle_golem_t10"],
  gravelmaw_ch3_bears: ["bear_t10", "stone_golem_t10"],
  gravelmaw_amethyst_spiders: ["amethyst_spider_t5", "webweaver_spider_t5"],
  ashback_bears: ["bear_t20", "lava_golem_t10"],
  cinder_boars: ["boar_t20", "fire_golem_t20"],
  emberhorn_ibex: ["ibex_t20", "revenant_t20"],
  cinder_adders: ["viper_t20", "skeleton_mage_t20"],
  pack_kilnhalt_clinker_southern_approach_west: ["cindercrest_salamander_t20", "lava_golem_t10"],
  pack_kilnhalt_cinderpine_northwest_outer: ["kiln_salamander_t20", "fire_golem_t20"],
  kiln_salamander_residents: ["kiln_salamander_t20", "lava_golem_t10"],
  ashscale_monitor_residents: ["ashscale_monitor_t20", "revenant_t20"],
  slag_centipede_residents: ["slag_centipede_t20", "fire_golem_t20"],
  cinder_ravager_residents: ["cinder_ravager_t20", "cinder_ravager_t20"],
  basalt_drake_residents: ["basalt_drake_t20", "basalt_drake_t20"],
  gorge_mantis_residents: ["gorge_mantis_t20", "gorge_mantis_t20"]
};
var ALL_BLOCKS = [...new Map([
  ...BLOCKS.map((row) => REGIONAL_BOSS_BLOCKS.get(row.id) ?? row),
  ...CREATURE_SPECIES.map((species2) => species2.stats),
  ...RPG_BESTIARY.map((species2) => species2.stats),
  ...FANTASY_TIER_BLOCKS
].map((row) => [row.id, row])).values()];
var BY_BLOCK_ID = new Map(ALL_BLOCKS.map((row) => [row.id, row]));
var GROUP_ALIASES = GROUP_BLOCK.flatMap(([groupId, blockId]) => {
  if (Object.hasOwn(BIOME_POPULATION_LEGACY_REPLACEMENTS, groupId)) return [];
  const base = BY_BLOCK_ID.get(blockId);
  return base === void 0 ? [] : [{ ...base, id: groupId }];
});
var FANTASY_ENCOUNTER_BLOCKS = Object.entries(BIOME_POPULATION_LEGACY_REPLACEMENTS).map(([groupId, speciesId]) => {
  const lineage = FANTASY_ENCOUNTER_LINEAGE[groupId];
  const original = lineage ? BY_BLOCK_ID.get(lineage[0]) : void 0;
  const species2 = FANTASY_SPECIES_BY_ID.get(speciesId);
  if (!original || !species2) throw new Error(`Missing original stats or replacement creature for ${groupId}`);
  return {
    ...original,
    id: groupId,
    family: species2.stats.family,
    name: species2.stats.name,
    moveSpeedMps: species2.stats.moveSpeedMps,
    walkSpeedMps: species2.stats.walkSpeedMps
  };
});
var PRE_WILDERNESS_BLOCKS = [...ALL_BLOCKS, ...GROUP_ALIASES, ...FANTASY_ENCOUNTER_BLOCKS];
var PRE_WILDERNESS_BY_ID = new Map(PRE_WILDERNESS_BLOCKS.map((row) => [row.id, row]));
var WILDERNESS_BLOCKS = buildWildernessEnemyProgression([
  ...WILDERNESS_GROUPS,
  ...resolveBiomePopulation(CREATURE_SPECIES).filter((group) => BIOME_POPULATION.some((pack) => pack.id === group.id && pack.regionId === "wilderness"))
], (groupId, family, tier) => {
  const exact = PRE_WILDERNESS_BY_ID.get(groupId);
  return exact?.family === family ? exact : PRE_WILDERNESS_BY_ID.get(enemyIdFor(family, tier));
}, [...CREATURE_SPECIES, ...RPG_BESTIARY]);
var ENEMIES = [...new Map([
  ...PRE_WILDERNESS_BLOCKS,
  ...WILDERNESS_BLOCKS
].map((row) => [row.id, row])).values()];
var ENEMY_BLOCKS = [...new Map([
  ...ALL_BLOCKS,
  ...WILDERNESS_BLOCKS.filter((row) => row.id === enemyIdFor(row.family, row.tier))
].map((row) => [row.id, row])).values()];
var BY_ANY_ID = new Map(ENEMIES.map((row) => [row.id, row]));
export {
  ENEMIES as default
};
