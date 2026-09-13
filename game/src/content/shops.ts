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

import shopData from "../../content/data/shops.json";
import { parseCollection } from "./schema/core.js";
import { shopSchema } from "./schema/people.js";

export const SHOPS: readonly ShopDef[] = parseCollection(shopSchema, shopData, { name: "shops" });
