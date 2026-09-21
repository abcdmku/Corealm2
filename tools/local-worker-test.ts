import "./lib/repoContent.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { preview } from "vite";
import { SaveService } from "../game/src/persistence/storage.js";
import { createInitialState } from "../game/src/state/store.js";
import { installTestDeadline } from "./lib/deadline.js";
import { gameRoot, repoRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";

/**
 * Worker-hosted local play in a real browser, on hardware rendering.
 *
 *   tsx tools/local-worker-test.ts            the dev server
 *   tsx tools/local-worker-test.ts --dist     the production build in game/dist (run `npm run build` first)
 *
 * One browser profile goes through a player's whole life with the feature: an old main-thread save
 * is waiting, the first boot imports it, the player walks and gathers, a second tab is turned away,
 * and a reload finds the character where it was left, including a reload one second after a walk.
 * The debug channel is then held to its promise: an awaited write is visible to the very next read.
 * Fresh profiles then time the old local path (`?local=main`) against the worker path, which is the
 * default. Ports 4340 to 4349, or `COREALM_TEST_PORT`.
 */
const dist = process.argv.includes("--dist");
const out = path.join(repoRoot, "test-results/local-worker"); await mkdir(out, { recursive: true });
const clearDeadline = installTestDeadline("local worker", 420_000);
const PORT = Number(process.env.COREALM_TEST_PORT) || (dist ? 4341 : 4340);
const server = dist
  ? await preview({ root: gameRoot, logLevel: "error", preview: { host: "127.0.0.1", port: PORT, strictPort: true } }).then(running => ({ url: `http://127.0.0.1:${PORT}`, close: () => running.close() }))
  : await startGameServer({ port: PORT, strictPort: true });
const browser = await chromium.launch({ headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
  ...(process.platform === "win32" ? ["--use-angle=d3d11"] : [])] });
const SETTINGS = JSON.stringify({ renderScale: 0.7, shadowQuality: "off", drawDistance: "near", music: 0, ambient: 0, sfx: 0 });
const WORKER_URL = `${server.url}/?play=local`;

const checks: Record<string, boolean> = {}; const errors: string[] = []; const notes: Record<string, unknown> = {};

interface Observation {
  starts: number; running: boolean; crashed: boolean; phase: string; status: string; simTicks: number; remoteSimulation: boolean; tick: number | null; firstSnapshotAtMs: number | null; startMs: number | null;
  ready: { legacy: string; storage: string; seed: { requested: number; used: number }; timings: Record<string, number> } | null; storageTrouble: unknown;
}
interface Lab { player: { name: string; position: number[] }; currency: number; inventory: { slots: ({ itemId: string; quantity: number } | null)[] };
  entities: { id: string; archetype: string; state: string; position: number[]; interactions: string[]; requirements?: Record<string, number> }[]; skills: Record<string, { level: number }> }
const observe = (page: Page): Promise<Observation> => page.evaluate(() => window.__corealmLocalWorker!.observe() as never);
const lab = (page: Page): Promise<Lab> => page.evaluate(() => window.__multiplayerLab!.observe() as never);
const held = (state: Lab): Record<string, number> => { const counts: Record<string, number> = {}; for (const slot of state.inventory.slots) if (slot) counts[slot.itemId] = (counts[slot.itemId] ?? 0) + slot.quantity; return counts; };

