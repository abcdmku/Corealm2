/**
 * Named, repeatable camera poses for screenshots and the performance budget.
 *
 * Round 1's screenshots were all taken at one hardcoded yaw, which is why the "dungeon mouth" shot
 * and the "terraces" shot were the same two fence posts from different distances, and why the
 * Highcairn crane never appeared in the Highcairn shot. A pose has to say where the camera looks,
 * not only where the player stands, or the image cannot prove anything about composition.
 *
 * These same ids drive `npm run perf`, so the draw-call budget is measured at the dense poses
 * rather than only at the empty spawn view.
 *
 * FROZEN. Only the root edits this file.
 */
import type { RegionId } from "../contracts.js";

export interface CameraShot {
  id: string;
  /** Route-node id to stand at. Resolved through the navmesh so the pose lands on walkable ground. */
  locationId: string;
  /** Optional authored inspection point when the subject deliberately sits off the route shoulder. */
  position?: readonly [x: number, z: number];
  regionId: RegionId;
  /** Camera yaw in radians. 0 looks toward +z; increases clockwise seen from above. */
  yaw: number;
  pitch: number;
  distance: number;
  /** Optional player facing relative to the camera yaw. Defaults to PI (facing away). */
  playerFacingOffsetRad?: number;
  /** What this shot is supposed to show. Read this when judging whether the image succeeded. */
  intent: string;
}

const NORTH = 0;
const EAST = Math.PI * 0.5;
const SOUTH = Math.PI;
const WEST = Math.PI * 1.5;

