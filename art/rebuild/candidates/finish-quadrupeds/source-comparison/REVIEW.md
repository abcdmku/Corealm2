# Complete animal source comparison

These are source-selection views, not accepted replacement species. The catalogue temporarily uses production species slots to exercise the real renderer. The Cat remains a domestic Cat base and the Rat remains the original Rat base.

All 14 PNGs in `test-results/quadruped-free-source-comparison/` were inspected. `gallery.json` records the exact candidate metadata, active clips, and NVIDIA RTX 5080 Direct3D11 renderer. Browser errors and missing assets were empty. The browser was closed and the GPU lease released after this batch.

| Source | Views | Selection | Work still required |
| --- | --- | --- | --- |
| Khronos Fox | Front, side, rear, gameplay, native Run and Walk | Recognizable coherent fox base; retain for source adaptation | Strong flat facets, thin pointed feet, little readable face or coat detail. Native gait floor and stance errors remain in the separate CPU audit. Combat, hit and death clips are absent. |
| JonasDichelle Cat, neutral material | Front, side, rear, gameplay | Coherent feline body suitable for Lynx adaptation | Domestic Cat head, long upright tail and body proportions need species adaptation. Neutral material has no finished coat. Frozen comparison is static, with no clips. |
| CDmir/TinyWorlds Rat | Front, side, rear, gameplay | Useful complete rodent source, explicitly a Rat | Long bare tail, exposed toes, open aggressive jaw and head remain Rat anatomy. Porcupine adaptation requires whole-body changes and quills. Frozen comparison has no exported clips. |

The Cat front and rear views retain a continuous chest, hips and tapering legs. The side view makes the domestic proportions and long tail clear. The Rat views show a coherent hunched rodent body with a textured head, feet and tail. Its mouth is open in this frozen source pose; this is not evidence of a finished attack action. Both remain readable at gameplay distance, but species identification has not been established for their target slots.

## Frozen candidate hashes

- Fox: `9ecbb6b0cac174d65c4b6c43d5e51e1ab5ae4615e4a9da4cccb5f48217557404`. Wrapper scale only. Actual clips in this run were Survey, Run and Walk.
- Neutral Cat: `d69e3d8617deb102db923b432b976b751e8beddc8b92616e9467e77d41267f6f`. Original body geometry, neutral material and scale wrapper. No clips.
- Rat: `ae3cb18c2590b34b5bacca459df0ac1318a532f171eccc5276aca7252c199ddb`. Original visible meshes, translated source materials and normalization wrapper. No clips.

Original licenses, creator attribution, acquired bytes and source hashes remain in each source folder and the comparison catalogue. No public asset was changed.

## Conversion gate

The historical Cat source has the same body geometry as the neutral preview and retains real Walk and Run actions. It uses up to 13 bone influences per vertex. Naive reduction to four produced up to 86.18 mm of deformation error at the preview scale across 50 sampled native poses. That conversion is rejected. The full-influence archival GLB remains preserved. Offline weight fitting must report held-out deformation errors before a production moving preview is valid.

The original Rat Blend retains 14 native actions. Its export also requires a measured influence audit and true action export before motion claims. Source action names must not be presented as newly authored missing gameplay roles.

Root approved continued Cat and Rat conversion and species adaptation after reviewing the three side views. This approval selects source bases; it does not approve art, locomotion, combat or promotion.

An independent follow-up reviewer inspected all 14 views and agreed these are useful whole-body bases. This was not a fresh-context acceptance gate. The reviewer identified a stale Fox `reviewOnly.staticPose` field in the frozen metadata, which incorrectly described a bind pose. Actual per-view motion records show Survey, Run and Walk playback. The original frozen report remains unchanged; the source helper and future source catalogues now describe the observed Survey fallback correctly.
