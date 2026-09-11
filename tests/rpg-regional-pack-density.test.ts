import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CREATURE_SPECIES } from '../game/src/content/creatureSpecies.js';
import { REGIONAL_PACKS, REGIONAL_PACK_VARIANTS } from '../game/src/content/regionalPacks.js';
import { REGIONAL_PACK_LAYOUT } from '../game/src/content/regionalPackLayout.js';
import { activatedRegionalPackIds, REGIONAL_PACK_ACTIVATION } from '../game/src/content/regionalPackActivation.js';
import { createRpgRegionalPackCatalogue, RPG_REGIONAL_PACK_PLAN,
  type RpgPackModelMeasurement } from '../game/src/content/rpgRegionalPacks.js';
import { encounterPopulationCount, ENCOUNTER_POPULATION_LIMITS } from '../game/src/content/encounterPopulation.js';
import { assembleRegionalPackFixture } from '../game/src/featureLab/regionalPacks.js';
import { tierSilhouetteScale } from '../game/src/core/math.js';

const manifest = JSON.parse(readFileSync(new URL('../game/public/assets/manifest.json', import.meta.url), 'utf8')) as
  { assets: (RpgPackModelMeasurement & { id: string })[] };
const assets = new Map(manifest.assets.map(asset => [asset.id, asset]));
const measure = (id: string): RpgPackModelMeasurement | null => assets.get(id) ?? null;
const catalogue = createRpgRegionalPackCatalogue(measure);
const variants = new Map(catalogue.variants.map(variant => [variant.id, variant]));
const originals = new Map(REGIONAL_PACKS.map(pack => [pack.id, pack]));
const originalVariants = new Map(REGIONAL_PACK_VARIANTS.map(variant => [variant.id, variant]));

function visualRadius(model: RpgPackModelMeasurement, sx: number, sz = sx): number {
  return Math.hypot(Math.max(Math.abs(model.base.x), Math.abs(model.base.x + model.size.x)) * sx,
    Math.max(Math.abs(model.base.z), Math.abs(model.base.z + model.size.z)) * sz);
}

