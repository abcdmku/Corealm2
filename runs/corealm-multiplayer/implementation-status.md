# Multiplayer implementation status

The owner approved implementation on September 6, 2026. Offline and multiplayer paths are implemented locally. The latest repair and acceptance record follows; earlier measurements are retained below with their original workloads and limits.

## September 17 evening follow-up: the first playable frame

The remaining 155 ms result was re-examined with a sampler installed before boot. Switching CPU throttling to 2x after startup reproduced 151.3 ms even without requesting a new asset. Holding the same 2x throttle from before navigation passed immediate movement and camera orbit at 121.1 ms before the new fix; an immediate cold-model load also passed at 121.9 ms. This separates the throttle-transition result from steady-device startup and does not attribute it to GLB parsing. The old reports remain available as diagnostics.

Review identified a separate readiness gap: a loop frame skipped for input or GPU backpressure could leave the loading-screen fence waiting only on earlier warmup commands. Boot now records the gameplay submission counter before starting the loop. Readiness requires a newer successful gameplay submission and a fence completing after that submission. The existing 30-second deadline covers both waits, with nonblocking polling and no fixed delay or global queue drain. Multiplayer lab startup also warms the final resident materials after hydration. Manual render callers retain the original fence-only behavior.

The new first-play gate applies 2x CPU throttling before navigation, samples the loading-screen boundary, and immediately uses normal touch movement and camera orbit. Final raw/release-asset runs passed with RAF maxima of 33.4/33.5 ms, GPU completion maxima of 102.1/118.2 ms and no post-ready JavaScript long tasks. Player movement exceeded 2.2 m and camera yaw changed by 0.972 radians in each run. Normal-camera screenshots were inspected. Cold raw loading with the corrected throttle timing also passed: 0.52 m during a 231.6 ms load, 17 animation slices of at most 3.2 ms, RAF max 16.8 ms and GPU max 120.4 ms. These remain local Chromium measurements, not a guarantee for arbitrary hardware.

All 16 focused renderer/fence tests passed, including skipped draws, old submissions, a busy GPU, missing submissions, timeout, context loss and failed submission. Type checking passed. The two-session join/cold-equipment gate passed all 26 checks in 23.128 seconds with no recorded runtime errors. Fresh read-only review found no remaining concrete defect in the readiness change. Current main is still `2f4409c`; existing worktree changes remain intact.

The production build and three generated-world/navigation checks passed. The later full-world release test loaded 12 additional assets with no failed or unfinished preparation work; walking RAF p95/max were 33.4/50 ms and graphics completion p95/max were 65/87.5 ms. Its normal-camera screenshot was inspected. The compiled multiplayer launcher passed all ten checks, including joining, replicated movement/equipment, shutdown and persistence after restart. This follow-up used focused checks; the last full-suite result remains the 3,127-test pass recorded below. No deployment was performed.

## September 17 follow-up: joining, cold assets and enemy ownership

`origin/main` remains `2f4409c`. Existing worktree changes were preserved. A team split targeting, render continuity, asset scheduling, server join cost, browser regression coverage and read-only review; the root integrated and ran browser acceptance.

Idle proximity no longer claims a passive monster for the first player. Provocation selects the actual attacker before the synchronous AI callback. Valid active aggro remains stable, while death, leaving and invalid targets release ownership and cancel the previous player's pending attacks. The two-browser reproduction has the second joiner attack with the first player standing closer; both sessions observe retaliation against the attacker, and the first player's health and engagement remain unchanged. Unit cases reverse join order, use two independently engaged monsters, and cover spell arrival and target handoffs.

Remote appearances retain their previous complete representation while new sources and shaders prepare. First display waits for the complete outfit. Sampled animation capacity grows without replacing prepared scene meshes, so the 17th and 33rd actors do not blank their existing neighbors. Tint-capable batches establish their color shader variant before first draw. Appearance changes preserve an active attack's clock and compatible hit overlay. Shader-readiness lookup now uses ancestor counters instead of scanning the entire pending mesh queue for every character part.

