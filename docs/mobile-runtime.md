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

## Follow-up: graphics trailing sound and input

The same S24 Ultra user subsequently reported roughly a second of visual delay while sounds
continued. The earlier RAF measurements did not establish when the GPU completed those frames.
They are not evidence that this reported delay was fixed.
The user then confirmed that menus and desktop were delayed too. Inspection of the desktop game's
visible Settings panel found 100% resolution, High shadows and Auto distance at 2121x974 CSS pixels.
Earlier acceptance had used the lower defaults. The user confirmed Chrome's graphics acceleration
setting was on. Chrome's internal graphics page was unavailable through browser automation.

The renderer now inserts a WebGL fence after each gameplay frame and admits at most two unfinished
frames. A single-frame trial unnecessarily halved graphics throughput at browser fence polling
boundaries; two preserves pipelining without allowing an expanding queue. Completion delays over
80 ms with missed submissions temporarily reduce this to one frame; ten completions under 50 ms
restore two. This gives input priority during overload without permanently capping healthy play.
Simulation and input continue while graphics are busy; the next draw
uses current player/camera state. It never queues intermediate poses to catch up. Polls use a zero
timeout, following the [WebGL sync contract](https://registry.khronos.org/webgl/specs/latest/2.0/).
This bounds the application's queue to two frames; it does not measure the physical display or
guarantee a maximum duration for a single GPU job.
The loop also skips animation and scene preparation while both graphics slots are occupied, while continuing
input, simulation and menu updates. Animation receives the accumulated render delta when drawing
resumes. A desktop profile with the observed settings spent about 12.6 of 27.4 sampled seconds in
sampled actor updates. Terrain-palette interpolation now writes each matrix element once, and the
terrain tangent applies a direct affine correction instead of two full matrix products per bone.
Independent live-skinning comparisons cover curved ground, scale, rotation, blending and attachments.
The follow-up profile reduced sampled actor updates to about 3.2 of 26.8 sampled seconds.
It also found roughly 300 texture updates per frame. Palette rows now align to complete bone poses,
so each ordinary dynamic pose uploads in one command instead of several small row fragments.
The shader still reads the same matrices and sample indices; no animation samples are dropped.
Aggregate texture-update counts did not establish a reduction, so row alignment alone is not
evidence of a measured frame-time improvement.

The first release also reduced drawing-buffer resolution after missed completion opportunities,
kept those reductions for the session, and capped mobile pixel ratio at 1.25. That caused a reported
quality regression and has been removed. Resolution now follows the selected setting on both phone
and desktop, using the pre-existing 2x device-pixel-ratio limit. Both retain canvas and bloom
multisampling plus final FXAA. GPU delay still feeds the existing automatic draw-distance setting,
so smooth JavaScript callbacks cannot trigger distance upgrades behind a slow GPU.
Elapsed GPU diagnostic queries now require `?gpu-timing=1`; production no longer polls those driver
parameters continuously. Completion counters remain available without diagnostic timer queries.

`npx tsx tools/render-latency-test.ts` exercises the production lab with real touch input and a
deliberately withheld fence result. It checks responsive simulation, at most two pending graphics frames,
unchanged selected resolution, latest-pose recovery, and a screenshot using the normal follow camera.
The withheld signal is a deterministic queue test, not an emulation of the S24 Ultra's GPU.
`tools/walking-stream-test.ts --presentation-budget` additionally records completion latency and
enforces p95 below 100 ms and a maximum below 250 ms. Completion latency includes the frame's CPU
work and the next polling opportunity; it must not be described as pure GPU execution time.

`tools/player-interaction-test.ts --latency` measures real event delivery, semantic action response,
and completion of the first graphics frame carrying that response separately. It exercises targeting,
attack damage, ground clicks, repeated movement starts, and menu opening in the final world.
Add `--mobile` for touch/2x CPU slowdown, `--world` for the release, and `--quality-max` for the
observed desktop settings and viewport. The response gate requires event dispatch and semantic
response below 100 ms, a menu frame below 150 ms, and graphics completion below 250 ms.
Touch world actions are timed from release, when the gesture becomes a tap; joystick movement is
timed from press. This does not count an intentional finger hold as processing delay.

The first full-world candidate still failed these stricter checks: desktop travel produced a 315 ms
completion and a touch movement response took 288 ms despite its semantic position changing at 67 ms.
A diagnostic trace placed a 133 ms RAF gap almost entirely in idle JavaScript time, alongside two
97/99 ms GPU command-buffer tasks. These failures prompted the additional palette-upload change.

That candidate passed the desktop travel gate but still failed mobile travel at p95 109.5 ms and
maximum 287.8 ms. The mobile input gate also varied between a 264 ms failure and a 229 ms pass.
A mobile CPU trace then found a separate main-thread stall: demoting a live creature built its
entire animation atlas synchronously, accounting for 93 ms of one 133 ms walking frame.
Animation preparation now yields between sampled poses with a 2 ms slice budget, sharing the
existing after-frame asset queue. Live rigs remain animated until the replacement is ready.
Startup retains synchronous preparation; travel slices do not add frame waits to first load.
`npx tsx tools/animation-preparation-test.ts` passed with a production cattle asset, 18 slices,
maximum 2.8 ms, and real joystick movement between slices. Unit checks compare the prepared
vertices against Three's live skeleton and cover cancellation and the animated handoff.

After slicing, mobile travel passed at 85.7 ms p95 / 184.1 ms maximum completion and 19.2 s
cold load. However, the movement press after the first combat hit still reached completed graphics
at 288 ms despite a 79 ms semantic response. A trace found the feedback probe itself cost at most
1.2 ms; ordinary rendering and pending work remained the concern. This prompted the temporary
one-frame queue under overload described above, with the lab confirming normal pipelining returns.
That change alone still left one 267 ms first-movement completion. The loop now also yields scene
work when Chromium reports a pending discrete input event, allowing its handler to run before
another traversal. Other browsers keep the same frame loop through feature detection; preparation
still yields on its time budget independently of this hint. The Vite full-world mobile check then
passed all 19 responses: semantic response at most 85 ms, graphics completion at most 233 ms,
and the movement press after combat completed at 133 ms. Release verification follows separately.

The installed Chrome test window showed roughly one-second callback intervals while automated
Chromium ran much faster. Foreground visibility could not be established through automation;
window occlusion is an unconfirmed possibility. A test-only explicit WebGL flush did not resolve
that cadence and was not added to production. Hardware acceleration being enabled does not settle
this discrepancy. These local tests do not establish physical S24 Ultra input-to-display latency.

### Release input results and remaining limits

The release build passed. The full unit suite passed 382 files / 2,937 tests with one skipped;
the final pending-input change additionally passed 84 focused checks across seven files, type
checking, real mobile lab input, and the combat lab shard. Animation slicing and constrained
mixed-rig lab checks passed, with their normal-camera captures inspected. Final combat and
desktop/mobile travel captures were also inspected. Reducing the mobile live-rig pool did not improve its
worst latency and was reverted; the release keeps the existing actor budget.

Desktop at 2121x974 with saved High shadows / 100% resolution passed all 19 input checks:
maximum semantic response 29.4 ms, graphics completion 90.3 ms, and menu frame 29.4 ms.
The first movement after a combat hit completed at 31 ms; real attacks dealt damage and both
selection and walk rings were grounded with their hollow centres visible.

Mobile with 2x CPU slowdown still missed the strict latency gate. One release run recorded a
124.8 ms semantic response / 237.3 ms graphics completion on the first movement after combat.
The follow-up collected all 19 actions: maximum semantic response 90.8 ms, menu frame 91 ms,
and graphics completion 252.3 ms. Its only graphics miss was that same combat-to-movement
transition, 2.3 ms above the 250 ms threshold. These are improvements with an outstanding
latency target, not proof that every input meets 100/250 ms or that the user's one-second
delay is resolved on their physical devices. The thresholds remain unchanged.

The final cold travel runs kept the same 12 s idle / 16 s walking / 12 s post-idle sequence.
At 20 Mbps / 80 ms / 2x CPU, mobile became playable at 18.4 s; walking completion was 79 ms
p95 and 257.1 ms maximum, with 39.6 completed graphics frames per second. Desktop with the
observed maximum settings at 50 Mbps / 80 ms / 1x CPU became playable at 20.9 s; walking
completion was 64.2 ms p95 and 250.6 ms maximum, with 50.4 completed frames per second.
Both therefore still failed the unchanged 250 ms maximum travel gate, and that desktop run
also exceeded the user's 20 s loading target. Post-travel idle recovered to about 59 completed
frames per second on both; every asset, animation-preparation and shader queue drained with
no game errors. Reports are disposable under `test-results/walking-stream/input-priority-*`.

### Quality regression correction

The user rejected the image quality of `4fb32c9`. Its automatic resolution multiplier could reach
0.5 on top of the selected scale, leaving a 70% desktop setting at 35% resolution. The separate
1.25 mobile pixel-ratio cap could then fall to 0.625. Neither recovered automatically.

The correction removes both overrides and restores mobile multisampling. The selected 70%, 85%
or 100% resolution remains fixed during GPU backpressure. No saved preferences are rewritten.
Input priority, bounded graphics submissions, sliced animation preparation and the faster animation
math remain in place. The mobile and desktop latency lab now requires the 100% drawing buffer to
remain unchanged after a forced stall, alongside real movement and current-pose recovery.
The earlier release timing measurements above used reduced resolution and do not establish
performance at the restored quality.

Validation passed the release build, type checking, and 36 focused tests across seven files.
Both latency labs retained their full drawing buffers after forced overload, with normal-camera
screenshots inspected. Release combat, movement and menu actions also retained 100% resolution:
1688x780 on mobile and 2121x974 on desktop, both with multisampling and FXAA. Their world captures
were inspected for terrain/building detail and grounded feedback.

Desktop passed all 19 response checks, at most 33.9 ms to register an action and 86.2 ms to complete
its graphics. Mobile at 2x CPU slowdown registered all 19 actions within 95.4 ms, but one movement
response completed its graphics at 251.2 ms. That still fails the unchanged 250 ms gate. The quality
regression is corrected; these tests do not establish that all latency problems are resolved on
the physical S24 Ultra. Cold-load and sustained-travel budgets were not rerun for this correction.
