**FAILED REVISION 1. Do not promote this candidate.** The later independent physical contact audit found maximum XYZ residuals of 3.372 m/s Walk and 9.289 m/s Run, and 1.503 mm Run burial. Generic Idle-to-locomotion blends reached 156.618 mm burial. Earlier stance-filtered p95 results below do not establish acceptance. Frozen GLB and catalogue remain reproducible evidence; revision 2 is being repaired separately. See `actor-independent-contact.json` and `actor-blend-audit.json`.

The isolated Lynx actor candidate is `actor-baked-preview-catalogue.json`, mapping `creature_duskoak_lynx` to `Lynx.actor-baked.glb`. It contains genuine Idle, Walk and Run. Attack, Hit and Death remain absent. This is ready for hardware review, not accepted for production.

The complete JonasDichelle Cat body was retained: 22,650 original vertices and 22,648 original polygons, exported as triangle corners with original UVs. Adaptations shorten the closed tail, broaden paws, add restrained connected cheek ruff, modify ear tips and apply a grey/buff dapple vertex coat. Tail and ear rest chains were adapted before animation evaluation. The two original eye meshes were reduced to 2,538 triangles each; the maximum original-vertex-to-reduced-surface distance is 0.2924 mm at intended scale. Reverse surface distance and hardware silhouette remain separate checks.

The source is JonasDichelle's “Rigged and animated Cat”, CC-BY-3.0, acquired from the public nrz/ylikuutio redistribution at commit `864ea1982524367ed416803db425f1895e4a0717`. Original FBX, license and source credits remain unchanged; exact URLs and hashes are in `historical-provenance.json`. Static source review files, original rig export and prior Cat/Lynx review candidates are preserved. `actor-preservation-audit.json` records their current hashes.

The runtime rig is an explicitly changed, source-derived bake. Original bone names remain, but the original hierarchy and animation channels do not. There are 196 skin joints: 120 named source joints and 76 shared corrective joints. Affine corrective transforms use two standard TRS nodes with temporally aligned SVD decomposition; five original joints also require an extra frame node. The result adds 157 transform nodes and uses 669 channels per clip. It uses only four normalized influences, fitted against full Blender deformation; it does not silently truncate source weights.

Idle is a new three-second neutral-rest motion with independent breathing, head and ear movement and four planted feet. Walk remains 1.125 seconds and Run remains 14/24 seconds. Their inconsistent original endpoint poses were replaced with periodic cubic closure. Actual weighted sole vertices drive three-bone leg IK, with explicit stance timing and constant paw orientation during support. Limited body lowering preserves limb lengths during landing. Original Walk/Run behavior is intentionally modified, not claimed unchanged.

The authored source-space stance speeds are 0.65 m/s and 2.2 m/s. `impliedWalkMps` and `impliedRunMps` carry these measured values; the renderer still applies actual drawn scale. Existing game movement stats and cadence caps were not edited. Full-cycle strides are 0.73125 m and 1.283333 m. Motion owner `/root/motion` received the proposal and measurements.

The full-mesh validation includes 116 training poses, 113 midpoint poses and 69 independent random poses, each with 22,650 vertices. `actor-baked-interpolation-report.json` reads final GLB bytes and applies their standard TRS interpolation; `actor-baked-three-proof.json` cross-checks Three's production loader and skin evaluation. `actor-contact-report.json` measures actual contact-vertex velocities, not ankle pivots. Source and converted seam differences are recorded separately.

Current limits remain visible in those reports. Random-pose position RMS is about 0.462 mm, p99 2.323 mm and worst error 9.877 mm in the torso. Maximum normal-response difference is about 24.51 degrees; numerical average error does not clear that local shading concern. Final whole-mesh floor penetration is about 0.123 mm Walk and 0.135 mm Run from interpolation. Worst paw contact-vertex horizontal slip p95 is about 0.0085 m/s Walk and 0.0102 m/s Run. New loops close to below 0.00003 mm at endpoints. Hardware review must assess body shape, materials, motion transitions, stance, and the flagged torso/limb areas.

CPU regeneration, after the source/helper dictionary is present:

1. Run Blender with `--background --factory-startup --disable-autoexec --python actor_data.py`; repeat with `-- --random` and `-- --dense`. All script paths are within this folder.
2. Run `python fit_correctives.py --actor`, then `python build_baked.py --actor`.
3. Run `python validate_baked.py --actor`, then `python actor_contact_report.py`.
4. From the repo root, run `node tools/creature-expansion/mammals/source-feline.mjs --actor-catalogue`.

No renderer, public assets, shared manifest or gameplay contracts were edited, and no GPU was used in this lane. Root owns the hardware review and production promotion.
