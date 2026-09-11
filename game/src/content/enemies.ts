/**
 * Original combat blocks and the fantasy creatures that now occupy their encounters.
 * Stable encounter aliases retain the original balance, rewards and currency. Canonical family
 * blocks remain available for the source gallery, new populations and coastal generation.
 *
 * Owned by W-CONTENT.
 *
 * ---------------------------------------------------------------------------------------------
 * THE ORIGINAL FAMILY VOCABULARY. The old animal families below document the encounter balance.
 * The aliases at the end of this file give their replacement creatures new families and names.
 *
 *  family       region             the number that defines it
 *  ------------ ------------------ ---------------------------------------------------------------
 *  frog         water edges        6 health, passive: the fight a new character chooses first
 *  hen          plains             1200 ms and max hit 1, the fastest cadence in the game
 *  coney        plains, forest     defence ABOVE attack: the only inverted block, and harmless
 *  goat         plains             the aggressive tier 1 spawn, the one that starts it
 *  cattle       plains             armour 35 against magicArmour 0, and 3600 ms
 *  viper        plains, forest     armour 0 with the biggest single blow at its tier
 *  deer         forest             defenceLevel 7 / armour 10, PRD 2.4 tier 5 defensive row
 *  hog          forest             magicArmour 55: the tier 5 target you do NOT bring a staff to
 *  coyote       forest, rock       pack hunter, and at tier 10 an 1800 ms cadence
 *  bear         rock, underground  armour 55 against magicArmour 10: the staff answer
 *  boar         rock               armour 30 against magicArmour 115: the sword answer
 *  ibex         rock               44 health, symmetric resistances, simply out-fight it
 *  aurochs      rock               armour 78 against magicArmour 0, the widest split anywhere
 *  rat          underground        the softest tier 10 block, at 1800 ms
 *  scorpion     underground        high armour AND high magicArmour: nothing answers it cheaply
 *  crab         underground        armour 82, the highest in the game
 *  reaver       every region       humanoid raider: aggro 14 m and 2.4x the mark drop
 *  quarrykeeper Gravelmaw          Ordrun: 200 health, two phases, a telegraphed slam
 *  galeskin/mossbound/tideworn/cinderwake — the four regional minibosses, one Monster02 rig in
 *               four texture variants, each rolling its region's rare sword and staff at 10%
 *
 * Behaviour is the second axis and it is doing real work. Passive hens, frogs and coneys, and
 * territorial cattle, deer, ibex, aurochs, vipers and crabs, can all be walked past, so the
 * aggressive families (goat, hog, coyote, bear, boar, rat, scorpion, reaver) are what actually
 * decides whether a stretch of ground is dangerous. systems/enemyAI.ts reads exactly `behaviour`
 * and `aggroRadius`; systems/combat.ts reads every other field on the row.
 *
 * ---------------------------------------------------------------------------------------------
 * LEVELS ARE NOT IN THIS FILE, ON PURPOSE. A displayed combat level is a reading of the stats
 * below, so content/index.ts `enemyCombatLevel()` computes it from attack, accuracy, defence,
 * armour, magicArmour and health, and content/regions.ts no longer carries a `level` field at all.
 * The authored numbers it replaced disagreed with these blocks in both directions: a 4 health gnat
 * published as level 3, and Ordrun 200 health published as level 20.
 *
 * ---------------------------------------------------------------------------------------------
 * LOOKUP. world/regionBuilder.ts stamps each spawned entity with `meta.family`, `meta.groupId` and
 * `tier`, and nothing else. So every stat block is published twice: once under `<family>_t<tier>`
 * (use `enemyIdFor`) and once under each content/regions.ts group id, so
 * `content.enemy(entity.meta.groupId)` resolves directly. Ordrun group has count 1, which means its
 * entity id IS `ordrun`, so `content.enemy("ordrun")` works too.
 *
 * ---------------------------------------------------------------------------------------------
 * THE ARITHMETIC. Every defender stat below is SOLVED from PRD 2.4 time-to-kill table, not chosen.
 * Formulas: attackRoll = (attackLevel + 9) * (1 + accuracy/100) * styleFactor,
 * defenceRoll = (defenceLevel + 9) * (1 + armour/100),
 * hitChance = attackRoll/(attackRoll+defenceRoll),
 * damage/s = hitChance * (1 + maxHit)/2 / attackSpeedSeconds.
 *
 * The PRD wrote its rows against the creatures this table replaced, so each row now names the
 * animal that inherited it. The numbers are unchanged; only the thing wearing them is.
 *
 *  PRD row                                                  | inherited by      | result
 *  --------------------------------------------------------- | ----------------- | --------------
 *  Melee 1 unarmed, 50%, maxHit 2, 19 s                       | Redsill Frog      | 10/(10+10)=50%
 *                                                             | defL 1, armour 0  | 6/0.3125 = 19.2 s
 *  Melee 3 Grithe dagger, 56%, maxHit 4, 10 s                 | Redsill Frog      | 12.72/22.72=56%
 *                                                             |                   | 6/0.5831 = 10.3 s
 *  Melee 7 Corven sword, 51%, maxHit 7, 30 s                  | Duskoak Stag      | 18.24/35.84=50.9%
 *                                                             | defL 7, armour 10 | 26/0.8482 = 30.7 s
 *  Melee 12 Kaldite sword, 51%, 11, 27 s                      | Scree Boar        | 26.88/52.88=50.8%
 *                                                             | defL 11, arm 30   | 34/1.2708 = 26.8 s
 *  Melee 12 Kaldite sword, 46%, 11, 33 s                      | Highcairn Bear    | 26.88/57.88=46.4%
 *                                                             | defL 11, arm 55   | 38/1.1610 = 32.7 s
 *  Melee 18 tier 10 kit vs Ordrun, 45%, 12, 165 s             | unchanged         | 38.34/85.32=44.9%
 *                                                             | defL 20, arm 62   | 200/1.2170 = 164.3 s
 *  Ordrun deals about 1.02 damage/s through tier 10 armour    | unchanged         | 37.95/80.61=47.1%
 *                                                             |                   | = 1.020 dmg/s
 *
 * MAGIC VS MELEE, the gate criterion in PRD 2.4. Rimewash at Magic 10 in the full tier 10 magic kit
 * (magicPower 32 -> maxHit 15, magicAccuracy 47 -> attackRoll 32.12, styleFactor 1.15):
 *   vs Highcairn Bear (magicArmour  10): defenceRoll 22.0 -> 59.3% -> 1.583 dmg/s -> 24.0 s
 *                                        melee at Melee 12 takes 32.7 s. MAGIC WINS by 27%. MATCHES PRD.
 *   vs Scree Boar     (magicArmour 115): defenceRoll 43.0 -> 42.8% -> 1.140 dmg/s -> 29.8 s
 *                                        melee at Melee 12 takes 26.8 s. MELEE WINS by 10%.
 *
 * DEVIATION, flagged rather than hidden: PRD 2.4 quotes that second block at magicArmour +40. That
 * number cannot produce "melee wins" alongside the 24 s bear claim; the full argument is written on
 * the `boar_t10` row itself. Its armour stays at the PRD +30. This keeps both halves of the balance
 * gate true and makes "the mud-caked thing shrugs off lightning" read explicit.
 * ---------------------------------------------------------------------------------------------
 */
import type { EnemyDef } from "./index.js";
import { CREATURE_SPECIES } from "./creatureSpecies.js";
import { RPG_BESTIARY } from "./rpgBestiary.js";
import { FOREST_CREATURE_REDESIGNS } from "./forestCreatureRedesigns.js";
import { STONE_CREATURE_REDESIGNS } from "./stoneCreatureRedesigns.js";
import { ASH_CREATURE_REDESIGNS } from "./ashCreatureRedesigns.js";
import { BIOME_POPULATION, BIOME_POPULATION_LEGACY_REPLACEMENTS, resolveBiomePopulation } from "./biomePopulation.js";
import { WILDERNESS_GROUPS } from './wilderness.js';
import { buildWildernessEnemyProgression } from './wildernessEnemyProgression.js';
import { REGIONAL_BOSS_LEVELS, tuneEnemyCombatLevel } from './encounterBalance.js';

