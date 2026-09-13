/**
 * The equipment ladder: a full 9-slot kit at tiers 1, 5, 10 and 20, in two mechanically distinct
 * lines, plus the eight rare miniboss weapons derived from the craftable ladder.
 *
 * Owned by W-CONTENT. `items.ts` re-exports these rows inside `ALL_ITEMS`; nothing else should
 * import `EQUIPMENT` directly, because the registry only ever sees the concatenated table.
 *
 * ---------------------------------------------------------------------------------------------
 * THE ARITHMETIC (PRD 2.3 and 2.4). Every number below is derived, not guessed.
 *
 * Melee damage:  maxHit = floor(2 + (meleeLevel + gearPower) / 4.2)
 *
 *   Grithe dagger, Melee 1,  power  6 -> floor(2 +  7/4.2) = floor( 3.667) =  3   (PRD 2.4)
 *   Corven sword,  Melee 5,  power 14 -> floor(2 + 19/4.2) = floor( 6.524) =  6   (PRD 2.4)
 *   Kaldite sword, Melee 10, power 26 -> floor(2 + 36/4.2) = floor(10.571) = 10   (PRD 2.4)
 *
 *   The PRD's worked rows quote weapon-only gearPower, and its Ordrun row pins that reading:
 *   "Melee 18, tier 10 kit -> maxHit 12" needs floor(2 + (18 + P)/4.2) = 12, i.e. P in [24, 28.2).
 *   The Kaldite sword alone is 26. So ARMOUR CONTRIBUTES ZERO POWER at every tier; armour buys
 *   `armour`, `magicArmour` and `health`, and weapons buy `power` / `magicPower`. Keep it that
 *   way or the PRD's damage table stops reproducing.
 *
 *   Cross-checks that also fall out of the same numbers:
 *     Melee 3,  Grithe dagger  -> floor(2 +  9/4.2) =  4   (PRD TTK table)
 *     Melee 7,  Corven sword   -> floor(2 + 21/4.2) =  7   (PRD TTK table)
 *     Melee 12, Kaldite sword  -> floor(2 + 38/4.2) = 11   (PRD TTK table)
 *     Melee 18, Kaldite sword  -> floor(2 + 44/4.2) = 12   (PRD Ordrun row)
 *
 * Derived health: maxHealth = 20 + 3 * max(1, floor((melee + magic)/2)) + sum(health)
 *
 *   Full melee kit health totals are tuned to reproduce PRD 2.3 exactly:
 *     tier  1 kit = +6   -> Melee 10 / Magic  1: 20 + 3*5  +  6 = 41
 *     tier  5 kit = +14  -> Melee 12 / Magic  5: 20 + 3*8  + 14 = 58
 *     tier 10 kit = +16  -> Melee 18 / Magic  8: 20 + 3*13 + 16 = 75
 *   The tier 10 kit being only +2 health over tier 5 is the PRD's number, not a typo on our
 *   side; tier 10's real gain is +25 armour and +12 power. The 75 HP pool is load-bearing for the
 *   Ordrun fight budget in PRD 2.4, so do not "fix" it.
 *
 * Accuracy: attackRoll = (attackLevel + 9) * (1 + gearAccuracy/100) * styleFactor
 *           defenceRoll = (defenceLevel + 9) * (1 + defenderArmour/100)
 *           hitChance   = clamp(attackRoll / (attackRoll + defenceRoll), 0.05, 0.95)
 *
 *   Weapon accuracy values are solved from the PRD's hit-chance column; see `enemies.ts` for the
 *   matching defender stat blocks and the full solved TTK table. The defender names below are the
 *   PRD's own, from before the bestiary became animals; each row's stat block now belongs to the
 *   animal named after it, and the arithmetic is unchanged because the numbers were inherited whole.
 *     Grithe dagger  acc  +6: Melee 3 vs Rill Skitterling  -> 12*1.06 / (12*1.06 + 10)   = 56%  (now Redsill Frog)
 *     Corven sword   acc +14: Melee 7 vs Thornbound Husk   -> 16*1.14 / (16*1.14 + 17.6) = 51%  (now Duskoak Stag)
 *     Kaldite sword  acc +28: Melee 12 vs Scree Skitterling-> 21*1.28 / (21*1.28 + 26.0) = 51%  (now Scree Boar)
 *                             Melee 12 vs Cairnwight       -> 21*1.28 / (21*1.28 + 31.0) = 46%  (now Highcairn Bear)
 *
 *   Full-kit accuracy totals: 11 (t1) / 23 (t5) / 42 (t10). The t10 total is solved from the
 *   Ordrun row: 27 * 1.42 = 38.34 against Ordrun's 29 * 1.62 = 46.98 gives 45%.
 *
 *   Full-kit armour totals: 16 (t1) / 33 (t5) / 58 (t10). The t10 total is solved from "Ordrun
 *   deals about 1.02 damage/s through tier 10 armour": 27 * 1.58 = 42.66 defence roll.
 *
 * Magic damage: maxHit = floor(spell.baseMax + (magicLevel + gearMagicPower) / spell.divisor)
 *
 *   The tier 10 magic kit is solved from PRD 2.4's headline claim, "at Magic 10 with a Kaldite
 *   staff, the Magic 10 water lash kills a Cairnwight in 24 s where a Kaldite sword at Melee 12
 *   takes 33 s:
 *     magicPower    +32 -> Rimewash maxHit = floor(8 + (10 + 32)/6) = 15, average hit 8.0
 *     magicAccuracy +47 -> attackRoll = (10 + 9) * 1.15 * 1.47 = 32.12
 *     Cairnwight magic defence = (11 + 9) * 1.10 = 22.00 -> hitChance = 0.5935
 *     dps = 0.5935 * 8.0 / 3.0 s = 1.583 -> 38 HP / 1.583 = 24.0 s.  MATCHES.
 *   Tier 1 and tier 5 staffs carry enough extra power to produce a larger max-hit read than the
 *   matching wand. That per-cast gap is the price for the wand's faster 2.2-second cadence.
 * ---------------------------------------------------------------------------------------------
 */
