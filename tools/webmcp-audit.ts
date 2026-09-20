/**
 * End-to-end WebMCP gameplay audit.
 *
 * Every gameplay read and action goes through `document.modelContext`, exactly as a browser
 * agent would drive it. Playwright's Chromium has no WebMCP, so the harness injects the test
 * stand-in from `tools/lib/webmcp-polyfill.ts` before the page loads; the game reports it as
 * `binding: "polyfill"` and the report records that. The debug API is restricted to resetting a
 * deterministic fixture, accelerating the clock, and the two predeclared fixtures (boss kit,
 * one seed). Long progression scenarios do not grant XP, items, currency, movement, or quest state.
 *
 * Control is obtained the way a real session obtains it: the agent asks through
 * `corealm_session`, and the harness clicks Allow in the agent panel. Tools that act are refused
 * until then, and the first scenario proves it.
 *
 * Waits are event-driven or counted, never wall-clock: the sim runs at up to 100x, and a
 * `Date.now()` deadline against a scaled clock is the flake that used to live here.
 *
 * Usage:
 *   npx tsx tools/webmcp-audit.ts --run runs/corealm [--scenario mining-1-to-40] [--scale 100]
 */
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { startGameServer } from "./lib/server.js";
import { argValue, prepareRun, repoRoot, safeName } from "./lib/paths.js";
import { installTestDeadline } from "./lib/deadline.js";
import { WEBMCP_POLYFILL_SCRIPT } from "./lib/webmcp-polyfill.js";
import type {} from "./lib/debug-api.js";

type JsonObject = Record<string, unknown>;

interface McpEnvelope {
  content?: { type: string; text?: string }[];
  isError?: boolean;
}

interface AuditScenarioResult {
  id: string;
  title: string;
  passed: boolean;
  wallClockSeconds: number;
  toolCalls: number;
  toolsCovered: string[];
  summary: JsonObject;
  fixture: string[];
  screenshot: string | null;
  errors: string[];
}

interface WebMcpAuditReport {
  startedAt: string;
  scale: number;
  binding: JsonObject | null;
  advertisedTools: string[];
  coveredTools: string[];
  uncoveredTools: string[];
  scenarios: AuditScenarioResult[];
  passed: boolean;
}

interface ScenarioContext {
  page: Page;
  mcp: WebMcpClient;
  scale: number;
  fixture: string[];
}

interface ScenarioDef {
  id: string;
  title: string;
  /** False for scenarios that test the handoff itself and must start without control. */
  takeControl?: boolean;
  run(context: ScenarioContext): Promise<JsonObject>;
}

/** Tool failures that mean the CALL was wrong, not the world. These do not count as coverage. */
const SURFACE_ERRORS = new Set(["INVALID_ARGUMENT", "NOT_PERMITTED", "UNAVAILABLE", "PAUSED"]);

function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected an object, got ${JSON.stringify(value)}`);
  }
  return value as JsonObject;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Expected an array, got ${JSON.stringify(value)}`);
  return value;
}

function numberAt(value: unknown, key: string): number {
  const found = asObject(value)[key];
  if (typeof found !== "number") throw new Error(`Expected numeric ${key}, got ${JSON.stringify(found)}`);
  return found;
}

function errorCode(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  return typeof (value as JsonObject)["error"] === "string" ? String((value as JsonObject)["error"]) : null;
}

function expectOk<T>(value: T, label: string): T {
  const code = errorCode(value);
  if (code) throw new Error(`${label}: ${code}: ${String(asObject(value)["message"] ?? "")}`);
  return value;
}

function expectError(value: unknown, code: string, label: string): void {
  if (errorCode(value) !== code) throw new Error(`${label}: expected ${code}, got ${JSON.stringify(value)}`);
}

function countStacks(value: unknown, itemId: string): number {
  const rows = Array.isArray(value) ? value : [];
  let total = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const stack = row as JsonObject;
    if (stack["itemId"] === itemId && typeof stack["quantity"] === "number") total += stack["quantity"];
  }
  return total;
}

function inventoryCount(inventory: unknown, itemId: string): number {
  return countStacks(asObject(inventory)["slots"], itemId);
}

function bankCount(bank: unknown, itemId: string): number {
  return countStacks(asObject(bank)["slots"], itemId);
}

async function resetFixture(page: Page, scale: number, seed = 1337): Promise<void> {
  await page.evaluate(({ chosenSeed }) => {
    const debug = window.__gameDebug as unknown as {
      reset(options?: { seed?: number; keepSave?: boolean }): void;
    };
    debug.reset({ seed: chosenSeed, keepSave: false });
  }, { chosenSeed: seed });
  // Readiness is a state, not a delay: the reset is complete when the debug surface says so.
  await page.waitForFunction(() => window.__gameDebug?.getState().ready === true, undefined, { timeout: 30_000 });
  await page.evaluate(({ chosenScale }) => {
    const debug = window.__gameDebug as unknown as { setTimeScale(scale: number): void };
    debug.setTimeScale(chosenScale);
  }, { chosenScale: scale });
}

class WebMcpClient {
  calls = 0;
  cursor = 0;
  readonly covered = new Set<string>();

  constructor(readonly page: Page) {}

