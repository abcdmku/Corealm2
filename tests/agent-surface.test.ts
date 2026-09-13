/**
 * The agent surface's own contract: strict validation, session gating, the handoff, event
 * truncation reporting, the manual's catalogues, and the context tool's shape. Everything here
 * runs against a mocked `GameApi` so it exercises the agent layer and nothing beneath it.
 */
import { describe, expect, it, vi } from "vitest";
import type { GameApi, GameEventType, GameEventPayloads } from "../game/src/contracts.js";
import { GAME_ERROR_CODES, GAME_EVENT_TYPES, ok, err } from "../game/src/contracts.js";
import { EventBus } from "../game/src/core/events.js";
import { AgentSession } from "../game/src/agent/session.js";
import { createTools, invokeTool, toolTable, type ToolDef } from "../game/src/agent/tools.js";
import { validateAgainst } from "../game/src/agent/schema.js";
import { ERROR_CATALOGUE, EVENT_CATALOGUE } from "../game/src/agent/manual.js";
import { registerWebMcp, toMcpResult } from "../game/src/agent/webmcp.js";

interface Emitted { type: GameEventType; data: Record<string, unknown> }

function makeSession(overrides: { stopWorld?: () => void } = {}): { session: AgentSession; emitted: Emitted[]; owners: string[]; clock: { now: number } } {
  const emitted: Emitted[] = [];
  const owners: string[] = [];
  const clock = { now: 0 };
  const session = new AgentSession({
    now: () => clock.now,
    emit: <T extends GameEventType>(type: T, data: GameEventPayloads[T]) => { emitted.push({ type, data: data as Record<string, unknown> }); },
    stopWorld: overrides.stopWorld ?? (() => {}),
    onControlOwnerChanged: (owner) => { owners.push(owner); },
  });
  return { session, emitted, owners, clock };
}

function stubBrowser(document: unknown): void {
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", {});
}

/** A GameApi that answers the reads the context tool makes and records every write. */
function mockApi(): GameApi & { calls: string[] } {
  const calls: string[] = [];
  const bus = new EventBus();
  const record = (name: string) => { calls.push(name); };
  const api = {
    calls,
    getPlayer: () => ({
      position: [0, 0, 0], regionId: "fallowmarch", health: 23, maxHealth: 23, facingRad: 0, inCombat: false,
      regenBlocked: false, targetId: null, engagedBy: [], dead: false, moving: false, activityKind: null, combatLevelEstimate: 1,
    }),
    getSkills: () => ({ mining: { level: 1, xp: 0, xpToNext: 83 } }),
    getInventory: () => ({ slots: [{ itemId: "worn_pickaxe", quantity: 1, slotIndex: 0 }, ...new Array(27).fill(null)], freeSlots: 27 }),
    getEquipment: () => ({ slots: { mainHand: null }, totals: { meleeAccuracy: 0, meleePower: 0,  magicAccuracy: 0, magicPower: 0, defence: 0, health: 0 , vitality: 0 } }),
    getActivity: () => null,
    getQuests: () => [{ id: "cold_iron", name: "Cold Iron", regionId: "fallowmarch", status: "unstarted", stage: 0, stageCount: 4, currentObjective: null, currentObjectiveRefs: [], requirements: {} }],
    getCurrency: () => 0,
    getTime: () => ({ simMs: 0, tick: 0, timeScale: 1, paused: false }),
    getRevision: () => ({ revision: 3, eventSeq: bus.currentSeq(), simMs: 0, tick: 0 }),
    getSpellbook: () => ({ spells: [], preferredSpellId: null, activeSpellId: null, magicLevel: 1, equippedWeapon: null, essence: { wind: 0, earth: 0, water: 0, fire: 0 }, releasedElements: [], runes: [], castLock: null }),
    observe: () => [],
    inspect: (id: string) => err("NOT_FOUND", `No entity with id ${id}`, id),
    searchDocs: async () => [],
    moveTo: () => { record("moveTo"); return ok({ pathLength: 10, etaMs: 2400 }); },
    planPath: () => ok({ points: [[0, 0, 0], [10, 0, 0]], pathLength: 10, etaMs: 2400, legs: [] }),
    stop: () => { record("stop"); return ok({ stopped: [] }); },
    interact: () => { record("interact"); return ok({ started: "mining" }); },
    takeLoot: () => ok({ taken: [], remaining: [], containerEmpty: true }),
    useItem: () => ok({ effect: "ate" }),
    equipItem: () => ok({ slot: "mainHand", replaced: null }),
    unequipItem: () => ok({ itemId: "x" }),
    produce: () => ok({ queued: 1, durationMs: 1000 }),
    produceAt: () => ok({ queued: 1, durationMs: 1000 }),
    buildCampfire: () => ok({ entityId: "fire", lifetimeMs: 1, position: [0, 0, 0] }),
    attack: () => { record("attack"); return ok({ targetId: "rat", attackSpeedMs: 1600 }); },
    cast: () => ok({ targetId: "rat", castMs: 2200 }),
    setPreferredSpell: () => ok({ preferredSpellId: null }),
    dialogue: () => ok(null),
    bank: () => err("OUT_OF_RANGE", "No bank here"),
    shop: (op: string) => { record(`shop:${op}`); return op === "list" ? err("NOT_FOUND", "No shop here") : ok({ shopId: "s", stock: [], currency: 5 }); },
    overlay: () => { record("overlay"); return ok({ activeCount: 1 }); },
    events: (since: number, filter?: GameEventType[], timeoutMs?: number) => timeoutMs ? bus.wait(since, filter, timeoutMs) : Promise.resolve(bus.since(since, filter)),
  } as unknown as GameApi & { calls: string[] };
  return api;
}

