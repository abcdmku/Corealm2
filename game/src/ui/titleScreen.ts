/**
 * The title screen, and the pause menu — the same screen, raised at two different moments.
 *
 * The world boots and runs behind it rather than after it. That is deliberate: the boot sequence
 * already loads the save, builds the terrain, the navmesh and 892 entities before the first frame,
 * and gating that behind a button would mean either a long stare at a static image or a second
 * loading path. So the game is ready underneath and this sits on top of it.
 *
 * "Return to game" dismisses this screen. "New Game" is the only button that changes the
 * world: it clears the save and rebuilds, through the same `resetWorld` the debug surface uses.
 *
 * Three behaviours in here are load-bearing rather than decorative:
 *
 *  - The screen covers everything and opts into pointer events, so it MUST go back to
 *    `display: none` when closed. `.title[hidden]` in styles/title.css does that; without it a
 *    transparent sheet stays over the world and every click in the game stops working.
 *  - Escape is pushed onto the registry's escape stack while open, which is what makes the second
 *    Escape close the menu. `input.cancel` (priority 900) runs that stack before `ui.menu` (950)
 *    gets the key, so an open menu is closed rather than reopened.
 *  - Keydowns that land inside the card stop there. Focus is inside the dialog while it is open, so
 *    without this "W" would walk the player around behind the menu and "I" would open the pack
 *    under it. Keyups are deliberately let through: swallowing the release of a key held before the
 *    menu opened would leave it held forever.
 *
 * "New game" always asks first. It is the one button that can throw away a character, and a player
 * who loses Mining 10 to a stray click does not come back — so the destructive answer is behind an
 * acknowledgement it takes a second, separate act to give.
 */
import { keybindings } from "../input/keyboard.js";
import type { Unregister } from "../input/keyboard.js";

/** Root-owned persistence actions. These controls never read or write browser storage. */
export interface SaveRecoveryControls {
  getRecovery(): { reason: string; raw: string | null } | null;
  recoverSave(json: string): { ok: boolean; reason?: string } | Promise<{ ok: boolean; reason?: string }>;
}

export interface TitleScreenOptions {
  /** True when a save was found, for the new-game confirmation. */
  hasSave(): boolean;
  /** Clears the save and rebuilds the world. Wired by the root to `resetWorld`. */
  onNewGame(): void;
  /** Opens the client settings panel. */
  onSettings(): void;
  /** Dismisses. Called on Return to game and on Escape. */
  onClose(): void;
  /** Present when the root exposes recovery of a rejected saved character. */
  saveRecovery?: SaveRecoveryControls;
}

type View = "menu" | "confirm";

export class TitleScreen {
  private readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private view: View = "menu";
  private popEscape: Unregister | null = null;
  private restoreFocus: HTMLElement | null = null;
  private covered = false;
  private disposed = false;