/** PRD 2.4: enemies leash at 28 m from their spawn point, at every tier. */
export const LEASH_RADIUS_M = 28;

/** PRD 2.10: enemy mark drops are randomInt(round(tier * 3), round(tier * 11)). */
function marksFor(tier: number): [number, number] {
  return [Math.round(tier * 3), Math.round(tier * 11)];
}

/**
 * Reavers carry a purse, so they pay 2.4x the ordinary band.
 *
 * This is the one mechanical reason to take an aggressive 14 m-aggro fight you could have walked
 * around: at tier 1 a Reaver averages 25 marks against an Open March Billy's 7, which is a Grithe
 * dagger (90 marks) in four fights instead of thirteen.
 */
function purseMarksFor(tier: number): [number, number] {
  return [Math.round(tier * 7), Math.round(tier * 27)];
}

/** The canonical id for a family at a tier. `meta.family` + `tier` is all the entity carries. */
export function enemyIdFor(family: string, tier: number): string {
  return `${family}_t${tier}`;
}

const BLOCKS: readonly EnemyDef[] = [
  // ---------------------------------------------------------------- Fallowmarch, tier 1
  {
    id: "frog_t1", name: "Frog", family: "frog", tier: 1,
    // The first thing most characters kill, and it inherits the Rill Skitterling's numbers EXACTLY
    // because PRD 2.4 solves two of its rows against them: defenceLevel 1 / armour 0 is what makes
    // "Melee 1 unarmed, 50% hit chance, 19 s" and "Melee 3 with a Grithe dagger, 56%, 10 s" both
    // true. 6 health also fixes the XP maths: 6*4 + round(6*2) = 36 XP a kill, 48 kills to Melee 10.
    // Passive at 5 m, sitting on the Redsill shallows, so a player chooses this fight.
    maxHealth: 6, attackLevel: 2, defenceLevel: 1,
    accuracy: 0, armour: 0, magicArmour: 0,
    maxHit: 2, attackSpeedMs: 2400, aggroRadius: 5, moveSpeedMps: 0.79, walkSpeedMps: 0.17, behaviour: "passive",
    marks: marksFor(1),
    drops: [
      { itemId: "raw_game_meat", quantity: [1, 1], chance: 0.40 },
      { itemId: "marsh_gland", quantity: [1, 2], chance: 0.30 },
      { itemId: "march_stone", quantity: [1, 2], chance: 0.20 },
      { itemId: "pale_quartz", quantity: [1, 1], chance: 0.06 },
    ],
  },
  {
    id: "hen_t1", name: "Hen", family: "hen", tier: 1,
    // The swarm shape, and the only one in the table: 1200 ms is the fastest cadence in the game
    // (two combat ticks) and max hit 1 makes every landed peck worth exactly 1. Against a Melee 1
    // player in the starter kit it deals 0.437 dmg/s and dies in 12.6 s, so one hen costs 5.5 of 23
    // health: four of them is a real problem and one is a nuisance. Passive at 3 m, so a new
    // character walks the March Road through the flock and fights only what they swing at.
    maxHealth: 4, attackLevel: 2, defenceLevel: 1,
    accuracy: 0, armour: 0, magicArmour: 0,
    maxHit: 1, attackSpeedMs: 1200, aggroRadius: 3, moveSpeedMps: 1.02, walkSpeedMps: 0.22, behaviour: "passive",
    marks: marksFor(1),
    drops: [
      { itemId: "hen_feather", quantity: [1, 3], chance: 0.55 },
      { itemId: "raw_game_meat", quantity: [1, 1], chance: 0.35 },
      { itemId: "hen_egg", quantity: [1, 2], chance: 0.25 },
    ],
  },
  {
    id: "goat_t1", name: "Goat", family: "goat", tier: 1,
    // The aggressive tier 1 spawn: the one animal on the plain that starts the fight. Against a
    // naked Melee 1 player (23 max health, PRD 2.3) it runs 43 s and lands 0.479 dmg/s, so it costs
    // about 21 health - survivable, and obviously not free. With a Grithe dagger it is 31 s and 15
    // damage; in the full tier 1 kit (29 max health, armour 16) it is 25 s and 11 damage.
    maxHealth: 12, attackLevel: 4, defenceLevel: 3,
    accuracy: 4, armour: 4, magicArmour: 2,
    maxHit: 3, attackSpeedMs: 2400, aggroRadius: 8, moveSpeedMps: 2.06, walkSpeedMps: 0.52, behaviour: "aggressive",
    marks: marksFor(1),
    drops: [
      { itemId: "coarse_hide", quantity: [1, 2], chance: 0.55 },
      { itemId: "raw_game_meat", quantity: [1, 2], chance: 0.40 },
      { itemId: "curl_horn", quantity: [1, 1], chance: 0.22 },
      { itemId: "grithe_ore", quantity: [1, 2], chance: 0.15 },
      { itemId: "grithe_dagger", quantity: [1, 1], chance: 0.02 },
    ],
  },
  {
    id: "cattle_t1", name: "Cow", family: "cattle", tier: 1,
    // The bulwark: armour 35 against magicArmour 0, the widest split at tier 1, so a staff is the
    // right answer and a dagger is the wrong one. 3600 ms is the slowest cadence in the game and
    // max hit 5 is the biggest single blow at the tier, which is a cow exactly: it ignores you, and
    // then it does not. Territorial at 5 m, grazing beside the Marchfield farmstead. At Melee 1
    // this fight is unwinnable (65.9 s, 32.8 damage against 23 health) and the whole point of
    // territorial is that it never starts.
    maxHealth: 16, attackLevel: 5, defenceLevel: 3,
    accuracy: 6, armour: 35, magicArmour: 0,
    maxHit: 5, attackSpeedMs: 3600, aggroRadius: 5, moveSpeedMps: 2.64, walkSpeedMps: 0.51, behaviour: "territorial",
    marks: marksFor(1),
    drops: [
      { itemId: "coarse_hide", quantity: [1, 2], chance: 0.60 },
      { itemId: "raw_game_meat", quantity: [1, 3], chance: 0.50 },
      { itemId: "ox_horn", quantity: [1, 1], chance: 0.20 },
      { itemId: "march_stone", quantity: [1, 3], chance: 0.15 },
    ],
  },
  {
    id: "coney_t1", name: "Rabbit", family: "coney", tier: 1,
    // The rare one. Defence 4 against attack 2 is the only inverted block in the table and it is
    // the whole design: a coney is hard to land a swing on and cannot hurt you back. 2 m aggro is
    // the smallest in the game, so it is passive in the strongest sense - you have to walk onto it.
    // Worth killing for the hide and the foot, not for the fight.
    maxHealth: 5, attackLevel: 2, defenceLevel: 4,
    accuracy: 0, armour: 0, magicArmour: 0,
    maxHit: 1, attackSpeedMs: 1800, aggroRadius: 2, moveSpeedMps: 0.81, walkSpeedMps: 0.41, behaviour: "passive",
    marks: marksFor(1),
    drops: [
      { itemId: "coarse_hide", quantity: [1, 1], chance: 0.50 },
      { itemId: "raw_game_meat", quantity: [1, 1], chance: 0.45 },
      { itemId: "coney_foot", quantity: [1, 1], chance: 0.12 },
    ],
  },
  {
    id: "viper_t1", name: "Viper", family: "viper", tier: 1,
    // The glass cannon. Armour 0 and 9 health make it the fastest tier 1 kill in the table, and max
    // hit 5 on a 3000 ms cadence makes it the hardest single blow at the tier - a bad roll takes a
    // fifth of a new character's health in one bite. magicArmour 20 against armour 0 is the mirror
    // of the cow standing 240 m east, so the two tier 1 territorial blocks want opposite styles.
    maxHealth: 9, attackLevel: 7, defenceLevel: 2,
    accuracy: 10, armour: 0, magicArmour: 20,
    maxHit: 5, attackSpeedMs: 3000, aggroRadius: 7, moveSpeedMps: 1.2, walkSpeedMps: 0.5, behaviour: "territorial",
    marks: marksFor(1),
    drops: [
      { itemId: "viper_skin", quantity: [1, 1], chance: 0.45 },
      { itemId: "marsh_gland", quantity: [1, 1], chance: 0.20 },
      { itemId: "palewood_log", quantity: [1, 2], chance: 0.20 },
      { itemId: "air_essence", quantity: [1, 1], chance: 0.10 },
    ],
  },
  {
    id: "reaver_t1", name: "Road Bandit", family: "reaver", tier: 1,
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
    maxHealth: 9, attackLevel: 6, defenceLevel: 4,
    accuracy: 6, armour: 10, magicArmour: 10,
    maxHit: 3, attackSpeedMs: 2400, aggroRadius: 14, moveSpeedMps: 3.4, walkSpeedMps: 0.9, behaviour: "aggressive",
    marks: purseMarksFor(1),
    drops: [
      { itemId: "coarse_hide", quantity: [1, 2], chance: 0.35 },
      { itemId: "grithe_ore", quantity: [1, 2], chance: 0.25 },
      { itemId: "air_essence", quantity: [1, 1], chance: 0.10 },
      { itemId: "grithe_helm", quantity: [1, 1], chance: 0.03 },
    ],
  },
  {
    id: "tempest_roc_t1", name: "Storm Scarab", family: "tempest_roc", tier: 1,
    // 2.1 m/s, which is 1.6x the 1.32 m/s its own walk cycle implies — the same rule every animal
    // in this table follows, and it has to be here rather than left to the shared default. Without
    // it `render/entityViews.ts: motionTimeScale` has nothing to divide by, plays the cycle at its
    // authored tempo under a body the AI moves at 3.1, and the walk probe measured 61% foot slide
    // on the biggest, most-looked-at creature in the region. It also keeps the boss slower than the
    // player's 4.2, so running is still the answer for a character who took the fight too early.
    // Fallowmarch's region boss. Its slow heavy cadence leaves room to eat or disengage, while
    // enough health separates the fight from the ordinary road enemies.
    maxHealth: 80, attackLevel: 9, defenceLevel: 7,
    accuracy: 10, armour: 18, magicArmour: 24,
    maxHit: 6, attackSpeedMs: 3000, aggroRadius: 20, moveSpeedMps: 2.11, walkSpeedMps: 0.72, behaviour: "territorial",
    marks: [80, 140],
    drops: [
      { itemId: "air_orb", quantity: [1, 1], chance: 1.00 },
      { itemId: "palewood_log", quantity: [3, 5], chance: 1.00 },
      { itemId: "pale_quartz", quantity: [1, 2], chance: 0.75 },
    ],
  },

  // ---------------------------------------------------------------- Vellenwood, tier 5
  {
    id: "deer_t5", name: "Stag", family: "deer", tier: 5,
    // Carries PRD 2.4's tier 5 defensive row verbatim: defenceLevel 7 / armour 10 is what makes
    // "Melee 7 with a Corven sword, 51% hit chance, max hit 7, 30 s" true, and 26 health is the
    // other half of it. magicArmour 18 is deliberately modest - a stag is fast, not warded, and the
    // "do not bring a staff" slot at this tier belongs to the hog 60 m south.
    // Territorial at 9 m: a rutting hart is the one deer that does not run.
    maxHealth: 26, attackLevel: 12, defenceLevel: 7,
    accuracy: 12, armour: 10, magicArmour: 18,
    maxHit: 5, attackSpeedMs: 2400, aggroRadius: 9, moveSpeedMps: 1.85, walkSpeedMps: 0.62, behaviour: "territorial",
    marks: marksFor(5),
    drops: [
      { itemId: "bramble_hide", quantity: [1, 2], chance: 0.55 },
      { itemId: "raw_venison", quantity: [1, 2], chance: 0.50 },
      { itemId: "stag_antler", quantity: [1, 1], chance: 0.22 },
      { itemId: "duskoak_log", quantity: [1, 2], chance: 0.15 },
      { itemId: "vell_amber", quantity: [1, 1], chance: 0.06 },
    ],
  },
  {
    id: "hog_t5", name: "Pig", family: "hog", tier: 5,
    // magicArmour 55 against armour 18 is the tier's "put the staff away" block: a bristled hide
    // caked in Vellenwood mud sheds a spell and does very little against a blade. Aggressive at
    // 7 m, which is short for an aggressive block, so it is the fight you walk into rather than the
    // one that crosses a clearing for you.
    maxHealth: 22, attackLevel: 10, defenceLevel: 6,
    accuracy: 8, armour: 18, magicArmour: 55,
    maxHit: 4, attackSpeedMs: 2400, aggroRadius: 7, moveSpeedMps: 0.93, walkSpeedMps: 0.29, behaviour: "aggressive",
    marks: marksFor(5),
    drops: [
      { itemId: "bramble_hide", quantity: [1, 2], chance: 0.50 },
      { itemId: "raw_venison", quantity: [1, 2], chance: 0.45 },
      { itemId: "curved_tusk", quantity: [1, 1], chance: 0.20 },
      { itemId: "corven_ore", quantity: [1, 2], chance: 0.15 },
    ],
  },
  {
    id: "coyote_t5", name: "Forest Wolf", family: "coyote", tier: 5,
    // The pack hunter. magicArmour 8 is the lowest in Vellenwood, so this is the block a staff
    // answers and the hog does not. 28 health and max hit 6 make it the most expensive ordinary
    // fight in the region after the Reaver: 27.6 s at Melee 7 with a Corven sword.
    maxHealth: 28, attackLevel: 13, defenceLevel: 8,
    accuracy: 10, armour: 14, magicArmour: 8,
    maxHit: 6, attackSpeedMs: 2400, aggroRadius: 10, moveSpeedMps: 2.79, walkSpeedMps: 0.68, behaviour: "aggressive",
    marks: marksFor(5),
    drops: [
      { itemId: "bramble_hide", quantity: [1, 2], chance: 0.55 },
      { itemId: "raw_venison", quantity: [1, 1], chance: 0.35 },
      { itemId: "coyote_fang", quantity: [1, 2], chance: 0.25 },
      { itemId: "corven_ore", quantity: [1, 2], chance: 0.15 },
    ],
  },
  {
    id: "frog_t5", name: "Green Frog", family: "frog", tier: 5,
    // The tier 5 swarm, on the Blackwater Pools. Same 1200 ms cadence as the Marchfield hen and the
    // same passive 4 m, scaled to the region: 12 health and max hit 3 instead of 4 and 1.
    maxHealth: 12, attackLevel: 10, defenceLevel: 5,
    accuracy: 6, armour: 8, magicArmour: 8,
    maxHit: 3, attackSpeedMs: 1200, aggroRadius: 4, moveSpeedMps: 0.79, walkSpeedMps: 0.17, behaviour: "passive",
    marks: marksFor(5),
    drops: [
      { itemId: "marsh_gland", quantity: [1, 2], chance: 0.45 },
      { itemId: "raw_venison", quantity: [1, 1], chance: 0.25 },
      { itemId: "vell_amber", quantity: [1, 1], chance: 0.05 },
    ],
  },
  {
    id: "coney_t5", name: "Forest Rabbit", family: "coney", tier: 5,
    // The same inverted block as the Marchfield coney, at tier 5 and much more common: defence 9
    // against attack 4. Vellenwood is where coneys actually live, so this is the group a player
    // meets in numbers, and it is still the cheapest thing in the region to kill.
    maxHealth: 10, attackLevel: 4, defenceLevel: 9,
    accuracy: 0, armour: 0, magicArmour: 0,
    maxHit: 2, attackSpeedMs: 1800, aggroRadius: 2, moveSpeedMps: 0.81, walkSpeedMps: 0.41, behaviour: "passive",
    marks: marksFor(5),
    drops: [
      { itemId: "bramble_hide", quantity: [1, 1], chance: 0.45 },
      { itemId: "raw_venison", quantity: [1, 1], chance: 0.35 },
      { itemId: "coney_foot", quantity: [1, 1], chance: 0.15 },
    ],
  },
  {
    id: "viper_t5", name: "Forest Viper", family: "viper", tier: 5,
    // Armour 6 is the lowest in Vellenwood and max hit 8 at 3000 ms is the biggest single blow in
    // it, two above the coyote. The glass cannon stated in numbers: it dies quickly and it takes a
    // quarter of a Corven-kitted player's health with it if the roll goes badly.
    maxHealth: 24, attackLevel: 16, defenceLevel: 6,
    accuracy: 16, armour: 6, magicArmour: 40,
    maxHit: 8, attackSpeedMs: 3000, aggroRadius: 8, moveSpeedMps: 1.2, walkSpeedMps: 0.5, behaviour: "territorial",
    marks: marksFor(5),
    drops: [
      { itemId: "venom_gland", quantity: [1, 1], chance: 0.35 },
      { itemId: "viper_skin", quantity: [1, 1], chance: 0.30 },
      { itemId: "bramble_hide", quantity: [1, 1], chance: 0.20 },
      { itemId: "vell_amber", quantity: [1, 1], chance: 0.08 },
    ],
  },
  {
    id: "reaver_t5", name: "Forest Bandit", family: "reaver", tier: 5,
    // Armour 26 / magicArmour 24 hold the family's "no style has the answer" rule at tier 5, where
    // every other Vellenwood block is lopsided (Duskoak Stag 10/18, Bramble Hog 18/55, Deepwood
    // Coyote 14/8). Melee 7 with a Corven sword takes 35.0 s and 28.9 of 32 health, which is the
    // most expensive ordinary fight in the region - just past the coyote's 27.6 and no further,
    // because this one initiates from 14 m and the coyote does not. The purse pays 35-135 marks.
    maxHealth: 26, attackLevel: 14, defenceLevel: 9,
    accuracy: 14, armour: 26, magicArmour: 24,
    maxHit: 6, attackSpeedMs: 2400, aggroRadius: 14, moveSpeedMps: 3.6, walkSpeedMps: 0.9, behaviour: "aggressive",
    marks: purseMarksFor(5),
    drops: [
      { itemId: "bramble_hide", quantity: [1, 2], chance: 0.35 },
      { itemId: "corven_ore", quantity: [1, 2], chance: 0.25 },
      { itemId: "earth_essence", quantity: [1, 2], chance: 0.15 },
      { itemId: "corven_boots", quantity: [1, 1], chance: 0.03 },
    ],
  },
  {
    id: "rootheart_t5", name: "Rootbound Colossus", family: "rootheart", tier: 5,
    // Same 2.1 m/s and the same reason as the Tempest Roc: one rig, one walk cycle, one honest gait.
    // Vellenwood's region boss. High physical armour favours the Earth Orb it guards once the
    // player has earned that progression reward.
    maxHealth: 140, attackLevel: 18, defenceLevel: 14,
    accuracy: 16, armour: 48, magicArmour: 32,
    maxHit: 9, attackSpeedMs: 3000, aggroRadius: 22, moveSpeedMps: 2.11, walkSpeedMps: 0.72, behaviour: "territorial",
    marks: [350, 550],
    drops: [
      { itemId: "earth_orb", quantity: [1, 1], chance: 1.00 },
      { itemId: "duskoak_log", quantity: [3, 6], chance: 1.00 },
      { itemId: "vell_amber", quantity: [2, 3], chance: 0.75 },
      { itemId: "bramble_hide", quantity: [1, 2], chance: 0.60 },
    ],
  },

  // ---------------------------------------------------------------- Karrowmoor, tier 10
  {
    id: "bear_t10", name: "Brown Bear", family: "bear", tier: 10,
    // Carries PRD 2.4's Cairnwight row verbatim: defenceLevel 11 / armour 55 is what makes "Melee
    // 12 with a Kaldite sword, 46%, max hit 11, 33 s" true, and magicArmour 10 against that armour
    // 55 is the reason the magic gate in the same section works - Voltrend at Magic 10 kills this
    // in 24.0 s against melee's 32.7, so MAGIC WINS by 27%. Aggressive at 10 m and the largest
    // silhouette on the moor.
    maxHealth: 38, attackLevel: 18, defenceLevel: 11,
    accuracy: 16, armour: 55, magicArmour: 10,
    maxHit: 7, attackSpeedMs: 2400, aggroRadius: 10, moveSpeedMps: 3.06, walkSpeedMps: 0.74, behaviour: "aggressive",
    marks: marksFor(10),
    drops: [
      { itemId: "cairn_pelt", quantity: [1, 1], chance: 0.45 },
      { itemId: "raw_haunch", quantity: [1, 2], chance: 0.45 },
      { itemId: "bear_claw", quantity: [1, 2], chance: 0.28 },
      { itemId: "kaldite_ore", quantity: [1, 2], chance: 0.18 },
      { itemId: "cairn_garnet", quantity: [1, 1], chance: 0.08 },
    ],
  },
  {
    id: "boar_t10", name: "Wild Boar", family: "boar", tier: 10,
    // The other half of PRD 2.4's magic gate, and the block the PRD's own number could not support.
    // defenceLevel 11 / armour 30 is solved from "Melee 12 with a Kaldite sword, 51%, 11, 27 s".
    // magicArmour is 115, not the +40 the PRD quotes: hit chance saturates, so with a magic attack
    // roll R the best possible time-to-kill ratio between this and the bear is (R + 20*1.40)/
    // (R + 20*1.10), which caps at 1.27 even as R goes to 0, while the PRD needs at least 1.257
    // AFTER the 34/38 health ratio - that needs R below 1.4, and R is 32.1. The two claims are only
    // simultaneously satisfiable if this block's magic resistance is far higher. At 115 the staff
    // takes 29.8 s against melee's 26.8, so MELEE WINS by 10% and both halves of the gate hold.
    // A mud-caked bristle hide over stone dust is what that number reads as on an animal.
    maxHealth: 34, attackLevel: 16, defenceLevel: 11,
    accuracy: 14, armour: 30, magicArmour: 115,
    maxHit: 6, attackSpeedMs: 2400, aggroRadius: 8, moveSpeedMps: 1.5, walkSpeedMps: 0.67, behaviour: "aggressive",
    marks: marksFor(10),
    drops: [
      { itemId: "cairn_pelt", quantity: [1, 1], chance: 0.40 },
      { itemId: "raw_haunch", quantity: [1, 2], chance: 0.40 },
      { itemId: "curved_tusk", quantity: [1, 1], chance: 0.25 },
      { itemId: "boar_bristle", quantity: [1, 3], chance: 0.25 },
      { itemId: "kaldite_ore", quantity: [1, 2], chance: 0.15 },
    ],
  },
  {
    id: "ibex_t10", name: "Ibex", family: "ibex", tier: 10,
    // The biggest ordinary health pool on the surface at 44, and the block that punishes standing
    // still: max hit 8 at 3000 ms off armour 40 / magicArmour 30. Symmetric resistances on purpose,
    // because the bear and the boar between them already own both lopsided answers at this tier, so
    // the ibex is the one you simply have to out-fight. Territorial at 11 m on the ridge line.
    maxHealth: 44, attackLevel: 20, defenceLevel: 12,
    accuracy: 18, armour: 40, magicArmour: 30,
    maxHit: 8, attackSpeedMs: 3000, aggroRadius: 11, moveSpeedMps: 2.26, walkSpeedMps: 0.6, behaviour: "territorial",
    marks: marksFor(10),
    drops: [
      { itemId: "cairn_pelt", quantity: [1, 2], chance: 0.50 },
      { itemId: "ibex_horn", quantity: [1, 1], chance: 0.28 },
      { itemId: "raw_haunch", quantity: [1, 2], chance: 0.35 },
      { itemId: "cairnpine_log", quantity: [1, 2], chance: 0.15 },
      { itemId: "cairn_garnet", quantity: [1, 1], chance: 0.10 },
    ],
  },
  {
    id: "aurochs_t10", name: "Aurochs", family: "aurochs", tier: 10,
    // The highest armour in the game at 78, against magicArmour 0 - the widest split anywhere, and
    // the tier 10 restatement of the Redsill cow it is descended from. 3600 ms and max hit 11 make
    // it the single hardest blow outside the boss. Territorial at 6 m, which is what keeps a herd of
    // them walkable.
    maxHealth: 46, attackLevel: 20, defenceLevel: 13,
    accuracy: 14, armour: 78, magicArmour: 0,
    maxHit: 11, attackSpeedMs: 3600, aggroRadius: 6, moveSpeedMps: 2.64, walkSpeedMps: 0.51, behaviour: "territorial",
    marks: marksFor(10),
    drops: [
      { itemId: "cairn_pelt", quantity: [1, 2], chance: 0.55 },
      { itemId: "raw_haunch", quantity: [1, 3], chance: 0.50 },
      { itemId: "aurochs_horn", quantity: [1, 1], chance: 0.25 },
      { itemId: "march_stone", quantity: [2, 5], chance: 0.25 },
      { itemId: "cairn_garnet", quantity: [1, 1], chance: 0.10 },
    ],
  },
  {
    id: "reaver_t10", name: "Highland Bandit", family: "reaver", tier: 10,
    // The last quarry crew, still armed. Armour 42 / magicArmour 40 keeps the family symmetric at
    // the top tier, and 40 health puts it between the Highcairn Bear (38) and the Ridge Ibex (44)
    // rather than beyond either. Aggro 14 makes it the thing that finds you on the moor road, so its
    // cost is capped at the bear's: 34.6 s and 31.8 of 41 health at Melee 12 in a Kaldite
    // sword, against the Cairnwight's 32.7 s and 27.9.
    maxHealth: 40, attackLevel: 22, defenceLevel: 13,
    accuracy: 18, armour: 42, magicArmour: 40,
    maxHit: 7, attackSpeedMs: 2400, aggroRadius: 14, moveSpeedMps: 3.9, walkSpeedMps: 0.9, behaviour: "aggressive",
    marks: purseMarksFor(10),
    drops: [
      { itemId: "cairn_pelt", quantity: [1, 1], chance: 0.30 },
      { itemId: "kaldite_ore", quantity: [1, 3], chance: 0.30 },
      { itemId: "water_essence", quantity: [1, 3], chance: 0.20 },
      { itemId: "kaldite_dagger", quantity: [1, 1], chance: 0.03 },
    ],
  },
  {
    id: "coyote_t10", name: "Dire Wolf", family: "coyote", tier: 10,
    // The family's second tier, and the only tier 10 block that swings faster than 2400 ms. 1800 ms
    // is three combat ticks, so it lands four swings for every three of anything else on the moor:
    // 1.206 dmg/s through a Melee 12 Kaldite kit, the highest on the surface, off the LOWEST tier 10
    // armour (20) and magicArmour (12). It dies fast and hurts while it lives - 23.3 s and 28.0 of
    // 41 health, where the bear is 32.7 s and 27.9.
    maxHealth: 30, attackLevel: 21, defenceLevel: 12,
    accuracy: 18, armour: 20, magicArmour: 12,
    maxHit: 7, attackSpeedMs: 1800, aggroRadius: 12, moveSpeedMps: 2.79, walkSpeedMps: 0.68, behaviour: "aggressive",
    marks: marksFor(10),
    drops: [
      { itemId: "cairn_pelt", quantity: [1, 1], chance: 0.35 },
      { itemId: "coyote_fang", quantity: [1, 3], chance: 0.35 },
      { itemId: "raw_haunch", quantity: [1, 1], chance: 0.30 },
      { itemId: "cragfin", quantity: [1, 2], chance: 0.25 },
      { itemId: "cairn_garnet", quantity: [1, 1], chance: 0.06 },
    ],
  },

  // ---------------------------------------------------------------- Gravelmaw, tier 10
  {
    id: "rat_t10", name: "Giant Rat", family: "rat", tier: 10,
    // Underground, nothing is armoured and everything is quick. 1800 ms off armour 12 makes this
    // the fastest, softest tier 10 block in the game: it is the first thing in the dungeon and it
    // is meant to be survivable while telling you the cadence down here is different.
    maxHealth: 26, attackLevel: 18, defenceLevel: 10,
    accuracy: 16, armour: 12, magicArmour: 12,
    maxHit: 5, attackSpeedMs: 1800, aggroRadius: 10, moveSpeedMps: 1.5, walkSpeedMps: 0.6, behaviour: "aggressive",
    marks: marksFor(10),
    drops: [
      { itemId: "rat_tail", quantity: [1, 3], chance: 0.55 },
      { itemId: "cairn_pelt", quantity: [1, 1], chance: 0.25 },
      { itemId: "raw_haunch", quantity: [1, 1], chance: 0.20 },
      { itemId: "kaldite_ore", quantity: [1, 2], chance: 0.15 },
    ],
  },
  {
    id: "scorpion_t10", name: "Giant Scorpion", family: "scorpion", tier: 10,
    // The armoured scuttler, and the only block in the game with high armour AND high magicArmour
    // (45 / 60). Nothing answers a scorpion cheaply; you pay for it in time whichever hand you
    // fight with. That is the correct shape for the middle of a dungeon, where a player has already
    // committed and cannot re-kit.
    maxHealth: 32, attackLevel: 17, defenceLevel: 11,
    accuracy: 14, armour: 45, magicArmour: 60,
    maxHit: 6, attackSpeedMs: 2400, aggroRadius: 8, moveSpeedMps: 1.2, walkSpeedMps: 0.5, behaviour: "aggressive",
    marks: marksFor(10),
    drops: [
      { itemId: "scorpion_stinger", quantity: [1, 2], chance: 0.40 },
      { itemId: "venom_gland", quantity: [1, 2], chance: 0.30 },
      { itemId: "cairn_pelt", quantity: [1, 1], chance: 0.20 },
      { itemId: "cairn_garnet", quantity: [1, 1], chance: 0.10 },
    ],
  },
  {
    id: "crab_t10", name: "Giant Crab", family: "crab", tier: 10,
    // The dungeon's bulwark: armour 82 against magicArmour 0, one point of armour above the
    // Terrace Aurochs and the highest in the game. 3600 ms and max hit 10. In the flooded lower
    // chamber this is the block that says "bring the staff you left in the bank".
    maxHealth: 42, attackLevel: 19, defenceLevel: 13,
    accuracy: 12, armour: 82, magicArmour: 0,
    maxHit: 10, attackSpeedMs: 3600, aggroRadius: 6, moveSpeedMps: 1.3, walkSpeedMps: 0.5, behaviour: "territorial",
    marks: marksFor(10),
    drops: [
      { itemId: "crab_claw", quantity: [1, 1], chance: 0.45 },
      { itemId: "raw_haunch", quantity: [1, 2], chance: 0.35 },
      { itemId: "cragfin", quantity: [1, 3], chance: 0.30 },
      { itemId: "cairn_garnet", quantity: [1, 1], chance: 0.10 },
    ],
  },
  // ---------------------------------------------------------------- Kilnhalt, tier 20
  // Solved against the tier-20 kits in equipment.ts (kit accuracy 75, sword power 45 -> attack
  // roll 50.75, maxHit 17; magic kit magicAccuracy 75 / magicPower 50 -> Emberlash attack roll
  // 58.4, maxHit 20). Every ordinary row lands in the amendment's 25-40 s on-tier band, and the
  // bear/boar pair restates the Karrowmoor style gate at tier 20: the Ashback answers to a staff
  // in 27.6 s against melee's 36.5, the Cinder Boar answers to a sword in 29.1 against magic's 34.9.
  {
    id: "bear_t20", name: "Dire Bear", family: "bear", tier: 20,
    // The staff answer, one tier up: armour 110 against magicArmour 15. Melee 20 in the full
    // Emberite kit takes 36.5 s; Emberlash in the Charhide kit takes 27.6 s. MAGIC WINS by 24%.
    maxHealth: 60, attackLevel: 26, defenceLevel: 22,
    accuracy: 20, armour: 110, magicArmour: 15,
    maxHit: 10, attackSpeedMs: 2400, aggroRadius: 10, moveSpeedMps: 3.06, walkSpeedMps: 0.74, behaviour: "aggressive",
    marks: marksFor(20),
    drops: [
      { itemId: "charhide", quantity: [1, 1], chance: 0.50 },
      { itemId: "raw_ember_haunch", quantity: [1, 2], chance: 0.45 },
      { itemId: "ashback_claw", quantity: [1, 2], chance: 0.28 },
      { itemId: "emberite_ore", quantity: [1, 2], chance: 0.18 },
      { itemId: "fire_opal", quantity: [1, 1], chance: 0.08 },
    ],
  },
  {
    id: "boar_t20", name: "Dire Boar", family: "boar", tier: 20,
    // The sword answer: magicArmour 130 continues the Scree Boar's mud-caked rule at tier 20.
    // Melee takes 29.1 s, the staff 34.9 s. MELEE WINS by 17%.
    maxHealth: 56, attackLevel: 24, defenceLevel: 21,
    accuracy: 18, armour: 60, magicArmour: 130,
    maxHit: 9, attackSpeedMs: 2400, aggroRadius: 8, moveSpeedMps: 1.5, walkSpeedMps: 0.67, behaviour: "aggressive",
    marks: marksFor(20),
    drops: [
      { itemId: "charhide", quantity: [1, 1], chance: 0.45 },
      { itemId: "raw_ember_haunch", quantity: [1, 2], chance: 0.40 },
      { itemId: "cinder_tusk", quantity: [1, 1], chance: 0.25 },
      { itemId: "emberite_ore", quantity: [1, 2], chance: 0.15 },
    ],
  },
  {
    id: "ibex_t20", name: "Large Ibex", family: "ibex", tier: 20,
    // The out-fight-it block, as at tier 10: near-symmetric 80/60 with the biggest ordinary
    // health pool in the region. 35.3 s at Melee 20; neither style shortcuts it.
    maxHealth: 62, attackLevel: 27, defenceLevel: 23,
    accuracy: 22, armour: 80, magicArmour: 60,
    maxHit: 11, attackSpeedMs: 3000, aggroRadius: 11, moveSpeedMps: 2.26, walkSpeedMps: 0.6, behaviour: "territorial",
    marks: marksFor(20),
    drops: [
      { itemId: "charhide", quantity: [1, 2], chance: 0.50 },
      { itemId: "emberhorn", quantity: [1, 1], chance: 0.28 },
      { itemId: "raw_ember_haunch", quantity: [1, 2], chance: 0.35 },
      { itemId: "cinderpine_log", quantity: [1, 2], chance: 0.15 },
      { itemId: "fire_opal", quantity: [1, 1], chance: 0.10 },
    ],
  },
  {
    id: "viper_t20", name: "Giant Viper", family: "viper", tier: 20,
    // The family's glass cannon, kept honest at the fast end of the band: 25.7 s at Melee 20,
    // and maxHit 14 at 3000 ms is the hardest ordinary blow in Kilnhalt when it lands.
    maxHealth: 58, attackLevel: 30, defenceLevel: 18,
    accuracy: 26, armour: 25, magicArmour: 75,
    maxHit: 14, attackSpeedMs: 3000, aggroRadius: 8, moveSpeedMps: 1.2, walkSpeedMps: 0.5, behaviour: "territorial",
    marks: marksFor(20),
    drops: [
      { itemId: "kiln_fang", quantity: [1, 2], chance: 0.40 },
      { itemId: "venom_gland", quantity: [1, 2], chance: 0.25 },
      { itemId: "charhide", quantity: [1, 1], chance: 0.20 },
      { itemId: "fire_essence", quantity: [1, 2], chance: 0.12 },
    ],
  },
  {
    id: "reaver_t20", name: "Quarry Bandit", family: "reaver", tier: 20,
    // The family rule holds at tier 20: symmetric 62/60, aggro 14, and a pursuit at 4.05 m/s -
    // still under the player's 4.2, and the closest any reaver comes. 31.2 s at Melee 20, purse
    // pays 140-540 marks.
    maxHealth: 58, attackLevel: 28, defenceLevel: 23,
    accuracy: 22, armour: 62, magicArmour: 60,
    maxHit: 10, attackSpeedMs: 2400, aggroRadius: 14, moveSpeedMps: 4.05, walkSpeedMps: 0.9, behaviour: "aggressive",
    marks: purseMarksFor(20),
    drops: [
      { itemId: "charhide", quantity: [1, 1], chance: 0.30 },
      { itemId: "emberite_ore", quantity: [1, 3], chance: 0.30 },
      { itemId: "fire_essence", quantity: [1, 3], chance: 0.20 },
      { itemId: "emberite_boots", quantity: [1, 1], chance: 0.03 },
    ],
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
    id: "galeskin_t1", name: "Plains Ogre", family: "galeskin", tier: 1,
    // Sized between the road reavers and the Tempest Roc: a fight a tier-1 player chooses, long
    // but survivable, and territorial so the choice is real.
    maxHealth: 50, attackLevel: 8, defenceLevel: 6,
    accuracy: 8, armour: 14, magicArmour: 14,
    maxHit: 5, attackSpeedMs: 3000, aggroRadius: 16, moveSpeedMps: 2.0, walkSpeedMps: 0.82, behaviour: "territorial",
    marks: [40, 90],
    drops: [
      { itemId: "galeskin_sword", quantity: [1, 1], chance: 0.10 },
      { itemId: "galeskin_staff", quantity: [1, 1], chance: 0.10 },
      { itemId: "air_essence", quantity: [2, 5], chance: 0.50 },
      { itemId: "pale_quartz", quantity: [1, 2], chance: 0.50 },
      { itemId: "coarse_hide", quantity: [1, 2], chance: 0.40 },
    ],
  },
  {
    id: "mossbound_t5", name: "Forest Ogre", family: "mossbound", tier: 5,
    maxHealth: 95, attackLevel: 14, defenceLevel: 10,
    accuracy: 12, armour: 34, magicArmour: 30,
    maxHit: 7, attackSpeedMs: 3000, aggroRadius: 16, moveSpeedMps: 2.0, walkSpeedMps: 0.82, behaviour: "territorial",
    marks: [180, 320],
    drops: [
      { itemId: "mossbound_sword", quantity: [1, 1], chance: 0.10 },
      { itemId: "mossbound_staff", quantity: [1, 1], chance: 0.10 },
      { itemId: "earth_essence", quantity: [2, 5], chance: 0.50 },
      { itemId: "vell_amber", quantity: [1, 2], chance: 0.50 },
      { itemId: "duskoak_log", quantity: [2, 4], chance: 0.40 },
    ],
  },
  {
    id: "tideworn_t10", name: "Cave Ogre", family: "tideworn", tier: 10,
    maxHealth: 140, attackLevel: 20, defenceLevel: 14,
    accuracy: 16, armour: 50, magicArmour: 40,
    maxHit: 9, attackSpeedMs: 3000, aggroRadius: 18, moveSpeedMps: 2.0, walkSpeedMps: 0.82, behaviour: "territorial",
    marks: [450, 750],
    drops: [
      { itemId: "tideworn_sword", quantity: [1, 1], chance: 0.10 },
      { itemId: "tideworn_staff", quantity: [1, 1], chance: 0.10 },
      { itemId: "water_essence", quantity: [2, 5], chance: 0.50 },
      { itemId: "cairn_garnet", quantity: [1, 2], chance: 0.50 },
      { itemId: "kaldite_ore", quantity: [1, 3], chance: 0.40 },
    ],
  },
  {
    id: "cinderwake_t20", name: "Fire Ogre", family: "cinderwake", tier: 20,
    // Kilnhalt's arena fight and the Fire Orb's keeper. 260 health at Melee 20 in the Emberite
    // kit runs about 149 s and roughly 187 incoming damage - a boss you can lose, exactly like
    // Ordrun. The Orb drop is 100% and singleton: once it is owned or consumed, the shared
    // duplicate-Orb suppression in the loot path withholds later copies.
    maxHealth: 260, attackLevel: 32, defenceLevel: 24,
    accuracy: 22, armour: 78, magicArmour: 45,
    maxHit: 15, attackSpeedMs: 3000, aggroRadius: 22, moveSpeedMps: 2.0, walkSpeedMps: 0.82, behaviour: "territorial",
    marks: [1800, 2800],
    drops: [
      { itemId: "fire_orb", quantity: [1, 1], chance: 1.00 },
      { itemId: "cinderwake_sword", quantity: [1, 1], chance: 0.10 },
      { itemId: "cinderwake_staff", quantity: [1, 1], chance: 0.10 },
      { itemId: "emberite_bar", quantity: [1, 3], chance: 1.00 },
      { itemId: "fire_opal", quantity: [1, 3], chance: 0.75 },
      { itemId: "charhide", quantity: [1, 2], chance: 0.60 },
    ],
  },

  // ---------------------------------------------------------------- Gravelmaw boss
  {
    id: "quarrykeeper_t10", name: "Quarry Warden", family: "quarrykeeper", tier: 10,
    // Same 2.1 m/s as the other two orb bosses. He is heavier than anything else on the floor and
    // reads that way; the arena is 24 m across, so this is not a fight anyone outruns by accident.
    // 200 HP and magicArmour 18 are given. defenceLevel 20 / armour 62 are solved from the 45%
    // row; attackLevel 24 / accuracy 15 / maxHit 12 at 3.0 s are solved from "about 1.02 damage/s
    // through tier 10 armour". 165 s x 1.020 = 168 damage against a 75 health pool: a boss you
    // can lose, which PRD 2.4 says is the point.
    maxHealth: 200, attackLevel: 24, defenceLevel: 20,
    accuracy: 15, armour: 62, magicArmour: 18,
    maxHit: 12, attackSpeedMs: 3000, aggroRadius: 24, moveSpeedMps: 2.11, walkSpeedMps: 0.72, behaviour: "territorial",
    marks: [900, 1400],
    drops: [
      { itemId: "water_orb", quantity: [1, 1], chance: 1.00 },
      // PRD 2.10: "900 to 1,400 plus a guaranteed Kaldite piece".
      { itemId: "kaldite_sword", quantity: [1, 1], chance: 1.00 },
      { itemId: "kaldite_bar", quantity: [3, 6], chance: 1.00 },
      { itemId: "cairn_garnet", quantity: [2, 4], chance: 1.00 },
      { itemId: "cairn_pelt", quantity: [1, 2], chance: 0.75 },
    ],
  },
];

