# M6 spawn and map contracts

Status: storage schemas for groups, habitats, source records, clusters, legacy placements and regional packs frozen by root for isolated implementation, 2026-09-13. Generator parameters, runtime integration and editing workflow remain proposals. This document changes no production files. The approved scope is [PRD M6](./PRD.md), with [world authoring](../../docs/world-authoring.md) and [feature lab](../../docs/feature-lab.md) gates. Root owns shared schemas, integration, the world bake and acceptance. Freeze a bounded storage slice before assigning workers.

## Findings that affect the boundary

The baseline has eight top-level `RegionDef` objects and nine semantic region IDs. Gravelmaw is `karrowmoor.dungeon`, not a ninth terrain region. Write nine spawn files, but preserve the existing eight-region array and nested dungeon. `DungeonDef` has enemy groups and no resource-cluster field.

The following counts came from read-only imports of `.baseline` on this run. They are exporter assertions, not new population targets.

| Region | SOURCE_REGIONS groups | REGIONS groups | Clusters |
| --- | ---: | ---: | ---: |
| fallowmarch | 24 | 32 | 5 |
| vellenwood | 18 | 30 | 4 |
| karrowmoor | 16 | 28 | 6 |
| kilnhalt | 14 | 26 | 5 |
| wilderness | 61 | 73 | 10 |
| crownward | 17 | 17 | 10 |
| gloamgarden | 13 | 13 | 5 |
| faeholme | 13 | 13 | 5 |
| gravelmaw dungeon | 7 | 7 | absent |

There are 213 `WORLD_HABITATS`, 96 source regional packs and 16 activated regional packs. Source regional packs are a separate catalogue. They must not all enter `REGIONS`. `SOURCE_REGIONS` has 176 surface groups, while `REGIONS` has 232. Neither is the final actor count.

Seventeen inspected M6 content modules are byte-identical to `.baseline`. `biomePopulation.ts` differs because its replacement lookup now reads the M4 enemy alias view. Export original inputs from `.baseline`; test the current public view independently. Do not reverse-engineer the source from the current final projection.

The PRD's listed modules omit dependencies that materially affect live placements: `rpgRegionalPacks.ts`, `regionalPackActivation.ts`, `regionalPackLayout.ts`, `world/universalMinibossSockets.ts`, `wildernessExpansion.ts`, and runtime resident spacing. These must remain in the dependency manifest and parity suite. Moving only `regionalPacks.ts` would leave live regional anchors generated from asset bounds in `app/boot.ts`.

## Exact storage contracts

Use the existing strict schema combinators. Every object below rejects unknown keys; optional fields preserve absence. `Id` is a nonempty string, `N` a finite number, `P` a finite positive number, `NN` a finite nonnegative number, `I` a positive integer, and `I0` a nonnegative integer. `Spot=tuple(N,N)`, `Vec3=tuple(N,N,N)`, `Bounds={min:Spot,max:Spot}` with both maxima greater than minima. Coordinates are metres and yaw is radians. Do not round exported coordinates, scales or anchors.

`RegionId` is exactly `fallowmarch|vellenwood|karrowmoor|gravelmaw|kilnhalt|wilderness|crownward|gloamgarden|faeholme`. `PackRegionId` is exactly `fallowmarch|vellenwood|karrowmoor|kilnhalt`. `Activity` is exactly `graze|forage|prowl|patrol`. `Rank` is exactly `ordinary|seasoned|mature`. References use the existing asset, creature, enemy and resource collections plus validated spatial lookup indexes; a species reference and an enemy-block reference are never interchangeable.

`GroupFields` is the exhaustive runtime group schema:

```ts
{
  id: Id, family: Id, name: nonemptyString, tier: I, count: I,
  countPolicy?: 'fixed', legacyCount?: I,
  centre: Spot, radius: NN, assetId: AssetRef, scale: P,
  boss?: boolean, miniBoss?: boolean
}
```

Require that boss and miniBoss are never both true. Preserve explicit false values if present in the original. Source groups may have ordinary counts below seven; final ordinary groups require 7..15, fixed groups 1..15, and bosses/minibosses one. Do not apply the final-count constraint to source records. `legacyCount` retains the original count; it is not replaced with the final count.

`Dressing` is exactly `{id:Id,assetId:AssetRef,x:N,z:N,yaw:N,scale:union(P,tuple(P,P,P)),sink?:N}`. IDs are unique within one habitat, not globally. Preserve dressing array order.

