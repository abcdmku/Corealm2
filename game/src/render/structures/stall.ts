import type { PartPlacement } from "../buildings.js";
import type { StructureVariantRecipe } from "./types.js";

/** Each market stall GLB includes its counter, canopy, wares, and dressing. */
export const MARKET_STALL_ASSETS = [
  "market_stall_potion",
  "market_stall_cloth",
  "market_stall_fish",
  "market_stall_meat",
  "market_stall_arms",
  "market_stall_cosmic",
] as const;

export const STALL_VARIANTS: readonly StructureVariantRecipe[] = MARKET_STALL_ASSETS.map((assetId) => ({
  id: `stall:${assetId.slice("market_stall_".length)}`,
  label: `${assetId.slice("market_stall_".length)} stall`,
  family: "open_air",
  prefab: "stall",
  detailBudget: 0,
  build: (_context, base: readonly PartPlacement[]) => base.map((part) => (
    part.tag === "stall" ? { ...part, assetId } : part
  )),
}));
