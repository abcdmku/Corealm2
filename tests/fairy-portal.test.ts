import { describe, expect, it } from "vitest";
import { SKILL_IDS, worldMapForRegion, type SkillId } from "../game/src/contracts.js";
import type { GateDef, LocationDef } from "../game/src/content/regions.js";
import { EventBus } from "../game/src/core/events.js";
import { SimClock } from "../game/src/core/time.js";
import { assembleFairyPortalFixture, FAIRY_PORTAL_LAB_TERRAIN } from "../game/src/featureLab/fairyPortal.js";
import { Store } from "../game/src/state/store.js";
import { Solids } from "../game/src/systems/solids.js";
import { TravelSystem } from "../game/src/systems/travel.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";
import { assembleGatePortal, authoredGatePortalLink } from "../game/src/world/regionBuilder.js";

const heightAt = (regionId: string) => regionId === "gloamgarden" ? -120 : 8;

describe("fairy map portal", () => {
  it("crosses to an independent open map and returns through the production interaction", () => {
    const fixture = assembleFairyPortalFixture(heightAt, () => 0);
    const store = new Store(5, 0);
    const entities = { get: (id: string) => fixture.entities.find(entity => entity.id === id), all: () => fixture.entities };
    const dispatcher = new InteractionDispatcher({ get: entities.get,
      playerPosition: () => store.get().player.position,
      skillLevels: () => Object.fromEntries(SKILL_IDS.map(id => [id, 1])) as Record<SkillId, number> });
    new TravelSystem({ store, events: new EventBus(), clock: new SimClock(), entities, dispatcher,
      nav: { closestPoint: point => point, routeNode: id => fixture.routeNodes.find(node => node.id === id) },
      place: (position, regionId) => { store.get().player.position = position; store.get().player.regionId = regionId; } });
    const entry = entities.get(fixture.entryId)!;
    store.get().player.position = entry.interactionPosition!;
    expect(dispatcher.run(entry.id, "enter").ok).toBe(true);
    expect(store.get().player.regionId).toBe("gloamgarden");
    expect(store.get().player.position).toEqual([2032, -120, 0]);
    expect(store.get().discovery.locations["lab:fairy:inside"]).toBeDefined();
    // Arrival has room to walk off the gate, and returning still requires approaching it.
    expect(dispatcher.run(fixture.exitId, "enter")).toMatchObject({ ok: false, error: { code: "OUT_OF_RANGE" } });
    store.get().player.position = entities.get(fixture.exitId)!.interactionPosition!;
    expect(dispatcher.run(fixture.exitId, "enter").ok).toBe(true);
    expect(store.get().player.regionId).toBe("fallowmarch");
    expect(store.get().player.position).toEqual([18, 8, 18]);
    expect(FAIRY_PORTAL_LAB_TERRAIN.bounds.minX).toBeGreaterThan(128);
    expect(FAIRY_PORTAL_LAB_TERRAIN.regions[0]!.character).toBe("plains");
  });

  it("uses reciprocal portal graph edges and leaves the approaches and arrivals clear", () => {
    const fixture = assembleFairyPortalFixture(heightAt, () => 0);
    const solids = new Solids(fixture.solids);
    for (const entity of fixture.entities) {
      const edge = fixture.routeEdges.find(candidate => candidate.portalId === entity.id)!;
      const destination = fixture.routeNodes.find(node => node.id === entity.meta!.toLocationId)!;
      expect(edge.kind).toBe("portal");
      expect(edge.entrance).toEqual(entity.interactionPosition);
      expect(edge.exit).toEqual(destination.position);
      expect(edge.cost).toBeGreaterThan(0);
      expect(worldMapForRegion(entity.regionId)).not.toBe(worldMapForRegion(destination.regionId));
      for (const point of [entity.interactionPosition!, destination.position]) {
        expect(solids.resolve(point, point, .35)).toEqual(point);
      }
    }
    for (const edge of fixture.routeEdges.filter(edge => edge.kind === "walk")) {
      const from = fixture.routeNodes.find(node => node.id === edge.from)!;
      const to = fixture.routeNodes.find(node => node.id === edge.to)!;
      expect(worldMapForRegion(from.regionId)).toBe(worldMapForRegion(to.regionId));
    }
  });

  it("chooses an authored local gate node while leaving ordinary region gates unchanged", () => {
    const gate: GateDef = { id: "crownward_fairy_gate", name: "Fairy Gate", position: [470, 100],
      assetId: "wall_brick_door", toRegionId: "gloamgarden", toLocationId: "gloamgarden_arrival" };
    const locations: LocationDef[] = [
      { id: "distant", name: "Distant", position: [600, 200], kind: "gate", routeNode: true },
      { id: "arrival", name: "Arrival", position: [470, 108], kind: "gate", routeNode: true },
      { id: gate.id, name: gate.name, position: gate.position, kind: "gate", routeNode: true },
    ];
    const portal = assembleGatePortal(gate, "crownward", 40, heightAt, () => -.2);
    expect(authoredGatePortalLink(gate, portal.entity, locations)?.fromLocationId).toBe(gate.id);
    expect(authoredGatePortalLink(gate, portal.entity, locations.slice(0, 2))?.fromLocationId).toBe("arrival");
    expect(() => authoredGatePortalLink(gate, portal.entity, [])).toThrow("no local route node");
    const ordinary = { ...gate, toRegionId: "fallowmarch" as const };
    const surfacePortal = assembleGatePortal(ordinary, "crownward", 40, heightAt, () => 0);
    expect(surfacePortal.solids).toEqual([]);
    expect(surfacePortal.entity.interactionPosition).toBeUndefined();
    expect(authoredGatePortalLink(ordinary, surfacePortal.entity, locations)).toBeNull();
  });
});
