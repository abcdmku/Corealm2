# Corealm content store

The JSON migration is in progress. Shops, NPCs, quests, dialogue, spells, and audio now load from
`data/` through schemas in `game/src/content/schema/`. Their existing TypeScript exports remain
available. Items, recipes, creatures, and world placement still use their TypeScript tables.
Balance JSON currently holds checked parameter snapshots; production formulas are not migrated yet.
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
Derivation and spawn formation checks will join it when those records migrate.

`npm run content:export` previews the leaf-table migration; `-- --apply` replaces leaf JSON from
the saved `.baseline` TypeScript snapshot. Do not rerun it over authored edits.
`npm run content:baseline` creates that snapshot from HEAD only if it does not already exist.

`npm run devdocs:requests -- --help` documents the request CLI. Agents may open, claim and reply
to requests. Claim and reply require the revision returned by listing. They cannot close requests
or approve assets.

After changing `data/`, run `npm run world:build` when spawns, clusters or habitats changed: the
shipped world manifest pins the content revision.
