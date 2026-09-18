/**
 * The bottom-left message log: game notices and multiplayer chat share one list.
 *
 * `ui/hud.ts` owns the instance and feeds it notices; `ui/multiplayerSocial.ts` feeds it chat
 * through `activeMessageLog()`. Every line carries a channel, and the player hides channels from
 * the chat bar's gear menu. Hidden channels are a client preference in localStorage, like the
 * quest tracker's pin.
 *
 * Lines are kept in memory, not only in the DOM, so a filter change or opening the chat can
 * repaint older history instead of losing whatever had scrolled out.
 */
import type { ChatChannel } from "../contracts.js";
import type { NoticeTone } from "./contextMenu.js";

export type MessageChannel = "game" | "warning" | ChatChannel;

export const MESSAGE_CHANNELS: readonly { id: MessageChannel; label: string }[] = [
  { id: "game", label: "Game messages" },
  { id: "warning", label: "Warnings" },
  { id: "nearby", label: "Nearby chat" },
  { id: "party", label: "Party chat" },
  { id: "whisper", label: "Whispers" },
];

export interface MessageLine {
  channel: MessageChannel;
  tone: NoticeTone;
  text: string;
  /** Chat lines lead with a speaker, drawn apart from the text. */
  speaker?: string;
}

/** Lines shown while the chat is closed. The log is read after the fact, so one busy exchange fits. */
const COLLAPSED_LIMIT = 8;
/** Lines kept, and shown in the scrollable log while the chat bar has focus. */
const HISTORY_LIMIT = 150;
/** Quiet time before the log dims. It dims; it never deletes. */
const IDLE_MS = 14_000;
const FILTER_KEY = "corealm.chatFilters.v1";

interface Entry { line: MessageLine; count: number; element: HTMLElement | null }

let active: MessageLog | null = null;

/** The mounted log, or null before the HUD exists. */
export function activeMessageLog(): MessageLog | null {
  return active;
}

function loadHidden(): Set<MessageChannel> {
  try {
    const parsed = JSON.parse(localStorage.getItem(FILTER_KEY) ?? "[]") as unknown;
    if (Array.isArray(parsed)) return new Set(MESSAGE_CHANNELS.map(channel => channel.id).filter(id => parsed.includes(id)));
  } catch {
    // Private mode or a corrupt entry: show everything.
  }
  return new Set();
}

export class MessageLog {
  readonly element: HTMLElement;
  private readonly entries: Entry[] = [];
  private readonly hidden = loadHidden();
  private expanded = false;
  private idleTimer: number | null = null;

  constructor() {
    const element = document.createElement("div");
    element.className = "msglog";
    element.setAttribute("role", "log");
    element.setAttribute("aria-live", "polite");
    // Reading or scrolling the open log must not take focus from the chat input.
    element.addEventListener("mousedown", event => event.preventDefault());
    this.element = element;
    active = this;
  }

  dispose(): void {
    if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.element.remove();
    if (active === this) active = null;
  }

  /**
   * Adds a line. Identical notices in a row collapse into a counter: an out-of-fuel warning can
   * fire every combat tick, and eight copies would push out the context that explains it.
   */
  push(line: MessageLine): void {
    const last = this.entries.at(-1);
    if (last && !line.speaker && !last.line.speaker && last.line.channel === line.channel && last.line.text === line.text) {
      last.count++;
      if (last.element) this.paint(last.element, last);
      this.wake();
      return;
    }
    const entry: Entry = { line, count: 1, element: null };
    this.entries.push(entry);
    if (this.entries.length > HISTORY_LIMIT) this.entries.shift()?.element?.remove();
    if (!this.hidden.has(line.channel)) {
      entry.element = this.render(entry);
      this.element.appendChild(entry.element);
      this.trim();
      if (this.expanded) this.element.scrollTop = this.element.scrollHeight;
    }
    this.wake();
  }

  /** The newest line's text, for the repeat checks callers make before pushing. */
  lastText(): string | null {
    return this.entries.at(-1)?.line.text ?? null;
  }

  isShown(channel: MessageChannel): boolean {
    return !this.hidden.has(channel);
  }

  setShown(channel: MessageChannel, shown: boolean): void {
    if (shown) this.hidden.delete(channel); else this.hidden.add(channel);
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify([...this.hidden]));
    } catch {
      // Still applies for this session.
    }
    this.repaint();
  }

  /** Open while the chat bar has focus: full history, scrollable, never dimmed. */
  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    this.element.classList.toggle("is-expanded", expanded);
    this.repaint();
    this.wake();
  }

  private repaint(): void {
    for (const entry of this.entries) entry.element = null;
    const shown = this.entries.filter(entry => !this.hidden.has(entry.line.channel));
    const visible = this.expanded ? shown : shown.slice(-COLLAPSED_LIMIT);
    this.element.replaceChildren(...visible.map(entry => (entry.element = this.render(entry))));
    if (this.expanded) this.element.scrollTop = this.element.scrollHeight;
  }

  private trim(): void {
    if (this.expanded) return;
    while (this.element.childElementCount > COLLAPSED_LIMIT) this.element.firstElementChild?.remove();
  }

  private render(entry: Entry): HTMLElement {
    const element = document.createElement("div");
    const { channel, tone } = entry.line;
    element.className = `msglog__line msglog__line--${tone} msglog__line--${channel}`;
    element.dataset["channel"] = channel;
    element.dataset["message"] = entry.line.text;
    this.paint(element, entry);
    return element;
  }

  private paint(element: HTMLElement, entry: Entry): void {
    const { speaker, text } = entry.line;
    const suffix = entry.count > 1 ? ` (x${entry.count})` : "";
    element.dataset["count"] = String(entry.count);
    if (!speaker) {
      element.textContent = text + suffix;
      return;
    }
    const name = document.createElement("span");
    name.className = "msglog__speaker";
    name.textContent = `${speaker}: `;
    element.replaceChildren(name, text + suffix);
  }

  private wake(): void {
    this.element.classList.remove("is-idle");
    if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      if (!this.expanded) this.element.classList.add("is-idle");
    }, IDLE_MS);
  }
}
