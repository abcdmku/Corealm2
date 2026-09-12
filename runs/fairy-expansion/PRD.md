# Crownward and the fairy realm

Status: Approved for implementation by the owner's explicit current request. This amendment changes region layout and adds content while preserving existing progression and player saves.

Crownward T40 extends positive world X from 350 to 700 and Z from -200 to 460. The map mirrors X, so this is the leftmost band opposite Fallowmarch. Wilderness extends to X 700 across its existing northern height.

Gloamgarden T30 and Faeholme T60 share a separate terrain map at X 2000 to 2600 and Z -200 to 460, below surface elevation. Gloamgarden occupies Z -200 to 130; Faeholme occupies Z 130 to 460. A reciprocal portal in Crownward leads to a safe T30 arrival. The two fairy areas connect by ordinary walking. Their sky depicts an immense underground realm, with no enclosing cave corridor or ceiling mesh.

Crownward has mature parkland, established castles, white shimmering knight variants, harvestable trees and worked mines. Fairy areas have teal, violet and lilac vegetation with strange silhouettes, harvestable regional trees, tier-appropriate ores and reskinned existing creatures and bosses. All creature geometry, skeletons and animations come from existing assets.

The root owns architecture, contracts, worldSpec, boot integration and acceptance. Region IDs and worldMapForRegion in contracts.ts are frozen before worker implementation. Each worker owns distinct files. Reusable assets, atmosphere, structures and portal interactions require production lab proof before final placement. Full-world terrain, biome fields, layout, scatter placement and long-distance navigation use the world-authoring exception because their authored spatial relationships are the behavior under test.

Acceptance requires typecheck/build, focused state tests, real Chromium lab interactions, inspected gameplay-camera screenshots, then final-world entry, movement between both fairy areas, resource interaction, return travel and save restoration. Regenerate dependent world/navigation/map artifacts as required by their input changes. Routine proof remains under ignored test-results.
