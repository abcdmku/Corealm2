# Rock 09 original source inspection

Selected original source: [Rock 09 by Jenelle van Heerden / Poly Haven](https://polyhaven.com/a/rock_09). Poly Haven identifies its downloadable assets as CC0 in its [asset license](https://polyhaven.com/license). Official API metadata, original geometry, original 1K maps and verified file hashes are recorded locally in inspection.json. No website preview images were downloaded; all three clay views were generated locally from the original geometry.

The downloaded glTF contains 12,416 triangles and 6,628 render vertices. Positional welding at a scale-relative tolerance yields 6,210 unique vertices, one connected component, no boundary or nonmanifold edges, Euler characteristic 2 and positive signed volume. These are topology checks, not exhaustive triangle self-intersection testing. The website's displayed aggregate triangle count differs; the report uses the actual downloaded index buffers.

I inspected front.png, rear.png and side.png before downloading the maps. This source has a complete back and an angular, fractured elongated body. Its low end and layered upper ridges are real source geometry, with no generated rings, panel seams or body assembly. It is promising for a sloping outcrop. The natural scan is small, with bounds 0.07401 × 0.03287 × 0.14462 m; any game-scale adaptation must preserve the source fracture proportions and be reviewed separately. Its underside is comparatively plain and should remain buried.

Only source acquisition and CPU inspection are complete. No reshaped derivative, GLB conversion, GPU run, public asset change or world integration was performed. Earlier failed prototypes remain intact in the parent directory and v1 history.
