import type { ViewRegistry } from "../types.js";
import { lazyView } from "../lazyView.js";

/** Purpose-built Items views. Resources and fuels stay on the collection browser. */
export const views: ViewRegistry = {
  ladder: lazyView(() => import("./LadderView.js")),
  catalog: lazyView(() => import("./CatalogView.js")),
  sets: lazyView(() => import("./SetsView.js")),
  recipes: lazyView(() => import("./RecipesView.js")),
};
