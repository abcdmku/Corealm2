/** Reports each animal's move speed against what its walk cycle implies, and the resulting rate. */
import "../lib/repoContent.js";
import { readFile } from "node:fs/promises";
import { ENEMIES } from "../../game/src/content/enemies.js";
import { REGIONS } from "../../game/src/content/regions.js";

const manifest = JSON.parse(await readFile("game/public/assets/manifest.json", "utf8")) as {
  assets: { id: string; impliedWalkMps?: number }[];
};
const implied = new Map(manifest.assets.map((a) => [a.id, a.impliedWalkMps]));
const seen = new Set<string>();
console.log("asset                  implied  speed   rate  residual slide");
for (const region of REGIONS) {
  for (const g of [...region.enemyGroups, ...(region.dungeon?.enemyGroups ?? [])]) {
    if (seen.has(g.assetId)) continue;
    seen.add(g.assetId);
    const block = ENEMIES.find((e) => e.id === g.id);
    const imp = implied.get(g.assetId);
    if (!block || !imp) continue;
    const speed = block.moveSpeedMps ?? 3.1;
    const raw = speed / imp;
    const rate = Math.min(2.0, Math.max(0.6, raw));
    const slide = Math.abs(1 - (imp * rate) / speed);
    console.log(
      `${g.assetId.padEnd(22)} ${imp.toFixed(2)}  ${speed.toFixed(2)}  ${rate.toFixed(2)}   ${(slide * 100).toFixed(0)}%`,
    );
  }
}
