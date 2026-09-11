/**
 * The pinned-quest tracker: one quest's card floating over the world, so the player can follow an
 * objective without holding the journal open.
 *
 * Pin/unpin comes from the Quests panel through `UiContext.pinQuest`. The card defaults to the
 * left middle of the screen, drags by its header, and collapses to just the header. Pin choice,
 * dragged position and collapsed state persist in localStorage — they are client preferences,
 * like the settings store, not save data.
 *
 * The active hunt rides on the same card, under the quest, as one line and a bar: the target,
 * the region, kills so far. It needs no pin, because there is only ever one, and the card shows
 * for a hunt alone when no quest is pinned. Accepting, claiming and abandoning stay in the journal.
 *
 * Repaints follow the panels' signature rule: `update()` runs at the panel cadence and touches
 * the DOM only when the quest's stage, objective or status actually changed.
 */
import type { GameApi, QuestId, QuestSummary } from "../contracts.js";
import type { HuntContractsSystem, HuntProgress } from "../systems/huntContracts.js";
import { isSmallScreen } from "./mobileLayout.js";
import type { Tooltip } from "./tooltips.js";

const STORE_KEY = "corealm.questTracker.v1";

interface TrackerState {
  questId: QuestId | null;
  /** Dragged position, viewport px. Null means the default left-middle placement. */
  x: number | null;
  y: number | null;
  collapsed: boolean;
}

function loadState(): TrackerState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TrackerState>;
      return {
        questId: typeof parsed.questId === "string" ? parsed.questId : null,
        x: typeof parsed.x === "number" ? parsed.x : null,
        y: typeof parsed.y === "number" ? parsed.y : null,
        collapsed: parsed.collapsed === true,
      };
    }
  } catch {
    // Private mode or a corrupt entry: the tracker still works, it just forgets between sessions.
  }
  return { questId: null, x: null, y: null, collapsed: false };
}

export class QuestTracker {
  private readonly root: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly stageEl: HTMLElement;
  private readonly body: HTMLElement;
  private readonly objectiveEl: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly collapseButton: HTMLButtonElement;
  private readonly questCard: HTMLElement;
  private readonly huntCard: HTMLElement;
  private readonly huntNameEl: HTMLElement;
  private readonly huntCountEl: HTMLElement;
  private readonly huntPlaceEl: HTMLElement;
  private readonly huntFill: HTMLElement;
  private state: TrackerState = loadState();
  private signature = "";

