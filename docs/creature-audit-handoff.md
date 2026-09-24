# Creature audit handoff, 2026-09-23

## Task and boundaries

Continue the creature asset audit/rework in C:/Users/Borg/Documents/GitHub/Corealm2. Original interrupted T3 thread: 3f5858fa-140d-4234-bef4-936d9868b528. This document is intended for an agent with no conversation context.

The USER MOVED REGION STREAMING / INVISIBLE ENEMIES TO ANOTHER THREAD. Do not change renderer, shader warmup, startup, or streaming as part of this continuation. Coordinate if another thread changes shared files. Focus on creatures.

User explicitly requests parallel GPT-6 Sol implementation/asset workers and GPT-6 Luna reviewers, with explicit nonoverlapping file ownership. Use GPT-6 Astra medium only after Sol repeatedly fails an item. Root owns shared contracts, integration, acceptance and combined checks. Keep production ready and push small accepted batches regularly. Do not accumulate another huge local backlog or run excessive redundant tests.

Read AGENTS.md and docs/feature-lab.md first. The original full audit is docs/creature-asset-audit.md. Its complete-model table records ORIGINAL verdicts and old appearances, even for assets already replaced; subtract the completed list below. Old detached-camera screenshots are diagnostic only, not valid new acceptance views.

## Continuation batch

Fen Crawler, Rootbound Colossus, Mooncap Sporekin and Thicket Spirit are now promoted after matching-hash checks and fresh Sol/Luna review. The source preservation commit is 85f8f4b, pushed to main. Sources include the formerly local-only Mooncap and Thicket originals. Silverthorn source was preserved with the shared Rootheart builder; it was accepted later in the third continuation batch below.

Current acceptance evidence is in `test-results/creature-audit/continuation-session/session.jsonl`. Fen and Rootheart whole-corpse views and both Thicket tier scales were recaptured with normal player-follow cameras. Lab combat showed Fen 30 -> 26 HP, Rootheart 124 -> 118 HP, and elder Thicket 208 -> 202 -> 190 HP. Mooncap retains matching-hash round3 combat/death proof. Typecheck, six focused creature/content test files (35 tests) and content validation passed. The three known lab-only missing-model warnings remain. Production build passed, including navigation, world/server packs and asset budgets. Representative Fen Crawler world acceptance passed in the rebaked Blackwater population: HP 17 -> 10 -> 0, Run/Attack/Death, one drawn mesh throughout the sampled interaction, normal player-follow camera and no errors. The corrected tier-5 body radius is 0.38148m. Other three families still need representative world views. Initial teleport visibility was delayed; no streaming changes were made.

Production catalog now has 53 entries. Remaining original verdicts: 50 replacements and 41 polish assets.

Vault Custodian and Faeholme Nightbloom are promoted in the second continuation batch. Their source preservation commit is 72ddc08. Fresh whole-corpse views passed at normal camera angles; Vault combat showed 38 -> 35 -> 29 HP and Nightbloom 724 -> 715 -> 695 HP with Attack. Vault scale is 0.84. Typecheck, the six focused files / 35 tests, content validation and production build passed for this second batch. Luna source review found no defects. The first Vault world check was interrupted by a stopped development server and failed model requests. After restart, normal-camera world combat at scree_boars_1 showed HP 30 -> 17 -> 0 and visible full-size sentinels, with no current-document game errors. Instanced bodies were slow to enter the animated Death path; world death animation remains a follow-up for the separate rendering thread. See vault-world-contact-12.png and its motion journal.

Silverthorn and Flint are now promoted in the third continuation batch. Source commits: e96445c preserves the mandible family, 62ce531 repairs Silverthorn. Flint Death preserves full body scale; Silverthorn uses a relaxed rest-derived fall with CPU-baked ground contact. Fresh root/Luna corpse review passed; Silverthorn combat showed 164 -> 155 -> 135 HP with Run/Attack, and Flint retained 38 -> 32 HP proof. Typecheck, six focused files / 35 tests, content validation and the full production build passed for this third batch, including navigation, world/server packs and budgets. Luna integration review found no blocking defects. Representative Flint world interaction passed at pack_karrowmoor_tarn_track_east_mandibles_1: HP 38 -> 25 -> 0, Walk/Run/Death, one drawn mesh, normal camera and no errors. Evidence: flint-world-ready.png, flint-world-combat-07.png and motion samples. Silverthorn authored-world view remains pending. Beetle Golem is rejected as a repeated Flint silhouette and flagged to the user as an additional source gap. Do not redo these eight promoted assets from the original verdict table.

