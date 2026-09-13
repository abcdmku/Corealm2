import { SPELL_ELEMENTS } from '../../contracts.js';
import {
  arr, bool, enumOf, id, int, lit, nullable, num, obj, opt, ref, refine, str, tuple, union,
  type Infer, type Schema,
} from './core.js';

const Identity = { readOnly: true, identity: true } as const;
const nonempty = () => str({ nonEmpty: true });
const positive = () => num({ exclusiveMin: 0 });
const radius = () => num({ min: 0 }, { unit: 'm' });
const count = () => int({ min: 1 }, Identity);
// Spatial reference domains are checked by the loader's spatial indexes. Core RefKind
// does not yet expose these domains; never label a group/input ID as an enemy ID.
const spatialRef = (help: string) => str({ nonEmpty: true }, { ...Identity, help });
const unique = <T>(values: readonly T[]) => new Set(values).size === values.length;
function uniqueRows<T>(schema: Schema<T>, key: (row: T) => string, label: string) {
  return refine(arr(schema), (rows) => unique(rows.map(key)), `duplicate ${label}`);
}

export const SPAWN_REGION_IDS = [
  'fallowmarch', 'vellenwood', 'karrowmoor', 'gravelmaw', 'kilnhalt',
  'wilderness', 'crownward', 'gloamgarden', 'faeholme',
] as const;
export const PACK_REGION_IDS = ['fallowmarch', 'vellenwood', 'karrowmoor', 'kilnhalt'] as const;
export const SPAWN_SOURCE_CATALOGS = [
  'region', 'dungeon', 'regionalVariant', 'starter', 'redWorm', 'creatureExpansion',
  'wilderness', 'deepWilderness', 'crownward', 'fairy', 'biomePopulation',
] as const;
export const HABITAT_SOURCE_CATALOGS = [
  'world', 'regionalVariant', 'amethystCave', 'starter', 'redWorm', 'creatureExpansion',
  'wilderness', 'deepWilderness', 'biomePopulation', 'fairyTerrace',
] as const;
export const RegionIdSchema = enumOf(SPAWN_REGION_IDS, { ...Identity, ref: 'region' });
export const PackRegionIdSchema = enumOf(PACK_REGION_IDS, { ...Identity, ref: 'region' });
export const ActivitySchema = enumOf(['graze', 'forage', 'prowl', 'patrol'] as const);
export const RankSchema = enumOf(['ordinary', 'seasoned', 'mature'] as const);
export const SourceCatalogSchema = enumOf(SPAWN_SOURCE_CATALOGS, Identity);
export const HabitatSourceCatalogSchema = enumOf(HABITAT_SOURCE_CATALOGS, Identity);
// Mutable tuples remain assignable to runtime Spot and dressing scale types.
export const SpotSchema = tuple<[Schema<number>, Schema<number>]>([num(), num()], { unit: 'm' });
export const SpawnVec3Schema = tuple<[Schema<number>, Schema<number>, Schema<number>]>([num(), num(), num()], { unit: 'm' });
export const BoundsSchema = refine(obj({ min: SpotSchema, max: SpotSchema }),
  ({ min, max }) => max[0] > min[0] && max[1] > min[1], 'bounds maxima must exceed minima');

export const GroupFields = {
  id: id(), family: nonempty(), name: nonempty(), tier: int({ min: 1 }), count: count(),
  countPolicy: opt(lit('fixed', Identity), Identity), legacyCount: opt(count(), Identity),
  centre: SpotSchema, radius: radius(), assetId: ref('asset'), scale: positive(),
  boss: opt(bool()), miniBoss: opt(bool()),
};
const exclusiveBoss = (row: { boss?: boolean; miniBoss?: boolean }) => !(row.boss && row.miniBoss);
const finalCount = (row: { count: number; countPolicy?: 'fixed'; boss?: boolean; miniBoss?: boolean }) =>
  row.boss || row.miniBoss ? row.count === 1 : row.count <= 15 && (row.countPolicy === 'fixed' || row.count >= 7);
export const GroupSchema = refine(obj(GroupFields), exclusiveBoss, 'boss and miniBoss cannot both be true');
export const AcceptedGroupSchema = refine(GroupSchema, finalCount,
  'final count must be 1 for bosses, 1..15 for fixed groups, or 7..15 for ordinary groups');

