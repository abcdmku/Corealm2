# World finish audit

The authored world has broad content coverage, but the supplied evidence does not support a finished world. All five mine screenshots show unresolved composition problems. Cairn Tarn is fishable but still reads as a raised reservoir with a steep outer bank. The map has a visible finite seabed boundary and appears to omit three settlements. The missing settlements have a concrete boot-order cause in current source.

This was a read-only review of `AGENTS.md`, `docs/world-authoring.md`, relevant parts of `docs/feature-lab.md`, production world/render/map code, all five mine screenshots, the Cairn fishing screenshot, and `game/public/generated/world-map.png`. I did not run a browser, build, lab gate, or whole-game check. Existing resource reports provide interaction evidence, not fresh acceptance. The map metadata identifies seed 1337, a 4800-square image, canonical bounds x [-350,350], z [-200,460], and padded image bounds x [-600,600], z [-450,750].

## Findings that should block acceptance

### The map drops full entity residency after loading it

The map clearly draws Coldbrace. Rootfall, Highcairn and Emberfast appear as cleared ground or dark pads without their town buildings. This is more than a map resolution concern.

`game/src/app/boot.ts:626` synchronizes all surface entities and awaits `entityViews.forceFullResidency(true)` for map capture. Later, the settings subscription at `boot.ts:1816` immediately applies the draw distance and calls `entityViews.updateStructureRadius(...)` at line 1834. `game/src/ui/settings.ts:91` explicitly invokes a subscriber immediately. `game/src/render/entityActiveSet.ts:115` sets `fullResidency = false` when the structure radius changes; `entityViews.updateStructureRadius()` immediately reconciles the reduced active set. The final map-ready block at `boot.ts:2445` restores full scatter visibility only. The capture callback at line 2103 also restores scatter only.

This explains why a successful map capture can contain all terrain and trees while omitting distant architecture. The metadata still claims a buildings/entities layer, and the generator checks ready/errors without checking representative distant buildings.

Bounded fix: root should restore and await full surface entity residency after all startup settings and before reporting map-ready. Preserve full residency throughout capture. Before the tile loop, require resident, drawable representatives from all four settlements, including a building/wall near each town. Verify the actual output at each town before regenerating its renditions/fingerprint. Do not fix this by painting town symbols over missing production geometry.

### Mine geology still reads as one regular strip with tall end walls

The Bracken, Lower Quarry and Clinker screenshots show a broad repeated stone band, similar top depth, regularly spaced mineral panels and a continuous bench-like crown. Upper Seam is the clearest failure: both ends rise into thin, tall triangular walls. Clinker has multiple exposed angular end profiles and rear stone pieces separated by broad dark terrain. The mineral seams themselves are difficult to read at the supplied normal camera distance.

The cause is the shared extrusion in `game/src/render/mineCutFace.ts`, not a missing texture. Every station contributes the same five-point cross section, then every neighbouring section connects into one strip. Each mine has a constant `cutFace.backDepth` of 8.8 to 10.5 m in `game/src/content/worldSites.ts`. Small noise changes the face, but the broad plan and deep top remain consistent across the entire cut. The terminal construction around `mineCutFace.ts:149` shifts a full-depth cross section only 1.2 or 1.45 m sideways and sets its front heights from a terrain sample. It does not taper the rear depth to zero. The later rear clamp buries the rear edge against the hillside, but the endcap still spans the front-to-rear height difference. The resulting end wall can be very tall when the rear terrain rises.

`game/src/world/siteTerrain.ts:86` applies a fixed 2.4 m rectangular boundary fade and a mostly uniform rear/forward distance envelope around the seam. `applyWorldSiteTerrain()` uses one centre-derived work-floor height and a smooth rise behind it. That keeps mining footing consistent, but the surrounding cut reads as a smooth manufactured bowl. Increasing texture detail or adding more random stones will not change those large forms.

Bounded fix: retain resource IDs, mineral contact windows, normal depletion, the shared site transform and the shared terrain sampler. Redesign the cross-section ends so front, crown and rear merge into sampled ground over a meaningful distance; taper depth as well as height. Give the non-mineral crest and rear exposure broader, unequal recesses and broken shoulders, instead of a uniform deep top. Then tune each site's rear relief and approach through existing site terrain data/math. Keep a dry connected work strip. Do not add a separate render-only terrain correction.

The reusable face needs fresh `showCutFace()` and `showSite()` lab proof before the final-world embedding pass. The terrain embedding has the documented world exception. The root should inspect all five mines from the approach and both oblique sides, then inspect depleted seams. A single frontal image misses the terminal walls.

### Hollowcut's existing screenshot is unusable as a site overview

`test-results/world-art-current/report.json` records requested camera distance 30 m but effective distance 2.6 m at Hollowcut, with `occluded: true`. The image places the player across most of the frame and exposes nearby terrain/geometry at the bottom. This is a camera-obstructed image, not evidence that the whole site was inspected.

