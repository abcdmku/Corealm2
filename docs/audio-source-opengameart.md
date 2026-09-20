# Corealm OpenGameArt SFX source ledger

This ledger covers the compact OpenGameArt sound-effect set copied to
`game/public/audio/sfx/oga/`. The six supplied pages were checked on **2026-08-29** (the request
says five pages but lists six, so all six are covered here). The curation target is Corealm's
grounded medieval-fantasy tone: stone and wood work, smithing, simple construction, doors,
footsteps, water, and weather. Modern, electronic, highway, construction-site, machine, glass,
and semantically ambiguous clips are not shipped.

## Additional CC0 consume cue

`game/public/audio/sfx/oga/apple-bite.ogg` was downloaded directly from the OpenGameArt
[Apple Bite](https://opengameart.org/content/apple-bite) attachment
`https://opengameart.org/sites/default/files/apple_bite_0.ogg`. The page identifies the asset as
CC0 and describes it as an apple bite extracted from Freesound source 333825. The shipped file is
the original Ogg/Vorbis attachment without transcoding: mono, 44.1 kHz, 0.817868 seconds, 16,115
bytes, SHA-256 `7965335fe2fd8f0d43ba644d60a16815420bfbc069fdcc46661f19e2df7c83e4`.

## Page and attachment verification

Every supplied OpenGameArt page displayed `License(s): CC0`. The license link resolves to
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/), which permits copying,
modification, distribution, and commercial use without asking permission. Attribution is not
required by CC0, but the page authors and source pages are retained here for provenance.

The attachment URL sometimes has a Drupal collision suffix (`_0`) even though the filename shown
in the page's **File(s)** row does not. Both names are recorded below. All downloads returned HTTP
200 and were opened or decoded successfully.

