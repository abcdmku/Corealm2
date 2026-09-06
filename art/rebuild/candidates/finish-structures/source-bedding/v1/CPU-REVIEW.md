# CPU prototype review

Both staged GLBs reproduce the exact legacy bounds and pivots. Each has one connected closed component, 49,152 triangles, no welded boundary edges, no nonmanifold edges, no degenerate indexed triangles, and Euler characteristic 2. These checks do not constitute exhaustive self-intersection testing.

The generator samples original source triangle depth and interpolated UVs. It uses those measured depth variations on both faces of a complete mass. The crown uses a smoothed profile sampled from the same scan. Original albedo, normal and packed material maps remain byte-identical. Normals are recomputed after deformation; the normal map strength is 0.4. Of 49,856 source samples, 1,656 use nearest source vertices where the open scan has no projected triangle coverage. The lower cap sits at the legacy negative base Y and should remain buried.

Scree has a measured 3.446 m rear-to-front quarter height difference. Its side view shows a continuous descending body and broad foot. Sunder has actual bedding relief on the rear, with no rectangular flat back.

I inspected all six generated clay previews. The major remaining art concern is the rounded overall Sunder profile. The source bedding is legible, but its mirrored repetition and the crown's converging surface bands still look constructed in these views. Scree's slope reads more clearly than Sunder's shape. These are concrete prototypes for comparison, not accepted replacements. Material stretching, the scan's strongest grooves, gameplay approach clearance and final-world placement remain untested.

`npx vitest run tests/bedded-shortcut-source.test.ts` passes both tests. The tests independently read the exported GLBs and check source/generator hashes, embedded map hashes, bounds, normals, connectedness and closed edge incidence.

No browser was started. No public asset, shared contract or world placement was edited.
