# Fairy terrain and creatures

Status: approved scope through the user's September 12, 2026 implementation directive. Target regions are Gloamgarden T30 and Faeholme T60, confirmed by the user switching to the fairy branch.

- Replace the village's broad flat presentation with individual buildable clearings backed by raised, planted banks. Preserve functional doors, banks, stations, quest identities and the existing shortcuts.
- Author larger raised combat grounds. Each has one or two narrow traversable approaches. Slopes outside those approaches must block direct walking and route navigation.
- Use the supplied reference images for mossed rock, low winding paths, layered purple foliage and houses fitted against terrain.
- Import locally supplied Fairy NPC and monster sources with reproducible scripts and provenance. Fairy NPCs use small Paragon Fey variants with real source animation.
- Use the 30 Monster Stylized Fantasy Vol 01 creatures for ordinary fairy encounters. Reserve frightening larger monsters for stronger encounters.
- Register Fantasy Monster 01 through 09 as reusable miniboss species across world regions. Each drops standard jewellery and has a rare unique jewellery roll. Unique items combine defence, vitality and melee or magic power. Respawn after 1,800 seconds; reset starts a fresh encounter state.
- Build reusable assets and gameplay in the production feature lab before final placement. Record browser actions, state changes, errors and normal player-camera screenshots.
- World terrain, authored paths, settlement placement and regional scatter use the world-authoring exception because their spatial relationships are the behavior under test. The exception does not cover assets, actor animation, loot or timer behavior.

Acceptance includes focused terrain/navigation and loot/timer tests, asset and NPC lab inspection, a real final-world traversal check, build/typecheck, relevant regression tests and screenshot review. Do not report unproved asset or world work as accepted.