/**
 * Ordrun's two phases. `EnemyDef` is frozen and carries no phase field, so `systems/combat.ts`
 * imports this directly. PRD section 0 caps Phase 1 at two phases and one telegraphed ground slam.
 *
 * Phase 2 starts at 55% health per `content/regions.ts`. The armour drop is what makes the second
 * half winnable at the same DPS the first half establishes: at Melee 18 in the tier 10 kit, the
 * hit chance goes from 44.9% to 49.5%, which roughly cancels the faster swing.
 */
export interface BossPhase {
  /** Enter this phase when health/maxHealth falls to or below this fraction. */
  atHealthFraction: number;
  armour: number;
  attackSpeedMs: number;
  maxHit: number;
  telegraphId?: string;
  telegraphWindupMs?: number;
  telegraphRadiusM?: number;
}

const REGIONAL_BOSS_BLOCKS = new Map(Object.entries(REGIONAL_BOSS_LEVELS).map(([id, target]) => {
  const canonicalId = id === 'ordrun' ? 'quarrykeeper_t10' : `${id}_t${target.tier}`;
  const base = BLOCKS.find(row => row.id === canonicalId);
  if (!base) throw new Error(`Missing saved regional boss ${canonicalId}`);
  return [canonicalId, tuneEnemyCombatLevel(base, target.tier * target.multiplier, target.tier)] as const;
}));
const balancedOrdrun = REGIONAL_BOSS_BLOCKS.get('quarrykeeper_t10')!;

