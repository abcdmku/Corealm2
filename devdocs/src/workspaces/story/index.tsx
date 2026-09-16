import type { ViewRegistry } from "../types.js";
import { lazyView } from "../lazyView.js";

/** Purpose-built views for this workspace. Views without an entry use the collection browser. */
/** The pages behind the Quests, NPCs and Shops workspaces; they share this folder's helpers. */
export const questViews: ViewRegistry = {
  quests: lazyView(() => import("./QuestsView.js")),
};
export const npcViews: ViewRegistry = {
  npcs: lazyView(() => import("./NpcsView.js")),
  dialogue: lazyView(() => import("./DialogueView.js")),
};
export const shopViews: ViewRegistry = {
  shops: lazyView(() => import("./ShopsView.js")),
};
