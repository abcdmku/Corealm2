import type { RegionId, SemanticEntity, Vec3 } from "../contracts.js";
import type { GateDef, LocationDef } from "../content/regions.js";
import type { WorldTerrainSpec } from "../render/scene.js";
import {
  assembleGatePortal, authoredGatePortalLink, portalRouteEdge,
  type HeightAt, type RouteEdgeOut, type RouteNodeOut,
} from "../world/regionBuilder.js";

export const FAIRY_PORTAL_LAB_FLOOR = -120;
export const FAIRY_PORTAL_LAB_SPAWN: Vec3 = [2032, FAIRY_PORTAL_LAB_FLOOR, 0];

/** Build separately from the yard so the gap between maps never becomes walkable terrain. */
export const FAIRY_PORTAL_LAB_TERRAIN: WorldTerrainSpec = {
  bounds: { minX: 2000, maxX: 2080, minZ: -40, maxZ: 40 },
  chunkSize: 40, metresPerQuad: 2, blendMetres: 0,
  regions: [{ regionId: "gloamgarden", rect: { minX: 2000, maxX: 2080, minZ: -40, maxZ: 40 },
    seed: 3030, character: "plains", baseHeight: FAIRY_PORTAL_LAB_FLOOR, amplitude: 0 }],
};

/** Two ordinary authored gates exercise production travel between disjoint open terrain maps. */
export function assembleFairyPortalFixture(heightAt: HeightAt, baseY: (id: string) => number) {
  const definitions: { gate: GateDef; regionId: "fallowmarch" | "gloamgarden"; tier: number }[] = [
    { regionId: "fallowmarch", tier: 40, gate: {
      id: "lab:fairy:entry", name: "Gloamgarden Portal", position: [18, 10], assetId: "wall_brick_door",
      toRegionId: "gloamgarden", toLocationId: "lab:fairy:inside", rotationY: 0,
    } },
    { regionId: "gloamgarden", tier: 30, gate: {
      id: "lab:fairy:exit", name: "Return to the Yard", position: [2032, -8], assetId: "wall_brick_door",
      toRegionId: "fallowmarch", toLocationId: "lab:fairy:outside", rotationY: 0,
    } },
  ];
  const portals = definitions.map(definition => assembleGatePortal(
    definition.gate, definition.regionId, definition.tier, heightAt, baseY,
  ));
  const entities: SemanticEntity[] = portals.map(portal => ({ ...portal.entity,
    meta: { ...portal.entity.meta, featureLab: true, fairyPortal: true } }));
  const routeNodes: RouteNodeOut[] = definitions.map((definition, index) => ({
    id: definition.gate.id, name: definition.gate.name, regionId: definition.regionId,
    position: entities[index]!.interactionPosition!,
  }));
  routeNodes.push(
    { id: "lab:fairy:outside", name: "Yard Arrival", regionId: "fallowmarch", position: [18, heightAt("fallowmarch", 18, 18), 18] },
    { id: "lab:fairy:inside", name: "Gloamgarden Arrival", regionId: "gloamgarden", position: [2032, heightAt("gloamgarden", 2032, 0), 0] },
  );
  const routeEdges: RouteEdgeOut[] = definitions.map((definition, index) => {
    const entity = entities[index]!;
    const source = routeNodes.find(node => node.id === entity.id)!;
    const target = routeNodes.find(node => node.id === definition.gate.toLocationId)!;
    const locations: LocationDef[] = [{ id: source.id, name: source.name,
      position: definition.gate.position, kind: "gate", routeNode: true }];
    const link = authoredGatePortalLink(definition.gate, entity, locations)!;
    return portalRouteEdge(link, source.position, target.position);
  });
  for (const [gateId, arrivalId] of [["lab:fairy:entry", "lab:fairy:outside"], ["lab:fairy:exit", "lab:fairy:inside"]]) {
    const gate = routeNodes.find(node => node.id === gateId)!;
    const arrival = routeNodes.find(node => node.id === arrivalId)!;
    const cost = Math.hypot(gate.position[0] - arrival.position[0], gate.position[2] - arrival.position[2]) / 4.2;
    routeEdges.push({ from: gate.id, to: arrival.id, cost, kind: "walk" },
      { from: arrival.id, to: gate.id, cost, kind: "walk" });
  }
  return { entities, solids: portals.flatMap(portal => portal.solids), routeNodes, routeEdges,
    knownLocations: routeNodes.map(node => ({ ...node })), entryId: entities[0]!.id, exitId: entities[1]!.id };
}

/** The workbench issues ordinary interactions, including normal distance and transition checks. */
export function createFairyPortalWorkbench(
  fixture: ReturnType<typeof assembleFairyPortalFixture>,
  ports: { interact(id: string): unknown; player(): { regionId: RegionId; position: Vec3 } },
) {
  const panel = document.createElement("section");
  panel.dataset.testid = "fairy-portal-workbench";
  panel.setAttribute("aria-label", "Fairy portal lab");
  panel.style.cssText = "position:fixed;right:18px;bottom:22px;z-index:900;padding:12px;max-width:310px;background:#131c2deb;color:#e4fff9;border:1px solid #68d0c4;border-radius:8px;font:13px sans-serif;pointer-events:auto";
  const title = document.createElement("strong");
  title.textContent = "Fairy portal lab";
  panel.append(title);
  let lastResult: unknown = null;
  const readout = document.createElement("pre");
  readout.style.cssText = "margin:10px 0 0;white-space:pre-wrap;font:12px monospace;overflow-wrap:anywhere";
  const getState = () => ({ entryId: fixture.entryId, exitId: fixture.exitId,
    player: { ...ports.player(), position: [...ports.player().position] }, result: lastResult });
  const refresh = () => {
    const state = getState();
    readout.textContent = `${state.player.regionId}\n${state.player.position.map(value => value.toFixed(1)).join(", ")}`
      + (lastResult === null ? "\nWalk to an arch to enter." : `\n${JSON.stringify(lastResult)}`);
  };
  for (const [id, label, testId] of [
    [fixture.entryId, "Enter fairy portal", "fairy-portal-enter"],
    [fixture.exitId, "Return through portal", "fairy-portal-return"],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label!;
    button.dataset.testid = testId;
    button.style.cssText = "display:block;width:100%;margin-top:8px;padding:8px;background:#263b51;color:#e4fff9;border:1px solid #729baf;border-radius:4px;cursor:pointer";
    button.addEventListener("click", () => {
      void Promise.resolve(ports.interact(id!)).then(result => { lastResult = result; refresh(); });
    });
    panel.append(button);
  }
  panel.append(readout);
  document.body.append(panel);
  refresh();
  const interval = window.setInterval(refresh, 250);
  return { getState, refresh, dispose() { window.clearInterval(interval); panel.remove(); } };
}
