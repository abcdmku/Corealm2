/**
 * Region data in, semantic entities and a route graph out.
 *
 * Deterministic from a seed: same seed, byte-identical output. That is not a nicety - the harness
 * calls `__gameDebug.reset({ seed })` before every acceptance check and diffs the resulting state,
 * so a single unseeded `Math.random()` in here would make every test flap. Everything random goes
 * through the `"world"` stream of `core/rng.ts`, consumed in a fixed order:
 *
 *   regions in REGIONS order
 *     -> clusters in declaration order
 *       -> nodes 0..count-1: placement jitter, then the yield roll and one compatibility draw
 *     -> enemy groups in declaration order
 *       -> members 0..count-1: placement jitter
 *   -> the dungeon, last
 *
 * Adding a cluster to the end of a region therefore shifts nothing before it. Adding one in the
 * middle reshuffles that region's later rolls, which is fine but worth knowing.
 *
 * Walls, paving, props and every solid volume emitted here draw ZERO numbers from that stream -
 * they are pure functions of the authored data plus `variantSeed(id)`, which is an FNV hash of the
 * id. That is deliberate: it means the whole settlement-dressing feature could be added in the
 * middle of the build without reshuffling a single later roll, and the seeded world diffed clean.
 *
 * The root supplies `heightAt`, so terrain stays owned by exactly one layer and no entity can end
 * up floating because two files disagreed about the ground. It also supplies `baseY` and
 * `assetSize` through `WorldPorts` for the same reason: the manifest is render-layer data and
 * `world/` must not import `render/assets.ts`, so the measurement arrives as a port.
 */
import type {
  Archetype, EntityId, InteractionId, RegionId, SemanticEntity, SkillId, SolidVolume, Vec3,
} from "../contracts.js";
import { INTERACT_RANGE } from "../app/config.js";
import { worldSiteResourceSlot, worldSitePoint } from "../content/worldSites.js";
import { habitatForGroup, type HabitatDef } from "../content/worldHabitats.js";
import { RngStreams, Rng } from "../core/rng.js";
import { content, enemyCombatLevel } from "../content/index.js";
import type { EnemyDef, GatheringResourceArchetype, ResourceDef } from "../content/index.js";
import { enemyBlockFor } from "../content/enemies.js";
import { QUESTS } from "../content/quests.js";
import { resourceDef } from "../content/resources.js";
import {
  REGIONS, WALK_SPEED_MPS,
  type BuildingDef, type DungeonDef, type EnemyGroupDef, type LocationDef, type ObstacleDef,
  type PavingDef, type PrefabId, type PropDef, type RegionDef, type ResourceClusterDef,
  type SettlementDef, type Spot, type WallRunDef,
} from "../content/regions.js";
import {
  BUILDING_KITS, GATE_GAP_METRES, MODULE_METRES,
  buildComposition, buildPrefab, buildWallRun, prefabCollision, variantSeed, wallRunCollision,
  type BuildingKit, type CompositionId, type PartPlacement, type PrefabBox,
} from "../render/buildings.js";
import { tierSilhouetteScale } from "../core/math.js";
import { npcOutfitParts } from "../render/characterAppearances.js";
import type { KnownLocation } from "./entities.js";
import { WATER_FILL_DEPTH } from "./waterBodies.js";
import { authoredThresholds, createDungeonDoorEntities } from "./dungeonDoors.js";
import { portalEntrance } from "./portalEntrance.js";
import { portalMantleSolid } from "./portalMantle.js";

// ------------------------------------------------------------------ formulas

/**
 * Dresses an NPC: body stays the body, clothes arrive as layered parts.
 *
 * The comment this replaces claimed the Modular Outfits pack ships "complete full-body variants on
 * the same 65-bone skeleton". Both halves are false, and believing them made every NPC in the game
 * headless. Measured by structural dump of the GLBs: `outfit_male_peasant.glb` holds exactly four
 * meshes (Male_Peasant_Arms, _Body, _Feet, _Legs), tops out at y = 1.559 against `base_male`'s
 * 1.810, and carries no Head, Eyes or Eyebrows — 25.1 cm of missing head, and you could see the
 * town wall through the neck (runs/corealm/screenshots/RIG-npc-crop.png). The library also holds
 * FOUR distinct 65-joint rigs, not one, grouped by the sha1 of each file's inverseBindMatrices.
 *
 * So `view.assetId` keeps whatever body `regions.ts` authored — that is the file with the face —
 * and the outfit is returned as `view.partAssetIds` for `render/skinning.ts` to rebind onto the
 * body's own bones. The ranger/peasant choice is byte-for-byte the one this function already made,
 * so no NPC changes clothes.
 */
function outfitPartsFor(npcId: string, baseAssetId: string): string[] {
  return npcOutfitParts(npcId, baseAssetId);
}

/** Every quest a given NPC hands out, derived from the quest table rather than duplicated. */
function questIdsForNpc(npcId: string): string[] {
  return QUESTS.filter((quest) => quest.giverNpcId === npcId).map((quest) => quest.id);
}

/**
 * PRD 2.6 with the root's correction R3 (tier 1 floor is 8, not 9):
 *   8-15 at tier 1, 8-15 at tier 5, 8-14 at tier 10.
 */
export function yieldRange(tier: number): readonly [number, number] {
  return [
    Math.max(4, Math.round(8.5 - 0.052 * tier)),
    Math.max(8, Math.round(15 - 0.052 * tier)),
  ];
}

/** PRD 2.6: 21 s at tier 1, 32 s at tier 5, 43 s at tier 10. */
export function respawnSeconds(tier: number): number {
  return Math.round(18 + 3.2 * Math.pow(tier, 0.9));
}

export function rollYield(rng: Rng, tier: number): number {
  const [min, max] = yieldRange(tier);
  return rng.int(min, max);
}

// -------------------------------------------------------------- route graph

export interface RouteNodeOut {
  id: string;
  name: string;
  position: Vec3;
  regionId: RegionId;
}

export interface RouteEdgeOut {
  from: string;
  to: string;
  /** Seconds. */
  cost: number;
  kind: "walk" | "shortcut" | "portal";
  obstacleId?: string;
  /** The portal entity a `portal` edge crosses. */
  portalId?: string;
  reqLevel?: number;
  /** Where the player must stand to use a portal. */
  entrance?: Vec3;
  /** Where the portal puts them down. */
  exit?: Vec3;
  /** How long the crossing takes, in milliseconds. */
  durationMs?: number;
}

/**
 * A portal the route graph can cross, collected in pass 2 and turned into edges in pass 3.
 *
 * Collected rather than authored because the portal ENTITY is where the truth lives: it carries
 * `meta.toRegionId` / `meta.toLocationId`, `systems/travel.ts` reads those to run the interaction,
 * and a second authored copy of the same link in `content/regions.ts` would be free to drift.
 */
export interface PortalLinkOut {
  entityId: EntityId;
  /** The route node the portal stands at. */
  fromLocationId: string;
  /** The route node it leads to, from `meta.toLocationId`. */
  toLocationId: string;
  /** The portal's own world position: where the player must be standing to use it. */
  position: Vec3;
}

/**
 * How long stepping through a portal takes, in milliseconds.
 *
 * A crossing with no duration is a free edge, and a free edge makes the planner treat the Gravelmaw
 * mouth as if it were not in the way at all. 800 ms is a beat the player spends standing in the
 * mouth. It charges the route 3.4 m of walking against the 17.1 m the crossing covers, which is
 * cheap enough that going through is still obviously the way out and dear enough that the plan is
 * not free.
 */
const PORTAL_CROSSING_MS = 800;

/**
 * A solid mass a building occupies, in world space.
 *
 * Superseded by `BuiltWorld.solids`, which covers every solid thing in the world rather than only
 * the 36 authored buildings, and which measures its base off the ground instead of its centre.
 * This shape stays exactly as it is because `app/boot.ts` steps 8b and 9 still read it; the two
 * lists describe the same 39 building boxes, so wiring `solids` means dropping this one, not
 * merging them.
 *
 * Buildings HAVE been solid since round 4 — a TODO here claimed otherwise until Phase 2, which is
 * why the next reader kept looking for the missing wiring. `rotationY` is about the box centre;
 * `halfExtents` is [x, y, z] in the building's own frame.
 */
export interface BuildingBox {
  id: string;
  buildingId: string;
  name: string;
  regionId: RegionId;
  prefab: PrefabId;
  /** Centre of the box: ground height at the building origin plus half its height. */
  position: Vec3;
  halfExtents: readonly [number, number, number];
  rotationY: number;
}

export interface BuiltWorld {
  entities: SemanticEntity[];
  routeNodes: RouteNodeOut[];
  routeEdges: RouteEdgeOut[];
  /** Named places for `EntityStore.registerLocations`, so `scope: "known"` has something to say. */
  knownLocations: KnownLocation[];
  /** Collision volumes for the assembled buildings. See `BuildingBox`. */
  buildings: BuildingBox[];
  /**
   * Every volume the player must not walk into, in the frozen `SolidVolume` shape.
   *
   * Measured before this existed: the whole world had 40 colliders (one terrain heightfield plus
   * 39 building boxes) against 892 semantic entities, so the player walked through the bank chest,
   * the anvil, both market stalls, a resource tree and an ore rock. This list is a superset of
   * `buildings` — it repeats those 39 as boxes with a base-relative `y` — so a consumer takes one
   * or the other, never both.
   */
  solids: SolidVolume[];
}

export type HeightAt = (regionId: RegionId, x: number, z: number) => number;

/** The manifest bbox of one asset, in metres. Mirrors `AssetRegistry.assetSize`'s return. */
export interface AssetSize {
  x: number;
  y: number;
  z: number;
}

export interface AssetCenterXZ {
  x: number;
  z: number;
}

/**
 * Measurements the world layer needs and is not allowed to go and read for itself.
 *
 * `world/` must not import `render/assets.ts` (R6: render is a view of state, not a dependency of
 * it), and the manifest lives there. Everything here is therefore injected by `app/boot.ts` in the
 * same way `heightAt` already is. All of it is OPTIONAL: with no ports at all this function
 * reproduces Phase 1's placement exactly, which is what keeps `boot.ts` compiling unchanged while
 * the wiring pass lands.
 */
export interface WorldPorts {
  heightAt: (regionId: RegionId, x: number, z: number) => number;
  /** Manifest bbox min.y for an asset, so nothing is placed by its origin. `AssetRegistry.baseY`. */
  baseY?: (assetId: string) => number;
  /**
   * Manifest bbox extents, so a solid volume is the size of the mesh it wraps.
   * `AssetRegistry.assetSize`. Without it no per-entity solid can be sized and only the building
   * boxes (whose size comes from the authored footprint) are emitted.
   */
  assetSize?: (assetId: string) => AssetSize | null;
  /** Local centre of the measured mesh bounds, for GLBs whose pivot is not centred. */
  assetCenterXZ?: (assetId: string) => AssetCenterXZ | null;
  /** Distance to the resolved visible road centreline; used to keep solid resources off roads. */
  roadDistance?: (x: number, z: number) => number;
  /** Dry working positions for resources and route locations beside solved water bodies. */
  accessPositions?: ReadonlyMap<string, Vec3>;
  /** Root enables authored gate assets and partitions after their production lab acceptance. */
  dungeonGates?: boolean;
  /** Dry coastal sites supplied by the production terrain sampler. */
  coastalSpawns?: readonly { id: string; regionId: RegionId; biomeId: RegionId; spot: Spot }[];
}

// ------------------------------------------------------------------- build

/**
 * `heightAt` stays the second positional parameter, and `ports.heightAt` is ignored in favour of
 * it: the frozen `WorldPorts` shape requires the field, but `boot.ts` already passes the closure
 * positionally and two sources for one number is how layers end up disagreeing about the ground.
 */
