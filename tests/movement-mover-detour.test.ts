import { readFileSync } from "node:fs";
import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INTERACT_RANGE, PLAYER_RADIUS, PLAYER_SPEED } from "../game/src/app/config.js";
import type { SemanticEntity, SkillId, SolidVolume, Vec3 } from "../game/src/contracts.js";
import { COLDBRACE } from "../game/src/content/settlements/coldbrace.js";
import { EventBus } from "../game/src/core/events.js";
import { distanceXZ } from "../game/src/core/math.js";
import { prefabCollision } from "../game/src/render/buildings.js";
import { createInitialState } from "../game/src/state/store.js";
import { ARRIVE_EPSILON, Movement } from "../game/src/systems/movement.js";
import { Navigation, solidObstacleMeshes } from "../game/src/systems/navigation.js";
import { Solids } from "../game/src/systems/solids.js";
import { EntityStore } from "../game/src/world/entities.js";
import { ForestObstacles } from "../game/src/world/forestObstacles.js";
import { assetSolidFromMeasurements, structureCollisionFromBoxes } from "../game/src/world/regionBuilder.js";

const dorn = COLDBRACE.npcs.find((npc) => npc.id === "npc_pitmaster_dorn")!;
const counter = COLDBRACE.props!.find((prop) => prop.id === "coldbrace_prop_bank_counter")!;
const porch = COLDBRACE.buildings.find((building) => building.id === "coldbrace_bank_porch")!;
const shop = COLDBRACE.shops.find((candidate) => candidate.id === "coldbrace_general")!;
const shopPosition: Vec3 = [shop.position[0], 0, shop.position[1]];
const shopApproach: Vec3 = [shopPosition[0] + 2, 0, shopPosition[2]];
const npcRadius = 0.45;
const tickMs = 100;
const maxTicks = 100;

const manifest = JSON.parse(readFileSync(new URL("../game/public/assets/manifest.json", import.meta.url), "utf8")) as {
  assets: { id: string; size: { x: number; y: number; z: number }; base: { x: number; y: number; z: number } }[];
};
const counterAsset = manifest.assets.find((asset) => asset.id === counter.assetId)!;
const counterSolid = assetSolidFromMeasurements(counter.id,
  [counter.position[0], 0, counter.position[1]], counter.assetId, counter.scale ?? 1, counter.rotationY, false, {
    assetSize: (id) => id === counterAsset.id ? counterAsset.size : null,
    assetCenterXZ: (id) => id === counterAsset.id
      ? { x: counterAsset.base.x + counterAsset.size.x / 2, z: counterAsset.base.z + counterAsset.size.z / 2 }
      : null,
  })!;
const bankVolumes: SolidVolume[] = [counterSolid, ...structureCollisionFromBoxes(
  prefabCollision(porch.prefab, porch.footprint), {
    origin: [porch.position[0], 0, porch.position[1]], rotationY: porch.rotationY,
    regionId: "fallowmarch", ownerId: porch.id, name: porch.name, prefab: porch.prefab,
  },
).solids];

const sourceMeshes: THREE.Mesh[] = [];
let bankNavigation: Navigation;
let openNavigation: Navigation;
let slopeNavigation: Navigation;
let wallNavigation: Navigation;
const wallVolumes: SolidVolume[] = [{
  kind: "box", id: "detour_wall", position: [-164, 0, -76], size: [6, 3, 1], rotationY: 0,
}];
type GroundHeight = (x: number, z: number) => number;
const flatGround: GroundHeight = () => 0;
const slopeGround: GroundHeight = (x) => (x + 164) * Math.tan(40 * Math.PI / 180);

function navigation(volumes: SolidVolume[], groundHeight: GroundHeight = flatGround, cellSize = 0.45): Navigation {
  // Keep authored XZ and production carving on a small deterministic floor.
  const geometry = new THREE.PlaneGeometry(40, 40, 20, 20);
  geometry.rotateX(-Math.PI / 2);
  const vertices = geometry.getAttribute("position");
  for (let index = 0; index < vertices.count; index++) {
    vertices.setY(index, groundHeight(vertices.getX(index) - 165, vertices.getZ(index) - 86));
  }
  geometry.computeVertexNormals();
  const floor = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  floor.position.set(-165, 0, -86);
  floor.updateMatrixWorld(true);
  const meshes = [floor, ...solidObstacleMeshes(volumes)];
  sourceMeshes.push(...meshes);
  const nav = new Navigation();
  // Coldbrace uses the production world cell size rather than the local-floor default of 0.3 m.
  expect(nav.build(meshes, "solo", { cs: cellSize })).toBe(true);
  expect(nav.getDiagnostics().polyCount).toBeGreaterThan(0);
  return nav;
}

