import type { FeatureLabPresentationView, SemanticEntity, Vec3 } from "../contracts.js";
import { respawnSeconds, yieldRange } from "../content/index.js";
import { resourceDef } from "../content/resources.js";
import { tierSilhouetteScale } from "../core/math.js";
import { Rng } from "../core/rng.js";
import { GRASS_COLOURS } from "../render/artDirection.js";
import type { AssetRegistry } from "../render/assets.js";
import type { EntityViews } from "../render/entityViews.js";
import type { GrassSpritePlacement, ScatterPlacement, WorldScene } from "../render/scene.js";
import type { EntityStore } from "../world/entities.js";

interface PresentationFixtureDeps {
  readonly assets: AssetRegistry;
  readonly scene: WorldScene;
  readonly entityStore: EntityStore;
  readonly entityViews: EntityViews;
  readonly rebuilt?: boolean;
}

const REGION_ID = "fallowmarch";
const FERN_ASSET_ID = "fern_1";

/**
 * A compact material and gathering scene beside the existing combat lane. Rendering and resource
 * state use the same paths as the world; the fixture adds no simulation or collision claim.
 */
export async function createPresentationFixture({
  assets, scene, entityStore, entityViews, rebuilt = false,
}: PresentationFixtureDeps): Promise<FeatureLabPresentationView> {
  const tree = createResource("tree_palewood", [7, 10]);
  const ore = createResource("ore_grithe", [6, 4]);
  const resources = [tree, ore];
  const treeAssetId = tree.view!.assetId;
  const fernAssetId = rebuilt ? "corealm_fern_1" : FERN_ASSET_ID;
  requireSize(fernAssetId);

  // Finish all asset work before adding entities or scatter to the live yard.
  const [prepared, treeSource, fernSource] = await Promise.all([
    entityViews.prepare(resources),
    assets.load(treeAssetId, { priority: "visible-spawn", primary: true }),
    assets.load(fernAssetId, { priority: "visible-spawn", primary: true }),
  ]);
  if (prepared.missing.length > 0) {
    throw new Error(`Missing production presentation assets: ${prepared.missing.join(", ")}`);
  }

  // EntityViews applies the tier multiplier. Instanced scatter receives the resulting drawn scale
  // directly so the two copies have equal dimensions, including their grounded asset origins.
  const treeScale = tree.view!.scale! * tierSilhouetteScale(tree.view!.materialTier ?? tree.tier);
  const decorativeTrees: ScatterPlacement[] = [{
    position: groundAsset(treeAssetId, 13, 10, treeScale),
    rotationY: tree.view!.rotationY ?? 0,
    scale: treeScale,
  }];
  const fernSpots = [[8.7, 8.1, 0.64], [10, 10.7, 0.5], [11.4, 8.7, 0.7]] as const;
  const ferns: ScatterPlacement[] = fernSpots.map(([x, z, scale], index) => ({
    position: groundAsset(fernAssetId, x, z, scale),
    rotationY: index * 2.1 + 0.4,
    scale,
  }));
  const grass: GrassSpritePlacement[] = [];
  const rng = new Rng(0x70616c65);
  for (let index = 0; index < 110; index += 1) {
    const angle = rng.float(0, Math.PI * 2);
    const radius = Math.sqrt(rng.next());
    const x = 10 + Math.cos(angle) * radius * 4.2;
    const z = 9.8 + Math.sin(angle) * radius * 2.7;
    // Keep the trunks readable and leave the open approach to the ore and combat target bare.
    if (Math.hypot(x - 7, z - 10) < 0.7 || Math.hypot(x - 13, z - 10) < 0.7) continue;
    grass.push({
      position: [x, scene.meshHeightAt(x, z), z],
      rotationY: rng.float(0, Math.PI),
      width: rng.float(0.65, 1.05),
      height: rng.float(0.32, 0.6),
      colour: index % 5 === 0 ? GRASS_COLOURS.dry : GRASS_COLOURS.green,
    });
  }

  for (const entity of resources) entityStore.add(entity);
  entityViews.sync(entityStore.all());
  scene.scatterInstanced(treeSource, decorativeTrees, "feature-lab-presentation-tree", {
    regionId: REGION_ID, windStrength: 0.055,
  });
  scene.scatterInstanced(fernSource, ferns, "feature-lab-presentation-fern", {
    regionId: REGION_ID, castShadow: false, windStrength: 0.065,
  });
  scene.scatterGrassSprites(grass, "feature-lab-presentation-grass", { regionId: REGION_ID });

  return {
    enabled: true,
    resourceEntityIds: resources.map((entity) => entity.id),
    scatterInstances: decorativeTrees.length + ferns.length + grass.length,
  };

  function requireSize(assetId: string): { x: number; y: number; z: number } {
    const size = assets.assetSize(assetId);
    if (!size || !Object.values(size).every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error(`Missing production presentation asset measurements: ${assetId}`);
    }
    return size;
  }

  function groundAsset(assetId: string, x: number, z: number, scale: number): Vec3 {
    return [x, scene.meshHeightAt(x, z) - assets.baseY(assetId) * scale, z];
  }

  function createResource(resourceId: string, [x, z]: readonly [number, number]): SemanticEntity {
    const resource = resourceDef(resourceId);
    const assetId = rebuilt
      ? resource.archetype === "tree" ? "corealm_oak_1" : "corealm_ore_grithe"
      : resource.presentation.availableAssetIds[0];
    if (!assetId) throw new Error(`Resource "${resource.id}" has no production presentation asset`);
    const size = requireSize(assetId);
    const drawnScale = resource.presentation.targetWorldSize / Math.max(size.x, size.y, size.z);
    const maxYields = (resource.yieldRange ?? yieldRange(resource.tier))[0];
    return {
      id: `feature-lab:presentation:${resource.id}`,
      name: resource.name,
      archetype: resource.archetype,
      tier: resource.tier,
      regionId: REGION_ID,
      position: groundAsset(assetId, x, z, drawnScale),
      state: "available",
      requirements: { [resource.skill]: resource.reqLevel },
      interactions: ["inspect", resource.archetype === "tree" ? "chop" : "mine"],
      resource: {
        remaining: maxYields,
        maxYields,
        respawnSeconds: resource.respawnSeconds ?? respawnSeconds(resource.tier),
        itemId: resource.itemId,
      },
      view: {
        assetId,
        depletedAssetId: rebuilt
          ? resource.archetype === "tree" ? "corealm_stump_oak" : "corealm_ore_grithe_spent"
          : resource.presentation.depletedAssetId,
        scale: drawnScale / tierSilhouetteScale(resource.presentation.materialTier),
        materialTier: resource.presentation.materialTier,
        rotationY: 0.45,
        labelHeight: resource.archetype === "tree" ? 6.5 : 2.6,
      },
      meta: { resourceId: resource.id, skill: resource.skill, featureLab: true },
    };
  }
}
