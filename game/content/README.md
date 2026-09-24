# Corealm content store

Items, equipment sets, recipes, resources, gathering and crafting tiers, campfire fuels, shops,
NPCs, quests, dialogue, spells, audio, enemies, species and loot load from `data/` through schemas in
`game/src/content/schema/`. Their existing TypeScript exports remain available. World placement
still uses TypeScript tables while its migration continues. Pure item, recipe,
jewelry, set, and campfire formulas read explicit balance parameters.
See `runs/devdocs/PRD.md` for the full app plan. Git records authored changes.

## Layout

```
data/      shipped. Hashed into the world revision. Imported by loaders under game/src.
  items.json equipmentSets.json recipes.json resources.json gatheringTiers.json craftingTiers.json
  enemies.json enemyAliases.json lootTables.json creatures.json
  spawns/<regionId>.json  resourceClusters.json  regionalPacks.json
  npcs.json shops.json quests.json dialogue.json spells.json spellRunes.json audio/catalog.json
  balance/*.json          every constant a formula reads
meta/      dev-only. NOT hashed, NOT importable from game/src (tests/content-meta-isolation.test.ts).
  <collection>.meta.json  status, notes, requests, candidates, history, keyed by record id
  assets.meta.json icons.meta.json audio-sources.json
```

The rule: if a loader reads it, it is data. If only humans or the app read it, it is meta.

## Format

- Two-space indent, LF, trailing newline, keys in schema order. Never hand-format; run
  `npm run content:format` or let the app write.
- One file per collection. Spawns shard per region. The canonical writer keeps a one-record edit a
  one-record diff.
- Records may carry extras the runtime never sees: `catalog` (which sub-table the row came from, so
  `EQUIPMENT`, `REGIONAL_TIER_ITEMS`, ... remain filtered views), `derivation` (the record is
  formula-locked: `tests/content-derivation.test.ts` recomputes it from `balance/*.json` and fails
  on drift; delete the tag to hand-tune), `ladder`, `lootTableId`, `blockId`, `speciesId`, `stage`,
  spawn `authored` / `legacyOverride` / `derived` / `source`. Loaders strip them.
- Ids, `count`, `legacyCount` and spawn record order are save identity. `content:check` diffs them
  against HEAD and refuses without `--allow-identity-change`; the app shows them read-only.

## Checks

`npm run content:check` validates every registered JSON schema, canonical formatting, metadata,
references, existing production cross-table checks, and save identity against HEAD for migrated
arrays. It rejects unregistered JSON files. It is part of `check` and `check:fast`.
Tagged records are recomputed during the check and rejected if their stored fields have drifted.
Spawn formation checks will join it when placements migrate.

The enemy store separates 338 canonical blocks, 145 encounter aliases, 246 species, and 362
owner-specific loot tables. Production registration contains 327 blocks plus 145 aliases; the
other 11 blocks remain lab-only. Alias order, fantasy order, stages, canonical links and loot
ownership are checked against the same parsed snapshot in the app and CLI. Four original staged
RPG species still reference unpromoted model IDs; missing lab-only models are reported as
warnings. A missing model on a registered species remains a blocking reference error.

`npm run devdocs:requests -- --help` documents the request CLI. Agents may open, claim and reply
to requests. Claim and reply require the revision returned by listing. They cannot close requests
or approve assets.

The local editor runs with `npm run devdocs`. Saves validate current JSON and file revisions;
stale drafts remain visible until you reset them. Formula changes do not rewrite stored records.
Preview their recompute diff before applying it. Notes and requests are stored separately in `meta/`.

After changing shipped `data/`, run `npm run world:build`: the
shipped world manifest pins the content revision.