  /** One tool call through the container, returning the envelope the agent would see. */
  async raw(name: string, args: JsonObject = {}): Promise<McpEnvelope> {
    this.calls += 1;
    const envelope = await this.page.evaluate(async ({ toolName, toolArgs }) => {
      interface BrowserTool { name: string }
      interface BrowserContext {
        getTools(): Promise<BrowserTool[]> | BrowserTool[];
        executeTool(tool: BrowserTool, args: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
      }
      const context = (document as unknown as { modelContext?: BrowserContext }).modelContext;
      if (!context) throw new Error("document.modelContext is missing");
      const tools = await context.getTools();
      const tool = tools.find((candidate) => candidate.name === toolName);
      if (!tool) throw new Error(`WebMCP did not advertise ${toolName}`);
      const result = await context.executeTool(tool, toolArgs);
      // The draft returns the callback's result serialised; an implementation may hand back the
      // object instead. Either way the agent gets JSON.
      return typeof result === "string" ? JSON.parse(result) as unknown : result;
    }, { toolName: name, toolArgs: args });
    const parsed = envelope as McpEnvelope;
    const payload = this.payload(parsed, name);
    const code = errorCode(payload);
    if (!code || !SURFACE_ERRORS.has(code)) this.covered.add(name);
    return parsed;
  }

  private payload(envelope: McpEnvelope, name: string): unknown {
    const text = envelope.content?.find((block) => block.type === "text")?.text;
    if (text === undefined) throw new Error(`${name} returned no text content block: ${JSON.stringify(envelope)}`);
    return JSON.parse(text) as unknown;
  }

  async call<T = unknown>(name: string, args: JsonObject = {}): Promise<T> {
    return this.payload(await this.raw(name, args), name) as T;
  }

  async startCursor(): Promise<void> {
    const current = expectOk(await this.call("corealm_events", { sinceSeq: 0, timeoutMs: 0 }), "event cursor");
    this.cursor = numberAt(current, "nextSeq");
  }

  async wait(types: string[], timeoutMs = 30_000): Promise<JsonObject[]> {
    const result = expectOk(await this.call("corealm_events", {
      sinceSeq: this.cursor, types, timeoutMs,
    }), `wait for ${types.join(", ")}`);
    this.cursor = numberAt(result, "nextSeq");
    return asArray(asObject(result)["events"]).map(asObject);
  }

  /**
   * The handoff, the way a player does it: the agent asks, the panel shows the request, the
   * player clicks Allow. Proves the visible control path rather than a debug shortcut.
   */
  async takeControl(objective: string): Promise<void> {
    expectOk(await this.call("corealm_session", { op: "connect", agentName: "WebMCP audit" }), "connect");
    const asked = expectOk(await this.call("corealm_session", {
      op: "request_control", objective, timeoutMs: 0,
    }), "request control");
    if (asObject(asked)["status"] === "granted") return;
    const requestId = String(asObject(asked)["requestId"]);
    await this.page.click(".agent-panel__approval .btn--primary", { timeout: 10_000 });
    const settled = expectOk(await this.call("corealm_session", { op: "wait_approval", requestId, timeoutMs: 10_000 }), "wait approval");
    if (asObject(settled)["status"] !== "granted") throw new Error(`Control was not granted: ${JSON.stringify(settled)}`);
  }

  async navigate(target: { entityId?: string; locationId?: string; position?: number[] }): Promise<void> {
    expectOk(await this.call("corealm_navigate", { ...target, timeoutMs: 120_000 }), `navigate ${JSON.stringify(target)}`);
  }

  async interact(entityId: string, interaction: string): Promise<unknown> {
    const result = expectOk(await this.call("corealm_interact", { entityId, interaction }), `${interaction} ${entityId}`);
    if (!String(asObject(result)["started"] ?? "").startsWith("walking")) return result;
    const events = await this.wait(["navigation.completed", "navigation.failed", "player.died"], 60_000);
    const failed = events.find((event) => event["type"] !== "navigation.completed");
    if (failed) throw new Error(`Interaction approach failed: ${JSON.stringify(failed)}`);
    return result;
  }

  async talkChoose(npcId: string, suffixes: string[]): Promise<void> {
    // A conversation left open from an earlier exchange stays on its last node; start fresh.
    if (await this.call("corealm_dialogue", { op: "state" }) !== null) {
      await this.call("corealm_dialogue", { op: "end" });
    }
    await this.startCursor();
    await this.interact(npcId, "talk");
    // A routed talk opens the conversation on arrival, a tick after navigation.completed. Wait
    // for the opening rather than reading the state in the gap.
    let view = await this.call("corealm_dialogue", { op: "state" });
    if (errorCode(view) === "NO_DIALOGUE" || view === null) {
      await this.call("corealm_wait", { events: ["dialogue.opened"], timeoutMs: 5_000 });
      view = await this.call("corealm_dialogue", { op: "state" });
    }
    if (errorCode(view) === "NO_DIALOGUE" || view === null) {
      expectOk(await this.call("corealm_interact", { entityId: npcId, interaction: "talk" }), `talk ${npcId}`);
      await this.call("corealm_wait", { events: ["dialogue.opened"], timeoutMs: 5_000 });
      view = await this.call("corealm_dialogue", { op: "state" });
    }
    if (view === null) throw new Error(`Talking to ${npcId} opened no conversation`);
    expectOk(view, `dialogue ${npcId}`);
    for (const suffix of suffixes) {
      const current = expectOk(await this.call("corealm_dialogue", { op: "state" }), `dialogue state ${suffix}`);
      const options = asArray(asObject(current)["options"]).map(asObject);
      const option = options.find((row) => String(row["id"] ?? "").endsWith(`#${suffix}`) && row["enabled"] !== false);
      if (!option) throw new Error(`No enabled dialogue option ending #${suffix}: ${JSON.stringify(options)}`);
      expectOk(await this.call("corealm_dialogue", { op: "choose", optionId: option["id"] }), `choose ${suffix}`);
    }
    if (await this.call("corealm_dialogue", { op: "state" }) !== null) {
      await this.call("corealm_dialogue", { op: "end" });
    }
  }

  /** Blocks on the game's own idle condition. No clock on this side. */
  async waitForIdle(timeoutMs = 60_000): Promise<void> {
    const result = expectOk(await this.call("corealm_wait", { idle: true, timeoutMs }), "wait for idle");
    if (asObject(result)["timedOut"] === true) throw new Error("Activity did not stop before the deadline");
  }

  async craft(stationId: string, recipeId: string, quantity: number): Promise<number> {
    await this.navigate({ entityId: stationId });
    const result = expectOk(await this.call("corealm_craft", { stationId, recipeId, quantity }), `craft ${recipeId}`);
    return numberAt(result, "made");
  }

  async inspectResourceRows(itemId: string, archetype: string): Promise<JsonObject[]> {
    const observed = expectOk(await this.call("corealm_observe", {
      scope: "visible", archetypes: [archetype], requirementsMet: true, radius: 140, limit: 100,
    }), `observe ${archetype}`);
    const matches: JsonObject[] = [];
    for (const row of asArray(observed).map(asObject)) {
      const detail = expectOk(await this.call("corealm_inspect", { entityId: row["id"] }), `inspect ${row["id"]}`);
      if (asObject(asObject(detail)["resource"])["itemId"] === itemId) matches.push(row);
    }
    return matches;
  }

  /** Gathers `quantity` of one item into the bank, banking whenever the pack fills. */
  async gatherIntoBank(options: {
    itemId: string; quantity: number; locationId: string; archetype: string; interaction: string; bankId: string;
  }): Promise<number> {
    let stored = 0;
    let rounds = 0;
    while (stored < options.quantity && rounds++ < 30) {
      await this.navigate({ locationId: options.locationId });
      const nodes = (await this.inspectResourceRows(options.itemId, options.archetype)).filter((row) => row["state"] === "available");
      if (nodes.length === 0) {
        // Wait for a respawn through the event stream rather than sleeping.
        await this.call("corealm_wait", { events: ["resource.depleted", "activity.stopped"], timeoutMs: 5_000 });
        continue;
      }
      const gathered = expectOk(await this.call("corealm_gather", {
        interaction: options.interaction, entityId: nodes[0]!["id"],
        quantity: Math.min(28, options.quantity - stored), timeoutMs: 180_000,
      }), `gather ${options.itemId}`);
      const reason = String(asObject(gathered)["reason"]);
      if (reason !== "complete" && reason !== "inventory-full" && reason !== "node-unavailable" && numberAt(gathered, "received") === 0) {
        throw new Error(`Gathering ${options.itemId} stopped: ${JSON.stringify(gathered)}`);
      }
      await this.navigate({ entityId: options.bankId });
      expectOk(await this.call("corealm_bank", { op: "depositAll" }), "deposit gathered items");
      const bank = expectOk(await this.call("corealm_bank", { op: "list" }), "list bank");
      stored = bankCount(bank, options.itemId);
    }
    if (stored < options.quantity) throw new Error(`Only banked ${stored}/${options.quantity} ${options.itemId}`);
    return stored;
  }

  async fight(entityId: string, timeoutMs = 90_000, loot = true): Promise<JsonObject> {
    const result = asObject(expectOk(await this.call("corealm_fight", { entityId, loot, timeoutMs }), `fight ${entityId}`));
    if (result["outcome"] !== "killed") throw new Error(`Fight against ${entityId} ended: ${JSON.stringify(result)}`);
    return result;
  }
}

/** Finds living enemies of one family, waiting through the event stream for a respawn if none. */
async function findByFamily(mcp: WebMcpClient, family: string, attempts = 12): Promise<JsonObject[]> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const observed = expectOk(await mcp.call("corealm_observe", {
      scope: "visible", archetypes: ["enemy"], radius: 140, limit: 100,
    }), `observe ${family}`);
    const matches: JsonObject[] = [];
    for (const row of asArray(observed).map(asObject)) {
      if (row["state"] === "dead") continue;
      const detail = expectOk(await mcp.call("corealm_inspect", { entityId: row["id"] }), `inspect ${row["id"]}`);
      if (asObject(asObject(detail)["meta"])["family"] === family) matches.push(row);
    }
    if (matches.length > 0) return matches;
    await mcp.call("corealm_wait", { events: ["combat.ended", "entity.discovered"], timeoutMs: 3_000 });
  }
  throw new Error(`No living ${family} was visible after ${attempts} looks`);
}

