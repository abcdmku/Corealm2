# Armor integration evidence

The root accepted the imported armor in the production feature lab before enabling it in the world. Original source selection and conversion steps are in [docs/fab-armor.md](../../docs/fab-armor.md). No lab-first exception was used.

## Delivered content

- Existing crafted mage item IDs and recipes at T1, T5, T10, T20, T50 and T70 use the fitted Polytope outfit, for both bodies.
- Six rare sets contain 27 items: Duskguard (Novaborn, melee50), Oathguard (Tough, melee70), Frostguard (WhiteTiger, melee90), Tideweave (Rosewood, magic50), Nightweave (Albino, magic70), and Frostweave (Frostwalker, magic90).
- Bareheaded source sets contain four pieces; other sets contain five. The equipment panel and cumulative defensive bonuses use the actual piece count.
- Matching T50/T70 keepers roll each of nine eligible armor pieces independently at `0.02 / 9`. Ordinary enemies and guards do not drop these sets. T90 items are registered and wearable, but have no drop source because the game has no T90 boss yet.
- Sixty-four fitted GLBs are registered. Rare meshes load on equip rather than all being fetched during startup.
- Original generated fabrics and scale leather add view-dependent teal/violet shimmer. Higher tiers have stronger interference color. T50 Tideweave is leather/fabric; Nightweave remains dark navy.
- All 57 affected items have separate generated transparent inventory illustrations, reviewed at 48px and published through the existing generated-art registry. Exact prompts and per-image hashes/reviews are in `art/fab-armor/icons`.

## Feature-lab proof

Root-run `tools/fab-armor/lab-test.ts` checks live equipment state before and after equip, actual rendered asset IDs, skin joints against the host skeleton, zero missing joints, color-pass draws, normal mouse camera limits, and keyboard displacement at two walking phases. All crafted tiers and all six rare sets were exercised on both bodies. Final material/geometry repairs were rerun on affected outfits, including mixed crafted/rare T50 outfits.

Magic captures at times 4 and 12 compare the same rendered material and verify its phase changed. Root and independent read-only critics inspected front/back/walking/shimmer images. Review caught and repaired missing Kwang crown hair, imported zero-roughness sheen masks, a crafted waist gap, T90 rear-cloth intersection, and a helmet crown fit. Final sampled images passed. Static captures do not establish every possible animation phase.

Root-run `tools/fab-armor/loot-test.ts` passed at T50 and T70. Seed1212 selects a real production roll without changing probabilities; a one-HP keeper is fixture setup. A real attack produces loot, then UI pickup/equip and save export/import prove acquisition. Rare armor is never directly granted in this test.

Screenshots and detailed JSON are disposable under `test-results/fab-armor`. Source hashes and final registered assets remain durable. The illustrated icon contact sheet was independently accepted after original-image and alpha checks.

## Final integration checks

The final production-world browser run passed in 77,878ms (29,424ms boot). It used the normal world route, inventory UI, camera controls and movement to equip crafted mage T70, Tideweave T50 and Frostguard T90, then verified persisted save state. Root and a fresh read-only critic accepted the outdoor screenshots. Evidence is in `test-results/fab-armor/world-mage-50`.

Post-integration T50 and T70 loot runs passed again in 13,073ms and 14,010ms respectively, including attack, pickup, equip and save export/import.

`npm run typecheck`, `npm run build`, and `npm run docs:build` passed. The guide build produced 427 pages. The navigation artifact was rebuilt because the lab seed fixture changed a fingerprinted source file; world geometry was unchanged, and the shipped-artifact test passed. The new fingerprint is `17d4ece7659906c48f8d75b251d5a62a6849639b874a6f450f1d5cf73b24dadb`.

The equipment/icon/loot validation round passed 270 tests across 13 files. The subsequent provenance, shader and navigation round passed 16 tests across three files. `git diff --check` passed.

The bounded full-suite run recorded 2,429 passes, eight failures and one skip in `test-results/fab-armor/full-suite.json`. The eight remaining failures concern unchanged creature deformation/material expectations (two), the audio catalog (one), cave fixture radius (two), lava encounter clearance (one), regional exclusion clearance (one), and world habitat intersections (one). A separate read-only audit confirmed that their relevant sources and tests match HEAD. The full suite is therefore not green; these failures are outside the armor changes.

## Tier identity correction

The user clarified the rare tiers as Chitin blue at T50, Void at T70, and Aurora at T90. Both styles now include those names in item and set labels, while preserving saved IDs, levels, stats, and drops. Authored armor texture luminance drives blue, dark violet, and teal finishes; skin, hair, and fur are excluded. Aurora melee has animated interference, and Aurora magic has a stronger visible teal/violet contribution.

All six rare outfits passed the root-run male lab shards, with front, back, walking, and magic shimmer checks. A fresh read-only critic accepted all six after a second Aurora mage adjustment and rerun. Evidence is under `test-results/fab-armor/tier-finish-50`, `tier-finish-70`, `tier-finish-90`, and `tier-finish-90-magic-final`. The production build, typecheck, 20 focused tests, guide regeneration, and changed-file whitespace check passed. Existing illustrated icon pixels were not regenerated in this correction.