async function context(seed?: string): Promise<BrowserContext> {
  const made = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await made.addInitScript(({ settings, save }) => {
    localStorage.setItem("corealm.settings.v1", settings);
    // Once: a reload must find whatever the first boot left, not the fixture again.
    if (save && !localStorage.getItem("corealm.test.seeded")) { localStorage.setItem("corealm.test.seeded", "1"); localStorage.setItem("corealm.save.v1", save); }
  }, { settings: SETTINGS, save: seed ?? null });
  return made;
}
async function open(made: BrowserContext, url: string, label: string): Promise<Page> {
  const page = await made.newPage();
  page.on("pageerror", error => errors.push(`${label}: ${error.message}`));
  page.on("console", message => { if (message.type() === "error") errors.push(`${label}: ${message.text().slice(0, 400)}`); });
  await page.goto(url, { waitUntil: "load" });
  return page;
}
const playing = (page: Page, timeout = 120_000) => page.waitForFunction(() => {
  const seen = window.__corealmLocalWorker?.observe() as { phase: string; firstSnapshotAtMs: number | null } | undefined;
  return seen?.phase === "connected" && seen.firstSnapshotAtMs !== null && window.__gameDebug?.getState().ready === true;
}, null, { timeout });
/** First playable, in milliseconds since navigation start. For the worker path that is the later of the scene and the first snapshot. */
const timing = (page: Page) => page.evaluate(() => {
  const telemetry = (window as unknown as { __corealmBootTelemetry: { snapshot(): { startedAtEpochMs: number; marks: { name: string; atMs: number }[]; spans: { name: string; startMs: number; endMs: number }[] } } }).__corealmBootTelemetry.snapshot();
  const mark = telemetry.marks.find(entry => entry.name === "boot.playable");
  const prepare = telemetry.spans.find(span => span.name === "boot.localWorker.prepare");
  return { scenePlayableMs: mark ? Math.round(telemetry.startedAtEpochMs + mark.atMs - performance.timeOrigin) : null, prepareMs: prepare ? Math.round(prepare.endMs - prepare.startMs) : null };
});

