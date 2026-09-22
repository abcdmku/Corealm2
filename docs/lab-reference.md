# Lab fixture reference

Read [the development workflow](./feature-lab.md) first. This file describes existing fixtures and specialized diagnostics. Read only the section needed for the current change; these commands are not a checklist. Do not append feature histories or acceptance reports here.

`npx tsx tools/creature-death-stability-test.ts` checks a Granary Rat's first death with two independent Chromium clients in the production lab. It measures RAF intervals, GPU completion and pending-frame time through combat, loot creation and corpse fading while the observer walks. Each must stay below 150 ms, with XP, loot, continued movement and simulation ticks asserted. `--frog` checks another creature; `--authored` uses the nearest authored Granary Rat to spawn and the shipped Attack context menu after lab acceptance. Lab and authored budgets are 60 and 120 seconds. `--profile --diagnostic` records CPU profiles and slow GL calls for investigation; use an unprofiled run for acceptance. Screenshots run outside measurement, and reports stay under ignored `test-results/creature-death-stability-*` directories.

`npx tsx tools/multiplayer-scene-transition-test.ts` checks the launcher entry flow and scene continuity: Worlds opens automatically, rejected guest authentication retains the existing scene, retry enters the world directly, native WebSocket loss reconnects without losing drawn scenery, and leaving restores the offline entity set. Static authored landmarks remain available beyond server gameplay interest; old actors and interactables must be replaced by the authoritative snapshot. The test records semantic membership and actual drawn bounds, with normal-camera screenshots. Use `--prod` after building and add `--authored` for the full-world integration gate (120 seconds; the lab budget is 60 seconds). Reports are disposable under `test-results/multiplayer-scene-transition-*`.

`npx tsx tools/startup-presentation-test.ts` samples from before boot and checks the first two seconds after the loading screen disappears. CPU throttling is set to 2x before navigation and stays constant; the test immediately uses the real touch joystick and camera orbit without a settling wait. It requires position and camera yaw changes, nonempty RAF/GPU samples, no runtime errors, and frame/completion/pending gaps below 150 ms. Add `--release` to serve packed release assets through the same production Vite lab. Timing excludes screenshots; reports and normal-camera captures are disposable under `test-results/startup-presentation-*`. Changing CPU throttling after readiness measures a separate transition and must not be used as a steady-device startup result.

`npx tsx tools/multiplayer-join-stability-test.ts` checks sequential joins in two independent Chromium sessions while the first player walks and rotates the normal camera. It rejects incomplete outfits, disappearance after first display, RAF gaps above 150 ms, and GPU completion or pending-frame gaps above 150 ms. The cold equipment case grants a Cobalt Sword through the authoritative inventory, equips it through the shipped inventory UI, verifies the observer's first model request, and waits for the actual rendered outfit to contain that item. Screenshots run outside measured windows. Add `--profile` for CPU and shader diagnostics; after lab acceptance, `--authored` checks full-world integration within the existing 120-second budget. The authored case uses starter equipment and does not claim a cold-cache load. Reports are disposable under `test-results/multiplayer-join-stability*`.

`npx tsx tools/multiplayer-actions-test.ts --targeting` makes the second player attack a passive monster while the first player stands closer. Both sessions must observe the monster retaliating against the attacker; the first player's health and engagement stay unchanged. Unit coverage also reverses join order and covers independent monsters, spells, death, leaving, realm changes and target handoffs. `npx tsx tools/animation-preparation-test.ts --raw` exercises raw development GLBs with actual touch movement at 2x CPU throttling; omitting `--raw` exercises release assets. It records initial-scene readiness, asserts the target model remains unfetched, then samples movement, RAF and GPU completion through the cold request and preparation. This isolates streaming after startup; it does not certify boot frame timing.

For graphics stalls without JavaScript long tasks, `tools/walking-stream-test.ts --desktop --trace --gpu-commands` records individual GPU-process GL calls. Trace extraction streams to disk and stays outside gameplay timing windows. These traces are large disposable diagnostics; acceptance uses an untraced run with `--budget --presentation-budget` after the production build. Both this tool and `multiplayer-join-stability-test.ts` accept `--url` to reuse an existing server, including a production preview. The join check records raw `.glb` and release `.glb.model` requests.

Add `--browser-probe` to the walking check to measure a separate page throughout cold joining
and travel. That page submits one 64 x 64 WebGL frame at a time and polls completion without
blocking. Its RAF and GPU gaps appear under `browserPhases` in the report. With `--budget`,
startup must stay below one second and post-join gaps below 150 ms. The startup ceiling catches
multi-second browser-wide freezes; it is not a smooth-frame target. `--channel chrome` uses the
installed Chrome in a fresh test profile. `--trace-boot` starts the optional trace before navigation;
plain `--trace` still measures only after joining. Do not compare traced timings to acceptance runs.
Both walking and join-stability checks accept `--require-webgpu` to reject fallback rendering
and failed graphics preparation. Add `--menus` to walking to open and close the six dock
panels and full map through real input, asserting visible content and recording that phase's
frame and GPU completion intervals.
The walking check also captures the first ready frame, requires nearby building and creature
geometry with no pending entity or animation work, then sends movement immediately. `--budget`
requires movement within 250 ms. Startup duration is reported separately because the owner
accepts longer responsive loading; `--startup-budget-ms 20000` restores the earlier time limit
when explicitly requested. `--startup-timeout-ms` controls how long the harness waits to collect
that result and extends its overall deadline; it does not change gameplay or browser-stall limits.
A smooth empty
world or a connected session behind a blocking menu does not pass. `--authored` uses the existing
production test host; `--warm` reloads the same browser context with caches enabled. Report cold
and warm results separately. Network emulation applies to the asset origin; the authored socket
uses loopback without WAN emulation. Its initial frame sizes and arrival times are recorded.

`npx tsx tools/multiplayer-social-test.ts` runs a 60-second-budget, two-context Chromium check of proximity chat, party invitations, reduced kill XP, shared pile visibility and automatic item routing. The deterministic frog uses the production combat and loot systems. Browser input creates and joins the party, sends chat, attacks, and collects the same pile from both clients. Normal-camera screenshots and semantic reports are disposable under `test-results/multiplayer-social/`. After lab acceptance, `--authored` checks the same chat and party UI in the authored world within 120 seconds. Focused server coverage is in `tests/multiplayer-social.test.ts`.

For isolated public-action latency, add `--latency` to `tools/multiplayer-actions-test.ts`; it keeps the semantic assertions and omits screenshots. `--profile` also writes an observer CPU profile and slow shader-query diagnostics. `tools/multiplayer-motion-test.ts --crowded` exercises 144 remote actors, including the 2 Hz crowd publication path, and rejects backward motion or stationary gaps of 300 ms.

`npx tsx tools/multiplayer-actions-test.ts` runs two independent Chromium sessions through real melee, equipment, four basic spell elements, cancellation and observer effects. It checks that actions persist across heartbeats. Separate `--invocations`, `--activities`, `--interactions` and `--lifecycle` runs cover the action bar, area reticle, simultaneous casters, all gathering types, cooking, eating, campfires, bank transfers, four traversal kinds, shop transfers, dialogue choices, portals, concealed traversal/cancellation, incoming projectiles, and death/respawn privacy. Each run has a 60-second budget and records publication-to-observer latency, runtime errors, semantic changes and normal-camera screenshots in ignored `test-results/multiplayer-*` directories. State setup is deterministic; every tested action uses the production command session. The unit matrix executes all 36 production spells through the authoritative world and observer replication.

Local multiplayer launchers are checked with `npx tsx tools/multiplayer-launcher-test.ts` and `--prod` after `npm run build`. Each 60-second production-lab loop uses the launcher's real configuration injection, two independent Chromium contexts, explicit joining, replicated keyboard movement, listener shutdown and persisted character recovery after restart. No test world configuration is injected into the page. `--authored` runs the later authored-world wiring check within 120 seconds; use it only after the lab checks pass. Reports and normal-camera screenshots are disposable under `test-results/multiplayer-launcher-*`.

Add `--sustained` to alternate real keyboard movement and repeated ground clicks for 20 seconds, checking that commands are acknowledged and the connection does not restart. The report includes acknowledgement latency and RAF intervals. RAF timing measures browser scheduling, not GPU completion. `npx tsx tools/multiplayer-response-test.ts` measures an independent network client's 20-second movement workload against durable SQLite storage; add `--authored` after lab acceptance. Run that response audit separately from builds and browser gates. It reports server tick stages and wire latency, and does not certify 200-player capacity.

