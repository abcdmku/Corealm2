import { Scene, type Group, type Mesh } from "three";
import { GAME_BOOT_PROFILE } from "../../app/bootProfile.js";
import { buildDungeonSpec } from "../../app/dungeonSpec.js";
import { resolveFairyDressing } from "../../app/fairyDressing.js";
import { fishingSiteAnchors } from "../../app/fishingAccess.js";
import { registerHabitatClearances } from "../../app/habitatClearances.js";
import { miningAccessPositions } from "../../app/miningAccess.js";
import { mobSpawnPlacementPorts } from "../../app/mobSpawns.js";
import { createRealmTerrain } from "../../app/realmTerrain.js";
import { registerExclusions } from "../../app/worldExclusions.js";
import { buildFairyTerrainSpec } from "../../app/worldSpec.js";
import { prepareWorldSurface } from "../../app/worldSurface.js";
import type { RegionId } from "../../contracts.js";
import { REGIONS } from "../../content/regions.js";
import { RESOLVED_TABLES } from "../../content/resolvedCatalog.js";
import { WORLD_HABITATS, type HabitatDef } from "../../content/worldHabitats.js";
import { WORLD_SITES, type WorldSite } from "../../content/worldSites.js";
import type { AssetEntry, AssetManifest } from "../../render/assets.js";
import { buildDungeon, dungeonNavigationBlockers } from "../../render/dungeon.js";
import { buildMineCutFace } from "../../render/mineCutFace.js";
import { WorldScene } from "../../render/scene.js";
import { buildStructureNavigationSources } from "../../render/structureNavigation.js";
import { resolveWorldSiteDressing, type ResolvedWorldSiteDressing } from "../../render/worldSiteDressing.js";
import { Navigation } from "../../systems/navigation.js";
import { solidObstacleMeshes } from "../../systems/navigationObstacles.js";
import { cachedWorldValue } from "../cachedWorldValue.js";
import { refineCreaturePopulation } from "../creaturePopulation.js";
import { authoredThresholds } from "../dungeonDoors.js";
import { lavaObstacles } from "../lavaObstacles.js";
import { spreadMobSpawnsCached } from "../mobSpawnCache.js";
import { scatterTilesForBounds, scatterWorldTile, worldExclusions } from "../scatter.js";
import { dryNavigationMeshes } from "../waterNavigation.js";
import type { WorldDataManifest } from "../worldDataFormat.js";
import { generationScope } from "../worldDataFormat.js";
import { WorldRecordWriter, type WorldRecordEntry } from "./worldRecordWriter.js";
import { exportClientNavmesh, type ClientNavmesh } from "./clientNavmesh.js";
import { withCorrectlyRoundedMath } from "./correctlyRoundedMath.js";

/**
 * The client world records, baked in plain Node.
 *
 * `tools/build-world.ts` bakes the same records by driving `app/boot.ts` in Chromium with
 * `?world-bake=1`. Nothing in that bake needs a GPU, so this module runs the steps boot runs, in
 * boot's order, against the same production functions, and writes each record through the same
 * encoding. `tests/node-world-bake-parity.test.ts` holds the two to the same bytes.
 *
 * It bakes the INSTALLED catalog: about 144 content modules read their tables when they are
 * evaluated, so a process bakes one catalog. `installAndBake.ts` installs one and imports this.
 */

/** The asset library the bake reads: manifest measurements and GLB triangles, no textures. */
export interface WorldBakeAssets {
  entry(id: string): AssetEntry | undefined;
  getManifest(): AssetManifest;
  byTags(...tags: string[]): AssetEntry[];
  load(id: string, options?: unknown): Promise<Group>;
  loadMany(ids: readonly string[], options?: unknown): Promise<void>;
  instance(id: string): Group;
  baseY(id: string): number;
  assetSize(id: string): { x: number; y: number; z: number } | null;
  assetCenterXZ(id: string): { x: number; z: number } | null;
}

export interface WorldRecordBakeInput {
  /** The catalog to bake. It must be the installed one (`RESOLVED_TABLES`); see `installAndBake.ts`. */
  tables: Record<string, unknown>;
  /** The build's `generationRevision`: the code the records were baked with. */
  codeRevision: string;
  /** `worldGeometryRevision(codeRevision, geometry hash)`. The manifest's `revision`. */
  geometryRevision: string;
  seed: number;
  assets: WorldBakeAssets;
  /** Receives each record's gzip bytes as soon as it is complete. Store it as `generated/world/<entry.file>`. */
  onRecord(key: string, gzipBytes: Uint8Array, entry: WorldRecordEntry): void | Promise<void>;
  log?(message: string): void;
  /** Tests bake a sample. Default: every tile of both maps, which a release manifest requires. */
  tiles?: (tileId: string) => boolean;
}

export interface WorldRecordBake {
  manifest: WorldDataManifest;
  /** `generated/corealm-navmesh.nav` and the identity the client checks it against. */
  navmesh: ClientNavmesh;
  timings: Record<string, number>;
}

/**
 * Bakes every client world record of the installed catalog. `Math` is correctly rounded while it runs, as
 * Chromium's is (see `correctlyRoundedMath.ts`), so a bake owns its process.
 */
