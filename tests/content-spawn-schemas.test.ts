import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../tools/lib/paths.js';
import { buildM6Baseline, type M6Baseline, type Snapshot } from '../tools/content/m6-baseline.js';
import { parseValue, unwrap, ObjectSchema, type Schema } from '../game/src/content/schema/core.js';
import {
  AcceptedGroupSchema, AcceptedPackSchema, BoundsSchema, ClusterRecordSchema, ClusterSchema,
  DressingSchema, GroupFields, GroupSchema, HabitatFields, HabitatRecordSchema, HabitatSchema,
  HabitatSourceRecordSchema, LegacyPlacementSchema, PackActivationSchema, PackAssignmentSchema,
  PackLayoutSchema, PackRecordSchema, PackSourceSchema, PersistedHabitatSchema, RegionalPacksSchema,
  SpawnRecordSchema, SpawnSourceRecordSchema, SPAWN_REGION_IDS, PACK_REGION_IDS,
} from '../game/src/content/schema/spawns.js';

const group = {
  id: 'test_frogs', family: 'frog', name: 'Frogs', tier: 1, count: 7,
  centre: [-45.78, -45.48], radius: 9, assetId: 'animal_frog', scale: 0.8766702550812312,
};
const spawn = { ...group, regionId: 'fallowmarch', source: 'region', sourceInputId: 'regions/test_frogs', authored: true };
const dressing = { id: 'reed', assetId: 'reed_patch', x: -45.78, z: 0, yaw: -0.123, scale: [0.1, 0.36, 0.17], sink: -0.06 };
const habitat = {
  id: 'frog_margin', groupId: group.id, regionId: 'fallowmarch', centre: [-50, -52], radius: 12,
  anchors: [[-45.78, -45.48]], activity: 'forage', dressing: [dressing],
};
const cluster = { id: 'cluster', resourceId: 'ore', count: 2, centre: [1, 2], radius: 0, locationId: 'mine' };
const pack = { id: 'pack_fallowmarch_margin', regionId: 'fallowmarch', settingId: 'margin', sourceGroupId: group.id, centre: [-1, 2], radius: 3, count: 3 };
const packSource = { id: group.id, assetId: group.assetId, scale: 1, baseEnemyDefId: 'frog_t1', activity: 'forage', nativeBodyRadius: 0.35, nativeVisualRadius: 0.9 };
const assignment = { packId: pack.id, speciesId: null };
const accepted = {
  id: pack.id, regionId: pack.regionId, speciesId: 'frog', baseGroupId: group.id,
  baseEnemyDefId: 'frog_t1', assetId: group.assetId, scale: 1, activity: 'forage',
  centre: pack.centre, radius: pack.radius, anchors: [[-1, 2]],
  members: [{ id: `${pack.id}_1`, anchorIndex: 0, variantId: 'frog_t1_ordinary' }],
  settingId: pack.settingId, levelRange: [1, 2],
};
const envelope = {
  sources: [packSource], packs: [pack], assignments: [assignment],
  activation: { regions: ['fallowmarch'], excludedPackIds: [], assignmentOverrides: [] },
  layouts: [{ packId: pack.id, dressing: [] }], accepted: [accepted],
};
const legacy = {
  id: group.id, regionId: 'fallowmarch', originalCentre: [-56, -72], originalCount: 6,
  centre: [-50, -52], count: 7, radius: 12, bodyRadiusBudget: 0.35,
};
function valid<T>(schema: Schema<T>, raw: unknown): T { return parseValue(schema, raw, 'test'); }
function invalid(schema: Schema, raw: unknown, message?: string): void {
  if (message) expect(() => valid(schema, raw)).toThrow(message);
  else expect(() => valid(schema, raw)).toThrow();
}

