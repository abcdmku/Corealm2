/** The companion's controls and detailed session view, loaded when expanded. */
import type { AgentSessionView } from "../agent/session.js";
import type { AgentPanelDeps } from "./agentPanel.js";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = el("button", className, label);
  node.type = "button";
  // A HUD click must not fall through to the world as a walk order.
  node.addEventListener("pointerdown", (event) => event.stopPropagation());
  node.addEventListener("click", onClick);
  return node;
}

export class AgentPanelBody {
  private readonly objectiveEl: HTMLElement;
  private readonly activityEl: HTMLElement;
  private readonly controlEl: HTMLElement;
  private readonly proposalRow: HTMLElement;
  private readonly proposalSummary: HTMLElement;
  private readonly proposalSkip: HTMLButtonElement;
  private readonly proposalSteps: HTMLOListElement;
  private readonly approvalBox: HTMLElement;
  private readonly approvalText: HTMLElement;
  private readonly alwaysAllow: HTMLInputElement;
  private readonly alwaysAllowLabel: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly stopButton: HTMLButtonElement;
  private readonly takeButton: HTMLButtonElement;
  private readonly grantButton: HTMLButtonElement;
  private readonly footEl: HTMLElement;
  private signature = "";

  constructor(private readonly deps: AgentPanelDeps, body: HTMLElement) {
    const objectiveRow = el("div", "agent-panel__row");
    const objective = el("span", "agent-panel__value");
    objectiveRow.append(el("span", "agent-panel__key", "Goal"), objective);

    const activityRow = el("div", "agent-panel__row");
    const activity = el("span", "agent-panel__value");
    activityRow.append(el("span", "agent-panel__key", "Doing"), activity);

    const controlRow = el("div", "agent-panel__row");
    const control = el("span", "agent-panel__value");
    controlRow.append(el("span", "agent-panel__key", "Control"), control);

    const proposalRow = el("div", "agent-panel__row");
    const proposalCell = el("div", "agent-panel__plan");
    const proposalHead = el("div", "agent-panel__plan-head");
    const proposalSummary = el("div", "agent-panel__value");
    // The player's two hands on the plan: skip the step the guide is waiting on, or drop the plan.
    const skip = button("Skip", "agent-panel__link", () => this.deps.session.advanceProposal("player"));
    skip.title = "Mark the current step done and move on";
    const dismiss = button("×", "agent-panel__btn", () => this.deps.session.clearProposal());
    dismiss.title = "Dismiss the plan";
    dismiss.setAttribute("aria-label", "Dismiss the plan");
    proposalHead.append(proposalSummary, skip, dismiss);
    const proposalSteps = el("ol", "agent-panel__steps");
    proposalCell.append(proposalHead, proposalSteps);
    proposalRow.append(el("span", "agent-panel__key", "Plan"), proposalCell);
    proposalRow.hidden = true;

    const approvalBox = el("div", "agent-panel__approval");
    approvalBox.hidden = true;
    const approvalTitle = el("div", "agent-panel__approval-title", "The agent asks");
    const approvalText = el("div", "agent-panel__approval-text");
    const approvalActions = el("div", "agent-panel__actions");
    const allow = button("Allow", "btn btn--primary", () => this.answer(true));
    const deny = button("Deny", "btn", () => this.answer(false));
    approvalActions.append(allow, deny);
    const always = el("label", "agent-panel__always");
    const alwaysInput = document.createElement("input");
    alwaysInput.type = "checkbox";
    alwaysInput.addEventListener("pointerdown", (event) => event.stopPropagation());
    alwaysInput.addEventListener("change", () => this.setAlways(alwaysInput.checked));
    const alwaysLabel = el("span", "", "Always allow");
    always.append(alwaysInput, alwaysLabel);
    approvalBox.append(approvalTitle, approvalText, approvalActions, always);

    const actions = el("div", "agent-panel__actions");
    const pause = button("Pause", "btn", () => this.togglePause());
    const stop = button("Stop", "btn btn--danger", () => this.deps.session.stop("player"));
    const take = button("Take control", "btn", () => this.deps.session.takeControl("player"));
    const grant = button("Let agent play", "btn btn--primary", () => this.deps.session.grantControl("player"));
    actions.append(pause, stop, take, grant);

    const foot = el("div", "agent-panel__foot");

    body.append(objectiveRow, activityRow, controlRow, proposalRow, approvalBox, actions, foot);
    this.objectiveEl = objective;
    this.activityEl = activity;
    this.controlEl = control;
    this.proposalRow = proposalRow;
    this.proposalSummary = proposalSummary;
    this.proposalSkip = skip;
    this.proposalSteps = proposalSteps;
    this.approvalBox = approvalBox;
    this.approvalText = approvalText;
    this.alwaysAllow = alwaysInput;
    this.alwaysAllowLabel = alwaysLabel;
    this.pauseButton = pause;
    this.stopButton = stop;
    this.takeButton = take;
    this.grantButton = grant;
    this.footEl = foot;
  }

