# Slice 12 — Audio

Worktree `Corealm2-wt/12-audio`, branch `finish/slice-12-audio`, rebased onto `e08d627`. Dev server and all browser evidence on port 4186. Gameplay runs are hardware Chromium, ANGLE Direct3D11, `NVIDIA GeForce RTX 5080`, with real audio and a MediaRecorder tap on the production bus.

**No listening claim is made anywhere in this document.** This agent has no audio perception. Every number here is a measurement of decoded samples or of wall-clock timestamps. Section 6 lists what still needs a person's ears, with file paths and timestamps.

Reproduce with:

```
npx tsx runs/corealm-rebuild/checks/audio-file-review.ts
npx tsx runs/corealm-rebuild/checks/audio-timing-browser.ts  --case chop|mine|melee|spell|fish
npx tsx runs/corealm-rebuild/checks/audio-actions-browser.ts --case travel|death|kills|mix
npx tsx runs/corealm-rebuild/checks/audio-output-browser.ts  --case species|ambience|contacts
npx vitest run tests/audioEngine.test.ts tests/audioCatalog.test.ts tests/audio-combat-timing.test.ts tests/audio-travel.test.ts tests/audioSettings.test.ts
```

---

## 1. File review — every shipped cue and bed

`audio-file-review.ts` decodes all 94 distinct files behind the 57 cues and 8 loops, and writes a listening sheet with concatenated MP3 copies and timestamps. Latest run: `test-results/audio-review/2026-09-06T06-09-11-815Z/`.

Levels are "as played": file active RMS plus the catalogue's cue and variant gain, before the bus.

| Family | Cues | Files | As played dBFS | Per-cue spread | Notes |
| --- | ---: | ---: | --- | --- | --- |
| `movement.*` | 6 | 12 | -40.7 … -34.9 | 0.0 dB, except stone 5.7 and forest 2.3 | Re-levelled this round; see section 4. The two outliers are the peak cap holding a sharp heel click down. |
| `combat.*` | 9 | 20 | -36.1 … -20.0 | ≤ 0.2 dB | `melee_hit` spanned 18.2 dB before the previous round's variant matching. |
| `gather.*` | 9 | 17 | -36.1 … -22.0 | ≤ 3.4 dB (`tree_fall`) | `tree_fall` pairs a 2.67 s crash with a 0.56 s snap; the duration ratio, not the level, is the mismatch. |
| `interaction.*` | 12 | 21 | -38.2 … -27.1 | ≤ 0.1 dB | |
| `production.*` | 5 | 11 | -38.7 … -26.9 | ≤ 0.1 dB | |
| `ui.*` | 5 | 5 | -36.0 … -22.0 | single variant each | `level_up` is deliberately the loudest UI cue at -22. |
| `creature.*` | 11 | 27 | -32.6 … -23.9 | ≤ 3.3 dB (`frog_croak`) | Bear loudest at -24, coney quietest at -31, as documented. |

Whole-catalogue facts:

- **Clipping.** 21 of 94 files decode with at least one run of three samples at or above 0.985. Worst: `boar-grunt-03.ogg` (54 runs, peak +2.5 dBFS), `coyote-bark-02.ogg` (15, +3.0), `tree-chop-fall.ogg` (44, +14.9), `armour-hit-01.ogg` (44, +2.8), `starter-plains.mp3` (154), `deep-woodland.mp3` (140). This is baked into the source masters — lossy Vorbis and MP3 routinely decode above full scale — and cannot be undone by a gain. It matters only if it is audible, which is a listening question.
- **No cue clips the bus.** Zero variants have an as-played peak above -1 dBFS. Before the previous round's rebalance, `tree-chop-fall.ogg` played at +11.6 dBFS.
- **Sample rates.** Counted per variant slot: 72 at 48 kHz, 40 at 44.1 kHz, one at 24 kHz (`oga/rock-break.ogg`). Mixed rates are resampled by the decoder and are not a defect; the 24 kHz file has a 12 kHz ceiling and carries less top end than its neighbours.
- **DC offset.** Two files over the -40 dBFS threshold, both the same recording: `filmcow-v1/cloth-movement-01.ogg` at -33.7 dBFS (about 2% offset), used by `interaction.climb` and `interaction.equip`. Costs a little headroom; no fix applied because correcting it means re-encoding a shipped file over a defect that may be inaudible.
- **Pre-roll.** 44 of the 113 variants carry a measured `startOffsetS` so their transient lands on the frame that asked for it, up to 214 ms (`tommusic/door-open-02.ogg`; the longest on a contact cue is 139 ms, `filmcow-v4/damage-body-impact-01.ogg`). The review's silence and onset flags now subtract that trim, so a fixed defect stops reporting itself.

