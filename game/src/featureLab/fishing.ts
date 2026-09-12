import type { SemanticEntity } from "../contracts.js";
import { fishingSiteAnchors } from "../app/fishingAccess.js";
import { respawnSeconds, yieldRange } from "../content/index.js";
import { REGIONS } from "../content/regions.js";
import { resourceDef } from "../content/resources.js";
import { WORLD_SITES, type WorldSite } from "../content/worldSites.js";
import { tierSilhouetteScale } from "../core/math.js";
import type { AssetRegistry } from "../render/assets.js";
import type { WorldScene } from "../render/scene.js";
import { WATER_FILL_DEPTH, waterBasinForCluster } from "../world/waterBodies.js";
import { crownwardFisheries } from '../content/crownwardFishing.js';
import { CROWNWARD_RIVER_LAB_CHANNELS } from '../content/crownwardRiver.js';

const redsillSite = WORLD_SITES.find((site) => site.id === "redsill_bank");
const redsillCluster = REGIONS.flatMap((region) => region.clusters).find((cluster) => cluster.id === "redsill_spots");
if (!redsillSite || !redsillCluster) throw new Error("The fishing lab requires the production Redsill fishery");

/** The authored fishery is translated intact to the north end of the compact yard. */
export const FISHING_LAB_SITE: WorldSite = { ...redsillSite, centre: [0, 75] };
export const FISHING_LAB_BASIN = waterBasinForCluster({ ...redsillCluster, centre: FISHING_LAB_SITE.centre });

/** Called after the shared height lattice exists, before its terrain chunks are shaded. */
export function prepareFishingLabSurface(scene: WorldScene): void {
  if (new URLSearchParams(location.search).get('fishing') === 'crownward') return;
  const basin = FISHING_LAB_BASIN;
  const level = scene.heightAt(FISHING_LAB_SITE.regionId, basin.x, basin.z) + WATER_FILL_DEPTH;
  scene.setGroundStamps({
    roads: [], paving: [], seed: 1337,
    water: [{ centre: [basin.x, basin.z], radius: basin.crestRadius, level, shape: basin.shape }],
  });
  const water = scene.buildWater({
    minX: basin.x - basin.crestRadius, maxX: basin.x + basin.crestRadius,
    minZ: basin.z - basin.crestRadius, maxZ: basin.z + basin.crestRadius,
  }, level, FISHING_LAB_SITE.regionId);
  if (!water) throw new Error("The production fishing lab basin did not produce an enclosed water body");
}

/** EntityViews, gathering, navigation and input consume these ordinary production resource rows. */
export function createFishingLabEntities(scene: WorldScene, assets: AssetRegistry): SemanticEntity[] {
  if (new URLSearchParams(location.search).get('fishing') === 'crownward') {
    const fixture = crownwardFisheries(CROWNWARD_RIVER_LAB_CHANNELS);
    const anchors = fishingSiteAnchors(fixture.sites, scene.getWaterBodies(), (x, z) => scene.meshHeightAt(x, z));
    return fixture.sites.flatMap(site => createSiteEntities(site,
      resourceDef(fixture.clusters.find(cluster => cluster.locationId === site.id)!.resourceId), anchors, assets));
  }
  const waterBodies = scene.getWaterBodies();
  const body = waterBodies.find((candidate) => candidate.id === FISHING_LAB_BASIN.id);
  if (!body?.closed || body.error) throw new Error("Build the fishing lab water surface before its resources");
  const anchors = fishingSiteAnchors([FISHING_LAB_SITE], waterBodies, (x, z) => scene.meshHeightAt(x, z));
  const resource = resourceDef(redsillCluster!.resourceId);
  return createSiteEntities(FISHING_LAB_SITE, resource, anchors, assets);
}

function createSiteEntities(site: WorldSite, resource: ReturnType<typeof resourceDef>,
  anchors: ReturnType<typeof fishingSiteAnchors>, assets: AssetRegistry): SemanticEntity[] {
  const assetId = resource.presentation.availableAssetIds[0];
  if (!assetId) throw new Error(`Resource ${resource.id} has no production fish model`);
  const size = assets.assetSize(assetId);
  if (!size || !Object.values(size).every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error(`Missing production fish model measurements: ${assetId}`);
  }
  const scale = resource.presentation.targetWorldSize / Math.max(size.x, size.y, size.z)
    / tierSilhouetteScale(resource.tier);
  const maxYields = (resource.yieldRange ?? yieldRange(resource.tier))[0];

  return site.resourceSlots.map((slot): SemanticEntity => {
    const id = `${slot.clusterId}_${slot.index}`;
    const school = anchors.schools.get(id);
    if (!school) throw new Error(`Fishing lab resource ${id} has no solved near-shore school`);
    const interactionPosition = anchors.banks.get(id);
    if (!interactionPosition) throw new Error(`Fishing lab resource ${id} has no dry casting position`);
    return {
      id, name: resource.name, archetype: resource.archetype, tier: resource.tier,
      regionId: site.regionId,
      // Match production: the surface proxy stays at water level; EntityViews applies waterOffset.
      position: school, interactionPosition,
      state: "available", interactions: ["inspect", "fish"], requirements: { [resource.skill]: resource.reqLevel },
      resource: {
        remaining: maxYields, maxYields, itemId: resource.itemId,
        respawnSeconds: resource.respawnSeconds ?? respawnSeconds(resource.tier),
      },
      view: {
        assetId, scale: scale * slot.scale, rotationY: site.rotationY + slot.yaw,
        materialTier: resource.presentation.materialTier, labelHeight: 1.5,
        ...(resource.presentation.depletedAssetId ? { depletedAssetId: resource.presentation.depletedAssetId } : {}),
      },
      meta: {
        resourceId: resource.id, clusterId: slot.clusterId, locationId: site.locationId,
        worldSiteId: site.id, skill: resource.skill,
        ...(resource.presentation.waterOffset === undefined ? {} : { waterOffset: resource.presentation.waterOffset }),
      },
    };
  });
}
