# Cattle and aurochs gait candidates

The staged Walk and Run clips preserve the shipped geometry, skeleton rest pose, segment lengths, native movement speeds, clip durations and every nonlocomotion clip. The helper appends animation accessors without rewriting the original binary prefix.

Generate with `npx tsx tools/creature-motion/stage-bovine-gaits.ts`. Both candidates pass actual weighted-vertex audits over two cycles at 7680 intervals per cycle, including every authored key and midpoint. Maximum stance sole slip is 3.66 mm/s; whole-mesh penetration is zero. Four focused regressions pass. A fresh read-only source critic found no concrete blocker.

The independent all-mesh coverage sweep also passes every original vertex over 7680 intervals and two cycles, without any foot-selection or stance filter. Maximum intended contact-plane slip is 4.154 mm/s Walk and 6.501 mm/s Run. Exact candidate/source hashes and measurements are in the `*-coverage.json` files. This closes the selection omission discovered in the separate hog review.

These are **offline candidates only**. Production browser acceptance must inspect the 10 cm Walk and 19 cm Run body compression, otherwise static non-leg posture, real translation, turns, transitions and silhouettes. No public promotion is authorized by these reports. The wider 2 mm near-floor window includes airborne approach/release motion and is not claimed slip-free.

`manifest-updates.json` contains source, candidate and generator hashes. Original metadata speeds and pack provenance remain unchanged.
