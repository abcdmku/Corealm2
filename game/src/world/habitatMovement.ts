import type { Vec3 } from "../contracts.js";
import type { HabitatDef } from "../content/worldHabitats.js";

/** Stable per-entity seed, so one creature's wander is its own and survives a reload. */
export function hashId(entityId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < entityId.length; index += 1) {
    hash ^= entityId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface HabitatIdleTargets {
  readonly ranging: boolean;
  readonly nearestAnchorIndex: number | null;
  readonly candidates: readonly { readonly anchorIndex: number; readonly position: Vec3 }[];
}

/** Potential idle destinations before containment and navigation checks.
 * Local activities retain the nearest-three order; ranging retains authored circuit order.
 * Invalid raw anchor slots remain present so the AI's random range and circuit order stay stable.
 */
export function habitatIdleTargets(
  entityId: string, spawn: Vec3, habitat: HabitatDef,
): HabitatIdleTargets {
  const nearest = habitat.anchors.map((anchor, index) => ({
    index, distance: Math.hypot(anchor[0] - spawn[0], anchor[1] - spawn[2]),
  })).sort((a, b) => a.distance - b.distance || a.index - b.index);
  const ranging = habitat.roamRadius === undefined && (habitat.activity === "patrol" || habitat.activity === "prowl");
  const selected = ranging ? habitat.anchors.map((_, index) => index)
    : nearest.slice(0, habitat.roamRadius === undefined ? 3 : 1).map((anchor) => anchor.index);
  const seed = hashId(entityId);
  const angle = (seed % 360) * Math.PI / 180;
  if (habitat.roamRadius !== undefined && nearest[0]) {
    const anchorIndex = nearest[0].index;
    return { ranging: false, nearestAnchorIndex: anchorIndex,
      candidates: Array.from({ length: 4 }, (_, index) => {
        const direction = angle + index * Math.PI / 2;
        return { anchorIndex, position: [spawn[0] + Math.cos(direction) * habitat.roamRadius!,
          spawn[1], spawn[2] + Math.sin(direction) * habitat.roamRadius!] as Vec3 };
      }) };
  }
  const offset = Math.min(0.45, habitat.radius * 0.05) * (0.5 + ((seed >>> 8) % 100) / 200);
  const candidates = selected.map((anchorIndex) => {
    const anchor = habitat.anchors[anchorIndex]!;
    const dx = anchor[0] - spawn[0];
    const dz = anchor[1] - spawn[2];
    const distance = Math.hypot(dx, dz);
    // Grazers browse their own patch; a distant flock anchor gives direction, not a long trek.
    const localRadius = habitat.roamRadius ?? (habitat.activity === "graze" ? Math.min(5, habitat.radius * 0.55)
      : Math.min(4, habitat.radius * 0.7));
    const fraction = ranging || distance <= localRadius ? 1 : localRadius / distance;
    const position: Vec3 = [
      spawn[0] + dx * fraction + Math.cos(angle) * offset, spawn[1],
      spawn[2] + dz * fraction + Math.sin(angle) * offset,
    ];
    return { anchorIndex, position };
  });
  return { ranging, nearestAnchorIndex: nearest[0]?.index ?? null, candidates };
}
