# Checkpoint validation, 2026-09-05

This is a working checkpoint for parallel branches, not a release candidate. Feature work was frozen at the user's request. See [PARALLEL-HANDOFF.md](./PARALLEL-HANDOFF.md) for remaining implementation and acceptance.

## Fresh checks

| Check | Result | Scope |
| --- | --- | --- |
| `npm run typecheck` | PASS | Current game, tools and tests after the stopped worker fixes |
| `npm run build` | PASS | Real Vite production bundle and existing payload gate; 258 modules; build completed in 3.27 seconds |
| `npx vitest run --reporter=json --outputFile=test-results/checkpoint-tests.json` | 1,531 passed, 2 failed, 1 skipped; 168 files | Entire current test suite, including new movement, realm, pack and asset checks |
| Real Chromium game boot | PASS | Production world reached ready, drew the player/world/UI and reported no debug or console errors |
| Real Chromium portal lab boot | PASS | `?mode=combat&portal=1` reached ready and drew the scene/UI with no errors |
| Real Chromium staged pack lab boot | PASS | First staged pack fixture reached ready and drew residents with no errors; this is not pack behavior acceptance |
| Preserved portal recovery script | PASS | New committed script location resolves its imports and repeats failure/cancel/input recovery in Chromium |
| `git diff --check` | PASS before staging | Trailing blank line corrected; final staged check repeated before commit |

Root inspected all three fresh boot screenshots. The portal screenshot uses the starting camera, so it does not by itself show or accept the portal. Boot checks do not establish new art quality, whole-game stability or performance. Earlier click/walk/fade and shop/respawn evidence is described separately in the handoff.

Build warnings remain for the large entry/Three chunks and a dungeonDoors module that is both statically and dynamically imported. The original payload gate passed; those warnings were not hidden by raising its limit. npm also reports the existing `strict-allow-scripts` configuration warning.

## Known failing tests

1. `tests/creature-gait.test.ts`, resident speed versus shipped stride metadata. The six dungeon scorpions have about 28–45% mismatch during run/return at the current playback cap. The clip repair is unfinished. The current solver rejects an excessive 0.6991-radian correction against its 0.65-radian guard. The preserved first candidate also fails heel-contact slip. Keep this test and its guard.
2. `tests/ground-ores.test.ts`, iron flecks must remain small patches. One connected mineral component spans 0.63041948 m against the 0.55 m limit. Latest copper was staged separately and is unreviewed. Fix the iron candidate without turning this into a continuous decorative band.

The earlier checkpoint attempt had 17 failures. Two expected names were stale after the approved plain-name rewrite and now match Copper Ore and Cow. The ore owner corrected the texture expectation and original-versus-remapped UV checks while preserving the original UV-area threshold. The fresh count above is the final suite result, not the earlier 17-failure result.

## Evidence and limits

Disposable fresh outputs are under `test-results/checkpoint-tests.json`, `checkpoint-tests.log` and `checkpoint-boot/`. They are not required files for a new checkout. The durable records here preserve their scope and results. Useful earlier browser scripts are committed under [checks/](./checks/README.md).

Twenty-one GLB candidates, about 48 MB total, are intentionally preserved under [the candidate archive](../../art/rebuild/candidates/2026-09-05/README.md), with hashes and status. They remain outside the public game directory. The archive includes rejected/failing development state where necessary to resume work; it does not certify that state.

No new RPG bestiary, Knight-inspired equipment sets or randomized hunt quests were implemented in this stopped round. Final-world portal integration, pack registration, remaining asset promotion, navigation/map regeneration, docs build, complete gameplay journeys and release performance checks remain outstanding. The earlier documentation and generated world artifacts can be stale relative to this checkpoint's content/layout changes.
