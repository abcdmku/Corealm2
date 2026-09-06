import { treeSpeciesForAsset } from "../content/treeSpecies.js";
import { Matrix4, Vector3, type Object3D } from "three";
import type { Vec3 } from "../contracts.js";
import type { AssetRegistry } from "../render/assets.js";
import type { WorldScene } from "../render/scene.js";
import type { ForestTreeDescriptor } from "../world/forestResources.js";

interface ForestFixtureDeps {
  assets: AssetRegistry;
  scene: WorldScene;
  registerTree: (descriptor: ForestTreeDescriptor, setVisible: (visible: boolean) => void) => void;
}

/** A deterministic woodland lane beside the combat yard, sharing the real forest controller. */
export async function createForestFixture({ assets, scene, registerTree }: ForestFixtureDeps): Promise<{
  entityIds: string[];
  trees: ForestTreeDescriptor[];
  getScatterVisibility: () => Record<string, boolean>;
  objects: Object3D[];
}> {
  // The cottage is west of the combat lane, centred at (-8,12). These canopy centres leave
  // both structures and the lane clear while covering the 35 m / 50 m residency boundaries.
  const layout = [
    { species: "oak", variant: 1, x: 18, z: 3, scale: 0.72, yaw: 0.2, radius: 0.48 },
    { species: "oak", variant: 2, x: 28, z: 2, scale: 1.02, yaw: 1.3, radius: 0.44 },
    { species: "oak", variant: 3, x: 41, z: 5, scale: 0.86, yaw: 2.6, radius: 0.30 },
    { species: "oak", variant: 2, x: 20, z: 16, scale: 0.9, yaw: 0.8, radius: 0.44 },
    { species: "oak", variant: 1, x: 31, z: 17, scale: 1.08, yaw: 2.1, radius: 0.48 },
    { species: "oak", variant: 3, x: 42, z: 20, scale: 0.72, yaw: 4.4, radius: 0.30 },
    { species: "oak", variant: 3, x: 18, z: 31, scale: 1.14, yaw: 3.2, radius: 0.30 },
    { species: "oak", variant: 1, x: 29, z: 33, scale: 0.94, yaw: 5.3, radius: 0.48 },
    { species: "oak", variant: 2, x: 40, z: 35, scale: 1.06, yaw: 1.7, radius: 0.44 },
    { species: "oak", variant: 1, x: 20, z: 47, scale: 0.8, yaw: 4.1, radius: 0.48 },
    { species: "pine", variant: 1, x: 31, z: 49, scale: 1.04, yaw: 0.9, radius: 0.34 },
    { species: "pine", variant: 2, x: 42, z: 48, scale: 0.84, yaw: 3.7, radius: 0.32 },
  ] as const;
  const assetIds = [...new Set(layout.map((row) => `corealm_${row.species}_${row.variant}`))];
  for (const assetId of assetIds) {
    const size = assets.assetSize(assetId);
    if (!size || !Object.values(size).every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error(`Missing forest fixture model measurements: ${assetId}`);
    }
  }
  await Promise.all([...assetIds, "corealm_stump_oak", "corealm_stump_pine"].map((assetId) =>
    assets.load(assetId, { priority: "visible-spawn", primary: true })));

  const counts = { oak: 0, pine: 0 };
  const trees: ForestTreeDescriptor[] = layout.map((row) => {
    const assetId = `corealm_${row.species}_${row.variant}`;
    const centre = assets.assetCenterXZ(assetId)!;
    const cos = Math.cos(row.yaw);
    const sin = Math.sin(row.yaw);
    const x = row.x - row.scale * (centre.x * cos + centre.z * sin);
    const z = row.z - row.scale * (-centre.x * sin + centre.z * cos);
    const position: Vec3 = [x, scene.meshHeightAt(x, z) - assets.baseY(assetId) * row.scale, z];
    return {
      id: `feature-lab:forest:${row.species}:${++counts[row.species]}`,
      resourceId: treeSpeciesForAsset(assetId)!.resourceId,
      regionId: "fallowmarch",
      position,
      assetId,
      scale: row.scale,
      rotationY: row.yaw,
      // Authored native trunk dimensions, matching the production scatter species table.
      trunkRadius: (assets.entry(assetId)!.trunkRadius ?? treeSpeciesForAsset(assetId)!.trunkRadius) * row.scale,
    };
  });

  const objects: Object3D[] = [];
  const scatterSlots = new Map<string, () => boolean>();
  for (const assetId of assetIds) {
    const group = trees.filter((tree) => tree.assetId === assetId);
    const meshes = scene.scatterInstanced(assets.instance(assetId), group.map((tree) => ({
      position: tree.position, rotationY: tree.rotationY, scale: tree.scale, tilt: 0,
    })), `feature-lab-forest-${assetId}`, { regionId: "fallowmarch", castShadow: true, windStrength: 0.035 });
    if (!meshes.length) throw new Error(`Forest fixture model has no renderable primitives: ${assetId}`);
    objects.push(...meshes);
    for (const [slot, tree] of group.entries()) {
      scatterSlots.set(tree.id, () => {
        const matrix = new Matrix4();
        return meshes.every(mesh => {
          mesh.getMatrixAt(slot, matrix);
          return Math.abs(matrix.determinant()) > 1e-8;
        });
      });
      const originals = meshes.map((mesh) => {
        const matrix = new Matrix4();
        mesh.getMatrixAt(slot, matrix);
        return matrix;
      });
      const hidden = originals.map((matrix) => matrix.clone().scale(new Vector3(0, 0, 0)));
      let visible = true;
      registerTree(tree, (nextVisible) => {
        if (visible === nextVisible) return;
        visible = nextVisible;
        for (const [primitive, mesh] of meshes.entries()) {
          mesh.setMatrixAt(slot, (visible ? originals : hidden)[primitive]!);
          mesh.instanceMatrix.needsUpdate = true;
        }
      });
    }
  }
  return { entityIds: trees.map((tree) => tree.id), trees, objects,
    getScatterVisibility: () => Object.fromEntries([...scatterSlots].map(([id, visible]) => [id, visible()])) };
}
