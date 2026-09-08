# World authoring

This is the short path for changing terrain, biomes, water, coast, paths, foliage, and wind without
creating a second world system.

## Relationship to the feature lab

This workflow owns proof of the authored full world: terrain and coast shape, biome fields, water placement, world-scale scatter and paths, final wind composition, world layout, and island-scale navigation. Those concerns may use a recorded exception to the lab-first gate because isolating them would remove the behavior under test.

Keep the exception narrow. Build reusable structures, foliage assets, materials, wind response, effects, UI, controls, and local interactions in the production-backed feature lab first. The root accepts that lab proof before the world-authoring step places or composes the feature in the final world. If a task mixes reusable feature work with world generation, split those into lab and integration phases.

## Authority and ownership

- `game/src/contracts.ts` is frozen shared state. Stop and report if a task needs a contract change;
  the root changes the contract and all callers together.
- `game/src/content/regions.ts` owns semantic regions, locations, settlements, resource clusters, and
  interactable content. Its coordinates drive quests, navigation, and player region state.
- `game/src/content/worldSites.ts` owns local mine, grove and fishery layouts. Resource slots retain
  their cluster/index IDs while site transforms place veins, trees and fishing access meaningfully.
- `game/src/app/worldSpec.ts` is the authored Corealm terrain and visual-field configuration. It is
  root-owned and frozen while workers are changing world details.
- `game/src/world/organicFields.ts` owns reusable deterministic math, including biome, coast, and
  lake-shape sampling. `game/src/world/waterBodies.ts` owns lake profile dimensions.
- `game/src/app/worldSurface.ts` turns authored roads, paving, and fishing clusters into surface
  stamps and water work. `game/src/render/scene.ts` owns terrain sampling, rendering, and wind.
- `game/src/world/scatter.ts` owns deterministic vegetation and dressing placement, including the
  stable descriptors for ordinary harvestable forest trees within playable bounds.
- `game/src/world/forestResources.ts` promotes nearby tree descriptors into normal gathering entities.
  `forestObstacles.ts` handles resident trunk collision without rebuilding the island navmesh.

Give concurrent agents distinct files. Do not change `contracts.ts` or `worldSpec.ts` to make a local
task easier.

## Semantic regions and visual biomes

The authored region rectangles remain exact. They own `regionAt()`, player state, quests, and routes.
Outside those rectangles, coastal land inherits the nearest semantic region. Map movement bounds
include the coastal terrain extent; dry ground and navigation determine the actual playable edge.
These rectangles are semantic ownership, not the shape of the land. They may still be useful as
content envelopes, but they must never be used as visual biome masks or scatter limits.

Terrain relief, palette, scatter, and `sampleWorld()` use one normalized competing field from
`sampleOrganicBiomeWeights()`. It samples two broad climate channels, moisture and exposure, from
deterministic multi-scale noise. Each visual biome names a climate target and tolerance, then adds
small raw-coordinate intent anchors and bounded corridors around authored places. A shared softmax
turns those scores into weights, so the same organic lobes and ecotones drive every visual consumer.
An anchor's hold radius is a guaranteed circular core: every point through that radius resolves to its
field. Beyond the core, the anchor feathers smoothly to its broader influence radius without drawing a
rectangle around it. Corridors guide a biome between intents, but their finite half-width never pins a
long straight border.

The field may cross a semantic rectangle, but never moves a location or changes gameplay ownership.
The analytic `heightAtXZ()` field initializes the terrain lattice. Road grading updates that shared
lattice before meshes are built. `meshHeightAt()` then supplies terrain placement and physics from
the graded core or coastal grid. Never add a separate render-only height sampler or write biome
weights into content or saved state.

The coast is playable terrain. `sampleOrganicCoast()` keeps the canonical rectangle dry, then walks one
continuous periodic turn around a rounded rectangle reference. A five-band quintic value-noise fBm
(3, 7, 15, 31, and 63 cells) creates the broad reach. Separate 63, 127, and 255 cell bands add only
8 m, 3 m, and 1.5 m of detail after shaping, so smaller inlets stay visible without becoming long
spikes. The result is one connected fractal contour rather than a collection of ellipse lobes. Short
join bridges soften the descent where a side meets a corner without changing the shoreline contour.
Dry headlands inherit the actual organic biome relief and material sampling, so the continuation
does not become a flat shore. The shoreline range is 18-190 m and the rendered collar is 210 m,
leaving a 20 m guaranteed margin beyond the furthest reach. Map padding rounds beyond that to 250 m,
while authored markers retain their coordinates. Dry coastal triangles feed navigation and terrain
picking, and the physics heightfield and placement sampler use the same coastal grid. Submerged
triangles are excluded from navigation. Do not add an ocean region.

