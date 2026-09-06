> Current proposed population: seven explicit accepted-source assignments are exported as `RPG_ACCEPTED_SOURCE_PACK_ASSIGNMENTS` in `rpgRegionalPacks.ts`. They add Mossback, Beetle, Shale, Lava, Spider and Wasp to existing pockets. The three stable Fire Golem packs now use the promoted Lava model through bestiary's alias. Earlier retained15 and Fire rejection notes below describe prior source stages; no rejected Fire model is selected by the current catalogue. Iron material remains unresolved. Population is still unactivated.

> Roster correction: source-round7 is not accepted for world activation. The active pack assignment now uses only the 15 retained goblin, skeleton, zombie, wraith and golem species. Rejected families are absent from the active assignment. The spider and fantasy bee have completed natural lifecycle and been promoted; neither is assigned to these packs yet. Fire Golem is rejected and Iron Golem material remains unresolved, so the staged fifteen-species population is not accepted for activation. All 96 centres/radii, 558 saved member IDs/counts and existing setting pieces remain fixed; internal resident rings are recalculated from replacement dimensions and must pass the same formation/navigation checks. `REGIONAL_PACK_LAYOUT` stores frozen props independently of creature family. Optional third factory argument accepts pack-ID occupant overrides; `regionalPackReplacements({ oldSpecies: newSpecies })` expands explicit species replacements to stable pack IDs. Region mismatch or invalid measurement fails construction. This does not grant world activation.

# Regional pack integration

This is a root wiring checklist, not acceptance evidence. The catalogue remains staged. Enable
the final-world path only after the source models and compact pack lifecycles pass their visual
and behavioral gates, followed by the generated-world spatial audit.

## Catalogue and stats

In `game/src/app/boot.ts`, immediately before the current pack fixture block near
`const rpgPackCatalogue`, construct a full catalogue for the accepted game profile. Reuse the
existing measured adapter. The acceptance decision belongs to root; a URL parameter alone must
not activate the final-world population.

```ts
const worldPackCatalogue = profile.kind === "game" && regionalPacksAccepted
  ? (await import("../content/rpgRegionalPacks.js")).createRpgRegionalPackCatalogue((id) => {
      const entry = assets.entry(id);
      return entry?.base ? { size: entry.size, base: entry.base } : null;
    })
  : undefined;
const packBuilder = worldPackCatalogue
  ? await import("../world/regionalPackEntities.js") : undefined;
const worldHabitats = [...WORLD_HABITATS, ...(worldPackCatalogue?.habitats ?? [])];
const worldPackHabitats = new Map((worldPackCatalogue?.habitats ?? [])
  .map((habitat) => [habitat.groupId, habitat]));
if (worldPackCatalogue) {
  const enemies = new Map(content.allEnemies().map((enemy) => [enemy.id, enemy]));
  for (const variant of worldPackCatalogue.variants) enemies.set(variant.id, variant.stats);
  content.register({ enemies: [...enemies.values()] });
}
const buildWorldPackEntities = () => worldPackCatalogue!.packs.flatMap((pack) =>
  packBuilder!.assembleRegionalPack(pack.id, {
    heightAt: (x, z) => scene.meshHeightAt(x, z),
    baseY: worldPorts.baseY, assetSize: worldPorts.assetSize,
  }, { seed: store.get().meta.seed }, worldPackCatalogue).entities);
```

`regionalPacksAccepted` above is the root's acceptance decision, deliberately not a new exported
flag created by the encounter worker. Merge this with the existing lab-only registration rather
than replacing its stats. `content.register` replaces the enemies table supplied to it, so retain
the existing definitions.

The returned catalogue has 96 packs, 558 stable resident IDs and 141 used stat variants. The
selected models come from the asset registry. Do not use estimates from source documentation.

## Initial build and save rebuild

Immediately after each `profile.buildSemanticWorld(...)` call, append freshly constructed pack
entities. The initial path uses `built`; the shared reset/import path uses `rebuilt`.

```ts
if (worldPackCatalogue) built.entities.push(...buildWorldPackEntities());
// In rebuildSemanticWorld, before entityStore.load:
if (worldPackCatalogue) rebuilt.entities.push(...buildWorldPackEntities());
```

Both additions must precede `entityStore.load` and `rehydrateEnemyRuntimes`. Existing
`rebuildSemanticWorld` already covers reset, normal save import and recovery import. Preserve the
rehydration calls after the load. Fresh construction prevents dead health or moved coordinates
from leaking out of a cached assembly. The current world seed feeds appearance orientation while
member IDs, coordinates and source binding remain authored and deterministic.

