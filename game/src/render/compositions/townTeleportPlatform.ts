import type { BuildingKit, PartPlacement } from "../buildings.js";

/**
 * A low, walkable landing with a distinct stone setting for each settlement vernacular.
 * The three authored albedo maps change the tesserae and centre geometry, not just the hue.
 * The mosaic sits flush with the walkable ground, with only its shallow rim above it.
 */
export function buildTownTeleportPlatformComposition(seed: number, kit: BuildingKit): PartPlacement[] {
  const quarterTurn = Number.isFinite(seed) ? ((Math.trunc(seed) % 4) + 4) % 4 : 0;
  return [{
    tag: "travel_mosaic",
    assetId: `town_teleport_platform_${kit.id}`,
    dx: 0,
    dy: -0.10,
    dz: 0,
    rotationY: quarterTurn * Math.PI / 2,
    scale: 1,
  }];
}