import type { ItemDef } from "../contracts.js";
import { itemRows } from "./itemData.js";
import { ITEM_SOURCE_VIEWS } from "./schema/itemRecords.js";

export const MAGIC_ORBS: readonly ItemDef[] = itemRows("MAGIC_ORBS");
export const ELEMENTAL_MAGIC_WEAPONS: readonly ItemDef[] = itemRows("ELEMENTAL_MAGIC_WEAPONS");
export const RARE_MINIBOSS_WEAPONS: readonly ItemDef[] = itemRows("RARE_MINIBOSS_WEAPONS");
export const EQUIPMENT: readonly ItemDef[] = itemRows(ITEM_SOURCE_VIEWS.EQUIPMENT);

/**
 * The canonical "kit" for a tier and style: exactly one item per slot, which is what the PRD's
 * derived-health and damage tables assume. Exported so a test can re-check the totals in the
 * header comment without re-deriving them by hand.
 */
export const KITS: Readonly<Record<string, readonly string[]>> = {
    melee_t1: [
        "grithe_sword", "palewood_shield", "grithe_helm", "grithe_cuirass", "grithe_greaves",
        "grithe_boots", "grithe_gloves",
    ],
    melee_t5: [
        "corven_sword", "duskoak_shield", "corven_helm", "corven_plate", "corven_greaves",
        "corven_boots", "corven_gauntlets",
    ],
    melee_t10: [
        "kaldite_sword", "cairnpine_shield", "kaldite_helm", "kaldite_plate", "kaldite_greaves",
        "kaldite_boots", "kaldite_gauntlets",
    ],
    melee_t20: [
        "emberite_sword", "cinderpine_shield", "emberite_helm", "emberite_plate", "emberite_greaves",
        "emberite_boots", "emberite_gauntlets",
    ],
    magic_t1: [
        "air_staff", "marchhide_hood", "marchhide_robe", "marchhide_leggings",
        "marchhide_boots", "marchhide_wraps",
    ],
    magic_t5: [
        "earth_staff", "bramblehide_hood", "bramblehide_robe", "bramblehide_leggings",
        "bramblehide_boots", "bramblehide_wraps",
    ],
    magic_t10: [
        "water_staff", "cairnpelt_hood", "cairnpelt_robe", "cairnpelt_leggings",
        "cairnpelt_boots", "cairnpelt_wraps",
    ],
    magic_t20: [
        "fire_staff", "charhide_hood", "charhide_robe", "charhide_leggings",
        "charhide_boots", "charhide_wraps",
    ]
};
