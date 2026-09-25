import { RESOLVED_TABLES } from './resolvedCatalog.js';
/** Fixed stock and prices for the authored town stalls. Region-scaled arms and cosmic
 * shops sell ordinary equipment; potion stalls unlock ranks at town tiers 10, 30, 50 and 70. */
import type { ShopDef } from "./index.js";

const shopData = RESOLVED_TABLES["shops"];
import { parseCollection } from "./schema/core.js";
import { shopSchema } from "./schema/people.js";

export const SHOPS: readonly ShopDef[] = parseCollection(shopSchema, shopData, { name: "shops" });
