# Public preview cue candidates

These files were obtained from the normal public preview links exposed by the two Freesound creator pages. No login or original-WAV download was used. Both pages display CC0 and creator descriptions identifying the animal. `manifest.json` records the exact preview and crop SHA-256 values, source URLs, formats, durations, filters and measured levels.

- Chicken: Breviceps, [Chicken clucking](https://freesound.org/people/Breviceps/sounds/456803/), public HQ MP3 preview, mono 16 kHz, 14.953625 seconds, approximately 107 kbit/s.
- Rabbit: kessir, [Rabbit oinks and squeaks](https://freesound.org/people/kessir/sounds/372075/), public HQ MP3 preview, mono 44.1 kHz, 39 seconds, approximately 189 kbit/s.
- Licence shown by each page: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

The preview is lossy. Candidate crops decode that preview and re-encode Vorbis quality 5; the sample rate is preserved. Ten-millisecond fade-ins and thirty-millisecond fade-outs soften cut boundaries, and a six-decibel trim keeps output quiet. Crop intervals follow measured silence boundaries with context. They are not certified as isolated vocalizations by listening.

| Candidate | Source interval | Duration | Mean / peak dBFS |
| --- | --- | --- | --- |
| chicken-candidate-1.ogg | 1.14–1.79 s | 0.65 s | -23.8 / -14.7 |
| chicken-candidate-2.ogg | 6.35–7.95 s | 1.60 s | -25.1 / -10.9 |
| rabbit-candidate-1.ogg | 6.44–6.98 s | 0.54 s | -37.2 / -18.5 |
| rabbit-candidate-2.ogg | 8.07–8.51 s | 0.44 s | -45.3 / -17.1 |

Prepared by `node runs/corealm-rebuild/checks/prepare-audio-candidates.mjs` from the retained public preview bytes. No production catalogue or assets have been replaced. A listening reviewer should assess background noise and whether each crop contains a useful vocalization, especially the quiet rabbit transients. Rabbit replacements should not change the rat family's sound implicitly: the current generic coney cue is shared by both families.
