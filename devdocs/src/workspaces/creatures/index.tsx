import type { ViewRegistry } from "../types.js";
import { lazyView } from "../lazyView.js";

/** Purpose-built views for this workspace. Views without an entry use the collection browser. */
export const views: ViewRegistry = {
  bestiary: lazyView(() => import("./BestiaryView.js")),
  loot: lazyView(() => import("./LootView.js")),
};
