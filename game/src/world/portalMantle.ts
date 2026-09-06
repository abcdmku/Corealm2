import type { SemanticEntity, SolidVolume } from "../contracts.js";

/** Native metres shared by the closed surface mantle mesh and its physical envelope. */
export const PORTAL_MANTLE = {
  minX: -1.3, maxX: 1.3,
  baseY: -0.05, maxY: 3.08,
  frontZ: -0.30, backZ: -3.9,
  frontRoofY: 3.03, rearRoofY: 2.65,
} as const;

/** Surface portals have real overburden; the compact underground exit has only its recess. */
export function portalMantleSolid(entity: SemanticEntity): SolidVolume | null {
  if (entity.archetype !== "portal" || entity.view?.assetId !== "wall_brick_door" || entity.regionId === "gravelmaw") return null;
  const scale = entity.view.scale ?? 1;
  const axes = entity.view.scaleAxes ?? [1, 1, 1];
  const yaw = entity.view.rotationY ?? 0;
  if (![...entity.position, scale, ...axes, yaw].every(Number.isFinite) || scale <= 0 || axes.some(axis => axis <= 0)) {
    throw new Error(`Invalid portal mantle transform ${entity.id}`);
  }
  const forward = (PORTAL_MANTLE.frontZ + PORTAL_MANTLE.backZ) / 2 * scale * axes[2];
  return {
    id: `${entity.id}:rock-mantle`, kind: "box",
    position: [entity.position[0] + Math.sin(yaw) * forward,
      entity.position[1] + PORTAL_MANTLE.baseY * scale * axes[1],
      entity.position[2] + Math.cos(yaw) * forward],
    size: [(PORTAL_MANTLE.maxX - PORTAL_MANTLE.minX) * scale * axes[0],
      (PORTAL_MANTLE.maxY - PORTAL_MANTLE.baseY) * scale * axes[1],
      (PORTAL_MANTLE.frontZ - PORTAL_MANTLE.backZ) * scale * axes[2]],
    rotationY: yaw,
  };
}
