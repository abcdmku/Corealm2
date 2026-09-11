# Armor revision after owner review

The owner rejected the worn armor fidelity and player-body occlusion. Earlier armor acceptance is withdrawn. Registry armor records carry `revisionRequired`; existing production files are interim and must not be counted as finished.

Immediate focus is Corven and Grithe metal kits plus Charhide as the cloth pilot. Restore icon-specific volume, layered plates, folds, edge contrast and material response while worn. Root is adding explicit garment-covered anatomical spans so native skin cannot cover armor while exposed arms, neck, hands, pelvis and ankles survive.

All other item work is paused. Already completed non-armor work is preserved.

Pending loose-item reviews: fish-a, fish-b, meat-a, meat-b, wood-components passed and promoted. Jewelry-metal-a/b r2 both passed, not yet recorded. Jewelry-magic-b quick pass passed and promoted. Essence-runes all 10 passed; animal-fibers all 7 passed. Trophy-biology 8 pass, crab_claw fails floating beads. Feathers 4 pass, goose_down fails sparse wire appearance. Raw-hides 4 and trophy-bones-a 4, trophy-bones-b 2, creature-parts 8 rejected; authors have source revisions ready but no new exports/captures yet. Other unchanged items in those batches passed. Relics/minerals/bars fresh review pending.

All five fishing rods have current hashed passing real-fishing reports. Held-orbs-wands-r2 has current four-wand sweeps and real spell receipt. Weapons/tools review completed, but remaining promotions are paused while armor is corrected.

Further paused reviews: relics rejected molten_heart, astral_core, furnace_crown, chainbound_link, hollow_star_fragment; other four passed. Minerals rejected marks, grithe_ore, corven_ore, emberite_ore, kilnstone, cindervein_ore; other three passed. Bars all six rejected for generic untapered block silhouettes/materials; all four gems passed. No fixes assigned yet because armor takes priority.

Root diagnosis now confirms rigid plate edges stretched over three times under analytic blending. `itemModelBone` hints survive material merging and bind metal, its trim and its inset backing to the same native bone. Soft whole-garment lining also proved to occlude rigid plates, so metal authors have replaced it with plate-bound backing and narrow recessed flexible gussets. Texture repeat/offset now exports through KHR_texture_transform. Armor r1/r2 owner comparisons remain rejected; r3 is the next acceptance round. The provenance validator and docs generator now recognize the hashed item model generator.
