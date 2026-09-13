# Corealm balance derivations

The fenced sections below preserve the header comments from `equipment.ts`, `recipes.ts`
and `enemies.ts` verbatim. They describe the historical derivation, including old item names
and stat examples. Production modules still contain those comments and still own their formulas.

M0 extracts parameter snapshots into `game/content/data/balance/`. Editing these files does
not change gameplay yet. Each file has a schema in `game/src/content/schema/balance.ts`;
`BALANCE_SCHEMAS` registers its single-object shape for `content:check`. Focused parity checks
in `tests/content-balance-parameters.test.ts` compare the extracted data with production behavior.

## Extracted parameters and sources

| File | Current source and scope |
| --- | --- |
| `gear.json` | `equipment.ts` starter and authored T1/T5/T10/T20 base rows, swing and cast cadence, and `rare()` multipliers. Baselines store the effective `bonuses()` output, including merged defence. Tier numbers come from `GATHERING_PRODUCTION_TIERS`, `REGIONAL_CRAFTING_TIERS`, and `WILDERNESS_CRAFTING_TIERS`. Combat arithmetic comes from `systems/combat.ts`, which implements the header equations. |
| `recipes.json` | `recipes.ts` complete `W` table, including duration. `content/index.ts` supplies `gatherXp`, `healAmount` and `toolBonus` constants. `recipeXp` rounds the gather curve before multiplying by the weight; it has no separate multiplier. `W_HIDE_SMALL` uses `helmBootsGloves`, and `W_HIDE_LEGS` uses `leatherBody`. `amuletOrRing` is retained from `W` although current jewelry recipes use their own duration. |
| `sets.json` | `equipmentSets.ts` `defineSet()` defence and health values by tier, plus `bossArmor.ts` T90 and bareheaded thresholds. Bonuses are cumulative: both defence thresholds grant the listed defence value. |
| `loot.json` | `creatureLoot.ts` `MATERIAL_VALUE`, `bossArmorDrops()` expected-piece budget, `regionalFabricDrops()` roll inputs, and `wildernessDrops()` quantity/chance inputs. Rune ranks 1/2 belong to the shallow band and 3/4/5 to the deep band. Item selection and species classification remain in TS. |
| `enemies.json` | `enemies.ts` `marksFor()` and `purseMarksFor()` per-tier endpoints, fantasy tier list and stat floors. Fantasy scaling is `targetTier / baseTier`, followed by rounding and the floor. `index.ts` supplies combat-level weights; `encounterBalance.ts` supplies tuning constants, regional tiers, and boss multipliers. |
| `jewelry.json` | `jewelry.ts` crafted profile order, material pairs, requirements, value/bonus arithmetic and recipe numbers. `universalMinibossLoot.ts` supplies guardian stat profiles, requirements, value multiplier and fixed +2 bonuses. |
| `formation.json` | `encounterPopulation.ts` population limits, body gap, fixed/boss counts, hash range, radius multiplier, search cap and clearance tolerance. The FNV hash and hexagonal geometry remain algorithms, not editable tuning. |

These snapshots do not complete R2b. The pure parameterized formula modules, loader migration,
derivation tags, drift detection, recompute previews and Balance UI are later milestones.
Regional and Wilderness gear interpolation inputs, charged-weapon deltas and charge profiles,
boss armor piece baselines, remaining item/recipe generators, species-specific loot selection,
and Wilderness enemy progression still need migration. Full gathering resource rows also stay
in their production tables; the two extracted tier lists contain only numeric unlock tiers.

Enemy time-to-kill figures below remain historical design examples. They are not presented as
current live tuning targets. Production combat-level tuning parameters are extracted separately
in `enemies.json`. Preserve rounding order when moving any formula into the later pure modules.

## Equipment (`equipment.ts`)

