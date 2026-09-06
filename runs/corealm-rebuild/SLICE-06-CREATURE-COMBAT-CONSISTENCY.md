# Slice 06 — Creature combat consistency

Branch `finish/slice-06-combat-consistency`, rebased onto `main` at bcaba21 (slices 04, 09 and 10
merged, 404 manifest assets). Port 4182. All browser work ran on the RTX 5080 hardware renderer
(`ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11)`), normal simulation time, no
forced pose, health, damage, AI or clock, and every session hashed the bytes the server actually
served against the candidate catalogue.

## The chase speed defect

`render/entityViews.ts` retimes a gait to the ground it covers, so asking a creature for more speed
than its cycle can carry does not slide its feet - it spins them. `systems/enemyAI.ts` stepped
every chase and every walk home at one shared `CREATURE_RUN_SPEED` of 4.68 m/s regardless of what
the creature's own cycle could carry. Measured against the shipped stride metadata, 21 of the 53
spawned world residents were over the run cadence ceiling, and the same again on the return leg:

| resident | native run stride | cadence at 4.68 m/s | cadence at its own ceiling |
| --- | --- | --- | --- |
| `reedbank_goose_residents` | 0.433 m/s | 20.25 Hz | 0.66 m/s |
| `slateback_tortoise_residents` | 0.168 m/s | 15.44 Hz | 0.86 m/s |
| `kiln_salamander_residents` | 0.373 m/s | 15.07 Hz | 0.88 m/s |
| `gravelmaw_ch2_scorpions` | 0.310 m/s | 10.84 Hz | 0.56 m/s |
| `redsill_frogs` | 0.300 m/s | 9.25 Hz | 1.44 m/s |
| `marchfield_coneys` | 1.312 m/s | 9.15 Hz | 1.46 m/s |

The roster had already been retuned once for exactly this. The `EnemyDef.moveSpeedMps` comment
records a coney at 3.94 Hz, a frog at 3.62 and a goat at 3.35, "all at zero foot slide, and all
reported from play as feet moving rapidly and jittering". A goose at 20.3 Hz is five times that.

### Solved from the run clip, after a first attempt solved it from the wrong one

The first fix here capped the chase with `EnemyDef.moveSpeedMps`. That was wrong, and it was caught
in review before merge. `moveSpeedMps` is solved off the WALK cycle and belongs to pottering; the
chase plays the RUN cycle. Capping one with the other measures a cadence nothing plays - the same
category of mistake as stepping a walk at the run speed.

The cost was not a slower monster but no monster. It put 109 of the 118 spawnable enemies under the
player's 5.2 m/s and 103 under 3 m/s: every goblin and skeleton at 1.60, both zombies at 1.20, the
stone and iron golems at 1.30, and Ordrun - a boss - at 2.11. A player who simply walked away could
not have been caught by anything in the bestiary.

`CREATURE_PURSUIT_CEILING_MPS` in `content/creatureMotionTiming.ts` solves the bound off the clip
that actually plays, `3 Hz * impliedRunMps * runClipSeconds`, and `enemyPursuitSpeedMps` applies it.
Off the run cycle the ceiling barely binds a hunter at all:

| enemy | resolved pursuit | enemy | resolved pursuit |
| --- | --- | --- | --- |
| goblin scout / archer / shaman | 4.68 | stone / iron golem | 4.68 |
| skeleton soldier / archer / mage | 4.68 | lava golem, beetle golem | 4.68 |
| grave ghoul | 4.68 | plague zombie | 4.68 |
| wraith, banshee, revenant | 4.68 | mossback sentinel | 4.22 |
| every boss and miniboss, Ordrun included | 4.68 | zombie (tier 1) | 3.46 |
| | | webweaver spider | 2.76 |

18 of 80 blocks now resolve under 3 m/s, against 103 of 118 under the walk-solved cap, and they are
the geese, tortoises, crabs, frogs, hens and coneys - ambient fauna whose slowness is a fact about
their bodies. Only two hunters come under the shared speed at all: the shambling zombie, which
should be slower than a sprint, and the webweaver spider.

The stored ceilings are native, so they are scaled by the same factor the renderer scales the drawn
stride by - `view.scale * tierSilhouetteScale(tier) * scaleAxes[2]` - times the smallest `buildFor`
variation, since that one is hashed per individual and content cannot see it. A hen solving exactly
to the ceiling landed at 3.0009 Hz, so the cap leaves one percent of headroom: the ceiling is a
must-not-exceed, not a target.

Assets with no measured stride are omitted from the table and keep the shared speed, which retired
the hand-kept family list the first attempt needed. The floating undead, the viper and the
`outfit_*` raiders now fall out of one rule: no planted foot, no contact to slide. The rat and the
snail are omitted on the artefact footing `tests/creature-gait.test.ts` already excludes them on.

### Three pins against a repeat

Added to `tests/creature-gait.test.ts`, and each verified by injecting the mistake it guards:

- the ceiling table is checked entry by entry against the manifest, off the clip the chase plays.
  A walk-derived table trips it.