The root should first approach Hollowcut normally and capture the full site at a readable player camera angle. If the normal working position repeatedly forces this collapse, inspect the cut-face solids, rear dressing and camera collision together. Do not disable occlusion merely to declare gameplay readable. The report's empty error arrays do not settle this issue.

### Gravelmaw is a freestanding doorway beside the quarry

`lower_quarry_bench.png` shows an oversized portal rising above the quarry with its dark side/rear enclosure exposed. Its timber top and isolated upright outline remain visible. The recess provides depth inside the doorway, but the entrance does not read as a passage into a geological mass.

`game/src/content/regions.ts:1621` places the portal at [46,-24], scale 3, yaw 1.05. `game/src/render/compositions/gravelmawMouth.ts` builds a masonry-and-rock wrapper around that portal. `game/src/render/dungeonMouth.ts` supplies a roughly five-metre deep visual recess but deliberately supplies no terrain or solids. Meanwhile, `worldSpec.ts:117` gives named locations such as the dungeon entrance a generic seven-metre flat pad. The nearby mine has a separate site transform and terrain envelope. No shared authored mass joins the portal crown/back to the quarry hillside.

Bounded fix: root should author the entrance's terrain setting with the Lower Quarry composition so the portal has an uphill/back mass and a deliberate threshold approach. Preserve the entrance ID, destination and yaw relationship. Check whether the wrapper's crown really covers the source timber top and whether side views expose the recess enclosure. Changes to the reusable wrapper/recess require lab proof; final terrain placement can use the world exception. Acceptance needs front, both side views, normal navigation into the entrance, interior arrival and return through the reciprocal exit.

### Cairn Tarn's dry route does not prove a natural-looking bank

`test-results/world-resources/03-casting-from-Cairn-dry-bank.png` shows a closed lake on top of a steep mound. A broad, dark embankment falls away directly beside the angler. The report does prove one successful fishing interaction: 3.9 m of recorded travel, zero wet samples, a Cragfin receipt, and remaining resource count 12 to 11. It does not prove the surrounding landform is finished.

The current water profile explains the shape. `game/src/world/waterBodies.ts:77` uses fixed margins relative to the resource radius: shore +12 m, crest +14 m and outer +32 m. `scene.ts:1255` sets the basin's water level from terrain at the centre. `scene.ts:1605` then guarantees a level dry crest and takes the maximum of that minimum bank and a return to natural terrain. Where the centre is much higher than the downhill ground, the minimum closed bank raises that lower ground to the lake rim and returns over a fixed width. Organic radial compression can shorten the physical return further. The comment about a walkable mean grade is not a bound on maximum final slope after organic deformation and existing hillside relief.

Bounded fix: resolve a terrain-aware low-side return width or fit the authored tarn to its terrace, while keeping all nested contours on the same `OrganicShapeSpec`. Preserve cluster IDs and the solved production water-body authority. Do not reduce the freeboard until water leaks or move fish independently of the basin. Root must sample outer-bank slopes in physical world distance and inspect the whole downhill side. Any wider footprint must respect Far Tarn, Ridge Pines, paths and habitat anchors. Cairn and Far Tarn centres are about 81 m apart, so broad unconditional expansion risks overlap.

### The southwest ocean patch exposes the finite coast floor

The map has a hard left edge and bottom edge to a differently coloured ocean area, plus a diagonal transition across the southwest water. The rectangular edges agree with the coast-floor rectangle, x [-560,560], z [-410,670], derived from the 210 m collar. This is not a semantic biome rectangle or an organic shoreline feature.

`scene.ts:985` through line 1061 colours and renders an opaque, finite rectangular coastal skirt, including its submerged portion. The ocean is a separate plane using `materials.water("fallowmarch")` at line 1068. That cached material is transparent, opacity 0.94, and does not write depth, as defined in `materials.ts:1160`. `tools/generate-world-map.ts:235` recognizes this backing mismatch but only paints pixels outside the finite floor rectangle with one sampled median. It intentionally leaves every pixel inside untouched. Consequently it cannot remove the visible tonal patch inside the floor or make a differing southwest floor edge match the selected median.

The source establishes the backing mismatch and the limitation of the current map normalization. It does not establish the final diagonal's complete rendering cause without a layer-isolation browser probe. Root should inspect the same view with coast-floor receiving shadows isolated, then with a fully opaque deep-ocean treatment. Solve the production ocean's deep-water backing consistently; do not hide the patch by expanding a painted map region over coast pixels. Avoid mutating the shared lake material cache entry to fix ocean-only rendering. After the production fix, inspect all four gameplay coast edges and the raw capture before map postprocessing.

## Coverage and remaining evidence

There are four surface semantic regions and four visual biome fields. Gravelmaw is separately authored underground content, not a fifth surface biome. Current content has 14 resource sites and 26 ordinary surface habitats. Every surface region has a mine, a grove, a fishery and habitat definitions.