const PositiveVec3Schema = tuple<[Schema<number>, Schema<number>, Schema<number>]>([positive(), positive(), positive()]);
export const DressingSchema = obj({
  id: id(), assetId: ref('asset'), x: num({}, { unit: 'm' }), z: num({}, { unit: 'm' }),
  yaw: num({}, { unit: 'rad' }), scale: union([positive(), PositiveVec3Schema] as const), sink: opt(num({}, { unit: 'm' })),
});
export const DressingArraySchema = uniqueRows(DressingSchema, (row) => row.id, 'dressing id within habitat');
export const HabitatFields = {
  id: id(), groupId: spatialRef('Group ID in the spatial group index.'), regionId: RegionIdSchema,
  centre: SpotSchema, radius: radius(), roamRadius: opt(radius()), boundary: opt(lit('playable-coast')),
  anchors: arr(SpotSchema), activity: ActivitySchema, dressing: DressingArraySchema,
};
export const HabitatSchema = obj(HabitatFields);
const withoutCoast = (row: { boundary?: 'playable-coast' }) => !Object.hasOwn(row, 'boundary');
export const PersistedHabitatSchema = refine(HabitatSchema, withoutCoast,
  'persisted habitats must omit boundary; coastal habitats belong to resolved output');
export const FairyDerivationSchema = obj({
  kind: lit('fairySpawn.v1', Identity), source: enumOf(['terrace', 'crown'] as const, Identity), siteId: spatialRef('Fairy site ID.'),
});
const fairyRegion = (regionId: string) => regionId === 'gloamgarden' || regionId === 'faeholme';
export const HabitatRecordSchema = refine(obj({
  ...HabitatFields, sourceInputId: opt(spatialRef('Original habitat source-input row ID.')),
  derived: opt(FairyDerivationSchema),
}), withoutCoast, 'persisted habitats must omit boundary; coastal habitats belong to resolved output');
export const SpawnRecordSchema = refine(refine(refine(obj({
  ...GroupFields, regionId: RegionIdSchema, source: SourceCatalogSchema,
  sourceInputId: spatialRef('Original spawn source-input row ID.'), authored: bool({ readOnly: true }),
  legacyOverride: opt(spatialRef('Original group ID in legacy placements.')), derived: opt(FairyDerivationSchema),
}), exclusiveBoss, 'boss and miniBoss cannot both be true'), finalCount,
  'final count must be 1 for bosses, 1..15 for fixed groups, or 7..15 for ordinary groups'),
  (row) => fairyRegion(row.regionId)
    ? row.source === 'fairy' && row.authored === false && row.derived !== undefined
    : row.source !== 'fairy' && row.derived === undefined,
  'fairy region spawns require fairy source, authored=false and a fairy derivation; other regions cannot use them');
export const SpawnSourceRecordSchema = obj({
  id: id(), catalog: SourceCatalogSchema, regionId: RegionIdSchema, group: GroupSchema,
  habitatInputId: opt(spatialRef('Original habitat source-input row ID.')),
});
export const HabitatSourceRecordSchema = obj({
  id: id(), catalog: HabitatSourceCatalogSchema, habitat: PersistedHabitatSchema,
});

export const ClusterFields = {
  id: id(), resourceId: ref('resource'), count: count(), centre: SpotSchema, radius: radius(),
  locationId: ref('location'), waterBodyId: opt(nonempty()), ringRadius: opt(radius()),
  heroAssetId: opt(ref('asset')), heroScale: opt(positive()),
  essenceElement: opt(enumOf(SPELL_ELEMENTS, { ref: 'element' })),
};
export const ClusterSchema = obj(ClusterFields);
export const ClusterRecordSchema = refine(obj({
  ...ClusterFields, regionId: RegionIdSchema,
  source: enumOf(['regions', 'wildernessResources', 'crownward', 'fairyRegions'] as const, Identity),
  derived: opt(obj({ kind: lit('fairyResource.v1', Identity), intentId: spatialRef('Original fairy resource intent ID.') })),
}), (row) => fairyRegion(row.regionId)
  ? row.source === 'fairyRegions' && row.derived !== undefined
  : row.source !== 'fairyRegions' && row.derived === undefined,
  'fairy region resources require fairyRegions source and a fairy resource derivation; other regions cannot use them');
export const LegacyPlacementSchema = obj({
  id: id({ help: 'Original group ID in the spatial group index.' }), regionId: RegionIdSchema,
  originalCentre: SpotSchema.describe(Identity), originalCount: count(), centre: SpotSchema,
  count: count(), radius: radius(), bodyRadiusBudget: positive(), anchors: opt(arr(SpotSchema)),
  anchorOnly: opt(bool()), floorRect: opt(obj({ centre: SpotSchema,
    halfExtents: tuple<[Schema<number>, Schema<number>]>([positive(), positive()], { unit: 'm' }),
  })), rotationY: opt(num({}, { unit: 'rad' })),
});