| OpenGameArt page | Author / page date | Attachment shown on page | Download URL / verification | Page license evidence | Decision |
| --- | --- | --- | --- | --- | --- |
| [100 CC0 metal and wood SFX](https://opengameart.org/content/100-cc0-metal-and-wood-sfx) | rubberduck, 2018-07-04 | `100-CC0-wood-metal-SFX.zip` | [`100-CC0-wood-metal-SFX.zip`](https://opengameart.org/sites/default/files/100-CC0-wood-metal-SFX.zip), HTTP 200, 1,990,361 bytes, SHA-256 `be6eba63b03409ac0c77787a956b1503a7c186403d04aef9725c52644a4b7878`; extracted 100 OGG entries | Page **License(s): CC0** | Partially accepted: 10 clearly labelled work/wood/metal/door variants; the rest are redundant, ambiguous, or out of the compact scope. |
| [100 CC0 SFX #2](https://opengameart.org/content/100-cc0-sfx-2) | rubberduck, 2018-10-26 | `sfx_100_v2.zip` | [`sfx_100_v2.zip`](https://opengameart.org/sites/default/files/sfx_100_v2.zip), HTTP 200, 2,367,871 bytes, SHA-256 `0fc61b4494e2e893c0c015ced4877b3f689c7d84a48cb61daecd7ddb52db797b`; extracted 100 OGG entries | Page **License(s): CC0** | Partially accepted: stone impacts, grounded footsteps, a water loop, and thunder. Modern/ambiguous loops and duplicates are excluded. |
| [Breaking Rock](https://opengameart.org/content/breaking-rock) | themightyglider, 2020-02-17 | `rock_break.ogg` | [`rock_break_0.ogg`](https://opengameart.org/sites/default/files/rock_break_0.ogg), HTTP 200, 8,852 bytes, SHA-256 `b645f35d21194e7855dd4a5405b1e8e6bec070731b92df6abcb202676b8e9f2e` | Page **License(s): CC0** | Accepted as the dedicated mining/rock-break cue. |
| [tree chop fall thud](https://opengameart.org/content/tree-chop-fall-thud) | kheetor, 2025-09-19 | `chop-tree-fall.ogg` | [`chop-tree-fall.ogg`](https://opengameart.org/sites/default/files/chop-tree-fall.ogg), HTTP 200, 194,760 bytes, SHA-256 `21842dd004b46315a5d52be80997773421d8b1d3a0d473ddbcad388efd93b33a` | Page **License(s): CC0** | Accepted as the complete chop, creak, and tree-grounding sequence. |
| [Blacksmith's Hammer](https://opengameart.org/content/blacksmiths-hammer) | VishwaJai, 2021-08-15 | `blacksmithhammer.mp3` | [`blacksmithhammer_0.mp3`](https://opengameart.org/sites/default/files/blacksmithhammer_0.mp3), HTTP 200, 23,210 bytes, SHA-256 `d1b17b06965faed05a6d7ae237b93cd476b5eccf3b99137d0b73594378d6a3b5` | Page **License(s): CC0**; page says all uses are permitted and attribution is optional | Rejected as a lossy duplicate of the WAV attachment; the WAV was used for the OGG conversion. |
| [Blacksmith's Hammer](https://opengameart.org/content/blacksmiths-hammer) | VishwaJai, 2021-08-15 | `blacksmithhammer.wav` | [`blacksmithhammer.wav`](https://opengameart.org/sites/default/files/blacksmithhammer.wav), HTTP 200, 88,588 bytes, SHA-256 `a26c2e964e468fb7e68c8adf2b1c1d6e6778fe6e5ef4842463ae211e55ec7ae2` | Page **License(s): CC0**; page says all uses are permitted and attribution is optional | Accepted as the lossless source for the smithing/anvil cue, then transcoded to OGG Vorbis. |
| [Fast Hammer SFX](https://opengameart.org/content/fast-hammer-sfx) | themightyglider, 2017-11-17; collaborator bart | `craft.ogg` | [`craft_0.ogg`](https://opengameart.org/sites/default/files/craft_0.ogg), HTTP 200, 19,972 bytes, SHA-256 `ddd8bc57113e3f5b82d34477864518adcfc2a39670891c5f5a978e3caf7e2ff0` | Page **License(s): CC0** | Accepted as the purpose-labelled crafting hammer cue. |

The [Breaking Rock](https://opengameart.org/content/breaking-rock) page identifies its source as a
Freesound recording; that linked page also displays [Creative Commons 0](https://freesound.org/people/SoundCollectah/sounds/109360/).
The [Fast Hammer SFX](https://opengameart.org/content/fast-hammer-sfx) page identifies its source
as [68 Workshop Sounds](https://opengameart.org/content/68-workshop-sounds), whose page also
displays CC0. The shipped rights decision remains based on the supplied attachment pages' CC0
declarations, with those upstream pages recorded as additional provenance.

## Shipped file ledger

Existing OGG/Vorbis attachments were copied bit-for-bit and renamed to lowercase kebab case. The
only codec conversion was `blacksmithhammer.wav` to `smithing-anvil.ogg`; no gain, trim, or content
editing was applied. For copied files, source and shipped hashes are identical. Durations are
`ffprobe` format durations in seconds.

| Cue family | Shipped file | Original filename / source attachment | Transformation | Duration (s) | Source SHA-256 | Shipped SHA-256 | Acceptance rationale |
| --- | --- | --- | --- | ---: | --- | --- | --- |
| Mining impact | `mining-impact-stone-01.ogg` | `sfx100v2_stones_01.ogg` from `sfx_100_v2.zip` | Copy + rename | 0.489042 | `20d293a892e1fa6330da2569065aa260a822198bddce2b183f8c11642e7deb4d` | `20d293a892e1fa6330da2569065aa260a822198bddce2b183f8c11642e7deb4d` | Natural stone impact variant for repeated mine hits. |
| Mining impact | `mining-impact-stone-02.ogg` | `sfx100v2_stones_02.ogg` from `sfx_100_v2.zip` | Copy + rename | 0.555375 | `23f8c7335eb656ea759899946ed665712ec41f4572656f421f7f5652bea66279` | `23f8c7335eb656ea759899946ed665712ec41f4572656f421f7f5652bea66279` | Natural stone impact variant for repeated mine hits. |
| Mining impact | `mining-impact-stone-03.ogg` | `sfx100v2_stones_03.ogg` from `sfx_100_v2.zip` | Copy + rename | 0.534500 | `94d7e0978fd90621d2d24e8ea33eefbae2933a434bb14c643cc12ea5175cefa9` | `94d7e0978fd90621d2d24e8ea33eefbae2933a434bb14c643cc12ea5175cefa9` | Third stone impact variant; distinct enough for a small mining pool. |
| Rock break | `rock-break.ogg` | `rock_break.ogg` from [Breaking Rock](https://opengameart.org/content/breaking-rock) | Copy + rename | 0.436875 | `b645f35d21194e7855dd4a5405b1e8e6bec070731b92df6abcb202676b8e9f2e` | `b645f35d21194e7855dd4a5405b1e8e6bec070731b92df6abcb202676b8e9f2e` | Dedicated rock-breaking recording; page tags it pickaxe/stone/wall. |
| Tree chop/fall | `tree-chop-fall.ogg` | `chop-tree-fall.ogg` from [tree chop fall thud](https://opengameart.org/content/tree-chop-fall-thud) | Copy + rename | 2.670292 | `21842dd004b46315a5d52be80997773421d8b1d3a0d473ddbcad388efd93b33a` | `21842dd004b46315a5d52be80997773421d8b1d3a0d473ddbcad388efd93b33a` | Page explicitly describes chopping, creaking, and tree hitting the ground. |
| Wood break | `wood-break-01.ogg` | `wood_breaking_01.ogg` from `100-CC0-wood-metal-SFX.zip` | Copy + rename | 0.564792 | `83a0e17e536a17897d5915e88c9e70d0be06d0a43bb3a38f44314ada46b06a3e` | `83a0e17e536a17897d5915e88c9e70d0be06d0a43bb3a38f44314ada46b06a3e` | Short wood-breaking variant for the end of a chopping activity. |
| Wood fall | `wood-fall-01.ogg` | `wood_falling_01.ogg` from `100-CC0-wood-metal-SFX.zip` | Copy + rename | 0.638958 | `38c5307455f35c3b61e06fbd01cae41f245cd45b12807747bd5830b2ff7448d1` | `38c5307455f35c3b61e06fbd01cae41f245cd45b12807747bd5830b2ff7448d1` | Compact fall/thud variant for a felled tree. |
| Smithing/anvil | `smithing-anvil.ogg` | `blacksmithhammer.wav` from [Blacksmith's Hammer](https://opengameart.org/content/blacksmiths-hammer) | Transcoded WAV to OGG Vorbis q5, 44.1 kHz mono; metadata retained | 0.500000 | `a26c2e964e468fb7e68c8adf2b1c1d6e6778fe6e5ef4842463ae211e55ec7ae2` | `abc8680748e28ec73690f8a945fb08e1f20540e0613a721a9bb90a0b6342463b` | Page describes a hammer striking a mid-sized anvil; canonical forge cue. |
| Smithing/metal hit | `smithing-metal-hit-01.ogg` | `metal_hit_01.ogg` from `100-CC0-wood-metal-SFX.zip` | Copy + rename | 0.268750 | `f5fd185fce454947c1d91ce6757e219c4d7c6c139d4aa9d419cd7a79c7f6df3b` | `f5fd185fce454947c1d91ce6757e219c4d7c6c139d4aa9d419cd7a79c7f6df3b` | Short metal impact variant for smithing/smelting. |
| Smithing/metal hit | `smithing-metal-hit-02.ogg` | `metal_hit_02.ogg` from `100-CC0-wood-metal-SFX.zip` | Copy + rename | 0.434750 | `9074c0828727bd00834cabcaaf5b8cbff2cfad7b45676b95d86c0919e444f8b1` | `9074c0828727bd00834cabcaaf5b8cbff2cfad7b45676b95d86c0919e444f8b1` | Longer metal impact variant for smithing/smelting. |
| Crafting | `craft-hammer.ogg` | `craft.ogg` from [Fast Hammer SFX](https://opengameart.org/content/fast-hammer-sfx) | Copy + rename | 0.800000 | `ddd8bc57113e3f5b82d34477864518adcfc2a39670891c5f5a978e3caf7e2ff0` | `ddd8bc57113e3f5b82d34477864518adcfc2a39670891c5f5a978e3caf7e2ff0` | Page tags it crafting and says it is for crafted items. |
| Building hammer | `building-hammer-01.ogg` | `hammer_01.ogg` from `100-CC0-wood-metal-SFX.zip` | Copy + rename | 0.503792 | `ebbeac7365b2b4f4eaa6829a3c09e0be46e20950f8322eb5c72a616679d6c482` | `ebbeac7365b2b4f4eaa6829a3c09e0be46e20950f8322eb5c72a616679d6c482` | General hand-tool hammer variant for building interactions. |
| Building hammer | `building-hammer-02.ogg` | `hammer_02.ogg` from `100-CC0-wood-metal-SFX.zip` | Copy + rename | 0.237146 | `0e4a3eac2ffd7bd7f3d7dea84df761bd2ef1dbe754199d16f11aa8dd5a668781` | `0e4a3eac2ffd7bd7f3d7dea84df761bd2ef1dbe754199d16f11aa8dd5a668781` | Short general hand-tool hammer variant; keeps building cues varied. |
| Wood interaction | `wood-hit-01.ogg` | `wood_hit_03.ogg` from `100-CC0-wood-metal-SFX.zip` | Copy + rename | 0.407042 | `0f78a5cbe44d2ee45dfc1709f72af87bcbe5e3a8ad369b52535cfe6dbbd626a6` | `0f78a5cbe44d2ee45dfc1709f72af87bcbe5e3a8ad369b52535cfe6dbbd626a6` | Clean labelled wood impact for axes, tables, and wooden props. |
| Wood interaction | `wood-hit-02.ogg` | `wood_hit_04.ogg` from `100-CC0-wood-metal-SFX.zip` | Copy + rename | 0.302750 | `c7723f3c577cc6f46b091233fcb735016c6e15d462b371393baa4d265aef52b6` | `c7723f3c577cc6f46b091233fcb735016c6e15d462b371393baa4d265aef52b6` | Short labelled wood impact variant. |
| Metal interaction | `metal-sheet.ogg` | `metal_sheet_01.ogg` from `100-CC0-wood-metal-SFX.zip` | Copy + rename | 0.442396 | `114002a50404928b5e257d1d188d1da5f197c251868ef37182e9aba15bca7a72` | `114002a50404928b5e257d1d188d1da5f197c251868ef37182e9aba15bca7a72` | Grounded sheet/metal handling cue; useful for equipment and workshop interactions. |
| Door | `door-open.ogg` | `door_open_01.ogg` from `100-CC0-wood-metal-SFX.zip` | Copy + rename | 0.433271 | `58455b99af8f62b10559607435de0f72b9c798ebe085f49101df3c3d9ec043c7` | `58455b99af8f62b10559607435de0f72b9c798ebe085f49101df3c3d9ec043c7` | Clearly labelled physical door opening; fits gates and town doors. |
| Footstep | `footstep-ground-01.ogg` | `sfx100v2_footstep_01.ogg` from `sfx_100_v2.zip` | Copy + rename | 0.417354 | `007a96c62d6c335df0d292bdc5cf44fef768b7e2f14378759d03673be6be7ec6` | `007a96c62d6c335df0d292bdc5cf44fef768b7e2f14378759d03673be6be7ec6` | Generic grounded step for plains/stone fallback. |
| Footstep | `footstep-ground-02.ogg` | `sfx100v2_footstep_02.ogg` from `sfx_100_v2.zip` | Copy + rename | 0.355167 | `8b478a7245bbe358fcddaa5047f8f4e29c8eca52ff79c25d489b5f378747228c` | `8b478a7245bbe358fcddaa5047f8f4e29c8eca52ff79c25d489b5f378747228c` | Second generic grounded step for variation. |
| Footstep/wet | `footstep-wet-01.ogg` | `sfx100v2_footstep_wet_01.ogg` from `sfx_100_v2.zip` | Copy + rename | 0.282938 | `c2663b62fc7239972c044719b95daec4004976fc9bd0a1678c06170d99a3d408` | `c2663b62fc7239972c044719b95daec4004976fc9bd0a1678c06170d99a3d408` | Wet-ground step suits Vellenwood's standing water and muddy paths. |
| Footstep/wood | `footstep-wood-01.ogg` | `sfx100v2_footstep_wood_01.ogg` from `sfx_100_v2.zip` | Copy + rename | 0.264813 | `52465eeb853a8fa3cd9f4e218dc0b28bdcb3bb52da72f5bece5d47cae2523a20` | `52465eeb853a8fa3cd9f4e218dc0b28bdcb3bb52da72f5bece5d47cae2523a20` | Wooden floor/bridge step for settlements and workshops. |
| Water loop | `water-loop.ogg` | `sfx100v2_loop_water_01.ogg` from `sfx_100_v2.zip` | Copy + rename | 6.367208 | `955a367cf87f150f7868e2ecf5745ef13cec2c78a29304eda27e74f1fea06c57` | `955a367cf87f150f7868e2ecf5745ef13cec2c78a29304eda27e74f1fea06c57` | Loopable natural water for fishing pools and shoreline ambience. |
| Thunder | `thunder.ogg` | `sfx100v2_thunder_01.ogg` from `sfx_100_v2.zip` | Copy + rename | 5.264750 | `8a4f1dee999546b363f989eff92174375eeae7c241dc9beaa0892fb131ef12a9` | `8a4f1dee999546b363f989eff92174375eeae7c241dc9beaa0892fb131ef12a9` | Natural weather cue; fits the grounded weather layer. |

## Rejected or intentionally not copied

The pack pages are CC0, but CC0 does not make every sound a good fit for this game. The following
entries were inspected and left in temporary extraction space only; none are present in the shipped
directory.

### `100-CC0-wood-metal-SFX.zip`

- `keys_01.ogg` through `keys_07.ogg`, `lock_open_01.ogg`: labelled key/lock sounds are outside
  this compact work/wood/metal cut and are not needed by the requested variants.
- `hammer_03.ogg`, `hammer_04.ogg`, `wood_hammer_01.ogg`, `wood_hammer_02.ogg`: additional
  hammer duplicates; two general hammer variants plus the purpose-labelled craft cue are enough.
- `metal_close_01.ogg`, `metal_falling_01.ogg`, `metal_falling_02.ogg`, `metal_open_01.ogg`,
  `metal_slam_01.ogg`, and `metal_sheet_02.ogg` through `metal_sheet_06.ogg`: redundant or
  semantically broad metal handling; one sheet cue and two metal-hit variants cover the need.
- `metal_spring_01.ogg`, `metal_spring_02.ogg`: springy mechanical sounds are not a natural
  medieval-fantasy interaction.
- `misc_01.ogg` through `misc_17.ogg`, and `tools_01.ogg` through `tools_12.ogg`: no reliable
  semantic label in the attachment, so they were not guessed into gameplay cues.
- `wood_breaking_02.ogg`, `wood_cracking_01.ogg` through `wood_cracking_04.ogg`,
  `wood_falling_02.ogg` through `wood_falling_06.ogg`, `wood_hit_01.ogg`, `wood_hit_02.ogg`,
  `wood_hit_05.ogg` through `wood_hit_09.ogg`, `wood_misc_01.ogg` through `wood_misc_09.ogg`,
  `wood_close_01.ogg`, `wood_close_02.ogg`, `wood_slam_01.ogg` through `wood_slam_04.ogg`, and
  `wood_squeak_01.ogg`, `wood_squeak_02.ogg`: valid wood recordings but redundant or less
  specific than the selected break/fall/hit set and the complete tree sequence.

### `sfx_100_v2.zip`

- `sfx100v2_stones_01.ogg` through `_03.ogg`: accepted as the three mining-impact variants.
- `sfx100v2_footstep_01.ogg`, `_02.ogg`, `sfx100v2_footstep_wet_01.ogg`, and
  `sfx100v2_footstep_wood_01.ogg`: accepted. Other wet/wood steps (`wet_02.ogg`, `wet_03.ogg`,
  `wood_02.ogg` through `wood_04.ogg`) are duplicate variants kept out for compactness.
- `sfx100v2_loop_water_01.ogg` and `sfx100v2_thunder_01.ogg`: accepted as the natural water and
  weather cues. `loop_water_02.ogg` and `loop_water_03.ogg` are duplicate loops and were rejected.
- `sfx100v2_air_01.ogg` through `_03.ogg`: ambiguous air recordings with no required cue family.
- `sfx100v2_door_01.ogg` through `_05.ogg`, `sfx100v2_lock_open_01.ogg`,
  `sfx100v2_metal_01.ogg` through `_06.ogg`, `sfx100v2_metal_hit_01.ogg`,
  `sfx100v2_metal_hit_02.ogg`, `sfx100v2_wood_01.ogg` through `_04.ogg`, and
  `sfx100v2_wood_hit_01.ogg` through `_03.ogg`: redundant with the clearer selected door,
  metal, and wood recordings.
- `sfx100v2_glass_01.ogg` through `_06.ogg`: glass is not part of this requested compact set.
- `sfx100v2_hit_01.ogg` through `_03.ogg`, `sfx100v2_items_01.ogg`, `sfx100v2_items_02.ogg`,
  `sfx100v2_misc_01.ogg` through `_37.ogg`, and `sfx100v2_switch_01.ogg`, `_02.ogg`: ambiguous
  generic/UI-like sounds without a dependable medieval interaction assignment.
- `sfx100v2_loop_ambient_01.ogg` through `_04.ogg`: generic, non-region-specific loops; region
  ambience belongs to a separate curated layer.
- `sfx100v2_loop_construction_site.ogg`, `sfx100v2_loop_highway.ogg`, and
  `sfx100v2_loop_machine_01.ogg` through `_04.ogg`: explicitly modern/off-tone construction,
  highway, or machine recordings, excluded by the audio amendment.

### Individual pages

- `blacksmithhammer.mp3` was downloaded and verified, then rejected because the page's WAV is a
  lossless duplicate and is the safer transcode source.
- The direct `rock_break.ogg`, `chop-tree-fall.ogg`, and `craft.ogg` attachments were accepted;
  only their destination names changed.

## Loot pickup cues, September 20, 2026

The loot pickup split (coins ring, every other item knocks) needed a purpose-recorded coin sound;
nothing in the shipped set was one. Two files were taken from the OpenGameArt page
[80 CC0 RPG SFX](https://opengameart.org/content/80-cc0-rpg-sfx) by **rubberduck**, published
2018-07-08, the same author as the already-shipped `100 CC0 metal and wood SFX` and `100 CC0 SFX #2`
packs. The page displays **License(s): CC0** and describes the pack as "80 sound effects for
fantasy / rpg games", including "21x item (coins, gem, misc, stone, wood)".

The page's **File(s)** row shows `80-CC0-RPG-SFX.zip`; the attachment carries the usual Drupal
collision suffix. [`80-CC0-RPG-SFX_0.zip`](https://opengameart.org/sites/default/files/80-CC0-RPG-SFX_0.zip)
returned HTTP 200, 1,845,114 bytes, SHA-256
`1c2f06ff4e8563b5b8b745b23cf213c1474142a69bb82bd8f5e10d9b3f7a7bbd`, and extracted 80 OGG entries.

Selection was made on measured shape rather than on the filenames alone. `item_coins_01.ogg` is
short (0.406 s), carries four separate transients, and peaks in the 3.5-12 kHz band, which is a
small handful of coins rather than a single struck bell. `misc_02.ogg` was taken for the item
knock because it is the inverse: one transient, peak energy at 20-150 Hz, and 25 dB down by
3.5 kHz. One file per cue is the whole selection: the pickup sounds are deliberately fixed rather
than rotated, so the other three coin files in the pack are not shipped. The rest of the pack is
out of scope; its creature and spell files are not shipped, because Corealm already has curated
voices and spell sounds.

| Cue | Shipped file | Original filename | Transformation | Duration (s) | Source SHA-256 | Shipped SHA-256 |
| --- | --- | --- | --- | ---: | --- | --- |
| `interaction.loot_coins` | `loot-coins-01.ogg` | `item_coins_01.ogg` | Copy + rename | 0.406333 | `4e701b281a4f88768beccbe87af4574d13ac5a4bc5cab6c522f0e79823d6e428` | `4e701b281a4f88768beccbe87af4574d13ac5a4bc5cab6c522f0e79823d6e428` |
| `interaction.loot_item` | `loot-thump-01.ogg` | `misc_02.ogg` | Copy + rename | 0.543354 | `5a17c4f8d8511fef5345ce5879b76795897c0f15a5b1898b62d719c488d1b546` | `5a17c4f8d8511fef5345ce5879b76795897c0f15a5b1898b62d719c488d1b546` |

Both are Ogg Vorbis, 48 kHz, stereo, copied bit-for-bit: source and shipped hashes are equal. The
knock plays at 0.87 of its recorded rate, which is a catalogue number rather than a file edit.

## Integrity summary

- Destination contains 26 files, all lowercase kebab-case `.ogg` names.
- `ffprobe` reports Vorbis for every destination file; there are no MP3/WAV files or source ZIPs
  in `game/public/audio/sfx/oga/`.
- The 25 already-Vorbis assets retain their source bytes and SHA-256 hashes. The sole conversion
  is the CC0 WAV `blacksmithhammer.wav` to `smithing-anvil.ogg` (Vorbis q5, 44.1 kHz mono).
- No code, manifest, or other directory was changed by the August 2026 curation. The September 20,
  2026 loot cues added two files here and their two cue entries in
  `game/content/data/audio/catalog.json`.
