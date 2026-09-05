import { PanelFrame } from "./panelFrame.js";
/**
 * The conversation window.
 *
 * Phase 1 shipped 12 NPCs, a broad dialogue tree, and no way for a human to see any of it. Every one
 * of the nine quests is started or finished through dialogue — including `cold_iron`, the tutorial — so
 * until this panel exists a human player can gather, craft, fight, bank, shop and reach level 10 in
 * all ten skills without being able to begin a single quest. An agent could talk the whole time,
 * through `corealm_dialogue`. This is the missing half of that surface.
 *
 * The root opens and closes it from the `dialogue.opened` / `dialogue.closed` events, so a
 * conversation started by a mouse click, by the context menu, or by an agent all raise the same
 * window. It never opens itself.
 *
 * ---------------------------------------------------------------------------------------------
 * THREE THINGS THIS PANEL EXISTS TO GET RIGHT
 * ---------------------------------------------------------------------------------------------
 *
 * 1. **The transcript.** `DialogueView` is one node: the line you are being told right now and the
 *    replies available. Everything already said is gone. That is fine for an agent, which holds the
 *    whole exchange in its context, and unfair to a human, because several of these trees are
 *    inference puzzles and the premises arrive a node before the question. Cairnkeeper Ode names
 *    three mason's marks, says what each one means, quotes the ordering rule, and offers all six
 *    permutations; at 1280x720 the six answers alone fill the window, so the rule she just told you
 *    is off the top of it. So this panel keeps its own scrollback, built from the views it has
 *    rendered and the replies the player picked, and the conversation reads as a conversation.
 *    Nothing else stores this: the game's dialogue state is a single node id by design and should
 *    stay that way.
 *
 * 2. **Disabled options stay visible and say why.** `systems/dialogue.ts` goes to real trouble to
 *    return a locked option with a plain-English `disabledReason` rather than dropping it, and the
 *    reasons are written to be read ("Ode will not send anyone under Melee 10 up the terraces.
 *    Cairnwights hold the ground at (100, -110).") That sentence is the quest pointer. Putting it
 *    in a `title=` tooltip would hide the game's own signposting behind a hover nobody performs, so
 *    it is printed under the option. A locked option is therefore NOT a `disabled` button: the
 *    shared `.btn[disabled]` rule fades to 50% opacity and desaturates, which is right for a button
 *    and wrong for a sentence you are meant to act on. It is a button with `aria-disabled`, drawn
 *    as a closed door, with its reason at full contrast.
 *
 * 3. **Keyboard first.** A player mid-quest should not have to find a 30 px target with the mouse.
 *    1-9 pick, Enter takes the first available reply, Escape leaves. The bindings are registered on
 *    open and dropped on close, through `ctx.registry`, so they appear in the Controls panel while
 *    a conversation is live and do not eat number keys the rest of the time. WASD is untouched:
 *    movement is polled from held keys in `input/keyboard.ts` and this panel claims no key it does
 *    not handle.
 */
import type { DialogueView } from "../contracts.js";
import type { Unregister } from "../input/keyboard.js";
import type { ManagedPanel, UiContext } from "./panels.js";
import { report } from "./panels.js";

/**
 * One line of the transcript. `you` turns are the reply the player chose to leave a node, which is
 * the only half of the exchange the game does not model at all.
 */
interface Turn {
  who: "npc" | "you";
  speaker: string;
  text: string;
}

/**
 * Scrollback depth. Twelve turns is six full exchanges, which reaches back past the premises of
 * every puzzle in `content/dialogue.ts` while keeping the DOM small enough to rebuild on a choice.
 */
const MAX_TURNS = 12;

