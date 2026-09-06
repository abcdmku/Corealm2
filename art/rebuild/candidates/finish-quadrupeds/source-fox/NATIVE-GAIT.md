# Native Fox motion measurements

CPU sampling preserves the unchanged source clips and includes the preview's uniform 0.01 scale. `native-gait.json` contains every sampled frame and candidate contact velocity. Reproduce with `node tools/creature-expansion/mammals/source-fox.mjs --gait`.

The sampler evaluates glTF LINEAR translations and quaternion rotations, reconstructs joint world matrices and skins all 1,728 vertices through their original inverse bind matrices. Bind reconstruction agrees with node-transformed source vertices within 0.000000112 metres. Each clip has 241 samples including both endpoints. This is source motion evidence, not production gameplay proof.

The source faces +Z with +Y up. The head joint is at z=0.362 m and terminal tail joint at z=-0.673 m in the scaled bind pose. No orientation rotation is needed for the existing gallery. Backward stance motion therefore has negative Z velocity.

## Whole-mesh floor and loop results

| Native clip | Duration | Minimum mesh Y over clip | Range of per-frame mesh minimum Y | Maximum loop endpoint vertex displacement |
| --- | --- | --- | --- | --- |
| Survey | 3.417 s | -1.31 mm | -1.31 to -1.30 mm | 0 |
| Walk | 0.708 s | -20.20 mm | -20.20 to +13.62 mm | 0.000041 mm |
| Run | 1.158 s | -37.33 mm | -37.33 to +63.50 mm | 0.000010 mm |

Survey keeps the soles almost fixed while the upper body surveys. Each tracked sole's vertical range is under 0.04 mm. It is a plausible idle source, but its head and torso motion still need visual review. It must not be described as a motionless pose.

Walk and Run close their loops accurately. Their contact heights and velocities vary enough that one guessed travel speed or floor offset would hide real differences. The positive Run minima may include intentional airborne phases. Hardware temporal review must distinguish those from unwanted floating.

## Distal joints and measured candidate stance

Each foot tracks the same source vertices throughout the clip: vertices with at least 50% combined distal joint weight, restricted to a 25 mm band above that foot's bind minimum. Candidate stance requires consecutive sole minima within 15 mm of that foot's clip minimum and centroid vertical speed at most 0.15 m/s. These thresholds infer contact and are not authored contact labels.

| Foot | Distal joint | Tracked vertices | Walk median backward speed | Walk samples | Run median backward speed | Run samples |
| --- | --- | --- | --- | --- | --- | --- |
| Fore right | `b_RightHand_08` | 24 | 1.840 m/s | 17 | 4.643 m/s | 2 |
| Fore left | `b_LeftHand_011` | 24 | 0.967 m/s | 52 | 0.981 m/s | 5 |
| Hind left | `b_LeftFoot02_018` | 27 | 1.406 m/s | 36 | 2.736 m/s | 5 |
| Hind right | `b_RightFoot02_022` | 27 | 0.616 m/s | 83 | 2.146 m/s | 10 |

Hind regions also include their preceding `b_LeftFoot01_017` or `b_RightFoot01_021` joint. Fourteen hind-right Walk candidate intervals move forward instead of backward. Walk per-foot medians span roughly threefold. Run's fore-right statistic has only two qualifying intervals and cannot support a reliable metadata value. The recorded p10/p90 spreads and full velocity samples are retained in JSON.

No implied walk/run speed has been written into either catalogue. These results justify retaining the complete source for visual comparison while withholding motion acceptance. If the body passes, the source gaits may need contact correction on the native rig before runtime travel can be accepted. Attack, reactions and Death remain absent and must be authored separately; no clips have been aliased or edited.
