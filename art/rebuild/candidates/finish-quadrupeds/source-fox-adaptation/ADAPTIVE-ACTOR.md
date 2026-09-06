# Fox adaptive actor review

Newest CPU review candidate: **Fox.adaptive-actor.glb** with **adaptive-actor-catalogue.json**. All eight roles are present. Frozen geometry, reach and gameplay candidates remain available and unchanged. This is not hardware or production acceptance.

## Idle correction and remaining boundary failure

Survey receives one constant **+1.370897 mm** world-Y placement correction on its existing hip translation track. Its original rotations, key times and 3.416666746 s duration are preserved. Over 1,642 samples, individual sole variation is at most0.043 mm; this confirms stationary placement rather than flight. Corrected physical soles stay **0.050–0.778 mm above y=0**, the entire mesh stays above the floor, and the loop is exact. There is no per-frame floor following. All other clips remain unchanged by this idle correction.

**Unresolved:** a generic quaternion/translation blend from Survey phase0.5 to Run start buries a sole **13.064 mm** at blend0.46875. Four idle phases and seven destination clips were audited. This is a transition interpolation defect between individually valid poses; a constant centimetre-scale idle lift would create floating feet and is not an acceptable fix. Root must resolve or validate the actual production transition behavior. The candidate catalogue keeps transition acceptance false.

## Adaptive reduction

The original 3840 Hz Run has1,537 synchronized keys. Random near-boundary samples revealed a13.44 mm/s residual missed by its quarter-key check. A7680 Hz intermediate provided convergence before reduction; it is not the proposed runtime asset.

The final Run retains **309 synchronized limb keys**, with independent head/neck/tail tracks reduced to40–47 keys and static root tracks to2. Total Run value keys fall **38,425 → 5,767** (85.0% reduction). Gait duration remains0.4 s and explicit source speed remains1.8 m/s; Walk remains0.708333313 s and0.58 m/s. No gameplay statistics or renderer caps changed.

Adaptive interval selection uses an8.5 mm/s working threshold, leaving margin to the unchanged **12 mm/s physical-contact limit**. Validation evaluates the serialized GLB at fixed off-grid points plus six seeded random points per retained interval. The same actual mesh vertex must lie within0.5 mm of the floor at both samples; no stance-label filter is used. Final measured values, including residual RMS, velocity changes and worst-vertex evidence, are in `adaptive-actor-review.json`. Maximum contact residual is8.540 mm/s, RMS4.165 mm/s over45,859 actual vertex-contact intervals; successive contact observations differ by at most16.917 mm/s (including observations separated by a non-contact gap). full-mesh burial is0.241 mm. All non-Run clips are preserved.

This is piecewise-linear glTF interpolation of a smooth authored path. The residual velocity and its sample-to-sample changes quantify remaining interpolation motion; passing the bound is not a claim of mathematically continuous acceleration. Maximum sampled world bone angular velocity is about27.4 rad/s, and maximum skinned paw point velocity, including swing, is4.61 m/s. Root must judge cadence and deformation in motion.

## CPU storage and parse costs

| Metric | Original dense actor | Adaptive actor |
|---|---:|---:|
| GLB bytes | 2,895,828 | 2,280,448 |
| Accessor storage bytes | 2,812,728 | 2,200,540 |
| Run value keys | 38,425 | 5,767 |
| Median NodeIO CPU parse, five runs | 7.48 ms | 6.49 ms |

Heap deltas were about1.13 MB and1.04 MB in the measured process, but GC and reused backing buffers make these noisy. Exact accessor storage is reported separately. These numbers do not establish browser mixer, GPU upload, draw cost or runtime resident memory; root hardware testing remains necessary.

The five authored gameplay roles and side-rest death are documented in `GAMEPLAY-CONTACT-DRAFT.md`. Evidence for this revision: `completed-actor-review.json`, `adaptive-actor-review.json`, `adaptive-parse-cost.json`. Reproduce reduction with `node art/rebuild/candidates/finish-quadrupeds/source-fox-adaptation/adaptive-actor.mjs`; CPU parse measurements use `node --expose-gc .../parse-cost.mjs`.
