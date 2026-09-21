import type { RegionId, SemanticEntity, Vec3 } from "../contracts.js";
import type { LabFixtureSpec } from "../featureLab/labSpec.js";
import type { HeadlessWorld, HeadlessWorldPorts } from "../multiplayer/headlessWorld.js";
import { Navigation } from "../systems/navigation.js";
import { Solids } from "../systems/solids.js";
import { chamberFloorAt, dungeonFloorHeight } from "../world/dungeonLayout.js";
import { ForestObstacles } from "../world/forestObstacles.js";
import { ForestResources } from "../world/forestResources.js";
import { TerrainSampler } from "../world/terrainSampler.js";
import type { LabBounds, LabWorldData, LabWorldPatch } from "./labProtocol.js";

/**
 * The lab world, as the worker holds it: a `HeadlessWorldPorts` built from the spec and from the
 * world description the page sent, never from a simulation the page ran.
 *
 * A lab changes its ground while it runs (a new structure, an environment showcase), and every
 * player system copies its movement ports when it is built. So the ports handed out here are stable
 * closures over `ground`, and `patch` swaps what they read: the navmesh is imported into the same
 * `Navigation`, and collision and walk-surface bounds are replaced whole.
 */
export interface LabWorld {
  readonly spec: LabFixtureSpec;
  readonly ports: HeadlessWorldPorts;
  /** The drawn ground at a point, the fairy realm's where the point lies inside it. */
  groundHeightAt(x: number, z: number): number;
  /**
   * The lab's one target actor. Its AI runtime lives in the shared world rows, which are never replicated, so after each
   * tick the worker writes it onto the entity as `meta.labAi`. It then reaches the page in the same update as the health
   * and position that tick produced, and `__featureLab.getState().target.ai` is never a tick behind them.
   */
  targetId: string | null;
  stampTargetAi(world: HeadlessWorld): void;
  /** Swap geometry in place. Entities are the caller's to add and remove, because they live in the running world. */
  patch(patch: LabWorldPatch): void;
}

