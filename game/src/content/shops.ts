/**
 * Shop stock for the seven shops `content/regions.ts` places.
 *
 * Owned by W-CONTENT.
 *
 * PRD section 0 cuts restocking, price drift and stock decay: fixed stock, fixed prices. The
 * multipliers implement the PRD 2.10 spread directly - the player buys at `value * 1.0` and sells
 * at `value * 0.6`, which is the 40% spread and matches `sellPrice()` in `content/index.ts`.
 * Every price in the PRD's reference table therefore falls straight out of `ItemDef.value`:
 *
 *   Grithe ore   12 / 7     Corven ore    42 / 25    Kaldite ore    95 / 57
 *   Palewood log 10 / 6     Duskoak log   38 / 23*   Cairnpine log  88 / 53*
 *   Grithe sword 180 / 108  Corven sword 620 / 372   Kaldite sword 1450 / 870
 *   Air Essence    9 / 5    Seared Cragfin 70 / 42
 *
 *   * The PRD quotes 22 and 52 for the two logs. `sellPrice()` rounds where the PRD floored:
 *     round(38 * 0.6) = 23 and round(88 * 0.6) = 53. The frozen formula wins.
 *
 * Division of labour, per the brief: general stores carry tools, food, seeds and local essence; smiths
 * carry bars and low-tier gear. Nothing sells a full tier kit - armour is what Smithing and
 * Crafting are for, and a shop that sold it would flatten the material loop in PRD 1.
 */
import type { ShopDef } from "./index.js";

/** Buy at face value, sell at 60%. The 40% spread from PRD 2.10, applied identically everywhere. */
const BUY_MULTIPLIER = 1.0;
const SELL_MULTIPLIER = 0.6;

