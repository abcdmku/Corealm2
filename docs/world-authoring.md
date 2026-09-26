# World authoring

This is the short path for changing terrain, biomes, water, coast, paths, foliage, and wind without
creating a second world system.

## Relationship to the feature lab

This workflow owns proof of the authored full world: terrain and coast shape, biome fields, water placement, world-scale scatter and paths, final wind composition, world layout, and island-scale navigation. Those concerns may use a recorded exception to the lab-first gate because isolating them would remove the behavior under test.

Keep the exception narrow. Build reusable structures, foliage assets, materials, wind response, effects, UI, controls, and local interactions in the production-backed feature lab first. The root accepts that lab proof before the world-authoring step places or composes the feature in the final world. If a task mixes reusable feature work with world generation, split those into lab and integration phases.

## Authority and ownership

- `game/src/contracts.ts` is frozen shared state. Stop and report if a task needs a contract change;
  the root changes the contract and all callers together.
- `game/content/data/worldRegions.json`, `encounters.json`, `placements.json`, and
  `resourcePlacements.json` own authored world geometry and populations. The shared compiler publishes
  their resolved catalog; `game/src/content/regions.ts` exposes that catalog to gameplay.
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

The northern Wilderness also uses a bounded latitude trend in that same warped domain. This
establishes the requested night region across the top of the island without a rectangular visual
mask. It competes with the existing climate and local intents before normalization; every visual
consumer receives the resulting weights. See [the Wilderness acceptance notes](./wilderness.md).

The field may cross a semantic rectangle, but never moves a location or changes gameplay ownership.
The analytic `heightAtXZ()` field initializes the terrain lattice. Road grading updates that shared
lattice before meshes are built. `meshHeightAt()` then supplies terrain placement and physics from
the graded core or coastal grid. Never add a separate render-only height sampler or write biome
weights into content or saved state.

Biome fields own their outer terrain through `boundary`. Ordinary fields meet the sea;
Crownward rises into an eastern mountain range starting beyond its authored eastern sites.
The boundary sampler blends these profiles with the same normalized biome weights used for
relief and materials. It applies the result before authored flats, basins and road grading.
Crownward retains its southern shore and blends into the northern Wilderness. Pearlwater ends
in a closed foothill pool beyond its eastern bridge; the old ocean outlet no longer carves the
mountain range. Fisheries keep their authored resource-placement centres when the river changes length.

The shore contour uses deterministic periodic noise around the world bounds. Its range is
18-190 m, within a 210 m terrain collar. The collar grid is a mesh and storage partition only:
it samples the same analytic biome terrain as the core, with shared graded vertices at the seam.
Dry triangles feed navigation; terrain height, water and slope determine where actors can stand.
Do not add a second terrain height policy or an ocean gameplay region.

Population comes from the authored region catalog and the ordinary placement rules. There is
no supplemental coastal encounter generator or coast-specific habitat containment exception.

This boundary change uses the full-world exception to lab-first acceptance: isolating the coast
would remove its relationship to biome weights, authored water, region ownership and navigation.

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

Crownward's connected freshwater uses `RiverChannel.lake` for Crownmere's indented outline.
`sampleRiverChannel()` applies the existing organic shape math to both the terrain carve and clipped
water mesh. `riverWaterBodies()` publishes that lake as a closed, angularly sampled contour for
navigation and shoreline plants. The descending river keeps its short elevation-aware navigation
masks; those masks must not become separate circular shores for scatter. Keep bridge crossing
stations fixed when changing river bends.

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

## Server world pack

The game server does not build terrain or read GLB files. It boots the authored world from one baked
file, `game/public/generated/server-world.pack`, and the packaged server embeds the same file. Boot
from the pack takes about 4 s. Building the same world from source took about 39 s.

### What the pack holds

One binary file: a 48-byte prefix (magic `CRLMWPCK`, format version, header length, SHA-256 of the
rest), a JSON header (generation revision, seeds, and the name, type, offset and size of every
section), then the sections. Number sections are read in place as typed arrays.

