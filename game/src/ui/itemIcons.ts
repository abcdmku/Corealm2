import { assetBaseUrl } from "../app/config.js";
/** Raster inventory icons and item shape names used by equipment previews. */
import type { EquipSlot, ItemCategory, ItemDef } from "../contracts.js";

export type IconShape =
  | "helm" | "cuirass" | "greaves" | "boot" | "glove" | "sword" | "shield" | "ring"
  | "staff" | "dagger" | "orb" | "amulet" | "robe" | "hood"
  | "ore" | "bar" | "food" | "tool" | "scroll" | "coin" | "shard" | "log" | "rune";

const BY_EQUIP_SLOT: Record<EquipSlot, IconShape> = {
  head: "helm",
  body: "cuirass",
  legs: "greaves",
  feet: "boot",
  hands: "glove",
  mainHand: "sword",
  offHand: "shield",
  accessory1: "ring",
  ring2: "ring",
  earring2: "ring",
  accessory2: "ring",
};

const BY_CATEGORY: Record<ItemCategory, IconShape> = {
  resource: "ore",
  bar: "bar",
  equipment: "sword",
  food: "food",
  tool: "tool",
  quest: "scroll",
  currency: "coin",
  component: "shard",
};

/**
 * Equipment archetypes the slot cannot distinguish, checked before the slot. Ordered, first match
 * wins; every pattern is anchored so it cannot catch a resource id (`palewood_shaft` is not a
 * staff — but it also has no `equip` block, so it never reaches here).
 */
const BY_ITEM_ID: readonly { readonly pattern: RegExp; readonly shape: IconShape }[] = [
  { pattern: /_rune$/, shape: "rune" },
  { pattern: /_staff$/, shape: "staff" },
  { pattern: /_dagger$/, shape: "dagger" },
  { pattern: /_(?:focus|orb)$/, shape: "orb" },
  { pattern: /_pendant$|_charm$/, shape: "amulet" },
  { pattern: /_robe$/, shape: "robe" },
  { pattern: /_hood$/, shape: "hood" },
];

/** Ids whose category is too broad to pick a shape from. Woodcutting drops are not ore. */
const LOG_ITEM = /_log$|_plank|_shaft$/;

export function iconShapeFor(def: ItemDef | undefined): IconShape {
  if (!def) return "shard";
  for (const rule of BY_ITEM_ID) if (rule.pattern.test(def.id)) return rule.shape;
  if (def.equip) {
    return BY_EQUIP_SLOT[def.equip.slot];
  }
  if (def.category === "resource" && LOG_ITEM.test(def.id)) return "log";
  return BY_CATEGORY[def.category] ?? "shard";
}

export const ITEM_ICON_GAME_SIZE = 48;
const itemIconBase = (): string => `${assetBaseUrl()}icons/items/48/`;

export function itemIconUrl(def: ItemDef | undefined): string | undefined {
  if (!def) return undefined;
  // These ten crafted sets exchanged their complete appearances in R13.
  const match = /^(dragonhide|starhide)_(hood|robe|leggings|boots|wraps)$/.exec(def.id);
  const artworkId = match ? `${match[1] === 'dragonhide' ? 'starhide' : 'dragonhide'}_${match[2]}` : def.id;
  return `${itemIconBase()}${encodeURIComponent(artworkId)}.png`;
}

/** Every inventory item, including runes, uses its audited 48px artwork. */
export function createItemIcon(def: ItemDef | undefined): HTMLElement {
  const wrapper = document.createElement("span");
  wrapper.className = "item-icon";

  const url = itemIconUrl(def);
  if (!url) return wrapper;

  const image = document.createElement("img");
  image.className = "item-icon__raster";
  image.src = url;
  image.width = ITEM_ICON_GAME_SIZE;
  image.height = ITEM_ICON_GAME_SIZE;
  image.alt = "";
  image.draggable = false;
  image.decoding = "async";
  image.hidden = true;
  image.addEventListener("load", () => {
    image.hidden = false;
    wrapper.classList.add("is-raster-ready");
  }, { once: true });
  image.addEventListener("error", () => {
    wrapper.dataset["iconError"] = def!.id;
    image.remove();
  }, { once: true });
  wrapper.appendChild(image);
  return wrapper;
}
