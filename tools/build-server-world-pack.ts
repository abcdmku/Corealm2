import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { gameRoot, repoRoot } from "./lib/paths.js";
import { generationRevision } from "./lib/generation-revision.js";
import { encodeServerWorldPack, loadServerWorldPack, readServerWorldPackHeader, SERVER_WORLD_PACK_REPO_PATH, type ServerWorldPack } from "../game/src/multiplayer/worldPack.js";

/** The seed every shipped client artifact is baked for. A pack may hold more, but never less. */
export const RELEASE_WORLD_SEED = 1337;
export const serverWorldPackFile = path.join(repoRoot, SERVER_WORLD_PACK_REPO_PATH);

/** Reads the pack of this checkout. Throws when it is missing, damaged, or baked from other sources than the working tree. */
export async function assertServerWorldPack(): Promise<ServerWorldPack> {
  try {
    const bytes = await readFile(serverWorldPackFile);
    const header = readServerWorldPackHeader(bytes);
    if (header.revision !== generationRevision(gameRoot)) throw new Error("Stale world revision");
    if (!header.seeds.includes(RELEASE_WORLD_SEED)) throw new Error(`Seed ${RELEASE_WORLD_SEED} is missing`);
    return loadServerWorldPack(bytes);
  } catch (error) { throw new Error(`Server world pack is missing, stale or damaged. Run npm run world:build. ${String(error)}`); }
}

export async function buildServerWorldPack(seeds: readonly number[] = [RELEASE_WORLD_SEED]): Promise<{ bytes: number; gzipBytes: number; seconds: number }> {
  const startedAt = performance.now();
  // Imported here so that checking a pack never loads the renderer and the GLB reader.
  const { bakeServerWorldPack } = await import("../game/src/multiplayer/bake/authoredWorld.js");
  const pack = await bakeServerWorldPack(seeds, generationRevision(gameRoot), path.join(gameRoot, "public/assets"));
  const bytes = encodeServerWorldPack(pack);
  loadServerWorldPack(bytes);
  await mkdir(path.dirname(serverWorldPackFile), { recursive: true });
  await writeFile(serverWorldPackFile, bytes);
  return { bytes: bytes.byteLength, gzipBytes: gzipSync(bytes).byteLength, seconds: Math.round((performance.now() - startedAt) / 100) / 10 };
}

export async function ensureServerWorldPack(): Promise<void> {
  try { await assertServerWorldPack(); console.log("Server world pack is current"); }
  catch {
    console.log("Baking server world pack");
    const result = await buildServerWorldPack();
    console.log(`Baked ${SERVER_WORLD_PACK_REPO_PATH}: ${result.bytes} bytes, ${result.gzipBytes} gzipped, ${result.seconds} s`);
  }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  const args = process.argv.slice(2), at = args.indexOf("--seeds");
  const seeds = at >= 0 ? (args[at + 1] ?? "").split(",").map(Number) : [RELEASE_WORLD_SEED];
  if (!seeds.every(Number.isSafeInteger) || !seeds.includes(RELEASE_WORLD_SEED)) throw new Error(`--seeds takes integers and must include ${RELEASE_WORLD_SEED}`);
  if (args.includes("--check")) { const pack = await assertServerWorldPack(); console.log(`Server world pack is current (revision ${pack.revision.slice(0, 12)}, seeds ${pack.seeds.join(", ")})`); }
  else { const result = await buildServerWorldPack(seeds); console.log(`Baked ${SERVER_WORLD_PACK_REPO_PATH}: ${result.bytes} bytes, ${result.gzipBytes} gzipped, ${result.seconds} s`); }
  // Recast and the asset readers keep handles open.
  process.exit(0);
}
