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

Report changed behavior, the commands actually run, semantic results, visual evidence when
needed, and any untested scope. Do not repeat passing checks without a new change or failure.
