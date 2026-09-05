# Corealm remaining work and worktree handoff

Checkpoint date: 2026-09-05. This document supersedes older completion claims in this run where they conflict. The game is not finished or approved for release. The user requested this checkpoint so the remaining work can move into parallel worktrees. Stop the previous feature round at this revision.

## Direction to preserve

- Keep the stylized identity, with convincing anatomy, detailed silhouettes, coherent materials and restrained effects. The user rejected chunky geometry, rubbery cartoon animals, simple curved tree branches, basic textures and blocky distance substitutes.
- Audit the entire catalogue. A mesh being mapped, a generator exporting successfully, or an animation having eight named clips does not establish quality.
- Author places with a purpose, readable approaches, terrain support and believable occupants. Do not fill empty coordinates with props or creatures just to meet counts.
- Make most visible trees harvestable. Preserve species/size yields, stable IDs, exact scatter origins, depletion and save behavior.
- Use ordinary material, town and creature names. Show actual stat-derived levels, never internal `T1`/`T5` labels. Internal IDs remain stable for saves. Bosses need meaningfully higher levels and stronger behavior.
- Ore should be ordinary rocks on the ground in front of cliffs. No encircling mineral ribbons, repeated wall veins or busy essence-like decoration. Mine and dungeon should have separate, readable approaches.
- Dungeon entry is click, auto-walk, fade, loaded interior. Its entrance must be physically sealed during ordinary movement. Walls must remain opaque from reachable camera positions.
- Add dozens of recognizable RPG monsters and dozens of packs per region, each with 5–10 residents. Level variants can share a model, but do not count recolors as distinct creature families.
- Equipment and progression should take inspiration from Knight Online. Add repeatable randomized monster-kill quests that award experience.

