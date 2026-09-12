# Mossy bank candidates

Run `node tools/fairy-terraces/bank-build.mjs`, then `node tools/fairy-terraces/bank-preview.mjs` from the repository root. The builder uses the pinned source audit produced by `rocks-stage.py` and writes only `test-results/fairy-terraces-assets/banks/`. Candidate catalog, GLBs, texture atlases and per-asset audits stay staged. Root owns feature-lab acceptance and promotion.

The assets retain the full original Pure Nature 2 Asian Mountains `AsianCliff_0_LOD0` (15,268 triangles) and `AsianCliff_1_LOD0` (30,790 triangles). They use uniform 0.5 and 0.4 scale after centimetre conversion, without stretching, smoothing, decimation or UV changes. A rigid translation centres XZ and grounds the native minimum Y. All output positions, normals and UVs are verified against the serialized GLB roundtrip.

| Asset | Width × height × depth | Suggested burial |
| --- | --- | --- |
| fairy_moss_bank_0 | 7.094 × 4.525 × 5.416 m | 0.65–0.8 m |
| fairy_moss_bank_1 | 7.494 × 4.807 × 6.894 m | 0.4–0.6 m |

The suggested burial hides the source's tapered underside and exposes a broad lower skirt. Bank 0 is 6.23 m wide at local Y 0.5; bank 1 is 7.40 m wide at Y 0.25. Position from the lowest terrain height sampled across the complete footprint, then bury. Overlap these into the terrain bank, with vegetation across its upper seam; an isolated full crag looks like a block. `grounding-sections.json` records measured source cross-sections.

The material uses original rock albedo/normal/masks, original Grass01, and the source triplanar detail normal. A smooth orientation mask and low-frequency variation spread olive moss over the cap and upward-facing ledges. Stone is muted to warm grey, with full original fissure and normal detail. No image-generation or replacement texture is used. Source files and package SHA256 are recorded in each audit and the candidate manifest.

The source AsianCliff albedo PNG contains valid RGB with alpha identically zero; Unity's opaque source shader ignores alpha. A single Sharp RGBA resize wipes that RGB through alpha premultiplication, even when `removeAlpha()` is called first in the same pipeline. The builder first decodes a separate opaque raw RGB buffer, resizes that independently, and restores the source alpha channel separately for packed-mask reads. This preserves all authored RGB. Moss uses flat normal blending while original rock and detail normals remain.

The four CPU previews are material/silhouette diagnostics. They are labelled accordingly and do not substitute for gameplay screenshots. Production source, public assets and the manifest are not modified by these tools.

The previous `fairy_boulder_4` has an identity GLB node matrix and minimum vertex Y approximately zero. The native lower body is narrower than its middle, but it broadens to 6.90 m at local Y 2.0. There is no hidden node translation in the staged or public GLB, and the asset loader only clones that identity scene. Apparent floating in a world screenshot therefore needs instance-placement/contact/shadow investigation rather than an asset-origin correction.
