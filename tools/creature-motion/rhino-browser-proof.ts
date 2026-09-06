/** Production boss contact evidence; run only in the root's hardware browser slot.
 * npx tsx tools/creature-motion/rhino-browser-proof.ts --url http://127.0.0.1:4175 --only=boss_rhino_air --out test-results/rhino-contact
 * Root must wire candidate combat timing separately. This driver never replaces animation clocks or combat code.
 */
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { installAssetCandidates } from "../lib/assetCandidates.js";
import { installTestDeadline } from "../lib/deadline.js";
import { argValue, repoRoot } from "../lib/paths.js";
import { CREATURE_MOTION_TIMING } from "../../game/src/content/creatureMotionTiming.js";
import { recordCandidateResponses } from './record-candidate-responses.js';

const presets: Record<string, string> = { boss_rhino_air: "tempest_roc", boss_rhino_earth: "rootheart", boss_rhino_water: "gravelmaw:ordrun" };
const args = process.argv.slice(2), url = argValue(args, "--url");
if (!url) throw new Error("Supply --url for an existing production server");
const selected = (argValue(args, "--only") ?? args.find(arg => arg.startsWith("--only="))?.slice(7) ?? Object.keys(presets).join(",")).split(",");
if (!selected.length || selected.some(id => !presets[id])) throw new Error("--only contains an unknown rhino asset");
const output = path.resolve(repoRoot, argValue(args, "--out") ?? "test-results/rhino-contact");
const catalogFile = path.resolve(repoRoot, argValue(args, "--catalog") ?? "art/rebuild/candidates/finish-motion/rhino-attack/catalog.json");
const candidateRoot = path.dirname(catalogFile);
const sourceCatalog = JSON.parse(await readFile(catalogFile, "utf8"));
const proposals = JSON.parse(await readFile(path.join(candidateRoot, "manifest-updates.json"), "utf8"));
const catalog = { assets: sourceCatalog.assets.filter((asset: any) => selected.includes(asset.id)),
  files: Object.fromEntries(selected.map(id => [id, path.resolve(candidateRoot, sourceCatalog.files[id])])) };
if (catalog.assets.length !== selected.length) throw new Error("Candidate catalog lacks selected rhinos");
for (const asset of catalog.assets) {
  const candidateFile = catalog.files[asset.id];
  if (!candidateFile) throw new Error(`Missing rhino candidate path ${asset.id}`);
  const bytes = await readFile(candidateFile);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const proposal = proposals.find((row: any) => row.id === asset.id);
  if (!proposal?.offlinePassed || digest !== asset.sha256 || digest !== proposal.sha256 || bytes.length !== asset.bytes) throw new Error(`Stale rhino candidate ${asset.id}`);
}
if (args.includes('--validate-only')) { console.log(JSON.stringify({ status: 'file-preflight-passed', selected, candidateMarker: proposals[0].setTiming.contactNormalized, gpuStarted: false })); process.exit(0); }
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "candidate-catalog.json"), JSON.stringify(catalog, null, 2));
const report: any = { status: "incomplete", visualAccepted: false, assets: [], errors: [],
  sourceMarker: 0.70, candidateMarker: proposals[0].setTiming.contactNormalized,
  limits: ["Health-change frames bracket observed impact, not the private scheduled combat timestamp.",
    "Attack ordinals are observed clip restarts; interrupting Hit clips can make them incomplete.",
    "A marker agreement is not physical target contact. Inspect side-view normal-speed video and screenshots for actual horn/head-to-player reach.",
    "Misses cause no health delta. No damage, death, pose, speed, or time is forced."] };
