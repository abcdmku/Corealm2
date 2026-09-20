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
