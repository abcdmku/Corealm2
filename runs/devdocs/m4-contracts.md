# M4 schema and loader contract

Status: frozen and implemented by root, 2026-09-13. This document supplements [m4-plan.md](./m4-plan.md). The normalized JSON slice preserves original runtime values and order. Acceptance is recorded in progress.md; formula extraction proceeds separately.

Snippet verification: the schema code blocks below were transpiled and evaluated in memory against the existing core combinators. `EnemySchema` accepted all 718 enemy observations and `CreatureRuntimeSchema` accepted all 246 complete source species. This checks the actual proposed runtime shapes; record joins and order constraints still require the future exporter and focused tests.

## Exact inventory

The store must represent 246 distinct species, 338 distinct canonical combat IDs and 145 distinct encounter alias IDs. Production exports remain 214 `CREATURE_SPECIES`, 327 `ENEMY_BLOCKS` and 472 `ENEMIES`; the other 11 canonical IDs are lab-only. The union of all enemy IDs is 483. Do not interpret the PRD's 472 figure as canonical blocks.

| File | Proposed rows | Identity |
| --- | ---: | --- |
| `lootTables.json` | 362 | Stable owner-derived `id` |
| `enemies.json` | 338 | Existing canonical `id` |
| `enemyAliases.json` | 145 | Existing group/encounter `id` |
| `creatures.json` | 246 | Existing species `id` |

There are 219 basic species and 27 extended RPG species. The extended count is 21 `RPG_BESTIARY`, four `RPG_BESTIARY_STAGED`, and two `REGIONAL_CREATURE_VARIANTS`: `moonweave_spider` and `amethyst_spider`. Those two keep the full RPG shape through object spread despite their declared basic interface. Catalog must not determine shape.

The field audit covered all 472 production enemies and all 246 source `.stats` objects (718 observations, 483 distinct IDs). It found no extra enemy fields, no own properties with `undefined`, no empty required strings, and no alias that deletes an inherited field. Keep absence distinct from an explicit value; do not add defaults, nulls or optional keys holding `undefined`.

## Strict runtime schemas

Suggested files are `schema/enemies.ts`, `schema/loot.ts` and `schema/creatures.ts`. All snippets use the existing `schema/core.ts` combinators. `obj` is strict by default. No `unknown()`, permissive object, arbitrary metadata dictionary or cast of an incomplete object to a runtime contract is needed.

These snippets define the complete field sets. Labels/help can be added without changing the contract. `EnemyDef` remains a type-only import from `index.ts`; schema modules must not import runtime `index.ts`, content loaders or JSON.

```ts
import {
  arr, enumOf, id, int, lit, num, obj, opt, ref, refine,
  str, tuple, union, type Infer, type Schema,
} from './core.js';
import type { EnemyDef } from '../index.js';

const nonempty = () => str({ nonEmpty: true });
const positive = () => num({ exclusiveMin: 0 });
const IdentityMeta = { readOnly: true, identity: true } as const;
const OrderSchema = int({ min: 0 }, IdentityMeta);

// EnemyDef uses mutable pairs. The explicit tuple generic preserves assignability.
// Do not reuse core.intRange, whose inferred pair is readonly.
const QuantityRangeSchema = refine(
  tuple<[Schema<number>, Schema<number>]>([int({ min: 1 }), int({ min: 1 })]),
  ([low, high]) => low <= high, 'quantity minimum must not exceed maximum',
);
const MarksRangeSchema = refine(
  tuple<[Schema<number>, Schema<number>]>([int({ min: 0 }), int({ min: 0 })]),
  ([low, high]) => low <= high, 'marks minimum must not exceed maximum',
);
export const DropSchema = obj({
  itemId: ref('item'),
  quantity: QuantityRangeSchema,
  chance: num({ min: 0, max: 1 }),
  exclusiveGroup: opt(nonempty()),
});

export const EnemyFields = {
  id: id(),
  name: nonempty(),
  family: ref('enemyFamily'),
  tier: int({ min: 1 }),
  maxHealth: int({ min: 1 }),
  attackLevel: int({ min: 1 }),
  defenceLevel: int({ min: 1 }),
  accuracy: int({ min: 0 }),
  armour: int({ min: 0 }),
  magicArmour: int({ min: 0 }),
  maxHit: int({ min: 1 }),
  attackSpeedMs: int({ min: 1 }, { unit: 'ms' }),
  aggroRadius: num({ min: 0 }, { unit: 'm' }),
  behaviour: enumOf(['passive', 'aggressive', 'territorial'] as const),
  moveSpeedMps: opt(num({ exclusiveMin: 0 }, { unit: 'm/s' })),
  walkSpeedMps: opt(num({ exclusiveMin: 0 }, { unit: 'm/s' })),
  marks: opt(MarksRangeSchema),
  attackStyle: opt(enumOf(['melee', 'ranged', 'magic'] as const)),
  attackRangeM: opt(num({ exclusiveMin: 0 }, { unit: 'm' })),
  respawnSeconds: opt(num({ min: 0 }, { unit: 's' })),
};
export const EnemySchema = obj({
  ...EnemyFields,
  drops: arr(DropSchema),
}) satisfies Schema<EnemyDef>;
```