```
The equipment ladder: a full 9-slot kit at tiers 1, 5, 10 and 20, in two mechanically distinct
lines, plus the eight rare miniboss weapons derived from the craftable ladder.

Owned by W-CONTENT. `items.ts` re-exports these rows inside `ALL_ITEMS`; nothing else should
import `EQUIPMENT` directly, because the registry only ever sees the concatenated table.

---------------------------------------------------------------------------------------------
THE ARITHMETIC (PRD 2.3 and 2.4). Every number below is derived, not guessed.

Melee damage:  maxHit = floor(2 + (meleeLevel + gearPower) / 4.2)

  Grithe dagger, Melee 1,  power  6 -> floor(2 +  7/4.2) = floor( 3.667) =  3   (PRD 2.4)
  Corven sword,  Melee 5,  power 14 -> floor(2 + 19/4.2) = floor( 6.524) =  6   (PRD 2.4)
  Kaldite sword, Melee 10, power 26 -> floor(2 + 36/4.2) = floor(10.571) = 10   (PRD 2.4)

  The PRD's worked rows quote weapon-only gearPower, and its Ordrun row pins that reading:
  "Melee 18, tier 10 kit -> maxHit 12" needs floor(2 + (18 + P)/4.2) = 12, i.e. P in [24, 28.2).
  The Kaldite sword alone is 26. So ARMOUR CONTRIBUTES ZERO POWER at every tier; armour buys
  `armour`, `magicArmour` and `health`, and weapons buy `power` / `magicPower`. Keep it that
  way or the PRD's damage table stops reproducing.

  Cross-checks that also fall out of the same numbers:
    Melee 3,  Grithe dagger  -> floor(2 +  9/4.2) =  4   (PRD TTK table)
    Melee 7,  Corven sword   -> floor(2 + 21/4.2) =  7   (PRD TTK table)
    Melee 12, Kaldite sword  -> floor(2 + 38/4.2) = 11   (PRD TTK table)
    Melee 18, Kaldite sword  -> floor(2 + 44/4.2) = 12   (PRD Ordrun row)

Derived health: maxHealth = 20 + 3 * max(1, floor((melee + magic)/2)) + sum(health)

  Full melee kit health totals are tuned to reproduce PRD 2.3 exactly:
    tier  1 kit = +6   -> Melee 10 / Magic  1: 20 + 3*5  +  6 = 41
    tier  5 kit = +14  -> Melee 12 / Magic  5: 20 + 3*8  + 14 = 58
    tier 10 kit = +16  -> Melee 18 / Magic  8: 20 + 3*13 + 16 = 75
  The tier 10 kit being only +2 health over tier 5 is the PRD's number, not a typo on our
  side; tier 10's real gain is +25 armour and +12 power. The 75 HP pool is load-bearing for the
  Ordrun fight budget in PRD 2.4, so do not "fix" it.

Accuracy: attackRoll = (attackLevel + 9) * (1 + gearAccuracy/100) * styleFactor
          defenceRoll = (defenceLevel + 9) * (1 + defenderArmour/100)
          hitChance   = clamp(attackRoll / (attackRoll + defenceRoll), 0.05, 0.95)

  Weapon accuracy values are solved from the PRD's hit-chance column; see `enemies.ts` for the
  matching defender stat blocks and the full solved TTK table. The defender names below are the
  PRD's own, from before the bestiary became animals; each row's stat block now belongs to the
  animal named after it, and the arithmetic is unchanged because the numbers were inherited whole.
    Grithe dagger  acc  +6: Melee 3 vs Rill Skitterling  -> 12*1.06 / (12*1.06 + 10)   = 56%  (now Redsill Frog)
    Corven sword   acc +14: Melee 7 vs Thornbound Husk   -> 16*1.14 / (16*1.14 + 17.6) = 51%  (now Duskoak Stag)
    Kaldite sword  acc +28: Melee 12 vs Scree Skitterling-> 21*1.28 / (21*1.28 + 26.0) = 51%  (now Scree Boar)
                            Melee 12 vs Cairnwight       -> 21*1.28 / (21*1.28 + 31.0) = 46%  (now Highcairn Bear)

  Full-kit accuracy totals: 11 (t1) / 23 (t5) / 42 (t10). The t10 total is solved from the
  Ordrun row: 27 * 1.42 = 38.34 against Ordrun's 29 * 1.62 = 46.98 gives 45%.

  Full-kit armour totals: 16 (t1) / 33 (t5) / 58 (t10). The t10 total is solved from "Ordrun
  deals about 1.02 damage/s through tier 10 armour": 27 * 1.58 = 42.66 defence roll.

Magic damage: maxHit = floor(spell.baseMax + (magicLevel + gearMagicPower) / spell.divisor)

  The tier 10 magic kit is solved from PRD 2.4's headline claim, "at Magic 10 with a Kaldite
  staff, the Magic 10 water lash kills a Cairnwight in 24 s where a Kaldite sword at Melee 12
  takes 33 s:
    magicPower    +32 -> Rimewash maxHit = floor(8 + (10 + 32)/6) = 15, average hit 8.0
    magicAccuracy +47 -> attackRoll = (10 + 9) * 1.15 * 1.47 = 32.12
    Cairnwight magic defence = (11 + 9) * 1.10 = 22.00 -> hitChance = 0.5935
    dps = 0.5935 * 8.0 / 3.0 s = 1.583 -> 38 HP / 1.583 = 24.0 s.  MATCHES.
  Tier 1 and tier 5 staffs carry enough extra power to produce a larger max-hit read than the
  matching wand. That per-cast gap is the price for the wand's faster 2.2-second cadence.
---------------------------------------------------------------------------------------------
```