const clearDeadline = installTestDeadline("rhino production contact proof", 120_000);
const browser = await chromium.launch({ headless: !args.includes("--headed"), args: process.platform === "win32"
  ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"]
  : ["--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
  recordVideo: { dir: path.join(output, "video"), size: { width: 1440, height: 900 } } });
const page = await context.newPage();
const finishResponseAudit = await recordCandidateResponses(page, path.join(output, 'candidate-catalog.json'), selected);
await page.addInitScript('globalThis.__name = (value) => value;');
page.setDefaultTimeout(4_000);
page.on("pageerror", error => report.errors.push(error.message));
const timer = setTimeout(() => { report.errors.push("110 second evidence ceiling exhausted"); void page.close(); }, 110_000);
async function call(surface: "lab" | "debug", method: string, values: unknown[] = []): Promise<any> {
  return page.evaluate(async ({ surface, method, values }) => {
    const api = (window as any)[surface === "lab" ? "__featureLab" : "__gameDebug"];
    if (typeof api?.[method] !== "function") throw new Error(`Missing ${surface}.${method}`);
    const result = await api[method](...values);
    if (result?.ok === false || result?.isError === true || typeof result?.error === 'string') throw new Error(JSON.stringify(result));
    return result;
  }, { surface, method, values });
}
async function frame(entityId: string): Promise<any> {
  return page.evaluate(entityId => {
    const debug = (window as any).__gameDebug, state = (window as any).__featureLab.getState();
    return { wallMs: performance.now(), clock: debug.getState().clock, player: debug.getPlayer(),
      entity: debug.getEntity(entityId), drawnBounds: debug.getDrawnBounds(entityId),
      motion: debug.getEntityMotion(entityId), ai: state.target?.ai ?? null };
  }, entityId);
}
try {
  report.installedCandidates = await installAssetCandidates(page, path.join(output, "candidate-catalog.json"));
  const target = new URL(url); target.searchParams.set("mode", "combat"); target.searchParams.set("rhinoTiming", "1"); target.searchParams.delete("motion");
  report.fixtureTimingRequested = true;
  report.fixtureTimingNote = "rhinoTiming=1 requests the root-owned production fixture timing hook. The local content-table value is recorded separately; impact observations verify the behavior.";
  await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForFunction(() => (window as any).__featureLab?.getState()?.ready, undefined, { timeout: 20_000 });
  report.hardware = await page.evaluate(() => {
    const gl = document.querySelector("canvas")?.getContext("webgl2");
    if (!gl) throw new Error("No production WebGL2 canvas");
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER));
    if (/swiftshader|llvmpipe|software|microsoft basic/i.test(renderer)) throw new Error(`Hardware required: ${renderer}`);
    return { renderer, noSwiftShader: true };
  });
  await call("lab", "setLevel", ["melee", 1]);
  await call("lab", "equipPlayer", ["mainHand", null]);
  await call("lab", "setPlayerVisible", [true]);
  for (const id of selected) {
    const evidence: any = { id, preset: presets[id], candidateTiming: proposals.find((proposal: any) => proposal.id === id)?.setTiming,
      runtimeTimingSource: CREATURE_MOTION_TIMING[id], screenshots: [], visualAccepted: false };
    evidence.candidateTimingWiredInSource = Math.abs((evidence.runtimeTimingSource?.contactNormalized ?? -1)
      - (evidence.candidateTiming?.contactNormalized ?? -2)) < 0.000001;
    report.assets.push(evidence);
    try {
      await call("lab", "spawnTarget", ["creature", presets[id], { distance: 4 }]);
      const state = await call("lab", "getState"), entityId = state.target.entityId;
      evidence.before = await frame(entityId);
      const eventCursor = (await call("debug", "getEvents", [0])).nextSeq;
      await call("lab", "perform", ["attack"]);
      const untilAggro = performance.now() + 6_000;
      while (performance.now() < untilAggro) {
        if ((await frame(entityId)).ai?.state === "aggro") break;
        await page.waitForTimeout(60);
      }
      await call("debug", "callTool", ["corealm_stop", {}]);
      const pose = await frame(entityId), [x, y, z] = pose.entity.position, p = pose.player.position;
      const heading = Math.atan2(p.x - x, p.z - z);
      await call("debug", "inspectPose", [{ x: (x + p.x) / 2, y: y + 0.7, z: (z + p.z) / 2,
        yaw: heading + Math.PI / 2, pitch: 0.15, distance: 6, detached: true }]);
      // Observe every rendered frame, including frames while Playwright writes screenshots.
      await page.evaluate(entityId => {
        const win = window as any, debug = win.__gameDebug;
        const trace = win.__rhinoContactTrace = { running: true, samples: [] as any[], ordinal: 0, previous: null as any };
        function observe() {
          if (!trace.running) return;
          const motion = debug.getEntityMotion(entityId), player = debug.getPlayer();
          const previous = trace.previous;
          if (motion?.motion === "attack" && (previous?.motion?.motion !== "attack" || motion.time < previous.motion.time - 0.05)) trace.ordinal++;
          const sample = { wallMs: performance.now(), simMs: debug.getState().clock.elapsedMs, ordinal: trace.ordinal,
            motion, player, entity: structuredClone(debug.getEntity(entityId)) };
          trace.samples.push(sample); trace.previous = sample;
          requestAnimationFrame(observe);
        }
        requestAnimationFrame(observe);
      }, entityId);
      const captured = new Set<string>(), until = performance.now() + 12_000;
      while (performance.now() < until) {
        const current = await page.evaluate(() => (window as any).__rhinoContactTrace.samples.at(-1));
        if (current?.motion?.motion === "attack" && current.ordinal <= 2) {
          const phase = current.motion.time / current.motion.duration;
          for (const [name, marker] of [["anticipation", .20], ["candidate-contact", evidence.candidateTiming.contactNormalized], ["old-contact", .70], ["recovery", .90]] as const) {
            const key = `${current.ordinal}-${name}`;
            if (phase >= marker && !captured.has(key)) {
              captured.add(key);
              const file = `${id}-${key}.png`;
              await page.screenshot({ path: path.join(output, file), timeout: 4_000 });
              evidence.screenshots.push({ file, requestedPhase: marker, observedBeforeCapture: current, observedAfterCapture: await frame(entityId) });
              break;
            }
          }
        }
        await page.waitForTimeout(25);
      }
      evidence.samples = await page.evaluate(() => { const trace = (window as any).__rhinoContactTrace; trace.running = false; return trace.samples; });
      evidence.events = await call("debug", "getEvents", [eventCursor]);
      evidence.after = await frame(entityId);
      evidence.impacts = [];
      evidence.unattributedHealthDeltas = [];
      for (let i = 1; i < evidence.samples.length; i++) {
        const before = evidence.samples[i - 1], after = evidence.samples[i];
        if (after.player.health < before.player.health) {
          const impact = { damage: before.player.health - after.player.health, ordinal: after.ordinal, before, after,
            phaseBracket: [before.motion?.clip === 'Attack' ? before.motion.time / before.motion.duration : null,
              after.motion?.clip === 'Attack' ? after.motion.time / after.motion.duration : null] };
          const living = before.entity?.combat?.health > 0 && after.entity?.combat?.health > 0;
          const validAttack = (sample: any) => sample.motion?.clip === 'Attack' && sample.motion?.motion === 'attack'
            && Number.isFinite(sample.motion.time) && sample.motion.time >= 0 && Number.isFinite(sample.motion.duration)
            && sample.motion.duration > 0 && sample.motion.time <= sample.motion.duration + .000001;
          if (living && before.entity?.id === after.entity?.id && after.ordinal > 0 && before.ordinal === after.ordinal
            && validAttack(before) && validAttack(after) && after.motion.time >= before.motion.time) evidence.impacts.push(impact);
          else evidence.unattributedHealthDeltas.push(impact);
        }
      }
      evidence.status = evidence.impacts.length ? "impact-observed-awaiting-visual-review" : "incomplete-no-health-impact";
    } catch (error) { evidence.status = "failed"; evidence.error = String(error); }
    await writeFile(path.join(output, `${id}.json`), JSON.stringify(evidence, null, 2));
    console.log(`${id}: ${evidence.status}`);
  }
  report.status = !report.errors.length && report.assets.every((asset: any) => asset.status === "impact-observed-awaiting-visual-review")
    ? "impact-observed-awaiting-visual-review" : "incomplete";
} catch (error) { report.errors.push(String(error)); }
finally {
  clearTimeout(timer);
  report.servedByteEvidence = await finishResponseAudit();
  if (!report.servedByteEvidence.passed) { report.errors.push(...report.servedByteEvidence.errors); report.status = 'incomplete'; }
  await context.close(); await browser.close();
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  clearDeadline();
}
if (report.status === "incomplete") process.exitCode = 1;
