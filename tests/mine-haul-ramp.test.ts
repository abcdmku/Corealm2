import { describe, expect, it, vi } from "vitest";
import { WORLD_SITES, worldSitePoint, type WorldSite } from "../game/src/content/worldSites.js";
import { applyWorldSiteTerrain, worldSiteHaulRamp } from "../game/src/world/siteTerrain.js";

const mines = WORLD_SITES.filter((site) => site.kind === "mine");

function point(site: WorldSite, along: number, across = 0): readonly [number, number] {
  const angle = site.terrain.approachAngle;
  return worldSitePoint(site, Math.sin(angle) * along + Math.cos(angle) * across,
    Math.cos(angle) * along - Math.sin(angle) * across);
}

function terrain(site: WorldSite, alongGrade: number, acrossGrade: number, base = 10) {
  const yaw = site.rotationY + site.terrain.approachAngle;
  return (x: number, z: number) => {
    const dx = x - site.centre[0], dz = z - site.centre[1];
    return base + alongGrade * (dx * Math.sin(yaw) + dz * Math.cos(yaw))
      + acrossGrade * (dx * Math.cos(yaw) - dz * Math.sin(yaw));
  };
}

function latticeHeight(height: (x: number, z: number) => number, x: number, z: number,
  phaseX: number, phaseZ: number): number {
  const x0 = Math.floor((x - phaseX) / 2) * 2 + phaseX;
  const z0 = Math.floor((z - phaseZ) / 2) * 2 + phaseZ;
  const tx = (x - x0) / 2, tz = (z - z0) / 2;
  return (height(x0, z0) * (1 - tx) + height(x0 + 2, z0) * tx) * (1 - tz)
    + (height(x0, z0 + 2) * (1 - tx) + height(x0 + 2, z0 + 2) * tx) * tz;
}

