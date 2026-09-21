# Minimal architecture

The repository has three independent parts:

- `game/` becomes a normal Vite game after a PRD is approved. It never imports run or agent tooling.
- `tools/` starts that game, drives Chromium, calls `window.__gameDebug`, and writes evidence.
- `runs/<run-id>/` holds durable planning and review artifacts for one build.

The root agent owns architecture, shared contracts, integration, and acceptance. A fresh PRD agent proposes only the systems required by the brief. The root removes poor scope, creates the foundation, freezes the smallest useful interfaces, and boots the production-backed feature lab before assigning feature files to specialists.

```text
brief -> fresh PRD -> root review -> browser foundation -> frozen contracts
      -> lab fixture + owned feature round -> lab state + screenshots
      -> root lab acceptance -> final-world wiring -> shallow smoke
      -> fresh critic -> fix in lab -> accept -> reintegrate
```

The foundation is real code, not stubs: application boot, renderer, scene, update loop, input, Rapier, Recast, asset loading, canonical state, shared types, debug API, and Playwright connectivity. It must launch successfully in Chromium before parallel game work begins.

The feature lab uses those production paths in a compact deterministic scene. An isolatable feature is built and accepted there before the root wires it into authored final-world content. If the lab cannot prove a feature yet, the first task extends the lab. Only behavior whose subject is the authored full world can skip this gate, and the task must record why isolation would invalidate the test.

Shared contracts normally live in `game/src/contracts.ts`, but their contents come from the approved PRD. The template does not predeclare final-game schemas. When a contract is wrong, specialists stop; the root updates the contract and affected callers together.

The game server runs the production simulation without the renderer. It boots the authored world from a baked server world pack that holds terrain heights, solids, the navmesh and the tree scatter as plain data, and it builds entities and creature placement from its live catalog at every boot. Code that needs three or GLB files to produce that pack lives in `game/src/multiplayer/bake/`, and a test keeps it out of the server's module graph. See [Server world pack](./world-authoring.md#server-world-pack).

The server is two layers. `game/src/multiplayer/worldHost.ts` is the host core: hosted worlds, peers, the join (authentication, the admission hook, the player lease), command intake with receipts, the tick loop (commands, simulation, snapshot, commit, acknowledgements, replication), the `betweenTicks` hold that a publish and a player edit run in, eviction, and the final commit that frees every account. It talks to a peer through a `PeerLink` that carries message objects, takes its storage, authentication, admission hook, catalog revision, log and timers as options, and imports nothing from Node; `tests/world-host-import-graph.test.ts` holds it to that. `game/src/multiplayer/referenceServer.ts` is the network server around it: the HTTP routes, the WebSocket adapter (JSON framing, the message size limit, the Origin check, the authentication deadline, outbound backlog and byte accounting, ping and the silent-peer timeout), bans, administration, publishing, settings and the directory heartbeat. The core is written to run behind a MessagePort link in a Web Worker as well, which is how local play will host it; `tests/multiplayer-world-host.test.ts` runs it over an in-memory link with no socket. Per-world state lives on one `HostedWorld` and refers to no sibling world, so a host with one world is the unit a later world-per-thread server runs.

Use the commands in [the development loop](./feature-lab.md). Browser checks and the persistent session call production paths directly; there is no separate agent command dispatcher.
