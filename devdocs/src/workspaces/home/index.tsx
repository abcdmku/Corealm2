import { lazy } from "react";
import type { ViewRegistry } from "../types.js";

export const views: ViewRegistry = {
  overview: lazy(() => import("./OverviewView.js")),
  requests: lazy(() => import("./RequestsView.js")),
  changes: lazy(() => import("./ChangesView.js")),
};