The sustained response check uses the documented p95 acknowledgement target of 250 ms. It also reports maximum acknowledgement and frame intervals; a percentile pass does not certify hitch-free cold shader/asset preparation.

`npx tsx tools/world-resource-check.ts` is the final-world tree and fishing integration gate, after the forest and fishing labs pass. It boots the authored world, so it keeps two budgets: `WORLD_BOOT_BUDGET_MS` (75 s) for reaching a playable world, and 88 s for everything it asserts after that. Boot is a property of the machine — it grows by about twenty seconds whenever the shipped navmesh no longer matches the authored sources and `systems/navigation.ts` regenerates the mesh in the page — and charging it to the gate's operation budget made a stale bake look like a resource bug. Pass `--url` to reuse a warm server, and `--forest-only` for the tree half.

`npx tsx tools/agent-proof.ts --run runs/<id> [--proof mining|quest] [--scale 8]` runs a scripted autonomous player through `window.corealm.agent`. It asks for control the way [the agent API](./agent-api.md) says to — `corealm_session {op:"request_control"}` from the page, Allow clicked on the production companion panel — because `agent/session.ts: guard` refuses every acting tool outside play mode. Both proofs in one run exceed the shared 270-second ceiling on a machine where the authored world takes forty seconds to boot; run one shard at a time, or raise `AGENT_PROOF_DEADLINE_MS`.

The combat and building labs are two modes of the same compact Fallowmarch yard. Both boot through `game/index.html`, the production renderer and `WorldScene`, and the normal asset, material, rig, animation, entity-view, effect, navigation, physics, and input paths. The yard is a 256 m by 256 m plains terrain with gentle relief and a 96 m by 96 m flat central build pad. It keeps edit feedback fast by leaving out the full authored island and its ordinary content. Optional fixtures add production foliage, forest gathering and persistence, or an enclosed fishing basin when those systems are under review.

### How a lab runs

The page draws the lab and the lab worker simulates it. `bootProfile.ts` still resolves `?mode=combat` and `?mode=building` to the feature-lab profile, and `boot.ts` still builds the scene the URL flags ask for: the terrain variant, the structure, the cave shell, the forest scatter, a fixture's entities. It then sends the worker a `LabFixtureSpec` (`featureLab/labSpec.ts`) and, once the scene is drawn, one `LabWorldData` (`worker/labProtocol.ts`), and joins the worker's `lab-<seed>` world the way `?play=local` joins the authored one. Everything after that goes through the session: input and UI are commands, `__gameDebug` writes are debug operations, and lab setup is a `lab.*` operation.

| The page sends | When | What it carries |
| --- | --- | --- |
| `LabFixtureSpec` | worker start | mode, seed, terrain variant, spawn, opening structure and creature, what the character starts with, which fixtures the worker hosts, the interest radius (400 m, the whole yard) |
| `LabWorldData` | once, before the join | terrain sampler data for the yard and the fairy realm, the cave spec, the baked navmesh, solids, walk-surface bounds, route graph, known locations, door barriers, habitats, forest trees, asset measurements, the agility course, and every entity that is not static scenery |
| `lab.world` | `setStructure`, an environment showcase | a new navmesh, solids and walk-surface bounds, entities removed and added |
| `lab.entities`, `lab.moveEntity`, `lab.setEntityState` | creature gallery, door workbench | entities placed, moved or switched by a render-side fixture |

Typed arrays are transferred, so the page hands over copies of what its scene still reads. The worker validates the shape of every message and operation at its boundary and refuses what it cannot read.

The lab operations are `lab.init`, `lab.world`, `lab.spawnTarget`, `lab.setLevel`, `lab.equip`, `lab.resetPlayer`, `lab.resetBank`, `lab.awakenAltar`, `lab.entities`, `lab.moveEntity`, `lab.setEntityState`, `lab.call`, `lab.view` and `lab.skipTicks`. `lab.call` runs one method of a fixture the worker hosts whole, because the fixture only ever wrote the simulation: the agility workbench, the regional tier, creature loot, quest recovery and gameplay acceptance fixtures. Their window names on the page are remote surfaces.

`__featureLab.getState().target.ai` is the enemy AI's runtime, which lives in the worker's shared world rows and is never replicated. The worker writes the target's onto the entity after each tick (`meta.labAi`), so it arrives in the same update as the health and position that tick produced.

`__gameDebug.reset()` and `loadSaveBlob()` rebuild the worker's world over the lab scene as it stands, structure included. The target actor is not part of the scene, so spawn it again after a reset.

`?mode=…&multiplayer=1` joins a server's lab world over a socket instead, and the bake and capture flags (`navmesh-bake`, `world-bake`, `world-map-capture`) draw a scene and leave. Neither starts a lab worker.

The shared setting matters. A structure seen in building mode and an actor or spell seen in combat mode receive the same terrain, daylight, fog, camera stack, and scene treatment. The labs are real game scenes, not separate Three.js turntables.

## Development loop

### Mobile runtime

`tools/mobile-runtime-lab-test.ts` checks sampled creature animation and real touch movement.
Add `--rigs` for constrained rig allocation or `--auto` for idle draw-distance stability.
`tools/render-latency-test.ts` checks bounded GPU submissions, current-pose recovery, and unchanged image
resolution through overload with real touch input. Add `--desktop` for keyboard input and desktop quality.
`tools/animation-preparation-test.ts` checks sliced imported animation preparation while touch movement continues.
`tools/player-interaction-test.ts --latency` separates input delivery, gameplay response and graphics completion.
The fixtures, production profiling commands and device limits are documented in
[Mobile runtime stalls](./mobile-runtime.md).

### Regional equipment and food

`?mode=combat&regionalTier=30` adds five production crafting stations and uses actual
equipment skill requirements. Values `40` and `60` select the other regional tiers.
`tools/regional-tier-content-test.ts --tier <level> --url <server>` checks recipes,
material consumption, experience, equipment requirements and carried-rod selection.
`tools/regional-fish-food-test.ts` uses the same options to check cooking requirements,
raw/cooked/burnt accounting and eating through production activities.
`tools/regional-tool-model-test.ts` adds `--kind pickaxe|hatchet|rod` for existing tool
reskins, resource changes and normal-camera evidence. Reports are disposable
under `test-results/regional-tier-content/` and `test-results/regional-fish-food/`.

### Regional music

`?mode=combat&music=1` adds a music workbench to the production yard. Buttons place the player
in Fairy, Fairy Mire, Plains and Castle music areas. The same audio director, engine and movement
tick used by the final world select and crossfade the attached MP3s. From Castle approach, walk
toward the yard centre to enter the 8 m area; walk beyond 11 m to leave it. The buffer prevents
boundary chatter. The workbench changes only the lab's region audio catalogue.

Run `npx tsx tools/regional-music-test.ts`, then `--world` for the authored regional mappings and
both Crownward castles. The browser check uses real keyboard movement, source URL history,
active loop state, decoded music output samples and error checks. Captures and reports are
disposable under `test-results/regional-music/`. The lab passed before final-world registration.
Castle music covers each authored footprint plus 20 m of grounds, with a further 5 m exit buffer.

### Crownward fishing

`?mode=combat&fishing=crownward` adds the production Crownmere/Pearlwater channel
fixture and fifteen fish schools. Trout requires Fishing 30, tuna 40 and salmon 60.
`npx tsx tools/crownward-fishing-test.ts` clicks each species from its dry bank and
checks inventory, depletion and water depth. After accepting the fixture, use
`--world` for the authored Crownward positions and a low-angle shoreline capture.
Evidence is disposable under `test-results/crownward-fishing/`.

### Mob spawn spacing

`?mode=combat&spawnSpacing=1&population=fairy` exercises the fairy garden factory with
four spriggles and three sporekin in one receiving floor. Run
`npx tsx tools/fairy-population-spacing-test.ts` for body clearance, movement and reset.
The fairy roster and guardian texture checks are documented in
[`art/fairy-population/README.md`](../art/fairy-population/README.md). After lab acceptance,
`npx tsx tools/fairy-population-world-test.ts --region gloamgarden --part gardens`
checks the authored populations; repeat for `faeholme`. The `npcs-1` and `npcs-2` parts
exercise three village conversations each within the world-test time budget.

