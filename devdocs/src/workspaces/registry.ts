import type { ViewRegistry } from "./types.js";
import { views as home } from "./home/index.js";
import { views as items } from "./items/index.js";
import { views as creatures } from "./creatures/index.js";
import { views as world } from "./world/index.js";
import { views as story } from "./story/index.js";
import { views as spells } from "./spells/index.js";
import { views as assets } from "./assets/index.js";
import { views as tuning } from "./tuning/index.js";

/** Purpose-built views by workspace. Each folder owns its own registry; pages inside are lazy. */
export const REGISTRY: Readonly<Record<string, ViewRegistry>> = { home, items, creatures, world, story, spells, assets, tuning };
