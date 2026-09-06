/** Focused production-lab actions. Run only in the root's scheduled GPU slot. */
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import { argValue } from "./lib/paths.js";
import { installTestDeadline } from "./lib/deadline.js";

const args = process.argv.slice(2);
const url = argValue(args, "--url") ?? "http://127.0.0.1:4175";
const out = path.resolve(argValue(args, "--out") ?? "test-results/traversal-contacts");
const cancellationOnly = argValue(args, "--case") === "cancel";
const climbOnly = argValue(args, "--case") === "climb";
const clearDeadline = installTestDeadline("Traversal contact browser gate", cancellationOnly || climbOnly ? 30000 : 60000);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
// tsx preserves nested function names with this helper when serialising evaluate callbacks.
await page.addInitScript("window.__name = (value) => value;");
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("requestfailed", (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
const report: Record<string, unknown>[] = [];
const assert = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const call = (page: Page, name: string, input: unknown) => page.evaluate(async ({ name, input }) => {
  const w = window as any;
  return w.__gameDebug.callTool(name, input);
}, { name, input });
const state = () => page.evaluate(() => (window as any).__agilityLab.getState());

async function setup(id: string, reverse = false): Promise<any> {
  await call(page, "corealm_stop", {});
  const lane = await page.evaluate(({ id, reverse }) => {
    const w = window as any;
    w.__agilityLab.prepare();
    if (id === "sunder_ledge") w.__agilityLab.setLevel(10);
    const lane = w.__agilityLab.getState().lanes.find((lane: any) => lane.id === id);
    if (!lane) throw new Error(`Missing fixture ${id}`);
    w.__gameDebug.teleport(reverse ? lane.exit : lane.entry);
    const centre = lane.entry.map((value: number, i: number) => (value + lane.exit[i]) / 2);
    w.__gameDebug.inspectPose({ x: centre[0], y: centre[1] + 0.6, z: centre[2],
      yaw: id === "contact_climb" ? -1.05 : 1.05, pitch: 0.3, distance: 7.5, detached: true });
    return lane;
  }, { id, reverse });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.evaluate(() => {
    const w = window as any;
    w.__traversalProof = { running: true, rows: [] };
    const sample = () => {
      if (!w.__traversalProof.running) return;
      const state = w.__agilityLab.getState();
      const curtain = document.querySelector(".traversal-transition");
      w.__traversalProof.rows.push({ at: performance.now(), state, motion: w.__gameDebug.getPlayerMotion(),
        opacity: curtain ? Number(getComputedStyle(curtain).opacity) : 0 });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  return lane;
}

async function finishRows(): Promise<any[]> {
  return page.evaluate(() => { const w = window as any; w.__traversalProof.running = false; return w.__traversalProof.rows; });
}

try {
  const fixtureUrl = new URL("/index.html?mode=combat&agility=1", url).href;
  await page.goto(fixtureUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (window as any).__gameDebug?.getState().ready && (window as any).__agilityLab,
    null, { timeout: 30000 });
  const gpu = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const gl = canvas?.getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_debug_renderer_info");
    if (!gl || !extension) throw new Error("Cannot verify the production WebGL renderer");
    return String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL));
  });
  assert(/RTX/i.test(gpu) && !/swiftshader|llvmpipe|software|Microsoft Basic Render/i.test(gpu), `Hardware RTX renderer required: ${gpu}`);
  report.push({ renderer: gpu });
  // Close optional workbenches through their real UI so screenshots show contact.
  for (const panel of await page.locator('button[aria-label="Close feature lab"]').all()) await panel.click();
  for (const kind of cancellationOnly ? [] : climbOnly ? ["climb"] : ["climb", "vault", "balance", "slide"]) {
    const id = `contact_${kind}`;
    const lane = await setup(id);
    const before = await state();
    const started = await call(page, "corealm_interact", { entityId: id, interaction: kind === "vault" ? "vault" : "climb" });
    assert(!started.error, `${id} refused: ${JSON.stringify(started)}`);
    await page.waitForFunction(() => (window as any).__agilityLab.getState().traversal?.progress >= 0.55,
      null, { timeout: 7000 });
    await page.screenshot({ path: path.join(out, `${id}-contact.png`) });
    await page.waitForFunction(() => !(window as any).__agilityLab.getState().activity, null, { timeout: 7000 });
    const after = await state();
    const rows = await finishRows();
    assert(after.agility.xp - before.agility.xp === 18, `${id} XP receipt was not 18`);
    assert(after.uses[id] === before.uses[id] + 1, `${id} use receipt missing`);
    assert(Math.hypot(...after.playerPosition.map((v: number, i: number) => v - lane.exit[i])) < 0.2, `${id} did not land`);
    assert(rows.some((row) => row.motion.pose === kind), `${id} dedicated pose did not render`);
    assert(rows.some((row) => row.state.traversal?.phase === "contact"), `${id} contact phase missing`);
    assert(rows.every((row) => row.opacity === 0), `${id} unexpectedly concealed`);
    const support = lane.contact;
    const rootContacts = rows.filter((row) => {
      const p = row.motion.drawnPosition;
      return Math.abs(p[0] - support.origin[0]) < support.width / 2
        && Math.abs(p[2] - support.origin[2]) < support.depth / 2 - 0.06;
    });
    assert(rootContacts.length >= 4, `${id} did not visibly cross the support bounds`);
    const residuals: number[] = [];
    if (kind !== "vault") for (const row of rootContacts) {
      const p = row.motion.drawnPosition;
      const top = support.origin[1] + (kind === "slide"
        ? support.rise * (0.5 - (p[2] - support.origin[2]) / support.depth) + 0.025 : support.rise);
      assert(Math.abs(p[1] - top) < 0.045, `${id} root missed support top by ${p[1] - top}m`);
      const feet = [row.motion.feet.left.ball, row.motion.feet.right.ball].filter((foot) =>
        Math.abs(foot[0] - support.origin[0]) <= support.width / 2 + 0.03
        && Math.abs(foot[2] - support.origin[2]) <= support.depth / 2);
      if (!feet.length) continue;
      const clearances = feet.map((foot) => foot[1] - support.origin[1] - (kind === "slide"
        ? support.rise * (0.5 - (foot[2] - support.origin[2]) / support.depth) + 0.025 : support.rise));
      assert(Math.min(...clearances) > -0.065, `${id} planted foot penetrates support`);
      residuals.push(Math.min(...clearances.map(Math.abs)));
    }
    if (kind !== "vault") assert(residuals.filter((gap) => gap < 0.085).length >= 4,
      `${id} never established a measured foot contact`);
    report.push({ id, before, after, contactResiduals: residuals, rows, screenshot: `${id}-contact.png` });
  }

  for (const reverse of cancellationOnly || climbOnly ? [] : [false, true]) {
    const id = "sunder_ledge";
    const lane = await setup(id, reverse);
    const before = await state();
    const destination = `feature-lab:agility:${id}:${reverse ? "entry" : "exit"}`;
    const started = await call(page, "corealm_move_to", { locationId: destination });
    assert(!started.error, `Routed Sunder refused: ${JSON.stringify(started)}`);
    await page.waitForFunction(() => {
      const curtain = document.querySelector(".traversal-transition");
      return curtain && Number(getComputedStyle(curtain).opacity) === 1;
    },
      null, { timeout: 7000 });
    await page.screenshot({ path: path.join(out, `sunder-${reverse ? "reverse" : "forward"}-concealed.png`) });
    await page.waitForFunction(() => !(window as any).__agilityLab.getState().activity
      && (window as any).__agilityLab.getState().movement.mode === "idle", null, { timeout: 9000 });
    const after = await state();
    const rows = await finishRows();
    const target = reverse ? lane.entry : lane.exit;
    assert(Math.hypot(...after.playerPosition.map((v: number, i: number) => v - target[i])) < 0.3, "Sunder route did not land");
    assert(after.uses[id] === before.uses[id] + 1, "Sunder use receipt missing");
    const jump = rows.find((row, i) => i > 0 && Math.hypot(...row.state.playerPosition.map((v: number, j: number) => v - rows[i - 1].state.playerPosition[j])) > 3);
    assert(jump && jump.opacity >= 0.999, "Sunder placement was not covered by actual opaque curtain");
    report.push({ id, reverse, before, after, rows });
  }

  await setup("contact_climb");
  const beforeCancel = await state();
  await call(page, "corealm_interact", { entityId: "contact_climb", interaction: "climb" });
  await page.waitForFunction(() => (window as any).__agilityLab.getState().traversal?.progress > 0.45);
  await call(page, "corealm_stop", {});
  await page.waitForFunction(() => !document.querySelector(".traversal-transition"), null, { timeout: 3000 });
  const afterCancel = await state();
  const cancelRows = await finishRows();
  report.push({ id: "cancel", before: beforeCancel, after: afterCancel, rows: cancelRows });
  assert(afterCancel.miscState === beforeCancel.miscState && afterCancel.agility.xp === beforeCancel.agility.xp,
    "Cancellation consumed RNG or XP");
  assert(JSON.stringify(afterCancel.playerPosition) === JSON.stringify(beforeCancel.playerPosition), "Cancellation moved semantic player");
  await page.screenshot({ path: path.join(out, "contact-climb-cancelled.png") });
  const recoveryRelease = cancelRows.find((row, i) => i > 0 && !row.state.activity
    && row.motion.pose !== "climb" && cancelRows[i - 1].motion.pose === "climb");
  assert(recoveryRelease, "Cancellation fixture did not record held-pose release");
  assert(recoveryRelease.opacity >= 0.999, "Cancellation released the held pose without opaque coverage");
  await setup("contact_climb");
  const beforeInvalid = await state();
  await page.evaluate(() => (window as any).__agilityLab.setLandingAvailable("contact_climb", false));
  const rejected = await call(page, "corealm_interact", { entityId: "contact_climb", interaction: "climb" });
  const afterInvalid = await state();
  assert(rejected.error === "INVALID_ARGUMENT", `Invalid landing was not rejected: ${JSON.stringify(rejected)}`);
  assert(afterInvalid.miscState === beforeInvalid.miscState && afterInvalid.agility.xp === beforeInvalid.agility.xp,
    "Invalid landing consumed RNG or awarded XP");
  assert(!afterInvalid.activity, "Invalid landing left an activity running");
  await page.evaluate(() => (window as any).__agilityLab.setLandingAvailable("contact_climb", true));
  report.push({ id: "invalid-landing", before: beforeInvalid, after: afterInvalid, rejected });
  await finishRows();
  assert(errors.length === 0, errors.join("\n"));
  await writeFile(path.join(out, "report.json"), JSON.stringify({ behavioralPassed: true, visualReviewRequired: true, report, errors }, null, 2));
  process.stdout.write(`Traversal checks passed; inspect screenshots in ${out}\n`);
} catch (error) {
  await writeFile(path.join(out, "report.json"), JSON.stringify({ behavioralPassed: false, report, errors, failure: String(error) }, null, 2));
  throw error;
} finally {
  await browser.close();
  clearDeadline();
}
