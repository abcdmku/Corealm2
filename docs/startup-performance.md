# Startup investigation, 6 September 2026

Cold production startup fell from 44.82 seconds to 20.82 seconds in a matched local Chromium run.
This report retains the findings and acceptance rationale; raw traces and screenshots remain disposable.

| Measurement | Before | After |
| --- | ---: | ---: |
| First playable frame | 44.82 s | 20.82 s |
| Navigation build or import | 9.36 s | 0.16 s |
| Longest main-thread task | 22.15 s | 9.05 s |
| Approximate blocking time before play | 37.09 s | 13.40 s |
| Model requests before play | 139 | 139 |

Each column is one fresh Chromium process running the production build at 1440 by 900, with
service workers blocked and the same boot recorder settings. The recorder uses headless Chromium
with SwiftShader enabled. These are local startup measurements, not hardware FPS results or
predictions for remote hosting. A separate CPU profile located the expensive functions using
[Chromium's profiling tools](https://developer.chrome.com/docs/devtools/performance/reference).
A second pair using D3D11 launch settings with CPU profiling enabled fell from 47.58 s to
24.87 s. The final run verified the renderer as an NVIDIA GeForce RTX 5080 through ANGLE D3D11.

The camera collision index sorted every triangle subtree recursively. Partitioning each subtree
around its spatial midpoint removes repeated sorting. Coincident and highly skewed centres still
split into bounded subtrees. Every original triangle remains available to camera queries.

Cave generation tested roof vertices against many distant boundary segments, calculating lengths
and projections each time. A conservative bounding-box rejection skips those calculations while
retaining the original exact test near the segment. The padding includes both original tolerances.

The shipped navigation bake had 3,544 polygons; the current world generates 3,630. Its geometry
fingerprint correctly rejected the old artifact and rebuilt navigation during every cold boot.
The refreshed artifact imports the current geometry. `npm run navmesh:build` regenerates it, and
`navigation-shipped-artifact.test.ts` now checks source freshness and artifact validity. Runtime
geometry validation and generation fallback remain active for other seeds or changed inputs.

Startup telemetry now separates cave construction, cave camera indexing, and structure camera
indexing. These formerly occupied a large unattributed gap.

The production cave lab produced identical SHA-256 digests for every mesh attribute and index
before and after, with identical floor/ceiling probes. Both screenshots were inspected. Focused
camera tests compare ray results against Three.js and cover coincident centres and a distant
outlier. The full-world navmesh bake uses the world-authoring exception to lab-first testing:
the complete island geometry and navigation cannot be validated in the compact cave fixture.

The full check passed 1,952 tests with one skipped, type checking, game build, and docs build.
After the final edits, type checking, production build, and 20 focused navigation/camera tests
passed again. The read-only critic found no blocking geometry regressions.
The combined Chromium lab gate passed every check within its 60-second budget. The full-world
hardware smoke passed loading, movement, banking and exact reset position/objective checks in
31 seconds. Its software-rendered attempt exceeded the two-minute budget and was stopped;
that run is not counted as passing.

Two stale acceptance assumptions were repaired without changing gameplay. Bank filtering now
searches for the current display name, Copper Ore, while still asserting the `grithe_ore` ID and
five-item transfer. Smoke snapshots wait for the first simulation tick on both boot and reset,
so the exact position comparison uses grounded player positions. `npm run smoke -- --run
runs/local-startup-smoke --hardware` requests GPU rendering for local semantic acceptance.

There is still substantial startup work. In the final cold sample, cave construction costs 6.62 s,
cave and structure camera indexing 3.34 s, terrain 2.64 s, and nearby scatter 3.41 s. The model
request count is unchanged, and roughly 91.5 MB transfers before readiness on the local server.
The next useful work is moving deterministic cave construction out of browser startup and reducing
distant model dependencies, while preserving source geometry and navigation parity. This change
does not claim to meet the recorder's six-second startup target.

Reproduce after building:

```sh
npx tsx tools/boot-perf.ts --run runs/local-startup --boots 5
```

## Live server plan M1 baseline, 20 September 2026

Boot span medians before the live server work, for the two modes milestone M7 has to beat. Local
play boots and stays offline. The connected session boots the same way, then picks the authored
world and joins it, so these span numbers still describe a full local world build: today the client
constructs the whole semantic world before it knows whether it will be used. M7 removes that from
the connected path, which is what the "after" column will show.

| Span | Local, ms | Connected, ms |
| --- | ---: | ---: |
| `boot.total` first playable | 13,735 | 14,207 |
| `boot.shaders.effects` | 7,055 | 6,914 |
| `boot.effects.programs` | 3,303 | 3,231 |
| `boot.scatter.total` | 1,545 | 1,561 |
| `boot.terrain.build` | 1,226 | 1,261 |
| `boot.entities.preload` | 777 | 749 |
| `boot.shaders.scene.submit` | 552 | 435 |
| `boot.entities.firstSync` | 512 | 528 |
| `boot.player.construct` | 506 | 490 |
| `boot.js.evaluate` | 301 | 288 |
| `boot.terrain.fairy` | 251 | 252 |
| `boot.effects.sceneDraw` | 191 | 178 |
| `boot.shaders.input-feedback` | 174 | 176 |
| `boot.frame.first` | 154 | 145 |
| `boot.ui.construct` | 139 | 95 |
| `boot.wasm.navigation.initialize` | 120 | 140 |
| `boot.effects.construct` | 116 | 221 |
| `boot.world.semantic` | 101 | 105 |
| `boot.entities.gltf.parse` (per model) | 79 | 81 |
| `boot.assets.manifest.load` | 66 | 67 |
| `boot.terrain.restamp` | 56 | 60 |
| `boot.assets.animations.load` | 49 | 63 |

Selecting the world and joining it took a median of 231 ms from the click to the first
authoritative tick. That is measured after first playable, so it is not part of the totals above.

Method: three cold boots per mode, medians reported, on the production build served by Vite preview
from `game/dist` at `http://127.0.0.1:4195`. A world server started with `--authored
--development-guests` on 4197 supplied the connected worlds through its `/worlds` directory. Each
boot launched a fresh headless Chromium through Playwright with `--use-angle=d3d11`,
`--disable-background-timer-throttling`, `--disable-renderer-backgrounding`,
`--disable-background-networking` and `--mute-audio`, a 1280 by 800 viewport at scale 1, and
service workers blocked, so no HTTP cache or worker carried into a later boot. Spans come from
`window.__corealmBootTelemetry.snapshot()`; a span that ends after the first playable mark is left
out, which is why post-play streaming work does not appear. No console or page errors in any of the
six boots. Machine-local measurements on one Windows 11 desktop, not a hardware claim and not a
prediction for remote hosting.

SwiftShader, which `tools/boot-perf.ts` uses, could not finish the first frame of the authored
world on this machine: all three attempts timed out at 120 s with "Unable to finish the first game
frame". These numbers therefore come from the same D3D11 headless configuration the multiplayer
browser gates use, and are not comparable with the SwiftShader figures in the September section
above.

## After M7, 21 September 2026

The thin client against the M1 baseline above: same machine, same method (production build, three
cold boots per mode in a fresh headless Chromium through ANGLE D3D11, 1280 by 800 at scale 1,
service workers blocked, medians, spans that end after the first playable mark left out). Two things
differ, because M7 changed them. The picker now always shows, so both modes start from an
auto-pick: `?play=local` and `?play=reference/local-prod`, the authored world of a server started
with `--authored --development-guests`. And the page was served by
`tools/lib/localMultiplayer.ts` in production mode, which serves `game/dist` and injects the
server's directory, where M1 used Vite preview. First playable keeps its definition: the GPU has
finished the first gameplay frame and the boot screen is gone.

| Span | M1 local, ms | After, local | M1 connected, ms | After, connected |
| --- | ---: | ---: | ---: | ---: |
| `boot.total` first playable | 13,735 | 9,148 | 14,207 | 9,178 |
| `boot.shaders.effects` | 7,055 | 4,037 | 6,914 | 3,642 |
| `boot.effects.programs` | 3,303 | 3,763 | 3,231 | 3,348 |
| `boot.scatter.total` | 1,545 | 1,347 | 1,561 | 1,377 |
| `boot.terrain.build` | 1,226 | 1,108 | 1,261 | 1,210 |
| `boot.entities.preload` | 777 | 449 | 749 | 456 |
| `boot.shaders.scene.submit` | 552 | 164 | 435 | 285 |
| `boot.entities.firstSync` | 512 | 42 | 528 | under 40 |
| `boot.player.construct` | 506 | 1,707 | 490 | 487 |
| `boot.js.evaluate` | 301 | 289 | 288 | 286 |
| `boot.terrain.fairy` | 251 | 320 | 252 | 235 |
| `boot.effects.sceneDraw` | 191 | 271 | 178 | 283 |
| `boot.shaders.input-feedback` | 174 | 90 | 176 | 95 |
| `boot.frame.first` | 154 | 70 | 145 | 67 |
| `boot.ui.construct` | 139 | 155 | 95 | 53 |
| `boot.wasm.navigation.initialize` | 120 | 83 | 140 | 93 |
| `boot.effects.construct` | 116 | 226 | 221 | 214 |
| `boot.world.semantic` | 101 | 103 | 105 | 107 |
| `boot.entities.gltf.parse` (per model) | 79 | 766 | 81 | 783 |
| `boot.assets.manifest.load` | 66 | 82 | 64 | 64 |
| `boot.terrain.restamp` | 56 | 58 | 60 | 57 |
| `boot.assets.animations.load` | 49 | 47 | 63 | 53 |

Connected first playable fell from 14,207 ms to 9,178 ms, and local from 13,735 ms to 9,148 ms, so
connected boot beats the M1 baseline, which is the M7 done-when. The first authoritative tick
reached the page 547 ms after first playable when connected and 523 ms after it in local play;
M1 measured 231 ms from a click, which is not the same interval.

Where the five seconds went. At M1 the spell pools' programs were submitted during boot (about 150
when they go first, 82 that nothing else uses), and the loading gate then waited for every program. The driver compiles in submission order, a few at a
time, so those programs stood in front of the scene programs the first frame needs. The spell pools
are now submitted after the first frame and nobody waits for them: `boot.shaders.effects` fell by
about 3.1 s. The rest is the deleted simulation: the first entity sync draws scenery only (512 ms to
about 40 ms), the preload is smaller, and no systems, save or spawn spreading run. What is left of
`boot.effects.programs` is the wait for the 139 scene programs, and it did not shrink: that wait is
now the largest span on the path, and it is the next thing to attack, by submitting scene programs as
their models arrive instead of once at the end.

