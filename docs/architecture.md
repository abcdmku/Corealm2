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

Use the commands in [the development loop](./feature-lab.md). Browser checks and the persistent session call production paths directly; there is no separate agent command dispatcher.
