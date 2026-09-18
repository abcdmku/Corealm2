import { sendGameCommand } from "../api/commands.js";
/**
 * Bounded, interruptible operations.
 *
 * The primitive tools are one click each, and a click is the wrong unit for an agent: mining ten
 * ore is one `corealm_interact` plus a long-poll, but a fight is attack + wait + loot + wait, and
 * an agent driven through a chat window pays a round trip for every step. These tools compose
 * the primitives into one call that returns when the job is done, cut short, or impossible —
 * still through `GameApi`, still at game speed, still subject to the same rules as a human. None
 * of them can do anything a sequence of the primitive tools could not.
 *
 * Every operation runs as a session task (`AgentSession.runTask`), so Stop, Take control, a mode
 * change and the WebMCP caller's own AbortSignal all cancel it at its next checkpoint. Pause
 * halts the character and parks the loop; Resume re-issues the command. Waiting is done in short
 * slices of `corealm_events` so a cancellation is never more than a second away.
 */
import type {
  EntityId, GameApi, GameEvent, GameEventType, InteractionId, ItemStack, RecipeId, SpellId, Vec3,
} from "../contracts.js";
import type { AgentSession, SessionError } from "./session.js";
import { MAX_TIMEOUT_MS, TOOL_SPECS, type GatherInteraction } from "./catalogue.js";
import {
  asNumber, asString, defineTool, failure, isError, unwrap,
  type ToolDef, type ToolDeps,
} from "./toolkit.js";

const SLICE_MS = 1000;
const DEFAULT_TIMEOUT_MS = 120_000;

interface WaitOutcome {
  events: GameEvent[];
  cursor: number;
  /** Why the wait ended without a matching event. */
  ended: "event" | "timeout" | "cancelled" | "paused";
}

/** Event-stream watcher shared by every operation. Slices the long-poll so it can be cancelled. */
class Watch {
  cursor: number;

  constructor(private readonly api: GameApi, private readonly session: AgentSession, private readonly signal: AbortSignal) {
    this.cursor = api.getRevision().eventSeq;
  }

  /** Waits for any of `types`, or the deadline. Returns early on cancel or pause. */
  async next(types: GameEventType[], deadline: number): Promise<WaitOutcome> {
    while (true) {
      if (this.signal.aborted) return { events: [], cursor: this.cursor, ended: "cancelled" };
      if (this.session.read().paused) return { events: [], cursor: this.cursor, ended: "paused" };
      const remaining = deadline - performance.now();
      if (remaining <= 0) return { events: [], cursor: this.cursor, ended: "timeout" };
      const batch = await this.api.events(this.cursor, types, Math.min(SLICE_MS, remaining));
      this.cursor = batch.nextSeq;
      // Pause halts the character, and that halt is itself an event (`navigation.failed`,
      // `activity.stopped` with reason cancelled) which is exactly what this wait was listening
      // for. Checked after the wait as well as before it, so the pause wins over its own echo.
      if (this.signal.aborted) return { events: [], cursor: this.cursor, ended: "cancelled" };
      if (this.session.read().paused) return { events: [], cursor: this.cursor, ended: "paused" };
      if (batch.events.length > 0) return { events: batch.events, cursor: this.cursor, ended: "event" };
    }
  }

  /**
   * Blocks while paused; false if cancelled meanwhile. On resume the cursor skips past whatever
   * happened during the pause — in particular the `navigation.failed { reason: "cancelled" }`
   * that Pause's own stop emitted, which would otherwise read as the walk failing.
   */
  async holdWhilePaused(): Promise<boolean> {
    if (!this.session.read().paused) return true;
    const resumed = await this.session.whenResumed(this.signal);
    this.cursor = this.api.getRevision().eventSeq;
    return resumed;
  }
}

function deadlineFrom(timeoutMs: unknown): number {
  return performance.now() + Math.min(MAX_TIMEOUT_MS, Math.max(1000, asNumber(timeoutMs, DEFAULT_TIMEOUT_MS)));
}

function cancelled(what: string): SessionError {
  return failure("CANCELLED", `${what} was cancelled by the player or a mode change`);
}

