import { build } from "vite";
import { gameRoot } from "./lib/paths.js";
import { assertGameInitialized } from "./lib/server.js";
import { validateGameContent } from "./validate-game-content.js";

await assertGameInitialized();
await validateGameContent();
await build({ root: gameRoot, base: process.env.GAME_BASE ?? "/" });