export function buildWorld(seed: number, heightAt: HeightAt, ports?: WorldPorts): BuiltWorld {
  const rng = new RngStreams(seed).get("world");

  const entities: SemanticEntity[] = [];
  const routeNodes: RouteNodeOut[] = [];
  const knownLocations: KnownLocation[] = [];
  const edges: RouteEdgeOut[] = [];
  const buildings: BuildingBox[] = [];
  const solids: SolidVolume[] = [];
  const portalLinks: PortalLinkOut[] = [];
  const ctx: BuildContext = {
    heightAt,
    baseY: ports?.baseY ?? (() => 0),
    assetSize: ports?.assetSize ?? (() => null),
    assetCenterXZ: ports?.assetCenterXZ ?? (() => null),
    roadDistance: ports?.roadDistance ?? (() => Infinity),
    dungeonGates: ports?.dungeonGates ?? false,
    out: entities,
    buildings,
    solids,
    wallPostKeys: new Set<string>(),
    locationEntity: new Map<string, EntityId>(),
    portalLinks,
  };

  /** locationId -> resolved world position, so edge costs use the same Y the player walks on. */
  const nodePositions = new Map<string, Vec3>();
  /** locationId -> the entity that stands there, if any. Lets `scope: "known"` report live state. */
  const locationEntity = ctx.locationEntity;

  const addLocation = (regionId: RegionId, location: LocationDef, position: Vec3): void => {
    position = ports?.accessPositions?.get(location.id) ?? position;
    nodePositions.set(location.id, position);
    knownLocations.push({ id: location.id, name: location.name, regionId, position });
    if (location.routeNode) {
      routeNodes.push({ id: location.id, name: location.name, position, regionId });
    }
  };

  // -- pass 1: locations, so every edge in pass 3 has both endpoints resolved.
  for (const region of REGIONS) {
    for (const location of region.locations) {
      addLocation(region.id, location, spotToVec3(location.position, heightAt, region.id));
    }
    const dungeon = region.dungeon;
    if (dungeon) {
      const floorBase = heightAt(region.id, dungeon.entrance[0], dungeon.entrance[1]);
      for (const location of dungeon.locations) {
        const chamber = dungeon.chambers.find((entry) => entry.id === location.id);
        const y = floorBase + (chamber?.floorOffset ?? 0);
        addLocation(dungeon.id, location, [location.position[0], y, location.position[1]]);
      }
    }
  }

  // -- pass 2: entities.
  for (const region of REGIONS) {
    buildRegionEntities(region, rng, ctx);
  }
  for (const entity of entities) {
    const access = ports?.accessPositions?.get(entity.id);
    if (access) entity.interactionPosition = access;
  }
  for (const region of REGIONS) {
    const dungeon = region.dungeon;
    if (dungeon) buildDungeonEntities(region, dungeon, rng, ctx);
  }
  for (const site of ports?.coastalSpawns ?? []) {
    const region = REGIONS.find((entry) => entry.id === site.biomeId);
    const groups = region?.enemyGroups.filter((group) => !group.boss && !group.miniBoss) ?? [];
    const coastalRng = new Rng(seed ^ variantSeed(site.id));
    const source = coastalRng.pick(groups);
    if (!source) continue;
    buildEnemyGroup(site.regionId, { ...source, id: site.id, centre: site.spot, count: 1, radius: 0 },
      coastalRng, (spot, assetId, scale) => placeOnGround(ctx, site.regionId, spot, assetId, scale),
      entities, ctx.assetSize);
  }

  // The approach pad is the surface destination. Keep every graph copy aligned before costs
  // are derived; the interior arrival remains the safe first-chamber node.
  const surfacePortal = entities.find((entity) => entity.id === "gravelmaw_mouth_portal");
  if (surfacePortal?.interactionPosition) {
    const position = surfacePortal.interactionPosition;
    nodePositions.set("gravelmaw_entrance", position);
    for (const location of knownLocations) if (location.id === "gravelmaw_entrance") location.position = position;
    for (const node of routeNodes) if (node.id === "gravelmaw_entrance") node.position = position;
  }

  // -- pass 3: edges.
  const seenEdges = new Set<string>();
  const pushEdge = (edge: RouteEdgeOut): void => {
    const key = `${edge.from}>${edge.to}>${edge.kind}>${edge.obstacleId ?? ""}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push(edge);
  };

  /**
   * Portal crossings, both ways, ahead of the roads so the walk-edge suppression below has them.
   *
   * Measured before this existed: standing on `gravelmaw_arena`, every overworld target was
   * NOT_REACHABLE and so was `gravelmaw_entrance` itself, because the route graph's only link
   * between the surface and chamber one was a WALK edge that no navmesh path can satisfy — the
   * mouth is at y 18.61 on the Karrowmoor surface, chamber one's floor is at 16.61, and the cavern
   * outline stops 4.9 m short of the mouth's wall line behind a blocker that runs floor to ceiling.
   * Detour was right to refuse it; the graph was the thing lying.
   *
   * Cost is the walk from the node to the portal plus the crossing. The far side is the target
   * route node itself, which is exactly where `systems/travel.ts` puts the player when a human
   * uses the same portal by hand, so the two agree by construction.
   */
  const portalPairs = new Set<string>();
  for (const link of portalLinks) {
    const from = nodePositions.get(link.fromLocationId);
    const to = nodePositions.get(link.toLocationId);
    if (!from || !to) continue;
    portalPairs.add(`${link.fromLocationId}>${link.toLocationId}`);
    const approach = distanceXZSpot([from[0], from[2]], [link.position[0], link.position[2]]);
    pushEdge({
      from: link.fromLocationId,
      to: link.toLocationId,
      cost: round2(approach / WALK_SPEED_MPS + PORTAL_CROSSING_MS / 1000),
      kind: "portal",
      portalId: link.entityId,
      entrance: link.position,
      exit: to,
      durationMs: PORTAL_CROSSING_MS,
    });
  }

  /** A road between two locations a portal already joins is not a walk. See `portalPairs`. */
  const portalled = (a: string, b: string): boolean =>
    portalPairs.has(`${a}>${b}`) || portalPairs.has(`${b}>${a}`);

  /** Pass 2's output by id, so a shortcut edge can carry the obstacle's own entrance and exit. */
  const builtById = new Map<EntityId, SemanticEntity>(entities.map((entry) => [entry.id, entry]));

  for (const region of REGIONS) {
    // Roads inside a region. Bidirectional: the moor is steep but nothing here is one-way except
    // the Scree Slide, which is an obstacle, not a road.
    for (const road of region.roads) {
      if (portalled(road.from, road.to)) continue;
      const from = nodePositions.get(road.from);
      const to = nodePositions.get(road.to);
      if (!from || !to) continue;
      const metres = road.meters ?? distance3(from, to);
      const cost = round2(metres / WALK_SPEED_MPS);
      pushEdge({ from: road.from, to: road.to, cost, kind: "walk" });
      pushEdge({ from: road.to, to: road.from, cost, kind: "walk" });
    }

    // Region borders. Both sides declare the crossing; the dedupe above collapses it to one pair.
    for (const link of region.adjacency) {
      const cost = round2(link.meters / WALK_SPEED_MPS);
      pushEdge({ from: link.fromLocationId, to: link.toLocationId, cost, kind: "walk" });
      pushEdge({ from: link.toLocationId, to: link.fromLocationId, cost, kind: "walk" });
    }

    for (const obstacle of region.obstacles) {
      pushShortcutEdges(obstacle, nodePositions, builtById.get(obstacle.id), pushEdge);
    }

    const dungeon = region.dungeon;
    if (!dungeon) continue;
    for (const road of dungeon.roads) {
      if (portalled(road.from, road.to)) continue;
      const from = nodePositions.get(road.from);
      const to = nodePositions.get(road.to);
      if (!from || !to) continue;
      const metres = road.meters ?? distance3(from, to);
      const cost = round2(metres / WALK_SPEED_MPS);
      pushEdge({ from: road.from, to: road.to, cost, kind: "walk" });
      pushEdge({ from: road.to, to: road.from, cost, kind: "walk" });
    }
    for (const obstacle of dungeon.obstacles) {
      pushShortcutEdges(obstacle, nodePositions, builtById.get(obstacle.id), pushEdge);
    }
  }

  // Attach entity ids to the locations that have one, so a "known" bank reports its live state
  // rather than a generic landmark row.
  for (const location of knownLocations) {
    const entityId = locationEntity.get(location.id);
    if (entityId) location.entityId = entityId;
  }

  return { entities, routeNodes, routeEdges: edges, knownLocations, buildings, solids };
}

/**
 * Shortcut cost = walk to the entrance + the traversal + walk off the far end.
 *
 * The brief states "walk time to entrance + durationMs/1000". That is exactly this when the far
 * node sits on the exit; generalising it stops the walk off the top of Sunder Ledge from being
 * free, which would overstate the flip by about two seconds a trip.
 */
function pushShortcutEdges(
  obstacle: ObstacleDef,
  nodePositions: Map<string, Vec3>,
  built: SemanticEntity | undefined,
  pushEdge: (edge: RouteEdgeOut) => void,
): void {
  const from = nodePositions.get(obstacle.fromLocationId);
  const to = nodePositions.get(obstacle.toLocationId);
  if (!from || !to) return;

  const entrance: Spot = obstacle.position;
  const exit: Spot = obstacle.exitPosition;
  const approach = distanceXZSpot([from[0], from[2]], entrance);
  const departure = distanceXZSpot(exit, [to[0], to[2]]);
  const cost = round2((approach + departure) / WALK_SPEED_MPS + obstacle.durationMs / 1000);

  /**
   * The two points the traversal actually uses, taken off the built entity rather than re-derived
   * from the authored 2-D spots: `systems/agility.ts` lands a hand-run climb on exactly
   * `entity.obstacle.exitPosition`, so a routed climb that computed its own Y would put the player
   * somewhere the same climb run by hand does not.
   *
   * Without these the leg is node to node, and at Agility 20 that is a 3.5 s teleport from
   * Thornline Camp to Rootfall Hamlet — the shortcut's duration spent covering the whole gap the
   * shortcut only shaves. The duration matters too: it was being dropped, so until routes had a
   * caller every traversal leg would have taken 0 ms.
   */
  const entrancePosition = built?.position;
  const exitPosition = built?.obstacle?.exitPosition;

  pushEdge({
    from: obstacle.fromLocationId, to: obstacle.toLocationId,
    cost, kind: "shortcut", obstacleId: obstacle.id, reqLevel: obstacle.reqLevel,
    durationMs: obstacle.durationMs,
    ...(entrancePosition ? { entrance: entrancePosition } : {}),
    ...(exitPosition ? { exit: exitPosition } : {}),
  });
  // A slide you cannot climb back up gets one edge. Everything else works both ways, and the
  // reverse walk is symmetric because the entrance and exit swap roles.
  if (!obstacle.oneWay) {
    pushEdge({
      from: obstacle.toLocationId, to: obstacle.fromLocationId,
      cost, kind: "shortcut", obstacleId: obstacle.id, reqLevel: obstacle.reqLevel,
      durationMs: obstacle.durationMs,
      ...(exitPosition ? { entrance: exitPosition } : {}),
      ...(entrancePosition ? { exit: entrancePosition } : {}),
    });
  }
}

// -------------------------------------------------- grounding and placement

/**
 * Everything one build of the world writes into, plus the measurements it is allowed to ask for.
 *
 * Passed by reference rather than returned because a region emits into five lists at once and
 * threading five out-params through eight functions is how the last two got forgotten.
 */
interface BuildContext {
  readonly heightAt: HeightAt;
  /** Falls back to 0 with no port, which reproduces Phase 1's origin-at-ground placement exactly. */
  readonly baseY: (assetId: string) => number;
  /** Falls back to null with no port, which emits no per-entity solids at all. */
  readonly assetSize: (assetId: string) => AssetSize | null;
  readonly assetCenterXZ: (assetId: string) => AssetCenterXZ | null;
  readonly roadDistance: (x: number, z: number) => number;
  readonly dungeonGates: boolean;
  readonly out: SemanticEntity[];
  readonly buildings: BuildingBox[];
  readonly solids: SolidVolume[];
  /** Prevents two independently-authored wall runs from drawing the same shared corner post. */
  readonly wallPostKeys: Set<string>;
  readonly locationEntity: Map<string, EntityId>;
  /** Filled by the dungeon builder in pass 2, drained into route edges in pass 3. */
  readonly portalLinks: PortalLinkOut[];
}

/** Resolves a 2-D authored spot to a world position with the asset's bbox floor on the ground. */
type Placer = (spot: Spot, assetId: string, scale: number) => Vec3;

/**
 * Archetypes `render/entityViews.ts` applies `tierSilhouetteScale` to. Mirrors its own
 * `TIERED_ARCHETYPES` set.
 *
 * Mirrored rather than imported because it is a render-layer look decision, and mirrored at all
 * because grounding is only correct against the scale the entity is actually DRAWN at: the visible
 * gap is `base.y x drawnScale`, verified to 3 decimals across 159 surface entities. Get this set
 * wrong for one archetype and that archetype floats by 10-15% of its own base offset, because
 * `tierSilhouetteScale` runs 0.90 at tier 1 to 1.15 at tier 10.
 */
const TIERED_ARCHETYPES = new Set<Archetype>([
  "ore", "tree", "fishing_spot", "enemy", "boss",
]);

/** The scale an entity is drawn at, which is not always the scale written into `view.scale`. */
function drawnScale(archetype: Archetype, viewScale: number | undefined, tier: number): number {
  const silhouette = TIERED_ARCHETYPES.has(archetype) ? tierSilhouetteScale(tier) : 1;
  return (viewScale ?? 1) * silhouette;
}

function presentationAsset(resource: ResourceDef, entityId: string): string {
  const variants = resource.presentation.availableAssetIds;
  if (variants.length === 0) throw new Error(`Resource "${resource.id}" has no available asset.`);
  return variants[variantSeed(entityId) % variants.length]!;
}

function presentationScale(
  ctx: BuildContext,
  resource: ResourceDef,
  assetId: string,
  entityId: string,
): number {
  const size = ctx.assetSize(assetId);
  const largest = size ? Math.max(size.x, size.y, size.z) : 1;
  const targetScale = resource.presentation.targetWorldSize / Math.max(0.001, largest);
  const range = resource.presentation.variantScale ?? [1, 1];
  const unit = ((variantSeed(`${entityId}:scale`) >>> 8) & 0xffff) / 0xffff;
  const drawn = targetScale * (range[0] + (range[1] - range[0]) * unit);
  // EntityViews applies the shared tier silhouette multiplier. Store the inverse-adjusted view
  // scale so the authored target remains the final world size rather than being enlarged twice.
  return round4(drawn / tierSilhouetteScale(resource.tier));
}

/** Resource-facing is presentation data, so a stable node id must always produce the same yaw. */
function presentationRotation(entityId: string): number {
  const unit = variantSeed(`${entityId}:rotation`) / 0x1_0000_0000;
  return round2(unit * Math.PI * 2);
}

/**
 * Resource rotation used to draw once from the world stream. Keep that slot so changing how a
 * node faces does not move later nodes or reroll their yields. New presentation values must use
 * id hashes instead of this discarded value.
 */
function preserveLegacyResourceRotationDraw(rng: Rng): void {
  rng.next();
}

/**
 * Puts the asset's own bounding-box floor on the terrain instead of its origin.
 *
 * The defect this replaces: `spotToVec3` returned `heightAt(...)` flat, so every entity in the
 * world floated or sank by exactly `glbBBoxMinY x drawnScale`. Measured across 159 surface
 * entities: ore median -0.274 m, tree median -0.254 m, all 10 farm plots fully underground, the
 * Fallen Duskoak (`roof_log`, `base.y` +3.849, scale 1.5) hovering 5.774 m, and the Coldbrace
 * fletching bench (`workbench_drawers`, `base.y` +0.884, scale 1.6) hovering 1.411 m at chest
 * height. 119 of 213 manifest assets have |base.y| over 2 cm.
 *
 * NOT used for prefab or composition parts. Those are authored in the asset's own frame and
 * already measure correct - `wall_bottom_trim`'s -0.117 m sink is the trim doing its job, and
 * `wood_pile`'s `roof_log` dy cancels that asset's own +3.849 pivot on purpose.
 */
function placeOnGround(
  ctx: BuildContext,
  regionId: RegionId,
  spot: Spot,
  assetId: string,
  scale: number,
): Vec3 {
  const y = ctx.heightAt(regionId, spot[0], spot[1]) - ctx.baseY(assetId) * scale;
  return [spot[0], round2(y), spot[1]];
}

/** Metres either side of the sample point for the terrain central difference. */
const NORMAL_SAMPLE_METRES = 1;
/** tan(20 deg). Past this a tree lies down the hill, which reads worse than one standing plumb. */
const MAX_TILT_TAN = 0.36397;
/** tan(2 deg). Below this the gradient is mesh interpolation noise, so no normal is emitted. */
const MIN_TILT_TAN = 0.03492;

/**
 * Unit terrain normal from a central difference on the same `heightAt` port that places the
 * entity, clamped to 20 degrees off vertical.
 *
 * Sampled at +-1 m, half the 2 m lattice the terrain mesh is tessellated from, so it measures the
 * facet the entity actually stands on rather than a sub-facet slope that does not exist.
 *
 * Returns undefined on ground flatter than 2 degrees. Not an optimisation: measured over the 76
 * tilt-eligible entities against the terrain field as it stands, 37 are on ground under 2 degrees,
 * 21 on 2-10, 11 on 10-20 and 7 over 20, so half the field would otherwise carry a no-op normal
 * into every seeded state diff the harness takes. (The split moves when `render/scene.ts` re-cuts
 * the field; the 2-degree floor is what makes it not matter.)
 */
function groundNormalAt(
  heightAt: HeightAt,
  regionId: RegionId,
  x: number,
  z: number,
): readonly [number, number, number] | undefined {
  const e = NORMAL_SAMPLE_METRES;
  const dhdx = (heightAt(regionId, x + e, z) - heightAt(regionId, x - e, z)) / (2 * e);
  const dhdz = (heightAt(regionId, x, z + e) - heightAt(regionId, x, z - e)) / (2 * e);
  const slope = Math.hypot(dhdx, dhdz);
  if (!Number.isFinite(slope) || slope < MIN_TILT_TAN) return undefined;
  const limit = slope > MAX_TILT_TAN ? MAX_TILT_TAN / slope : 1;
  const nx = -dhdx * limit;
  const nz = -dhdz * limit;
  const length = Math.hypot(nx, 1, nz);
  return [round4(nx / length), round4(1 / length), round4(nz / length)];
}

/**
 * How much of the terrain normal each archetype takes, 0..1.
 *
 * A look decision with a measurement behind it: 34 of 159 surface entities stand on ground steeper
 * than 10 degrees, worst case `lower_quarry_kaldite_3` - a 5.3 m ore rock on a 48.9-degree slope
 * with 3.02 m of daylight under one edge. A rock wants to bed into the hill almost fully; a 7 m
 * tree does not, because a leaning tree reads as a felled tree. Buildings, NPCs and enemies are
 * absent on purpose: buildings are level by construction (that is what the flat pads are for) and
 * anything that moves gets its orientation from `systems/`, not from where it spawned.
 */
const TILT_STRENGTH: Partial<Record<Archetype, number>> = {
  ore: 0.85,
  tree: 0.12,
  fishing_spot: 1,
  obstacle: 0.5,
  landmark: 0.25,
};

/** Writes a normal onto an already-built entity without disturbing the rest of its view. */
function tiltView(
  entity: SemanticEntity,
  normal: readonly [number, number, number] | undefined,
  strength: number | undefined,
): void {
  if (!normal || !entity.view) return;
  entity.view = { ...entity.view, groundNormal: normal, tiltStrength: strength };
}

// ------------------------------------------------------------------ solids

/**
 * Largest half-diagonal (box) or radius (cylinder) a solid may have and still leave its own entity
 * reachable.
 *
 * `gameApi.interact` measures the gap to the entity's CENTRE against `INTERACT_RANGE` = 2.4 m, so
 * everything between the centre and the nearest place the player can stand comes out of that
 * 2.4 m: the navmesh carve (`NAV_CONFIG.walkableRadius` is 1 VOXEL, 0.45 m at the world's
 * large-world cell size), `PLAYER_RADIUS` 0.35 m, and the arrival tolerance. `APPROACH_CLEARANCE`
 * budgets 1 m for all three, which leaves 1.4 m.
 *
 * Seven gate-check lines depend on that reach, which is why this is a hard cap applied to every
 * volume wrapping something interactive rather than a warning.
 */
const APPROACH_CLEARANCE_METRES = 1;
const SOLID_REACH_METRES = Math.max(0.4, INTERACT_RANGE - APPROACH_CLEARANCE_METRES);

/**
 * Smallest footprint worth a collider, in m2.
 *
 * Below this the volume costs more than it buys: a `torch` is 0.223 x 0.388 = 0.086 m2, a banner
 * less, and a player who cannot walk past a torch in a 3 m dungeon corridor is worse off than one
 * who walks through it. A kit wall panel at 2.000 x 0.406 = 0.81 m2 clears it five times over.
 */
const SOLID_MIN_FOOTPRINT_AREA = 0.15;

/** Dressing that should never become a full-height navigation carve. */
const NON_BLOCKING_COMPOSITION_ASSET = /^(?:banner|chain|flower|kerb|lamp|mushroom|rope|rubble|sack|stairs_|torch|vine)/;

/** Loose props near the origin share the hero's collision. Walls and supports keep their own shape. */
const COMPOSITION_CLEARANCE_METRES = 1;

function compositionPartBlocks(
  composition: CompositionId,
  part: PartPlacement,
  size: AssetSize | null,
): boolean {
  // These compositions are route dressing around an already-semantic anchor. In particular, the
  // Rootfall stump's visible stair flight is the road into the hamlet, not three invisible walls.
  if (composition === "milestone" || composition === "rootfall_stump" ||
      composition === "vault_door" || composition === "highcairn_crane") return false;
  if (!size || part.dy > 0.45 || size.y * part.scale * (part.scaleAxes?.[1] ?? 1) <= 0.45) return false;
  if (NON_BLOCKING_COMPOSITION_ASSET.test(part.assetId)) return false;
  // The farm's building and fence are structural. Loose yard clutter should not carve a metre-wide
  // hole in a plot the player reads as open ground.
  if (composition === "farm_yard" &&
      !part.tag.startsWith("barn_") && !part.tag.startsWith("fence") &&
      !part.tag.startsWith("post")) return false;
  return true;
}

/**
 * Fraction of a tree's mean CANOPY radius used as its collider radius.
 *
 * Chosen, not measured: the manifest carries the whole-mesh bbox and nothing that isolates a
 * trunk. 0.18 puts `tree_common_1` (4.311 x 4.578 m of leaves) on a 0.40 m radius, which is
 * trunk-sized. See `pushClusterSolid` for why the canopy radius itself is unusable.
 */
const TREE_TRUNK_FRACTION = 0.18;

/** Paving and plot beds sit 2 cm proud of the ground; the assets are 2 cm thick slabs. */
const PAVING_LIFT_METRES = 0.02;

/**
 * The empty-plot bed. Both assets shipped in the manifest and were used by nothing.
 * `floor_brick` is exactly 2.00 x 0.02 x 2.00 m (one module); `fence_wood_single` is 2.064 m long,
 * so the rails overlap their neighbours by 3 cm at the corners rather than leaving a gap.
 */

/** Building collision, in both the legacy `BuildingBox` shape and the frozen `SolidVolume` one. */
function emitBuildingCollision(
  ctx: BuildContext,
  building: BuildingDef,
  origin: Vec3,
  regionId: RegionId,
): void {
  const collision = structureCollisionFromBoxes(
    prefabCollision(building.prefab, building.footprint),
    {
      origin,
      rotationY: building.rotationY,
      regionId,
      ownerId: building.id,
      name: building.name,
      prefab: building.prefab,
    },
  );
  ctx.buildings.push(...collision.buildings);
  ctx.solids.push(...collision.solids);
}

export interface StructureCollisionOptions {
  readonly origin: Vec3;
  readonly rotationY: number;
  readonly regionId: RegionId;
  readonly ownerId: string;
  readonly name: string;
  readonly prefab: PrefabId;
}

export interface StructureAssetMeasurements {
  readonly assetSize: (assetId: string) => AssetSize | null;
  readonly assetCenterXZ: (assetId: string) => AssetCenterXZ | null;
}

export interface StructureCompositionCollisionOptions {
  readonly origin: Vec3;
  readonly rotationY: number;
  readonly ownerId: string;
}

/** Converts production prefab collision boxes from local space to the world's two collision views. */
export function structureCollisionFromBoxes(
  boxes: readonly PrefabBox[],
  options: StructureCollisionOptions,
): { buildings: BuildingBox[]; solids: SolidVolume[] } {
  const buildings: BuildingBox[] = [];
  const solids: SolidVolume[] = [];
  const cos = Math.cos(options.rotationY);
  const sin = Math.sin(options.rotationY);

  for (const box of boxes) {
    const x = round2(options.origin[0] + box.dx * cos + box.dz * sin);
    const z = round2(options.origin[2] - box.dx * sin + box.dz * cos);
    buildings.push({
      id: `${options.ownerId}#${box.tag}`,
      buildingId: options.ownerId,
      name: options.name,
      regionId: options.regionId,
      prefab: options.prefab,
      position: [x, round2(options.origin[1] + box.height / 2), z],
      halfExtents: [round2(box.sizeX / 2), round2(box.height / 2), round2(box.sizeZ / 2)],
      rotationY: options.rotationY,
    });
    // Uncapped, and it must stay that way: a building carries no interaction of its own, and a
    // 12 m hall clipped to a 2.8 m box is a hall the player walks into.
    solids.push({
      kind: "box",
      id: `${options.ownerId}#${box.tag}`,
      position: [x, options.origin[1], z],
      size: [round2(box.sizeX), round2(box.height), round2(box.sizeZ)],
      rotationY: round4(options.rotationY),
    });
  }

  return { buildings, solids };
}

