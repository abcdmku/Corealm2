import { describe, expect, it } from 'vitest';
import type { EnemyGroupDef } from '../game/src/content/regions.js';
import { coastalBodyOnSafeGround, coastalEncounterTier, createCoastalEncounterFormation,
  type CoastalEncounterSite, type CoastalGroundSample } from '../game/src/content/coastalEncounterFormation.js';

const site: CoastalEncounterSite = { id: 'coastal_-390_710', regionId: 'wilderness', biomeId: 'wilderness', spot: [-380, 740] };
const source: EnemyGroupDef = { id: 'ordinary_source', assetId: 'creature_rift_carapace', family: 'rift_carapace',
  name: 'Rift Carapace', tier: 70, count: 11, centre: [-292, 732], radius: 19, scale: 1 };
const land: CoastalGroundSample = { playable: true, height: 4, slope: .15, waterBodyId: null, coast: { seaLevel: 0 } };

describe('coastal encounter formations', () => {
  it('creates a real 7–15 member formation and preserves the original bare coastal actor ID', () => {
    const observed: number[] = [];
    const pack = createCoastalEncounterFormation(site, source, { bodyRadius: 1.9,
      accepts: (_point, radius) => { observed.push(radius); return true; } })!;
    expect(pack.group.count).toBe(11);
    expect(pack.group.legacyCount).toBe(1);
    expect(pack.actorIds).toEqual([site.id, ...Array.from({ length: 10 }, (_, index) => `${site.id}_${index + 2}`)]);
    expect(pack.anchors).toHaveLength(11);
    expect(observed.length).toBeGreaterThanOrEqual(11);
    expect(observed.every(radius => radius === 1.9)).toBe(true);
    expect(pack.habitat.anchors).toBe(pack.anchors);
    expect(pack.habitat.radius).toBe(pack.group.radius);
    expect(source.id).toBe('ordinary_source'); expect(source.centre).toEqual([-292, 732]);
  });

  it('regenerates the same pack and selects T50/T70 by semantic Wilderness depth', () => {
    const make = () => createCoastalEncounterFormation(site, source, { bodyRadius: 1.9, accepts: () => true });
    expect(make()).toEqual(make());
    expect(coastalEncounterTier('wilderness', 699.99, 20)).toBe(50);
    expect(coastalEncounterTier('wilderness', 700, 20)).toBe(70);
    expect(coastalEncounterTier('kilnhalt', 699.99, 20)).toBe(20);
    expect(make()!.group.tier).toBe(70);
    expect(createCoastalEncounterFormation({ ...site, spot: [-380, 620] }, source,
      { bodyRadius: 1.9, accepts: () => true })!.group.tier).toBe(50);
  });

  it('rejects a thin dry headland that cannot hold the entire target population', () => {
    const result = createCoastalEncounterFormation(site, source, { bodyRadius: 2.7, maxRadius: 12,
      accepts: (point, radius) => Math.abs(point[0] - site.spot[0]) + radius < 3.2
        && Math.abs(point[1] - site.spot[1]) + radius < 7 });
    expect(result).toBeNull();
  });

  it('does not accept actors whose roots are dry but their receiving circle is wet', () => {
    const result = createCoastalEncounterFormation(site, source, { bodyRadius: 2.7, maxRadius: 12,
      accepts: (point, radius) => coastalBodyOnSafeGround((x, z) =>
        Math.abs(x - site.spot[0]) < .4 && Math.abs(z - site.spot[1]) < 20 ? land : { ...land, playable: false }, point, radius) });
    expect(result).toBeNull();
  });

  it('keeps a two-meter gap between nearby pack bodies without changing an existing reservation', () => {
    const first = createCoastalEncounterFormation(site, { ...source, count: 7 }, { bodyRadius: 1.9, accepts: () => true })!;
    const before = structuredClone(first);
    const second = createCoastalEncounterFormation({ ...site, id: 'coastal_next', spot: [-364, 740] }, source,
      { bodyRadius: 1.5, accepts: () => true, reserved: [first] })!;
    expect(second).not.toBeNull();
    for (const a of first.anchors) for (const b of second.anchors)
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThanOrEqual(1.9 + 1.5 + 2 - 1e-6);
    expect(first).toEqual(before);
  });

  it('returns no partial pack or reservation when a neighboring site consumes the available floor', () => {
    const first = createCoastalEncounterFormation(site, { ...source, count: 7 }, { bodyRadius: 1.9,
      maxRadius: 7, accepts: () => true })!;
    const reserved = [first];
    const second = createCoastalEncounterFormation({ ...site, id: 'overlapping_site' }, source,
      { bodyRadius: 1.9, maxRadius: 7, accepts: () => true, reserved });
    expect(second).toBeNull(); expect(reserved).toHaveLength(1); expect(reserved[0]).toBe(first);
  });

  it('never replicates a boss and does not hide invalid data or a failed terrain sampler', () => {
    expect(createCoastalEncounterFormation(site, { ...source, boss: true }, { bodyRadius: 2, accepts: () => true })).toBeNull();
    expect(createCoastalEncounterFormation(site, { ...source, miniBoss: true }, { bodyRadius: 2, accepts: () => true })).toBeNull();
    expect(() => createCoastalEncounterFormation(site, source, { bodyRadius: 0, accepts: () => true })).toThrow('body radius');
    expect(() => createCoastalEncounterFormation(site, source, { bodyRadius: 2, count: 6, accepts: () => true })).toThrow('7–15');
    expect(() => createCoastalEncounterFormation(site, source, { bodyRadius: 2, accepts: () => { throw new Error('terrain failure'); } })).toThrow('terrain failure');
  });
});

describe('coastal receiving circle', () => {
  it('samples all radial bands and the circumference of large measured bodies', () => {
    const seen: [number, number][] = [];
    expect(coastalBodyOnSafeGround((x,z) => { seen.push([x,z]); return land; }, [0,0], 5.7)).toBe(true);
    expect(seen.some(point => Math.hypot(...point) > 5.69)).toBe(true);
    expect(seen.some(point => Math.hypot(...point) > 2 && Math.hypot(...point) < 3)).toBe(true);
  });

  it('rejects an interior water pocket even when center and outer edge are dry', () => {
    expect(coastalBodyOnSafeGround((x,z) => Math.hypot(x-.75,z) < .2
      ? { ...land, waterBodyId: 'pool' } : land, [0,0], 1.5)).toBe(false);
  });

  it('rejects steep, submerged, unknown and non-finite terrain samples', () => {
    for (const sample of [{ ...land, slope: .86 }, { ...land, slope: null }, { ...land, height: .49 },
      { ...land, height: Number.NaN }, { ...land, slope: Number.NaN }, { ...land, coast: null }, { ...land, playable: false }])
      expect(coastalBodyOnSafeGround(() => sample, [0,0], 1.5)).toBe(false);
    expect(coastalBodyOnSafeGround(() => ({ ...land, slope: .85, height: .5 }), [0,0], 1.5)).toBe(true);
  });
});