This path owns the additional entities. Do not also append the same 96 projections to
`REGIONS.enemyGroups`, because its normal `buildEnemyGroup` loop would create duplicate residents
without the per-member variant bindings. If root instead chooses canonical region registration,
replace that loop's pack handling with the same assembler and remove these boot append calls.

## Habitat lookup and generated tree access

Extend the existing `EnemyAiSystem` `habitatForEntity` closure. Retain its fixture precedence and
return `null` when no override matches; the AI then uses its existing ordinary habitat lookup.

```ts
habitatForEntity: (entity: SemanticEntity) =>
  groundMotionFixture?.habitatForEntity(entity)
  ?? (packFixture && entity.meta?.groupId === packFixture.habitat.groupId
      ? packFixture.habitat : null)
  ?? worldPackHabitats.get(String(entity.meta?.groupId))
  ?? null,
```

Use `worldHabitats` in both existing boot loops that currently read `WORLD_HABITATS`:

1. The world-site dressing projection before static solids and navigation are built.
2. The `worldExclusions.addTreeClearance` loop before scatter generation. This loop already
   protects spawn bodies, browsing targets, patrol legs and return legs. Including all 96 pack
   habitats here is essential. A runtime-only AI lookup leaves generated trees in their paths.

A baseline audit before activation may therefore report trunks in pack corridors. Do not call
that evidence of an accepted final population. Repeat the audit against the actual combined
exclusion input after root accepts and enables the population.

## Dressing and navigation

`content/encounterDressing.ts` supplies five setting recipes to the 81 RPG habitats. The 15
retained wildlife packs remain undressed. Supply camps use ration crates, water barrels and a
rear barricade. Burial shrines use offering tables, stone grave markers and a chapel remnant.
Stone workings use split blocks and sorting crates. Roosts use exposed perches and fallen slabs.
Ritual courts retain an altar and broken rear wall. Tight formations use fewer pieces rather
than shrinking props. These are candidate compositions and still need compact visual review.

The same `world/regionalPackDressing.ts` builder must draw the lab and final world. It delegates
grounding and instancing to `buildWorldSiteDressing`, then adds measured collision boxes for
altars, fences, walls and whetstones that the generic site helper otherwise omits.

For compact lab acceptance, immediately after `const sitePlacements = []` and before nav creation:

```ts
if (packFixture?.habitat.dressing.length) {
  const { buildRegionalPackDressing } = await import("../world/regionalPackDressing.js");
  const largestBody = Math.max(...packFixture.entities.map((entity) => entity.combat?.bodyRadius ?? 0));
  const result = await buildRegionalPackDressing(scene, assets, packFixture.habitat, largestBody);
  sitePlacements.push(...result.placements);
  built.solids.push(...result.solids);
  for (const solid of result.navigationSolids) encounterNavSolids.set(solid.id, solid);
}
```

Declare `const encounterNavSolids = new Map<string, SolidVolume>()` beside `sitePlacements`.
The builder returns exact physical `solids` and separately expanded `navigationSolids`. The
expansion uses the actual largest resident body radius plus 0.15 m, keeping large actors clear of
setting corners on the shared player navmesh. Do not enlarge physical boxes or global nav settings.
Replace each setting's physical box only when creating navigation geometry:

```ts
let navCarves = solidObstacleMeshes(built.solids.map((solid) => encounterNavSolids.get(solid.id) ?? solid));
// Apply the same replacement when structure authoring rebuilds navigation:
const candidateCarves = solidObstacleMeshes(allSolids.map((solid) => encounterNavSolids.get(solid.id) ?? solid));
```

For the final-world `settings` loop, look up `worldPackHabitats.get(setting.locationId)`. When it
exists, call `buildRegionalPackDressing(scene, assets, habitat, largestBody)` instead of the generic builder.
Derive `largestBody` from `built.entities` whose `meta.groupId` matches that habitat, and collect
the returned `navigationSolids` in the same map.
Keep the same `sitePlacements` and `built.solids` append calls. This avoids drawing a pack setting
twice and keeps its complete collision model in the navigation input. Other existing world sites
continue using their existing builder.

The generated-world audit must include these static setting pieces and combined tree-clearance
inputs before it can accept final navigation. A stage-only audit with creature metadata and no
setting solids is a baseline, not proof of the dressed encounter.

