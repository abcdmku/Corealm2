import * as THREE from "three";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { REGIONS } from "../game/src/content/regions.js";
import { resourceDef } from "../game/src/content/resources.js";
import {
  WORLD_SITES, authoredSiteForCluster, worldSitePoint, worldSiteResourceSlot, type WorldSiteDressing,
} from "../game/src/content/worldSites.js";
import type { AssetRegistry } from "../game/src/render/assets.js";
import type { ScatterPlacement, WorldScene } from "../game/src/render/scene.js";
import { buildWorldSiteDressing } from "../game/src/render/worldSiteDressing.js";

const ordinaryClusters = REGIONS.flatMap((region) => region.clusters
  .filter((cluster) => !cluster.essenceElement
    && ["ore", "tree", "fishing_spot"].includes(resourceDef(cluster.resourceId).archetype))
  .map((cluster) => ({ region, cluster })));
const clustersById = new Map(ordinaryClusters.map((entry) => [entry.cluster.id, entry]));
const manifest = JSON.parse(readFileSync(new URL("../game/public/assets/manifest.json", import.meta.url), "utf8")) as {
  assets: { id: string; size: { x: number; y: number; z: number } }[];
};
const modelSizes = new Map(manifest.assets.map((asset) => [asset.id, asset.size]));

interface Footprint { x: number; z: number; halfX: number; halfZ: number; yaw: number }

function footprint(piece: WorldSiteDressing): Footprint {
  const size = modelSizes.get(piece.assetId);
  if (!size) throw new Error(`No measured bounds for ${piece.assetId}`);
  const scale = typeof piece.scale === "number" ? [piece.scale, piece.scale, piece.scale] : piece.scale;
  return { x: piece.x, z: piece.z, yaw: piece.yaw, halfX: size.x * scale[0]! / 2, halfZ: size.z * scale[2]! / 2 };
}

function distanceToFootprint(x: number, z: number, box: Footprint): number {
  const dx = x - box.x; const dz = z - box.z;
  const cos = Math.cos(box.yaw); const sin = Math.sin(box.yaw);
  return Math.hypot(Math.max(0, Math.abs(dx * cos - dz * sin) - box.halfX),
    Math.max(0, Math.abs(dx * sin + dz * cos) - box.halfZ));
}

function footprintGap(a: Footprint, b: Footprint): number {
  const axes = (box: Footprint) => [
    [Math.cos(box.yaw), -Math.sin(box.yaw)], [Math.sin(box.yaw), Math.cos(box.yaw)],
  ] as const;
  const aAxes = axes(a); const bAxes = axes(b);
  const projectedRadius = (box: Footprint, directions: ReturnType<typeof axes>, axis: readonly [number, number]) =>
    Math.abs(directions[0][0] * axis[0] + directions[0][1] * axis[1]) * box.halfX
      + Math.abs(directions[1][0] * axis[0] + directions[1][1] * axis[1]) * box.halfZ;
  const separated = [...aAxes, ...bAxes].some((axis) =>
    Math.abs((a.x - b.x) * axis[0] + (a.z - b.z) * axis[1])
      > projectedRadius(a, aAxes, axis) + projectedRadius(b, bAxes, axis));
  if (!separated) return 0;
  let gap = Infinity;
  for (const [box, other] of [[a, b], [b, a]] as const) {
    const directions = axes(box);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      gap = Math.min(gap, distanceToFootprint(
        box.x + sx * box.halfX * directions[0][0] + sz * box.halfZ * directions[1][0],
        box.z + sx * box.halfX * directions[0][1] + sz * box.halfZ * directions[1][1], other));
    }
  }
  return gap;
}

