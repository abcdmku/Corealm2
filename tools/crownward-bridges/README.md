# Crownward bridge candidate

`node tools/crownward-bridges/build.mjs` downloads the pinned [Small Bridge by Quaternius](https://poly.pizza/m/j4KsIuJYnq), whose primary page explicitly identifies Public Domain (CC0). The [CC0 dedication](https://creativecommons.org/publicdomain/zero/1.0/) permits reuse and modification. Its complete arched timber construction suits the fantasy world. CreativeTrio's similarly named asset was inspected and rejected because it is a modern steel truss; Quaternius's other Bridge is only a drawbridge panel.

Source GLB is retained byte for byte in ignored `test-results/crownward-bridges/sources/`. Candidate normalization changes only the scene-root translation, centering X/Z and putting the base at Y=0. Embedded geometry and materials remain byte identical, verified by BIN hashes. The source preview `test-results/crownward-bridges/sources/small.jpg` was visually inspected.

Use `catalog.json` for feature-lab candidate loading. Production is intentionally untouched until the root accepts a real browser scene. Then run `node tools/crownward-bridges/promote.mjs --evidence <passing-report.json>`, adding `--integrated` only after final-world placement. Evidence must have `passed: true` and `acceptedCandidateIds: ["crownward_timber_bridge"]`.

The bridge crosses along local X. Native overall bounds are 6.938079 × 2.617480 × 2.637635. Uniform scale 3.459171 makes a 24m overall span and a 9.124m overall width. Rails overhang the deck slightly: native walkable ends are about X=±3.1, inside the overall X=±3.469. A 24m model therefore has roughly 21.4m of actual deck. Keep the wet channel inside that usable span and blend banks into the ramp ends.

The deck is visibly arched. `metadata.inspection.deckProfile` records exact top hits every 0.2 native units, plus lateral checks at Z=±0.65. At X=±3 its height is about 0.281; at X=±0.2 it is about 1.351. X=0 is a narrow plank gap, so interpolate across it for traversal. Null outer samples are beyond the deck. Do not substitute a flat collider under this sloped model. Use a smooth sampled walkable surface and guard rails; root owns that shared movement contract and its lab proof.

No build, gameplay, or final-world acceptance is claimed by the asset search worker.
