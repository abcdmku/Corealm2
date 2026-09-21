# Development and acceptance loop

Use the smallest existing check that can reject the change. This file owns testing policy.
[Lab reference](./lab-reference.md) describes existing fixtures and specialized diagnostics;
search it for the feature you need instead of reading it as a checklist.

## Everyday commands

| Task | Command |
| --- | --- |
| Keep the production game and lab available | `npm run dev` |
| Keep one browser alive while editing | `npm run lab:session -- --url http://127.0.0.1:4173 --compact` |
| Run a focused regression | `npm test -- tests/<name>.test.ts` |
| Watch that regression while editing | `npm run test:watch -- tests/<name>.test.ts` |
| Typecheck, validate content, test changed dependencies | `npm run check:fast` |
| Full unit suite, content validation, game and guide builds | `npm run check` |

`check:fast` uses Vitest's Git change selection against the working tree. It is not a
release gate or a coverage guarantee: data read from disk and dynamic dependencies may
not be selected. Run new tests and data-dependent regressions explicitly. For changes
already committed, use `npm test -- --changed <base-ref>` or name the affected tests.
A clean tree can select no tests. Typechecking and content validation still run.

## One edit loop

1. Choose the existing test and lab fixture before editing. Read only the relevant source.
2. Keep one Vite server and one lab session alive. The session can open combat, building,
   or authored-world routes without launching another browser. Use `reopen` after a reload
   and repeat the small setup sequence; cached assets stay available.
3. Run focused tests for changed behavior. Use production input and compare semantic state
   before and after the action. Inspect screenshots for visual changes and check errors.
4. Accept the lab result before wiring a new isolatable feature into authored content.
   Then check one representative final-world interaction if integration changed.
5. Run typecheck and relevant validation once when the patch settles. Build once when
   production code, content, assets, or build tooling changed. Docs-only edits need link
   and command checks, not a game build. Stop after relevant checks pass.

Start with the session's default presentation fixture. Change routes in the same session:

```json
{"op":"open","route":"/index.html?mode=combat&creatures=1"}
{"op":"input","drag":[500,400,700,430],"button":"right"}
{"op":"observe"}
{"op":"input","key":"w","holdMs":500}
{"op":"observe"}
{"op":"errors"}
{"op":"close"}
```

The loading screen now always shows the world picker, so an authored-world route has to say
that it means the single-player game: open `/?play=local`, or `/index.html?play=local&…`.
`GameDriver.open` in `tools/lib/driver.ts` adds `play=local` to every route that does not
already carry a `play` target, which covers the harnesses that go through the driver. A
harness that calls `page.goto` itself adds it. Lab routes (`?mode=combat`, `?mode=building`)
need nothing: `bootProfile.ts` resolves them to the feature-lab profile, and boot never
builds a picker for that profile. `?play=<providerId>/<worldId>` is the other spelling, for
a harness that wants a specific world joined as soon as the first frame is drawn.

Local play runs in a Web Worker: the page renders and predicts, and the world lives in the
worker, joined over the same session a socket uses. `?play=local` joins it as soon as the first
frame is drawn. A page with no server to offer joins it on its own when loading finishes.
`getState().ready` is true once the local world is joined and its first snapshot is what the page
shows. The page has no simulation of its own in any mode. One escape hatch:

- `?local=memory` runs the worker and stores nothing. Use it when a harness opens several
  pages in one browser context: the stored local world belongs to one tab at a time, and a
  second tab is told so instead of being let in.

`window.__gameDebug` methods that change the simulation, or read the world beyond what is
replicated to the page (48 m around the player), return promises. The list is
`game/src/debug/asyncMethods.ts`. Each promise resolves only after the page's own state shows
the effect, so this needs no wait between the lines:

```ts
await page.evaluate(async () => {
  const debug = window.__gameDebug as any;
  await debug.giveItem("grithe_ore", 5);
  await debug.teleport({ entityId: "coldbrace_bank" });
  return { used: debug.getState().inventoryUsed, at: debug.getPlayerPosition() };
});
```

### Labs run in the lab worker