describe("finite mine haul ramps", () => {
  it("shares an endpoint in the authored approach direction within the site boundary", () => {
    for (const site of mines) {
      const ramp = worldSiteHaulRamp(site);
      const yaw = site.rotationY + site.terrain.approachAngle;
      expect(ramp.startDistance, site.id).toBeGreaterThanOrEqual(4);
      expect(ramp.endDistance, site.id).toBeGreaterThan(ramp.startDistance);
      expect(ramp.endDistance, site.id).toBeLessThanOrEqual(site.terrain.floorRadius + 5);
      expect(Math.abs(ramp.localEnd[0]), site.id).toBeLessThanOrEqual(site.extent[0] - 2.4 + 1e-10);
      expect(Math.abs(ramp.localEnd[1]), site.id).toBeLessThanOrEqual(site.extent[1] - 2.4 + 1e-10);
      expect(ramp.worldEnd[0] - site.centre[0], site.id).toBeCloseTo(Math.sin(yaw) * ramp.endDistance, 10);
      expect(ramp.worldEnd[1] - site.centre[1], site.id).toBeCloseTo(Math.cos(yaw) * ramp.endDistance, 10);
      expect(ramp.worldEnd).toEqual(worldSitePoint(site, ...ramp.localEnd));
      expect(ramp.halfWidth).toBeGreaterThan(2);
      expect(ramp.outerHalfWidth).toBeGreaterThan(ramp.halfWidth);
    }
    // Upper Seam's approach crosses its local side before its +Z extent.
    const upper = mines.find((site) => site.id === "upper_seam_shelf")!;
    expect(Math.abs(worldSiteHaulRamp(upper).localEnd[0])).toBeGreaterThan(10);
  });

  it("joins both the working floor and incoming terrain without a height or slope lip", () => {
    const epsilon = 0.0001;
    for (const site of mines) for (const incomingOffset of [0, 3]) {
      const sites = [site];
      const ramp = worldSiteHaulRamp(site);
      const natural = terrain(site, 0.08, -0.03);
      // Settlement flattening can change the input independently of the stable natural reference.
      const incoming = terrain(site, 0.06, 0.02, 10 + incomingOffset);
      const sample = (along: number, across: number) => {
        const [x, z] = point(site, along, across);
        return applyWorldSiteTerrain(x, z, incoming(x, z), sites, natural);
      };
      for (const across of [-1.2, 0, 1.2]) {
        const label = `${site.id}, across ${across}, incoming offset ${incomingOffset}`;
        const floor = 10 - Math.min(2.3, Math.max(1.3, site.terrain.backRise * 0.35));
        const start = sample(ramp.startDistance, across);
        expect(start, label).toBeCloseTo(floor - 0.02 * ramp.startDistance, 9);
        expect((start - sample(ramp.startDistance - epsilon, across)) / epsilon, label).toBeCloseTo(-0.02, 5);
        expect((sample(ramp.startDistance + epsilon, across) - start) / epsilon, label).toBeCloseTo(-0.02, 5);
        const end = sample(ramp.endDistance, across);
        expect(end, label).toBeCloseTo(incoming(...point(site, ramp.endDistance, across)), 9);
        expect((end - sample(ramp.endDistance - epsilon, across)) / epsilon, label).toBeCloseTo(0.06, 5);
        expect((sample(ramp.endDistance + epsilon, across) - end) / epsilon, label).toBeCloseTo(0.06, 5);
      }
    }
  });

  it("does not resume the old cut beyond the internal endpoint or request a terrain reference there", () => {
    for (const site of mines) {
      const sites = [site];
      const ramp = worldSiteHaulRamp(site);
      const lookup = vi.fn(() => { throw new Error("finished ramp sampled natural terrain"); });
      for (const distance of [0.01, 0.25, 1, 3]) for (const across of [-1.2, 0, 1.2]) {
        const [x, z] = point(site, ramp.endDistance + distance, across);
        expect(applyWorldSiteTerrain(x, z, 37.125, sites, lookup), site.id).toBe(37.125);
      }
      expect(lookup).not.toHaveBeenCalled();
    }
  });

  it("fades an overlapping ramp out continuously without changing site-order behavior", () => {
    const site = mines[0]!;
    const longer: WorldSite = { ...site, id: "overlapping_longer_ramp",
      terrain: { ...site.terrain, floorRadius: site.terrain.floorRadius + 2, backRise: site.terrain.backRise + 2 } };
    const sites = [site, longer];
    const reversed = [longer, site];
    const natural = terrain(site, 0.04, 0);
    const end = worldSiteHaulRamp(site).endDistance;
    const sample = (along: number, list = sites) => {
      const [x, z] = point(site, along);
      return applyWorldSiteTerrain(x, z, natural(x, z), list, natural);
    };
    expect(Math.abs(sample(end + 0.00001) - sample(end - 0.00001))).toBeLessThan(0.0001);
    for (const along of [4, end - 1, end, end + 1]) {
      expect(sample(along)).toBeCloseTo(sample(along, reversed), 12);
    }
  });

  it("keeps the clear lane below a bank-like grade before and after 2 m terrain interpolation", () => {
    const step = 0.25;
    for (const site of mines) for (const alongGrade of [-0.08, 0, 0.08]) {
      const sites = [site];
      const ramp = worldSiteHaulRamp(site);
      const natural = terrain(site, alongGrade, alongGrade === 0 ? 0 : 0.03);
      const analytic = (x: number, z: number) => applyWorldSiteTerrain(x, z, natural(x, z), sites, natural);
      const profiles = [analytic];
      for (const phaseX of [0, 0.5, 1, 1.5]) for (const phaseZ of [0, 0.5, 1, 1.5]) {
        profiles.push((x, z) => latticeHeight(analytic, x, z, phaseX, phaseZ));
      }
      let steepest = 0;
      for (const sample of profiles) for (const across of [-0.8, 0, 0.8]) {
        let previous = sample(...point(site, 0, across));
        for (let along = step; along <= ramp.endDistance + 2; along += step) {
          const height = sample(...point(site, along, across));
          steepest = Math.max(steepest, Math.abs(height - previous) / step);
          previous = height;
        }
      }
      // Flat ground previously developed a 28–35 degree exit bank. The authored lane stays
      // below 22 degrees; mild regional slopes have a separate bound rather than being flattened.
      expect(steepest, `${site.id}, incoming grade ${alongGrade}`).toBeLessThan(alongGrade === 0 ? 0.4 : 0.55);
    }
  });
});
