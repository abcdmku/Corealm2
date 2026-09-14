import { lazy } from "react";
import type { ViewRegistry } from "../types.js";

export const views: ViewRegistry = {
  map: lazy(() => import("./MapView.js")),
};
