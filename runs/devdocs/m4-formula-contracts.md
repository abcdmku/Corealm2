# M4 formula parameter and derivation contracts

Status: Stage 1 frozen by root, 2026-09-13. The expansion, starter and RPG branches of Stage 2 are frozen for integration; other Stage 2 branches and Stages 3-4 remain proposals. The initial JSON slice has 338 canonical enemy records, 145 aliases, 246 species and 362 owner-specific loot tables. Stage 1 adds only its two closed derivation branches.

This proposal extends [m4-contracts.md](./m4-contracts.md) and [m4-plan.md](./m4-plan.md). Root owns schema changes, integration and combined gates. A worker may implement a stage only after root freezes that stage's fields and assigns each affected file one owner.

## Evidence and input rules

The authoritative arithmetic and authored inputs are in `.baseline/game/src/content/`, especially `index.ts`, `enemies.ts`, `encounterBalance.ts` and the generator files named below. Current source modules are becoming JSON views and are not extraction inputs. `tools/content/m4-baseline.ts` captures original private blocks, group mappings, pre-Wilderness assembly, source views, canonical write provenance and public helper probes. Its 35 original blocks, 38 group pairs, 130 Wilderness output rows and 1,718 function probes are evidence, not interchangeable parameter stores.

An input is eligible when it can be traced to a literal, original function argument, source row, or explicit dependency on another extracted generator. Never divide a final field by a guessed scale to recover an input. Never tune a final canonical block back to its own level and call that an extraction. In particular, `original.blocks` contains seven pre-tuning boss seeds and is useful input evidence; `records.enemies` contains those bosses after tuning and is only expected output evidence.

Generated inputs need their original dependency graph. For example, native fantasy stats depend on RPG role generation followed by a redesign row. A saved copy of the generated native stats can be an independent test oracle, but it does not replace those generator inputs in permanent balance parameters.

Parameter rows have stable, readonly `id` values. The exporter records their original module, symbol and literal row index in a separate manifest with source hashes. Do not put arbitrary provenance dictionaries in game records. Use source IDs such as `legacy/quarrykeeper_t10`, `rpg/beetle_golem`, `forest/briar_harrow`, `wildernessBody/nightforge_marshal` and `wildernessDragon/baby_red_dragon`. These identify source inputs, not final registry entries. They must stay separately addressable when a final canonical ID is overwritten.

Keep all existing runtime exports and public helper signatures. Pure formula modules receive validated parameters and source dependencies as arguments. They must not import JSON, content loaders, registries, source-view modules, regions or runtime `content/index.ts`. Type-only imports are allowed. Existing public modules become wrappers around the pure functions where needed.

## Strict schema conventions

Use the current strict `obj`, `union`, `lit`, `enumOf`, `ref`, `opt`, `arr`, `tuple`, `num`, `int` and `refine` combinators. All object fields listed here are exhaustive. Do not implement these contracts with `unknown`, `Record<string, unknown>`, an expression language, arbitrary overrides, or a general-purpose formula interpreter.

The following names specify shared field schemas:

- `Id`: nonempty stable identifier. Item and species references use their existing reference collections. `InputId` is a nonempty identifier plus a graph validation check against the relevant parameter collection, not `ref('enemy')`.
- `N`: finite number; `P`: finite number greater than zero; `NN`: finite number at least zero; `I`: positive integer; `I0`: nonnegative integer; `Chance`: finite number in `[0,1]`.
- `Marks`: mutable ordered pair of nonnegative integers. `Quantity`: mutable ordered pair of positive integers. `Roll`: strict `{ quantity: Quantity, chance: Chance }`. `Drop` is the existing strict drop schema, including optional `exclusiveGroup`.
- `CombatInput`: strict `{ maxHealth: P, attackLevel: P, defenceLevel: P, accuracy: NN, armour: NN, magicArmour: NN, maxHit: P }`. Seeds can have fractional health before tuning. Do not impose final integer constraints on intermediate inputs.
- `CombatResult`: final integer values for those seven fields, plus `tier: I`. `EnemyFieldsWithoutDrops` is the full frozen runtime enemy field set excluding drops and record metadata. It is strict and preserves optional absence.
- `Identity`: strict `{ enemyId: Id, family: Id, name: nonempty string, tier: I }`. `Behaviour` and `AttackStyle` reuse existing closed enums. `RegionId` uses the exact nine current region IDs.

Every array of keyed parameter rows rejects duplicate keys. Maps with a finite domain use explicit object fields or `rec(value, enumOf(keys))`, with an additional completeness check where all keys are required. Do not retain open `regionCombatTiers` or `regionalBossLevels` dictionaries when this schema is revised. `regionCombatTiers` has all nine current region keys; `regionalBossLevels` has exactly `galeskin`, `tempest_roc`, `mossbound`, `rootheart`, `tideworn`, `ordrun`, `cinderwake`.

Derivation tags are optional and absent until verified. Proposed final union branches are below. Freeze only the first two branches for the first extraction stage.