export const ORDRUN_PHASES: readonly BossPhase[] = [
  { atHealthFraction: 1.00, armour: balancedOrdrun.armour, attackSpeedMs: 3000, maxHit: balancedOrdrun.maxHit },
  {
    atHealthFraction: 0.55, armour: Math.round(balancedOrdrun.armour * 50 / 62), attackSpeedMs: 2400,
    maxHit: Math.round(balancedOrdrun.maxHit * 14 / 12),
    telegraphId: "ground_slam", telegraphWindupMs: 1800, telegraphRadiusM: 6.0,
  },
];

/**
 * `content/regions.ts` group id -> stat block id. Every enemy group in the three regions and the
 * dungeon appears here, so a combat system can resolve straight off `meta.groupId`.
 */
const GROUP_BLOCK: readonly (readonly [string, string])[] = [
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
  ["ordrun", "quarrykeeper_t10"],
];

const FANTASY_SPECIES = [...FOREST_CREATURE_REDESIGNS, ...STONE_CREATURE_REDESIGNS, ...ASH_CREATURE_REDESIGNS];
const FANTASY_SPECIES_BY_ID = new Map(FANTASY_SPECIES.map(species => [species.id, species]));

/** New roaming populations have a canonical block at each world tier. Authored old encounters
 * use the original balance below, so a visual revision never retunes their fights or rewards. */
