# Horse-derived moose source candidate

Static candidate for critique, not accepted gameplay art. The complete CC0 Horse by Lyndon Daniels is reshaped through one continuous anatomical transform. Body, skull, ears and all four legs retain source topology and UVs. Original mane and tail are shortened and repositioned. Source eye meshes are reduced, seated outward and given a dark material because their original UV attributes were absent. Corealm palmate antlers and a throat bell are local additions.

The source is [Realtime Rancher's Horse](https://opengameart.org/content/realtime-ranchers-3d-model-pack), CC0. License evidence and frozen originals remain in `../source-hoofed/`. Corealm additions remain project-owned. No source-hoofed files were edited.

References inspected: [NPS Rocky Mountain moose](https://www.nps.gov/romo/learn/nature/moose.htm) and [NPS Yellowstone moose](https://www.nps.gov/yell/learn/nature/moose.htm), including NPS/Jacob Frank's standing moose photograph. These informed long legs, a raised shoulder, lower pelvis, drooping nose, broad ears and palmate antlers. Preserved reference photographs are not textures. WDFW returned HTTP 403 and was not used.

Authored measurements, not measurements taken from photographs:

- Shoulder/pelvis height ratio: 1.010 source, 1.128 adapted.
- Shoulder landmark: 2.324 m. Pelvis landmark: 2.061 m.
- Belly clearance / shoulder height: .478 source, .554 adapted.
- Full source bounds: .970 x 2.400 x 3.621 m. Adapted bounds: 1.735 x 2.919 x 3.080 m, including antlers.
- Fore medial hoof centers: x=+/-.29 m, z=.521 m. Hind: x=+/-.26 m, z=-.670 m. Medial centers lie inside the cleft; actual global floor is .002 m.

`adaptation.json` records original and adapted landmarks, parameters and hashes. `cpu-validation.json` verifies finite attributes and preserved source indices/UVs. Candidate has 20,678 triangles, 14,408 vertices, zero skins and zero animations.

`rig-mapping.json` preserves native vertex groups and 19 original/adapted bone endpoint pairs. All 4,313 exported body vertices map to source native vertices within 1.36 micrometers. The native rig is incomplete: absent Bone.005 influences 1,298 vertices, including 330 above weight .5. No actions exist; source appendages were unweighted. Those unresolved assignments are retained explicitly, never silently reassigned.

CPU-only Cycles front, side and three-quarter previews were inspected. They caught and corrected detached tail hair, low flat ears, blank source eyes and a centerline deformation error. Current images are `front-cpu.png`, `side-cpu.png`, `three-quarter-cpu.png`. Remaining visual questions are the narrow angular muzzle, coarse hoof clefts and ear rims, and residual source coat shading. These are source QA views, not production acceptance.

`review-catalogue.json` targets `creature_marsh_moose`, with exact hash/bytes, +Y up/+Z forward and identity wrapper. Use static front/side/rear/gameplay views only. It claims no motion clips.

Rebuild from repository root with `node tools/creature-expansion/hoofed/source-moose-horse.mjs`, then this directory's `map-rig.mjs` and `validate-and-catalogue.mjs`. `preview-cpu.py` uses the installed Blender 4.5.11 in background mode and explicitly selects Cycles CPU. No GPU sessions or production registrations occurred.

Candidate SHA-256: `29fed85c52a9447d00101fc344a3bfc7fd31e55e1aec23a3f1a85aa80cf50545`.