export async function bakeWorldRecords(input: WorldRecordBakeInput): Promise<WorldRecordBake> {
  if (input.tables !== RESOLVED_TABLES) throw new Error("bakeWorldRecords bakes the installed catalog. Install the tables first (world/bake/installAndBake.ts), in a process of their own.");
  return withCorrectlyRoundedMath(() => bake(input));
}

async function bake(input: WorldRecordBakeInput): Promise<WorldRecordBake> {
  const { seed, assets } = input, log = input.log ?? (() => {});
  const timings: Record<string, number> = {};
  let mark = performance.now();
  const step = (name: string) => { const now = performance.now(); timings[name] = Math.round(now - mark); mark = now; log(`World bake: ${name} ${timings[name]} ms`); };
  const writer = new WorldRecordWriter(input.onRecord);
  const profile = GAME_BOOT_PROFILE;
  await Navigation.initLibrary();

  // Terrain: boot's `scene.buildWorldCached` and `createRealmTerrain`, which write `terrain/world` and `terrain/fairy`.
  const prepareSurface = (prepared: WorldScene) => prepareWorldSurface(prepared, seed);
  const terrainSpec = profile.terrain();
  const scene = new WorldScene(new Scene());
  await scene.buildWorldCached(writer, "world", terrainSpec, prepareSurface);
  const fairyRealm = await createRealmTerrain(new Scene(), buildFairyTerrainSpec(), { cache: writer, cacheKey: "fairy", prepareSurface });
  const terrainAt = (x: number, z: number): WorldScene => fairyRealm.contains(x, z) ? fairyRealm.scene : scene;
  const heightAt = (regionId: RegionId, x: number, z: number): number => terrainAt(x, z).heightAt(regionId, x, z);
  const meshHeightAt = (x: number, z: number) => terrainAt(x, z).meshHeightAt(x, z);
  step("terrain");

  // The semantic world, with boot's world ports.
  const authoredDungeonSpec = buildDungeonSpec(scene);
  const dungeonRegion = REGIONS.find(region => region.dungeon);
  const doorThresholds = dungeonRegion?.dungeon ? authoredThresholds(dungeonRegion.dungeon, heightAt(dungeonRegion.id, ...dungeonRegion.dungeon.entrance)) : [];
  const built = await cachedWorldValue(writer, "assembly/semantic",
    () => profile.buildSemanticWorld(seed, heightAt, gameWorldPorts({ scene, fairyScene: fairyRealm.scene, terrainAt, heightAt, assets, dungeonGates: doorThresholds.length > 0 })),
    (value): value is ReturnType<typeof profile.buildSemanticWorld> => value !== null);
  const worldHabitats: HabitatDef[] = [...WORLD_HABITATS];
  if (terrainSpec.lavaChannels?.length) built.solids.push(...lavaObstacles(terrainSpec.lavaChannels, meshHeightAt));
  step("semantic");

  // Site dressing and mine cut faces (`site-cut/<site>`), then the fairy dressing.
  const sitePlacements: ResolvedWorldSiteDressing[] = [];
  for (const setting of worldSettings(worldHabitats)) {
    if (!setting.dressing.length) continue;
    const settingScene = terrainAt(setting.centre[0], setting.centre[1]);
    const result = resolveWorldSiteDressing(settingScene, assets, setting);
    sitePlacements.push(...result.placements);
    built.solids.push(...result.solids);
    if (setting.cutFace) built.solids.push(...(await buildMineCutFace(settingScene, assets, setting, built.entities, writer)).solids);
  }
  const fairyDressing = await cachedWorldValue(writer, "assembly/fairyDressing", () => resolveFairyDressing(fairyRealm.scene),
    (value): value is ReturnType<typeof resolveFairyDressing> => value !== null);
  built.solids.push(...fairyDressing.solids);
  step("sites");

  // Navigation over boot's inputs. The game boots the dungeon with the scanned-rock envelope, which shapes its ceiling.
  const dungeon = authoredDungeonSpec ? buildDungeon(authoredDungeonSpec, scene.materials, { rockEnvelope: true }) : null;
  const structures = await buildStructureNavigationSources(assets, built.entities);
  const walkable: Mesh[] = [
    ...dryNavigationMeshes(scene.getWalkableMeshes(), scene.getWaterBodies()).meshes,
    ...fairyRealm.getWalkableMeshes(),
    ...(dungeon?.walkable ?? []),
    ...dungeonNavigationBlockers(dungeon?.blockers ?? []),
    ...structures.meshes,
    ...solidObstacleMeshes(built.solids),
  ];
  const nav = new Navigation();
  if (!nav.build(walkable)) throw new Error(`World bake navigation failed: ${nav.getDiagnostics().error}`);
  nav.setRouteGraph(built.routeNodes, built.routeEdges);
  step("navigation");

  // Creature placement (`spawns/world`): boot's `applyMobSpacing(built.entities, true)`.
  const residents = refineCreaturePopulation(built.entities, undefined, id => assets.assetSize(id));
  built.entities.splice(0, built.entities.length, ...residents);
  const placement = mobSpawnPlacementPorts({ solids: built.solids, scene, nav, dungeonSpec: authoredDungeonSpec, doorThresholds, profile, terrainAt });
  const spread = await spreadMobSpawnsCached(writer, built.entities, worldHabitats, placement);
  worldHabitats.splice(0, worldHabitats.length, ...spread.filter(habitat => habitat.regionId !== authoredDungeonSpec?.regionId));
  step("spawns");

  const navmesh = await exportClientNavmesh(nav, walkable, seed);
  step("navmesh export");

  // Scatter (`scatter/<tile>`), after the same exclusions boot registers.
  const tiles: string[] = [];
  const grass = "corealm_grass_1";
  await assets.load(grass);
  scene.setGrassSource(assets.instance(grass));
  registerExclusions(scene, built.solids, sitePlacements, fairyRealm.scene);
  registerHabitatClearances(nav, built.entities, worldHabitats, worldExclusions);
  for (const mapScene of [scene, fairyRealm.scene]) {
    if (!mapScene.hasNativeGrass()) mapScene.setGrassSource(assets.instance(grass));
    for (const tile of scatterTilesForBounds(mapScene.getScatterBounds(Infinity))) {
      if (input.tiles && !input.tiles(tile.id)) continue;
      const result = await scatterWorldTile(mapScene, assets, seed, tile, mapScene === fairyRealm.scene ? fairyDressing.specs : undefined, { cache: writer, render: false });
      if (result.some(region => region.missingAssets.length)) throw new Error(`Cannot bake incomplete tile ${tile.id}`);
      tiles.push(tile.id);
      if (tiles.length % 40 === 0) log(`World bake: ${tiles.length} tiles`);
    }
  }
  step("scatter");

  const manifest: WorldDataManifest = { format: "corealm-world", version: 1, revision: input.geometryRevision,
    scope: generationScope(profile.kind, seed, ""), tiles, records: writer.records };
  return { manifest, navmesh, timings };
}

