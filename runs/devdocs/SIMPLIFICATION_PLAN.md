# Corealm content simplification plan

Date: 2026-09-13

## Direction and scope

This plan replaces the remaining legacy migration sequence in `PRD.md`, including conflicting schema, formula, editor, and compatibility requirements. The user has explicitly permitted gameplay and content changes to simplify the game and future authoring. Implemented on 2026-09-13. Completion evidence and intentional changes are recorded below and in `simplification-decisions.md`.

The goal is to create, change, preview, and ship ordinary content without requiring TypeScript edits, copying resolved definitions, or understanding historical generators. Authors must also be able to inspect, tune, and maintain formulas from Devdocs, with real project type checking. The initial recommendation is an interactive formula inspector linked to the actual TypeScript source in VS Code; embedded source editing remains conditional on a successful type-safety prototype. Preserve useful gameplay, art, and tooling. Merge or remove redundant content and rules. Exact old counts, ordering, aliases, balance values, and exported table names are not requirements.

This does not require a new generic game engine. New mechanics still need code. Existing mechanics should support new content through a small set of domain definitions and reusable profiles.

## What changes

| Current structure | Replacement |
| --- | --- |
| Gathering tiers for 1/5/10/20; regional crafting tiers for 30/40/60; Wilderness crafting tiers for 50/70 | One progression table for every tier, with material assignments, unlocks, and chosen production families |
| Historical item catalogs and duplicated equipment, kit, and recipe relationships | One item identity per item; equipment families and recipe templates expand repeated content; kits and sets display references to those items |
| Separate species, enemies, aliases, actor sources, descendants, and Wilderness assembly ownership | One creature definition with presentation, combat, and loot; direct variants for meaningful differences; placements reference creatures |
| Materialized formula results plus derivation tags, drift, apply/keep, unlink, and recompute | Authored inputs and explicit adjustments; one compiler produces read-only resolved results |
| Separate loot definitions created because different generators owned them | Shared loot tables where behavior is shared; unique drops belong to their creature |
| Source groups, accepted groups, legacy placements, and regional pack reconstruction | Encounter definitions and placements as authored inputs; validated geometry as generated output |
| Sidebar entries derived from every storage collection and formula file | Task-oriented navigation with related records edited together |

The existing schemas demonstrate that these are structural changes, not renaming exercises: `gatheringTiers.ts` carries a complete low-tier production ladder, `craftingTiers.ts` has different unions by region and tier, and `ui/library.tsx` exposes collection storage directly as navigation. Those divisions must disappear from both storage and authoring.

## Source ownership and compilation

Authors own source definitions. The compiler validates references, expands families and variants, resolves profiles and progression, and emits one versioned runtime catalog with domain lookup tables. A small source map lets Devdocs explain where a resolved value came from.

Devdocs, command-line validation, the feature lab, and the game use the same compiler or its outputs. The runtime does not run a second legacy generator. Generated records are inspectable but cannot be edited independently. An exceptional value is an explicit adjustment on its authored definition, not a reason to detach an entire formula.

Editing produces a preview and an affected-record summary. Saving validates the proposed source transaction and rebuilds affected outputs automatically. Ordinary edits have one Save action, not a separate recompute/apply operation. Conflicts retain the draft. Invalid changes leave the last valid source/build intact. World bakes can run separately when expensive, but must carry the source revision and cannot publish mixed revisions. Compilation must never import the running game to rediscover its authoring inputs.

Use finite schemas and named profiles. Formulas use ordinary typed TypeScript functions; do not invent a separate formula language, plugin framework, or deep inheritance graph. Keep source control as the durable change history; migration provenance is metadata, not gameplay identity.

### Typed formulas and interactive maintenance

The recommended first implementation is typed formula modules with interactive field inspectors and Open in VS Code. Do not commit to a generic TypeScript text box as if syntax highlighting provides type safety. Embedded editing is a possible extension after proving full project diagnostics and reliable source edits.

Each calculated stat, cost, experience reward, or other supported value links to the named formula and profile that owns it. The inspector shows its actual inputs, editable parameters, resolved result, source, consumers, and before/after comparisons. Editable example inputs and tier curves provide interactive tuning. A shared formula change shows all affected content. A record-specific adjustment remains explicit data.

Canonical formulas live once in normal repository TypeScript modules. A typed registry checks each function against its domain's input, parameter, and output contract. Content stores a formula/profile reference and validated parameters, never an anonymous code string. Formula IDs and their parameter schemas must remain correlated through typed definitions and runtime validation, rather than widening all parameters to an unchecked object.

