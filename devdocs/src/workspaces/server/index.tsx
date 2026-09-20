import type { ViewRegistry } from "../types.js";
import { lazyView } from "../lazyView.js";

/** The running server itself: what it is doing, what it has published, and who may change it. */
export const views: ViewRegistry = {
  overview: lazyView(() => import("./OverviewView.js")),
  history: lazyView(() => import("./HistoryView.js")),
  settings: lazyView(() => import("./SettingsView.js")),
  access: lazyView(() => import("./AccessView.js")),
  audit: lazyView(() => import("./AuditView.js")),
};
