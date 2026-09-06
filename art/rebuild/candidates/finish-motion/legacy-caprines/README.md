# Legacy caprine gait repair

Candidates only. No public asset was changed. `manifest-updates.json` records offline results; browser and visual acceptance remain required before promotion.

The author replaces only Walk and Run sampler entries by appending new buffers. The original BIN prefix, geometry, materials, hierarchy, rest transforms, other clips, clip durations, native gait speeds and stats remain unchanged. `assertSourcePreserved` checks the serialized result.

The articulated Hip/Knee1 solve preserves source segment lengths. Knee2 retains its original world orientation. Each ankle has a fixed 0.12 rad forward pitch, placing the real distal hoof surface on the floor. The root lowers by 0.12 m with a 0.005 m cosine bob. The solver iteratively corrects the actual weighted primary-sole centroid. It does not translate individual joints or stretch limbs.

Sole selection measures the original mesh after that actual hoof orientation change. Every positive distal-joint skin influence is eligible, including weights below 50%. Every eligible vertex within 20 mm of the measured hoof minimum belongs to the audited sole. Primary vertices are those within 0.3 mm of that minimum. The independent whole-mesh contact probe additionally checks all vertices without branch or foot selection.

The existing unmodified `auditGroundGait` runs at 7,680 samples per cycle for two cycles, checking the 3,840-interval bake at keys and midpoints. It checks signed virtual root velocity, every selected primary vertex, all near-floor sole vertices, incidental physical contacts, whole-mesh penetration and loop continuity. The independent `contact-coverage-probe.ts` checks all-mesh physical-plane contact at the same density. Candidate JSON contains `audit[].authoringDiagnostics`, including hoof pitch, crouch and measured reach margins.

Run `npx tsx tools/creature-motion/stage-caprine-gaits.ts` to regenerate. The command returns nonzero if either asset fails its gait audits. Run the independent whole-mesh probe on each resulting JSON before promotion. Five focused tests verify source preservation, unchanged segment translations and actual weighted hoof height/velocity during stance; they do not establish gameplay acceptance.

Rejected attempts tried to keep the bind-rest heel patch planted. Some heel vertices have a small upper-leg influence, such as goat vertex 336 with 1.48% Knee1, so fixed distal orientation alone allowed sliding. Numerical ankle/Knee2 fits either retained excess slip or required excessive correction. The final fixed hoof pitch uses actual distal sole contact instead, and the full physical audit remains unchanged.
