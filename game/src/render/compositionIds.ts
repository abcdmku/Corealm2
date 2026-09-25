import { CROWNWARD_CASTLE_IDS, type CrownwardCastleId } from "./compositions/crownwardCastles.js";
import { WILDERNESS_RUIN_IDS, type WildernessRuinId } from "./compositions/wildernessRuins.js";

/**
 * Every composition id the renderer can build, as data: this module loads no content table and
 * no geometry, so the content compiler checks a record's `composition` against the running build
 * (`ref('composition')`) and an id this build removed fails a publish or a server's start with a
 * clear message instead of an empty part list deep in world assembly. `buildComposition` in
 * `buildings.ts` assembles each one.
 */
export const DEEP_WILDERNESS_STRUCTURE_IDS = [
  'cinder_chain_foundry', 'nightforge_bastion', 'hollow_star_sanctum',
] as const;
export type DeepWildernessStructureId = typeof DEEP_WILDERNESS_STRUCTURE_IDS[number];

/**
 * A hand-authored set-dressing group for a landmark, a region gate, or the dungeon mouth.
 *
 * Finding 8 of the round-1 critique: a landmark drawn as one stand-in prop gives the player no
 * silhouette to navigate by. Each id here is a small composition of real parts around the
 * landmark's own hero mesh.
 */
export type CompositionId =
  | "crownward_bridge"
  | CrownwardCastleId
  | WildernessRuinId
  | DeepWildernessStructureId
  | "black_knight_castle"
  | "white_knight_castle"
  | "essence_altar_ruins"
  | "vault_door"
  | "milestone"
  | "highcairn_crane"
  | "gravelmaw_mouth"
  | "gravelmaw_exit"
  | "great_cairn"
  | "standing_stones"
  | "region_gate"
  | "path_waypoint"
  | "root_tunnel_entrance"
  | "canopy_walk_entrance"
  | "bank_counter"
  | "forge_yard"
  | "wood_pile"
  | "garden"
  | "farm_yard";

export const COMPOSITION_IDS: readonly CompositionId[] = [
  "crownward_bridge",
  ...CROWNWARD_CASTLE_IDS,
  ...WILDERNESS_RUIN_IDS,
  ...DEEP_WILDERNESS_STRUCTURE_IDS,
  "black_knight_castle",
  "white_knight_castle",
  "essence_altar_ruins", "vault_door", "milestone", "highcairn_crane", "gravelmaw_mouth", "gravelmaw_exit",
  "great_cairn", "standing_stones", "region_gate", "path_waypoint",
  "root_tunnel_entrance", "canopy_walk_entrance",
  "bank_counter", "forge_yard", "wood_pile", "garden", "farm_yard",
] as const;

export function isCompositionId(value: string): value is CompositionId {
  return (COMPOSITION_IDS as readonly string[]).includes(value);
}