function tool(tools: ToolDef[], name: string): ToolDef {
  const found = tools.find((entry) => entry.name === name);
  if (!found) throw new Error(`Missing tool ${name}`);
  return found;
}

describe("schema validation", () => {
  const schema = {
    type: "object",
    properties: {
      radius: { type: "number", minimum: 1, maximum: 140 },
      scope: { type: "string", enum: ["visible", "known"] },
      types: { type: "array", items: { type: "string", enum: ["a", "b"] }, maxItems: 2 },
      id: { type: "string", minLength: 1 },
      spell: { type: ["string", "null"] },
    },
    required: ["id"],
    additionalProperties: false,
  };

  it("accepts a conforming object", () => {
    expect(validateAgainst(schema, { id: "x", radius: 40, scope: "known", types: ["a"], spell: null })).toEqual({ ok: true });
  });

  it("names the field and the expectation on every kind of failure", () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ id: "x", radius: "big" }, /radius: expected number, got string "big"/],
      [{ id: "x", radius: 1000 }, /radius: 1000 is above the maximum 140/],
      [{ id: "x", scope: "far" }, /scope: "far" is not one of "visible", "known"/],
      [{ id: "x", types: ["c"] }, /types\[0\]: "c" is not one of/],
      [{ id: "x", types: ["a", "b", "a"] }, /types: allows at most 2 items/],
      [{ radius: 3 }, /id: is required/],
      [{ id: "" }, /id: must be at least 1 characters/],
      [{ id: "x", extra: 1 }, /extra: is not an accepted argument\. Accepted: radius, scope, types, id, spell/],
      [{ id: "x", spell: 4 }, /spell: expected string or null/],
    ];
    for (const [input, pattern] of cases) {
      const result = validateAgainst(schema, input);
      expect(result.ok, JSON.stringify(input)).toBe(false);
      if (!result.ok) expect(result.message).toMatch(pattern);
    }
  });

  it("treats an integer schema as a whole-number requirement", () => {
    expect(validateAgainst({ type: "integer" }, 2.5).ok).toBe(false);
    expect(validateAgainst({ type: "integer" }, 2).ok).toBe(true);
    expect(validateAgainst({ type: "number" }, 2).ok).toBe(true);
  });
});