`?mode=combat&spawnSpacing=1&population=stone` exercises the production resident budget
with Flint Mandibles, Blind Cave Weavers, Scree Watchers and hens. Karrowmoor applies
that budget to all live spawn sources before final placement: large bodies get 2–3
residents, medium bodies 4–5, small bodies 6–7 and tiny bodies 8–10. Measured height
also counts toward size, so tall narrow creatures cannot bypass the limit. Already
sparse groups and bosses retain their counts. Retained actor IDs stay stable on reset.
Run `npx tsx tools/mob-spawn-spacing-test.ts --stone`, then add `--world` for integration.

`?mode=combat&spawnSpacing=1` starts three deliberately crowded seven-member groups through
the production creature catalogue. The same final placement pass used by world boot and reset
spreads every source, including fixed habitat anchors, regional packs, coastal packs and caves.
Outdoor roots stay at least 6 m apart, with 5 m of body clearance for larger creatures.
Cave roots stay at least 5 m apart, with 3.5 m of body clearance. These gaps leave at least
2 m between bodies after both residents use their full idle wander radius. Already loose
packs vary their preferred positions by at most 4 m outdoors or 1 m underground before
falling back to checked receiving floor. Stable per-group and per-resident spacing variation
adds unequal gaps, and the fallback search varies its radii and angles. This avoids repeated
formations while keeping the same layout after reload and reset.
The Lit Gallery has a 24 m
radius to fit the residents without moving them across locked gates. Residents wander near
their own spawn rather than converging on shared patrol anchors.

Run `npx tsx tools/mob-spawn-spacing-test.ts` for the lab, then add `--world` for every live
spawn, real movement and deterministic reset. Run `npx tsx tools/dense-cave-lab-test.ts` for
the expanded receiving floor and both gates. Inspect the captures under the ignored
`test-results/mob-spawn-spacing/` and `test-results/dense-cave-lab/` directories.

`?mode=combat&denseCave=1` is the legacy encounter record, not a spacing exercise:
`featureLab/denseCave.ts` lays its six packs out against the cave's own receiving floor and door
partitions from `content/legacyEncounterPlacements.ts`, and boot leaves them there. Running the
habitat pass over them a second time re-places the same bodies with the generic minimum gap, and
the Cairn Hall compartment between the stone door and Ordrun's gate has no room for the seventh
Vault Custodian once that gap applies, so the lab refused to boot at all. `spawnSpacing=1` is the
route that exercises the placement pass.

Start with the smallest loop that can reject a bad change:

```bash
# Keep the relevant behavior tests alive while editing, for example forest residency
npx vitest tests/forest-resources.test.ts tests/forest-obstacles.test.ts

# Structure recipes, compositions, collisions, and asset references
npm run structure:contracts:watch

# Whole-catalogue geometry lint: floating, sunken, near-miss and card-thin parts
npm run structure:lint

# Combat mode on the persistent Vite server
npm run lab:preview

# Building mode on the same kind of persistent Vite server
npm run lab:building:preview
```

Both preview commands use port 4174, so run one at a time. A workbench change updates `mode` in the current URL, preserves every other query parameter and the hash, and performs a full document reload. Runtime state, spawned targets, movement, and unsaved panel setup do not transfer across that reload. Preview servers use HMR; tool-owned acceptance servers disable it so another worker's edit cannot interrupt a proof. Restart the server and reopen the document after dependency or Vite configuration changes.

### Persistent browser session

Use the persistent session while editing, capturing models, or investigating an interaction. It keeps one Chromium process and page alive and reuses the Vite server supplied by `--url`. Omitting `--url` starts a server owned by the session; closing the session stops that server. An external server is left running.

```bash
npm run lab:session -- --url http://127.0.0.1:4174 --route "/index.html?mode=combat&environment=1" --out test-results/rebuild-acceptance --compact
```

Wait for the tool's `type: "ready"` JSON line, then send one JSON command per line. Commands run sequentially and await loading and scene changes. Responses carry the caller's `id`, `ok` and elapsed time. `--compact` omits large results from terminal output; omit that flag for the original full JSON response. Both modes append every full command and response to `<out>/session.jsonl` as `{at, command, response}`, including errors. A command error produces `ok: false` and leaves the session available for diagnosis.

```json
{"id":1,"op":"call","surface":"environment","method":"showSite","args":["bracken_workings"]}
{"id":2,"op":"frameEnvironment"}
{"id":3,"op":"capture","name":"bracken-approach"}
{"id":4,"op":"spawn","kind":"creature","presetId":"redsill_cattle","distance":9}
{"id":5,"op":"call","surface":"lab","method":"perform","args":["attack"]}
{"id":6,"op":"sampleMotion","samples":12,"intervalMs":120,"captureFrames":[0,5,11],"name":"cattle-attack"}
{"id":7,"op":"errors"}
{"id":8,"op":"close"}
```

The available operations are:

| Operation | Purpose |
| --- | --- |
| `open` / `reopen` / `resetFixture` | Reload the current route, or a supplied `route`, and await readiness. This resets scene state while retaining browser and asset caches. |
| `spawn` | Prepare and spawn a production `npc` or `creature` by `presetId`, with optional `distance`. |
| `call` | Await a method on the `lab`, `environment`, `creatures`, `forest`, or `debug` surface. Supply `method` and an optional `args` array. |
| `frameEnvironment` | Fit a ready environment fixture with drawn bounds. `detail: true` uses the close inspection camera. Requires `environment=1` and a ready game. |
| `frameCreatures` | Fit a ready creature gallery with drawn bounds. Requires `creatures=1` and a ready game. |
| `camera` | Apply a named `shot` or explicit `pose` containing x, y, z, yaw, pitch and distance. |
| `input` | Send one `key` with optional `holdMs`, a `click` coordinate pair, or a four-coordinate `drag`. |
| `observe` | Read compact state, selected actor details, gallery/environment selection, metrics and events since the previous observation. Optional `entityIds` selects up to 64 entities. With a creature gallery, the default detailed entity is its first actor. |
| `waitForEntity` | Wait for a real entity `state` by `entityId`, with `timeoutMs` up to 30,000. Does not change simulation time or resource state. |
| `capture` | Capture a named PNG plus current observation. Each capture has a five-second deadline. |
| `sampleMotion` | Sample a fixed, nonempty set of production actors with motion state and drawn geometry; optionally capture up to six sample indexes. Rejects unavailable game state or document reloads. |
| `errors` / `close` | Read browser and game errors, or release the session's browser and owned server. |

Captures overwrite files under `--out`; the journal appends across sessions. The default `test-results/lab-session/` and all other `test-results/` paths are ignored. `--headed` shows the browser. The default session uses production graphics and requests hardware rendering, including ANGLE D3D11 on Windows. `--software` explicitly selects SwiftShader and reduced graphics for semantic checks; those captures are not production-quality visual evidence.

`--catalog <candidate.json>` serves staged, hash-checked GLBs through the production asset loader for that session. For ore work, generate candidates with `npx tsx tools/build-ground-ores.ts --out test-results/ground-ores`, then pass `--catalog test-results/ground-ores/ground-ores.json`. Restart the session after regenerating the candidate files. Promotion remains a separate step after lab acceptance.

For tree architecture, load one tree through `showFoliage()` and use the **Wood only** checkbox or `setFoliageWoodOnly(true)` to inspect its supporting limbs. This hides leaf meshes in the existing production fixture. Turn it off for canopy acceptance. `tools/forest-lab-test.ts --catalog <candidate.json> --url http://127.0.0.1:4174` also accepts staged models, so their normal click, gather and persistence paths can pass before promotion.

Read a large result without copying it through the terminal session, for example in PowerShell:

```powershell
Get-Content test-results/rebuild-acceptance/session.jsonl | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $_.command.method -eq 'getRenderProfile' } | ForEach-Object { $_.response.result | Select-Object calls, triangles }
```

`ok: true` means a command completed, not that its picture is accepted. A cold-boot error screen, `ready: false`, empty motion sample, or missing fixture provides no gameplay or art proof. Framing and sampling reject those conditions. Static model review uses `capture`; motion sampling accepts live, sampled and baked actor paths so a distant animation defect remains observable. Inspect `errors`, restart/reopen after dependency changes, and repeat the setup before recording acceptance. Do not catch a boot failure and continue the proof on the old page.

