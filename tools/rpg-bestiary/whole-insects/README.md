# Whole source insects

`buildWholeInsect(id)` in `index.mjs` returns `{object, clips, meta}` for `webweaver_spider` and `marsh_wasp`.

Run `python tools/rpg-bestiary/whole-insects/prepare.py` to extract the two hash-pinned source FBXs from the existing local cache. The source bodies, materials, UVs, and bone hierarchy are retained. The complete source spider has 59 bones; the complete source wasp has 39. Three's FBX importer normalizes the strongest four influences for vertices with more source influences.

These are Quaternius Easy Enemy Pack assets under CC0. Exact archive and member hashes come from `../replacement-inventory/nature.json`. The source pack is https://quaternius.itch.io/animated-easy-enemies.

Idle and Walk retain source idle/walk or flying takes. Run uses source locomotion at 1.65 times the source rate. Attack and Death retain source takes. The source contains no hit animations; Hit, HitLeft, and HitRight use source idle/flying motion with authored whole-body recoil. A separate wrapper lifts sampled geometry above the floor. Wasp flight keeps source altitude. Forward is +Z after a constant source orientation change.

Contact markers are measured from maximum forward reach of the spider's source Head_end or wasp's Sting_end bone. They require production visual review before acceptance. No humanoid bases or detached head parts are used.

Run `node tools/rpg-bestiary/whole-insects/audit.mjs` for CPU geometry, floor, weight, and native-gait checks. This creates `cpu-audit.json`; it does not substitute for the parent's production gallery and motion review.

## Wasp appearance

Early-game variants are built with `node tools/rpg-bestiary/whole-insects/starter-wasps.mjs`. It writes three candidate GLBs and manifest entries under `test-results/starter-wasp-variants`, verifies unchanged animation samples, and asserts that the high-level source file remains unchanged. Each can be previewed with `npx tsx tools/starter-creature-test.ts --wasps --starter-variant --candidate <path>`. The candidate uses the Field Wasp lab preset for all three appearances; registered `--wasps` checks the final species/assets together.

The starter wrapper scales are Field 0.68, Heath 0.62 and Reed 0.72, in addition to species scale 0.45. Their grey albedo is tinted moss green, dusty brown and slate blue; body sheen and wing iridescence are reduced. The neutral texture is saved as `textures/starter-scales.png`, generated with the built-in image_gen tool using this edit prompt:

> Edit this game scale texture: remove ALL purple and blue colour, making the whole image a neutral medium grey material tint mask. Preserve the exact positions, shapes, sizes and fine hairs of the existing scales so it still matches the existing normal map. Slightly soften contrast and lift dark recesses for a modest early-game creature. Neutral grey only, no hue, no new pattern, no new forms, no stripes. Flat evenly lit albedo, edge-to-edge seamless. It will be tinted moss green, earthy taupe and slate blue by game materials.

The shared Field Wasp / Marsh Wasp uses fine blue-violet scales and feather filaments with normal-mapped relief. Connected body surfaces have separate principal-axis UVs, wrap seam correction, and two texture repeats. Area-weighted smooth normals remove the original faceted shading. Colour variation follows body orientation.

The eyes are 42% of their original diameter, with a dark purple outer surface, muted wine-red iris and dark pupil. The raised wing veins are removed. Two wing pairs use planar UVs, opacity 0.48, iridescence 0.85 and a pearl texture with sparse sparkle flecks and a subtle fractal frost pattern. The rear pair is 78% of the main pair, angled down by 0.55 radians, and retains the source wing skin weights so both pairs flap with the original flight animation.

Body roughness is 0.46, metalness 0.08, normal strength 0.45, clearcoat 0.28 and iridescence 0.24. Skeleton and all animation clips remain intact. Geometry edits shrink eye shells, remove wing-vein triangles and add a skinned rear wing pair. Serialization is checked against the authored geometry and source animation data.

After exporting the source wasp, run `node tools/rpg-bestiary/whole-insects/texture-wasp.mjs --source <exported-glb> --out <candidate-glb>`. The appearance pass is required after rebuilding the insect. Accept with `npx tsx tools/starter-creature-test.ts --wasps --candidate <candidate-glb>` before replacing the public model and updating manifest hashes, bytes, triangles and materials.

Project textures, generated with the built-in image_gen tool:
- `textures/harpy-plumage.png`: body albedo.
- `textures/harpy-plumage-normal.png`: corresponding tangent-space relief.
- `textures/wasp-wing-pearl.png`: pearl membrane and faint fractal detail.

Body prompt:
> Create a seamless square 1024x1024 GAME BODY MATERIAL albedo swatch informed by the attached harpy reference's skin and short body plumage ONLY. Fine tightly overlapping tapered reptilian/bird scales interspersed with short fine feather filaments, visible crisp small-scale relief detail. Muted medium slate blue and dusty violet with subtle mauve scale tips. Scales about 20 pixels wide, varying organically, not large leaves, not swirls, not a carpet. Restrained realistic medieval dark fantasy creature skin. Uniform consistent material density filling the entire square edge to edge, seamlessly tileable. Soft even diffuse illumination, no dramatic light or broad shadows. NO creature figure, wings, face, clothing or background. No stripes, no yellow, no brown, no neon. Texture should read as fine scaled feathered skin rather than smooth plastic.

Normal-map prompt:
> Convert this exact scale-and-filament texture into a tangent-space normal map for a game PBR material. Preserve exact scale positions, sizes, direction and every boundary. Flat background normals RGB 128,128,255. Fine raised scale edges and filament relief, shallow realistic bumps, no large surface undulation. OpenGL +Y convention. Remove all albedo and illumination information, normal map colors ONLY blue/lavender flat regions with red/green directional slopes, edge to edge square map. This is a technical normal map matching the supplied albedo, not a new pattern.

Wing prompt:
> Seamless square 1024 game material texture for translucent iridescent insect/fae wing membranes. Extremely delicate pale pearl-blue membrane, subtle diffuse lavender and icy mint variation. Sparse tiny silver-white crystalline glitter points, scattered naturally, mostly quiet transparent-looking membrane between them. Fine realistic organic micrograin, thin gossamer quality. Flat evenly lit texture swatch edge to edge. No wings silhouette, no veins (model already has veins), no stars, no starbursts, no bokeh, no circles, no thick scales, no feathers, no outlines, no text. Muted grounded fantasy, not cartoon. An albedo material map; the game supplies transparency and view-dependent iridescence.

Wing refinement:
> Edit this wing membrane material texture: replace the long straight fracture streaks with a very subtle fine self-similar branching frost/fern fractal pattern. Small delicate recursive branches in pale pearl-lavender, only slightly different from background, about 8 percent contrast. Preserve the translucent-looking icy blue pearl membrane and sparse tiny silver sparkle flecks. No thick veins, no dark outlines, no straight structural lines, no large fern leaves. Edge to edge seamless game texture, flat albedo, no wing silhouette. Pattern should be understated, visible up close, quiet at a distance.

Lab evidence under `test-results/wasp-plumage/lab` includes both sizes exchanging damage and close views from both sides. The world appearance and interaction checks are under `test-results/starter-world`. Typecheck and production build pass.