/**
 * A box volume the size of the asset's own manifest bbox.
 *
 * The manifest's measured local centre is rotated into world space. This matters for carts,
 * drawers, workbenches and rock compositions whose geometry sits well away from the GLB pivot;
 * centring collision on the pivot created both invisible blockers and walk-through mesh.
 * `position.y` is the BASE, per `SolidVolume`.
 */
function pushAssetSolid(
  ctx: BuildContext,
  id: string,
  position: Vec3,
  assetId: string,
  scale: number,
  rotationY: number,
  capped: boolean,
): void {
  const solid = assetSolidFromMeasurements(id, position, assetId, scale, rotationY, capped, {
    assetSize: ctx.assetSize,
    assetCenterXZ: ctx.assetCenterXZ,
  });
  if (solid) ctx.solids.push(solid);
}

export function assetSolidFromMeasurements(
  id: string,
  position: Vec3,
  assetId: string,
  scale: number,
  rotationY: number,
  capped: boolean,
  measurements: StructureAssetMeasurements,
): SolidVolume | null {
  const size = measurements.assetSize(assetId);
  if (!size) return null;
  let sizeX = size.x * scale;
  let sizeZ = size.z * scale;
  if (sizeX * sizeZ < SOLID_MIN_FOOTPRINT_AREA) return null;
  if (capped) {
    const factor = capFactor(Math.hypot(sizeX / 2, sizeZ / 2));
    sizeX *= factor;
    sizeZ *= factor;
  }
  const centre = measurements.assetCenterXZ(assetId) ?? { x: 0, z: 0 };
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  const offsetX = centre.x * scale;
  const offsetZ = centre.z * scale;
  const solidPosition: Vec3 = [
    round2(position[0] + offsetX * cos + offsetZ * sin),
    position[1],
    round2(position[2] - offsetX * sin + offsetZ * cos),
  ];
  return {
    kind: "box",
    id,
    position: solidPosition,
    size: [round2(sizeX), round2(Math.max(0.3, size.y * scale)), round2(sizeZ)],
    rotationY: round4(rotationY),
  };
}

