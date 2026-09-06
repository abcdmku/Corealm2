Paused at root request after all three running CPU data jobs completed. No fitting, export, GPU review or production promotion followed the pause instruction.

The latest exported test GLB is `Lynx.actor-contact-v2.glb`, SHA256 `a78c815d15292dfd2d1cd0368396a6f13989b8c1f09655e0e0c9c35ef506b008`, 20,243,976 bytes. It is **not accepted**. All source archives, frozen source/body review candidates, and revision1 GLB/catalogue remain untouched.

Its independent physical contact test fails the unchanged maximum XYZ limit of12mm/s: Walk460.465mm/s, Run64.958mm/s. The same original vertex must be at or below floor+0.501mm at both timestamps, independent of stance labels. The audited floor stayed within0.00050mm burial. See `actor2-independent-contact.json`.

The actual Three generic blend audit passes its sampled0.5mm floor limit: 1,842 samples, worst interior burial0.000109471mm, worst standalone0.000420337mm. This proves sampled floor placement only, not contact velocity or visual quality. See `actor2-blend-audit.json`.

The final-byte full-weight comparison uses298 poses. Random-pose RMS0.8289mm, p99 2.2964mm, maximum18.8226mm at Walk0.45455962s, source paw vertex11921. Maximum sampled normal-response error9.5149degrees. The large paw error comes from a fast stance-to-native-swing target release between exported keys. See `actor2-baked-interpolation-report.json`; it remains explicitly unaccepted.

An unexported repair is saved in `actor_motion_v2.py`: complete periodic Hermite foot swings anchored to the rest stance, matching backward stance velocity at both ends, instead of blending toward an unrelated native airborne foot target. Swing clearances are30mm Walk and45mm Run. Native body-pose attenuation remains50% Walk/22% Run; durations and game speeds remain unchanged. These are intentionally authored/modified locomotion trajectories, not unchanged native clips.

The three latest `actor2-*-data` NPZ/JSON pairs match this unexported helper. Training/midpoint229 poses have maximum solver sole-height residual0.000481mm; random69 poses0.000481mm; dense994 poses0.003498mm. These are solver target errors only. They do not establish final vertex contact, interpolation or acceptance. **The existing `actor2-corrective-fit.npz`, GLB and audit reports predate these latest datasets. Do not rebuild using the stale fitted weights.**

To resume after authorization: fit `fit_correctives.py --actor2` against the saved current training data, then build `build_baked.py --actor2`; run `validate_baked.py --actor2`, `independent_contact.py --v2`, and the independent Three `actor-blend-audit.mjs --v2`. Report maximum XYZ, actual wholemesh burial, random interpolation and local normal errors without changing limits. New failures need another isolated repair round. Only after those checks should the new `--actor2-catalogue` emitter be used; that emitter passes Node syntax checking but has not produced a catalogue yet. It writes separate actor2 outputs and uses string-array animation names.

Revision1 handoff is marked FAILED to prevent its older stance-filtered p95 report from being mistaken for acceptance. `PAUSED-ACTOR2-CHECKPOINT.json` records exact current file hashes. No combat/death clips exist yet. Root retains hardware review and integration ownership.
