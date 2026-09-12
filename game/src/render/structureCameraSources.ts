import * as THREE from "three";
import { roofOwner, structureOwner } from "./roofVisibility.js";
import type { SemanticEntity } from "../contracts.js";
import type { AssetLoadOptions, AssetRegistry } from "./assets.js";

export interface StructureCameraSources {
  /** Detached owners; geometry and materials remain owned by the asset registry. */
  roots: THREE.Group[];
  /** Original structural triangles, for StaticCameraQueries only, never navigation. */
  meshes: THREE.Mesh[];
}

function isStructurePart(entity: SemanticEntity): boolean {
  if (entity.archetype !== "landmark" || !entity.view || !entity.id.includes("#")) return false;
  const meta = entity.meta;
  return typeof meta?.buildingId === "string" || typeof meta?.prefab === "string"
    || typeof meta?.wallRunId === "string"
    || (meta?.featureLab === true && (meta.structureKind === "prefab"
      || meta.structureKind === "wall-run"
      || (meta.structureKind === "composition" && entity.id.includes("#host_"))));
}

/**
 * Physical building boxes intentionally omit walk-under roofs and projecting balconies.
 * The camera still needs their exact drawn surfaces. Keep these sources separate from the
 * player's navigation sources so adding a canopy never seals the passage beneath it.
 */
export async function buildStructureCameraSources(
  assets: Pick<AssetRegistry, "load" | "instance">,
  entities: readonly SemanticEntity[],
  options: AssetLoadOptions = {},
): Promise<StructureCameraSources> {
  const targets = entities.filter(isStructurePart);
  await Promise.all([...new Set(targets.map(entity => entity.view!.assetId))].map(id => assets.load(id, options)));
  const roots: THREE.Group[] = [], meshes: THREE.Mesh[] = [];
  for (const entity of targets) {
    const view = entity.view!;
    const root = new THREE.Group();
    root.name = `camera:${entity.id}`;
    root.position.fromArray(entity.position);
    root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), view.rotationY ?? 0);
    if (view.groundNormal && (view.tiltStrength ?? 0) > 0) {
      const normal = new THREE.Vector3(...view.groundNormal);
      if (normal.lengthSq() >= 1e-6) {
        const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal.normalize());
        root.quaternion.premultiply(new THREE.Quaternion().slerp(tilt, Math.min(1, view.tiltStrength!)));
      }
    }
    const scale = view.scale ?? 1, axes = view.scaleAxes ?? [1, 1, 1];
    root.scale.set(scale * axes[0], scale * axes[1], scale * axes[2]);
    // EntityViews multiplies the placed entity matrix by each original source matrixWorld.
    // A separate parent preserves a non-identity GLB root instead of overwriting that transform.
    root.add(assets.instance(view.assetId));
    root.updateMatrixWorld(true);
    root.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh || (mesh as THREE.InstancedMesh).isInstancedMesh
        || (mesh as THREE.BatchedMesh).isBatchedMesh) {
        throw new Error(`Camera structure ${entity.id} requires ordinary static source meshes`);
      }
      mesh.userData["structureCamera"] = entity.id;
      mesh.userData["roofOwner"] = roofOwner(entity);
      mesh.userData["structureOwner"] = structureOwner(entity);
      mesh.userData["structureAnchorY"] = entity.position[1];
      meshes.push(mesh);
    });
    roots.push(root);
  }
  return { roots, meshes };
}

/** Camera triangles follow the visual working set. Already installed sources remain reusable. */
export class StructureCameraStreaming {
  readonly sources: StructureCameraSources = { roots: [], meshes: [] };
  private readonly ready = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly assets: AssetRegistry, private readonly install: (sources: StructureCameraSources) => void) {}

  prepare(entities: readonly SemanticEntity[], options: AssetLoadOptions): Promise<void> {
    const targets = entities.filter(isStructurePart);
    // Queue the downloads immediately; serialize only registration to avoid duplicate camera rows.
    const downloaded = Promise.all([...new Set(targets.map(entity => entity.view!.assetId))]
      .map(id => this.assets.load(id, options)));
    void downloaded.catch(() => {});
    return downloaded.then(() => {
      const work = this.queue.then(async () => {
        const missing = targets.filter(entity => !this.ready.has(entity.id));
        if (!missing.length) return;
        const sources = await buildStructureCameraSources(this.assets, missing, options);
        this.install(sources);
        this.sources.roots.push(...sources.roots);
        this.sources.meshes.push(...sources.meshes);
        for (const entity of missing) this.ready.add(entity.id);
      });
      this.queue = work.catch(() => {});
      return work;
    });
  }
}