export interface BankEntitySpec {
  id: EntityId;
  name: string;
  tier: number;
  regionId: RegionId;
  position: Vec3;
  assetId: string;
  rotationY: number;
  settlementId?: string;
}

/** The production semantic shape shared by authored banks and the deterministic feature-lab bank. */
export function createBankEntity(spec: BankEntitySpec): SemanticEntity {
  return {
    id: spec.id,
    archetype: "bank",
    name: spec.name,
    tier: spec.tier,
    regionId: spec.regionId,
    position: [...spec.position] as Vec3,
    state: "closed",
    interactions: ["inspect", "bank"],
    view: {
      assetId: spec.assetId,
      rotationY: spec.rotationY,
      labelHeight: 1.4,
    },
    ...(spec.settlementId ? { meta: { settlementId: spec.settlementId } } : {}),
  };
}

/**
 * Production measured-asset collision exposed to realtime authoring surfaces.
 * The returned position follows the same base-position contract as authored world entities.
 */
export function structureCollisionFromAsset(
  id: string,
  position: Vec3,
  assetId: string,
  scale: number,
  rotationY: number,
  capped: boolean,
  measurements: StructureAssetMeasurements,
): SolidVolume | null {
  return assetSolidFromMeasurements(id, position, assetId, scale, rotationY, capped, measurements);
}

/**
 * Production composition collision, shared by authored-world emission and the realtime lab.
 * Asset measurements stay injected so world assembly never imports the render asset registry.
 */
export function structureCollisionFromCompositionParts(
  composition: CompositionId,
  parts: readonly PartPlacement[],
  options: StructureCompositionCollisionOptions,
  measurements: StructureAssetMeasurements,
): SolidVolume[] {
  const solids: SolidVolume[] = [];
  const cos = Math.cos(options.rotationY);
  const sin = Math.sin(options.rotationY);
  for (const part of parts) {
    const size = measurements.assetSize(part.assetId);
    if (!size || !compositionPartBlocks(composition, part, size)) continue;
    // The hero reach allowance applies to loose dressing, not the load-bearing shell. Applying
    // it to walls shortened gate piers and discarded the bank's counter and slim timber posts.
    const structural = /^(?:wall_|overhang_|corner_|fence_)/.test(part.assetId) ||
      (composition === "bank_counter" && part.tag === "counter");
    if (!structural && Math.hypot(part.dx, part.dz) < COMPOSITION_CLEARANCE_METRES) continue;
    const position: Vec3 = [
      round2(options.origin[0] + part.dx * cos + part.dz * sin),
      round2(options.origin[1] + part.dy),
      round2(options.origin[2] - part.dx * sin + part.dz * cos),
    ];
    const axes: readonly [number, number, number] = part.scaleAxes ?? [1, 1, 1];
    const centre = measurements.assetCenterXZ(part.assetId) ?? { x: 0, z: 0 };
    const measured = {
      suffix: "",
      base: 0,
      x: centre.x * part.scale * axes[0],
      z: centre.z * part.scale * axes[2],
      width: size.x * part.scale * axes[0],
      height: size.y * part.scale * axes[1],
      depth: size.z * part.scale * axes[2],
    };
    let boxes = [measured];
    if (part.assetId === "wall_arch") {
      // The shipped arch has 1/6 m jambs and a 5/3 m opening in a 2 m module. Only the
      // grounded jambs obstruct walking; boxing its barrel would close the visible passage.
      const jambWidth = measured.width / 12;
      boxes = [-1, 1].map((side) => ({
        ...measured,
        suffix: side < 0 ? "#jamb_l" : "#jamb_r",
        x: measured.x + side * (measured.width - jambWidth) / 2,
        width: jambWidth,
      }));
    } else if (part.assetId === "overhang_plaster") {
      // The mesh spans z=-0.2..2.0. Below head height it contains a 0.2 m plaster wall,
      // a shallow waist rail and one narrow timber bracket. Its canopy is overhead.
      // These dimensions come from the transformed source geometry, not its roof envelope.
      const sx = measured.width / 2;
      const sy = measured.height / 3.028;
      const sz = measured.depth / 2.2;
      const sourceZ = measured.z - 0.9 * sz;
      boxes = [
        { ...measured, z: sourceZ - 0.1 * sz, depth: 0.2 * sz },
        {
          ...measured, suffix: "#rail", base: 0.6495 * sy,
          z: sourceZ + 0.03994 * sz, depth: 0.10498 * sz, height: 0.23366 * sy,
        },
        {
          ...measured, suffix: "#stud", base: 0.4133 * sy,
          x: measured.x - 0.00037 * sx, width: 0.12346 * sx,
          z: sourceZ + 0.10622 * sz, depth: 0.23348 * sz, height: 1.43652 * sy,
        },
      ];
    }
    const rotationY = options.rotationY + part.rotationY;
    const partCos = Math.cos(rotationY);
    const partSin = Math.sin(rotationY);
    for (const box of boxes) {
      if (!structural && box.width * box.depth < SOLID_MIN_FOOTPRINT_AREA) continue;
      const halfDiagonal = Math.hypot(box.width / 2, box.depth / 2);
      const capped = !structural && Math.hypot(part.dx, part.dz) - halfDiagonal < INTERACT_RANGE;
      const factor = capped ? capFactor(halfDiagonal) : 1;
      solids.push({
        kind: "box",
        id: `${options.ownerId}#${part.tag}${box.suffix}`,
        position: [
          round2(position[0] + box.x * partCos + box.z * partSin),
          round2(position[1] + box.base),
          round2(position[2] - box.x * partSin + box.z * partCos),
        ],
        size: [round2(box.width * factor), round2(structural ? box.height : Math.max(0.3, box.height)),
          round2(box.depth * factor)],
        rotationY: round4(rotationY),
      });
    }
  }
  return solids;
}

/**
 * A gate is two piers with a hole between them, so it gets two piers and a hole.
 *
 * A single box across an arch seals the region border, which is the one thing a gate must never
 * do. When the arch is narrower than `GATE_GAP_METRES` there is no pier left to build and the gate
 * stays open: `wall_arch` is 2.00 m wide and draws at 2.8 m against a 4 m gap, so all three
 * region gates in the game correctly get no volume at all and the composition around them - the
 * wall pieces either side - is what stops the player walking round the arch.
 */
function pushGateSolids(
  ctx: BuildContext,
  id: string,
  position: Vec3,
  assetId: string,
  scale: number,
  rotationY: number,
): void {
  const size = ctx.assetSize(assetId);
  if (!size) return;
  const width = size.x * scale;
  const pier = (width - GATE_GAP_METRES) / 2;
  if (pier <= 0.2) return;
  const depth = Math.max(0.4, size.z * scale);
  const height = Math.max(0.3, size.y * scale);
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  for (const side of [-1, 1] as const) {
    const dx = side * (width - pier) / 2;
    ctx.solids.push({
      kind: "box",
      id: `${id}#pier_${side < 0 ? "l" : "r"}`,
      position: [round2(position[0] + dx * cos), position[1], round2(position[2] - dx * sin)],
      size: [round2(pier), round2(height), round2(depth)],
      rotationY: round4(rotationY),
    });
  }
}

/**
 * A cylinder for a resource node, because rocks and trees are round and a box would leave corners
 * of invisible air the player bounces off.
 *
 * Trees are collided as their TRUNK, not their canopy. `tree_common_1`'s manifest footprint is
 * 4.31 x 4.58 m, nearly all of it leaves; a 2.22 m radius from that would push the nearest
 * standable point past `INTERACT_RANGE` = 2.4 m from the trunk and make the tree unchoppable, on
 * top of reading as a 4 m disc of invisible air. `TREE_TRUNK_FRACTION` takes it to 0.40 m.
 *
 * Fishing spots and farm plots get nothing: the player stands in them.
 */
function pushClusterSolid(
  ctx: BuildContext,
  id: string,
  position: Vec3,
  resource: ResourceDef,
  assetId: string,
  scale: number,
): void {
  if (resource.archetype !== "tree" && resource.archetype !== "ore") return;
  const size = ctx.assetSize(assetId);
  if (!size) return;
  const footprintRadius = (size.x + size.z) * 0.25 * scale;
  const radius = resource.archetype === "tree"
    ? Math.min(0.9, Math.max(0.3, footprintRadius * TREE_TRUNK_FRACTION))
    : Math.max(0.35, footprintRadius * 0.8);
  if (radius < 0.2) return;
  ctx.solids.push({
    kind: "cylinder",
    id,
    position,
    radius: round2(Math.min(radius, SOLID_REACH_METRES)),
    height: round2(Math.max(0.3, size.y * scale)),
  });
}