export const SHOPS: readonly ShopDef[] = [
  {
    id: "coldbrace_general",
    name: "Millfield General Supplies",
    buyMultiplier: BUY_MULTIPLIER,
    sellMultiplier: SELL_MULTIPLIER,
    stock: [
      // The tier 1 starter kit. A player can walk off the south gate with a pickaxe and be mining
      // inside a minute, which is the first-session shape in PRD 1.
      { itemId: "grithe_pickaxe", quantity: 5 },
      { itemId: "grithe_hatchet", quantity: 5 },
      { itemId: "palewood_rod", quantity: 5 },
      { itemId: "seared_minnow", quantity: 30 },
      { itemId: "air_essence", quantity: 200 },
      // The first secondary rune: rank-one invocations open at Magic 20, on the way out of here.
      { itemId: "mind_rune", quantity: 120 },
      { itemId: "palewood_shaft", quantity: 100 },
      { itemId: "coarse_hide", quantity: 15 },
    ],
  },
  {
    id: "coldbrace_smith",
    name: "Harrow's Metal",
    buyMultiplier: BUY_MULTIPLIER,
    sellMultiplier: SELL_MULTIPLIER,
    stock: [
      { itemId: "grithe_bar", quantity: 40 },
      { itemId: "grithe_dagger", quantity: 5 },
      { itemId: "grithe_sword", quantity: 3 },
      { itemId: "grithe_helm", quantity: 3 },
      { itemId: "grithe_boots", quantity: 3 },
      { itemId: "grithe_gloves", quantity: 3 },
      { itemId: "palewood_shield", quantity: 4 },
      { itemId: "march_stone", quantity: 60 },
    ],
  },
  {
    id: "rootfall_general",
    name: "Oakwood Trade Post",
    buyMultiplier: BUY_MULTIPLIER,
    sellMultiplier: SELL_MULTIPLIER,
    stock: [
      { itemId: "corven_pickaxe", quantity: 4 },
      { itemId: "corven_hatchet", quantity: 4 },
      { itemId: "duskoak_rod", quantity: 4 },
      { itemId: "seared_trout", quantity: 25 },
      { itemId: "seared_minnow", quantity: 20 },
      { itemId: "earth_essence", quantity: 200 },
      { itemId: "mind_rune", quantity: 120 },
      { itemId: "chaos_rune", quantity: 120 },
      { itemId: "cosmic_rune", quantity: 200 },
      { itemId: "duskoak_shaft", quantity: 80 },
      { itemId: "bramble_hide", quantity: 12 },
      // Rootfall has an anvil but no furnace, so it sells the bar the anvil needs.
      { itemId: "corven_bar", quantity: 30 },
    ],
  },
  {
    id: "highcairn_general",
    name: "Hillcrest Camp Store",
    buyMultiplier: BUY_MULTIPLIER,
    sellMultiplier: SELL_MULTIPLIER,
    stock: [
      { itemId: "kaldite_pickaxe", quantity: 3 },
      { itemId: "kaldite_hatchet", quantity: 3 },
      { itemId: "cairnpine_rod", quantity: 3 },
      // The Ordrun food budget: PRD 2.4 costs the fight at roughly 168 damage against a 75 health
      // pool, which is 8 Seared Cragfin at healAmount(10) = 12 plus eat time.
      { itemId: "seared_cragfin", quantity: 40 },
      { itemId: "seared_trout", quantity: 20 },
      { itemId: "water_essence", quantity: 300 },
      { itemId: "chaos_rune", quantity: 120 },
      { itemId: "death_rune", quantity: 100 },
      { itemId: "cosmic_rune", quantity: 200 },
      { itemId: "cairnpine_shaft", quantity: 60 },
      { itemId: "cairn_pelt", quantity: 8 },
    ],
  },
  {
    id: "highcairn_smith",
    name: "Quarry Smith",
    buyMultiplier: BUY_MULTIPLIER,
    sellMultiplier: SELL_MULTIPLIER,
    stock: [
      { itemId: "corven_bar", quantity: 30 },
      { itemId: "kaldite_bar", quantity: 25 },
      { itemId: "march_stone", quantity: 80 },
      { itemId: "corven_sword", quantity: 2 },
      { itemId: "corven_helm", quantity: 2 },
      { itemId: "kaldite_dagger", quantity: 2 },
      { itemId: "kaldite_boots", quantity: 2 },
      { itemId: "kaldite_gauntlets", quantity: 2 },
      { itemId: "cairnpine_shield", quantity: 2 },
    ],
  },
  {
    id: "emberfast_general",
    name: "Ashford Provisioners",
    buyMultiplier: BUY_MULTIPLIER,
    sellMultiplier: SELL_MULTIPLIER,
    stock: [
      { itemId: "emberite_pickaxe", quantity: 3 },
      { itemId: "emberite_hatchet", quantity: 3 },
      { itemId: "cinderpine_rod", quantity: 3 },
      // The Cinderwake food budget: the arena fight costs roughly 187 damage against an 87 health
      // pool, which is ten Seared Ashfin at healAmount(20) = 19 plus eat time.
      { itemId: "seared_ashfin", quantity: 40 },
      { itemId: "seared_cragfin", quantity: 20 },
      // Fire Essence sells locally like the other elements at their region stores.
      { itemId: "fire_essence", quantity: 300 },
      { itemId: "death_rune", quantity: 100 },
      { itemId: "blood_rune", quantity: 80 },
      { itemId: "wrath_rune", quantity: 50 },
      { itemId: "cosmic_rune", quantity: 200 },
      { itemId: "cinderpine_shaft", quantity: 60 },
      { itemId: "charhide", quantity: 8 },
    ],
  },
  {
    id: "emberfast_smith",
    name: "Kiln Row Smith",
    buyMultiplier: BUY_MULTIPLIER,
    sellMultiplier: SELL_MULTIPLIER,
    stock: [
      { itemId: "kaldite_bar", quantity: 25 },
      { itemId: "emberite_bar", quantity: 20 },
      { itemId: "kilnstone", quantity: 80 },
      { itemId: "kaldite_sword", quantity: 2 },
      { itemId: "kaldite_helm", quantity: 2 },
      { itemId: "emberite_dagger", quantity: 2 },
      { itemId: "emberite_boots", quantity: 2 },
      { itemId: "emberite_gauntlets", quantity: 2 },
      { itemId: "cinderpine_shield", quantity: 2 },
    ],
  },
  { id: 'lantern_rest_general', name: 'Moonpetal Provisions', buyMultiplier: BUY_MULTIPLIER, sellMultiplier: SELL_MULTIPLIER,
    stock: [{itemId:'emberite_pickaxe',quantity:3},{itemId:'emberite_hatchet',quantity:3},{itemId:'seared_ashfin',quantity:40},
      {itemId:'earth_essence',quantity:200},{itemId:'chaos_rune',quantity:100},{itemId:'cosmic_rune',quantity:100}] },
  { id: 'lantern_rest_smith', name: 'Lantern Smith', buyMultiplier: BUY_MULTIPLIER, sellMultiplier: SELL_MULTIPLIER,
    stock: [{itemId:'emberite_bar',quantity:20},{itemId:'emberite_dagger',quantity:2},{itemId:'emberite_boots',quantity:2}] },

];