The numerical bounds above express basic domain constraints, not tuning caps. Current `maxHealth` reaches down to 2, so a minimum of 3 would reject existing data. `magicArmour` reaches 130; the tuning helper's 80 cap cannot be a schema maximum. Marks include zero. Movement and attack ranges contain fractional values. Every number combinator already rejects nonfinite numbers. `exclusiveGroup` currently only contains `jewelry`, but is intentionally an open nonempty identifier, not that single-value enum. Empty drops are valid.

All 327 registered canonical blocks currently have marks and both movement speeds. Only 220 have `attackStyle`, 221 have `attackRangeM`, and 63 have `respawnSeconds`. These remain optional to match `EnemyDef` and preserve fallback behavior; the current presence of movement is not a reason to make it required.

## Catalogs and canonical precedence

These are exclusive primary catalogs, not arbitrary user tags. They are readonly migration provenance. Use their exact strings in record schemas, exporters and view functions.

```ts
export const REGISTERED_ENEMY_CATALOGS = [
  'LEGACY_BLOCKS', 'CREATURE_SPECIES_BLOCKS', 'RPG_BESTIARY_BLOCKS',
  'FANTASY_TIER_BLOCKS', 'WILDERNESS_BLOCKS',
] as const;
export const LAB_ENEMY_CATALOGS = [
  'RPG_BESTIARY_STAGED_BLOCKS', 'REGIONAL_BOSS_BLOCKS',
] as const;
export const ENEMY_CATALOGS = [
  ...REGISTERED_ENEMY_CATALOGS, ...LAB_ENEMY_CATALOGS,
] as const;
export const ALIAS_CATALOGS = [
  'GROUP_ALIASES', 'FANTASY_ENCOUNTER_BLOCKS', 'WILDERNESS_GROUP_ALIASES',
] as const;
export const CREATURE_CATALOGS = [
  'CREATURE_EXPANSION', 'STARTER_CREATURES', 'RED_WORM_SPECIES',
  'REGIONAL_CREATURE_VARIANTS', 'CREATURE_REDESIGNS',
  'FOREST_CREATURE_REDESIGNS', 'ASH_CREATURE_REDESIGNS', 'STONE_CREATURE_REDESIGNS',
  'WILDERNESS_DRAGONS', 'WILDERNESS_CREATURE_SPECIES', 'FAIRY_CROWN_SPECIES',
  'CROWNWARD_DRAGON_SPECIES', 'FAIRY_CREATURE_SPECIES', 'FAIRY_GARDEN_SPECIES',
  'UNIVERSAL_MINIBOSS_SPECIES', 'RPG_BESTIARY', 'RPG_BESTIARY_STAGED',
  'REGIONAL_BOSS_SPECIES',
] as const;
export const LOOT_CATALOGS = [
  'ENEMY_BLOCK_LOOT', 'CREATURE_SOURCE_LOOT', 'ENEMY_ALIAS_LOOT',
] as const;
```

| Canonical enemy catalog | Rows | Meaning |
| --- | ---: | --- |
| LEGACY_BLOCKS | 35 | Original blocks, including their original regional-boss tuning |
| CREATURE_SPECIES_BLOCKS | 169 | Native source stats retained by the final canonical map |
| RPG_BESTIARY_BLOCKS | 21 | Registered RPG source stats |
| FANTASY_TIER_BLOCKS | 45 | Added nonnative tiers only |
| WILDERNESS_BLOCKS | 57 | 39 added IDs plus 18 final overwrites |
| RPG_BESTIARY_STAGED_BLOCKS | 4 | Lab-only RPG stats |
| REGIONAL_BOSS_BLOCKS | 7 | Lab-only `boss_*` body stats; distinct from tuned legacy boss IDs |

