# Audio acceptance

Production files remain `AudioEngine`, `AudioDirector` and `CorealmAudioBridge`. The full slice record — per-family review table, timing measurements, balance tables, cleanup and limits — is [`SLICE-12-AUDIO.md`](./SLICE-12-AUDIO.md). This page is the short status.

**No listening claim is made.** The tools available to the agents that produced this evidence do not provide audio perception. Everything below is a measurement of decoded samples or of wall-clock timestamps. The items needing a person's ears are enumerated in section 6 of the slice record, with file paths and timestamps into concatenated MP3 copies.

## What is proven

Hardware Chromium, ANGLE Direct3D11, RTX 5080, real audio, MediaRecorder on the production bus. Port 4186.

| Area | Check | Result |
| --- | --- | --- |
| Spatial energy and attenuation | `audio-spatial-browser.ts` | Offline HRTF graph; directional energy and distance falloff. Held from the previous round. |
| File integrity and level | `audio-file-review.ts` | All 94 files behind 57 cues and 8 loops measured: duration, peak, active RMS, LUFS, silence, onset, clipping, DC, spectral centroid and bands, per-cue spread. Listening copies with timestamps. |
| Tool and combat timing | `audio-timing-browser.ts --case chop\|mine\|melee\|spell\|fish` | Marker-to-source-start offsets 0.9 – 12 ms across every case, one 34 ms outlier on a spell's first decode. Chop and mine impacts land within 0.5 ms of the semantic yield roll. Melee swing leads contact by 233 ms on the clip's own marker; the thud trails the rig's contact frame by 49 – 50 ms. |
| Region-to-cave ambience | `audio-actions-browser.ts --case travel` | Real portal both ways plus a reload. Only the destination bed survives each crossfade, nothing is left desired-but-silent, running loop nodes equal active beds, and each bed starts exactly once on reload. |
| Volume balance | `audio-actions-browser.ts --case mix` | Default-volume 28 s session, EBU R128 on the recorded mix. Programme -29.0 LUFS, true peak -6.9 dBTP, LRA 4.2 LU. Footsteps clear the bed by 7.0 dB, UI by 10.1, combat by 13.3. |
| Death and node cleanup | `audio-actions-browser.ts --case death\|kills` | One death voice, no animal calls after the player dies, empty voice pool. Across five real kills the live source count never leaves the two region beds; 20 buffer sources constructed, 46 disconnects, no growth. |
| Production output recordings | `audio-output-browser.ts --case species\|ambience\|contacts` | DOM-only capture of the production bus decoding real catalogue files. Soundboard stimuli, not gameplay timing. |
| Unit | `tests/audioEngine.test.ts`, `audioCatalog.test.ts`, `audio-combat-timing.test.ts`, `audio-travel.test.ts`, `audioSettings.test.ts` | 43 tests. Voice-gain ceiling, footstep level matching, pre-roll trims, creature-voice coverage counted against `content/enemies.ts`, realm reset, listener updates, dead-player animal suppression, rig-event routing. |

## Defects fixed this round

1. **Footsteps were the least audible thing in the game.** Measured at default volumes: a running player's own steps cleared the ambience bed's true peak by 3.0 dB, a UI click by 10.3. Root cause was `AudioEngine` clamping the per-voice gain to 1, which anchored the whole footstep family to the -39.3 dBFS of `footstep-grass-01.ogg`. The ceiling is now +12 dB; bus, loop and bed gains still clamp at 1. Footsteps re-matched to -35 dBFS with a -13.5 dBFS peak cap, and the transient margin went 3.0 → 7.0 dB.
2. **`cueForCreature` misdescribed its own coverage.** It claimed the only silent families were "the two humanoid families" and named `quarrykeeper`, which is the Armored Rhino. The real figure is 53 of 69 families with no idle voice. The comment now names both halves of the gap and the test counts it against content.
3. **`handleCombatHits` was dead code** with a comment claiming a de-duplication guarantee the live path gets elsewhere. Removed; the real mechanism is documented where it happens and pinned by a test.
4. **Four check-script defects** that were reporting the game as broken when it was not, or the reverse: the melee assertion counted the *enemy's* misses as player contacts; the travel check fired the return portal during the outgoing curtain and got a real `BUSY`; it also asserted the loop set before the outgoing beds had faded; and the death check raced the respawn. Details in the slice record.

## Not fixed, and why

- **Melee audio trails the visible contact by ~50 ms.** Measured twice, consistently. Audio lagging video is the benign direction, and moving the cue onto the rig marker would sound a hit before the simulation knows whether it landed. Recorded rather than fudged.
- **A spell's first cast schedules 34 ms after its launch event**, against 9 ms for the second. That is the first decode of the file; pre-warming is a loading-slice decision.
- **Music beds have 0.1 – 2.5 s of edge silence**, so each repeat has a hole in it. `loopStart`/`loopEnd` were tried at the measured silence boundaries and made the seam worse (9.6 → 23.9 dB on `starter-plains`) because the boundary is inside the fade-in. A musical loop point needs ears.
- **21 of 94 source files decode above full scale.** That is in the masters and cannot be undone by a gain. No cue clips the bus.
- **An enemy melee miss is silent** while the player's plays a whoosh. A design decision outside this slice.

## Source substitutions still awaiting a decision

`docs/audio-source-animals.md` records these as label-based selections. Objective measurement this round adds:

| Cue | Measured | Status |
| --- | --- | --- |
| `creature.hen_cluck` | 1051 / 1604 Hz, in band | CC0 chicken candidates prepared under `audio-candidates/`, not installed. |
| `creature.coney_squeak` | 920 / 1011 Hz — below the squeak band | CC0 rabbit candidates prepared, not installed. Shared with the Gravelmaw rat, so a change affects both. |
| `creature.stag_bell` | 292 / 259 Hz, consistent with a rut bellow | From generic monster roars. Freesound 407631 identified last round but not downloaded: the page 403'd and its description links a video, so authorship needs verifying. |
| `creature.viper_hiss` | 2016 / 2293 Hz, broadband, in band | From clips labelled `breath`. No suitable replacement exists: Acoustic Atlas' snake is NC/ND, qubodup's SNAKE is a human imitation under CC-BY-3.0. Keep. |
| `creature.coyote_howl` | in band for a canid | Also carries Dire Wolf and Forest Wolf. |
| `creature.bear_roar` (`bear-roar-01`) | 129 Hz, 85% sub-150 Hz | Outside the growl/roar band. Rumble or roar is a listening call. |
| Rhino and ogre bosses | no cue at all | Seven boss families with no rights-traced recording of anything close. Needs a source decision or an explicit "stays silent". |

## Reproduce

```
npx tsx runs/corealm-rebuild/checks/audio-file-review.ts
npx tsx runs/corealm-rebuild/checks/audio-timing-browser.ts  --case chop|mine|melee|spell|fish
npx tsx runs/corealm-rebuild/checks/audio-actions-browser.ts --case travel|death|kills|mix
npx tsx runs/corealm-rebuild/checks/audio-output-browser.ts  --case species|ambience|contacts
npx tsx runs/corealm-rebuild/checks/audio-spatial-browser.ts
npx vitest run tests/audioEngine.test.ts tests/audioCatalog.test.ts tests/audio-combat-timing.test.ts tests/audio-travel.test.ts tests/audioSettings.test.ts
```

All audio checks resolve their server through `audioCheckUrl()`: `--url`, then `COREALM_URL`, then 4186. They need `ffmpeg` and `ffprobe` on PATH. Evidence goes to ignored `test-results/`; raw webm captures are deleted once their MP3 listening copy exists.