## Delivered Beetle Golem, acceptance pending

The user supplied `C:/Users/Borg/Downloads/beetle+golem.glb` after rejecting the repeated Flint silhouette. It has a useful native 67-joint rig, 5,166 triangles and detailed green/gold/purple PBR maps, with no clips. Sol workers own separate parts of `assets/art/tripo/imports/creatures/audit-user-beetle-golem/`: rig/source/builder/catalog files versus `textures/` shell optics. Preserve the supplied source. User direction: low four-limbed walk matching the attached reference, faster combat pursuit, stand on hindlegs and swing a forearm when attacking, and green iridescent shell plates. Attack contact/recovery must match the new clip. Existing combat AI already pursues provoked players and holds position during committed attacks; prove these behaviors in the lab. This asset is not accepted or promoted yet.

The original source and reference are preserved under `sources/`; source SHA-256 is `fb03cd921a5ffed201d577cf4102a182d9826f12664e14d11db38b7a60db5193`, matching Downloads. `textures/build-mask.mjs` reproducibly derives shell optics from its embedded base-color map. Luna confirmed the current production material conversion supports iridescence/clearcoat. Two Sol posture attempts failed normal-camera visual review with distorted shoulders/torso despite CPU ground-contact checks. The unmodified source renders correctly. Astra medium now owns the rig repair under the escalation rule above; textures remain separate. Do not promote either failed candidate. Evidence: `user-beetle-first-idle-04.png`, `user-beetle-second-idle-04.png`, `user-beetle-source-idle.png` in the continuation session directory.

## Previous baseline

Main was pushed successfully at 2bb5a19497a12d542434b081dc17e49ebc9a5500. Remote main matched HEAD. Temporary upload branch was deleted. GitHub Pages workflow 35937296213 was still running at last check; do not claim it deployed successfully without checking. No remote game server update was performed.

166 distinct active model assets audited: 101 REPLACE, 43 POLISH, 22 KEEP. Completed integration: 43 replacements + 2 polish = 45 assets. Giant Rat missing-reference repair is additional. Remaining: 58 replacement verdicts + 41 polish verdicts. Counts are model assets, not every species/encounter variant. Most integrated assets still need representative authored-world placement/scale acceptance; lab acceptance is not proof for every region.

Latest commits:
- 9d10702: reviewed source assets for marshal/petalguards/reliquaries/reaper.
- 15b118a: startup shader/hidden interior performance fix, now out of this task's scope.
- 49f380e: six more reviewed production creature replacements.
- 2bb5a19: updated world placement/navmesh/server packs.

Baseline validation passed: production build including asset budgets/world/server packs; typecheck; six focused creature/content files, 35 tests; render-related checks, 59 tests total after a naming fix. Authored world became ready within 74 seconds against a 120-second budget. Field Wasp real-world interaction showed health 7 -> 4 -> 0, Attack -> Death, drawn geometry, normal camera and no errors. Do not rerun all checks for a docs-only or source-only step.

## Art and gameplay requirements

