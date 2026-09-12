# Medieval bridge replacement

The user-supplied FBX and textures replace both Crownward river bridges. Complete geometry and five authored material groups are retained, with embedded PBR maps. The model is uniformly normalized to the existing 24 m crossing span. Paved approaches meet the banks, and the deck rises about 1.91 m at its crown. Exact source triangles provide navigation and camera collision.

Production-lab acceptance passed for SHA cc61ec05dee24e59a80c03e9cc6e7e628fa06ab812f90a001386a05940136e17. Both keyboard traversals reached the opposite dry bank; the crown navigation follows the model and the underwater river point remains unreachable. Normal player-follow screenshots of the approach and deck were inspected. No game or browser errors were reported. Evidence: test-results/medieval-bridge/lab/report.json.

Only after lab acceptance was the candidate promoted. Both existing placements reuse the accepted model. The internal asset ID remains stable for the existing world entities. Source hashes, duplicate ZIP texture members, material conversions and source license status are recorded under tools/medieval-bridge.

TypeScript and eight focused bridge/river tests pass. Final map, release bake and packaged-world checks follow.

The refreshed 6600px world map was inspected at both crossings. Production build passes with 336 tiles. All 15 release-world, shipped-navigation and map-payload artifact tests pass. The upload is accepted through an exact archive-hash provenance record; it retains its user-supplied status rather than claiming a public license. All 29 provenance/CC tests pass, including rejection of changed archive hashes, pack IDs and sources.

Final packaged-world acceptance at http://localhost:4180 passes. Both crossings passed keyboard traversal on the rebuilt navigation, and both normal-camera placement screenshots were inspected. No game, console or page errors. Evidence: test-results/medieval-bridge/world/report.json. The dev server remains running at http://localhost:4179.
