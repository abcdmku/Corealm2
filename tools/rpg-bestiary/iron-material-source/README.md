# Iron material-only presets

Run from the repository root. Round1 defaults to an in-memory regression check and writes nothing:

```sh
node tools/rpg-bestiary/iron-material-source/rewrite.mjs --preset round1
node tools/rpg-bestiary/iron-material-source/rewrite.mjs --preset round2 --out art/rebuild/candidates/finish-bestiary/iron-material-round2
```

`--out` must name a new directory inside the worktree. Existing output directories are refused, including the frozen round1 directory. Round1 can optionally write to a new temporary directory outside the candidate tree. Within the candidate tree, only the round2 output path is allowed. The delivered round2 directory already exists, so the generation command will refuse to overwrite it.

Round1 retains its exact texture encoding, material values and GLB JSON ordering. Every round1 run asserts candidate SHA-256 `e853b524b0175ac78675fd7d6b1123fa183390c3914705a117bb218538204910`. It uses cool steel with grain amplitude 7/255, clean metalness 0.97, roughness 0.43 and normal strength 0.22.

Round2 maps the source luminance to dark neutral grey-blue cast iron. Its final mean albedo is calibrated to [88, 92, 97], with grain amplitude 12/255 before patina blending. Source luminance below 0.739 carries oxide, fading to full oxide over 0.16 luminance units. This selects 17.18% of the fixed source map. Raising the luminance cutoff and counting any positive oxide lowers the darkness required for oxidation compared with round1. The recorded pixel definition is explicit because round1 counts only oxide above 0.12.

The rust target is [104, 72, 52], mixed up to 0.55. Clean iron has metalness 0.88 and roughness 0.58 plus up to 0.035 grain response. Oxide blends these toward metalness 0.35 and roughness 0.85. The packed PNG uses G for roughness and B for metalness; reported ranges describe authored values before 8-bit rounding. The normal PNG stays byte-identical with material strength 0.45. Inner-body factor is [0.20, 0.22, 0.24, 1]. Eyes stay dark, with no emission anywhere.

Both presets assert the source SHA before writing, preserve the entire BIN chunk and every JSON field outside images, materials and textures, and assert material names and count. Accessors, buffer views, buffers, meshes, nodes, skins, animations and scenes receive individual identity checks and hashes. Samplers are included in the non-material assertion. The source GLB is checked again after writing. Textures remain external content-addressed PNGs with dimensions at most 2048.

The catalog retains source provenance and records the material revision, model hash and size, shared textures and new bindings. Acceptance remains false. `material-regression.json` records integrity checks; `material-interpretation.json` records parameters, statistics and status `candidate-needs-production-material-review`.

Round2 also includes `albedo-compare.png`, with frozen round1 albedo on the left and round2 on the right, each 512 pixels wide. Both source maps are already 512 wide. Sharp creates this CPU-only review aid; it is absent from served texture bindings and sharedTextures.

Baseline SHA-256: `f84d7e0a237d1b4b78891f1b1802004b4acc67d64a93fce1b53d477acdf8ee2a`.

Preserved BIN SHA-256: `342d85a2d456c2bc00e4efec167f373f201e25c84ece1980c5fad61533f5c17a`.

Round2 SHA-256: `223e61a6675b5e93efe919068ef3ca7e58f6048b1ecf001e661340eec6be5ff8`.

This is project-authored PBR data using the existing Quaternius source grain. No geometry, rig, animation or runtime integration changes are included. Browser, Vite, build and whole-game checks are deferred by the explicit CPU-only task instruction. The production lab must review the material before acceptance.
