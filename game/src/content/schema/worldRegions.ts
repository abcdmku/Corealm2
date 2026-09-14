/** Finite authored world geometry. Creature and resource placements are separate sources. */
import { arr, bool, lit, num, obj, opt, str, tuple, union, type Infer } from './core.js';

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
  name: str(),
  position: SpotSchema,
  kind: LocationKindSchema,
  routeNode: bool(),
  blurb: opt(str()),
});

const RoadDefSchema = obj({
  from: str(),
  to: str(),
  meters: opt(num()),
});

const StationDefSchema = obj({
  id: str(),
  name: str(),
  kind: str(),
  skill: str(),
  position: SpotSchema,
  rotationY: num(),
  assetId: str(),
  scale: opt(num()),
  recipeIds: arr(str()),
  essenceElement: opt(str()),
  attachedTo: opt(str()),
});

const BuildingDefSchema = obj({
  id: str(),
  name: str(),
  prefab: str(),
  position: SpotSchema,
  rotationY: num(),
  footprint: tuple([num(), num()] as const),
});

const BankDefSchema = obj({
  id: str(),
  name: str(),
  position: SpotSchema,
  rotationY: num(),
  assetId: str(),
  attachedTo: opt(str()),
});

const ShopDefSchema = obj({
  id: str(),
  name: str(),
  shopKind: union([lit("general"), lit("smith")] as const),
  position: SpotSchema,
  rotationY: num(),
  assetId: str(),
  attachedTo: opt(str()),
});

const NpcStandDefSchema = obj({
  id: str(),
  name: str(),
  position: SpotSchema,
  facingRad: num(),
  assetId: str(),
  dialogueRootId: str(),
  questIds: arr(str()),
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
  assetId: str(),
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
  name: str(),
  kit: str(),
  centre: SpotSchema,
  respawnPointId: str(),
  buildings: arr(BuildingDefSchema),
  stations: arr(StationDefSchema),
  bank: BankDefSchema,
  shops: arr(ShopDefSchema),
  npcs: arr(NpcStandDefSchema),
  walls: opt(arr(WallRunDefSchema)),
  paving: opt(arr(PavingDefSchema)),
  props: opt(arr(PropDefSchema)),
  padShape: opt(PadShapeDefSchema),
});

const ObstacleDefSchema = obj({
  id: str(),
  name: str(),
  reqLevel: num(),
  position: SpotSchema,
  exitPosition: SpotSchema,
  durationMs: num(),
  savesMeters: num(),
  assetId: str(),
  composition: opt(str()),
  scale: opt(num()),
  rotationY: opt(num()),
  fromLocationId: str(),
  toLocationId: str(),
  oneWay: opt(bool()),
  interaction: union([lit("climb"), lit("vault"), lit("enter")] as const),
});

const LandmarkDefSchema = obj({
  id: str(),
  name: str(),
  position: SpotSchema,
  assetId: str(),
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
  name: str(),
  position: SpotSchema,
  assetId: str(),
  toRegionId: str(),
  toLocationId: str(),
  rotationY: opt(num()),
  composition: opt(str()),
});

const RegionAdjacencyDefSchema = obj({
  toRegionId: str(),
  fromLocationId: str(),
  toLocationId: str(),
  meters: num(),
});

const DungeonChamberDefSchema = obj({
  id: str(),
  name: str(),
  centre: SpotSchema,
  radius: num(),
  floorOffset: num(),
  lit: bool(),
});

const DungeonDoorDefSchema = obj({
  id: str(),
  name: str(),
  position: SpotSchema,
  floorOffset: num(),
  assetId: str(),
  state: str(),
  lockedReason: str(),
});

const DungeonDefSchema = obj({
  id: str(),
  name: str(),
  tier: num(),
  entrance: SpotSchema,
  entranceAssetId: str(),
  entranceRotationY: opt(num()),
  entranceScale: opt(num()),
  entranceComposition: opt(str()),
  palette: arr(str()),
  chambers: arr(DungeonChamberDefSchema),
  doors: arr(DungeonDoorDefSchema),
  obstacles: arr(ObstacleDefSchema),
  locations: arr(LocationDefSchema),
  roads: arr(RoadDefSchema),
});

export const WorldRegionSchema = obj({
  id: str(),
  name: str(),
  tier: num(),
  lore: str(),
  bounds: RegionBoundsSchema,
  terrainSeed: num(),
  terrainAmplitude: num(),
  baseHeight: num(),
  terraces: opt(arr(TerraceDefSchema)),
  groundPalette: arr(str()),
  fogStart: num(),
  spawnPoint: SpotSchema,
  spawnFacingRad: num(),
  respawnPointId: str(),
  locations: arr(LocationDefSchema),
  roads: arr(RoadDefSchema),
  stations: arr(StationDefSchema),
  settlement: opt(SettlementDefSchema),
  obstacles: arr(ObstacleDefSchema),
  landmarks: arr(LandmarkDefSchema),
  gates: arr(GateDefSchema),
  adjacency: arr(RegionAdjacencyDefSchema),
  dungeon: opt(DungeonDefSchema),
});
export type WorldRegionGeometry = Infer<typeof WorldRegionSchema>;