Replay original assembly to establish provenance: tuned original blocks, aggregate species stats, RPG stats, fantasy tiers, then Wilderness progression. JavaScript Map keeps the first insertion position and last assigned value. Wilderness wins its 18 overlaps. Native fantasy rows belong to creature source provenance, while their extra fantasy membership is represented independently. Never classify a row by finding an arbitrary equal-valued source.

Species catalogs, in the order listed above, have counts `24,7,1,5,3,5,5,5,7,11,12,3,12,24,90,21,4,7`. Their first 15 catalogs reconstruct `CREATURE_SPECIES` in order. Alias catalogs have counts `18,54,73`. Loot catalogs have counts `338,18,6` under the owner convention below.

## Enemy records, order and aliases

The JSON enemy shape substitutes a required loot reference for `.drops`. A strict stage union prevents accidental production registration of a lab row and preserves absence of inapplicable order fields.

```ts
const EnemyRecordFields = {
  ...EnemyFields,
  lootTableId: ref('lootTable'),
};
const RegisteredEnemyRecordSchema = obj({
  ...EnemyRecordFields,
  catalog: enumOf(REGISTERED_ENEMY_CATALOGS, IdentityMeta),
  stage: lit('registered', IdentityMeta),
  registrationOrder: OrderSchema,
  fantasyTierOrder: opt(OrderSchema),
});
const LabEnemyRecordSchema = obj({
  ...EnemyRecordFields,
  catalog: enumOf(LAB_ENEMY_CATALOGS, IdentityMeta),
  stage: lit('labOnly', IdentityMeta),
  labOrder: OrderSchema,
});
export const EnemyRecordSchema = union([
  RegisteredEnemyRecordSchema, LabEnemyRecordSchema,
] as const);
export type EnemyRecord = Infer<typeof EnemyRecordSchema>;

// Closed partial EnemyDef excluding id and drops. List the fields explicitly;
// do not widen them through Object.fromEntries or Record<string, Schema>.
export const EnemyOverridesSchema = obj({
  name: opt(EnemyFields.name), family: opt(EnemyFields.family),
  tier: opt(EnemyFields.tier), maxHealth: opt(EnemyFields.maxHealth),
  attackLevel: opt(EnemyFields.attackLevel), defenceLevel: opt(EnemyFields.defenceLevel),
  accuracy: opt(EnemyFields.accuracy), armour: opt(EnemyFields.armour),
  magicArmour: opt(EnemyFields.magicArmour), maxHit: opt(EnemyFields.maxHit),
  attackSpeedMs: opt(EnemyFields.attackSpeedMs), aggroRadius: opt(EnemyFields.aggroRadius),
  behaviour: opt(EnemyFields.behaviour),
  moveSpeedMps: EnemyFields.moveSpeedMps, walkSpeedMps: EnemyFields.walkSpeedMps,
  marks: EnemyFields.marks, attackStyle: EnemyFields.attackStyle,
  attackRangeM: EnemyFields.attackRangeM, respawnSeconds: EnemyFields.respawnSeconds,
});
const AliasFields = {
  id: id(),
  blockId: ref('enemy', IdentityMeta),
  registrationOrder: OrderSchema,
  overrides: EnemyOverridesSchema,
  lootTableId: opt(ref('lootTable')),
};
export const EnemyAliasSchema = union([
  obj({
    ...AliasFields,
    catalog: enumOf(['GROUP_ALIASES', 'WILDERNESS_GROUP_ALIASES'] as const, IdentityMeta),
  }),
  obj({
    ...AliasFields,
    catalog: lit('FANTASY_ENCOUNTER_BLOCKS', IdentityMeta),
    speciesId: ref('species'),
    lineage: tuple([
      ref('enemy', IdentityMeta), ref('enemy', IdentityMeta),
    ] as const, IdentityMeta),
  }),
] as const);
export type EnemyAlias = Infer<typeof EnemyAliasSchema>;
```

