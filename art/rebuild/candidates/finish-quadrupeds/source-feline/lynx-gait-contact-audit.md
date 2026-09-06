# Adapted Lynx native gait contact measurements

CPU measurements use the full source-weighted adapted mesh targets. These are candidate repair windows, not accepted floor contacts. No GLB, source, animation or rig changed.

Sampled native-action world positions are already near-origin metres. Z is up; negative Y is forward. Native actions replace the initial FBX scene-placement transform, as documented in bake_data.py. Each foot includes vertices with at least 0.5 summed weight in its exact hierarchy. Fixed lowest 20 percent rest vertices define the median sole center; the height measurement uses the actual minimum of all selected foot vertices.

| Clip | Foot | Sole Z min / max, m | Forward range, m | Candidate phase windows | Backward speed, m/s | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| Walk | front_L | -0.2791 / -0.2508 | 0.5136 | [[0.0, 0.6851851851851852]] | 0.658 | moderate |
| Walk | front_R | -0.2953 / -0.2592 | 0.5593 | [] | none | low |
| Walk | hind_L | -0.3085 / -0.2713 | 0.4061 | [[0.7777777777777778, 0.9259259259259259]] | 0.133 | moderate |
| Walk | hind_R | -0.3054 / -0.2611 | 0.5160 | [[0.4444444444444444, 0.48148148148148145]] | 1.026 | low |
| run | front_L | -0.3041 / -0.0620 | 0.6738 | [[0.21428571428571427, 0.39285714285714285]] | 3.223 | moderate |
| run | front_R | -0.3040 / -0.0658 | 0.6364 | [[0.14285714285714285, 0.25]] | 5.648 | low |
| run | hind_L | -0.3198 / 0.0089 | 0.9700 | [[0.8214285714285714, 0.8928571428571429]] | 5.951 | low |
| run | hind_R | -0.2777 / -0.0286 | 0.9677 | [[0.6428571428571429, 0.8928571428571429]] | 3.994 | moderate |

Candidate intervals require both sampled endpoint sole heights within the larger of 12 mm or 20 percent of the observed vertical excursion above that foot minimum, plus backward center travel above 0.025 m/s. End phases greater than 1 wrap through zero. Half-frame samples give 1/48-second resolution. Windows are intentionally conservative; they are inputs for IK repair, not species timing metadata.

Per-foot minima differ and backward speeds may disagree. A common ground plane and speed require a contact repair pass and renewed measurements. The median sole center tracks the visible paw surface rather than a possibly misleading bone pivot. This audit does not prove that the same sole vertices stay grounded or that a foot rolls without slipping.

The JSON records exact source NPZ hash, every descendant group and vertex index, every phase height, center and interval speed. The adapted source already changed tail and ear rest bones; these measurements concern its current native Walk and Run targets only.

## Repair windows

Walk has a deeper right-front swing minimum than its backward support sweep, so a lowest-height threshold alone finds no valid stance for that paw. For Walk repair, use the substantial backward-sweep intervals below as low-confidence intended support windows, then solve common-floor planting. Run retains the conservative combined height/sweep windows. These suggestions need IK and renewed vertex measurement before acceptance.

| Clip | Foot | Suggested periodic repair windows | Median backward speed m/s |
| --- | --- | --- | --- |
| Walk | front_L | [[0.0, 0.7037037037037037]] | 0.6582421293205868 |
| Walk | front_R | [[0.48148148148148145, 1.1851851851851851]] | 0.79306297314967 |
| Walk | hind_L | [[0.25925925925925924, 1.0]] | 0.5759219227892443 |
| Walk | hind_R | [[0.7777777777777778, 1.4814814814814814]] | 0.6904428061742173 |
| run | front_L | [[0.21428571428571427, 0.39285714285714285]] | 3.223395059066649 |
| run | front_R | [[0.14285714285714285, 0.25]] | 5.648460708147227 |
| run | hind_L | [[0.8214285714285714, 0.8928571428571429]] | 5.950640164323807 |
| run | hind_R | [[0.6428571428571429, 0.8928571428571429]] | 3.993835284269108 |