function targetFrom(args: Record<string, unknown>): { entityId: EntityId } | { locationId: string } | { position: Vec3 } | null {
  if (typeof args.entityId === "string") return { entityId: args.entityId };
  if (typeof args.locationId === "string") return { locationId: args.locationId };
  if (Array.isArray(args.position)) return { position: args.position as unknown as Vec3 };
  return null;
}

function describeTarget(target: ReturnType<typeof targetFrom>): string {
  if (!target) return "nowhere";
  if ("entityId" in target) return target.entityId;
  if ("locationId" in target) return target.locationId;
  return `[${target.position.map((n) => Math.round(n)).join(", ")}]`;
}

// -------------------------------------------------------------- navigate

/**
 * Walks and waits. Re-issues the walk after a pause. Returns once the character stands there, or
 * the reason it never will.
 */
async function navigate(
  api: GameApi, watch: Watch, target: NonNullable<ReturnType<typeof targetFrom>>, deadline: number,
): Promise<Record<string, unknown> | SessionError> {
  const startedAt = performance.now();
  while (true) {
    if (!(await watch.holdWhilePaused())) return cancelled("Navigation");
    const started = await sendGameCommand(api, "moveTo", target);
    if (!started.ok) return unwrap(started) as SessionError;
    // Already standing there: the walk is trivially over and no event will say so.
    if (!api.getPlayer().moving && started.value.pathLength < 0.5) {
      return { arrived: true, position: api.getPlayer().position, pathLength: started.value.pathLength, elapsedMs: Math.round(performance.now() - startedAt) };
    }
    const outcome = await watch.next(["navigation.completed", "navigation.failed", "player.died"], deadline);
    if (outcome.ended === "cancelled") return cancelled("Navigation");
    if (outcome.ended === "paused") {
      await sendGameCommand(api, "stop");
      continue;
    }
    if (outcome.ended === "timeout") {
      await sendGameCommand(api, "stop");
      return failure("TIMEOUT", `Did not reach ${describeTarget(target)} in time`, { position: api.getPlayer().position });
    }
    const died = outcome.events.find((event) => event.type === "player.died");
    if (died) return failure("DEAD", "The character died on the way", { event: died });
    const done = outcome.events.find((event) => event.type === "navigation.completed");
    if (done) {
      return { arrived: true, position: api.getPlayer().position, pathLength: started.value.pathLength, elapsedMs: Math.round(performance.now() - startedAt) };
    }
    const failed = outcome.events.find((event) => event.type === "navigation.failed");
    const reason = String(failed?.data.reason ?? "unknown");
    // "cancelled" is a stop issued from outside this loop — a player click, a Stop that has not
    // yet aborted the task, a pause. It is not a routing failure, so say so.
    if (reason === "cancelled" || reason === "movement-disabled") return cancelled("Navigation");
    return failure("NOT_REACHABLE", `Navigation failed: ${reason}`, { position: api.getPlayer().position });
  }
}

// ---------------------------------------------------------------- tools

