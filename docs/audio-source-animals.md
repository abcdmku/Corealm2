# Corealm animal voice source ledger

This ledger covers the animal voice clips in `game/public/audio/sfx/animals/`, added with the
wildlife bestiary. All pages were checked on **2026-08-29**.

The curation target is the same as the other ledgers: grounded medieval-fantasy, no modern,
electronic, comic or firearm material. Everything here is either a species recording or a labelled
creature vocalization; nothing sci-fi was accepted, including from the one pack that is mostly
sci-fi.

## Licence verification

Every source page displayed `License(s): CC0` with a licence link resolving to
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/), which permits copying,
modification, distribution and commercial use without asking permission. Attribution is not
required by CC0; authors and pages are recorded below for provenance.

Verified with `curl` against each page and matching `creativecommons.org/publicdomain/zero/1.0/`
inside the page's `field-name-field-art-licenses` block:

| Page | Author | Licence evidence |
| --- | --- | --- |
| [Frog Croaks](https://opengameart.org/content/frog-croaks) | OGA contributor | `License(s): CC0` |
| [Ribbit Frog Sounds](https://opengameart.org/content/ribbit-frog-sounds) | OGA contributor | `License(s): CC0` |
| [Sheep Baa](https://opengameart.org/content/sheep-baa) | OGA contributor | `License(s): CC0` |
| [Bear Growls](https://opengameart.org/content/bear-growls) | OGA contributor | `License(s): CC0` |
| [Sci-Fi Aliens and Cows Pack](https://opengameart.org/content/sci-fi-aliens-and-cows-pack) | qubodup | `License(s): CC0` |
| [80 CC0 creature SFX](https://opengameart.org/content/80-cc0-creature-sfx) | rubberduck | `License(s): CC0` |
| [80 CC0 creature SFX #2](https://opengameart.org/content/80-cc0-creture-sfx-2) | rubberduck | `License(s): CC0` |

rubberduck is the same author as the metal/wood packs already accepted in
`docs/audio-source-opengameart.md`.

## Selection method, stated plainly

**These clips were chosen by author-given label and file inspection, not by listening to them.**
That is a real limitation of how this set was curated and it is recorded here rather than implied
away.

It is reliable for the species recordings, where the filename is the whole claim: `sheep_baa`,
`bear_01`, `croak_02`, `moo-notification`. It is weaker for the two rubberduck creature packs,
whose filenames name the SOUND rather than the animal — `howl`, `grunt_03`, `roar_05`, `bug_07`,
`cute_01`, `hurt_02`, `die_04`. Those were mapped to the animal whose voice that sound is.

The mappings most worth a human ear before release, in order:

1. `creature.hen_cluck` — from `cute_01` / `cute_05`. There is no CC0 chicken recording anywhere on
   OpenGameArt (searched: `chicken`, `cluck`, `hen`, `poultry`, `farm`, `livestock`, all empty
   under the CC0 + Sound Effect filter). These are small creature vocalizations standing in for a
   cluck and are the least certain match in the set.
2. `creature.stag_bell` — from `roar_04` / `roar_05`. A red deer's rut call is a roaring bellow, so
   the category is right, but these are monster roars rather than a stag.
3. `creature.viper_hiss` — from `breath` / `breath_02`. Labelled as breath, used as a hiss.
4. `creature.coney_squeak` — from `cute_03` / `cute_07`, shared with the Gravelmaw rat.

## Rejected

- The whole sci-fi half of qubodup's cow pack: `beam-down`, `beam-up`, `beam-wowow`,
  `beam-wowowfast`, `gun-piu`, `gun-zap`, `gameover-lose`, `gameover-win`. Only the two real moos
  were taken.
- [Boar](https://opengameart.org/content/boar) — reached through a `boar` tag search but the page
  is a **3D model** (`boar_0.blend`), not audio. No boar recording exists on OGA under CC0, so the
  hog and boar families use rubberduck's `grunt_*` clips.
- [Squeaky Rat](https://opengameart.org/content/squeaky-rat) — CC0, but the page exposes only an
  `audio_preview` montage rather than a per-clip attachment. Not worth shipping a montage; the rat
  shares the coney's squeak instead.
- [Rabbit Eating](https://opengameart.org/content/rabbit-eating) — CC0, downloaded (2,351,592 B
  `RabbitEating.wav`) and then **not shipped**: it is a two-and-a-half-megabyte eating loop, not a
  vocalization, and the coney needs a call rather than a chewing bed.
- Every `alien_*`, `slime_*`, `troll_*`, `human_*`, `monster_*` and `weird_*` clip in both
  rubberduck packs. Corealm's bestiary is real animals; a monster snarl would undo that.

## Shipped files

Staged by `tools/animals/stage-audio.py`, which prints the byte size and SHA-256 of every file it
writes. Sources that arrived as mp3 or wav were transcoded to Ogg Vorbis at `-q:a 5`, 44.1 kHz,
because `tests/audioCatalog.test.ts` asserts every sfx URL ends in `.ogg`.

| Shipped file | Source | Used by |
| --- | --- | --- |
| `frog-croak-01/02/03.ogg` | Frog Croaks `croak_01_0.mp3`, `croak_02.mp3`, `croak_03.mp3` | `creature.frog_croak` |
| `frog-ribbit-01.ogg` | Ribbit Frog Sounds `ribbit_01.mp3` | `creature.frog_croak` |
| `goat-bleat-01.ogg` | Sheep Baa `sheep_baa_0.ogg` | `creature.goat_bleat` (goat, ibex) |
| `bear-growl-01/02.ogg` | Bear Growls `bear.zip!ogg/bear_01.ogg`, `bear_02.ogg` | `creature.bear_roar` |
| `bear-roar-01.ogg` | 80 CC0 creature SFX `roar_02.ogg` | `creature.bear_roar` |
| `cow-moo-01/02.ogg` | qubodup pack `moo-notification.wav`, `moo-death.wav` | `creature.cow_low` (cattle, aurochs) |
| `coyote-howl-01.ogg` | 80 CC0 creature SFX `howl.ogg` | `creature.coyote_howl` |
| `coyote-bark-01/02.ogg` | 80 CC0 creature SFX `barking_01.ogg`, `barking_02.ogg` | `creature.coyote_howl` |
| `boar-grunt-01/02/03.ogg` | creature SFX `grunt_01.ogg`, `grunt_03.ogg`, #2 `grunt_07.ogg` | `creature.hog_grunt` (hog, boar) |
| `stag-bellow-01/02.ogg` | creature SFX #2 `roar_04.ogg`, `roar_05.ogg` | `creature.stag_bell` |
| `serpent-hiss-01/02.ogg` | creature SFX `breath.ogg`, #2 `breath_02.ogg` | `creature.viper_hiss` |
| `chitin-click-01/02/03.ogg` | creature SFX `bug_02.ogg`, #2 `bug_07.ogg`, `bug_11.ogg` | `creature.chitin_click` (scorpion, crab) |
| `rodent-squeak-01/02.ogg` | creature SFX `cute_03.ogg`, `cute_07.ogg` | `creature.coney_squeak` (coney, rat) |
| `hen-cluck-01/02.ogg` | creature SFX `cute_01.ogg`, `cute_05.ogg` | `creature.hen_cluck` |

Total: 27 files.

### Level correction, 2026-09-05

The four frog files shipped 15-23 dB quieter than every other animal voice: decoded peaks of
-34 to -41 dBFS and active RMS of -45 to -53 dBFS, which put them under the plains wind bed even
at full cue gain. They were re-encoded from the shipped Ogg files with a plain gain stage
(`ffmpeg -i <in> -map_metadata -1 -af volume=<gain>dB -c:a libvorbis -q:a 5`), bringing each
active RMS to about -26 dBFS. No trim, EQ, pitch or other change; this is a second lossy
generation on top of the original mp3-to-Vorbis transcode, accepted because the original mp3
attachments are not kept in the repository.

| File | Gain | Bytes | SHA-256 after |
| --- | ---: | ---: | --- |
| `frog-croak-01.ogg` | +18.7 dB | 15,515 | `5f116350d39b2eb6dae2d51bf6241f2cd386157a31bbbef850e3cb6ab35f692b` |
| `frog-croak-02.ogg` | +19.2 dB | 7,010 | `adcc9f4ddf13cfae743dd2f63f866d5c5f3474edd562979f02c6bb20af7d2a52` |
| `frog-croak-03.ogg` | +23.6 dB | 18,871 | `43d149bfb0614af0f131f0b015d11af583e479c04482a7b7f788747c50d62eb1` |
| `frog-ribbit-01.ogg` | +26.6 dB | 18,258 | `732724bf5a5dfc727b9b7aeda95c59391774cf805db885736224685d4733364c` |

Every other animal file is byte-identical to its staged version. Level differences between the
remaining variants (the third boar grunt was 10 dB over the other two, the second serpent breath
14 dB over the first) are corrected by per-variant gains in `game/src/audio/corealmCatalog.ts`,
measured by `runs/corealm-rebuild/checks/audio-file-review.ts`, not by touching the files.

`beast-hurt-01/02.ogg` and `beast-die-01/02.ogg` were here and have been removed, along with the
`creature.beast_hurt` and `creature.beast_death` cues they backed. They were picked out of a generic
creature pack by filename rather than by ear, and what actually played under a cow being hit was a
bird call. See "How they are triggered" below.

## How they are triggered

`game/src/audio/director.ts` owns the family-to-voice map (`CREATURE_VOICE`) and
`game/src/audio/gameAudio.ts` plays them:

- **Idle calls** — `tickCreatureAmbience` finds the nearest living animal within 34 m and plays its
  voice every 4.2–7.8 s, with gain falling off as the square of distance. Nearest only, not all:
  a nine-strong shoal calling together is noise. The interval is derived from a hash of the entity
  id, so it is deterministic across runs like the rest of the audio layer.
- **Hurt and death** — nothing from this pack. Being hit plays `combat.melee_hit` and dying plays
  `combat.enemy_death`, the same as for any other enemy in the game.

  There used to be a shared `creature.beast_hurt` layered under the weapon, and a matching death
  cue. Both are gone. The recordings were chosen from a generic creature pack by filename and never
  auditioned, so the flinch playing under a cow was a bird call — "a cow will crow like a bird on
  hit". A single shared cue was always going to be wrong for something with sixteen families using
  it, and the weapon layer already carries the whole event on its own.

Idle voices are additionally scaled by `CREATURE_CALL_GAIN` in `gameAudio.ts`, which trims the whole
layer against the music and ambience beds without disturbing the balance between the animals.

The two humanoid families, `reaver` and `quarrykeeper`, have no entry in `CREATURE_VOICE` and stay
silent.
