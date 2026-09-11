import { describe, expect, it } from "vitest";
import { buildWorldTerrainSpec } from "../game/src/app/worldSpec.js";
import { collectPavingStamps } from "../game/src/app/worldSurface.js";
import {
  ESSENCE_ALTAR_COURT_BLEND,
  ESSENCE_ALTAR_COURT_RADIUS,
  REGIONAL_ESSENCE_ALTARS,
  REGIONS,
} from "../game/src/content/regions.js";
import { buildWorld } from "../game/src/world/regionBuilder.js";

describe("regional Essence Altar mini-quests", () => {
  it("flattens and region-stone paves the complete imported ruin courts", () => {
    const terrain = buildWorldTerrainSpec();
    const paving = collectPavingStamps();

    for (const altar of Object.values(REGIONAL_ESSENCE_ALTARS)) {
      expect(terrain.flats).toContainEqual({
        x: altar.position[0],
        z: altar.position[1],
        radius: ESSENCE_ALTAR_COURT_RADIUS,
        blend: ESSENCE_ALTAR_COURT_BLEND,
      });
      expect(paving).toContainEqual({
        centre: altar.position,
        halfExtents: [ESSENCE_ALTAR_COURT_RADIUS, ESSENCE_ALTAR_COURT_RADIUS],
        rotationY: altar.rotationY,
        surface: "stone",
        kerb: false,
      });
    }
  });

  it("places one dormant altar and one imported ruin at each matching Essence Cache", () => {
    const world = buildWorld(1337, () => 0);
    const expectations = [
      ["fallowmarch", REGIONAL_ESSENCE_ALTARS.fallowmarch, "wind", "air_essence"],
      ["vellenwood", REGIONAL_ESSENCE_ALTARS.vellenwood, "earth", "earth_essence"],
      ["karrowmoor", REGIONAL_ESSENCE_ALTARS.karrowmoor, "water", "water_essence"],
      ["kilnhalt", REGIONAL_ESSENCE_ALTARS.kilnhalt, "fire", "fire_essence"],
    ] as const;

    const essenceStations = world.entities.filter((entity) => entity.meta?.essenceAltar === true);
    expect(essenceStations).toHaveLength(4);

    for (const [regionId, definition, element, essenceItemId] of expectations) {
      const region = REGIONS.find((candidate) => candidate.id === regionId)!;
      const cluster = region.clusters.find((candidate) => candidate.essenceElement === element)!;
      const altar = world.entities.find((entity) => entity.id === definition.id);
      const ruins = world.entities.find((entity) => (
        entity.regionId === regionId && entity.view?.assetId === "altar_ruins_site"
      ));
      const nodes = world.entities.filter((entity) => entity.id.startsWith(`${cluster.id}_`));

      expect(definition.position).toEqual(cluster.centre);
      expect(altar).toMatchObject({
        archetype: "station",
        regionId,
        state: "dormant",
        interactions: ["inspect", "awaken"],
        position: [cluster.centre[0], 0, cluster.centre[1]],
        station: { kind: "essence_altar", recipeIds: [...definition.recipeIds] },
        view: { assetId: "altar_ruins_altar", scale: 1 },
        meta: { essenceAltar: true, essenceElement: element },
      });
      expect(ruins).toMatchObject({
        archetype: "landmark",
        regionId,
        state: "dormant",
        position: [cluster.centre[0], 0, cluster.centre[1]],
        view: { assetId: "altar_ruins_site", scale: 1 },
        meta: {
          essenceAltarRuins: true,
          essenceAltarId: definition.id,
          essenceElement: element,
        },
      });
      expect(nodes).toHaveLength(5);
      for (const node of nodes) {
        expect(node.resource?.itemId).toBe(essenceItemId);
        const radius = Math.hypot(
          node.position[0] - cluster.centre[0],
          node.position[2] - cluster.centre[1],
        );
        expect(radius).toBeGreaterThanOrEqual(11.25);
        expect(radius).toBeLessThanOrEqual(12.75);
      }
      for (let first = 0; first < nodes.length; first += 1) {
        for (let second = first + 1; second < nodes.length; second += 1) {
          const separation = Math.hypot(
            nodes[first]!.position[0] - nodes[second]!.position[0],
            nodes[first]!.position[2] - nodes[second]!.position[2],
          );
          expect(separation).toBeGreaterThan(8);
        }
      }
    }
  });

  it("removes the superseded town Essence Altars", () => {
    const townStationIds = REGIONS.flatMap((region) => (
      (region.settlement?.stations ?? []).map((station) => station.id)
    ));
    expect(townStationIds.some((id) => id.includes("essence_altar"))).toBe(false);
  });
});