Small functions for individual outputs are useful where those outputs are independent. Related calculations such as a combat stat block can share one typed function returning a structured result. The inspector still traces each field to that function. Do not create a separate script for every stat on every item or creature, and do not create implicit dependencies between arbitrary field expressions. Profiles and reusable functions own behavior; records supply inputs.

Open in VS Code resolves the real file and function location. Saving the file triggers project type checking and a content rebuild. Devdocs reports diagnostics, refreshes impact previews, and keeps the last valid compiled catalog active if the edit fails. Restoring code uses normal repository history. This workflow does not need the app to recreate an IDE or keep a second source implementation.

Real type safety requires the repository TypeScript compiler to check formulas and their consumers under the project's actual configuration and imports. Transpilation or syntax checking alone does not qualify. Add runtime validation for JSON inputs and domain outputs, including finite numbers, valid references, costs, quantities, and probability ranges. TypeScript cannot prove balance or all numeric constraints. Focused examples and gameplay tests cover intended behavior.

If embedded editing is pursued, first prototype editing one named function in its real module with the project TypeScript language service, typed completion, cross-file diagnostics, and a full compiler check before activation. Keep source edits revision-aware, preserve surrounding code, and show the file diff. Preview must use the same compiler and calculation path as production. Run draft calculations outside the editor process with execution limits; a worker alone is not a security sandbox. Do not activate invalid output or persist a second copy of formula source in JSON. The prototype must reject incorrect inputs, wrong return shapes, incompatible helper changes, and invalid parameter bindings before making embedded editing a general feature.

The authoring workflow remains inspect field, tune parameters or open its function, preview effects, and save. A Formulas workspace provides a searchable index of these same functions and consumers. The read-only player build includes resolved content, not editing or execution services.

## Consolidated content model

### Progression, materials, items, and production

One ordered progression table covers all tiers. A material has one identity; tier rows reference materials and the production families available there. Do not require every tier to provide every resource, weapon, food, and tool.

Gathering resources and crafting recipes remain different gameplay concepts with one schema each across all tiers. Skill requirements can differ, but they reference the same progression and material definitions. A tier page shows acquisition, processing, recipes, equipment, and gaps together. Gathering and crafting are views of this system, not disconnected ladders.

Equipment families define shared slot/style/profile behavior. A tier selects which families to produce. Recipe templates generate repetitive processing and equipment recipes; unique items and recipes remain explicit. Generated IDs must be stable under display-name edits, with collisions rejected. Set membership and bonuses are authored once; kit grouping is a view, not another item catalog.

Before conversion, inventory near-duplicates and identify which materially differ in role, appearance, acquisition, or progression. Merge entries whose only difference is their old generator. Keep distinct gameplay choices. Do not perpetuate every existing item simply because it was exported successfully.

### Creatures, variants, and loot

A creature owns identity, presentation assets, behavior/combat profile, level or tier, loot, and availability. Lab-only versus world availability is an explicit field, not inferred from an old catalog name. Reusable combat profiles and shared curves replace source-family-specific scaling.

A variant references one base creature and declares differences such as appearance, name, scale, element, level, profile, and loot. No variant-of-variant chains. Show inherited versus overridden fields and the effect of editing a base. A substantially different boss can be independent. Allow turning a variant into an independent definition when appropriate.

Depth or region selects an effective encounter level; the same combat calculation applies everywhere. Do not replay the pre-Wilderness registry to create ordinary encounter aliases. An encounter referring to the same creature is not another creature definition.

Loot has one roll model. Reuse a named table when multiple creatures intentionally share it; keep a unique table inline when only one creature needs it. Editing a shared table shows its consumers. Avoid copying one table per enemy by default.

### World and other content

Separate reusable encounter composition from placement. Placement owns location, population, formation settings, and optional explicit anchor adjustments. The compiler/bake produces validated anchors and bounds. Authored and procedural placement modes share creature references and population rules. Generated placement results are not a second authoring store.

Resource nodes reference the same resources used by progression. NPC placements reference NPC definitions. Shops, quests, dialogue, spells, and audio keep meaningful domain schemas, but share references and editor conventions. Consolidate their historical subcatalogs where they represent the same concept; do not force unrelated mechanics into one universal record.

## Devdocs workflow

Primary content areas: Progression, Items, Creatures, World, People & Story, Abilities, and Assets. One Work queue brings requests and reviews together. Search and filters work across areas. Balance profiles live beside the domain they affect and link to the Formulas workspace and actual source functions. Raw JSON, generated records, and migration provenance are advanced inspection tools. Formula logic is maintained in typed source through Open in VS Code initially; the inspector provides interactive tuning and previews.