// ---------------------------------------------------------------- scenarios

async function scenarioSurface({ page, mcp }: ScenarioContext): Promise<JsonObject> {
  const descriptors = await page.evaluate(async () => {
    const context = (document as unknown as { modelContext: { getTools(): Promise<unknown[]> | unknown[] } }).modelContext;
    return context.getTools();
  }) as JsonObject[];
  const listed = await page.evaluate(() => (
    window as unknown as { corealm: { agent: { listTools(): { name: string; access: string }[] } } }
  ).corealm.agent.listTools());
  const names = descriptors.map((row) => String(row["name"])).sort();
  const expected = listed.map((row) => row.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`WebMCP advertised ${names.length} tools but the surface lists ${expected.length}`);
  }
  if (new Set(names).size !== names.length) throw new Error("WebMCP advertised duplicate tool names");
  for (const row of descriptors) {
    const schema = asObject(row["inputSchema"]);
    const annotations = asObject(row["annotations"]);
    if (!row["title"] || !row["description"] || schema["type"] !== "object" || schema["additionalProperties"] !== false) {
      throw new Error(`Bad descriptor: ${JSON.stringify(row).slice(0, 300)}`);
    }
    if (typeof annotations["readOnlyHint"] !== "boolean") throw new Error(`${row["name"]} has no readOnlyHint`);
    const access = listed.find((tool) => tool.name === row["name"])?.access;
    if (access === "act" && annotations["readOnlyHint"] === true) throw new Error(`${row["name"]} acts but claims read-only`);
  }

  const playerEnvelope = await mcp.raw("corealm_player");
  if (playerEnvelope.isError || !playerEnvelope.content?.length) throw new Error(`Bad MCP success envelope: ${JSON.stringify(playerEnvelope)}`);
  const errorEnvelope = await mcp.raw("corealm_inspect", { entityId: "missing_audit_entity" });
  if (!errorEnvelope.isError) throw new Error(`Bad MCP error envelope: ${JSON.stringify(errorEnvelope)}`);
  expectError(await mcp.call("corealm_inspect", { entityId: "missing_audit_entity" }), "NOT_FOUND", "inspect missing");

  // Strict validation: wrong types, unknown fields, and bad enum values are rejected by name.
  expectError(await mcp.call("corealm_observe", { radius: "big" }), "INVALID_ARGUMENT", "radius type");
  expectError(await mcp.call("corealm_observe", { limit: 1000 }), "INVALID_ARGUMENT", "limit maximum");
  expectError(await mcp.call("corealm_events", { types: ["inventory.ful"] }), "INVALID_ARGUMENT", "event type enum");
  expectError(await mcp.call("corealm_player", { extra: 1 }), "INVALID_ARGUMENT", "unknown argument");
  expectError(await mcp.call("corealm_interact", { entityId: "x" }), "INVALID_ARGUMENT", "missing required");

  // Truncation reporting: an ancient cursor on a full ring says so.
  const batch = asObject(expectOk(await mcp.call("corealm_events", { sinceSeq: 0, timeoutMs: 0 }), "events from 0"));
  for (const key of ["oldestSeq", "dropped", "droppedCount"]) {
    if (!(key in batch)) throw new Error(`corealm_events lacks ${key}`);
  }

  const context = asObject(expectOk(await mcp.call("corealm_context"), "context"));
  for (const key of ["game", "revision", "session", "player", "skills", "inventory", "quests", "nearby", "events", "suggestedActions"]) {
    if (!(key in context)) throw new Error(`corealm_context lacks ${key}`);
  }
  const manual = asObject(expectOk(await mcp.call("corealm_manual", { topic: "all" }), "manual"));
  for (const key of ["overview", "modes", "control", "tools", "rules", "terminology", "events", "errors", "efficiency"]) {
    if (typeof manual[key] !== "string" || String(manual[key]).length < 100) throw new Error(`corealm_manual lacks ${key}`);
  }
  const docs = expectOk(await mcp.call("corealm_search_docs", { query: "Grithe ore", limit: 3 }), "search docs");
  const quests = asArray(expectOk(await mcp.call("corealm_quests"), "read quests")).map(asObject);
  const foreign = quests.filter((quest) => quest["status"] === "unstarted" && quest["regionId"] !== "fallowmarch");
  if (foreign.length > 0) throw new Error(`Journal leaks unvisited regions' quests: ${foreign.map((quest) => quest["id"]).join(", ")}`);
  return {
    toolCount: names.length, docsHits: asArray(docs).length, questsKnown: quests.length,
    suggestions: asArray(context["suggestedActions"]).length,
    readOnlyTools: descriptors.filter((row) => asObject(row["annotations"])["readOnlyHint"] === true).length,
  };
}

