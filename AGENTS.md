# Agent rules

Creature reskins must use intricate image-generated texture maps with layered colors and surface detail. Never use a monochromatic recolor as a finished skin. Fairy regions use fantastical creature bases; the frog, snail and hart are explicitly allowed exceptions.

The root agent owns architecture, shared contracts, integration, and acceptance.

1. If `game/index.html` is absent, the repo is uninitiated. Do not invent a game without a current run's `brief.md`.
2. Turn that brief into an approved `PRD.md` before major game work.
3. Make the game and production-backed feature lab boot in Chromium before parallel feature work. Freeze shared interfaces in `game/src/contracts.ts` first.
4. Give each concurrent worker explicit file ownership. Concurrent workers never edit the same file or change frozen contracts.
5. Workers stop and report a bad contract. The root agent changes shared contracts and their callers together.
6. Integrate in short rounds. Only the root runs the combined lab gate or whole-game checks while a round is active.
7. Source review is not gameplay proof. Test the real Vite game with Playwright and compare semantic state before and after actions.
8. Inspect screenshots for visual work. A passing build does not prove that the view is readable.
   Use only camera angles achievable through normal gameplay controls. Never detach the camera focus, raise its target, or exceed interactive zoom limits to improve an acceptance view.
9. Critics are fresh-context, read-only reviewers. The root accepts changes only after build, browser play, state checks, and relevant screenshots pass.
10. Build every feature in the persistent realtime feature lab first whenever it can be exercised in a compact deterministic scene. If the lab lacks a fixture or control, extend the lab as part of the feature. Use production code paths, accept the feature from lab browser state and screenshots, and only then wire it into the final world in a later integration step.
11. Skip the lab-first gate only when the behavior under test is the authored full world itself, such as terrain, biome, coast, water, world-scale scatter, world layout, or long-distance navigation. Reusable structures, actors, foliage, effects, controls, UI, and local interactions used by that work still need lab proof when they can be isolated. Record the reason for every exception.
12. Follow [docs/item-icons.md](./docs/item-icons.md) for item art. Start new or replacement item icons with prompted image generation. Never create basic procedural items or screenshot fake 3D renders for inventory icons. Review the icon first; derive a 3D asset from it only when gameplay requires one. Minor jewelry, including rings and earrings, needs no dedicated 3D asset. Consolidate duplicate items before generating replacements.

The authoritative testing workflow, budgets, and evidence rules are in [docs/feature-lab.md](./docs/feature-lab.md). Generated screenshots and reports are disposable by default; commit them only when they are intentionally promoted as durable acceptance evidence.

World, biome, water, scatter, and wind work must follow [docs/world-authoring.md](./docs/world-authoring.md). That workflow owns final-world generation and placement proof; the feature lab still owns isolated production assets, material response, animation, controls, and local interactions.
