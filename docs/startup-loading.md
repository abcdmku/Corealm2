# Startup loading

## Desktop and mobile delivery

The release packer produces WebP texture maps capped at 1024 pixels for desktop and 512 pixels for coarse-pointer browsers. Both use gzip-wrapped Meshopt GLBs and a bounded queue of 16 overlapping asset loads during startup, reduced to four during gameplay. Source art stays unchanged. The smaller textures retain authored colour and alpha layers, material channels and UVs. Development manifests without delivery variants continue to use the original files.

Models retain their triangles, skeletons, skin weights, clip names and timing. Positions, normals, UVs, colours and animation outputs use bounded float precision before compression. Navigation-sensitive altar, stump and bridge models use exact geometry. Tests compare decoded accessors, triangle indices, rigs, animation timing and image bytes.

`tools/lib/compact-assets.ts` builds the variants after embedded texture deduplication. Content-hashed files under `.cache/compact-assets-v1/` shorten repeat builds and are disposable. The dist asset manifest names delivery variants; the public source manifest remains unchanged.

The phone Near setting has a 40-metre opaque fog distance and a 65-metre far clip. Preparation adds the normal camera offset and movement margin. This trades distant visibility for a smaller first download; approaching scenery streams through the normal travel path. Desktop Near and other distance settings keep their existing distances.

## Released world data

`npm run build` validates content, rebuilds stale navigation and world data, checks integrity and island coverage, and creates the production bundle. Direct Vite builds reject missing or stale source records. Released gameplay cannot fall back to world or navigation generation after a failed download.

The source bake contains 336 scatter tiles, two terrain records, semantic assembly, fairy dressing, spawn placement and 15 mine-cut records. These 356 records occupy about 132.3 MB compressed, below the 128 MiB release limit. They cover the whole world, not the first download.

The release transform separates terrain and coast draw geometry into spatial records. Global height grids remain available for placement and physics. Near-area preparation loads exact terrain triangles and corresponding dry coastal picking triangles. Mine collision metadata stays global; its detailed rock face loads near the player. This removes distant terrain and roughly 22 MB of mine faces from first load. Before nearby draw records, world terrain falls from 15.3 MB to 1.9 MB and fairy terrain from 9.9 MB to 1.4 MB.

The binary container preserves typed-array bytes exactly. Byte-plane deltas improve gzip compression without rounding terrain values. The opaque `.world` suffix prevents static hosts from decoding gzip before SHA-256 verification. Revision, byte length, hash and input checks run before acceptance. A revision covers game sources, asset metadata and the lockfile.

IndexedDB keeps an optional disposable copy, without player progress or depletion state. Eviction or unavailable storage causes another download. Transactions have a 1.5-second timeout and retain at most 256 records.

The build validates navigation against authored sources and embeds its expected fingerprint. Release startup imports that artifact without reconstructing distant navigation meshes merely to fingerprint them again. Import still checks integrity, seed and fingerprint. A gzip `.nav` wrapper reduces transfer to about 1.4 MB. Authoring and labs retain runtime generation and the original `.bin` artifact.

## Choosing where to play

The loading screen always shows the picker. `Play local` leads the list, then each server's worlds with live population, then the field for adding a server by address. A page with no server behind it still shows it, because playing alone is a choice rather than the absence of one.

Focus starts on the row this browser played last, which `localStorage["corealm.play.v1"]` remembers as `local` or `<providerId>/<worldId>`. Enter on the focused row plays it. A remembered choice only moves focus and ticks a radio; nothing joins a world without the player saying so, or without `?play=`.

`?play=` skips the picker. `?play=local` starts the single-player game and never mounts the panel. `?play=<providerId>/<worldId>` joins that world as soon as the first frame is drawn. Anything else — a malformed value, a world that did not answer discovery, a world that is full or incompatible — falls back to the picker with the reason on its status line. `GameDriver.open` in `tools/lib/driver.ts` adds `play=local` to every route that does not already name a target, which is what keeps the browser harnesses running unattended. A lab URL (`?mode=combat`, `?mode=building`) implies local play on its own: `bootProfile.ts` resolves those to the feature-lab profile, and boot never builds a picker for it.