`HabitatFields` is exactly `{id:Id,groupId:GroupRef,regionId:RegionId,centre:Spot,radius:NN,roamRadius?:NN,boundary?:'playable-coast',anchors:Spot[],activity:Activity,dressing:Dressing[]}`. The runtime type permits coastal boundaries; persisted authored rows must omit `boundary`. Coastal rows exist only in resolved output. A habitat's centre/radius need not equal its group's source centre/radius. The old source and accepted formation intentionally differ in several rows.

Files under `game/content/data`:

| File | Exact row/envelope contract |
| --- | --- |
| `spawns/<regionId>.json`, nine files | Ordered array of `SpawnRecord` below. A row's region must match the file. Gravelmaw attaches only to its parent dungeon. |
| `spawnSources.json` | Ordered array `{id:Id,catalog:SourceCatalog,regionId:RegionId,group:GroupFields,habitatInputId?:HabitatInputRef}`. `id` identifies the source row, such as `regions/redsill_frogs`; it is distinct from `group.id`. |
| `habitats.json` | Ordered array of accepted `HabitatFields` plus `sourceInputId?:HabitatInputRef,derived?:FairyDerivation`. All runtime lookup values come from this file. |
| `habitatSources.json` | Ordered array `{id:Id,catalog:HabitatSourceCatalog,habitat:HabitatFields}` containing original source habitat values before final population formation. Generated source anchors are named generator outputs, not mislabeled literal inputs. |
| `resourceClusters.json` | Ordered array `ClusterRecord` below. Filter by region in the recorded array order. No synthetic Gravelmaw cluster list. |
| `legacyEncounterPlacements.json` | Ordered array `LegacyPlacement` below, keyed by original group ID. |
| `regionalPacks.json` | Strict envelope with `sources`, `packs`, `assignments`, `activation`, `layouts`, `accepted` as specified below. Source and accepted pack arrays remain distinct. |
| `balance/spawns.json` | Strict `SpawnBalance` block specified below. No expression strings, arbitrary override bags, source code or output-backed generator inputs. |

`SourceCatalog` is exactly `region|dungeon|regionalVariant|starter|redWorm|creatureExpansion|wilderness|deepWilderness|crownward|fairy|biomePopulation`. `HabitatSourceCatalog` is exactly `world|regionalVariant|amethystCave|starter|redWorm|creatureExpansion|wilderness|deepWilderness|biomePopulation|fairyTerrace`. Capture private arrays separately where a public aggregate contains the same rows more than once. Catalogue membership is represented by references in the source manifest rather than duplicate owners.

```ts
type FairyDerivation = {
  kind: 'fairySpawn.v1'; source: 'terrace' | 'crown'; siteId: Id;
};
type SpawnRecord = GroupFields & {
  regionId: RegionId;
  source: SourceCatalog;
  sourceInputId: SpawnInputRef;
  authored: boolean;
  legacyOverride?: LegacyPlacementRef;
  derived?: FairyDerivation;
};
type ClusterRecord = {
  id: Id; regionId: RegionId; resourceId: ResourceRef; count: I;
  centre: Spot; radius: NN; locationId: LocationRef;
  waterBodyId?: Id; ringRadius?: NN; heroAssetId?: AssetRef; heroScale?: P;
  essenceElement?: SpellElement;
  source: 'regions' | 'wildernessResources' | 'crownward' | 'fairyRegions';
  derived?: {kind: 'fairyResource.v1'; intentId: Id};
};
type LegacyPlacement = {
  id: GroupRef; regionId: RegionId; originalCentre: Spot; originalCount: I;
  centre: Spot; count: I; radius: NN; bodyRadiusBudget: P;
  anchors?: Spot[]; anchorOnly?: boolean;
  floorRect?: {centre: Spot; halfExtents: tuple(P,P)};
  rotationY?: N;
};
```

`source` selects a closed source family; it does not authorize writes. `authored=true` means this accepted placement is editable, not that every field was a literal in the old code. Fairy spawn and fairy resource rows require `authored=false` where that field exists and a matching derived tag. Bosses in fairy regions are also locked. Coastal generation and universal seeded minibosses are absent from the authored spawn files; both appear as read-only resolved actors. Export all existing fairy region groups, not only terrace residents.

Each final spawn references exactly one real input. Many output fields legitimately remain explicit accepted values. Do not call them formula-derived unless their original input and arithmetic were extracted. Do not infer a count or centre from a final record to regenerate that same record. Group IDs may occur in distinct source and accepted views, but a final actor-producing group ID has one owner after activation/exclusion. In particular the starter/variant groups reuse reservations from the staged regional pack catalogue.

