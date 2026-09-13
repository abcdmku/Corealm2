/**
 * The canonical agent tool surface.
 *
 * This is the single implementation of every action an AI agent can take. `agent/webmcp.ts` is a
 * translation layer onto it, and `__gameDebug.callTool` invokes it directly. There is no second
 * code path, which is what makes agent parity a property of the architecture rather than a claim:
 * every tool below calls `GameApi`, the same object the human UI calls.
 *
 * Every tool carries four things beyond its handler, and all four are load-bearing:
 *
 *  - `title` and `description`, written for an agent that has never seen the game.
 *  - a strict `inputSchema`, enforced by `invokeTool` before the handler runs (`agent/schema.ts`).
 *  - `access`: `read` (any mode), `assist` (draws in the player's view), or `act` (changes the
 *    world — play mode with agent control, not paused). `agent/session.ts` enforces it.
 *  - `annotations.readOnlyHint`, the WebMCP hint, derived from `access` so they cannot disagree.
 *
 * The world tools live here. The collaboration tools (`corealm_context`, `corealm_manual`,
 * `corealm_session`, the bounded operations) are composed in sibling files and assembled by
 * `createTools`, which is the one list everything else reads.
 */
import type {
  EntityId, GameApi, GameEventType, InteractionId, ItemId, RecipeId, SpellId, Vec3,
  EquipSlot, OverlaySpec,
} from "../contracts.js";
import { validateAgainst } from "./schema.js";
import { AgentSession } from "./session.js";
import { createOperationTools } from "./operations.js";
import { createContextTool } from "./context.js";
import { createManualTool } from "./manual.js";
import { createCollaborationTools } from "./collaboration.js";
import { TOOL_ORDER, TOOL_SPECS } from "./catalogue.js";
import {
  asNumber, asString, defineTool, failure, requireApproval, unwrap,
  type ToolContext, type ToolDef, type ToolDeps,
} from "./toolkit.js";

export * from "./toolkit.js";

// ------------------------------------------------------------ world tools

