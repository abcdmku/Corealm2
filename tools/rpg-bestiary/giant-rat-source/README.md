# Giant Rat source adapter and bounded contact candidate

Current status: [contact-round2.md](contact-round2.md). Default construction applies the three approved distal toe rotations. Front Walk, Run and Death head contact remain HOLD. Use `{repair:false}` as the second factory argument for the unchanged native-motion baseline. There is no blanket floor lift.

Use `await buildGiantRat(id)` from `giant-rat.mjs`. The result is `{object, clips, meta}`. The adapter calls the released `loadNativeRatSource()` API and pins native GLB SHA-256 `ed0f9a8df62321d9aebcde6c9384a97464f67d9cdabf7f21b1ec2e7e6c3c3047`.

All 138 nodes and 133 joints are retained, including all 100 corrective joints and their animation channels. The adapter preserves source geometry, UVs, skin weights, inverse binds, material factors and packed body/head maps. No geometry or color edits are made. Source textures are copied without image transformations and use `flipY: false`.

The wrapper uses the upstream normalized preview scale `0.240830591906` and fixed idle grounding. The model has 5,930 triangles, 4,440 expanded vertices and an idle height of 0.34 m at this scale. Native node animation values remain unchanged in the baseline. The bounded candidate changes only the three toe rotation channels documented in the round-2 report.

| Runtime clip | Native clip |
| --- | --- |
| Idle | Idle.001 |
| Walk | Walk |
| Run | Run |
| Attack | Attack.000 |
| Hit | Hit |
| HitLeft | Hit |
| HitRight | Hit |
| Death | Die |

Side hit aliases are the same original reaction, with no invented directional animation. All 13 released native clip names are recorded in metadata; the copied source GLB retains all clips. The rejected upstream Idle.000 is not reintroduced.

`meta.upstream` preserves the complete upstream report, provenance, source hash, preview scale and acceptance flag. The upstream final-byte random audit is separate from this adapter's checks.

Run `node tools/rpg-bestiary/giant-rat-source/audit.mjs` for baseline adapter parity. It independently evaluates the upstream NodeIO animation and skinning against the constructed Three.js object at five phases of every runtime alias, removing only wrapper transforms. The maximum normalized error is 0.000000041 m. Native toe penetration is preserved in that baseline. Run `audit-contact-bytes.mjs` for the separate final-byte correction audit. Neither is browser acceptance or gait proof.

Source: [Evil Giant Rat](https://opengameart.org/content/evil-giant-rat), CDmir and TinyWorlds, [CC0](https://creativecommons.org/publicdomain/zero/1.0/). Original `.blend` SHA-256 is `52530520c71787da6c9ced7130cca02ddaf2b0af567bc38221b746d2297b5be2`. Source links, author, license and exact upstream data are included in returned provenance.

No production registration or browser session is performed by this adapter. Native attack contact remains provisional pending production review.
