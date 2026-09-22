/**
 * The guidance layer: markers as destinations, the plan's cursor, and the pinned quest's marker.
 * Runs against a recording overlay layer and a GameApi-shaped resolver, so it exercises the
 * decisions (route, re-plan, arrival, advance) and nothing beneath them.
 */
import { describe, expect, it, vi } from "vitest";
import type { GameEventType, GameEventPayloads, MoveTarget, OverlaySpec, QuestSummary, Vec3 } from "../game/src/contracts.js";
import { err, ok } from "../game/src/contracts.js";
import { AgentSession } from "../game/src/agent/session.js";
import { Guidance, type OverlayLayer } from "../game/src/app/guidance.js";
import { projectAlong } from "../game/src/render/pathRibbon.js";

interface Emitted { type: GameEventType; data: Record<string, unknown> }

/** The (x, z, along) centreline `projectAlong` reads, from a route's corner list. */
function centreline(points: Vec3[]): Float32Array {
  const centre = new Float32Array(points.length * 3);
  let along = 0;
  for (const [index, point] of points.entries()) {
    if (index > 0) along += Math.hypot(point[0] - points[index - 1]![0], point[2] - points[index - 1]![2]);
    centre[index * 3] = point[0];
    centre[index * 3 + 1] = point[2];
    centre[index * 3 + 2] = along;
  }
  return centre;
}

function harness() {
  const ids = new Map<string, OverlaySpec>();
  const routes = new Map<string, Vec3[] | null>();
  const heads = new Map<string, { along: number; lateral: number }>();
  const reached: { id: string; position: Vec3 }[] = [];
  let updates = 0;
  const overlays: OverlayLayer = {
    set: (spec) => { ids.set(spec.id, spec); return ids.size; },
    clear: (id) => {
      if (id === undefined) { ids.clear(); routes.clear(); return 0; }
      ids.delete(id);
      routes.delete(id);
      return ids.size;
    },
    has: (id) => ids.has(id),
    activeCount: () => ids.size,
    setRoute: (id, points) => {
      if (!ids.has(id)) return false;
      routes.set(id, points ? points.map((point) => [...point] as Vec3) : null);
      heads.delete(id);
      return true;
    },
    setRouteHead: (id, position) => {
      const route = routes.get(id);
      if (!route) return null;
      const centre = centreline(route);
      const head = projectAlong(centre, position[0], position[2]);
      heads.set(id, head);
      return { ...head, remaining: centre[centre.length - 1]! - head.along };
    },
    setReached: (id, position) => { reached.push({ id, position }); return ids.size; },
    update: () => { updates += 1; },
  };

  const entities = new Map<string, Vec3>();
  const locations = new Map<string, Vec3>();
  const state = { player: [0, 0, 0] as Vec3, now: 0 };
  const emitted: Emitted[] = [];

  const resolveTarget = (target: MoveTarget): Vec3 | null => {
    if ("entityId" in target) return entities.get(target.entityId) ?? null;
    if ("locationId" in target) return locations.get(target.locationId) ?? null;
    return target.position;
  };
  const planPath = vi.fn((target: MoveTarget) => {
    const to = resolveTarget(target);
    if (!to) return err("NOT_FOUND", "unknown target");
    const from = state.player;
    return ok({ points: [[...from] as Vec3, [...to] as Vec3], pathLength: Math.hypot(to[0] - from[0], to[2] - from[2]), etaMs: 0, legs: [] });
  });

  // `GameApi.overlay` in miniature: the same resolution, landing in the hook.
  const overlay = (op: "set" | "clear", spec?: OverlaySpec) => {
    if (op === "clear") return ok({ activeCount: guidance.clear(spec?.id) });
    if (!spec) return err("INVALID_ARGUMENT", "spec");
    if (spec.kind === "path") return ok({ activeCount: guidance.set(spec) });
    let resolved = spec;
    if (spec.entityId) {
      if (!entities.has(spec.entityId)) {
        const location = locations.get(spec.entityId);
        if (!location) return err("NOT_FOUND", `no ${spec.entityId}`);
        const { entityId, ...rest } = spec;
        resolved = { ...rest, locationId: entityId, position: location };
      }
    } else if (spec.locationId) {
      const location = locations.get(spec.locationId);
      if (!location) return err("NOT_FOUND", `no ${spec.locationId}`);
      resolved = { ...spec, position: location };
    } else if (!spec.position) {
      return err("INVALID_ARGUMENT", "anchorless");
    }
    return ok({ activeCount: guidance.set(resolved) });
  };

  const guidance: Guidance = new Guidance({
    overlays,
    now: () => state.now,
    playerPosition: () => state.player,
    entityPosition: (id) => entities.get(id) ?? null,
    planPath,
    overlay,
    emit: <T extends GameEventType>(type: T, data: GameEventPayloads[T]) => { emitted.push({ type, data: data as Record<string, unknown> }); },
  });

  const session = new AgentSession({
    now: () => state.now,
    emit: <T extends GameEventType>(type: T, data: GameEventPayloads[T]) => { emitted.push({ type, data: data as Record<string, unknown> }); },
    stopWorld: () => {},
  });

  return {
    guidance, overlays, ids, routes, heads, reached, entities, locations, emitted, planPath, session, overlay,
    updates: () => updates,
    moveTo(position: Vec3) { state.player = position; },
    tick(ms = 250) { state.now += ms; guidance.update(state.now); },
    events: (type: GameEventType) => emitted.filter((event) => event.type === type).map((event) => event.data),
  };
}

