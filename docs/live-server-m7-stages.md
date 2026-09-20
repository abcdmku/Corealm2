# M7 stages: thin client and worker local play

This is the root's working plan for M7 of `live-server-plan.md`. It comes from a read-only survey of the code after M6. Each stage leaves typecheck, the test suite, `npm run build` and the browser smoke green. Old and new local-play paths coexist until stage 6 deletes the old one. Check every file and line reference before relying on it.

## Corrections to the plan doc

- The synchronous `CorealmGameApi` executor stays. The server runs commands through it (`multiplayer/headlessPlayer.ts`, `headlessWorld.ts`). What M7 deletes on the client is the `LocalSession` branch in `submit()` (`api/gameApi.ts`), the `commandsBlocked` guards and `GameLoop.simTick()`.
- The shipped client already loads the built world from the baked `assembly/semantic` record instead of building it. Rendering still needs that record as data: static scenery entities, solids (prediction, camera, scatter exclusions), buildings, known locations, the route graph, portal mouths and the dungeon. Static world data belongs to the asset host, not the server catalog.
- Movement prediction keeps `Movement`, `Navigation` and `Solids` on the main thread. The API's read hooks need read-side view computers over the replicated store.
- Removing the simulation from boot saves about 0.3 s. Shader compilation is about 10.3 s of the 13.7 s first-playable time. To beat the M1 baseline, stage 6 takes the effects shader spans off the path to first playable: submit at boot, finish after the first frame through the existing `KHR_parallel_shader_compile` poll, and gate the first cast on readiness. It also drops the duplicate render-target compile passes.
- The client catalog omits `world`, `quests` and `dialogue`. The main thread installs an asset-host `generated/client-catalog.json` before importing the app, so the projection grows the presentation parts of those tables that the client really reads.
- Local play supports the seeds the shipped pack holds. A save whose seed has no pack spawns at the safe spawn of the default seed's world.
- The worker's storage commits in memory and flushes to IndexedDB about every 5 s and when the main thread reports `visibilitychange`. A worker cannot see `pagehide`.
- Measure first playable from a `?play=` auto-pick, since the picker now always shows.

## Session seam

`SessionController` in `multiplayer/providers.ts` is already transport-neutral. About 250 of the lines in `referenceServer.ts` become a transport-agnostic host core in a new `multiplayer/worldHost.ts`: peers, join, command intake, close, tick, `betweenTicks`, eviction and the final commit. The core talks to a `PeerLink` with `send(value): boolean`, `close(code, reason)` and `open`. The WebSocket adapter keeps byte counting, the backlog check, ping and `unref`. Admin, publish, settings and the directory stay in `referenceServer.ts` and call the core. `randomUUID` from `node:crypto` becomes `crypto.randomUUID()`.

`WorkerWorldProvider` discovers one "Play local" descriptor, authenticates with a fixed local id, and runs the same join, snapshot, ack, update and content-updated messages over a `MessagePort` with structured clone.

`SessionCatalog.url` becomes `load(): Promise<ClientCatalog>`. The socket transport fetches it. The worker answers with `clientCatalog()` of its installed tables.

## Worker

The worker entry imports nothing from content. It fetches `generated/server-catalog.json` and `generated/server-world.pack` from the asset base, calls `installCatalog`, then dynamically imports the host core. Both files are published with the client build. Vite needs `worker.format: "es"`, and the worker stays in its own chunk under the gzip budgets.

Blockers to clear first:

- `multiplayer/memoryStorage.ts` imports `adminStorage` (`node:crypto`) and `sqliteStorage` (`node:sqlite`) for one constant. Extract a player-tables core and a neutral `PLAYER_LEASE_MS`.
- `systems/navigation.ts` tests `typeof window` to pick the wasm path. A worker has no `window`.
- `content/resolvedCatalog.ts` statically imports the compiled JSON. Move that fallback to `content/bundledCatalog.ts`, which the vitest setup, tools and the from-repo server import first.

## Debug and tools

172 tool files use `__gameDebug` and 76 use `__featureLab`. The mutators (`teleport`, `giveItem`, `setHealth`, `setSkillLevel`, `setTimeScale`, `setPaused`, `getSaveBlob` and others) write the main-thread store today. They become a debug RPC on the worker session, available in local and development sessions only, and return promises. `tools/lib/driver.ts` `callDebug` already awaits. Inline `evaluate` blocks that mutate then read need a codemod, plus a lint that fails on a mutator call without `await`. Time control drives the worker tick loop. Debug queries that read the whole world need an RPC too, because replication only carries entities inside the interest radius.

## Labs

A lab worker is the same worker given a serializable `LabFixtureSpec` in place of the URL flags that mutate the built world in `boot.ts`. Hard cases: `replaceStructure` and the building lab (the main thread posts triangles and solids), cave and door labs (the renderer builds the mesh), terrain variants (the worker needs a sampler), forest (trees come from scatter callbacks), `resetWorld` and `loadSaveBlob`.

## Save migration

The old save is `localStorage["corealm.save.v1"]`, `SAVE_VERSION` 8. The main thread reads it, runs `migrate` and `validateSaveState`, and posts the `GameState` at join. The worker imports it only when no local account row exists: `playerSessionState()` gives the character and the owned-world row. No world record is written, because nodes, enemies and loot piles do not match the server's spawn ids. The raw save is copied to `corealm.save.v1.backup` first, and `corealm.save.v1.migrated` is set only after the worker acknowledges. Settings stay in localStorage. Ground loot and respawn timers are dropped.

## Picker and preload

The picker always shows, with a Local entry. Preload starts at once from the page's asset base. When the chosen world names a different asset base, seed or fixture, store the intent in sessionStorage and reload: the second boot sets the base before the first fetch and joins automatically. A live `AssetRegistry` is never re-based. `?play=local` and `?play=<host>/<world>` let harnesses skip the picker.

## Stages

| # | Scope | Main files |
|---|---|---|
| 1 | Neutral constants, player-tables core, navigation guard, `bundledCatalog` split, `?play=`, picker always on with a Local entry that still uses the old local path. | `memoryStorage.ts`, `navigation.ts`, `resolvedCatalog.ts`, `worldSelector.ts`, `main.ts` |
| 2a | Host core and `PeerLink`. | `referenceServer.ts`, new `worldHost.ts` |
| 2b | IndexedDB storage over a key-value port, and the pure save migration. Parallel with 2a. | new `indexedDbStorage.ts`, `persistence/localSaveMigration.ts` |
| 3 | Worker entry, `WorkerWorldProvider`, `SessionCatalog.load`, publishing the server catalog, client catalog and pack with the client build. Behind `?local=worker`. | new `worker/`, `workerProvider.ts`, `vite.config.ts`, build tool, `contracts.ts` |
| 4 | Debug RPC, time control, save-blob RPC. Flip the game profile to the worker. Driver, smoke and tools codemod with the await lint. | `debug/gameDebug.ts`, `tools/lib/driver.ts`, `tools/*` |
| 5 | Lab worker and fixture specs. | `labWorld.ts`, `featureLab/*`, `bootProfile.ts` |
| 6 | Thin boot: presentation from the bake, deferred effect shaders. Delete `simTick`, `LocalSession`, client system ticks and the static catalog import. New timings and docs. | `boot.ts`, `loop.ts`, `gameApi.ts`, `browserSession.ts` |