A feature lab is the same worker, started with the `lab` fixture. The page reads the URL flags
into a `LabFixtureSpec` (`game/src/featureLab/labSpec.ts`, a pure function with a unit test for
every mode), draws the lab scene, and then describes the world to the worker once: the terrain
sampler, the baked navmesh, collision solids, walk-surface bounds, route graph, door barriers,
habitats, forest trees, asset measurements and every entity that is more than scenery
(`LabWorldData` in `game/src/worker/labProtocol.ts`). The worker builds its world from the spec
and that description and simulates it. The page never simulates: it has no tick to run. A lab
page installs the full catalog the build publishes for the worker, because it assembles whole
entities to send; the authored game page installs only the client catalog. A lab always uses the
in-memory store, so it starts clean and
writes nothing to IndexedDB or to the old `corealm.save.v1` save. Lab routes still need no flag.

`window.__featureLab` follows the same rule as `__gameDebug`. Methods that change the simulation
return promises that resolve once the page's replicated state shows the change: `setStructure`,
`fitStructure`, `spawnTarget`, `setLevel`, `equipPlayer`, `setSpell` and `perform`. Reads
(`getState`, `getCatalog`) and page-only controls (`setWalkingEnabled`, `setPlayerVisible`,
`setFreeCameraEnabled`, `previewPlayerReaction`, `setMode`) stay synchronous. `getState().ready`
turns true once the worker's world is joined and the lab character is set up.

```ts
await page.evaluate(async () => {
  const lab = window.__featureLab as any;
  await lab.setLevel("melee", 40);
  await lab.spawnTarget("creature", "redsill_frogs", { distance: 6 });
  await lab.perform("attack");
  return lab.getState().target.ai; // asked of the worker before the call above resolved
});
```

The other lab surfaces follow. `game/src/featureLab/asyncMethods.ts` is the list, and the await
codemod and `npm run lint:debug-await` read it: `__environmentLab` and `__creatureGallery` tell
the worker what they placed before `show…` resolves, `__dungeonDoorLab.setState` and the
`__huntLab` actions are operations on the worker's world, and four fixtures that only ever wrote
the simulation run in the worker whole, so every method of `__agilityLab`,
`__regionalTierFixture`, `__creatureLootFixture`, `__questRecoveryLab` and
`__gameplayAcceptance` is a round trip, `getState` included. A `page.waitForFunction` predicate
may not call any of these; use `waitForDebug`.

Reads of main-thread state stay synchronous: `getState`, `getPlayer`, `getPlayerPosition`,
`getCamera`, `getDrawnBounds`, `getEvents`, render and UI state. `driver.callDebug` awaits
every method. Three rules follow, and `npm run lint:debug-await` (also a vitest test) fails on
the first two:

1. Await every async debug call. A forgotten `await` still has its effect, a moment later, and
   serialises to `{}`. `tsx tools/codemods/await-debug-mutators.ts` rewrites a file for you.
2. Do not call one from a `page.waitForFunction` predicate. Playwright polls the predicate and
   never awaits it, so an async predicate is true on its first poll. Use `waitForDebug` from
   `tools/lib/wait-for-debug.ts`, which takes the same arguments after `page`.
3. `getEntity`, `getEntities`, `listEntities` and `findEntities` ask the worker, which holds
   the whole world. The page's own entity store holds what is near the player.

Time control drives the worker's tick loop: `setPaused`, `setTimeScale` (0.1 to 100),
`advanceGameTime(seconds)`, which moves the clock and runs one tick, and `advanceTicks(n)`,
which runs exactly `n` ticks. A tick is always 100 ms of simulation. Skipping time sends no
frames nobody watches: above 1x, only the last tick of each burst takes a snapshot and
replicates, and in a lab `advanceTicks(n)` runs its ticks back to back and replicates every
fiftieth and the last. A tick that ran a player command is always a whole tick. `getSaveBlob` returns the
old save format at the same version, so a tool reads it as a `GameState`, and `loadSaveBlob`
takes that or an old `corealm.save.v1` fixture. In a connected (socket) session the writes
reject with `UNAVAILABLE`, and the entity reads answer from the replicated set.