export const FANTASY_TIER_BLOCKS: readonly EnemyDef[] = FANTASY_SPECIES.flatMap(species =>
  [1, 5, 10, 20].map(tier => {
    const base = species.stats;
    if (tier === base.tier) return base;
    const ratio = tier / base.tier;
    const scaled = (value: number, minimum = 0) => Math.max(minimum, Math.round(value * ratio));
    return { ...base, id: enemyIdFor(base.family, tier), tier,
      maxHealth: scaled(base.maxHealth, 1), attackLevel: scaled(base.attackLevel, 1),
      defenceLevel: scaled(base.defenceLevel, 1), accuracy: scaled(base.accuracy),
      armour: scaled(base.armour), magicArmour: scaled(base.magicArmour), maxHit: scaled(base.maxHit, 1),
      marks: base.marks ? [scaled(base.marks[0]), scaled(base.marks[1])] as [number, number] : undefined };
  }));

/** Saved hunts may refer to either the original body or the first fantasy replacement. These
 * IDs are historical data; never derive them from the current world roster. */
export const FANTASY_ENCOUNTER_LINEAGE: Readonly<Record<string, readonly [originalBlockId: string, previousBlockId: string]>> = {
  palewood_adders: ['viper_t1', 'goblin_scout_t1'],
  regional_gloam_fox: ['gloam_fox_t1', 'goblin_shaman_t5'],
  regional_redbrush_fox: ['redbrush_fox_t1', 'goblin_archer_t1'],
  pack_fallowmarch_palewood_far_south_scrub: ['field_wasp_t1', 'goblin_scout_t1'],
  pack_fallowmarch_palewood_heath_scrub: ['heath_wasp_t1', 'goblin_archer_t1'],
  pack_fallowmarch_palewood_reed_scrub: ['reed_wasp_t1', 'goblin_scout_t1'],
  pack_fallowmarch_bracken_northeast_spiders: ['briar_spider_t1', 'briar_spider_t1'],
  marchwild_horse_residents: ['marchwild_horse_t5', 'beetle_golem_t10'],
  duskoak_stags: ['deer_t5', 'mossback_sentinel_t10'],
  bramble_hogs: ['hog_t5', 'beetle_golem_t10'],
  deepwood_coyotes: ['coyote_t5', 'goblin_shaman_t5'],
  blackwater_frogs: ['frog_t5', 'marsh_wasp_t5'],
  rootfall_coneys: ['coney_t5', 'webweaver_spider_t5'],
  thornline_adders: ['viper_t5', 'webweaver_spider_t5'],
  pack_vellenwood_marchgate_south_bramble: ['moonweave_spider_t5', 'webweaver_spider_t5'],
  pack_vellenwood_mossbound_west_bramble: ['webweaver_spider_t5', 'webweaver_spider_t5'],
  duskoak_lynx_residents: ['duskoak_lynx_t5', 'beetle_golem_t10'],
  rootdelve_badger_residents: ['rootdelve_badger_t5', 'mossback_sentinel_t10'],
  marsh_moose_residents: ['marsh_moose_t10', 'mossback_sentinel_t10'],
  bracken_tapir_residents: ['bracken_tapir_t5', 'beetle_golem_t10'],
  blackwater_heron_residents: ['blackwater_heron_t5', 'marsh_wasp_t5'],
  quarry_snail_residents: ['quarry_snail_t5', 'webweaver_spider_t5'],
  hollowroot_spider_residents: ['hollowroot_spider_t5', 'hollowroot_spider_t5'],
  highcairn_bears: ['bear_t10', 'shale_elemental_t10'],
  scree_boars: ['boar_t10', 'stone_golem_t10'],
  ridge_ibex: ['ibex_t10', 'chalk_warden_t10'],
  terrace_aurochs: ['aurochs_t10', 'iron_golem_t20'],
  tarn_coyotes: ['coyote_t10', 'shale_elemental_t10'],
  pack_karrowmoor_tarn_track_east_mandibles: ['rimeback_tortoise_t10', 'chalk_warden_t10'],
  pack_karrowmoor_moor_road_far_west_watch: ['slateback_tortoise_t10', 'stone_golem_t10'],
  quillback_porcupine_residents: ['quillback_porcupine_t10', 'chalk_warden_t10'],
  cairn_bighorn_residents: ['cairn_bighorn_t10', 'shale_elemental_t10'],
  reedjaw_crocodile_residents: ['reedjaw_crocodile_t10', 'beetle_golem_t10'],
  slateback_tortoise_residents: ['slateback_tortoise_t10', 'stone_golem_t10'],
  scree_bustard_residents: ['scree_bustard_t10', 'chalk_warden_t10'],
  antler_beetle_residents: ['antler_beetle_t10', 'beetle_golem_t10'],
  quarry_nightmare_residents: ['quarry_nightmare_t10', 'quarry_nightmare_t10'],
  gravelmaw_ch1_rats: ['rat_t10', 'skeleton_soldier_t5'],
  gravelmaw_ch2_scorpions: ['scorpion_t10', 'webweaver_spider_t5'],
  gravelmaw_ch2_crabs: ['crab_t10', 'beetle_golem_t10'],
  gravelmaw_ch3_bears: ['bear_t10', 'stone_golem_t10'],
  gravelmaw_amethyst_spiders: ['amethyst_spider_t5', 'webweaver_spider_t5'],
  ashback_bears: ['bear_t20', 'lava_golem_t10'],
  cinder_boars: ['boar_t20', 'fire_golem_t20'],
  emberhorn_ibex: ['ibex_t20', 'revenant_t20'],
  cinder_adders: ['viper_t20', 'skeleton_mage_t20'],
  pack_kilnhalt_clinker_southern_approach_west: ['cindercrest_salamander_t20', 'lava_golem_t10'],
  pack_kilnhalt_cinderpine_northwest_outer: ['kiln_salamander_t20', 'fire_golem_t20'],
  kiln_salamander_residents: ['kiln_salamander_t20', 'lava_golem_t10'],
  ashscale_monitor_residents: ['ashscale_monitor_t20', 'revenant_t20'],
  slag_centipede_residents: ['slag_centipede_t20', 'fire_golem_t20'],
  cinder_ravager_residents: ['cinder_ravager_t20', 'cinder_ravager_t20'],
  basalt_drake_residents: ['basalt_drake_t20', 'basalt_drake_t20'],
  gorge_mantis_residents: ['gorge_mantis_t20', 'gorge_mantis_t20'],
};