Raw GLBs download through the existing loading manager, then schedule parsing and material, texture-sharing and publication work through the gameplay preparation queue. Resource paths, texture handlers, manager completion and retries retain their existing behavior. Authored-player hunt setup groups equivalent targets and stops after the first reachable resident. A measured join used 54 path queries instead of 868, reducing construction from about 29 ms to 8.6 ms without sharing private reachability between players.

GPU service tracing placed the remaining pauses inside first instanced draw calls, including consecutive 127.9 ms and 107.5 ms calls, rather than JavaScript parsing or shader-link queries. Full-detail imported actors used interleaved integer vertex streams, while simplified actors used separate float streams. Sampled geometry now uses consistent decoded Float32 inputs across both paths and rigid attachments. Geometry, colors, weights, UVs and source buffers retain their values. Explicit integer shader inputs retain integer delivery; half-float inputs decode before conversion. These uncommon formats bypass topology simplification to preserve their encoding and draw ranges. A broader per-mesh warmup experiment delayed world loading and was removed.

The strict two-context lab gate passed in 24.096 seconds with actual keyboard movement and camera rotation through joining and camera rotation through a cold Cobalt Sword load. The observer made its first request for that model after equipping; acceptance waited for the rendered appearance to contain it. No partial outfit or disappearance occurred. Join RAF p95/max were 16.8/50 ms, with a maximum measured graphics gap of 97.5 ms. Equipment RAF p95/max were 16.7/16.8 ms, with a maximum graphics gap of 42.1 ms.

The later authored-world gate passed all checks in 106.429 seconds. The previously repeatable join graphics stall fell from 351.4 ms to 69.2 ms. Join and equipment RAF p95/max were 16.8/50 ms; equipment graphics peaked at 83.7 ms. Neither browser recorded a JavaScript long task in the measured windows. The remote appeared fully assembled after 1.74 seconds and did not disappear. These are local Chromium measurements at 1280×800, 0.7 render scale, low shadows and near distance, not an Internet or arbitrary-device latency guarantee. Normal-camera screenshots were inspected. Motion evidence crosses DevTools as a compact record; full resident-world serialization and screenshots are outside timing windows.

The final production travel test crossed streaming boundaries with real keyboard input, a cold browser cache, 20 Mbps downloads and 80 ms network latency. It loaded 12 new assets, finished all preparation queues and reported no runtime errors. Walking RAF p95/max were 33.4/50 ms; graphics completion p95/max were 63.8/88.3 ms. Idle and settling stayed below those maxima. The normal-camera screenshot was inspected.

The cold-asset test waits for initial scene preparation to finish, verifies that the cattle model has never been requested, then starts touch movement and frame sampling before loading it. At 2x CPU throttling, raw GLBs passed with 0.384 m of movement during a 202.5 ms load and 13 animation slices of at most 2.7 ms. RAF max was 33.3 ms and graphics completion max was 103.5 ms. Release assets also passed: 0.450 m during a 217 ms load, longest slice 3.3 ms, RAF max 16.8 ms and graphics max 118.1 ms. The fixture resets the player after loading, so the test restarts the joystick at that boundary and checks both movement intervals. Both normal-camera screenshots were inspected. An earlier run begun immediately after lab startup recorded a 155.5 ms GPU completion for a frame submitted before the cattle request; that report is retained separately. The cold-asset gate does not certify initial startup below 150 ms.

The repeated full suite passed 3,127 tests with zero failures and one skipped test. The final special-format safeguard then passed 33 focused animation and geometry tests, including both simplified and full-detail paths; type checking and the final production build passed. Fresh read-only review identified the crowd-growth and action-handoff issues above and found no remaining concrete defect after their repair.

Final browser reruns passed combat/equipment in 24.451 s, targeting in 17.010 s, invocations in 13.237 s, activities in 25.779 s, interactions in 27.199 s and lifecycle in 17.727 s. Each used two independent sessions, production commands, semantic assertions and inspected normal-camera screenshots, with no recorded runtime errors. The combat run delivered 20 published action cues at 4.6 ms median and 15 ms p95/max on loopback. These timings exclude input, simulation and durable commit before publication. The compiled production launcher passed configuration, explicit joins, movement, equipment, shutdown and persistence after restart in 15.059 s. No deployment was performed.

## September 17: visible actions and smoother replication

Fetched `origin/main` and ran rebase with autostash. The branch was already current at `2f4409c`; existing worktree changes were restored and preserved. No deployment was performed.

