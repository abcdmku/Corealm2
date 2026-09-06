# Native Rat contact inspection

The wrapper floor correction hides substantial native toe penetration. It is not contact acceptance. Original bytes remain frozen at SHA-256 `ed0f9a8df62321d9aebcde6c9384a97464f67d9cdabf7f21b1ec2e7e6c3c3047`; no anatomy or motion edits were made.

The inspection removed the `giant_rat_floor.position` tracks and sampled original motion at 240 Hz. The adapter's fixed Idle.001 grounding remains, leaving 4 mm clearance at idle. Model height is 340 mm. Mesh patches were classified by strongest native `.002` ankle or `.003` toe influence. This identifies the responsible region but does not prove that one joint alone controls every affected vertex.

| Clip | Maximum wrapper lift | Lowest native mesh point | Cause at worst sample |
| --- | ---: | ---: | --- |
| Idle | 0 mm | +4.000 mm | Front-left toe |
| Walk | 31.861 mm | −27.825 mm | Hind-left `.003`, phase 0.411 |
| Run | 21.806 mm | −17.558 mm | Hind-right `.003`, phase 0.080 |
| Attack | 3.669 mm | +0.331 mm | Tail segment at end; above the actual floor |
| Hit | less than 0.001 mm | +4.000 mm | Numerical noise |
| Death | 32.642 mm | −28.638 mm | Front-right `.003`, phase 0.641 |

HitLeft and HitRight alias the same native Hit. Their maximum lifts are also less than 0.001 mm. Wrapper values use every native key plus a 60 Hz grid; uncorrected minima above use a separate 240 Hz grid, so subtracting one from the other is approximate.

Walk's worst hind-toe penetration occurs while the hind `.002` mesh patches remain at least 4.59 mm above ground and the `.003` joint origins remain at least 15.90 mm high. This supports the shared worker's diagnosis of downward distal toe rotation. It does not support raising the entire animal. Front Walk patches are more complicated: the `.002` regions also reach −6.21 mm, so a toe-only repair cannot yet be assumed sufficient there.

Death is similarly concentrated in the front-right toe. Its `.002` mesh patch stays above 1.41 mm and the toe joint origin stays above 16.98 mm while the toe tip reaches −28.64 mm. A bounded distal correction could be proposed without changing the collapse or body motion.

Run has both toe and ankle-region penetration. The hind-right `.002` mesh patch reaches −11.25 mm, and the hind-left reaches −6.96 mm. The strongest-influence classification cannot distinguish a `.002` rotation issue from blending with `.003`; review those exact influences before proposing a broader correction.

Run also has genuine airborne intervals. A separate 1,000-sample sweep, excluding the repeated endpoint, puts every sampled foot patch above 9 mm for 20.1% of the cycle. At 14 mm the fraction is 15.0%; at 4 mm it is 29.2%. These are threshold-dependent mesh estimates, consistent with a flight phase. They are not evidence that feet should stay planted throughout Run.

Proposed next step, pending root direction: evaluate the smallest distal `.003` rotation correction needed for Walk hind toes and Death front-right toe, keeping source positions, proximal channels and body motion unchanged. For front Walk and Run, first inspect the `.002`/`.003` weighted patch before choosing the correction. Preserve flight and compare stance drift. Do not use whole-body floor lifting as proof that the original contact defect has been repaired.

Detailed values, worst-pose joint quaternions and sample counts are in `contact-review.json`. No GPU or gameplay acceptance was run.