`coastalSpawnSites()` distributes deterministic creature sites across dry coastal land. Species come
from the visual biome's ordinary enemy groups; semantic ownership remains the nearest region.
Reject wet footprints and steep sites before passing them to the production enemy builder.

## Organic fields and lakes

Use the deterministic helpers in `organicFields.ts` rather than adding another noise or shape system.
Use `seedFromText()` with a stable authored ID. For a new biome, set a climate target and tolerance,
then place several small anchors at meaningful places. Set `holdRadius` for an exact guaranteed core,
then let the sampler feather it out to the anchor's broader `radius`. Use a bounded corridor only where
a biome should have a soft connection between two intents. Keep anchors in raw world coordinates so
they stay attached when climate noise changes. The shared softmax keeps competing weights covered and
normalized, so a seam cannot collapse to an arbitrary fallback. Never use `Math.random()` in world
generation.

Do not add an ellipse or rectangle-sized backstop for a biome. Large backstops recreate the old
three-block map and make every border follow a canonical axis. If the open land needs more coverage,
tune the climate targets, tolerances, and seed instead. The `world-preview` census should show every
authored centre owning its field with a useful margin and the raster should show lobes that double
back, fork, and reach the coast without a long axis run.

Lakes share one `OrganicShapeSpec` across every nested ring. `waterBasinForCluster()` remains the
authority for floor, shore, crest, and outer radii and water depth. Use the same organic distance for
the terrain carve and wet bank. `getWaterBodies()` and its solved, closed contours are the downstream
authority for water rendering and shoreline scatter. Do not recreate a lake with a circle or nominal
basin guide.

## Paths and ground stamps

`collectRoadStamps()` keeps authored endpoints and gate-axis controls. `scene.curveRoadPolyline()` adds
the deterministic broad meander, up to 9 m. `RoadStamp.width` controls the worn track, fade, and verge;
keep width drift restrained. Bends shrink when the sampled lane would leave a graded ramp.
`getRoadPolylines()` is the authority for the drawn path used by the map, scatter, and exclusions.
Steep tracks grade the shared height lattice before terrain chunks, physics, and navigation are built.
Settlement foundations and water floors retain their ground. Dry lake approaches can be graded while
preserving closed banks. Route endpoints remain authored.

Roads, paving, and waterlogged banks are stamped into the ground surface. Keep their placement on the
same sampled surface rather than laying duplicate geometry over it.

## Resource sites

Use `WORLD_SITES`, its resource slots and the shared site transform to place a mine or grove. Existing
resource IDs, resource definitions and saved yields survive a presentation/layout change. Ore belongs
in a worked geological face with a dry, reachable work floor and an approach connected to the world.
Do not scatter isolated ore boulders onto an empty field or duplicate a mine's shape in another sampler.

The environment lab's `showSite()` and `showCutFace()` isolate production dressing, ore, extraction
states, collision and local mining. Accept those before integrating the face with authored terrain.
Then inspect the full site's relief, work floor, seam orientation, approach, navigation and depleted
state. The world exception covers that spatial integration; it does not waive the reusable asset gate.

Ore deposits use weathered fracture masses and broad mineral exposures, with matching depleted hosts.
The ordinary ore placement target is 1.55 m across, with native heights of 0.82?1.02 m. Change both
the generator dimensions and the production tier presentation target when resizing: runtime sizing
normalizes the source mesh. Geometry and granular normal maps are now original generator output.
The cut face defaults to 0.40 m behind the resource centres, embedding their rear blocks. Its shoulder
meets the sampled receiving bank; the terrain rise begins 1.25 m behind the seam. Keep the work aisle
and resource IDs stable when adjusting this join. The September 2026 ore revision used the lab for
the assets and pointer mining, then the world exception for the receiving bank's terrain profile.

Fishery slots must reference the solved production basin. A fishery slot authors only which
outward ray a school belongs to (`slot.x`) and how it is drawn; `game/src/app/fishingAccess.ts`
solves the dry casting stance and the school itself from the built water body, so both sit on one
ray and the school lands just inside the waterline in water deep enough to hide the fish
(`SCHOOL_MIN_WATER_DEPTH`). Do not reintroduce an authored `slot.z` offset for fish: that is what
put Redsill's schools 14 m out in open water while the player cast from the far bank. The dry
environment gallery cannot prove fishing; `fishing=1` supplies the compact water fixture described
in [the lab workflow](./feature-lab.md).

