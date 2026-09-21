/**
 * Measures creature movement in the REAL WORLD, on real terrain, in real crowds.
 *
 * `tools/creature-walk-probe.ts` measures one creature on the feature lab's flat empty yard, which
 * is reproducible and answers questions about the walk cycle. It cannot answer anything about the
 * three things that only exist in the world a player actually walks around in, and each of them
 * produces "it does not walk smoothly" on its own:
 *
 *   slope       the lab yard is flat. `systems/enemyAI.ts: stepToward` snaps each step to the
 *               navmesh, and how a creature's Y tracks the ground it is crossing is only visible on
 *               ground that changes height.
 *   crowds      the lab spawns ONE creature. The world spawns flocks of five and six, and
 *               `separate()` shoves overlapping ones sideways at up to 1.1 m/s. That displacement
 *               is not pursuit, so nothing scales the walk cycle for it: a shoved creature is
 *               sliding by definition, and the denser the flock the more of it there is.
 *   distance    the lab's one creature is always inside the live-rig radius. Past about 45 m the
 *               world draws a BAKED pose, and a baked pose crossing the ground is a glide.
 *
 * Sampling is driven from Node, one short `page.evaluate` per sample, rather than one long loop
 * inside the page. That is not a style preference: the in-page version
 * (`tools/animals/motion-quality.ts`) reliably crashes the renderer on a loaded machine, and a
 * crashed tab measures nothing.
 *
 * Usage:
 *   npx tsx tools/creature-field-probe.ts                       # every group in the table below
 *   npx tsx tools/creature-field-probe.ts marchfield_hens_1
 */
import "./lib/repoContent.js";
import { chromium, type Browser, type Page } from "playwright";
import { REGIONS } from "../game/src/content/regions.js";
import MANIFEST from "../game/public/assets/manifest.json" with { type: "json" };
import { installTestDeadline } from "./lib/deadline.js";
import { startGameServer, type RunningGameServer } from "./lib/server.js";

const TOTAL_BUDGET_MS = Number(process.env["FIELD_PROBE_BUDGET_MS"] ?? 900_000);
/**
 * Samples are collected in BURSTS: `BURSTS` round trips, each gathering `BURST_SAMPLES` readings.
 *
 * One round trip per sample is the obvious shape and it is too slow — 40 of them per creature blew
 * a fifteen-minute budget on ten creatures. One long in-page loop is the other obvious shape and it
 * crashes the renderer. A short burst is neither: the page is never blocked for more than about a
 * second, and the probe pays four round trips per creature instead of forty.
 */
const BURSTS = 4;
const BURST_SAMPLES = 10;
const SAMPLE_INTERVAL_MS = 80;
/** How far out to watch neighbours, so crowding is measured rather than assumed. */
const NEIGHBOUR_RADIUS_M = 12;

/**
 * One entity per shape worth testing, named so the probe hits the real spawn rather than a stand-in.
 *
 * Chosen for terrain and flock size as much as for species: hens are a flock of five on the flat
 * Marchfield, ibex and bears are on the Karrowmoor scree where the ground actually moves, and the
 * dungeon groups are indoors on a carved floor.
 */
const TARGETS = [
  "marchfield_hens_1",
  "redsill_frogs_1",
  "open_march_goats_1",
  "redsill_cattle_1",
  "duskoak_stags_1",
  "deepwood_coyotes_1",
  "highcairn_bears_1",
  "ridge_ibex_1",
  "scree_boars_1",
  "terrace_aurochs_1",
];

interface Sample {
  atMs: number;
  x: number;
  y: number;
  z: number;
  ground: number;
  simYaw: number;
  drawnYaw: number;
  motion: string | null;
  path: string | null;
  timeScale: number | null;
  neighbours: number;
  playerDistance: number;
}

const started = performance.now();
const clearDeadline = installTestDeadline("creature field probe", TOTAL_BUDGET_MS);
let server: RunningGameServer | null = null;
let browser: Browser | null = null;
let page: Page | null = null;