The provenance manifest is separate from game records. It stores relative module path, export/private symbol, literal row index where applicable, source hash, source-input ID and ordered view memberships. Source hashes, helper probe outputs and acceptance reports are evidence, not gameplay parameters.

### Regional packs

`sources` is the ordered original `PackSource` array, exactly `{id:Id,assetId:AssetRef,scale:P,baseEnemyDefId:EnemyRef,activity:Activity,nativeBodyRadius:P,nativeVisualRadius:P}`.

`packs` stores original authored rows, exactly `{id:Id,regionId:PackRegionId,settingId:Id,sourceGroupId:PackSourceRef,centre:Spot,radius:P,count:I}`. The ID remains `pack_<region>_<setting>`. Keep the original 24 rows per region in their current region order. Do not recreate their ordinal assignments by sorting IDs.

`assignments` is an ordered array `{packId:PackRef,speciesId:union(CreatureRef,null)}`. Materialize `RPG_REGIONAL_PACK_PLAN`'s final assignment for each stable pack ID, preserving its explicit nulls. Keep original ordinal assignment rows and accepted replacements in the export manifest as input evidence; a null assignment means use the original wildlife. An absent activation override means use the assignment, while an explicit null override means restore source wildlife.

`activation` is exactly `{regions:PackRegionId[],excludedPackIds:PackRef[],assignmentOverrides:{packId:PackRef,speciesId:union(CreatureRef,null)}[]}`. Reject duplicate regions, exclusions and override IDs. Preserve current activation; editor placement changes never activate a staged region or remove an exclusion.

`layouts` is an ordered array `{packId:PackRef,dressing:Dressing[]}`. Preserve empty dressing. Move `purpose` to meta. Do not activate dressing merely because the pack or species changes.

`accepted` is an ordered array with the runtime spatial fields of `RegionalPackDef`: `{id:PackRef,regionId:PackRegionId,speciesId:Id,baseGroupId:Id,baseEnemyDefId:EnemyRef,assetId:AssetRef,scale:P,activity:Activity,centre:Spot,radius:P,anchors:Spot[],members:{id:Id,anchorIndex:I0,variantId:Id}[],settingId:Id,levelRange:tuple(I,I)}`. `speciesId` remains `Id` here because original source packs use enemy family strings; validate it according to original/replaced assignment, rather than imposing a false creature reference on legacy wildlife. `variantId` resolves through the regional variant catalogue, not only the M4 canonical enemy registry. Preserve current member IDs, member order, anchor indexes and variant ranks.

Export accepted results for the exact live activation/override selection with current manifest measurements. Do not silently switch the 16 live packs to all 96 staged results. The existing `createRpgRegionalPackCatalogue(measurement,packIds?,assignmentOverrides?)` remains a public computation helper for labs, previews and callers with explicit alternative assignments. Final boot switches to stored accepted values. These two paths need separate parity tests. Changing a live assignment requires explicit recompute and validation of its accepted record before it can be used.

Regional variant combat formulas remain the M4 formula stage's responsibility. Their helper outputs and references must be preserved during M6; storing spatial packs must not expand M4's claimed combat-formula coverage.

### Spatial balance and source generator inputs

The first frozen `SpawnBalance` schema should be exactly:

```ts
{
  population: {minimum:I,maximum:I,bodyGap:NN},
  silhouettes: {bossMultiplier:P,miniBossMultiplier:P},
  populationRadius: {bodyDiameterMultiplier:P,bodyGap:NN},
  starterWildlifeBounds: Bounds,
  legacyCaveFloors: {id:LocationRef,originalRadius:P,radius:P,centre:Spot}[],
  sharedStarterReservations: {groupId:GroupRef,packId:PackRef}[],
  reservedVariantPacks: {speciesId:CreatureRef,packId:PackRef}[]
}
```

Original literals are population `7,15,.5`, silhouette multipliers `1.6,1.3`, population-radius diameter multiplier `2` and gap `.5`, and starter bounds `[-278,-190]..[-25,60]`. Keep `tierSilhouetteScale` as the existing shared pure dependency; do not reimplement its tier arithmetic inside the map. Read fantasy group replacements and boss body references from M4's current directional mappings. The reserved universal body remapping stays its existing pure transform with explicit species dependencies and parity until a separate parameter extraction is frozen.