describe("tool registry", () => {
  const api = mockApi();
  const { session } = makeSession();
  const tools = createTools(api, session, { build: "test", contracts: "4", content: "1" });

  it("gives every tool a title, a strict object schema, an access level and honest annotations", () => {
    expect(tools.length).toBeGreaterThanOrEqual(30);
    for (const entry of tools) {
      expect(entry.name).toMatch(/^corealm_[a-z_]+$/);
      expect(entry.title.length).toBeGreaterThan(3);
      expect(entry.description.length).toBeGreaterThan(40);
      expect(entry.inputSchema.type).toBe("object");
      expect(entry.inputSchema.additionalProperties).toBe(false);
      expect(["read", "assist", "act"]).toContain(entry.access);
      if (entry.access !== "read") expect(entry.annotations.readOnlyHint).toBe(false);
    }
    expect(tool(tools, "corealm_context").annotations.readOnlyHint).toBe(true);
    expect(tool(tools, "corealm_bank").annotations.readOnlyHint).toBe(false);
    expect(tool(tools, "corealm_attack").access).toBe("act");
    expect(tool(tools, "corealm_overlay").access).toBe("assist");
  });

  it("lists the orientation tools first", () => {
    expect(tools.slice(0, 3).map((entry) => entry.name)).toEqual(["corealm_context", "corealm_manual", "corealm_session"]);
  });

  it("rejects bad arguments before the handler runs, on both call paths", async () => {
    const observe = tool(tools, "corealm_observe");
    const bad = await invokeTool(observe, session, { radius: "big" });
    expect(bad).toMatchObject({ error: "INVALID_ARGUMENT", path: "radius" });
    expect(String((bad as { message: string }).message)).toContain("corealm_observe: radius");
    const events = tool(tools, "corealm_events");
    expect(await invokeTool(events, session, { types: ["inventory.ful"] })).toMatchObject({ error: "INVALID_ARGUMENT" });
    expect(await invokeTool(events, session, { sinceSeq: 0, timeoutMs: 0 })).toMatchObject({ events: [], dropped: false });
    expect(await invokeTool(tool(tools, "corealm_player"), session, [] as unknown as Record<string, unknown>)).toMatchObject({ error: "INVALID_ARGUMENT" });
  });
});

describe("session gating", () => {
  it("refuses drawing in guide and acting outside agent-controlled play", async () => {
    const api = mockApi();
    const { session } = makeSession();
    const tools = createTools(api, session, { build: "t", contracts: "4", content: "1" });
    const move = tool(tools, "corealm_move_to");
    const overlay = tool(tools, "corealm_overlay");

    expect(await invokeTool(move, session, { locationId: "x" })).toMatchObject({ error: "NOT_PERMITTED", mode: "guide" });
    expect(await invokeTool(overlay, session, { op: "set", kind: "marker", position: [0, 0, 0] })).toMatchObject({ error: "NOT_PERMITTED" });
    expect(api.calls).toEqual([]);

    session.setMode("assist", "agent");
    expect(await invokeTool(overlay, session, { op: "set", kind: "marker", position: [0, 0, 0] })).toEqual({ activeCount: 1 });
    expect(await invokeTool(move, session, { locationId: "x" })).toMatchObject({ error: "NOT_PERMITTED", mode: "assist" });

    expect(session.setMode("play", "agent")).toMatchObject({ error: "APPROVAL_REQUIRED" });
    session.grantControl("player");
    expect(await invokeTool(move, session, { locationId: "x" })).toEqual({ pathLength: 10, etaMs: 2400 });

    session.pause("player");
    expect(await invokeTool(move, session, { locationId: "x" })).toMatchObject({ error: "PAUSED" });
    session.resume("player");
    session.takeControl("player");
    expect(session.read()).toMatchObject({ mode: "assist", controlOwner: "player" });
    expect(await invokeTool(move, session, { locationId: "x" })).toMatchObject({ error: "NOT_PERMITTED" });
  });

  it("lets mixed tools read in guide and gates their writes", async () => {
    const api = mockApi();
    const { session } = makeSession();
    const tools = createTools(api, session, { build: "t", contracts: "4", content: "1" });
    const dialogue = tool(tools, "corealm_dialogue");
    expect(await invokeTool(dialogue, session, { op: "state" })).toBeNull();
    expect(await invokeTool(dialogue, session, { op: "choose", optionId: "x" })).toMatchObject({ error: "NOT_PERMITTED" });
    const bank = tool(tools, "corealm_bank");
    expect(await invokeTool(bank, session, { op: "list" })).toMatchObject({ error: "OUT_OF_RANGE" });
    expect(await invokeTool(bank, session, { op: "depositAll" })).toMatchObject({ error: "NOT_PERMITTED" });
  });

  it("asks the player before a trade and honours the answer", async () => {
    const api = mockApi();
    const { session } = makeSession();
    const tools = createTools(api, session, { build: "t", contracts: "4", content: "1" });
    session.grantControl("player");
    const shop = tool(tools, "corealm_shop");

    const pending = invokeTool(shop, session, { op: "sell", itemId: "worn_sword", approvalTimeoutMs: 5000 });
    await Promise.resolve();
    const request = session.read().pendingApproval;
    expect(request).toMatchObject({ kind: "trade", description: "Sell 1 × worn_sword" });
    session.answerApproval(request!.id, false, "player");
    expect(await pending).toMatchObject({ error: "NOT_PERMITTED" });
    expect(api.calls).not.toContain("shop:sell");

    session.setAutoApprove("trade", true);
    expect(await invokeTool(shop, session, { op: "sell", itemId: "worn_sword" })).toMatchObject({ shopId: "s" });
    expect(api.calls).toContain("shop:sell");

    const timedOut = await invokeTool(shop, session, { op: "buy", itemId: "x", approvalTimeoutMs: 0 });
    expect(timedOut).toMatchObject({ shopId: "s" });
  });
});