`blockId` is a canonical-only reference, never another alias. Resolve aliases once as `{ ...base, ...overrides, id, drops }`, choosing referenced drops only when an alias has its own `lootTableId`; otherwise retain base drops. Never spread record metadata into runtime output. An empty overrides object is valid. Current overrides differ in name (54), family (54), move speed (48), walk speed (45), health (65), attack level (64), defence level (64), and max hit (54). No unset mechanism is needed: every inherited defined key remains defined in its alias. A future request to remove an inherited optional key needs an explicit contract revision, not `null` or implicit deletion.

Base selection is exact: plain group aliases use original `GROUP_BLOCK` targets; fantasy aliases use `lineage[0]`; Wilderness aliases use canonical family/tier. The 54 lineage pairs preserve historical direction and both strings verbatim, including pairs with equal elements. All current targets exist; do not rewrite historical lineage when a roster changes. `speciesId` exists only on the fantasy branch and reconstructs the 54 biome replacement entries.

Store canonical records in `ENEMY_BLOCKS` order, then append the 11 lab rows. Store aliases in their current relative `ENEMIES` order. Global `registrationOrder` values must be unique across registered blocks and aliases and cover `0..471` exactly. Merge and sort by that field for `ENEMY_DATA`, never by ID or catalog. The current segments are 288 canonical rows, 72 aliases, 39 new canonical rows, and 73 aliases.

Exactly 60 registered blocks have `fantasyTierOrder`, covering `0..59`. This reconstructs the distinct `FANTASY_TIER_BLOCKS` order: 15 native rows plus 45 added tiers. Filtering only its primary catalog returns 45 and is incorrect. The universal miniboss source view has 63 distinct enemy IDs and already follows canonical subsequence order; it needs no additional ordinal.

All current canonical IDs equal `${family}_t${tier}`. IDs remain immutable save identities. Do not automatically rename an ID when editing family/tier. Root should decide whether identity relationship checks reject such edits or require an explicit identity migration; either way, silent rekeying is prohibited.

## Loot identity and source differences

Allocate one table for each canonical block, including empty drops. Add source-specific tables only for the 18 audited species whose drops differ from their final canonical block, and alias-specific tables only for six differing aliases. Do not deduplicate equal arrays by value: the 362 proposed owner tables have only 115 distinct arrays today, but unrelated future edits must remain independent.

```ts
const LootFields = { id: id(), drops: arr(DropSchema) };
const LootTableObjectSchema = union([
  obj({ ...LootFields, catalog: lit('ENEMY_BLOCK_LOOT', IdentityMeta),
    ownerId: ref('enemy', IdentityMeta) }),
  obj({ ...LootFields, catalog: lit('CREATURE_SOURCE_LOOT', IdentityMeta),
    ownerId: ref('species', IdentityMeta) }),
  obj({ ...LootFields, catalog: lit('ENEMY_ALIAS_LOOT', IdentityMeta),
    ownerId: ref('enemy', IdentityMeta) }),
] as const);
export const LootTableSchema = refine(LootTableObjectSchema, row => {
  const prefix = row.catalog === 'ENEMY_BLOCK_LOOT' ? 'loot_enemy_'
    : row.catalog === 'CREATURE_SOURCE_LOOT' ? 'loot_species_' : 'loot_alias_';
  return row.id === prefix + row.ownerId;
}, 'loot table id must match its stable owner');
export type LootTableRecord = Infer<typeof LootTableSchema>;
```

Examples: `loot_enemy_rat_t1`, `loot_species_cinderback_crag`, and `loot_alias_cinder_chain_foundry_west_conclave`. These are proposed new IDs, not renames of existing gameplay IDs. Preserve the owner prefix exactly and retain all quantity endpoints, probabilities, exclusive groups and drop order. Currency remains `EnemyRecord.marks`; a loot editor can display it by joining the owner, without storing a second copy.

The 18 source alternatives are all seven `WILDERNESS_DRAGONS` and all 11 `WILDERNESS_CREATURE_SPECIES`. Their canonical differences are drops only. Dragon source IDs: `baby_red_dragon`, `baby_black_dragon`, `baby_lava_dragon`, `red_wilderness_dragon`, `black_wilderness_dragon`, `purple_wilderness_dragon`, `amethyst_dragon`. Body source IDs: `cinderback_crag`, `furnace_grazer`, `basalt_maw`, `rift_carapace`, `voidstone_colossus`, `gloam_wraith`, `ashseal_warden`, `furnace_regent`, `chainbound_archon`, `nightforge_marshal`, `hollow_star`. The 11 body source tables are empty; the seven dragon source tables are not. `red_worm` also has empty source drops but needs no alternative because its canonical drops match.