export async function createLabWorld(spec: LabFixtureSpec, data: LabWorldData): Promise<LabWorld> {
  await Navigation.initLibrary();
  const main = new TerrainSampler(data.terrain);
  const fairy = data.fairyTerrain ? new TerrainSampler(data.fairyTerrain) : null;
  const terrainAt = (x: number, z: number): TerrainSampler => fairy?.contains(x, z) ? fairy : main;
  const dungeon = data.dungeon;
  const ground: { solids: Solids; surfaceBounds: LabBounds[] } = { solids: new Solids(data.solids), surfaceBounds: data.surfaceBounds };
  const nav = new Navigation();
  nav.importNavData(data.nav.navData, data.nav);
  nav.setRouteGraph(data.routeNodes, data.routeEdges);

  const groundHeightAt = (x: number, z: number): number => terrainAt(x, z).meshHeightAt(x, z);
  const heightAt = (region: RegionId, x: number, z: number): number => dungeon && region === dungeon.regionId ? dungeonFloorHeight(dungeon, x, z) : groundHeightAt(x, z);
  const within = (point: Vec3): boolean => { const bounds = main.getWorldBounds(); return point[0] > bounds.minX && point[0] < bounds.maxX && point[2] > bounds.minZ && point[2] < bounds.maxZ; };

  const forestObstacles = new ForestObstacles(); let forest: ForestResources | null = null;
  const entities: SemanticEntity[] = structuredClone(data.entities);
  const ports: HeadlessWorldPorts = {
    nav, entities, habitats: data.habitats, knownLocations: data.knownLocations, doorBarriers: data.doorBarriers,
    spawn: [...data.spawn.position] as Vec3,
    // A lab's creatures are placed by its fixtures, not by placements, so a publish has no group to rebuild here.
    planSpawns: () => ({ groupIds: new Set<string>(), spawns: [], habitats: [] }),
    interestRadius: spec.interestRadius, sharedRandomSeed: true,
    movement: {
      solids: { resolve: (point, from, radius) => ground.solids.resolve(point, from, radius) },
      authoritativeGround: true, heightAt,
      preserveNavigationHeight: point => ground.surfaceBounds.some(box => point[0] >= box.min[0] && point[0] <= box.max[0] && point[1] >= box.min[1] && point[1] <= box.max[1] && point[2] >= box.min[2] && point[2] <= box.max[2]),
      regionAt: (point, current) => current === dungeon?.regionId ? current : terrainAt(point[0], point[2]).regionAt(point[0], point[2]),
      ...(data.trees.length ? { dynamicObstacles: forestObstacles } : {}),
    },
    campfirePlacement: {
      withinPlayableBounds: (region, point) => dungeon && region === dungeon.regionId ? chamberFloorAt(dungeon, point) !== null : within(point),
      groundAt: (region, x, z) => {
        if (dungeon && region === dungeon.regionId) { const y = dungeonFloorHeight(dungeon, x, z); return chamberFloorAt(dungeon, [x, y, z]) !== null ? { y, normal: [0, 1, 0] } : null; }
        const sample = terrainAt(x, z).sampleWorld(x, z);
        return sample.playable && !sample.waterBodyId ? { y: groundHeightAt(x, z), normal: terrainAt(x, z).normalAt(x, z) } : null;
      },
      distanceToWater: (region, point) => {
        if (region === dungeon?.regionId) return Infinity;
        for (const radius of [0, .2, .4, .6, .8, 1]) for (let i = 0; i < (radius === 0 ? 1 : 32); i++) {
          const sample = terrainAt(point[0], point[2]).sampleWorld(point[0] + Math.sin(i * Math.PI / 16) * radius, point[2] + Math.cos(i * Math.PI / 16) * radius);
          if (!sample.playable || sample.waterBodyId) return radius;
        } return 1.001;
      },
      clearAt: (_region, point, radius) => { const resolved = ground.solids.resolve(point, point, radius); return Math.hypot(point[0] - resolved[0], point[2] - resolved[2]) < .001; },
    },
    ...(data.trees.length ? {
      // The forest fixture's trees, held the way the authored world holds them: entities only while a player is near.
      initialize(world: HeadlessWorld) {
        forest = new ForestResources({ entities: world.entities, getNodeState: id => world.shared.nodes[id],
          onActivate: tree => { if (world.shared.nodes[tree.id]?.state !== "depleted") forestObstacles.upsert(tree); }, onDeactivate: tree => { forestObstacles.remove(tree.id); } });
        for (const tree of data.trees) { world.entities.remove(tree.id); forest.register(tree); }
      },
      beforeTick(world: HeadlessWorld) {
        const players = [...world.active].map(id => world.players.get(id)!.store.get()); const pins = new Set<string>();
        for (const player of players) { if (player.player.movement.destinationEntityId) pins.add(player.player.movement.destinationEntityId); if (player.activity?.kind === "gathering") pins.add(player.activity.entityId); }
        forest!.updatePlayers(players.map(player => player.player.position), pins);
        forest!.forEachResident((entity, tree) => { if (entity.state === "depleted") forestObstacles.remove(tree.id); else forestObstacles.upsert(tree); });
      },
    } : {}),
  };

  const lab: LabWorld = {
    spec, ports, groundHeightAt, targetId: null,
    stampTargetAi(world) {
      const entity = lab.targetId ? world.entities.get(lab.targetId) : undefined, runtime = entity ? world.shared.enemies[entity.id] : undefined;
      if (!entity || !runtime) return;
      // Entity meta holds scalars, so the runtime travels as JSON.
      const next = JSON.stringify({ state: runtime.state, spawnPos: [...runtime.spawnPos], respawnAtMs: runtime.respawnAtMs });
      if (entity.meta?.["labAi"] !== next) entity.meta = { ...entity.meta, labAi: next };
    },
    patch(patch) {
      if (patch.nav) { nav.importNavData(patch.nav.navData, patch.nav); nav.setRouteGraph(data.routeNodes, data.routeEdges); }
      if (patch.solids) ground.solids = new Solids(patch.solids);
      if (patch.surfaceBounds) ground.surfaceBounds = patch.surfaceBounds;
    },
  };
  ports.afterTick = world => lab.stampTargetAi(world);
  return lab;
}
