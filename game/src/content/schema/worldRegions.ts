/**
 * Finite authored world geometry. Creature and resource placements are separate sources.
 *
 * This file is also the source for three `RefKind`s that have no collection of their own:
 * `location` (every `locations[]` entry, including a dungeon's), `settlement` (`settlement`), and
 * `entity` (landmarks, obstacles, gates and dungeon doors). See `REF_KIND_SOURCES` in core.ts.
 */
import { arr, bool, lit, num, obj, opt, ref, str, tuple, union, type Infer } from './core.js';

const SpotSchema = tuple([num(), num()] as const);

const RegionBoundsSchema = obj({
  min: SpotSchema,
  max: SpotSchema,
});

const TerraceDefSchema = obj({
  index: num(),
  minZ: num(),
  maxZ: num(),
  height: num(),
});

const LocationKindSchema = union([lit("settlement"), lit("bank"), lit("seam"), lit("grove"), lit("water"), lit("gate"), lit("landmark"), lit("camp"), lit("junction"), lit("dungeon")] as const);

const LocationDefSchema = obj({
  id: str(),
  name: str({}, { display: true }),
  position: SpotSchema,
  kind: LocationKindSchema,
  routeNode: bool(),
  blurb: opt(str(), { multiline: true }),
});

const RoadDefSchema = obj({
  from: ref('location', { label: 'From', role: 'Road end' }),
  to: ref('location', { label: 'To', role: 'Road end' }),
  meters: opt(num(), { unit: 'm' }),
});

const StationDefSchema = obj({
  id: str(),
  name: str({}, { display: true }),
  kind: ref('station', { label: 'Station kind', role: 'Station of kind' }),
  skill: ref('skill', { label: 'Skill', role: 'Uses skill' }),
  position: SpotSchema,
  rotationY: num({}, { unit: 'rad' }),
  assetId: ref('asset', { label: 'Model', role: 'Model for' }),
  scale: opt(num()),
  recipeIds: arr(ref('recipe', { label: 'Recipe', role: 'Made at' }), {}, { label: 'Recipes', role: 'Made at' }),
  essenceElement: opt(ref('element', { role: 'Uses element' }), { label: 'Essence element', role: 'Uses element' }),
  // Building ids are local to the settlement that owns them; no collection holds them.
  attachedTo: opt(str(), { label: 'Attached to' }),
});

const BuildingDefSchema = obj({
  id: str(),
  name: str(),
  prefab: str(),
  model: opt(obj({
    assetId: ref('asset', { label: 'Model', role: 'Model for' }),
    scale: num({ min: 0.0001 }),
    collision: arr(obj({
      tag: str(), dx: num(), dz: num(),
      sizeX: num({ min: 0.0001 }), sizeZ: num({ min: 0.0001 }), height: num({ min: 0.0001 }),
    })),
  })),
  position: SpotSchema,
  rotationY: num(),
  footprint: tuple([num(), num()] as const),
});

const BankDefSchema = obj({
  id: str(),
  name: str({}, { display: true }),
  position: SpotSchema,
  rotationY: num({}, { unit: 'rad' }),
  assetId: ref('asset', { label: 'Model', role: 'Model for' }),
  attachedTo: opt(str(), { label: 'Attached to' }),
});

const ShopDefSchema = obj({
  id: str(),
  name: str(),
  shopKind: union([lit("general"), lit("smith"), lit("potion"), lit("cloth"), lit("fish"), lit("meat"), lit("cosmic")] as const),
  position: SpotSchema,
  rotationY: num({}, { unit: 'rad' }),
  assetId: ref('asset', { label: 'Model', role: 'Model for' }),
  attachedTo: opt(str(), { label: 'Attached to' }),
});

