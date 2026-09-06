import { describe, expect, it } from "vitest";
import { Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, Vector3 } from "three";
import { portalLandformHeight, type PortalLandform } from "../game/src/world/portalLandform.js";

const LOCAL: PortalLandform = { centre: [0, 0], rotationY: 0, floorY: 0 };
const AUTHORED: PortalLandform = { centre: [46, -24], rotationY: 1.05, floorY: 19 };

function point(x: number, z: number, landform: PortalLandform): [number, number] {
  const cos = Math.cos(landform.rotationY), sin = Math.sin(landform.rotationY);
  return [landform.centre[0] + x * cos + z * sin, landform.centre[1] - x * sin + z * cos];
}

function sample(x: number, z: number, height = 0): number {
  return portalLandformHeight(x, z, height, LOCAL);
}

function profile() {
  const step = 0.1;
  let maxOuterGrade = 0, maxCutGrade = 0;
  let outerAt: [number, number] = [0, 0];
  let cutAt: [number, number] = [0, 0];
  let maxHeight = 0;
  for (let zi = -200; zi <= 10; zi++) {
    const z = zi * step;
    for (let xi = -140; xi <= 140; xi++) {
      const x = xi * step;
      const height = sample(x, z);
      maxHeight = Math.max(maxHeight, height);
      const grade = Math.hypot(
        (sample(x + 0.025, z) - sample(x - 0.025, z)) / 0.05,
        (sample(x, z + 0.025) - sample(x, z - 0.025)) / 0.05,
      );
      // The protected recess deliberately cuts into the bank. The rest must return broadly.
      const cut = Math.abs(x) <= 8.2 && z >= -11.8 && z <= 0;
      if (cut && grade > maxCutGrade) { maxCutGrade = grade; cutAt = [x, z]; }
      if (!cut && grade > maxOuterGrade) { maxOuterGrade = grade; outerAt = [x, z]; }
    }
  }
  return { maxHeight, maxOuterGrade, outerAt, maxCutGrade, cutAt };
}