try {
  // ---- 1. An old save is waiting. The first worker boot imports it.
  const legacy = createInitialState(1337);
  legacy.player.name = "Maren"; legacy.currency = 431;
  const free = legacy.inventory.slots.findIndex(slot => slot === null); legacy.inventory.slots[free] = { slotIndex: free, itemId: "grithe_ore", quantity: 7 };
  const profile = await context(new SaveService(false).serialize(legacy));
  const first = await open(profile, WORKER_URL, "first"); await playing(first);
  const started = await observe(first), arrived = await lab(first);
  notes.firstBoot = { startMs: Math.round(started.startMs ?? 0), timings: started.ready?.timings, storage: started.ready?.storage, seed: started.ready?.seed, ...(await timing(first)),
    firstSnapshotMs: Math.round(started.firstSnapshotAtMs ?? 0) };
  // The first open writes every entity of the world once. It is written while the scene still loads, off the tick loop; this is what it cost.
  notes.firstOpenFlush = await first.evaluate(() => (window.__gameDebug as unknown as { saveNow(): Promise<unknown> }).saveNow());
  checks.workerSession = started.phase === "connected" && started.running && started.starts === 1;
  checks.indexedDbStorage = started.ready?.storage === "indexeddb";
  checks.legacyCharacterLoaded = started.ready?.legacy === "imported" && arrived.player.name === "Maren" && arrived.currency === 431 && held(arrived).grithe_ore === 7;
  const keys = await first.evaluate(() => ({ save: localStorage.getItem("corealm.save.v1") !== null, backup: localStorage.getItem("corealm.save.v1.backup"), migrated: localStorage.getItem("corealm.save.v1.migrated") }));
  checks.legacyBackupAndMarker = !keys.save && typeof keys.backup === "string" && JSON.parse(keys.backup).player.name === "Maren" && keys.migrated !== null;

  // ---- 2. The page simulates nothing, and the world still moves: it arrives by replication.
  const tickBefore = started.tick ?? 0; await first.waitForTimeout(1500);
  const later = await observe(first);
  checks.noMainThreadSimulation = later.simTicks === 0 && later.remoteSimulation === true;
  checks.replicationAdvances = (later.tick ?? 0) >= tickBefore + 10;

  // ---- 3. Walk with the keyboard, then gather with the UI's own command entry.
  await first.locator("canvas").first().click({ position: { x: 640, y: 200 } });
  await first.keyboard.down("w"); await first.waitForTimeout(1500); await first.keyboard.up("w");
  await first.waitForTimeout(400);
  const walked = await lab(first);
  notes.walkedMetres = Number(Math.hypot(walked.player.position[0]! - arrived.player.position[0]!, walked.player.position[2]! - arrived.player.position[2]!).toFixed(2));
  checks.walkedByInput = (notes.walkedMetres as number) > 1;
  const verbs: Record<string, [string, string]> = { tree: ["chop", "woodcutting"], ore: ["mine", "mining"], fish: ["fish", "fishing"] };
  const nodes = walked.entities.filter(entity => verbs[entity.archetype] && entity.state === "available"
    && (entity.requirements?.[verbs[entity.archetype]![1]] ?? 1) <= (walked.skills[verbs[entity.archetype]![1]]?.level ?? 1))
    .map(entity => ({ entity, metres: Math.hypot(entity.position[0]! - walked.player.position[0]!, entity.position[2]! - walked.player.position[2]!) })).sort((a, b) => a.metres - b.metres);
  const node = nodes[0];
  if (!node) throw new Error("No gatherable node was replicated near the spawn");
  notes.gathered = { id: node.entity.id, archetype: node.entity.archetype, metres: Number(node.metres.toFixed(1)) };
  const before = held(walked);
  const outcome = await first.evaluate(([id, verb]) => window.__corealmLocalWorker!.command({ method: "interact", args: [id!, verb as "mine"] }) as Promise<{ status: string }>, [node.entity.id, verbs[node.entity.archetype]![0]]);
  checks.commandAccepted = outcome.status === "accepted";
  await first.waitForFunction((known) => {
    const slots = (window.__multiplayerLab!.observe() as { inventory: { slots: ({ itemId: string; quantity: number } | null)[] } }).inventory.slots;
    const counts: Record<string, number> = {}; for (const slot of slots) if (slot) counts[slot.itemId] = (counts[slot.itemId] ?? 0) + slot.quantity;
    return Object.keys(counts).some(id => counts[id] !== (known as Record<string, number>)[id]);
  }, before, { timeout: 120_000 });
  checks.inventoryChangedByCommand = true;
  checks.stillNoMainThreadSimulation = (await observe(first)).simTicks === 0;
  await first.screenshot({ path: path.join(out, dist ? "playing-dist.png" : "playing.png"), timeout: 10_000 }).catch(() => {});

  // ---- 4. A second tab is turned away, and says why.
  const second = await open(profile, WORKER_URL, "second tab");
  await second.waitForFunction(() => (window.__corealmLocalWorker?.observe() as { phase: string } | undefined)?.phase === "unavailable", null, { timeout: 120_000 });
  const refused = await observe(second);
  notes.secondTab = refused.status;
  checks.secondTabRefused = /already open in another tab/i.test(refused.status) && !refused.running;
  await second.screenshot({ path: path.join(out, "second-tab.png"), timeout: 10_000 }).catch(() => {});
  await second.close();
  checks.firstTabUnaffected = (await observe(first)).phase === "connected";

  // ---- 5. Reload. The character, what it carries and where it stood come back from IndexedDB.
  await first.evaluate(() => window.__corealmLocalWorker!.command({ method: "stop", args: [] }));
  await first.waitForTimeout(6500); // One write-behind interval, so this proves the timed flush rather than the unload.
  const left = await lab(first);
  await first.reload({ waitUntil: "load" }); await playing(first);
  const back = await lab(first), again = await observe(first);
  notes.reload = { startMs: Math.round(again.startMs ?? 0), timings: again.ready?.timings, legacy: again.ready?.legacy,
    movedMetres: Number(Math.hypot(back.player.position[0]! - left.player.position[0]!, back.player.position[2]! - left.player.position[2]!).toFixed(2)) };
  checks.characterPersisted = back.player.name === "Maren" && back.currency === left.currency;
  checks.inventoryPersisted = JSON.stringify(held(back)) === JSON.stringify(held(left)) && JSON.stringify(held(back)) !== JSON.stringify(before);
  checks.positionPersisted = (notes.reload as { movedMetres: number }).movedMetres < 0.5;
  checks.legacyNotOfferedAgain = again.ready?.legacy === "none";

  // ---- 6. Leave at once: only the unload flush can have saved this walk. Reported, not required, because a browser may end the worker first.
  await first.locator("canvas").first().click({ position: { x: 640, y: 200 } });
  await first.keyboard.down("s"); await first.waitForTimeout(1200); await first.keyboard.up("s"); await first.waitForTimeout(300);
  const hurried = await lab(first);
  await first.reload({ waitUntil: "load" }); await playing(first);
  const after = await lab(first);
  notes.unloadFlush = { walkedMetres: Number(Math.hypot(hurried.player.position[0]! - back.player.position[0]!, hurried.player.position[2]! - back.player.position[2]!).toFixed(2)),
    lostMetres: Number(Math.hypot(after.player.position[0]! - hurried.player.position[0]!, after.player.position[2]! - hurried.player.position[2]!).toFixed(2)) };

  // ---- 7. Reload one second after a walk. Only the quick write that follows a change can have saved it: the timed flush is five seconds out.
  await first.locator("canvas").first().click({ position: { x: 640, y: 200 } });
  await first.keyboard.down("d"); await first.waitForTimeout(1200); await first.keyboard.up("d");
  await first.evaluate(() => window.__corealmLocalWorker!.command({ method: "stop", args: [] }));
  const stoodAt = await lab(first);
  await first.waitForTimeout(1000);
  await first.reload({ waitUntil: "load" }); await playing(first);
  const quick = await lab(first);
  notes.quickReload = { walkedMetres: Number(Math.hypot(stoodAt.player.position[0]! - after.player.position[0]!, stoodAt.player.position[2]! - after.player.position[2]!).toFixed(2)),
    lostMetres: Number(Math.hypot(quick.player.position[0]! - stoodAt.player.position[0]!, quick.player.position[2]! - stoodAt.player.position[2]!).toFixed(2)) };
  checks.positionKeptAfterQuickReload = (notes.quickReload as { walkedMetres: number }).walkedMetres > 1 && (notes.quickReload as { lostMetres: number }).lostMetres < 0.5;

  // ---- 8. The debug channel. Each write is awaited and then read at once, from the page's own replicated state, with no wait between.
  const debugged = await first.evaluate(async () => {
    const debug = window.__gameDebug as unknown as Record<string, (...args: unknown[]) => Promise<unknown>> & { getState(): { currency: number; health: number; skills: Record<string, { level: number }>; clock: { tick: number; paused: boolean } }; getPlayerPosition(): { x: number; z: number } };
    // No named helper in here: tsx wraps one in `__name`, which the page does not have.
    type Slots = { inventory: { slots: ({ itemId: string; quantity: number } | null)[] } };
    const before = (window.__multiplayerLab!.observe() as Slots).inventory.slots.reduce((sum, slot) => sum + (slot?.itemId === "palewood_log" ? slot.quantity : 0), 0);
    await debug.giveItem!("palewood_log", 3, "inventory");
    const gave = (window.__multiplayerLab!.observe() as Slots).inventory.slots.reduce((sum, slot) => sum + (slot?.itemId === "palewood_log" ? slot.quantity : 0), 0) - before;
    await debug.setCurrency!(1234); const currency = debug.getState().currency;
    await debug.setSkillLevel!("mining", 37); const mining = debug.getState().skills.mining!.level;
    // The bank is far outside the 48 m the page is sent. The host still knows where it is.
    const bank = await debug.getEntity!("coldbrace_bank") as { id: string; position: number[] } | null;
    const local = (window.__multiplayerLab!.observe() as { entities: { id: string }[] }).entities.some(entity => entity.id === "coldbrace_bank");
    await debug.teleport!({ entityId: "coldbrace_bank" }); const at = debug.getPlayerPosition();
    const arrived = bank ? Math.hypot(at.x - bank.position[0]!, at.z - bank.position[2]!) : Infinity;
    await debug.setPaused!(true); const pausedAt = debug.getState().clock.tick;
    await new Promise(resolve => setTimeout(resolve, 600)); const stillAt = debug.getState().clock.tick;
    await debug.advanceTicks!(5); const stepped = debug.getState().clock.tick;
    await debug.advanceGameTime!(30); const jumped = debug.getState().clock.tick;
    await debug.setPaused!(false);
    const blob = await debug.getSaveBlob!() as string, saved = JSON.parse(blob) as { currency: number; meta: { saveVersion: number } };
    await debug.setCurrency!(5); await debug.loadSaveBlob!(blob); const restored = debug.getState().currency;
    const flush = await debug.saveNow!() as Record<string, number> | null;
    return { gave, currency, mining, bankFound: bank?.id === "coldbrace_bank", bankReplicatedBefore: local, arrived, pausedAt, stillAt, stepped, jumped, savedCurrency: saved.currency, saveVersion: saved.meta.saveVersion, restored, flush };
  });
  notes.debug = debugged;
  checks.debugWriteVisibleAtOnce = debugged.gave === 3 && debugged.currency === 1234 && debugged.mining === 37;
  checks.debugReadsWholeWorld = debugged.bankFound && !debugged.bankReplicatedBefore && debugged.arrived < 8;
  checks.debugTimeControl = debugged.stillAt === debugged.pausedAt && debugged.stepped === debugged.pausedAt + 5 && debugged.jumped === debugged.stepped + 301;
  checks.debugSaveRoundTrip = debugged.savedCurrency === 1234 && debugged.saveVersion > 0 && debugged.restored === 1234;
  // The big first-open write is long done. What is flushed now is a handful of rows, and it must stay cheap.
  notes.flush = debugged.flush;
  checks.flushStaysCheap = debugged.flush !== null && debugged.flush.lastRows! < 200 && debugged.flush.lastMs! < 250;
  await profile.close();

  // ---- 9. Timings, each in a fresh profile: the old main-thread path, then the worker path.
  const oldProfile = await context(), old = await open(oldProfile, `${server.url}/?play=local&local=main`, "old path");
  await old.waitForFunction(() => window.__gameDebug?.getState().ready === true, null, { timeout: 120_000 });
  const oldTiming = await timing(old);
  checks.oldPathUnchanged = await old.evaluate(() => window.__corealmLocalWorker === undefined);
  await oldProfile.close();
  const freshProfile = await context(), fresh = await open(freshProfile, WORKER_URL, "fresh worker"); await playing(fresh);
  const freshSeen = await observe(fresh), freshTiming = await timing(fresh);
  notes.timings = { oldPathFirstPlayableMs: oldTiming.scenePlayableMs,
    workerPath: { scenePlayableMs: freshTiming.scenePlayableMs, firstSnapshotMs: Math.round(freshSeen.firstSnapshotAtMs ?? 0), manifestPrepareMs: freshTiming.prepareMs,
      firstPlayableMs: Math.max(freshTiming.scenePlayableMs ?? 0, Math.round(freshSeen.firstSnapshotAtMs ?? 0)), workerColdStartMs: Math.round(freshSeen.startMs ?? 0), worker: freshSeen.ready?.timings } };
  await freshProfile.close();
} catch (error) {
  errors.push(error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error));
} finally {
  await browser.close(); await server.close(); clearDeadline();
}
const benign = (text: string): boolean => /favicon|ERR_ABORTED|AudioContext/.test(text);
const failures = errors.filter(error => !benign(error));
const passed = failures.length === 0 && Object.keys(checks).length >= 23 && Object.values(checks).every(Boolean);
const report = { passed, mode: dist ? "dist" : "dev", checks, notes, errors: failures };
await writeFile(path.join(out, dist ? "report-dist.json" : "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(passed ? 0 : 1);