const NpcStandDefSchema = obj({
  id: str(),
  name: str({}, { display: true }),
  position: SpotSchema,
  facingRad: num({}, { unit: 'rad' }),
  assetId: ref('asset', { label: 'Model', role: 'Model for' }),
  dialogueRootId: ref('dialogue', { label: 'Dialogue root', role: 'Speaks' }),
  questIds: arr(ref('quest', { label: 'Quest', role: 'Offers' }), {}, { label: 'Quests', role: 'Offers', ordered: true }),
});

const WallOpeningDefSchema = obj({
  at: num(),
  width: num(),
});

const WallRunDefSchema = obj({
  id: str(),
  name: str(),
  from: SpotSchema,
  to: SpotSchema,
  openings: opt(arr(WallOpeningDefSchema)),
});

const PavingRectSchema = obj({
  minX: num(),
  minZ: num(),
  maxX: num(),
  maxZ: num(),
});

const PavingAssetIdSchema = union([lit("floor_cobble"), lit("floor_brick"), lit("floor_wood"), lit("floor_wood_light")] as const);

const PavingDefSchema = obj({
  id: str(),
  rect: PavingRectSchema,
  assetId: PavingAssetIdSchema,
  kerb: opt(bool()),
});

const PropDefSchema = obj({
  id: str(),
  assetId: ref('asset', { label: 'Model', role: 'Model for' }),
  position: SpotSchema,
  rotationY: num(),
  scale: opt(num()),
  dy: opt(num()),
  solid: opt(bool()),
});

const PadShapeDefSchema = obj({
  halfX: num(),
  halfZ: num(),
  rotationY: num(),
});

const SettlementDefSchema = obj({
  id: str(),
  name: str({}, { display: true }),
  tier: num({ min: 1 }, { label: 'Town tier' }),
  bankLocationId: ref('location', { label: 'Bank approach', role: 'Bank approach for' }),
  kit: str(),
  centre: SpotSchema,
  respawnPointId: ref('location', { label: 'Respawn point', role: 'Respawn for' }),
  buildings: arr(BuildingDefSchema, {}, { label: 'Buildings' }),
  stations: arr(StationDefSchema, {}, { label: 'Stations', role: 'Station in' }),
  bank: BankDefSchema.describe({ label: 'Bank', role: 'Bank in' }),
  shops: arr(ShopDefSchema, {}, { label: 'Shops', role: 'Shop in' }),
  npcs: arr(NpcStandDefSchema, {}, { label: 'NPC stands', role: 'Stands in' }),
  walls: opt(arr(WallRunDefSchema, {}, { label: 'Walls' })),
  paving: opt(arr(PavingDefSchema, {}, { label: 'Paving' })),
  props: opt(arr(PropDefSchema, {}, { label: 'Props', role: 'Prop in' })),
  padShape: opt(PadShapeDefSchema),
});

const ObstacleDefSchema = obj({
  id: str(),
  name: str({}, { display: true }),
  reqLevel: num({}, { label: 'Required agility' }),
  position: SpotSchema,
  exitPosition: SpotSchema,
  durationMs: num({}, { unit: 'ms' }),
  savesMeters: num({}, { unit: 'm' }),
  // Traversal prefabs (corealm_traversal_climb) are not manifest assets, so this stays a plain id.
  assetId: str({}, { label: 'Model' }),
  composition: opt(str()),
  scale: opt(num()),
  rotationY: opt(num({}, { unit: 'rad' })),
  fromLocationId: ref('location', { label: 'From', role: 'Obstacle end' }),
  toLocationId: ref('location', { label: 'To', role: 'Obstacle end' }),
  oneWay: opt(bool()),
  interaction: union([lit("climb"), lit("vault"), lit("enter")] as const),
});

const LandmarkDefSchema = obj({
  id: str(),
  name: str({}, { display: true }),
  position: SpotSchema,
  assetId: ref('asset', { label: 'Model', role: 'Model for' }),
  scale: opt(num()),
  rotationY: opt(num()),
  clipFraction: opt(num()),
  blurb: str(),
  composition: opt(str()),
  solid: opt(bool()),
  compositionOnly: opt(bool()),
  originOnGround: opt(bool()),
});

