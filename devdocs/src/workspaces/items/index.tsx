import { lazy } from "react";
import type { ViewRegistry } from "../types.js";

/** Purpose-built Items views. Resources and fuels stay on the collection browser. */
export const views: ViewRegistry = {
  ladder: lazy(() => import("./LadderView.js")),
  catalog: lazy(() => import("./CatalogView.js")),
  sets: lazy(() => import("./SetsView.js")),
  recipes: lazy(() => import("./RecipesView.js")),
};
