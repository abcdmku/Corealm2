# Furrow Slink — P1.0 generation request

This folder contains a ready-to-submit image-to-model plan. It does **not** contain a generated model or a fabricated candidate GLB.

The approved image is `assets/art/tripo/references/field-low-furrow-slink-r2.png` (SHA-256 `2a6ae715755f3cd01b7aaf20f6f621a6a579326ae3e3ded9b6c09f1a30b6fc7b`). It shows a small ochre field burrower with two forelimbs, a continuous hindlimb-free trunk and tapered tail, a low bristle ridge, and an intact, calm face. Astra-low approved this image.

The local T1 exports do not match this design: Vetchrunner is a four-legged furred quadruped, while Ryecrest is a groundbird. Their recorded source geometry and skinning cannot produce the approved silhouette without changing the mesh. The previous `furrow-slink-p1-trial` ledger also confirms that Tripo upload and model generation were never submitted. Therefore this asset needs a fresh P1.0 generation in Tripo.

Use the prompt, image hash, geometry limits, 2K PBR map targets, UV and skeleton requirements in `tripo-plan.json`. Generate one Smart Mesh triangle model with a 4,000-triangle target, preserve the generated surface, create a valid Smart UV atlas, texture it with layered Fallowmarch colors, and export a skinned GLB. Add the six in-place Unity-compatible clips from the plan after the base mesh and skin pass review.

The intended role is neutral T1 field wildlife: it turns soil while foraging for grubs and seed, flees first, and uses a small defensive snap when cornered. The proposed drops are starter Furrowhide and an occasional Amber Scale.

## Current gates

- Approved source image: passed.
- Matching local source GLB: none found; nearby starter exports are different species.
- Tripo model generation: pending; no Tripo model ID or generation credits recorded.
- Geometry, UV, PBR, rig, motion and game import: pending.
