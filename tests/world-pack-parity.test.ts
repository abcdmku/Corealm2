import { beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import type { SemanticEntity, Vec3 } from "../game/src/contracts.js";
import { RESOLVED_TABLES } from "../game/src/content/resolvedCatalog.js";
import type { CompiledWorld } from "../game/src/content/worldData.js";
import { Rng } from "../game/src/core/rng.js";
import { pathLength } from "../game/src/core/math.js";
import { buildAuthoredGeometry, openAuthoredSource, type AuthoredSource } from "../game/src/multiplayer/bake/authoredWorld.js";
import type { HeadlessWorldPorts } from "../game/src/multiplayer/headlessWorld.js";
import { assembleAuthoredWorld, buildAuthoredSemantic, type AuthoredGeometry } from "../game/src/multiplayer/worldAssembly.js";
import { createPackedWorld, type ServerWorldPack } from "../game/src/multiplayer/worldPack.js";
import { TerrainSampler } from "../game/src/world/terrainSampler.js";
import { assertServerWorldPack } from "../tools/build-server-world-pack.js";
import { gameRoot } from "../tools/lib/paths.js";

/**
 * The shipped pack against the source it was baked from. One world is built the bake's way, with the
 * renderer's terrain and the GLB triangles, and one is booted from the pack on disk. They must agree,
 * because the client predicts movement over the first and the server rules over the second.
 */
const SEED = 1337;
let source: AuthoredSource, geometry: AuthoredGeometry, pack: ServerWorldPack, reference: HeadlessWorldPorts, packed: HeadlessWorldPorts;
const timings = { reference: 0, packed: 0 };

beforeAll(async () => {
  pack = await assertServerWorldPack();
  let startedAt = performance.now();
  packed = await createPackedWorld(pack, SEED);
  timings.packed = performance.now() - startedAt;
  startedAt = performance.now();
  source = await openAuthoredSource(SEED, path.join(gameRoot, "public/assets"));
  const semantic = buildAuthoredSemantic(SEED, source.terrains, source.measurements);
  geometry = await buildAuthoredGeometry(SEED, source, semantic);
  // The assembly appends to the semantic solids and moves creatures, so take what the pack should hold first.
  geometry = { ...geometry, solids: structuredClone(geometry.solids), trees: structuredClone(geometry.trees) };
  reference = assembleAuthoredWorld(SEED, source.terrains, source.measurements, semantic, geometry);
  timings.reference = performance.now() - startedAt;
  console.log(`authored world boot: from source ${Math.round(timings.reference)} ms, from pack ${Math.round(timings.packed)} ms`);
}, 300_000);

const placed = (entities: readonly SemanticEntity[]) => entities.map(entity => [entity.id, entity.position, entity.meta?.spawnX ?? null, entity.meta?.spawnZ ?? null]);

describe("server world pack parity", () => {
  it("answers every ground query exactly as the built terrain does", () => {
    for (const [scene, data] of [[source.scene, pack.worlds.get(SEED)!.terrain.main], [source.fairyScene, pack.worlds.get(SEED)!.terrain.fairy]] as const) {
      const sampler = new TerrainSampler(data), extent = scene.getScatterBounds(Infinity), rng = new Rng(20260920);
      expect(sampler.getExtent()).toEqual(extent);
      let playable = 0, coastal = 0;
      for (let index = 0; index < 12_000; index++) {
        // A tenth of the points are pushed past the edge, where heights clamp and nothing is playable.
        const x = rng.float(extent.minX - 40, extent.maxX + 40), z = rng.float(extent.minZ - 40, extent.maxZ + 40);
        const live = scene.sampleWorld(x, z), baked = sampler.sampleWorld(x, z);
        expect([sampler.meshHeightAt(x, z), sampler.heightAt("fallowmarch", x, z), sampler.regionAt(x, z), sampler.normalAt(x, z), sampler.placementSurfaceAt(x, z)])
          .toEqual([scene.meshHeightAt(x, z), scene.heightAt("fallowmarch", x, z), scene.regionAt(x, z), scene.normalAt(x, z), scene.placementSurfaceAt(x, z)]);
        expect(baked).toEqual({ playable: live.playable, height: live.height, slope: live.slope, semanticRegion: live.semanticRegion,
          waterBodyId: live.waterBodyId, coast: live.coast ? { seaLevel: live.coast.seaLevel } : null });
        if (live.playable) playable++;
        if (live.playable && (x < data.bounds.minX || x > data.bounds.maxX || z < data.bounds.minZ || z > data.bounds.maxZ)) coastal++;
      }
      expect(playable).toBeGreaterThan(3000);
      if (data.coast) expect(coastal).toBeGreaterThan(100);
    }
  });

  it("builds the same entities, habitats, barriers, locations and spawn point", () => {
    expect(packed.entities.length).toBeGreaterThan(10_000);
    expect(placed(packed.entities)).toEqual(placed(reference.entities));
    expect(packed.entities).toEqual(reference.entities);
    expect(packed.habitats).toEqual(reference.habitats);
    expect(packed.doorBarriers).toEqual(reference.doorBarriers);
    expect(packed.knownLocations).toEqual(reference.knownLocations);
    expect(packed.spawn).toEqual(reference.spawn);
  });

  it("holds the solids, structure boxes and trees the bake produces today", () => {
    const world = pack.worlds.get(SEED)!;
    expect(world.solids).toEqual(geometry.solids);
    expect(world.structureBounds).toEqual(geometry.structureBounds);
    expect(world.trees.length).toBeGreaterThan(5000);
    expect(world.trees).toEqual(geometry.trees);
  });

  it("moves bodies over the same ground and around the same solids", () => {
    const rng = new Rng(7), mobs = reference.entities.filter(entity => entity.archetype === "enemy");
    for (let index = 0; index < 2000; index++) {
      const near = mobs[rng.int(0, mobs.length - 1)]!, from: Vec3 = [near.position[0] + rng.float(-30, 30), near.position[1], near.position[2] + rng.float(-30, 30)];
      const to: Vec3 = [from[0] + rng.float(-3, 3), from[1], from[2] + rng.float(-3, 3)];
      expect(packed.movement.heightAt!(near.regionId, from[0], from[2])).toBe(reference.movement.heightAt!(near.regionId, from[0], from[2]));
      expect(packed.movement.solids!.resolve(from, to, .4)).toEqual(reference.movement.solids!.resolve(from, to, .4));
      expect(packed.movement.regionAt!(from, near.regionId)).toBe(reference.movement.regionAt!(from, near.regionId));
      expect(packed.movement.preserveNavigationHeight!(from)).toBe(reference.movement.preserveNavigationHeight!(from));
      expect(packed.campfirePlacement.groundAt(near.regionId, from[0], from[2])).toEqual(reference.campfirePlacement.groundAt(near.regionId, from[0], from[2]));
      expect(packed.campfirePlacement.distanceToWater(near.regionId, from)).toBe(reference.campfirePlacement.distanceToWater(near.regionId, from));
      expect(packed.campfirePlacement.clearAt(near.regionId, from, .6)).toBe(reference.campfirePlacement.clearAt(near.regionId, from, .6));
    }
  });

  it("finds the same paths on the baked navmesh as on a freshly generated one", () => {
    const rng = new Rng(99), anchors = reference.entities.filter(entity => entity.archetype === "npc" || entity.archetype === "enemy" || entity.archetype === "bank");
    let routed = 0;
    for (let index = 0; index < 300; index++) {
      const a = anchors[rng.int(0, anchors.length - 1)]!.position, near = rng.float(0, 1) < .7;
      const b: Vec3 = near ? [a[0] + rng.float(-60, 60), a[1], a[2] + rng.float(-60, 60)] : anchors[rng.int(0, anchors.length - 1)]!.position;
      const live = reference.nav.findPath(a, b), baked = packed.nav.findPath(a, b);
      expect(baked === null).toBe(live === null);
      if (!live || !baked) continue;
      routed++;
      expect(Math.abs(pathLength(baked) - pathLength(live))).toBeLessThan(.01);
      expect(packed.nav.closestPoint(b)).toEqual(reference.nav.closestPoint(b));
    }
    expect(routed).toBeGreaterThan(150);
    expect(packed.nav.getDiagnostics().polyCount).toBe(reference.nav.getDiagnostics().polyCount);
  });

  it("plans a moved spawn group over pack data exactly as over the source geometry", () => {
    const table = structuredClone(RESOLVED_TABLES.world) as CompiledWorld, GROUP = "redsill_frogs";
    const group = Object.values(table.groupsByRegion).flat().find(entry => entry.id === GROUP)!;
    const habitat = table.habitats.find(entry => entry.groupId === GROUP)!;
    (group.centre as [number, number])[0] += 20;
    (habitat.centre as [number, number])[0] += 20;
    for (const anchor of habitat.anchors as [number, number][]) anchor[0] += 20;
    const plan = packed.planSpawns!(table, new Set([GROUP]), packed.entities);
    expect(plan).toEqual(reference.planSpawns!(table, new Set([GROUP]), reference.entities));
    expect(plan.spawns).toHaveLength(7);
    const before = new Map(packed.entities.filter(entity => entity.meta?.groupId === GROUP).map(entity => [entity.id, entity.position[0]]));
    // Spacing may shift a body by a few metres, never back to where the group stood.
    for (const spawn of plan.spawns) expect(spawn.position[0] - before.get(spawn.id)!).toBeGreaterThan(8);
    // Every planned body stands on the pack's ground and on its navmesh.
    for (const spawn of plan.spawns) expect(packed.nav.nearestWalkable([spawn.position[0], packed.movement.heightAt!(spawn.regionId, spawn.position[0], spawn.position[2]), spawn.position[2]], .5)).not.toBeNull();
  });

  it("boots from the pack several times faster than from source", () => {
    expect(timings.packed * 3).toBeLessThan(timings.reference);
  });
});
