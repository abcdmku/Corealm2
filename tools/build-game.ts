import { build } from "vite";
import { gameRoot } from "./lib/paths.js";
import { assertGameInitialized } from "./lib/server.js";
import { compileAndPublish } from './content/compile.js';

await assertGameInitialized();
const catalog = await compileAndPublish();
if (!catalog.ok) throw new Error(catalog.diagnostics.map(row => `${row.path}: ${row.message}`).join('\n'));
const { validateGameContent } = await import('./validate-game-content.js');
const { ensureReleaseWorld } = await import('./build-release-world.js');
await validateGameContent();
await ensureReleaseWorld();
// Authoring uses Vite's development server in this process. Vite sets NODE_ENV when it starts;
// restore release semantics before bundling, even when this build had to regenerate world data.
process.env.NODE_ENV = 'production';
await build({ root: gameRoot, base: process.env.GAME_BASE ?? "/" });
