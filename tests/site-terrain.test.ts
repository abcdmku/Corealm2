import { describe, expect, it, vi } from "vitest";
import { WORLD_SITES, worldSitePoint, type WorldSite } from "../game/src/content/worldSites.js";
import { applyWorldSiteTerrain, worldSiteWorkFloorWeight } from "../game/src/world/siteTerrain.js";

const mine: WorldSite = {
  id: "test_workings", locationId: "test_seam", regionId: "fallowmarch",
  centre: [0, 0], rotationY: 0, kind: "mine", workRadius: 4, extent: [20, 18],
  terrain: { floorRadius: 8, backRise: 4, backDistance: 10, bermWidth: 6, approachAngle: 0 },
  resourceSlots: [], dressing: [],
};
const natural = (x: number, z: number) => 10 + 0.025 * x + 0.017 * z;

describe("authored mine terrain", () => {
  it("cuts the work floor below natural ground at every authored mine", () => {
    for (const site of WORLD_SITES.filter((candidate) => candidate.kind === "mine")) {
      const [x, z] = site.centre;
      const baseline = natural(x, z);
      const floor = applyWorldSiteTerrain(x, z, baseline, [site], natural);
      expect(floor, site.id).toBeLessThan(baseline - 1.2);
      expect(floor, site.id).toBeGreaterThanOrEqual(baseline - 2.3);
      // The natural reference must stay stable if settlement flattening changed this input.
      expect(applyWorldSiteTerrain(x, z, baseline + 3, [site], natural), site.id).toBeCloseTo(floor, 12);
    }
  });

  it("keeps every seam and mining stance on a continuous ledge after 2 m terrain interpolation", () => {
    for (const site of WORLD_SITES.filter((candidate) => candidate.kind === "mine")) {
      const sites = [site];
      const steepNatural = (x: number, z: number) => 10 + 0.08 * x + 0.04 * z;
      const analytic = (x: number, z: number) => applyWorldSiteTerrain(x, z, steepNatural(x, z), sites, steepNatural);
      for (const phaseX of [0, 0.5, 1, 1.5]) for (const phaseZ of [0, 0.5, 1, 1.5]) {
        const mesh = (x: number, z: number) => latticeHeight(analytic, x, z, phaseX, phaseZ);
        for (const slot of site.resourceSlots) {
          const [x, z] = worldSitePoint(site, slot.x, slot.z);
          const yaw = site.rotationY + slot.yaw;
          const forwardX = Math.sin(yaw); const forwardZ = Math.cos(yaw);
          const origin = mesh(x, z);
          const label = `${site.id}/${slot.clusterId}_${slot.index} lattice ${phaseX},${phaseZ}`;
          expect(Math.abs(mesh(x + forwardX * 2.3, z + forwardZ * 2.3) - origin), label).toBeLessThan(0.08);
          const slopeX = (mesh(x + 2, z) - mesh(x - 2, z)) / 4;
          const slopeZ = (mesh(x, z + 2) - mesh(x, z - 2)) / 4;
          expect(Math.hypot(slopeX, slopeZ), label).toBeLessThan(0.04);
          for (const across of [-1.3, 0, 1.3]) for (const depth of [-0.325, 0.325]) {
            const scale = slot.scale * 1.08;
            const footX = x + (Math.cos(yaw) * across + forwardX * depth) * scale;
            const footZ = z + (-Math.sin(yaw) * across + forwardZ * depth) * scale;
            expect(Math.abs(mesh(footX, footZ) - origin), label).toBeLessThan(0.08);
          }
        }
      }
    }
  });

  it("raises real hillside behind each backing strip, including the curved seam returns", () => {
    for (const site of WORLD_SITES.filter((candidate) => candidate.kind === "mine")) {
      const sites = [site];
      const analytic = (x: number, z: number) => applyWorldSiteTerrain(x, z, natural(x, z), sites, natural);
      for (const phase of [0, 0.5, 1, 1.5]) for (const slot of site.resourceSlots) {
        const [x, z] = worldSitePoint(site, slot.x, slot.z);
        const yaw = site.rotationY + slot.yaw;
        const station = site.cutFace!.stations.find((entry) => entry.clusterId === slot.clusterId && entry.index === slot.index)!;
        // Generated rear fracture sections range from 0.76 to 1.04 times authored backDepth.
        const rear = site.cutFace!.backDepth * 0.76;
        const rearGround = latticeHeight(analytic, x - Math.sin(yaw) * rear, z - Math.cos(yaw) * rear, phase, phase);
        const origin = latticeHeight(analytic, x, z, phase, phase);
        expect(rearGround - origin - station.crestHeight, `${site.id}/${slot.index}`).toBeGreaterThan(0.6);
      }
    }
  });

  it("preserves the nearby postern, wall footing, dungeon entrance and forward basin collar", () => {
    for (const [id, x, z] of [
      ["hollowcut_workings", 80, 138], ["hollowcut_workings", 80, 144],
      ["lower_quarry_bench", 46, -24], ["upper_seam_shelf", 206, -104],
    ] as const) {
      const site = WORLD_SITES.find((candidate) => candidate.id === id)!;
      const lookup = vi.fn(() => { throw new Error("protected neighbouring footprint sampled"); });
      expect(applyWorldSiteTerrain(x, z, 37.125, [site], lookup), id).toBe(37.125);
      expect(lookup).not.toHaveBeenCalled();
    }
  });

  it("leaves groves and fisheries untouched without requesting a terrain reference", () => {
    const decorative = WORLD_SITES.filter((site) => site.kind === "grove" || site.kind === "fishery");
    const lookup = vi.fn(() => { throw new Error("decorative site requested natural terrain"); });
    for (const site of decorative) {
      const [x, z] = site.centre;
      expect(applyWorldSiteTerrain(x, z, 37.125, decorative, lookup), site.id).toBe(37.125);
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it("does no work outside the oriented footprint, including inside its larger world bounding box", () => {
    const rotated = { ...mine, centre: [52, -31] as const, rotationY: Math.PI / 4 };
    const lookup = vi.fn(() => { throw new Error("out-of-bounds reference lookup"); });
    for (const site of [mine, rotated]) {
      for (const [x, z] of [[20.1, 0], [-20.1, 0], [0, 18.1], [0, -18.1], [21, 19]]) {
        const point = worldSitePoint(site, x!, z!);
        expect(applyWorldSiteTerrain(...point, 7.125, [site], lookup)).toBe(7.125);
      }
    }
    for (const [x, z] of [[20, 0], [-20, 0], [0, 18], [0, -18]]) {
      expect(applyWorldSiteTerrain(x!, z!, -3.25, [mine], lookup)).toBe(-3.25);
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it("joins the existing terrain with a continuous first derivative at all extent edges", () => {
    const step = 0.001;
    for (const yaw of [0, 0.71, -1.2]) {
      const site = { ...mine, rotationY: yaw, centre: [41, -22] as const };
      const sites = [site];
      for (const [edgeX, edgeZ, outwardX, outwardZ] of [
        [20, 0, 1, 0], [-20, 0, -1, 0], [0, 18, 0, 1], [0, -18, 0, -1],
      ] as const) {
        const height = (offset: number) => {
          const [x, z] = worldSitePoint(site, edgeX + offset * outwardX, edgeZ + offset * outwardZ);
          return applyWorldSiteTerrain(x, z, natural(x, z), sites, natural);
        };
        const edge = height(0);
        const inwardSlope = (edge - height(-step)) / step;
        const outwardSlope = (height(step) - edge) / step;
        expect(Math.abs(inwardSlope - outwardSlope), `yaw ${yaw}, edge ${edgeX},${edgeZ}`).toBeLessThan(0.005);
        const [x, z] = worldSitePoint(site, edgeX, edgeZ);
        expect(edge).toBe(natural(x, z));
      }
    }
  });

  it("rotates and translates the entire cut with the authored site frame", () => {
    const rotated = { ...mine, centre: [62, -48] as const, rotationY: 1.23 };
    const baseSites = [mine];
    const rotatedSites = [rotated];
    for (const [x, z] of [[0, 0], [0, -10], [0, 10], [-10, -3], [16, 8], [19.5, -4]]) {
      const [worldX, worldZ] = worldSitePoint(rotated, x!, z!);
      expect(applyWorldSiteTerrain(worldX, worldZ, 10, rotatedSites, () => 10))
        .toBeCloseTo(applyWorldSiteTerrain(x!, z!, 10, baseSites, () => 10), 12);
    }
  });

  it("follows the seam with wear and turns only the haul approach toward the authored road", () => {
    const site = WORLD_SITES.find((candidate) => candidate.id === "upper_seam_shelf")!;
    for (const slot of site.resourceSlots) {
      const forward = worldSitePoint(site, slot.x + Math.sin(slot.yaw) * 2.3, slot.z + Math.cos(slot.yaw) * 2.3);
      const rear = worldSitePoint(site, slot.x - Math.sin(slot.yaw) * 5, slot.z - Math.cos(slot.yaw) * 5);
      expect(worldSiteWorkFloorWeight(...forward, site)).toBeGreaterThan(0.8);
      expect(worldSiteWorkFloorWeight(...rear, site)).toBe(0);
    }
    const angle = site.terrain.approachAngle;
    expect(worldSiteWorkFloorWeight(...worldSitePoint(site, Math.sin(angle) * 3.5, Math.cos(angle) * 3.5), site)).toBeGreaterThan(0.3);
    expect(worldSiteWorkFloorWeight(...worldSitePoint(site, 0, 10), site)).toBe(0);
  });

  it("only requests natural references for mines containing the queried point", () => {
    const remote = { ...mine, id: "remote", centre: [200, 0] as const };
    const grove = { ...mine, id: "grove", kind: "grove" as const };
    const lookup = vi.fn(natural);
    applyWorldSiteTerrain(1, -2, 10, [mine, remote, grove], lookup);
    expect(lookup.mock.calls).toEqual([[0, 0]]);
  });

  it("anchors a mine beside a raised settlement to pre-site support without moving the haul endpoint", () => {
    const site = WORLD_SITES.find((candidate) => candidate.id === "hollowcut_workings")!;
    const sites = [site];
    // Retained production centre and approach heights from Hollowcut's failed world route.
    // The settlement blends uphill while the geological reference stays much lower.
    const raw = () => 2.0189841037;
    const support = (x: number, z: number) => {
      const along = (x - site.centre[0]) * Math.sin(site.rotationY)
        + (z - site.centre[1]) * Math.cos(site.rotationY);
      const t = Math.max(0, Math.min(1, along / 13.5));
      return 5.514058817 + (8.287293610 - 5.514058817) * (2 * t - t * t);
    };
    const sample = (along: number, fitted: boolean) => {
      const [x, z] = worldSitePoint(site, 0, along);
      return applyWorldSiteTerrain(x, z, support(x, z), sites, raw, fitted ? support : raw);
    };
    expect(sample(13.5, true)).toBeCloseTo(sample(13.5, false), 10);
    expect(sample(2, true)).toBeCloseTo(3.969058817, 8);
    let oldGrade = 0; let fittedGrade = 0;
    for (let along = 2.25; along <= 13.5; along += 0.25) {
      oldGrade = Math.max(oldGrade, Math.abs(sample(along, false) - sample(along - 0.25, false)) / 0.25);
      fittedGrade = Math.max(fittedGrade, Math.abs(sample(along, true) - sample(along - 0.25, true)) / 0.25);
    }
    expect(oldGrade).toBeGreaterThan(1);
    expect(fittedGrade).toBeLessThan(0.65);
  });

  it("makes overlapping cuts independent of site order and never excavates the same shape twice", () => {
    const shifted = { ...mine, id: "shifted", centre: [3, -2] as const,
      terrain: { ...mine.terrain, backRise: 5 } };
    const duplicate = { ...mine, id: "duplicate" };
    for (const [x, z] of [[0, 0], [0, -9], [15, 4], [18, 4], [-19, -3]]) {
      const initial = natural(x!, z!);
      const forward = applyWorldSiteTerrain(x!, z!, initial, [mine, shifted], natural);
      const reverse = applyWorldSiteTerrain(x!, z!, initial, [shifted, mine], natural);
      expect(forward, `order at ${x},${z}`).toBeCloseTo(reverse, 12);
      const solo = applyWorldSiteTerrain(x!, z!, initial, [mine], natural);
      const repeated = applyWorldSiteTerrain(x!, z!, initial, [mine, duplicate], natural);
      expect(repeated, `duplicate excavation at ${x},${z}`).toBeCloseTo(solo, 12);
    }
  });
});

function latticeHeight(height: (x: number, z: number) => number, x: number, z: number, phaseX: number, phaseZ: number): number {
  const x0 = Math.floor((x - phaseX) / 2) * 2 + phaseX;
  const z0 = Math.floor((z - phaseZ) / 2) * 2 + phaseZ;
  const tx = (x - x0) / 2; const tz = (z - z0) / 2;
  return (height(x0, z0) * (1 - tx) + height(x0 + 2, z0) * tx) * (1 - tz)
    + (height(x0, z0 + 2) * (1 - tx) + height(x0 + 2, z0 + 2) * tx) * tz;
}
