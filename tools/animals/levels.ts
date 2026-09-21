import "../lib/repoContent.js";
import { ENEMY_BLOCKS } from "../../game/src/content/enemies.js";
import { enemyCombatLevel } from "../../game/src/content/index.js";

let last = "";
for (const b of ENEMY_BLOCKS) {
  const tier = `t${b.tier}`;
  if (tier !== last) { console.log(""); last = tier; }
  console.log(
    `${b.id.padEnd(18)} ${b.name.padEnd(24)} ${tier.padEnd(4)} lvl ${String(enemyCombatLevel(b)).padStart(3)}` +
    `  hp ${String(b.maxHealth).padStart(3)}  atk ${String(b.attackLevel).padStart(2)}` +
    `  def ${String(b.defenceLevel).padStart(2)}  arm ${String(b.armour).padStart(3)}/${String(b.magicArmour).padStart(3)}` +
    `  ${b.behaviour}`,
  );
}
console.log(`\n${ENEMY_BLOCKS.length} stat blocks`);