beforeAll(async () => {
  await Navigation.initLibrary();
  bankNavigation = navigation(bankVolumes);
  openNavigation = navigation([]);
  // A fine grid keeps the continuous incline under Recast's two-voxel neighbour-climb limit.
  slopeNavigation = navigation([], slopeGround, 0.15);
  wallNavigation = navigation(wallVolumes);
});

afterAll(() => {
  const materials = new Set<THREE.Material>();
  for (const mesh of sourceMeshes) {
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
  }
  for (const material of materials) material.dispose();
});

function fixture(nav: Navigation, start: Vec3, volumes: SolidVolume[], npcPosition: Vec3,
  groundHeight: GroundHeight = flatGround) {
  const state = createInitialState();
  state.player.position = [...start];
  state.player.regionId = "fallowmarch";
  const entities = new EntityStore({ skillLevels: () => Object.fromEntries(
    Object.entries(state.skills).map(([id, skill]) => [id, skill.level]),
  ) as Record<SkillId, number> });
  const npc: SemanticEntity = {
    id: dorn.id, name: dorn.name, archetype: "npc", tier: 1, regionId: "fallowmarch",
    position: npcPosition, state: "idle", interactions: ["talk"],
  };
  entities.add(npc);
  const solids = new Solids(volumes);
  const forest = new ForestObstacles();
  const events = new EventBus();
  const movement = new Movement(nav, events, {
    solids, entities, dynamicObstacles: forest, heightAt: (_regionId, x, z) => groundHeight(x, z),
  });
  return { nav, state, entities, npc, solids, forest, events, movement, groundHeight };
}

function walkTo(h: ReturnType<typeof fixture>, destination: Vec3, afterStarted?: () => void) {
  const start = [...h.state.player.position] as Vec3;
  const route = h.nav.findPathDetailed(start, destination);
  expect(route).not.toBeNull();
  expect(route!.partial).toBe(false);
  expect(route!.arrivalGap).toBeLessThan(0.1);
  expect(h.forest.size).toBe(0);
  expect(h.movement.startPath(h.state, destination, null, 0)).not.toBeNull();
  afterStarted?.();
  const trace: Vec3[] = [start];
  for (let tick = 1; tick <= maxTicks && h.state.player.movement.mode === "path"; tick++) {
    const previous = h.state.player.position;
    h.movement.update(h.state, tickMs, tick * tickMs);
    h.events.flush();
    const point = h.state.player.position;
    trace.push([...point]);
    const context = `tick ${tick}, point ${JSON.stringify(point)}, Detour path ${JSON.stringify(route!.path)}`;
    expect(distanceXZ(h.solids.resolve(point, point, PLAYER_RADIUS), point), context).toBeLessThanOrEqual(0.005);
    expect(distanceXZ(point, h.npc.position), context).toBeGreaterThanOrEqual(PLAYER_RADIUS + npcRadius - 1e-6);
    expect(distanceXZ(previous, point), context).toBeLessThanOrEqual(PLAYER_SPEED * tickMs / 1000 + 0.05);
    expect(point[1], context).toBeCloseTo(h.groundHeight(point[0], point[2]), 6);
    const snapped = h.nav.closestPoint(point);
    expect(snapped, context).not.toBeNull();
    expect(distanceXZ(snapped!, point), context).toBeLessThanOrEqual(0.08);
  }
  const events = h.events.since(0).events;
  const context = JSON.stringify({ path: route!.path, start, lastPositions: trace.slice(-12), events });
  expect(events.filter((event) => event.type === "navigation.failed"), context).toEqual([]);
  const completed = events.filter((event) => event.type === "navigation.completed");
  expect(completed, context).toHaveLength(1);
  expect(completed[0]!.atMs, context).toBeLessThanOrEqual(maxTicks * tickMs);
  expect(h.state.player.movement.mode, context).toBe("idle");
  expect(distanceXZ(h.state.player.position, destination), context).toBeLessThanOrEqual(ARRIVE_EPSILON);
  expect(distanceXZ(start, h.state.player.position), context).toBeGreaterThan(distanceXZ(start, destination) - ARRIVE_EPSILON);
  return { route: route!, trace };
}

