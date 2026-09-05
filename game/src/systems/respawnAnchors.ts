import type { RegionId, Vec3 } from "../contracts.js";
import type { TickSystem } from "../app/loop.js";
import { REGIONS } from "../content/regions.js";
import type { Store } from "../state/store.js";
import type { RespawnPoint } from "./death.js";

/** The courtyard around an authored settlement route point counts as a visit. */
export const SETTLEMENT_RESPAWN_RADIUS_M = 12;
/** A roof, cave, or neighbouring terrace is not a visit to the ground-level courtyard. */
export const RESPAWN_ANCHOR_HEIGHT_TOLERANCE_M = 4;

export interface RespawnAnchor {
  readonly id: string;
  readonly name: string;
  readonly regionId: RegionId;
  readonly position: Vec3;
  readonly radius?: number;
}

export interface RespawnAnchorDeps {
  readonly store: Store;
  /** Resolve the current world's anchors again after navigation or lab fixtures are rebuilt. */
  readonly anchors: () => readonly RespawnAnchor[];
}

/**
 * Updates the existing saved respawn ID when a living player reaches a settlement courtyard.
 * Region discovery and crossing the region border do not bind a respawn point.
 */
export class RespawnAnchorSystem implements TickSystem {
  readonly name = "respawnAnchors";
  /** After player movement, before combat and death resolve this simulation tick. */
  readonly order = 50;

  constructor(private readonly deps: RespawnAnchorDeps) {}

  tick(_deltaMs: number, _atMs: number): void {
    this.update();
  }

  /** Returns only a changed anchor, for callers that want to announce a newly bound settlement. */
  update(): RespawnAnchor | null {
    const state = this.deps.store.get();
    const player = state.player;
    if (player.health <= 0) return null;
    let nearest: RespawnAnchor | null = null;
    let nearestSquaredDistance = Number.POSITIVE_INFINITY;
    for (const anchor of this.deps.anchors()) {
      if (anchor.regionId !== player.regionId) continue;
      if (Math.abs(player.position[1] - anchor.position[1]) > RESPAWN_ANCHOR_HEIGHT_TOLERANCE_M) continue;
      const dx = player.position[0] - anchor.position[0];
      const dz = player.position[2] - anchor.position[2];
      const squaredDistance = dx * dx + dz * dz;
      const radius = anchor.radius ?? SETTLEMENT_RESPAWN_RADIUS_M;
      if (squaredDistance > radius * radius || squaredDistance >= nearestSquaredDistance) continue;
      nearest = anchor;
      nearestSquaredDistance = squaredDistance;
    }
    if (!nearest || nearest.id === player.respawnPointId) return null;
    player.respawnPointId = nearest.id;
    this.deps.store.markDirty();
    return { ...nearest, position: [...nearest.position] };
  }

  /** Canonical settlement IDs differ from route IDs, so death must resolve through this mapping. */
  resolve(respawnPointId: string): RespawnPoint | undefined {
    const anchor = this.deps.anchors().find((candidate) => candidate.id === respawnPointId);
    return anchor ? {
      name: anchor.name,
      position: [...anchor.position],
      regionId: anchor.regionId,
    } : undefined;
  }
}

/**
 * Uses each settlement's authored route location for position and its saved respawn ID for identity.
 * A compact lab without those world routes gets no island anchors; it can supply its own instead.
 */
export function buildSettlementRespawnAnchors(
  routeNode: (id: string) => { position: Vec3; regionId: string } | undefined,
): RespawnAnchor[] {
  const anchors: RespawnAnchor[] = [];
  for (const region of REGIONS) {
    const settlement = region.settlement;
    const locations = region.locations.filter((location) => location.kind === "settlement" && location.routeNode);
    locations.sort((a, b) => {
      const distance = (position: readonly number[]) =>
        (position[0]! - settlement.centre[0]) ** 2 + (position[1]! - settlement.centre[1]) ** 2;
      return distance(a.position) - distance(b.position);
    });
    const location = locations[0];
    if (!location) throw new Error(`Settlement ${settlement.id} has no authored settlement route point`);
    const node = routeNode(location.id);
    if (!node || node.regionId !== region.id) continue;
    anchors.push({
      id: settlement.respawnPointId,
      name: settlement.name,
      regionId: region.id,
      position: [...node.position],
      radius: SETTLEMENT_RESPAWN_RADIUS_M,
    });
  }
  return anchors;
}
