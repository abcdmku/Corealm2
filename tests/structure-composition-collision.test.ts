import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SolidVolume, Vec3 } from "../game/src/contracts.js";
import { buildComposition, COMPOSITION_IDS, KIT_IDS, type PartPlacement } from "../game/src/render/buildings.js";
import {
  structureCollisionFromCompositionParts,
  type StructureAssetMeasurements,
} from "../game/src/world/regionBuilder.js";

type Box = Extract<SolidVolume, { kind: "box" }>;
interface AssetRow {
  id: string;
  size: { x: number; y: number; z: number };
  base: { x: number; y: number; z: number };
}
const manifest = JSON.parse(readFileSync(
  new URL("../game/public/assets/manifest.json", import.meta.url), "utf8",
)) as { assets: AssetRow[] };
const assets = new Map(manifest.assets.map((asset) => [asset.id, asset]));
const measurements: StructureAssetMeasurements = {
  assetSize: (id) => assets.get(id)?.size ?? null,
  assetCenterXZ: (id) => {
    const asset = assets.get(id);
    return asset ? {
      x: asset.base.x + asset.size.x / 2,
      z: asset.base.z + asset.size.z / 2,
    } : null;
  },
};

function worldPoint(x: number, z: number, origin: Vec3, yaw: number): Vec3 {
  return [
    origin[0] + x * Math.cos(yaw) + z * Math.sin(yaw),
    origin[1],
    origin[2] - x * Math.sin(yaw) + z * Math.cos(yaw),
  ];
}

/** A walking capsule's horizontal clearance against the production oriented boxes. */
function obstructs(box: Box, point: Vec3, radius = 0): boolean {
  const dx = point[0] - box.position[0];
  const dz = point[2] - box.position[2];
  const x = dx * Math.cos(box.rotationY) - dz * Math.sin(box.rotationY);
  const z = dx * Math.sin(box.rotationY) + dz * Math.cos(box.rotationY);
  const gapX = Math.max(0, Math.abs(x) - box.size[0] / 2);
  const gapZ = Math.max(0, Math.abs(z) - box.size[2] / 2);
  return Math.hypot(gapX, gapZ) <= radius;
}