describe("the handoff", () => {
  it("publishes every change as an event and tells the input layer who owns the character", async () => {
    const stopWorld = vi.fn();
    const { session, emitted, owners } = makeSession({ stopWorld });
    session.connect("Tester");
    const request = session.requestApproval("control", "Let me mine", "Mine ore");
    expect(request.status).toBe("pending");
    const waiting = session.waitForApproval(request.id, 1000);
    session.answerApproval(request.id, true, "player");
    expect((await waiting)?.status).toBe("approved");
    expect(session.read()).toMatchObject({ mode: "play", controlOwner: "agent", objective: "Mine ore", agentName: "Tester" });
    expect(owners).toEqual(["agent"]);

    session.pause("player");
    expect(stopWorld).toHaveBeenCalledTimes(1);
    session.resume("player");
    session.stop("player");
    expect(stopWorld).toHaveBeenCalledTimes(2);
    expect(session.read()).toMatchObject({ mode: "assist", controlOwner: "player", paused: false });
    expect(owners).toEqual(["agent", "player"]);

    const types = emitted.map((event) => event.type);
    expect(types).toContain("agent.approval");
    expect(types).toContain("agent.session");
    const changes = emitted.filter((event) => event.type === "agent.session").map((event) => event.data.change);
    expect(changes).toEqual(expect.arrayContaining(["connected", "objective", "mode", "control", "paused"]));
  });

  it("aborts a running task on stop and refuses a second concurrent task", async () => {
    const { session, emitted } = makeSession();
    session.grantControl("player");
    let seen: AbortSignal | null = null;
    const task = session.runTask("corealm_gather", "Gathering", (signal) => new Promise((resolve) => {
      seen = signal;
      signal.addEventListener("abort", () => resolve({ error: "CANCELLED", message: "cut short" }));
    }));
    await Promise.resolve();
    expect(session.read().task).toMatchObject({ tool: "corealm_gather" });
    expect(await session.runTask("corealm_fight", "Fighting", async () => ({}))).toMatchObject({ error: "BUSY" });
    session.stop("player");
    expect(seen!.aborted).toBe(true);
    expect(await task).toMatchObject({ error: "CANCELLED" });
    const statuses = emitted.filter((event) => event.type === "agent.task").map((event) => event.data.status);
    expect(statuses).toEqual(["started", "cancelled"]);
  });

  it("expires a stale approval and reports it", async () => {
    const { session, clock } = makeSession();
    const request = session.requestApproval("control", "x");
    clock.now += 130_000;
    session.expireStaleApproval();
    expect((await session.waitForApproval(request.id, 0))?.status).toBe("expired");
    expect(session.read().pendingApproval).toBeNull();
  });
});

