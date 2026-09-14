import type { ContentRow } from "./contracts.js";
import type { ViewerSource } from "../viewer/types.js";

/** Which production model a record can preview, if any. */
export function viewerSource(collection: string, record: ContentRow): ViewerSource | undefined {
  const base = collection.replace(/^compiled-/, "");
  if (base === "equipmentSets") return { mode: "outfit", itemIds: Object.values((record.members ?? {}) as Record<string, string>) };
  if (base === "items") {
    const equip = record.equip as { slot?: string } | undefined;
    const id = String(record.id);
    if (equip?.slot === "mainHand" || record.tool) return { mode: "outfit", itemIds: [], mainHandId: id };
    if (equip?.slot === "offHand") return { mode: "outfit", itemIds: [], offHandId: id };
    if (equip?.slot && ["head", "body", "legs", "feet", "hands"].includes(equip.slot)) return { mode: "outfit", itemIds: [id] };
  }
  if (typeof record.assetId === "string" && ["creatures", "enemies", "species", "npcs", "resourcePlacements"].includes(base)) return { mode: "creature", assetId: record.assetId };
  const presentation = record.presentation as { assetId?: unknown; availableAssetIds?: unknown } | undefined;
  if (base === "creatureDefinitions" && typeof presentation?.assetId === "string") return { mode: "creature", assetId: presentation.assetId };
  if (base === "resources" && Array.isArray(presentation?.availableAssetIds) && typeof presentation.availableAssetIds[0] === "string") return { mode: "asset", assetId: presentation.availableAssetIds[0] };
  if (base === "assets" && record.procedural !== true) return { mode: "asset", assetId: String(record.id) };
  return undefined;
}

/** The manifest id a record's model comes from, for candidate review. */
export function primaryAssetId(collection: string, record: ContentRow): string | undefined {
  const source = viewerSource(collection, record);
  return source && source.mode !== "outfit" && source.mode !== "glb" ? source.assetId : undefined;
}
