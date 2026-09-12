import type { HabitatDef } from "../content/worldHabitats.js";
import type { WorldSite } from "../content/worldSites.js";
import type { SolidVolume } from "../contracts.js";
import type { AssetRegistry } from "../render/assets.js";
import type { WorldScene } from "../render/scene.js";
import { buildWorldSiteDressing, resolveWorldSiteDressing, type WorldSiteDressingResult } from "../render/worldSiteDressing.js";

export function regionalPackDressingSite(habitat: HabitatDef): WorldSite {
  return { id: habitat.id, locationId: habitat.groupId, regionId: habitat.regionId,
    centre: [0, 0], rotationY: 0, kind: "habitat", workRadius: 0, extent: [0, 0],
    terrain: { floorRadius: 0, backRise: 0, backDistance: 0, bermWidth: 0, approachAngle: 0 },
    resourceSlots: [], dressing: habitat.dressing };
}

/** Production instancing and grounding shared by compact pack fixtures and final settings.
 * The ordinary site builder already supplies rock/crate/barrel boxes. Add measured boxes for
 * the remaining wall, altar, fence and whetstone pieces so an encounter never walks through
 * its own setting. Both callers install these solids before generating their navmesh. */
export async function buildRegionalPackDressing(
  scene: WorldScene, assets: AssetRegistry, habitat: HabitatDef,
  largestResidentBodyRadius = 0, render = true,
): Promise<WorldSiteDressingResult & { navigationSolids: SolidVolume[] }> {
  if (!Number.isFinite(largestResidentBodyRadius) || largestResidentBodyRadius < 0)
    throw new Error("Invalid encounter navigation body radius");
  const site = regionalPackDressingSite(habitat);
  const result = render ? await buildWorldSiteDressing(scene, assets, site) : resolveWorldSiteDressing(scene, assets, site);
  const existing = new Set(result.solids.map((solid) => solid.id));
  const solids: SolidVolume[] = [...result.solids, ...result.placements.filter((piece) => !existing.has(piece.id)).map((piece) => ({
    kind: "box" as const, id: piece.id,
    position: [piece.position[0] + piece.centreOffset[0],
      piece.position[1] + assets.baseY(piece.assetId) * (typeof piece.scale === "number" ? piece.scale : piece.scale[1]),
      piece.position[2] + piece.centreOffset[1]] as [number, number, number],
    size: piece.size, rotationY: piece.rotationY,
  }))];
  // Recast is shared with the player. Its nominal erosion cannot fit a large resident around
  // these corners, so only the nav input grows. Physical collision remains measured geometry.
  const margin = largestResidentBodyRadius + 0.15;
  const navigationSolids = solids.map((solid): SolidVolume => solid.kind === "box" ? {
    ...solid, size: [solid.size[0] + margin * 2, solid.size[1], solid.size[2] + margin * 2],
  } : { ...solid, radius: solid.radius + margin });
  return { ...result, solids, navigationSolids };
}