describe("click paths around live NPCs", () => {
  it("walks every bend of a navigation edge when a wall blocks the straight rejoin", () => {
    const start: Vec3 = [-164, 0, -82], npc: Vec3 = [-164, 0, -79];
    const destination: Vec3 = [-164, 0, -71];
    const h = fixture(wallNavigation, start, wallVolumes, npc);
    h.movement.setDetourDiagnostics(true);
    const { trace } = walkTo(h, destination, () => {
      h.state.player.movement.path = [start, npc, destination];
      h.state.player.movement.pathIndex = 1;
    });
    const plans = h.movement.getDetourDiagnostics().plans as { outcome: string; points?: Vec3[] }[];
    expect(plans[0]?.outcome).toBe("route");
    // Both detour rings are narrower than the wall. Arrival requires a retained nav bend.
    expect(Math.max(...plans[0]!.points!.map((point) => Math.abs(point[0] - start[0])))).toBeGreaterThan(3 + PLAYER_RADIUS);
    expect(Math.max(...trace.map((point) => Math.abs(point[0] - start[0])))).toBeGreaterThan(3 + PLAYER_RADIUS);
  });

  it("rejoins the recorded Coldbrace bank-to-shop path around the porch post", () => {
    // Captured final-world XZ corners. Flatten only Y to the isolated source-collider floor.
    const recorded: Vec3[] = [
      [-162.53579711914062, 0, -90.13529205322266],
      [-162.46664428710938, 0, -88.31719970703125],
      [-162.3975067138672, 0, -86.49909973144531],
      [-162.42393493652344, 0, -85.91531372070312],
      [-162.6510772705078, 0, -85.32527160644531],
      [-162.9593505859375, 0, -84.97212219238281],
      [-163.42800903320312, 0, -84.6172103881836],
      [-165.66525268554688, 0, -83.30393981933594],
      [-167.90249633789062, 0, -81.99066925048828],
      [-170.13973999023438, 0, -80.67739868164062],
    ];
    const h = fixture(bankNavigation, recorded[0]!, bankVolumes, [dorn.position[0], 0, dorn.position[1]]);
    h.movement.setDetourDiagnostics(true);
    expect(distanceXZ(h.solids.resolve(recorded[2]!, recorded[2]!, PLAYER_RADIUS), recorded[2]!))
      .toBeCloseTo(0.16949395681190776, 6);
    walkTo(h, recorded.at(-1)!, () => {
      h.state.player.movement.path = recorded;
      h.state.player.movement.pathIndex = 1;
    });
  });

  it.each([
    { name: "bank arrival", start: [-162.528, 0, -90.089] as Vec3 },
    { name: "last clear pose beside the counter", start: [-162.551, 0, -89.219] as Vec3 },
  ])("walks from $name to Coldbrace general supplies without a jump or collision", ({ start }) => {
    const h = fixture(bankNavigation, start, bankVolumes, [dorn.position[0], 0, dorn.position[1]]);
    h.movement.setDetourDiagnostics(true);
    const { route } = walkTo(h, shopApproach);
    // The source counter and porch must force a real Detour corner in this regression.
    expect(route.path.length).toBeGreaterThan(2);
    expect(distanceXZ(h.state.player.position, shopPosition)).toBeLessThanOrEqual(INTERACT_RANGE);
  });

  it("walks around an NPC moved into an existing path without rebuilding navigation", () => {
    const start: Vec3 = [-168, 0, -80];
    const destination: Vec3 = [-160, 0, -80];
    const h = fixture(openNavigation, start, [], [-164, 0, -76]);
    expect(h.nav.findPath(start, destination)).toHaveLength(2);
    const { trace } = walkTo(h, destination, () => {
      expect(h.state.player.movement.mode).toBe("path");
      expect(h.entities.setPosition(h.npc.id, [-164, 0, -80])).toBe(true);
    });
    expect(Math.max(...trace.map((point) => Math.abs(point[2] - start[2])))).toBeGreaterThan(npcRadius);
  });

  it("detours around an NPC while climbing a walkable 40-degree slope", () => {
    const start: Vec3 = [-168, slopeGround(-168, -80), -80];
    const destination: Vec3 = [-160, slopeGround(-160, -80), -80];
    const h = fixture(slopeNavigation, start, [], [-164, slopeGround(-164, -80), -80], slopeGround);
    const { trace } = walkTo(h, destination);
    expect(Math.max(...trace.map((point) => Math.abs(point[2] - start[2])))).toBeGreaterThan(npcRadius);
    expect(h.state.player.position[1] - start[1]).toBeGreaterThan(6);
  });
});
