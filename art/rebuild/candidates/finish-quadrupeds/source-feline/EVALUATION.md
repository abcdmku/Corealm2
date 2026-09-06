# Complete feline sources acquired

The best acquired source is JonasDichelle's complete Cat mesh, redistributed by Ylikuutio with the original CC-BY-3.0 license and explicit attribution. It is a plausible anatomy starting point for a Lynx. The acquired FBX is static: the redistributor did not preserve the original Blender rig or animations. It therefore requires a new rig and genuine motion authoring, even though the creator's original listing advertises Walk and Run.

## Primary source

- Creator: JonasDichelle, https://blendswap.com/blend/18519
- Original license: CC-BY-3.0, https://creativecommons.org/licenses/by/3.0/
- Public redistribution: https://github.com/nrz/ylikuutio
- Pinned commit: `ea7e8abeb1a1263082f163c8586e1d8c81f74674`
- Repository path: `res/objects/www.blendswap.com/86110_rigged_and_animated_cat/cat.fbx`
- Local file: `cat.original.fbx`, unchanged, 1,373,356 bytes.
- SHA-256: `4e156a3b81638d07a78278889d2184c9a106fd81c2de84bd212c1bd12ea03428`

The saved original license identifies legacy BlendSwap entry 86110. The current creator page is 18519; Ylikuutio's README explicitly connects that current page, author, license and FBX export. This is a public, attributed redistribution, not an attempt to obtain a gated BlendSwap download.

I inspected both `creator-preview.original.jpg` and `mirror-preview.original.png` before any conversion. The creator preview shows a full quadrupedal cat walking with a connected rib cage, shoulder, long thigh, tapered wrists and recognizable paws. The mirror screenshot shows the complete static mesh without rendered particle fur. The silhouette remains feline, though its upright long tail and domestic-cat proportions need revision for Lynx.

CPU FBX parsing found one complete Cat mesh, 45,290 triangles, 135,870 expanded source vertices, three materials and no armature, skin weights or animation clips. The loader requested no texture images. The creator's dynamic hair cannot be assumed to exist as working realtime fur in this export. Raw node-transformed bounds span 284.896 by 928.074 by 920.995 FBX loader units; the upright tail affects height, so this is not a safe target-height normalization basis yet.

## Lynx adaptation plan

First inspect this unchanged complete mesh in neutral production lighting from front, side and rear. If its anatomy holds up without the creator's particle hair, establish ground plane, forward axis and shoulder height from the actual vertices. Scale the whole mesh uniformly from shoulder height, then adjust the full body's proportions together: higher hindquarters, longer legs, larger padded paws, a short tail, small tufted ears and a compact cheek ruff. Keep the connected head, neck and torso; do not graft its head onto the rejected generated body.

The long domestic tail must be shortened and closed cleanly while retaining a plausible sacral attachment. Sculpt paws with broad contact pads and subtle toe divisions. Repaint the entire coat as a coherent Lynx pattern, including head and limbs, and preserve all required CC-BY credits and a modification notice. Add a complete quadrupedal rig with jaw and ear controls if the geometry supports them. Author Idle, Walk, Run, Attack, Hit, directional hits and Death with actual contact-aware motion. There are no native clips in this acquired file to rename or reuse.

This is substantial new rigging and art work. The source is worth a whole-body preview, not an accepted replacement or an assurance that the work is smaller than repairing the current candidate.

## Secondary acquired source

Drummyfish's Simple Cat is available under CC0-1.0 at https://opengameart.org/content/simple-cat. `simple-cat.original.zip` is unchanged, 497,695 bytes, SHA-256 `266e1b999c0507afe54dd10be9720352cb1fec76298b79f442f47f0435e58e1a`. The separately supplied `simple-cat-free.original.png` is the creator's expressly original texture, avoiding reliance on the archive's third-party photo texture.

