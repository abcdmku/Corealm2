import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "./paths.js";
import type { HeadlessWorldPorts } from "../../game/src/multiplayer/headlessWorld.js";
import { createPackedWorld, loadServerWorldPack, SERVER_WORLD_PACK_REPO_PATH } from "../../game/src/multiplayer/worldPack.js";

/** The authored world of this checkout, booted from its baked pack the way the server boots it. */
export async function createRepoPackedWorld(seed: number): Promise<HeadlessWorldPorts> {
  const file = path.join(repoRoot, SERVER_WORLD_PACK_REPO_PATH);
  const bytes = await readFile(file).catch(() => { throw new Error(`${file} is missing. Run npm run world:build.`); });
  return createPackedWorld(loadServerWorldPack(bytes), seed);
}