- Finished reskins require intricate image-generated texture maps with layered colors and surface detail. No monochromatic recolors.
- Fairy regions need fantasy creature bases; frog, snail and hart are allowed exceptions.
- Lower-level creatures should be smaller/simpler. Larger/aggressive high-tier forms need appropriate levels and better drops. Check effective derived encounter level, not just raw definition level.
- Preserve useful original geometry, UVs, native rig and PBR when appropriate. CPU animation validation is useful but not visual acceptance.
- User requested fantasy wasp, not a realistic wasp. The accepted P1/2K/PBR wasp family is already integrated. Do not follow the obsolete realistic-wasp brief in the original table.
- Badger was intentionally replaced by user's selected Minotaur base, integrated as a quadruped. Do not replace it with another badger.
- User rejected chunky Quarry concepts and supplied their own rock golem; it is integrated as Quarry Warden. Do not regenerate it. Original is preserved at assets/art/tripo/imports/creatures/audit-user-rock-golem/rock-golem-user-original.glb.
- The user will manually create the 18 proposed new bases covering 19 IDs, including one shared botanical veilspirit base. Do not generate models or start Tripo jobs. Continue staged candidates and inspect possible owned sources first; flag additional source gaps to the user. Process each delivered model for its intended IDs, optimization, rigging, animation and detailed textures, then update docs/creature-generation-queue.md.
- User is logged into Tripo in existing Chrome. Explicit authorization exists to attach Playwright to existing Chrome on port 9333. Reuse that session, do not create a new login profile. Inspect current tabs first. No Tripo job needs to be resumed blindly from stale context.

## Files, evidence and dirty work

- Production-only accepted catalog: test-results/creature-audit/production-candidates.json, 53 entries.
- Combined lab catalog: test-results/creature-audit/candidates.json, last 67 entries, including staged work. NOT a promotion/acceptance list.
- Lab journal/evidence: test-results/creature-audit/resume-session/session.jsonl and screenshots under that session directory. Search filenames rather than dumping the huge journal.
- Source/build directories: assets/art/tripo/imports/creatures/audit-*/. Candidate-specific catalogs and builders live there. Many staged directories are untracked and LOCAL ONLY. A fresh clone does not contain them. Preserve them on this workstation or explicitly transfer/commit reviewed source work.
- Many unrelated untracked Tripo exports and armor files also exist. Never git add everything or delete unknown files. Last four tracked dirty files were boot.ts, gameDebug.ts, assets.ts and entityViews.ts with line-ending-only differences; recheck before touching because another thread may now be editing them.
- Source builder hashes are sensitive to line endings. Committed .gitattributes preserves reviewed creature .mjs/.ts bytes. Do not casually normalize them.
- Candidate catalogs vary: files map vs candidateFile, and relative paths vs full repository-relative paths. Resolve per catalog. Refresh hashes after a worker rebuilds an asset. An old labAccepted flag does not authorize promotion.

## Start here: staged replacements

All paths below are under assets/art/tripo/imports/creatures/. The status column distinguishes promoted entries from pending candidates.

| Candidate / production ID | Directory | Current proof and next action |
| --- | --- | --- |
| Silverthorn Harrow / creature_silverthorn_harrow | audit-rootwood-family | Promoted SHA 0acc1a96ca6f2464f79ba6c19272d4d5691a5046f6184e05f1aa4f972a2c43a0. Earlier upright/tangled poses are rejected. Accepted evidence: silverthorn-relaxed-corpse-07.png and silverthorn-relaxed-side-07.png; measured final groundY approximately zero, full width, no scale channels. Rootheart bytes unchanged. |
| Nightbloom / fairy_guardian_06_faeholme | audit-nightbloom | Promoted SHA f1e7c67fb75735c421585bf3b7f9caffc867faaf87ebdb25ecf95c49367df696. Idle, attack/damage and whole grounded corpse passed. Preset species:guardian_06_faeholme, derived level189. Does NOT resolve fantasy_monster_06. |
| Vault Custodian / creature_vault_custodian | audit-vault-custodian | Promoted SHA 7fd6db127e826c93f4c54f3322f0da0798bdb627d937fa5be2c07457035f9d67. Fresh visual/combat/death accepted, scale0.84. World combat checked; delayed Death rig transition noted above. |
| Flint Mandible / creature_flint_mandible | audit-mandible-family | Promoted SHA ea7bed07eeb44578a0804af603489601f0659d50d7ee366c8714fe24ce4ebe82. Root-scale shrinking removed. Full-width folded-leg corpse accepted by root/Luna in flint-repaired-corpse-07.png. |
| Beetle Golem / creature_beetle_golem | audit-mandible-family; audit-user-beetle-golem | Enlarged Flint candidate REJECTED and preserved. User supplied a distinct horned golem; native-rig quadrupedal locomotion, standing swing and iridescent shell adaptation underway. Production unchanged pending acceptance. |

