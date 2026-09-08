/**
 * Persistent production lab driver. One JSON command and response per line; errors stay in-band.
 *
 * npx tsx tools/lab-session.ts --url http://127.0.0.1:4174 --route '/?mode=combat&presentation=1'
 * {"id":1,"op":"spawn","kind":"creature","presetId":"redsill_cattle","distance":9}
 * {"id":2,"op":"call","surface":"lab","method":"perform","args":["attack"]}
 * {"id":3,"op":"sampleMotion","samples":12,"intervalMs":120,"captureFrames":[0,5,11],"name":"attack"}
 * {"id":4,"op":"close"}
 *
 * Reopen explicitly after edits that reload the document. Asset and browser caches remain warm.
 * The session records evidence; it does not label advancing animation timestamps as visual proof.
 * Full commands and responses append to --out/session.jsonl. --compact prints status only while
 * preserving complete evidence in that journal; the default output remains one full JSON response.
 */
import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { FAST_TEST_SETTINGS, GameDriver } from "./lib/driver.js";
import { argValue, repoRoot, resolveInside, safeName } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";
import { installAssetCandidates } from "./lib/assetCandidates.js";
import { checkActionResult } from "./play-game.js";
import type { EnvironmentWorkbench } from "../game/src/featureLab/environment.js";
import type { CreatureGallery } from "../game/src/featureLab/creatureGallery.js";
import type { EntityMotionSnapshot } from "../game/src/render/entityViews.js";

