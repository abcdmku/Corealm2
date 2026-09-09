import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { SpellRangeApi } from "../game/src/contracts.js";
import { GameDriver } from "./lib/driver.js";
import { argValue, repoRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";
import { installTestDeadline } from "./lib/deadline.js";

declare global { interface Window { __spellRange?: SpellRangeApi } }
type RefractionState = {
  rendered: boolean; activeMeshes: number; copies: number; width: number; height: number;
};
type Comparison = {
  withoutRefraction: string; withRefraction: string; state: RefractionState;
};
const external = argValue(process.argv.slice(2), "--url");
const clear = installTestDeadline("Elemental scene refraction", 60_000);
const server = external ? { url: external, close: async () => {} } : await startGameServer();
const driver = new GameDriver(server, {
  viewport: { width: 1440, height: 1000 },
  browserArgs: [
    ...(process.platform === "win32" ? ["--use-angle=d3d11"] : []),
    "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio",
  ],
});
const out = path.join(repoRoot, "test-results", "elemental-spells", "refraction");
const decode = (data: string) => Buffer.from(data.split(",")[1]!, "base64");
await mkdir(out, { recursive: true });
try {
  await driver.launch();
  await driver.open(30_000, "/index.html?mode=combat&spells=1");
  const page = driver.page!;
  await page.waitForFunction(() => !!window.__spellRange);
  const compare = () => page.evaluate(() =>
    (window.__gameDebug as unknown as {
      captureElementalRefractionComparison(): Comparison;
    }).captureElementalRefractionComparison(),
  );
  const idle = await compare();
  assert.equal(idle.state.copies, 0);
  assert.deepEqual(decode(idle.withRefraction), decode(idle.withoutRefraction));
  const camera = await page.evaluate(() => window.__gameDebug!.getCamera());
  await page.locator("#spell-range-slow").check();
  const cases = [
    { element: "wind", spell: "vacuum-coil", elapsed: 1100 },
    { element: "water", spell: "geyser-chain", elapsed: 1000 },
  ];
  const evidence = [];
  for (const test of cases) {
    await page.locator("#spell-range-element").selectOption(test.element);
    await page.locator("#spell-range-select").selectOption(test.spell);
    await page.locator("#spell-range-cast").click();
    await page.waitForFunction((elapsed) => window.__spellRange!.getState().elapsed > elapsed, test.elapsed);
    // Synchronous same-frame captures isolate the pass without changing time or camera.
    const result = await compare();
    assert(result.state.rendered && result.state.activeMeshes > 0);
    assert.equal(result.state.copies, 1);
    const a = await sharp(decode(result.withoutRefraction)).removeAlpha().raw().toBuffer();
    const { data: b, info } = await sharp(decode(result.withRefraction)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let changed = 0, outsideEffect = 0;
    for (let i = 0; i < a.length; i += 3) {
      const delta = Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i+1]! - b[i+1]!), Math.abs(a[i+2]! - b[i+2]!));
      if (delta > 5) {
        changed++;
        if (Math.floor(i / 3 / info.width) > info.height * .8) outsideEffect++;
      }
    }
    assert(changed > 500, `${test.spell}: visible refraction (${changed} pixels)`);
    assert.equal(outsideEffect, 0, "Nearby foreground stays unchanged outside the effect");
    assert.deepEqual(await page.evaluate(() => window.__gameDebug!.getCamera()), camera);
    await writeFile(path.join(out, `${test.spell}-without.png`), decode(result.withoutRefraction));
    await writeFile(path.join(out, `${test.spell}-with.png`), decode(result.withRefraction));
    evidence.push({ spell: test.spell, state: result.state, changed, outsideEffect });
    if (test.element === "water") {
      await page.setViewportSize({ width: 1100, height: 800 });
      await page.waitForTimeout(150);
      const resized = await compare();
      const canvas = await page.locator("canvas").first().evaluate((node) => ({
        width: (node as HTMLCanvasElement).width, height: (node as HTMLCanvasElement).height,
      }));
      assert.equal(resized.state.width, canvas.width);
      assert.equal(resized.state.height, canvas.height);
      assert.equal(resized.state.copies, 1);
    }
    await page.locator("#spell-range-reset").click();
    await page.waitForFunction(() => window.__spellRange!.getState().instances === 0);
    const reset = await compare();
    assert.equal(reset.state.rendered, false);
    assert.equal(reset.state.activeMeshes, 0);
    assert.equal(reset.state.copies, 0);
    assert.deepEqual(decode(reset.withRefraction), decode(reset.withoutRefraction));
  }
  assert.deepEqual([...driver.consoleErrors, ...driver.pageErrors], []);
  await writeFile(path.join(out, "report.json"), JSON.stringify({ passed: true, idle: idle.state, camera, evidence, errors: [] }, null, 2));
  console.log(JSON.stringify({ passed: true, evidence, output: out }));
} finally {
  await driver.close();
  await server.close();
  clear();
}