The six alias owners are `cinder_chain_foundry_west_conclave`, `cinder_chain_foundry_east_conclave`, `nightforge_bastion_west_conclave`, `nightforge_bastion_east_conclave`, `hollow_star_sanctum_west_conclave`, and `hollow_star_sanctum_east_conclave`.

Every creature record has a required `lootTableId`: reference its canonical block's owner table except for these 18 source alternatives. This is intentional source provenance, not duplicated inline drops. Ordinary aliases omit `lootTableId` to inherit their canonical table; six aliases explicitly reference their own table.

## Complete basic and RPG species schemas

Use JSON-only `presentationKind` to discriminate the complete strict branches. Strip it when producing runtime species. All extended fields occur together on all 27 extended rows. Their `acceptance: 'candidate'` is existing provenance even on registered rows; it is not the stage or permission to place a creature in the world.

```ts
const REGION_IDS = [
  'fallowmarch', 'vellenwood', 'karrowmoor', 'kilnhalt', 'wilderness',
  'gravelmaw', 'crownward', 'gloamgarden', 'faeholme',
] as const;
const SpeciesFields = {
  id: id(),
  assetId: ref('asset'),
  scale: positive(),
  regionId: enumOf(REGION_IDS, { ref: 'region' }),
  activity: enumOf(['graze', 'forage', 'prowl', 'patrol'] as const),
  description: str({ nonEmpty: true }, { multiline: true }),
};
const RpgFields = {
  bodyFamily: enumOf([
    'goblin', 'orc', 'skeleton', 'zombie', 'wraith', 'golem', 'harpy',
    'gargoyle', 'gnoll', 'lizardman', 'minotaur', 'demon', 'spider', 'wasp',
    'forest_creature', 'elemental', 'roach', 'troll', 'rat',
  ] as const),
  rigFamily: nonempty(),
  movement: enumOf(['biped', 'hover', 'arthropod', 'flying', 'quadruped'] as const),
  habitat: nonempty(),
  respawnMs: int({ min: 0 }, { unit: 'ms' }),
  nativeSize: tuple([positive(), positive(), positive()] as const),
  nativeBase: tuple([num(), num(), num()] as const),
  nativeVisualRadius: positive(),
  nativeBodyRadius: positive(),
  attack: obj({
    action: nonempty(),
    proposedMechanic: enumOf(['melee', 'projectile', 'spell'] as const),
    recoveryMs: int({ min: 0 }, { unit: 'ms' }),
  }),
  source: obj({ author: nonempty(), license: nonempty(), generator: nonempty() }),
  acceptance: lit('candidate'),
};
export const BasicCreatureSchema = obj({ ...SpeciesFields, stats: EnemySchema });
export const RpgCreatureSchema = obj({ ...SpeciesFields, ...RpgFields, stats: EnemySchema });
export const CreatureRuntimeSchema = union([BasicCreatureSchema, RpgCreatureSchema] as const);

const CreatureRecordFields = {
  ...SpeciesFields,
  blockId: ref('enemy', IdentityMeta),
  lootTableId: ref('lootTable'),
  catalog: enumOf(CREATURE_CATALOGS, IdentityMeta),
  stage: enumOf(['registered', 'labOnly'] as const, IdentityMeta),
};
const CreatureRecordObjectSchema = union([
  obj({ ...CreatureRecordFields, presentationKind: lit('basic', IdentityMeta) }),
  obj({ ...CreatureRecordFields, ...RpgFields,
    presentationKind: lit('rpg', IdentityMeta) }),
] as const);
export const CreatureRecordSchema = refine(CreatureRecordObjectSchema, row => {
  const lab = row.catalog === 'RPG_BESTIARY_STAGED' || row.catalog === 'REGIONAL_BOSS_SPECIES';
  return row.stage === (lab ? 'labOnly' : 'registered');
}, 'stage must match the source catalog');
export type CreatureRecord = Infer<typeof CreatureRecordSchema>;
```

Native base coordinates are signed: the current minimum is -1.619951. Do not reuse a nonnegative vector schema for `nativeBase`. Current scale spans approximately 0.38647 to 4.8. Native dimensions, visual radius and body radius are positive. Preserve Unicode author names and full license/generator strings. The declared body-family enum has 19 members, even though this exported roster uses fewer. `rigFamily` is a nonempty string, not an enum inferred from the 12 currently used rigs.

