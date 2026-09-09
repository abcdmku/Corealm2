import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { SpellRangeApi } from "../game/src/contracts.js";
import { GameDriver } from "./lib/driver.js";
import { argValue, repoRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";
import { installTestDeadline } from "./lib/deadline.js";
import { elementalSpell } from "../game/src/content/elementalSpells.js";
import { planElementalAttack } from "../game/src/systems/elementalAttacks.js";

declare global {
  interface Window {
    __spellRange?: SpellRangeApi;
  }
}
type GlowState = {
  rendered: boolean;
  activeMeshes: number;
  width: number;
  height: number;
  hdr: boolean;
};
type Comparison = { withoutGlow: string; withGlow: string; state: GlowState };
const args = process.argv.slice(2),
  external = argValue(args, "--url");
const spell = elementalSpell(argValue(args,"--spell") ?? "cinder-mine");
const activeAt = planElementalAttack(spell.id,[0,0,0],[0,0,10])[0]!.at + 100;
const clear = installTestDeadline("Elemental HDR glow", 60_000);
const server = external
  ? { url: external, close: async () => {} }
  : await startGameServer();
const driver = new GameDriver(server, {
  viewport: { width: 1440, height: 1000 },
  browserArgs: [
    ...(process.platform === "win32" ? ["--use-angle=d3d11"] : []),
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    "--mute-audio",
  ],
});
const out = path.join(repoRoot, "test-results", "elemental-spells", spell.id === "cinder-mine" ? "glow" : `glow-${spell.id}`);
const decode = (data: string) => Buffer.from(data.split(",")[1]!, "base64");
await mkdir(out, { recursive: true });
try {
  await driver.launch();
  await driver.open(30_000, "/index.html?mode=combat&spells=1");
  const page = driver.page!;
  await page.waitForFunction(() => !!window.__spellRange);
  const compare = () =>
    page.evaluate(() =>
      (
        window.__gameDebug as unknown as {
          captureMagicGlowComparison(): Comparison;
        }
      ).captureMagicGlowComparison(),
    );
  const idle = await compare();
  assert.equal(idle.state.rendered, false);
  assert.deepEqual(
    decode(idle.withGlow),
    decode(idle.withoutGlow),
    "Idle scene is unchanged by the optional glow pass",
  );
  await page.locator("#spell-range-element").selectOption(spell.element);
  await page.locator("#spell-range-select").selectOption(spell.id);
  await page.locator("#spell-range-slow").check();
  await page.locator("#spell-range-cast").click();
  await page.waitForFunction(
    (at) => window.__spellRange!.getState().elapsed > at, activeAt,
  );
  // Two synchronous renders of the same live frame. Simulation and gameplay camera are untouched.
  const result = await compare();
  assert(
    result.state.rendered && result.state.hdr && result.state.activeMeshes > 0,
  );
  const a = await sharp(decode(result.withoutGlow))
    .removeAlpha()
    .raw()
    .toBuffer();
  const b = await sharp(decode(result.withGlow)).removeAlpha().raw().toBuffer();
  let changed = 0,
    halo = 0,
    saturated = 0;
  for (let i = 0; i < a.length; i += 3) {
    const difference = Math.max(
      Math.abs(a[i]! - b[i]!),
      Math.abs(a[i + 1]! - b[i + 1]!),
      Math.abs(a[i + 2]! - b[i + 2]!),
    );
    if (difference > 8) changed++;
    if (
      Math.max(a[i]!, a[i + 1]!, a[i + 2]!) < 180 &&
      Math.max(b[i]! - a[i]!, b[i + 1]! - a[i + 1]!, b[i + 2]! - a[i + 2]!) > 12
    )
      halo++;
    if (
      difference > 8 &&
      Math.max(b[i]!, b[i + 1]!, b[i + 2]!) -
        Math.min(b[i]!, b[i + 1]!, b[i + 2]!) >
        55
    )
      saturated++;
  }
  assert(
    changed > 1000 && halo > 100 && saturated > 100,
    `Visible colored glow: ${JSON.stringify({ changed, halo, saturated })}`,
  );
  await writeFile(path.join(out, "with-glow.png"), decode(result.withGlow));
  await writeFile(
    path.join(out, "without-glow.png"),
    decode(result.withoutGlow),
  );
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.waitForTimeout(150);
  const resized = await compare();
  const canvas = await page
    .locator("canvas")
    .first()
    .evaluate((node) => ({
      width: (node as HTMLCanvasElement).width,
      height: (node as HTMLCanvasElement).height,
    }));
  assert.equal(resized.state.width, canvas.width);
  assert.equal(resized.state.height, canvas.height);
  await page.locator("#spell-range-reset").click();
  await page.waitForFunction(
    () => window.__spellRange!.getState().instances === 0,
  );
  const cleaned = await compare();
  assert.equal(cleaned.state.rendered, false);
  assert.equal(cleaned.state.activeMeshes, 0);
  assert.deepEqual([...driver.consoleErrors, ...driver.pageErrors], []);
  await writeFile(
    path.join(out, "report.json"),
    JSON.stringify(
      {
        passed: true,
        spell: spell.id,
        idle: idle.state,
        active: result.state,
        changed,
        halo,
        saturated,
        resized: resized.state,
        cleaned: cleaned.state,
        errors: [],
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ passed: true, changed, halo, saturated, output: out }),
  );
} finally {
  await driver.close();
  await server.close();
  clear();
}
