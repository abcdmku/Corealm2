# Motion browser review status

The four ground assets and four legacy mammals (bear, aurochs, goat and dark rabbit) were accepted and promoted by root. Other legacy mammals and rhinos remain subject to root acceptance.

The first legacy mammal session is preserved in `test-results/legacy-motion-four`. It used the RTX 5080 hardware renderer and normal simulation time, but it does not accept any candidate. The wolf attack command was rejected beyond the production 32 m pursuit limit, while the harness failed to surface that reply. Bear and aurochs correctly stopped at their body-aware combat distance, outside the harness's incorrect fixed 2 m threshold. The cattle was dead by its final capture despite satisfying the earlier motion summary. The helper is being corrected to check command replies, use actual production reach and engagement, preserve a living target, and frame the full drawn animal.

The rhino air session in `test-results/rhino-contact-retry` recorded three real damage events near normalized Attack phase 0.40 with the candidate timing hook. Side-view frames show the strike reaching the player's vicinity, but source anticipation folds the head into the torso. Root rejected that pose. A separate bounded attack repair is in progress; the old unchanged Attack is not accepted. The contact marker must be measured again after that repair.

Public promotion still requires the corrected production browser checks, inspected screenshots and root's fresh critic acceptance.

## Later hardware review

The later serial sessions are preserved in `test-results/legacy-motion-four-corrected`, `legacy-motion-hooves`, `legacy-motion-small`, and `rhino-attack-repaired`. All used the RTX 5080 hardware renderer and normal simulation time, and all browsers closed before the GPU lease was released.

Bear, aurochs, goat and dark rabbit passed real Walk/Run, turning and transition coverage with live screenshots. Cattle remained neutral and only demonstrated its correct 0.51 m/s Walk. The other seven actors failed the fixed 10-second approach test. CPU diagnosis found that positional transit was still active when combat pursuit began, causing production combat to cancel; some inter-station paths also exceeded the test window. These failures remain preserved. The helper is being changed to complete ordinary navigation to a nearby setup point before beginning the unchanged timed pursuit stage and to require actual enemy engagement before fleeing.

The repaired rhino air now keeps the head attached through both inspected anticipation frames and visibly reaches the player's upper body during the strike. The 720-frame trace contains three real damage events, 5/1/4 damage, bracketed at normalized Attack phase 0.391865–0.405406. The fixture uses the remeasured offline crossing marker 0.33229264631653577; observed damage is quantized by the production simulation tick. All eight screenshots were inspected. Earth/water material variants and the three directional recoil clips still lack separate browser proof in this session. Root owns visual acceptance.

## Completed setup and remaining visual coverage

`test-results/legacy-final-canines`, `legacy-final-hooves` and `legacy-final-small` passed all eight remaining actors' production movement checks with completed normal setup navigation and the unchanged ten-second attack budget. Sessions lasted 44.614, 56.672 and 58.468 seconds respectively, used hardware rendering without SwiftShader, and closed their browsers. Coyote, ibex, cattle, deer, boar and rabbit demonstrated advancing Walk and Run while translating. Hog and rat demonstrated their authored Walk; their semantic run state uses a fallback and does not establish a separate authored Run clip.

All 24 screenshots were inspected. Cattle, deer, hog and rat were readable; no new mesh collapse was found. Other residents obscured important coyote, ibex and rabbit views. Boar's end-of-stage frames caught its preserved source Attack, so these stills do not prove its repaired Run. A contact sheet from the existing boar video showed a subsequent low-body Run without gross deformation, but framing was close. These four actors need isolated, moving captures before visual acceptance. The lab now supports selecting actual fixture residents with `motionActors`; the helper verifies the exact roster and captures only observed advancing locomotion with real translation. No AI state or pose is forced.

Four later singleton sessions are in `test-results/legacy-visual-coyote`, `legacy-visual-ibex`, `legacy-visual-boar` and `legacy-visual-rabbit`. They lasted 34.337, 36.689, 32.580 and 30.720 seconds. Each asserted the RTX 5080 hardware renderer, used normal simulation time and closed its browser. All four passed the production translation, Walk, Run, turn and transition state checks. All ten accepted moving screenshots and the rejected coyote turn attempt were inspected. Walk and Run are readable for every actor; boar and rabbit also have accepted moving-turn screenshots. No new body collapse was identified. The rabbit has a base-lab frog in the background, without occlusion.

Coyote and ibex retain `visual-coverage-incomplete`: the coyote changed from Run to Attack across its attempted turning screenshot, and ibex had no eligible turn capture. Their measured moving turns were 5.015 and 3.964 radians, but this does not replace the missing stills. The captures remain unaccepted by this worker pending root's visual review. No rhino browser session ran during this lease.

Root later inspected the video-derived turning sheets in `test-results/legacy-turn-video/coyote` and `ibex`, and accepted their readable natural orientation transitions with intact bodies, combined with the earlier moving state and unobscured Walk/Run images. Historical `frameChecks.turn=false` remains intact. These extracted sequences include Attack/Idle transitions and do not prove continuous gait contact through a turn. Root also accepted the cattle, deer, hog and rat pursuit views and the explicit frozen-run identity attestation limitation. `legacy-eight-promotion.json` records this acceptance; root owns public promotion. The eight-only catalog remains frozen at SHA256 `d9776f8a9859d9a018f72af866c6a6275e231c1f79d7e613e8a89ce82b878cef`.

## Slice 06 rhino acceptance and promotion

The three rhinos are now public. `art/rebuild/candidates/finish-motion/rhino-attack` was promoted
with `tools/promote-finish-assets.ts --apply`, and `content/creatureMotionTiming.ts` moved to the
remeasured contact marker 0.33229264631653577.

Every family got its own production combat-lab session on port 4182 and the RTX 5080 hardware
renderer, with served bytes hashed against the catalogue. Air, earth and water each take real
damage from a real swing - 5, 7 and 9 - and the inspected stills read as one movement: head
attached and horn low at the wind-up, horn sweeping up through the player's upper body on the frame
the damage number spawns, horn already descending by the old 0.7 mark, settled head-down recovery.
The water frame catches the player's own Hit_Chest firing on the same frame.

Directional recoil is complete for all three families on all three sides, each the authored masked
overlay over an unchanged base gait with `native-masked` status and every leg bone protected. Left
and right mirror; the body and all four planted hooves are unchanged; nothing collapses.

Two harness defects were fixed before that evidence was worth anything. The directional proof
photographed the first frame that SAW the overlay, drawn at weight ~0, so every earlier `-during`
frame in this tree was the plain base pose; it now follows the same overlay to full weight, and the
new captures sit at 0.93-0.999. The lab camera was pinned at 5 m, inside a 2.4 m-radius boss rhino,
so the frames were flank and belly with the head out of shot; it is now framed off the production
body radius. The old `rhino-directional-earth` run predated both and reported `incomplete`. All
three were rerun on the corrected harness.

`animal_coyote` also has an accepted settled grounded death from
`test-results/combat-residency-coyote`: death on the authored Death clip, and a corpse that settles
at a byte-identical position with flank, shoulder, head and tail all in ground contact. Its
directional coverage is front-only, and the live/sampled residency crossing was not observed inside
the helper's budget; both remain open.

Attack contact, side recoil and settled death for the rest of the roster remain uncollected. See
`runs/corealm-rebuild/SLICE-06-CREATURE-COMBAT-CONSISTENCY.md` for the per-species matrix.

