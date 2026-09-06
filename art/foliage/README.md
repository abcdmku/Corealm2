# Tree foliage source textures

The oak, ash, willow, maple and teak `*-spray-source.png` files and `pine-spray-v2.png` were generated with the built-in image generation tool for Corealm. These are synthetic foliage images. Ash supplies the walnut texture; pine supplies yew needles; magic trees use tinted maple foliage. The reference collages guided tree structure and were not copied into the textures. See [generation prompts](./generation-prompts.md).

The source briefs requested isolated branch sprays with stems at the bottom center, transparent backgrounds, natural internal gaps, diffuse green color, and no directional shadows. Each selected texture was visually inspected before use.

`tools/build-corealm-nature.ts` resamples each source to a 1024 × 1024 RGBA texture and embeds it in the corresponding tree GLBs. Eight-triangle curved cards carry complete branch sprays. Alpha testing writes depth and uses the same silhouette in wind and shadow passes.

The embedded PNGs retain ordinary straight RGBA for asset portability. At load time, the renderer prepares a shared texture with RGB weighted by alpha in linear space. GPU filtering then averages leaf colour without introducing the black RGB behind transparent pixels. The leaf shader recovers that colour after filtering and uses a slightly wider mip footprint for colour only. Alpha bytes, geometry and the shadow cutoff stay intact. Both visible sides of a branch spray share the same upward lighting normal, and the sun's shadow grid stays anchored as the camera moves. `tools/foliage-motion-lab-test.ts` captures production camera and wind sequences for reviewing temporal stability.

Broadleaf geometry follows the space-colonization approach of [Runions, Lane and Prusinkiewicz, 2007](https://algorithmicbotany.org/papers/colonization.egwnp2007.html). Crown targets guide growth directions, while descendant shoot mass controls taper. Pines use a central leader and lateral boughs. Growth runs offline; the game loads and instances the resulting 24 models. The final density pass was inspected in the production lab individually and in a mixed grove.

Regenerate candidates with `npx tsx tools/build-corealm-nature.ts --stage test-results/natural-trees/candidate` and inspect them in the production environment workbench before replacing game assets. After acceptance, run `npx tsx tools/build-corealm-nature.ts`, then `npx tsx tools/publish-corealm-trees.ts`. The publisher verifies all tree file hashes and updates only tree rows and the nature generator hash in the existing manifest.

The 24 tree models range from 4,192 to 17,976 triangles each. The original six oak/pine models total 67,838 triangles, down from 806,139 on main. This measures source geometry, not frame rate or alpha overdraw.

Species progression is Pine 1, Ash 5, Oak 10, Walnut 20, Willow 30, Maple 40, Teak 50, Yew 60, and Magic 70. Future-tier encounter weights drop fourfold per ten levels above an area's level. Each species splits its weight across its variants.

Acceptance uses `tools/foliage-distance-lab-test.ts` for all 24 trees and four understory models, `tools/forest-handoff-lab-test.ts` for continuous visibility while walking, and `tools/forest-lab-test.ts` for gathering and persistence. Each accepts `--url http://127.0.0.1:4188`. Screenshots and reports go to ignored `test-results/` directories. Visual reviews include single species, near/far views and a mixed grove.

World scatter composition uses the world-authoring exception to the isolated lab gate: biome mixing and encounters require the authored island. Assets, materials and interactions were accepted in the lab first. Final integration samples loaded world tiles and a real tree interaction with `tools/world-resource-check.ts --forest-only`; this is not a full island census.