## Recipes (`recipes.ts`)

```
Every production recipe: smelting, smithing, cooking, crafting and fletching at tiers 1, 5 and 10.

Owned by W-CONTENT.

XP is NEVER a literal in this file. Every row calls `recipeXp(tier, craftWeight)` from
`content/index.ts`, with the weight taken straight out of the PRD 2.7 table below. That table is
the only place a number is typed by hand, and the PRD's worked examples check it:

  gatherXp(1) = 10, gatherXp(5) = 24, gatherXp(10) = 35
  Grithe bar   = recipeXp(1,  0.8) = round(10 * 0.8) =   8   (PRD 2.7)
  Grithe sword = recipeXp(1,  3.5) = round(10 * 3.5) =  35   (PRD 2.7)
  Kaldite bar  = recipeXp(10, 0.8) = round(35 * 0.8) =  28   (PRD 2.7)
  Kaldite body = recipeXp(10, 5.0) = round(35 * 5.0) = 175   (PRD 2.7)

Three weights in the PRD's table do not name every piece we author, so they are reused with the
mapping written down here rather than invented per row:
  - magic hood / boots / wraps  -> 2.5, the "Helm, boots, gloves" weight
  - magic leggings              -> 4.0, the "Leather body" weight (same hide count class)
  - elemental weapon upgrade   -> the matching base weapon weight

`reqLevel` equals the tier at every step. The PRD authors content at tiers 1, 5 and 10 and never
asks for an intra-tier stagger, so a flat mapping is the one that cannot surprise a test.

Stations come from `content/regions.ts`. Elemental weapon upgrades use only the awakened altar
at their matching Essence Cache; the regional boss Orb is the one-time altar key, not a recipe
ingredient. Ordinary crafting remains tied to crafting tables.
```

## Enemies (`enemies.ts`)

