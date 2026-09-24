# Creature audit handoff, 2026-09-23

## Task and boundaries

Continue the creature asset audit/rework in C:/Users/Borg/Documents/GitHub/Corealm2. Original interrupted T3 thread: 3f5858fa-140d-4234-bef4-936d9868b528. This document is intended for an agent with no conversation context.

The USER MOVED REGION STREAMING / INVISIBLE ENEMIES TO ANOTHER THREAD. Do not change renderer, shader warmup, startup, or streaming as part of this continuation. Coordinate if another thread changes shared files. Focus on creatures.

User explicitly requests parallel GPT-6 Sol implementation/asset workers and GPT-6 Luna reviewers, with explicit nonoverlapping file ownership. Use GPT-6 Astra medium only after Sol repeatedly fails an item. Root owns shared contracts, integration, acceptance and combined checks. Keep production ready and push small accepted batches regularly. Do not accumulate another huge local backlog or run excessive redundant tests.

Read AGENTS.md and docs/feature-lab.md first. The original full audit is docs/creature-asset-audit.md. Its complete-model table records ORIGINAL verdicts and old appearances, even for assets already replaced; subtract the completed list below. Old detached-camera screenshots are diagnostic only, not valid new acceptance views.

## Current baseline

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
- Matching new bases are authorized for genuine source gaps. Use existing owned models where they actually fit; do not force unrelated bodies or duplicate the same silhouette for every identity.
- User is logged into Tripo in existing Chrome. Explicit authorization exists to attach Playwright to existing Chrome on port 9333. Reuse that session, do not create a new login profile. Inspect current tabs first. No Tripo job needs to be resumed blindly from stale context.

## Files, evidence and dirty work

- Production-only accepted catalog: test-results/creature-audit/production-candidates.json, 45 entries.
- Combined lab catalog: test-results/creature-audit/candidates.json, last 67 entries, including staged work. NOT a promotion/acceptance list.
- Lab journal/evidence: test-results/creature-audit/resume-session/session.jsonl and screenshots under that session directory. Search filenames rather than dumping the huge journal.
- Source/build directories: assets/art/tripo/imports/creatures/audit-*/. Candidate-specific catalogs and builders live there. Many staged directories are untracked and LOCAL ONLY. A fresh clone does not contain them. Preserve them on this workstation or explicitly transfer/commit reviewed source work.
- Many unrelated untracked Tripo exports and armor files also exist. Never git add everything or delete unknown files. Last four tracked dirty files were boot.ts, gameDebug.ts, assets.ts and entityViews.ts with line-ending-only differences; recheck before touching because another thread may now be editing them.
- Source builder hashes are sensitive to line endings. Committed .gitattributes preserves reviewed creature .mjs/.ts bytes. Do not casually normalize them.
- Candidate catalogs vary: files map vs candidateFile, and relative paths vs full repository-relative paths. Resolve per catalog. Refresh hashes after a worker rebuilds an asset. An old labAccepted flag does not authorize promotion.

## Start here: staged replacements

All paths below are under assets/art/tripo/imports/creatures/. No items in this section are integrated yet.

