/**
 * The collaboration session: who is in charge, and what the agent is allowed to do about it.
 *
 * Three modes, one control owner, one pause bit. `guide` reads. `assist` reads and draws. `play`
 * acts — but only while the agent OWNS control, and the player grants that, not the agent. The
 * agent asks (`requestControl`), the player answers from the panel, and every change either side
 * makes is published as an `agent.session` event so the other can react through the same event
 * stream the world uses.
 *
 * Bounded operations (`corealm_gather`, `corealm_fight`, ...) run as tasks here. A task holds an
 * AbortSignal; Stop and Take control abort it, Pause parks it. One task at a time, because two
 * operations issuing commands to one character is a bug on the agent's side, not a feature.
 *
 * No world access. The session knows a `stopWorld()` callback and nothing else about the game,
 * so it can be unit-tested without a store.
 */
import type {
  AgentApprovalKind, AgentControlOwner, AgentMode, GameErrorCode, GameEventPayloads, GameEventType,
  MoveTarget,
} from "../contracts.js";

export type ToolAccess = "read" | "assist" | "act";

export type SessionActor = "agent" | "player" | "system";

export interface ApprovalRequest {
  id: string;
  kind: AgentApprovalKind;
  description: string;
  requestedAtMs: number;
  status: "pending" | "approved" | "denied" | "expired";
}

export interface TaskView {
  id: string;
  tool: string;
  summary: string;
  startedAtMs: number;
}

export type ProposalStepStatus = "pending" | "current" | "done" | "skipped";

export interface ProposalStep {
  text: string;
  tool?: string;
  args?: Record<string, unknown>;
  /** Where the step happens, when it has a place. Drawn as the guide marker while current. */
  target?: MoveTarget;
  /** How the step completes: the player reaching `target`, or someone saying so. */
  done: "arrive" | "manual";
  /** Metres from `target` that count as arriving. Defaults by target kind. */
  arriveRadius?: number;
  status: ProposalStepStatus;
}

/**
 * A plan with a cursor. `currentStep` is the index the guide is pointing at, or null once every
 * step is done; the guidance layer draws that step and advances the cursor on arrival, and the
 * agent or the player can advance it by hand.
 */
export interface Proposal {
  summary: string;
  steps: ProposalStep[];
  proposedAtMs: number;
  currentStep: number | null;
}

export type ProposalAdvanceVia = "arrived" | "agent" | "player";

export interface AgentSessionView {
  agentName: string | null;
  connected: boolean;
  connectedAtMs: number | null;
  mode: AgentMode;
  controlOwner: AgentControlOwner;
  paused: boolean;
  objective: string | null;
  /** One line about what the agent is doing right now, for the panel. */
  activity: string | null;
  task: TaskView | null;
  proposal: Proposal | null;
  pendingApproval: ApprovalRequest | null;
  autoApprove: Record<AgentApprovalKind, boolean>;
  /** How many tool calls this session has seen, and when the last one landed. */
  toolCalls: number;
  lastToolCallAtMs: number | null;
  webmcp: { binding: string; native: boolean; toolCount: number };
}

export interface SessionError { error: GameErrorCode; message: string; [key: string]: unknown }

export interface AgentSessionDeps {
  /** Sim clock, milliseconds. */
  now(): number;
  /** Publishes onto the game's event bus. */
  emit<T extends GameEventType>(type: T, data: GameEventPayloads[T]): void;
  /** `GameApi.stop()` — halts the character. Called on Stop and on Pause. */
  stopWorld(): void | Promise<import("../contracts.js").Result<unknown>>;
  /** Tells the input layer who owns movement. Invoked on every ownership change. */
  onControlOwnerChanged?(owner: AgentControlOwner): void;
}