With `?local=worker`, boot adds one step before the save is read: the `boot.localWorker.prepare` span fetches `generated/local-world.json` and settles the local seed, about 25 to 100 ms against the dev server. The old save is then neither loaded nor written by this thread, the simulation never ticks here, and "Play local" joins the worker's world once the first frame is drawn. The worker starts as soon as local play is the known target, so its cold start (about 4.6 s for the shipped world, nearly all of it building the world and its first entity baseline) overlaps the scene's load instead of following it. If the manifest cannot be fetched the page logs why and plays the old way. See [local play in a worker](./architecture.md#local-play-in-a-worker).

## Asset host and preloading

The asset base is settled at the top of boot and never again, because `app/config.ts` locks its answer as soon as the first URL is built. There are two answers: this page's own deployment directory, or the host a previous boot wrote down on its way to a world that names a different one.

Preloading therefore runs behind the picker rather than after it. The manifest, animation libraries, the shipped world records around the spawn and the models they name all start from the page's own base while the player is still choosing; the `boot.preload.behindPicker` span measures that work, and `boot.picker.shown` and `boot.picker.chosen` mark the two ends of the wait.

A world that names a different asset host cannot be joined by re-pointing a live `AssetRegistry` — the session would hold half its models from each origin. The choice is written to `sessionStorage["corealm.play.pending.v1"]` and the page reloads. The second boot sets the base from that record before the first fetch and joins the world without asking again. Exactly one reload is spent on it: if the host is still foreign afterwards, the page pinned its own base through `window.__COREALM_ASSET_BASE__` and the join is refused instead of looping. `test-results/m7-1/picker-preload-proof.ts` measures both halves — assets requested before the choice, then zero public files from the client origin after the reload.

## Complete starting view

The HTML loading screen appears before the engine bundle arrives. It shows the stage, a stage progress bar, elapsed time and completed download bytes. It does not invent a percentage or estimated remaining size.

World data starts downloading as soon as the saved starting position is known. Shared surfaces, animation libraries and navigation download alongside it. Requested shared surface maps receive image preload hints with high fetch priority. Desktop traces showed three small fairy-rock maps waiting about 16 seconds behind model requests; these maps block terrain restoration. The hints match Three's anonymous CORS mode and disappear when the request finishes. Boot code modules and the tiny shared grass source are requested before model traffic can queue them behind large files. Player construction and carried-item preparation overlap world restoration. Nearby model and scatter requests use the normal asset queue. Spatial hints come from baked placements; normal residency selection still decides what must be ready.

Character outfit parts download together, then commit as a complete outfit; a failed part preserves the previous outfit and can be retried. Habitat tree clearance and saved altar restoration group related entities once instead of scanning the entire entity list for each habitat or altar.

Cached semantic assembly and fairy dressing avoid repeated placement calculations. Fishing and coastal generator inputs resolve only when generation needs them. River surfaces and wilderness effects construct approaching channels through the same geometry and material paths as the full scene. Map capture still builds complete scenes.

The final loading gate waits for selected actors, structures, vegetation, terrain, equipment, shaders and GPU completion of the first gameplay frame. An asynchronous WebGL fence keeps loading feedback responsive while that frame finishes. Banked items and unused equipment remain deferred. Audio does not hold up reveal.

Glow, antialiasing, colour grading and player visibility submit their actual shader variants during graphics setup. Smoke, spark and dust batches compile while still hidden, before their first emission. Fullscreen preparation uses position/UV geometry without a normal attribute, matching the real fullscreen pass. Otherwise Three.js selects another program and compiles again during the first draw. `tools/magic-glow-compile-test.ts` checks actual WebGL program reuse across the complete postprocessed frame, including first particle emission.

Graphics setup also initializes the texture unpack defaults in Three's state cache. Partial animation-palette uploads otherwise query those values from the driver on the first frame. Profiling showed that synchronous query draining queued graphics work for about one second. The browser regression checks partial uploads use the cached settings and restore the same values.

Every eight metres of travel starts preparation 48 metres beyond the working set. Visited sources stay reusable. Portal transitions await complete destination preparation and rendering before uncovering the view. Very slow downloads can still overrun the travel margin.

During play, compressed model parsing, generated assets and new entity geometry share a priority queue. After each rendered frame it starts work until two milliseconds have elapsed, with a maximum of eight jobs. A single expensive job can exceed that budget, then yields; cheap placement and cancelled work can finish together. Asynchronous dependencies overlap without locking the queue. A timer also lets requested work finish when animation frames are suspended. Queued entity creation checks the latest selection before allocating anything, and destination hydration waits for queued views. Startup keeps its existing parallel loading path.

Nearby creatures retain their moving sampled representation while the detailed rig's shaders and textures prepare. The handoff preserves position, animation time, selection and corpse fading. Shader submission handles at most eight meshes per batch; texture uploads and program reflection retain their existing frame budgets. Shared texture versions use that upload budget only once, with invalidation when a texture changes or is disposed. The spatial view index updates changed rows instead of rebuilding every cell on each world sync.

The loading meter has a compositor animation between real stage updates. Downloaded bytes and elapsed time remain actual measurements. Reduced-motion preferences disable the animation, and a load failure stops it. Repeated identical status text no longer rewrites the DOM.

## Acceptance

Build before production checks. Run timing tests alone in a fresh browser profile with disabled HTTP cache. Mobile uses an 844 by 390 touch viewport at DPR 2 and real joystick input. `--desktop` uses 1440 by 900 at DPR 1 and keyboard movement. Both check semantic player movement with default graphics settings. The normal gate fails at 20 seconds and rejects a freeze of 500 ms or more during the first second of revealed gameplay. `--diagnostic` allows a longer investigation capture.

```sh
npx tsx tools/mobile-startup-test.ts --label mobile --mbps 20 --cpu 2
npx tsx tools/mobile-startup-test.ts --desktop --label desktop --mbps 50 --cpu 1
npx tsx tools/mobile-startup-test.ts --desktop --label desktop-constrained --mbps 20 --cpu 1 --diagnostic
npx tsx tools/mobile-startup-test.ts --label constrained --mbps 10 --cpu 4 --diagnostic
npx tsx tools/startup-cache-test.ts --production --mobile --resume
npx tsx tools/startup-cache-test.ts --production --resume
npx tsx tools/smart-loading-world-test.ts --mobile
npx tsx tools/smart-loading-world-test.ts
npx tsx tools/release-world-failure-test.ts
npx tsx tools/streaming-loading-lab-test.ts
npx tsx tools/walking-stream-test.ts --label mobile --mbps 20 --cpu 2 --shaders --budget
npx tsx tools/walking-stream-test.ts --desktop --label desktop --mbps 50 --cpu 1
```

Reports include network and CPU throttling, first-playable time, pre-play bytes, spans, errors and before/after movement. Add `--profile` for a CPU profile or `--shaders` for driver query diagnostics. Screenshots and reports stay ignored under `test-results/`. Desktop mobile emulation does not replace a physical-phone measurement.

### September 16, 2026 measurements

Fresh-profile production runs on the first mobile build (`index-AwuqRbLy.js`), using mobile Chromium, an 844 × 390 viewport at DPR 2 and 80 ms network latency:

| Profile | First playable | Bytes received before play | Result |
| --- | ---: | ---: | --- |
| 20 Mbps, CPU slowdown 2× | 19.478 s | 22.46 MB | Under 20 s; input and first-second responsiveness passed |
| Same profile, second fresh browser | 18.691 s | 22.46 MB | Under 20 s; input and first-second responsiveness passed |
| 10 Mbps, CPU slowdown 4× | 31.633 s | 21.93 MB | Diagnostic run; exceeds the 20 s target |

The clock includes GPU completion, not just JavaScript initialization or removal of the loading screen. The first run recorded visible feedback at 323 ms and 42 updates during startup. Both 20 Mbps runs had a largest first-second frame gap of 50 ms. All selected objects were resident, with no world generation, missing assets or browser/game errors. These are local emulation results, not measurements on the reported Chrome/5G phone; the 20-second budget is conditional on the tested profile. The slower network/CPU combination still exceeds it. Pre-play transfer totals vary slightly because nonblocking audio may finish before or after reveal.

The final production cache check passed cold boot, a new browser process with a populated cache, saved surface position and saved cave position. On the unthrottled local connection they took 10.086, 5.870, 7.130 and 12.247 seconds respectively; restored terrain and spawn placement matched. The mobile travel check passed ordinary movement, approaching-area preparation, inventory acquisition without bank preloading, and both cave portals. Loading, gameplay, resumed locations and travel screenshots were inspected at normal gameplay camera distances.

The full unit run had 2,886 passes and one skipped test. Its sole failure checked the world revision while the new bake was still running; the completed bake passed the release-artifact and navigation-parity reruns. Focused renderer and asset-selection checks also passed after the final mobile distance change. The release build and TypeScript check passed. Missing terrain, scatter and navigation downloads were checked separately to retain a visible failure screen without runtime generation.

### Desktop extension, September 16, 2026

The desktop extension uses `index-C0o-AU0e.js`. Desktop tests use fresh Chromium profiles, 1440 × 900 at DPR 1, default graphics settings, 80 ms latency and no CPU slowdown. The original desktop comparison uses `index-AwuqRbLy.js` and already includes the shared world-streaming and loading-feedback changes.

| Profile | First playable | Bytes received before play | Result |
| --- | ---: | ---: | --- |
| Previous desktop delivery, 20 Mbps | 77.600 s | 172.99 MB | Baseline with original models and images |
| Optimized desktop, 20 Mbps | 26.640 s | 41.47 MB | 66% faster and 76% fewer bytes; still exceeds 20 s |
| Optimized desktop, 50 Mbps | 18.299 s | 44.41 MB | Under 20 s; keyboard movement and responsiveness passed |
| Same 50 Mbps profile, second fresh browser | 18.754 s | 44.41 MB | Under 20 s; keyboard movement and responsiveness passed |
| Mobile regression, 20 Mbps, CPU slowdown 2× | 17.107 s | 22.52 MB | Under 20 s; joystick movement and responsiveness passed |

Desktop retains its original viewing distances and uses 1024-pixel texture variants. Mobile retains its 512-pixel maps and shorter Near distance. The 50 Mbps runs include a 2.94 MB music file that finishes before reveal; music does not block startup. All selected objects were ready, with no runtime world generation or browser/game errors. The largest first-second frame gaps were 50 ms and 33.4 ms in the two desktop budget runs, and 50 ms in the mobile regression. The final 20 Mbps trace contains no duplicate completed texture downloads. Its fairy-terrain stage fell from 12.824 s before priority hints to 0.185 s, while total load fell from 28.384 s to 26.640 s.

Desktop loading, gameplay and production lab screenshots were reviewed. The lab passed compressed model loading, desktop texture requests, real movement and repeat mine-cut loading. All 68 focused tests passed, covering both texture sizes, alpha retention, stable packing, desktop compressed-model decoding, bounded concurrency, URL selection, request priority, unchanged distance presets, original-file fallback, world integrity and navigation parity. The production build and TypeScript check passed. These local results establish the 20-second target at the tested 50 Mbps desktop profile; they do not establish a universal maximum.

The final desktop cache check passed cold boot (12.057 s), returning browser (7.135 s), saved surface position (7.925 s) and saved cave position (9.721 s), on an unthrottled local connection. Terrain and spawn restoration matched. The desktop travel check passed ordinary keyboard movement, approaching scenery, inventory acquisition without bank preloading, and complete cave portal destinations before reveal. Screenshots of saved locations and travel were reviewed at gameplay camera distances.

Reusable delivery paths use the production feature lab. `tools/mobile-loading-lab-test.ts --environment` exercises compact models/textures, movement and cached mine geometry; add `--desktop` to exercise desktop delivery and controls. `tools/river-water-test.ts` covers streamed freshwater and real input. `tools/wilderness-effects-lab-test.ts` covers deferred lava, dry banks and animated lighting.

For shipped terrain, run `npx tsx tools/build-world.ts --lab`, pack `generated/world-lab` with `packTerrainDelivery`, then run `npx tsx tools/mobile-loading-lab-test.ts`. Move the disposable fixture out of public before packaging a release. The accepted September 16 fixture is retained under `.cache/accepted-mobile-world-lab-20260916/`.

The full-world exception applies to island terrain/coast partitioning and global navigation import, because a compact scene cannot prove authored spatial coverage. Unit tests compare exact restored terrain, physics samples and dry-ground ray hits. Geometry, rigs, materials, local effects, controls and loading feedback retain lab proof.

### Loading feedback and walking, September 16, 2026

The follow-up build is `index-HMxveknS.js`, world revision `0adc2eb7e67ecf3c82f4a91f7ba9845a84e60def805cf97fc035df64da787942`. The production lab checks that the activity animation advances while the loading stage stays unchanged, respects reduced motion, and keeps a sampled creature visible until its detailed rig is ready. Unit checks cover movement and picking during that handoff. Real keyboard input and normal-camera screenshots prove the resulting lab scene.

Walking checks use four four-second movement segments after a four-second idle period, with fresh profiles and disabled HTTP cache. They then allow background work to settle, recording the actual wait and requiring asset, view and shader queues to finish. Mobile uses real joystick input at 20 Mbps, 80 ms latency and CPU slowdown 2x. Desktop uses keyboard input at 50 Mbps, 80 ms latency and no CPU slowdown. These are local Chromium measurements, not measurements on a physical 5G phone.

| Profile | First playable | Walking FPS | 95th-percentile frame | Largest frame gap | Frames over 100.5 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Previous mobile, `ac8a2da` | 16.660 s | 43.9 | 50.0 ms | 366.7 ms | 3 |
| Final mobile | 17.827 s | 46.4 | 33.4 ms | 166.7 ms | 1 |
| Final desktop | 18.587 s | 42.1 | 33.4 ms | 183.4 ms | 1 |

Mobile finished 21 new models and desktop finished 12. Both had zero failed models, browser errors, pending views and pending shaders at the final snapshot. Background preparation settled 2.061 seconds after mobile movement stopped and 7.674 seconds after desktop movement stopped. Gameplay continued during that preparation. Neither trace recorded a slow shader-log query. Both first loads stayed below 20 seconds at their tested profiles; neither establishes that time on a physical phone or slower connection.

The optional walking budget requires every measured frame gap to stay below 150 ms. The final mobile run failed that stricter performance assertion at 166.7 ms, despite passing its movement and loading-completion assertions. Desktop also exceeds that target. Earlier builds reached an 83 ms mobile maximum but retained a graphics-preparation backlog, so those numbers are not the final acceptance result.

The original mobile trace spent 316 ms waiting on a newly visible creature's graphics program. Keeping its sampled representation until preparation finishes removes that synchronous handoff. Pacing new view construction also prevents several geometry and animation allocations from landing in the same frame. Startup retains parallel preparation, so these gameplay limits do not extend its loading queue.

Desktop still has an occasional graphics-thread pause. A Chrome trace shows command-buffer flushes taking about 90 ms while the JavaScript thread is idle. Smaller shader batches, fewer texture uploads and extra first-draw preparation did not improve that pause; the unsuccessful extra preparation code was removed. The changes do not establish hitch-free desktop play or a universal 20-second first load.

The release build and TypeScript check passed. The full unit suite passed 2,903 tests with one skipped before the last texture-budget and scheduler adjustments; all 69 final focused checks passed, including release integrity and navigation parity. Mobile and desktop production travel passed ordinary movement, approaching scenery, inventory acquisition without bank preloading, and both cave portals with complete destinations before reveal. Loading, handoff, walking and cave screenshots were inspected using gameplay cameras. The mobile cave's short fog distance matches the preceding release's saved-cave capture.
