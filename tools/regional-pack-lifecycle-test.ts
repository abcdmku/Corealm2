/** One natural pack lifecycle per invocation. Root schedules these serially on the GPU. */
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { GameEvent, SemanticEntity, Vec3 } from "../game/src/contracts.js";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue, repoRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";

interface PackDebug {
  getState(): { health: number; currency: number; skills: { melee: { xp: number } }; clock: { timeScale: number } };
  getEntity(id: string): SemanticEntity | null;
  getEvents(since?: number): { events: GameEvent[]; nextSeq: number };
  getErrors(): unknown[];
  setHealth(value: number): void;
  getEntityMotion(id: string): unknown;
  getPlayerPosition(): { x: number; y: number; z: number };
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}
interface PackFixture { packId: string; ids: string[]; habitat: { centre: [number, number]; radius: number }; spawn: Vec3 }
const CASES = {
  melee: { pack: "pack_fallowmarch_kiln_track_west_patrol", species: "goblin_scout", name: "Goblin Scout" },
  ranged: { pack: "pack_fallowmarch_palewood_northwest_watch", species: "goblin_archer", name: "Goblin Archer" },
  magic: { pack: "pack_fallowmarch_kiln_track_east_watch", species: "goblin_shaman", name: "Goblin Shaman" },
} as const;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const caseId = argValue(args, "--case") ?? "melee";
  if (!(caseId in CASES)) throw new Error("--case must be melee, ranged or magic");
  const selected = CASES[caseId as keyof typeof CASES];
  const clearDeadline = installTestDeadline(`Regional pack ${caseId} lifecycle`, 120_000);
  const url = argValue(args, "--url");
  const server = url ? { url, close: async () => {} } : await startGameServer();
  const driver = new GameDriver(server, {
    headless: !args.includes("--headed"), viewport: { width: 1440, height: 900 },
    browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
  });
  const directory = path.join(repoRoot, "test-results", "regional-pack-lifecycle", caseId);
  await mkdir(directory, { recursive: true });
  const report: Record<string, unknown> = { passed: false, caseId, packId: selected.pack, naturalTime: true,
    budgetMs: 120000, hardware: "ANGLE D3D11", visualAcceptance: "Root must inspect screenshots." };
  try {
    await driver.launch();
    await driver.open(25000, `/index.html?mode=combat&rpg=1&pack=${selected.pack}`);
    const page = driver.page!;
    const read = () => page.evaluate(() => {
      const w = window as unknown as { __packLab: PackFixture; __gameDebug: PackDebug };
      return { fixture: w.__packLab, entities: w.__packLab.ids.map((id) => w.__gameDebug.getEntity(id)!),
        state: w.__gameDebug.getState(), player: w.__gameDebug.getPlayerPosition(), events: w.__gameDebug.getEvents(0).events };
    });
    const poll = async (label: string, predicate: (value: Awaited<ReturnType<typeof read>>) => boolean, ms: number) => {
      const until = Date.now() + ms;
      let current = await read();
      while (!predicate(current)) {
        if (Date.now() > until) throw new Error(`${label} timed out: ${JSON.stringify(current.state)}`);
        await page.waitForTimeout(100);
        current = await read();
      }
      return current;
    };
    const invoke = (name: string, args: Record<string, unknown>) => page.evaluate(async ({ name, args }) => {
      const result = await (window as unknown as { __gameDebug: PackDebug }).__gameDebug.callTool(name, args);
      if (result && typeof result === "object" && "error" in result) throw new Error(JSON.stringify(result));
      return result;
    }, { name, args });
    const initial = await read();
    assert.equal(initial.fixture.packId, selected.pack);
    assert(initial.entities.length >= 5 && initial.entities.length <= 10);
    assert.equal(initial.state.clock.timeScale, 1);
    for (const entity of initial.entities) {
      assert.equal(entity.state, "alive");
      assert.equal(entity.name, selected.name);
      assert((entity.combat?.level ?? 0) > 0);
      assert(!/\bT\d+\b/.test(entity.name));
    }
    report.levels = initial.entities.map((entity) => ({ name: entity.name, level: entity.combat!.level }));
    const patrol = await poll("natural patrol movement", (value) => value.entities.some((entity, index) =>
      Math.hypot(entity.position[0] - initial.entities[index]!.position[0], entity.position[2] - initial.entities[index]!.position[2]) > 0.5), 14000);
    const separation = (entities: SemanticEntity[]) => {
      let gap = Infinity;
      for (let a = 0; a < entities.length; a++) for (let b = a + 1; b < entities.length; b++) {
        const first = entities[a]!, second = entities[b]!;
        gap = Math.min(gap, Math.hypot(first.position[0] - second.position[0], first.position[2] - second.position[2])
          - first.combat!.bodyRadius! - second.combat!.bodyRadius!);
      }
      return gap;
    };
    report.patrolMinimumGap = separation(patrol.entities);
    assert(Number(report.patrolMinimumGap) >= -0.15, "patrol bodies overlap");
    await page.screenshot({ path: path.join(directory, "patrol.png") });
    await page.evaluate(() => {
      window.__featureLab!.setLevel("melee", 1);
      window.__featureLab!.setLevel("magic", 1);
      (window as unknown as { __gameDebug: PackDebug }).__gameDebug.setHealth(100000);
    });
    const beforeAttack = await read();
    const [x, z] = initial.fixture.habitat.centre;
    await invoke("corealm_move_to", { position: [x, initial.fixture.spawn[1], z + Math.max(2.5, initial.fixture.habitat.radius * 0.35)] });
    const aggro = await poll("normal aggro and enemy damage", (value) => value.state.health < beforeAttack.state.health
      && value.events.some((event) => event.type === "combat.started" && event.data.initiator === "enemy"
        && initial.fixture.ids.includes(String(event.data.by))), 18000);
    report.enemyDamage = beforeAttack.state.health - aggro.state.health;
    const closestAttacker = Math.min(...aggro.entities.map((entity) =>
      Math.hypot(entity.position[0] - aggro.player.x, entity.position[2] - aggro.player.z)));
    report.closestEnemyAtDamageMetres = closestAttacker;
    if (caseId !== "melee") assert(closestAttacker > 3, `${caseId} pack must inflict damage while standing beyond melee distance`);
    report.attackMotion = await page.evaluate((ids) => ids.map((id) => ({ id,
      motion: (window as unknown as { __gameDebug: PackDebug }).__gameDebug.getEntityMotion(id) })), initial.fixture.ids);
    await page.screenshot({ path: path.join(directory, "combat.png") });
    await page.evaluate(async () => {
      const lab = window.__featureLab!;
      lab.setLevel("melee", 35);
      lab.setLevel("magic", 35);
      const weapon = lab.getCatalog().equipment.find((row) => row.slot === "mainHand")?.items
        .find((item) => /kaldite_sword|corven_sword|grithe_sword/.test(item.id));
      if (!weapon) throw new Error("No production melee weapon in lab catalogue");
      await lab.equipPlayer("mainHand", weapon.id);
    });
    const targetId = initial.fixture.ids[0]!;
    const beforeKill = await read();
    await invoke("corealm_attack", { entityId: targetId });
    const dead = await poll("one attack command kills resident", (value) =>
      value.entities[0]!.state === "dead" && value.entities[0]!.combat!.health === 0, 18000);
    assert(dead.state.skills.melee.xp > beforeKill.state.skills.melee.xp, "real kill must award XP");
    assert(dead.events.some((event) => event.type === "item.received" && event.data.from === targetId
      && Number(event.data.currency) > 0), "real kill must award its normal coin loot");
    report.kill = { id: targetId, xp: dead.state.skills.melee.xp - beforeKill.state.skills.melee.xp,
      currency: dead.state.currency - beforeKill.state.currency };
    await page.screenshot({ path: path.join(directory, "death.png") });
    await invoke("corealm_move_to", { position: initial.fixture.spawn });
    const revived = await poll("natural 30-second respawn", (value) => value.entities[0]!.state === "alive"
      && value.entities[0]!.combat!.health === value.entities[0]!.combat!.maxHealth, 36000);
    report.respawn = revived.entities[0];
    assert.equal(revived.state.clock.timeScale, 1);
    await page.screenshot({ path: path.join(directory, "respawn.png") });
    const errors = await page.evaluate(() => (window as unknown as { __gameDebug: PackDebug }).__gameDebug.getErrors());
    assert.deepEqual(errors, []);
    assert.deepEqual(driver.pageErrors, []);
    report.passed = true;
  } catch (error) {
    report.error = String(error);
    throw error;
  } finally {
    await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
    await driver.close();
    await server.close();
    clearDeadline();
  }
  console.log(JSON.stringify(report));
}
await main();