const APPROVAL_TTL_MS = 120_000;

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter.toString(36)}`;
}

interface RunningTask extends TaskView {
  controller: AbortController;
}

export class AgentSession {
  private agentName: string | null = null;
  private connectedAtMs: number | null = null;
  private mode: AgentMode = "guide";
  private controlOwner: AgentControlOwner = "player";
  private paused = false;
  private objective: string | null = null;
  private activity: string | null = null;
  private task: RunningTask | null = null;
  private proposal: Proposal | null = null;
  private approval: ApprovalRequest | null = null;
  private approvalWaiters = new Set<(request: ApprovalRequest) => void>();
  private resumeWaiters = new Set<() => void>();
  private autoApprove: Record<AgentApprovalKind, boolean> = { control: false, trade: false };
  private toolCalls = 0;
  private lastToolCallAtMs: number | null = null;
  private webmcp = { binding: "none", native: false, toolCount: 0 };
  private listeners = new Set<() => void>();

  constructor(private readonly deps: AgentSessionDeps) {}

  // ------------------------------------------------------------------ reads

  read(): AgentSessionView {
    return {
      agentName: this.agentName,
      connected: this.agentName !== null,
      connectedAtMs: this.connectedAtMs,
      mode: this.mode,
      controlOwner: this.controlOwner,
      paused: this.paused,
      objective: this.objective,
      activity: this.activity,
      task: this.task ? { id: this.task.id, tool: this.task.tool, summary: this.task.summary, startedAtMs: this.task.startedAtMs } : null,
      proposal: this.proposal ? { ...this.proposal, steps: this.proposal.steps.map((step) => ({ ...step })) } : null,
      pendingApproval: this.approval && this.approval.status === "pending" ? { ...this.approval } : null,
      autoApprove: { ...this.autoApprove },
      toolCalls: this.toolCalls,
      lastToolCallAtMs: this.lastToolCallAtMs,
      webmcp: { ...this.webmcp },
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setWebMcp(binding: { binding: string; native: boolean; toolCount: number }): void {
    this.webmcp = { ...binding };
    this.notify();
  }

  /** Records a tool call for the panel's "what the agent is doing" line. */
  noteToolCall(tool: string): void {
    this.toolCalls += 1;
    this.lastToolCallAtMs = this.deps.now();
    if (!this.task) this.activity = describeCall(tool);
    this.notify();
  }

  // ------------------------------------------------------------- permission

  /**
   * The gate every tool passes through. Null means go ahead; otherwise the refusal, with enough
   * of the session attached that the agent can see what to change.
   */
  guard(tool: string, access: ToolAccess): SessionError | null {
    if (access === "read") return null;
    if (access === "assist") {
      if (this.mode === "guide") {
        return this.refuse("NOT_PERMITTED", `${tool} draws in the player's view, which guide mode does not allow. Ask for assist mode with corealm_session {op:"set_mode", mode:"assist"}.`);
      }
      return null;
    }
    if (this.mode !== "play") {
      return this.refuse("NOT_PERMITTED", `${tool} acts on the world, which needs play mode. Current mode is ${this.mode}. Call corealm_session {op:"request_control"} and wait for the player to approve.`);
    }
    if (this.controlOwner !== "agent") {
      return this.refuse("NOT_PERMITTED", `${tool} needs control of the character, and the player holds it. Call corealm_session {op:"request_control"} to ask for it back.`);
    }
    if (this.paused) {
      return this.refuse("PAUSED", `The player paused the agent. ${tool} will be allowed again after they resume; wait on the agent.session event.`);
    }
    return null;
  }

  private refuse(code: GameErrorCode, message: string): SessionError {
    return { error: code, message, mode: this.mode, controlOwner: this.controlOwner, paused: this.paused };
  }

  // --------------------------------------------------------------- identity

  connect(agentName: string): AgentSessionView {
    const trimmed = agentName.trim().slice(0, 48);
    const wasConnected = this.agentName !== null;
    this.agentName = trimmed.length > 0 ? trimmed : "Agent";
    if (!wasConnected) this.connectedAtMs = this.deps.now();
    this.emitSession("connected", "agent");
    return this.read();
  }

  disconnect(by: SessionActor): AgentSessionView {
    this.cancelTask("disconnected", by);
    this.agentName = null;
    this.connectedAtMs = null;
    this.objective = null;
    this.activity = null;
    this.clearProposal();
    if (this.controlOwner === "agent") this.setControlOwner("player", by);
    this.mode = "guide";
    this.paused = false;
    this.emitSession("connected", by);
    return this.read();
  }

  setObjective(objective: string | null, by: SessionActor): void {
    this.objective = objective ? objective.trim().slice(0, 200) : null;
    this.emitSession("objective", by);
  }

  setActivity(activity: string | null): void {
    this.activity = activity ? activity.trim().slice(0, 160) : null;
    this.notify();
  }

  // -------------------------------------------------------------- the plan

  /**
   * Puts a plan up. The cursor lands on the first step; statuses are rewritten here so a caller
   * never has to get them right. A null clears the plan (see `clearProposal`).
   */
  setProposal(proposal: Omit<Proposal, "currentStep"> | null): void {
    if (!proposal) {
      this.clearProposal();
      return;
    }
    const steps = proposal.steps.map((step, index): ProposalStep => ({ ...step, status: index === 0 ? "current" : "pending" }));
    this.proposal = { ...proposal, steps, currentStep: steps.length > 0 ? 0 : null };
    this.notify();
  }

  /**
   * Completes the current step and moves the cursor to the next pending one. `arrived` is the
   * guidance layer seeing the player reach the step's target; `agent` and `player` are someone
   * saying it is done (a player's advance reads as a skip). Returns the plan after the move, or
   * null when there was nothing to advance.
   */
  advanceProposal(via: ProposalAdvanceVia): Proposal | null {
    const proposal = this.proposal;
    if (!proposal || proposal.currentStep === null) return null;
    const completed = proposal.currentStep;
    const current = proposal.steps[completed];
    if (!current) return null;
    current.status = via === "player" ? "skipped" : "done";
    const next = proposal.steps.findIndex((step, index) => index > completed && step.status === "pending");
    proposal.currentStep = next >= 0 ? next : null;
    const nextStep = next >= 0 ? proposal.steps[next]! : null;
    if (nextStep) nextStep.status = "current";
    this.deps.emit("agent.guide", {
      change: nextStep ? "advanced" : "finished",
      completed, via,
      step: proposal.currentStep, text: nextStep?.text ?? null, stepCount: proposal.steps.length,
    });
    this.notify();
    return proposal;
  }

  /** Takes the plan down. Emits `agent.guide {change:"cleared"}` only when there was one. */
  clearProposal(): void {
    const proposal = this.proposal;
    if (!proposal) return;
    this.proposal = null;
    this.deps.emit("agent.guide", {
      change: "cleared", completed: null, via: null, step: null, text: null, stepCount: proposal.steps.length,
    });
    this.notify();
  }

  // ------------------------------------------------------------------ modes

  /**
   * Mode changes the agent may make on its own: down to guide, or into assist. Stepping up to
   * play goes through `requestControl`, because play without control is nothing, and control is
   * the player's to give.
   */
  setMode(mode: AgentMode, by: SessionActor): AgentSessionView | SessionError {
    if (mode === "play" && by === "agent" && this.controlOwner !== "agent") {
      return this.refuse("APPROVAL_REQUIRED", 'Play mode is granted by the player. Call corealm_session {op:"request_control"} instead of setting the mode directly.');
    }
    if (mode !== "play" && this.controlOwner === "agent") {
      // Leaving play hands the character back. Cancel the operation first so it cannot issue one
      // more command into a mode that forbids it.
      this.cancelTask(`mode changed to ${mode}`, by);
      this.setControlOwner("player", by);
    }
    if (this.mode !== mode) {
      this.mode = mode;
      this.emitSession("mode", by);
    }
    return this.read();
  }

  /** The player's side of the handoff. Grants control and play mode at once. */
  grantControl(by: SessionActor = "player"): AgentSessionView {
    this.resolveApproval("control", "approved");
    this.mode = "play";
    this.emitSession("mode", by);
    this.setControlOwner("agent", by);
    return this.read();
  }

  /** "Take control": the player has the character back; the agent stays connected in assist. */
  takeControl(by: SessionActor = "player"): AgentSessionView {
    this.cancelTask("player took control", by);
    if (this.controlOwner === "agent") this.setControlOwner("player", by);
    if (this.mode === "play") {
      this.mode = "assist";
      this.emitSession("mode", by);
    }
    return this.read();
  }

  /** The agent giving control back on its own, task done. Same result as Take control. */
  releaseControl(): AgentSessionView {
    return this.takeControl("agent");
  }

  /**
   * Stop: cancel the operation, halt the character, hand control back. The objective is kept so
   * the panel still says what the agent was trying to do; the agent decides whether to resume.
   */
  async stop(by: SessionActor = "player"): Promise<AgentSessionView | SessionError> {
    this.cancelTask("stopped", by);
    const outcome = this.deps.stopWorld();
    if (this.controlOwner === "agent") this.setControlOwner("player", by);
    if (this.mode === "play") {
      this.mode = "assist";
      this.emitSession("mode", by);
    }
    this.paused = false;
    this.activity = null;
    this.notify();
    const result = await outcome;
    if (result && !result.ok) return { error: result.error.code, message: result.error.message, session: this.read() };
    return this.read();
  }

  async pause(by: SessionActor = "player"): Promise<AgentSessionView | SessionError> {
    let outcome: ReturnType<AgentSessionDeps["stopWorld"]> = undefined;
    if (!this.paused) {
      this.paused = true;
      // The character halts too: a paused agent whose gather keeps running is not paused.
      if (this.controlOwner === "agent") outcome = this.deps.stopWorld();
      this.emitSession("paused", by);
    }
    const result = await outcome;
    if (result && !result.ok) return { error: result.error.code, message: result.error.message, session: this.read() };
    return this.read();
  }

  resume(by: SessionActor = "player"): AgentSessionView {
    if (this.paused) {
      this.paused = false;
      this.emitSession("paused", by);
      for (const waiter of [...this.resumeWaiters]) waiter();
      this.resumeWaiters.clear();
    }
    return this.read();
  }

  /** Resolves when the session is not paused. Rejects (resolves false) if the signal aborts first. */
  whenResumed(signal?: AbortSignal): Promise<boolean> {
    if (!this.paused) return Promise.resolve(true);
    return new Promise((resolve) => {
      const waiter = () => { cleanup(); resolve(true); };
      const onAbort = () => { cleanup(); resolve(false); };
      const cleanup = () => {
        this.resumeWaiters.delete(waiter);
        signal?.removeEventListener("abort", onAbort);
      };
      this.resumeWaiters.add(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private setControlOwner(owner: AgentControlOwner, by: SessionActor): void {
    if (this.controlOwner === owner) return;
    this.controlOwner = owner;
    this.deps.onControlOwnerChanged?.(owner);
    this.emitSession("control", by);
  }

  // -------------------------------------------------------------- approvals

  /**
   * Raises a request for the player. If the player has pre-approved this kind, it is granted on
   * the spot. Otherwise the request sits in the panel until answered or `APPROVAL_TTL_MS` passes.
   */
  requestApproval(kind: AgentApprovalKind, description: string, objective?: string): ApprovalRequest {
    if (objective !== undefined) this.setObjective(objective, "agent");
    if (this.approval && this.approval.status === "pending") {
      if (this.approval.kind === kind) return { ...this.approval };
      this.resolveApproval(this.approval.kind, "expired");
    }
    const request: ApprovalRequest = {
      id: nextId("req"),
      kind,
      description: description.trim().slice(0, 240),
      requestedAtMs: this.deps.now(),
      status: "pending",
    };
    this.approval = request;
    this.deps.emit("agent.approval", { requestId: request.id, kind, description: request.description, status: "pending" });
    if (this.autoApprove[kind]) {
      this.answerApproval(request.id, true, "system");
    } else {
      this.notify();
    }
    return { ...this.approval };
  }

  /** The player's answer. Granting a control request also flips into play mode. */
  answerApproval(requestId: string, approved: boolean, by: SessionActor = "player"): AgentSessionView | SessionError {
    const request = this.approval;
    if (!request || request.id !== requestId) {
      return this.refuse("NOT_FOUND", `No approval request ${requestId} is pending.`);
    }
    if (request.status !== "pending") {
      return this.refuse("INVALID_ARGUMENT", `Request ${requestId} was already ${request.status}.`);
    }
    if (approved && request.kind === "control") {
      this.grantControl(by);
    } else {
      this.resolveApproval(request.kind, approved ? "approved" : "denied");
    }
    return this.read();
  }

  setAutoApprove(kind: AgentApprovalKind, enabled: boolean): void {
    this.autoApprove[kind] = enabled;
    if (enabled && this.approval?.status === "pending" && this.approval.kind === kind) {
      this.answerApproval(this.approval.id, true, "system");
    }
    this.notify();
  }

  /** Resolves with the request's final status, or `pending` at timeout. */
  waitForApproval(requestId: string, timeoutMs: number, signal?: AbortSignal): Promise<ApprovalRequest | null> {
    const request = this.approval;
    if (!request || request.id !== requestId) return Promise.resolve(null);
    if (request.status !== "pending") return Promise.resolve({ ...request });
    return new Promise((resolve) => {
      const waiter = (settled: ApprovalRequest) => { cleanup(); resolve({ ...settled }); };
      const timer = setTimeout(() => { cleanup(); resolve(this.approval && this.approval.id === requestId ? { ...this.approval } : null); }, Math.max(0, timeoutMs));
      const onAbort = () => { cleanup(); resolve(this.approval && this.approval.id === requestId ? { ...this.approval } : null); };
      const cleanup = () => {
        clearTimeout(timer);
        this.approvalWaiters.delete(waiter);
        signal?.removeEventListener("abort", onAbort);
      };
      this.approvalWaiters.add(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** Lets an expired request lapse. Called from the panel's refresh cadence. */
  expireStaleApproval(): void {
    const request = this.approval;
    if (!request || request.status !== "pending") return;
    if (this.deps.now() - request.requestedAtMs > APPROVAL_TTL_MS) this.resolveApproval(request.kind, "expired");
  }

  private resolveApproval(kind: AgentApprovalKind, status: "approved" | "denied" | "expired"): void {
    const request = this.approval;
    if (!request || request.kind !== kind || request.status !== "pending") return;
    request.status = status;
    this.deps.emit("agent.approval", { requestId: request.id, kind, description: request.description, status });
    for (const waiter of [...this.approvalWaiters]) waiter(request);
    this.approvalWaiters.clear();
    this.notify();
  }

  // ------------------------------------------------------------------ tasks

  /**
   * Runs one bounded operation. The body receives an AbortSignal that fires on Stop, Take control,
   * a mode change out of play, or an explicit cancel. A second operation while one is running is
   * refused as BUSY rather than queued: the agent should wait for or cancel the first.
   */
  async runTask<T>(tool: string, summary: string, body: (signal: AbortSignal) => Promise<T>): Promise<T | SessionError> {
    if (this.task) {
      return this.refuse("BUSY", `${this.task.tool} (${this.task.id}) is still running: "${this.task.summary}". Wait for its agent.task event or call corealm_session {op:"cancel_task"}.`);
    }
    const controller = new AbortController();
    const task: RunningTask = { id: nextId("task"), tool, summary, startedAtMs: this.deps.now(), controller };
    this.task = task;
    this.activity = summary;
    this.deps.emit("agent.task", { taskId: task.id, tool, status: "started", summary });
    this.notify();
    try {
      const result = await body(controller.signal);
      if (this.task === task) {
        const failed = Boolean(result && typeof result === "object" && "error" in (result as Record<string, unknown>));
        const cancelled = failed && (result as SessionError).error === "CANCELLED";
        this.deps.emit("agent.task", {
          taskId: task.id, tool, status: cancelled ? "cancelled" : failed ? "failed" : "completed", summary,
          ...(failed ? { reason: String((result as SessionError).message) } : {}),
        });
      }
      return result;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (this.task === task) this.deps.emit("agent.task", { taskId: task.id, tool, status: "failed", summary, reason: message });
      return this.refuse("UNAVAILABLE", message);
    } finally {
      if (this.task === task) {
        this.task = null;
        this.activity = null;
        this.notify();
      }
    }
  }

  cancelTask(reason: string, by: SessionActor = "player"): boolean {
    const task = this.task;
    if (!task) return false;
    task.controller.abort(new Error(reason));
    this.deps.emit("agent.task", { taskId: task.id, tool: task.tool, status: "cancelled", summary: task.summary, reason: `${reason} (${by})` });
    this.task = null;
    this.activity = null;
    this.notify();
    return true;
  }

  // ---------------------------------------------------------------- private

  private emitSession(change: GameEventPayloads["agent.session"]["change"], by: SessionActor): void {
    this.deps.emit("agent.session", {
      change,
      mode: this.mode,
      controlOwner: this.controlOwner,
      paused: this.paused,
      objective: this.objective,
      agentName: this.agentName,
      by,
    });
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // A panel repaint must never break the session.
      }
    }
  }
}

/** A short present-tense line for the panel, from a tool name. */
function describeCall(tool: string): string {
  const verb = tool.replace(/^corealm_/, "").replace(/_/g, " ");
  switch (verb) {
    case "context": return "Reading the game state";
    case "manual": return "Reading the manual";
    case "search docs": return "Searching the documentation";
    case "events": return "Waiting for events";
    case "observe": return "Looking around";
    case "inspect": return "Inspecting something";
    case "session": return "Talking to the session";
    default: return `Calling ${verb}`;
  }
}
