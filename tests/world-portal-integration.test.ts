import { describe, expect, it } from "vitest";
import { buildWorld } from "../game/src/world/regionBuilder.js";
import { portalEntrance } from "../game/src/world/portalEntrance.js";
import { REGIONS } from "../game/src/content/regions.js";

describe("authored portal approaches", () => {
  it("uses grounded stance copies consistently before deriving route costs", () => {
    const height = (_region: string, x: number, z: number) => x * .003 + z * .002;
    const world = buildWorld(1337, height);
    const mouth = world.entities.find(e => e.id === "gravelmaw_mouth_portal")!;
    const exit = world.entities.find(e => e.id === "gravelmaw_exit_portal")!;
    const expected = portalEntrance(mouth, (x, z) => height(mouth.regionId, x, z));
    expect(mouth.interactionPosition).toEqual(expected.interactionPosition);
    expect(world.solids).toContainEqual(expected.solid);
    expect(world.solids.some(s => s.id === `${exit.id}:closed-recess`)).toBe(true);
    expect(world.routeNodes.find(n => n.id === "gravelmaw_entrance")?.position).toEqual(mouth.interactionPosition);
    expect(world.knownLocations.find(n => n.id === "gravelmaw_entrance")?.position).toEqual(mouth.interactionPosition);
    expect(world.routeEdges.find(e => e.portalId === mouth.id)?.entrance).toEqual(mouth.interactionPosition);
    const dungeon = REGIONS.find(r => r.dungeon)?.dungeon!;
    const centre = dungeon.chambers[0]!.centre;
    const towardCentre = [centre[0] - exit.position[0], centre[1] - exit.position[2]];
    const approach = exit.interactionPosition!;
    expect((approach[0] - exit.position[0]) * towardCentre[0]! + (approach[2] - exit.position[2]) * towardCentre[1]!).toBeGreaterThan(0);
    expect(world.routeEdges.find(e => e.portalId === mouth.id)?.exit).toEqual(world.routeNodes.find(n => n.id === "gravelmaw_chamber1")?.position);
  });
});
