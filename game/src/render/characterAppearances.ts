/** Production NPC outfit resolution shared by world assembly and the isolated actor lab. */

const PEASANT_PART_SLOTS = ["chest", "legs", "boots", "gloves"] as const;
const RANGER_PART_SLOTS = ["chest", "legs", "boots", "gloves", "hood", "pauldron"] as const;

/** Layered assets that dress one authored NPC body without replacing its head or skeleton. */
export function npcOutfitParts(npcId: string, baseAssetId: string): string[] {
  if (baseAssetId.startsWith("npc_fey_")) return [];
  const sex = baseAssetId.includes("female") ? "female" : "male";
  const outdoors = /ranger|trapper|woodward|watcher|quarrier|forema|pitmaster/.test(npcId);
  const kind = outdoors ? "ranger" : "peasant";
  const slots = outdoors ? RANGER_PART_SLOTS : PEASANT_PART_SLOTS;
  return slots.map((slot) => `outfit_${sex}_${kind}_${slot}`);
}
