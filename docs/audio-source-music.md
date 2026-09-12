# Corealm music source ledger

This ledger covers the shipped regional music. The original supplied source library is
`C:\Users\Borg\Music\corealm`; the browser-served destination is
`game/public/audio/music/`.

## Shipped mappings

The owner's September 12, 2026 attachments assign Fairy to T30 Gloamgarden, Fairy Mire to T60
Faeholme, Distant Plains to T40 Crownward and Castle to both Crownward castles and their approaches.
This replaces the earlier Fallowmarch two-track pool. Fallowmarch now uses Starter Plains alone.

| Region mapping | Supplied source | Shipped destination | Size (bytes) | Duration (s) | SHA-256 (source = destination) |
| --- | --- | --- | ---: | ---: | --- |
| Fallowmarch | `C:\Users\Borg\Music\corealm\Starter Plains.mp3` | `game/public/audio/music/starter-plains.mp3` | 2,943,873 | 124.373500 | `4ab0b2615e306d3af639cb7b412f90209aa769d3ddec4a438abc386f9152c251` |
| Crownward, T40 | `C:\Users\Borg\Music\corealm\Distant Plains.mp3`, also attached September 12 | `game/public/audio/music/distant-plains.mp3` | 3,473,739 | 143.733500 | `77fd9289f3c1edd63d78a4199e0192333f8b9cb796e738d4abd98491fad78f16` |
| Vellenwood | `C:\Users\Borg\Music\corealm\Deep Woodland.mp3` | `game/public/audio/music/deep-woodland.mp3` | 2,913,502 | 124.613500 | `a592c847e36a94dec8e2752d0ac076be0ee8f428b131dd224e1dab8231f38789` |
| Karrowmoor | `C:\Users\Borg\Music\corealm\Stone city.mp3` | `game/public/audio/music/stone-city.mp3` | 2,440,565 | 107.493500 | `21cfd425eed058030b9731a3ede916c4ccd46e825306f5890f84bf7fd69c17f2` |

Durations were read with `ffprobe` from the supplied MP3s. Every destination hash matches its
source hash, so the files were copied as supplied without transcoding or other audio changes. The
destination names are lowercase kebab case.

## Source and rights information

The September 12 attachments are copied byte for byte. Distant Plains matches the existing
`77fd9289f3c1edd63d78a4199e0192333f8b9cb796e738d4abd98491fad78f16` asset, so it is reused.

| Mapping | Attachment | Destination under `game/public/audio/music/` | Bytes | Duration, seconds | SHA-256 |
| --- | --- | --- | ---: | ---: | --- |
| Gloamgarden, T30 | Fairy.mp3 | fairy.mp3 | 2,802,091 | 118.333500 | `6672dee0e2bdf40c71e4a645c96b02020a4a8e6675ce9e105e8821d308ef9381` |
| Faeholme, T60 | Fairy Mire.mp3 | fairy-mire.mp3 | 3,112,607 | 127.333500 | `fd7c8a89a33bcd62897ef4e81115f726e966d003e43ada202c9fbb9ee64303b0` |
| Crownward castles | Castle.mp3 | castle.mp3 | 4,220,049 | 183.160000 | `ecfd97857c2fa99a8c6100546b2daf0da236daf7405384ee77bc72b52b2441e9` |

All three attachments name `phreesplox` as artist. Fairy retains the embedded title `Swamp`,
Fairy Mire retains `Mire Swamp`, and Castle retains `Castle`. The owner assigned the attachment
names and destinations above; the old embedded titles do not change those assignments.
Their Suno creation IDs are respectively `bb4cb6d7-7508-4f84-b634-e9f29ff285e9`,
`73a7eb8a-6016-4651-a3ce-6b080b580108`, and `2bfd6f9f-3df9-4ee5-82ba-1529b49ed34a`.
FFmpeg ebur128 measured -14.0, -12.7 and -16.7 LUFS. Catalogue gains of 0.224, 0.193 and 0.305
place them near the existing -27 LUFS music level before the player's music volume.
The files retain their original beginnings, endings and full-length repeats.

The four original files contain these embedded tags:

| Track | Embedded title | Embedded artist | Embedded comment |
| --- | --- | --- | --- |
| `starter-plains.mp3` | `Starter Plains` | `phreesplox` | `made with suno; created=2026-08-28T02:54:02Z; id=f7f5731a-7350-455e-aa45-1b5070573b0e` |
| `distant-plains.mp3` | `Distant Plains` | `phreesplox` | `made with suno; created=2026-08-28T02:25:52Z; id=4019751a-22f8-455f-9843-933e7b7fb62f` |
| `deep-woodland.mp3` | `Deep Woodland` | `phreesplox` | `made with suno; created=2026-08-28T02:54:01Z; id=56e18f3d-0274-4aac-864f-550c271b6db0` |
| `stone-city.mp3` | `Stone city` | `phreesplox` | `made with suno; created=2026-06-08T02:26:42Z; id=302a7517-e41e-43ee-9c50-32129adcf3ca` |

The repository owner supplied these files from their local library and explicitly directed this
run to include them in Corealm, which is the project authorization for this integration. No
separate ownership statement, copyright holder, license name, license URL, or reusable permission
record was present in the source directory or embedded tags. The only attribution information
discoverable here is the embedded artist value `phreesplox` and the comments above. This ledger
therefore does not claim that the tracks are CC0, royalty-free, or available for reuse outside
Corealm; anyone distributing the project still needs to retain the owner's applicable rights
record separately.

## Unassigned source names

The original library also lists `Desert.mp3`, `Jungle.mp3`, `Goblin Village.mp3`, `Mire Swamp.mp3`,
and `Swamp.mp3`. None is registered under those filenames. The September 12 Fairy attachments
retain swamp titles in their metadata and are assigned to the fairy regions as described above.
There is no supplied Gravelmaw-matching track, so Gravelmaw intentionally has no music asset.
