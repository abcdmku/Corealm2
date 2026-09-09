# Elemental flow texture

Generated 2026-09-09 with the built-in `image_gen` tool. No CLI fallback or third-party reference assets were used.

Final asset: `game/public/assets/vfx/elemental-flow-v2.png`, 1254 by 1254 pixels, grayscale flow mask. The generated file was copied unchanged. Mirrored wrapping, layered samples, animated UVs and shader erosion provide material detail on curved spatial surfaces. It is not rendered as a whole spell sprite.

Original output: `C:/Users/Borg/.codex/generated_images/01a08134-68ee-7041-9b0a-713879bae8af/exec-f9306743-187a-4106-a012-5973ba053e7f.png`.

Final prompt:

> Use case: stylized-concept. Asset type: original production VFX flow texture for a 3D fantasy RPG. Generate one square 1024x1024 seamless grayscale texture, edge-to-edge, no borders, no text, no objects, no scene. This is a material mask, NOT an illustration of a spell. Black background filled with vertically advecting turbulent white and medium-gray wisps: fluid curls, torn lace-like flame membranes, thin branching filaments and broad connected soft body regions with sharply eroded gaps. Direction mostly upward but curling sideways in irregular eddies. Rich fine-scale texture within larger flowing shapes; a balanced distribution of near-black voids, gray veils and narrowly concentrated white ridges. Reference quality is professionally authored action RPG VFX, organic simulation-like flow, no evenly repeated waves, no hard polygon shapes, no radial burst, no bloom baked into the entire texture. All four edges tile seamlessly. This one neutral flow texture will be animated, warped and recolored by shader on 3D curved surfaces for flame, liquid foam, wind condensation and mineral energy.

Inspection: confirmed dense organic curls, connected gray veils, black gaps and narrow white ridges. Reviewed its use on all four elements through gameplay-camera lab captures. The material colors and emission are authored separately for each element.

## Original medieval inscriptions

2026-09-09. `game/src/render/arcaneSpellVfx.ts` contains original vector-stroke geometry for wind curls, water signs, mineral peaks and flame signs. Each spell has three glyph variants with different central strokes, outer segments and rune arrangements. These are authored in code, revealed by a shader and placed on shallow curved surfaces in world space. No additional raster image, reference-game texture, model or copied symbol was imported for this pass. The production Marchhide kit and wooden staff are existing Corealm equipment assets.
