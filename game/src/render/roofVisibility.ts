import * as THREE from "three";
import type { SemanticEntity, Vec3 } from "../contracts.js";

/** Building identity is shared by every storey, including its floors, walls and dressing. */
export function structureOwner(entity: SemanticEntity): string | null {
  if (entity.archetype !== "landmark" || !entity.id.includes("#")) return null;
  if (typeof entity.meta?.buildingId === "string") return entity.meta.buildingId;
  if (typeof entity.meta?.prefab === "string" || entity.meta?.structureKind === "prefab") {
    return entity.id.split("#", 1)[0]!;
  }
  return null;
}

/** Surfaces that establish overhead occupancy. Walls and decorative logs never trigger it. */
export function roofOwner(entity: SemanticEntity): string | null {
  const asset = entity.view?.assetId ?? "";
  const overhead = /^(roof_tiles_|roof_wood_|roof_tower$|roof_dormer$|floor_)/.test(asset)
    || asset === "overhang_brick";
  return overhead ? structureOwner(entity) : null;
}

export interface RoofView {
  actual: Vec3;
  requested: Vec3;
  nowMs: number;
}

interface RoofPart {
  entityId: string;
  owner: string;
  inverse: THREE.Matrix4;
  bounds: THREE.Box3;
  clearanceBounds: THREE.Box3;
  minY: number;
  anchorY: number;
  overhead: boolean;
}

/** Cut obstructing upper storeys from the camera view while preserving the player's floor. */
export class RoofVisibility {
  private parts: RoofPart[] = [];
  private members = new Map<string, { entityId: string; minY: number; anchorY: number }[]>();
  private readonly point = new THREE.Vector3();
  private readonly ray = new THREE.Ray();
  private readonly end = new THREE.Vector3();
  private readonly hit = new THREE.Vector3();
  private sourceParts = new Map<string, RoofPart[]>();
  readonly hiddenEntities = new Set<string>();
  readonly hiddenBuildings = new Set<string>();
  readonly cutHeights = new Map<string, number>();
  private dirty = true;

  setSources(meshes: readonly THREE.Mesh[]): void {
    this.parts = [];
    for (const mesh of meshes) {
      const owner = mesh.userData["structureOwner"] ?? mesh.userData["roofOwner"];
      const entityId = mesh.userData["structureCamera"];
      if (typeof owner !== "string" || typeof entityId !== "string") continue;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      if (!mesh.geometry.boundingBox || mesh.geometry.boundingBox.isEmpty()) continue;
      const worldBounds = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
      const scale = new THREE.Vector3().setFromMatrixScale(mesh.matrixWorld);
      const padding = 0.3 / Math.max(0.01, Math.min(scale.x, scale.y, scale.z));
      this.parts.push({ owner, entityId, inverse: mesh.matrixWorld.clone().invert(),
        bounds: mesh.geometry.boundingBox.clone(),
        clearanceBounds: mesh.geometry.boundingBox.clone().expandByScalar(padding),
        minY: worldBounds.min.y,
        anchorY: Number(mesh.userData["structureAnchorY"] ?? worldBounds.min.y),
        overhead: typeof mesh.userData["roofOwner"] === "string" });
    }
    this.members.clear();
    this.sourceParts.clear();
    const entities = new Map<string, { entityId: string; owner: string; minY: number; anchorY: number }>();
    for (const part of this.parts) {
      const sources = this.sourceParts.get(part.owner) ?? [];
      sources.push(part);
      this.sourceParts.set(part.owner, sources);
      const previous = entities.get(part.entityId);
      if (previous) previous.minY = Math.min(previous.minY, part.minY);
      else entities.set(part.entityId, { entityId: part.entityId, owner: part.owner,
        minY: part.minY, anchorY: part.anchorY });
    }
    for (const entity of entities.values()) {
      const group = this.members.get(entity.owner) ?? [];
      group.push(entity);
      this.members.set(entity.owner, group);
    }
    this.parts = this.parts.filter(part => part.overhead);
    this.dirty = true;
  }

  update(position: Vec3 | null, view?: RoofView): boolean {
    const cuts = new Map<string, number>();
    if (position) for (const part of this.parts) {
      if (!part.overhead || part.minY < position[1] + 1.8) continue;
      this.point.fromArray(position).applyMatrix4(part.inverse);
      const b = part.bounds;
      // Enter within the overhead surface; a small exit margin prevents boundary flicker.
      const margin = this.hiddenBuildings.has(part.owner) ? 0.12 : 0;
      if (this.point.x >= b.min.x - margin && this.point.x <= b.max.x + margin
        && this.point.z >= b.min.z - margin && this.point.z <= b.max.z + margin) {
        cuts.set(part.owner, Math.min(cuts.get(part.owner) ?? Infinity, part.minY));
      }
    }
    if (position && view) {
      const cameraCuts = new Map<string, number>();
      for (const part of this.parts) {
        if (part.minY < position[1] + 1.8) continue;
        cameraCuts.set(part.owner, Math.min(cameraCuts.get(part.owner) ?? Infinity, part.minY));
      }
      for (const [owner, cut] of cameraCuts) {
        // Test upper storeys even before the player has entered this building.
        // The intended arm prevents collision compression from hiding the obstruction from this test.
        if (this.blocksView(owner, cut, position, view.requested)
          || this.blocksView(owner, cut, position, view.actual)) {
          cuts.set(owner, Math.min(cuts.get(owner) ?? Infinity, cut));
        }
      }
    }
    // Preserve tall ground-floor posts even if one of their material submeshes sits upstairs.
    const hidden = new Set<string>();
    for (const [owner, cut] of cuts) for (const part of this.members.get(owner) ?? []) {
      if (part.minY >= cut - 0.15 || part.anchorY >= cut) hidden.add(part.entityId);
    }
    const changed = this.dirty || hidden.size !== this.hiddenEntities.size
      || [...hidden].some(id => !this.hiddenEntities.has(id))
      || cuts.size !== this.cutHeights.size
      || [...cuts].some(([owner, height]) => this.cutHeights.get(owner) !== height);
    if (!changed) return false;
    this.dirty = false;
    this.hiddenBuildings.clear();
    this.hiddenEntities.clear();
    this.cutHeights.clear();
    for (const [owner, height] of cuts) {
      this.hiddenBuildings.add(owner);
      this.cutHeights.set(owner, height);
    }
    for (const id of hidden) this.hiddenEntities.add(id);
    return true;
  }

  private blocksView(owner: string, cut: number, player: Vec3, camera: Vec3): boolean {
    for (const part of this.sourceParts.get(owner) ?? []) {
      if (part.minY < cut - 0.15 && part.anchorY < cut) continue;
      this.ray.origin.set(player[0], player[1] + 1.1, player[2]).applyMatrix4(part.inverse);
      this.end.fromArray(camera).applyMatrix4(part.inverse);
      const lengthSq = this.ray.origin.distanceToSquared(this.end);
      if (lengthSq < 1e-8) continue;
      this.ray.direction.copy(this.end).sub(this.ray.origin).normalize();
      if (this.ray.intersectBox(part.clearanceBounds, this.hit)
        && this.hit.distanceToSquared(this.ray.origin) <= lengthSq) return true;
    }
    return false;
  }

  snapshot(): { roofCount: number; hiddenBuildingIds: string[]; hiddenEntityIds: string[]; cutHeights: Record<string, number> } {
    return { roofCount: this.parts.length, hiddenBuildingIds: [...this.hiddenBuildings],
      hiddenEntityIds: [...this.hiddenEntities], cutHeights: Object.fromEntries(this.cutHeights) };
  }
}