The user supplied [KO Bugda armor sets](https://kobugda.com/sets) and [its sword comparison](https://kobugda.com/compare?cat=WEAPON_SWORD&items=cmm8e90sj000xjgq9vt8wvjtm%2Ccmm8e91px00jujgq9cjrqe4vz&grades=1%2C1). The sets page describes class groupings and bonuses for different piece combinations. The comparison page could not be retrieved by the text browser in this checkpoint. Inspect it in a browser before choosing equipment references. These are inspiration references, not evidence that any new equipment or random quest system has been implemented. Create Corealm assets or use sources with suitable licenses.

## Checkpoint state

| Area | What is present | What remains |
| --- | --- | --- |
| Names and levels | Plain display names across content and UI; computed creature level labels; IDs preserved | Final UI/catalogue sweep and regenerated docs/icons/map where affected |
| Trees and harvesting | Detailed geometry stays active at visible distances; production forest resource lifecycle exists | User rejected current branch art; six fuller tree candidates need complete review and promotion, then world proof |
| Mines | Lower Quarry moved to `[140,-16]`, about 94 m from the surface portal; cliff collision and approach work implemented | Latest ground-rock material pass unfinished; mining access positions are not wired into the final world; all five final approaches need proof |
| Dungeon | Opaque double-sided shell, closure fixes, PBR material hookup; local shell review passed for visibility | Broader cave art still flat/banded; final-world entry integration is incomplete |
| Portals | Production transition service and sealed entrance helper; click/walk/fade lab and failure/cancel recovery checks passed | Final-world stance/solid/link wiring and routed travel transition hook remain absent |
| Movement | Checked detour polylines, immediate stop semantics and asynchronous portal traversal port | World portal hook and remaining town/obstacle routes need browser acceptance |
| Combat realms | AI and player combat reject cross-realm attacks and cancel pending impacts; 55 focused checks passed | Real portal/combat browser proof after world integration |
| Creature catalogue | 24 expansion species, loot/crafting paths and production gallery | Mostly animals; current quadruped art explicitly rejected; requested broad RPG roster not built |
| Regional packs | 96 staged packs, 558 members, 72 stat variants; production construction helper and `?mode=combat&pack=<id>` fixture | Pack fixture has not passed browser acceptance; world registration is absent; revise roster toward RPG monsters first |
| Legacy gaits | Frog variants and crab candidates pass dense physical contact audits | Runtime blend/turn/travel visual proof and promotion pending; scorpion Run repair is failing WIP |
| Equipment and items | Restored material work, equipment detailing, item icons and mineral generator | Catalogue-wide worn/held review, distinct weapon forms, sets and new reference-driven art remain |
| Shops/death/persistence | Sale rounding, settlement respawn, recovery and rejected-save protections implemented | Latest combined save/quest/dungeon acceptance still needed |
| Performance | Native scatter partitioning, material sharing and resident-motion helper | Frame loop still uses old motion source scan; heavy world views remain expensive |

Read [CHECKPOINT-VALIDATION.md](./CHECKPOINT-VALIDATION.md) for fresh results. Earlier [acceptance.md](./acceptance.md) is historical evidence with narrower scope. User rejection of ores and quadruped art overrides earlier visual acceptance.

## Parallel worktree rules

Use the checkpoint commit as the common base. Each branch owns only its listed files or a newly agreed non-overlapping directory. A branch may read shared code, but changes to shared contracts must be agreed with the integrator first. Return a small patch plus exact wiring instructions when a shared file is needed.

The integration owner alone edits `game/src/contracts.ts`, `game/src/app/boot.ts`, `game/src/world/regionBuilder.ts`, shared state/save schemas, `game/public/assets/manifest.json`, and generated navigation/map fingerprints. It also owns final registration in `content/enemies.ts`, `items.ts`, `equipment.ts`, `recipes.ts` and `regions.ts`. Asset branches provide staged catalogues and proposed bindings instead of racing to rewrite these files.

`render/entityViews.ts`, `render/materials.ts`, `render/assets.ts`, `systems/combat.ts`, `systems/enemyAI.ts`, `tools/build-assets.ts` and `tools/build-creature-expansion.ts` are shared integration points. Assign one owner before editing them. Do not let the creature, equipment, structure and performance branches each change the same loader or renderer.

Use separate dev ports and output directories in each worktree. Node 24 is required. Run `npm ci`, then set `$env:PORT = '4180'` and run `npm run dev` in PowerShell, or use Vite directly. Pick a different port per worktree. Existing local servers are 4174 for development and 4175 for acceptance. The preserved review scripts default to 4175; parameterize that before simultaneous browser work. A worktree does not inherit ignored `test-results`, installed dependencies or licensed source extraction caches.

Follow [feature-lab.md](../../docs/feature-lab.md) and [world-authoring.md](../../docs/world-authoring.md). Reusable assets and interactions need compact production-path lab proof before final-world integration. Terrain, world layout, biome and scatter placement may use the documented world-only exception. Record that exception. Do not run concurrent heavy GPU acceptance sessions on the same computer. Only the integrator runs combined lab/whole-game gates while a round is active.

## Work packages

### 00. Integration, portals and shared contracts

Suggested branch: `finish/integration`. Own the shared files listed above and `systems/travel.ts`, `world/portalEntrance.ts`, `ui/portalTransition.ts`.

1. Finish the already accepted portal integration. `boot.ts` currently passes `transitionThroughPortal` only when `portalFixture` exists. Final-world portals still lack the helper's sealed solid and interaction stance.
2. In `buildDungeonEntities`, give each mouth its actual grounded `portalEntrance()` stance and solid. Face the interior exit toward the chamber, not out of it. Update the corresponding surface route node, known location and portal link together before route edges derive costs. Keep the first chamber destination at its safe interior node.
3. Render and register visibility for the interior mouth as well as the surface mouth. Keep surface/interior residency consistent across entry, return and reload.
4. Wire `MovementPorts.portals.transition(destination, regionId, commit)` through the existing curtain service. The supplied commit advances the route. Do not call `teleportPlayer` or `Movement.stop` from this hook because that cancels the journey. Sync camera/residency and discovery after commit; wait for a rendered destination before revealing it.
5. Prove real click entry and return, physically blocked manual entry, routed entry, cancellation, repeated commands, slow/failed loading and realm-isolated combat. Black-screen timing must be sampled across the actual commit, not inferred from an animation duration.

Existing production helpers and tests are ready. See `portal-travel`, `movement-portal-transition`, `enemy-realm-isolation` and `combat-realm-isolation` tests, plus the preserved portal browser checks.

### 01. Rebuild rejected quadruped art

Suggested branch: `finish/quadrupeds`. Own `tools/creature-expansion/mammals.mjs`, `mammals/`, `hoofed.mjs`, `hoofed/` and new staged quadruped assets. Coordinate any family animation changes with package 03.

- Audit every current quadruped from front, side, rear, gameplay distance and in motion. Record keep/rebuild/replace and actual source provenance.
- Start with Bighorn, Tapir and Lynx. Current captures show balloon-like horns, rounded toy feet and ears, rubbery bodies, bulbous heads, weak joint landmarks and odd neck/leg proportions. A smaller eye or more polygons does not fix this anatomy.
- Rebuild proportions, shoulder/pelvis structure, muzzle, paws/hooves, horn roots, coat direction, roughness and skin transitions. Preserve grounded pivots, measured dimensions, skinning and contact compatibility, or explicitly return new measurements to integration.
- Review wolves, bears, boars, cattle, deer, goats and imported reptiles too. Do not assume source-pack art automatically matches the desired style.

Done means believable silhouettes and deformation under production lighting, with weight-bearing feet in idle, turns, pursuit, attack, hit and death. User-rejected models remain rejected until this review passes.

### 02. Build the RPG bestiary

Suggested branch: `finish/rpg-bestiary`. Own a new `tools/rpg-bestiary/`, staged assets, proposed `content/rpgBestiary.ts` and focused tests. Do not edit the existing mammal/hoofed generators or shared compiler concurrently.

- Agree a concrete roster of at least several dozen named enemy entries, with multiple genuinely different body and combat families. A proposed starting target is 36 entries across 12 or more silhouettes. This count is a planning target, not an implemented feature.
- Use familiar archetypes: goblin scout/archer/shaman, orc warrior/berserker, hobgoblin, troll, ogre, skeleton soldier/archer/mage, zombie, ghoul, wraith, harpy, gargoyle, gnoll, lizardman, stone/iron/fire golem, cyclops, minotaur, wyvern, drake and demons. Choose the final mix for the game's regions and scale.
- Specify source/license, rig family, size, movement type, attack mechanics, animation contact markers, recovery, stats, computed level, loot table and habitat for every entry. Stronger variants can reuse the same rig with restrained equipment/scars/material differences.
- Inspect existing entitled Unity source inventory before purchasing or importing. Current source helpers are under `tools/creature-expansion/monsters/` and `imported-animals/`. Their source archives are local cache dependencies, not included in the repository. Avoid replacing the rejected art with another overtly cartoonish pack.
- Add production gallery and combat fixtures first. A gallery animation selector alone does not prove natural AI combat, rewards or respawning.

Done means dozens of usable enemies with distinct silhouettes/behaviors, complete loot and animation integration, natural kills and normal respawn. Package 04 places accepted creatures in the world.

### 03. Creature animation and combat contact

Suggested branch: `finish/creature-motion`. Own `tools/lib/ground-gait.ts`, `frog-ground-gait.ts`, `crab-ground-gait.ts`, `scorpion-ground-gait.ts`, `tools/repair-ground-creature-gaits.ts`, `tools/creature-motion/` and corresponding focused tests. Propose renderer integration separately.

- Review frozen frog/crab candidates during actual translation, turning, acceleration and blending. Dense physical contact audits passed; browser motion acceptance is still pending.
- Finish scorpion Run. Current shipped metadata produces about 28–45% sliding in the gait regression. The stopped candidate fails heel contact; the newer solver refuses excessive joint correction. Preserve that refusal. Do not make the test pass by raising playback caps or declaring new stride metadata without matching the mesh motion.
- Audit attack anticipation, impact, recovery, directional hit, stagger, turning and death on the entire roster. Rhinos still need contact/recoil review. Avoid whole-body sliding and generic lunge-only attacks.
- Keep attack damage/contact markers aligned with actual clips. Preserve phase through live/sampled animation changes and residency boundaries so actors do not snap into motion when approached.

Done means visible grounded motion and correct state transitions under the real AI. Whole-mesh skinning checks support that evidence; bone-tip or timestamp checks alone do not.

### 04. Regional packs and authored encounters

Suggested branch: `finish/encounters`. Own `content/regionalPacks.ts`, `world/regionalPackEntities.ts`, `featureLab/regionalPacks.ts`, pack tests and proposed habitat/dressing modules. Root owns region registration; coordinate established habitat files before changing them.

- The staged 96-pack/558-member catalogue is a starting point. It is animal-heavy and predates the latest RPG request. Rework its species distribution around package 02, while retaining wildlife where it belongs.
- Validate the `?mode=combat&pack=<id>` fixture with normal idle/patrol/aggro, body separation, attacks, death, loot, respawn and real level labels. It is wired but not yet browser-accepted.
- Place at least dozens of packs per region, 5–10 residents each, without blocking roads, towns, fishing landings, mining aisles, quest interactions, boss access or tree paths. Camps, ruins, dens, banks and cliff pockets should explain the residents.
- Source exclusion tests do not prove actual terrain/navmesh/shore/trunk access. Check complete movement envelopes, not spawn points alone. Patrol arrivals and post-combat returns matter.
- Resolve the earlier habitat coverage gaps: semantic `alive` actors in idle mode, rounded debug nav coordinates, region seam containment and actual ranging order after resume.
- Keep ordinary level ranges computed from stats. Verify minibosses and bosses stand above local ordinary packs. Balance density, aggression and reward rates with the hunt contracts.

Done means final-world routes and encounters remain playable with the full population. Measure simulation and rendering cost using the same cameras before and after registration.

### 05. Equipment, weapons and armor sets

Suggested branch: `finish/equipment`. Own `render/equipmentDetails.ts`, `proceduralGearModels.ts`, `tools/build-corealm-minerals.ts`, mineral tests, proposed new equipment model builders and staged item assets. Coordinate existing `equipmentVisuals.ts` ownership with integration.

- Review the KO Bugda references in a browser and define Corealm's weapon/armor progression. Equipment should have recognizable shape, construction and purpose as well as better material response.
- Separate swords, daggers, axes, shields, staves and wands through actual geometry. A uniformly scaled sword is not a finished dagger family. Review hand grips, blade thickness, guards, shaft joints and worn silhouettes.
- Audit both supported bodies across every armor slot. Check skin/armor clipping during locomotion, attacks, gathering and death. Distinguish metal, leather, cloth and wood through authored material zones and textures.
- Design coherent sets and readable piece-combination bonuses. Return stat/binding/recipe/loot proposals to integration. Avoid making an arbitrary extra set system before its player-facing progression is specified.
- Review all accessories, food, tools, drops and inventory minerals. New amber/opal/garnet v5 candidates are unreviewed; prior versions were rejected for opaque inserts, zipper borders and block-like bases.
- Generate matching 256 px masters and 48 px gameplay icons only after model acceptance, and verify tooltip/crafting/equipment consistency.

Done means every catalogue item has an intentional, readable presentation and its equipped stats/visuals persist through save and reload.

### 06. Repeatable random monster-kill quests

Suggested branch: `finish/hunt-contracts`. Own new `systems/huntContracts.ts`, `content/huntContracts.ts`, a dedicated UI module, compact fixture and focused tests. Submit state/events/API additions to integration before wiring existing quest/save files.

- Add a repeatable hunt loop with a visible offer, target creature or family, region, required kills, progress and explicit XP reward. The user requested randomized kill quests; this system is not implemented yet.
- Draw deterministic offers from eligible creatures that actually exist and are reachable at the player's progression. Use normal names and actual level ranges. Avoid impossible, absent or quest-locked targets.
- Decide how offers are accepted/refreshed, whether there is one active hunt or a small list, and where rewards are claimed. Start with a simple town board/NPC or journal flow rather than adding unrelated daily monetization systems.
- Count real credited kills only. Persist offer identity, progress, completion and reward delivery. Prevent double credit/reward on reload, duplicate events, death, realm travel or abandoned contracts. Existing scripted quests must keep working.
- Balance kill counts and XP against travel time, spawn rates and the player's normal combat XP. Show progress feedback without covering combat.

Done means a normal player accepts, kills, completes and receives XP exactly once, then gets another feasible offer. Prove partial progress and completed rewards across save/reload and full-inventory states if item rewards are included.

### 07. Trees, foliage and surface art

Suggested branch: `finish/foliage`. Own `tools/build-corealm-nature.ts`, tree topology tests, staged foliage and its source textures. Root owns shared material/scatter changes and public promotion.

- Review all six v2 tree candidates, both sides, normal play distance, near detail and movement. Root inspected only two of twelve latest views. Fuller crowns improved; no complete acceptance exists.
- Improve branching hierarchy, taper, junctions, bark scale, species habit, leaf orientation and canopy distribution. Preserve exact lower bole/root bounds where navigation and harvesting rely on them, or return updated measurements for integration.
- Audit ferns, shrubs, grass, flowers, stumps and deadwood alongside the trees. Keep material scale, color and density coherent with terrain and structures.
- Preserve the detailed source geometry at every visible distance. Optimize culling or submission without bringing back the rejected chunky substitutes.
- Repeat ordinary-tree click, tool check, receipt, depletion, saved stump, distant return and natural regrowth in the lab and final world. Preserve stable saved tree IDs and yield calculations.

Done means readable organic foliage, good branch silhouettes and a coherent world from close and distant views, with harvesting and performance intact.

### 08. Mining rocks and access

Suggested branch: `finish/mining`. Own `tools/build-ground-ores.ts`, `app/miningAccess.ts`, mining tests, proposed mining surface data and staged ore textures. Coordinate `world/siteTerrain.ts`, `render/mineCutFace.ts` and `content/worldSites.ts` ownership with integration.

- Current live ore art is rejected. The latest candidate derives ordinary boulder geometry from the actual essence rock, with restrained flecks and no emissive shell. The first material pass was still too busy; a quieter copper atlas is the stopped current round.
- The last stopped pass resolved the stale atlas and UV checks without lowering the original UV geometry threshold. The iron candidate still has a connected fleck span of 0.6304 m against a 0.55 m limit. Fix that shape rather than weakening the check. Review copper first, then the remaining metal/stone families and spent versions. Only the latest copper export is current; other earlier exports are stale. Subtle mineral identity should not turn rocks into decorative crystals or belts.
- Place rocks on the floor in front of the backing walls with a broad walkable work aisle. Remove wall-mounted repetitive seams. Maintain grounded origins and accessible pointer targets at all resource states.
- Wire mining access positions into `WorldPorts.accessPositions` alongside fishing after local proof. Currently the world map contains only fishing stances.
- Recheck Bracken, Hollowcut, Lower Quarry, Upper Seam and Clinker in the authored world. Upper Seam's synthetic uphill ramp audit exceeded its intended grade; actual nav and player path proof remain required. Test every rock, haul approach, return and nearby portal/shortcut clearance.

Done means every mine can be entered, worked and left through real input, with natural extraction receipts and no climb-looking navigation failures. Plain grounded rocks and terrain composition both need screenshot acceptance.

### 09. Structures, dungeon art and geological obstacles

Suggested branch: `finish/structures`. Own `render/dungeon.ts`, `render/dungeonMouth.ts`, `render/dungeonGate.ts`, structure composition modules, `tools/build-corealm-geology.ts` and structure-specific tests. Root owns layout and generic collider/loader integration.

- The shell closure fix passed local visibility review. Improve the still cylindrical/banded cave form, flat roof, abrupt texture phase changes and uniform warm lighting. Preserve opaque reachable sides, headroom and the unchanged walkable floor where possible.
- Audit every building, wall, roof, arch, door, bridge, shrine, farm prop and settlement composition. Check grounding, repeated silhouettes, surface response, entry widths and collision matching the visible model.
- Review Sunder/Scree v4 candidates before promotion. They replace stacked slabs with connected geological forms. Geometry and approach footprint checks passed; production screenshots and actual world landing paths have not.
- Preserve settled collision fixes. The Millfield walk check passed after a bank porch-post detour repair; remaining towns still need current browser routes. Check entering/exiting doors from different angles, camera orbit and neighbors crowding approaches.

Done means coherent settlements and dungeon rooms that can actually be navigated and viewed from ordinary camera positions. Reusable art gets lab proof; final terrain embedding gets world proof.

### 10. Agility and traversal animations

Suggested branch: `finish/traversal`. Own `systems/agility.ts`, `featureLab/agility.ts`, dedicated traversal animation helpers and tests. Root owns generic movement and world shortcut endpoints.

- Current shortcuts still use a stationary activity/timer followed by distant landing in several places. Root Tunnel spans roughly 103 m in 3.5 s and Scree about 146 m in 3.2 s. Generic ClimbUp playback does not represent these routes.
- Author climb, vault, balance, slide and passage behavior with meaningful entry, contact, travel and recovery. Enclosed passages may need a deliberate concealed/faded transition rather than visible impossible travel.
- Match authored collision, duration, failure/recovery, XP and route direction. Preserve level gates and one-way constraints. Never predict the success RNG to decide the animation early.
- Recompute route savings/costs after the quarry move. Scree's old `savesMeters: 168` metadata needs review.

Done means real input shows a plausible complete traversal, lands safely on current navigation, awards the correct XP and resumes routed travel. Test interruption, reverse Sunder use and invalid/blocked landings.

### 11. Game and developer-loop performance

Suggested branch: `finish/performance`. Own `app/loop.ts`, dedicated visibility/animation scheduling helpers and focused performance tests. Agree exclusive ownership before changing shared EntityViews/materials/assets/scatter modules.

- Wire `EntityViews.syncResidentMotion(alpha)` only after a compact fixture proves parity. It already maintains resident moving references and has nine focused checks, but the game loop still calls the old entity source path every frame.
- Preserve per-frame residency refresh currently hidden inside the boot entity-source callback. Separate it explicitly when removing the all-entity scan. Keep structural reconciliation and entity lookup correct across replacement, despawn, realm changes and save load.
- Measure AI scans/separation, active-set rebuilds, instance writes, sampled animation and rig scheduling. Preserve ongoing animation phase through activation; do not regain performance by snapping actors or freezing visible distant motion.
- Use the detailed [performance audit](./performance-finish-audit.md). Compare actual GPU/CPU time, draw calls and submitted triangles with identical camera/settings/population. Native understory compaction and invariant wind work are proposals, not proven improvements.
- Keep stable dev sessions, bounded deterministic fixtures and compact semantic evidence. Remove duplicate/source-string tests and useless wrappers when their replacement coverage is established. Keep persistence, collision, combat, resource and actual asset compatibility regressions.

Done means demonstrated gains in both dense lab and representative world views with unchanged visible quality and behavior. Agree hardware/frame-time targets before claiming release performance; the current world is not proven stable 60 FPS.

### 12. Quest, economy and persistence acceptance

Suggested branch: `finish/gameplay-qa`. Own focused browser scenarios and targeted system tests. Submit runtime fixes to the owner of the affected system.

- Repeat full-world shop quotes/receipts, buy/sell quantities, bank transfers and equipment changes. Two stale name expectations were corrected at checkpoint; actual ordinary names must appear in receipts and UI.
- Prove deferred quest rewards after a full inventory, early altar awakening, quest visits, agility quest counters, story boss kills and dungeon gate unlocks. Test the Hillcrest/Armored Rhino gate and relevant Vess/Storm Rhino progression through normal actions.
- Exercise rejected/malformed/future saves, autosave/pagehide protection, successful recovery, explicit new game, migration of deeper dungeon positions and atomic imports. Preserve raw rejected saves.
- Check all four settlement respawn anchors, saved destination, actual death, recovery-cache contents/deadline, away/return and reload. The latest respawn scenario passed, but that is not all save/quest acceptance.
- Prove new creature drops can be picked up, used in real recipes, equipped and restored. Verify normal respawn and no duplicated kills, loot or rewards around travel.

Done means repeatable end-to-end journeys with semantic before/after state and relevant screenshots. Debug setup is allowed for reaching a fixture but must be identified separately from the action under acceptance.

### 13. UI, audio and final presentation

Suggested branch: `finish/presentation`. Own dedicated UI modules/styles, audio/VFX modules and relevant interaction tests. Coordinate shared combat and renderer hooks.

- Audit inventory, equipment, crafting, shops, banks, journal, tooltip, context menu, health/XP, loading and settings at supported sizes. Plain names and actual levels must be consistent.
- Check panel stacking, pointer capture, keyboard focus, closing/loading races, quantity updates and error recovery. Existing deferred panel checks cover only specific cases.
- Review the player model, grounded locomotion, tool/weapon grips and camera behavior in ordinary play. Camera collision, occlusion, zoom and travel transitions must keep the player and interaction readable without hiding dungeon walls.
- Improve hit/attack/footstep/gathering sounds and effects with material/species-appropriate timing. Avoid busy effects that obscure silhouettes or mineral identity. Verify spatial audio and looping ambience across travel.
- Add hunt progress and set-bonus presentation after their contracts freeze. Show useful player choices rather than internal implementation details.

Done means readable, responsive flows with consistent styling, meaningful feedback and no stuck input or stale overlays after death/travel/reload.

### 14. Release assets, documentation and acceptance

Suggested branch: `finish/release`. Coordinate with integration; do generated outputs after content and world layout freeze.

- Reconcile the served asset catalogue, file bytes/hashes, material/source metadata and licenses. Remove development review aliases only when no fixture or production binding needs them. Current `models/review` entries are manifest-referenced, so deleting that directory would break the checkpoint.
- Regenerate item icons, game docs, navigation, world map and fingerprints from accepted final content. Current generated files predate some names, placement and candidate changes. Recheck original payload/map budgets instead of raising them to hide regressions.
- Run TypeScript, meaningful unit checks, production and docs builds, combined lab, final-world routes/resources/combat/quests/saves, console/network checks and repeatable performance captures.
- Inspect representative screenshots for every family, all regions, towns, mines, dungeon rooms, coast/lakes, dense encounters, equipment and UI. Record a complete catalogue disposition, not just a contact sheet count.
- Clear release blockers and replace this WIP validation record with exact final evidence. The phrase "AAA" is an art and quality direction, not an acceptance result from a build command.

## Integration order

1. Packages 01, 02, 03, 05, 06, 07, 08, 09, 10 and 11 can begin isolated work after ownership is fixed. Package 00 finishes existing portal wiring and freezes new roster/hunt/set contracts.
2. Accept reusable candidate art and behavior in short lab rounds. Coordinate anatomy changes with gaits, equipment with sockets, and hunt contracts with actual enemy IDs before merging.
3. Package 04 integrates accepted creatures into authored sites. Packages 08/09 integrate accepted mines, trees, structures and caves with root-owned world layout. Re-run access/navigation after model bounds change.
4. Package 12 verifies full player journeys. Package 13 closes presentation gaps throughout those rounds. Package 11 measures identical integrated scenes after population and art changes.
5. Package 14 regenerates and performs release acceptance after content/layout stabilize.

## Portable candidates and review tools

Intentionally retained candidate files are under [`art/rebuild/candidates/2026-09-05`](../../art/rebuild/candidates/2026-09-05/README.md). They are source-review snapshots outside `game/public`; their presence does not approve or activate them. Catalogues include exact hashes and can be served through `installAssetCandidates()` for a single browser context.

Useful local browser scripts are now committed under [`checks/`](./checks/README.md). They still write disposable evidence to ignored `test-results/`. Earlier screenshot/report directories are local history and are not required to boot a new worktree. Source assets that require entitled Unity packages still require the corresponding local cache/extraction; do not assume ignored files travel with Git.

Older detailed audits remain useful for investigation: [model census](./model-audit.md), [equipment](./equipment-audit.md), [structures](./structure-audit.md), [gameplay](./gameplay-audit.md), [world](./world-finish-audit.md), [creature production](./creature-model-production.md). Their dates and findings can predate fixes. Use this handoff and fresh source/browser evidence for current status.
