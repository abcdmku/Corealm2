import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameDriver, FAST_TEST_SETTINGS } from "../../../tools/lib/driver.js";
import { installTestDeadline } from "../../../tools/lib/deadline.js";
import { assertGameplayHardware } from "./finish-gameplay-renderer.js";
import { installAudioCapture, startAudioCapture, stopAudioCapture, type AudioMarker, type AudioSourceStart } from "./audio-capture-support.js";
import { analyseRecording, startAfter } from "./audio-recording-analysis.js";

/**
 * Real gameplay audio timing on hardware Chromium with actual audio.
 *
 * `npx tsx runs/corealm-rebuild/checks/audio-timing-browser.ts --case chop|mine|melee|spell|fish [--url http://127.0.0.1:4186]`
 *
 * Every case boots the production combat lab, performs the real action through the production API,
 * records the bus mix, and measures, in wall-clock milliseconds:
 *   scheduling offset  = AudioBufferSource.start wall time - the semantic marker that asked for it
 *   audible offset     = detected onset in the recording - scheduled start (recorder bias removed)
 *   visual offset      = rig contact marker - semantic damage/roll marker, where both exist
 * Declared tool/loadout/approach setup is diagnostic; the swing, chop, cast and catch are real.
 */
const argv = process.argv.slice(2);
const arg = (flag: string, fallback: string): string => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback; };
const scenario = arg("--case", "chop");
assert(["chop", "mine", "melee", "spell", "fish"].includes(scenario), `Unknown case ${scenario}`);
const url = arg("--url", process.env.COREALM_URL ?? "http://127.0.0.1:4186");
const out = `test-results/audio-timing/${scenario}-${Date.now()}`;
await mkdir(out, { recursive: true });
const finish = installTestDeadline(`Audio timing ${scenario}`, 59000);
const report: Record<string, unknown> = { passed: false, scenario, url,
  scope: "Production action on hardware D3D11 with real audio; offsets measured from taps. No listening claim." };
const driver = new GameDriver({ url, close: async () => {} }, {
  headless: true,
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
  settings: { ...FAST_TEST_SETTINGS, music: 0.3, ambient: 0.5, sfx: 0.9 },
});
const route = scenario === "chop" ? "/index.html?mode=combat&forest=1"
  : scenario === "mine" ? "/index.html?mode=combat&presentation=1"
    : scenario === "fish" ? "/index.html?mode=combat&fishing=1" : "/index.html?mode=combat";

type Offsets = Array<Record<string, number | string | null>>;
const offsetRows: Offsets = [];
const row = (label: string, marker: number, start: AudioSourceStart | null, extra: Record<string, number | string | null> = {}): void => {
  offsetRows.push({ label, markerAtMs: Math.round(marker * 10) / 10, startAtMs: start ? Math.round(start.atMs * 10) / 10 : null,
    schedulingOffsetMs: start ? Math.round((start.atMs - marker) * 10) / 10 : null, preRollSkippedS: start?.offsetS ?? null, ...extra });
};