Public state now separates compact motion, persistent activity presentation, and transient actions. Four float32 values carry each actor's movement. A bounded 4,096-entry circular action log publishes only new allowlisted cues to nearby players in the same realm. Spell launches, melee windups/hits/cancellations, bank gestures and death cues appear in other sessions without publishing private inventory, rewards or dialogue state. Current tools, equipment, gathering and traversal timing restore from snapshots; old one-shot actions do not replay after reconnect.

Motion interpolation follows the actual publication cadence and cannot rewind when network callbacks and frame timestamps interleave. Up to 128 nearby players update at 10 Hz; above that, the nearest 32 retain 10 Hz and the remainder use 2 Hz motion. Activity and gameplay changes bypass that cosmetic throttle. Prediction copies only mutable movement state. Unchanged updates preserve active animations, and projectiles, fishing and traversal animate between authority ticks.

The browser prepares bounded spell pools and all public animation clips before use, including the refraction camera's actual light layer. Remote spells have independent origins and effect slots and add no dynamic lights. Targeted and area invocations now use the asynchronous authoritative command path. Enemy target changes cancel the previous owner's pending attack and start the new owner's engagement; a delayed old cancellation cannot clear the new projectile. Fatal hits and deaths retain the original combat position through immediate respawn.

The production lab was extended and accepted before final-world integration. Two independent Chromium sessions exercised these action families through the real host and production command/rendering paths:

| Gate | Observed behavior | Latest duration |
| --- | --- | --- |
| Combat and equipment | Equipped weapon, melee animation through heartbeats, impact, cancellation, four basic spell elements, leave cleanup | 22.122 s |
| Invocations | Preferred spell action bar, targeted invocation, area reticle, rune use, authoritative cast lock, simultaneous casters | 16.257 s |
| Activities | Mining, chopping, fishing with rod/line, cooking, eating, campfire creation, banking and transfers | 25.100 s |
| Interactions | Climb, vault, balance and slide before server landing; shop buy/sell; dialogue choice; portal travel | 26.084 s |
| Lifecycle | Concealed passage, traversal cancellation, incoming projectiles in both sessions, death/respawn and private recovery | 17.952 s |

All gates passed semantic before/after assertions without recorded runtime errors. Normal-gameplay-camera screenshots of combat, spells, activity poses/tools, traversal and lifecycle were inspected. The 144-player motion fixture also passed with zero backward samples; its longest observed hold in remote interpolated position was 33.3 ms. That hold metric is not a bound on browser frame time.

Local publication-to-observer handling latency in the isolated combat run was 3.9 ms median and 8.6 ms p95 across 16 cues. Invocations measured 11.5 ms p95 across 10 cues; lifecycle measured 11.4 ms p95 across nine cues. These small loopback samples exclude the time before server publication, including input, simulation and durable commit. The isolated combat latency run omitted screenshots; the separate screenshot run passed too.

The combined multiplayer lab passed all 28 checks, covering authoritative rewards, resource/loot contention, private recovery, reconnect, world isolation, admission/error UI, restart persistence, forged-write rejection and the 256-player display cap. The compiled production launcher passed joining, replicated movement/equipment, listener shutdown and character recovery after restart in 14.637 s.

The compiled authored-world check passed in 93.609 s. During its 20-second movement sample, 125 commands had 85.2 ms median, 151.5 ms p95 and 262.9 ms maximum acknowledgement latency, with one stable connection and no recorded runtime errors. Frame intervals were 16.7 ms median, 33.3 ms p95 and 383.4 ms maximum under CPU profiling. An earlier unprofiled run had a 1,233.4 ms worst frame. The repeated interpolation pauses and first-spell stall were addressed, but occasional full-world frame hitches remain; these results do not establish hitch-free rendering or internet latency.

Final type checking and the production build passed. The focused multiplayer, combat, animation, spell and shader suite passed 262 tests in 27 files; the regenerated navigation/world release artifacts passed another three tests in two files. An earlier whole-suite run recorded 3,076 passed, four failed and one skipped. Its four failures (protocol expectation, prepared-mesh count and two stale generated artifacts) were corrected and their focused checks passed; the entire suite was not repeated afterward. Fresh read-only review findings were repaired and covered by the final focused checks and browser gates.