After an edit causes a document reload, use `reopen` and repeat the small setup command sequence. The session reports the document identity and resets its event cursor when that identity changes. It deliberately does not attempt to restore stale objects across HMR. Motion sampling rejects a document reload mid-sample. Filmstrip captures can extend sample intervals, so use recorded timestamps when assessing cadence. Advancing clip time proves activity, not animation quality: inspect contact, reaction, planted feet and continuity in the frames.

### Environment, foliage and cut face

The environment gallery uses original production models at native scale. `showGallery(assetId)` selects one model; `showGallery()` stages the full catalogue. `getCatalog()` exposes source paths and dimensions. `showSite(siteId)` uses authored mine/grove dressing and real gatherable resources. The panel exposes native pine, ash, oak, walnut, willow, maple, teak, yew, magic, fern and shrub foliage with grid/lane layout, count and span controls. Mixed groves use the supplied `variants` array through the production scatter path. The same detailed source geometry, wind and materials remain active at every visible distance. API changes update the panel's selection and foliage settings.

The owner rejected the blocky distance substitutes. Do not restore simplified far foliage or judge scattered foliage from model-gallery screenshots alone. Use `showFoliage`, move away and return, and compare actual colour submissions with `getRenderProfile()`. Inspect the branch silhouette, canopy gaps, leaf size and shading at both distances. Ordinary spatial culling remains separate from model detail.

Tree cutouts use alpha-to-coverage with a centred edge transition, mip filtering and anisotropic sampling. A final FXAA pass smooths the resolved image. `npx tsx tools/foliage-antialiasing-lab-test.ts --url http://127.0.0.1:4174` compares production pine, oak and willow at two distances, then resizes and returns. Each before/after pair is drawn synchronously without advancing wind or simulation. It checks identical scene submissions, one extra fullscreen triangle, softer canopy pixel contrast and unchanged flat sky colour; captures still require visual inspection. The same gate samples a 64-tree mixed grove with the pass enabled and disabled and checks real player movement. `getPerformanceTimings()` reports whole-frame, shadow and final-antialiasing GPU samples separately. `setScreenAntialiasingEnabled(boolean)` is a diagnostic comparison control; normal boot enables it.

Tree spray lighting uses the same upward normal on both sides of a card. The sun follows the view on a fixed shadow texel grid. Leaf RGB is associated with alpha in linear space before GPU mip generation, then recovered after filtering. Colour uses a wider texture footprint than coverage, preserving the authored alpha silhouette while reducing fine colour shimmer. Identical embedded atlases share one prepared GPU texture across model variants.

`npx tsx tools/foliage-motion-lab-test.ts --url http://127.0.0.1:4174` captures nine slow camera and wind sequences across pine, oak and ash. `sampleSurfaceTime(seconds)` samples production animation for the next synchronous render so camera motion can be tested at a fixed wind time. The normal frame loop resumes afterward. The gate checks stable tree submissions, actual filtered materials, MSAA coverage and shadow texel phase. It writes a replay under `test-results/foliage-motion-lab/index.html`. Inspect the sequences for colour flashes and retained canopy detail. Pixel changes and stable draw counts do not establish visual acceptance on their own. `setShadowStabilizationEnabled(boolean)` supports diagnostic comparisons; normal boot enables stabilization.

`npx tsx tools/foliage-distance-lab-test.ts --url http://127.0.0.1:4174` checks all 24 native tree variants and four fern/shrub models through near, far and return poses. It frames each tree's full crown outside the player's reveal footprint. It requires actual colour-pass triangle counts to match the served source, unchanged instance populations and bounds, loaded panel metadata, and no alternate far asset requests. Representative near/far screenshots still require inspection. `getRenderProfile("lab-foliage-")` filters draw rows before the diagnostic limit while preserving whole-frame totals. The one-instance distance check does not prove dense-scene performance. Use the 1,024-shrub fixture and identical cameras for that comparison.

```json
{"op":"open","route":"/index.html?mode=combat&environment=1"}
{"op":"call","surface":"environment","method":"showFoliage","args":["corealm_shrub_2",{"layout":"grid","count":1024,"span":96}]}
{"op":"camera","pose":{"x":0,"y":0,"z":14,"yaw":0,"pitch":0.5,"distance":15}}
{"op":"call","surface":"debug","method":"getRenderProfile"}
{"op":"capture","name":"shrub-density"}
{"op":"call","surface":"environment","method":"showFoliage","args":["corealm_fern_1",{"layout":"lane","count":12,"span":70}]}
{"op":"frameEnvironment"}
{"op":"capture","name":"fern-lane"}
{"op":"call","surface":"environment","method":"showCutFace"}
{"op":"frameEnvironment"}
{"op":"capture","name":"two-seam-cut-face"}
```

`showCutFace()` stages two production ore resources in a sloped cut face near `(70, 25)`, with matching extraction states and production collision. State reports mode `cut-face` and selection `two-seam-slope`. The fixture isolates seam geometry, contact and mining presentation. Debug-granted tools and API-started mining are setup/interaction diagnostics; record a real click and resource/inventory changes for pointer acceptance. Final-world terrain embedding, mine approach and navigation still need integration evidence.

### Forest and fishing fixtures

`forest=1` adds deterministic woodland lanes with the production forest descriptors, lazy entity activation, tree collision, gathering, save/load and respawn. The original oak/pine lane stays at x=20; an eastern lane at x=64 includes both maples and the other tree species to expose tier-material errors during activation. `window.__forestLab.getState()` reports residency and `getTrees()` returns the stable descriptors. A tree must keep the same trunk origin and authored materials through scatter, nearby interaction, depletion, leaving the area and returning. Run `tools/forest-handoff-lab-test.ts --x 64 --url http://127.0.0.1:4174` to walk the eastern residency boundaries.

```json
{"op":"open","route":"/index.html?mode=combat&forest=1"}
{"op":"call","surface":"forest","method":"getTrees"}
{"op":"camera","pose":{"x":22,"y":0,"z":12,"yaw":0.5,"pitch":0.45,"distance":16}}
{"op":"observe","entityIds":["feature-lab:forest:oak:4"]}
```

The ordinary environment workbench is dry, so its fishery site entries stay unavailable. Use `/index.html?mode=combat&fishing=1` for the separate translated Redsill fishery with a real carved basin, enclosed production water, four schools and dry casting positions. Fish do not belong on dry gallery ground. The fishing gate must prove the clicked school, dry-bank route and natural inventory receipt, then inspect underwater visibility and the bank view.

Root-owned browser gates:

```bash
npm run lab:creatures
npx tsx tools/forest-lab-test.ts --url http://127.0.0.1:4174
npx tsx tools/fishing-lab-test.ts --url http://127.0.0.1:4174
npm run lab:health-bars
```

These write ignored `report.json` files and screenshots under `test-results/creature-lab/`, `forest-lab/`, `fishing-lab/` and `health-bars-lab/`. Forest, fishing and health bars accept `--url` to reuse a server. The health-bars gate fights a cow at melee level 1 and checks the world-space bars `render/healthBars.ts` draws: one over the creature, one over the player, the fill equal to the creature's health ratio, the creature's bar anchored just above its drawn bounds through the reported camera, and no bars left once the fight is reset and the linger ends. Their reports distinguish debug setup from real input. The creature gate follows natural attack, flee, death and respawn behavior in its own lifecycle loop; it does not certify every creature's art. It also spawns all seven regional bosses and checks each wears the body `content/regionalBossBodies.ts` authors for it and draws at least half again the widest ordinary animal the same run spawned; the old absolute size bands (an Orb boss over 3 m, a miniboss under 3) went stale when the seven stopped sharing two rigs.

### Creature gallery

Terrain articulation uses the production skeleton after clip blending, on both live rigs and instanced animation palettes. Open `?mode=combat&creatures=1&terrain=slopes`, then use `__creatureGallery.show('slag_centipede_residents', 1)` and `__creatureGallery.place(-100, -80, 0)` for a segmented body crossing a change in slope. `place(x, z, yaw)` samples the production yard mesh. Check idle, walk, run and a return to flat ground; also inspect `open_march_goats` and `reedjaw_crocodile_residents`. These are isolated actor tests, so no world-authoring exception applies.

