import * as THREE from 'three';
import type { SemanticEntity } from '../contracts.js';
import type { AssetRegistry } from './assets.js';
import type { StructureNavigationSources } from './structureNavigation.js';
import { CROWNWARD_BRIDGE } from './compositions/crownwardBridge.js';

/**
 * The imported arch is the walkable surface. Supplying all original triangles also preserves
 * the rails for navigation and camera queries without a flat collider sealing the river below.
 * A separate placement parent retains the GLB's source normalization transform.
 */
export async function buildCrownwardBridgeNavigationSources(
  assets: Pick<AssetRegistry, 'load' | 'instance'>,
  entities: readonly SemanticEntity[],
): Promise<StructureNavigationSources> {
  const targets = entities.filter(entity => entity.view?.assetId === CROWNWARD_BRIDGE.assetId);
  if (!targets.length) return { roots: [], meshes: [] };
  await assets.load(CROWNWARD_BRIDGE.assetId);
  const roots: THREE.Group[] = [], meshes: THREE.Mesh[] = [];
  for (const entity of targets) {
    const view = entity.view!, root = new THREE.Group();
    root.name = `navigation:${entity.id}`;
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
    root.add(assets.instance(view.assetId));
    root.updateMatrixWorld(true);
    root.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh || (mesh as THREE.InstancedMesh).isInstancedMesh
        || (mesh as THREE.BatchedMesh).isBatchedMesh) {
        throw new Error(`Bridge ${entity.id} requires ordinary static source meshes`);
      }
      mesh.userData['structureNavigation'] = entity.id;
      mesh.userData['structureCamera'] = entity.id;
      meshes.push(mesh);
    });
    roots.push(root);
  }
  return { roots, meshes };
}
