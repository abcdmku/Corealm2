# Caprine source shortlist

No asset in this folder is promoted or visually accepted. Original downloads are unchanged. Creator previews were inspected, and Blender ran only in background mode with automatic scripts disabled.

## Best accessible body fallback: p0ss sheep

[Creator release](https://opengameart.org/content/sheep-rigged-textured-and-animated), CC-BY-SA 3.0. Original: `sheepies.blend`. Credit p0ss and retain the license and change notices for an adaptation. The texture derives from the boar photograph by titus tscharntke in the creator's [Woodland Animals Texture Pack](https://opengameart.org/content/woodland-animals-texture-pack), also available under CC-BY-SA 3.0. Both pages are preserved.

The preview shows complete domestic sheep bodies with four fleece stages. The wireframe shows a connected head, torso, and limbs. This is a plausible body base, but the sheep has no ram horns, the face is simplified, and the shorter coat variant needs review before adaptation. Native inspection confirms four 1,470-vertex meshes and one 22-bone armature. Only `Sheep 2` has all vertices weighted; the other fleece variants need weight transfer. The file has seven actions: idle, walking and eating with transitions. One 1024-square diffuse image is packed; duplicate references are missing and would need relinking to that packed image. This is not yet a runtime material test.

## Best species match, download blocked: adobedog1 Ram Sheep

[Creator release](https://blendswap.com/blend/17410), CC-BY. Exact version remains to be read from the downloaded license. The creator describes a rigged bighorn without a color texture. Preserved preview shows the whole body and curled horns, but heavy wool also covers the face and would need removal. It is not an automatic quality winner.

The normal [download page](https://blendswap.com/blend/17410/download) explicitly requires sign-in. Page and preview are saved; the model is not acquired. A bounded search found no verified legitimate historical mirror. No gated endpoint was bypassed.

## Acquired but rejected for this visual target: pracalic sheep

[Creator release](https://opengameart.org/content/sheep), CC0. Original `owca.zip` and extracted contents are preserved. Preview shows a cartoon sheep with drawn oval eyes and coarse limbs. Native inventory finds multiple rigs and two actions. It is usable as a licensed technical reference, but it is a poor natural bighorn base. Native image paths need repair to the supplied files before any render.

## Other leads

- ZERTUX sheep in Gonsplitters: redistributor claims CC-BY-SA 4.0, but the original model's exact license chain is not verified. Creator's Cults collection was found; fetching it returned 403. Do not promote on the package-level claim alone. No package files were changed.
- Quaternius farm animals: creator OGA release is CC0 and directly downloadable, but the deliberately low-poly domestic sheep is a weak visual match. Not acquired to avoid redundant low-quality candidates.
- Idaho Virtualization Laboratory bighorn: noncommercial/no-derivatives restriction makes it unsuitable for this adaptation.
- LayeredART printing model: listing found, usable license not established; not acquired.

## Evidence and next step

`native-inventory.json` records source meshes, bones, images and actions. `inventory.py` reproduces the CPU inventory. `sha256.json` identifies every preserved original, preview, and source page.

Review the p0ss short-fleece body and the adobedog1 creator preview side by side before spending adaptation time. Acquiring the latter requires the ordinary signed-in download flow. No new procedural body, public asset, or GPU/browser session was created.

## Static review candidate

`p0ss-sheep2-static.glb` is the unscaled complete Sheep 2 source body with its original packed diffuse. It has no skins or animation clips. Only rigid heading alignment, ground centering, and material relinking were applied. `export-static.py` reproduces it using Blender CPU mode. No horns or body-shape changes were made.

`review-catalogue.json` points target `creature_cairn_bighorn` to `models/creature/creature_cairn_bighorn.glb`, explicitly labeled as a Sheep 2 base. This version adds a uniform root scale of 0.5198992296085831 for a 0.95 m total height. The unscaled GLB remains preserved. `prepare-review.mjs` verifies finite positions, UVs, embedded texture, zero skins/animations, and produces that wrapper/catalogue. Both contain the CC-BY-SA 3.0 provenance and changes. The final export runs without mesh/armature warnings. Hardware review remains pending.