`__gameDebug.getEntityMotion(id).terrainContact` reports evaluated joint clearance and a sparse skinned-vertex sample. Joint error compares against the authored animation's clearance, so swing feet can lift; it does not assert that every vertex or every swing foot touches the floor. Inspect feet and the body silhouette in screenshots. Move the camera beyond 70 m to release a live rig, back into the 40–70 m band to inspect the sampled path, then within 40 m to check its return. Both colour and shadow passes must retain terrain articulation. `tests/terrain-rig.test.ts` covers twenty-foot crest contact, clearance, scale, yaw and repeated updates; the animation palette test compares actual skin vertices across independent terrain placements and return to an unmodified clip.

Add `creatures=1` to a combat-lab route for the compact creature acceptance grid. It starts with one cow near `(0, 70)`. The selector uses the production creature catalogue, and a count from 1 to 64 stages separate production entities with stable `lab:creatures:<preset>:<index>` IDs. Grid spacing follows the actual creature footprint. Ordinary AI does not move gallery actors; they keep their real meshes, rigs, animation clocks, rendering and distance transitions.

```json
{"op":"open","route":"/index.html?mode=combat&creatures=1"}
{"op":"call","surface":"creatures","method":"show","args":["highcairn_bears",1]}
{"op":"frameCreatures"}
{"op":"capture","name":"bear-textures"}
{"op":"call","surface":"creatures","method":"show","args":["open_march_goats",32]}
{"op":"call","surface":"creatures","method":"play","args":["walk"]}
{"op":"frameCreatures"}
{"op":"sampleMotion","samples":8,"intervalMs":120,"captureFrames":[0,7],"name":"goat-crowd"}
```

`play` accepts `idle`, `walk`, `run`, `attack` and `hit`, using the production renderer's motion methods. Walk/run are stationary cycle inspections, not evidence of physical travel or planted feet under movement. Attack/hit commands inspect articulation and blending; the combat lab remains responsible for hit timing, damage and AI commitment.

Without explicit `entityIds`, `sampleMotion` samples every staged gallery actor. Move the camera across the near/far transition and compare each actor's production motion path and phase; also inspect the filmstrip for pose jumps. A single close actor cannot prove crowd animation quality. Both gallery panels refresh changed selection state every 500 ms, including changes made through the APIs, and avoid rebuilding controls when state is unchanged.

### Scripted scenarios and acceptance status

`npm run play` distinguishes a diagnostic recording from an assertion-backed check. Existing recordings with only action labels and snapshots report `status: "diagnostic"` and `passed: false`. An action succeeding without throwing does not establish that movement, gathering or damage occurred.

```bash
npm run play -- --run runs/corealm-rebuild --scenario tools/scenarios/lab-movement.json --url http://127.0.0.1:4174
```

Scenario actions may include an `expect` array. Paths start with `before`, `after`, `initial`, or `result`; missing paths fail. Each expectation has exactly one comparison: `equals`, `gt`, `gte`, `lt`, `lte`, `changedFrom`, or `deltaFrom`.

```json
{
  "name":"keyboard movement",
  "route":"/index.html?mode=combat",
  "actions":[
    {
      "key":"w",
      "holdMs":500,
      "expect":[{"path":"after.playerPosition","changedFrom":"before.playerPosition"}]
    }
  ]
}
```

For an inventory receipt, an exact delta can be written as `{"path":"after.state.inventoryUsed","deltaFrom":{"path":"before.state.inventoryUsed","equals":1}}` when that interaction is expected to occupy one new slot. Stack quantities should be asserted from the relevant inventory/result field, since an occupied-slot count does not prove quantity conservation. A negative debug probe must specify its exact `expectError` code; unexpected structured tool errors fail the scenario.

Unknown actions, extra fields, malformed arguments and invalid expectations are rejected before boot. The runner stops at the first action/assertion failure. Browser errors, failed requests and game-recorded errors also fail acceptance. Reports use `passed`, `failed`, or `diagnostic`; only `passed` sets the `passed` boolean to true. The standalone CLI exits nonzero on `failed`; diagnostic recordings remain usable as recordings. Assertions certify only the outcomes they name. Screenshots and motion samples still require visual review.

The persistent session is the edit loop. Select integration checks using [the workflow](./feature-lab.md).

### Combat mode

`npm run lab:preview` opens `/index.html?mode=combat`. Use the lab controls to spawn production NPCs and creatures, choose equipment by slot, set presentation-only skill levels, select a spell, and exercise melee and spell effects. A deterministic production bank fixture near the yard spawn can be opened or reset from the Bank workbench. Its contents and carried inventory are published in lab state so transfer behavior can be checked without relying on a save. Walking, ground clicks, target selection, animation, damage, effects, and bank interaction still flow through the production game systems.

Editable skill values and direct equipment choices are test setup. They do not simulate progression, item eligibility, inventory acquisition, or persistence.

### Presentation fixture

Use `/index.html?mode=combat&presentation=1` or the **Add presentation fixture** link in either workbench. The optional fixture adds a gatherable Palewood tree and Grithe seam, a matching decorative tree, ferns, and grass through the production material and scatter paths. The bank fixture supplies a pickaxe and hatchet. Close the lab panel and click a resource to gather through normal navigation, tool checks, inventory yield, depletion, and respawn.

`window.__featureLab.getState().presentation` identifies the two resource entities and the scatter instance count. Compare the standing and depleted tree against its decorative copy, and inspect foliage under the same lighting used for actors and equipment. Disabling the fixture reloads a fresh yard. Ordinary lab routes and their existing fixture defaults remain unchanged.

For player visibility checks, frame the player at `(7, 0, 7)` with yaw `0`, pitch `0.42`, and distance `16`. The gatherable tree sits between the camera and player. Repeat at x `13` for the decorative tree, then reverse yaw to `Math.PI` to put the trees behind the player. `__gameDebug.getFoliageOcclusion()` publishes the projected body capsule; `setFoliageOcclusionEnabled(false/true)` provides a comparison switch. Hiding the player disables the opening automatically. Use keyboard movement and inspect both views to verify that the opening follows the player and leaves background trees intact.

### Building mode

For movement regression checks, append `terrain=slopes` to either lab URL. This deterministic
terrain fixture raises the yard's existing relief outside the central build pad. It uses production
terrain, navigation, physics, and movement. Use `groundHeight`, `getNavPath`, and player state to
verify uphill and downhill travel before testing authored world routes.

`npm run lab:building:preview` opens `/index.html?mode=building`. The building controls can select a prefab, composition, or wall run; change the plaster, timber, or stone regional kit; edit supported dimensions; step through variant seeds; and fit the production camera to the result.

Prefab width and depth are whole metres from 2 through 30. Compositions have authored dimensions, so their size controls are disabled. Wall runs follow the production two-metre module grid. Their total width is an even value from 6 through 30 m. The field labelled `Opening` is also even, starts at 2 m, and stops at `width - 4`, leaving at least one two-metre wall module on each side. Dimension values entered in the panel or URL are clamped and snapped to these supported ranges before a recipe runs.

### Production structure and collision path

Prefabs, compositions, and wall runs use the production recipes. Recipe parts become the same semantic structure entities consumed by the normal `EntityViews` renderer, with the selected regional material context. A composition can also have a separate semantic hero asset that its authored world recipe expects, such as the arch paired with a region gate. The lab adds that hero beside the composition dressing instead of showing the dressing alone.

Prefab and wall-run collision comes from their production collision recipes. Composition collision is measured from collidable recipe parts and any solid hero asset. On every rebuild, the lab prepares assets through `EntityViews`, replaces the semantic structure entities, refreshes obstacle-carve objects, rebuilds the terrain heightfield and static physics boxes, and gives direct movement the resulting production solids. The browser gate checks emitted collision metadata and a ready debug state. It does not prove that each replacement carve was baked into the navmesh or that every collision face blocks the player.

The published `partCount` is the number of rendered semantic structure entities, including a separate composition hero when one exists. `collisionCount` is the number of emitted solid volumes. Neither value is a visual-quality judgment.

### Building view controls

Building mode has three independent checkboxes. Its defaults are player visible, `Walk in yard` off, and `Free camera` off.

