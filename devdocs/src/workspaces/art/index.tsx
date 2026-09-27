import type { ViewRegistry } from "../types.js";
import { lazyView } from "../lazyView.js";

/** Art review. Each view folder has one owner; see docs/devdocs-art-review.md. */
export const views: ViewRegistry = {
  creatures: lazyView(() => import("./creatures/CreaturesView.js")),
  outfits: lazyView(() => import("./outfits/OutfitsView.js")),
  queue: lazyView(() => import("./queue/QueueView.js")),
};
