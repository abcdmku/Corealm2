import type { ViewRegistry } from "../types.js";
import { lazyView } from "../lazyView.js";

export const views: ViewRegistry = {
  map: lazyView(() => import("./MapView.js")),
};
