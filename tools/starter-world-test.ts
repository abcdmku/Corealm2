import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameDriver } from "./lib/driver.js";
import { startGameServer } from "./lib/server.js";
import { STARTER_GROUPS } from "../game/src/content/starterHabitats.js";
import type { SemanticEntity, Vec3 } from "../game/src/contracts.js";
import { installTestDeadline } from "./lib/deadline.js";
import MANIFEST from "../game/public/assets/manifest.json";
import { activatedRegionalPackIds, REGIONAL_PACK_ACTIVATION } from "../game/src/content/regionalPackActivation.js";
import { createRpgRegionalPackCatalogue } from "../game/src/content/rpgRegionalPacks.js";

interface Debug {
  getState(): { ready: boolean; health: number };
  getEntity(id: string): SemanticEntity;
  getEntities(): { id: string }[];
  getErrors(): unknown[];
  groundHeight(x: number, z: number): number;
  sampleWorld(x: number, z: number): { playable: boolean; waterBodyId: string | null };
  getNavPath(from: Vec3, to: Vec3): { x: number; y: number; z: number }[] | null;
  inspectPose(pose: unknown): boolean;
  getPlayerPosition(): { x: number; y: number; z: number };
  callTool(name: string, args: unknown): Promise<unknown>;
}
const boundary = process.argv.includes("--boundary");
const clear = installTestDeadline(boundary ? "Pack boundary combat" : "Starter world integration", 120_000);
const server = await startGameServer();
const driver = new GameDriver(server, { headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const out = `test-results/starter-${boundary ? "boundary" : "world"}`;
const evidence: unknown[] = [];
try {
  await mkdir(out, { recursive: true });
  await driver.launch();
  await driver.open(60000, boundary
    ? "/index.html?mode=combat&rpg=1&pack=pack_fallowmarch_palewood_far_south_scrub" : "/index.html");
  const page = driver.page!;
  if (boundary) {
    const setup = await page.evaluate(() => {
      const debug = window.__gameDebug as unknown as Debug;
      const pack = (window as unknown as { __packLab: { ids: string[]; habitat: { centre: [number, number]; radius: number } } }).__packLab;
      window.__featureLab!.setLevel("melee", 1);
      window.__featureLab!.setLevel("magic", 1);
      const [x, z] = pack.habitat.centre;
      const actor = debug.getEntity(pack.ids[0]!);
      const dx = actor.position[0] - x, dz = actor.position[2] - z;
      const distance = Math.hypot(dx, dz);
      const px = x + dx / distance * (pack.habitat.radius + 1);
      const pz = z + dz / distance * (pack.habitat.radius + 1);
      debug.inspectPose({ x: px, y: debug.groundHeight(px, pz), z: pz,
        yaw: 1.3, pitch: 0.5, distance: 14 });
      return { pack, state: debug.getState(), player: debug.getPlayerPosition() };
    });
    await page.waitForTimeout(400);
    const before = { ...setup, state: await page.evaluate(() => (window.__gameDebug as unknown as Debug).getState()) };
    await page.waitForFunction(hp => (window.__gameDebug as unknown as Debug).getState().health < hp,
      before.state.health, { timeout: 18000 });
    const after = await page.evaluate(() => {
      const debug = window.__gameDebug as unknown as Debug;
      return { state: debug.getState(), player: debug.getPlayerPosition() };
    });
    assert(after.state.health < before.state.health);
    assert(Math.hypot(after.player.x - before.pack.habitat.centre[0], after.player.z - before.pack.habitat.centre[1]) > before.pack.habitat.radius);
    evidence.push({ before, after });
    await page.screenshot({ path: `${out}/outside-habitat-attack.png` });
  } else {
    const catalogue = createRpgRegionalPackCatalogue(id => {
      const asset = MANIFEST.assets.find(row => row.id === id);
      return asset?.base ? { size: asset.size, base: asset.base } : null;
    }, activatedRegionalPackIds(), REGIONAL_PACK_ACTIVATION.assignmentOverrides);
    const active = await page.evaluate(packs => {
      const debug = window.__gameDebug as unknown as Debug;
      const ids = debug.getEntities().map(row => row.id);
      return { unique: new Set(ids).size === ids.length, packs: packs.map(pack => {
        const actors = pack.ids.map(id => debug.getEntity(id));
        return { id: pack.id, actors, dry: actors.every(actor => {
          const sample = debug.sampleWorld(actor.position[0], actor.position[2]);
          return sample.playable && !sample.waterBodyId;
        }), routes: actors.slice(1).map(actor => ({ id: actor.id, position: actor.position,
          path: debug.getNavPath(actors[0]!.position, actor.position) })) };
      }) };
    }, catalogue.packs.map(pack => ({ id: pack.id, ids: pack.members.map(member => member.id) })));
    assert(active.unique, "No duplicate world entity IDs");
    for (const pack of active.packs) {
      assert(pack.dry, `${pack.id} residents must stand on dry playable terrain`);
      for (const route of pack.routes) {
        assert(route.path?.length, `${route.id} must be reachable within its formation`);
        const end = route.path.at(-1)!;
        assert(Math.hypot(end.x-route.position[0],end.z-route.position[2]) < 1, `${route.id} route must reach the resident`);
      }
    }
    evidence.push({ activatedRegionalPacks: active });
    for (const group of STARTER_GROUPS) {
      const result = await page.evaluate(group => {
        const debug = window.__gameDebug as unknown as Debug;
        const actors = debug.getEntities().filter(row => row.id === group.id || row.id.startsWith(`${group.id}_`)).map(row => debug.getEntity(row.id));
        const [x, z] = group.centre;
        debug.inspectPose({ x, y: debug.groundHeight(x, z), z: z + 9, yaw: 0.8, pitch: 0.5, distance: 16 });
        const player = debug.getPlayerPosition();
        return { actors, samples: actors.map(actor => debug.sampleWorld(actor.position[0], actor.position[2])),
          paths: actors.map(actor => debug.getNavPath([player.x, player.y, player.z], actor.position)) };
      }, group);
      assert.equal(result.actors.length, group.count, group.id);
      for (const actor of result.actors) {
        assert.equal(actor.view?.assetId, group.assetId);
        assert(actor.interactions.includes("attack"));
        assert((actor.combat?.maxHealth ?? 0) > 0);
      }
      assert(result.samples.every(sample => sample.playable && !sample.waterBodyId), `${group.id} must stand on dry playable terrain`);
      for (let index = 0; index < result.paths.length; index++) {
        const route = result.paths[index];
        assert(route && route.length > 0, `${group.id} resident must be reachable`);
        const end = route.at(-1)!;
        const actor = result.actors[index]!;
        assert(Math.hypot(end.x - actor.position[0], end.z - actor.position[2]) < 1, `${actor.id} path must reach the actor`);
      }
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${out}/${group.family}.png` });
      evidence.push({ group, ...result });
    }
    const rat = STARTER_GROUPS.find(group => group.family === "granary_rat")!;
    const before = await page.evaluate(async group => {
      const debug = window.__gameDebug as unknown as Debug;
      const actor = debug.getEntity(debug.getEntities().find(row => row.id.startsWith(`${group}_`))!.id);
      const result = await debug.callTool("corealm_attack", { entityId: actor.id });
      return { id: actor.id, health: actor.combat!.health, result };
    }, rat.id);
    await page.waitForFunction(({ id, health }) => (window.__gameDebug as unknown as Debug).getEntity(id).combat!.health < health,
      before, { timeout: 18000 });
    evidence.push({ combatBefore: before, combatAfter: await page.evaluate(id => (window.__gameDebug as unknown as Debug).getEntity(id), before.id) });
    await page.screenshot({ path: `${out}/world-rat-combat.png` });
  }
  assert.deepEqual(await page.evaluate(() => (window.__gameDebug as unknown as Debug).getErrors()), []);
  assert.deepEqual(driver.consoleErrors, []);
  assert.deepEqual(driver.pageErrors, []);
  console.log(JSON.stringify({ passed: true, boundary, checks: evidence.length }));
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(evidence, null, 2));
  await driver.close();
  await server.close();
  clear();
}

