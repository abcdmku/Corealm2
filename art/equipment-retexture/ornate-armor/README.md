# Tier-specific armor surface revision

The owner rejected the previous shared-atlas color pass as too basic. This revision keeps the existing Knight geometry and creates six separate albedo and height atlases. Metalwork and leather padding change with the tier. Nightmarshal is a crafted chest upgrade using the Nightglass finish, not a seventh tier.

The built-in ImageGen tool generated the maps. Source layout: `game/public/assets/textures/imported/10d1d0c0b49d2037d3182a916dff4bde41bec81f1b9fe5effc18203681777fc2.jpg`. Material references: the six corresponding cuirass/plate icons in `art/item-icons/256/`. Project outputs: `game/public/assets/textures/armor/<tier>-albedo.png` and `<tier>-height.png`.

## Prompt set

Albedo common instructions: edit the existing Knight UV atlas, not an armor illustration. Preserve normalized island positions, rotation, outlines, holes, and gutters. Output one square opaque texture. Repaint surfaces inside the existing islands; no rearrangement, scene lighting, labels, emission, or random high-contrast noise. Add carefully worked metal faces, burnished perimeter bands, crisp fasteners, restrained panel-specific engraving, and tailored leather including the glove islands.

| Tier | Metal direction | Padding direction |
| --- | --- | --- |
| Copper / Grithe | Warm hand-hammered copper, bright burnished edges, dark recesses, narrow tooled edge lines | Oiled dark chestnut grain, double seams and bound edges |
| Iron / Corven | Graphite iron, silver perimeter bands, directional brushing, narrow double-line chisel engraving | Deep umber, fine pebbling, narrow quilting and tan stitching |
| Cobalt / Kaldite | Rich metallic cobalt, pale silver angular inlay, fine recessed chevron borders | Navy and blue-black leather, silver-gray diamond quilting |
| Titanium / Emberite | Smoke-silver, cool blue-gray planes, polished silver edges, bronze hairline inlay and fine chased borders | Charcoal blue-black quilting, bound gray seams and bronze fasteners |
| Cindersteel | Charcoal gunmetal with polished copper inlay, engraved channels, selectively burnished faces | Black oxblood embossed quilting, copper stitching and bound edges |
| Nightglass | Midnight blue-black polished faces, silver-blue edges, violet/platinum fine tracery | Black indigo satin leather, fine silver-blue stitching and clasps |

Height companion instructions: create an exactly aligned grayscale height map from each new albedo. Preserve every outline, inlay, rivet, engraved line, seam and quilt cell. Remove reflected brightness, material color and broad plate curvature. Flat faces are gray 128; shallow raised edge strips/stitches/rivets 165–195; recessed lines 70–100; quilting 115–145; fine hammer grain 122–134. Gutters and unused areas stay flat midgray. No shadows, white specular highlights, labels or legend. Smooth, shallow relief rather than sharp steps.

## Runtime and acceptance

The separate waist pieces had no UV texture and retained plain pale metal bands. Their existing broad bands now use quilted padding, with straps and metal trim treated separately. A generated neutral leather tile and registered height companion are projected in local coordinates without changing geometry. Each tier supplies its leather color and roughness.

Padding prompt: seamless square neutral gray fine-grained leather, shallow diamond quilting, double stitched seams, embossed chevrons and bound seam detail. No scene lighting, labels or border. Height companion preserves the exact pattern: quilt centers 145, seam ground 128, recessed channels 90 to 110, threads 170, fine grain within five gray levels. Saved as `game/public/assets/textures/armor/padding-albedo.png` and `padding-height.png`.

`equipmentArmorTextures.ts` selects the tier atlas on material clones, keeps native normal/ORM maps, and adds height relief plus differentiated metal/leather roughness. The revision passed the production-backed lab and is enabled in normal gameplay. Root owns browser gates and promotion. Screenshots and acceptance records distinguish this revision from the rejected shared-atlas pass.

The first full review rejected the dark plate interiors and weak padding separation. Revision 2 reduces the overly metallic response so engraving remains visible under the existing scene light, broadens polished highlights, and separates the padding values by tier. It adds no emission or scene-light changes. Two fresh Luna max reviewers passed all six tiers and the Nightmarshal chest variant. Fine engraving and quilting remain subtle at full-frame size and clearer in the enlarged gallery.

The 21 captures in `docs/game/assets/captures/armor-ornate/` are intentionally retained as the worn-armor documentation. They show actual male-rig front, back, and walking views at the normal 6 m gameplay zoom. Female Nightglass and combat checks remain disposable evidence under `test-results/ornate-armor-r2/`. Gallery image links preserve the full gameplay frame.