Actors are dynamic bodies. Appending their entities does not itself add navmesh carving or route
edges. Tree-clearance exclusions affect generated vegetation, not navmesh topology. Adding static
camp/ruin solids does affect navigation and requires root's usual nav artifact regeneration and
fingerprint update. Recheck generated fingerprints when the integration changes their authored
inputs; do not rewrite them merely to silence a failure.

After activation, verify hunts derive eligible targets from actual registered residents, labels
show computed levels, and a partial kill/respawn state survives save import. Compare simulation and
render cost with the same camera and graphics settings before and after registration.

## Generated-world audit shards

Root has exposed `window.__packWorldAudit` behind the game query `packAudit=1`. The bounded driver
adds candidate metadata through a page-local manifest response and never writes the public
manifest. It rejects any request to render those staged candidates. Its proof covers generated
terrain, raw navigation, solved water, static solids and actual generated forest trunks.

```powershell
npx tsx tools/regional-pack-world-test.ts --url http://127.0.0.1:4175 --shard 1/8 --catalogue art/rebuild/candidates/finish-bestiary/retained-unhorned15/catalog.json
```

Run shards `1/8` through `8/8` serially. Each owns 12 consecutive packs and a 120-second deadline,
including startup. Their union covers all 96 exactly once. Output is disposable under
`test-results/regional-pack-world/`. The report records the exact catalogue SHA-256. These reports
do not establish creature rendering, material quality, readable encounter dressing or frame cost.

The lifecycle helper is separate and also runs serially:

```powershell
npx tsx tools/regional-pack-lifecycle-test.ts --url http://127.0.0.1:4175 --case melee
npx tsx tools/regional-pack-lifecycle-test.ts --url http://127.0.0.1:4175 --case ranged
npx tsx tools/regional-pack-lifecycle-test.ts --url http://127.0.0.1:4175 --case magic
```

Each case uses one natural encounter and a 120-second limit. Root must inspect its screenshots.

Five setting captures use `tools/regional-pack-dressing-views.ts --setting camp|burial|quarry|roost|court`.
Run one setting per invocation. Each has a 60-second budget and produces an approach overview and
a closer detail. They pause simulation for framing and make no lifecycle claim.

`tools/regional-pack-dressing-nav-check.ts` builds the actual combat-lab terrain in Node without a
GPU. It runs production Recast over that terrain and production measured dressing boxes, checks
every resident's patrol/return combinations with full body clearance, and checks player approach
and exit paths. Rendering sources are deliberately empty CPU groups; geometry/material quality
is not part of this check. Source-round6 passed 1,336 resident routes across all five recipes.


Retained dressing views (GPU launch remains root-scheduled)

The helper checks all five pack IDs against the active bestiary before launching. Camp uses Goblin Archer; burial uses Skeleton Soldier; quarry and the frozen stone perch use Stone Golem; the frozen ruined court now uses Skeleton Mage. The selected five views exclude Fire and Iron Golems; other staged packs using those occupants remain held. Each case has a 60-second total deadline, native D3D11 hardware flags, a 1440×900 viewport and two inspection screenshots. Its browser state check requires all 5–10 residents to use the expected retained asset. These are paused visual reviews, not lifecycle evidence.

```powershell
node --import tsx tools/regional-pack-dressing-views.ts --check-only
# Run the following individually only after root grants the GPU slot and retained assets are available:
node --import tsx tools/regional-pack-dressing-views.ts --setting camp --url http://127.0.0.1:4175
node --import tsx tools/regional-pack-dressing-views.ts --setting burial --url http://127.0.0.1:4175
node --import tsx tools/regional-pack-dressing-views.ts --setting quarry --url http://127.0.0.1:4175
node --import tsx tools/regional-pack-dressing-views.ts --setting roost --url http://127.0.0.1:4175
node --import tsx tools/regional-pack-dressing-views.ts --setting court --url http://127.0.0.1:4175
```

Use the actual root server URL if it differs. Output is `test-results/regional-pack-dressing/<setting>/approach.png`, `setting-detail.png` and `review.json`; root must inspect the images. The term roost identifies the frozen setting recipe only; its current resident is a retained Stone Golem.


Current evidence pin and remaining root integration

All five dressing commands default to the existing acceptance server at `http://127.0.0.1:4175`. They install only `retained-unhorned15/catalog.json`, SHA256 `3272d559169c9072ae3b8f3a592dcc3d92162fc9069b7b2926bc13a12bb5de63`, through the existing browser-local asset installer. Every GLB and shared texture hash is checked. `--check-only` verifies those bytes and collected routes without creating Chromium. Source-round7 is historical evidence, not the dressing source.