  constructor(private readonly options: TitleScreenOptions) {
    const root = document.createElement("section");
    root.className = "title";
    root.hidden = true;
    root.tabIndex = -1;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Corealm");

    const card = document.createElement("div");
    card.className = "title__card";
    root.appendChild(card);

    this.root = root;
    this.card = card;

    root.addEventListener("keydown", this.onKeyDown);
    // A click on the backdrop must not blur the dialog: focus outside it would put the movement
    // keys back on the world while the menu is still covering it.
    root.addEventListener("mousedown", (event) => {
      if (event.target === root && document.activeElement !== root) {
        event.preventDefault();
        root.focus({ preventScroll: true });
      }
    });

    this.render();
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);
  }

  isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    if (this.isOpen()) return;
    this.covered = false;
    this.root.inert = false;
    this.root.removeAttribute("aria-hidden");
    this.restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.view = "menu";
    this.render();
    this.root.hidden = false;

    // Escape backs out one step: out of the confirmation first, out of the menu second.
    this.installEscapeHandler();

    this.focusFirst();
  }

  close(): void {
    if (!this.isOpen()) return;
    this.root.hidden = true;
    this.covered = false;
    this.root.inert = false;
    this.root.removeAttribute("aria-hidden");
    this.popEscape?.();
    this.popEscape = null;
    // Next time it opens it opens on the menu, never mid-confirmation.
    this.view = "menu";

    const restore = this.restoreFocus;
    this.restoreFocus = null;
    if (restore && restore.isConnected && !this.root.contains(restore)) {
      restore.focus({ preventScroll: true });
    } else if (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.popEscape?.();
    this.popEscape = null;
    this.root.remove();
  }

  /**
   * Keeps the pause backdrop in place while a child modal owns focus. The title dialog is removed
   * from both keyboard navigation and the accessibility tree until that modal closes.
   */
  setCovered(covered: boolean): void {
    if (this.disposed || !this.isOpen() || this.covered === covered) return;
    this.covered = covered;
    this.root.inert = covered;
    if (covered) {
      this.root.setAttribute("aria-hidden", "true");
      this.popEscape?.();
      this.popEscape = null;
      return;
    }

    this.root.removeAttribute("aria-hidden");
    // Recovery can complete in Settings while this menu is covered.
    this.render();
    this.installEscapeHandler();
    this.focusFirst();
  }

  // ------------------------------------------------------------------ keys

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // Escape belongs to the registry, which owns the "close the top thing" order.
    if (event.key === "Escape") return;

    if (event.key === "Tab") {
      this.wrapFocus(event);
      return;
    }

    // Everything else dies here rather than reaching the window listener behind the menu.
    // stopPropagation, not preventDefault: Enter and Space must still press the focused button.
    event.stopPropagation();
  };

  private installEscapeHandler(): void {
    this.popEscape?.();
    this.popEscape = keybindings.pushEscapeHandler(() => {
      if (!this.isOpen() || this.covered) return false;
      if (this.view === "confirm") {
        this.setView("menu");
        return true;
      }
      this.options.onClose();
      return true;
    });
  }

  /** Tab stays inside the card. A menu you can tab out of is a menu you can lose. */
  private wrapFocus(event: KeyboardEvent): void {
    event.stopPropagation();
    const stops = [...this.card.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), a[href], [tabindex='0']",
    )];
    if (stops.length === 0) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === this.root)) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  private focusFirst(): void {
    const target = this.card.querySelector<HTMLElement>("[data-autofocus]")
      ?? this.card.querySelector<HTMLElement>("button:not([disabled])");
    (target ?? this.root).focus({ preventScroll: true });
  }

  // --------------------------------------------------------------- drawing

  private setView(view: View): void {
    if (this.view === view) return;
    this.view = view;
    this.render();
    this.focusFirst();
  }

  private render(): void {
    this.card.replaceChildren();
    this.card.dataset["view"] = this.view;
    if (this.view === "confirm") this.renderConfirm();
    else this.renderMenu();
  }

  /**
   * The menu. The mark and its letter-spacing are the boot screen's, deliberately: the player has
   * been looking at exactly that word for the last second and a half.
   */
  private renderMenu(): void {
    const recovery = this.options.saveRecovery?.getRecovery();
    const eyebrow = document.createElement("p");
    eyebrow.className = "title__eyebrow u-caps";
    eyebrow.textContent = "Game menu";

    const mark = document.createElement("h1");
    mark.className = "title__mark";
    mark.textContent = "COREALM";

    const tagline = document.createElement("p");
    tagline.className = "title__tagline";
    tagline.textContent = recovery
      ? "Your saved character could not be loaded. Saving is paused so the original stays protected."
      : "The world continues while this menu is open.";

    const actions = document.createElement("div");
    actions.className = "title__actions";

    const resume = this.button(recovery ? "Continue without saving" : "Return to game",
      recovery ? "btn title__action" : "btn btn--primary title__action", () => {
      this.options.onClose();
    });
    if (!recovery) resume.dataset["autofocus"] = "true";

    const fresh = this.button("New game", "btn title__action", () => this.setView("confirm"));
    const settings = this.button("Settings", "btn title__action", () => this.options.onSettings());
    const guide = document.createElement("a");
    guide.className = "btn title__action";
    guide.href = new URL("docs/", document.baseURI).href;
    guide.target = "_blank";
    guide.rel = "noopener noreferrer";
    guide.textContent = "Game guide";
    guide.setAttribute("aria-label", "Open the game guide in a new tab");

    if (recovery) {
      const recover = this.button("Recover save", "btn btn--primary title__action", () => this.options.onSettings());
      recover.dataset["autofocus"] = "true";
      actions.appendChild(recover);
    }
    actions.append(resume, fresh, settings, guide);

    const hint = document.createElement("p");
    hint.className = "title__hint";
    hint.append(cap("Esc"), text(" returns to the world. "), cap("H"), text(" lists every key."));

    this.card.append(eyebrow, mark);
    if (recovery) {
      const warning = document.createElement("h2");
      warning.className = "title__warning";
      warning.textContent = "Save needs recovery";
      this.card.appendChild(warning);
    }
    this.card.append(tagline, actions, hint);
  }

  /**
   * The confirmation. Two rules: the safe answer is the one under the cursor and under the focus
   * ring, and the destructive one cannot be pressed until the player has said, separately, that
   * they know what it does.
   */
  private renderConfirm(): void {
    const recovery = this.options.saveRecovery?.getRecovery();
    const hasSave = this.options.hasSave() || Boolean(recovery);

    const eyebrow = document.createElement("p");
    eyebrow.className = "title__eyebrow u-caps";
    eyebrow.textContent = "New game";

    const heading = document.createElement("h2");
    heading.className = "title__warning";
    heading.textContent = recovery ? "This deletes the protected save."
      : hasSave ? "This deletes your save." : "This throws away this run.";

    const body = document.createElement("p");
    body.className = "title__tagline";
    body.textContent = recovery
      ? "The original save will be deleted and replaced with a new character. Download it from"
        + " Recover save first if you want to keep a copy. Your settings are kept."
      : hasSave
      ? "Every level, every item and every quest on this character goes, the world is rebuilt from"
        + " scratch, and there is no undo. Your settings are kept."
      : "The world is rebuilt from scratch and anything you have done in this session goes with it."
        + " Your settings are kept.";

    const acknowledge = document.createElement("label");
    acknowledge.className = "title__ack";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "title__ack-box";

    const ackText = document.createElement("span");
    ackText.textContent = recovery
      ? "I understand the protected original save will be deleted."
      : hasSave
      ? "I understand my saved character will be deleted."
      : "I understand this run will be thrown away.";

    acknowledge.append(box, ackText);

    const actions = document.createElement("div");
    actions.className = "title__actions title__actions--confirm";

    const keep = this.button(recovery ? "Keep original save" : "Keep playing",
      "btn btn--primary title__action", () => this.setView("menu"));
    // The safe answer holds the focus ring: Enter on this screen must never be the one that deletes.
    keep.dataset["autofocus"] = "true";

    const destroy = this.button(
      hasSave ? "Delete save and start over" : "Start over",
      "btn btn--danger title__action",
      () => {
        if (!box.checked) return;
        this.options.onNewGame();
      },
    );
    destroy.disabled = true;

    box.addEventListener("change", () => {
      destroy.disabled = !box.checked;
    });

    actions.append(keep, destroy);

    this.card.append(eyebrow, heading, body, acknowledge, actions);
  }

  private button(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }
}

/** A key drawn as a key, following `.dock__key` — the game's existing "this is a thing you press". */
function cap(key: string): HTMLElement {
  const node = document.createElement("kbd");
  node.className = "title__cap";
  node.textContent = key;
  return node;
}

function text(value: string): Text {
  return document.createTextNode(value);
}