export function createOperationTools({ api, session }: ToolDeps): ToolDef[] {
  const run = <T>(tool: string, summary: string, body: (signal: AbortSignal) => Promise<T>) =>
    session.runTask(tool, summary, body);

  const runWithCaller = <T>(tool: string, summary: string, callerSignal: AbortSignal | undefined, body: (watch: Watch, signal: AbortSignal) => Promise<T>) =>
    run(tool, summary, async (taskSignal) => {
      // Two signals: the session's (Stop, Take control) and the WebMCP caller's own cancellation.
      const controller = new AbortController();
      const forward = () => controller.abort();
      taskSignal.addEventListener("abort", forward, { once: true });
      callerSignal?.addEventListener("abort", forward, { once: true });
      if (taskSignal.aborted || callerSignal?.aborted) controller.abort();
      try {
        return await body(new Watch(api, session, controller.signal), controller.signal);
      } finally {
        taskSignal.removeEventListener("abort", forward);
        callerSignal?.removeEventListener("abort", forward);
      }
    });

  return [
    defineTool(TOOL_SPECS.corealm_navigate, (args, context) => {
      const target = targetFrom(args);
      if (!target) return failure("INVALID_ARGUMENT", "Give one of entityId, locationId, or position");
      return runWithCaller("corealm_navigate", `Walking to ${describeTarget(target)}`, context.signal,
        (watch) => navigate(api, watch, target, deadlineFrom(args.timeoutMs)));
    }),

    defineTool(TOOL_SPECS.corealm_follow_route, (args, context) => {
      const waypoints = (args.waypoints as Record<string, unknown>[]).map(targetFrom);
      if (waypoints.some((point) => point === null)) return failure("INVALID_ARGUMENT", "Every waypoint needs an entityId, locationId, or position");
      const deadline = deadlineFrom(asNumber(args.timeoutMs, 300_000));
      return runWithCaller("corealm_follow_route", `Following a ${waypoints.length}-leg route`, context.signal, async (watch) => {
        const legs: Record<string, unknown>[] = [];
        for (const [index, target] of waypoints.entries()) {
          session.setActivity(`Route leg ${index + 1}/${waypoints.length}: ${describeTarget(target)}`);
          const leg = await navigate(api, watch, target!, deadline);
          legs.push({ index, target: describeTarget(target), ...(isError(leg) ? { error: leg.error, message: leg.message } : leg) });
          if (isError(leg)) return { completed: false, legsDone: index, legs, error: leg.error, message: `Stopped at leg ${index + 1}: ${leg.message}` };
        }
        return { completed: true, legsDone: waypoints.length, legs, position: api.getPlayer().position };
      });
    }),

    defineTool(TOOL_SPECS.corealm_gather, (args, context) => {
      const interaction = args.interaction as GatherInteraction;
      const wanted = asNumber(args.quantity, 1);
      const pinned = typeof args.entityId === "string" ? args.entityId : null;
      const radius = asNumber(args.radius, 140);
      const deadline = deadlineFrom(asNumber(args.timeoutMs, 300_000));
      return runWithCaller("corealm_gather", `Gathering ${wanted} (${interaction})`, context.signal, async (watch) => {
        let received = 0;
        const items: Record<string, number> = {};
        const exhausted = new Set<EntityId>();
        const finish = (reason: string, extra: Record<string, unknown> = {}) => ({
          received, wanted, items, complete: received >= wanted, reason, freeSlots: api.getInventory().freeSlots, ...extra,
        });

        while (received < wanted) {
          if (!(await watch.holdWhilePaused())) return cancelled("Gathering");
          if (performance.now() > deadline) { await sendGameCommand(api, "stop"); return finish("timeout"); }

          let nodeId = pinned;
          if (!nodeId) {
            const candidates = api.observe({ interaction, requirementsMet: true, radius, limit: 25 })
              .filter((row) => row.state === "available" && !exhausted.has(row.id));
            nodeId = candidates[0]?.id ?? null;
            if (!nodeId) {
              // Everything in sight is depleted or unusable. Wait for a respawn rather than walking off.
              const depleted = api.observe({ interaction, radius, limit: 5 }).length > 0;
              if (!depleted) return finish("no-node", { message: `No node offering ${interaction} within ${radius} m that the player qualifies for.` });
              const outcome = await watch.next(["resource.depleted", "entity.discovered"], Math.min(deadline, performance.now() + 15_000));
              if (outcome.ended === "cancelled") return cancelled("Gathering");
              exhausted.clear();
              continue;
            }
          }

          session.setActivity(`${interaction} at ${nodeId}: ${received}/${wanted}`);
          const started = await sendGameCommand(api, "interact", nodeId, interaction as InteractionId);
          if (!started.ok) {
            if (started.error.code === "INVENTORY_FULL") return finish("inventory-full", { message: started.error.message });
            if (started.error.code === "DEAD") return finish("dead", { message: started.error.message });
            if (pinned) return finish("node-unavailable", { error: started.error.code, message: started.error.message });
            exhausted.add(nodeId);
            continue;
          }
          if (started.value.started.startsWith("walking")) {
            const arrived = await watch.next(["navigation.completed", "navigation.failed", "player.died"], deadline);
            if (arrived.ended === "cancelled") return cancelled("Gathering");
            if (arrived.ended === "paused") { await sendGameCommand(api, "stop"); continue; }
            if (arrived.ended === "timeout") { await sendGameCommand(api, "stop"); return finish("timeout"); }
            if (arrived.events.some((event) => event.type === "player.died")) return finish("dead");
            if (arrived.events.some((event) => event.type === "navigation.failed")) {
              if (pinned) return finish("unreachable");
              exhausted.add(nodeId);
            }
            continue;
          }

          // Gathering is running. Count yields until something ends the session at this node.
          let atNode = true;
          while (atNode && received < wanted) {
            const outcome = await watch.next(
              ["item.received", "inventory.full", "resource.depleted", "activity.stopped", "player.died"],
              deadline,
            );
            if (outcome.ended === "cancelled") return cancelled("Gathering");
            if (outcome.ended === "paused") { await sendGameCommand(api, "stop"); atNode = false; break; }
            if (outcome.ended === "timeout") { await sendGameCommand(api, "stop"); return finish("timeout"); }
            for (const event of outcome.events) {
              if (event.type === "item.received" && typeof event.data.itemId === "string" && event.data.source === "gather") {
                const quantity = asNumber(event.data.quantity, 1);
                received += quantity;
                items[event.data.itemId] = (items[event.data.itemId] ?? 0) + quantity;
              } else if (event.type === "inventory.full") {
                await sendGameCommand(api, "stop");
                return finish("inventory-full");
              } else if (event.type === "player.died") {
                return finish("dead");
              } else if (event.type === "resource.depleted" && event.entityId === nodeId) {
                exhausted.add(nodeId);
                atNode = false;
              } else if (event.type === "activity.stopped" && event.data.reason !== "depleted") {
                // Cancelled from outside the task (player click, Stop) or stopped by the world.
                if (event.data.reason === "cancelled") return cancelled("Gathering");
                atNode = false;
              }
            }
          }
        }
        await sendGameCommand(api, "stop");
        return finish("complete");
      });
    }),

    defineTool(TOOL_SPECS.corealm_fight, (args, context) => {
      const targetId = asString(args.entityId);
      const spellId = typeof args.spellId === "string" ? (args.spellId as SpellId) : null;
      const retreatBelow = asNumber(args.retreatBelow, 0);
      const loot = args.loot !== false;
      const deadline = deadlineFrom(asNumber(args.timeoutMs, 180_000));
      return runWithCaller("corealm_fight", `Fighting ${targetId}`, context.signal, async (watch) => {
        const startHealth = api.getPlayer().health;
        let hits = 0;
        while (true) {
          if (!(await watch.holdWhilePaused())) return cancelled("The fight");
          const started = spellId ? await sendGameCommand(api, "cast", spellId, targetId) : await sendGameCommand(api, "attack", targetId);
          if (!started.ok) return unwrap(started);
          const fight = await waitForCombatEnd(api, watch, targetId, deadline, retreatBelow);
          if (isError(fight)) return { ...fight, hits: hits + asNumber(fight.hits, 0) };
          hits += fight.hits;
          // Paused mid-fight: the character was halted; re-issue the attack once resumed.
          if (fight.paused) { await sendGameCommand(api, "stop"); continue; }
          const reason = String(fight.event.data.reason ?? "unknown");
          const player = api.getPlayer();
          const result: Record<string, unknown> = {
            outcome: reason,
            targetId, hits, xp: fight.event.data.xp ?? null,
            health: player.health, maxHealth: player.maxHealth,
            healthLost: Math.max(0, startHealth - player.health),
          };
          if (reason === "killed" && loot) {
            session.setActivity(`Looting after ${targetId}`);
            result.loot = await lootNearby(api, watch, 12, deadline);
          }
          return result;
        }
      });
    }),

    defineTool(TOOL_SPECS.corealm_loot_nearby, (args, context) => runWithCaller("corealm_loot_nearby", "Looting nearby drops", context.signal,
      async (watch) => lootNearby(api, watch, asNumber(args.radius, 40), deadlineFrom(args.timeoutMs)))),

    defineTool(TOOL_SPECS.corealm_craft, (args, context) => {
      const recipeId = asString(args.recipeId) as RecipeId;
      const quantity = asNumber(args.quantity, 1);
      const deadline = deadlineFrom(asNumber(args.timeoutMs, 300_000));
      return runWithCaller("corealm_craft", `Making ${quantity} × ${recipeId}`, context.signal, async (watch) => {
        let made = 0;
        while (made < quantity) {
          if (!(await watch.holdWhilePaused())) return cancelled("Production");
          const started = typeof args.stationId === "string"
            ? await sendGameCommand(api, "produceAt", args.stationId, recipeId, quantity - made)
            : await sendGameCommand(api, "produce", recipeId, quantity - made);
          if (!started.ok) {
            if (made > 0) return { made, wanted: quantity, complete: false, reason: started.error.code, message: started.error.message };
            return unwrap(started);
          }
          let running = true;
          while (running) {
            const outcome = await watch.next(["production.completed", "activity.stopped", "inventory.full", "player.died"], deadline);
            if (outcome.ended === "cancelled") return cancelled("Production");
            if (outcome.ended === "paused") { await sendGameCommand(api, "stop"); running = false; break; }
            if (outcome.ended === "timeout") { await sendGameCommand(api, "stop"); return { made, wanted: quantity, complete: false, reason: "timeout" }; }
            for (const event of outcome.events) {
              if (event.type === "production.completed" && event.data.recipeId === recipeId) {
                made += 1;
                session.setActivity(`Making ${recipeId}: ${made}/${quantity}`);
              } else if (event.type === "inventory.full") {
                return { made, wanted: quantity, complete: false, reason: "inventory-full" };
              } else if (event.type === "player.died") {
                return { made, wanted: quantity, complete: false, reason: "dead" };
              } else if (event.type === "activity.stopped" && event.data.kind === "production") {
                const reason = String(event.data.reason ?? "stopped");
                if (reason === "cancelled") return cancelled("Production");
                if (made >= quantity || reason === "complete" || reason === "finished") { running = false; break; }
                return { made, wanted: quantity, complete: false, reason };
              }
            }
            if (made >= quantity) running = false;
          }
        }
        return { made, wanted: quantity, complete: true, reason: "complete" };
      });
    }),

    defineTool(TOOL_SPECS.corealm_wait, async (args, context) => {
      const types = Array.isArray(args.events) ? (args.events as GameEventType[]) : [];
      const wantIdle = args.idle === true;
      const healthAtLeast = asNumber(args.healthAtLeast, 0);
      const wantAlive = args.respawned === true;
      if (types.length === 0 && !wantIdle && healthAtLeast <= 0 && !wantAlive) {
        return failure("INVALID_ARGUMENT", "Give at least one of events, idle, healthAtLeast, respawned");
      }
      const deadline = performance.now() + Math.min(120_000, asNumber(args.timeoutMs, 60_000));
      const controller = new AbortController();
      context.signal?.addEventListener("abort", () => controller.abort(), { once: true });
      const watch = new Watch(api, session, controller.signal);
      const check = (): Record<string, unknown> | null => {
        const player = api.getPlayer();
        if (wantAlive && !player.dead) return { met: "respawned", player };
        if (wantIdle && !player.moving && !player.activityKind && !player.inCombat && !player.dead) return { met: "idle", player };
        if (healthAtLeast > 0 && player.health / Math.max(1, player.maxHealth) >= healthAtLeast) return { met: "healthAtLeast", player };
        return null;
      };
      const immediate = check();
      if (immediate) return { ...immediate, events: [], nextSeq: watch.cursor };
      // Poll the world for the state conditions between event slices; a state that changes
      // without an event (health regen) is caught within one slice.
      const stateTypes: GameEventType[] = ["navigation.completed", "navigation.failed", "activity.stopped", "combat.ended", "player.died", "health.low"];
      const filter = types.length > 0 ? types : (wantIdle || wantAlive ? stateTypes : []);
      while (true) {
        const outcome = await watch.next(filter, Math.min(deadline, performance.now() + SLICE_MS));
        if (outcome.ended === "cancelled") return cancelled("The wait");
        if (types.length > 0 && outcome.events.length > 0) return { met: "events", events: outcome.events, nextSeq: watch.cursor };
        const met = check();
        if (met) return { ...met, events: outcome.events, nextSeq: watch.cursor };
        if (performance.now() >= deadline) return { met: null, timedOut: true, events: [], nextSeq: watch.cursor, player: api.getPlayer() };
      }
    }),
  ];
}

