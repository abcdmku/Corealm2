# Giant Rat contact round 2

This candidate passes CPU contact checks for three approved distal toe channels only. It is not accepted for gameplay or visual quality. Front Walk, all Run contact, and the newly exposed Death head penetration remain HOLD.

The original native GLB remains unchanged at SHA-256 `ed0f9a8df62321d9aebcde6c9384a97464f67d9cdabf7f21b1ec2e7e6c3c3047`. No shared files, geometry, weights, textures, proximal motion or body motion were changed. All 133 joints and 100 corrective joints remain present. The adapter no longer adds animated whole-body floor lifting.

`toe-contact.mjs` changes only these rotation channels:

| Clip | Native joint | Largest angular change | Minimum corrected patch clearance |
| --- | --- | ---: | ---: |
| Walk | BackLeg_L.003 | 76.721 degrees | 0.4987 mm across both hind patches |
| Walk | BackLeg_R.003 | 76.668 degrees | 0.4987 mm across both hind patches |
| Death | FrontLeg_R.003 | 88.274 degrees | 0.4999 mm |

The helper finds the smallest interpolation toward an upright native Idle toe orientation that clears the affected weighted patch, preserving the current toe pivot. A small adjustment of that reference orientation is allowed when the moving ankle makes the fixed reference insufficient. The upright constraint rejects upside-down toe solutions. It is applied only to the three approved distal channels, including smoothing portions of their swing. No root or ankle correction is added.

An earlier minimum-angle pitch solver switched between opposite orientation solutions. Its exported interpolation penetrated the floor despite individually clear keys. The final helper avoids that solution switch, and the audit tests the exported bytes independently.

The changes are substantial: maximum weighted vertex displacement is 109.741 mm in Walk and 82.363 mm in Death. The largest angular change is 88.274 degrees. These magnitudes require visual scrutiny; a contact pass does not establish anatomically acceptable motion.

Final candidate: `art/rebuild/candidates/finish-bestiary/giant-rat-contact-round2/giant_rat.glb`.

Candidate SHA-256: `0a490a7e79df4ff88757d86481e9ed395e17d7a62fd805b13b1b239455ed3681`.

The same directory contains `baseline.glb`, both metadata files and `final-byte-contact-audit.json`. The baseline has fixed idle grounding and no toe corrections or animated floor lift.

`audit-contact-bytes.mjs` independently evaluates final GLB animation and skinning through NodeIO. Changed clips are sampled at 1200 Hz plus 157 seeded random times each. Other clips use 120 Hz plus 157 random times each. It verifies exact channel-array equality outside the three approved rotations, unchanged geometry attributes, 133 joints, zero unrelated vertex deformation and the frozen native source hash.

Residual limits, intentionally unmodified:

- Front Walk reaches −21.360 mm, dominated by FrontLeg_R.003.
- Run reaches −17.780 mm. Every Run channel and all sampled Run geometry are identical to the baseline, preserving native flight.
- Death Head reaches −11.834 mm at 0.9175 seconds. Correcting the deeper toe penetration exposed this separate existing issue.

Use `await buildGiantRat(id)` for the bounded candidate or `await buildGiantRat(id, {repair:false})` for the faithful baseline. `export-contact.mjs` writes the separate candidate directory. `audit.mjs` checks baseline source parity; `audit-contact-bytes.mjs` checks the final bounded correction. All attribution and original source metadata are preserved. No GPU was used.
