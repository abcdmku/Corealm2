import type { ViewRegistry } from "../types.js";
import { lazyView } from "../lazyView.js";

export const views: ViewRegistry = {
  overview: lazyView(() => import("./OverviewView.js")),
  requests: lazyView(() => import("./RequestsView.js")),
  changes: lazyView(() => import("./ChangesView.js")),
};
