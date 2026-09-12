# Crownward revision acceptance

The revision replaces the two T40 castle compositions with CreativeTrio's CC0 complete Castle and Fortress assets, expands Crownward's organic field through its coastal collar, and populates the eastern Wilderness with six ruins, connecting roads, eight sentries and four gathering sites.

Both generated PNG materials were accepted in the persistent production feature lab before final-world enablement. Pearl masonry preserves the premade roof palette. Cinder masonry applies to Wilderness stone and plaster while preserving wood, roofs and banners. World-coordinate triplanar projection, warped sampling and broad color variation reduce repetition; lighting-responsive relief, roughness and mineral specular response supply surface depth.

## Browser evidence

- test-results/crownward-revision/castles/report.json: both premade structures rendered, measured and traversed through their actual exterior arches. Source geometry was preserved; generated body collision follows mesh slices rather than a sealed bounding box.
- test-results/crownward-revision/wilderness/report.json: black knight castle and all four reused ruin recipes rendered with cinder material and passed keyboard passage checks.
- test-results/crownward-revision/world/report.json: both castles, coastal grass reaching the sea, Lost Kingspan, Far Cinder Smithy and Starless Abbey inspected. The northern arch passed keyboard traversal and navigation reaches the boss court.
- test-results/fairy-expansion/resources/report.json: all four new Wilderness gathering sites yielded items and reduced their resource remaining count.

Current revision castle and world screenshots use the actual interactive 11 m maximum camera distance, normal pitch limits and a player-following target. No detached camera was used. The full-world authored field, coast and placement work uses the documented lab exception; reusable structures and their materials were proven in the lab first.

A fresh read-only critic identified that drawn bounds can appear before streamed shader compilation finishes. The world acceptance helper now waits for the shader queue to drain before screenshots, resolving premature empty-castle captures without changing production streaming.

## Validation

TypeScript passes. Crownward coastal-field, Wilderness transition and structure tests pass, 15 assertions across three files. Earlier targeted camera, landmark, route, depth and resource checks also passed. Content validation passes with 712 assets, 327 items, 191 recipes and 15,550 entities. Existing unrelated creature/cave/habitat assertion failures are recorded in the prior fairy expansion acceptance and are not claimed fixed here.

Final map and release artifact results are appended after generation.

Full image-generation prompts, image hashes and output paths: [textures.md](textures.md). Source asset metadata and immutable download hashes: tools/crownward-castles/provenance.json.

## Final release result

The 121-tile full-world capture was reviewed and regenerated. Its 800 px minimap is 142,546 bytes at quality 91, preserving the existing 150 KB boot budget; original native serving-tile quality is unchanged, totaling 2,474,668 bytes. Crownward is continuous to the sea and the northern Wilderness spans the full island width with the added structures and roads.

Production build passes with 336 baked world tiles, 81.83 MB compressed. Current-world, shipped-navigation and map-payload checks pass, 15 tests across three files. TypeScript passes. The world browser report was rerun successfully against the packaged Vite preview at http://127.0.0.1:4180, and its final castle screenshot was inspected. All four new gathering-site checks were repeated successfully with the 11 m interactive camera limit; the helper chooses a node clear of the lab's default cottage and tries normal approach directions.

Development server remains running at http://localhost:4179.