Protocol 2 requires updating the browser and host together. Durable save schema and content version are unchanged. Reproduction commands and disposable report locations are in [the feature-lab workflow](../../docs/feature-lab.md) and [hosting guide](../../docs/multiplayer-hosting.md). The historical 1,000-player capacity limits below still apply.

## Implemented and exercised

Typed provider, world, session, command, replication, and storage contracts; explicit single-world/list/directory registration; asynchronous local sessions; a headless shared production simulation; a WebSocket reference adapter; independent deterministic adapter conformance; durable SQLite state and operation receipts; atomic admission and reconnect reservations; world/session isolation; private replication; interpolation and movement prediction; production input/UI/agent command routing; offline save protection; authored-world hosting and browser integration.

Gameplay uses production movement, collision/navigation, shared resource respawn, enemy AI, combat, loot claims, inventory/equipment, banking, purchases, production, quests, hunts, campfires, agility, travel, discovery, and respawn anchors. Private doors use each player's quest state against one shared navigation mesh. Historical players remain durable on disk and are loaded on demand. Random streams persist outside replicated player state.

## Browser and repository evidence

- The production multiplayer lab passed 24 checks in two independent Chromium contexts against one real host: explicit join; real movement; remote visibility; authoritative mining and inventory awards; reconnect; separate-world isolation and independent progression; cleanup; full/version/unavailable states; server restart persistence; atomic resource and loot claims; human loot and recovery panels; actual combat death/XP and private production-view combat loot; private recovery filtering; forged-write rejection; no runtime errors; under 60 seconds. Screenshots were inspected.
- The combined building/combat production lab passed all checks in 42.144 seconds. Its bank filter now uses the item's displayed name, Copper. Its unreachable-route probe uses a valid command coordinate outside the world, rather than a coordinate rejected by the new protocol validator.
- Two browsers in the normal authored world passed movement/remote visibility, explicit join, online/offline save isolation, and offline restoration and a reload of the preserved save in 58.866 seconds. The connected and restored screenshots were inspected. The Vite process logged canceled blob-texture loads while the old document unloaded; the new page completed without recorded page/runtime errors.
- Type checking, game build, and the 83-page documentation build passed. The full test run recorded 1,950 passed, 25 failed, and one pending. An isolated starting-revision run reproduced 24 failures in asset provenance/geometry, creature gait/presentation, renderer timing, and structure grounding. The remaining coastal traversal test timed out during the full suite and passed in a focused rerun (40 tests across five files). The full suite is not green.
- The fresh read-only acceptance critic found no new confirmed P1/P2 findings after reviewing authority dispatch, browser command migration, reconnect, receipts, SQLite patch persistence, eviction, privacy, and realm filtering. The narrow follow-up review found no production issue in shared loot expiry and production loot-view wiring, and identified a browser replication-wait race that root corrected. Root then accepted passing browser state and screenshots.

Final focused checks passed 76 multiplayer/persistence tests and 30 loot/campfire regressions. Shared loot expiry with zero connected players and explicit outbound queue isolation have regression coverage.

Raw test reports and screenshots are disposable under `test-results`. This status file preserves the acceptance summary rather than promoting large generated artifacts.

## Sustained network measurements

Hardware: Intel Core Ultra 9 285K, 24 logical CPUs, 102,494,892,032 bytes RAM, Windows 10.0.26200, Node 24.14.0. Host and separate client process communicate over loopback. Every client steers and starts production mining once per ten seconds. Measurements include real active clients, churn, paused consumers, and rejection of a 1,001st admission.

| Run | Duration | Active / connected at end | Tick p50 / p95 / p99 | Ack p50 / p95 / p99 | Server peak RSS | Client bytes received |
| --- | --- | --- | --- | --- | --- | --- |
| Distributed, latest completed | 600.309 s | 1000 / 1000 | 106.92 / 125.18 / 133.14 ms | 163.94 / 362.04 / 682.00 ms | 1,198,714,880 B | 3,036,900,826 B |
| Clustered, latest completed | 600.026 s | 1000 / 1000 | 177.97 / 199.65 / 211.38 ms | 262.90 / 748.67 / 1213.11 ms | 1,504,264,192 B | 10,968,342,391 B |