```ts
type EnemyDerivation =
  | { kind: 'legacyMarks.v1'; inputId: string }
  | { kind: 'legacyBossCombat.v1'; inputId: string }
  | { kind: 'fantasyScale.v1'; sourceInputId: string; tier: number }
  | { kind: 'sourceEnemy.v1'; inputId: string }
  | { kind: 'wildernessCanonical.v1'; family: string; tier: 50 | 70 };

type AliasDerivation =
  | { kind: 'wildernessAlias.v1'; groupId: string };

type LootDerivation =
  | { kind: 'sourceLoot.v1'; inputId: string }
  | { kind: 'wildernessCanonicalLoot.v1'; family: string; tier: 50 | 70 }
  | { kind: 'wildernessAliasLoot.v1'; groupId: string };
```

These are closed schema unions, not plain casts of the illustrated TypeScript types. Validate tag kind against catalog and owner. The marks branch checks only `marks`; the legacy boss branch checks `CombatResult`; fantasy checks `id`, `tier`, the seven combat fields and marks. The source and Wilderness enemy branches check every runtime enemy field except drops. Loot branches check the complete ordered drop array. Tags never authorize a checker to copy unexplained fields from the output into its expected result. Untagged fields remain authored and appear as such in coverage reports.

Optional marks deserve care. The original fantasy helper returns the identical native object on its native tier. On a nonnative tier it explicitly writes `marks: undefined` if the source has no marks. Current 60 fantasy rows all have marks, so no JSON row needs an own undefined value. Preserve that helper behavior in direct probes without widening the record schema to admit undefined-valued JSON properties.

Loaders continue to load stored results. Parameter edits produce drift reports and explicit recompute previews, never automatic runtime retuning. A preview reports the record, input IDs, changed fields, previous values and recomputed values. No database or file mutation occurs during preview.

## Stage 1: legacy marks and saved boss tuning

This stage is implementable without source-generator migration. It adds exactly 35 enemy tags: 24 ordinary marks, four purse marks and seven tuned legacy boss combat projections. It adds no alias or loot tags. Native fantasy inputs and other generator families remain outside this stage.

Keep the existing scalar blocks in `balance/enemies.json`, with the following refinements:

| Block | Exact contract and invariants |
| --- | --- |
| `marksPerTier` | `{ ordinary: Marks, purse: Marks }`, currently `[3,11]` and `[7,27]`. These are integer multipliers; do not substitute the prose estimate of 2.4 times ordinary rewards. |
| `combatLevel` | Existing fields `rollLevelOffset: NN`, `bonusDivisor: P`, `defenceStyleCount: I`, `healthPerLevel: P`, three weights `Chance`, `minimum: I`; weights sum to one and healthWeight is greater than zero. Current values are `9,100,2,3,.5,.25,.25,1`. |
| `tuning` | Existing fields and values remain `minimumHealth=3`, `minimumLevel=1`, `minimumBonus=0`, `maximumBonus=80`, `maximumBonusScale=1`, `maxHitExponent=.68`, search bounds `0,1`, growth `2`, iterations `48`, `healthPerCombatLevel=12`. Require ordered bonus/search bounds and growth greater than one. minimumBonus is a nonnegative integer because it is applied after rounding. |
| `legacyMarksInputs` | Array of strict `{ id: InputId, enemyId: Id, tier: I, profile: 'ordinary'\|'purse' }`; exactly 28 original call sites. No final marks in the row. |
| `legacyBossInputs` | Array of strict `{ id: InputId, enemyId: Id, bossId: BossId, seed: CombatInput }`; exactly seven original BLOCKS seeds. Target tier and multiplier come from `regionalBossLevels[bossId]`. |
| `ordrunPhases` | Strict tuple of two phase parameter rows defined below. This is helper-output coverage, not another enemy tag. |

Do not silently make `healthPerCombatLevel` a second independent expression of the level formula. Require `healthPerCombatLevel === combatLevel.healthPerLevel / combatLevel.healthWeight`, within the same small numeric tolerance used for weight validation. Health correction uses the configurable offence and defence weights and the same roll constants. Preserve the original evaluation order for the original parameter values.

```ts
type LevelInput = Pick<EnemyDef,
  'maxHealth' | 'attackLevel' | 'defenceLevel' |
  'accuracy' | 'armour' | 'magicArmour'>;

function combatLevel(p: CombatLevelParams, input: Readonly<LevelInput>): number;
function tierMarks(p: MarksPerTierParams, tier: number,
  profile: 'ordinary' | 'purse'): [number, number];
function tuneCombat(p: TuningParams, level: CombatLevelParams,
  input: Readonly<CombatInput>, targetLevel: number, tier: number, sourceId: string): CombatResult;
function deriveLegacyBoss(p: EnemyBalanceStage1,
  input: Readonly<LegacyBossInput>): CombatResult;
function ordrunPhases(p: OrdrunPhaseParams,
  tuned: Readonly<Pick<CombatResult, 'armour' | 'maxHit'>>): BossPhase[];
```

The public `tuneEnemyCombatLevel(base, targetLevel, tier = base.tier)` wrapper returns `{ ...base, ...tuneCombat(...) }`. Its original ID is passed to error formatting so the existing failure message remains compatible. The pure search must round the requested target first, sample rounded fields, double the upper bound until it reaches target, run 48 binary steps, replace the best candidate only on strictly smaller error, then correct health and verify the final level. Equal-error ties retain the earlier candidate. Do not replace the search with a continuous closed form or change division order in the defence roll. `Math.round`, including half ties, is required.