/** Boot's world sites: the authored settings, then every habitat as a setting of its own dressing. */
export function worldSettings(habitats: readonly HabitatDef[]): WorldSite[] {
  return [...WORLD_SITES, ...habitats.map((habitat): WorldSite => ({
    id: habitat.id, locationId: habitat.groupId, regionId: habitat.regionId, centre: [0, 0], rotationY: 0, kind: "habitat",
    workRadius: 0, extent: [0, 0], terrain: { floorRadius: 0, backRise: 0, backDistance: 0, bermWidth: 0, approachAngle: 0 },
    resourceSlots: [], dressing: habitat.dressing,
  }))];
}

/** The ports boot hands `buildSemanticWorld` for the authored game. */
export function gameWorldPorts(options: {
  scene: WorldScene; fairyScene: WorldScene; terrainAt: (x: number, z: number) => WorldScene;
  heightAt: (regionId: RegionId, x: number, z: number) => number;
  assets: Pick<WorldBakeAssets, "baseY" | "assetSize" | "assetCenterXZ">; dungeonGates: boolean;
}) {
  const { scene, terrainAt, assets } = options;
  const meshHeightAt = (x: number, z: number) => terrainAt(x, z).meshHeightAt(x, z);
  const roadPolylines = [...scene.getRoadPolylines(), ...options.fairyScene.getRoadPolylines()];
  const roadDistance = (x: number, z: number): number => {
    let best = Infinity;
    for (const line of roadPolylines) {
      for (let index = 0; index < line.length - 1; index += 1) {
        const a = line[index]!, b = line[index + 1]!;
        const dx = b[0] - a[0], dz = b[2] - a[2];
        const lengthSq = dx * dx + dz * dz;
        const t = lengthSq <= 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / lengthSq));
        best = Math.min(best, Math.hypot(x - (a[0] + dx * t), z - (a[2] + dz * t)));
      }
    }
    return best;
  };
  let fishingAnchors: ReturnType<typeof fishingSiteAnchors> | undefined;
  const getFishingAnchors = () => fishingAnchors ??= fishingSiteAnchors(WORLD_SITES, scene.getWaterBodies(), meshHeightAt);
  return {
    heightAt: options.heightAt,
    dungeonGates: options.dungeonGates,
    get accessPositions() {
      return new Map([...getFishingAnchors().banks, ...miningAccessPositions(WORLD_SITES, meshHeightAt, {
        assetSize: id => assets.assetSize(id), assetCenterXZ: id => assets.assetCenterXZ(id) })]);
    },
    get fishingSchools() { return getFishingAnchors().schools; },
    baseY: (assetId: string): number => assets.baseY(assetId),
    assetSize: (assetId: string) => assets.assetSize(assetId),
    assetCenterXZ: (assetId: string) => assets.assetCenterXZ(assetId),
    roadDistance,
    minibossCanStand: (regionId: RegionId, x: number, z: number) => {
      const sample = terrainAt(x, z).sampleWorld(x, z);
      return sample.playable && sample.semanticRegion === regionId && sample.waterBodyId === null && sample.slope !== null && sample.slope <= .5;
    },
  };
}

