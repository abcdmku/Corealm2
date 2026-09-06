import type { CreatureSpeciesDef } from "./creatureSpecies.js";
import type { EnemyDef } from "./index.js";

/** Existing free source models, with their native rigs and attack clips. See docs/starter-creatures.md. */
function small(id: string, name: string, assetId: string, scale: number, health: number,
  behaviour: EnemyDef["behaviour"], activity: CreatureSpeciesDef["activity"],
  loot: string, description: string, armour = 0, moveSpeedMps = 1.6): CreatureSpeciesDef {
  return { id, assetId, scale, regionId: "fallowmarch", activity, description,
    stats: { id: `${id}_t1`, family: id, name, tier: 1, maxHealth: health,
      attackLevel: 2, defenceLevel: 1, accuracy: 4, armour, magicArmour: 0,
      maxHit: 2, attackSpeedMs: 2400, aggroRadius: behaviour === "aggressive" ? 5 : 3,
      moveSpeedMps, walkSpeedMps: Math.min(0.4, moveSpeedMps / 3), behaviour, marks: [1, 3],
      drops: [{ itemId: loot, quantity: [1, 2], chance: 0.65 }] } };
}

export const STARTER_CREATURES: readonly CreatureSpeciesDef[] = [
  small("grass_viper", "Grass Viper", "animal_viper", 0.8, 8, "territorial", "prowl", "venom_gland",
    "A low grassland snake. Strikes when disturbed and lets passing travelers through."),
  small("field_wasp", "Field Wasp", "creature_field_wasp", 0.45, 7, "aggressive", "prowl", "venom_gland",
    "A small moss-green winged predator guarding scrub away from the farm."),
  small("heath_wasp", "Heath Wasp", "creature_heath_wasp", 0.45, 7, "aggressive", "prowl", "venom_gland",
    "A tiny dusty-brown wasp sheltering in dry scrub. Attacks with a short stinger strike."),
  small("reed_wasp", "Reed Wasp", "creature_reed_wasp", 0.45, 7, "aggressive", "prowl", "venom_gland",
    "A small slate-blue wasp with quiet translucent wings and a sharp sting."),
  small("creek_crab", "Creek Crab", "animal_crab", 2.8, 10, "territorial", "forage", "crab_claw",
    "A small armored bank scavenger. Holds its ground when attacked.", 25, 0.6),
  small("briar_spider", "Briar Spider", "creature_webweaver_spider", 0.6, 8, "aggressive", "prowl", "spider_thread",
    "A low bramble hunter. Short-range aggression and a quick mandible strike.", 0, 0.95),
  small("granary_rat", "Granary Rat", "animal_rat", 1.8, 6, "passive", "forage", "rat_tail",
    "A small scavenger around abandoned supplies. Retaliates with a bite."),
];