describe('M6 frozen spawn storage schemas', () => {
  it('keeps stable IDs, counts, regions and source ownership read-only', () => {
    expect(SPAWN_REGION_IDS).toHaveLength(9);
    expect(PACK_REGION_IDS).toEqual(['fallowmarch', 'vellenwood', 'karrowmoor', 'kilnhalt']);
    for (const field of [GroupFields.id, GroupFields.count, GroupFields.legacyCount, HabitatFields.regionId, HabitatFields.groupId])
      expect(field.meta).toMatchObject({ identity: true, readOnly: true });
    for (const [schema, fields] of [
      [SpawnRecordSchema, ['id', 'count', 'legacyCount', 'regionId', 'source', 'sourceInputId']],
      [SpawnSourceRecordSchema, ['id', 'catalog', 'regionId']],
      [HabitatSourceRecordSchema, ['id', 'catalog']],
      [PackRecordSchema, ['id', 'count', 'regionId', 'sourceGroupId']],
      [LegacyPlacementSchema, ['id', 'originalCount', 'count']],
    ] as const) {
      const object = unwrap(schema);
      expect(object).toBeInstanceOf(ObjectSchema);
      if (!(object instanceof ObjectSchema)) throw new Error('Expected object schema');
      for (const field of fields) expect(object.fields[field]!.meta, field).toMatchObject({ identity: true, readOnly: true });
    }
  });

  it('distinguishes source counts and accepted population rules without rewriting values', () => {
    expect(valid(GroupSchema, { ...group, count: 2, boss: false, miniBoss: false })).toStrictEqual({ ...group, count: 2, boss: false, miniBoss: false });
    invalid(AcceptedGroupSchema, { ...group, count: 2 }, 'final count');
    for (const count of [1, 15]) valid(AcceptedGroupSchema, { ...group, count, countPolicy: 'fixed' });
    for (const count of [7, 15]) valid(AcceptedGroupSchema, { ...group, count });
    for (const count of [0, 1.5, 16]) invalid(AcceptedGroupSchema, { ...group, count, countPolicy: 'fixed' });
    for (const key of ['boss', 'miniBoss']) {
      valid(AcceptedGroupSchema, { ...group, count: 1, [key]: true });
      invalid(AcceptedGroupSchema, { ...group, [key]: true });
    }
    invalid(GroupSchema, { ...group, boss: true, miniBoss: true }, 'cannot both');
    const parsed = valid(SpawnRecordSchema, { ...spawn, legacyCount: 1, boss: false });
    expect(parsed).toStrictEqual({ ...spawn, legacyCount: 1, boss: false });
    expect(Object.hasOwn(parsed, 'miniBoss')).toBe(false);
    expect(parsed.scale).toBe(group.scale);
    expect(valid(SpawnSourceRecordSchema, { id: 'regions/test_frogs', catalog: 'region', regionId: 'fallowmarch', group: { ...group, count: 2 } }).group.count).toBe(2);
  });

  it('rejects unknown keys, nonfinite numbers, empty identities and malformed spatial tuples', () => {
    for (const value of [NaN, Infinity, -Infinity]) invalid(GroupSchema, { ...group, centre: [value, 1] });
    for (const value of [0, -1]) invalid(GroupSchema, { ...group, scale: value });
    invalid(GroupSchema, { ...group, id: '' });
    invalid(GroupSchema, { ...group, centre: [1, 2, 3] });
    invalid(GroupSchema, { ...group, radius: -1 });
    invalid(SpawnRecordSchema, { ...spawn, source: 'unknown' });
    invalid(SpawnRecordSchema, { ...spawn, regionId: 'new_region' });
    invalid(SpawnRecordSchema, { ...spawn, extra: true }, 'unknown field');
    valid(BoundsSchema, { min: [-1, -2], max: [1, 2] });
    invalid(BoundsSchema, { min: [-1, -2], max: [-1, 2] });
    invalid(BoundsSchema, { min: [-1, -2], max: [1, -3] });
  });

  it('accepts scalar and vector dressing with ordered local IDs and strict persisted habitats', () => {
    expect(valid(HabitatSchema, habitat)).toStrictEqual(habitat);
    valid(DressingSchema, { ...dressing, scale: 0.25 });
    invalid(DressingSchema, { ...dressing, scale: [1, 0, 1] });
    invalid(DressingSchema, { ...dressing, scale: [1, 1] });
    invalid(DressingSchema, { ...dressing, purpose: 'meta only' }, 'unknown field');
    invalid(HabitatSchema, { ...habitat, dressing: [dressing, dressing] }, 'duplicate dressing');
    valid(HabitatSchema, { ...habitat, boundary: 'playable-coast' });
    for (const schema of [PersistedHabitatSchema, HabitatRecordSchema]) {
      valid(schema, habitat);
      invalid(schema, { ...habitat, boundary: 'playable-coast' }, 'must omit boundary');
    }
    valid(HabitatSourceRecordSchema, { id: 'world/frog_margin', catalog: 'world', habitat });
    invalid(HabitatSourceRecordSchema, { id: 'world/frog_margin', catalog: 'arbitrary', habitat });
  });

  it('locks all fairy spawns, including bosses, and requires matching resource derivation', () => {
    const derived = { kind: 'fairySpawn.v1', source: 'terrace', siteId: 'terrace_1' };
    const fairy = { ...spawn, regionId: 'gloamgarden', source: 'fairy', authored: false, derived };
    valid(SpawnRecordSchema, fairy);
    valid(SpawnRecordSchema, { ...fairy, boss: true, count: 1 });
    invalid(SpawnRecordSchema, { ...fairy, authored: true });
    const { derived: _, ...missingTag } = fairy;
    invalid(SpawnRecordSchema, missingTag);
    invalid(SpawnRecordSchema, { ...spawn, derived });
    const resource = { ...cluster, regionId: 'faeholme', source: 'fairyRegions', derived: { kind: 'fairyResource.v1', intentId: 'intent' } };
    valid(ClusterRecordSchema, resource);
    invalid(ClusterRecordSchema, { ...resource, derived: { kind: 'fairySpawn.v1', intentId: 'intent' } });
    invalid(ClusterRecordSchema, { ...resource, regionId: 'fallowmarch' });
    valid(ClusterRecordSchema, { ...cluster, regionId: 'wilderness', source: 'wildernessResources', ringRadius: 0, heroScale: 1, essenceElement: 'water' });
    invalid(ClusterRecordSchema, { ...cluster, regionId: 'wilderness', source: 'wildernessResources', heroScale: 0 });
  });

  it('keeps original placement history and explicit false while rejecting meta fields', () => {
    const full = { ...legacy, anchorOnly: false, anchors: [[1, 2]], floorRect: { centre: [1, 2], halfExtents: [3, 4] }, rotationY: -0.25 };
    expect(valid(LegacyPlacementSchema, full)).toStrictEqual(full);
    expect(valid(LegacyPlacementSchema, legacy)).toStrictEqual(legacy);
    invalid(LegacyPlacementSchema, { ...legacy, reason: 'meta only' }, 'unknown field');
    invalid(LegacyPlacementSchema, { ...legacy, floorRect: { centre: [1, 2], halfExtents: [0, 4] } });
    invalid(LegacyPlacementSchema, { ...legacy, bodyRadiusBudget: 0 });
  });

  it('keeps staged and accepted packs distinct and preserves null versus missing overrides', () => {
    expect(valid(RegionalPacksSchema, envelope)).toStrictEqual(envelope);
    const activation = { ...envelope.activation, assignmentOverrides: [assignment] };
    expect(valid(PackActivationSchema, activation).assignmentOverrides).toStrictEqual([assignment]);
    invalid(PackAssignmentSchema, { packId: pack.id }, 'missing required field');
    valid(PackAssignmentSchema, { ...assignment, speciesId: 'redbrush_fox' });
    invalid(PackRecordSchema, { ...pack, id: 'wrong' });
    invalid(PackRecordSchema, { ...pack, regionId: 'gravelmaw' });
    invalid(PackActivationSchema, { ...activation, regions: ['fallowmarch', 'fallowmarch'] }, 'duplicate activation');
    invalid(PackActivationSchema, { ...activation, excludedPackIds: [pack.id, pack.id] }, 'duplicate excluded');
    invalid(PackActivationSchema, { ...activation, assignmentOverrides: [assignment, assignment] }, 'duplicate assignment');
    invalid(PackLayoutSchema, { packId: pack.id, dressing: [], purpose: 'meta only' }, 'unknown field');
    invalid(AcceptedPackSchema, { ...accepted, members: [{ ...accepted.members[0], anchorIndex: 1 }] }, 'anchorIndex');
    invalid(AcceptedPackSchema, { ...accepted, members: [accepted.members[0], accepted.members[0]] }, 'duplicate pack member');
    invalid(AcceptedPackSchema, { ...accepted, levelRange: [2, 1] });
    invalid(AcceptedPackSchema, { ...accepted, rationale: 'meta only' }, 'unknown field');
    for (const field of ['sources', 'packs', 'assignments', 'layouts', 'accepted'] as const)
      invalid(RegionalPacksSchema, { ...envelope, [field]: [...envelope[field], ...envelope[field]] }, 'duplicate');
    invalid(RegionalPacksSchema, { ...envelope, arbitrary: {} }, 'unknown field');
  });
});