async function scenarioHandoff({ page, mcp }: ScenarioContext): Promise<JsonObject> {
  // Guide: reads work, acting and drawing do not.
  expectOk(await mcp.call("corealm_context", { sections: ["session"] }), "context in guide");
  expectError(await mcp.call("corealm_move_to", { locationId: "bracken_pit" }), "NOT_PERMITTED", "move in guide");
  expectError(await mcp.call("corealm_overlay", { op: "set", id: "x", kind: "marker", position: [0, 0, 0] }), "NOT_PERMITTED", "draw in guide");
  expectError(await mcp.call("corealm_session", { op: "set_mode", mode: "play" }), "APPROVAL_REQUIRED", "self-granted play");

  // Assist: drawing and proposing work, acting still does not.
  expectOk(await mcp.call("corealm_session", { op: "connect", agentName: "WebMCP audit" }), "connect");
  expectOk(await mcp.call("corealm_session", { op: "set_mode", mode: "assist" }), "assist mode");
  const route = asObject(expectOk(await mcp.call("corealm_route", { locationId: "bracken_pit", label: "Ore here" }), "route"));
  if (numberAt(route, "pathLength") <= 0 || route["drawn"] !== true) throw new Error(`Route not drawn: ${JSON.stringify(route)}`);
  const proposal = asObject(expectOk(await mcp.call("corealm_propose", {
    summary: "Mine six Grithe ore for Cold Iron",
    steps: [
      { text: "Walk to the Bracken Pit", locationId: "bracken_pit" },
      { text: "Mine six Grithe ore", tool: "corealm_gather" },
      { text: "Bank at Coldbrace", entityId: "coldbrace_bank" },
    ],
  }), "propose"));
  if (numberAt(proposal, "drawn") < 2) throw new Error(`Proposal markers not drawn: ${JSON.stringify(proposal)}`);
  const panelPlan = await page.locator(".agent-panel__steps li").count();
  if (panelPlan !== 3) throw new Error(`Panel shows ${panelPlan} plan steps, expected 3`);
  expectError(await mcp.call("corealm_navigate", { locationId: "bracken_pit" }), "NOT_PERMITTED", "navigate in assist");

  // Play: ask, the player denies, ask again, the player allows.
  const denied = asObject(expectOk(await mcp.call("corealm_session", { op: "request_control", objective: "Mine ore", timeoutMs: 0 }), "ask"));
  if (denied["status"] !== "pending") throw new Error(`Expected a pending request: ${JSON.stringify(denied)}`);
  await page.click(".agent-panel__approval .btn:not(.btn--primary)");
  const afterDeny = asObject(expectOk(await mcp.call("corealm_session", { op: "wait_approval", requestId: String(denied["requestId"]), timeoutMs: 5_000 }), "denied"));
  if (afterDeny["status"] !== "denied") throw new Error(`Expected denied: ${JSON.stringify(afterDeny)}`);
  await mcp.takeControl("Mine ore at the Bracken Pit");
  const session = asObject(expectOk(await mcp.call("corealm_session", { op: "read" }), "session"));
  if (session["mode"] !== "play" || session["controlOwner"] !== "agent") throw new Error(`Handoff failed: ${JSON.stringify(session)}`);
  const controlText = await page.locator(".agent-panel").textContent();
  if (!controlText?.includes("Agent is playing")) throw new Error("Panel does not show the agent in control");

  // A running operation, cut short by the player's Stop and its task event.
  await mcp.startCursor();
  const walk = mcp.call("corealm_navigate", { locationId: "palewood_copse", timeoutMs: 120_000 });
  await mcp.wait(["navigation.started", "agent.task"], 10_000);
  await page.click(".agent-panel .btn--danger");
  const stopped = asObject(await walk);
  if (errorCode(stopped) !== "CANCELLED") throw new Error(`Stop did not cancel the walk: ${JSON.stringify(stopped)}`);
  const after = asObject(expectOk(await mcp.call("corealm_session", { op: "read" }), "session after stop"));
  if (after["controlOwner"] !== "player" || after["mode"] !== "assist") throw new Error(`Stop did not hand back: ${JSON.stringify(after)}`);
  expectError(await mcp.call("corealm_navigate", { locationId: "bracken_pit" }), "NOT_PERMITTED", "navigate after stop");

  // Pause parks an operation; resume lets it finish.
  await mcp.takeControl("Walk to the pit");
  await mcp.startCursor();
  const paused = mcp.call("corealm_navigate", { locationId: "bracken_pit", timeoutMs: 120_000 });
  await mcp.wait(["navigation.started"], 10_000);
  await page.click(".agent-panel__actions .btn:has-text('Pause')");
  const pausedSession = asObject(expectOk(await mcp.call("corealm_session", { op: "read" }), "paused session"));
  if (pausedSession["paused"] !== true) throw new Error("Pause did not register");
  expectError(await mcp.call("corealm_move_to", { locationId: "bracken_pit" }), "PAUSED", "move while paused");
  await page.click(".agent-panel__actions .btn:has-text('Resume')");
  const arrived = asObject(await paused);
  if (arrived["arrived"] !== true) throw new Error(`Resumed walk did not arrive: ${JSON.stringify(arrived)}`);
  expectOk(await mcp.call("corealm_session", { op: "release_control" }), "release");
  const released = asObject(expectOk(await mcp.call("corealm_session", { op: "read" }), "released session"));
  if (released["controlOwner"] !== "player") throw new Error("Release did not hand back");
  return { deniedThenGranted: true, stopCancelled: true, pauseResumed: true, releasedMode: released["mode"] };
}