All nine original staged replacements have a disposition: eight integrated and Beetle Golem rejected. Continue staged polish and owned-source inspection while waiting for user-supplied models. The queue records missing approved Moonpetal/Scree exports and the unsuitable Cinder Ravager dragon proposal.

## Staged polish and lab-only repairs

| Work | Directory | Remaining |
| --- | --- | --- |
| Crown Hart | audit-crown-hart | Generated russet/cream/gold coat and ivory antler grain, preserved rig/eight clips. No added crown geometry. Review whether it now reads sufficiently regal. |
| Starhorn Hart | audit-starhorn-hart | Generated violet constellation coat/opal antlers, antler geometry broadened/taller, eight clips. Review normal-camera scale and silhouette. |
| Bighorn | audit-bighorn | Generated layered wool; torso about7% broader, horns/hooves preserved. Review idle/walk. |
| Stag Beetle | audit-antler-beetle | Generated jade/olive/bronze segmented skin, rig and eight clips unchanged. Catalog uses candidateFile rather than files. Review readability. |
| Goblin Shaman | audit-goblin-shaman | Three generated skin/cloth atlases; free-hand casting overlay; staff unchanged. Review actual attack and preserve source licenses. |
| Mooncap and Starcap Snails | audit-fairy-snails | Distinct sources and skins, repaired gait/death. Check current species scales: Mooncap was too large and Starcap too small. Starcap has no added literal fungal/star cap, decide if name still fits. |
| Skeleton Archer/Soldier/Mage elites | audit-skeleton-elites | New IDs creature_skeleton_archer_elite, creature_skeleton_soldier_elite, creature_skeleton_mage_elite. Separate generated bone/gear atlases, preserved24-joint/eight-clip motion, scale1.08/1.12/1.06. Not ordinary catalog presets yet: temporarily route these candidate files to existing elite presets for review. Integrate only t50/t70 and appropriate named high-tier encounters; keep starter skeletons unchanged. Check if silhouettes are sufficiently elite, not only better textures. |
| Wild Goblin lab missing model | audit-lab-missing | Idle/combat previously passed; needs held grounded death screenshot. Preset candidate:wild_goblin. |
| Cave Roach lab missing model | audit-lab-missing | CPU corpse grounding passed, needs visual/motion/combat/death review. Preset candidate:cave_roach. |
| Troll Mauler lab missing model | audit-lab-missing | Cloth alpha-mask white rectangle repaired. Death still82% standing height, NOT READY. Needs coordinated multi-bone collapse then full review. Preset candidate:troll_mauler. |

Round4 captures were queued in the existing lab for crown-hart, starhorn, bighorn, stag-beetle, shaman, mooncap-snail, starcap-snail, flint-mandible and beetle-golem. Look for round4-<name>-idle.png and round4-<name>-walk-04.png; inspect journal for completion before relying on them. Root had not reviewed these images. Fresh Luna critics must use current round4 files, not original audit images.

## Lab and integration procedure

Live Vite URL: http://127.0.0.1:62553. Server was restarted at that same port after it stopped; current server tool session77793, browser lab session10015. The prior continuation lab session8208 was closed after a paused callTool stalled it. Never call a gameplay tool while the simulation is paused; unpause first. IDs may not survive into a new agent thread. Check existing processes/ports and reuse the server/browser if available. Follow the documented lab session protocol instead of inventing another fixture. The session is left at /index.html?mode=combat&creatures=1 using production assets. Install the combined candidate catalog explicitly before reviewing staged polish.

Useful existing session commands:

~~~json
{"op":"candidates","catalog":"test-results/creature-audit/candidates.json"}
{"op":"reopen"}
{"op":"call","surface":"creatures","method":"show","args":["species:vault_custodian"]}
{"op":"call","surface":"creatures","method":"place","args":[1.5,-3,0.7]}
{"op":"camera","pose":{"x":0,"y":0,"z":0,"yaw":0,"pitch":0.3,"distance":6,"detached":false}}
{"op":"capture","name":"review-vault-idle"}
{"op":"call","surface":"creatures","method":"play","args":["walk"]}
{"op":"sampleMotion","samples":7,"intervalMs":90,"captureFrames":[4],"name":"review-vault-walk"}
~~~

