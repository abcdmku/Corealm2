# Lava streams

The September 2026 revision keeps the original dark cellular pattern and orange-to-violet palette.
The surface emission is modestly stronger. Invisible rectangular area lights illuminate the banks
and nearby models. Lava has no point lights, repeated spark/smoke sources, bloom overlay, or separate
bright center stripe. Four area lights cover the visible shore, remain eligible through 220 metres,
and fade over the last 60 metres. Stable assignments and gradual fades prevent abrupt switching
when the player moves or turns. Ordinary torches retain their existing lights.

`wildernessLava.ts` owns the shared carve, molten clearance and collision footprint. Channels cut
2.6–3 metres into the receiving terrain with 4.2–4.8 metre banks. Broad authored bends preserve the
existing junctions and destinations. The signed shoreline union keeps pool ends below grade and
removes the old depth discontinuities. General biome scatter stays outside the carved banks;
the production bank meshes supply their stone detail. Static crust slabs no longer cover the flow.

`lavaFlow.ts` samples the receiving terrain to choose downhill currents and blends connected paths
into one velocity field. Flat tributaries feed their parent. The material moves slowly through that
field with one sample of the original cellular pattern, avoiding duplicate luminous layers.

The production deep-lava lab owns material, lighting, forks, banks and movement acceptance. The
authored route changes, terrain cuts and scatter integration use the world-authoring exception:
their placement and relationship to the full terrain cannot be established in an isolated yard.

Run `npx tsx tools/deep-wilderness-lava-lab-test.ts` for both palettes, point-free bank lighting,
synchronous lighting comparisons, distant lighting, dry movement and blocked lava crossings.
Run `npx tsx tools/lava-stream-world-test.ts` for three authored streams with ordinary grounded
follow cameras and real bank movement. Inspect their images under `test-results/`; they are
disposable acceptance evidence. Regenerate navigation and the map after changes to authored cuts.

The world check also exposed shader warmup proxies losing custom material defines and instance
colours. Preparation now preserves both, with a regression in `renderer-warmup.test.ts`.
