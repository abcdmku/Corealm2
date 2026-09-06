# Equipment package 05

## Implemented

Eight armor sets are inferred from the five equipped armor slots. The catalogue uses existing save IDs and display names: Copper, Iron, Cobalt, Titanium, Hide, Thick Hide, Fur and Heavy Hide. Two pieces grant the matching defense. Four add vitality. Five add the other defense. No power or accuracy bonuses change the established damage arithmetic. The root integrates `getEquipmentSetBonuses` into derived stats and `inferEquipmentSets` into the equipment panel. No save migration or new recipe is required.

`equipmentVisuals.ts` preserves authored shader callbacks when it clones a material. Previously a material could lose the inherited shader treatment during equipment tinting. The regression checks callback composition, cache identity and source immutability.

Original weapon geometry is in `game/src/render/equipmentWeapons.ts`. `tools/build-corealm-equipment.ts` exports 24 unreviewed GLBs under `art/rebuild/candidates/2026-09-05/equipment-v1`, with exact hashes and metre bounds in `catalogue.json`. The catalogue works with `installAssetCandidates` and is outside the public directory.

The sword has four blade profiles and a full palm grip with crossguard and peened pommel. The dagger reuses the existing independently authored short blade rather than pretending it needed a scaled sword replacement. The axe has a bearded head, eye, honed bit and wooden haft. The shield has a pointed board, rolled rim, central boss and separate rear grip. Staff and wand have separate lengths, fittings and crown construction. Wood and leather have embedded grain textures; metal, blade, wood, leather and crystal retain separate material responses. Materials are merged by role during export. The candidate forms are original Corealm work, with no reference image copied or bundled.

## Reference inspection

Both user URLs were inspected in Chrome on 2026-09-05. The supplied comparison URL initially opened empty selections. The working list then allowed Durandal and Exceptional Graham to be selected, exposing attack power, cadence, requirements and other comparisons. The sets calculator showed Dragon Scale at five pieces, then changed its bonuses when Gauntlets was unchecked. The design takeaway is readable partial-set progression and weapon tradeoffs. The reference game's names, artwork and numerical balance are not imported.

- https://kobugda.com/sets
- https://kobugda.com/compare?cat=WEAPON_SWORD&items=cmm8e90sj000xjgq9vt8wvjtm%2Ccmm8e91px00jujgq9cjrqe4vz&grades=1%2C1

## Bindings after acceptance

The candidates are named `corealm_<form>_<grade>`, where form is sword, dagger, axe, shield, staff or wand and grade is 1 through 4. Grades correspond to existing level 1, 5, 10 and 20 ladders. They have not replaced current production bindings. The sword, dagger and axe preserve existing local grip centres. The new shield, staff and wand need new sockets before held review.

| Form | Local grip centre | Planned attachment |
| --- | --- | --- |
| Sword | `[0,-0.1,0]` | Existing sword rotation and scale 1 |
| Dagger | `[0,-0.1,0]` | Existing dagger rotation and scale 1 |
| Axe | `[0,-0.25,0]` | Existing axe rotation and scale 1 |
| Shield | `[0,0,-0.065]` | Fit rear bar to left fist; do not reuse old shield offset |
| Staff | `[0,0,0]` | Fit origin to right fist, then tune diagonal from live animations |
| Wand | `[0,0,0]` | Fit origin to right fist, then verify casting wrist |

Elemental staffs and wands have a crystal already in their candidate crown. Do not add the existing orb at its old imported-mesh coordinate. The builder exposes `userData.elementalSocket` for a later charge-presentation binding.

## Checks and remaining acceptance

- Twelve armor-set tests pass, including exact slot membership, mixed sets, quantities, threshold arithmetic and source immutability.
- Thirty-one focused material tests pass, including preservation of inherited callbacks and independent wood material color/roughness under metal-tier tinting.
- Four candidate tests pass, checking six forms, dimensions, native grips, embedded material textures, GLB loading, different sword profiles and outward-facing thin axe edges.
- Twelve mineral tests pass. Fresh generation exactly matches all eight durable v5 candidates. See `MINERAL-PACKAGE05-AUDIT.md`.