The final-world equip and persistence rerun passed in 69,726ms under `test-results/fab-armor/tier-finish-world`. The preceding run was interrupted by a development-server reload while adjusting Aurora; the final run used stable source.


## Slightly darker tier finishes

Chitin, Void and Aurora rare armor now use a slightly steeper luminance curve with a small overall reduction. This deepens recesses while preserving the tier hues and bright trim. Both melee and magic use the correction; exposed skin, hair and fur remain unchanged. Root lab shards passed all six outfits, and a fresh read-only critic accepted the before/after front and back comparisons without new crushed detail. Void remains near the dark end of readable detail, so this adjustment is intentionally subtle. Evidence: `test-results/fab-armor/tier-contrast-{50,70,90}`. Production build and changed-file whitespace check passed.
Final-world equip/save verification passed in 71,946ms. Root inspected the outdoor Aurora capture under test-results/fab-armor/tier-contrast-world.

## Texture and material separation

The user rejected the nearly monochromatic finishes. Rare armor now preserves warm authored trim, silver highlights and dark backing around tier-colored main panels. Magic shimmer preserves the luminance of dark texels and resists warm trim, so it does not wash texture contrast away. Mage cloth uses an original generated embroidered brocade on detail UV1; original, prompt and hashes are stored with `art/fab-armor/textures/ornate-weave-provenance.json`.

Root final lab shards passed all six outfits at `test-results/fab-armor/material-accepted-{50,70,90}`. Front/back/walking and shimmer captures passed fresh read-only visual review. Oathguard and Nightweave show the strongest plate/trim separation; the simpler Chitin melee remains more restrained. Build, typecheck, 13 shader/inheritance tests and changed-file whitespace checks passed. No item IDs, stats, recipes or drop probabilities changed.
Final outdoor inventory equip/save verification passed in 67,490ms under test-results/fab-armor/material-world; root inspected the outdoor Chitin mage image.

## Rare mage artifact rework

The user identified the mage variants as glitchy. A read-only geometry audit found that projected UV1 switched X/Z axes within about one-third of role-tagged triangles, introducing severe stretch. Replacement brocade and scale maps also disagreed with native normal/gloss maps. The new dedicated `fabMageArmor.ts` path restores native UV0 map alignment, removes all projected rare-mage overlays and gloss masks, and softens native relief into cloth/embossed leather. The tailored shimmer uses unperturbed normals and a narrow constant thickness range, producing broad hue changes rather than bright patches.

All T50/T70/T90 rare mage sets passed root lab checks on both bodies, with front/back, two walking poses, and sampled shimmer. Evidence: `mage-rework-{50,70,90}` and `mage-rework-female-{50,70,90}` below `test-results/fab-armor`.

An extended ten-frame walking review caught a bright rotating tail tip on Frostweave. Its source `LowerClothes` material had been classified as leather. It now uses matte cloth with reduced sheen and no inherited specular maps; its shader cache variant is distinct. Final male/female motion runs passed in 18,088ms and 17,715ms, and a fresh critic inspected all 20 frames and accepted the corrected lining. Final evidence: `mage-clean-male-90` and `mage-clean-female-90`. These are sampled motion checks, not a guarantee over every possible animation.

Build, typecheck, 17 focused material/inheritance regressions, and changed-file whitespace checks passed. Item IDs, stats, drops, melee materials and crafted material settings remain unchanged. The final-world fixture now clears uncovered equipment slots through the equipment UI, because the bareheaded T90 mage should not retain the previous fixture's crafted hood.
Final focused world equip/movement/save proof passed in 70,144ms at test-results/fab-armor/mage-clean-world-final. Root inspected both outdoor screenshots and confirmed the full outfit renders. An earlier three-outfit run exceeded its 90-second capture budget and is not accepted evidence; its intermediate screenshot was captured before a complete visible outfit. The focused run preserves the same budget and validates the changed mage outfit.


## Frostguard icon correction, September 11

The owner rejected the feline Frostguard item icons. Regenerated all five with built-in ImageGen as T90 Aurora human knight armor: dark blue steel, silver edges, narrow gold engraving and teal/violet inlays. Removed cat faces, ears, fur and claws from the artwork. Exact prompts, original PNG hashes and alpha reviews are in `art/fab-armor/icons/frostguard/result.json`. This correction changes icon artwork and its provenance only; the stopped mage geometry work remains stopped.

Root and a fresh read-only critic inspected all five originals, 256px masters and 48px derivatives. The production lab and final-world inventory loaded all five with the correct helm hover card and no browser errors; final-world movement changed player position. The build passed. Guide artwork was checked in Chromium against the existing built guide with updated images, including all five image hashes, hover and keyboard navigation to the helm page. The Astro dev server failed its 30-second startup, so the existing static guide was used for that asset check. Evidence is disposable under `test-results/fab-armor/frostguard-icons/`. Scope verification found exactly five changed registry entries and no changed unrelated icon assets.