/** Empties every loot container within `radius`. Shared by fight and loot_nearby. */
async function lootNearby(api: GameApi, watch: Watch, radius: number, deadline: number): Promise<Record<string, unknown>> {
  const taken: ItemStack[] = [];
  const left: { entityId: EntityId; remaining: ItemStack[] }[] = [];
  const visited = new Set<EntityId>();
  while (true) {
    if (!(await watch.holdWhilePaused())) return { taken, left, cancelled: true };
    const piles = api.observe({ archetypes: ["loot", "recovery_cache"], radius, limit: 10 })
      .filter((row) => !visited.has(row.id));
    const pile = piles[0];
    if (!pile) break;
    visited.add(pile.id);
    if (pile.interactions.includes("loot")) {
      const opened = await sendGameCommand(api, "interact", pile.id, "loot");
      if (!opened.ok) continue;
      if (opened.value.started.startsWith("walking")) {
        const arrived = await watch.next(["navigation.completed", "navigation.failed"], deadline);
        if (arrived.ended !== "event" || arrived.events.some((event) => event.type === "navigation.failed")) continue;
      }
    }
    const result = await sendGameCommand(api, "takeLoot", pile.id);
    if (result.ok) {
      taken.push(...result.value.taken);
      if (!result.value.containerEmpty) left.push({ entityId: pile.id, remaining: result.value.remaining });
    }
  }
  return { taken, left, freeSlots: api.getInventory().freeSlots };
}

