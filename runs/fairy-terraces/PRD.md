# Fairy terrain and creatures

Status: implemented and accepted after focused tests, reference review and packaged Chromium gameplay. Scope approved through the user's September 12, 2026 implementation directive. Target regions are Gloamgarden T30 and Faeholme T60, confirmed by the user switching to the fairy branch.

- Replace the village's broad flat presentation with individual buildable clearings backed by raised, planted banks. Preserve functional doors, banks, stations, quest identities and the existing shortcuts.
- Author larger raised combat grounds. Each has one or two narrow traversable approaches. Slopes outside those approaches must block direct walking and route navigation.
- Use the supplied reference images for mossed rock, low winding paths, layered purple foliage and houses fitted against terrain.
- Import locally supplied Fairy NPC and monster sources with reproducible scripts and provenance. Fairy NPCs use small Paragon Fey variants with real source animation.
- Use the 30 Monster Stylized Fantasy Vol 01 creatures for ordinary fairy encounters. Reserve frightening larger monsters for stronger encounters.
- Register Fantasy Monster 01 through 09 as reusable miniboss species across world regions. Each drops standard jewellery and has a rare unique jewellery roll. Unique items combine defence, vitality and melee or magic power. Respawn after 1,800 seconds; reset starts a fresh encounter state.
- Each region has exactly two slots drawn from that universal miniboss pool. Ordinary encounters cannot use those source bodies. Custom respawn deadlines survive save and reload.
- Build reusable assets and gameplay in the production feature lab before final placement. Record browser actions, state changes, errors and normal player-camera screenshots.
- World terrain, authored paths, settlement placement and regional scatter use the world-authoring exception because their spatial relationships are the behavior under test. The exception does not cover assets, actor animation, loot or timer behavior.

Acceptance includes focused terrain/navigation and loot/timer tests, asset and NPC lab inspection, a real final-world traversal check, build/typecheck, relevant regression tests and screenshot review. Do not report unproved asset or world work as accepted.

## Reference-scale correction

The user rejected the first tall, isolated shelves and asked for closer integration with the supplied images. Combat shelves rise 6?8 m. The later regional buildout raises village receiving banks to about 4.7 m and the remote connected high ground to roughly 7?9 m. The fairy terrain uses 1 m cells so those lower cliff faces still reject direct climbing. Local building footings are cut after bank shaping. Source Pure Nature boulders dress the outer toes in buried groups, and planted shoulders frame compact villages. Skyboxes remain the existing regional skyboxes.

Reference acceptance must inspect fully resident vegetation through the ordinary attached player camera, including both sides of town, every ascent, a remote encounter pocket, and bank access. A source preview or an unloaded first frame cannot pass this gate.


## Village composition correction

The repeated reference images remain the visual acceptance target. The earlier village views were rejected and are not acceptance evidence.

- Native low crags now define the village banks. A recessed terrain underlay prevents the one-metre terrain cells from protruding through their faces; trees and plants use the actual crag surface instead.
- The mature central oak has an authored lower trunk and crown, retaining its width, source topology and materials. Its separate candidate passed the foliage lab before world placement.
- Purple awnings follow the measured timber supports, with stocked counters and hanging lanterns. Production collision follows the three counters and six posts.
- Small native leaf mats provide continuous ground cover. T30 uses moss teal; T60 uses cooler greens. The production lab verified the actual GLTF UV sampling and palette before these variants entered the world.
- The full-world exception applies to the placement of these accepted assets and the bank underlay. It does not waive lab acceptance of the assets or gameplay proof of the lanes and bank.

Final reference comparison and traversal passed after these placement changes; see acceptance evidence below.


## Connected T30 and T60 highlands

The latest user correction extends this layout through both complete fairy regions. Raised land is the default; resolved road curves and a small set of encounter and service clearings cut the winding valleys. The same one-metre terrain lattice drives rendered cliffs, height sampling, movement and navigation. The regional field continues through the T30/T60 boundary.

- Fifteen additional hollow routes divide the connected high ground. Eight narrow garden ramps reach additional upper areas. Existing combat summits keep their seven ordinary ascents and blocked flanks.
- Five combat summits also have timed Agility climbs with T30 or T60 requirements. The sixth summit already has two walking ascents. These use the production Agility system, marker assets and skill checks.
- Village footings, service stands and door approaches cut small usable pockets. Native crags, trees and garden plants sample the final receiving surface.
- Larger native rock groups break up selected corridor walls. Rotated native footprints preserve a five-metre walking floor and body clearance. Fine plants follow the wall toes; encounter crowns reserve their fighting space from large trees.
- The full-world exception covers the connected height field, road carving, upper gardens, regional rock placement and scatter. Isolating these would remove the network and placement being tested. Native rock/turf materials and Agility interaction used separate production feature-lab proof before this integration.

