# Generation prompts

Built-in image generation mode. Selected outputs live beside this file. Resampling preserves source alpha; no runtime image processing is used.

## ash

Create a production game foliage alpha texture, square 1024x1024 with a genuinely transparent RGBA background. One natural airy ash branch spray, stem starts at bottom centre and forks gently upward into three thin twigs. About 35 small elongated green pointed leaflets in opposite pairs, with clear transparent gaps around and between every leaflet. The entire spray fills the square with 4% transparent padding. Fresh medium spring green foliage, even soft diffuse albedo lighting, visible fine veins but no strong baked shadows, no outline. Flat orthographic view of the leafy branch laid parallel to image plane. Do not make a dense blob or a bush or whole tree. At least 45 percent of the bounding rectangle should remain transparent. No ground, no text, no labels, no drop shadow.

## willow

Production game texture: a single airy weeping willow foliage spray isolated on a genuinely transparent RGBA background, square 1024x1024. A thin gently curving green-brown twig starts at bottom centre and extends upward, with four fine side twigs extending upwards in a loose fan. Around 45 slender small lanceolate willow leaves, much longer than wide, delicate pointed ends. Clear transparent space between the leaves; at least half the image rectangle transparent. Light natural spring green, subtle veins, soft even diffuse albedo lighting without strong shadows. Orthographic face-on botanical cutout, 5% transparent padding, no ground, no whole tree, no labels, no frame, no outline. It will be rotated downwards as a hanging branch on a 3D tree.

## maple

Production game foliage texture on a genuinely transparent RGBA background, square 1024x1024. One airy natural maple branch spray, thin woody stem beginning at bottom centre with three irregular forked twigs extending upward into a fan. Around 24 small five-pointed lobed maple leaves, irregular orientations but all readable face-on, clear gaps between leaves and branches; at least 45% of bounding rectangle transparent. Fresh medium green with some slightly golden leaves. Fine veins, realistic botanical albedo with soft flat lighting, no dramatic baked shadows. Whole branch with 5% transparent padding, no ground, no tree, no labels, no border, no black background.

## teak

Production game foliage texture on a genuinely transparent RGBA background, square 1024x1024. One natural teak twig spray, thin woody stem at bottom centre, three spreading twigs extending upward. Fourteen broad large oval pointed teak leaves with readable fine veins and gently wavy edges, opposite paired leaf arrangement, varied natural orientations, clear transparent gaps between each leaf. Soft medium green, realistic botanical albedo, evenly diffused flat light and no strong baked shadows. Entire branch fits with 5% transparent padding. At least 45% transparent space in the rectangle. No ground, no whole tree, no labels, no frame, no outlines.

## pine v2

Create an original game foliage texture: a delicate airy pine twig spray on genuinely transparent background with alpha. Square image. Slim woody stem begins exactly at bottom center and branches into 7 narrow ascending twigs. Each twig bears sparse small clusters of fine short pine needles, with transparent space visible between needle tufts along the twig. The overall twig fan fits within image with 4 percent padding. Needle groups must remain slender and bristly with irregular feathery edges, never broad solid paddles or flat lobed leaves. Fresh forest green with lighter yellow green growing tips, neutral bright diffuse daylight, minimal baked shadows. Orthographic face-on view, all twigs roughly in same plane for use as an alpha card. No tree trunk, cones, grass, ground, backdrop, text or checkerboard. Around 45 percent overall transparent negative space inside the outline.


## Botanical replacements, September 2026

Generated with the built-in image generation tool, then inspected as RGBA cutouts and in production Chromium. Selected sources:

- `walnut-spray-source.png`: Transparent black walnut (Juglans nigra) twig spray, three forked twigs; pinnately compound leaves with 13?19 pointed, finely serrated leaflets and a small terminal leaflet. Green diffuse albedo, no shadows or text.
- `yew-spray-source.png`: Transparent English yew (Taxus baccata) five-twig fan. Short flat dark-green needles individually attached in two comb-like rows, reddish-brown stems, no pine needle bunches or cones.
- `maple-red-spray-source.png`: Create an original RGBA transparent game texture: one red maple branch spray, isolated in empty transparent space. Botanical 3D-game albedo texture, square. Thin brown twig entering at bottom centre with three forks bearing 15 to 20 recognisable palmate maple leaves, each with five sharply pointed lobes and visible veins. Autumn brick-red, muted crimson and copper-red leaf colours, with natural variation and fine veins. Airy fan-shaped composition, small gaps between connected leaves, diffuse flat illumination, entire branch fits with a small empty margin. Genuine alpha channel transparency. No background scenery, no ground, no cast shadows, no labels or typography. This is an isolated foliage cutout asset for leaf cards.

Two earlier maple edits were rejected because they baked a checkerboard into RGB. Only the genuine alpha replacement is included here.


## Fuller crowns and magic revision

Built-in generation; selected files are saved alongside this document.

- `bark-ridges-source.png`: Generate a seamless tileable PBR base-colour bark texture, square, orthographic macro scan of mature deciduous oak/walnut-like bark. Vertical irregular deeply fissured narrow gray-brown ridges, many small broken scales and branching crevices, organic variation, realistic rugged old tree bark. Neutral diffuse flat illumination, no lighting gradients, no shadows cast by external objects, no moss, no foliage, no knots larger than one tenth of tile, no text. Entire image filled edge to edge with bark; must tile on all four edges. Natural subdued warm gray brown, moderate contrast, fine detail, not stylized wood planks.
- `magic-spray-source.png`: A transparent PNG cutout of a botanical twig spray, genuine alpha channel and completely empty transparent background. Square game texture. Five fine branching twigs with 35 small pointed oval blue-green leaves and thin pale silver veins. Twig enters bottom centre, wide rounded fan-shaped spray fills centre of square with an empty transparent margin. Natural leaf forms, diffuse neutral lighting. No glow or haze anywhere. No coloured backdrop, no background at all, no vignette, no shadows, no text. Just the isolated twig and leaves with transparency between them. RGBA game asset.

An earlier magic spray with a glowing background was rejected. The selected cutout has real alpha; animation is supplied by the production shader.
