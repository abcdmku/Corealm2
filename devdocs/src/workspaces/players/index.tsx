import type { ViewRegistry } from "../types.js";
import { lazyView } from "../lazyView.js";

/** The accounts this server has seen, with their characters. Server mode only. */
export const views: ViewRegistry = {
  players: lazyView(() => import("./PlayersView.js")),
};