- `Player visible` changes only whether the production player rig is drawn. It does not move the player, change walking, or change the camera mode.
- `Walk in yard` controls player movement input. When it is off, the input controller stops any current route, clears held movement keys, and ignores WASD, arrow-key movement, ground-click movement, and `Walk here`. Hover, selection, inspection, camera gestures, and panel keybindings remain available. When it is on, normal camera-relative WASD, arrow controls, and click-to-move are active.
- `Free camera` detaches camera focus from the player without moving or hiding the player and without changing walking. Right-drag orbits, middle-drag pans, and the wheel zooms. Turn it off to return to the normal player-follow camera.

The controls may be combined. For a normal game-scale check, leave the player visible, turn walking on, and keep the follow camera. For structure inspection, turn free camera on, then hide or show the player as a scale reference without changing the camera focus. Walking can remain on while the camera is detached, although the camera does not follow the moving player in that combination.

Rebuilding a structure stops movement and resets the player to the yard spawn. In free-camera mode, `Fit structure` targets the rendered structure bounds without relocating the player. With free camera off, the normal player-follow camera owns focus.

A structure rebuild preserves the selected workbench and publishes its normalized selection, revision, bounds, entity count, asset count, collision count, build time, and errors through `window.__featureLab`.


## Geometry lint and the structure sweep

Two commands sit between the focused tests and the browser gate. Neither renders anything the game
needs; both are review instruments and their output is disposable.

```bash
# Every recipe, every shipped footprint, kit and variant seed, measured against the GLB manifest
npm run structure:lint
npm run structure:lint -- --only "composition region_gate" --kind FLOATING

# Photograph the whole catalogue in the building lab, four orbit poses each
npm run structure:sweep
npm run structure:sweep -- --out test-results/my-sweep --group composition --angles a-front,c-eye
```

`structure:lint` turns every `PartPlacement` into a world-space box using each asset's measured
`size` and `base`, then reports the defects that need no opinion: a connected group of parts that
never reaches the ground (`FLOATING`), a part drawn entirely under the ground plane (`SUNKEN`), two
load-bearing pieces that line up on two axes and stop short on the third (`NEAR_MISS`), a
near-zero-thickness plane used where the recipe wants mass (`THIN_PLANE`), stacked duplicates
(`DUPLICATE`), and assets the manifest does not ship (`MISSING_ASSET`). Contact is decided on the
axis-aligned envelope of each rotated box, so it is deliberately generous and will not claim a gap
a rotated part actually closes. Composition dressing is linted together with the hero mesh the
world pairs it with, because half of a composition leans on that hero.

`tests/structure-geometry.test.ts` runs the same checks as a contract, with one documented
allowlist entry: `vault_door` is authored against the Coldbrace vault tower, which is a separate
building, so its braziers and banners have nothing behind them in isolation.

`structure:sweep` boots one Vite server and one Chromium page in `mode=building` and walks the
whole prefab-variant, composition and wall-run space through `window.__featureLab`, capturing four
poses per selection into `test-results/structure-sweep/` plus a JSON manifest of bounds, part
counts, collision counts and errors. `--shard 2/4` lets several sweeps share one output directory;
keep the shard count low, because each shard is a full software-rasterised renderer.

Note which way the lab faces. `fitStructure` frames from `bounds.min[2]`, the **-Z** side. Closed
prefab rings enter at -Z, so that is their door; `forge`, `porch`, `arcade` and every composition
author local **+Z** as their approach, so for those the fitted view is the back and the sweep's
`b-rear` capture is the front.

## Scope boundary

The current labs intentionally omit expensive world systems. Add deterministic fixtures for isolatable feature logic and presentation rather than treating these omissions as permanent exceptions. Passing the labs does **not** prove:

- final-world terrain placement, biome blending, water, scatter, or world layout;
- the island navigation mesh, long-distance pathfinding, final collision integration, or final-world physics behavior;
- final progression, equipment eligibility, inventory acquisition, economy, persistence, or simulation integration;
- interactions that depend on several full-world systems at once.

Building-lab walking and free camera are presentation and local input checks. The gate proves that real keyboard input moves the player only when walking is enabled, and that free-camera orbit and fit can change framing without moving the player. It also checks that the selected structure remains stable and the prefab and wall run emit non-empty collision metadata. It does not walk the player into a wall, through an opening, or around every recipe. It does not prove replacement navmesh carving, collision blocking, final-world navigation, physics, terrain placement, or collision behavior. Test those systems in their focused source tests and with a small number of representative final-world scenarios.

Use lab fixtures to prove the local logic, UI, and interactions for progression, inventory, equipment, quests, economy, persistence, and simulation work. The final world must still prove that real authored data and cross-system flows connect correctly. A feature is accepted only when its lab proof and relevant integration proof both pass.

## Biome atmosphere

Open `/index.html?mode=combat&presentation=1&atmosphere=1` to compare the five production
biome color grades against a neutral reference using the same foliage, building and player.
The bottom selector changes the shader target; transitions settle over roughly one second.
The grade preserves black and white, uses separate shadow and highlight tints, and excludes DOM UI.
Each region also blends a procedural sky, slowly drifting cloud cover, and fog colour and range.
The sky horizon and terminal fog share one colour throughout transitions. Haze distances scale down
with the selected draw distance. The lab's sky state reports current horizon, cloud cover and fog range.
`window.__biomeAtmosphereLab.getState()` reports the selected preview and live shader uniforms.

Run `npx tsx tools/biome-atmosphere-test.ts` for selector, resize and shader-state checks.
After lab acceptance, `npx tsx tools/biome-atmosphere-test.ts --world` checks organic field wiring,
regional travel and keyboard movement. Captures and JSON go to ignored `test-results/biome-atmosphere/`.
Inspect the captures separately. `window.__gameDebug.getBiomeAtmosphere()` exposes world weights and
live uniforms. Surface grades follow the existing organic field at the player; Gravelmaw uses the
player's dungeon membership. Map captures retain their ungraded geographic overview.

## Elemental spell range

Run `npm run lab:spells:preview`, or choose **Open 24-spell range** in the combat workbench.
The route is `/index.html?mode=combat&spells=1`. The dedicated preview uses port 4178 so the
ordinary lab can remain open on 4174. Each of air, water, earth and fire has one basic spell and
five advanced attacks, progressing from precision strikes to large area attacks. Each entry includes damage, timing, hit area,
status effects and a specific observation cue.

**Reset & cast** restores eleven 1,000-HP dummies and fires the selected spell. **Next** and
**Previous** select within the current element filter without casting. **Auto-cast basic** repeats only the selected basic spell; it is disabled for advanced spells. **Slow motion** runs at 35% speed, and **Reset view** restores the player-follow view.
Walking and normal camera orbit/zoom remain available. Casts originate at the player's current
position. Camera acceptance uses only gameplay-reachable angles and the normal 6–11 m zoom,
with no detached focus or authored-distance override. Large attacks are judged from that view.
**Reset targets** cancels pending damage and stops repeating. T5 is the aim point. Labels show
real dummy health and status, while the panel totals resolved impacts, target hits and damage.
**Show hit areas** adds diagnostic radius guides; they are hidden during ordinary visual review.

The range mounts the production spell action bars (`ui/spellActionBar.ts`): up to four strips of eight square slots, three shown here by default with all twenty invocations and four basics bound. Keys **1-8** drive bar one, **Shift+digit** bar two and **Alt+digit** bar three; bar four is pointer-only. A targeted invocation casts once and locks every slot until it resolves, with the remaining lock swept over its slot. An area invocation (rank 2 and up) opens the ground reticle instead: the ring follows the pointer at the invocation's footprint radius, turns red beyond the 15 m spell range, and a left click places the cast; right-click or Escape cancels. Slots take spells by drag from the spellbook or another slot, right-click clears one, and dragging a slot off the bars empties it. The grip drags a bar anywhere; its **⋯** menu docks it bottom, left or right, flips its orientation, locks the slots, and shows or hides bars two to four. Layout persists per surface in `localStorage` and clamps after a viewport resize. `window.__spellRange.aiming()` reports the invocation being placed and `castAt(point)` places it without a pointer.

Direct projectiles target 75% of rendered creature height. Ground area attacks retain their ground contacts. The ordinary combat lab exercises the same basic renderer against actual creature bounds.