`ordrunPhases` is a tuple. First row is strict `{ atHealthFraction: Chance, attackSpeedMs: I }`, current `1,3000`; it copies tuned armour and max hit. Second row is strict `{ atHealthFraction: Chance, armourNumerator: NN, armourDenominator: P, attackSpeedMs: I, maxHitNumerator: NN, maxHitDenominator: P, telegraphId: nonempty string, telegraphWindupMs: I, telegraphRadiusM: P }`, current `.55,50,62,2400,14,12,'ground_slam',1800,6`. Preserve `Math.round(armour * 50 / 62)` and `Math.round(maxHit * 14 / 12)`. Phase two's threshold must be lower than phase one's.

The seven saved targets are `galeskin_t1`, `tempest_roc_t1`, `mossbound_t5`, `rootheart_t5`, `tideworn_t10`, `quarrykeeper_t10`, `cinderwake_t20`. Ordrun's boss key remains `ordrun`; never rename `quarrykeeper_t10`. The seven `boss_*` lab records are a different family and get no Stage 1 legacy tags.

Stage 1 acceptance checks all 28 original marks call sites, all seven pre-tuning seeds against original literals, seven tuned projections and both Ordrun phases. Replay every existing tuning probe, with additional rounding, equal-error, capped bonus and low-target failure probes against the original function. Unknown tag keys, unknown input IDs, using a nonboss input for a boss tag, and circular/output-backed input references must fail. Change one original seed and one multiplier in memory to demonstrate a meaningful preview while confirming the loader's stored values remain unchanged.

## Stage 2: original enemy source generators

Use a separate strict `sourceInputs` union inside `balance/enemies.json`. The core parameter blocks are grouped under strict `sourceParameters`, initially expansion, starter and rpg. Directly copied combat bonuses are integers; RPG parameters require positive rounded health at tier one for every role. Each branch has `id: InputId` and the branch-specific fields below. `sourceInputId` always points to another input row, never to a final enemy. Topologically validate the graph, reject cycles and missing dependencies, and cache pure results by input ID. Original row order is preserved separately from graph execution order.

```ts
function deriveSourceEnemy(p: EnemySourceParams, input: Readonly<EnemySourceInput>,
  dependencies: ReadonlyMap<string, Readonly<EnemyFieldsWithoutDrops>>): EnemyFieldsWithoutDrops;
function scaleFantasy(p: FantasyParams,
  source: Readonly<EnemyDef>, tier: number): EnemyDef;
```

`scaleFantasy` preserves the native identity return and drop-array reference. It scales exactly seven combat fields and both marks by `tier / source.tier`, rounding before applying each field minimum. It preserves cadence, movement, range, behaviour, respawn, style, name, family and drops. Keep `fantasy.tiers=[1,5,10,20]`; the seven minimums and marks minimum already exist. Add ordered `fantasy.sourceInputIds` for the five forest, five stone and five ash sources, in that source order. The resulting view is 60 rows, with 15 native rows and 45 nonnative rows. Only those 45 get `fantasyScale.v1`; native rows retain their source tag. Do not infer the native tier from final catalog membership.

The source row contracts below describe combat inputs. Presentation data stays in `creatures.json`; it is not necessary to duplicate descriptions, scale, habitat, attribution or mesh bounds in enemy balance data. Where a public source helper rebuilds presentation, pass its existing validated presentation record explicitly.