async function scenarioColdIron({ mcp }: ScenarioContext): Promise<JsonObject> {
  await mcp.talkChoose("npc_smith_harrow", ["offer", "accept"]);
  const quests = asArray(expectOk(await mcp.call("corealm_quests"), "read quests")).map(asObject);
  const accepted = quests.find((row) => row["id"] === "cold_iron");
  if (accepted?.["status"] !== "active") throw new Error(`Cold Iron was not accepted: ${JSON.stringify(accepted)}`);
  expectOk(await mcp.call("corealm_search_docs", { query: "Grithe Dagger recipe", limit: 3 }), "find dagger recipe");
  await mcp.gatherIntoBank({ itemId: "grithe_ore", quantity: 6, locationId: "bracken_pit", archetype: "ore", interaction: "mine", bankId: "coldbrace_bank" });
  await mcp.gatherIntoBank({ itemId: "march_stone", quantity: 2, locationId: "bracken_pit", archetype: "ore", interaction: "mine", bankId: "coldbrace_bank" });
  await mcp.gatherIntoBank({ itemId: "palewood_log", quantity: 1, locationId: "palewood_copse", archetype: "tree", interaction: "chop", bankId: "coldbrace_bank" });
  for (const [itemId, quantity] of [["grithe_ore", 2], ["march_stone", 2], ["palewood_log", 1]] as const) {
    expectOk(await mcp.call("corealm_bank", { op: "withdraw", itemId, quantity }), `withdraw ${itemId}`);
  }
  await mcp.craft("coldbrace_fletching", "fletch_palewood_handle", 1);
  await mcp.craft("coldbrace_furnace", "smelt_grithe_bar", 2);
  await mcp.craft("coldbrace_anvil", "smith_grithe_dagger", 1);
  expectOk(await mcp.call("corealm_equip", { itemId: "grithe_dagger" }), "equip quest dagger");
  const route = asObject(expectOk(await mcp.call("corealm_follow_route", {
    waypoints: [{ entityId: "coldbrace_bank" }, { locationId: "redsill_shallows" }],
  }), "route to the shallows"));
  if (route["completed"] !== true) throw new Error(`Route incomplete: ${JSON.stringify(route)}`);
  // The quest says what to kill; read it from the journal's refs the way an agent would.
  const stage = asArray(expectOk(await mcp.call("corealm_quests"), "read kill stage")).map(asObject).find((row) => row["id"] === "cold_iron");
  const familyRef = asArray(asObject(stage)["currentObjectiveRefs"]).map(asObject).find((ref) => ref["kind"] === "enemyFamily");
  if (!familyRef) throw new Error(`Cold Iron stage has no enemyFamily ref: ${JSON.stringify(stage)}`);
  const family = String(familyRef["id"]);
  let kills = 0;
  while (kills < 3) {
    const targets = await findByFamily(mcp, family);
    await mcp.fight(String(targets[0]!["id"]));
    kills += 1;
  }
  // The stage advances on the quest system's next evaluation; wait for it rather than racing it.
  const advanced = await mcp.call("corealm_wait", { events: ["quest.updated"], timeoutMs: 5_000 });
  const beforeTurnIn = asArray(expectOk(await mcp.call("corealm_quests"), "read quests")).map(asObject).find((row) => row["id"] === "cold_iron");
  if (numberAt(beforeTurnIn, "stage") !== 4) {
    throw new Error(`Cold Iron did not reach the turn-in stage after ${kills} kills: ${JSON.stringify(beforeTurnIn)} (${JSON.stringify(advanced)})`);
  }
  await mcp.talkChoose("npc_smith_harrow", ["done"]);
  const final = asArray(expectOk(await mcp.call("corealm_quests"), "read quests")).map(asObject);
  const quest = final.find((row) => row["id"] === "cold_iron");
  if (quest?.["status"] !== "complete") throw new Error(`Cold Iron did not complete: ${JSON.stringify(quest)}`);
  return { status: quest["status"], stage: quest["stage"], kills, family };
}

async function scenarioMining40({ mcp }: ScenarioContext): Promise<JsonObject> {
  const bands = [
    { maxLevel: 5, locationId: "bracken_pit", interaction: "mine", bankId: "coldbrace_bank" },
    { maxLevel: 40, locationId: "hollowcut_seam", interaction: "mine", bankId: "rootfall_bank_chest" },
  ];
  let bankTrips = 0;
  let sessions = 0;
  let currentLocation = "";
  let guard = 0;
  while (guard++ < 400) {
    const skills = expectOk(await mcp.call("corealm_skills"), "read mining level");
    const level = numberAt(asObject(skills)["mining"], "level");
    if (level >= 40) break;
    const band = bands.find((candidate) => level < candidate.maxLevel) ?? bands[1]!;
    const inventory = expectOk(await mcp.call("corealm_inventory"), "read mining inventory");
    const free = numberAt(inventory, "freeSlots");
    if (free <= 1) {
      await mcp.navigate({ entityId: band.bankId });
      expectOk(await mcp.call("corealm_bank", { op: "depositAll" }), "deposit ore");
      bankTrips += 1;
      currentLocation = "";
      continue;
    }
    if (currentLocation !== band.locationId) {
      await mcp.navigate({ locationId: band.locationId });
      currentLocation = band.locationId;
    }
    const gathered = asObject(expectOk(await mcp.call("corealm_gather", {
      interaction: band.interaction, quantity: free, radius: 140, timeoutMs: 240_000,
    }), "gather ore"));
    sessions += 1;
    if (gathered["reason"] === "no-node") await mcp.call("corealm_wait", { events: ["resource.depleted"], timeoutMs: 5_000 });
  }
  const skills = expectOk(await mcp.call("corealm_skills"), "final mining skills");
  const mining = asObject(asObject(skills)["mining"]);
  if (numberAt(mining, "level") < 40) throw new Error(`Mining stopped at ${JSON.stringify(mining)}`);
  expectOk(await mcp.call("corealm_stop"), "stop after target level");
  return {
    miningLevel: mining["level"], miningXp: mining["xp"], bankTrips, gatherSessions: sessions,
    strategy: "Grithe to level 5, then the short Rootfall-to-Hollowcut Corven route",
  };
}