export const PackSourceSchema = obj({
  id: id(), assetId: ref('asset'), scale: positive(), baseEnemyDefId: ref('enemy'), activity: ActivitySchema,
  nativeBodyRadius: positive(), nativeVisualRadius: positive(),
});
export const PackRecordSchema = refine(obj({
  id: id(), regionId: PackRegionIdSchema, settingId: spatialRef('Original regional setting ID.'),
  sourceGroupId: spatialRef('Regional pack source row ID.'), centre: SpotSchema,
  radius: positive(), count: count(),
}), (row) => row.id === `pack_${row.regionId}_${row.settingId}`, 'pack id must equal pack_<regionId>_<settingId>');
export const PackAssignmentSchema = obj({
  packId: spatialRef('Regional pack ID.'), speciesId: nullable(ref('species')),
});
export const PackActivationSchema = obj({
  regions: refine(arr(PackRegionIdSchema), unique, 'duplicate activation region'),
  excludedPackIds: refine(arr(spatialRef('Regional pack ID.')), unique, 'duplicate excluded pack ID'),
  assignmentOverrides: uniqueRows(PackAssignmentSchema, (row) => row.packId, 'assignment override pack ID'),
}, {}, { readOnly: true });
export const PackLayoutSchema = obj({ packId: spatialRef('Regional pack ID.'), dressing: DressingArraySchema });
export const PackMemberSchema = obj({
  id: id(), anchorIndex: int({ min: 0 }, Identity), variantId: spatialRef('Regional variant catalogue ID.'),
});
export const AcceptedPackSchema = refine(obj({
  id: id({ help: 'Regional pack ID.' }), regionId: PackRegionIdSchema,
  speciesId: nonempty().describe({ help: 'Original enemy family or assigned creature species ID.' }),
  baseGroupId: spatialRef('Original source group ID.'), baseEnemyDefId: ref('enemy'), assetId: ref('asset'),
  scale: positive(), activity: ActivitySchema, centre: SpotSchema, radius: positive(), anchors: arr(SpotSchema),
  members: uniqueRows(PackMemberSchema, (row) => row.id, 'pack member ID'),
  settingId: spatialRef('Original regional setting ID.'),
  levelRange: refine(tuple<[Schema<number>, Schema<number>]>([int({ min: 1 }), int({ min: 1 })]),
    ([min, max]) => min <= max, 'level minimum must not exceed maximum'),
}), (row) => row.members.every((member) => member.anchorIndex < row.anchors.length),
  'member anchorIndex must address an existing anchor');
export const RegionalPacksSchema = obj({
  sources: uniqueRows(PackSourceSchema, (row) => row.id, 'pack source ID'),
  packs: uniqueRows(PackRecordSchema, (row) => row.id, 'pack ID'),
  assignments: uniqueRows(PackAssignmentSchema, (row) => row.packId, 'assignment pack ID'),
  activation: PackActivationSchema,
  layouts: uniqueRows(PackLayoutSchema, (row) => row.packId, 'layout pack ID'),
  accepted: uniqueRows(AcceptedPackSchema, (row) => row.id, 'accepted pack ID'),
});

export type Group = Infer<typeof GroupSchema>;
export type Dressing = Infer<typeof DressingSchema>;
export type Habitat = Infer<typeof HabitatSchema>;
export type HabitatRecord = Infer<typeof HabitatRecordSchema>;
export type SpawnRecord = Infer<typeof SpawnRecordSchema>;
export type SpawnSourceRecord = Infer<typeof SpawnSourceRecordSchema>;
export type HabitatSourceRecord = Infer<typeof HabitatSourceRecordSchema>;
export type ClusterRecord = Infer<typeof ClusterRecordSchema>;
export type LegacyPlacement = Infer<typeof LegacyPlacementSchema>;
export type PackSource = Infer<typeof PackSourceSchema>;
export type PackRecord = Infer<typeof PackRecordSchema>;
export type PackAssignment = Infer<typeof PackAssignmentSchema>;
export type PackActivation = Infer<typeof PackActivationSchema>;
export type PackLayout = Infer<typeof PackLayoutSchema>;
export type AcceptedPack = Infer<typeof AcceptedPackSchema>;
export type RegionalPacks = Infer<typeof RegionalPacksSchema>;
export type SourceCatalog = Infer<typeof SourceCatalogSchema>;
export type HabitatSourceCatalog = Infer<typeof HabitatSourceCatalogSchema>;
