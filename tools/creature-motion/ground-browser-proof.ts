/** Candidate-only production AI evidence. Run only in the integrator's browser/GPU slot.
 * npx tsx tools/creature-motion/ground-browser-proof.ts --url http://127.0.0.1:4175 --out test-results/ground-motion
 * --only=animal_frog,animal_scorpion restricts the bounded loop. No time skips or pose overrides.
 */
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { argValue, repoRoot } from "../lib/paths.js";
import { installTestDeadline } from "../lib/deadline.js";
import { REGIONS } from "../../game/src/content/regions.js";

const roster = [
  { id: "animal_frog", preset: "redsill_frogs", directory: "ground-creature-gaits" },
  { id: "animal_frog_green", preset: "blackwater_frogs", directory: "ground-creature-gaits" },
  { id: "animal_crab", preset: "gravelmaw:gravelmaw_ch2_crabs", directory: "ground-creature-gaits" },
  { id: "animal_scorpion", preset: "gravelmaw:gravelmaw_ch2_scorpions", directory: "scorpion-ground-gait" },
];
type Sample = {
  elapsedMs: number; stage: string;
  state: any; motion: any; entity: any;
};
const args = process.argv.slice(2);
const url = argValue(args, "--url");
if (!url) throw new Error("--url must name an existing production lab server; this script does not start one");
const selected = (argValue(args, "--only") ?? args.find(arg => arg.startsWith("--only="))?.slice(7)
  ?? roster.map(row => row.id).join(",")).split(",");
if (!selected.length || selected.some(id => !roster.some(row => row.id === id))) throw new Error("Unknown --only asset");
const output = path.resolve(repoRoot, argValue(args, "--out") ?? "test-results/ground-motion");
const clearDeadline = installTestDeadline("ground creature browser proof", 120_000);
const started = performance.now();
const report: any = { status: "incomplete", visualAccepted: false, assets: [], errors: [], limits: [
  "Semantic motion checks and video are evidence for human review; they do not establish sole planting or visual acceptance.",
  "Only naturally observed motions count. An absent walk, run, turn, or transition fails its coverage check.",
  "No death, directional recoil, attack contact, residency crossing, or world terrain acceptance is claimed.",
] };
await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(repoRoot, "game/public/assets/manifest.json"), "utf8"));
const candidates = new Map<string, Buffer>();
for (const row of roster.filter(row => selected.includes(row.id))) {
  const directory = path.join(repoRoot, "art/rebuild/candidates/finish-motion", row.directory);
  const updates = JSON.parse(await readFile(path.join(directory, "manifest-updates.json"), "utf8"));
  const update = updates.find((item: any) => item.id === row.id);
  const entry = manifest.assets.find((item: any) => item.id === row.id);
  if (!update?.offlinePassed || !entry) throw new Error(`Missing offline-passed candidate: ${row.id}`);
  const bytes = await readFile(path.join(directory, `${row.id}.glb`));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== update.sha256.toLowerCase() || bytes.length !== update.bytes) throw new Error(`Stale candidate metadata: ${row.id}`);
  if (entry.sha256.toLowerCase() !== update.sourceSha256.toLowerCase()) throw new Error(`Production base changed: ${row.id}`);
  candidates.set(`/assets/${entry.file}`, bytes);
  Object.assign(entry, update.set, { sha256, bytes: bytes.length });
}
const browser = await chromium.launch({ headless: !args.includes("--headed"), args: process.platform === "win32"
  ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"]
  : ["--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
  recordVideo: { dir: path.join(output, "video"), size: { width: 1280, height: 800 } } });
const served = new Set<string>();
await context.route("**/assets/**", async route => {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname.endsWith("/assets/manifest.json")) {
    await route.fulfill({ json: manifest });
  } else if (candidates.has(pathname)) {
    served.add(pathname);
    await route.fulfill({ body: candidates.get(pathname)!, contentType: "model/gltf-binary" });
  } else await route.continue();
});
const page = await context.newPage();
page.setDefaultTimeout(4_000);
page.on("pageerror", error => report.errors.push(error.message));
const timer = setTimeout(() => { report.errors.push("110 second evidence budget exhausted"); void page.close(); }, 110_000);

