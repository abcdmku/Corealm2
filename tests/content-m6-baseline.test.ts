import { beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  buildM6Baseline, M6_MODULE_SPECS, M6_CONTENT_MODULES, M6_DEPENDENCY_MODULES,
  snapshot, writeM6BaselineReport, type M6Baseline,
} from '../tools/content/m6-baseline.js';
import { repoRoot } from '../tools/lib/paths.js';

const baselineRoot = path.join(repoRoot, '.baseline/game/src');

describe.skipIf(!existsSync(path.join(baselineRoot, 'content/regions.ts')))('original M6 baseline inventory', () => {
  let baseline: M6Baseline;

  beforeAll(async () => { baseline = await buildM6Baseline(); }, 120_000);

  it('captures every named constant from the 17 source modules and runtime dependencies', async () => {
    expect(baseline.modules.content).toEqual([...M6_CONTENT_MODULES]);
    expect(baseline.modules.dependencies).toEqual([...M6_DEPENDENCY_MODULES]);
    expect(baseline.constants.length).toBeGreaterThan(0);
    for (const spec of M6_MODULE_SPECS.filter((row) => row.category !== 'probe-support')) {
      const module = await import(pathToFileURL(path.join(baselineRoot, spec.source)).href) as Record<string, unknown>;
      const constants = Object.entries(module).filter(([, value]) => typeof value !== 'function');
      const captured = baseline.constants.filter((row) => row.module === spec.key);
      expect(captured.map((row) => row.name).sort(), spec.key).toEqual(constants.map(([key]) => key).sort());
      for (const [key, value] of constants) {
        expect(captured.find((row) => row.name === key)!.value, `${spec.key}.${key}`).toEqual(snapshot(value));
      }
    }
  }, 120_000);

  it('records original structural views, ordered IDs and approved aggregate counts', () => {
    expect(baseline.counts).toMatchObject({
      sourceRegions: 8, regions: 8, sourceSurfaceGroups: 176, acceptedSurfaceGroups: 232,
      sourceDungeonGroups: 7, acceptedDungeonGroups: 7, worldHabitats: 213,
      regionalPacks: 96, resourceClusters: 50,
    });
    expect(baseline.orders.sourceGroups).toHaveLength(176);
    expect(baseline.orders.groups).toHaveLength(232);
    expect(baseline.orders.sourceDungeonGroups).toHaveLength(7);
    expect(baseline.orders.dungeonGroups).toHaveLength(7);
    expect(baseline.orders.regionalPacks).toHaveLength(96);
    expect(baseline.orders.resourceClusters).toHaveLength(50);
    expect(baseline.original.sourceRegions.kind).toBe('array');
    expect(baseline.original.regions.kind).toBe('array');
    expect(baseline.original.sourceHabitatLookup.kind).toBe('map');
    expect(baseline.original.habitatLookup.kind).toBe('map');
    expect(baseline.original.placementOverrides.kind).toBe('object');
    expect(baseline.original.regionalPackActivation.kind).toBe('object');
    expect(baseline.original.activatedRegionalPackIds.kind).toBe('array');
    expect(baseline.original.resourceClusters.kind).toBe('array');
  });

  it('keeps source hashes, shared references, helper evidence and absent values explicit', () => {
    expect(baseline.source.files.length).toBeGreaterThan(17);
    expect(baseline.source.files.every((row) => row.path.startsWith('.baseline/') && /^[0-9a-f]{64}$/.test(row.sha256))).toBe(true);
    expect(baseline.sharedExportReferences.length).toBeGreaterThan(0);
    expect(baseline.functions.some((row) => row.name === 'createLegacyEncounterFormation' && row.probes.length > 0)).toBe(true);
    expect(baseline.functions.some((row) => row.name === 'spreadMobSpawns' && row.unprobedReason === undefined)).toBe(false);
    expect(baseline.functions.filter((row) => !row.probes.length).every((row) => row.unprobedReason)).toBe(true);
    expect(baseline.functions.reduce((sum, row) => sum + row.probes.length, 0)).toBe(baseline.counts.probes);
    expect(snapshot(new Map([['b', undefined], ['a', 1]]))).toEqual({ kind: 'map', entries: [
      [{ kind: 'string', value: 'b' }, { kind: 'undefined' }],
      [{ kind: 'string', value: 'a' }, { kind: 'number', value: 1 }],
    ] });
    expect(snapshot({ key: undefined })).not.toEqual(snapshot({}));
    expect(() => snapshot(() => 1)).toThrow('Unsupported snapshot value');
  });

  it('rejects production and escaping output paths before writing', async () => {
    await expect(writeM6BaselineReport(baseline, 'game/content/data/regions.json')).rejects.toThrow('--out');
    await expect(writeM6BaselineReport(baseline, 'test-results/../../outside.json')).rejects.toThrow('--out');
  });
});
