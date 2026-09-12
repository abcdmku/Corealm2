import { build } from "vite";
import { gameRoot } from "./lib/paths.js";
import { assertGameInitialized } from "./lib/server.js";
import { validateGameContent } from "./validate-game-content.js";
import { ensureReleaseWorld } from './build-release-world.js';

await assertGameInitialized();
await validateGameContent();
await ensureReleaseWorld();
// Authoring uses Vite's development server in this process. Vite sets NODE_ENV when it starts;
// restore release semantics before bundling, even when this build had to regenerate world data.
process.env.NODE_ENV = 'production';
await build({ root: gameRoot, base: process.env.GAME_BASE ?? "/" });
