# Item model authoring contract

Armor rebuilding is withdrawn. The current equipment task uses existing models and the texture-only workflow in `tools/equipment-retexture/`. Do not use the historical armor instructions below to start new work. Rejected armor candidates remain on disk only because automatic approval policy blocked their deletion.

Read the root AGENTS.md and `contracts.ts`. The owner requests Astra medium creators and fresh Luna max visual critics. Each worker owns only its assigned `authors/<name>.ts` file. Root owns export, shared contracts, runtime integration, combined builds, browser tests, and acceptance.

Inspect every assigned `art/item-icons/generated/<id>.png` before modeling; `art/item-icons/256/<id>.png` is a convenient smaller copy. The approved icon governs silhouette, proportions, materials, ornaments, color, and component layout. Read canonical item descriptions as well. Infer detailed, plausible rear surfaces. Do not use cards, inflated pixel silhouettes, generic recolored primitives, or flat stand-ins. Build real solid or hollow geometry, with edges, openings, fastenings, and material detail that withstand side/back inspection.

Export `const author: ItemModelAuthor` with exact assigned IDs and a pure `build(id): THREE.Group`. Put `{itemId, author, reference, description, grip?, focus?, wearable?}` in `group.userData.itemModel`; reference is the exact generated PNG path. Use meters, Y-up, +Z front. A held item's grip center should be the origin and blade/shaft extend +Y. Include measured spell focus where appropriate.

Use MeshStandardMaterial or MeshPhysicalMaterial. Export supports byte DataTexture color, normal, roughness, metalness, emissive maps, clearcoat, transmission, IOR, and volume. No bumpMap, external image/DOM dependencies, file I/O, or publication in builders. Do not derive violent surface normals from high-contrast random albedo. Gentle physical hammer dents and independent roughness work better. Prefer at most 60,000 triangles and 8 materials per item; exporter hard limit is 150,000. Strict TypeScript includes noUncheckedIndexedAccess. Own-module construction checks are allowed; root alone runs combined checks.

Accepted non-armor pilot examples are read-only `pilot-ring.ts`, `pilot-sword.ts`, and `pilot-log.ts`; their outdoor production captures are under `test-results/item-models/round-3`. All former armor approvals are withdrawn. Reference studio lighting and game daylight differ, but material identity and geometry must match closely. Copy useful helpers into your own file; never edit another author's file.

## Native armor coordinates

Armor has `wearable: true` and is authored in the **full male body T-pose**, with identity root transform. Never center an armor slot at the origin. Root attaches the native 65-joint skeleton and weights; authors do not import old outfit geometry or add their own skeletons. The native body is `game/public/assets/models/character/base_male.glb`.

| Landmark | Position in meters |
| --- | --- |
| Pelvis | (0, .9491, -.0430) |
| Spine 1 / 2 / 3 | (0, 1.072, -.0069) / (0, 1.1778, .0039) / (0, 1.3109, .0069) |
| Neck / head joint | (0, 1.5205, -.0414) / (0, 1.5998, -.0174) |
| Upper arm L/R | (±.2120, 1.4555, -.0654) |
| Elbow L/R | (±.4630, 1.4555, -.0730) |
| Hand L/R | (±.7065, 1.4555, -.0654) |
| Thigh L/R | (±.1143, .9712, -.0360) |
| Knee L/R | (±.1143, .5424, -.0361) |
| Foot L/R | (±.1143, .0865, -.0875) |
| Ball of foot L/R | (±.1143, .0152, .0547) |

Positive X is the character's left. Both arms extend sideways in T-pose; gloves must follow this alignment, not hang at the hips. Model both gloves, boots, and legs when the item is a pair. Feet point +Z. Typical head shell fits x±.10, y1.55–1.84, z-.13–+.19. Typical chest shell x±.19, y1.00–1.52, z-.17–+.19; follow icon features and body fit rather than making a barrel. Boots typically span x±.17, y0–.35, z-.17–+.20. Greaves/trousers occupy pelvis through lower legs; preserve joints and the separation of both legs. Make garments hollow with actual openings and thickness. Match exposed anatomy/coverage to the art; root preserves underlying body where the new armor exposes it. Do not invent whole armored arms to conceal missing-body runtime bugs.

Details such as separate articulated fingers, overlapping plates, straps, stitches, cloth folds, and fur rims should be actual modeled shapes/materials. Give every piece a useful name for diagnosis. Do not make all tiers the same shape with a different color.

Fishing rods provide `itemModel.fishing` with the final guide center, crank knob center at rest, and line/bobber colors. Tag only the decorative hanging line, float and hook meshes with `userData.itemModelPart = "tackle"`. Export keeps these separate so active fishing can replace them with the production animated line. Shaft guides, reel, and the line running along the shaft remain structural geometry.

Base-color texture bytes must declare their color space accurately. The exporter converts explicitly linear-sRGB byte textures to sRGB PNG storage. Normal and roughness/metalness maps remain data textures without a color-space conversion.

## Worn armor correction

The owner rejected the earlier armor fidelity and skin occlusion. Do not use those prior static approvals as proof that armor is finished. Compare the item while worn to its approved artwork, with the actual layered silhouette and material contrast visible during idle, walking, and attack.

Rigid metal plates must set `mesh.userData.itemModelBone` to the appropriate native bone name. Tag each plate's attached rims, rivets, and fittings with the same bone. The exporter keeps material/bone groups separate. Unmarked flexible lining retains blended weights. Analytic blending across one rigid plate was measured to stretch its edges by over three times, destroying its authored shape.

An item with a continuous torso or leg lining may declare `bodyCoverage: [{region: "torso" | "legs", minY, maxY}]` in its metadata. Use safe native bind-space meter limits with seam margins. This masks only covered spine or thigh/calf anatomy; neck, arms, hands, pelvis, feet and triangles crossing the span boundaries remain. Never declare coverage beyond the actual continuous lining. Fit the lining against native body dimensions; calf skin can extend to Z -0.1605 at Y 0.4.

Texture repeat and offset are preserved through `KHR_texture_transform`; rotated or centered transforms must be baked explicitly.