describe('regional pack density with production model measurements', () => {
  it('produces the full 7-15 population for all 96 plans while preserving every source member ID', () => {
    expect(catalogue.packs).toHaveLength(96);
    const allIds = catalogue.packs.flatMap(pack => pack.members.map(member => member.id));
    expect(new Set(allIds).size).toBe(allIds.length);
    for (const pack of catalogue.packs) {
      const original = originals.get(pack.id)!;
      const count = encounterPopulationCount({ id: original.id, count: original.members.length });
      expect(pack.members.length, pack.id).toBe(count);
      expect(pack.members.length).toBeGreaterThanOrEqual(7);
      expect(pack.members.length).toBeLessThanOrEqual(15);
      expect(pack.members.slice(0, original.members.length).map(member => member.id), pack.id)
        .toEqual(original.members.map(member => member.id));
      expect(pack.centre).toEqual(original.centre);
      expect(pack.members.map(member => member.anchorIndex)).toEqual(pack.anchors.map((_, index) => index));
      expect(catalogue.groups.find(group => group.id === pack.id)!.count).toBe(count);
      expect(catalogue.habitats.find(habitat => habitat.groupId === pack.id)!.anchors).toEqual(pack.anchors);
    }
  });

  it('keeps produced ranks on existing residents and adds ordinary members after the saved IDs', () => {
    for (const pack of catalogue.packs) {
      const original = originals.get(pack.id)!;
      const assigned = RPG_REGIONAL_PACK_PLAN.find(plan => plan.packId === pack.id)!.speciesId;
      const previouslyCapped = assigned !== null && CREATURE_SPECIES.some(species => species.id === assigned);
      const previousCount = previouslyCapped ? 3 : original.members.length;
      for (const [index, member] of pack.members.entries()) {
        const variant = variants.get(member.variantId)!;
        if (index >= original.members.length) {
          expect(variant.rank).toBe('ordinary');
          expect(member.id).toBe(`${pack.id}_${index + 1}`);
        } else if (!assigned) {
          expect(member.variantId).toBe(original.members[index]!.variantId);
          expect(variant).toEqual(originalVariants.get(member.variantId));
        } else {
          const rank = index < previousCount ? (index === previousCount - 1 ? 'mature' : index === 1 ? 'seasoned' : 'ordinary')
            : originalVariants.get(original.members[index]!.variantId)!.rank;
          expect(variant.rank, `${pack.id} ${member.id}`).toBe(rank);
          expect(variant.baseEnemyDefId).toBe(pack.baseEnemyDefId);
        }
      }
    }
    const wildlife = catalogue.packs.filter(pack => CREATURE_SPECIES.some(species => species.id === pack.speciesId));
    const retained = catalogue.packs.filter(pack => RPG_REGIONAL_PACK_PLAN.find(plan => plan.packId === pack.id)!.speciesId === null);
    expect(wildlife.length).toBeGreaterThan(0);
    expect(retained.length).toBeGreaterThan(0);
    expect([...wildlife, ...retained].every(pack => pack.members.length >= 7)).toBe(true);
  });

  it('reserves measured complete bodies and idle movement, with clear space around every setting prop', () => {
    let enlarged = 0;
    for (const pack of catalogue.packs) {
      const model = measure(pack.assetId)!;
      const scale = Math.max(...pack.members.map(member => {
        const variant = variants.get(member.variantId)!;
        return pack.scale * tierSilhouetteScale(variant.stats.tier) * variant.scaleMultiplier;
      }));
      const radius = visualRadius(model, scale) + .45;
      if (pack.radius > originals.get(pack.id)!.radius + 1e-6) enlarged++;
      const habitat = catalogue.habitats.find(row => row.groupId === pack.id)!;
      expect(habitat.radius).toBe(pack.radius);
      expect(catalogue.groups.find(row => row.id === pack.id)!.radius).toBe(pack.radius);
      for (const [index, anchor] of pack.anchors.entries()) {
        expect(Math.hypot(anchor[0] - pack.centre[0], anchor[1] - pack.centre[1]) + radius, pack.id)
          .toBeLessThanOrEqual(pack.radius + 1e-6);
        for (const other of pack.anchors.slice(index + 1)) {
          expect(Math.hypot(anchor[0] - other[0], anchor[1] - other[1]), pack.id)
            .toBeGreaterThanOrEqual(radius * 2 + ENCOUNTER_POPULATION_LIMITS.bodyGap - 1e-6);
        }
        for (const piece of habitat.dressing) {
          const prop = measure(piece.assetId)!;
          const sx = typeof piece.scale === 'number' ? piece.scale : piece.scale[0];
          const sz = typeof piece.scale === 'number' ? piece.scale : piece.scale[2];
          const propRadius = visualRadius(prop, sx, sz);
          expect(Math.hypot(anchor[0] - piece.x, anchor[1] - piece.z), `${pack.id}/${piece.id}`)
            .toBeGreaterThanOrEqual(radius + propRadius + ENCOUNTER_POPULATION_LIMITS.bodyGap - 1e-6);
          expect(Math.hypot(piece.x - pack.centre[0], piece.z - pack.centre[1]) + propRadius)
            .toBeLessThan(pack.radius);
        }
      }
      const expectedDressing = CREATURE_SPECIES.some(species => species.id === pack.speciesId)
        ? [] : REGIONAL_PACK_LAYOUT[pack.id]!.dressing;
      expect(habitat.dressing).toEqual(expectedDressing);
    }
    expect(enlarged).toBeGreaterThan(0);
  });

  it('preserves activation and gives a subset the same assignments and formation as the complete catalogue', () => {
    const before = JSON.stringify({ packs: REGIONAL_PACKS, activation: REGIONAL_PACK_ACTIVATION });
    const selected = activatedRegionalPackIds();
    const active = createRpgRegionalPackCatalogue(measure, selected, REGIONAL_PACK_ACTIVATION.assignmentOverrides);
    expect(active.packs.map(pack => pack.id)).toEqual(selected);
    expect(activatedRegionalPackIds()).toEqual(selected);
    for (const pack of active.packs) {
      const only = createRpgRegionalPackCatalogue(measure, [pack.id], REGIONAL_PACK_ACTIVATION.assignmentOverrides);
      expect(only.packs[0]).toEqual(pack);
      expect(pack.radius, `${pack.id} fits its active reservation`).toBe(originals.get(pack.id)!.radius);
    }
    const sample = catalogue.packs[23]!;
    expect(createRpgRegionalPackCatalogue(measure, [sample.id]).packs[0]).toEqual(sample);
    expect(JSON.stringify({ packs: REGIONAL_PACKS, activation: REGIONAL_PACK_ACTIVATION })).toBe(before);
  });

  it('assembles all actual residents and rank stats through the production regional-pack fixture', () => {
    const pack = catalogue.packs.find(pack => pack.members.length === 15)!;
    expect(pack).toBeDefined();
    const fixture = assembleRegionalPackFixture(pack.id, {
      heightAt: () => 0, baseY: id => measure(id)?.base.y ?? NaN, assetSize: id => measure(id)?.size ?? null,
    }, catalogue);
    expect(fixture.entities).toHaveLength(15);
    expect(fixture.entities.map(entity => entity.id)).toEqual(pack.members.map(member => member.id));
    expect(fixture.habitat.radius).toBe(pack.radius);
    expect(fixture.habitat.centre).toEqual([-72, 30]);
    for (const [index, entity] of fixture.entities.entries()) {
      const variant = variants.get(pack.members[index]!.variantId)!;
      expect(entity.combat!.health).toBe(variant.stats.maxHealth);
      expect(entity.meta!.enemyDefId).toBe(variant.id);
      expect(entity.view!.assetId).toBe(pack.assetId);
    }
  });

  it('fails missing creature or prop measurements instead of guessing collision dimensions', () => {
    const pack = catalogue.packs.find(pack => catalogue.habitats.find(habitat => habitat.groupId === pack.id)!.dressing.length)!;
    const prop = catalogue.habitats.find(habitat => habitat.groupId === pack.id)!.dressing[0]!;
    expect(() => createRpgRegionalPackCatalogue(id => id === pack.assetId ? null : measure(id), [pack.id]))
      .toThrow(`requires measured model: ${pack.assetId}`);
    expect(() => createRpgRegionalPackCatalogue(id => id === prop.assetId ? null : measure(id), [pack.id]))
      .toThrow(`requires measured model: ${prop.assetId}`);
    expect(() => createRpgRegionalPackCatalogue(id => id === pack.assetId
      ? { size: { x: 100, y: 100, z: 100 }, base: { x: -50, y: 0, z: -50 } } : measure(id), [pack.id]))
      .toThrow('exceeds habitat');
  });
});
