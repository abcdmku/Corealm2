# Starter creature direction

The September 6 owner request authorizes this amendment to the rebuild PRD. Fallowmarch should mainly contain small RPG creatures, with occasional goblin camps. Later regions should broaden the threats rather than repeat one model throughout a region. Check existing free imports before producing new models.

Knight Online inspiration is the gradual introduction of small starter pests and distinct hunting grounds. This is an original roster, not a port of Knight Online artwork or names. Reference: [Moradon Bulcans](https://knight-online.fandom.com/wiki/Bulcans).

The owner's follow-up explicitly rejects cartoon-like creatures. The unused platformer blob, bee and crab are excluded. Do not treat their presence on disk or a free license as visual approval. Grass Viper, Creek Crab and Granary Rat use the established textured animal assets; Field Wasp and Briar Spider use the production imported insect bodies. The next follow-up permits scaling small creatures up, large creatures down, and making distinct texture variants. Keep the theme and source rig intact. This pass uses scaling and existing textures. These are starter stat blocks using existing artwork, not newly modeled species. The manifest retains the original source and license records. No asset purchase or custom modeling is needed for this pass.

Source alternatives checked: [Quaternius Ultimate Monsters](https://quaternius.com/packs/ultimatemonsters.html), CC0, and [Easy Enemies](https://quaternius.itch.io/animated-easy-enemies). The already downloaded sources avoid another conversion pipeline.

Fallowmarch uses weak rats, short-range aggressive insects, and defensive snakes and crabs. Farm animals and tutorial frogs remain. Vellenwood mixes spiders and wasps with woodland creatures and localized undead. Karrowmoor mixes rocky-ground wildlife with occasional stone guardians. Kilnhalt mixes volcanic animals and monsters with tomb and kiln encounters.

Pack combat previously required the player to stand inside the idle habitat inset before provocation could work. Pursuit now extends beyond the habitat while retaining the 28 m spawn leash and realm isolation. Idle routes remain bounded. A player standing across the habitat edge can provoke a creature and receive an attack.

Workflow: test each new stat/model combination with real attacks in the production combat lab, inspect the screenshots, then integrate small groups into the authored world. World placement is a full-world exception because terrain, trees and access routes cannot be established by the flat lab. It does not waive creature combat proof.

## Shipped and staged data

Normal world boot adds five sparse pockets with 15 residents through `starterHabitats.ts`. The wasp pocket has one moss-green Field Wasp, one dusty-brown Heath Wasp and one slate-blue Reed Wasp, represented as three single-resident groups within the original pocket. Other starter pockets retain three residents. The farm, tutorial encounters and existing regional animals remain.

Early wasps retain scale 0.45 in species definitions; their model wrappers reduce them to 68%, 62% and 72% of the old Field Wasp size respectively. The models reuse the approved four-wing wasp with a neutral scale texture tinted per variant, body roughness 0.72, body iridescence 0.04 and wing iridescence 0.12. All three remain tier 1, 7 HP and maximum hit 2. The larger, vivid purple `creature_marsh_wasp` is unchanged and remains the later-region Marsh Wasp source. Build provenance and texture prompts are in `tools/rpg-bestiary/whole-insects/README.md`.

After rebasing onto main, Fallowmarch's regional packs are activated through `regionalPackActivation.ts`. Its catalogue changes from 14 goblin pockets to three, with 16 small-creature pockets and five retained wildlife pockets. Main's existing exclusions remain. The five pockets populated by `starterHabitats.ts` are additionally excluded from regional assembly so their residents and habitat IDs are not duplicated. The remaining activated Fallowmarch packs use the varied catalogue. Other regions remain staged and are not activated by this change.

`tools/starter-creature-test.ts` proves both sides lose health through a real lab attack-button click. `--wasps` checks the three early variants and the larger Marsh Wasp. `tools/starter-world-test.ts --boundary` proves a grouped wasp damages a stationary player outside the idle habitat; ordinary `tools/starter-world-test.ts` checks all seven live groups on dry terrain, navigation to all 15 residents, and a real world rat attack. Screenshots and semantic reports are disposable under `test-results/starter-*`.

Final checks: production build and typecheck pass; 54 focused content, habitat, attack, realm and exclusion checks pass. The world probe also verifies navigation reaches all 15 residents. The boundary probe records player health 23 to 22 without entering the idle circle. The repository-wide suite is not green: source-hash, existing motion/cadence and structure checks still fail. The final cadence output contains no new starter residents. Do not represent the focused acceptance as a passing full suite.
