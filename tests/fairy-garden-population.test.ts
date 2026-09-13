import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EnemyGroupDef } from '../game/src/content/regions.js';
import {
  FAIRY_GARDEN_FORMS,
  FAIRY_GARDEN_SPECIES,
  FAIRY_GARDEN_VARIANTS,
} from '../game/src/content/fairyGardenCreatures.js';
import {
  FAIRY_GARDEN_PAIRINGS,
  FAIRY_GARDEN_RESIDENT_OFFSETS,
  FAIRY_GARDEN_ROAM_RADIUS,
  createFairyGardenResidents,
  type FairyGardenSite,
} from '../game/src/content/fairyGardenEncounters.js';
import {
  encounterPopulationCount,
  createEncounterFormation,
} from '../game/src/content/encounterPopulation.js';
import {
  FAIRY_COMBAT_PLATEAUS,
  FAIRY_DEEP_PATH_CLEARINGS,
  applyFairyLandforms,
} from '../game/src/world/fairyLandforms.js';
import { tierSilhouetteScale } from '../game/src/core/math.js';

type ManifestAsset = {
  id: string;
  base?: { x: number; z: number };
  size?: { x: number; z: number };
};

const fairySites: readonly FairyGardenSite[] = [
  ...FAIRY_COMBAT_PLATEAUS.map((site) => ({
    id: site.id,
    regionId: site.regionId,
    centre: site.centre,
    radius: site.clearingRadius,
  })),
  ...FAIRY_DEEP_PATH_CLEARINGS.map((site) => ({
    id: site.id,
    regionId: site.regionId,
    centre: site.position,
    radius: site.radius,
  })),
];

function ordinaryGroup(overrides: Partial<EnemyGroupDef> = {}): EnemyGroupDef {
  return {
    id: 'legacy-fairy-pack', family: 'garden_test', name: 'Garden test', tier: 30,
    count: 7, centre: [0, 0], radius: 20, assetId: 'fairy_monster_19', scale: 1,
    ...overrides,
  };
}

function readManifestAssets(file: string): readonly ManifestAsset[] {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { assets?: ManifestAsset[] };
  if (!parsed.assets) throw new Error(`${file} has no asset manifest`);
  return parsed.assets;
}

// Lab checks can explicitly select the staged catalogue. Default checks require promoted assets;
// neither path substitutes source-body bounds for a missing generated variant.
const checkedAssetCatalog = process.env.FAIRY_GARDEN_ASSET_CATALOG ?? 'game/public/assets/manifest.json';
const checkedAssets = readManifestAssets(checkedAssetCatalog);

function assetRadius(asset: ManifestAsset): number | undefined {
  if (!asset.base || !asset.size) return undefined;
  const x = Math.max(Math.abs(asset.base.x), Math.abs(asset.base.x + asset.size.x));
  const z = Math.max(Math.abs(asset.base.z), Math.abs(asset.base.z + asset.size.z));
  return Math.hypot(x, z);
}

function nativeRadius(speciesId: string): number {
  const species = FAIRY_GARDEN_SPECIES.find((entry) => entry.id === speciesId);
  if (!species) throw new Error(`Missing fairy species ${speciesId}`);
  const asset = checkedAssets.find((entry) => entry.id === species.assetId);
  if (!asset) throw new Error(`Missing fairy asset ${species.assetId} in ${checkedAssetCatalog}`);
  const radius = assetRadius(asset);
  if (radius === undefined) throw new Error(`Missing bounds for fairy asset ${species.assetId}`);
  return radius;
}

function bodyEnvelope(speciesId: string, group: EnemyGroupDef): number {
  return nativeRadius(speciesId) * group.scale * tierSilhouetteScale(group.tier);
}

