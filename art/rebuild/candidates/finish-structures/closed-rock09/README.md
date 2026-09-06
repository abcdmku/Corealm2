# Whole Rock 09 shortcut candidates

One complete original Rock 09 mesh is used for each candidate. The source is Jenelle van Heerden / Poly Haven, CC0-1.0. The original source geometry, indices, normals, UVs and all three 1K material maps remain unchanged. The source's closed topology is preserved by positive affine transforms. No panels, generated rock surface, extra support body or terrain are added.

Sunder uses source-X pitch +18 degrees followed by world-Y yaw 120 degrees. Scree uses pitch -39 degrees followed by yaw 145 degrees. Each is fitted once to its exact legacy bounds and base. Each contains 12,416 triangles. Scree's rear quarter is 2.0165 m higher than its front quarter.

I inspected all twelve CPU previews. The real fracture geometry remains legible and there are no assembly seams. The tilted source still reads as a slab from its underside, particularly behind Scree. These are shape candidates, not accepted world placements.

The ground-contact measurement is a blocking placement concern. At the required legacy pivots, a flat Y=0 plane intersects only 2.17% of Sunder's projected footprint and 1.74% of Scree's. Raising flat ground relative to each candidate by about 1.76 m would reach half its underside. Reaching 75% requires 2.45 m for Sunder and 2.78 m for Scree. These numbers are diagnostics, not terrain-edit recommendations or stability thresholds. No additional burial was applied, and no terrain was invented. An existing terrain bank would need to be measured before either tilted body could be considered grounded; otherwise the proposed orientations need revision.

The generator is tools/build-rock09-shortcuts.ts. The catalogue records hashes, transforms, source provenance and full ground-ray statistics. Two focused tests in tests/rock09-shortcuts-source.test.ts pass, verifying original channel/map equality, one source body, exact transformed legacy bounds, positive transforms and the descending Scree profile. No GPU run or public asset edit was performed.
