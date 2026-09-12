# Small Fey NPC candidates

The four models retain the user's downloaded Paragon Fey skins: Opaline,
Autumn Keeper, Nightshade and Frostbloom. Each GLB contains the original body,
face, hair, clothing and wing geometry. No modular human outfit is added.

Sources are read from the isolated exports under
`.asset-cache/fairy-terraces/fey/`. The existing `export-fey.ps1` and
`export_fey.py` produce those exports from
`C:/Users/Borg/Documents/Unreal Projects/MyProject/Content/ParagonFey` through
an isolated Unreal project. They do not save changes into the downloaded pack.
The exact Unreal asset paths and input SHA-256 values appear in the generated
`asset-audit.json`.

The pack metadata identifies Epic Games and the
[official Fey listing](https://www.fab.com/listings/9afbcde6-4a14-4018-95c3-2f3a2e1da858).
On September 12, 2026, the user specified Fab Standard terms for these downloaded
assets and instructed the project to proceed under those terms. Candidate pack
metadata therefore records `Fab Standard License`. The listing retains legacy
text describing use in Unreal Engine projects; that description is distinct
from the acquisition terms supplied by the user for this download.

## Rebuild and inspect

From the repository root:

```powershell
node tools/fairy-terraces/fey-inspect.mjs
node tools/fairy-terraces/fey-build.mjs
node tools/fairy-terraces/fey-audit.mjs
```

Outputs stay in `test-results/fairy-terraces-assets/fey/`:

- `candidates.json` supplies the production asset-candidate browser installer.
- `npc_fey_*.glb` contains each candidate.
- `manifest-assets.json` contains candidate manifest entries and file hashes.
- `asset-audit.json` records source provenance, geometry, textures and animation.
- `three-motion-audit.json` records actual Three.js skinned vertex motion and bounds.
- `source-audit.json` is the larger optional source inventory.

The build never changes the public manifest or final-world content. The root
loads `candidates.json` into the real Vite combat lab, accepts the NPCs through
browser interaction and screenshots, and promotes them in a later integration.

## Size, animation and source preservation

A single parent transform scales each complete mesh and skeleton to a 0.78 m
bind-pose height. The native idle poses the drawn body at 0.872–0.891 m tall,
with its feet hovering 0.118–0.156 m above the ground. The original idle supplies
the hover and wing movement; no procedural imitation is added.

`Idle_Loop` comes from the source `/Animations/Idle` take. It retains all 519
translation, rotation and scale channels for 173 bones and lasts 9.9667 seconds.
Autumn Keeper has 184 bones. Its eleven extra scarf joints retain their source
bind pose, while 22 face joints receive the source animation's local motion
delta relative to Autumn Keeper's different facial bind transforms. Other skins
have identical bind transforms to the idle source.

Every source triangle and skin joint survives. The models retain 41,821
triangles each, or 42,525 for Autumn Keeper. The ordinary glTF pipeline removes
unused data, welds duplicate vertices and resamples redundant keyframes. Opaque
textures become JPEG, alpha textures remain PNG, and every texture has a 512 px
ceiling. Source 4096 px normal maps caused most of the original 99–110 MB size.
The staged files are 4.53–4.92 MiB each. Geometry is not quantized because the
production asset pipeline avoids normalized skinned positions.

The export uses Unreal's glTF material bake. Runtime Unreal shader effects,
including its wing blur material, do not become animated shader graphs in glTF.
The source wing-frame geometry, material maps and skeletal motion remain.

## Root integration

`game/src/content/fairyNpcs.ts` contains four pure NPC candidates, their authored
village stands and eight dialogue nodes. The root owns catalogue registration,
standing-position integration,
dialogue registration, production appearance resolution and the public manifest.

Return no modular outfit parts for `npc_fey_*` asset IDs. The production renderer
already supports complete skinned NPC bodies with their own idle clips when
`partAssetIds` is empty. Preserve the small GLB's native scale and use a label
height appropriate to a roughly 1.05 m maximum animated top, including hover.

The focused Node audit checks real Three.js deformation, finite coordinates and
body size at five times. It is not gameplay acceptance. The root must still
inspect all four skins in the production lab, confirm visible idle motion and
talk interaction, then inspect their final settlement placement through normal
gameplay camera controls.