/** 1 when the volume already fits inside the interaction reach, otherwise the shrink that makes it. */
function capFactor(halfDiagonal: number): number {
  return halfDiagonal <= SOLID_REACH_METRES ? 1 : SOLID_REACH_METRES / halfDiagonal;
}

// -------------------------------------------------------- entity construction

function buildRegionEntities(region: RegionDef, rng: Rng, ctx: BuildContext): void {
  const regionId = region.id;
  const tier = region.tier;
  /** Terrain height only. For a building origin, a route point, or a shortcut's exit. */
  const ground = (spot: Spot): Vec3 => spotToVec3(spot, ctx.heightAt, regionId);
  /** Terrain height with the asset's own bbox floor put on it. See `placeOnGround`. */
  const place: Placer = (spot, assetId, scale) =>
    placeOnGround(ctx, regionId, spot, assetId, scale);
  const normal = (spot: Spot): readonly [number, number, number] | undefined =>
    groundNormalAt(ctx.heightAt, regionId, spot[0], spot[1]);

  for (const cluster of region.clusters) {
    buildCluster(regionId, cluster, rng, place, normal, ctx);
  }

  const settlement = region.settlement;
  const kit = BUILDING_KITS[settlement.kit];

  // Buildings. Round-1 critique finding 1: `settlement.buildings` was authored and never read, so
  // 37 buildings across three settlements rendered as nothing at all. Each one is now assembled by
  // `render/buildings.ts` into 2 m modules and emitted as one instanced part per piece: the render
  // path already batches by (assetId, tier), so a whole street of cottages is a dozen draw calls.
  for (const building of settlement.buildings) {
    const origin = ground(building.position);
    const seed = variantSeed(building.id);
    emitParts(
      buildPrefab(building.prefab, building.footprint, seed, settlement.kit),
      origin, building.rotationY, regionId, tier,
      building.id, building.name,
      { buildingId: building.id, prefab: building.prefab, settlementId: settlement.id, scenery: true },
      ctx.out,
    );
    emitBuildingCollision(ctx, building, origin, regionId);
  }

  // Walls, paving and props. All three are new content vocabulary (`content/regions.ts`) and no
  // settlement authors any of it yet, so all three loops are no-ops on today's data - which is
  // exactly what makes them safe to land a wave ahead of the layouts they exist for.
  for (const run of settlement.walls ?? []) {
    emitWallRun(ctx, regionId, tier, settlement, run, kit, ground);
  }
  for (const paving of settlement.paving ?? []) {
    emitPaving(ctx, regionId, tier, settlement, paving);
  }
  for (const prop of settlement.props ?? []) {
    emitProp(ctx, regionId, tier, settlement, prop, place);
  }

  const bankScale = drawnScale("bank", undefined, tier);
  const bankPosition = place(settlement.bank.position, settlement.bank.assetId, bankScale);
  ctx.out.push(createBankEntity({
    id: settlement.bank.id,
    name: settlement.bank.name,
    tier,
    regionId,
    position: bankPosition,
    assetId: settlement.bank.assetId,
    rotationY: settlement.bank.rotationY,
    settlementId: settlement.id,
  }));
  pushAssetSolid(ctx, settlement.bank.id, bankPosition, settlement.bank.assetId, bankScale,
    settlement.bank.rotationY, true);
  ctx.locationEntity.set(bankLocationId(region), settlement.bank.id);

  for (const shop of settlement.shops) {
    const scale = drawnScale("shop", undefined, tier);
    const position = place(shop.position, shop.assetId, scale);
    ctx.out.push({
      id: shop.id,
      archetype: "shop",
      name: shop.name,
      tier,
      regionId,
      position,
      state: "open",
      interactions: ["inspect", "trade"],
      view: { assetId: shop.assetId, rotationY: shop.rotationY, labelHeight: 3 },
      meta: { shopKind: shop.shopKind, settlementId: settlement.id },
    });
    pushAssetSolid(ctx, shop.id, position, shop.assetId, scale, shop.rotationY, true);
  }

  const emitStation = (station: import("../content/regions.js").StationDef, settlementId?: string): void => {
    const scale = drawnScale("station", station.scale, tier);
    const position = place(station.position, station.assetId, scale);
    const essenceAltar = station.kind === "essence_altar" && station.essenceElement !== undefined;
    ctx.out.push({
      id: station.id,
      archetype: "station",
      name: station.name,
      tier,
      regionId,
      position,
      state: essenceAltar ? "dormant" : "idle",
      interactions: essenceAltar ? ["inspect", "awaken"] : ["inspect", "produce"],
      station: { kind: station.kind, skill: station.skill, recipeIds: station.recipeIds },
      view: {
        assetId: station.assetId,
        rotationY: station.rotationY,
        scale: station.scale,
        labelHeight: 1.6,
      },
      meta: {
        stationKind: station.kind,
        ...(settlementId ? { settlementId } : {}),
        ...(essenceAltar
          ? { essenceAltar: true, essenceElement: station.essenceElement }
          : {}),
      },
    });
    pushAssetSolid(ctx, station.id, position, station.assetId, scale, station.rotationY, true);
  };

  for (const station of settlement.stations) {
    emitStation(station, settlement.id);
  }
  for (const station of region.stations) {
    emitStation(station);
  }

  for (const npc of settlement.npcs) {
    ctx.out.push({
      id: npc.id,
      archetype: "npc",
      name: npc.name,
      tier,
      regionId,
      // NPCs move, so `systems/` handles them as circles. No solid volume here on purpose.
      position: place(npc.position, npc.assetId, drawnScale("npc", undefined, tier)),
      state: "idle",
      interactions: ["inspect", "talk"],
      // `regions.ts` authors questIds as [] because the quest table did not exist when the NPC
      // stands were placed. Backfilling here keeps one source of truth (the quests) and closes a
      // real discoverability hole: an agent looking for quest givers reads `npc.questIds`.
      npc: {
        dialogueRootId: npc.dialogueRootId,
        questIds: npc.questIds.length > 0 ? npc.questIds : questIdsForNpc(npc.id),
      },
      view: {
        assetId: npc.assetId,
        partAssetIds: outfitPartsFor(npc.id, npc.assetId),
        rotationY: npc.facingRad,
        labelHeight: 2.2,
      },
      meta: { settlementId: settlement.id },
    });
  }

  for (const obstacle of region.obstacles) {
    const scale = drawnScale("obstacle", obstacle.scale, tier);
    const entity = buildObstacle(
      regionId, tier, obstacle,
      (spot) => place(spot, obstacle.assetId, scale),
      ground,
    );
    tiltView(entity, normal(obstacle.position), TILT_STRENGTH.obstacle);
    ctx.out.push(entity);
    pushAssetSolid(ctx, obstacle.id, entity.position, obstacle.assetId, scale,
      obstacle.rotationY ?? 0, true);
    emitComposition(
      obstacle.composition,
      ground(obstacle.position),
      obstacle.rotationY ?? 0,
      regionId,
      tier,
      region.settlement.kit,
      obstacle.id,
      obstacle.name,
      { scenery: true, traversal: true },
      ctx.out,
      ctx,
    );
  }

  for (const group of region.enemyGroups) {
    buildEnemyGroup(regionId, group, rng, place, ctx.out, ctx.assetSize);
  }

  for (const landmark of region.landmarks) {
    // The composition is authored around the terrain point, in the hero asset's own frame; only
    // the hero mesh moves when its bbox floor is put on the ground.
    const origin = ground(landmark.position);
    const scale = drawnScale("landmark", trueScale(landmark.scale, tier), tier);
    const position = landmark.originOnGround
      ? origin
      : place(landmark.position, landmark.assetId, scale);
    const essenceAltar = landmark.assetId === "altar_ruins_site"
      ? region.stations.find((station) => (
          station.kind === "essence_altar"
          && station.essenceElement !== undefined
          && station.position[0] === landmark.position[0]
          && station.position[1] === landmark.position[1]
        ))
      : undefined;
    ctx.out.push({
      id: landmark.id,
      archetype: "landmark",
      name: landmark.name,
      tier,
      regionId,
      position,
      state: essenceAltar ? "dormant" : "present",
      interactions: ["inspect"],
      view: {
        assetId: landmark.assetId,
        scale: trueScale(landmark.scale, tier),
        rotationY: landmark.rotationY,
        clipFraction: landmark.clipFraction,
        labelHeight: 4,
        ...(landmark.originOnGround
          ? {}
          : { groundNormal: normal(landmark.position), tiltStrength: TILT_STRENGTH.landmark }),
      },
      meta: {
        blurb: landmark.blurb,
        ...(essenceAltar
          ? {
              essenceAltarRuins: true,
              essenceAltarId: essenceAltar.id,
              essenceElement: essenceAltar.essenceElement!,
            }
          : {}),
      },
    });
    // A landmark clipped to a fraction of its own height is a stump, not a mass; sizing a collider
    // off the uncut bbox would wall off a 7 m circle around a 2 m stub.
    if (landmark.clipFraction === undefined && landmark.solid !== false) {
      pushAssetSolid(ctx, landmark.id, position, landmark.assetId, scale, landmark.rotationY ?? 0, true);
    }
    ctx.locationEntity.set(landmark.id, landmark.id);
    // Finding 8: a landmark drawn as one stand-in prop is not a silhouette. The hero mesh above is
    // still the clickable, inspectable entity; these parts are what the player navigates by.
    emitComposition(
      landmark.composition, origin, landmark.rotationY ?? 0, regionId, tier,
      region.settlement.kit, landmark.id, landmark.name,
      { blurb: landmark.blurb, scenery: true }, ctx.out, ctx,
    );
  }

  for (const gate of region.gates) {
    const origin = ground(gate.position);
    const scale = drawnScale("portal", trueScale(1.4, tier), tier);
    const position = place(gate.position, gate.assetId, scale);
    ctx.out.push({
      id: gate.id,
      archetype: "portal",
      name: gate.name,
      tier,
      regionId,
      position,
      state: "open",
      interactions: ["inspect", "enter"],
      view: {
        assetId: gate.assetId,
        rotationY: gate.rotationY,
        scale: trueScale(1.4, tier),
        labelHeight: 3.4,
      },
      meta: { toRegionId: gate.toRegionId, toLocationId: gate.toLocationId },
    });
    pushGateSolids(ctx, gate.id, position, gate.assetId, scale, gate.rotationY ?? 0);
    ctx.locationEntity.set(gate.id, gate.id);
    emitComposition(
      gate.composition, origin, gate.rotationY ?? 0, regionId, tier,
      region.settlement.kit, gate.id, gate.name,
      { toRegionId: gate.toRegionId, scenery: true }, ctx.out, ctx,
    );
  }
}

// ------------------------------------------------------- settlement dressing

/**
 * One straight run of town wall.
 *
 * Measured on the Phase 1 data, which had no way to author this at all: Coldbrace stood 44 m of
 * wall on a 212 m circuit (79% open, largest single gap 46 m, all four corners missing), Highcairn
 * 30 m of 139 m, and Rootfall none. The player's words were "a random gate without a wall".
 *
 * `yaw` is the value that maps a part's LOCAL +X onto the run direction under the transform
 * `emitParts` applies, which is why it negates the z delta. The origin is the ground at `from`, so
 * a run crossing a slope stays level for the same reason a building does - a sheared wall reads
 * far worse than one standing on a plinth.
 */
