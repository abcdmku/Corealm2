# Runtime distance and interior loading

This pass follows the startup work in [startup-performance.md](startup-performance.md).

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

## Browser-wide stalls during joining

Acceptance remains open. A cold authored-server join still took 27.03 seconds with asset
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