export const SHOTS: readonly CameraShot[] = [
  {
    id: "magic_player_close", locationId: "spawn", regionId: "fallowmarch",
    yaw: SOUTH + 0.24, pitch: 0.28, distance: 3.2,
    playerFacingOffsetRad: -Math.PI * 0.5,
    intent: "Close three-quarter view of the held wand or staff, including its empty or socketed crown.",
  },
  {
    id: "spawn", locationId: "spawn", regionId: "fallowmarch",
    yaw: SOUTH, pitch: 0.5, distance: 20,
    intent: "The first frame. Coldbrace's south gate and the vault tower must be visible ahead.",
  },
  {
    id: "town_entrance", locationId: "town_entrance", regionId: "fallowmarch",
    yaw: SOUTH, pitch: 0.46, distance: 22,
    intent: "The gatehouse read: a walled town, not props on grass.",
  },
  {
    id: "town_center", locationId: "town_center", regionId: "fallowmarch",
    yaw: SOUTH + 0.6, pitch: 0.62, distance: 26,
    intent: "Coldbrace square with assembled buildings, the bank, and the road through it.",
  },
  {
    id: "bank", locationId: "bank_interior", regionId: "fallowmarch",
    // South-west, not due west, and closer. The chest moved: it used to stand alone on grass at
    // (-160, -88), which is the route node itself, so any yaw framed it. It now sits at
    // (-163.75, -90.4) under the Vault Counter porch, four metres SW of where the player stands,
    // and due west looked straight past it down the street. A pose that no longer contains its own
    // subject is a broken pose, not a broken settlement.
    yaw: SOUTH + Math.PI * 0.22, pitch: 0.62, distance: 19,
    intent: "The bank as a recognisable destination a player can navigate back to.",
  },
  {
    id: "bracken_pit", locationId: "bracken_pit", regionId: "fallowmarch",
    yaw: NORTH + 0.4, pitch: 0.62, distance: 18,
    intent: "Tier 1 Grithe seams. Ore must read as ore, and as tier 1, from this distance.",
  },
  {
    id: "palewood_copse", locationId: "palewood_copse", regionId: "fallowmarch",
    yaw: EAST, pitch: 0.58, distance: 18,
    intent: "Tier 1 woodcutting. Choppable trees distinguishable from scatter.",
  },
  {
    id: "redsill_shallows", locationId: "redsill_shallows", regionId: "fallowmarch",
    yaw: NORTH, pitch: 0.5, distance: 18,
    intent: "Fishing spots on real water.",
  },
  {
    id: "marchfield", locationId: "marchfield", regionId: "fallowmarch",
    yaw: WEST, pitch: 0.6, distance: 22,
    intent: "The restored farmhouse, outer paddock, gated hen pen, and nearby cattle.",
  },
  {
    id: "rootfall", locationId: "rootfall_hamlet", regionId: "vellenwood",
    yaw: SOUTH, pitch: 0.55, distance: 24,
    intent: "Oakwood from the respawn on the Green: the Counting House and bank porch across the deck, the forge and smith's cart to the east. Enclosed by canopy, not buried in it.",
  },
  {
    id: "vellenwood_canopy", locationId: "vellenwood_canopy", regionId: "vellenwood",
    yaw: EAST, pitch: 0.42, distance: 20,
    intent: "Deep woodland. Green, with shafted light and a legible ground path. The density worst case.",
  },
  {
    id: "hollowcut_seam", locationId: "hollowcut_seam", regionId: "vellenwood",
    yaw: NORTH, pitch: 0.6, distance: 18,
    intent: "Tier 5 ore, and the short bank route that makes it out-earn tier 10 before Agility 10.",
  },
  {
    id: "karrowmoor_terraces", locationId: "karrowmoor_terraces", regionId: "karrowmoor",
    // The ramps climb southeast from the lower quarry. Camera yaw is the orbit position, so the
    // camera belongs northwest of the player and looks back along that southeast ramp chain.
    yaw: NORTH - 0.45, pitch: 0.36, distance: 34,
    intent: "The verticality read. Four terraces stacked, with the ramps between them visible.",
  },
  {
    id: "highcairn", locationId: "highcairn_outpost", regionId: "karrowmoor",
    yaw: SOUTH, pitch: 0.72, distance: 28,
    intent: "The tier 10 outpost as a working quarry camp.",
  },
  {
    id: "upper_karrow_seam", locationId: "upper_karrow_seam", regionId: "karrowmoor",
    yaw: WEST, pitch: 0.55, distance: 20,
    intent: "Tier 10 Kaldite. Must read as a different, higher tier than the Grithe shot.",
  },
  {
    id: "sunder_ledge", locationId: "karrow_ramp_two", regionId: "karrowmoor",
    yaw: NORTH, pitch: 0.45, distance: 22,
    intent: "The Agility shortcut that flips the route maths. It must look climbable.",
  },
  {
    id: "gravelmaw_entrance", locationId: "gravelmaw_entrance", regionId: "karrowmoor",
    // Match the mouth's authored 1.05-radian approach bearing. From any other side the camera
    // looks through the arch toward daylight instead of into the rock mass behind it.
    yaw: 1.05, pitch: 0.34, distance: 24,
    intent: "A dark opening in a rock face, readable as a dungeon mouth from across the terrace.",
  },
  {
    id: "great_cairn", locationId: "great_cairn", regionId: "karrowmoor",
    yaw: WEST, pitch: 0.4, distance: 30,
    intent: "Karrowmoor's navigation landmark, visible against the sky.",
  },
  {
    id: "march_road", locationId: "north_milestone", regionId: "fallowmarch",
    yaw: SOUTH, pitch: 0.44, distance: 24,
    intent: "The road as a travel affordance: it should be obvious which way leads to town.",
  },
  {
    id: "region_gate", locationId: "fallowmarch_north_gate", regionId: "fallowmarch",
    yaw: EAST, pitch: 0.48, distance: 18,
    intent: "A region boundary gate with a readable arch, threshold, and road through it.",
  },
  {
    id: "west_track", locationId: "west_track", regionId: "fallowmarch",
    position: [-233, -64],
    yaw: 1.8, pitch: 0.5, distance: 15,
    intent: "The West Track waypost beside the three-way road.",
  },
  {
    id: "mire_skirt", locationId: "mire_skirt", regionId: "vellenwood",
    position: [0, 124],
    yaw: EAST, pitch: 0.5, distance: 16,
    intent: "The Mire Skirt trailhead on the dry shoulder beside the standing water.",
  },
  {
    id: "lower_quarry_waystone", locationId: "karrowmoor_terraces", regionId: "karrowmoor",
    // Stand just beyond the cairn from the camera so the marker, rather than the avatar, owns
    // the centre of the inspection frame.
    position: [73.7, -10.2],
    yaw: 1.5, pitch: 0.48, distance: 16,
    intent: "The Lower Quarry waystone marking the split toward Highcairn and the Gravelmaw.",
  },
  {
    id: "root_tunnel", locationId: "rootfall_hamlet", regionId: "vellenwood",
    // Inspect from the open trail side. The arch is nearly symmetric front-to-back, while this
    // target keeps the camera clear of the postern and lets the complete structure stay in frame.
    position: [89, 130.5],
    yaw: EAST, pitch: 0.4, distance: 16,
    intent: "The Root Tunnel entrance, with its arch and root bracing at the trail split.",
  },
  {
    id: "canopy_walk", locationId: "rootfall_hamlet", regionId: "vellenwood",
    // Stay outside the west wall on the approach from its gate, with the trailhead beyond the
    // player rather than between the camera and its collision target.
    position: [40.5, 134.8],
    yaw: 3.1, pitch: 0.36, distance: 15,
    intent: "The Canopy Walk trailhead, with its raised balcony and clear approach.",
  },

  // ---------------------------------------------------------------- Kilnhalt (Phase 2)
  {
    id: "kilnhalt_seam", locationId: "kilnroad_fork", regionId: "kilnhalt",
    // Camera south of the fork looking north: the old border band behind the player, the open
    // walk into the ember foothills ahead, and Emberfast's rampart up the road.
    yaw: SOUTH, pitch: 0.42, distance: 26,
    intent: "The open northern band: continuous ground across the old z=200 edge, no gate, warm footland ahead.",
  },
  {
    id: "emberfast", locationId: "emberfast_town", regionId: "kilnhalt",
    yaw: SOUTH, pitch: 0.72, distance: 28,
    intent: "The tier 20 kiln camp: walls, forge, market and works rows, and the ore cart in one yard. Kilnhalt's densest view.",
  },
  {
    id: "clinker_quarry", locationId: "clinker_quarry", regionId: "kilnhalt",
    yaw: EAST, pitch: 0.58, distance: 20,
    intent: "Tier 20 Emberite seams and Kilnstone faces. Must read hotter and higher-tier than Kaldite.",
  },
  {
    id: "cinderpine_stand", locationId: "cinderpine_stand", regionId: "kilnhalt",
    yaw: WEST, pitch: 0.5, distance: 20,
    intent: "Sparse burned woodland: scorched but choppable Cinderpine against open warm ground.",
  },
  {
    id: "ashfin_springs", locationId: "ashfin_springs", regionId: "kilnhalt",
    yaw: NORTH, pitch: 0.5, distance: 18,
    intent: "Warm spring pools with fishing spots on real water.",
  },
  {
    id: "kilnhalt_fire_altar", locationId: "kilnhalt_fire_cache", regionId: "kilnhalt",
    yaw: EAST, pitch: 0.46, distance: 22,
    intent: "The Fire altar ruins: a levelled stone court ringed by Fire Essence, dormant until Cinderwake's Orb.",
  },
  {
    id: "cinderwake_arena", locationId: "cinderwake_arena", regionId: "kilnhalt",
    yaw: NORTH + 0.4, pitch: 0.42, distance: 24,
    intent: "Cinderwake on its swept arena floor, visibly a miniboss: above the roster, below the Orb bosses.",
  },
];

export function shotIds(): string[] {
  return SHOTS.map((shot) => shot.id);
}

export function findShot(id: string): CameraShot | undefined {
  return SHOTS.find((shot) => shot.id === id);
}
