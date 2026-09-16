import type { ViewRegistry } from "../types.js";
import { lazyView } from "../lazyView.js";

/** Purpose-built views for this workspace. */
export const views: ViewRegistry = {
  models: lazyView(() => import("./ModelsView.js")),
  audio: lazyView(() => import("./AudioView.js")),
};
