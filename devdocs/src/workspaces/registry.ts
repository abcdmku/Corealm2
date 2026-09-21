import { lazy, type ComponentType } from "react";
import type { ViewRegistry } from "./types.js";
import { views as home } from "./home/index.js";
import { views as items } from "./items/index.js";
import { views as creatures } from "./creatures/index.js";
import { views as world } from "./world/index.js";
import { npcViews, questViews, shopViews } from "./story/index.js";
import { views as spells } from "./spells/index.js";
import { views as assets } from "./assets/index.js";
import { views as tuning } from "./tuning/index.js";
import { views as players } from "./players/index.js";
import { views as server } from "./server/index.js";

/** Purpose-built views by workspace. Each folder owns its own registry; pages inside are lazy. */
export const REGISTRY: Readonly<Record<string, ViewRegistry>> = { home, items, creatures, world, quests: questViews, npcs: npcViews, shops: shopViews, spells, assets, tuning, players, server };

/**
 * What the shell's header calls the open record, for a workspace whose route id is not a name.
 * Everywhere else the id is the name — `bronze_sword` reads perfectly well — so only players need
 * one. Lazy, so a mode without the workspace never loads the admin queries behind it.
 */
export const CRUMBS: Readonly<Partial<Record<string, ComponentType<{ id: string }>>>> = {
  players: lazy(() => import("./players/PlayerCrumb.js")),
};
