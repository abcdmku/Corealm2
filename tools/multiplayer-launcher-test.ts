import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { startLocalMultiplayer } from "./lib/localMultiplayer.js";
import { installTestDeadline } from "./lib/deadline.js";

const mode = process.argv.includes("--prod") ? "prod" : "dev";
const authored = process.argv.includes("--authored");
const sustained = process.argv.includes("--sustained");
const budget = authored ? 120_000 : 60_000;
const clearDeadline = installTestDeadline(`multiplayer ${mode} launcher`, budget);
const started = Date.now(), out = `test-results/multiplayer-launcher-${mode}${authored ? "-authored" : ""}`;
await mkdir(out, { recursive: true });
const data = await mkdtemp(`${out}/save-`);
const args = ["--web-port", "0", "--world-port", "0", "--data", data,
  ...(authored ? [] : ["--lab"]), ...(mode === "prod" ? ["--skip-build"] : [])];
let server: Awaited<ReturnType<typeof startLocalMultiplayer>> | undefined;
const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
const errors: string[] = [], checks: Record<string, boolean> = {};
const acknowledgements: number[] = [];
let connections = 0, sampleConnections = 0, sustainedFrames: number[] = [];
type State = { player: { position: number[] }; players: { position: number[] }[] };
try {
  server = await startLocalMultiplayer(mode, args);
  const directory = await (await fetch(`http://127.0.0.1:${server.worldPort}/worlds`)).json();
  checks.capacity = directory.length === 1 && directory[0].capacity === 200;
  const html = await (await fetch(server.url)).text();
  checks.correctBundle = mode === "dev" ? html.includes("/@vite/client") : html.includes("/assets/entry/") && !html.includes("/@vite/client");
  const openWorlds = async (page: Page) => {
    const panel = page.locator("#multiplayer-selector");
    if (await panel.isVisible().catch(() => false)) return;
    const title = page.getByRole("dialog", { name: "Corealm", exact: true });
    if (!(await title.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "Open menu", exact: true }).click();
    }
    if (await panel.isVisible().catch(() => false)) return;
    await page.getByRole("button", { name: "Worlds", exact: true }).click();
  };
  const drawnScene = async (page: Page, name: string) => {
    const sentinel = authored ? "coldbrace_gate_south#pf0_0_0" : "feature-lab:bank";
    const handle = await page.waitForFunction(id => {
      const debug = window.__gameDebug as any;
      const bounds = debug?.getDrawnBounds?.(id);
      const metrics = debug?.getMetrics?.();
      const views = debug?.getEntityViewStats?.();
      const resident = Number(views?.residency?.resident ?? 0);
      return bounds && Number(bounds.meshes) > 0 && resident > 0
        && Number(metrics?.drawCalls) > 0 && Number(metrics?.triangles) > 0
        ? { bounds, resident, drawCalls: metrics.drawCalls, triangles: metrics.triangles } : false;
    }, sentinel, { timeout: 10_000 });
    const evidence = await handle.jsonValue();
    await handle.dispose();
    if (!evidence) throw new Error(`${name} has no rendered world scene`);
    checks[`${name}.drawnGate`] = Boolean(evidence?.bounds?.meshes);
    checks[`${name}.renderedScene`] = Number(evidence?.drawCalls) > 0 && Number(evidence?.triangles) > 0;
  };
  const open = async (page: Page, name: string) => {
    const launchUrl = new URL(server!.url);
    if (!launchUrl.pathname.endsWith("index.html")) {
      launchUrl.pathname = `${launchUrl.pathname.replace(/\/$/, "")}/index.html`;
    }
    launchUrl.searchParams.set("worldMenu", "1");
    if (!authored) {
      launchUrl.searchParams.set("mode", "combat");
      launchUrl.searchParams.set("multiplayer", "1");
    }
    await page.goto(launchUrl.toString(), { waitUntil: "domcontentloaded" });
    try { await page.waitForFunction(() => !!window.__multiplayerLab, null, { timeout: authored ? 45_000 : 20_000 }); }
    catch (error) {
      await page.screenshot({ path: `${out}/${name}-boot-failure.png` });
      await writeFile(`${out}/${name}-boot-failure.json`, JSON.stringify({ error: String(error), errors, text: await page.locator("body").innerText() }, null, 2));
      throw error;
    }
    await openWorlds(page);
    if (await page.locator("#multiplayer-selector").getAttribute("data-phase") === "connected") throw new Error("Launcher auto-joined");
    await page.getByRole("textbox", { name: "Development guest name" }).fill(name);
    await page.locator(".worlds__row--world input").first().check();
    await page.getByRole("button", { name: "Join world", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#multiplayer-selector")?.getAttribute("data-phase") === "connected", null, { timeout: 5000 });
    await page.getByRole("dialog", { name: "Corealm", exact: true }).waitFor({ state: "hidden", timeout: 5000 });
    await drawnScene(page, name);
  };
  const pages = await Promise.all(["alice", "bob"].map(async name => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    // Configuration must come from the launcher, not test-injected world globals.
    await context.addInitScript(() => localStorage.setItem("corealm.settings.v1", JSON.stringify({ renderScale: .7, shadowQuality: "low", drawDistance: "near", music: 0, ambient: 0, sfx: 0 })));
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    if (sustained && name === "alice") {
      page.on("websocket", socket => {
        connections++;
        const sent = new Map<number, number>();
        socket.on("framesent", frame => {
          const message = JSON.parse(String(frame.payload));
          if (message.type === "command") sent.set(message.envelope.sequence, performance.now());
        });
        socket.on("framereceived", frame => {
          const message = JSON.parse(String(frame.payload));
          if (message.type === "ack") {
            const start = sent.get(message.outcome.sequence);
            if (start !== undefined) { acknowledgements.push(performance.now() - start); sent.delete(message.outcome.sequence); }
          }
        });
      });
    }
    await open(page, name); return page;
  }));
  const a = pages[0]!, b = pages[1]!;
  const profiler=process.argv.includes("--profile")?await a.context().newCDPSession(a):null;
  if(profiler){await profiler.send("Profiler.enable");await profiler.send("Profiler.start");}
  checks.automaticConfiguration = true; checks.explicitJoin = true;
  await b.waitForFunction(() => (window.__multiplayerLab!.observe() as State).players.length === 1);
  const before = await a.evaluate(() => window.__multiplayerLab!.observe() as State);
  await a.locator("canvas").first().click({ position: { x: 600, y: 330 } });
  await a.keyboard.down("d");
  try {
    await b.waitForFunction(origin => {
      const other = (window.__multiplayerLab!.observe() as State).players[0];
      return !!other && Math.hypot(other.position[0]! - origin[0]!, other.position[2]! - origin[2]!) > .4;
    }, before.player.position, { timeout: 5000 });
  } finally { await a.keyboard.up("d"); }
  checks.replicatedMovement = true;
  // Exercise the shipped UI and the observer's real equipment renderer in both boot profiles.
  await a.locator('.dock__btn[data-panel="inventory"]').click();
  const inventory = a.getByRole("dialog", { name: "Inventory", exact: true });
  await inventory.waitFor({ state: "visible" });
  await inventory.getByRole("button", { name: "Worn Shortsword", exact: true }).click();
  await b.waitForFunction(()=>(window.__multiplayerLab!.observe() as {presentation:{id:string;equipment:{mainHand?:string}}[]}).presentation.some(p=>p.id==="alice"&&p.equipment.mainHand==="worn_sword"));
  checks.replicatedEquipment=true;
  await a.locator('.dock__btn[data-panel="inventory"]').click();
  if (sustained) {
    await a.addScriptTag({ content: "window.__name = (fn) => fn" });
    const frames = a.evaluate(async () => {
      const samples: number[] = [], end = performance.now() + 20_000;
      let previous = performance.now();
      await new Promise<void>(resolve => {
        const frame = (now: number) => { samples.push(now - previous); previous = now;
          if (now < end) requestAnimationFrame(frame); else resolve(); };
        requestAnimationFrame(frame);
      });
      return samples;
    });
    for (let i = 0; i < 20; i++) {
      const key = i % 2 ? "a" : "d";
      await a.keyboard.down(key); await a.waitForTimeout(400); await a.keyboard.up(key);
      await a.locator("canvas").first().click({ position: { x: 610 + i % 2 * 30, y: 410 } });
      await a.waitForTimeout(600);
    }
    sustainedFrames = await frames;
    sampleConnections = connections;
    checks.stableConnection = connections === 1 && await a.locator("#multiplayer-selector").getAttribute("data-phase") === "connected";
    const ordered = [...acknowledgements].sort((a, b) => a - b);
    // Use the documented p95 response target. Preserve the maximum in the report so a cold
    // shader/asset hitch cannot disappear behind the percentile or be claimed as hitch-free.
    checks.responsiveCommands = acknowledgements.length >= 40 && ordered[Math.floor(ordered.length * .95)]! < 250;
  }
  if(profiler)await writeFile(`${out}/player.cpuprofile`,JSON.stringify((await profiler.send("Profiler.stop")).profile));
  await a.screenshot({ path: `${out}/connected.png` });
  if (!authored) {
    // Leave explicitly before restarting so the saved pose has no ongoing movement intent.
    await openWorlds(a);
    await a.locator(".worlds__row--local input").check(); await a.getByRole("button", { name: "Leave world", exact: true }).click();
    await a.waitForFunction(() => document.querySelector("#multiplayer-selector")?.getAttribute("data-phase") === "offline");
    await openWorlds(b);
    await b.locator(".worlds__row--local input").check(); await b.getByRole("button", { name: "Leave world", exact: true }).click();
    await b.waitForFunction(() => document.querySelector("#multiplayer-selector")?.getAttribute("data-phase") === "offline");
    const oldWorldPort = server.worldPort, oldUrl = server.url;
    await server.close();
    checks.stoppedListeners = await Promise.all([oldUrl, `http://127.0.0.1:${oldWorldPort}/readyz`].map(url => fetch(url).then(() => false, () => true))).then(results => results.every(Boolean));
    server = await startLocalMultiplayer(mode, args);
    await open(a, "alice");
    const restored = await a.evaluate(() => window.__multiplayerLab!.observe() as State);
    checks.restartPersistence = Math.hypot(restored.player.position[0]! - before.player.position[0]!, restored.player.position[2]! - before.player.position[2]!) > .4;
    await a.screenshot({ path: `${out}/restored.png` });
  }
  checks.noRuntimeErrors = errors.length === 0; checks.withinBudget = Date.now() - started < budget;
  const passed = Object.values(checks).every(Boolean);
  const summary = (samples: number[]) => { const sorted = [...samples].sort((a,b) => a-b); return {
    count: sorted.length, p50: sorted[Math.floor(sorted.length*.5)] ?? 0,
    p95: sorted[Math.floor(sorted.length*.95)] ?? 0, max: sorted.at(-1) ?? 0 }; };
  await writeFile(`${out}/report.json`, JSON.stringify({ passed, checks, errors, durationMs: Date.now() - started,
    ...(sustained ? { acknowledgementsMs: summary(acknowledgements), rafFrameMs: summary(sustainedFrames), connectionsDuringSample: sampleConnections } : {}) }, null, 2));
  console.log(JSON.stringify({ passed, checks, errors }));
  if (!passed) process.exitCode = 1;
} finally { await browser.close(); await server?.close(); clearDeadline(); }