`populationGroup`'s count selection, `Math.ceil(Math.sqrt(count)-1)` radius expression, legacy centre override and boss radius behavior must retain evaluation order. `fantasyEncounter` keeps the identical object when no replacement applies and preserves all identity/count fields on a replacement. Boss scale remains `body.scale / tierSilhouetteScale(group.tier) / rankMultiplier`, in that order.

M6 storage can materialize original generated spatial source views, provided the manifest labels them as generator outputs and wrappers preserve their source meaning. Extracting *all* starter, Wilderness, biome, regional-ring and fairy arithmetic into editable parameter JSON is a later bounded substage requiring separately frozen discriminated input rows. Do not conceal that remaining work in a general `inputs` object or claim those generated rows are original literals. The mandatory first-stage behavior change is storing accepted anchors, not rewriting every spatial generator.

## Runtime views and metadata

Introduce a loader module that imports only validated JSON and type-only runtime types. It constructs source and accepted indexes without importing `regions.ts`, `worldHabitats.ts`, the content registry, terrain or renderer. Strip record metadata from every runtime projection.

`regions.ts` retains settlements, locations, roads, landmarks, obstacles, portals, bounds and dungeon geometry in TS. Reconstitute `SOURCE_REGIONS` with source group references in the exact original assembly order. Reconstitute `REGIONS` with accepted group rows directly, preserving the eight-region order and the nested dungeon. Do not call the old final population projection again on already accepted rows. The Kilnhalt route additions and cave floor intent remain intact.

Preserve `WORLD_HABITATS` as surface-only. `habitatForGroup` still reaches dungeon habitats and returns `null` on a miss. Do not filter dungeon rows out of the lookup just because they are absent from the surface dressing array. `habitatContains` retains its current rules: radius first; playable coast bypass; dungeon circle; fairy region rectangle without the core `WORLD_BOUNDS` test; ordinary region rectangle intersected with core bounds.

Existing per-module exports become filtered source views, with reference/order/absence parity. Preserve helper signatures and direct custom-input behavior; runtime stored values are not permission to replace a helper with an argument-ignoring lookup. In particular `resolveBiomePopulation(species)`, `resolveDeepWildernessPacks(species)`, `createLegacyEncounterFormation(group,options)` and `createRpgRegionalPackCatalogue(...)` still need meaningful explicit arguments and original error cases.

Move habitat notes to `game/content/meta/spawns.meta.json`. Its per-group note payload preserves `speciesId,enemyDefId,groupId,habitatId,settingId,rationale,riskNotes,movementDomain:'ground',enabled:false,status:'proposed_pending_lab_and_world_acceptance',nearestScreenedExclusion:{id,kind,gapMetres},dressingNotes,dressingBodyRadius?`. These historical `enabled/status` values are evidence, not runtime activation flags. Legacy placement `reason`, regional `rationale`, `placementRisks`, and layout `purpose` also go to this meta collection using explicit optional schemas. Update note-reading tests rather than importing meta into the game. Player bundles exclude the whole meta tree.

## Export and parity sequence

1. Add `tools/content/m6-baseline.ts` before changing source modules. Bundle only `.baseline`, using the M4 approach to append private exports in memory. Inventory all public exports and source aggregates plus private authored habitats, Wilderness groups/sentry anchors, pack tuples and original assignment lists. Record every imported dependency hash. No writes on import; exporter defaults to dry-run.
2. Capture source and accepted group views, habitat lookup for every surface/dungeon group, source habitats, clusters, placement overrides, regional catalogues, activation IDs and helper probes. Capture absent properties separately from explicit undefined in evidence. JSON must not gain undefined values.
3. Record `SOURCE_REGIONS` and `REGIONS` full structural snapshots, omitting no TS-authored nonspawn fields. Freeze the count table above, source-view orders, final group order, cluster order, anchor order, member order and habitat/dressing order. Store the identity manifest outside shipped data.
4. Export JSON from original literals or explicitly named original generator results. Validate it in memory. Reconstitute the source views from proposed records and compare every runtime field with baseline before writing. Require exact numeric equality for stored `Spot` values. Compare stored accepted anchors with the original formation results before manifest growth or map editing.
5. Replay helper probes, including custom species lists, missing species, missing measurements, unknown pack selections/overrides, null versus missing assignment, fixed counts, old one-member IDs, count limits, insufficient floors, anchor-only layouts and radius budgets. Preserve formation fallback behavior for explicit recompute: preferred anchors can fail and retry an ordered grid; a validator must never silently apply that fallback to persisted anchors.
6. Compare initial semantic enemy/boss/resource rows from the real world pipeline and compare post-spacing positions with identical seed, terrain, assets, access positions and ports. A bare `buildWorld(seed,()=>0)` is not a resolved-world oracle. It omits active regional packs, solved floor/water, late residents and final spacing. Keep such a build only as an additional deterministic unit probe.

