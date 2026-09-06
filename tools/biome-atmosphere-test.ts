import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameDriver } from "./lib/driver.js";
import { startGameServer } from "./lib/server.js";
import { BIOME_LOOKS, blendBiomeLook } from "../game/src/render/biomeAtmosphere.js";
import { blendBiomeSky } from "../game/src/render/biomeSky.js";

const server = await startGameServer();
const driver = new GameDriver(server, { browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const output = "test-results/biome-atmosphere";
await mkdir(output, { recursive: true });
try {
  await driver.launch();
  if (process.argv.includes("--world")) {
    await driver.open(90_000, "/index.html");
    const page = driver.page!;
    const results = [];
    for (const [id, x, z] of [["fallowmarch", -250, 30], ["vellenwood", 14, 166],
      ["karrowmoor", 140, -176], ["kilnhalt", 240, 340]] as const) {
      await page.evaluate(({ x, z }) => {
        const debug = window.__gameDebug as any;
        debug.inspectPose({ x, y: debug.groundHeight(x, z), z, yaw: .7, pitch: .24, distance: 26 });
      }, { x, z });
      await page.waitForFunction(() => {
        const debug = window.__gameDebug as any;
        const p = debug.getPlayerPosition(), a = debug.getBiomeAtmosphere();
        const weights = debug.sampleWorld(p.x, p.z).biomeWeights;
        return Object.keys(weights).every(id => Math.abs(a.weights[id] - weights[id]) < .001);
      }, undefined, { timeout: 10_000 });
      await page.waitForTimeout(2200);
      const result = await page.evaluate(() => {
        const debug = window.__gameDebug as any;
        const position = debug.getPlayerPosition();
        return { state: debug.getState(), position, atmosphere: debug.getBiomeAtmosphere(),
          world: debug.sampleWorld(position.x, position.z) };
      });
      assert.equal(result.state.regionId, id);
      assert.equal(result.atmosphere.preview, null);
      assert.equal(result.atmosphere.sky.enabled, true);
      for (const id of Object.keys(result.world.biomeWeights)) {
        assert.ok(Math.abs(result.atmosphere.weights[id] - result.world.biomeWeights[id]) < .001);
      }
      assert.ok(Math.abs(result.atmosphere.saturation - blendBiomeLook(result.world.biomeWeights).saturation) < .02);
      await page.screenshot({ path: `${output}/world-${id}.png` });
      results.push(result);
    }
    const before = await page.evaluate(() => window.__gameDebug!.getPlayerPosition());
    await driver.press("w", 400);
    const after = await page.evaluate(() => window.__gameDebug!.getPlayerPosition());
    assert.notDeepEqual(after, before);
    assert.deepEqual(driver.pageErrors, []);
    assert.deepEqual(driver.consoleErrors, []);
    await writeFile(`${output}/world.json`, JSON.stringify({ results, before, after, errors: driver.consoleErrors }, null, 2));
    console.log(JSON.stringify({ ok: true, regions: results.length, output }));
  } else {
  await driver.open(60_000, "/index.html?mode=combat&presentation=1&atmosphere=1");
  const page = driver.page!;
  const read = () => page.evaluate(() => (window as any).__biomeAtmosphereLab.getState());
  const before = await page.evaluate(() => window.__gameDebug!.getState());
  await page.evaluate(() => (window.__gameDebug as any).inspectPose({ x: 0, y: 4, z: 0, yaw: Math.PI, pitch: .08, distance: 24, detached: true }));
  const results = [];
  for (const id of ["neutral", ...Object.keys(BIOME_LOOKS)]) {
    await page.getByLabel("Biome atmosphere", { exact: true }).selectOption(id);
    await page.waitForTimeout(1600);
    const state = await read();
    assert.equal(state.preview, id);
    const expected = id === "neutral" ? 1 : BIOME_LOOKS[id as keyof typeof BIOME_LOOKS].saturation;
    assert.ok(Math.abs(state.saturation - expected) < .015, `${id} must reach its shader target`);
    assert.equal(state.sky.enabled, true);
    const fogScale = blendBiomeSky(id === "neutral" ? {} : { [id]: 1 }).fogFar;
    assert.ok(Math.abs(state.sky.fogFar - 210 * fogScale) < 3, `${id} must change actual fog range`);
    await page.screenshot({ path: `${output}/${id}.png` });
    results.push({ id, state });
  }
  const after = await page.evaluate(() => window.__gameDebug!.getState());
  assert.equal(after.regionId, before.regionId);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${output}/resized.png` });
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(driver.consoleErrors, []);
  await writeFile(`${output}/lab.json`, JSON.stringify({ before, after, results, errors: driver.consoleErrors }, null, 2));
  console.log(JSON.stringify({ ok: true, presets: results.length, output }));
  }
} finally { await driver.close(); await server.close(); }
