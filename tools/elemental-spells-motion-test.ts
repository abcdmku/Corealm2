import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { elementalSpell } from "../game/src/content/elementalSpells.js";
import { planElementalAttack } from "../game/src/systems/elementalAttacks.js";
import type { SpellRangeApi } from "../game/src/contracts.js";
import { CAMERA } from "../game/src/app/config.js";
import { GameDriver } from "./lib/driver.js";
import { argValue, repoRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";
import { installTestDeadline } from "./lib/deadline.js";

declare global {
  interface Window {
    __spellRange?: SpellRangeApi;
  }
}

const args = process.argv.slice(2),
  spell = elementalSpell(argValue(args, "--spell") ?? "starfall");
const clear = installTestDeadline(`Spell motion: ${spell.id}`, 60_000);
const external = argValue(args, "--url");
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
const out = path.join(
  repoRoot,
  "test-results",
  "elemental-spells",
  "motion",
  `${spell.id}${args.includes("--orbit") ? "-orbit" : ""}`,
);
await mkdir(out, { recursive: true });
const pulses = planElementalAttack(spell.id, [20, 0, 28], [20, 0, 40]);
const first = pulses[0]!.at,
  last = pulses.at(-1)!.at;
const boulder = spell.id === "flint-shot" || spell.id === "siege-boulder";
const phases = [
  { name: "charge", at: 160 },
  { name: "travel", at: first * 0.75 },
  ...(boulder ? [{ name: "pre-contact", at: first - 75 }, { name: "breakup", at: first + 45 }] : []),
  { name: "contact", at: first + 150 },
  { name: "peak", at: Math.max(first + 320, last - 300) },
  { name: "final-impact", at: last + 150 },
  { name: "fade", at: last + 820 },
  ...(args.includes("--contacts")?[...new Set(pulses.map(p=>p.at))].map((at,i)=>({name:`contact-${i+1}`,at:at+95})):[]),
].sort((a, b) => a.at - b.at);
const frames: unknown[] = [];
let intactGeometry = "";
try {
  await driver.launch();
  await driver.open(30_000, "/index.html?mode=combat&spells=1");
  const page = driver.page!;
  await page.waitForFunction(() => !!window.__spellRange);
  await page.locator("#spell-range-element").selectOption(spell.element);
  await page.locator("#spell-range-select").selectOption(spell.id);
  await page.locator("#spell-range-slow").check();
  if (args.includes("--orbit")) {
    await page.mouse.move(1050, 620);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(1000, 705, { steps: 20 });
    await page.mouse.up({ button: "right" });
  }
  await page.locator("#spell-range-cast").click();
  for (const phase of phases) {
    // Observe the actual running simulation. No time stepping, camera override or frozen frame.
    await page.waitForFunction(
      (at) => window.__spellRange!.getState().elapsed >= at,
      phase.at,
      { timeout: 10000 },
    );
    const state = await page.evaluate(() => window.__spellRange!.getState());
    const art = await page.evaluate(() =>
      (window.__gameDebug as unknown as { getElementalArtState(): {earth: {boulderPieces:number;shatterSeconds:number;geometryId:string}} }).getElementalArtState());
    if(boulder && phase.name === "pre-contact") {
      assert.equal(art.earth.boulderPieces,1);
      assert.equal(art.earth.shatterSeconds,0);
      intactGeometry=art.earth.geometryId;
      assert(intactGeometry);
    }
    if(boulder && (phase.name === "breakup" || phase.name === "contact")) {
      assert.equal(art.earth.boulderPieces,spell.id === "flint-shot" ? 72 : 180);
      assert(art.earth.shatterSeconds>0);
      assert.equal(art.earth.geometryId,intactGeometry,"The intact boulder's own geometry separates into fragments");
    }
    const camera = (await page.evaluate(() =>
      window.__gameDebug!.getCamera(),
    )) as { freeMove: boolean; requestedDistance: number; pitch: number };
    assert.equal(camera.freeMove, false);
    assert(
      camera.requestedDistance >= CAMERA.minDistance &&
        camera.requestedDistance <= CAMERA.maxDistance,
    );
    assert(camera.pitch >= CAMERA.minPitch && camera.pitch <= CAMERA.maxPitch);
    if (phase.name === "charge") assert.equal(state.damage, 0);
    if (phase.name === "final-impact")
      assert.equal(state.impacts, state.totalImpacts);
    await page.screenshot({
      path: path.join(out, `${phase.name}.png`),
      timeout: 5000,
    });
    const glow = await page.evaluate(() =>
      (
        window.__gameDebug as unknown as { getMagicGlowState(): unknown }
      ).getMagicGlowState(),
    );
    frames.push({ phase: phase.name, state, camera, glow, art });
  }
  await page.waitForFunction(
    () => window.__spellRange!.getState().instances === 0,
    undefined,
    { timeout: 5000 },
  );
  assert.deepEqual([...driver.consoleErrors, ...driver.pageErrors], []);
  await writeFile(
    path.join(out, "report.json"),
    JSON.stringify({ spell: spell.id, frames, errors: [] }, null, 2),
  );
  await writeFile(
    path.join(out, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>${spell.name} motion review</title><style>body{margin:24px;background:#11191e;color:#e7ebed;font:16px system-ui}main{display:grid;grid-template-columns:repeat(2,1fr);gap:20px}figure{margin:0}img{width:100%}figcaption{padding:8px}a{color:#95d6e3}</style><h1>${spell.name}</h1><p>Live cast at 0.35× using the lab's Slow motion control. Normal player-follow camera. <a href="report.json">Observed state and camera</a></p><main>${phases.map((p) => `<figure><img src="${p.name}.png"><figcaption>${p.name}</figcaption></figure>`).join("")}</main>`,
  );
  console.log(
    JSON.stringify({
      passed: true,
      spell: spell.id,
      frames: frames.length,
      output: out,
    }),
  );
} finally {
  await driver.close();
  await server.close();
  clear();
}
