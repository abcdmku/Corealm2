# Lava streams

The organic-path revision replaces the repeated S-shaped routes, pale continuous rims,
and flat polygon crowns. The original dark cellular lava, emissive cracks, slow motion,
and invisible bank lights remain.

## Authored routes

- Widow's Furnace crosses unequal constrictions before spreading into an irregular receiving
  reach. Its thin southern seep joins through a separate depression.
- Chainfire has a narrow overflow arm that leaves the trunk and rejoins downstream around
  a rock island, instead of another tributary attached to a curved trunk.
- Veilburn alternates short bends, confined reaches, and wider hollows. Its tributary joins
  upstream instead of running beside the lower river.
- Hollow Star's tributary joins the middle reach in the downstream direction. The former
  long parallel U-shaped fork is gone.

Authored widths and grades in `wildernessLava.ts` drive the shared terrain, molten meshes,
collision capsules, scatter clearance, and navigation. World-space noise adds restrained shore
irregularity without repeating sine-wave bulges. Each bank has its own width, bounded by the
reserved footprint. The bed uses a continuous cross-section without identical stepped shelves.

## Banks and surrounding ground

Weathered rock bodies raise the actual terrain with broad, sloping shoulders and uneven relief.
They retain the surrounding terrain material. Separate polygon-top meshes no longer outline
each body in pale stone. Ordinary biome scatter follows those shoulders outside the reserved
channel, rather than leaving a circular clearing around every body.

Dark textured bank meshes fade into the terrain at their outer edge. They have no repeated
raised ledge waves, continuous secondary apron, or regularly spaced bank rocks. Adaptive
subdivision follows the production terrain triangles and prevents ground showing through the
bank coating. Refined bank triangles remain outside adjoining molten channels.

`lavaSurface.ts` keeps a separate liquid grade above the submerged bed. `lavaTextureFlow.ts`
transports one dark crust pattern along fixed flow coordinates. A tributary aligns at its
receiving shore; a split-and-rejoin arm aligns at both mouths. This prevents time-dependent
stretching and keeps the current directed downstream through the network.

Four invisible rectangular area lights illuminate the banks and nearby models. They remain
eligible through 220 metres and fade over the last 60 metres. Lava has no point lights, repeated
spark/smoke sources, extra bright centre stripe, or duplicate luminous surface. Torches retain
their existing lights.

## Acceptance and generation

The production deep-lava fixture exercises natural banks, weathered shoulders, both palettes,
and a separate split-and-rejoin network. Its browser check compares bank lighting on and off,
tests distant lighting, walks on dry ground, and stops at molten ground. Its screenshots use
ordinary grounded follow cameras.

Authored routes, world terrain and scatter use the world-authoring exception because their
relationship to roads and structures cannot be established in the compact yard. The terrain
survey verifies descending beds and unchanged road centre lines. Focused tests check protected
structure/resource footprints, downstream transport, wet-channel clearance and terrain contact.

Run `npx tsx tools/deep-wilderness-lava-lab-test.ts`, then
`npx tsx tools/lava-stream-world-test.ts --channel <id>` for `widows-furnace`, `chainfire-rill`,
`veilburn-river`, and `hollow-star-rift`. The optional `--map-preview` uses the production map
capture API for planform evidence, separately from the gameplay-camera screenshots.
Regenerate navigation and the complete world map after terrain edits. Screenshots and browser
reports under `test-results/` are disposable.

The [geological research report](lava-landform-research.md) records the reasoning and sources.
