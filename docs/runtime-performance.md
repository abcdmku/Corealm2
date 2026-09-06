# Runtime distance and interior loading

This pass follows the startup work in [startup-performance.md](startup-performance.md).

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
