import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ELEMENTAL_SPELLS } from "../game/src/content/elementalSpells.js";
import type { SpellRangeApi } from "../game/src/contracts.js";
import { GameDriver } from "./lib/driver.js";
import { argValue, repoRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";
import { installTestDeadline } from "./lib/deadline.js";
import { CAMERA } from "../game/src/app/config.js";

declare global {
  interface Window {
    __spellRange?: SpellRangeApi;
    __elementalSamples?: {
      elapsed: number;
      particles: number;
      cpuMs: number;
      frameMs: number;
      dropped: number;
      filaments: number;
      droppedFilaments: number;
      bodies: number;
      droppedBodies: number;
    }[];
    __elementalSampling?: boolean;
  }
}

const args = process.argv.slice(2);
const element = argValue(args, "--element") ?? "wind";
const spells = ELEMENTAL_SPELLS.filter((spell) => spell.element === element);
assert.equal(spells.length, 6, "Use --element wind, water, earth or fire");
const clear = installTestDeadline(`Elemental spells: ${element}`, 60_000);
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
const out = path.join(repoRoot, "test-results", "elemental-spells", element);
await mkdir(out, { recursive: true });
const evidence: unknown[] = [];
try {
  await driver.launch();
  await driver.open(30_000, "/index.html?mode=combat&spells=1");
  const page = driver.page!;
  await page.waitForFunction(() => !!window.__spellRange);
  await page.locator("#spell-range-element").selectOption(element);
  for (const spell of spells) {
    await page.locator("#spell-range-select").selectOption(spell.id);
    const before = await page.evaluate(() => window.__spellRange!.getState());
    assert(
      before.targets.every((target) => target.health === target.maxHealth),
    );
    await page.evaluate(`(() => {
      window.__elementalSamples = [];
      window.__elementalSampling = true;
      let last = performance.now();
      const sample = (now) => {
        if (!window.__elementalSampling) return;
        const state = window.__spellRange.getState();
        if (state.casting && state.elapsed > 100) window.__elementalSamples.push({elapsed:state.elapsed,particles:state.particleCount,cpuMs:state.vfxUpdateMs,frameMs:now-last,dropped:state.droppedParticles,filaments:state.filamentCount,droppedFilaments:state.droppedFilaments,bodies:state.bodyCount,droppedBodies:state.droppedBodies});
        last = now;
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    })()`);
    await page.locator("#spell-range-cast").click();
    const released = await page.evaluate(() => window.__spellRange!.getState());
    assert.equal(released.damage, 0, "No instant damage on release");
    await page.waitForFunction(
      () => window.__spellRange!.getState().impacts > 0,
      undefined,
      { timeout: 7000 },
    );
    await page.waitForTimeout(spell.rank === 5 ? 650 : 200);
    const during = await page.evaluate(() => window.__spellRange!.getState());
    const camera = (await page.evaluate(() =>
      window.__gameDebug!.getCamera(),
    )) as { freeMove: boolean; requestedDistance: number; pitch: number };
    assert.equal(
      camera.freeMove,
      false,
      "Acceptance must use the gameplay follow camera",
    );
    assert(
      camera.requestedDistance >= CAMERA.minDistance &&
        camera.requestedDistance <= CAMERA.maxDistance,
    );
    assert(camera.pitch >= CAMERA.minPitch && camera.pitch <= CAMERA.maxPitch);
    assert(during.instances > 0, "Real effect instances exist at impact");
    const glow = await page.evaluate(() =>
      (
        window.__gameDebug as unknown as {
          getMagicGlowState(): { rendered: boolean; hdr: boolean };
        }
      ).getMagicGlowState(),
    );
    assert(glow.rendered && glow.hdr, "Live casts use HDR emission and bloom");
    const refraction = await page.evaluate(() =>
      (window.__gameDebug as unknown as {
        getElementalRefractionState(): { rendered: boolean; copies: number };
      }).getElementalRefractionState(),
    );
    if (spell.element === "wind" || spell.element === "water") {
      assert(refraction.rendered, `${spell.id}: moving surfaces refract the scene`);
      assert.equal(refraction.copies, 1, "Refraction shares one scene-color copy");
    } else {
      assert.equal(refraction.rendered, false);
    }
    const art = await page.evaluate(() =>
      (window.__gameDebug as unknown as {getElementalArtState(): {basic:string|null;air:{baseDiameter:number};contacts:string[];earth:{variant:string};fire:{variant:string;composition:string}}}).getElementalArtState());
    if(spell.element === "water")assert.equal(during.solidCount,0,"Water contains no ice or solid shards");
    if(spell.rank===0)assert.equal(art.basic,spell.id);
    if(spell.element === "earth"&&spell.rank>0)assert.equal(art.earth.variant,spell.id);
    if(spell.element === "fire"&&spell.rank>0)assert(art.fire.variant===spell.id && art.fire.composition.length>0);
    if(spell.id==="skybreaker")assert(art.air.baseDiameter>=11,"Hero tornado keeps a wide ground-contact base");
    const renderProfile = await page.evaluate(() =>
      (
        window.__gameDebug as unknown as {
          getRenderProfile(prefix: string): unknown;
        }
      ).getRenderProfile("elemental-3d-"),
    );
    await page.screenshot({
      path: path.join(out, `${spell.id}.png`),
      timeout: 5000,
    });
    await page.waitForFunction(
      () => !window.__spellRange!.getState().casting,
      undefined,
      { timeout: 7000 },
    );
    const after = await page.evaluate(() => window.__spellRange!.getState());
    assert.equal(after.impacts, after.totalImpacts);
    assert(after.damage > 0 && after.hits > 0);
    assert.equal(
      after.damage,
      after.targets.reduce(
        (sum, target) => sum + target.maxHealth - target.health,
        0,
      ),
    );
    if (spell.id === "air-needle"||spell.rank===0)
      assert.equal(after.targets.filter((target) => target.hits > 0).length, 1);
    if(spell.rank===0){assert.equal(after.totalImpacts,1);assert.equal(after.hits,1);}
    if (spell.rank === 5)
      assert(after.targets.filter((target) => target.hits > 0).length >= 5);
    await page.waitForFunction(
      () => window.__spellRange!.getState().instances === 0,
    );
    const samples = await page.evaluate(() => {
      window.__elementalSampling = false;
      return window.__elementalSamples!;
    });
    const peakParticles = Math.max(...samples.map((s) => s.particles));
    assert(
      peakParticles >= (spell.rank===0||spell.element === "wind" ? 100 : spell.rank === 5 ? 5000 : 700),
      "Particles must be present; pressure-led air uses sparse tracers",
    );
    assert(peakParticles <= 67000, "Particle pools remain bounded");
    const peakFilaments = Math.max(...samples.map((s) => s.filaments));
    assert(peakFilaments >= 0 && peakFilaments <= 4096, "Supporting strands remain bounded; a spell can use only its main volumes");
    const peakBodies = Math.max(...samples.map((s) => s.bodies));
    if (spell.element === "wind") {
      const refraction = await page.evaluate(() =>
        (window.__gameDebug as unknown as {getElementalRefractionState(): {rendered:boolean}}).getElementalRefractionState());
      assert.equal(refraction.rendered,false,"Air refraction cleans up after the cast");
      assert(peakFilaments<100,"Air does not return to dense white strands");
      assert.equal(during.solidCount,0,"Air emits no rocks");
    }
    assert(
      peakBodies > 0 && peakBodies <= 256,
      "Principal 3D shapes are emitted within budget",
    );
    assert(
      samples.every((s) => s.droppedBodies === 0),
      `${spell.id}: no principal shapes lost`,
    );
    assert(
      samples.every((s) => s.droppedFilaments === 0),
      `${spell.id}: no authored energy strands lost`,
    );
    assert(
      samples.every((s) => s.dropped === 0),
      `${spell.id}: no authored particles lost to capacity limits (max ${Math.max(...samples.map((s) => s.dropped))})`,
    );
    const draws = (
      renderProfile as {
        draws: { name: string; triangles: number; calls: number }[];
      }
    ).draws;
    assert(
      draws.length > 0 &&
        draws.every((draw) => draw.calls === 1 && draw.triangles >= 20),
      "Particles submit instanced 3D meshes in bounded draw calls",
    );
    const percentile = (values: number[], p: number): number =>
      values.sort((a, b) => a - b)[
        Math.min(values.length - 1, Math.floor(values.length * p))
      ]!;
    const timings = {
      peakParticles,
      peakFilaments,
      peakBodies,
      cpuMedianMs: percentile(
        samples.map((s) => s.cpuMs),
        0.5,
      ),
      cpuP95Ms: percentile(
        samples.map((s) => s.cpuMs),
        0.95,
      ),
      frameMedianMs: percentile(
        samples.map((s) => s.frameMs),
        0.5,
      ),
      frameP95Ms: percentile(
        samples.map((s) => s.frameMs),
        0.95,
      ),
    };
    evidence.push({
      spell: spell.id,
      before,
      released,
      during,
      after,
      camera,
      glow,
      refraction,
      art,
      performance: timings,
      renderProfile,
    });
  }
  await page.locator("#spell-range-reset").click();
  const reset = await page.evaluate(() => window.__spellRange!.getState());
  assert(
    reset.targets.every(
      (target) => target.health === 1000 && target.hits === 0,
    ),
  );
  assert.equal(reset.instances, 0);
  await page.locator("#spell-range-next").click();
  await page.waitForFunction(() => window.__spellRange!.getState().casting);
  await page.locator("#spell-range-reset").click();
  await page.locator("#spell-range-select").selectOption(spells[0]!.id);
  await page.locator("#spell-range-slow").check();
  await page.locator("#spell-range-cast").click();
  await page.waitForTimeout(300);
  const slow = await page.evaluate(() => window.__spellRange!.getState());
  assert.equal(slow.speed, 0.35);
  assert(slow.elapsed < 300);
  await page.locator("#spell-range-reset").click();
  await page.locator("#spell-range-slow").uncheck();
  await page.locator("#spell-range-repeat").check();
  const firstId = await page.evaluate(
    () => window.__spellRange!.getState().castId,
  );
  await page.waitForFunction(
    (id) => window.__spellRange!.getState().castId > id,
    firstId,
    { timeout: 7000 },
  );
  await page.locator("#spell-range-reset").click();
  assert.equal(
    (await page.evaluate(() => window.__spellRange!.getState())).repeat,
    false,
  );
  const errors = [...driver.consoleErrors, ...driver.pageErrors];
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, "report.json"),
    JSON.stringify({ passed: true, element, evidence, reset, errors }, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: true,
      element,
      spells: spells.length,
      output: out,
    }),
  );
} finally {
  await driver.close();
  await server.close();
  clear();
}
