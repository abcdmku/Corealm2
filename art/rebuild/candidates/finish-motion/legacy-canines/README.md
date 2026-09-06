# Wolf and bear gait candidates

These candidates replace only Walk and Run. Original BIN prefixes, geometry, skins, hierarchy, local bone translations and scales, nonlocomotion samplers, clip durations, and shipped native speeds remain intact. They are staged for root browser acceptance, not promoted.

| Asset / clip | Maximum primary vertex slip | Maximum all-phase physical contact slip | Mesh penetration |
| --- | ---: | ---: | ---: |
| Wolf Walk | 1.150 mm/s | 3.827 mm/s | 0 |
| Wolf Run | 6.226 mm/s | 11.041 mm/s | 0 |
| Bear Walk | 1.271 mm/s | 4.075 mm/s | 0 |
| Bear Run | 4.414 mm/s | 8.272 mm/s | 0 |

Each serialized clip passed the unchanged `auditGroundGait` thresholds over two full cycles at 7,680 intervals per cycle. Authoring uses 3,840 intervals, so the audit includes every key and midpoint. The audit reports every weighted physical sole vertex, individual primary slip, simultaneous support disagreement, all-phase contact, whole-mesh penetration and position/velocity loop continuity.

An independent whole-mesh regression also checks every weighted vertex at the physical contact plane, with no sole selection or stance schedule, at the same density over two cycles. All four clips pass the 12 mm/s bound. Bear vertices 587 and 1353 contact outside the selected sole sets and also pass; wolf has no unselected contacts. The per-asset `*-whole-mesh-contact.json` files record these checks. Both regression cases and their scoped TypeScript check pass.

The four-beat walk and paired fore/hind run retain the original body proportions. A 0.14 m wolf root crouch and 0.20 m bear root crouch provide reachable limb paths at original native travel speed; both add an 8 mm body wave. Review those postures, transitions, toe readability and run character in the production lab before accepting. The offline gate cannot prove visual quality.

The wolf hind solver holds the hock's world orientation so the blended hock/ankle/ball sole stays rigid in stance. The front paw's small knee influence is corrected from actual weighted primary positions, using four feedback iterations. Swing endpoints retain planted velocity with zero initial turnaround acceleration.

Rebuild with `npx tsx tools/creature-motion/stage-canine-gaits.ts`. `manifest-updates.json` contains hashes, source paths and generator provenance for both assets, with visual acceptance and promotion false. The focused four-test regression and scoped strict TypeScript pass. A fresh read-only critic's two harness findings were fixed and verified.

No public files, asset manifest, shared profiles, playback caps, stats, attacks, reactions or death clips were edited.
