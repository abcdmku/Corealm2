# M4 creature, enemy and loot migration plan

Status: read-only architecture proposal, recorded 2026-09-13. The root agrees with the worker split and will freeze schemas after M2/M3 acceptance. No M4 code changes are authorized yet.

This plan covers PRD M4. Counts and comparisons came from reading current source and importing current content modules. No builds, game tests or world checks were run for this audit. Source comments describe earlier staging history and are not authoritative registration state.

## Runtime inventory

`ENEMIES` has 472 rows: 327 canonical combat blocks and 145 encounter aliases. The PRD's introductory phrase "472 enemy stat blocks" refers to this combined export.

| Source species export | Rows |
| --- | ---: |
| CREATURE_EXPANSION | 24 |
| STARTER_CREATURES | 7 |
| RED_WORM_SPECIES | 1 |
| REGIONAL_CREATURE_VARIANTS | 5 |
| CREATURE_REDESIGNS | 3 |
| FOREST_CREATURE_REDESIGNS | 5 |
| ASH_CREATURE_REDESIGNS | 5 |
| STONE_CREATURE_REDESIGNS | 5 |
| WILDERNESS_DRAGONS | 7 |
| WILDERNESS_CREATURE_SPECIES | 11 |
| FAIRY_CROWN_SPECIES | 12 |
| CROWNWARD_DRAGON_SPECIES | 3 |
| FAIRY_CREATURE_SPECIES | 12 |
| FAIRY_GARDEN_SPECIES | 24 |
| UNIVERSAL_MINIBOSS_SPECIES | 90 |
| **CREATURE_SPECIES aggregate** | **214** |
| RPG_BESTIARY | 21 |
| RPG_BESTIARY_STAGED | 4 |
| REGIONAL_BOSS_SPECIES | 7 |

The complete species store needs 246 unique records: 235 registered sources and 11 lab-only sources. Preserve `CREATURE_SPECIES` as its existing 214-row view. The 90 universal species share 63 distinct combat IDs. The 214 aggregate species reference 187 distinct combat IDs. Shared source combat IDs have equal values in the audited data.

Other inventory:

- The private original `BLOCKS` literal has 35 rows; `GROUP_BLOCK` has 38 pairs.
- `FANTASY_TIER_BLOCKS` has 60 rows across 15 species and four tiers.
- `FANTASY_ENCOUNTER_BLOCKS`, `FANTASY_ENCOUNTER_LINEAGE` and `BIOME_POPULATION_LEGACY_REPLACEMENTS` each have 54 entries.
- Eleven source combat IDs are absent from production `ENEMY_BLOCKS`: the four RPG staged candidates and seven `boss_*` presentation candidates.
- A canonical store including lab candidates needs 338 rows: 327 registered plus 11 lab-only.

## Proposed records and source views

The root must freeze these contracts before implementation. Keep runtime `EnemyDef` and `CreatureSpeciesDef` exports compatible. Metadata belongs to JSON record schemas and is stripped from runtime views.

### Enemy records

`EnemyRecordSchema` validates the complete strict runtime enemy shape, replacing embedded drops with required `lootTableId`. Add scalar `catalog`, `stage: registered | labOnly`, optional typed derivation, read-only `registrationOrder` for registered rows and optional read-only `fantasyTierOrder` for the separate fantasy source view. Keep `marks` with the combat block.

The runtime fields are `id`, `name`, `family`, `tier`, `maxHealth`, `attackLevel`, `defenceLevel`, `accuracy`, `armour`, `magicArmour`, `maxHit`, `attackSpeedMs`, `aggroRadius`, `behaviour`, plus optional `moveSpeedMps`, `walkSpeedMps`, `marks`, `attackStyle`, `attackRangeM` and `respawnSeconds`. Use explicit field schemas, enums and range validation. Preserve optional-field absence.