### Creature families, measured

Centroid is as played, including the cue's playback rate. The expectation bands are coarse sanity ranges for the role, not species identification.

| Cue | Files | Dur s | As played dBFS | Centroid Hz | Objective finding |
| --- | --- | --- | ---: | ---: | --- |
| `creature.hen_cluck` | `hen-cluck-01/02` | 0.39 / 0.51 | -29.0 | 1051 / 1604 | In band, clean. Source identity is the open question, not the measurement. |
| `creature.frog_croak` | 4 files | 0.19 – 1.26 | -32.6 … -29.3 | 843 – 1071 | In band. Durations differ 6.6×; the 0.19 s croak next to a 1.26 s one will read as two animals. |
| `creature.goat_bleat` | `goat-bleat-01` | 0.87 | -28.0 | 1936 | In band. Single variant: an ibex herd repeats one recording. |
| `creature.cow_low` | `cow-moo-01/02` | 0.95 / 1.48 | -26.1 | 548 / **2016** | `cow-moo-02` sits 1835 Hz as played, above the 150–1500 Hz band for a moo. Either a distant/young animal or a mislabelled clip. **Listening item.** |
| `creature.coney_squeak` | `rodent-squeak-01/02` | 0.61 / 0.29 | -31.0 | **920 / 1011** | Both below the 1200 Hz floor for a squeak — these are low, throaty rodent noises rather than the bright squeak a coney implies. Shared with the Gravelmaw rat. **Listening item;** ledger already flags it. |
| `creature.viper_hiss` | `serpent-hiss-01/02` | 0.67 / 0.36 | -30.0 | 2016 / 2293 | Broadband, in band for a hiss. Sourced from clips labelled `breath`. `serpent-hiss-02` has 5 clipped runs. **Ledger-flagged substitute.** |
| `creature.stag_bell` | `stag-bellow-01/02` | 0.91 / 1.13 | -26.0 | 292 / 259 | Low and roaring, consistent with a rut bellow. Sourced from generic monster roars. 4 clipped runs each. **Ledger-flagged substitute.** |
| `creature.hog_grunt` | 3 files | 0.67 – 0.93 | -27.1 | 200 – 423 | In band. `boar-grunt-03` has 54 clipped runs and a +2.5 dBFS peak; its gain is down at 0.10 so it plays level with the others, but the distortion is in the file. |
| `creature.coyote_howl` | 3 files | 0.40 – 0.72 | -26.1 | 507 – 1728 | In band for a canid. Also carries both **wolf** families (Dire Wolf, Forest Wolf) — a coyote yip-howl is not a wolf's. 11 / 5 / 15 clipped runs. **Listening item.** |
| `creature.bear_roar` | 3 files | 0.90 – 1.19 | -24.0 | 487 / 621 / **139** | `bear-roar-01` is 85% sub-150 Hz and centres at 129 Hz — a rumble more than a roar, and outside the 150–1800 Hz band. **Listening item.** The two growls measure normally. |
| `creature.chitin_click` | 3 files | 0.35 – 0.57 | -30.0 | 4336 – 6725 | Bright and short, in band. All three peak above +1.9 dBFS in the file. |

