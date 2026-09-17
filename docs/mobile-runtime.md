# Mobile runtime stalls

The September 16 report came from Chrome on a Samsung S24 Ultra over 5G, with repeated
freezes while idle as well as walking. Longer production runs exposed ongoing CPU work
that the earlier four-second idle check did not characterize adequately.

The diagnostic run used mobile Chromium, 844 × 390 CSS pixels, DPR 2, a 20 Mbps connection,
80 ms latency and CPU slowdown 4×. It used an RTX 5080 through ANGLE/D3D11, so it does not
emulate the phone's graphics driver, memory bandwidth or thermal behavior. CPU traces and
unprofiled frame measurements are kept separate.

## Changes

- Ordinary grounded sampled creatures reuse their baked animation matrices and joint anchors.
  Their interpolated poses receive the same terrain tangent correction, without replaying a
  live animation mixer and rebuilding the skeleton every frame. Additive hit reactions retain
  local-bone composition; unusual detached skin bindings retain the existing live path.
- Terrain diagnostics no longer overwrite a creature's rendered palette while inspecting it.
- Sampled animation updates reuse unchanged placement, color and frame attributes. Animation
  palettes keep advancing, but stationary actors no longer invalidate their instance bounds or
  upload identical transforms and colors each frame. Movement and growing pose bounds still
  invalidate culling immediately.
- The entity store supplies stable render membership. Unchanged snapshots update the spatial
  index for moving actors, instead of rescanning about 18,000 static world rows four times a
  second. Adding, removing, replacing or relocating static entities invalidates the snapshot.
  Ordinary state and material changes remain visible through the existing entity references.
- Travel prefetch keeps its spatial index across area requests. It previously allocated and
  populated a new index for the entire world every time the player crossed a small distance
  threshold. The shared snapshot path retains static membership and refreshes actor positions.
  Lab joystick movement verifies that a nearby creature leaves the cached asset working set.
- Rig allocation checks that a candidate can fit before evicting any prepared neighbours.
  Exchanges are planned in full; an unaffordable candidate cannot repeatedly empty the pool.
  Idle wandering no longer changes rig ownership. Combat still takes priority immediately,
  and travel can replace a holder when the incoming actor is at least eight metres closer.
  Released rigs dispose their owned GPU bone textures.
- Automatic distance upgrades require sustained smooth movement. Idle frames still contribute
  to reductions under load. Mobile fog distances increase from 40 to 65 to 105 metres, instead
  of jumping from 40 to the desktop Medium preset's 165 metres. Desktop presets are unchanged.

## Verification

`npx tsx tools/mobile-runtime-lab-test.ts` exercises production cattle, deer and boar on the
sampled animation path, at CPU slowdown 4× with real joystick movement. Its normal follow
camera captures are under `test-results/mobile-runtime-lab/`. The lab was accepted before
the world snapshot integration. Add `sampledActors=1` to a feature-lab URL to keep actors on
that production path for inspection.

Unit checks compare palette deformation against live skinning on planar and curved ground,
including rotation, nonuniform scale, crossfades and bone-attached equipment. They also
verify that ordinary grounding does not replay animation tracks, inspection does not alter
the drawn pose, and entity membership invalidates correctly.

`--rigs` constrains the lab to one inexpensive rig, with an unaffordable neighbour. Its stable
build counters and animated sampled neighbours check the allocation failure directly.
`--auto` checks a 23-second idle interval followed by real joystick movement and the mobile
Medium preset. Unit checks cover active-play upgrade windows, idle reductions and combat
preemption under a full rig budget.

Sustained production checks use `tools/walking-stream-test.ts --idle-ms 12000
--idle-after-ms 16000 --cpu 4`. The authored world is necessary to measure its combined
resident population and travel workload; reusable animation and indexing behavior retain
the isolated checks above. Each run stays inside the 120-second world-test budget.

Disposable reports and traces are in `test-results/walking-stream/recurring-*`.

The combined feature-lab gate exceeded its 60-second ceiling. Its existing combat, building
and navigation shards were run separately and passed without extending the time budget.

The release build and `npm run check:fast` passed: 381 test files, 2,921 tests passed and
one skipped. This includes the regenerated navigation and world artifact checks.
The final buffer and travel-index changes were then checked with type checking, 92 focused
animation/rig/terrain/loading/artifact tests, and the real mobile animation lab.

## Sustained release measurements

`recurring-travel-final` used a cold browser cache, 20 Mbps/80 ms networking, CPU slowdown
2x, 36 seconds idle, 16 seconds of real joystick travel and 12 seconds idle afterward.
The game became playable in under 18 seconds. Initial idle averaged 59.5 FPS with a 33.4 ms
worst frame; walking averaged 46.7 FPS with p95 33.4 ms and p99 50.1 ms. Post-travel idle
averaged 46.1 FPS, with no frame over 50 ms. All asset and shader queues drained; no game
errors occurred. The earlier automatic-distance run had an idle maximum of 383 ms.

The optional strict 150 ms maximum-frame gate still failed: two walking frames took
133.3 and 166.6 ms. A separate CPU/GPU trace reproduced a 166.7 ms gap and located two
88/91 ms command-buffer stalls on Chrome's Windows GPU thread. Do not report this as
zero-hitch gameplay or proof of the S24 Ultra's graphics behavior. The more aggressive
4x CPU diagnostic also remained CPU-bound; it is not evidence of a 60 FPS guarantee.
These limits need to remain visible alongside the improved typical frame times.

Desktop at 50 Mbps, CPU 1x, 1440x900 loaded in under 19 seconds. Walking p95 was 33.4 ms
and p99 was 50.1 ms; one 200 ms frame also failed the optional maximum-frame gate. Both idle
intervals stayed at or below 50 ms. Its asset/shader queues drained with no runtime errors.

`tools/player-interaction-test.ts --mobile --world` passed on the final release, including
real touch targeting, health damage, movement response and immediate grounded walk feedback.
