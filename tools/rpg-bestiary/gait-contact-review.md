# Weighted contact follow-up

Run `node tools/rpg-bestiary/gait.mjs --geometry` after the ordinary 36-entry gait audit. This updates only the five flagged rows in `gait-results.json`, preserving the 28 previously approved joint estimates and three hover exemptions. It does not change the catalogue or model bytes.

The follow-up samples actual referenced vertices weighted at least 50% to each foot or toe chain. Harpy contact includes the batched, fully weighted authored claws. A foot is near ground when its lowest vertex is within 20 mm of y=0; its contact patch includes vertices within 8 mm of that minimum. Velocity follows each same vertex through adjacent poses, avoiding false motion from a change in the lowest vertex. Per-frame patch medians prevent dense geometry from dominating the result. The main estimate uses the central 70% of each foot's longest contiguous backward ground-contact interval; the report retains complete contact distributions and intervals.

| Model | Walk m/s | Run m/s | CPU conclusion |
| --- | ---: | ---: | --- |
| zombie | 1.02122 | 6.37367 | Walk credible; Run contact too brief |
| plague_zombie | 1.02228 | 6.38014 | Walk credible; Run contact too brief |
| harpy | 1.01996 | 6.25276 | Both have credible geometry estimates |
| cliff_harpy | 1.01996 | 6.25276 | Same contact geometry and gait as harpy |
| storm_harpy | 1.01996 | 6.25276 | Same contact geometry and gait as harpy |

Zombie Walk has contiguous contact of 0.831 seconds left and 0.644 seconds right. Plague zombie Walk has 0.831 and 0.797 seconds. The earlier short toe-joint stance warning did not represent their sole geometry.

Zombie Run has only 0.0253 seconds of main contact per foot. Plague zombie Run has 0.0233 seconds. Their measured soles bottom out 12–14 mm above y=0, with their tenth-percentile heights about 23–31 mm. The brief near-ground intervals cannot establish a sustained planted run. Although left/right speeds agree, those run values remain provisional. Inspect phases 0.15–0.18 and 0.65–0.68 in the 0.9333-second Run cycle, then compare nearby poses for floating or toe-only contact. A playback speed change alone cannot fix contact height or stance duration.

Harpy Walk has 0.644/0.647-second contacts and Run has 0.169/0.175-second contacts. Left/right central stance medians differ by 1.25% Walk and 0.25% Run. Actual claw contact gives slightly higher speeds than the toe-joint proxy. Walk still has substantial speed variation within stance, so a single playback rate cannot eliminate every local slip. Inspect the claws in motion before visual acceptance.

Validation: the weighted geometry measurement recovered exactly 2 m/s from a synthetic skinned planted-foot path. These are CPU contact findings, not browser acceptance or screenshot evidence.

After this audit, root approved replacing zombie and plague `Run` with an exact alias of the valid source `Walk`. Source7 records that alias and assigns both native speed fields the corresponding measured Walk value. The provisional Run numbers above describe the rejected pre-alias clips and are retained as the reason for the correction.
