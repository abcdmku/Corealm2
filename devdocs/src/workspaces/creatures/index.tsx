import { lazy } from "react";
import type { ViewRegistry } from "../types.js";

/** Purpose-built views for this workspace. Views without an entry use the collection browser. */
export const views: ViewRegistry = {
  bestiary: lazy(() => import("./BestiaryView.js")),
  loot: lazy(() => import("./LootView.js")),
};
