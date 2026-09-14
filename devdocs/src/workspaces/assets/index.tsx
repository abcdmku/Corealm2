import { lazy } from "react";
import type { ViewRegistry } from "../types.js";

/** Purpose-built views for this workspace. */
export const views: ViewRegistry = {
  models: lazy(() => import("./ModelsView.js")),
  audio: lazy(() => import("./AudioView.js")),
};
