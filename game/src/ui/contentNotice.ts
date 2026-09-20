/**
 * "The server's content was updated": a line at the top of the screen with a Refresh button.
 *
 * A server tells its clients when an admin publishes content. The session keeps playing on the
 * catalog it joined with, and what changed reaches it the next time the page loads, so this only
 * offers the reload. It never interrupts play and never reloads on its own.
 */
import "./styles/social.css";

export class ContentNotice {
  private readonly root = document.createElement("div");
  constructor(reload: () => void = () => location.reload()) {
    this.root.className = "content-notice";
    this.root.hidden = true;
    this.root.setAttribute("role", "status");
    const text = document.createElement("span");
    text.textContent = "The server's content was updated. Refresh to load it.";
    const refresh = document.createElement("button");
    refresh.type = "button"; refresh.className = "btn btn--primary"; refresh.textContent = "Refresh";
    refresh.addEventListener("click", reload);
    const later = document.createElement("button");
    later.type = "button"; later.className = "btn btn--ghost"; later.textContent = "Later";
    later.addEventListener("click", () => { this.root.hidden = true; });
    this.root.append(text, refresh, later);
    document.body.append(this.root);
  }
  /** A second publish before the player answers shows the same line again. */
  show(): void { this.root.hidden = false; }
  /** Leaving the server takes its notice along. */
  clear(): void { this.root.hidden = true; }
}
