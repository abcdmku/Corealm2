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
