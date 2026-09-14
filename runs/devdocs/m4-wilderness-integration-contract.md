# Final Wilderness formula integration

Root freeze, 2026-09-13. This extends m4-formula-contracts.md. Existing pure assembly,
progression and loot schemas are the authoritative arithmetic contracts.

## World context

`game/src/content/schema/wildernessContext.ts` defines the reserved table key
`WILDERNESS_CONTEXT_KEY = 'context/wildernessProgression'` and a strict context:

```
{
  wilderness: [{ id, speciesId, tierSource, centre: [x,z], count, boss?, miniBoss? }],
  population: [{ id, speciesId, centre: [x,z], count }]
}
```

IDs and species IDs are nonempty, coordinates finite, counts positive integers. IDs
are unique across both arrays. `tierSource` is `shallow | species | depth | keeper`.
The initial arrays contain 61 and 12 rows in original production order. Counts are
acceptance evidence, not a permanent schema limit.

These are transient projections of current world authoring, never another editable
placement JSON file. Export bindings from the same authoring loops that construct
the groups. Do not infer species ownership from saved outputs, names or assets.
Keep sentry and court coordinate transforms unchanged.

Pure `projectWildernessGroups(context, species, progression, keepers)` resolves
species by ID from the independently derived pre-Wilderness assembly. It copies
name, family and asset from that source view. Tier comes from literal 50, source
tier, pure depth classification or the shared keeper row according to tierSource.
Population rows use literal 50. It returns the existing strict group inputs.

Node tooling obtains this context in a fresh process, validates it, and fingerprints
its canonical consumed values. Cached saved enemy fields, scale and radius are not
part of the context or its revision. Detect source changes during capture. A custom
content-root fixture must inject its context provider explicitly.

The context travels beside registered tables under the reserved key. It is excluded
from CONTENT_COLLECTIONS, identity checks, file locks and writes. Server snapshots
and validation preserve this explicit extra key. Formula code requires it only for
Wilderness derivations. A dedicated GET context endpoint serves its data/revision.
Recompute includes the reserved key in the revision map when context is required;
apply checks it on capture and again immediately before writes. Context change is a
409 requiring a new preview. Existing non-Wilderness fixtures need no context.

## Shipped operands and projections

Enemy balance gains `assemblySources`, `preWildernessAssembly`, and
`wildernessProgression` using the existing strict schemas. Loot balance gains
`wildernessParameters` using WildernessLootParamsSchema. Armor eligibility is a
projection of actual item rows in BOSS_ARMOR_ITEMS catalog order, not another saved
list. Material IDs come from actual Wilderness crafting tier rows.

One pure table-snapshot composition derives source combat and source loot, replays
pre-Wilderness assembly, projects context groups and runs final progression. It
never seeds itself from stored final enemy rows. Cache only by immutable snapshot
identities, including the context and every consumed table.

Use the already specified wildernessCanonical.v1, wildernessAlias.v1,
wildernessCanonicalLoot.v1 and wildernessAliasLoot.v1 tags. Canonical enemy tags
own runtime fields except drops; loot tags own ordered drops; alias tags own their
closed sparse overrides relative to the generated canonical result. Preserve
registration order, block IDs, loot ownership and all existing public signatures.
Keep and hand-tune removes only the selected tag.

## Acceptance

Prove all 360 pre-Wilderness rows, 235 ordered species, 130 progression outputs,
338 stored canonical rows, 145 aliases and 362 loot tables against original sources.
Perturb source names/tiers, depth operands, keeper multipliers and loot chances;
show the expected dependency changes without using output seeds. Prove stale
context preview rejection and unchanged context revision after enemy recompute.
Root owns full tests, editor browser proof, production build, combat lab and world
smoke. Workers have nonoverlapping file ownership and stop at contract gaps.

Alias projections may include optional `omitFields`, a unique array limited to
moveSpeedMps, walkSpeedMps, marks, attackStyle, attackRangeM and respawnSeconds.
This represents generated absence when a canonical result has an optional field.
Runtime and editor joins delete these fields after applying sparse overrides.
The alias formula owns both overrides and omitFields; baseline rows omit the list.