function createWorldTools({ api, session }: ToolDeps): ToolDef[] {
  return [
    // ------------------------------------------------------------- state
    defineTool(TOOL_SPECS.corealm_player, () => ({ ...api.getPlayer(), time: api.getTime() })),

    defineTool(TOOL_SPECS.corealm_skills, () => api.getSkills()),

    defineTool(TOOL_SPECS.corealm_inventory, () => ({
      ...api.getInventory(),
      equipment: api.getEquipment(),
      currency: api.getCurrency(),
    })),

    defineTool(TOOL_SPECS.corealm_quests, () => api.getQuests()),

    // ------------------------------------------------------- observation
    defineTool(TOOL_SPECS.corealm_observe, (args) => api.observe({
      scope: args.scope === "known" ? "known" : "visible",
      ...(typeof args.radius === "number" ? { radius: args.radius } : {}),
      ...(Array.isArray(args.archetypes) ? { archetypes: args.archetypes as never } : {}),
      ...(typeof args.interaction === "string" ? { interaction: args.interaction as InteractionId } : {}),
      ...(typeof args.requirementsMet === "boolean" ? { requirementsMet: args.requirementsMet } : {}),
      ...(typeof args.regionId === "string" ? { regionId: args.regionId as never } : {}),
      ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
    })),

    defineTool(TOOL_SPECS.corealm_inspect, (args) => unwrap(api.inspect(asString(args.entityId)))),

    defineTool(TOOL_SPECS.corealm_search_docs, async (args) => api.searchDocs(asString(args.query), asNumber(args.limit, 5))),

    // ---------------------------------------------------------- movement
    defineTool(TOOL_SPECS.corealm_move_to, (args) => {
      if (typeof args.entityId === "string") return unwrap(api.moveTo({ entityId: args.entityId }));
      if (typeof args.locationId === "string") return unwrap(api.moveTo({ locationId: args.locationId }));
      if (Array.isArray(args.position)) return unwrap(api.moveTo({ position: args.position as unknown as Vec3 }));
      return failure("INVALID_ARGUMENT", "Give one of entityId, locationId, or position");
    }),

    defineTool(TOOL_SPECS.corealm_stop, () => unwrap(api.stop())),

    // ------------------------------------------------------- interaction
    defineTool(TOOL_SPECS.corealm_interact, (args) => unwrap(api.interact(asString(args.entityId), asString(args.interaction) as InteractionId))),

    defineTool(TOOL_SPECS.corealm_take_loot, (args) => unwrap(api.takeLoot(
      asString(args.entityId),
      typeof args.stackIndex === "number" ? Math.floor(args.stackIndex) : undefined,
    ))),

    defineTool(TOOL_SPECS.corealm_use_item, (args) => {
      const itemId = asString(args.itemId);
      return unwrap(api.useItem(itemId));
    }),

    defineTool(TOOL_SPECS.corealm_equip, (args) => {
      if (typeof args.unequipSlot === "string") return unwrap(api.unequipItem(args.unequipSlot as EquipSlot));
      if (typeof args.itemId === "string") return unwrap(api.equipItem(args.itemId, typeof args.targetSlot === "string" ? args.targetSlot as EquipSlot : undefined));
      return failure("INVALID_ARGUMENT", "Give either itemId or unequipSlot");
    }),

    defineTool(TOOL_SPECS.corealm_produce, (args) => {
      const recipeId = asString(args.recipeId) as RecipeId;
      const quantity = asNumber(args.quantity, 1);
      return unwrap(typeof args.stationId === "string"
        ? api.produceAt(args.stationId, recipeId, quantity)
        : api.produce(recipeId, quantity));
    }),

    defineTool(TOOL_SPECS.corealm_build_campfire, (args) => unwrap(api.buildCampfire(asString(args.logItemId)))),

    // ------------------------------------------------------------ combat
    defineTool(TOOL_SPECS.corealm_attack, (args) => {
      const entityId = asString(args.entityId);
      if (typeof args.spellId !== "string") return unwrap(api.attack(entityId));
      // ONE result shape for one tool. `GameApi.cast` reports its cadence as `castMs` and
      // `GameApi.attack` as `attackSpeedMs`; both names are emitted so an agent pacing itself off
      // either one keeps working whichever branch ran.
      const cast = api.cast(args.spellId as SpellId, entityId);
      if (!cast.ok) return unwrap(cast);
      return { targetId: cast.value.targetId, castMs: cast.value.castMs, attackSpeedMs: cast.value.castMs };
    }),

    defineTool(TOOL_SPECS.corealm_spellbook, (args) => {
      if (args.op === "select") {
        if (!("spellId" in args)) return failure("INVALID_ARGUMENT", "spellId is required when op is select");
        const raw = args.spellId;
        return unwrap(api.setPreferredSpell(typeof raw === "string" ? (raw as SpellId) : null));
      }
      return api.getSpellbook();
    }),

    // -------------------------------------------------------- npc, trade
    defineTool(TOOL_SPECS.corealm_dialogue, (args, context) => {
      const op = args.op === "choose" ? "choose" : args.op === "end" ? "end" : "state";
      if (op !== "state" && !context.bypassSession) {
        const refused = session.guard("corealm_dialogue", "act");
        if (refused) return refused;
      }
      if (op === "choose" && typeof args.optionId !== "string") return failure("INVALID_ARGUMENT", "optionId is required when op is choose");
      return unwrap(api.dialogue(op, typeof args.optionId === "string" ? args.optionId : undefined));
    }),

    defineTool(TOOL_SPECS.corealm_bank, (args, context) => {
      const op = args.op as "list" | "deposit" | "withdraw" | "depositAll";
      if (op !== "list" && !context.bypassSession) {
        const refused = session.guard("corealm_bank", "act");
        if (refused) return refused;
      }
      return unwrap(api.bank(op, {
        ...(typeof args.itemId === "string" ? { itemId: args.itemId as ItemId } : {}),
        ...(typeof args.quantity === "number" ? { quantity: args.quantity } : {}),
        ...(typeof args.filter === "string" ? { filter: args.filter } : {}),
      }));
    }),

    defineTool(TOOL_SPECS.corealm_shop, async (args, context) => {
      const op = args.op as "list" | "buy" | "sell";
      if (op !== "list" && !context.bypassSession) {
        const refused = session.guard("corealm_shop", "act");
        if (refused) return refused;
        if (typeof args.itemId !== "string") return failure("INVALID_ARGUMENT", `itemId is required when op is ${op}`);
        const quantity = asNumber(args.quantity, 1);
        const approval = await requireApproval(
          session, "trade", `${op === "buy" ? "Buy" : "Sell"} ${quantity} × ${args.itemId}`,
          asNumber(args.approvalTimeoutMs, 20_000), context.signal,
        );
        if (approval) return approval;
      }
      return unwrap(api.shop(op, {
        ...(typeof args.shopId === "string" ? { shopId: args.shopId } : {}),
        ...(typeof args.itemId === "string" ? { itemId: args.itemId as ItemId } : {}),
        ...(typeof args.quantity === "number" ? { quantity: args.quantity } : {}),
      }));
    }),

    // ---------------------------------------------------------- overlays
    defineTool(TOOL_SPECS.corealm_overlay, (args) => {
      if (args.op === "clear") {
        return unwrap(api.overlay("clear", typeof args.id === "string" ? { id: args.id, kind: "marker" } : undefined));
      }
      const spec: OverlaySpec = {
        id: asString(args.id, `overlay_${Date.now()}`),
        kind: (args.kind as OverlaySpec["kind"]) ?? "highlight",
        ...(typeof args.entityId === "string" ? { entityId: args.entityId as EntityId } : {}),
        ...(typeof args.locationId === "string" ? { locationId: args.locationId } : {}),
        ...(Array.isArray(args.position) ? { position: args.position as unknown as Vec3 } : {}),
        ...(Array.isArray(args.path) ? { path: args.path as unknown as Vec3[] } : {}),
        ...(typeof args.text === "string" ? { text: args.text } : {}),
        ...(typeof args.colour === "string" ? { colour: args.colour } : {}),
        ...(typeof args.ttlMs === "number" ? { ttlMs: args.ttlMs } : {}),
        ...(typeof args.persist === "boolean" ? { persist: args.persist } : {}),
        ...(typeof args.arriveRadius === "number" ? { arriveRadius: args.arriveRadius } : {}),
        ...(typeof args.route === "boolean" ? { route: args.route } : {}),
      };
      return unwrap(api.overlay("set", spec));
    }),

    // ------------------------------------------------------------ events
    defineTool(TOOL_SPECS.corealm_events, async (args) => api.events(
      asNumber(args.sinceSeq, 0),
      Array.isArray(args.types) ? (args.types as GameEventType[]) : undefined,
      asNumber(args.timeoutMs, 0),
    )),
  ];
}