| Region | Resource sites | Ordinary habitat groups | Evidence gap |
| --- | --- | --- | --- |
| Fallowmarch | Bracken Workings, Palewood Landing, Redsill Bank | 8 | Supplied images cover Bracken and nearby forest. Need grove composition, Redsill fishery, farm/pen activity, western approaches and coast. |
| Vellenwood | Hollowcut Workings, Duskoak Hollow, Blackwater Landing | 7 | Hollowcut overview is obstructed. Need woodland worksite/river-bank context, settlement approaches, gorge paths and habitat placement. |
| Karrowmoor | Lower Quarry Bench, Upper Seam Shelf, Ridge Pine Shelter, Cairn Tarn Ledge, Far Tarn Cove | 6 | Both mine silhouettes fail. Cairn has one valid fishing receipt but an unresolved outer bank. Far Tarn and Ridge Pines lack supplied acceptance views. |
| Kilnhalt | Clinker Cut, Cinderpine Survivors, Ashfin Warm Bank | 5 | Clinker repeats the mine defects. Need grove/fishery, Emberfast, fire-region habitat and seam/coast evidence. |
| Gravelmaw | Surface entrance and four interior chambers | Dungeon groups keep authored encounters | Supplied evidence only shows the exterior beside Lower Quarry. Interior progression and return are not proved by this audit. |

The current world map is not reliable settlement-coverage proof until the full-residency problem is fixed. The mine/forest report has empty game/console/page/request error arrays. The resource report also has empty error arrays and proves natural forest depletion, saved stump return and one Cairn receipt. Neither report covers every site or the requested new creature roster. At the fishing observation the renderer reported about 67.1 million triangles and 813 calls. That is one sampled frame, not a controlled performance comparison, but it prevents assuming substantial free rendering capacity for more detailed wildlife.

## Constraints for integrating 24 new unique creatures

The current 26 habitats are settings for existing ordinary groups, not proof of 24 new species. `regions.ts` still maps them to existing animal assets, several colour variants and human reavers. A species count must name distinct new production models with their own silhouette/anatomy and motions. Renaming an existing group, adding another habitat or recolouring an existing model does not satisfy that request.

`worldHabitats.ts` owns authored world-space spawn/activity anchors and dressing. `regionBuilder.ts:1943` takes the first `group.count` habitat anchors as initial positions but silently falls back to the old spiral when anchors run out. `enemyAI.ts:268` requires habitat activity to remain inside both the habitat radius and semantic region bounds. Idle movement uses a 0.1 m navigation tolerance. Grazing/foraging chooses nearby anchors; prowling/patrolling ranges through them. This supports local land animals, not an already-complete swimming or flying habitat system.

Integrate accepted creatures in a later root round with these checks:

- Give every new group at least `count` valid anchors. Require the spawn and every intended activity point to be dry, within canonical playable/semantic bounds and on the production navmesh. Check their connecting motion, not only the points.
- Use organic biome samples to assess the visual habitat. A semantic region label alone does not mean the location visually belongs to that biome. Avoid spreading groups into the visual-only coastal collar.
- Preserve existing group/resource/quest IDs and existing tier/stat rules unless root intentionally changes their contracts and callers. Current habitat overrides already differ from several old group centres/comments, so placement consumers must use the habitat authority.
- Keep routes, fishery casting access, mine work floors, doors, pens and boss approaches clear. Habitat dressing already enters ordinary world solids/exclusions through `boot.ts:375` and `buildWorldSiteDressing()`; use that path.
- Prove the new model, scale, footprint, idle, locomotion, attack, hit response and death in the creature lab first. A flying/swimming species needs an actual production movement fixture before world placement. The existing terrain-bound habitat activity is not such a fixture.
- Check all 24 distinct actors in their final authored settings, with semantic IDs, model IDs, positions and activity evidence. Then inspect representative group motion and normal gameplay interactions per biome. Measure the actual combined resident render/animation cost at matched cameras.

## Suggested bounded implementation rounds

Root should keep `contracts.ts`, `worldSpec.ts`, final content integration, combined gates and map regeneration. A mine worker can own `render/mineCutFace.ts` and its compact fixture changes. A water worker can own `world/waterBodies.ts` and propose the necessary root-owned `scene.ts` basin changes. A portal worker can own the reusable `render/compositions/gravelmawMouth.ts` and `render/dungeonMouth.ts` modules. These workers must not concurrently alter `worldSites.ts`, `scene.ts`, `boot.ts` or the shared environment fixture.

After root accepts the reusable lab results, integrate site data/terrain in a short world round, then accept the 24 creature assets and wire their groups/habitats in a separate integration round. Restore map residency and resolve the ocean backing before the final map capture. Final acceptance should include every site, every settlement, the biome seams, coast edges, all five lakes, all 24 new creatures and the dungeon entrance round trip. This audit supplies diagnoses and bounded changes, not gameplay approval.