Its full-body preview was inspected before conversion. The cat is recognizable, but the straight box torso, pointed feet and abrupt bent legs would require broad anatomical remodeling to reach the current Lynx bar. The creator describes two shape-key walk poses, not a skeletal motion set. It is retained as an accessible licensed fallback and not selected for integration. The ZIP has not been extracted or converted.

## Other sources checked

The public BlendSwap pages for Squibblejack's Cat (23047, CC0), LazyGraph's Tiger/Lion base (27158, CC0) and JonasDichelle's original Cat all require sign-in to download. No authentication bypass was attempted. Search also returned humanoid cat characters and aircraft named Lynx; these were excluded. No exact Lynx or bobcat with both an accessible complete download and verified license was acquired in this pass.

`provenance.json` preserves exact immutable asset URLs, current creator-page URLs, authors, licenses, file lengths and hashes. `source-inspection.json` records the actual acquired FBX contents. Re-run integrity verification with `node tools/creature-expansion/mammals/source-feline.mjs`; add `--inspect` for the CPU FBX report. No GPU, conversion, central asset registration or production promotion occurred.

## Subsequent CPU source preview export

After the source review, a separately authorized CPU conversion produced `Cat.source-import.glb` and `Cat.preview.glb`. The original FBX remains unchanged. `preview-catalogue.json` is ready for request interception under `creature_duskoak_lynx`; it explicitly registers zero animations. The gallery review must skip Run and all action controls.

Blender 4.5.11 imported the complete FBX with automatic unit conversion. `inspect_export.py` exports its UVMap, normals, all-white Col attribute and original assigned material, without decimation, anatomy edits, rigging or animation. The GLB contains 45,296 triangles; Three's earlier FBX parse produced 45,290 because of importer triangulation differences. The original 22,648 polygon surface is retained. The unused hair and Material.002 slots have no polygons and therefore produce no GLB primitive.

Neither Blender nor Three found embedded or referenced images. The pinned repository's cat folder contains only the FBX and license. The orange fur seen in the redistributor screenshot is a separately credited generic texture in its project, not an embedded original Cat texture. No substitute texture was applied.

The imported material has base colour 0.8 grey, roughness 0.553 and metallic 1. These values were preserved, so this preview may appear metallic. A later neutral nonmetal inspection material would need to be explicitly recorded as a separate presentation variant; it would not recover the creator's original rendered fur.

The preview adds uniform 0.1 scale after Blender's unit conversion, producing bounds 0.285 by 0.928 by 0.921 metres. An additional 0.01 scale would make it only 9.3 cm tall. The preview scale is a display choice for the upright-tail source pose, not a species adaptation. All accessor values are unchanged by this wrapper. No added rotation, crop, graft or material adjustment was performed.

To regenerate, run the provided Blender executable with `--background --factory-startup --disable-autoexec --python art/rebuild/candidates/finish-quadrupeds/source-feline/inspect_export.py -- --export`, then `node tools/creature-expansion/mammals/source-feline.mjs --stage-catalogue`. `blender-source-inspection.json` and `preview-proof.json` record the measured source and export details. No GPU or rendering was used, and neither GLB has been promoted.

## Neutral inspection material variant

`neutral-preview-catalogue.json` now serves `Cat.neutral-preview.glb` with grey 0.8, metallic 0 and roughness 0.85 for anatomical comparison. This is an explicitly authorized inspection material, not a final coat. The original imported material GLB and catalogue remain unchanged. Re-reading both variants confirms the same complete accessor payload hash, `9ab9f0ad0b83fa10518d55b038268f425c435eec267fe02bc00c5863c1279e48`. No geometry, UVs, normals, scale, pose or animation changed. Both variants remain static with zero clips.

Regenerate this variant with `node tools/creature-expansion/mammals/source-feline.mjs --neutral-preview`. Exact source/variant hashes and material values are in `neutral-preview-proof.json`. Use this neutral catalogue for the pending body review and retain the original-material catalogue for comparison.