| Candidate / production ID | Directory | Current proof and next action |
| --- | --- | --- |
| Fen Crawler / creature_fen_crawler | audit-fen-crawler | Detailed swamp six-leg model, about 0.50 m. Lab idle, attack/damage and grounded death passed. Ready for integration after checking current hash/evidence. Death screenshot round3-fen-unobstructed-death-07.png. |
| Rootbound Colossus / creature_boss_rootheart | audit-rootwood-family | Briar Harrow source, about 2.28 m, layered bark. Idle, attack/damage and death passed. Ready for integration, preserve smaller young-guardian role if level stays 23. Use promotion-catalog.json. |
| Mooncap Sporekin / fairy_garden_sporekin_gloamgarden | audit-mooncap-sporekin | Correct owned mushroom source, 25 joints, six clips, original detailed lilac map reduced to 2K with derived PBR. Idle, damage/attack and side-wilt death passed. Ready for integration. Source dependency also in audit-owned-plant-downloads. Death screenshot round3-mooncap-unobstructed-death-07.png. |
| Thicket Spirit / fairy_monster_21 | audit-thicket-spirit | Correct fantasy Thicketwalker, 20 joints/six clips. Idle, combat and folded death passed. Needs tier scaling before promotion: raw 1.899 m, suggested high-tier multiplier 1.28947 gives 2.449 m; current species multipliers around .67-.71 are too small. Source has detailed 2K base color but no normal/ORM, do not claim full PBR. Reuse one asset with variant scale. |
| Silverthorn Harrow / creature_silverthorn_harrow | audit-rootwood-family | Floating cone crown removed. Previous backflip corpse REJECTED. Latest side-fall rebuild SHA 3e6d131045b9c29ae59896f7b74c76a8d34cb0f10a646f5260df4ab934ba47a3 needs NEW normal-camera death screenshot and acceptance. Rootheart bytes were unchanged. |
| Nightbloom / fairy_guardian_06_faeholme | audit-nightbloom | Pinkbud fantasy base with generated floral map, twig antlers/blossoms, eight clips. Idle and combat viewed; death was cropped. Needs unobstructed whole-corpse view. Correct preset species:guardian_06_faeholme, derived level189. This does NOT resolve fantasy_monster_06. |
| Vault Custodian / creature_vault_custodian | audit-vault-custodian | Owned limestone/blue-sash sentinel, 54 joints/eight clips, CPU grounding passed. Latest SHA 7fd6db127e826c93f4c54f3322f0da0798bdb627d937fa5be2c07457035f9d67. round4-vault-idle.png captured but not reviewed by root. Needs visual, combat and death acceptance. Preset species:vault_custodian. |
| Flint Mandible / creature_flint_mandible | audit-mandible-family | Charcoal/flint/bronze generated skin, 30 joints/six clips. Round4 idle/walk captures queued, not accepted. Needs visual/combat/death. Raw height1.371, species .8 gives about1.10m. |
| Beetle Golem / creature_beetle_golem | audit-mandible-family | Basalt/oxidized copper/moss skin on same mandible source, raw1.554m. Needs visual/combat/death, assess silhouette repetition with Storm Scarab/Fen Crawler. Currently same derived level13/reward as Flint; if larger, increase level/reward appropriately. |

Prefer a short next production batch of Fen, Rootheart, Mooncap and Thicket after scale validation. Add Vault only after its missing proof. Do not hold all work until every staged asset is accepted.

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

Last live Vite URL: http://127.0.0.1:62553. Persistent lab tool session was95730, but IDs may not survive into a new agent thread. Check existing processes/ports and reuse the server/browser if available. Follow the documented lab session protocol instead of inventing another fixture. Last route was /index.html?mode=combat&creatures=1 with the67-entry candidate catalog.

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

These58 IDs were computed by subtracting the45 production catalog IDs from the original audit table. Their detailed visual defects and replacement briefs are in docs/creature-asset-audit.md. Staged items above are included until promoted. Names/levels below are ORIGINAL audit observations, not authoritative current balance.

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
| fairy_garden_sporekin_gloamgarden | Mooncap Sporekin@34 |
| creature_bloomheart_matriarch | Bloomheart Matriarch@79; Amethyst Sovereign@189 |
| creature_boss_rootheart | Rootbound Colossus@23 |
| creature_hollow_bough | Hollow Bough@76; Hollow Bough@75; Hollow Bough@73; Hollow Bough@13 |
| creature_silverthorn_harrow | Silverthorn Harrow@63 |
| creature_fen_crawler | Fen Crawler@6; Fen Crawler@5; Fen Crawler@12 |
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
| fairy_monster_21 | Thicket Spirit@46; Thicket Spirit@115 |
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