function emitWallRun(
  ctx: BuildContext,
  regionId: RegionId,
  tier: number,
  settlement: SettlementDef,
  run: WallRunDef,
  kit: BuildingKit,
  ground: (spot: Spot) => Vec3,
): void {
  const length = distanceXZSpot(run.from, run.to);
  if (length < MODULE_METRES) return;
  const yaw = Math.atan2(-(run.to[1] - run.from[1]), run.to[0] - run.from[0]);
  const origin = ground(run.from);
  const openings = run.openings ?? [];

  const parts = buildWallRun(length, openings, kit, variantSeed(run.id)).filter((part) => {
    if (!part.tag.startsWith("p")) return true;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const x = round2(origin[0] + part.dx * cos + part.dz * sin);
    const z = round2(origin[2] - part.dx * sin + part.dz * cos);
    const key = `${regionId}:${part.assetId}:${x}:${z}`;
    if (ctx.wallPostKeys.has(key)) return false;
    ctx.wallPostKeys.add(key);
    return true;
  });
  emitParts(
    parts,
    origin, yaw, regionId, tier, run.id, run.name,
    { settlementId: settlement.id, wallRunId: run.id, scenery: true },
    ctx.out,
  );

  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  for (const box of wallRunCollision(length, openings)) {
    ctx.solids.push({
      kind: "box",
      id: `${run.id}#${box.tag}`,
      position: [
        round2(origin[0] + box.dx * cos + box.dz * sin),
        origin[1],
        round2(origin[2] - box.dx * sin + box.dz * cos),
      ],
      size: [round2(box.sizeX), round2(box.height), round2(box.sizeZ)],
      rotationY: round4(yaw),
    });
  }
}

/**
 * Kerbs a paving rect.
 *
 * The paved surface itself is NOT geometry. It is stamped into the terrain's own vertex colours
 * and splat weights by `render/scene.ts`, the same mechanism roads and waterlines use, so a square
 * is the ground rather than 77 slabs laid on the ground. Laid slabs were 2 x 2 m flat planes on a
 * surface that is never quite flat: they floated at one corner, buried themselves at the other,
 * z-fought their own bed at grazing angles, and left a mortar-width of terrain showing between
 * every pair. What is left here is the one part of a pavement that genuinely stands proud of it.
 */
function emitPaving(
  ctx: BuildContext,
  regionId: RegionId,
  tier: number,
  settlement: SettlementDef,
  paving: PavingDef,
): void {
  const { minX, minZ, maxX, maxZ } = paving.rect;
  if (!(maxX > minX) || !(maxZ > minZ)) return;
  // Only a kerbed rect gets anything. An unkerbed one is a worn street or yard, and the stamp
  // frays its own edge into the ground around it.
  if (!paving.kerb) return;
  const meta = { settlementId: settlement.id, pavingId: paving.id, scenery: true };
  const half = MODULE_METRES / 2;
  const firstX = Math.ceil((minX - half) / MODULE_METRES) * MODULE_METRES + half;
  const firstZ = Math.ceil((minZ - half) / MODULE_METRES) * MODULE_METRES + half;

  // Kerbs ring the rect on the OUTSIDE: `kerb_straight` is 2.00 x 0.134 x 0.70 with its origin
  // centred on the long axis at the near z edge, so a rotation of 0 lays it along +x with its
  // 0.70 m depth pointing to +z. No collision - the player must not trip on a 13 cm lip walking
  // into their own town square.
  let kerbIndex = 0;
  const kerb = (x: number, z: number, rotationY: number, assetId: string): void => {
    ctx.out.push(sceneryEntity(
      `${paving.id}#k${kerbIndex}`, paving.id, tier, regionId,
      [round2(x), round2(ctx.heightAt(regionId, x, z) + PAVING_LIFT_METRES), round2(z)],
      assetId, 1, round4(rotationY), 0.4, meta,
    ));
    kerbIndex += 1;
  };
  for (let cx = firstX; cx + half <= maxX + 1e-6; cx += MODULE_METRES) {
    kerb(cx, maxZ, 0, "kerb_straight");
    kerb(cx, minZ, Math.PI, "kerb_straight");
  }
  for (let cz = firstZ; cz + half <= maxZ + 1e-6; cz += MODULE_METRES) {
    kerb(maxX, cz, Math.PI / 2, "kerb_straight");
    kerb(minX, cz, -Math.PI / 2, "kerb_straight");
  }
  kerb(maxX, maxZ, 0, "kerb_corner");
  kerb(maxX, minZ, Math.PI / 2, "kerb_corner");
  kerb(minX, minZ, Math.PI, "kerb_corner");
  kerb(minX, maxZ, -Math.PI / 2, "kerb_corner");
}

/**
 * One piece of set dressing.
 *
 * `dy` is an offset on top of BASE-ALIGNED ground, not on top of the raw terrain: a `dy` of 0 puts
 * the asset's own bbox floor on the ground whatever its origin is, so a wall lamp is authored at
 * its mounting height and nothing needs to know that `roof_log`'s pivot sits 3.85 m under its own
 * axis. That differs from the note on `PropDef`, which was written before `base.y` existed.
 */
function emitProp(
  ctx: BuildContext,
  regionId: RegionId,
  tier: number,
  settlement: SettlementDef,
  prop: PropDef,
  place: Placer,
): void {
  const scale = prop.scale ?? 1;
  const grounded = place(prop.position, prop.assetId, scale);
  const position: Vec3 = [grounded[0], round2(grounded[1] + (prop.dy ?? 0)), grounded[2]];
  ctx.out.push(sceneryEntity(
    prop.id, prop.id, tier, regionId, position, prop.assetId, scale, prop.rotationY, 1,
    { settlementId: settlement.id, propId: prop.id, scenery: true },
  ));
  // Uncapped: dressing carries no interaction of its own, so nothing depends on reaching its
  // centre. A prop big enough to block the station it stands next to is an authoring error, and
  // `validateRegions`' attachment check is the right place to catch that.
  if (prop.solid) pushAssetSolid(ctx, prop.id, position, prop.assetId, scale, prop.rotationY, false);
}

/** A drawn, hovered, never-interacted entity: paving, kerbs, props, plot beds. */
function sceneryEntity(
  id: string,
  name: string,
  tier: number,
  regionId: RegionId,
  position: Vec3,
  assetId: string,
  scale: number,
  rotationY: number,
  labelHeight: number,
  meta: Record<string, string | number | boolean>,
): SemanticEntity {
  return {
    id,
    archetype: "landmark",
    name,
    tier,
    regionId,
    position,
    state: "present",
    interactions: [],
    view: { assetId, scale: round4(scale), rotationY: round4(rotationY), materialTier: tier, labelHeight },
    meta,
  };
}


/**
 * Turns a prefab or composition part list into semantic entities.
 *
 * Two details are load-bearing:
 *
 *  - Every part of one building shares the origin's ground height. Buildings are level; following
 *    the terrain per part would shear a 12 m hall. Settlement pads are flattened for exactly this
 *    (`app/worldSpec.ts` puts a 34 m flat spot under each settlement centre).
 *  - Building and composition parts are landmarks. `render/entityViews.ts` does not apply the
 *    tier silhouette scale to landmarks, so their authored module dimensions must pass through
 *    unchanged. Scaling them inversely here once made Coldbrace modules overlap while leaving
 *    full-height cracks through Rootfall and Highcairn, and made their collision disagree with
 *    what the player saw.
 */
function emitParts(
  parts: readonly PartPlacement[],
  origin: Vec3,
  rotationY: number,
  regionId: RegionId,
  tier: number,
  ownerId: string,
  name: string,
  meta: Record<string, string | number | boolean>,
  out: SemanticEntity[],
): void {
  out.push(...structureEntitiesFromParts(parts, {
    origin,
    rotationY,
    regionId,
    tier,
    ownerId,
    name,
    meta,
  }));
}

export interface StructureEntitiesOptions {
  readonly origin: Vec3;
  readonly rotationY: number;
  readonly regionId: RegionId;
  readonly tier: number;
  readonly ownerId: string;
  readonly name: string;
  readonly meta?: Record<string, string | number | boolean>;
}

/** Converts production structure parts from local space to landmark entities. */
export function structureEntitiesFromParts(
  parts: readonly PartPlacement[],
  options: StructureEntitiesOptions,
): SemanticEntity[] {
  const out: SemanticEntity[] = [];
  const cos = Math.cos(options.rotationY);
  const sin = Math.sin(options.rotationY);
  for (const part of parts) {
    const entity: SemanticEntity = {
      id: `${options.ownerId}#${part.tag}`,
      archetype: "landmark",
      name: options.name,
      tier: options.tier,
      regionId: options.regionId,
      position: [
        round2(options.origin[0] + part.dx * cos + part.dz * sin),
        round2(options.origin[1] + part.dy),
        round2(options.origin[2] - part.dx * sin + part.dz * cos),
      ],
      state: "present",
      // Deliberately empty. Scenery is drawn, hovered and walked to, never interacted with, and an
      // empty list keeps `observe({ interaction: ... })` clean.
      interactions: [],
      view: {
        assetId: part.assetId,
        scale: round4(part.scale),
        scaleAxes: part.scaleAxes?.map(round4) as Vec3 | undefined,
        rotationY: round4(options.rotationY + part.rotationY),
        materialTier: options.tier,
        labelHeight: 2,
      },
    };
    if (options.meta !== undefined) entity.meta = options.meta;
    out.push(entity);
  }
  return out;
}

/**
 * A landmark's or gate's surrounding parts, plus a solid volume for the ones with real mass.
 *
 * Buildings get their collision from `prefabCollision`, which knows where the doorway is.
 * Composition mass is conservative: only grounded structural pieces are eligible. Low kerbs,
 * stairs, trim and elevated dressing do not become one-metre navigation carves, while grounded
 * walls, fences, rocks and counters retain physical mass. Loose props within
 * `COMPOSITION_CLEARANCE_METRES` of the origin share the hero's collision.
 *
 * Loose dressing is only reach-capped when its full volume could foul the owner's approach ring -
 * `distance - halfDiagonal < INTERACT_RANGE`. That matters: the Gravelmaw mouth's `cliff_step_2`
 * brow has a 9.99 m half-diagonal, and capping it to 1.40 m unconditionally would leave a 20 m
 * cliff face the player walks straight through to protect a reach that a cliff 12 m away was never
 * going to block.
 */
function emitComposition(
  composition: CompositionId | undefined,
  origin: Vec3,
  rotationY: number,
  regionId: RegionId,
  tier: number,
  kitId: BuildingKit["id"],
  ownerId: string,
  name: string,
  meta: Record<string, string | number | boolean>,
  out: SemanticEntity[],
  ctx?: BuildContext,
): void {
  if (!composition) return;
  const parts = buildComposition(composition, variantSeed(ownerId), kitId);
  emitParts(parts, origin, rotationY, regionId, tier, ownerId, name, meta, out);
  if (!ctx) return;

  ctx.solids.push(...structureCollisionFromCompositionParts(
    composition,
    parts,
    { origin, rotationY, ownerId },
    { assetSize: ctx.assetSize, assetCenterXZ: ctx.assetCenterXZ },
  ));
}

