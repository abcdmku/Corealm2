# Live server status

Where the [live server plan](live-server-plan.md) stands. All nine milestones are built on the
`live-server` branch. This page is the short version: what proves each one, what nobody has proved
yet, what the known limits are, and what merging to `main` still needs.

## Done

| Milestone | Proof |
| --- | --- |
| M1 Configuration file, asset base URL | The server reads `corealm-server.json` with flag and environment overrides (`tests/multiplayer-host-configuration.test.ts`), and a client loads every asset from another origin (`docs/startup-loading.md`, "Asset host and preloading"). Boot baselines recorded in `docs/startup-performance.md`. |
| M2 Identity service | Username/password registration and sign-in mint a join token and it verifies against the published key alone: `tests/identity-service.test.ts`, `tests/identity-join-token.test.ts`, `tests/identity-accounts.test.ts`. |
| M3 Accounts, players table, lease | One account joins two worlds and sees one character, a second login is refused, a token minted for another endpoint is refused, `/admin/stats` is 401 without a session: `tests/multiplayer-accounts.test.ts`, `tests/multiplayer-player-leases.test.ts`, `tests/multiplayer-admin.test.ts`. |
| M4 Catalog, base version and update from base | A publish against a running server changes the next kill's loot with no restart, a spawn moves at the next respawn, a rollback restores the old table, and removing a held item is refused: `tests/multiplayer-publish.test.ts`, `tests/multiplayer-catalog.test.ts`, `tests/multiplayer-item-holders.test.ts`. Strict base-version handling, schema 3 to 4 migration, per-record merge, base preview/apply, conflict decisions, downgrade refusal, marker-only moves and threaded exposure are covered by `tests/semver.test.ts`, `tests/base-version-release.test.ts`, `tests/multiplayer-base-storage.test.ts`, `tests/multiplayer-base-update.test.ts`, `tests/multiplayer-base-conflicts.test.ts` and `tests/multiplayer-base-threads.test.ts`. |
| M5 Devdocs server mode | The editor runs against a live server's admin API and against the fixture: `tests/devdocs-server-backend.test.ts`, `tests/devdocs-server-http.test.ts`, and `tools/devdocs-surface-audit.ts --server`, which walks every `players`, `server` and Base game surface. The bounded browser audit covers preview, resolved apply, stale, missing-decision, in-use and invalid cases; desktop and phone world-selector captures were inspected. |
| M6 World pack and executables | Booting the authored world from the pack takes about 4 s, against about 39 s building it from source (`docs/world-authoring.md`, "Server world pack"). Both executables build from one machine and the Linux one starts from an empty folder in `release.yml`; `tests/server-packaging.test.ts` and `tests/world-pack-parity.test.ts` cover the archive, the pack and the log. |
| M7 Thin client, worker local play | Connected first playable fell from 14,207 ms to 9,178 ms and local from 13,735 ms to 9,148 ms, beating the M1 baseline. Initial application JavaScript fell from 0.974 MB gzip to 0.621 MB. Numbers and method in `docs/startup-performance.md`; `tests/client-catalog-page-graph.test.ts` and `tests/local-worker-import-graph.test.ts` hold the page and the worker to the split. |
| M8 CI content workflows | `content-export.yml` has run against the owner's test server and opened a pull request matching an edit made in devdocs. `content-selftest.yml` proves both tools work with no secrets. Both workflows are manual: a server owns its content, and neither one is part of the normal loop. |
| M9 Thread per world | Two worlds in their own threads tick at 35.3 ms p50 against 36.3 ms for one world alone; the same two worlds in one thread tick at 72.8 ms. Measured with `npm run multiplayer:capacity -- --scaling`; the table is in `docs/multiplayer-hosting.md`, "Scaling on one machine". `tests/multiplayer-threads.test.ts` drives a threaded server through sockets and the admin API. |

## Validation on 2026-09-21

- The world, navmesh and server pack were rebaked with the narrowed import graph. Typecheck,
  content validation, game/guide/admin builds, both executable builds and content export self-test pass.
- The full unit run passed 487 of 490 files. Its five failures were old exact-response expectations in
  three files that omitted the new base fields. Those expectations were corrected; the focused rerun
  passed all 34 tests in those files. That leaves 3,766 passing tests and one existing skipped test.
