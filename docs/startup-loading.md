# Startup loading

## Released world data

The release includes generated terrain buffers and height samples, authored enemy spawn positions,
navigation and all 204 vegetation tiles. First-time players download that data. They do not run
terrain, vegetation placement, enemy spacing or navigation generation.

`npm run build` validates content, rebuilds stale navigation and world artifacts, checks their
integrity and island coverage, and then creates the production bundle. `npm run world:build` runs
the artifact step separately. An unchanged build reuses the existing artifacts. Direct Vite builds
also reject missing, stale or damaged release data. The final bundle explicitly restores
production mode after Vite's world-authoring server runs. A build guard rejects development-mode
release bundles, and the failure gate verifies that blocked world files cannot trigger generation. The four additional generator paths in
`.gitattributes` preserve the LF bytes recorded in the asset provenance manifest on Windows; this
fixes the previous content-validation failures without changing licenses or recorded hashes.

The files live in `game/public/generated/world/`. There are 206 data records and one manifest,
occupying about 53 MB compressed, excluding navigation. The starting view downloads about 30.2 MB
of world data: terrain, spawns and 29 vegetation tiles. Distant vegetation files are available for
travel without downloading the whole island at boot. The release gate limits total world data to
128 MiB; the browser check limits the starting view to 40 MiB. These figures exclude models,
textures, JavaScript and audio.

The container preserves typed-array bytes exactly and uses JSON for placement records. Gzip is
inside an opaque `.world` file so static hosts cannot decode it before the SHA-256 integrity check.
Vegetation input checks hash shared exclusions instead of duplicating that metadata in every tile.
Placement seeds, density and geometry remain unchanged.

A revision covers game sources, the asset manifest and dependency lockfile. The manifest also
identifies the world seed. Runtime checks verify terrain specifications, vegetation recipes,
exclusions and initial spawn inputs. Release failures stay behind the loading screen and do not
fall back to generating a replacement world on the player's device.

IndexedDB retains an optional local copy for later sessions. It contains no player progress,
health or resource depletion state. Browser eviction, cleared storage or disabled storage cause
another download of the shipped data. Transactions have a 1.5-second timeout and retain at most
256 records. GPU resources, materials, tree interaction callbacks and player saves still use the
normal creation and rehydration paths.

Navigation fingerprints the transformed float32 vertices consumed by Recast. Hashing intermediate
float64 matrices previously caused unnecessary rebuilds despite identical navigation vertices.
Actual changes still invalidate the artifact. Released gameplay requires an imported artifact;
runtime navigation baking remains available to authoring tools and labs.

## Authoring and the lab

Development can generate data when sources change. `?startup-cache=0` bypasses generated data in
the development game. Release gameplay always uses the shipped data. Labs normally generate their
fixtures and opt into browser storage with `startup-cache=1`.

Run `npx tsx tools/build-world.ts --lab`, then
`npx tsx tools/startup-cache-test.ts --lab --shipped`, to exercise the production writer,
container, download path and storage behavior in the terrain and mob-spacing fixture. Temporary
lab files are ignored under `game/public/generated/world-lab/`; remove those fixture files before
packaging a release. The authoring-only `world-bake=1` path stops before gameplay and exports
placements without allocating vegetation GPU meshes. It uses the normal generation code.

The shipped-data path passed the lab before integration into the full game. The full-world
exception applies to baking every island tile and checking authored placement and coast, which
cannot be represented by a compact fixture. Terrain, vegetation, tree-callback and spawn-state
equivalence also have focused tests.

## Complete starting view

The loading screen covers a complete starting view. Boot selects the saved player's region and
position, or the new-game spawn, and prepares the same resource and actor sets used by gameplay.
Vegetation covers the circular fog distance plus the normal camera offset and the distance the
player can move before residency updates. An idle first frame does not trigger a vegetation refill.

Surface textures, model requests, vegetation loading and shader preparation overlap. Outdoor
lights are installed before shader submission. Shader preparation includes resident objects that
can appear during a normal camera turn and skips hidden navigation meshes and the closed dungeon.
Repeated geometry and material inputs share compilation work. The final gate finishes hydration,
actor poses, effect programs and the first production render before exposing gameplay.

Boot no longer queues the unequipped gear catalogue or blanket transparent variants after reveal.
Equipment, travel and dungeon entry retain their preparation paths. Audio starts after reveal.
Placement queries use built ground instead of recomputing biome diagnostics. Conservative bounds
reject distant terrain pads and exclusions before expensive calculations.

## Player-specific assets

The saved position and realm select the initial working set. Surface region borders do not hide
nearby objects; the underground boundary does. Resource views use their interaction residency
radius, while structures and actors cover the fog distance, normal camera offset and movement
margin. Camera collision triangles load with those nearby structural models instead of fetching
every building source on the island.

All site placements and measured collision boxes still resolve globally from manifest metadata.
Their visible models load only when a setting's full footprint intersects the player's preparation
circle. A setting waits for every model before creating its instances. Large cliff extents count,
so an offscreen origin cannot hide an in-view rock face. Navigation and collision inputs retain the
same dimensions and placements, including encounter body clearances. Exact imported walk surfaces
and authored cut faces remain global dependencies.