async function call(surface: "lab" | "debug", method: string, values: unknown[] = []): Promise<any> {
  return page.evaluate(async ({ surface, method, values }) => {
    const api = (window as any)[surface === "lab" ? "__featureLab" : "__gameDebug"];
    if (typeof api?.[method] !== "function") throw new Error(`Missing ${surface}.${method}`);
    const result = await api[method](...values);
    if (result?.ok === false || result?.isError === true) throw new Error(JSON.stringify(result));
    return result;
  }, { surface, method, values });
}
async function snapshot(entityId: string, stage: string): Promise<Sample> {
  return page.evaluate(({ entityId, stage }) => {
    const state = (window as any).__featureLab.getState();
    const debug = (window as any).__gameDebug;
    return { elapsedMs: performance.now(), stage, state,
      motion: debug.getEntityMotion(entityId), entity: debug.getEntity(entityId) };
  }, { entityId, stage });
}
async function sampleFor(entityId: string, samples: Sample[], stage: string, ms: number): Promise<void> {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    samples.push(await snapshot(entityId, stage));
    await page.waitForTimeout(100);
  }
}
async function capture(id: string, entityId: string, stage: string): Promise<void> {
  const wasVisible = (await call("lab", "getState")).playerVisible;
  const entity = await call("debug", "getEntity", [entityId]);
  await call("lab", "setPlayerVisible", [false]);
  try {
    if (entity) {
      const [x, y, z] = entity.position;
      await call("debug", "inspectPose", [{ x, y: y + 0.1, z, yaw: 1.2, pitch: 0.35, distance: 4, detached: true }]);
    }
    await page.waitForTimeout(80);
    await page.screenshot({ path: path.join(output, `${id}-${stage}.png`), timeout: 4_000 });
  } finally {
    await call("lab", "setPlayerVisible", [wasVisible ?? true]);
  }
}
function summarize(samples: Sample[]): Record<string, unknown> {
  let translated = 0, turn = 0, transitions = 0;
  const advancing = new Set<string>();
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!, b = samples[i]!;
    // No displacement inferred across camera captures or another actor's acceptance interval.
    if (b.elapsedMs - a.elapsedMs > 600) continue;
    const pa = a.entity?.position, pb = b.entity?.position;
    if (!pa || !pb) continue;
    const distance = Math.hypot(pb[0] - pa[0], pb[2] - pa[2]);
    translated += distance;
    if (a.motion && b.motion) {
      turn += Math.abs(Math.atan2(Math.sin(b.motion.semanticRotationY - a.motion.semanticRotationY), Math.cos(b.motion.semanticRotationY - a.motion.semanticRotationY)));
      if (a.motion.clip !== b.motion.clip) transitions++;
      if (distance > 0.0001 && b.motion.clip === a.motion.clip && Math.abs(b.motion.time - a.motion.time) > 0.001) advancing.add(b.motion.motion);
    }
  }
  return { translatedMetres: translated, turnRadians: turn, transitions,
    advancingWhileTranslating: [...advancing],
    checks: { translation: translated > 0.1, walk: advancing.has("walk"), run: advancing.has("run"), turn: turn > 0.15, transition: transitions > 0 } };
}
try {
  const target = new URL(url);
  target.searchParams.set("mode", "combat");
  target.searchParams.set("motion", "1");
  await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForFunction(() => (window as any).__featureLab?.getState()?.ready, undefined, { timeout: 20_000 });
  report.hardware = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2');
    if (!gl) throw new Error('Production canvas has no WebGL2 context');
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER));
    if (/swiftshader|llvmpipe|software|microsoft basic/i.test(renderer)) throw new Error(`Hardware rendering required: ${renderer}`);
    return { renderer, noSwiftShader: true };
  });
  await call("lab", "setWalkingEnabled", [true]);
  await call("lab", "setLevel", ["melee", 1]);
  await call("lab", "equipPlayer", ["mainHand", null]);
  const fixture = await page.evaluate(() => (window as any).__groundMotionLab);
  if (!fixture?.actors?.length || !fixture.habitats?.length) throw new Error("Missing production __groundMotionLab actors/habitats; root must wire ?motion=1");
  report.fixture = fixture;
  report.initialDebugState = await call("debug", "getState");
  report.aiRuntimeAvailability = "getState exposes readiness, clock, player and nav status; private AI wander targets/timers are not exposed. Direct entity state and renderer motion are sampled.";
  report.habitatDiagnostics = [];
  for (const habitat of fixture.habitats) {
    const actor = fixture.actors.find((actor: any) => actor.entityId === habitat.id);
    const entity = actor ? await call("debug", "getEntity", [actor.entityId]) : null;
    const y = entity?.position?.[1] ?? fixture.spawn[1];
    const bounds = REGIONS.find(region => region.id === habitat.regionId)?.bounds ?? null;
    const points = habitat.anchors.map(([x, z]: number[]) => [x, y, z]);
    const anchors = [];
    for (const point of points) {
      const snapped = await call("debug", "getNavPoint", [point]);
      anchors.push({ intended: point, nearestNavPoint: snapped,
        navDisplacementXZ: snapped ? Math.hypot(snapped.x - point[0], snapped.z - point[2]) : null,
        insideDeclaredRegion: bounds !== null && point[0] >= bounds.min[0] && point[0] <= bounds.max[0]
          && point[2] >= bounds.min[1] && point[2] <= bounds.max[1] });
    }
    const legs = [];
    for (let i = 0; i < points.length; i++) {
      const from = points[i], to = points[(i + 1) % points.length];
      legs.push({ from, to, path: await call("debug", "getNavPath", [from, to]) });
    }
    report.habitatDiagnostics.push({ id: habitat.id, declaredRegion: habitat.regionId, regionBounds: bounds, anchors, legs,
      note: "Public nav coordinates are rounded. Production habitat snapping separately requires <=0.1m error and region containment." });
  }
  for (const row of roster.filter(row => selected.includes(row.id))) {
    const actor = fixture.actors.find((actor: any) => actor.assetId === row.id);
    if (!actor) throw new Error(`Fixture lacks ${row.id}`);
    const evidence: any = { id: row.id, entityId: actor.entityId, preset: actor.presetId, samples: [], visualAccepted: false };
    evidence.before = await snapshot(actor.entityId, "setup");
    if (evidence.before.entity?.view?.assetId !== row.id) throw new Error(`Fixture actor asset mismatch: ${row.id}`);
    report.assets.push(evidence);
  }
  // All four actors patrol concurrently for this shared interval. Neither AI clocks nor actors are reset.
  const patrolUntil = performance.now() + 16_000;
  while (performance.now() < patrolUntil) {
    for (const evidence of report.assets) evidence.samples.push(await snapshot(evidence.entityId, "natural-patrol"));
    await page.waitForTimeout(100);
  }
  for (const evidence of report.assets) await capture(evidence.id, evidence.entityId, "patrol");
  for (const evidence of report.assets) {
    const entityId = evidence.entityId;
    try {
      const habitat = fixture.habitats.find((habitat: any) => habitat.id === entityId || habitat.groupId === entityId);
      if (!habitat || habitat.radius < 4) throw new Error(`Missing usable patrol habitat: ${entityId}`);
      const [cx, cz] = habitat.centre;
      // The attack command auto-walks through production navigation. Wait for actual proximity;
      // do not count the gap between the shared patrol and this observation as travel evidence.
      await call("debug", "callTool", ["corealm_attack", { entityId }]);
      const approachUntil = performance.now() + 10_000;
      let close = false;
      while (performance.now() < approachUntil) {
        const sample = await snapshot(entityId, "approach");
        evidence.samples.push(sample);
        const p = sample.state.playerPosition, e = sample.entity?.position;
        if (e && Math.hypot(p[0] - e[0], p[2] - e[2]) < 2) { close = true; break; }
        await page.waitForTimeout(100);
      }
      if (!close) throw new Error("Production auto-walk did not approach actor within 10 seconds");
      await sampleFor(entityId, evidence.samples, "provocation", 1_500);
      const groundY = (await snapshot(entityId, "bend-setup")).state.playerPosition[1];
      // Both endpoints and the straight segment stay within the authored five-metre habitat.
      await call("debug", "callTool", ["corealm_move_to", { position: [cx - 2.6, groundY, cz + 2.6] }]);
      await sampleFor(entityId, evidence.samples, "pursuit", 2_500);
      await capture(evidence.id, entityId, "pursuit");
      await call("debug", "callTool", ["corealm_move_to", { position: [cx + 2.6, groundY, cz + 2.6] }]);
      await sampleFor(entityId, evidence.samples, "turn-recovery", 2_500);
      await capture(evidence.id, entityId, "turn");
      await call("debug", "callTool", ["corealm_stop", {}]);
      evidence.after = await snapshot(entityId, "after");
      evidence.summary = summarize(evidence.samples);
      evidence.status = Object.values(evidence.summary.checks).every(Boolean) ? "semantic-coverage-passed" : "coverage-incomplete";
    } catch (error) {
      evidence.status = "failed";
      evidence.error = String(error);
    }
    await writeFile(path.join(output, `${evidence.id}.json`), JSON.stringify(evidence, null, 2));
    console.log(`${evidence.id}: ${evidence.status}`);
  }
  report.status = report.assets.every((asset: any) => asset.status === "semantic-coverage-passed") && !report.errors.length
    ? "semantic-coverage-passed-awaiting-visual-review" : "incomplete";
} catch (error) { report.errors.push(String(error)); }
finally {
  clearTimeout(timer);
  report.elapsedMs = Math.round(performance.now() - started);
  report.servedCandidates = [...served];
  if (served.size !== candidates.size) { report.errors.push("Not all selected staged GLBs were requested"); report.status = "incomplete"; }
  await context.close();
  await browser.close();
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  clearDeadline();
}
if (report.status === "incomplete") process.exitCode = 1;