Recommended enemy source categories distinguish original blocks, creature-source blocks, RPG blocks, added fantasy tiers, Wilderness progression blocks and lab candidates. Final source precedence must be explicit in the exporter because later generated Wilderness rows replace some earlier canonical rows without changing their insertion positions. A scalar catalog alone cannot reconstruct every overlapping public view.

### Aliases

`EnemyAliasSchema` contains stable `id`, canonical `blockId`, scalar catalog, read-only `registrationOrder`, closed typed `overrides`, optional `lootTableId`, optional replacement `speciesId` and optional two-element historical `lineage`. Reject unknown override fields and alias-to-alias targets.

| Alias catalog | Rows | Base selection |
| --- | ---: | --- |
| GROUP_ALIASES | 18 | Original explicit GROUP_BLOCK target |
| FANTASY_ENCOUNTER_BLOCKS | 54 | Historical lineage's original block |
| WILDERNESS_GROUP_ALIASES | 73 | Canonical family/tier block |

All 145 aliases reconstruct from these bases. Observed sparse override fields are name, family, movement, health, attack level, defence level and max hit. Only six aliases need different loot tables. Preserve the 54 lineage pairs verbatim; they are historical saved-hunt compatibility data, and matching is directional.

### Species

`CreatureRecordSchema` contains presentation fields, `blockId`, required source `lootTableId`, scalar source catalog and stage. Reconstruct `.stats` from the block plus the species source loot table.

Use the 15 source export names in the inventory plus `RPG_BESTIARY`, `RPG_BESTIARY_STAGED` and `REGIONAL_BOSS_SPECIES` as catalogs. Preserve source-file order. `WILDERNESS_DRAGON_CANDIDATES` remains the same array as `WILDERNESS_DRAGONS`; fairy module re-exports retain their original references.

Two regional variants, `moonweave_spider` and `amethyst_spider`, retain full RPG presentation fields through object spread despite their declared `CreatureSpeciesDef` type. A strict schema based only on the declared interface would lose runtime data. Use a strict basic/extended presentation union independent of catalog. The extended form preserves `bodyFamily`, `rigFamily`, `movement`, `habitat`, `respawnMs`, `nativeSize`, `nativeBase`, `nativeVisualRadius`, `nativeBodyRadius`, `attack`, `source` and `acceptance`.

### Loot

`LootTableSchema` contains stable ID, scalar catalog, ordered drops and optional typed derivation. Each drop has an item reference, an ordered integer quantity pair, chance between 0 and 1, and optional exclusive group. Preserve drop order: `systems/equipmentCombat.ts` consumes rolls and exclusive groups in that order.

A conservative owner-specific export has 362 tables: 338 block tables, 18 species source alternatives and six alias alternatives. The audited data has only 115 structurally distinct drop arrays, but deduplicating by value would couple unrelated future edits. Prefer stable owner IDs and intentional references. This is a proposed export quantity, not an already written artifact.

## Parity and identity hazards

### Source loot differs from canonical loot

All 18 Wilderness and dragon source species have drops that differ from their same-ID final canonical enemies. Every other runtime field matches. Preserve species-level `lootTableId`; reconstructing source species directly from canonical rows would change public exports. Eleven Wilderness body sources intentionally have empty drops. The seven dragon sources have their own source drops.

### Registration order is interleaved

The current 472-row `ENEMIES` order is:

1. 288 canonical records.
2. 72 ordinary and fantasy aliases.
3. 39 additional Wilderness canonical records.
4. 73 Wilderness aliases.

Assign original read-only registration ordinals and merge registered blocks plus resolved aliases by ordinal. Concatenating all canonical rows and then aliases changes behavior-visible order. `ENEMY_BLOCKS` equals the canonical-filtered `ENEMIES` order.

`FANTASY_TIER_BLOCKS` is not in canonical-filter order. Its 60 rows match canonical values exactly but need a separate view order. Recommended implementation is a read-only `fantasyTierOrder` ordinal on those records. An explicit ordered source-view index is an alternative if the root prefers it. `UNIVERSAL_MINIBOSS_ENEMIES` has 63 rows and is a canonical subsequence.