describe("the guide", () => {
  it("normalises a plan into targeted steps with a cursor and reports what it will draw", async () => {
    const api = mockApi();
    api.planPath = ((target: { locationId?: string }) => target.locationId === "nowhere"
      ? err("NOT_FOUND", "No known location nowhere")
      : ok({ points: [[0, 0, 0], [10, 0, 0]], pathLength: 10, etaMs: 2400, legs: [] })) as GameApi["planPath"];
    const { session, emitted } = makeSession();
    const tools = createTools(api, session, { build: "t", contracts: "5", content: "1" });
    const propose = tool(tools, "corealm_propose");

    const inGuide = await invokeTool(propose, session, {
      summary: "Mine six ore",
      steps: [
        { text: "Walk to the pit", locationId: "bracken_pit" },
        { text: "Mine six Grithe ore", entityId: "rock_1", done: "manual", arriveRadius: 6 },
        { text: "Go nowhere", locationId: "nowhere" },
        { text: "Bank it", tool: "corealm_bank" },
      ],
    }) as Record<string, unknown>;
    expect(inGuide).toMatchObject({ proposed: true, steps: 4, currentStep: 0, drawn: 0, mode: "guide", unreachable: ["3: No known location nowhere"] });
    expect(String(inGuide.note)).toMatch(/Guide mode/);

    const plan = session.read().proposal!;
    expect(plan.currentStep).toBe(0);
    expect(plan.steps.map((step) => step.status)).toEqual(["current", "pending", "pending", "pending"]);
    expect(plan.steps[0]).toMatchObject({ target: { locationId: "bracken_pit" }, done: "arrive" });
    expect(plan.steps[1]).toMatchObject({ target: { entityId: "rock_1" }, done: "manual", arriveRadius: 6 });
    // A place that does not exist cannot be arrived at, so the step falls to manual and has no target.
    expect(plan.steps[2]).toMatchObject({ done: "manual" });
    expect(plan.steps[2]!.target).toBeUndefined();
    expect(plan.steps[3]).toMatchObject({ tool: "corealm_bank", done: "manual" });
    // The tool never draws; the guidance layer does, from the session. No overlay call here.
    expect(api.calls).toEqual([]);

    session.setMode("assist", "agent");
    const inAssist = await invokeTool(propose, session, { summary: "Same plan", steps: [{ text: "Walk", locationId: "bracken_pit" }, { text: "Bank" }] }) as Record<string, unknown>;
    expect(inAssist).toMatchObject({ drawn: 1, mode: "assist" });
    expect(inAssist.note).toBeUndefined();

    const advanced = await invokeTool(propose, session, { advance: true });
    expect(advanced).toMatchObject({ advanced: true, completed: 0, currentStep: 1, step: "Bank", finished: false });
    expect(session.read().proposal!.steps.map((step) => step.status)).toEqual(["done", "current"]);
    expect(await invokeTool(propose, session, { advance: true })).toMatchObject({ advanced: true, completed: 1, currentStep: null, finished: true });
    expect(await invokeTool(propose, session, { advance: true })).toMatchObject({ advanced: false, finished: true });

    const guideEvents = emitted.filter((event) => event.type === "agent.guide").map((event) => event.data);
    expect(guideEvents).toEqual([
      expect.objectContaining({ change: "advanced", completed: 0, via: "agent", step: 1, text: "Bank", stepCount: 2 }),
      expect.objectContaining({ change: "finished", completed: 1, via: "agent", step: null, text: null }),
    ]);

    expect(await invokeTool(propose, session, { clear: true })).toEqual({ cleared: true });
    expect(session.read().proposal).toBeNull();
    expect(emitted.at(-1)).toMatchObject({ type: "agent.guide", data: { change: "cleared" } });
    expect(await invokeTool(propose, session, { clear: true })).toEqual({ cleared: false });
    expect(await invokeTool(propose, session, { advance: true })).toMatchObject({ error: "NOT_FOUND" });
  });

  it("marks a previewed route as a self-clearing destination and takes it down on request", async () => {
    const api = mockApi();
    const overlays: [string, Record<string, unknown> | undefined][] = [];
    api.overlay = ((op: string, spec?: Record<string, unknown>) => { overlays.push([op, spec]); return ok({ activeCount: 1 }); }) as GameApi["overlay"];
    const { session } = makeSession();
    const tools = createTools(api, session, { build: "t", contracts: "5", content: "1" });
    const route = tool(tools, "corealm_route");

    expect(await invokeTool(route, session, { locationId: "bracken_pit" })).toMatchObject({ pathLength: 10, drawn: false });
    expect(await invokeTool(route, session, { locationId: "bracken_pit", draw: true })).toMatchObject({ error: "NOT_PERMITTED" });
    expect(overlays).toEqual([]);

    session.setMode("assist", "agent");
    expect(await invokeTool(route, session, { locationId: "bracken_pit", label: "Ore here" })).toMatchObject({ drawn: true, overlayId: "agent_route", pointCount: 2 });
    expect(overlays).toEqual([["set", { id: "agent_route", kind: "marker", colour: "#6ea8ff", locationId: "bracken_pit", text: "Ore here" }]]);
    expect(await invokeTool(route, session, { clear: true })).toEqual({ cleared: true });
    expect(overlays.at(-1)).toEqual(["clear", { id: "agent_route", kind: "marker" }]);
  });

  it("forwards a marker's destination options to the API", async () => {
    const api = mockApi();
    const overlays: unknown[] = [];
    api.overlay = ((op: string, spec?: Record<string, unknown>) => { overlays.push([op, spec]); return ok({ activeCount: 1 }); }) as GameApi["overlay"];
    const { session } = makeSession();
    session.setMode("assist", "agent");
    const tools = createTools(api, session, { build: "t", contracts: "5", content: "1" });
    await invokeTool(tool(tools, "corealm_overlay"), session, { op: "set", id: "bank", kind: "marker", entityId: "coldbrace_bank", text: "Bank", persist: true, route: false, arriveRadius: 12 });
    expect(overlays).toEqual([["set", { id: "bank", kind: "marker", entityId: "coldbrace_bank", text: "Bank", persist: true, route: false, arriveRadius: 12 }]]);
    expect(await invokeTool(tool(tools, "corealm_overlay"), session, { op: "set", kind: "marker", position: [0, 0, 0], arriveRadius: 0.5 })).toMatchObject({ error: "INVALID_ARGUMENT", path: "arriveRadius" });
  });
});

