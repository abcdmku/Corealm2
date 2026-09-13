import { CRAFTED_JEWELRY } from './jewelry.js';
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
import type { ElementalWeaponChargeSpec, EquipmentBonuses, EquipSlot, ItemDef, MagicWeaponSpec, SkillId, SpellElement, } from "../contracts.js";
/** Zero-filled bonuses, so a row only writes the fields it actually changes. */
function bonuses(partial: Partial<EquipmentBonuses>): EquipmentBonuses {
    return {
        meleeAccuracy: partial.meleeAccuracy ?? 0,
        meleePower: partial.meleePower ?? 0,
        defence: Math.max(partial.defence ?? 0, partial.defence ?? 0),
        magicAccuracy: partial.magicAccuracy ?? 0,
        magicPower: partial.magicPower ?? 0,
        health: partial.health ?? 0,
        vitality: 0
    };
}
interface GearRow {
    id: string;
    name: string;
    tier: number;
    slot: EquipSlot;
    value: number;
    description: string;
    requires: Partial<Record<SkillId, number>>;
    bonuses: Partial<EquipmentBonuses>;
    attackSpeedMs?: number;
    magicWeapon?: MagicWeaponSpec;
}
function gear(row: GearRow): ItemDef {
    const equip: ItemDef["equip"] = row.attackSpeedMs === undefined
        ? { slot: row.slot, bonuses: bonuses(row.bonuses), requires: row.requires }
        : {
            slot: row.slot,
            bonuses: bonuses(row.bonuses),
            attackSpeedMs: row.attackSpeedMs,
            requires: row.requires
        };
    const item: ItemDef = {
        id: row.id,
        name: row.name,
        tier: row.tier,
        description: row.description,
        stackable: false,
        value: row.value,
        category: "equipment",
        equip
    };
    if (row.magicWeapon !== undefined)
        item.magicWeapon = row.magicWeapon;
    return item;
}
/**
 * Every melee weapon uses the same swing cadence. Staffs and wands share the spell cadence. PRD 2.4 fixes 2.4 s for "a
 * standard sword", and the unarmed / dagger TTK rows only reproduce at 2.4 s, so daggers share it
 * and trade damage for cost rather than for speed.
 */
const MELEE_SPEED_MS = 2400;
/** Two-handed staffs trade cadence for damage. */
const STAFF_CAST_SPEED_MS = 3000;
/** One-handed wands cast faster, with lower magic accuracy and power at the same tier. */
const WAND_CAST_SPEED_MS = 2200;
interface OrbRow {
    id: string;
    name: string;
    tier: number;
    element: SpellElement;
    released: boolean;
}
const ORB_ROWS: readonly OrbRow[] = [
    { id: "air_orb", name: "Air Orb", tier: 1, element: "wind", released: true },
    { id: "earth_orb", name: "Earth Orb", tier: 5, element: "earth", released: true },
    { id: "water_orb", name: "Water Orb", tier: 10, element: "water", released: true },
    { id: "fire_orb", name: "Fire Orb", tier: 20, element: "fire", released: true },
];
/** Singleton boss drops consumed by the elemental-weapon recipes. They are never equipment. */
export const MAGIC_ORBS: readonly ItemDef[] = ORB_ROWS.map((row) => ({
    id: row.id,
    name: row.name,
    tier: row.tier,
    description: row.released
        ? `A region-boss core used to craft a charged ${row.name.slice(0, -4)} wand or staff.`
        : "A sealed future-region core. No released boss provides it yet.",
    stackable: false,
    value: 0,
    category: "component",
    orb: {
        element: row.element,
        released: row.released
    }
}));
// -------------------------------------------------------------- starter kit, tier 0 (Worn)
/**
 * What the player wakes up with.
 *
 * Tier 0 includes the starting one-handed wand and a stronger two-handed staff. Both use plain
 * brown wood and empty sockets, so neither emits light. Their requirements are empty because they
 * sit below the first crafted wood tier.
 */
