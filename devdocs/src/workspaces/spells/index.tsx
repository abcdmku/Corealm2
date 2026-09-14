import { lazy } from "react";
import type { ViewRegistry } from "../types.js";

/** Purpose-built views for this workspace. Runes and elemental spells use the collection browser. */
export const views: ViewRegistry = {
  spells: lazy(() => import("./SpellsView.js")),
};