async function scenarioArmour({ mcp }: ScenarioContext): Promise<JsonObject> {
  await mcp.gatherIntoBank({ itemId: "grithe_ore", quantity: 10, locationId: "bracken_pit", archetype: "ore", interaction: "mine", bankId: "coldbrace_bank" });
  await mcp.gatherIntoBank({ itemId: "march_stone", quantity: 10, locationId: "bracken_pit", archetype: "ore", interaction: "mine", bankId: "coldbrace_bank" });
  for (const itemId of ["grithe_ore", "march_stone"]) {
    expectOk(await mcp.call("corealm_bank", { op: "withdraw", itemId, quantity: 10 }), `withdraw ${itemId}`);
  }
  const bars = await mcp.craft("coldbrace_furnace", "smelt_grithe_bar", 10);
  if (bars < 10) throw new Error(`Smelted only ${bars} bars`);
  const recipes = [
    ["smith_grithe_helm", "grithe_helm"], ["smith_grithe_cuirass", "grithe_cuirass"], ["smith_grithe_greaves", "grithe_greaves"],
    ["smith_grithe_boots", "grithe_boots"], ["smith_grithe_gloves", "grithe_gloves"],
  ] as const;
  for (const [recipeId] of recipes) await mcp.craft("coldbrace_anvil", recipeId, 1);
  for (const [, itemId] of recipes) expectOk(await mcp.call("corealm_equip", { itemId }), `equip ${itemId}`);
  const inventory = expectOk(await mcp.call("corealm_inventory"), "read equipped armour");
  const slots = asObject(asObject(asObject(inventory)["equipment"])["slots"]);
  const worn = ["head", "body", "legs", "feet", "hands"].map((slot) => asObject(slots[slot])["itemId"]);
  const expected = recipes.map(([, itemId]) => itemId);
  if (JSON.stringify(worn) !== JSON.stringify(expected)) throw new Error(`Wrong armour set: ${JSON.stringify(worn)}`);
  return { worn, smithingLevel: asObject(asObject(await mcp.call("corealm_skills"))["smithing"])["level"] };
}

async function scenarioBossCamp({ page, mcp, fixture }: ScenarioContext): Promise<JsonObject> {
  fixture.push("Melee 40, a Kaldite combat kit, and food are installed before the boss loop; no loot or boss state is granted.");
  await page.evaluate(() => {
    const debug = window.__gameDebug as unknown as {
      clearInventory(): void;
      setSkillLevel(skill: string, level: number): void;
      giveItem(itemId: string, quantity: number, to: "inventory" | "bank"): void;
    };
    debug.clearInventory();
    debug.setSkillLevel("melee", 40);
    for (const itemId of ["kaldite_sword", "cairnpine_shield", "kaldite_helm", "kaldite_plate", "kaldite_greaves", "kaldite_boots", "kaldite_gauntlets"]) {
      debug.giveItem(itemId, 1, "inventory");
    }
    debug.giveItem("seared_cragfin", 20, "inventory");
  });
  for (const itemId of ["kaldite_sword", "cairnpine_shield", "kaldite_helm", "kaldite_plate", "kaldite_greaves", "kaldite_boots", "kaldite_gauntlets"]) {
    expectOk(await mcp.call("corealm_equip", { itemId }), `equip boss fixture ${itemId}`);
  }
  // The drop is a roll, so the loop is bounded by kills and the report says how many it took.
  // Eight kills at the authored rate leaves the miss probability under one in a thousand.
  let kills = 0;
  while (kills < 8) {
    await mcp.navigate({ entityId: "tempest_roc" });
    const fight = await mcp.fight("tempest_roc", 120_000, false);
    kills += 1;
    // The explicit two-step loot path first (open, then take one stack), then the sweep.
    const piles = asArray(expectOk(await mcp.call("corealm_observe", { archetypes: ["loot"], radius: 40, limit: 5 }), "observe boss loot")).map(asObject);
    if (piles[0]) {
      await mcp.interact(String(piles[0]["id"]), "loot");
      expectOk(await mcp.call("corealm_take_loot", { entityId: piles[0]["id"], stackIndex: 0 }), "take one stack");
    }
    expectOk(await mcp.call("corealm_loot_nearby", { radius: 40 }), "sweep boss loot");
    const inventory = expectOk(await mcp.call("corealm_inventory"), "read boss drops");
    if (inventoryCount(inventory, "pale_quartz") > 0) {
      return { boss: "tempest_roc", wantedItem: "pale_quartz", kills, quantity: inventoryCount(inventory, "pale_quartz"), lastFightHits: fight["hits"] };
    }
    // Respawn is announced by the world, not by a sleep.
    await mcp.call("corealm_wait", { events: ["entity.discovered", "combat.started"], timeoutMs: 20_000 });
  }
  throw new Error("Tempest Roc did not drop pale_quartz in eight kills");
}

async function scenarioFishCookBank({ mcp }: ScenarioContext): Promise<JsonObject> {
  await mcp.navigate({ locationId: "redsill_shallows" });
  const caught = numberAt(expectOk(await mcp.call("corealm_gather", { interaction: "fish", quantity: 6, timeoutMs: 120_000 }), "fish"), "received");
  if (caught < 1) throw new Error("Fishing produced no Silt Minnow");
  const cooked = await mcp.craft("coldbrace_range", "cook_seared_minnow", caught);
  await mcp.navigate({ entityId: "coldbrace_bank" });
  expectOk(await mcp.call("corealm_bank", { op: "depositAll" }), "bank cooked catch");
  const bank = expectOk(await mcp.call("corealm_bank", { op: "list" }), "read cooked bank");
  const seared = bankCount(bank, "seared_minnow");
  const burnt = bankCount(bank, "burnt_minnow");
  if (seared + burnt < caught) throw new Error(`Cooked output mismatch: caught ${caught}, banked ${seared + burnt}`);
  return { caught, cooked, seared, burnt, banked: seared + burnt };
}