Use real combat spawn/attack and compare semantic HP and clips. Gallery play does not support Death; kill a spawned lab creature for corpse proof. Query actual spawned IDs, do not assume counters. For a clear whole corpse, move gallery display aside, spawn1.5m away, normal player-focused camera pitch.65/distance10, remove only the test loot entity if it obstructs view, then capture about.7seconds after death. Never detach camera or exceed interactive limits. Death must finish before corpse fade; many repaired clips reach grounded final pose around.65-.74s and hold through1.5s. A sampled rig is not proof a mesh was drawn; inspect screenshot/drawn bounds and readiness.

Promotion tool: tools/promote-finish-assets.ts with candidate catalog, explicit IDs and correct source root; dry-run first, apply only accepted entries. Do not promote the entire combined lab catalog. Merge exact current metadata into production manifests, remove obsolete timing/stride overrides only for affected entries, update attack contact, scale, footprints and descriptions/drops. Root owns shared edits. Preserve user Quarry footprint: do not blindly regenerate every asset radius from T-pose bounds.

Run content compilation/validation and the smallest relevant existing regressions. Prior focused tests: creature-gait, biome-population, content-species-json-projections, content-loot-json, creature-habitats, starter-creatures. Use actual test filenames from repository. Build once after a production batch settles. World/navmesh packs can churn hundreds of files when shared content revision changes; verify expected cause. Update audit status only for truly promoted assets; commit sources and production changes in reviewable batches and push regularly. No git-add-all.

Representative authored-world acceptance remains due for most integrated families. Do that after lab integration using normal gameplay camera and semantic state, while leaving streaming fixes to the user's other thread. The ledger's Field Wasp world-pending line is stale: a Field Wasp world encounter passed. Veil Reaper higher-tier scale also passed in veil-production-high-tier-ready.png; its old pending note can be corrected. Do not generalize these passes to all regions.

## Exhaustive remaining replacement list

These54 IDs were computed by subtracting the49 production catalog IDs from the original audit table. Their detailed visual defects and replacement briefs are in docs/creature-asset-audit.md. Staged items above are included until promoted. Names/levels below are ORIGINAL audit observations, not authoritative current balance.

