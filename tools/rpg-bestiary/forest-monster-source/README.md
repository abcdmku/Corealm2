# Forest Monster source conversion

`forest-monster.mjs` exports synchronous `buildForestMonster(id = 'forest_monster')` returning `{object, clips, meta}`.

This preserves CDmir's complete Forest Monster body and Tree mesh, original UVs and 76-bone rig. There are no anatomical grafts or new model parts. Blender 4.5.11 exports evaluated native constraints on the CPU. The two meshes contain 6,582 triangles after source triangulation. Source units are converted uniformly at 0.1 meters per unit, giving a bind height of about 4.12 meters.

The source is the current [OpenGameArt Forest Monster archive](https://opengameart.org/content/forest-monster), SHA256 `3378edfe2441d1cee93feeeb6e045b9ff0c700d85b398dfa6c29c83f7e696a5e`. The included `Licenses.txt` declares CC0. The author confirmed on September 3, 2015 that the old restricted tree texture was replaced and the current complete asset is CC0. Only textures extracted from that current archive are used here.

## Animations

| Output | Source |
| --- | --- |
| Idle | Native Idle, frames 0–190 at 24 fps |
| Walk | Native Walk, frames 0–40 |
| Run | Native Walk at 1.45 times its original tempo |
| Attack | Native Attack, frames 0–30; author marks strike at 10–15 |
| Hit | Native Melee_Hold compressed to 0.6 seconds, with a small spine recoil |
| HitLeft / HitRight | Same derivative with a directional spine turn |
| Death | Native Dying, frames 0–35 |

Run and the hit clips are explicit derivatives, not claims of native authored takes. Whole-mesh ground alignment includes the tree and all body geometry. All eight clips were sampled at 33 verification points; lowest resulting floor was -0.0014 meters.

The glTF production path supports four bone weights per vertex. Blender retained the strongest four and normalized them where the source had more. Comparing CPU bounds with Blender's original evaluated source poses gave maximum deviations of approximately 0.0000011 meters for Idle, 0.0065 meters for Walk, 0.0025 meters for Attack and 0.0384 meters for the last Death frame. The original model and tree remain intact.

## Materials and export

Materials have no live texture maps set, for compatibility with the CPU exporter. `meta.textureBindings` records original current-archive diffuse and normal paths with `flipY:false`. It also retains `aoPath` and `specularPath`. The parent's current exporter embeds only diffuse and normal channels; the extra paths remain available for extending it. All eight source PNGs are retained in `derived/`, including the two original skin variations.

`export_blend.py` rebuilds the five native GLBs and copies the source PNGs when run by the verified portable Blender runtime with the original `forest-monster-final.blend` open. `inspect_blend.py` records the original scene and `validate_source_poses.py` measures original evaluated poses without rendering.

This candidate has CPU conversion evidence only. Production browser visuals, normal-map response, gait, attack timing and death appearance still need parent acceptance. No shared catalog, manifest or production file was edited.