| Kind | Strict row fields after `id` and `kind` | Original ownership and coverage |
| --- | --- | --- |
| `expansion` | `identity: Identity`, `authored: EnemyFieldsWithoutDrops` excluding identity and marks | Original `creatureExpansion.ts` 24 `species()` arguments. Add fixed `expansion.marksPerTier=[2,6]`. Every remaining stat is authored, not inferred. |
| `starter` | `speciesId: Id`, `name: string`, `health: I`, `behaviour: Behaviour`, `armour: NN`, `moveSpeedMps: P` | Original seven `small()` arguments, with original argument defaults materialized. Shared `starter` parameters hold tier 1, attack 2, defence 1, accuracy 4, magic armour 0, max hit 2, cadence 2400, aggressive/other aggro 5/3, walk cap .4, walk divisor 3 and marks `[1,3]`. |
| `rpg` | `speciesId: Id`, `name: string`, `bodyFamily: RpgBodyFamily`, `regionId: RegionId`, `tier: I`, `role: 'skirmisher'\|'fighter'\|'brute'\|'caster'\|'guard'`, `action: nonempty string` | Original active 21 and staged four `entry()` calls, including four acceptedCompleteSources. Keep staged rows available as inputs without registering them. Do not resurrect withdrawn historical candidate rows. |
| `variant` | `speciesId: Id`, `name: string`, `sourceInputId: InputId`, `health: I` | Five original regional variant rows. Inherit tier, add fixed magic armour bonus 12, replace health and identity. Loot owns appended essence. |
| `redesign` | `speciesId: Id`, `name: string`, `sourceInputId: InputId`, `health: I`, `profile: 'basic'\|'forest'\|'ash'\|'stone'`, `tier: I`, `behaviour: Behaviour`, `attackRangeM?: P` | Three basic, five forest, five ash and five stone rows. These replace health and tier without tuning other inherited combat values. Only ash forces melee/range. Original conditional choices become typed explicit row inputs. No arbitrary stat override object. |
| `fairy` | `speciesId: Id`, `family: Id`, `name: string`, `tier: 30\|60`, `levelOffset: integer` | Six original roster entries in each of two bands, 12 source results. Shared original `fairy` template and levelOffset threshold 8, aggressive/other aggro 8/5, marks `[3,7]` per tier. |
| `garden` | `speciesId: Id`, `family: Id`, `name: string`, `tier: 30\|60`, `levelOffset: integer`, `speed: P`, `behaviour: Behaviour` | Twelve original forms in two bands, 24 results. Own original `garden` template, walk cap .35, walk multiplier .45, aggressive/other aggro 7/4, marks `[3,7]`. |
| `universal` | `number: enum '01'..'09'`, `name: string`, `style: 'melee'\|'magic'`, `tier: I` | Nine roster entries over seven distinct tiers, 63 combat results. Shared template plus minimum region tier 10, minimum target 12, target multiplier 2.5, respawn 1800, marks minima `[15,30]`, marks per tier `[10,20]`. Ninety species map to these 63 results. |
| `wildernessBody` | `speciesId: Id`, `name: string`, `tier: 50\|70`, `target: target union`, `role: 'crawler'\|'heavy'\|'predator'\|'ghost'\|'keeper'` | Six ordinary body rows and five keeper rows. Target is `{kind:'level',level:I}` or `{kind:'keeper',keeperId:KeeperId}`. Keeper targets are read from the same keeper parameter rows used by progression. |
| `wildernessDragon` | `speciesId: Id`, `name: string`, `tier: 50\|70`, `targetLevel: I` | Seven original dragon rows, including both separately named level-78 purple forms. Use pre-progression sources for all dragon descendants. |
| `regionalBossBody` | `speciesId: Id`, `name: string`, `sourceInputId: InputId`, `bossId: BossId` | Seven original `SOURCES` rows in `regionalBossBodies.ts`, from beetle_golem, mossback_sentinel, iron_golem and lava_golem. Tune the RPG source, then assign boss identity and territorial behaviour. |
| `fairyCrown` | `speciesId: Id`, `name: string`, `sourceInputId: InputId`, `tier: 30\|40\|60`, `targetLevel: I`, `nativeScale: P`, `behaviour: Behaviour`, `boss: boolean` | Twelve original forms. Nine ordinary and three boss forms; source inputs include original keeper bodies and a regional boss body. |
| `crownwardDragon` | `speciesId: Id`, `name: string`, `sourceInputId: InputId`, `targetLevel: I`, `rank: 'miniboss'\|'boss'` | Three original forms, two minibosses and one boss. Fixed tier 40. Preserve original source movement and cadence. |

`red_worm` is one authored literal and stays untagged unless there is a later reason to extract a formula. Source input identity exclusions must be implemented with explicit strict fields, not permissive TypeScript `Omit` casting. Source counts in this table are observations, not a sum of final canonical rows. Final write precedence remains the contract in `m4-contracts.md`.

The shared RPG arithmetic block has these exact fields:

```ts
type RpgRoleParams = {
  healthMultiplier: number; attackLevelOffset: number; defenceLevelOffset: number;
  accuracy: number; armour: number; maxHitOffset: number; attackSpeedMs: number;
  aggroRadius: number; moveSpeedMps: number;
};
type RpgParams = {
  healthBase: number; healthPerTier: number; maxHitMinimum: number; maxHitPerTier: number;
  roles: { skirmisher: RpgRoleParams; fighter: RpgRoleParams; brute: RpgRoleParams;
    caster: RpgRoleParams; guard: RpgRoleParams };
  magicArmour: { caster: number; golem: number; other: number };
  attackRangeM: { melee: number; ranged: number; magic: number };
  rangedActions: string[]; magicActions: string[];
  territorialFamilies: RpgBodyFamily[]; walkSpeedMps: number;
  marksMinimum: [number, number]; marksPerTier: [number, number];
};
```

Numbers use the bounds specified above. Role health multiplier is positive; level offsets are nonnegative integers; cadence is a positive integer. The original shared values are health `8 + tier*2.2`, max hit `max(2,round(tier*.45+offset))`, magic armour caster/golem/other `55/5/15`, range `1.8/10/8`, walk `.4`, marks minima `[1,3]` and multipliers `[1,3]`. Actions select ranged for `bow shot`, magic for `staff curse` or `lament`; all other actions are melee. Territorial families are golem and gargoyle. Caster priority precedes the golem magic-armour exception. Role values are extracted directly from the ternaries in original `entry()`, including brute health 1.4, guard 1.2 and caster .8. No tuning call exists in RPG generation.

