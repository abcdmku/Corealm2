/** Item catalog views share the validated records in game/content/data/items.json. */
import type { EquipSlot, ItemDef, ItemStack } from "../contracts.js";
import { ITEM_DATA } from "./itemData.js";

export const ITEMS: readonly ItemDef[] = ITEM_DATA;
/** The table registered by the game, in the same order as the authored JSON file. */
export const ALL_ITEMS: readonly ItemDef[] = ITEM_DATA;

/** The currency item id, so nothing else has to spell it. PRD 2.10: currency is gold. */
export const CURRENCY_ITEM_ID = "gold";

/**
 * What a new character carries and wears.
 *
 * Applied by `state/store.ts` in `createInitialState`, so a fresh game and `__gameDebug.reset()`
 * agree — putting it in `app/boot.ts` instead would give the harness a different world after every
 * reset than the one it booted into, and the driver diffs exactly that.
 *
 * The Basic Wooden Wand starts in `mainHand`; the Worn Shortsword stays in the pack so both combat
 * styles remain available. The 50 Air Essence powers the starter Air spell directly. The wand
 * stays plain brown until the player later awakens an altar and crafts an elemental weapon there.
 */
export const STARTING_INVENTORY: readonly ItemStack[] = [
  { itemId: "worn_sword", quantity: 1 },
  { itemId: "worn_hatchet", quantity: 1 },
  { itemId: "worn_pickaxe", quantity: 1 },
  { itemId: "worn_rod", quantity: 1 },
  { itemId: "air_essence", quantity: 50 },
];

/** The starter wand is equipped, visibly plain, and immediately usable with the starting Essence. */
export const STARTING_EQUIPMENT: Readonly<Partial<Record<EquipSlot, ItemStack>>> = {
  mainHand: { itemId: "basic_wooden_wand", quantity: 1 },
};