describe("markers as destinations", () => {
  it("draws a ground route whose head slides with the player, re-plans on straying, and clears itself on arrival", () => {
    const h = harness();
    h.locations.set("pit", [30, 0, 0]);
    expect(h.overlay("set", { id: "m", kind: "marker", locationId: "pit", colour: "#8ad4ff" })).toEqual(ok({ activeCount: 1 }));
    expect(h.ids.get("m")).toMatchObject({ kind: "marker", locationId: "pit", position: [30, 0, 0] });
    expect(h.routes.get("m")).toEqual([[0, 0, 0], [30, 0, 0]]);
    expect(h.planPath).toHaveBeenCalledWith({ locationId: "pit" });
    expect(h.planPath).toHaveBeenCalledTimes(1);

    // Walking the route slides the head; the ribbon is not rebuilt.
    h.moveTo([0.3, 0, 0]);
    h.tick();
    expect(h.heads.get("m")).toEqual({ along: 0.3, lateral: 0 });
    h.moveTo([2, 0, 0]);
    h.tick();
    expect(h.heads.get("m")).toEqual({ along: 2, lateral: 0 });
    expect(h.planPath).toHaveBeenCalledTimes(1);
    expect(h.routes.get("m")![0]).toEqual([0, 0, 0]);

    // Straying off it is a re-plan from where the player now stands...
    h.moveTo([4, 0, 2]);
    h.tick();
    expect(h.planPath).toHaveBeenCalledTimes(2);
    expect(h.routes.get("m")![0]).toEqual([4, 0, 2]);
    // ...but not more often than the interval, however fast the player is moving.
    h.moveTo([7, 0, 5]);
    h.tick(50);
    expect(h.planPath).toHaveBeenCalledTimes(2);
    h.tick(200);
    expect(h.planPath).toHaveBeenCalledTimes(3);
    expect(h.routes.get("m")![0]).toEqual([7, 0, 5]);
    expect(h.updates()).toBe(5);

    // Six metres along the standing ribbon is a re-plan too, so the walked part does not pile up.
    const along = 6.5 / Math.hypot(23, 5);
    h.moveTo([7 + 23 * along, 0, 5 - 5 * along]);
    h.tick();
    expect(h.planPath).toHaveBeenCalledTimes(4);

    // Within the location radius: the marker takes itself down with a flourish, and says so.
    h.moveTo([23, 0, 0]);
    h.tick();
    expect(h.ids.has("m")).toBe(false);
    expect(h.reached).toEqual([{ id: "m#reached", position: [30, 0, 0] }]);
    expect(h.events("overlay.arrived")).toEqual([{ id: "m", position: [30, 0, 0], cleared: true }]);
    h.tick();
    expect(h.events("overlay.arrived")).toHaveLength(1);
  });

  it("keeps a persistent marker, drops its route on arrival, and restores it on leaving", () => {
    const h = harness();
    h.entities.set("bank", [10, 0, 0]);
    h.overlay("set", { id: "bank", kind: "marker", entityId: "bank", persist: true, text: "Bank" });
    expect(h.routes.get("bank")).toEqual([[0, 0, 0], [10, 0, 0]]);

    h.moveTo([7, 0, 0]);
    h.tick();
    expect(h.ids.has("bank")).toBe(true);
    expect(h.routes.get("bank")).toBeNull();
    expect(h.reached).toEqual([]);
    expect(h.events("overlay.arrived")).toEqual([{ id: "bank", position: [10, 0, 0], cleared: false }]);

    // Still near: no route, no second arrival.
    h.moveTo([5, 0, 0]);
    h.tick();
    expect(h.routes.get("bank")).toBeNull();
    expect(h.events("overlay.arrived")).toHaveLength(1);

    // Left by more than the hysteresis: the route is back.
    h.moveTo([-4, 0, 0]);
    h.tick();
    expect(h.routes.get("bank")).toEqual([[-4, 0, 0], [10, 0, 0]]);
    h.moveTo([8, 0, 0]);
    h.tick();
    expect(h.events("overlay.arrived")).toHaveLength(2);
  });

  it("treats starting to use the target as arriving, at any distance", () => {
    const h = harness();
    h.entities.set("furnace", [20, 0, 0]);
    h.overlay("set", { id: "f", kind: "marker", entityId: "furnace" });
    h.guidance.onEvent({ seq: 1, type: "activity.started", atMs: 0, entityId: "furnace", data: { kind: "production", entityId: "furnace" } });
    expect(h.ids.has("f")).toBe(false);
    expect(h.events("overlay.arrived")).toEqual([{ id: "f", position: [20, 0, 0], cleared: true }]);

    h.entities.set("smith", [20, 0, 20]);
    h.overlay("set", { id: "s", kind: "marker", entityId: "smith" });
    h.guidance.onEvent({ seq: 2, type: "dialogue.opened", atMs: 0, data: { npcId: "smith", speaker: "Smith", nodeId: "x", optionCount: 1 } });
    expect(h.ids.has("s")).toBe(false);
  });

  it("honours route: false, a custom radius, and a marker set within reach", () => {
    const h = harness();
    h.entities.set("rock", [6, 0, 0]);
    h.overlay("set", { id: "pin", kind: "marker", entityId: "rock", route: false });
    expect(h.planPath).not.toHaveBeenCalled();
    expect(h.routes.has("pin")).toBe(false);

    h.overlay("set", { id: "wide", kind: "marker", position: [40, 0, 0], arriveRadius: 20 });
    h.moveTo([21, 0, 0]);
    h.tick();
    expect(h.ids.has("wide")).toBe(false);

    // Already there: nothing to walk, so it is arrived at on the spot.
    h.overlay("set", { id: "here", kind: "marker", position: [22, 0, 0] });
    expect(h.ids.has("here")).toBe(false);
    expect(h.events("overlay.arrived").at(-1)).toEqual({ id: "here", position: [22, 0, 0], cleared: true });
  });

  it("passes the other kinds straight through and drops a waypoint whose id is reused", () => {
    const h = harness();
    h.entities.set("rock", [30, 0, 0]);
    h.overlay("set", { id: "x", kind: "marker", entityId: "rock" });
    expect(h.routes.has("x")).toBe(true);
    h.overlay("set", { id: "x", kind: "highlight", entityId: "rock" });
    h.moveTo([28, 0, 0]);
    h.tick();
    expect(h.ids.get("x")).toMatchObject({ kind: "highlight" });
    expect(h.events("overlay.arrived")).toEqual([]);
  });
});