Keep the runtime `CreatureSpeciesDef`/`RpgBestiaryEntry` interfaces and public array types. A strict runtime union can accept the two extended regional variants without dropping their extra fields. Do not validate every source row solely against `BasicCreatureSchema`. `RpgBestiaryEntry` type imports are erased and do not introduce a runtime cycle.

## Cross-record validation

Local strict schemas are necessary but not sufficient. Root's collection validation must check these relationships without weakening schemas:

- Unique IDs in each file, no canonical/alias ID collision, 483 total enemy IDs at migration parity. General `enemy` reference metadata resolves that union; fields named `blockId` additionally require canonical membership, and alias bases require registered canonical membership.
- Loot owner category matches canonical, species or alias membership. Enemy records reference their own canonical loot owner; alternative species/alias references match their owner. A species may reference its block owner instead. Reject orphan owner tables and mismatched alternatives.
- A creature's stage matches its canonical block stage. RPG bestiary catalogs require RPG presentation; the basic catalogs retain their audited shapes, including the two known regional RPG variants. Snapshot these identities for migration; do not make catalog itself a substitute for the presentation discriminator.
- Registered order is globally unique and contiguous; lab order is unique and covers 0 through 10; fantasy order is unique and covers 0 through 59. The row counts are baseline identity assertions, not permanent hardcoded array limits in field schemas.
- Fantasy aliases have the saved lineage base, valid replacement species, and registered stage through their base. Lineage is immutable historical compatibility data. Do not derive or overwrite it from replacement species.
- Resolve references at validation time against raw collection IDs, not by importing the mutable runtime registry. Enemy-family values can be indexed from canonical/alias records; family is not another enemy ID.

No derivation field is admitted by these initial snippets. Adding `derivation` must extend each relevant strict record branch with an explicit union of approved input schemas. Do not temporarily accept opaque inputs or store a record's final stats as its own formula baseline. The parameter families in `m4-plan.md` remain required before declaring M4 complete; their generator-specific tags need a separate root freeze.

## Loader exports and object identity

The dependency direction is `lootData -> enemyData -> creatureData -> source-view modules`: a module to the right may read one to its left. Schemas are pure dependencies of all loaders. Runtime balance helpers receive parameters and inputs explicitly and import none of these loaders. Each JSON file is parsed once with `parseCollection(..., { name, idKey: 'id' })`.

Proposed public helper signatures (the actual type names are inferred from the schemas):

```ts
// lootData.ts: imports only loot JSON, schema and schema/core.
export const LOOT_RECORDS: readonly LootTableRecord[];
export function lootTableById(id: string): LootTableRecord; // throws on unknown ID
export function lootDrops(id: string): EnemyDef['drops'];  // cached table array

// enemyData.ts: imports enemy/alias JSON, schemas and lootData.
export const ENEMY_RECORDS: readonly EnemyRecord[];         // 338
export const ENEMY_ALIAS_RECORDS: readonly EnemyAlias[];    // 145
export const ENEMY_BLOCK_DATA: readonly EnemyDef[];         // registered 327
export const LAB_ONLY_ENEMY_DATA: readonly EnemyDef[];      // 11, labOrder
export const ENEMY_DATA: readonly EnemyDef[];               // registered 472
export const FANTASY_TIER_DATA: readonly EnemyDef[];        // 60, fantasyTierOrder
export const FANTASY_ENCOUNTER_DATA: readonly EnemyDef[];   // 54 aliases
export function enemyBlockById(id: string): EnemyDef;      // canonical 338; throws
export function registeredEnemyById(id: string): EnemyDef | undefined; // 472 only
export function enemyBlockRows(catalog: EnemyCatalog | readonly EnemyCatalog[]): readonly EnemyDef[];
// enemyBlockRows filters all 338 records in file order, including explicit lab catalogs.
export function enemyWithLoot(blockId: string, lootTableId: string): EnemyDef;
// enemyWithLoot reuses the base object for its canonical loot; otherwise caches by pair.

// creatureData.ts: imports creature JSON, schema, enemyData and lootData as needed.
export const CREATURE_RECORDS: readonly CreatureRecord[];   // 246
export const CREATURE_DATA: readonly (CreatureSpeciesDef | RpgBestiaryEntry)[];
export function creatureById(id: string): CreatureSpeciesDef | RpgBestiaryEntry; // throws
export function creatureRows(catalog: CreatureCatalog | readonly CreatureCatalog[]): readonly CreatureSpeciesDef[];
export function rpgCreatureRows(catalog: 'RPG_BESTIARY' | 'RPG_BESTIARY_STAGED'): readonly RpgBestiaryEntry[];
```

