import type { EntityId, SemanticEntity, SolidVolume, Vec3 } from "../contracts.js";
import type { Navigation, RouteEdge, RouteNode } from "../systems/navigation.js";
import {
  DungeonDoors, createDungeonDoorEntities, createDungeonDoorThreshold,
  type DungeonDoorThreshold,
} from "../world/dungeonDoors.js";

export interface DungeonDoorFixture {
  entities: SemanticEntity[];
  solids: SolidVolume[];
  thresholds: DungeonDoorThreshold[];
  routeNodes: RouteNode[];
  routeEdges: RouteEdge[];
  enclosure: {
    id: string;
    origin: Vec3;
    rotationY: number;
    minX: number;
    maxX: number;
    bottomAt: (x: number, z: number) => number;
    height: number;
  }[];
}

/** Three enclosed bays make walking around a locked fixture as impossible as the authored cave. */
export function assembleDungeonDoorFixture(heightAt: (x: number, z: number) => number): DungeonDoorFixture {
  const thresholds = [
    { id: "gravelmaw_stone_door", name: "The Three-Lever Door", z: -6, state: "locked" },
    { id: "ordrun_gate", name: "The Quarry Warden's Gate", z: -18, state: "sealed" },
  ].map((door) => ({
    door,
    threshold: createDungeonDoorThreshold({
      id: door.id, position: [36, door.z], rotationY: 0, minX: -6, maxX: 6, wallHeight: 6,
    }, heightAt),
  }));
  const entities = thresholds.flatMap(({ door, threshold }) => createDungeonDoorEntities(threshold, {
    regionId: "fallowmarch", tier: 1, name: door.name, state: door.state,
    lockedReason: door.id === "gravelmaw_stone_door" ? "Three stone levers hold it." : "The Quarry Warden's Gate is sealed.",
  }));
  const solids: SolidVolume[] = thresholds.flatMap(({ threshold }) => threshold.staticSolids);
  const enclosure: DungeonDoorFixture["enclosure"] = [];
  for (const [index, definition] of [
    { x: 36, z: 6, width: 13.2, yaw: 0 },
    { x: 36, z: -30, width: 13.2, yaw: 0 },
    { x: 30, z: -12, width: 37.2, yaw: Math.PI / 2 },
    { x: 42, z: -12, width: 37.2, yaw: Math.PI / 2 },
  ].entries()) {
    const cos = Math.cos(definition.yaw);
    const sin = Math.sin(definition.yaw);
    const origin: Vec3 = [definition.x, heightAt(definition.x, definition.z), definition.z];
    const ground = (x: number, z: number): number => heightAt(
      origin[0] + x * cos + z * sin, origin[2] - x * sin + z * cos,
    ) - origin[1] - 0.5;
    const wall = {
      id: `feature-lab:door-enclosure:${index}`, origin, rotationY: definition.yaw,
      minX: -definition.width / 2, maxX: definition.width / 2, bottomAt: ground, height: 6,
    };
    enclosure.push(wall);
    const samples = [ground(wall.minX, -0.6), ground(wall.minX, 0.6),
      ground(wall.maxX, -0.6), ground(wall.maxX, 0.6), ground(0, 0)];
    const bottom = Math.min(...samples);
    solids.push({
      kind: "box", id: wall.id,
      position: [origin[0], origin[1] + bottom, origin[2]],
      size: [definition.width, Math.max(...samples) + wall.height - bottom, 1.2],
      rotationY: definition.yaw,
    });
  }
  const routeNodes: RouteNode[] = [0, -12, -24].map((z, index) => ({
    id: `feature-lab:door-room:${index + 1}`, name: `Gate fixture chamber ${index + 1}`,
    regionId: "fallowmarch", position: [36, heightAt(36, z), z],
  }));
  const routeEdges: RouteEdge[] = [];
  for (let index = 1; index < routeNodes.length; index += 1) {
    const first = routeNodes[index - 1]!;
    const second = routeNodes[index]!;
    routeEdges.push({ from: first.id, to: second.id, cost: 12 / 4.2, kind: "walk" },
      { from: second.id, to: first.id, cost: 12 / 4.2, kind: "walk" });
  }
  return { entities, solids, thresholds: thresholds.map(({ threshold }) => threshold), routeNodes, routeEdges, enclosure };
}

/** Diagnostic controls use the same state writer as quests; real movement and queries stay live. */
export function createDungeonDoorWorkbench(fixture: DungeonDoorFixture, deps: {
  entities: { get(id: EntityId): SemanticEntity | undefined };
  doors: DungeonDoors;
  playerPosition: () => Vec3;
  setDoorState: (id: EntityId, state: string) => boolean;
  navigation: Pick<Navigation, "findPathDetailed" | "planRoute">;
}) {
  function getState() {
    const closed = new Set(deps.doors.getSolids().map((solid) => solid.id));
    return {
      playerPosition: [...deps.playerPosition()],
      doors: fixture.thresholds.map((threshold) => {
        const entity = deps.entities.get(threshold.id);
        return { id: threshold.id, state: entity?.state ?? "missing", blocked: closed.has(threshold.id),
          position: entity?.position ?? threshold.origin, assetId: entity?.view?.assetId ?? null };
      }),
      routes: fixture.routeEdges.filter((_, index) => index % 2 === 0).map((edge) => {
        const from = fixture.routeNodes.find((node) => node.id === edge.from)!;
        const to = fixture.routeNodes.find((node) => node.id === edge.to)!;
        const path = deps.navigation.findPathDetailed(from.position, to.position);
        return { from: from.id, to: to.id, reachable: !!path && !path.partial,
          arrivalGap: path?.arrivalGap ?? null, endpoint: path?.path.at(-1) ?? null,
          graphReachable: deps.navigation.planRoute(from.id, to.id, 1) !== null };
      }),
    };
  }
  return {
    getState,
    setState(id: EntityId, state: string) {
      if (!fixture.thresholds.some((threshold) => threshold.id === id)) throw new Error(`Unknown fixture door: ${id}`);
      if (!["locked", "sealed", "closed", "unbarred", "open"].includes(state)) throw new Error(`Invalid door state: ${state}`);
      if (!deps.setDoorState(id, state)) throw new Error(`Fixture door is unavailable: ${id}`);
      return getState();
    },
  };
}
