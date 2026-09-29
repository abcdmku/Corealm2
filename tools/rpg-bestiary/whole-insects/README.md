# Whole source insects

The spider and wasp factory (`index.mjs`, `starter-wasps.mjs`, `texture-wasp.mjs` and their audits) was removed on 2026-09-29 with the other repo motion generators. The shipped wasps and spider keep these textures; their motion comes from the current pipelines in `tools/creature-motion/README.md`. The texture art and its prompts are recorded below.

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