`EnemyCatalog` and `CreatureCatalog` are `typeof ...CATALOGS[number]`. Narrow `rpgCreatureRows` through the parsed `presentationKind` branch while building its cache, not an unchecked cast of basic species. This keeps the existing public RPG arrays typed. The two regional RPG variants still retain extra runtime keys in the general source view.

Strip all record metadata before exporting runtime objects: enemy catalog/stage/order/loot reference; alias catalog/base/override/lineage/species metadata; creature catalog/stage/presentation discriminator/block and loot references. Preserve all real gameplay and RPG fields. Do not insert absent keys. The tuple compatibility note matters: parsed drop arrays must satisfy the existing mutable `EnemyDef` type without unsafe casts, even though callers should treat content as immutable.

Construct one runtime object per canonical ID and one per alias ID. Every named enemy view reuses those objects. `enemyWithLoot` caches an alternate object only when the species references a different owner table; this preserves shared stats among repeated universal species and avoids the 18 Wilderness source-output regressions. Every named species view reuses the single parsed-and-resolved creature object. Source arrays remain ordered filters of file order; `WILDERNESS_DRAGON_CANDIDATES` remains the same array reference as `WILDERNESS_DRAGONS`. Existing fairy re-exports retain their shared references.

`enemies.ts` projects these constants and retains `enemyIdFor`, `enemyBlockFor` and `huntEnemyDefMatches`. `enemyBlockFor` uses registered lookup only: matching-family group first, then family/tier, then group fallback. `FANTASY_ENCOUNTER_LINEAGE` and `BIOME_POPULATION_LEGACY_REPLACEMENTS` are maps projected from the same 54 alias records, with original insertion order and readonly tuple values. Export either the projected maps or narrow alias accessors from `enemyData`; `biomePopulation.ts` must not import `enemies.ts` or source species modules to build that mapping.

The source modules become views without importing one another for initial data construction. Retain callable/public forms, source maps and helper exports listed in `m4-plan.md`. In particular, `universalMinibossSpecies`, `rpgBestiaryLevel`, crownward encounter helpers and public Wilderness progression/loot functions still have callers. `enemyData` must never import `regions`, `biomePopulation`, source species, `regionalPacks` or runtime `index.ts`, because those are downstream today and would recreate initialization cycles.

## Lab and integration boundary

The 11 lab rows, in exact lab order, are:

| labOrder | Species | Canonical block |
| ---: | --- | --- |
| 0 | giant_rat | giant_rat_t3 |
| 1 | wild_goblin | wild_goblin_t5 |
| 2 | troll_mauler | troll_mauler_t12 |
| 3 | cave_roach | cave_roach_t5 |
| 4 | boss_tempest_roc | boss_tempest_roc_t1 |
| 5 | boss_galeskin | boss_galeskin_t1 |
| 6 | boss_rootheart | boss_rootheart_t5 |
| 7 | boss_mossbound | boss_mossbound_t5 |
| 8 | boss_tideworn | boss_tideworn_t10 |
| 9 | boss_ordrun | boss_ordrun_t10 |
| 10 | boss_cinderwake | boss_cinderwake_t20 |

`game/src/app/boot.ts` currently rewrites 18 Wilderness source stats with production loot. Those 18 results were checked equal to existing registered canonical rows. Root can preserve production registration and append these 11 lab blocks, while retaining optional M6 pack variants and existing lab preset behavior. Candidate-named assets and `acceptance: 'candidate'` must not control registration. Registered species are not necessarily placed in the world; placement remains M6.

Implementation ownership remains the split in `m4-plan.md`: root schemas/contracts/registry/boot; enemy worker enemy loader/data/aliases/progression; species worker creature loader/data/source modules; loot worker loot loader/data/helpers. Root assigns each schema and parameter file one owner after freeze. Exporters must first prove every original public view, including 246 complete species, 472 resolved enemies, 60 fantasy tiers, 54 lineage/replacement entries, source loot alternatives and optional-field absence. Baseline parity, seeded loot order checks and required browser/world acceptance remain separate gates. This contract proposal does not substitute source review for those gates.
