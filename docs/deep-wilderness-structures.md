# Deep Wilderness structures

These three production recipes use the existing measured building, ironwork and altar assets. They remain unregistered in the final world until the root accepts their lab proof. `content/wildernessDepth.ts` owns the world centres, yaw and reserved footprints.

| Composition | Footprint | Drawn parts | Merged collision parts | Architecture |
| --- | --- | ---: | ---: | --- |
| `cinder_chain_foundry` | 64 × 56 m | 683 | 64 | Two open furnace bays, supported stone hoods, unequal hollow masonry flues, casting benches, iron moulds, chains and a ruined rear arch |
| `nightforge_bastion` | 68 × 64 m | 1,020 | 66 | Two broad muster courts, four corner towers, two tall rear sentinel towers, iron screens, arsenal dressing and two open gates |
| `hollow_star_sanctum` | 70 × 64 m | 724 | 58 | Twelve surviving observatory columns, broken inward ribs, unequal remnants of the enclosing wall, paired side altars and a low ritual inlay |

The compositions face local +Z. Each leaves a 10 m ground lane between its north and south approaches. The side curtains stay lower than the rear towers so a player inside a court can see the architecture through the normal camera. Every elevated stone course rests on another course or overlaps its corbel bearing. Rubble occupies the outer edges and cannot close a lane through oversized decorative colliders.

`DEEP_WILDERNESS_STRUCTURES` exports the footprint, `clearThrough` endpoints, `clearWidth`, three `courts`, a `keeper` circle, mounted `torches` and grounded `inspectionStops`. The two side courts have clear radii of 8 m at the foundry and 9 m at the bastion and sanctum. Each forecourt has a 7 m clear radius. The keeper circle is centred at `[0, -15]` with 5 m of clear ground. Population can use the side courts and leave the forecourt as the approach.

Each court includes fifteen resident sockets for bodies with radius at most 1.1 m. Their minimum spacing is 2.55 m in the forecourts and 3 m in the side courts. Larger occupants need fewer, more widely spaced sockets inside the same tested clear circle. A nine-creature, 3.2 m grid accommodates 1.5 m body radii in all side courts. Full dragons belong outside these structures.

`buildDeepWildernessStructure(id)` returns ordinary `PartPlacement[]`. `buildDeepWildernessStructureCollisionParts(id)` returns the matching merged ground solids. Root integration must select the latter for structure navigation, as it already does for the earlier Wilderness ruins. Do not use the visual arch lintels or decorative ironwork as full-height bounding-box obstacles.

Each structure has six native torches, scale 1.7. The mount metadata identifies `ember`, `azure` or `violet` flames. The foundry retains five warm mounts and one blue mount near its transition-facing wall; the deeper structures mix blue and violet. Flame origins use the existing native-torch local point, transformed through the part and the site's yaw. The production effect renderer owns their colour and animation.

Focused CPU validation: `npx vitest run tests/deep-wilderness-structures.test.ts --maxWorkers=1` passes twelve tests. The tests inspect actual manifest bounds for every part, unsupported joints, card-thin parts, footprint escapes, all encounter circles, the entire ground lane, resident separation and clear inspection stops. They also pass all three structures through production collision assembly at three rotations. That regression caught a registration filter which had discarded the new masonry; root fixed the shared filter.

`tools/deep-wilderness-structures/lab-test.ts` provides one fixture per invocation under a 60-second total deadline. All three browser runs passed after the collision fix: foundry 16.27 s, bastion 15.47 s and sanctum 15.56 s. Production part counts, merged collision counts, mounted flame activity and navigation paths matched. Real W input crossed both gates of each structure, moving 14.58–15.10 m per crossing. All browser and game error lists were empty.

The author inspected the twelve captured views. They show furnace bays and chains, the bastion's distinct tower skyline, and the sanctum's side altars and low ritual inlay. They use ordinary player focus and 11 m zoom. A fresh critic accepted bastion and sanctum geometry, but held the foundry chimneys: the native village chimney has a pointed underside intended to enter a pitched roof. Both foundry flues now use continuous masonry tubes with a 3.4 m footing embedded in the furnace hood and broken upper crowns. The foundry has 683 parts after this repair; its 64 ground collision solids and court reservations are unchanged. All twelve focused tests still pass.

The first lab runs also showed warm torches at the deep structures despite their azure/violet mount metadata. Root and the effects worker wired those themes into the production effect path. The driver now compares each assigned PointLight's actual colour with the corresponding mount palette. Three `--colours-only` retakes passed: foundry 7.765 s, bastion 7.725 s and sanctum 7.481 s. Every one of the eighteen lights matched its mount: ember `ffa257`, azure `447cff` or violet `9865ff`. Browser and game error lists remained empty.

The author inspected all seven new screenshots. Both foundry flues now visibly meet their furnace hoods across broad bases, with damage confined to the upper crowns. Bastion has blue entrance torches and violet rear wards. Sanctum alternates blue and violet around its portals. `report-colour.json` and `colour-*.png` record these final fixture changes without repeating unchanged gate walks. Root and the fresh critic own final acceptance; full-world placement remains a later step.

Use `inspectionStops` as player positions, not as detached camera targets. The driver keeps normal gameplay focus, target height and zoom limits. After lab acceptance, world integration must check rotated placement, flat foundations, pack residency, keeper access and the actual baked navigation path.