Run `npx tsx runs/corealm-rebuild/checks/equipment-candidates.ts` only during the root's GPU slot. `EQUIPMENT_REVIEW_URL` selects the persistent Vite server. Arguments can select any candidate IDs; the default captures the six first-grade forms from front and back through the production environment lab. Its `passed` field proves loading and state selection, not visual acceptance.

The first hardware batch captured six candidate forms from front/back and all eight current armor sets on both bodies from front/back. `test-results/equipment-worn/report.json` initially recorded 32 shots and clean errors. Screenshot review found hair penetrating the helmet crown on both bodies and female buns penetrating the hood. `CharacterRig` now excludes the hair region while headgear is worn and restores it when headgear is removed. A failed clothing-source load now preserves the complete previous layers and cap instead of applying partial clothing. Three focused rig tests pass, including retry of unchanged requested gear after a failed load. The post-fix quick rerun replaced Copper and Hide captures and the report; other initial armor captures retain their original state.

The first shield image exposed an extruded spike at the rim closure. Removing the duplicated contour endpoint fixed it. The new export was reloaded and its front/back images inspected; `test-results/equipment-candidates/corealm_shield_1-back.png` shows the repaired contour. The helper's latest report records that two-shot rerun.

No candidate has final visual acceptance yet. Inspect close and normal-distance silhouettes, edge thickness, fitted grips, every grade and materials before promotion. Existing imported magic heads have detailed carving worth retaining; the new construction is a candidate, not an automatic replacement. Next review all seven worn slots on male and female bodies in walk, run, melee, casting, gathering and death, including mixed armor. `EQUIPMENT_REVIEW_QUICK=1` narrows the worn helper to Copper and Hide and adds head-removal shots for both bodies. See `equipment-armor-audit.md` for the full matrix. Generate 256 px masters and 48 px icons only after model acceptance, then prove equipment stats and presentation after save/reload.

## Post-fix hardware rerun

The scheduled quick rerun passed with 12 worn captures on both bodies and two axe captures. Every captured image was inspected. Copper helmets and Hide hoods now conceal the hairstyle without visible protrusions; removing either head item restores the male swept hair and female buns. Faces and necks remain present. Semantic checks verify each equipped member ID and the cleared head slot. Runtime, console and request error lists are empty. The helper uses normal production equipment operations through the lab API; inventory grants remain fixture setup.

Current proof is in `test-results/equipment-worn/report.json` and the matching `male/female-copper/hide-front/back/head-removed.png` files. The latest `test-results/equipment-candidates/report.json` records the axe rerun; `corealm_axe_1-front.png` and `corealm_axe_1-back.png` show the corrected continuous bevel beyond the forged slab. This accepts the specific hair hide/restore and axe construction fixes for root review. It does not accept all 24 candidates, worn animation or final icons.

## Whole catalogue disposition

`equipment-catalogue-disposition.json` enumerates all 227 current item IDs, their exact icon parts, both-body gear mappings, source hashes and remaining review. Coverage is 40 armor, 9 swords, 4 daggers, 13 staves, 9 wands, 4 shields, 24 accessories, 15 tools, 24 food, 10 minerals, 50 drops, 12 timber, 4 bars, 8 elemental items and one currency item. Every item has existing 256 px and 48 px files with valid dimensions.

Direct inspection of `art/item-icons/contact-sheet-48.png` confirms that sheet is stale. Labels still use Grithe/Corven-style material names, and minerals use old primitive shapes despite current icon mappings targeting the native GLBs. The sheet also predates current fishing rods. Regenerate all icons with `--all` after accepted asset promotion; valid file dimensions do not establish freshness. Current rings/charms, cooking-state distinctions and animal-drop forms are broadly readable in the old sheet, but some dark rods and staves need specific contrast review on the fresh sheet.