The range uses `content/elementalSpells.ts`, `systems/elementalAttacks.ts`,
`render/elementalSpellVfx.ts` and the reusable training-dummy view. Geometry and damage read the
same pulse positions and deadlines. The lab adapter owns fixture setup and controls. These new
advanced attacks are not yet registered in authored-world progression. The existing sixteen fuel-based auto-cast entries use the four basic recipes at four strengths, preserving progression and combat rules.
Statuses are visible on stationary dummies; this fixture does not prove enemy movement AI under slow or freeze.

Presentation uses small instanced 3D particles, moving pressure and liquid surfaces, spatial
noise on dissolving volumes and shaded stone. Water is liquid throughout, with no freezing attacks. Multi-hit vortices share one
continuous visual field. The caster gesture, projectile, impact and residue are inspected at
their own phases. An original grayscale flow mask adds fine turbulence, erosion and moving ridges to curved 3D surfaces. The texture is not a whole spell image or a camera-facing attack card.

Air bends the scene through moving pressure shells and sculpted currents. Air Needle has a
pointed, twisting dart; Razor Crescent has three banked blades with different curves and tilts;
Vacuum Coil has a low inward spiral eye; Thunder Lance drives one continuous corkscrew down
the lane; Skybreaker is the broad tornado. Eroded current edges carry blue-violet emission,
with fine circulating motes. Large air attacks add dark dust, smoke-like haze and tiny circulating grit for contrast; simple wind shots stay clean. There are no large flying rocks.
Water uses flowing, refractive bodies, moving crests and falling droplets. Fire has irregular
flame tongues with shaded crimson bodies, isolated hot emission, independent flutter and rolling black smoke. Smoke is spatially sampled inside bounded twelve-triangle proxies. Earth uses
shaded stone, cool mineral emission, fine chips and dense dust. Flint Shot and Siege Boulder separate their own connected geometry into 72 and 180 pieces. Faultline, Basalt Jaw and Mountainfall each have a distinct continuous formation.
Fine particle sizes are preserved. The later earth request supersedes the earlier request
to preserve its palette and emission settings.

Skybreaker has an approximately 11.4 m ground-contact diameter, broad rotating wind layers and
smaller rotating vortices at its base. Loose elevated currents form a neck as it descends, while ground currents gather beneath it. Damage resolves inside the continuous wind; no separate expanding pressure pulse is drawn. The 4.95-second sequence ends with independently scattered debris falling and settling after the wind fades. Ground currents keep the build visible when the crown is above the gameplay view.
Vacuum Coil instead stays below 3.2 m with an open eye. Authored contact
recipes vary stream bends, width, depth, height, partial arcs, plume count, splash direction and
debris distribution. Area spells start contact within 1.1 seconds, except Deluge at 1.21 seconds. Water and earth have longer gathering windows before their final inward collisions at 1.55 and 1.91 seconds. The rank-five finales run for 4.30 to 4.95 seconds, including their slower aftermath. `content/elementalTiming.ts` maps the authored motion beats to the same clock used by damage and the action bar. Deluge uses a thick curling teal surf front with moving foam, dense wave bellies and broken lips, then unfolds into torn splash sheets and falling spray. Its opaque circular pool is removed. Mountainfall draws seven jade currents around five narrower stone anchors, topples them inward, and releases 64 small chunks through an upward mineral glow. Solid chips are sparse among the luminous grains. Fragment landings use the terrain plane; their shadow transforms and fade follow the pieces. Sunfall has one accelerating sun and one fast gas expansion, followed by uneven rolling fire and drifting smoke. Fire bodies, sheets and gas volumes use a dedicated rising flame texture with dark red folds and narrow hot edges. Independent texture scale, shear, offset, speed and warp break up repeated patterns. The repeated radial lashes and pillar array are removed. Deluge contacts follow three shrinking rings; Basalt Jaw's two
walls have different rock profiles. Moving light follows the existing material detail on wind,
water, flame and mineral surfaces.

Fire curves and sheets use three independently cropped texture regions blended on a moving triangular grid, with open folded plumes and eroded crowns. Sunfall's blast now uses one continuous 3D combustion field instead of repeated fronts, tongues and gas pockets. Seeded spatial noise drives rolling fuel and temperature, followed by red cooling and soot. One twelve-triangle proxy contains the blast, with a shared 256 KiB noise volume and up to 96 GPU samples per ray. Its repeated corona loops are replaced by one torn wake. Furnace Whip uses one 576-triangle ribbon following its tip through the existing six contacts, followed by cinders. Deluge's upward blast uses eight unjoined, unequal lobes within the same 2,880-triangle budget. Their crests curl outward and down from different roots, with spray released from each moving crest. This replaces the tall cone while preserving the heavy liquid, inward collision and accepted timing. Current evidence and measured costs are in [verification](../runs/elemental-spell-range/verification.md).

Breeze Puff, Water Bead, Pebble Toss and Kindle are labeled **Basic**. Each has a single hit
within 0.9 m, arrives in under 600 ms and uses fewer than 500 live particles at the lowest strength. The **Basic strength** selector provides Lash, Bolt, Burst and Surge, increasing body size and particle density. They use the same
production flow, refraction, emission and fracture systems as the larger attacks.

`render/elementalRefraction.ts` shares one scene-color copy among active wind and liquid
meshes on layer 29. The pass retains the world depth buffer and restores renderer state.
It runs after the world draw and before atmosphere, glow and antialiasing. With no active
sources it skips both the copy and draw. Refraction changes neither camera pose nor focus.

`render/magicGlow.ts` isolates emission in an antialiased HDR buffer with scene depth, applies
bloom, and composites it without washing the edge colors to white. Pure energy is drawn once
through this buffer. Lit flame bodies, stone and textured flowing surfaces contribute only their emission to bloom;
refractive water surfaces remain in the scene pass. Four pooled point lights illuminate
nearby targets and ground with per-element gains. Air uses none. With
no active spell sources, the glow pass does no GPU work and leaves the frame unchanged.

Run `npm run lab:spells:test -- --element wind`, then the `water`, `earth` and `fire` shards.
Each shard owns a 60-second deadline and uses real pointer casts, before/after health, impact
counts, reset and effect cleanup. `--url` reuses a running server. Reports and six captures per
element overwrite ignored `test-results/elemental-spells/`; inspect the captures separately.
`window.__spellRange.getState()` exposes the live evidence without altering combat time.

For motion review, run `npx tsx tools/elemental-spells-motion-test.ts --spell starfall --url http://127.0.0.1:4178`.
The 60-second loop uses the actual Slow motion checkbox, captures six phases of a live cast (eight for boulders, including intact pre-contact and breakup; eleven for finales, including formation, pre-impact, impact flash and settling),
checks delayed damage and cleanup, and records the normal follow camera with each observation.
Deluge adds three collision, rebound and breaking-spray captures for fourteen frames per view.
Add `--contacts` to capture each distinct impact time as well, for repeated-hit variation review.
Add `--orbit` for a second view reached by the ordinary right-mouse camera drag, within the same gameplay limits.
Open the ignored `test-results/elemental-spells/motion/<spell-id>/index.html` to inspect the
sequence. The script accepts any of the 24 spell IDs and never advances time through a debug API.

The spell range uses instanced 3D particles, lit stone, curved water volumes, and
spatially sampled effect shaders. Tapered 3D energy bodies define the main attack shapes above the fine particles.
Its state includes live particle, strand, body, solid and volume counts,
particle, strand and body overflow, and CPU update time. The per-element gate records actual frame intervals,
peak populations and GPU submissions, and rejects overflow. Particle storage is
bounded at 48,000 luminous motes, 16,000 fragments and 3,000 smoke particles; these are capacities,
not populations emitted by every attack. Connected energy segments share a 4,096-instance pool.
Each particle batch uses one draw call per pass.
Deluge's foam and spray use a separate 30,000-particle liquid batch. Its eight-triangle
droplets have smooth shaded normals and specular highlights, normal blending and no bloom.
The batch is included in particle/overflow counters and clears with the other effects.
Launch data is cached once; only motion and draw attributes update each frame. The water
casting gate checks that the collision droplets submit to scene color instead of HDR emission.
Its collision uses one turbulent refractive liquid volume with twelve proxy triangles,
a shared 256 KiB spatial-noise texture and up to 56 samples per ray. Eight tapered
currents wrap that volume within the existing 2,880-triangle splash budget. Clockwise
circulation carries from the inward waves through the collision into released spray.
The volume writes sampled liquid depth and contributes to the principal-body count.
Sunfall's explosion now has lower optical density and irregular clear gaps through its gas.
The main energy bodies use an instanced batch per element with a 256-body capacity; air
instead uses three pressure batches of 96 each and four current shapes with 64 instances each.
Each current strip has 384 triangles, draws depth-tested refraction and contributes only its
emissive detail to glow. Water adds bounded wave, jet and droplet
batches. Textured impact bands, shells, plumes and funnels each use a bounded 96-instance batch with 576 triangles per surface. The browser gate requires principal shapes during every spell and zero dropped
bodies, as well as the particle and strand checks. Air and water must activate refraction.