### Creature-voice coverage

`content/enemies.ts` has **69 enemy families. 16 have an idle voice; 53 do not.** `director.ts` described the silent set as "the two humanoid families" and named `quarrykeeper`, which is the Armored Rhino. That comment is corrected and `tests/audioCatalog.test.ts` now counts the set against content.

- Deliberately silent (no animal voice to give them): `reaver` bandits, three goblin families, three skeleton families, `wraith`, `revenant`, `zombie`, `plague_zombie`, `grave_ghoul`, `banshee`, five golem families, `shale_elemental`, `beetle_golem`, `mossback_sentinel`, `cinder_ravager`, `basalt_drake`, `quarry_nightmare`.
- Uncovered animals, no cue: `redbrush_fox`, `duskoak_lynx`, `marsh_moose`, `cairn_bighorn`, `bracken_tapir`, `marchwild_horse`, `rootdelve_badger`, `quillback_porcupine`, `reedjaw_crocodile`, `ashscale_monitor`, `kiln_salamander`, `slateback_tortoise`, `blackwater_heron`, `reedbank_goose`, `marchfield_turkey`, `scree_bustard`, `quarry_snail`, `hollowroot_spider`, `webweaver_spider`, `gorge_mantis`, `antler_beetle`, `slag_centipede`, `marsh_wasp`.
- Uncovered bosses: four ogres (`cinderwake`, `galeskin`, `mossbound`, `tideworn`) and three rhinos (`quarrykeeper`, `rootheart`, `tempest_roc`).

Several of these could share an existing bank the way cattle and aurochs already share a low — a bighorn on the goat bleat, the spiders and mantis on the chitin click, the crocodile and monitor on the viper hiss. Whether the shared throat is convincing is a listening judgement, so nothing was guessed into the map. See section 6.

---

## 2. Attack, hit and tool timing on real hardware

`audio-timing-browser.ts`, five cases, all passing. Setup (tool, loadout, approach) is declared; the chop, the swing, the cast and the catch are the production paths. Two clocks are compared: the semantic marker reaching `CorealmAudioBridge`, and the `AudioBufferSource.start` it caused, both on `performance.now()`.

| Case | Scheduling offset (marker → source start) | Other measurements |
| --- | --- | --- |
| `chop` | 0.9 – 9.0 ms across 6 events | Semantic yield roll lands within 0.1 – 0.3 ms of the rig's impact marker. No stale impact after `corealm_stop`. |
| `mine` | 1.9 – 8.7 ms across 6 events | Roll within 0.2 – 0.5 ms of the impact marker. No stale impact after stop. |
| `melee` | swing 6.3 / 6.9 ms, impact 8.9 / 11.3 ms | Swing leads contact by **233 / 234 ms**, on the `Sword_Attack` clip's own marker. Rig contact frame lands **49 – 50 ms before** the semantic damage marker, so the thud trails the visible connection by that much. |
| `spell` | first cast 34.3 ms, second 9.4 ms; impacts 6.1 / 9.5 ms | Declared flight 423 / 300 ms against measured 496 / 299 ms. |
| `fish` | cast 5.2 ms, catch 5.5 ms | |

Findings and what was done:

- **Everything is within 12 ms except a spell's first cast.** The 34 ms outlier is the first decode of `magic-ember-cast-01.ogg`; the second cast of the same session is 9.4 ms. The same shape shows in the first measured flight (496 ms against a declared 423 ms) and disappears on the second (299 against 300). Not fixed: pre-warming a decode is a boot-cost decision that belongs to the loading slice, and the catalogue already preloads on unlock.
- **The melee audio trails the visible contact by ~50 ms.** Measured twice, consistently. The sound hangs off the semantic damage edge and the rig's contact frame arrives slightly earlier. Not "fixed": audio lagging video is the benign direction (roughly 125 ms before it is detectable, against 45 ms in the lead direction), and moving the cue onto the rig marker would mean sounding a hit before the simulation knows whether it landed. Recorded, not fudged.
- **Defect fixed in the check, not the game.** The melee case asserted that every contact presents as `impact`. It failed on the third contact of a run. That contact was the *bear* missing the *player*: `paintCombatHits` routes every resolved hit through the same handler, and an enemy hit is always `combined` because only the player's rig has a swing marker. The assertion now scopes to `attacker === "player"` and records enemy contacts separately. A new assertion checks that no `combat.melee_swing` starts within 60 ms of a contact frame — the stacking defect the previous round fixed.
- **An enemy melee miss is silent.** `cuesForCombatHit` returns nothing for an enemy attacker who misses, while the player's miss plays `combat.melee_miss`. The enemy's attack animation still plays. Noted, not changed: adding a cue for incoming misses is a design decision outside this slice.

Recorder pipeline bias (median offset between a scheduled start and its detected onset in the recording) ranged 16 – 101 ms across sessions and is not a game latency; it is the MediaRecorder path. Onset detection matched 2 – 5 of the scheduled starts per take: the detector needs a 10 dB rise in 5 ms and legitimately misses soft-attack cues like a sword whoosh or an ember cast. Scheduling offsets do not depend on it.

---

## 3. Region-to-cave ambience, and reload

`audio-actions-browser.ts --case travel`, passing. Real portal entry through `lab:portal:entry` and return through `lab:portal:exit`, both via `corealm_interact`.

| Leg | Region | Active loops | Desired loops | Running loop nodes |
| --- | --- | --- | --- | ---: |
| enter | `gravelmaw` | `ambient.cave` | `ambient.cave` | 1 |
| return | `fallowmarch` | `ambient.open-plains`, `music.distant-plains` | same | 2 |
| reload | `fallowmarch` | `ambient.open-plains`, `music.starter-plains` | same | 2 |

- Only the destination bed survives the crossfade, on both legs. Nothing is left in `desiredLoops` that is not also active — a loop the director wanted but never started would show there.
- **No orphan loops.** The node census counts running `AudioBufferSourceNode`s directly, and it equals the number of active beds. This is the check that a `stopLoop` which never releases its node would fail.
- **No double-start on reload.** Each active bed has exactly one `loop-start` in the fresh history.
- Two check defects were fixed here. The old script fired the return portal immediately after the region changed and got a real `BUSY` — `TravelSystem.pending` stays true until the curtain finishes, so it now waits for `.portal-transition` to leave the DOM. And it asserted the loop set before the outgoing beds had faded, which reported 3 nodes where 1 was expected; the outgoing sources are legitimately still running for the 1.4 – 1.8 s fade, so the check now waits for them and fails only if they never release.
- The return plays `music.distant-plains`, not `music.starter-plains`. That is `AudioDirector` advancing the two-track Fallowmarch pool per visit, working as designed.

---

## 4. Volume balance

Verified from a recorded production mix at the engine's **default** volumes (music 0.7, ambient 0.8, sfx 0.9), because the question is what a player who never opens the settings panel hears. One 28-second take, four phases, read back from the same recording with EBU R128: `audio-actions-browser.ts --case mix`.

### The defect

| Phase | Integrated LUFS | Over beds | True peak dBTP | Peak over beds |
| --- | ---: | ---: | ---: | ---: |
| beds only | -31.0 | — | -20.1 | — |
| footsteps | -29.8 | +1.2 LU | -17.1 | **+3.0 dB** |
| combat | -27.1 | +3.9 LU | -6.8 | +13.3 dB |
| UI | -29.2 | +1.8 LU | -9.8 | +10.3 dB |

A running player's own footsteps cleared the ambience bed by 3 dB, while a UI click cleared it by 10.3. Movement was the least audible thing in the game.