## Full mineral and sword review

The next hardware batch loaded all eight current mineral candidates and four sword grades with clean engine, console and request checks. All 24 mineral front/back/side captures in `test-results/mineral-v6-review` and eight sword front/back captures in `test-results/sword-grade-review` were inspected.

Recommended for root model acceptance: `corealm_item_grithe_ore`, `corealm_item_corven_ore`, `corealm_item_kaldite_ore`, `corealm_item_pale_quartz`, `corealm_item_vell_amber` and `corealm_item_cairn_garnet` from `test-results/mineral-items-v6/catalog.json`. The three ore faces show different mineral cleavage against a coherent stone host. Quartz reads as a milky prismatic cluster; amber now transmits terrain and refracts its small seed inclusion; garnet retains unequal dark red growths and its stone root.

Opal v6 still reads as a uniform caramel lens despite physical thin-film domains, so it remains rejected. Emberite's front passes, but its rear was an anomalous black untextured cap. V7 changes only these two files: explicit warm opal albedo domains and the same textured host on the emberite rear. They remain unreviewed at `test-results/mineral-items-v7/catalog.json`; the other six bytes are unchanged.

Sword grades `corealm_sword_1` through `corealm_sword_4` have clean distinct blade profiles and guards in all eight views. The first grade also fits the male fist after normal equip and save restoration, with the guard clear of the hand and body. The corresponding current screenshot is `test-results/equipment-held-candidates/male-sword-restored.png`. Candidate bindings would map Grithe/Corven/Kaldite/Emberite sword IDs to grades 1/2/3/4, inheriting the current sword socket and local grip `[0,-0.1,0]`. Final acceptance still needs the female front capture.

The first held gathering rerun failed a five-second wait for actual `equip-mainHand-axe`, superseding the earlier semantic-only pass: that capture showed a sword during real chopping. Diagnostics resolved this as a fixture error: the shared combat lab had already filled the pack, so its later forest hatchet grant silently failed. Filtering that inventory left no carried tool. The helper now explicitly puts one hatchet in its declared cleared inventory fixture before the real tree click. Both bodies then passed the actual axe-attachment wait, active gathering and production save/equipment/stat restoration checks. All four latest screenshots were inspected and root accepted the sampled grips. No speculative rig priority fix was made.

Root accepted seven mineral models and the four sword profiles plus the first axe grade. The selected normalized catalogues are `art/rebuild/candidates/2026-09-05/equipment-selected/minerals/catalog.json` and `weapons/catalog.json` beside it. They include original pack provenance and exact copied source bytes, and exclude opal. The full item disposition JSON records the actual view paths and separates these model acceptances from pending final icon and animation acceptance. The v7 opal's large saturated patches still read as a striped button; it remains excluded while an irregular, partly matrix-covered exposed surface and finer warm domains are revised.

A focused regression now checks every triangle in all four sword blades: outward faces, cutting edges and base cap, nonzero area and matching normals. All five weapon tests pass. The earlier inward-face concern is resolved in the current generated geometry without changing the reviewed bytes.

## Accepted production bindings and next proof

Root promoted seven mineral GLBs and five weapon GLBs with verified original provenance. `equipmentVisuals.ts` now binds Grithe, Corven, Kaldite and Emberite swords to `corealm_sword_1` through `corealm_sword_4`. Their authored lengths provide progression at a fixed 0.9 fit scale; the worn sword uses grade 1 at its original 0.774 scale. All five hatchets use the accepted `corealm_axe_1` with the existing tier tint/size policy. Socket aliases preserve the measured local sword grip at Y=-0.1 and axe grip at Y=-0.25. The selected weapons sidecar records all ten exact item bindings.

The four focused equipment/material/geometry files pass 63 tests after these bindings. `checks/equipment-public.ts` is prepared to verify all four equipped swords on both bodies, production save restoration, and real carried-axe gathering on both bodies using public assets without test aliases. This browser run and screenshot inspection remain queued. Final catalogue icons remain root-owned.