Distributed report: `distributed-1788713365796/report.json`; source fingerprint `2201b61c9547accba9e6aa10a3ab8b72994b6d6d544b57495498a54a4a4d904e`. Server CPU: 419.188 s user and 173.547 s system. It durably recorded 3,502 mined ore, 1,000 resource records, and 1,000 players, with 297,359 accepted commands, 391 gameplay rejections, zero transport errors, and no pending commands at completion.

Latest clustered report: `clustered-1788715002979/report.json`; source fingerprint `b462c84a5693a3d37228f2d0e6782da26e8e540ba8542c12742a9ae4151aacb2`. Server CPU: 471.547 s user and 158.891 s system. It durably recorded 233 mined ore from one contested resource and 1,000 players, with 284,954 accepted commands and 13,546 gameplay rejections. Both runs completed churn/slow-consumer cases, had zero transport errors and no pending commands, and rejected the extra join without losing existing clients. Paused consumers did not reach the outbound disconnect threshold; a separate network regression pins the production queue at its limit and verifies BACKLOG closure while another client continues receiving acknowledgements. Short diagnostic runs and an earlier OOM attempt are not acceptance evidence; the historical receipt-cache retention responsible for that OOM was removed and subsequent sustained runs completed.

The proposed p95 targets are ticks below 100 ms and acknowledgements below 250 ms. These sustained measurements miss both. A configured maximum of 1,000 is an admission limit, not performance certification. The pad is synthetic geometry with production movement/mining rules, not a complete authored-world combat workload. The last runs preceded the final loot-view/shared-expiry corrections and test-only browser controls; their source fingerprints identify exactly what was measured. Stage counters include setup; tick percentiles and client duration cover the measured interval, and peak RSS includes setup.

## Production rendering measurement

The separate render test used one real browser and 999 synthetic server actors in the authored scene, preserving production NPC models. It is not network-capacity evidence. On an RTX 5080 using ANGLE/D3D11, 1280x800 viewport, render scale 0.7, low shadows, and near draw distance:

| Scene | Sample | Median / p95 frame time | Median implied FPS | Draw calls / triangles |
| --- | --- | --- | --- | --- |
| No remote actors | 5 s | 16.7 / 33.3 ms | 59.9 | 493 / 8,646,112 |
| 999 remote actors | 15 s | 33.4 / 66.7 ms | 29.9 | 1,787 / 54,060,429 |

All 999 actors were replicated and rendered without runtime errors. The crowded screenshot was inspected. This does not pass a 60 FPS crowded-scene target.

## Remaining limits

- Sustained 1,000-player latency targets are not met. Both distributed and clustered ten-minute runs completed, with the measured limits shown above.
- The authored browser accepts only the currently loaded map seed. Other seeds report incompatibility; automatic terrain rebuilding across seeds is not implemented.
- Remote equipment now uses production item mappings; the earlier generic peasant presentation has been replaced.
- Production authentication is an adapter contract, not a bundled identity service. Development guests require explicit opt-in.
- A fresh green whole-repository run has not been established; see the dated test records above. No production deployment or capacity certification has been performed.

Hosting commands, configuration examples, adapter contracts, storage semantics, and queue limits are documented in `docs/multiplayer-hosting.md`.

## Client distance limit, initial 64-player measurement

The initial client limit selected the nearest 64 remote players within 32 m. The server still replicates its 48 m interest area and simulates every admitted player. Full production models are retained for selected players. All incoming player state remains in the session, including players omitted from the drawn entity list.

The multiplayer lab passed 28 checks, including the draw cap, distance exclusion, changing the selected players through real keyboard movement, and leave cleanup. Focused nearest-player/boundary/tie tests, type checking, the game build, and whitespace checks passed. A fresh read-only critic found no P1/P2 issue. Root inspected lab and authored-world screenshots.

