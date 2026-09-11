# Ordinary Wilderness creature candidates

This generator retains production source rigs and clips and builds new anatomical volumes. It exports only to `test-results/wilderness-creatures/ordinary`. The root agent owns catalogue registration, production lab acceptance, promotion and world placement.

```powershell
node tools/wilderness-creatures/ordinary/build.mjs
node tools/wilderness-creatures/ordinary/audit.mjs --apply
```

`--only <creature-id>` rebuilds one candidate. Run the audit again after rebuilding. It independently decodes the final GLB through Three.js and checks all eight clips, sampled deformed floor bounds, active and death horizontal envelopes, and sole movement. The image and motion still require production lab acceptance through normal gameplay camera controls.

| Creature | Body construction |
| --- | --- |
| Cinderback Crag | Split transverse basalt mantle, eight retained support legs, and a low crushing shelf jaw. |
| Furnace Grazer | Rebuilt headless shoulder dome, hot inner throat, slab forearms and broad palms. |
| Basalt Maw | Open jaw cavity, two crushing lobes, lower rock teeth and broken dorsal keel. |
| Rift Carapace | High longitudinal slate plates over an open inner channel, bifurcated prow and eight support legs. |
| Voidstone Colossus | Complete statue mesh replacement with separated ribs, long buttress arms, closed slotted head and column legs. |
| Gloam Wraith | Hollow forward slit cowl and trailing folded membrane body, retained articulated arm membranes and a downward folding death. |

The original albedo atlas lives in `assets/art/wilderness-creatures/ordinary/anatomy-atlas.png`. The night-readability revision uses `anatomy-atlas-v2.png`, preserving its grain and pores with weathered grey, muted slate and faded membrane midtones. Complete built-in imagegen prompts are saved alongside both versions. Basalt, slag, violet slate and fibrous membrane occupy separate UV cells. Added volume faces choose one planar projection per triangle and stay inside one atlas cell.

`core-atlas.png` supplies mottled red-orange or blue-violet heat and dark cooling crust to both the base-colour and emissive texture slots of the existing recessed cores. Body faces and unlit cavities have no emission. All materials explicitly use metallic factor zero and retain the `animal_rpg_` prefix for production material preservation. `material-audit.mjs --snapshot` records a candidate baseline before a material repair; running it afterwards proves that geometry, clips, node hierarchy and dimensions stayed identical and checks the textured emission bindings.

Gloam's existing inner hood wall uses `gloam-innerwall-emission.png`, a narrow off-centre ragged blue-violet mask with a black centre. Its material-only revision adds planar XY UVs to that formerly unmapped wall without changing positions, normals, indices, skin or clips. The mask test checks that lit pixels occupy 1–15% of the image and that its centre stays black. The surrounding cowl and membrane keep their accepted nonemissive materials.

Grazer's front mantle has a connected broken opening joined to an existing seam. Its banks span the real shell thickness and use darker vertex shading, while the exposed original core retains its mapped crust and heat. `cavity-audit.mjs --opening` compares occlusion at three normal camera-height directions. The outer vertices, complete animated envelope and gait are preserved. Voidstone's anatomy is batched into four skinned material primitives; `batch-audit.mjs` compares every vertex to the prior rigid parts at 120 Hz.

Source license and attribution are inherited from the manifest and copied into each candidate. Cinderback and Rift retain Quaternius Easy Enemies CC0 rig lineage; Furnace retains the Earth Elemental source's CC BY 3.0 attribution; Basalt retains the Beetle Golem source's CC BY-SA 3.0 attribution and share-alike requirement; Colossus and Gloam retain Quaternius Universal Base Characters CC0 lineage. Full source attribution, file hashes and original pack references remain in the candidate metadata. The new geometry and atlas are Corealm-authored derivative work; no source license is replaced.
