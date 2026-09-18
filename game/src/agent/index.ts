import { sendGameCommand } from "../api/commands.js";
/**
 * The public agent entry point: `window.corealm`.
 *
 * Always present, in every browser, regardless of WebMCP support. This is what Playwright
 * scenarios, the internal AI, and any external driver actually call — and it runs the identical
 * handlers the WebMCP surface exposes, so testing here genuinely tests the agent path.
 *
 * Boot-cheap on purpose. Registering with WebMCP needs only the descriptors, which come from
 * `agent/catalogue.ts` (pure data), and the panel needs only the session. The handlers, the
 * validator, the bounded operations, the context builder and the manual text are
 * `agent/runtime.ts`, imported on the first call — a few milliseconds once, and nothing at all
 * for a player who never connects an agent.
 */
import type { AgentControlOwner, GameApi, GameEventPayloads, GameEventType } from "../contracts.js";
import { TOOL_ORDER, TOOL_SPECS } from "./catalogue.js";
import { AgentSession, type AgentSessionView } from "./session.js";
import { defineTool, type ToolContext, type ToolDef } from "./toolkit.js";
import { registerWebMcp, type WebMcpRegistration } from "./webmcp.js";
import type { AgentRuntime } from "./runtime.js";

export interface CorealmAgentApi {
  /** Every tool, with its schema and annotations. Start here when writing an agent. */
  listTools(): {
    name: string; title: string; description: string; inputSchema: Record<string, unknown>;
    access: string; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  }[];
  /** Invoke a tool by name. Never throws; failures come back as `{ error, message }`. */
  call(name: string, args?: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
  /** Which model-context container the WebMCP adapter bound to, and whether it was native. */
  webmcp(): { binding: string; toolCount: number; native: boolean; method: string };
  /** Build and content versions, for an agent caching knowledge across sessions. */
  version(): { build: string; contracts: string; content: string };
  /** The collaboration session as the panel sees it. */
  session(): AgentSessionView;
}

export interface AgentSurfaceOptions {
  version: { build: string; contracts: string; content: string };
  /** Sim clock, for session timestamps. */
  now(): number;
  /** The game's event bus, so session changes ride the same stream as the world. */
  emit<T extends GameEventType>(type: T, data: GameEventPayloads[T]): void;
  /** Who may move the character. Wired to the input layer by boot. */
  onControlOwnerChanged?(owner: AgentControlOwner): void;
}

export function installAgentSurface(api: GameApi, options: AgentSurfaceOptions): {
  surface: CorealmAgentApi;
  registration: WebMcpRegistration;
  session: AgentSession;
  /** The descriptors, in reading order. Handlers are in the runtime. */
  tools: ToolDef[];
  call(name: string, args: Record<string, unknown>, context?: ToolContext): Promise<unknown>;
} {
  const session = new AgentSession({
    now: options.now,
    emit: options.emit,
    stopWorld: () => sendGameCommand(api, "stop"),
    ...(options.onControlOwnerChanged ? { onControlOwnerChanged: options.onControlOwnerChanged } : {}),
  });

  let runtime: Promise<AgentRuntime> | null = null;
  const loadRuntime = (): Promise<AgentRuntime> => {
    runtime ??= import("./runtime.js").then((module) => module.createRuntime(api, session, options.version));
    return runtime;
  };

  const call = async (name: string, args: Record<string, unknown> = {}, context: ToolContext = {}): Promise<unknown> => {
    try {
      return await (await loadRuntime()).invoke(name, args, context);
    } catch (cause) {
      // The runtime import itself failing is the only way to reach here; every call inside it
      // returns its errors as data.
      return { error: "UNAVAILABLE", message: cause instanceof Error ? cause.message : String(cause) };
    }
  };

  // Descriptor-only tools: the same `defineTool` the runtime uses, so annotations cannot drift,
  // with an execute that forwards to the runtime by name.
  const tools: ToolDef[] = TOOL_ORDER.map((name) => defineTool(TOOL_SPECS[name], (args, context) => call(name, args, context)));

  const registration = registerWebMcp(tools, (tool, args, context) => call(tool.name, args, context));
  session.setWebMcp({ binding: registration.binding, native: registration.native, toolCount: registration.toolCount });

  const surface: CorealmAgentApi = {
    listTools: () => tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      access: tool.access,
      annotations: { ...tool.annotations },
    })),
    // The public path never carries `bypassSession`; only the signal crosses.
    call: (name, args, callOptions) => call(name, args ?? {}, callOptions?.signal ? { signal: callOptions.signal } : {}),
    webmcp: () => ({
      binding: registration.binding,
      toolCount: registration.toolCount,
      native: registration.native,
      method: registration.method,
    }),
    version: () => options.version,
    session: () => session.read(),
  };

  (window as unknown as { corealm?: { agent: CorealmAgentApi } }).corealm = { agent: surface };

  return { surface, registration, session, tools, call };
}
