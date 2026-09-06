import * as THREE from 'three';
import type {SemanticEntity} from '../contracts.js';
import type {AssetRegistry} from './assets.js';
import type {StructureNavigationSources} from './structureNavigation.js';
import {ROOTFALL_STUMP} from '../world/rootfallStump.js';

/** The same native stump cut face and stone treads used by the visible composition. */
export async function buildRootfallNavigationSources(
  assets: Pick<AssetRegistry, 'load' | 'instance'>,
  entities: readonly SemanticEntity[],
): Promise<StructureNavigationSources> {
  const owners = entities.filter(entity => entity.view?.assetId === ROOTFALL_STUMP.assetId
    && (entity.id === 'rootfall_stump' || entity.meta?.structureId === 'rootfall_stump'));
  const ownerIds = new Set(owners.map(entity => entity.id));
  const targets = entities.filter(entity => ownerIds.has(entity.id)
    || (entity.view?.assetId === 'stairs_exterior' && [...ownerIds].some(id => entity.id.startsWith(`${id}#step_`))));
  await Promise.all([...new Set(targets.map(entity => entity.view!.assetId))].map(id => assets.load(id)));
  const roots: THREE.Group[] = [], meshes: THREE.Mesh[] = [];
  for (const entity of targets) {
    const view = entity.view!, root = assets.instance(view.assetId);
    root.name = `navigation:${entity.id}`;
    root.position.fromArray(entity.position);
    root.rotation.y = view.rotationY ?? 0;
    const scale = view.scale ?? 1, axes = view.scaleAxes ?? [1, 1, 1];
    root.scale.set(scale * axes[0], scale * axes[1], scale * axes[2]);
    root.updateMatrixWorld(true);
    root.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      mesh.userData['structureNavigation'] = entity.id;
      meshes.push(mesh);
    });
    roots.push(root);
  }
  return {roots, meshes};
}
