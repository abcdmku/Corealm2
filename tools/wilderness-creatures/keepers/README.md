# Wilderness rune keeper candidates

Build with `node tools/wilderness-creatures/keepers/build.mjs`. Rebuild one body with `--only ashseal_warden`, `furnace_regent`, `chainbound_archon`, `nightforge_marshal`, or `hollow_star`. Run the focused offline check with `node tools/wilderness-creatures/keepers/check.mjs`.

The build only stages `test-results/wilderness-creatures/keepers/catalog.json` and its GLBs. Root owns lab registration, promotion, combat stats, loot and final placement. All five bodies should render at final scale 1.0; ordinary creature tier and miniboss multipliers must be cancelled by species registration.

| Body | Native idle width / height / depth | Complete animated bounding circle |
| --- | --- | --- |
| Ashseal Warden | 3.74 / 4.18 / 2.60 m | 4.16 m |
| Furnace Regent | 4.23 / 4.64 / 2.38 m | 3.38 m |
| Chainbound Archon | 2.59 / 4.59 / 3.85 m | 4.53 m |
| Nightforge Marshal | 4.25 / 4.66 / 2.87 m | 4.96 m |
| Hollow Star | 4.51 / 4.25 / 2.24 m | 3.80 m |

Circle values conservatively enclose the complete 60 Hz animation bounding box, including reactions, weapon travel and corpse fall. Chainbound's current 4.53 m value encloses the union of complete 60/120 Hz cycles. Each body is batched into one weighted mesh with three or five material primitives; part names remain in design metadata. The complete per-clip measurements are in each entry's `metadata.redesign.measurements`.

Ashseal and Nightforge replace every visible Iron Golem mesh. Furnace replaces every visible Lava Golem mesh. Chainbound replaces every visible Banshee mesh. The licensed source skeletons and gait clips remain, with slower timing, delayed attack contact and revised body movement. Imported reaction and death wrappers remain active. Floor correction is resampled from the rebuilt geometry. The grounded rear falls gradually recenter over the battle pad to contain their larger shield and hammer limbs.

Hollow Star has an original twenty-joint six-limb rig and eight authored clips. Its underside tendons blend weights between each upper arm and forearm. Both hovering bodies use `groundY: 0`, preserving their 23 cm body clearance in production placement. Death reaches the floor.

The original material atlas lives at `assets/art/wilderness-creatures/keepers/material-atlas.png`; the current build consumes `material-atlas-v3.png` after the night readability repair. Both imagegen edit prompts are preserved alongside it. Its average diffuse sRGB values are approximately 172 for basalt, 174 for iron, 165 for obsidian and 180 for ash strata. These brighter weathered surfaces remain non-emissive and nonmetallic. White material multipliers preserve the authored texture exposure.

The separate `heat-atlas-v2.png` drives both base colour and emission only on the existing recessed core geometry. Dark crust islands break up connected saturated orange-red or blue-violet channels. The scalar emission multipliers are 0.90 shallow and 0.85 deep; colour and heat variation come from the map. Textured inner joint volumes use the weathered atlas with a darker charcoal multiplier, rather than an untextured black fill. The build embeds optimized albedo copies and grain-derived roughness. Triangle-level planar projection keeps every face inside one material cell, including across coordinate repeat boundaries.

The material pass preserved byte-identical positions, normals, joint IDs, weights, indices, hierarchy, skins and animation channels. Parent explicitly authorized adding `TEXCOORD_0` only to previously unmapped interior primitives so those closed joints can receive their charcoal texture. Existing UV streams remained unchanged. `material-core-audit.json` is preserved as historical evidence of that pass, against the ignored `material-core-baseline` folder. Its other four keeper rows still describe the current GLBs; its Chainbound row predates the subsequently authorized geometry repair and must not be presented as current geometry equivalence.

Chainbound's later geometry repair replaces solid forearms with joined stone rails, narrows its hooked palms and changes doubled wrist loops into open shackles. Its two structural thorax ribs bow behind the recessed marrow, leaving a side window as the native caster body turns. The marrow is wider inside the frame; its texture and emission remain unchanged. All native animation channels, hierarchy, skin and material bytes match `chainbound-baseline`; only authored geometry, its UVs and the derived floor correction changed. The other four keeper GLBs and catalog entries are byte-identical.

Run `node tools/wilderness-creatures/keepers/chainbound-geometry-check.mjs` for the separate full 60/120 Hz geometry report. It samples every vertex throughout all eight complete clips and casts area-weighted rays against posed triangles from the previously recorded normal gameplay front/orbit camera positions. Visible chest marrow is 53–89% from the front and 49–76% from the orbit across idle/walk/run quarter phases and attack telegraph/contact/recovery poses, compared with 0% in the old idle orbit. The original crown seam is excluded. The actual maximum vertex radius is 4.13 m, and the maximum per-frame AABB radius is 4.52 m. Hover clearance remains 20.5–25.5 cm; the 120 Hz death interpolation reaches at worst 1.4 mm below the floor. These CPU results do not establish night readability. Chainbound requires new complete-cycle production lab proof; the other four require material keyposes.

The night review also found reversed loft end faces, which exposed thin open loops on Ashseal's shoulder and Furnace's wrist. Their cap winding is corrected. Each grounded keeper now has a rounded dark inner knee with blended thigh/calf weights, closing the terrain-visible gaps during the support cycle. The rig, all clip channels, idle bounds and complete animated envelopes remain unchanged. These repairs add 360 triangles to each grounded keeper and no triangles to the two hovering bodies.

The focused offline check verifies hashes, skin weights, normals, UV containment, non-static visible geometry in all eight clips and sampled floor contact. It is not production visual acceptance. Root must inspect normal gameplay camera screenshots and real lab actions before promotion.
