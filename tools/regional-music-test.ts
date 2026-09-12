import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameDriver } from "./lib/driver.js";
import { startGameServer } from "./lib/server.js";
import { installTestDeadline } from "./lib/deadline.js";

const world = process.argv.includes("--world");
const finish = installTestDeadline("Regional music", world ? 120_000 : 60_000);
const server = await startGameServer();
const driver = new GameDriver(server, {
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
  settings: { music: 0.7, ambient: 0, sfx: 0,
    ...(world ? { renderScale: 0.7, shadowQuality: "off", drawDistance: "near" } : {}) },
});
const out = "test-results/regional-music";
await mkdir(out, { recursive: true });
const evidence: unknown[] = [];
try {
  await driver.launch();
  const page = driver.page!;
  await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination: any, ...args: any[]): any {
      if (destination instanceof AudioDestinationNode) {
        let analyser = (window as any).__musicAnalyser as AnalyserNode | undefined;
        if (!analyser) {
          analyser = this.context.createAnalyser();
          (window as any).__musicAnalyser = analyser;
          (connect as any).call(analyser, destination);
        }
        return (connect as any).call(this, analyser);
      }
      return (connect as any).call(this, destination, ...args);
    };
  });
  await driver.open(world ? 90_000 : 45_000, world ? "/index.html" : "/index.html?mode=combat&music=1");
  const read = () => page.evaluate(() => {
    const debug = window.__gameDebug as any;
    return { audio: debug.getAudioState(), position: debug.getPlayerPosition(), history: debug.getAudioHistory(100) };
  });
  const expectMusic = async (name: string) => {
    await page.waitForFunction(name => {
      const state = (window.__gameDebug as any).getAudioState();
      const active = state.activeLoops.filter((id: string) => id.startsWith("music."));
      return state.unlocked && active.length === 1 && active[0] === name;
    }, name, { timeout: 10_000 });
    // Actual output samples, with ambience and effects muted, prove the decoded track reaches the mix.
    await page.waitForFunction(() => {
      const analyser = (window as any).__musicAnalyser as AnalyserNode | undefined;
      if (!analyser) return false;
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      return samples.some(value => Math.abs(value) > 0.001);
    }, undefined, { timeout: 5000 });
    const state = await read();
    assert.deepEqual(state.audio.diagnostics, []);
    assert.ok(state.history.some((event: any) => event.kind === "loop-start" && event.name === name
      && event.url.endsWith(`/audio/music/${name.slice(6)}.mp3`)));
    evidence.push({ name, ...state });
  };
  if (world) {
    await driver.press("Shift");
    await expectMusic("music.starter-plains");
    await driver.callDebug("setHealth", [10000]);
    const visit = async (x: number, z: number, name: string) => {
      await driver.callDebug("inspectPose", [{ x, y: 0, z, yaw: Math.PI, pitch: 0.4, distance: 8, detached: false }]);
      await expectMusic(name);
    };
    for (const [x, z, region, name] of [
      [2080, -108, "gloamgarden", "music.fairy"], [2300, 145, "faeholme", "music.fairy-mire"],
      [480, 100, "crownward", "music.distant-plains"],
      [554.2, -79.8, "crownward", "music.castle"], [574.2, 320.6, "crownward", "music.castle"],
      [560, 268, "crownward", "music.castle"], [480, 100, "crownward", "music.distant-plains"],
    ] as const) {
      await visit(x, z, name);
      assert.equal((await read()).audio.regionId, region);
    }
    await visit(550, -117, "music.distant-plains");
    const before = await read();
    await driver.press("w", 1100);
    await expectMusic("music.castle");
    assert.notDeepEqual((await read()).position, before.position);
    await page.screenshot({ path: `${out}/world-castle-approach.png`, timeout: 5000 });
    await driver.press("s", 2600);
    await expectMusic("music.distant-plains");
    await page.screenshot({ path: `${out}/world-plains.png`, timeout: 5000 });
    assert.deepEqual(await driver.callDebug("getErrors"), []);
  } else {
  for (const [label, name] of [["T30 Fairy", "music.fairy"], ["T60 Fairy Mire", "music.fairy-mire"], ["T40 Plains", "music.distant-plains"]]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expectMusic(name!);
  }
  await page.getByRole("button", { name: "Castle approach", exact: true }).click();
  await page.evaluate(() => (window.__gameDebug as any).inspectPose({ x: 0, y: 0, z: 10, yaw: 0, pitch: 0.5, distance: 8 }));
  const before = await read();
  await driver.press("w", 900);
  await expectMusic("music.castle");
  const inside = await read();
  assert.notDeepEqual(inside.position, before.position);
  await page.screenshot({ path: `${out}/lab-castle.png`, timeout: 5000 });
  await driver.press("s", 1800);
  await expectMusic("music.distant-plains");
  await page.getByRole("button", { name: "Inside castle", exact: true }).click();
  await expectMusic("music.castle");
  await page.getByRole("button", { name: "T40 Plains", exact: true }).click();
  await page.getByRole("button", { name: "Inside castle", exact: true }).click();
  await page.getByRole("button", { name: "T40 Plains", exact: true }).click();
  await expectMusic("music.distant-plains");
  await page.screenshot({ path: `${out}/lab-plains.png`, timeout: 5000 });
  }
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(driver.consoleErrors, []);
  assert.deepEqual(driver.requestErrors, []);
  await writeFile(`${out}/${world ? "world" : "lab"}.json`, JSON.stringify({ passed: true, evidence, errors: [] }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: evidence.length, out }));
} catch (error) {
  await pageFailureCapture();
  await writeFile(`${out}/failure.json`, JSON.stringify({ error: String(error), evidence,
    audio: await driver.callDebug("getAudioState"), history: await driver.callDebug("getAudioHistory", [100]),
    state: await driver.snapshot(), errors: driver.consoleErrors }, null, 2));
  throw error;
} finally {
  await driver.close();
  await server.close();
  finish();
}

async function pageFailureCapture(): Promise<void> {
  await driver.page?.screenshot({ path: `${out}/failure.png`, timeout: 5000 }).catch(() => undefined);
}