| Section | Type | Contents |
| --- | --- | --- |
| `world` | JSON | Size, base and ground offset of every asset in `assets/manifest.json` |
| `seed/<n>/terrain/<map>/lattice` | f32 | The 2 m height lattice of the main and fairy maps |
| `seed/<n>/terrain/main/coast` | f32 | The coastal height grid outside the playable core |
| `seed/<n>/world` | JSON | Terrain bounds, region rects, water bodies, road lines, dressing and cut-face solids, structure boxes, tree names, navmesh facts |
| `seed/<n>/trees` | f64 | Position, scale, rotation and trunk radius of every scattered tree |
| `seed/<n>/navmesh` | u8 | The exported Detour navmesh |

`TerrainSampler` in `game/src/world/terrainSampler.ts` answers height, slope, region, water and
playable queries from the lattice. It calls the same grid read as `WorldScene`, so server movement
and client prediction walk one surface. `tests/world-pack-parity.test.ts` compares 24,000 points for
exact equality, and compares entities, habitats, door barriers, paths, solids and a moved spawn group
between a world built from source and a world booted from the pack.

### What stays live

The pack holds geometry only. At every boot, `game/src/multiplayer/worldAssembly.ts` builds the
entities, their solids, the route graph, the habitats and the creature placement from the catalog in
the server's database and the world's seed, against the pack's terrain, solids and navmesh. It also
clears trees out of each creature's spawn and idle routes at boot, so tree clearances follow the
live catalog. A spawn publish runs the same planner over the same pack data.

### What follows the bake

These parts are frozen until the pack is baked again:

- The navmesh. It is carved around the solid things of the catalog at bake time. If a published
  catalog moves a building, an ore node or another solid thing, the entity and its collision move at
  the next restart, but the hole in the navmesh stays where it was.
- Site dressing, mine cut-face and fairy dressing solids, and the boxes around walkable structures.
- The tree scatter. Boot only removes trees from it.
- Asset measurements. An asset added to the asset host after the bake has no size on the server.

These parts stay as they were until the server restarts: trees cleared for a spawn group that a
publish moved or added. A publish never places a creature inside a trunk, but it does not remove
trees either.

### Seeds

The seed changes geometry. It bends every road, and roads are graded into the height lattice, so the
ground differs between seeds. It also moves ore nodes and creatures, and the solids,
navmesh and trees follow them. Between seeds 1337 and 42 the height lattices differ, 20 ore nodes
move, and the navmesh has 14,661 and 14,775 polygons. A pack is therefore valid only for the seeds
it was baked for. The shipped pack holds seed 1337, which is also the only seed the client's world
data is baked for. A server configured with another seed refuses to start that world and names the
seeds the pack holds. To add one, bake with `--seeds`. Each seed adds about 10 MB.

### Rebuild and staleness

`npm run world:build` bakes the pack last, after the navmesh and the world records. The pack bake
runs in Node alone and takes about 40 s. To bake only the pack:

```bash
npx tsx tools/build-server-world-pack.ts                  # seed 1337
npx tsx tools/build-server-world-pack.ts --seeds 1337,42  # more seeds
npx tsx tools/build-server-world-pack.ts --check          # is the pack current?
```

The pack is tracked in git, like the navmesh and the world records. Its header carries the same
generation revision as `generated/world/manifest.json`, so any edit under `game/src`,
`game/content/data`, the asset manifest or the lockfile makes it stale.
`tests/world-release-artifact.test.ts` fails on a stale, damaged or missing pack. The bake is
deterministic: the same sources give the same bytes.

The code that builds the world from source lives in `game/src/multiplayer/bake/` and loads three
and gltf-transform. `tests/server-import-graph.test.ts` resolves the server's module graph with
esbuild and fails if it reaches that folder, three, gltf-transform, the scene, the scatter or the
asset loader.

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

- Look toward every reachable edge. The ocean should meet shore biomes without an exposed void or water over dry ground.
  Crownward's eastern boundary should rise into mountains, with continuous terrain at the core seam. Check the padded map as well as the game view.
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

### Terrain contact and relief

Crownward river water is clipped against `meshHeightAt()`, with a narrow shoreline fade and
an opaque interior. Its authored footprint alone is insufficient: a coarse terrain triangle
can cross that footprint below the water plane and expose a hanging edge. Keep the short
dry bank crest and terrain intersection together when changing the channel carve.

