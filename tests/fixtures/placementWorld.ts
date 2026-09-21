import { Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import type { SemanticEntity, Vec3 } from "../../game/src/contracts.js";
import { RESOLVED_TABLES } from "../../game/src/content/resolvedCatalog.js";
import type { CompiledWorld } from "../../game/src/content/worldData.js";
import type { HeadlessWorldPorts } from "../../game/src/multiplayer/headlessWorld.js";
import { planSpawns, type SpawnContext } from "../../game/src/multiplayer/spawnPlan.js";
import { Navigation } from "../../game/src/systems/navigation.js";
import { Solids } from "../../game/src/systems/solids.js";

export const PLACEMENT_GROUP = "redsill_frogs";
/**
 * A flat pad under one real placement, with its creatures built and rebuilt by the production spawn
 * planner. The authored world does the same over terrain, solids and its baked navmesh.
 *
 * The default export, so a world thread can build it from this module as well as a test in process.
 */
export default async function placementWorld(): Promise<HeadlessWorldPorts> {
  await Navigation.initLibrary();
  const ground = new Mesh(new PlaneGeometry(320, 320), new MeshBasicMaterial());
  ground.rotation.x = -Math.PI / 2; ground.position.set(-50, 0, -52); ground.updateMatrixWorld(true);
  const nav = new Navigation();
  if (!nav.build([ground])) throw new Error("placement pad navigation failed");
  ground.geometry.dispose(); ground.material.dispose();
  const context: SpawnContext = { seed: 1337, floorAt: () => 0, baseY: () => 0, assetSize: () => null, refinePopulation: false,
    spacing: () => ({ underground: () => false, place: (_entity, x, z) => nav.nearestWalkable([x, 0, z], .3) ? [x, 0, z] : null }) };
  const first = planSpawns(context, RESOLVED_TABLES.world as CompiledWorld, new Set([PLACEMENT_GROUP]), []);
  const entities = first.spawns as SemanticEntity[];
  return { nav, entities, habitats: first.habitats, spawn: [-50, 0, -40] as Vec3,
    planSpawns: (table, groupIds, residents) => planSpawns(context, table, groupIds, residents),
    movement: { solids: new Solids([]), heightAt: () => 0, regionAt: () => "fallowmarch" },
    campfirePlacement: { groundAt: () => ({ y: 0, normal: [0, 1, 0] }), withinPlayableBounds: () => true, distanceToWater: () => Infinity, clearAt: () => true } };
}
