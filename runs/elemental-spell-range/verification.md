# Elemental spell artwork and lab verification

2026-09-09. The range now has 24 spells: the existing five tiers and one simple starter per element. All 20 existing attacks received moving emissive material detail and authored variation across repeated contacts. After the owner's further feedback about plain, repetitive air effects, the air set was rebuilt with separate spatial forms and choreography.

| Element | Implemented artwork |
| --- | --- |
| Air | Air Needle is a pointed twisting dart. Razor Crescent has three broad banked blades with different curves and tilts. Vacuum Coil is a low inward spiral with an open eye, below 3.2 m. Thunder Lance is one continuous corkscrew travelling through the lane. Skybreaker has an 11.4 m base, rotating currents, smaller vortices around its foot and ground-level gathering wind before touchdown. Curved surfaces refract the scene, with eroded blue-violet emission and fine circulating motes. No rocks, smoke or line-segment tracers. |
| Water | Visible blue liquid, moving flow, foam, spray and droplets. Repeated streams have different bends, depths and splash directions. Geysers have unequal heights and lateral spills. Undertow contracts through partial inward collars. Deluge keeps one continuous 14 m curling wave per row, with three different crests. No ice or freezing status. |
| Earth | Shaded stone with moving cool mineral seams, torn dust and fine chips. Flint Shot and Siege Boulder fracture their connected geometry into 72 and 180 pieces. Dust fronts, fragment fans and contact bands vary by pulse. Basalt Jaw's two walls have different rock profiles. Mountainfall remains one asymmetric mass that sheds avalanches and collapses. |
| Fire | Organic textured flame with moving heat ridges and eroded edges. Contacts vary in height, spread, flame folds, plume count and flow direction. The comet, lash, mine canopy, continuous phoenix and descending solar mass retain their separate choreography. |
| Basics | Breeze Puff, Water Bead, Pebble Toss and Kindle each arrive in under 600 ms, hit once within 0.9 m and use fewer than 500 live particles. The small puff has one curved edge; the bead forms a small liquid splash; the pebble breaks into 24 connected pieces; Kindle has one brief flame contact. |

Twelve authored contact recipes vary width, depth, height, arc length, flow bend, orientation and breakup direction. These change the actual spatial surfaces and emissions. Tidal Fan's five arrivals are staggered by 35 ms. The four starter spells have dedicated compact choreography and remain separate from the five advanced tiers.

The original material mask remains `game/public/assets/vfx/elemental-flow-v2.png`. It moves across curved spatial surfaces, never an entire attack card. The [asset provenance](./asset-provenance.md) records its generation. Existing flow surfaces use 576 triangles each. The new air currents use 384 triangles per strip, bounded instanced batches, a scene-refraction pass and a separate emissive contribution. Fine detail comes from material flow and erosion. These counts do not imply that transparent shading is free.

Completed verification:

- `npm run typecheck` and `npm run build` passed after the final game changes. Existing mixed dynamic-import and bundle-size warnings remain.
- `npx vitest run tests/elemental-attacks.test.ts tests/spell-vfx.test.ts tests/spells.test.ts`: 33 tests passed. Coverage includes delayed and bounded damage, distinct attack patterns, single-hit starter behavior, a wide Skybreaker versus a low Vacuum Coil, liquid-only water, air without debris, finite lifetimes, spatial geometry and pool bounds.
- All four Chromium elemental shards passed, covering 24 pointer casts, target health before and after, delayed impacts, reset, next, repeat, slow motion, HDR/refraction activity and cleanup. The air shard was rerun after its final artwork changes. No console or shader errors or pool overflow were reported.
- Live motion captures cover all 24 spells at charge, travel, contact, peak, final impact and fade. The two boulders also verify an intact body before contact and the same geometry separating into fragments. Geyser Chain and Sunfall received extra captures at every contact. All phase galleries were visually inspected; the six air galleries were recaptured and inspected after the air rebuild.
- Captures use normal player-follow focus and gameplay pitch/zoom limits. Thunder Lance also received a second view reached through actual right-mouse dragging. Tall effects extend beyond the frame; no camera target was lifted or detached to fit them. Skybreaker's ground wind-up remains visible while its crown is above the frame.
- The Cinder Mine HDR comparison passed with 26,389 changed pixels and 3,449 halo pixels. The additional Vacuum Coil comparison passed with 36,035 changed pixels, 26,882 halo pixels and 1,349 saturated changed pixels. Both checks include idle equivalence, viewport resize and cleanup.
- The final refraction comparison passed with 21,617 changed pixels for Vacuum Coil and 37,282 for Geyser Chain. No pixels changed in the tested foreground outside the effects. The pass uses one shared scene-color copy and preserves the camera, idle image, resize behavior and cleanup.

Final hardware Chromium measurements at 1440 by 1000:

| Element | Peak live particles | Peak principal bodies | Peak strand segments | Highest VFX CPU update p95 |
| --- | ---: | ---: | ---: | ---: |
| Air | 9,167 | 42 | 0 | 1.8 ms |
| Water | 20,201 | 33 | 430 | 2.6 ms |
| Earth | 15,224 | 52 | 112 | 3.4 ms |
| Fire | 13,025 | 42 | 48 | 2.6 ms |

The highest observed frame-interval p95 was 16.8 ms. Particle, strand, body and liquid-pool overflow were zero. These figures describe this machine and the compact lab, not final-world combat.

The preview remains available at `http://127.0.0.1:4178/index.html?mode=combat&spells=1`. Choose an element and use **Reset & cast**, **Next**, **Repeat** or **Slow motion**. Reproduction commands are in [the feature-lab workflow](../../docs/feature-lab.md#elemental-spell-range). Screenshots, phase galleries, semantic state and performance reports remain disposable under ignored `test-results/elemental-spells/`. Production modules are exercised through the lab; authored-world progression has not been changed.
