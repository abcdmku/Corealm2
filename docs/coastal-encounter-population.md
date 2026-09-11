# Coastal encounter population

`content/coastalEncounterFormation.ts` is a pure placement helper. It does not import the scene, live regions or global habitat catalog. `createCoastalEncounterFormation(site, source, options)` returns a complete formation and habitat, or `null` when the entire requested population cannot fit. It never emits a partial pack.

The count uses the source's already valid 7 to 15 members. Older source counts derive a deterministic 7 to 15 count from the coastal site ID. A caller can author a count inside that range. Boss and miniboss sources return `null`. The returned group always has `legacyCount: 1`; the original coastal actor retains the bare site ID and added actors begin at `_2`.

Every candidate anchor passes `accepts(point, bodyRadius)` for its complete moving body circle. Other accepted formations reserve their actual actor circles with a two-meter gap between different packs. The helper filters distant reservations before testing candidates. A rejected site leaves all prior reservations untouched. Generation order is the existing stable coastal grid order.

`coastalBodyOnSafeGround(sampleAt, point, bodyRadius)` adapts the production scene sampler. It checks the center, interior radial bands and circumference with at most 0.75 m between sample positions. Every sample must be playable, outside inland water, at least 0.5 m above sea level and on slope at most 0.85. Unknown or non-finite samples fail. This is receiving-floor sampling, so the caller must also supply local solid clearance where needed. Navigation and patrol routes still require final-world proof.

## Root integration

Keep `app/coastalSpawns.ts` as a generator of candidate site IDs and centers. Its existing center checks can remain as an inexpensive early rejection. The six-meter corner check alone cannot accept a pack.

Add this callback to the root-owned `WorldPorts`, then supply it from `app/boot.ts` beside `coastalSpawns`:

```ts
coastalAccepts?: (point: Spot, bodyRadius: number) => boolean;
```

```ts
coastalAccepts: (point, radius) => coastalBodyOnSafeGround(
  (x, z) => scene.sampleWorld(x, z), point, radius,
),
```

In the `world/regionBuilder.ts` coastal loop, select the intended tier before choosing a source:

```ts
const owner = REGIONS.find(region => region.id === site.regionId)!;
const tier = coastalEncounterTier(site.regionId, site.spot[1], owner.tier);
const groups = visualRegion.enemyGroups.filter(group =>
  !group.boss && !group.miniBoss && !isStarterAnimalAsset(group.assetId)
  && (site.regionId !== 'wilderness' || group.tier === tier));
```

Use the existing seeded `coastalRng.pick(groups)`. Filtering Wilderness sources by depth keeps hatchlings in T50 and full dragons in T70. Region ownership stays semantic even when its visual biome blends. If no source is eligible, skip that site.

Measure the source at the selected tier before calling the helper. Use the larger of neutral body extent and known moving envelope. In particular, the dragon reservations are 2.4 m for hatchlings, 5.5 m for red adults and 5.7 m for black or purple adults. Passing the smaller neutral bound would discard their accepted wing and tail clearance.

Initialize a local reservations array with the already authored surface habitats and their measured group bodies. Each reservation needs only `{ group, anchors, bodyRadius }`. Then accept coastal sites in their existing deterministic order:

```ts
const formed = createCoastalEncounterFormation(site, source, {
  bodyRadius,
  regionTier: tier,
  accepts: (point, radius) => ports.coastalAccepts!(point, radius)
    && receivingSolidsAreClear(point, radius),
  reserved,
});
if (!formed) continue;
reserved.push(formed);
```

`receivingSolidsAreClear` denotes the root's collision check against the assembled world solids; it is not a second implementation included in this module. If the acceptance callback is absent, skip coastal packs rather than accepting unchecked circles.

Replace the old `{ count: 1, radius: 0 }` construction with `formed.group`. Resolve the selected source's stat block at the resulting tier, then call the existing `buildEnemyGroup` member override:

```ts
buildEnemyGroup(site.regionId, formed.group, coastalRng, coastPlace,
  entities, ctx.assetSize, {
    habitat: formed.habitat,
    members: formed.actorIds.map(id => ({ id, stats, scaleMultiplier: 1 })),
  });
```

This uses the exact accepted anchors and retains the original coastal actor ID. Pass the returned habitats to the same scatter and tree-clearance collection used for authored populations, so later forest dressing does not occupy the new pack floors. Do not use a second fallback spiral or keep the old single-actor coast branch.

Focused check: `npx vitest run tests/coastal-encounter-formation.test.ts`. Ten tests pass in 190 ms, covering complete counts, actor identity, deterministic layout, Wilderness tier selection, dry-circle rejection, interior water, slope, neighboring reservations and failure behavior. No browser or world acceptance is claimed by these tests.