- Production local play passes all 20 worker checks, including save migration, persistence and reload.
  Hardware smoke, combat/building shards, creature lab and multiplayer lab pass. The repaired mining
  proof reaches level 10 and banks 236 ore through the production agent tools.
- The Base game surface audit passes 14 scenarios. The 900 px quest audit passes four surfaces,
  including expanded Long Cairn conditions. Screenshots of those views and the desktop/phone
  `v0.1.0` selector labels were inspected.
- The rebuilt Windows executable reports `0.1.0`; the Linux executable boots under Ubuntu WSL.
  Guest-mode `/admin` intentionally returns `501 admin_unavailable`; the release smoke now checks
  that policy instead of expecting a guest server to expose administration.
- Deployment backed up the test executable and database, copied in the new executable and started
  identity. Automatic tool approval rejected starting the public TLS proxy. The public game restart,
  health checks and selector check are therefore still pending; no content was published to that server.

## Not verified

- **The publish workflow has never run from `main`.** `content-publish.yml` is manual and gated on
  the `live-server` GitHub environment. It has been read and its inputs validated, and nothing has
  pushed repository content to a live server through it.
- **The Linux executable has only run under WSL.** It has not been started on a real Debian or
  Ubuntu host, and the shipped `deploy/corealm-server.service` has not been run by systemd.
- **The browser smoke test does not run in CI.** `docs.yml` carries a `smoke` job that stays
  skipped until the repository variable `COREALM_GPU_RUNNER` names a self-hosted runner with a GPU,
  because headless Chromium's software rasteriser never reaches the first simulation tick of the
  authored world. Run it by hand before merging anything that touches boot, rendering or
  navigation: `npm run smoke -- --run runs/corealm --hardware`.
- **`release.yml` has never run on a real tag.** Its `workflow_dispatch` path does everything
  except publish, which is how it has been exercised.
## Known limits

- **Skipping time in local play is bounded by the worker.** `setTimeScale(100)` reaches 100x in the
  authored world, measured after the enemy target query stopped running for enemies with no player
  near them. Before that fix it reached 48x. A world with far more players near far more enemies
  will reach less.
- **Memory is about 700 MB per world with threads on.** Two threaded worlds peaked at 1,556 MB and
  three at 2,214 MB. Size a host at one core per world plus two.
- **Some tables only change at a restart.** A publish applies loot at the next kill and spawns at
  the next respawn. Regions, NPCs, quests, dialogue, spells, resources, tiers and tuning are read
  once at load, so an edit to one of those waits for the next server start. The table is in
  `docs/content-authoring.md`.
- **There is no self-service password reset.** Corealm holds no email address. A player who forgets
  their password asks whoever runs the identity service to run
  `npx tsx tools/identity-admin.ts --data identity-data set-password <name>`. A player who still
  knows theirs changes it on the service's own `/password` page.
- **A world that keeps crashing is left down.** Five failures inside ten minutes stop the restarts
  and mark the world `abandoned` in `/admin/stats`. It stays unavailable until the server restarts.
- **A marker-only base update is a real history move.** When the merged sources equal the active
  revision, apply updates the base marker and audit history without swapping the catalog or notifying
  clients. Revision rollback cannot undo it because the active revision is unchanged. To restore only
  base tracking, run the previous executable and apply its bundled base with `allowDowngrade: true`;
  the merge keeps server edits. Ordinary rollback restores the base recorded on its target revision.

## Merging `live-server` into `main`

1. Remove the temporary `push` trigger on `live-server` from `.github/workflows/content-export.yml`
   and delete `.github/export-now`. `workflow_dispatch` works from the default branch, which is
   what the trigger stood in for.
2. Decide whether worlds on an account server should be joinable from the Pages client. If so, the
   Pages build needs the identity service URL, which `docs.yml` does not pass today.
3. Run the **Content publish** workflow once with `validate_only`, against the test server, so the
   one workflow nobody has run has been run.
4. Push a `v<package.json version>` tag and let `release.yml` build and attach both executables, so
   the release path has been run on a real matching tag rather than on `workflow_dispatch`.