## Foliage and scatter recipes

`DEFAULT_SCATTER` uses a simple 1.95 budget scale to keep density steady while the visual island is
larger than the playable rectangle. Normal biome recipes sample all dry visual land through
`getScatterBounds(Infinity)` and `scatterSurfaceAt()`, so grass, trees, ferns, flowers, stones, and
other dressing continue into the organic coastal lobes. The six old coast-duplicate layers are gone.
Do not add a special coast-only copy when a normal biome recipe can cover the surface.

`bladecarpet` is for broad overlapping fields of grass sprites, while `groundcover` and accent layers
carry smaller, sparser mesh dressing. Keep flowers, ferns, stones, and broad plants from inheriting
the grass field's density. Road and water-bank layers follow `getRoadPolylines()` and solved water
contours. The visual biome lobes use global authored and water exclusions, so landmarks and lakes stay
readable without bringing back a rectangular cutoff. Dry coastal ground participates in physics,
navigation and terrain picking. Ordinary oak and pine scatter also supplies harvestable forest
descriptors. Register gameplay footprints through `worldExclusions` and use a fade instead of a
hard settlement circle.

After a scatter change, inspect `getScatterStats()`: the expected layers must place instances, missing
assets must stay empty, and density increases must fit the available triangle and draw-call budget.

### Harvestable forest trees

Most ordinary visible trees within playable bounds should be harvestable. Keep distant trees in the
production scatter path; do not allocate a permanent semantic entity or animated rig for every
tree. Each accepted tree candidate has a stable ID derived before display aliases, mesh batching or
render submission, plus its resource species, final uniform scale, grounded position, yaw and measured
trunk radius. Never use a changing GPU slot index as its saved identity.

`ForestResources` activates nearby descriptors within 35 m and releases available, unpinned trees
beyond 50 m. Interaction targets remain pinned. Saved depleted trees retain their stump and suppress
the original scatter instance, including after a streamed tile is rebuilt. Returning to the area must
not grow a tree before its resource timer expires. Promotion/demotion must preserve the exact trunk
origin, scale, yaw, solid collision and detailed source geometry; only one tree representation is visible.

The resource definition supplies species-specific items, tier requirements and respawn timing. A
stable tree ID determines the base yield within that definition's range; final drawn scale adjusts it
with a factor clamped from 0.65 to 1.5. Saved `remaining` and `maxYields` take precedence when reactivated.
Changing the model or batching must not reroll an existing tree's contents.

Prove one real click through navigation, normal tool checks, inventory receipts and natural depletion
in `forest=1`. Save the depleted state, leave beyond the residency boundary, return and reload it, then
prove normal respawn at the same origin. State/bounds checks require stump and tree screenshots too.
Finally repeat representative interactions in the authored forest, including trunk avoidance and a
distant return. The compact fixture alone does not prove island placement or streaming performance.

For foliage cost changes, use the same production grid, graphics settings and camera before/after.
Read `getRenderProfile()` for actually submitted triangles and calls, then move away and return to
check that rendering did not lose instances. Keep the detailed geometry at every visible distance;
the owner rejected blocky far substitutes. Crown silhouette, branch structure, wind and shadows must
survive optimization. A lower count from a different camera is not a performance comparison.

Keep the 96 m generation grid and its seeded candidates stable. `FOLIAGE_RENDER_TILE_METRES`
partitions those same placements into 24 m tree groups and 12 m fern/shrub groups for rendering.
The environment foliage fixture uses the same `shardByTile()` path. Each group retains native
geometry and wind-expanded bounds, and Three evaluates camera and shadow frusta independently.
Harvest callbacks address a group's local instance slot; saved tree IDs never depend on that slot.
Smaller groups reduce off-screen submissions but increase draw calls. Measure both costs in the
dense fixture and the authored world before changing these sizes.

## Wind

Wind is shader movement, not authored animation. Use `MaterialLibrary.wind(source, strength)`, which
preserves the source shader hook and reuses the patched material. `MaterialLibrary.setTime()` advances
it. Target flexible material families such as grass, `Leaves`, `Leaves_NormalTree`, `Leaves_Pine`,
`Leaves_TwistedTree`, `Flowers`, and `MI_Vine`.

