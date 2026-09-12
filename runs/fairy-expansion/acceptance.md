# Crownward and fairy realm acceptance

The current user request authorizes this expansion. The implementation brief and PRD in this directory record the region layout and frozen map contract.

## Content

- Crownward T40 occupies X 350–700 and Z -200–460. Positive X is displayed on the left of the game map, opposite Fallowmarch. It includes two established castles, a bank/respawn settlement, mature groves, worked mines, pearl knights and the Ivory Castellan.
- Wilderness extends to X 700 for its full northern height. Seven additional existing-species packs occupy the added strip, with T50 and T70 placement matching the existing depth rule.
- Gloamgarden T30 and Faeholme T60 share an independent 600 × 660 m terrain map below the surface. Crownward has the entrance portal; the T30 arrival has the return portal. The regions join through ordinary walking.
- The fairy terrain has an open mineral sky, teal/violet ground and foliage, giant fungi, two harvestable tree variants, worked ore sites, local creatures, and two full bosses. Existing ore/log outputs remain usable in current production recipes.
- All 12 creature assets preserve their source geometry, rigs and eight animation clips. Changes are material skins and authored scale. Eight foliage aliases preserve source geometry and use the production texture, wind and material paths.

## Workflow and proof

The production Vite game and persistent lab booted in Chromium before parallel feature work. Root froze map IDs and helpers in `contracts.ts`; workers owned distinct files. Reusable castle, creature, foliage, atmosphere, resource and portal work used the compact production lab. Root reviewed state changes and gameplay-camera screenshots before registration in the final regions.

World layout, biome fields, terrain, world-scale scatter and long-distance placement used the world-authoring exception: isolating them would remove the authored spatial behavior under test. The reusable assets and portal interaction were still checked in the lab.

Root Chromium checks under `test-results/fairy-expansion` cover:

- The white castle in the building lab.
- All 12 creature variants taking damage through the production combat action.
- Teal willows and violet yews through production instanced foliage.
- Real pointer mining at all three new ore sites, and chopping at both fairy groves. Each action produced an item event and reduced the node's remaining resource.
- Reciprocal lab portal travel and keyboard movement on the destination terrain.
- Actual Crownward portal entry, keyboard movement from Gloamgarden to Faeholme, return travel, and restoration of a save inside Faeholme, with no game or browser errors.
- The fairy map panel showing its own bounds and places, plus pointer mining in the authored Dewglass Workings with a production item reward.

The final source review found and corrected a surface-only fallback respawn height. It found no remaining concrete blockers in save, death, movement, gathering or reciprocal travel paths. The asset integrity checker passed 12/12 material-only reskins. Worldgen sampling retained all 60 authored intent centers at full ownership; the new field preserves the existing lake-bank and Wilderness transition tests.

Screenshots and verbose reports remain disposable under ignored `test-results`. The visual-field SVG in this directory is retained as the authored layout review.

## Existing test failures

A fresh read-only reviewer reproduced these baseline failures and compared the relevant source/assets with committed HEAD:

- `dense-cave-fixture`: two assertions still expect radius 13, while committed placement and production code use radius 24.
- `ash-creature-redesigns`: the existing Veil Reaper has 1,208 deformed vertices against a 2,000 threshold; existing Cinder Penitent material names fail the generic prefix assertion.
- `encounter-population`: the existing Midnight Carapaces pack has 3.42 m lava clearance against a greater-than-3.5 m assertion.
- `world-habitats`: 48 existing lava reservations across five original Deep Wilderness groups. None belongs to the new eastern strip or fairy regions.
- `regional-pack-exclusions`: the original `pack_karrowmoor_gravelmaw_north_west_quills` has 0.355 m clearance against the original expanded chamber reservation, below the 1 m assertion. Both placements match HEAD; activated production pack checks pass.

These are outside this expansion and were not weakened or silently repaired.

## Release artifacts

The surface map was regenerated at 6,600 × 6,600 pixels with the same 0.25 m pixel density. A 50 m ocean margin on either side keeps its serving grid at 121 square 600 px tiles without changing playable bounds. Larger capture cores preserve pixel density and physical shadow bleed while reducing capture overhead. The resulting tiled level is 1,942,174 bytes; all 12 map payload tests pass. The source map and minimap were visually inspected.

The first full suite produced 2,512 passing assertions and eight failures. One failure was the old four-region pack-count assumption; it was corrected and its focused check passes. The seven baseline assertions above remain. The final focused atmosphere, portal, resource, water-bank and Wilderness run passes 16/16. Typecheck and content validation pass.

The final production build passes. It contains 336 scatter tiles across both maps plus separate surface/fairy terrain records and shared spawn data, totaling 85.15 MB compressed. Release artifact integrity and map payload tests pass 14/14. Chromium also booted the packaged game through Vite preview, displayed the enlarged surface map, entered Gloamgarden through the actual portal, and displayed the separate fairy map with no game or browser errors. The packaged screenshots were inspected through the normal follow camera and map controls.