const STARTER_EQUIPMENT: readonly ItemDef[] = [
    gear({
        id: "worn_sword", name: "Worn Shortsword", tier: 0, slot: "mainHand", value: 15,
        description: "Notched, re-hafted twice, and lighter than it looks. It was somebody else's first.",
        requires: {}, attackSpeedMs: MELEE_SPEED_MS,
        bonuses: { meleeAccuracy: 3, meleePower: 3 }
    }),
    gear({
        id: "basic_wooden_wand", name: "Basic Wooden Wand", tier: 0, slot: "mainHand", value: 12,
        description: "Plain brown wood from grip to socket, with no light or elemental charge.",
        requires: {}, attackSpeedMs: WAND_CAST_SPEED_MS,
        magicWeapon: { kind: "wand", hands: 1 },
        bonuses: { magicAccuracy: 2, magicPower: 1 }
    }),
    gear({
        id: "basic_wooden_staff", name: "Basic Wooden Staff", tier: 0, slot: "mainHand", value: 20,
        description: "A plain two-handed staff with an empty brown socket and no glow of its own.",
        requires: {}, attackSpeedMs: STAFF_CAST_SPEED_MS,
        magicWeapon: { kind: "staff", hands: 2 },
        bonuses: { magicAccuracy: 3, magicPower: 7 }
    }),
];
// ------------------------------------------------------------------ melee, tier 1 (Grithe)
// Kit totals: accuracy 11, power 8 (sword) / 6 (dagger), armour 16, magicArmour 5, health 6.
const MELEE_TIER_1: readonly ItemDef[] = [
    gear({
        id: "grithe_dagger", name: "Copper Dagger", tier: 1, slot: "mainHand", value: 90,
        description: "A short blade of dull grey Copper. The first real weapon anyone out here owns.",
        requires: { melee: 1 }, attackSpeedMs: MELEE_SPEED_MS,
        // PRD 2.4 fixes power 6 and, through the 56% row at Melee 3, accuracy 6.
        bonuses: { meleeAccuracy: 6, meleePower: 6 }
    }),
    gear({
        id: "grithe_sword", name: "Copper Sword", tier: 1, slot: "mainHand", value: 180,
        description: "Two bars of Copper beaten flat and given an edge. Heavier than the dagger, and hits like it.",
        requires: { melee: 1 }, attackSpeedMs: MELEE_SPEED_MS,
        bonuses: { meleeAccuracy: 7, meleePower: 8 }
    }),
    gear({
        id: "palewood_shield", name: "Pine Shield", tier: 1, slot: "offHand", value: 70,
        description: "Planks of pale march wood banded at the rim. It stops a claw once.",
        requires: { melee: 1 },
        bonuses: { meleeAccuracy: 1, defence: Math.max(4, 2) }
    }),
    gear({
        id: "grithe_helm", name: "Copper Helm", tier: 1, slot: "head", value: 110,
        description: "An open-faced cap. You can hear things coming, which is most of the job.",
        requires: { melee: 1 },
        bonuses: { defence: 2, health: 1 }
    }),
    gear({
        id: "grithe_cuirass", name: "Copper Cuirass", tier: 1, slot: "body", value: 220,
        description: "A plate front laced over a leather back. Cheap, loud, and better than nothing.",
        requires: { melee: 1 },
        bonuses: { meleeAccuracy: 1, defence: Math.max(5, 1), health: 2 }
    }),
    gear({
        id: "grithe_greaves", name: "Copper Greaves", tier: 1, slot: "legs", value: 200,
        description: "Shin and thigh plates on a march-issue belt.",
        requires: { melee: 1 },
        bonuses: { defence: Math.max(3, 1), health: 1 }
    }),
    gear({
        id: "grithe_boots", name: "Copper Boots", tier: 1, slot: "feet", value: 80,
        description: "Iron-shod boots for scree and bracken.",
        requires: { melee: 1 },
        bonuses: { defence: 1, health: 1 }
    }),
    gear({
        id: "grithe_gloves", name: "Copper Gloves", tier: 1, slot: "hands", value: 80,
        description: "Studded gloves. They keep the grip when the haft goes wet.",
        requires: { melee: 1 },
        bonuses: { defence: 1, health: 1 }
    }),


];
// ------------------------------------------------------------------ melee, tier 5 (Corven)
// Kit totals: accuracy 23, power 14 (sword), armour 33, magicArmour 12, health 14.
// The health total is PRD 2.3 row 3: Melee 12 / Magic 5 -> 20 + 24 + 14 = 58 max health.
const MELEE_TIER_5: readonly ItemDef[] = [
    gear({
        id: "corven_dagger", name: "Iron Dagger", tier: 5, slot: "mainHand", value: 320,
        description: "Deepwood steel, dark and slightly oily to the touch.",
        requires: { melee: 5 }, attackSpeedMs: MELEE_SPEED_MS,
        bonuses: { meleeAccuracy: 12, meleePower: 11 }
    }),
    gear({
        id: "corven_sword", name: "Iron Sword", tier: 5, slot: "mainHand", value: 620,
        description: "A long Iron blade. The standard by which a Woodlands hand is judged.",
        requires: { melee: 5 }, attackSpeedMs: MELEE_SPEED_MS,
        // PRD 2.4 fixes power 14, and the 51% Thornbound row fixes accuracy 14.
        bonuses: { meleeAccuracy: 14, meleePower: 14 }
    }),
    gear({
        id: "duskoak_shield", name: "Ash Shield", tier: 5, slot: "offHand", value: 240,
        description: "Laminated ash over an Iron boss. Heavy enough to lean on.",
        requires: { melee: 5 },
        bonuses: { meleeAccuracy: 1, defence: Math.max(8, 4), health: 1 }
    }),
    gear({
        id: "corven_helm", name: "Iron Helm", tier: 5, slot: "head", value: 380,
        description: "A full helm with a narrow sight slit.",
        requires: { melee: 5 },
        bonuses: { meleeAccuracy: 1, defence: Math.max(5, 1), health: 2 }
    }),
    gear({
        id: "corven_plate", name: "Iron Plate", tier: 5, slot: "body", value: 760,
        description: "Three bars of Iron, articulated at the waist so you can still bend to pick things up.",
        requires: { melee: 5 },
        bonuses: { meleeAccuracy: 2, defence: Math.max(10, 2), health: 4 }
    }),
    gear({
        id: "corven_greaves", name: "Iron Greaves", tier: 5, slot: "legs", value: 700,
        description: "Plated legs. Slower over a root field, worth it under a husk.",
        requires: { melee: 5 },
        bonuses: { meleeAccuracy: 1, defence: Math.max(7, 2), health: 3 }
    }),
    gear({
        id: "corven_boots", name: "Iron Boots", tier: 5, slot: "feet", value: 260,
        description: "Plated over the toe, soft in the sole. Deepwood floor is not forgiving.",
        requires: { melee: 5 },
        bonuses: { meleeAccuracy: 1, defence: Math.max(2, 1), health: 2 }
    }),
    gear({
        id: "corven_gauntlets", name: "Iron Gauntlets", tier: 5, slot: "hands", value: 260,
        description: "Fingered plate. You can hold a rod in these, badly.",
        requires: { melee: 5 },
        bonuses: { meleeAccuracy: 1, defence: Math.max(1, 1), health: 2 }
    }),


];
// ------------------------------------------------------------------ melee, tier 10 (Kaldite)
// Kit totals: accuracy 42, power 26 (sword), armour 58, magicArmour 19, health 16. All solved above.
const MELEE_TIER_10: readonly ItemDef[] = [
    gear({
        id: "kaldite_dagger", name: "Cobalt Dagger", tier: 10, slot: "mainHand", value: 760,
        description: "A punch of black Cobalt with a needle point. It goes through moor-rot like paper.",
        requires: { melee: 9 }, attackSpeedMs: MELEE_SPEED_MS,
        bonuses: { meleeAccuracy: 24, meleePower: 22 }
    }),
    gear({
        id: "kaldite_sword", name: "Cobalt Sword", tier: 10, slot: "mainHand", value: 1450,
        description: "Hillcrest's best. Cobalt holds an edge through stone, which is the whole point up here.",
        requires: { melee: 10 }, attackSpeedMs: MELEE_SPEED_MS,
        // PRD 2.4 fixes power 26; accuracy 28 is solved from the 51% / 46% rows in the TTK table.
        bonuses: { meleeAccuracy: 28, meleePower: 26 }
    }),
    gear({
        id: "cairnpine_shield", name: "Oak Shield", tier: 10, slot: "offHand", value: 560,
        description: "Oak faced in Cobalt. It rings when a bear hits it, and the bear stops.",
        requires: { melee: 10 },
        bonuses: { meleeAccuracy: 2, defence: Math.max(14, 6), health: 1 }
    }),
    gear({
        id: "kaldite_helm", name: "Cobalt Helm", tier: 10, slot: "head", value: 880,
        description: "A closed helm with a stone-cutter's brow ridge.",
        requires: { melee: 10 },
        bonuses: { meleeAccuracy: 2, defence: Math.max(9, 2), health: 2 }
    }),
    gear({
        id: "kaldite_plate", name: "Cobalt Plate", tier: 10, slot: "body", value: 1760,
        description: "Three bars of Cobalt. Quarry crews were buried in these, which is not a selling point.",
        requires: { melee: 10 },
        bonuses: { meleeAccuracy: 3, defence: Math.max(18, 4), health: 5 }
    }),
    gear({
        id: "kaldite_greaves", name: "Cobalt Greaves", tier: 10, slot: "legs", value: 1620,
        description: "Full leg plate, hinged at the knee.",
        requires: { melee: 10 },
        bonuses: { meleeAccuracy: 2, defence: Math.max(12, 3), health: 4 }
    }),
    gear({
        id: "kaldite_boots", name: "Cobalt Boots", tier: 10, slot: "feet", value: 600,
        description: "Cleated for wet cairn stone.",
        requires: { melee: 10 },
        bonuses: { meleeAccuracy: 1, defence: Math.max(3, 1), health: 2 }
    }),
    gear({
        id: "kaldite_gauntlets", name: "Cobalt Gauntlets", tier: 10, slot: "hands", value: 600,
        description: "Cobalt over the knuckle, garnet rivets. Loud.",
        requires: { melee: 10 },
        bonuses: { meleeAccuracy: 2, defence: Math.max(2, 1), health: 2 }
    }),


];
// ------------------------------------------------------------------ melee, tier 20 (Emberite)
// Kit totals: accuracy 75, power 45 (sword), armour 95, magicArmour 32, health 22.
// The sword's power 45 is PRD 2.4's own tier-20 checkpoint row: floor(2 + (20 + 45)/4.2) = 17.
// Accuracy and armour continue the solved ladder's ratios (11/23/42 and 16/33/58 at 1/5/10); the
// Kilnhalt stat blocks in `enemies.ts` are solved AGAINST these totals to hold the 25-40 s
// on-tier band, so a change here means re-solving those rows too.
const MELEE_TIER_20: readonly ItemDef[] = [
    gear({
        id: "emberite_dagger", name: "Titanium Dagger", tier: 20, slot: "mainHand", value: 1700,
        description: "A hand-width of Titanium that never fully cools. It goes in easier than it comes out.",
        requires: { melee: 19 }, attackSpeedMs: MELEE_SPEED_MS,
        bonuses: { meleeAccuracy: 42, meleePower: 38 }
    }),
    gear({
        id: "emberite_sword", name: "Titanium Sword", tier: 20, slot: "mainHand", value: 3200,
        description: "Kiln-forged and quenched twice. The edge holds a dull orange line in the dark.",
        requires: { melee: 20 }, attackSpeedMs: MELEE_SPEED_MS,
        // Power 45 is the PRD 2.4 level-20 checkpoint; accuracy 48 continues the 7/14/28 weapon line.
        bonuses: { meleeAccuracy: 48, meleePower: 45 }
    }),
    gear({
        id: "cinderpine_shield", name: "Walnut Shield", tier: 20, slot: "offHand", value: 1250,
        description: "Layered walnut faced in Titanium. Built to withstand heavy blows.",
        requires: { melee: 20 },
        bonuses: { meleeAccuracy: 3, defence: Math.max(22, 9), health: 2 }
    }),
    gear({
        id: "emberite_helm", name: "Titanium Helm", tier: 20, slot: "head", value: 1950,
        description: "A closed helm with a smoke-vent crown. Built for standing close to heat.",
        requires: { melee: 20 },
        bonuses: { meleeAccuracy: 4, defence: Math.max(14, 4), health: 3 }
    }),
    gear({
        id: "emberite_plate", name: "Titanium Plate", tier: 20, slot: "body", value: 3900,
        description: "Five bars of Titanium. It keeps the warmth of the forge for a full day's walk.",
        requires: { melee: 20 },
        bonuses: { meleeAccuracy: 6, defence: Math.max(30, 7), health: 7 }
    }),
    gear({
        id: "emberite_greaves", name: "Titanium Greaves", tier: 20, slot: "legs", value: 3600,
        description: "Full leg plate, smoke-blued. Ember and scree both stay outside it.",
        requires: { melee: 20 },
        bonuses: { meleeAccuracy: 4, defence: Math.max(19, 5), health: 5 }
    }),
    gear({
        id: "emberite_boots", name: "Titanium Boots", tier: 20, slot: "feet", value: 1350,
        description: "Soled in heavy hide over Titanium shanks. Warm ground stops mattering.",
        requires: { melee: 20 },
        bonuses: { meleeAccuracy: 2, defence: Math.max(6, 2), health: 2 }
    }),
    gear({
        id: "emberite_gauntlets", name: "Titanium Gauntlets", tier: 20, slot: "hands", value: 1350,
        description: "Fingered plate with fire-opal rivets. They tick as they cool.",
        requires: { melee: 20 },
        bonuses: { meleeAccuracy: 4, defence: Math.max(4, 2), health: 3 }
    }),


];
// ------------------------------------------------------------------ magic, tier 20 (Charhide)
// Kit totals with the uncharged Cinderpine staff: magicAccuracy 75, magicPower 50, armour 9,
// magicArmour 82, health 18 — continuing the solved 12/24/47 and 9/16/32 lines. The canonical
// KITS row wears the charged Fire Staff (as every tier's magic kit wears its element's staff),
// which lifts those to 84/56, and the Kilnhalt bear/boar rows in `enemies.ts` hold the style
// gate against BOTH reads: the Ashback stays a staff answer and the Cinder Boar a sword answer.
const MAGIC_TIER_20: readonly ItemDef[] = [
    gear({
        id: "cinderpine_wand", name: "Walnut Wand", tier: 20, slot: "mainHand", value: 1900,
        description: "Polished walnut with an empty Titanium socket. It stays unlit until the altar takes it.",
        requires: { magic: 20 }, attackSpeedMs: WAND_CAST_SPEED_MS,
        magicWeapon: { kind: "wand", hands: 1 },
        bonuses: { magicAccuracy: 27, magicPower: 23, defence: 5 }
    }),
    gear({
        id: "cinderpine_staff", name: "Walnut Staff", tier: 20, slot: "mainHand", value: 2700,
        description: "A two-handed walnut shaft crowned with an empty Titanium cage, dark until charged.",
        requires: { magic: 20 }, attackSpeedMs: STAFF_CAST_SPEED_MS,
        magicWeapon: { kind: "staff", hands: 2 },
        bonuses: { meleePower: 7, magicAccuracy: 40, magicPower: 34, defence: 7 }
    }),
    gear({
        id: "charhide_hood", name: "Heavy Hide Hood", tier: 20, slot: "head", value: 1650,
        description: "Seared hide with the grain still showing. Kiln heat rolls off it.",
        requires: { magic: 20 },
        bonuses: { defence: Math.max(2, 15), magicAccuracy: 8, magicPower: 4, health: 3, vitality: 0 }
    }),
    gear({
        id: "charhide_robe", name: "Heavy Hide Robe", tier: 20, slot: "body", value: 3300,
        description: "Three heavy hides stitched with Titanium wire. The Fire Ogre arena is survivable in this.",
        requires: { magic: 20 },
        bonuses: { defence: Math.max(3, 26), magicAccuracy: 12, magicPower: 6, health: 6, vitality: 0 }
    }),
    gear({
        id: "charhide_leggings", name: "Heavy Hide Leggings", tier: 20, slot: "legs", value: 2950,
        description: "Heavy Hide to the ankle, weighted so foothill gusts leave it alone.",
        requires: { magic: 20 },
        bonuses: { defence: Math.max(2, 18), magicAccuracy: 7, magicPower: 4, health: 4, vitality: 0 }
    }),
    gear({
        id: "charhide_boots", name: "Heavy Hide Boots", tier: 20, slot: "feet", value: 1150,
        description: "Silent on warm rock. Ash does not hold a footprint in these.",
        requires: { magic: 20 },
        bonuses: { defence: Math.max(1, 5), magicAccuracy: 2, health: 2, vitality: 0 }
    }),
    gear({
        id: "charhide_wraps", name: "Heavy Hide Wraps", tier: 20, slot: "hands", value: 1150,
        description: "Seared strips wound to the wrist, fire-opal dust in the weave.",
        requires: { magic: 20 },
        bonuses: { defence: Math.max(1, 5), magicAccuracy: 2, health: 2, vitality: 0 }
    }),


];
// -------------------------------------------------------------------- the magic-weapon ladder
// Each released wood has a wand and a staff. Wands use two matching shafts; staffs use three.
// Orbs are boss rewards used to turn these plain weapons into charged elemental weapons.
//
//   palewood_{wand,staff}   Magic 1  <- palewood_shaft  <- palewood_log,  Woodcutting 1
//   duskoak_{wand,staff}    Magic 5  <- duskoak_shaft   <- duskoak_log,   Woodcutting 5
//   cairnpine_{wand,staff}  Magic 10 <- cairnpine_shaft <- cairnpine_log, Woodcutting 10
//
// `requires` gates equipping by Magic. The log source provides the gathering progression.
// ------------------------------------------------------------------ magic, tier 1 (Marchhide)
// Kit totals: magicAccuracy 12, magicPower 9, armour 3, magicArmour 13, health 4.
// Voltrend at Magic 1 has max hit 4 with the staff kit and 3 after swapping in the wand.
const MAGIC_TIER_1: readonly ItemDef[] = [
    gear({
        id: "palewood_wand", name: "Pine Wand", tier: 1, slot: "mainHand", value: 95,
        description: "Pale wood with an empty socket at the tip. It stays unlit until upgraded.",
        requires: { magic: 1 }, attackSpeedMs: WAND_CAST_SPEED_MS,
        magicWeapon: { kind: "wand", hands: 1 },
        bonuses: { magicAccuracy: 4, magicPower: 3 }
    }),
    gear({
        id: "palewood_staff", name: "Pine Staff", tier: 1, slot: "mainHand", value: 140,
        description: "A pale two-handed shaft with an empty socket. The wood itself gives off no light.",
        requires: { magic: 1 }, attackSpeedMs: STAFF_CAST_SPEED_MS,
        magicWeapon: { kind: "staff", hands: 2 },
        bonuses: { magicAccuracy: 6, magicPower: 7, defence: 1 }
    }),
    gear({
        id: "marchhide_hood", name: "Hide Hood", tier: 1, slot: "head", value: 90,
        description: "Cured wolf hide, hood up against the march wind.",
        requires: { magic: 1 },
        bonuses: { magicAccuracy: 1, defence: Math.max(1, 2), health: 1, vitality: 0 }
    }),
    gear({
        id: "marchhide_robe", name: "Hide Robe", tier: 1, slot: "body", value: 170,
        description: "Three hides stitched into something between a coat and a tent.",
        requires: { magic: 1 },
        bonuses: { magicAccuracy: 1, magicPower: 1, defence: Math.max(1, 3), health: 2, vitality: 0 }
    }),
    gear({
        id: "marchhide_leggings", name: "Hide Leggings", tier: 1, slot: "legs", value: 150,
        description: "Hide leggings, laced at the calf.",
        requires: { magic: 1 },
        bonuses: { magicAccuracy: 1, defence: Math.max(1, 2), health: 1, vitality: 0 }
    }),
    gear({
        id: "marchhide_boots", name: "Hide Boots", tier: 1, slot: "feet", value: 65,
        description: "Soft-soled. Quiet, which matters more than it sounds.",
        requires: { magic: 1 },
        bonuses: { defence: 1 }
    }),
    gear({
        id: "marchhide_wraps", name: "Hide Wraps", tier: 1, slot: "hands", value: 65,
        description: "Hide strips wound to the knuckle, fingertips left bare.",
        requires: { magic: 1 },
        bonuses: { defence: 1 }
    }),


];
// ------------------------------------------------------------------ magic, tier 5 (Bramblehide)
// Kit totals: magicAccuracy 24, magicPower 16, armour 4, magicArmour 28, health 10.
// Stonebrand at Magic 5 has max hit 8 with the staff kit and 7 after swapping in the wand.
const MAGIC_TIER_5: readonly ItemDef[] = [
    gear({
        id: "duskoak_wand", name: "Ash Wand", tier: 5, slot: "mainHand", value: 340,
        description: "Dark ash with an empty crown. Its polished wood remains unlit on its own.",
        requires: { magic: 5 }, attackSpeedMs: WAND_CAST_SPEED_MS,
        magicWeapon: { kind: "wand", hands: 1 },
        bonuses: { magicAccuracy: 9, magicPower: 6, defence: 1 }
    }),
    gear({
        id: "duskoak_staff", name: "Ash Staff", tier: 5, slot: "mainHand", value: 500,
        description: "Dark ash banded in Iron around an empty, unlit crown.",
        requires: { magic: 5 }, attackSpeedMs: STAFF_CAST_SPEED_MS,
        magicWeapon: { kind: "staff", hands: 2 },
        bonuses: { meleePower: 2, magicAccuracy: 12, magicPower: 11, defence: 2 }
    }),
    gear({
        id: "bramblehide_hood", name: "Thick Hide Hood", tier: 5, slot: "head", value: 300,
        description: "Deepwood hide, still faintly thorned along the seam.",
        requires: { magic: 5 },
        bonuses: { defence: Math.max(1, 4), magicAccuracy: 2, magicPower: 1, health: 2, vitality: 0 }
    }),
    gear({
        id: "bramblehide_robe", name: "Thick Hide Robe", tier: 5, slot: "body", value: 600,
        description: "Heavy hide, waxed. Sheds a Thornbound's spores and most of the rain.",
        requires: { magic: 5 },
        bonuses: { defence: Math.max(1, 8), magicAccuracy: 3, magicPower: 1, health: 3, vitality: 0 }
    }),
    gear({
        id: "bramblehide_leggings", name: "Thick Hide Leggings", tier: 5, slot: "legs", value: 540,
        description: "Long hide leggings cut for a full stride.",
        requires: { magic: 5 },
        bonuses: { defence: Math.max(1, 5), magicAccuracy: 2, magicPower: 1, health: 2, vitality: 0 }
    }),
    gear({
        id: "bramblehide_boots", name: "Thick Hide Boots", tier: 5, slot: "feet", value: 220,
        description: "Laced to the knee against the root field.",
        requires: { magic: 5 },
        bonuses: { magicAccuracy: 1, defence: 2, health: 1, vitality: 0 }
    }),
    gear({
        id: "bramblehide_wraps", name: "Thick Hide Wraps", tier: 5, slot: "hands", value: 220,
        description: "Wrapped to the second knuckle. Casting hand stays free.",
        requires: { magic: 5 },
        bonuses: { defence: 2, health: 1 }
    }),


];
// ------------------------------------------------------------------ magic, tier 10 (Cairnpelt)
// Kit totals: magicAccuracy 47, magicPower 32, armour 8, magicArmour 50, health 12.
// Both totals are solved from the Magic 10 Rimewash-vs-Cairnwight 24 s claim; see the header block.
const MAGIC_TIER_10: readonly ItemDef[] = [
    gear({
        id: "cairnpine_wand", name: "Oak Wand", tier: 10, slot: "mainHand", value: 820,
        description: "Resin-dark oak with an empty Cobalt socket and no light of its own.",
        requires: { magic: 10 }, attackSpeedMs: WAND_CAST_SPEED_MS,
        magicWeapon: { kind: "wand", hands: 1 },
        bonuses: { magicAccuracy: 18, magicPower: 14, defence: 3 }
    }),
    gear({
        id: "cairnpine_staff", name: "Oak Staff", tier: 10, slot: "mainHand", value: 1180,
        description: "A two-handed oak shaft with an empty Cobalt cage. It stays dark until upgraded.",
        requires: { magic: 10 }, attackSpeedMs: STAFF_CAST_SPEED_MS,
        magicWeapon: { kind: "staff", hands: 2 },
        bonuses: { meleePower: 4, magicAccuracy: 24, magicPower: 20, defence: 4 }
    }),
    gear({
        id: "cairnpelt_hood", name: "Fur Hood", tier: 10, slot: "head", value: 700,
        description: "Cut from a bear's winter coat. It does not take dye and it does not tear.",
        requires: { magic: 10 },
        bonuses: { defence: Math.max(1, 8), magicAccuracy: 4, magicPower: 2, health: 2, vitality: 0 }
    }),
    gear({
        id: "cairnpelt_robe", name: "Fur Robe", tier: 10, slot: "body", value: 1400,
        description: "Three pelts, stitched with Cobalt wire. Quarry Warden's floor is survivable in this.",
        requires: { magic: 10 },
        bonuses: { defence: Math.max(2, 14), magicAccuracy: 6, magicPower: 3, health: 4, vitality: 0 }
    }),
    gear({
        id: "cairnpelt_leggings", name: "Fur Leggings", tier: 10, slot: "legs", value: 1260,
        description: "Pelt to the ankle, weighted at the hem so it does not lift on the moor.",
        requires: { magic: 10 },
        bonuses: { defence: Math.max(1, 9), magicAccuracy: 3, magicPower: 2, health: 3, vitality: 0 }
    }),
    gear({
        id: "cairnpelt_boots", name: "Fur Boots", tier: 10, slot: "feet", value: 500,
        description: "Silent on stone. The quarry crews would have hated them.",
        requires: { magic: 10 },
        bonuses: { defence: Math.max(1, 3), magicAccuracy: 1, health: 1, vitality: 0 }
    }),
    gear({
        id: "cairnpelt_wraps", name: "Fur Wraps", tier: 10, slot: "hands", value: 500,
        description: "Pelt strips to the wrist. Garnet dust worked into the weave.",
        requires: { magic: 10 },
        bonuses: { defence: Math.max(1, 3), magicAccuracy: 1, health: 1, vitality: 0 }
    }),


];
/** A base wood weapon re-issued with an element's charge by its awakened regional altar. */
function chargedWeapon(base: ItemDef, id: string, name: string, charge: ElementalWeaponChargeSpec, addedBonuses: Partial<EquipmentBonuses>): ItemDef {
    if (!base.equip || !base.magicWeapon)
        throw new Error(`Charged weapon base ${base.id} is invalid`);
    const baseBonuses = base.equip.bonuses;
    return {
        ...base,
        id,
        name,
        description: `${base.name} fitted with a ${name.split(" ")[0]} Orb. Its charge pays for matching spells before carried Essence.`,
        value: base.value,
        equip: {
            ...base.equip,
            bonuses: bonuses({
                meleeAccuracy: baseBonuses.meleeAccuracy + (addedBonuses.meleeAccuracy ?? 0),
                meleePower: baseBonuses.meleePower + (addedBonuses.meleePower ?? 0),
                defence: Math.max(baseBonuses.defence + (addedBonuses.defence ?? 0), baseBonuses.defence + (addedBonuses.defence ?? 0)),
                magicAccuracy: baseBonuses.magicAccuracy + (addedBonuses.magicAccuracy ?? 0),
                magicPower: baseBonuses.magicPower + (addedBonuses.magicPower ?? 0),
                health: baseBonuses.health + (addedBonuses.health ?? 0),
                vitality: 0
            })
        },
        magicWeapon: { ...base.magicWeapon, charge }
    };
}
function magicBase(id: string): ItemDef {
    const found = [...MAGIC_TIER_1, ...MAGIC_TIER_5, ...MAGIC_TIER_10, ...MAGIC_TIER_20]
        .find((item) => item.id === id);
    if (!found)
        throw new Error(`Missing magic weapon base ${id}`);
    return found;
}
function meleeBase(id: string): ItemDef {
    const found = [...MELEE_TIER_1, ...MELEE_TIER_5, ...MELEE_TIER_10, ...MELEE_TIER_20]
        .find((item) => item.id === id);
    if (!found)
        throw new Error(`Missing melee weapon base ${id}`);
    return found;
}
const AIR_CHARGE: ElementalWeaponChargeSpec = {
    element: "wind", capacity: 1000, initialCharges: 1000,
    rechargeItemId: "air_essence", rechargeCost: 100, orbItemId: "air_orb", released: true
};
const EARTH_CHARGE: ElementalWeaponChargeSpec = {
    element: "earth", capacity: 1000, initialCharges: 1000,
    rechargeItemId: "earth_essence", rechargeCost: 100, orbItemId: "earth_orb", released: true
};
const WATER_CHARGE: ElementalWeaponChargeSpec = {
    element: "water", capacity: 1000, initialCharges: 1000,
    rechargeItemId: "water_essence", rechargeCost: 100, orbItemId: "water_orb", released: true
};
const FIRE_CHARGE: ElementalWeaponChargeSpec = {
    element: "fire", capacity: 1000, initialCharges: 1000,
    rechargeItemId: "fire_essence", rechargeCost: 100, orbItemId: "fire_orb", released: true
};
/** Released awakened-altar weapon outputs, one wand and staff per element. */
export const ELEMENTAL_MAGIC_WEAPONS: readonly ItemDef[] = [
    chargedWeapon(magicBase("palewood_wand"), "air_wand", "Air Wand", AIR_CHARGE, { magicAccuracy: 1, magicPower: 1, defence: 2 }),
    chargedWeapon(magicBase("palewood_staff"), "air_staff", "Air Staff", AIR_CHARGE, { magicAccuracy: 1, magicPower: 1, defence: 2 }),
    chargedWeapon(magicBase("duskoak_wand"), "earth_wand", "Earth Wand", EARTH_CHARGE, { defence: Math.max(1, 3), magicAccuracy: 3, magicPower: 2, health: 1, vitality: 0 }),
    chargedWeapon(magicBase("duskoak_staff"), "earth_staff", "Earth Staff", EARTH_CHARGE, { defence: Math.max(1, 3), magicAccuracy: 3, magicPower: 2, health: 1, vitality: 0 }),
    chargedWeapon(magicBase("cairnpine_wand"), "water_wand", "Water Wand", WATER_CHARGE, { defence: Math.max(2, 6), magicAccuracy: 6, magicPower: 4, health: 1, vitality: 0 }),
    chargedWeapon(magicBase("cairnpine_staff"), "water_staff", "Water Staff", WATER_CHARGE, { defence: Math.max(2, 6), magicAccuracy: 6, magicPower: 4, health: 1, vitality: 0 }),
    chargedWeapon(magicBase("cinderpine_wand"), "fire_wand", "Fire Wand", FIRE_CHARGE, { defence: Math.max(3, 9), magicAccuracy: 9, magicPower: 6, health: 2, vitality: 0 }),
    chargedWeapon(magicBase("cinderpine_staff"), "fire_staff", "Fire Staff", FIRE_CHARGE, { defence: Math.max(3, 9), magicAccuracy: 9, magicPower: 6, health: 2, vitality: 0 }),
];
// ------------------------------------------------------------------ rare miniboss weapons
/**
 * Each regional miniboss rolls its named sword and staff at 10% per kill (independent rolls).
 *
 * The rule is mechanical, not hand-tuned: a rare sword copies the host region's craftable sword and
 * applies ceil(base x 1.10) to accuracy and power; a rare staff applies the same rule to the local
 * uncharged staff's OFFENSIVE magic stats only. The staves carry no charge and never bypass the
 * Orb-and-altar progression — they are simply the best plain staff at their tier. Requirements
 * copy the base weapon, so drops always match the host region's requirement tier.
 */