## Identity, validation and revisions

`encounterActorId` preserves a bare group ID for index zero when `legacyCount===1`; otherwise it emits `<groupId>_<index+1>`. Regional pack member IDs are explicit and take precedence. Resource IDs are `<clusterId>_<index+1>`, with `worldSiteResourceSlot(cluster.id,index+1)` taking precedence over procedural placement. A resource centre drag must show that fixed world-site slots may remain unchanged; editing a cluster never silently relocates a TS-authored site or creates a second fishing basin.

`mobSpawnCache.ts` checks `placements[index].id===ordinary[index].id` and hashes ordered input mobs/habitats. Preserve ordering even when each record has the same values. The build uses a shared world RNG stream across region/entity construction, so sorting clusters or groups can change later positions. Identity checking must compare ordered source groups, accepted groups, counts, legacy counts, regional members and resource IDs against HEAD. Do not bypass the existing `--allow-identity-change` requirement.

Validation hooks, shared by CLI and API:

- Strict parse and unique keys first. Validate references, file/region ownership, input graph acyclicity and derived/source consistency. A final row may not reference itself as its source input.
- For accepted ordinary groups validate fixed/nonfixed bounds, count/anchor coverage, rank flags, known footprint, and preserved IDs. Validate every stored anchor without regenerating or reordering it. A separate `recomputeFormation` returns a preview with old/new coordinates and diagnostics.
- Test roots against habitat containment and whole body envelopes against the actual production floor constraints. Preserve the `1e-6` formation tolerance, legacy body budget, anchor-only rule, floor rectangle and rotation conventions. Check pair separation and occupied dressing, not only centres inside circles.
- Lift the pure `disc`, `box` and segment-distance helpers from `tools/biome-population-audit.ts` into `tools/lib/reservations.ts`. Keep TS geometry as reservation input. Its box gap is zero inside a box, not a signed penetration distance; subtraction of pack/body radius supplies overlap. Preserve that behavior before changing diagnostics.
- Map validation uses current measured bounds, `ENCOUNTER_ASSET_RADII`, production silhouette/rank scaling, shared reservation ownership, regional activation and source-specific constraints. A grew model blocks save/check with `FORMATION_STALE` and a recompute preview. It never silently expands the live radius or moves saved anchors at boot.
- Spatial validation is not terrain/navigation proof. The full world gate validates dry receiving floor, solids, navigation, site overrides, final mob spacing and cache reuse. Keep the existing final spacing algorithm; M6 stops source habitat re-layout, not the production collision/spacing pass.

`tools/lib/generation-revision.ts` already recursively hashes `game/src`, `game/content/data`, the asset manifest and lockfile, while excluding `content/meta`. Preserve that existing coverage. Tests must show a spawn/anchor/activation edit changes the revision and a note edit does not. `spawns/world` cache compatibility is proven by identity/order/position parity, not by suppressing a legitimate revision change. Root runs `npm run world:build` after integration and checks shipped-world and navigation artifact tests.

`GET /__devdocs/resolved-spawns` returns a strict envelope `{generationRevision:Id,contentRevision:Id,seed:I0,actors:ResolvedActor[]}`. `ResolvedActor` is exactly `{id:Id,archetype:'enemy'|'boss'|'resource',regionId:RegionId,position:Vec3,groupId?:Id,habitatId?:Id,enemyDefId?:Id,resourceId?:ResourceRef,source:'authored'|'regionalPack'|'coastal'|'universalMiniboss'|'fairy',editable:boolean}`. The dump filters the production resolved semantic state; it does not approximate final positions from JSON centres. Stale revisions are labeled and disable claims that a drag is already reflected in the baked world. This generated dump is disposable and absent from the gameplay input revision hash.

## Map projection and editing

Use `WORLD_MAP_IMAGE_BOUNDS`, `WORLD_MAP_DETAIL_RENDITIONS` and `WORLD_MAP_TILED_LEVELS` from `game/src/generated/worldMapFingerprint.ts`. Current image bounds are x=-650..1000, z=-450..1200. Playable map bounds are x=-560..910, z=-410..1150; core authored `WORLD_BOUNDS` is a third, different rectangle. The map background does not define habitat legality.