Existing map construction uses last value with first insertion position. The exporter must reproduce that precedence before writing JSON rather than sorting IDs or silently rejecting intentional source overlaps.

### Feature-lab registration

The relevant boot code is `game/src/app/boot.ts`, not `game/src/boot.ts`. It currently registers production rows, appends four RPG staged candidates, then appends seven regional boss candidates and rewrites 18 Wilderness canonical rows with `wildernessDrops()`.

Read-only comparison confirmed all 18 boot rewrites exactly equal the already registered production canonical rows. The migration can retain those production rows and append only the 11 lab-only blocks, in the existing staged-before-boss order. Stage comes from actual registration membership, not comments or candidate-named exports. The feature-lab review catalog intentionally includes registered sources as well as lab-only ones; preserve its preset aliases and lookup behavior.

### Save and world contracts

Preserve species IDs, combat block IDs, group aliases, family/tier fallback IDs, saved lineage and order. `enemyBlockFor` first accepts a matching-family group alias, then falls back to the family/tier block, then the group. Preserve that lookup behavior.

World entities carry `enemyDefId`, family, group identity and tier. Hunt state calls `huntEnemyDefMatches`; creature habitats pin `speciesId` and `enemyDefId`. M4 must not alter M6 spawn count, `legacyCount`, placement order, actor IDs or formation data. Root performs the required world revision rebuild and shipped-artifact checks after integration.

## Loader direction and public helpers

Keep dependencies directed as follows:

`lootData -> enemyData -> creatureData -> source-view modules`

This notation means each module to the right may read modules to its left. `enemyData` must not import creature source modules, regions, Wilderness placements or runtime functions from `index.ts`. It reads normalized records and loot directly. `biomePopulation.ts` can project its 54 replacement entries from alias records without importing `enemies.ts`.

This removes the current enemy initialization dependency on species, Wilderness groups and biome population resolution. `regionalPacks.ts` already reads `ENEMY_BLOCKS`; keep it downstream. Balance code stays pure and receives dependencies explicitly rather than importing loaders, registries or JSON.

Preserve these public callable helpers, even after source arrays become JSON views:

- `enemyIdFor`, `enemyBlockFor`, `huntEnemyDefMatches`.
- `universalMinibossSpecies`, used by `world/universalMinibossSpawns.ts`.
- `rpgBestiaryLevel`, including its on-demand lookup behavior.
- `crownwardDragonGroup` and `resolveCrownwardDragonEncounters`.
- `buildWildernessEnemyProgression`, `wildernessEnemyLevelAt` and `wildernessStructureLootForGroup`.
- `tuneEnemyCombatLevel`.
- `wildernessDrops`, `bossArmorDrops` and `regionalFabricDrops`.

Wrappers can delegate to parameter-based pure functions or JSON lookups. Do not remove exported functions merely because migrated authored arrays no longer invoke them. World builders, focused tests, feature-lab consumers and tools still call them. Preserve `ORDRUN_PHASES`, body/form exports, source maps, reserved asset sets and roster constants as well.

## Pure parameter extraction

Extract exact existing formulas in bounded families. Never infer inputs by inverting the final outputs or use a target record as its own formula baseline.

`game/src/content/balance/enemies.ts` should own combat level, combat tuning, marks, fantasy scaling and Wilderness depth progression. `game/src/content/balance/loot.ts` should own boss armor, regional fabric, Wilderness ordinary/keeper/structure drops, RPG role loot, fairy/crown loot and universal jewelry rolls.

Expand the existing `game/content/data/balance/enemies.json` and `loot.json` under root-controlled schema ownership. They already contain some arithmetic constants but not all generator inputs.

Enemy parameters must include:

- Exact combat-level weights, roll offsets and health constants; tuning clamps, exponent, search bounds, growth and iteration count. Preserve the existing rounding sequence and health correction.
- Authored source templates and input rows for RPG roles, starter species, fairy and garden templates, Wilderness bodies, universal guardians and regional boss sources. Target levels and original source stats remain independent from outputs.
- Fantasy target tiers, proportional scaling and per-field minimums. Retain the native-tier identity fast path where observable.
- Wilderness depth boundaries, band floors and ceilings, progression increments, keeper rules, mark scaling minima and fallback tier order. Preserve family/group sorting, earliest-depth representative selection, matching asset preference and keeper-family exceptions.
- Regional boss targets and Ordrun phase ratios, cadence and telegraph parameters.
- Species-specific mark profiles. Existing sources differ: original ordinary/purse, expansion, RPG, fairy, universal and Wilderness ranges must not be collapsed to one multiplier.

Loot parameters must include:

- Material classification and explicit stone-species membership, deep-tier threshold, rune mappings, keeper and structure component maps.
- Every ordered probability/quantity row, including source-family exceptions and crown-hart venison.
- Boss armor's ordered eligible piece list and expected-piece budget. Its probability divides the budget by actual eligible piece count; preserve independent rolls.
- Regional hide/fabric references and ordinary/boss quantity profiles.
- Universal jewelry's exclusive group and split chance.

Tag only records whose original generator inputs have been extracted and recompute exactly. Loader reads must never silently retune authored records after a parameter edit. Permanent derivation checks report drift; recompute previews are explicit.

## Proposed worker ownership

Only the root freezes shared contracts and authorizes implementation. Workers do not overlap files.

| Owner | Files and responsibilities |
| --- | --- |
| Root | Shared schemas/contracts, collection registry, `index.ts`, `app/boot.ts`, feature-lab integration, parameter-schema coordination, docs, combined checks and world rebuild |
| Enemy worker | `enemyData.ts`, `enemies.ts`, `enemies.json`, `enemyAliases.json`, alias portion of `biomePopulation.ts`, `encounterBalance.ts`, `wildernessEnemyProgression.ts`, `balance/enemies.ts`, enemy exporter and focused tests |
| Species worker | `creatureData.ts`, `creatures.json`, `creatureSpecies.ts`, all 15 source modules, `rpgBestiary.ts`, `regionalBossBodies.ts`, species exporter and focused tests |
| Loot worker | `lootData.ts`, `lootTables.json`, `balance/loot.ts`, loot helpers in `wildernessLoot.ts`, `bossArmor.ts`, `regionalTierEquipment.ts`, loot exporter and focused tests |

Schema files can be assigned to individual workers after the root freezes their definitions. All edits to shared balance parameter JSON and schema files require one explicit owner. The species worker retains public forms and encounter helpers but does not migrate M6 placements. The enemy worker changes only the alias portion of biome population. The loot worker leaves migrated items, recipes and sets unchanged.

## Implementation and acceptance sequence

1. Root freezes runtime/record schemas, catalog values, ordering fields, references and helper signatures.
2. Capture a baseline export with source provenance and exact map precedence. Exporters default to dry-run and validate every source view before writing.
3. Build loot and canonical enemy loaders, then creature views and alias resolution. Integrate in short rounds so imports remain runnable.
4. Prove all named exports against the baseline before switching boot registration. Verify extended RPG fields and same-ID source-loot alternatives explicitly.
5. Extract parameter families and tag only exact derivations. Keep legacy helper signatures as wrappers.
6. Root switches feature-lab registration, runs combined gates and performs M4 world rebuild acceptance.

Required parity coverage includes all 472 resolved enemies in order, 327 canonical blocks, 60 fantasy rows in their separate order, 54 lineage entries, 246 source species and every named array/map/set/helper export affected by the migration. Compare the feature-lab registered enemy table before and after, including the 11 additions. Add seeded loot-roll checks for ordered independent and exclusive-group rolls.

Workers run focused tests only. Root runs typecheck, whole tests, content checks, browser semantic-state checks, world rebuild and the PRD's shipped-world/navigation artifact checks. Source parity alone is not gameplay proof.
