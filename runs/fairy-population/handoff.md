# Fairy population handoff

The user's requested expansion and art corrections are implemented for Gloamgarden T30 and Faeholme T60.

- Twelve ordinary forms per region, using 24 separate regional skins. Spriggle, sporekin, imp, reliquary, veilspirit, sapling, drake, wardling and petalguard join the explicitly permitted frog, snail and hart.
- Each existing clearing keeps seven residents, split between two species in fixed groups of four and three. Both regions retain 42 ordinary residents and two standard guardian minibosses.
- Six detailed guardian skins cover the curated standard bodies. Guardian combat, loot and thirty-minute respawn rules retain the standard implementation.
- Twelve fairy NPCs, six per region, with eight new roles and conversations. All fairy NPCs are 20% larger.
- Every one of the 30 creature/guardian skins has a separate built-in imagegen image and prompt record in `art/fairy-population/textures/generated/`. Source maps and UV guides are retained alongside them. No monochromatic recolor is used as finished art.

Source files and artwork are in the repository. The asset generator can rebuild staged GLBs using the retained public source models; disposable work files are not required as the only copy of a source asset. Existing unrelated starter/red-worm edits in this shared workspace were preserved.

## Acceptance

Root accepted both twelve-creature sheets and both three-guardian sheets in the production lab. Each variant passed idle, walk and attack checks with the attached gameplay camera. Geometry, UVs, rigs, clips, normal maps and native material parameters are covered by thirty preservation tests. The generated albedo images and embedded textures are checked by hashes.

Actual combat checks cover the new sources, including damage, pursuit, death and respawn. The imp's misleading planted-foot stride metadata was removed, and measured pursuit limits were added for the new constructs. The four replacement forms passed actual movement checks. All twelve NPC conversations passed production UI interaction and scale checks. The mixed-resident fixture passed placement, real keyboard movement and deterministic reset.

After these lab checks passed, root promoted the 30 generated variants and registered the mixed groups in the authored world. Placement uses the world-authoring exception because the existing receiving floors and village lanes cannot be accepted in isolation. Reusable actor behavior and materials were accepted in the lab first.

- TypeScript: passed.
- Focused population, guardian, NPC, audio and asset tests: 66 passed.
- Combined production feature lab: passed in 54.6 seconds, within its 60-second budget; no runtime errors.
- Fresh-context Astra source review: no blocking defects found.
- Game build and current navigation/world artifact: passed (336 world tiles, 128.73 MB compressed).
- Documentation build and all 615 page links: passed.
- Final world checks: Gloamgarden passed in 85.5 seconds and Faeholme in 81.9 seconds; all twelve conversations route from the authored village squares, both populations match the roster, and keyboard movement works without runtime errors.

Disposable reports and screenshots: `test-results/fairy-population/`. The standard combined-lab captures are in `test-results/feature-labs/`.


## Repository-wide checks and recovery

The final complete Vitest run passed 2,788 tests, skipped one, and failed 30 tests across 18 files (one file failed while loading). All six focused fairy/guardian/asset/NPC test files pass. The remaining failures concern the existing mine-cut fixture, ash redesign metadata, Crownward boss pursuit ceilings, the separate red-worm recoil mask, northern lava/population assumptions, equipment expectations, and lake/scatter checks. The regional-pack test's scene stub also lacks `meshHeightAt`. These areas were not changed to make this task's checks pass. Full output is retained in `test-results/fairy-population/vitest-final.log`.

The first T30 guardian world capture was obscured by foreground foliage. Root accepted the replacement capture from the opposite ground-level approach at `world/gloamgarden/guardian-clear/guardian.png`; that check passed in 64.5 seconds. All acceptance cameras remained attached to the player, within normal pitch and zoom controls.

A full C: drive interrupted initial build attempts. Disposable task outputs were moved to `D:/CodexTaskCache/Corealm2-fairy-population-20260912` through the existing `test-results/fairy-population` junction. Build output was temporarily relocated too, then restored to the regular `game/dist` directory once C: had free space. The final build and documentation build both completed successfully. An additional source/art recovery copy is retained at `D:/CodexTaskCache/Corealm2-fairy-population-20260912/recovery-current`.