describe("authored portal host terrain", () => {
  it("supports the entrance corridor and paving on their common floor datum", () => {
    for (const landform of [LOCAL, AUTHORED]) {
      for (const x of [-2.4, -1.96, -1, 0, 1, 1.96, 2.4]) {
        for (let step = 0; step <= 60; step++) {
          const z = -6.2 + step * 0.18;
          const height = landform.floorY + x * 0.01 + z * 0.02;
          const [wx, wz] = point(x, z, landform);
          expect(portalLandformHeight(wx, wz, height, landform)).toBeCloseTo(landform.floorY, 10);
        }
      }
      const [wx, wz] = point(0, 14, landform);
      expect(portalLandformHeight(wx, wz, 17.25, landform)).toBe(17.25);
    }
    // The accepted recess ends at -5.555 m, leaving 0.645 m before the terrain closes behind it.
    expect(sample(0, -5.555)).toBe(0);
    expect(sample(0, -6.2)).toBe(0);
    expect(sample(0, -8.5)).toBeGreaterThan(0);
    expect(sample(0, -12)).toBeGreaterThan(8);
  });

  it("places one smooth rear crest and unequal shoulders within the bounded footprint", () => {
    expect(sample(0, -12)).toBeCloseTo(8.2, 12);
    expect(sample(-6.8, -3.5)).toBeGreaterThan(sample(6.8, -3.5) + 0.2);
    expect(sample(-6.8, -3.5)).toBeGreaterThan(1.8);
    for (const [x, z] of [[-12, -10], [12, -10], [0, -20], [-20, -4], [20, -4], [0, 14]]) {
      expect(sample(x!, z!, -2)).toBe(-2);
    }
    // The ridge has curvature, and the outer contour approaches the unchanged ground gradually.
    expect(sample(0, -13)).toBeLessThan(sample(0, -12) - 0.25);
    expect(sample(0, -13)).toBeGreaterThan(sample(0, -15));
    expect(sample(0, -15)).toBeGreaterThan(sample(0, -17));
    expect(sample(0, -19)).toBeLessThan(0.3);
  });

  it("returns with zero edge slope and no step beside the protected approach", () => {
    const epsilon = 0.001;
    for (const x of [-8, -6, -4, 4, 6, 8]) {
      expect(Math.abs(sample(x, -epsilon) - sample(x, epsilon)) / (2 * epsilon)).toBeLessThan(0.01);
    }
    for (const z of [-6, -4, -2]) {
      expect(sample(2.4 - epsilon, z)).toBe(0);
      expect(sample(2.4 + epsilon, z) / epsilon).toBeLessThan(0.01);
    }
    expect(sample(0, -6.2 - epsilon) / epsilon).toBeLessThan(0.01);
    expect(sample(0, -20 + epsilon) / epsilon).toBeLessThan(0.01);
  });

  it("preserves higher natural ground and rotates the complete bank with the portal", () => {
    for (let x = -14; x <= 14; x += 0.5) {
      for (let z = -20; z <= 2; z += 0.5) {
        const natural = x * 0.02 - z * 0.03;
        const expected = sample(x, z, natural);
        const [wx, wz] = point(x, z, AUTHORED);
        expect(portalLandformHeight(wx, wz, AUTHORED.floorY + natural, AUTHORED) - AUTHORED.floorY)
          .toBeCloseTo(expected, 10);
        if (Math.abs(x) >= 8.2 || z <= -11.8 || z >= 10.4) {
          expect(expected).toBeGreaterThanOrEqual(natural);
          expect(sample(x, z, 12)).toBe(12);
        }
      }
    }
  });

  it("bounds the outer bank grade while retaining the intended recessed cut", () => {
    const result = profile();
    expect(result.maxHeight).toBeCloseTo(8.2, 10);
    expect(result.maxOuterGrade, JSON.stringify(result)).toBeLessThan(1.65);
    expect(result.maxCutGrade, JSON.stringify(result)).toBeLessThan(4.9);
    expect(result.maxCutGrade).toBeGreaterThan(result.maxOuterGrade);
  });

  it.each([0, 0.15, -0.2, 0.4])("keeps recess and full paving clear on sampled sloping terrain, grade %s", (grade) => {
    // Production first fills an exact 2 m Float32 lattice, then bilinearly resamples it onto
    // chunks. The current 660 m world depth uses seven chunks with 47 quads each. Include both
    // interpolation stages before raycasting the actual Three triangles across the approach.
    const stepZ = 660 / 7 / 47;
    const geometry = new PlaneGeometry(32, stepZ * 16, 16, 16);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(48, 0, -200 + 88 * stepZ);
    const landform = { ...AUTHORED, floorY: 0 };
    const latticeSize = 19;
    const heights = new Float32Array(latticeSize * latticeSize);
    for (let z = 0; z < latticeSize; z++) {
      for (let x = 0; x < latticeSize; x++) {
        const wx = 30 + x * 2, wz = -42 + z * 2;
        const natural = (wx - 46) * grade + (wz + 24) * 0.12;
        heights[z * latticeSize + x] = portalLandformHeight(wx, wz, natural, landform);
      }
    }
    const latticeHeight = (x: number, z: number): number => {
      const fx = (x - 30) / 2, fz = (z + 42) / 2;
      const x0 = Math.floor(fx), z0 = Math.floor(fz);
      const tx = fx - x0, tz = fz - z0;
      const a = heights[z0 * latticeSize + x0]!;
      const b = heights[z0 * latticeSize + x0 + 1]!;
      const c = heights[(z0 + 1) * latticeSize + x0]!;
      const d = heights[(z0 + 1) * latticeSize + x0 + 1]!;
      const top = a + (b - a) * tx, bottom = c + (d - c) * tx;
      return top + (bottom - top) * tz;
    };
    const positions = geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      positions.setY(i, latticeHeight(positions.getX(i), positions.getZ(i)));
    }
    const material = new MeshBasicMaterial();
    const mesh = new Mesh(geometry, material);
    const ray = new Raycaster();
    try {
      let maxLift = 0;
      let worstAt: [number, number] = [0, 0];
      for (const x of [-2.2, -1.96, -1, 0, 1, 1.96, 2.2]) {
        for (const z of [-5.5, -4, -2, -1, 0, 1, 2, 4, 4.82]) {
          const [wx, wz] = point(x, z, landform);
          ray.set(new Vector3(wx, 100, wz), new Vector3(0, -1, 0));
          const hit = ray.intersectObject(mesh)[0];
          expect(hit).toBeDefined();
          if (hit!.point.y > maxLift) { maxLift = hit!.point.y; worstAt = [x, z]; }
        }
      }
      expect(maxLift, JSON.stringify({ maxLift, worstAt })).toBeLessThan(0.01);
    } finally {
      geometry.dispose();
      material.dispose();
    }
  });
});
