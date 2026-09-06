/** Legacy candidate production AI evidence. Run only in the root's browser/GPU slot.
 * npx tsx tools/creature-motion/legacy-browser-proof.ts --url http://127.0.0.1:4175 --only=animal_coyote,animal_bear,animal_cattle,animal_aurochs
 * Defaults to three actors, at most four per 120-second run. --validate-only never launches Chromium.
 */
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { chromium } from "playwright";
import { argValue, repoRoot } from "../lib/paths.js";
import { installTestDeadline } from "../lib/deadline.js";
import { REGIONS } from "../../game/src/content/regions.js";
import { MAX_PURSUE_METRES, meleeReachMetres, enemyStandoffMetres } from "../../game/src/systems/combat.js";

const roster = [
  { id: "animal_coyote" }, { id: "animal_bear" }, { id: "animal_cattle" },
  { id: "animal_aurochs" }, { id: "animal_goat" }, { id: "animal_ibex" }, { id: "animal_deer" },
  { id: "animal_boar" }, { id: "animal_hog" },
  { id: "animal_rat" }, { id: "animal_rabbit" }, { id: "animal_rabbit_dark" },
];
type Sample = {
  elapsedMs: number; stage: string;
  state: any; motion: any; entity: any;
};
const args = process.argv.slice(2);
const url = argValue(args, "--url");
if (!url && !args.includes("--validate-only")) throw new Error("--url must name an existing production lab server; this script does not start one");
const selected = (argValue(args, "--only") ?? args.find(arg => arg.startsWith("--only="))?.slice(7)
  ?? roster.slice(0, 3).map(row => row.id).join(",")).split(",");