function rare(base: ItemDef, id: string, name: string, description: string, boosted: readonly (keyof EquipmentBonuses)[]): ItemDef {
    if (!base.equip)
        throw new Error(`Rare weapon base ${base.id} is not equipment`);
    const upgraded = { ...base.equip.bonuses };
    for (const key of boosted)
        upgraded[key] = Math.ceil(base.equip.bonuses[key] * 1.10);
    return {
        ...base,
        id,
        name,
        description,
        value: Math.round(base.value * 1.5),
        equip: { ...base.equip, bonuses: upgraded }
    };
}
const RARE_SWORD_STATS: readonly (keyof EquipmentBonuses)[] = ["meleeAccuracy", "meleePower"];
const RARE_STAFF_STATS: readonly (keyof EquipmentBonuses)[] = ["magicAccuracy", "magicPower"];
export const RARE_MINIBOSS_WEAPONS: readonly ItemDef[] = [
    rare(meleeBase("grithe_sword"), "galeskin_sword", "Plains Ogre Sword", "Copper pattern, but the edge whistles on the backswing. Plains Ogre carried it point-down.", RARE_SWORD_STATS),
    rare(magicBase("palewood_staff"), "galeskin_staff", "Plains Ogre Staff", "Pine scoured silver by wind. The empty socket hums in weather.", RARE_STAFF_STATS),
    rare(meleeBase("corven_sword"), "mossbound_sword", "Forest Ogre Sword", "A Iron blade grown through with moss that will not die. It never rusts.", RARE_SWORD_STATS),
    rare(magicBase("duskoak_staff"), "mossbound_staff", "Forest Ogre Staff", "Ash with a living green seam. Warm at the grip like a root in summer.", RARE_STAFF_STATS),
    rare(meleeBase("kaldite_sword"), "tideworn_sword", "Cave Ogre Sword", "Cobalt worked smooth as sea glass. It swings like it remembers the water.", RARE_SWORD_STATS),
    rare(magicBase("cairnpine_staff"), "tideworn_staff", "Cave Ogre Staff", "Oak bleached and salt-cured. The cage weeps a little in the cold.", RARE_STAFF_STATS),
    rare(meleeBase("emberite_sword"), "cinderwake_sword", "Fire Ogre Sword", "Titanium quenched in the arena's own spring. The orange line down the edge never fades.", RARE_SWORD_STATS),
    rare(magicBase("cinderpine_staff"), "cinderwake_staff", "Fire Ogre Staff", "Walnut the fire chose not to eat. The empty cage sheds a slow drift of sparks.", RARE_STAFF_STATS),
];
/**
 * Every equippable item: the tier-0 weapons, released tier ladders, and elemental weapon outputs.
 * Orbs are components and live in `MAGIC_ORBS` above.
 */
export const EQUIPMENT: readonly ItemDef[] = [
    ...CRAFTED_JEWELRY,
    ...STARTER_EQUIPMENT,
    ...MELEE_TIER_1, ...MELEE_TIER_5, ...MELEE_TIER_10, ...MELEE_TIER_20,
    ...MAGIC_TIER_1, ...MAGIC_TIER_5, ...MAGIC_TIER_10, ...MAGIC_TIER_20,
    ...ELEMENTAL_MAGIC_WEAPONS,
    ...RARE_MINIBOSS_WEAPONS,
];
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
