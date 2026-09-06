# Moose source revision 2 — static review candidate

The previous GLB and its three CPU renders remain frozen in the parent directory. This revision retains the complete CC0 Lyndon Daniels horse body while shortening and broadening its muzzle, raising upper-muzzle volume, compressing the original hair tail, retracting original ear tips, adding broad local pinnae, and replacing the distal equine hoof surfaces with eight compact paired shells.

Source rights and original acquisition evidence remain in ../../source-hoofed/LICENSE.md. Source URL: https://opengameart.org/content/realtime-ranchers-3d-model-pack . Original source SHA256 cdf4f716f7bd1a980814c53ed9fa81d28e016e2e316ed3f319982d7e3cbce782. New local appendages are Corealm authored.

CPU validation: 21,990 triangles, 32,321 vertices, no skins or actions. Vertex growth comes from explicit clipped-triangle remapping. Body source indices and interpolation weights are in body-source-vertex-map.json; composition with ../rig-mapping.json preserves the native provenance. Maximum UV interpolation error 2.95e-8; mapping weights sum to one exactly. Native missing Bone.005 remains unresolved. This is not animation-ready.

Hoof soles lie at 0.002 m, shell tops at 0.145 m, body clipping plane at 0.125 m. Each pair has a 0.012 m narrowest cleft. Source lower body clipping is an open intersection into closed hoof shells, not a welded manifold; animation work must weld or preserve junction overlap explicitly. Ear tips have small uncapped rings. No watertightness claim.

The muzzle is broader and less pointed, but the source mouth texture still produces equine creases. The short tail retains a visible hair tip. Broad ears are plain material and require coat blending. Lower-leg pale source markings remain. Front, side, and three-quarter CPU Cycles renders were inspected; this is not browser/GPU acceptance.

Run the owned generator tools/creature-expansion/hoofed/source-moose-horse.mjs from repository root. Then run validate-and-catalogue.mjs and audit-regions.mjs here. preview-cpu.py uses the previously verified Blender 4.5.11 runtime and explicitly selects CPU Cycles. review-catalogue.json targets creature_marsh_moose with +Y up/+Z forward and an identity wrapper. No public asset was changed.