describe("authored resource sites", () => {
  it("covers every ordinary cluster once without changing persistent resource IDs or counts", () => {
    expect(new Set(WORLD_SITES.map((site) => site.id)).size).toBe(WORLD_SITES.length);
    const actualIds: string[] = [];
    for (const site of WORLD_SITES) {
      const region = REGIONS.find((candidate) => candidate.id === site.regionId)!;
      expect(region, site.id).toBeDefined();
      expect(region.locations.some((location) => location.id === site.locationId), site.id).toBe(true);
      for (const slot of site.resourceSlots) {
        const source = clustersById.get(slot.clusterId);
        expect(source, `${site.id}: unknown or essence cluster ${slot.clusterId}`).toBeDefined();
        expect(source!.region.id, slot.clusterId).toBe(site.regionId);
        expect(Number.isInteger(slot.index) && slot.index >= 1, slot.clusterId).toBe(true);
        actualIds.push(`${slot.clusterId}_${slot.index}`);
      }
    }
    const expectedIds = ordinaryClusters.flatMap(({ cluster }) =>
      Array.from({ length: cluster.count }, (_, index) => `${cluster.id}_${index + 1}`));
    expect(actualIds.sort()).toEqual(expectedIds.sort());
    for (const { cluster } of ordinaryClusters) {
      const owners = WORLD_SITES.filter((site) => site.resourceSlots.some((slot) => slot.clusterId === cluster.id));
      expect(owners, cluster.id).toHaveLength(1);
      expect(authoredSiteForCluster(cluster.id), cluster.id).toBe(owners[0]);
      for (let index = 1; index <= cluster.count; index++) {
        expect(worldSiteResourceSlot(cluster.id, index), `${cluster.id}_${index}`)
          .toEqual({ site: owners[0], slot: owners[0]!.resourceSlots.find((slot) => slot.clusterId === cluster.id && slot.index === index) });
      }
      expect(worldSiteResourceSlot(cluster.id, 0)).toBeNull();
      expect(worldSiteResourceSlot(cluster.id, cluster.count + 1)).toBeNull();
    }
  });

  it("keeps resource slots inside their authored setting and playable region after rotation", () => {
    for (const site of WORLD_SITES) {
      const region = REGIONS.find((candidate) => candidate.id === site.regionId)!;
      for (const slot of site.resourceSlots) {
        const id = `${slot.clusterId}_${slot.index}`;
        expect(Math.abs(slot.x), id).toBeLessThanOrEqual(site.extent[0]);
        expect(Math.abs(slot.z), id).toBeLessThanOrEqual(site.extent[1]);
        const [x, z] = worldSitePoint(site, slot.x, slot.z);
        expect(x, id).toBeGreaterThanOrEqual(region.bounds.min[0]);
        expect(x, id).toBeLessThanOrEqual(region.bounds.max[0]);
        expect(z, id).toBeGreaterThanOrEqual(region.bounds.min[1]);
        expect(z, id).toBeLessThanOrEqual(region.bounds.max[1]);
        expect(Number.isFinite(slot.yaw) && Number.isFinite(slot.scale) && slot.scale > 0, id).toBe(true);
      }
    }
  });

  it("keeps fish on the existing basin floor instead of placing them on its rising bank", () => {
    for (const { cluster } of ordinaryClusters.filter(({ cluster }) => resourceDef(cluster.resourceId).archetype === "fishing_spot")) {
      const site = authoredSiteForCluster(cluster.id)!;
      expect(site.kind, cluster.id).toBe("fishery");
      // Basin relief is already authored from cluster.centre/radius. Test world coordinates so
      // moving a site's centre cannot silently move its fish out of their water.
      for (const slot of site.resourceSlots.filter((candidate) => candidate.clusterId === cluster.id)) {
        const [x, z] = worldSitePoint(site, slot.x, slot.z);
        expect(Math.hypot(x - cluster.centre[0], z - cluster.centre[1]), `${cluster.id}_${slot.index}`)
          .toBeLessThanOrEqual(cluster.radius);
      }
      expect(site.terrain.floorRadius, site.id).toBe(0);
      expect(site.terrain.backRise, site.id).toBe(0);
    }
  });

  it("reserves a 3.2 m approach with a one-metre origin margin through groves", () => {
    // This guards authoring coordinates. Production geometry/collision clearance is a world
    // browser check because an asset's origin alone cannot establish its occupied footprint.
    for (const site of WORLD_SITES.filter((candidate) => candidate.kind === "grove")) {
      const angle = site.terrain.approachAngle;
      for (const item of [...site.resourceSlots, ...site.dressing]) {
        const along = item.x * Math.sin(angle) + item.z * Math.cos(angle);
        const across = item.x * Math.cos(angle) - item.z * Math.sin(angle);
        if (along >= 0 && along <= site.extent[1]) {
          const id = "id" in item ? item.id : `${item.clusterId}_${item.index}`;
          expect(Math.abs(across), `${site.id}/${id} blocks approach`).toBeGreaterThanOrEqual(2.6);
        }
      }
    }
  });

  it("keeps the measured mine dressing footprints outside the 3.2 m haul approach", () => {
    for (const site of WORLD_SITES.filter((candidate) => candidate.kind === "mine")) {
      const forwardX = Math.sin(site.terrain.approachAngle);
      const forwardZ = Math.cos(site.terrain.approachAngle);
      for (const piece of site.dressing) {
        const box = footprint(piece);
        // Sample the whole declared route, including the road beyond the excavated floor.
        // Scree is walkable but still belongs beside the hauling track, not across its centre.
        for (let along = 0; along <= site.extent[1]; along += 0.25) {
          expect(distanceToFootprint(forwardX * along, forwardZ * along, box),
            `${site.id}/${piece.id} approach at ${along} m`).toBeGreaterThanOrEqual(1.6);
        }
      }
    }
  });

  it("keeps mining stances clear and groups handling equipment within the working area", () => {
    const errors: string[] = [];
    for (const site of WORLD_SITES.filter((candidate) => candidate.kind === "mine")) {
      const bedrock = site.dressing.filter((piece) => /^corealm_(rock|cliff)_/.test(piece.assetId))
        .map((piece) => ({ piece, box: footprint(piece) }));
      const solid = site.dressing.filter((piece) => /^corealm_(rock|cliff)_|^(crate|workbench|barrel)/.test(piece.assetId))
        .map((piece) => ({ piece, box: footprint(piece) }));
      const oreBoxes = site.resourceSlots.map((slot) => {
        const resource = resourceDef(clustersById.get(slot.clusterId)!.cluster.resourceId);
        const size = modelSizes.get(resource.presentation.availableAssetIds[0]!)!;
        const scale = resource.presentation.targetWorldSize / Math.max(size.x, size.y, size.z)
          * (resource.presentation.variantScale?.[1] ?? 1) * slot.scale;
        return { slot, box: { x: slot.x, z: slot.z, yaw: slot.yaw,
          halfX: size.x * scale / 2, halfZ: size.z * scale / 2 } };
      });
      expect(bedrock.length, `${site.id}: no host rock`).toBeGreaterThan(0);
      // Connected mineral faces now come from the production cut mesh; its actual triangle
      // attachment is tested in mine-cut-face.test.ts. Decorative outcrops need not touch one
      // another's bounding boxes when both emerge from that cut and the shared hillside.
      for (const { piece } of bedrock) {
        if (!(piece.sink && piece.sink > 0)) errors.push(`${site.id}/${piece.id}: host rock has no ground embed`);
      }
      for (const slot of site.resourceSlots) {
        // Slabs attach to the generated cut surface, verified against real triangles in
        // mine-cut-face.test.ts. A dressing asset's bounding box cannot prove that contact.
        const forwardX = Math.sin(slot.yaw); const forwardZ = Math.cos(slot.yaw);
        const id = `${site.id}/${slot.clusterId}_${slot.index}`;
        for (const { piece, box } of solid) {
          const clearance = distanceToFootprint(slot.x + forwardX * 2.3, slot.z + forwardZ * 2.3, box);
          if (clearance < 0.4) errors.push(`${id}: stance ${clearance.toFixed(2)} m from ${piece.id}`);
        }
        for (const other of oreBoxes) {
          if (other.slot === slot) continue;
          const clearance = distanceToFootprint(slot.x + forwardX * 2.3, slot.z + forwardZ * 2.3, other.box);
          if (clearance < 0.4) errors.push(`${id}: stance ${clearance.toFixed(2)} m from ${other.slot.clusterId}_${other.slot.index}`);
        }
      }
      const handling = site.dressing.filter((piece) => /^(workbench|crate)/.test(piece.assetId));
      for (const [index, piece] of handling.entries()) {
        if (handling.length > 1 && !handling.some((other) => other !== piece && Math.hypot(piece.x - other.x, piece.z - other.z) <= 3)) {
          errors.push(`${site.id}/${piece.id}: isolated handling equipment`);
        }
        // Reference the active work, not rear dressing rocks moved into the bank. Equipment
        // must stay close to its source and companion storage while leaving mining stances free.
        if (!site.resourceSlots.some((slot) => Math.hypot(piece.x - slot.x, piece.z - slot.z) <= 8)) errors.push(`${site.id}/${piece.id}: handling area detached from ore`);
        for (const other of handling.slice(index + 1)) {
          if (footprintGap(footprint(piece), footprint(other)) < 0.05) errors.push(`${site.id}: ${piece.id} overlaps or touches ${other.id}`);
        }
      }
    }
    expect(errors).toEqual([]);
  });

  it("uses the production Y rotation convention for both resource and dressing coordinates", () => {
    const site = { ...WORLD_SITES[0]!, centre: [10, 20] as const, rotationY: Math.PI / 2 };
    const [x, z] = worldSitePoint(site, 3, 4);
    expect(x).toBeCloseTo(14, 12);
    expect(z).toBeCloseTo(17, 12);
    const [approachX, approachZ] = worldSitePoint(site, 0, 5);
    expect(approachX).toBeCloseTo(15, 12);
    expect(approachZ).toBeCloseTo(20, 12);
  });
});