/** Only the first nine options get a number. No node in Phase 1 shows more than eight. */
const NUMBER_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export class DialoguePanel implements ManagedPanel {
  readonly frame: PanelFrame;
  private readonly body: HTMLElement;
  private readonly scroll: HTMLElement;
  private readonly log: HTMLElement;
  private readonly choices: HTMLElement;

  private signature = "";
  /** The exchange so far, oldest first, NOT including the line currently on screen. */
  private history: Turn[] = [];
  /** The view behind the current render, kept so a choice can push it into the transcript. */
  private rendered: DialogueView | null = null;
  /** The option buttons of the current node, in the order they are numbered. */
  private buttons: HTMLButtonElement[] = [];
  private bindings: Unregister[] = [];

  constructor(private readonly ctx: UiContext) {
    this.frame = new PanelFrame({
      id: "dialogue",
      title: "Conversation",
      // No key. You do not open a conversation with a keystroke; you talk to somebody.
      registry: ctx.registry,
      // Low and centred, above the dock. A conversation you cannot see the speaker through is a
      // menu, and the whole point of an NPC standing in the world is that you can look at them.
      //
      // `PanelFrame` writes placement as inline style, which beats any media query, so the height
      // cap is a formula rather than a breakpoint, and the width is left to dialogue.css — that one
      // the frame only sets when asked.
      //
      // `100vh - 268px` keeps a fixed band of world above the window instead of a fixed fraction of
      // it. A percentage looked fine at 900 and starved the speech at 720: Ode's lever node is four
      // paragraphs and seven replies, and at 56vh the replies alone filled the box and pushed every
      // word she said off the top. The 480px ceiling stops it sprawling on a tall screen.
      placement: { bottom: "96px", left: "50%", maxHeight: "min(calc(100vh - 268px), 480px)" },
      onOpen: () => this.claimKeys(),
      onClose: () => {
        this.releaseKeys();
        this.endConversation();
      },
    });

    this.body = document.createElement("div");
    this.body.className = "dialogue";

    // The transcript and the replies scroll as ONE column, held at its bottom.
    //
    // The first cut gave each its own scroll box and Ode's lever node — four paragraphs and seven
    // replies — sliced the fourth reply in half against the edge of a container with no visible
    // scrollbar. Pinning the replies is only worth anything if they all fit, and here they cannot.
    // Anchoring one column to the bottom instead means the replies are always the thing you can
    // see, the speech scrolls up behind them, and nothing is ever cut off mid-row.
    this.scroll = document.createElement("div");
    this.scroll.className = "dialogue__scroll";
    this.scroll.addEventListener("scroll", () => this.markScrolled(), { passive: true });

    this.log = document.createElement("div");
    this.log.className = "dialogue__log";
    this.log.setAttribute("role", "log");

    this.choices = document.createElement("div");
    this.choices.className = "dialogue__choices";
    this.choices.setAttribute("role", "group");
    this.choices.setAttribute("aria-label", "Replies");

    const hint = document.createElement("p");
    hint.className = "dialogue__hint u-caps";
    hint.append(
      keyCap("1"), text("–"), keyCap("9"), text(" reply"),
      text(" · "), keyCap("Enter"), text(" first"),
      text(" · "), keyCap("Esc"), text(" leave"),
    );

    this.scroll.append(this.log, this.choices);
    this.body.append(this.scroll, hint);
    this.frame.body.appendChild(this.body);
  }

  /** The open conversation, or null when there is none. */
  view(): DialogueView | null {
    const result = this.ctx.api.dialogue("state");
    return result.ok ? result.value : null;
  }

  refresh(force = false): void {
    const view = this.view();
    if (!view) {
      if (this.frame.isOpen()) this.frame.close();
      return;
    }

    const signature = `${view.npcId}|${view.text}|${view.options.map((o) => `${o.id}:${o.enabled}`).join(",")}`;
    if (!force && signature === this.signature) return;
    this.signature = signature;
    this.rendered = view;

    this.frame.setSubtitle(view.speaker);
    this.paintLog(view);
    this.paintChoices(view);

    // Held at the bottom, which is where the replies are. Everything already said scrolls up out
    // of the way but stays one drag away, which is the whole point of keeping a transcript.
    this.scroll.scrollTop = this.scroll.scrollHeight;
    this.markScrolled();
  }

  /**
   * Fades whichever edge has more behind it. A line cut in half by a container edge reads as a
   * rendering fault; the same line fading out reads as "keep scrolling", which is what it is.
   */
  private markScrolled(): void {
    const { scrollTop, scrollHeight, clientHeight } = this.scroll;
    this.scroll.classList.toggle("has-more-above", scrollTop > 2);
    this.scroll.classList.toggle("has-more-below", scrollTop + clientHeight < scrollHeight - 2);
  }

  /** Called by the root when a conversation opens. A new conversation starts a new transcript. */
  openFor(): void {
    const view = this.view();
    if (!view) return;
    this.history = [];
    this.rendered = null;
    this.signature = "";
    this.refresh(true);
    this.frame.open();
  }

  // ------------------------------------------------------------------ paint

  /** The transcript: everything already said, then the line on the table now. */
  private paintLog(view: DialogueView): void {
    this.log.replaceChildren();
    for (const turn of this.history) this.log.appendChild(renderTurn(turn, false));
    this.log.appendChild(renderTurn({ who: "npc", speaker: view.speaker, text: view.text }, true));
  }

  private paintChoices(view: DialogueView): void {
    const hadFocus = this.body.contains(document.activeElement);
    this.choices.replaceChildren();
    this.buttons = [];

    if (view.options.length === 0) {
      // No authored way out. Never happens in Phase 1 content, but a dead conversation with no
      // visible exit would be the worst possible failure of this panel.
      const leave = document.createElement("button");
      leave.type = "button";
      leave.className = "dialogue__option";
      leave.dataset["autofocus"] = "";
      leave.append(numberBadge(1), optionLabel("Leave."));
      leave.addEventListener("click", () => this.frame.close());
      this.buttons.push(leave);
      this.choices.appendChild(leave);
      return;
    }

    let autofocused = false;
    view.options.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dialogue__option";
      button.append(numberBadge(index + 1), optionLabel(option.text));

      if (option.enabled) {
        button.addEventListener("click", () => this.choose(option.id));
        if (!autofocused) {
          autofocused = true;
          button.dataset["autofocus"] = "";
        }
      } else {
        button.classList.add("dialogue__option--locked");
        button.setAttribute("aria-disabled", "true");
        // Content, not chrome. This sentence is how the player learns what to go and do.
        if (option.disabledReason) {
          const reason = document.createElement("span");
          reason.className = "dialogue__reason";
          reason.textContent = option.disabledReason;
          button.appendChild(reason);
        }
        button.addEventListener("click", () => this.refuse(button));
      }

      this.buttons.push(button);
      this.choices.appendChild(button);
    });

    // Focus follows the conversation, but only if it was already in here. Advancing a node must not
    // yank focus out of the inventory a player left open behind this window.
    if (hadFocus) {
      const target = this.choices.querySelector<HTMLElement>("[data-autofocus]") ?? this.buttons[0];
      target?.focus({ preventScroll: true });
    }
  }

  // ----------------------------------------------------------------- acting

  private choose(optionId: string): void {
    const previous = this.rendered;
    const reply = previous?.options.find((option) => option.id === optionId);
    if (reply && !reply.enabled) return;

    const result = this.ctx.api.dialogue("choose", optionId);
    // A refused choice is reported with the system's own sentence rather than swallowed.
    if (!report(result)) return;

    // The exchange only becomes history once the game has accepted it.
    if (previous) {
      this.push({ who: "npc", speaker: previous.speaker, text: previous.text });
      if (reply) this.push({ who: "you", speaker: "You", text: reply.text });
    }

    this.refresh(true);
    this.ctx.refresh();
  }

  private push(turn: Turn): void {
    this.history.push(turn);
    if (this.history.length > MAX_TURNS) this.history.splice(0, this.history.length - MAX_TURNS);
  }

  /**
   * The player asked for a locked reply anyway — pressed its number, or clicked it.
   *
   * The reason is already printed underneath, so this only has to answer "yes, that one, and no":
   * the row is brought into view and lit until the conversation moves. Deliberately not a timed
   * flash. A flash is unverifiable in a screenshot, it is missable at a glance, and a player who
   * pressed 3 twice deserves the same answer both times.
   */
  private refuse(button: HTMLButtonElement): void {
    for (const other of this.buttons) other.classList.toggle("is-refused", other === button);
    button.scrollIntoView({ block: "nearest" });
  }

  /** Ends the conversation in the game when the window is dismissed, so state cannot drift. */
  private endConversation(): void {
    if (this.view()) this.ctx.api.dialogue("end");
  }

  // ------------------------------------------------------------------- keys

  /**
   * Claimed on open, dropped on close. Registered through `ctx.registry` so the Controls panel
   * lists them while a conversation is live, and so nothing owns the number row otherwise.
   */
  private claimKeys(): void {
    if (this.bindings.length > 0) return;
    const registry = this.ctx.registry;

    this.bindings.push(registry.register({
      id: "dialogue.reply",
      keys: [...NUMBER_KEYS],
      label: "Pick a reply",
      group: "Conversation",
      priority: 50,
      onDown: (event) => {
        const index = NUMBER_KEYS.indexOf(event.key as (typeof NUMBER_KEYS)[number]);
        if (index < 0) return false;
        const button = this.buttons[index];
        if (!button) return false;
        button.click();
        return true;
      },
    }));

    this.bindings.push(registry.register({
      id: "dialogue.first",
      keys: ["enter"],
      label: "Take the first available reply",
      group: "Conversation",
      priority: 50,
      onDown: () => {
        // A focused option is already an Enter target; claiming the key here would fire it twice.
        const active = document.activeElement;
        if (active instanceof HTMLElement && this.choices.contains(active)) return false;
        const first = this.buttons.find((button) => !button.hasAttribute("aria-disabled"));
        if (!first) return false;
        first.click();
        return true;
      },
    }));

    this.bindings.push(registry.register({
      id: "dialogue.leave",
      keys: ["escape"],
      label: "End the conversation",
      group: "Conversation",
      // Ahead of `input.cancel` (900), but only when this is the panel Escape should be closing.
      priority: 50,
      onDown: () => {
        if (!this.frame.isOpen() || !this.isTopPanel()) return false;
        this.frame.close();
        return true;
      },
    }));
  }

  private releaseKeys(): void {
    for (const drop of this.bindings) drop();
    this.bindings = [];
  }

  /**
   * True when no panel opened after this one is still open.
   *
   * `PanelFrame.open` raises every panel to a rising z-index, and it is the only thing that pushes
   * an Escape handler, so inline z-index order and the registry's Escape stack are the same order.
   * Reading it here lets Escape end the conversation without stealing the key from a window the
   * player opened on top of it, which is the PRD's "close the top panel" rule.
   */
  private isTopPanel(): boolean {
    const mine = Number.parseInt(this.frame.root.style.zIndex, 10);
    if (!Number.isFinite(mine)) return true;
    const panels = document.querySelectorAll<HTMLElement>(".panel:not([hidden])");
    for (const panel of panels) {
      if (panel === this.frame.root) continue;
      const other = Number.parseInt(panel.style.zIndex, 10);
      if (Number.isFinite(other) && other > mine) return false;
    }
    return true;
  }

  dispose(): void {
    this.releaseKeys();
    this.frame.dispose();
  }
}

