import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CollectionResponse } from "../shared/contracts.js";
import { contentRevision } from "../../tools/content/format.js";
import { repoRoot } from "../../tools/lib/paths.js";

function catalog(name: string, data: unknown[]): CollectionResponse {
  return { collection: { name, count: data.length, editable: false, shape: "array", idKey: "id" }, revision: contentRevision(JSON.stringify(data)), data };
}

/** Production tables are served read-only until M4 replaces them with registered JSON. */
export async function readRuntimeCatalogs(): Promise<CollectionResponse[]> {
  const [{ CREATURE_SPECIES }, { RPG_BESTIARY, RPG_BESTIARY_STAGED }, { REGIONAL_BOSS_SPECIES }, { ENEMIES }] = await Promise.all([
    import("../../game/src/content/creatureSpecies.js"), import("../../game/src/content/rpgBestiary.js"),
    import("../../game/src/content/regionalBossBodies.js"), import("../../game/src/content/enemies.js"),
  ]);
  const manifest = JSON.parse(await readFile(path.join(repoRoot, "game/public/assets/manifest.json"), "utf8")) as { assets: unknown[] };
  return [catalog("creatures", [...CREATURE_SPECIES, ...RPG_BESTIARY, ...RPG_BESTIARY_STAGED, ...REGIONAL_BOSS_SPECIES].map(row => ({ ...row, name: row.stats.name }))), catalog("enemies", [...ENEMIES]), catalog("assets", manifest.assets)];
}