Items contains equipment, recipes, sets, and kits as related views. Creature pages contain combat, variants, loot, assets, and placements. People & Story links NPCs, shops, quests, and dialogue. Audio is managed through Assets and linked where used. These navigation groups do not require merging every underlying file.

Core workflow: create from a template or existing definition, change authored fields, preview the result in context, inspect affected content, save. Add duplicate, variant, dependency-aware rename, and delete actions. Deletion shows consumers and requires references to be resolved. Bulk changes validate and save as one transaction.

Example: adding a material tier should require its progression row, materials, selected equipment/production families, and acquisition settings. The editor creates or previews the corresponding items and recipes without requiring manual edits to gathering tiers, crafting tiers, equipment rows, kits, and loot generators separately.

Example: adding an ice creature selects a base and changes its appearance, element, level/profile, and drops. Preview it in the lab, then place it through World. No new source family, enemy alias, or TypeScript union is required. Creature reskins still follow the repository's image-generated texture requirements.

## Work sequence and completion gates

1. **Reset contracts and inventory.** Pause unfinished legacy work. Review uncommitted changes and retain useful independent fixes without carrying obsolete architecture forward. Record duplicate-content merge decisions and intentional gameplay changes. Freeze the authored definitions, compiler result, diagnostics, source-map, and editor transaction contracts. Keep a rollback snapshot. Check saved-game references before removing IDs; use a bounded one-time migration where needed rather than permanent aliases.

2. **Prove progression end to end.** Implement the compiler foundation and unified progression/material/item/recipe/resource definitions. Convert representative low, middle, and high tiers, including former gathering, regional, and Wilderness examples. Build the combined tier editor and template preview. Implement typed formula contracts and registry, per-field inspectors, parameter editing, example cases, impact previews, source navigation, and checked rebuilds after source edits. Prove a formula logic change in the actual TypeScript module updates generated gear across those tiers and that a type error leaves the last valid catalog active. Evaluate embedded editing only through the bounded prototype described above. Prove adding a tier and a unique exception without code changes. Exercise real gathering, crafting, equipping, and inventory effects. Then convert remaining progression content and remove the old tier schemas, generators, and editor pages.

3. **Replace creature and loot authoring.** Merge species/combat ownership, introduce named profiles and direct variants, consolidate duplicate loot, and build the creature editor around these inputs. Accept a normal creature, visual variant, caster, and unique boss in production-backed lab fixtures. Verify inheritance, overrides, combat, animation, and drops. Convert remaining creatures and remove alias/source/descendant/formula ownership machinery as its consumers move.

4. **Replace world content assembly.** Build the encounter/placement editor and map controls, including add/remove, centre dragging, population edits, and anchor adjustments. Migrate resource clusters and creature/NPC placements. Replace Wilderness registry replay with shared level scaling. Prove reusable formations and interactions in the lab; then validate full-world terrain fit, spacing, navigation, population, and traversal. Delete parallel legacy placement stores and generators.

5. **Complete the authoring app.** Apply the consolidated navigation; complete create/duplicate/variant/rename/delete and transactional bulk operations. Migrate remaining NPC/shop/quest/dialogue/spell/audio sources to consistent references and editing. Finish one candidate upload, comparison, review, and promotion path for assets, with per-set/per-piece notes where needed. Preserve the current useful viewers, search, inline editing, themes, conflict handling, and requests.

6. **Finish runtime, player mode, and cleanup.** Point all runtime consumers and the read-only player guide at the compiled catalog. Replace the Astro guide and connect the existing deployment workflow. Remove replaced loaders, catalogs, formula handlers, promote scripts, migration-only tests, and obsolete docs. Document only the new content-creation workflows. Run final content, build, browser, gameplay, and deployment-build checks.

Each domain conversion includes deleting its superseded path. There is no final milestone that merely promises to remove an indefinitely running compatibility layer. Old M6-M10 work is incorporated above, not silently dropped; its migration constraints are superseded.

## Reuse, retirement, and acceptance

Reuse validated assets, viewers, editor shell, JSON parsing/validation, canonical writing, conflict-safe saves, bulk transactions, metadata, and useful production math and lab fixtures. The recently extracted legacy data is conversion input and diagnostic evidence, not the desired permanent schema.

