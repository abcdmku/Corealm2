# Runtime distance and interior loading

This pass follows the startup work in [startup-performance.md](startup-performance.md).

## Native WebGPU migration

The production renderer now uses Three's WebGPU backend. Terrain, water, foliage, sampled
skeletal animation, equipment, architecture, spells, glow, refraction, grading, anti-aliasing
and occlusion use native node materials and passes. Imported materials are converted before
the game's surface treatments run. The separate inventory-art tool still uses WebGL.
Backend diagnostics identify a WebGL2 fallback explicitly; it cannot pass a native WebGPU check.

Native shader lowering assigns deterministic names to unnamed buffer bindings. Three r185
otherwise embeds global node IDs in shader source, causing equivalent instanced and skinned
materials to miss its program cache. Static scenery uses ordinary meshes with instanced
geometry and named matrix/color attributes. Three otherwise lowers a separate node graph
for each `InstancedMesh`, even when its final GPU shader matches another cluster. Named
attributes share the lowered graph while resolving each cluster's own buffers. Cluster
capacities, placements, culling, wind and shadows remain unchanged. Sampled actors retain
their native instance/palette path; explicit authored buffer capacities and names remain distinct.
The renderer counts shared geometry-buffer owners so unloading one scenery cluster releases
its own transforms without destroying vertex/index buffers still used by neighboring clusters.
Imported integer attributes are separated before WebGPU can promote shared
joint/color buffers, and sampled actors pack compatible vertex attributes to fit standard
device limits without removing shader inputs.

GPU preparation builds nodes and uploads data in small serial batches. Startup overlaps at
most four asynchronous native pipeline creations across those batches; gameplay keeps one.
Each pipeline owns its validation scope, and startup readiness waits for the entire pool.
Texture uploads await asynchronous queue completion, and pipeline failures prevent readiness.
The frame loop presents at most 60 times
per second and permits at most two outstanding GPU frames, dropping to one under pressure.
Input and UI updates continue while presentation waits. This leaves browser headroom and
prevents a growing queue of stale game frames.
Preparation yields through ordinary MessageChannel tasks, avoiding accumulated timer clamping.
Diagnostics include initial resident preparation as well as streaming and effects.
Native node lowering preserves Three's build sequence but yields after a measured two milliseconds
of work instead of after every empty shader stage. A recursive node operation is indivisible, so
this is a cooperative budget, not a hard maximum task duration.
Startup and covered effect preparation use batches of at most four objects. Streaming seeds
each new scenery layout alone, then prepares up to eight known-layout clusters together, capped
at 256 KiB of estimated new or changed buffer uploads. An indivisible larger object gets a
submission to itself. Textures still upload and fence individually. A temporary light index
avoids rescanning the full world for each batch while tracking changes and current visibility.
Instanced, skinned and batched objects retain separate preparation for their own buffers;
ordinary meshes can share preparation by geometry and material.
Native glow reuses the main frame's multisampled depth and stencil by temporarily replacing
its color attachment. Only registered emitters enter its preparation and draw submissions;
ordinary world geometry is no longer prepared and drawn again for glow occlusion. The fallback
retains its separate depth pass. Resizing and disposal preserve one owner for the native depth.
The streaming queue drains through ordinary tasks between frames, yielding to painting after
slow frames. It groups up to 32 jobs for bookkeeping; the count and byte limits above still
bound each native submission. Unknown scenery layouts prepare individually; other streamed
objects use at most four per batch within the same byte cap. Debug state also counts pending
scenery, instanced actors, skinned actors and ordinary objects separately.
During gameplay, completed inner batches release their readiness immediately, so a prepared actor does not wait
for unrelated objects later in the outer job. A new nearby live rig also avoids starting a second
sampled-animation representation while its first display prepares. Existing sampled actors stay
visible during detailed-rig handoffs.

Spell pools share material graphs by recipe while clocks resolve per draw and instance
attributes remain private. This removes repeated CPU graph construction for multiplayer
pools without reducing their capacities or skipping buffer and binding preparation. Visible
and refracting air currents share their pose attributes, with separate geometry ownership.
Completed glow preparation is reused only while its mesh, material, camera, scene and target
still match. Refraction prepares against its actual target. Both authored elemental PNGs
download during world warmup and finish decoding before spell preparation. Effects compile
against the final scene lighting, and every local and remote pool is ready before play.