// ------------------------------------------------------------------ pieces

function text(value: string): Text {
  return document.createTextNode(value);
}

function keyCap(label: string): HTMLElement {
  const cap = document.createElement("kbd");
  cap.className = "dialogue__cap";
  cap.textContent = label;
  return cap;
}

function numberBadge(number: number): HTMLElement {
  const badge = document.createElement("kbd");
  badge.className = "dialogue__cap dialogue__num";
  badge.textContent = number <= NUMBER_KEYS.length ? String(number) : "·";
  badge.setAttribute("aria-hidden", "true");
  return badge;
}

function optionLabel(value: string): HTMLElement {
  const label = document.createElement("span");
  label.className = "dialogue__option-text";
  label.textContent = value;
  return label;
}

/**
 * One turn. Node text carries authored blank lines — Ode's lever riddle is three paragraphs and
 * reads as one wall without them — so it is split rather than dropped into a single element.
 */
function renderTurn(turn: Turn, current: boolean): HTMLElement {
  const block = document.createElement("div");
  block.className = `dialogue__turn dialogue__turn--${turn.who}`;
  if (current) block.classList.add("is-current");

  const who = document.createElement("div");
  who.className = "dialogue__who u-caps";
  who.textContent = turn.speaker;
  block.appendChild(who);

  const said = document.createElement("div");
  said.className = "dialogue__said";
  for (const paragraph of turn.text.split(/\n{2,}/)) {
    const line = document.createElement("p");
    line.textContent = paragraph.replace(/\n/g, " ").trim();
    said.appendChild(line);
  }
  block.appendChild(said);

  return block;
}