| Asset ID | Original creatures / levels |
| --- | --- |
| animal_crab | Creek Crab@1 |
| creature_cindercrest_salamander | Cindercrest Salamander@25 |
| creature_blackwater_heron | Heron@6 |
| creature_marsh_moose | Moose@13 |
| creature_rimeback_tortoise | Rimeback Tortoise@13 |
| creature_scree_bustard | Bustard@12 |
| creature_beetle_golem | Beetle Golem@13 |
| creature_boss_mossbound | Forest Ogre@15 |
| creature_flint_mandible | Flint Mandible@13 |
| creature_bloomheart_matriarch | Bloomheart Matriarch@79; Amethyst Sovereign@189 |
| creature_hollow_bough | Hollow Bough@76; Hollow Bough@75; Hollow Bough@73; Hollow Bough@13 |
| creature_silverthorn_harrow | Silverthorn Harrow@63 |
| creature_prismatic_sprite | Prismatic Sprite@96 |
| creature_reed_strider | Reed Strider@5; Reed Strider@6; Reed Strider@12 |
| creature_rift_carapace | Rift Carapace@105; Rift Carapace@108; Rift Carapace@107; Rift Carapace@118 |
| creature_chainbound_archon | Chainbound Archon@233; Chainbound Archon@130 |
| creature_gloam_wraith | Gloam Wraith@115; Gloam Wraith@114; Gloam Wraith@117; Gloam Wraith@130 |
| creature_iron_golem | Iron Golem@28 |
| creature_ivory_castellan | Ivory Castellan@112 |
| creature_moonpetal_stalker | Moonpetal Stalker@40 |
| creature_scree_watcher | Scree Watcher@13; Scree Watcher@12 |
| creature_vault_custodian | Vault Custodian@12; Vault Custodian@13 |
| creature_wraith | Wraith@71; Wraith@69; Wraith@66; Wraith@12 |
| fairy_garden_veilspirit_faeholme | Orchid Veilspirit@115 |
| fairy_garden_veilspirit_gloamgarden | Thistledown Veilspirit@46 |
| creature_pallid_shade | Pallid Shade@67; Pallid Shade@64; Pallid Shade@72; Pallid Shade@12 |
| creature_boss_galeskin | Galeskin@11 |
| outfit_male_peasant | Road Bandit@1 |
| fantasy_monster_01 | Bramblehorn@23; Bramblehorn@49; Bramblehorn@149; Bramblehorn@233; Bramblehorn@112; Bramblehorn@79 |
| fairy_guardian_02_gloamgarden | Gloamwarden@79 |
| fantasy_monster_02 | Gloamwarden@23; Gloamwarden@49; Gloamwarden@149; Gloamwarden@233; Gloamwarden@112; Gloamwarden@189 |
| fantasy_monster_04 | Hollow Crown@23; Hollow Crown@49; Hollow Crown@149; Hollow Crown@233; Hollow Crown@112; Hollow Crown@79 |
| fantasy_monster_05 | Stonevein@23; Stonevein@49; Stonevein@149; Stonevein@233; Stonevein@112; Stonevein@79 |
| fairy_guardian_06_faeholme | Nightbloom@189 |
| fantasy_monster_06 | Nightbloom@23; Nightbloom@49; Nightbloom@149; Nightbloom@233; Nightbloom@112; Nightbloom@79 |
| fairy_guardian_07_gloamgarden | Dreadroot@79 |
| fantasy_monster_07 | Dreadroot@23; Dreadroot@49; Dreadroot@149; Dreadroot@233; Dreadroot@112; Dreadroot@189 |
| fairy_guardian_08_faeholme | Veilkeeper@189 |
| fantasy_monster_08 | Veilkeeper@23; Veilkeeper@49; Veilkeeper@149; Veilkeeper@233; Veilkeeper@112; Veilkeeper@79 |
| fairy_guardian_09_faeholme | Elder Thorne@189 |
| fantasy_monster_09 | Elder Thorne@23; Elder Thorne@49; Elder Thorne@149; Elder Thorne@233; Elder Thorne@112; Elder Thorne@79 |
| fairy_garden_spriggle_faeholme | Prism Spriggle@115 |
| fairy_garden_spriggle_gloamgarden | Dewdrop Spriggle@46 |
| fairy_garden_wardling_faeholme | Amethyst Wardling@115 |
| fairy_garden_wardling_gloamgarden | Dewstone Wardling@46 |
| fairy_monster_11 | Petal Pouncer@46; Petal Pouncer@115 |
| fairy_monster_14 | Moss Nibbler@46; Moss Nibbler@115 |
| fairy_monster_16 | Bloom Hopper@46; Bloom Hopper@115 |
| fairy_monster_27 | Bramble Prowler@46; Bramble Prowler@115 |
| fairy_monster_30 | Elder Grovebeast@46; Elder Grovebeast@115 |
| creature_basalt_maw | Basalt Maw@90 |
| creature_cinder_ravager | Armored Demon@28 |
| creature_gorge_mantis | Giant Mantis@25 |
| creature_hollow_star | The Hollow Star@130 |

## Exhaustive remaining polish list

These41 IDs include the staged polish candidates above. See original audit for individual defects.

