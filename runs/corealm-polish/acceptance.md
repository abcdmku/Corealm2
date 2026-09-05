# Presentation overhaul acceptance

September 4, 2026. The owner confirmed: "Keep it, with cohesive art and much stronger polish."

## What changed

Corealm keeps its stylized low-poly art and existing progression. Decorative foliage, gatherable trees and live creatures now share cached material treatments. Leaves have a restrained olive palette and softer lighting, bark and hides stay matte, and elemental rhinos retain their markings with reduced emission. Terrain detail has less contrast so it competes less with actors and paths.

Grass uses curved, tapered blades in uneven groups, with colour at transparent edges to prevent dark mip borders. Tree foliage and bark open a small, depth-aware space around the player when they block the camera. The opening follows the player, leaves the rest of the tree intact and preserves its shadow. Hidden-player and map captures do not use it.

The dock uses one line-icon family with visible labels and legible key hints. Shared panels have clearer typography, spacing and focus states. Skill guides stay beside their panel at both density settings. The agent panel starts collapsed and opens for connection and approval activity. The menu now says "Return to game".

Inventory icons were regenerated against the equipped-item palette. Log icons have faceted cut ends and growth rings. Production 48px icons, 256px masters, the contact sheet and documentation copies agree.

The optional presentation fixture at `/index.html?mode=combat&presentation=1` puts actual gatherable resources beside matching decorative foliage. It uses production rendering, wind, inventory and gathering code. Its state exposes the fixtures for repeatable checks.

## Verification

The root accepted isolated materials, foliage, creature animation, occlusion and UI in the production feature lab before final-world integration. Both existing game and lab booted in Chromium before parallel work. Workers had separate file ownership; the root owned contracts and integration. Fresh read-only source and screenshot reviewers reported their findings, and the observed regressions were fixed.

- Unit suite passed 528 tests in 79 files. TypeScript, production game build and the 59-page documentation build passed. The game build retains its existing large-chunk warning.
- Combat lab passed real keyboard and canvas input, equipment selection, melee damage, spell damage and live effects. Bank quantities changed 25 to 30 to 25 while carried quantities changed 8 to 3 to 8.
- Building and navigation lab gates passed movement, camera controls, rebuilds, collision and route switching.
- Full-world smoke passed movement, reset and a bank transfer from 0 to 5. The final world capture also proved movement through real keyboard input.
- Production gathering yielded eight items and depleted the ore fixture. Depleted ore and tree-stump screenshots were inspected.
- Four creature captures confirmed advancing production rig motion. Cow and bear markings, Rootheart and Tempest Roc were inspected at gameplay distance.
- Occlusion checks covered resource and decorative trees, real movement, hidden-player disable and restoration. Off/on screenshots were inspected.
- Inventory, equipment, bank, shop, skill guides and menu views were inspected at desktop sizes. Icon verification passed inventory 19, bank 19, equipment 9 and shop 19, with all images loaded and no SVG fallbacks.
- Final world views covered spawn, Palewood Copse, town, Vellenwood canopy, Karrowmoor terraces and Emberfast. Captures waited for all 144 scenery tiles. Runtime errors, failed requests and missing scatter assets were empty.

The complete scenery census is 1,313,149 instances: Fallowmarch 506,383, Vellenwood 345,641, Karrowmoor 320,797 and Kilnhalt 140,328. The overhaul preserves generation seeds, density, placements, semantic regions and gameplay coordinates.

## World-scale exception

Distance and frustum bounds for streamed scatter use a narrow exception under `docs/world-authoring.md`. Their behavior depends on the real island's tile distribution, camera distance and shadow frustum, so a small lab cannot establish their draw-call cost. The reusable foliage and materials were already accepted in the lab.

Scatter bounds now measure the nearest horizontal box edge at the existing 170/195 metre horizons. Conservative bounds include shader wind. A smaller valid enclosing sphere can replace Three's order-dependent sphere unions. This changes visibility rejection, never instance placement or density. Full-world screenshots and hardware benchmarks provide integration proof.

The final fresh screenshot reviewer compared spawn, Vellenwood and Karrowmoor against their fully resident pre-bounds captures. No missing scenery, changed shadow coverage or new distance cutoff was visible. The final occlusion browser check also passed all six assertions after bounds integration.

The performance tool now waits for complete scatter residency, pauses rendering only during loading setup, then restores production graphics before measurement. Previous measurements taken before full residency are invalid for the complete-scene budget. It also reports game-recorded errors, including background streaming failures.

## Hardware performance

The corrected benchmark is **not passing**. All five scenes meet its median frame-time target on this machine, but three exceed the existing 400 draw-call ceiling. The ceiling was not raised. The bounds correction reduced the canopy view from 480 to 461 calls at complete residency.

Measured with Chromium, ANGLE D3D11, an NVIDIA RTX 5080, 1920 by 1080, default high shadows and far draw distance. Each named view was sampled for three seconds after loading all 144 tiles and warming the camera pose. These are short desktop measurements, not a hardware support guarantee.

| View | Median frame, ms | 95th percentile, ms | Draw calls | Budget |
| --- | ---: | ---: | ---: | --- |
| Spawn | 3.3 | 5.0 | 432 | Fails draw calls |
| Palewood Copse | 1.2 | 1.6 | 109 | Pass |
| Vellenwood canopy | 3.5 | 5.2 | 461 | Fails draw calls |
| Karrowmoor terraces | 2.8 | 3.7 | 411 | Fails draw calls |
| Emberfast | 2.5 | 3.6 | 394 | Pass |

The slowest individual sampled frame was 39 ms at spawn. The benchmark recorded no game runtime errors. The report is `runs/local-polish-final/test-results/perf.json`.

## Release status

This is a substantial presentation pass, not AAA release certification. The original animal meshes still have visible texture/UV seams and abrupt markings. Elemental bosses retain conspicuous painted patterns. Some terrain texture repetition and regular plant placement remain visible in wide views. Those require source-asset and authored-world work beyond material grading.

The draw-call budget remains an open release blocker. Full progression playthroughs, a broader hardware/browser support matrix and final asset-license signoff were not performed in this run. No remote deployment, publication or commit was made. Routine screenshots and machine-readable reports remain disposable under ignored `test-results/` and `runs/local-*` directories.
