import type { SemanticEntity, SolidVolume, Vec3 } from "../contracts.js";

/** The masonry recess is a destination marker. Its interior is never walkable terrain. */
export function portalEntrance(
  entity: SemanticEntity,
  heightAt: (x: number, z: number) => number,
): { interactionPosition: Vec3; solid: SolidVolume } {
  const view = entity.view;
  if (entity.archetype !== "portal" || view?.assetId !== "wall_brick_door") {
    throw new Error(`Unsupported masonry portal ${entity.id}`);
  }
  // Portals use authored metre scale, matching their rendered masonry and recess.
  const scale = view.scale ?? 1;
  const axes = view.scaleAxes ?? [1, 1, 1];
  const yaw = view.rotationY ?? 0;
  const at = (forward: number): Vec3 => {
    const x = entity.position[0] + Math.sin(yaw) * forward;
    const z = entity.position[2] + Math.cos(yaw) * forward;
    return [x, heightAt(x, z), z];
  };
  // The arch reveal ends at local +0.105. A metre beyond that gives a clear standing pad.
  const interactionPosition = at(0.105 * scale * axes[2] + 1.1);
  const centre = at(-0.80 * scale * axes[2]);
  return {
    interactionPosition,
    solid: {
      id: `${entity.id}:closed-recess`, kind: "box",
      position: [centre[0], entity.position[1], centre[2]],
      size: [2.9 * scale * axes[0], 2.5 * scale * axes[1], 1.88 * scale * axes[2]],
      rotationY: yaw,
    },
  };
}
