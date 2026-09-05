import type * as THREE from "three";
import type { SolidVolume, Vec3 } from "../contracts.js";
import { worldSitePoint, type WorldSite } from "../content/worldSites.js";
import type { AssetRegistry } from "./assets.js";
import type { ScatterPlacement, WorldScene } from "./scene.js";

export interface ResolvedWorldSiteDressing {
  readonly id: string;
  readonly assetId: string;
  readonly position: Vec3;
  readonly rotationY: number;
  readonly scale: ScatterPlacement["scale"];
  /** Measured, scaled local dimensions for the caller's collision and placement checks. */
  readonly size: readonly [number, number, number];
  readonly centreOffset: readonly [number, number];
}

export interface WorldSiteDressingResult {
  readonly objects: THREE.Object3D[];
  readonly placed: number;
  readonly assetIds: string[];
  readonly placements: ResolvedWorldSiteDressing[];
  readonly solids: SolidVolume[];
}

/**
 * Draws a site's authored setting through the production instancing/material path. Resource actors
 * are built separately from resourceSlots. Callers install the measured collision volumes
 * through the normal world path; low spoil and groundcover remain walkable.
 */
export async function buildWorldSiteDressing(
  scene: WorldScene,
  assets: AssetRegistry,
  site: WorldSite,
): Promise<WorldSiteDressingResult> {
  const assetIds = [...new Set(site.dressing.map((piece) => piece.assetId))];
  // Resolve every dependency before changing the live scene. A missing model is an authoring error,
  // not permission to leave half a mine around the resource nodes.
  const sources = await Promise.all(assetIds.map(async (assetId) => {
    const size = assets.assetSize(assetId);
    if (!size || !Object.values(size).every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error(`World site ${site.id} has no measured model for ${assetId}`);
    }
    return assets.load(assetId, { priority: "visible-spawn", primary: true });
  }));

  const placements: ResolvedWorldSiteDressing[] = [];
  const buckets = new Map<string, ScatterPlacement[]>();
  for (const piece of site.dressing) {
    const size = assets.assetSize(piece.assetId)!;
    const sx = typeof piece.scale === "number" ? piece.scale : piece.scale[0];
    const sy = typeof piece.scale === "number" ? piece.scale : piece.scale[1];
    const sz = typeof piece.scale === "number" ? piece.scale : piece.scale[2];
    const [centreX, centreZ] = worldSitePoint(site, piece.x, piece.z);
    const rotationY = site.rotationY + piece.yaw;
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    const centre = assets.assetCenterXZ(piece.assetId) ?? { x: 0, z: 0 };
    const offsetX = centre.x * sx * cos + centre.z * sz * sin;
    const offsetZ = -centre.x * sx * sin + centre.z * sz * cos;
    const halfX = size.x * sx * 0.5;
    const halfZ = size.z * sz * 0.5;

    let ground = scene.meshHeightAt(centreX, centreZ);
    const bedrock = /^corealm_(rock|cliff|scree)_/.test(piece.assetId);
    if (bedrock) {
      // Bedrock extends into the hillside. Set its foot at the lowest supporting corner so the
      // uphill side buries into ground instead of lifting its downhill foot into open air.
      for (const [dx, dz] of [
        [-halfX, -halfZ], [halfX, -halfZ], [-halfX, halfZ], [halfX, halfZ],
      ] as const) {
        ground = Math.min(ground, scene.meshHeightAt(
          centreX + dx * cos + dz * sin,
          centreZ - dx * sin + dz * cos,
        ));
      }
    }
    const position: Vec3 = [
      centreX - offsetX,
      ground - assets.baseY(piece.assetId) * sy - (piece.sink ?? 0),
      centreZ - offsetZ,
    ];
    const scale: ScatterPlacement["scale"] = typeof piece.scale === "number"
      ? piece.scale
      : [piece.scale[0], piece.scale[1], piece.scale[2]];
    const placement: ScatterPlacement = { position, rotationY, scale };
    const bucket = buckets.get(piece.assetId) ?? [];
    bucket.push(placement);
    buckets.set(piece.assetId, bucket);
    placements.push({
      id: `${site.id}:${piece.id}`,
      assetId: piece.assetId,
      ...placement,
      size: [size.x * sx, size.y * sy, size.z * sz],
      centreOffset: [offsetX, offsetZ],
    });
  }

  const objects: THREE.Object3D[] = [];
  for (const [index, assetId] of assetIds.entries()) {
    const created = scene.scatterInstanced(
      sources[index]!,
      buckets.get(assetId)!,
      `world-site-${site.id}-${assetId}`,
      { regionId: site.regionId, castShadow: true, windStrength: /^corealm_(fern|shrub|flower)_/.test(assetId) ? 0.035 : 0 },
    );
    const pieceIds = placements.filter((placement) => placement.assetId === assetId).map((placement) => placement.id);
    for (const object of created) {
      object.userData.worldSiteId = site.id;
      object.userData.worldSiteDressingIds = pieceIds;
    }
    objects.push(...created);
  }
  const solids: SolidVolume[] = placements
    .filter((piece) => /^corealm_(rock|cliff)_|^(crate|workbench|barrel)/.test(piece.assetId))
    .map((piece) => ({
      kind: "box", id: piece.id,
      position: [
        piece.position[0] + piece.centreOffset[0],
        piece.position[1] + assets.baseY(piece.assetId) * (typeof piece.scale === "number" ? piece.scale : piece.scale[1]),
        piece.position[2] + piece.centreOffset[1],
      ],
      size: piece.size, rotationY: piece.rotationY,
    }));
  return { objects, placed: placements.length, assetIds, placements, solids };
}