| Role | Health multiplier | Attack offset | Defence offset | Accuracy | Armour | Hit offset | Cadence ms | Aggro m | Move m/s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| skirmisher | 1 | 2 | 0 | 12 | 10 | 1 | 2000 | 10 | 1.6 |
| fighter | 1 | 2 | 0 | 6 | 10 | 1 | 2400 | 7 | 1.6 |
| brute | 1.4 | 6 | 0 | 6 | 16 | 4 | 3400 | 7 | 1.2 |
| caster | .8 | 2 | 0 | 16 | 3 | 1 | 2800 | 7 | 1.6 |
| guard | 1.2 | 2 | 4 | 6 | 45 | 1 | 3000 | 7 | 1.3 |

Fairy and garden template schemas are complete strict original `EnemyFieldsWithoutDrops` seeds with no marks, optional fields or defaults added. They are distinct templates despite shared combat numbers. Wilderness body arithmetic is a fixed named parameter object, not arbitrary role formulas: `heavyRoles=['heavy','keeper']`, `magicRoles=['ghost']`, `magicSpeciesIds=['chainbound_archon','hollow_star']`; attack-level multipliers magic/heavy/other `.83/.74/.87`; defence heavy/other `.77/.62`; health heavy/other `5/3`; accuracy magic/predator/other `20/15/8`; armour magic/heavy/other `10/35/20`; magicArmour magic/deep/other `40/25/10`; maxHit multipliers keeper/heavy/other `.76/.49/.40`; ranges magic/heavy/other `8/2.6/1.9`; cadence keeper/heavy/magic/other `3800/3400/2900/2500`; aggro keeper/magic/other `15/10/8`; move magic/heavy/other `1.6/1.1/1.5`; walk heavy/other `.32/.42`; marks minimum-per-tier 1 and maximum keeper/other `12/3`. Each slash group is an explicit strict nested object with the named fields, preserving that branch priority.

Dragon arithmetic has named `healthPerTier=3`, `attackLevelOffset=-3`, `defenceLevelOffset=-5`, accuracy 12, armour 24, magicArmour 32, `maxHitPerTier=.32`, marks multipliers `[2,6]`. Strict `shallow` and `deep` profile objects contain cadence `2800/3600`, range `2.3/3.5`, aggro `8/11`, move `1.4/1.8`, walk `.65/.8`. Tier selection remains equality to 50 in this generator, distinct from Wilderness loot's greater-than-or-equal deep test.

Fairy crown parameters explicitly store movement scale cap 1, boss range minimum 2.4/fallback 2, ordinary range maximum 2/fallback 1.8, boss/passive/territorial/aggressive aggro `12/4/5/8`, and ordinary/boss marks multipliers `[3,7]/[12,24]`. Apply these patches before tuning. Preserve missing source movement keys. Crownward dragon parameters store tier 40, aggro miniboss/boss `7/11` and authored marks `[220,380]/[600,1000]`; apply before tuning. Do not replace these authored ranges with the fairy crown profile.

## Stage 3: Wilderness progression and aliases

This stage owns the 57 canonical Wilderness records and 73 aliases. The 130-row original output is ordered canonical rows followed by aliases. Of the canonical records, 39 introduce IDs and 18 overwrite earlier source IDs. All 18 original body/dragon inputs remain in `sourceInputs`, even when their combat fields happen to equal the final canonical fields. Their source drops differ and their dependencies are required by fairy crown and Crownward dragons.

Add a strict `wildernessProgression` block in enemy balance parameters:

```ts
type WildernessProgressionParams = {
  depth: { south: number; divide: number; north: number };
  bands: [
    { tier: 50; legacyBase: number; fallbackFloor: number; fallbackCeiling: number },
    { tier: 70; legacyBase: number; fallbackFloor: number; fallbackCeiling: number }
  ];
  legacyProgressLevels: number; nativeProgressLevels: number;
  legacySourceTierThreshold: number;
  fallbackTiers: [50, 70, 20, 10, 5, 1];
  marks: { defaultMinimumPerSourceTier: number; defaultMaximumPerSourceTier: number;
    minimumPerTargetTier: number; maximumPerTargetTier: number };
  keepers: { id: KeeperId; name: string; tier: 50 | 70; multiplier: number }[];
};
```

Depth is `460,700,940` and must be strictly increasing. Band rows are `50,48,48,57` and `70,69,69,77`. Progress increments are 8 and 4; source threshold is 50; marks parameters are `1,3,1,2`. Exactly five keeper rows use original IDs and multipliers. Their combat ownership stays here; loot adds rune and component mappings keyed by this closed KeeperId set. The atmosphere parameters of `wildernessMagicAt` remain under world ownership and are not copied into M4 combat balance.

The reusable production function takes explicit graph inputs:

```ts
type WildernessGroupInput = {
  id: string; family: string; name: string; tier: number; centre: [number, number];
  count: number; assetId?: string; boss?: boolean; miniBoss?: boolean;
};
type WildernessSpeciesInput = { id: string; assetId: string; sourceInputId: string };
type PreWildernessEntry = { id: string; sourceInputId: string };

function wildernessLevelAt(p: WildernessProgressionParams, level: CombatLevelParams,
  base: Readonly<EnemyFieldsWithoutDrops>, z: number): number;
function wildernessMarks(p: WildernessProgressionParams['marks'],
  base: Readonly<Pick<EnemyDef, 'tier' | 'marks'>>, tier: 50 | 70): [number, number];
function buildWildernessProgression(p: WildernessFormulaParams,
  groups: readonly WildernessGroupInput[], preWilderness: readonly PreWildernessEntry[],
  species: readonly WildernessSpeciesInput[], sources: ReadonlyMap<string, EnemyDef>,
  loot: WildernessLootDependencies): EnemyDef[];
```

These type illustrations use strings for names already given strict schema definitions. `WildernessFormulaParams` contains only `wildernessProgression`, `combatLevel` and `tuning`. `WildernessLootDependencies` contains the explicit loot parameters, keeper rows and ordered armor inputs defined in Stage 4. The source map is built by the pure input graph. Pre-Wilderness aliases require distinct source graph nodes that preserve their original identity and movement changes; they cannot be collapsed to final canonical IDs.

Those assembly nodes are a second closed union, separate from `sourceInputs`: `{ id: InputId, kind: 'legacyBlock', legacyInputId: InputId }`, `{ id: InputId, kind: 'speciesBlock', sourceInputId: InputId }`, `{ id: InputId, kind: 'fantasyTier', sourceInputId: InputId, tier: 1|5|10|20 }`, `{ id: InputId, kind: 'groupAlias', baseInputId: InputId, groupId: Id }`, or `{ id: InputId, kind: 'fantasyEncounter', originalInputId: InputId, replacementSourceInputId: InputId, groupId: Id }`. Legacy blocks use the original 35 authored blocks plus their Stage 1 transforms; species nodes join source combat and source loot results. Fantasy encounters retain original combat and drops while copying replacement name, family and movement, exactly as original `enemies.ts` does. Build the 18 ordinary aliases from the original 38 GROUP_BLOCK pairs after original replacement filtering; preserve the 54 fantasy encounter nodes and historical lineage mapping. Assembly replay, including last-write value with first-insertion order, produces the exact pre-Wilderness lookup. No branch reads a stored final enemy or alias as its own base.

Groups are the compact projection of the original public function's group arguments, not newly authored M4 placements. Do not add a second editable copy of world positions to enemy JSON. Baseline tests use the original 73 group inputs; production wrappers project their supplied groups. `PreWildernessEntry` retains the original ordered view and uses exact-family group lookup, then family/tier. Species input view preserves the original 235 source species passed to progression. When extracting the recorded function probe, distinguish its arguments from its 130 expected output rows.

Keep these original choices exact:

1. Tier is shallow when `z < divide`, deep otherwise. Progress clamps to `[0,1]`. Nonfinite encounter depth fails.
2. Legacy source tier below 50 yields band's legacy base plus `round(progress*8)`.
3. For other sources, a native-tier nonkeeper family keeps its authored combat level, even above the ordinary band ceiling. The level-78 purple dragons must not be clipped to 77. Cross-tier or keeper-family ordinary packs clamp `tier + authoredLevel - base.tier` to band bounds, then add `round(progress*4)`.
4. Resolve bases in order: supplied exact group ID with matching family, matching-asset species among species sorted by ID, first species in that sort, supplied matching family, then lookup over `[50,70,20,10,5,1]`.
5. Canonicals iterate families in `localeCompare` order. Ordinary representative is earliest depth, then group ID; keeper representative is the first keeper sibling in supplied group order. Canonical matching-asset species takes precedence over the representative's chosen base. Ordinary families get both tiers; keeper families get only their native tier.
6. Alias rows retain group input order. Keeper identity comes from exact group ID, not family or asset. Enforce native band, count 1 and boss or miniboss flags. A pack borrowing a keeper body gets ordinary progression and ordinary loot.
7. Marks use `ratio=tier/base.tier`; lower is `max(tier, round((base.marks?.[0] ?? base.tier)*ratio))`; upper is `max(lower,tier*2,round((base.marks?.[1] ?? base.tier*3)*ratio))`, with each literal supplied by its corresponding marks parameter.

`wildernessCanonical.v1` finds the generated canonical in this projection; `wildernessAlias.v1` finds the generated alias and computes the closed sparse override set against the generated canonical. Compare the existing stored alias's resolved runtime result and sparse representation, including its optional loot alternative. Never use the stored sparse overrides as generator input.

## Stage 4: loot selection and ordered rolls

`balance/loot.json` already owns some probabilities. Expand it with the original item selection data and family inputs. Keep `materialValues` where M2 placed it; it does not itself derive a drop table. The current 362 owner IDs remain stable: 338 canonical, 18 species source alternatives and six alias alternatives. Shared equal arrays are not merged by value.

```ts
function bossArmorLoot(p: { expectedPieces: number },
  eligibleItemIds: readonly string[]): EnemyDef['drops'];
function regionalFabricLoot(p: RegionalFabricParams, tier: number,
  boss: boolean): EnemyDef['drops'];
function wildernessLoot(p: WildernessLootParams,
  input: { speciesId: string; tier: number; keeperId?: KeeperId; structureId?: StructureId },
  armor: readonly ArmorEligibilityRow[], keepers: readonly KeeperCombatRow[]): EnemyDef['drops'];
function deriveSourceLoot(p: SourceLootParams, input: SourceLootInput,
  dependencies: ReadonlyMap<string, EnemyDef['drops']>): EnemyDef['drops'];
```