The player rig resolves worn items and backpack contents through the same body, authored-item,
fishing-rod and gathering-tool mappings used for real equipment. Banked items and the rest of the
catalogue stay unloaded. Acquiring a different carried item starts a player-priority request;
changes in stack quantities do not repeat preparation. Failed requests can retry, and upgrading
a pending travel request never silently starts another attempt after a failure. A ready destination
can install camera sources without waiting for unrelated background downloads.

Each 8 metres of travel triggers a preparation circle extending 48 metres beyond the working set.
This loads approaching entities, camera sources, site decorations and shipped vegetation tiles.
Visited sources remain reusable. Standing still does not queue the rest of the island. Portal
transitions wait for the full destination circle, hydration, effect programs and a real destination
render before uncovering the view. Slow travel downloads can still outrun the prefetch margin;
this is not a claim of stall-free movement under arbitrary network conditions.

The reusable paths passed `npx tsx tools/smart-loading-lab-test.ts` before final-world integration.
The compact `?mode=combat&smartLoading=1` fixture exercises near/far/underground selection,
carried tools, complete setting creation, camera source deduplication and destination prefetch.
Its isolated overhead meshes are camera-query fixtures, not authored building compositions.
Captures use the interactive 11-metre zoom limit. The full-world check is
`npx tsx tools/smart-loading-world-test.ts`; it exercises keyboard travel, acquired versus banked
items and production portal entry and exit.

## Shared textures and shader preparation

The release packer extracts identical embedded PNG/JPEG bytes from copied GLBs into shared,
content-addressed texture files. It preserves geometry, materials, image pixels, skinning and
animation buffers. Source assets remain untouched. The existing runtime texture cache can then
share image decoding and GPU image storage across models while preserving each material's
sampler and UV settings. Unsupported GLB layouts are left intact.

Across 690 released models, 1,503 embedded images become 600 unique images, removing 298.3 MB
from the packaged model/texture payload. `game/dist/assets/texture-pack.json` records the build's
actual totals. `tools/forest-lab-test.ts --packed-textures` exercises this same release transform
with production trees, harvesting, depletion, persistence and regrowth.

Effect preparation submits only the objects used by the colour and glow passes. Non-glowing
transparent surfaces that write no depth or stencil do not enter the glow occlusion pass.
Successful program links are checked before uniform preparation, avoiding redundant driver-log
queries. Failed links still block readiness. Lava sampling rejects distant segment groups through
conservative bounds and preserves the original nearest-channel results exactly.

## Acceptance and remaining startup cost

Run `npx tsx tools/startup-cache-test.ts --production --resume` after `npm run build`.
This serves `game/dist` and starts with an empty Chromium profile, then closes and reopens the
browser for returning and saved-location checks. It requires zero runtime generation, imported
navigation, no pending or missing selected assets or site settings, identical terrain and spawn
data, enemy body clearance, keyboard movement and stable idle residency. It checks another
surface region and an underground save. Reports and normal-camera screenshots are ignored under
`test-results/startup-cache/release/`.

`npx tsx tools/release-world-failure-test.ts` blocks terrain, vegetation and navigation downloads
in fresh browser contexts. Each failure must remain covered with no playable milestone and no
runtime generation. Unit checks cover malformed downloads, revisions, deployment base paths,
unavailable storage, exact typed-array round trips and tree depletion after serialization.

On the local Windows RTX 5080 machine at 1440 by 900, the production bundle measured 17.9 to
18.9 seconds from an empty browser profile and 8.5 to 8.6 seconds returning. The previous
pre-generated release measured 20.9 to 21.6 seconds cold and 13.2 seconds returning; the earlier
development loader took about 32.4 seconds cold. These are local measurements, not cross-device
or network guarantees. A surface save measured 12.8 seconds and an underground save 11.5 seconds.

The starting view requests 173 of 690 manifest assets and 17 of 72 site settings. An underground
resume requests 32 assets, no surface settings and no vegetation tiles. Cold model/texture traffic
measured 130.6 MB, compared with 174.2 MB after texture deduplication alone and 226.9 MB before it.
The initial world-data download remains 30.2 MB. Terrain samples, vegetation counts and spawn
coordinates match the previous generated world exactly.

First-launch model construction, GPU uploads and shader compilation still take substantial time.
The first second after reveal also recorded frame gaps up to 150 ms at the starting settlement
and 183 ms at the surface save in these local runs.
The starting assets are complete, but these checks do not establish smooth 60 FPS immediately
after reveal. The first-second sampling excludes screenshot readback and large state serialization.

The production build, type checking and focused release/navigation/cache/renderer/streaming tests
pass. The broader suite previously identified eight unrelated content assertions across ash
creatures, audio, the cave fixture, encounter population, regional exclusions and habitats. They
reproduced with the original production sources and are separate from this loading change.