  constructor(
    private readonly api: GameApi,
    private readonly hunts: () => HuntContractsSystem | null = () => null,
    private readonly tooltip?: Pick<Tooltip, "attach">,
  ) {
    const root = document.createElement("section");
    root.className = "quest-tracker";
    root.hidden = true;
    root.setAttribute("aria-label", "Tracked quest");

    const header = document.createElement("header");
    header.className = "quest-tracker__header";

    const name = document.createElement("span");
    name.className = "quest-tracker__name u-truncate";

    const stage = document.createElement("span");
    stage.className = "quest-tracker__stage u-numeric";

    const collapse = document.createElement("button");
    collapse.type = "button";
    collapse.className = "quest-tracker__btn";
    collapse.addEventListener("click", () => this.setCollapsed(!this.state.collapsed));

    const unpin = document.createElement("button");
    unpin.type = "button";
    unpin.className = "quest-tracker__btn";
    unpin.textContent = "×";
    unpin.setAttribute("aria-label", "Unpin quest");
    this.tooltip?.attach(unpin, () => ({
      kind: "text",
      title: "Unpin quest",
      lines: ["Remove the quest from the tracker."],
    }));
    unpin.addEventListener("click", () => this.pin(null));

    this.tooltip?.attach(name, () => ({
      kind: "text",
      title: "Tracked quest",
      lines: [this.nameEl.textContent ?? ""].filter(Boolean),
    }));
    this.tooltip?.attach(collapse, () => ({
      kind: "text",
      title: this.state.collapsed ? "Expand tracker" : "Collapse tracker",
      lines: [this.state.collapsed ? "Show the tracked objective." : "Hide the tracked objective."],
    }));

    header.append(name, stage, collapse, unpin);

    const body = document.createElement("div");
    body.className = "quest-tracker__body";

    const objective = document.createElement("p");
    objective.className = "quest-tracker__objective";

    const bar = document.createElement("div");
    bar.className = "bar bar--thin quest-tracker__progress";
    const fill = document.createElement("div");
    fill.className = "bar__fill";
    bar.appendChild(fill);

    body.append(objective, bar);

    const questCard = document.createElement("div");
    questCard.className = "quest-tracker__quest";
    questCard.append(header, body);

    // The hunt line: caption, target, count, then a bar. Hidden until a hunt is accepted.
    const huntCard = document.createElement("div");
    huntCard.className = "quest-tracker__hunt";
    huntCard.hidden = true;

    const huntHead = document.createElement("div");
    huntHead.className = "quest-tracker__hunt-head";
    const huntCaption = document.createElement("span");
    huntCaption.className = "quest-tracker__hunt-caption";
    huntCaption.textContent = "Hunt";
    const huntName = document.createElement("span");
    huntName.className = "quest-tracker__hunt-name u-truncate";
    this.tooltip?.attach(huntName, () => ({
      kind: "text",
      title: "Hunt target",
      lines: [this.huntNameEl.textContent ?? ""].filter(Boolean),
    }));

    const huntCount = document.createElement("span");
    huntCount.className = "quest-tracker__stage u-numeric";
    huntHead.append(huntCaption, huntName, huntCount);

    const huntPlace = document.createElement("span");
    huntPlace.className = "quest-tracker__hunt-place";

    const huntBar = document.createElement("div");
    huntBar.className = "bar bar--thin quest-tracker__progress";
    const huntFill = document.createElement("div");
    huntFill.className = "bar__fill";
    huntBar.appendChild(huntFill);
    huntCard.append(huntHead, huntPlace, huntBar);

    root.append(questCard, huntCard);

    // Drag by anything that is not a button, exactly the movable-panel recipe: explicit left/top
    // from the first move, transform killed so the default translateY(-50%) centring cannot
    // double-count. The whole card, because with only a hunt showing there is no header.
    root.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest("button")) return;
      // A phone pins the card under the vitals; the stylesheet owns its place there.
      if (isSmallScreen()) return;
      const rect = root.getBoundingClientRect();
      const grabX = event.clientX - rect.left;
      const grabY = event.clientY - rect.top;
      const onMove = (move: PointerEvent) => {
        const left = Math.min(Math.max(move.clientX - grabX, 0), Math.max(0, window.innerWidth - rect.width));
        const top = Math.min(Math.max(move.clientY - grabY, 0), Math.max(0, window.innerHeight - 24));
        this.state.x = Math.round(left);
        this.state.y = Math.round(top);
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
    });

    this.root = root;
    this.nameEl = name;
    this.stageEl = stage;
    this.body = body;
    this.objectiveEl = objective;
    this.fill = fill;
    this.collapseButton = collapse;
    this.questCard = questCard;
    this.huntCard = huntCard;
    this.huntNameEl = huntName;
    this.huntCountEl = huntCount;
    this.huntPlaceEl = huntPlace;
    this.huntFill = huntFill;
    this.applyPosition();
    this.applyCollapsed();
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);
    this.update(true);
  }

  pin(questId: QuestId | null): void {
    if (this.state.questId === questId) questId = null; // pinning the pinned quest unpins it
    this.state.questId = questId;
    this.save();
    this.update(true);
  }

  pinnedId(): QuestId | null {
    return this.state.questId;
  }

  update(force = false): void {
    const id = this.state.questId;
    let quest = id ? this.api.getQuests().find((entry) => entry.id === id) ?? null : null;
    if (id && !quest) {
      // The pinned quest no longer exists (new game, content change): let go quietly.
      this.state.questId = null;
      this.save();
    }
    const hunt = this.activeHunt();

    const signature = (quest ? `${quest.id}:${quest.status}:${quest.stage}:${quest.currentObjective ?? ""}` : "")
      + `#${hunt ? `${hunt.offer.id}:${hunt.status}:${hunt.kills}` : ""}`;
    if (!force && signature === this.signature) return;
    this.signature = signature;

    if (!quest && !hunt) {
      if (!this.root.hidden) this.root.hidden = true;
      return;
    }
    this.root.hidden = false;

    this.questCard.hidden = !quest;
    if (quest) {
      this.root.classList.toggle("is-complete", quest.status === "complete");
      this.nameEl.textContent = quest.name;
      this.stageEl.textContent = quest.status === "active"
        ? `${quest.stage + 1}/${quest.stageCount}`
        : quest.status === "complete" ? "done" : "—";
      this.objectiveEl.textContent = this.objectiveText(quest);
      this.fill.style.width = quest.status === "complete"
        ? "100%"
        : `${Math.round((quest.stage / Math.max(1, quest.stageCount)) * 100)}%`;
    }

    this.huntCard.hidden = !hunt;
    if (hunt) {
      const ready = hunt.status === "ready";
      this.huntCard.classList.toggle("is-ready", ready);
      this.huntNameEl.textContent = hunt.offer.targetName;
      this.huntCountEl.textContent = `${hunt.kills}/${hunt.offer.requiredKills}`;
      this.huntPlaceEl.textContent = ready ? "Done. Claim it in the journal." : hunt.offer.regionName;
      this.huntFill.style.width = `${Math.round((hunt.kills / Math.max(1, hunt.offer.requiredKills)) * 100)}%`;
    }
  }

  /** The hunt in progress or waiting to be claimed. A claimed one is history, not a tracker line. */
  private activeHunt(): HuntProgress | null {
    const active = this.hunts()?.snapshot().active ?? null;
    return active && active.status !== "claimed" ? active : null;
  }

  dispose(): void {
    this.root.remove();
  }

  private objectiveText(quest: QuestSummary): string {
    if (quest.status === "complete") return "Complete.";
    if (quest.status === "unstarted") return "Not started yet.";
    return quest.currentObjective ?? "";
  }

  private setCollapsed(collapsed: boolean): void {
    this.state.collapsed = collapsed;
    this.applyCollapsed();
    this.save();
  }

  private applyCollapsed(): void {
    this.body.hidden = this.state.collapsed;
    this.root.classList.toggle("is-collapsed", this.state.collapsed);
    this.collapseButton.textContent = this.state.collapsed ? "▸" : "▾";
    this.collapseButton.setAttribute("aria-label", this.state.collapsed ? "Expand tracker" : "Collapse tracker");
    this.collapseButton.setAttribute("aria-expanded", this.state.collapsed ? "false" : "true");
  }

  private applyPosition(): void {
    if (this.state.x === null || this.state.y === null) return;
    this.root.classList.add("is-moved");
    this.root.style.left = `${this.state.x}px`;
    this.root.style.top = `${this.state.y}px`;
  }

  private save(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.state));
    } catch {
      // Same tolerance as loadState: preferences that cannot persist are still live preferences.
    }
  }
}
