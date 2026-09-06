# Creature motion candidates

These candidates are retained as the reproducible package 03 handoff. Public GLBs and the production manifest were not changed. Offline contact acceptance is complete for the six frog/crab clips and scorpion Run. Production browser motion acceptance is pending, so every manifest proposal has `promotable: false`.

## Staging and wiring

- `ground-creature-gaits/animal_frog.glb`, `animal_frog_green.glb`, and `animal_crab.glb` replace only Walk/Run. Fresh generation reproduces the checkpoint candidate hashes exactly.
- `scorpion-ground-gait/animal_scorpion.glb` replaces only Run. Walk and all seven other clips are byte-preserved.
- Each directory's `manifest-updates.json` contains source hash, candidate hash, byte count and the exact speed/duration fields to apply together after browser acceptance. Keep all unrelated manifest fields, especially existing grounding and clip names.
- For lab review, intercept the matching `/assets/models/animal/<id>.glb` request with the staged bytes and intercept manifest data to apply the proposed fields. This exercises the production loader without public promotion. Capture original and staged motion through the same lab camera and controls.

Reproduce from the repository root with Node 24:

```powershell
npx tsx tools/repair-ground-creature-gaits.ts
npx tsx tools/repair-ground-creature-gaits.ts --asset animal_scorpion
npx vitest run tests/groundGaitRepair.test.ts tools/creature-motion/pose.test.ts tools/creature-motion/scorpion-contact.test.ts tools/creature-motion/bear-hit.test.ts tools/creature-motion/hooved-hit.test.ts tests/creature-motion-continuity.test.ts
```

The generators perform two cycles at 3,840 intervals per cycle, CPU-skinning actual original vertices from serialized channels. Their reports check declared toe contacts, all near-floor sole vertices, incidental contact outside the declared stance schedule, whole-mesh penetration, loop position/velocity, and simultaneous support agreement. Reports are supporting evidence, not visual approval.

## Scorpion repair

The former sole correction chased nearly dependent weighted-vertex constraints with damping of `1e-9` and exceeded the existing `0.65` radian refusal. The repaired solve uses `1e-5` damping, then restores the exact physical tip constraint. Both stages retain the `0.65` anatomical limit. Rear ankles pitch by `0.06` radians to raise their nearly coplanar heels physically during toe contact. Run has 1,920 authored intervals, plus source and contact transition keys.

No skin weights, geometry, joint translations, scales, stride rate or audit thresholds were relaxed. Actual planted travel remains `0.31 m/s`; the bake produces matching mesh motion. The passing candidate measures maximum primary slip of `0.546 mm/s`, maximum near-floor stance sole slip of `7.172 mm/s`, maximum all-phase physical-contact slip of `5.095 mm/s`, zero penetration and zero loop-position error. Maximum post-fit joint correction is `0.472` radians.

The pose sampler now binary-searches dense key arrays. Focused tests preserve irregular-key interpolation, exact endpoints, one-key clips and existing bear/hooved contact behavior.

## Remaining production proof

Review frog, green frog, crab and scorpion at gameplay scale during actual translation, start/stop acceleration, both turn directions, idle/walk/run blends, attack interruption, return and residency changes. Compare semantic position and animation phase before and after each action, and inspect normal-speed captures. Straight-cycle CPU contact does not prove those transitions.

The read-only roster audit covered 49 legacy/expansion assets, 46 combat creatures and three ambient fish. All 46 combat assets have Attack, Hit, HitLeft, HitRight and Death; their production Attack durations match the timing table. All 25 legacy rebuild records match the production manifest hashes. Gaps still requiring work or acceptance:

- Directional hits were unreachable through the renderer's generic Hit selection. The performance worker has added optional `impactSide` selection to `EntityViews.playAction`; root must supply actual impact direction and prove it in combat.
- No explicit Turn or Stagger clips exist on this roster. Grounded turning and distinct staggering are not accepted.
- The shipped rhino's `0.70` attack marker is the endpoint of the old forward-reach search window. The new rhino contact candidate below repairs its measured timing and directional recoil; runtime contact and visual acceptance remain pending.
- The old rebuild deformation sweep excludes Death. Inspect death endpoints and reachable ground/collision behavior.
- Sixteen expansion GLBs lack embedded `contactNormalized` extras while the runtime timing table supplies them. There is no observed duration mismatch; future clip changes must update both representations together.

The quadruped owner's later silhouette revision changes rest pivots and measured native strides. Its current rig measurements and separate acceptance status are in `../finish-quadrupeds/catalogue.json`; the earlier rig-preservation observation does not describe that revision.

## Rhino contact continuation

`npx tsx tools/creature-motion/stage-rhino-contact.ts` stages all three `boss_rhino_*` GLBs under `rhino-contact/`. These preserve the exact original BIN prefix, meshes, materials, skins, node indices and source Idle/Walk/Run/Attack/Death samplers. Only Hit/HitLeft/HitRight samplers and Attack contact metadata change. Duplicate node names are resolved by verified original node indices and hierarchy, never by name alone.

The actual 227 forward-head vertices reach their anticipation minimum at phase `0.27`, then complete the first forward strike at phase `0.3620833333333333`, or `0.4465694502` seconds into the `1.2333333492` second Attack. The full-cycle measurement samples every `0.000513889` seconds. This is the physical strike peak, not proof of intersection with a particular runtime target. The prior marker at `0.70` falls during recovery. Apply each proposal's `setTiming` to the corresponding `game/src/content/creatureMotionTiming.ts` entry together with the candidate GLB after side-view combat acceptance.

The three new recoil clips absorb impact through head/chest gestures and `65 mm` body compression. Four two-bone solves preserve each palm/ankle world pose. All 100 selected physical sole vertices are tested at every key and midpoint, not just the endpoint bones. Across all variants and directions, maximum serialized sole displacement is `0.0282 mm`, minimum sole height remains above zero, and the whole body returns exactly to the initial stance. Source gait clips and metadata are unchanged.

`npx vitest run tools/creature-motion/rhino-contact.test.ts` verifies original source bytes, physical recoil contacts and measured marker correspondence for all three variants. Root still needs normal-speed Attack against an actual target, contact-versus-damage timing, all three recoil directions and inspected screenshots.

The prepared ground-animal browser check is:

```powershell
npx tsx tools/creature-motion/ground-browser-proof.ts --url http://127.0.0.1:4175 --out test-results/ground-motion
```

It intercepts staged assets and metadata, drives real AI translation and player movement, records semantic motion snapshots, screenshots and video, and reports missing walk/run/turn/blend coverage as incomplete. It must run only during root's GPU slot.

The final production patrol sequence in `test-results/ground-motion-fixture` passed all four animals on the RTX 5080 hardware renderer. Actual travel was 4.84 m frog, 4.79 m green frog, 10.25 m crab and 9.22 m scorpion. Every actor demonstrated Walk, Run, turns and live clip transitions. Screenshots were inspected, then root obtained a fresh visual critic and promoted those four ground assets. Rhino assets remain excluded. The earlier idle-only incomplete sequence is superseded by this fixture proof.

`game/src/featureLab/groundMotion.ts` also provides an optional legacy cohort through `?motion=legacy`, preserving production actor definitions and native speeds. `legacy-catalog.json` and `tools/creature-motion/legacy-browser-proof.ts` stage the passing legacy candidates for separate browser review. Offline legacy reports do not authorize public promotion. A fresh whole-mesh contact coverage pass is required in addition to declared-foot audits after the hog review discovered a vertex excluded by a 0.5 skin-weight cutoff.