function buildDungeonEntities(
  region: RegionDef,
  dungeon: DungeonDef,
  rng: Rng,
  ctx: BuildContext,
): void {
  // The dungeon has no terrain of its own - it is carved interior geometry. Everything inside is
  // measured off the surface height at the mouth, which is the one point both layers agree on.
  const floorBase = ctx.heightAt(region.id, dungeon.entrance[0], dungeon.entrance[1]);
  const out = ctx.out;
  const placeAt = (spot: Spot, offset: number): Vec3 => [spot[0], floorBase + offset, spot[1]];
  /**
   * Interior placement with the asset's own bbox floor on the chamber floor. `torch` alone has
   * `base.y` -0.2776, which at its authored scale 1.6 buried every chamber brazier 0.44 m.
   */
  const placeOn = (spot: Spot, offset: number, assetId: string, scale: number): Vec3 =>
    [spot[0], round2(floorBase + offset - ctx.baseY(assetId) * scale), spot[1]];

  // The mouth itself lives in Karrowmoor: the player walks up to it on the surface and enters.
  const mouth: Vec3 = [dungeon.entrance[0], floorBase, dungeon.entrance[1]];
  const mouthRotation = dungeon.entranceRotationY ?? 0;
  const mouthScale = trueScale(dungeon.entranceScale ?? 4, region.tier);
  const mouthPosition = placeOn(dungeon.entrance, 0, dungeon.entranceAssetId, mouthScale);
  const surfaceMouth: SemanticEntity = {
    id: "gravelmaw_mouth_portal",
    archetype: "portal",
    name: dungeon.name,
    tier: dungeon.tier,
    regionId: region.id,
    position: mouthPosition,
    state: "open",
    interactions: ["inspect", "enter"],
    view: {
      assetId: dungeon.entranceAssetId,
      // 8 m x 12 m exactly, because the PRD's "twelve-metre wound" is a number the composition
      // around it is measured against.
      scale: mouthScale,
      rotationY: mouthRotation,
      labelHeight: 6,
    },
    meta: { toRegionId: dungeon.id, toLocationId: "gravelmaw_chamber1" },
  };
  const surfaceEntrance = portalEntrance(surfaceMouth, (x, z) => ctx.heightAt(region.id, x, z));
  surfaceMouth.interactionPosition = surfaceEntrance.interactionPosition;
  out.push(surfaceMouth);
  ctx.solids.push(surfaceEntrance.solid);
  const mantleSolid = portalMantleSolid(surfaceMouth);
  if (mantleSolid) ctx.solids.push(mantleSolid);
  ctx.locationEntity.set("gravelmaw_entrance", "gravelmaw_mouth_portal");
  // The route graph's copy of the same link. `content/regions.ts` declares
  // gravelmaw_entrance -> gravelmaw_chamber1 as a ROAD, which is a walk edge, which no navmesh path
  // can ever satisfy; pass 3 replaces it with this.
  ctx.portalLinks.push({
    entityId: "gravelmaw_mouth_portal",
    fromLocationId: "gravelmaw_entrance",
    toLocationId: "gravelmaw_chamber1",
    position: surfaceEntrance.interactionPosition,
  });

  // The way OUT. Measured, live, from `gravelmaw_arena` where the gate check leaves the player:
  // every overworld target was NOT_REACHABLE and so was `gravelmaw_entrance` itself. The dungeon
  // emitted exactly one portal, it lived in Karrowmoor, and it only pointed inward — so entering
  // the Gravelmaw was one-way and dying was the only way back to the surface. Three acceptance
  // lines were red because of it, and all three read as a Karrowmoor terrain fault.
  //
  // A reciprocal portal rather than a corridor, because the two layers do not touch: the mouth
  // sits at y 18.61 on the surface and chamber one's floor is at 16.61, and the cavern outline
  // stops 4.9 m short of the mouth's wall line. Terrain cannot bridge that — the cavern wall is a
  // nav blocker from floor to ceiling, so cutting ground into it would only put a hole in the
  // hillside. `systems/travel.ts` already reads `meta.toRegionId` / `meta.toLocationId` off any
  // portal, so this needs no new system.
  //
  // Leave room for the complete masonry recess inside the opaque chamber shell.
  // At scale 2.2 its back extends 4.074 m behind the arch; another 1.926 m
  // accommodates the shell's inward corbel and a readable separation from the wall.
  const firstChamber = dungeon.chambers[0];
  if (firstChamber) {
    const bearing = Math.atan2(
      dungeon.entrance[0] - firstChamber.centre[0],
      dungeon.entrance[1] - firstChamber.centre[1],
    );
    const rim = Math.max(0, firstChamber.radius - 6);
    const exitSpot: Spot = [
      round2(firstChamber.centre[0] + Math.sin(bearing) * rim),
      round2(firstChamber.centre[1] + Math.cos(bearing) * rim),
    ];
    const exitScale = trueScale(2.2, dungeon.tier);
    const exitPosition = placeOn(exitSpot, firstChamber.floorOffset, "wall_brick_door", exitScale);
    const interiorMouth: SemanticEntity = {
      id: "gravelmaw_exit_portal",
      archetype: "portal",
      name: `${dungeon.name} Mouth`,
      tier: dungeon.tier,
      regionId: dungeon.id,
      position: exitPosition,
      state: "open",
      interactions: ["inspect", "enter"],
      // Mirror the surface mouth's masonry arch so the reciprocal portal belongs to the same
      // quarry construction rather than reading as a timber room door.
      view: {
        assetId: "wall_brick_door",
        scale: exitScale,
        rotationY: bearing + Math.PI,
        labelHeight: 3.2,
      },
      meta: { toRegionId: region.id, toLocationId: "gravelmaw_entrance" },
    };
    const interiorEntrance = portalEntrance(interiorMouth, () => floorBase + firstChamber.floorOffset);
    interiorMouth.interactionPosition = interiorEntrance.interactionPosition;
    out.push(interiorMouth);
    ctx.solids.push(interiorEntrance.solid);
    emitComposition(
      "gravelmaw_exit",
      placeAt(exitSpot, firstChamber.floorOffset),
      bearing + Math.PI,
      dungeon.id,
      dungeon.tier,
      region.settlement.kit,
      "gravelmaw_exit_portal",
      `${dungeon.name} Mouth`,
      { scenery: true, dungeonId: dungeon.id },
      out,
      ctx,
    );
    ctx.portalLinks.push({
      entityId: "gravelmaw_exit_portal",
      fromLocationId: "gravelmaw_chamber1",
      toLocationId: "gravelmaw_entrance",
      position: interiorEntrance.interactionPosition,
    });
  }

  // Finding 8: the twelve-metre wound was a lone wooden door frame on open ground. The cliffs, the
  // brow of rock above it and the two braziers are what make it read as a hole in a quarry face.
  // Region tier, not dungeon tier, because these parts stand on Karrowmoor's surface.
  //
  // The composition keeps the raw terrain origin the mouth was authored against; only the hero
  // mesh moved when its bbox floor was put on the ground. No volume for the mouth itself - it is
  // a hole, and a box across it would seal the entrance to the dungeon.
  emitComposition(
    dungeon.entranceComposition, mouth, mouthRotation, region.id, region.tier,
    region.settlement.kit, "gravelmaw_mouth_portal", dungeon.name,
    { scenery: true, dungeonId: dungeon.id }, out, ctx,
  );

  for (const chamber of dungeon.chambers) {
    // The marker is a brazier, so it sits against the chamber's north wall rather than dead
    // centre - the centre is where the boss and the loot go.
    const markerSpot: Spot = [chamber.centre[0], chamber.centre[1] + chamber.radius * 0.7];
    out.push({
      id: `${chamber.id}_marker`,
      archetype: "landmark",
      name: chamber.name,
      tier: dungeon.tier,
      regionId: dungeon.id,
      position: placeOn(markerSpot, chamber.floorOffset, "torch", 1.6),
      state: chamber.lit ? "lit" : "dark",
      interactions: ["inspect"],
      // No dungeon kit shipped in glTF (asset-report gap 8); the village brick set carries it,
      // and `torch` is the brazier stand-in that marks a chamber centre.
      view: { assetId: "torch", scale: 1.6, labelHeight: 2.4 },
      meta: { radius: chamber.radius, lit: chamber.lit },
    });
    ctx.locationEntity.set(chamber.id, `${chamber.id}_marker`);
  }

  const thresholds = ctx.dungeonGates ? authoredThresholds(dungeon, floorBase) : [];
  for (const door of dungeon.doors) {
    if (!ctx.dungeonGates) {
      out.push({
        id: door.id, archetype: "door", name: door.name, tier: dungeon.tier, regionId: dungeon.id,
        position: placeOn(door.position, door.floorOffset, door.assetId, 2.2), state: door.state,
        interactions: ["inspect", "open"],
        view: { assetId: door.assetId, scale: 2.2, labelHeight: 2.6 },
        meta: { lockedReason: door.lockedReason },
      });
      continue;
    }
    const threshold = thresholds.find((entry) => entry.id === door.id)!;
    out.push(...createDungeonDoorEntities(threshold, {
      name: door.name, tier: dungeon.tier, regionId: dungeon.id,
      state: door.state, lockedReason: door.lockedReason,
    }));
    // Only permanent masonry is baked. DungeonDoors handles the leaf so opening it removes
    // both physical and navigation blocking immediately, without rebuilding the island.
    ctx.solids.push(...threshold.staticSolids);
  }

  for (const obstacle of dungeon.obstacles) {
    const scale = drawnScale("obstacle", obstacle.scale, dungeon.tier);
    out.push(buildObstacle(
      dungeon.id, dungeon.tier, obstacle,
      (spot) => placeOn(spot, nearestChamberOffset(dungeon, spot), obstacle.assetId, scale),
      (spot) => placeAt(spot, nearestChamberOffset(dungeon, spot)),
    ));
  }

  for (const group of dungeon.enemyGroups) {
    const chamberPlace: Placer = (spot, assetId, scale) =>
      placeOn(spot, nearestChamberOffset(dungeon, spot), assetId, scale);
    buildEnemyGroup(dungeon.id, group, rng, chamberPlace, out, ctx.assetSize);
  }
}

/** Floor offset of the chamber a point sits in, so an entity inside chamber 3 lands on its floor. */
function nearestChamberOffset(dungeon: DungeonDef, spot: Spot): number {
  let best = 0;
  let bestDistance = Infinity;
  for (const chamber of dungeon.chambers) {
    const d = distanceXZSpot(chamber.centre, spot);
    if (d < bestDistance) {
      bestDistance = d;
      best = chamber.floorOffset;
    }
  }
  return best;
}

function buildCluster(
  regionId: RegionId,
  cluster: ResourceClusterDef,
  rng: Rng,
  place: Placer,
  normal: (spot: Spot) => readonly [number, number, number] | undefined,
  ctx: BuildContext,
): void {
  const resource = resourceDef(cluster.resourceId);
  const respawn = resource.respawnSeconds ?? respawnSeconds(resource.tier);
  const interaction = gatherInteraction(resource.archetype);
  const out = ctx.out;

  for (let index = 0; index < cluster.count; index += 1) {
    const id = `${cluster.id}_${index + 1}`;
    const authored = worldSiteResourceSlot(cluster.id, index + 1);
    const isHero = index === 0 && cluster.heroAssetId !== undefined;
    const assetId = isHero ? cluster.heroAssetId! : presentationAsset(resource, id);
    const baseScale = isHero && cluster.heroScale !== undefined
      ? cluster.heroScale
      : presentationScale(ctx, resource, assetId, id);
    const viewScale = baseScale * (authored?.slot.scale ?? 1);
    const scale = drawnScale(resource.archetype, viewScale, resource.tier);
    let spot = cluster.ringRadius === undefined
      ? spiralSpot(cluster.centre, cluster.radius, index, cluster.count, rng)
      : ringSpot(cluster.centre, cluster.ringRadius, index, cluster.count, rng);
    if (authored) spot = [...worldSitePoint(authored.site, authored.slot.x, authored.slot.z)];
    // A ritual ring is one authored arrangement. Moving its slots independently to dodge a road
    // can stack two stones together, so only free-form clusters use the road-clearance retry.
    if ((resource.archetype === "tree" || resource.archetype === "ore")
      && cluster.ringRadius === undefined && !authored) {
      // Resource clusters are semantic content rather than procedural scatter, so the scatter
      // exclusion registry cannot move them. Retry the same deterministic spiral at finer phases
      // until the solid node clears the worn road and its shoulders.
      for (let attempt = 1; attempt <= 16 && ctx.roadDistance(spot[0], spot[1]) < 3.4; attempt += 1) {
        spot = spiralSpot(
          cluster.centre, cluster.radius, index + attempt * cluster.count, cluster.count * 17, rng,
        );
      }
    }
    const grounded = place(spot, assetId, scale);
    // Fishing semantics live at the canonical solved water plane. The renderer lowers the fish
    // school by its authored waterOffset while the interaction proxy stays on the surface. Do not
    // use the fish mesh's floor-corrected `grounded.y`: its authored pivot is presentation data and
    // used to lift the proxy by up to 21 cm above the actual water.
    const position: Vec3 = resource.archetype === "fishing_spot"
      ? [spot[0], round2(ctx.heightAt(regionId, spot[0], spot[1]) + WATER_FILL_DEPTH), spot[1]]
      : grounded;

    const [yieldMin, yieldMax] = resource.yieldRange ?? yieldRange(resource.tier);
    const maxYields = rng.int(yieldMin, yieldMax);
    const rotationY = authored ? authored.site.rotationY + authored.slot.yaw : presentationRotation(id);
    preserveLegacyResourceRotationDraw(rng);
    const requirements: Partial<Record<SkillId, number>> = {};
    requirements[resource.skill] = resource.reqLevel;

    out.push({
      id,
      archetype: resource.archetype,
      name: resource.name,
      tier: resource.tier,
      regionId,
      position,
      state: "available",
      requirements,
      interactions: ["inspect", interaction],
      resource: {
        remaining: maxYields,
        maxYields,
        respawnSeconds: respawn,
        itemId: resource.itemId,
      },
      view: {
        assetId,
        depletedAssetId: resource.presentation.depletedAssetId,
        scale: viewScale,
        rotationY,
        // Ore has no dedicated mesh, so tier is carried entirely by the material tint. Trees and
        // fishing spots set it too, so `render/materials.ts` has one rule and no special cases.
        materialTier: resource.presentation.materialTier,
        labelHeight: labelHeightFor(resource.archetype),
        groundNormal: normal(spot),
        tiltStrength: TILT_STRENGTH[resource.archetype],
      },
      meta: {
        resourceId: resource.id, clusterId: cluster.id, locationId: cluster.locationId,
        skill: resource.skill,
        ...(authored ? { worldSiteId: authored.site.id } : {}),
        ...(cluster.essenceElement === undefined
          ? {}
          : { essenceElement: cluster.essenceElement, essenceCache: true, essenceHero: isHero }),
        ...(resource.presentation.waterOffset === undefined
          ? {}
          : { waterOffset: resource.presentation.waterOffset }),
      },
    });
    pushClusterSolid(ctx, id, position, resource, assetId, scale);
  }
}