  update(view: AgentSessionView, force = false): void {
    const signature = [
      view.connected, view.agentName, view.mode, view.controlOwner, view.paused, view.objective, view.activity,
      view.task?.id, view.proposal?.proposedAtMs, view.proposal?.currentStep,
      view.proposal?.steps.map((step) => step.status[0]).join(""), view.pendingApproval?.id,
      view.autoApprove.control, view.autoApprove.trade, view.webmcp.binding, view.toolCalls,
    ].join("|");
    if (!force && signature === this.signature) return;
    this.signature = signature;
    this.objectiveEl.textContent = view.objective ?? "—";
    this.objectiveEl.classList.toggle("is-dim", !view.objective);
    this.activityEl.textContent = view.paused
      ? "Paused"
      : view.activity ?? (view.connected ? "Idle" : "Waiting for an agent");
    this.activityEl.classList.toggle("is-live", Boolean(view.task) && !view.paused);
    this.activityEl.classList.toggle("is-dim", !view.activity || view.paused);
    this.controlEl.textContent = view.controlOwner === "agent" ? "Agent is playing" : "You";
    this.controlEl.classList.toggle("is-live", view.controlOwner === "agent");

    const proposal = view.proposal;
    this.proposalRow.hidden = !proposal;
    if (proposal) {
      const finished = proposal.currentStep === null;
      this.proposalSummary.textContent = finished ? `${proposal.summary} — done` : proposal.summary;
      this.proposalSkip.hidden = finished;
      this.proposalSteps.replaceChildren(...proposal.steps.map((step, index) => {
        const item = document.createElement("li");
        item.textContent = step.text;
        item.classList.toggle("is-current", index === proposal.currentStep);
        item.classList.toggle("is-done", step.status === "done");
        item.classList.toggle("is-skipped", step.status === "skipped");
        if (index === proposal.currentStep) {
          item.title = step.target
            ? step.done === "arrive" ? "Clears when you get there" : "Marked in the world; the agent ticks it off"
            : "The agent ticks this off";
        }
        return item;
      }));
    }

    const approval = view.pendingApproval;
    this.approvalBox.hidden = !approval;
    if (approval) {
      this.approvalText.textContent = approval.description;
      this.alwaysAllow.checked = view.autoApprove[approval.kind];
      this.alwaysAllowLabel.textContent = approval.kind === "control" ? "Always let this agent play" : "Always allow trades";
    }

    this.pauseButton.textContent = view.paused ? "Resume" : "Pause";
    this.pauseButton.hidden = !view.connected;
    this.stopButton.hidden = !view.connected || (view.controlOwner !== "agent" && !view.task);
    this.takeButton.hidden = view.controlOwner !== "agent";
    this.grantButton.hidden = !view.connected || view.controlOwner === "agent" || Boolean(approval);

    const webmcp = view.webmcp;
    const status = webmcp.native
      ? `WebMCP · ${webmcp.toolCount} tools`
      : webmcp.binding === "polyfill"
        ? `WebMCP test shim · ${webmcp.toolCount} tools`
        : "WebMCP not available in this browser";
    this.footEl.textContent = status;
    this.footEl.title = webmcp.native || webmcp.binding === "polyfill"
      ? `Bound to ${webmcp.binding}`
      : "Open Corealm in a WebMCP-capable browser (Chrome with chrome://flags/#enable-webmcp-testing, or an agent's in-app browser) to let an AI play alongside you. window.corealm.agent is always available.";
    this.footEl.classList.toggle("is-warning", view.connected && !webmcp.native && webmcp.binding !== "polyfill");
  }

  private answer(approved: boolean): void {
    const request = this.deps.session.read().pendingApproval;
    if (!request) return;
    this.deps.session.answerApproval(request.id, approved, "player");
  }

  private setAlways(enabled: boolean): void {
    const request = this.deps.session.read().pendingApproval;
    this.deps.session.setAutoApprove(request ? request.kind : "control", enabled);
  }

  private togglePause(): void {
    const session = this.deps.session;
    if (session.read().paused) session.resume("player");
    else session.pause("player");
  }

}
