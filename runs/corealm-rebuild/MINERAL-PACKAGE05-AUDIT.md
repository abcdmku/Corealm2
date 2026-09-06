# Inventory mineral audit

## V8 opal geometry revision

Root accepted the seven other specimens after the v6/v7 hardware reviews and rejected opal's rounded button with broad candy-like bands. Their seven accepted hashes now have byte-preservation tests. The unmodified v7 source is pinned at `test-results/mineral-items-v7/build-corealm-minerals.ts` for promotion provenance.

V8 changes only opal. Its exposed contour has unequal lobes and inward matrix tongues, with 128 angular samples preserving a continuous seam. The central rise falls from 0.46 to 0.205 local units; the stone front rises over the perimeter and its tallest ridges extend beyond the opal. The texture now has 170 smaller unequal domains in a restrained warm palette, with muted green confined to a small minority of cells. Existing geometry closure, smooth contour, thickness and optical texture tests still pass.

`test-results/mineral-items-v8/catalog.json` contains the candidate. Fourteen focused tests passed in 3.55 seconds, including a new pose-independent relief test proving the opal surface stays below surrounding host ridges. No GPU session or promotion occurred. Root must inspect v8 before accepting the final specimen.

## V7 revision after the eight-item hardware review

The v6 review found amber readable as transparent honey with its inclusion visible. Opal still read as a uniform pale egg, and emberite's rear was a near-black untextured cap. Root requested those two fixes. V7 changes only those specimens, preserving the six other v6 GLBs exactly.

Emberite explicitly assigned the entire rear to a dark untextured rind in source. Its triangle winding and closed-body checks passed. That face now uses the same weathered host material as other ore backs, which receives the production stone texture.

Opal now carries 256 px coherent albedo domains in coral, orange and honey, with sparse muted teal. Its second UV set maps those domains continuously over the lens. Transmission is 0.42 and roughness is 0.10 so the opaque backing cannot wash out almost all of the authored surface colour. Physical thin-film domains remain, but the candidate no longer relies on them alone to distinguish opal from amber. No new geometry, opaque internal sheet or emission was introduced.

All eight candidates are staged in `test-results/mineral-items-v7/catalog.json`. Thirteen focused CPU tests pass in 5.85 seconds. Opal front/side and emberite rear require fresh rendered inspection; CPU results are not visual acceptance.

## V6 revision after rendered rejection

The subsequent hardware captures in `test-results/mineral-v5-review/` rejected amber and opal as opaque caramel/plastic. This supersedes any inference of quality from the CPU results below. Root also requires fresh review of all eight items; historical acceptance of five source hashes is preservation evidence only.

Gallery entities use the landmark archetype. Its neutral appearance returns the original material at zero tint strength, and `EntityViews.collectParts` retains that physical material. The mineral dielectric names do not select the weathered stone material override. The source explains a likely cause of the heavy brown read: Three's refraction shader multiplies transmitted light by vertex diffuse colour and volume absorption. V5 used strong warm pigment in both, with another 22 percent opaque diffuse contribution.

V6 preserves geometry, inclusion placement, IOR and thickness. Amber changes transmission from 0.78 to 0.96, roughness from 0.11 to 0.065, surface colour from `#ffdba0` to `#fff9ed`, attenuation from `#d99531` at 0.19 m to `#ffcf78` at 0.34 m. Opal changes transmission from 0.78 to 0.94, roughness from 0.085 to 0.055, surface colour from `#f5d6aa` to `#fff7eb`, attenuation from `#e7aa78` at 0.22 m to `#ffc980` at 0.32 m. Its existing physical iridescence remains. These are candidate changes, not a claim that transmission now reads correctly in the game.

An additional source pass distinguishes opal from amber. Opal now uses surface colour `#fff9ef` and fire-orange attenuation `#ffaa64` at 0.38 m. Its embedded 128 px optical texture varies physical thin-film thickness over 120 to 620 nm, with iridescence factor 0.92. A separate continuous second UV set maps domains across the lens, independent of tiled growth normal-map projections. This introduces no opaque inner sheets or emissive rainbow paint.

All eight current candidates are in `test-results/mineral-items-v6/catalog.json`. The other six GLBs remain byte-identical. The focused 13-test suite passed in 4.66 seconds, including optical texture range and shared-vertex UV continuity. No GPU session or production promotion ran in this revision. Root must inspect the full eight-item batch, including amber inclusion readability and opal lens response in front of its actual opaque backing, before accepting models and generating icons.

## Initial CPU audit

2026-09-05. Retained as package 05 handoff evidence for the three unaccepted v5 gems. This is CPU geometry evidence, not visual acceptance.

The existing v5 generator already addresses the rejected construction patterns. Amber has one continuous transmitting shell with small enclosed inclusions. Garnet has five unequal crystal growths and an irregular stone root. Opal joins its lens and matrix along a shared smooth contour. Garnet and opal contain no opaque internal plates. No further art change was made without a new rendered finding.

Fresh generation reproduced all eight preserved candidate hashes exactly. The source remains `tools/build-corealm-minerals.ts`. Durable candidates remain under `art/rebuild/candidates/2026-09-05/minerals/`; the fresh comparison copy is disposable under `test-results/mineral-package05-audit/`.

| Candidate file under `models/corealm/minerals/` | SHA-256 | Triangles |
| --- | --- | ---: |
| `corealm_item_vell_amber.glb` | `ae8d6701db9bd85ea71118e10d678befc5728fa926ec51c56410acd924edc7eb` | 4,844 |
| `corealm_item_cairn_garnet.glb` | `06b0559344d4fdc80b059755a5902fd79e3a48fa1a959a7d24c6f165ae17026e` | 17,984 |
| `corealm_item_fire_opal.glb` | `252f0ae2de966cf51956066fc95718e34dd070203360552e111bedaa2bd90ccf` | 5,160 |

`npx vitest run tests/mineral-items.test.ts` passed 12 tests in 6.19 seconds, using Node 24.14.0. The new regression checks every unique amber inclusion vertex against the real closed shell and restricts total opaque inclusion volume to less than one percent of shell volume. Existing checks cover manifold edges, normals, grounding, physical material extensions, opal contour angles, garnet growth attachment and pose-independent specimen thickness. The accepted ore and quartz hashes remain unchanged.

The integration owner still needs to inspect these exact bytes through the production feature lab from front, back, side and normal inventory scale. Check transmitting depth, the amber inclusion read, opal border smoothness and whether the garnet root looks like natural matrix. Then generate and inspect 256 px masters and 48 px icons. Public models, manifest and icons were not edited during this audit. Their previous state cannot establish acceptance for these candidates.