Wait for the `ready` response before sending commands. Interact with the canvas before
keyboard movement; the lab panel can hold focus after boot. The session journal records all
commands and results under ignored `test-results/lab-session/`. `ok: true` only means
that a command completed; the before/after state must establish the claimed behavior.
See [session operations](./lab-reference.md#persistent-browser-session) for captures,
spawning and motion sampling. Acceptance screenshots must use normal gameplay camera
controls, player focus and interactive zoom limits. Detached inspection views are diagnostic.

## Keep the harness small

- Reuse an existing fixture, production catalog selector, session operation or test parameter.
  A new item, creature, region or bug does not automatically need a new fixture or script.
- Put repeatable input sequences with semantic assertions in `tools/scenarios/` and use
  `npm run play`. See [scenario format](./lab-reference.md#scripted-scenarios-and-acceptance-status).
  Use `--run runs/local-validation` for disposable output and `--url` to reuse the server.
- Add a standalone browser script only when the existing session, scenario runner and
  domain test cannot express the check, for example multiple clients or GPU instrumentation.
  State that missing capability in the handoff. Extend a shared helper when it will be reused;
  do not add another runner, command registry, report format or npm alias for each feature.
- New unit tests belong in `tests/`, preferably beside existing coverage of that behavior.
  Existing creature-motion tests remain supported. Disposable probes belong in `test-results/`.
- Feature histories, passing logs and screenshots do not belong in this workflow. Update the
  reference only when a reusable control or command changes. Keep routine evidence ignored
  and overwrite it. Promote durable evidence deliberately, with a reason.

## Acceptance scope

Lab-first remains required for isolatable gameplay and presentation. Use the same production
renderer, assets, controls and systems. Extend an existing fixture only if it cannot expose
what needs testing. A lab-only implementation cannot establish production behavior.

Terrain, biome, coast, water placement, world-scale scatter and long-distance navigation
use [world authoring](./world-authoring.md), with a brief reason why isolation would lose the
behavior. Their reusable assets and local interactions still need focused lab evidence.
Tooling-only changes use tool tests; they do not require a new game fixture.

Choose a relevant browser gate, not every script mentioning the feature:

```bash
npm run lab:test -- --shard combat --url http://127.0.0.1:4173
npm run lab:test -- --shard building --url http://127.0.0.1:4173
```

The building shard also checks mode switching in the same browser. Run only the shard
that covers the changed path. Shared lab boot/routing changes may require
more than one. Stop editing while a proof uses the HMR server; omit `--url` for an owned
server with HMR disabled. Specialized gates remain available in the reference when their
assertions are relevant. `npm run check` and CI's full shard set are broad integration checks,
not the per-edit loop. Only the root runs combined or whole-game gates during concurrent work.

Focused unit checks target 10 seconds; each lab gate has a 60-second ceiling, creature
lifecycle and full-world checks 120 seconds. Keep performance measurements separate from
builds and other rendering work. An overrun is a failed budget, not permission to raise it.
CI's configured workflow timeout includes installation and release builds.

Those numbers describe a developer machine. `docs.yml` sets `COREALM_LAB_CI=1`, which scales
two budgets in `tools/feature-lab-test.ts` for a shared hosted runner with no GPU: the
boot-to-readiness wait and the wall-clock ceiling. Both only ever measured the machine.
Every gameplay budget — an interaction taking effect, a structure rebuilding — keeps its
strict value there, so a shard that gets slower at what it proves still fails in CI. Do not
reach for that flag locally; an overrun on your own machine is the failure it looks like.

The final-world smoke test (`npm run smoke -- --run runs/corealm`) needs a real GPU, so it
does not run in CI at all. Under headless Chromium's SwiftShader fallback it never reaches
the first simulation tick; with `--hardware` it passes. `docs.yml` keeps it as a named job
that stays skipped until the repository variable `COREALM_GPU_RUNNER` names a self-hosted
GPU runner. Run it on hardware yourself before merging anything that touches boot,
rendering or navigation.

Report changed behavior, the commands actually run, semantic results, visual evidence when
needed, and any untested scope. Do not repeat passing checks without a new change or failure.