/** Compatibility is directional and limited to this encounter's own recorded predecessors.
 * The hunt caller still checks region, real death, player credit and kill serial. */
export function huntEnemyDefMatches(requestedId: string, currentId: string): boolean {
  return requestedId === currentId || FANTASY_ENCOUNTER_LINEAGE[currentId]?.includes(requestedId) === true;
}

// Root may also register the native redesign species in CREATURE_SPECIES. The canonical catalogue
// contains each ID once, including those native-tier rows and their three other tier versions.
const ALL_BLOCKS: readonly EnemyDef[] = [...new Map([
  ...BLOCKS.map(row => REGIONAL_BOSS_BLOCKS.get(row.id) ?? row),
  ...CREATURE_SPECIES.map(species => species.stats), ...RPG_BESTIARY.map(species => species.stats),
  ...FANTASY_TIER_BLOCKS,
].map(row => [row.id, row] as const)).values()];
const BY_BLOCK_ID = new Map(ALL_BLOCKS.map((row) => [row.id, row] as const));

const GROUP_ALIASES: readonly EnemyDef[] = GROUP_BLOCK.flatMap(([groupId, blockId]) => {
  if (Object.hasOwn(BIOME_POPULATION_LEGACY_REPLACEMENTS, groupId)) return [];
  const base = BY_BLOCK_ID.get(blockId);
  return base === undefined ? [] : [{ ...base, id: groupId }];
});