Run `npx tsx tools/elemental-glow-test.ts --url http://127.0.0.1:4178` for the HDR regression.
It checks that idle frames are identical with glow enabled or disabled, compares two synchronous
renders of a live cast without moving the camera or advancing combat time, checks visible colored
glow, resizes the viewport and resets the cast. Captures and state go to the ignored `glow/` subfolder.
This pixel comparison checks the rendering contribution; ordinary live casts and screenshot review
still determine visual acceptance.

The glow command also accepts `--spell vacuum-coil` for the air-current material. It selects
the requested spell and compares emission shortly after the first impact, writing into
`test-results/elemental-spells/glow-vacuum-coil/`.

`npx tsx tools/magic-glow-compile-test.ts --url http://127.0.0.1:4173 --channel chrome`
is the small native GPU probe. Use the existing Vite source server. It checks emitter-only
preparation, visible halo pixels and opaque-wall occlusion using asynchronous texture readback.
Add `--scenery` to verify shared native shader graphs across cluster capacities, independent
matrix/color buffers, visible placements, updates and surviving buffers after cluster disposal.
Its diagnostic camera is not gameplay or art acceptance; inspect a live spell in the lab too.

Run `npx tsx tools/elemental-refraction-test.ts --url http://127.0.0.1:4178` to compare air
and water with refraction enabled and disabled in synchronous renders. It checks visible
pixel changes, unchanged foreground outside the effects, one shared scene-color copy,
viewport resize, camera preservation, idle equivalence and cleanup. Captures and state go
to the ignored `refraction/` subfolder; inspect the live phase captures as well.

Add `--orbit` to the motion command to review a second view reached by actual right-mouse
dragging. It retains player-follow focus and verifies the same gameplay pitch and zoom limits.

Additional focused browser checks:

- `npx tsx tools/basic-spell-variants-test.ts --element wind --url http://127.0.0.1:4178` (repeat for water, earth and fire): four strengths, rising/apex/descending flight captures, one target, growing density and cleanup. All sixteen basics share `render/basicSpellPath.ts` between their elemental body, luminous wake and particles. Distance scales arc height; release, contact height and hit time are unchanged.
- `npx tsx tools/basic-spell-combat-test.ts --url http://127.0.0.1:4178`: normal auto-cast integration for all four elements, scaled creature contact and health changes.
- `npx tsx tools/spell-action-bar-test.ts --url http://127.0.0.1:4178`: three default bars, slot and hotkey casts across bars, the cast lock, the ground reticle for an area invocation with a placing click, right-click clear, drag-to-bind, docking, free drag, reload and resize.
- `npx tsx tools/spell-world-bar-test.ts --url http://127.0.0.1:4178`: the ordinary combat lab with real Essence and runes: the spellbook's Basic and All filters and rune shelf, binding by drag, a standing basic through the bar, a targeted invocation spending its Mind Rune under the cast lock, and an area invocation placed through the reticle spending its Chaos and Cosmic Runes.

Browser gates run against a dev server. When another editor is saving files in the same checkout, start a second server without hot reload so a save cannot reload the page mid-test: `npx vite game --config game/vite.nohmr.config.ts --host 127.0.0.1 --port 4179 --strictPort` and pass `--url http://127.0.0.1:4179`.

### Terrain contact regression

`npx tsx tools/verify-grounding.ts` opens the production slope yard with
`?mode=combat&terrain=slopes&footing=slope`. The `footing=slope` fixture moves the player
and ordinary target spawns off the flat build pad. It samples a pursuing goat's semantic
and drawn positions against the terrain, checks initial player contact, and sends real
WASD input after clearing workbench focus. Reports and screenshots go to
`test-results/grounding/`. Screenshots still require visual review; root contact does not
measure individual animated feet.

Add `--world` to check traversal and capture the coastal foothills, Ember foothills,
Highland ridge, woodland seam, and Marchfield after lab acceptance. World terrain and
biome placement use the authored-world exception. `tools/verify-slope-traversal.ts`
also accepts `--route` for the slope lab and checks navigation completion in both directions.

### Glowing spell motion

The spell range stages the production Marchhide mage kit and wooden staff through `FeatureLabApi.equipPlayer` in transient state. `CharacterRig.castingFocus` follows the authored weapon socket, with a hand fallback. Cast speed follows the selected spell and slow-motion setting.

The repeated inscription layer was removed. `ArcaneSpellVfx` now composes tapered emissive swooshes, small casting foci and fine particles. Flying mineral and water cores sit inside brighter magical wakes. Earth and fire fields distribute their bursts across the footprint, while the wide Skybreaker tornado retains its scale. Curves use 288 triangles, the existing flow texture and isolated HDR emission. Body and particle counts stay inside the existing pools; the four starters keep their small-effect budgets. See [the current art direction](../runs/elemental-spell-range/art-direction-review.md) and [verification](../runs/elemental-spell-range/verification.md).

### Multiplayer crowd comparison

Crowd geometry uses the same equipment materials and sampled GPU animation batches as detailed actors. Each material region is reduced with a bounded geometric error and skin-weight constraints, then all surviving vertex attributes are compacted together. Small parts and skins exceeding the simplifier's attribute limit retain their source geometry. Prepared meshes live with the cached appearance batch; the nearest 32 players retain full geometry. Both detail levels cast animated shadows, with crowd shadows using the reduced meshes so changing detail does not remove the shadow. The crowd lab checks shadow-casting batches before and after detail changes, reports source and reduced triangle counts separately from renderer totals, and checks lazy generated armour trims as well as imported pieces.

For a production comparison, build the game and run `npx tsx tools/multiplayer-perf-audit.ts --production --armour --out=test-results/crowd-reduced`, then run it with `--full-geometry --out=test-results/crowd-full`. The second invocation creates a disposable production build that bypasses only mesh reduction. It keeps crowd animation, materials, shadows and selection identical. Both runs measure 15 seconds of crowded frame timing after warmup and use 999 synthetic server actors with one real browser. They do not certify network capacity or cold mesh-preparation latency. Compare the same hardware and settings with other rendering workloads stopped.

`npx tsx tools/multiplayer-motion-test.ts --menu` uses `worldMenu=1` to mount the production world list in the lab's main menu. It checks full, unavailable and incompatible entries, refresh, modal focus, explicit join, return to gameplay and leave, and captures desktop and phone layouts. Ordinary multiplayer lab fixtures retain their direct controls for the focused gameplay gates.

The motion gate also exercises eight repeated left clicks and a held-button cursor slide with 64 remote actors present. It records the player's rendered trajectory, checks continued travel and bounded frame displacement, and verifies that hover/left click ignore players while right click exposes their name, level and menu. Player trading remains unavailable.

`npx tsx tools/multiplayer-motion-test.ts` checks remote movement in the same production lab with 64 armoured server actors. It samples the rendered position during steady server movement and rejects backward jumps across network updates. The 60-second gate saves frame samples and a screenshot under `test-results/multiplayer-motion`. This is rendering correctness evidence, not network capacity evidence.

`npx tsx tools/multiplayer-crowd-test.ts` runs a focused 60-second-budget production lab with one browser and 320 server fixture actors. The multiplayer fixture exposes a Simplify crowds checkbox. The gate checks 256 selected actors, 32 detailed actors, continuous sampled animation, detail reassignment through real keyboard movement, toggle recovery and leave cleanup. The fixture now wears bronze, steel and blue armour with weapons. It verifies actual rendered material names and tier treatments, equipment changes, and preserved gear through detail changes. It compares triangle submissions at the same camera after movement, and saves detailed/simplified screenshots under `test-results/multiplayer-crowd`. The metric snapshots include warmup, so their instantaneous FPS is not steady-state performance evidence. Use the separate authored production audit for frame timing.