Disposable evidence is under `test-results/fairy-terraces-lab/` and `test-results/fairy-terraces-world/`. The regional height audit currently measures 75.2% raised coverage in T30 and 72.4% in T60, with no resolved road centreline exceeding the allowed traversal grade. Final world screenshots, traversal and release build passed as recorded below. Earlier screenshots with camera clipping or uniform bare walls are rejected evidence.


## Final integration corrections

The current placement pass adds 900 upper-bank trees, 450 in each region. Of these, 649 follow corridors and 251 frame the six combat-plateau rims. Root support checks include the transformed native rock surface, trunk footprint, slope, and low burial; roads, ramps, fighting floors, service sites and town entrances remain reserved.

All 82 combat-ring rock compounds now fit within the plateau mass, with the complete sampled body no farther than 2.25 m beyond its organic toe. The original lower footing is retained after moving a compound inward. Production-solid checks at all six low flank approaches show zero displacement at a 0.9 m player radius. This corrects the earlier Lantern Crown ejection onto its outer bank.

A small turning pocket at the Lantern Crown west ascent keeps the attached follow camera in the valley. The compact camera lab verifies hard terrain clearance and recovery using normal mouse orbit, without moving the focus or raising the target. Accurate Fey inspection now measures sampled-animation vertices rather than its conservative culling envelope; the displayed actor scale is unchanged.

The navigation bake now includes the new fairy geometry dependencies and prevents recursive CLI execution when Vite bundles its release guard. Navigation rebuilt successfully after these corrections. Full-world browser evidence is recorded in `test-results/fairy-terraces-world/wooded-final/`; earlier rejected runs remain diagnostic only.


## Garden landing and outer-view correction

Each garden ramp now joins the surrounding upper ground through a rounded crest. The first twelve metres beyond that crest reserve a six-metre-wide walking corridor from native rock bodies and tree trunks. Seven interfering rocks were removed from those reserves; 549 fitted rock compounds remain, including all 82 combat-ring compounds. Terrain regression samples the shared physical lattice through each crest and nine metres into the garden. Browser acceptance also walks beyond the endpoint, rather than stopping at it.

The Southern Moss, Starroot North and Sovereign East outer gardens have three unequal, inset knolls each. Their added 3.5 to 5.2 metre relief preserves the landing corridors. Forty-two grounded native trees form staggered groves on those shoulders. This is authored full-world terrain and placement of already accepted native assets, covered by the world-authoring exception; no new reusable asset bypasses lab proof. The mainland map image is unchanged: the fairy realm uses its own live terrain/map source.

The full wooded-final browser run passed all six combat summits, seven walking ascents and blocked flanks, eight garden ascents, five Agility climbs, two banks, four small Fey conversations, all thirteen regional views, and eighteen universal guardians. Updated crest/interior views and the outer garden compositions passed in wooded-garden-landings and connected-garden-landings before release acceptance.


## Acceptance evidence

Typecheck and all 138 focused tests across 24 files pass. The final navigation artifact contains 14,674 polygons; fingerprint a8f707a33e1f3bfd996489119cd3f6a07280edb20d35693cfd7b70532a5a8896. The height audit measures 75.2% of T30 and 72.4% of T60 above the low-path threshold, with no excessive resolved-road grades.

The wooded-garden-landings run proves walking over all eight crests and into their upper gardens. The final connected-garden-landings run repeats the four affected entries after the wooded shoulders were connected and oversized fungi were excluded from the landing corridors. All four pass with no game, browser-page or console errors. The root inspected these normal attached-camera captures. The earlier exposed-edge and obscured-player captures are diagnostic only.

The fresh read-only critic accepts the regional buildout from the combined reviewed evidence. Remaining nonblocking art differences are smooth cliff faces, repeated bank shapes and less irregular small planting than the references.

The production build passed, including content validation, navigation freshness, all 336 baked world tiles and release bundle budgets. The baked world is 128.73 MB decimal, below the 128 MiB ceiling. Exact metadata is in test-results/fairy-terraces-world/release-build.json. Packaged-runtime verification passed against the built game at port 4398. The release-final report proves all seven combat ascents and blocked flanks, all eight garden interiors, five Agility climbs, both banks, four small Fey conversations and eighteen universal guardians. Actual shipped world records, their manifest and the navigation binary returned HTTP 200. No game, browser-page or console errors were recorded. The root inspected packaged-game screenshots with normal attached player cameras.

Acceptance is complete for this regional buildout. Fine rock-face variation and less regular planting remain possible art refinements; the result is not claimed to be an exact reproduction of the artistic renderings.
