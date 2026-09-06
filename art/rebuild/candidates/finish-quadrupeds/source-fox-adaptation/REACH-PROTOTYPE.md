# Fox articulated-hock motion prototype

Review candidate: `Fox.reach-prototype.glb`, loaded using `reach-prototype-catalogue.json`. The existing queued paw/geometry/motion GLBs are unchanged. Separate catalogue filename mappings were repaired so each now names its intended GLB.

The previous solver held the hind distal segment in its bind orientation, unnecessarily reducing reach. This prototype articulates that hock toward the hip-to-target direction with an anatomical bias, while the terminal paw keeps the physical sole orientation. It keeps the original rig, inverse binds, bone lengths, mesh, skin weights and native Survey.

| Run change | Maximum pelvis lowering |
|---|---:|
| Previous fixed hock and 1.158 s cycle | 144.6 mm |
| Articulated hock, same cycle and 0.85 m/s target | 55.8 mm |
| Articulated hock, new 0.55 s cycle, 30% duty, 1.8 m/s target | 20.35 mm |

The new Run stance sweeps 0.297 m over 0.165 s. Serialized physical-sole regressions measure **1.79969–1.79998 m/s** across all four feet. This matches the unchanged Fox gameplay movement speed of 1.8 m/s without a large playback multiplier. It is explicitly a newly authored source-derived cycle; native upper-body phase is resampled to 0.55 s. It is not an untouched native clip or a renamed clip.

Walk retains its original 0.708333313 s duration and 0.58 m/s target. Measured foot speeds are 0.57991–0.57999 m/s. Maximum pelvis lowering is 25.07 mm. At the unchanged gameplay walk speed0.5, the ideal playback factor is approximately0.862.

Serialized whole-mesh audit samples every quarter key: 681 Walk and1,057 Run samples, including every vertex. Maximum burial is **0.044 mm Walk / 0.054 mm Run**. Maximum stance path error is0.423 /0.660 mm. Loop sole centroids and hip translation are exact; joint error is below0.000000052 radians. No geometry changed. Native Survey hashes match and still retains its previously reported ~1.32 mm contact defect.

The Run bake uses480 Hz to hold the contact-transition path error below1 mm; Walk uses240 Hz. Resulting GLB is1,913,752 bytes,181,820 more than geometry-only. The original geometry and previous motion revisions remain available.

Hardware review must still judge the articulated hock, paw shape, new cadence and overall silhouette. This is not production acceptance. Combat, hit directions and death remain absent. Full measurements and per-frame evidence: `reach-prototype-review.json`.

Reproduce: `node art/rebuild/candidates/finish-quadrupeds/source-fox-adaptation/motion-reach-prototype.mjs --paw`.
