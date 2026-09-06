# Source guardian candidates

`golem.mjs` exports synchronous `buildGolem(id)` for `stone_golem`, `iron_golem`, and `fire_golem`. Module initialization writes deterministic mineral base-color and normal textures under `derived/`; the parent exporter embeds `meta.textureBindings` with glTF image orientation preserved.

The guardian retains Quaternius Universal Base Characters anatomy and the original weighted knight chest, legs, boots, gloves and pauldrons. Proportion edits transform source vertices and bind joints together. The existing 65-joint animation library supplies eight named clips, including a slowed Punch_Jab attack. Hair is removed; body triangles covered by armor are hidden.

Stone uses chalky weathered plate with mineral grain. Iron adds the original closed knight helmet, wider shoulder shells, a deeper breastplate and broader gauntlets and boots with oxidized metallic plates. Fire removes one pauldron, raises and widens the surviving volcanic shoulder shell, enlarges one gauntlet, and uses charcoal armor with a low warm emissive response on exposed inner anatomy. Stone geometry, materials and animations remain unchanged from the root-accepted source4 screenshot. These are one body family. There are no free-floating body parts or emissive ribbons.

`node tools/rpg-bestiary/golem-source/check.mjs iron_golem` or `fire_golem` checks the whole skinned geometry at 73 times in each clip and emits disposable CPU orthographic previews. The build also samples floor correction at 60 Hz and every source key time. All variant clip minima were at least 0.00051 m above the floor; Run retains its source aerial phase, up to 0.215 m. CPU preview uses flat triangle colors and is useful only for anatomy, not texture or browser acceptance.

Existing `miniboss_galeskin` was inspected first and rejected as a golem source because it has a slim imp torso, tall horns and long talons. Its CPU inspection image is `source.png`.

No browser or GPU used. Stone and fire instantiate seven skinned meshes; iron has eight including its source helmet. Each has eight clips. Metadata includes the SHA-256 digest of each actual source GLB under provenance.sourceFiles. The production lab must still review textured appearance, deformation, attack contact timing, gait and final framing. The attackContact value is provisional pending that review. Do not promote without the root's lab acceptance.