async function scenarioWoodcutFletch({ mcp }: ScenarioContext): Promise<JsonObject> {
  await mcp.navigate({ locationId: "palewood_copse" });
  const logs = numberAt(expectOk(await mcp.call("corealm_gather", { interaction: "chop", quantity: 3, timeoutMs: 120_000 }), "chop"), "received");
  if (logs < 2) throw new Error(`Woodcutting produced only ${logs} log(s); the fire and staff need two`);
  expectOk(await mcp.call("corealm_build_campfire", { logItemId: "palewood_log" }), "build Palewood campfire");
  await mcp.waitForIdle();
  // The primitive production path once (start, then wait), then the bounded one.
  await mcp.navigate({ entityId: "coldbrace_fletching" });
  expectOk(await mcp.call("corealm_produce", { stationId: "coldbrace_fletching", recipeId: "fletch_palewood_shaft", quantity: 1 }), "produce shaft");
  await mcp.waitForIdle();
  await mcp.craft("coldbrace_fletching", "fletch_palewood_staff", 1);
  expectOk(await mcp.call("corealm_equip", { itemId: "palewood_staff" }), "equip Palewood Staff");
  const inventory = expectOk(await mcp.call("corealm_inventory"), "read equipped staff");
  const mainHand = asObject(asObject(asObject(inventory)["equipment"])["slots"])["mainHand"];
  if (asObject(mainHand)["itemId"] !== "palewood_staff") throw new Error(`Staff was not equipped: ${JSON.stringify(mainHand)}`);
  const spellbook = expectOk(await mcp.call("corealm_spellbook", { op: "read" }), "read staff spellbook");
  return { logs, weapon: "palewood_staff", activeSpellId: asObject(spellbook)["activeSpellId"], chargedMagicWeapon: asObject(spellbook)["equippedWeapon"] !== null };
}

async function scenarioShop({ page, mcp }: ScenarioContext): Promise<JsonObject> {
  await mcp.navigate({ entityId: "coldbrace_general" });
  const stock = expectOk(await mcp.call("corealm_shop", { op: "list", shopId: "coldbrace_general" }), "list shop");
  // The first sale needs the player's approval; the harness pre-approves trades from the panel,
  // as a player who trusts the agent would, and the rest go through.
  const firstSale = mcp.call("corealm_shop", { op: "sell", shopId: "coldbrace_general", itemId: "worn_sword", quantity: 1, approvalTimeoutMs: 20_000 });
  await page.locator(".agent-panel__approval").waitFor({ state: "visible", timeout: 10_000 });
  await page.click(".agent-panel__always input");
  expectOk(await firstSale, "sell starter sword");
  expectOk(await mcp.call("corealm_shop", { op: "sell", shopId: "coldbrace_general", itemId: "worn_hatchet", quantity: 1 }), "sell starter hatchet");
  expectOk(await mcp.call("corealm_shop", { op: "sell", shopId: "coldbrace_general", itemId: "worn_pickaxe", quantity: 1 }), "sell starter pickaxe");
  const afterSale = expectOk(await mcp.call("corealm_inventory"), "currency after sale");
  const gold = numberAt(afterSale, "currency");
  if (gold < 9) throw new Error(`Selling starter gear paid only ${gold} gold`);
  const essenceBefore = inventoryCount(afterSale, "air_essence");
  expectOk(await mcp.call("corealm_shop", { op: "buy", shopId: "coldbrace_general", itemId: "air_essence", quantity: 1 }), "buy Air Essence");
  const bought = expectOk(await mcp.call("corealm_inventory"), "inventory after purchase");
  if (inventoryCount(bought, "air_essence") !== essenceBefore + 1) throw new Error("Bought essence did not reach inventory");
  return { stockRows: asArray(asObject(stock)["stock"]).length, goldAfterSale: gold, bought: "air_essence" };
}

async function scenarioMagicStop({ mcp }: ScenarioContext): Promise<JsonObject> {
  const spellbook = expectOk(await mcp.call("corealm_spellbook", { op: "read" }), "read spellbook");
  expectOk(await mcp.call("corealm_spellbook", { op: "select", spellId: "voltrend" }), "select Voltrend");
  await mcp.startCursor();
  expectOk(await mcp.call("corealm_move_to", { locationId: "palewood_copse" }), "start long route");
  await mcp.wait(["navigation.started"], 10_000);
  const stopped = expectOk(await mcp.call("corealm_stop"), "stop navigation");
  if (!asArray(asObject(stopped)["stopped"]).includes("navigation")) throw new Error(`Stop missed navigation: ${JSON.stringify(stopped)}`);
  await mcp.navigate({ locationId: "redsill_shallows" });
  const targets = await findByFamily(mcp, "frog");
  const targetId = String(targets[0]!["id"]);
  expectOk(await mcp.call("corealm_overlay", { op: "set", id: "magic_target", kind: "highlight", entityId: targetId }), "highlight target");
  await mcp.startCursor();
  expectOk(await mcp.call("corealm_attack", { entityId: targetId, spellId: "voltrend" }), "cast Voltrend");
  const events = await mcp.wait(["spell.launched", "combat.ended", "player.died"], 60_000);
  if (!events.some((event) => event["type"] === "spell.launched")) throw new Error(`No spell launch event: ${JSON.stringify(events)}`);
  const player = expectOk(await mcp.call("corealm_player"), "read player after cast");
  if (asObject(player)["dead"] === true) throw new Error("Player died in magic scenario");
  expectOk(await mcp.call("corealm_stop"), "disengage");
  expectOk(await mcp.call("corealm_overlay", { op: "clear", id: "magic_target" }), "clear target highlight");
  return { selected: "voltrend", activeBefore: asObject(spellbook)["activeSpellId"], spellEvents: events.filter((event) => event["type"] === "spell.launched").length };
}

