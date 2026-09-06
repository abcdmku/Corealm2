# Audio acceptance follow-up

Production files remain AudioEngine, AudioDirector and CorealmAudioBridge. The existing offline HRTF graph test proves directional energy and attenuation. It does not prove subjective source quality or real gameplay contact timing.

## CPU output recordings

`npx tsx runs/corealm-rebuild/checks/audio-output-browser.ts --case species`

`npx tsx runs/corealm-rebuild/checks/audio-output-browser.ts --case ambience`

`npx tsx runs/corealm-rebuild/checks/audio-output-browser.ts --case contacts`

These DOM-only Chromium runs disable GPU, decode actual production catalogue files, and capture the production bus mix with MediaRecorder. Each has a 59-second ceiling and timestamped evidence. Species and contacts are soundboard stimuli, with 2.6-second excerpts then reset; they are not gameplay timing evidence. Species records the first variant of each of eleven cue families. Ambience uses the real director to transition through all five authored region beds, then disposes the director. Reports include cue/loop history and an elapsed-time track list for listening.

Verified recordings:

- `test-results/audio-output/species-1788642913339/production-output.webm`: eleven cue families; decoding/recording passed. FFmpeg measured mean -32.8 dBFS, peak -10.8 dBFS.
- `test-results/audio-output/ambience-1788642961378/production-output.webm`: region sequence passed. After five seconds in each region, only that region's loops remain; Kilnhalt has upland ambience only, Gravelmaw cave ambience only. Disposal leaves no desired/active loops. Mean -26.2 dBFS, peak -9.7 dBFS.
- `test-results/audio-output/contacts-1788643070136/production-output.webm`: thirteen material/contact/combat/death cue excerpts; decoding/recording passed. Mean -37.7 dBFS, peak -5.3 dBFS. Each recording also has a `production-output.mp3` listening copy.

No listening claim is made. Available tools do not provide audio perception. The source ledger `docs/audio-source-animals.md` expressly records label-based selection and calls out hen, stag, viper and coney substitutes as uncertain. Wolf-named actors still use the coyote family bank, and three rhino boss families have no idle voice. These are source/coverage observations, not subjective judgments or instructions to add unsuitable generic recordings.

## Queued integrated recording

`npx tsx runs/corealm-rebuild/checks/audio-gameplay-browser.ts`

Requires the root's GPU lease at port 4175. The helper enables actual audio, validates hardware Direct3D11, records the production mix, uses declared hatchet/approach fixture setup, invokes real chopping, waits for two actual wood impact cues, stops, and checks no stale impact occurs afterward. Reports include semantic saves, events, audio cue history and actual AudioBufferSource start timestamps. It is prepared and syntax-checked; hardware execution remains queued.

## Remaining scope

Listening review of the captured species/contacts/ambience output remains required. Integrated combat swing/contact, spell launch/arrival, realm travel/death cleanup and live interior ambience still need recorded gameplay evidence. CPU tests currently cover realm reset generation, listener updates, dead-player animal suppression, time rewind, and exact rig-event routing. Boot wires mining/woodcutting/footsteps from CharacterRig motion markers and combat presentation phases; spell launch uses its semantic event. Those source facts do not replace visual/audio synchronization acceptance.

Four additional GPU shards are prepared, each with a separate 59-second ceiling:

`npx tsx runs/corealm-rebuild/checks/audio-actions-browser.ts --case combat`

`npx tsx runs/corealm-rebuild/checks/audio-actions-browser.ts --case spell`

`npx tsx runs/corealm-rebuild/checks/audio-actions-browser.ts --case death`

`npx tsx runs/corealm-rebuild/checks/audio-actions-browser.ts --case travel`

Combat and spell use an authored Brown Bear fixture and production attack/cast. Death sets one health as a prerequisite, then requires a normal lethal enemy hit. Travel approaches the authored lab portals, invokes real entry/return, and waits for the proper region loops. `audio-capture-support.ts` wraps existing bridge methods in the served diagnostic document without altering their arguments/results; the record contains real motion/event dispatch timestamps and AudioBufferSource starts alongside production cue history. Hardware execution is queued, not accepted.

## Specific source replacement candidates

Source-page audit on September 5, 2026; none was downloaded or substituted. These recommendations concern documented source identity, not sounds heard by this agent.

| Current uncertain cue | Proposed candidate | Verified source and limitation |
| --- | --- | --- |
| Hen (`cute_01`, `cute_05` generic creature clips) | [Chicken clucking, Breviceps](https://freesound.org/people/Breviceps/sounds/456803/) | Author describes chicken clucking; page states CC0; 14.953-second mono WAV, 16 kHz. Prefer extracting individual clucks after listening. Original download requires Freesound login. |
| Coney/rabbit (`cute_03`, `cute_07`) | [Rabbit oinks and squeaks, kessir](https://freesound.org/people/kessir/sounds/372075/) | Author identifies their own rabbit recording; page states CC0; 39-second mono WAV, 44.1 kHz. Needs isolated call selection. Original download requires login. The existing cue is shared with rats, so a rabbit-specific change must not silently change rat source identity. |
| Stag (`roar_04`, `roar_05` generic creature roars) | [Bellowing deer, IchBinChrist](https://freesound.org/people/IchBinChrist/sounds/407631/) | Search-returned source page states CC0 and deer bellowing; 16.752-second MP3. Direct page returned 403 and the description links video, so verify authorship/origin and listen before replacing. This is a candidate, not an accepted asset. |
| Viper (`breath`, `breath_02`) | No verified better shipping candidate yet | [Sonoran Gopher Snake hiss](https://acousticatlas.org/item/1106) is a documented captive snake recording, but its NC/ND licence is unsuitable for this shipping/edit workflow. [Qubodup SNAKE](https://freesound.org/people/qubodup/sounds/182789/) is a human imitation with CC-BY3 requirements; substituting it would not resolve the species-recording uncertainty. Keep current cue pending a suitable source/listening decision. |