describe("the plan's cursor", () => {
  function plan(h: ReturnType<typeof harness>) {
    h.locations.set("pit", [30, 0, 0]);
    h.entities.set("furnace", [30, 0, 40]);
    h.session.setProposal({
      summary: "Smelt a bar",
      proposedAtMs: 1,
      steps: [
        { text: "Walk to the pit", target: { locationId: "pit" }, done: "arrive", status: "pending" },
        { text: "Mine one ore", done: "manual", status: "pending" },
        { text: "Smelt it at the furnace", target: { entityId: "furnace" }, done: "arrive", status: "pending" },
      ],
    });
  }

  it("draws the current step as the marker and the rest as labels, and walks forward on arrival", () => {
    const h = harness();
    h.session.setMode("assist", "agent");
    h.guidance.attachSession(h.session);
    plan(h);
    expect(h.ids.get("guide_step")).toMatchObject({ kind: "marker", locationId: "pit", text: "1. Walk to the pit", persist: false });
    expect(h.ids.get("guide_next_2")).toMatchObject({ kind: "label", entityId: "furnace", text: "3. Smelt it at the furnace" });
    expect(h.ids.has("guide_next_1")).toBe(false);
    expect(h.routes.get("guide_step")).toEqual([[0, 0, 0], [30, 0, 0]]);

    h.moveTo([24, 0, 0]);
    h.tick();
    expect(h.session.read().proposal).toMatchObject({ currentStep: 1 });
    expect(h.session.read().proposal!.steps.map((step) => step.status)).toEqual(["done", "current", "pending"]);
    expect(h.events("agent.guide")).toEqual([expect.objectContaining({ change: "advanced", completed: 0, via: "arrived", step: 1, text: "Mine one ore" })]);
    // The manual step has no place: nothing to draw, the label for step 3 stays up.
    expect(h.ids.has("guide_step")).toBe(false);
    expect(h.ids.has("guide_next_2")).toBe(true);
    expect(h.reached.map((entry) => entry.id)).toEqual(["guide_step#reached"]);

    h.session.advanceProposal("agent");
    expect(h.ids.get("guide_step")).toMatchObject({ kind: "marker", entityId: "furnace", text: "3. Smelt it at the furnace" });
    expect(h.ids.has("guide_next_2")).toBe(false);
    expect(h.routes.get("guide_step")).toEqual([[24, 0, 0], [30, 0, 40]]);

    h.moveTo([28, 0, 38]);
    h.tick();
    expect(h.session.read().proposal).toMatchObject({ currentStep: null });
    expect(h.events("agent.guide").at(-1)).toMatchObject({ change: "finished", completed: 2, via: "arrived" });
    expect([...h.ids.keys()].filter((id) => id.startsWith("guide_"))).toEqual([]);

    h.session.clearProposal();
    expect(h.events("agent.guide").at(-1)).toMatchObject({ change: "cleared" });
  });

  it("tracks arrival in guide mode without drawing, and draws the moment assist is granted", () => {
    const h = harness();
    h.guidance.attachSession(h.session);
    plan(h);
    expect(h.ids.size).toBe(0);
    expect(h.planPath).not.toHaveBeenCalled();

    h.moveTo([25, 0, 0]);
    h.tick();
    expect(h.session.read().proposal).toMatchObject({ currentStep: 1 });
    expect(h.reached).toEqual([]);

    h.session.advanceProposal("agent");
    expect(h.ids.size).toBe(0);
    h.session.setMode("assist", "agent");
    expect(h.ids.get("guide_step")).toMatchObject({ entityId: "furnace" });
  });

  it("keeps a manual step's pin on arrival and leaves the cursor to the agent", () => {
    const h = harness();
    h.session.setMode("assist", "agent");
    h.guidance.attachSession(h.session);
    h.entities.set("rock", [20, 0, 0]);
    h.session.setProposal({
      summary: "Mine", proposedAtMs: 1,
      steps: [{ text: "Mine six ore here", target: { entityId: "rock" }, done: "manual", status: "pending" }],
    });
    expect(h.ids.get("guide_step")).toMatchObject({ persist: true });
    h.moveTo([17, 0, 0]);
    h.tick();
    expect(h.ids.has("guide_step")).toBe(true);
    expect(h.routes.get("guide_step")).toBeNull();
    expect(h.session.read().proposal).toMatchObject({ currentStep: 0 });
    expect(h.events("overlay.arrived")).toEqual([{ id: "guide_step", position: [20, 0, 0], cleared: false }]);
    expect(h.events("agent.guide")).toEqual([]);
  });

  it("puts the plan and the quest marker back after an agent clears everything", () => {
    const h = harness();
    h.session.setMode("assist", "agent");
    h.guidance.attachSession(h.session);
    plan(h);
    h.overlay("set", { id: "mine", kind: "highlight", position: [1, 0, 1] });
    expect(h.overlay("clear")).toMatchObject({ ok: true });
    expect(h.ids.has("mine")).toBe(false);
    expect(h.ids.get("guide_step")).toMatchObject({ locationId: "pit" });
    expect(h.ids.has("guide_next_2")).toBe(true);
  });
});

