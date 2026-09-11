# Lava streams

The September 2026 revision keeps the original dark cellular pattern and orange-to-violet palette.
The surface emission is modestly stronger. Invisible rectangular area lights illuminate the banks
and nearby models. Lava has no point lights, repeated spark/smoke sources, bloom overlay, or separate
bright center stripe. Four area lights cover the visible shore, remain eligible through 220 metres,
and fade over the last 60 metres. Stable assignments and gradual fades prevent abrupt switching
when the player moves or turns. Ordinary torches retain their existing lights.

`wildernessLava.ts` owns the shared carve, molten clearance and collision footprint. The four main
routes were rebuilt against a survey of the uncarved production terrain. Authored bed elevations
descend through each join; widths expand from narrow sources into receiving hollows. Tributaries
curve into the downstream direction, and elongated basins replace the circular terminal bulbs.
The main streams have 8–9 metre banks that blend the cut into the surrounding relief. The signed
shoreline union keeps pool ends below grade. General biome scatter stays outside the carved banks;
the production bank meshes supply their stone detail. Static crust slabs no longer cover the flow.
Tributary meshes stop at the existing molten surface, including its terminal plane, to avoid
coplanar overlap at shallow joins while keeping connected pools covered.

The earlier noisy-edge pass was rejected: its silhouette remained a shallow ribbon. The subsequent
[research and design report](lava-landform-research.md) distinguishes an inherited volcanic valley
from a channel built by lateral cooling and overflow. Sixteen authored host-rock bodies now form
source shoulders, confluence dividers, exposed walls and lower receiving benches around the four
main flows. Their polygon footprints and crown elevations modify the shared terrain before the
channel cuts through it. Connected rock surfaces follow that physical terrain; face-based texture
projection avoids vertically stretched wall textures. General scatter excludes the host bodies.
The deep region uses the same geology with the existing violet lighting.

`lavaSurface.ts` gives profiled flows a separate liquid grade above a submerged bed. The liquid no
longer coats the terrain's bumps. Material transport
uses fixed cross-channel and longitudinal coordinates from `lavaTextureFlow.ts`. Tributaries align
to the receiving channel. Advancing only the longitudinal coordinate prevents elapsed time from
progressively stretching the cellular pattern around bends. There is still one dark pattern sample,
with the existing emissive palette, moving at a restrained visual speed of 0.11 metres per second.

The production deep-lava lab owns material, lighting, forks, banks and movement acceptance. The
authored route changes, terrain cuts and scatter integration use the world-authoring exception:
their placement and relationship to the full terrain cannot be established in an isolated yard.
Variable widths and graded beds were first exercised in the production deep-lava fixture. The
survey tool records uncarved heights and checks downhill continuity and road cuts; it writes only
disposable data under `test-results/lava-survey`.

Run `npx tsx tools/deep-wilderness-lava-lab-test.ts` for both palettes, point-free bank lighting,
synchronous lighting comparisons, distant lighting, dry movement and blocked lava crossings.
Run `npx tsx tools/lava-stream-world-test.ts --channel widows-furnace`, then the
`veilburn-river` and `hollow-star-rift` shards, for authored streams with ordinary grounded
follow cameras and real bank movement. Each shard owns a two-minute deadline. Inspect their images under `test-results/`; they are
disposable acceptance evidence. Regenerate navigation and the map after changes to authored cuts.

The world check also exposed shader warmup proxies losing custom material defines and instance
colours. Preparation now preserves both, with a regression in `renderer-warmup.test.ts`.