- every boss and miniboss must keep the full shared speed. Capping with `moveSpeedMps` trips it and
  names all seven.
- every bestiary monster must outpace a walking player. Those monsters spawn outside the region
  enemy groups, so nothing else in the file covered them; capping with `moveSpeedMps` trips it and
  names each one at 1.20-1.60 against a 1.6 m/s walk.

A creature also now walks home at the speed it chased at. Returning faster than you can chase was an
artefact of `ENEMY_RETURN_SPEED_MPS` being redefined to `CREATURE_RUN_SPEED` while `ENEMY_SPEED_MPS`
stayed at 3.1, and it is what pushed the return leg over the ceiling first - the "19 residents,
return gait only" signature reported from slice 04.

`fb5c839` ("Preserve gait on retarget") was ruled out as the cause. It touches `input/mouse.ts`,
`render/overlays.ts` and `systems/movement.ts` - the PLAYER's navigation retarget - and no file on
the creature gait path: not `enemyAI.ts`, `app/config.ts`, `render/entityViews.ts`, the manifest or
the test. No cadence ceiling was raised and no asset metadata was touched.

## Rhino attack and recoil

The repaired Attack is now public for all three families. Its anticipation no longer folds the head
into the torso, and the contact marker moved from 0.7 to the remeasured 0.33229264631653577 — 0.7
was a third of a second after the horn had already swept past the player and started back down.

| family | damage | inspected sequence | evidence |
| --- | --- | --- | --- |
| `boss_rhino_air` | 5 | head attached, horn low at 0.18 s; horn through the player's chest as the damage number spawns at 0.42 s; settled recovery | `test-results/rhino-air-attack/` |
| `boss_rhino_earth` | 7 | wind-up 0.17 s; horn through the upper body 0.40 s; horn already descending at the old 0.7 mark (0.87 s); settled 1.10 s | `test-results/rhino-earth-attack/` |
| `boss_rhino_water` | 9 | wind-up 0.08 s; horn through the torso 0.52 s, with the player's own `Hit_Chest` firing on the same frame | `test-results/rhino-water-attack/` |

Directional recoil is complete for all three families on all three sides — each the authored
`<Hit|HitLeft|HitRight>_MaskedOverlay` over an unchanged base gait, `native-masked`, driven from
the head hub with every leg bone in the protected set. Left and right mirror each other, the body
and all four planted hooves are unchanged between the before and during frames, and nothing
collapses. Captured at a measured drawn recoil weight of 0.93–0.999.

Two harness defects were fixed first, to get reviewable evidence rather than to change what
happened (`tools/creature-motion/rhino-directional-proof.ts`):

- it photographed the first frame that SAW the overlay, which is drawn at weight ~0, so every
  stored `-during` frame was the plain base pose. It now follows the same overlay to full weight.
- the lab camera was pinned at 5 m, which is inside a 2.4 m-radius boss rhino; the frames came back
  as flank and belly with the head — the only place a masked recoil is drawn — out of shot. It is
  now framed off the production body radius.

The stored earth run predated both fixes and reported `incomplete`. It was rerun, and air and water
were rerun on the same harness so all three sit on equal terms.

## Species check matrix

`turn`, `walk/run` and `transitions` for the twelve legacy mammals and four ground creatures are
root-accepted from the earlier sessions recorded in
`art/rebuild/candidates/finish-motion/BROWSER-REVIEW.md` and `legacy-eight-promotion.json`. That
acceptance is carried forward here, not re-derived.

| species | cadence + stride | turn / walk / run / transitions | attack at damage marker | directional hit | settled death |
| --- | --- | --- | --- | --- | --- |
| `boss_rhino_air` | pass (CPU) | pass (carried) | **pass** — 5 dmg, inspected | **pass** — Hit / HitLeft / HitRight | hold |
| `boss_rhino_earth` | pass (CPU) | pass (carried) | **pass** — 7 dmg, inspected | **pass** — Hit / HitLeft / HitRight | hold |
| `boss_rhino_water` | pass (CPU) | pass (carried) | **pass** — 9 dmg, inspected | **pass** — Hit / HitLeft / HitRight | hold |
| `animal_coyote` | pass (CPU) | pass (carried) | **pass** — 6 events on marker, bite reaches | partial — front `Hit_MaskedOverlay` only | **pass** — inspected |
| `animal_bear` | pass (CPU) | pass (carried) | **hold** — marker exact, swipe falls short | hold | hold |
| `animal_aurochs`, `animal_goat`, `animal_rabbit_dark` | pass (CPU) | pass (carried) | hold | hold | hold |
| `animal_cattle`, `animal_deer`, `animal_hog`, `animal_rat`, `animal_boar`, `animal_ibex`, `animal_rabbit` | pass (CPU) | pass (carried) | hold | hold | hold |
| `animal_crab`, `animal_frog`, `animal_frog_green`, `animal_scorpion` | pass (CPU) | pass (carried) | hold | hold | hold |
| the remaining 30 expansion residents | pass (CPU) | hold | hold | hold | hold |