// Decode the tagged inventory without JSON serialization, which would erase -0 and
// explicit undefined. Baseline comparisons below retain both where they exist.
function decode(value: Snapshot): unknown {
  switch (value.kind) {
    case 'undefined': return undefined;
    case 'null': return null;
    case 'number': return value.negativeZero ? -0 : value.value;
    case 'string': case 'boolean': return value.value;
    case 'array': return value.values.map(decode);
    case 'set': return new Set(value.values.map(decode));
    case 'map': return new Map(value.entries.map(([key, entry]) => [decode(key), decode(entry)]));
    case 'object': return Object.fromEntries(value.entries.map(([key, entry]) => [key, decode(entry)]));
  }
}
type Row = Record<string, unknown>;
function rows(value: Snapshot): Row[] { return decode(value) as Row[]; }

describe.skipIf(!existsSync(path.join(repoRoot, '.baseline/game/src/content/regions.ts')))('M6 schemas against original runtime projections', () => {
  let baseline: M6Baseline;
  beforeAll(async () => { baseline = await buildM6Baseline(); }, 120_000);

  it('parses all original source and accepted groups without inventing source-input IDs', () => {
    const source = [...rows(baseline.original.sourceGroups), ...rows(baseline.original.sourceDungeonGroups)];
    const accepted = [...rows(baseline.original.groups), ...rows(baseline.original.dungeonGroups)];
    expect(source).toHaveLength(183);
    expect(accepted).toHaveLength(239);
    for (const row of source) expect(valid(GroupSchema, row), String(row.id)).toStrictEqual(row);
    for (const row of accepted) expect(valid(AcceptedGroupSchema, row), String(row.id)).toStrictEqual(row);
  });

  it('parses original source and accepted habitats, anchors, dressing and dungeon lookup values', () => {
    const world = rows(baseline.original.worldHabitats);
    expect(world).toHaveLength(213);
    const source = rows(baseline.original.sourceHabitats);
    const lookup = decode(baseline.original.habitatLookup) as Map<string, Row | null>;
    for (const row of [...source, ...world, ...[...lookup.values()].filter((row): row is Row => row !== null)])
      expect(valid(PersistedHabitatSchema, row), String(row.id)).toStrictEqual(row);
  });

  it('parses original clusters and placements while moving only declared prose to meta', () => {
    for (const key of ['sourceResourceClusters', 'resourceClusters'] as const) {
      const records = rows(baseline.original[key]);
      expect(records).toHaveLength(50);
      for (const row of records) expect(valid(ClusterSchema, row), String(row.id)).toStrictEqual(row);
    }
    const placements = decode(baseline.original.placementOverrides) as Record<string, Row>;
    for (const row of Object.values(placements)) {
      const { reason, ...runtime } = row;
      expect(typeof reason).toBe('string');
      expect(valid(LegacyPlacementSchema, runtime)).toStrictEqual(runtime);
    }
  });

  it('parses original regional source tuples, assignments, layouts and staged spatial projections', () => {
    const sourceExport = baseline.constants.find((entry) => entry.module === 'regionalPacks' && entry.name === 'REGIONAL_PACK_SOURCES');
    expect(sourceExport).toBeDefined();
    for (const row of rows(sourceExport!.value)) expect(valid(PackSourceSchema, row)).toStrictEqual(row);
    const sourceIds: string[] = [];
    for (const regionId of PACK_REGION_IDS) {
      const input = baseline.privateConstants.find((entry) => entry.module === 'regionalPacks' && entry.name === regionId.toUpperCase());
      expect(input).toBeDefined();
      const tuples = decode(input!.value) as [string, string, number, number, number, number, string][];
      expect(tuples).toHaveLength(24);
      for (const [settingId, sourceGroupId, x, z, radius, count, rationale] of tuples) {
        expect(typeof rationale).toBe('string');
        const row = { id: `pack_${regionId}_${settingId}`, regionId, settingId, sourceGroupId, centre: [x, z], radius, count };
        expect(valid(PackRecordSchema, row)).toStrictEqual(row);
        sourceIds.push(row.id);
      }
    }
    expect(sourceIds).toEqual(baseline.orders.regionalPacks);
    for (const row of rows(baseline.original.regionalPacks)) {
      const { rationale, placementRisks, ...runtime } = row;
      expect(typeof rationale).toBe('string');
      expect(Array.isArray(placementRisks)).toBe(true);
      expect(valid(AcceptedPackSchema, runtime)).toStrictEqual(runtime);
    }
    // These are staged spatial projections, not claims of live measured acceptance.
    // The live 16-pack catalogue requires the root's manifest-backed export.
    for (const row of rows(baseline.original.regionalPackPlan)) {
      const { packId, speciesId } = row;
      expect(valid(PackAssignmentSchema, { packId, speciesId })).toStrictEqual({ packId, speciesId });
    }
    const activation = decode(baseline.original.regionalPackActivation) as Row;
    const overrides = activation.assignmentOverrides as Record<string, string | null>;
    const storedActivation = { ...activation, assignmentOverrides: Object.entries(overrides).map(([packId, speciesId]) => ({ packId, speciesId })) };
    expect(valid(PackActivationSchema, storedActivation)).toStrictEqual(storedActivation);
    const layouts = decode(baseline.original.regionalPackLayout) as Record<string, Row>;
    for (const [packId, row] of Object.entries(layouts)) {
      const { purpose: _purpose, ...runtime } = row;
      expect(valid(PackLayoutSchema, { packId, ...runtime })).toStrictEqual({ packId, ...runtime });
    }
  });
});