describe("event truncation reporting", () => {
  it("reports how many events an old cursor missed", () => {
    const bus = new EventBus();
    for (let i = 0; i < 600; i += 1) bus.emit("item.received", { i });
    bus.flush();
    const fresh = bus.since(0);
    expect(fresh.events).toHaveLength(512);
    expect(fresh).toMatchObject({ oldestSeq: 89, dropped: true, droppedCount: 88, nextSeq: 600 });
    const caughtUp = bus.since(590);
    expect(caughtUp).toMatchObject({ dropped: false, droppedCount: 0 });
    expect(caughtUp.events).toHaveLength(10);
    const justMissed = bus.since(80);
    expect(justMissed).toMatchObject({ dropped: true, droppedCount: 8 });
  });

  it("does not report a gap on a ring that never trimmed", () => {
    const bus = new EventBus();
    bus.emit("item.received", {});
    bus.flush();
    expect(bus.since(0)).toMatchObject({ oldestSeq: 1, dropped: false, droppedCount: 0 });
    expect(new EventBus().since(0)).toMatchObject({ oldestSeq: 1, dropped: false });
  });
});

describe("the manual", () => {
  it("catalogues every event type and every error code the contract declares", () => {
    for (const type of GAME_EVENT_TYPES) {
      expect(EVENT_CATALOGUE[type]?.about.length, type).toBeGreaterThan(10);
      expect(EVENT_CATALOGUE[type]?.fields.length, type).toBeGreaterThan(3);
    }
    for (const code of GAME_ERROR_CODES) expect(ERROR_CATALOGUE[code]?.length, code).toBeGreaterThan(10);
    expect(Object.keys(EVENT_CATALOGUE).sort()).toEqual([...GAME_EVENT_TYPES].sort());
  });

  it("renders every topic and lists the live tools", async () => {
    const api = mockApi();
    const { session } = makeSession();
    const tools = createTools(api, session, { build: "t", contracts: "4", content: "1" });
    const manual = tool(tools, "corealm_manual");
    const all = await invokeTool(manual, session, { topic: "all" }) as Record<string, string>;
    for (const topic of ["overview", "modes", "control", "tools", "rules", "terminology", "events", "errors", "efficiency"]) {
      expect(all[topic]?.length, topic).toBeGreaterThan(100);
    }
    for (const entry of tools) expect(all.tools).toContain(entry.name);
    expect(all.control).toMatch(/Take control/);
    expect(all.modes).toMatch(/request_control/);
  });
});