/** Preserve authored encounter balance and every source reward while the rig dictates movement. */
export const FANTASY_ENCOUNTER_BLOCKS: readonly EnemyDef[] = Object.entries(BIOME_POPULATION_LEGACY_REPLACEMENTS)
  .map(([groupId, speciesId]) => {
    const lineage = FANTASY_ENCOUNTER_LINEAGE[groupId];
    const original = lineage ? BY_BLOCK_ID.get(lineage[0]) : undefined;
    const species = FANTASY_SPECIES_BY_ID.get(speciesId);
    if (!original || !species) throw new Error(`Missing original stats or replacement creature for ${groupId}`);
    return { ...original, id: groupId, family: species.stats.family, name: species.stats.name,
      moveSpeedMps: species.stats.moveSpeedMps, walkSpeedMps: species.stats.walkSpeedMps };
  });

const PRE_WILDERNESS_BLOCKS = [...ALL_BLOCKS, ...GROUP_ALIASES, ...FANTASY_ENCOUNTER_BLOCKS];
const PRE_WILDERNESS_BY_ID = new Map(PRE_WILDERNESS_BLOCKS.map(row => [row.id, row]));
const WILDERNESS_BLOCKS = buildWildernessEnemyProgression([
  ...WILDERNESS_GROUPS,
  ...resolveBiomePopulation(CREATURE_SPECIES).filter(group =>
    BIOME_POPULATION.some(pack => pack.id === group.id && pack.regionId === 'wilderness')),
], (groupId, family, tier) => {
  const exact = PRE_WILDERNESS_BY_ID.get(groupId);
  return exact?.family === family ? exact : PRE_WILDERNESS_BY_ID.get(enemyIdFor(family, tier));
}, [...CREATURE_SPECIES, ...RPG_BESTIARY]);