describe("the pinned quest", () => {
  it("marks the current objective persistently and follows the stages", () => {
    const h = harness();
    h.locations.set("pit", [30, 0, 0]);
    h.entities.set("smith", [0, 0, 30]);
    let pinned: string | null = "cold_iron";
    const quest: QuestSummary = {
      id: "cold_iron", name: "Cold Iron", regionId: "fallowmarch", status: "active", stage: 0, stageCount: 2,
      currentObjective: "Reach the Bracken Pit.", currentObjectiveRefs: [{ kind: "location", id: "pit" }], requirements: {},
    };
    h.guidance.attachQuests({ pinnedQuestId: () => pinned, quests: () => [quest] });
    h.tick();
    expect(h.ids.get("quest_objective")).toMatchObject({ kind: "marker", locationId: "pit", text: "Cold Iron", persist: true });
    expect(h.routes.get("quest_objective")).toEqual([[0, 0, 0], [30, 0, 0]]);

    // Arriving does not finish a quest stage; only the quest system does. The pin stays.
    h.moveTo([26, 0, 0]);
    h.tick();
    expect(h.ids.has("quest_objective")).toBe(true);
    expect(h.routes.get("quest_objective")).toBeNull();

    // The stage completes: the marker jumps to the next objective as soon as the event lands.
    quest.stage = 1;
    quest.currentObjective = "Talk to the smith.";
    quest.currentObjectiveRefs = [{ kind: "entity", id: "smith" }, { kind: "item", id: "iron_bar" }];
    h.guidance.onEvent({ seq: 1, type: "quest.updated", atMs: 0, data: { questId: "cold_iron", status: "active", stage: 1, stageCount: 2, objective: quest.currentObjective, objectiveRefs: quest.currentObjectiveRefs } });
    h.tick(10);
    expect(h.ids.get("quest_objective")).toMatchObject({ entityId: "smith" });
    expect(h.routes.get("quest_objective")).toEqual([[26, 0, 0], [0, 0, 30]]);

    // An objective with nothing to walk to draws nothing; a finished quest draws nothing.
    quest.currentObjectiveRefs = [{ kind: "item", id: "iron_bar" }];
    quest.stage = 2;
    h.tick(600);
    expect(h.ids.has("quest_objective")).toBe(false);
    quest.status = "complete";
    h.tick(600);
    expect(h.ids.has("quest_objective")).toBe(false);

    // Unpinning takes it down; pinning again puts it back.
    quest.status = "active";
    quest.stage = 1;
    quest.currentObjectiveRefs = [{ kind: "entity", id: "smith" }];
    h.tick(600);
    expect(h.ids.has("quest_objective")).toBe(true);
    pinned = null;
    h.tick(600);
    expect(h.ids.has("quest_objective")).toBe(false);
  });
});