Root cause was the **engine**, not the catalogue. `AudioEngine` clamped the per-voice gain to 1, so a cue could only ever attenuate. `footstep-grass-01.ogg` decodes at -39.3 dBFS active RMS with its cue gain already at that ceiling, which anchored the whole footstep family at -39 dBFS. The frog croaks hit the same wall in the previous round and had to be re-encoded to escape it.

### The fix

- `engine.ts`: per-voice gain now clamps at **+12 dB** instead of unity, via `clampVoiceGain`. Bus gains, loop gains and bed gains are untouched and still clamp at 1, so no catalogue edit can push a bus. Nothing in the catalogue reached unity before this change, so the rest of the mix is bit-identical.
- `corealmCatalog.ts`: footsteps re-matched to **-35 dBFS active RMS with a -13.5 dBFS as-played peak cap**. RMS matching alone would leave the sharp stone heel click (27 dB crest) peaking 8 dB over the soft turf step; the cap pulls it down instead. As-played peaks now span -13.5 … -18.5 dBFS, against -11.9 … -22.5 before.

| Cue | Gain before | Gain after | As played RMS | As played peaks |
| --- | ---: | ---: | ---: | --- |
| `movement.footstep_grass` | 1.0 | **1.64** | -35.0 | -15.6 / -15.7 |
| `movement.footstep_forest` | 0.79 | **1.26** | -37.3 / -35.0 | -13.5 / -14.0 |
| `movement.footstep_cave` | 0.66 | 1.05 | -35.0 | -18.5 / -15.0 |
| `movement.footstep_wood` | 0.58 | 0.92 | -35.0 | -18.1 / -15.2 |
| `movement.footstep_stone` | 0.47 | 0.66 | -40.7 / -35.0 | -13.5 / -13.8 |
| `movement.footstep_dirt` | 0.30 | 0.47 | -35.0 | -17.4 |

### After

| Phase | Integrated LUFS | Over beds | True peak dBTP | Peak over beds |
| --- | ---: | ---: | ---: | ---: |
| beds only | -31.0 | — | -20.6 | — |
| footsteps | -28.4 | +2.6 LU | -13.6 | **+7.0 dB** |
| combat | -27.4 | +3.6 LU | -7.3 | +13.3 dB |
| UI | -29.0 | +2.0 LU | -10.5 | +10.1 dB |

Whole take: **-29.0 LUFS integrated, -6.9 dBTP true peak, 4.2 LU range.** Six decibels of true-peak headroom at default volumes, and combat is the loudest family by transient margin, as it should be.

Stated targets, chosen before the run rather than fitted to it: every family's transients clear the bed by at least 6 dB; every family adds level over the bed and none buries it by more than 30 LU; combat has the largest transient margin; the programme sits inside -31 … -14 LUFS with true peak at or under -1 dBTP.

**A note on the metric.** Integrated loudness is the wrong question for these families and the check says so. A 40 ms footstep transient carries almost no energy over a six-second window no matter how clearly it is heard, and combat's integrated figure measures how often the player swung — a duty cycle, not a mixing property. The transient margin is what decides whether a cue reads. An earlier version of this check asserted a fixed LU floor for combat, which it failed at 3.6 LU while having the best transient margin in the take; that threshold was measuring the wrong thing and was replaced rather than lowered to pass.

---

## 5. Death, travel and node cleanup

`audio-actions-browser.ts --case death` and `--case kills`, both passing. Node accounting comes from taps on `createBufferSource` / `createGain` / `createPanner` / `disconnect`, plus an `ended` listener on every started source that leaves the engine's own `onended` alone.

**Death** — a real lethal bear hit on a level-1 player with a worn sword:

- Exactly **one** `combat.player_death`. The director's own `cuesForCombatHit` also selects a death cue for a lethal enemy hit, but `player.died` calls `resetOneShots()` first, which invalidates it; the canonical event edge wins.
- No `creature.*` cue after the death. `tickCreatureAmbience` is gated on `player.health > 0`.
- `activeOneShots` 0 and `pendingOneShots` 0 after 2.5 s. Live sources 2, which is the two region beds.
- Fixed in the check: it asserted `player.health === 0` right after the death cue and raced the respawn, reading 23. It now reads the `player.died` event from the log.

**Five consecutive real kills** (Frog, level 2, spawned and killed through the production combat path):

| | before | after 5 kills |
| --- | --- | --- |
| buffer sources constructed | 4 | 23 |
| gain nodes constructed | 7 | 26 |
| panner nodes constructed | 1 | 1 |
| `disconnect` calls | 0 | 43 |
| live sources | 4 | 2 |
| live loop sources | 2 | 2 |

Live sources return to exactly the two region beds after every round — flat across all five, never climbing. 19 buffer sources for 5 kills is 3–4 voices each, and each finished voice disconnects its source and gain. No leak. `activeOneShots` and `pendingOneShots` are both 0 when it settles.

**Travel disposal** is covered in section 3: running loop nodes equal active beds after each crossing and after a reload.

---

## 6. Needs human listening

Nothing below can be settled by measurement. Each has a file path and a timestamp in a concatenated MP3.

Listening copies: `test-results/audio-review/2026-09-06T06-09-11-815Z/`. Every group has a `-raw` copy (the file as stored) and an `-as-played` copy (catalogue gain and rate applied). The full timestamp index is in `listening-sheet.md` in the same directory.

### Creature identity and role

`creatures-as-played.mp3`:

| At | Cue | File | Question |
| ---: | --- | --- | --- |
| 0:00.3 | `hen_cluck` | `animals/hen-cluck-01.ogg` | Ledger records these as generic `cute_01`/`cute_05` clips chosen by label. Does it sound like a hen? |
| 0:01.2 | `hen_cluck` | `animals/hen-cluck-02.ogg` | As above. |
| 0:11.4 | `cow_low` | `animals/cow-moo-02.ogg` | Measures 1835 Hz as played, above the moo band. Is this a cow? |
| 0:13.6 | `coney_squeak` | `animals/rodent-squeak-01.ogg` | 920 Hz — low for a squeak. Also carries the Gravelmaw rat, so a change affects both. |
| 0:14.8 | `coney_squeak` | `animals/rodent-squeak-02.ogg` | As above, 1011 Hz. |
| 0:15.6 | `viper_hiss` | `animals/serpent-hiss-01.ogg` | Sourced from a clip labelled `breath`. Does it read as a snake? |
| 0:16.9 | `viper_hiss` | `animals/serpent-hiss-02.ogg` | As above; also 5 clipped runs. |
| 0:17.9 | `stag_bell` | `animals/stag-bellow-01.ogg` | Sourced from generic monster roars (`roar_04`/`roar_05`). Does it read as a stag rather than a monster? |
| 0:19.4 | `stag_bell` | `animals/stag-bellow-02.ogg` | As above. |
| 0:25.5 | `coyote_howl` | `animals/coyote-howl-01.ogg` | Also carries Dire Wolf and Forest Wolf. Is a coyote acceptable for a wolf? |
| 0:26.8 | `coyote_howl` | `animals/coyote-bark-01.ogg` | As above. |
| 0:27.7 | `coyote_howl` | `animals/coyote-bark-02.ogg` | As above; 15 clipped runs. |
| 0:32.4 | `bear_roar` | `animals/bear-roar-01.ogg` | 85% below 150 Hz, centroid 129 Hz. Roar or rumble? |
| 0:24.1 | `hog_grunt` | `animals/boar-grunt-03.ogg` | 54 clipped runs in the source. Audible distortion? |
| 0:02.3 – 0:07.7 | `frog_croak` | four files | 0.19 s next to 1.26 s. Do they read as the same animal? |

