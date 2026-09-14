import { lazy } from "react";
import type { ViewRegistry } from "../types.js";

/** Purpose-built views for this workspace. Views without an entry use the collection browser. */
export const views: ViewRegistry = {
  npcs: lazy(() => import("./NpcsView.js")),
  quests: lazy(() => import("./QuestsView.js")),
  dialogue: lazy(() => import("./DialogueView.js")),
  shops: lazy(() => import("./ShopsView.js")),
};
