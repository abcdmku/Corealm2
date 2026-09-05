# Corealm material source textures

## Current production PBR surfaces

The richer surface set uses the built-in imagegen artwork in `art/rebuild/surface-sources/`. That folder records the exact prompts and generation provenance. The earlier two-color-detail sources below remain archived and no longer produce the runtime textures.

Run `node art/rebuild/textures/build-surface-maps.mjs` to rebuild the current runtime maps. The script creates three registered map sets in `game/public/assets/textures/corealm/`:

| Surface | Albedo | Normal / roughness | Physical mapping |
| --- | --- | --- | --- |
| Bark | 1024 x 1024 | 512 x 512 each | 1 metre per tile, circumference U / branch arc-length V |
| Quarry stone | 1024 x 1024 | 512 x 512 each | 2.4 metres per tile, stable planar UV projection |
| Leaf tissue | 512 x 512 | 512 x 512 each | U across blade, V from petiole to tip |

Albedo contains authored bark ridges, knots, geological bedding, fractures, sparse surface deposits, leaf midribs and secondary veins. The runtime material preserves per-channel pigment variation relative to the map's measured mean RGB, so these maps do not multiply a second dark base color into the vertex palette. It samples actual tangent-space normals and roughness maps. Mineral seams retain their palette and metalness with a narrower roughness response than the host. Broadleaf and fern use the leaf image; narrow needles and grass sample the same registered midrib region across all three maps. Cutwood, flowers and stems keep their authored vertex surfaces.

The pipeline retains the original source files. Processing resizes and encodes the albedo, matches the opposite bark/stone tile boundaries with a narrow cosine feather, then derives registered relief and roughness from the source's grooves and veins. These are inferred surface maps, not measured scan data or independently authored physical height. Nominal relief spans are bark 20 mm, stone 26 mm, and leaf 0.65 mm before the material's normal strength. Leaf pixels are vertically oriented once to match the native mesh's V=0 petiole convention. Height previews remain in this directory for inspection.

`corealm-surfaces.json` records source SHA-256 values, mean linear RGB, physical mapping, resolution, and relief assumptions. Final encoded bark and stone albedo, normal and roughness maps have exactly matching opposite boundary texels in both axes. This removes image-boundary discontinuities; production UV transitions still need mapped screenshot acceptance.

The nine PNGs total approximately 4.68 MB and are shared across the complete model families. Offline conversion measured 1.35 seconds on this workstation. The game performs no image processing at load time. Material caching, source geometry, wind hooks and tier/depletion hooks remain shared. Focused checks confirm normal and roughness references survive tier and depletion clones without changing source materials.

## Archived first-pass source record

The remainder of this document describes the earlier two-texture implementation, retained for provenance. Its runtime settings and file sizes are superseded by the production PBR surface set above.

Created 2026-09-04 for the Corealm content rebuild. Both images were generated using the built-in `image_gen.imagegen` tool, one generation call per asset. No external stock asset, reference image, image-generation API script, or image-editing model was used.

The original tool outputs are preserved unchanged here. Runtime images live in `game/public/assets/textures/corealm/` so the game does not depend on the generated-image cache.

| Material | Original | Runtime | Runtime size |
| --- | --- | --- | --- |
| Weathered oak bark | `corealm-bark-original.png` | `corealm-bark.png` | 1024 × 1024, 974,650 bytes |
| Layered slate / schist | `corealm-stone-original.png` | `corealm-stone.png` | 1024 × 1024, 950,495 bytes |

## Material intent

Use these as sRGB base-color albedo maps with runtime lighting and matte material response. They contain shallow painterly value differences, not normal, roughness, or height data.

Bark grain follows the trunk and branch axes. The broad plates should remain readable from the gameplay camera. Avoid applying this bark texture to the cut end of a log.

Stone supplies quiet diagonal geological bedding. Mesh geometry supplies the outcrop silhouette, major strata, cracks, and ore seams. There are deliberately no mineral veins in this texture, so a generic rock does not accidentally promise a harvestable resource.

The runtime module `game/src/render/corealmSurfaceMaterials.ts` loads both textures once and derives cached materials for the exact names `Bark_Corealm` and `Corealm weathered strata`. `Corealm mineral seam`, `Cutwood_Corealm`, and foliage are unchanged. Call `loadCorealmSurfaceTextures(baseUrl)` and `applyCorealmSurfaceMaterials(loadedGlb, textures)` before the asset registry caches a GLB.

The shader uses texture luminance relative to the measured mean, with a maximum 22 percent value adjustment. It preserves the generator's vertex hue and avoids multiplying a brown texture into already brown vertex colors. Mean linear luminance is 0.160994 for bark and 0.188077 for stone. Contrast strengths are 0.38 and 0.60 respectively. Roughness is at least 0.91 for bark and 0.94 for stone, with zero metalness on those two families. The shader adds no displacement, bump, normal changes, alpha changes, or shadow changes.