const GateDefSchema = obj({
  id: str(),
  name: str({}, { display: true }),
  position: SpotSchema,
  assetId: ref('asset', { label: 'Model', role: 'Model for' }),
  toRegionId: ref('region', { label: 'To region', role: 'Gate into' }),
  toLocationId: ref('location', { label: 'To location', role: 'Gate into' }),
  rotationY: opt(num()),
  composition: opt(str()),
});

const RegionAdjacencyDefSchema = obj({
  toRegionId: ref('region', { label: 'To region', role: 'Adjacent to' }),
  fromLocationId: ref('location', { label: 'From', role: 'Border crossing' }),
  toLocationId: ref('location', { label: 'To', role: 'Border crossing' }),
  meters: num({}, { unit: 'm' }),
});

const DungeonChamberDefSchema = obj({
  id: str(),
  name: str({}, { display: true }),
  centre: SpotSchema,
  radius: num(),
  floorOffset: num(),
  lit: bool(),
});

const DungeonDoorDefSchema = obj({
  id: str(),
  name: str({}, { display: true }),
  position: SpotSchema,
  floorOffset: num(),
  assetId: ref('asset', { label: 'Model', role: 'Model for' }),
  state: str(),
  lockedReason: str(),
});

const DungeonDefSchema = obj({
  id: str(),
  name: str({}, { display: true }),
  tier: num(),
  entrance: SpotSchema,
  entranceAssetId: ref('asset', { label: 'Entrance model', role: 'Model for' }),
  entranceRotationY: opt(num()),
  entranceScale: opt(num()),
  entranceComposition: opt(str()),
  palette: arr(str(), {}, { label: 'Palette' }),
  chambers: arr(DungeonChamberDefSchema, {}, { label: 'Chambers' }),
  doors: arr(DungeonDoorDefSchema, {}, { label: 'Doors', role: 'Door in' }),
  obstacles: arr(ObstacleDefSchema, {}, { label: 'Obstacles', role: 'Obstacle in' }),
  locations: arr(LocationDefSchema, {}, { label: 'Locations' }),
  roads: arr(RoadDefSchema, {}, { label: 'Roads', role: 'Road end' }),
});

export const WorldRegionSchema = obj({
  id: str(),
  name: str({}, { display: true }),
  tier: num(),
  lore: str({}, { multiline: true }),
  bounds: RegionBoundsSchema,
  terrainSeed: num(),
  terrainAmplitude: num(),
  baseHeight: num(),
  terraces: opt(arr(TerraceDefSchema)),
  groundPalette: arr(str()),
  fogStart: num(),
  spawnPoint: SpotSchema,
  spawnFacingRad: num({}, { unit: 'rad' }),
  respawnPointId: ref('location', { label: 'Respawn point', role: 'Respawn for' }),
  locations: arr(LocationDefSchema, {}, { label: 'Locations' }),
  roads: arr(RoadDefSchema, {}, { label: 'Roads', role: 'Road end' }),
  stations: arr(StationDefSchema, {}, { label: 'Stations', role: 'Station in' }),
  settlements: arr(SettlementDefSchema, {}, { label: 'Settlements', role: 'Settlement in' }),
  obstacles: arr(ObstacleDefSchema, {}, { label: 'Obstacles', role: 'Obstacle in' }),
  landmarks: arr(LandmarkDefSchema, {}, { label: 'Landmarks', role: 'Landmark in' }),
  gates: arr(GateDefSchema, {}, { label: 'Gates', role: 'Gate in' }),
  adjacency: arr(RegionAdjacencyDefSchema, {}, { label: 'Adjacency', role: 'Adjacent to' }),
  dungeon: opt(DungeonDefSchema, { label: 'Dungeon' }),
});
export type WorldRegionGeometry = Infer<typeof WorldRegionSchema>;
