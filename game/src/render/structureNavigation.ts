/**
 * Navigation and camera-collision geometry for imported structures whose usable surfaces and
 * openings cannot be represented by one manifest bounding box.
 *
 * Altar Ruins Free is the first such asset: one 20 m box would seal every arch and make the whole
 * court unwalkable, while no collision lets the player pass through its columns and walls. Recast
 * already accepts rendered triangle geometry, so this keeps the authored platform, stairs,
 * openings, and broken wall profiles instead of replacing them with a second hand-built model.
 */
import * as THREE from "three";
import type { SemanticEntity } from "../contracts.js";
import type { AssetRegistry } from "./assets.js";
import { buildRootfallNavigationSources } from "./rootfallNavigation.js";

export interface StructureNavigationSources {
  /** Keeps each cloned hierarchy alive while its child meshes are in use. */
  roots: THREE.Group[];
  /** Exact structural meshes supplied to Recast and Rapier. */
  meshes: THREE.Mesh[];
}

type StructureNavigationAssets = Pick<AssetRegistry, "load" | "instance">;

/** Rubble stays step-over dressing. Everything named here is standing or walkable architecture. */
const ALTAR_RUINS_STRUCTURE = /^(?:Arch_|Broken_column|Gate|Platform_circle|Stone_post|Stone_slab|Stone_structure|Wall_)/;

function isAltarRuins(entity: SemanticEntity): boolean {
  return entity.view?.assetId === "altar_ruins_site" && entity.meta?.essenceAltarRuins === true;
}

/** Builds exact, transformed collision sources for every regional altar ruin in `entities`. */
export async function buildStructureNavigationSources(
  assets: StructureNavigationAssets,
  entities: readonly SemanticEntity[],
): Promise<StructureNavigationSources> {
  const rootfall = await buildRootfallNavigationSources(assets, entities);
  const targets = entities.filter(isAltarRuins);
  if (targets.length === 0) return rootfall;

  await assets.load("altar_ruins_site");
  const roots: THREE.Group[] = [...rootfall.roots];
  const meshes: THREE.Mesh[] = [...rootfall.meshes];

  for (const entity of targets) {
    const view = entity.view!;
    const root = assets.instance(view.assetId);
    const scale = view.scale ?? 1;
    root.name = `navigation:${entity.id}`;
    root.position.set(entity.position[0], entity.position[1], entity.position[2]);
    root.rotation.y = view.rotationY ?? 0;
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry || !ALTAR_RUINS_STRUCTURE.test(mesh.name)) return;
      mesh.userData["structureNavigation"] = entity.id;
      meshes.push(mesh);
    });
    roots.push(root);
  }

  return { roots, meshes };
}
