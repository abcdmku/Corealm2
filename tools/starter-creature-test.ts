import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { GameDriver } from "./lib/driver.js";
import { startGameServer } from "./lib/server.js";
import { STARTER_CREATURES } from "../game/src/content/starterCreatures.js";
import { RPG_BESTIARY } from "../game/src/content/rpgBestiary.js";
import { installTestDeadline } from "./lib/deadline.js";

const clear = installTestDeadline("Starter creature combat", 120_000);
const server = await startGameServer();
const driver = new GameDriver(server, { headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const wasps = process.argv.includes("--wasps");
const starterVariant = process.argv.includes("--starter-variant");
const candidateIndex = process.argv.indexOf("--candidate");
const candidate = candidateIndex >= 0 ? process.argv[candidateIndex + 1] : null;
if (candidateIndex >= 0 && (!wasps || !candidate)) throw new Error("--candidate requires --wasps and a GLB path");
const out = starterVariant ? `test-results/starter-wasp-variants/lab-${candidate?.split(/[\\/]/).at(-1)?.replace(".glb", "") ?? "live"}` : wasps ? "test-results/wasp-plumage/lab" : "test-results/starter-creature-combat";
const report: unknown[] = [];
try {
  await mkdir(out, { recursive: true });
  await driver.launch();
  if (candidate) {
    const bytes = await readFile(candidate);
    await driver.page!.route(starterVariant ? /\/models\/creature\/creature_(field|marsh)_wasp\.glb/ : "**/models/creature/creature_marsh_wasp.glb*", route => route.fulfill({ body: bytes, contentType: "model/gltf-binary" }));
  }
  await driver.open(25000, "/index.html?mode=combat");
  const page = driver.page!;
  await page.waitForFunction(() => window.__featureLab?.getState().ready === true);
  const speciesList = starterVariant ? STARTER_CREATURES.filter(row => row.id === "field_wasp") : wasps ? [...STARTER_CREATURES.filter(row => row.id.endsWith("_wasp")), RPG_BESTIARY.find(row => row.id === "marsh_wasp")!] : STARTER_CREATURES;
  for (const species of speciesList) {
    await page.evaluate(async id => {
      const lab = window.__featureLab!;
      await lab.perform("reset-player");
      for (const skill of ["melee", "magic"] as const) lab.setLevel(skill, id === "marsh_wasp" ? 8 : 1);
      await lab.equipPlayer("mainHand", null);
      await lab.spawnTarget("creature", `species:${id}`, { distance: 3 });
      (window.__gameDebug as unknown as { inspectPose(p: unknown): boolean }).inspectPose(
        { x: 0, y: 0, z: 0, yaw: 1.3, pitch: 0.42, distance: 9 });
    }, species.id);
    await page.waitForTimeout(400);
    const before = await page.evaluate(() => window.__featureLab!.getState());
    await page.screenshot({ path: `${out}/${species.id}-idle.png` });
    await page.getByRole("button", { name: "Attack spawned creature", exact: true }).click();
    await page.waitForFunction(({ hp, playerHp }) => {
      const state = window.__featureLab!.getState();
      return (state.target?.health ?? hp) < hp && state.player.health < playerHp;
    }, { hp: before.target!.health!, playerHp: before.player.health }, { timeout: 14000 });
    const after = await page.evaluate(() => window.__featureLab!.getState());
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/${species.id}-combat.png` });
    assert((after.target!.health ?? Infinity) < before.target!.health!);
    assert(after.player.health < before.player.health);
    report.push({ species: species.id, before, after });
    if (wasps) {
      for (const yaw of [1.3, -1.3]) {
        await page.evaluate(({ position, yaw }) => {
          (window.__gameDebug as unknown as { inspectPose(p: unknown): boolean }).inspectPose(
            { x: position[0], y: position[1], z: position[2], yaw, pitch: 0.32, distance: 5 });
        }, { position: after.player.position, yaw });
        await page.waitForTimeout(150);
        await page.screenshot({ path: `${out}/${species.id}-detail-${yaw > 0 ? "left" : "right"}.png` });
      }
    }
  }
  const errors = await page.evaluate(() => (window.__gameDebug as unknown as { getErrors(): unknown[] }).getErrors());
  assert.deepEqual(errors, []);
  assert.deepEqual(driver.consoleErrors, []);
  assert.deepEqual(driver.pageErrors, []);
  console.log(JSON.stringify({ passed: true, species: report.length, errors }));
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await driver.close();
  await server.close();
  clear();
}