export const ENEMIES: readonly EnemyDef[] = [...new Map([
  ...PRE_WILDERNESS_BLOCKS, ...WILDERNESS_BLOCKS,
].map(row => [row.id, row] as const)).values()];

/** Canonical stat blocks, without encounter aliases. For docs and the bestiary. */
export const ENEMY_BLOCKS: readonly EnemyDef[] = [...new Map([
  ...ALL_BLOCKS, ...WILDERNESS_BLOCKS.filter(row => row.id === enemyIdFor(row.family, row.tier)),
].map(row => [row.id, row] as const)).values()];

const BY_ANY_ID = new Map(ENEMIES.map((row) => [row.id, row] as const));

/**
 * The stat block behind an enemy group: by group id first, then by family and tier.
 *
 * Callers read this table DIRECTLY rather than through `content.enemy`. Combat stats are static
 * content, and routing them through the mutable registry made every consumer depend on
 * `content.register` having already run — which silently turned "no stat block yet" into "this
 * group has no stat block" for anything that builds a world before boot finishes, `buildWorld` in
 * a unit test most of all. The registry is still the right door for anything a save or a mod can
 * change; this is not that.
 */
export function enemyBlockFor(groupId: string, family: string, tier: number): EnemyDef | undefined {
  const group = BY_ANY_ID.get(groupId);
  // Source-gallery families still resolve their original canonical block. The production family
  // selects its stable encounter alias, including that encounter's authored balance and rewards.
  return group?.family === family ? group : BY_ANY_ID.get(enemyIdFor(family, tier)) ?? group;
}
