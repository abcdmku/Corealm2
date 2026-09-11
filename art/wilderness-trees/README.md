# Wilderness dead forest

These four models have original swept branch geometry. They share Corealm's authored bark
albedo, normal and roughness maps through the normal production asset loader. They do not
copy or rescale either existing deadwood model.

| Asset | Form | Placement |
| --- | --- | --- |
| `corealm_deadwood_hollow` | Split old griefwood, thick open bole cavity, unequal broken leaders | Isolated graveyard and chapel trees. Use sparingly among smaller silhouettes. |
| `corealm_deadwood_claw` | Rakewind snag, low swept trunk and a hooked leeward crown | Northern ecotone and exposed moors. Loose aligned groups leave sight lines beneath the hooks. |
| `corealm_deadwood_crown` | Large petrified crown oak, broad irregular scaffold with attached fine forks | Dead forest interior and shelter around ruins. Leave roughly 10–15 m between mature trees. |
| `corealm_deadwood_fallen` | Windthrown bole and attached heaved root plate | Sparse grove edges. Its 9.4 m length belongs away from roads, entrances and mob patrol lanes. |

Build staged assets with `npx tsx tools/wilderness-trees/build.ts`. The generator writes only
`test-results/wilderness-trees/`, including a hash-checked candidate catalogue, measured native
bounds and branch topology. It never updates the production manifest or scatter recipes.

`npx vitest run tests/wilderness-tree-assets.test.ts` checks grounded geometry, valid triangles,
parent attachment, subordinate taper, the open hollow and deterministic rebuilds.
`npx tsx tools/wilderness-trees/lab-test.ts` loads the candidate catalogue through the production
loader and checks the actual detailed colour submissions at near, far and return distances. It
also captures each tree under Wilderness light and a 20-instance mixed grove. Root must review
those screenshots before promotion. Generated reports and screenshots remain disposable.

The September 10 lab review passed the four native near/far/return checks and the mixed grove.
A later hollow-only contour revision passed with `--hollow-only`; its final evidence is in
`test-results/wilderness-trees/lab-hollow/`. It replaces the older hollow images in `lab/`.
The fresh read-only environment critic approved all four for root integration after inspecting
the corrected hollow depth, continuous tear edge and exposed grain. World placement is separate.

Production material handling identifies original packs by the `corealm-original-` prefix.
The `corealm-original-wilderness-trees` pack therefore receives the same registered bark maps
and filtered sampling as native Corealm nature. Deadwood remains static under the production
wind path. No transparent foliage cards or alternate far geometry are used.

For the wider Wilderness, combine these with the two existing deadwood sizes. A useful starting
mix is 30% native snags, 30% rakewind, 24% crown, 11% griefwood and 5% fallen. Use broad clusters
and empty approaches rather than evenly filling every square metre. Keep crown and fallen trees
out of narrow routes; fallen trees should be authored scenery or use a footprint-aware exclusion.

Geometry and generator are original Corealm project work. Bark maps are the existing Corealm
authored surfaces documented in `game/public/assets/textures/corealm/corealm-surfaces.json`.