### Prepared replacement candidates, not installed

`runs/corealm-rebuild/audio-candidates/listening-review.html` plays the current clips against CC0 crops side by side in a browser. Nothing has been substituted.

- Chicken: Breviceps, [Freesound 456803](https://freesound.org/people/Breviceps/sounds/456803/), CC0. Crops `chicken-candidate-1.ogg` (0.65 s), `chicken-candidate-2.ogg` (1.60 s).
- Rabbit: kessir, [Freesound 372075](https://freesound.org/people/kessir/sounds/372075/), CC0. Crops `rabbit-candidate-1.ogg` (0.54 s), `rabbit-candidate-2.ogg` (0.44 s). Note the rabbit crops measure -37.2 and -45.3 dBFS mean and may not contain a usable vocalization.
- Both are crops of the public lossy MP3 preview, not the original WAV. `manifest.json` records every SHA-256, interval and filter.
- A rabbit replacement must not silently change the rat: `coney` and `rat` share `creature.coney_squeak`.
- Deer: [IchBinChrist Freesound 407631](https://freesound.org/people/IchBinChrist/sounds/407631/) was identified as a candidate last round and **not** downloaded — the page returned 403 and its description links a video, so authorship needs verifying before use.
- Viper: no suitable candidate exists. Acoustic Atlas' Sonoran Gopher Snake is NC/ND, and qubodup's SNAKE is a human imitation under CC-BY-3.0. Current cue kept.

### Music loop seams

`loops-seams-as-played.mp3` plays 4 s either side of each bed's seam, at catalogue gain.

| At | Bed | Measured edge silence |
| ---: | --- | --- |
| 0:00.3 | `music.starter-plains` | 120 ms lead, 869 ms run-out |
| 0:08.9 | `music.distant-plains` | 650 ms lead, **2474 ms** run-out |
| 0:17.5 | `music.deep-woodland` | 835 ms lead, 969 ms run-out |
| 0:26.1 | `music.stone-city` | 535 ms lead, 24 ms run-out |

Each repeat therefore has a one- to three-second hole in it, roughly every two minutes. `loopStart`/`loopEnd` exist for exactly this and were tried. Set to the measured silence boundaries they made the seam **worse**: 0.12 s into `starter-plains` is still inside the fade-in, so the loop jumped from a full-level bar back to a near-silent one and the measured seam went from 9.6 dB to 23.9 dB. A loop point that works has to land on a musical boundary as well as a level match, and choosing one is a listening decision. Reverted; the beds still loop end to end. The four ambience beds measure 0 ms of edge silence and need nothing.

### Coverage decisions

- 53 of 69 enemy families have no idle voice (full list in section 1). Which of the uncovered animals should share an existing bank — bighorn on the goat bleat, spiders and mantis on the chitin click, crocodile and monitor lizard on the viper hiss — is a judgement about whether the shared throat convinces.
- The four ogres and three rhinos have no rights-traced recording of anything close. They need either a source decision or an explicit "stays silent".
- `creature.goat_bleat` ships a single variant, so a herd of ibex repeats one recording. A second bleat would need a new source.

### Everything else in the mix

The remaining listening copies in the same directory, for a general pass:

| File | Contents |
| --- | --- |
| `footsteps-as-played.mp3` | All 12 footstep files at the new gains, 6 surfaces. Worth a pass after this round's re-level. |
| `combat-as-played.mp3` | 20 files: swings, hits, misses, casts, impacts, boss slam, deaths. |
| `gathering-as-played.mp3` | 17 files: mining, chopping, tree fall, fishing. |
| `interaction-ui-production-as-played.mp3` | 37 files: doors, portals, loot, bank, trade, smithing, cooking, UI. |

Recorded production mixes, for the mix rather than the files:

| File | Contents |
| --- | --- |
| `test-results/audio-actions/mix-1788674151316/production-mix.mp3` | The 28 s default-volume balance take. Beds 2.6–8.1 s, footsteps 8.1–14.9 s, combat 14.9–21.6 s, UI 21.6–28.2 s. |
| `test-results/audio-timing/*/production-*.mp3` | Chop, mine, melee, spell and fishing sessions, 3–7 s each. |
| `test-results/audio-output/ambience-1788674638127/production-output.mp3` | The director stepping through all five authored region beds. |

---

## 7. Cleanup

Deleted:

- `runs/corealm-rebuild/checks/audio-gameplay-browser.ts` — gave `copper_hatchet` to the player, an item id that does not exist in `content/`, so it could not have run. `audio-timing-browser.ts --case chop` covers the same scenario with measured offsets and an MP3 copy.

Kept, with reasons:

- `runs/corealm-rebuild/audio-candidates/` (1.4 MB) — the chicken and rabbit crops, their previews, `manifest.json`, `quality-audit.json` and `listening-review.html` are all pending the user decision in section 6. Nothing here is obsolete.
- `prepare-audio-candidates.mjs` and `audio-quality-audit.mjs` — the tools that build and measure the above.
- 19 unreferenced files under `game/public/audio` (0.90 MB of 17 MB): `ambience/nox/deep-woodland-wind.ogg`, `filmcow-v1/{chest-close-wood-01,door-close-wood-01,footstep-dirt-01,footstep-grass-leaves-01,footstep-wood-branch-01,rake-wood-scrape-01}.ogg`, `filmcow-v4/shield-metal-strike-02.ogg`, `oga/{door-open,footstep-wet-01,footstep-wood-01,mining-impact-stone-02,mining-impact-stone-03,thunder,water-loop,wood-break-01,wood-fall-01,wood-hit-01,wood-hit-02}.ogg`. Every one is documented in a `docs/audio-source-*.md` ledger and none is referenced by any manifest or module. They are staged alternates for cues that already ship a choice, and deleting them would throw away the options a listening pass would want. Recorded as inventory, not removed.
- No dead catalogue entries found: all 57 cues map to `AUDIO_CUE_IDS`, all 8 loops are referenced by a region, and `FUTURE_REGION_MUSIC_FILES` names five tracks that are correctly absent from both the catalogue and `game/public`.

Ports: `audio-actions-browser.ts`, `audio-output-browser.ts` and `audio-spatial-browser.ts` had `127.0.0.1:4175` hard-coded — the root's lease. All audio checks now resolve through `audioCheckUrl()`: `--url`, then `COREALM_URL`, then 4186.

Evidence under `test-results/` is 5.6 MB across 20 MP3 listening copies and their reports. Every raw webm is deleted once its MP3 exists. `test-results/` is not committed.

---

## 8. Limits

- **No listening was done.** Section 6 exists because measurement cannot answer whether a recording sounds like the animal it is named after, whether a music loop point lands musically, or whether a source's clipping is audible.
- Timing evidence is from the feature lab's authored fixtures on one machine's GPU, not from the final world. The rig markers, combat resolution, spell flight and gathering ticks are production code; the tool, loadout and approach are declared setup.
- The balance take is 28 seconds of one region at default volumes. It does not cover the cave, a boss fight, a dense encounter, or a player who has changed the sliders.
- Recorder pipeline bias (16 – 101 ms) is a MediaRecorder property. It affects where a cue appears inside the recording, not the scheduling offsets, which are measured from `performance.now()` on both sides.
- Onset detection in the recording matched 2–5 of the scheduled starts per take. Soft-attack cues are legitimately missed; no conclusion is drawn from an unmatched start.
- No performance claim is made. Nothing here was measured for frame cost.
- The `+12 dB` voice-gain ceiling is a stated bound, not a measured one. It is far above anything the catalogue uses (1.64 is the highest) and exists so a future quiet source is not silently clamped.