type Command = Record<string, unknown> & { op: string; id?: string | number };

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function number(value: unknown, fallback: number, min: number, max: number): number {
  const result = value ?? fallback;
  if (typeof result !== "number" || !Number.isFinite(result) || result < min || result > max) {
    throw new Error(`Expected a number from ${min} to ${max}`);
  }
  return result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const existingUrl = argValue(args, "--url");
  const server = existingUrl ? { url: existingUrl, close: async () => {} } : await startGameServer();
  const output = resolveInside(repoRoot, argValue(args, "--out") ?? "test-results/lab-session");
  await mkdir(output, { recursive: true });
  const journal = path.join(output, "session.jsonl");
  const compactOutput = args.includes("--compact");
  let route = argValue(args, "--route") ?? "/index.html?mode=combat&presentation=1";
  const driver = new GameDriver(server, {
    headless: !args.includes("--headed"),
    viewport: { width: 1440, height: 900 },
    browserArgs: args.includes("--software") ? ["--enable-unsafe-swiftshader", "--mute-audio"]
      : process.platform === "win32" ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"]
        : ["--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
    ...(args.includes("--software") ? { settings: FAST_TEST_SETTINGS } : {}),
  });
  let eventCursor = 0;
  let documentId: number | null = null;

  async function emit(response: Record<string, unknown>, command: unknown = null): Promise<void> {
    await appendFile(journal, JSON.stringify({ at: new Date().toISOString(), command, response }) + "\n");
    const { result: _result, observation: _observation, ...summary } = response;
    process.stdout.write(JSON.stringify(compactOutput
      ? { ...summary, journal: path.relative(repoRoot, journal) }
      : response) + "\n");
  }

  async function call(surface: "lab" | "debug" | "environment" | "creatures" | "forest" | "progression", method: string, values: unknown[] = []): Promise<unknown> {
    const result = await driver.page!.evaluate(async ({ surface, method, values }) => {
      const api = (surface === "progression"
        ? (window as Window & { __questRecoveryLab?: Record<string, unknown> }).__questRecoveryLab
        : surface === "forest"
        ? (window as Window & { __forestLab?: Record<string, unknown> }).__forestLab
        : surface === "creatures"
        ? (window as Window & { __creatureGallery?: CreatureGallery }).__creatureGallery
        : surface === "environment"
        ? (window as Window & { __environmentLab?: EnvironmentWorkbench }).__environmentLab
        : surface === "lab" ? window.__featureLab : window.__gameDebug) as unknown as Record<string, unknown> | undefined;
      if (!api || !Object.hasOwn(api, method) || typeof api[method] !== "function") throw new Error(`Missing ${surface} method: ${method}`);
      const result = await (api[method] as (...args: unknown[]) => unknown).apply(api, values);
      return JSON.parse(JSON.stringify(result ?? null));
    }, { surface, method, values });
    const failure = checkActionResult(result);
    if (failure) throw new Error(failure);
    return result;
  }

  async function observe(entityIds: string[] = []): Promise<unknown> {
    const result = await driver.page!.evaluate(({ entityIds, since }) => {
      const debug = window.__gameDebug as unknown as Record<string, (...args: unknown[]) => unknown>;
      const lab = window.__featureLab?.getState();
      const creatures = (window as Window & { __creatureGallery?: CreatureGallery }).__creatureGallery?.getState();
      const ids = entityIds.length ? entityIds : creatures?.entityIds.length ? [creatures.entityIds[0]!] : lab?.target?.entityId ? [lab.target.entityId] : [];
      const events = debug.getEvents?.(since) as { nextSeq: number; events: unknown[] } | undefined;
      return {
        documentId: performance.timeOrigin,
        url: location.href,
        ready: (debug.getState?.() as { ready?: boolean } | undefined)?.ready ?? false,
        mode: lab?.mode ?? "game",
        revision: lab?.structure?.revision ?? null,
        target: lab?.target ?? null,
        presentation: lab?.presentation ?? null,
        environment: (window as Window & { __environmentLab?: EnvironmentWorkbench }).__environmentLab?.getState() ?? null,
        creatures: creatures ?? null,
        player: debug.getPlayer?.(),
        camera: debug.getCamera?.(),
        entities: ids.map((id) => ({ id, entity: debug.getEntity?.(id), bounds: debug.getDrawnBounds?.(id), motion: debug.getEntityMotion?.(id) })),
        events: events ?? { nextSeq: since, events: [] },
        metrics: debug.getMetrics?.(),
        errors: debug.getErrors?.(),
      };
    }, { entityIds, since: eventCursor }) as { documentId: number; events: { nextSeq: number } };
    if (documentId !== result.documentId) {
      // Re-read after a document reload so the old event cursor cannot hide fresh events.
      documentId = result.documentId;
      if (eventCursor !== 0) { eventCursor = 0; return observe(entityIds); }
    }
    eventCursor = result.events.nextSeq;
    return result;
  }

  async function execute(command: Command): Promise<unknown> {
    switch (command.op) {
      case "open":
      case "reopen":
      case "resetFixture": {
        route = command.route === undefined ? route : string(command.route, "route");
        // The append-only journal retains prior failures; report errors for this document only.
        driver.consoleErrors.length = 0;
        driver.pageErrors.length = 0;
        driver.requestErrors.length = 0;
        await driver.open(20_000, route);
        eventCursor = 0;
        return observe();
      }
      case "spawn":
        if (command.kind !== "creature" && command.kind !== "npc") throw new Error("kind must be creature or npc");
        await call("lab", "spawnTarget", [command.kind, string(command.presetId, "presetId"), { distance: number(command.distance, 10, 1, 100) }]);
        return observe();
      case "call": {
        if (command.surface !== "lab" && command.surface !== "debug" && command.surface !== "environment" && command.surface !== "creatures" && command.surface !== "forest" && command.surface !== "progression") throw new Error("surface must be lab, debug, environment, creatures, forest or progression");
        if (command.args !== undefined && !Array.isArray(command.args)) throw new Error("args must be an array");
        const method = string(command.method, "method");
        if (method === "setMode") throw new Error("Use open with a mode route so document readiness is awaited");
        return call(command.surface, method, command.args as unknown[] | undefined);
      }
      case "frameEnvironment":
      case "frameCreatures": {
        const fixture = command.op === "frameEnvironment" ? "environment" : "creatures";
        const beforeDocument = await driver.page!.evaluate((fixture) => {
          if (window.__gameDebug?.getState().ready !== true) throw new Error("Game is not ready; reopen after boot completes");
          const workbench = fixture === "environment"
            ? (window as Window & { __environmentLab?: EnvironmentWorkbench }).__environmentLab
            : (window as Window & { __creatureGallery?: CreatureGallery }).__creatureGallery;
          if (!workbench?.getState().ready) throw new Error(`${fixture} fixture is not ready`);
          if (!workbench.getBounds()) throw new Error(`${fixture} fixture has no drawn bounds to frame`);
          return performance.timeOrigin;
        }, fixture);
        // Use the root's production camera callback, including detached focus and fit distance.
        const frameControl = fixture === "environment"
          ? command.detail === true ? "#environment-lab-detail" : "#environment-lab-frame"
          : "#creature-gallery-frame";
        await driver.page!.locator(frameControl).click({ timeout: 5_000 });
        await driver.wait(80);
        const observation = await observe() as { ready: boolean; documentId: number; environment?: { ready: boolean }; creatures?: { ready: boolean } };
        if (!observation.ready || !observation[fixture]?.ready || observation.documentId !== beforeDocument) {
          throw new Error(`${fixture} fixture changed or became unavailable while framing; reopen and retry`);
        }
        return observation;
      }
      case "camera": {
        if (command.shot !== undefined) {
          if (!await call("debug", "focusCamera", [string(command.shot, "shot")])) throw new Error("Unknown camera shot");
        } else {
          const pose = command.pose;
          if (!pose || typeof pose !== "object" || Array.isArray(pose)) throw new Error("camera needs shot or pose");
          const p = pose as Record<string, unknown>;
          for (const field of ["x", "y", "z", "yaw", "pitch", "distance"]) number(p[field], NaN, -100_000, 100_000);
          if (!await call("debug", "inspectPose", [pose])) throw new Error("Camera pose was rejected");
        }
        return observe();
      }
      case "input": {
        const actions = ["key", "click", "drag"].filter((name) => command[name] !== undefined);
        if (actions.length !== 1) throw new Error("input needs exactly one key, click or drag");
        if (command.key !== undefined) await driver.press(string(command.key, "key"), number(command.holdMs, 0, 0, 5_000));
        else {
          const points = command.click ?? command.drag;
          const length = command.click ? 2 : 4;
          if (!Array.isArray(points) || points.length !== length || !points.every(Number.isFinite)) throw new Error("Invalid pointer coordinates");
          const button = command.button ?? "left";
          if (button !== "left" && button !== "right" && button !== "middle") throw new Error("Invalid mouse button");
          if (length === 2) await driver.click(points[0], points[1], button);
          else await driver.drag(points[0], points[1], points[2], points[3], button);
        }
        return observe();
      }
      case "observe":
        return observe(ids(command.entityIds));
      case "waitForEntity": {
        const entityId = string(command.entityId, "entityId");
        const state = string(command.state, "state");
        const timeout = number(command.timeoutMs, 20_000, 100, 30_000);
        await driver.page!.waitForFunction(({ entityId, state }) => {
          const debug = window.__gameDebug;
          if (!debug?.getState().ready) throw new Error("Game became unavailable while waiting for an entity");
          const getEntity = debug.getEntity as (id: string) => { state: string } | undefined;
          return getEntity(entityId)?.state === state;
        }, { entityId, state }, { timeout });
        return observe([entityId]);
      }
      case "capture":
        // Let scheduled panel metadata and two rendered frames catch up to fixture selection.
        await driver.wait(550);
        return { path: await driver.screenshot(output, string(command.name, "name")), observation: await observe(ids(command.entityIds)) };
      case "sampleMotion": {
        const samples = number(command.samples, 12, 2, 60);
        const intervalMs = number(command.intervalMs, 100, 50, 1_000);
        if (!Number.isInteger(samples) || samples * intervalMs > 10_000) throw new Error("Motion samples must fit within 10 seconds");
        let entityIds = ids(command.entityIds);
        const captures = command.captureFrames ?? [];
        if (!Array.isArray(captures) || captures.length > 6 || !captures.every((frame) => Number.isInteger(frame) && frame >= 0 && frame < samples)) {
          throw new Error("captureFrames must contain up to six sample indexes");
        }
        const name = safeName(command.name === undefined ? "motion" : string(command.name, "name"));
        const frames = [];
        for (let index = 0; index < samples; index += 1) {
          if (index) await driver.wait(intervalMs);
          const state = await driver.page!.evaluate((entityIds) => {
            const debug = window.__gameDebug as unknown as Record<string, (...args: unknown[]) => unknown>;
            if ((debug?.getState?.() as { ready?: boolean } | undefined)?.ready !== true) {
              throw new Error("Game is not ready for motion sampling; reopen after boot completes");
            }
            const lab = window.__featureLab?.getState();
            const creatures = (window as Window & { __creatureGallery?: CreatureGallery }).__creatureGallery?.getState();
            if (!entityIds.length && creatures && !creatures.ready) throw new Error("Creature gallery is not ready for motion sampling");
            const ids = entityIds.length ? entityIds : creatures ? creatures.entityIds : lab?.target?.entityId ? [lab.target.entityId] : [];
            if (!ids.length) throw new Error("Motion sampling requires at least one production actor; select a creature or supply entityIds");
            return {
              documentId: performance.timeOrigin, atMs: performance.now(), player: debug.getPlayerMotion?.(),
              entities: ids.map((id) => {
                const entity = debug.getEntity?.(id);
                if (!entity) throw new Error(`Motion actor ${id} is missing from the production entity store`);
                const motion = debug.getEntityMotion?.(id) as EntityMotionSnapshot | null | undefined;
                // Sampled and baked actor poses are valid evidence at distance. Requiring a live
                // mixer would prevent this tool from exposing a broken animation LOD transition.
                if (!motion?.path || !motion.motion) throw new Error(`Motion actor ${id} has no production motion state`);
                const bounds = debug.getDrawnBounds?.(id) as { meshes?: number } | null | undefined;
                if (!bounds || !bounds.meshes || bounds.meshes <= 0) throw new Error(`Motion actor ${id} has no drawn geometry`);
                return { id, entity, motion, bounds };
              }),
            };
          }, entityIds);
          if (index === 0) entityIds = state.entities.map((entity) => entity.id);
          else if (state.documentId !== frames[0]?.documentId) throw new Error("Document reloaded during motion sampling; repeat the sample");
          const screenshot = captures.includes(index) ? await driver.screenshot(output, `${name}-${index.toString().padStart(2, "0")}`) : undefined;
          frames.push({ ...state, ...(screenshot ? { screenshot } : {}) });
        }
        const observation = await observe(entityIds) as { ready: boolean; documentId: number };
        if (!observation.ready || observation.documentId !== frames[0]?.documentId) throw new Error("Game became unavailable during motion sampling; repeat the sample");
        return { frames, observation };
      }
      case "errors":
        return { console: driver.consoleErrors, page: driver.pageErrors, requests: driver.requestErrors, game: await call("debug", "getErrors") };
      case "close": return { closed: true };
      default: throw new Error(`Unknown operation: ${command.op}`);
    }
  }

  try {
    await driver.launch();
    const catalog = argValue(args, "--catalog");
    if (catalog) await installAssetCandidates(driver.page!, catalog);
    await driver.open(20_000, route);
    await emit({ type: "ready", server: server.url, output: path.relative(repoRoot, output), observation: await observe() });
    const input = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
    for await (const line of input) {
      if (!line.trim()) continue;
      const started = performance.now();
      let command: Command | undefined;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof (parsed as Command).op !== "string") throw new Error("Command needs an op string");
        command = parsed as Command;
        const result = await execute(command);
        await emit({ id: command.id ?? null, op: command.op, ok: true, elapsedMs: Math.round(performance.now() - started), result }, command);
      } catch (error) {
        await emit({ id: command?.id ?? null, op: command?.op ?? null, ok: false, elapsedMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) }, command ?? line);
      }
      if (command?.op === "close") { input.close(); break; }
    }
  } catch (error) {
    await emit({ type: "session-error", ok: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    await driver.close();
    await server.close();
  }
}

function ids(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64 || !value.every((id) => typeof id === "string" && id)) throw new Error("entityIds must contain up to 64 ids");
  return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
