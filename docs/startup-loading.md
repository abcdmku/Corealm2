# Startup loading

## Desktop and mobile delivery

The release packer produces WebP texture maps capped at 1024 pixels for desktop and 512 pixels for coarse-pointer browsers. Both use gzip-wrapped Meshopt GLBs and a bounded queue of 16 overlapping asset loads. Source art stays unchanged. The smaller textures retain authored colour and alpha layers, material channels and UVs. Development manifests without delivery variants continue to use the original files.

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

## Complete starting view

The HTML loading screen appears before the engine bundle arrives. It shows the stage, a stage progress bar, elapsed time and completed download bytes. It does not invent a percentage or estimated remaining size.

World data starts downloading as soon as the saved starting position is known. Shared surfaces, animation libraries and navigation download alongside it. Requested shared surface maps receive image preload hints with high fetch priority. Desktop traces showed three small fairy-rock maps waiting about 16 seconds behind model requests; these maps block terrain restoration. The hints match Three's anonymous CORS mode and disappear when the request finishes. Boot code modules and the tiny shared grass source are requested before model traffic can queue them behind large files. Player construction and carried-item preparation overlap world restoration. Nearby model and scatter requests use the normal asset queue. Spatial hints come from baked placements; normal residency selection still decides what must be ready.

Character outfit parts download together, then commit as a complete outfit; a failed part preserves the previous outfit and can be retried. Habitat tree clearance and saved altar restoration group related entities once instead of scanning the entire entity list for each habitat or altar.

Cached semantic assembly and fairy dressing avoid repeated placement calculations. Fishing and coastal generator inputs resolve only when generation needs them. River surfaces and wilderness effects construct approaching channels through the same geometry and material paths as the full scene. Map capture still builds complete scenes.

The final loading gate waits for selected actors, structures, vegetation, terrain, equipment, shaders and GPU completion of the first gameplay frame. An asynchronous WebGL fence keeps loading feedback responsive while that frame finishes. Banked items and unused equipment remain deferred. Audio does not hold up reveal.

Glow, antialiasing, colour grading and player visibility submit their actual shader variants during graphics setup. Smoke, spark and dust batches compile while still hidden, before their first emission. Fullscreen preparation uses position/UV geometry without a normal attribute, matching the real fullscreen pass. Otherwise Three.js selects another program and compiles again during the first draw. `tools/magic-glow-compile-test.ts` checks actual WebGL program reuse across the complete postprocessed frame, including first particle emission.

Graphics setup also initializes the texture unpack defaults in Three's state cache. Partial animation-palette uploads otherwise query those values from the driver on the first frame. Profiling showed that synchronous query draining queued graphics work for about one second. The browser regression checks partial uploads use the cached settings and restore the same values.

Every eight metres of travel starts preparation 48 metres beyond the working set. Visited sources stay reusable. Portal transitions await complete destination preparation and rendering before uncovering the view. Very slow downloads can still overrun the travel margin.

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