```
Original combat blocks and the fantasy creatures that now occupy their encounters.
Stable encounter aliases retain the original balance, rewards and currency. Canonical family
blocks remain available for the source gallery, new populations and coastal generation.

Owned by W-CONTENT.

---------------------------------------------------------------------------------------------
THE ORIGINAL FAMILY VOCABULARY. The old animal families below document the encounter balance.
The aliases at the end of this file give their replacement creatures new families and names.

 family       region             the number that defines it
 ------------ ------------------ ---------------------------------------------------------------
 frog         water edges        6 health, passive: the fight a new character chooses first
 hen          plains             1200 ms and max hit 1, the fastest cadence in the game
 coney        plains, forest     defence ABOVE attack: the only inverted block, and harmless
 goat         plains             the aggressive tier 1 spawn, the one that starts it
 cattle       plains             armour 35 against magicArmour 0, and 3600 ms
 viper        plains, forest     armour 0 with the biggest single blow at its tier
 deer         forest             defenceLevel 7 / armour 10, PRD 2.4 tier 5 defensive row
 hog          forest             magicArmour 55: the tier 5 target you do NOT bring a staff to
 coyote       forest, rock       pack hunter, and at tier 10 an 1800 ms cadence
 bear         rock, underground  armour 55 against magicArmour 10: the staff answer
 boar         rock               armour 30 against magicArmour 115: the sword answer
 ibex         rock               44 health, symmetric resistances, simply out-fight it
 aurochs      rock               armour 78 against magicArmour 0, the widest split anywhere
 rat          underground        the softest tier 10 block, at 1800 ms
 scorpion     underground        high armour AND high magicArmour: nothing answers it cheaply
 crab         underground        armour 82, the highest in the game
 reaver       every region       humanoid raider: aggro 14 m and 2.4x the mark drop
 quarrykeeper Gravelmaw          Ordrun: 200 health, two phases, a telegraphed slam
 galeskin/mossbound/tideworn/cinderwake — the four regional minibosses, one Monster02 rig in
              four texture variants, each rolling its region's rare sword and staff at 10%

Behaviour is the second axis and it is doing real work. Passive hens, frogs and coneys, and
territorial cattle, deer, ibex, aurochs, vipers and crabs, can all be walked past, so the
aggressive families (goat, hog, coyote, bear, boar, rat, scorpion, reaver) are what actually
decides whether a stretch of ground is dangerous. systems/enemyAI.ts reads exactly `behaviour`
and `aggroRadius`; systems/combat.ts reads every other field on the row.

---------------------------------------------------------------------------------------------
LEVELS ARE NOT IN THIS FILE, ON PURPOSE. A displayed combat level is a reading of the stats
below, so content/index.ts `enemyCombatLevel()` computes it from attack, accuracy, defence,
armour, magicArmour and health, and content/regions.ts no longer carries a `level` field at all.
The authored numbers it replaced disagreed with these blocks in both directions: a 4 health gnat
published as level 3, and Ordrun 200 health published as level 20.

---------------------------------------------------------------------------------------------
LOOKUP. world/regionBuilder.ts stamps each spawned entity with `meta.family`, `meta.groupId` and
`tier`, and nothing else. So every stat block is published twice: once under `<family>_t<tier>`
(use `enemyIdFor`) and once under each content/regions.ts group id, so
`content.enemy(entity.meta.groupId)` resolves directly. Ordrun group has count 1, which means its
entity id IS `ordrun`, so `content.enemy("ordrun")` works too.

---------------------------------------------------------------------------------------------
THE ARITHMETIC. Every defender stat below is SOLVED from PRD 2.4 time-to-kill table, not chosen.
Formulas: attackRoll = (attackLevel + 9) * (1 + accuracy/100) * styleFactor,
defenceRoll = (defenceLevel + 9) * (1 + armour/100),
hitChance = attackRoll/(attackRoll+defenceRoll),
damage/s = hitChance * (1 + maxHit)/2 / attackSpeedSeconds.

The PRD wrote its rows against the creatures this table replaced, so each row now names the
animal that inherited it. The numbers are unchanged; only the thing wearing them is.

 PRD row                                                  | inherited by      | result
 --------------------------------------------------------- | ----------------- | --------------
 Melee 1 unarmed, 50%, maxHit 2, 19 s                       | Redsill Frog      | 10/(10+10)=50%
                                                            | defL 1, armour 0  | 6/0.3125 = 19.2 s
 Melee 3 Grithe dagger, 56%, maxHit 4, 10 s                 | Redsill Frog      | 12.72/22.72=56%
                                                            |                   | 6/0.5831 = 10.3 s
 Melee 7 Corven sword, 51%, maxHit 7, 30 s                  | Duskoak Stag      | 18.24/35.84=50.9%
                                                            | defL 7, armour 10 | 26/0.8482 = 30.7 s
 Melee 12 Kaldite sword, 51%, 11, 27 s                      | Scree Boar        | 26.88/52.88=50.8%
                                                            | defL 11, arm 30   | 34/1.2708 = 26.8 s
 Melee 12 Kaldite sword, 46%, 11, 33 s                      | Highcairn Bear    | 26.88/57.88=46.4%
                                                            | defL 11, arm 55   | 38/1.1610 = 32.7 s
 Melee 18 tier 10 kit vs Ordrun, 45%, 12, 165 s             | unchanged         | 38.34/85.32=44.9%
                                                            | defL 20, arm 62   | 200/1.2170 = 164.3 s
 Ordrun deals about 1.02 damage/s through tier 10 armour    | unchanged         | 37.95/80.61=47.1%
                                                            |                   | = 1.020 dmg/s

MAGIC VS MELEE, the gate criterion in PRD 2.4. Rimewash at Magic 10 in the full tier 10 magic kit
(magicPower 32 -> maxHit 15, magicAccuracy 47 -> attackRoll 32.12, styleFactor 1.15):
  vs Highcairn Bear (magicArmour  10): defenceRoll 22.0 -> 59.3% -> 1.583 dmg/s -> 24.0 s
                                       melee at Melee 12 takes 32.7 s. MAGIC WINS by 27%. MATCHES PRD.
  vs Scree Boar     (magicArmour 115): defenceRoll 43.0 -> 42.8% -> 1.140 dmg/s -> 29.8 s
                                       melee at Melee 12 takes 26.8 s. MELEE WINS by 10%.

DEVIATION, flagged rather than hidden: PRD 2.4 quotes that second block at magicArmour +40. That
number cannot produce "melee wins" alongside the 24 s bear claim; the full argument is written on
the `boar_t10` row itself. Its armour stays at the PRD +30. This keeps both halves of the balance
gate true and makes "the mud-caked thing shrugs off lightning" read explicit.
---------------------------------------------------------------------------------------------
```