export interface EnemyGroupBuildOptions {
  habitat: HabitatDef;
  members: readonly { id: string; stats: EnemyDef; scaleMultiplier: number }[];
}

/** Shared actor construction for authored groups and isolated pack fixtures. */
export function buildEnemyGroup(
  regionId: RegionId,
  group: EnemyGroupDef,
  rng: Rng,
  place: Placer,
  out: SemanticEntity[],
  assetSize: (assetId: string) => AssetSize | null,
  options?: EnemyGroupBuildOptions,
): void {
  // One lookup per group. `content/enemies.ts` publishes alias rows keyed by group id and by
  // family, so either spelling resolves. It is the ONLY source of combat stats: health, aggro
  // radius, behaviour and the displayed level all come from here, and `EnemyGroupDef` no longer
  // carries any of them. See the level comment below. Read straight off the table rather than
  // through `content.enemy`, so building a world does not depend on boot having registered first.
  if (options && options.members.length !== group.count) throw new Error(`Pack ${group.id} has mismatched members`);
  const enemyBlock = options?.members[0]?.stats ?? enemyBlockFor(group.id, group.family, group.tier);
  if (!enemyBlock) {
    // Loud rather than silent. Without a block there is no health, no level and no behaviour, and
    // the old fallback fields that used to paper over this are gone. `content/regions.ts`
    // `validateRegions()` checks the same thing at boot so this cannot reach a player.
    throw new Error(
      `Enemy group "${group.id}" (family "${group.family}", tier ${group.tier}) has no stat block in content/enemies.ts`,
    );
  }
  // A miniboss shares the boss archetype — same respawn window, same semantic reading, same
  // label height — and differs only in draw scale and the published rank.
  const bossRank = group.boss ? "boss" : group.miniBoss ? "miniboss" : null;
  const archetype: Archetype = bossRank === null ? "enemy" : "boss";
  // A boss should not be the same size as the things guarding it. 1.6x on top of the authored
  // scale is the difference between "another enemy" and "the thing in the room"; a regional
  // miniboss draws at 1.3x, above the crowd and clearly below the three Orb bosses.
  const baseViewScale = bossRank === "boss" ? group.scale * 1.6
    : bossRank === "miniboss" ? group.scale * 1.3
    : group.scale;
  // Widest of the two ground axes, halved: a stag is longer than it is wide and it is the long
  // axis that decides whether two of them are standing in each other. Null when the asset is not in
  // the manifest, which leaves `enemyAI` on its own fallback rather than inventing a size here.
  const assetBox = assetSize(group.assetId);
  const habitat = options?.habitat ?? (bossRank === null ? habitatForGroup(group.id) : null);

  for (let index = 0; index < group.count; index += 1) {
    const member = options?.members[index];
    const stats = member?.stats ?? enemyBlock;
    const viewScale = baseViewScale * (member?.scaleMultiplier ?? 1);
    const scale = drawnScale(archetype, viewScale, group.tier);
    const bodyRadius = assetBox ? (Math.max(assetBox.x, assetBox.z) / 2) * scale : null;
    // Preserve the legacy stream so authoring a habitat does not move later actors.
    const generatedSpot = group.radius <= 0
      ? group.centre
      : spiralSpot(group.centre, group.radius, index, group.count, rng);
    const spot = habitat?.anchors[index] ?? generatedSpot;
    const position = place(spot, group.assetId, scale);
    out.push({
      id: member?.id ?? (group.count === 1 ? group.id : `${group.id}_${index + 1}`),
      archetype,
      name: member ? stats.name : group.name,
      tier: group.tier,
      regionId,
      position,
      state: "alive",
      // "attack" only. It used to be "attack" and "cast" side by side, which made the player
      // re-declare their weapon on every click and still got it wrong — "Attack" with a staff in
      // hand swung the staff like a club. `systems/combat.ts` now reads the main hand and casts or
      // swings accordingly, so one verb covers both. `GameApi.cast` still names a specific spell for
      // an agent that wants to choose one; that is a different question and does not come through
      // an entity's interaction list.
      interactions: ["inspect", "attack"],
      // Stats come from `content/enemies.ts`, which solves them backwards from the PRD's
      // time-to-kill rows. `regions.ts` used to carry its own maxHealth, level, aggroRadius and
      // behaviour as placement hints from before that table existed, and they disagreed with it in
      // both directions - a Rill Skitterling read 18 HP here against the content table's 6, and
      // every `level` in the file was chosen by hand rather than derived. Those four fields are
      // gone from `EnemyGroupDef`, so there is now nowhere to type a wrong one.
      //
      // `level` in particular is COMPUTED, never authored: `enemyCombatLevel` reads the block's
      // attack, accuracy, defence, armour, magicArmour and health. A player who reads "level 19"
      // off a Highcairn Bear is reading its actual stat line.
      combat: {
        health: stats.maxHealth,
        maxHealth: stats.maxHealth,
        level: enemyCombatLevel(stats),
        aggroRadius: stats.aggroRadius,
        ...(stats.moveSpeedMps === undefined ? {} : { moveSpeedMps: stats.moveSpeedMps }),
        ...(stats.walkSpeedMps === undefined ? {} : { walkSpeedMps: stats.walkSpeedMps }),
        // The footprint the creature has to be given room for, at the size it is actually drawn.
        // `drawnScale` and not `group.scale`, because the tier silhouette is part of how big it
        // looks standing next to another one.
        ...(bodyRadius === null ? {} : { bodyRadius }),
      },
      // No `groundNormal` and no solid volume: enemies walk, and a normal sampled once at spawn
      // would be a lie the moment they moved. `systems/` owns both for anything that moves.
      view: {
        assetId: group.assetId,
        scale: viewScale,
        rotationY: round2(rng.float(0, Math.PI * 2)),
        materialTier: group.tier,
        labelHeight: bossRank !== null ? 3.4 : 2.2,
      },
      meta: {
        family: group.family,
        enemyDefId: stats.id,
        groupId: group.id,
        ...(habitat ? { habitatId: habitat.id } : {}),
        behaviour: stats.behaviour,
        spawnX: round2(position[0]),
        spawnZ: round2(position[2]),
        // "boss" for the three Orb bosses, "miniboss" for the four regional minibosses, absent
        // for ordinary enemies. Tools and tests read this instead of re-deriving it from scale.
        ...(bossRank === null ? {} : { rank: bossRank }),
      },
    });
  }
}

function buildObstacle(
  regionId: RegionId,
  tier: number,
  obstacle: ObstacleDef,
  placeEntrance: (spot: Spot) => Vec3,
  placeExit: (spot: Spot) => Vec3,
): SemanticEntity {
  return {
    id: obstacle.id,
    archetype: "obstacle",
    name: obstacle.name,
    tier,
    regionId,
    position: placeEntrance(obstacle.position),
    state: "available",
    requirements: { agility: obstacle.reqLevel },
    interactions: ["inspect", obstacle.interaction],
    obstacle: {
      reqLevel: obstacle.reqLevel,
      exitPosition: placeExit(obstacle.exitPosition),
      durationMs: obstacle.durationMs,
      savesMeters: obstacle.savesMeters,
    },
    view: {
      assetId: obstacle.assetId,
      scale: obstacle.scale,
      rotationY: obstacle.rotationY,
      labelHeight: 2.6,
    },
    meta: {
      fromLocationId: obstacle.fromLocationId,
      toLocationId: obstacle.toLocationId,
      oneWay: obstacle.oneWay === true,
    },
  };
}

// ------------------------------------------------------------------ helpers

function gatherInteraction(archetype: GatheringResourceArchetype): InteractionId {
  switch (archetype) {
    case "ore": return "mine";
    case "tree": return "chop";
    case "fishing_spot": return "fish";
  }
}

function labelHeightFor(archetype: GatheringResourceArchetype): number {
  switch (archetype) {
    case "tree": return 6.5;
    case "ore": return 2.6;
    default: return 1.4;
  }
}

/**
 * Golden-angle spiral plus a small seeded wobble. Two properties matter: nodes never stack on top
 * of each other (which a pure random scatter does often enough to look broken at 5 nodes), and the
 * layout is reproducible from the seed.
 */
function spiralSpot(centre: Spot, radius: number, index: number, count: number, rng: Rng): Spot {
  const goldenAngle = 2.399963229728653;
  const angle = index * goldenAngle + rng.float(-0.22, 0.22);
  const spread = Math.sqrt((index + 0.5) / Math.max(1, count));
  const distance = radius * spread * rng.float(0.82, 1.0);
  return [
    round2(centre[0] + Math.cos(angle) * distance),
    round2(centre[1] + Math.sin(angle) * distance),
  ];
}

/** Evenly spaced cache nodes around an altar court, with a small seeded natural wobble. */
function ringSpot(centre: Spot, radius: number, index: number, count: number, rng: Rng): Spot {
  const angle = (index / Math.max(1, count)) * Math.PI * 2 + rng.float(-0.1, 0.1);
  const distance = radius * rng.float(0.94, 1.06);
  return [
    round2(centre[0] + Math.cos(angle) * distance),
    round2(centre[1] + Math.sin(angle) * distance),
  ];
}

function spotToVec3(spot: Spot, heightAt: HeightAt, regionId: RegionId): Vec3 {
  return [spot[0], round2(heightAt(regionId, spot[0], spot[1])), spot[1]];
}

function distance3(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function distanceXZSpot(a: Spot, b: Spot): number {
  const dx = a[0] - b[0];
  const dz = a[1] - b[1];
  return Math.sqrt(dx * dx + dz * dz);
}

/** Two decimals everywhere, so the built world serialises identically across runs. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Four decimals for scales and rotations, where two would visibly shift a 2 m module. */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Architecture and landmarks use authored metres. EntityViews only applies tier silhouette
 * scaling to resources and living combatants, so compensating these rows would shrink Rootfall
 * and Highcairn props while their placement and collision stayed at the authored size.
 */
function trueScale(authored: number | undefined, _tier: number): number {
  return round4(authored ?? 1);
}

/** The bank's route node id differs per settlement; this keeps the mapping in one place. */
function bankLocationId(region: RegionDef): string {
  switch (region.id) {
    case "fallowmarch": return "bank_interior";
    case "vellenwood": return "rootfall_bank";
    default: return "highcairn_bank";
  }
}