try {
  await driver.launch();
  const page = driver.page!;
  page.setDefaultTimeout(6000);
  await installAudioCapture(page);
  await driver.open(26000, route);
  report.renderer = await assertGameplayHardware(page);
  await page.locator("#panel-feature-lab .panel__close").click();

  if (scenario === "melee" || scenario === "spell") {
    await page.evaluate(`(async()=>{
      const lab=window.__featureLab;const preset=lab.getCatalog().targets.creature.find(p=>/Brown Bear/.test(p.label));
      if(!preset)throw new Error('Authored Brown Bear preset missing');
      await lab.spawnTarget('creature',preset.id,{distance:${scenario === "spell" ? 6 : 2}});
      lab.setLevel('melee',99);lab.setLevel('magic',99);
      await lab.equipPlayer('mainHand',${scenario === "spell" ? "'air_staff'" : "'kaldite_sword'"});
      if(${JSON.stringify(scenario)}==='spell')lab.setSpell('voltrend');
    })()`);
  } else if (scenario === "chop") {
    await page.evaluate(`(() => {
      const debug=window.__gameDebug;debug.clearInventory();debug.giveItem('grithe_hatchet',1,'inventory');
      const tree=debug.getEntity('feature-lab:forest:oak:1');if(!tree)throw new Error('Forest fixture missing');
      const p=tree.interactionPosition??tree.position;if(!debug.teleport([p[0]-1.4,p[1],p[2]]))throw new Error('Tree approach failed');
    })()`);
  } else if (scenario === "mine") {
    await page.evaluate(`(() => {
      const debug=window.__gameDebug;debug.clearInventory();debug.giveItem('grithe_pickaxe',1,'inventory');
      const ore=debug.getEntity('feature-lab:presentation:ore_grithe');if(!ore)throw new Error('Presentation ore missing');
      const p=ore.interactionPosition??ore.position;if(!debug.teleport([p[0]-1.2,p[1],p[2]]))throw new Error('Ore approach failed');
    })()`);
  } else {
    await page.waitForFunction("Boolean(window.__fishingLab)", undefined, { timeout: 5000 });
    report.fishing = await page.evaluate(`(() => {
      const debug=window.__gameDebug;debug.clearInventory();debug.giveItem('palewood_rod',1,'inventory');
      const fixture=window.__fishingLab.getState();const id=fixture.entityIds[0];
      const anchor=fixture.accessPositions[id];if(!debug.teleport(anchor))throw new Error('Fishing approach failed');
      return {id,anchor};
    })()`);
  }
  // Warm the unlock before recording so the first cue is not also the first decode.
  await page.evaluate("window.__gameDebug.getAudioState()");
  await startAudioCapture(page);
  report.before = await driver.callDebug("getSaveBlob", []);

  const historyCount = (cue: string): string => `window.__gameDebug.getAudioHistory().filter(e=>e.kind==='cue'&&e.cue===${JSON.stringify(cue)}).length`;
  if (scenario === "chop") {
    report.action = await driver.callDebug("callTool", ["corealm_interact", { entityId: "feature-lab:forest:oak:1", interaction: "chop" }]);
    await page.waitForFunction(`${historyCount("gather.wood_impact")}>=3`, undefined, { timeout: 16000 });
  } else if (scenario === "mine") {
    report.action = await driver.callDebug("callTool", ["corealm_interact", { entityId: "feature-lab:presentation:ore_grithe", interaction: "mine" }]);
    await page.waitForFunction(`${historyCount("gather.mining_impact")}>=3`, undefined, { timeout: 16000 });
  } else if (scenario === "melee") {
    report.action = await page.evaluate("window.__featureLab.perform('attack')");
    await page.waitForFunction(`${historyCount("combat.melee_hit")}+${historyCount("combat.melee_miss")}>=2`, undefined, { timeout: 16000 });
  } else if (scenario === "spell") {
    report.action = await page.evaluate("window.__featureLab.perform('cast')");
    await page.waitForFunction(`${historyCount("combat.magic_hit")}>=2`, undefined, { timeout: 20000 });
  } else {
    const fishing = report.fishing as { id: string };
    report.action = await driver.callDebug("callTool", ["corealm_interact", { entityId: fishing.id, interaction: "fish" }]);
    await page.waitForFunction(`${historyCount("gather.fishing_catch")}>=1`, undefined, { timeout: 22000 });
  }
  report.activeDuring = await driver.callDebug("getAudioState", []);
  report.stopped = await driver.callDebug("callTool", ["corealm_stop", {}]);
  const stopAt = await page.evaluate("performance.now()") as number;
  await page.waitForTimeout(1500);
  report.history = await driver.callDebug("getAudioHistory", []);
  report.events = await driver.callDebug("getEvents", [0]);
  report.after = await driver.callDebug("getSaveBlob", []);
  report.audioAfter = await driver.callDebug("getAudioState", []);
  const capture = await stopAudioCapture(page);
  report.recordStart = capture.recordStart;
  report.markers = capture.markers.map((m) => ({ ...m, args: m.args.map((a) => typeof a === "string" ? a : { ...a, spellId: (a as Record<string, unknown>)["spellId"] }) }));
  report.rig = capture.rig;
  report.sourceStarts = capture.starts;

  const history = report.history as Array<{ kind: string; cue?: string; atMs: number }>;
  const markers = capture.markers;
  const contact = (m: AudioMarker, kind: string): boolean => m.method === "handleGatherMotion" && m.args[0] === kind;
  const events = (type: string): AudioMarker[] => markers.filter((m) => m.method === "handleEvent" && (m.args[0] as Record<string, unknown>)["type"] === type);

  if (scenario === "chop" || scenario === "mine") {
    const pose = scenario === "chop" ? "chop" : "mine";
    const cueImpact = scenario === "chop" ? "gather.wood_impact" : "gather.mining_impact";
    const swings = markers.filter((m) => contact(m, pose) && m.args[1] === "swing");
    const impacts = markers.filter((m) => contact(m, pose) && m.args[1] === "impact");
    assert(swings.length >= 1 && impacts.length >= 3, "Rig swing and impact markers reached the bridge");
    for (const marker of impacts) {
      const start = startAfter(capture.starts, marker.atMs);
      const received = events("item.received").map((e) => e.atMs).filter((t) => Math.abs(t - marker.atMs) < 700).sort((a, b) => Math.abs(a - marker.atMs) - Math.abs(b - marker.atMs))[0];
      row(`${pose} impact`, marker.atMs, start, { semanticRollMs: received === undefined ? null : Math.round((received - marker.atMs) * 10) / 10 });
    }
    for (const marker of swings) row(`${pose} swing`, marker.atMs, startAfter(capture.starts, marker.atMs));
    assert(!history.some((e) => e.cue === cueImpact && e.atMs > stopAt + 300), "No stale tool impacts after stop");
    report.staleImpactsAfterStop = history.filter((e) => e.cue === cueImpact && e.atMs > stopAt).length;
  }
  if (scenario === "melee") {
    // `paintCombatHits` routes EVERY resolved hit through this handler, the enemy's included, and
    // an enemy hit is always "combined" because only the player's rig has a swing marker. Scoping
    // to `attacker === "player"` is not a filter of inconvenient data: an incoming bear swing is a
    // different cue family with no swing/contact split to measure.
    const byPlayer = (m: AudioMarker): boolean =>
      m.method === "handlePlayerCombatMotion" && (m.args[0] as Record<string, unknown>)["attacker"] === "player";
    const swingMarkers = markers.filter((m) => byPlayer(m) && m.args[1] === "swing");
    const contactMarkers = markers.filter((m) => byPlayer(m) && (m.args[1] === "impact" || m.args[1] === "combined"));
    report.enemyContacts = markers.filter((m) => m.method === "handlePlayerCombatMotion"
      && (m.args[0] as Record<string, unknown>)["attacker"] === "enemy")
      .map((m) => ({ atMs: Math.round(m.atMs), phase: m.args[1], hit: (m.args[0] as Record<string, unknown>)["hit"] }));
    const rigSwings = capture.rig.filter((r) => r.pose === "attack_melee" && r.kind === "swing");
    const rigImpacts = capture.rig.filter((r) => r.pose === "attack_melee" && r.kind === "impact");
    assert(contactMarkers.length >= 2, "Two melee contacts presented");
    assert(swingMarkers.length >= 2, "Swing presented on the rig marker for each attack");
    for (const marker of swingMarkers) row("melee swing (rig marker)", marker.atMs, startAfter(capture.starts, marker.atMs));
    for (const marker of contactMarkers) {
      const start = startAfter(capture.starts, marker.atMs);
      const visual = rigImpacts.map((r) => r.atMs).sort((a, b) => Math.abs(a - marker.atMs) - Math.abs(b - marker.atMs))[0];
      const priorSwing = swingMarkers.filter((s) => s.atMs < marker.atMs).at(-1);
      row(`melee ${marker.args[1] as string} (${(marker.args[0] as Record<string, unknown>)["hit"] ? "hit" : "miss"})`, marker.atMs, start, {
        rigContactMinusSemanticMs: visual === undefined ? null : Math.round((visual - marker.atMs) * 10) / 10,
        swingLeadMs: priorSwing ? Math.round((marker.atMs - priorSwing.atMs) * 10) / 10 : null,
      });
    }
    report.rigSwingCount = rigSwings.length;
    const phases = contactMarkers.map((m) => m.args[1]);
    assert(phases.every((p) => p === "impact"), `Player contacts present as impact only when the swing sounded: ${phases.join(",")}`);
    assert(!history.some((e) => e.cue === "combat.melee_swing" && contactMarkers.some((c) => Math.abs(c.atMs - e.atMs) < 60)),
      "No swing whoosh stacked on a contact frame");
  }
  if (scenario === "spell") {
    const launches = events("spell.launched");
    const impacts = markers.filter((m) => m.method === "handlePlayerCombatMotion" && m.args[1] === "impact");
    assert(launches.length >= 2 && impacts.length >= 2, "Two launches and two arrivals");
    for (const marker of launches) {
      const start = startAfter(capture.starts, marker.atMs);
      const data = marker.args[0] as { data?: { flightMs?: number } };
      const arrival = impacts.map((i) => i.atMs).filter((t) => t > marker.atMs).sort((a, b) => a - b)[0];
      row("spell cast (launch event)", marker.atMs, start, { declaredFlightMs: data.data?.flightMs ?? null,
        measuredFlightMs: arrival === undefined ? null : Math.round((arrival - marker.atMs) * 10) / 10 });
    }
    for (const marker of impacts) row("spell impact (arrival)", marker.atMs, startAfter(capture.starts, marker.atMs));
  }
  if (scenario === "fish") {
    const interact = markers.filter((m) => m.method === "handleInteraction" && m.args[0] === "fish");
    const catches = events("item.received");
    assert(interact.length >= 1 && catches.length >= 1, "Cast interaction and a catch");
    for (const marker of interact) row("fishing cast (interaction)", marker.atMs, startAfter(capture.starts, marker.atMs));
    for (const marker of catches) row("fishing catch (item.received)", marker.atMs, startAfter(capture.starts, marker.atMs));
  }

  report.offsets = offsetRows;
  const scheduling = offsetRows.map((r) => r["schedulingOffsetMs"]).filter((v): v is number => typeof v === "number");
  assert(scheduling.length > 0 && scheduling.every((v) => v >= -2 && v <= 40), `Scheduling offsets within 40 ms: ${scheduling.join(", ")}`);
  report.recording = await analyseRecording(`${out}/production-${scenario}.webm`, capture.bytes, capture.starts, capture.recordStart);
  assert(capture.bytes.length > 1000);
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(driver.consoleErrors, []);
  report.passed = true;
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await driver.close();
  finish();
  console.log(JSON.stringify({ passed: report.passed, out, offsets: offsetRows }));
}
