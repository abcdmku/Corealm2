# Scheduled structure and portal acceptance

Run one hardware browser at a time against the root's stable Vite server on port 4175. These commands are prepared, not run by the structure worker. Stop after each invocation, read its report, inspect its captures, and resolve failures before the next stage. All use production graphics and D3D11.

## Compact production scenes

1. Cave materials, 45-second hard deadline, four captures.

```powershell
npx tsx runs/corealm-rebuild/checks/cave-material-review.ts
```

Inspect `test-results/cave-material-review/{chambers,wall,floor,ceiling}.png`. Check UV phase across adjacent wall courses, broken shelves, opaque roof, continuous floor and readable darkness. Report asserts fixture readiness, shared maps, two materials, clearance, grounding and zero errors. Art still needs the root's judgment.

2. Portal cave, 55-second hard deadline, three captures.

```powershell
npx tsx runs/corealm-rebuild/checks/portal-transition-browser.ts
```

Inspect approach, inside and returned captures in `test-results/portal-transition-browser`. Confirm a real dark recess behind both arches, correct entry/return, floor support and blackout trace. The focused `tests/dungeon-portal-fit.test.ts` also raycasts the actual compact cave and authored first chamber to reject shell intrusion before the rear cap; this is supporting geometry evidence, not browser proof.

3. Staged geology, 60-second hard deadline, four captures.

```powershell
npx tsx runs/corealm-rebuild/checks/native-prop-review.ts --catalog art/rebuild/candidates/finish-structures/corealm-geology.json --out test-results/finish-structures-gallery corealm_sunder_ledge corealm_scree_slide
```

Inspect primary/opposite captures for each formation. The browser intercepts candidates into the production asset loader; it does not promote public assets. Reject visible repeated shelves, flat ends, poor roughness, floating fragments or unreadable approach channels. The report records native bounds and draw metrics.

## Authored world

These steps use the world-authoring exception for spatial terrain support, settlement approaches and distant landings. Compact reusable geometry proof above remains required.

4. Portal exterior/return after the support-pad fix, root-owned portal QA. Use `finish-portal-world.ts --mode manual --url http://127.0.0.1:4175`, then its routed mode after the manual pass. Inspect both sides of the paving, the full recessed floor, portal stance and chamber-side rear cap. Require the sampled curtain trace at transition commit.

The new support pad cuts or fills the original hill to the mouth datum. A flat core spans local X +/-5.2 and Z -7.8 through +7.4 to protect thin masonry against both 2 m terrain sampling stages. Smooth transitions span 3 m sideways/forward and 4 m rearward. The 8.2 m rear crest moves to local Z -12, its outer extent to -20, leaving a gradual bank behind the real recess. The world portal origin remains [46,-24], yaw 1.05. Local +Z maps to [0.8674,0.4976]. No portal entity coordinates or boot code were edited by the structure worker.

5. Four settlement walks, one process and at most 60 seconds each.

```powershell
npx tsx runs/corealm-rebuild/checks/settlement-walk-browser.ts --region fallowmarch --url http://127.0.0.1:4175
npx tsx runs/corealm-rebuild/checks/settlement-walk-browser.ts --region vellenwood --url http://127.0.0.1:4175
npx tsx runs/corealm-rebuild/checks/settlement-walk-browser.ts --region karrowmoor --url http://127.0.0.1:4175
npx tsx runs/corealm-rebuild/checks/settlement-walk-browser.ts --region kilnhalt --url http://127.0.0.1:4175
```

Each report lives under `test-results/settlement-walk-browser/<region>`. Inspect starting view, bank/shop/crafting arrival and interaction captures. Those checks cover three service approaches per settlement, not every decorative building. The CPU structure lint's vault-door torch/banner warnings still require their supporting tower wall in view. Inspect standalone wall runs extending beyond settlement pads before claiming catalogue-wide grounding.

6. Sunder/Scree real traversals after root promotion, owned by traversal QA. Gallery success does not prove their authored landing paths or grounded actor motion. Reuse the actual agility fixture first and then capture final-world entry, transit and landing with unchanged gameplay IDs/rewards.