/** Continues a running fight without re-issuing the attack. */
type FightEnd =
  | { event: GameEvent; hits: number; paused: false }
  | { event: null; hits: number; paused: true };

async function waitForCombatEnd(
  api: GameApi, watch: Watch, targetId: EntityId, deadline: number, retreatBelow: number,
): Promise<FightEnd | SessionError> {
  let hits = 0;
  let idleSlices = 0;
  const synthetic = (reason: string): FightEnd => ({
    event: { seq: watch.cursor, type: "combat.ended", atMs: api.getTime().simMs, entityId: targetId, data: { reason } },
    hits,
    paused: false,
  });
  const belowRetreat = (): boolean => {
    if (retreatBelow <= 0) return false;
    const player = api.getPlayer();
    return player.health / Math.max(1, player.maxHealth) < retreatBelow;
  };
  while (true) {
    // Sliced at one second so health is re-read even when no event names it.
    const outcome = await watch.next(
      ["combat.ended", "player.died", "health.low", "spell.launched", "navigation.failed"],
      Math.min(deadline, performance.now() + SLICE_MS),
    );
    if (outcome.ended === "cancelled") return cancelled("The fight");
    if (outcome.ended === "paused") return { event: null, hits, paused: true };
    for (const event of outcome.events) {
      if (event.type === "spell.launched") hits += 1;
      if (event.type === "player.died") return failure("DEAD", "The character died in the fight", { hits });
      if (event.type === "combat.ended" && event.entityId === targetId) return { event, hits, paused: false };
      if (event.type === "navigation.failed" && String(event.data.reason) === "unreachable") {
        return failure("NOT_REACHABLE", `${targetId} cannot be reached`, { hits });
      }
    }
    if (belowRetreat()) {
      await sendGameCommand(api, "stop");
      return synthetic("retreated");
    }
    // Two quiet slices in a row with no target, no engagement and no walk means the fight is
    // over without an event naming this target (a leash, a despawn). One slice is not enough:
    // a melee approach has a frame between arriving and engaging that looks exactly like this.
    const player = api.getPlayer();
    idleSlices = !player.inCombat && player.targetId === null && !player.moving ? idleSlices + 1 : 0;
    if (idleSlices >= 2) return synthetic("disengaged");
    if (performance.now() >= deadline) {
      await sendGameCommand(api, "stop");
      return failure("TIMEOUT", `The fight with ${targetId} did not end in time`, { hits });
    }
  }
}