if (!selected.length || selected.length > 4 || new Set(selected).size !== selected.length || selected.some(id => !roster.some(row => row.id === id))) throw new Error("--only requires one to four distinct legacy asset IDs; split larger rosters into separate runs");
const output = path.resolve(repoRoot, argValue(args, "--out") ?? "test-results/legacy-motion");
const clearDeadline = installTestDeadline("legacy creature browser proof", 120_000);
const started = performance.now();
const report: any = { status: "incomplete", visualAccepted: false, assets: [], errors: [], commands: [], limits: [
  "Semantic motion checks and video are evidence for human review; they do not establish sole planting or visual acceptance.",
  "Only naturally observed motions count. An absent walk, run, turn, or transition fails its coverage check.",
  "No death, directional recoil, attack contact, residency crossing, or world terrain acceptance is claimed.",
] };
await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(repoRoot, "game/public/assets/manifest.json"), "utf8"));
const catalogPath = path.join(repoRoot, "art/rebuild/candidates/finish-motion/legacy-catalog.json");
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const candidates = new Map<string, Buffer>();
for (const row of roster.filter(row => selected.includes(row.id))) {
  const candidate = catalog.assets.find((item: any) => item.id === row.id);
  const entry = manifest.assets.find((item: any) => item.id === row.id);
  if (catalog.offlinePassed !== true || !candidate || !entry) throw new Error(`Missing offline-passed candidate: ${row.id}; rebuild legacy-catalog.json`);
  const bytes = await readFile(path.resolve(path.dirname(catalogPath), catalog.files[row.id]));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== candidate.sha256.toLowerCase() || bytes.length !== candidate.bytes) throw new Error(`Stale candidate metadata: ${row.id}`);
  const publicBytes = await readFile(path.join(repoRoot, "game/public/assets", entry.file));
  const publicSha = createHash("sha256").update(publicBytes).digest("hex");
  if (publicSha !== entry.sha256.toLowerCase() || (publicSha !== catalog.sourceHashes[row.id] && publicSha !== sha256)) throw new Error(`Production base changed: ${row.id}`);
  for (const field of ["file", "pack", "impliedWalkMps", "impliedRunMps", "walkClipSeconds", "runClipSeconds"]) if (candidate[field] !== entry[field]) throw new Error(`Candidate changed production ${row.id}.${field}`);
  candidates.set(`/assets/${entry.file}`, bytes);
  Object.assign(entry, { sha256, bytes: bytes.length });
}
if (args.includes("--validate-only")) { clearDeadline(); console.log(JSON.stringify({ status: "file-preflight-passed", selected, gpuStarted: false })); process.exit(0); }
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
  const result = await page.evaluate(async ({ surface, method, values }) => {
    const api = (window as any)[surface === "lab" ? "__featureLab" : "__gameDebug"];
    if (typeof api?.[method] !== "function") throw new Error(`Missing ${surface}.${method}`);
    return await api[method](...values);
  }, { surface, method, values });
  if (method === "callTool") report.commands.push({ elapsedMs: Math.round(performance.now() - started), surface, method, values, result });
  if (result?.ok === false || result?.isError === true || typeof result?.error === "string") throw new Error(JSON.stringify(result));
  return result;
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
    const evidence = report.assets.find((row: any) => row.entityId === entityId);
    if (samples !== evidence.samples) throw new Error("Motion capture samples must belong to the selected actor");
    await recordMotionSample(evidence, stage);
    await page.waitForTimeout(100);
  }
}
type RequestedFrame = "walk" | "run" | "turn";
async function capture(id: string, entityId: string, stage: string, requested?: RequestedFrame): Promise<boolean> {
  const wasVisible = (await call("lab", "getState")).playerVisible;
  const before = await snapshot(entityId, `${stage}-capture-before`);
  const assertLive = (sample: Sample, requireRig = true) => {
    if (sample.entity?.view?.assetId !== id || !(sample.entity?.combat?.health > 0) || ["dead", "corpse", "depleted"].includes(sample.entity?.state) || (requireRig && !sample.motion?.liveRig) || /death/i.test(sample.motion?.clip ?? "")) throw new Error(`Capture requires living rendered ${id}: ${sample.entity?.state}/${sample.motion?.clip}`);
  };
  assertLive(before, false);
  const bounds = await call("debug", "getDrawnBounds", [entityId]);
  if (!(bounds?.meshes > 0)) throw new Error(`Capture lacks drawn bounds for ${id}`);
  await call("lab", "setPlayerVisible", [false]);
  const style = await page.addStyleTag({ content: "#panel-feature-lab { visibility: hidden !important; }" });
  try {
    const x = (bounds.min.x + bounds.max.x) / 2, y = (bounds.min.y + bounds.max.y) / 2, z = (bounds.min.z + bounds.max.z) / 2;
    await call("debug", "inspectPose", [{ x, y, z, yaw: 1.2, pitch: 0.35, distance: Math.max(2.4, bounds.width * 1.6, bounds.height * 2.2), detached: true }]);
    await page.waitForFunction(entityId => (window as any).__gameDebug.getEntityMotion(entityId)?.liveRig === true, entityId, { timeout: 2_000 });
    const ready = await snapshot(entityId, `${stage}-capture-ready`); assertLive(ready);
    const capturedBounds = await call("debug", "getDrawnBounds", [entityId]);
    if (!(capturedBounds?.meshes > 0) || !String(capturedBounds.path).startsWith("animated:")) throw new Error(`Capture lacks drawn animated bounds for ${id}`);
    if (requested) await page.waitForTimeout(110);
    const filename = `${id}-${stage}.png`;
    const screenBefore = await snapshot(entityId, `${stage}-screenshot-before`); assertLive(screenBefore);
    await page.screenshot({ path: path.join(output, filename), timeout: 4_000 });
    const after = await snapshot(entityId, `${stage}-capture-after`); assertLive(after);
    const evidence = report.assets.find((row: any) => row.id === id);
    const moved = Math.hypot(after.entity.position[0] - screenBefore.entity.position[0], after.entity.position[2] - screenBefore.entity.position[2]);
    const turned = Math.abs(Math.atan2(Math.sin(after.motion.semanticRotationY - screenBefore.motion.semanticRotationY), Math.cos(after.motion.semanticRotationY - screenBefore.motion.semanticRotationY)));
    const advancing = screenBefore.motion.clip === after.motion.clip && Math.abs(after.motion.time - screenBefore.motion.time) > .001;
    const matches = !requested || (moved > .0001 && advancing && (requested === "turn"
      ? turned > .01 && ["Walk", "Run"].includes(screenBefore.motion.clip)
      : screenBefore.motion.motion === requested && after.motion.motion === requested && screenBefore.motion.clip === (requested === "walk" ? "Walk" : "Run")));
    const receipt = { stage, requested: requested ?? null, accepted: matches, file: filename, framedBounds: bounds, capturedBounds, framingBefore: before, framingReady: ready, before: screenBefore, after, translatedMetres: moved, turnRadians: turned };
    (evidence.captures ??= []).push(receipt);
    if (requested && matches) {
      const acceptedFile = `${id}-${requested}.png`;
      await rename(path.join(output, filename), path.join(output, acceptedFile)); receipt.file = acceptedFile;
      evidence.observedFrames[requested] = receipt;
    }
    return matches;
  } finally {
    await style.evaluate(element => element.parentNode?.removeChild(element));
    await call("lab", "setPlayerVisible", [wasVisible ?? true]);
  }
}
async function recordMotionSample(evidence: any, stage: string): Promise<void> {
  const previous = evidence.samples.at(-1), current = await snapshot(evidence.entityId, stage);
  evidence.samples.push(current);
  if (!previous || current.elapsedMs - previous.elapsedMs > 600 || previous.motion?.clip !== current.motion?.clip) return;
  const a = previous.entity?.position, b = current.entity?.position;
  if (!a || !b || Math.hypot(b[0] - a[0], b[2] - a[2]) <= .0001) return;
  const gait = current.motion?.motion;
  let requested: RequestedFrame | null = (gait === "walk" || (gait === "run" && evidence.requiresRun)) && !evidence.observedFrames[gait] ? gait : null;
  const turn = Math.abs(Math.atan2(Math.sin(current.motion.semanticRotationY - previous.motion.semanticRotationY), Math.cos(current.motion.semanticRotationY - previous.motion.semanticRotationY)));
  if (!requested && stage === "turn-recovery" && !evidence.observedFrames.turn && turn > .01) requested = "turn";
  if (!requested || (evidence.frameAttempts[requested] ?? 0) >= 5) return;
  if (performance.now() - (evidence.lastFrameAttemptMs ?? 0) < 500) return;
  evidence.lastFrameAttemptMs = performance.now();
  evidence.frameAttempts[requested] = (evidence.frameAttempts[requested] ?? 0) + 1;
  await capture(evidence.id, evidence.entityId, `observed-${requested}-attempt-${evidence.frameAttempts[requested]}`, requested);
}
/** Travel is setup, never pursuit evidence. Commands use ordinary player navigation. */
async function preposition(evidence: any): Promise<void> {
  const entityId = evidence.entityId, setupStarted = performance.now(), setupUntil = setupStarted + 20_000;
  evidence.setup = { budgetMs: 20_000, samples: [], routes: [], ready: false };
  await call("debug", "callTool", ["corealm_stop", {}]);
  for (let attempt = 0; attempt < 3 && performance.now() < setupUntil; attempt++) {
    const initial = await snapshot(entityId, "preposition"), p = initial.state.playerPosition, entity = initial.entity;
    evidence.setup.samples.push(initial);
    if (!entity?.position || !(entity.combat?.health > 0)) throw new Error("Setup target is no longer alive");
    const e = entity.position, radius = enemyStandoffMetres(entity.combat.bodyRadius ?? 0);
    const gap = Math.hypot(p[0] - e[0], p[2] - e[2]);
    // Production navigation stops within its arrival tolerance. The test still starts well inside melee reach.
    if (initial.state.movement.mode === "idle" && gap <= radius + .25 && gap > (entity.combat.bodyRadius ?? 0)) {
      evidence.setup.ready = true; evidence.setup.after = initial; evidence.setup.elapsedMs = performance.now() - setupStarted; return;
    }
    const baseAngle = Math.atan2(p[2] - e[2], p[0] - e[0]);
    let route: any = null;
    for (const offset of [0, .5, -.5, 1, -1, Math.PI]) {
      const point = [e[0] + radius * Math.cos(baseAngle + offset), p[1], e[2] + radius * Math.sin(baseAngle + offset)];
      const snapped = await call("debug", "getNavPoint", [point]);
      if (!snapped || Math.hypot(snapped.x - point[0], snapped.z - point[2]) > .1008) continue;
      const destination = [snapped.x, snapped.y, snapped.z], path = await call("debug", "getNavPath", [p, destination]);
      if (!Array.isArray(path) || path.length < 2) continue;
      route = { intended: point, destination, path, sourceStandoff: radius }; break;
    }
    if (!route) throw new Error("No clear reachable production standoff point for setup");
    evidence.setup.routes.push(route);
    const cursor = (await call("debug", "getEvents", [0])).nextSeq;
    await call("debug", "callTool", ["corealm_move_to", { position: route.destination }]);
    let completed = false;
    while (performance.now() < setupUntil) {
      const sample = await snapshot(entityId, "preposition-travel"); evidence.setup.samples.push(sample);
      const events = await call("debug", "getEvents", [cursor]); route.events = events;
      const began = events.events.find((event: any) => event.type === "navigation.started");
      const finished = began && events.events.find((event: any) => event.type === "navigation.completed" && event.seq > began.seq);
      const failed = began && events.events.find((event: any) => event.type === "navigation.failed" && event.seq > began.seq);
      if (failed) throw new Error(`Setup navigation failed: ${JSON.stringify(failed)}`);
      if (finished && sample.state.movement.mode === "idle") { route.completed = finished; completed = true; break; }
      await page.waitForTimeout(100);
    }
    if (!completed) throw new Error("Setup navigation did not complete within its separate 20-second bound");
    const arrived = await snapshot(entityId, "preposition-arrived"), a = arrived.entity;
    evidence.setup.samples.push(arrived);
    if (!(a?.combat?.health > 0)) throw new Error("Setup target is no longer alive");
    const arrivedGap = Math.hypot(arrived.state.playerPosition[0] - a.position[0], arrived.state.playerPosition[2] - a.position[2]);
    if (arrived.state.movement.mode === "idle" && arrivedGap <= enemyStandoffMetres(a.combat.bodyRadius ?? 0) + .25 && arrivedGap > (a.combat.bodyRadius ?? 0)) {
      evidence.setup.ready = true; evidence.setup.after = arrived; evidence.setup.elapsedMs = performance.now() - setupStarted; return;
    }
  }
  throw new Error("Setup did not reach a clear body-aware standoff after completed navigation");
}
function summarize(samples: Sample[], requiresRun: boolean): Record<string, unknown> {
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
      if (distance > 0.0001) turn += Math.abs(Math.atan2(Math.sin(b.motion.semanticRotationY - a.motion.semanticRotationY), Math.cos(b.motion.semanticRotationY - a.motion.semanticRotationY)));
      if (a.motion.clip !== b.motion.clip) transitions++;
      if (distance > 0.0001 && b.motion.clip === a.motion.clip && Math.abs(b.motion.time - a.motion.time) > 0.001) advancing.add(b.motion.motion);
    }
  }
  return { translatedMetres: translated, turnRadians: turn, transitions,
    advancingWhileTranslating: [...advancing],
    requiredMotions: requiresRun ? ["walk", "run"] : ["walk"],
    checks: { translation: translated > 0.1, walk: advancing.has("walk"), ...(requiresRun ? { run: advancing.has("run") } : {}), turn: turn > 0.15, transition: transitions > 0 } };
}
try {
  const target = new URL(url!);
  target.searchParams.set("mode", "combat");
  target.searchParams.set("motion", "legacy");
  target.searchParams.set("motionActors", selected.join(","));
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
  if (!fixture?.actors?.length || !fixture.habitats?.length) throw new Error("Missing production __groundMotionLab actors/habitats; root must wire ?motion=legacy");
  if (JSON.stringify(fixture.actors.map((actor: any) => actor.assetId).sort()) !== JSON.stringify([...selected].sort())) throw new Error("motionActors fixture must contain exactly the selected actors");
  report.isolation = { selectedActors: selected, fixtureActors: fixture.actors.map((actor: any) => actor.assetId), exact: true };
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
    if (actor && selected.includes(actor.assetId)) {
      // Debug XYZ rounds to millimetres: 0.0008m covers at most half a millimetre per XZ axis.
      if (anchors.some(anchor => !anchor.insideDeclaredRegion || anchor.navDisplacementXZ === null || anchor.navDisplacementXZ > .1008)) throw new Error(`Selected habitat has invalid nav anchors: ${habitat.id}`);
      if (legs.some(leg => !Array.isArray(leg.path) || leg.path.length < 2)) throw new Error(`Selected habitat has a missing patrol path: ${habitat.id}`);
    }
  }
  for (const row of roster.filter(row => selected.includes(row.id))) {
    const actor = fixture.actors.find((actor: any) => actor.assetId === row.id);
    if (!actor) throw new Error(`Fixture lacks ${row.id}`);
    const entry = manifest.assets.find((entry: any) => entry.id === row.id);
    const evidence: any = { id: row.id, entityId: actor.entityId, preset: actor.presetId, requiresRun: entry.animations.includes("Run"), samples: [], observedFrames: {}, frameAttempts: {}, visualAccepted: false };
    evidence.before = await snapshot(actor.entityId, "setup");
    if (evidence.before.entity?.view?.assetId !== row.id) throw new Error(`Fixture actor asset mismatch: ${row.id}`);
    report.assets.push(evidence);
  }
  // Selected actors patrol concurrently. Neither AI clocks nor actors are reset.
  const patrolUntil = performance.now() + 16_000;
  while (performance.now() < patrolUntil) {
    for (const evidence of report.assets) await recordMotionSample(evidence, "natural-patrol");
    await page.waitForTimeout(100);
  }
  for (const evidence of report.assets) {
    const entityId = evidence.entityId;
    evidence.commandStart = report.commands.length;
    const eventStart = await call("debug", "getEvents", [0]);
    try {
      const habitat = fixture.habitats.find((habitat: any) => habitat.id === entityId || habitat.groupId === entityId);
      if (!habitat || habitat.radius < 4) throw new Error(`Missing usable patrol habitat: ${entityId}`);
      const [cx, cz] = habitat.centre;
      await preposition(evidence);
      // The unchanged ten-second tested interval starts only after ordinary setup navigation is idle.
      const approachBudgetMs = 10_000;
      const approachUntil = performance.now() + approachBudgetMs;
      const initial = await snapshot(entityId, "approach-start"), initialP = initial.state.playerPosition, initialE = initial.entity.position;
      if (initial.state.movement.mode !== "idle" || Math.hypot(initialP[0] - initialE[0], initialP[2] - initialE[2]) > MAX_PURSUE_METRES) throw new Error("Timed pursuit requires completed nearby setup");
      evidence.testedApproach = { budgetMs: approachBudgetMs, before: initial };
      await call("debug", "callTool", ["corealm_attack", { entityId }]);
      let close = false;
      while (performance.now() < approachUntil) {
        const sample = await snapshot(entityId, "approach");
        evidence.samples.push(sample);
        const p = sample.state.playerPosition, e = sample.entity?.position;
        if (!e || !(sample.entity.combat?.health > 0)) throw new Error("Approach target is no longer alive");
        const gap = Math.hypot(p[0] - e[0], p[2] - e[2]);
        const reach = meleeReachMetres(sample.entity.combat.bodyRadius ?? 0);
        const enemyEngaged = sample.state.player?.engagedBy?.includes(entityId) === true;
        if (gap <= reach && sample.state.player?.inCombat && sample.state.player?.targetId === entityId && enemyEngaged) { evidence.approachContact = { gap, reach, bodyRadius: sample.entity.combat.bodyRadius, enemyEngaged, criterion: "production meleeReachMetres plus actual two-way engagement before fleeing" }; evidence.testedApproach.after = sample; close = true; break; }
        await page.waitForTimeout(100);
      }
      if (!close) throw new Error(`Production attack did not establish live two-way engagement within ${approachBudgetMs / 1000} seconds`);
      const groundY = (await snapshot(entityId, "bend-setup")).state.playerPosition[1];
      // Both endpoints and the straight segment stay within the authored five-metre habitat.
      await call("debug", "callTool", ["corealm_move_to", { position: [cx - 2.6, groundY, cz + 2.6] }]);
      await sampleFor(entityId, evidence.samples, "pursuit", 2_500);
      await call("debug", "callTool", ["corealm_move_to", { position: [cx + 2.6, groundY, cz + 2.6] }]);
      await sampleFor(entityId, evidence.samples, "turn-recovery", 2_500);
      await call("debug", "callTool", ["corealm_stop", {}]);
      evidence.after = await snapshot(entityId, "after");
      evidence.summary = summarize(evidence.samples, evidence.requiresRun);
      evidence.frameChecks = { walk: !!evidence.observedFrames.walk, ...(evidence.requiresRun ? { run: !!evidence.observedFrames.run } : {}), turn: !!evidence.observedFrames.turn };
      evidence.status = !Object.values(evidence.summary.checks).every(Boolean) ? "coverage-incomplete"
        : Object.values(evidence.frameChecks).every(Boolean) ? "semantic-coverage-passed" : "visual-coverage-incomplete";
    } catch (error) {
      evidence.status = "failed";
      evidence.error = String(error);
    }
    evidence.commands = report.commands.slice(evidence.commandStart);
    evidence.events = await call("debug", "getEvents", [eventStart.nextSeq]);
    evidence.navigationEvents = evidence.events.events.filter((event: any) => String(event.type).startsWith("navigation."));
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
