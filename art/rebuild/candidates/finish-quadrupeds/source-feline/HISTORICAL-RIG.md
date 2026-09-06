# Original rig recovered from public git history

A targeted search did not find an accessible original `.blend`, but it recovered the rigged FBX export in Ylikuutio's initial Cat commit. This is the same JonasDichelle model under the same preserved CC-BY-3.0 attribution. The later 2020 re-export stripped out the rig; the 2017 file still includes it.

- Public commit: `864ea1982524367ed416803db425f1895e4a0717`
- Download: https://raw.githubusercontent.com/nrz/ylikuutio/864ea1982524367ed416803db425f1895e4a0717/res/objects/www.blendswap.com/86110_rigged_and_animated_cat/cat.fbx
- Staged file: `cat.historical-2017.original.fbx`
- Bytes: 7,550,684
- SHA-256: `b12adb6b0a0d061b1909a4095d3f75ad1f919d1eb01b10ecbf0edfd5f6311488`
- Creator: JonasDichelle. License: CC-BY-3.0, https://creativecommons.org/licenses/by/3.0/

The original commit message explicitly identifies JonasDichelle, CC-BY, the original BlendSwap link and an export from cat.blend using Blender 2.78. The already staged original license and repository README confirm the same attribution. No login or protected download endpoint was bypassed.

## Verified contents

Blender 4.5.11 CPU import confirms one Armature with 120 bones and the complete Cat mesh with 22,650 vertices and 22,648 polygons. Native actions include Walk, frames 1–28, and run, frames 1–15. At the imported 24 fps these span 1.125 and 0.583 seconds. Additional one-frame camera actions are scene artifacts, not idle or combat animation.

The scene also contains two dense sphere meshes, each 31,746 vertices, with eye-related material slots, an empty eye object, a large Plane and camera. These need an explicit actor-isolation review. Do not export the Plane as part of the creature. Do not classify the dense sphere geometry as disposable until eye attachment and appearance are checked. Full scene bounds include these non-animal objects and must not be used for creature normalization.

There are no image textures in the imported FBX. The rig and source motion are available; the original dynamic hair and rendered coat still are not recovered. The body is posed and transformed inside the scene, so export must preserve the armature relationship while removing scene placement.

Three's CPU FBX loader reported 85 joints on each skinned mesh and warned that vertices exceed four weights. Blender's complete 120-bone armature is therefore the better source for an export audit. Any weight reduction must be measured; this discovery is not an animation or deformation acceptance.

`historical-provenance.json`, `historical-inspection.json` and `blender-historical-inspection.json` preserve the acquisition and both CPU inspections. No GLB was exported from this historical source. The existing source-only and neutral preview GLBs and catalogues remain frozen and unchanged.

## Search scope

Searches covered the exact creator name with `cat.blend`, the original title, legacy BlendSwap ID 86110, current ID 18519 and GitHub redistribution terms. The creator's public GitHub repositories contained MeshifyHair, Excalidraw and MooCn, with no Cat release found. Ylikuutio's cat.blend path has no commit history. Its Cat directory has two commits: the original 2017 import and the 2020 FBX re-export. Inspecting the earlier public tree revealed the larger rigged file acquired here. No unrelated feline search was added in this follow-up.

## Subsequent isolated export and renderer limitation

The root authorized further CPU isolation. `historical-body-comparison.json` confirms that all 22,650 Cat vertex positions and every polygon index are exactly identical between the historical rigged FBX and the current static FBX. The already frozen neutral static preview is therefore a valid comparison of the same body geometry, though it excludes the historical eye meshes and motion.

The two dense Sphere objects are armature-bound eye meshes. Their source positions form a left/right pair at the head; each is about 0.34 Blender units across before display scaling and uses the source's PBR Dielectric material. Each contributes 63,488 triangles in the isolated export, substantially more than the body's 45,296. They are retained intact in the archival native export. Plane, camera and the empty eye object are excluded.

`Cat.historical-native.glb` now preserves the isolated Cat, both eye meshes, the 120-joint rig and native Run/Walk. It retains all source skin influences using JOINTS/WEIGHTS_0 through _3 on the body. The original native Walk is mapped to Walk and native run to Run; timestamps are shifted together to zero without changing motion outputs. Durations are 1.125 and 0.5833 seconds. Camera actions are excluded. Idle, combat reactions and Death remain absent.

The current four-weight rendering contract prevents a faithful moving production preview of this file. The Cat body has up to 13 influences per vertex. Keeping only the largest four discards up to 43.24% of a vertex's weight and 2.93% on average. A Blender CPU comparison of full weighting versus normalized top four at 25 samples per native clip measured a maximum body displacement error of 86.18 mm at 0.1 display scale. The two eye meshes already use at most four influences.

`historical-four-weight-error.json` retains every sampled error. No reduced-weight mesh was saved. Root must choose a measured weight reduction or an extended skinning implementation before this can become a faithful moving candidate. No misleading four-weight catalogue was emitted. The existing static neutral preview and its catalogue remain unchanged and suitable for the pending anatomy review.

The archival native GLB is 7,301,392 bytes, SHA-256 `367c69f977f0544eb075d458a4f23ecca6095e0328a09afdc5c47e4ca7e97547`. Exact geometry attributes and native clips are in `historical-export-proof.json`. `LICENSE.historical.original.html` is pinned to the original 2017 commit and is byte-identical to the already preserved license. All work here used CPU import/evaluation/export, with no GPU, new rig or Lynx shape adaptation.