The same authored rendering fixture retained 999 replicated remote actors and selected 64 for drawing. Its `drawnActors` field counts selected IDs, rather than independently counting renderer records. At the previously documented hardware/settings, median frame time was 33.3 ms, p95 was 50.1 ms, draw calls were 1,248, and triangles were 11,772,344. The earlier uncapped result was 33.4 / 66.7 ms, 1,787 draw calls, and 54,060,429 triangles. Median FPS remains around 30; this change does not resolve server capacity targets. Reports are in `test-results/multiplayer-render/report.json` and `report-before-distance-limit.json`.
## Current 256-player cap

At the owner's request, the current client cap is 256 remote players, still the nearest players within 32 m. The 320-actor lab fixture passes all 28 checks, including distance exclusion, changing selected players through keyboard movement, and cleanup. Type checking, two focused selection tests, the build, and whitespace checks pass. A fresh read-only critic found no P1/P2 issue; root inspected the lab and authored screenshots.

The authored crowd run retained 999 replicated actors and selected 256. Under the same documented hardware and settings, median frame time was 33.3 ms, p95 was 50.0 ms, draw calls were 1,729, and triangles were 20,461,845. Median implied FPS stayed about 30. The previous 64-player result is preserved as `test-results/multiplayer-render/report-cap64.json`; the current report is `report.json`. These are client rendering measurements, not server-capacity certification.

## Shared crowd presentation, superseded by armour preservation

At the owner's request, crowds now retain individual appearance for 32 nearby selected players and share an animated appearance for the remainder. It activates at 64 selected actors, exits below 48, and uses a 1 m detail-retention bias. Original character geometry, individual colours, the 256/32 m display selection and authoritative state remain intact. Shared crowd instances do not cast shadows. Lab acceptance preceded final-world wiring.

The focused crowd lab passed nine checks covering actor retention, the 32-detail budget, actual sampled animation clocks, keyboard movement, detail reassignment, lower draw submissions, toggling, leave cleanup and console errors. Root inspected simplified/detailed lab screenshots and the final authored screenshot. The same-camera lab draw snapshots were 534 simplified versus 1,253 detailed. Their instantaneous FPS includes warmup and is not used as timing evidence.

The separate built-production run used the audit's RTX 5080, 1280x800, 0.7 scale, low shadows and near distance settings, with one browser and 999 moving server fixture actors. It retained 999 replicated players and selected 256. Over 15 seconds, average FPS was 37.69, median frame interval 16.7 ms and p95 33.4 ms. End-of-window submissions were 976 draws and 15,938,012 triangles. The earlier audit recorded roughly 26 to 29 delivered frames/s, median 33.3 ms and p95 50.0 to 50.1 ms, with 1,729 to 1,759 draws and about 20.5 million triangles. These are separate early-play runs with background streaming, not a perfectly isolated A/B experiment. The crowded result still falls below sustained 60 FPS. It makes no server-capacity claim.

Repeat with `npx tsx tools/multiplayer-perf-audit.ts --production --out=test-results/multiplayer-crowd-performance` after building. Evidence is in `test-results/multiplayer-crowd/report.json` and `test-results/multiplayer-crowd-performance/production/report.json`. The audit now records average FPS explicitly, separate from reciprocal median frame interval. Build, type checking and 31 focused tests passed. Fresh read-only review found no P1/P2 issue.

Final verification: the combined multiplayer lab passed all 28 checks, and the focused multiplayer/animation/entity-view suite passed 85 tests across 13 files. Type checking and whitespace checks passed after integration.

## Armour-preserving crowd presentation

The owner corrected the shared-outfit approach. Players now keep their equipped armour, tier colours and weapon models through crowd/detail transitions. Public equipment IDs were already replicated, but the old remote view ignored them. Remote views now use the same gearAppearanceParts/applyGearAppearance mappings and weapon sockets as the player renderer. Default clothing fills unequipped body slots only; NPC outfit remixing and dyes cannot replace or repaint equipped parts. Hair and appearance identity no longer change when crowd mode activates. Compatible equipped models can share sampled animation; the nearest 32 keep the normal animation/shadow path and the rest omit individual shadow casting. The 256-player cap remains. Geometry is retained; this simplifies rendering work, not the armour silhouette.