Fisheries on existing lakes or rivers set `waterBodyId` on both their site and resource
cluster. These clusters must not create another basin, water stamp or water mesh. A river
prefix selects the nearest local water segment; schools and dry casting positions are
resolved by the same production fishing access solver as standalone ponds.

Terrain chunks partition whole lattice cells, with a smaller final row or column when
world dimensions do not divide by the requested chunk size. Keep their quad diagonals
aligned with the triangle interpolation used by `meshHeightAt()`, including the coast.
Bilinear interpolation agrees at vertices but floats above or sinks below folded quads.
`tests/terrain-contact.test.ts` compares real mesh ray hits with placement heights.

Mountain terrain belongs to the biome field and forms an irregular arrangement of reusable,
authored ridge-graph massifs. `game/src/world/mountainShapes.ts` supplies one shape sampler to
both the GLB lab assets and the authoritative terrain lattice. Its 128-cell field forms
connected descending ridges, irregular shoulders, snow bowls and a broad foothill apron.
The jagged crest, broad split massif and eroded shoulder have separate authored ridge graphs.
Arrange them as unequal peak groups with depth offsets and a broad pass, rather than repeating
one mountain at even intervals along the boundary.
Keep distinct peaks and saddles readable in normal-camera views, without stretching narrow
footprints into steep cones. The shared alpine shader blends rock, grass and snow continuously;
reusable assets carry native elevation and slope in their second UV channel so these bands
survive instance batching and gallery scaling.
Real foothills use the same fog and residency distance as other geometry. Do not extend biome
fog beyond the residency distance: buildings would disappear before haze could hide them.
The distant alpine skyline uses `corealm-distant-range.png`, a generated transparent panorama
anchored beyond the playable eastern boundary by `CROWNWARD_DISTANT_RANGE`. The sky shader
intersects camera rays with that finite world plane, preserving parallax and foreground occlusion.
It blends the foot of the range into horizon haze, tints it at night, and suppresses it underground.
The panorama is rendered once into a small colour target. World materials sample that target
in their final fog band, so fully fogged terrain does not leave an opaque horizontal cut across
the range. Nearby geometry retains its ordinary depth occlusion. This requires no depth-buffer
copy or extra geometry pass. The blend is disabled without the backdrop, underground, and during
fog-free map capture.
The distant summits remain scenery; the real 48–95 m foothills naturally cover them on approach.
Do not crossfade an unrelated painted summit into a differently shaped walkable mesh.
Castle foundations retain a level rectangular core, with irregular rocky shoulders outside it.
The shoulder shares the authoritative terrain lattice and road grading; it is not a decorative
mesh hiding different collision. Castle hill composition uses the authored-world exception above.
White Castle and its gate approach use a 10 m foundation with an explicit excavation allowance,
so the adjacent low village does not force a tall, abrupt embankment beneath the walls.
Use the generated `corealm-alpine-rock.png` texture and its provenance sidecar for alpine rock.
Blend unequal texture scales and orientations over broad patches to break visible repeats; apply
snow at high elevations on upward-facing surfaces, with exposed cliffs reading as rock.

Accept reusable massif meshes and their material in the feature lab first, using staged
candidates and `__environmentLab.showGallery`. Final-world placement is an authored-world
exception to lab-first acceptance; prove its silhouette and terrain continuity with normal
gameplay camera views. Do not replace the range with a smooth ramp or extend a plateau into
unrelated climate pockets.
The existing gallery's `mountainBackdrop: true` option exercises the production sky behind a
foreground asset. Combine `environment=1&atmosphere=1` to check daylight, night and underground
suppression. The foothill composition uses the full-world exception because its relationship to
the castle, valley and distant range cannot be judged in the flat yard.

Highland terraces retain their authored core and taper into rocky foothills beyond that
extent. Regions with no authored terrace axis use rolling relief. Do not extend the final
plateau height indefinitely into small climate pockets: that created isolated 70 m peaks
along the southern coast. The two former southwest coastal anchors were removed; the
shared climate field still decides biome coverage there.
