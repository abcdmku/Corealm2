# CPU review and separate revision

Rendered and inspected `cpu-stills-v1/{front,side,threequarter}.png`, using the editable source blend in rest pose, Cycles with device explicitly set to CPU, 16 samples, 720 square pixels, neutral ground and two area lights. No GPU or production viewer was used.

V1 had an excessively elevated horn arch with abrupt exposed roots, very pointed toes, and a pale overall finish. `adapt-v2.py` lowers the horn curl onto the cheek, embeds its roots deeper in the existing skull, reduces its cross-section, broadens the original toe vertices and flattens the sole. It darkens the coat while keeping the pale rump and muzzle. Both revisions retain the whole 1,470-vertex source body before subdivision, original UVs, original named weights and 22-bone rig. The same CC BY-SA 3.0 attribution and share-alike terms apply.

Rendered and inspected all three `cpu-stills-v2` views. V2 has a more compact horn silhouette and weight-bearing feet, and the source ears are visible again. Its shortcomings remain visible: the small source eyes and nose are subdued, the lower legs are still simplified, the horn growth grooves are subtle at this framing, and the broad source hoof tips do not yet have a convincing cloven split. This is a source anatomy selection candidate, not final-quality or runtime acceptance.

The original rest GLB and catalogue are preserved. The separate `v2/review-catalogue.json` targets the v2 rest bake. Use `node tools/creature-expansion/hoofed/source-bighorn-sheep.mjs --v2` to rebuild it. Source motions are still explicitly rejected for contact, with no missing-role aliases. No animation repair was attempted during this silhouette review.

## V3 local hoof retopology

V2 is frozen. V3 adds four real narrow distal hoof clefts to the subdivided whole source body, slightly narrows the pastern region, and darkens the existing source eye and nose areas. The clefts terminate below the continuous source pastern, leaving compact paired weight-bearing toe tips instead of separate attached hoof blocks. An initial eye-color patch was misplaced; it was corrected to the existing eye before the final three CPU stills were inspected.

The final `cpu-stills-v3` front and three-quarter views show the toe splits without long slots up the leg. The side view shows the original head silhouette and a readable recessed eye area without an attached eye bead. The naturalistic source still has stylized anatomy, but the specific unsplit-hoof and misplaced-eye defects identified in this round have been corrected.

Topology is now explicitly changed: 1,470 original source vertices become 6,050 body vertices and 6,004 polygons after subdivision and local cuts. `v3/source-vertex-nearest-map.json` records descriptive nearest-source correspondence, not a claim of exact unchanged topology. Existing UVs and body weights interpolate through subdivision; distal hoof vertices use the corresponding original forearm or shin bone. All 22 bone names and seven genuine source actions remain available. Contact failures remain documented and no production animation roles are claimed.

`v3/review-catalogue.json` and its asset ledger are separate from v1/v2. Rebuild with `--v3`. This review uses Cycles CPU only and does not constitute production acceptance.