The production lab passed 13 checks. It staged 320 actors wearing bronze, steel and blue sets and retained 256 selected actors, 32 on the normal path. Assertions inspected drawn material names and production tier treatments, sampled animation, real keyboard movement, detail reassignment and cleanup. An equipment replacement checked the new Kaldite materials and removal of the old chest treatment before and after changing detail. Root inspected simplified/detailed, changed-armour and authored-world screenshots. The same-camera lab snapshots submitted 9.31 million triangles with crowd mode versus 16.42 million with normal rendering. Draw calls increased, 218 versus 151, because crowd and normal groups are separate; this is not a universal draw-call reduction. Those snapshot FPS values include warmup and are not steady-state timing evidence.

The built authored-world test used one browser and 999 moving server fixture actors with three production equipment sets, selecting 256. On the previously documented RTX 5080 at 1280x800, 0.7 render scale, low shadows and near distance, the 15-second crowd sample averaged 48.46 FPS, with median 16.7 ms and p95 33.4 ms. The end snapshot recorded 664 draw calls and 18,018,790 triangles. This workload differs from the earlier shared-peasant test; do not treat the two as an isolated speed comparison or extrapolate three sets to every possible equipment combination. No 1,000-network-client capacity claim or sustained 60 FPS claim is made.

Repeat with `npx tsx tools/multiplayer-perf-audit.ts --production --armour --out=test-results/multiplayer-armour-performance` after building. Evidence: `test-results/multiplayer-crowd/report.json`, `test-results/multiplayer-armour-performance/production/report.json`. Build, type checking and 88 focused tests across 14 files passed. A fresh read-only critic found no confirmed P1/P2 defect; its post-change material-evidence gap was addressed and retested.

Final armour verification: all 28 combined multiplayer lab checks passed. The changed distant wearer was explicitly confirmed in crowd mode with a sampled rig, new Kaldite chest/pauldron/scarf materials and retained blue armour in its other slots. Previous chest materials were absent. The strengthened 13-check crowd lab passed, and final type checking and whitespace checks passed.

## World selection on the loading screen, and player-added hosts (2026-09-17)

User request: show world selection during loading, allow adding a host, and rework the panel so local play is an explicit first option.

Discovery no longer waits for the engine. `startWorldSelection` in `browserSession.ts` builds the panel, the guest-name field and the session controller with forwarded ports, and boot mounts it on the loading screen. `installBrowserSession` adopts that selection and attaches the gameplay ports; boot calls `setReady` after the first frame. A world chosen while loading shows "Join when ready" and joins itself once the scene is drawn.

The list starts with "Local play only", selected by default, then the worlds. One button acts on the choice: Play offline, Join world, Leave world, or Cancel connection. Play offline hides the panel and leaves the menu closed after boot. The panel also takes host addresses: `hostDirectoryUrl` normalises `host:port`, bare hosts, `ws://` endpoints and full URLs into a directory URL, loopback defaulting to http and everything else to https. Hosts persist in `corealm.hosts.v1`, are queried in parallel with the configured directory, dedupe by world key, and report their own failures without hiding other sources.

- `npm run typecheck` passed. `npx vitest run`: 3,139 passed, 2 failed. Both failures are the shipped world and navigation artifacts asking for `npm run world:build`; they were failing before this change. New unit file `tests/multiplayer-host-address.test.ts` covers address normalisation against the discovery validator.
- `npx tsx tools/multiplayer-selection-test.ts` passed 22 checks in 84 seconds against the real dev launcher: selection over the loading screen, local play chosen by default with a single action, a queued join that connects after the first frame, adding a host by address, its storage and merge, world selection carried by that host alone with the page's own configuration blocked, Play offline leaving the game offline with the menu closed, and host removal. Screenshots inspected.
- Regression: `tools/multiplayer-social-test.ts` (23 checks), `tools/multiplayer-lab-test.ts` (28 checks) and `tools/multiplayer-launcher-test.ts` dev (14 checks) passed after the list gained its local-play row.
- Two defects the browser test caught and that are now fixed: refreshing the world list dropped the local-play selection, and `.worlds--boot { display: flex }` beat the user-agent `[hidden]` rule so Play offline could not put the panel away.
- Tools that select a world or leave one were updated to `.worlds__row--world input` and to select local play before leaving. The heavier ones (actions, authored, crowd, join-stability, motion, perf-audit, render, scene-transition, creature-death-stability) were not re-run; their edits follow the same pattern as the three suites that were.
