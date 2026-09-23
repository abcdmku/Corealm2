# Creature population source

Production encounters are authored in `game/content/data/creatureDefinitions.json`,
`encounters.json` and `placements.json`. The content compiler resolves those rows into
`game/content/compiled/catalog.json`; `worldData.ts`, `regions.ts` and `worldHabitats.ts`
expose the compiled groups and habitats to the game.

The old TypeScript `BIOME_POPULATION` table, fantasy replacement map and
`tools/biome-population-audit.ts` have been retired. Their counts, species assignments and
placement screenshots described an earlier world and are not current authoring data.

Use `tests/biome-population.test.ts` for compiled population projection, body clearance,
starter-area exclusion and lava clearance. `tests/regional-pack-exclusions.test.ts` checks
compiled population habitats against activated regional packs and world reservations.
`tools/biome-creatures-world-test.ts` checks the live production roster and interactions on
hardware; its expected groups and species come from the compiled world tables.

Tier 1 wild encounters use small, simple, animal-like bodies with restrained fantasy detail.
Farm livestock and road bandits retain their distinct world roles. Larger or intricate
creatures begin at tier 10. Tiers 10–20 mix ordinary wildlife with aggressive fantasy
creatures; tier 40 keeps ordinary fauna alongside more complex aggressive threats.
Placement IDs and habitat centers stay stable when an inherited creature body changes.
