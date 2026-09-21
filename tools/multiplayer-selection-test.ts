/**
 * World selection while the game is still loading, and hosts the player adds.
 *
 * Runs the real local launcher: Vite plus the reference world host, the same pages a player opens.
 * The checks are about the loading screen, so nothing here waits for the boot cover to disappear
 * before looking at the panel.
 */
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { startLocalMultiplayer } from "./lib/localMultiplayer.js";
import { installTestDeadline } from "./lib/deadline.js";

const budget = 240_000;
const clearDeadline = installTestDeadline("multiplayer world selection", budget), started = Date.now();
const out = "test-results/multiplayer-selection";
await mkdir(out, { recursive: true });
const data = await mkdtemp(`${out}/save-`);
const checks: Record<string, boolean> = {}, errors: string[] = [];
const check = (name: string, value: boolean) => { checks[name] = value; if (!value) throw new Error(name); };
let server: Awaited<ReturnType<typeof startLocalMultiplayer>> | undefined;
const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
const pages: Page[] = [];
/** True while the loading cover is still on screen. */
const loading = (page: Page) => page.locator("#boot-screen").count().then(count => count > 0);
/** Escape opens the game menu; Worlds is one step inside it. */
const openWorlds = async (page: Page) => {
  const panel = page.locator("#multiplayer-selector");
  if (await panel.isVisible().catch(() => false)) return;
  if (!(await page.getByRole("dialog", { name: "Corealm", exact: true }).isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
  }
  if (await panel.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "Worlds", exact: true }).click();
};
try {
  server = await startLocalMultiplayer("dev", ["--web-port", "0", "--world-port", "0", "--data", data]);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    localStorage.setItem("corealm.settings.v1", JSON.stringify({ renderScale: .7, shadowQuality: "low", drawDistance: "near", music: 0, ambient: 0, sfx: 0 }));
  });
  const page = await context.newPage(); pages.push(page); page.setDefaultTimeout(15_000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });

  await page.goto(server.url, { waitUntil: "domcontentloaded" });
  const panel = page.locator("#multiplayer-selector");
  const primary = page.locator(".worlds__actions .btn");
  const world = page.locator(".worlds__row--world input").first();
  await world.waitFor({ timeout: 60_000 });
  check("selectionDuringLoading", await loading(page) && await panel.isVisible());
  check("hostedWorldListed", await page.locator(".worlds__row--world strong").count() >= 1);
  check("guestNameDuringLoading", await page.getByRole("textbox", { name: "Development guest name" }).isVisible());
  // Local play leads the list and is the standing choice until the player picks a world.
  check("localPlayFirst", await page.locator(".worlds__row").first().evaluate(row => row.classList.contains("worlds__row--local")));
  check("localPlayChosenByDefault", await page.locator(".worlds__row--local input").isChecked()
    && (await primary.textContent())?.trim() === "Play local");
  check("oneAction", await primary.count() === 1);
  await page.screenshot({ path: `${out}/loading-selection.png`, timeout: 10_000 });

  // A world chosen while loading is joined the moment the game is ready, without a second click.
  await page.getByRole("textbox", { name: "Development guest name" }).fill("selector-guest");
  await world.check();
  const join = page.getByRole("button", { name: /^Join/ });
  check("joinWaitsForLoading", (await join.textContent())?.trim() === "Join when ready");
  await join.click();
  check("joinQueuedDuringLoading", await loading(page) && (await join.textContent())?.trim() === "Joining when ready");
  await page.waitForFunction(() => document.querySelector("#multiplayer-selector")?.getAttribute("data-phase") === "connected", null, { timeout: 120_000 });
  check("queuedJoinConnects", !await loading(page));
  await page.screenshot({ path: `${out}/connected.png`, timeout: 10_000 });

  // Adding the same host by address: it is remembered, and its worlds merge with the configured ones.
  // Joining closed the menu, so this starts where a player would: reopening Worlds from the game.
  await openWorlds(page);
  const worldsBefore = await page.locator(".worlds__row").count();
  await page.getByRole("textbox", { name: "Host address" }).fill(`127.0.0.1:${server.worldPort}`);
  await page.getByRole("button", { name: "Add host", exact: true }).click();
  await page.locator(".worlds__host-row").first().waitFor();
  check("hostListed", (await page.locator(".worlds__host-row span").first().textContent())?.trim() === `127.0.0.1:${server.worldPort}`);
  check("hostWorldsMerge", await page.locator(".worlds__row").count() === worldsBefore);
  check("hostStored", (await page.evaluate(() => localStorage.getItem("corealm.hosts.v1")))
    === JSON.stringify([`http://127.0.0.1:${server.worldPort}/worlds`]));
  await page.screenshot({ path: `${out}/added-host.png`, timeout: 10_000 });

  // With the launcher's own configuration blocked, the saved host alone has to carry world selection.
  await page.route("**/__corealm_local_multiplayer.js", route => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
  await page.goto(server.url, { waitUntil: "domcontentloaded" });
  check("configurationSuppressed", await page.evaluate(() => (window as unknown as { __COREALM_MULTIPLAYER__?: unknown }).__COREALM_MULTIPLAYER__ === undefined));
  await page.locator(".worlds__row--world input").first().waitFor({ timeout: 60_000 });
  check("addedHostSurvivesReload", await loading(page) && await panel.isVisible());
  check("addedHostListsWorlds", await page.locator(".worlds__row--world strong").count() >= 1);
  // The world joined above comes back ticked, with focus on it, so Enter repeats it. Remembering is
  // not joining: the session stays offline until the player commits again.
  check("lastChoiceRemembered", await page.locator(".worlds__row--world input:checked").count() === 1);
  check("lastChoiceHoldsFocus", await page.evaluate(() =>
    document.activeElement?.closest(".worlds__row")?.classList.contains("worlds__row--world") === true));
  check("lastChoiceDoesNotAutoJoin", await panel.getAttribute("data-phase") === "offline");
  await page.screenshot({ path: `${out}/saved-host-only.png`, timeout: 10_000 });

  // Choosing local play during loading puts the panel away, and joins the page's own world once the scene is up: local play is a world in a worker.
  checks.playLocalDuringLoading = await loading(page);
  await page.locator(".worlds__row--local input").check();
  await page.getByRole("button", { name: "Play local", exact: true }).click();
  check("playLocalPutsPanelAway", !await panel.isVisible());
  await page.locator("#boot-screen").waitFor({ state: "detached", timeout: 120_000 });
  await page.waitForFunction(() => document.querySelector("#multiplayer-selector")?.getAttribute("data-phase") === "connected", null, { timeout: 120_000 });
  check("playLocalJoinsTheLocalWorld", !await panel.isVisible() && await page.evaluate(() => {
    const seen = window.__corealmLocalWorker?.observe() as { running: boolean; world: { providerId: string }; simTicks: number } | undefined;
    return seen?.running === true && seen.world.providerId === "local" && seen.simTicks === 0;
  }));
  check("playLocalLeavesTheMenuClosed", !await page.getByRole("dialog", { name: "Corealm", exact: true }).isVisible());
  check("playLocalRemembered", await page.evaluate(() => localStorage.getItem("corealm.play.v1")) === "local");
  await page.screenshot({ path: `${out}/local-play.png`, timeout: 10_000 });

  // Removing the host puts the page back to single-player.
  await openWorlds(page);
  await page.getByRole("button", { name: /^Remove host/ }).click();
  await page.locator(".worlds__empty").waitFor();
  check("hostRemoved", await page.evaluate(() => localStorage.getItem("corealm.hosts.v1")) === "[]");

  check("noRuntimeErrors", errors.length === 0);
  check("withinBudget", Date.now() - started < budget);
  const report = { passed: true, checks, errors, durationMs: Date.now() - started };
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  for (let i = 0; i < pages.length; i++) await pages[i]!.screenshot({ path: `${out}/failure-${i}.png`, timeout: 5000 }).catch(() => {});
  await writeFile(`${out}/failure.json`, JSON.stringify({ error: String(error), checks, errors }, null, 2));
  throw error;
} finally { await browser.close(); await server?.close(); clearDeadline(); }
