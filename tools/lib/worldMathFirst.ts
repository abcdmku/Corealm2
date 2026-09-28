// Import this first in any Node process that derives world data (bakes, their tests). Modules compute
// values as they load, so the world's Math must be in place before the first content module evaluates.
// Pages install it in `game/src/main.ts`; see `game/src/world/worldMath.ts`.
import { installWorldMath } from "../../game/src/world/worldMath.js";

installWorldMath();
