# Actor motion CPU review

Reviewed `actor_motion.py`, SHA-256 `38aab84ef74d4ca3f34b677d7cbd72365bad445f35842ac69b6ee5fe8661340d`. The review used a fresh unsaved Blender 4.5.11 scene, imported the frozen historical FBX, muted its NLA tracks, applied the current Lynx adaptation, and instantiated `ActorMotion`. No helper, archive, preview or production asset changed. No GPU was used.

No blocking native-cache or loop-period error was found in this version.

## Verified behavior

The constructor caches 27 Walk poses and 14 Run poses before authoring Idle. Both new IK and paw-rotation constraints have zero influence during caching. It assigns each source action and slot before changing frames. The excluded final source key is replaced by the periodic interval from the last retained key to the first. Periods remain 27/24 and 14/24 seconds. Sampling clears the source action and reconstructs every cached bone basis, so an earlier repaired sample does not become the next native sample.

Quaternion hemisphere handling aligns the four local interpolation keys before normalized cubic interpolation. The sampled source does not reveal a seam failure. Exact phase-zero versus end-of-period whole-body position mismatch was 0 mm for Walk and Run. Sampling the same zero time after intervening phases also returned a 0 mm mismatch. A 0.0002-second interval straddling the seam moved vertices by at most 0.162 mm for Walk and 0.719 mm for Run. These small nonzero distances are expected motion over elapsed time, not exact-loop error. This probe does not prove a velocity-continuity bound at every quaternion interpolation key.

Idle moved the body by up to 3.386 mm between phase zero and quarter cycle, so it is not a frozen or renamed locomotion pose. Nine evenly spaced Idle phases plus a repeated zero sample produced unchanged paw centers and a maximum sole-target error of 0.000072 mm. The repeat matched exactly.

The source-units-to-millimetres factor of 100 is correct for the current 0.1 display scale. All dimensions inside the helper remain source units. `root_drop` capped at 0.40 therefore means 40 mm at that scale, not 0.40 metres.

## Measured residual and proof limits

I independently sampled 101 evenly spaced phases per repaired locomotion clip and measured every body vertex for penetration. Walk's worst sole-target residual was 0.00479 mm and worst horizontal median-sole-center residual was 0.03797 mm. Whole-body penetration peaked at 0.00266 mm. Run's corresponding maxima were 0.82453 mm, 0.47606 mm and 0.000158 mm.

Run exhausted the eight outer correction iterations around phases 0.62 and 0.63. At phase 0.63 the rear-right landing transition retained a 0.82453 mm sole-target residual after a 28.624 mm root drop. This is a measured nonconvergence, even though the remaining error is below 1 mm. The helper returns its residual instead of failing. Downstream acceptance must check that field against its actual threshold; a completed sample alone is not convergence proof. Increasing iterations is only justified if the required threshold is tighter than the measured residual.

Floor and center reports cannot by themselves establish that every contacting surface point has no slip. The solver constrains a median of fixed sole vertices and the minimum height across its foot mask. Paw roll or deformation can change which vertex supplies that minimum. Final stance proof should compare actual contact vertices in translated world space, in addition to the existing center and floor audit. My dense probe verifies penetration and these reported targets only.

The current caller setup mutes NLA tracks before construction. The helper itself does not do so. All reviewed source callers use that setup, so this is not a current integration defect. Reusing the class on a raw import with active NLA tracks would invalidate the cache and reconstructed-pose assumptions.

The periodic closure and contact repair intentionally alter the source motion. A derivative license notice and the existing distinction between source-preservation proof and authored-motion proof remain necessary. Final GLB interpolation, contact, transitions and hardware readability are outside this read-only code review.

After these probes, the author reported changing the reach margin from `length * 0.985` to `length * (1 - 0.015 * blend)`. That change fades the margin as support influence vanishes and removes the former branch-boundary step risk. The numeric results above belong to the reviewed hash, before that change. The author separately reports a 0.822 mm maximum residual during airborne prelanding at Run phase 0.625, with all support flags false. I did not rerun the revised file, so that updated figure is attributed to the author rather than this independent probe.
