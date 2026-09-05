import { describe, expect, it } from "vitest";
import { REGIONS } from "../game/src/content/regions.js";
import { buildWorld } from "../game/src/world/regionBuilder.js";

describe("Marchfield homestead", () => {
  const fallowmarch = REGIONS.find((region) => region.id === "fallowmarch")!;

  it("restores the decorative farmhouse without restoring farming gameplay", () => {
    const farmstead = fallowmarch.landmarks.find((landmark) => landmark.id === "marchfield_farmstead");
    expect(farmstead?.composition).toBe("farm_yard");
    expect(fallowmarch.locations.find((location) => location.id === "marchfield")?.kind).toBe("landmark");
    expect(fallowmarch.clusters.some((cluster) => cluster.id.includes("plot"))).toBe(false);

    const world = buildWorld(1337, () => 0);
    expect(world.entities.some((entity) => entity.id.startsWith("marchfield_farmstead#barn_"))).toBe(true);
    expect(world.entities.filter((entity) => entity.id.startsWith("marchfield_farmstead#fence_hen_")))
      .toHaveLength(12);
    expect(world.entities.some((entity) => entity.archetype === ("farm_plot" as never))).toBe(false);
  });

  it("starts a large hen flock inside the second pen and keeps cattle beside the farmstead", () => {
    const hens = fallowmarch.enemyGroups.find((group) => group.id === "marchfield_hens")!;
    const cattle = fallowmarch.enemyGroups.find((group) => group.id === "redsill_cattle")!;

    expect(hens.count).toBe(12);
    expect(hens.centre).toEqual([-93, -21]);
    expect(hens.radius).toBeLessThanOrEqual(2.1);
    expect(cattle.count).toBe(4);
    expect(cattle.name).toBe("Cow");
    expect(Math.hypot(cattle.centre[0] + 96, cattle.centre[1] + 22)).toBeLessThan(20);

    const world = buildWorld(1337, () => 0);
    expect(world.entities.filter((entity) => entity.meta?.groupId === "marchfield_hens")).toHaveLength(12);
    expect(world.entities.filter((entity) => entity.meta?.groupId === "redsill_cattle")).toHaveLength(4);
  });
});
