import type { ViewRegistry } from "../types.js";
import { lazyView } from "../lazyView.js";

/** Purpose-built views for this workspace. Views without an entry use the collection browser. */
export const views: ViewRegistry = {
  npcs: lazyView(() => import("./NpcsView.js")),
  quests: lazyView(() => import("./QuestsView.js")),
  dialogue: lazyView(() => import("./DialogueView.js")),
  shops: lazyView(() => import("./ShopsView.js")),
};
