import type { ViewRegistry } from "../types.js";
import { lazyView } from "../lazyView.js";

/** Purpose-built views for this workspace. Runes and elemental spells use the collection browser. */
export const views: ViewRegistry = {
  spells: lazyView(() => import("./SpellsView.js")),
};