export const WEBMCP_SCENARIOS: readonly ScenarioDef[] = [
  { id: "surface-contract", title: "WebMCP descriptors, envelopes, validation, context, manual, and journal parity", takeControl: false, run: scenarioSurface },
  { id: "collaboration-handoff", title: "Guide, assist, and play: deny, allow, stop, pause, resume, release", takeControl: false, run: scenarioHandoff },
  { id: "cold-iron-quest", title: "Complete Cold Iron from its opening dialogue", run: scenarioColdIron },
  { id: "mining-1-to-40", title: "Train Mining from 1 to 40 on the fastest bank route", run: scenarioMining40 },
  { id: "grithe-armour-from-scratch", title: "Mine, smelt, smith, and equip a five-piece armour set", run: scenarioArmour },
  { id: "tempest-roc-loot-camp", title: "Camp the Tempest Roc until Pale Quartz drops", run: scenarioBossCamp },
  { id: "fish-cook-bank", title: "Fish, cook the catch, and bank every result", run: scenarioFishCookBank },
  { id: "woodcut-fletch-equip", title: "Cut Palewood, fletch a staff, and equip it", run: scenarioWoodcutFletch },
  { id: "shop-buy-sell", title: "Sell starter gear and buy stock through a real shop, with trade approval", run: scenarioShop },
  { id: "magic-combat-stop-overlay", title: "Cancel navigation, choose a spell, cast, and explain the target", run: scenarioMagicStop },
] as const;

async function advertisedTools(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const context = (document as unknown as { modelContext: { getTools(): Promise<{ name: string }[]> | { name: string }[] } }).modelContext;
    return (await context.getTools()).map((tool) => tool.name).sort();
  });
}

export async function runWebMcpAudit(
  runCandidate: string,
  requestedScenario: string | undefined,
  scale: number,
): Promise<WebMcpAuditReport> {
  const runDir = await prepareRun(runCandidate);
  const selected = requestedScenario
    ? WEBMCP_SCENARIOS.filter((scenario) => scenario.id === requestedScenario)
    : [...WEBMCP_SCENARIOS];
  if (selected.length === 0) throw new Error(`Unknown scenario ${requestedScenario}. Use: ${WEBMCP_SCENARIOS.map((row) => row.id).join(", ")}`);
  const server = await startGameServer();
  const report: WebMcpAuditReport = {
    startedAt: new Date().toISOString(), scale, binding: null, advertisedTools: [], coveredTools: [],
    uncoveredTools: [], scenarios: [], passed: false,
  };
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist",
        "--disable-frame-rate-limit", "--disable-gpu-vsync", "--mute-audio",
      ],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.setDefaultTimeout(60_000);
    // The stand-in must exist before the game's adapter looks for it.
    await page.addInitScript(WEBMCP_POLYFILL_SCRIPT);
    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(String(error).slice(0, 400)));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text().slice(0, 400));
    });
    await page.goto(server.url, { waitUntil: "load", timeout: 60_000 });
    await page.waitForFunction(() => window.__gameDebug?.getState().ready === true, undefined, { timeout: 90_000 });
    report.binding = await page.evaluate(() => (
      window as unknown as { corealm: { agent: { webmcp(): Record<string, unknown> } } }
    ).corealm.agent.webmcp()) as JsonObject;
    if (report.binding["binding"] !== "polyfill" || report.binding["native"] !== false) {
      throw new Error(`The adapter did not recognise the injected stand-in: ${JSON.stringify(report.binding)}`);
    }
    report.advertisedTools = await advertisedTools(page);

    const allCovered = new Set<string>();
    for (const scenario of selected) {
      await resetFixture(page, scale);
      // Errors logged between scenarios (during the reset) belong to nobody, not to the next one.
      browserErrors.length = 0;
      const mcp = new WebMcpClient(page);
      await mcp.startCursor();
      const fixture: string[] = [];
      const startedAt = Date.now();
      const errors: string[] = [];
      let summary: JsonObject = {};
      let screenshot: string | null = null;
      try {
        if (scenario.takeControl !== false) await mcp.takeControl(scenario.title);
        summary = await scenario.run({ page, mcp, scale, fixture });
        const screenshotFile = path.join(runDir, "screenshots", `webmcp-${safeName(scenario.id)}.png`);
        await page.screenshot({ path: screenshotFile, fullPage: false });
        screenshot = path.relative(repoRoot, screenshotFile).replaceAll("\\", "/");
      } catch (cause) {
        errors.push(cause instanceof Error ? cause.message : String(cause));
      }
      // Leave the session clean for the next scenario whatever happened in this one.
      await mcp.call("corealm_session", { op: "disconnect" }).catch(() => undefined);
      errors.push(...browserErrors.splice(0, browserErrors.length));
      for (const tool of mcp.covered) allCovered.add(tool);
      report.scenarios.push({
        id: scenario.id,
        title: scenario.title,
        passed: errors.length === 0,
        wallClockSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
        toolCalls: mcp.calls,
        toolsCovered: [...mcp.covered].sort(),
        summary,
        fixture,
        screenshot,
        errors,
      });
    }
    report.coveredTools = [...allCovered].sort();
    report.uncoveredTools = report.advertisedTools.filter((tool) => !allCovered.has(tool));
    report.passed = report.scenarios.every((scenario) => scenario.passed)
      && (requestedScenario !== undefined || report.uncoveredTools.length === 0);
  } finally {
    await browser?.close().catch(() => undefined);
    await server.close();
  }
  const suffix = requestedScenario ? `-${safeName(requestedScenario)}` : "";
  await writeFile(
    path.join(runDir, "test-results", `webmcp-audit${suffix}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  return report;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runCandidate = argValue(args, "--run");
  if (!runCandidate) throw new Error("Usage: npx tsx tools/webmcp-audit.ts --run runs/<id> [--scenario id] [--scale 100]");
  const requestedScenario = argValue(args, "--scenario");
  const parsedScale = Number(argValue(args, "--scale") ?? 100);
  const scale = Number.isFinite(parsedScale) ? Math.max(1, Math.min(100, parsedScale)) : 100;
  const report = await runWebMcpAudit(runCandidate, requestedScenario, scale);
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  // Eleven scenarios, one of them a 1-to-40 skill climb, do not fit the shared 270 s ceiling
  // even at 100x; a single-scenario run still does.
  const clearDeadline = installTestDeadline("WebMCP audit", argValue(process.argv.slice(2), "--scenario") ? undefined : 600_000);
  try {
    await main();
  } finally {
    clearDeadline();
  }
}