describe("production composition collision", () => {
  it.each(KIT_IDS)("keeps every %s gate variant open through both stretched arch ribs", (kit) => {
    const origin: Vec3 = [37, 4, -21];
    const variants = new Set<string>();
    for (const seed of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const parts = buildComposition("region_gate", seed, kit);
      variants.add(parts.some((part) => part.tag === "wicket_leaf") ? "wicket" :
        parts.some((part) => part.tag === "torch_left") ? "torches" : "standards");
      for (const rotationY of [0, -0.73, 1.4]) {
        const solids = structureCollisionFromCompositionParts("region_gate", parts, {
          origin, rotationY, ownerId: "gate",
        }, measurements) as Box[];
        for (let z = -3; z <= 3; z += 0.1) {
          const player = worldPoint(0, z, origin, rotationY);
          expect(solids.filter((solid) => obstructs(solid, player, 0.35)),
            `${kit} seed ${seed} yaw ${rotationY} blocks crossing at ${z}`).toEqual([]);
        }
        for (const part of parts.filter((part) => part.tag.startsWith("arch_rib_"))) {
          const jambs = solids.filter((solid) => solid.id.startsWith(`gate#${part.tag}#jamb_`));
          expect(jambs).toHaveLength(2);
          const depth = 0.064 * part.scale * part.scaleAxes![2];
          for (const jamb of jambs) expect(jamb.size[2]).toBeCloseTo(depth, 2);
          for (const side of [-1, 1]) {
            const timber = worldPoint(side * 1.28, part.dz + depth / 2, origin, rotationY);
            expect(jambs.some((jamb) => obstructs(jamb, timber))).toBe(true);
          }
        }
        for (const side of [-1, 1]) {
          expect(solids.some((solid) => obstructs(solid,
            worldPoint(side * 1.5, 0, origin, rotationY)))).toBe(true);
        }
      }
    }
    expect([...variants].sort()).toEqual(["standards", "torches", "wicket"]);
  });

  it.each(KIT_IDS)("leaves the %s bank cover open while blocking its counter, wall and posts", (kit) => {
    const origin: Vec3 = [-13, 2, 29];
    const parts = buildComposition("bank_counter", 0, kit);
    for (const rotationY of [0, Math.PI / 2, -0.63]) {
      const solids = structureCollisionFromCompositionParts("bank_counter", parts, {
        origin, rotationY, ownerId: "bank",
      }, measurements) as Box[];
      for (let z = 2; z >= 0.9; z -= 0.1) {
        const player = worldPoint(0, z, origin, rotationY);
        expect(solids.filter((solid) => obstructs(solid, player, 0.35))).toEqual([]);
      }
      expect(solids.some((solid) => obstructs(solid,
        worldPoint(0.9, 0.68, origin, rotationY)))).toBe(false);
      const counter = solids.find((solid) => solid.id === "bank#counter")!;
      expect(counter).toBeDefined();
      expect(counter.size[0]).toBeCloseTo(2.848, 2);
      expect(obstructs(counter, worldPoint(0, -0.15, origin, rotationY))).toBe(true);
      for (const post of parts.filter((part) => /^post\d+$/.test(part.tag))) {
        const collider = solids.find((solid) => solid.id === `bank#${post.tag}`)!;
        expect(collider).toBeDefined();
        expect(collider.rotationY).toBeCloseTo(rotationY + post.rotationY, 4);
        const asset = assets.get(post.assetId)!;
        expect(collider.size[0]).toBeCloseTo(asset.size.x * post.scale, 2);
        expect(collider.size[2]).toBeCloseTo(asset.size.z * post.scale, 2);
      }
      const backWalls = solids.filter((solid) => /bank#b\d_w$/.test(solid.id));
      expect(backWalls).toHaveLength(2);
      for (const wall of backWalls) {
        const part = parts.find(part => `bank#${part.tag}` === wall.id)!;
        const native = assets.get(part.assetId)!;
        expect(wall.size[2]).toBeCloseTo(native.size.z * part.scale, 2);
        expect(wall.size[0]).toBeCloseTo(native.size.x * part.scale, 2);
      }
      expect(backWalls.some((wall) => obstructs(wall,
        worldPoint(0.8, -1.3, origin, rotationY)))).toBe(true);
      expect(solids.some((solid) => obstructs(solid,
        worldPoint(0.5, -1.05, origin, rotationY)))).toBe(false);
      // The new full native walls replace the integral plaster panel's separate studs/rails;
      // elevated canopy slabs must not acquire a ground-level obstruction.
      expect(solids.filter(solid => /bank#b\d_o(?:#|$)/.test(solid.id))).toEqual([]);
    }
  });

  it("matches a rotated, nonuniformly scaled structural part and its off-center pivot", () => {
    const part: PartPlacement = {
      tag: "support", assetId: "corner_offset", dx: 0.2, dy: 0.1, dz: -0.3,
      rotationY: Math.PI / 2, scale: 1.5, scaleAxes: [2, 0.5, 3],
    };
    const origin: Vec3 = [17, 2, 31];
    const yaw = -0.37;
    const solids = structureCollisionFromCompositionParts("bank_counter", [part], {
      origin, rotationY: yaw, ownerId: "scaled",
    }, {
      assetSize: () => ({ x: 2, y: 4, z: 0.5 }),
      assetCenterXZ: () => ({ x: 0.4, z: -0.15 }),
    }) as Box[];
    expect(solids).toHaveLength(1);
    const solid = solids[0]!;
    expect(solid.size).toEqual([6, 3, 2.25]);
    const pivot = worldPoint(part.dx, part.dz, origin, yaw);
    const centre = worldPoint(1.2, -0.675, pivot, yaw + part.rotationY);
    expect(solid.position[0]).toBeCloseTo(centre[0], 1);
    expect(solid.position[1]).toBe(2.1);
    expect(solid.position[2]).toBeCloseTo(centre[2], 1);
    expect(solid.rotationY).toBeCloseTo(yaw + Math.PI / 2, 4);
  });

  it("uses vertical axis scale when deciding whether a ground part blocks walking", () => {
    const part: PartPlacement = {
      tag: "support", assetId: "corner_offset", dx: 4, dy: 0, dz: 0,
      rotationY: 0, scale: 1, scaleAxes: [1, 0.1, 1],
    };
    const solids = structureCollisionFromCompositionParts("bank_counter", [part], {
      origin: [0, 0, 0], rotationY: 0, ownerId: "low",
    }, {
      assetSize: () => ({ x: 1, y: 3, z: 1 }),
      assetCenterXZ: () => ({ x: 0, z: 0 }),
    });
    expect(solids).toEqual([]);
  });

  it("emits finite, positive collision volumes across the production composition catalogue", () => {
    for (const composition of COMPOSITION_IDS) for (const kit of KIT_IDS) {
      for (const seed of [0, 1, 2, 3, 4, 5, 6, 7]) {
        const solids = structureCollisionFromCompositionParts(composition,
          buildComposition(composition, seed, kit), {
            origin: [0, 0, 0], rotationY: 0.47, ownerId: `${composition}:${kit}:${seed}`,
          }, measurements) as Box[];
        for (const solid of solids) {
          expect(solid.size.every((axis) => Number.isFinite(axis) && axis > 0), solid.id).toBe(true);
          expect([...solid.position, solid.rotationY].every(Number.isFinite), solid.id).toBe(true);
        }
      }
    }
  });
});