Retire catalog-name unions, exact registration-order reconstruction, duplicate output ownership, derivation tags, saved-value drift controls, and manual formula reconciliation. Remove test expectations whose only purpose is reproducing the old implementation. Preserve tests for intentional mechanics and replace legacy comparison assertions with the new requirements.

Acceptance requires:

- A new tier, equipment family member, recipe, creature variant, and encounter can be authored through data and Devdocs without TypeScript changes for existing mechanics.
- Every editable gameplay value has one source owner. Generated outputs are deterministic and cannot disagree with saved inputs.
- Each calculated field exposes its formula, inputs, tunable parameters, and consumers. Source navigation opens the correct TypeScript function. Tests prove that parameter and source changes reach the same compiled results, while type errors and invalid outputs leave the last valid build active. Embedded editing is not accepted unless its prototype demonstrates actual project type checking, reliable file edits, and conflict/draft handling.
- Changing a shared material/profile/base shows its consumers and updates the expected results. Unique adjustments remain explicit and stable.
- Duplicate IDs, broken references, invalid variants, and invalid world placements produce actionable diagnostics; failed saves/builds leave a usable last valid state.
- Real Chromium editor workflows and production Vite gameplay pass semantic before/after checks. Relevant screenshots are inspected at gameplay-achievable camera settings. Reusable content is accepted in the feature lab before final-world integration; authored full-world exceptions follow `docs/world-authoring.md`.
- Removed models are absent from active schemas, navigation, runtime imports, and documentation. Remaining differences from the old game are documented as intentional content/balance decisions rather than hidden behind compatibility code.

Root owns architecture, shared contracts, integration, and combined acceptance. After each contract is frozen, bounded implementation tasks can run in parallel with explicit non-overlapping file ownership: Astra for compiler/model/world complexity, Luna at max effort for bounded UI, conversion, documentation, and focused test work. Fresh read-only critics review each integration round. Do not parallelize a broad conversion before the first end-to-end workflow proves the simpler design.


## Completion record ? 2026-09-13

Implemented with Astra at medium effort for compiler, creatures, world, formulas and transaction work; Luna at max effort for bounded UI, assets, deployment, documentation and test retirement. Root integrated the shared contracts and runtime. A fresh read-only architecture review identified last-valid-runtime, watcher and adjustment issues that were corrected before acceptance.

- Unified progression, material assignments, equipment families and recipe templates replace the separate low/regional/Wilderness authoring ladders. Nine authored tiers generate 151 equipment members and 236 recipes; unique records remain explicit.
- Creature definitions and direct variants use six combat profiles and 48 shared loot tables. Stable references remain; keeper-specific rewards are explicit. Final-world encounters and placements read the accepted compiled catalog.
- The editor has task navigation, combined progression, generated-result inspection, source links, checked formula rebuilding, record operations, transactional preview/save, conflict-preserved drafts, a world map and the asset candidate workflow.
- The static player guide uses the same resolved content bundle. The Astro application and manual drift/recompute/export paths are retired. Runtime packaging omits duplicated authoring geometry and source-map metadata.
- Removed 63 obsolete test files and roughly 9,900 net lines of legacy test assertions. Kept mechanics, persistence, references, geometry, asset integrity, conflicts and last-valid-build protection. The full suite ran once; subsequent runs were limited to failures and new requirements.

Final verification:

- TypeScript project check, content compilation, game production build and static player-guide build pass.
- Chromium combat lab passes equipment, melee, spells and bank transfers; final-world smoke passes boot, navigation, real input, bank transfers and reset with no browser errors.
- Chromium editor smoke passes a source edit, preserved conflict draft, invalid transaction protection, data-added tier/item/variant, and map-authored encounter/placement save. Its temporary new item intentionally has no icon.
- Focused tests prove deterministic expansion, explicit adjustments, invalid variants/references, actual TypeScript source updates with cross-file type-error rejection, asset upload/review/promotion/archive, and regenerated navigation/world artifact integrity.
- Screenshots were inspected from the production lab and editor. The migrated authored world uses the documented full-world exception; no reskins or new art were produced. Per the user's instruction, implementation preceded the final testing phase.

Disposable logs and screenshots live under `test-results/`; the full-world smoke report is under `runs/simplification-acceptance/`. They are not promoted to committed evidence. A rollback snapshot of the initial dirty checkout is retained at `C:/Users/Borg/AppData/Local/Temp/corealm-simplification-20260913-204159`.

No deployment or commit was performed. Embedded TypeScript editing remains outside the accepted scope, as specified above; formulas use the checked source-navigation workflow.