// ---------------------------------------------------------------- assembly

/**
 * The full tool list, in the order an unfamiliar agent should read it: the two orientation tools
 * first, the session, then the world.
 */
export function createTools(api: GameApi, session?: AgentSession, version?: ToolDeps["version"]): ToolDef[] {
  const deps: ToolDeps = {
    api,
    session: session ?? new AgentSession({ now: () => 0, emit: () => {}, stopWorld: () => {} }),
    version: version ?? { build: "dev", contracts: "0", content: "0" },
  };
  const tools: ToolDef[] = [
    createContextTool(deps),
    createManualTool(deps, () => tools),
    ...createCollaborationTools(deps),
    ...createOperationTools(deps),
    ...createWorldTools(deps),
  ];
  // The catalogue is the boot chunk's view of the tools and this is the runtime's; the two are
  // built from the same specs, and this is the check that nothing is registered without a handler
  // or handled without a registration.
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  if (byName.size !== tools.length) throw new Error("Duplicate agent tool");
  for (const name of TOOL_ORDER) if (!byName.has(name)) throw new Error(`Catalogue lists ${name} but no handler defines it`);
  for (const name of byName.keys()) if (!(name in TOOL_SPECS)) throw new Error(`Handler ${name} is missing from the catalogue`);
  return TOOL_ORDER.map((name) => byName.get(name)!);
}

/** Name → tool, for `callTool`. */
export function toolTable(tools: ToolDef[]): Map<string, ToolDef> {
  return new Map(tools.map((tool) => [tool.name, tool]));
}

/**
 * The one call path. Validates, gates on the session, runs, and never throws: a defect comes back
 * as `UNAVAILABLE` with the message, because a rejected promise gives an agent nothing to reason
 * about. `window.corealm.agent.call`, `__gameDebug.callTool` and the WebMCP adapter all come here.
 */
export async function invokeTool(
  tool: ToolDef,
  session: AgentSession,
  args: Record<string, unknown> | undefined,
  context: ToolContext = {},
): Promise<unknown> {
  const input = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  if (args !== undefined && args !== null && (typeof args !== "object" || Array.isArray(args))) {
    return failure("INVALID_ARGUMENT", `${tool.name} takes a JSON object of arguments, got ${Array.isArray(args) ? "an array" : typeof args}`);
  }
  const valid = validateAgainst(tool.inputSchema, input);
  if (!valid.ok) return failure("INVALID_ARGUMENT", `${tool.name}: ${valid.message}`, { path: valid.path });
  const refused = context.bypassSession ? null : session.guard(tool.name, tool.access);
  if (refused) return refused;
  if (context.signal?.aborted) return failure("CANCELLED", `${tool.name} was cancelled before it started`);
  session.noteToolCall(tool.name);
  try {
    return await tool.execute(input, context);
  } catch (cause) {
    return failure("UNAVAILABLE", cause instanceof Error ? cause.message : String(cause));
  }
}
