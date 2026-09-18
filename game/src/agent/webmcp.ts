/**
 * WebMCP adapter.
 *
 * A translation layer, never a second implementation. Every tool registered here runs through
 * `invokeTool` in `agent/tools.ts`, the same path `window.corealm.agent.call` and
 * `__gameDebug.callTool` take.
 *
 * What the draft (webmachinelearning.github.io/webmcp, August 2026) says, and what this does:
 *
 *  - The container is `document.modelContext`, secure-context only (`localhost` counts).
 *    `registerTool(tool, { signal })` registers; aborting the signal unregisters.
 *  - A tool is `{ name, title, description, inputSchema, annotations: { readOnlyHint }, execute }`,
 *    and `execute(input, { signal })` receives the caller's cancellation. The signal is forwarded
 *    to the tool so a bounded operation stops when the agent gives up on it.
 *  - `execute` returns a JSON-serialisable value. The MCP content-block shape
 *    `{ content: [{ type: "text", text }], isError? }` is what every implementation and helper in
 *    the wild normalises to, so that is what is returned — the tool's JSON result as the text.
 *
 * There is NO polyfill here. A browser without WebMCP gets `binding: "none"` and the agent panel
 * says so. The previous version installed a stand-in on `document.modelContext` whenever the
 * real thing was missing, which kept the registration code exercised in tests and also meant
 * nothing could ever report that a browser lacked the API: `native: false` was the only tell, and
 * nothing read it. The test harness now injects its own stand-in before the page loads
 * (`tools/lib/webmcp-polyfill.ts`), marked so this file can name it honestly.
 */
import type { ToolContext, ToolDef } from "./tools.js";

interface McpContent { type: "text"; text: string }
interface McpResult { content: McpContent[]; isError?: boolean }

export interface McpToolDescriptor {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute(input: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<McpResult>;
}

interface ModelContextLike {
  registerTool?: (tool: McpToolDescriptor, options?: { signal?: AbortSignal }) => Promise<void> | void;
  unregisterTool?: (name: string) => Promise<void> | void;
  /** Set by the test harness's stand-in so it is never mistaken for a browser implementation. */
  __corealmPolyfill?: boolean;
}

export type WebMcpBinding = "document.modelContext" | "polyfill" | "none";

export interface WebMcpRegistration {
  binding: WebMcpBinding;
  toolCount: number;
  /** True when a real browser implementation accepted the registration. */
  native: boolean;
  /** How the tools were handed over, for the panel and the audit. */
  method: "registerTool" | "none";
  dispose(): void;
}

export type ToolInvoker = (tool: ToolDef, args: Record<string, unknown>, context: ToolContext) => Promise<unknown>;

/** Wraps a canonical tool result in MCP content blocks. */
export function toMcpResult(value: unknown): McpResult {
  const isError = Boolean(value && typeof value === "object" && typeof (value as Record<string, unknown>).error === "string");
  return {
    content: [{ type: "text", text: JSON.stringify(value ?? null) }],
    ...(isError ? { isError: true } : {}),
  };
}

export function toDescriptor(tool: ToolDef, invoke: ToolInvoker): McpToolDescriptor {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { ...tool.annotations },
    async execute(input, options) {
      const context: ToolContext = options?.signal ? { signal: options.signal } : {};
      // `invokeTool` never rejects, so a rejection here would be a defect in the adapter itself.
      return toMcpResult(await invoke(tool, input ?? {}, context));
    },
  };
}

function findContainer(): { container: ModelContextLike; binding: WebMcpBinding } | null {
  const fromDocument = (document as unknown as { modelContext?: ModelContextLike }).modelContext;
  if (fromDocument && typeof fromDocument.registerTool === "function") {
    return { container: fromDocument, binding: fromDocument.__corealmPolyfill ? "polyfill" : "document.modelContext" };
  }
  return null;
}

/**
 * Registers Corealm's tools with whichever model-context container the browser provides.
 * Safe to call once at boot; returns a disposer for hot reload.
 */
export function registerWebMcp(tools: ToolDef[], invoke: ToolInvoker): WebMcpRegistration {
  const descriptors = tools.map((tool) => toDescriptor(tool, invoke));
  const controller = new AbortController();
  const found = findContainer();

  if (!found) {
    return { binding: "none", toolCount: 0, native: false, method: "none", dispose: () => {} };
  }

  const { container, binding } = found;
  const native = binding !== "polyfill";
  let method: WebMcpRegistration["method"] = "none";
  let registered = 0;

  if (typeof container.registerTool === "function") {
    method = "registerTool";
    for (const descriptor of descriptors) {
      try {
        void container.registerTool(descriptor, { signal: controller.signal });
        registered += 1;
      } catch (cause) {
        console.error(`[webmcp] registerTool(${descriptor.name}) failed`, cause);
      }
    }
  }

  return {
    binding,
    toolCount: registered,
    native,
    method,
    dispose: () => {
      controller.abort();
      if (typeof container.unregisterTool === "function") {
        for (const descriptor of descriptors) void container.unregisterTool(descriptor.name);
      }
    },
  };
}
