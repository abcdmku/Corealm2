/** Companion header and preferences. Detailed controls load when the panel is expanded. */
import type { AgentSession } from "../agent/session.js";
import type { AgentPanelBody } from "./agentPanelBody.js";

const STORE_KEY = "corealm.agentPanel.v1";

interface PanelPrefs {
  x: number | null;
  y: number | null;
  collapsed: boolean;
}

function loadPrefs(): PanelPrefs {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PanelPrefs>;
      return {
        x: typeof parsed.x === "number" ? parsed.x : null,
        y: typeof parsed.y === "number" ? parsed.y : null,
        collapsed: parsed.collapsed === true,
      };
    }
  } catch {
    // Private mode or a corrupt entry: the panel still works, it just forgets between sessions.
  }
  return { x: null, y: null, collapsed: true };
}

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

export interface AgentPanelDeps {
  session: AgentSession;
  /** Sim clock, for elapsed-time readouts. */
  now(): number;
}

export class AgentPanel {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly modeEl: HTMLElement;
  private readonly collapseButton: HTMLButtonElement;
  private readonly unsubscribe: () => void;
  private prefs: PanelPrefs = loadPrefs();
  private signature = "";
  private connected = false;
  private approvalId: string | null = null;
  private details: AgentPanelBody | null = null;
  private loading: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly deps: AgentPanelDeps) {
    const root = el("section", "agent-panel");
    root.setAttribute("aria-label", "AI agent");

    const header = el("header", "agent-panel__header");
    const dot = el("span", "agent-panel__dot");
    const name = el("span", "agent-panel__name u-truncate");
    const mode = el("span", "agent-panel__mode");
    const collapse = button("▾", "agent-panel__btn", () => this.setCollapsed(!this.prefs.collapsed));
    header.append(dot, name, mode, collapse);

    const body = el("div", "agent-panel__body");

    root.append(header, body);

    // Drag by the header, the movable-panel recipe: explicit left/top from the first move.
    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest("button")) return;
      const rect = root.getBoundingClientRect();
      const grabX = event.clientX - rect.left;
      const grabY = event.clientY - rect.top;
      const onMove = (move: PointerEvent) => {
        const left = Math.min(Math.max(move.clientX - grabX, 0), Math.max(0, window.innerWidth - rect.width));
        const top = Math.min(Math.max(move.clientY - grabY, 0), Math.max(0, window.innerHeight - 24));
        this.prefs.x = Math.round(left);
        this.prefs.y = Math.round(top);
        this.applyPosition();
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        this.save();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      event.preventDefault();
      event.stopPropagation();
    });

    this.root = root;
    this.body = body;
    this.nameEl = name;
    this.modeEl = mode;
    this.collapseButton = collapse;
    this.applyPosition();
    this.applyCollapsed();
    this.unsubscribe = deps.session.subscribe(() => this.update(true));
  }

  mount(parent: HTMLElement): void {
    if (this.disposed) return;
    parent.appendChild(this.root);
    this.update(true);
    if (!this.prefs.collapsed) this.loadBody();
  }

  update(force = false): void {
    if (this.disposed) return;
    const session = this.deps.session;
    session.expireStaleApproval();
    const view = session.read();
    this.details?.update(view, force);
    const signature = [view.connected, view.agentName, view.mode, view.controlOwner,
      view.paused, view.pendingApproval?.id, view.toolCalls].join("|");
    if (!force && signature === this.signature) return;
    this.signature = signature;
    const root = this.root;
    // Stay quiet during solo play, then expose a connection or approval as soon as it arrives.
    const approvalId = view.pendingApproval?.id ?? null;
    if ((view.connected && !this.connected) || (approvalId && approvalId !== this.approvalId)) {
      this.setCollapsed(false);
    }
    this.connected = view.connected;
    this.approvalId = approvalId;
    root.classList.toggle("is-disconnected", !view.connected);
    root.classList.toggle("mode-guide", view.mode === "guide");
    root.classList.toggle("mode-assist", view.mode === "assist");
    root.classList.toggle("mode-play", view.mode === "play");
    root.classList.toggle("is-controlling", view.controlOwner === "agent");
    root.classList.toggle("is-paused", view.paused);

    this.nameEl.textContent = view.connected ? view.agentName ?? "Agent" : "Agent companion";
    this.nameEl.title = view.connected ? `${view.agentName} · ${view.toolCalls} tool calls` : "No agent has connected yet";
    this.modeEl.textContent = !view.connected ? "Offline" : view.paused ? "paused" : view.mode;

  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.details = null;
    this.root.remove();
  }

  private loadBody(): void {
    if (this.disposed || this.loading || this.details) return;
    this.body.setAttribute("aria-busy", "true");
    this.body.textContent = "Loading companion controls...";
    this.loading = import("./agentPanelBody.js").then(({ AgentPanelBody }) => {
      if (this.disposed) return;
      this.body.replaceChildren();
      this.details = new AgentPanelBody(this.deps, this.body);
      // Session changes during the request belong to the new controls as well.
      this.details.update(this.deps.session.read(), true);
    }).catch((error: unknown) => {
      if (this.disposed) return;
      console.error("[ui] Could not load companion controls", error);
      this.body.replaceChildren(button("Retry companion controls", "btn", () => this.loadBody()));
    }).finally(() => {
      this.body.removeAttribute("aria-busy");
      this.loading = null;
    });
  }

  private setCollapsed(collapsed: boolean): void {
    this.prefs.collapsed = collapsed;
    this.applyCollapsed();
    this.save();
    if (!collapsed) this.loadBody();
  }

  private applyCollapsed(): void {
    this.body.hidden = this.prefs.collapsed;
    this.root.classList.toggle("is-collapsed", this.prefs.collapsed);
    this.collapseButton.textContent = this.prefs.collapsed ? "▸" : "▾";
    this.collapseButton.title = this.prefs.collapsed ? "Expand" : "Collapse";
    this.collapseButton.setAttribute("aria-label", this.prefs.collapsed ? "Expand agent companion" : "Collapse agent companion");
    this.collapseButton.setAttribute("aria-expanded", this.prefs.collapsed ? "false" : "true");
  }

  private applyPosition(): void {
    if (this.prefs.x === null || this.prefs.y === null) return;
    this.root.classList.add("is-moved");
    this.root.style.left = `${this.prefs.x}px`;
    this.root.style.top = `${this.prefs.y}px`;
  }

  private save(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.prefs));
    } catch {
      // Same tolerance as loadPrefs.
    }
  }
}