`ArmorEligibilityRow` is strict `{ tier: 50|70, itemIds: ref('item')[] }`, exactly two rows. Item IDs preserve original `BOSS_ARMOR_ITEMS.filter(item.tier===tier)` order. Both lists contain nine pieces: four bareheaded melee pieces followed by five magic pieces. Eligibility is owned by the original boss armor item construction, including its bareheaded set exclusion; extract or project the migrated item authoring inputs and prove the same ordered IDs. Do not pick any nine equal-valued items. `expectedPieces=.02` divides by the actual eligible count. Each roll has `[1,1]`, no exclusive group. Empty eligibility returns `[]`, matching the original map without evaluating a per-item division. Cross-validation ensures each actual chance is at most 1. Preserve the public 50-or-70 tier restriction.

`RegionalFabricParams` is strict `{ ordinary: Roll, boss: Roll, materials: { tier: 30|40|60, itemId: ref('item') }[] }`. Materials are `30/mistweave`, `40/crownhide`, `60/faesilk`; ordinary is `[1,3],.75`, boss `[4,7],1`. Unknown numeric tier returns an empty array. These inputs come from the original `REGIONAL_CRAFTING_TIERS` hide fields, not from searching current output drops.

The exact Wilderness additions are:

- `classification: { dragonTokens: nonempty string[], stoneTokens: nonempty string[], stoneSpeciesIds: Id[] }`. Tokens preserve original case-sensitive substring matching. Dragon tokens are `dragon,drake,hatchling`. Stone tokens are `stone,rock,golem,cairn,flint,basalt,slag,kiln,obsidian,magma,crag,colossus,nightglass`. Explicit species are `cinderback_crag,furnace_grazer,basalt_maw,rift_carapace,voidstone_colossus,ashseal_warden,furnace_regent,nightforge_marshal`. Dragon material selection has priority over stone material selection, but the independent stony result still controls the ore append.
- `materials: { shallow: { draconic: item ref, stony: item ref, other: item ref, ore: item ref }, deep: same strict fields, gem: item ref, cosmicRune: item ref }`, values from original material selection branches. Deep threshold remains 70 and uses keeper tier if present.
- `runesByRank`: ordered rows `{ rank: 1|2|3|4|5, itemId: item ref }` from original `SPELL_RUNES`; require exactly one of each rank. `ordinary.shallowRuneRanks` is `[1,2]`, `ordinary.deepRuneRanks` is `[3,4,5]`, referencing existing ordered probability/quantity rows.
- `keeperRewards`: exactly five rows `{ keeperId: KeeperId, rune: item ref, component: item ref }`, matching original keeper rune rows and `WILDERNESS_KEEPER_COMPONENTS`. Combat tier is read from the shared keeper row. `structureComponents` has exactly three rows `{ structureId: StructureId, itemId: item ref }` in original object order. StructureId is `cinder_chain_foundry|nightforge_bastion|hollow_star_sanctum`.
- Existing `keeper` and `ordinary` roll objects retain their exact strict fields. Keep quantity and chance values already extracted. Add no catch-all drop recipes.

Keeper order is material, keeper component, keeper rune, Cosmic Rune, ore, gem, armor pieces. Ordinary order is material, Cosmic Rune, band runes in original rank order, optional stony ore, gem, optional structure component. A supplied unknown keeper ID throws. Exact `${siteId}_west_conclave` and `${siteId}_east_conclave` IDs select a structure; nearby names and the bare site ID do not. A keeper ignores an otherwise supplied structure reward, as before.

`SourceLootInput` is a strict union with `id: InputId` and these branches. Freeze branches only when their original operands and mapping are implemented:

| Kind | Strict fields | Meaning and source coverage |
| --- | --- | --- |
| `authored` | `drops: Drop[]` | Original literal ordered arrays, for legacy and expansion source drops and the empty red-worm/body sources. This is authored source data, not a claim that arbitrary output arrays were derived. It may be a dependency without granting a final formula tag. |
| `inherit` | `sourceInputId: InputId` | Original spread semantics, including five stone redesign sources and seven RPG-based boss body sources. Equality alone cannot justify this branch. |
| `starter` | `itemId: item ref` | Seven original loot arguments, shared roll `[1,2],.65`. |
| `rpg` | `regionId: enum of four original RPG regions`, `tier: I`, `role: RpgRole` | 25 original RPG inputs; region essence map air/earth/water/fire, quantity minimum 1, maximum `max(1,ceil(tier/10))`, caster chance .45 versus .15. |
| `variantAppend` | `sourceInputId: InputId`, `essenceItemId: item ref` | Five regional variants append `[1,1],.25` after all inherited drops. |
| `redesignEssence` | `profile: 'basic'\|'forest'\|'ash'`, `essenceItemId: item ref` | Three basic sources use `[1,2],.4`; five forest and five ash use `[1,2],.35`. Stone inherits RPG loot instead. |
| `fairy` | `tier: 30\|60` | 12 fairy and 24 garden sources. Fabric first, earth essence `[1,3],.55`, tier rune `[1,2],.18`, cosmic `[1,1],.14`. |
| `fairyCrown` | `speciesId: Id`, `regionId: 'crownward'\|'gloamgarden'\|'faeholme'`, `tier: 30\|40\|60`, `boss: boolean` | Twelve original forms. Require matching region/tier pairs. Details below. |
| `crownwardDragon` | `boss: boolean` | Three source forms. Fabric 40 first, then dragon scales, fire essence and death rune. |
| `wildernessDragonSource` | `tier: 50\|70` | Seven separately owned species tables: scales `[1,2]` or `[1,4]`, chance .85; fire essence `[2,5],.65`. This is not production Wilderness loot. |
| `universalJewelry` | `tier: I` | 63 distinct guardian combat owners backing 90 species. Minimum eligible tier 10, ordered ring then earring, chance .30 divided by two, quantity `[1,1]`, exclusive group `jewelry`. |

Shared family rolls belong in a strict `sourceLoot` parameter object with named fields `starter`, `rpg`, `variantAppend`, `redesignEssence`, `fairy`, `fairyCrown`, `crownwardDragon`, `wildernessDragonSource`, `universalJewelry`. Their subfields are the operands in the table, represented by `Roll`, explicit item references, finite tier maps and named minimum/divisor fields. For universal jewelry store `minimumTier: I`, `totalChance: Chance`, `exclusiveGroup: nonempty string`, `quantity: Quantity`, and ordered `{ tier:I, ringItemId:item ref, earringItemId:item ref }[]`. The split divisor is the two authored slots; validate both slots rather than exposing an unrelated divisor that could desynchronize the chance budget.

Fairy crown uses fabric, then essence, then rune, then optional cosmic, then optional venison. Ordinary/boss essence is `[2,4],.55` / `[8,14],1`; rune `[1,2],.18` / `[3,6],1`; cosmic `[1,1],.14` / `[3,5],1`. Crownward uses air essence and no cosmic; fairy regions use earth essence and cosmic. Tier rune mapping is `30/chaos`, `40/death`, `60/blood`. Store explicit `venisonSpeciesId='crown_hart'` and roll `[1,2],.8`; no other hart rule is implied. Crownward dragons have scale ordinary/boss `[1,3]/[4,7]` at chance 1; fire essence `[4,8]/[10,18]` at 1; death rune `[1,3],.35` / `[4,7],.75`.

Tag coverage is joined by original ownership, not by counting distinct arrays. Wilderness can independently tag its 57 canonical loot owners and six differing alias loot owners after complete input extraction. The other 67 Wilderness aliases inherit their canonical table and get no extra loot-table tag. The 18 species alternatives comprise 11 explicitly empty body tables and seven source dragon tables. Forty-five fantasy tables inherit source drops without scaling their quantities. Seven lab boss bodies inherit RPG source drops despite their changed tier. The full exporter must report a per-owner derivation ledger before claiming all 362 tables are formula-covered; authored literal tables remain honestly authored.

## Worker sequence and validation boundary

Root freezes Stage 1 schema and tag branches first. One enemy formula worker can then own `balance/enemies.ts`, its dedicated strict parameter/tag schema file, the assigned enemy parameter JSON additions and focused tests. Root integrates changes to shared `schema/balance.ts`, `schema/enemies.ts`, collection registration and exported wrappers. Do not split edits to the same JSON file among concurrent workers.

Source graph extraction comes next. Start with RPG, expansion and starter inputs, then variants/redesigns and fantasy scaling. Add body/dragon and regional boss sources before their fairy crown/Crownward descendants. Add universal, fairy and garden templates. Freeze each union branch before delegation. The loot worker owns its pure implementation, dedicated schema and parameter JSON only after root assigns them. Progression follows the complete source graph and calls the extracted loot code with explicit dependencies. Root changes shared contracts and their callers together.

Each stage's focused tests must prove the tagged field projection against immutable original output, input provenance, unknown-key rejection, missing/cyclic references, optional-field absence, and perturbation-driven drift. Loot tests compare ordered arrays and seeded independent/exclusive rolls, including armor's expected-piece total and the ring/earring exclusive group. Reusing the stored output as the formula input or expected-value generator is a test failure.

Wilderness focused coverage includes all 130 generated rows, 57 canonical IDs, 73 aliases, all 18 source alternatives, all five keepers, both depth bands, exact boundary points, beyond-band clamping, native level-78 dragons, keeper-body ordinary packs, cross-tier fallbacks, duplicate IDs, missing bases and invalid keeper placement. Preserve complete source exports, map order and the 54 historical lineage pairs separately. Formula tags do not rewrite historical aliases.

No whole-game gate, browser session or final-world build was run for this proposal. Root remains responsible for the PRD's combined build, content, lab/browser state and world acceptance. Those gates assess the implemented stage; a report must not mistake future untagged formula families for regressions in the already migrated JSON records.
