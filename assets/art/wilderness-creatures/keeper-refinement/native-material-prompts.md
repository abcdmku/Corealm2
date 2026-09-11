# Keeper material edits

All three edits used built-in imagegen. Native anatomy and UV coordinates remain unchanged for these maps.

## Regent emission

Input: `native-sources/textures/imported/97115b961e517c432f07508fbd5e466aa4714b2ec9d14223ac1feb1f49f81af5.png`

Output: `regent-fine-emission.png`, generated `exec-05374b0a-80f8-479d-8fa0-b453647508cf.png`.

Edit this exact emissive texture atlas in place. Preserve the precise positions, topology and alignment of the existing orange fissures and eye UV islands. Keep pure black background. Make the hot fissures substantially finer, about half the original thickness, uneven broken natural strands instead of uniformly bright continuous orange outlines. Darken most strands to very dark burnt red and leave only occasional thin amber-hot segments. The strongest restrained amber heat should occur in the upper half of the large right-hand body island and upper half of the lower-left body island. Lower portions of those islands should be mostly barely-visible dark red cracks; small upper-left limb islands almost fully cooled dark red. Preserve both small eye islands near the bottom, reduce eyes to subdued warm ember amber. Do not add cracks, move islands, change composition or add glow blur. This must remain a UV-aligned black emission map, not a beauty image. Sharp thin naturally interrupted fissure centerlines, heat variation along their lengths, fewer distracting bright loops.

## Nightforge steel

Input: `native-sources/textures/imported/d04258594580081a0af33967d08f6d7ddee86dd1802b9a2aca679971ce359dd3.png`

Output: `nightforge-steel.png`, generated `exec-48dc7ee1-b60c-478b-83db-cd3bc0e49676.png`.

Edit this exact game armor base-color texture. Preserve its exact fine grain and narrow existing curved seam positions, but change the overly dark charcoal steel into readable medium-light worn silver steel, mean base RGB approximately 170 180 184. Existing very narrow seams remain darker charcoal with traces of aged bronze rust. Restrained hammered and scratched metal microdetail, diffuse albedo only, no bright shiny lighting or reflections, no new large cracks. No UV layout or composition changes. Silver steel faces should be clear under dark violet night lighting. Keep the original fine texture density, square image.

## Hollow Star

Input: `hollow-native-atlas.png`, extracted unchanged from the snapshotted native Monster09 GLB.

Output: `hollow-pearl-atlas.png`, generated `exec-2c872530-06af-4d61-937a-40c67c0091c8.png`.

Precisely edit this existing 3D creature UV albedo atlas. Preserve every existing UV island position, boundary, silhouette, texture detail, padding pattern, scale and alignment EXACTLY. Do not invent or move anatomy. Recolor the pale blue raised armor/chitin plates and claw surfaces to pearl ivory with warm grey shadow creases. Retain dark recessed joints, eye details and small surface fissures. Deeper organic chitin becomes muted smoky violet and dark plum. The several large red wing membrane islands across the top middle and middle-right should become muted smoky wine rose with paler warm gray-lilac membrane centers, preserving their original veins and gradients. The result must have readable pearly raised plates, violet body joints and restrained wine membranes. Avoid saturated blue or purple wash, new marks, symbols, new eyes or halos. Preserve native fine skin texture and all UV boundaries. This remains a flat texture atlas, no rendered creature or background.

## Reused approved surfaces

`regent-basalt-albedo.png` is an exact copy of the stone family's `kiln-cooled-albedo.png`, approved for the native golem UV layout. Regent applies a warmer material factor. The original normal remains at strength .35.

`archon-cloth-atlas.png` is an exact copy of the wraith family's `cloth-atlas-v1.png`. Archon copies its accepted planar cell mapping for robe, hood and hands while retaining the original Banshee positions and animation. Its native normal maps remain unchanged.

Ashseal uses unchanged native bone and equipment images with material factors only. The live approved Skeleton Soldier asset is unchanged.
