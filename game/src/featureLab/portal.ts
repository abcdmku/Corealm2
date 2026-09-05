import type { SemanticEntity, Vec3 } from "../contracts.js";
import type { RouteEdge, RouteNode } from "../systems/navigation.js";
import { portalEntrance } from "../world/portalEntrance.js";

export const PORTAL_LAB_CAVE_ORIGIN: Vec3 = [-36, -12, -36];

/** A real pair of masonry portals connects the production yard and enclosed cave fixture. */
export function assemblePortalFixture(heightAt: (x: number, z: number) => number, baseY: (id: string) => number) {
  const entities: SemanticEntity[] = [
    { id: "lab:portal:entry", archetype: "portal", name: "Stone Cavern", tier: 1,
      regionId: "fallowmarch", position: [18, heightAt(18, 10) - baseY("wall_brick_door") * 2.2, 10],
      state: "open", interactions: ["inspect", "enter"],
      view: { assetId: "wall_brick_door", scale: 2.2, rotationY: 0, labelHeight: 4 },
      meta: { featureLab: true, toLocationId: "lab:portal:inside", toRegionId: "gravelmaw" } },
    { id: "lab:portal:exit", archetype: "portal", name: "Return to the yard", tier: 1,
      regionId: "gravelmaw", position: [-36, -12 - baseY("wall_brick_door") * 1.2, -39],
      state: "open", interactions: ["inspect", "enter"],
      view: { assetId: "wall_brick_door", scale: 1.2, rotationY: 0, labelHeight: 3 },
      meta: { featureLab: true, toLocationId: "lab:portal:outside", toRegionId: "fallowmarch" } },
  ];
  const solids = entities.map((entity) => {
    const entrance = portalEntrance(entity, entity.regionId === "gravelmaw" ? () => -12 : heightAt);
    entity.interactionPosition = entrance.interactionPosition;
    return entrance.solid;
  });
  const routeNodes: RouteNode[] = [
    { id: "lab:portal:outside", name: "Cavern approach", regionId: "fallowmarch", position: entities[0]!.interactionPosition! },
    { id: "lab:portal:inside", name: "Cavern chamber", regionId: "gravelmaw", position: [...PORTAL_LAB_CAVE_ORIGIN] },
  ];
  const routeEdges: RouteEdge[] = [];
  return { entities, solids, routeNodes, routeEdges, entryId: entities[0]!.id, exitId: entities[1]!.id };
}
