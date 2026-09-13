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
import {
  ENEMY_DATA, ENEMY_BLOCK_DATA, FANTASY_TIER_DATA, FANTASY_ENCOUNTER_DATA,
  ENCOUNTER_LINEAGE, enemyBlockById, registeredEnemyById,
} from './enemyData.js';

/** PRD 2.4: enemies leash at 28 m from their spawn point, at every tier. */
export const LEASH_RADIUS_M = 28;

/** Existing family/tier lookup convention; changing data never rewrites a saved block ID. */
export function enemyIdFor(family: string, tier: number): string {
  return `${family}_t${tier}`;
}

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

// Keep the original phase formulas, now reading the canonical JSON combat block.
const balancedOrdrun = enemyBlockById('quarrykeeper_t10');
export const ORDRUN_PHASES: readonly BossPhase[] = [
  { atHealthFraction: 1.00, armour: balancedOrdrun.armour, attackSpeedMs: 3000, maxHit: balancedOrdrun.maxHit },
  {
    atHealthFraction: 0.55, armour: Math.round(balancedOrdrun.armour * 50 / 62), attackSpeedMs: 2400,
    maxHit: Math.round(balancedOrdrun.maxHit * 14 / 12),
    telegraphId: "ground_slam", telegraphWindupMs: 1800, telegraphRadiusM: 6.0,
  },
];

export const ENEMIES: readonly EnemyDef[] = ENEMY_DATA;
export const ENEMY_BLOCKS: readonly EnemyDef[] = ENEMY_BLOCK_DATA;
export const FANTASY_TIER_BLOCKS: readonly EnemyDef[] = FANTASY_TIER_DATA;
export const FANTASY_ENCOUNTER_BLOCKS: readonly EnemyDef[] = FANTASY_ENCOUNTER_DATA;
export const FANTASY_ENCOUNTER_LINEAGE: Readonly<Record<string, readonly [string, string]>> = ENCOUNTER_LINEAGE;

/** Compatibility is directional and limited to this encounter's recorded predecessors. */
export function huntEnemyDefMatches(requestedId: string, currentId: string): boolean {
  return requestedId === currentId || FANTASY_ENCOUNTER_LINEAGE[currentId]?.includes(requestedId) === true;
}

/** Matching-family group first, then the canonical family/tier block, then the original group. */
export function enemyBlockFor(groupId: string, family: string, tier: number): EnemyDef | undefined {
  const group = registeredEnemyById(groupId);
  return group?.family === family ? group : registeredEnemyById(enemyIdFor(family, tier)) ?? group;
}
