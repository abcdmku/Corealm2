# Staged weaver variants

This review package reuses the accepted corrected six-legged Vaultweaver rig, mesh, original normal map, roughness map, and six clips. It does not turn the creature into an eight-legged spider. Three separate imagegen edits of the source UV atlas give these identities distinct layered surfaces:

| Production ID | Look | GLB raw height | Existing species scale | Expected in-game height |
| --- | --- | ---: | ---: | ---: |
| `creature_moonweave_spider` | Moon-silver shell, jade detail, slate joints | 0.520 m | 0.82 | 0.427 m |
| `creature_amethyst_spider` | Basalt chitin, violet mineral web veins | 0.520 m | 0.72 | 0.374 m |
| `creature_dewglass_weaver` | Opal-blue petal shell, lilac veins, dew flecks | 0.934 m | 0.709 | 0.662 m |

Moonweaver and Amethyst Weaver retain their present raw heights. Dewglass is uniformly enlarged 1.9× to give the level-40 fairy weaver more presence. The existing world species scales then produce the expected in-game heights shown above. Each GLB has its scene uniformly scaled; its material maps remain embedded and its catalog bounds reflect that scale. The Dewglass finish looks translucent through its painted albedo; it does not claim physical transparency.

Regenerate from the repository root with `node assets/art/tripo/imports/creatures/audit-weaver-variants/build-variants.mjs`. The builder pins the corrected source SHA, embeds each 2K edited albedo, and round-trip checks joint order, six clips, 2K base texture and 17 weighted-mesh floor samples per clip. The serialized minimum floor is positive in all clips. The per-ID catalogs preserve generated-image and Tripo provenance. `lab-catalog.json` combines the three production ID mappings; all lab acceptance flags remain false for root review.

Image generation retains a visually recognizable UV island arrangement but cannot guarantee pixel-locked boundaries. Inspect the mapped creature in the lab before promotion. Walk and Run ground speeds are uncalibrated, so old production implied gait speeds must not be carried into any replacement manifest entries. No production files were edited.