Keep roots and trunks fixed. Displacement should grow with vertex height and vary phase by world,
instance, or batch position. Flowers and grass can move more than a tree crown. Rocks, buildings,
mushrooms, dead wood, spent trees, and collision never move. If code clones or
replaces a material, apply `wind()` after that step.

## Seeds

The same world seed must produce the same terrain, contours, field weights, path curves, and scatter
layout.

- Derive seeds from stable region, layer, lake, or feature IDs. Scatter uses an independent stream
  from the world seed, region ID, and layer ID.
- Do not consume one shared random stream across layers. Adding a flower layer must not move every tree.
- Renaming an authored ID intentionally changes its generated result. Treat IDs as saved authoring
  inputs, not display copy.

## Preview and browser probes

Run the cheap SVG preview while tuning fields:

```bash
npm run world-preview
npm run world-preview -- runs/local-worldgen/my-preview.svg
```

The preview samples the exact runtime biome and coast math at each actual rendered x/z, including the
outside collar. The blended raster is the material that the scene sees; dark seams mark the winning
field. Each intent has a labeled centre marker, a dashed influence radius, and a smaller guaranteed
hold radius.
Corridors appear as translucent bands with a centre line and midpoint cap showing their half-width.
Dashed semantic rectangles stay visible as secondary ownership guides. The legend explains the marks,
and the CLI prints winner coverage plus each authored centre's winning weight and margin. It writes the
gitignored `runs/local-worldgen/worldgen-preview.svg` by default and refuses non-`.svg` targets. It is
a bounded field check, not proof that the Three.js scene is readable.

Authoring workflow:

1. Add a few small anchors at named places in the relevant biome field. Give important hubs an explicit
   `holdRadius` for an exact guaranteed core, then let the sampler feather to the influence `radius`.
2. Add only short, bounded corridors where a biome should connect two intents. Keep their half-width
   modest and let climate noise shape the edges.
3. Run `npm run world-preview`. Confirm every centre owns its field with a positive margin, transitions
   are broad enough to read as ecotones, and no border follows one semantic x or z axis for a long run.
4. Check the coast and lakes separately, then regenerate the in-game map and inspect the real browser
   scene. Coastal gameplay uses the existing semantic regions and organic visual biomes.

Never solve missing coverage by adding a broad rectangle-sized backstop. That turns the visual field
back into the semantic map and restores hard cutoffs.

Regenerate the actual in-game map when the shape is ready:

```bash
npm run world-map
```

This captures the real scene into the padded `game/public/generated/world-map.png` and `.json`, plus
`game/src/generated/worldMapFingerprint.ts`. Map metadata v4 records `playableBounds`, `imageBounds`,
and `imagePaddingMetres`; playable bounds enclose the coastal terrain and the padded image adds ocean beyond it.

Focused development probes are available on `window.__gameDebug`:

- `getScatterStats()` reports placed/rejected counts, clusters, tiles, per-layer/source counts, costs,
  and missing assets by region.
- `getWaterBodies()` reports solved contours and closure state.
- `groundHeight(x, z)` reads the surface used for placement.
- `sampleWorld(x, z)` returns the semantic region, visual winner, normalized `biomeWeights`, height,
  slope, water body, and coast facts. Dry coast reports playable ground and a slope. Ocean reports
  non-playable ground and a null slope.
- `getRoadPolylines()` returns the drawn, graded routes for traversal probes.

## Real-browser visual check

Open the Vite game in Chromium and inspect the view, not only source or the SVG.

- Look toward every reachable edge. The padded ocean should meet the render collar without a wall,
  exposed void, or ocean over playable ground. Check the padded map as well as the game view.
- Cross each semantic seam. Visual winners should form organic transitions, while `getState().regionId`
  changes at the authored rectangle boundary.
- Follow several paths. Their curves should be broad and deterministic, width drift restrained, and
  scatter/exclusions aligned to the drawn polyline.
- Check foliage close up and from normal play distance. Grass should read as dense connected fields with
  readable paths and doors; mixed cover and accents should stay restrained.
- Check every lake. Its rings should share lobes, water should be closed, and the bank should be dry
  enough to read without a circular mud halo.
- Watch grass, leaves, flowers, and vines for several seconds. Motion should be slight, rooted,
  and out of phase. Trunks and rigid props should stay still.

Capture a coast/map edge, a biome seam, a curved path, a foliage field, and a lake. Before accepting,
check `getErrors()`, `getScatterStats()`, `getWaterBodies()`, and a few `sampleWorld()` points on both
sides of each semantic seam.