Use world-metre SVG coordinates: `(x,z)->(x,-z)`, inverse `(sx,sy)->(sx,-sy)`, `viewBox="minX -maxZ width height"`. Convert pointer coordinates through the actual stage `getScreenCTM().inverse()`, including scroll/pan/zoom and CSS sizing. Do not round the inverse to pixels before editing. For a tile, x=`minX+column*tileMetres`, SVG y=`-maxZ+row*tileMetres`; use manifest paths and actual dimensions. Current detail sizes are 1650/3300/6600 and tiles are 600 px, 150 m, 11 by 11. Use 1650/3300 first and request visible tiles above zoom 4. All URLs use `gameUrl()` with paths such as `generated/world-map-detail-1650.webp`; no leading slash.

Fairy regions already occupy world coordinates x=2000..2600, with Gloamgarden z=-200..130 and Faeholme z=130..460. They have no matching surface basemap in this fingerprint. Supply separate read-only realm views from their bounds, with honest blank/vector backgrounds. Do not subtract 2000 from stored positions or paint surface tiles behind them. Gravelmaw overlaps surface x/z and uses a dungeon floor; its layer must filter by region ID and show its TS chamber/door geometry separately.

Local layout transforms are not all the same sign convention. Wilderness court/sentry positions use `worldX=siteX+localX*cos(yaw)+localZ*sin(yaw)` and `worldZ=siteZ-localX*sin(yaw)+localZ*cos(yaw)`, with formation rotation often `-site.rotationY`. `createEncounterFormation` uses `x*cos-z*sin, x*sin+z*cos`. Persist world anchors as emitted; use the appropriate existing helper for recompute. Fairy garden anchors add literal offsets to the site centre and split the seven offsets by parity into four and three fixed residents.

Pure editing functions take a validated draft plus validation context, return a new draft and diagnostics, and never write files. `moveCentre` translates centre and all ordered anchors by one delta; world-space dressing belonging to that habitat translates by the same delta. Source legacy overrides must be edited in the same preview, or the transaction is rejected as contradictory. `moveAnchor` changes exactly one anchor and clamps to the valid region/world/radius intersection, then validates the body envelope. `setRadius` never recomputes anchors implicitly. History snapshots preserve IDs, order and optional absence. Server mutations use existing revision/409, diagnostics/422, locks and atomic file replacement; a pack/habitat/override edit requires a validated atomic multi-file transaction or one authoritative aggregate write, not sequential independent saves that can leave mixed revisions.

There is an explicit PRD tension to resolve before freezing write endpoints: R5 asks to add/remove packs and edit count, while R2 and the save-identity rules make IDs/count/legacyCount/order read-only and CLI identity changes opt-in. Safe M6 default is editable geometry/activity, read-only persisted identity, and add/remove/count experiments in unsaved previews only. Root must explicitly choose a separate identity-change workflow before enabling those writes. Do not smuggle an `allowIdentityChange` flag into the normal browser save request.

## Persistent fixture and acceptance rounds

First build the production map components and editing/validation helpers in a persistent deterministic editor fixture. Use the actual API/store transaction path against an isolated fixture content directory, not production JSON. Include an ordinary legacy group, fixed group, old one-member group, two shared reservations, active/staged regional packs, a resource cluster with world-site slots, a fairy row and a coastal resolved row. If the current lab cannot host the map UI, add a map workbench that mounts the same components; no second geometry model or fake save implementation.

Chromium proof must exercise real pointer/keyboard actions. Compare semantic draft and saved store state before/after centre drag, one-anchor drag, radius change, undo/redo, save, reload and conflict. Assert exact anchor deltas and unchanged actor IDs/count/order. Verify an invalid overlap, stale footprint and revision conflict write no files. Verify derived layers expose no editing controls and server writes are rejected. Pan/zoom across tile boundaries and inspect screenshots for alignment, readable numbered anchors and usable side panels in light/dark themes. Check the player build has no write controls or meta and its game assets resolve under a non-root deployment base.

After root accepts the compact UI/formation fixture, wire the JSON views into the real game. The authored full-world migration uses the documented world-layout exception because isolated terrain cannot prove final receiving floors or cache identity. The reusable map UI and formation controls have already passed the lab. Root alone runs combined checks, world bake and final-world play, with normal achievable camera angles, semantic state comparisons and relevant placement screenshots. A fresh-context read-only critic reviews evidence after those gates. No production change is accepted on source review alone.