| Asset ID | Original creatures / levels |
| --- | --- |
| animal_chicken | Hen@1 |
| animal_rat | Grainback Scavenger@1 |
| animal_viper | Viper@2; Grassscale Viper@1 |
| creature_crown_hart | Crown Hart@48 |
| creature_kiln_salamander | Salamander@25 |
| creature_reedjaw_crocodile | Crocodile@13 |
| fairy_garden_frog_faeholme | Orchid Pondling@115 |
| fairy_garden_hart_faeholme | Starhorn Hart@115 |
| fairy_garden_snail_faeholme | Starcap Snail@80 |
| fairy_garden_snail_gloamgarden | Mooncap Snail@34 |
| creature_antler_beetle | Stag Beetle@13 |
| creature_ashscale_monitor | Monitor Lizard@25 |
| creature_bracken_tapir | Tapir@5 |
| creature_cairn_bighorn | Bighorn Sheep@13 |
| creature_duskoak_lynx | Lynx@6 |
| creature_quillback_porcupine | Porcupine@13 |
| creature_slag_centipede | Giant Centipede@25 |
| creature_slateback_tortoise | Tortoise@13 |
| creature_goblin_shaman | Goblin Shaman@6 |
| creature_skeleton_archer | Skeleton Archer@71; Skeleton Archer@6 |
| creature_skeleton_mage | Skeleton Mage@79; Skeleton Mage@26 |
| creature_skeleton_soldier | Skeleton Soldier@73; Skeleton Soldier@71; Skeleton Soldier@77; Skeleton Soldier@6 |
| creature_cairn_treader | Cairn Treader@13 |
| creature_chalk_warden | Chalk Warden@13 |
| creature_shale_elemental | Shale Elemental@13 |
| creature_furnace_regent | Furnace Regent@149; Furnace Regent@90 |
| creature_kiln_marrow | Kiln Marrow@28; Kiln Marrow@25; Kiln Marrow@77 |
| creature_plague_zombie | Plague Zombie@28 |
| creature_zombie | Zombie@2 |
| creature_gloamfang_reaver | Gloamfang Reaver@76 |
| creature_lava_golem | Kilncrust Golem@28; Lava Golem@13 |
| creature_starroot_guardian | Starroot Guardian@106 |
| creature_briar_harrow | Bramble Tiller@13 |
| creature_cinder_penitent | Ashbound Votary@28; Ashbound Votary@25; Ashbound Votary@77; Ashbound Votary@86 |
| creature_basalt_drake | Armored Dragon@28 |
| creature_furnace_grazer | Furnace Grazer@81; Basalt Maw@89; Basalt Maw@88; Furnace Grazer@90 |
| creature_amethyst_dragon | Purple Wilderness Dragon@125; Purple Wilderness Dragon@130 |
| creature_purple_wilderness_dragon | Violet Dreadwing@123; Violet Dreadwing@130 |
| outfit_female_ranger | Forest Bandit@6 |
| outfit_male_ranger | Highland Bandit@12; Quarry Bandit@25 |
| creature_red_worm | Red Worm@1 |

## Completed production IDs, do not redo by reading stale original verdicts

- creature_fen_crawler
- creature_boss_rootheart
- fairy_garden_sporekin_gloamgarden
- fairy_monster_21

- creature_hollowroot_spider
- creature_marchwild_horse
- creature_rootdelve_badger
- creature_quarry_nightmare
- creature_webweaver_spider
- creature_marsh_wasp
- creature_mossback_sentinel
- creature_stone_golem
- creature_revenant
- creature_banshee
- creature_field_wasp
- creature_heath_wasp
- creature_reed_wasp
- creature_gloam_fox
- creature_moonweave_spider
- creature_amethyst_spider
- creature_thorn_maw
- creature_heath_jack
- creature_slag_crawler
- creature_grave_lantern
- creature_veil_reaper
- creature_blind_cave_weaver
- creature_boss_tempest_roc
- creature_boss_tideworn
- creature_boss_ordrun
- creature_boss_cinderwake
- creature_cinderback_crag
- creature_voidstone_colossus
- creature_ashseal_warden
- creature_nightforge_marshal
- creature_pearl_knight
- creature_lantern_sprite
- creature_dewglass_weaver
- creature_orchid_reaper
- fantasy_monster_03
- fairy_garden_imp_gloamgarden
- fairy_garden_sapling_gloamgarden
- fairy_garden_imp_faeholme
- fairy_garden_sapling_faeholme
- fairy_guardian_03_gloamgarden
- fairy_garden_reliquary_gloamgarden
- fairy_garden_petalguard_gloamgarden
- fairy_garden_sporekin_faeholme
- fairy_garden_reliquary_faeholme
- fairy_garden_petalguard_faeholme

For generation planning, use [the deduplicated generation queue](./creature-generation-queue.md). The 58 replacement verdicts are not 58 new-model requests.