Bark UVs currently span once around each branch and once along its length, so the runtime map repeats 1 x 1. Geology UVs are in metres; a repeat of 0.42 puts one stone tile across approximately 2.4 metres. Both maps use sRGB decoding, repeat wrapping, trilinear mipmaps, anisotropy 4, and the GLB texture orientation. Originals and shared geometry remain unchanged.

Both originals and optimized runtime copies were visually inspected. The outputs have restrained colors and large readable forms. They were requested as seamless tiles, but generated boundaries are not mathematically periodic: before indexed PNG encoding, edge mean absolute RGB deltas on the 0–255 scale measured bark X 6.37 / Y 4.34 and stone X 4.07 / Y 4.65. These are small discontinuities, not proof of perfect seams. Final acceptance must inspect the mapped production models, especially broad repeated surfaces and branch seams.

## Runtime processing

Only format and size processing was applied with the project's existing Sharp dependency. No painting, filtering, creative image edits, or synthetic surface detail was added:

```js
await sharp(source)
  .resize(1024, 1024)
  .png({
    compressionLevel: 9,
    palette: true,
    quality: 100,
    colours: 256,
    dither: 1,
    effort: 10,
  })
  .toFile(runtime);
```

Indexed PNG encoding reduces the pair from approximately 3.77 MB to 1.93 MB. Preserve originals when producing a future runtime format or resolution.

## Built-in output provenance

Bark output: `C:/Users/Borg/.codex/generated_images/01a06e90-92af-79d3-a131-f2440a7a1175/exec-5301ed3a-ee25-4af7-8fdc-18895f49793b.png`

Bark original SHA-256: `DE82C6F29D4AF8B6DE7824F14F4E5E7CE1EE4A3FD9EB94C3B468B5D7FD862D73`

Stone output: `C:/Users/Borg/.codex/generated_images/01a06e90-92af-79d3-a131-f2440a7a1175/exec-fc518ab7-d913-47db-8c69-a50f1fa29d9b.png`

Stone original SHA-256: `757F21E6ECEA537D2C59F0875376C3B9943E77574AF50A2CCD7DBC65DF33559C`

## Exact bark prompt

```text
Use case: stylized-concept
Asset type: seamless tileable albedo texture for a polished stylized low-poly fantasy game's 3D tree bark, square 1024 x 1024 image.
Primary request: weathered warm oak bark with broad vertical flowing grooves and restrained hand-painted pigment variation. Fill the entire image with only the material; flat orthographic surface sample, absolutely no perspective, scene, borders, or objects.
Style/medium: refined painterly game texture with sculptural large forms and softly faceted natural surfaces. Rich craftsmanship, controlled detail; neither noisy photorealistic scan nor flat cartoon.
Color palette: warm gray-brown oak with muted umber in the shallow grooves, slightly warmer desaturated ochre on broad bark plates. A restrained midtone range.
Materials/textures: broad, varied interlocking vertical strips of aged oak bark, a few subtle knots and short fine fissures, calm areas between the dominant grooves. Readable when downsampled onto low-poly tree trunks.
Lighting: true base-color albedo intended for dynamic 3D lighting; even neutral illumination across the whole image, no baked directional shadows or highlights, no ambient-occlusion black creases, no shiny areas.
Constraints: perfectly seamless and tileable on all four edges, including flowing vertical grain across top and bottom; no visible edge framing; no text, watermark, symbols, leaves, moss, branches, cut ends, metal, or cracks that become black. Restrained contrast and broad forms are essential.
```

## Exact stone prompt

```text
Use case: stylized-concept
Asset type: seamless tileable albedo texture for a polished stylized low-poly fantasy game's 3D stone formations, square 1024 x 1024 image.
Primary request: warm-gray slate and schist layered bedrock, with subtly diagonal geological bedding and sparse fine weathering. Fill the entire image with only the rock material; flat orthographic surface sample, absolutely no perspective, scene, borders, objects, ore, or mineral veins.
Style/medium: refined restrained hand-painted game material with sculptural large forms and soft pigment variation. Clear subtle layering, not rectangular masonry. Neither photorealistic noisy scan nor flat cartoon.
Color palette: quiet warm medium gray with subdued greige and a little cooler gray within layers. Restrained midtone range, no near-black lines, no bright white accents.
Materials/textures: broad interleaving rock strata run at a shallow diagonal across the image, subtle long flat stone faces, irregular natural bedding breaks and a few sparse short hairline cracks. Large calm patches between the layers; mineral grains almost invisible at gameplay distance. No giant pebble or cobblestone pattern and no exaggerated stacked razor-thin shards.
Lighting: true base-color albedo intended for dynamic 3D lighting, even neutral illumination across the whole image. No baked directional lighting, edge highlights, ambient-occlusion shadows, or shiny areas.
Constraints: perfectly seamless and tileable across all four edges, no framing; no text, watermark, symbols, soil, grass, moss, ore veins, metal, or isolated stones. Low contrast and large readable forms are essential, because geology and ore seams will be modelled in the 3D mesh.
```