New spans, and spans that no longer mean what they did:

- `boot.effects.ready` ends after first playable by design: a median 11,150 ms local and 11,065 ms
  connected, about 1.9 s after the first frame, for 82 programs. Until then a cast's visual waits, and
  is dropped if it waited more than 600 ms. `tools/effects-deferral-test.ts --dist` cast 248 ms after
  first playable with the programs not ready: the largest frame gap was 67 ms and the programs were
  usable 879 ms later.
- `boot.effects.deferredSubmit` (63 ms) is that submission. It runs in a task of its own after the
  first playable mark.
- `boot.catalog.install` (28 ms, of which 12 ms is the manifest) is the entry fetching and installing
  the client catalog before it imports the app. It sits inside `boot.js.evaluate`, which did not grow.
- `boot.spawns` (23 ms) is no longer spawn preparation. The page reads the baked placement record for
  tree clearances and spreads nothing.
- `boot.localWorker.prepare` (7 ms) reuses the manifest the entry fetched.
- `boot.preload.behindPicker` (about 1.9 s) overlaps the rest of boot and is not additive.
- `boot.player.construct` varied between 430 ms and 1,707 ms across local runs on an otherwise idle
  machine. It overlaps world restoration, so it moves with what it competes against.
- `boot.entities.gltf.parse` is reported here as the longest single parse in a boot, where M1 gave a
  per-model figure. They are not comparable.

Deleted with the old path, and so absent from any timeline: the main-thread save load, system
construction, `GameLoop.simTick()` and the autosave. None of them had a span of its own at M1;
together with the semantic work they were about 0.3 s.

Bundle sizes from the same build: initial application JavaScript 0.621 MB gzip against the 1.000 MB
budget (0.974 MB before, with the 4 MB catalog compiled in), critical JavaScript plus WASM 1.132 MB
against 1.500 MB, the local-play worker 0.290 MB against 0.350 MB. The client catalog is 1,056,568
bytes, 152 KB gzipped, fetched once and cached for good.

No console or page errors in any of the six boots. Machine-local measurements on one Windows 11
desktop, not a hardware claim and not a prediction for remote hosting.