Opal V8 is staged in `test-results/mineral-items-v8/catalog.json`. Its source uses an irregular shallow exposed contour with host overlap and smaller warm domains. Fourteen mineral tests pass; the seven already accepted specimens are byte-identical. V8 opal is not yet visually accepted or promoted.

A later mining screenshot review raised a possible sword-instead-of-pick issue. Upper Seam's report confirms a real carried Kaldite Pickaxe and active mining; the loop and rig mappings correctly select it. The Upper and Clinker screenshots resemble the imported pick's broad curved head from a broadside angle. The mining helper owner is adding actual attachment diagnostics and a clearer angle before deciding whether any runtime change is needed. This is separate from the earlier missing-hatchet fixture error.

## Public hardware verification

The scheduled public-assets run passed all eight sword cases and both real axe gathering cases on NVIDIA RTX 5080 / Direct3D11. It used no asset interception or candidate aliases. Each sword's actual attachment ID matches its published tier after ordinary equip and production save import; exact equipment, inventory and maximum health remain equal. Both explicit carried-hatchet fixtures transition to `equip-mainHand-corealm_axe_1` after a real tree click. Engine, console and request error arrays are empty.

All ten PNGs in `test-results/equipment-public` were inspected: `{male,female}-{grithe,corven,kaldite,emberite}-sword.png` and `{male,female}-axe-gathering.png`. The blades and guards remain intact and the handles meet the fists. These views support sampled attachment acceptance; they do not establish clipping through every animation or actual browser-reload persistence (the check imports a production save).

The same GPU lease captured and inspected V8 opal front/back/side in `test-results/mineral-v8-review`. Its exposed patch is now irregular and shallow within the host, with smaller color domains instead of broad bands. Polygonal mottling remains visible at this close scale. The model loads intact with verified hardware rendering; root art acceptance and promotion remain pending. Both browsers closed and the GPU lease was explicitly released.

Root subsequently accepted the public weapon bindings and sampled grips. A fresh critic inspected all three V8 opal views and accepted the model; root promoted its exact bytes using verified original pack metadata. Receipt: `test-results/mineral-v8-review/promotion.json`. All eight minerals and five weapon assets are now public, and the 227-item disposition verifies their current hashes. Final icon regeneration remains pending.

Current wardrobe coverage still needs completion: the original 32 all-family images predate the hair fix. Only the 12 Copper/Hide follow-up views establish post-fix headgear proof. A new bounded `equipment-wardrobe.ts` prepares all eight families on both bodies with front/back/head-removed views and production save restoration. It must run only under the next assigned GPU lease.

## Full current wardrobe proof

`test-results/equipment-wardrobe/report.json` passes 48 current public-asset views: all eight families on male and female bodies, each front, back and head-removed. All images were personally inspected. Helmets and hoods conceal the hair without protrusions; removal restores the male swept hair and female buns. Armor, sleeves, gloves/wraps and boots retain coherent visible coverage. Fur and Heavy Hide lose fine contrast on the shaded back, but the full silhouette remains readable.

Sixteen production save-import checks preserve the exact committed layer signature, source asset list and visible mesh names, plus equipment and inventory. Hair hide/restore checks pass in every case. The renderer is NVIDIA RTX 5080 / Direct3D11; engine, console and request errors are empty. The browser closed and GPU lease was released. This supersedes the historical pre-fix wardrobe batch for current static coverage. It does not establish clipping through every animation or mixed-set combination.

The separate mining helper now verifies `equip-mainHand-pickaxe` with no load errors at four successful world mines. Its side views identify the curved pick head and wooden haft clearly, resolving the earlier sword concern. Evidence: `test-results/finish-mining/world-20260905-145335/{bracken_workings,lower_quarry_bench,upper_seam_shelf,clinker_cut}/02b-mining-tool-side.png`. No tool runtime change was needed.
