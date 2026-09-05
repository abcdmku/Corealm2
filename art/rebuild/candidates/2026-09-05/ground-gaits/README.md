# Frog and crab ground gait repair

All three staged GLBs pass the exported CPU skinning audit. They are ready for the root's production lab review. Public models and the live manifest were not edited.

Only Walk and Run change. The writer appends sampler data to the original GLB BIN and replaces those two animation entries. Every original geometry, UV, normal, skin-weight, inverse-bind and image byte remains exact. Node identities, hierarchy, rest transforms, materials and the other six animation entries and sampler bytes remain unchanged. Both frog variants retain their own original materials.

| Asset | Staged bytes | Native Walk m/s | Native Run m/s | Walk seconds | Run seconds |
| --- | ---: | ---: | ---: | ---: | ---: |
| [animal_frog.glb](animal_frog.glb) | 1,380,328 | 0.08 | 0.30 | 1.3333333731 | 0.7666667104 |
| [animal_frog_green.glb](animal_frog_green.glb) | 1,378,056 | 0.08 | 0.30 | 1.3333333731 | 0.7666667104 |
| [animal_crab.glb](animal_crab.glb) | 1,050,992 | 0.1086956522 | 0.2826086957 | 1.0666666031 | 0.4666666985 |

The frog has a low four-beat creep and a coordinated hind push, flight, forelimb landing and rear recovery. Front chains 014→015→016→017 and rear chains 010→011→012→013 retain their original segment lengths and scales. The distal forearm/metatarsal and palm orientations hold during stance and flex in the air. All 180 reviewed physical sole vertices stay in the audit. Run's body excursion is 105 mm rather than the source's approximately 375 mm. A 0.40 m/s candidate exceeded actual hind-leg reach during recovery, so the accepted native rate is 0.30 m/s.

The crab alternates two groups of four planted feet. Each root/middle solve targets its actual weighted mesh tip, including the two-bone blend at vertex 691. Terminal local transforms stay intact. Every stance foot travels in the same negative Z direction; source claws retain their articulation with matched loop pose and tangent. The source Run's 52.5 mm tip seam is gone.

## Physical checks

The final audit samples each serialized GLB over two cycles, with 3,840 intervals per cycle. This includes the frog Run's authored-key midpoints. CPU skinning evaluates the entire mesh for floor clearance and loop continuity. Contact checks retain signed velocities and report individual vertices, so opposite errors cannot cancel in a centroid or scalar average.

| Rig / clip | Maximum stance sole slip m/s | Maximum intended-plane slip, all phases, m/s | Maximum whole-mesh loop velocity difference m/s |
| --- | ---: | ---: | ---: |
| Frog variants / Walk | 0.000297 | 0.000294 | 0.009352 |
| Frog variants / Run | 0.001072 | 0.005152 | 0.013503 |
| Crab / Walk | 0.000854 | 0.006768 | 0.006897 |
| Crab / Run | 0.002040 | 0.007687 | 0.007024 |

Every clip has zero measured mesh penetration, zero whole-mesh positional loop discontinuity and finite deformed geometry. Minimum clearance is at least 0.4998 mm. Original groundY stays 0.002758 m for both frogs and -0.002 m for the crab.

The intended contact plane is the original groundY plus 0.5 mm clearance, with 1 micrometre tolerance for Float32/FK error. A separate broad 2 mm window retains airborne approach and release samples. Its maximum velocities are 0.230/0.610 m/s for frog Walk/Run and 0.182/0.349 m/s for crab Walk/Run. Those samples are not described as planted. Every per-foot maximum includes its vertex and cycle phase in the JSON reports.

## Integration evidence

- [report.json](report.json) contains the full three-asset audit and generator hashes.
- [manifest-updates.json](manifest-updates.json) contains the four gait metadata fields, source/staged hashes and promotion status for each asset.
- Per-asset JSON files contain the same preservation assertions, exact rates, source hashes and contact phase intervals.
- [final-integrity.json](final-integrity.json) verifies staged files, original public sources and generator hashes against the frozen report.
- [frog-dev-audit.json](frog-dev-audit.json) independently samples the authored frog at 3,840 intervals and checks source restoration.
- [crab-dev-check.json](crab-dev-check.json) checks crab authoring, source restoration on success/failure and claw tangent closure.

Four focused tests pass, covering velocity continuity, scaled-axis IK, exact GLB source preservation and rejection of a foot skating on the ground during declared swing. Scoped TypeScript passes. A fresh read-only writer/audit review found no remaining blockers; independent crab CPU skinning agreed with Three.js within 1.21e-8 m across 6,696 samples.

Root should check the source SHA before promotion, copy the staged GLB, and update its bytes/hash plus the four supplied gait fields. Drawn travel remains native speed × drawnStrideScale × playback rate. These rates include imported model scale and exclude runtime tier/build/axis scale.

Production screenshots, acceleration, turning, crossfades and visual anatomy acceptance remain with root. This offline pass does not claim those checks have passed.

Reproduce with `npx tsx tools/repair-ground-creature-gaits.ts` while the original public GLBs remain available as inputs. The command writes only this staging directory.