describe("production site dressing", () => {
  function setup() {
    const source = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 6, 2), new THREE.MeshStandardMaterial());
    mesh.position.set(1.5, 2, -2);
    source.add(mesh);
    source.updateMatrixWorld(true);
    const assets = {
      assetSize: () => ({ x: 4, y: 6, z: 2 }),
      assetCenterXZ: () => ({ x: 1.5, z: -2 }),
      baseY: () => -1,
      load: vi.fn(async (_assetId: string) => source),
    };
    const scene = {
      meshHeightAt: (x: number, z: number) => 8 + 0.2 * x + 0.3 * z,
      scatterInstanced: vi.fn((_source: THREE.Object3D, _placements: ScatterPlacement[]) => [new THREE.Object3D()]),
    };
    const site = {
      ...WORLD_SITES[0]!,
      centre: [10, 20] as const,
      rotationY: Math.PI / 2,
      dressing: [{ id: "bedrock", assetId: "corealm_rock_strata_1", x: 3, z: 4,
        yaw: -Math.PI / 6, scale: [2, 0.5, 3] as const, sink: 0.12 }],
    };
    return { source, assets, scene, site };
  }

  it("centres an off-origin model under nonuniform scale and seats its foot into a sloped bed", async () => {
    const { source, assets, scene, site } = setup();
    const sourceBefore = source.toJSON();
    const result = await buildWorldSiteDressing(scene as unknown as WorldScene, assets as unknown as AssetRegistry, site);
    const placement = result.placements[0]!;
    const transform = new THREE.Matrix4().compose(
      new THREE.Vector3(...placement.position),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.rotationY),
      new THREE.Vector3(...site.dressing[0]!.scale),
    );
    const localBounds = new THREE.Box3().setFromObject(source);
    const visibleCentre = localBounds.getCenter(new THREE.Vector3()).applyMatrix4(transform);
    expect(visibleCentre.x).toBeCloseTo(14, 12);
    expect(visibleCentre.z).toBeCloseTo(17, 12);
    const supports: { foot: number; ground: number }[] = [];
    for (const x of [localBounds.min.x, localBounds.max.x]) {
      for (const z of [localBounds.min.z, localBounds.max.z]) {
        const foot = new THREE.Vector3(x, localBounds.min.y, z).applyMatrix4(transform);
        supports.push({ foot: foot.y, ground: scene.meshHeightAt(foot.x, foot.z) });
      }
    }
    for (const support of supports) expect(support.foot).toBeLessThanOrEqual(support.ground);
    expect(supports[0]!.foot).toBeCloseTo(Math.min(...supports.map((support) => support.ground)) - 0.12, 12);
    expect(source.toJSON()).toEqual(sourceBefore);
    expect(scene.scatterInstanced).toHaveBeenCalledOnce();
    expect(scene.scatterInstanced.mock.calls[0]![0]).toBe(source);
    expect(scene.scatterInstanced.mock.calls[0]![1]).toEqual([{
      position: placement.position, rotationY: placement.rotationY, scale: placement.scale,
    }]);
    expect(placement.size).toEqual([8, 3, 6]);
    expect(result.objects[0]!.userData).toMatchObject({ worldSiteId: site.id, worldSiteDressingIds: [`${site.id}:bedrock`] });
  });

  it("rejects an unavailable setting piece before drawing any part of the site", async () => {
    const { assets, scene, site } = setup();
    assets.load.mockImplementation(async (assetId) => {
      if (assetId === "missing_workbench") throw new Error("missing_workbench unavailable");
      return new THREE.Group();
    });
    const incomplete = { ...site, dressing: [...site.dressing,
      { ...site.dressing[0]!, id: "bench", assetId: "missing_workbench", x: 8, z: 6 },
    ] };
    await expect(buildWorldSiteDressing(scene as unknown as WorldScene, assets as unknown as AssetRegistry, incomplete))
      .rejects.toThrow("missing_workbench unavailable");
    expect(scene.scatterInstanced).not.toHaveBeenCalled();
  });
});