try {
  server = await startGameServer({ logLevel: "error" });
  browser = await chromium.launch({
    headless: true,
    args: [
      "--enable-unsafe-swiftshader",
      "--mute-audio",
      // The world is a much heavier scene than the lab yard, and the default shared-memory budget
      // is what the renderer runs out of when the machine is already busy.
      "--disable-dev-shm-usage",
    ],
  });
  // Small viewport on purpose. Nothing here is judged by eye, and the framebuffer is the single
  // biggest thing the software rasteriser allocates.
  page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
  const crashes: string[] = [];
  page.on("crash", () => crashes.push("renderer crashed"));
  page.on("pageerror", (error) => crashes.push(String(error).slice(0, 300)));

  await page.goto(`${server.url}/index.html`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForFunction(
    () => (window as never as { __gameDebug?: { getState(): { ready?: boolean } } })
      .__gameDebug?.getState().ready === true,
    null,
    { timeout: 120_000 },
  );

  const wanted = process.argv.slice(2);
  const targets = wanted.length > 0 ? wanted : TARGETS;
  const rows: string[] = [];
  const header = `${"entity".padEnd(22)} ${"path".padEnd(10)} ${"ground".padStart(6)} ${"feet".padStart(6)}`
    + ` ${"slide".padStart(6)} ${"turn p90".padStart(8)} ${"bob".padStart(6)} ${"slope".padStart(6)} ${"crowd".padStart(5)}  notes`;

  for (const entityId of targets) {
    try {
      rows.push(await probe(page, entityId, header));
    } catch (cause) {
      rows.push(`${entityId.padEnd(22)} FAILED: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  console.log(header);
  console.log("-".repeat(header.length));
  for (const row of rows) console.log(row);
  console.log("");
  console.log(`probed in ${Math.round((performance.now() - started) / 1000)} s`);
  if (crashes.length > 0) console.log(`page problems: ${crashes.join(" | ")}`);
} finally {
  clearDeadline();
  await page?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await server?.close().catch(() => undefined);
}

async function probe(targetPage: Page, entityId: string, _header: string): Promise<string> {
  // Stand next to it, survive it, and provoke it. Health is topped up every sample rather than once
  // because a flock of five hens will otherwise kill the probe halfway through the run.
  await targetPage.evaluate(async (id: string) => {
    const debug = (window as never as {
      __gameDebug: {
        teleport(to: unknown): boolean;
        setSkillLevel(skill: string, level: number): number;
        setHealth(value: number): void;
      };
    }).__gameDebug;
    await debug.setSkillLevel("melee", 40);
    await debug.teleport({ entityId: id });
    await new Promise((resolve) => { setTimeout(resolve, 1200); });
    await debug.setHealth(9999);
  }, entityId);

  // Step off the spawn point so the creature has ground to cover, staying well inside every
  // authored aggro radius (the narrowest here is the cow's 5 m).
  await targetPage.evaluate(async (id: string) => {
    const debug = (window as never as {
      __gameDebug: {
        getPlayerPosition(): { x: number; y: number; z: number };
        teleport(to: unknown): boolean;
        callTool(name: string, args: unknown): Promise<unknown>;
      };
    }).__gameDebug;
    const here = debug.getPlayerPosition();
    await debug.teleport({ x: here.x + 3.5, y: here.y, z: here.z + 3.5 });
    await debug.callTool("corealm_attack", { entityId: id }).catch(() => undefined);
  }, entityId);

  const samples: Sample[] = [];
  for (let burst = 0; burst < BURSTS; burst += 1) {
    // Walk the player a step around the creature between bursts so it has to keep re-aiming. A
    // target that runs in a straight line never asks the steering to turn, which is how the lab
    // probe measured a turn rate of exactly zero for every creature in the game.
    const angle = burst * (Math.PI / 2);
    await targetPage.evaluate(async (args: { a: number }) => {
      const debug = (window as never as {
        __gameDebug: {
          getPlayerPosition(): { x: number; y: number; z: number };
          callTool(name: string, argv: unknown): Promise<unknown>;
        };
      }).__gameDebug;
      const here = debug.getPlayerPosition();
      await debug.callTool("corealm_move_to", {
        position: [here.x + Math.cos(args.a) * 6, here.y, here.z + Math.sin(args.a) * 6],
      }).catch(() => undefined);
    }, { a: angle });

    const batch = await targetPage.evaluate(async (args: {
      id: string; radius: number; count: number; intervalMs: number;
    }) => {
      const debug = (window as never as {
        __gameDebug: {
          getEntityMotion(id: string): Record<string, unknown> | null;
          getEntities(): { id: string; archetype?: string; position?: { x: number; y: number; z: number } }[];
          groundHeight(x: number, z: number): number;
          getPlayerPosition(): { x: number; y: number; z: number };
          setHealth(value: number): void;
        };
      }).__gameDebug;
      const out: unknown[] = [];
      for (let index = 0; index < args.count; index += 1) {
        await new Promise((resolve) => { setTimeout(resolve, args.intervalMs); });
        await debug.setHealth(9999);
        const motion = debug.getEntityMotion(args.id);
        if (!motion) continue;
        const semantic = motion["semanticPosition"] as number[] | undefined;
        if (!semantic) continue;
        const [x, y, z] = [semantic[0]!, semantic[1]!, semantic[2]!];
        let neighbours = 0;
        for (const entity of await debug.getEntities()) {
          if (entity.id === args.id) continue;
          if (entity.archetype !== "enemy" && entity.archetype !== "boss") continue;
          const p = entity.position;
          if (!p) continue;
          if (Math.hypot(p.x - x, p.z - z) <= args.radius) neighbours += 1;
        }
        const player = debug.getPlayerPosition();
        out.push({
          atMs: performance.now(),
          x, y, z,
          ground: debug.groundHeight(x, z),
          simYaw: motion["semanticRotationY"],
          drawnYaw: motion["drawnRotationY"],
          motion: motion["motion"],
          path: motion["path"],
          timeScale: motion["timeScale"],
          neighbours,
          playerDistance: Math.hypot(player.x - x, player.z - z),
        });
      }
      return out as Sample[];
    }, {
      id: entityId, radius: NEIGHBOUR_RADIUS_M,
      count: BURST_SAMPLES, intervalMs: SAMPLE_INTERVAL_MS,
    });
    samples.push(...batch);
  }

  return summarise(entityId, samples);
}

function summarise(entityId: string, samples: Sample[]): string {
  if (samples.length < 2) return `${entityId.padEnd(22)} no samples`;
  const speeds: number[] = [];
  const turns: number[] = [];
  const bobs: number[] = [];
  const slopes: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const a = samples[index - 1]!;
    const b = samples[index]!;
    const dt = (b.atMs - a.atMs) / 1000;
    if (dt <= 0) continue;
    // Ground gradient the creature is crossing, as a percentage. This is the whole reason for
    // running in the world: on the lab's flat yard it is zero by construction.
    const run = Math.hypot(b.x - a.x, b.z - a.z);
    if (run > 0.02) slopes.push(Math.abs(b.ground - a.ground) / run);
    // How far the body sits off the terrain, and how much that WANDERS. A constant offset is the
    // rig's own origin and is fine; a changing one is the creature wading through the hill.
    bobs.push(b.y - b.ground);
    if (run / dt < 0.2) continue;
    speeds.push(run / dt);
    if (Number.isFinite(a.drawnYaw) && Number.isFinite(b.drawnYaw)) {
      turns.push((Math.abs(wrap(b.drawnYaw - a.drawnYaw)) / dt * 180) / Math.PI);
    }
  }

  const walking = samples.filter((sample) => sample.motion === "walk");
  const timeScale = walking.at(-1)?.timeScale ?? null;
  const groundSpeed = percentile(speeds, 0.5);
  // What the feet deliver: the cycle's own speed at the rate the renderer settled on.
  const implied = impliedWalkMpsFor(entityId);
  const footSpeed = implied !== null && timeScale !== null ? implied * timeScale : null;
  const slide = footSpeed !== null && groundSpeed > 0.2
    ? Math.abs(groundSpeed - footSpeed) / groundSpeed
    : null;
  const bobSpread = bobs.length > 1 ? Math.max(...bobs) - Math.min(...bobs) : 0;
  const paths = [...new Set(samples.map((s) => s.path).filter((p): p is string => Boolean(p)))];
  const crowd = Math.max(...samples.map((s) => s.neighbours));
  const slope = percentile(slopes, 0.9);

  const notes: string[] = [];
  if (speeds.length === 0) notes.push("never moved");
  if (!paths.includes("live-rig")) notes.push("NOT ANIMATED");
  if (slide !== null && slide > 0.25) notes.push(`${Math.round(slide * 100)}% slide`);
  if (bobSpread > 0.35) notes.push(`bobs ${bobSpread.toFixed(2)} m`);
  if (percentile(turns, 0.9) > 401) notes.push("spins");

  return `${entityId.padEnd(22)} ${(paths.join("/") || "-").padEnd(10)}`
    + ` ${groundSpeed.toFixed(2).padStart(6)}`
    + ` ${(footSpeed === null ? "-" : footSpeed.toFixed(2)).padStart(6)}`
    + ` ${(slide === null ? "-" : `${Math.round(slide * 100)}%`).padStart(6)}`
    + ` ${percentile(turns, 0.9).toFixed(0).padStart(8)}`
    + ` ${bobSpread.toFixed(2).padStart(6)}`
    + ` ${`${Math.round(slope * 100)}%`.padStart(6)}`
    + ` ${String(crowd).padStart(5)}`
    + `  ${notes.length > 0 ? notes.join("; ") : "ok"}`;
}

/**
 * The walk speed this creature's own cycle implies, from the manifest.
 *
 * Entity ids are the group id with an index suffix when a group spawns more than one
 * (`world/regionBuilder.ts`), and the bare group id when it spawns exactly one, so both spellings
 * have to resolve.
 */
function impliedWalkMpsFor(entityId: string): number | null {
  const groupId = entityId.replace(/_\d+$/, "");
  const groups = REGIONS.flatMap((region) => [
    ...region.enemyGroups,
    ...(region.dungeon?.enemyGroups ?? []),
  ]);
  const assetId = groups.find((group) => group.id === groupId || group.id === entityId)?.assetId;
  if (assetId === undefined) return null;
  const asset = MANIFEST.assets.find((row) => row.id === assetId) as
    { impliedWalkMps?: number } | undefined;
  return asset?.impliedWalkMps ?? null;
}

function wrap(delta: number): number {
  let value = delta;
  while (value > Math.PI) value -= 2 * Math.PI;
  while (value < -Math.PI) value += 2 * Math.PI;
  return value;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}