function distance(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

describe('fairy garden resident populations', () => {
  it('accepts fixed ordinary resident counts from one through fifteen and rejects invalid values', () => {
    for (let count = 1; count <= 15; count += 1)
      expect(encounterPopulationCount(ordinaryGroup({ id: `fixed-${count}`, count, countPolicy: 'fixed' }))).toBe(count);
    for (const count of [0, -1, 16, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => encounterPopulationCount(ordinaryGroup({ id: `invalid-${count}`, count, countPolicy: 'fixed' })))
        .toThrow('fixed resident count');
    }
  });

  it('uses the same fixed budget when a compact group needs generated formation anchors', () => {
    const group = ordinaryGroup({ count: 3, countPolicy: 'fixed' });
    const formation = createEncounterFormation(group, { bodyRadius: .6 });
    expect(formation.anchors).toHaveLength(3);
    expect(formation.actorIds).toHaveLength(3);
    expect(() => createEncounterFormation({ ...group, countPolicy: undefined }, { bodyRadius: .6, count: 3 }))
      .toThrow('7–15');
  });

  it('keeps ordinary groups without a policy on their legacy count path', () => {
    for (const id of ['legacy-a', 'legacy-b', 'legacy-c']) {
      const group = ordinaryGroup({ id, count: 3 });
      const first = encounterPopulationCount(group);
      expect(first).toBeGreaterThanOrEqual(7);
      expect(first).toBeLessThanOrEqual(15);
      expect(encounterPopulationCount(group)).toBe(first);
    }
    for (const count of [7, 11, 15]) {
      expect(encounterPopulationCount(ordinaryGroup({ count }))).toBe(count);
    }
    const singleton = ordinaryGroup({ id: 'legacy-singleton', count: 1, legacyCount: 1 });
    const singletonCount = encounterPopulationCount(singleton);
    expect(singletonCount).toBeGreaterThanOrEqual(7);
    expect(singletonCount).toBeLessThanOrEqual(15);
    expect(encounterPopulationCount(singleton)).toBe(singletonCount);
  });

  it('builds two stable groups per site with matching species families and combat stats', () => {
    const seenGroupIds = new Set<string>();
    for (const site of fairySites) {
      const pair = FAIRY_GARDEN_PAIRINGS[site.id]!;
      const entries = createFairyGardenResidents(site);
      expect(entries).toHaveLength(2);
      expect(entries.map((entry) => entry.speciesId.replace(/^garden_/, '').replace(/_t(?:30|60)$/, '')))
        .toEqual(pair);
      expect(entries.map((entry) => entry.group.count)).toEqual([4, 3]);
      for (const [groupIndex, entry] of entries.entries()) {
        const species = FAIRY_GARDEN_SPECIES.find((candidate) => candidate.id === entry.speciesId)!;
        expect(species).toBeDefined();
        expect(entry.group.id).toBe(`fairy_${site.id}_${groupIndex === 0 ? 'residents' : 'companions'}`);
        expect(seenGroupIds.has(entry.group.id)).toBe(false);
        seenGroupIds.add(entry.group.id);
        expect(entry.group).toMatchObject({
          family: species.stats.family,
          name: species.stats.name,
          tier: site.regionId === 'gloamgarden' ? 30 : 60,
          assetId: species.assetId,
          scale: species.scale,
          countPolicy: 'fixed',
          centre: site.centre,
          radius: site.radius,
        });
        expect(entry.habitat).toMatchObject({
          id: `${entry.group.id}_habitat`, groupId: entry.group.id, regionId: site.regionId,
          centre: site.centre, radius: site.radius, roamRadius: FAIRY_GARDEN_ROAM_RADIUS,
        });
        expect(entry.habitat.anchors).toHaveLength(entry.group.count);
        expect(entry.habitat.anchors).toEqual(FAIRY_GARDEN_RESIDENT_OFFSETS
          .filter((_, index) => index % 2 === groupIndex)
          .map(([x, z]) => [site.centre[0] + x, site.centre[1] + z]));
      }
    }
    expect(seenGroupIds).toHaveLength(24);
  });

  it('publishes all twelve garden forms at both regional tiers', () => {
    expect(FAIRY_GARDEN_FORMS).toHaveLength(12);
    for (const [regionId, tier] of [['gloamgarden', 30], ['faeholme', 60] as const]) {
      const variants = FAIRY_GARDEN_VARIANTS.filter((variant) => variant.regionId === regionId);
      expect(variants).toHaveLength(12);
      expect(new Set(variants.map((variant) => variant.id))).toHaveLength(12);
      expect(new Set(variants.map((variant) => variant.assetId))).toHaveLength(12);
      for (const variant of variants) {
        const species = FAIRY_GARDEN_SPECIES.find((entry) => entry.id === variant.id)!;
        expect(species).toBeDefined();
        expect(species.regionId).toBe(regionId);
        expect(species.stats.tier).toBe(tier);
        expect(species.stats.family).toBe(variant.id.replace(`_t${tier}`, ''));
        expect(species.assetId).toBe(variant.assetId);
        expect(species.stats.name).toBe(variant.name);
      }
    }
  });

  it('uses twelve distinct bodies and keeps only the explicitly retained animal forms', () => {
    expect(new Set(FAIRY_GARDEN_FORMS.map((form) => form.source))).toHaveLength(12);
    const retainedAnimalSources = new Set(['animal_frog', 'creature_quarry_snail', 'animal_deer']);
    const fantasySources = new Set([
      'fairy_monster_10', 'fairy_monster_19', 'fairy_monster_28', 'fairy_monster_31', 'fairy_monster_34',
      'creature_goblin_shaman', 'creature_wraith', 'creature_briar_harrow', 'creature_baby_red_dragon',
    ]);
    for (const form of FAIRY_GARDEN_FORMS) {
      expect(retainedAnimalSources.has(form.source) || fantasySources.has(form.source),
        `${form.id} requires a fantasy body or an explicitly retained animal body`).toBe(true);
      expect(form.source).not.toMatch(/^fairy_monster_0[1-9]$/);
    }
    for (const source of retainedAnimalSources)
      expect(FAIRY_GARDEN_FORMS.some((form) => form.source === source)).toBe(true);
  });

  it('keeps all 84 residents and places each form at one site in each region', () => {
    const expectedForms = FAIRY_GARDEN_FORMS.map((form) => form.id).sort();
    let total = 0;
    for (const regionId of ['gloamgarden', 'faeholme'] as const) {
      const sites = fairySites.filter((site) => site.regionId === regionId);
      expect(sites).toHaveLength(6);
      expect(sites.flatMap((site) => [...FAIRY_GARDEN_PAIRINGS[site.id]!]).sort()).toEqual(expectedForms);
      for (const site of sites) {
        const counts = createFairyGardenResidents(site).map((entry) => entry.group.count);
        expect(counts).toEqual([4, 3]);
        total += counts.reduce((sum, count) => sum + count, 0);
      }
    }
    expect(total).toBe(84);
  });

  it('keeps interleaved groups apart with whole-body idle clearance', () => {
    for (const site of fairySites) {
      const entries = createFairyGardenResidents(site);
      const first = entries[0]!, second = entries[1]!;
      const firstBody = bodyEnvelope(first.speciesId, first.group);
      const secondBody = bodyEnvelope(second.speciesId, second.group);
      for (const a of first.habitat.anchors) for (const b of second.habitat.anchors) {
        const roots = distance(a, b);
        expect(roots, `${site.id} cross-group roots`).toBeGreaterThanOrEqual(11.97 - 1e-6);
        expect(roots - firstBody - secondBody - FAIRY_GARDEN_ROAM_RADIUS * 2,
          `${site.id} cross-group idle body gap`).toBeGreaterThanOrEqual(2 - 1e-6);
      }
    }
  });

  it('contains every full body at every idle offset on the authored receiving floor', () => {
    for (const site of fairySites) {
      const expectedRise = FAIRY_COMBAT_PLATEAUS.find((landform) => landform.id === site.id)?.rise ?? 0;
      for (const entry of createFairyGardenResidents(site)) {
        const body = bodyEnvelope(entry.speciesId, entry.group);
        const envelope = body + FAIRY_GARDEN_ROAM_RADIUS;
        for (const anchor of entry.habitat.anchors) {
          expect(distance(anchor, site.centre) + envelope, `${site.id}/${entry.speciesId} floor containment`)
            .toBeLessThanOrEqual(site.radius + 1e-6);
          for (let index = 0; index < 24; index += 1) {
            const angle = index * Math.PI / 12;
            const x = anchor[0] + Math.cos(angle) * envelope;
            const z = anchor[1] + Math.sin(angle) * envelope;
            expect(applyFairyLandforms(x, z, 0), `${site.id}/${entry.speciesId} offset ${index}`)
              .toBeCloseTo(expectedRise, 5);
          }
        }
      }
    }
  });
});