describe("corealm_context", () => {
  it("returns one snapshot with the session, the revision, the cursor and suggested calls", async () => {
    const api = mockApi();
    const { session } = makeSession();
    const tools = createTools(api, session, { build: "t", contracts: "4", content: "1" });
    const context = await invokeTool(tool(tools, "corealm_context"), session, {}) as Record<string, unknown>;
    expect(context.game).toMatchObject({ name: "Corealm", version: { contracts: "4" } });
    expect(context.revision).toMatchObject({ revision: 3 });
    expect(context.session).toMatchObject({ mode: "guide", controlOwner: "player", approvalRequired: expect.any(Array) });
    expect(context.quests).toMatchObject({ available: [{ id: "cold_iron" }], active: [], complete: [] });
    expect(context.events).toMatchObject({ nextSeq: 0 });
    expect(context.bank).toMatchObject({ open: false });
    const suggestions = context.suggestedActions as { tool: string; requires?: string }[];
    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) expect(suggestion.tool).toMatch(/^corealm_/);
    expect(suggestions[0]).toMatchObject({ tool: "corealm_session" });
  });

  it("honours a section subset", async () => {
    const api = mockApi();
    const { session } = makeSession();
    const tools = createTools(api, session, { build: "t", contracts: "4", content: "1" });
    const context = await invokeTool(tool(tools, "corealm_context"), session, { sections: ["player"] }) as Record<string, unknown>;
    expect(context.player).toBeDefined();
    expect(context.skills).toBeUndefined();
    expect(context.suggestedActions).toBeUndefined();
  });
});

describe("WebMCP adapter", () => {
  it("registers native-shaped descriptors with annotations and forwards the caller's signal", async () => {
    const registered: { name: string; title: string; annotations: { readOnlyHint: boolean }; execute: (input: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown> }[] = [];
    const registerTool = vi.fn((descriptor: (typeof registered)[number], _options?: { signal?: AbortSignal }) => { registered.push(descriptor); });
    stubBrowser({ modelContext: { registerTool } });
    try {
      const api = mockApi();
      const { session } = makeSession();
      const tools = createTools(api, session, { build: "t", contracts: "4", content: "1" });
      const seen: (AbortSignal | undefined)[] = [];
      const registration = registerWebMcp(tools, async (entry, args, context) => { seen.push(context.signal); return invokeTool(entry, session, args, context); });
      expect(registration).toMatchObject({ binding: "document.modelContext", native: true, method: "registerTool", toolCount: tools.length });
      expect(registerTool.mock.calls[0]?.[1]).toMatchObject({ signal: expect.any(AbortSignal) });
      const player = registered.find((entry) => entry.name === "corealm_player")!;
      expect(player.title).toBe("Read player state");
      expect(player.annotations.readOnlyHint).toBe(true);
      const controller = new AbortController();
      const result = await player.execute({}, { signal: controller.signal }) as { content: { type: string; text: string }[]; isError?: boolean };
      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0]!.text)).toMatchObject({ health: 23 });
      expect(seen[0]).toBe(controller.signal);
      const failed = await player.execute({ nope: 1 }) as { isError?: boolean; content: { text: string }[] };
      expect(failed.isError).toBe(true);
      expect(JSON.parse(failed.content[0]!.text)).toMatchObject({ error: "INVALID_ARGUMENT" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports no binding, and installs nothing, when the browser has no container", () => {
    stubBrowser({});
    try {
      const registration = registerWebMcp([], async () => null);
      expect(registration).toMatchObject({ binding: "none", native: false, toolCount: 0 });
      expect((globalThis as unknown as { document: { modelContext?: unknown } }).document.modelContext).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("names the test stand-in as such", () => {
    stubBrowser({ modelContext: { __corealmPolyfill: true, registerTool: () => {} } });
    try {
      expect(registerWebMcp([], async () => null)).toMatchObject({ binding: "polyfill", native: false });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("marks structured errors in the envelope", () => {
    expect(toMcpResult({ error: "NOT_FOUND", message: "x" }).isError).toBe(true);
    expect(toMcpResult({ health: 1 }).isError).toBeUndefined();
  });
});
