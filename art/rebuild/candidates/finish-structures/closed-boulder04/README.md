# Native-base Boulder 04 candidates

These separate candidates use one whole Namaqualand Boulder 04 mesh each. The original scan is by Jenelle van Heerden / Poly Haven, CC0-1.0. Original POSITION, NORMAL, TEXCOORD_0, indices and all three 1K maps remain unchanged. Source channels and map equality pass two focused tests in tests/boulder04-shortcuts-source.test.ts. Each candidate contains 59,066 triangles.

Only yaw and declared affine axis fitting are applied. Pitch is zero and the source base orientation is preserved. Both models fit the exact legacy bounds and base. Sunder uses yaw 30 degrees, chosen for the lowest axis distortion among 5-degree samples. Scree uses yaw 110 degrees, chosen for the greatest native descent among those samples. Scree's rear-to-front quarter descent is 1.3225 m, below the required 2 m; the catalogue records this failure explicitly. No tilt was introduced to force that requirement.

I inspected all twelve CPU clay views. The candidates are thick complete bodies with visible original fractures and no assembly seams or thin-card rims. Their source texture treatment still needs browser inspection. No visual acceptance is claimed.

Actual production terrain was measured with current generated entities, scale and yaw, using tools/inspect-rock09-grounding.ts with this catalogue as an argument. Evidence is in test-results/boulder04-world-grounding/report.json and four inspected X/Z section plots. Production source hashes were unchanged during the diagnostic.

At the unchanged authored placements, Sunder has 8.92% sampled contact and a 0.382 m underside gap at its volume centroid. Scree has 19.19% contact and a 0.420 m centroid gap. Neither centroid projects inside its supporting contact hull. Median gaps are 0.350 m and 0.476 m respectively. This is much closer to the ground than the rejected tilted Rock 09, but current placement is still not accepted. No candidate pivot, terrain or public asset was changed to hide these gaps.

Generate with tools/build-boulder04-shortcuts.ts. The full catalogue records source hashes, native topology, selected yaws, transforms, material metadata and flat-ground diagnostics. Earlier candidates remain intact.