"pass (CPU)" is `tests/creature-gait.test.ts`: every spawned resident's walk, run and return retimed
against its own shipped stride, inside the cadence ceilings and under 5% foot slide, at the speed
`enemyAI` actually moves it. `tools/creature-motion/motion-metadata-audit.json` separately confirms
all 19 audited public assets ship Attack, Hit, HitLeft, HitRight and Death with consistent
metadata, with zero metadata problems.

### Bear and coyote attack contact

`test-results/attack-contact-1/`. Ordinary lab setup, player attack and stop, live AI; nothing
forced. Six real damage events each, zero unattributed health deltas, served bytes hashed.

Both land on their authored marker, repeatably to four decimal places:

| species | authored marker | observed clip phase | events |
| --- | --- | --- | --- |
| `animal_bear` | 0.15 (0.370 s of a 2.467 s Attack) | 0.1597 (0.394 s) | 6, damage 6/1/5/6/5/5 |
| `animal_coyote` | 0.525 (0.735 s of a 1.400 s Attack) | 0.5595 (0.783 s) | 6, damage 6/2/3/1/4/3 |

The residual in both cases is under one simulation tick, which is the quantization the production
tick imposes on the offline marker. Timing: **pass** for both.

Physical reach is where they part, and it is the reason the helper warns that a marker is not
contact acceptance:

- **`animal_coyote`: pass.** At the damage frame the wolf's muzzle is at the player's hand and hip.
  The gap is 1.46 m against a 0.86 m body radius, and the head reaches forward far enough to close
  the remaining 0.60 m. The bite lands on the body it damages.
- **`animal_bear`: hold.** The bear rears onto its hind legs and swipes, and at the damage frame
  the raised paw is still most of a body away from the player — a clear gap in the inspected still.
  The geometry is the same 0.60 m outside the body radius (2.01 m gap against a 1.41 m radius), but
  rearing carries the paw UP rather than forward, so the standoff `enemyHoldMetres` holds is never
  closed. This is not a timing or metadata defect: the marker is exact. It needs either a shorter
  hold for this family or an Attack with forward travel in it, and both sit outside the edit
  surface for this slice — `content/enemies.ts` is restricted, and the clip is an authoring task.

### Coyote combat residency

`test-results/combat-residency-coyote/`. Ordinary player combat, nothing forced.

- **Death: pass.** Death at 34.37 s on the authored `Death` clip. The settled corpse at 38.53 s sits
  at a byte-identical position, so nothing drifts or slides after it lands. The inspected frame
  shows the animal on its side with flank, shoulder, head and tail all in ground contact and the
  legs folded naturally, with no floating and no terrain intersection.
- **Directional hit: partial.** Only the front `Hit_MaskedOverlay` (`native-masked`) was observed;
  the helper's 10 s window never produced a naturally landed side hit. One observed side is not
  three-direction coverage.
- **Live/sampled residency: hold.** The `sampled-rig` crossing was not observed inside the 3.5 s
  budget, so phase continuity across the rig switch is unproven for this species.

## What is not proven

- Attack contact against the damage marker for every species except the three rhinos,
  `animal_bear` and `animal_coyote`. Six of the eight pairs in `COMBAT-PROOF-PLAN.md` remain;
  `attack-contact-proof.ts` runs them a pair per session.
- Whether the bear's short swipe is family-wide. Only the reared bear was measured, and the other
  large quadrupeds may hold the same standoff against a similar strike.
- Left and right directional recoil for every species except the three rhinos.
- Settled death for every species except `animal_coyote`.
- Live to sampled residency phase continuity for any species.
- Turn and transition coverage for the 30 expansion residents outside the twelve legacy mammals and
  four ground creatures.

None of these are known defects. They are uncollected evidence, and each needs a browser session.

## Deletions

- `test-results/rhino-directional-{air,earth,water}` were regenerated; the pre-fix captures they
  replaced — zero-weight recoil frames, camera inside the body — are gone.
- Session videos under `test-results/**/video` were deleted once this record cited the stills and
  reports drawn from them.
- `test-results/legacy-reproduce/*.glb` deleted; the reproduction scripts that regenerate them are
  kept.

## Shared and restricted files touched

- `game/src/systems/enemyAI.ts` — two `stepToward` call sites routed through
  `enemyPursuitSpeedMps`, plus the `ENEMY_RETURN_SPEED_MPS` doc comment. Nothing else.
- `game/src/content/index.ts` — added `enemyPursuitSpeedMps`. Not a restricted file.
- `game/src/content/creatureMotionTiming.ts` — the three rhino contact markers and
  `CREATURE_PURSUIT_CEILING_MPS`, beside the per-asset motion facts it already holds. Not
  restricted.
- `game/public/assets/manifest.json` — only via `tools/promote-finish-assets.ts --apply`.
- `content/enemies.ts`, `items.ts`, `equipment.ts`, `recipes.ts`, `regions.ts`, `contracts.ts`,
  `app/boot.ts`, `world/regionBuilder.ts`, `systems/combat.ts`, `render/entityViews.ts` and the save
  schemas were NOT touched.