Both insects are promoted after natural lifecycle proof. Spider model SHA256 is `8e26f4d37d09f683514b1e6fb9c7f3a1043d31bc69a108c809daa407b3da605f`; repaired fantasy bee model SHA256 is `b4877cf2f8164da857901e510d0ed9747eb1a2be888bda037bdbffcb2139f7d3`. Exact source and lifecycle receipts are in `FINISH-INTEGRATION.md`. Pack assignment remains unchanged until root deliberately places these accepted species.

Once the retained family proofs and dressing reviews pass, root still needs to:

- Register accepted base/variant stats and assemble the same catalogue on initial load and reset/import; retain stable member IDs and rehydrate combat runtimes.
- Install combined habitat lookup, tree clearances and frozen dressing before scatter/navigation generation, using physical solids for collision and expanded navigation-only solids for full-body paths.
- Recheck all96 formations against the exact accepted bytes, then run the eight bounded generated-world audit shards with actual dressed navigation, terrain and resident trunks.
- Run the three compact natural pack proofs, then inspect representative final-world placement and relevant screenshots before marking population integration accepted.

These checks grant no automatic world activation. Withdrawn animal-headed, horned and demonic candidate families are absent from the active assignment and the pinned staging map.


Court correction: only `pack_kilnhalt_ashback_northeast_range` changes from Fire Golem to Skeleton Mage. Its centre, radius, five saved member IDs and two frozen court pieces are preserved; the inner formation recalculates from measured Skeleton Mage dimensions. Base species IDs and base stats are unchanged. Other Fire/Iron assignments remain staged and held pending replacement; the fifteen-entry catalogue is a byte source, not blanket art acceptance.


Promoted-source assignment proposal (CPU checked, world gate pending)

| Pack ID | Proposed occupant | Existing setting |
| --- | --- | --- |
| pack_vellenwood_rootfall_south_stump_hollow | Mossback Sentinel | Undressed woodland hollow |
| pack_vellenwood_gorge_watch_northeast_roots | Beetle Golem | Burial ruin |
| pack_karrowmoor_outer_tarn_track_nightmares | Shale Elemental | Stone working |
| pack_karrowmoor_ridge_south_nightmares | Shale Elemental | Perch and fallen slab |
| pack_kilnhalt_clinker_southern_approach_west | Lava Golem | Ruined court |
| pack_vellenwood_marchgate_south_bramble | Webweaver Spider | Undressed bramble |
| pack_vellenwood_mossbound_west_bramble | Marsh Wasp | Undressed woodland margin |

Three existing Fire Golem packs also change visual body via the accepted Lava alias: `pack_kilnhalt_kilnroad_north_inner`, `pack_kilnhalt_clinker_west_boundary`, `pack_kilnhalt_ashfin_outer_east`. Their tier20 base stat IDs remain stable. Lava Golem's separate tier10 definition is a regional difficulty choice, not another body family.

All96 formations pass exact public promoted dimensions combined with pinned retained-source dimensions:558 saved members,93 stat variants, minimum new-body separation2.619m (Wasp). All ten affected compact fixtures pass1908 full-body resident routes and20 player approach/exit paths on actual production lab terrain and Recast, with physical dressing boxes. Centres, radii and all frozen props are unchanged. Insect wing extents are included. CPU checks do not establish authored-world terrain/trunk clearance or group gameplay acceptance.

Root can reproduce affected-pocket CPU clearance with `tools/regional-pack-dressing-nav-check.ts --packs <comma-separated IDs>` using the ten IDs above. Before activation, accept compact real pack behavior with these bodies, register the exact catalogue stats/assemblies on boot and reset/import, install combined habitats/dressing/tree clearance/navigation carves, then run the eight generated-world spatial shards and inspect representative populated world views. Avoid redoing untouched setting art merely because its occupants changed; recheck full-body navigation and real group behavior where dimensions changed.


The five-setting screenshot helper now stages only its four selected bodies (Goblin Archer, Skeleton Soldier, Skeleton Mage and Stone Golem) from the pinned catalogue. Its route filter excludes the historical Fire and Iron models; ordinary public promoted assets remain available. CPU readiness verifies the immutable source bytes and reports33 installed route patterns. It does not replace promoted Lava with rejected Fire metadata.
