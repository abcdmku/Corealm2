import { RESOLVED_TABLES } from './resolvedCatalog.js';
/** Fixed stock and prices for the authored town stalls. Region-scaled arms and cosmic
 * shops sell ordinary equipment; potion stalls unlock ranks at town tiers 10, 30, 50 and 70. */
import type { ShopDef } from "./index.js";

import { parseCollection } from "./schema/core.js";
import { shopSchema } from "./schema/people.js";

const shopRows = (): ShopDef[] => parseCollection(shopSchema, RESOLVED_TABLES["shops"], { name: "shops" });
const shops = shopRows();
export const SHOPS: readonly ShopDef[] = shops;

/** After the catalog moved: the same array, refilled. */
export function reindexShops(): void {
  shops.splice(0, shops.length, ...shopRows());
}