Background assets use frame-pressure budgets, bounded downloads and buffered bytes. Foliage
pixel conversion and hashing now run in a worker, alongside the existing world-data, Meshopt
and local-simulation workers. Rendering, scene construction, some GLTF assembly and DOM work
still run on the main thread. This migration does not claim full OffscreenCanvas isolation
or a guarantee of zero driver stalls.

WebGPU compute dispatches, renderer ownership in an OffscreenCanvas worker, render bundles,
GPU-driven culling and MRT postprocessing consolidation are not implemented. The game already
uses TSL shaders, instancing, shared buffers and asynchronous native pipeline compilation.
WebGPU does not automatically distribute Three's scene traversal or command preparation across
CPU cores. The [WebGPU explainer](https://gpuweb.github.io/gpuweb/explainer/#multithreading)
still identifies sharing one GPUDevice across JavaScript threads as a future capability.
Moving the renderer to a worker would isolate its JavaScript from page input, but GPU work
would still share the browser's GPU process. Basic projectile light particles and Deluge foam
and spray now evaluate motion in vertex shaders, keeping their seeded attributes resident.
Stateful compute remains a possible extension for other effects; it does not remove startup
pipeline compilation or repeated node building.

The joined world's real spawn, nearby structures, creatures, NPCs, animations and required
graphics prepare before gameplay is revealed. Readiness includes a completed GPU frame.
Initial elapsed loading time remains a recorded metric, with the owner's approval for a
longer responsive loading screen. It cannot substitute for content completeness or input proof.

Use the existing production walking check with `--authored --desktop --channel chrome
--browser-probe --require-webgpu --menus --budget --presentation-budget`. It checks actual
drawn starting geometry, first movement, newly resident entities after travel, seven real
panels, GPU completion and a separate browser page. The two-client join check also accepts
`--channel chrome --require-webgpu` and rejects graphics preparation failures.

The September 22 native acceptance run used Chrome 152.0.7977.83 on Windows/D3D11,
1440 x 900 at DPR 1, the existing default 70% render scale, no CPU throttling, and
20 Mbps/80 ms emulation for asset downloads. Authoritative sockets used a local server;
these figures do not measure live-server or WAN latency.
The follow-up uses the same profile with four startup pipeline slots and shared spell graphs.
Cold disables the HTTP cache in a fresh browser; warm reloads a joined page in the same context.
These are individual local samples, not a cross-device average.

| Measurement | Prior native cold | Current cold | Prior native warm | Current warm |
| --- | ---: | ---: | ---: | ---: |
| Complete first playable view | 55.824 s | 33.578 s | 43.353 s | 22.965 s |
| First movement response | 75.2 ms | 109.5 ms | 122.9 ms | 135.3 ms |
| Walking GPU completion p95 | 29.9 ms | 31.2 ms | 28.6 ms | 29.7 ms |
| Walking GPU completion maximum | 58.6 ms | 58.5 ms | 53.1 ms | 53.7 ms |
| Seven-menu GPU completion maximum | 116.1 ms | 116.5 ms | 119.2 ms | 113.5 ms |
| Other browser page GPU maximum during loading | 229.1 ms | 258.9 ms | 237.5 ms | 275.0 ms |
| Other browser page GPU maximum during play | 108.5 ms | 108.1 ms | 118.6 ms | 104.5 ms |

Cold startup fell by 40% and warm startup by 47%. World graphics preparation fell from
about 21.8 seconds to 8.7 seconds; effect readiness fell from about 12.7 seconds to 5.2 seconds.
The current cold run's walking RAF p95/max were 22.9/41.6 ms and the warm run's were
20.7/48.0 ms. Completed walking presentation averaged 42.2 and 44.7 FPS respectively.
The other page's RAF maximum during loading was 247.5 ms cold and 252.0 ms warm. This
retains the measured gameplay responsiveness while shortening startup, but brief loading
hitches remain. It does not establish zero stalls or 60 FPS on every device.

Both current runs passed the starting building, creature, NPC and animation checks. Each
finished with 1,495 resident entity views, all 161 requested assets loaded, and zero missing
or failed models, pending animations, queued assets or pending graphics work. The prior
runs contained 1,496 resident views; the live population moves during the route. The current
checks add the existing `--idle-after-ms 3000` option after menus. Background preparation
had not fully drained at the 12-second post-travel settling deadline; it completed during
the subsequent menus and idle sample. That work is included in presentation measurements.
Full-world startup and travel use the authored-world exception because their residency and
loading depend on the actual island. Fire, water and wind also passed the production spell
lab with real damage, visible particles, unchanged pool capacities and inspected screenshots.
Runtime and graphics validation errors were zero. Build, typecheck and focused checks passed.
Disposable reports are under `test-results/walking-stream/startup-four-cold/` and
`test-results/walking-stream/startup-four-warm/`.

The existing first-cast check now lives at `tools/effects-readiness-test.ts`; its retired
deferral assertions have been replaced with the current before-play contract. In installed
Chrome against the production preview, all seven checks passed. Effects were ready before
the first playable frame, the immediate cast drew particles after 112 ms, its peak was 636
particles, and its maximum RAF interval was 110.4 ms. The later cast also drew particles.
The shader disk cache was disabled, no page errors occurred, and the screenshot was inspected.
This local saved-world check is unthrottled and is not a substitute for the authored-server
startup numbers above.

The preceding native migration's two-client lab check passed joining, movement, camera input and a cold equipment
change on native WebGPU. The remote player first appeared after 1.838 seconds with all ten
meshes complete and had no disappearance or partially drawn samples. The maximum observed
interval was 97.1 ms during joining and 73.9 ms during equipment changes. Runtime and graphics
validation errors were zero. This follow-up did not repeat that separate two-client sequence.
These local samples do not establish performance on every GPU or over the live server's network.

### Particle follow-up

Deluge foam and spray and basic spell flight and impact motes now evaluate their motion in
TSL vertex shaders. Seeded launch data stays on the GPU; each frame updates small uniforms.
The authored trajectories, colors, lifetimes and capacities remain intact. Live-particle
diagnostics count births, landings and fading without scanning the whole pool. Inactive
candidates collapse before rasterization and do not inflate the live count. CPU-authored
clouds cache linear colors and upload 40 bytes per live particle instead of 48.

The production spell lab was measured before and after in the same Chrome profile, with
eight seconds per spell, no CPU throttling and no simultaneous build or profiler. These are
individual source-server samples. CPU p95 measures the entire effect update. Attribute
writes count dynamic particle attributes, excluding uniforms and other GPU traffic.

| Spell | Effect CPU p95 before / after | Peak particle attribute writes before / after |
| --- | ---: | ---: |
| Deluge | 3.4 / 0.8 ms | 1,360,416 / 19,600 bytes |
| Starfall | 4.9 / 3.8 ms | 894,864 / 745,720 bytes |
| Skybreaker | 2.5 / 2.0 ms | 427,584 / 352,280 bytes |
| Kindle | 0.2 / 0.2 ms | 15,360 / 1,120 bytes |

Deluge CPU p95 fell 76% and peak particle attribute writes fell 98.6%. Its GPU completion
p95 stayed about the same, 7.8 / 7.9 ms. This is a CPU and transfer improvement, not evidence
of faster GPU execution across every spell. Starfall and Skybreaker still compute their
terrain-dependent particle positions on the CPU. No compute dispatch or GPU readback was added.

The four measured spells retained their hit and damage totals, with zero dropped particles
and zero runtime or graphics errors. Foam, spray and all four basic elemental trails passed
real-input lab checks and screenshot review at normal gameplay camera limits. Focused tests
also compare authored formulas and live counts at matched timestamps, including backward
time seeks and long-running session clocks. Disposable samples and screenshots are under
`test-results/particle-*`.

The final production build passed the same authored cold-join, walking, seven-menu and
separate-browser-page check. First-playable telemetry was 33.167 seconds, first movement
took 77.3 ms, and walking GPU completion p95/max were 33.4/61.8 ms. Menu completion peaked
at 141.6 ms. The other page's GPU completion maximum was 204.6 ms during loading and
139.6 ms during play. Starting buildings, creatures, NPCs and animations passed the drawn
content checks. The run ended with 1,496 resident views, all 161 requested assets loaded,
and zero missing models, pending animations, queued graphics work or errors. This keeps
cold startup near the preceding 33.578-second result; brief hitches remain.

The final production first-cast check passed all seven assertions. Effects were ready before
the first playable frame, particles appeared 174.7 ms after casting, and the maximum RAF
interval was 106.2 ms. The later cast also drew particles, with zero page errors. The inspected
world screenshot retains the authored spell trail and surrounding geometry. Reports are
`test-results/walking-stream/particle-cold/report.json` and
`test-results/effects-readiness/report-dist.json`. The warm-join and separate two-client
sequences were not repeated for this particle-only follow-up.

The measurements below this section describe earlier WebGL revisions, not the native renderer.

## Loading after multiplayer

The page's asset loader now enables Meshopt's shared worker pool. Its asynchronous decode API
previously ran the decoder in a main-thread promise continuation when no workers were enabled.
Released world records use a separate loading worker for integrity checks, decompression,
binary decoding, terrain validation and IndexedDB reads/writes. Decoded array buffers transfer
to the page without copying. Concurrent requests share decoding; malformed records, failed workers
and timed-out worker requests reject instead of leaving pending loads indefinitely. Generic record
shape checks and Three.js object construction still run on the page.

Replication and the frame loop now request the same map-filtered entity snapshot from the entity
store. Previously their separate filter functions produced different arrays of the same scenery,
invalidating the renderer's stable-snapshot shortcut and reindexing the island on each handoff.
Current unit coverage checks shared identity, movement, removals, realm filtering, transferred
buffers, cache validation, corruption, concurrent requests and worker failure.

Chromium/D3D11 at 1440 x 900, default graphics, empty browser caches and 2x CPU throttling measured
18.38 seconds to a joined playable world before the changes and 13.04 seconds after. Immediate
movement's 99th-percentile RAF interval fell from 216.7 to 150 ms; its maximum fell from 233.3 to
183.2 ms. These are single local samples, with CPU profiling and other builds present on the
machine. They establish neither a device-wide frame-rate guarantee nor the live server's latency.

The final unprofiled production walking gate used 20 Mbps, 80 ms latency and normal desktop CPU
speed. First playable was 26.83 seconds. Walking had a 16.8 ms 95th percentile, a 66.7 ms maximum
RAF interval and a 122.4 ms maximum GPU completion interval. No measured post-startup phase had
a RAF interval above 100 ms. All requested assets and animation/shader preparation finished.
The two-client production lab passed second-player arrival and a cold Cobalt Sword equipment
change while movement and camera input continued. Join RAF intervals peaked at 50 ms, with
GPU completion gaps below 50 ms. Screenshots retained complete actors and were inspected.

The reusable loaders were accepted in the presentation lab first. The authored walking check
uses the world-scale streaming exception because it crosses the real island's residency boundaries.
The production build, hardware gameplay smoke, content validation, typecheck and 60 focused
regressions passed. All 356 rebuilt world-record hashes and the navigation payload stayed unchanged.
Timing data and screenshots remain disposable under `test-results/`. Download time, first-use
graphics work and main-thread scene construction still limit startup; this does not claim zero stalls.

Integration with main's loot and trading changes passed typecheck, the production build, 83 focused
tests and hardware gameplay smoke. Join timing was variable: two unprofiled runs exceeded the
150 ms gate with maximum observed intervals of 187 and 197 ms. The diagnostic run passed at
71 ms, and the final unprofiled run passed at 63 ms with a 33.3 ms maximum RAF interval. All
four runs passed movement, replication, complete remote actors and equipment changes without
runtime errors. The passing repeats do not establish that the intermittent join spike is fixed.

## Earlier WebGL investigation: browser-wide stalls during joining

That patch's acceptance remained open. A cold authored-server join took 27.03 seconds with asset
requests limited to 20 Mbps and 80 ms latency, exceeding the existing 20-second startup budget.
A passing frame-rate sample is not sufficient to release this change.

The final cached-return authored-server check passed its existing gates at 9.59 seconds
to playable and 215 ms to initial authoritative movement. Expected nearby structures,
creatures and NPC geometry were present at readiness, and travel loaded new resident
entities. Its separate browser page still recorded a 643 ms GPU completion gap during
startup and 93 ms during play. Passing the one-second browser-hang detector does not
make that startup stall acceptable. The normal gameplay screenshot was inspected.

The final production build, typecheck, 28 focused regressions and two-client join lab
passed. These checks establish correctness of the partial patch; they do not override
the failed cold-start budget. This patch has not been pushed or deployed.

A separate 64 x 64 WebGL page originally reproduced a 3.37-second GPU completion gap during
joining. Chromium tracing placed 3.31 seconds inside raster flush. Installed Chrome also
reproduced a 2.52-second gap. Removing individual HUD filters did not reliably remove it.

The current patch waits for mounted HUD images and fonts, then crosses two animation frames
and a task before shader preparation. Shader submission uses groups of eight objects and yields
after four milliseconds of submission work. Compilation remains parallel; waiting for each small
group before submitting the next increased cold startup to 42 seconds and was rejected.
Deferred spell shader submission is also split into groups. Individual driver calls remain
uninterruptible, so these work slices do not guarantee zero stalls.

A world selected during startup now joins before final residency and graphics preparation.
The actual snapshot supplies its spawn and actors. Nearby assets, geometry and animations prepare
before the first gameplay frame. Travel prefetch and session audio wait until that view is ready.
The picker must not reopen over an already connected world. An unavailable configured world
must not report ready.

The walking check captures the first ready frame and asserts geometry for authored buildings,
worms and an NPC, no pending/missing/failed entity views, and no pending animations. It sends
movement before its idle sample, then verifies real travel and newly resident entities. Reused
models are allowed; a rising model-download count alone did not prove that travel loaded a world.

The authored-server candidate had all those starting objects present, first movement at 188 ms,
and a separate-page maximum of 363 ms during startup and 73 ms during play. These are local
measurements at 1440 x 900 in installed Chrome, not live-server acceptance. Cold startup still
fails the elapsed-time gate. The socket uses a local production host; only asset requests are
network-throttled. Legacy global CDP throttling delayed its 388 KB initial snapshot beyond the
five-second join timeout, although a direct socket received it in 52 ms. That failed run is not
used as evidence of a production server delay.

Reports and screenshots are disposable under `test-results/walking-stream/`. See
[the lab reference](lab-reference.md) for the combined content, input, elapsed-time and browser
stall checks. This patch has not been accepted as a complete loading-performance fix.

## Menu responsiveness

Menu handlers and Three.js frame submission share the browser's main thread. Local simulation
now runs in its own worker. Dynamic imports and promises defer work but do not make their continuations run on
another thread. `GameplayWork.run()` budgets job starts; it cannot interrupt a large job.
`GameplayWork.runSliced()` now accepts an iterator, checks a 2 ms budget between steps, and
continues after a painted frame. Each step still has to be small. This is a scheduling target,
not a hard upper bound on frame time or GPU work.

The full map and minimap now request straight-line observations, avoiding a navmesh query per
marker. Default observations retain path-distance semantics for agents and navigation. Map
readouts label straight-line distance explicitly; choosing a marker still uses the production
navigation command and reports its actual route. Live terrain maps share one cached preparation
job and yield every 64 samples. The map shows a loading state until the raster finishes. The
terrain sampling, colour calculation, resolution and road drawing are unchanged.

Cold-process Chromium tracing found a separate spellbook GPU raster stall: SVG glyph drawing and
per-tile filters stalled GPU completion without a JavaScript long task. The 36 authored spell
motifs now use a generated PNG atlas, shared by the book and action bar. The build rasterizes the
existing artwork at three times its logical size. Tile backgrounds retain the glow; lock symbols,
requirements and opacity retain the unavailable states without separate GPU filters.

First fairy travel exposed another cause. Four fairy lamps were allocated on arrival, and six
surface point lights plus four lava area lights disappeared when terrain became hidden. Changing
light counts changes Three's shader programs across lit materials. These pools now exist before
startup preparation and stay attached outside hidden terrain, with zero intensity when unused.
The destination also queues its original hidden meshes for shader and texture preparation before
reveal. Newly hydrated actors can wait behind the loading curtain; ordinary gameplay retains its
existing visible-actor policy. Scenery already prepared during streaming is not queued twice.
Grass texture generation also reuses row calculations, with a regression proving identical pixels.

Chromium/D3D11 at 1440 x 900 exercised the existing presentation and fairy labs, all seven dock/map
panels, cold network requests, an explored save and the authored Crownward-to-Gloamgarden portal.
World checks used default preferences: 70% rendering resolution, shadows off, automatic distance
at Near. These local samples are not a cross-device benchmark or a guarantee for other settings.
Measurements used base `a4aef81`, before rebasing onto the starter-gear changes in `62abcb5`.

| Sample | Worst RAF interval | Longest GPU completion gap |
| --- | ---: | ---: |
| Cold-process spellbook with raster atlas, presentation lab | 33.2 ms | 66.5 ms |
| Final seven-menu sequence in Gloamgarden | 116.7 ms | 127.1 ms |
| Final complete fairy/wilderness lab transition | 116.6 ms | 128.8 ms |
| Final complete authored-world fairy transition, including reveal | 283.3 ms | 300.0 ms |

The final menu sequence had no reported JavaScript long tasks, displayed all 36 glyphs and advanced
the simulation by 60 ticks. The world transition completed with the curtain removed, simulation
resumed, no pending shaders and no page errors. Earlier transition profiles contained 5.5-second
main-thread shader stalls. The revised map also passed lab state and screenshot checks. Clicking
Millfield Bank in the world changed navigation from no path to an 11-point path and moved the
player about 8 m. Spellbook selection and action-bar assignment were exercised through real input;
spellbook and destination screenshots were inspected.

First-use hitches remain. The combined lab's initial GPU completion timestamp was already 1.07
seconds old when measurement began. Its first completion therefore appeared to create a 1.10-second
gap, mostly before the action. The table includes only completion gaps beginning inside each timed
window; setup delays are not attributed to the portal click. RAF timing alone is insufficient
evidence of smooth presentation. Shader compilation and texture upload still share the GPU with drawing.
CPU-profiler startup and screenshots stay outside measured windows because they introduce their
own gaps. World-scale travel uses the authored-world exception because its residency and lighting
changes depend on the real region layout; reusable UI, light pools and hidden mesh preparation
also have lab and focused unit coverage.

Focused scheduler, observation, map, icon, grass, lighting, shader and travel regressions passed,
along with typechecking and the production build. Generated navigation payload and world tile
hashes remain unchanged; their source revision metadata was refreshed. Disposable traces, shader sources, frame samples and screenshots remain
under `test-results/menu-performance/`; temporary browser instrumentation is absent from production.

For further isolation, move expensive serializable computations such as generation into workers,
and keep DOM construction in bounded main-thread batches. Making game rendering independent of
DOM stalls requires a larger renderer/simulation split using a worker and `OffscreenCanvas`.
Workers cannot directly manipulate the DOM, and moving work to them does not remove GPU upload
or shader stalls. See [Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)
and [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas).

## Behavior

- Surface scenery is generated in the existing deterministic 96 m tiles, within the current fog range plus camera and 48 m travel margins. Moving requests nearby tiles; changing distance immediately changes the request radius. Entering the cave stops new surface work after the current tile finishes.
- Visited scenery stays cached. This reduces work while exploring a small part of the island, but does not put a hard ceiling on memory after visiting the whole island. Map capture retains its explicit full-residency path.
- Creature, boss, and NPC views now extend to the visible distance plus camera/movement margin. Gathering resources retain their separate 64 m active radius. Existing sampled skeletal animation and the full-rig budget remain in use.
- Scenery culling now retains the selected distance when player synchronization runs; previously that call reinstated a fixed radius.
- The cave's structural shell remains available to navigation at startup. Its scanned rock asset, detailed facing geometry, and camera acceleration data load on first entry. The portal waits before placing the player inside; the result is cached for later visits. A save starting inside the cave loads its detail before readiness. Recovery imports preserve the original save if the cave load fails.
- Decorative rock facing is excluded from navigation inputs. The structural shell supplies navigation boundaries both before and after loading. The shipped navigation artifact has been rebuilt.

Auto is the default for new preferences. It changes only draw distance between Near, Medium, and Far; resolution and shadows stay under the player's control. Existing stored distance choices remain manual. Select **Auto** in Settings to opt in on an existing device.

The controller uses frame intervals, a startup grace period, three-second measurement windows, and hysteresis. Two slow windows can lower distance; upgrades require five fast windows. A downgrade delays another upgrade for two minutes. Paused, hidden, and cave sessions are excluded, and isolated loading stalls do not directly determine quality. This is a distance adjustment, not a guarantee of a particular frame rate when other work dominates.

## Measurements

Cold Chromium/D3D11, 1440 × 900, Far, full resolution, high shadows, same spawn, Auto disabled. Each frame sample covers the first 12 seconds after readiness. These are single local measurements, not a cross-device benchmark.

| Measurement | Before this pass | After |
| --- | ---: | ---: |
| First playable | 21.29 s | 13.30 s |
| Median frame interval | 16.7 ms | 16.7 ms |
| 95th percentile frame interval | 16.8 ms | 33.4 ms |
| Snapshot JS heap estimate | 2,356 MB | 2,089 MB |
| Snapshot rendered triangles | 12.28 million | 15.75 million |

The startup improvement is about 38%. Far now draws creatures that previously disappeared beyond 64 m, so it submits more geometry and the initial sampling window contains more actor hydration work. The figures do not support claiming a universal FPS improvement at fixed Far. Auto and manual distance settings provide the lower rendering workload; scoped streaming avoids filling the rest of the island in the background.

A follow-up at Near, with the same resolution, shadows, and spawn, submitted 10.03 million triangles and 596 draw calls versus Far's 15.75 million and 791: about 36% fewer triangles and 25% fewer calls. The frame snapshot reported 60 FPS, and the JS heap estimate was 1,373 MB. Only 17 of 144 scenery tiles had been generated after the sampling window. This compares the new distance presets, not old and new rendering at equivalent visibility.

## Acceptance

The production lab at `/?mode=combat&performance=1&cave=1&caveSource=1` exercised deferred loading and creature residency before game integration. A cow about 150 m away remained rendered on Far and left the resident render set on Near. Cave and settings screenshots were inspected. The actual Auto control reduced Far to Medium under an injected sustained frame workload, preserving full resolution and high shadows. Unit coverage compares eager and deferred geometry byte for byte, verifies one shared load across concurrent requests, retries after failure, and verifies stable navigation inputs.

Full-world scatter and navigation used the authored-world exception in [feature-lab.md](feature-lab.md): their behavior depends on the island's spatial layout. Tile selection and repeat-visit determinism also have focused unit coverage. Chromium acceptance covers the real cave portal, an inside-cave saved reload, and the return portal. Network capture verifies no scanned rock request during a surface start.

Disposable measurements, logs, and screenshots are under `test-results/runtime/`. The focused tests cover adaptive distance, settings migration, actor/resource residency separation, nearby chunk generation, and deferred cave geometry. `npm run check` passed: 257 test files, 1,961 tests passed and one skipped, typecheck, production build, and documentation build. The combined lab passed in 49.49 seconds; the hardware gameplay smoke passed without console, page, or request errors. An additional browser test aborted the cave download during an imported save: authoritative state stayed on the surface, the loading curtain closed, and a retry resolved only after complete cave replacement. Fresh read-only review found a recovery timing issue, which was fixed and re-reviewed before acceptance.

## Movement stutter follow-up

The movement trace found a 4.68-second frame blocked in shader first-use work during the water transmission pass. Small farm troughs could trigger a second render of the visible world. Background scenery generation also performed long uninterrupted placement and mesh-building stretches.

- Scenery placement yields every 64 candidates and between mesh shards. Background streaming uses a 3 ms work slice before yielding to the next animation frame; initial spawn loading keeps its separate scheduler. The slice is a scheduling target, since individual operations cannot be interrupted.
- Newly attached meshes prepare screen, linear refraction, and directional shadow shader variants before becoming drawable. Preparation preserves custom material hooks, checks every submitted program rather than only a shared material's last variant, and spreads first-use reflection over frames. Removal, reattachment, material disposal, and renderer cache replacement have regression coverage. Material clones retain compiled programs while their source materials remain alive.
- Native trough water uses the user's approved reflective material. It retains ripple geometry, normal maps, and highlights, but no longer shows the bottom through refraction or triggers a transmission pass. The material library caches the replacement and leaves the authored source unchanged. Other materials and water assets retain their existing treatment.
- The renderer skips the covered background cube while the opaque procedural sky is active, restoring scene background state after drawing. Environment lighting stays intact. Initial dungeon visibility now matches the player's region before shader warmup.

The production lab exposes `__renderDistanceLab.addRefractionFixture(useBiomeSky, reflective)` at `/?mode=combat&performance=1`. The reflective fixture used the same material-library path before game integration. Its screenshot was inspected: water retains its ripple normals and highlights, and its transmission candidate list is empty. The original refractive fixture also passed with the procedural sky enabled. World-scale streaming used the authored-world exception because the workload depends on island tile boundaries and placements.

Chromium/D3D11 at 1440 x 900, Far, full resolution, high shadows, Auto off. After a 12-second settling period, each run held A, S, and D for eight seconds each. CPU sampling was enabled in both runs. These are matching input sequences, not identical paths: long stalls consume wall-clock input time while the simulation clamps elapsed time, so the improved run travels farther. Actor residency still reaches 233 m, and the final resident set reports no pending, missing, or failed views.

| Movement sample | Before | Reflective water and streaming fixes |
| --- | ---: | ---: |
| Median frame interval | 33.2 ms | 16.7 ms |
| 95th percentile | 33.4 ms | 33.3 ms |
| 99th percentile | 83.3 ms | 33.4 ms |
| Worst frame | 4,683.1 ms | 83.3 ms |
| Frames over 100 ms | 3 | 0 |

This is a local movement sample, not a frame-rate guarantee across devices or the entire island. Smaller hitches remain possible during first-time asset preparation. Intermediate runs that retained trough refraction still showed roughly one-second GPU pauses; the reflective material removed that pass from the tested route. Temporary shader interception used to identify those draws was removed from production code. Logs, profiles, and comparison screenshots remain disposable under `test-results/runtime/`.

A second independent movement run had the same 16.7 ms median and 33.4 ms 99th percentile, with one 199.9 ms outlier. Both improved runs retained Far actor residency, and the second finished with zero pending shader meshes and zero transmissive candidates. The repeat result is included to avoid treating the first run's 83.3 ms maximum as a guarantee.

## Nearby creature visibility

Approaching a creature could replace its distant sampled model with a live rig, free the old slot immediately, and then hide the new rig in the shader queue. The production cow lab reproduced five consecutive frames with one resident body mesh but zero actual draw callbacks. Entity-tagged meshes now remain drawable while shaders prepare, closing that gap. A cold actor shader can still cost first-use work; visibility takes priority over hiding a nearby gameplay target.

Live skinned rigs also inherited cached, single-pose bounding spheres. Those spheres are unsafe for later animation poses and can reject an actor as the camera rotates. The bounded nearby rig pool now bypasses skinned-mesh frustum rejection. Distant sampled rigs retain their conservative animation bounds and normal culling; the distance/residency budgets still apply.

The opt-in production lab probe `__renderDistanceLab.watchCreatureVisibility(entityId)` counts real draw callbacks across rig replacement. After the change, every observed replacement frame drew the cow immediately, and all 12 yaw angles drew its body. The screenshot was inspected. Focused regressions cover a deliberately stale skinned sphere, return to sampled animation at distance, and actor visibility during pending shader preparation.

The final movement run with the creature fixes retained a 16.7 ms median, 33.4 ms 95th percentile, and 50 ms 99th percentile. Its maximum was 233.3 ms, with two frames over 100 ms. Trough transmission candidates remained zero and actor residency still reached 233 m with no pending, missing, or failed views. Nearby rigs remaining drawable adds bounded work and avoids trading visibility for smoothness.

Final acceptance: typecheck, production build, documentation build, targeted visibility tests, the combined lab in 53.21 seconds, and hardware gameplay smoke passed. The smoke had no console, page, or request errors. Navigation artifacts were rebuilt for the final source and current creature content.

The shared branch received `4cf6a3a` while this work was underway, adding starter creatures and larger wasp assets. Consequently, the full-world before/after samples also span that content change, rather than isolating one optimization in an otherwise identical build. The final full suite reported six failures. Four were timeouts and passed on an isolated rerun with two workers. Two content checks still fail on the newer content: the audio catalogue expects 53 unvoiced families but finds 60, and the far-south Palewood pack overlaps two new habitat reservations. Those unrelated content files were left intact; the full suite is not claimed clean. The earlier performance-only suite passed before the newer content was fully reflected in the test run.
